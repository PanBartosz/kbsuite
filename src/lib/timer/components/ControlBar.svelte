<script>
  import { createEventDispatcher } from 'svelte'

  export let isRunning = false
  export let isPaused = false
  export let canStart = true
  export let canSkip = false

  const dispatch = createEventDispatcher()

  const handle = (type) => () => {
    dispatch(type)
  }
</script>

<nav class="control-bar" aria-label="Timer controls">
  <button
    class="control-bar__button control-bar__button--primary"
    type="button"
    on:click={handle('start')}
    disabled={!canStart || isRunning}
  >
    Start
  </button>

  <button
    class="control-bar__button control-bar__button--secondary"
    type="button"
    on:click={handle(isPaused ? 'resume' : 'pause')}
    disabled={!isRunning && !isPaused}
  >
    {#if isPaused}
      Resume
    {:else}
      Pause
    {/if}
  </button>

  <button
    class="control-bar__button control-bar__button--ghost"
    type="button"
    on:click={handle('stop')}
    disabled={!isRunning && !isPaused}
  >
    Stop
  </button>

  <button
    class="control-bar__button control-bar__button--ghost"
    type="button"
    on:click={handle('skip')}
    disabled={!canSkip}
  >
    Skip
  </button>
</nav>

<style>
  .control-bar {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.7rem;
    padding: 1rem;
    background: color-mix(in srgb, var(--color-surface-2) 92%, transparent);
    border: 1px solid var(--color-border);
    border-radius: 18px;
    box-sizing: border-box;
  }

  @media (min-width: 768px) {
    .control-bar {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }
  }

  .control-bar__button {
    border-radius: 14px;
    padding: 0.7rem 1.1rem;
    font-weight: 600;
    font-size: 0.92rem;
    cursor: pointer;
    border: 1px solid transparent;
    transition: background-color 160ms ease, border-color 160ms ease, color 160ms ease,
      transform 100ms ease, box-shadow 160ms ease;
  }

  .control-bar__button:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .control-bar__button--primary {
    background: var(--color-accent);
    color: var(--color-text-inverse);
  }

  .control-bar__button--primary:not(:disabled):hover {
    background: var(--color-accent-hover);
    transform: translateY(-1px);
    box-shadow: 0 8px 16px rgba(15, 23, 42, 0.25);
  }

  .control-bar__button--secondary {
    background: color-mix(in srgb, var(--color-surface-3) 85%, transparent);
    border-color: var(--color-border);
    color: var(--color-text-primary);
  }

  .control-bar__button--secondary:not(:disabled):hover {
    border-color: var(--color-border-hover);
    transform: translateY(-1px);
    box-shadow: 0 6px 12px rgba(15, 23, 42, 0.2);
  }

  .control-bar__button--ghost {
    background: var(--color-surface-1);
    border-color: var(--color-border);
    color: var(--color-text-secondary);
  }

  .control-bar__button--ghost:not(:disabled):hover {
    border-color: var(--color-border-hover);
    color: var(--color-text-primary);
    transform: translateY(-1px);
    box-shadow: 0 6px 12px rgba(15, 23, 42, 0.18);
  }

  .control-bar__button:not(:disabled):active {
    transform: translateY(0);
    box-shadow: none;
  }

  @media (max-width: 680px) {
    .control-bar {
      padding: 0.85rem;
      gap: 0.55rem;
      border-radius: 16px;
    }

    .control-bar__button {
      padding: 0.6rem 0.85rem;
      font-size: 0.82rem;
      border-radius: 12px;
    }
  }
</style>
