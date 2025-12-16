<script lang="ts">
  import { onMount } from 'svelte'
  import { pushToast } from '$lib/stores/toasts'
  import { modal } from '$lib/actions/modal'

  type Workout = {
    id: string
    name: string
    description?: string
    yaml_source?: string
    updated_at?: number
    is_template?: boolean
    owner_id?: string | null
  }

  let workouts: Workout[] = []
  let loading = false
  let error = ''
  let confirmDeleteName = ''
  let confirmDeleteId: string | null = null
  let deleteError = ''
  let deleteStatus = ''
  let searchTerm = ''
  let filterMode: 'all' | 'mine' | 'templates' = 'all'
  let visibleWorkouts: Workout[] = []

  const normalize = (value?: string | null) => (value ?? '').toString().toLowerCase().trim()

  const matchesSearch = (workout: Workout, term: string) => {
    const q = normalize(term)
    if (!q) return true
    const haystack = [workout.name, workout.description ?? ''].map(normalize).join(' ')
    return q
      .split(/\s+/)
      .filter(Boolean)
      .every((token) => haystack.includes(token))
  }

  $: visibleWorkouts = workouts
    .filter((w) => matchesSearch(w, searchTerm))
    .filter((w) => {
      if (filterMode === 'templates') return !!w.is_template
      if (filterMode === 'mine') return !w.is_template
      return true
    })
    .sort((a, b) => {
      const aTs = Number(a.updated_at) || 0
      const bTs = Number(b.updated_at) || 0
      if (aTs !== bTs) return bTs - aTs
      return (a.name ?? '').localeCompare(b.name ?? '')
    })

  const loadWorkouts = async () => {
    loading = true
    error = ''
    try {
      const res = await fetch('/api/workouts')
      if (!res.ok) throw new Error('Failed to load workouts')
      const data = await res.json()
      workouts = data?.workouts ?? []
    } catch (err) {
      const message = (err as any)?.message ?? 'Failed to load workouts'
      error = message
      pushToast(message, 'error')
    } finally {
      loading = false
    }
  }

  const copyYaml = async (yaml?: string) => {
    if (!yaml) return
    try {
      await navigator.clipboard.writeText(yaml)
      pushToast('Copied workout YAML', 'success')
    } catch (err) {
      pushToast('Copy failed', 'error')
    }
  }

  const requestDeleteWorkout = (id: string, isTemplate?: boolean) => {
    if (isTemplate) return
    const target = workouts.find((w) => w.id === id)
    confirmDeleteName = target?.name || ''
    confirmDeleteId = id
    deleteError = ''
    deleteStatus = ''
  }

  const closeDeleteConfirm = () => {
    confirmDeleteId = null
    deleteError = ''
    deleteStatus = ''
  }

  const deleteWorkout = async (id: string, isTemplate?: boolean) => {
    if (isTemplate) return
    deleteStatus = 'Deleting…'
    deleteError = ''
    try {
      const res = await fetch(`/api/workouts/${id}`, { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data?.error) throw new Error(data?.error ?? 'Delete failed')
      workouts = workouts.filter((w) => w.id !== id)
      closeDeleteConfirm()
      deleteStatus = 'Deleted'
      pushToast('Workout deleted.', 'success')
      setTimeout(() => (deleteStatus = ''), 1500)
    } catch (err) {
      deleteStatus = ''
      deleteError = (err as any)?.message ?? 'Delete failed'
      pushToast(deleteError, 'error')
    }
  }

  const startInTimer = (id: string) => {
    if (!id) return
    window.location.href = `/timer?workout=${encodeURIComponent(id)}`
  }

  const startInBigPicture = (id: string) => {
    if (!id) return
    window.location.href = `/big-picture?workout=${encodeURIComponent(id)}`
  }

  onMount(loadWorkouts)
</script>

<div class="workouts-page">
  <header>
    <h1>Workouts</h1>
  </header>

  {#if loading}
    <p>Loading…</p>
  {:else if error}
    <p class="error">{error}</p>
  {:else if workouts.length === 0}
    <p>No workouts found yet.</p>
  {:else}
    <div class="toolbar">
      <input
        type="search"
        placeholder="Search workouts…"
        bind:value={searchTerm}
        autocomplete="off"
      />
      <div class="segmented" role="group" aria-label="Workout filters">
        <button class:active={filterMode === 'all'} type="button" on:click={() => (filterMode = 'all')}>
          All
        </button>
        <button
          class:active={filterMode === 'mine'}
          type="button"
          on:click={() => (filterMode = 'mine')}
        >
          Mine
        </button>
        <button
          class:active={filterMode === 'templates'}
          type="button"
          on:click={() => (filterMode = 'templates')}
        >
          Templates
        </button>
      </div>
      <p class="muted small count">{visibleWorkouts.length} shown</p>
    </div>

    {#if visibleWorkouts.length === 0}
      <p class="muted">No matching workouts.</p>
    {:else}
    <div class="list">
      {#each visibleWorkouts as workout}
        <article class="card">
          <div class="meta">
            <div class="title-row">
              <h3>{workout.name}</h3>
              {#if workout.is_template}
                <span class="badge">Template</span>
              {/if}
            </div>
            {#if workout.description}
              <p class="muted">{workout.description}</p>
            {/if}
            {#if workout.updated_at}
              <p class="muted small">Updated {new Date(workout.updated_at).toLocaleString()}</p>
            {/if}
          </div>
          <div class="actions">
            <button class="primary" on:click={() => startInTimer(workout.id)}>Start (Timer)</button>
            <button class="ghost" on:click={() => startInBigPicture(workout.id)}>Start (Big Picture)</button>
            <button class="ghost" on:click={() => copyYaml(workout.yaml_source)}>Copy YAML</button>
            <button
              class="danger destructive"
              disabled={workout.is_template}
              on:click={() => requestDeleteWorkout(workout.id, workout.is_template)}
            >
              Delete
            </button>
          </div>
        </article>
      {/each}
    </div>
    {/if}
  {/if}

  {#if confirmDeleteId}
    <div
      class="modal-backdrop"
      role="button"
      tabindex="0"
      aria-label="Close modal"
      on:click={closeDeleteConfirm}
      on:keydown={(e) => (e.key === 'Enter' || e.key === ' ') && closeDeleteConfirm()}
    ></div>
    <div class="confirm-modal" use:modal={{ onClose: closeDeleteConfirm }}>
      <p>Delete this workout?</p>
      {#if confirmDeleteName}<p class="muted small">{confirmDeleteName}</p>{/if}
      {#if deleteError}<p class="error small">{deleteError}</p>{/if}
      <div class="actions">
        <button
          class="ghost"
          on:click={closeDeleteConfirm}
        >
          Cancel
        </button>
        <button
          class="danger"
          disabled={deleteStatus === 'Deleting…'}
          on:click={() => confirmDeleteId && deleteWorkout(confirmDeleteId)}
        >
          {deleteStatus || 'Delete'}
        </button>
      </div>
    </div>
  {/if}

</div>

<style>
  .workouts-page {
    max-width: 900px;
    width: min(900px, 100%);
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  .toolbar {
    display: flex;
    gap: 0.6rem;
    align-items: center;
    flex-wrap: wrap;
  }
  .toolbar input[type='search'] {
    flex: 1;
    min-width: min(280px, 100%);
    border-radius: 12px;
    border: 1px solid var(--color-border);
    background: var(--color-surface-2);
    color: var(--color-text-primary);
    padding: 0.7rem 0.85rem;
    font-size: 1rem;
  }
  .segmented {
    display: inline-flex;
    border: 1px solid var(--color-border);
    border-radius: 12px;
    overflow: hidden;
    background: var(--color-surface-2);
  }
  .segmented button {
    border: none;
    border-right: 1px solid var(--color-border);
    background: transparent;
    padding: 0.55rem 0.75rem;
    cursor: pointer;
    color: var(--color-text-primary);
  }
  .segmented button:last-child {
    border-right: none;
  }
  .segmented button.active {
    background: color-mix(in srgb, var(--color-accent) 22%, transparent);
    color: var(--color-text-primary);
  }
  .count {
    margin: 0;
  }
  header h1 {
    margin: 0;
  }
  .list {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .card {
    border: 1px solid var(--color-border);
    border-radius: 14px;
    padding: 0.9rem;
    background: var(--color-surface-2);
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 0.75rem;
    align-items: center;
  }
  .title-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .badge {
    padding: 0.2rem 0.5rem;
    border-radius: 10px;
    border: 1px solid var(--color-border);
    font-size: 0.85rem;
  }
  .muted {
    color: var(--color-text-muted);
    margin: 0.2rem 0;
  }
  .muted.small {
    font-size: 0.85rem;
  }
  .meta {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    flex-wrap: wrap;
    justify-content: flex-end;
  }
  .actions .destructive {
    margin-left: auto;
  }
  button {
    padding: 0.45rem 0.8rem;
    border-radius: 10px;
    border: 1px solid var(--color-border);
    background: var(--color-surface-1);
    color: var(--color-text-primary);
    cursor: pointer;
    white-space: nowrap;
  }
  button.primary {
    background: linear-gradient(135deg, var(--color-accent), var(--color-accent-hover));
    color: var(--color-text-inverse);
    border: none;
  }
  button.danger {
    border-color: var(--color-danger);
    color: var(--color-danger);
  }
  button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .ghost {
    background: transparent;
  }
  .error {
    color: var(--color-danger);
  }
  .error.small {
    font-size: 0.9rem;
  }
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.4);
    z-index: 10;
  }
  .confirm-modal {
    position: fixed;
    z-index: 11;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: var(--color-surface-2);
    border: 1px solid var(--color-border);
    padding: 1rem;
    border-radius: 12px;
    min-width: 280px;
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.35);
  }
  .confirm-modal .actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    margin-top: 0.75rem;
  }

  @media (max-width: 780px) {
    .card {
      grid-template-columns: 1fr;
    }
    .actions {
      width: 100%;
      justify-content: flex-start;
      gap: 0.5rem;
    }
    button {
      width: auto;
      min-width: 44px;
    }
  }
</style>
