import { useCallback, useRef, useState } from "react";
import type { ComposerImageAttachment } from "../composerDraftStore";

export interface QueuedMessage {
  id: string;
  text: string;
  images: ComposerImageAttachment[];
  queuedAt: string;
}

export function useMessageQueue() {
  const [queue, setQueue] = useState<QueuedMessage[]>([]);
  // Keep a ref in sync for synchronous access (state reads are batched)
  const queueRef = useRef<QueuedMessage[]>([]);

  const enqueue = useCallback((text: string, images: ComposerImageAttachment[]): string => {
    const id = crypto.randomUUID();
    const item: QueuedMessage = { id, text, images, queuedAt: new Date().toISOString() };
    queueRef.current = [...queueRef.current, item];
    setQueue(queueRef.current);
    return id;
  }, []);

  const popFirst = useCallback((): QueuedMessage | null => {
    const first = queueRef.current[0] ?? null;
    if (first) {
      queueRef.current = queueRef.current.slice(1);
      setQueue(queueRef.current);
    }
    return first;
  }, []);

  const removeById = useCallback((id: string) => {
    queueRef.current = queueRef.current.filter((msg) => msg.id !== id);
    setQueue(queueRef.current);
  }, []);

  const drainAll = useCallback((): QueuedMessage[] => {
    const items = queueRef.current;
    if (items.length === 0) return items;
    queueRef.current = [];
    setQueue([]);
    return items;
  }, []);

  const clearQueue = useCallback(() => {
    queueRef.current = [];
    setQueue([]);
  }, []);

  return { queue, enqueue, popFirst, drainAll, removeById, clearQueue };
}
