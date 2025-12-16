# KB Suite — Issues / Bugs Backlog

This file is for confirmed or strongly suspected bugs discovered via code review and “expected user flow” simulation. Keep entries small, actionable, and reproducible.

## Legend

- **Severity**: High (data loss / security), Medium (frequent UX break), Low (edge case / polish).
- **Scope**: `timer`, `planner`, `history`, `workouts`, `settings`, `sharing`, `infra`.

---

## [x] ISSUE-001 — Summary modal can wipe in-progress edits while open

- **Severity**: Medium
- **Scope**: `timer`, `summary`
- **Where**: `src/lib/stats/WorkoutSummaryModal.svelte`
- **Symptom**: While the modal is open, user edits to reps/weight can get reset unexpectedly.
- **Why**: The reactive block resets `localEntries = entries.map(...)` whenever `open` is true *and* `entries` changes, not only on open transition.
- **Repro idea**:
  1. Open Summary.
  2. Edit a couple reps/weights (do not press Save).
  3. Cause `entries` prop to update (e.g., timer updates summary entries, rep counter auto-fill, or re-opening summary from another component).
  4. Observe edits revert.
- **Expected**: Local edits persist until the user closes or saves.
- **Status**: Fixed (snapshot only on open; preserve dirty rows during prop updates).

## [x] ISSUE-002 — Settings modal local state resets / leaks due to reactive mirroring of store objects

- **Severity**: Medium
- **Scope**: `settings`
- **Where**: `src/lib/components/SettingsModal.svelte`
- **Symptoms**:
  - In-progress edits may reset if `$settings` changes while the modal is open.
  - Some edits may leak into the global settings object due to reference sharing (especially `localTimer = $settings.timer`).
- **Why**:
  - Reactive assignments (`$:`) mirror `$settings.*` into local variables continuously.
  - `localTimer` is assigned by reference (not cloned), so `bind:value={localTimer.openAiVoice}` may mutate the original object even before “Save”.
- **Expected**: Local modal edits are isolated until Save; Cancel always discards.
- **Status**: Fixed (snapshot on open; clone nested objects so bindings don’t mutate store).

## [x] ISSUE-003 — `PUT /api/completed-workouts/[id]` can delete all sets if client omits `entries`

- **Severity**: High
- **Scope**: `history`, `api`
- **Where**: `src/routes/api/completed-workouts/[id]/+server.ts`
- **Symptom**: Updating only metadata (title/notes/tags) without sending `entries` will still delete all `completed_sets`.
- **Why**: The handler unconditionally runs `DELETE FROM completed_sets ...` and only re-inserts if `Array.isArray(entries) && entries.length`.
- **Expected**: Sets remain unchanged unless entries are explicitly provided.
- **Status**: Fixed (only rewrites sets when `entries` is present; empty array clears sets explicitly).

## [x] ISSUE-004 — HR endpoints don’t verify ownership (read/write/delete)

- **Severity**: High
- **Scope**: `history`, `api`, `security`
- **Where**: `src/routes/api/completed-workouts/[id]/hr/+server.ts`
- **Symptom**: Any user with a session cookie can potentially read/upload/delete HR files for any `completed_workout_id` they can guess.
- **Why**: Endpoints call `ensureSessionUser(...)` but never verify `completed_workouts.user_id` matches the session user.
- **Expected**: HR operations are restricted to the owner of the completed workout.
- **Status**: Fixed (ownership enforced; consistent JSON responses; session cookie refreshed).

## [x] ISSUE-005 — Removing HR file does not clear derived workout time fields

- **Severity**: Medium
- **Scope**: `history`, `api`
- **Where**: `src/routes/api/completed-workouts/[id]/hr/+server.ts` (DELETE)
- **Decision**: Removing an HR attachment should **not** modify the workout’s timestamps/duration; it only removes the attachment. Users can edit times in History if needed.
- **Status**: Closed (by design; removed a no-op DB update on delete).

## [x] ISSUE-006 — Template workouts can be deleted from the DB by any user

- **Severity**: Medium
- **Scope**: `workouts`, `api`
- **Where**: `src/routes/api/workouts/[id]/+server.ts`
- **Symptom**: `DELETE FROM workouts WHERE id = ? AND (owner_id = ? OR owner_id IS NULL)` allows deleting rows with `owner_id IS NULL` (seeded templates).
- **Expected**: Templates are immutable globally; only user-owned workouts are deletable.
- **Status**: Fixed (API delete restricted to `owner_id = session.userId` and `is_template = 0`).

## [x] ISSUE-007 — Planned/workout upserts can update other users’ rows if IDs leak

- **Severity**: High (security)
- **Scope**: `planner`, `workouts`, `api`, `security`
- **Where**:
  - `src/routes/api/planned-workouts/+server.ts` (POST uses `ON CONFLICT(id) DO UPDATE` without ownership check)
  - `src/routes/api/workouts/+server.ts` (POST can overwrite by id)
- **Symptom**: If an attacker can obtain another user’s `id`, they can potentially update that row via conflict upsert.
- **Expected**: Server must enforce `user_id/owner_id` ownership on updates.
- **Status**: Fixed (replaced blind conflict-upserts with ownership-checked insert/update paths).

## [x] ISSUE-008 — Timer modal scroll-lock is inconsistent / sometimes ineffective

- **Severity**: Low/Medium (UX)
- **Scope**: `timer`, `ux`
- **Where**:
  - `src/lib/timer/TimerApp.svelte` toggles `document.body.classList.toggle('modal-open', ...)`
  - No global CSS consistently defines `body.modal-open { overflow: hidden; }` for all routes
- **Symptom**: Some modals (especially inside Timer) may not prevent background scrolling, depending on which route CSS is currently loaded.
- **Expected**: Consistent scroll locking whenever any modal is open.
- **Status**: Fixed (global `body.modal-open` styling + Timer toggles for all its modals).

## [x] ISSUE-009 — History HR probing is heavy (N requests with `details=1`)

- **Severity**: Medium (perf)
- **Scope**: `history`, `performance`
- **Where**: `src/routes/history/+page.svelte` (`loadHistory` → `items.forEach(checkHrStatus)`; `checkHrStatus` fetches `.../hr?details=1`)
- **Symptom**: Initial History load can issue up to ~200 HR detail requests and download samples for each attached session.
- **Expected**: Lightweight status check on load; fetch full details only when expanding a session or when rendering a chart.
- **Status**: Fixed (initial probe uses lightweight `/hr` without samples + concurrency limiting).

## [x] ISSUE-010 — `checkHrStatus` duplicates hrDetails assignment

- **Severity**: Low
- **Scope**: `history`
- **Where**: `src/routes/history/+page.svelte` (`checkHrStatus`)
- **Symptom**: `hrDetails` is assigned twice in the same code path when samples exist.
- **Expected**: Single coherent assignment.
- **Status**: Fixed (removed duplicate assignment; initial probe no longer touches `hrDetails`).

## [x] ISSUE-011 — Worker messages apply rep finalization before tickId validation

- **Severity**: Low/Medium (edge-case correctness)
- **Scope**: `timer`, `big-picture`
- **Where**: `src/lib/timer/TimerApp.svelte` worker message handler (`phaseStarted`, `completed`)
- **Symptom**: Rep “finalization” is executed before verifying that an incoming worker message belongs to the current timer run (`tickId`).
- **Expected**: Ignore stale messages entirely.
- **Status**: Fixed (guards now run before rep finalization side effects).

## [x] ISSUE-012 — Summary plan key ignores rest/transition phases

- **Severity**: Low (data consistency / UX)
- **Scope**: `timer`, `summary`
- **Where**: `src/lib/timer/TimerApp.svelte` (`buildSummaryKey`)
- **Symptom**: Changes that only affect rest/transition phases may not trigger a summary entries rebuild because the key only includes work phases.
- **Expected**: Summary entries reflect the plan currently displayed/run.
- **Status**: Fixed (summary key now includes all non-prep phases).
