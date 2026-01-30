<script lang="ts">
  import { effectiveMode } from '$lib/counter/stores/session'

  $: modeBadgeLabel =
    $effectiveMode === 'disabled'
      ? 'Disabled'
      : $effectiveMode === 'lockout'
        ? 'Lockout mode'
        : 'Swing mode'
</script>

<div
  class="mode-badge"
  class:lockout={$effectiveMode === 'lockout'}
  class:disabled={$effectiveMode === 'disabled'}
  aria-label={`Counter mode: ${modeBadgeLabel}`}
>
  <div class="mode-label">Mode</div>
  <div class="mode-value">{modeBadgeLabel}</div>
</div>

<style>
  .mode-badge {
    --mode-tint: var(--color-accent);
    background: color-mix(
      in srgb,
      var(--mode-tint) 12%,
      var(--hud-surface-bg, var(--color-surface-2))
    );
    color: var(--color-text-primary);
    border-radius: 16px;
    padding: 0.4rem 0.9rem 0.55rem;
    min-width: 180px;
    text-align: center;
    border: 1px solid
      color-mix(
        in srgb,
        var(--mode-tint) 45%,
        var(--hud-surface-border, var(--color-border))
      );
    box-shadow: none;
    backdrop-filter: blur(var(--hud-blur, 0px));
    -webkit-backdrop-filter: blur(var(--hud-blur, 0px));
  }
  .mode-badge.lockout {
    --mode-tint: var(--color-danger);
  }
  .mode-badge.disabled {
    --mode-tint: var(--color-border);
    background: var(--hud-surface-bg, var(--color-surface-2));
    border-color: var(--hud-surface-border, var(--color-border));
    color: var(--color-text-secondary);
  }
  .mode-label {
    font-size: 0.85rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: color-mix(in srgb, var(--mode-tint) 55%, var(--color-text-secondary));
  }
  .mode-value {
    font-size: 2.2rem;
    font-weight: 900;
    line-height: 1.05;
  }
</style>
