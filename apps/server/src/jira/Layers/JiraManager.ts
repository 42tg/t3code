import { Effect, Layer } from "effect";

import { JiraCli } from "../Services/JiraCli.ts";
import { JiraManager, type JiraManagerShape } from "../Services/JiraManager.ts";
import { TextGeneration } from "../../git/Services/TextGeneration.ts";

function limitContext(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}\n\n[truncated]`;
}

function formatComments(
  comments: ReadonlyArray<{ author: string; body: string; created: string }>,
): string {
  if (comments.length === 0) return "";
  return comments.map((c) => `[${c.created}] ${c.author}: ${c.body}`).join("\n\n");
}

export const makeJiraManager = Effect.gen(function* () {
  const jiraCli = yield* JiraCli;
  const textGeneration = yield* TextGeneration;

  const viewIssue: JiraManagerShape["viewIssue"] = (input) => jiraCli.viewIssue(input);

  const createIssue: JiraManagerShape["createIssue"] = (input) => jiraCli.createIssue(input);

  const moveIssue: JiraManagerShape["moveIssue"] = (input) => jiraCli.moveIssue(input);

  const addComment: JiraManagerShape["addComment"] = (input) => jiraCli.addComment(input);

  const listIssues: JiraManagerShape["listIssues"] = (input) => jiraCli.listIssues(input);

  const listTransitions: JiraManagerShape["listTransitions"] = (input) =>
    jiraCli.listTransitions(input);

  const generateTicketContent: JiraManagerShape["generateTicketContent"] = (input) =>
    textGeneration.generateJiraTicketContent({
      conversationContext: limitContext(input.conversationContext, 20_000),
      projectKey: input.projectKey,
    });

  const generateProgressComment: JiraManagerShape["generateProgressComment"] = (input) =>
    Effect.gen(function* () {
      const issue = yield* jiraCli.viewIssue({ key: input.ticketKey });
      return yield* textGeneration.generateJiraProgressComment({
        ticketKey: input.ticketKey,
        ticketTitle: issue.summary,
        ticketDescription: issue.description,
        ticketStatus: issue.status,
        ticketType: issue.type,
        ticketComments: formatComments(issue.comments),
        recentConversation: limitContext(input.recentConversation, 20_000),
      });
    });

  return {
    viewIssue,
    createIssue,
    moveIssue,
    addComment,
    listIssues,
    listTransitions,
    generateTicketContent,
    generateProgressComment,
  } satisfies JiraManagerShape;
});

export const JiraManagerLive = Layer.effect(JiraManager, makeJiraManager);
