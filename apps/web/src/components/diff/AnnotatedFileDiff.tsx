/**
 * Unified component for rendering annotated code context in the diff viewer.
 *
 * Handles two cases:
 *
 * 1. **Annotation-only files** -- files with annotations but no diff changes.
 *    Fetches the file content and generates a synthetic context-only patch
 *    so annotated lines are visible with their surrounding code.
 *
 * 2. **Unmatched annotations** -- annotations on diff files whose target lines
 *    fall outside the visible hunks. Generates additional synthetic context
 *    hunks appended after the real diff.
 *
 * Both cases share the same core logic: fetch file content -> build synthetic
 * patch from annotation line ranges -> render via `@pierre/diffs` `FileDiff`
 * with the generic annotation pipeline.
 */

import { parsePatchFiles, type DiffLineAnnotation } from "@pierre/diffs";
import { FileDiff, type FileDiffMetadata } from "@pierre/diffs/react";
import { useQuery } from "@tanstack/react-query";
import { LoaderIcon } from "lucide-react";
import React, { type ReactNode, useMemo } from "react";
import {
  type DiffAnnotation,
  normalizeFilePath,
  toDiffLineAnnotations,
  buildSyntheticContextPatch,
} from "../../lib/diffAnnotations";
import { DIFF_UNSAFE_CSS, resolveDiffThemeName } from "../../lib/diffRendering";
import { ensureNativeApi } from "../../nativeApi";
import { renderDiffAnnotation } from "./DiffAnnotationCards";
import { DiffFileHeader } from "./DiffFileHeader";

type DiffRenderMode = "stacked" | "split";
type DiffThemeType = "light" | "dark";

// -- Error boundary for @pierre/diffs render crashes --------------------------

/**
 * Catches runtime errors from the `@pierre/diffs` renderer (e.g. invalid
 * hunk data, null line references) and shows a fallback instead of
 * crashing the entire diff view.
 */
export class DiffRenderErrorBoundary extends React.Component<
  { filePath?: string; children: ReactNode },
  { error: Error | null }
> {
  constructor(props: { filePath?: string; children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override render() {
    if (this.state.error) {
      return (
        <div className="px-3 py-2">
          <p className="text-[11px] font-medium text-destructive/70">{this.state.error.message}</p>
        </div>
      );
    }
    return this.props.children;
  }
}

// -- Shared hook: fetch file + build synthetic patch --------------------------

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
    enabled: enabled && annotations.length > 0,
    staleTime: 30_000,
  });

  const fileDiff = useMemo(() => {
    const content = fileContentQuery.data?.content;
    if (!content || annotations.length === 0) return null;
    const lines = content.split("\n");
    const lineRanges = annotations.map((a) => ({
      startLine: a.startLine,
      endLine: a.endLine,
    }));
    const patch = buildSyntheticContextPatch(file, lineRanges, lines);
    if (patch.length === 0) return null;
    try {
      const parsed = parsePatchFiles(patch, `annotation-context:${file}`);
      return parsed.flatMap((p) => p.files)[0] ?? null;
    } catch {
      return null;
    }
  }, [fileContentQuery.data?.content, annotations, file]);

  return { fileContentQuery, fileDiff };
}

// -- 1. Annotation-only file entry --------------------------------------------

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
      ) : !isCollapsed ? (
        <div className="px-3 py-2">
          {fileContentQuery.isError && (
            <p className="mb-1 text-[10px] text-muted-foreground/50">
              File not found in worktree — showing comments only.
            </p>
          )}
          {annotations.map((a) => (
            <div key={a.id} className="my-1">
              {renderDiffAnnotation({
                side: "additions",
                lineNumber: a.startLine,
                metadata: a,
              } as DiffLineAnnotation<DiffAnnotation>)}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// -- 2. Unmatched annotations context -----------------------------------------

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
  // Collect all line numbers visible in the diff hunks (both sides + context)
  const visibleLines = useMemo(() => {
    const lines = new Set<number>();
    for (const hunk of fileDiff.hunks) {
      // Addition side
      const addStart = hunk.additionStart;
      const addCount = hunk.additionCount;
      for (let i = addStart; i < addStart + addCount; i++) lines.add(i);
      // Deletion side (may overlap with addition for context lines)
      const delStart = hunk.deletionStart;
      const delCount = hunk.deletionCount;
      for (let i = delStart; i < delStart + delCount; i++) lines.add(i);
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
