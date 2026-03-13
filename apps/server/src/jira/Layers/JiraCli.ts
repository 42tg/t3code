import { Effect, Layer } from "effect";

import { JiraCliError } from "../Errors.ts";
import { JiraCli, type JiraCliShape } from "../Services/JiraCli.ts";

const DEFAULT_TIMEOUT_MS = 30_000;

interface JiraRestConfig {
  readonly baseUrl: string;
  readonly email: string;
  readonly apiToken: string;
}

function readConfig(): JiraRestConfig | null {
  const baseUrl = process.env.JIRA_BASE_URL?.replace(/\/+$/, "");
  const email = process.env.JIRA_USER_EMAIL;
  const apiToken = process.env.JIRA_API_TOKEN;
  if (!baseUrl || !email || !apiToken) return null;
  return { baseUrl, email, apiToken };
}

async function jiraFetch(
  config: JiraRestConfig,
  path: string,
  options: { method?: string; body?: unknown; timeoutMs?: number } = {},
): Promise<unknown> {
  const url = `${config.baseUrl}/rest/api/3${path}`;
  const auth = Buffer.from(`${config.email}:${config.apiToken}`).toString("base64");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: options.method ?? "GET",
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: "application/json",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Jira API ${response.status}: ${text}`);
    }

    const text = await response.text();
    return text.length > 0 ? JSON.parse(text) : {};
  } finally {
    clearTimeout(timeout);
  }
}

function notConfiguredError(operation: string): JiraCliError {
  return new JiraCliError({
    operation,
    detail:
      "Jira integration is not configured. Set JIRA_BASE_URL, JIRA_USER_EMAIL, and JIRA_API_TOKEN environment variables.",
  });
}

/** Extract plain text from Atlassian Document Format (ADF). */
function adfToPlainText(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const n = node as Record<string, unknown>;
  if (n.type === "text" && typeof n.text === "string") return n.text;
  if (Array.isArray(n.content)) {
    return (n.content as unknown[]).map(adfToPlainText).join("");
  }
  return "";
}

/** Lazily fetch and cache the current user's Jira accountId. */
function createAccountIdResolver(config: JiraRestConfig) {
  let cached: string | null = null;
  return async (): Promise<string | null> => {
    if (cached) return cached;
    try {
      const data = (await jiraFetch(config, "/myself")) as Record<string, any>;
      cached = typeof data.accountId === "string" ? data.accountId : null;
    } catch {
      cached = null;
    }
    return cached;
  };
}

const makeJiraCli = Effect.sync(() => {
  const config = readConfig();
  const getAccountId = config ? createAccountIdResolver(config) : null;

  const execute: JiraCliShape["execute"] = () =>
    Effect.fail(
      new JiraCliError({
        operation: "execute",
        detail: "Raw CLI execution is not supported with the REST API backend.",
      }),
    );

  const service = {
    execute,

    viewIssue: (input) => {
      if (!config) return Effect.fail(notConfiguredError("viewIssue"));
      return Effect.tryPromise({
        try: async () => {
          const data = (await jiraFetch(
            config,
            `/issue/${encodeURIComponent(input.key)}`,
          )) as Record<string, any>;
          const fields = (data.fields ?? {}) as Record<string, any>;
          const rawComments = (fields.comment?.comments ?? []) as Array<Record<string, any>>;
          const comments = rawComments.map((c) => ({
            author: String(c.author?.displayName ?? c.author?.emailAddress ?? "Unknown"),
            body: typeof c.body === "string" ? c.body : adfToPlainText(c.body),
            created: String(c.created ?? ""),
          }));
          return {
            key: String(data.key ?? input.key),
            url: `${config.baseUrl}/browse/${data.key ?? input.key}`,
            summary: String(fields.summary ?? ""),
            status: String(fields.status?.name ?? "Unknown"),
            type: String(fields.issuetype?.name ?? "Task"),
            priority: String(fields.priority?.name ?? "Medium"),
            description:
              typeof fields.description === "string"
                ? fields.description
                : adfToPlainText(fields.description),
            comments,
          };
        },
        catch: (error) =>
          new JiraCliError({
            operation: "viewIssue",
            detail: error instanceof Error ? error.message : "Failed to view Jira issue.",
            ...(error !== undefined ? { cause: error } : {}),
          }),
      });
    },

    createIssue: (input) => {
      if (!config) return Effect.fail(notConfiguredError("createIssue"));
      return Effect.tryPromise({
        try: async () => {
          const accountId = await getAccountId!();
          const body = {
            fields: {
              project: { key: input.projectKey },
              issuetype: { name: input.type },
              priority: { name: input.priority },
              summary: input.summary,
              ...(accountId ? { assignee: { accountId } } : {}),
              description: {
                type: "doc",
                version: 1,
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: input.description || "Created via T3 Code" }],
                  },
                ],
              },
            },
          };
          const data = (await jiraFetch(config, "/issue", {
            method: "POST",
            body,
          })) as Record<string, any>;
          const key = String(data.key ?? "");
          return {
            key,
            url: `${config.baseUrl}/browse/${key}`,
          };
        },
        catch: (error) =>
          new JiraCliError({
            operation: "createIssue",
            detail: error instanceof Error ? error.message : "Failed to create Jira issue.",
            ...(error !== undefined ? { cause: error } : {}),
          }),
      });
    },

    moveIssue: (input) => {
      if (!config) return Effect.fail(notConfiguredError("moveIssue"));
      return Effect.tryPromise({
        try: async () => {
          // First, get available transitions
          const transitionsData = (await jiraFetch(
            config,
            `/issue/${encodeURIComponent(input.key)}/transitions`,
          )) as Record<string, any>;
          const transitions = (transitionsData.transitions ?? []) as Array<Record<string, any>>;
          const target = transitions.find(
            (t) => t.name?.toLowerCase() === input.targetStatus.toLowerCase(),
          );
          if (!target) {
            const available = transitions.map((t) => t.name).join(", ");
            throw new Error(
              `Transition "${input.targetStatus}" not found. Available: ${available}`,
            );
          }
          await jiraFetch(config, `/issue/${encodeURIComponent(input.key)}/transitions`, {
            method: "POST",
            body: { transition: { id: target.id } },
          });
          return { key: input.key, newStatus: input.targetStatus };
        },
        catch: (error) =>
          new JiraCliError({
            operation: "moveIssue",
            detail: error instanceof Error ? error.message : "Failed to move Jira issue.",
            ...(error !== undefined ? { cause: error } : {}),
          }),
      });
    },

    addComment: (input) => {
      if (!config) return Effect.fail(notConfiguredError("addComment"));
      return Effect.tryPromise({
        try: async () => {
          await jiraFetch(config, `/issue/${encodeURIComponent(input.key)}/comment`, {
            method: "POST",
            body: {
              body: {
                type: "doc",
                version: 1,
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: input.comment }],
                  },
                ],
              },
            },
          });
          return { key: input.key };
        },
        catch: (error) =>
          new JiraCliError({
            operation: "addComment",
            detail: error instanceof Error ? error.message : "Failed to add Jira comment.",
            ...(error !== undefined ? { cause: error } : {}),
          }),
      });
    },

    listIssues: (input) => {
      if (!config) return Effect.fail(notConfiguredError("listIssues"));
      return Effect.tryPromise({
        try: async () => {
          const jql =
            input.jql ??
            (input.projectKey
              ? `project = ${input.projectKey} ORDER BY updated DESC`
              : "ORDER BY updated DESC");
          const data = (await jiraFetch(
            config,
            `/search/jql?jql=${encodeURIComponent(jql)}&maxResults=50&fields=summary,status,issuetype`,
          )) as Record<string, any>;
          const issues = (data.issues ?? []) as Array<Record<string, any>>;
          return {
            issues: issues.map((item) => {
              const fields = (item.fields ?? {}) as Record<string, any>;
              return {
                key: String(item.key ?? ""),
                summary: String(fields.summary ?? ""),
                status: String(fields.status?.name ?? "Unknown"),
                type: String(fields.issuetype?.name ?? "Task"),
              };
            }),
          };
        },
        catch: (error) =>
          new JiraCliError({
            operation: "listIssues",
            detail: error instanceof Error ? error.message : "Failed to list Jira issues.",
            ...(error !== undefined ? { cause: error } : {}),
          }),
      });
    },
    listTransitions: (input) => {
      if (!config) return Effect.fail(notConfiguredError("listTransitions"));
      return Effect.tryPromise({
        try: async () => {
          const data = (await jiraFetch(
            config,
            `/issue/${encodeURIComponent(input.key)}/transitions`,
          )) as Record<string, any>;
          const transitions = (data.transitions ?? []) as Array<Record<string, any>>;
          return {
            transitions: transitions.map((t) => ({
              id: String(t.id ?? ""),
              name: String(t.name ?? ""),
            })),
          };
        },
        catch: (error) =>
          new JiraCliError({
            operation: "listTransitions",
            detail: error instanceof Error ? error.message : "Failed to list transitions.",
            ...(error !== undefined ? { cause: error } : {}),
          }),
      });
    },
  } satisfies JiraCliShape;

  return service;
});

export const JiraCliLive = Layer.effect(JiraCli, makeJiraCli);
