import type { ProjectId } from "@t3tools/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { memoryExtractMutationOptions } from "../lib/memoryReactQuery";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogPanel,
  DialogFooter,
  DialogClose,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

/** Default to 24 hours ago in local datetime-local format. */
function defaultSinceDate(): string {
  const d = new Date(Date.now() - 24 * 60 * 60 * 1000);
  // datetime-local expects YYYY-MM-DDTHH:mm
  return d.toISOString().slice(0, 16);
}

interface MemoryExtractDialogProps {
  projectId: ProjectId;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function MemoryExtractDialog({ projectId, open, onOpenChange }: MemoryExtractDialogProps) {
  const queryClient = useQueryClient();
  const extractMutation = useMutation(memoryExtractMutationOptions(queryClient));

  const [sinceDate, setSinceDate] = useState(defaultSinceDate);
  const [resultText, setResultText] = useState<string | null>(null);

  const resetForm = useCallback(() => {
    setSinceDate(defaultSinceDate());
    setResultText(null);
  }, []);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!sinceDate) return;

      setResultText(null);
      const result = await extractMutation.mutateAsync({
        sinceDate: new Date(sinceDate).toISOString(),
        projectId,
      });

      setResultText(
        `Extracted ${result.extractedCount} memories, skipped ${result.skippedDuplicates} duplicates across ${result.projectsProcessed} projects.`,
      );
    },
    [sinceDate, projectId, extractMutation],
  );

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) resetForm();
      onOpenChange(nextOpen);
    },
    [resetForm, onOpenChange],
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogPopup>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Extract Memories</DialogTitle>
            <DialogDescription>
              Analyze recent conversations and automatically extract project knowledge and daily
              summaries.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="extract-since">Extract from conversations since</Label>
                <Input
                  id="extract-since"
                  type="datetime-local"
                  value={sinceDate}
                  onChange={(e) => setSinceDate(e.target.value)}
                  required
                />
                <p className="text-xs text-muted-foreground">
                  Threads updated after this time will be analyzed.
                </p>
              </div>

              {resultText && (
                <div className="rounded-md border bg-muted/50 p-3 text-sm text-muted-foreground">
                  {resultText}
                </div>
              )}
            </div>
          </DialogPanel>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" type="button" />}>Cancel</DialogClose>
            <Button type="submit" disabled={!sinceDate || extractMutation.isPending}>
              {extractMutation.isPending ? "Extracting..." : "Extract Memories"}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
