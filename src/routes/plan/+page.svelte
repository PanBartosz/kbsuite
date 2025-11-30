<script lang="ts">
  import { onMount } from 'svelte'
  import YAML from 'yaml'
  import defaultPlanSource from '$lib/timer/config/default-plan.yaml?raw'

  type Planned = {
    id: string
    planned_for: number
    title: string
    yaml_source: string
    notes?: string
    tags?: string[]
  }

  type WorkoutTemplate = { id: string; name: string; description?: string; yaml_source?: string }

  let plans: Planned[] = []
  let loading = false
  let error = ''
  let selectedDateKey = ''
  let calendarMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime()
  let editOpen = false
  let editId: string | null = null
  let editTitle = ''
  let editDate = new Date().toISOString().slice(0, 10)
  let editYaml = defaultPlanSource
  let editNotes = ''
  let editTags: string[] = []
  let newTag = ''
  let templates: WorkoutTemplate[] = []
  let todayPlan: Planned | null = null

  const dayKey = (ts: number) => {
    const d = new Date(ts)
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  }
  const startOfMonthWeekday = (ts: number) => {
    const d = new Date(ts)
    d.setDate(1)
    const dow = d.getDay()
    return (dow + 6) % 7 // Monday first
  }
  const daysInMonth = (ts: number) => {
    const d = new Date(ts)
    return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
  }
  const moveMonth = (delta: number) => {
    const d = new Date(calendarMonth)
    d.setMonth(d.getMonth() + delta)
    calendarMonth = new Date(d.getFullYear(), d.getMonth(), 1).getTime()
    selectedDateKey = ''
  }
  const monthLabel = (ts: number) =>
    new Date(ts).toLocaleString(undefined, { month: 'long', year: 'numeric' })

  const loadPlans = async () => {
    loading = true
    error = ''
    try {
      const res = await fetch('/api/planned-workouts')
      const data = await res.json().catch(() => ({}))
      plans = data?.items ?? []
    } catch (err) {
      error = (err as any)?.message ?? 'Failed to load plans'
    } finally {
      loading = false
      computeToday()
    }
  }

  const computeToday = () => {
    const key = dayKey(Date.now())
    todayPlan = plans.find((p) => dayKey(p.planned_for) === key) ?? null
  }

  const templatesLoad = async () => {
    try {
      const res = await fetch('/api/workouts')
      const data = await res.json().catch(() => ({}))
      templates = data?.workouts ?? []
    } catch {
      templates = []
    }
  }

  const selectTemplate = (tmpl: WorkoutTemplate) => {
    if (tmpl?.yaml_source) {
      editTitle = tmpl.name ?? editTitle
      editYaml = tmpl.yaml_source
    }
  }

  const openNew = (dateKey?: string) => {
    editId = null
    editTitle = ''
    editYaml = defaultPlanSource
    editNotes = ''
    editTags = []
    newTag = ''
    editDate = dateKey ?? new Date().toISOString().slice(0, 10)
    editOpen = true
  }

  const openEdit = (plan: Planned) => {
    editId = plan.id
    editTitle = plan.title ?? ''
    editYaml = plan.yaml_source ?? ''
    editNotes = plan.notes ?? ''
    editTags = (plan.tags ?? []).map((t) => t.trim()).filter(Boolean)
    editDate = new Date(plan.planned_for).toISOString().slice(0, 10)
    editOpen = true
  }

  const savePlan = async () => {
    const plannedFor = Date.parse(editDate)
    if (!plannedFor) {
      error = 'Invalid date'
      return
    }
    try {
      const res = await fetch('/api/planned-workouts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editId,
          title: editTitle,
          plannedFor,
          yaml_source: editYaml,
          notes: editNotes,
          tags: editTags
        })
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error ?? 'Failed to save plan')
      const item: Planned | null = data?.item ?? null
      if (item) {
        const existing = plans.find((p) => p.id === item.id)
        plans = existing ? plans.map((p) => (p.id === item.id ? item : p)) : [...plans, item]
      }
      editOpen = false
      computeToday()
    } catch (err) {
      error = (err as any)?.message ?? 'Failed to save plan'
    }
  }

  const deletePlan = async (id: string) => {
    try {
      await fetch(`/api/planned-workouts/${id}`, { method: 'DELETE' })
      plans = plans.filter((p) => p.id !== id)
      computeToday()
    } catch {
      // ignore
    }
  }

  const addTag = () => {
    const t = newTag.trim()
    if (!t) return
    if (editTags.includes(t)) {
      newTag = ''
      return
    }
    editTags = [...editTags, t].slice(0, 8)
    newTag = ''
  }

  const dayPlans = (key: string) => plans.filter((p) => dayKey(p.planned_for) === key)
  $: monthItems = plans.filter((p) => {
    const d = new Date(p.planned_for)
    const m = new Date(calendarMonth)
    return d.getFullYear() === m.getFullYear() && d.getMonth() === m.getMonth()
  })
  $: selectedDayPlans = selectedDateKey ? dayPlans(selectedDateKey) : []

  const openTimer = (plan: Planned, mode: 'timer' | 'big') => {
    const id = plan.id
    if (!id) return
    const base = mode === 'big' ? '/big-picture' : '/timer'
    window.location.href = `${base}?planned=${encodeURIComponent(id)}`
  }

  onMount(() => {
    loadPlans()
    templatesLoad()
  })
</script>

<main class="page">
  <header>
    <h1>Planner</h1>
  </header>

  {#if loading}
    <p>Loading…</p>
  {:else if error}
    <p class="error">{error}</p>
  {:else}
    <section class="today-block">
      <div class="today-head">
        <div>
          <p class="eyebrow">Today</p>
          <h3>{new Date().toDateString()}</h3>
        </div>
        <div class="today-actions">
          <button class="ghost" on:click={() => openNew(dayKey(Date.now()))}>Plan today</button>
          {#if todayPlan}
            <button class="primary" on:click={() => openTimer(todayPlan!, 'timer')}>Start in Timer</button>
            <button class="ghost" on:click={() => openTimer(todayPlan!, 'big')}>Start in Big Picture</button>
          {/if}
        </div>
      </div>
      {#if todayPlan}
        <div class="today-card">
          <div>
            <h4>{todayPlan.title || 'Planned workout'}</h4>
            {#if todayPlan.tags?.length}
              <div class="tag-row">
                {#each todayPlan.tags as tag}
                  <span class="tag-chip">{tag}</span>
                {/each}
              </div>
            {/if}
            {#if todayPlan.notes}<p class="muted small">{todayPlan.notes}</p>{/if}
          </div>
          <div class="today-actions">
            <button class="ghost" on:click={() => openEdit(todayPlan!)}>Edit</button>
            <button class="ghost danger" on:click={() => deletePlan(todayPlan!.id)}>Delete</button>
          </div>
        </div>
      {:else}
        <p class="muted small">No plan for today.</p>
      {/if}
    </section>

    <section class="calendar-shell">
      <div class="calendar-head">
        <div class="month-nav">
          <button class="ghost" on:click={() => moveMonth(-1)}>←</button>
          <strong>{monthLabel(calendarMonth)}</strong>
          <button class="ghost" on:click={() => moveMonth(1)}>→</button>
        </div>
        <div class="inline-actions">
          <button class="primary" on:click={() => openNew()}>Add workout</button>
        </div>
      </div>
      <div class="calendar-grid">
        <div class="dow">Mon</div>
        <div class="dow">Tue</div>
        <div class="dow">Wed</div>
        <div class="dow">Thu</div>
        <div class="dow">Fri</div>
        <div class="dow">Sat</div>
        <div class="dow">Sun</div>
        {#each Array(startOfMonthWeekday(calendarMonth)).fill(0) as _}
          <div class="day empty"></div>
        {/each}
        {#each Array(daysInMonth(calendarMonth)).fill(0).map((_, i) => i + 1) as day}
          {@const key = dayKey(new Date(new Date(calendarMonth).getFullYear(), new Date(calendarMonth).getMonth(), day).getTime())}
          {@const itemsForDay = dayPlans(key)}
          <button
            type="button"
            class="day"
            class:active={selectedDateKey === key}
            on:click={() => (selectedDateKey = key)}
            aria-pressed={selectedDateKey === key}
          >
            <div class="day-top">
              <span class="day-num">{day}</span>
              {#if itemsForDay.length}
                <span class="day-count">{itemsForDay.length}</span>
              {/if}
            </div>
            {#if itemsForDay.length}
              <div class="day-list">
                {#each itemsForDay as it}
                  {@const hrTag = it.tags?.includes('hr') || false}
                  <div class="day-row" title={`${it.title || 'Workout'}`}>
                    <span class="dot"></span>
                    <div class="day-row-body">
                      <span class="day-row-title">{it.title || 'Workout'}</span>
                      <div class="day-row-meta">
                        {#if hrTag}<span class="day-row-hr">HR</span>{/if}
                      </div>
                    </div>
                  </div>
                {/each}
              </div>
            {/if}
          </button>
        {/each}
      </div>
    </section>

    <section class="day-detail">
      <div class="day-head">
        <h3>{selectedDateKey || 'Select a day'}</h3>
        {#if selectedDateKey}
          <button class="ghost" on:click={() => openNew(selectedDateKey)}>Add workout</button>
        {/if}
      </div>
      {#if selectedDayPlans.length === 0}
        <p class="muted small">No planned workouts for this day.</p>
      {:else}
        <div class="list">
          {#each selectedDayPlans as item}
            <article class="card">
              <div class="card-header">
                <div>
                  <h4>{item.title || 'Workout'}</h4>
                  <p class="muted small">{new Date(item.planned_for).toLocaleString()}</p>
                  {#if item.tags?.length}
                    <div class="tag-row">
                      {#each item.tags as tag}
                        <span class="tag-chip">{tag}</span>
                      {/each}
                    </div>
                  {/if}
                  {#if item.notes}<p class="muted small">{item.notes}</p>{/if}
                </div>
                <div class="actions">
                  <button class="primary" on:click={() => openTimer(item, 'timer')}>Timer</button>
                  <button class="ghost" on:click={() => openTimer(item, 'big')}>Big Picture</button>
                  <button class="ghost" on:click={() => openEdit(item)}>Edit</button>
                  <button class="ghost danger" on:click={() => deletePlan(item.id)}>Delete</button>
                </div>
              </div>
            </article>
          {/each}
        </div>
      {/if}
    </section>
  {/if}

  {#if editOpen}
    <div class="modal-backdrop"></div>
    <div class="edit-modal">
      <header>
        <h3>{editId ? 'Edit planned workout' : 'Add planned workout'}</h3>
        <button class="ghost" on:click={() => (editOpen = false)}>✕</button>
      </header>
      <div class="form">
        <label>
          <span class="muted small">Title</span>
          <input type="text" bind:value={editTitle} placeholder="Planned workout" />
        </label>
        <label>
          <span class="muted small">Date</span>
          <input type="date" bind:value={editDate} />
        </label>
        <label>
          <span class="muted small">Tags</span>
          <div class="tag-editor">
            {#each editTags as tag}
              <span class="tag-chip">
                {tag}
                <button class="ghost icon-btn" on:click={() => (editTags = editTags.filter((t) => t !== tag))}>×</button>
              </span>
            {/each}
            <div class="tag-input-wrap">
              <input type="text" placeholder="Add tag" bind:value={newTag} />
              <button class="ghost small" type="button" on:click={addTag}>Add</button>
            </div>
          </div>
        </label>
        <label>
          <span class="muted small">Notes</span>
          <input type="text" bind:value={editNotes} placeholder="Optional notes" />
        </label>
        <label class="yaml-field">
          <span class="muted small">YAML</span>
          <textarea bind:value={editYaml} rows="18"></textarea>
        </label>
        {#if templates.length}
          <div class="template-list">
            <p class="muted small">Templates</p>
            <div class="templates">
              {#each templates as tmpl}
                <button class="ghost small" type="button" on:click={() => selectTemplate(tmpl)}>
                  {tmpl.name}
                </button>
              {/each}
            </div>
          </div>
        {/if}
      </div>
      <div class="actions">
        <button class="primary" on:click={savePlan}>Save</button>
        <button class="ghost" on:click={() => (editOpen = false)}>Cancel</button>
      </div>
    </div>
  {/if}
</main>

<style>
  .page {
    max-width: 1400px;
    margin: 0 auto;
    padding: 1.5rem 1rem 2.5rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  .today-block,
  .calendar-shell,
  .day-detail {
    border: 1px solid var(--color-border);
    border-radius: 14px;
    padding: 1rem;
    background: color-mix(in srgb, var(--color-surface-2) 80%, transparent);
  }
  .today-head,
  .day-head,
  .calendar-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.5rem;
  }
  .today-card {
    margin-top: 0.5rem;
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 0.5rem;
  }
  .today-actions {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
  }
  .calendar-shell {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .calendar-grid {
    display: grid;
    grid-template-columns: repeat(7, minmax(0, 1fr));
    gap: 0.45rem;
    background: color-mix(in srgb, var(--color-surface-1) 60%, transparent);
    border: 1px solid var(--color-border);
    border-radius: 12px;
    padding: 1rem;
  }
  .dow {
    text-align: center;
    font-size: 0.9rem;
    color: var(--color-text-muted);
  }
  .day {
    min-height: 110px;
    border: 1px solid color-mix(in srgb, var(--color-border) 70%, transparent);
    border-radius: 10px;
    padding: 0.55rem 0.55rem 0.45rem;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    cursor: pointer;
    background: color-mix(in srgb, var(--color-surface-2) 60%, transparent);
    transition: border-color 120ms ease, background 120ms ease;
  }
  .day:hover {
    border-color: var(--color-border-hover);
  }
  .day.empty {
    background: transparent;
    border: none;
    cursor: default;
  }
  .day.active {
    border-color: var(--color-accent);
    background: color-mix(in srgb, var(--color-accent) 10%, var(--color-surface-2));
  }
  .day-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .day-num {
    font-weight: 600;
  }
  .day-count {
    font-size: 0.85rem;
    background: color-mix(in srgb, var(--color-accent) 25%, var(--color-surface-1));
    border: 1px solid color-mix(in srgb, var(--color-accent) 50%, var(--color-border));
    color: var(--color-text-primary);
    border-radius: 999px;
    padding: 0.1rem 0.5rem;
  }
  .day-list {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }
  .day-row {
    display: grid;
    grid-template-columns: 8px 1fr;
    align-items: center;
    gap: 0.3rem;
    padding: 0.1rem 0.15rem;
    border-radius: 8px;
    background: color-mix(in srgb, var(--color-surface-1) 30%, transparent);
    min-width: 0;
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--color-accent);
    opacity: 0.6;
  }
  .day-row-body {
    display: flex;
    flex-direction: column;
    gap: 0.12rem;
    min-width: 0;
  }
  .day-row-title {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--color-text-primary);
    font-size: 0.62rem;
  }
  .day-row-meta {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.55rem;
    color: var(--color-text-muted);
  }
  .day-row-hr {
    font-size: 0.55rem;
    padding: 0.08rem 0.3rem;
    border-radius: 6px;
    border: 1px solid color-mix(in srgb, var(--color-accent) 60%, var(--color-border));
    color: var(--color-accent);
  }
  .day-detail .card {
    border: 1px solid var(--color-border);
    border-radius: 12px;
    padding: 0.75rem;
    background: color-mix(in srgb, var(--color-surface-1) 70%, transparent);
  }
  .card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  .actions {
    display: flex;
    gap: 0.35rem;
    flex-wrap: wrap;
  }
  .tag-row {
    display: inline-flex;
    gap: 0.35rem;
    flex-wrap: wrap;
  }
  .tag-chip {
    border: 1px solid var(--color-border);
    border-radius: 999px;
    padding: 0.2rem 0.55rem;
    background: var(--color-surface-1);
    color: var(--color-text-primary);
    font-size: 0.9rem;
  }
  .inline-actions {
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    z-index: 100;
  }
  .edit-modal {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    z-index: 110;
    background: var(--color-surface-2);
    border: 1px solid var(--color-border);
    border-radius: 14px;
    padding: 1rem;
    width: min(960px, 95vw);
    max-height: 90vh;
    overflow: auto;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .edit-modal header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }
  .form {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }
  input,
  textarea {
    border: 1px solid var(--color-border);
    border-radius: 10px;
    padding: 0.5rem 0.65rem;
    background: var(--color-surface-1);
    color: var(--color-text-primary);
  }
  textarea {
    font-family: 'Space Grotesk', monospace;
  }
  .yaml-field textarea {
    min-height: 280px;
  }
  .tag-editor {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }
  .tag-input-wrap {
    display: flex;
    gap: 0.35rem;
    align-items: center;
  }
  .template-list .templates {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
  }
  button {
    padding: 0.5rem 0.8rem;
    border-radius: 10px;
    border: 1px solid var(--color-border);
    background: var(--color-surface-1);
    color: var(--color-text-primary);
    cursor: pointer;
  }
  button.primary {
    background: linear-gradient(135deg, var(--color-accent), var(--color-accent-hover));
    color: var(--color-text-inverse);
    border: none;
  }
  button.ghost {
    background: transparent;
  }
  button.danger {
    border-color: var(--color-danger);
    color: var(--color-danger);
  }
  .icon-btn {
    padding: 0 0.35rem;
  }
  .error {
    color: var(--color-danger);
  }
</style>
