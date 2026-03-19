/**
 * MemoryExtraction layer — batch extraction of memories from conversation threads.
 *
 * Gathers threads from the orchestration read model, runs LLM summarization via
 * the Claude Agent SDK, deduplicates against existing memories, and stores results.
 *
 * @module memory/Layers/MemoryExtraction
 */
import type {
  MemoryCategory,
  MemoryDate,
  Memory,
  OrchestrationProject,
  OrchestrationThread,
  ProjectId,
  TrimmedNonEmptyString,
  NonNegativeInt,
} from "@t3tools/contracts";
import { Cause, Effect, Layer } from "effect";

import { runAgentQuery } from "../../llm/agentQuery.ts";
import { MemoryRepository } from "../../persistence/Services/MemoryRepository.ts";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";

import {
  MemoryExtraction,
  MemoryExtractionError,
  type MemoryExtractionShape,
} from "../Services/MemoryExtraction.ts";
import {
  buildProjectExtractionPrompt,
  buildDailySummaryPrompt,
  PROJECT_EXTRACTION_SCHEMA,
  PROJECT_EXTRACTION_SYSTEM_PROMPT,
  DAILY_SUMMARY_SCHEMA,
  DAILY_SUMMARY_SYSTEM_PROMPT,
} from "../prompts.ts";

// ── Types for LLM structured output ───────────────────────────────

interface ExtractedMemory {
  title: string;
  content: string;
  category: MemoryCategory;
}

interface ProjectExtractionResult {
  memories: ExtractedMemory[];
}

interface DailySummaryEntry {
  title: string;
  content: string;
  projectTitle?: string;
}

interface DailySummaryResult {
  entries: DailySummaryEntry[];
}

// ── Deduplication ─────────────────────────────────────────────────

function tokenize(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .split(/\s+/)
      .filter(Boolean),
  );
}

function jaccardSimilarity(a: string, b: string): number {
  const setA = tokenize(a);
  const setB = tokenize(b);
  if (setA.size === 0 && setB.size === 0) return 1;
  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection++;
  }
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}

// ── Parse helpers ─────────────────────────────────────────────────

const VALID_CATEGORIES = new Set<string>([
  "preference",
  "pattern",
  "decision",
  "fact",
  "convention",
]);

function parseProjectExtraction(raw: unknown): ProjectExtractionResult {
  const obj = raw as Record<string, unknown>;
  const rawMemories = Array.isArray(obj.memories) ? obj.memories : [];
  const memories: ExtractedMemory[] = [];
  for (const m of rawMemories) {
    const entry = m as Record<string, unknown>;
    if (
      typeof entry.title === "string" &&
      typeof entry.content === "string" &&
      typeof entry.category === "string" &&
      VALID_CATEGORIES.has(entry.category)
    ) {
      memories.push({
        title: entry.title,
        content: entry.content,
        category: entry.category as MemoryCategory,
      });
    }
  }
  return { memories };
}

function parseDailySummary(raw: unknown): DailySummaryResult {
  const obj = raw as Record<string, unknown>;
  const rawEntries = Array.isArray(obj.entries) ? obj.entries : [];
  const entries: DailySummaryEntry[] = [];
  for (const e of rawEntries) {
    const entry = e as Record<string, unknown>;
    if (typeof entry.title === "string" && typeof entry.content === "string") {
      entries.push({
        title: entry.title,
        content: entry.content,
        ...(typeof entry.projectTitle === "string" ? { projectTitle: entry.projectTitle } : {}),
      });
    }
  }
  return { entries };
}

import { threadToTranscript } from "../threadTranscript.ts";

// ── Layer implementation ──────────────────────────────────────────

const makeMemoryExtraction = Effect.gen(function* () {
  const memoryRepo = yield* MemoryRepository;
  const projectionQuery = yield* ProjectionSnapshotQuery;

  const extract: MemoryExtractionShape["extract"] = (input) =>
    Effect.gen(function* () {
      yield* Effect.logInfo(
        `Memory extraction started: sinceDate=${input.sinceDate}, projectId=${input.projectId ?? "all"}`,
      );

      const snapshot = yield* projectionQuery.getSnapshot();

      // 1. Filter threads updated since sinceDate
      const sinceMs = new Date(input.sinceDate).getTime();
      const filterProjectId = input.projectId;
      const relevantThreads = snapshot.threads.filter((t) => {
        if (t.deletedAt !== null) return false;
        if (new Date(t.updatedAt).getTime() < sinceMs) return false;
        if (filterProjectId && t.projectId !== filterProjectId) return false;
        if (t.messages.length === 0) return false;
        return true;
      });

      yield* Effect.logInfo(`Found ${relevantThreads.length} relevant threads`);

      // 2. Group by project
      const threadsByProject = new Map<ProjectId, OrchestrationThread[]>();
      for (const thread of relevantThreads) {
        const existing = threadsByProject.get(thread.projectId);
        if (existing) {
          existing.push(thread);
        } else {
          threadsByProject.set(thread.projectId, [thread]);
        }
      }

      const projectEntries = [...threadsByProject.entries()];

      // 3. Per-project extraction
      const projectResults = yield* Effect.forEach(projectEntries, ([projectId, threads]) =>
        Effect.gen(function* () {
          const project = snapshot.projects.find((p: OrchestrationProject) => p.id === projectId);
          if (!project) return { extracted: 0, duplicates: 0, summary: null as null };

          const transcripts = threads.map(threadToTranscript);
          const prompt = buildProjectExtractionPrompt(project.title, transcripts);

          const result = yield* runAgentQuery(
            "memoryExtraction.project",
            prompt,
            PROJECT_EXTRACTION_SCHEMA as Record<string, unknown>,
            parseProjectExtraction,
            PROJECT_EXTRACTION_SYSTEM_PROMPT,
          ).pipe(
            Effect.catch((error: unknown) =>
              Effect.logWarning(
                `LLM extraction failed for project "${project.title}": ${String(error)}`,
              ).pipe(Effect.map(() => ({ memories: [] }) as ProjectExtractionResult)),
            ),
          );

          yield* Effect.logInfo(
            `Project "${project.title}": LLM returned ${result.memories.length} memories`,
          );

          // 4. Dedup + store
          let extracted = 0;
          let duplicates = 0;
          const validMemories = result.memories.filter(
            (m) => m.title.trim().length > 0 && m.content.trim().length > 0,
          );

          // Load all existing project memories once for dedup comparison
          const existingResult = yield* memoryRepo
            .listByProject({
              projectId,
              includeThread: false,
              limit: 500 as typeof NonNegativeInt.Type,
            })
            .pipe(
              Effect.map((r) => r.memories),
              Effect.catchCause(() => Effect.succeed([] as Memory[])),
            );

          // Mutable set — also tracks memories added in this batch
          const allExisting = [...existingResult];

          for (const mem of validMemories) {
            const isDuplicate = allExisting.some((e) => {
              const titleSim = jaccardSimilarity(e.title, mem.title);
              const contentSim = jaccardSimilarity(e.content, mem.content);
              // Combined: weigh both title and content similarity
              const combined = titleSim * 0.4 + contentSim * 0.6;
              return titleSim > 0.4 || contentSim > 0.4 || combined > 0.35;
            });

            if (isDuplicate) {
              duplicates++;
              continue;
            }

            const ok = yield* memoryRepo
              .create({
                projectId,
                scope: "project",
                category: mem.category,
                source: "auto",
                title: mem.title as typeof TrimmedNonEmptyString.Type,
                content: mem.content as typeof TrimmedNonEmptyString.Type,
              })
              .pipe(
                Effect.map(() => true as const),
                Effect.catchCause((cause) =>
                  Effect.logWarning(
                    `Failed to create memory "${mem.title}": ${Cause.pretty(cause)}`,
                  ).pipe(Effect.map(() => false as const)),
                ),
              );

            if (ok) {
              extracted++;
              // Track for within-batch dedup
              allExisting.push({
                title: mem.title,
                content: mem.content,
              } as Memory);
            }
          }

          yield* Effect.logInfo(
            `Project "${project.title}": stored ${extracted}, skipped ${duplicates} duplicates`,
          );

          return {
            extracted,
            duplicates,
            summary: {
              projectId,
              projectTitle: project.title,
              threadTitles: threads.map((t) => t.title),
            },
          };
        }),
      );

      let extractedCount = 0;
      let skippedDuplicates = 0;
      const projectSummaries: {
        projectId: ProjectId;
        projectTitle: string;
        threadTitles: string[];
      }[] = [];

      for (const pr of projectResults) {
        extractedCount += pr.extracted;
        skippedDuplicates += pr.duplicates;
        if (pr.summary) projectSummaries.push(pr.summary);
      }

      // 5. Daily summary
      if (projectSummaries.length > 0) {
        const today = new Date().toISOString().slice(0, 10);

        const dailyResult = yield* runAgentQuery(
          "memoryExtraction.daily",
          buildDailySummaryPrompt(projectSummaries, today),
          DAILY_SUMMARY_SCHEMA as Record<string, unknown>,
          parseDailySummary,
          DAILY_SUMMARY_SYSTEM_PROMPT,
        ).pipe(
          Effect.catch((error: unknown) =>
            Effect.logWarning(`Daily summary LLM call failed: ${String(error)}`).pipe(
              Effect.map(() => ({ entries: [] }) as DailySummaryResult),
            ),
          ),
        );

        for (const entry of dailyResult.entries) {
          if (!entry.title.trim() || !entry.content.trim()) continue;

          const matchedProject = entry.projectTitle
            ? projectSummaries.find((p) => p.projectTitle === entry.projectTitle)
            : null;

          const ok = yield* memoryRepo
            .create({
              projectId: matchedProject?.projectId,
              scope: "daily",
              category: "fact",
              source: "auto",
              title: entry.title as typeof TrimmedNonEmptyString.Type,
              content: entry.content as typeof TrimmedNonEmptyString.Type,
              date: today as MemoryDate,
            })
            .pipe(
              Effect.map(() => true as const),
              Effect.catchCause((cause) =>
                Effect.logWarning(
                  `Failed to create daily memory "${entry.title}": ${Cause.pretty(cause)}`,
                ).pipe(Effect.map(() => false as const)),
              ),
            );

          if (ok) extractedCount++;
        }
      }

      yield* Effect.logInfo(
        `Memory extraction complete: extracted=${extractedCount}, skipped=${skippedDuplicates}, projects=${projectEntries.length}`,
      );

      return {
        extractedCount,
        skippedDuplicates,
        projectsProcessed: projectEntries.length,
      };
    }).pipe(
      Effect.mapError(
        (error) =>
          new MemoryExtractionError({
            operation: "extract",
            detail: error instanceof Error ? error.message : String(error),
            cause: error,
          }),
      ),
    );

  return { extract } satisfies MemoryExtractionShape;
});

export const MemoryExtractionLive = Layer.effect(MemoryExtraction, makeMemoryExtraction);
