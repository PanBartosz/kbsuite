<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import YAML from 'yaml'
  import { browser } from '$app/environment'
  import { computePlanTotals } from '$lib/timer/lib/planTotals'
  import { loadInvites, loadPendingCount, shares, type Invite } from '$lib/stores/shares'

  type Planned = {
    id: string
    planned_for: number
    title: string
    yaml_source: string
    notes?: string
    tags?: string[]
  }

  type CompletedSet = {
    round_label?: string
    set_label?: string
    reps?: number | null
    weight?: number | null
    duration_s?: number | null
    type?: string | null
    rpe?: number | null
  }

  type CompletedWorkout = {
    id: string
    workout_id?: string | null
    title?: string
    started_at?: number | null
    finished_at?: number | null
    duration_s?: number | null
    created_at?: number
    notes?: string | null
    rpe?: number | null
    tags?: string[]
    sets: CompletedSet[]
  }

  type Totals = { work: number; rest: number; total: number }

  const modules = [
    { href: '/plan', label: 'Planner', desc: 'Schedule and edit sessions', icon: 'ri-calendar-check-line' },
    { href: '/timer', label: 'Timer', desc: 'Run voice-guided timers', icon: 'ri-timer-2-line' },
    { href: '/counter', label: 'Rep Counter', desc: 'Swing / lockout tracking', icon: 'ri-focus-3-line' },
    { href: '/big-picture', label: 'Big Picture', desc: 'Timer + counter combo', icon: 'ri-layout-right-line' },
    { href: '/workouts', label: 'Workouts', desc: 'Library & templates', icon: 'ri-play-list-2-line' },
    { href: '/history', label: 'History', desc: 'Logs, HR, exports', icon: 'ri-bar-chart-box-line' },
    { href: '/auth', label: 'Account', desc: 'Profile & settings', icon: 'ri-user-settings-line' }
  ]

  let todayPlan: Planned | null = null
  let planTotals: Totals | null = null
  let planLoading = false
  let planError = ''

  let historyLoading = false
  let historyError = ''
  let completed: CompletedWorkout[] = []
  let weekSummary = { sessions: 0, totalMinutes: 0, avgRpe: null as number | null, streak: 0 }
  let weekSeries: { label: string; minutes: number }[] = []
  let movementBalance: { key: string; label: string; value: number }[] = []

  let invites: Invite[] = []
  let inviteDates: Record<string, string> = {}
  let inviteStatus: Record<string, string> = {}
  let inviteError: Record<string, string> = {}

  let chartEl: HTMLCanvasElement | null = null
  let chart: any = null
  let chartModule: any = null

  const bucketLabels: Record<string, string> = {
    hinge: 'Hinge',
    push: 'Push',
    pull: 'Pull',
    squat: 'Squat',
    overhead: 'Overhead',
    carry: 'Carry',
    core: 'Core',
    other: 'Other'
  }

  const dayKey = (ts: number) => {
    const d = new Date(ts)
    d.setHours(0, 0, 0, 0)
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  }

  const formatDate = (ts: number) =>
    new Date(ts).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })

  const coerceSeconds = (value: any) => {
    const numeric = Number(value)
    return Number.isFinite(numeric) && numeric >= 0 ? numeric : 0
  }

  const coerceRepetitions = (value: any) => {
    const numeric = Number(value)
    if (!Number.isFinite(numeric) || numeric <= 0) return 1
    return Math.max(1, Math.round(numeric))
  }

  const normalizePlan = (candidate: any) => {
    if (!candidate || typeof candidate !== 'object') {
      throw new Error('Plan must be an object')
    }
    if (!Array.isArray(candidate.rounds) || candidate.rounds.length === 0) {
      throw new Error('Plan must include rounds')
    }
    const rounds = candidate.rounds.map((round: any, roundIndex: number) => {
      if (!round || typeof round !== 'object') {
        throw new Error(`Round ${roundIndex + 1} must be an object`)
      }
      if (!Array.isArray(round.sets) || round.sets.length === 0) {
        throw new Error(`Round "${round.label ?? `#${roundIndex + 1}`}" requires sets`)
      }
      const roundId = round.id ?? `round-${roundIndex + 1}`
      return {
        id: roundId,
        label: round.label ?? `Round ${roundIndex + 1}`,
        repetitions: coerceRepetitions(round.repetitions),
        restAfterSeconds: coerceSeconds(round.restAfterSeconds),
        sets: round.sets.map((set: any, setIndex: number) => ({
          id: set.id ?? `${roundId}-set-${setIndex + 1}`,
          label: set.label ?? `Set ${setIndex + 1}`,
          workSeconds: coerceSeconds(set.workSeconds),
          restSeconds: coerceSeconds(set.restSeconds),
          repetitions: coerceRepetitions(set.repetitions),
          transitionSeconds: coerceSeconds(set.transitionSeconds)
        }))
      }
    })

    return {
      title: candidate.title ?? 'Session',
      description: typeof candidate.description === 'string' ? candidate.description : '',
      preStartSeconds: coerceSeconds(candidate.preStartSeconds),
      preStartLabel:
        typeof candidate.preStartLabel === 'string' && candidate.preStartLabel.trim()
          ? candidate.preStartLabel.trim()
          : 'Prepare',
      rounds
    }
  }

  const safeTotalsFromYaml = (yaml?: string | null): Totals | null => {
    if (!yaml) return null
    try {
      const parsed = YAML.parse(yaml)
      const plan = normalizePlan(parsed)
      return computePlanTotals(plan)
    } catch {
      return null
    }
  }

  const durationSeconds = (item: CompletedWorkout) => {
    const direct = Number(item.duration_s)
    if (Number.isFinite(direct) && direct > 0) return direct
    const start = Number(item.started_at)
    const end = Number(item.finished_at)
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) return (end - start) / 1000
    const setSum = (item.sets ?? []).reduce((acc, set) => {
      const d = Number(set.duration_s)
      return acc + (Number.isFinite(d) && d > 0 ? d : 0)
    }, 0)
    return setSum
  }

  const normalizeCompleted = (item: any): CompletedWorkout => ({
    ...item,
    tags: Array.isArray(item.tags)
      ? item.tags
          .filter((t: any) => typeof t === 'string')
          .map((t: string) => t.trim())
          .filter(Boolean)
      : [],
    sets: Array.isArray(item.sets) ? item.sets : []
  })

  const defaultInviteDate = (invite: Invite) =>
    invite?.planned_for ? new Date(invite.planned_for).toISOString().slice(0, 10) : ''

  const setInviteDate = (id: string, value: string) => {
    inviteDates = { ...inviteDates, [id]: value }
  }

  const inviteForId = (id: string) => invites.find((inv) => inv.id === id)

  const acceptInvite = async (id: string) => {
    const invite = inviteForId(id)
    if (!invite) return
    const dateStr = inviteDates[id] || defaultInviteDate(invite)
    const plannedFor = dateStr ? Date.parse(dateStr) : null
    if (!plannedFor) {
      inviteError = { ...inviteError, [id]: 'Pick a date.' }
      return
    }
    inviteStatus = { ...inviteStatus, [id]: 'Saving…' }
    inviteError = { ...inviteError, [id]: '' }
    try {
      const res = await fetch(`/api/shared-workouts/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'accept', plannedFor })
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error ?? 'Failed to accept')
      await loadPendingCount()
      await loadInvites('incoming', 'pending')
      inviteStatus = { ...inviteStatus, [id]: 'Added to planner.' }
      setTimeout(() => {
        inviteStatus = { ...inviteStatus, [id]: '' }
      }, 1800)
      await loadTodayPlan()
    } catch (err) {
      inviteError = { ...inviteError, [id]: (err as any)?.message ?? 'Failed to accept' }
      inviteStatus = { ...inviteStatus, [id]: '' }
    }
  }

  const rejectInvite = async (id: string) => {
    inviteStatus = { ...inviteStatus, [id]: 'Updating…' }
    inviteError = { ...inviteError, [id]: '' }
    try {
      const res = await fetch(`/api/shared-workouts/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reject' })
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error ?? 'Failed to reject')
      await loadPendingCount()
      await loadInvites('incoming', 'pending')
      inviteStatus = { ...inviteStatus, [id]: 'Rejected.' }
      setTimeout(() => {
        inviteStatus = { ...inviteStatus, [id]: '' }
      }, 1500)
    } catch (err) {
      inviteError = { ...inviteError, [id]: (err as any)?.message ?? 'Failed to reject' }
      inviteStatus = { ...inviteStatus, [id]: '' }
    }
  }

  const bucketFor = (text: string): keyof typeof bucketLabels => {
    const value = text.toLowerCase()
    const has = (needle: string) => value.includes(needle)
    if (has('swing') || has('hinge') || has('dead') || has('clean') || has('snatch')) return 'hinge'
    if (has('press') || has('push') || has('dip') || has('jerk') || has('strict')) return 'push'
    if (has('row') || has('pull') || has('chin') || has('high pull')) return 'pull'
    if (has('squat') || has('lunge') || has('split') || has('step')) return 'squat'
    if (has('oh') || has('overhead')) return 'overhead'
    if (has('carry') || has('walk') || has('farmer') || has('rack')) return 'carry'
    if (has('plank') || has('hollow') || has('core') || has('windmill') || has('get up') || has('get-up') || has('tgu'))
      return 'core'
    return 'other'
  }

  const movementFromSets = (items: CompletedWorkout[]) => {
    const totals: Record<string, number> = {
      hinge: 0,
      push: 0,
      pull: 0,
      squat: 0,
      overhead: 0,
      carry: 0,
      core: 0,
      other: 0
    }
    const cutoff = Date.now() - 30 * 24 * 3600 * 1000
    items.forEach((item) => {
      const ts = Number(item.finished_at ?? item.started_at ?? item.created_at ?? 0)
      if (!Number.isFinite(ts) || ts < cutoff) return
      if (!item.sets?.length && item.tags?.length) {
        const tagText = item.tags.join(' ')
        const bucket = bucketFor(tagText)
        totals[bucket] += 1
        return
      }
      item.sets?.forEach((set) => {
        const text = [set.set_label, set.round_label, set.type].filter(Boolean).join(' ')
        if (!text.trim()) return
        const bucket = bucketFor(text)
        const magnitude = Number(set.reps) || Number(set.duration_s) || 1
        totals[bucket] += magnitude > 0 ? magnitude : 1
      })
    })
    const total = Object.values(totals).reduce((acc, v) => acc + v, 0)
    if (total === 0) return []
    return Object.entries(totals).map(([key, value]) => {
      const bucketKey = key as keyof typeof bucketLabels
      return {
        key,
        label: bucketLabels[bucketKey] ?? key,
        value: Math.round((value / total) * 100)
      }
    })
  }

  const computeWeekView = (items: CompletedWorkout[]) => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const cutoff7 = new Date(today)
    cutoff7.setDate(today.getDate() - 6)
    const perDay: Record<string, number> = {}
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today)
      d.setDate(today.getDate() - i)
      perDay[dayKey(d.getTime())] = 0
    }

    const items7 = items.filter((item) => {
      const ts = Number(item.finished_at ?? item.started_at ?? item.created_at ?? 0)
      if (!Number.isFinite(ts)) return false
      const normalized = new Date(ts)
      normalized.setHours(0, 0, 0, 0)
      return normalized.getTime() >= cutoff7.getTime() && normalized.getTime() <= today.getTime()
    })

    items7.forEach((item) => {
      const ts = Number(item.finished_at ?? item.started_at ?? item.created_at ?? 0)
      if (!Number.isFinite(ts)) return
      const key = dayKey(ts)
      const minutes = durationSeconds(item) / 60
      perDay[key] = (perDay[key] ?? 0) + (Number.isFinite(minutes) ? Math.max(minutes, 0) : 0)
    })

    const rpeValues = items7
      .map((it) => Number(it.rpe))
      .filter((v) => Number.isFinite(v) && v > 0) as number[]
    const avgRpe =
      rpeValues.length > 0
        ? Math.round((rpeValues.reduce((acc, v) => acc + v, 0) / rpeValues.length) * 10) / 10
        : null

    const series = Object.entries(perDay)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([label, minutes]) => ({ label: label.slice(5).replace('-', '/'), minutes: Math.round(minutes) }))

    const streak = (() => {
      let count = 0
      for (let i = 0; i < 30; i++) {
        const d = new Date(today)
        d.setDate(today.getDate() - i)
        const key = dayKey(d.getTime())
        const any =
          items.find((item) => {
            const ts = Number(item.finished_at ?? item.started_at ?? item.created_at ?? 0)
            if (!Number.isFinite(ts)) return false
            return dayKey(ts) === key
          }) !== undefined
        if (any) {
          count += 1
        } else {
          break
        }
      }
      return count
    })()

    weekSummary = {
      sessions: items7.length,
      totalMinutes: Math.round(series.reduce((acc, cur) => acc + cur.minutes, 0)),
      avgRpe,
      streak
    }
    weekSeries = series
    movementBalance = movementFromSets(items)
  }

  const updateChart = async () => {
    if (!browser || !chartEl) return
    if (!chartModule) {
      chartModule = await import('chart.js/auto')
    }
    const ChartCtor = chartModule.default
    if (!ChartCtor) return
    if (chart) {
      chart.destroy()
    }
    chart = new ChartCtor(chartEl.getContext('2d'), {
      type: 'bar',
      data: {
        labels: weekSeries.map((s) => s.label),
        datasets: [
          {
            label: 'Minutes',
            data: weekSeries.map((s) => s.minutes),
            backgroundColor: 'var(--color-accent)',
            borderColor: 'var(--color-accent-hover)',
            borderWidth: 1,
            borderRadius: 6
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: {
            ticks: { color: 'var(--color-text-muted)' },
            grid: { color: 'color-mix(in srgb, var(--color-border) 70%, transparent)' }
          },
          x: {
            ticks: { color: 'var(--color-text-muted)' },
            grid: { display: false }
          }
        },
        plugins: { legend: { display: false } }
      }
    })
  }

  const loadTodayPlan = async () => {
    planLoading = true
    planError = ''
    todayPlan = null
    planTotals = null
    try {
      const res = await fetch('/api/planned-workouts')
      if (!res.ok) throw new Error('Failed to load plans')
      const data = await res.json().catch(() => ({}))
      const items: Planned[] = data?.items ?? []
      const key = dayKey(Date.now())
      todayPlan = items.find((p) => dayKey(p.planned_for) === key) ?? null
      planTotals = todayPlan ? safeTotalsFromYaml(todayPlan.yaml_source) : null
    } catch (err) {
      planError = (err as any)?.message ?? 'Failed to load plans'
    } finally {
      planLoading = false
    }
  }

  const loadHistory = async () => {
    historyLoading = true
    historyError = ''
    try {
      const res = await fetch('/api/completed-workouts')
      if (!res.ok) throw new Error('Failed to load history')
      const data = await res.json()
      completed = (data?.items ?? []).map(normalizeCompleted)
      computeWeekView(completed)
    } catch (err) {
      historyError = (err as any)?.message ?? 'Failed to load history'
      weekSeries = []
      movementBalance = []
      weekSummary = { sessions: 0, totalMinutes: 0, avgRpe: null, streak: 0 }
    } finally {
      historyLoading = false
    }
  }

  const loadAll = () => {
    loadTodayPlan()
    loadHistory()
    loadInvites('incoming', 'pending')
    loadPendingCount()
  }

  let unsubscribeShares: (() => void) | null = null
  onMount(() => {
    unsubscribeShares = shares.subscribe((value) => {
      invites = value.pending ?? []
    })
    loadAll()
  })

  onDestroy(() => {
    if (unsubscribeShares) unsubscribeShares()
    if (chart) chart.destroy()
  })

  $: if (browser && weekSeries.length && chartEl) {
    updateChart()
  }
</script>

<main class="page home">
  <header class="page-head">
    <div>
      <p class="eyebrow">Dashboard</p>
      <h1>Welcome back</h1>
    </div>
    <button class="ghost refresh" on:click={loadAll} aria-label="Refresh dashboard">
      <i class="ri-refresh-line"></i>
      Refresh
    </button>
  </header>

  <div class="split">
    <section class="panel today-card">
      <div class="panel-head">
        <div>
          <p class="eyebrow">Today</p>
          <h2>{formatDate(Date.now())}</h2>
        </div>
        {#if todayPlan}
          <span class="pill success">Planned</span>
        {:else}
          <span class="pill muted">No plan</span>
        {/if}
      </div>

      {#if planLoading}
        <p class="muted">Loading plan…</p>
      {:else if planError}
        <p class="error">{planError}</p>
        <button class="ghost" on:click={loadTodayPlan}>Retry</button>
      {:else if todayPlan}
        <div class="today-body">
          <div class="title-row">
            <h3>{todayPlan.title}</h3>
            {#if todayPlan.tags?.length}
              <div class="tags">
                {#each todayPlan.tags.slice(0, 4) as tag}
                  <span class="tag-pill">{tag}</span>
                {/each}
                {#if todayPlan.tags.length > 4}
                  <span class="tag-pill muted">+{todayPlan.tags.length - 4}</span>
                {/if}
              </div>
            {/if}
          </div>
          {#if todayPlan.notes}
            <p class="muted">{todayPlan.notes}</p>
          {/if}
          {#if planTotals}
            <div class="stat-row">
              <div class="stat">
                <p class="label">Total</p>
                <strong>{Math.round(planTotals.total / 60)} min</strong>
              </div>
              <div class="stat">
                <p class="label">Work</p>
                <strong>{Math.round(planTotals.work / 60)} min</strong>
              </div>
              <div class="stat">
                <p class="label">Rest</p>
                <strong>{Math.round(planTotals.rest / 60)} min</strong>
              </div>
            </div>
          {/if}
          <div class="actions">
            <a class="btn primary" href={`/timer?planned=${todayPlan.id}`}>Start timer</a>
            <a class="btn ghost" href={`/big-picture?planned=${todayPlan.id}`}>Big picture</a>
            <a class="btn ghost" href="/plan">Edit plan</a>
          </div>
        </div>
      {:else}
        <div class="empty">
          <p>No planned session today.</p>
          <div class="actions">
            <a class="btn primary" href="/plan">Open planner</a>
            <a class="btn ghost" href="/timer">Start blank timer</a>
          </div>
        </div>
      {/if}
    </section>

    <section class="panel week-card">
      <div class="panel-head">
        <div>
          <p class="eyebrow">Week at a glance</p>
          <h2>Recent training</h2>
        </div>
        <a class="ghost" href="/history">History</a>
      </div>

      {#if historyLoading}
        <p class="muted">Loading history…</p>
      {:else if historyError}
        <p class="error">{historyError}</p>
        <button class="ghost" on:click={loadHistory}>Retry</button>
      {:else}
        <div class="week-stats">
          <div class="stat">
            <p class="label">Sessions (7d)</p>
            <strong>{weekSummary.sessions}</strong>
          </div>
          <div class="stat">
            <p class="label">Volume (min)</p>
            <strong>{weekSummary.totalMinutes}</strong>
          </div>
          <div class="stat">
            <p class="label">Avg RPE</p>
            <strong>{weekSummary.avgRpe ?? '—'}</strong>
          </div>
          <div class="stat">
            <p class="label">Streak</p>
            <strong>{weekSummary.streak}d</strong>
          </div>
        </div>
        <div class="chart-card">
          {#if weekSeries.length === 0}
            <p class="muted">No sessions in the last week.</p>
          {:else}
            <div class="chart-shell">
              <canvas bind:this={chartEl}></canvas>
            </div>
          {/if}
        </div>
        <div class="balance">
          <div class="balance-head">
            <p class="label">Movement mix (last 30d, name heuristic)</p>
            <span class="hint">Non-standard names fall into “Other”.</span>
          </div>
          {#if !movementBalance.length}
            <p class="muted small">No recent sets to categorize.</p>
          {:else}
            <div class="balance-grid">
              {#each movementBalance as bucket}
                <div class="balance-row">
                  <span class="balance-label">{bucket.label}</span>
                  <div class="bar">
                    <span style={`width:${Math.min(Math.max(bucket.value, 2), 100)}%`}></span>
                  </div>
                  <span class="balance-value">{bucket.value}%</span>
                </div>
              {/each}
            </div>
          {/if}
        </div>
      {/if}
    </section>
  </div>

  <section class="panel invites-card">
    <div class="panel-head">
      <div>
        <p class="eyebrow">Invites</p>
        <h2>Shared workouts</h2>
      </div>
      <button class="ghost" on:click={() => loadInvites('incoming', 'pending')}>Refresh</button>
    </div>
    {#if invites.length === 0}
      <p class="muted">No incoming workouts right now.</p>
    {:else}
      <div class="invite-list">
        {#each invites.slice(0, 4) as invite}
          {@const dateId = `invite-${invite.id}-date`}
          <article class="invite">
            <div class="invite-meta">
              <h3>{invite.title || 'Shared workout'}</h3>
              <p class="muted small">
                From {invite.sender_username ?? 'partner'} • {invite.planned_for ? formatDate(invite.planned_for) : 'No date'}
              </p>
                {#if invite.message}<p class="muted small">{invite.message}</p>{/if}
              </div>
              <div class="invite-actions">
                <label class="muted small" for={dateId}>When</label>
                <input
                  type="date"
                id={dateId}
                value={inviteDates[invite.id] || defaultInviteDate(invite)}
                on:input={(e) => setInviteDate(invite.id, (e.target as HTMLInputElement).value)}
              />
              <div class="buttons">
                <button class="primary" on:click={() => acceptInvite(invite.id)} disabled={!!inviteStatus[invite.id]}>
                  {inviteStatus[invite.id] || 'Accept'}
                </button>
                <button class="ghost danger" on:click={() => rejectInvite(invite.id)} disabled={inviteStatus[invite.id] === 'Updating…'}>
                  Reject
                </button>
              </div>
              {#if inviteError[invite.id]}<p class="error small">{inviteError[invite.id]}</p>{/if}
            </div>
          </article>
        {/each}
        {#if invites.length > 4}
          <p class="muted small">More invites available in Planner.</p>
        {/if}
      </div>
    {/if}
  </section>

  <section class="panel modules">
    <div class="panel-head">
      <div>
        <p class="eyebrow">Shortcuts</p>
        <h2>Jump to modules</h2>
      </div>
    </div>
    <div class="cards">
      {#each modules as mod}
        <a class="card" href={mod.href}>
          <div class="icon">
            <i class={mod.icon}></i>
          </div>
          <div class="card-body">
            <h3>{mod.label}</h3>
            <p class="muted small">{mod.desc}</p>
          </div>
        </a>
      {/each}
    </div>
  </section>
</main>

<style>
  .home {
    gap: 1rem;
  }

  .page-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
  }

  .page-head h1 {
    margin: 0;
  }

  .refresh {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    border-radius: 12px;
    padding: 0.4rem 0.75rem;
    border: 1px solid var(--color-border);
    background: color-mix(in srgb, var(--color-surface-2) 80%, transparent);
  }

  .split {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
    gap: 1rem;
  }

  .panel h2 {
    margin: 0;
  }

  .panel .pill {
    font-size: 0.9rem;
    padding: 0.2rem 0.55rem;
    border-radius: 999px;
    border: 1px solid var(--color-border);
  }

  .pill.success {
    border-color: color-mix(in srgb, var(--color-accent) 45%, var(--color-border));
    background: color-mix(in srgb, var(--color-accent) 25%, transparent);
    color: var(--color-text-primary);
  }

  .pill.muted {
    color: var(--color-text-muted);
  }

  .today-card .title-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .today-card h3 {
    margin: 0;
  }

  .tags {
    display: inline-flex;
    gap: 0.35rem;
    flex-wrap: wrap;
  }

  .tag-pill {
    padding: 0.2rem 0.55rem;
    border-radius: 999px;
    border: 1px solid var(--color-border);
    font-size: 0.9rem;
    background: color-mix(in srgb, var(--color-surface-3) 70%, transparent);
  }

  .tag-pill.muted {
    color: var(--color-text-muted);
  }

  .stat-row {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 0.65rem;
    margin-top: 0.75rem;
  }

  .stat {
    padding: 0.65rem 0.75rem;
    border-radius: 12px;
    border: 1px solid var(--color-border);
    background: color-mix(in srgb, var(--color-surface-2) 75%, transparent);
  }

  .stat .label {
    margin: 0 0 0.25rem;
    color: var(--color-text-muted);
  }

  .stat strong {
    font-size: 1.1rem;
  }

  .actions {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
    margin-top: 0.9rem;
  }

  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.35rem;
    padding: 0.55rem 0.9rem;
    border-radius: 12px;
    border: 1px solid var(--color-border);
    color: var(--color-text-primary);
    text-decoration: none;
  }

  .btn.primary {
    background: linear-gradient(135deg, var(--color-accent), var(--color-accent-hover));
    border: none;
    color: var(--color-text-inverse);
  }

  .btn.ghost {
    background: transparent;
  }

  .empty {
    margin-top: 0.25rem;
  }

  .week-card .week-stats {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 0.65rem;
  }

  .chart-card {
    margin-top: 0.85rem;
    padding: 0.75rem;
    border-radius: 14px;
    border: 1px solid var(--color-border);
    background: color-mix(in srgb, var(--color-surface-2) 80%, transparent);
  }

  .chart-shell {
    height: 220px;
  }

  .balance {
    margin-top: 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
  }

  .balance-head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .balance .hint {
    font-size: 0.9rem;
    color: var(--color-text-muted);
  }

  .balance-grid {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .balance-row {
    display: grid;
    grid-template-columns: 90px 1fr 50px;
    gap: 0.4rem;
    align-items: center;
  }

  .balance-label {
    color: var(--color-text-secondary);
  }

  .balance-value {
    text-align: right;
    color: var(--color-text-muted);
  }

  .bar {
    position: relative;
    height: 10px;
    background: color-mix(in srgb, var(--color-border) 60%, transparent);
    border-radius: 999px;
    overflow: hidden;
  }

  .bar span {
    position: absolute;
    inset: 0;
    background: linear-gradient(135deg, var(--color-accent), var(--color-accent-hover));
  }

  .invites-card .invite-list {
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
  }

  .invite {
    border: 1px solid var(--color-border);
    border-radius: 12px;
    padding: 0.75rem;
    background: color-mix(in srgb, var(--color-surface-2) 80%, transparent);
    display: grid;
    grid-template-columns: 2fr 1fr;
    gap: 0.75rem;
    align-items: center;
  }

  .invite h3 {
    margin: 0;
  }

  .invite-actions {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .invite-actions input[type='date'] {
    padding: 0.4rem 0.55rem;
    border-radius: 10px;
    border: 1px solid var(--color-border);
    background: var(--color-surface-1);
    color: var(--color-text-primary);
  }

  .invite-actions .buttons {
    display: flex;
    gap: 0.35rem;
    flex-wrap: wrap;
  }

  .modules .cards {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 0.75rem;
    margin-top: 0.75rem;
  }

  .modules .card {
    display: flex;
    align-items: center;
    gap: 0.65rem;
    padding: 0.9rem;
    border-radius: 14px;
    border: 1px solid var(--color-border);
    background: color-mix(in srgb, var(--color-surface-2) 85%, transparent);
    color: var(--color-text-primary);
    transition: transform 120ms ease, border-color 120ms ease, background 120ms ease;
    text-decoration: none;
  }

  .modules .card:hover {
    transform: translateY(-2px);
    border-color: var(--color-accent);
    background: color-mix(in srgb, var(--color-surface-1) 85%, transparent);
  }

  .modules .icon {
    width: 38px;
    height: 38px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 12px;
    background: color-mix(in srgb, var(--color-accent) 20%, transparent);
    color: var(--color-accent);
    border: 1px solid color-mix(in srgb, var(--color-accent) 35%, var(--color-border));
  }

  .modules h3 {
    margin: 0;
  }

  .muted.small {
    font-size: 0.9rem;
  }

  .error {
    color: var(--color-danger);
  }

  .error.small {
    font-size: 0.9rem;
  }

  @media (max-width: 720px) {
    .page-head {
      flex-direction: column;
      align-items: flex-start;
    }
    .invite {
      grid-template-columns: 1fr;
      align-items: flex-start;
    }
    .balance-row {
      grid-template-columns: 80px 1fr 40px;
    }
  }
</style>
