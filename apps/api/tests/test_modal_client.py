from __future__ import annotations

import sys
from types import SimpleNamespace

import pytest

from forge_api.models.domain import Dataset, DatasetAdapter
from forge_api.providers.modal_client import run_tiny_finetune
from forge_api.settings import Settings


class FakeClient:
    def __init__(self) -> None:
        self.closed = False
        self.entered = False

    def __enter__(self):
        self.entered = True
        raise AssertionError("an already-open Modal client must not be entered")

    def __exit__(self, exc_type, exc, traceback):
        self.closed = True

    def is_closed(self) -> bool:
        return self.closed


class FakeFunction:
    def __init__(self, *, should_fail: bool = False) -> None:
        self.should_fail = should_fail
        self.last_kwargs = None

    def remote(self, **kwargs):
        self.last_kwargs = kwargs
        if self.should_fail:
            raise RuntimeError("remote call failed")
        return {"run_id": kwargs["run_id"]}


@pytest.mark.parametrize("should_fail", [False, True])
def test_request_scoped_modal_client_is_not_reopened_and_is_closed(
    monkeypatch,
    should_fail: bool,
):
    client = FakeClient()
    function = FakeFunction(should_fail=should_fail)

    class ClientFactory:
        @staticmethod
        def from_credentials(token_id: str, token_secret: str):
            assert token_id == "token-id"
            assert token_secret == "token-secret"
            return client

    class FunctionFactory:
        @staticmethod
        def from_name(
            app_name: str,
            function_name: str,
            *,
            environment_name: str,
            client: FakeClient,
        ):
            assert app_name == "forge-mvp"
            assert function_name == "run_tiny_finetune"
            assert environment_name == "main"
            assert client is not None
            return function

    monkeypatch.setitem(
        sys.modules,
        "modal",
        SimpleNamespace(Client=ClientFactory, Function=FunctionFactory),
    )
    settings = Settings(
        MODAL_TOKEN_ID="token-id",
        MODAL_TOKEN_SECRET="token-secret",
    )

    if should_fail:
        with pytest.raises(RuntimeError, match="remote call failed"):
            run_tiny_finetune(settings, run_id="run-1")
    else:
        assert run_tiny_finetune(settings, run_id="run-1") == {
            "run_id": "run-1"
        }

    assert client.entered is False
    assert client.closed is True


def test_dataset_selection_is_forwarded_to_modal(monkeypatch):
    client = FakeClient()
    function = FakeFunction()

    class ClientFactory:
        @staticmethod
        def from_credentials(token_id: str, token_secret: str):
            return client

    class FunctionFactory:
        @staticmethod
        def from_name(*args, **kwargs):
            return function

    monkeypatch.setitem(
        sys.modules,
        "modal",
        SimpleNamespace(Client=ClientFactory, Function=FunctionFactory),
    )
    dataset = Dataset(
        id="dset_custom",
        projectId="proj_default",
        name="Custom data",
        sourceType="upload",
        sourceUri="upload://custom.csv",
        sourceSplit="train",
        fileName="custom.csv",
        status="ready",
        adapter=DatasetAdapter(
            format="prompt_response",
            promptField="ask",
            responseField="say",
        ),
        columns=["ask", "say"],
        createdAt="2026-07-25T00:00:00Z",
        updatedAt="2026-07-25T00:00:00Z",
    )
    settings = Settings(
        MODAL_TOKEN_ID="token-id",
        MODAL_TOKEN_SECRET="token-secret",
        FORGE_TRAINING_MAX_ROWS=42,
    )

    run_tiny_finetune(
        settings,
        run_id="run-custom",
        model_id="sshleifer/tiny-gpt2",
        dataset=dataset,
        dataset_url="https://storage.example/signed",
    )

    assert function.last_kwargs["dataset_source_type"] == "upload"
    assert function.last_kwargs["dataset_url"] == "https://storage.example/signed"
    assert function.last_kwargs["dataset_adapter"]["promptField"] == "ask"
    assert function.last_kwargs["max_rows"] == 42
