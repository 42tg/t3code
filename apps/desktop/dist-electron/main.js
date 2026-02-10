"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// src/main.ts
var import_node_child_process2 = require("child_process");
var import_node_crypto = require("crypto");
var import_node_fs = __toESM(require("fs"));
var import_node_net = __toESM(require("net"));
var import_node_os = __toESM(require("os"));
var import_node_path = __toESM(require("path"));
var import_electron = require("electron");

// src/fixPath.ts
var import_node_child_process = require("child_process");
function fixPath() {
  if (process.platform !== "darwin") return;
  try {
    const shell = process.env.SHELL ?? "/bin/zsh";
    const result = (0, import_node_child_process.execFileSync)(shell, ["-ilc", "echo -n $PATH"], {
      encoding: "utf8",
      timeout: 5e3
    });
    if (result) {
      process.env.PATH = result;
    }
  } catch {
  }
}

// src/main.ts
fixPath();
var PICK_FOLDER_CHANNEL = "desktop:pick-folder";
var ROOT_DIR = import_node_path.default.resolve(__dirname, "../../..");
var BACKEND_ENTRY = import_node_path.default.join(ROOT_DIR, "apps/server/dist/index.js");
var RENDERER_ENTRY = import_node_path.default.join(ROOT_DIR, "apps/renderer/dist/index.html");
var STATE_DIR = import_node_path.default.join(import_node_os.default.homedir(), ".t3", "userdata");
var isDevelopment = Boolean(process.env.VITE_DEV_SERVER_URL);
var mainWindow = null;
var backendProcess = null;
var backendPort = 0;
var backendAuthToken = "";
var backendWsUrl = "";
var restartAttempt = 0;
var restartTimer = null;
var isQuitting = false;
async function reserveLoopbackPort() {
  return new Promise((resolve, reject) => {
    const probe = import_node_net.default.createServer();
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      probe.close(() => {
        if (port > 0) {
          resolve(port);
          return;
        }
        reject(new Error("Failed to reserve backend port"));
      });
    });
    probe.on("error", reject);
  });
}
function backendEnv() {
  return {
    ...process.env,
    CODETHING_MODE: "desktop",
    CODETHING_NO_BROWSER: "1",
    CODETHING_PORT: String(backendPort),
    CODETHING_STATE_DIR: STATE_DIR,
    CODETHING_AUTH_TOKEN: backendAuthToken
  };
}
function scheduleBackendRestart(reason) {
  if (isQuitting || restartTimer) return;
  const delayMs = Math.min(500 * 2 ** restartAttempt, 1e4);
  restartAttempt += 1;
  console.error(`[desktop] backend exited unexpectedly (${reason}); restarting in ${delayMs}ms`);
  restartTimer = setTimeout(() => {
    restartTimer = null;
    startBackend();
  }, delayMs);
}
function startBackend() {
  if (isQuitting || backendProcess) return;
  if (!import_node_fs.default.existsSync(BACKEND_ENTRY)) {
    scheduleBackendRestart(`missing server entry at ${BACKEND_ENTRY}`);
    return;
  }
  const child = (0, import_node_child_process2.spawn)(process.execPath, [BACKEND_ENTRY], {
    cwd: ROOT_DIR,
    env: backendEnv(),
    stdio: "inherit"
  });
  backendProcess = child;
  child.once("spawn", () => {
    restartAttempt = 0;
  });
  child.on("error", (error) => {
    if (backendProcess === child) {
      backendProcess = null;
    }
    scheduleBackendRestart(error.message);
  });
  child.on("exit", (code, signal) => {
    if (backendProcess === child) {
      backendProcess = null;
    }
    if (isQuitting) return;
    const reason = `code=${code ?? "null"} signal=${signal ?? "null"}`;
    scheduleBackendRestart(reason);
  });
}
function stopBackend() {
  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }
  const child = backendProcess;
  backendProcess = null;
  if (!child) return;
  if (!child.killed) {
    child.kill("SIGTERM");
    setTimeout(() => {
      if (!child.killed) {
        child.kill("SIGKILL");
      }
    }, 2e3).unref();
  }
}
function registerIpcHandlers() {
  import_electron.ipcMain.removeHandler(PICK_FOLDER_CHANNEL);
  import_electron.ipcMain.handle(PICK_FOLDER_CHANNEL, async () => {
    const owner = import_electron.BrowserWindow.getFocusedWindow() ?? mainWindow;
    const result = owner ? await import_electron.dialog.showOpenDialog(owner, {
      properties: ["openDirectory", "createDirectory"]
    }) : await import_electron.dialog.showOpenDialog({
      properties: ["openDirectory", "createDirectory"]
    });
    if (result.canceled) return null;
    return result.filePaths[0] ?? null;
  });
}
function createWindow() {
  const window = new import_electron.BrowserWindow({
    width: 1100,
    height: 780,
    minWidth: 840,
    minHeight: 620,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 18 },
    webPreferences: {
      preload: import_node_path.default.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.once("ready-to-show", () => {
    window.show();
  });
  if (isDevelopment) {
    void window.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    if (!import_node_fs.default.existsSync(RENDERER_ENTRY)) {
      throw new Error(`Renderer bundle missing at ${RENDERER_ENTRY}`);
    }
    void window.loadFile(RENDERER_ENTRY);
  }
  window.on("closed", () => {
    if (mainWindow === window) {
      mainWindow = null;
    }
  });
  return window;
}
async function bootstrap() {
  backendPort = await reserveLoopbackPort();
  backendAuthToken = (0, import_node_crypto.randomBytes)(24).toString("hex");
  backendWsUrl = `ws://127.0.0.1:${backendPort}/?token=${encodeURIComponent(backendAuthToken)}`;
  process.env.CODETHING_DESKTOP_WS_URL = backendWsUrl;
  registerIpcHandlers();
  startBackend();
  mainWindow = createWindow();
}
import_electron.app.on("before-quit", () => {
  isQuitting = true;
  stopBackend();
});
import_electron.app.whenReady().then(() => {
  void bootstrap();
  import_electron.app.on("activate", () => {
    if (import_electron.BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
    }
  });
});
import_electron.app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    import_electron.app.quit();
  }
});
//# sourceMappingURL=main.js.map