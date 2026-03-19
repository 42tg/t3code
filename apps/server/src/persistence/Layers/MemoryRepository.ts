import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import {
  type Memory,
  type MemoryId,
  type ProjectId,
  type ThreadId,
  MemoryScope,
  MemoryCategory,
  MemorySource,
  NonNegativeInt,
  TrimmedNonEmptyString,
} from "@t3tools/contracts";
import { Effect, Layer, Schema } from "effect";

import { toPersistenceDecodeError, toPersistenceSqlError } from "../Errors.ts";

import {
  MemoryRepository,
  type MemoryRepositoryError,
  type MemoryRepositoryShape,
} from "../Services/MemoryRepository.ts";

/**
 * DB row schema: nullable columns come back as null from SQLite,
 * so we map optional fields to NullOr for the database representation.
 */
const MemoryDbRowSchema = Schema.Struct({
  memoryId: TrimmedNonEmptyString,
  projectId: Schema.NullOr(TrimmedNonEmptyString),
  threadId: Schema.NullOr(TrimmedNonEmptyString),
  scope: MemoryScope,
  category: MemoryCategory,
  source: MemorySource,
  content: TrimmedNonEmptyString,
  title: TrimmedNonEmptyString,
  date: Schema.NullOr(Schema.String),
  sourceThreadId: Schema.NullOr(TrimmedNonEmptyString),
  sourceTurnId: Schema.NullOr(TrimmedNonEmptyString),
  relevanceScore: Schema.Number,
  accessCount: NonNegativeInt,
  lastAccessedAt: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  updatedAt: Schema.String,
  archivedAt: Schema.NullOr(Schema.String),
});

/** Convert a DB row (with nulls) to the domain entity (with optionals). */
function rowToMemory(row: typeof MemoryDbRowSchema.Type): Memory {
  return {
    memoryId: row.memoryId as MemoryId,
    ...(row.projectId !== null ? { projectId: row.projectId } : {}),
    ...(row.threadId !== null ? { threadId: row.threadId } : {}),
    scope: row.scope,
    category: row.category,
    source: row.source,
    content: row.content,
    title: row.title,
    ...(row.date !== null ? { date: row.date } : {}),
    ...(row.sourceThreadId !== null ? { sourceThreadId: row.sourceThreadId } : {}),
    ...(row.sourceTurnId !== null ? { sourceTurnId: row.sourceTurnId } : {}),
    relevanceScore: row.relevanceScore,
    accessCount: row.accessCount,
    ...(row.lastAccessedAt !== null ? { lastAccessedAt: row.lastAccessedAt } : {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...(row.archivedAt !== null ? { archivedAt: row.archivedAt } : {}),
  } as Memory;
}

function toPersistenceSqlOrDecodeError(sqlOperation: string, decodeOperation: string) {
  return (cause: unknown): MemoryRepositoryError =>
    Schema.isSchemaError(cause)
      ? toPersistenceDecodeError(decodeOperation)(cause)
      : toPersistenceSqlError(sqlOperation)(cause);
}

/**
 * Sanitize user input for FTS5 MATCH queries.
 * Escapes special FTS5 operators to prevent injection.
 */
function sanitizeFts5Query(query: string): string {
  // Wrap each token in double quotes to escape special FTS5 operators
  const tokens = query
    .replace(/"/g, '""')
    .split(/\s+/)
    .filter((token) => token.length > 0);
  if (tokens.length === 0) return '""'; // safe no-op match for degenerate input
  return tokens.map((token) => `"${token}"`).join(" ");
}

const MEMORY_SELECT_COLUMNS = `
  memory_id AS "memoryId",
  project_id AS "projectId",
  thread_id AS "threadId",
  scope,
  category,
  source,
  content,
  title,
  date,
  source_thread_id AS "sourceThreadId",
  source_turn_id AS "sourceTurnId",
  relevance_score AS "relevanceScore",
  access_count AS "accessCount",
  last_accessed_at AS "lastAccessedAt",
  created_at AS "createdAt",
  updated_at AS "updatedAt",
  archived_at AS "archivedAt"
`;

/** Prefixed column list for JOINed queries where the table is aliased as `m`. */
const MEMORY_SELECT_COLUMNS_PREFIXED = `
  m.memory_id AS "memoryId",
  m.project_id AS "projectId",
  m.thread_id AS "threadId",
  m.scope,
  m.category,
  m.source,
  m.content,
  m.title,
  m.date,
  m.source_thread_id AS "sourceThreadId",
  m.source_turn_id AS "sourceTurnId",
  m.relevance_score AS "relevanceScore",
  m.access_count AS "accessCount",
  m.last_accessed_at AS "lastAccessedAt",
  m.created_at AS "createdAt",
  m.updated_at AS "updatedAt",
  m.archived_at AS "archivedAt"
`;

const makeMemoryRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const insertMemoryRow = SqlSchema.void({
    Request: Schema.Struct({
      memoryId: TrimmedNonEmptyString,
      projectId: Schema.NullOr(TrimmedNonEmptyString),
      threadId: Schema.NullOr(TrimmedNonEmptyString),
      scope: MemoryScope,
      category: MemoryCategory,
      source: MemorySource,
      content: TrimmedNonEmptyString,
      title: TrimmedNonEmptyString,
      date: Schema.NullOr(Schema.String),
      sourceThreadId: Schema.NullOr(TrimmedNonEmptyString),
      sourceTurnId: Schema.NullOr(TrimmedNonEmptyString),
      createdAt: Schema.String,
      updatedAt: Schema.String,
    }),
    execute: (row) =>
      sql`
        INSERT INTO projection_memories (
          memory_id,
          project_id,
          thread_id,
          scope,
          category,
          source,
          content,
          title,
          date,
          source_thread_id,
          source_turn_id,
          created_at,
          updated_at
        )
        VALUES (
          ${row.memoryId},
          ${row.projectId},
          ${row.threadId},
          ${row.scope},
          ${row.category},
          ${row.source},
          ${row.content},
          ${row.title},
          ${row.date},
          ${row.sourceThreadId},
          ${row.sourceTurnId},
          ${row.createdAt},
          ${row.updatedAt}
        )
      `,
  });

  const create: MemoryRepositoryShape["create"] = (input) => {
    const now = new Date().toISOString();
    const memoryId = crypto.randomUUID() as typeof TrimmedNonEmptyString.Type;

    const row = {
      memoryId,
      projectId: (input.projectId ?? null) as typeof TrimmedNonEmptyString.Type | null,
      threadId: (input.threadId ?? null) as typeof TrimmedNonEmptyString.Type | null,
      scope: input.scope,
      category: input.category,
      source: (input.source ?? "manual") as "auto" | "manual",
      content: input.content,
      title: input.title,
      date: (input.date ?? null) as string | null,
      sourceThreadId: (input.sourceThreadId ?? null) as typeof TrimmedNonEmptyString.Type | null,
      sourceTurnId: (input.sourceTurnId ?? null) as typeof TrimmedNonEmptyString.Type | null,
      createdAt: now,
      updatedAt: now,
    };

    return insertMemoryRow(row).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "MemoryRepository.create:query",
          "MemoryRepository.create:encodeRequest",
        ),
      ),
      Effect.map(
        () =>
          ({
            memoryId: memoryId as MemoryId,
            ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
            ...(input.threadId !== undefined ? { threadId: input.threadId } : {}),
            scope: input.scope,
            category: input.category,
            source: input.source ?? "manual",
            content: input.content,
            title: input.title,
            ...(input.date !== undefined ? { date: input.date } : {}),
            ...(input.sourceThreadId !== undefined ? { sourceThreadId: input.sourceThreadId } : {}),
            ...(input.sourceTurnId !== undefined ? { sourceTurnId: input.sourceTurnId } : {}),
            relevanceScore: 1.0,
            accessCount: 0 as typeof NonNegativeInt.Type,
            createdAt: now,
            updatedAt: now,
          }) as Memory,
      ),
    );
  };

  const update: MemoryRepositoryShape["update"] = (input) =>
    Effect.gen(function* () {
      const now = new Date().toISOString();
      yield* sql`
        UPDATE projection_memories
        SET
          content = COALESCE(${input.content ?? null}, content),
          title = COALESCE(${input.title ?? null}, title),
          category = COALESCE(${input.category ?? null}, category),
          relevance_score = COALESCE(${input.relevanceScore ?? null}, relevance_score),
          updated_at = ${now}
        WHERE memory_id = ${input.memoryId}
      `;
    }).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "MemoryRepository.update:query",
          "MemoryRepository.update:encodeRequest",
        ),
      ),
    );

  const archive: MemoryRepositoryShape["archive"] = (input) =>
    Effect.gen(function* () {
      const now = new Date().toISOString();
      yield* sql`
        UPDATE projection_memories
        SET archived_at = ${now}, updated_at = ${now}
        WHERE memory_id = ${input.memoryId}
      `;
    }).pipe(Effect.mapError(toPersistenceSqlError("MemoryRepository.archive:query")));

  const del: MemoryRepositoryShape["delete"] = (input) =>
    sql`
      DELETE FROM projection_memories
      WHERE memory_id = ${input.memoryId}
    `.pipe(Effect.mapError(toPersistenceSqlError("MemoryRepository.delete:query")));

  const listByProjectRows = SqlSchema.findAll({
    Request: Schema.Struct({
      projectId: TrimmedNonEmptyString,
      includeThread: Schema.Boolean,
      includeArchived: Schema.Boolean,
      category: Schema.NullOr(MemoryCategory),
      limit: Schema.Number,
      offset: Schema.Number,
    }),
    Result: MemoryDbRowSchema,
    execute: (input) =>
      sql.unsafe(
        `
          SELECT ${MEMORY_SELECT_COLUMNS}
          FROM projection_memories
          WHERE (
            project_id = ?
            ${input.includeThread ? "OR scope = 'thread'" : ""}
          )
          ${input.includeArchived ? "" : "AND archived_at IS NULL"}
          ${input.category !== null ? "AND category = ?" : ""}
          ORDER BY updated_at DESC
          LIMIT ? OFFSET ?
        `,
        [
          input.projectId,
          ...(input.category !== null ? [input.category] : []),
          input.limit,
          input.offset,
        ],
      ),
  });

  const countByProjectRows = SqlSchema.findAll({
    Request: Schema.Struct({
      projectId: TrimmedNonEmptyString,
      includeThread: Schema.Boolean,
      includeArchived: Schema.Boolean,
      category: Schema.NullOr(MemoryCategory),
    }),
    Result: Schema.Struct({ total: Schema.Number }),
    execute: (input) =>
      sql.unsafe(
        `
          SELECT COUNT(*) AS total
          FROM projection_memories
          WHERE (
            project_id = ?
            ${input.includeThread ? "OR scope = 'thread'" : ""}
          )
          ${input.includeArchived ? "" : "AND archived_at IS NULL"}
          ${input.category !== null ? "AND category = ?" : ""}
        `,
        [input.projectId, ...(input.category !== null ? [input.category] : [])],
      ),
  });

  const listByProject: MemoryRepositoryShape["listByProject"] = (input) =>
    Effect.gen(function* () {
      const limit = input.limit ?? 50;
      const offset = input.offset ?? 0;
      const includeThread = input.includeThread ?? true;
      const includeArchived = input.includeArchived ?? false;
      const category = input.category ?? null;

      const [rows, countRows] = yield* Effect.all([
        listByProjectRows({
          projectId: input.projectId,
          includeThread,
          includeArchived,
          category,
          limit,
          offset,
        }),
        countByProjectRows({
          projectId: input.projectId,
          includeThread,
          includeArchived,
          category,
        }),
      ]);

      const total = (countRows[0]?.total ?? 0) as typeof NonNegativeInt.Type;
      return {
        memories: rows.map(rowToMemory),
        total,
      };
    }).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "MemoryRepository.listByProject:query",
          "MemoryRepository.listByProject:decodeRows",
        ),
      ),
    );

  const searchRows = SqlSchema.findAll({
    Request: Schema.Struct({
      query: TrimmedNonEmptyString,
      projectId: Schema.NullOr(TrimmedNonEmptyString),
      category: Schema.NullOr(MemoryCategory),
      limit: Schema.Number,
    }),
    Result: MemoryDbRowSchema,
    execute: (input) => {
      const ftsQuery = sanitizeFts5Query(input.query);
      return sql.unsafe(
        `
          SELECT ${MEMORY_SELECT_COLUMNS_PREFIXED}
          FROM projection_memories m
          JOIN projection_memories_fts fts ON fts.memory_id = m.memory_id
          WHERE fts MATCH ?
          AND m.archived_at IS NULL
          ${input.projectId !== null ? "AND m.project_id = ?" : ""}
          ${input.category !== null ? "AND m.category = ?" : ""}
          ORDER BY bm25(fts) ASC
          LIMIT ?
        `,
        [
          ftsQuery,
          ...(input.projectId !== null ? [input.projectId] : []),
          ...(input.category !== null ? [input.category] : []),
          input.limit,
        ],
      );
    },
  });

  const search: MemoryRepositoryShape["search"] = (input) =>
    searchRows({
      query: input.query,
      projectId: (input.projectId ?? null) as typeof TrimmedNonEmptyString.Type | null,
      category: input.category ?? null,
      limit: input.limit ?? 20,
    }).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "MemoryRepository.search:query",
          "MemoryRepository.search:decodeRows",
        ),
      ),
      Effect.map((rows) => rows.map(rowToMemory)),
    );

  const getRelevantForThreadRows = SqlSchema.findAll({
    Request: Schema.Struct({
      projectId: TrimmedNonEmptyString,
      threadId: TrimmedNonEmptyString,
      limit: Schema.Number,
    }),
    Result: MemoryDbRowSchema,
    execute: (input) =>
      sql.unsafe(
        `
          SELECT ${MEMORY_SELECT_COLUMNS}
          FROM projection_memories
          WHERE (project_id = ? OR (scope = 'thread' AND thread_id = ?))
          AND archived_at IS NULL
          ORDER BY
            relevance_score DESC,
            CASE WHEN last_accessed_at IS NOT NULL
              THEN 1.0 / (1.0 + julianday('now') - julianday(last_accessed_at))
              ELSE 0.5
            END DESC,
            updated_at DESC
          LIMIT ?
        `,
        [input.projectId, input.threadId, input.limit],
      ),
  });

  const getRelevantForThread: MemoryRepositoryShape["getRelevantForThread"] = (input) => {
    // If a query is provided, use FTS5 search scoped to project
    if (input.query !== undefined) {
      return search({
        query: input.query,
        projectId: input.projectId,
        limit: input.limit ?? 10,
      });
    }

    // Otherwise, return top memories by relevance + recency
    return getRelevantForThreadRows({
      projectId: input.projectId,
      threadId: input.threadId,
      limit: input.limit ?? 10,
    }).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "MemoryRepository.getRelevantForThread:query",
          "MemoryRepository.getRelevantForThread:decodeRows",
        ),
      ),
      Effect.map((rows) => rows.map(rowToMemory)),
    );
  };

  const recordAccess: MemoryRepositoryShape["recordAccess"] = (memoryId) =>
    Effect.gen(function* () {
      const now = new Date().toISOString();
      yield* sql`
        UPDATE projection_memories
        SET access_count = access_count + 1, last_accessed_at = ${now}
        WHERE memory_id = ${memoryId}
      `;
    }).pipe(Effect.mapError(toPersistenceSqlError("MemoryRepository.recordAccess:query")));

  const findThreadSummaryRows = SqlSchema.findAll({
    Request: Schema.Struct({ threadId: TrimmedNonEmptyString }),
    Result: MemoryDbRowSchema,
    execute: (input) =>
      sql.unsafe(
        `SELECT ${MEMORY_SELECT_COLUMNS} FROM projection_memories
         WHERE thread_id = ? AND scope = 'thread' AND archived_at IS NULL
         LIMIT 1`,
        [input.threadId],
      ),
  });

  const findThreadSummary: MemoryRepositoryShape["findThreadSummary"] = (threadId) =>
    findThreadSummaryRows({ threadId: threadId as typeof TrimmedNonEmptyString.Type }).pipe(
      Effect.map((rows) => (rows.length > 0 ? rowToMemory(rows[0]!) : null)),
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "MemoryRepository.findThreadSummary:query",
          "MemoryRepository.findThreadSummary:decode",
        ),
      ),
    );

  const upsertThreadSummary: MemoryRepositoryShape["upsertThreadSummary"] = (input) =>
    Effect.gen(function* () {
      // Delete any existing thread summary for this thread
      yield* sql`
        DELETE FROM projection_memories
        WHERE thread_id = ${input.threadId} AND scope = 'thread'
      `;

      // Insert the new thread summary
      return yield* create({
        threadId: input.threadId as ThreadId,
        projectId: input.projectId as ProjectId,
        scope: "thread",
        category: "fact",
        source: "auto",
        title: input.title as typeof TrimmedNonEmptyString.Type,
        content: input.content as typeof TrimmedNonEmptyString.Type,
      });
    }).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "MemoryRepository.upsertThreadSummary:query",
          "MemoryRepository.upsertThreadSummary:encodeRequest",
        ),
      ),
    );

  return {
    create,
    update,
    archive,
    delete: del,
    listByProject,
    search,
    getRelevantForThread,
    recordAccess,
    findThreadSummary,
    upsertThreadSummary,
  } satisfies MemoryRepositoryShape;
});

export const MemoryRepositoryLive = Layer.effect(MemoryRepository, makeMemoryRepository);
