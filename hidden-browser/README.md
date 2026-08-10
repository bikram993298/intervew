# KX — Hidden Browser

A frameless, always-on-top browser **invisible to all screen capture and screen sharing software** (Zoom, Teams, Google Meet, OBS, Discord, etc.). Built for discreet browsing, live typing assistance, OCR, and clipboard operations during interviews or calls.

---

## Table of Contents

- [How It Works](#how-it-works)
- [Getting Started](#getting-started)
- [First Launch & Login](#first-launch--login)
- [The Interface](#the-interface)
- [Global Shortcuts](#global-shortcuts)
- [Sidebar Features](#sidebar-features)
  - [Typer](#typer)
  - [Keyboard Mode](#keyboard-mode)
  - [Opacity](#opacity)
  - [Capture](#capture)
  - [Paste](#paste)
  - [OCR](#ocr)
  - [Task Queue](#task-queue)
  - [Cursor Hide](#cursor-hide)
- [Tabs & Bookmarks](#tabs--bookmarks)
- [Building a Distributable](#building-a-distributable)
- [Development](#development)
- [License Server](#license-server)

---

## How It Works

KX uses OS-level window protection to be completely invisible to screen sharing:

- **Windows** — `SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)` via Electron's `setContentProtection(true)`. Enforced at the DWM compositor level — no screen sharing app on Windows can bypass it.
- **macOS** — `NSWindowSharingNone` excludes the window from CGWindowListCreateImage and ScreenCaptureKit. Zoom on macOS requires "Advanced Capture with window filtering" enabled in Zoom Settings → Screen Share.

Additional stealth measures:
- `thickFrame: false` — no resize-handle artifacts visible on window edges
- `skipTaskbar: true` — no app icon in the Windows taskbar
- `showInactive()` — window appears without triggering a `blur` event in the interview platform's browser
- Shortcuts unregister when KX is hidden — no accidental key conflicts with the interview app
- App presents as **Runtime Broker** (Microsoft system process name) in Task Manager

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) v18 or later
- npm

### Install & Run

```bash
cd hidden-browser
npm install
npm start
```

For dev mode (DevTools enabled, content protection OFF so you can see the window):
```bash
npm run dev
```

---

## First Launch & Login

On every launch KX shows a **login screen**. Enter the **username and password** provided by the server admin.

- Credentials are validated against your self-hosted auth server (MongoDB-backed).
- On success, a session token is saved locally (AES-256 encrypted). You stay logged in for 30 days.
- If the server is unreachable, the app shows an error — no offline grace period, live validation required.

To create user accounts on your server:
```bash
curl -X POST https://your-server.onrender.com/admin/create-user \
  -H "Content-Type: application/json" \
  -d '{"secret":"your-admin-secret","username":"john","password":"pass123"}'
```

See [`server/DEPLOY.md`](server/DEPLOY.md) for full admin API reference.

---

## The Interface

```
┌─────────────────────────────────────────────────┐
│  KX  [ ← → ↺ ]  [ URL bar          ] [GO]  [✕] │  ← Toolbar
├─────────────────────────────────────────────────┤
│  [Google] [ChatGPT] [Gemini] [Telegram]  [ + ]  │  ← Bookmarks + Tabs
├──────────────────────────────────────┬──────────┤
│                                      │ INSERT   │
│                                      │ START    │
│         Browser / Webview            │ PAUSE    │
│                                      │ RESET    │
│                                      │ LOAD     │
│                                      │ ──────── │
│                                      │ OUTSIDE  │  ← Keyboard mode
│                                      │ OPACITY  │
│                                      │ CAPTURE  │
│                                      │ SSCROP   │
│                                      │ OCR      │
│                                      │ PASTE    │
│                                      │ CURSOR   │
│                                      │ SHOW/HIDE│
└──────────────────────────────────────┴──────────┘
```

---

## Global Shortcuts

These work even when KX is hidden or another window has focus.

### Window Control

| Shortcut | Action |
|---|---|
| `Alt + M` | **Toggle KX** show / hide |
| `Ctrl + ↑ ↓ ← →` | **Move window** in that direction (60px per press) |
| `Alt + Left` | Decrease **opacity** by 10% |
| `Alt + Right` | Increase **opacity** by 10% |

> When KX is hidden, only `Alt+M` stays registered. All other shortcuts are unregistered so they don't conflict with the interview platform. They restore when you show KX again.

> The window can slide partially off-screen — useful to tuck it to one edge while keeping a sliver visible.

### Capture

| Shortcut | Action |
|---|---|
| `Alt + B` | Full-screen **screenshot** (saved + copied to clipboard) |
| `Alt + X` | Full-screen **OCR** |

### Typer

| Shortcut | Action |
|---|---|
| `Alt + ,` | **Insert one character** from loaded Typer text |
| `Ctrl + ,` | Insert one character (alternate binding) |

### In-browser (when KX window is focused)

| Shortcut | Action |
|---|---|
| `Ctrl + L` | Focus URL bar |
| `Ctrl + R` | Reload tab |
| `Ctrl + T` | New tab |
| `Ctrl + W` | Close tab |
| `Alt + ←` | Browser back |
| `Alt + →` | Browser forward |
| `Escape` | Close OCR / Queue panel |

---

## Sidebar Features

### Typer

Types pre-loaded text into any application character by character — while KX stays fully visible on screen.

**Workflow:**
1. Copy the text you want to type.
2. Click **LOAD** — reads clipboard, shows character count.
3. Set the **SPEED** slider (left = slow / careful, right = fast).
4. Click inside the target text field in the other app.
5. Click **START** — KX begins typing automatically.
6. Click **PAUSE** to stop; **START** again to resume from where it stopped.
7. Click **RESET** to clear everything (also clears clipboard).

**INSERT** — types exactly one character per click (or `Alt+,`). Use for manual step-through.

> Tip: Preload multiple snippets in the **Task Queue** and fire them one at a time.

---

### Keyboard Mode

Click the **OUTSIDE / INSIDE** button to toggle.

| Mode | Behaviour |
|---|---|
| **OUTSIDE** (default) | Keystrokes sent to the app behind KX via PowerShell SendKeys. Use to type into Zoom chat, Google Docs, coding editors, etc. |
| **INSIDE** | Keystrokes injected into the focused element inside KX's own webview. Use to type into ChatGPT, Telegram Web, etc. within the browser. |

---

### Opacity

Slider (10%–100%) or `Alt + Left / Right` to adjust how transparent KX looks to **you**. This has no effect on screen-capture invisibility — KX is always hidden from capture regardless of opacity level.

---

### Capture

| Button | Shortcut | What it does |
|---|---|---|
| **SCREENSHOT** | `Alt + B` | Captures full screen → saves as PNG → copies to clipboard |
| **SSCROP** | — | Captures only the KX window area → saves → copies to clipboard |
| **OCR** | `Alt + X` | OCR on full screen → opens OCR result panel |
| **PASTE** | — | Pastes clipboard image or text into the focused webview element |

Screenshots saved to:
```
%APPDATA%\KX-Browser\screenshots\
```

---

### Paste

Injects clipboard content into the focused element in the active browser tab.

- **Image** → triggers file-input upload or fires a `paste` ClipboardEvent (works with ChatGPT image upload, etc.)
- **Text** → inserts at cursor in focused input or contenteditable

> Click inside the target input in the webview *before* pressing PASTE.

---

### OCR

1. Click **OCR** or press `Alt + X`.
2. KX screenshots the screen and runs Tesseract OCR on it.
3. Review extracted text in the panel.
4. **COPY ALL** — copies to clipboard.
5. **+ QUEUE** — sends to Task Queue for later typing.
6. **X** — closes the panel.

---

### Task Queue

Line up multiple text snippets to type in sequence.

1. After OCR, click **+ QUEUE** to add the result.
2. Open the Queue panel to see all items.
3. Click any item → loads it into the Typer (ready to START).
4. **×** to remove a single item.
5. **CLEAR ALL** to empty the queue.

---

### Cursor Hide

**HIDE CURSOR** makes the mouse cursor invisible inside KX. **SHOW CURSOR** restores it. Useful when demoing browser content on a second screen.

---

## Tabs & Bookmarks

- **+** opens a new tab (starts at Google).
- Click a tab label to switch; **×** to close.
- Closing the last tab quits the app.
- **Bookmarks** (Google, ChatGPT, Gemini, Telegram) are quick-nav buttons in the tab bar.
- Links that open in a new window open in a new KX tab automatically.

---

## Building a Distributable

```bash
cd hidden-browser
npm run build
```

Output: `dist/RuntimeBroker-update.exe` — a silent NSIS installer, no desktop shortcut, no start menu entry.

The built app appears as **Runtime Broker** (Microsoft system process name) in Task Manager and the taskbar.

---

## Development

```bash
cd hidden-browser
npm run dev
```

- Content protection is **disabled** in dev mode so you can see the window in screen capture while developing.
- DevTools open automatically.
- App data stored in `%APPDATA%\KX-Browser\`.

### Project Structure

```
hidden-browser/
├── src/
│   ├── main.js          # Electron main process — window, IPC, shortcuts
│   ├── preload.js       # Context bridge — exposes api.* to renderer
│   ├── renderer.js      # UI logic — tabs, typer, OCR, paste, queue
│   ├── ptm.js           # Page Transition Manager — smooth navigation
│   ├── auth.js          # Login window + server auth
│   ├── login-preload.js # Context bridge for login window
│   └── typer.ps1        # PowerShell helper for external keystroke injection
├── index.html           # Main window HTML
├── login.html           # Login window HTML
├── styles.css           # All styles
└── server/              # Auth server (deploy to Render)
    ├── server.js
    ├── DEPLOY.md
    └── README.md
```

---

## License Server

The auth server lives in `hidden-browser/server/`. It's a Node.js + Express + MongoDB app.

Deploy to [Render](https://render.com) (free tier works) — see [`server/DEPLOY.md`](server/DEPLOY.md).

Your deployed server URL: `https://kx-license-server.onrender.com`

To point KX at a different server, edit `SERVER_URL` in `src/auth.js`:
```js
const SERVER_URL = process.env.KX_SERVER || "https://kx-license-server.onrender.com";
```
