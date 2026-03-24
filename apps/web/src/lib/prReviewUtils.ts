import type { GitResolvedPullRequest } from "@t3tools/contracts";

export const GITHUB_PR_URL_REGEX = /github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+/;

/**
 * Normalize a PR reference by stripping URL fragments and query params.
 * e.g. "https://github.com/org/repo/pull/72#pullrequestreview-123" -> "https://github.com/org/repo/pull/72"
 */
export function normalizePrReference(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith("http")) return trimmed;
  try {
    const url = new URL(trimmed);
    url.hash = "";
    url.search = "";
    return url.toString();
  } catch {
    return trimmed;
  }
}

/**
 * Extract the GitHub repo URL from a PR URL.
 * e.g. "https://github.com/owner/repo/pull/123" -> "https://github.com/owner/repo"
 */
export function extractGitHubRepoUrlFromPrUrl(prUrl: string): string | null {
  const trimmed = prUrl.trim();
  const match = /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/\d+/.exec(trimmed);
  const nameWithOwner = match?.[1]?.trim();
  return nameWithOwner ? `https://github.com/${nameWithOwner}` : null;
}

export function isLikelyPrReference(value: string): boolean {
  const trimmed = value.trim();
  if (GITHUB_PR_URL_REGEX.test(trimmed)) return true;
  if (/^\d+$/.test(trimmed)) return true;
  if (/^[\w.-]+\/[\w.-]+#\d+$/.test(trimmed)) return true;
  return false;
}

/**
 * Build a review prompt from resolved pull request details.
 * Uses the GitResolvedPullRequest type available on the realign branch.
 */
export function buildReviewPrompt(pr: GitResolvedPullRequest): string {
  const lines = [
    `Review PR #${pr.number}: ${pr.title}`,
    "",
    `Base: \`${pr.baseBranch}\` <- Head: \`${pr.headBranch}\``,
    "",
    "---",
    "",
    "## Review Instructions",
    "",
    "Review the changes in this PR. Focus on correctness, performance, and potential issues.",
    "",
    "**Important:** If a code-review skill is available, use it to guide your review process.",
    "",
    "Use the `review_comment` tool to annotate specific lines with your findings.",
    "**Always read the actual file before commenting** to verify the correct line numbers. Do NOT guess line numbers from the diff — use the line numbers from the file content in the worktree.",
    "",
    "**Do NOT post comments directly to GitHub** (no `gh pr review`, `gh api`, or similar). All comments must go through the `review_comment` tool so they can be reviewed locally before publishing.",
    "",
    "Severity levels: info, suggestion, issue, blocker.",
    "",
    "After reviewing all files, provide a brief overall summary of your findings.",
  ];

  return lines.join("\n");
}
