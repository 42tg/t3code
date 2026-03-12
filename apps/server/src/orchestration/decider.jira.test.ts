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

import { decideOrchestrationCommand } from "./decider.ts";
import { createEmptyReadModel, projectEvent } from "./projector.ts";

const asEventId = (value: string): EventId => EventId.makeUnsafe(value);
const asProjectId = (value: string): ProjectId => ProjectId.makeUnsafe(value);
const asThreadId = (value: string): ThreadId => ThreadId.makeUnsafe(value);

const NOW = new Date().toISOString();

function makeReadModelWithThread() {
  return Effect.runPromise(
    projectEvent(createEmptyReadModel(NOW), {
      sequence: 1,
      eventId: asEventId("evt-thread-create"),
      aggregateKind: "thread",
      aggregateId: asThreadId("thread-jira"),
      type: "thread.created",
      occurredAt: NOW,
      commandId: CommandId.makeUnsafe("cmd-thread-create"),
      causationEventId: null,
      correlationId: CommandId.makeUnsafe("cmd-thread-create"),
      metadata: {},
      payload: {
        threadId: asThreadId("thread-jira"),
        projectId: asProjectId("project-1"),
        title: "Jira test thread",
        model: "gpt-5-codex",
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        createdAt: NOW,
        updatedAt: NOW,
      },
    } as OrchestrationEvent),
  );
}

describe("decider: thread.meta.update with linkedJiraTicket", () => {
  const ticket: LinkedJiraTicket = {
    key: "PROJ-123",
    url: "https://jira.example.com/browse/PROJ-123",
    title: "Fix the login bug",
    status: "active",
    linkedAt: NOW,
  };

  it("emits thread.meta-updated with linkedJiraTicket when linking a ticket", async () => {
    const readModel = await makeReadModelWithThread();

    const result = await Effect.runPromise(
      decideOrchestrationCommand({
        command: {
          type: "thread.meta.update",
          commandId: CommandId.makeUnsafe("cmd-link-jira"),
          threadId: asThreadId("thread-jira"),
          linkedJiraTicket: ticket,
        },
        readModel,
      }),
    );

    const event = Array.isArray(result) ? result[0]! : result;
    expect(event.type).toBe("thread.meta-updated");
    expect((event.payload as { linkedJiraTicket: LinkedJiraTicket }).linkedJiraTicket).toEqual(
      ticket,
    );
  });

  it("emits thread.meta-updated with null linkedJiraTicket when unlinking", async () => {
    const readModel = await makeReadModelWithThread();

    const result = await Effect.runPromise(
      decideOrchestrationCommand({
        command: {
          type: "thread.meta.update",
          commandId: CommandId.makeUnsafe("cmd-unlink-jira"),
          threadId: asThreadId("thread-jira"),
          linkedJiraTicket: null,
        },
        readModel,
      }),
    );

    const event = Array.isArray(result) ? result[0]! : result;
    expect(event.type).toBe("thread.meta-updated");
    expect((event.payload as { linkedJiraTicket: null }).linkedJiraTicket).toBeNull();
  });

  it("omits linkedJiraTicket from payload when not provided in command", async () => {
    const readModel = await makeReadModelWithThread();

    const result = await Effect.runPromise(
      decideOrchestrationCommand({
        command: {
          type: "thread.meta.update",
          commandId: CommandId.makeUnsafe("cmd-title-only"),
          threadId: asThreadId("thread-jira"),
          title: "Renamed thread",
        },
        readModel,
      }),
    );

    const event = Array.isArray(result) ? result[0]! : result;
    expect(event.type).toBe("thread.meta-updated");
    expect(event.payload as Record<string, unknown>).not.toHaveProperty("linkedJiraTicket");
  });
});
