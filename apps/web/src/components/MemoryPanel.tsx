import { type Memory, type MemoryCategory, type ProjectId } from "@t3tools/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArchiveIcon,
  BrainIcon,
  CalendarIcon,
  SearchIcon,
  Trash2Icon,
  FolderIcon,
  SparklesIcon,
  UserIcon,
} from "lucide-react";
import { memo, useCallback, useDeferredValue, useState } from "react";
import {
  memoryListQueryOptions,
  memorySearchQueryOptions,
  memoryArchiveMutationOptions,
  memoryDeleteMutationOptions,
} from "../lib/memoryReactQuery";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { ScrollArea } from "./ui/scroll-area";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

const CATEGORY_LABELS: Record<MemoryCategory, string> = {
  preference: "Preference",
  pattern: "Pattern",
  decision: "Decision",
  fact: "Fact",
  convention: "Convention",
};

const CATEGORY_COLORS: Record<MemoryCategory, string> = {
  preference: "text-blue-600 bg-blue-50 dark:text-blue-400 dark:bg-blue-950",
  pattern: "text-purple-600 bg-purple-50 dark:text-purple-400 dark:bg-purple-950",
  decision: "text-amber-600 bg-amber-50 dark:text-amber-400 dark:bg-amber-950",
  fact: "text-green-600 bg-green-50 dark:text-green-400 dark:bg-green-950",
  convention: "text-rose-600 bg-rose-50 dark:text-rose-400 dark:bg-rose-950",
};

const ALL_CATEGORIES: MemoryCategory[] = [
  "preference",
  "pattern",
  "decision",
  "fact",
  "convention",
];

interface MemoryPanelProps {
  projectId: ProjectId | null;
}

export const MemoryPanel = memo(function MemoryPanel({ projectId }: MemoryPanelProps) {
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const deferredSearch = useDeferredValue(searchQuery);
  const [selectedCategory, setSelectedCategory] = useState<MemoryCategory | undefined>(undefined);

  const isSearching = deferredSearch.length > 0;

  const listQuery = useQuery(
    memoryListQueryOptions(projectId, {
      ...(selectedCategory !== undefined ? { category: selectedCategory } : {}),
      includeArchived: false,
    }),
  );

  const searchQueryResult = useQuery(
    memorySearchQueryOptions(deferredSearch, projectId ?? undefined, selectedCategory),
  );

  const archiveMutation = useMutation(memoryArchiveMutationOptions(queryClient));
  const deleteMutation = useMutation(memoryDeleteMutationOptions(queryClient));

  const memories = isSearching
    ? (searchQueryResult.data?.memories ?? [])
    : (listQuery.data?.memories ?? []);

  const handleArchive = useCallback(
    (memoryId: string) => {
      archiveMutation.mutate(memoryId);
    },
    [archiveMutation],
  );

  const handleDelete = useCallback(
    (memoryId: string) => {
      if (!window.confirm("Are you sure you want to permanently delete this memory?")) return;
      deleteMutation.mutate(memoryId);
    },
    [deleteMutation],
  );

  if (!projectId) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-muted-foreground">
        <BrainIcon className="size-8 opacity-40" />
        <p className="text-sm">Select a project to view memories</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <BrainIcon className="size-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Memories</h3>
          {listQuery.data && (
            <Badge variant="outline" size="sm">
              {listQuery.data.total}
            </Badge>
          )}
        </div>
        {/* Memories are auto-extracted — no manual buttons needed */}
      </div>

      {/* Search */}
      <div className="border-b px-4 py-2">
        <div className="relative">
          <SearchIcon className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search memories..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-8 pl-8 text-sm"
          />
        </div>
      </div>

      {/* Category filters */}
      <div className="flex flex-wrap gap-1 border-b px-4 py-2">
        <Badge
          render={<button type="button" onClick={() => setSelectedCategory(undefined)} />}
          variant={selectedCategory === undefined ? "default" : "outline"}
          size="sm"
        >
          All
        </Badge>
        {ALL_CATEGORIES.map((cat) => (
          <Badge
            key={cat}
            render={
              <button
                type="button"
                onClick={() => setSelectedCategory(selectedCategory === cat ? undefined : cat)}
              />
            }
            variant={selectedCategory === cat ? "default" : "outline"}
            size="sm"
          >
            {CATEGORY_LABELS[cat]}
          </Badge>
        ))}
      </div>

      {/* Memory list */}
      <ScrollArea className="flex-1">
        <div className="flex flex-col gap-1 p-2">
          {memories.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-8 text-center text-muted-foreground">
              {isSearching ? (
                <>
                  <SearchIcon className="size-6 opacity-40" />
                  <p className="text-sm">No memories match your search</p>
                </>
              ) : (
                <>
                  <BrainIcon className="size-6 opacity-40" />
                  <p className="text-sm">No memories yet</p>
                  <p className="text-xs">
                    Memories are extracted from conversations or created manually.
                  </p>
                </>
              )}
            </div>
          )}
          {memories.map((memory) => (
            <MemoryItem
              key={memory.memoryId}
              memory={memory}
              onArchive={handleArchive}
              onDelete={handleDelete}
            />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
});

// ── MemoryItem ────────────────────────────────────────────────────────

interface MemoryItemProps {
  memory: Memory;
  onArchive: (memoryId: string) => void;
  onDelete: (memoryId: string) => void;
}

const MemoryItem = memo(function MemoryItem({ memory, onArchive, onDelete }: MemoryItemProps) {
  const [expanded, setExpanded] = useState(false);

  const age = getRelativeAge(memory.createdAt);
  const categoryColor = CATEGORY_COLORS[memory.category];

  return (
    <div className="group rounded-lg border bg-card p-3 transition-colors hover:bg-accent/30">
      {/* Title + category */}
      <div className="flex items-start justify-between gap-2">
        <button
          type="button"
          className="min-w-0 flex-1 text-left"
          onClick={() => setExpanded(!expanded)}
        >
          <p className="text-sm font-medium leading-tight">{memory.title}</p>
        </button>
        <Badge size="sm" className={categoryColor}>
          {CATEGORY_LABELS[memory.category]}
        </Badge>
      </div>

      {/* Content */}
      <button
        type="button"
        className="mt-1.5 block w-full text-left"
        onClick={() => setExpanded(!expanded)}
      >
        <p className={`text-xs text-muted-foreground ${expanded ? "" : "line-clamp-2"}`}>
          {memory.content}
        </p>
      </button>

      {/* Metadata + actions */}
      <div className="mt-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          {/* Scope badge */}
          <Tooltip>
            <TooltipTrigger
              render={
                <Badge variant="outline" size="sm" className="gap-0.5">
                  {memory.scope === "thread" ? (
                    <BrainIcon className="size-2.5" />
                  ) : memory.scope === "daily" ? (
                    <CalendarIcon className="size-2.5" />
                  ) : (
                    <FolderIcon className="size-2.5" />
                  )}
                  {memory.scope === "daily" && memory.date ? memory.date : memory.scope}
                </Badge>
              }
            />
            <TooltipPopup side="bottom">
              {memory.scope === "thread"
                ? "Thread summary"
                : memory.scope === "daily"
                  ? `Daily memory for ${memory.date ?? "today"}`
                  : "Project-specific memory"}
            </TooltipPopup>
          </Tooltip>

          {/* Source badge */}
          <Badge variant="outline" size="sm" className="gap-0.5">
            {memory.source === "auto" ? (
              <SparklesIcon className="size-2.5" />
            ) : (
              <UserIcon className="size-2.5" />
            )}
            {memory.source}
          </Badge>

          {/* Age */}
          <span className="text-[10px] text-muted-foreground">{age}</span>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-6"
                  onClick={() => onArchive(memory.memoryId)}
                >
                  <ArchiveIcon className="size-3" />
                </Button>
              }
            />
            <TooltipPopup side="bottom">Archive</TooltipPopup>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-6 text-destructive"
                  onClick={() => onDelete(memory.memoryId)}
                >
                  <Trash2Icon className="size-3" />
                </Button>
              }
            />
            <TooltipPopup side="bottom">Delete</TooltipPopup>
          </Tooltip>
        </div>
      </div>
    </div>
  );
});

function getRelativeAge(isoDate: string): string {
  const now = Date.now();
  const then = new Date(isoDate).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 30) return `${diffD}d ago`;
  const diffMo = Math.floor(diffD / 30);
  return `${diffMo}mo ago`;
}
