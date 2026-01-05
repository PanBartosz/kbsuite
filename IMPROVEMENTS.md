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
  - [ ] Reduce horizontal tables; prefer stacked cards for narrow widths.
- [ ] **History “Workout Journal” notes (Markdown + templates)**:
  - [ ] Replace single-line notes with a multi-line editor (autosize textarea; full-screen modal on mobile).
  - [ ] Markdown formatting with quick toolbar + live preview; render formatted notes in the History card (collapsed preview + expand).
  - [ ] KB sport–friendly templates/snippets (goal → main set → splits/pacing → technique cues → recovery → next time) + one-click insert.
  - [ ] “Smart inserts”: inject session stats (duration, total reps, avg/max HR, RPE, tags) and link to similar sessions/last time notes.
  - [ ] Timeline markers: `@mm:ss` lines become pins on the HR chart/phase timeline for competition-set analysis.
- [ ] **Accessibility pass**:
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

- [ ] **Mobile input ergonomics** (P1): numeric keyboard done; still needs bigger tap targets + fewer horizontal tables.
- [ ] **HR lazy-load** (P0, optional): defer HR detail fetch until a card is expanded / chart is shown.

## Iteration 2 — selected 5 (best ROI)

1. **History performance: HR lazy-load (P0)**
   - **Approach**: on initial History load, fetch only HR “attached + avg/max” (no samples). Load `details=1` samples only when a session is expanded / compared / shared (or user explicitly requests chart).
   - **Files**: `src/routes/history/+page.svelte` (+ small adjustments in `src/routes/api/completed-workouts/[id]/hr/+server.ts` only if needed).
   - **Done when**: History opens fast even with many sessions; HR sparklines appear when you expand a session (without spamming N detail requests on load).

5. **Finish mobile input ergonomics (P1)**
   - **Approach**: enforce 44px+ tap targets for icon buttons and tighten responsive layouts to avoid horizontal tables (especially History edit rows + Summary).
   - **Files**: `src/routes/history/+page.svelte`, `src/lib/stats/WorkoutSummaryModal.svelte`, shared button styles in `src/app.css`.
   - **Done when**: editing sets is fast on mobile (no accidental taps, no horizontal scrolling).
