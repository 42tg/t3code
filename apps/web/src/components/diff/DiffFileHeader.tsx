/**
 * Shared collapsible file header used by all diff file entries.
 *
 * Renders the file path, optional annotation badge, optional diff stats,
 * and the collapse/expand chevron. Extracted so both real diff files
 * and annotation-only context entries share the same look-and-feel.
 */

import { ChevronDownIcon, MessageSquareTextIcon } from "lucide-react";
import { cn } from "~/lib/utils";

export interface DiffFileHeaderProps {
  filePath: string;
  isCollapsed: boolean;
  onToggleCollapsed: () => void;
  /** Number of annotations on this file. Shows a badge when > 0. */
  annotationCount?: number;
  /** Diff stats. Omit for annotation-only files with no code changes. */
  stats?: { additions: number; deletions: number };
  /** Show a comment icon instead of just the chevron (annotation-only files). */
  annotationOnly?: boolean;
}

export function DiffFileHeader({
  filePath,
  isCollapsed,
  onToggleCollapsed,
  annotationCount = 0,
  stats,
  annotationOnly = false,
}: DiffFileHeaderProps) {
  return (
    <button
      type="button"
      className="flex w-full cursor-pointer items-center gap-1.5 border-b border-border/60 bg-[color-mix(in_srgb,var(--card)_94%,var(--foreground))] px-3 py-1.5 text-left text-[12px] font-medium text-foreground/90 transition-colors hover:bg-[color-mix(in_srgb,var(--card)_88%,var(--foreground))] hover:text-foreground"
      onClick={onToggleCollapsed}
      title={filePath}
    >
      <ChevronDownIcon
        className={cn(
          "size-3.5 shrink-0 text-muted-foreground/60 transition-transform",
          isCollapsed && "-rotate-90",
        )}
      />
      {annotationOnly && <MessageSquareTextIcon className="size-3.5 shrink-0 text-primary/60" />}
      <span className="min-w-0 truncate font-mono">{filePath}</span>
      {annotationCount > 0 && (
        <span className="shrink-0 rounded bg-primary/12 px-1.5 py-0.5 text-[10px] font-medium text-primary">
          {annotationCount} comment{annotationCount !== 1 ? "s" : ""}
        </span>
      )}
      {stats && (stats.additions > 0 || stats.deletions > 0) && (
        <span className="ml-auto shrink-0 font-mono text-[10px] font-normal">
          {stats.additions > 0 && <span className="text-green-500">+{stats.additions}</span>}
          {stats.additions > 0 && stats.deletions > 0 && (
            <span className="text-muted-foreground/50"> / </span>
          )}
          {stats.deletions > 0 && <span className="text-red-500">-{stats.deletions}</span>}
        </span>
      )}
    </button>
  );
}
