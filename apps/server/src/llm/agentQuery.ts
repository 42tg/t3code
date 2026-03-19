/**
 * Shared lightweight LLM query utility using the Claude Agent SDK.
 *
 * Wraps `query()` with a JSON-schema output format and returns parsed
 * structured results.  Used by text-generation helpers (commit messages,
 * Jira content) and memory extraction.
 *
 * @module agentQuery
 */
import { query as claudeQuery, type SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import { Effect } from "effect";

import { TextGenerationError } from "../git/Errors.ts";

const DEFAULT_SYSTEM_PROMPT =
  "You produce structured JSON output. Never ask for clarification or refuse — always produce your best output with the context provided.";

/**
 * Run a one-shot prompt via the Claude Agent SDK and parse the structured
 * JSON result.
 *
 * Uses Haiku for fast, low-cost generation with `permissionMode: "plan"`
 * (no tool use) and thinking disabled.
 */
export function runAgentQuery<T>(
  operation: string,
  prompt: string,
  jsonSchema: Record<string, unknown>,
  parse: (result: unknown) => T,
  systemPrompt?: string,
): Effect.Effect<T, TextGenerationError> {
  return Effect.tryPromise({
    try: async () => {
      const session = claudeQuery({
        prompt,
        options: {
          model: "claude-haiku-4-5-20251001",
          permissionMode: "plan",
          systemPrompt: systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
          outputFormat: { type: "json_schema", schema: jsonSchema },
          maxTurns: 10,
          thinking: { type: "disabled" },
        },
      });

      let resultMessage: SDKResultMessage | null = null;
      for await (const message of session) {
        if (message.type === "result") {
          resultMessage = message as SDKResultMessage;
        }
      }

      if (!resultMessage) {
        throw new Error("No result message received from agent query");
      }
      if (resultMessage.subtype !== "success") {
        const errors = resultMessage.errors.join("; ");
        throw new Error(
          `Agent query failed (${resultMessage.subtype}): ${errors || "unknown error"}`,
        );
      }
      if (resultMessage.structured_output != null) {
        return parse(resultMessage.structured_output);
      }
      return parse(JSON.parse(resultMessage.result));
    },
    catch: (error) =>
      new TextGenerationError({
        operation,
        detail: error instanceof Error ? error.message : "Agent query failed",
        cause: error,
      }),
  });
}
