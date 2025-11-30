<script lang="ts">
  import { onDestroy } from 'svelte'
  import PoseSession from '$lib/counter/components/PoseSession.svelte'
  import { repCount } from '$lib/counter/stores/session'
  import { setLatestRepCount } from '$lib/stats/summaryStore'

  let sessionRef: any

  const unsubscribe = repCount.subscribe((value) => setLatestRepCount(value))

  onDestroy(() => {
    unsubscribe?.()
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
  export function reset() {
    sessionRef?.resetReps?.()
  }
</script>

<div class="widget">
  <PoseSession bind:this={sessionRef} showControls={false} showStats={false} />
</div>

<style>
  .widget :global(.controls),
  .widget :global(.mobile-bar),
  .widget :global(.panel.tips) {
    display: none !important;
  }
  .widget :global(.session) {
    grid-template-columns: 1fr;
  }
  .widget :global(.video-panel) {
    border: 1px solid var(--color-border);
  }
</style>
