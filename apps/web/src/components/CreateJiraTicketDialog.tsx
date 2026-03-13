import { useCallback, useState } from "react";
import type { LinkedJiraTicket } from "@t3tools/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircleIcon,
  ClipboardCopyIcon,
  LoaderIcon,
  SearchIcon,
  SparklesIcon,
} from "lucide-react";
import {
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogTitle,
} from "~/components/ui/dialog";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import { JiraIcon } from "./Icons";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import {
  jiraCreateIssueMutationOptions,
  jiraViewIssueQueryOptions,
  jiraMyOpenIssuesQueryOptions,
  jiraGenerateTicketContentMutationOptions,
} from "~/lib/jiraReactQuery";
import { readNativeApi } from "~/nativeApi";
import { newCommandId } from "~/lib/utils";

interface CreateJiraTicketDialogProps {
  threadId: string;
  onClose: () => void;
  onTicketLinked: (ticket: LinkedJiraTicket) => void;
}

type Mode = "link" | "create";

export function CreateJiraTicketDialog({
  threadId,
  onClose,
  onTicketLinked,
}: CreateJiraTicketDialogProps) {
  const [mode, setMode] = useState<Mode>("link");
  const [keyInput, setKeyInput] = useState("");
  const [projectKey, setProjectKey] = useState("");
  const [issueType, setIssueType] = useState("Task");
  const [summary, setSummary] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);

  const queryClient = useQueryClient();
  const createMutation = useMutation(jiraCreateIssueMutationOptions({ queryClient }));
  const generateMutation = useMutation(jiraGenerateTicketContentMutationOptions());

  const parsedKey = extractJiraKey(keyInput.trim());
  const issueQuery = useQuery(jiraViewIssueQueryOptions(parsedKey));
  const myIssuesQuery = useQuery(jiraMyOpenIssuesQueryOptions());

  const dispatchLink = useCallback(
    (ticket: LinkedJiraTicket) => {
      const api = readNativeApi();
      if (api) {
        void api.orchestration
          .dispatchCommand({
            type: "thread.meta.update",
            commandId: newCommandId(),
            threadId: threadId as any,
            linkedJiraTicket: ticket,
          })
          .catch(() => undefined);
      }
      onTicketLinked(ticket);
      onClose();
    },
    [threadId, onTicketLinked, onClose],
  );

  const linkExistingTicket = useCallback(() => {
    if (!issueQuery.data) return;
    dispatchLink({
      key: issueQuery.data.key,
      url: issueQuery.data.url,
      title: issueQuery.data.summary,
      status: "active",
      linkedAt: new Date().toISOString(),
    });
  }, [issueQuery.data, dispatchLink]);

  const handleCreate = useCallback(async () => {
    if (!projectKey || !summary) return;
    setError(null);
    try {
      const result = await createMutation.mutateAsync({
        projectKey,
        type: issueType,
        priority: "Medium",
        summary,
        description,
      });
      dispatchLink({
        key: result.key,
        url: result.url,
        title: summary,
        status: "active",
        linkedAt: new Date().toISOString(),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create issue.");
    }
  }, [projectKey, issueType, summary, description, createMutation, dispatchLink]);

  const handleGenerate = useCallback(async () => {
    if (!projectKey) return;
    setError(null);
    try {
      const result = await generateMutation.mutateAsync({
        threadId: threadId as any,
        projectKey,
      });
      setSummary(result.summary);
      setDescription(result.description);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate content.");
    }
  }, [projectKey, generateMutation]);

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <JiraIcon className="size-5" />
          Jira Ticket
        </DialogTitle>
        <DialogDescription>Link an existing ticket or create a new one.</DialogDescription>
      </DialogHeader>

      <DialogPanel>
        <div className="flex flex-col gap-4">
          {/* Mode tabs */}
          <div className="flex gap-1 rounded-md border border-border/70 bg-muted/30 p-1">
            <button
              type="button"
              className={`flex-1 rounded-sm px-3 py-1.5 text-xs font-medium transition-colors ${
                mode === "link"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => setMode("link")}
            >
              Link Existing
            </button>
            <button
              type="button"
              className={`flex-1 rounded-sm px-3 py-1.5 text-xs font-medium transition-colors ${
                mode === "create"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => setMode("create")}
            >
              Create New
            </button>
          </div>

          {mode === "link" ? (
            <div className="flex flex-col gap-3">
              <div className="flex gap-2">
                <Input
                  placeholder="PROJ-123 or Jira URL"
                  value={keyInput}
                  onChange={(e) => setKeyInput(e.target.value)}
                  autoFocus
                />
                {issueQuery.isLoading && (
                  <div className="flex shrink-0 items-center">
                    <LoaderIcon className="size-3.5 animate-spin text-muted-foreground" />
                  </div>
                )}
              </div>

              {issueQuery.data && (
                <div className="rounded-lg border border-border/70 bg-muted/50 p-3">
                  <div className="flex items-start gap-2">
                    <SearchIcon className="mt-0.5 size-3.5 shrink-0 text-blue-500" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">
                        {issueQuery.data.key}: {issueQuery.data.summary}
                      </p>
                      <p className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                        <span>{issueQuery.data.type}</span>
                        <span>&middot;</span>
                        <span>{issueQuery.data.status}</span>
                        <span>&middot;</span>
                        <span>{issueQuery.data.priority}</span>
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {issueQuery.isError && (
                <p className="text-xs text-destructive">Could not find issue.</p>
              )}

              {!parsedKey && myIssuesQuery.data && myIssuesQuery.data.issues.length > 0 && (
                <div>
                  <p className="mb-1.5 text-[11px] uppercase tracking-wide text-muted-foreground/60">
                    My open tickets
                  </p>
                  <div className="max-h-48 overflow-y-auto rounded-md border">
                    {myIssuesQuery.data.issues.map((issue) => (
                      <button
                        key={issue.key}
                        type="button"
                        className="flex w-full items-center gap-2 border-b border-border/40 px-3 py-2 text-left transition-colors last:border-b-0 hover:bg-accent/50"
                        onClick={() => setKeyInput(issue.key)}
                      >
                        <JiraIcon className="size-3.5 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate text-xs font-medium">
                          {issue.key} {issue.summary}
                        </span>
                        <span className="shrink-0 text-[10px] text-muted-foreground/60">
                          {issue.status}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {!parsedKey && myIssuesQuery.isLoading && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <LoaderIcon className="size-3 animate-spin" />
                  Loading your tickets...
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex gap-2">
                <Input
                  placeholder="Project Key (e.g. PROJ)"
                  value={projectKey}
                  onChange={(e) => setProjectKey(e.target.value.toUpperCase())}
                  className="flex-1"
                  autoFocus
                />
                <Select value={issueType} onValueChange={(v) => v && setIssueType(v)}>
                  <SelectTrigger size="sm" className="w-28">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectPopup>
                    <SelectItem value="Task">Task</SelectItem>
                    <SelectItem value="Bug">Bug</SelectItem>
                    <SelectItem value="Story">Story</SelectItem>
                    <SelectItem value="Epic">Epic</SelectItem>
                    <SelectItem value="Sub-task">Sub-task</SelectItem>
                  </SelectPopup>
                </Select>
              </div>
              <Input
                placeholder="Summary"
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
              />
              <Textarea
                placeholder="Description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={handleGenerate}
                disabled={!projectKey || generateMutation.isPending}
                className="self-start"
              >
                {generateMutation.isPending ? (
                  <>
                    <LoaderIcon className="size-3 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <SparklesIcon className="size-3" />
                    Generate with AI
                  </>
                )}
              </Button>
              {error && (
                <div className="rounded-md border border-border/70 bg-muted/30 p-2.5">
                  <div className="mb-1.5 flex items-center justify-between">
                    <p className="flex items-center gap-1 text-xs font-medium text-destructive">
                      <AlertCircleIcon className="size-3" />
                      Something went wrong
                    </p>
                    <button
                      type="button"
                      className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                      onClick={() => void navigator.clipboard.writeText(error)}
                      title="Copy error"
                    >
                      <ClipboardCopyIcon className="size-3" />
                    </button>
                  </div>
                  <pre className="max-h-24 select-all overflow-auto whitespace-pre-wrap break-all rounded bg-muted/50 p-2 font-mono text-[11px] text-muted-foreground">
                    {error}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>
      </DialogPanel>

      <DialogFooter>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
        {mode === "link" ? (
          <Button size="sm" onClick={linkExistingTicket} disabled={!issueQuery.data}>
            Link Ticket
          </Button>
        ) : (
          <Button
            size="sm"
            onClick={handleCreate}
            disabled={!projectKey || !summary || createMutation.isPending}
          >
            {createMutation.isPending ? (
              <>
                <LoaderIcon className="size-3 animate-spin" />
                Creating...
              </>
            ) : (
              "Create & Link"
            )}
          </Button>
        )}
      </DialogFooter>
    </>
  );
}

function extractJiraKey(input: string): string | null {
  if (!input) return null;
  const keyMatch = /([A-Z][A-Z0-9]+-\d+)/.exec(input);
  return keyMatch?.[1] ?? null;
}
