import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  getManagedSettingsPath,
  getMergedSettingsEnv,
  readAllClaudeSettings,
  readSettingsFile,
} from "./claude-settings";

function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeJson(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data), "utf8");
}

// ── getManagedSettingsPath ────────────────────────────────────────────────────

describe("getManagedSettingsPath", () => {
  it("returns macOS path for darwin", () => {
    const p = getManagedSettingsPath("darwin");
    expect(p).toBe("/Library/Application Support/ClaudeCode/managed-settings.json");
  });

  it("returns Linux path for linux", () => {
    const p = getManagedSettingsPath("linux");
    expect(p).toBe("/etc/claude-code/managed-settings.json");
  });

  it("returns Windows path for win32", () => {
    const p = getManagedSettingsPath("win32");
    expect(p).toBe("C:\\Program Files\\ClaudeCode\\managed-settings.json");
  });

  it("returns undefined for unknown platforms", () => {
    const p = getManagedSettingsPath("freebsd" as Parameters<typeof getManagedSettingsPath>[0]);
    expect(p).toBeUndefined();
  });
});

// ── readSettingsFile ──────────────────────────────────────────────────────────

describe("readSettingsFile", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir("claude-settings-read-");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("reads a valid settings file", () => {
    const filePath = path.join(tmpDir, "settings.json");
    writeJson(filePath, { model: "claude-opus-4", env: { MY_KEY: "value" } });

    const result = readSettingsFile(filePath);
    expect(result).toEqual({ model: "claude-opus-4", env: { MY_KEY: "value" } });
  });

  it("returns undefined for a missing file", () => {
    const result = readSettingsFile(path.join(tmpDir, "nonexistent.json"));
    expect(result).toBeUndefined();
  });

  it("returns undefined for malformed JSON", () => {
    const filePath = path.join(tmpDir, "bad.json");
    fs.writeFileSync(filePath, "{ broken", "utf8");

    const result = readSettingsFile(filePath);
    expect(result).toBeUndefined();
  });

  it("returns undefined when root is an array", () => {
    const filePath = path.join(tmpDir, "array.json");
    writeJson(filePath, [1, 2, 3]);

    const result = readSettingsFile(filePath);
    expect(result).toBeUndefined();
  });

  it("returns undefined when root is a string", () => {
    const filePath = path.join(tmpDir, "string.json");
    writeJson(filePath, "hello");

    const result = readSettingsFile(filePath);
    expect(result).toBeUndefined();
  });
});

// ── readAllClaudeSettings ─────────────────────────────────────────────────────
//
// Tests pass `managedSettingsPath: null` to isolate from any real system-level
// managed settings that may be installed on the machine.

describe("readAllClaudeSettings", () => {
  let homeDir: string;
  let cwd: string;

  beforeEach(() => {
    homeDir = makeTempDir("claude-settings-home-");
    cwd = makeTempDir("claude-settings-cwd-");
  });

  afterEach(() => {
    fs.rmSync(homeDir, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  it("reads user settings", () => {
    writeJson(path.join(homeDir, ".claude", "settings.json"), {
      model: "claude-haiku",
      env: { USER_VAR: "user-value" },
    });

    const result = readAllClaudeSettings({ homeDir, cwd, managedSettingsPath: null });
    expect(result.user).toEqual({ model: "claude-haiku", env: { USER_VAR: "user-value" } });
  });

  it("reads project settings", () => {
    writeJson(path.join(cwd, ".claude", "settings.json"), {
      model: "claude-sonnet",
    });

    const result = readAllClaudeSettings({ homeDir, cwd, managedSettingsPath: null });
    expect(result.project).toEqual({ model: "claude-sonnet" });
  });

  it("reads local settings", () => {
    writeJson(path.join(cwd, ".claude", "settings.local.json"), {
      env: { LOCAL_VAR: "local-value" },
    });

    const result = readAllClaudeSettings({ homeDir, cwd, managedSettingsPath: null });
    expect(result.local).toEqual({ env: { LOCAL_VAR: "local-value" } });
  });

  it("returns undefined for absent settings files", () => {
    const result = readAllClaudeSettings({ homeDir, cwd, managedSettingsPath: null });
    expect(result.user).toBeUndefined();
    expect(result.project).toBeUndefined();
    expect(result.local).toBeUndefined();
    expect(result.managed).toBeUndefined();
  });

  it("does not read project/local settings when cwd is not provided", () => {
    writeJson(path.join(cwd, ".claude", "settings.json"), { model: "claude-sonnet" });
    writeJson(path.join(cwd, ".claude", "settings.local.json"), { model: "claude-local" });

    const result = readAllClaudeSettings({ homeDir, managedSettingsPath: null });
    expect(result.project).toBeUndefined();
    expect(result.local).toBeUndefined();
  });

  it("merges env with correct precedence (user < project < local)", () => {
    writeJson(path.join(homeDir, ".claude", "settings.json"), {
      env: { SHARED: "from-user", USER_ONLY: "user" },
    });
    writeJson(path.join(cwd, ".claude", "settings.json"), {
      env: { SHARED: "from-project", PROJECT_ONLY: "project" },
    });
    writeJson(path.join(cwd, ".claude", "settings.local.json"), {
      env: { SHARED: "from-local", LOCAL_ONLY: "local" },
    });

    const result = readAllClaudeSettings({ homeDir, cwd, managedSettingsPath: null });
    expect(result.merged.env).toEqual({
      SHARED: "from-local",
      USER_ONLY: "user",
      PROJECT_ONLY: "project",
      LOCAL_ONLY: "local",
    });
  });

  it("uses model from highest-precedence scope (project > user when no local/managed)", () => {
    writeJson(path.join(homeDir, ".claude", "settings.json"), { model: "user-model" });
    writeJson(path.join(cwd, ".claude", "settings.json"), { model: "project-model" });

    const result = readAllClaudeSettings({ homeDir, cwd, managedSettingsPath: null });
    expect(result.merged.model).toBe("project-model");
  });

  it("user model used when no higher-precedence scope defines model", () => {
    writeJson(path.join(homeDir, ".claude", "settings.json"), { model: "user-model" });

    const result = readAllClaudeSettings({ homeDir, cwd, managedSettingsPath: null });
    expect(result.merged.model).toBe("user-model");
  });

  it("merged.enabledPlugins merges across scopes (higher precedence wins per-key)", () => {
    writeJson(path.join(homeDir, ".claude", "settings.json"), {
      enabledPlugins: { "a@m": true, "b@m": true },
    });
    writeJson(path.join(cwd, ".claude", "settings.json"), {
      enabledPlugins: { "b@m": false, "c@m": true },
    });

    const result = readAllClaudeSettings({ homeDir, cwd, managedSettingsPath: null });
    expect(result.merged.enabledPlugins).toEqual({
      "a@m": true,
      "b@m": false,
      "c@m": true,
    });
  });

  it("merged has no env key when no settings files define env", () => {
    writeJson(path.join(homeDir, ".claude", "settings.json"), { model: "some-model" });

    const result = readAllClaudeSettings({ homeDir, cwd, managedSettingsPath: null });
    expect(result.merged.env).toBeUndefined();
  });
});

// ── Managed settings via managedSettingsPath option ───────────────────────────

describe("readAllClaudeSettings - managed settings", () => {
  let homeDir: string;
  let cwd: string;
  let managedDir: string;

  beforeEach(() => {
    homeDir = makeTempDir("claude-settings-home-");
    cwd = makeTempDir("claude-settings-cwd-");
    managedDir = makeTempDir("claude-settings-managed-");
  });

  afterEach(() => {
    fs.rmSync(homeDir, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
    fs.rmSync(managedDir, { recursive: true, force: true });
  });

  it("readSettingsFile correctly parses a managed-like settings file", () => {
    const managedFile = path.join(managedDir, "managed-settings.json");
    writeJson(managedFile, {
      env: { MANAGED_VAR: "managed", SHARED: "managed" },
      model: "managed-model",
      companyAnnouncements: ["Welcome from IT"],
    });

    const result = readSettingsFile(managedFile);
    expect(result?.env).toEqual({ MANAGED_VAR: "managed", SHARED: "managed" });
    expect(result?.model).toBe("managed-model");
    expect(result?.companyAnnouncements).toEqual(["Welcome from IT"]);
  });

  it("managed settings override user/project/local settings", () => {
    const managedFile = path.join(managedDir, "managed-settings.json");
    writeJson(managedFile, {
      env: { SHARED: "managed", MANAGED_ONLY: "managed" },
      model: "managed-model",
    });

    writeJson(path.join(homeDir, ".claude", "settings.json"), {
      env: { SHARED: "user", USER_ONLY: "user" },
      model: "user-model",
    });
    writeJson(path.join(cwd, ".claude", "settings.local.json"), {
      env: { SHARED: "local", LOCAL_ONLY: "local" },
    });

    const result = readAllClaudeSettings({ homeDir, cwd, managedSettingsPath: managedFile });

    // managed wins for env
    expect(result.merged.env?.SHARED).toBe("managed");
    expect(result.merged.env?.MANAGED_ONLY).toBe("managed");
    expect(result.merged.env?.USER_ONLY).toBe("user");
    expect(result.merged.env?.LOCAL_ONLY).toBe("local");

    // managed wins for model
    expect(result.merged.model).toBe("managed-model");

    // result.managed is populated
    expect(result.managed?.model).toBe("managed-model");
  });

  it("env merge order: user < project < local < managed", () => {
    const managedFile = path.join(managedDir, "managed-settings.json");
    writeJson(managedFile, { env: { SHARED: "managed" } });

    writeJson(path.join(homeDir, ".claude", "settings.json"), {
      env: { SHARED: "user", USER_ONLY: "u" },
    });
    writeJson(path.join(cwd, ".claude", "settings.local.json"), {
      env: { SHARED: "local", LOCAL_ONLY: "l" },
    });

    const result = readAllClaudeSettings({ homeDir, cwd, managedSettingsPath: managedFile });
    expect(result.merged.env?.SHARED).toBe("managed");
    expect(result.merged.env?.USER_ONLY).toBe("u");
    expect(result.merged.env?.LOCAL_ONLY).toBe("l");
  });

  it("absent managed settings file is silently skipped", () => {
    const nonexistentManaged = path.join(managedDir, "does-not-exist.json");
    writeJson(path.join(homeDir, ".claude", "settings.json"), { model: "user-model" });

    const result = readAllClaudeSettings({
      homeDir,
      cwd,
      managedSettingsPath: nonexistentManaged,
    });
    expect(result.managed).toBeUndefined();
    expect(result.merged.model).toBe("user-model");
  });
});

// ── getMergedSettingsEnv ──────────────────────────────────────────────────────

describe("getMergedSettingsEnv", () => {
  let homeDir: string;
  let cwd: string;

  beforeEach(() => {
    homeDir = makeTempDir("claude-env-home-");
    cwd = makeTempDir("claude-env-cwd-");
  });

  afterEach(() => {
    fs.rmSync(homeDir, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  it("returns empty object when no settings files exist", () => {
    const env = getMergedSettingsEnv({ homeDir, cwd, managedSettingsPath: null });
    expect(env).toEqual({});
  });

  it("returns env from user settings only", () => {
    writeJson(path.join(homeDir, ".claude", "settings.json"), {
      env: { MY_VAR: "hello" },
    });

    const env = getMergedSettingsEnv({ homeDir, cwd, managedSettingsPath: null });
    expect(env).toEqual({ MY_VAR: "hello" });
  });

  it("merges env from multiple scopes", () => {
    writeJson(path.join(homeDir, ".claude", "settings.json"), {
      env: { A: "1", B: "user" },
    });
    writeJson(path.join(cwd, ".claude", "settings.json"), {
      env: { B: "project", C: "3" },
    });
    writeJson(path.join(cwd, ".claude", "settings.local.json"), {
      env: { C: "local", D: "4" },
    });

    const env = getMergedSettingsEnv({ homeDir, cwd, managedSettingsPath: null });
    expect(env).toEqual({ A: "1", B: "project", C: "local", D: "4" });
  });

  it("returns empty object when settings files have no env key", () => {
    writeJson(path.join(homeDir, ".claude", "settings.json"), {
      model: "claude-haiku",
    });

    const env = getMergedSettingsEnv({ homeDir, cwd, managedSettingsPath: null });
    expect(env).toEqual({});
  });
});
