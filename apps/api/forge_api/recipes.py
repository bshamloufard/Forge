from forge_api.models.domain import RecipeId

recipes: dict[RecipeId, dict[str, str]] = {
    "chat-sft": {
        "name": "Chat SFT",
        "description": "Instruction tuning over curated chat examples with LoRA adapters.",
        "defaultPrompt": "Explain why checkpoint-centric post-training workflows matter.",
        "objective": "Minimize response loss while preserving concise instruction following.",
    },
    "math-rl": {
        "name": "Math RL",
        "description": "On-policy rollouts scored by answer checks and verifier rewards.",
        "defaultPrompt": "Solve: If 3x + 7 = 28, what is x? Show compact reasoning.",
        "objective": "Improve final-answer correctness and reasoning faithfulness.",
    },
    "tool-rl": {
        "name": "Tool-use RL",
        "description": "Trajectory optimization for agents that call tools and inspect results.",
        "defaultPrompt": "Use a shell to count TypeScript files in the repository.",
        "objective": "Reward correct tool selection, observations, and final synthesis.",
    },
    "harbor-agent-rl": {
        "name": "Harbor Agent RL",
        "description": "Sandboxed task attempts with pass/fail tests and trajectory scoring.",
        "defaultPrompt": "Patch a small failing test in a sandboxed coding task.",
        "objective": "Optimize task completion under reproducible environment constraints.",
    },
}

models = [
    "sshleifer/tiny-gpt2",
    "Qwen/Qwen2.5-0.5B-Instruct",
    "gpt-oss-20b",
    "deepseek-v3.1",
    "kimi-k2.6",
]
