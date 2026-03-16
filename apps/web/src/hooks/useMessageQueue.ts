import { useCallback, useSyncExternalStore } from "react";
import type { ComposerImageAttachment } from "../composerDraftStore";

export interface QueuedMessage {
  id: string;
  text: string;
  images: ComposerImageAttachment[];
  queuedAt: string;
}

// Module-level store keyed by threadId so the queue survives component
// unmount/remount when the user navigates between threads.
const EMPTY: QueuedMessage[] = [];
const queuesByThread = new Map<string, QueuedMessage[]>();
const listeners = new Set<() => void>();

function getQueue(threadId: string): QueuedMessage[] {
  return queuesByThread.get(threadId) ?? EMPTY;
}

function setQueue(threadId: string, next: QueuedMessage[]) {
  if (next.length === 0) {
    queuesByThread.delete(threadId);
  } else {
    queuesByThread.set(threadId, next);
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useMessageQueue(threadId: string) {
  const queue = useSyncExternalStore(
    subscribe,
    () => getQueue(threadId),
    () => EMPTY,
  );

  const enqueue = useCallback(
    (text: string, images: ComposerImageAttachment[]): string => {
      const id = crypto.randomUUID();
      const item: QueuedMessage = { id, text, images, queuedAt: new Date().toISOString() };
      setQueue(threadId, [...getQueue(threadId), item]);
      return id;
    },
    [threadId],
  );

  const drainAll = useCallback((): QueuedMessage[] => {
    const items = getQueue(threadId);
    if (items.length === 0) return items;
    setQueue(threadId, []);
    return items;
  }, [threadId]);

  const removeById = useCallback(
    (id: string) => {
      const current = getQueue(threadId);
      const next = current.filter((msg) => msg.id !== id);
      if (next.length !== current.length) setQueue(threadId, next);
    },
    [threadId],
  );

  const clearQueue = useCallback(() => {
    setQueue(threadId, []);
  }, [threadId]);

  return { queue, enqueue, drainAll, removeById, clearQueue };
}
