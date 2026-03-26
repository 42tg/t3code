/**
 * Read and merge Claude Code settings files across all scopes.
 *
 * Claude Code uses a layered settings system with four scopes (highest to lowest precedence):
 *   1. Managed  - platform-specific system-wide path (e.g. /Library/Application Support/ClaudeCode/)
 *   2. Local    - .claude/settings.local.json in the project directory
 *   3. Project  - .claude/settings.json in the project directory
 *   4. User     - ~/.claude/settings.json
 *
 * The `env` key from managed settings wins over all other scopes and cannot be
 * overridden by users. For all other scalar/object keys, managed takes precedence.
 *
 * @module claude-settings
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// ── Public types ─────────────────────────────────────────────────────────────

export interface ClaudeSettings {
  readonly env?: Record<string, string>;
  readonly model?: string;
  readonly availableModels?: ReadonlyArray<string>;
  readonly enabledPlugins?: Record<string, unknown>;
  readonly companyAnnouncements?: ReadonlyArray<string>;
  readonly permissions?: {
    readonly allow?: ReadonlyArray<string>;
    readonly deny?: ReadonlyArray<string>;
    readonly defaultMode?: string;
    readonly disableBypassPermissionsMode?: string;
  };
}

export interface ClaudeSettingsResolutionOptions {
  /** Project working directory used to locate .claude/settings.json and .claude/settings.local.json. */
  cwd?: string;
  /** Override home directory (useful for testing). Defaults to `os.homedir()`. */
  homeDir?: string;
  /**
   * Override the managed settings file path (useful for testing).
   * Pass `null` to disable managed settings entirely.
   * Defaults to the platform-specific path returned by `getManagedSettingsPath()`.
   */
  managedSettingsPath?: string | null;
}

export interface AllClaudeSettings {
  managed?: ClaudeSettings;
  user?: ClaudeSettings;
  project?: ClaudeSettings;
  local?: ClaudeSettings;
  /**
   * Merged result with precedence: managed > local > project > user.
   * For `env`, managed vars always override everything. For arrays
   * (companyAnnouncements, permissions.allow/deny), higher-precedence scopes
   * replace lower-scope arrays entirely.
   */
  merged: ClaudeSettings;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns the platform-specific path for the managed-settings.json file.
 * Returns `undefined` on unrecognised platforms.
 */
export function getManagedSettingsPath(platform?: NodeJS.Platform): string | undefined {
  const p = platform ?? process.platform;
  switch (p) {
    case "darwin":
      return "/Library/Application Support/ClaudeCode/managed-settings.json";
    case "linux":
      return "/etc/claude-code/managed-settings.json";
    case "win32":
      return "C:\\Program Files\\ClaudeCode\\managed-settings.json";
    default:
      return undefined;
  }
}

/**
 * Read a single settings file and return its parsed contents.
 * Returns `undefined` if the file is missing, unreadable, or contains invalid JSON.
 */
export function readSettingsFile(filePath: string): ClaudeSettings | undefined {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    return parsed as ClaudeSettings;
  } catch {
    // Missing file or malformed JSON — skip silently.
    return undefined;
  }
}

/**
 * Reads all settings files and returns them individually as well as a merged view.
 *
 * Precedence order (highest to lowest): managed > local > project > user.
 */
export function readAllClaudeSettings(
  options?: ClaudeSettingsResolutionOptions,
): AllClaudeSettings {
  const home = options?.homeDir ?? os.homedir();
  const cwd = options?.cwd;
  const managedPath =
    options !== undefined && "managedSettingsPath" in options
      ? (options.managedSettingsPath ?? undefined)
      : getManagedSettingsPath();

  const managed = managedPath ? readSettingsFile(managedPath) : undefined;
  const user = readSettingsFile(path.join(home, ".claude", "settings.json"));
  const project = cwd ? readSettingsFile(path.join(cwd, ".claude", "settings.json")) : undefined;
  const local = cwd
    ? readSettingsFile(path.join(cwd, ".claude", "settings.local.json"))
    : undefined;

  const merged = mergeSettings(user, project, local, managed);

  return {
    ...(managed !== undefined ? { managed } : {}),
    ...(user !== undefined ? { user } : {}),
    ...(project !== undefined ? { project } : {}),
    ...(local !== undefined ? { local } : {}),
    merged,
  };
}

/**
 * Returns a merged `env` object from all settings scopes.
 * Managed env vars always win.
 *
 * Merge order: user < project < local < managed (later overwrites earlier).
 */
export function getMergedSettingsEnv(
  options?: ClaudeSettingsResolutionOptions,
): Record<string, string> {
  const { merged } = readAllClaudeSettings(options);
  return merged.env ?? {};
}

// ── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Merge settings from lowest to highest precedence.
 * managed wins over local wins over project wins over user.
 */
function mergeSettings(
  user?: ClaudeSettings,
  project?: ClaudeSettings,
  local?: ClaudeSettings,
  managed?: ClaudeSettings,
): ClaudeSettings {
  // Build merged env: user < project < local < managed
  const mergedEnv: Record<string, string> = {
    ...user?.env,
    ...project?.env,
    ...local?.env,
    ...managed?.env,
  };

  // Scalar/object keys: highest-precedence defined value wins.
  // We check in order: managed > local > project > user.
  const model = managed?.model ?? local?.model ?? project?.model ?? user?.model;
  const availableModels =
    managed?.availableModels ??
    local?.availableModels ??
    project?.availableModels ??
    user?.availableModels;
  const companyAnnouncements =
    managed?.companyAnnouncements ??
    local?.companyAnnouncements ??
    project?.companyAnnouncements ??
    user?.companyAnnouncements;

  // enabledPlugins: merge as an object (higher precedence keys override lower).
  const enabledPlugins: Record<string, unknown> = {
    ...user?.enabledPlugins,
    ...project?.enabledPlugins,
    ...local?.enabledPlugins,
    ...managed?.enabledPlugins,
  };

  // permissions: highest-precedence defined value wins (arrays replaced, not merged).
  const permissions =
    managed?.permissions ?? local?.permissions ?? project?.permissions ?? user?.permissions;

  const result: ClaudeSettings = {};

  if (Object.keys(mergedEnv).length > 0) {
    (result as Record<string, unknown>)["env"] = mergedEnv;
  }
  if (model !== undefined) {
    (result as Record<string, unknown>)["model"] = model;
  }
  if (availableModels !== undefined) {
    (result as Record<string, unknown>)["availableModels"] = availableModels;
  }
  if (companyAnnouncements !== undefined) {
    (result as Record<string, unknown>)["companyAnnouncements"] = companyAnnouncements;
  }
  if (Object.keys(enabledPlugins).length > 0) {
    (result as Record<string, unknown>)["enabledPlugins"] = enabledPlugins;
  }
  if (permissions !== undefined) {
    (result as Record<string, unknown>)["permissions"] = permissions;
  }

  return result;
}
