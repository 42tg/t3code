/**
 * MemoryReactor layer — autonomous memory extraction triggered by turn completion.
 *
 * Subscribes to `turn.processing.quiesced` receipts from the RuntimeReceiptBus.
 * For each completed turn, debounces by threadId (30s), then generates a thread
 * summary via Claude Haiku. Periodically triggers project + daily extraction.
 *
 * @module memory/Layers/MemoryReactor
 */
import type { OrchestrationThread, ThreadId, TrimmedNonEmptyString } from "@t3tools/contracts";
import { Cause, Duration, Effect, Fiber, Layer, Ref, Stream } from "effect";

import { runAgentQuery } from "../../llm/agentQuery.ts";
import { MemoryRepository } from "../../persistence/Services/MemoryRepository.ts";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { RuntimeReceiptBus } from "../../orchestration/Services/RuntimeReceiptBus.ts";
import { MemoryExtraction } from "../Services/MemoryExtraction.ts";
import { MemoryReactor, type MemoryReactorShape } from "../Services/MemoryReactor.ts";
import { threadToTranscript } from "../threadTranscript.ts";
import {
  buildThreadSummaryPrompt,
  THREAD_SUMMARY_SCHEMA,
  THREAD_SUMMARY_SYSTEM_PROMPT,
} from "../prompts.ts";

// ── Configuration ─────────────────────────────────────────────────

/** Debounce delay before summarizing a thread after the last turn completes. */
const DEBOUNCE_MS = 30_000;

/** Number of thread summaries before triggering project + daily extraction. */
const EXTRACTION_TRIGGER_THRESHOLD = 10;

/** Minimum interval between project+daily extractions (4 hours). */
const EXTRACTION_INTERVAL_MS = 4 * 60 * 60 * 1000;

// ── Parse helper ──────────────────────────────────────────────────

interface ThreadSummaryResult {
  title: string;
  content: string;
}

function parseThreadSummary(raw: unknown): ThreadSummaryResult {
  const obj = raw as Record<string, unknown>;
  return {
    title: typeof obj.title === "string" ? obj.title : "Thread summary",
    content: typeof obj.content === "string" ? obj.content : "",
  };
}

// ── Layer implementation ──────────────────────────────────────────

const makeMemoryReactor = Effect.gen(function* () {
  const receiptBus = yield* RuntimeReceiptBus;
  const projectionQuery = yield* ProjectionSnapshotQuery;
  const memoryRepo = yield* MemoryRepository;
  const memoryExtraction = yield* MemoryExtraction;

  const start: MemoryReactorShape["start"] = Effect.gen(function* () {
    // State: debounce fibers per thread, and extraction trigger counter
    const pendingFibers = yield* Ref.make(new Map<ThreadId, Fiber.Fiber<void>>());
    const summaryCounter = yield* Ref.make(0);
    const lastExtractionAt = yield* Ref.make(0);

    /** Summarize a single thread and upsert its thread-scope memory. */
    const summarizeThread = (threadId: ThreadId) =>
      Effect.gen(function* () {
        const snapshot = yield* projectionQuery.getSnapshot();
        const thread = snapshot.threads.find((t: OrchestrationThread) => t.id === threadId);

        if (!thread || thread.deletedAt !== null || thread.messages.length === 0) {
          return;
        }

        // Check if thread has new activity since last summary
        const existingSummary = yield* memoryRepo
          .findThreadSummary(threadId)
          .pipe(Effect.catchCause(() => Effect.succeed(null)));

        if (existingSummary) {
          const summaryTime = new Date(existingSummary.updatedAt).getTime();
          const latestMessageTime = Math.max(
            ...thread.messages.map((m) => new Date(m.updatedAt).getTime()),
          );
          if (latestMessageTime <= summaryTime) {
            yield* Effect.logInfo(
              `Skipping thread summary for "${thread.title}" — no new activity since last summary`,
            );
            return;
          }
        }

        const transcript = threadToTranscript(thread);
        if (transcript.messages.length === 0) return;

        // Get checkpoint files for richer summaries
        const checkpointFiles =
          thread.checkpoints.length > 0
            ? thread.checkpoints[thread.checkpoints.length - 1]?.files
            : undefined;

        const prompt = buildThreadSummaryPrompt(
          thread.title,
          transcript.messages,
          checkpointFiles as { path: string; kind: string }[] | undefined,
        );

        const result = yield* runAgentQuery(
          "memoryReactor.threadSummary",
          prompt,
          THREAD_SUMMARY_SCHEMA as Record<string, unknown>,
          parseThreadSummary,
          THREAD_SUMMARY_SYSTEM_PROMPT,
        ).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning(
              `Thread summary LLM call failed for ${threadId}: ${Cause.pretty(cause)}`,
            ).pipe(Effect.map(() => null)),
          ),
        );

        if (!result || !result.content.trim()) return;

        yield* memoryRepo
          .upsertThreadSummary({
            threadId,
            projectId: thread.projectId,
            title: result.title as typeof TrimmedNonEmptyString.Type,
            content: result.content as typeof TrimmedNonEmptyString.Type,
          })
          .pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning(
                `Failed to upsert thread summary for ${threadId}: ${Cause.pretty(cause)}`,
              ),
            ),
          );

        yield* Effect.logInfo(`Thread summary created/updated: "${result.title}"`);

        // Increment counter for extraction trigger
        yield* Ref.update(summaryCounter, (n) => n + 1);
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning(
            `Memory reactor: thread summary failed for ${threadId}: ${Cause.pretty(cause)}`,
          ),
        ),
      );

    /** Check if project + daily extraction should be triggered. */
    const maybeRunExtraction = Effect.gen(function* () {
      const count = yield* Ref.get(summaryCounter);
      const lastAt = yield* Ref.get(lastExtractionAt);
      const now = Date.now();

      if (count < EXTRACTION_TRIGGER_THRESHOLD && now - lastAt < EXTRACTION_INTERVAL_MS) {
        return;
      }

      yield* Ref.set(summaryCounter, 0);
      yield* Ref.set(lastExtractionAt, now);

      const sinceDate = new Date(now - EXTRACTION_INTERVAL_MS).toISOString();
      yield* Effect.logInfo(
        `Memory reactor: triggering project + daily extraction (since ${sinceDate})`,
      );

      yield* memoryExtraction
        .extract({ sinceDate })
        .pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning(`Memory reactor: project extraction failed: ${Cause.pretty(cause)}`),
          ),
        );
    });

    /** Handle a quiesced receipt: debounce by threadId, then summarize. */
    const handleQuiesced = (threadId: ThreadId) =>
      Effect.gen(function* () {
        const fibers = yield* Ref.get(pendingFibers);

        // Cancel any existing debounce fiber for this thread
        const existing = fibers.get(threadId);
        if (existing) {
          yield* Fiber.interrupt(existing);
        }

        // Fork a new debounced fiber
        const fiber = yield* Effect.forkScoped(
          Effect.gen(function* () {
            yield* Effect.sleep(Duration.millis(DEBOUNCE_MS));
            // Remove self from pending map
            yield* Ref.update(pendingFibers, (m) => {
              const next = new Map(m);
              next.delete(threadId);
              return next;
            });
            yield* summarizeThread(threadId);
            yield* maybeRunExtraction;
          }),
        );

        yield* Ref.update(pendingFibers, (m) => {
          const next = new Map(m);
          next.set(threadId, fiber);
          return next;
        });
      });

    // Subscribe to receipt bus and process quiesced events
    yield* Effect.forkScoped(
      Stream.runForEach(receiptBus.stream, (receipt) => {
        if (receipt.type !== "turn.processing.quiesced") {
          return Effect.void;
        }
        return handleQuiesced(receipt.threadId);
      }),
    );

    yield* Effect.logInfo("Memory reactor started");
  });

  return { start } satisfies MemoryReactorShape;
});

export const MemoryReactorLive = Layer.effect(MemoryReactor, makeMemoryReactor);
