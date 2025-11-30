<script lang="ts">
  import { createEventDispatcher } from 'svelte'

  type SummaryEntry = {
    id: string
    roundLabel: string
    setLabel: string
    phaseIndex: number
    type?: string
    durationSeconds?: number
    plannedReps?: number | null
    loggedReps?: number | null
    autoFilled?: boolean
    weight?: number | null
  }

  const formatDuration = (seconds: number | undefined) => {
    if (!seconds || seconds <= 0) return '—'
    const mins = Math.floor(seconds / 60)
    const secs = Math.round(seconds % 60)
    return mins ? `${mins}m ${secs}s` : `${secs}s`
  }

  export let open = false
  export let entries: SummaryEntry[] = []

  const dispatch = createEventDispatcher()

  let localEntries: SummaryEntry[] = []
  let copyStatus = ''

  $: if (open) {
    // reset snapshot when opening
    localEntries = entries.map((e) => ({ ...e }))
    copyStatus = ''
  }

  const updateEntry = (id: string, value: number | null) => {
    localEntries = localEntries.map((row) =>
      row.id === id ? { ...row, loggedReps: value ?? null, autoFilled: false } : row
    )
  }

  const updateWeight = (id: string, value: number | null) => {
    localEntries = localEntries.map((row) => (row.id === id ? { ...row, weight: value ?? null } : row))
  }

  const handleSave = () => dispatch('save', { entries: localEntries })

  const copyToClipboard = async () => {
    const roundOrder: string[] = []
    const roundMap = new Map<
      string,
      { sets: SummaryEntry[] }
    >()

    localEntries.forEach((row) => {
      const round = row.roundLabel || 'Round'
      if (!roundMap.has(round)) {
        roundMap.set(round, { sets: [] })
        roundOrder.push(round)
      }
      roundMap.get(round)!.sets.push(row)
    })

    const lines: string[] = []
    roundOrder.forEach((round) => {
      const bucket = roundMap.get(round)
      if (!bucket) return
      const hasWork = bucket.sets.some((s) => !s.type || s.type === 'work')
      if (!hasWork && bucket.sets.length) {
        const restDur = bucket.sets.find((s) => s.durationSeconds)?.durationSeconds
        const durLabel = restDur ? ` (${formatDuration(restDur)})` : ''
        lines.push(`- Rest${durLabel}`)
        return
      }
      lines.push(`- ${round}:`)
      bucket.sets.forEach((row) => {
        const weight = row.weight ? ` @ ${row.weight}` : ''
        const dur = row.durationSeconds ? ` (${formatDuration(row.durationSeconds)})` : ''
        if (row.type && row.type !== 'work') {
          lines.push(`  - Rest${dur}`)
        } else {
          const reps = row.loggedReps ?? '-'
          const marker = row.autoFilled ? '(auto)' : ''
          lines.push(`  - ${row.setLabel}: ${reps}${weight}${dur} ${marker}`.trim())
        }
      })
    })

    const text = lines.join('\n')
    try {
      await navigator.clipboard.writeText(text)
      copyStatus = 'Copied!'
      setTimeout(() => (copyStatus = ''), 2000)
    } catch (err) {
      copyStatus = 'Copy failed'
      setTimeout(() => (copyStatus = ''), 2000)
    }
  }
</script>

{#if open}
  <div
    class="backdrop"
    role="button"
    tabindex="0"
    on:click={() => dispatch('close')}
    on:keydown={(e) => (e.key === 'Enter' || e.key === ' ') && dispatch('close')}
    aria-label="Close summary"
  ></div>
  <div class="modal" role="dialog" aria-label="Workout summary">
    <header>
      <div>
        <p class="eyebrow">Workout summary</p>
        <h2>Log your reps</h2>
      </div>
      <button class="ghost" on:click={() => dispatch('close')}>✕</button>
    </header>

    <section class="toolbar">
      <button class="ghost" type="button" on:click={copyToClipboard}>Copy summary</button>
      {#if copyStatus}
        <span class="status">{copyStatus}</span>
      {/if}
    </section>

    <section class="table">
      <div class="row header">
        <span>Phase</span>
        <span>Type</span>
        <span>Logged reps</span>
        <span>Weight</span>
      </div>
      {#each localEntries as entry (entry.id)}
        {@const isRest = entry.type === 'rest' || entry.type === 'roundRest' || entry.type === 'roundTransition'}
        {#if isRest}
          <div class="row rest-row tight-rest">
            <div class="rest-inline">
              <span class="rest-chip">
                {entry.type === 'roundRest' ? 'Round rest' : 'Rest'}
              </span>
              {#if entry.durationSeconds}
                <span class="muted small">{formatDuration(entry.durationSeconds)}</span>
              {/if}
            </div>
          </div>
        {:else}
          <div class="row">
            <div>
              <strong>{entry.roundLabel}</strong>
              <div class="muted">{entry.setLabel}</div>
              {#if entry.durationSeconds}
                <div class="muted small">{formatDuration(entry.durationSeconds)}</div>
              {/if}
            </div>
            <div class="muted type">{entry.type ?? 'phase'}</div>
            <div class="input-cell">
              <input
                type="number"
                min="0"
                value={entry.loggedReps ?? ''}
                on:input={(e) => {
                  const value = e.currentTarget.value.trim()
                  updateEntry(entry.id, value === '' ? null : Number(value))
                }}
                placeholder="0"
              />
            </div>
            <div class="input-cell">
              <input
                type="number"
                min="0"
                step="0.5"
                value={entry.weight ?? ''}
                on:input={(e) => {
                  const value = e.currentTarget.value.trim()
                  updateWeight(entry.id, value === '' ? null : Number(value))
                }}
                placeholder="kg / lb"
              />
            </div>
          </div>
        {/if}
      {/each}
    </section>

    <footer>
      <button class="ghost" type="button" on:click={() => dispatch('close')}>Close</button>
      <button class="primary" type="button" on:click={handleSave}>Save</button>
    </footer>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(5, 9, 20, 0.55);
    backdrop-filter: blur(6px);
    z-index: 80;
  }
  .modal {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: min(900px, 94vw);
    background: var(--color-surface-2);
    border: 1px solid var(--color-border);
    border-radius: 16px;
    padding: 1rem;
    z-index: 81;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  header, footer, .toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }
  h2 {
    margin: 0;
    color: var(--color-text-primary);
  }
  .eyebrow {
    margin: 0;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    font-size: 0.75rem;
    color: var(--color-accent-soft);
  }
  .table {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    max-height: 60vh;
    overflow: auto;
  }
  .row {
    display: grid;
    grid-template-columns: 1.3fr 0.5fr 0.9fr 0.9fr;
    gap: 0.5rem;
    align-items: center;
    padding: 0.65rem;
    border: 1px solid var(--color-border);
    border-radius: 12px;
    background: color-mix(in srgb, var(--color-surface-1) 90%, transparent);
  }
  .rest-row {
    background: color-mix(in srgb, var(--color-surface-2) 75%, transparent);
    border-style: dashed;
    opacity: 0.85;
  }
  .tight-rest {
    grid-template-columns: 1fr;
    padding: 0.5rem 0.65rem;
  }
  .row.header {
    font-weight: 700;
    color: var(--color-text-primary);
    background: transparent;
    border: none;
    padding: 0.25rem 0.5rem;
  }
  .muted {
    color: var(--color-text-muted);
    font-size: 0.9rem;
  }
  input {
    width: 100%;
    border-radius: 10px;
    border: 1px solid var(--color-border);
    background: var(--color-surface-1);
    color: var(--color-text-primary);
    padding: 0.6rem 0.7rem;
    font-size: 1rem;
  }
  .input-cell {
    display: flex;
    align-items: center;
    gap: 0.35rem;
  }
  .rest-inline {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
  }
  .rest-chip {
    display: inline-flex;
    align-items: center;
    padding: 0.35rem 0.65rem;
    border-radius: 10px;
    border: 1px dashed var(--color-border);
    background: color-mix(in srgb, var(--color-surface-1) 70%, transparent);
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-size: 0.85rem;
  }
  button {
    padding: 0.6rem 0.8rem;
    border-radius: 10px;
    border: 1px solid var(--color-border);
    background: var(--color-surface-2);
    color: var(--color-text-primary);
    cursor: pointer;
  }
  .ghost {
    background: transparent;
  }
  .primary {
    background: linear-gradient(135deg, var(--color-accent), var(--color-accent-hover));
    color: var(--color-text-inverse);
    border: none;
  }
  .small {
    padding: 0.4rem 0.6rem;
    font-size: 0.9rem;
  }
  .status {
    color: var(--color-text-muted);
    font-size: 0.9rem;
  }
</style>
