/**
 * Hook that fetches review comments for a thread and converts them
 * to DiffAnnotation[] for the diff annotation pipeline.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ThreadId } from "@t3tools/contracts";
import {
  reviewCommentListQueryOptions,
  reviewCommentPublishMutationOptions,
  reviewRequestListQueryOptions,
  invalidateReviewCommentQueries,
} from "../lib/reviewReactQuery";
import type { ReviewCommentAnnotation } from "../lib/diffAnnotations";
import { useCallback } from "react";
import { useStore } from "../store";

export function useReviewAnnotations(
  threadId: ThreadId | null | undefined,
): ReviewCommentAnnotation[] {
  const queryClient = useQueryClient();
  const { data: comments } = useQuery({
    ...reviewCommentListQueryOptions(threadId!),
    enabled: !!threadId,
    refetchInterval: 5_000,
  });

  const activeThread = useStore((store) =>
    threadId ? store.threads.find((t) => t.id === threadId) : undefined,
  );
  const activeProject = useStore((store) =>
    activeThread?.projectId
      ? store.projects.find((p) => p.id === activeThread.projectId)
      : undefined,
  );
  const cwd = activeThread?.worktreePath ?? activeProject?.cwd ?? "";

  // Look up the PR URL from the review request linked to this thread.
  const { data: reviewRequests } = useQuery({
    ...reviewRequestListQueryOptions(),
    enabled: !!threadId,
  });
  const prUrl = reviewRequests?.reviewRequests.find((r) => r.threadId === threadId)?.prUrl ?? "";

  const publishMutation = useMutation(reviewCommentPublishMutationOptions());

  const onPublish = useCallback(
    (commentId: string) => {
      if (!threadId || !cwd || !prUrl) return;
      publishMutation.mutate(
        { threadId, cwd, prUrl, commentId },
        {
          onSuccess: () => {
            void invalidateReviewCommentQueries(queryClient, threadId);
          },
        },
      );
    },
    [threadId, cwd, prUrl, publishMutation, queryClient],
  );

  const list = comments?.comments;
  if (!list || list.length === 0) return [];

  return list.map((c): ReviewCommentAnnotation => {
    const annotation: ReviewCommentAnnotation = {
      kind: "reviewComment",
      id: c.id,
      file: c.file,
      startLine: c.startLine,
      body: c.body,
      severity: c.severity,
    };
    if (c.endLine != null) annotation.endLine = c.endLine;
    if (c.publishedAt) annotation.publishedAt = c.publishedAt;
    if (c.publishedUrl) annotation.publishedUrl = c.publishedUrl;
    if (prUrl) annotation.onPublish = onPublish;
    return annotation;
  });
}
