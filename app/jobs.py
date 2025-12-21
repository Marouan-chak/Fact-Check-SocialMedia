from __future__ import annotations

import asyncio
import contextlib
import shutil
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Optional
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from uuid import uuid4

from .config import settings
from .openai_pipeline import fact_check_transcript_stream, transcribe_audio_mp3, translate_report, translate_thought
from .schemas import FactCheckReport, HistoryItem, Job
from .storage import read_json, write_json, write_model
from .ytdlp_audio import (
    DownloadError,
    download_mp3,
    download_thumbnail,
    download_thumbnail_from_url,
    get_video_metadata,
    get_youtube_transcript,
    is_youtube_url,
)


def _normalize_url(url: str) -> str:
    url = (url or "").strip()
    if not url:
        return url
    parts = urlsplit(url)
    query_pairs = parse_qsl(parts.query, keep_blank_values=True)
    filtered = []
    for k, v in query_pairs:
        kl = k.lower()
        if kl.startswith("utm_"):
            continue
        if kl in {"igshid", "fbclid"}:
            continue
        filtered.append((k, v))
    new_query = urlencode(filtered, doseq=True)
    normalized = urlunsplit(
        (
            parts.scheme.lower(),
            parts.netloc.lower(),
            parts.path.rstrip("/"),
            new_query,
            "",  # strip fragments
        )
    )
    return normalized


class JobStore:
    def __init__(self, base_dir: Path):
        self.base_dir = base_dir
        self.jobs_dir = base_dir / "jobs"
        self.index_path = base_dir / "url_index.json"
        self.url_only_index_path = base_dir / "url_only_index.json"
        self._lock = asyncio.Lock()
        self._jobs: Dict[str, Job] = {}
        self._index: Dict[str, str] = {}  # cache_key (url+lang) -> job_id
        self._url_index: Dict[str, list[str]] = {}  # normalized_url -> [job_ids]
        self._running: set[str] = set()
        self._tasks: Dict[str, asyncio.Task] = {}

        data = read_json(self.index_path)
        if isinstance(data, dict):
            self._index = {str(k): str(v) for k, v in data.items()}

        # Load URL-only index (maps URL to list of job IDs for any language)
        url_data = read_json(self.url_only_index_path)
        if isinstance(url_data, dict):
            self._url_index = {str(k): list(v) for k, v in url_data.items() if isinstance(v, list)}
        self._backfill_url_index_from_jobs_dir()

    def _backfill_url_index_from_jobs_dir(self) -> None:
        """
        Backfill url_only_index.json by scanning existing jobs on disk.
        This keeps language-to-language translation working even for jobs created
        before url_only_index.json existed.
        """
        if not self.jobs_dir.exists():
            return

        changed = False
        for entry in self.jobs_dir.iterdir():
            if not entry.is_dir():
                continue
            job_path = entry / "job.json"
            data = read_json(job_path)
            if not isinstance(data, dict):
                continue
            url = str(data.get("url") or "").strip()
            job_id = str(data.get("id") or entry.name).strip()
            if not url or not job_id:
                continue

            normalized = _normalize_url(url)
            if not normalized:
                continue
            if normalized not in self._url_index:
                self._url_index[normalized] = []
                changed = True
            if job_id not in self._url_index[normalized]:
                self._url_index[normalized].append(job_id)
                changed = True

        if changed:
            write_json(self.url_only_index_path, self._url_index)

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

    def _thumbnail_path(self, job_id: str) -> Optional[Path]:
        media_dir = self._audio_dir(job_id)
        if not media_dir.exists():
            return None
        candidates = sorted(media_dir.glob("thumbnail.*"), key=lambda p: p.stat().st_mtime, reverse=True)
        return candidates[0] if candidates else None

    @staticmethod
    def _thumbnail_endpoint(job_id: str) -> str:
        return f"/api/jobs/{job_id}/thumbnail"

    def _cleanup_audio_files(self, job_id: str) -> None:
        """Remove audio files from the media folder to save space after job completion."""
        media_dir = self._audio_dir(job_id)
        if not media_dir.exists():
            return

        # Audio file extensions to remove
        audio_extensions = {".mp3", ".m4a", ".wav", ".opus", ".webm", ".ogg", ".aac", ".flac"}

        # Remove audio files in media folder
        for file_path in media_dir.iterdir():
            if file_path.is_file() and file_path.suffix.lower() in audio_extensions:
                with contextlib.suppress(Exception):
                    file_path.unlink()

        # Remove segments folder if it exists (contains split audio files)
        segments_dir = media_dir / "segments"
        if segments_dir.exists() and segments_dir.is_dir():
            with contextlib.suppress(Exception):
                shutil.rmtree(segments_dir)

    async def _cache_thumbnail(
        self,
        job_id: str,
        *,
        source_url: str,
        thumbnail_url: Optional[str],
        touch: bool = True,
    ) -> None:
        if not source_url:
            return
        existing = self._thumbnail_path(job_id)
        if existing:
            job = self._jobs.get(job_id) or self._load_job_from_disk(job_id)
            if job and job.video_thumbnail == self._thumbnail_endpoint(job_id):
                return
            await self.update(job_id, video_thumbnail=self._thumbnail_endpoint(job_id), touch=touch)
            return

        media_dir = self._audio_dir(job_id)
        media_dir.mkdir(parents=True, exist_ok=True)

        path = None
        if thumbnail_url:
            path = await asyncio.to_thread(download_thumbnail_from_url, url=thumbnail_url, out_dir=media_dir)
        if not path:
            path = await asyncio.to_thread(
                download_thumbnail,
                url=source_url,
                out_dir=media_dir,
                cookies_file=settings.ytdlp_cookies_file,
            )
        if path:
            await self.update(job_id, video_thumbnail=self._thumbnail_endpoint(job_id), touch=touch)

    def _load_job_from_disk(self, job_id: str) -> Optional[Job]:
        data = read_json(self._job_path(job_id))
        if not data:
            return None
        try:
            return Job.model_validate(data)
        except Exception:
            return None

    @staticmethod
    def _cache_key(url: str, output_language: str) -> str:
        return f"{_normalize_url(url)}||{(output_language or '').strip().lower() or 'ar'}"

    def _find_completed_job_for_url(self, url: str) -> Optional[Job]:
        """Find any completed job for the same URL (regardless of language)."""
        normalized = _normalize_url(url)
        job_ids = list(self._url_index.get(normalized, []))

        # Fallback: derive candidates from url_index.json (url+lang -> job_id) to support older installs
        # where url_only_index.json might be missing or incomplete.
        if not job_ids:
            prefix = f"{normalized}||"
            for k, v in self._index.items():
                if str(k).startswith(prefix):
                    job_ids.append(str(v))

        best: Optional[Job] = None
        for job_id in job_ids:
            job = self._jobs.get(job_id) or self._load_job_from_disk(job_id)
            if not job or job.status != "completed" or not job.report:
                continue
            is_analysis = not bool(getattr(job, "translate_from_job_id", None))
            best_is_analysis = best is not None and not bool(getattr(best, "translate_from_job_id", None))
            if best is None:
                best = job
                continue
            # Prefer full analysis jobs over translated ones; otherwise prefer the most recently updated.
            if is_analysis and not best_is_analysis:
                best = job
                continue
            if is_analysis == best_is_analysis and job.updated_at > best.updated_at:
                best = job
        return best

    def _update_url_index(self, url: str, job_id: str) -> None:
        """Add job_id to the URL-only index."""
        normalized = _normalize_url(url)
        if normalized not in self._url_index:
            self._url_index[normalized] = []
        if job_id not in self._url_index[normalized]:
            self._url_index[normalized].append(job_id)
        write_json(self.url_only_index_path, self._url_index)

    async def find_or_create(self, *, url: str, output_language: str, force: bool = False) -> tuple[Job, bool]:
        async with self._lock:
            cache_key = self._cache_key(url, output_language)
            lang = (output_language or "").strip().lower() or "ar"
            has_gemini_key = bool((getattr(settings, "gemini_api_key", "") or "").strip())

            # Check for exact match (same URL + same language)
            if not force:
                cached_id = self._index.get(cache_key)
                if cached_id:
                    cached_job = self._jobs.get(cached_id) or self._load_job_from_disk(cached_id)
                    if cached_job:
                        # If this is a translation job, ensure it's based on the latest completed run for this URL.
                        # Otherwise language switching can "stick" to an old translation even after a re-run.
                        if cached_job.translate_from_job_id and has_gemini_key:
                            latest = self._find_completed_job_for_url(url)
                            if cached_job.status != "failed" and latest and latest.id != cached_job.translate_from_job_id:
                                # Stale translation: fall through and create a new translation job from the latest run.
                                pass
                            else:
                                self._jobs[cached_id] = cached_job
                                return cached_job, True
                        else:
                            self._jobs[cached_id] = cached_job
                            return cached_job, True

            # If not forcing and no exact match, check if we have a completed report in another language
            # that we can translate instead of doing full analysis.
            translate_from_job: Optional[Job] = None
            if not force:
                existing_job = self._find_completed_job_for_url(url)
                if existing_job and existing_job.output_language != lang and has_gemini_key:
                    translate_from_job = existing_job

            job_id = uuid4().hex
            now = datetime.now(tz=timezone.utc)
            job = Job(
                id=job_id,
                url=url,
                output_language=lang,
                status="queued",
                created_at=now,
                updated_at=now,
                progress=0,
                translate_from_job_id=translate_from_job.id if translate_from_job else None,
            )
            self._jobs[job_id] = job
            write_model(self._job_path(job_id), job)
            self._index[cache_key] = job_id
            self._update_url_index(url, job_id)
            write_json(self.index_path, self._index)
            return job, False

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

    def thumbnail_path(self, job_id: str) -> Optional[Path]:
        return self._thumbnail_path(job_id)

    async def list_history(self, *, limit: int = 50) -> list[HistoryItem]:
        limit = max(1, min(int(limit or 50), 200))
        if not self.jobs_dir.exists():
            return []

        items: list[HistoryItem] = []
        for entry in self.jobs_dir.iterdir():
            if not entry.is_dir():
                continue
            job_path = entry / "job.json"
            data = read_json(job_path)
            if not isinstance(data, dict):
                continue

            report = data.get("report") if isinstance(data.get("report"), dict) else {}
            job_id = str(data.get("id") or entry.name)
            video_thumbnail = data.get("video_thumbnail")
            if self._thumbnail_path(job_id):
                video_thumbnail = self._thumbnail_endpoint(job_id)

            payload = {
                "id": job_id,
                "url": data.get("url"),
                "output_language": data.get("output_language") or "ar",
                "status": data.get("status"),
                "created_at": data.get("created_at"),
                "updated_at": data.get("updated_at"),
                "overall_score": report.get("overall_score"),
                "overall_verdict": report.get("overall_verdict"),
                "summary": report.get("summary"),
                "video_title": data.get("video_title"),
                "video_thumbnail": video_thumbnail,
            }
            try:
                items.append(HistoryItem.model_validate(payload))
            except Exception:
                continue

        items.sort(key=lambda x: x.updated_at, reverse=True)
        return items[:limit]

    async def delete_job(self, job_id: str) -> bool:
        task = None
        async with self._lock:
            task = self._tasks.get(job_id)
            if task and not task.done():
                task.cancel()
            self._running.discard(job_id)

        if task and not task.done():
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await task

        async with self._lock:
            job_dir = self._job_dir(job_id)
            if not job_dir.exists():
                return False

            # Remove in-memory cache
            self._jobs.pop(job_id, None)

            # Remove from url+lang index
            if self._index:
                self._index = {k: v for k, v in self._index.items() if v != job_id}
                write_json(self.index_path, self._index)

            # Remove from URL-only index
            if self._url_index:
                changed = False
                for url_key, ids in list(self._url_index.items()):
                    if job_id in ids:
                        ids = [x for x in ids if x != job_id]
                        if ids:
                            self._url_index[url_key] = ids
                        else:
                            self._url_index.pop(url_key, None)
                        changed = True
                if changed:
                    write_json(self.url_only_index_path, self._url_index)

            with contextlib.suppress(Exception):
                shutil.rmtree(job_dir)

            return True

    async def delete_all_history(self) -> int:
        tasks = []
        async with self._lock:
            tasks = list(self._tasks.values())
            for task in tasks:
                if task and not task.done():
                    task.cancel()
            self._running.clear()

        for task in tasks:
            if task and not task.done():
                with contextlib.suppress(asyncio.CancelledError, Exception):
                    await task

        async with self._lock:
            count = 0
            if self.jobs_dir.exists():
                for entry in self.jobs_dir.iterdir():
                    if not entry.is_dir():
                        continue
                    with contextlib.suppress(Exception):
                        shutil.rmtree(entry)
                        count += 1

            self._jobs.clear()
            self._index = {}
            self._url_index = {}
            self._tasks = {}
            write_json(self.index_path, self._index)
            write_json(self.url_only_index_path, self._url_index)
            return count

    async def update(self, job_id: str, *, touch: bool = True, **fields) -> None:
        async with self._lock:
            job = self._jobs.get(job_id) or self._load_job_from_disk(job_id)
            if not job:
                return
            if "updated_at" not in fields:
                fields["updated_at"] = datetime.now(tz=timezone.utc) if touch else job.updated_at
            updated = job.model_copy(update={**fields})
            self._jobs[job_id] = updated
            write_model(self._job_path(job_id), updated)

    async def ensure_metadata(self, job_id: str) -> None:
        job = await self.get(job_id)
        if not job or not (job.url or "").strip():
            return
        if job.status not in {"completed", "failed"}:
            return

        def has_text(value: Optional[str]) -> bool:
            return bool((value or "").strip())

        def is_local_thumbnail_for(check_job: Job, value: Optional[str]) -> bool:
            return bool(value) and str(value) == self._thumbnail_endpoint(check_job.id)

        def needs_thumbnail(check_job: Job) -> bool:
            if not has_text(check_job.video_thumbnail):
                return True
            if is_local_thumbnail_for(check_job, check_job.video_thumbnail) and not self._thumbnail_path(check_job.id):
                return True
            return False

        def job_ids_for_url(url: str) -> list[str]:
            normalized = _normalize_url(url)
            job_ids = list(self._url_index.get(normalized, []))
            if not job_ids:
                prefix = f"{normalized}||"
                for k, v in self._index.items():
                    if str(k).startswith(prefix):
                        job_ids.append(str(v))
            # De-dup while preserving order
            seen: set[str] = set()
            ordered: list[str] = []
            for jid in job_ids:
                if jid in seen:
                    continue
                seen.add(jid)
                ordered.append(jid)
            return ordered

        missing_title = not has_text(job.video_title)
        missing_thumb = needs_thumbnail(job)

        url_job_ids = job_ids_for_url(job.url)

        # Pull metadata from other jobs for this URL (prefers remote thumbnail URLs).
        fallback_title = None
        fallback_thumb_url = None
        for jid in url_job_ids:
            candidate = self._jobs.get(jid) or self._load_job_from_disk(jid)
            if not candidate:
                continue
            if not fallback_title and has_text(candidate.video_title):
                fallback_title = candidate.video_title
            if (
                not fallback_thumb_url
                and has_text(candidate.video_thumbnail)
                and not is_local_thumbnail_for(candidate, candidate.video_thumbnail)
            ):
                fallback_thumb_url = candidate.video_thumbnail
            if fallback_title and fallback_thumb_url:
                break

        # Prefer copying metadata from the source job for translation entries.
        if job.translate_from_job_id:
            source_job = await self.get(job.translate_from_job_id)
            updates = {}
            if source_job:
                if missing_title and has_text(source_job.video_title):
                    updates["video_title"] = source_job.video_title
                if missing_thumb and has_text(source_job.video_thumbnail):
                    updates["video_thumbnail"] = source_job.video_thumbnail
            if updates:
                await self.update(job.id, **updates, touch=False)
                job = await self.get(job.id) or job
                missing_title = not has_text(job.video_title)
                missing_thumb = needs_thumbnail(job)
                if not missing_title and not missing_thumb:
                    return

        updates = {}
        if missing_title and fallback_title:
            updates["video_title"] = fallback_title
        if missing_thumb and fallback_thumb_url:
            updates["video_thumbnail"] = fallback_thumb_url
        if updates:
            await self.update(job.id, **updates, touch=False)
            job = await self.get(job.id) or job
            missing_title = not has_text(job.video_title)
            missing_thumb = needs_thumbnail(job)
            if not missing_title and not missing_thumb:
                # Still backfill other jobs for this URL below.
                pass

        metadata = None
        if missing_title or missing_thumb:
            try:
                metadata = await asyncio.to_thread(
                    get_video_metadata,
                    url=job.url,
                    cookies_file=settings.ytdlp_cookies_file,
                )
            except Exception:
                metadata = None

        updates = {}
        if metadata:
            if missing_title and metadata.title:
                updates["video_title"] = metadata.title
            if missing_thumb and metadata.thumbnail:
                updates["video_thumbnail"] = metadata.thumbnail
        if updates:
            await self.update(job.id, **updates, touch=False)
            job = await self.get(job.id) or job
            missing_thumb = needs_thumbnail(job)

        if missing_thumb:
            await self._cache_thumbnail(
                job.id,
                source_url=job.url,
                thumbnail_url=metadata.thumbnail if metadata else None,
                touch=False,
            )

        # Backfill metadata for other history items sharing the same URL.
        best_title = None
        best_thumb_url = None
        if has_text(job.video_title):
            best_title = job.video_title
        if has_text(job.video_thumbnail) and not is_local_thumbnail_for(job, job.video_thumbnail):
            best_thumb_url = job.video_thumbnail
        if metadata:
            if metadata.title:
                best_title = metadata.title
            if metadata.thumbnail:
                best_thumb_url = metadata.thumbnail
        if fallback_title and not best_title:
            best_title = fallback_title
        if fallback_thumb_url and not best_thumb_url:
            best_thumb_url = fallback_thumb_url

        if best_title or best_thumb_url:
            for jid in url_job_ids:
                other = await self.get(jid)
                if not other or other.status not in {"completed", "failed"}:
                    continue
                other_updates = {}
                if best_title and not has_text(other.video_title):
                    other_updates["video_title"] = best_title
                if best_thumb_url and needs_thumbnail(other):
                    other_updates["video_thumbnail"] = best_thumb_url
                if other_updates:
                    await self.update(other.id, **other_updates, touch=False)

        # If we only have a local thumbnail file, copy it to other jobs that need one.
        if not best_thumb_url:
            source_thumb = self._thumbnail_path(job.id)
            if source_thumb:
                for jid in url_job_ids:
                    other = await self.get(jid)
                    if not other or other.id == job.id or other.status not in {"completed", "failed"}:
                        continue
                    if not needs_thumbnail(other):
                        continue
                    media_dir = self._audio_dir(other.id)
                    media_dir.mkdir(parents=True, exist_ok=True)
                    for existing in media_dir.glob("thumbnail.*"):
                        with contextlib.suppress(Exception):
                            existing.unlink()
                    dest = media_dir / source_thumb.name
                    try:
                        shutil.copy2(source_thumb, dest)
                        await self.update(other.id, video_thumbnail=self._thumbnail_endpoint(other.id), touch=False)
                    except Exception:
                        continue

    async def add_thought_summary(self, job_id: str, text: str) -> None:
        cleaned = (text or "").strip()
        if not cleaned:
            return

        async with self._lock:
            job = self._jobs.get(job_id) or self._load_job_from_disk(job_id)
            if not job:
                return

            summaries = list(job.thought_summaries or [])
            if summaries and summaries[-1].strip() == cleaned:
                return
            summaries.append(cleaned)

            updated = job.model_copy(update={"thought_summaries": summaries, "updated_at": datetime.now(tz=timezone.utc)})
            self._jobs[job_id] = updated
            write_model(self._job_path(job_id), updated)

    async def _fake_progress_fact_check(self, job_id: str) -> None:
        """
        Fake progress while the model is thinking during fact_checking:
        30->90 in 5min, 90->95 in next 5min, 95->99 in next 10min.
        """
        start = time.monotonic()
        while True:
            job = await self.get(job_id)
            if not job or job.status != "fact_checking":
                return

            elapsed = time.monotonic() - start
            if elapsed <= 300:
                target = 30 + (90 - 30) * (elapsed / 300)
            elif elapsed <= 600:
                target = 90 + (95 - 90) * ((elapsed - 300) / 300)
            elif elapsed <= 1200:
                target = 95 + (99 - 95) * ((elapsed - 600) / 600)
            else:
                target = 99

            target_i = int(round(target))
            target_i = max(30, min(99, target_i))
            if target_i > (job.progress or 0):
                await self.update(job_id, progress=target_i)

            await asyncio.sleep(2)

    async def _fake_progress_translation(self, job_id: str) -> None:
        """
        Fake progress for translation jobs: 0->95 in ~90s (<=2min), then hold.
        """
        start = time.monotonic()
        duration = 90.0
        while True:
            job = await self.get(job_id)
            if not job or job.status != "translating":
                return

            elapsed = time.monotonic() - start
            if elapsed >= duration:
                target = 95
            else:
                target = 95 * (elapsed / duration)

            target_i = int(round(target))
            target_i = max(0, min(95, target_i))
            if target_i > (job.progress or 0):
                await self.update(job_id, progress=target_i)

            await asyncio.sleep(1)

    async def run_pipeline(self, job_id: str) -> None:
        async with self._lock:
            if job_id in self._running:
                return
            self._running.add(job_id)
            task = asyncio.current_task()
            if task:
                self._tasks[job_id] = task

        job = await self.get(job_id)
        if not job:
            async with self._lock:
                self._running.discard(job_id)
            return

        try:
            # Check if this is a translation job
            if job.translate_from_job_id:
                await self._run_translation_pipeline(job)
            else:
                await self._run_full_pipeline(job)
        except DownloadError as e:
            error_msg = str(e)
            # Provide more helpful error for YouTube authentication issues
            if "Sign in to confirm" in error_msg or "cookies" in error_msg.lower():
                error_msg = "YouTube requires authentication. Please configure cookies in YTDLP_COOKIES_FILE environment variable. See: https://github.com/yt-dlp/yt-dlp/wiki/FAQ#how-do-i-pass-cookies-to-yt-dlp"
            await self.update(job.id, status="failed", progress=100, error=error_msg)
        except asyncio.CancelledError:
            # Allow deletion to cancel running jobs without additional writes.
            raise
        except Exception as e:
            await self.update(job.id, status="failed", progress=100, error=str(e))
        finally:
            async with self._lock:
                self._running.discard(job_id)
                self._tasks.pop(job_id, None)

    async def _run_translation_pipeline(self, job: Job) -> None:
        """Run translation-only pipeline: translate existing report to new language."""
        source_job = await self.get(job.translate_from_job_id)
        if not source_job or not source_job.report:
            raise ValueError(f"Source job {job.translate_from_job_id} not found or has no report")

        await self.update(job.id, status="translating", progress=0, error=None)
        fake_task = asyncio.create_task(self._fake_progress_translation(job.id))

        # Copy video metadata from source job
        if source_job.video_title or source_job.video_thumbnail:
            await self.update(
                job.id,
                video_title=source_job.video_title,
                video_thumbnail=source_job.video_thumbnail,
            )

        # Copy the transcript from source job
        transcript = source_job.transcript
        if not (transcript or "").strip():
            try:
                transcript = self._transcript_path(source_job.id).read_text(encoding="utf-8", errors="replace")
            except Exception:
                transcript = None
        if (transcript or "").strip():
            self._transcript_path(job.id).write_text(transcript, encoding="utf-8")
            await self.update(job.id, transcript=transcript)

        # Translate the report
        try:
            report, raw = await asyncio.to_thread(
                translate_report,
                report=source_job.report,
                target_language=job.output_language,
            )
            write_model(self._report_path(job.id), report)
            write_json(self._raw_response_path(job.id), raw)
            await self.update(job.id, status="completed", progress=100, report=report)
        finally:
            fake_task.cancel()
            with contextlib.suppress(Exception):
                await fake_task

    async def _run_full_pipeline(self, job: Job) -> None:
        """Run full analysis pipeline: download, transcribe, and fact-check."""
        audio_dir = self._audio_dir(job.id)

        transcript: Optional[str] = None
        metadata = None
        
        if is_youtube_url(job.url):
            await self.update(job.id, status="fetching_transcript", progress=5, error=None)
            # This single call fetches both transcript and metadata
            result = await asyncio.to_thread(
                get_youtube_transcript,
                url=job.url,
                out_dir=audio_dir,
                cookies_file=settings.ytdlp_cookies_file,
                prefer_original_language=True,
            )
            transcript = result.transcript
            metadata = result.metadata
            
            # Update metadata if available
            if metadata and (metadata.title or metadata.thumbnail):
                await self.update(
                    job.id,
                    video_title=metadata.title,
                    video_thumbnail=metadata.thumbnail,
                )
            if metadata and metadata.thumbnail:
                await self._cache_thumbnail(job.id, source_url=job.url, thumbnail_url=metadata.thumbnail)

        if not (transcript or "").strip():
            await self.update(job.id, status="downloading", progress=10, error=None)
            mp3_path = await asyncio.to_thread(
                download_mp3,
                url=job.url,
                out_dir=audio_dir,
                cookies_file=settings.ytdlp_cookies_file,
            )
            
            # For non-YouTube or if YouTube transcript failed, try to get metadata now
            if not metadata or not (metadata.title or metadata.thumbnail):
                try:
                    metadata = await asyncio.to_thread(
                        get_video_metadata,
                        url=job.url,
                        cookies_file=settings.ytdlp_cookies_file,
                    )
                    if metadata and (metadata.title or metadata.thumbnail):
                        await self.update(
                            job.id,
                            video_title=metadata.title,
                            video_thumbnail=metadata.thumbnail,
                        )
                except Exception:
                    pass  # Non-critical

            await self._cache_thumbnail(
                job.id,
                source_url=job.url,
                thumbnail_url=metadata.thumbnail if metadata else None,
            )

            await self.update(job.id, status="transcribing", progress=20)
            transcript = await asyncio.to_thread(transcribe_audio_mp3, mp3_path)

        self._transcript_path(job.id).write_text(transcript, encoding="utf-8")

        await self.update(job.id, status="fact_checking", progress=30, transcript=transcript, thought_summaries=[])
        fake_task = asyncio.create_task(self._fake_progress_fact_check(job.id))

        loop = asyncio.get_running_loop()
        output_lang = job.output_language or "en"

        def on_thought(text: str) -> None:
            # Translate thought to user's language if not English
            translated = translate_thought(text, output_lang) if output_lang != "en" else text
            asyncio.run_coroutine_threadsafe(self.add_thought_summary(job.id, translated), loop)

        try:
            report, raw = await asyncio.to_thread(
                fact_check_transcript_stream,
                transcript=transcript,
                url=job.url,
                output_language=job.output_language,
                on_thought=on_thought,
            )
            write_model(self._report_path(job.id), report)
            write_json(self._raw_response_path(job.id), raw)

            # Update URL index after successful completion
            self._update_url_index(job.url, job.id)

            # Clean up audio files to save space (transcript is already saved)
            self._cleanup_audio_files(job.id)

            await self.update(job.id, status="completed", progress=100, report=report)
        finally:
            fake_task.cancel()
            with contextlib.suppress(Exception):
                await fake_task


job_store = JobStore(settings.data_dir)
