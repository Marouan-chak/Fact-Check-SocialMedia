from __future__ import annotations

import json
import re
import shutil
import subprocess
from html import unescape
from pathlib import Path
from typing import Any, Optional
from urllib.parse import urlparse


class DownloadError(RuntimeError):
    pass


class TranscriptError(RuntimeError):
    pass


_VTT_TIMESTAMP_RE = re.compile(
    r"^\s*\d{1,2}:\d{2}(?::\d{2})?\.\d{3}\s+-->\s+\d{1,2}:\d{2}(?::\d{2})?\.\d{3}\b"
)
_SRT_TIMESTAMP_RE = re.compile(r"^\s*\d{1,2}:\d{2}:\d{2},\d{3}\s+-->\s+\d{1,2}:\d{2}:\d{2},\d{3}\b")
_HTML_TAG_RE = re.compile(r"<[^>]+>")


def _dedupe_repeated_blocks(text: str) -> str:
    """
    YouTube subtitles can sometimes contain pathological repetition (e.g. each caption
    line repeated 2-3x). We remove only *consecutive* duplicates, and only when
    repetition is clearly an artifact.
    """
    raw = (text or "").replace("\r\n", "\n").strip()
    if not raw:
        return raw

    lines = raw.split("\n")
    nonempty_norms: list[str] = []
    for line in lines:
        if not line.strip():
            continue
        nonempty_norms.append(re.sub(r"\s+", " ", line).strip().lower())

    if len(nonempty_norms) < 6:
        return raw

    max_run = 1
    run = 1
    dup_pairs = 0
    for i in range(1, len(nonempty_norms)):
        if nonempty_norms[i] == nonempty_norms[i - 1]:
            dup_pairs += 1
            run += 1
            max_run = max(max_run, run)
        else:
            run = 1

    dup_ratio = dup_pairs / max(1, (len(nonempty_norms) - 1))
    if max_run < 3 and dup_ratio < 0.4:
        return raw

    out_lines: list[str] = []
    last_norm: Optional[str] = None
    pending_blank = False
    for line in lines:
        stripped = line.strip()
        if not stripped:
            pending_blank = True
            continue

        norm = re.sub(r"\s+", " ", stripped).strip().lower()
        if norm == last_norm:
            continue

        if pending_blank and out_lines:
            out_lines.append("")
        out_lines.append(stripped)
        pending_blank = False
        last_norm = norm

    joined = "\n".join(out_lines)
    joined = re.sub(r"\n{3,}", "\n\n", joined).strip()
    return joined


def is_youtube_url(url: str) -> bool:
    url = (url or "").strip()
    if not url:
        return False
    try:
        parsed = urlparse(url)
        host = (parsed.netloc or "").lower()
        if not host and parsed.path and "://" not in url:
            host = (urlparse("https://" + url).netloc or "").lower()
    except Exception:
        return False
    if "@" in host:
        host = host.split("@", 1)[1]
    if ":" in host:
        host = host.split(":", 1)[0]
    return host.endswith("youtube.com") or host.endswith("youtu.be") or host.endswith("youtube-nocookie.com")


def _clean_subtitle_text(text: str) -> str:
    text = (text or "").replace("\r\n", "\n")
    lines = [ln.strip() for ln in text.split("\n")]

    out_lines: list[str] = []
    skip_block = False
    for line in lines:
        if not line:
            skip_block = False
            if out_lines and out_lines[-1] != "":
                out_lines.append("")
            continue

        if skip_block:
            continue

        # Common headers / metadata
        if line.upper().startswith("WEBVTT"):
            continue
        if line.lower().startswith(("kind:", "language:")):
            continue
        if line.upper().startswith(("NOTE", "STYLE", "REGION")):
            skip_block = True
            continue

        # Cue indices and timestamps
        if line.isdigit():
            continue
        if _VTT_TIMESTAMP_RE.match(line) or _SRT_TIMESTAMP_RE.match(line):
            continue
        if "-->" in line:
            # Generic fallback for other subtitle formats
            continue

        cleaned = _HTML_TAG_RE.sub("", line)
        cleaned = unescape(cleaned).strip()
        if cleaned:
            out_lines.append(cleaned)

    # Collapse too many blank lines
    joined = "\n".join(out_lines)
    joined = re.sub(r"\n{3,}", "\n\n", joined).strip()
    return _dedupe_repeated_blocks(joined)


def _ytdlp_dump_json(*, url: str, cookies_file: Optional[Path] = None) -> dict[str, Any]:
    cmd = ["yt-dlp", "--no-playlist", "--dump-single-json", url]
    if cookies_file:
        cmd[1:1] = ["--cookies", str(cookies_file)]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise TranscriptError((proc.stderr or proc.stdout or "yt-dlp failed").strip())
    try:
        data = json.loads(proc.stdout)
    except Exception as e:
        raise TranscriptError(f"Failed to parse yt-dlp JSON: {e}") from e
    if not isinstance(data, dict):
        raise TranscriptError("yt-dlp JSON did not return an object.")
    return data


def _pick_sub_lang(available: dict[str, Any], preferred: list[str]) -> Optional[str]:
    if not isinstance(available, dict) or not available:
        return None

    key_by_lower = {str(k).lower(): str(k) for k in available.keys()}
    available_lowers = list(key_by_lower.keys())

    for pref in preferred:
        p = str(pref or "").strip().lower()
        if not p:
            continue
        if p in key_by_lower:
            return key_by_lower[p]

        base = p.split("-", 1)[0]
        if base in key_by_lower:
            return key_by_lower[base]

        for k in available_lowers:
            if k.startswith(base + "-"):
                return key_by_lower[k]

    return sorted(map(str, available.keys()))[0]


def _download_subtitles_file(
    *,
    url: str,
    out_dir: Path,
    lang: str,
    auto: bool,
    cookies_file: Optional[Path] = None,
) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)

    # Clean previous attempts
    for p in out_dir.glob("transcript.*"):
        try:
            p.unlink()
        except Exception:
            pass

    outtmpl = str(out_dir / "transcript.%(ext)s")
    cmd = [
        "yt-dlp",
        "--no-playlist",
        "--skip-download",
        "--sub-langs",
        str(lang),
        "--sub-format",
        "ttml/vtt/srt/best",
        "-o",
        outtmpl,
        url,
    ]
    if auto:
        cmd[3:3] = ["--write-auto-subs"]
    else:
        cmd[3:3] = ["--write-subs"]

    if cookies_file:
        cmd[1:1] = ["--cookies", str(cookies_file)]

    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise TranscriptError((proc.stderr or proc.stdout or "yt-dlp subtitle download failed").strip())

    subtitle_exts = {".vtt", ".srt", ".ttml", ".srv1", ".srv2", ".srv3", ".json3", ".ass"}
    candidates = [
        p
        for p in sorted(out_dir.glob("transcript*"))
        if p.is_file() and p.suffix.lower() in subtitle_exts and "transcript." in p.name.lower()
    ]
    if not candidates:
        raise TranscriptError("No subtitle file found after yt-dlp download.")

    requested = str(lang).lower()
    lang_candidates = [p for p in candidates if f".{requested}." in p.name.lower()]
    if lang_candidates:
        candidates = lang_candidates

    # If yt-dlp writes both manual and auto, it typically marks auto ones with ".auto.".
    preferred = [p for p in candidates if ".auto." not in p.name.lower()] or candidates

    # Prefer cleaner subtitle formats (TTML usually yields less duplication than VTT).
    ext_preference = [".ttml", ".vtt", ".srt", ".srv3", ".srv2", ".srv1", ".json3", ".ass"]
    for ext in ext_preference:
        for p in preferred:
            if p.suffix.lower() == ext:
                return p

    return preferred[0]


def get_youtube_transcript(
    *,
    url: str,
    out_dir: Path,
    preferred_langs: Optional[list[str]] = None,
    cookies_file: Optional[Path] = None,
    prefer_original_language: bool = True,
) -> Optional[str]:
    """
    Best-effort YouTube transcript fetch via yt-dlp subtitles (manual preferred, then auto captions).
    Returns plain text transcript, or None if unavailable.
    """
    url = (url or "").strip()
    if not url or not is_youtube_url(url):
        return None

    try:
        info = _ytdlp_dump_json(url=url, cookies_file=cookies_file)
        subtitles = info.get("subtitles") if isinstance(info.get("subtitles"), dict) else {}
        auto_caps = info.get("automatic_captions") if isinstance(info.get("automatic_captions"), dict) else {}

        prefs: list[str] = []
        vid_lang = str(info.get("language") or "").strip()
        if prefer_original_language:
            # We only want the video's original language transcript/captions (not a translated track).
            if not vid_lang:
                return None
            prefs.append(vid_lang)
        else:
            if preferred_langs:
                prefs.extend([str(x).strip() for x in preferred_langs if str(x).strip()])
            if vid_lang:
                prefs.append(vid_lang)
            prefs.extend(["en", "ar", "fr"])

        if isinstance(subtitles, dict) and subtitles:
            lang = _pick_sub_lang(subtitles, prefs)
            if lang:
                path = _download_subtitles_file(url=url, out_dir=out_dir, lang=lang, auto=False, cookies_file=cookies_file)
                return _clean_subtitle_text(path.read_text(encoding="utf-8", errors="replace"))

        if isinstance(auto_caps, dict) and auto_caps:
            lang = _pick_sub_lang(auto_caps, prefs)
            if lang:
                path = _download_subtitles_file(url=url, out_dir=out_dir, lang=lang, auto=True, cookies_file=cookies_file)
                return _clean_subtitle_text(path.read_text(encoding="utf-8", errors="replace"))
    except Exception:
        return None

    return None


def download_mp3(*, url: str, out_dir: Path, cookies_file: Optional[Path] = None) -> Path:
    """
    Download audio from a video URL and extract MP3 via yt-dlp + ffmpeg.
    Returns the path to the generated MP3.
    """
    out_dir.mkdir(parents=True, exist_ok=True)

    if shutil.which("ffmpeg") is None:
        raise DownloadError("ffmpeg not found. Install ffmpeg to enable MP3 extraction.")

    outtmpl = str(out_dir / "audio.%(ext)s")
    cmd = [
        "yt-dlp",
        "--no-playlist",
        "-x",
        "--audio-format",
        "mp3",
        "--audio-quality",
        "0",
        "-o",
        outtmpl,
        url,
    ]
    if cookies_file:
        cmd[1:1] = ["--cookies", str(cookies_file)]

    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise DownloadError((proc.stderr or proc.stdout or "yt-dlp failed").strip())

    mp3_path = out_dir / "audio.mp3"
    if not mp3_path.exists():
        candidates = sorted(out_dir.glob("audio.*"))
        raise DownloadError(f"Expected audio.mp3 not found. Got: {[p.name for p in candidates]}")
    return mp3_path
