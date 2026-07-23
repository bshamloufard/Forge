const baseUrl = process.env.SMOKE_BASE_URL || "http://localhost:3000";

async function request(path, options = {}) {
  let last = null;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {})
      }
    });
    const text = response.ok ? "" : await response.clone().text();
    if (response.ok) return response.json();
    last = { response, text };
    if (!(response.status === 404 && text.trim() === "Not Found")) break;
    await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
  }

  throw new Error(
    `${options.method || "GET"} ${path} failed: ${last.response.status} ${last.text}`
  );
}

const state = await request("/api/state");
const run = state.runs[0];
const session = state.sessions[0];

await request(`/api/v1/training-runs/${run.id}/forward-backward`, {
  method: "POST",
  body: JSON.stringify({ microbatches: 2 })
});
await request(`/api/v1/training-runs/${run.id}/optim-step`, {
  method: "POST",
  body: JSON.stringify({})
});
const checkpoint = await request("/api/v1/checkpoints", {
  method: "POST",
  body: JSON.stringify({ runId: run.id })
});
await request("/api/sample", {
  method: "POST",
  body: JSON.stringify({ sessionId: session.id, prompt: "Test prompt" })
});
await request("/api/verify", {
  method: "POST",
  body: JSON.stringify({
    candidate: "The answer is correct because it verifies the result against tests.",
    rubric: "correct, verified, evidence"
  })
});
await request("/api/v1/deployments", {
  method: "POST",
  body: JSON.stringify({ checkpointId: checkpoint.checkpoint.id, target: "baseten" })
});

console.log(`Smoke test passed against ${baseUrl}`);
