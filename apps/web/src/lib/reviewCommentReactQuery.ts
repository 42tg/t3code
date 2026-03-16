import type { ReviewCommentSeverity, ThreadId } from "@t3tools/contracts";
import { mutationOptions, queryOptions, type QueryClient } from "@tanstack/react-query";
import { ensureNativeApi } from "../nativeApi";

const REVIEW_COMMENTS_STALE_TIME_MS = 5_000;

export const REVIEW_COMMENT_POLL_INTERVAL_ACTIVE = 2_000;

export const reviewCommentQueryKeys = {
  all: ["reviewComments"] as const,
  list: (threadId: ThreadId | null) => ["reviewComments", "list", threadId] as const,
};

export function invalidateReviewCommentQueries(queryClient: QueryClient, threadId: ThreadId) {
  return queryClient.invalidateQueries({ queryKey: reviewCommentQueryKeys.list(threadId) });
}

export function reviewCommentListQueryOptions(
  threadId: ThreadId | null,
  refetchInterval: number | false = false,
) {
  return queryOptions({
    queryKey: reviewCommentQueryKeys.list(threadId),
    queryFn: async () => {
      const api = ensureNativeApi();
      if (!threadId) throw new Error("Thread ID is required.");
      return api.reviewComment.list({ threadId });
    },
    enabled: threadId !== null,
    staleTime: REVIEW_COMMENTS_STALE_TIME_MS,
    refetchOnWindowFocus: true,
    refetchInterval,
  });
}

export function reviewCommentAddMutationOptions(input: {
  threadId: ThreadId;
  queryClient: QueryClient;
}) {
  return mutationOptions({
    mutationKey: ["reviewComments", "mutation", "add", input.threadId] as const,
    mutationFn: async (comment: {
      file: string;
      startLine: number;
      endLine?: number;
      body: string;
      severity: ReviewCommentSeverity;
    }) => {
      const api = ensureNativeApi();
      return api.reviewComment.add({ threadId: input.threadId, ...comment });
    },
    onSettled: async () => {
      await invalidateReviewCommentQueries(input.queryClient, input.threadId);
    },
  });
}

export function reviewCommentUpdateMutationOptions(input: {
  threadId: ThreadId;
  queryClient: QueryClient;
}) {
  return mutationOptions({
    mutationKey: ["reviewComments", "mutation", "update", input.threadId] as const,
    mutationFn: async (patch: { id: string; body?: string; severity?: ReviewCommentSeverity }) => {
      const api = ensureNativeApi();
      return api.reviewComment.update(patch);
    },
    onSettled: async () => {
      await invalidateReviewCommentQueries(input.queryClient, input.threadId);
    },
  });
}

export function reviewCommentDeleteMutationOptions(input: {
  threadId: ThreadId;
  queryClient: QueryClient;
}) {
  return mutationOptions({
    mutationKey: ["reviewComments", "mutation", "delete", input.threadId] as const,
    mutationFn: async (id: string) => {
      const api = ensureNativeApi();
      return api.reviewComment.delete({ id });
    },
    onSettled: async () => {
      await invalidateReviewCommentQueries(input.queryClient, input.threadId);
    },
  });
}

export function reviewCommentPublishMutationOptions() {
  return mutationOptions({
    mutationKey: ["reviewComments", "mutation", "publish"] as const,
    mutationFn: async (params: { threadId: ThreadId; cwd: string; prUrl: string }) => {
      const api = ensureNativeApi();
      return api.reviewComment.publish(params);
    },
  });
}
