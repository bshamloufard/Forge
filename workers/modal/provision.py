from __future__ import annotations

import json
import sys
from typing import Any

import modal


RESULT_PREFIX = "FORGE_MODAL_RESULT="
REQUIRED_FUNCTIONS = (
    "run_tiny_finetune",
    "deploy_checkpoint_to_baseten",
    "deactivate_baseten_deployment",
    "delete_baseten_model",
    "delete_checkpoint_artifact",
)
VOLUME_NAME = "forge-checkpoints"


def main() -> None:
    request = _read_request()
    if request is None:
        _emit(
            status="invalid",
            code="modal_invalid_request",
            message="Modal setup details were incomplete.",
        )
        return

    client = None
    try:
        client = modal.Client.from_credentials(
            request["token_id"],
            request["token_secret"],
        )
        client.hello()
    except (modal.exception.AuthError, modal.exception.PermissionDeniedError):
        _emit(
            status="invalid",
            code="modal_access_denied",
            message="Modal rejected these credentials or they lack workspace access.",
        )
        _close_client(client)
        return
    except (
        modal.exception.ConnectionError,
        modal.exception.ServiceError,
        modal.exception.TimeoutError,
    ):
        _emit(
            status="unavailable",
            code="modal_unavailable",
            message="Modal is temporarily unavailable. Your existing configuration was not changed.",
        )
        _close_client(client)
        return
    except Exception:
        _emit(
            status="unavailable",
            code="modal_connection_failed",
            message="Forge could not verify these Modal credentials.",
        )
        _close_client(client)
        return

    if request["action"] == "validate":
        try:
            modal.Environment.from_name(
                request["environment"],
                client=client,
                create_if_missing=False,
            ).hydrate()
        except modal.exception.NotFoundError:
            _emit(
                status="invalid",
                code="modal_environment_missing",
                message="That Modal environment does not exist in this workspace.",
            )
        except modal.exception.InvalidError:
            _emit(
                status="invalid",
                code="modal_invalid_configuration",
                message="The Modal environment name is invalid.",
            )
        else:
            _emit(
                status="ready",
                code="modal_credentials_valid",
                message="Modal workspace and environment access verified.",
            )
        _close_client(client)
        return

    try:
        from forge_modal.app import app

        app.deploy(
            name=request["app_name"],
            environment_name=request["environment"],
            client=client,
            tag=request["worker_revision"],
            strategy="rolling",
        )
        if not _hydrate_required_resources(
            client,
            app_name=request["app_name"],
            environment=request["environment"],
        ):
            _emit(
                status="unavailable",
                code="modal_postcheck_failed",
                message="The Forge Modal worker was installed but could not be verified.",
            )
            return
        _emit(
            status="ready",
            code="modal_ready",
            message="Modal verified and the Forge worker was installed or updated.",
            provisioned=True,
        )
    except (modal.exception.AuthError, modal.exception.PermissionDeniedError):
        _emit(
            status="invalid",
            code="modal_deploy_access_denied",
            message="This Modal token can sign in but cannot install the Forge worker.",
        )
    except modal.exception.InvalidError:
        _emit(
            status="invalid",
            code="modal_invalid_configuration",
            message="The Modal environment or worker configuration is invalid.",
        )
    except (
        modal.exception.ConnectionError,
        modal.exception.ResourceExhaustedError,
        modal.exception.ServiceError,
        modal.exception.TimeoutError,
    ):
        _emit(
            status="unavailable",
            code="modal_unavailable",
            message="Modal setup is temporarily unavailable. Your existing configuration was not changed.",
        )
    except Exception:
        _emit(
            status="unavailable",
            code="modal_provision_failed",
            message="Forge could not install or verify the Modal worker.",
        )
    finally:
        _close_client(client)


def _read_request() -> dict[str, str] | None:
    try:
        payload = json.load(sys.stdin)
    except (ValueError, OSError):
        return None
    if not isinstance(payload, dict):
        return None

    result: dict[str, str] = {}
    for key in (
        "action",
        "token_id",
        "token_secret",
        "app_name",
        "environment",
        "worker_revision",
    ):
        value = payload.get(key)
        if not isinstance(value, str) or not value.strip():
            return None
        result[key] = value.strip()
    if result["action"] not in {"validate", "provision"}:
        return None
    return result


def _hydrate_required_resources(
    client: Any,
    *,
    app_name: str,
    environment: str,
) -> bool:
    try:
        for function_name in REQUIRED_FUNCTIONS:
            modal.Function.from_name(
                app_name,
                function_name,
                environment_name=environment,
                client=client,
            ).hydrate()
        modal.Volume.from_name(
            VOLUME_NAME,
            environment_name=environment,
            client=client,
            create_if_missing=False,
        ).hydrate()
    except modal.exception.NotFoundError:
        return False
    return True


def _emit(
    *,
    status: str,
    code: str,
    message: str,
    provisioned: bool = False,
) -> None:
    print(
        RESULT_PREFIX
        + json.dumps(
            {
                "status": status,
                "code": code,
                "message": message,
                "provisioned": provisioned,
            },
            separators=(",", ":"),
        )
    )


def _close_client(client: Any) -> None:
    if client is None:
        return
    try:
        if not client.is_closed():
            client.__exit__(None, None, None)
    except Exception:
        pass


if __name__ == "__main__":
    main()
