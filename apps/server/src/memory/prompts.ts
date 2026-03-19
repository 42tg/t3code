/**
 * Prompt templates and JSON schemas for memory extraction LLM calls.
 *
 * @module memory/prompts
 */

// ── JSON Schemas for structured output ─────────────────────────────

export const PROJECT_EXTRACTION_SCHEMA = {
  type: "object",
  properties: {
    memories: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string", description: "Concise title (under 80 chars)" },
          content: { type: "string", description: "Specific, actionable detail (1-3 sentences)" },
          category: {
            type: "string",
            enum: ["preference", "pattern", "decision", "fact", "convention"],
          },
        },
        required: ["title", "content", "category"],
      },
    },
  },
  required: ["memories"],
} as const;

export const DAILY_SUMMARY_SCHEMA = {
  type: "object",
  properties: {
    entries: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string", description: "Daily summary title" },
          content: { type: "string", description: "2-5 bullet points of what was accomplished" },
          /** Omit for the global summary entry. */
          projectTitle: { type: "string", description: "Project name this entry belongs to" },
        },
        required: ["title", "content"],
      },
    },
  },
  required: ["entries"],
} as const;

// ── System prompts ─────────────────────────────────────────────────

export const PROJECT_EXTRACTION_SYSTEM_PROMPT = `You extract actionable development knowledge from conversations. These memories will be injected into AI agent context in future sessions, so quality matters more than quantity.

Categories:
- "decision": An explicit choice between alternatives WITH rationale. E.g. "Chose SQLite over Postgres for local persistence — no external deps needed for desktop app"
- "convention": A specific rule that must be followed. E.g. "Prefix projection tables with projection_", "Use Effect.catchCause not Effect.catchAll in this Effect version"
- "pattern": A non-obvious implementation approach. E.g. "Use for...of with yield* in Effect.gen, not Effect.forEach for loops with side effects"
- "preference": A team/personal preference about workflow. E.g. "Prefer single bundled PRs for refactors over many small ones"
- "fact": A non-obvious fact that would cause bugs if unknown. E.g. "SQLite FTS5 requires trigger-based sync for content tables"

Quality bar — ONLY extract knowledge that:
1. Would CHANGE how an agent works on this project (not just describe what exists)
2. Is NOT derivable by reading the code (the agent can already do that)
3. Is ACTIONABLE — tells you what to do or avoid, not just what something is
4. Is NON-OBVIOUS — an experienced developer wouldn't already know this

BAD examples (do NOT extract these):
- "The project uses strict TypeScript" (obvious from tsconfig)
- "The API is minimal" (agent can see the code)
- "Architecture is documented in CLAUDE.md" (agent already reads CLAUDE.md)
- Descriptions of what code does (the code itself is the source of truth)

GOOD examples:
- "Module Federation names cannot contain hyphens — rspack treats them as JS variables"
- "Effect.catchAll does not exist in this Effect version — use Effect.catch instead"
- "Playwright E2E tests must use the isolated Hono server pattern in examples/*/e2e.test.ts"

Rules:
- Maximum 5 memories per extraction — prefer fewer high-quality over many low-quality
- Each memory must be self-contained with enough context to act on
- Title: imperative phrase (under 80 chars)
- Content: 1-3 sentences of specific, actionable detail
- Return empty array if no knowledge meets the quality bar
- Do NOT produce near-duplicate entries`;

export const DAILY_SUMMARY_SYSTEM_PROMPT = `You produce concise daily work summaries for a software developer.
Your output will be captured as structured JSON automatically.

Rules:
- Produce one entry per project that had activity (set projectTitle to the project name)
- Also produce one overall entry summarizing ALL projects (omit projectTitle for this one)
- Title format for project entries: "{date} - {project}: {brief summary}"
- Title format for overall entry: "{date} - Overall: {brief summary}"
- Content: 2-5 bullet points of what was accomplished (use "- " prefix for bullets)
- Be specific — mention features, files, components, or bug fixes worked on
- Focus on outcomes (what was done), not process (how it was done)
- If a project had minimal activity, keep it to 1-2 bullets`;

// ── Thread Summary ────────────────────────────────────────────────

export const THREAD_SUMMARY_SCHEMA = {
  type: "object",
  properties: {
    title: {
      type: "string",
      description: "Concise outcome summary (under 80 chars)",
    },
    content: {
      type: "string",
      description: "Outcome-focused summary, 3-5 sentences",
    },
  },
  required: ["title", "content"],
} as const;

export const THREAD_SUMMARY_SYSTEM_PROMPT = `You summarize software development conversation threads into concise outcome-focused summaries.
Your output will be captured as structured JSON automatically.

Rules:
- Focus on OUTCOMES: what was accomplished, what changed, what was decided
- Mention specific files, components, features, or bugs that were worked on
- Note the final status: completed, in progress, blocked, or abandoned
- Include key decisions made during the conversation
- 3-5 sentences for the content field
- Title: concise outcome phrase (under 80 chars), e.g. "Added memory extraction with Claude Haiku"
- Do NOT describe the conversation process — describe the RESULT`;

export function buildThreadSummaryPrompt(
  threadTitle: string,
  messages: readonly { role: string; text: string }[],
  checkpointFiles?: readonly { path: string; kind: string }[],
): string {
  const parts: string[] = [
    `Thread: ${threadTitle}\n\nSummarize the outcome of this conversation.\n`,
  ];

  if (checkpointFiles && checkpointFiles.length > 0) {
    parts.push(`\nFiles changed: ${checkpointFiles.map((f) => f.path).join(", ")}\n`);
  }

  const formatted = messages.map((m) => `[${m.role}]: ${m.text}`).join("\n\n");
  // Cap at 30k chars to leave room for system prompt
  const truncated =
    formatted.length > 30_000 ? formatted.slice(0, 30_000) + "\n\n[... truncated ...]" : formatted;

  parts.push(`\n${truncated}`);
  return parts.join("");
}

// ── Prompt builders ────────────────────────────────────────────────

import type { ThreadTranscript } from "./threadTranscript.ts";

const MAX_PROMPT_CHARS = 40_000;

function formatMessages(messages: readonly { role: string; text: string }[]): string {
  return messages.map((m) => `[${m.role}]: ${m.text}`).join("\n\n");
}

function truncateToLimit(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return text.slice(0, limit) + "\n\n[... truncated ...]";
}

export function buildProjectExtractionPrompt(
  projectTitle: string,
  threads: readonly ThreadTranscript[],
): string {
  const parts: string[] = [
    `Project: ${projectTitle}\n\nBelow are recent conversation threads. Extract durable project knowledge.\n`,
  ];

  let totalChars = parts[0]!.length;

  for (const thread of threads) {
    const formatted = formatMessages(thread.messages);
    const block = `\n--- THREAD: ${thread.threadTitle} ---\n${formatted}\n--- END THREAD ---\n`;

    if (totalChars + block.length > MAX_PROMPT_CHARS) {
      const remaining = MAX_PROMPT_CHARS - totalChars;
      if (remaining > 200) {
        parts.push(truncateToLimit(block, remaining));
      }
      break;
    }

    parts.push(block);
    totalChars += block.length;
  }

  return parts.join("");
}

export function buildDailySummaryPrompt(
  projectSummaries: readonly { projectTitle: string; threadTitles: string[] }[],
  date: string,
  existingDailySummaries?: readonly { title: string; content: string }[],
): string {
  const parts: string[] = [`Date: ${date}\n\nProjects with activity today:\n`];

  for (const project of projectSummaries) {
    parts.push(`\n--- Project: ${project.projectTitle} ---`);
    parts.push(`Thread topics: ${project.threadTitles.join(", ")}`);
    parts.push(`--- End Project ---\n`);
  }

  if (existingDailySummaries && existingDailySummaries.length > 0) {
    parts.push(`\n--- Earlier summaries from today (incorporate and build on these) ---`);
    for (const existing of existingDailySummaries) {
      parts.push(`\nTitle: ${existing.title}`);
      parts.push(`Content: ${existing.content}`);
    }
    parts.push(`--- End earlier summaries ---\n`);
  }

  parts.push(
    `\nProduce a COMPLETE daily summary entry for each project listed above, plus one overall daily entry summarizing all projects. Incorporate any earlier summaries from today — combine them with the new activity into a single comprehensive summary per project.`,
  );

  return parts.join("\n");
}
