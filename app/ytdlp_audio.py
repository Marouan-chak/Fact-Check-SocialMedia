from __future__ import annotations

import shutil
import subprocess
from pathlib import Path
from typing import Optional


class DownloadError(RuntimeError):
    pass


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

