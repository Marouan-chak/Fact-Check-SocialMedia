# Fact-Check Social Media
End-to-end platform to fact-check social media video audio (Instagram, YouTube, X, etc.):
1) (YouTube) fetch captions via `yt-dlp` when available, otherwise download audio via `yt-dlp` → 2) transcribe (OpenAI or Gemini) → 3) fact-check (OpenAI or Gemini) + web search/grounding.

## Security note (important)
If you pasted an OpenAI API key into chat, assume it is compromised and **rotate it immediately** in the OpenAI dashboard.

## Prereqs
- Python 3.10–3.13 (avoid Python 3.14 beta – it has breaking changes)
- `ffmpeg` (required by `yt-dlp` for MP3 extraction when captions aren't available)
  - macOS: `brew install ffmpeg`

## Setup
```bash
python3.12 -m venv venv312
source venv312/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

## Run
```bash
uvicorn app.main:app --reload
```
Open `http://127.0.0.1:8000`.

## Features
- Output language selector (Arabic/English/French + more)
- Saved results per URL+language (submit the same URL again to reuse the last report)
- Optional re-run to overwrite the saved report
- History panel (shows previously analyzed videos)
- Supports many sites via `yt-dlp` (YouTube, Instagram, X/Twitter, etc.)
- Weighted scoring (central claims impact the score more than minor claims)
- Transcription provider switch via `TRANSCRIBE_MODEL`:
  - OpenAI: `gpt-4o-transcribe` (uses `OPENAI_API_KEY`)
  - Gemini: `gemini-2.5-flash`, `gemini-2.5-pro`, `gemini-3-pro-preview` (uses `GEMINI_API_KEY`)
- Fact-check provider switch via `FACTCHECK_MODEL`:
  - OpenAI: `gpt-5.2-2025-12-11` (uses `OPENAI_API_KEY`)
  - Gemini: `gemini-2.5-flash`, `gemini-2.5-pro`, `gemini-3-pro-preview` (uses `GEMINI_API_KEY`)

## Docker
```bash
export OPENAI_API_KEY=...
export GEMINI_API_KEY=... # only needed if TRANSCRIBE_MODEL is a Gemini model
docker compose up --build
```

## Notes
- Downloading content may be restricted by Instagram and/or violate terms for certain URLs. Use only content you have rights to access.
- For some reels you may need cookies (`YTDLP_COOKIES_FILE`).
- Long videos: audio is automatically chunked into 15-minute segments (configurable via `TRANSCRIBE_CHUNK_SECONDS`) and transcribed (optionally in parallel via `TRANSCRIBE_MAX_WORKERS`) before fact-checking.
