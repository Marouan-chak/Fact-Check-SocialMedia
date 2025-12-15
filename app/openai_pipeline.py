from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from math import ceil
from pathlib import Path
from typing import Any, Optional, Tuple

from openai import OpenAI

from .config import settings
from .prompts import FACTCHECK_SYSTEM_PROMPT, TRANSCRIBE_PROMPT, build_factcheck_user_prompt
from .schemas import FactCheckReport


class OpenAIError(RuntimeError):
    pass


class TranscriptionError(RuntimeError):
    pass


def _clamp_int(value: Any, *, low: int, high: int, default: int) -> int:
    try:
        n = int(value)
    except Exception:
        return default
    return max(low, min(high, n))


def _weighted_correctness(verdict: str, confidence: int) -> float:
    """
    Maps a claim verdict + confidence into a 0..1 "correctness" value.
    Confidence shrinks the value toward 0.5 (unknown) when low.
    """
    base_by_verdict = {
        "supported": 1.0,
        "contradicted": 0.0,
        "mixed": 0.6,
        "unverifiable": 0.5,
    }
    base = base_by_verdict.get(verdict, 0.5)
    conf = max(0.0, min(1.0, confidence / 100.0))
    return 0.5 + (base - 0.5) * conf


def _compute_weighted_overall(report_dict: dict[str, Any]) -> None:
    """
    Computes overall_score + overall_verdict from per-claim verdicts using per-claim weights.
    This makes central/primary claims affect the score much more than minor ones.
    """
    claims = report_dict.get("claims")
    if not isinstance(claims, list) or not claims:
        report_dict["overall_score"] = 50
        report_dict["overall_verdict"] = "unverifiable"
        return

    total_weight = 0.0
    weighted_sum = 0.0
    unverifiable_weight = 0.0

    scorable_weights = []
    for c in claims:
        if not isinstance(c, dict):
            continue
        verdict = str(c.get("verdict") or "").strip()
        if verdict == "not_a_factual_claim":
            c["weight"] = 0
            continue

        weight = _clamp_int(c.get("weight"), low=0, high=100, default=0)
        confidence = _clamp_int(c.get("confidence"), low=0, high=100, default=50)
        scorable_weights.append(weight)

        c["weight"] = weight

    if not scorable_weights:
        report_dict["overall_score"] = 50
        report_dict["overall_verdict"] = "unverifiable"
        return

    if sum(scorable_weights) <= 0:
        # Backwards compatibility (older reports) or model output with missing weights:
        # treat all claims as equally weighted.
        for c in claims:
            if isinstance(c, dict) and str(c.get("verdict") or "").strip() != "not_a_factual_claim":
                c["weight"] = 1

    for c in claims:
        if not isinstance(c, dict):
            continue
        verdict = str(c.get("verdict") or "").strip()
        if verdict == "not_a_factual_claim":
            continue

        weight = _clamp_int(c.get("weight"), low=0, high=100, default=0)
        confidence = _clamp_int(c.get("confidence"), low=0, high=100, default=50)
        if weight <= 0:
            continue

        total_weight += weight
        weighted_sum += weight * _weighted_correctness(verdict, confidence)
        if verdict == "unverifiable":
            unverifiable_weight += weight

    if total_weight <= 0:
        report_dict["overall_score"] = 50
        report_dict["overall_verdict"] = "unverifiable"
        return

    score = int(round((weighted_sum / total_weight) * 100))
    score = max(0, min(100, score))

    unverifiable_ratio = unverifiable_weight / total_weight if total_weight else 1.0
    if unverifiable_ratio >= 0.6:
        overall_verdict = "unverifiable"
    else:
        if score >= 90:
            overall_verdict = "accurate"
        elif score >= 70:
            overall_verdict = "mostly_accurate"
        elif score >= 40:
            overall_verdict = "mixed"
        elif score >= 10:
            overall_verdict = "misleading"
        else:
            overall_verdict = "false"

    report_dict["overall_score"] = score
    report_dict["overall_verdict"] = overall_verdict


def _audio_duration_seconds(path: Path) -> Optional[float]:
    """
    Returns duration in seconds using ffprobe when available; otherwise None.
    """
    if shutil.which("ffprobe") is None:
        return None

    proc = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            str(path),
        ],
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        return None
    try:
        return float((proc.stdout or "").strip())
    except Exception:
        return None


def _split_mp3_into_segments(*, mp3_path: Path, out_dir: Path, segment_seconds: int) -> list[Path]:
    """
    Splits an MP3 into multiple MP3 segments using ffmpeg.
    """
    if shutil.which("ffmpeg") is None:
        raise TranscriptionError("ffmpeg not found (required for long-audio chunking).")

    out_dir.mkdir(parents=True, exist_ok=True)
    out_template = str(out_dir / "part_%03d.mp3")

    # Try stream copy first (fast). If it fails, fall back to re-encode.
    for cmd in (
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            str(mp3_path),
            "-f",
            "segment",
            "-segment_time",
            str(int(segment_seconds)),
            "-reset_timestamps",
            "1",
            "-c",
            "copy",
            out_template,
        ],
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            str(mp3_path),
            "-f",
            "segment",
            "-segment_time",
            str(int(segment_seconds)),
            "-reset_timestamps",
            "1",
            "-c:a",
            "libmp3lame",
            "-q:a",
            "4",
            out_template,
        ],
    ):
        # Clean previous attempts
        for p in out_dir.glob("part_*.mp3"):
            try:
                p.unlink()
            except Exception:
                pass

        proc = subprocess.run(cmd, capture_output=True, text=True)
        if proc.returncode == 0:
            parts = sorted(out_dir.glob("part_*.mp3"))
            if parts:
                return parts

    raise TranscriptionError("Failed to split audio into chunks with ffmpeg.")


def _dereference_json_schema(schema: dict[str, Any]) -> dict[str, Any]:
    """
    OpenAI structured outputs supports JSON Schema, but some runtimes are finicky about $ref/$defs.
    This helper inlines local "#/$defs/..." references to keep the schema self-contained.
    """
    defs: dict[str, Any] = schema.get("$defs", {}) if isinstance(schema.get("$defs"), dict) else {}
    resolving: set[str] = set()
    resolved_cache: dict[str, Any] = {}

    def resolve_ref(ref: str) -> Any:
        prefix = "#/$defs/"
        if not ref.startswith(prefix):
            return {"$ref": ref}
        name = ref[len(prefix) :]
        if name in resolved_cache:
            return resolved_cache[name]
        if name in resolving:
            # Shouldn't happen for our schema; keep as-is to avoid infinite recursion.
            return defs.get(name, {"$ref": ref})
        resolving.add(name)
        resolved_cache[name] = _walk(defs.get(name, {"$ref": ref}))
        resolving.remove(name)
        return resolved_cache[name]

    def _walk(node: Any) -> Any:
        if isinstance(node, list):
            return [_walk(x) for x in node]
        if not isinstance(node, dict):
            return node
        if "$ref" in node and isinstance(node["$ref"], str):
            return resolve_ref(node["$ref"])
        out: dict[str, Any] = {}
        for k, v in node.items():
            if k == "$defs":
                continue
            out[k] = _walk(v)
        return out

    flattened = _walk(schema)
    if isinstance(flattened, dict):
        flattened.pop("$defs", None)
    return flattened


def _tighten_schema(schema: dict[str, Any]) -> dict[str, Any]:
    """
    Make object schemas explicit about additionalProperties.
    This improves determinism for structured outputs and keeps responses small/consistent.
    """

    def walk(node: Any) -> Any:
        if isinstance(node, list):
            return [walk(x) for x in node]
        if not isinstance(node, dict):
            return node

        is_objectish = node.get("type") == "object" or "properties" in node
        if is_objectish and isinstance(node.get("properties"), dict):
            # OpenAI structured outputs expects required to include every property key.
            props: dict[str, Any] = node["properties"]
            node["required"] = list(props.keys())
            node["additionalProperties"] = False

        for k, v in list(node.items()):
            node[k] = walk(v)
        return node

    return walk(schema)


def _client() -> OpenAI:
    # openai sdk also reads OPENAI_API_KEY from env, but we keep it explicit.
    return OpenAI(api_key=settings.openai_api_key or None)


def _is_gemini_model(model: str) -> bool:
    m = (model or "").strip().lower()
    return m.startswith("gemini") or m.startswith("models/gemini")


def _normalize_transcribe_model(model: str) -> str:
    raw = (model or "").strip()
    if not raw:
        return raw

    key = re.sub(r"\s+", " ", raw).strip().lower()
    aliases = {
        "gemini 2.5 flash": "gemini-2.5-flash",
        "gemini 2.5 pro": "gemini-2.5-pro",
        "gemini 3.0 preview": "gemini-3-pro-preview",
        "gemini 3 preview": "gemini-3-pro-preview",
    }
    return aliases.get(key, raw)


def _transcribe_file(path: Path) -> str:
    model = _normalize_transcribe_model(settings.transcribe_model or "")
    if not model:
        raise TranscriptionError("TRANSCRIBE_MODEL is empty.")

    if _is_gemini_model(model):
        return _transcribe_file_gemini(path, model=model)
    return _transcribe_file_openai(path, model=model)


def _transcribe_file_openai(path: Path, *, model: str) -> str:
    client = _client()
    with path.open("rb") as f:
        tx = client.audio.transcriptions.create(
            model=model,
            file=f,
            response_format="text",
            prompt=TRANSCRIBE_PROMPT,
            temperature=1,
        )
    if isinstance(tx, str):
        return tx
    return getattr(tx, "text", "") or ""


def _transcribe_file_gemini(path: Path, *, model: str) -> str:
    api_key = (getattr(settings, "gemini_api_key", "") or "").strip() or os.getenv("GEMINI_API_KEY", "").strip()
    if not api_key:
        raise TranscriptionError("GEMINI_API_KEY is not set (required for Gemini transcription).")

    try:
        from google import genai
        from google.genai import types
    except Exception as e:
        raise TranscriptionError("Gemini transcription requires the `google-genai` package.") from e

    client = genai.Client(api_key=api_key)
    uploaded = None
    try:
        uploaded = client.files.upload(file=str(path))
        prompt = (
            TRANSCRIBE_PROMPT.strip()
            + "\n\nReturn only the transcript text. Do not add titles, timestamps, or commentary."
        )
        resp = client.models.generate_content(
            model=model,
            contents=[prompt, uploaded],
            config=types.GenerateContentConfig(temperature=1.0),
        )
        return (getattr(resp, "text", "") or "").strip()
    except Exception as e:
        raise TranscriptionError(f"Gemini transcription failed: {e}") from e
    finally:
        try:
            if uploaded is not None and getattr(uploaded, "name", None):
                client.files.delete(name=uploaded.name)
        except Exception:
            pass


def _fact_check_transcript_openai(
    *, transcript: str, url: Optional[str] = None, output_language: str = "ar"
) -> Tuple[FactCheckReport, dict[str, Any]]:
    """
    OpenAI fact-checking via Responses API + web_search + strict JSON-schema output.
    Returns (report, raw_response_dict).
    """
    client = _client()

    schema = _tighten_schema(_dereference_json_schema(FactCheckReport.model_json_schema()))

    response = client.responses.create(
        model=settings.factcheck_model,
        input=[
            {"role": "system", "content": FACTCHECK_SYSTEM_PROMPT},
            {
                "role": "user",
                "content": build_factcheck_user_prompt(transcript=transcript, url=url, output_language=output_language),
            },
        ],
        tools=[
            {
                "type": "web_search",
                "user_location": {"type": "approximate"},
                "search_context_size": "medium",
            }
        ],
        reasoning={"effort": "high", "summary": "auto"},
        text={
            "verbosity": "medium",
            "format": {
                "type": "json_schema",
                "name": "fact_check_report",
                "strict": True,
                "schema": schema,
            },
        },
        store=True,
        include=["reasoning.encrypted_content", "web_search_call.action.sources"],
    )

    output_text = getattr(response, "output_text", None) or ""
    if not output_text:
        raise OpenAIError("Empty model output.")

    try:
        report_dict = json.loads(output_text)
    except json.JSONDecodeError as e:
        raise OpenAIError(f"Model did not return valid JSON: {e}") from e

    if "generated_at" not in report_dict:
        report_dict["generated_at"] = datetime.now(tz=timezone.utc).isoformat()

    # Enforce weighted scoring in a consistent way.
    _compute_weighted_overall(report_dict)

    report = FactCheckReport.model_validate(report_dict)
    raw = response.model_dump(mode="json") if hasattr(response, "model_dump") else {}
    return report, raw


def _fact_check_transcript_gemini(
    *, transcript: str, url: Optional[str] = None, output_language: str = "ar"
) -> Tuple[FactCheckReport, dict[str, Any]]:
    """
    Gemini fact-checking via Google Search grounding + structured JSON output.
    Returns (report, raw_response_dict).
    """
    model = _normalize_transcribe_model(settings.factcheck_model or "")
    api_key = (getattr(settings, "gemini_api_key", "") or "").strip() or os.getenv("GEMINI_API_KEY", "").strip()
    if not api_key:
        raise OpenAIError("GEMINI_API_KEY is not set (required for Gemini fact checking).")

    try:
        from google import genai
        from google.genai import types
    except Exception as e:
        raise OpenAIError("Gemini fact checking requires the `google-genai` package.") from e

    client = genai.Client(api_key=api_key)
    schema = _tighten_schema(_dereference_json_schema(FactCheckReport.model_json_schema()))

    # Gemini supports built-in grounding with Google Search, plus URL Context.
    config = types.GenerateContentConfig(
        system_instruction=FACTCHECK_SYSTEM_PROMPT,
        tools=[{"google_search": {}}, {"url_context": {}}],
        response_mime_type="application/json",
        response_json_schema=schema,
    )

    prompt = build_factcheck_user_prompt(transcript=transcript, url=url, output_language=output_language)
    resp = client.models.generate_content(model=model, contents=prompt, config=config)
    output_text = (getattr(resp, "text", "") or "").strip()
    if not output_text:
        raise OpenAIError("Empty model output.")

    try:
        report_dict = json.loads(output_text)
    except json.JSONDecodeError as e:
        raise OpenAIError(f"Model did not return valid JSON: {e}") from e

    if "generated_at" not in report_dict:
        report_dict["generated_at"] = datetime.now(tz=timezone.utc).isoformat()

    _compute_weighted_overall(report_dict)
    report = FactCheckReport.model_validate(report_dict)

    raw: dict[str, Any] = {"provider": "gemini", "model": model}
    try:
        if hasattr(resp, "model_dump"):
            raw["response"] = resp.model_dump(mode="json")
    except Exception:
        pass
    return report, raw


def transcribe_audio_mp3(mp3_path: Path) -> str:
    duration = _audio_duration_seconds(mp3_path)
    chunk_seconds = max(60, int(getattr(settings, "transcribe_chunk_seconds", 900) or 900))

    # If duration is unknown, we keep the existing behavior and transcribe as a single file.
    if duration is None or duration <= chunk_seconds:
        return _transcribe_file(mp3_path)

    segments_dir = mp3_path.parent / "segments"
    parts = _split_mp3_into_segments(mp3_path=mp3_path, out_dir=segments_dir, segment_seconds=chunk_seconds)

    expected_parts = int(ceil(duration / chunk_seconds))
    parts = parts[: max(1, expected_parts)]

    def transcribe_one(index: int, part_path: Path) -> tuple[int, str]:
        text = _transcribe_file(part_path)
        return index, (text or "").strip()

    max_workers = max(1, int(getattr(settings, "transcribe_max_workers", 3) or 3))
    max_workers = min(max_workers, len(parts))

    results: dict[int, str] = {}
    errors: list[Exception] = []
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {executor.submit(transcribe_one, idx, part): idx for idx, part in enumerate(parts, start=1)}
        for fut in as_completed(futures):
            idx = futures[fut]
            try:
                part_idx, text = fut.result()
            except Exception as e:
                errors.append(e)
                continue
            results[part_idx] = text

    if errors:
        raise TranscriptionError(f"Chunk transcription failed for {len(errors)} part(s).")

    chunks: list[str] = []
    total = len(parts)
    for idx in range(1, total + 1):
        text = (results.get(idx) or "").strip()
        if not text:
            continue
        chunks.append(text)

    return "\n\n".join(chunks).strip()


def fact_check_transcript(
    *, transcript: str, url: Optional[str] = None, output_language: str = "ar"
) -> Tuple[FactCheckReport, dict[str, Any]]:
    """
    Returns (report, raw_response_dict) where raw_response_dict includes tool sources when requested.
    """
    model = (settings.factcheck_model or "").strip()
    if _is_gemini_model(model):
        return _fact_check_transcript_gemini(transcript=transcript, url=url, output_language=output_language)
    return _fact_check_transcript_openai(transcript=transcript, url=url, output_language=output_language)