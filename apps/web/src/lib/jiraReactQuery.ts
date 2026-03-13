import type {
  JiraIssueViewResult,
  JiraIssueCreateInput,
  JiraIssueMoveInput,
  JiraCommentAddInput,
  JiraGenerateTicketContentInput,
  JiraGenerateProgressCommentInput,
} from "@t3tools/contracts";
import { mutationOptions, queryOptions, type QueryClient } from "@tanstack/react-query";
import { ensureNativeApi } from "../nativeApi";

export const jiraQueryKeys = {
  all: ["jira"] as const,
  configured: ["jira", "configured"] as const,
  issue: (key: string | null) => ["jira", "issue", key] as const,
  issues: (projectKey: string | null) => ["jira", "issues", projectKey] as const,
  myOpenIssues: ["jira", "myOpenIssues"] as const,
};

export function jiraIsConfiguredQueryOptions() {
  return queryOptions({
    queryKey: jiraQueryKeys.configured,
    queryFn: async () => {
      const api = ensureNativeApi();
      return api.jira.isConfigured();
    },
    staleTime: Infinity,
    retry: 3,
    retryDelay: 1000,
    refetchOnWindowFocus: false,
  });
}

export const jiraMutationKeys = {
  createIssue: ["jira", "mutation", "createIssue"] as const,
  moveIssue: ["jira", "mutation", "moveIssue"] as const,
  addComment: ["jira", "mutation", "addComment"] as const,
  generateTicketContent: ["jira", "mutation", "generateTicketContent"] as const,
  generateProgressComment: ["jira", "mutation", "generateProgressComment"] as const,
};

export function invalidateJiraQueries(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ queryKey: jiraQueryKeys.all });
}

export function jiraViewIssueQueryOptions(key: string | null) {
  return queryOptions({
    queryKey: jiraQueryKeys.issue(key),
    queryFn: async (): Promise<JiraIssueViewResult> => {
      const api = ensureNativeApi();
      if (!key) throw new Error("Jira issue key is required.");
      return api.jira.viewIssue({ key });
    },
    enabled: key !== null && key.length > 0,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
}

export function jiraListIssuesQueryOptions(projectKey: string | null) {
  return queryOptions({
    queryKey: jiraQueryKeys.issues(projectKey),
    queryFn: async () => {
      const api = ensureNativeApi();
      if (!projectKey) throw new Error("Jira project key is required.");
      return api.jira.listIssues({ projectKey });
    },
    enabled: projectKey !== null && projectKey.length > 0,
    staleTime: 30_000,
  });
}

export function jiraListTransitionsQueryOptions(key: string | null) {
  return queryOptions({
    queryKey: [...jiraQueryKeys.all, "transitions", key] as const,
    queryFn: async () => {
      const api = ensureNativeApi();
      if (!key) throw new Error("Jira issue key is required.");
      return api.jira.listTransitions({ key });
    },
    enabled: key !== null && key.length > 0,
    staleTime: 60_000,
  });
}

export function jiraMyOpenIssuesQueryOptions() {
  return queryOptions({
    queryKey: jiraQueryKeys.myOpenIssues,
    queryFn: async () => {
      const api = ensureNativeApi();
      return api.jira.listIssues({
        jql: "assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC",
      });
    },
    staleTime: 30_000,
  });
}

export function jiraCreateIssueMutationOptions(input: { queryClient: QueryClient }) {
  return mutationOptions({
    mutationKey: jiraMutationKeys.createIssue,
    mutationFn: async (params: Omit<JiraIssueCreateInput, never>) => {
      const api = ensureNativeApi();
      return api.jira.createIssue(params);
    },
    onSettled: async () => {
      await invalidateJiraQueries(input.queryClient);
    },
  });
}

export function jiraMoveIssueMutationOptions(input: { queryClient: QueryClient }) {
  return mutationOptions({
    mutationKey: jiraMutationKeys.moveIssue,
    mutationFn: async (params: Omit<JiraIssueMoveInput, never>) => {
      const api = ensureNativeApi();
      return api.jira.moveIssue(params);
    },
    onSettled: async () => {
      await invalidateJiraQueries(input.queryClient);
    },
  });
}

export function jiraAddCommentMutationOptions(input: { queryClient: QueryClient }) {
  return mutationOptions({
    mutationKey: jiraMutationKeys.addComment,
    mutationFn: async (params: Omit<JiraCommentAddInput, never>) => {
      const api = ensureNativeApi();
      return api.jira.addComment(params);
    },
    onSettled: async () => {
      await invalidateJiraQueries(input.queryClient);
    },
  });
}

export function jiraGenerateTicketContentMutationOptions() {
  return mutationOptions({
    mutationKey: jiraMutationKeys.generateTicketContent,
    mutationFn: async (params: JiraGenerateTicketContentInput) => {
      const api = ensureNativeApi();
      return api.jira.generateTicketContent(params);
    },
  });
}

export function jiraGenerateProgressCommentMutationOptions() {
  return mutationOptions({
    mutationKey: jiraMutationKeys.generateProgressComment,
    mutationFn: async (params: JiraGenerateProgressCommentInput) => {
      const api = ensureNativeApi();
      return api.jira.generateProgressComment(params);
    },
  });
}
