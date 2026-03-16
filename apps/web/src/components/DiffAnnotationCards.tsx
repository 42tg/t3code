/**
 * Annotation card renderers for the unified diff annotation pipeline.
 *
 * Each annotation kind has its own card component here. The top-level
 * `renderDiffAnnotation` callback is what gets passed to
 * `@pierre/diffs` `FileDiff.renderAnnotation`.
 */

import type { DiffLineAnnotation } from "@pierre/diffs";
import type { ReviewComment } from "@t3tools/contracts";
import { AlertCircleIcon, InfoIcon, LightbulbIcon, OctagonAlertIcon } from "lucide-react";
import type { DiffAnnotation } from "../lib/diffAnnotations";

// ── Review comment severity config ──────────────────────────────────

const SEVERITY_CONFIG = {
  info: {
    icon: InfoIcon,
    border: "border-l-blue-400",
    bg: "bg-blue-500/8",
    badge: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
    label: "Info",
  },
  suggestion: {
    icon: LightbulbIcon,
    border: "border-l-amber-400",
    bg: "bg-amber-500/8",
    badge: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
    label: "Suggestion",
  },
  issue: {
    icon: AlertCircleIcon,
    border: "border-l-orange-400",
    bg: "bg-orange-500/8",
    badge: "bg-orange-500/15 text-orange-600 dark:text-orange-400",
    label: "Issue",
  },
  blocker: {
    icon: OctagonAlertIcon,
    border: "border-l-red-500",
    bg: "bg-red-500/8",
    badge: "bg-red-500/15 text-red-600 dark:text-red-400",
    label: "Blocker",
  },
} as const;

// ── Review comment card ─────────────────────────────────────────────

function ReviewCommentInlineCard({ comment }: { comment: ReviewComment }) {
  const config = SEVERITY_CONFIG[comment.severity];
  const Icon = config.icon;

  return (
    <div
      className={`border-l-2 ${config.border} ${config.bg} mx-1 my-0.5 rounded-r-md px-3 py-2`}
      data-review-comment-id={comment.id}
    >
      <div className="flex items-start gap-2">
        <Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[11px] text-muted-foreground">
              L{comment.startLine}
              {comment.endLine && comment.endLine !== comment.startLine
                ? `–${comment.endLine}`
                : ""}
            </span>
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${config.badge}`}
            >
              {config.label}
            </span>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-foreground/90 whitespace-pre-wrap">
            {comment.body}
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Generic render callback ─────────────────────────────────────────

/**
 * Render callback for `@pierre/diffs` `FileDiff.renderAnnotation`.
 * Dispatches to the correct card based on annotation kind.
 *
 * New annotation kinds simply add a case here and their own card
 * component above.
 */
export function renderDiffAnnotation(
  annotation: DiffLineAnnotation<DiffAnnotation>,
): React.ReactNode {
  const meta = annotation.metadata;
  if (!meta) return null;

  switch (meta.kind) {
    case "review-comment":
      return <ReviewCommentInlineCard comment={meta.data} />;
    default:
      return null;
  }
}
