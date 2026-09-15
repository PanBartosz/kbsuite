# Mobile workout refinement

Target: Samsung Galaxy A35, Android; Chrome is the assumed browser until confirmed.
Both portrait and landscape use a numbers-first Big Picture view. Desktop layout,
workout schemas, API routes and saved data remain compatible.

## Implementation

- Camera requests 640×480 at up to 30 FPS. Actual capture dimensions can differ;
  transferred frames preserve aspect ratio and have a maximum 640-pixel long edge.
- One frame slot covers bitmap creation, transfer and inference. Frames arriving
  while busy are skipped. Worker results carry capture time, frame ID and generation;
  old phases, paused/stopped sessions and responses over one second old cannot count.
- The existing 20 FPS ceiling and optional 10 FPS setting remain. Counting thresholds
  and smoothing are unchanged during continuous observation. After an observation
  gap, accumulated reps are retained and a fresh low position rearms counting.
- Video and canvas share the same contain transform. The minimum torso-size safeguard
  is scaled with input coordinates. Empty results clear the skeleton; missing results
  clear it after one second.
- Model preparation starts with the camera session, including the preparation phase.
  Frames are sent only when needed. Pause, hidden documents and phases
  with neither counting nor gestures cancel frame scheduling. Foreground preview stays
  live during pauses/rest. Stop, completion and navigation release the camera and worker.
- Camera permission, initialization and worker errors have an inline retry action.
  The workout timer remains usable. A late permission grant after stop closes its tracks.
- Mobile Big Picture uses the same mounted camera in both orientations and fullscreen.
  Numbers sit above the preview in portrait and beside it in landscape. Controls have
  48px minimum targets. Navigation collapses in short landscape viewports as well as
  portrait; redundant workout headings are removed from the mobile runner. Opaque
  surfaces replace mobile blur; enlarged text can scroll.
- Voice cues and 20 upcoming numbers are decoded first. The rolling number window keeps
  five preceding numbers, the current number and 20 upcoming numbers, plus cues. Decode
  work is sequential and cancelled on voice change/stop. Missing audio uses the beep.
- Editor dialogs load on demand. Service-worker install precaches entry scripts,
  styles and basic static assets. Other JS and voice audio are cached when requested;
  previously requested assets remain usable offline within the installed version.

## Toolchain and reproducible checks

This laptop has Node 20.19.4, npm 9.2.0, system Python and C++ build tools. The copied
node_modules directory was incomplete. Restore from the lockfile with:

```sh
npm ci --python=/usr/bin/python3
npm run check
npm test
KB_SUITE_DATA_DIR=/tmp/kb-suite-validation npm run build
npm run test:browser
npm run test:pose
```

System Python is required here because the active Conda Python cannot import the
system node-gyp helper. Playwright uses the installed Brave executable on this
machine. Elsewhere set `KB_BROWSER_PATH` to a Chromium executable or run
`npx playwright install chromium`. Browser tests start a production preview with
an isolated `/tmp/kb-suite-browser-tests` data directory. Run browser suites
sequentially because they share that server. `test:pose` downloads the existing
MoveNet/WASM assets and is deliberately separate from deterministic regression tests.

The baseline snapshot passed build and typechecking (0 errors, 9 existing warnings).
The 13 focused tests cover overload, invalidated frames, stopping during capture, coordinate
scaling, synthetic swing/lockout signals, observation gaps and audio cache bounds.
Browser tests cover mobile layouts, touch targets, orientation/fullscreen changes,
permission failures, delayed permission, pause/visibility behavior and completion.
Final verification: production build and typechecking pass (the same nine existing
warnings), all 13 counter tests and 16 browser regressions pass. The real-model smoke
test and both sustained profiles were run separately and passed; they are opt-in in
the normal regression command. Browser checks include all six themes, offline voice
asset reuse, and recorded rep totals across pause/skip.

Synthetic input tests do not establish exercise-recognition accuracy on a phone.

## Profiling

```sh
npm run profile:counter
KB_PROFILE_SECONDS=1200 KB_PROFILE_OUTPUT=/tmp/kb-suite-long-profile.json npm run profile:counter
```

The profiling command uses real inference with a synthetic camera and writes JSON.
It records transferred dimensions, concurrent frames, response age, inference time
where available, and page JS heap samples. Heap measurements exclude worker/GPU
allocations, and a headless laptop profile does not measure phone battery or thermals.
To compare an existing production build, set `KB_PROFILE_SERVER_DIR` to its project
folder. `KB_PROFILE_URL`, `KB_PROFILE_SECONDS`, `KB_PROFILE_OUTPUT` and `KB_BROWSER_PATH`
can also be overridden. Use identical browser, input and duration for both builds.

For interactive diagnostics, set `window.__kbPoseMetrics = []` in DevTools on a dev
build. Samples are bounded to 1,200 and contain timings/dimensions, not camera images.
To enable the same instrumentation in an optimized profiling build, build with
`VITE_COUNTER_DIAGNOSTICS=1`. Ordinary production builds omit the callback.

## Measured laptop comparison (2026-09-15)

Both builds ran with the same headless Chromium 145 browser and synthetic camera,
with a 60-second observation period after initialization. This software-rendered
browser is a stress case, not a phone simulation.

| Measurement | Original snapshot | Refined build |
| --- | ---: | ---: |
| Transferred frame dimensions | 1920×1080 | 640×480 |
| Maximum outstanding frame requests | 851 | 1 |
| Completed frames during sampled minute | 315 | 349 |
| Refined frame response latency, p95 | Not directly comparable¹ | 137 ms |
| Worker errors | 0 | 0 |

¹ The original protocol has no frame ID/capture timestamp. FIFO response-age
estimation reached 46.6 seconds, but cannot establish exact per-frame latency if
responses finish out of order. The sent-minus-completed backlog measurement does
not depend on response order. Page heap samples omit the queued bitmap, worker and
GPU allocations, so they should not be used to claim total memory savings.

## Remaining physical-device acceptance

The A35 was unavailable for USB testing. Before declaring sustained mobile performance
and counting accuracy validated, compare original and refined builds on that phone:

1. Keep brightness, browser version, battery saver state, lighting, camera placement
   and workout fixed. Compare timer only, counter only, and Big Picture separately.
2. Run at least two 20-minute sessions per build, alternating build order. Record
   battery change, thermal behavior, UI stalls and any loss of tracking. Use Android
   remote DevTools if available to capture main-thread and worker traces.
3. Use manually counted/annotated swing and lockout sets: both hands, hand changes,
   slow/fast cadence, rests and brief occlusion. Check saved set totals against ground
   truth and baseline. Do not lower the inference cadence further unless accuracy holds.
4. Exercise pause/resume, skip, app switching, rotation, permission denial and stop.
   Verify timer/audio continuity, no stale reps, and camera release on completion.
5. Target 95% of control responses within 200ms, no growing inference backlog, and no
   sustained post-warm-up memory growth. Report battery/heat improvements as measurements,
   not estimates inferred from smaller frames.

Full offline page reload/background OS execution were not expanded in this refinement;
existing browser/platform limitations still apply. Model and WASM downloads continue
using the existing external providers.

## Page-level performance pass (2026-09-16)

The History route now receives cached heart-rate metadata in the list response and
loads sample arrays only for cards entering the viewport. With 200 synthetic sessions,
4× CPU slowdown, and a 390 × 844 viewport, it initially loads two graphs / 7,758 decoded
bytes, then one more / 3,879 bytes after searching. The list response includes metadata
and contributes another 56,191 bytes. The historical baseline made 145 graph requests /
562,455 bytes during the combined observation window.

Planner's Add flow now keeps the advanced editor unmounted until opened, reducing
decoded JavaScript through Add from about 3.06 MB in the reviewed pass to 0.32 MB.
The earlier JavaScript report included interaction downloads; it was not an initial-load
measurement. Fonts now use one 49 KB variable WOFF2 instead of four TTFs totalling 277 KB.

Run `node scripts/profile-pages.mjs` to measure initial and interaction phases separately.
APIs are mocked; timings are single observations and do not measure real server latency,
camera inference, phone battery or thermals. See [interface-refinement.md](interface-refinement.md)
for the scope and regression coverage (40 standard browser checks, a real detector smoke
test with simulated camera, and 18 unit tests passed). Samsung A35 sustained-use and
real-motion recognition checks remain manual; no USB connection is available.
