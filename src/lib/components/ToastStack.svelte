<script lang="ts">
  import { fly, fade } from 'svelte/transition'
  import { dismissToast, toasts, type Toast } from '$lib/stores/toasts'

  const runAction = (toast: Toast) => {
    try {
      toast.action?.onClick?.()
    } finally {
      dismissToast(toast.id)
    }
  }
</script>

{#if $toasts.length}
  <div class="toast-stack" aria-live="polite" aria-relevant="additions removals">
    {#each $toasts as toast (toast.id)}
      <div
        class={`toast ${toast.type}`}
        in:fly={{ x: 12, duration: 180 }}
        out:fade={{ duration: 140 }}
      >
        <span class="message">{toast.message}</span>
        <div class="actions">
          {#if toast.action}
            <button class="ghost small action" type="button" on:click={() => runAction(toast)}>
              {toast.action.label}
            </button>
          {/if}
          <button class="ghost icon-btn" aria-label="Dismiss" type="button" on:click={() => dismissToast(toast.id)}>
            ×
          </button>
        </div>
      </div>
    {/each}
  </div>
{/if}

<style>
  .toast-stack {
    position: fixed;
    top: calc(env(safe-area-inset-top, 0px) + 4.5rem);
    right: calc(env(safe-area-inset-right, 0px) + 1rem);
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    z-index: 2000;
    pointer-events: none;
    max-width: min(440px, calc(100vw - 2rem));
    max-height: 40dvh;
    overflow-y: auto;
  }

  @media (max-width: 600px) {
    .toast-stack {
      top: calc(env(safe-area-inset-top, 0px) + 4.5rem);
      right: 50%;
      bottom: auto;
      transform: translateX(50%);
      width: min(520px, calc(100vw - 2rem));
    }
  }

  .toast {
    padding: 0.7rem 0.85rem;
    border-radius: 12px;
    border: 1px solid color-mix(in srgb, var(--color-accent) 45%, var(--color-border));
    background: var(--color-surface-1);
    color: var(--color-text-primary);
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.25);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    pointer-events: auto;
  }

  .toast.error {
    background: var(--color-surface-1);
    border-color: var(--color-danger);
    color: var(--color-text-primary);
  }

  .toast.success {
    background: var(--color-surface-1);
    border-color: color-mix(in srgb, var(--color-success) 70%, var(--color-border));
    color: var(--color-text-primary);
  }

  .message {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: normal;
    overflow-wrap: anywhere;
  }

  @media (max-width: 600px) {
    .message {
      white-space: normal;
    }
  }

  .actions {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
  }

  button {
    border: 1px solid color-mix(in srgb, var(--color-text-inverse) 30%, transparent);
    background: transparent;
    color: var(--color-text-primary);
    border-radius: 10px;
    padding: 0.45rem 0.7rem;
    min-height: 44px;
    cursor: pointer;
    line-height: 1;
    font-weight: 700;
  }

  .icon-btn {
    padding: 0.45rem 0.55rem;
    min-width: 44px;
    min-height: 2.25rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .small {
    padding: 0.4rem 0.6rem;
    font-weight: 700;
  }

  button:hover {
    border-color: color-mix(in srgb, var(--color-text-inverse) 55%, transparent);
    background: color-mix(in srgb, var(--color-text-inverse) 14%, transparent);
  }
</style>

