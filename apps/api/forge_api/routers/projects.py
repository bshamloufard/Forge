from fastapi import APIRouter, Depends

from forge_api.dependencies import get_repository
from forge_api.services.store import StateRepository

router = APIRouter(prefix="/v1/projects", tags=["projects"])


@router.get("")
def get_projects(repository: StateRepository = Depends(get_repository)) -> dict[str, object]:
    return {"projects": [repository.read().project.model_dump()]}

