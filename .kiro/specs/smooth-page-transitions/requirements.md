# Requirements Document

## Introduction

KX Browser is an Electron-based hidden browser app that uses `<webview>` tags to render web content
inside a `BrowserWindow`. Currently, navigating to a new URL causes a visible black flash: the
webview unloads the current page, exposes the dark `#0e0e0e` background, and only becomes visible
again once the new page has fully painted. This is especially noticeable when clicking search result
links on Google.

This feature — **Smooth Page Transitions** — eliminates the black-screen flash, keeps the previous
page visible while the next page loads ("paint-hold"), and improves perceived load speed through
background pre-loading and a polished visual transition layer.

---

## Glossary

- **Page_Transition_Manager**: The renderer-side module that orchestrates paint-hold, snapshot
  capture, transition overlay, and background loading.
- **Transition_Overlay**: A `<div>` element rendered above `#wv-host` that displays either a
  static snapshot or a themed placeholder while a new page loads, preventing the background from
  being exposed.
- **Snapshot**: A JPEG data-URL capturing the visible contents of a webview at the moment
  navigation begins, used to hold the visual state during loading.
- **Background_Webview**: A hidden `<webview>` element used to load a new URL without replacing the
  currently visible webview, enabling paint-hold navigation.
- **Preload_Cache**: An in-memory map of URL → ready `<webview>` elements that have already loaded
  a page and are kept hidden until the user navigates to that URL.
- **Active_Webview**: The `<webview>` element currently visible and interactable in the tab.
- **Navigation_Event**: Any action that causes a tab to load a different URL — including user
  address-bar entry, bookmark click, in-page link click, back/forward navigation, and
  `new-window` events captured as new tabs.
- **Tab**: A logical browsing unit containing one Active_Webview and zero or more cached webviews.
- **Spinner**: The existing `#spinner` overlay (`z-index: 5`) that shows an animated ring during
  page loads.
- **Paint_Hold_Duration**: The maximum time the Transition_Overlay remains visible while the
  Background_Webview loads, after which it is dismissed regardless of load state.

---

## Requirements

### Requirement 1: Transition Overlay — No Black Flash

**User Story:** As a KX Browser user, I want the screen to never go black when I click a link or
navigate to a new URL, so that browsing feels smooth and professional.

#### Acceptance Criteria

1. WHEN a Navigation_Event begins, THE Page_Transition_Manager SHALL insert the Transition_Overlay
   into the DOM and set its `opacity` to `1` before modifying the Active_Webview's `src`,
   ensuring zero frames of dark background are exposed during the transition.
2. WHILE the Transition_Overlay is active, THE Page_Transition_Manager SHALL keep the
   Transition_Overlay at `z-index: 4` — above `#wv-host` (z-index 0) but below `#spinner`
   (z-index 5) — so the overlay does not occlude the loading indicator.
3. WHEN the incoming Background_Webview fires its first `dom-ready` event, THE
   Page_Transition_Manager SHALL begin a CSS opacity transition from `1` to `0` on the
   Transition_Overlay with a duration of no more than 200 ms.
4. IF the incoming Background_Webview does not fire `dom-ready` within the Paint_Hold_Duration,
   THEN THE Page_Transition_Manager SHALL set the Transition_Overlay's `opacity` to `0` and
   remove it from the DOM, exposing the current state of the Active_Webview.
5. THE Page_Transition_Manager SHALL set the Paint_Hold_Duration to 8000 ms.
6. WHEN a new Navigation_Event begins while a Transition_Overlay fade-out is already in progress,
   THE Page_Transition_Manager SHALL cancel the in-progress fade-out, remove the existing
   Transition_Overlay from the DOM, and start a fresh Transition_Overlay for the new navigation.

---

### Requirement 2: Snapshot-Based Paint Hold

**User Story:** As a KX Browser user, I want to see the current page while the next one loads,
so that the transition feels instant and there is no jarring visual gap.

#### Acceptance Criteria

1. WHEN a Navigation_Event begins for the Active_Webview, THE Page_Transition_Manager SHALL call
   `webview.capturePage()` within 50 ms of displaying the Transition_Overlay, and SHALL set the
   resulting image as the `background-image` of the Transition_Overlay before changing the
   Active_Webview's `src`.
2. IF `capturePage()` rejects, times out after 500 ms, or resolves with an empty NativeImage, THEN
   THE Page_Transition_Manager SHALL display the Transition_Overlay with no `background-image`,
   showing only the `#0e0e0e` fallback background, and SHALL proceed with navigation normally.
3. WHILE the Transition_Overlay displays a Snapshot, THE Page_Transition_Manager SHALL size the
   Snapshot image to fill the full width and height of `#wv-host` without exceeding its bounds,
   so no dark letterboxing or black bars appear around the snapshot image.
4. THE Page_Transition_Manager SHALL encode each Snapshot as a JPEG at 80% quality before setting
   it as the `background-image` of the Transition_Overlay, to limit peak memory consumption.
5. WHEN the Transition_Overlay fade-out CSS transition ends (the `transitionend` event fires on
   the Transition_Overlay element), THE Page_Transition_Manager SHALL set the Transition_Overlay's
   `background-image` to `none` and remove the element from the DOM within 500 ms, freeing the
   Snapshot data-URL from memory.

---

### Requirement 3: Background Loading via Hidden Webview

**User Story:** As a KX Browser user, I want the new page to load behind the snapshot so the
transition to the new content is seamless, not just a blank fade-in.

#### Acceptance Criteria

1. WHEN a Navigation_Event begins, THE Page_Transition_Manager SHALL create a new Background_Webview
   element with the target URL and the same `partition` as the current Active_Webview, set its
   CSS `display` to `none`, and append it to `#wv-host` before modifying the Active_Webview's `src`.
2. WHEN the Background_Webview fires `dom-ready`, THE Page_Transition_Manager SHALL set the
   Background_Webview's CSS `display` to `flex` and set the previous Active_Webview's CSS
   `display` to `none`, making the Background_Webview the new Active_Webview for the tab.
3. WHEN the Background_Webview becomes the Active_Webview and the previous Active_Webview is not
   held in the Preload_Cache, THE Page_Transition_Manager SHALL call `.remove()` on the previous
   Active_Webview element to detach it from the DOM and free its resources.
4. THE Page_Transition_Manager SHALL assign the same `partition` attribute to every new
   Background_Webview as the tab's current Active_Webview so that session cookies, localStorage,
   and IndexedDB are shared across navigations.
5. IF a Background_Webview fires `did-fail-load` with an error code other than `-3` (user abort),
   THEN THE Page_Transition_Manager SHALL dismiss the Transition_Overlay, promote the failed
   Background_Webview to Active_Webview (so the webview's built-in error page is shown), and
   remove the element from the DOM after the user navigates away or closes the tab.
6. WHEN a second Navigation_Event begins while a Background_Webview is already loading for the
   same tab, THE Page_Transition_Manager SHALL call `.remove()` on the in-flight Background_Webview,
   dismiss the in-progress Transition_Overlay, and start a fresh Background_Webview for the new
   Navigation_Event.

---

### Requirement 4: Preload Cache for Instant Revisits

**User Story:** As a KX Browser user, I want pages I visit frequently (bookmarks and recently
visited URLs) to load instantly, so I do not wait for the network at all.

#### Acceptance Criteria

1. THE Page_Transition_Manager SHALL maintain a Preload_Cache with a maximum of 5 entries per tab,
   keyed by exact URL string.
2. WHEN a bookmark button is clicked and the bookmark's URL is not already present in the
   Preload_Cache, THE Page_Transition_Manager SHALL create a hidden `<webview>` element with the
   bookmark's URL and the tab's current `partition`, append it to `#wv-host` with `display: none`,
   and add it to the Preload_Cache once its `did-stop-loading` event fires.
3. WHEN a Navigation_Event targets a URL present in the Preload_Cache and the cached webview has
   already fired `did-stop-loading`, THE Page_Transition_Manager SHALL promote the cached webview
   to Active_Webview (no new Background_Webview is created) and skip the Transition_Overlay, making
   the navigation appear instant.
4. WHEN a cached webview in the Preload_Cache was last loaded more than 30 seconds before a
   Navigation_Event targets its URL, THE Page_Transition_Manager SHALL call `.reload()` on that
   webview before promoting it to Active_Webview, and SHALL display the Transition_Overlay with the
   themed placeholder until the reload's `dom-ready` event fires.
5. WHEN the Preload_Cache reaches its maximum size of 5 entries and a new URL must be added, THE
   Page_Transition_Manager SHALL identify the entry with the oldest last-access timestamp, call
   `.remove()` on its webview element, and delete the entry from the cache before inserting the new one.
6. IF a preloaded webview fires `did-fail-load` with an error code other than `-3`, THEN THE
   Page_Transition_Manager SHALL call `.remove()` on that webview element, delete its entry from
   the Preload_Cache, and perform a normal Background_Webview navigation for the target URL instead.

---

### Requirement 5: Spinner Integration

**User Story:** As a KX Browser user, I want the existing loading spinner to continue working
correctly with the new transition system, so I still have a clear indication that a page is
loading.

#### Acceptance Criteria

1. WHEN a Navigation_Event begins, THE Page_Transition_Manager SHALL add the `show` CSS class to
   `#spinner` only after the Transition_Overlay has been inserted into the DOM and its `opacity`
   set to `1`, so the overlay is never obscured before being visible.
2. WHEN the Background_Webview fires `did-stop-loading`, THE Page_Transition_Manager SHALL remove
   the `show` CSS class from `#spinner` within one animation frame (≤ 16 ms).
3. THE Page_Transition_Manager SHALL set `#spinner`'s `z-index` to `5` in the CSS stylesheet
   so it is always rendered above the Transition_Overlay (`z-index: 4`) throughout the feature's
   lifecycle.
4. WHEN the user clicks the reload button while a Background_Webview is loading, THE
   Page_Transition_Manager SHALL remove the `show` CSS class from `#spinner` and remove the
   Transition_Overlay from the DOM within one animation frame (≤ 16 ms) of the button click event.

---

### Requirement 6: Background Colour Elimination

**User Story:** As a KX Browser user, I want no dark flash even if snapshot capture is slow,
so the experience is consistent across fast and slow machines.

#### Acceptance Criteria

1. WHEN a new `<webview>` element is appended to `#wv-host`, THE Page_Transition_Manager SHALL
   set that element's inline CSS `background` property to `transparent` so the webview itself
   does not contribute an opaque dark fill during the paint-hold phase.
2. WHILE a Transition_Overlay is present in the DOM, THE Page_Transition_Manager SHALL set the
   inline CSS `background` of `#wv-host` to `transparent`.
3. WHEN the Transition_Overlay is removed from the DOM, THE Page_Transition_Manager SHALL restore
   the inline CSS `background` of `#wv-host` to `#0e0e0e` within one animation frame (≤ 16 ms).
4. WHEN a Transition_Overlay element is created, THE Page_Transition_Manager SHALL set its inline
   CSS `background-color` to `#0e0e0e` as the fallback colour rendered beneath any snapshot image.

---

### Requirement 7: Tab Switching — No Flash

**User Story:** As a KX Browser user, I want switching between open tabs to be instant and
flash-free, so the tab bar remains a smooth experience.

#### Acceptance Criteria

1. WHEN the user switches to a tab whose Active_Webview has not yet fired `did-stop-loading`,
   THE Page_Transition_Manager SHALL display a Transition_Overlay with the themed `#0e0e0e`
   placeholder (no snapshot capture from the outgoing tab) until that tab's `did-stop-loading`
   event fires.
2. WHEN the user switches to a tab whose Active_Webview has already fired `did-stop-loading`,
   THE Page_Transition_Manager SHALL make that tab's Active_Webview visible within one animation
   frame (≤ 16 ms) and SHALL NOT insert a Transition_Overlay.
3. WHILE the tab-switch Transition_Overlay is active, THE Page_Transition_Manager SHALL NOT call
   `capturePage()` on any webview to avoid unnecessary memory allocation during tab switching.
4. WHEN a tab-switch Transition_Overlay is active and the target tab's Active_Webview subsequently
   fires `did-stop-loading`, THE Page_Transition_Manager SHALL begin the 200 ms fade-out of the
   Transition_Overlay and remove it from the DOM upon completion.

---

### Requirement 8: Memory and Resource Limits

**User Story:** As a KX Browser user, I want the smooth-transition feature to not degrade
performance or consume excessive memory, so the app stays responsive during long sessions.

#### Acceptance Criteria

1. THE Page_Transition_Manager SHALL ensure that at most 2 Background_Webview elements exist
   simultaneously across all tabs; WHEN a Navigation_Event would create a third Background_Webview,
   THE Page_Transition_Manager SHALL call `.remove()` on the oldest non-Preload_Cache
   Background_Webview before creating the new one.
2. WHEN a tab is closed, THE Page_Transition_Manager SHALL call `.remove()` on every Background_Webview
   and Preload_Cache webview associated with that tab, and SHALL delete all corresponding
   Preload_Cache entries within one animation frame (≤ 16 ms) of the close event.
3. WHEN 10 seconds elapse after a Navigation_Event begins, THE Page_Transition_Manager SHALL set
   the Transition_Overlay's `background-image` to `none` (freeing the Snapshot data-URL from
   memory) and replace it with the `#0e0e0e` fallback if the overlay is still visible.
4. IF the elapsed time since the last user interaction (any keyboard event, mouse button press,
   mouse movement, or scroll event) exceeds 30 minutes, THEN THE Page_Transition_Manager SHALL
   call `.remove()` on every Preload_Cache webview element across all tabs and clear all
   Preload_Cache maps.
5. THE Page_Transition_Manager SHALL reset the 30-minute idle timer defined in criterion 4 on
   every keyboard event, mouse button press, mouse movement, and scroll event, so that active
   browsing sessions never trigger a cache purge.
