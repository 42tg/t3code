/**
 * JiraCli - Effect service contract for Jira REST API interactions.
 *
 * Provides thin command execution helpers used by Jira workflow orchestration.
 * Backed by direct HTTP calls to the Jira v3 REST API.
 *
 * @module JiraCli
 */
import { ServiceMap } from "effect";
import type { Effect } from "effect";

import type {
  JiraIssueViewInput,
  JiraIssueViewResult,
  JiraIssueCreateInput,
  JiraIssueCreateResult,
  JiraIssueMoveInput,
  JiraIssueMoveResult,
  JiraCommentAddInput,
  JiraCommentAddResult,
  JiraIssueListInput,
  JiraIssueListResult,
  JiraListTransitionsInput,
  JiraListTransitionsResult,
} from "@t3tools/contracts";
import type { JiraCliError } from "../Errors.ts";

/**
 * JiraCliShape - Service API for Jira REST API operations.
 */
export interface JiraCliShape {
  readonly execute: (input: {
    readonly args: ReadonlyArray<string>;
    readonly timeoutMs?: number;
  }) => Effect.Effect<never, JiraCliError>;

  readonly viewIssue: (
    input: JiraIssueViewInput,
  ) => Effect.Effect<JiraIssueViewResult, JiraCliError>;

  readonly createIssue: (
    input: JiraIssueCreateInput,
  ) => Effect.Effect<JiraIssueCreateResult, JiraCliError>;

  readonly moveIssue: (
    input: JiraIssueMoveInput,
  ) => Effect.Effect<JiraIssueMoveResult, JiraCliError>;

  readonly addComment: (
    input: JiraCommentAddInput,
  ) => Effect.Effect<JiraCommentAddResult, JiraCliError>;

  readonly listIssues: (
    input: JiraIssueListInput,
  ) => Effect.Effect<JiraIssueListResult, JiraCliError>;

  readonly listTransitions: (
    input: JiraListTransitionsInput,
  ) => Effect.Effect<JiraListTransitionsResult, JiraCliError>;
}

/**
 * JiraCli - Service tag for Jira REST API execution.
 */
export class JiraCli extends ServiceMap.Service<JiraCli, JiraCliShape>()(
  "t3/jira/Services/JiraCli",
) {}
