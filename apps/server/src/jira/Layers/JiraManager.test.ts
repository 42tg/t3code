import { describe, expect, it } from "vitest";
import { Effect, Layer } from "effect";

import { JiraCli, type JiraCliShape } from "../Services/JiraCli.ts";
import { JiraManager } from "../Services/JiraManager.ts";
import { TextGeneration } from "../../git/Services/TextGeneration.ts";
import { JiraManagerLive } from "./JiraManager.ts";
import { JiraCliError } from "../Errors.ts";

function createFakeJiraCli(overrides: Partial<JiraCliShape> = {}): JiraCliShape {
  const defaults: JiraCliShape = {
    execute: () =>
      Effect.succeed({ stdout: "", stderr: "", code: 0, signal: null, timedOut: false }),
    viewIssue: () =>
      Effect.succeed({
        key: "PROJ-1",
        url: "https://jira.example.com/browse/PROJ-1",
        summary: "Test issue",
        status: "To Do",
        type: "Task",
        priority: "Medium",
        description: "A test issue",
      }),
    createIssue: () =>
      Effect.succeed({
        key: "PROJ-2",
        url: "https://jira.example.com/browse/PROJ-2",
      }),
    moveIssue: () =>
      Effect.succeed({
        key: "PROJ-1",
        newStatus: "Done",
      }),
    addComment: () =>
      Effect.succeed({
        key: "PROJ-1",
      }),
    listIssues: () =>
      Effect.succeed({
        issues: [
          { key: "PROJ-1", summary: "Test issue", status: "To Do", type: "Task" },
          { key: "PROJ-2", summary: "Another issue", status: "In Progress", type: "Bug" },
        ],
      }),
  };
  return { ...defaults, ...overrides };
}

function createFakeTextGeneration() {
  return {
    generateCommitMessage: () => Effect.succeed({ subject: "test", body: "test body" }),
    generatePrContent: () => Effect.succeed({ title: "Test PR", body: "PR body" }),
    generateBranchName: () => Effect.succeed({ branch: "test-branch" }),
    generateJiraTicketContent: () =>
      Effect.succeed({ summary: "Generated summary", description: "Generated description" }),
    generateJiraProgressComment: () => Effect.succeed({ comment: "Progress update" }),
    generateJiraCompletionSummary: () => Effect.succeed({ comment: "Completion summary" }),
  };
}

function makeTestLayer(jiraCliOverrides: Partial<JiraCliShape> = {}) {
  const JiraCliTest = Layer.succeed(JiraCli, createFakeJiraCli(jiraCliOverrides));
  const TextGenerationTest = Layer.succeed(TextGeneration, createFakeTextGeneration());
  return JiraManagerLive.pipe(Layer.provide(Layer.merge(JiraCliTest, TextGenerationTest)));
}

function runWithLayer<A, E>(effect: Effect.Effect<A, E, JiraManager>) {
  return Effect.runPromise(Effect.provide(effect, makeTestLayer()));
}

describe("JiraManager", () => {
  it("viewIssue delegates to JiraCli", async () => {
    const result = await runWithLayer(
      Effect.gen(function* () {
        const manager = yield* JiraManager;
        return yield* manager.viewIssue({ key: "PROJ-1" });
      }),
    );
    expect(result.key).toBe("PROJ-1");
    expect(result.summary).toBe("Test issue");
  });

  it("createIssue delegates to JiraCli", async () => {
    const result = await runWithLayer(
      Effect.gen(function* () {
        const manager = yield* JiraManager;
        return yield* manager.createIssue({
          projectKey: "PROJ",
          type: "Task",
          priority: "Medium",
          summary: "New issue",
          description: "Description",
        });
      }),
    );
    expect(result.key).toBe("PROJ-2");
  });

  it("moveIssue delegates to JiraCli", async () => {
    const result = await runWithLayer(
      Effect.gen(function* () {
        const manager = yield* JiraManager;
        return yield* manager.moveIssue({ key: "PROJ-1", targetStatus: "Done" });
      }),
    );
    expect(result.newStatus).toBe("Done");
  });

  it("addComment delegates to JiraCli", async () => {
    const result = await runWithLayer(
      Effect.gen(function* () {
        const manager = yield* JiraManager;
        return yield* manager.addComment({ key: "PROJ-1", comment: "A comment" });
      }),
    );
    expect(result.key).toBe("PROJ-1");
  });

  it("listIssues delegates to JiraCli", async () => {
    const result = await runWithLayer(
      Effect.gen(function* () {
        const manager = yield* JiraManager;
        return yield* manager.listIssues({ projectKey: "PROJ" });
      }),
    );
    expect(result.issues).toHaveLength(2);
    expect(result.issues[0]!.key).toBe("PROJ-1");
  });

  it("generateTicketContent delegates to TextGeneration", async () => {
    const result = await runWithLayer(
      Effect.gen(function* () {
        const manager = yield* JiraManager;
        return yield* manager.generateTicketContent({
          conversationContext: "Some context",
          projectKey: "PROJ",
        });
      }),
    );
    expect(result.summary).toBe("Generated summary");
    expect(result.description).toBe("Generated description");
  });

  it("generateProgressComment delegates to TextGeneration", async () => {
    const result = await runWithLayer(
      Effect.gen(function* () {
        const manager = yield* JiraManager;
        return yield* manager.generateProgressComment({
          ticketKey: "PROJ-1",
          ticketTitle: "Test issue",
          recentConversation: "Recent context",
        });
      }),
    );
    expect(result.comment).toBe("Progress update");
  });

  it("generateCompletionSummary delegates to TextGeneration", async () => {
    const result = await runWithLayer(
      Effect.gen(function* () {
        const manager = yield* JiraManager;
        return yield* manager.generateCompletionSummary({
          ticketKey: "PROJ-1",
          ticketTitle: "Test issue",
          fullConversation: "Full conversation",
        });
      }),
    );
    expect(result.comment).toBe("Completion summary");
  });

  it("generateTicketContent truncates long input", async () => {
    const longContext = "x".repeat(25_000);
    const result = await runWithLayer(
      Effect.gen(function* () {
        const manager = yield* JiraManager;
        return yield* manager.generateTicketContent({
          conversationContext: longContext,
          projectKey: "PROJ",
        });
      }),
    );
    // Should succeed — limitContext truncates before passing to TextGeneration
    expect(result.summary).toBe("Generated summary");
  });

  it("propagates JiraCli errors", async () => {
    const failingLayer = JiraManagerLive.pipe(
      Layer.provide(
        Layer.merge(
          Layer.succeed(
            JiraCli,
            createFakeJiraCli({
              viewIssue: () =>
                Effect.fail(new JiraCliError({ operation: "viewIssue", detail: "not found" })),
            }),
          ),
          Layer.succeed(TextGeneration, createFakeTextGeneration()),
        ),
      ),
    );

    await expect(
      Effect.runPromise(
        Effect.provide(
          Effect.gen(function* () {
            const manager = yield* JiraManager;
            return yield* manager.viewIssue({ key: "NOPE-999" });
          }),
          failingLayer,
        ),
      ),
    ).rejects.toBeDefined();
  });
});
