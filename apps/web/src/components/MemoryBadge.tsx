import type { ProjectId, ThreadId } from "@t3tools/contracts";
import { useQuery } from "@tanstack/react-query";
import { BrainIcon } from "lucide-react";
import { memo } from "react";
import { memoryForThreadQueryOptions } from "../lib/memoryReactQuery";
import { Button } from "./ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

interface MemoryBadgeProps {
  threadId: ThreadId;
  projectId: ProjectId | null;
  onClick?: () => void;
}

export const MemoryBadge = memo(function MemoryBadge({
  threadId,
  projectId,
  onClick,
}: MemoryBadgeProps) {
  const query = useQuery(memoryForThreadQueryOptions(threadId, projectId));

  const count = query.data?.memories?.length ?? 0;

  if (count === 0) return null;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button variant="outline" size="xs" onClick={onClick}>
            <BrainIcon className="size-3" />
            {count}
          </Button>
        }
      />
      <TooltipPopup side="bottom">
        {count} {count === 1 ? "memory" : "memories"} available for this thread
      </TooltipPopup>
    </Tooltip>
  );
});
