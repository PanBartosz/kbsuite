<script>
  import { createEventDispatcher } from 'svelte'
  import { modal } from '$lib/actions/modal'

  export let open = false
  export let workouts = []

  const dispatch = createEventDispatcher()

  const close = () => {
    dispatch('close')
  }

  const handleBackdropClick = (event) => {
    if (event.target === event.currentTarget) {
      close()
    }
  }

  const selectWorkout = (workout) => {
    dispatch('select', { workout })
  }

  const formatDuration = (seconds) => {
    if (!Number.isFinite(seconds)) return '0:00'
    const safe = Math.max(Math.round(seconds), 0)
    const mins = Math.floor(safe / 60)
    const secs = safe % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }
</script>

{#if open}
  <div
    class="modal-backdrop"
    role="dialog"
    aria-modal="true"
    tabindex="-1"
    on:click={handleBackdropClick}
    use:modal={{ onClose: close }}
  >
    <section class="modal" role="document">
      <header class="modal__header">
        <div>
          <h2>Workout library</h2>
          <p>Select a template to load it into the editor.</p>
        </div>
        <button type="button" class="modal__close" on:click={close} aria-label="Close">×</button>
      </header>
      <div class="modal__content">
        {#if workouts.length === 0}
          <p class="library-empty">No templates available yet.</p>
        {:else}
          <ul class="library-list">
            {#each workouts as workout (workout.id)}
              <li class="library-item">
                <div class="library-item__info">
                  <div class="library-item__heading">
                    <h3>{workout.name}</h3>
                    <div class="library-item__chips">
                      <span>{workout.roundCount} {workout.roundCount === 1 ? 'round' : 'rounds'}</span>
                      <span>{formatDuration(workout.totals?.total ?? 0)} total</span>
                    </div>
                  </div>
                  {#if workout.description}
                    <p class="library-item__description">{workout.description}</p>
                  {/if}
                </div>
                <div class="library-item__actions">
                  <button type="button" on:click={() => selectWorkout(workout)}>
                    Load template
                  </button>
                </div>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    </section>
  </div>
{/if}

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: color-mix(in srgb, var(--color-bg) 35%, rgba(0, 0, 0, 0.6));
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1.5rem;
    z-index: 2100;
  }

  .modal {
    background: var(--color-surface-2);
    border: 1px solid var(--color-border);
    border-radius: 16px;
    max-width: min(720px, 100%);
    max-height: min(90vh, 720px);
    width: 100%;
    display: flex;
    flex-direction: column;
    color: var(--color-text-primary);
  }

  .modal__header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    padding: 1.25rem 1.5rem 1rem;
    gap: 1rem;
  }

  .modal__header h2 {
    margin: 0;
    font-size: 1.3rem;
  }

  .modal__header p {
    margin: 0.35rem 0 0;
    color: var(--color-text-muted);
    font-size: 0.95rem;
  }

  .modal__close {
    border: none;
    background: transparent;
    color: var(--color-text-muted);
    font-size: 1.6rem;
    cursor: pointer;
    line-height: 1;
  }

  .modal__close:hover {
    color: var(--color-text-primary);
  }

  .modal__content {
    padding: 0 1.5rem 1.5rem;
    overflow-y: auto;
  }

  .library-empty {
    margin: 1.25rem 0;
    text-align: center;
    color: var(--color-text-muted);
  }

  .library-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .library-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 1.1rem 1.25rem;
    border-radius: 14px;
    border: 1px solid var(--color-border);
    background: var(--color-surface-1);
    flex-wrap: wrap;
  }

  .library-item__info {
    flex: 1;
    min-width: 240px;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .library-item__heading {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .library-item__heading h3 {
    margin: 0;
    font-size: 1.05rem;
    font-weight: 600;
  }

  .library-item__chips {
    display: flex;
    gap: 0.75rem;
    font-size: 0.85rem;
    color: var(--color-text-muted);
  }

  .library-item__chips span {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
  }

  .library-item__description {
    margin: 0;
    color: var(--color-text-secondary);
    font-size: 0.95rem;
    line-height: 1.4;
  }

  .library-item__actions {
    display: flex;
    align-items: center;
  }

  .library-item__actions button {
    background: var(--color-accent);
    border: 1px solid var(--color-accent);
    border-radius: 12px;
    color: var(--color-surface-deeper);
    font-weight: 600;
    padding: 0.55rem 1.1rem;
    cursor: pointer;
    transition: background-color 120ms ease, border-color 120ms ease;
  }

  .library-item__actions button:hover {
    background: var(--color-accent-hover);
    border-color: var(--color-accent-hover);
  }

  .library-item__actions button:active {
    background: var(--color-accent-active);
    border-color: var(--color-accent-active);
  }

  @media (max-width: 640px) {
    .library-item {
      flex-direction: column;
      align-items: stretch;
    }

    .library-item__actions {
      justify-content: flex-end;
    }
  }
</style>
