import { useCallback, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  DEFAULT_RUNTIME_MODE,
  type GitFetchPrDetailsResult,
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
import { toastManager } from "./ui/toast";
import {
  gitCreateWorktreeMutationOptions,
  gitFetchPrDetailsMutationOptions,
  gitListOpenPrsQueryOptions,
  invalidateGitQueries,
} from "../lib/gitReactQuery";
import { buildReviewPrompt } from "../lib/prReviewUtils";
import { newThreadId } from "../lib/utils";
import { useComposerDraftStore } from "../composerDraftStore";

interface ReviewPrDialogProps {
  projectId: ProjectId;
  projectCwd: string;
  /** Optional `owner/repo` to scope the PR list to the correct remote (important for forks). */
  repo?: string;
  onClose: () => void;
}

export default function ReviewPrDialog({
  projectId,
  projectCwd,
  repo,
  onClose,
}: ReviewPrDialogProps) {
  const [prDetails, setPrDetails] = useState<GitFetchPrDetailsResult | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const setProjectDraftThreadId = useComposerDraftStore((store) => store.setProjectDraftThreadId);

  const fetchPrMutation = useMutation(gitFetchPrDetailsMutationOptions());
  const createWorktreeMutation = useMutation(gitCreateWorktreeMutationOptions({ queryClient }));
  const openPrsQuery = useQuery(gitListOpenPrsQueryOptions(projectCwd, repo));

  const handleStartReview = useCallback(async () => {
    if (!prDetails) return;

    setIsCreating(true);
    try {
      // Fetch the PR branch into local refs
      const worktreeResult = await createWorktreeMutation.mutateAsync({
        cwd: projectCwd,
        branch: `origin/${prDetails.headRefName}`,
        newBranch: `review/pr-${prDetails.number}-${Date.now().toString(36)}`,
      });

      const threadId = newThreadId();
      const createdAt = new Date().toISOString();

      // Create the draft thread with worktree context
      setProjectDraftThreadId(projectId, threadId, {
        createdAt,
        branch: prDetails.headRefName,
        worktreePath: worktreeResult.worktree.path,
        envMode: "worktree",
        runtimeMode: DEFAULT_RUNTIME_MODE,
      });

      // Pre-fill the composer with the review prompt
      useComposerDraftStore.getState().setPrompt(threadId, buildReviewPrompt(prDetails));

      await invalidateGitQueries(queryClient);

      // Navigate to the new thread
      await navigate({
        to: "/$threadId",
        params: { threadId },
      });

      // Close dialog and reset state
      onClose();
      setPrDetails(null);
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
    createWorktreeMutation,
    navigate,
    onClose,
    prDetails,
    projectCwd,
    projectId,
    queryClient,
    setProjectDraftThreadId,
  ]);

  const isBusy = fetchPrMutation.isPending || isCreating;

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <GitPullRequestIcon className="size-5" />
          Review Pull Request
        </DialogTitle>
        <DialogDescription>Select a pull request to create a review workspace.</DialogDescription>
      </DialogHeader>

      <DialogPanel>
        <div className="flex flex-col gap-4">
          {!prDetails && openPrsQuery.data && openPrsQuery.data.pullRequests.length > 0 && (
            <div className="flex flex-col gap-1">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground/60">
                Open pull requests
              </p>
              <div className="max-h-48 overflow-y-auto rounded-md border border-border/70">
                {openPrsQuery.data.pullRequests.map((pr) => (
                  <button
                    key={pr.number}
                    type="button"
                    className="flex w-full items-center gap-2 border-b border-border/40 px-3 py-2 text-left transition-colors last:border-b-0 hover:bg-accent/50"
                    disabled={isBusy}
                    onClick={() => {
                      setPrDetails(null);
                      fetchPrMutation.mutate(
                        { cwd: projectCwd, prUrl: pr.url },
                        {
                          onSuccess: (data) => setPrDetails(data),
                          onError: (error) => {
                            toastManager.add({
                              type: "error",
                              title: "Failed to fetch PR details",
                              description:
                                error instanceof Error ? error.message : "An error occurred.",
                            });
                          },
                        },
                      );
                    }}
                  >
                    <GitPullRequestIcon className="size-3.5 shrink-0 text-emerald-500" />
                    <span className="min-w-0 flex-1 truncate text-xs font-medium">
                      #{pr.number} {pr.title}
                    </span>
                    <span className="shrink-0 text-[10px] text-muted-foreground/60">
                      {pr.headRefName}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {!prDetails && openPrsQuery.data && openPrsQuery.data.pullRequests.length === 0 && (
            <p className="py-2 text-center text-xs text-muted-foreground/60">
              No open pull requests
            </p>
          )}

          {!prDetails && openPrsQuery.isLoading && (
            <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground/60">
              <LoaderIcon className="size-3 animate-spin" />
              Loading open pull requests...
            </div>
          )}

          {prDetails && (
            <div className="rounded-lg border bg-muted/50 p-3">
              <div className="flex items-start gap-2">
                <GitPullRequestIcon
                  className={`mt-0.5 size-4 shrink-0 ${
                    prDetails.state === "OPEN"
                      ? "text-emerald-500"
                      : prDetails.state === "MERGED"
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
                      {prDetails.baseRefName} &larr; {prDetails.headRefName}
                    </span>
                    <span className="text-emerald-500">+{prDetails.additions}</span>
                    <span className="text-rose-500">-{prDetails.deletions}</span>
                    <span>
                      {prDetails.changedFiles} file{prDetails.changedFiles !== 1 ? "s" : ""}
                    </span>
                  </div>
                  {prDetails.body.trim().length > 0 && (
                    <p className="mt-2 line-clamp-3 text-xs text-muted-foreground">
                      {prDetails.body.trim()}
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {fetchPrMutation.isError && (
            <p className="text-xs text-destructive">
              {fetchPrMutation.error instanceof Error
                ? fetchPrMutation.error.message
                : "Failed to fetch PR details."}
            </p>
          )}
        </div>
      </DialogPanel>

      <DialogFooter variant="bare">
        <Button onClick={handleStartReview} disabled={!prDetails || isBusy}>
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
