<script lang="ts">
  import { createEventDispatcher } from 'svelte'

  export let plan: any = { rounds: [] }
  export let timeline: any[] = []
  export let showEditButtons = false
  export let headerActionLabel = ''

  const dispatch = createEventDispatcher()

  const emitEditRound = (round: any, index: number) => dispatch('editRound', { round, index })
  const emitEditSet = (roundIndex: number, setIndex: number) =>
    dispatch('editSet', { roundIndex, setIndex })
  const emitEditPlan = () => dispatch('editPlan')

  const roundKeyFor = (round: any, index: number) => round?.id ?? `round-${index + 1}`

  const durationOf = (phase: any) => {
    const raw = phase?.durationSeconds ?? phase?.duration ?? 0
    const seconds = Number(raw)
    return Number.isFinite(seconds) && seconds > 0 ? seconds : 0
  }

  const buildRoundTotalsMap = (phases: any[]) => {
    const map = new Map()
    if (!Array.isArray(phases)) return map

    phases.forEach((phase) => {
      const roundIndex = Number(phase?.roundIndex)
      if (!Number.isInteger(roundIndex) || roundIndex < 0) {
        return
      }
      const key = phase.roundId ?? `round-${roundIndex + 1}`
      const duration = durationOf(phase)
      if (duration <= 0) {
        return
      }
      const bucket = map.get(key) ?? { work: 0, rest: 0, total: 0 }
      bucket.total += duration
      if (phase.type === 'work') {
        bucket.work += duration
      } else {
        bucket.rest += duration
      }
      map.set(key, bucket)
    })

    return map
  }

  const getRoundTotals = (round: any, index: number, totalsMap: Map<string, any>) =>
    totalsMap.get(roundKeyFor(round, index)) ?? { work: 0, rest: 0, total: 0 }

  const buildSetSegments = (
    set: any,
    nextSetLabel: string,
    roundRepetitions = 1,
    roundRestAfterSeconds = 0,
    hasSubsequentRound = false
  ) => {
    const repetitions = Math.max(Number(set?.repetitions) || 1, 1)
    const workSeconds = Math.max(Number(set?.workSeconds) || 0, 0)
    const restSeconds = Math.max(Number(set?.restSeconds) || 0, 0)
    const transitionSeconds = Math.max(Number(set?.transitionSeconds) || 0, 0)
    const roundRestAfter = Math.max(Number(roundRestAfterSeconds) || 0, 0)
    const hasNextRound = Boolean(hasSubsequentRound)

    const sequence = []
    for (let rep = 0; rep < repetitions; rep += 1) {
      if (workSeconds > 0) {
        sequence.push({
          type: 'work',
          duration: workSeconds,
          label: repetitions > 1 ? `Work ${rep + 1}/${repetitions}` : 'Work'
        })
      }

      const isLastRep = rep === repetitions - 1
      const hasNextSet = Boolean(nextSetLabel)
      const hasAnotherRound = roundRepetitions > 1
      const hasNextRoundTransition = hasNextRound || roundRestAfter > 0
      const shouldAddRest =
        restSeconds > 0 &&
        (!isLastRep ||
          (isLastRep &&
            (hasNextSet || (hasAnotherRound && roundRestAfter <= 0) || hasNextRoundTransition)))
      if (shouldAddRest) {
        sequence.push({
          type: 'rest',
          duration: restSeconds,
          label: repetitions > 1 ? `Rest ${rep + 1}` : 'Rest'
        })
      }
    }

    const transitionSegment =
      transitionSeconds > 0 && nextSetLabel
        ? {
            type: 'transition',
            duration: transitionSeconds,
            label: `Transition → ${nextSetLabel}`
          }
        : null

    return {
      setRepetitions: repetitions,
      roundRepetitions: Math.max(Number(roundRepetitions) || 1, 1),
      work: workSeconds,
      rest: restSeconds,
      total: workSeconds * repetitions + restSeconds * (repetitions - 1) + (transitionSegment?.duration ?? 0),
      transitionSegment,
      hasSegments: workSeconds > 0 || restSeconds > 0
    }
  }

  $: roundTotalsMap = buildRoundTotalsMap(timeline)

  const formatDuration = (seconds?: number | null) => {
    const safe = Number(seconds)
    if (!Number.isFinite(safe) || safe <= 0) return '0s'
    const mins = Math.floor(safe / 60)
    const secs = Math.round(safe % 60)
    if (mins <= 0) return `${secs}s`
    return `${mins}m ${secs}s`
  }
</script>

<section class="rounds">
  <div class="rounds__header">
    <h2>Rounds &amp; sets</h2>
    {#if headerActionLabel}
      <button class="ghost rounds__header-button" type="button" on:click={emitEditPlan}>
        {headerActionLabel}
      </button>
    {/if}
  </div>
  <div class="rounds__list">
    {#each plan?.rounds ?? [] as round, roundIndex (round.id || roundIndex)}
      {@const roundTotals = getRoundTotals(round, roundIndex, roundTotalsMap)}
      <article class="round">
        <header class="round__header">
          <div>
            <h3>
              Round {roundIndex + 1}: {round.label}
            </h3>
            <p>
              Repetitions: {round.repetitions} · Rest after round:{' '}
              {formatDuration(round.restAfterSeconds || 0)}
            </p>
          </div>
          <div class="round__actions">
            <div class="round__badges">
              {#if round.repetitions > 1}
                <span class="round__badge round__badge--repeat">
                  {round.repetitions}× cycle
                </span>
              {/if}
              <span class="round__badge round__badge--duration">
                {formatDuration(roundTotals.total)}
              </span>
            </div>
            {#if showEditButtons}
              <button
                type="button"
                class="text-button"
                on:click={() => emitEditRound(round, roundIndex)}
              >
                Edit round
              </button>
            {/if}
          </div>
        </header>

        <div
          class="round-timeline"
          class:round-timeline--single={round.repetitions <= 1}
        >
          {#if round.repetitions > 1}
            <div class="round-timeline__repeat-label">
              {round.repetitions}× round
            </div>
          {/if}
          <div class="round-timeline__content">
            <ul class="set-list">
              {#each round.sets as set, setIndex (set.id || setIndex)}
                {#key `${set.id || setIndex}-${setIndex}`}
                  {@const segments = buildSetSegments(
                    set,
                    round.sets[setIndex + 1]?.label,
                    round.repetitions,
                    round.restAfterSeconds,
                    roundIndex < (plan?.rounds?.length ?? 0) - 1
                  )}
                  {@const hasSetBadge = segments.setRepetitions > 1 && segments.hasSegments}
                  <li class="set">
                    <div class="set__header">
                      <div>
                        <h4>{set.label}</h4>
                        <p>
                          {set.repetitions} × {formatDuration(set.workSeconds)} work
                          {#if set.restSeconds}
                            · rest {formatDuration(set.restSeconds)} between reps
                          {/if}
                          {#if set.targetRpm}
                            · {set.targetRpm} RPM
                          {/if}
                        </p>
                      </div>
                      <div class="set__meta">
                        <span class="set__meta-total">
                          Total: {formatDuration(segments.total)}
                        </span>
                        {#if setIndex < round.sets.length - 1 && set.transitionSeconds}
                          <span class="set__meta-transition">
                            Next transition: {formatDuration(set.transitionSeconds)}
                          </span>
                        {/if}
                        {#if showEditButtons}
                          <button
                            type="button"
                            class="text-button set__edit-button"
                            on:click={() => emitEditSet(roundIndex, setIndex)}
                          >
                            Edit set
                          </button>
                        {/if}
                      </div>
                    </div>
                    <div
                      class="set-timeline"
                      class:set-timeline--compact={!hasSetBadge}
                      aria-label={`Timeline for ${set.label}`}
                    >
                      {#if hasSetBadge}
                        <div class="set-repeat-labels">
                          <div class="set-repeat-label">
                            {segments.setRepetitions}× reps
                          </div>
                        </div>
                      {/if}
                      <div class="set-timeline__segments">
                        {#if segments.work}
                          <div class="segment-block segment-block--work">
                            <span class="segment-block__label">
                              {#if segments.setRepetitions > 1}
                                {set.targetRpm
                                  ? `Work per rep (${set.targetRpm} RPM)`
                                  : 'Work per rep'}
                              {:else}
                                {set.targetRpm ? `Work (${set.targetRpm} RPM)` : 'Work'}
                              {/if}
                            </span>
                            <span class="segment-block__time">{formatDuration(segments.work)}</span>
                          </div>
                        {/if}
                        {#if segments.rest}
                          <div class="segment-block segment-block--rest">
                            <span class="segment-block__label">
                              {segments.setRepetitions > 1 ? 'Rest between reps' : 'Rest'}
                            </span>
                            <span class="segment-block__time">{formatDuration(segments.rest)}</span>
                          </div>
                        {/if}
                      </div>
                    </div>
                  </li>
                  {#if segments.transitionSegment}
                    <li class="set-transition">
                      <div class="segment-block segment-block--transition">
                        <span class="segment-block__label">
                          {segments.transitionSegment.label}
                        </span>
                        <span class="segment-block__time">
                          {formatDuration(segments.transitionSegment.duration)}
                        </span>
                      </div>
                    </li>
                  {/if}
                {/key}
              {/each}
            </ul>
            {#if roundIndex < (plan?.rounds?.length ?? 0) - 1 && round.restAfterSeconds > 0}
              <div class="round-rest-block">
                <span class="round-rest-block__label">Rest between rounds</span>
                <span class="round-rest-block__time">{formatDuration(round.restAfterSeconds)}</span>
              </div>
            {/if}
          </div>
        </div>
      </article>
    {/each}
  </div>
</section>

<style>
  .rounds__list {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  .rounds__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    flex-wrap: wrap;
    margin-bottom: 0.35rem;
  }

  .rounds__header-button {
    padding: 0.55rem 1.2rem;
  }

  .round {
    background: var(--color-surface-2, #111a2e);
    border: 1px solid var(--color-border, #1f2a40);
    border-radius: 16px;
    padding: 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }

  .round__header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
    flex-wrap: wrap;
  }

  .round__header h3 {
    margin: 0;
    font-size: 1.3rem;
  }

  .round__header p {
    margin: 0.35rem 0 0;
    color: var(--color-text-secondary, #cbd5f5);
    font-size: 0.9rem;
  }

  .round__actions {
    display: flex;
    align-items: center;
    gap: 0.65rem;
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  .round__badges {
    display: flex;
    gap: 0.6rem;
    align-items: center;
    flex-wrap: wrap;
  }

  .round__badge {
    background: var(--color-border, #1f2a40);
    color: var(--color-badge-text, #f8fafc);
    border-radius: 999px;
    padding: 0.35rem 0.9rem;
    font-size: 0.85rem;
    font-weight: 600;
  }

  .round__badge--repeat {
    background: color-mix(in srgb, var(--color-accent, #4f9cf9) 18%, transparent);
    color: var(--color-roundrepeat-text, #e0f2fe);
    border: 1px solid color-mix(in srgb, var(--color-accent, #4f9cf9) 40%, transparent);
  }

  .round__badge--duration {
    background: color-mix(in srgb, var(--color-surface-deeper, #0b1220) 85%, transparent);
    border: 1px solid color-mix(in srgb, var(--color-border, #1f2a40) 55%, transparent);
  }

  .round-timeline {
    display: grid;
    grid-template-columns: auto 1fr;
    align-items: stretch;
    gap: 1rem;
    border-radius: 16px;
    padding: 0.75rem 1rem 1rem;
    background: color-mix(in srgb, var(--color-surface-deeper, #0b1220) 88%, transparent);
    border: 1px solid color-mix(in srgb, var(--color-border, #1f2a40) 55%, transparent);
  }

  .round-timeline--single {
    grid-template-columns: 1fr;
  }

  .round-timeline--single .round-timeline__repeat-label {
    display: none;
  }

  .round-timeline__repeat-label {
    align-self: flex-start;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0.45rem 0.85rem;
    background: color-mix(in srgb, var(--color-accent, #4f9cf9) 18%, transparent);
    border: 1px dashed color-mix(in srgb, var(--color-accent, #4f9cf9) 45%, transparent);
    border-radius: 12px;
    font-weight: 700;
    font-size: 0.85rem;
    color: var(--color-roundrepeat-text, #e0f2fe);
    white-space: nowrap;
  }

  .round-timeline__content {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .round-rest-block {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.6rem;
    padding: 0.75rem 0.85rem;
    border-radius: 12px;
    background: color-mix(in srgb, var(--color-accent, #4f9cf9) 12%, transparent);
    border: 1px solid color-mix(in srgb, var(--color-accent, #4f9cf9) 35%, transparent);
    font-size: 0.9rem;
    color: var(--color-roundrest-text, #fde68a);
  }

  .round-rest-block__label {
    font-weight: 600;
  }

  .set-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .set-transition {
    list-style: none;
    margin: 0.35rem 0 0.55rem;
  }

  .set {
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
    border: 1px solid var(--color-border, #1f2a40);
    border-radius: 14px;
    padding: 1.1rem 1.25rem;
    background: var(--color-surface-1, #0d1628);
  }

  .set__header {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    flex-wrap: wrap;
    align-items: flex-start;
  }

  .set h4 {
    margin: 0 0 0.35rem;
    font-size: 1.05rem;
  }

  .set p {
    margin: 0;
    font-size: 0.9rem;
    color: var(--color-text-muted, #94a3b8);
  }

  .set__meta {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 0.2rem;
    font-size: 0.82rem;
    color: var(--color-text-secondary, #cbd5f5);
    text-align: right;
  }

  .set__meta-total {
    font-weight: 600;
    color: var(--color-text-primary, #e2e8f0);
  }

  .set__edit-button {
    padding: 0.15rem 0;
    font-size: 0.85rem;
  }

  .set-timeline {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 0.75rem;
    width: 100%;
    align-items: stretch;
  }

  .set-timeline--compact {
    display: block;
  }

  .set-repeat-labels {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    justify-content: flex-start;
    min-width: 3.4rem;
  }

  .set-repeat-label {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0.28rem 0.75rem;
    background: color-mix(in srgb, var(--color-border, #1f2a40) 20%, transparent);
    border: 1px dashed color-mix(in srgb, var(--color-border, #1f2a40) 45%, transparent);
    border-radius: 10px;
    font-weight: 700;
    font-size: 0.82rem;
    color: var(--color-text-primary, #e2e8f0);
    white-space: nowrap;
    align-self: flex-start;
  }

  .set-timeline__segments {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
    padding-left: 1rem;
    border-left: 2px solid color-mix(in srgb, var(--color-border, #1f2a40) 45%, transparent);
  }

  .set-timeline__segments::before,
  .set-timeline__segments::after {
    content: '';
    position: absolute;
    left: -2px;
    width: 10px;
    height: 12px;
    border-left: 2px solid color-mix(in srgb, var(--color-border, #1f2a40) 45%, transparent);
  }

  .set-timeline__segments::before {
    top: -2px;
    border-top: 2px solid color-mix(in srgb, var(--color-border, #1f2a40) 45%, transparent);
    border-radius: 4px 0 0 0;
  }

  .set-timeline__segments::after {
    bottom: -2px;
    border-bottom: 2px solid color-mix(in srgb, var(--color-border, #1f2a40) 45%, transparent);
    border-radius: 0 0 0 4px;
  }

  .set-timeline--compact .set-timeline__segments {
    padding-left: 0;
    border-left: none;
  }

  .set-timeline--compact .set-timeline__segments::before,
  .set-timeline--compact .set-timeline__segments::after {
    display: none;
  }

  .segment-block {
    width: 100%;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.75rem;
    padding: 0.65rem 0.85rem;
    border-radius: 10px;
    color: var(--color-segment-text, #f8fafc);
    border: 1px solid transparent;
    font-size: 0.85rem;
    box-sizing: border-box;
  }

  .segment-block__label {
    font-weight: 600;
    letter-spacing: 0.02em;
  }

  .segment-block__time {
    font-size: 0.8rem;
    opacity: 0.85;
  }

  .segment-block--work {
    background: var(--color-work-bg, #7f1d1d);
    border-color: var(--color-work-border, #b91c1c);
  }

  .segment-block--rest {
    background: var(--color-rest-bg, #14532d);
    border-color: var(--color-success, #22c55e);
  }

  .segment-block--transition {
    background: var(--color-transition-bg, #1d4ed8);
    border-color: var(--color-accent-soft, #60a5fa);
  }

  @media (max-width: 680px) {
    .set {
      padding: 1rem;
    }

    .set-timeline {
      gap: 0.6rem;
      grid-template-columns: auto 1fr;
    }

    .set-repeat-labels {
      flex-direction: column;
      gap: 0.3rem;
      min-width: 3.6rem;
    }

    .set-repeat-label {
      padding: 0.25rem 0.55rem;
      border-radius: 8px;
      font-size: 0.78rem;
    }

    .set-timeline__segments {
      gap: 0.4rem;
      padding-left: 0.75rem;
    }

    .segment-block {
      flex-wrap: wrap;
      gap: 0.4rem;
      padding: 0.55rem 0.65rem;
      font-size: 0.8rem;
    }

    .set-transition {
      margin: 0.3rem 0 0.5rem;
    }

    .set-timeline__segments::before,
    .set-timeline__segments::after {
      width: 8px;
      height: 9px;
    }
  }
</style>
