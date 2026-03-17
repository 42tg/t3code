/**
 * Annotation card renderers for the unified diff annotation pipeline.
 *
 * Each annotation kind has its own card component here. The top-level
 * `renderDiffAnnotation` callback is what gets passed to
 * `@pierre/diffs` `FileDiff.renderAnnotation`.
 */

import { useState } from "react";
import type { DiffLineAnnotation } from "@pierre/diffs";
import type { ReviewComment } from "@t3tools/contracts";
import {
  AlertCircleIcon,
  InfoIcon,
  LightbulbIcon,
  LoaderIcon,
  OctagonAlertIcon,
} from "lucide-react";
import type { DiffAnnotation } from "../lib/diffAnnotations";
import { GitHubIcon } from "./Icons";
import { ensureNativeApi } from "../nativeApi";
import { toastManager } from "./ui/toast";

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

function ReviewCommentInlineCard({
  comment,
  onPublish,
}: {
  comment: ReviewComment;
  onPublish?: ((comment: ReviewComment) => Promise<void>) | undefined;
}) {
  const config = SEVERITY_CONFIG[comment.severity];
  const Icon = config.icon;
  const [publishing, setPublishing] = useState(false);
  const published = !!comment.publishedAt;

  const handlePublish = async () => {
    if (!onPublish || publishing || published) return;
    setPublishing(true);
    try {
      await onPublish(comment);
      toastManager.add({ type: "success", title: "Comment published to GitHub" });
    } catch (err) {
      toastManager.add({
        type: "error",
        title: "Failed to publish",
        description: err instanceof Error ? err.message : "An error occurred.",
      });
    } finally {
      setPublishing(false);
    }
  };

  return (
    <div
      className={`group/review-card border-l-2 ${config.border} ${config.bg} mx-1 my-0.5 rounded-r-md px-3 py-2`}
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
            {published && comment.publishedUrl ? (
              <a
                href={comment.publishedUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-auto inline-flex items-center gap-1 rounded border border-emerald-500/30 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600 transition-all hover:border-emerald-500/50 hover:text-emerald-500 sm:opacity-0 sm:group-hover/review-card:opacity-100 dark:text-emerald-400"
                title="View on GitHub"
              >
                <GitHubIcon className="size-3" />
                Published
              </a>
            ) : published ? (
              <span className="ml-auto inline-flex items-center gap-1 rounded border border-emerald-500/30 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600 sm:opacity-0 sm:group-hover/review-card:opacity-100 dark:text-emerald-400">
                <GitHubIcon className="size-3" />
                Published
              </span>
            ) : onPublish ? (
              <button
                type="button"
                className="ml-auto inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground/70 transition-all hover:border-foreground/30 hover:text-foreground sm:opacity-0 sm:group-hover/review-card:opacity-100"
                onClick={() => void handlePublish()}
                disabled={publishing}
                title="Publish as GitHub comment"
              >
                {publishing ? (
                  <LoaderIcon className="size-3 animate-spin" />
                ) : (
                  <GitHubIcon className="size-3" />
                )}
                Publish as GitHub Comment
              </button>
            ) : null}
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
      return <ReviewCommentInlineCard comment={meta.data} onPublish={meta.onPublish} />;
    default:
      return null;
  }
}
