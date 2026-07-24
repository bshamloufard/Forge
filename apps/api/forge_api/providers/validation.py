from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

import httpx

from forge_api.settings import Settings


ProviderValidationStatus = Literal[
    "ready",
    "invalid",
    "unavailable",
    "conflict",
]

BASETEN_MANAGEMENT_MODELS_URL = "https://api.baseten.co/v1/models"
MODAL_PROVISION_TIMEOUT_SECONDS = 20 * 60
FORGE_MODAL_APP_NAME = "forge-mvp"


@dataclass(frozen=True)
class ProviderValidation:
    status: ProviderValidationStatus
    code: str
    message: str
    provisioned: bool = False

    @property
    def ready(self) -> bool:
        return self.status == "ready"

    def safe_dict(self) -> dict[str, str | bool]:
        return {
            "status": self.status,
            "code": self.code,
            "message": self.message,
            "provisioned": self.provisioned,
        }


def validate_baseten_api_key(api_key: str) -> ProviderValidation:
    """Verify management API access without invoking or creating a model."""
    sentinel_name = f"forge-credential-validation-{uuid.uuid4().hex}"
    try:
        with httpx.Client(
            timeout=httpx.Timeout(10.0),
            follow_redirects=False,
        ) as client:
            response = client.get(
                BASETEN_MANAGEMENT_MODELS_URL,
                params={"name": sentinel_name},
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Accept": "application/json",
                },
            )
    except httpx.RequestError:
        return ProviderValidation(
            status="unavailable",
            code="baseten_unavailable",
            message="Baseten could not be reached. Your existing key was not changed.",
        )

    if response.status_code == 200:
        try:
            payload = response.json()
        except ValueError:
            payload = None
        if isinstance(payload, dict) and isinstance(payload.get("models"), list):
            return ProviderValidation(
                status="ready",
                code="baseten_ready",
                message="Baseten management access verified.",
            )
        return ProviderValidation(
            status="unavailable",
            code="baseten_invalid_response",
            message="Baseten returned an unexpected response. Your existing key was not changed.",
        )

    if response.status_code in {401, 403}:
        return ProviderValidation(
            status="invalid",
            code="baseten_access_denied",
            message=(
                "This key is invalid, revoked, or lacks full Baseten management access. "
                "Use a personal key or a full-access team key."
            ),
        )
    if response.status_code == 402:
        return ProviderValidation(
            status="invalid",
            code="baseten_account_action_required",
            message="Baseten requires an account or billing action before this key can be used.",
        )
    if response.status_code == 429 or response.status_code >= 500:
        return ProviderValidation(
            status="unavailable",
            code="baseten_unavailable",
            message="Baseten is temporarily unavailable. Your existing key was not changed.",
        )
    return ProviderValidation(
        status="invalid",
        code="baseten_access_denied",
        message="Baseten did not accept this key for management access.",
    )


def validate_modal_credentials(
    settings: Settings,
    *,
    token_id: str,
    token_secret: str,
    environment: str,
) -> ProviderValidation:
    return _run_modal_child(
        settings,
        action="validate",
        token_id=token_id,
        token_secret=token_secret,
        environment=environment,
        timeout_seconds=30,
    )


def provision_modal_worker(
    settings: Settings,
    *,
    token_id: str,
    token_secret: str,
    environment: str,
) -> ProviderValidation:
    """Install or update Forge's reserved Modal worker in an isolated process.

    Modal's App, Image, and Volume handles retain hydration state. A fresh child
    process prevents one tenant's handles from ever being reused for another.
    """
    return _run_modal_child(
        settings,
        action="provision",
        token_id=token_id,
        token_secret=token_secret,
        environment=environment,
        timeout_seconds=MODAL_PROVISION_TIMEOUT_SECONDS,
    )


def _run_modal_child(
    settings: Settings,
    *,
    action: Literal["validate", "provision"],
    token_id: str,
    token_secret: str,
    environment: str,
    timeout_seconds: int,
) -> ProviderValidation:
    script_path = _modal_provision_script()
    if not script_path.is_file():
        return ProviderValidation(
            status="unavailable",
            code="modal_provisioner_unavailable",
            message="Forge's Modal setup service is temporarily unavailable.",
        )

    worker_root = script_path.parent
    request_payload = json.dumps(
        {
            "action": action,
            "token_id": token_id,
            "token_secret": token_secret,
            "app_name": FORGE_MODAL_APP_NAME,
            "environment": environment,
            "worker_revision": settings.forge_modal_worker_revision,
        }
    )
    try:
        with tempfile.TemporaryDirectory(prefix="forge-modal-config-") as config_dir:
            config_path = Path(config_dir) / "modal.toml"
            config_path.touch(mode=0o600)
            child_environment = _modal_child_environment(
                worker_root=worker_root,
                config_path=config_path,
            )
            completed = subprocess.run(
                [sys.executable, str(script_path)],
                input=request_payload,
                text=True,
                capture_output=True,
                cwd=str(worker_root),
                env=child_environment,
                timeout=timeout_seconds,
                check=False,
            )
    except subprocess.TimeoutExpired:
        return ProviderValidation(
            status="unavailable",
            code="modal_provision_timeout",
            message="Modal setup took too long. Retry in a moment.",
        )
    except OSError:
        return ProviderValidation(
            status="unavailable",
            code="modal_provisioner_unavailable",
            message="Forge could not start the Modal installer.",
        )

    payload = _modal_result_from_output(completed.stdout)
    if completed.returncode != 0 or payload is None:
        return ProviderValidation(
            status="unavailable",
            code="modal_provision_failed",
            message="Modal setup did not complete. Retry in a moment.",
        )

    status = payload.get("status")
    code = payload.get("code")
    message = payload.get("message")
    provisioned = payload.get("provisioned", False)
    if (
        status not in {"ready", "invalid", "unavailable", "conflict"}
        or not isinstance(code, str)
        or not isinstance(message, str)
        or not isinstance(provisioned, bool)
    ):
        return ProviderValidation(
            status="unavailable",
            code="modal_invalid_response",
            message="Modal setup returned an unexpected response.",
        )

    return ProviderValidation(
        status=status,
        code=code,
        message=message,
        provisioned=provisioned,
    )


def _modal_child_environment(
    *,
    worker_root: Path,
    config_path: Path,
) -> dict[str, str]:
    child_environment: dict[str, str] = {
        "PYTHONPATH": str(worker_root),
        "MODAL_CONFIG_PATH": str(config_path),
        "MODAL_SERVER_URL": "https://api.modal.com",
        "MODAL_LOGLEVEL": "ERROR",
    }
    for key in (
        "PATH",
        "LANG",
        "LC_ALL",
        "SSL_CERT_FILE",
        "SSL_CERT_DIR",
    ):
        value = os.environ.get(key)
        if value:
            child_environment[key] = value
    return child_environment


def _modal_provision_script() -> Path:
    repository_root = Path(__file__).resolve().parents[4]
    return repository_root / "workers" / "modal" / "provision.py"


def _modal_result_from_output(output: str) -> dict[str, object] | None:
    prefix = "FORGE_MODAL_RESULT="
    for line in reversed(output.splitlines()):
        if not line.startswith(prefix):
            continue
        try:
            payload = json.loads(line.removeprefix(prefix))
        except ValueError:
            return None
        return payload if isinstance(payload, dict) else None
    return None

