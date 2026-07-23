export type VerificationInput = {
  candidate: string;
  rubric?: string;
  reference?: string;
  criteria?: Array<{ name: string; weight: number }>;
};

export type CriterionScore = {
  name: string;
  weight: number;
  score: number;
};

const positiveSignals = [
  "therefore",
  "because",
  "verify",
  "test",
  "check",
  "correct",
  "step",
  "result",
  "evidence",
  "constraint"
];

const negativeSignals = ["maybe", "unknown", "guess", "cannot", "failed", "incorrect"];

export function scoreCandidate({
  candidate,
  rubric = "",
  reference = "",
  criteria
}: VerificationInput) {
  const text = candidate.trim();
  const lower = text.toLowerCase();
  const words = text.split(/\s+/).filter(Boolean);
  const rubricTerms = rubric
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 4);
  const referenceTerms = reference
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 4);

  const signalScore =
    positiveSignals.filter((signal) => lower.includes(signal)).length * 0.055 -
    negativeSignals.filter((signal) => lower.includes(signal)).length * 0.07;
  const structureScore = Math.min(0.22, words.length / 260);
  const rubricScore =
    rubricTerms.length === 0
      ? 0.08
      : Math.min(
          0.22,
          rubricTerms.filter((term) => lower.includes(term)).length / rubricTerms.length
        );
  const referenceScore =
    referenceTerms.length === 0
      ? 0.04
      : Math.min(
          0.24,
          referenceTerms.filter((term) => lower.includes(term)).length / referenceTerms.length
        );
  const criterionScores = scoreCriteria(lower, criteria);
  const criterionBlend =
    criterionScores.length === 0
      ? 0
      : criterionScores.reduce((sum, item) => sum + item.score * item.weight, 0) /
        criterionScores.reduce((sum, item) => sum + item.weight, 0);
  const bounded = Math.max(
    0.05,
    Math.min(0.98, 0.34 + signalScore + structureScore + rubricScore + referenceScore + criterionBlend * 0.16)
  );
  const confidence = Math.max(
    0.35,
    Math.min(0.94, 0.5 + Math.abs(bounded - 0.5) + Math.min(0.12, words.length / 800))
  );

  return {
    score: Number(bounded.toFixed(3)),
    confidence: Number(confidence.toFixed(3)),
    pass: bounded >= 0.62,
    uncertainty: Number((1 - confidence).toFixed(3)),
    criterion_scores: Object.fromEntries(
      criterionScores.map((criterion) => [criterion.name, criterion.score])
    ),
    evidence: buildEvidence(lower, bounded),
    rationale: buildRationale(bounded, rubricTerms.length > 0, referenceTerms.length > 0)
  };
}

export function scoreTrajectory(events: string[], rubric?: string) {
  const joined = events.join("\n");
  const base = scoreCandidate({ candidate: joined, rubric });
  const progress = events.map((event, index) => {
    const prefix = events.slice(0, index + 1).join("\n");
    return {
      index,
      score: scoreCandidate({ candidate: prefix, rubric }).score,
      event
    };
  });
  const dense_rewards = progress.map((item, index) => {
    if (index === 0) return Number(Math.min(0.25, item.score).toFixed(3));
    return Number(Math.max(-0.25, Math.min(0.25, item.score - progress[index - 1].score)).toFixed(3));
  });
  return {
    ...base,
    progress,
    dense_rewards
  };
}

export function rankCandidates(input: {
  candidates: string[];
  rubric?: string;
  reference?: string;
  criteria?: Array<{ name: string; weight: number }>;
}) {
  const scored = input.candidates.map((candidate, index) => ({
    index,
    candidate,
    ...scoreCandidate({
      candidate,
      rubric: input.rubric,
      reference: input.reference,
      criteria: input.criteria
    })
  }));
  const beta = 5;
  const ranked = scored
    .map((item) => {
      const comparisons = scored.filter((other) => other.index !== item.index);
      const winMass =
        comparisons.length === 0
          ? 1
          : comparisons.reduce(
              (sum, other) => sum + 1 / (1 + Math.exp(-beta * (item.score - other.score))),
              0
            ) / comparisons.length;
      return { ...item, rank_score: Number(winMass.toFixed(3)) };
    })
    .sort((a, b) => b.rank_score - a.rank_score || b.score - a.score);
  return { ranking: ranked };
}

function buildRationale(score: number, hasRubric: boolean, hasReference: boolean) {
  const quality =
    score >= 0.78 ? "strong" : score >= 0.58 ? "usable" : score >= 0.4 ? "partial" : "weak";
  const rubricText = hasRubric ? "Rubric terms were considered." : "No rubric was supplied.";
  const referenceText = hasReference ? "Reference overlap contributed to the score." : "No reference answer was supplied.";
  return `Heuristic verifier marked this as ${quality}. ${rubricText} ${referenceText} Upgrade path: replace this local scorer with provider-backed scoring-token logits.`;
}

function scoreCriteria(lower: string, criteria: Array<{ name: string; weight: number }> = []) {
  return criteria.map((criterion): CriterionScore => {
    const terms = criterion.name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    const termScore =
      terms.length === 0
        ? 0.5
        : terms.filter((term) => lower.includes(term)).length / terms.length;
    const evidenceBoost = positiveSignals.filter((signal) => lower.includes(signal)).length / 20;
    return {
      name: criterion.name,
      weight: Math.max(0.01, criterion.weight),
      score: Number(Math.max(0.05, Math.min(0.98, 0.35 + termScore * 0.45 + evidenceBoost)).toFixed(3))
    };
  });
}

function buildEvidence(lower: string, score: number) {
  return [
    {
      kind: "heuristic",
      label: `${positiveSignals.filter((signal) => lower.includes(signal)).length} positive signals`,
      weight: 0.3
    },
    {
      kind: "threshold",
      label: score >= 0.62 ? "promotion threshold met" : "promotion threshold not met",
      weight: 0.25
    }
  ];
}
