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
    background: linear-gradient(135deg, var(--color-accent), var(--color-accent-hover));
    color: var(--color-text-inverse);
    border-radius: 14px;
    padding: 0.4rem 0.9rem 0.55rem;
    min-width: 180px;
    text-align: center;
    border: none;
    box-shadow: none;
  }
  .mode-badge.lockout {
    background: linear-gradient(135deg, #f97316, #fb923c);
    color: #0a0a0a;
  }
  .mode-badge.disabled {
    background: linear-gradient(135deg, #1f2937, #111827);
    color: #e5e7eb;
    border: 1px solid #374151;
  }
  .mode-label {
    font-size: 0.85rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    opacity: 0.8;
  }
  .mode-value {
    font-size: 2.2rem;
    font-weight: 900;
    line-height: 1.05;
  }
</style>
