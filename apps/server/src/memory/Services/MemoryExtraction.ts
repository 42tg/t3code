/**
 * MemoryExtraction - Service interface for batch memory extraction from threads.
 *
 * Gathers recent conversation threads, runs LLM summarization, and stores
 * extracted memories.
 *
 * @module MemoryExtraction
 */
import type { MemoryExtractInput } from "@t3tools/contracts";
import { Schema, ServiceMap } from "effect";
import type { Effect } from "effect";

export class MemoryExtractionError extends Schema.TaggedErrorClass<MemoryExtractionError>()(
  "MemoryExtractionError",
  {
    operation: Schema.String,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {
  override get message(): string {
    return `Memory extraction failed in ${this.operation}: ${this.detail}`;
  }
}

export interface MemoryExtractionShape {
  /**
   * Extract memories from threads updated since `sinceDate`.
   *
   * Runs two extraction passes:
   * 1. Per-project extraction → project-scoped memories
   * 2. Global daily summary  → daily-scoped memories
   */
  readonly extract: (
    input: MemoryExtractInput,
  ) => Effect.Effect<
    { extractedCount: number; skippedDuplicates: number; projectsProcessed: number },
    MemoryExtractionError
  >;
}

export class MemoryExtraction extends ServiceMap.Service<MemoryExtraction, MemoryExtractionShape>()(
  "t3/memory/Services/MemoryExtraction",
) {}
