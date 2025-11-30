<script>
  export let phases = []
  export let activeIndex = -1

  const labelForPhaseType = (type) => {
    switch (type) {
      case 'work':
        return 'Work'
      case 'rest':
        return 'Rest'
      case 'transition':
        return 'Transition'
      case 'roundRest':
        return 'Round Rest'
      case 'roundTransition':
        return 'Next Round'
      default:
        return 'Phase'
    }
  }

  const formatDuration = (seconds) => {
    if (!Number.isFinite(seconds)) return '0:00'
    const safe = Math.max(Math.round(seconds), 0)
    const mins = Math.floor(safe / 60)
    const secs = safe % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }
</script>

<section class="phase-queue">
  <header>
    <h3>Timeline</h3>
    <span>{phases.length} phases</span>
  </header>
  <ul>
    {#each phases as phase, index (phase.id)}
      <li
        class:phase-queue__item--active={index === activeIndex}
        class:phase-queue__item--completed={index < activeIndex}
      >
        <div class="phase-queue__meta">
          <span class="phase-queue__type">{labelForPhaseType(phase.type)}</span>
          <strong>{phase.label}</strong>
        </div>
        <span class="phase-queue__time">{formatDuration(phase.durationSeconds ?? phase.duration)}</span>
      </li>
    {/each}
    {#if phases.length === 0}
      <li class="phase-queue__empty">No phases configured.</li>
    {/if}
  </ul>
</section>

<style>
  .phase-queue {
    background: var(--color-surface-2);
    border-radius: 16px;
    border: 1px solid var(--color-border);
    padding: 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .phase-queue header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 0.5rem;
  }

  .phase-queue header h3 {
    margin: 0;
    font-size: 1.1rem;
  }

  .phase-queue header span {
    font-size: 0.85rem;
    color: var(--color-text-muted);
  }

  .phase-queue ul {
    list-style: none;
    margin: 0;
    padding: 0;
    max-height: 320px;
    overflow: auto;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .phase-queue li {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
    padding: 0.75rem 1rem;
    border-radius: 12px;
    border: 1px solid var(--color-border);
    background: var(--color-surface-1);
  }

  .phase-queue__item--active {
    border-color: var(--color-accent);
    background: var(--color-surface-3);
  }

  .phase-queue__item--completed {
    border-color: var(--color-border);
    color: var(--color-placeholder);
  }

  .phase-queue__meta {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }

  .phase-queue__type {
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--color-text-muted);
  }

  .phase-queue__meta strong {
    font-size: 0.95rem;
    color: var(--color-text-primary);
  }

  .phase-queue__time {
    font-size: 0.9rem;
    color: var(--color-text-secondary);
  }

  .phase-queue__empty {
    justify-content: center;
    border-style: dashed;
    color: var(--color-text-muted);
  }
</style>
