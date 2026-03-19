/**
 * Shared helper for converting orchestration threads into prompt-ready transcripts.
 *
 * @module memory/threadTranscript
 */
import type { OrchestrationMessage, OrchestrationThread } from "@t3tools/contracts";

export interface ThreadTranscript {
  threadTitle: string;
  messages: readonly { role: string; text: string }[];
}

/** Convert an orchestration thread into a prompt-ready transcript. */
export function threadToTranscript(thread: OrchestrationThread): ThreadTranscript {
  const messages = thread.messages
    .filter((m: OrchestrationMessage) => !m.streaming && m.text.trim().length > 0)
    .map((m: OrchestrationMessage) => ({ role: m.role, text: m.text }));
  return { threadTitle: thread.title, messages };
}
