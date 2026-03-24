import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type { ReviewRequest, ThreadId } from "@t3tools/contracts";
import { BellIcon, ExternalLinkIcon, GitPullRequestIcon, RotateCcwIcon, XIcon } from "lucide-react";

import { cn } from "~/lib/utils";
import { ensureNativeApi } from "../nativeApi";
import { reviewRequestListQueryOptions, reviewRequestQueryKeys } from "../lib/reviewReactQuery";
import { Popover, PopoverTrigger, PopoverContent } from "./ui/popover";
import { useSidebar } from "./ui/sidebar";

interface NotificationBellProps {
  onStartReview: (prUrl: string, requestId: string) => void;
}

type Tab = "reviews" | "bot" | "done";

const STATUS_ORDER: Record<ReviewRequest["status"], number> = {
  in_review: 0,
  changes_requested: 1,
  pending: 2,
  approved: 3,
  dismissed: 4,
};

const STATUS_COLOR: Record<ReviewRequest["status"], string> = {
  pending: "text-emerald-500",
  in_review: "text-violet-500",
  changes_requested: "text-orange-500",
  approved: "text-emerald-500",
  dismissed: "text-muted-foreground/50",
};

function sortRequests(requests: readonly ReviewRequest[]): ReviewRequest[] {
  return [...requests].toSorted((a, b) => {
    const statusDiff = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    if (statusDiff !== 0) return statusDiff;
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });
}

function filterByTab(requests: readonly ReviewRequest[], tab: Tab): ReviewRequest[] {
  switch (tab) {
    case "reviews":
      return requests.filter((r) => !r.isBot && r.status !== "dismissed");
    case "bot":
      return requests.filter((r) => r.isBot && r.status !== "dismissed");
    case "done":
      return requests.filter((r) => r.status === "dismissed" || r.status === "approved");
  }
}

function countByTab(requests: readonly ReviewRequest[], tab: Tab): number {
  return filterByTab(requests, tab).length;
}

export default function NotificationBell({ onStartReview }: NotificationBellProps) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { isMobile, setOpenMobile } = useSidebar();

  const [popoverOpen, setPopoverOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>("reviews");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  function closeAll() {
    setPopoverOpen(false);
    if (isMobile) setOpenMobile(false);
  }

  const { data } = useQuery(reviewRequestListQueryOptions(120_000));
  const requests = data?.reviewRequests ?? [];

  const pendingNonBot = requests.filter(
    (r) => r.status !== "dismissed" && r.status !== "approved" && !r.isBot,
  );
  const badgeCount = pendingNonBot.length;

  const filtered = sortRequests(filterByTab(requests, activeTab));

  async function handleDismiss(id: string) {
    const api = ensureNativeApi();
    await api.reviewRequest.dismiss({ id });
    await queryClient.invalidateQueries({ queryKey: reviewRequestQueryKeys.all });
    if (expandedId === id) setExpandedId(null);
  }

  async function handleReopen(id: string) {
    const api = ensureNativeApi();
    await api.reviewRequest.reopen({ id });
    await queryClient.invalidateQueries({ queryKey: reviewRequestQueryKeys.all });
  }

  function handleStartReview(request: ReviewRequest) {
    setPopoverOpen(false);
    onStartReview(request.prUrl, request.id);
  }

  function handleGoToThread(threadId: string) {
    closeAll();
    void navigate({
      to: "/$threadId",
      params: { threadId: threadId as ThreadId },
    });
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: "reviews", label: "Reviews" },
    { key: "bot", label: "Bot" },
    { key: "done", label: "Done" },
  ];

  return (
    <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label="Review requests"
            className="relative inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            <BellIcon className="size-3.5" />
            {badgeCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full bg-red-500 text-[9px] font-bold leading-none text-white">
                {badgeCount > 9 ? "9+" : badgeCount}
              </span>
            )}
          </button>
        }
      />
      <PopoverContent
        side="bottom"
        align="end"
        sideOffset={8}
        className={cn("p-0", isMobile ? "w-[calc(100vw-2rem)] max-h-[66vh]" : "w-96")}
      >
        {/* Header */}
        <div className="px-3 pt-2.5 pb-1.5 text-xs font-semibold text-muted-foreground">
          Review Requests
        </div>

        {/* Tabs */}
        <div className="flex gap-0.5 border-b border-border/50 px-3 pb-1.5">
          {tabs.map((tab) => {
            const count = countByTab(requests, tab.key);
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => {
                  setActiveTab(tab.key);
                  setExpandedId(null);
                }}
                className={cn(
                  "inline-flex h-6 items-center gap-1 rounded-md px-2 text-[11px] font-medium transition-colors",
                  activeTab === tab.key
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground/70 hover:text-foreground",
                )}
              >
                <span>{tab.label}</span>
                {count > 0 && (
                  <span
                    className={cn(
                      "inline-flex h-3.5 min-w-3.5 items-center justify-center rounded-full px-1 text-[9px] font-bold leading-none",
                      activeTab === tab.key
                        ? "bg-foreground/10 text-foreground"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* List */}
        {filtered.length === 0 ? (
          <div className="flex items-center justify-center px-3 py-8 text-xs text-muted-foreground/60">
            {activeTab === "reviews"
              ? "No pending review requests"
              : activeTab === "bot"
                ? "No bot review requests"
                : "No completed reviews"}
          </div>
        ) : (
          <div className={cn("overflow-y-auto", isMobile ? "max-h-[calc(66vh-5rem)]" : "max-h-96")}>
            {filtered.map((r) => {
              const isExpanded = expandedId === r.id;
              const repoName = r.repoNameWithOwner.split("/")[1] ?? r.repoNameWithOwner;
              return (
                <div
                  key={r.id}
                  className={cn(
                    "border-b border-border/30",
                    r.status === "dismissed" && "opacity-60",
                  )}
                >
                  {/* Summary row — always visible, click to expand */}
                  <div
                    className="flex cursor-pointer items-center gap-2 px-3 py-2 transition-colors hover:bg-accent/50"
                    onClick={() => setExpandedId(isExpanded ? null : r.id)}
                  >
                    <GitPullRequestIcon className={cn("size-4 shrink-0", STATUS_COLOR[r.status])} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-1">
                        <span className="truncate text-sm font-medium">{repoName}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          #{r.prNumber}
                        </span>
                        {r.isBot && (
                          <span className="shrink-0 rounded bg-muted px-1 text-[10px] text-muted-foreground">
                            bot
                          </span>
                        )}
                      </div>
                      <div className="truncate text-[11px] text-muted-foreground/70">
                        {r.prTitle}
                        <span className="ml-1 opacity-60">by {r.authorLogin}</span>
                      </div>
                    </div>
                    {r.status === "dismissed" || r.status === "approved" ? (
                      <button
                        type="button"
                        aria-label="Reopen"
                        className="shrink-0 rounded p-0.5 text-muted-foreground/40 transition-colors hover:bg-accent hover:text-foreground"
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleReopen(r.id);
                        }}
                      >
                        <RotateCcwIcon className="size-3" />
                      </button>
                    ) : (
                      <button
                        type="button"
                        aria-label="Dismiss"
                        className="shrink-0 rounded p-0.5 text-muted-foreground/40 transition-colors hover:bg-accent hover:text-foreground"
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleDismiss(r.id);
                        }}
                      >
                        <XIcon className="size-3" />
                      </button>
                    )}
                  </div>

                  {/* Expanded detail — shows on click */}
                  {isExpanded && (
                    <div className="border-t border-border/20 bg-accent/30 px-3 py-2.5">
                      {/* PR body preview */}
                      {r.prBody && (
                        <p className="mb-2 line-clamp-4 text-[11px] leading-relaxed text-muted-foreground/80">
                          {r.prBody}
                        </p>
                      )}
                      {/* Labels */}
                      {r.prLabels && r.prLabels.length > 0 && (
                        <div className="mb-2 flex flex-wrap gap-1">
                          {r.prLabels.map((label) => (
                            <span
                              key={label}
                              className="rounded-full border border-border/50 bg-muted/50 px-1.5 py-0.5 text-[10px] text-muted-foreground"
                            >
                              {label}
                            </span>
                          ))}
                        </div>
                      )}
                      {/* Actions */}
                      <div className="flex items-center gap-2">
                        {r.status === "in_review" && r.threadId ? (
                          <button
                            type="button"
                            onClick={() => handleGoToThread(r.threadId!)}
                            className="inline-flex h-6 items-center gap-1 rounded-md bg-violet-500/20 px-2.5 text-[11px] font-medium text-violet-400 transition-colors hover:bg-violet-500/30"
                          >
                            Go to Review
                          </button>
                        ) : r.status === "dismissed" || r.status === "approved" ? (
                          <button
                            type="button"
                            onClick={() => void handleReopen(r.id)}
                            className="inline-flex h-6 items-center gap-1 rounded-md border border-border/50 px-2.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                          >
                            <RotateCcwIcon className="size-2.5" />
                            Reopen
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleStartReview(r)}
                            className="inline-flex h-6 items-center gap-1 rounded-md bg-emerald-500/20 px-2.5 text-[11px] font-medium text-emerald-400 transition-colors hover:bg-emerald-500/30"
                          >
                            Start Review
                          </button>
                        )}
                        <a
                          href={r.prUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex h-6 items-center gap-1 rounded-md border border-border/50 px-2 text-[11px] text-muted-foreground/70 transition-colors hover:text-foreground"
                        >
                          <ExternalLinkIcon className="size-2.5" />
                          GitHub
                        </a>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
