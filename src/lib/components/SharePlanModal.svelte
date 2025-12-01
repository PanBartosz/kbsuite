<script lang="ts">
  import { createEventDispatcher } from 'svelte'

  export let open = false
  export let title = 'Share planned workout'
  export let defaultDate = ''
  export let plannedId = ''

  const dispatch = createEventDispatcher()

  let recipient = ''
  let message = ''
  let date = ''
  let status = ''
  let error = ''
  let loading = false

  $: date = date || defaultDate

  const close = () => {
    status = ''
    error = ''
    recipient = ''
    message = ''
    date = defaultDate
    dispatch('close')
  }

  const submit = async () => {
    if (!plannedId) {
      error = 'Missing plan id'
      return
    }
    if (!recipient.trim()) {
      error = 'Add a recipient username.'
      return
    }
    loading = true
    status = ''
    error = ''
    try {
      const plannedFor = date ? Date.parse(date) : null
      const res = await fetch(`/api/planned-workouts/${plannedId}/share`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipientUsername: recipient.trim(), message, plannedFor })
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.error ?? 'Share failed')
      }
      status = 'Shared!'
      dispatch('shared', { invite: data?.invite ?? null, pendingCount: data?.pendingCount })
      setTimeout(() => close(), 500)
    } catch (err) {
      error = (err as any)?.message ?? 'Share failed'
    } finally {
      loading = false
    }
  }
</script>

{#if open}
  <div class="modal-backdrop"></div>
  <div class="share-modal">
    <header>
      <div>
        <p class="eyebrow">Share</p>
        <h3>{title}</h3>
      </div>
      <button class="ghost" on:click={close} aria-label="Close">✕</button>
    </header>
    <div class="form">
      <label>
        <span class="muted small">Recipient username</span>
        <input
          type="text"
          placeholder="teammate"
          bind:value={recipient}
          autocomplete="username"
        />
      </label>
      <label>
        <span class="muted small">Planned date</span>
        <input type="date" bind:value={date} />
      </label>
      <label>
        <span class="muted small">Message (optional)</span>
        <textarea rows="2" bind:value={message} maxlength="240" placeholder="Optional note"></textarea>
      </label>
    </div>
    <div class="actions">
      <button class="primary" on:click={submit} disabled={loading}>Share</button>
      <button class="ghost" on:click={close}>Cancel</button>
    </div>
    {#if status}<p class="status">{status}</p>{/if}
    {#if error}<p class="error">{error}</p>{/if}
  </div>
{/if}

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: color-mix(in srgb, var(--color-surface-1) 60%, transparent);
    backdrop-filter: blur(6px);
    z-index: 80;
  }
  .share-modal {
    position: fixed;
    z-index: 90;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: min(520px, calc(100vw - 2rem));
    border: 1px solid var(--color-border);
    border-radius: 14px;
    background: var(--color-surface-2);
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }
  h3 {
    margin: 0;
  }
  .form {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
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
    padding: 0.55rem 0.7rem;
    background: var(--color-surface-1);
    color: var(--color-text-primary);
  }
  textarea {
    resize: vertical;
  }
  .actions {
    display: flex;
    gap: 0.5rem;
    justify-content: flex-end;
  }
  button.primary {
    background: linear-gradient(135deg, var(--color-accent), var(--color-accent-hover));
    color: var(--color-text-inverse);
    border: none;
  }
  button {
    padding: 0.55rem 0.8rem;
    border-radius: 10px;
    border: 1px solid var(--color-border);
    background: var(--color-surface-1);
    color: var(--color-text-primary);
    cursor: pointer;
  }
  .ghost {
    background: transparent;
  }
  .status {
    color: var(--color-success);
  }
  .error {
    color: var(--color-danger);
  }
</style>
