<script lang="ts">
  import { createEventDispatcher } from 'svelte'
  import PoseSession from '$lib/counter/components/PoseSession.svelte'
  import { runState } from '$lib/counter/stores/session'
  import '$lib/counter/app.css'
  import { repCount, poseStats, exercise } from '$lib/counter/stores/session'
  let sessionRef: any
  const dispatch = createEventDispatcher()
  export let showTips = true
  export let showControls = true
  export let hideHeader = false

  $: dispatch('state', {
    runState: $runState,
    reps: $repCount,
    poseStats: $poseStats,
    exercise: $exercise
  })

  export function start() {
    sessionRef?.startSession?.()
  }
  export function pause() {
    sessionRef?.pauseSession?.()
  }
  export function stop() {
    sessionRef?.stopSession?.()
  }
</script>

<main class="page counter-app">
  <section class="panel" id="live-session">
    {#if !hideHeader}
      <div class="panel-head">
        <div>
          <p class="eyebrow">Live session</p>
          <h2>Rep counter</h2>
        </div>
        <p class="hint">Choose your movement, then start. Keep your full body in view.</p>
      </div>
    {/if}
    <PoseSession bind:this={sessionRef} showControls={showControls} />
  </section>

  {#if showTips}
    <details class="panel tips">
      <summary><span class="eyebrow">Tips</span><strong>Get more reliable counts</strong></summary>
      <div class="tips-body">
        <ul>
          <li>Face the camera (frontal view); keep full body in frame and steady light.</li>
          <li>Modes: Swing counts hinge-driven swings; Lockout counts overhead lockouts (snatch style).</li>
          <li>Gestures: T-pose reset (~1s hold); hands low + hinge to switch to Swing; overhead hold to switch to Lockout.</li>
          <li>Enable low-FPS mode on mobile if tracking lags.</li>
        </ul>
      </div>
    </details>
  {/if}
</main>
