# Interface refinement

This pass refines existing workflows without adding a new product module. It follows the mobile performance work in [mobile-refinement.md](mobile-refinement.md).

The September 2026 modernization pass keeps the existing workout model while making the main journeys lighter and easier to scan. History now receives heart-rate metadata in its list response and only requests graph samples when a card becomes visible. Planner opens with a library-first add flow, puts the calendar and selected-day panel side by side on desktop, and defers editor and dialog bundles until they are used. Programs separates building a draft from reviewing and adding its schedule. The standalone rep counter puts diagnostics under a disclosure and keeps one stateful sticky control row on phones.

## Changes

- **Workout summary:** work sets become two-column cards on phones, with labeled rep and weight inputs, a scrollable body, and a persistent Save footer. Matching-set copying and saved values are preserved. Nested dialogs trap focus only in the top dialog; keyboard confirmation now applies the copy before closing.
- **Programs:** secondary-work fields wrap into labeled groups instead of imposing a 1,280-pixel-wide row. The wizard, previews, and saved-run layouts fit narrow screens; generation still uses the same API and program specification.
- **Home:** today's Start action appears before details. Empty sharing panels are omitted, session details and movement analysis expand on demand, and desktop panels no longer stretch to the height of their neighbor.
- **Navigation:** current-page indicators, primary section links, a Train disclosure for Timer / Rep Counter / Big Picture, and quieter Account / Settings controls. A saved summary draft remains reachable under Train, as well as from the timer. Mobile navigation exposes its expanded state and closes after navigation or Escape.
- **Cards:** Planner, Workouts, and History share a keyboard-accessible More disclosure that closes after selection, Escape, or an outside click. Placement accounts for viewport edges and wrapped controls. History has one action row per session; unavailable template deletion is omitted, and existing deletion confirmations remain in place.
- **Timer:** editing and the full timeline are collapsed independently of the running timer. Closing the editor retains unapplied changes. The idle display previews the first phase. The standalone phone timer has tighter spacing and a single row of large controls. Big Picture retains its existing camera lifecycle and compact runner layout.
- **Shared presentation:** readable accent-button foregrounds across six themes, consistent form fonts and keyboard focus rings, localized dates without seconds, larger Planner calendar labels, and notifications above mobile bottom controls. Loading the timer no longer overrides the application's font globally.
- **Modern visual system:** consistent page headings, neutral light surfaces, quieter card shadows, readable counter badges, and larger touch controls. Space Grotesk uses one local variable WOFF2 (49,256 bytes) instead of four TTF weights (277,440 bytes). Remix Icon is local too; full font licenses are included. Counter styles are scoped, so visiting it does not restyle other pages. The navigation surface no longer requires backdrop blur.
- **History filters:** phones get a visible search field plus a collapsible filter group with active count and Clear filters. Desktop keeps the complete filter toolbar in one row, and empty or no-match states explain the next action.

## Verification

`tests/browser/design.spec.ts` exercises responsive routes, summary copy/save data, nested-dialog keyboard use, menu dismissal and edge placement, navigation, editor draft retention, program preview requests, library-first Planner editing, and primary-action contrast. The detail-cache unit tests cover deduplication, bounded concurrency, and stale-result invalidation. Fixtures and isolated databases keep these checks separate from personal workout records.

The existing browser suite also checks camera pause/resume, rotation, fullscreen, stop/completion cleanup, late permission, inference suspension, logged counts, enlarged text, and offline audio caching. Physical Samsung A35 heat, battery use, and real-camera accuracy still require on-device use; browser viewport checks do not measure those.

Results on this laptop (16 September 2026):

- Production build passed.
- Typecheck: 0 errors and 0 warnings.
- Unit tests: 18 passed, including HR metadata/legacy summary handling and cache cancellation/retry.
- Browser regressions: 40 standard checks passed. The real detector smoke test also passed with a simulated camera; the sustained profile remains opt-in.
- Responsive checks cover 360 × 640, 768 × 1024, 844 × 390, and 1440 × 1000; the counter also fits 320 pixels. Screenshots reviewed at 390 × 844 and 1440 × 1000. Primary action text meets a 4.5:1 contrast ratio in each of the six themes.
- For the representative default workout, the collapsed phone Timer page shrank from roughly 10,500 to 894 pixels tall at 390 × 844. Programs fits the same viewport without horizontal scrolling. These are layout measurements, not device performance measurements.

The synthetic page profile uses 200 sessions, a 4× CPU slowdown and a 390 × 844 viewport. It separates initial loading (navigation plus five seconds) from the interaction (History search or Planner Add, plus 500 ms). History initially requests two graphs / 7,758 decoded bytes; searching for an offscreen session adds one / 3,879 bytes. The list response is another 56,191 decoded bytes and includes HR metadata. The historical baseline made 145 graph requests / 562,455 bytes over the combined observation window.

Planner now loads approximately 0.32 MB of decoded JavaScript through opening Add, compared with 3.06 MB in the reviewed implementation. Its closed advanced section previously still mounted Monaco. Opening Add now requests no additional JavaScript; choosing a saved workout also keeps Monaco unloaded, covered by a browser assertion. The previous report's JavaScript totals included the interaction and must not be described as initial-load totals.

These are decoded response-body sizes, not compressed transfer sizes. APIs are mocked, so the script does not measure database or filesystem latency. Single-run timings are noisy and do not establish a general page-load speedup or Samsung A35 battery/thermal improvement.

Commands:

```sh
npm run check
npm run build
npm test
npm run test:browser
node scripts/profile-pages.mjs /tmp/kb-suite-page-profile.json
```

For this laptop, use `/usr/bin/python3` when installing native dependencies as described in the mobile refinement notes. No additional toolchain is needed for these interface changes.

## Saving, History editing, and Settings

The saving and editing pass covers three existing workflows:

- **Saving a session:** the summary stays open with a disabled “Saving…” action until the server confirms the saved ID. Failures retain the fields and expose an inline retry. “Save session” and “Session saved to History” clarify where the result goes.
- **Editing History:** list and calendar views share `HistorySetEditor.svelte`. Phones show reps and weight side by side, with labels, duration, RPE and row operations under More details. Rest duration stays visible. Desktop displays the full editable row. Session metadata has its own disclosure, and Save/Cancel stay at the bottom of the viewport. Pending saves prevent further edits; failures retain changes and offer retry.
- **Settings:** Appearance, Workout & audio, Rep counter, Editor and AI are separate sections. Desktop uses section navigation; phones and short landscape screens use a full-screen dialog with a section selector and persistent footer. Calibration is under Advanced. Section changes retain drafts, Cancel discards them, and Save applies all sections in one store update so the complete payload reaches the settings API.

Browser coverage includes delayed and rejected summary saves, preservation of reps/weights on retry, Settings draft/save/cancel behavior across portrait, landscape and desktop, and History list/calendar editing with copy and deletion confirmation. Browser checks use fixtures and isolated storage.

## Review fixes and second pass

- Planner fetches the user's saved library, supports search/retry, requires choosing a workout or explicitly starting a custom one, and retains the form after rejected saves. Advanced editing mounts only when opened. The phone dialog has a compact duration summary and persistent save controls. The initial page no longer scrolls away from its heading. The desktop calendar and day panel share a row only where space permits; empty shares are hidden.
- Program drafts require a current preview. A late preview cannot overwrite newer field edits. Adding a schedule requires review and explicit confirmation; failures stay in the review and can be retried.
- HR backfill checks cached samples without silently rebuilding them before counting updates. Cached-only legacy summaries still render. Uploads capture their session ID; late interval and share-preview results cannot replace a newer dialog's content. Detail requests are deduplicated, bounded, aborted on invalidation, and settled on teardown, including queued requests.
- The standalone counter has non-overlapping count/mode badges, theme-aware mobile controls, one phone control row and optional diagnostics. Dialog keyboard behavior and stale Planner CSS were cleaned up, removing all nine compiler warnings.

The existing SQLite dependency was rebuilt for the laptop's Node runtime; no dependency versions changed. Browser fixtures and test databases are isolated from personal workout records.
