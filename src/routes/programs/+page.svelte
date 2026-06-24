<script lang="ts">
  import { onMount } from 'svelte'
  import { defaultDepTotalWorkSpec, type DepTotalWorkSpec } from '$lib/programming/adapters/dep-total-work'
  import { pushToast } from '$lib/stores/toasts'

  type ProgramWorkout = {
    id: string
    planned_workout_id?: string | null
    completed_workout_id?: string | null
    cycle_index: number
    day_index: number
    role: string
    title: string
    planned_for?: number | null
    status: string
    planned_metrics: Record<string, any>
    actual_metrics?: Record<string, any> | null
  }

  type ProgramRun = {
    id: string
    kind: string
    title: string
    status: string
    spec: DepTotalWorkSpec
    workouts: ProgramWorkout[]
    summary: Record<string, any>
    created_at: number
    updated_at: number
  }

  type PreviewWorkout = {
    title: string
    cycleIndex: number
    dayIndex: number
    role: string
    plannedFor: number
    yamlSource: string
    plannedMetrics: Record<string, any>
  }

  let spec: DepTotalWorkSpec = defaultDepTotalWorkSpec()
  let runs: ProgramRun[] = []
  let selectedRun: ProgramRun | null = null
  let previewWorkouts: PreviewWorkout[] = []
  let compareCandidates: ProgramRun[] = []
  let loading = false
  let previewLoading = false
  let saving = false
  let generating = false
  let compareLoading = false
  let compareRequested = false
  let error = ''
  let selectedPreview: PreviewWorkout | null = null

  const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value))
  const dayNames = ['Day 1', 'Day 2', 'Day 3', 'Day 4', 'Day 5', 'Day 6']

  const formatDate = (ts?: number | null) =>
    ts ? new Date(ts).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) : '-'

  const formatWork = (value: any) => {
    const n = Number(value)
    return Number.isFinite(n) ? Math.round(n).toLocaleString() : '-'
  }

  const resetToDefaults = () => {
    spec = defaultDepTotalWorkSpec()
    previewWorkouts = []
    selectedPreview = null
  }

  const toggleRestAfter = (day: number) => {
    const set = new Set(spec.schedule.restAfterDays)
    if (set.has(day)) {
      set.delete(day)
    } else {
      set.add(day)
    }
    spec = {
      ...spec,
      schedule: {
        ...spec.schedule,
        restAfterDays: Array.from(set).sort((a, b) => a - b)
      }
    }
  }

  const loadPrograms = async () => {
    loading = true
    error = ''
    try {
      const res = await fetch('/api/program-runs')
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error ?? 'Failed to load programs')
      runs = data?.items ?? []
      if (!selectedRun && runs.length) selectedRun = runs[0]
    } catch (err) {
      error = (err as any)?.message ?? 'Failed to load programs'
      pushToast(error, 'error')
    } finally {
      loading = false
    }
  }

  const refreshRun = async (id: string) => {
    const res = await fetch(`/api/program-runs/${id}`)
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data?.error ?? 'Failed to load program run')
    selectedRun = data.item
    runs = runs.map((run) => (run.id === data.item.id ? data.item : run))
  }

  const previewSpec = async () => {
    previewLoading = true
    error = ''
    try {
      const res = await fetch('/api/program-runs/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spec })
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error ?? 'Preview failed')
      spec = data.spec
      previewWorkouts = data.workouts ?? []
      selectedPreview = previewWorkouts[0] ?? null
    } catch (err) {
      error = (err as any)?.message ?? 'Preview failed'
      pushToast(error, 'error')
    } finally {
      previewLoading = false
    }
  }

  const createRun = async () => {
    saving = true
    error = ''
    try {
      const res = await fetch('/api/program-runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spec })
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error ?? 'Failed to save program')
      selectedRun = data.item
      runs = [data.item, ...runs.filter((run) => run.id !== data.item.id)]
      pushToast('Program saved.', 'success')
      return data.item as ProgramRun
    } catch (err) {
      error = (err as any)?.message ?? 'Failed to save program'
      pushToast(error, 'error')
      return null
    } finally {
      saving = false
    }
  }

  const generateRun = async (run: ProgramRun | null = selectedRun) => {
    if (!run) return
    generating = true
    error = ''
    try {
      const res = await fetch(`/api/program-runs/${run.id}/generate`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error ?? 'Failed to generate planner entries')
      selectedRun = data.item
      runs = runs.map((item) => (item.id === data.item.id ? data.item : item))
      pushToast(`Generated ${data?.planned?.length ?? 0} planner entries.`, 'success')
    } catch (err) {
      error = (err as any)?.message ?? 'Failed to generate planner entries'
      pushToast(error, 'error')
    } finally {
      generating = false
    }
  }

  const saveAndGenerate = async () => {
    const run = await createRun()
    if (run) await generateRun(run)
  }

  const selectRun = async (run: ProgramRun) => {
    selectedRun = run
    compareCandidates = []
    compareRequested = false
    try {
      await refreshRun(run.id)
    } catch (err) {
      pushToast((err as any)?.message ?? 'Failed to refresh program', 'error')
    }
  }

  const compareRun = async () => {
    if (!selectedRun) return
    compareLoading = true
    compareRequested = true
    try {
      const res = await fetch(`/api/program-runs/${selectedRun.id}/compare`)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error ?? 'Failed to compare program runs')
      selectedRun = data.source
      compareCandidates = data.candidates ?? []
    } catch (err) {
      pushToast((err as any)?.message ?? 'Failed to compare program runs', 'error')
    } finally {
      compareLoading = false
    }
  }

  const openTimer = (plannedId?: string | null) => {
    if (!plannedId) return
    window.location.href = `/timer?planned=${encodeURIComponent(plannedId)}`
  }

  const openBigPicture = (plannedId?: string | null) => {
    if (!plannedId) return
    window.location.href = `/big-picture?planned=${encodeURIComponent(plannedId)}`
  }

  onMount(loadPrograms)
</script>

<div class="programs-page">
  <header class="programs-header">
    <div>
      <p class="eyebrow">Programming</p>
      <h1>Programs</h1>
      <p class="muted">Generate program blocks as normal planner workouts, then compare completed runs over time.</p>
    </div>
    <div class="header-actions">
      <button type="button" class="ghost" on:click={resetToDefaults}>DEP defaults</button>
      <button type="button" on:click={previewSpec} disabled={previewLoading}>
        {previewLoading ? 'Previewing...' : 'Preview'}
      </button>
      <button type="button" on:click={saveAndGenerate} disabled={saving || generating}>
        {saving || generating ? 'Working...' : 'Save + generate'}
      </button>
    </div>
  </header>

  {#if error}
    <p class="error">{error}</p>
  {/if}

  <div class="program-grid">
    <section class="panel wizard">
      <div class="section-head">
        <h2>DEP Total Work Wizard</h2>
        <p class="muted small">Adapter: {spec.kind}</p>
      </div>

      <div class="form-grid">
        <label>
          Program title
          <input bind:value={spec.title} />
        </label>
        <label>
          Start date
          <input type="date" bind:value={spec.startDate} />
        </label>
        <label>
          Microcycles
          <input type="number" min="1" max="12" bind:value={spec.schedule.microcycles} />
        </label>
        <label>
          Projected N change / microcycle
          <input type="number" bind:value={spec.progression.projectedRepsPerMicrocycle} />
        </label>
      </div>

      <h3>Primary</h3>
      <div class="form-grid">
        <label>
          Exercise
          <input bind:value={spec.primary.exercise} />
        </label>
        <label>
          High load
          <input type="number" min="1" step="0.5" bind:value={spec.primary.highLoad} />
        </label>
        <label>
          Low load
          <input type="number" min="1" step="0.5" bind:value={spec.primary.lowLoad} />
        </label>
        <label>
          Day 1 N
          <input type="number" min="1" bind:value={spec.primary.baselineReps} />
        </label>
        <label>
          Baseline status
          <select bind:value={spec.primary.baselineStatus}>
            <option value="valid">valid</option>
            <option value="provisional">provisional</option>
            <option value="projected">projected</option>
          </select>
        </label>
        <label>
          Test minutes
          <input type="number" min="1" bind:value={spec.primary.testDurationMinutes} />
        </label>
        <label>
          Symmetry multiple
          <input type="number" min="1" bind:value={spec.primary.symmetryMultiple} />
        </label>
        <label>
          Counter mode
          <select bind:value={spec.primary.repCounterMode}>
            <option value="lockout">lockout</option>
            <option value="swing">swing</option>
            <option value="disabled">disabled</option>
          </select>
        </label>
      </div>

      <h3>Workout Format</h3>
      <div class="form-grid">
        <label>
          Warmup minutes
          <input type="number" min="0" bind:value={spec.workoutFormat.warmupMinutes} />
        </label>
        <label>
          Cooldown minutes
          <input type="number" min="0" bind:value={spec.workoutFormat.cooldownMinutes} />
        </label>
        <label>
          Transition minutes
          <input type="number" min="0" bind:value={spec.workoutFormat.transitionMinutes} />
        </label>
        <label>
          Primary format
          <select bind:value={spec.workoutFormat.primaryFormat}>
            <option value="emom">EMOM minute tracking</option>
            <option value="continuous">continuous block</option>
          </select>
        </label>
        <label>
          Primary minutes
          <input type="number" min="1" bind:value={spec.workoutFormat.primaryMinutes} />
        </label>
      </div>

      <h3>Calendar Rest Days</h3>
      <div class="rest-days">
        {#each dayNames as label, idx}
          {@const day = idx + 1}
          <label class="check">
            <input
              type="checkbox"
              checked={spec.schedule.restAfterDays.includes(day)}
              on:change={() => toggleRestAfter(day)}
            />
            Rest after {label}
          </label>
        {/each}
      </div>

      <h3>Secondary Work</h3>
      <div class="secondary-list">
        {#each spec.secondary as slot, idx}
          <div class="secondary-row">
            <div class="day-label">D{idx + 1}</div>
            <label class="check">
              <input type="checkbox" bind:checked={slot.enabled} />
              On
            </label>
            <input aria-label="Secondary exercise" bind:value={slot.exercise} />
            <select aria-label="Secondary format" bind:value={slot.format}>
              <option value="none">none</option>
              <option value="lr-emom">left/right EMOM</option>
              <option value="timed">timed block</option>
              <option value="regular-sets">regular sets</option>
            </select>
            <label>
              kg
              <input type="number" step="0.5" bind:value={slot.load} />
            </label>
            <label>
              min
              <input type="number" min="1" bind:value={slot.minutes} />
            </label>
            <label>
              rounds
              <input type="number" min="1" bind:value={slot.rounds} />
            </label>
            <label>
              sets
              <input type="number" min="1" bind:value={slot.sets} />
            </label>
            <label>
              work s
              <input type="number" min="10" bind:value={slot.workSeconds} />
            </label>
            <label>
              rest s
              <input type="number" min="0" bind:value={slot.restSeconds} />
            </label>
            <select aria-label="Secondary counter mode" bind:value={slot.repCounterMode}>
              <option value="disabled">counter off</option>
              <option value="lockout">lockout</option>
              <option value="swing">swing</option>
            </select>
          </div>
        {/each}
      </div>
    </section>

    <aside class="panel runs">
      <div class="section-head">
        <h2>Saved Runs</h2>
        <button type="button" class="ghost small" on:click={loadPrograms} disabled={loading}>
          Refresh
        </button>
      </div>
      {#if loading}
        <p class="muted">Loading...</p>
      {:else if runs.length === 0}
        <p class="muted">No program runs yet.</p>
      {:else}
        <div class="run-list">
          {#each runs as run}
            <button
              type="button"
              class:active={selectedRun?.id === run.id}
              on:click={() => selectRun(run)}
            >
              <strong>{run.title}</strong>
              <span>{run.status} · {run.workouts?.length ?? 0} days</span>
            </button>
          {/each}
        </div>
      {/if}
      <button type="button" class="ghost" on:click={createRun} disabled={saving}>
        {saving ? 'Saving...' : 'Save without generating'}
      </button>
    </aside>
  </div>

  {#if previewWorkouts.length}
    <section class="panel">
      <div class="section-head">
        <h2>Preview</h2>
        <p class="muted small">{previewWorkouts.length} generated workouts</p>
      </div>
      <div class="day-table">
        <div class="table-head">
          <span>Date</span><span>Day</span><span>Role</span><span>Primary</span><span>Work</span><span></span>
        </div>
        {#each previewWorkouts as workout}
          <button type="button" class="table-row" on:click={() => (selectedPreview = workout)}>
            <span>{formatDate(workout.plannedFor)}</span>
            <span>C{workout.cycleIndex}D{workout.dayIndex}</span>
            <span>{workout.role}</span>
            <span>{workout.plannedMetrics.primaryReps} reps @ {workout.plannedMetrics.primaryLoad}kg</span>
            <span>{formatWork(workout.plannedMetrics.primaryWork)}</span>
            <span>YAML</span>
          </button>
        {/each}
      </div>
      {#if selectedPreview}
        <details class="yaml-preview" open>
          <summary>{selectedPreview.title}</summary>
          <pre>{selectedPreview.yamlSource}</pre>
        </details>
      {/if}
    </section>
  {/if}

  {#if selectedRun}
    <section class="panel">
      <div class="section-head">
        <div>
          <h2>{selectedRun.title}</h2>
          <p class="muted small">{selectedRun.status} · {selectedRun.kind}</p>
        </div>
        <div class="header-actions">
          <button type="button" class="ghost" on:click={() => generateRun(selectedRun)} disabled={generating || selectedRun.workouts.length > 0}>
            {generating ? 'Generating...' : 'Generate planner entries'}
          </button>
          <button type="button" class="ghost" on:click={compareRun} disabled={compareLoading}>
            {compareLoading ? 'Comparing...' : 'Compare'}
          </button>
        </div>
      </div>

      <div class="metric-strip">
        <div><span>Days</span><strong>{selectedRun.summary.completedDays ?? 0}/{selectedRun.summary.totalDays ?? 0}</strong></div>
        <div><span>Planned work</span><strong>{formatWork(selectedRun.summary.plannedPrimaryWork)}</strong></div>
        <div><span>Actual work</span><strong>{formatWork(selectedRun.summary.actualPrimaryWork)}</strong></div>
        <div><span>Completion</span><strong>{selectedRun.summary.completionPercent ?? '-'}%</strong></div>
      </div>

      {#if selectedRun.workouts.length === 0}
        <p class="muted">This run is saved but has not generated planner entries yet.</p>
      {:else}
        <div class="day-table">
          <div class="table-head">
            <span>Date</span><span>Day</span><span>Status</span><span>Planned</span><span>Actual</span><span>Actions</span>
          </div>
          {#each selectedRun.workouts as workout}
            <div class="table-row static">
              <span>{formatDate(workout.planned_for)}</span>
              <span>C{workout.cycle_index}D{workout.day_index} · {workout.role}</span>
              <span>{workout.status}</span>
              <span>{workout.planned_metrics.primaryReps} @ {workout.planned_metrics.primaryLoad}kg</span>
              <span>
                {#if workout.actual_metrics}
                  {workout.actual_metrics.primaryReps ?? workout.actual_metrics.totalReps ?? '-'} reps
                {:else}
                  -
                {/if}
              </span>
              <span class="row-actions">
                <button type="button" class="ghost small" on:click={() => openTimer(workout.planned_workout_id)} disabled={!workout.planned_workout_id}>Timer</button>
                <button type="button" class="ghost small" on:click={() => openBigPicture(workout.planned_workout_id)} disabled={!workout.planned_workout_id}>Big</button>
              </span>
            </div>
          {/each}
        </div>
      {/if}
    </section>
  {/if}

  {#if compareCandidates.length}
    <section class="panel">
      <div class="section-head">
        <h2>Run Comparison</h2>
        <p class="muted small">Same adapter, newest first</p>
      </div>
      <div class="compare-grid">
        {#each compareCandidates as candidate}
          <article>
            <h3>{candidate.title}</h3>
            <p class="muted small">{candidate.status} · {formatDate(candidate.created_at)}</p>
            <div class="metric-strip compact">
              <div><span>Days</span><strong>{candidate.summary.completedDays ?? 0}/{candidate.summary.totalDays ?? 0}</strong></div>
              <div><span>Planned</span><strong>{formatWork(candidate.summary.plannedPrimaryWork)}</strong></div>
              <div><span>Actual</span><strong>{formatWork(candidate.summary.actualPrimaryWork)}</strong></div>
              <div><span>Done</span><strong>{candidate.summary.completionPercent ?? '-'}%</strong></div>
            </div>
          </article>
        {/each}
      </div>
    </section>
  {:else if compareRequested && selectedRun}
    <section class="panel compare-empty">
      <h2>Run Comparison</h2>
      <p class="muted">No other {selectedRun.kind} runs are available yet.</p>
    </section>
  {/if}
</div>

<style>
  .programs-page {
    max-width: 1440px;
    margin: 0 auto;
    padding: 1rem;
  }

  .programs-header,
  .section-head,
  .header-actions {
    display: flex;
    gap: 1rem;
    align-items: center;
    justify-content: space-between;
  }

  .programs-header {
    margin-bottom: 1rem;
  }

  .program-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 320px;
    gap: 1rem;
  }

  .panel {
    background: var(--color-surface-1);
    border: 1px solid var(--color-border);
    border-radius: 8px;
    padding: 1rem;
    margin-bottom: 1rem;
  }

  h1,
  h2,
  h3,
  p {
    margin-top: 0;
  }

  h3 {
    margin: 1.25rem 0 0.6rem;
  }

  .form-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 0.75rem;
  }

  label {
    display: grid;
    gap: 0.35rem;
    font-size: 0.85rem;
    color: var(--color-text-muted);
  }

  input,
  select {
    width: 100%;
    min-width: 0;
    padding: 0.5rem 0.6rem;
    border: 1px solid var(--color-border);
    border-radius: 6px;
    background: var(--color-surface-2);
    color: var(--color-text-primary);
  }

  button {
    border: 1px solid var(--color-accent);
    background: var(--color-accent);
    color: var(--color-accent-contrast);
    border-radius: 6px;
    padding: 0.55rem 0.8rem;
    cursor: pointer;
    font-weight: 700;
  }

  button:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  button.ghost {
    background: transparent;
    color: var(--color-text-primary);
    border-color: var(--color-border);
  }

  button.small,
  .small {
    font-size: 0.82rem;
  }

  .muted {
    color: var(--color-text-muted);
  }

  .eyebrow {
    color: var(--color-accent);
    text-transform: uppercase;
    letter-spacing: 0;
    font-size: 0.78rem;
    margin-bottom: 0.2rem;
  }

  .error {
    color: var(--color-danger);
  }

  .rest-days {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 0.5rem;
  }

  .check {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    color: var(--color-text-primary);
  }

  .check input {
    width: auto;
  }

  .secondary-list {
    display: grid;
    gap: 0.6rem;
  }

  .secondary-row {
    display: grid;
    grid-template-columns: 40px 70px minmax(150px, 1.5fr) minmax(130px, 1fr) repeat(6, minmax(72px, 0.7fr)) minmax(110px, 1fr);
    gap: 0.45rem;
    align-items: end;
    padding: 0.55rem;
    border: 1px solid var(--color-border);
    border-radius: 8px;
  }

  .day-label {
    font-weight: 800;
    color: var(--color-accent);
    align-self: center;
  }

  .run-list {
    display: grid;
    gap: 0.5rem;
    margin-bottom: 0.75rem;
  }

  .run-list button {
    display: grid;
    gap: 0.2rem;
    text-align: left;
    background: var(--color-surface-2);
    color: var(--color-text-primary);
    border-color: var(--color-border);
  }

  .run-list button.active {
    border-color: var(--color-accent);
  }

  .day-table {
    display: grid;
    gap: 0.35rem;
  }

  .table-head,
  .table-row {
    display: grid;
    grid-template-columns: 1.1fr 0.9fr 1fr 1.2fr 0.8fr 1fr;
    gap: 0.75rem;
    align-items: center;
  }

  .table-head {
    color: var(--color-text-muted);
    font-size: 0.78rem;
    padding: 0 0.6rem;
  }

  .table-row {
    width: 100%;
    color: var(--color-text-primary);
    background: var(--color-surface-2);
    border-color: var(--color-border);
    text-align: left;
  }

  .table-row.static {
    border: 1px solid var(--color-border);
    border-radius: 6px;
    padding: 0.55rem 0.8rem;
  }

  .row-actions {
    display: flex;
    gap: 0.4rem;
    flex-wrap: wrap;
  }

  .yaml-preview {
    margin-top: 0.75rem;
  }

  pre {
    max-height: 420px;
    overflow: auto;
    padding: 0.8rem;
    border-radius: 8px;
    background: var(--color-surface-2);
    border: 1px solid var(--color-border);
  }

  .metric-strip {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 0.75rem;
    margin: 0.75rem 0;
  }

  .metric-strip div {
    display: grid;
    gap: 0.2rem;
    padding: 0.75rem;
    border: 1px solid var(--color-border);
    border-radius: 8px;
    background: var(--color-surface-2);
  }

  .metric-strip span {
    color: var(--color-text-muted);
    font-size: 0.78rem;
  }

  .metric-strip strong {
    font-size: 1.2rem;
  }

  .compare-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: 0.75rem;
  }

  .compare-grid article {
    border: 1px solid var(--color-border);
    border-radius: 8px;
    padding: 0.85rem;
    background: var(--color-surface-2);
  }

  .compare-empty {
    border-style: dashed;
  }

  .metric-strip.compact {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  @media (max-width: 1050px) {
    .program-grid,
    .secondary-row {
      grid-template-columns: 1fr;
    }

    .programs-header,
    .section-head {
      align-items: flex-start;
      flex-direction: column;
    }

    .table-head {
      display: none;
    }

    .table-row,
    .table-row.static {
      grid-template-columns: 1fr;
    }

    .metric-strip {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
</style>
