/**
 * Converts provider tool `args` from an approval request into a renderable
 * diff result.  The function is intentionally defensive -- unknown or
 * malformed payloads gracefully fall back to `{ kind: "unknown" }`.
 */

// ---------------------------------------------------------------------------
// Public result type
// ---------------------------------------------------------------------------

export type ApprovalDiffResult =
  | { kind: "diff"; patch: string; filePath: string }
  | { kind: "command"; command: string; detail?: string }
  | { kind: "file-read"; filePath: string }
  | { kind: "unknown" };

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export function toolArgsToDiff(
  args: unknown,
  requestKind: "command" | "file-read" | "file-change",
): ApprovalDiffResult {
  if (args == null || typeof args !== "object") {
    return { kind: "unknown" };
  }

  const record = args as Record<string, unknown>;

  // Claude Code adapter shape: { toolName, input, toolUseId? }
  if (typeof record.toolName === "string" && record.input != null) {
    return fromClaudeCodeArgs(record.toolName, record.input, requestKind);
  }

  // Codex adapter: raw payload – attempt to detect common shapes
  return fromRawPayload(record, requestKind);
}

// ---------------------------------------------------------------------------
// Claude Code adapter
// ---------------------------------------------------------------------------

function fromClaudeCodeArgs(
  toolName: string,
  input: unknown,
  requestKind: "command" | "file-read" | "file-change",
): ApprovalDiffResult {
  if (input == null || typeof input !== "object") {
    return { kind: "unknown" };
  }
  const inp = input as Record<string, unknown>;

  // Edit tool: { file_path, old_string, new_string }
  if (
    typeof inp.file_path === "string" &&
    typeof inp.old_string === "string" &&
    typeof inp.new_string === "string"
  ) {
    return {
      kind: "diff",
      patch: generateEditDiff(inp.file_path, inp.old_string, inp.new_string),
      filePath: inp.file_path,
    };
  }

  // Write tool: { file_path, content }
  if (typeof inp.file_path === "string" && typeof inp.content === "string") {
    return {
      kind: "diff",
      patch: generateNewFileDiff(inp.file_path, inp.content),
      filePath: inp.file_path,
    };
  }

  // Bash / command tool: { command }
  if (typeof inp.command === "string") {
    const result: ApprovalDiffResult = { kind: "command", command: inp.command };
    if (typeof inp.description === "string") {
      result.detail = inp.description;
    }
    return result;
  }

  // File-read tool: { file_path }
  if (typeof inp.file_path === "string" && requestKind === "file-read") {
    return { kind: "file-read", filePath: inp.file_path };
  }

  // MultiEdit tool: { file_path, edits: [{ old_string, new_string }] }
  if (typeof inp.file_path === "string" && Array.isArray(inp.edits)) {
    return fromMultiEdit(inp.file_path, inp.edits);
  }

  return { kind: "unknown" };
}

// ---------------------------------------------------------------------------
// Codex / raw payload fallback
// ---------------------------------------------------------------------------

function fromRawPayload(
  record: Record<string, unknown>,
  requestKind: "command" | "file-read" | "file-change",
): ApprovalDiffResult {
  // Check for common Codex shapes
  if (typeof record.command === "string") {
    return { kind: "command", command: record.command };
  }

  if (typeof record.file_path === "string" && typeof record.content === "string") {
    return {
      kind: "diff",
      patch: generateNewFileDiff(record.file_path, record.content),
      filePath: record.file_path,
    };
  }

  if (
    typeof record.file_path === "string" &&
    typeof record.old_string === "string" &&
    typeof record.new_string === "string"
  ) {
    return {
      kind: "diff",
      patch: generateEditDiff(record.file_path, record.old_string, record.new_string),
      filePath: record.file_path,
    };
  }

  if (typeof record.file_path === "string" && requestKind === "file-read") {
    return { kind: "file-read", filePath: record.file_path };
  }

  return { kind: "unknown" };
}

// ---------------------------------------------------------------------------
// MultiEdit support
// ---------------------------------------------------------------------------

function fromMultiEdit(
  filePath: string,
  edits: unknown[],
): ApprovalDiffResult {
  const validEdits = edits.filter(
    (edit): edit is { old_string: string; new_string: string } =>
      edit != null &&
      typeof edit === "object" &&
      typeof (edit as Record<string, unknown>).old_string === "string" &&
      typeof (edit as Record<string, unknown>).new_string === "string",
  );

  if (validEdits.length === 0) {
    return { kind: "unknown" };
  }

  // Combine all edits into a single patch
  const hunks = validEdits.map((edit) => formatHunk(edit.old_string, edit.new_string));
  const patch = `--- a/${filePath}\n+++ b/${filePath}\n${hunks.join("\n")}`;
  return { kind: "diff", patch, filePath };
}

// ---------------------------------------------------------------------------
// Unified-diff generation helpers
// ---------------------------------------------------------------------------

/**
 * Generate a unified diff for an edit operation (string replacement).
 */
function generateEditDiff(
  filePath: string,
  oldString: string,
  newString: string,
): string {
  const hunk = formatHunk(oldString, newString);
  return `--- a/${filePath}\n+++ b/${filePath}\n${hunk}`;
}

/**
 * Generate a unified diff for a new-file write (all additions).
 */
function generateNewFileDiff(filePath: string, content: string): string {
  const lines = content.split("\n");
  // Omit trailing empty line from split if the file ends with a newline
  const effectiveLines =
    lines.length > 1 && lines[lines.length - 1] === "" ? lines.slice(0, -1) : lines;

  const additions = effectiveLines.map((line) => `+${line}`).join("\n");
  return `--- /dev/null\n+++ b/${filePath}\n@@ -0,0 +1,${effectiveLines.length} @@\n${additions}`;
}

/**
 * Format a single hunk from old → new text.
 */
function formatHunk(oldText: string, newText: string): string {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");

  const removals = oldLines.map((line) => `-${line}`).join("\n");
  const additions = newLines.map((line) => `+${line}`).join("\n");

  return `@@ -1,${oldLines.length} +1,${newLines.length} @@\n${removals}\n${additions}`;
}
