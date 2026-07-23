from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_env: str = Field(default="development", alias="APP_ENV")
    state_path: Path = Field(default=Path(".forge/python-state.json"), alias="FORGE_STATE_PATH")
    allowed_origins: str = Field(default="http://localhost:3000", alias="FORGE_ALLOWED_ORIGINS")

    supabase_url: str | None = Field(default=None, alias="SUPABASE_URL")
    supabase_secret_key: str | None = Field(default=None, alias="SUPABASE_SECRET_KEY")
    supabase_service_role_key: str | None = Field(default=None, alias="SUPABASE_SERVICE_ROLE_KEY")

    modal_token_id: str | None = Field(default=None, alias="MODAL_TOKEN_ID")
    modal_token_secret: str | None = Field(default=None, alias="MODAL_TOKEN_SECRET")
    modal_app_name: str = Field(default="forge-mvp", alias="MODAL_APP_NAME")
    modal_environment: str = Field(default="main", alias="MODAL_ENVIRONMENT")

    baseten_api_key: str | None = Field(default=None, alias="BASETEN_API_KEY")
    baseten_base_url: str = Field(default="https://inference.baseten.co/v1", alias="BASETEN_BASE_URL")

    @property
    def cors_origins(self) -> list[str]:
        return [origin.strip() for origin in self.allowed_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()

