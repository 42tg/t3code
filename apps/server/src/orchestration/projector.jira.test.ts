import {
  CommandId,
  EventId,
  ProjectId,
  ThreadId,
  type LinkedJiraTicket,
  type OrchestrationEvent,
} from "@t3tools/contracts";
import { describe, expect, it } from "vitest";
import { Effect } from "effect";

import { createEmptyReadModel, projectEvent } from "./projector.ts";

function makeEvent(input: {
  sequence: number;
  type: OrchestrationEvent["type"];
  occurredAt: string;
  aggregateKind: OrchestrationEvent["aggregateKind"];
  aggregateId: string;
  commandId: string | null;
  payload: unknown;
}): OrchestrationEvent {
  return {
    sequence: input.sequence,
    eventId: EventId.makeUnsafe(`event-${input.sequence}`),
    type: input.type,
    aggregateKind: input.aggregateKind,
    aggregateId:
      input.aggregateKind === "project"
        ? ProjectId.makeUnsafe(input.aggregateId)
        : ThreadId.makeUnsafe(input.aggregateId),
    occurredAt: input.occurredAt,
    commandId: input.commandId === null ? null : CommandId.makeUnsafe(input.commandId),
    causationEventId: null,
    correlationId: null,
    metadata: {},
    payload: input.payload as never,
  } as OrchestrationEvent;
}

describe("orchestration projector: linkedJiraTicket", () => {
  const NOW = new Date().toISOString();

  const ticket: LinkedJiraTicket = {
    key: "PROJ-42",
    url: "https://jira.example.com/browse/PROJ-42",
    title: "Implement dark mode",
    status: "active",
    linkedAt: NOW,
  };

  async function createThreadModel() {
    return Effect.runPromise(
      projectEvent(
        createEmptyReadModel(NOW),
        makeEvent({
          sequence: 1,
          type: "thread.created",
          aggregateKind: "thread",
          aggregateId: "thread-1",
          occurredAt: NOW,
          commandId: "cmd-create",
          payload: {
            threadId: "thread-1",
            projectId: "project-1",
            title: "Projector test",
            model: "gpt-5-codex",
            runtimeMode: "full-access",
            branch: null,
            worktreePath: null,
            createdAt: NOW,
            updatedAt: NOW,
          },
        }),
      ),
    );
  }

  it("thread.created defaults linkedJiraTicket to null", async () => {
    const model = await createThreadModel();
    expect(model.threads[0]!.linkedJiraTicket).toBeNull();
  });

  it("thread.meta-updated sets linkedJiraTicket", async () => {
    const model = await createThreadModel();

    const next = await Effect.runPromise(
      projectEvent(
        model,
        makeEvent({
          sequence: 2,
          type: "thread.meta-updated",
          aggregateKind: "thread",
          aggregateId: "thread-1",
          occurredAt: NOW,
          commandId: "cmd-link",
          payload: {
            threadId: "thread-1",
            linkedJiraTicket: ticket,
            updatedAt: NOW,
          },
        }),
      ),
    );

    expect(next.threads[0]!.linkedJiraTicket).toEqual(ticket);
  });

  it("thread.meta-updated can clear linkedJiraTicket to null", async () => {
    const model = await createThreadModel();

    // First link a ticket
    const withTicket = await Effect.runPromise(
      projectEvent(
        model,
        makeEvent({
          sequence: 2,
          type: "thread.meta-updated",
          aggregateKind: "thread",
          aggregateId: "thread-1",
          occurredAt: NOW,
          commandId: "cmd-link",
          payload: {
            threadId: "thread-1",
            linkedJiraTicket: ticket,
            updatedAt: NOW,
          },
        }),
      ),
    );
    expect(withTicket.threads[0]!.linkedJiraTicket).toEqual(ticket);

    // Then unlink
    const cleared = await Effect.runPromise(
      projectEvent(
        withTicket,
        makeEvent({
          sequence: 3,
          type: "thread.meta-updated",
          aggregateKind: "thread",
          aggregateId: "thread-1",
          occurredAt: NOW,
          commandId: "cmd-unlink",
          payload: {
            threadId: "thread-1",
            linkedJiraTicket: null,
            updatedAt: NOW,
          },
        }),
      ),
    );
    expect(cleared.threads[0]!.linkedJiraTicket).toBeNull();
  });

  it("thread.meta-updated preserves linkedJiraTicket when not in payload", async () => {
    const model = await createThreadModel();

    // Link a ticket
    const withTicket = await Effect.runPromise(
      projectEvent(
        model,
        makeEvent({
          sequence: 2,
          type: "thread.meta-updated",
          aggregateKind: "thread",
          aggregateId: "thread-1",
          occurredAt: NOW,
          commandId: "cmd-link",
          payload: {
            threadId: "thread-1",
            linkedJiraTicket: ticket,
            updatedAt: NOW,
          },
        }),
      ),
    );

    // Update title only — linkedJiraTicket should be preserved
    const renamed = await Effect.runPromise(
      projectEvent(
        withTicket,
        makeEvent({
          sequence: 3,
          type: "thread.meta-updated",
          aggregateKind: "thread",
          aggregateId: "thread-1",
          occurredAt: NOW,
          commandId: "cmd-rename",
          payload: {
            threadId: "thread-1",
            title: "Renamed thread",
            updatedAt: NOW,
          },
        }),
      ),
    );
    expect(renamed.threads[0]!.linkedJiraTicket).toEqual(ticket);
  });

  it("thread.meta-updated transitions ticket to completed", async () => {
    const model = await createThreadModel();

    const completedTicket: LinkedJiraTicket = {
      ...ticket,
      status: "completed",
      completedAt: NOW,
    };

    const withTicket = await Effect.runPromise(
      projectEvent(
        model,
        makeEvent({
          sequence: 2,
          type: "thread.meta-updated",
          aggregateKind: "thread",
          aggregateId: "thread-1",
          occurredAt: NOW,
          commandId: "cmd-link",
          payload: {
            threadId: "thread-1",
            linkedJiraTicket: ticket,
            updatedAt: NOW,
          },
        }),
      ),
    );

    const completed = await Effect.runPromise(
      projectEvent(
        withTicket,
        makeEvent({
          sequence: 3,
          type: "thread.meta-updated",
          aggregateKind: "thread",
          aggregateId: "thread-1",
          occurredAt: NOW,
          commandId: "cmd-complete",
          payload: {
            threadId: "thread-1",
            linkedJiraTicket: completedTicket,
            updatedAt: NOW,
          },
        }),
      ),
    );

    expect(completed.threads[0]!.linkedJiraTicket).toEqual(completedTicket);
    expect(completed.threads[0]!.linkedJiraTicket!.status).toBe("completed");
    expect(completed.threads[0]!.linkedJiraTicket!.completedAt).toBe(NOW);
  });
});
