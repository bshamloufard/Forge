from math import exp

positive_signals = [
    "therefore",
    "because",
    "verify",
    "test",
    "check",
    "correct",
    "step",
    "result",
    "evidence",
    "constraint",
]

negative_signals = ["maybe", "unknown", "guess", "cannot", "failed", "incorrect"]


def score_candidate(
    candidate: str,
    rubric: str = "",
    reference: str = "",
    criteria: list[dict[str, float | str]] | None = None,
) -> dict[str, object]:
    text = candidate.strip()
    lower = text.lower()
    words = [word for word in text.split() if word]
    rubric_terms = [word for word in _split_terms(rubric) if len(word) > 4]
    reference_terms = [word for word in _split_terms(reference) if len(word) > 4]

    signal_score = (
        len([signal for signal in positive_signals if signal in lower]) * 0.055
        - len([signal for signal in negative_signals if signal in lower]) * 0.07
    )
    structure_score = min(0.22, len(words) / 260)
    rubric_score = 0.08 if not rubric_terms else min(0.22, _overlap(lower, rubric_terms) / len(rubric_terms))
    reference_score = 0.04 if not reference_terms else min(0.24, _overlap(lower, reference_terms) / len(reference_terms))
    criterion_scores = _score_criteria(lower, criteria or [])
    criterion_blend = (
        0
        if not criterion_scores
        else sum(item["score"] * item["weight"] for item in criterion_scores)
        / sum(item["weight"] for item in criterion_scores)
    )
    bounded = max(
        0.05,
        min(0.98, 0.34 + signal_score + structure_score + rubric_score + reference_score + criterion_blend * 0.16),
    )
    confidence = max(0.35, min(0.94, 0.5 + abs(bounded - 0.5) + min(0.12, len(words) / 800)))

    return {
        "score": round(bounded, 3),
        "confidence": round(confidence, 3),
        "pass": bounded >= 0.62,
        "uncertainty": round(1 - confidence, 3),
        "criterion_scores": {str(item["name"]): item["score"] for item in criterion_scores},
        "evidence": _build_evidence(lower, bounded),
        "rationale": _build_rationale(bounded, bool(rubric_terms), bool(reference_terms)),
    }


def score_trajectory(events: list[str], rubric: str | None = None) -> dict[str, object]:
    joined = "\n".join(events)
    base = score_candidate(joined, rubric or "")
    progress = []
    for index, event in enumerate(events):
        prefix = "\n".join(events[: index + 1])
        progress.append({"index": index, "score": score_candidate(prefix, rubric or "")["score"], "event": event})

    dense_rewards: list[float] = []
    for index, item in enumerate(progress):
        score = float(item["score"])
        if index == 0:
            dense_rewards.append(round(min(0.25, score), 3))
        else:
            dense_rewards.append(round(max(-0.25, min(0.25, score - float(progress[index - 1]["score"]))), 3))
    return {**base, "progress": progress, "dense_rewards": dense_rewards}


def rank_candidates(
    candidates: list[str],
    rubric: str = "",
    reference: str = "",
    criteria: list[dict[str, float | str]] | None = None,
) -> dict[str, list[dict[str, object]]]:
    scored = [
        {
            "index": index,
            "candidate": candidate,
            **score_candidate(candidate, rubric, reference, criteria),
        }
        for index, candidate in enumerate(candidates)
    ]
    beta = 5
    ranked = []
    for item in scored:
        comparisons = [other for other in scored if other["index"] != item["index"]]
        win_mass = (
            1
            if not comparisons
            else sum(1 / (1 + exp(-beta * (float(item["score"]) - float(other["score"])))) for other in comparisons)
            / len(comparisons)
        )
        ranked.append({**item, "rank_score": round(win_mass, 3)})
    ranked.sort(key=lambda item: (float(item["rank_score"]), float(item["score"])), reverse=True)
    return {"ranking": ranked}


def _split_terms(text: str) -> list[str]:
    term = ""
    terms: list[str] = []
    for char in text.lower():
        if char.isalnum():
            term += char
        elif term:
            terms.append(term)
            term = ""
    if term:
        terms.append(term)
    return terms


def _overlap(lower: str, terms: list[str]) -> int:
    return len([term for term in terms if term in lower])


def _score_criteria(lower: str, criteria: list[dict[str, float | str]]) -> list[dict[str, float | str]]:
    scored = []
    for criterion in criteria:
        name = str(criterion["name"])
        terms = _split_terms(name)
        term_score = 0.5 if not terms else _overlap(lower, terms) / len(terms)
        evidence_boost = len([signal for signal in positive_signals if signal in lower]) / 20
        scored.append(
            {
                "name": name,
                "weight": max(0.01, float(criterion["weight"])),
                "score": round(max(0.05, min(0.98, 0.35 + term_score * 0.45 + evidence_boost)), 3),
            }
        )
    return scored


def _build_rationale(score: float, has_rubric: bool, has_reference: bool) -> str:
    quality = "strong" if score >= 0.78 else "usable" if score >= 0.58 else "partial" if score >= 0.4 else "weak"
    rubric_text = "Rubric terms were considered." if has_rubric else "No rubric was supplied."
    reference_text = "Reference overlap contributed to the score." if has_reference else "No reference answer was supplied."
    return (
        f"Heuristic verifier marked this as {quality}. {rubric_text} {reference_text} "
        "Upgrade path: replace this local scorer with provider-backed scoring-token logits."
    )


def _build_evidence(lower: str, score: float) -> list[dict[str, object]]:
    return [
        {
            "kind": "heuristic",
            "label": f"{len([signal for signal in positive_signals if signal in lower])} positive signals",
            "weight": 0.3,
        },
        {
            "kind": "threshold",
            "label": "promotion threshold met" if score >= 0.62 else "promotion threshold not met",
            "weight": 0.25,
        },
    ]

