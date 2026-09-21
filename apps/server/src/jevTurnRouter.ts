import type { ModelSelection, OrchestrationCommand } from "@t3tools/contracts";

export type JevTurnRouterMode = "off" | "shadow" | "apply";
export type JevModelTier = "small" | "normal" | "expert";

export interface JevTurnRouterConfig {
  readonly mode: JevTurnRouterMode;
  readonly apiKey?: string;
  readonly apiUrl: string;
  readonly timeoutMs: number;
  readonly confidenceThreshold: number;
  readonly models: Partial<Record<JevModelTier, string>>;
}

export interface JevTurnRouteResult {
  readonly command: Extract<OrchestrationCommand, { type: "thread.turn.start" }>;
  readonly recommendation: {
    readonly status: "disabled" | "recommended" | "applied" | "fallback";
    readonly tier?: JevModelTier;
    readonly confidence?: number;
    readonly originalModel?: string;
    readonly recommendedModel?: string;
    readonly reason?: string;
    readonly latencyMs: number;
    readonly usage?: { readonly inputTokens?: number; readonly outputTokens?: number };
  };
}

type FetchImplementation = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const MODEL_TIER_CRITERIA: Record<JevModelTier, string> = {
  small: "A bounded, low-risk request answerable with light reasoning and few tool steps",
  normal: "A typical coding or investigation task requiring repository context and tools",
  expert: "A complex, ambiguous, high-risk, or cross-system task requiring deep reasoning",
};
const MAX_ROUTING_TEXT_CHARS = 12_000;

const isModelTier = (value: unknown): value is JevModelTier =>
  value === "small" || value === "normal" || value === "expert";

const readUsage = (value: unknown) => {
  if (typeof value !== "object" || value === null) return undefined;
  const usage = value as { input_tokens?: unknown; output_tokens?: unknown };
  const inputTokens = typeof usage.input_tokens === "number" ? usage.input_tokens : undefined;
  const outputTokens = typeof usage.output_tokens === "number" ? usage.output_tokens : undefined;
  return inputTokens === undefined && outputTokens === undefined
    ? undefined
    : {
        ...(inputTokens !== undefined ? { inputTokens } : {}),
        ...(outputTokens !== undefined ? { outputTokens } : {}),
      };
};

const readRecommendation = (value: unknown) => {
  if (typeof value !== "object" || value === null) return null;
  const response = value as { answers?: unknown; usage?: unknown };
  if (typeof response.answers !== "object" || response.answers === null) return null;
  const answer = (response.answers as { model_tier?: unknown }).model_tier;
  if (typeof answer !== "object" || answer === null) return null;
  const choice = (answer as { choice?: unknown }).choice;
  const confidence = (answer as { confidence?: unknown }).confidence;
  if (!isModelTier(choice) || typeof confidence !== "number") return null;
  return { tier: choice, confidence, usage: readUsage(response.usage) };
};

export async function routeTurnWithJev(
  command: Extract<OrchestrationCommand, { type: "thread.turn.start" }>,
  config: JevTurnRouterConfig,
  fetchImplementation: FetchImplementation = fetch,
): Promise<JevTurnRouteResult> {
  const startedAt = performance.now();
  const originalModel = command.modelSelection?.model;
  const finish = (
    recommendation: Omit<JevTurnRouteResult["recommendation"], "latencyMs">,
    routedCommand = command,
  ): JevTurnRouteResult => ({
    command: routedCommand,
    recommendation: {
      ...recommendation,
      latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
    },
  });

  const originalModelDetails = originalModel ? { originalModel } : {};
  if (config.mode === "off") return finish({ status: "disabled", ...originalModelDetails });
  if (!config.apiKey) {
    return finish({
      status: "fallback",
      ...originalModelDetails,
      reason: "missing API key",
    });
  }
  if (!command.modelSelection) {
    return finish({ status: "fallback", reason: "turn has no model selection" });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetchImplementation(config.apiUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "jev-latest",
        state: {
          source: "t3",
          request: command.message.text.slice(0, MAX_ROUTING_TEXT_CHARS),
          request_truncated: command.message.text.length > MAX_ROUTING_TEXT_CHARS,
          provider: command.modelSelection.provider,
          current_model: command.modelSelection.model,
          interaction_mode: command.interactionMode,
        },
        questions: {
          model_tier: {
            type: "choice",
            instructions: "Choose the lowest model tier likely to complete `request` correctly.",
            criteria: MODEL_TIER_CRITERIA,
          },
        },
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      return finish({
        status: "fallback",
        ...originalModelDetails,
        reason: `Jev returned HTTP ${response.status}`,
      });
    }
    const parsed = readRecommendation(await response.json());
    if (!parsed) {
      return finish({
        status: "fallback",
        ...originalModelDetails,
        reason: "invalid Jev response",
      });
    }

    const recommendedModel = config.models[parsed.tier];
    const base = {
      tier: parsed.tier,
      confidence: parsed.confidence,
      ...originalModelDetails,
      ...(recommendedModel ? { recommendedModel } : {}),
      ...(parsed.usage ? { usage: parsed.usage } : {}),
    };
    if (config.mode !== "apply") return finish({ status: "recommended", ...base });
    if (!recommendedModel) {
      return finish({ status: "fallback", ...base, reason: "tier has no model mapping" });
    }
    if (parsed.confidence < config.confidenceThreshold) {
      return finish({ status: "fallback", ...base, reason: "confidence below threshold" });
    }

    const modelSelection: ModelSelection = {
      ...command.modelSelection,
      model: recommendedModel,
    };
    return finish(
      { status: "applied", ...base },
      {
        ...command,
        modelSelection,
      },
    );
  } catch (error) {
    const reason =
      error instanceof Error && error.name === "AbortError" ? "timeout" : "Jev unavailable";
    return finish({ status: "fallback", ...originalModelDetails, reason });
  } finally {
    clearTimeout(timeout);
  }
}
