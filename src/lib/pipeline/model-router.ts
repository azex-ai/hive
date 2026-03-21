import "server-only";
import { getConfig } from "../config";
import { queryBenchmarks } from "../scheduler";
import type { PipelineStage, ModelTier, ModelSelection } from "../types";

const MODEL_COST: Record<ModelTier, number> = { haiku: 1, sonnet: 2, opus: 5 };

const DEFAULT_ROUTES: Record<string, Record<string, ModelTier>> = {
  design:    { architect: "opus", executor: "opus" },
  code:      { executor: "sonnet" },
  review:    { reviewer: "opus", "self-reviewer": "sonnet" },
  repair:    { repairer: "sonnet", executor: "sonnet" },
  integrate: { reviewer: "opus" },
};

export function selectModel(stage: PipelineStage | string, role: string): ModelSelection {
  const config = getConfig();
  const pCfg = config.pipeline;

  const windowDays = pCfg?.model_routing?.benchmark_window_days ?? 30;
  const minSamples = pCfg?.model_routing?.benchmark_min_samples ?? 5;

  let benchmarks: Array<{ model: string; samples: number; score: number }> = [];
  try {
    benchmarks = queryBenchmarks(stage, windowDays);
  } catch {
    // DB not ready or no data
  }

  const hasSufficientData = benchmarks.some(b => b.samples >= minSamples);

  if (!hasSufficientData) {
    const configured = pCfg?.model_routing?.default?.[stage] as ModelTier | undefined;
    const hardcoded = DEFAULT_ROUTES[stage]?.[role] ?? "sonnet";
    const model = configured ?? hardcoded;
    return { model, source: "default", reason: "insufficient benchmark data" };
  }

  const eligible = benchmarks.filter(b => b.samples >= minSamples);
  eligible.sort((a, b) => b.score - a.score);

  if (eligible.length >= 2 && eligible[0].score - eligible[1].score < 0.1) {
    const cheaperCandidates = eligible.slice(0, 2).sort(
      (a, b) => MODEL_COST[a.model as ModelTier] - MODEL_COST[b.model as ModelTier]
    );
    const chosen = cheaperCandidates[0];
    return {
      model: chosen.model as ModelTier,
      source: "benchmark",
      score: chosen.score,
      reason: "scores within 10%, choosing cheaper model",
    };
  }

  const best = eligible[0];
  return {
    model: best.model as ModelTier,
    source: "benchmark",
    score: best.score,
    reason: "highest benchmark score",
  };
}

export function isSelfReview(): boolean {
  const config = getConfig();
  const prob = config.pipeline?.self_review_probability ?? 0.2;
  return Math.random() < prob;
}
