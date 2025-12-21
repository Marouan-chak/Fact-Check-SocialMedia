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
from typing import Any, Callable, Optional, Tuple

from openai import OpenAI

from .config import settings
from .prompts import FACTCHECK_SYSTEM_PROMPT, TRANSCRIBE_PROMPT, build_factcheck_user_prompt
from .schemas import FactCheckReport


class OpenAIError(RuntimeError):
    pass


class TranscriptionError(RuntimeError):
    pass


class FactCheckError(RuntimeError):
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


def _normalize_thinking_level(raw: Optional[str]) -> Optional[str]:
    if raw is None:
        return None
    level = str(raw).strip().lower()
    return level or None


def _openai_reasoning_effort() -> str:
    level = _normalize_thinking_level(getattr(settings, "factcheck_thinking_level", None))
    if level in {"low", "medium", "high"}:
        return level
    return "high"


def _is_gemini_3_pro(model: str) -> bool:
    m = (model or "").strip().lower()
    return "gemini-3" in m and "pro" in m


def _gemini_thinking_level(model: str) -> Optional[str]:
    if not _is_gemini_3_pro(model):
        return None
    level = _normalize_thinking_level(getattr(settings, "factcheck_thinking_level", None))
    if level in {"low", "high"}:
        return level
    return None


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


def _parse_json_relaxed(text: str) -> Any:
    raw = (text or "").strip()
    if not raw:
        raise ValueError("Empty JSON text.")
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        pass

    # Strip ```json fences if present
    fenced = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", raw, flags=re.DOTALL | re.IGNORECASE)
    if fenced:
        try:
            return json.loads(fenced.group(1))
        except json.JSONDecodeError:
            pass

    # Try substring from first { to last }
    start = raw.find("{")
    end = raw.rfind("}")
    if start != -1 and end != -1 and end > start:
        try:
            return json.loads(raw[start : end + 1])
        except json.JSONDecodeError:
            pass

    raise ValueError("Failed to parse JSON.")


def _gemini_generate_json(
    *,
    model: str,
    prompt: str,
    system_instruction: Optional[str] = None,
    tools: Optional[list[Any]] = None,
    temperature: float = 1.0,
    max_attempts: int = 2,
) -> tuple[dict[str, Any], dict[str, Any]]:
    api_key = (getattr(settings, "gemini_api_key", "") or "").strip() or os.getenv("GEMINI_API_KEY", "").strip()
    if not api_key:
        raise FactCheckError("GEMINI_API_KEY is not set.")

    try:
        from google import genai
        from google.genai import types
    except Exception as e:
        raise FactCheckError("Gemini operations require the `google-genai` package.") from e

    client = genai.Client(api_key=api_key)

    last_text = ""
    last_resp: Any = None
    for attempt in range(1, max(1, int(max_attempts)) + 1):
        # Note: Some Gemini tool-calling modes reject response_mime_type='application/json'.
        # So we only request JSON mime type when no tools are attached (or on a "fix JSON" retry).
        use_json_mime = not tools or attempt > 1
        cfg = types.GenerateContentConfig(temperature=float(temperature))
        if use_json_mime:
            cfg.response_mime_type = "application/json"
        if system_instruction:
            cfg.system_instruction = system_instruction
        thinking_level = _gemini_thinking_level(model)
        if thinking_level:
            cfg.thinking_config = types.ThinkingConfig(thinking_level=thinking_level)
        # For retries, we drop tools and just ask the model to output valid JSON.
        # This avoids tool-calling + JSON-mode incompatibilities and keeps the retry cheap.
        if tools and attempt == 1:
            cfg.tools = tools

        resp = client.models.generate_content(model=model, contents=prompt, config=cfg)
        last_resp = resp
        last_text = (getattr(resp, "text", "") or "").strip()
        try:
            parsed = _parse_json_relaxed(last_text)
            if not isinstance(parsed, dict):
                raise ValueError("Expected a JSON object.")
            raw: dict[str, Any] = {"provider": "gemini", "model": model}
            try:
                if hasattr(resp, "model_dump"):
                    raw["response"] = resp.model_dump(mode="json")
            except Exception:
                pass
            return parsed, raw
        except Exception:
            if attempt >= max_attempts:
                break
            prompt = (
                "You MUST return ONLY valid JSON (an object), no markdown, no code fences, no commentary.\n"
                "Fix the JSON below and return the corrected JSON only:\n\n"
                f"{last_text}"
            )

    raise FactCheckError(f"Gemini did not return valid JSON after {max_attempts} attempt(s). Last output: {last_text[:400]}")


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
        reasoning={"effort": _openai_reasoning_effort(), "summary": "auto"},
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

    prompt = build_factcheck_user_prompt(transcript=transcript, url=url, output_language=output_language)
    report_dict, raw = _gemini_generate_json(
        model=model,
        prompt=prompt,
        system_instruction=FACTCHECK_SYSTEM_PROMPT,
        tools=[{"google_search": {}}, {"url_context": {}}],
        temperature=1.0,
        max_attempts=2,
    )

    if "generated_at" not in report_dict:
        report_dict["generated_at"] = datetime.now(tz=timezone.utc).isoformat()

    _compute_weighted_overall(report_dict)
    report = FactCheckReport.model_validate(report_dict)

    return report, raw


def _fact_check_transcript_openai_stream(
    *,
    transcript: str,
    url: Optional[str],
    output_language: str,
    on_thought: Optional[Callable[[str], None]] = None,
) -> Tuple[FactCheckReport, dict[str, Any]]:
    client = _client()

    schema = _tighten_schema(_dereference_json_schema(FactCheckReport.model_json_schema()))

    output_chunks: list[str] = []
    seen_thoughts: set[str] = set()
    reasoning_buf = ""

    with client.responses.stream(
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
        reasoning={"effort": _openai_reasoning_effort(), "summary": "auto"},
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
    ) as stream:
        for event in stream:
            event_type = getattr(event, "type", "") or ""

            if event_type == "response.output_text.delta":
                delta = getattr(event, "delta", None)
                if isinstance(delta, str) and delta:
                    output_chunks.append(delta)

            elif "reasoning_summary" in event_type:
                # OpenAI does not expose raw chain-of-thought, only optional summaries.
                # Streaming event shapes differ slightly across SDK versions, so we handle
                # both delta-style and done-style events.
                if event_type.endswith(".delta"):
                    delta = getattr(event, "delta", None)
                    if isinstance(delta, str) and delta:
                        reasoning_buf += delta
                elif event_type.endswith(".done"):
                    text = getattr(event, "text", None)
                    if not isinstance(text, str) or not text:
                        part = getattr(event, "part", None)
                        text = getattr(part, "text", None) if part is not None else None
                    candidate = (reasoning_buf.strip() or (text or "").strip()).strip()
                    reasoning_buf = ""
                    if candidate and candidate not in seen_thoughts:
                        seen_thoughts.add(candidate)
                        if on_thought:
                            try:
                                on_thought(candidate)
                            except Exception:
                                pass

        response = stream.get_final_response()

    output_text = ("".join(output_chunks).strip() or getattr(response, "output_text", None) or "").strip()
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
    raw = response.model_dump(mode="json") if hasattr(response, "model_dump") else {}
    return report, raw


def _fact_check_transcript_gemini_stream(
    *,
    transcript: str,
    url: Optional[str],
    output_language: str,
    on_thought: Optional[Callable[[str], None]] = None,
) -> Tuple[FactCheckReport, dict[str, Any]]:
    model = _normalize_transcribe_model(settings.factcheck_model or "")

    prompt = build_factcheck_user_prompt(transcript=transcript, url=url, output_language=output_language)
    api_key = (getattr(settings, "gemini_api_key", "") or "").strip() or os.getenv("GEMINI_API_KEY", "").strip()
    if not api_key:
        raise FactCheckError("GEMINI_API_KEY is not set (required for Gemini fact checking).")

    try:
        from google import genai
        from google.genai import types
    except Exception as e:
        raise FactCheckError("Gemini fact checking requires the `google-genai` package.") from e

    client = genai.Client(api_key=api_key)

    thinking_level = _gemini_thinking_level(model)
    thinking_config = (
        types.ThinkingConfig(include_thoughts=True, thinking_level=thinking_level)
        if thinking_level
        else types.ThinkingConfig(include_thoughts=True)
    )
    config = types.GenerateContentConfig(
        system_instruction=FACTCHECK_SYSTEM_PROMPT,
        tools=[{"google_search": {}}, {"url_context": {}}],
        temperature=1.0,
        thinking_config=thinking_config,
    )

    text_chunks: list[str] = []
    for chunk in client.models.generate_content_stream(model=model, contents=prompt, config=config):
        candidates = getattr(chunk, "candidates", None)
        if not candidates:
            continue
        content = getattr(candidates[0], "content", None)
        parts = getattr(content, "parts", None) if content is not None else None
        if not parts:
            continue

        for part in parts:
            part_text = getattr(part, "text", None)
            if not isinstance(part_text, str) or not part_text:
                continue
            is_thought = bool(getattr(part, "thought", False))
            if is_thought:
                if on_thought:
                    try:
                        on_thought(part_text.strip())
                    except Exception:
                        pass
            else:
                text_chunks.append(part_text)

    output_text = "".join(text_chunks).strip()
    report_dict = _parse_json_relaxed(output_text)
    if not isinstance(report_dict, dict):
        raise FactCheckError("Gemini did not return a JSON object.")

    if "generated_at" not in report_dict:
        report_dict["generated_at"] = datetime.now(tz=timezone.utc).isoformat()

    _compute_weighted_overall(report_dict)
    report = FactCheckReport.model_validate(report_dict)
    raw: dict[str, Any] = {"provider": "gemini", "model": model}
    return report, raw


def fact_check_transcript_stream(
    *,
    transcript: str,
    url: Optional[str] = None,
    output_language: str = "ar",
    on_thought: Optional[Callable[[str], None]] = None,
) -> Tuple[FactCheckReport, dict[str, Any]]:
    """
    Fact-check transcript while emitting incremental thought/reasoning summaries via `on_thought`.
    """
    model = (settings.factcheck_model or "").strip()
    if _is_gemini_model(model):
        return _fact_check_transcript_gemini_stream(
            transcript=transcript, url=url, output_language=output_language, on_thought=on_thought
        )
    return _fact_check_transcript_openai_stream(
        transcript=transcript, url=url, output_language=output_language, on_thought=on_thought
    )


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


def translate_report(
    *, report: FactCheckReport, target_language: str
) -> Tuple[FactCheckReport, dict[str, Any]]:
    """
    Translate an existing fact-check report to a new language using Gemini Flash 2.5.
    Returns (translated_report, raw_response_dict).
    """
    from .prompts import LANGUAGE_NAME_BY_CODE

    lang_code = (target_language or "").strip().lower() or "ar"
    lang_name = LANGUAGE_NAME_BY_CODE.get(lang_code, lang_code)

    # Serialize the report to JSON for translation
    report_json = report.model_dump(mode="json")

    translation_prompt = f"""\
You are a professional translator. Translate the following fact-check report JSON to {lang_name} (code: {lang_code}).

IMPORTANT RULES:
1. Translate ONLY the human-readable text fields:
   - summary
   - whats_right (list items)
   - whats_wrong (list items)
   - missing_context (list items)
   - For each claim: claim, explanation, correction
   - For each danger item: description, mitigation
   - limitations
2. DO NOT translate or modify:
   - JSON keys
   - Enum values (verdicts like "supported", "contradicted", etc.)
   - URLs
   - Source titles and publishers (keep as original)
   - Numeric values (scores, weights, confidence, severity)
   - Dates
3. Preserve the exact JSON structure.
4. Do not add/remove/reorder items in lists (claims, danger, whats_right, whats_wrong, missing_context, sources_used).
5. Return ONLY valid JSON, no explanation or markdown.

Report to translate:
{json.dumps(report_json, indent=2, ensure_ascii=False)}
"""

    translated_dict, raw = _gemini_generate_json(
        model="gemini-2.5-flash",
        prompt=translation_prompt,
        temperature=0.3,
        max_attempts=2,
    )

    # Build the translated report by applying translated text fields onto the original report JSON.
    merged = json.loads(json.dumps(report_json, ensure_ascii=False))
    merged["generated_at"] = report.generated_at.isoformat()

    def maybe_set_str(key: str) -> None:
        val = translated_dict.get(key)
        if isinstance(val, str) and val.strip():
            merged[key] = val

    def maybe_set_str_list(key: str) -> None:
        val = translated_dict.get(key)
        if isinstance(val, list) and all(isinstance(x, str) for x in val):
            merged[key] = val

    maybe_set_str("summary")
    maybe_set_str_list("whats_right")
    maybe_set_str_list("whats_wrong")
    maybe_set_str_list("missing_context")
    maybe_set_str("limitations")

    src_claims = merged.get("claims") if isinstance(merged.get("claims"), list) else []
    out_claims = translated_dict.get("claims") if isinstance(translated_dict.get("claims"), list) else []
    for i in range(min(len(src_claims), len(out_claims))):
        if not isinstance(src_claims[i], dict) or not isinstance(out_claims[i], dict):
            continue
        for k in ("claim", "explanation", "correction"):
            v = out_claims[i].get(k)
            if isinstance(v, str):
                src_claims[i][k] = v

    src_danger = merged.get("danger") if isinstance(merged.get("danger"), list) else []
    out_danger = translated_dict.get("danger") if isinstance(translated_dict.get("danger"), list) else []
    for i in range(min(len(src_danger), len(out_danger))):
        if not isinstance(src_danger[i], dict) or not isinstance(out_danger[i], dict):
            continue
        for k in ("description", "mitigation"):
            v = out_danger[i].get(k)
            if isinstance(v, str):
                src_danger[i][k] = v

    merged["overall_score"] = report.overall_score
    merged["overall_verdict"] = report.overall_verdict

    translated_report = FactCheckReport.model_validate(merged)
    raw.update({"operation": "translation", "target_language": lang_code})
    return translated_report, raw


def translate_thought(thought: str, target_language: str) -> str:
    """
    Translate and rewrite an AI reasoning thought to the target language using Gemini 2.5 Flash.
    If target is English or translation fails, returns the original thought.
    """
    from .prompts import LANGUAGE_NAME_BY_CODE

    lang_code = (target_language or "").strip().lower() or "en"
    
    # Skip translation for English
    if lang_code == "en":
        return thought
    
    thought_text = (thought or "").strip()
    if not thought_text:
        return thought
    
    lang_name = LANGUAGE_NAME_BY_CODE.get(lang_code, lang_code)
    
    api_key = (getattr(settings, "gemini_api_key", "") or "").strip() or os.getenv("GEMINI_API_KEY", "").strip()
    if not api_key:
        return thought  # No API key, return original
    
    try:
        from google import genai
        from google.genai import types
    except Exception:
        return thought  # Package not available
    
    prompt = f"""\
Translate this text to {lang_name}. Translate VERBATIM - do not add greetings, introductions, or any extra text. Just translate the content exactly as it is.

Text to translate:
{thought_text}

Output ONLY the {lang_name} translation, nothing else."""

    try:
        client = genai.Client(api_key=api_key)
        config = types.GenerateContentConfig(
            temperature=0.3,
            max_output_tokens=2000,
        )
        resp = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=prompt,
            config=config,
        )
        result = (getattr(resp, "text", "") or "").strip()
        return result if result else thought
    except Exception:
        return thought  # On any error, return original
