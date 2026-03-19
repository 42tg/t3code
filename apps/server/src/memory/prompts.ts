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

export const PROJECT_EXTRACTION_SYSTEM_PROMPT = `You analyze software development conversations and extract lasting, reusable knowledge.
Your output will be captured as structured JSON automatically — just focus on the analysis.

Categories (use ALL that apply — aim for variety, not just "pattern"):
- "decision": An explicit choice made between alternatives, with rationale. E.g. "Chose SQLite over Postgres for local persistence because..."
- "convention": A naming, formatting, or structural rule the team follows. E.g. "Prefix projection tables with projection_"
- "pattern": A recurring implementation approach. E.g. "Use Effect.gen for async service methods"
- "preference": A personal or team preference about tools, style, or workflow. E.g. "Prefer single bundled PRs for refactors"
- "fact": A factual observation about the codebase, API, or environment. E.g. "SQLite FTS5 requires trigger-based sync"

Rules:
- Only extract knowledge useful in FUTURE conversations — skip debugging chatter and one-off fixes
- Each memory must be self-contained — no references to "the conversation" or "this thread"
- Title: concise imperative phrase (under 80 chars)
- Content: 1-3 sentences of specific, actionable detail with enough context to be useful standalone
- Do NOT produce near-duplicate entries — each memory must cover a distinct piece of knowledge
- If no lasting knowledge exists, return an empty memories array
- Maximum 10 memories per extraction, aim for at least 2 different categories`;

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

// ── Prompt builders ────────────────────────────────────────────────

interface ThreadTranscript {
  threadTitle: string;
  messages: readonly { role: string; text: string }[];
}

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
): string {
  const parts: string[] = [`Date: ${date}\n\nProjects with activity today:\n`];

  for (const project of projectSummaries) {
    parts.push(`\n--- Project: ${project.projectTitle} ---`);
    parts.push(`Thread topics: ${project.threadTitles.join(", ")}`);
    parts.push(`--- End Project ---\n`);
  }

  parts.push(
    `\nProduce a daily summary entry for each project listed above, plus one overall daily entry summarizing all projects.`,
  );

  return parts.join("\n");
}
