import { Schema } from "effect";
import { ThreadId, TrimmedNonEmptyString } from "./baseSchemas";

// Domain Types

const LinkedJiraTicketStatus = Schema.Literals(["active", "completed"]);

export const LinkedJiraTicket = Schema.Struct({
  key: TrimmedNonEmptyString,
  url: Schema.String,
  title: TrimmedNonEmptyString,
  status: LinkedJiraTicketStatus,
  linkedAt: Schema.String,
  completedAt: Schema.optional(Schema.NullOr(Schema.String)),
});
export type LinkedJiraTicket = typeof LinkedJiraTicket.Type;

// RPC Inputs

export const JiraIssueViewInput = Schema.Struct({
  key: TrimmedNonEmptyString,
});
export type JiraIssueViewInput = typeof JiraIssueViewInput.Type;

export const JiraIssueCreateInput = Schema.Struct({
  projectKey: TrimmedNonEmptyString,
  type: TrimmedNonEmptyString,
  priority: TrimmedNonEmptyString,
  summary: TrimmedNonEmptyString,
  description: Schema.String,
});
export type JiraIssueCreateInput = typeof JiraIssueCreateInput.Type;

export const JiraIssueMoveInput = Schema.Struct({
  key: TrimmedNonEmptyString,
  targetStatus: TrimmedNonEmptyString,
});
export type JiraIssueMoveInput = typeof JiraIssueMoveInput.Type;

export const JiraCommentAddInput = Schema.Struct({
  key: TrimmedNonEmptyString,
  comment: TrimmedNonEmptyString,
});
export type JiraCommentAddInput = typeof JiraCommentAddInput.Type;

export const JiraIssueListInput = Schema.Struct({
  projectKey: Schema.optional(TrimmedNonEmptyString),
  jql: Schema.optional(Schema.String),
});
export type JiraIssueListInput = typeof JiraIssueListInput.Type;

// RPC Results

const JiraCommentEntry = Schema.Struct({
  author: Schema.String,
  body: Schema.String,
  created: Schema.String,
});

export const JiraIssueViewResult = Schema.Struct({
  key: TrimmedNonEmptyString,
  url: Schema.String,
  summary: TrimmedNonEmptyString,
  status: TrimmedNonEmptyString,
  type: TrimmedNonEmptyString,
  priority: TrimmedNonEmptyString,
  description: Schema.String,
  comments: Schema.Array(JiraCommentEntry),
});
export type JiraIssueViewResult = typeof JiraIssueViewResult.Type;

export const JiraIssueCreateResult = Schema.Struct({
  key: TrimmedNonEmptyString,
  url: Schema.String,
});
export type JiraIssueCreateResult = typeof JiraIssueCreateResult.Type;

export const JiraIssueMoveResult = Schema.Struct({
  key: TrimmedNonEmptyString,
  newStatus: TrimmedNonEmptyString,
});
export type JiraIssueMoveResult = typeof JiraIssueMoveResult.Type;

export const JiraCommentAddResult = Schema.Struct({
  key: TrimmedNonEmptyString,
});
export type JiraCommentAddResult = typeof JiraCommentAddResult.Type;

const JiraIssueListEntry = Schema.Struct({
  key: TrimmedNonEmptyString,
  summary: TrimmedNonEmptyString,
  status: TrimmedNonEmptyString,
  type: TrimmedNonEmptyString,
});

export const JiraIssueListResult = Schema.Struct({
  issues: Schema.Array(JiraIssueListEntry),
});
export type JiraIssueListResult = typeof JiraIssueListResult.Type;

// Transitions

export const JiraListTransitionsInput = Schema.Struct({
  key: TrimmedNonEmptyString,
});
export type JiraListTransitionsInput = typeof JiraListTransitionsInput.Type;

const JiraTransitionEntry = Schema.Struct({
  id: Schema.String,
  name: TrimmedNonEmptyString,
});

export const JiraListTransitionsResult = Schema.Struct({
  transitions: Schema.Array(JiraTransitionEntry),
});
export type JiraListTransitionsResult = typeof JiraListTransitionsResult.Type;

// Text Generation types

export const JiraGenerateTicketContentInput = Schema.Struct({
  threadId: ThreadId,
  projectKey: TrimmedNonEmptyString,
});
export type JiraGenerateTicketContentInput = typeof JiraGenerateTicketContentInput.Type;

export const JiraGenerateTicketContentResult = Schema.Struct({
  summary: TrimmedNonEmptyString,
  description: Schema.String,
});
export type JiraGenerateTicketContentResult = typeof JiraGenerateTicketContentResult.Type;

export const JiraGenerateProgressCommentInput = Schema.Struct({
  threadId: ThreadId,
  ticketKey: TrimmedNonEmptyString,
  ticketTitle: TrimmedNonEmptyString,
});
export type JiraGenerateProgressCommentInput = typeof JiraGenerateProgressCommentInput.Type;

export const JiraGenerateProgressCommentResult = Schema.Struct({
  comment: Schema.String,
});
export type JiraGenerateProgressCommentResult = typeof JiraGenerateProgressCommentResult.Type;
