import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import {
  jiraMutationKeys,
  jiraQueryKeys,
  jiraCreateIssueMutationOptions,
  jiraMoveIssueMutationOptions,
  jiraAddCommentMutationOptions,
  jiraGenerateTicketContentMutationOptions,
  jiraGenerateProgressCommentMutationOptions,
  jiraViewIssueQueryOptions,
  jiraListIssuesQueryOptions,
} from "./jiraReactQuery";

describe("jiraQueryKeys", () => {
  it("scopes issue keys by ticket key", () => {
    expect(jiraQueryKeys.issue("PROJ-1")).not.toEqual(jiraQueryKeys.issue("PROJ-2"));
  });

  it("scopes issues keys by project key", () => {
    expect(jiraQueryKeys.issues("PROJ")).not.toEqual(jiraQueryKeys.issues("OTHER"));
  });

  it("all keys share a common prefix", () => {
    expect(jiraQueryKeys.issue("PROJ-1")[0]).toBe("jira");
    expect(jiraQueryKeys.issues("PROJ")[0]).toBe("jira");
    expect(jiraQueryKeys.all[0]).toBe("jira");
  });
});

describe("jiraMutationKeys", () => {
  it("has distinct keys for each mutation", () => {
    const keys = Object.values(jiraMutationKeys);
    const serialized = keys.map((k) => JSON.stringify(k));
    expect(new Set(serialized).size).toBe(keys.length);
  });
});

describe("jira query options", () => {
  it("viewIssue is disabled when key is null", () => {
    const options = jiraViewIssueQueryOptions(null);
    expect(options.enabled).toBe(false);
  });

  it("viewIssue is disabled when key is empty string", () => {
    const options = jiraViewIssueQueryOptions("");
    expect(options.enabled).toBe(false);
  });

  it("viewIssue is enabled when key is provided", () => {
    const options = jiraViewIssueQueryOptions("PROJ-1");
    expect(options.enabled).toBe(true);
  });

  it("listIssues is disabled when projectKey is null", () => {
    const options = jiraListIssuesQueryOptions(null);
    expect(options.enabled).toBe(false);
  });

  it("listIssues is enabled when projectKey is provided", () => {
    const options = jiraListIssuesQueryOptions("PROJ");
    expect(options.enabled).toBe(true);
  });
});

describe("jira mutation options", () => {
  const queryClient = new QueryClient();

  it("attaches mutation key for createIssue", () => {
    const options = jiraCreateIssueMutationOptions({ queryClient });
    expect(options.mutationKey).toEqual(jiraMutationKeys.createIssue);
  });

  it("attaches mutation key for moveIssue", () => {
    const options = jiraMoveIssueMutationOptions({ queryClient });
    expect(options.mutationKey).toEqual(jiraMutationKeys.moveIssue);
  });

  it("attaches mutation key for addComment", () => {
    const options = jiraAddCommentMutationOptions({ queryClient });
    expect(options.mutationKey).toEqual(jiraMutationKeys.addComment);
  });

  it("attaches mutation key for generateTicketContent", () => {
    const options = jiraGenerateTicketContentMutationOptions();
    expect(options.mutationKey).toEqual(jiraMutationKeys.generateTicketContent);
  });

  it("attaches mutation key for generateProgressComment", () => {
    const options = jiraGenerateProgressCommentMutationOptions();
    expect(options.mutationKey).toEqual(jiraMutationKeys.generateProgressComment);
  });
});
