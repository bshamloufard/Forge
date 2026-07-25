import hmac

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send

from forge_api.routers import (
    capabilities,
    checkpoints,
    datasets,
    deployments,
    health,
    projects,
    providers,
    runs,
    sampling,
    sessions,
    state,
    verifier,
)
from forge_api.settings import get_settings


class ApiV1AliasMiddleware:
    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http":
            path = str(scope.get("path", ""))
            if path == "/api/v1" or path.startswith("/api/v1/"):
                scope = {**scope, "path": path.removeprefix("/api")}
        await self.app(scope, receive, send)


class InternalApiAuthMiddleware:
    public_paths = frozenset({"/health", "/api/health"})

    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or str(scope.get("path", "")) in self.public_paths:
            await self.app(scope, receive, send)
            return

        settings = get_settings()
        expected_key = (settings.internal_api_key or "").strip()
        if not expected_key:
            if settings.app_env.strip().lower() == "production":
                response = JSONResponse(
                    {"detail": "Service authentication is not configured"},
                    status_code=503,
                )
                await response(scope, receive, send)
                return
            await self.app(scope, receive, send)
            return

        headers = {
            key.decode("latin-1").lower(): value.decode("latin-1")
            for key, value in scope.get("headers", [])
        }
        supplied_key = headers.get("x-forge-internal-key", "").strip()

        if not supplied_key or not hmac.compare_digest(supplied_key, expected_key):
            response = JSONResponse(
                {"detail": "Authentication required"},
                status_code=401,
            )
            await response(scope, receive, send)
            return

        await self.app(scope, receive, send)


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="Forge API",
        version="0.1.0",
        description="Python customer API for Forge training, sampling, checkpoint, deployment, and verifier primitives.",
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.add_middleware(ApiV1AliasMiddleware)
    app.add_middleware(InternalApiAuthMiddleware)
    app.include_router(health.router)
    app.include_router(state.router)
    app.include_router(capabilities.router)
    app.include_router(providers.router)
    app.include_router(projects.router)
    app.include_router(datasets.router)
    app.include_router(sessions.router)
    app.include_router(runs.router)
    app.include_router(sampling.router)
    app.include_router(checkpoints.router)
    app.include_router(deployments.router)
    app.include_router(verifier.router)
    return app


app = create_app()
