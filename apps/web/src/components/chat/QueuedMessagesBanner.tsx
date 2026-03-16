import { memo } from "react";
import { ClockIcon, ImageIcon, XIcon } from "lucide-react";
import { Button } from "../ui/button";
import type { QueuedMessage } from "../../hooks/useMessageQueue";

interface QueuedMessagesBannerProps {
  queue: QueuedMessage[];
  onCancel: (id: string) => void;
}

export const QueuedMessagesBanner = memo(function QueuedMessagesBanner({
  queue,
  onCancel,
}: QueuedMessagesBannerProps) {
  if (queue.length === 0) return null;

  return (
    <div className="mb-1.5 overflow-hidden rounded-xl border border-border/60 bg-muted/30">
      <div className="flex items-center gap-2 border-b border-border/40 px-3 py-1.5">
        <ClockIcon className="size-3 shrink-0 text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground">
          {queue.length === 1 ? "1 message queued" : `${queue.length} messages queued`}
        </span>
        <span className="text-xs text-muted-foreground/60">— will send when AI is ready</span>
      </div>
      <div className="divide-y divide-border/30">
        {queue.map((msg) => {
          const preview =
            msg.text.length > 60 ? `${msg.text.slice(0, 60)}…` : msg.text || "(images only)";
          return (
            <div key={msg.id} className="flex items-center gap-2 px-3 py-2">
              <span className="min-w-0 flex-1 truncate text-xs text-foreground/80">{preview}</span>
              {msg.images.length > 0 && (
                <div className="flex shrink-0 items-center gap-0.5 text-muted-foreground">
                  <ImageIcon className="size-3" />
                  <span className="text-xs">{msg.images.length}</span>
                </div>
              )}
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="shrink-0 text-muted-foreground hover:text-foreground"
                onClick={() => onCancel(msg.id)}
                aria-label="Cancel queued message"
              >
                <XIcon className="size-3" />
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
});
