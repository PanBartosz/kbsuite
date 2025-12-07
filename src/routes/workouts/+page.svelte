<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import { browser } from '$app/environment'

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
  type Toast = { id: string; message: string; type: 'info' | 'success' | 'error' }
  let toasts: Toast[] = []
  let confirmDeleteName = ''
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
      pushToast('Workout deleted.', 'success')
      setTimeout(() => (deleteStatus = ''), 1500)
    } catch (err) {
      deleteStatus = ''
      deleteError = (err as any)?.message ?? 'Delete failed'
      pushToast(deleteError, 'error')
    }
  }

  const pushToast = (message: string, type: Toast['type'] = 'info', duration = 2400) => {
    const id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`
    const toast = { id, message, type }
    toasts = [...toasts, toast]
    setTimeout(() => {
      toasts = toasts.filter((t) => t.id !== id)
    }, duration)
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

  $: if (browser) {
    document.body.classList.toggle('modal-open', !!confirmDeleteId)
  }

  onDestroy(() => {
    if (browser) document.body.classList.remove('modal-open')
  })
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

  {#if confirmDeleteId}
    <div class="modal-backdrop"></div>
    <div class="confirm-modal">
      <p>Delete this workout?</p>
      {#if confirmDeleteName}<p class="muted small">{confirmDeleteName}</p>{/if}
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

  {#if toasts.length}
    <div class="toast-stack">
      {#each toasts as toast (toast.id)}
        <div class={`toast ${toast.type}`}>
          <span>{toast.message}</span>
          <button class="ghost icon-btn" aria-label="Dismiss" on:click={() => (toasts = toasts.filter((t) => t.id !== toast.id))}>×</button>
        </div>
      {/each}
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
  .toast-stack {
    position: fixed;
    top: 1rem;
    right: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    z-index: 200;
    pointer-events: none;
  }
  .toast {
    min-width: 240px;
    padding: 0.65rem 0.85rem;
    border-radius: 12px;
    border: 1px solid color-mix(in srgb, var(--color-accent) 45%, var(--color-border));
    background: linear-gradient(135deg, var(--color-accent), var(--color-accent-hover));
    color: var(--color-text-inverse);
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.25);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    pointer-events: auto;
    animation: toast-in 220ms ease, toast-out 180ms ease 2.2s forwards;
  }
  .toast.error {
    background: color-mix(in srgb, var(--color-danger) 85%, var(--color-surface-1) 15%);
    border-color: var(--color-danger);
    color: var(--color-text-inverse);
  }
  :global(body.modal-open) {
    overflow: hidden;
  }
  @keyframes toast-in {
    from {
      opacity: 0;
      transform: translateY(-10px) translateX(12px);
    }
    to {
      opacity: 1;
      transform: translateY(0) translateX(0);
    }
  }
  @keyframes toast-out {
    to {
      opacity: 0;
      transform: translateY(-6px) translateX(8px);
    }
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
