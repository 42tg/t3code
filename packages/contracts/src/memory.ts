import { Schema } from "effect";
import { NonNegativeInt, ProjectId, ThreadId, TrimmedNonEmptyString, TurnId } from "./baseSchemas";

/** ISO date string (YYYY-MM-DD) for daily-scoped memories. */
export const MemoryDate = Schema.String.pipe(Schema.brand("MemoryDate"));
export type MemoryDate = typeof MemoryDate.Type;

// ── Domain Enums ────────────────────────────────────────────────────

export const MemoryScope = Schema.Literals(["project", "thread", "daily"]);
export type MemoryScope = typeof MemoryScope.Type;

export const MemoryCategory = Schema.Literals([
  "preference",
  "pattern",
  "decision",
  "fact",
  "convention",
]);
export type MemoryCategory = typeof MemoryCategory.Type;

export const MemorySource = Schema.Literals(["auto", "manual"]);
export type MemorySource = typeof MemorySource.Type;

// ── Domain Entity ───────────────────────────────────────────────────

export const MemoryId = TrimmedNonEmptyString.pipe(Schema.brand("MemoryId"));
export type MemoryId = typeof MemoryId.Type;

export const Memory = Schema.Struct({
  memoryId: MemoryId,
  projectId: Schema.optional(ProjectId),
  /** The thread this memory summarizes — required when scope is "thread". */
  threadId: Schema.optional(ThreadId),
  scope: MemoryScope,
  category: MemoryCategory,
  source: MemorySource,
  content: TrimmedNonEmptyString,
  title: TrimmedNonEmptyString,
  /** ISO date (YYYY-MM-DD) — required when scope is "daily". */
  date: Schema.optional(MemoryDate),
  sourceThreadId: Schema.optional(ThreadId),
  sourceTurnId: Schema.optional(TurnId),
  relevanceScore: Schema.Number,
  accessCount: NonNegativeInt,
  lastAccessedAt: Schema.optional(Schema.String),
  createdAt: Schema.String,
  updatedAt: Schema.String,
  archivedAt: Schema.optional(Schema.String),
});
export type Memory = typeof Memory.Type;

// ── WS Inputs ───────────────────────────────────────────────────────

export const MemoryCreateInput = Schema.Struct({
  projectId: Schema.optional(ProjectId),
  /** The thread this memory summarizes — required when scope is "thread". */
  threadId: Schema.optional(ThreadId),
  scope: MemoryScope,
  category: MemoryCategory,
  /** Defaults to "manual" when omitted. */
  source: Schema.optional(MemorySource),
  content: TrimmedNonEmptyString,
  title: TrimmedNonEmptyString,
  /** ISO date (YYYY-MM-DD) — required when scope is "daily". */
  date: Schema.optional(MemoryDate),
  sourceThreadId: Schema.optional(ThreadId),
  sourceTurnId: Schema.optional(TurnId),
});
export type MemoryCreateInput = typeof MemoryCreateInput.Type;

export const MemoryUpdateInput = Schema.Struct({
  memoryId: MemoryId,
  content: Schema.optional(TrimmedNonEmptyString),
  title: Schema.optional(TrimmedNonEmptyString),
  category: Schema.optional(MemoryCategory),
  relevanceScore: Schema.optional(Schema.Number),
});
export type MemoryUpdateInput = typeof MemoryUpdateInput.Type;

export const MemoryArchiveInput = Schema.Struct({
  memoryId: MemoryId,
});
export type MemoryArchiveInput = typeof MemoryArchiveInput.Type;

export const MemoryDeleteInput = Schema.Struct({
  memoryId: MemoryId,
});
export type MemoryDeleteInput = typeof MemoryDeleteInput.Type;

export const MemoryListInput = Schema.Struct({
  projectId: ProjectId,
  /** Include thread-scope memories in results. Defaults to true. */
  includeThread: Schema.optional(Schema.Boolean),
  includeArchived: Schema.optional(Schema.Boolean),
  category: Schema.optional(MemoryCategory),
  limit: Schema.optional(NonNegativeInt),
  offset: Schema.optional(NonNegativeInt),
});
export type MemoryListInput = typeof MemoryListInput.Type;

export const MemorySearchInput = Schema.Struct({
  query: TrimmedNonEmptyString,
  projectId: Schema.optional(ProjectId),
  category: Schema.optional(MemoryCategory),
  limit: Schema.optional(NonNegativeInt),
});
export type MemorySearchInput = typeof MemorySearchInput.Type;

export const MemoryGetForThreadInput = Schema.Struct({
  threadId: ThreadId,
  projectId: ProjectId,
  query: Schema.optional(TrimmedNonEmptyString),
  limit: Schema.optional(NonNegativeInt),
});
export type MemoryGetForThreadInput = typeof MemoryGetForThreadInput.Type;

export const MemoryExtractInput = Schema.Struct({
  /** ISO 8601 datetime — collect threads updated since this time. */
  sinceDate: Schema.String,
  /** Optional: limit extraction to a single project. */
  projectId: Schema.optional(ProjectId),
});
export type MemoryExtractInput = typeof MemoryExtractInput.Type;

// ── WS Results ──────────────────────────────────────────────────────

export const MemoryCreateResult = Schema.Struct({
  memory: Memory,
});
export type MemoryCreateResult = typeof MemoryCreateResult.Type;

export const MemoryListResult = Schema.Struct({
  memories: Schema.Array(Memory),
  total: NonNegativeInt,
});
export type MemoryListResult = typeof MemoryListResult.Type;

export const MemorySearchResult = Schema.Struct({
  memories: Schema.Array(Memory),
});
export type MemorySearchResult = typeof MemorySearchResult.Type;

export const MemoryExtractResult = Schema.Struct({
  extractedCount: NonNegativeInt,
  skippedDuplicates: NonNegativeInt,
  projectsProcessed: NonNegativeInt,
});
export type MemoryExtractResult = typeof MemoryExtractResult.Type;
