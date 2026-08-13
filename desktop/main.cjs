const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

// SIX SIDES desktop: boots the bundled game server (bots included) in this
// process, then opens the game in a window. Fully offline — solo vs 11 bots.
const PORT = 8794;

app.whenReady().then(() => {
  // scores persist in the per-user app data dir, never the install dir
  const dataDir = path.join(app.getPath("userData"), "server");
  fs.mkdirSync(path.join(dataDir, "data"), { recursive: true });
  process.chdir(dataDir);
  process.env.SIX_SIDES_PORT = String(PORT);
  process.env.SIX_SIDES_DIST = path.join(__dirname, "web");
  require("./server.cjs");

  const win = new BrowserWindow({
    width: 1366,
    height: 820,
    autoHideMenuBar: true,
    title: "SIX SIDES",
    icon: path.join(__dirname, "icon.png"),
    backgroundColor: "#0b0e14",
  });
  // world gen takes a moment — retry until the local server answers
  const tryLoad = () =>
    win.loadURL(`http://127.0.0.1:${PORT}/?desktop=1`).catch(() => setTimeout(tryLoad, 300));
  tryLoad();
});

app.on("window-all-closed", () => app.quit());
