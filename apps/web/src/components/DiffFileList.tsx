/**
 * Standalone, annotation-aware diff file list.
 *
 * This is the **single reusable primitive** for rendering a list of
 * unified diffs with overlaid annotations. Every diff view in the app
 * (checkpoint turns, working tree, branch diff, approval diffs, …)
 * should use this component so annotations are always visible.
 *
 * Annotation handling is first-class, not an optional bolt-on:
 *   - Inline annotations render directly on matching diff lines.
 *   - Annotations on lines outside visible hunks get synthetic context.
 *   - Files with annotations but no diff changes appear as
 *     collapsible annotation-only entries.
 */

import { FileDiff, type FileDiffMetadata, Virtualizer } from "@pierre/diffs/react";
import { useMemo } from "react";

import {
  type DiffAnnotation,
  countAnnotationsForFile,
  groupAnnotationsByFile,
  normalizeFilePath,
  toDiffLineAnnotations,
} from "../lib/diffAnnotations";
import { DIFF_UNSAFE_CSS, resolveDiffThemeName } from "../lib/diffRendering";
import { renderDiffAnnotation } from "./DiffAnnotationCards";
import { AnnotationOnlyFile, UnmatchedAnnotations } from "./AnnotatedFileDiff";
import { DiffFileHeader } from "./DiffFileHeader";

// ── Shared types ─────────────────────────────────────────────────────

export type DiffRenderMode = "stacked" | "split";
export type DiffThemeType = "light" | "dark";

// ── File-level utilities (exported for DiffPanel collapse logic) ─────

/** Resolve the display path from a `FileDiffMetadata`, stripping `a/`/`b/` prefixes. */
export function resolveFileDiffPath(fileDiff: FileDiffMetadata): string {
  const raw = fileDiff.name ?? fileDiff.prevName ?? "";
  if (raw.startsWith("a/") || raw.startsWith("b/")) {
    return raw.slice(2);
  }
  return raw;
}

/** Stable render key for a file diff entry (used for collapse state keying). */
export function buildFileDiffRenderKey(fileDiff: FileDiffMetadata): string {
  return fileDiff.cacheKey ?? `${fileDiff.prevName ?? "none"}:${fileDiff.name}`;
}

/** Sum additions/deletions across an array of file diffs. */
export function computeDiffStats(files: FileDiffMetadata[]): {
  additions: number;
  deletions: number;
} {
  let additions = 0;
  let deletions = 0;
  for (const file of files) {
    for (const hunk of file.hunks) {
      additions += hunk.additionLines;
      deletions += hunk.deletionLines;
    }
  }
  return { additions, deletions };
}

// ── Component ────────────────────────────────────────────────────────

export interface DiffFileListProps {
  /** Parsed file diffs to render. May be empty when only annotations exist. */
  files: FileDiffMetadata[];
  resolvedTheme: DiffThemeType;
  diffRenderMode: DiffRenderMode;
  /** Set of collapsed file keys (managed by parent for collapse-all support). */
  collapsedFiles: Set<string>;
  onToggleCollapsed: (key: string) => void;
  /** Called when the user clicks a file header to open it in an editor. */
  onOpenFile: (path: string) => void;
  /** Ref forwarded to the scroll viewport for programmatic scroll-to-file. */
  patchViewportRef: React.RefObject<HTMLDivElement | null>;
  /**
   * Flat list of annotations from all sources. Grouping by file is done
   * internally — callers should NOT pre-group.
   */
  annotations?: DiffAnnotation[] | undefined;
  /** Working directory for fetching file content (needed for synthetic context). */
  cwd?: string | undefined;
}

/**
 * Renders a virtualized list of file diffs with full annotation support.
 *
 * This is the canonical diff renderer. Use it everywhere diffs are shown.
 */
export function DiffFileList({
  files,
  resolvedTheme,
  diffRenderMode,
  collapsedFiles,
  onToggleCollapsed,
  onOpenFile,
  patchViewportRef,
  annotations,
  cwd,
}: DiffFileListProps) {
  // Group annotations by normalised file path (stable across renders).
  const annotationsByFile = useMemo(
    () => (annotations && annotations.length > 0 ? groupAnnotationsByFile(annotations) : undefined),
    [annotations],
  );

  // Files with annotations but NOT in the diff → show as annotation-only entries.
  const annotationOnlyFiles = useMemo(() => {
    if (!annotationsByFile) return [];
    const diffFilePaths = new Set(files.map((f) => normalizeFilePath(resolveFileDiffPath(f))));
    return [...annotationsByFile.entries()].filter(
      ([annotatedFile]) => !diffFilePaths.has(annotatedFile),
    );
  }, [annotationsByFile, files]);

  return (
    <div
      ref={patchViewportRef}
      className="diff-panel-viewport min-h-0 min-w-0 flex-1 overflow-hidden"
    >
      <Virtualizer
        className="diff-render-surface h-full min-h-0 overflow-auto px-2 pb-2"
        config={{ overscrollSize: 600, intersectionObserverMargin: 1200 }}
      >
        {/* Annotation-only files (not in the diff) */}
        {annotationOnlyFiles.map(([annotatedFile, fileAnnotations]) => (
          <AnnotationOnlyFile
            key={`annotation-only:${annotatedFile}`}
            file={annotatedFile}
            annotations={fileAnnotations}
            cwd={cwd ?? ""}
            resolvedTheme={resolvedTheme}
            diffRenderMode={diffRenderMode}
            isCollapsed={collapsedFiles.has(`annotation:${annotatedFile}:${resolvedTheme}`)}
            onToggleCollapsed={() =>
              onToggleCollapsed(`annotation:${annotatedFile}:${resolvedTheme}`)
            }
          />
        ))}
        {/* Regular diff files */}
        {files.map((fileDiff) => {
          const filePath = resolveFileDiffPath(fileDiff);
          const normalizedPath = normalizeFilePath(filePath);
          const fileKey = buildFileDiffRenderKey(fileDiff);
          const themedFileKey = `${fileKey}:${resolvedTheme}`;
          const isCollapsed = collapsedFiles.has(themedFileKey);
          const fileStats = computeDiffStats([fileDiff]);
          const fileAnnotations = annotationsByFile?.get(normalizedPath);
          return (
            <div
              key={themedFileKey}
              data-diff-file-path={filePath}
              className="diff-render-file mb-2 rounded-md first:mt-2 last:mb-0"
            >
              <DiffFileHeader
                filePath={filePath}
                isCollapsed={isCollapsed}
                onToggleCollapsed={() => onToggleCollapsed(themedFileKey)}
                annotationCount={countAnnotationsForFile(annotationsByFile, normalizedPath)}
                stats={fileStats}
              />
              {!isCollapsed && (
                <div
                  onClickCapture={(event) => {
                    const nativeEvent = event.nativeEvent as MouseEvent;
                    const composedPath = nativeEvent.composedPath?.() ?? [];
                    const clickedHeader = composedPath.some((node) => {
                      if (!(node instanceof Element)) return false;
                      return node.hasAttribute("data-title");
                    });
                    if (!clickedHeader) return;
                    onOpenFile(filePath);
                  }}
                >
                  <FileDiff
                    fileDiff={fileDiff}
                    options={{
                      diffStyle: diffRenderMode === "split" ? "split" : "unified",
                      lineDiffType: "none",
                      theme: resolveDiffThemeName(resolvedTheme),
                      themeType: resolvedTheme as DiffThemeType,
                      unsafeCSS: DIFF_UNSAFE_CSS,
                    }}
                    {...(fileAnnotations
                      ? {
                          lineAnnotations: toDiffLineAnnotations(fileAnnotations),
                          renderAnnotation: renderDiffAnnotation,
                        }
                      : {})}
                  />
                  <UnmatchedAnnotations
                    fileDiff={fileDiff}
                    annotations={fileAnnotations}
                    cwd={cwd ?? ""}
                    resolvedTheme={resolvedTheme}
                    diffRenderMode={diffRenderMode}
                  />
                </div>
              )}
            </div>
          );
        })}
      </Virtualizer>
    </div>
  );
}
