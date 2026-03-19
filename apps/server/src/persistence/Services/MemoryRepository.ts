/**
 * MemoryRepository - Repository interface for memory entries.
 *
 * Owns persistence operations for user/auto-extracted memory entries.
 * Supports full-text search via FTS5 and scoped retrieval.
 *
 * @module MemoryRepository
 */
import type {
  Memory,
  MemoryArchiveInput,
  MemoryCreateInput,
  MemoryDeleteInput,
  MemoryGetForThreadInput,
  MemoryListInput,
  MemoryListResult,
  MemorySearchInput,
  MemoryUpdateInput,
} from "@t3tools/contracts";
import { ServiceMap } from "effect";
import type { Effect } from "effect";

import type { PersistenceDecodeError, PersistenceSqlError } from "../Errors.ts";

export type MemoryRepositoryError = PersistenceSqlError | PersistenceDecodeError;

/**
 * MemoryRepositoryShape - Service API for memory persistence.
 */
export interface MemoryRepositoryShape {
  /**
   * Insert a new memory entry.
   *
   * Generates `memoryId`, `createdAt`, and `updatedAt` server-side.
   * Sets `source: "manual"` and `relevanceScore: 1.0` by default.
   * Returns the full persisted Memory.
   */
  readonly create: (
    input: typeof MemoryCreateInput.Type,
  ) => Effect.Effect<Memory, MemoryRepositoryError>;

  /**
   * Update an existing memory's content, title, category, or relevance.
   *
   * Automatically bumps `updatedAt`.
   */
  readonly update: (
    input: typeof MemoryUpdateInput.Type,
  ) => Effect.Effect<void, MemoryRepositoryError>;

  /**
   * Soft-archive a memory by setting `archivedAt`.
   */
  readonly archive: (
    input: typeof MemoryArchiveInput.Type,
  ) => Effect.Effect<void, MemoryRepositoryError>;

  /**
   * Hard-delete a single memory by id.
   */
  readonly delete: (
    input: typeof MemoryDeleteInput.Type,
  ) => Effect.Effect<void, MemoryRepositoryError>;

  /**
   * List all memories for a project (optionally including thread-scope memories).
   *
   * Returned ordered by updated_at descending.
   */
  readonly listByProject: (
    input: typeof MemoryListInput.Type,
  ) => Effect.Effect<MemoryListResult, MemoryRepositoryError>;

  /**
   * Full-text search across memory title and content via FTS5.
   *
   * Returns results ranked by BM25 relevance.
   */
  readonly search: (
    input: typeof MemorySearchInput.Type,
  ) => Effect.Effect<ReadonlyArray<Memory>, MemoryRepositoryError>;

  /**
   * Get memories relevant to a thread's project context.
   *
   * Combines project-scoped + thread-scoped memories, optionally filtered by query.
   */
  readonly getRelevantForThread: (
    input: typeof MemoryGetForThreadInput.Type,
  ) => Effect.Effect<ReadonlyArray<Memory>, MemoryRepositoryError>;

  /**
   * Record an access to a memory (increment counter + update timestamp).
   */
  readonly recordAccess: (memoryId: string) => Effect.Effect<void, MemoryRepositoryError>;

  /**
   * Delete all daily-scope memories for a given date.
   * Used to replace daily summaries idempotently on re-extraction.
   */
  readonly deleteDailyByDate: (input: {
    date: string;
  }) => Effect.Effect<void, MemoryRepositoryError>;

  /**
   * Find the thread-scope summary memory for a given thread, if it exists.
   */
  readonly findThreadSummary: (
    threadId: string,
  ) => Effect.Effect<Memory | null, MemoryRepositoryError>;

  /**
   * Create or replace the thread summary memory for a given thread.
   *
   * Uses DELETE + INSERT to upsert based on the unique thread_id index (scope='thread').
   */
  readonly upsertThreadSummary: (input: {
    threadId: string;
    projectId: string;
    title: string;
    content: string;
  }) => Effect.Effect<Memory, MemoryRepositoryError>;
}

/**
 * MemoryRepository - Service tag for memory persistence.
 */
export class MemoryRepository extends ServiceMap.Service<MemoryRepository, MemoryRepositoryShape>()(
  "t3/persistence/Services/MemoryRepository",
) {}
