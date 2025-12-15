from __future__ import annotations

import asyncio
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from .config import settings
from .jobs import job_store
from .schemas import AnalyzeRequest, HistoryItem, Job
from .openai_pipeline import _is_gemini_model  # lightweight helper


app = FastAPI(title="Fact-Check Social Media", version="0.1.0")

BASE_DIR = Path(__file__).resolve().parent
templates = Jinja2Templates(directory=str(BASE_DIR / "templates"))
app.mount("/static", StaticFiles(directory=str(BASE_DIR / "static")), name="static")


@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})


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
    if job.status not in {"completed", "failed"}:
        asyncio.create_task(job_store.run_pipeline(job.id))
    return {"job_id": job.id, "cached": cached}


@app.get("/api/jobs/{job_id}", response_model=Job)
async def get_job(job_id: str):
    job = await job_store.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


@app.get("/api/history", response_model=list[HistoryItem])
async def history(limit: int = 50):
    return await job_store.list_history(limit=limit)
