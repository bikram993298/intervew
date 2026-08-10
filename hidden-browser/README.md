# KX — Hidden Browser

A frameless, always-on-top browser that is **invisible to screen capture and screen sharing software**. Designed for discreet browsing, live typing assistance, OCR, and clipboard operations during calls or presentations.

---

## Table of Contents

- [Getting Started](#getting-started)
- [First Launch & License](#first-launch--license)
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

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) v18 or later
- npm

### Install & Run

```bash
# from the repo root
npm install
npm start
```

For dev mode (with DevTools):
```bash
npm run dev
```

---

## First Launch & License

On every launch KX checks your license key against the server. You will see the **Activate** screen if:

- No key has been saved yet
- Your saved key has been revoked or expired
- The server was unreachable for more than 24 hours (grace period expires)

**Enter your license key** in the format `KX-XXXX-XXXX-XXXX` and click **ACTIVATE**. Once validated the main browser opens automatically and your key is saved locally (encrypted).

> If the license server is unreachable KX grants a **24-hour offline grace period** using your last successful validation.

---

## The Interface

```
┌─────────────────────────────────────────────────┐
│  KX  [ ← → ↺ ]  [ URL bar          ] [GO]  [✕] │  ← Toolbar (drag to move)
├─────────────────────────────────────────────────┤
│  [Google] [ChatGPT] [Gemini] [Telegram]  [ + ]  │  ← Tab bar + bookmarks
├──────────────────────────────────────┬──────────┤
│                                      │ TYPER    │
│                                      │ INSERT   │
│         Browser / Webview            │ START    │
│                                      │ PAUSE    │
│                                      │ RESET    │
│                                      │ LOAD     │
│                                      │ ──────── │
│                                      │ KEYBOARD │
│                                      │ OPACITY  │
│                                      │ CAPTURE  │
│                                      │ CURSOR   │
│                                      │ SHOW/HIDE│
└──────────────────────────────────────┴──────────┘
```

- **Drag zone** — the "KX" label in the top-left is the drag handle to reposition the window.
- **Close button (✕)** — fully quits the app.
- Everything is hidden from OBS, Teams, Zoom, and any other screen-capture software.

---

## Global Shortcuts

These work even when KX is hidden or another window is in focus.

| Shortcut | Action |
|---|---|
| `Alt + M` | Toggle KX **show / hide** |
| `Alt + B` | Take a **screenshot** of the full screen (saved + copied to clipboard) |
| `Alt + X` | Run **OCR** on the full screen |
| `Alt + Left` | Decrease window **opacity** by 10% |
| `Alt + Right` | Increase window **opacity** by 10% |
| `Alt + ,` | **Insert one character** from the loaded Typer text |
| `Ctrl + ,` | Insert one character (alternate binding) |

### In-browser shortcuts (when KX is focused)

| Shortcut | Action |
|---|---|
| `Ctrl + L` | Focus the URL bar |
| `Ctrl + R` | Reload current tab |
| `Ctrl + T` | New tab |
| `Ctrl + W` | Close current tab |
| `Alt + ←` | Browser back |
| `Alt + →` | Browser forward |
| `Escape` | Close OCR / Queue panel |

---

## Sidebar Features

### Typer

Automatically types pre-loaded text into any application — works while KX stays visible on screen.

**Workflow:**

1. Copy the text you want to type into your clipboard.
2. Click **LOAD** — KX reads your clipboard and loads the text (shows character count).
3. Set the **SPEED** slider (left = slow, right = fast).
4. Click inside the target application's text field.
5. Click **START** — KX begins typing automatically.
6. Click **PAUSE** to stop mid-way; click **START** again to resume.
7. Click **RESET** to clear everything (also clears clipboard).

**INSERT** — types one character at a time on each click (or via `Alt+,`). Useful for stepping through text manually.

> **Tip:** Use the **Task Queue** to preload multiple text snippets and fire them one at a time.

---

### Keyboard Mode

Toggles between two typing modes. Click the **OUTSIDE / INSIDE** button in the sidebar.

| Mode | Behaviour |
|---|---|
| **OUTSIDE** (default) | Keystrokes are sent to whatever application is currently focused behind KX via PowerShell `SendKeys`. Use this to type into Zoom chat, Google Docs, etc. |
| **INSIDE** | Keystrokes are injected directly into the focused element inside KX's own browser webview. Use this to type into ChatGPT, Telegram web, etc. inside the browser. |

---

### Opacity

Use the **OPACITY** slider (10% – 100%) or `Alt + Left / Right` shortcuts to adjust how transparent KX appears to you. This does not affect screen-capture invisibility — KX is always hidden from capture regardless of opacity.

---

### Capture

| Button | Shortcut | What it does |
|---|---|---|
| **SCREENSHOT** | `Alt + B` | Captures the full screen, saves as PNG, and copies the image to clipboard |
| **SSCROP** | — | Captures only the KX window area and saves/copies it |
| **OCR** | `Alt + X` | Runs optical character recognition on the full screen and opens the OCR panel |
| **PASTE** | — | Pastes clipboard content (image or text) into the active webview element |

All screenshots are saved to:
```
%APPDATA%\KX-Browser\screenshots\
```
Click **Open Shots Dir** (via the IPC API) or navigate there manually to find saved files.

---

### Paste

The **PASTE** button injects whatever is currently in your clipboard into the focused element inside the active browser tab.

- **Image in clipboard** → attempts to trigger a file-input upload (e.g. ChatGPT image upload) or fires a `paste` ClipboardEvent on the focused element.
- **Text in clipboard** → inserts text at the cursor position in the focused input or contenteditable.

> **Tip:** Click inside the chat input field in the webview *before* pressing PASTE for best results.

---

### OCR

1. Press **OCR** button or `Alt + X`.
2. KX takes a screenshot, runs Tesseract OCR on it, and opens the **OCR Result** panel.
3. Review the extracted text in the panel.
4. Click **COPY ALL** to copy the text to clipboard.
5. Click **+ QUEUE** to add the text to the Task Queue for later typing.
6. Click **X** to close the panel.

---

### Task Queue

The Queue lets you line up multiple text snippets to type in sequence.

1. OCR a screen, then click **+ QUEUE** to add extracted text.
2. Open the Queue panel to see all items.
3. Click any item to **load it into the Typer** (ready to START).
4. Click **×** next to an item to remove it.
5. Click **CLEAR ALL** to empty the queue.

---

### Cursor Hide

Click **HIDE CURSOR** to make the mouse cursor invisible inside the KX window. Click **SHOW CURSOR** to restore it. Useful when demoing the browser content without the cursor being a distraction.

---

## Tabs & Bookmarks

- Click **+** to open a new tab (starts at Google).
- Click a tab label to switch to it.
- Click **×** on a tab to close it (closing the last tab quits the app).
- **Bookmarks** appear as quick-access buttons in the tab bar: Google, ChatGPT, Gemini, Telegram.
- Clicking a bookmark navigates the current tab to that URL.
- Links that open in a new window automatically open in a new KX tab.

---

## Building a Distributable

```bash
# from repo root
npm run build
```

Output goes to `dist/RuntimeBroker-update.exe` — a self-contained NSIS installer that runs silently with no desktop shortcut or start menu entry.

The built app is named **Runtime Broker** and presents as a Microsoft system process to avoid attracting attention in the taskbar or task manager.

---

## Development

```bash
npm run dev     # starts with --dev flag (DevTools enabled)
```

- In dev mode the window is **not** content-protected, so you can see it normally in screen capture while developing.
- DevTools open automatically alongside the main window.
- App data is stored in `%APPDATA%\KX-Browser\`.

### Project Structure

```
hidden-browser/
├── src/
│   ├── main.js          # Electron main process, IPC handlers, shortcuts
│   ├── preload.js       # Context bridge — exposes api.* to renderer
│   ├── renderer.js      # All UI logic (tabs, typer, OCR, paste, queue)
│   ├── auth.js          # License check & login window
│   ├── login-preload.js # Context bridge for login window
│   └── typer.ps1        # PowerShell helper for external keystroke injection
├── index.html           # Main window HTML
├── login.html           # License activation window HTML
├── styles.css           # All styles
└── server/              # License server (deploy to Render)
    ├── server.js
    └── DEPLOY.md
```

---

## License Server (self-hosted)

The license validation server lives in `hidden-browser/server/`. Deploy it to [Render](https://render.com) or any Node.js host.

See [`server/DEPLOY.md`](server/DEPLOY.md) and [`server/README.md`](server/README.md) for full setup instructions.

To point KX at your own server, set the environment variable before building:

```bash
KX_SERVER=https://your-server.onrender.com npm run build
```

Or edit the `SERVER_URL` constant in `hidden-browser/src/auth.js`.
