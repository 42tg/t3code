import { TurnId } from "@t3tools/contracts";

export interface DiffRouteSearch {
  diff?: "1";
  diffTurnId?: TurnId;
  diffFilePath?: string;
  diffBranch?: "1";
}

function isDiffOpenValue(value: unknown): boolean {
  return value === "1" || value === 1 || value === true;
}

function normalizeSearchString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

export function stripDiffSearchParams<T extends Record<string, unknown>>(
  params: T,
): Omit<T, "diff" | "diffTurnId" | "diffFilePath" | "diffBranch"> {
  const {
    diff: _diff,
    diffTurnId: _diffTurnId,
    diffFilePath: _diffFilePath,
    diffBranch: _diffBranch,
    ...rest
  } = params;
  return rest as Omit<T, "diff" | "diffTurnId" | "diffFilePath" | "diffBranch">;
}

export function parseDiffRouteSearch(search: Record<string, unknown>): DiffRouteSearch {
  const diff = isDiffOpenValue(search.diff) ? "1" : undefined;
  const diffBranch = diff && isDiffOpenValue(search.diffBranch) ? "1" : undefined;
  const diffTurnIdRaw = diff ? normalizeSearchString(search.diffTurnId) : undefined;
  const diffTurnId = diffTurnIdRaw ? TurnId.makeUnsafe(diffTurnIdRaw) : undefined;
  const diffFilePath = diff && diffTurnId ? normalizeSearchString(search.diffFilePath) : undefined;

  return {
    ...(diff ? { diff } : {}),
    ...(diffBranch ? { diffBranch } : {}),
    ...(diffTurnId ? { diffTurnId } : {}),
    ...(diffFilePath ? { diffFilePath } : {}),
  };
}
