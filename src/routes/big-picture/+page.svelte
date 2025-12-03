<script lang="ts">
  export const ssr = false
  export const prerender = false
  import TimerApp from '$lib/timer/TimerApp.svelte'
  import CounterWidget from '$lib/counter/CounterWidget.svelte'
  import { page } from '$app/stores'

  let counterRef: any
  const workoutId = $derived($page.url.searchParams.get('workout') ?? '')
  const plannedId = $derived($page.url.searchParams.get('planned') ?? '')

  const applyRepCounterDirectives = (phase: any) => {
    const metadata = phase?.metadata ?? {}
    const mode = metadata.repCounterMode ?? 'disabled'
    const enabled = metadata.repCounterEnabled === true
    const gesturesAllowed = enabled && metadata.enableModeChanging !== false

    counterRef?.setGesturesEnabled?.(gesturesAllowed)
    counterRef?.setCountingEnabled?.(enabled)

    if (mode === 'swing' || mode === 'lockout' || mode === 'disabled') {
      counterRef?.setMode?.(mode, { silent: true })
    }
  }

  const handleStart = () => counterRef?.start?.()
  const handlePause = () => counterRef?.pause?.()
  const handleResume = () => counterRef?.resume?.()
  const handleStop = () => counterRef?.stop?.()
  const handlePhaseChange = (event: CustomEvent<any>) => {
    const phase = event?.detail?.phase
    counterRef?.reset?.()
    applyRepCounterDirectives(phase)
  }
</script>

<div class="big-shell">
  <TimerApp
    hideHeader={false}
    hideControlBar={false}
    showInlineSlot={true}
    initialWorkoutId={workoutId}
    initialPlannedId={plannedId}
    on:start={handleStart}
    on:pause={handlePause}
    on:resume={handleResume}
    on:stop={handleStop}
    on:phaseChange={handlePhaseChange}
  >
    <div slot="inline" class="side-counter">
      <CounterWidget bind:this={counterRef} />
    </div>
  </TimerApp>
</div>

<style>
  .big-shell {
    padding: 0.5rem;
    max-width: 1200px;
    margin: 0 auto;
  }
  :global(.big-shell .page) {
    max-width: 1200px;
    width: 100%;
    margin: 0 auto;
    padding: 1rem 0.75rem 1.5rem;
  }
  .side-counter :global(.panel.tips) {
    display: none;
  }
  .side-counter :global(.controls),
  .side-counter :global(.mobile-bar) {
    display: none;
  }
  .side-counter :global(.session) {
    grid-template-columns: 1fr;
  }
</style>
