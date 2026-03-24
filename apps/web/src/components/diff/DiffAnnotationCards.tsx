/**
 * Annotation card renderers for the unified diff annotation pipeline.
 *
 * Each annotation kind has its own card component here. The top-level
 * `renderDiffAnnotation` callback is what gets passed to
 * `@pierre/diffs` `FileDiff.renderAnnotation`.
 *
 * New annotation kinds simply add a case here and their own card
 * component above.
 */

import type { DiffLineAnnotation } from "@pierre/diffs";
import type { DiffAnnotation, ReviewCommentAnnotation } from "../../lib/diffAnnotations";
import {
  CircleAlertIcon,
  ExternalLinkIcon,
  InfoIcon,
  LightbulbIcon,
  OctagonAlertIcon,
} from "lucide-react";
import { GitHubIcon } from "../Icons";

const SEVERITY_STYLES: Record<
  ReviewCommentAnnotation["severity"],
  { border: string; bg: string; icon: typeof InfoIcon; iconColor: string; label: string }
> = {
  info: {
    border: "border-blue-500/30",
    bg: "bg-blue-500/5",
    icon: InfoIcon,
    iconColor: "text-blue-400",
    label: "Info",
  },
  suggestion: {
    border: "border-yellow-500/30",
    bg: "bg-yellow-500/5",
    icon: LightbulbIcon,
    iconColor: "text-yellow-400",
    label: "Suggestion",
  },
  issue: {
    border: "border-orange-500/30",
    bg: "bg-orange-500/5",
    icon: CircleAlertIcon,
    iconColor: "text-orange-400",
    label: "Issue",
  },
  blocker: {
    border: "border-red-500/30",
    bg: "bg-red-500/5",
    icon: OctagonAlertIcon,
    iconColor: "text-red-400",
    label: "Blocker",
  },
};

function ReviewCommentCard({ annotation }: { annotation: ReviewCommentAnnotation }) {
  const style = SEVERITY_STYLES[annotation.severity];
  const Icon = style.icon;
  const lineLabel = annotation.endLine
    ? `L${annotation.startLine}\u2013${annotation.endLine}`
    : `L${annotation.startLine}`;
  const isPublished = !!annotation.publishedAt;
  return (
    <div className={`my-1 rounded-md border ${style.border} ${style.bg} px-3 py-2 font-mono`}>
      <div className="flex items-center gap-1">
        <Icon className={`size-2.5 shrink-0 -translate-y-px ${style.iconColor}`} />
        <span
          className={`text-[10px] font-semibold uppercase leading-none tracking-wide ${style.iconColor}`}
        >
          {style.label}
        </span>
        <span className="text-[10px] leading-none text-muted-foreground/50">{lineLabel}</span>
        <span className="flex-1" />
        {isPublished ? (
          annotation.publishedUrl ? (
            <a
              href={annotation.publishedUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-4 items-center gap-1 rounded border border-emerald-500/30 bg-emerald-500/10 px-1.5 text-[10px] text-emerald-400 hover:bg-emerald-500/20"
            >
              <GitHubIcon className="size-2.5 shrink-0" />
              <span>Published</span>
              <ExternalLinkIcon className="size-2.5 shrink-0" />
            </a>
          ) : (
            <span className="inline-flex h-4 items-center gap-1 rounded border border-emerald-500/30 bg-emerald-500/10 px-1.5 text-[10px] text-emerald-400">
              <GitHubIcon className="size-2.5 shrink-0" />
              <span>Published</span>
            </span>
          )
        ) : annotation.onPublish ? (
          <button
            type="button"
            onClick={() => annotation.onPublish?.(annotation.id)}
            className="inline-flex h-4 items-center gap-1 rounded border border-border/50 bg-background/50 px-1.5 text-[10px] text-muted-foreground/70 transition-colors hover:border-border hover:bg-foreground/10 hover:text-foreground/80"
            title="Publish this comment to GitHub"
          >
            <GitHubIcon className="size-2.5 shrink-0" />
            <span>Publish</span>
          </button>
        ) : null}
      </div>
      <p className="mt-1 whitespace-pre-wrap text-[11px] leading-relaxed text-foreground/80">
        {annotation.body}
      </p>
    </div>
  );
}

/**
 * Render callback for `@pierre/diffs` `FileDiff.renderAnnotation`.
 * Dispatches to the correct card based on annotation kind.
 */
export function renderDiffAnnotation(
  annotation: DiffLineAnnotation<DiffAnnotation>,
): React.ReactNode {
  const meta = annotation.metadata;
  if (!meta) return null;

  switch (meta.kind) {
    case "reviewComment":
      return <ReviewCommentCard annotation={meta} />;
    default:
      return null;
  }
}
