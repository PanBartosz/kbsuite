<script lang="ts">
  import { effectiveMode, repCount, runState } from '$lib/counter/stores/session'

  $: display = $runState !== 'running' || $effectiveMode === 'disabled' ? '—' : String($repCount)
</script>

<div class="rep-badge" aria-label="Repetition count">
  <div class="rep-label">Reps</div>
  <div class="rep-number">{display}</div>
</div>

<style>
  .rep-badge {
    background: color-mix(in srgb, var(--color-accent) 18%, var(--color-surface-2));
    border: 1px solid color-mix(in srgb, var(--color-accent) 35%, var(--color-border));
    border-radius: 12px;
    padding: 0.6rem 1rem;
    color: var(--color-text-primary);
    backdrop-filter: blur(4px);
    min-width: 120px;
  }
  .rep-label {
    font-size: 0.9rem;
    letter-spacing: 0.04em;
    color: var(--color-accent-soft);
  }
  .rep-number {
    font-size: clamp(2.8rem, 6vw, 4.5rem);
    font-weight: 900;
    line-height: 1.05;
  }
</style>
