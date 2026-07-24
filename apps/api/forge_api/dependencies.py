from uuid import UUID

from fastapi import Depends, Header
from fastapi import HTTPException

from forge_api.services.credentials import RequestIdentity, settings_for_identity
from forge_api.services.store import StateRepository
from forge_api.settings import Settings, get_settings


def get_request_identity(
    user_id: str | None = Header(default=None, alias="X-Forge-User-Id"),
    user_email: str | None = Header(default=None, alias="X-Forge-User-Email"),
) -> RequestIdentity:
    if not user_id:
        if get_settings().app_env.strip().lower() == "production":
            raise HTTPException(status_code=401, detail="User identity is required")
        return RequestIdentity(user_id="local-default")

    try:
        canonical_user_id = str(UUID(user_id))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid user identity") from exc

    canonical_email = user_email.strip().lower() if user_email else None
    if canonical_email and len(canonical_email) > 320:
        raise HTTPException(status_code=400, detail="Invalid user email")

    return RequestIdentity(
        user_id=canonical_user_id,
        email=canonical_email,
        authenticated=True,
    )


def get_user_settings(
    identity: RequestIdentity = Depends(get_request_identity),
) -> Settings:
    return settings_for_identity(get_settings(), identity)


def get_repository(
    identity: RequestIdentity = Depends(get_request_identity),
) -> StateRepository:
    settings = settings_for_identity(get_settings(), identity)
    return StateRepository(settings, identity=identity)
