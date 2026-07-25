from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile

from forge_api.dependencies import get_repository
from forge_api.models.requests import (
    CreateHuggingFaceDatasetRequest,
    UpdateDatasetAdapterRequest,
)
from forge_api.services.datasets import DatasetValidationError, MAX_UPLOAD_BYTES
from forge_api.services.store import StateRepository

router = APIRouter(tags=["datasets"])


@router.get("/v1/datasets")
@router.get("/api/datasets")
def get_datasets(repository: StateRepository = Depends(get_repository)) -> dict[str, object]:
    return {"datasets": [dataset.model_dump() for dataset in repository.read().datasets]}


@router.post("/v1/datasets/huggingface")
@router.post("/api/datasets/huggingface")
def create_huggingface_dataset(
    body: CreateHuggingFaceDatasetRequest,
    repository: StateRepository = Depends(get_repository),
) -> dict[str, object]:
    try:
        return _dump(
            repository.create_huggingface_dataset(
                name=body.name,
                reference=body.dataset,
                config=body.config,
                split=body.split,
                revision=body.revision,
                adapter=body.adapter,
            )
        )
    except DatasetValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/v1/datasets/upload")
@router.post("/api/datasets/upload")
async def upload_dataset(
    file: UploadFile = File(),
    name: str | None = Form(default=None),
    repository: StateRepository = Depends(get_repository),
) -> dict[str, object]:
    filename = file.filename or "dataset"
    try:
        payload = await file.read(MAX_UPLOAD_BYTES + 1)
        return _dump(
            repository.create_uploaded_dataset(
                name=name,
                filename=filename,
                content_type=file.content_type,
                payload=payload,
            )
        )
    except DatasetValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    finally:
        await file.close()


@router.post("/v1/datasets/{dataset_id}/adapter")
def update_dataset_adapter(
    dataset_id: str,
    body: UpdateDatasetAdapterRequest,
    repository: StateRepository = Depends(get_repository),
) -> dict[str, object]:
    try:
        return _dump(repository.update_dataset_adapter(dataset_id, body.adapter))
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except DatasetValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.delete("/v1/datasets/{dataset_id}")
def delete_dataset(
    dataset_id: str,
    repository: StateRepository = Depends(get_repository),
) -> dict[str, object]:
    try:
        return _dump(repository.delete_dataset(dataset_id))
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


def _dump(result: dict[str, object]) -> dict[str, object]:
    return {key: value.model_dump() if hasattr(value, "model_dump") else value for key, value in result.items()}
