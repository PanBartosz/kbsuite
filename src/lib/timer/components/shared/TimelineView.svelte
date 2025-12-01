<script lang="ts">
  import PhaseQueue from '$lib/timer/components/PhaseQueue.svelte'

  export let phases: any[] = []
  export let activeIndex = -1
  export let title = 'Timeline'
</script>

<section class="timeline-view">
  <div class="timeline-view__header">
    <h3>{title}</h3>
  </div>
  <PhaseQueue phases={phases} activeIndex={activeIndex} />
</section>

<style>
  .timeline-view {
    display: flex;
    flex-direction: column;
    gap: 0.65rem;
  }
  .timeline-view__header h3 {
    margin: 0;
    font-size: 1rem;
    color: var(--color-text-primary, #e2e8f0);
  }
  :global(.phase-queue) {
    width: 100%;
  }
</style>
