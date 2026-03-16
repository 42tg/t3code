/**
 * Unified diff annotation pipeline.
 *
 * Provides a generic, extensible annotation system for overlaying metadata
 * on top of `@pierre/diffs` file diffs. Each annotation kind (review-comment,
 * lint-warning, ai-suggestion, …) is a discriminated union variant so the
 * renderer can dispatch to kind-specific cards while all pipeline plumbing
 * (path normalisation, line mapping, grouping) stays shared.
 */

import type { DiffLineAnnotation } from "@pierre/diffs";
import type { ReviewComment } from "@t3tools/contracts";

// ── Annotation types ─────────────────────────────────────────────────

/**
 * Discriminated union of every annotation kind the diff pipeline supports.
 * Add new variants here when introducing a new annotation source.
 */
export type DiffAnnotation = ReviewCommentAnnotation;

export interface ReviewCommentAnnotation {
  kind: "review-comment";
  /** Unique id for stable React keys. */
  id: string;
  file: string;
  startLine: number;
  endLine?: number | undefined;
  data: ReviewComment;
}

// ── Path helpers ─────────────────────────────────────────────────────

/**
 * Canonical path normalization used everywhere annotations are matched
 * to diff files. Strips leading `./` and `a/` / `b/` prefixes that git
 * diff headers produce.
 */
export function normalizeFilePath(path: string): string {
  return path.replace(/^\.\//, "").replace(/^[ab]\//, "");
}

// ── Conversion helpers ───────────────────────────────────────────────

/** Convert a flat list of review comments into generic DiffAnnotations. */
export function reviewCommentsToAnnotations(comments: readonly ReviewComment[]): DiffAnnotation[] {
  return comments.map((c) => ({
    kind: "review-comment" as const,
    id: c.id,
    file: c.file,
    startLine: c.startLine,
    endLine: c.endLine,
    data: c,
  }));
}

// ── Grouping ─────────────────────────────────────────────────────────

/**
 * Group annotations by normalised file path.
 * The returned map uses `normalizeFilePath` keys so consumers can look
 * up annotations for a `FileDiffMetadata` without worrying about prefix
 * mismatches.
 */
export function groupAnnotationsByFile(
  annotations: DiffAnnotation[],
): Map<string, DiffAnnotation[]> {
  const map = new Map<string, DiffAnnotation[]>();
  for (const annotation of annotations) {
    const key = normalizeFilePath(annotation.file);
    const existing = map.get(key);
    if (existing) {
      existing.push(annotation);
    } else {
      map.set(key, [annotation]);
    }
  }
  return map;
}

// ── @pierre/diffs integration ────────────────────────────────────────

/** Target line number for a `@pierre/diffs` line annotation. */
function getAnnotationTargetLine(annotation: DiffAnnotation): number {
  return annotation.endLine ?? annotation.startLine;
}

/**
 * Build the `lineAnnotations` prop for `@pierre/diffs` `FileDiff`.
 * Works with any `DiffAnnotation` kind — the metadata carries the full
 * discriminated union so `renderDiffAnnotation` can dispatch.
 */
export function toDiffLineAnnotations(
  annotations: DiffAnnotation[],
): DiffLineAnnotation<DiffAnnotation>[] {
  return annotations.map((annotation) => ({
    side: "additions" as const,
    lineNumber: getAnnotationTargetLine(annotation),
    metadata: annotation,
  }));
}

/**
 * The number of annotations grouped under a normalised file path.
 * Returns `0` when the file has no annotations.
 */
export function countAnnotationsForFile(
  annotationsByFile: Map<string, DiffAnnotation[]> | undefined,
  normalizedPath: string,
): number {
  return annotationsByFile?.get(normalizedPath)?.length ?? 0;
}
