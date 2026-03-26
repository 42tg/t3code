# Implementation Plan: Memory Feature

## Executive Summary

- **Objective**: Add a Memory Feature that lets T3 Code persist, search, and recall discrete knowledge entries (facts, preferences, patterns, decisions, conventions) across sessions and projects.
- **Key deliverables**: Database schema, repository service, WS endpoints, contract schemas, React UI (panel + dialogs), auto-extraction hook from completed turns, context injection for threads.
- **Success criteria**: Users can manually create/edit/archive/delete memories, search them via FTS5, see which memories apply to the current thread, and have the system auto-extract memorable content from conversations.

## Repository Context

### Technology Stack

- **Monorepo**: Turborepo with `bun` runtime
- **Server**: Node.js + Effect-TS, WebSocket RPC, SQLite via `node:sqlite` with Effect SQL client
- **Web**: React + Vite + TanStack Router/Query + Zustand + Tailwind CSS
- **Contracts**: Effect/Schema in `packages/contracts/src/`
- **Persistence**: Event Sourcing + CQRS; projection tables prefixed `projection_`; standalone domain tables (e.g. `review_comments`, `review_requests`)

### Relevant Patterns (with exact file references)

1. **Migration files**: `apps/server/src/persistence/Migrations/NNN_Name.ts`
   - Export default `Effect.gen` that yields `SqlClient.SqlClient` and runs SQL statements
   - Registered in `apps/server/src/persistence/Migrations.ts` via `Migrator.fromRecord` with key format `"{id}_{name}"`
   - Next available migration number: **019**

2. **Service interface**: `apps/server/src/persistence/Services/ReviewCommentRepository.ts`
   - Define `RepositoryShape` interface with method signatures returning `Effect.Effect<Result, Error>`
   - Define error type alias combining `PersistenceSqlError | PersistenceDecodeError`
   - Export class extending `ServiceMap.Service<Self, Shape>()("tag/path")`

3. **Layer implementation**: `apps/server/src/persistence/Layers/ReviewCommentRepository.ts`
   - Import `SqlClient`, `SqlSchema`, schemas from contracts
   - Define DB row schema mapping SQL column names to camelCase
   - Create `SqlSchema.void` / `SqlSchema.findAll` / `SqlSchema.single` query helpers
   - Wrap each in `Effect.mapError(toPersistenceSqlOrDecodeError(...))`
   - Export `const XxxLive = Layer.effect(XxxService, makeXxx)`

4. **Layer wiring**: `apps/server/src/serverLayers.ts`
   - `makeServerRuntimeServicesLayer()` merges all service layers
   - Repository layers are added to the final `Layer.mergeAll(...)` call

5. **WS method routing**: `packages/contracts/src/ws.ts`
   - `WS_METHODS` object: add method name strings
   - `WebSocketRequestBody` union: add `tagRequestBody(WS_METHODS.xxx, InputSchema)` entries
   - `apps/server/src/wsServer.ts`:
     - Yield the service in `createServer` via `yield* ServiceTag`
     - Add `case WS_METHODS.xxx:` handlers in `routeRequest` switch
     - Add service tag to `ServerRuntimeServices` type union

6. **Contract schemas**: `packages/contracts/src/reviewComment.ts`
   - Define domain schema (e.g. `ReviewComment`)
   - Define WS input/result schemas (e.g. `ReviewCommentAddInput`, `ReviewCommentListResult`)
   - Export all types
   - Re-export from `packages/contracts/src/index.ts`

7. **NativeApi interface**: `packages/contracts/src/ipc.ts`
   - Add method group to `NativeApi` interface with typed methods

8. **WsNativeApi client**: `apps/web/src/wsNativeApi.ts`
   - Map NativeApi methods to `transport.request(WS_METHODS.xxx, input)` calls

9. **React Query helpers**: `apps/web/src/lib/reviewCommentReactQuery.ts`
   - Query keys factory
   - `queryOptions()` for list/get
   - `mutationOptions()` for create/update/delete with `onSettled` invalidation

10. **Components**: Feature-specific components in `apps/web/src/components/`
    - UI primitives from `apps/web/src/components/ui/`
    - Feature dialogs as standalone files (e.g. `CreateJiraTicketDialog.tsx`)

---

## Phase 1: Contracts + Database Migration + Repository Layer

### File 1: `packages/contracts/src/memory.ts` (NEW)

Define all memory-related schemas. Follow the pattern in `reviewComment.ts`.

```typescript
import { Schema } from "effect";
import { ProjectId, ThreadId, TrimmedNonEmptyString, TurnId } from "./baseSchemas";

// ── Domain Enums ────────────────────────────────────────────────────

export const MemoryScope = Schema.Literals(["project", "global"]);
export type MemoryScope = typeof MemoryScope.Type;

export const MemoryCategory = Schema.Literals([
  "preference",
  "pattern",
  "decision",
  "fact",
  "convention",
]);
export type MemoryCategory = typeof MemoryCategory.Type;

export const MemorySource = Schema.Literals(["auto", "manual"]);
export type MemorySource = typeof MemorySource.Type;

// ── Domain Entity ───────────────────────────────────────────────────

export const MemoryId = TrimmedNonEmptyString.pipe(Schema.brand("MemoryId"));
export type MemoryId = typeof MemoryId.Type;

export const Memory = Schema.Struct({
  memoryId: MemoryId,
  projectId: Schema.optional(ProjectId),
  scope: MemoryScope,
  category: MemoryCategory,
  source: MemorySource,
  content: TrimmedNonEmptyString,
  title: TrimmedNonEmptyString,
  sourceThreadId: Schema.optional(ThreadId),
  sourceTurnId: Schema.optional(TurnId),
  relevanceScore: Schema.Number,
  accessCount: Schema.Int,
  lastAccessedAt: Schema.optional(Schema.String),
  createdAt: Schema.String,
  updatedAt: Schema.String,
  archivedAt: Schema.optional(Schema.String),
});
export type Memory = typeof Memory.Type;

// ── WS Inputs ───────────────────────────────────────────────────────

export const MemoryCreateInput = Schema.Struct({
  projectId: Schema.optional(ProjectId),
  scope: MemoryScope,
  category: MemoryCategory,
  content: TrimmedNonEmptyString,
  title: TrimmedNonEmptyString,
  sourceThreadId: Schema.optional(ThreadId),
  sourceTurnId: Schema.optional(TurnId),
});
export type MemoryCreateInput = typeof MemoryCreateInput.Type;

export const MemoryUpdateInput = Schema.Struct({
  memoryId: MemoryId,
  content: Schema.optional(TrimmedNonEmptyString),
  title: Schema.optional(TrimmedNonEmptyString),
  category: Schema.optional(MemoryCategory),
  relevanceScore: Schema.optional(Schema.Number),
});
export type MemoryUpdateInput = typeof MemoryUpdateInput.Type;

export const MemoryArchiveInput = Schema.Struct({
  memoryId: MemoryId,
});
export type MemoryArchiveInput = typeof MemoryArchiveInput.Type;

export const MemoryDeleteInput = Schema.Struct({
  memoryId: MemoryId,
});
export type MemoryDeleteInput = typeof MemoryDeleteInput.Type;

export const MemoryListInput = Schema.Struct({
  projectId: ProjectId,
  includeGlobal: Schema.optional(Schema.Boolean), // default true
  includeArchived: Schema.optional(Schema.Boolean), // default false
  category: Schema.optional(MemoryCategory),
  limit: Schema.optional(Schema.Int),
  offset: Schema.optional(Schema.Int),
});
export type MemoryListInput = typeof MemoryListInput.Type;

export const MemorySearchInput = Schema.Struct({
  query: TrimmedNonEmptyString,
  projectId: Schema.optional(ProjectId),
  category: Schema.optional(MemoryCategory),
  limit: Schema.optional(Schema.Int),
});
export type MemorySearchInput = typeof MemorySearchInput.Type;

export const MemoryGetForThreadInput = Schema.Struct({
  threadId: ThreadId,
  projectId: ProjectId,
  query: Schema.optional(TrimmedNonEmptyString),
  limit: Schema.optional(Schema.Int),
});
export type MemoryGetForThreadInput = typeof MemoryGetForThreadInput.Type;

// ── WS Results ──────────────────────────────────────────────────────

export const MemoryCreateResult = Schema.Struct({
  memory: Memory,
});
export type MemoryCreateResult = typeof MemoryCreateResult.Type;

export const MemoryListResult = Schema.Struct({
  memories: Schema.Array(Memory),
  total: Schema.Int,
});
export type MemoryListResult = typeof MemoryListResult.Type;

export const MemorySearchResult = Schema.Struct({
  memories: Schema.Array(Memory),
});
export type MemorySearchResult = typeof MemorySearchResult.Type;
```

**Key decisions:**

- `MemoryId` gets its own branded type (consistent with `ThreadId`, `ProjectId`, etc.)
- `TurnId` is already exported from `baseSchemas.ts` -- use it for `sourceTurnId`
- `source` field is always `"manual"` for WS-created memories; auto-extraction sets `"auto"`

### File 2: `packages/contracts/src/index.ts` (EDIT)

Add `export * from "./memory";` to the barrel export.

### File 3: `packages/contracts/src/ws.ts` (EDIT)

**Add to `WS_METHODS` object:**

```typescript
// Memory methods
memoryList: "memory.list",
memorySearch: "memory.search",
memoryCreate: "memory.create",
memoryUpdate: "memory.update",
memoryArchive: "memory.archive",
memoryDelete: "memory.delete",
memoryGetForThread: "memory.getForThread",
```

**Add to imports** (from `./memory`):

```typescript
import {
  MemoryCreateInput,
  MemoryUpdateInput,
  MemoryArchiveInput,
  MemoryDeleteInput,
  MemoryListInput,
  MemorySearchInput,
  MemoryGetForThreadInput,
} from "./memory";
```

**Add to `WebSocketRequestBody` union** (7 new `tagRequestBody` entries):

```typescript
tagRequestBody(WS_METHODS.memoryList, MemoryListInput),
tagRequestBody(WS_METHODS.memorySearch, MemorySearchInput),
tagRequestBody(WS_METHODS.memoryCreate, MemoryCreateInput),
tagRequestBody(WS_METHODS.memoryUpdate, MemoryUpdateInput),
tagRequestBody(WS_METHODS.memoryArchive, MemoryArchiveInput),
tagRequestBody(WS_METHODS.memoryDelete, MemoryDeleteInput),
tagRequestBody(WS_METHODS.memoryGetForThread, MemoryGetForThreadInput),
```

### File 4: `packages/contracts/src/ipc.ts` (EDIT)

**Add to `NativeApi` interface:**

```typescript
memory: {
  list: (input: MemoryListInput) => Promise<MemoryListResult>;
  search: (input: MemorySearchInput) => Promise<MemorySearchResult>;
  create: (input: MemoryCreateInput) => Promise<MemoryCreateResult>;
  update: (input: MemoryUpdateInput) => Promise<void>;
  archive: (input: MemoryArchiveInput) => Promise<void>;
  delete: (input: MemoryDeleteInput) => Promise<void>;
  getForThread: (input: MemoryGetForThreadInput) => Promise<MemorySearchResult>;
};
```

Add the required type imports from `./memory`.

### File 5: `apps/server/src/persistence/Migrations/019_Memories.ts` (NEW)

Follow pattern from `016_ReviewComments.ts` and `005_Projections.ts`.

```typescript
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_memories (
      memory_id TEXT PRIMARY KEY,
      project_id TEXT,
      scope TEXT NOT NULL CHECK (scope IN ('project', 'global')),
      category TEXT NOT NULL CHECK (category IN ('preference', 'pattern', 'decision', 'fact', 'convention')),
      source TEXT NOT NULL CHECK (source IN ('auto', 'manual')),
      content TEXT NOT NULL,
      title TEXT NOT NULL,
      source_thread_id TEXT,
      source_turn_id TEXT,
      relevance_score REAL NOT NULL DEFAULT 1.0,
      access_count INTEGER NOT NULL DEFAULT 0,
      last_accessed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      archived_at TEXT,
      FOREIGN KEY (project_id) REFERENCES projection_projects(project_id)
    )
  `;

  yield* sql`
    CREATE VIRTUAL TABLE IF NOT EXISTS projection_memories_fts USING fts5(
      memory_id UNINDEXED,
      title,
      content,
      category,
      content=projection_memories,
      content_rowid=rowid
    )
  `;

  yield* sql`
    CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON projection_memories BEGIN
      INSERT INTO projection_memories_fts(rowid, memory_id, title, content, category)
      VALUES (new.rowid, new.memory_id, new.title, new.content, new.category);
    END
  `;

  yield* sql`
    CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON projection_memories BEGIN
      INSERT INTO projection_memories_fts(projection_memories_fts, rowid, memory_id, title, content, category)
      VALUES ('delete', old.rowid, old.memory_id, old.title, old.content, old.category);
    END
  `;

  yield* sql`
    CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON projection_memories BEGIN
      INSERT INTO projection_memories_fts(projection_memories_fts, rowid, memory_id, title, content, category)
      VALUES ('delete', old.rowid, old.memory_id, old.title, old.content, old.category);
      INSERT INTO projection_memories_fts(rowid, memory_id, title, content, category)
      VALUES (new.rowid, new.memory_id, new.title, new.content, new.category);
    END
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_memories_project
    ON projection_memories(project_id) WHERE project_id IS NOT NULL
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_memories_scope
    ON projection_memories(scope)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_memories_archived
    ON projection_memories(archived_at)
  `;
});
```

### File 6: `apps/server/src/persistence/Migrations.ts` (EDIT)

Add the import and registration:

```typescript
import Migration0019 from "./Migrations/019_Memories.ts";
```

Add to `Migrator.fromRecord`:

```typescript
"19_Memories": Migration0019,
```

### File 7: `apps/server/src/persistence/Services/MemoryRepository.ts` (NEW)

Follow pattern from `Services/ReviewCommentRepository.ts`.

```typescript
/**
 * MemoryRepository - Repository interface for memory entries.
 *
 * Owns persistence operations for user/auto-extracted memory entries.
 * Supports full-text search via FTS5 and scoped retrieval.
 *
 * @module MemoryRepository
 */
import type {
  Memory,
  MemoryCreateInput,
  MemoryUpdateInput,
  MemoryArchiveInput,
  MemoryDeleteInput,
  MemoryListInput,
  MemoryListResult,
  MemorySearchInput,
  MemoryGetForThreadInput,
} from "@t3tools/contracts";
import { ServiceMap } from "effect";
import type { Effect } from "effect";

import type { PersistenceSqlError, PersistenceDecodeError } from "../Errors.ts";

export type MemoryRepositoryError = PersistenceSqlError | PersistenceDecodeError;

export interface MemoryRepositoryShape {
  readonly create: (input: MemoryCreateInput) => Effect.Effect<Memory, MemoryRepositoryError>;

  readonly update: (input: MemoryUpdateInput) => Effect.Effect<void, MemoryRepositoryError>;

  readonly archive: (input: MemoryArchiveInput) => Effect.Effect<void, MemoryRepositoryError>;

  readonly delete: (input: MemoryDeleteInput) => Effect.Effect<void, MemoryRepositoryError>;

  readonly findById: (memoryId: string) => Effect.Effect<Memory | null, MemoryRepositoryError>;

  readonly listByProject: (
    input: MemoryListInput,
  ) => Effect.Effect<MemoryListResult, MemoryRepositoryError>;

  readonly search: (
    input: MemorySearchInput,
  ) => Effect.Effect<ReadonlyArray<Memory>, MemoryRepositoryError>;

  readonly getRelevantForThread: (
    input: MemoryGetForThreadInput,
  ) => Effect.Effect<ReadonlyArray<Memory>, MemoryRepositoryError>;

  readonly recordAccess: (memoryId: string) => Effect.Effect<void, MemoryRepositoryError>;
}

export class MemoryRepository extends ServiceMap.Service<MemoryRepository, MemoryRepositoryShape>()(
  "t3/persistence/Services/MemoryRepository",
) {}
```

### File 8: `apps/server/src/persistence/Layers/MemoryRepository.ts` (NEW)

Follow pattern from `Layers/ReviewCommentRepository.ts`. Key implementation notes:

- **DB row schema**: Map all columns from snake_case to camelCase via SQL `AS` aliases
- **create**: Generate `memoryId` via `crypto.randomUUID()`, set `source: "manual"` for WS-created entries, timestamps as `new Date().toISOString()`
- **listByProject**: Filter by `project_id = ? OR scope = 'global'`, respect `includeArchived`, `category`, `limit`/`offset`. Return `total` via a `COUNT(*)` subquery.
- **search**: Join against `projection_memories_fts` using `MATCH ?`, rank by `bm25()`. Filter by `projectId` and `category` if provided. Auto-filter out archived entries.
- **getRelevantForThread**: Combine FTS5 search (if `query` provided) with project-scoped memories, ordered by `relevance_score * recency_factor`. The recency factor can be computed as `1.0 / (1.0 + julianday('now') - julianday(last_accessed_at))`. Limit default: 10.
- **recordAccess**: `UPDATE projection_memories SET access_count = access_count + 1, last_accessed_at = ? WHERE memory_id = ?`

Export: `export const MemoryRepositoryLive = Layer.effect(MemoryRepository, makeMemoryRepository);`

### File 9: `apps/server/src/persistence/Errors.ts` (EDIT)

Add the error type alias (at bottom, near existing aliases):

```typescript
export type MemoryRepositoryError = PersistenceSqlError | PersistenceDecodeError;
```

_(This is optional since the Service file defines its own, but keeps it consistent with `OrchestrationEventStoreError` etc.)_

---

## Phase 2: Memory Service + WebSocket Endpoints

### File 10: `apps/server/src/serverLayers.ts` (EDIT)

**Add imports:**

```typescript
import { MemoryRepositoryLive } from "./persistence/Layers/MemoryRepository";
```

**Add to `makeServerRuntimeServicesLayer()` final `Layer.mergeAll`:**

```typescript
MemoryRepositoryLive,
```

### File 11: `apps/server/src/wsServer.ts` (EDIT)

**Add import:**

```typescript
import { MemoryRepository } from "./persistence/Services/MemoryRepository.ts";
```

**Add to `ServerRuntimeServices` type union:**

```typescript
| MemoryRepository
```

**Add to `createServer` service resolution (near `reviewCommentRepo`):**

```typescript
const memoryRepo = yield * MemoryRepository;
```

**Add case handlers in `routeRequest` switch** (before the default/exhaustive check):

```typescript
case WS_METHODS.memoryCreate: {
  const body = stripRequestTag(request.body);
  const memory = yield* memoryRepo.create(body);
  return { memory };
}

case WS_METHODS.memoryUpdate: {
  const body = stripRequestTag(request.body);
  yield* memoryRepo.update(body);
  return {};
}

case WS_METHODS.memoryArchive: {
  const body = stripRequestTag(request.body);
  yield* memoryRepo.archive(body);
  return {};
}

case WS_METHODS.memoryDelete: {
  const body = stripRequestTag(request.body);
  yield* memoryRepo.delete(body);
  return {};
}

case WS_METHODS.memoryList: {
  const body = stripRequestTag(request.body);
  return yield* memoryRepo.listByProject(body);
}

case WS_METHODS.memorySearch: {
  const body = stripRequestTag(request.body);
  const memories = yield* memoryRepo.search(body);
  return { memories };
}

case WS_METHODS.memoryGetForThread: {
  const body = stripRequestTag(request.body);
  const memories = yield* memoryRepo.getRelevantForThread(body);
  return { memories };
}
```

### File 12: `apps/web/src/wsNativeApi.ts` (EDIT)

**Add to `api` object:**

```typescript
memory: {
  list: (input) => transport.request(WS_METHODS.memoryList, input),
  search: (input) => transport.request(WS_METHODS.memorySearch, input),
  create: (input) => transport.request(WS_METHODS.memoryCreate, input),
  update: (input) => transport.request(WS_METHODS.memoryUpdate, input),
  archive: (input) => transport.request(WS_METHODS.memoryArchive, input),
  delete: (input) => transport.request(WS_METHODS.memoryDelete, input),
  getForThread: (input) => transport.request(WS_METHODS.memoryGetForThread, input),
},
```

---

## Phase 3: Web UI - React Query Hooks

### File 13: `apps/web/src/lib/memoryReactQuery.ts` (NEW)

Follow the pattern of `reviewCommentReactQuery.ts`:

```typescript
import type {
  MemoryCategory,
  MemoryCreateInput,
  MemoryScope,
  MemoryUpdateInput,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import { mutationOptions, queryOptions, type QueryClient } from "@tanstack/react-query";
import { ensureNativeApi } from "../nativeApi";

export const memoryQueryKeys = {
  all: ["memories"] as const,
  list: (projectId: ProjectId | null) => ["memories", "list", projectId] as const,
  search: (query: string, projectId?: ProjectId) =>
    ["memories", "search", query, projectId] as const,
  forThread: (threadId: ThreadId | null, projectId: ProjectId | null) =>
    ["memories", "forThread", threadId, projectId] as const,
};

export function invalidateMemoryQueries(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ queryKey: memoryQueryKeys.all });
}

export function memoryListQueryOptions(
  projectId: ProjectId | null,
  opts?: { category?: MemoryCategory; includeArchived?: boolean },
) {
  return queryOptions({
    queryKey: [...memoryQueryKeys.list(projectId), opts?.category, opts?.includeArchived],
    queryFn: async () => {
      const api = ensureNativeApi();
      if (!projectId) throw new Error("Project ID is required.");
      return api.memory.list({
        projectId,
        includeGlobal: true,
        includeArchived: opts?.includeArchived,
        category: opts?.category,
      });
    },
    enabled: projectId !== null,
    staleTime: 10_000,
  });
}

export function memorySearchQueryOptions(query: string, projectId?: ProjectId) {
  return queryOptions({
    queryKey: memoryQueryKeys.search(query, projectId),
    queryFn: async () => {
      const api = ensureNativeApi();
      return api.memory.search({ query, projectId });
    },
    enabled: query.length > 0,
    staleTime: 5_000,
  });
}

export function memoryForThreadQueryOptions(
  threadId: ThreadId | null,
  projectId: ProjectId | null,
) {
  return queryOptions({
    queryKey: memoryQueryKeys.forThread(threadId, projectId),
    queryFn: async () => {
      const api = ensureNativeApi();
      if (!threadId || !projectId) throw new Error("Thread and Project ID required.");
      return api.memory.getForThread({ threadId, projectId });
    },
    enabled: threadId !== null && projectId !== null,
    staleTime: 30_000,
  });
}

export function memoryCreateMutationOptions(queryClient: QueryClient) {
  return mutationOptions({
    mutationKey: ["memories", "mutation", "create"] as const,
    mutationFn: async (input: MemoryCreateInput) => {
      const api = ensureNativeApi();
      return api.memory.create(input);
    },
    onSettled: async () => {
      await invalidateMemoryQueries(queryClient);
    },
  });
}

export function memoryUpdateMutationOptions(queryClient: QueryClient) {
  return mutationOptions({
    mutationKey: ["memories", "mutation", "update"] as const,
    mutationFn: async (input: MemoryUpdateInput) => {
      const api = ensureNativeApi();
      return api.memory.update(input);
    },
    onSettled: async () => {
      await invalidateMemoryQueries(queryClient);
    },
  });
}

export function memoryArchiveMutationOptions(queryClient: QueryClient) {
  return mutationOptions({
    mutationKey: ["memories", "mutation", "archive"] as const,
    mutationFn: async (memoryId: string) => {
      const api = ensureNativeApi();
      return api.memory.archive({ memoryId });
    },
    onSettled: async () => {
      await invalidateMemoryQueries(queryClient);
    },
  });
}

export function memoryDeleteMutationOptions(queryClient: QueryClient) {
  return mutationOptions({
    mutationKey: ["memories", "mutation", "delete"] as const,
    mutationFn: async (memoryId: string) => {
      const api = ensureNativeApi();
      return api.memory.delete({ memoryId });
    },
    onSettled: async () => {
      await invalidateMemoryQueries(queryClient);
    },
  });
}
```

---

## Phase 4: Web UI Components

### File 14: `apps/web/src/components/MemoryPanel.tsx` (NEW)

Side panel component for managing project memories. Structure:

- **Header**: Title "Memories" + search input + "Add Memory" button
- **Filter bar**: Category filter chips (all / preference / pattern / decision / fact / convention) + scope toggle (project / global / all)
- **Memory list**: Scrollable list of `MemoryItem` components
- **Empty state**: Prompt to create first memory or explain auto-extraction

Uses `memoryListQueryOptions` to fetch data. Debounced search via `memorySearchQueryOptions`.

### File 15: `apps/web/src/components/MemoryItem.tsx` (NEW)

Individual memory card. Structure:

- **Title** + category badge (colored by category)
- **Content** text (truncated, expandable)
- **Metadata row**: scope badge, source badge (auto/manual), age, access count
- **Actions**: Edit (opens `MemoryEditDialog`), Archive, Delete (with confirmation via `AlertDialog`)

Uses `memoryUpdateMutationOptions`, `memoryArchiveMutationOptions`, `memoryDeleteMutationOptions`.

### File 16: `apps/web/src/components/MemoryCreateDialog.tsx` (NEW)

Dialog form for creating a memory. Fields:

- **Title**: Text input (required)
- **Content**: Textarea (required)
- **Category**: Select dropdown
- **Scope**: Radio group (project / global)

Uses `memoryCreateMutationOptions`. Auto-sets `scope: "project"` when opened from a project context.

### File 17: `apps/web/src/components/MemoryBadge.tsx` (NEW)

Small badge/indicator for the thread header showing number of active memories for the current thread context. Clicking opens the `MemoryPanel`.

Uses `memoryForThreadQueryOptions` with the current thread's `threadId` + `projectId`.

### File 18: `apps/web/src/components/Sidebar.tsx` (EDIT)

Add a "Memories" link/button in the sidebar footer or settings area that opens the `MemoryPanel` in a sheet/drawer. Could be placed near the existing settings/notification area in `SidebarFooter`.

### File 19: `apps/web/src/components/chat/ChatHeader.tsx` (EDIT)

Add `MemoryBadge` next to existing header controls. Show memory count for the active thread.

---

## Phase 5: Auto-Extraction from Completed Turns

### File 20: `apps/server/src/memory/Services/MemoryExtractor.ts` (NEW)

Service interface for extracting memories from turn messages.

```typescript
export interface MemoryExtractorShape {
  readonly extractFromTurn: (params: {
    threadId: ThreadId;
    turnId: TurnId;
    projectId: ProjectId;
    messages: ReadonlyArray<{ role: string; text: string }>;
  }) => Effect.Effect<ReadonlyArray<MemoryCreateInput>, never>;
}

export class MemoryExtractor extends ServiceMap.Service<MemoryExtractor, MemoryExtractorShape>()(
  "t3/memory/Services/MemoryExtractor",
) {}
```

### File 21: `apps/server/src/memory/Layers/MemoryExtractor.ts` (NEW)

Rule-based extraction logic (no LLM dependency for Phase 1):

1. **Explicit markers**: Scan user messages for phrases like "remember this", "note that", "always do X", "convention:", "decision:" -- extract the subsequent content as a memory.
2. **Code convention patterns**: Detect patterns like "we use X for Y", "the project uses Z", "our naming convention is".
3. **Build/test commands**: Detect successful `bun run`, `npm run`, tool invocations mentioned in assistant messages with positive outcomes.
4. **Architecture decisions**: Detect "I chose X over Y because", "the reason for X is".

For each extracted candidate:

- Set `source: "auto"`
- Set `sourceThreadId` and `sourceTurnId`
- Set `category` based on detection heuristic
- Auto-generate a concise title from the content
- Perform deduplication check via `memoryRepo.search` using the title/content as query -- skip if FTS5 returns a high-similarity existing match

### File 22: Integration hook in orchestration reactor

In `apps/server/src/orchestration/Layers/OrchestrationReactor.ts` or a new reactor layer:

- After a `thread.turn.completed` event is processed, fork a low-priority fiber that:
  1. Fetches the turn's messages from the projection
  2. Calls `MemoryExtractor.extractFromTurn`
  3. Inserts extracted memories via `MemoryRepository.create`

This is non-blocking -- extraction failures should be logged but never block the turn completion flow.

---

## Phase 6: Context Injection into Thread Turns (Future)

### Approach

When a turn is started:

1. Query `MemoryRepository.getRelevantForThread` with the project context
2. Format memories as a system context block:
   ```
   [Active Memories]
   - [convention] Use camelCase for variable names
   - [decision] Chose Effect-TS over fp-ts for error handling
   ```
3. Prepend to the user message or inject as a system context parameter

**Integration point**: `apps/server/src/wsServer.ts` in the `normalizeDispatchCommand` function, specifically for `thread.turn.start` commands. Before dispatching, inject relevant memories into the message context.

**Important**: This phase requires careful design to avoid:

- Injecting too many memories (token budget)
- Injecting stale/irrelevant memories
- Creating feedback loops (memory about memory)

Defer this to a follow-up iteration once Phase 1-5 are validated.

---

## Risk Assessment

### Technical Risks

1. **FTS5 virtual table limitations**: SQLite FTS5 requires special trigger-based sync for content tables. The migration must create all triggers atomically or risk orphaned FTS entries.
   - **Mitigation**: Use `IF NOT EXISTS` guards. Test migration on a fresh DB and an existing DB with data.

2. **FTS5 query syntax injection**: User-provided search queries must be sanitized before being passed to FTS5 `MATCH`.
   - **Mitigation**: Escape special FTS5 characters (`"`, `*`, `OR`, `AND`, `NOT`, `NEAR`, `(`, `)`) in the repository layer before constructing the MATCH query.

3. **Auto-extraction false positives**: Rule-based extraction may create too many low-quality memories.
   - **Mitigation**: Start conservative -- only extract on explicit user markers in Phase 1. Expand patterns gradually.

4. **Performance of FTS5 search on large memory sets**: Unlikely to be an issue at T3 Code's current scale, but could become relevant.
   - **Mitigation**: Default limit of 20 results per search. Index on `project_id`.

5. **Schema migration on existing databases**: Users upgrading from v18 must get the new table and FTS5 virtual table.
   - **Mitigation**: The migration runner handles this automatically via the existing `Migrator.fromRecord` system.

### Dependency Risks

- No external dependencies required. All functionality uses existing SQLite FTS5 (built into `node:sqlite`) and existing Effect-TS patterns.

---

## Acceptance Criteria

### Functional Requirements

- [ ] Users can create, edit, archive, and delete memory entries via the web UI
- [ ] Memories are scoped to projects or globally
- [ ] Full-text search across memory title and content works
- [ ] Memory entries have categories and can be filtered by category
- [ ] The memory panel shows relevant memories for the current project
- [ ] The thread header shows a memory badge with count of relevant memories
- [ ] Auto-extraction creates memories from explicit user markers ("remember this", etc.)
- [ ] Auto-extracted memories have provenance (source thread/turn IDs)
- [ ] Archived memories are hidden by default but can be shown

### Quality Standards

- [ ] `bun fmt`, `bun lint`, and `bun typecheck` pass
- [ ] Unit tests for repository layer (at minimum: create, list, search, archive, delete)
- [ ] Unit tests for auto-extraction pattern matching
- [ ] Migration is idempotent (uses `IF NOT EXISTS`)

### Performance Requirements

- [ ] Memory list query completes in <50ms for up to 1000 entries
- [ ] FTS5 search query completes in <100ms
- [ ] Auto-extraction does not block turn completion

---

## Implementation Order Summary

| Phase                          | Files       | Agent   | Estimated Complexity |
| ------------------------------ | ----------- | ------- | -------------------- |
| 1. Contracts + DB + Repository | Files 1-9   | Builder | Medium               |
| 2. WS Endpoints                | Files 10-12 | Builder | Low                  |
| 3. React Query Hooks           | File 13     | Builder | Low                  |
| 4. Web UI Components           | Files 14-19 | Builder | Medium-High          |
| 5. Auto-Extraction             | Files 20-22 | Builder | Medium               |
| 6. Context Injection           | Future      | Builder | High (defer)         |

**Total estimated files**: 14 new files, 8 edited files
**Recommended execution**: Phases 1-3 as a single PR, Phase 4 as a second PR, Phase 5 as a third PR.
