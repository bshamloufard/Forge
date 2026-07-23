from fastapi import APIRouter, Depends

from forge_api.providers.health import get_provider_health
from forge_api.recipes import models, recipes
from forge_api.settings import Settings, get_settings

router = APIRouter(prefix="/v1/capabilities", tags=["capabilities"])


@router.get("")
def get_capabilities(settings: Settings = Depends(get_settings)) -> dict[str, object]:
    return {
        "models": models,
        "recipes": recipes,
        "losses": ["cross_entropy", "importance_sampling", "ppo", "cispo", "dro", "custom_logprob"],
        "providers": get_provider_health(settings).model_dump(),
        "deploymentTargets": ["baseten", "modal"],
        "verifierBackends": ["heuristic", "openai_logprobs", "gemini_logprobs", "vllm_logprobs"],
        "primitives": ["forward_backward", "optim_step", "sample", "save_state", "verify", "rank", "score_trajectory"],
    }

