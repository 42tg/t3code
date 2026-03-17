/**
 * Aggregates all annotation sources for a thread's diff views.
 *
 * Currently sources review comments; designed to be extended with additional
 * annotation providers (lint warnings, AI suggestions, etc.) by adding
 * more queries here and merging the results.
 *
 * DiffPanel and any other diff consumer should use this hook to get
 * annotations — they should never directly import review-comment-specific
 * query options or conversion helpers.
 */

import type { ThreadId } from "@t3tools/contracts";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { type DiffAnnotation, reviewCommentsToAnnotations } from "../lib/diffAnnotations";
import {
  reviewCommentListQueryOptions,
  REVIEW_COMMENT_POLL_INTERVAL_ACTIVE,
} from "../lib/reviewCommentReactQuery";

/**
 * Returns a flat list of all annotations for the given thread.
 *
 * Polls for new review comments while the agent is actively running;
 * stops when idle. Future annotation sources (lint, AI suggestions, …)
 * will be merged here so consumers get a single, source-agnostic list.
 */
export function useDiffAnnotations(
  threadId: ThreadId | null,
  isAgentActive: boolean,
): DiffAnnotation[] {
  const reviewCommentsQuery = useQuery(
    reviewCommentListQueryOptions(
      threadId,
      isAgentActive ? REVIEW_COMMENT_POLL_INTERVAL_ACTIVE : false,
    ),
  );

  return useMemo(() => {
    const comments = reviewCommentsQuery.data?.comments;
    if (!comments || comments.length === 0) return [];
    return reviewCommentsToAnnotations(comments);
    // Future: concat with lint annotations, AI suggestion annotations, etc.
  }, [reviewCommentsQuery.data?.comments]);
}
