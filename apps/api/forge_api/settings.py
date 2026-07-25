from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_env: str = Field(default="development", alias="APP_ENV")
    state_path: Path = Field(default=Path(".forge/python-state.json"), alias="FORGE_STATE_PATH")
    allowed_origins: str = Field(default="http://localhost:3000", alias="FORGE_ALLOWED_ORIGINS")
    internal_api_key: str | None = Field(default=None, alias="INTERNAL_API_KEY", repr=False)
    founder_email: str = Field(default="bshamloufard@berkeley.edu", alias="FORGE_FOUNDER_EMAIL")
    artifact_bucket: str = Field(default="checkpoints", alias="ARTIFACT_BUCKET")
    dataset_bucket: str = Field(default="datasets", alias="DATASET_BUCKET")

    supabase_url: str | None = Field(default=None, alias="SUPABASE_URL")
    supabase_secret_key: str | None = Field(default=None, alias="SUPABASE_SECRET_KEY", repr=False)
    supabase_service_role_key: str | None = Field(
        default=None,
        alias="SUPABASE_SERVICE_ROLE_KEY",
        repr=False,
    )

    modal_token_id: str | None = Field(default=None, alias="MODAL_TOKEN_ID", repr=False)
    modal_token_secret: str | None = Field(default=None, alias="MODAL_TOKEN_SECRET", repr=False)
    modal_app_name: str = Field(default="forge-mvp", alias="MODAL_APP_NAME")
    modal_environment: str = Field(default="main", alias="MODAL_ENVIRONMENT")
    forge_modal_worker_revision: str = Field(
        default="forge-worker-20260724.1",
        alias="FORGE_MODAL_WORKER_REVISION",
    )

    baseten_api_key: str | None = Field(default=None, alias="BASETEN_API_KEY", repr=False)
    baseten_base_url: str = Field(default="https://inference.baseten.co/v1", alias="BASETEN_BASE_URL")
    baseten_model_id: str = Field(default="zai-org/GLM-5.2-Fast", alias="BASETEN_MODEL_ID")
    baseten_default_model: str | None = Field(default=None, alias="BASETEN_DEFAULT_MODEL")
    baseten_deployment_wait: bool = Field(default=False, alias="BASETEN_DEPLOYMENT_WAIT")

    training_model_id: str = Field(default="sshleifer/tiny-gpt2", alias="FORGE_TRAINING_MODEL_ID")
    training_dataset_id: str = Field(default="Abirate/english_quotes", alias="FORGE_TRAINING_DATASET_ID")
    training_dataset_split: str = Field(default="train[:8]", alias="FORGE_TRAINING_DATASET_SPLIT")
    training_max_steps: int = Field(default=2, alias="FORGE_TRAINING_MAX_STEPS")
    training_max_rows: int = Field(default=256, alias="FORGE_TRAINING_MAX_ROWS")

    @property
    def cors_origins(self) -> list[str]:
        return [origin.strip() for origin in self.allowed_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
