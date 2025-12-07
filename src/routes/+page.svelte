<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import YAML from 'yaml'
  import { browser } from '$app/environment'
  import { computePlanTotals } from '$lib/timer/lib/planTotals'
  import { loadInvites, loadPendingCount, shares, type Invite } from '$lib/stores/shares'
  import { buildPlannedSummary, type PlannedSummaryBlock } from '$lib/timer/lib/planSummary'
  import { categorizeExercise } from '$lib/timer/lib/exerciseCategorizer'
  import { buildAiPayloadBatch } from '$lib/stats/aiPayload'
  import { defaultInsightsPrompt, getInsightsPrompt } from '$lib/ai/prompts'
  import { settings } from '$lib/stores/settings'
  import SessionOverview from '$lib/timer/components/shared/SessionOverview.svelte'

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
  let nextPlan: Planned | null = null
  let planTotals: Totals | null = null
  let todayPlanParsed: any | null = null
  let todaySummary: PlannedSummaryBlock[] = []
  let nextPlanParsed: any | null = null
  let nextSummary: PlannedSummaryBlock[] = []
  let nextPlanTotals: Totals | null = null
  let planLoading = false
  let planError = ''

  type WindowRange = 7 | 30

  let historyLoading = false
  let historyError = ''
  let completed: CompletedWorkout[] = []
  let recentRange: WindowRange = 7
  let movementRange: WindowRange = 30
  let recentSummary = { sessions: 0, totalMinutes: 0, avgRpe: null as number | null, streak: 0 }
  let recentSeries: { key: string; label: string; minutes: number }[] = []
  let recentItems: CompletedWorkout[] = []
  let minutesTrend: number[] = []
  let hrSummaryHome: Record<string, { avgHr: number | null; maxHr: number | null }> = {}
  let hrFetchStatus: Record<string, 'pending' | 'done' | 'error'> = {}
  let hrAvgSeries: (number | null)[] = []
  let hrMaxSeries: (number | null)[] = []
  let hasRecentActivity = false
  let invites: Invite[] = []
  let inviteDates: Record<string, string> = {}
  let inviteStatus: Record<string, string> = {}
  let inviteError: Record<string, string> = {}

  let chartEl: HTMLCanvasElement | null = null
  let chart: any = null
  let chartModule: any = null
  let movementChartEl: HTMLCanvasElement | null = null
  let movementChart: any = null
  let movementBalance: {
    key: string
    label: string
    value: number
    shared: number
    pure: number
    weight: number
    sharedWeight: number
  }[] = []
  let movementSetCount = 0

let openAiKey = ''
let insightsPrompt = defaultInsightsPrompt
  let insightsQuestion = ''
  let insightsStatus = ''
  let insightsError = ''
let insightsAnswer = ''
let insightsHtml = ''
let insightsLoading = false
let insightsModalOpen = false
let currentTheme = ''
let movementInfoOpen = false

$: openAiKey = $settings.openAiKey ?? ''
$: insightsPrompt = getInsightsPrompt($settings.aiInsightsPrompt)
$: currentTheme = $settings.theme ?? ''

  const bucketLabels: Record<string, string> = {
    hinge: 'Hinge',
    push: 'Push',
    pull: 'Pull',
    squat: 'Squat',
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

  const getCssVar = (name: string, fallback: string) => {
    if (!browser) return fallback
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
    return v || fallback
  }

  const toRgba = (color: string, alpha = 1) => {
    if (!color) return `rgba(255,255,255,${alpha})`
    if (color.startsWith('#')) {
      const hex = color.slice(1)
      const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex
      const num = parseInt(full, 16)
      const r = (num >> 16) & 255
      const g = (num >> 8) & 255
      const b = num & 255
      return `rgba(${r}, ${g}, ${b}, ${alpha})`
    }
    const m = color.match(/rgba?\(([^)]+)\)/)
    if (m) {
      const parts = m[1].split(',').map((p) => parseFloat(p.trim()))
      const [r, g, b] = parts
      return `rgba(${r}, ${g}, ${b}, ${alpha})`
    }
    return color
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

  const parsePlanFromYaml = (yaml?: string | null) => {
    if (!yaml) return null
    try {
      const parsed = YAML.parse(yaml)
      return normalizePlan(parsed)
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

  const movementFromSets = (items: CompletedWorkout[], range: WindowRange) => {
    const totals: Record<string, number> = {
      hinge: 0,
      push: 0,
      pull: 0,
      squat: 0,
      carry: 0,
      core: 0,
      other: 0
    }
    const shared: Record<string, number> = { hinge: 0, push: 0, pull: 0, squat: 0, carry: 0, core: 0, other: 0 }
    const pure: Record<string, number> = { hinge: 0, push: 0, pull: 0, squat: 0, carry: 0, core: 0, other: 0 }
    const cutoff = Date.now() - range * 24 * 3600 * 1000
    let countedSets = 0
    items.forEach((item) => {
      const ts = Number(item.finished_at ?? item.started_at ?? item.created_at ?? 0)
      if (!Number.isFinite(ts) || ts < cutoff) return
      if (!item.sets?.length && item.tags?.length) {
        const tagText = item.tags.join(' ')
        const cats = categorizeExercise(tagText)
        cats.forEach((c) => {
          const bucket = (c.toLowerCase() as keyof typeof totals) || 'other'
          totals[bucket] = (totals[bucket] ?? 0) + 1
          pure[bucket] = (pure[bucket] ?? 0) + 1
        })
        countedSets += 1
        return
      }
      item.sets?.forEach((set) => {
        const cats = categorizeExercise(set.set_label, set.round_label)
        if (!cats.size) return
        countedSets += 1
        const share = 1 / cats.size
        cats.forEach((c) => {
          const bucket = (c.toLowerCase() as keyof typeof totals) || 'other'
          totals[bucket] = (totals[bucket] ?? 0) + share
          if (cats.size > 1) {
            shared[bucket] = (shared[bucket] ?? 0) + share
          } else {
            pure[bucket] = (pure[bucket] ?? 0) + 1
          }
        })
      })
    })
    const total = Object.values(totals).reduce((acc, v) => acc + v, 0)
    movementSetCount = countedSets
    if (total === 0 || countedSets === 0) return []
    return Object.entries(totals).map(([key, value]) => {
      const bucketKey = key as keyof typeof bucketLabels
      const sharedVal = shared[key] ?? 0
      const pureVal = Math.max(value - sharedVal, 0)
      return {
        key,
        label: bucketLabels[bucketKey] ?? key,
        value: Math.round((value / total) * 100),
        shared: Math.round((sharedVal / total) * 100),
        pure: Math.round((pureVal / total) * 100),
        weight: value,
        sharedWeight: sharedVal
      }
    })
  }

  const insightsItems = () => {
    const cutoff = Date.now() - 7 * 24 * 3600 * 1000
    return completed.filter((item) => {
      const ts = Number(item.finished_at ?? item.started_at ?? item.created_at ?? 0)
      return Number.isFinite(ts) && ts >= cutoff
    })
  }

  const renderMarkdown = (input: string) => {
    if (!input) return ''
    const escapeHtml = (str: string) =>
      str.replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m] as string))
    const lines = input.split('\n')
    let html = ''
    let inList = false
    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed.startsWith('- ')) {
        if (!inList) {
          html += '<ul>'
          inList = true
        }
        html += `<li>${escapeHtml(trimmed.slice(2))}</li>`
        continue
      }
      if (inList) {
        html += '</ul>'
        inList = false
      }
      if (trimmed) {
        html += `<p>${escapeHtml(trimmed)}</p>`
      }
    }
    if (inList) html += '</ul>'
    return html
  }

  const generateInsights = async () => {
    const key = openAiKey.trim()
    if (!key) {
      insightsError = 'Add your OpenAI API key in Settings to generate insights.'
      insightsStatus = ''
      return
    }
    const items = insightsItems()
    if (!items.length) {
      insightsError = 'No workouts to analyze in the last 7 days.'
      insightsStatus = ''
      return
    }
    const payload = buildAiPayloadBatch(items, {}, 25)
    const question =
      insightsQuestion.trim() ||
      'Find notable trends in volume, RPE, and suggest focus areas for the next week.'
    insightsLoading = true
    insightsError = ''
    insightsStatus = 'Contacting OpenAI…'
    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`
        },
        body: JSON.stringify({
          model: 'gpt-5.1',
          temperature: 0.4,
          messages: [
            { role: 'system', content: insightsPrompt },
            {
              role: 'user',
              content: [
                'Analyze these completed workouts (array of objects).',
                'Highlight trends in volume/intensity, HR vs RPE, and recovery needs.',
                'Return 3-6 concise bullet points in Markdown (unordered list). Prefer specific suggestions over generic advice.',
                `User question: ${question}`,
                'Data:',
                JSON.stringify(payload)
              ].join('\n')
            }
          ]
        })
      })
      if (!res.ok) {
        const text = await res.text()
        throw new Error(`OpenAI request failed: ${res.status} ${text.slice(0, 180)}`)
      }
      const data = await res.json()
      const content = data?.choices?.[0]?.message?.content ?? ''
      insightsAnswer = typeof content === 'string' ? content.trim() : ''
      insightsHtml = renderMarkdown(insightsAnswer)
      insightsStatus = `Analyzed ${payload.length} session${payload.length === 1 ? '' : 's'}.`
    } catch (err) {
      insightsError = (err as any)?.message ?? 'Failed to generate insights.'
      insightsStatus = ''
    } finally {
      insightsLoading = false
    }
  }

  const trendWindowForRange = (range: WindowRange) => (range === 7 ? 7 : 7)

  const rollingAverage = (values: number[], window: number) =>
    values.map((_, idx) => {
      const start = Math.max(0, idx - window + 1)
      const slice = values.slice(start, idx + 1)
      const sum = slice.reduce((acc, v) => acc + v, 0)
      return Math.round((sum / slice.length) * 10) / 10
    })

  const emaSmooth = (values: number[], alpha: number) => {
    let prev: number | null = null
    return values.map((v) => {
      const next = prev === null ? v : prev * (1 - alpha) + v * alpha
      prev = next
      return Math.round(next * 10) / 10
    })
  }

  const buildTrendSeries = (values: number[], range: WindowRange) => {
    if (!values.length) return []
    if (range === 7) {
      // Short window: use gentler exponential smoothing to soften rest-day dips without overreacting.
      return emaSmooth(values, 0.10)
    }
    return rollingAverage(values, 7)
  }

  const computeRecentView = (items: CompletedWorkout[], range: WindowRange) => {
    const smoothWindow = 3
    const trendPadding = range === 7 ? smoothWindow - 1 : 0
    const lookbackDays = range + trendPadding
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const cutoffDisplay = new Date(today)
    cutoffDisplay.setDate(today.getDate() - (range - 1))
    const cutoffTrend = new Date(today)
    cutoffTrend.setDate(today.getDate() - (lookbackDays - 1))
    const perDay: Record<string, number> = {}
    for (let i = lookbackDays - 1; i >= 0; i--) {
      const d = new Date(today)
      d.setDate(today.getDate() - i)
      perDay[dayKey(d.getTime())] = 0
    }

    const itemsInRangeForTrend = items.filter((item) => {
      const ts = Number(item.finished_at ?? item.started_at ?? item.created_at ?? 0)
      if (!Number.isFinite(ts)) return false
      const normalized = new Date(ts)
      normalized.setHours(0, 0, 0, 0)
      return normalized.getTime() >= cutoffTrend.getTime() && normalized.getTime() <= today.getTime()
    })

    itemsInRangeForTrend.forEach((item) => {
      const ts = Number(item.finished_at ?? item.started_at ?? item.created_at ?? 0)
      if (!Number.isFinite(ts)) return
      const key = dayKey(ts)
      const minutes = durationSeconds(item) / 60
      perDay[key] = (perDay[key] ?? 0) + (Number.isFinite(minutes) ? Math.max(minutes, 0) : 0)
    })

    const itemsInRangeForDisplay = items.filter((item) => {
      const ts = Number(item.finished_at ?? item.started_at ?? item.created_at ?? 0)
      if (!Number.isFinite(ts)) return false
      const normalized = new Date(ts)
      normalized.setHours(0, 0, 0, 0)
      return normalized.getTime() >= cutoffDisplay.getTime() && normalized.getTime() <= today.getTime()
    })

    const rpeValues = itemsInRangeForDisplay
      .map((it) => Number(it.rpe))
      .filter((v) => Number.isFinite(v) && v > 0) as number[]
    const avgRpe =
      rpeValues.length > 0
        ? Math.round((rpeValues.reduce((acc, v) => acc + v, 0) / rpeValues.length) * 10) / 10
        : null

    const seriesAll = Object.entries(perDay)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([key, minutes]) => ({
        key,
        label: key.slice(5).replace('-', '/'),
        minutes: Math.round(minutes)
      }))
    const series = seriesAll.slice(Math.max(0, seriesAll.length - range))

    const streak = (() => {
      let count = 0
      const lookback = Math.max(30, range + 7)
      for (let i = 0; i < lookback; i++) {
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

    recentSummary = {
      sessions: itemsInRangeForDisplay.length,
      totalMinutes: Math.round(series.reduce((acc, cur) => acc + cur.minutes, 0)),
      avgRpe,
      streak
    }
    recentItems = itemsInRangeForDisplay
    recentSeries = series
    hrAvgSeries = new Array(series.length).fill(null)
    hrMaxSeries = new Array(series.length).fill(null)
    const smoothed = seriesAll.length ? buildTrendSeries(seriesAll.map((s) => s.minutes), range) : []
    minutesTrend = smoothed.slice(Math.max(0, smoothed.length - range))
  }

  const updateMovementBalance = (items: CompletedWorkout[], range: WindowRange) => {
    movementBalance = movementFromSets(items, range)
  }

  const buildHrSeries = () => {
    const perDay: Record<string, { avg: number[]; max: number[] }> = {}
    recentItems.forEach((item) => {
      const ts = Number(item.finished_at ?? item.started_at ?? item.created_at ?? 0)
      if (!Number.isFinite(ts)) return
      const key = dayKey(ts)
      const summary = hrSummaryHome[item.id]
      if (!summary) return
      if (!perDay[key]) perDay[key] = { avg: [], max: [] }
      if (typeof summary.avgHr === 'number') perDay[key].avg.push(summary.avgHr)
      if (typeof summary.maxHr === 'number') perDay[key].max.push(summary.maxHr)
    })
    const avgSeries: (number | null)[] = []
    const maxSeries: (number | null)[] = []
    recentSeries.forEach((s) => {
      const bucket = perDay[s.key]
      if (bucket?.avg.length) {
        const sum = bucket.avg.reduce((acc, v) => acc + v, 0)
        avgSeries.push(Math.round((sum / bucket.avg.length) * 10) / 10)
      } else {
        avgSeries.push(null)
      }
      if (bucket?.max.length) {
        const sum = bucket.max.reduce((acc, v) => acc + v, 0)
        maxSeries.push(Math.round((sum / bucket.max.length) * 10) / 10)
      } else {
        maxSeries.push(null)
      }
    })
    hrAvgSeries = avgSeries
    hrMaxSeries = maxSeries
    if (browser && chartEl && recentSeries.length) updateChart()
  }

  const fetchHrSummary = async (id: string) => {
    if (hrFetchStatus[id] === 'pending' || hrFetchStatus[id] === 'done') return
    hrFetchStatus = { ...hrFetchStatus, [id]: 'pending' }
    try {
      const res = await fetch(`/api/completed-workouts/${id}/hr?details=1`)
      const data = await res.json().catch(() => ({}))
      if (data?.summary) {
        hrSummaryHome = {
          ...hrSummaryHome,
          [id]: {
            avgHr: data.summary.avgHr ?? null,
            maxHr: data.summary.maxHr ?? null
          }
        }
      }
      hrFetchStatus = { ...hrFetchStatus, [id]: 'done' }
    } catch {
      hrFetchStatus = { ...hrFetchStatus, [id]: 'error' }
    }
  }

  const refreshHrForRecent = async () => {
    const targets = recentItems.filter(
      (item) => !hrSummaryHome[item.id] && hrFetchStatus[item.id] !== 'pending'
    )
    if (!targets.length) {
      buildHrSeries()
      return
    }
    await Promise.all(targets.map((item) => fetchHrSummary(item.id)))
    buildHrSeries()
  }

  const setRecentRange = (range: WindowRange) => {
    if (recentRange === range) return
    recentRange = range
    computeRecentView(completed, recentRange)
    refreshHrForRecent()
  }

  const setMovementRange = (range: WindowRange) => {
    if (movementRange === range) return
    movementRange = range
    updateMovementBalance(completed, movementRange)
  }

  const rangeLabel = (range: WindowRange) => `${range}d`

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
    const accent = getCssVar('--color-accent', '#22d3ee')
    const accentHover = getCssVar('--color-accent-hover', accent)
    const trendColor = getCssVar('--color-warning', '#fbbf24')
    const hrAvgColor = getCssVar('--color-success', '#34d399')
    const hrMaxColor = getCssVar('--color-danger', '#f87171')
    const textColor = getCssVar('--color-text-muted', '#94a3b8')
    const gridColor = toRgba(getCssVar('--color-border', 'rgba(255,255,255,0.1)'), 0.65)
    const labels = recentSeries.map((s) => s.label)
    const trendLabel = recentRange === 7 ? 'Smoothed trend' : '7-day avg'
    chart = new ChartCtor(chartEl.getContext('2d'), {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Minutes',
            data: recentSeries.map((s) => s.minutes),
            backgroundColor: toRgba(accent, 0.8),
            borderColor: accentHover,
            borderWidth: 1,
            borderRadius: 8
          },
          {
            type: 'line',
            label: trendLabel,
            data: minutesTrend,
            fill: false,
            borderColor: trendColor,
            backgroundColor: trendColor,
            tension: 0.35,
            pointRadius: 3,
            pointBackgroundColor: trendColor,
            yAxisID: 'y',
            borderWidth: 2
          },
          {
            type: 'line',
            label: 'Avg HR',
            data: hrAvgSeries,
            spanGaps: true,
            borderColor: hrAvgColor,
            backgroundColor: hrAvgColor,
            tension: 0.25,
            pointRadius: 3,
            pointBackgroundColor: hrAvgColor,
            yAxisID: 'y1',
            borderWidth: 2
          },
          {
            type: 'line',
            label: 'Max HR',
            data: hrMaxSeries,
            spanGaps: true,
            borderColor: hrMaxColor,
            backgroundColor: hrMaxColor,
            tension: 0.2,
            pointRadius: 3,
            pointBackgroundColor: hrMaxColor,
            yAxisID: 'y1',
            borderDash: [6, 4],
            borderWidth: 2
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: {
            ticks: { color: textColor },
            grid: { color: gridColor }
          },
          y1: {
            position: 'right',
            ticks: { color: textColor },
            grid: { drawOnChartArea: false },
            title: { display: true, text: 'HR (bpm)', color: textColor }
          },
          x: {
            ticks: { color: textColor },
            grid: { display: false }
          }
        },
        plugins: {
          legend: {
            display: true,
            labels: { color: textColor }
          }
        }
      }
    })
  }

  const updateMovementChart = async () => {
    if (!browser || !movementChartEl || !movementBalance.length) return
    if (!chartModule) {
      chartModule = await import('chart.js/auto')
    }
    const ChartCtor = chartModule.default
    if (!ChartCtor) return
    if (movementChart) movementChart.destroy()
    const accent = getCssVar('--color-accent', '#22d3ee')
    const warning = getCssVar('--color-warning', '#fbbf24')
    const textColor = getCssVar('--color-text-muted', '#94a3b8')
    const gridColor = toRgba(getCssVar('--color-border', 'rgba(255,255,255,0.1)'), 0.35)

    const labels = movementBalance.map((b) => b.label)
    const pureData = movementBalance.map((b) => Math.max(b.value - b.shared, 0))
    const sharedData = movementBalance.map((b) => b.shared)
    const maxVal = Math.max(...movementBalance.map((b) => b.value)) || 100
    const paddedMax = Math.min(100, Math.ceil((maxVal + 5) / 10) * 10)
    const roundedForDataset = (datasetIndex: number) => (ctx: any) => {
      const idx = ctx.dataIndex
      const pureVal = pureData[idx]
      const sharedVal = sharedData[idx]
      if (pureVal <= 0 && sharedVal <= 0) return 0
      const r = 10
      if (datasetIndex === 0) {
        if (pureVal <= 0) return 0
        const right = sharedVal > 0 ? 0 : r
        return { topLeft: r, bottomLeft: r, topRight: right, bottomRight: right }
      }
      if (sharedVal <= 0) return 0
      const left = pureVal > 0 ? 0 : r
      return { topLeft: left, bottomLeft: left, topRight: r, bottomRight: r }
    }

    movementChart = new ChartCtor(movementChartEl.getContext('2d'), {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Pure',
            data: pureData,
            backgroundColor: toRgba(accent, 0.8),
            borderRadius: roundedForDataset(0),
            borderSkipped: false,
            stack: 'sets'
          },
          {
            label: 'Shared',
            data: sharedData,
            backgroundColor: toRgba(warning, 0.75),
            borderRadius: roundedForDataset(1),
            borderSkipped: false,
            stack: 'sets'
          }
        ]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx: any) => {
                const cat = labels[ctx.dataIndex]
                const pct = ctx.parsed.x
                const bucket = movementBalance[ctx.dataIndex]
                const weight = ctx.dataset.label === 'Shared' ? bucket.sharedWeight : bucket.weight - bucket.sharedWeight
                const setsText = `${weight.toFixed(weight % 1 ? 1 : 0)} weighted sets`
                return `${ctx.dataset.label} ${cat}: ${pct}% (${setsText})`
              }
            }
          }
        },
        scales: {
          x: {
            stacked: true,
            min: 0,
            max: paddedMax,
            ticks: { color: textColor, callback: (v: number) => `${v}%` },
            grid: { color: gridColor }
          },
          y: {
            stacked: true,
            ticks: { color: textColor },
            grid: { display: false }
          }
        }
      }
    })
  }

  const loadTodayPlan = async () => {
    planLoading = true
    planError = ''
    todayPlan = null
    nextPlan = null
    planTotals = null
    todayPlanParsed = null
    todaySummary = []
    nextPlanParsed = null
    nextSummary = []
    nextPlanTotals = null
    try {
      const res = await fetch('/api/planned-workouts')
      if (!res.ok) throw new Error('Failed to load plans')
      const data = await res.json().catch(() => ({}))
      const items: Planned[] = data?.items ?? []
      const key = dayKey(Date.now())
      todayPlan = items.find((p) => dayKey(p.planned_for) === key) ?? null
      if (!todayPlan) {
        const upcoming = items
          .filter((p) => p.planned_for > Date.now())
          .sort((a, b) => a.planned_for - b.planned_for)
        nextPlan = upcoming[0] ?? null
      }
      if (todayPlan?.yaml_source) {
        todayPlanParsed = parsePlanFromYaml(todayPlan.yaml_source)
        planTotals = todayPlanParsed ? computePlanTotals(todayPlanParsed) : safeTotalsFromYaml(todayPlan.yaml_source)
        todaySummary = todayPlanParsed ? buildPlannedSummary(todayPlanParsed) : []
      }
      if (!todayPlan && nextPlan?.yaml_source) {
        nextPlanParsed = parsePlanFromYaml(nextPlan.yaml_source)
        nextPlanTotals = nextPlanParsed ? computePlanTotals(nextPlanParsed) : safeTotalsFromYaml(nextPlan.yaml_source)
        nextSummary = nextPlanParsed ? buildPlannedSummary(nextPlanParsed) : []
      }
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
      computeRecentView(completed, recentRange)
      updateMovementBalance(completed, movementRange)
      await refreshHrForRecent()
    } catch (err) {
      historyError = (err as any)?.message ?? 'Failed to load history'
      recentSeries = []
      hrAvgSeries = []
      hrMaxSeries = []
      recentItems = []
      minutesTrend = []
      movementBalance = []
      movementSetCount = 0
      recentSummary = { sessions: 0, totalMinutes: 0, avgRpe: null, streak: 0 }
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
    if (movementChart) movementChart.destroy()
  })

  $: hasRecentActivity = recentSeries.some((s) => s.minutes > 0)

  $: if (!hasRecentActivity && chart) {
    chart.destroy()
    chart = null
  }

  $: if (!movementBalance.length && movementChart) {
    movementChart.destroy()
    movementChart = null
  }

  $: if (browser && recentSeries.length && chartEl) {
    updateChart()
  }
  $: if (browser && movementBalance.length && movementChartEl) {
    updateMovementChart()
  }
  $: if (browser && currentTheme && recentSeries.length && chartEl) {
    updateChart()
  }
  $: if (browser && currentTheme && movementBalance.length && movementChartEl) {
    updateMovementChart()
  }
</script>

<main class="page home">
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

  <div class="split">
    <section class="panel today-card">
      <div class="panel-head today-head">
        <div>
          <p class="eyebrow">Today</p>
          {#if todayPlan}
            <h2>{todayPlan.title}</h2>
            <p class="muted small">{formatDate(todayPlan.planned_for)}</p>
          {:else}
            <h2>{formatDate(Date.now())}</h2>
            <p class="muted small">No planned session</p>
          {/if}
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
          {#if todayPlan.notes}
            <p class="muted">{todayPlan.notes}</p>
          {/if}
          {#if todayPlanParsed}
            <SessionOverview
              totals={planTotals ?? { work: 0, rest: 0, total: 0 }}
              roundCount={todayPlanParsed?.rounds?.length ?? 0}
            />
            {#if todaySummary.length}
              <div class="compact-summary rich planner-summary">
                {#each todaySummary as block}
                  <div class="summary-block">
                    <div class="summary-title">
                      {#if block.count && block.count > 1}
                        <span class="chip-pill pill-count">{block.count} ×</span>
                      {/if}
                      {block.title}
                    </div>
                    {#if block.items?.length}
                      <div class="summary-items">
                        {#each block.items as it}
                          <span class="summary-chip fancy">
                            {#if it.label}<span class="chip-label">{it.label}</span>{/if}
                            <span class="chip-pill pill-count">{it.count ?? 1} ×</span>
                            {#if it.work}
                              <span class="chip-pill">
                                <span>{it.work}</span>
                              </span>
                            {/if}
                            {#if it.on || it.off}
                              <span class="chip-pill pill-rest">
                                {#if it.on}<span class="on">{it.on}</span>{/if}
                                {#if it.off}
                                  <span class="divider">/</span>
                                  <span class="off">{it.off}</span>
                                {/if}
                              </span>
                            {/if}
                            {#if !it.label && !it.work && !it.on && !it.off}
                              <span>{it.baseRaw}</span>
                            {/if}
                          </span>
                        {/each}
                      </div>
                    {/if}
                  </div>
                {/each}
              </div>
            {/if}
          {:else if planTotals}
            <SessionOverview totals={planTotals} roundCount={todayPlan?.yaml_source ? 0 : 0} />
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
          {#if nextPlan}
            <div class="next-plan">
              <p class="label muted small">Next planned</p>
              <p class="next-title">{nextPlan.title}</p>
              <p class="muted small">{formatDate(nextPlan.planned_for)}</p>
              {#if nextSummary.length}
                <div class="compact-summary rich planner-summary mini">
                  {#each nextSummary as block}
                    <div class="summary-block">
                      <div class="summary-title">
                        {#if block.count && block.count > 1}
                          <span class="chip-pill pill-count">{block.count} ×</span>
                        {/if}
                        {block.title}
                      </div>
                      {#if block.items?.length}
                        <div class="summary-items">
                          {#each block.items as it}
                            <span class="summary-chip fancy">
                              {#if it.label}<span class="chip-label">{it.label}</span>{/if}
                              <span class="chip-pill pill-count">{it.count ?? 1} ×</span>
                              {#if it.work}
                                <span class="chip-pill">
                                  <span>{it.work}</span>
                                </span>
                              {/if}
                              {#if it.on || it.off}
                                <span class="chip-pill pill-rest">
                                  {#if it.on}<span class="on">{it.on}</span>{/if}
                                  {#if it.off}
                                    <span class="divider">/</span>
                                    <span class="off">{it.off}</span>
                                  {/if}
                                </span>
                              {/if}
                              {#if !it.label && !it.work && !it.on && !it.off}
                                <span>{it.baseRaw}</span>
                              {/if}
                            </span>
                          {/each}
                        </div>
                      {/if}
                    </div>
                  {/each}
                </div>
              {:else if nextPlanTotals}
                <SessionOverview totals={nextPlanTotals} roundCount={0} class="mini" />
              {/if}
            </div>
          {/if}
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
          <p class="eyebrow">Last {rangeLabel(recentRange)}</p>
          <h2>Recent training</h2>
        </div>
        <div class="panel-actions">
          <div class="range-toggle" aria-label="Select training range">
            <button
              class={`toggle ${recentRange === 7 ? 'active' : ''}`}
              type="button"
              on:click={() => setRecentRange(7)}
            >
              7d
            </button>
            <button
              class={`toggle ${recentRange === 30 ? 'active' : ''}`}
              type="button"
              on:click={() => setRecentRange(30)}
            >
              30d
            </button>
          </div>
          <a class="ghost" href="/history">History</a>
        </div>
      </div>

      {#if historyLoading}
        <p class="muted">Loading history…</p>
      {:else if historyError}
        <p class="error">{historyError}</p>
        <button class="ghost" on:click={loadHistory}>Retry</button>
      {:else}
        <div class="week-stats">
          <div class="stat">
            <p class="label">Sessions ({rangeLabel(recentRange)})</p>
            <strong>{recentSummary.sessions}</strong>
          </div>
          <div class="stat">
            <p class="label">Volume (min)</p>
            <strong>{recentSummary.totalMinutes}</strong>
          </div>
          <div class="stat">
            <p class="label">Avg RPE</p>
            <strong>{recentSummary.avgRpe ?? '—'}</strong>
          </div>
          <div class="stat">
            <p class="label">Streak</p>
            <strong>{recentSummary.streak}d</strong>
          </div>
        </div>
        <div class="chart-card">
          {#if !hasRecentActivity}
            <p class="muted">No sessions in the selected window.</p>
          {:else}
            <div class="chart-shell">
              <canvas bind:this={chartEl}></canvas>
            </div>
          {/if}
        </div>
        <div class="insights-row">
          <button class="btn ghost" type="button" on:click={() => (insightsModalOpen = true)}>Ask AI (7d)</button>
        </div>
        <div class="balance">
          <div class="balance-head">
            <div class="balance-title">
              <p class="label">Movement mix</p>
              <span class="muted small">Last {rangeLabel(movementRange)}, name heuristic</span>
            </div>
            <div class="balance-actions">
              <div class="range-toggle small" aria-label="Select movement range">
                <button
                  class={`toggle ${movementRange === 7 ? 'active' : ''}`}
                  type="button"
                  on:click={() => setMovementRange(7)}
                >
                  7d
                </button>
                <button
                  class={`toggle ${movementRange === 30 ? 'active' : ''}`}
                  type="button"
                  on:click={() => setMovementRange(30)}
                >
                  30d
                </button>
              </div>
              <span class="muted small">Total sets: {movementSetCount}</span>
              <button class="ghost info-btn" type="button" on:click={() => (movementInfoOpen = true)}>?</button>
            </div>
          </div>
          {#if !movementBalance.length}
            <p class="muted small">No sets in the last {rangeLabel(movementRange)}.</p>
          {:else}
            <div class="movement-legend">
              <span class="swatch pure"></span> Pure
              <span class="swatch shared"></span> Shared
            </div>
            <div class="movement-chart">
              <canvas bind:this={movementChartEl} style={`height:${movementBalance.length * 36 + 20}px`}></canvas>
            </div>
          {/if}
        </div>
      {/if}
    </section>
  </div>

  <div class="lower-grid">
  <section class="panel modules">
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
  </div>

  {#if insightsModalOpen}
    <div class="insights-modal">
      <div class="insights-panel">
        <div class="insights-head">
          <div>
            <p class="eyebrow">AI insights</p>
            <h3>Last 7 days</h3>
          </div>
          <button class="ghost" type="button" on:click={() => (insightsModalOpen = false)}>✕</button>
        </div>
        <textarea
          placeholder="Ask a question (optional). Default: trends in volume and RPE."
          bind:value={insightsQuestion}
        ></textarea>
        <div class="insights-actions">
          <button
            class="primary"
            type="button"
            on:click={generateInsights}
            disabled={insightsLoading || !openAiKey.trim()}
          >
            {insightsLoading ? 'Generating…' : 'Generate insights'}
          </button>
          <button class="ghost" type="button" on:click={() => (insightsModalOpen = false)}>Close</button>
          {#if insightsStatus}<span class="muted small">{insightsStatus}</span>{/if}
          {#if insightsError}<span class="error small">{insightsError}</span>{/if}
        </div>
        {#if insightsAnswer}
          <div class="insights-body" aria-live="polite">
            {@html insightsHtml || insightsAnswer}
          </div>
        {/if}
      </div>
    </div>
  {/if}

  {#if movementInfoOpen}
    <div class="insights-modal">
      <div class="insights-panel">
        <div class="insights-head">
          <div>
            <p class="eyebrow">How we tally</p>
            <h3>Movement mix</h3>
          </div>
          <button class="ghost" type="button" on:click={() => (movementInfoOpen = false)}>✕</button>
        </div>
        <div class="insights-body">
          <ul>
            <li>Scope: completed sets from the selected window (7d or 30d).</li>
            <li>Skip labels that look like warmup, cooldown, transition, prep, rest.</li>
            <li>Categorize using set + round name; a set can hit multiple buckets.</li>
            <li>Each set starts as weight = 1. If it hits N buckets, each gets 1/N (shared shown in yellow).</li>
            <li>Total sets shown = number of categorized sets (before splitting).</li>
            <li>Snatch = Hinge; Jerks = Push + Squat; Long cycle = Hinge + Pull + Push + Squat; Bumps = Squat.</li>
          </ul>
          <div class="movement-table">
            <p class="muted small">Patterns → buckets (examples from your data)</p>
            <ul>
              <li><strong>“swing”, “hinge”, “dead”</strong> → Hinge (e.g., KB Swing · Left/Right, OA Swing EMOM)</li>
              <li><strong>“clean”</strong> → Hinge + Pull (e.g., OA Clean · Left/Right, One-Arm Cleans with Gloves)</li>
              <li><strong>“press”, “push press”, “strict”, “dip”</strong> → Push (e.g., Press EMOM)</li>
              <li><strong>“jerk”</strong> → Push + Squat (e.g., KB Jerk · Left/Right, Jerks)</li>
              <li><strong>“bump”</strong> → Squat (e.g., Rack Bumps, Double KB Bumps)</li>
              <li><strong>“snatch”, “half snatch”</strong> → Hinge</li>
              <li><strong>“long cycle”, “clean and jerk”</strong> → Hinge + Pull + Push + Squat</li>
              <li><strong>Core keywords</strong> (“ab”, “roller”, “plank”, “get-up”/“tgu”, “windmill”, “sit up”) → Core</li>
              <li><strong>Squat keywords</strong> (“squat”, “lunge”, “split squat”, “step up”, “pistol”) → Squat</li>
              <li><strong>Carry keywords</strong> (“carry”, “walk”, “farmer”, “suitcase”, “rack walk”, “march”) → Carry</li>
              <li><strong>Pull keywords</strong> (“row”, “pull”, “chin”, “upright”) → Pull</li>
              <li><strong>Skipped</strong>: warmup/cooldown/transition/prep/rest labels.</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  {/if}
</main>

<style>
  .home {
    gap: 1rem;
    max-width: 1420px;
    width: 100%;
  }

  .page-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
  }

  .split {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(360px, 1fr));
    gap: 1rem;
  }

  .panel h2 {
    margin: 0;
  }

  .panel-actions {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .range-toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.15rem;
    padding: 0.1rem;
    border: 1px solid var(--color-border);
    border-radius: 999px;
    background: color-mix(in srgb, var(--color-surface-2) 70%, transparent);
  }

  .range-toggle.small {
    padding: 0.05rem;
  }

  .range-toggle .toggle {
    border: none;
    background: transparent;
    color: var(--color-text-muted);
    padding: 0.2rem 0.7rem;
    border-radius: 999px;
    font-weight: 700;
    cursor: pointer;
  }

  .range-toggle .toggle.active {
    background: color-mix(in srgb, var(--color-accent) 20%, transparent);
    color: var(--color-text-primary);
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

  .tags {
    display: inline-flex;
    gap: 0.35rem;
    flex-wrap: wrap;
  }

  /* tighten overview grid on home so four stats fit one row */
  .today-card :global(.overview__grid) {
    grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
    gap: 0.5rem;
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

  .next-plan {
    padding: 0.65rem 0.75rem;
    border: 1px dashed var(--color-border);
    border-radius: 12px;
    background: color-mix(in srgb, var(--color-surface-2) 70%, transparent);
  }

  .next-title {
    margin: 0.2rem 0;
    font-weight: 600;
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
    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
    gap: 0.55rem;
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

  .insights-row {
    margin-top: 0.35rem;
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
    justify-content: space-between;
  }

  .movement-legend {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.9rem;
    color: var(--color-text-muted);
  }

  .movement-legend .swatch {
    width: 14px;
    height: 8px;
    border-radius: 4px;
    display: inline-block;
  }
  .movement-legend .swatch.pure {
    background: linear-gradient(135deg, var(--color-accent), var(--color-accent-hover));
  }
  .movement-legend .swatch.shared {
    background: color-mix(in srgb, var(--color-warning) 60%, transparent);
  }

  .movement-chart {
    margin-top: 0.5rem;
  }

  .movement-values {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    margin-top: 0.4rem;
  }

  .movement-row {
    display: flex;
    justify-content: space-between;
    color: var(--color-text-muted);
    font-size: 0.95rem;
  }
  .movement-label {
    color: var(--color-text-primary);
  }

  .balance-title {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }

  .balance-actions {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
  }

  .info-btn {
    width: 26px;
    height: 26px;
    border-radius: 50%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    font-weight: 700;
  }

  .insights-modal {
    position: fixed;
    inset: 0;
    display: grid;
    place-items: center;
    background: rgba(0, 0, 0, 0.35);
    z-index: 300;
    padding: 1rem;
  }
  .insights-panel {
    background: var(--color-surface-2);
    border: 1px solid var(--color-border);
    border-radius: 16px;
    width: min(640px, 95vw);
    max-height: 90vh;
    overflow: auto;
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .insights-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
  }
  .insights-head h3 {
    margin: 0;
  }
  .insights-panel textarea {
    width: 100%;
    min-height: 80px;
    border-radius: 12px;
    border: 1px solid var(--color-border);
    background: var(--color-surface-1);
    color: var(--color-text-primary);
    padding: 0.75rem;
  }
  .insights-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  .insights-body {
    border: 1px solid var(--color-border);
    border-radius: 12px;
    padding: 0.75rem;
    background: color-mix(in srgb, var(--color-surface-1) 75%, transparent);
    max-height: 300px;
    overflow: auto;
  }

  .movement-table {
    margin-top: 0.35rem;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
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
  /* Compact summary chips (shared with planner) */
  .compact-summary {
    margin-top: 0.4rem;
    padding: 0.6rem 0.75rem;
    border-radius: 10px;
    background: color-mix(in srgb, var(--color-surface-2) 80%, transparent);
    border: 1px solid var(--color-border);
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    color: var(--color-text-primary);
    font-size: 0.95rem;
  }
  .compact-summary.rich {
    gap: 0.4rem;
  }
  .compact-summary.mini {
    font-size: 0.85rem;
    padding: 0.5rem 0.65rem;
    background: color-mix(in srgb, var(--color-surface-2) 60%, transparent);
    border-color: color-mix(in srgb, var(--color-border) 80%, transparent);
    gap: 0.25rem;
  }
  .summary-block {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }
  .summary-title {
    font-weight: 700;
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
  }
  .summary-items {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
  }
  .summary-chip {
    padding: 0.25rem 0.5rem;
    border-radius: 10px;
    border: 1px solid var(--color-border);
    background: color-mix(in srgb, var(--color-surface-1) 65%, transparent);
    font-size: 0.9rem;
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    flex-wrap: wrap;
  }
  .chip-pill {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.15rem 0.45rem;
    border-radius: 999px;
    background: color-mix(in srgb, var(--color-surface-2) 80%, transparent);
    border: 1px solid color-mix(in srgb, var(--color-border) 80%, transparent);
  }
  .summary-chip.fancy .chip-label {
    font-weight: 600;
    color: var(--color-text-primary);
  }
  .summary-chip.fancy .chip-pill {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.15rem 0.45rem;
    border-radius: 999px;
    background: color-mix(in srgb, var(--color-surface-2) 85%, transparent);
    border: 1px solid color-mix(in srgb, var(--color-border) 80%, transparent);
  }
  .summary-chip.fancy .chip-pill.pill-rest {
    background: color-mix(in srgb, var(--color-surface-2) 60%, transparent);
  }
  .summary-chip.fancy .chip-pill .on {
    font-weight: 600;
  }
  .summary-chip.fancy .chip-pill .off {
    opacity: 0.7;
  }
  .summary-chip.fancy .chip-pill .divider {
    opacity: 0.5;
  }
  .summary-chip.fancy .chip-pill.pill-count,
  .chip-pill.pill-count {
    font-weight: 700;
    background: color-mix(in srgb, var(--color-surface-2) 80%, transparent);
  }
  .compact-summary.mini .summary-chip {
    font-size: 0.82rem;
    padding: 0.18rem 0.4rem;
    gap: 0.25rem;
    background: color-mix(in srgb, var(--color-surface-1) 45%, transparent);
  }
  .compact-summary.mini .chip-pill {
    padding: 0.12rem 0.35rem;
    gap: 0.2rem;
    background: color-mix(in srgb, var(--color-surface-2) 65%, transparent);
  }
  .compact-summary.mini .summary-title {
    gap: 0.25rem;
  }

  .lower-grid {
    display: block;
  }

  .modules .cards {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    gap: 0.85rem 1rem;
    margin-top: 0.35rem;
    align-items: stretch;
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
    min-height: 110px;
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

  .ghost {
    background: transparent;
    color: var(--color-text-primary);
    border: 1px solid var(--color-border);
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
