from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.types import ASGIApp, Receive, Scope, Send

from forge_api.routers import capabilities, checkpoints, deployments, health, projects, runs, sampling, sessions, state, verifier
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
    app.include_router(health.router)
    app.include_router(state.router)
    app.include_router(capabilities.router)
    app.include_router(projects.router)
    app.include_router(sessions.router)
    app.include_router(runs.router)
    app.include_router(sampling.router)
    app.include_router(checkpoints.router)
    app.include_router(deployments.router)
    app.include_router(verifier.router)
    return app


app = create_app()
