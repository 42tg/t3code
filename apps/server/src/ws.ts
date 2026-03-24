import { Cause, Effect, Exit, Layer, Option, Queue, Ref, Schema, Stream } from "effect";
import { FileSystem, Path } from "effect";
import {
  type GitActionProgressEvent,
  GitCommandError,
  type GitManagerServiceError,
  OrchestrationDispatchCommandError,
  type OrchestrationEvent,
  OrchestrationGetFullThreadDiffError,
  OrchestrationGetSnapshotError,
  OrchestrationGetTurnDiffError,
  ORCHESTRATION_WS_METHODS,
  ProjectSearchEntriesError,
  ProjectWriteFileError,
  OrchestrationReplayEventsError,
  ReviewCommentError,
  ReviewRequestError,
  type TerminalEvent,
  WS_METHODS,
  WsRpcGroup,
} from "@t3tools/contracts";
import { clamp } from "effect/Number";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import { RpcSerialization, RpcServer } from "effect/unstable/rpc";

import { CheckpointDiffQuery } from "./checkpointing/Services/CheckpointDiffQuery";
import { ServerConfig } from "./config";
import { GitCore } from "./git/Services/GitCore";
import { GitManager } from "./git/Services/GitManager";
import { Keybindings } from "./keybindings";
import { Open, resolveAvailableEditors } from "./open";
import { normalizeDispatchCommand } from "./orchestration/Normalizer";
import { OrchestrationEngineService } from "./orchestration/Services/OrchestrationEngine";
import { ProjectionSnapshotQuery } from "./orchestration/Services/ProjectionSnapshotQuery";
import { ProviderRegistry } from "./provider/Services/ProviderRegistry";
import { ServerLifecycleEvents } from "./serverLifecycleEvents";
import { ServerRuntimeStartup } from "./serverRuntimeStartup";
import { ServerSettingsService } from "./serverSettings";
import { TerminalManager } from "./terminal/Services/Manager";
import { WorkspaceEntries } from "./workspace/Services/WorkspaceEntries";
import { WorkspaceFileSystem } from "./workspace/Services/WorkspaceFileSystem";
import { WorkspacePathOutsideRootError } from "./workspace/Services/WorkspacePaths";
import { ReviewCommentRepository } from "./persistence/Services/ReviewCommentRepository";
import { ReviewRequestRepository } from "./persistence/Services/ReviewRequestRepository";
import { GitHubCli } from "./git/Services/GitHubCli";

const WsRpcLayer = WsRpcGroup.toLayer(
  Effect.gen(function* () {
    const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
    const orchestrationEngine = yield* OrchestrationEngineService;
    const checkpointDiffQuery = yield* CheckpointDiffQuery;
    const keybindings = yield* Keybindings;
    const open = yield* Open;
    const gitManager = yield* GitManager;
    const git = yield* GitCore;
    const terminalManager = yield* TerminalManager;
    const providerRegistry = yield* ProviderRegistry;
    const config = yield* ServerConfig;
    const lifecycleEvents = yield* ServerLifecycleEvents;
    const serverSettings = yield* ServerSettingsService;
    const startup = yield* ServerRuntimeStartup;
    const workspaceEntries = yield* WorkspaceEntries;
    const workspaceFileSystem = yield* WorkspaceFileSystem;
    const reviewCommentRepo = yield* ReviewCommentRepository;
    const reviewRequestRepo = yield* ReviewRequestRepository;
    const gitHubCli = yield* GitHubCli;
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    const loadServerConfig = Effect.gen(function* () {
      const keybindingsConfig = yield* keybindings.loadConfigState;
      const providers = yield* providerRegistry.getProviders;
      const settings = yield* serverSettings.getSettings;

      return {
        cwd: config.cwd,
        keybindingsConfigPath: config.keybindingsConfigPath,
        keybindings: keybindingsConfig.keybindings,
        issues: keybindingsConfig.issues,
        providers,
        availableEditors: resolveAvailableEditors(),
        settings,
      };
    });

    return WsRpcGroup.of({
      [ORCHESTRATION_WS_METHODS.getSnapshot]: (_input) =>
        projectionSnapshotQuery.getSnapshot().pipe(
          Effect.mapError(
            (cause) =>
              new OrchestrationGetSnapshotError({
                message: "Failed to load orchestration snapshot",
                cause,
              }),
          ),
        ),
      [ORCHESTRATION_WS_METHODS.dispatchCommand]: (command) =>
        Effect.gen(function* () {
          const normalizedCommand = yield* normalizeDispatchCommand(command);
          return yield* startup.enqueueCommand(orchestrationEngine.dispatch(normalizedCommand));
        }).pipe(
          Effect.mapError((cause) =>
            Schema.is(OrchestrationDispatchCommandError)(cause)
              ? cause
              : new OrchestrationDispatchCommandError({
                  message: "Failed to dispatch orchestration command",
                  cause,
                }),
          ),
        ),
      [ORCHESTRATION_WS_METHODS.getTurnDiff]: (input) =>
        checkpointDiffQuery.getTurnDiff(input).pipe(
          Effect.mapError(
            (cause) =>
              new OrchestrationGetTurnDiffError({
                message: "Failed to load turn diff",
                cause,
              }),
          ),
        ),
      [ORCHESTRATION_WS_METHODS.getFullThreadDiff]: (input) =>
        checkpointDiffQuery.getFullThreadDiff(input).pipe(
          Effect.mapError(
            (cause) =>
              new OrchestrationGetFullThreadDiffError({
                message: "Failed to load full thread diff",
                cause,
              }),
          ),
        ),
      [ORCHESTRATION_WS_METHODS.replayEvents]: (input) =>
        Stream.runCollect(
          orchestrationEngine.readEvents(
            clamp(input.fromSequenceExclusive, { maximum: Number.MAX_SAFE_INTEGER, minimum: 0 }),
          ),
        ).pipe(
          Effect.map((events) => Array.from(events)),
          Effect.mapError(
            (cause) =>
              new OrchestrationReplayEventsError({
                message: "Failed to replay orchestration events",
                cause,
              }),
          ),
        ),
      [WS_METHODS.subscribeOrchestrationDomainEvents]: (_input) =>
        Stream.unwrap(
          Effect.gen(function* () {
            const snapshot = yield* orchestrationEngine.getReadModel();
            const fromSequenceExclusive = snapshot.snapshotSequence;
            const replayEvents: Array<OrchestrationEvent> = yield* Stream.runCollect(
              orchestrationEngine.readEvents(fromSequenceExclusive),
            ).pipe(
              Effect.map((events) => Array.from(events)),
              Effect.catch(() => Effect.succeed([] as Array<OrchestrationEvent>)),
            );
            const replayStream = Stream.fromIterable(replayEvents);
            const source = Stream.merge(replayStream, orchestrationEngine.streamDomainEvents);
            type SequenceState = {
              readonly nextSequence: number;
              readonly pendingBySequence: Map<number, OrchestrationEvent>;
            };
            const state = yield* Ref.make<SequenceState>({
              nextSequence: fromSequenceExclusive + 1,
              pendingBySequence: new Map<number, OrchestrationEvent>(),
            });

            return source.pipe(
              Stream.mapEffect((event) =>
                Ref.modify(
                  state,
                  ({
                    nextSequence,
                    pendingBySequence,
                  }): [Array<OrchestrationEvent>, SequenceState] => {
                    if (event.sequence < nextSequence || pendingBySequence.has(event.sequence)) {
                      return [[], { nextSequence, pendingBySequence }];
                    }

                    const updatedPending = new Map(pendingBySequence);
                    updatedPending.set(event.sequence, event);

                    const emit: Array<OrchestrationEvent> = [];
                    let expected = nextSequence;
                    for (;;) {
                      const expectedEvent = updatedPending.get(expected);
                      if (!expectedEvent) {
                        break;
                      }
                      emit.push(expectedEvent);
                      updatedPending.delete(expected);
                      expected += 1;
                    }

                    return [emit, { nextSequence: expected, pendingBySequence: updatedPending }];
                  },
                ),
              ),
              Stream.flatMap((events) => Stream.fromIterable(events)),
            );
          }),
        ),
      [WS_METHODS.serverGetConfig]: (_input) => loadServerConfig,
      [WS_METHODS.serverRefreshProviders]: (_input) =>
        providerRegistry.refresh().pipe(Effect.map((providers) => ({ providers }))),
      [WS_METHODS.serverUpsertKeybinding]: (rule) =>
        Effect.gen(function* () {
          const keybindingsConfig = yield* keybindings.upsertKeybindingRule(rule);
          return { keybindings: keybindingsConfig, issues: [] };
        }),
      [WS_METHODS.serverGetSettings]: (_input) => serverSettings.getSettings,
      [WS_METHODS.serverUpdateSettings]: ({ patch }) => serverSettings.updateSettings(patch),
      [WS_METHODS.projectsSearchEntries]: (input) =>
        workspaceEntries.search(input).pipe(
          Effect.mapError(
            (cause) =>
              new ProjectSearchEntriesError({
                message: `Failed to search workspace entries: ${cause.detail}`,
                cause,
              }),
          ),
        ),
      [WS_METHODS.projectsWriteFile]: (input) =>
        workspaceFileSystem.writeFile(input).pipe(
          Effect.mapError((cause) => {
            const message = Schema.is(WorkspacePathOutsideRootError)(cause)
              ? "Workspace file path must stay within the project root."
              : "Failed to write workspace file";
            return new ProjectWriteFileError({
              message,
              cause,
            });
          }),
        ),
      [WS_METHODS.shellOpenInEditor]: (input) => open.openInEditor(input),
      [WS_METHODS.gitStatus]: (input) => gitManager.status(input),
      [WS_METHODS.gitPull]: (input) =>
        git.pullCurrentBranch(input.cwd).pipe(
          Effect.catch(() =>
            Effect.gen(function* () {
              const details = yield* git.statusDetails(input.cwd);
              if (details.hasWorkingTreeChanges) {
                return yield* new GitCommandError({
                    operation: "pull",
                    command: "git pull",
                    cwd: input.cwd,
                    detail:
                      "Branch has diverged and has local changes. Stash or commit changes before syncing.",
                  });
              }
              yield* git.resetToUpstream(input.cwd);
              const refreshed = yield* git.statusDetails(input.cwd);
              return {
                status: "pulled" as const,
                branch: refreshed.branch ?? "unknown",
                upstreamBranch: refreshed.upstreamRef,
              };
            }),
          ),
        ),
      [WS_METHODS.gitRunStackedAction]: (input) =>
        Stream.callback<GitActionProgressEvent, GitManagerServiceError>((queue) =>
          gitManager
            .runStackedAction(input, {
              actionId: input.actionId,
              progressReporter: {
                publish: (event) => Queue.offer(queue, event).pipe(Effect.asVoid),
              },
            })
            .pipe(
              Effect.matchCauseEffect({
                onFailure: (cause) => Queue.failCause(queue, cause),
                onSuccess: () => Queue.end(queue).pipe(Effect.asVoid),
              }),
            ),
        ),
      [WS_METHODS.gitResolvePullRequest]: (input) => gitManager.resolvePullRequest(input),
      [WS_METHODS.gitPreparePullRequestThread]: (input) =>
        gitManager.preparePullRequestThread(input),
      [WS_METHODS.gitListBranches]: (input) => git.listBranches(input),
      [WS_METHODS.gitCreateWorktree]: (input) => git.createWorktree(input),
      [WS_METHODS.gitRemoveWorktree]: (input) => git.removeWorktree(input),
      [WS_METHODS.gitCreateBranch]: (input) => git.createBranch(input),
      [WS_METHODS.gitCheckout]: (input) => Effect.scoped(git.checkoutBranch(input)),
      [WS_METHODS.gitInit]: (input) => git.initRepo(input),
      [WS_METHODS.gitDiffBranch]: (input) => git.diffBranch(input),
      [WS_METHODS.gitDiffWorkingTree]: (input) => git.diffWorkingTree(input),
      [WS_METHODS.projectsReadFile]: (input) =>
        Effect.gen(function* () {
          const relativePath = input.relativePath.trim();
          if (path.isAbsolute(relativePath)) {
            return yield* new ProjectWriteFileError({ message: "File path must be relative." });
          }
          const absolutePath = path.resolve(input.cwd, relativePath);
          const content = yield* fileSystem
            .readFileString(absolutePath)
            .pipe(
              Effect.mapError(
                () => new ProjectWriteFileError({ message: `File not found: ${relativePath}` }),
              ),
            );
          return { content };
        }),
      [WS_METHODS.projectsResolveFromWorkspace]: (input) =>
        Effect.gen(function* () {
          for (const root of input.workspaceRoots) {
            const candidate = path.resolve(root, input.repository);
            const exists = yield* fileSystem.stat(candidate).pipe(
              Effect.map(() => true),
              Effect.catch(() => Effect.succeed(false)),
            );
            if (exists) return { cwd: candidate };
          }
          return { cwd: null };
        }),
      [WS_METHODS.reviewCommentAdd]: (input) =>
        reviewCommentRepo.add(input).pipe(
          Effect.map((comment) => ({ comment })),
          Effect.mapError((cause) => new ReviewCommentError({ message: cause.message, cause })),
        ),
      [WS_METHODS.reviewCommentUpdate]: (input) =>
        reviewCommentRepo
          .update(input)
          .pipe(
            Effect.mapError((cause) => new ReviewCommentError({ message: cause.message, cause })),
          ),
      [WS_METHODS.reviewCommentDelete]: (input) =>
        reviewCommentRepo
          .delete(input)
          .pipe(
            Effect.mapError((cause) => new ReviewCommentError({ message: cause.message, cause })),
          ),
      [WS_METHODS.reviewCommentList]: (input) =>
        reviewCommentRepo.listByThreadId(input).pipe(
          Effect.map((comments) => ({ comments: Array.from(comments) })),
          Effect.mapError((cause) => new ReviewCommentError({ message: cause.message, cause })),
        ),
      [WS_METHODS.reviewCommentPublish]: (input) =>
        Effect.gen(function* () {
          const allComments = yield* reviewCommentRepo.listByThreadId({
            threadId: input.threadId,
          });
          const comments = input.commentId
            ? allComments.filter((c) => c.id === input.commentId)
            : [...allComments];

          if (comments.length === 0) {
            return { published: 0 };
          }

          // Parse owner/repo/number from PR URL
          const prUrlMatch = input.prUrl.match(/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)/);
          if (!prUrlMatch) {
            return yield* new ReviewCommentError({
                message: "Invalid PR URL format. Expected: https://github.com/owner/repo/pull/123",
              });
          }
          const [, owner, repo, prNumber] = prUrlMatch;

          // Get the PR head SHA
          const headSha = yield* gitHubCli
            .execute({
              cwd: input.cwd,
              args: ["api", `repos/${owner}/${repo}/pulls/${prNumber}`, "--jq", ".head.sha"],
              timeoutMs: 15_000,
            })
            .pipe(
              Effect.map((r) => r.stdout.trim()),
              Effect.catch(() => Effect.succeed("HEAD")),
            );

          // Pre-flight: check which files are in the PR diff
          const prFiles = yield* gitHubCli
            .execute({
              cwd: input.cwd,
              args: [
                "api",
                `repos/${owner}/${repo}/pulls/${prNumber}/files`,
                "--jq",
                ".[].filename",
              ],
              timeoutMs: 15_000,
            })
            .pipe(
              Effect.map((r) => new Set(r.stdout.trim().split("\n").filter(Boolean))),
              Effect.catch(() => Effect.succeed(null as Set<string> | null)),
            );

          if (prFiles) {
            const outsideDiff = comments.filter((c) => !prFiles.has(c.file));
            if (outsideDiff.length > 0) {
              const fileNames = outsideDiff.map((c) => c.file.split("/").pop()).join(", ");
              return {
                published: 0,
                failed: outsideDiff.length,
                error: `Cannot publish comments on files outside the PR diff: ${fileNames}`,
              };
            }
          }

          let published = 0;
          let failed = 0;
          let lastUrl: string | undefined;
          let lastError: string | undefined;

          for (const comment of comments) {
            const result = yield* gitHubCli
              .execute({
                cwd: input.cwd,
                args: [
                  "api",
                  `repos/${owner}/${repo}/pulls/${prNumber}/comments`,
                  "-X",
                  "POST",
                  "-f",
                  `body=${comment.body}`,
                  "-f",
                  `commit_id=${headSha}`,
                  "-f",
                  `path=${comment.file}`,
                  "-F",
                  `line=${String(comment.startLine)}`,
                  "--jq",
                  ".html_url",
                ],
                timeoutMs: 15_000,
              })
              .pipe(Effect.exit);

            if (Exit.isSuccess(result)) {
              const url = result.value.stdout.trim();
              lastUrl = url;
              published++;
              yield* reviewCommentRepo
                .update({
                  id: comment.id,
                  publishedAt: new Date().toISOString(),
                  ...(url ? { publishedUrl: url } : {}),
                })
                .pipe(Effect.ignore);
            } else {
              failed++;
              lastError = Cause.pretty(result.cause);
            }
          }

          return {
            published,
            ...(failed > 0 ? { failed } : {}),
            ...(lastUrl ? { url: lastUrl } : {}),
            ...(lastError ? { error: lastError } : {}),
          };
        }).pipe(
          Effect.mapError((cause) =>
            Schema.is(ReviewCommentError)(cause)
              ? cause
              : new ReviewCommentError({ message: String(cause), cause }),
          ),
        ),
      [WS_METHODS.reviewRequestUpsert]: (input) =>
        Effect.gen(function* () {
          const reviewRequest = yield* reviewRequestRepo.upsert({
            prUrl: input.prUrl,
            prNumber: input.prNumber,
            prTitle: input.prTitle,
            repoNameWithOwner: input.repoNameWithOwner,
            authorLogin: "",
            isBot: false,
          });
          if (input.threadId) {
            yield* reviewRequestRepo.updateStatus({
              id: reviewRequest.id,
              status: "in_review",
              threadId: input.threadId,
            });
          }
          return { reviewRequest };
        }).pipe(
          Effect.mapError((cause) => new ReviewRequestError({ message: cause.message, cause })),
        ),
      [WS_METHODS.reviewRequestList]: (_input) =>
        Effect.gen(function* () {
          // Fetch current review requests from GitHub via the gh CLI
          const ghResults = yield* gitHubCli
            .listReviewRequests({ limit: 30 })
            .pipe(Effect.catch(() => Effect.succeed([] as const)));

          // Upsert each GitHub result into the DB
          for (const pr of ghResults) {
            const login = pr.author.login.toLowerCase();
            const isBot =
              login.endsWith("[bot]") ||
              login === "dependabot" ||
              login === "renovate" ||
              login === "github-actions" ||
              login === "greenkeeper" ||
              login === "snyk-bot" ||
              login === "mergify" ||
              login === "codecov" ||
              login === "allcontributors";
            yield* reviewRequestRepo
              .upsert({
                prUrl: pr.url,
                prNumber: pr.number,
                prTitle: pr.title,
                repoNameWithOwner: pr.repository.nameWithOwner,
                authorLogin: pr.author.login,
                isBot,
                ...(pr.body ? { prBody: pr.body } : {}),
                prLabels: pr.labels.map((l) => l.name),
              })
              .pipe(Effect.ignore);
          }

          // Auto-dismiss stale requests
          if (ghResults.length > 0) {
            yield* reviewRequestRepo
              .dismissStale(ghResults.map((pr) => pr.url))
              .pipe(Effect.ignore);
          }

          // Unlink thread references for deleted threads
          yield* reviewRequestRepo.unlinkDeletedThreads().pipe(Effect.ignore);

          const reviewRequests = yield* reviewRequestRepo.listActive();
          return { reviewRequests: Array.from(reviewRequests) };
        }).pipe(
          Effect.mapError((cause) =>
            Schema.is(ReviewRequestError)(cause)
              ? cause
              : new ReviewRequestError({ message: String(cause), cause }),
          ),
        ),
      [WS_METHODS.reviewRequestDismiss]: (input) =>
        reviewRequestRepo
          .updateStatus({ id: input.id, status: "dismissed" })
          .pipe(
            Effect.mapError((cause) => new ReviewRequestError({ message: cause.message, cause })),
          ),
      [WS_METHODS.reviewRequestReopen]: (input) =>
        reviewRequestRepo
          .updateStatus({ id: input.id, status: "pending" })
          .pipe(
            Effect.mapError((cause) => new ReviewRequestError({ message: cause.message, cause })),
          ),
      [WS_METHODS.reviewRequestLinkThread]: (input) =>
        reviewRequestRepo
          .updateStatus({
            id: input.id,
            status: "in_review",
            threadId: input.threadId,
          })
          .pipe(
            Effect.mapError((cause) => new ReviewRequestError({ message: cause.message, cause })),
          ),
      [WS_METHODS.reviewRequestSubmit]: (input) =>
        Effect.gen(function* () {
          // Parse owner/repo/number from PR URL
          const prUrlMatch = input.prUrl.match(/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)/);
          if (!prUrlMatch) {
            return yield* new ReviewRequestError({
                message: "Invalid PR URL format. Expected: https://github.com/owner/repo/pull/123",
              });
          }
          const [, owner, repo, prNumber] = prUrlMatch;

          // Submit the review via GitHub API
          yield* gitHubCli.execute({
            cwd: process.cwd(),
            args: [
              "api",
              `repos/${owner}/${repo}/pulls/${prNumber}/reviews`,
              "-X",
              "POST",
              "-f",
              `event=${input.event}`,
              "-f",
              `body=${input.body ?? ""}`,
            ],
            timeoutMs: 15_000,
          });

          // Record the review outcome
          yield* reviewRequestRepo.updateStatus({
            id: input.id,
            status: input.event === "APPROVE" ? "approved" : "changes_requested",
          });
        }).pipe(
          Effect.mapError((cause) =>
            Schema.is(ReviewRequestError)(cause)
              ? cause
              : new ReviewRequestError({ message: String(cause), cause }),
          ),
        ),
      [WS_METHODS.terminalOpen]: (input) => terminalManager.open(input),
      [WS_METHODS.terminalWrite]: (input) => terminalManager.write(input),
      [WS_METHODS.terminalResize]: (input) => terminalManager.resize(input),
      [WS_METHODS.terminalClear]: (input) => terminalManager.clear(input),
      [WS_METHODS.terminalRestart]: (input) => terminalManager.restart(input),
      [WS_METHODS.terminalClose]: (input) => terminalManager.close(input),
      [WS_METHODS.subscribeTerminalEvents]: (_input) =>
        Stream.callback<TerminalEvent>((queue) =>
          Effect.acquireRelease(
            terminalManager.subscribe((event) => Queue.offer(queue, event)),
            (unsubscribe) => Effect.sync(unsubscribe),
          ),
        ),
      [WS_METHODS.subscribeServerConfig]: (_input) =>
        Stream.unwrap(
          Effect.gen(function* () {
            const keybindingsUpdates = keybindings.streamChanges.pipe(
              Stream.map((event) => ({
                version: 1 as const,
                type: "keybindingsUpdated" as const,
                payload: {
                  issues: event.issues,
                },
              })),
            );
            const providerStatuses = providerRegistry.streamChanges.pipe(
              Stream.map((providers) => ({
                version: 1 as const,
                type: "providerStatuses" as const,
                payload: { providers },
              })),
            );
            const settingsUpdates = serverSettings.streamChanges.pipe(
              Stream.map((settings) => ({
                version: 1 as const,
                type: "settingsUpdated" as const,
                payload: { settings },
              })),
            );

            return Stream.concat(
              Stream.make({
                version: 1 as const,
                type: "snapshot" as const,
                config: yield* loadServerConfig,
              }),
              Stream.merge(keybindingsUpdates, Stream.merge(providerStatuses, settingsUpdates)),
            );
          }),
        ),
      [WS_METHODS.subscribeServerLifecycle]: (_input) =>
        Stream.unwrap(
          Effect.gen(function* () {
            const snapshot = yield* lifecycleEvents.snapshot;
            const snapshotEvents = Array.from(snapshot.events).toSorted(
              (left, right) => left.sequence - right.sequence,
            );
            const liveEvents = lifecycleEvents.stream.pipe(
              Stream.filter((event) => event.sequence > snapshot.sequence),
            );
            return Stream.concat(Stream.fromIterable(snapshotEvents), liveEvents);
          }),
        ),
    });
  }),
);

export const websocketRpcRouteLayer = Layer.unwrap(
  Effect.gen(function* () {
    const rpcWebSocketHttpEffect = yield* RpcServer.toHttpEffectWebsocket(WsRpcGroup).pipe(
      Effect.provide(Layer.mergeAll(WsRpcLayer, RpcSerialization.layerJson)),
    );
    return HttpRouter.add(
      "GET",
      "/ws",
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const config = yield* ServerConfig;
        if (config.authToken) {
          const url = HttpServerRequest.toURL(request);
          if (Option.isNone(url)) {
            return HttpServerResponse.text("Invalid WebSocket URL", { status: 400 });
          }
          const token = url.value.searchParams.get("token");
          if (token !== config.authToken) {
            return HttpServerResponse.text("Unauthorized WebSocket connection", { status: 401 });
          }
        }
        return yield* rpcWebSocketHttpEffect;
      }),
    );
  }),
);
