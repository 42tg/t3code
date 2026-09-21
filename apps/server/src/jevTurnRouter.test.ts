import { describe, expect, it } from "vitest";
import { CommandId, MessageId, ThreadId, type OrchestrationCommand } from "@t3tools/contracts";

import { routeTurnWithJev, type JevTurnRouterConfig } from "./jevTurnRouter";

const command = {
  type: "thread.turn.start",
  commandId: CommandId.makeUnsafe("command:test"),
  threadId: ThreadId.makeUnsafe("thread:test"),
  message: {
    messageId: MessageId.makeUnsafe("message:test"),
    role: "user",
    text: "Diagnose the failing test and implement the fix.",
    attachments: [],
  },
  modelSelection: { provider: "codex", model: "gpt-5.6-sol" },
  runtimeMode: "full-access",
  interactionMode: "default",
  createdAt: "2026-09-21T10:00:00.000Z",
} as Extract<OrchestrationCommand, { type: "thread.turn.start" }>;

const config: JevTurnRouterConfig = {
  mode: "shadow",
  apiKey: "test-key",
  apiUrl: "https://api.typesafe.ai/v1/systemone",
  timeoutMs: 100,
  confidenceThreshold: 0.8,
  models: {
    small: "gpt-5.6-luna",
    normal: "gpt-5.6-terra",
    expert: "gpt-5.6-sol",
  },
};

const response = (tier: "small" | "normal" | "expert", confidence: number) =>
  new Response(
    JSON.stringify({
      answers: { model_tier: { type: "choice", choice: tier, confidence } },
      usage: { input_tokens: 120, output_tokens: 20 },
    }),
    { status: 200 },
  );

describe("routeTurnWithJev", () => {
  it("reports a shadow recommendation without changing the command", async () => {
    let capturedRequest: RequestInit | undefined;
    const fetchImplementation = async (_input: string | URL | Request, init?: RequestInit) => {
      capturedRequest = init;
      return response("normal", 0.91);
    };
    const result = await routeTurnWithJev(command, config, fetchImplementation);

    expect(result.command.modelSelection?.model).toBe("gpt-5.6-sol");
    expect(result.recommendation).toMatchObject({
      status: "recommended",
      tier: "normal",
      confidence: 0.91,
      recommendedModel: "gpt-5.6-terra",
      usage: { inputTokens: 120, outputTokens: 20 },
    });
    expect(capturedRequest?.headers).toMatchObject({ Authorization: "Bearer test-key" });
    expect(capturedRequest?.body).not.toContain("test-key");
  });

  it("applies a confident recommendation for only this turn", async () => {
    const result = await routeTurnWithJev(command, { ...config, mode: "apply" }, async () =>
      response("small", 0.95),
    );

    expect(result.recommendation.status).toBe("applied");
    expect(result.command.modelSelection?.model).toBe("gpt-5.6-luna");
    expect(command.modelSelection?.model).toBe("gpt-5.6-sol");
  });

  it("keeps the selected model below the confidence threshold", async () => {
    const result = await routeTurnWithJev(command, { ...config, mode: "apply" }, async () =>
      response("small", 0.7),
    );

    expect(result.recommendation).toMatchObject({
      status: "fallback",
      reason: "confidence below threshold",
    });
    expect(result.command.modelSelection?.model).toBe("gpt-5.6-sol");
  });

  it("fails open when Jev is unavailable", async () => {
    const result = await routeTurnWithJev(command, config, async () => {
      throw new Error("offline");
    });

    expect(result.recommendation).toMatchObject({ status: "fallback", reason: "Jev unavailable" });
    expect(result.command.modelSelection?.model).toBe("gpt-5.6-sol");
  });
});
