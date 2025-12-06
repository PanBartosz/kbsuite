<script lang="ts">
  import { onMount } from 'svelte'

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
  let status = ''
  let confirmDeleteId: string | null = null
  let deleteError = ''
  let deleteStatus = ''

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
    } finally {
      loading = false
    }
  }

  const copyYaml = async (yaml?: string) => {
    if (!yaml) return
    try {
      await navigator.clipboard.writeText(yaml)
      status = 'Copied workout YAML'
      setTimeout(() => (status = ''), 2000)
    } catch (err) {
      status = 'Copy failed'
      setTimeout(() => (status = ''), 2000)
    }
  }

  const requestDeleteWorkout = (id: string, isTemplate?: boolean) => {
    if (isTemplate) return
    confirmDeleteId = id
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
      confirmDeleteId = null
      deleteStatus = 'Deleted'
      setTimeout(() => (deleteStatus = ''), 1500)
    } catch (err) {
      deleteStatus = ''
      deleteError = (err as any)?.message ?? 'Delete failed'
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

<main class="page">
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
    <div class="list">
      {#each workouts as workout}
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
              class="danger"
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

  {#if status}
    <p class="status">{status}</p>
  {/if}

  {#if confirmDeleteId}
    <div class="modal-backdrop"></div>
    <div class="confirm-modal">
      <p>Delete this workout?</p>
      {#if deleteError}<p class="error small">{deleteError}</p>{/if}
      <div class="actions">
        <button
          class="ghost"
          on:click={() => {
            confirmDeleteId = null
            deleteError = ''
            deleteStatus = ''
          }}
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
</main>

<style>
  .page {
    max-width: 900px;
    margin: 0 auto;
    padding: 1.5rem 1rem 2.5rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
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
  .status {
    color: var(--color-text-muted);
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
