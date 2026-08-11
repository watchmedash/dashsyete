// Electron shell for the standalone Dash City map builder.
// Loads the dedicated vite editor server (:5199) — completely separate from
// the game dev server, so game-code changes never refresh the editor.
const { app, BrowserWindow, ipcMain } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const DEV_URL = "http://localhost:5199/editor.html";
const REPO_ROOT = path.resolve(__dirname, "..");
const CUSTOM_MAP_PATH = path.join(REPO_ROOT, "shared", "src", "customMap.json");

function createWindow() {
  const win = new BrowserWindow({
    width: 1600,
    height: 950,
    minWidth: 1200,
    minHeight: 700,
    title: "Dash City Map Builder",
    backgroundColor: "#f2f2ee",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.removeMenu();

  // The vite dev server may still be starting — retry until it's up.
  const load = () => {
    win.loadURL(DEV_URL).catch(() => {
      if (!win.isDestroyed()) setTimeout(load, 500);
    });
  };
  win.webContents.on("did-fail-load", () => {
    setTimeout(load, 500);
  });
  load();
}

ipcMain.handle("save-custom-map", (_ev, json) => {
  try {
    if (typeof json !== "string") throw new Error("expected a JSON string");
    JSON.parse(json); // refuse to write garbage into the game
    fs.writeFileSync(CUSTOM_MAP_PATH, json + "\n", "utf8");
    return { ok: true, path: CUSTOM_MAP_PATH };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
});

app.whenReady().then(createWindow);
app.on("window-all-closed", () => app.quit());
