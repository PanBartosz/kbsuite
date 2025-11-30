<script lang="ts">
  import { createEventDispatcher } from 'svelte'
  import PoseSession from '$lib/counter/components/PoseSession.svelte'
  import { runState } from '$lib/counter/stores/session'
  import '$lib/counter/app.css'
  import { repCount, poseStats, exercise } from '$lib/counter/stores/session'
  let showHero = true
  let sessionRef: any
  const dispatch = createEventDispatcher()
  export let showTips = true
  export let showControls = true
  export let hideHeader = false

  $: if ($runState === 'running') showHero = false
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

<main class="page">
  <section class="panel" id="live-session">
    {#if !hideHeader}
      <div class="panel-head">
        <div>
          <p class="eyebrow">Live session</p>
          <h2>Camera, overlay, and rep counter</h2>
        </div>
        <p class="hint">If FPS is low, switch to better light, lower resolution, or enable low-FPS mode.</p>
      </div>
    {/if}
    <PoseSession bind:this={sessionRef} showControls={showControls} />
  </section>

  {#if showTips}
    <section class="panel tips">
      <div>
        <p class="eyebrow">Tips</p>
        <ul>
          <li>Face the camera (frontal view); keep full body in frame and steady light.</li>
          <li>Modes: Swing counts hinge-driven swings; Lockout counts overhead lockouts (snatch style).</li>
          <li>Gestures: T-pose reset (~1s hold); hands low + hinge to switch to Swing; overhead hold to switch to Lockout.</li>
          <li>Enable low-FPS mode on mobile if tracking lags.</li>
        </ul>
      </div>
    </section>
  {/if}
</main>
