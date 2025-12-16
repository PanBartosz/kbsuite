# KB Suite — UX/UI Improvements Backlog

This file captures UX/UI ideas discovered while simulating typical workflows (plan → run → log → review). Keep items concrete and user-outcome focused; convert into tickets as needed.

## Typical User Flow (baseline)

1. **Plan** a session on `/plan` (calendar, notes, tags, YAML).
2. **Run** it via `/timer` or `/big-picture`.
3. **Log** reps/weight at the end (Summary modal).
4. **Review** in `/history` (search, filters, HR upload, edits, comparisons).

## High-impact (P0)

- [ ] **Planner ↔ History connection**: after saving a completed workout, offer “Mark today’s plan as done” / “Attach to plan” (or auto-link by plannedId) so the day’s plan reflects completion.
- [ ] **History performance**: avoid doing N HR detail requests on load; lazy-load HR details only when a card is expanded or an HR chart is shown.

## Medium (P1)

- [ ] **Improve input ergonomics on mobile**:
  - [ ] Larger tap targets for small buttons (especially in dense tables/modals).
  - [x] Use numeric keypad-friendly inputs (`inputmode="numeric"`) for reps/weight/time fields.
  - [ ] Reduce horizontal tables; prefer stacked cards for narrow widths.
- [ ] **Accessibility pass**:
  - [x] Ensure all icon buttons have `aria-label`.
  - [ ] Keyboard navigation works for menus and modals.
  - [ ] Color-contrast check for all themes (especially “neon/vibrant”).

## Nice-to-have (P2)

- [ ] **Self-host critical UI assets**: icons/fonts currently depend on CDNs; consider bundling RemixIcon and fonts into `static/` for offline reliability and faster cold loads.
- [ ] **Inline “what changed” indicators** in YAML editors: highlight parse/validation issues inline and make it easy to jump to the affected round/set.
- [ ] **Guided “first workout” onboarding**: a short wizard that helps users pick a template, start timer, and log a first session.
- [ ] **Smarter tagging UX**: tag suggestions/autocomplete; tag chips that can be toggled quickly; consistent tag handling across Planner + History + Workouts.
- [ ] **Export/import**:
  - Export a completed workout as structured JSON/CSV in addition to image/text summary.
  - Backup/restore DB (or selected tables) for portability.

## Low-hanging fruit (quick wins)

These can be implemented without major architectural changes, mostly by improving existing screens and flows:

- [x] **Workout complete → Log now** (P0): auto-open Summary on completion or show a prominent CTA.
- [x] **Workouts search/filter** (P1): client-side search + “Templates / Mine” filters.
- [x] **History create-log UX** (P1): auto-open editor for the newly created log and scroll it into view (keeps the edited item visible under filters).
- [ ] **Mobile input ergonomics** (P1): numeric keyboard done; still needs bigger tap targets + fewer horizontal tables.
- [x] **Accessibility quick wins** (P1): `aria-label` for icon buttons + fix existing a11y warnings.
- [ ] **HR lazy-load** (P0, optional): defer HR detail fetch until a card is expanded / chart is shown.

## Iteration 1 — shipped ✅

1. **Workout complete → Log now**
   - **Approach**: add `settings.timer.autoOpenSummaryOnComplete` (default `true`) and open the Summary modal when the workout reaches “completed”; if disabled, show a persistent “Log results” CTA.
   - **Files**: `src/lib/timer/TimerApp.svelte`, `src/lib/components/SettingsModal.svelte`, (Big Picture if it bypasses `TimerApp`).
   - **Done when**: finishing a workout reliably offers immediate logging on desktop + mobile (no extra navigation).

2. **History create-log UX**
   - **Approach**: after creating a manual log or “log from template”, set `editingId` to the new item, prefill edit state, expand the card, and `scrollIntoView` the new card container.
   - **Files**: `src/routes/history/+page.svelte`.
   - **Done when**: the new log is editable immediately without searching for it in the list.

3. **Workouts search/filter**
   - **Approach**: add a search input + filter chips/toggles (`All / Mine / Templates`); filter by name/description/tags; optionally persist query in URL (`?q=`).
   - **Files**: `src/routes/workouts/+page.svelte`.
   - **Done when**: users can find a workout/template quickly on both desktop and mobile.

4. **Mobile input ergonomics**
   - **Approach**: add `inputmode`/`enterkeyhint`/`step`/`min` to numeric fields (reps/weight/duration/RPE); increase tap targets for +/- or small buttons; prefer stacked inputs on narrow widths.
   - **Files**: `src/lib/stats/WorkoutSummaryModal.svelte`, `src/routes/history/+page.svelte` (edit form inputs).
   - **Done when**: numeric keypad opens consistently and the editor is usable without pinch-zoom.

5. **Accessibility quick wins**
   - **Approach**: fix current a11y warnings in Planner; ensure icon-only buttons have `aria-label`; ensure keyboard focus + Enter/Space activation on interactive non-buttons.
   - **Files**: `src/routes/plan/+page.svelte`, plus any shared components with icon-only actions.
   - **Done when**: `npm run check` no longer reports the existing Planner a11y warnings and the main flows are keyboard-usable.

## Iteration 2 — selected 5 (best ROI)

1. **History performance: HR lazy-load (P0)**
   - **Approach**: on initial History load, fetch only HR “attached + avg/max” (no samples). Load `details=1` samples only when a session is expanded / compared / shared (or user explicitly requests chart).
   - **Files**: `src/routes/history/+page.svelte` (+ small adjustments in `src/routes/api/completed-workouts/[id]/hr/+server.ts` only if needed).
   - **Done when**: History opens fast even with many sessions; HR sparklines appear when you expand a session (without spamming N detail requests on load).

2. **Consistent toasts + actions (P1)** ✅ shipped
   - **Approach**: add a shared toast store + `ToastStack` component used from the layout; support optional action buttons (e.g., “View in history”, “Undo” where possible).
   - **Files**: new `src/lib/stores/toasts.ts`, new `src/lib/components/ToastStack.svelte`, updates in routes using local toasts.
   - **Done when**: all pages show consistent toasts and key flows offer helpful one-click follow-ups.

3. **Unify modal behavior globally (P0)** ✅ shipped
   - **Approach**: introduce a small shared modal shell/action (Escape-to-close, focus trap, consistent backdrop behavior, scroll lock, ARIA); migrate the most-used modals first.
   - **Files**: new `src/lib/components/ModalShell.svelte` (or `src/lib/actions/modal.ts`), update existing modal components/pages.
   - **Done when**: modals behave the same everywhere and eliminate “can’t scroll / can’t close” edge cases.

4. **Mobile-first Big Picture layout (P0)** ✅ shipped (stacked layout; no tabs)
   - **Approach**: on narrow screens, stack Timer + Counter vertically; keep split layout on desktop.
   - **Files**: `src/routes/big-picture/+page.svelte`, `src/lib/timer/components/TimerDisplay.svelte`.
   - **Done when**: Big Picture is comfortable to use on phones without cramped side-by-side content.

5. **Finish mobile input ergonomics (P1)**
   - **Approach**: enforce 44px+ tap targets for icon buttons and tighten responsive layouts to avoid horizontal tables (especially History edit rows + Summary).
   - **Files**: `src/routes/history/+page.svelte`, `src/lib/stats/WorkoutSummaryModal.svelte`, shared button styles in `src/app.css`.
   - **Done when**: editing sets is fast on mobile (no accidental taps, no horizontal scrolling).
