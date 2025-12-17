from __future__ import annotations

import asyncio
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from .config import settings
from .jobs import job_store
from .schemas import AnalyzeRequest, HistoryItem, Job
from .openai_pipeline import _is_gemini_model  # lightweight helper


app = FastAPI(title="Fact-Check Social Media", version="0.1.0")

# CORS middleware for browser extension support
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^(chrome-extension|moz-extension)://.*$",
    allow_origins=["http://localhost:8000", "http://127.0.0.1:8000"],
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

BASE_DIR = Path(__file__).resolve().parent
templates = Jinja2Templates(directory=str(BASE_DIR / "templates"))
app.mount("/static", StaticFiles(directory=str(BASE_DIR / "static")), name="static")

def _static_version() -> str:
    latest_mtime_ns = 0
    for filename in ("app.js", "styles.css"):
        try:
            st = (BASE_DIR / "static" / filename).stat()
            latest_mtime_ns = max(latest_mtime_ns, int(getattr(st, "st_mtime_ns", st.st_mtime * 1e9)))
        except FileNotFoundError:
            continue
    return str(latest_mtime_ns) if latest_mtime_ns else "0"


@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    response = templates.TemplateResponse(
        "index.html",
        {"request": request, "initial_job_id": "", "static_version": _static_version()},
    )
    response.headers["Cache-Control"] = "no-store"
    return response


@app.get("/r/{job_id}", response_class=HTMLResponse)
async def run_page(request: Request, job_id: str):
    # Per-run shareable page. The frontend will load job details via /api/jobs/{job_id}.
    response = templates.TemplateResponse(
        "index.html",
        {"request": request, "initial_job_id": job_id, "static_version": _static_version()},
    )
    response.headers["Cache-Control"] = "no-store"
    return response


@app.post("/api/analyze")
async def analyze(req: AnalyzeRequest):
    # Validate API keys based on chosen models (OpenAI vs Gemini).
    transcribe_model = (settings.transcribe_model or "").strip()
    factcheck_model = (settings.factcheck_model or "").strip()

    needs_openai = not _is_gemini_model(transcribe_model) or not _is_gemini_model(factcheck_model)
    needs_gemini = _is_gemini_model(transcribe_model) or _is_gemini_model(factcheck_model)

    if needs_openai and not settings.openai_api_key:
        raise HTTPException(status_code=400, detail="OPENAI_API_KEY is not set (required for the selected models).")
    if needs_gemini and not settings.gemini_api_key:
        raise HTTPException(status_code=400, detail="GEMINI_API_KEY is not set (required for the selected models).")

    job, cached = await job_store.find_or_create(url=req.url, output_language=req.output_language, force=req.force)

    # Translation jobs always need Gemini API key (uses Gemini Flash 2.5)
    if job.translate_from_job_id and not settings.gemini_api_key:
        raise HTTPException(status_code=400, detail="GEMINI_API_KEY is not set (required for translation).")

    if not req.force:
        if cached:
            asyncio.create_task(job_store.ensure_metadata(job.id))
        elif job.translate_from_job_id:
            asyncio.create_task(job_store.ensure_metadata(job.translate_from_job_id))

    if job.status not in {"completed", "failed"}:
        asyncio.create_task(job_store.run_pipeline(job.id))
    return {"job_id": job.id, "cached": cached, "is_translation": bool(job.translate_from_job_id)}


@app.get("/api/jobs/{job_id}", response_model=Job)
async def get_job(job_id: str):
    job = await job_store.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


@app.get("/api/jobs/{job_id}/thumbnail")
async def get_job_thumbnail(job_id: str):
    path = job_store.thumbnail_path(job_id)
    if not path or not path.exists():
        raise HTTPException(status_code=404, detail="Thumbnail not found")
    return FileResponse(path)


@app.get("/api/history", response_model=list[HistoryItem])
async def history(limit: int = 50):
    return await job_store.list_history(limit=limit)


@app.delete("/api/history/{job_id}")
async def delete_history_item(job_id: str):
    try:
        ok = await job_store.delete_job(job_id)
    except RuntimeError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e
    if not ok:
        raise HTTPException(status_code=404, detail="Job not found")
    return {"ok": True}


@app.delete("/api/history")
async def delete_history(all: bool = False):
    if not all:
        raise HTTPException(status_code=400, detail="Set all=true to delete all history.")
    try:
        count = await job_store.delete_all_history()
    except RuntimeError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e
    return {"ok": True, "deleted": count}


@app.get("/api/health")
async def health_check():
    """Health check endpoint for extension connectivity testing."""
    return {
        "status": "ok",
        "version": "0.1.0",
        "supported_platforms": ["youtube", "instagram", "tiktok", "twitter", "facebook"],
    }


@app.get("/api/config")
async def get_config():
    """Return extension configuration including supported languages."""
    languages = [
        {"code": "ar", "name": "Arabic", "rtl": True},
        {"code": "en", "name": "English", "rtl": False},
        {"code": "fr", "name": "French", "rtl": False},
        {"code": "bn", "name": "Bengali", "rtl": False},
        {"code": "zh", "name": "Chinese", "rtl": False},
        {"code": "cs", "name": "Czech", "rtl": False},
        {"code": "da", "name": "Danish", "rtl": False},
        {"code": "nl", "name": "Dutch", "rtl": False},
        {"code": "fi", "name": "Finnish", "rtl": False},
        {"code": "de", "name": "German", "rtl": False},
        {"code": "el", "name": "Greek", "rtl": False},
        {"code": "he", "name": "Hebrew", "rtl": True},
        {"code": "hi", "name": "Hindi", "rtl": False},
        {"code": "hu", "name": "Hungarian", "rtl": False},
        {"code": "id", "name": "Indonesian", "rtl": False},
        {"code": "it", "name": "Italian", "rtl": False},
        {"code": "ja", "name": "Japanese", "rtl": False},
        {"code": "ko", "name": "Korean", "rtl": False},
        {"code": "ms", "name": "Malay", "rtl": False},
        {"code": "no", "name": "Norwegian", "rtl": False},
        {"code": "fa", "name": "Persian", "rtl": True},
        {"code": "pl", "name": "Polish", "rtl": False},
        {"code": "pt", "name": "Portuguese", "rtl": False},
        {"code": "ro", "name": "Romanian", "rtl": False},
        {"code": "ru", "name": "Russian", "rtl": False},
        {"code": "es", "name": "Spanish", "rtl": False},
        {"code": "sw", "name": "Swahili", "rtl": False},
        {"code": "sv", "name": "Swedish", "rtl": False},
        {"code": "tl", "name": "Filipino (Tagalog)", "rtl": False},
        {"code": "th", "name": "Thai", "rtl": False},
        {"code": "tr", "name": "Turkish", "rtl": False},
        {"code": "uk", "name": "Ukrainian", "rtl": False},
        {"code": "ur", "name": "Urdu", "rtl": True},
        {"code": "vi", "name": "Vietnamese", "rtl": False},
    ]
    return {
        "poll_interval_ms": 2000,
        "supported_languages": languages,
        "default_language": "ar",
        "max_url_length": 2048,
    }
