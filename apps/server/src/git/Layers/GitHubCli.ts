import { Effect, Layer } from "effect";

import { runProcess } from "../../processRunner";
import { GitHubCliError } from "../Errors.ts";
import {
  GitHubCli,
  type GitHubCliShape,
  type GitHubPullRequestDetails,
} from "../Services/GitHubCli.ts";

const DEFAULT_TIMEOUT_MS = 30_000;

function normalizeGitHubCliError(operation: "execute" | "stdout", error: unknown): GitHubCliError {
  if (error instanceof Error) {
    if (error.message.includes("Command not found: gh")) {
      return new GitHubCliError({
        operation,
        detail: "GitHub CLI (`gh`) is required but not available on PATH.",
        cause: error,
      });
    }

    const lower = error.message.toLowerCase();
    if (
      lower.includes("authentication failed") ||
      lower.includes("not logged in") ||
      lower.includes("gh auth login") ||
      lower.includes("no oauth token")
    ) {
      return new GitHubCliError({
        operation,
        detail: "GitHub CLI is not authenticated. Run `gh auth login` and retry.",
        cause: error,
      });
    }

    return new GitHubCliError({
      operation,
      detail: `GitHub CLI command failed: ${error.message}`,
      cause: error,
    });
  }

  return new GitHubCliError({
    operation,
    detail: "GitHub CLI command failed.",
    cause: error,
  });
}

function parseOpenPullRequests(raw: string): ReadonlyArray<{
  number: number;
  title: string;
  url: string;
  baseRefName: string;
  headRefName: string;
}> {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return [];

  const parsed: unknown = JSON.parse(trimmed);
  if (!Array.isArray(parsed)) {
    throw new Error("GitHub CLI returned non-array JSON.");
  }

  const result: Array<{
    number: number;
    title: string;
    url: string;
    baseRefName: string;
    headRefName: string;
  }> = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const number = record.number;
    const title = record.title;
    const url = record.url;
    const baseRefName = record.baseRefName;
    const headRefName = record.headRefName;
    if (
      typeof number !== "number" ||
      !Number.isInteger(number) ||
      number <= 0 ||
      typeof title !== "string" ||
      typeof url !== "string" ||
      typeof baseRefName !== "string" ||
      typeof headRefName !== "string"
    ) {
      continue;
    }
    result.push({
      number,
      title,
      url,
      baseRefName,
      headRefName,
    });
  }

  return result;
}

const PR_DETAILS_JSON_FIELDS =
  "number,title,body,url,state,headRefName,baseRefName,additions,deletions,changedFiles";

function parsePrDetails(raw: string): GitHubPullRequestDetails {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new Error("GitHub CLI returned empty response for PR details.");
  }

  const parsed: unknown = JSON.parse(trimmed);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("GitHub CLI returned non-object JSON for PR details.");
  }

  const record = parsed as Record<string, unknown>;
  if (
    typeof record.number !== "number" ||
    typeof record.title !== "string" ||
    typeof record.url !== "string" ||
    typeof record.state !== "string" ||
    typeof record.headRefName !== "string" ||
    typeof record.baseRefName !== "string"
  ) {
    throw new Error("GitHub CLI returned incomplete PR details JSON.");
  }

  return {
    number: record.number,
    title: record.title,
    body: typeof record.body === "string" ? record.body : "",
    url: record.url,
    state: record.state as "OPEN" | "CLOSED" | "MERGED",
    headRefName: record.headRefName,
    baseRefName: record.baseRefName,
    additions: typeof record.additions === "number" ? record.additions : 0,
    deletions: typeof record.deletions === "number" ? record.deletions : 0,
    changedFiles: typeof record.changedFiles === "number" ? record.changedFiles : 0,
  };
}

const makeGitHubCli = Effect.sync(() => {
  const execute: GitHubCliShape["execute"] = (input) =>
    Effect.tryPromise({
      try: () =>
        runProcess("gh", input.args, {
          cwd: input.cwd,
          timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        }),
      catch: (error) => normalizeGitHubCliError("execute", error),
    });

  const service = {
    execute,
    listOpenPullRequests: (input) =>
      execute({
        cwd: input.cwd,
        args: [
          "pr",
          "list",
          "--head",
          input.headBranch,
          "--state",
          "open",
          "--limit",
          String(input.limit ?? 1),
          "--json",
          "number,title,url,baseRefName,headRefName",
        ],
      }).pipe(
        Effect.map((result) => result.stdout),
        Effect.flatMap((raw) =>
          Effect.try({
            try: () => parseOpenPullRequests(raw),
            catch: (error: unknown) =>
              new GitHubCliError({
                operation: "listOpenPullRequests",
                detail:
                  error instanceof Error
                    ? `GitHub CLI returned invalid PR list JSON: ${error.message}`
                    : "GitHub CLI returned invalid PR list JSON.",
                ...(error !== undefined ? { cause: error } : {}),
              }),
          }),
        ),
      ),
    createPullRequest: (input) =>
      execute({
        cwd: input.cwd,
        args: [
          "pr",
          "create",
          "--base",
          input.baseBranch,
          "--head",
          input.headBranch,
          "--title",
          input.title,
          "--body-file",
          input.bodyFile,
        ],
      }).pipe(Effect.asVoid),
    getDefaultBranch: (input) =>
      execute({
        cwd: input.cwd,
        args: ["repo", "view", "--json", "defaultBranchRef", "--jq", ".defaultBranchRef.name"],
      }).pipe(
        Effect.map((value) => {
          const trimmed = value.stdout.trim();
          return trimmed.length > 0 ? trimmed : null;
        }),
      ),
    fetchPrDetails: (input) =>
      execute({
        cwd: input.cwd,
        args: ["pr", "view", input.prUrl, "--json", PR_DETAILS_JSON_FIELDS],
      }).pipe(
        Effect.map((result) => result.stdout),
        Effect.flatMap((raw) =>
          Effect.try({
            try: () => parsePrDetails(raw),
            catch: (error: unknown) =>
              new GitHubCliError({
                operation: "fetchPrDetails",
                detail:
                  error instanceof Error
                    ? `GitHub CLI returned invalid PR details JSON: ${error.message}`
                    : "GitHub CLI returned invalid PR details JSON.",
                ...(error !== undefined ? { cause: error } : {}),
              }),
          }),
        ),
      ),
  } satisfies GitHubCliShape;

  return service;
});

export const GitHubCliLive = Layer.effect(GitHubCli, makeGitHubCli);
