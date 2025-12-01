<script lang="ts">
  export let totals: { work: number; rest: number; total: number } = { work: 0, rest: 0, total: 0 }
  export let roundCount = 0

  const formatDuration = (seconds?: number | null) => {
    const safe = Number(seconds)
    if (!Number.isFinite(safe) || safe <= 0) return '0s'
    const mins = Math.floor(safe / 60)
    const secs = Math.round(safe % 60)
    if (mins <= 0) return `${secs}s`
    return `${mins}m ${secs}s`
  }
</script>

<section class="overview">
  <h3>Session overview</h3>
  <div class="overview__grid">
    <div class="overview__item">
      <span>Total work</span>
      <strong>{formatDuration(totals.work)}</strong>
    </div>
    <div class="overview__item">
      <span>Total rest</span>
      <strong>{formatDuration(totals.rest)}</strong>
    </div>
    <div class="overview__item">
      <span>Rounds</span>
      <strong>{roundCount}</strong>
    </div>
    <div class="overview__item">
      <span>Total time</span>
      <strong>{formatDuration(totals.total)}</strong>
    </div>
  </div>
</section>

<style>
  .overview {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .overview h3 {
    margin: 0;
    font-size: 1rem;
  }
  .overview__grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: 0.65rem;
  }
  .overview__item {
    border: 1px solid var(--color-border, #1f2a40);
    border-radius: 10px;
    padding: 0.65rem 0.75rem;
    background: color-mix(in srgb, var(--color-surface-1, #0d1628) 60%, transparent);
  }
  .overview__item span {
    color: var(--color-text-muted, #94a3b8);
    font-size: 0.9rem;
  }
  .overview__item strong {
    display: block;
    font-size: 1.2rem;
  }
</style>
