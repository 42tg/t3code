/**
 * ReviewRequestRepository - Repository interface for PR review requests.
 *
 * Owns persistence operations for incoming review request notifications.
 * Tracks pending, in-review, and dismissed states with optional thread linking.
 *
 * @module ReviewRequestRepository
 */
import type { ReviewRequest, ReviewRequestStatus } from "@t3tools/contracts";
import { ServiceMap } from "effect";
import type { Effect } from "effect";

import type { PersistenceSqlError, PersistenceDecodeError } from "../Errors.ts";

export type ReviewRequestRepositoryError = PersistenceSqlError | PersistenceDecodeError;

/**
 * UpsertInput - Data needed to insert or update a review request by pr_url.
 */
export interface ReviewRequestUpsertInput {
  readonly prUrl: string;
  readonly prNumber: number;
  readonly prTitle: string;
  readonly repoNameWithOwner: string;
  readonly authorLogin: string;
  readonly isBot: boolean;
  readonly prBody?: string;
  readonly prLabels?: readonly string[];
}

/**
 * UpdateStatusInput - Data needed to change a review request's status.
 */
export interface ReviewRequestUpdateStatusInput {
  readonly id: string;
  readonly status: ReviewRequestStatus;
  readonly threadId?: string;
}

/**
 * ReviewRequestRepositoryShape - Service API for review request persistence.
 */
export interface ReviewRequestRepositoryShape {
  /**
   * Insert a new review request or update an existing one by pr_url.
   *
   * Generates `id`, `createdAt`, and `updatedAt` server-side for new rows.
   * For existing rows, updates pr_title, pr_number, author_login, and bumps `updatedAt`.
   */
  readonly upsert: (
    input: ReviewRequestUpsertInput,
  ) => Effect.Effect<ReviewRequest, ReviewRequestRepositoryError>;

  /**
   * Update the status (and optionally thread_id) of a review request.
   *
   * Automatically bumps `updatedAt`.
   */
  readonly updateStatus: (
    input: ReviewRequestUpdateStatusInput,
  ) => Effect.Effect<void, ReviewRequestRepositoryError>;

  /**
   * List all non-dismissed review requests plus recently dismissed ones.
   *
   * Returns ordered by updatedAt descending.
   */
  readonly listActive: () => Effect.Effect<
    ReadonlyArray<ReviewRequest>,
    ReviewRequestRepositoryError
  >;

  /**
   * Mark as dismissed any review requests whose pr_url is NOT in the provided
   * list of active URLs and whose status is currently 'pending'.
   *
   * Used to auto-dismiss stale requests when PRs are closed or merged.
   */
  readonly dismissStale: (
    activeUrls: ReadonlyArray<string>,
  ) => Effect.Effect<void, ReviewRequestRepositoryError>;

  /**
   * Clear thread_id on review requests whose linked thread has been deleted.
   */
  readonly unlinkDeletedThreads: () => Effect.Effect<void, ReviewRequestRepositoryError>;
}

/**
 * ReviewRequestRepository - Service tag for review request persistence.
 */
export class ReviewRequestRepository extends ServiceMap.Service<
  ReviewRequestRepository,
  ReviewRequestRepositoryShape
>()("t3/persistence/Services/ReviewRequestRepository") {}
