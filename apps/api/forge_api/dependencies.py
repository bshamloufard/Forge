from forge_api.services.store import StateRepository
from forge_api.settings import get_settings


def get_repository() -> StateRepository:
    return StateRepository(get_settings())

