"use strict";

// src/preload.ts
var import_electron = require("electron");
var PICK_FOLDER_CHANNEL = "desktop:pick-folder";
var wsUrl = process.env.CODETHING_DESKTOP_WS_URL ?? null;
import_electron.contextBridge.exposeInMainWorld("desktopBridge", {
  getWsUrl: () => wsUrl,
  pickFolder: () => import_electron.ipcRenderer.invoke(PICK_FOLDER_CHANNEL)
});
//# sourceMappingURL=preload.js.map