from __future__ import annotations

from pathlib import Path
from typing import Optional

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    openai_api_key: str = ""
    gemini_api_key: str = ""

    data_dir: Path = Path("data")
    ytdlp_cookies_file: Optional[Path] = None

    transcribe_model: str = "gpt-4o-transcribe"
    transcribe_chunk_seconds: int = 900  # 15 minutes
    transcribe_max_workers: int = 3
    factcheck_model: str = "gpt-5.2-2025-12-11"
    factcheck_thinking_level: Optional[str] = None

    @field_validator("ytdlp_cookies_file", mode="before")
    @classmethod
    def _empty_str_to_none(cls, v):
        if v is None:
            return None
        if isinstance(v, str) and not v.strip():
            return None
        return v


settings = Settings()
