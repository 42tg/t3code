import {
  type MemoryCategory,
  type MemoryCreateInput,
  type MemoryExtractInput,
  MemoryId,
  type MemoryUpdateInput,
  type ProjectId,
  type ThreadId,
  TrimmedNonEmptyString,
} from "@t3tools/contracts";
import { mutationOptions, queryOptions, type QueryClient } from "@tanstack/react-query";
import { ensureNativeApi } from "../nativeApi";

const MEMORY_STALE_TIME_MS = 10_000;

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
    queryKey: [...memoryQueryKeys.list(projectId), opts?.category, opts?.includeArchived] as const,
    queryFn: async () => {
      const api = ensureNativeApi();
      if (!projectId) throw new Error("Project ID is required.");
      return api.memory.list({
        projectId,
        includeThread: true,
        includeArchived: opts?.includeArchived,
        category: opts?.category,
      });
    },
    enabled: projectId !== null,
    staleTime: MEMORY_STALE_TIME_MS,
    refetchOnWindowFocus: true,
  });
}

export function memorySearchQueryOptions(
  query: string,
  projectId?: ProjectId,
  category?: MemoryCategory,
) {
  return queryOptions({
    queryKey: [...memoryQueryKeys.search(query, projectId), category] as const,
    queryFn: async () => {
      const api = ensureNativeApi();
      return api.memory.search({
        query: TrimmedNonEmptyString.makeUnsafe(query),
        projectId,
        category,
      });
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
      return api.memory.archive({ memoryId: MemoryId.makeUnsafe(memoryId) });
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
      return api.memory.delete({ memoryId: MemoryId.makeUnsafe(memoryId) });
    },
    onSettled: async () => {
      await invalidateMemoryQueries(queryClient);
    },
  });
}

export function memoryExtractMutationOptions(queryClient: QueryClient) {
  return mutationOptions({
    mutationKey: ["memories", "mutation", "extract"] as const,
    mutationFn: async (input: MemoryExtractInput) => {
      const api = ensureNativeApi();
      return api.memory.extract(input);
    },
    onSettled: async () => {
      await invalidateMemoryQueries(queryClient);
    },
  });
}
