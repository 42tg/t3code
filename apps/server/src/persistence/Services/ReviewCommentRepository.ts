/**
 * ReviewCommentRepository - Repository interface for code review comments.
 *
 * Owns persistence operations for review comments attached to threads.
 * Comments are anchored to file locations and carry a severity level.
 *
 * @module ReviewCommentRepository
 */
import {
  type ReviewComment,
  ReviewCommentAddInput,
  ReviewCommentDeleteInput,
  ReviewCommentListInput,
  ReviewCommentUpdateInput,
} from "@t3tools/contracts";
import { ServiceMap } from "effect";
import type { Effect } from "effect";

import type { PersistenceSqlError, PersistenceDecodeError } from "../Errors.ts";

export type ReviewCommentRepositoryError = PersistenceSqlError | PersistenceDecodeError;

/**
 * ReviewCommentRepositoryShape - Service API for review comment persistence.
 */
export interface ReviewCommentRepositoryShape {
  /**
   * Insert a new review comment.
   *
   * Generates `id`, `createdAt`, and `updatedAt` server-side.
   * Returns the full persisted ReviewComment.
   */
  readonly add: (
    input: typeof ReviewCommentAddInput.Type,
  ) => Effect.Effect<ReviewComment, ReviewCommentRepositoryError>;

  /**
   * Update an existing review comment's body and/or severity.
   *
   * Automatically bumps `updatedAt`.
   */
  readonly update: (
    input: typeof ReviewCommentUpdateInput.Type,
  ) => Effect.Effect<void, ReviewCommentRepositoryError>;

  /**
   * Delete a single review comment by id.
   */
  readonly delete: (
    input: typeof ReviewCommentDeleteInput.Type,
  ) => Effect.Effect<void, ReviewCommentRepositoryError>;

  /**
   * List all review comments for a thread.
   *
   * Returned ordered by file path, then start_line ascending.
   */
  readonly listByThreadId: (
    input: typeof ReviewCommentListInput.Type,
  ) => Effect.Effect<ReadonlyArray<ReviewComment>, ReviewCommentRepositoryError>;

  /**
   * Bulk delete all review comments for a thread.
   */
  readonly deleteByThreadId: (
    input: typeof ReviewCommentListInput.Type,
  ) => Effect.Effect<void, ReviewCommentRepositoryError>;
}

/**
 * ReviewCommentRepository - Service tag for review comment persistence.
 */
export class ReviewCommentRepository extends ServiceMap.Service<
  ReviewCommentRepository,
  ReviewCommentRepositoryShape
>()("t3/persistence/Services/ReviewCommentRepository") {}
