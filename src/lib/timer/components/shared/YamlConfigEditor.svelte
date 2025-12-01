<script lang="ts">
  import { createEventDispatcher } from 'svelte'

  export let title = 'Configuration (YAML)'
  export let value = ''
  export let saveName = ''
  export let parseError: Error | null = null
  export let hasPendingChanges = false
  export let previewTotals: { work: number; rest: number; total: number } | null = null
  export let shareMagicString = ''
  export let showActions = true
  export let showShare = true
  export let showNameInput = true
  export let disableSave = false
  export let disableApply = false
  export let disableRevert = false
  export let disableReset = false

  const dispatch = createEventDispatcher()

  const emit = (event: string, detail?: any) => dispatch(event, detail)

  const formatDuration = (seconds?: number | null) => {
    const safe = Number(seconds)
    if (!Number.isFinite(safe) || safe <= 0) return '0s'
    const mins = Math.floor(safe / 60)
    const secs = Math.round(safe % 60)
    if (mins <= 0) return `${secs}s`
    return `${mins}m ${secs}s`
  }
</script>

<section class="config-editor">
  <div class="config-editor__header">
    <div class="config-editor__title">
      <h3>{title}</h3>
      <button class="text-button text-button--info" type="button" on:click={() => emit('openHelp')}>
        Syntax help
      </button>
      {#if showNameInput}
        <label class="config-editor__label">
          <span>Workout name</span>
          <input
            type="text"
            placeholder="e.g. Lower Body Burner"
            bind:value={saveName}
            on:input={() => emit('saveNameChange', saveName)}
          />
        </label>
      {/if}
    </div>
    {#if showActions}
      <div class="config-editor__buttons">
        <button
          class="primary"
          type="button"
          on:click={() => emit('save')}
          disabled={!!parseError || disableSave}
        >
          Save workout
        </button>
        <button
          class="accent"
          type="button"
          on:click={() => emit('apply')}
          disabled={!!parseError || !hasPendingChanges || disableApply}
        >
          Apply changes
        </button>
        <button
          class="secondary"
          type="button"
          on:click={() => emit('revert')}
          disabled={!hasPendingChanges || disableRevert}
        >
          Revert edits
        </button>
        <button
          class="ghost"
          type="button"
          on:click={() => emit('reset')}
          disabled={!hasPendingChanges || disableReset}
        >
          Reset to default
        </button>
      </div>
      <div class="config-editor__buttons config-editor__buttons--secondary">
        <button class="secondary" type="button" on:click={() => emit('triggerImport')}>
          Import YAML
        </button>
        <button class="ghost" type="button" on:click={() => emit('export')}>
          Export YAML
        </button>
        <input
          class="file-input-hidden"
          type="file"
          accept=".yaml,.yml,text/yaml,text/plain"
          on:change={(event) => emit('importChange', event)}
        />
      </div>
    {/if}
  </div>
  <div class="config-editor__body">
    <textarea
      class:has-error={!!parseError}
      bind:value={value}
      rows="18"
      spellcheck="false"
      on:input={() => emit('valueChange', value)}
    ></textarea>
    <div class="config-editor__status">
      {#if parseError}
        <p class="status status--error">
          Parse error: {parseError.message}
        </p>
      {:else if hasPendingChanges}
        <p class="status status--pending">
          Parsed successfully. Apply to update the workout overview.
        </p>
      {:else}
        <p class="status status--ok">Config is in sync with the workout.</p>
      {/if}

      {#if previewTotals}
        <ul class="config-editor__summary">
          <li>Total work: {formatDuration(previewTotals.work)}</li>
          <li>Total rest: {formatDuration(previewTotals.rest)}</li>
          <li>Total time: {formatDuration(previewTotals.total)}</li>
        </ul>
      {/if}
    </div>
    {#if shareMagicString && showShare}
      <div class="magic-share">
        <h4>Magic share string</h4>
        <p class="magic-share__hint">
          Share compressed workouts between devices. Copy the generated string or paste one you received.
        </p>
        <div class="magic-share__row">
          <input class="magic-share__output" type="text" readonly value={shareMagicString} />
          <button class="secondary" type="button" on:click={() => emit('copyShare')}>Copy</button>
        </div>
      </div>
    {/if}
  </div>
</section>

<style>
  .config-editor {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    border: 1px solid var(--color-border, #1f2a40);
    border-radius: 14px;
    padding: 0.75rem;
    background: color-mix(in srgb, var(--color-surface-1, #0d1628) 55%, transparent);
  }
  .config-editor__header {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .config-editor__title {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    flex-wrap: wrap;
  }
  .config-editor__label {
    display: inline-flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .config-editor__buttons {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  .config-editor__buttons--secondary {
    margin-top: 0.25rem;
  }
  .config-editor__body {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  textarea {
    border: 1px solid var(--color-border, #1f2a40);
    border-radius: 10px;
    padding: 0.65rem 0.75rem;
    background: var(--color-surface-1, #0d1628);
    color: var(--color-text-primary, #e2e8f0);
    font-family: 'Space Grotesk', monospace;
  }
  textarea.has-error {
    border-color: var(--color-danger, #f87171);
  }
  .config-editor__status {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .status {
    margin: 0;
    font-size: 0.95rem;
  }
  .status--ok {
    color: var(--color-text-muted, #94a3b8);
  }
  .status--pending {
    color: var(--color-warning-strong, #fbbf24);
  }
  .status--error {
    color: var(--color-danger, #f87171);
  }
  .config-editor__summary {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 0.25rem 0.75rem;
    color: var(--color-text-muted, #94a3b8);
  }
  .magic-share {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    padding: 0.5rem 0.65rem;
    border-radius: 10px;
    border: 1px dashed var(--color-border, #1f2a40);
  }
  .magic-share__row {
    display: flex;
    gap: 0.35rem;
    align-items: center;
  }
  .magic-share__output {
    flex: 1;
    border: 1px solid var(--color-border, #1f2a40);
    border-radius: 10px;
    padding: 0.45rem 0.6rem;
    background: var(--color-surface-1, #0d1628);
    color: var(--color-text-primary, #e2e8f0);
  }
  .file-input-hidden {
    display: none;
  }
  button {
    padding: 0.5rem 0.8rem;
    border-radius: 10px;
    border: 1px solid var(--color-border, #1f2a40);
    background: var(--color-surface-1, #0d1628);
    color: var(--color-text-primary, #e2e8f0);
    cursor: pointer;
  }
  button.primary {
    background: linear-gradient(135deg, var(--color-accent, #4f9cf9), var(--color-accent-hover, #3b82f6));
    color: var(--color-text-inverse, #f8fafc);
    border: none;
  }
  button.accent {
    background: color-mix(in srgb, var(--color-accent, #4f9cf9) 18%, transparent);
    border-color: color-mix(in srgb, var(--color-accent, #4f9cf9) 45%, transparent);
  }
  button.secondary {
    background: color-mix(in srgb, var(--color-surface-1, #0d1628) 60%, transparent);
  }
  button.ghost {
    background: transparent;
  }
  .text-button {
    background: transparent;
    border: none;
    color: var(--color-accent, #4f9cf9);
    padding: 0.25rem 0.4rem;
    cursor: pointer;
  }
  .text-button--info {
    color: var(--color-text-muted, #94a3b8);
    text-decoration: underline;
  }
</style>
