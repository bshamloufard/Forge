from time import time
from uuid import uuid4


def create_id(prefix: str) -> str:
    millis = int(time() * 1000)
    return f"{prefix}_{millis:x}_{uuid4().hex[:6]}"

