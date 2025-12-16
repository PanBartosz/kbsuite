<script>
  import { createEventDispatcher } from 'svelte'

  export let activePhase = null
  export let phaseRemainingSeconds = 0
  export let phaseProgressPercent = 0
  export let totalRemainingSeconds = 0
  export let overallProgressPercent = 0
  export let nextPhase = null
  export let isRunning = false
  export let isPaused = false
  export let showInlineSlot = false

  const dispatch = createEventDispatcher()

  const formatClock = (seconds) => {
    if (!Number.isFinite(seconds)) return '0:00'
    const safeSeconds = Math.max(Math.round(seconds), 0)
    const mins = Math.floor(safeSeconds / 60)
    const secs = safeSeconds % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

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

  const handleTimerAreaInteraction = () => {
    dispatch('toggleTimer')
  }

  const handleKeydown = (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      handleTimerAreaInteraction()
    }
  }

  $: currentPhaseType = isPaused
    ? 'paused'
    : activePhase?.type ?? 'idle'
</script>

<section class="timer-display" aria-live="assertive">
  <header class="timer-display__header">
    <span class="timer-display__phase-type">
      {#if activePhase}
        {labelForPhaseType(activePhase.type)}
      {:else}
        Timer Ready
      {/if}
    </span>
    <span class="timer-display__total">
      Remaining {formatClock(totalRemainingSeconds)}
    </span>
  </header>

  <div class="timer-display__body" class:with-inline={showInlineSlot}>
    <div
      class="timer-display__current"
      class:timer-display__current--work={currentPhaseType === 'work'}
      class:timer-display__current--rest={currentPhaseType === 'rest'}
      class:timer-display__current--transition={currentPhaseType === 'transition'}
      class:timer-display__current--round-transition={currentPhaseType === 'roundTransition'}
      class:timer-display__current--round-rest={currentPhaseType === 'roundRest'}
      class:timer-display__current--prep={currentPhaseType === 'prep'}
      class:timer-display__current--paused={currentPhaseType === 'paused'}
      class:timer-display__current--idle={currentPhaseType === 'idle'}
      role="button"
      tabindex="0"
      aria-pressed={isPaused}
      aria-label={isRunning
        ? isPaused
          ? 'Timer paused. Tap to resume.'
          : 'Timer running. Tap to pause.'
        : 'Timer ready. Start from controls below.'}
      on:click={handleTimerAreaInteraction}
      on:keydown={handleKeydown}
    >
      <p class="timer-display__time">
        {formatClock(phaseRemainingSeconds)}
      </p>
      <p class="timer-display__label">
        {#if activePhase}
          {activePhase.label}
        {:else}
          Waiting to start
        {/if}
      </p>
    </div>
    {#if showInlineSlot}
      <div class="inline-slot">
        <slot name="inline" />
      </div>
    {/if}
  </div>

  <div class="timer-display__bars">
    <div class="bar" aria-label="Current phase progress">
      <span style={`width: ${Math.min(Math.max(phaseProgressPercent ?? 0, 0), 100)}%`}></span>
    </div>
    <div class="bar bar--overall" aria-label="Overall workout progress">
      <span style={`width: ${Math.min(Math.max(overallProgressPercent ?? 0, 0), 100)}%`}></span>
    </div>
  </div>

  <div class="timer-display__next">
    <p class="timer-display__next-label">Next phase</p>
    {#if nextPhase}
      <div class="timer-display__next-meta">
        <strong>{nextPhase.label}</strong>
        <span>{labelForPhaseType(nextPhase.type)} · {formatClock(nextPhase.durationSeconds)}</span>
      </div>
    {:else}
      <span class="timer-display__next-meta">No further phases</span>
    {/if}
  </div>
</section>

<style>
  .timer-display {
    display: flex;
    flex-direction: column;
    gap: 1.35rem;
  }

  .timer-display__header {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-size: 0.75rem;
    color: var(--color-text-muted);
  }

  .timer-display__phase-type {
    font-weight: 600;
    color: var(--color-accent);
  }

  .timer-display__total {
    color: var(--color-text-primary);
  }

  .timer-display__current {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
  gap: 0.6rem;
  padding: 2rem;
  border-radius: 20px;
  background: var(--color-surface-2);
  border: 1px solid var(--color-border);
  cursor: pointer;
  transition: background-color 180ms ease, border-color 180ms ease, transform 160ms ease;
  box-sizing: border-box;
}

  .timer-display__current:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 4px;
  }

.timer-display__current:active {
  transform: scale(0.99);
}

  .timer-display__time {
    margin: 0;
    font-size: clamp(3.2rem, 12vw, 4rem);
    font-weight: 700;
    letter-spacing: 0.04em;
    color: var(--color-phase-foreground);
  }

  .timer-display__label {
    margin: 0;
    font-size: clamp(1rem, 4vw, 1.4rem);
    color: var(--color-phase-foreground);
    line-height: 1.2;
    min-height: calc(1.2em * 2);
  }

  .timer-display__bars {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }

  .timer-display__body {
    display: grid;
    grid-template-columns: 1fr;
    gap: 0.75rem;
    align-items: stretch;
  }
  .timer-display__body.with-inline {
    grid-template-columns: 3fr 2fr; /* ~60/40 split */
    align-items: stretch;
  }
  .inline-slot {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    min-width: 0;
  }
  :global(.inline-content) {
    flex: 1 1 auto;
    width: 100%;
    min-width: 0;
  }
  .inline-slot :global(video),
  .inline-slot :global(canvas),
  .inline-slot :global(img),
  .inline-slot :global(.inline-content) {
    max-width: 100%;
    max-height: 80vh;
    width: 100%;
    height: auto;
    object-fit: contain;
    aspect-ratio: auto;
  }

  @media (max-width: 900px) {
    .timer-display__body.with-inline {
      grid-template-columns: 1fr;
    }
    .inline-slot {
      justify-content: stretch;
      align-items: stretch;
    }
    .inline-slot :global(video),
    .inline-slot :global(canvas),
    .inline-slot :global(img),
    .inline-slot :global(.inline-content) {
      max-height: 42vh;
    }
  }

  .bar {
    position: relative;
    height: 10px;
    border-radius: 999px;
    background: var(--color-progress-track);
    overflow: hidden;
    border: 1px solid var(--color-border-soft);
  }

  .bar span {
    display: block;
    height: 100%;
    background: var(--color-accent);
    transition: width 220ms ease-out, background-color 180ms ease;
  }

  .bar--overall span {
    background: var(--color-success);
  }

:global(.timer-panel--fullscreen) .timer-display__bars {
  gap: 0.9rem;
}

:global(.timer-panel--fullscreen) .timer-display__bars .bar {
  height: 20px !important;
  border-width: 2px;
}

:global(.timer-panel--fullscreen) .timer-display__bars .bar span {
  height: 100% !important;
}

.timer-display__next {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  padding: 1.25rem;
  border-radius: 16px;
  background: var(--color-surface-2);
  border: 1px solid var(--color-border);
  transition: background-color 180ms ease, border-color 180ms ease;
  min-height: 80px;
}

  @media (min-width: 1200px) {
    .timer-display__time {
      font-size: clamp(4rem, 9vw, 7.5rem);
    }

    .timer-display__current {
      padding: 2.4rem;
    }

    .timer-display__label {
      font-size: clamp(1.2rem, 3vw, 2rem);
    }
  }

  .timer-display__next-label {
    margin: 0;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-size: 0.75rem;
    color: var(--color-text-muted);
  }

  .timer-display__next-meta {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: clamp(0.85rem, 3.5vw, 0.95rem);
    color: var(--color-text-primary);
    min-height: 2.4em;
  }

  .timer-display__next-meta strong {
    font-size: clamp(0.95rem, 3.8vw, 1.05rem);
  }

  @media (max-width: 680px) {
    .timer-display__current {
      padding: 1.6rem;
      gap: 0.5rem;
    }

    .timer-display__next {
      padding: 1rem;
      gap: 0.3rem;
    }
  }

  .timer-display__current--work {
    background: var(--color-work-bg);
    border-color: var(--color-work-border);
  }

  .timer-display__current--rest {
    background: var(--color-rest-bg);
    border-color: var(--color-success);
  }

  .timer-display__current--transition,
  .timer-display__current--round-transition {
    background: var(--color-transition-bg);
    border-color: var(--color-accent-soft);
  }

  .timer-display__current--round-rest {
    background: var(--color-roundrest-bg);
    border-color: var(--color-roundrest-border);
  }

  .timer-display__current--prep {
    background: var(--color-roundtransition-bg);
    border-color: var(--color-accent-hover);
  }

  .timer-display__current--paused {
    background: var(--color-paused-bg);
    border-color: var(--color-paused-border);
  }

  .timer-display__current--idle {
    background: var(--color-surface-2);
    border-color: var(--color-border);
  }

  @media (prefers-contrast: more) {
    .timer-display__current--work {
      background: var(--color-work-bg-contrast);
      border-color: var(--color-danger);
    }

    .timer-display__current--rest {
      background: var(--color-rest-bg-contrast);
      border-color: var(--color-success-bright);
    }

    .timer-display__current--transition,
    .timer-display__current--round-transition {
      background: var(--color-prep-bg);
      border-color: var(--color-accent-muted);
    }

    .timer-display__current--round-rest {
      background: var(--color-roundrest-bg-contrast);
      border-color: var(--color-warning-strong);
    }

    .timer-display__current--prep {
      background: var(--color-roundtransition-bg);
      border-color: var(--color-accent-soft);
    }

    .timer-display__current--paused {
      background: var(--color-paused-border);
      border-color: var(--color-paused-border);
    }
  }
</style>
