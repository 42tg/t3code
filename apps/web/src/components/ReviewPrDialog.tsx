import { useCallback, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  DEFAULT_RUNTIME_MODE,
  type GitResolvedPullRequest,
  type ProjectId,
} from "@t3tools/contracts";
import { GitPullRequestIcon, LoaderIcon } from "lucide-react";

import {
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogPanel,
  DialogFooter,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { toastManager } from "./ui/toast";
import {
  gitPreparePullRequestThreadMutationOptions,
  gitResolvePullRequestQueryOptions,
  invalidateGitQueries,
} from "../lib/gitReactQuery";
import { buildReviewPrompt, normalizePrReference } from "../lib/prReviewUtils";
import { newThreadId } from "../lib/utils";
import { ensureNativeApi } from "../nativeApi";
import { useComposerDraftStore } from "../composerDraftStore";
import { parsePullRequestReference } from "../pullRequestReference";

interface ReviewPrDialogProps {
  projectId: ProjectId;
  projectCwd: string;
  onClose: () => void;
}

export default function ReviewPrDialog({ projectId, projectCwd, onClose }: ReviewPrDialogProps) {
  const [prReference, setPrReference] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const setProjectDraftThreadId = useComposerDraftStore((store) => store.setProjectDraftThreadId);

  const parsedReference = parsePullRequestReference(prReference);
  const resolveQuery = useQuery(
    gitResolvePullRequestQueryOptions({
      cwd: projectCwd,
      reference: parsedReference,
    }),
  );

  const prDetails: GitResolvedPullRequest | null = resolveQuery.data?.pullRequest ?? null;

  const prepareMutation = useMutation(
    gitPreparePullRequestThreadMutationOptions({ cwd: projectCwd, queryClient }),
  );

  const handleStartReview = useCallback(async () => {
    if (!parsedReference) return;

    setIsCreating(true);
    try {
      const normalized = normalizePrReference(prReference);
      const prepareResult = await prepareMutation.mutateAsync({
        reference: normalized,
        mode: "worktree",
      });

      const api = ensureNativeApi();
      const pr = prepareResult.pullRequest;

      // Create a unique worktree for this review session
      const reviewBranch = `review/pr-${pr.number}-${Date.now().toString(36)}`;
      const worktreeResult = await api.git.createWorktree({
        cwd: projectCwd,
        branch: prepareResult.branch,
        newBranch: reviewBranch,
        path: null,
      });

      const threadId = newThreadId();
      const createdAt = new Date().toISOString();

      setProjectDraftThreadId(projectId, threadId, {
        createdAt,
        branch: reviewBranch,
        worktreePath: worktreeResult.worktree.path,
        envMode: "worktree",
        runtimeMode: DEFAULT_RUNTIME_MODE,
      });

      useComposerDraftStore.getState().setPrompt(threadId, buildReviewPrompt(pr));
      await invalidateGitQueries(queryClient);

      await navigate({
        to: "/$threadId",
        params: { threadId },
      });

      onClose();
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Failed to set up PR review",
        description: error instanceof Error ? error.message : "An error occurred.",
      });
    } finally {
      setIsCreating(false);
    }
  }, [
    navigate,
    onClose,
    parsedReference,
    prReference,
    prepareMutation,
    projectCwd,
    projectId,
    queryClient,
    setProjectDraftThreadId,
  ]);

  const isBusy = prepareMutation.isPending || isCreating;
  const canSubmit = parsedReference !== null;

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <GitPullRequestIcon className="size-5" />
          Review Pull Request
        </DialogTitle>
        <DialogDescription>
          Enter a PR number or URL to create a review workspace.
        </DialogDescription>
      </DialogHeader>

      <DialogPanel>
        <div className="flex flex-col gap-4">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (canSubmit && prDetails) {
                void handleStartReview();
              }
            }}
          >
            <Input
              placeholder="PR number or https://github.com/owner/repo/pull/123"
              value={prReference}
              onChange={(event) => setPrReference(event.target.value)}
              disabled={isBusy}
              autoFocus
            />
          </form>

          {resolveQuery.isLoading && parsedReference && (
            <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground/60">
              <LoaderIcon className="size-3 animate-spin" />
              Looking up pull request...
            </div>
          )}

          {prDetails && (
            <div className="rounded-lg border bg-muted/50 p-3">
              <div className="flex items-start gap-2">
                <GitPullRequestIcon
                  className={`mt-0.5 size-4 shrink-0 ${
                    prDetails.state === "open"
                      ? "text-emerald-500"
                      : prDetails.state === "merged"
                        ? "text-violet-500"
                        : "text-zinc-400"
                  }`}
                />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">
                    #{prDetails.number} {prDetails.title}
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                    <span>
                      {prDetails.baseBranch} &larr; {prDetails.headBranch}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {resolveQuery.isError && parsedReference && (
            <p className="text-xs text-destructive">
              {resolveQuery.error instanceof Error
                ? resolveQuery.error.message
                : "Failed to look up PR details."}
            </p>
          )}
        </div>
      </DialogPanel>

      <DialogFooter variant="bare">
        <Button onClick={() => void handleStartReview()} disabled={!prDetails || isBusy}>
          {isCreating ? (
            <>
              <LoaderIcon className="size-3.5 animate-spin" />
              Setting up...
            </>
          ) : (
            "Start Review"
          )}
        </Button>
      </DialogFooter>
    </>
  );
}
