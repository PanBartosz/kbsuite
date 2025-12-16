# KB Suite — Architecture

This is a living document. Update it whenever you change data flow, storage, routes, shared components, or cross-cutting behavior.

## Purpose

KB Suite is a SvelteKit app for planning workouts, running timed sessions (with optional audio/TTS/metronome), counting reps via camera-based pose detection, and logging/reviewing completed sessions (including optional HR file attachment and “AI insights”).

## Tech Stack

- Frontend: SvelteKit (`@sveltejs/kit`) + Svelte 5, Vite 7, TypeScript.
- Backend: SvelteKit server routes (`src/routes/api/**`) using `better-sqlite3` (SQLite file database).
- Data formats:
  - Workout plans are YAML (parsed with `yaml`) and also stored as JSON (`plan_json`) for convenience.
  - HR uploads: `.fit` / `.tcx` (optionally inside `.zip`), parsed by `fit-file-parser`.
- Charts: `chart.js`.
- AI (client-side):
  - Chat Completions for insights/workout generation (browser fetch to OpenAI).
  - OpenAI TTS (used by the timer) via client fetch.
- Rep counting: `@tensorflow/tfjs` + pose detection (`@tensorflow-models/pose-detection`), largely executed on the client.
- PWA: service worker caching of build + static assets.

## High-Level Module Map

Routes (UI):

- `/` (`src/routes/+page.svelte`): dashboard “home” + quick entry points.
- `/plan` (`src/routes/plan/+page.svelte`): planner/calendar for `planned_workouts`, YAML editing, duplicating, and sharing.
- `/timer` (`src/routes/timer/+page.svelte`): timer-only session runner (work/rest phases, audio cues, TTS announcements, metronome).
- `/counter` (`src/routes/counter/+page.svelte`): rep-counter-only (camera + pose overlay + rep counting).
- `/big-picture` (`src/routes/big-picture/+page.svelte`): combined timer + rep counter; timer drives rep-counter directives per phase.
- `/workouts` (`src/routes/workouts/+page.svelte`): workout library (user workouts + seeded templates) and “start in timer”.
- `/history` (`src/routes/history/+page.svelte`): completed workouts list/calendar, editing, comparisons, HR attachment, exports/sharing, AI insights.
- `/auth` (`src/routes/auth/+page.svelte`): username/password register/login to enable sharing.

API (server):

- Session: `GET /api/session` (ensures a session cookie and returns user identity).
- Settings: `GET/PUT /api/settings` (server-stored settings excluding local-only API key).
- Planned workouts: `GET/POST /api/planned-workouts`, `GET/PUT/DELETE /api/planned-workouts/[id]`.
- Sharing planned workouts: `POST /api/planned-workouts/[id]/share`, `GET /api/shared-workouts`, `PATCH /api/shared-workouts/[id]`.
- Workouts library: `GET/POST /api/workouts`, `GET/DELETE /api/workouts/[id]`.
- Completed workouts: `GET/POST /api/completed-workouts`, `PUT/DELETE /api/completed-workouts/[id]`.
- Similarity search: `GET /api/completed-workouts/[id]/similar`.
- HR files: `GET/POST/DELETE /api/completed-workouts/[id]/hr`.
- Auth: `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`.

Shared UI/state:

- Settings modal: `src/lib/components/SettingsModal.svelte` + `src/lib/stores/settings.ts`
- Planner share modal: `src/lib/components/SharePlanModal.svelte`
- Workout summary modal: `src/lib/stats/WorkoutSummaryModal.svelte` + `src/lib/stats/summaryStore.ts`
- Sharing state: `src/lib/stores/shares.ts`

## Runtime Model (Client/Server)

- Most UI is client-rendered; several routes explicitly disable SSR (`export const ssr = false`) because they rely on browser-only APIs (camera, TFJS, AudioContext, Web Workers, clipboard, etc.).
- The backend is “API only”: SvelteKit server routes read/write SQLite and the `data/` directory.
- A session cookie (`kb_session`) is the primary identity mechanism. If absent/expired, the server creates an anonymous user and session automatically.

## Persistence

### SQLite database

Location:

- `data/kb_suite.db` (created at runtime; directory is created if missing).
- In Docker, `docker-compose.yml` mounts a volume to `/app/data` to persist the DB and HR files.

Initialization and migrations:

- `src/lib/server/db.ts` opens the DB, enables foreign keys, creates tables if missing, and performs lightweight column/table migrations.
- Template workouts are seeded into the `workouts` table from `src/lib/timer/library/*` YAML sources.

Core tables (simplified):

- `users`: anonymous + registered accounts (`username`, salted password hash, `is_anonymous`).
- `sessions`: session tokens with expiry.
- `settings`: per-user JSON blob (server-synced; API key remains local-only).
- `workouts`: user workouts + seeded templates (`is_template`), stores YAML + `plan_json`.
- `planned_workouts`: scheduled sessions for a date/time, stores YAML + `plan_json`, `notes`, `tags`.
- `completed_workouts`: completed session metadata (title, timestamps, duration, notes, rpe, tags).
- `completed_sets`: per-workout rows (phase index, position, labels, reps, weight, duration, type, rpe, auto-filled flag).
- `shared_workout_invites`: planned workouts shared between users; accepting clones into `planned_workouts`.

### Filesystem storage (HR attachments)

- HR files are stored under `data/hr/<completed_workout_id>/`.
- Upload supports `.fit`, `.tcx`, or `.zip` containing a single `.fit`/`.tcx`.
- A parsed `summary.json` is cached next to the upload for quick reads.

## Settings and Theming

- `src/lib/stores/settings.ts` is the canonical client store.
  - Persists to `localStorage` (theme, timer/counter settings, local-only OpenAI API key, and insights prompt).
  - Syncs non-secret settings to `PUT /api/settings` (API key is intentionally not sent).
  - Pulls initial server settings from `GET /api/settings` and merges into local settings.
- Theme variables live in `src/app.css` and are applied via `document.documentElement[data-theme]`.

## Workout Plan Format (YAML → Timeline)

Primary representation:

- YAML editor content is parsed with `yaml` and normalized into a `plan` object with:
  - `title`, optional `description`
  - optional `preStartSeconds`/`preStartLabel`
  - `rounds[]`, each with `label`, `repetitions`, `restAfterSeconds`, and `sets[]`
  - `sets[]` include `workSeconds`, `restSeconds`, `transitionSeconds`, `repetitions`, optional `targetRpm`, and optional announcement blocks
  - rep-counter directives in plan/set metadata (`defaultRepCounterMode`, `enableRepCounter`, `enableModeChanging`, and per-set overrides).

Timeline:

- `src/lib/timer/lib/timeline.js` converts the plan into a flattened list of phases:
  - `prep`, `work`, `rest`, `transition`, `roundRest`, `roundTransition`
  - Each phase includes `duration`/`durationSeconds`, labels, indices, and metadata for display and rep-counter behavior.

Validation/editor experience:

- `src/lib/timer/components/shared/YamlConfigEditor.svelte` uses Monaco (when available) and Ajv against `src/lib/timer/config/workout-schema.json`.

## Timer Architecture

- Main UI: `src/lib/timer/TimerApp.svelte`
  - Owns the active plan, timeline, preview parser, and session state (running/paused/stopped/completed).
  - Exposes imperative methods (`start`, `pause`, `resume`, `stop`) and dispatches events (`start`, `pause`, `resume`, `stop`, `phaseChange`).
  - Integrates:
    - Audio cues/metronome (`src/lib/timer/lib/audio.js`)
    - Announcement scheduling (`src/lib/timer/lib/ttsScheduler.js`)
    - OpenAI TTS (`src/lib/timer/lib/openaiTts.js`)
    - Workout summary logging (`src/lib/stats/summaryStore.ts`)
- Timing:
  - High precision ticking is handled by a Web Worker: `src/lib/timer/workers/timerWorker.js`.
  - The worker receives the timeline and emits `started`, `phaseStarted`, `tick`, `paused`, `resumed`, `completed`, `stopped`.

## Rep Counter Architecture

- Main UI: `src/lib/counter/CounterApp.svelte` + `src/lib/counter/components/PoseSession.svelte`.
- State: `src/lib/counter/stores/session.ts` stores run state, rep count, pose stats, and selected mode.
- Core logic: `src/lib/counter/pose/*` (repCounter, tracking, calibration, gestures).
- Uses TFJS + pose detection, with a worker (`src/lib/counter/pose/pose.worker.ts`) for heavier processing.
- In “Big Picture”, the timer controls the rep counter per phase (enable/disable, allow gestures, set mode).

## Completed Workouts and Summary Logging

- The summary modal is global (mounted in `src/routes/+layout.svelte`) and driven by `src/lib/stats/summaryStore.ts`.
- `TimerApp` builds “summary entries” from the timeline and writes rep counts into them (auto-fill) based on the live rep counter.
- Saving the summary creates a `completed_workouts` + `completed_sets` record via `POST /api/completed-workouts`.
- `/history` provides editing of existing completed workouts via `PUT /api/completed-workouts/[id]` and supports HR attachment via `/hr`.

## Sharing Planned Workouts

- Sharing requires a non-anonymous (registered) user.
- `POST /api/planned-workouts/[id]/share` creates an invite for a recipient username.
- Recipient sees pending invites via `GET /api/shared-workouts?scope=incoming&status=pending`.
- Accept/reject/seen is done via `PATCH /api/shared-workouts/[id]`.
- Accept clones the planned workout into recipient’s `planned_workouts`.

## PWA / Service Worker

- `src/service-worker.ts` caches the SvelteKit build output and static assets and serves them from cache for same-origin `GET` requests.
- Manifest: `static/manifest.webmanifest` (see `src/app.html`).

## Deployment

- Docker build/run:
  - `Dockerfile` installs dependencies, runs `npm run build`, then serves via `npm run preview -- --host 0.0.0.0 --port 4173`.
  - `docker-compose.yml` runs the image and mounts the external volume `kb_suite_data` to `/app/data`.

## Commands

- Dev server: `npm run dev`
- Typecheck: `npm run check`
- Build: `npm run build`
- Preview: `npm run preview`

