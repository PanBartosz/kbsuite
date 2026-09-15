<script context="module" lang="ts">
  export type CompletedSet = {
    phase_index?: number
    round_label?: string
    set_label?: string
    reps?: number | null
    weight?: number | null
    duration_s?: number | null
    type?: string | null
    rpe?: number | null
  }
</script>

<script lang="ts">
  import { createEventDispatcher } from 'svelte'
  export let set: CompletedSet
  export let index: number
  export let last = false
  let detailsOpen = false
  const dispatch = createEventDispatcher<{
    change: Partial<CompletedSet>; copy: void; move: number; remove: void
  }>()
  $: isRest = !!set.type && set.type !== 'work'
  $: label = isRest ? (set.type === 'transition' ? 'Transition' : 'Rest') : set.set_label || 'Work set'
  const number = (value: string) => value.trim() === '' ? null : Number(value)
</script>

<fieldset class="set-editor" class:rest={isRest}>
  <legend class="sr-only">Set {index + 1}: {label}</legend>
  <div class="set-heading">
    <strong>{index + 1}. {label}</strong>
    {#if !isRest && set.round_label}<span>{set.round_label}</span>{/if}
  </div>
  {#if isRest}
    <label class="rest-duration">{label} (sec)
      <input type="number" min="0" step="1" inputmode="numeric" value={set.duration_s ?? ''}
        on:input={(event) => dispatch('change', { duration_s: number(event.currentTarget.value) })} />
    </label>
  {:else}
    <label class="reps">Reps
      <input type="number" min="0" step="1" inputmode="numeric" enterkeyhint="next" value={set.reps ?? ''}
        on:input={(event) => dispatch('change', { reps: number(event.currentTarget.value) })} />
    </label>
    <label class="weight">Weight (kg / lb)
      <input type="number" min="0" step="0.5" inputmode="decimal" enterkeyhint="done" value={set.weight ?? ''}
        on:input={(event) => dispatch('change', { weight: number(event.currentTarget.value) })} />
    </label>
  {/if}
  <button class="details-toggle" type="button" aria-expanded={detailsOpen} aria-controls={`set-details-${index}`}
    on:click={() => detailsOpen = !detailsOpen}>{detailsOpen ? 'Fewer details' : 'More details'} <span aria-hidden="true">{detailsOpen ? '−' : '+'}</span></button>
  <div class="details-fields" class:collapsed={!detailsOpen} id={`set-details-${index}`}>
    {#if !isRest}
      <label class="round">Round
        <input value={set.round_label ?? ''} on:input={(event) => dispatch('change', { round_label: event.currentTarget.value })} />
      </label>
      <label class="exercise">Set label
        <input value={set.set_label ?? ''} on:input={(event) => dispatch('change', { set_label: event.currentTarget.value })} />
      </label>
      <label class="duration">Duration (sec)
        <input type="number" min="0" step="1" inputmode="numeric" value={set.duration_s ?? ''}
          on:input={(event) => dispatch('change', { duration_s: number(event.currentTarget.value) })} />
      </label>
      <label class="rpe">RPE
        <input type="number" min="1" max="10" step="1" inputmode="numeric" placeholder="1–10" value={set.rpe ?? ''}
          on:input={(event) => dispatch('change', { rpe: number(event.currentTarget.value) })} />
      </label>
    {/if}
    <div class="row-actions">
      <label>Phase type
        <select value={set.type ?? 'work'} on:change={(event) => dispatch('change', { type: event.currentTarget.value })}>
          <option value="work">Work</option><option value="rest">Rest</option><option value="transition">Transition</option>
          {#if set.type && !['work', 'rest', 'transition'].includes(set.type)}<option value={set.type}>{set.type}</option>{/if}
        </select>
      </label>
      <div class="row-buttons">
        <button type="button" aria-label="Copy set" title="Copy set" on:click={() => dispatch('copy')}><i class="ri-file-copy-line" aria-hidden="true"></i></button>
        <button type="button" aria-label="Move set up" title="Move set up" disabled={index === 0} on:click={() => dispatch('move', -1)}><i class="ri-arrow-up-line" aria-hidden="true"></i></button>
        <button type="button" aria-label="Move set down" title="Move set down" disabled={last} on:click={() => dispatch('move', 1)}><i class="ri-arrow-down-line" aria-hidden="true"></i></button>
        <button type="button" class="danger" aria-label="Delete set" title="Delete set" on:click={() => dispatch('remove')}><i class="ri-delete-bin-6-line" aria-hidden="true"></i></button>
      </div>
    </div>
  </div>
</fieldset>

<style>
  .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
  .set-editor { min-width: 0; margin: 0; padding: 0.75rem; border: 1px solid var(--color-border); border-radius: 12px; background: var(--color-surface-1); display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.65rem; }
  .set-heading { grid-column: 1 / -1; display: grid; gap: 0.1rem; overflow-wrap: anywhere; }
  .set-heading span { font-size: 0.85rem; color: var(--color-text-muted); }
  label { min-width: 0; display: flex; flex-direction: column; gap: 0.35rem; font-size: 0.85rem; color: var(--color-text-secondary); }
  input, select, button { min-width: 0; min-height: 44px; border: 1px solid var(--color-border); border-radius: 8px; background: var(--color-surface-2); color: var(--color-text-primary); padding: 0.5rem; font: inherit; }
  input, select { width: 100%; font-size: 1rem; }
  input, select, button { scroll-margin-block: 80px 120px; }
  .reps input, .weight input { font-size: 1.1rem; }
  button { cursor: pointer; }
  button:disabled { opacity: 0.4; cursor: default; }
  .details-toggle { grid-column: 1 / -1; display: flex; justify-content: space-between; align-items: center; background: transparent; border-color: transparent; font-size: 0.9rem; text-align: left; }
  .details-fields { grid-column: 1 / -1; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.65rem; border-top: 1px solid var(--color-border); padding-top: 0.75rem; }
  .details-fields.collapsed { display: none; }
  .row-actions { grid-column: 1 / -1; display: flex; flex-wrap: wrap; align-items: end; justify-content: space-between; gap: 0.65rem; }
  .row-buttons { display: flex; gap: 0.25rem; }
  .row-buttons button { width: 44px; }
  .danger { color: var(--color-danger); }
  .rest { background: var(--color-surface-2); }
  .rest .set-heading { grid-column: 1; align-self: center; }
  .rest-duration { grid-column: 2; }
  @media (min-width: 1100px) {
    .set-editor { grid-template-columns: minmax(90px, 1fr) minmax(110px, 1.3fr) repeat(4, minmax(75px, 0.7fr)) minmax(185px, 1.3fr); align-items: start; }
    .set-heading, .details-toggle { display: none; }
    .details-fields, .details-fields.collapsed { display: contents; }
    .round { grid-area: 1 / 1; } .exercise { grid-area: 1 / 2; }
    .duration, .rest-duration { grid-area: 1 / 3; }
    .reps { grid-area: 1 / 4; } .weight { grid-area: 1 / 5; } .rpe { grid-area: 1 / 6; }
    .row-actions { grid-area: 1 / 7; }
    .row-actions label { width: 100%; }
    .rest .set-heading { display: grid; grid-area: 1 / 1 / 2 / 3; }
  }
</style>
