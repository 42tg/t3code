import type { ReviewComment } from "@t3tools/contracts";
import { AlertCircleIcon, InfoIcon, LightbulbIcon, OctagonAlertIcon } from "lucide-react";

const SEVERITY_CONFIG = {
  info: {
    icon: InfoIcon,
    border: "border-l-blue-400",
    bg: "bg-blue-500/5",
    badge: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
    label: "Info",
  },
  suggestion: {
    icon: LightbulbIcon,
    border: "border-l-amber-400",
    bg: "bg-amber-500/5",
    badge: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
    label: "Suggestion",
  },
  issue: {
    icon: AlertCircleIcon,
    border: "border-l-orange-400",
    bg: "bg-orange-500/5",
    badge: "bg-orange-500/15 text-orange-600 dark:text-orange-400",
    label: "Issue",
  },
  blocker: {
    icon: OctagonAlertIcon,
    border: "border-l-red-500",
    bg: "bg-red-500/5",
    badge: "bg-red-500/15 text-red-600 dark:text-red-400",
    label: "Blocker",
  },
} as const;

function ReviewCommentCard({ comment }: { comment: ReviewComment }) {
  const config = SEVERITY_CONFIG[comment.severity];
  const Icon = config.icon;

  return (
    <div
      className={`border-l-2 ${config.border} ${config.bg} rounded-r-md px-3 py-2`}
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

interface DiffFileReviewCommentsProps {
  comments: ReviewComment[];
}

export default function DiffFileReviewComments({ comments }: DiffFileReviewCommentsProps) {
  if (comments.length === 0) return null;

  const severityCounts = {
    blocker: comments.filter((c) => c.severity === "blocker").length,
    issue: comments.filter((c) => c.severity === "issue").length,
    suggestion: comments.filter((c) => c.severity === "suggestion").length,
    info: comments.filter((c) => c.severity === "info").length,
  };

  return (
    <div className="border-t border-border/40 bg-muted/30 px-3 py-2">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/60">
          Review comments ({comments.length})
        </span>
        <div className="flex items-center gap-1">
          {severityCounts.blocker > 0 && (
            <span className="rounded bg-red-500/15 px-1 text-[10px] font-medium text-red-600 dark:text-red-400">
              {severityCounts.blocker} blocker
            </span>
          )}
          {severityCounts.issue > 0 && (
            <span className="rounded bg-orange-500/15 px-1 text-[10px] font-medium text-orange-600 dark:text-orange-400">
              {severityCounts.issue} issue
            </span>
          )}
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        {comments.map((comment) => (
          <ReviewCommentCard key={comment.id} comment={comment} />
        ))}
      </div>
    </div>
  );
}
