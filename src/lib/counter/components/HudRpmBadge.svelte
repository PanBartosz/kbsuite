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
    border-radius: 16px;
    padding: 0.8rem;
    color: var(--color-text-primary);
    backdrop-filter: blur(4px);
    aspect-ratio: 1 / 1;
    display: grid;
    grid-template-rows: auto 1fr;
    justify-items: center;
    text-align: center;
  }
  .rpm-label {
    font-size: 0.9rem;
    letter-spacing: 0.04em;
    color: var(--color-success-soft);
    text-transform: uppercase;
    margin: 0.15rem 0 0.1rem;
  }
  .rpm-number {
    font-size: clamp(3.2rem, 6vw, 5.4rem);
    font-weight: 900;
    line-height: 1;
    font-variant-numeric: tabular-nums;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
  }
</style>
