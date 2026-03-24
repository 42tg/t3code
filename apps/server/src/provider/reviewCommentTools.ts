/**
 * Review Comment MCP Tools -- Programmatic MCP server providing review_comment,
 * update_review_comment, and list_review_comments tools for Claude Code sessions.
 *
 * This module is intended to be injected into Claude sessions via MCP server
 * configuration. It exposes three tools that allow the agent to create, update,
 * and list review comments during a code review thread.
 *
 * NOTE: MCP tool injection into the Claude adapter is handled separately.
 * This module provides the tool definitions and repository integration.
 */
import {
  createSdkMcpServer,
  tool,
  type McpSdkServerConfigWithInstance,
} from "@anthropic-ai/claude-agent-sdk";
import { Effect } from "effect";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

import type { ThreadId } from "@t3tools/contracts";
import type { ReviewCommentRepositoryShape } from "../persistence/Services/ReviewCommentRepository.ts";

function countFileLines(cwd: string, file: string): number | null {
  try {
    const content = readFileSync(resolve(cwd, file), "utf8");
    return content.split("\n").length;
  } catch {
    return null;
  }
}

export function createReviewCommentMcpServer(
  threadId: ThreadId,
  repository: ReviewCommentRepositoryShape,
  cwd?: string,
): McpSdkServerConfigWithInstance {
  return createSdkMcpServer({
    name: "review-comments",
    version: "1.0.0",
    tools: [
      tool(
        "review_comment",
        "Add a review comment on a specific file and line number in the PR diff. Use this to annotate issues, suggestions, or observations during code review.",
        {
          file: z.string().describe("Relative file path (e.g. src/utils.ts)"),
          startLine: z
            .number()
            .int()
            .positive()
            .describe("Line number in the file where the comment applies"),
          endLine: z
            .number()
            .int()
            .positive()
            .optional()
            .describe("Optional end line for multi-line ranges"),
          body: z.string().describe("Comment body (supports markdown)"),
          severity: z
            .enum(["info", "suggestion", "issue", "blocker"])
            .describe(
              "info = observation, suggestion = improvement idea, issue = should fix, blocker = must fix",
            ),
        },
        async (args) => {
          // Validate line numbers against actual file content
          if (cwd) {
            const totalLines = countFileLines(cwd, args.file);
            if (totalLines === null) {
              return {
                content: [
                  {
                    type: "text" as const,
                    text: `Error: File "${args.file}" not found in the working directory. Verify the file path is correct relative to the project root.`,
                  },
                ],
                isError: true,
              };
            }
            const maxLine = args.endLine ?? args.startLine;
            if (maxLine > totalLines) {
              return {
                content: [
                  {
                    type: "text" as const,
                    text: `Error: Line ${maxLine} exceeds file length (${totalLines} lines) in "${args.file}". Read the file first to verify the correct line numbers.`,
                  },
                ],
                isError: true,
              };
            }
          }

          const comment = await Effect.runPromise(
            repository.add({
              threadId,
              file: args.file,
              startLine: args.startLine,
              ...(args.endLine !== undefined ? { endLine: args.endLine } : {}),
              body: args.body,
              severity: args.severity,
            }),
          );

          return {
            content: [
              {
                type: "text" as const,
                text: `Review comment added (id: ${comment.id}) on ${args.file}:${args.startLine} [${args.severity}]`,
              },
            ],
          };
        },
      ),

      tool(
        "update_review_comment",
        "Update an existing review comment by its ID. Use list_review_comments first to find the ID.",
        {
          id: z.string().describe("The comment ID to update"),
          body: z.string().optional().describe("New comment body"),
          severity: z
            .enum(["info", "suggestion", "issue", "blocker"])
            .optional()
            .describe("New severity level"),
        },
        async (args) => {
          await Effect.runPromise(
            repository.update({
              id: args.id,
              ...(args.body !== undefined ? { body: args.body } : {}),
              ...(args.severity !== undefined ? { severity: args.severity } : {}),
            }),
          );

          return {
            content: [
              {
                type: "text" as const,
                text: `Review comment ${args.id} updated.`,
              },
            ],
          };
        },
      ),

      tool(
        "list_review_comments",
        "List all review comments made so far in this review session. Shows file, line, severity, and body for each comment.",
        {},
        async () => {
          const comments = await Effect.runPromise(repository.listByThreadId({ threadId }));

          if (comments.length === 0) {
            return {
              content: [{ type: "text" as const, text: "No review comments yet." }],
            };
          }

          const lines = comments.map(
            (c) =>
              `- [${c.id}] ${c.file}:${c.startLine}${c.endLine ? `-${c.endLine}` : ""} [${c.severity}]${c.publishedAt ? " (published)" : ""} ${c.body}`,
          );

          return {
            content: [
              {
                type: "text" as const,
                text: `Review comments (${comments.length}):\n${lines.join("\n")}`,
              },
            ],
          };
        },
      ),
    ],
  });
}
