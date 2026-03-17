import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import {
  ReviewComment,
  ReviewCommentDeleteInput,
  ReviewCommentListInput,
  ReviewCommentUpdateInput,
  PositiveInt,
  ThreadId,
  TrimmedNonEmptyString,
  ReviewCommentSeverity,
} from "@t3tools/contracts";
import { Effect, Layer, Schema } from "effect";

import { toPersistenceDecodeError, toPersistenceSqlError } from "../Errors.ts";

import {
  ReviewCommentRepository,
  type ReviewCommentRepositoryShape,
  type ReviewCommentRepositoryError,
} from "../Services/ReviewCommentRepository.ts";

/**
 * DB row schema: end_line comes back as number | null from SQLite,
 * so we map the optional field to NullOr for the database representation.
 */
const ReviewCommentDbRowSchema = Schema.Struct({
  id: TrimmedNonEmptyString,
  threadId: ThreadId,
  file: TrimmedNonEmptyString,
  startLine: PositiveInt,
  endLine: Schema.NullOr(PositiveInt),
  body: TrimmedNonEmptyString,
  severity: ReviewCommentSeverity,
  createdAt: Schema.String,
  updatedAt: Schema.String,
  publishedAt: Schema.NullOr(Schema.String),
  publishedUrl: Schema.NullOr(Schema.String),
});

function toPersistenceSqlOrDecodeError(sqlOperation: string, decodeOperation: string) {
  return (cause: unknown): ReviewCommentRepositoryError =>
    Schema.isSchemaError(cause)
      ? toPersistenceDecodeError(decodeOperation)(cause)
      : toPersistenceSqlError(sqlOperation)(cause);
}

const makeReviewCommentRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const insertReviewCommentRow = SqlSchema.void({
    Request: ReviewComment,
    execute: (row) =>
      sql`
        INSERT INTO review_comments (
          id,
          thread_id,
          file,
          start_line,
          end_line,
          body,
          severity,
          created_at,
          updated_at
        )
        VALUES (
          ${row.id},
          ${row.threadId},
          ${row.file},
          ${row.startLine},
          ${row.endLine ?? null},
          ${row.body},
          ${row.severity},
          ${row.createdAt},
          ${row.updatedAt}
        )
      `,
  });

  const updateReviewCommentRow = SqlSchema.void({
    Request: ReviewCommentUpdateInput,
    execute: (input) =>
      sql`
        UPDATE review_comments
        SET
          body = COALESCE(${input.body ?? null}, body),
          severity = COALESCE(${input.severity ?? null}, severity),
          published_at = COALESCE(${input.publishedAt ?? null}, published_at),
          published_url = COALESCE(${input.publishedUrl ?? null}, published_url),
          updated_at = ${new Date().toISOString()}
        WHERE id = ${input.id}
      `,
  });

  const deleteReviewCommentRow = SqlSchema.void({
    Request: ReviewCommentDeleteInput,
    execute: ({ id }) =>
      sql`
        DELETE FROM review_comments
        WHERE id = ${id}
      `,
  });

  const listReviewCommentRows = SqlSchema.findAll({
    Request: ReviewCommentListInput,
    Result: ReviewCommentDbRowSchema,
    execute: ({ threadId }) =>
      sql`
        SELECT
          id,
          thread_id AS "threadId",
          file,
          start_line AS "startLine",
          end_line AS "endLine",
          body,
          severity,
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          published_at AS "publishedAt",
          published_url AS "publishedUrl"
        FROM review_comments
        WHERE thread_id = ${threadId}
        ORDER BY file ASC, start_line ASC
      `,
  });

  const deleteByThreadIdRows = SqlSchema.void({
    Request: ReviewCommentListInput,
    execute: ({ threadId }) =>
      sql`
        DELETE FROM review_comments
        WHERE thread_id = ${threadId}
      `,
  });

  const add: ReviewCommentRepositoryShape["add"] = (input) => {
    const now = new Date().toISOString();
    const row: typeof ReviewComment.Type = {
      id: crypto.randomUUID() as typeof TrimmedNonEmptyString.Type,
      threadId: input.threadId,
      file: input.file,
      startLine: input.startLine,
      ...(input.endLine !== undefined ? { endLine: input.endLine } : {}),
      body: input.body,
      severity: input.severity,
      createdAt: now,
      updatedAt: now,
    };

    return insertReviewCommentRow(row).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "ReviewCommentRepository.add:query",
          "ReviewCommentRepository.add:encodeRequest",
        ),
      ),
      Effect.map(() => row),
    );
  };

  const update: ReviewCommentRepositoryShape["update"] = (input) =>
    updateReviewCommentRow(input).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "ReviewCommentRepository.update:query",
          "ReviewCommentRepository.update:encodeRequest",
        ),
      ),
    );

  const del: ReviewCommentRepositoryShape["delete"] = (input) =>
    deleteReviewCommentRow(input).pipe(
      Effect.mapError(toPersistenceSqlError("ReviewCommentRepository.delete:query")),
    );

  const listByThreadId: ReviewCommentRepositoryShape["listByThreadId"] = (input) =>
    listReviewCommentRows(input).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "ReviewCommentRepository.listByThreadId:query",
          "ReviewCommentRepository.listByThreadId:decodeRows",
        ),
      ),
      Effect.map((rows) =>
        rows.map((row) => ({
          id: row.id,
          threadId: row.threadId,
          file: row.file,
          startLine: row.startLine,
          ...(row.endLine !== null ? { endLine: row.endLine } : {}),
          body: row.body,
          severity: row.severity,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          ...(row.publishedAt !== null ? { publishedAt: row.publishedAt } : {}),
          ...(row.publishedUrl !== null ? { publishedUrl: row.publishedUrl } : {}),
        })),
      ),
    );

  const deleteByThreadId: ReviewCommentRepositoryShape["deleteByThreadId"] = (input) =>
    deleteByThreadIdRows(input).pipe(
      Effect.mapError(toPersistenceSqlError("ReviewCommentRepository.deleteByThreadId:query")),
    );

  return {
    add,
    update,
    delete: del,
    listByThreadId,
    deleteByThreadId,
  } satisfies ReviewCommentRepositoryShape;
});

export const ReviewCommentRepositoryLive = Layer.effect(
  ReviewCommentRepository,
  makeReviewCommentRepository,
);
