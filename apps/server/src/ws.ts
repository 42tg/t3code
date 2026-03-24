import { Cause, Effect, Exit, Layer, Option, Queue, Ref, Schema, Stream } from "effect";
import { FileSystem, Path } from "effect";
import {
  CommandId,
  EventId,
  type OrchestrationCommand,
  type GitActionProgressEvent,
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
  ThreadId,
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
import { GitStatusBroadcaster } from "./git/Services/GitStatusBroadcaster";
import { Keybindings } from "./keybindings";
import { Open, resolveAvailableEditors } from "./open";
import { normalizeDispatchCommand } from "./orchestration/Normalizer";
import { OrchestrationEngineService } from "./orchestration/Services/OrchestrationEngine";
import { ProjectionSnapshotQuery } from "./orchestration/Services/ProjectionSnapshotQuery";
import {
  observeRpcEffect,
  observeRpcStream,
  observeRpcStreamEffect,
} from "./observability/RpcInstrumentation";
import { ProviderRegistry } from "./provider/Services/ProviderRegistry";
import { ServerLifecycleEvents } from "./serverLifecycleEvents";
import { ServerRuntimeStartup } from "./serverRuntimeStartup";
import { ServerSettingsService } from "./serverSettings";
import { TerminalManager } from "./terminal/Services/Manager";
import { WorkspaceEntries } from "./workspace/Services/WorkspaceEntries";
import { WorkspaceFileSystem } from "./workspace/Services/WorkspaceFileSystem";
import { WorkspacePathOutsideRootError } from "./workspace/Services/WorkspacePaths";
import { ProjectSetupScriptRunner } from "./project/Services/ProjectSetupScriptRunner";
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
    const gitStatusBroadcaster = yield* GitStatusBroadcaster;
    const terminalManager = yield* TerminalManager;
    const providerRegistry = yield* ProviderRegistry;
    const config = yield* ServerConfig;
    const lifecycleEvents = yield* ServerLifecycleEvents;
    const serverSettings = yield* ServerSettingsService;
    const startup = yield* ServerRuntimeStartup;
    const workspaceEntries = yield* WorkspaceEntries;
    const workspaceFileSystem = yield* WorkspaceFileSystem;
    const projectSetupScriptRunner = yield* ProjectSetupScriptRunner;
    const serverCommandId = (tag: string) =>
      CommandId.makeUnsafe(`server:${tag}:${crypto.randomUUID()}`);

    const appendSetupScriptActivity = (input: {
      readonly threadId: ThreadId;
      readonly kind: "setup-script.requested" | "setup-script.started" | "setup-script.failed";
      readonly summary: string;
      readonly createdAt: string;
      readonly payload: Record<string, unknown>;
      readonly tone: "info" | "error";
    }) =>
      orchestrationEngine.dispatch({
        type: "thread.activity.append",
        commandId: serverCommandId("setup-script-activity"),
        threadId: input.threadId,
        activity: {
          id: EventId.makeUnsafe(crypto.randomUUID()),
          tone: input.tone,
          kind: input.kind,
          summary: input.summary,
          payload: input.payload,
          turnId: null,
          createdAt: input.createdAt,
        },
        createdAt: input.createdAt,
      });

    const toDispatchCommandError = (cause: unknown, fallbackMessage: string) =>
      Schema.is(OrchestrationDispatchCommandError)(cause)
        ? cause
        : new OrchestrationDispatchCommandError({
            message: cause instanceof Error ? cause.message : fallbackMessage,
            cause,
          });

    const toBootstrapDispatchCommandCauseError = (cause: Cause.Cause<unknown>) => {
      const error = Cause.squash(cause);
      return Schema.is(OrchestrationDispatchCommandError)(error)
        ? error
        : new OrchestrationDispatchCommandError({
            message:
              error instanceof Error ? error.message : "Failed to bootstrap thread turn start.",
            cause,
          });
    };

    const dispatchBootstrapTurnStart = (
      command: Extract<OrchestrationCommand, { type: "thread.turn.start" }>,
    ): Effect.Effect<{ readonly sequence: number }, OrchestrationDispatchCommandError> =>
      Effect.gen(function* () {
        const bootstrap = command.bootstrap;
        const { bootstrap: _bootstrap, ...finalTurnStartCommand } = command;
        let createdThread = false;
        let targetProjectId = bootstrap?.createThread?.projectId;
        let targetProjectCwd = bootstrap?.prepareWorktree?.projectCwd;
        let targetWorktreePath = bootstrap?.createThread?.worktreePath ?? null;

        const cleanupCreatedThread = () =>
          createdThread
            ? orchestrationEngine
                .dispatch({
                  type: "thread.delete",
                  commandId: serverCommandId("bootstrap-thread-delete"),
                  threadId: command.threadId,
                })
                .pipe(Effect.ignoreCause({ log: true }))
            : Effect.void;

        const recordSetupScriptLaunchFailure = (input: {
          readonly error: unknown;
          readonly requestedAt: string;
          readonly worktreePath: string;
        }) => {
          const detail =
            input.error instanceof Error ? input.error.message : "Unknown setup failure.";
          return appendSetupScriptActivity({
            threadId: command.threadId,
            kind: "setup-script.failed",
            summary: "Setup script failed to start",
            createdAt: input.requestedAt,
            payload: {
              detail,
              worktreePath: input.worktreePath,
            },
            tone: "error",
          }).pipe(
            Effect.ignoreCause({ log: false }),
            Effect.flatMap(() =>
              Effect.logWarning("bootstrap turn start failed to launch setup script", {
                threadId: command.threadId,
                worktreePath: input.worktreePath,
                detail,
              }),
            ),
          );
        };

        const recordSetupScriptStarted = (input: {
          readonly requestedAt: string;
          readonly worktreePath: string;
          readonly scriptId: string;
          readonly scriptName: string;
          readonly terminalId: string;
        }) => {
          const payload = {
            scriptId: input.scriptId,
            scriptName: input.scriptName,
            terminalId: input.terminalId,
            worktreePath: input.worktreePath,
          };
          return Effect.all([
            appendSetupScriptActivity({
              threadId: command.threadId,
              kind: "setup-script.requested",
              summary: "Starting setup script",
              createdAt: input.requestedAt,
              payload,
              tone: "info",
            }),
            appendSetupScriptActivity({
              threadId: command.threadId,
              kind: "setup-script.started",
              summary: "Setup script started",
              createdAt: new Date().toISOString(),
              payload,
              tone: "info",
            }),
          ]).pipe(
            Effect.asVoid,
            Effect.catch((error) =>
              Effect.logWarning(
                "bootstrap turn start launched setup script but failed to record setup activity",
                {
                  threadId: command.threadId,
                  worktreePath: input.worktreePath,
                  scriptId: input.scriptId,
                  terminalId: input.terminalId,
                  detail:
                    error instanceof Error
                      ? error.message
                      : "Unknown setup activity dispatch failure.",
                },
              ),
            ),
          );
        };

        const runSetupProgram = () =>
          bootstrap?.runSetupScript && targetWorktreePath
            ? (() => {
                const worktreePath = targetWorktreePath;
                const requestedAt = new Date().toISOString();
                return projectSetupScriptRunner
                  .runForThread({
                    threadId: command.threadId,
                    ...(targetProjectId ? { projectId: targetProjectId } : {}),
                    ...(targetProjectCwd ? { projectCwd: targetProjectCwd } : {}),
                    worktreePath,
                  })
                  .pipe(
                    Effect.matchEffect({
                      onFailure: (error) =>
                        recordSetupScriptLaunchFailure({
                          error,
                          requestedAt,
                          worktreePath,
                        }),
                      onSuccess: (setupResult) => {
                        if (setupResult.status !== "started") {
                          return Effect.void;
                        }
                        return recordSetupScriptStarted({
                          requestedAt,
                          worktreePath,
                          scriptId: setupResult.scriptId,
                          scriptName: setupResult.scriptName,
                          terminalId: setupResult.terminalId,
                        });
                      },
                    }),
                  );
              })()
            : Effect.void;

        const bootstrapProgram = Effect.gen(function* () {
          if (bootstrap?.createThread) {
            yield* orchestrationEngine.dispatch({
              type: "thread.create",
              commandId: serverCommandId("bootstrap-thread-create"),
              threadId: command.threadId,
              projectId: bootstrap.createThread.projectId,
              title: bootstrap.createThread.title,
              modelSelection: bootstrap.createThread.modelSelection,
              runtimeMode: bootstrap.createThread.runtimeMode,
              interactionMode: bootstrap.createThread.interactionMode,
              branch: bootstrap.createThread.branch,
              worktreePath: bootstrap.createThread.worktreePath,
              createdAt: bootstrap.createThread.createdAt,
            });
            createdThread = true;
          }

          if (bootstrap?.prepareWorktree) {
            const worktree = yield* git.createWorktree({
              cwd: bootstrap.prepareWorktree.projectCwd,
              branch: bootstrap.prepareWorktree.baseBranch,
              newBranch: bootstrap.prepareWorktree.branch,
              path: null,
            });
            targetWorktreePath = worktree.worktree.path;
            yield* orchestrationEngine.dispatch({
              type: "thread.meta.update",
              commandId: serverCommandId("bootstrap-thread-meta-update"),
              threadId: command.threadId,
              branch: worktree.worktree.branch,
              worktreePath: targetWorktreePath,
            });
          }

          yield* runSetupProgram();

          return yield* orchestrationEngine.dispatch(finalTurnStartCommand);
        });

        return yield* bootstrapProgram.pipe(
          Effect.catchCause((cause) => {
            const dispatchError = toBootstrapDispatchCommandCauseError(cause);
            if (Cause.hasInterruptsOnly(cause)) {
              return Effect.fail(dispatchError);
            }
            return cleanupCreatedThread().pipe(Effect.flatMap(() => Effect.fail(dispatchError)));
          }),
        );
      });

    const dispatchNormalizedCommand = (
      normalizedCommand: OrchestrationCommand,
    ): Effect.Effect<{ readonly sequence: number }, OrchestrationDispatchCommandError> => {
      const dispatchEffect =
        normalizedCommand.type === "thread.turn.start" && normalizedCommand.bootstrap
          ? dispatchBootstrapTurnStart(normalizedCommand)
          : orchestrationEngine
              .dispatch(normalizedCommand)
              .pipe(
                Effect.mapError((cause) =>
                  toDispatchCommandError(cause, "Failed to dispatch orchestration command"),
                ),
              );

      return startup
        .enqueueCommand(dispatchEffect)
        .pipe(
          Effect.mapError((cause) =>
            toDispatchCommandError(cause, "Failed to dispatch orchestration command"),
          ),
        );
    };
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
        observability: {
          logsDirectoryPath: config.logsDir,
          localTracingEnabled: true,
          ...(config.otlpTracesUrl !== undefined ? { otlpTracesUrl: config.otlpTracesUrl } : {}),
          otlpTracesEnabled: config.otlpTracesUrl !== undefined,
          ...(config.otlpMetricsUrl !== undefined ? { otlpMetricsUrl: config.otlpMetricsUrl } : {}),
          otlpMetricsEnabled: config.otlpMetricsUrl !== undefined,
        },
        settings,
      };
    });

    const refreshGitStatus = (cwd: string) =>
      gitStatusBroadcaster
        .refreshStatus(cwd)
        .pipe(Effect.ignoreCause({ log: true }), Effect.forkDetach, Effect.asVoid);

    return WsRpcGroup.of({
      [ORCHESTRATION_WS_METHODS.getSnapshot]: (_input) =>
        observeRpcEffect(
          ORCHESTRATION_WS_METHODS.getSnapshot,
          projectionSnapshotQuery.getSnapshot().pipe(
            Effect.mapError(
              (cause) =>
                new OrchestrationGetSnapshotError({
                  message: "Failed to load orchestration snapshot",
                  cause,
                }),
            ),
          ),
          { "rpc.aggregate": "orchestration" },
        ),
      [ORCHESTRATION_WS_METHODS.dispatchCommand]: (command) =>
        observeRpcEffect(
          ORCHESTRATION_WS_METHODS.dispatchCommand,
          Effect.gen(function* () {
            const normalizedCommand = yield* normalizeDispatchCommand(command);
            const result = yield* dispatchNormalizedCommand(normalizedCommand);
            if (normalizedCommand.type === "thread.archive") {
              yield* terminalManager.close({ threadId: normalizedCommand.threadId }).pipe(
                Effect.catch((error) =>
                  Effect.logWarning("failed to close thread terminals after archive", {
                    threadId: normalizedCommand.threadId,
                    error: error.message,
                  }),
                ),
              );
            }
            return result;
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
          { "rpc.aggregate": "orchestration" },
        ),
      [ORCHESTRATION_WS_METHODS.getTurnDiff]: (input) =>
        observeRpcEffect(
          ORCHESTRATION_WS_METHODS.getTurnDiff,
          checkpointDiffQuery.getTurnDiff(input).pipe(
            Effect.mapError(
              (cause) =>
                new OrchestrationGetTurnDiffError({
                  message: "Failed to load turn diff",
                  cause,
                }),
            ),
          ),
          { "rpc.aggregate": "orchestration" },
        ),
      [ORCHESTRATION_WS_METHODS.getFullThreadDiff]: (input) =>
        observeRpcEffect(
          ORCHESTRATION_WS_METHODS.getFullThreadDiff,
          checkpointDiffQuery.getFullThreadDiff(input).pipe(
            Effect.mapError(
              (cause) =>
                new OrchestrationGetFullThreadDiffError({
                  message: "Failed to load full thread diff",
                  cause,
                }),
            ),
          ),
          { "rpc.aggregate": "orchestration" },
        ),
      [ORCHESTRATION_WS_METHODS.replayEvents]: (input) =>
        observeRpcEffect(
          ORCHESTRATION_WS_METHODS.replayEvents,
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
          { "rpc.aggregate": "orchestration" },
        ),
      [WS_METHODS.subscribeOrchestrationDomainEvents]: (_input) =>
        observeRpcStreamEffect(
          WS_METHODS.subscribeOrchestrationDomainEvents,
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
          { "rpc.aggregate": "orchestration" },
        ),
      [WS_METHODS.serverGetConfig]: (_input) =>
        observeRpcEffect(WS_METHODS.serverGetConfig, loadServerConfig, {
          "rpc.aggregate": "server",
        }),
      [WS_METHODS.serverRefreshProviders]: (_input) =>
        observeRpcEffect(
          WS_METHODS.serverRefreshProviders,
          providerRegistry.refresh().pipe(Effect.map((providers) => ({ providers }))),
          { "rpc.aggregate": "server" },
        ),
      [WS_METHODS.serverUpsertKeybinding]: (rule) =>
        observeRpcEffect(
          WS_METHODS.serverUpsertKeybinding,
          Effect.gen(function* () {
            const keybindingsConfig = yield* keybindings.upsertKeybindingRule(rule);
            return { keybindings: keybindingsConfig, issues: [] };
          }),
          { "rpc.aggregate": "server" },
        ),
      [WS_METHODS.serverGetSettings]: (_input) =>
        observeRpcEffect(WS_METHODS.serverGetSettings, serverSettings.getSettings, {
          "rpc.aggregate": "server",
        }),
      [WS_METHODS.serverUpdateSettings]: ({ patch }) =>
        observeRpcEffect(WS_METHODS.serverUpdateSettings, serverSettings.updateSettings(patch), {
          "rpc.aggregate": "server",
        }),
      [WS_METHODS.projectsSearchEntries]: (input) =>
        observeRpcEffect(
          WS_METHODS.projectsSearchEntries,
          workspaceEntries.search(input).pipe(
            Effect.mapError(
              (cause) =>
                new ProjectSearchEntriesError({
                  message: `Failed to search workspace entries: ${cause.detail}`,
                  cause,
                }),
            ),
          ),
          { "rpc.aggregate": "workspace" },
        ),
      [WS_METHODS.projectsWriteFile]: (input) =>
        observeRpcEffect(
          WS_METHODS.projectsWriteFile,
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
          { "rpc.aggregate": "workspace" },
        ),
      [WS_METHODS.shellOpenInEditor]: (input) =>
        observeRpcEffect(WS_METHODS.shellOpenInEditor, open.openInEditor(input), {
          "rpc.aggregate": "workspace",
        }),
      [WS_METHODS.subscribeGitStatus]: (input) =>
        observeRpcStream(WS_METHODS.subscribeGitStatus, gitStatusBroadcaster.streamStatus(input), {
          "rpc.aggregate": "git",
        }),
      [WS_METHODS.gitRefreshStatus]: (input) =>
        observeRpcEffect(
          WS_METHODS.gitRefreshStatus,
          gitStatusBroadcaster.refreshStatus(input.cwd),
          {
            "rpc.aggregate": "git",
          },
        ),
      [WS_METHODS.gitPull]: (input) =>
        observeRpcEffect(
          WS_METHODS.gitPull,
          git.pullCurrentBranch(input.cwd).pipe(
            Effect.catch((pullError) =>
              Effect.gen(function* () {
                const details = yield* git.statusDetails(input.cwd);
                if (details.aheadCount === 0 || details.behindCount === 0) {
                  return yield* Effect.failCause(Cause.fail(pullError));
                }
                if (details.hasWorkingTreeChanges) {
                  return yield* Effect.failCause(Cause.fail(pullError));
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
            Effect.matchCauseEffect({
              onFailure: (cause) => Effect.failCause(cause),
              onSuccess: (result) =>
                refreshGitStatus(input.cwd).pipe(Effect.ignore({ log: true }), Effect.as(result)),
            }),
          ),
          { "rpc.aggregate": "git" },
        ),
      [WS_METHODS.gitRunStackedAction]: (input) =>
        observeRpcStream(
          WS_METHODS.gitRunStackedAction,
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
                  onSuccess: () =>
                    refreshGitStatus(input.cwd).pipe(
                      Effect.andThen(Queue.end(queue).pipe(Effect.asVoid)),
                    ),
                }),
              ),
          ),
          { "rpc.aggregate": "git" },
        ),
      [WS_METHODS.gitResolvePullRequest]: (input) =>
        observeRpcEffect(WS_METHODS.gitResolvePullRequest, gitManager.resolvePullRequest(input), {
          "rpc.aggregate": "git",
        }),
      [WS_METHODS.gitPreparePullRequestThread]: (input) =>
        observeRpcEffect(
          WS_METHODS.gitPreparePullRequestThread,
          gitManager
            .preparePullRequestThread(input)
            .pipe(Effect.tap(() => refreshGitStatus(input.cwd))),
          { "rpc.aggregate": "git" },
        ),
      [WS_METHODS.gitListBranches]: (input) =>
        observeRpcEffect(WS_METHODS.gitListBranches, git.listBranches(input), {
          "rpc.aggregate": "git",
        }),
      [WS_METHODS.gitCreateWorktree]: (input) =>
        observeRpcEffect(
          WS_METHODS.gitCreateWorktree,
          git.createWorktree(input).pipe(Effect.tap(() => refreshGitStatus(input.cwd))),
          { "rpc.aggregate": "git" },
        ),
      [WS_METHODS.gitRemoveWorktree]: (input) =>
        observeRpcEffect(
          WS_METHODS.gitRemoveWorktree,
          git.removeWorktree(input).pipe(Effect.tap(() => refreshGitStatus(input.cwd))),
          { "rpc.aggregate": "git" },
        ),
      [WS_METHODS.gitCreateBranch]: (input) =>
        observeRpcEffect(
          WS_METHODS.gitCreateBranch,
          git.createBranch(input).pipe(Effect.tap(() => refreshGitStatus(input.cwd))),
          { "rpc.aggregate": "git" },
        ),
      [WS_METHODS.gitCheckout]: (input) =>
        observeRpcEffect(
          WS_METHODS.gitCheckout,
          Effect.scoped(git.checkoutBranch(input)).pipe(
            Effect.tap(() => refreshGitStatus(input.cwd)),
          ),
          { "rpc.aggregate": "git" },
        ),
      [WS_METHODS.gitInit]: (input) =>
        observeRpcEffect(
          WS_METHODS.gitInit,
          git.initRepo(input).pipe(Effect.tap(() => refreshGitStatus(input.cwd))),
          { "rpc.aggregate": "git" },
        ),
      [WS_METHODS.gitSetBranchUpstream]: (input) =>
        observeRpcEffect(
          WS_METHODS.gitSetBranchUpstream,
          git.setBranchUpstream(input).pipe(Effect.tap(() => refreshGitStatus(input.cwd))),
          { "rpc.aggregate": "git" },
        ),
      [WS_METHODS.gitDiffBranch]: (input) =>
        observeRpcEffect(WS_METHODS.gitDiffBranch, git.diffBranch(input), {
          "rpc.aggregate": "git",
        }),
      [WS_METHODS.gitDiffWorkingTree]: (input) =>
        observeRpcEffect(WS_METHODS.gitDiffWorkingTree, git.diffWorkingTree(input), {
          "rpc.aggregate": "git",
        }),
      [WS_METHODS.projectsReadFile]: (input) =>
        observeRpcEffect(
          WS_METHODS.projectsReadFile,
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
          { "rpc.aggregate": "workspace" },
        ),
      [WS_METHODS.projectsResolveFromWorkspace]: (input) =>
        observeRpcEffect(
          WS_METHODS.projectsResolveFromWorkspace,
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
          { "rpc.aggregate": "workspace" },
        ),
      [WS_METHODS.reviewCommentAdd]: (input) =>
        observeRpcEffect(
          WS_METHODS.reviewCommentAdd,
          reviewCommentRepo.add(input).pipe(
            Effect.map((comment) => ({ comment })),
            Effect.mapError((cause) => new ReviewCommentError({ message: cause.message, cause })),
          ),
          { "rpc.aggregate": "review" },
        ),
      [WS_METHODS.reviewCommentUpdate]: (input) =>
        observeRpcEffect(
          WS_METHODS.reviewCommentUpdate,
          reviewCommentRepo
            .update(input)
            .pipe(
              Effect.mapError((cause) => new ReviewCommentError({ message: cause.message, cause })),
            ),
          { "rpc.aggregate": "review" },
        ),
      [WS_METHODS.reviewCommentDelete]: (input) =>
        observeRpcEffect(
          WS_METHODS.reviewCommentDelete,
          reviewCommentRepo
            .delete(input)
            .pipe(
              Effect.mapError((cause) => new ReviewCommentError({ message: cause.message, cause })),
            ),
          { "rpc.aggregate": "review" },
        ),
      [WS_METHODS.reviewCommentList]: (input) =>
        observeRpcEffect(
          WS_METHODS.reviewCommentList,
          reviewCommentRepo.listByThreadId(input).pipe(
            Effect.map((comments) => ({ comments: Array.from(comments) })),
            Effect.mapError((cause) => new ReviewCommentError({ message: cause.message, cause })),
          ),
          { "rpc.aggregate": "review" },
        ),
      [WS_METHODS.reviewCommentPublish]: (input) =>
        observeRpcEffect(
          WS_METHODS.reviewCommentPublish,
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

            const prUrlMatch = input.prUrl.match(/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)/);
            if (!prUrlMatch) {
              return yield* new ReviewCommentError({
                message: "Invalid PR URL format. Expected: https://github.com/owner/repo/pull/123",
              });
            }
            const [, owner, repo, prNumber] = prUrlMatch;

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
          { "rpc.aggregate": "review" },
        ),
      [WS_METHODS.reviewRequestUpsert]: (input) =>
        observeRpcEffect(
          WS_METHODS.reviewRequestUpsert,
          Effect.gen(function* () {
            const reviewRequest = yield* reviewRequestRepo.upsert({
              prUrl: input.prUrl,
              prNumber: input.prNumber,
              prTitle: input.prTitle,
              repoNameWithOwner: input.repoNameWithOwner,
              authorLogin: "self",
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
          { "rpc.aggregate": "review" },
        ),
      [WS_METHODS.reviewRequestList]: (_input) =>
        observeRpcEffect(
          WS_METHODS.reviewRequestList,
          Effect.gen(function* () {
            const ghResults = yield* gitHubCli
              .listReviewRequests({ limit: 30 })
              .pipe(Effect.catch(() => Effect.succeed([] as const)));

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

            if (ghResults.length > 0) {
              yield* reviewRequestRepo
                .dismissStale(ghResults.map((pr) => pr.url))
                .pipe(Effect.ignore);
            }

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
          { "rpc.aggregate": "review" },
        ),
      [WS_METHODS.reviewRequestDismiss]: (input) =>
        observeRpcEffect(
          WS_METHODS.reviewRequestDismiss,
          reviewRequestRepo
            .updateStatus({ id: input.id, status: "dismissed" })
            .pipe(
              Effect.mapError((cause) => new ReviewRequestError({ message: cause.message, cause })),
            ),
          { "rpc.aggregate": "review" },
        ),
      [WS_METHODS.reviewRequestReopen]: (input) =>
        observeRpcEffect(
          WS_METHODS.reviewRequestReopen,
          reviewRequestRepo
            .updateStatus({ id: input.id, status: "pending" })
            .pipe(
              Effect.mapError((cause) => new ReviewRequestError({ message: cause.message, cause })),
            ),
          { "rpc.aggregate": "review" },
        ),
      [WS_METHODS.reviewRequestLinkThread]: (input) =>
        observeRpcEffect(
          WS_METHODS.reviewRequestLinkThread,
          reviewRequestRepo
            .updateStatus({
              id: input.id,
              status: "in_review",
              threadId: input.threadId,
            })
            .pipe(
              Effect.mapError((cause) => new ReviewRequestError({ message: cause.message, cause })),
            ),
          { "rpc.aggregate": "review" },
        ),
      [WS_METHODS.reviewRequestSubmit]: (input) =>
        observeRpcEffect(
          WS_METHODS.reviewRequestSubmit,
          Effect.gen(function* () {
            const prUrlMatch = input.prUrl.match(/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)/);
            if (!prUrlMatch) {
              return yield* new ReviewRequestError({
                message: "Invalid PR URL format. Expected: https://github.com/owner/repo/pull/123",
              });
            }
            const [, owner, repo, prNumber] = prUrlMatch;

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
          { "rpc.aggregate": "review" },
        ),
      [WS_METHODS.terminalOpen]: (input) =>
        observeRpcEffect(WS_METHODS.terminalOpen, terminalManager.open(input), {
          "rpc.aggregate": "terminal",
        }),
      [WS_METHODS.terminalWrite]: (input) =>
        observeRpcEffect(WS_METHODS.terminalWrite, terminalManager.write(input), {
          "rpc.aggregate": "terminal",
        }),
      [WS_METHODS.terminalResize]: (input) =>
        observeRpcEffect(WS_METHODS.terminalResize, terminalManager.resize(input), {
          "rpc.aggregate": "terminal",
        }),
      [WS_METHODS.terminalClear]: (input) =>
        observeRpcEffect(WS_METHODS.terminalClear, terminalManager.clear(input), {
          "rpc.aggregate": "terminal",
        }),
      [WS_METHODS.terminalRestart]: (input) =>
        observeRpcEffect(WS_METHODS.terminalRestart, terminalManager.restart(input), {
          "rpc.aggregate": "terminal",
        }),
      [WS_METHODS.terminalClose]: (input) =>
        observeRpcEffect(WS_METHODS.terminalClose, terminalManager.close(input), {
          "rpc.aggregate": "terminal",
        }),
      [WS_METHODS.subscribeTerminalEvents]: (_input) =>
        observeRpcStream(
          WS_METHODS.subscribeTerminalEvents,
          Stream.callback<TerminalEvent>((queue) =>
            Effect.acquireRelease(
              terminalManager.subscribe((event) => Queue.offer(queue, event)),
              (unsubscribe) => Effect.sync(unsubscribe),
            ),
          ),
          { "rpc.aggregate": "terminal" },
        ),
      [WS_METHODS.subscribeServerConfig]: (_input) =>
        observeRpcStreamEffect(
          WS_METHODS.subscribeServerConfig,
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
          { "rpc.aggregate": "server" },
        ),
      [WS_METHODS.subscribeServerLifecycle]: (_input) =>
        observeRpcStreamEffect(
          WS_METHODS.subscribeServerLifecycle,
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
          { "rpc.aggregate": "server" },
        ),
    });
  }),
);

export const websocketRpcRouteLayer = Layer.unwrap(
  Effect.gen(function* () {
    const rpcWebSocketHttpEffect = yield* RpcServer.toHttpEffectWebsocket(WsRpcGroup, {
      spanPrefix: "ws.rpc",
      spanAttributes: {
        "rpc.transport": "websocket",
        "rpc.system": "effect-rpc",
      },
    }).pipe(Effect.provide(Layer.mergeAll(WsRpcLayer, RpcSerialization.layerJson)));
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
