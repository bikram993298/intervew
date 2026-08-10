# Implementation Plan: Smooth Page Transitions

## Overview

Implement the Page_Transition_Manager (PTM) module in KX Browser to eliminate black-flash during navigation. The work is split across 9 sequential tasks following the dependency graph below.

## Task Dependency Graph

```json
{
  "waves": [
    { "wave": 1, "tasks": ["1"] },
    { "wave": 2, "tasks": ["2"] },
    { "wave": 3, "tasks": ["3"] },
    { "wave": 4, "tasks": ["4", "5", "6"] },
    { "wave": 5, "tasks": ["7"] },
    { "wave": 6, "tasks": ["8"] },
    { "wave": 7, "tasks": ["9"] }
  ]
}
```

## Tasks

- [ ] 1. Scaffold Page_Transition_Manager and shared helpers
  Create the `Page_Transition_Manager` IIFE as a separate `hidden-browser/src/ptm.js` file. Establish all constants (`PAINT_HOLD_DURATION=8000`, `SNAPSHOT_FREE_MS=10000`, `STALE_CACHE_MS=30000`, `MAX_CACHE_PER_TAB=5`, `MAX_BG_WEBVIEWS=2`, `IDLE_PURGE_MS=30*60*1000`), the `tabState` Map, the `bgPool` array, and stub out the full public API (`initTab`, `navigate`, `switchTab`, `preloadBookmark`, `closeTab`, `getActiveWv`). Implement the two pure helper factories: `createOverlay()` and `createBgWebview(url, partition)`. Implement `captureSnapshot(wv)` with the 500 ms `Promise.race` timeout and JPEG-80 encoding.
  - `Page_Transition_Manager` is defined in `hidden-browser/src/ptm.js` and all public methods exist (no-ops for now).
  - `createOverlay()` returns a `<div>` with `z-index:4`, `opacity:1`, `background-color:#0e0e0e`, and `transition:opacity 200ms ease`.
  - `createBgWebview(url, partition)` returns a `<webview>` with `display:none` and `background:transparent`.
  - `captureSnapshot(wv)` returns `null` when `capturePage()` rejects, times out, or returns an empty NativeImage; returns a base-64 JPEG string otherwise.

- [ ] 2. Implement Transition_Overlay — insert, snapshot paint-hold, and dismissal
  Implement `PTM.navigate()` up to and including the overlay phase in `hidden-browser/src/ptm.js`:
  1. If a previous overlay/bgWv exists for the tab, tear it down (cancel timers, call `.remove()`, clear state).
  2. Call `captureSnapshot(activeWv)`.
  3. Call `createOverlay()`, optionally set `background-image` from snapshot data-URL.
  4. Set `#wv-host` background to `transparent`.
  5. Append overlay to `#wv-host` (above webviews).
  6. Add `show` class to `#spinner` **after** overlay is in DOM.
  7. Set `holdTimer` — after 8000 ms, fade overlay out and restore `#wv-host` background.
  8. Set `snapFreeTimer` — after 10000 ms, set overlay `background-image` to `none`.
  9. When `transitionend` fires on the overlay: set `background-image:none`, call `.remove()`, restore `#wv-host` to `#0e0e0e`. Always set a 500 ms backup timer to do the same in case `transitionend` never fires.
  - Overlay inserted before any webview `src` is touched.
  - Overlay `z-index` is `4` at all times while in DOM.
  - Snapshot is JPEG-80 encoded; fallback is dark overlay with no `background-image`.
  - Hold timer fires at 8000 ms and removes overlay.
  - `background-image` set to `none` at 10000 ms if overlay still present.
  - `#wv-host` background is `transparent` while overlay is present; restored to `#0e0e0e` after removal.

- [ ] 3. Implement Background_Webview loading and Active_Webview swap
  Complete `PTM.navigate()` with the background webview phase in `hidden-browser/src/ptm.js`:
  1. Call `createBgWebview(url, partition)` and append to `#wv-host` (display:none).
  2. Push entry to `bgPool`; if pool length > 2, remove oldest entry from DOM and pool.
  3. Listen for `dom-ready` on the Background_Webview: begin 200 ms CSS fade-out on overlay (set `opacity:0`), set Background_Webview `display:flex`, set previous Active_Webview `display:none`, if previous Active_Webview is not in cache call `.remove()` on it, remove `show` class from `#spinner`, update `tabState.activeWv`, remove entry from `bgPool`.
  4. Listen for `did-fail-load` on Background_Webview: if error code ≠ `-3`, dismiss overlay, promote Background_Webview to Active_Webview, delete from bgPool.
  5. In `PTM.initTab()`: create initial webview with `createBgWebview`, set `display:flex`, store in `tabState.activeWv`. Attach `did-stop-loading` listener to track `loadingDone`.
  - Background_Webview has same `partition` as Active_Webview.
  - `dom-ready` triggers overlay fade-out (≤ 200 ms) then webview swap.
  - Previous Active_Webview removed from DOM when not cached.
  - `bgPool` never exceeds 2 entries.
  - `did-fail-load` with code ≠ `-3` promotes failed webview and dismisses overlay.
  - `did-fail-load` with code `-3` does nothing.

- [ ] 4. Implement Preload_Cache for instant revisits
  Implement `PTM.preloadBookmark(url, tabId)` and hook the cache into `PTM.navigate()` in `hidden-browser/src/ptm.js`:
  `preloadBookmark`: if URL already in cache do nothing; if cache size ≥ 5 evict LRU entry; create hidden webview, append to `#wv-host`; on `did-stop-loading` set `cache.get(url).ready = true`; on `did-fail-load` (code ≠ -3) remove webview and delete cache entry.
  `navigate` cache-hit path: check `tabState.cache.get(url)`; if `ready===true` and `Date.now()-lastAccess≤30_000` promote cached webview directly, no overlay; if `ready===true` but stale call `.reload()`, show overlay, wait for `dom-ready` then promote; update `lastAccess` on access.
  - Cache never exceeds 5 entries per tab (LRU eviction enforced).
  - Cache hit with fresh entry: no overlay inserted, instant promotion.
  - Cache hit with stale entry: overlay shown, reload triggered, dismissed on `dom-ready`.
  - Failed preload webview removed and entry deleted; normal navigation used as fallback.
  - All cached webviews carry same `partition` as tab.

- [ ] 5. Spinner integration
  Ensure `#spinner` interacts correctly with the new transition system in `hidden-browser/src/ptm.js` and `hidden-browser/styles.css`:
  1. In `PTM.navigate()`, add `show` to `#spinner` only after overlay is appended and `opacity` is `1`.
  2. On Background_Webview `did-stop-loading`, remove `show` class within one `requestAnimationFrame`.
  3. Verify `#spinner` has `z-index: 5` in `styles.css` (it already does — confirm and add a comment tying it to this feature).
  4. Wire up the existing reload button so that when clicked during a background load: call `.stop()` on the Background_Webview, dismiss the overlay and remove `show` from `#spinner` within one `requestAnimationFrame`.
  - `show` class added after overlay is already at `opacity:1`.
  - `show` class removed within ≤ 16 ms of `did-stop-loading`.
  - Reload button click during load clears spinner and overlay within ≤ 16 ms.
  - `#spinner` z-index remains 5 (above overlay's 4).

- [ ] 6. Tab switching — flash-free
  Implement `PTM.switchTab(fromTabId, toTabId)` in `hidden-browser/src/ptm.js`:
  1. If `toTab.loadingDone === true`: make `toTab.activeWv` visible within one `requestAnimationFrame`. No overlay.
  2. If `toTab.loadingDone === false`: insert overlay with dark `#0e0e0e` placeholder (no `capturePage()` call). When `toTab.activeWv` fires `did-stop-loading`, begin 200 ms fade-out and remove overlay on completion.
  3. Hide `fromTab.activeWv` (`display:none`).
  - Switch to loaded tab: Active_Webview visible within one frame, no overlay.
  - Switch to loading tab: dark overlay shown; dismissed when `did-stop-loading` fires.
  - No `capturePage()` call during any tab switch.
  - 200 ms fade-out applied when tab-switch overlay is dismissed.

- [ ] 7. Memory and resource limits
  Implement full resource cleanup in `hidden-browser/src/ptm.js`:
  1. Implement `PTM.closeTab(tabId)`: call `.remove()` on `tabState.bgWv` if present; call `.remove()` on every cached webview in `tabState.cache`; clear `tabState.cache`; cancel `holdTimer` and `snapFreeTimer`; delete `tabId` from `tabState` Map; remove any `bgPool` entries for this tab; do all DOM mutations within a single `requestAnimationFrame`.
  2. Implement idle cache purge: attach `keydown`, `mousedown`, `mousemove`, `wheel` listeners to `document` in the PTM init. Maintain an idle timer (`setTimeout`, 30 minutes). Each event resets the timer. On fire: iterate all `tabState` values, call `.remove()` on all cache webviews, clear all cache Maps.
  - Closing a tab removes all its webviews and cache entries within one frame.
  - 30-minute idle timer purges all cache webviews across all tabs.
  - Any user interaction within 30 minutes resets the timer.
  - `bgPool` entries for closed tabs are cleaned up.

- [ ] 8. Wire PTM into renderer.js and remove superseded code
  Integrate the fully implemented PTM into `hidden-browser/src/renderer.js`:
  1. Add `<script src="ptm.js"></script>` before `renderer.js` in `hidden-browser/index.html`.
  2. Remove `createWebviewForTab(tab)` — replace every call site with `PTM.initTab(tab, partition)`.
  3. Remove `attachWvEvents(wv, tab)` — PTM now manages all webview listeners.
  4. Replace `goInTab(rawUrl, tabId)` body with `PTM.navigate(rawUrl, tabId)`.
  5. In `switchTab(id)`: delegate to `PTM.switchTab(activeTabId, id)` then let PTM control webview visibility; remove the direct `wv.style.display` mutations from the old `switchTab`.
  6. In `closeTab(id)`: call `PTM.closeTab(id)` before `tabs.splice(idx, 1)`.
  7. Update bookmark button click handlers to call `PTM.preloadBookmark(url, tabId)` in addition to `goInTab`.
  8. Update `getActiveWv()` to return `PTM.getActiveWv(activeTabId)`.
  9. Verify the `window.api.onInit` callback passes `partition` correctly to PTM.
  - App starts, creates initial tab, and navigates to Google with no black flash.
  - All existing features (typing, OCR, paste, screenshot, opacity, etc.) continue to work.
  - No references to the removed functions remain in renderer.js.
  - `getActiveWv()` returns the correct webview for all IPC consumers.

- [ ] 9. Write the property-based and unit test suite
  Set up Vitest + fast-check + jsdom in `hidden-browser/` and write tests covering all 18 correctness properties.
  1. Add to `hidden-browser/package.json` devDependencies: `"vitest": "^1.6.0"`, `"@fast-check/vitest": "^0.1.0"`, `"jsdom": "^24.1.0"`. Add `"test"` script: `"vitest --run"`.
  2. Create `hidden-browser/src/ptm.test.js`.
  3. Implement a `WebviewStub` class with minimal event-emitter, `capturePage()`, `reload()`, `remove()`, `getURL()`, `src` setter, `partition` property.
  4. Implement a `createTestTab(tabId?)` helper that initialises PTM with a stub webview.
  5. Write unit tests for: overlay z-index and background-color; `capturePage()` timeout returns null; empty NativeImage returns null; overlay dismissed on `dom-ready`; spinner show/hide order; reload button clears overlay within one frame; tab switch to loaded tab inserts no overlay; `did-fail-load -3` does nothing; `did-fail-load` other code promotes webview.
  6. Write property-based tests for all 18 properties using `test.prop([...])` with `numRuns: 100`. Each test must include tag comment: `// Feature: smooth-page-transitions, Property N: <text>`.
  - `npm test` (or `vitest --run`) passes with 0 failures.
  - All 18 property tests run with `numRuns: 100`.
  - No test imports Electron modules directly — all Electron APIs are stubbed.

## Notes

- All PTM logic lives in `hidden-browser/src/ptm.js` (new file), loaded before `renderer.js`.
- No changes to `main.js`, `preload.js`, or IPC surface are required.
- Task dependency order must be respected: T1→T2→T3→{T4,T5,T6}→T7→T8→T9.
- The existing `hidden-browser/src/ptm.js` stub file (if present) should be replaced entirely.
