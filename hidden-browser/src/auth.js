const { ipcMain, BrowserWindow, app } = require("electron");
const path   = require("path");
const fs     = require("fs");
const crypto = require("crypto");
const https  = require("https");
const http   = require("http");

// ── CONFIG ────────────────────────────────────────────────────────────────
const SERVER_URL = process.env.KX_SERVER || "https://kx-license-server.onrender.com";

// ── Local session storage (encrypted) ────────────────────────────────────
function getAuthFile() {
  return path.join(app.getPath("userData"), "kx-session.dat");
}
const ENCRYPT_KEY = "kx-enc-2026-secret-key-32bytesok";

function encryptData(data) {
  const iv     = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc",
    Buffer.from(ENCRYPT_KEY.slice(0, 32)), iv);
  let enc = cipher.update(JSON.stringify(data), "utf8", "hex");
  enc += cipher.final("hex");
  return iv.toString("hex") + ":" + enc;
}

function decryptData(raw) {
  try {
    const [ivHex, enc] = raw.split(":");
    const decipher = crypto.createDecipheriv("aes-256-cbc",
      Buffer.from(ENCRYPT_KEY.slice(0, 32)),
      Buffer.from(ivHex, "hex"));
    let dec = decipher.update(enc, "hex", "utf8");
    dec += decipher.final("utf8");
    return JSON.parse(dec);
  } catch { return null; }
}

function loadSavedSession() {
  try {
    const f = getAuthFile();
    if (!fs.existsSync(f)) return null;
    return decryptData(fs.readFileSync(f, "utf8"));
  } catch { return null; }
}

function saveSession(data) {
  fs.writeFileSync(getAuthFile(), encryptData(data));
}

function clearSession() {
  try { fs.unlinkSync(getAuthFile()); } catch {}
}

// ── Device ID ─────────────────────────────────────────────────────────────
function getDeviceId() {
  const { execSync } = require("child_process");
  try {
    const vol  = execSync("vol C: 2>nul | findstr Serial", { timeout: 3000 })
      .toString().replace(/\s+/g, "").replace(/.*SerialNumber.*is/i, "").trim();
    const user = process.env.USERNAME || process.env.USER || "unknown";
    return crypto.createHash("sha256")
      .update(`${vol}-${user}-${process.platform}`)
      .digest("hex").slice(0, 32);
  } catch {
    const idFile = path.join(app.getPath("userData"), "kx-device.id");
    if (fs.existsSync(idFile)) return fs.readFileSync(idFile, "utf8").trim();
    const id = crypto.randomBytes(16).toString("hex");
    fs.writeFileSync(idFile, id);
    return id;
  }
}

// ── HTTP helper ───────────────────────────────────────────────────────────
function postJson(url, body) {
  return new Promise((resolve, reject) => {
    const data   = JSON.stringify(body);
    const parsed = new URL(url);
    const lib    = parsed.protocol === "https:" ? https : http;
    const opts   = {
      hostname: parsed.hostname,
      port:     parsed.port || (parsed.protocol === "https:" ? 443 : 80),
      path:     parsed.pathname,
      method:   "POST",
      headers:  {
        "Content-Type":   "application/json",
        "Content-Length": Buffer.byteLength(data),
      },
      timeout: 8000,
    };
    const req = lib.request(opts, res => {
      let buf = "";
      res.on("data", c => buf += c);
      res.on("end", () => {
        try { resolve(JSON.parse(buf)); }
        catch { reject(new Error("Invalid server response")); }
      });
    });
    req.on("error",   reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("Connection timeout")); });
    req.write(data);
    req.end();
  });
}

// ── Validate credentials with server ─────────────────────────────────────
async function validateWithServer(username, password) {
  const deviceId = getDeviceId();
  return postJson(`${SERVER_URL}/login`, { username, password, deviceId });
}

// ── Re-validate saved token with server ──────────────────────────────────
async function revalidateToken(token) {
  const deviceId = getDeviceId();
  return postJson(`${SERVER_URL}/revalidate`, { token, deviceId });
}

// ── Login window ──────────────────────────────────────────────────────────
let loginWindow = null;

function createLoginWindow() {
  loginWindow = new BrowserWindow({
    width:           380,
    height:          380,
    resizable:       false,
    frame:           false,
    transparent:     false,
    alwaysOnTop:     true,
    center:          true,
    show:            false,
    backgroundColor: "#0e0e0e",
    webPreferences: {
      nodeIntegration:  false,
      contextIsolation: true,
      preload: path.join(__dirname, "login-preload.js"),
    },
  });

  loginWindow.loadFile(path.join(__dirname, "../login.html"));
  loginWindow.once("ready-to-show", () => {
    loginWindow.show();
    loginWindow.focus();
  });
}

// ── IPC for login window ──────────────────────────────────────────────────
function registerAuthIPC(onSuccess) {
  ipcMain.handle("auth-submit", async (_, username, password) => {
    try {
      const result = await validateWithServer(username.trim(), password);
      if (result.ok) {
        saveSession({
          token:       result.token,
          username:    username.trim(),
          validatedAt: Date.now(),
        });
        if (loginWindow && !loginWindow.isDestroyed()) {
          loginWindow.close();
          loginWindow = null;
        }
        onSuccess();
        return { ok: true, message: result.message };
      } else {
        return { ok: false, message: result.message || "Invalid username or password." };
      }
    } catch (e) {
      return { ok: false, message: "Cannot reach server. Check your internet connection." };
    }
  });

  ipcMain.handle("auth-quit", () => app.quit());
}

// ── Main entry: always show login window ─────────────────────────────────
async function checkAuth(onSuccess) {
  // Always clear any saved session — login required on every launch
  clearSession();
  createLoginWindow();
}

module.exports = { checkAuth, registerAuthIPC, clearSession };
