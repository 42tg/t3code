import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { DEFAULT_RUNTIME_MODE, type ProjectId } from "@t3tools/contracts";
import { ClipboardCopyIcon, GitPullRequestIcon, LoaderIcon } from "lucide-react";

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
import { invalidateGitQueries } from "../lib/gitReactQuery";
import {
  GITHUB_PR_URL_REGEX,
  normalizePrReference,
  buildReviewPrompt,
  extractGitHubRepoUrlFromPrUrl,
} from "../lib/prReviewUtils";
import { newCommandId, newProjectId, newThreadId } from "../lib/utils";
import { ensureNativeApi } from "../nativeApi";
import { useSettings } from "../hooks/useSettings";
import { useComposerDraftStore } from "../composerDraftStore";
import type { Project } from "../types";
import type { GitResolvedPullRequest } from "@t3tools/contracts";

type Phase = "input" | "resolving" | "creating-worktree";

const PHASE_LABELS: Record<Phase, string> = {
  input: "",
  resolving: "Resolving pull request...",
  "creating-worktree": "Setting up review workspace...",
};

interface StandaloneReviewPrDialogProps {
  projects: Project[];
  /** Pre-fill the PR URL input (e.g. from a notification click). */
  initialPrUrl?: string;
  /** Called after a review thread is created, with the thread ID and PR URL. */
  onThreadCreated?: (threadId: string, prUrl: string) => void | Promise<void>;
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
  projects,
  initialPrUrl,
  onThreadCreated,
  onClose,
}: StandaloneReviewPrDialogProps) {
  const [prUrl, setPrUrl] = useState(initialPrUrl ?? "");
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("input");
  const [prDetails, setPrDetails] = useState<GitResolvedPullRequest | null>(null);

  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const setProjectDraftThreadId = useComposerDraftStore((store) => store.setProjectDraftThreadId);

  /**
   * Find the best project for the given PR URL by matching the repo name
   * from the URL against each project's workspace directory name.
   * Falls back to the project with the shortest cwd if no name match is found.
   */
  const findMatchingProject = useCallback(
    (url: string): { projectId: ProjectId; cwd: string } | null => {
      if (projects.length === 0) return null;

      // Extract repo name from the PR URL (e.g. "devex-backstage" from ".../devex-backstage/pull/313")
      const repoUrl = extractGitHubRepoUrlFromPrUrl(url);
      const repoName = repoUrl?.split("/").pop()?.toLowerCase();

      if (repoName) {
        // Find a project whose cwd contains the repo name
        const match = projects.find((p) => {
          const cwdLower = p.cwd.toLowerCase();
          // Check if repo name appears as a directory segment in the cwd
          return cwdLower.includes(`/${repoName}/`) || cwdLower.endsWith(`/${repoName}`);
        });
        if (match) {
          return { projectId: match.id, cwd: match.cwd };
        }
      }

      return null;
    },
    [projects],
  );

  const appSettings = useSettings();

  const handleResolve = useCallback(async () => {
    const trimmed = prUrl.trim();
    if (!trimmed) return;

    setError(null);
    setPrDetails(null);

    try {
      const api = ensureNativeApi();
      let match = findMatchingProject(trimmed);

      // If no existing project matches, try workspace roots to find/clone the repo.
      if (!match) {
        const repoUrl = extractGitHubRepoUrlFromPrUrl(trimmed);
        if (!repoUrl) {
          setError("Could not parse repository from PR URL.");
          return;
        }
        const workspaceRoots = appSettings.workspaceRoots;
        if (workspaceRoots.length === 0) {
          const repoName = repoUrl.split("/").pop();
          setError(
            `No project found for "${repoName}". Configure workspace roots in Settings to auto-discover or clone repositories.`,
          );
          return;
        }

        // Extract "owner/repo" from the URL
        const ownerRepo = repoUrl.replace("https://github.com/", "");

        setPhase("resolving");
        const resolved = await api.projects.resolveFromWorkspace({
          repository: ownerRepo,
          workspaceRoots: [...workspaceRoots],
        });

        // Bootstrap the resolved directory as a project via orchestration command.
        const projectId = newProjectId();
        const repoName = ownerRepo.split("/").pop() ?? ownerRepo;
        await api.orchestration.dispatchCommand({
          type: "project.create",
          commandId: newCommandId(),
          projectId,
          title: repoName,
          workspaceRoot: resolved.cwd,
          createdAt: new Date().toISOString(),
        });

        match = { projectId, cwd: resolved.cwd };
      }

      const { projectId, cwd } = match;
      const normalized = normalizePrReference(trimmed);

      if (phase !== "resolving") setPhase("resolving");

      // Resolve the PR reference to get pull request details and prepare the branch
      const prepareResult = await api.git.preparePullRequestThread({
        cwd,
        reference: normalized,
        mode: "worktree",
      });

      const pr = prepareResult.pullRequest;
      setPrDetails(pr);
      setPhase("creating-worktree");

      // preparePullRequestThread fetches the PR branch and may reuse an existing
      // worktree. For isolated reviews, create a unique worktree from the PR branch
      // so multiple review sessions don't share the same directory.
      const baseBranch = prepareResult.branch;
      const reviewBranch = `review/pr-${pr.number}-${Date.now().toString(36)}`;
      const worktreeResult = await api.git.createWorktree({
        cwd,
        branch: baseBranch,
        newBranch: reviewBranch,
        path: null,
      });
      const worktreePath = worktreeResult.worktree.path;

      const threadId = newThreadId();

      setProjectDraftThreadId(projectId, threadId, {
        createdAt: new Date().toISOString(),
        branch: reviewBranch,
        worktreePath,
        envMode: "worktree",
        runtimeMode: DEFAULT_RUNTIME_MODE,
      });

      useComposerDraftStore.getState().setPrompt(threadId, buildReviewPrompt(pr));
      await invalidateGitQueries(queryClient);

      // Ensure a review request record exists and is linked to this thread.
      const repoUrl = extractGitHubRepoUrlFromPrUrl(trimmed);
      const ownerRepo = repoUrl?.replace("https://github.com/", "") ?? "";
      try {
        await api.reviewRequest.upsert({
          prUrl: normalizePrReference(trimmed),
          prNumber: pr.number,
          prTitle: pr.title,
          repoNameWithOwner: ownerRepo,
          threadId,
        });
        await queryClient.invalidateQueries({ queryKey: ["reviewRequest"] });
      } catch {
        // Best-effort — publish buttons won't show but review still works
      }

      await onThreadCreated?.(threadId, prUrl);

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
    phase,
    findMatchingProject,
    appSettings.workspaceRoots,
    queryClient,
    navigate,
    onClose,
    onThreadCreated,
    setProjectDraftThreadId,
  ]);

  // Auto-trigger resolve when opened with a pre-filled URL (e.g. from notification bell)
  const autoTriggeredRef = useRef(false);
  useEffect(() => {
    if (initialPrUrl && !autoTriggeredRef.current && phase === "input") {
      autoTriggeredRef.current = true;
      void handleResolve();
    }
  }, [initialPrUrl, handleResolve, phase]);

  const isBusy = phase !== "input";
  const canSubmit = prUrl.trim().length > 0 && GITHUB_PR_URL_REGEX.test(prUrl.trim());

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <GitPullRequestIcon className="size-5" />
          Review Pull Request
        </DialogTitle>
        <DialogDescription>Enter a GitHub PR URL to create a review workspace.</DialogDescription>
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

          {error && (
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
