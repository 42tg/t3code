import { useCallback, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  DEFAULT_MODEL_BY_PROVIDER,
  DEFAULT_RUNTIME_MODE,
  type GitFetchPrDetailsResult,
  type ProjectId,
} from "@t3tools/contracts";
import { extractGitHubRepoUrlFromPrUrl } from "@t3tools/shared/git";
import { ClipboardCopyIcon, GitPullRequestIcon, LoaderIcon, SettingsIcon } from "lucide-react";

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
  gitCloneRepoMutationOptions,
  gitFetchPrDetailsMutationOptions,
  invalidateGitQueries,
} from "../lib/gitReactQuery";
import { GITHUB_PR_URL_REGEX, normalizePrReference, buildReviewPrompt } from "../lib/prReviewUtils";
import { newCommandId, newProjectId, newThreadId } from "../lib/utils";
import { readNativeApi } from "../nativeApi";
import { useComposerDraftStore } from "../composerDraftStore";
import type { Project } from "../types";

type Phase = "input" | "cloning" | "fetching-pr" | "creating-worktree";

const PHASE_LABELS: Record<Phase, string> = {
  input: "",
  cloning: "Cloning repository...",
  "fetching-pr": "Fetching PR details...",
  "creating-worktree": "Setting up review workspace...",
};

interface StandaloneReviewPrDialogProps {
  githubUrlByProjectId: Map<ProjectId, string>;
  projects: Project[];
  projectsWorkingDirectory: string;
  onClose: () => void;
}

function ErrorDisplay({ error, onCopy }: { error: string; onCopy: () => void }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
      <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all text-xs text-destructive">
        {error}
      </pre>
      <Button size="xs" variant="ghost" className="self-end text-muted-foreground" onClick={onCopy}>
        <ClipboardCopyIcon className="size-3" />
        Copy
      </Button>
    </div>
  );
}

export default function StandaloneReviewPrDialog({
  githubUrlByProjectId,
  projects,
  projectsWorkingDirectory,
  onClose,
}: StandaloneReviewPrDialogProps) {
  const [prUrl, setPrUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("input");
  const [prDetails, setPrDetails] = useState<GitFetchPrDetailsResult | null>(null);

  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const setProjectDraftThreadId = useComposerDraftStore((store) => store.setProjectDraftThreadId);

  const cloneRepoMutation = useMutation(gitCloneRepoMutationOptions());
  const fetchPrMutation = useMutation(gitFetchPrDetailsMutationOptions());

  const findMatchingProject = useCallback(
    (repoUrl: string): { projectId: ProjectId; cwd: string } | null => {
      const normalizedRepoUrl = repoUrl.toLowerCase();
      for (const [projectId, githubUrl] of githubUrlByProjectId) {
        if (githubUrl.toLowerCase() === normalizedRepoUrl) {
          const project = projects.find((p) => p.id === projectId);
          if (project) {
            return { projectId, cwd: project.cwd };
          }
        }
      }
      return null;
    },
    [githubUrlByProjectId, projects],
  );

  const handleResolve = useCallback(async () => {
    const trimmed = prUrl.trim();
    if (!trimmed) return;

    setError(null);
    setPrDetails(null);

    try {
      const repoUrl = extractGitHubRepoUrlFromPrUrl(trimmed);
      if (!repoUrl) {
        setError(
          "Please enter a valid GitHub PR URL (e.g. https://github.com/owner/repo/pull/123).",
        );
        return;
      }

      // Check if a matching project already exists
      const match = findMatchingProject(repoUrl);

      let projectId: ProjectId;
      let cwd: string;

      if (match) {
        projectId = match.projectId;
        cwd = match.cwd;
      } else {
        // No matching project — need to clone
        if (!projectsWorkingDirectory.trim()) {
          setError(
            "No matching project found. Configure a default clone directory in Settings to clone new repos automatically.",
          );
          return;
        }

        setPhase("cloning");
        const cloneUrl = `${repoUrl}.git`;
        const result = await cloneRepoMutation.mutateAsync({
          url: cloneUrl,
          targetDir: projectsWorkingDirectory.trim(),
        });

        const api = readNativeApi();
        if (!api) {
          setError("Native API not available.");
          setPhase("input");
          return;
        }

        projectId = newProjectId();
        cwd = result.clonedPath;
        const title = cwd.split(/[/\\]/).findLast((s) => s.length > 0) ?? "project";

        await api.orchestration.dispatchCommand({
          type: "project.create",
          commandId: newCommandId(),
          projectId,
          title,
          workspaceRoot: cwd,
          defaultModel: DEFAULT_MODEL_BY_PROVIDER.claudeCode,
          createdAt: new Date().toISOString(),
        });
      }

      // Fetch PR details and materialize the branch (handles forks) in parallel
      setPhase("fetching-pr");
      const normalized = normalizePrReference(trimmed);

      const api = readNativeApi();
      if (!api) {
        setError("Native API not available.");
        setPhase("input");
        return;
      }

      const [details, prepareResult] = await Promise.all([
        fetchPrMutation.mutateAsync({ cwd, prUrl: normalized }),
        api.git.preparePullRequestThread({ cwd, reference: normalized, mode: "worktree" }),
      ]);

      setPrDetails(details);
      setPhase("creating-worktree");

      // Create a unique worktree for this review session, based on the
      // materialized PR branch (which preparePullRequestThread already fetched).
      const reviewBranch = `review/pr-${details.number}-${Date.now().toString(36)}`;
      const worktreeResult = await api.git.createWorktree({
        cwd,
        branch: prepareResult.branch,
        newBranch: reviewBranch,
        path: null,
      });

      // Link the review branch to the PR's remote branch so `git push` works.
      await api.git.setBranchUpstream({
        cwd: worktreeResult.worktree.path,
        branch: reviewBranch,
        remoteName: "origin",
        remoteBranch: details.headRefName,
      });

      const threadId = newThreadId();

      setProjectDraftThreadId(projectId, threadId, {
        createdAt: new Date().toISOString(),
        branch: reviewBranch,
        worktreePath: worktreeResult.worktree.path,
        envMode: "worktree",
        runtimeMode: DEFAULT_RUNTIME_MODE,
      });

      useComposerDraftStore.getState().setPrompt(threadId, buildReviewPrompt(details));
      await invalidateGitQueries(queryClient);

      await navigate({
        to: "/$threadId",
        params: { threadId },
      });

      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : "An unexpected error occurred.";
      setError(message);
      setPhase("input");
    }
  }, [
    prUrl,
    findMatchingProject,
    projectsWorkingDirectory,
    cloneRepoMutation,
    fetchPrMutation,
    queryClient,
    navigate,
    onClose,
    setProjectDraftThreadId,
  ]);

  const isBusy = phase !== "input";
  const canSubmit = prUrl.trim().length > 0 && GITHUB_PR_URL_REGEX.test(prUrl.trim());
  const needsWorkingDir =
    !projectsWorkingDirectory.trim() &&
    prUrl.trim().length > 0 &&
    extractGitHubRepoUrlFromPrUrl(prUrl.trim()) !== null &&
    !findMatchingProject(extractGitHubRepoUrlFromPrUrl(prUrl.trim()) ?? "");

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <GitPullRequestIcon className="size-5" />
          Review Pull Request
        </DialogTitle>
        <DialogDescription>
          Enter a GitHub PR URL. The repo will be matched to an existing project or cloned
          automatically.
        </DialogDescription>
      </DialogHeader>

      <DialogPanel>
        <div className="flex flex-col gap-4">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void handleResolve();
            }}
          >
            <div className="flex gap-2">
              <Input
                placeholder="https://github.com/owner/repo/pull/123"
                value={prUrl}
                onChange={(event) => {
                  setPrUrl(event.target.value);
                  setError(null);
                }}
                disabled={isBusy}
                autoFocus
              />
              <Button type="submit" disabled={!canSubmit || isBusy}>
                {isBusy ? <LoaderIcon className="size-3.5 animate-spin" /> : "Review"}
              </Button>
            </div>
          </form>

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
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className="flex flex-col gap-2">
              <ErrorDisplay
                error={error}
                onCopy={() => {
                  void navigator.clipboard
                    .writeText(error)
                    .then(() =>
                      toastManager.add({ type: "info", title: "Error copied to clipboard" }),
                    );
                }}
              />
              {needsWorkingDir && (
                <Button
                  size="xs"
                  variant="outline"
                  className="self-start"
                  onClick={() => {
                    onClose();
                    void navigate({ to: "/settings" });
                  }}
                >
                  <SettingsIcon className="size-3" />
                  Open Settings
                </Button>
              )}
            </div>
          )}

          {isBusy && (
            <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground/60">
              <LoaderIcon className="size-3 animate-spin" />
              {PHASE_LABELS[phase]}
            </div>
          )}
        </div>
      </DialogPanel>

      <DialogFooter variant="bare">
        <Button variant="outline" onClick={onClose} disabled={isBusy}>
          Cancel
        </Button>
      </DialogFooter>
    </>
  );
}
