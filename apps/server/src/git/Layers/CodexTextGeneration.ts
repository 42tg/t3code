import { Effect, FileSystem, Layer, Option, Path, Schema, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { query as claudeQuery, type SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";

import { sanitizeBranchFragment, sanitizeFeatureBranchName } from "@t3tools/shared/git";

import { resolveAttachmentPath } from "../../attachmentStore.ts";
import { ServerConfig } from "../../config.ts";
import { TextGenerationError } from "../Errors.ts";
import {
  type BranchNameGenerationInput,
  type BranchNameGenerationResult,
  type CommitMessageGenerationResult,
  type JiraTicketContentGenerationResult,
  type JiraProgressCommentGenerationResult,
  type PrContentGenerationResult,
  type TextGenerationShape,
  TextGeneration,
} from "../Services/TextGeneration.ts";

const CLAUDE_MODEL = "haiku";
const CLAUDE_TIMEOUT_MS = 180_000;

function toJsonSchema(schema: Schema.Top): unknown {
  const document = Schema.toJsonSchemaDocument(schema);
  if (document.definitions && Object.keys(document.definitions).length > 0) {
    return {
      ...document.schema,
      $defs: document.definitions,
    };
  }
  return document.schema;
}

function normalizeClaudeError(
  operation: string,
  error: unknown,
  fallback: string,
): TextGenerationError {
  if (Schema.is(TextGenerationError)(error)) {
    return error;
  }

  if (error instanceof Error) {
    const lower = error.message.toLowerCase();
    if (
      error.message.includes("Command not found: claude") ||
      lower.includes("spawn claude") ||
      lower.includes("enoent")
    ) {
      return new TextGenerationError({
        operation,
        detail: "Claude CLI (`claude`) is required but not available on PATH.",
        cause: error,
      });
    }
    return new TextGenerationError({
      operation,
      detail: `${fallback}: ${error.message}`,
      cause: error,
    });
  }

  return new TextGenerationError({
    operation,
    detail: fallback,
    cause: error,
  });
}

function limitSection(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  const truncated = value.slice(0, maxChars);
  return `${truncated}\n\n[truncated]`;
}

function sanitizeCommitSubject(raw: string): string {
  const singleLine = raw.trim().split(/\r?\n/g)[0]?.trim() ?? "";
  const withoutTrailingPeriod = singleLine.replace(/[.]+$/g, "").trim();
  if (withoutTrailingPeriod.length === 0) {
    return "Update project files";
  }

  if (withoutTrailingPeriod.length <= 72) {
    return withoutTrailingPeriod;
  }
  return withoutTrailingPeriod.slice(0, 72).trimEnd();
}

function sanitizePrTitle(raw: string): string {
  const singleLine = raw.trim().split(/\r?\n/g)[0]?.trim() ?? "";
  if (singleLine.length > 0) {
    return singleLine;
  }
  return "Update project changes";
}

const makeCodexTextGeneration = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const commandSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const serverConfig = yield* Effect.service(ServerConfig);

  type MaterializedImageAttachments = {
    readonly imagePaths: ReadonlyArray<string>;
  };

  const readStreamAsString = <E>(
    operation: string,
    stream: Stream.Stream<Uint8Array, E>,
  ): Effect.Effect<string, TextGenerationError> =>
    Effect.gen(function* () {
      let text = "";
      yield* Stream.runForEach(stream, (chunk) =>
        Effect.sync(() => {
          text += Buffer.from(chunk).toString("utf8");
        }),
      ).pipe(
        Effect.mapError((cause) =>
          normalizeClaudeError(operation, cause, "Failed to collect process output"),
        ),
      );
      return text;
    });

  const safeUnlink = (filePath: string): Effect.Effect<void, never> =>
    fileSystem.remove(filePath).pipe(Effect.catch(() => Effect.void));

  const materializeImageAttachments = (
    _operation: "generateCommitMessage" | "generatePrContent" | "generateBranchName",
    attachments: BranchNameGenerationInput["attachments"],
  ): Effect.Effect<MaterializedImageAttachments, TextGenerationError> =>
    Effect.gen(function* () {
      if (!attachments || attachments.length === 0) {
        return { imagePaths: [] };
      }

      const imagePaths: string[] = [];
      for (const attachment of attachments) {
        if (attachment.type !== "image") {
          continue;
        }

        const resolvedPath = resolveAttachmentPath({
          stateDir: serverConfig.stateDir,
          attachment,
        });
        if (!resolvedPath || !path.isAbsolute(resolvedPath)) {
          continue;
        }
        const fileInfo = yield* fileSystem
          .stat(resolvedPath)
          .pipe(Effect.catch(() => Effect.succeed(null)));
        if (!fileInfo || fileInfo.type !== "File") {
          continue;
        }
        imagePaths.push(resolvedPath);
      }
      return { imagePaths };
    });

  const runClaudeJson = <S extends Schema.Top>({
    operation,
    cwd,
    prompt,
    outputSchemaJson,
    cleanupPaths = [],
  }: {
    operation: "generateCommitMessage" | "generatePrContent" | "generateBranchName";
    cwd: string;
    prompt: string;
    outputSchemaJson: S;
    imagePaths?: ReadonlyArray<string>;
    cleanupPaths?: ReadonlyArray<string>;
  }): Effect.Effect<S["Type"], TextGenerationError, S["DecodingServices"]> =>
    Effect.gen(function* () {
      const jsonSchema = JSON.stringify(toJsonSchema(outputSchemaJson));

      const runClaudeCommand = Effect.gen(function* () {
        const command = ChildProcess.make(
          "claude",
          [
            "--print",
            "--model",
            CLAUDE_MODEL,
            "--output-format",
            "json",
            "--json-schema",
            jsonSchema,
            "--no-session-persistence",
            "--dangerously-skip-permissions",
            prompt,
          ],
          {
            cwd,
            shell: process.platform === "win32",
          },
        );

        const child = yield* commandSpawner
          .spawn(command)
          .pipe(
            Effect.mapError((cause) =>
              normalizeClaudeError(operation, cause, "Failed to spawn Claude CLI process"),
            ),
          );

        const [stdout, stderr, exitCode] = yield* Effect.all(
          [
            readStreamAsString(operation, child.stdout),
            readStreamAsString(operation, child.stderr),
            child.exitCode.pipe(
              Effect.map((value) => Number(value)),
              Effect.mapError((cause) =>
                normalizeClaudeError(operation, cause, "Failed to read Claude CLI exit code"),
              ),
            ),
          ],
          { concurrency: "unbounded" },
        );

        if (exitCode !== 0) {
          const stderrDetail = stderr.trim();
          const stdoutDetail = stdout.trim();
          const detail = stderrDetail.length > 0 ? stderrDetail : stdoutDetail;
          return yield* new TextGenerationError({
            operation,
            detail:
              detail.length > 0
                ? `Claude CLI command failed: ${detail}`
                : `Claude CLI command failed with code ${exitCode}.`,
          });
        }

        return stdout;
      });

      const cleanup = Effect.all(
        cleanupPaths.map((filePath) => safeUnlink(filePath)),
        { concurrency: "unbounded" },
      ).pipe(Effect.asVoid);

      return yield* Effect.gen(function* () {
        const stdout = yield* runClaudeCommand.pipe(
          Effect.scoped,
          Effect.timeoutOption(CLAUDE_TIMEOUT_MS),
          Effect.flatMap(
            Option.match({
              onNone: () =>
                Effect.fail(
                  new TextGenerationError({ operation, detail: "Claude CLI request timed out." }),
                ),
              onSome: (value) => Effect.succeed(value),
            }),
          ),
        );

        return yield* Effect.succeed(stdout).pipe(
          Effect.flatMap(Schema.decodeEffect(Schema.fromJsonString(outputSchemaJson))),
          Effect.catchTag("SchemaError", (cause) =>
            Effect.fail(
              new TextGenerationError({
                operation,
                detail: "Claude returned invalid structured output.",
                cause,
              }),
            ),
          ),
        );
      }).pipe(Effect.ensuring(cleanup));
    });

  const generateCommitMessage: TextGenerationShape["generateCommitMessage"] = (input) => {
    const wantsBranch = input.includeBranch === true;

    const prompt = [
      "You write concise git commit messages.",
      wantsBranch
        ? "Return a JSON object with keys: subject, body, branch."
        : "Return a JSON object with keys: subject, body.",
      "Rules:",
      "- subject must be imperative, <= 72 chars, and no trailing period",
      "- body can be empty string or short bullet points",
      ...(wantsBranch
        ? ["- branch must be a short semantic git branch fragment for this change"]
        : []),
      "- capture the primary user-visible or developer-visible change",
      "",
      `Branch: ${input.branch ?? "(detached)"}`,
      "",
      "Staged files:",
      limitSection(input.stagedSummary, 6_000),
      "",
      "Staged patch:",
      limitSection(input.stagedPatch, 40_000),
    ].join("\n");

    const outputSchemaJson = wantsBranch
      ? Schema.Struct({
          subject: Schema.String,
          body: Schema.String,
          branch: Schema.String,
        })
      : Schema.Struct({
          subject: Schema.String,
          body: Schema.String,
        });

    return runClaudeJson({
      operation: "generateCommitMessage",
      cwd: input.cwd,
      prompt,
      outputSchemaJson,
    }).pipe(
      Effect.map(
        (generated) =>
          ({
            subject: sanitizeCommitSubject(generated.subject),
            body: generated.body.trim(),
            ...("branch" in generated && typeof generated.branch === "string"
              ? { branch: sanitizeFeatureBranchName(generated.branch) }
              : {}),
          }) satisfies CommitMessageGenerationResult,
      ),
    );
  };

  const generatePrContent: TextGenerationShape["generatePrContent"] = (input) => {
    const prompt = [
      "You write GitHub pull request content.",
      "Return a JSON object with keys: title, body.",
      "Rules:",
      "- title should be concise and specific",
      "- body must be markdown and include headings '## Summary' and '## Testing'",
      "- under Summary, provide short bullet points",
      "- under Testing, include bullet points with concrete checks or 'Not run' where appropriate",
      "",
      `Base branch: ${input.baseBranch}`,
      `Head branch: ${input.headBranch}`,
      "",
      "Commits:",
      limitSection(input.commitSummary, 12_000),
      "",
      "Diff stat:",
      limitSection(input.diffSummary, 12_000),
      "",
      "Diff patch:",
      limitSection(input.diffPatch, 40_000),
    ].join("\n");

    return runClaudeJson({
      operation: "generatePrContent",
      cwd: input.cwd,
      prompt,
      outputSchemaJson: Schema.Struct({
        title: Schema.String,
        body: Schema.String,
      }),
    }).pipe(
      Effect.map(
        (generated) =>
          ({
            title: sanitizePrTitle(generated.title),
            body: generated.body.trim(),
          }) satisfies PrContentGenerationResult,
      ),
    );
  };

  const generateBranchName: TextGenerationShape["generateBranchName"] = (input) => {
    return Effect.gen(function* () {
      const { imagePaths } = yield* materializeImageAttachments(
        "generateBranchName",
        input.attachments,
      );
      const attachmentLines = (input.attachments ?? []).map(
        (attachment) =>
          `- ${attachment.name} (${attachment.mimeType}, ${attachment.sizeBytes} bytes)`,
      );

      const promptSections = [
        "You generate concise git branch names.",
        "Return a JSON object with key: branch.",
        "Rules:",
        "- Branch should describe the requested work from the user message.",
        "- Keep it short and specific (2-6 words).",
        "- Use plain words only, no issue prefixes and no punctuation-heavy text.",
        "- If images are attached, use them as primary context for visual/UI issues.",
        "",
        "User message:",
        limitSection(input.message, 8_000),
      ];
      if (attachmentLines.length > 0) {
        promptSections.push(
          "",
          "Attachment metadata:",
          limitSection(attachmentLines.join("\n"), 4_000),
        );
      }
      const prompt = promptSections.join("\n");

      const generated = yield* runClaudeJson({
        operation: "generateBranchName",
        cwd: input.cwd,
        prompt,
        outputSchemaJson: Schema.Struct({
          branch: Schema.String,
        }),
        imagePaths,
      });

      return {
        branch: sanitizeBranchFragment(generated.branch),
      } satisfies BranchNameGenerationResult;
    });
  };

  /**
   * Run a simple prompt via the Claude agent SDK query() and parse JSON output.
   * Uses haiku model with no tools for fast, lightweight text generation.
   */
  const runAgentQuery = <T>(
    operation: string,
    prompt: string,
    jsonSchema: Record<string, unknown>,
    parse: (result: unknown) => T,
    systemPrompt?: string,
  ): Effect.Effect<T, TextGenerationError> =>
    Effect.tryPromise({
      try: async () => {
        const session = claudeQuery({
          prompt,
          options: {
            model: "claude-haiku-4-5-20251001",
            permissionMode: "plan",
            systemPrompt:
              systemPrompt ??
              "You generate structured content for Jira tickets. Your output will be captured as structured JSON automatically — just write the content naturally without JSON formatting. Never ask for clarification or refuse — always produce your best output with the context provided.",
            outputFormat: { type: "json_schema", schema: jsonSchema },
            maxTurns: 5,
            thinking: { type: "disabled" },
          },
        });
        // Consume the async generator to get the result message
        let resultMessage: SDKResultMessage | null = null;
        for await (const message of session) {
          if (message.type === "result") {
            resultMessage = message as SDKResultMessage;
          }
        }
        if (!resultMessage) {
          throw new Error("No result message received from agent query");
        }
        if (resultMessage.subtype !== "success") {
          const errors = resultMessage.errors.join("; ");
          throw new Error(
            `Agent query failed (${resultMessage.subtype}): ${errors || "unknown error"}`,
          );
        }
        if (resultMessage.structured_output != null) {
          return parse(resultMessage.structured_output);
        }
        return parse(JSON.parse(resultMessage.result));
      },
      catch: (error) =>
        new TextGenerationError({
          operation,
          detail: error instanceof Error ? error.message : "Agent query failed",
          cause: error,
        }),
    });

  const generateJiraTicketContent: TextGenerationShape["generateJiraTicketContent"] = (input) => {
    const prompt = [
      `Create a Jira ticket for project ${input.projectKey} based on the conversation below.`,
      "",
      "For the summary field: write a concise imperative title (e.g. 'Add retry logic for failed API calls').",
      "",
      "For the description field, use EXACTLY this format:",
      "",
      "Background:",
      "<brief context>",
      "",
      "Tasks:",
      "- <specific thing to implement or change>",
      "",
      "Acceptance criteria:",
      "- <verifiable condition for done>",
      "",
      "Rules:",
      "- NEVER ask for clarification — this is a one-shot generation with no follow-up",
      "- Always produce output in the format above, using whatever context is available",
      "- Only include bullet points you are confident about — do not invent requirements",
      "- No markdown headers (#), no code fences, no bold/italic",
      "- Be specific — mention files, APIs, or components where relevant",
      "",
      "--- CONVERSATION ---",
      limitSection(input.conversationContext, 16_000),
      "--- END CONVERSATION ---",
    ].join("\n");

    return runAgentQuery(
      "generateJiraTicketContent",
      prompt,
      {
        type: "object",
        properties: {
          summary: { type: "string" },
          description: { type: "string" },
        },
        required: ["summary", "description"],
      },
      (raw) => {
        const obj = raw as { summary: string; description: string };
        return {
          summary: obj.summary.trim(),
          description: obj.description.trim(),
        } satisfies JiraTicketContentGenerationResult;
      },
    );
  };

  const generateJiraProgressComment: TextGenerationShape["generateJiraProgressComment"] = (
    input,
  ) => {
    const hasComments = input.ticketComments.length > 0;
    const prompt = [
      "--- TICKET ---",
      `Key: ${input.ticketKey}`,
      `Type: ${input.ticketType}`,
      `Status: ${input.ticketStatus}`,
      `Summary: ${input.ticketTitle}`,
      `Description: ${limitSection(input.ticketDescription, 3_000)}`,
      "--- END TICKET ---",
      "",
      "--- CONVERSATION ---",
      limitSection(input.recentConversation, 16_000),
      "--- END CONVERSATION ---",
      "",
      ...(hasComments
        ? [
            "--- COMMENTS ALREADY ON THE TICKET (posted earlier — everything below is OLD news) ---",
            limitSection(input.ticketComments, 4_000),
            "--- END OLD COMMENTS ---",
            "",
            `Now write the NEXT progress comment for ${input.ticketKey}. Only mention work from the conversation that is NOT in the old comments above. If a topic appears in the old comments, skip it completely.`,
          ]
        : [`Write a progress update comment for Jira ticket ${input.ticketKey}.`]),
      "",
      "Output format:",
      "",
      "Progress update:",
      "- <what was done>",
      "",
      "Next steps:",
      "- <what remains>",
      "",
      "Rules:",
      "- NEVER ask for clarification — always produce output",
      "- Only include points you are confident about",
      "- Be specific — mention file names, function names, or features",
      "- No markdown headers (#), no code fences, no bold/italic",
      "- Omit Next steps if nothing is clearly outstanding",
      '- If there is genuinely nothing new to report, just output: "No new progress since last update." — nothing else',
    ].join("\n");

    const systemPrompt = hasComments
      ? "You write Jira progress comments. You are writing a CONTINUATION of an existing comment thread. Your job is to add only NEW information. If something was already said in a previous comment, you must skip it entirely. If nothing new happened, say so in one short sentence — do not explain why. Never ask for clarification. Output is captured as JSON automatically."
      : undefined;

    return runAgentQuery(
      "generateJiraProgressComment",
      prompt,
      {
        type: "object",
        properties: { comment: { type: "string" } },
        required: ["comment"],
      },
      (raw) => {
        const obj = raw as { comment: string };
        return { comment: obj.comment.trim() } satisfies JiraProgressCommentGenerationResult;
      },
      systemPrompt,
    );
  };

  return {
    generateCommitMessage,
    generatePrContent,
    generateBranchName,
    generateJiraTicketContent,
    generateJiraProgressComment,
  } satisfies TextGenerationShape;
});

export const CodexTextGenerationLive = Layer.effect(TextGeneration, makeCodexTextGeneration);
