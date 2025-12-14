from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Optional
from uuid import uuid4

from .config import settings
from .openai_pipeline import fact_check_transcript, transcribe_audio_mp3
from .schemas import Job
from .storage import read_json, write_json, write_model
from .ytdlp_audio import DownloadError, download_mp3


class JobStore:
    def __init__(self, base_dir: Path):
        self.base_dir = base_dir
        self.jobs_dir = base_dir / "jobs"
        self._lock = asyncio.Lock()
        self._jobs: Dict[str, Job] = {}

    def _job_dir(self, job_id: str) -> Path:
        return self.jobs_dir / job_id

    def _job_path(self, job_id: str) -> Path:
        return self._job_dir(job_id) / "job.json"

    def _raw_response_path(self, job_id: str) -> Path:
        return self._job_dir(job_id) / "openai_raw.json"

    def _transcript_path(self, job_id: str) -> Path:
        return self._job_dir(job_id) / "transcript.txt"

    def _report_path(self, job_id: str) -> Path:
        return self._job_dir(job_id) / "report.json"

    def _audio_dir(self, job_id: str) -> Path:
        return self._job_dir(job_id) / "media"

    async def create(self, url: str) -> Job:
        async with self._lock:
            job_id = uuid4().hex
            now = datetime.now(tz=timezone.utc)
            job = Job(id=job_id, url=url, status="queued", created_at=now, updated_at=now, progress=0)
            self._jobs[job_id] = job
            write_model(self._job_path(job_id), job)
            return job

    async def get(self, job_id: str) -> Optional[Job]:
        async with self._lock:
            if job_id in self._jobs:
                return self._jobs[job_id]
        data = read_json(self._job_path(job_id))
        if not data:
            return None
        try:
            job = Job.model_validate(data)
        except Exception:
            return None
        async with self._lock:
            self._jobs[job_id] = job
        return job

    async def update(self, job_id: str, **fields) -> None:
        async with self._lock:
            job = self._jobs[job_id]
            updated = job.model_copy(update={**fields, "updated_at": datetime.now(tz=timezone.utc)})
            self._jobs[job_id] = updated
            write_model(self._job_path(job_id), updated)

    async def run_pipeline(self, job_id: str) -> None:
        job = await self.get(job_id)
        if not job:
            return

        try:
            await self.update(job_id, status="downloading", progress=10, error=None)
            audio_dir = self._audio_dir(job_id)
            mp3_path = await asyncio.to_thread(
                download_mp3,
                url=job.url,
                out_dir=audio_dir,
                cookies_file=settings.ytdlp_cookies_file,
            )

            await self.update(job_id, status="transcribing", progress=40)
            transcript = await asyncio.to_thread(transcribe_audio_mp3, mp3_path)
            self._transcript_path(job_id).write_text(transcript, encoding="utf-8")

            await self.update(job_id, status="fact_checking", progress=70, transcript=transcript)
            report, raw = await asyncio.to_thread(fact_check_transcript, transcript=transcript, url=job.url)
            write_model(self._report_path(job_id), report)
            write_json(self._raw_response_path(job_id), raw)

            await self.update(job_id, status="completed", progress=100, report=report)
        except DownloadError as e:
            await self.update(job_id, status="failed", progress=100, error=f"Download failed: {e}")
        except Exception as e:
            await self.update(job_id, status="failed", progress=100, error=str(e))


job_store = JobStore(settings.data_dir)

