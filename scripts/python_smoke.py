from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "packages" / "forge"))

from forge import ServiceClient  # noqa: E402


def main() -> None:
    service = ServiceClient(base_url="http://localhost:8000")
    training = service.create_training_client(
        model="qwen3-8b",
        recipe="chat-sft",
        name="python smoke run",
        target_steps=12,
    )
    training.forward_backward(microbatches=2)
    training.optim_step()
    checkpoint = training.save_state(name="python-smoke-step")
    sampling = training.save_weights_and_get_sampling_client()
    completion = sampling.sample(prompt="Explain checkpoint lineage.")

    verifier = service._request(
        "POST",
        "/v1/verifier/verify",
        json={
            "candidate": "The result is correct because it verifies checkpoint lineage with evidence.",
            "rubric": "correct verified evidence checkpoint",
        },
    )
    deployment = service._request("POST", "/v1/deployments", json={"checkpointId": checkpoint.id, "target": "baseten"})
    service._request("POST", f"/v1/deployments/{deployment['deployment']['id']}/invoke", json={"prompt": "Hello"})

    print(
        "Python smoke passed: "
        f"run={training.id} checkpoint={checkpoint.id} sample_chars={len(completion.output)} score={verifier['score']}"
    )
    service.close()


if __name__ == "__main__":
    main()

