import { useCallback, useState } from "react";
import type { LinkedJiraTicket } from "@t3tools/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircleIcon,
  ClipboardCopyIcon,
  LoaderIcon,
  MessageSquareIcon,
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
import { Textarea } from "~/components/ui/textarea";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import {
  jiraAddCommentMutationOptions,
  jiraGenerateProgressCommentMutationOptions,
  jiraMoveIssueMutationOptions,
  jiraViewIssueQueryOptions,
  jiraListTransitionsQueryOptions,
} from "~/lib/jiraReactQuery";

interface UpdateJiraProgressDialogProps {
  threadId: string;
  ticket: LinkedJiraTicket;
  onClose: () => void;
}

export function UpdateJiraProgressDialog({
  threadId,
  ticket,
  onClose,
}: UpdateJiraProgressDialogProps) {
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [selectedTransition, setSelectedTransition] = useState<string | null>(null);

  const queryClient = useQueryClient();
  const addCommentMutation = useMutation(jiraAddCommentMutationOptions({ queryClient }));
  const moveIssueMutation = useMutation(jiraMoveIssueMutationOptions({ queryClient }));
  const generateMutation = useMutation(jiraGenerateProgressCommentMutationOptions());

  const issueQuery = useQuery(jiraViewIssueQueryOptions(ticket.key));
  const transitionsQuery = useQuery(jiraListTransitionsQueryOptions(ticket.key));

  const handleGenerate = useCallback(async () => {
    setError(null);
    try {
      const result = await generateMutation.mutateAsync({
        threadId: threadId as any,
        ticketKey: ticket.key,
        ticketTitle: ticket.title,
      });
      setComment(result.comment);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate comment.");
    }
  }, [ticket.key, ticket.title, generateMutation]);

  const handleSubmit = useCallback(async () => {
    if (!comment.trim()) return;
    setError(null);
    try {
      // Post comment
      await addCommentMutation.mutateAsync({
        key: ticket.key,
        comment: comment.trim(),
      });
      // Move ticket if a transition was selected
      if (selectedTransition) {
        await moveIssueMutation.mutateAsync({
          key: ticket.key,
          targetStatus: selectedTransition,
        });
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to post comment.");
    }
  }, [ticket.key, comment, selectedTransition, addCommentMutation, moveIssueMutation, onClose]);

  const issue = issueQuery.data;

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <MessageSquareIcon className="size-5" />
          Update Progress
        </DialogTitle>
        <DialogDescription>
          Post a progress comment to {ticket.key}: {ticket.title}
        </DialogDescription>
      </DialogHeader>

      <DialogPanel>
        <div className="flex flex-col gap-3">
          {/* Ticket details */}
          {issueQuery.isLoading && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <LoaderIcon className="size-3 animate-spin" />
              Loading ticket details...
            </div>
          )}
          {issue && (
            <div className="rounded-lg border border-border/70 bg-muted/30 p-3">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="rounded bg-muted px-1.5 py-0.5 font-medium text-foreground">
                  {issue.type}
                </span>
                <span className="rounded bg-muted px-1.5 py-0.5">{issue.status}</span>
                <span className="rounded bg-muted px-1.5 py-0.5">{issue.priority}</span>
              </div>
              {issue.description && (
                <p className="mt-2 line-clamp-3 text-xs text-muted-foreground">
                  {issue.description}
                </p>
              )}
            </div>
          )}

          {/* Transition selector */}
          {transitionsQuery.data && transitionsQuery.data.transitions.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="shrink-0 text-xs text-muted-foreground">Move to:</span>
              <Select
                value={selectedTransition ?? ""}
                onValueChange={(v) => setSelectedTransition(v || null)}
              >
                <SelectTrigger size="sm" className="flex-1">
                  <SelectValue placeholder="Keep current status" />
                </SelectTrigger>
                <SelectPopup>
                  <SelectItem value="">Keep current status</SelectItem>
                  {transitionsQuery.data.transitions.map((t) => (
                    <SelectItem key={t.id} value={t.name}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </div>
          )}

          <Textarea
            placeholder="Write a progress update..."
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={4}
            autoFocus
          />
          <Button
            variant="outline"
            size="sm"
            onClick={handleGenerate}
            disabled={generateMutation.isPending}
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
      </DialogPanel>

      <DialogFooter>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button
          size="sm"
          onClick={handleSubmit}
          disabled={!comment.trim() || addCommentMutation.isPending || moveIssueMutation.isPending}
        >
          {addCommentMutation.isPending || moveIssueMutation.isPending ? (
            <>
              <LoaderIcon className="size-3 animate-spin" />
              Posting...
            </>
          ) : selectedTransition ? (
            `Post & Move to ${selectedTransition}`
          ) : (
            "Post Comment"
          )}
        </Button>
      </DialogFooter>
    </>
  );
}
