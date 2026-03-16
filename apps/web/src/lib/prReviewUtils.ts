import type { GitFetchPrDetailsResult } from "@t3tools/contracts";

export const GITHUB_PR_URL_REGEX = /github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+/;

export function isLikelyPrReference(value: string): boolean {
  const trimmed = value.trim();
  if (GITHUB_PR_URL_REGEX.test(trimmed)) return true;
  // Numeric PR number (e.g. "123")
  if (/^\d+$/.test(trimmed)) return true;
  // owner/repo#number format
  if (/^[\w.-]+\/[\w.-]+#\d+$/.test(trimmed)) return true;
  return false;
}

/**
 * Normalize a PR reference by stripping URL fragments and query params.
 * e.g. "https://github.com/org/repo/pull/72#pullrequestreview-123" → "https://github.com/org/repo/pull/72"
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

export function buildReviewPrompt(pr: GitFetchPrDetailsResult): string {
  const lines = [
    `Review PR #${pr.number}: ${pr.title}`,
    "",
    `Base: \`${pr.baseRefName}\` <- Head: \`${pr.headRefName}\``,
    `Changes: +${pr.additions} -${pr.deletions} across ${pr.changedFiles} file${pr.changedFiles !== 1 ? "s" : ""}`,
    "",
  ];

  if (pr.body.trim().length > 0) {
    lines.push("## PR Description", "", pr.body.trim(), "");
  }

  lines.push(
    "---",
    "",
    "Please review the changes in this PR. Focus on correctness, performance, and potential issues. Summarize your findings and flag anything that needs attention.",
  );

  return lines.join("\n");
}
