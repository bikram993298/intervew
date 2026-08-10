"use strict";

// ── DOM refs ─────────────────────────────────────────────────────────────────
const wvHost       = document.getElementById("wv-host");
const urlBar       = document.getElementById("url-bar");
const urlScheme    = document.getElementById("url-scheme");
const btnBack      = document.getElementById("btn-back");
const btnFwd       = document.getElementById("btn-fwd");
const btnReload    = document.getElementById("btn-reload");
const btnGo        = document.getElementById("btn-go");
const btnClose     = document.getElementById("btn-close");
const tabList      = document.getElementById("tab-list");
const btnNewTab    = document.getElementById("btn-new-tab");
const spinner      = document.getElementById("spinner");

const sbInsert     = document.getElementById("sb-insert");
const sbStart      = document.getElementById("sb-start");
const sbPause      = document.getElementById("sb-pause");
const sbReset      = document.getElementById("sb-reset");
const sbLoad       = document.getElementById("sb-load");
const progBar      = document.getElementById("prog-bar");
const progLabel    = document.getElementById("prog-label");
const speedSlider  = document.getElementById("speed-slider");
const sbKb         = document.getElementById("sb-kb");
const opacitySlider= document.getElementById("opacity-slider");
const opacityLabel = document.getElementById("opacity-label");
const sbShot       = document.getElementById("sb-shot");
const sbSSCrop     = document.getElementById("sb-sscrop");
const sbOcr        = document.getElementById("sb-ocr");
const sbPaste      = document.getElementById("sb-paste");
const sbCursor     = document.getElementById("sb-cursor");
const sbToggle     = document.getElementById("sb-toggle");

const ocrPanel     = document.getElementById("ocr-panel");
const ocrStatus    = document.getElementById("ocr-status");
const ocrTextEl    = document.getElementById("ocr-text");
const ocrCopy      = document.getElementById("ocr-copy");
const ocrQueue     = document.getElementById("ocr-queue");
const ocrClose     = document.getElementById("ocr-close");
const queuePanel   = document.getElementById("queue-panel");
const qList        = document.getElementById("q-list");
const qClear       = document.getElementById("q-clear");
const qClose       = document.getElementById("q-close");
const toastEl      = document.getElementById("toast");

// ── State ─────────────────────────────────────────────────────────────────────
let kbMode         = "OUTSIDE";
let cursorHidden   = false;
let typingLoaded   = false;
let taskQueue      = [];
let activeQueueId  = null;
let partition      = "persist:kx-profile";

// ── Tabs ──────────────────────────────────────────────────────────────────────
let tabs = [];
let activeTabId = null;

function createTab(url) {
  const id  = Date.now().toString();
  const tab = { id, url: url || "https://www.google.com", label: "New Tab", wv: null };
  tabs.push(tab);
  createWebviewForTab(tab);
  renderTabs();
  switchTab(id);
  return tab;
}

function closeTab(id) {
  const idx = tabs.findIndex(t => t.id === id);
  if (idx === -1) return;
  if (tabs[idx].wv) tabs[idx].wv.remove();
  tabs.splice(idx, 1);
  if (!tabs.length) { window.api.closeApp(); return; }
  const nextIdx = Math.min(idx, tabs.length - 1);
  switchTab(tabs[nextIdx].id);
  renderTabs();
}

function switchTab(id) {
  tabs.forEach(t => {
    if (t.wv) {
      t.wv.style.display    = t.id === id ? "flex" : "none";
      t.wv.style.visibility = t.id === id ? "visible" : "hidden";
    }
  });
  activeTabId = id;
  renderTabs();
  const tab = tabs.find(t => t.id === id);
  if (tab) {
    urlBar.value = tab.url || "";
    const url = tab.url || "";
    urlScheme.textContent = url.startsWith("https://") ? "HTTPS" : "HTTP";
    urlScheme.style.color = url.startsWith("https://") ? "var(--green)" : "var(--red)";
    if (tab.wv) {
      try { btnBack.disabled = !tab.wv.canGoBack(); }   catch { btnBack.disabled = true; }
      try { btnFwd.disabled  = !tab.wv.canGoForward(); } catch { btnFwd.disabled = true; }
    }
  }
}

function renderTabs() {
  tabList.innerHTML = "";
  tabs.forEach(tab => {
    const el = document.createElement("div");
    el.className = "tab" + (tab.id === activeTabId ? " active" : "");

    const lbl = document.createElement("span");
    lbl.className   = "tab-label";
    lbl.textContent = tab.label || "New Tab";
    lbl.addEventListener("click", () => switchTab(tab.id));

    const cls = document.createElement("button");
    cls.className   = "tab-close";
    cls.textContent = "×";
    cls.addEventListener("click", e => { e.stopPropagation(); closeTab(tab.id); });

    el.appendChild(lbl);
    el.appendChild(cls);
    tabList.appendChild(el);
  });
}

function getActiveTab() { return tabs.find(t => t.id === activeTabId) || null; }
function getActiveWv()  { return getActiveTab()?.wv || null; }

// ── Webview ───────────────────────────────────────────────────────────────────
function createWebviewForTab(tab) {
  const wv = document.createElement("webview");
  wv.src       = tab.url;
  wv.partition = partition;
  wv.setAttribute("allowpopups", "");
  wv.style.cssText = "position:absolute;top:0;left:0;width:100%;height:100%;display:flex;background:transparent;";
  wvHost.appendChild(wv);
  tab.wv = wv;
  attachWvEvents(wv, tab);
  return wv;
}

function attachWvEvents(wv, tab) {
  wv.addEventListener("did-start-loading", () => {
    if (tab.id !== activeTabId) return;
    spinner.classList.add("show");
    btnReload.innerHTML = "&#x2715;";
  });

  wv.addEventListener("did-stop-loading", () => {
    const url = wv.getURL();
    tab.url   = url;
    if (tab.id === activeTabId) {
      spinner.classList.remove("show");
      btnReload.innerHTML = "&#8635;";
      urlBar.value = url;
      urlScheme.textContent = url.startsWith("https://") ? "HTTPS" : "HTTP";
      urlScheme.style.color = url.startsWith("https://") ? "var(--green)" : "var(--red)";
      try { btnBack.disabled = !wv.canGoBack(); }   catch { btnBack.disabled = true; }
      try { btnFwd.disabled  = !wv.canGoForward(); } catch { btnFwd.disabled = true; }
    }
  });

  wv.addEventListener("page-title-updated", e => {
    tab.label = e.title || "New Tab";
    renderTabs();
    if (tab.id === activeTabId) document.title = e.title + " — KX";
  });

  wv.addEventListener("did-fail-load", e => {
    if (e.errorCode === -3) return;
    if (tab.id === activeTabId) {
      spinner.classList.remove("show");
      btnReload.innerHTML = "&#8635;";
    }
  });

  wv.addEventListener("new-window", e => createTab(e.url));
}

function goInTab(rawUrl, tabId) {
  const url = normalise(rawUrl);
  const tab = tabs.find(t => t.id === (tabId || activeTabId));
  if (!tab) return;
  tab.url = url;
  if (tab.wv) tab.wv.src = url;
  if (tab.id === activeTabId) urlBar.value = url;
}

// ── URL helpers ───────────────────────────────────────────────────────────────
function normalise(raw) {
  raw = (raw || "").trim();
  if (!raw) return "https://www.google.com";
  if (!/^https?:\/\//i.test(raw) && !raw.includes("."))
    return "https://www.google.com/search?q=" + encodeURIComponent(raw);
  if (!/^https?:\/\//i.test(raw)) raw = "https://" + raw;
  return raw;
}

// ── Toast ─────────────────────────────────────────────────────────────────────
let toastTimer = null;
function toast(msg, ms = 2200) {
  clearTimeout(toastTimer);
  toastEl.textContent = msg;
  toastEl.classList.remove("off");
  toastTimer = setTimeout(() => toastEl.classList.add("off"), ms);
}

// ── Toolbar ───────────────────────────────────────────────────────────────────
btnBack.addEventListener("click",   () => getActiveWv()?.goBack());
btnFwd.addEventListener("click",    () => getActiveWv()?.goForward());
btnReload.addEventListener("click", () => {
  const wv = getActiveWv();
  if (!wv) return;
  if (btnReload.innerHTML.includes("2715")) wv.stop();
  else wv.reload();
});
btnGo.addEventListener("click",    () => goInTab(urlBar.value));
urlBar.addEventListener("keydown", e => { if (e.key === "Enter") goInTab(urlBar.value); });
urlBar.addEventListener("focus",   () => urlBar.select());
btnClose.addEventListener("click", () => window.api.closeApp());
btnNewTab.addEventListener("click", () => createTab("https://www.google.com"));

// ── Init ─────────────────────────────────────────────────────────────────────
window.api.onInit(({ bookmarks, partition: p }) => {
  partition = p;
  createTab("https://www.google.com");

  bookmarks.forEach(({ label, url }) => {
    const btn = document.createElement("button");
    btn.className   = "bk";
    btn.textContent = label;
    btn.title       = url;
    btn.addEventListener("click", () => goInTab(url));
    tabList.parentNode.insertBefore(btn, btnNewTab);
  });
});

// ── Opacity ───────────────────────────────────────────────────────────────────
opacitySlider.addEventListener("input", () => {
  const v = parseFloat(opacitySlider.value);
  window.api.setOpacity(v);
  opacityLabel.textContent = Math.round(v * 100) + "%";
});
window.api.onOpacityChanged(v => {
  opacitySlider.value = v;
  opacityLabel.textContent = Math.round(v * 100) + "%";
});

// ── Speed ────────────────────────────────────────────────────────────────────
speedSlider.addEventListener("input", () => {
  const ms = 410 - parseInt(speedSlider.value);
  window.api.setSpeed(ms);
});

// ── Keyboard mode ─────────────────────────────────────────────────────────────
sbKb.addEventListener("click", async () => {
  kbMode = kbMode === "OUTSIDE" ? "INSIDE" : "OUTSIDE";
  await window.api.setKeyboardMode(kbMode);
  updateKbBtn();
  toast("Keyboard mode: " + kbMode);
});
function updateKbBtn() {
  sbKb.textContent = kbMode;
  sbKb.classList.toggle("kb-inside",  kbMode === "INSIDE");
  sbKb.classList.toggle("kb-outside", kbMode === "OUTSIDE");
}

// ── Cursor hide ───────────────────────────────────────────────────────────────
sbCursor.addEventListener("click", async () => {
  cursorHidden = !cursorHidden;
  await window.api.setCursorHidden(cursorHidden);
});
window.api.onCursorHidden(hidden => {
  cursorHidden = hidden;
  document.body.classList.toggle("cursor-hidden", hidden);
  sbCursor.textContent = hidden ? "SHOW CURSOR" : "HIDE CURSOR";
  sbCursor.classList.toggle("cursor-on", hidden);
});

// ── Screenshot ────────────────────────────────────────────────────────────────
sbShot.addEventListener("click", async () => {
  const r = await window.api.takeScreenshot();
  toast(r.ok ? "Screenshot taken — image copied to clipboard" : "Failed: " + r.err, 2000);
});
sbSSCrop.addEventListener("click", async () => {
  const r = await window.api.sscrop();
  toast(r.ok ? "SSCrop taken — image copied to clipboard" : "Failed: " + r.err, 2000);
});
window.api.onScreenshotTaken(() => {});

// ── PASTE ─────────────────────────────────────────────────────────────────────
sbPaste.addEventListener("click", async () => {
  const wv = getActiveWv();
  if (!wv) { toast("No browser tab open"); return; }
  const cb = await window.api.readClipboardFull();

  if (cb.type === "image") {
    try {
      const result = await wv.executeJavaScript(`
        (async function() {
          try {
            const byteChars = atob(${JSON.stringify(cb.data)});
            const byteArr   = new Uint8Array(byteChars.length);
            for (let i = 0; i < byteChars.length; i++) byteArr[i] = byteChars.charCodeAt(i);
            const blob = new Blob([byteArr], { type: 'image/png' });
            const file = new File([blob], 'screenshot.png', { type: 'image/png' });
            const dt   = new DataTransfer();
            dt.items.add(file);
            const fileInput = document.querySelector('input[type="file"]');
            if (fileInput) {
              Object.defineProperty(fileInput, 'files', { value: dt.files, writable: true });
              fileInput.dispatchEvent(new Event('change', { bubbles: true }));
              fileInput.dispatchEvent(new Event('input',  { bubbles: true }));
              return 'file-input';
            }
            const target = document.activeElement ||
                           document.querySelector('[contenteditable="true"]') ||
                           document.querySelector('textarea') || document.body;
            target.dispatchEvent(new ClipboardEvent('paste', { bubbles:true, cancelable:true, clipboardData:dt }));
            return 'paste-event';
          } catch(e) { return 'error:' + e.message; }
        })()`);
      toast(result?.startsWith?.("error:") ? "Paste failed: " + result.slice(6) : "Image pasted into browser");
    } catch { toast("Paste failed — click inside the chat input first"); }

  } else if (cb.type === "text" && cb.data) {
    try {
      await wv.executeJavaScript(`
        (function() {
          const el = document.activeElement; if (!el) return;
          if (el.isContentEditable) {
            document.execCommand('insertText', false, ${JSON.stringify(cb.data)});
          } else if (el.tagName==='INPUT'||el.tagName==='TEXTAREA') {
            const s=el.selectionStart||0, e=el.selectionEnd||0;
            el.value=el.value.slice(0,s)+${JSON.stringify(cb.data)}+el.value.slice(e);
            el.selectionStart=el.selectionEnd=s+${JSON.stringify(cb.data)}.length;
            el.dispatchEvent(new Event('input',{bubbles:true}));
          }
        })()`);
      toast("Text pasted into browser");
    } catch { toast("Paste failed — click a text field first"); }
  } else {
    toast("Nothing to paste — take a screenshot first");
  }
});

// ── OCR ───────────────────────────────────────────────────────────────────────
sbOcr.addEventListener("click", async () => {
  ocrPanel.classList.remove("panel-off");
  queuePanel.classList.add("panel-off");
  ocrStatus.textContent = "Running OCR on screen...";
  ocrTextEl.value = "";
  const r = await window.api.runOcr();
  if (r.ok) { ocrTextEl.value = r.text || "(no text found)"; ocrStatus.textContent = "Done — " + r.text.length + " chars"; }
  else { ocrStatus.textContent = "Error: " + r.err; }
});
window.api.onOcrResult(r => {
  ocrPanel.classList.remove("panel-off");
  queuePanel.classList.add("panel-off");
  if (r.ok) { ocrTextEl.value = r.text || "(no text found)"; ocrStatus.textContent = "Done — " + r.text.length + " chars"; }
  else { ocrStatus.textContent = "Error: " + r.err; }
});
ocrCopy.addEventListener("click",  () => { if (ocrTextEl.value) { window.api.copyText(ocrTextEl.value); toast("OCR text copied"); } });
ocrQueue.addEventListener("click", () => { if (ocrTextEl.value && ocrTextEl.value !== "(no text found)") { addToQueue(ocrTextEl.value); toast("Added to queue"); } });
ocrClose.addEventListener("click", () => ocrPanel.classList.add("panel-off"));

// ── Task Queue ────────────────────────────────────────────────────────────────
function addToQueue(text) {
  const id = Date.now().toString();
  taskQueue.push({ id, text });
  renderQueue();
  queuePanel.classList.remove("panel-off");
  ocrPanel.classList.add("panel-off");
}
function renderQueue() {
  if (!taskQueue.length) { qList.innerHTML = '<div style="color:var(--muted);font-size:11px;padding:10px;">Queue is empty</div>'; return; }
  qList.innerHTML = "";
  taskQueue.forEach(({ id, text }) => {
    const item = document.createElement("div");
    item.className = "q-item" + (id === activeQueueId ? " active" : "");
    const td = document.createElement("div"); td.className = "q-text"; td.textContent = text;
    const db = document.createElement("button"); db.className = "q-del"; db.textContent = "×";
    db.addEventListener("click", e => { e.stopPropagation(); taskQueue = taskQueue.filter(i => i.id !== id); if (activeQueueId === id) activeQueueId = null; renderQueue(); });
    item.addEventListener("click", async () => {
      activeQueueId = id; renderQueue();
      await window.api.copyText(text);
      const ms = 410 - parseInt(speedSlider.value);
      const r  = await window.api.typeLoad({ text, speed: ms });
      if (r.ok) { typingLoaded = true; sbStart.disabled = false; sbPause.disabled = true; progBar.style.width = "0%"; progLabel.textContent = "Loaded: " + r.total + " chars"; toast("Loaded from queue — " + r.total + " chars"); }
    });
    item.appendChild(td); item.appendChild(db); qList.appendChild(item);
  });
}
qClear.addEventListener("click", () => { taskQueue = []; activeQueueId = null; renderQueue(); });
qClose.addEventListener("click",  () => queuePanel.classList.add("panel-off"));

// ── Type Master ───────────────────────────────────────────────────────────────
sbLoad.addEventListener("click", async () => {
  const text = await window.api.readClipboard();
  if (!text || !text.trim()) { toast("Clipboard empty — copy text first"); return; }
  const ms = 410 - parseInt(speedSlider.value);
  const r  = await window.api.typeLoad({ text, speed: ms });
  if (r.ok) { typingLoaded = true; sbStart.disabled = false; sbPause.disabled = true; sbInsert.disabled = false; progBar.style.width = "0%"; progLabel.textContent = "Loaded: " + r.total + " chars"; toast("Loaded " + r.total + " chars — click START to type"); }
});
sbInsert.addEventListener("click", async () => { const r = await window.api.typeInsertOne(); if (!r.ok) toast(r.reason || "Nothing to insert"); });
sbStart.addEventListener("click", async () => {
  if (!typingLoaded) { toast("Load text first"); return; }
  sbStart.disabled = true; sbPause.disabled = false;
  progLabel.textContent = kbMode === "OUTSIDE" ? "Typing outside... (click PAUSE to stop)" : "Typing inside KX...";
  const r = await window.api.typeStart();
  if (!r.ok) { toast("Error: " + r.reason); sbStart.disabled = false; sbPause.disabled = true; }
});
sbPause.addEventListener("click", async () => { await window.api.typePause(); sbStart.disabled = false; sbPause.disabled = true; progLabel.textContent = "Paused — press START to resume"; toast("Paused"); });
sbReset.addEventListener("click", async () => { await window.api.typeReset(); typingLoaded = false; sbStart.disabled = true; sbPause.disabled = true; sbInsert.disabled = true; progBar.style.width = "0%"; progLabel.textContent = "No text loaded"; toast("Reset — clipboard cleared"); });
window.api.onTypeProgress(({ pos, total }) => { progBar.style.width = Math.round((pos / total) * 100) + "%"; progLabel.textContent = pos + " / " + total; });
window.api.onTypeDone(() => { typingLoaded = false; sbStart.disabled = true; sbPause.disabled = true; sbInsert.disabled = true; progBar.style.width = "100%"; progLabel.textContent = "Done!"; toast("Typing complete"); setTimeout(() => { progBar.style.width = "0%"; progLabel.textContent = "No text loaded"; }, 3000); });
window.api.onTypeCharInside(ch => {
  const wv = getActiveWv(); if (!wv) return;
  wv.executeJavaScript(`(function(){const el=document.activeElement;if(!el)return;if(el.isContentEditable){document.execCommand('insertText',false,${JSON.stringify(ch)});}else if(el.tagName==='INPUT'||el.tagName==='TEXTAREA'){const s=el.selectionStart||0,e=el.selectionEnd||0;el.value=el.value.slice(0,s)+${JSON.stringify(ch)}+el.value.slice(e);el.selectionStart=el.selectionEnd=s+1;el.dispatchEvent(new Event('input',{bubbles:true}));}})()`).catch(()=>{});
});
sbToggle.addEventListener("click", () => window.api.toggleWindow());

// ── Keyboard shortcuts ────────────────────────────────────────────────────────
document.addEventListener("keydown", e => {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key === "l") { e.preventDefault(); urlBar.focus(); urlBar.select(); }
  if (mod && e.key === "r") { e.preventDefault(); getActiveWv()?.reload(); }
  if (mod && e.key === "t") { e.preventDefault(); createTab("https://www.google.com"); }
  if (mod && e.key === "w") { e.preventDefault(); if (activeTabId) closeTab(activeTabId); }
  if (e.altKey && e.key === "ArrowLeft")  { e.preventDefault(); getActiveWv()?.goBack(); }
  if (e.altKey && e.key === "ArrowRight") { e.preventDefault(); getActiveWv()?.goForward(); }
  if (e.key === "Escape") { ocrPanel.classList.add("panel-off"); queuePanel.classList.add("panel-off"); }
});

sbInsert.disabled = true;
