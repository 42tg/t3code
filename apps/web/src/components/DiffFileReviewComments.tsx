import type { ReviewComment } from "@t3tools/contracts";
import type { DiffLineAnnotation } from "@pierre/diffs";
import { AlertCircleIcon, InfoIcon, LightbulbIcon, OctagonAlertIcon } from "lucide-react";

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

/**
 * Inline annotation card rendered directly inside the diff via
 * `@pierre/diffs` `renderAnnotation` callback.
 */
export function ReviewCommentInlineCard({ comment }: { comment: ReviewComment }) {
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

/**
 * Build `lineAnnotations` array for `@pierre/diffs` `FileDiff` component
 * from review comments for a specific file.
 */
export function buildLineAnnotations(
  comments: ReviewComment[],
): DiffLineAnnotation<ReviewComment>[] {
  return comments.map((comment) => ({
    side: "additions" as const,
    lineNumber: comment.startLine,
    metadata: comment,
  }));
}

/**
 * Render callback for `@pierre/diffs` `renderAnnotation` prop.
 * Receives annotation metadata and renders the inline review comment card.
 */
export function renderReviewAnnotation(
  annotation: DiffLineAnnotation<ReviewComment>,
): React.ReactNode {
  if (!annotation.metadata) return null;
  return <ReviewCommentInlineCard comment={annotation.metadata} />;
}
