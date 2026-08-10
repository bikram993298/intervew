"use strict";

/**
 * Page_Transition_Manager
 * Eliminates black-flash during navigation via overlay, snapshot paint-hold,
 * background webview loading, preload cache, and tab-switch flash prevention.
 * Loaded via <script src="src/ptm.js"> BEFORE renderer.js.
 */
const Page_Transition_Manager = (() => {

  // ── Constants ────────────────────────────────────────────────────────────
  const PAINT_HOLD_DURATION = 8_000;
  const SNAPSHOT_FREE_MS   = 10_000;
  const STALE_CACHE_MS     = 30_000;
  const MAX_CACHE_PER_TAB  = 5;
  const MAX_BG_WEBVIEWS    = 2;
  const IDLE_PURGE_MS      = 30 * 60 * 1_000;

  // ── Per-tab state  Map<tabId, TabState> ──────────────────────────────────
  const tabState = new Map();

  // ── Global bg-webview pool  Array<{tabId, wv, createdAt}> ────────────────
  const bgPool = [];

  // ── Idle timer ───────────────────────────────────────────────────────────
  let idleTimer = null;
  function resetIdleTimer() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(purgeAllCaches, IDLE_PURGE_MS);
  }
  function purgeAllCaches() {
    for (const st of tabState.values()) {
      for (const entry of st.cache.values()) {
        try { entry.wv.remove(); } catch {}
      }
      st.cache.clear();
    }
  }
  ["keydown", "mousedown", "mousemove", "wheel"].forEach(evt =>
    document.addEventListener(evt, resetIdleTimer, { passive: true })
  );
  resetIdleTimer();

  // ── DOM ref ───────────────────────────────────────────────────────────────
  function getWvHost() { return document.getElementById("wv-host"); }
  function getSpinner() { return document.getElementById("spinner"); }

  // ── Pure helper: createOverlay() ─────────────────────────────────────────
  function createOverlay() {
    const div = document.createElement("div");
    div.style.cssText = [
      "position:absolute",
      "inset:0",
      "z-index:4",
      "opacity:1",
      "background-color:#0e0e0e",
      "background-size:cover",
      "background-position:center",
      "background-repeat:no-repeat",
      "pointer-events:none",
      "transition:opacity 200ms ease",
    ].join(";");
    return div;
  }

  // ── Pure helper: createBgWebview(url, partition) ──────────────────────────
  function createBgWebview(url, part) {
    const wv = document.createElement("webview");
    wv.src       = url;
    wv.partition = part;
    wv.setAttribute("allowpopups", "");
    wv.style.cssText = [
      "position:absolute",
      "top:0",
      "left:0",
      "width:100%",
      "height:100%",
      "display:none",
      "background:transparent",
    ].join(";");
    return wv;
  }

  // ── Helper: captureSnapshot(wv) ──────────────────────────────────────────
  async function captureSnapshot(wv) {
    try {
      const result = await Promise.race([
        wv.capturePage(),
        new Promise((_, rej) =>
          setTimeout(() => rej(new Error("captureSnapshot timeout")), 500)
        ),
      ]);
      if (!result || result.isEmpty()) return null;
      return result.toJPEG(80).toString("base64");
    } catch {
      return null;
    }
  }

  // ── Helper: dismissOverlay(state) ────────────────────────────────────────
  // Fades out and removes the overlay, restores #wv-host bg.
  function dismissOverlay(st) {
    if (!st.overlay) return;
    const ov = st.overlay;
    st.overlay = null;
    clearTimeout(st.holdTimer);    st.holdTimer    = null;
    clearTimeout(st.snapFreeTimer); st.snapFreeTimer = null;

    // Begin fade-out
    ov.style.opacity = "0";
    const host = getWvHost();

    let cleaned = false;
    function cleanup() {
      if (cleaned) return;
      cleaned = true;
      ov.style.backgroundImage = "none";
      try { ov.remove(); } catch {}
      if (host) host.style.background = "#0e0e0e";
    }

    ov.addEventListener("transitionend", cleanup, { once: true });
    setTimeout(cleanup, 500); // backup in case transitionend never fires
  }

  // ── Helper: enforcePoolCap() ──────────────────────────────────────────────
  function enforcePoolCap() {
    while (bgPool.length >= MAX_BG_WEBVIEWS) {
      const oldest = bgPool.shift();
      try { oldest.wv.remove(); } catch {}
    }
  }

  // ── Public: initTab(tab, partition) ─────────────────────────────────────
  function initTab(tab, part) {
    const wv = createBgWebview(tab.url || "https://www.google.com", part);
    wv.style.display = "flex";
    // Make sure it's visible immediately — no overlay on initial load
    wv.style.opacity = "1";
    const host = getWvHost();
    if (host) {
      host.style.background = "#0e0e0e"; // solid bg — no transparent on init
      host.appendChild(wv);
    }

    const st = {
      tabId:         tab.id,
      partition:     part,
      activeWv:      wv,
      bgWv:          null,
      overlay:       null,
      holdTimer:     null,
      snapFreeTimer: null,
      loadingDone:   false,
      cache:         new Map(),
      initialLoad:   true,  // flag: first navigation already handled by initTab
    };
    tabState.set(tab.id, st);
    tab.wv = wv;

    wv.addEventListener("did-stop-loading", () => {
      st.loadingDone  = true;
      st.initialLoad  = false;
    });

    _attachStandardEvents(wv, tab, st);
    return wv;
  }

  // ── Internal: attach standard webview events ──────────────────────────────
  function _attachStandardEvents(wv, tab, st) {
    wv.addEventListener("page-title-updated", e => {
      tab.label = e.title || "New Tab";
      if (typeof renderTabs === "function") renderTabs();
      if (typeof activeTabId !== "undefined" && tab.id === activeTabId)
        document.title = e.title + " — KX";
    });

    wv.addEventListener("new-window", e => {
      if (typeof createTab === "function") createTab(e.url);
    });
  }

  // ── Public: navigate(rawUrl, tabId) ──────────────────────────────────────
  async function navigate(rawUrl, tabId) {
    const id = tabId || (typeof activeTabId !== "undefined" ? activeTabId : null);
    const st = tabState.get(id);
    if (!st) return;

    const url = typeof normalise === "function" ? normalise(rawUrl) : rawUrl;

    // ── Cancel any in-flight navigation ──────────────────────────────────
    if (st.bgWv) {
      try { st.bgWv.remove(); } catch {}
      st.bgWv = null;
      const pi = bgPool.findIndex(e => e.tabId === id);
      if (pi !== -1) bgPool.splice(pi, 1);
    }
    if (st.overlay) {
      dismissOverlay(st);
    }

    // ── Initial load: just set src directly, no overlay ──────────────────
    if (st.initialLoad) {
      st.activeWv.src = url;
      return;
    }

    // ── Cache-hit check ───────────────────────────────────────────────────
    const cacheEntry = st.cache.get(url);
    if (cacheEntry && cacheEntry.ready) {
      const age = Date.now() - cacheEntry.lastAccess;
      if (age <= STALE_CACHE_MS) {
        _promoteWebview(st, cacheEntry.wv);
        st.cache.delete(url);
        _syncUrlBar(url, id);
        return;
      } else {
        cacheEntry.lastAccess = Date.now();
        _insertOverlay(st, null);
        cacheEntry.wv.reload();
        cacheEntry.wv.addEventListener("dom-ready", () => {
          dismissOverlay(st);
          _promoteWebview(st, cacheEntry.wv);
          st.cache.delete(url);
          _syncUrlBar(url, id);
        }, { once: true });
        return;
      }
    }

    // ── Normal navigation path ────────────────────────────────────────────
    // 1. Capture snapshot
    const snapshotData = await captureSnapshot(st.activeWv);

    // 2. Insert overlay
    _insertOverlay(st, snapshotData);

    // 3. Create background webview
    enforcePoolCap();
    const bgWv = createBgWebview(url, st.partition);
    st.bgWv = bgWv;
    bgPool.push({ tabId: id, wv: bgWv, createdAt: Date.now() });
    const host = getWvHost();
    if (host) host.appendChild(bgWv);

    // 4. dom-ready → swap
    bgWv.addEventListener("dom-ready", () => {
      dismissOverlay(st);
      bgWv.style.display = "flex";
      requestAnimationFrame(() => {
        getSpinner()?.classList.remove("show");
      });
      _promoteWebview(st, bgWv);
      const pi = bgPool.findIndex(e => e.wv === bgWv);
      if (pi !== -1) bgPool.splice(pi, 1);
      st.bgWv = null;
      st.loadingDone = true;
      _syncUrlBar(url, id);
      _attachStandardEvents(bgWv, _getTab(id), st);
    }, { once: true });

    // 5. did-fail-load
    bgWv.addEventListener("did-fail-load", e => {
      if (e.errorCode === -3) return;
      dismissOverlay(st);
      bgWv.style.display = "flex";
      requestAnimationFrame(() => {
        getSpinner()?.classList.remove("show");
      });
      _promoteWebview(st, bgWv);
      const pi = bgPool.findIndex(e => e.wv === bgWv);
      if (pi !== -1) bgPool.splice(pi, 1);
      st.bgWv = null;
    }, { once: true });
  }

  // ── Internal: insert overlay with optional snapshot ───────────────────────
  function _insertOverlay(st, snapshotData) {
    const ov = createOverlay();
    if (snapshotData) {
      ov.style.backgroundImage = `url("data:image/jpeg;base64,${snapshotData}")`;
    }
    const host = getWvHost();
    if (host) {
      host.style.background = "transparent";
      host.appendChild(ov);
    }
    st.overlay = ov;

    // Show spinner after overlay is in DOM
    getSpinner()?.classList.add("show");

    // Hold timer — force dismiss after PAINT_HOLD_DURATION
    st.holdTimer = setTimeout(() => {
      dismissOverlay(st);
      if (host) host.style.background = "#0e0e0e";
    }, PAINT_HOLD_DURATION);

    // Snapshot free timer — clear background-image after SNAPSHOT_FREE_MS
    st.snapFreeTimer = setTimeout(() => {
      if (st.overlay) st.overlay.style.backgroundImage = "none";
    }, SNAPSHOT_FREE_MS);

    return ov;
  }

  // ── Internal: promote wv to Active_Webview ────────────────────────────────
  function _promoteWebview(st, newWv) {
    const prevWv = st.activeWv;
    if (prevWv && prevWv !== newWv) {
      prevWv.style.display = "none";
      // Remove from DOM if not in cache
      const inCache = _isInCache(st, prevWv);
      if (!inCache) {
        try { prevWv.remove(); } catch {}
      }
    }
    newWv.style.display = "flex";
    st.activeWv = newWv;
    st.loadingDone = true;
  }

  function _isInCache(st, wv) {
    for (const entry of st.cache.values()) {
      if (entry.wv === wv) return true;
    }
    return false;
  }

  function _getTab(tabId) {
    if (typeof tabs !== "undefined") return tabs.find(t => t.id === tabId) || { id: tabId };
    return { id: tabId };
  }

  function _syncUrlBar(url, tabId) {
    if (typeof activeTabId === "undefined" || tabId !== activeTabId) return;
    if (typeof urlBar !== "undefined") urlBar.value = url;
    if (typeof urlScheme !== "undefined") {
      urlScheme.textContent = url.startsWith("https://") ? "HTTPS" : "HTTP";
      urlScheme.style.color = url.startsWith("https://") ? "var(--green)" : "var(--red)";
    }
    if (typeof btnBack !== "undefined") {
      const st = tabState.get(tabId);
      if (st?.activeWv) {
        try { btnBack.disabled = !st.activeWv.canGoBack(); } catch { btnBack.disabled = true; }
        try { btnFwd.disabled  = !st.activeWv.canGoForward(); } catch { btnFwd.disabled = true; }
      }
    }
  }

  // ── Public: switchTab(fromTabId, toTabId) ────────────────────────────────
  function switchTab(fromTabId, toTabId) {
    const fromSt = tabState.get(fromTabId);
    const toSt   = tabState.get(toTabId);
    if (!toSt) return;

    // Hide outgoing tab's webview
    if (fromSt?.activeWv) fromSt.activeWv.style.display = "none";

    if (toSt.loadingDone) {
      // Already loaded — show instantly in next frame
      requestAnimationFrame(() => {
        toSt.activeWv.style.display = "flex";
      });
    } else if (toSt.initialLoad) {
      // First ever load of this tab — just show it, no overlay
      requestAnimationFrame(() => {
        toSt.activeWv.style.display = "flex";
      });
    } else {
      // Still loading — show dark overlay until did-stop-loading
      const ov = createOverlay();
      const host = getWvHost();
      if (host) {
        host.style.background = "transparent";
        host.appendChild(ov);
      }

      toSt.activeWv.addEventListener("did-stop-loading", () => {
        ov.style.opacity = "0";
        let cleaned = false;
        function cleanup() {
          if (cleaned) return;
          cleaned = true;
          ov.style.backgroundImage = "none";
          try { ov.remove(); } catch {}
          if (host) host.style.background = "#0e0e0e";
        }
        ov.addEventListener("transitionend", cleanup, { once: true });
        setTimeout(cleanup, 500);
        toSt.activeWv.style.display = "flex";
      }, { once: true });
    }
  }

  // ── Public: preloadBookmark(url, tabId) ──────────────────────────────────
  function preloadBookmark(url, tabId) {
    const st = tabState.get(tabId);
    if (!st) return;
    if (st.cache.has(url)) return; // already cached

    // LRU eviction if at cap
    if (st.cache.size >= MAX_CACHE_PER_TAB) {
      let lruKey = null, lruTime = Infinity;
      for (const [k, v] of st.cache.entries()) {
        if (v.lastAccess < lruTime) { lruTime = v.lastAccess; lruKey = k; }
      }
      if (lruKey) {
        try { st.cache.get(lruKey).wv.remove(); } catch {}
        st.cache.delete(lruKey);
      }
    }

    const wv = createBgWebview(url, st.partition);
    const entry = { url, wv, ready: false, lastAccess: Date.now() };
    st.cache.set(url, entry);
    const host = getWvHost();
    if (host) host.appendChild(wv);

    wv.addEventListener("did-stop-loading", () => {
      entry.ready = true;
      entry.lastAccess = Date.now();
    }, { once: true });

    wv.addEventListener("did-fail-load", e => {
      if (e.errorCode === -3) return;
      try { wv.remove(); } catch {}
      st.cache.delete(url);
    }, { once: true });
  }

  // ── Public: closeTab(tabId) ──────────────────────────────────────────────
  function closeTab(tabId) {
    const st = tabState.get(tabId);
    if (!st) return;

    clearTimeout(st.holdTimer);
    clearTimeout(st.snapFreeTimer);
    if (st.overlay) { try { st.overlay.remove(); } catch {} }

    requestAnimationFrame(() => {
      if (st.bgWv) { try { st.bgWv.remove(); } catch {} }
      for (const entry of st.cache.values()) {
        try { entry.wv.remove(); } catch {}
      }
      st.cache.clear();
    });

    // Remove from bgPool
    for (let i = bgPool.length - 1; i >= 0; i--) {
      if (bgPool[i].tabId === tabId) bgPool.splice(i, 1);
    }

    tabState.delete(tabId);
  }

  // ── Public: getActiveWv(tabId) ───────────────────────────────────────────
  function getActiveWv(tabId) {
    return tabState.get(tabId)?.activeWv ?? null;
  }

  // ── Public: wire reload button during background load ─────────────────────
  // Called by renderer after DOM is ready
  function wireReloadButton(btnReload) {
    btnReload.addEventListener("click", () => {
      const id = typeof activeTabId !== "undefined" ? activeTabId : null;
      if (!id) return;
      const st = tabState.get(id);
      if (!st) return;
      if (st.bgWv) {
        try { st.bgWv.stop(); } catch {}
        try { st.bgWv.remove(); } catch {}
        st.bgWv = null;
        const pi = bgPool.findIndex(e => e.tabId === id);
        if (pi !== -1) bgPool.splice(pi, 1);
      }
      if (st.overlay) {
        requestAnimationFrame(() => {
          dismissOverlay(st);
          getSpinner()?.classList.remove("show");
        });
      }
    });
  }

  // ── Test helpers ──────────────────────────────────────────────────────────
  function _cacheSize(tabId) { return tabState.get(tabId)?.cache.size ?? 0; }

  return {
    initTab,
    navigate,
    switchTab,
    preloadBookmark,
    closeTab,
    getActiveWv,
    wireReloadButton,
    _cacheSize,
    _createOverlay:       createOverlay,
    _createBgWebview:     createBgWebview,
    _captureSnapshot:     captureSnapshot,
    _tabState:            tabState,
    _bgPool:              bgPool,
    _PAINT_HOLD_DURATION: PAINT_HOLD_DURATION,
    _SNAPSHOT_FREE_MS:    SNAPSHOT_FREE_MS,
    _STALE_CACHE_MS:      STALE_CACHE_MS,
    _MAX_CACHE_PER_TAB:   MAX_CACHE_PER_TAB,
    _MAX_BG_WEBVIEWS:     MAX_BG_WEBVIEWS,
    _IDLE_PURGE_MS:       IDLE_PURGE_MS,
  };
})();
