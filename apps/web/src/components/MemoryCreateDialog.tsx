import {
  TrimmedNonEmptyString,
  type MemoryCategory,
  type MemoryDate,
  type MemoryScope,
  type ProjectId,
} from "@t3tools/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { memoryCreateMutationOptions } from "../lib/memoryReactQuery";
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
import { Textarea } from "./ui/textarea";

const CATEGORY_OPTIONS: { value: MemoryCategory; label: string }[] = [
  { value: "fact", label: "Fact" },
  { value: "convention", label: "Convention" },
  { value: "decision", label: "Decision" },
  { value: "preference", label: "Preference" },
  { value: "pattern", label: "Pattern" },
];

const SCOPE_OPTIONS: { value: MemoryScope; label: string; description: string }[] = [
  { value: "project", label: "Project", description: "Only available in this project" },
  { value: "thread", label: "Thread", description: "Summary of a conversation thread" },
  { value: "daily", label: "Daily", description: "Scoped to today's date" },
];

interface MemoryCreateDialogProps {
  projectId: ProjectId;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function MemoryCreateDialog({ projectId, open, onOpenChange }: MemoryCreateDialogProps) {
  const queryClient = useQueryClient();
  const createMutation = useMutation(memoryCreateMutationOptions(queryClient));

  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [category, setCategory] = useState<MemoryCategory>("fact");
  const [scope, setScope] = useState<MemoryScope>("project");

  const resetForm = useCallback(() => {
    setTitle("");
    setContent("");
    setCategory("fact");
    setScope("project");
  }, []);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!title.trim() || !content.trim()) return;

      await createMutation.mutateAsync({
        projectId: scope === "project" || scope === "daily" ? projectId : undefined,
        scope,
        category,
        title: TrimmedNonEmptyString.makeUnsafe(title.trim()),
        content: TrimmedNonEmptyString.makeUnsafe(content.trim()),
        ...(scope === "daily" ? { date: new Date().toISOString().slice(0, 10) as MemoryDate } : {}),
      });

      resetForm();
      onOpenChange(false);
    },
    [title, content, category, scope, projectId, createMutation, resetForm, onOpenChange],
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
            <DialogTitle>Create Memory</DialogTitle>
            <DialogDescription>
              Add a new memory that will be available for context in future conversations.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <div className="flex flex-col gap-4">
              {/* Title */}
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="memory-title">Title</Label>
                <Input
                  id="memory-title"
                  placeholder="e.g., Use camelCase for variables"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  required
                  autoFocus
                />
              </div>

              {/* Content */}
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="memory-content">Content</Label>
                <Textarea
                  id="memory-content"
                  placeholder="Describe the memory in detail..."
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  required
                  rows={4}
                />
              </div>

              {/* Category */}
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="memory-category">Category</Label>
                <select
                  id="memory-category"
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-ring"
                  value={category}
                  onChange={(e) => setCategory(e.target.value as MemoryCategory)}
                >
                  {CATEGORY_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Scope */}
              <div className="flex flex-col gap-1.5">
                <Label>Scope</Label>
                <div className="flex gap-3">
                  {SCOPE_OPTIONS.map((opt) => (
                    <label
                      key={opt.value}
                      className={`flex flex-1 cursor-pointer flex-col gap-0.5 rounded-lg border p-3 text-sm transition-colors ${
                        scope === opt.value
                          ? "border-primary bg-primary/5"
                          : "border-input hover:bg-accent/30"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <input
                          type="radio"
                          name="memory-scope"
                          value={opt.value}
                          checked={scope === opt.value}
                          onChange={() => setScope(opt.value)}
                          className="accent-primary"
                        />
                        <span className="font-medium">{opt.label}</span>
                      </div>
                      <span className="text-xs text-muted-foreground">{opt.description}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </DialogPanel>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" type="button" />}>Cancel</DialogClose>
            <Button
              type="submit"
              disabled={!title.trim() || !content.trim() || createMutation.isPending}
            >
              {createMutation.isPending ? "Creating..." : "Create Memory"}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
