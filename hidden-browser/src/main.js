const {
  app, BrowserWindow, globalShortcut, ipcMain,
  screen, clipboard, desktopCapturer, shell, nativeImage
} = require("electron");
const path  = require("path");
const fs    = require("fs");
const { spawn } = require("child_process");

// ── MUST be set before app is ready or any other electron calls ───────────
// Use a known-writable path to avoid "Access is denied" GPU cache errors
const USER_DATA = path.join(require("os").homedir(), "AppData", "Roaming", "KX-Browser");
app.setPath("userData",    USER_DATA);
app.setPath("sessionData", USER_DATA);

// GPU flags — fix black screen and webview rendering issues on Windows
app.commandLine.appendSwitch("no-sandbox");
app.commandLine.appendSwitch("disable-gpu-sandbox");
app.commandLine.appendSwitch("ignore-gpu-blocklist");
app.commandLine.appendSwitch("enable-unsafe-webgpu");

const { checkAuth, registerAuthIPC } = require("./auth");

let mainWindow   = null;
let cursorHidden = false;
let isWindowVisible = true;  // track visibility for shortcut management
let isToggling      = false; // debounce rapid keypresses

// ── Window position/size state ────────────────────────────────────────────
const MOVE_STEP = 60; // px per keypress — matches article's 60px recommendation
let winState = { x: 0, y: 0, width: 1180, height: 760 };

// ── Bookmarks ─────────────────────────────────────────────────────────────
const BOOKMARKS = [
  { label: "Google",  url: "https://www.google.com"  },
  { label: "ChatGPT", url: "https://chat.openai.com" },
  { label: "Gemini",  url: "https://gemini.google.com" },
  { label: "Telegram",url: "https://web.telegram.org" },
];

const PARTITION = "persist:kx-profile";

// ── Screenshots dir ───────────────────────────────────────────────────────
function shotsDir() {
  const d = path.join(app.getPath("userData"), "screenshots");
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  return d;
}

// ── Typer state ───────────────────────────────────────────────────────────
const typer = {
  text:         "",
  pos:          0,
  paused:       true,
  speed:        80,          // ms between chars in auto mode
  timer:        null,
  psProc:       null,
  keyboardMode: "OUTSIDE",   // "INSIDE" | "OUTSIDE"
};

// ── PowerShell helper ─────────────────────────────────────────────────────
function psScriptPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "typer.ps1")
    : path.join(__dirname, "typer.ps1");
}

function spawnPsHelper() {
  if (typer.psProc) return;
  typer.psProc = spawn(
    "powershell",
    ["-NoProfile", "-NonInteractive", "-File", psScriptPath()],
    { stdio: ["pipe", "ignore", "ignore"] }
  );
  typer.psProc.on("exit",  () => { typer.psProc = null; });
  typer.psProc.on("error", () => { typer.psProc = null; });
}

function killPsHelper() {
  if (!typer.psProc) return;
  try { typer.psProc.stdin.write("EXIT\n"); } catch {}
  try { typer.psProc.kill();               } catch {}
  typer.psProc = null;
}

function sendCharExternal(ch) {
  if (!typer.psProc) return;
  const specialMap = {
    "\n": "{ENTER}", "\r": "{ENTER}", "\t": "{TAB}",
    "+": "{+}", "^": "{^}", "%": "{%}", "~": "{~}",
    "{": "{{}",  "}": "{}}",
    "[": "{[}",  "]": "{]}",
    "(": "{(}",  ")": "{)}",
  };
  const send = specialMap[ch] ?? ch;
  const b64  = Buffer.from(send, "utf8").toString("base64");
  try { typer.psProc.stdin.write(`CHAR:${b64}\n`); } catch {}
}

// Send one char — either inside webview or outside via PS
function sendChar(ch) {
  if (typer.keyboardMode === "INSIDE") {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("type-char-inside", ch);
    }
  } else {
    sendCharExternal(ch);
  }
}

// Progress notify helper
function notifyProgress() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("type-progress", {
      pos:   typer.pos,
      total: typer.text.length,
      done:  typer.pos >= typer.text.length,
    });
  }
}

// ── Insert one char (single step) ─────────────────────────────────────────
function insertOneChar() {
  if (!typer.text || typer.pos >= typer.text.length) return;
  if (typer.keyboardMode === "OUTSIDE" && !typer.psProc) spawnPsHelper();
  const ch = typer.text[typer.pos++];
  sendChar(ch);
  notifyProgress();
  if (typer.pos >= typer.text.length) {
    killPsHelper();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("type-done");
    }
  }
}

// ── Auto-type loop ────────────────────────────────────────────────────────
function typeNextAuto() {
  if (typer.paused || typer.pos >= typer.text.length) return;
  const ch = typer.text[typer.pos++];
  sendChar(ch);
  notifyProgress();
  if (typer.pos < typer.text.length && !typer.paused) {
    typer.timer = setTimeout(typeNextAuto, typer.speed);
  } else if (typer.pos >= typer.text.length) {
    typer.paused = true;
    killPsHelper();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("type-done");
    }
    // No need to show window — it was never hidden
  }
}

// ── Screenshot ────────────────────────────────────────────────────────────
async function takeScreenshot() {
  const { width, height } = screen.getPrimaryDisplay().size;
  const sources = await desktopCapturer.getSources({
    types: ["screen"], thumbnailSize: { width, height },
  });
  if (!sources.length) return { ok: false, err: "No screen source" };
  const ts   = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(shotsDir(), `kx-${ts}.png`);
  const img  = sources[0].thumbnail;
  fs.writeFileSync(file, img.toPNG());

  // Auto-copy image to clipboard so user can paste it anywhere
  clipboard.writeImage(img);

  if (mainWindow && !mainWindow.isDestroyed())
    mainWindow.webContents.send("screenshot-taken", { filePath: file });
  return { ok: true, filePath: file };
}

// ── SSCrop (capture only the KX window area) ──────────────────────────────
async function doSSCrop() {
  if (!mainWindow) return { ok: false };
  const b    = mainWindow.getBounds();
  const { width, height } = screen.getPrimaryDisplay().size;
  const sources = await desktopCapturer.getSources({
    types: ["screen"], thumbnailSize: { width, height },
  });
  if (!sources.length) return { ok: false, err: "No screen source" };
  const full   = sources[0].thumbnail;
  const cropped = full.crop({ x: b.x, y: b.y, width: b.width, height: b.height });
  const ts     = new Date().toISOString().replace(/[:.]/g, "-");
  const file   = path.join(shotsDir(), `kx-crop-${ts}.png`);
  fs.writeFileSync(file, cropped.toPNG());
  if (mainWindow && !mainWindow.isDestroyed())
    mainWindow.webContents.send("screenshot-taken", { filePath: file });
  return { ok: true, filePath: file };
}

// ── OCR ───────────────────────────────────────────────────────────────────
async function runOcr() {
  const shot = await takeScreenshot();
  if (!shot.ok) return { ok: false, err: shot.err };
  try {
    const { createWorker } = require("tesseract.js");
    const worker = await createWorker("eng");
    const { data: { text } } = await worker.recognize(shot.filePath);
    await worker.terminate();
    return { ok: true, text: text.trim(), filePath: shot.filePath };
  } catch (e) {
    return { ok: false, err: e.message };
  }
}

// ── Window ────────────────────────────────────────────────────────────────
function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const startX = Math.floor((width  - 1180) / 2);
  const startY = Math.floor((height -  760) / 2);
  winState = { x: startX, y: startY, width: 1180, height: 760 };

  mainWindow = new BrowserWindow({
    width: 1180, height: 760,
    minWidth: 800, minHeight: 480,
    x: startX,
    y: startY,
    frame:                  false,
    transparent:            false,
    alwaysOnTop:            true,
    skipTaskbar:            true,
    hasShadow:              false,
    fullscreenable:         false,          // prevent accidental fullscreen
    enableLargerThanScreen: true,           // allow sliding off-screen edges
    paintWhenInitiallyHidden: true,         // no flash on first show
    backgroundColor:        "#0e0e0e",
    // Windows: disable thick frame (removes resize-handle artifacts)
    ...(process.platform === "win32"  ? { thickFrame: false } : {}),
    // macOS: panel type floats above other apps without stealing focus
    ...(process.platform === "darwin" ? { type: "panel"      } : {}),
    show: false,
    webPreferences: {
      nodeIntegration:  false,
      contextIsolation: true,
      webviewTag:       true,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  // ── Hidden from ALL screen capture ────────────────────────────────────
  // setContentProtection applied after first paint (avoids black screen on Windows when run as Admin)
  mainWindow.loadFile(path.join(__dirname, "../index.html"));
  mainWindow.once("ready-to-show", () => {
    // setOpacity(0) then showInactive() prevents visual flash on first paint
    mainWindow.setOpacity(0);
    mainWindow.showInactive();   // show WITHOUT stealing focus from interview platform
    // Apply content protection AFTER window is visible and rendered
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setContentProtection(true);
        // Highest always-on-top level — stays above full-screen apps
        mainWindow.setAlwaysOnTop(true, "screen-saver", 1);
        // Stay visible across all macOS virtual desktops and full-screen spaces
        mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
        // Restore opacity after protection is applied
        mainWindow.setOpacity(currentOpacity);
      }
    }, 500);
  });

  // Re-apply Windows-specific config on focus — Windows can reset these during focus events
  mainWindow.on("focus", () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (process.platform === "win32") {
      mainWindow.setMenuBarVisibility(false);
      mainWindow.setAutoHideMenuBar(true);
      // Re-apply content protection — Windows can drop it on focus transitions
      mainWindow.setContentProtection(true);
      mainWindow.setAlwaysOnTop(true, "screen-saver", 1);
    }
    // Restore bounds — some API calls subtly shift position on focus
    const b = mainWindow.getBounds();
    mainWindow.setBounds(b);
  });
  mainWindow.webContents.on("did-finish-load", () => {
    mainWindow.webContents.send("init", { bookmarks: BOOKMARKS, partition: PARTITION });
  });
  mainWindow.on("close", (e) => {
    if (!app.isQuitting) { e.preventDefault(); mainWindow.hide(); }
  });
}

// ── Toggle show / hide ────────────────────────────────────────────────────
function toggleWindow() {
  if (!mainWindow || isToggling) return;
  isToggling = true;
  setTimeout(() => { isToggling = false; }, 300); // debounce — article recommends 300ms

  if (isWindowVisible) {
    // Click-through while hidden — mouse events pass to app below
    mainWindow.setIgnoreMouseEvents(true, { forward: true });
    mainWindow.hide();
    isWindowVisible = false;
    // Unregister all shortcuts except toggle — frees up keys for interview platform
    registerShortcutsHidden();
  } else {
    // setOpacity(0) then showInactive() — no focus steal, no visual flash
    mainWindow.setOpacity(0);
    mainWindow.setIgnoreMouseEvents(false);
    mainWindow.showInactive();
    mainWindow.setOpacity(currentOpacity);
    isWindowVisible = true;
    registerShortcuts(); // restore all shortcuts
  }
}

// ── Window movement (keyboard-driven, no drag = no focus steal) ───────────
function moveWindow(dx, dy) {
  if (!mainWindow) return;
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
  const b = mainWindow.getBounds();
  const maxOffX = b.width;   // allow full width off either edge
  const maxOffY = Math.floor(b.height * 2 / 3); // allow 2/3 off top/bottom
  const newX = Math.max(-maxOffX, Math.min(sw,  b.x + dx));
  const newY = Math.max(-maxOffY, Math.min(sh - b.height + maxOffY, b.y + dy));
  winState.x = newX;
  winState.y = newY;
  mainWindow.setPosition(Math.round(newX), Math.round(newY));
}

// ── Opacity helpers ───────────────────────────────────────────────────────
let currentOpacity = 1.0;
function nudgeOpacity(delta) {
  currentOpacity = Math.max(0.1, Math.min(1.0, currentOpacity + delta));
  mainWindow?.setOpacity(currentOpacity);
  if (mainWindow && !mainWindow.isDestroyed())
    mainWindow.webContents.send("opacity-changed", currentOpacity);
}

// ── Global shortcuts — full set (window visible) ──────────────────────────
function registerShortcuts() {
  globalShortcut.unregisterAll();

  // Alt+M  — show / hide KX
  globalShortcut.register("Alt+M", () => toggleWindow());

  // Alt+B  — screenshot
  globalShortcut.register("Alt+B", () => takeScreenshot());

  // Alt+X  — OCR
  globalShortcut.register("Alt+X", async () => {
    const r = await runOcr();
    if (mainWindow && !mainWindow.isDestroyed())
      mainWindow.webContents.send("ocr-result", r);
  });

  // Alt+,  and  Ctrl+,  — insert one char
  const combosTried = ["Alt+,", "Ctrl+,"];
  for (const combo of combosTried) {
    try { globalShortcut.register(combo, () => insertOneChar()); } catch {}
  }

  // Alt+Left / Alt+Right  — opacity
  globalShortcut.register("Alt+Left",  () => nudgeOpacity(-0.1));
  globalShortcut.register("Alt+Right", () => nudgeOpacity(+0.1));

  // Ctrl+Arrow — move window (keyboard-driven, no focus steal)
  globalShortcut.register("Ctrl+Up",    () => moveWindow(0, -MOVE_STEP));
  globalShortcut.register("Ctrl+Down",  () => moveWindow(0,  MOVE_STEP));
  globalShortcut.register("Ctrl+Left",  () => moveWindow(-MOVE_STEP, 0));
  globalShortcut.register("Ctrl+Right", () => moveWindow( MOVE_STEP, 0));
}

// ── Global shortcuts — hidden state (only toggle key active) ─────────────
// Frees up all other combos for the interview platform while window is hidden
function registerShortcutsHidden() {
  globalShortcut.unregisterAll();
  // 500ms delay prevents race condition when rapidly re-registering
  setTimeout(() => {
    globalShortcut.register("Alt+M", () => toggleWindow());
  }, 500);
}

// ── IPC handlers ──────────────────────────────────────────────────────────

ipcMain.handle("toggle-window", () => toggleWindow());
ipcMain.handle("hide-window",   () => {
  if (!mainWindow || !isWindowVisible) return;
  mainWindow.setIgnoreMouseEvents(true, { forward: true });
  mainWindow.hide();
  isWindowVisible = false;
  registerShortcutsHidden();
});
ipcMain.handle("close-app",     () => { app.isQuitting = true; app.quit(); });
ipcMain.handle("toggle-pin",    (_, v) => {
  // Re-apply with screen-saver level to avoid dropping stealth level
  mainWindow?.setAlwaysOnTop(v, "screen-saver", 1);
  return v;
});
ipcMain.handle("set-opacity",   (_, v) => {
  currentOpacity = Math.max(0.1, Math.min(1.0, v));
  // Use window opacity — works on non-transparent windows too on Windows
  mainWindow?.setOpacity(currentOpacity);
});

ipcMain.handle("copy-text",      (_, t) => clipboard.writeText(t));
ipcMain.handle("read-clipboard", ()     => clipboard.readText());

// Read clipboard — returns { type: "image"|"text", data }
ipcMain.handle("read-clipboard-full", () => {
  const img = clipboard.readImage();
  if (!img.isEmpty()) {
    // Return base64 PNG so renderer can paste it as a File
    const b64 = img.toPNG().toString("base64");
    return { type: "image", data: b64 };
  }
  const text = clipboard.readText();
  return { type: "text", data: text };
});
ipcMain.handle("open-shots-dir", ()     => shell.openPath(shotsDir()));

ipcMain.handle("take-screenshot", () => takeScreenshot());
ipcMain.handle("sscrop",          () => doSSCrop());
ipcMain.handle("run-ocr",         () => runOcr());

// Type-master — load
ipcMain.handle("type-load", (_, { text, speed }) => {
  clearTimeout(typer.timer);
  killPsHelper();
  typer.text   = text;
  typer.pos    = 0;
  typer.paused = true;
  if (speed) typer.speed = speed;
  return { ok: true, total: text.length };
});

// Type-master — insert one
ipcMain.handle("type-insert-one", async () => {
  if (!typer.text || typer.pos >= typer.text.length)
    return { ok: false, reason: "No text or already done" };
  if (typer.keyboardMode === "OUTSIDE") {
    spawnPsHelper();
    await new Promise(r => setTimeout(r, 200));
  }
  insertOneChar();
  return { ok: true, pos: typer.pos };
});

// Type-master — start auto
// IMPORTANT: Does NOT hide the window — KX stays visible while typing outside
ipcMain.handle("type-start", async () => {
  if (!typer.text || typer.pos >= typer.text.length)
    return { ok: false, reason: "No text loaded" };
  typer.paused = false;
  if (typer.keyboardMode === "OUTSIDE") {
    // Spawn PS helper but do NOT hide the window
    spawnPsHelper();
    // Small delay for PS to initialise
    await new Promise(r => setTimeout(r, 300));
  }
  typeNextAuto();
  return { ok: true };
});

// Type-master — pause
ipcMain.handle("type-pause", () => {
  typer.paused = true;
  clearTimeout(typer.timer);
  if (typer.keyboardMode === "OUTSIDE") killPsHelper();
  return { ok: true, pos: typer.pos, total: typer.text.length };
});

// Type-master — reset
ipcMain.handle("type-reset", () => {
  typer.paused = true;
  clearTimeout(typer.timer);
  killPsHelper();
  typer.text = ""; typer.pos = 0;
  clipboard.writeText("");
  return { ok: true };
});

// Type speed
ipcMain.handle("set-speed", (_, ms) => {
  typer.speed = Math.max(10, Math.min(500, ms));
  return { ok: true };
});

// Keyboard mode toggle
ipcMain.handle("set-keyboard-mode", (_, mode) => {
  typer.keyboardMode = mode; // "INSIDE" | "OUTSIDE"
  return { ok: true };
});

// Hide cursor (sends CSS to webview via renderer)
ipcMain.handle("set-cursor-hidden", (_, hidden) => {
  cursorHidden = hidden;
  if (mainWindow && !mainWindow.isDestroyed())
    mainWindow.webContents.send("cursor-hidden", hidden);
  return { ok: true };
});

// App lifecycle
let appStarted = false;

function startApp() {
  if (appStarted) return;   // prevent double-launch
  appStarted = true;
  createWindow();
  registerShortcuts();
}

app.whenReady().then(() => {
  // Register auth IPC — handles login form submit
  registerAuthIPC(() => startApp());
  // Check saved auth — if valid, starts directly; if not, shows login
  checkAuth(() => startApp());
});
app.on("before-quit", () => {
  app.isQuitting = true;
  globalShortcut.unregisterAll();
  clearTimeout(typer.timer);
  killPsHelper();
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
