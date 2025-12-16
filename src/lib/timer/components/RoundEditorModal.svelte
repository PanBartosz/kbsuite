<script>
  import { createEventDispatcher } from 'svelte'
  import { modal } from '$lib/actions/modal'

  export let open = false
  export let round = null
  export let roundIndex = 0

  const dispatch = createEventDispatcher()

  let labelInput = ''
  let repetitionsInput = 1
  let restAfterInput = 0
  let lastRoundKey = null

  $: if (open) {
    const key = `${roundIndex}-${round?.id ?? roundIndex}`
    if (key !== lastRoundKey) {
      labelInput = round?.label ?? `Round ${roundIndex + 1}`
      repetitionsInput = round?.repetitions ?? 1
      restAfterInput = round?.restAfterSeconds ?? 0
      lastRoundKey = key
    }
  } else if (lastRoundKey !== null) {
    lastRoundKey = null
  }

  const close = () => {
    dispatch('close')
  }

  const toSeconds = (value) => {
    const numeric = Number(value)
    return Number.isFinite(numeric) && numeric >= 0 ? numeric : 0
  }

  const toReps = (value) => {
    const numeric = Number(value)
    if (!Number.isFinite(numeric) || numeric <= 0) return 1
    return Math.max(1, Math.round(numeric))
  }

  const handleSubmit = (event) => {
    event?.preventDefault()
    dispatch('save', {
      roundIndex,
      values: {
        label: labelInput?.trim() || `Round ${roundIndex + 1}`,
        repetitions: toReps(repetitionsInput),
        restAfterSeconds: toSeconds(restAfterInput)
      }
    })
  }

  const handleBackdropClick = (event) => {
    if (event.target === event.currentTarget) {
      close()
    }
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
          <p class="modal__eyebrow">Round {roundIndex + 1}</p>
          <h2>Edit round</h2>
        </div>
        <button type="button" class="modal__close" on:click={close} aria-label="Close">×</button>
      </header>
      <div class="modal__content">
        <form class="form" on:submit|preventDefault={handleSubmit}>
          <label>
            <span>Round name</span>
            <input
              type="text"
              placeholder="Round label"
              bind:value={labelInput}
            />
          </label>
          <div class="form__grid">
            <label>
              <span>Repetitions</span>
              <input
                type="number"
                min="1"
                step="1"
                inputmode="numeric"
                bind:value={repetitionsInput}
              />
            </label>
            <label>
              <span>Rest after round (sec)</span>
              <input
                type="number"
                min="0"
                step="1"
                inputmode="numeric"
                bind:value={restAfterInput}
              />
            </label>
          </div>
          <div class="modal__actions">
            <button class="secondary" type="button" on:click={close}>Cancel</button>
            <button class="primary" type="submit">Save round</button>
          </div>
        </form>
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
    z-index: 1200;
  }

  .modal {
    background: var(--color-surface-2);
    border: 1px solid var(--color-border);
    border-radius: 16px;
    max-width: min(600px, 100%);
    width: 100%;
    display: flex;
    flex-direction: column;
    color: var(--color-text-primary);
  }

  .modal__header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1.25rem 1.5rem 1rem;
  }

  .modal__eyebrow {
    margin: 0 0 0.2rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--color-text-muted);
    font-size: 0.8rem;
  }

  .modal__header h2 {
    margin: 0;
    font-size: 1.25rem;
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
  }

  .form {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  label {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    font-size: 0.9rem;
    color: var(--color-text-muted);
  }

  label span {
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-size: 0.75rem;
  }

  input {
    border-radius: 12px;
    border: 1px solid var(--color-border);
    background: var(--color-surface-1);
    color: var(--color-text-primary);
    padding: 0.65rem 0.85rem;
    font-size: 1rem;
  }

  input:focus-visible {
    outline: 2px solid color-mix(in srgb, var(--color-accent) 45%, transparent);
    outline-offset: 2px;
  }

  .form__grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: 0.9rem;
  }

  .modal__actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.75rem;
    margin-top: 0.25rem;
  }

  .modal button.primary {
    background: var(--color-accent);
    border: 1px solid var(--color-accent);
    border-radius: 14px;
    color: var(--color-surface-deeper);
    font-weight: 600;
    padding: 0.7rem 1.4rem;
    cursor: pointer;
    transition: background-color 120ms ease, border-color 120ms ease;
  }

  .modal button.primary:hover {
    background: var(--color-accent-hover);
    border-color: var(--color-accent-hover);
  }

  .modal button.primary:active {
    background: var(--color-accent-active);
    border-color: var(--color-accent-active);
  }

  .modal button.secondary {
    background: var(--color-surface-1);
    color: var(--color-text-primary);
    border: 1px solid var(--color-border);
    border-radius: 14px;
    font-weight: 600;
    padding: 0.7rem 1.5rem;
    cursor: pointer;
    transition: border-color 120ms ease, color 120ms ease;
  }

  .modal button.secondary:hover {
    border-color: var(--color-border-hover);
    color: var(--color-text-inverse);
  }
</style>
