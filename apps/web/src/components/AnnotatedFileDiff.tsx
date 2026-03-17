/**
 * Unified component for rendering annotated code context in the diff viewer.
 *
 * Handles two cases that were previously separate components:
 *
 * 1. **Annotation-only files** — files with annotations but no diff changes.
 *    Fetches the file content and generates a synthetic context-only patch
 *    so annotated lines are visible with their surrounding code.
 *
 * 2. **Unmatched annotations** — annotations on diff files whose target lines
 *    fall outside the visible hunks. Generates additional synthetic context
 *    hunks appended after the real diff.
 *
 * Both cases share the same core logic: fetch file content → build synthetic
 * patch from annotation line ranges → render via `@pierre/diffs` `FileDiff`
 * with the generic annotation pipeline.
 */

import { parsePatchFiles } from "@pierre/diffs";
import { FileDiff, type FileDiffMetadata } from "@pierre/diffs/react";
import { useQuery } from "@tanstack/react-query";
import { LoaderIcon } from "lucide-react";
import { useMemo } from "react";
import {
  type DiffAnnotation,
  normalizeFilePath,
  toDiffLineAnnotations,
} from "../lib/diffAnnotations";
import { DIFF_UNSAFE_CSS, resolveDiffThemeName } from "../lib/diffRendering";
import { buildSyntheticContextPatch } from "../lib/diffAnnotations";
import { ensureNativeApi } from "../nativeApi";
import { renderDiffAnnotation } from "./DiffAnnotationCards";
import { DiffFileHeader } from "./DiffFileHeader";

type DiffRenderMode = "stacked" | "split";
type DiffThemeType = "light" | "dark";

// ── Shared hook: fetch file + build synthetic patch ─────────────────

function useSyntheticFileDiff(
  cwd: string,
  file: string,
  annotations: DiffAnnotation[],
  enabled: boolean,
) {
  const fileContentQuery = useQuery({
    queryKey: ["projects", "readFile", cwd, file] as const,
    queryFn: async () => {
      const api = ensureNativeApi();
      return api.projects.readFile({ cwd, relativePath: file });
    },
    enabled: enabled && cwd.length > 0,
    staleTime: 30_000,
  });

  const fileDiff = useMemo(() => {
    if (!fileContentQuery.data || annotations.length === 0) return null;
    const allLines = fileContentQuery.data.content.split("\n");
    const lineRanges = annotations.map((a) => ({
      startLine: a.startLine,
      endLine: a.endLine,
    }));
    const patch = buildSyntheticContextPatch(file, lineRanges, allLines);
    if (patch.length === 0) return null;
    try {
      const parsed = parsePatchFiles(patch, `annotation-context:${file}`);
      return parsed.flatMap((p) => p.files)[0] ?? null;
    } catch {
      return null;
    }
  }, [fileContentQuery.data, annotations, file]);

  return { fileContentQuery, fileDiff };
}

// ── 1. Annotation-only file entry ───────────────────────────────────

export interface AnnotationOnlyFileProps {
  file: string;
  annotations: DiffAnnotation[];
  cwd: string;
  resolvedTheme: DiffThemeType;
  diffRenderMode: DiffRenderMode;
  isCollapsed: boolean;
  onToggleCollapsed: () => void;
}

/**
 * Renders a file that has annotations but is NOT part of the actual diff.
 * Fetches the file content and generates synthetic context hunks around
 * each annotated line.
 */
export function AnnotationOnlyFile({
  file,
  annotations,
  cwd,
  resolvedTheme,
  diffRenderMode,
  isCollapsed,
  onToggleCollapsed,
}: AnnotationOnlyFileProps) {
  const { fileContentQuery, fileDiff } = useSyntheticFileDiff(cwd, file, annotations, !isCollapsed);

  return (
    <div
      data-diff-file-path={file}
      className="diff-render-file mb-2 rounded-md first:mt-2 last:mb-0"
    >
      <DiffFileHeader
        filePath={file}
        isCollapsed={isCollapsed}
        onToggleCollapsed={onToggleCollapsed}
        annotationCount={annotations.length}
        annotationOnly
      />
      {!isCollapsed && fileDiff ? (
        <FileDiff
          fileDiff={fileDiff}
          options={{
            diffStyle: diffRenderMode === "split" ? "split" : "unified",
            lineDiffType: "none",
            theme: resolveDiffThemeName(resolvedTheme),
            themeType: resolvedTheme as DiffThemeType,
            unsafeCSS: DIFF_UNSAFE_CSS,
          }}
          {...{
            lineAnnotations: toDiffLineAnnotations(annotations),
            renderAnnotation: renderDiffAnnotation,
          }}
        />
      ) : !isCollapsed && fileContentQuery.isLoading ? (
        <div className="flex items-center gap-2 px-3 py-3 text-xs text-muted-foreground/60">
          <LoaderIcon className="size-3 animate-spin" />
          Loading file...
        </div>
      ) : !isCollapsed && fileContentQuery.isError ? (
        <div className="px-3 py-2">
          <p className="mb-2 text-[11px] text-destructive/70">
            {fileContentQuery.error instanceof Error
              ? fileContentQuery.error.message
              : "Failed to read file."}
          </p>
        </div>
      ) : null}
    </div>
  );
}

// ── 2. Unmatched annotations context ────────────────────────────────

export interface UnmatchedAnnotationsProps {
  fileDiff: FileDiffMetadata;
  annotations: DiffAnnotation[] | undefined;
  cwd: string;
  resolvedTheme: DiffThemeType;
  diffRenderMode: DiffRenderMode;
}

/**
 * For files that ARE in the diff: renders additional synthetic context
 * hunks for annotations whose target lines fall outside the visible
 * diff hunks.
 */
export function UnmatchedAnnotations({
  fileDiff,
  annotations,
  cwd,
  resolvedTheme,
  diffRenderMode,
}: UnmatchedAnnotationsProps) {
  // Collect all line numbers visible in the diff hunks
  const visibleLines = useMemo(() => {
    const lines = new Set<number>();
    for (const hunk of fileDiff.hunks) {
      const start = hunk.additionStart;
      const count = hunk.additionCount;
      for (let i = start; i < start + count; i++) lines.add(i);
    }
    return lines;
  }, [fileDiff.hunks]);

  const unmatched = useMemo(
    () => (annotations ?? []).filter((a) => !visibleLines.has(a.startLine)),
    [annotations, visibleLines],
  );

  const file = normalizeFilePath(fileDiff.name ?? fileDiff.prevName ?? "");

  const { fileDiff: syntheticFileDiff } = useSyntheticFileDiff(
    cwd,
    file,
    unmatched,
    unmatched.length > 0,
  );

  if (unmatched.length === 0 || !syntheticFileDiff) return null;

  return (
    <FileDiff
      fileDiff={syntheticFileDiff}
      options={{
        diffStyle: diffRenderMode === "split" ? "split" : "unified",
        lineDiffType: "none",
        theme: resolveDiffThemeName(resolvedTheme),
        themeType: resolvedTheme as DiffThemeType,
        unsafeCSS: DIFF_UNSAFE_CSS,
      }}
      {...{
        lineAnnotations: toDiffLineAnnotations(unmatched),
        renderAnnotation: renderDiffAnnotation,
      }}
    />
  );
}
