<script lang="ts">
  import { effectiveMode, rpm, runState } from '$lib/counter/stores/session'

  $: display =
    $runState !== 'running' || $effectiveMode === 'disabled' || $rpm === null ? '—' : String($rpm)
</script>

<div class="rpm-badge" aria-label="Repetitions per minute">
  <div class="rpm-label">RPM</div>
  <div class="rpm-number">{display}</div>
</div>

<style>
  .rpm-badge {
    background: color-mix(in srgb, var(--color-success) 18%, var(--color-surface-2));
    border: 1px solid color-mix(in srgb, var(--color-success) 35%, var(--color-border));
    border-radius: 12px;
    padding: 0.6rem 1rem;
    color: var(--color-text-primary);
    backdrop-filter: blur(4px);
    min-width: 120px;
  }
  .rpm-label {
    font-size: 0.9rem;
    letter-spacing: 0.04em;
    color: var(--color-success-soft);
  }
  .rpm-number {
    font-size: clamp(2.8rem, 6vw, 4.5rem);
    font-weight: 900;
    line-height: 1.05;
  }
</style>
