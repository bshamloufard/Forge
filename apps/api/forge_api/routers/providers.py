from __future__ import annotations

import json
import re
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Request
from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    SecretStr,
    ValidationError,
    field_validator,
    model_validator,
)
from starlette.concurrency import run_in_threadpool
from starlette.responses import JSONResponse

from forge_api.dependencies import get_request_identity
from forge_api.providers.validation import (
    ProviderValidation,
    provision_modal_worker,
    validate_baseten_api_key,
    validate_modal_credentials,
)
from forge_api.services.credentials import (
    ProviderConfigurationConflict,
    ProviderConfigurationStoreError,
    RequestIdentity,
    begin_modal_provisioning,
    finish_modal_provisioning,
    provider_configuration_for_setup,
    save_validated_provider_configuration,
)
from forge_api.settings import Settings, get_settings


router = APIRouter(prefix="/v1/providers", tags=["providers"])

ProviderSecret = Annotated[SecretStr, Field(min_length=1, max_length=16_384)]
ModalEnvironment = Annotated[
    str,
    Field(
        min_length=2,
        max_length=64,
        pattern=r"^[A-Za-z0-9][A-Za-z0-9._-]+$",
    ),
]
BasetenModel = Annotated[
    str,
    Field(
        min_length=1,
        max_length=512,
        pattern=r"^[A-Za-z0-9._:/-]+$",
    ),
]


class ProviderConfigurationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    modal_token_id: ProviderSecret | None = None
    modal_token_secret: ProviderSecret | None = None
    modal_environment: ModalEnvironment | None = None
    baseten_api_key: ProviderSecret | None = None
    baseten_model_id: BasetenModel | None = None

    @field_validator(
        "modal_token_id",
        "modal_token_secret",
        "baseten_api_key",
    )
    @classmethod
    def validate_secret_transport(
        cls,
        value: SecretStr | None,
    ) -> SecretStr | None:
        if value is None:
            return None
        plaintext = value.get_secret_value()
        if (
            plaintext != plaintext.strip()
            or not re.fullmatch(r"[\x21-\x7e]+", plaintext)
        ):
            raise ValueError("Provider credentials must use visible ASCII characters")
        return value

    @field_validator("modal_environment")
    @classmethod
    def validate_environment(
        cls,
        value: str | None,
    ) -> str | None:
        if value and value.lower().startswith("en-"):
            raise ValueError("Modal environment names cannot start with en-")
        return value

    @model_validator(mode="after")
    def validate_request(self) -> "ProviderConfigurationRequest":
        if (self.modal_token_id is None) != (self.modal_token_secret is None):
            raise ValueError("Modal token ID and token secret must be supplied together")
        if not self.modal_requested and not self.baseten_requested:
            raise ValueError("At least one provider change is required")
        return self

    @property
    def modal_requested(self) -> bool:
        return any(
            value is not None
            for value in (
                self.modal_token_id,
                self.modal_token_secret,
                self.modal_environment,
            )
        )

    @property
    def baseten_requested(self) -> bool:
        return self.baseten_api_key is not None or self.baseten_model_id is not None


@router.post("/configure")
async def configure_providers(
    raw_request: Request,
    identity: RequestIdentity = Depends(get_request_identity),
) -> JSONResponse:
    request = await _read_configuration_request(raw_request)
    if isinstance(request, JSONResponse):
        return request

    settings = get_settings()
    try:
        snapshot = await run_in_threadpool(
            provider_configuration_for_setup,
            settings,
            identity,
        )
    except ProviderConfigurationStoreError:
        return _store_unavailable_response()

    baseten_result: ProviderValidation | None = None
    modal_result: ProviderValidation | None = None

    baseten_api_key = _secret_value(request.baseten_api_key)
    if baseten_api_key is not None:
        baseten_result = await run_in_threadpool(
            validate_baseten_api_key,
            baseten_api_key,
        )
        if not baseten_result.ready:
            return _validation_failure_response(
                baseten_result,
                field="basetenApiKey",
            )

    candidate_modal_token_id = (
        _secret_value(request.modal_token_id)
        if request.modal_token_id is not None
        else snapshot.settings.modal_token_id
    )
    candidate_modal_token_secret = (
        _secret_value(request.modal_token_secret)
        if request.modal_token_secret is not None
        else snapshot.settings.modal_token_secret
    )
    candidate_modal_environment = (
        request.modal_environment
        or snapshot.settings.modal_environment
    )

    if request.modal_requested:
        if not candidate_modal_token_id or not candidate_modal_token_secret:
            modal_result = ProviderValidation(
                status="invalid",
                code="modal_credentials_missing",
                message="Enter a Modal token ID and token secret before changing Modal settings.",
            )
        else:
            modal_result = await run_in_threadpool(
                validate_modal_credentials,
                settings,
                token_id=candidate_modal_token_id,
                token_secret=candidate_modal_token_secret,
                environment=candidate_modal_environment,
            )
        if not modal_result.ready:
            return _validation_failure_response(
                modal_result,
                field=(
                    "modalEnvironment"
                    if "environment" in modal_result.code
                    else "modalTokenSecret"
                ),
            )

    try:
        modal_generation, _ = await run_in_threadpool(
            save_validated_provider_configuration,
            settings,
            identity,
            snapshot,
            update_modal=request.modal_requested,
            update_baseten=request.baseten_requested,
            modal_token_id=(
                candidate_modal_token_id
                if request.modal_requested
                else None
            ),
            modal_token_secret=(
                candidate_modal_token_secret
                if request.modal_requested
                else None
            ),
            modal_environment=(
                candidate_modal_environment
                if request.modal_requested
                else None
            ),
            baseten_api_key=baseten_api_key,
            baseten_model_id=request.baseten_model_id,
            modal_credentials_validated=bool(
                modal_result and modal_result.ready
            ),
            baseten_credentials_validated=bool(
                baseten_result and baseten_result.ready
            ),
        )
    except ProviderConfigurationConflict:
        return _json_response(
            {
                "error": "Provider settings changed in another request. Retry with the latest configuration.",
            },
            status_code=409,
        )
    except ProviderConfigurationStoreError:
        return _store_unavailable_response()

    if request.modal_requested:
        modal_result = await _provision_modal(
            settings,
            identity,
            generation=modal_generation,
            token_id=candidate_modal_token_id or "",
            token_secret=candidate_modal_token_secret or "",
            environment=candidate_modal_environment,
        )

    return _json_response(
        {
            "saved": True,
            "modal": modal_result.safe_dict() if modal_result else None,
            "baseten": baseten_result.safe_dict() if baseten_result else None,
        }
    )


@router.post("/modal/provision")
async def retry_modal_provisioning(
    identity: RequestIdentity = Depends(get_request_identity),
) -> JSONResponse:
    settings = get_settings()
    try:
        snapshot = await run_in_threadpool(
            provider_configuration_for_setup,
            settings,
            identity,
        )
    except ProviderConfigurationStoreError:
        return _store_unavailable_response()

    token_id = snapshot.settings.modal_token_id
    token_secret = snapshot.settings.modal_token_secret
    if not token_id or not token_secret:
        return _json_response(
            {"error": "Modal credentials have not been saved."},
            status_code=409,
        )

    if snapshot.modal_connection_state != "valid":
        validation = await run_in_threadpool(
            validate_modal_credentials,
            settings,
            token_id=token_id,
            token_secret=token_secret,
            environment=snapshot.settings.modal_environment,
        )
        if not validation.ready:
            return _validation_failure_response(
                validation,
                field="modalTokenSecret",
            )
        try:
            modal_generation, _ = await run_in_threadpool(
                save_validated_provider_configuration,
                settings,
                identity,
                snapshot,
                update_modal=True,
                update_baseten=False,
                modal_token_id=token_id,
                modal_token_secret=token_secret,
                modal_environment=snapshot.settings.modal_environment,
                baseten_api_key=None,
                baseten_model_id=None,
                modal_credentials_validated=True,
                baseten_credentials_validated=False,
            )
        except ProviderConfigurationConflict:
            return _json_response(
                {"error": "Modal settings changed. Refresh and retry."},
                status_code=409,
            )
        except ProviderConfigurationStoreError:
            return _store_unavailable_response()
    else:
        modal_generation = snapshot.modal_generation

    result = await _provision_modal(
        settings,
        identity,
        generation=modal_generation,
        token_id=token_id,
        token_secret=token_secret,
        environment=snapshot.settings.modal_environment,
    )
    status_code = 200 if result.ready else 409
    return _json_response(
        {"modal": result.safe_dict()},
        status_code=status_code,
    )


async def _provision_modal(
    settings: Settings,
    identity: RequestIdentity,
    *,
    generation: int,
    token_id: str,
    token_secret: str,
    environment: str,
) -> ProviderValidation:
    lease_id = str(uuid.uuid4())
    try:
        began = await run_in_threadpool(
            begin_modal_provisioning,
            settings,
            identity,
            generation=generation,
            lease_id=lease_id,
        )
    except ProviderConfigurationStoreError:
        return ProviderValidation(
            status="unavailable",
            code="modal_state_unavailable",
            message="Modal credentials were saved, but setup state could not be started.",
        )

    if not began:
        return ProviderValidation(
            status="unavailable",
            code="modal_setup_in_progress",
            message="Modal setup is already running or the configuration changed. Refresh shortly.",
        )

    result = await run_in_threadpool(
        provision_modal_worker,
        settings,
        token_id=token_id,
        token_secret=token_secret,
        environment=environment,
    )
    try:
        recorded = await run_in_threadpool(
            finish_modal_provisioning,
            settings,
            identity,
            generation=generation,
            lease_id=lease_id,
            ready=result.ready,
            error_code=None if result.ready else result.code,
        )
    except ProviderConfigurationStoreError:
        recorded = False

    if not recorded:
        return ProviderValidation(
            status="conflict",
            code="modal_setup_result_stale",
            message="Modal setup finished, but the saved configuration changed. Refresh to see the latest state.",
            provisioned=result.provisioned,
        )
    return result


async def _read_configuration_request(
    raw_request: Request,
) -> ProviderConfigurationRequest | JSONResponse:
    try:
        content_length = int(raw_request.headers.get("content-length", "0"))
    except ValueError:
        content_length = 0
    if content_length > 65_536:
        return _json_response(
            {"error": "Provider configuration is too large."},
            status_code=413,
        )

    try:
        raw_body = await raw_request.body()
        if len(raw_body) > 65_536:
            return _json_response(
                {"error": "Provider configuration is too large."},
                status_code=413,
            )
        return ProviderConfigurationRequest.model_validate(
            json.loads(raw_body)
        )
    except (UnicodeDecodeError, ValueError, ValidationError):
        # FastAPI's default validation response includes rejected input values.
        # Provider candidates are secrets, so return only a fixed safe message.
        return _json_response(
            {"error": "Provider configuration fields are invalid."},
            status_code=400,
        )


def _validation_failure_response(
    result: ProviderValidation,
    *,
    field: str,
) -> JSONResponse:
    status_code = 503 if result.status == "unavailable" else 400
    return _json_response(
        {
            "error": result.message,
            "field": field,
            "result": result.safe_dict(),
        },
        status_code=status_code,
    )


def _store_unavailable_response() -> JSONResponse:
    return _json_response(
        {
            "error": "Provider settings are temporarily unavailable. No saved configuration was changed.",
        },
        status_code=503,
    )


def _secret_value(value: SecretStr | None) -> str | None:
    return value.get_secret_value() if value is not None else None


def _json_response(
    content: dict[str, object],
    *,
    status_code: int = 200,
) -> JSONResponse:
    return JSONResponse(
        content,
        status_code=status_code,
        headers={
            "Cache-Control": "private, no-cache, no-store, must-revalidate",
            "Pragma": "no-cache",
        },
    )
