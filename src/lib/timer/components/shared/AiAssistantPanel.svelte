<script lang="ts">
  import { createEventDispatcher } from 'svelte'

  export let prompt = ''
  export let isGenerating = false
  export let status = ''
  export let error = ''
  export let editInstructions = ''
  export let isEditing = false
  export let editStatus = ''
  export let editError = ''

  const dispatch = createEventDispatcher()

  const emitGenerate = () => dispatch('generate')
  const emitModify = () => dispatch('modify')
  const emitOpenSettings = () => dispatch('openSettings')
</script>

<section class="ai-panel">
  <div class="ai-panel__header">
    <h3>AI Assistant</h3>
    <button class="ghost small" type="button" on:click={emitOpenSettings}>Settings</button>
  </div>
  <p class="ai-panel__note">
    Describe the workout you want. Uses your OpenAI key from Settings.
  </p>

  <div class="ai-panel__description">
    <textarea
      rows="4"
      placeholder="Describe your workout goals, equipment, duration, preferences..."
      bind:value={prompt}
    ></textarea>
  </div>
  <div class="ai-panel__actions">
    <button class="primary" type="button" on:click={emitGenerate} disabled={isGenerating}>
      {#if isGenerating}
        Generating…
      {:else}
        Generate workout
      {/if}
    </button>
    {#if status}<span class="ai-status">{status}</span>{/if}
    {#if error}<span class="ai-error">{error}</span>{/if}
  </div>

  <div class="ai-panel__description ai-panel__description--edit">
    <textarea
      rows="3"
      placeholder="Tell the AI how to change the current YAML (e.g. 'make 6 rounds of 1 minute work/30s rest')"
      bind:value={editInstructions}
    ></textarea>
  </div>
  <div class="ai-panel__actions">
    <button class="secondary" type="button" on:click={emitModify} disabled={isEditing}>
      {#if isEditing}
        Applying…
      {:else}
        Modify current YAML
      {/if}
    </button>
    {#if editStatus}<span class="ai-status">{editStatus}</span>{/if}
    {#if editError}<span class="ai-error">{editError}</span>{/if}
  </div>
</section>

<style>
  .ai-panel {
    border: 1px solid var(--color-border, #1f2a40);
    border-radius: 12px;
    padding: 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    background: color-mix(in srgb, var(--color-surface-1, #0d1628) 60%, transparent);
  }
  .ai-panel__header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .ai-panel__note {
    margin: 0;
    color: var(--color-text-muted, #94a3b8);
    font-size: 0.9rem;
  }
  textarea {
    width: 100%;
    border: 1px solid var(--color-border, #1f2a40);
    border-radius: 10px;
    padding: 0.5rem 0.65rem;
    background: var(--color-surface-1, #0d1628);
    color: var(--color-text-primary, #e2e8f0);
    resize: vertical;
  }
  .ai-panel__actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  .ai-status {
    color: var(--color-text-muted, #94a3b8);
    font-size: 0.9rem;
  }
  .ai-error {
    color: var(--color-danger, #f87171);
    font-size: 0.9rem;
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
  button.secondary {
    background: color-mix(in srgb, var(--color-surface-1, #0d1628) 60%, transparent);
  }
  button.ghost {
    background: transparent;
  }
  button.small {
    padding: 0.35rem 0.6rem;
  }
</style>
