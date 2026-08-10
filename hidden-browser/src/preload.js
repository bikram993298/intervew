const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  // window
  toggleWindow:         ()      => ipcRenderer.invoke("toggle-window"),
  hideWindow:           ()      => ipcRenderer.invoke("hide-window"),
  closeApp:             ()      => ipcRenderer.invoke("close-app"),
  setOpacity:           (v)     => ipcRenderer.invoke("set-opacity", v),

  // clipboard
  copyText:             (t)     => ipcRenderer.invoke("copy-text", t),
  readClipboard:        ()      => ipcRenderer.invoke("read-clipboard"),
  readClipboardFull:    ()      => ipcRenderer.invoke("read-clipboard-full"),

  // capture
  takeScreenshot:       ()      => ipcRenderer.invoke("take-screenshot"),
  sscrop:               ()      => ipcRenderer.invoke("sscrop"),
  runOcr:               ()      => ipcRenderer.invoke("run-ocr"),
  openShotsDir:         ()      => ipcRenderer.invoke("open-shots-dir"),

  // typer
  typeLoad:             (o)     => ipcRenderer.invoke("type-load",        o),
  typeInsertOne:        ()      => ipcRenderer.invoke("type-insert-one"),
  typeStart:            ()      => ipcRenderer.invoke("type-start"),
  typePause:            ()      => ipcRenderer.invoke("type-pause"),
  typeReset:            ()      => ipcRenderer.invoke("type-reset"),
  setSpeed:             (ms)    => ipcRenderer.invoke("set-speed",         ms),
  setKeyboardMode:      (m)     => ipcRenderer.invoke("set-keyboard-mode", m),
  setCursorHidden:      (v)     => ipcRenderer.invoke("set-cursor-hidden", v),

  // events main → renderer
  onInit:               (cb)    => ipcRenderer.on("init",             (_, v) => cb(v)),
  onScreenshotTaken:    (cb)    => ipcRenderer.on("screenshot-taken", (_, v) => cb(v)),
  onOcrResult:          (cb)    => ipcRenderer.on("ocr-result",       (_, v) => cb(v)),
  onTypeProgress:       (cb)    => ipcRenderer.on("type-progress",    (_, v) => cb(v)),
  onTypeDone:           (cb)    => ipcRenderer.on("type-done",        ()     => cb()),
  onTypeCharInside:     (cb)    => ipcRenderer.on("type-char-inside", (_, v) => cb(v)),
  onOpacityChanged:     (cb)    => ipcRenderer.on("opacity-changed",  (_, v) => cb(v)),
  onCursorHidden:       (cb)    => ipcRenderer.on("cursor-hidden",    (_, v) => cb(v)),
});
