import { buildWorkoutSummary, type CompletedSetLike } from './workoutSummary'

export type CompletedWorkoutLike = {
  id: string
  title?: string | null
  started_at?: number | null
  created_at?: number | null
  duration_s?: number | null
  rpe?: number | null
  notes?: string | null
  tags?: string[] | null
  sets?: CompletedSetLike[] | null
}

export type HrSummaryLike = Record<string, { avgHr?: number | null; maxHr?: number | null } | undefined>

const truncate = (value?: string | null, max = 400) => {
  if (!value) return ''
  if (value.length <= max) return value
  return value.slice(0, max)
}

const dayString = (ts?: number | null) => {
  if (!ts) return ''
  try {
    return new Date(ts).toISOString().slice(0, 10)
  } catch {
    return ''
  }
}

const computeTotals = (sets: CompletedSetLike[] = []) => {
  const filtered = sets.filter(Boolean)
  const totalReps = filtered.reduce((sum, s) => sum + (Number(s.reps) || 0), 0)
  const totalWorkSeconds = filtered.reduce(
    (sum, s) => sum + ((s.type && s.type !== 'work') ? 0 : Number(s.duration_s) || 0),
    0
  )
  const totalSets = filtered.filter((s) => !s.type || s.type === 'work').length
  return { totalReps, totalWorkSeconds, totalSets }
}

export const mapWorkoutForAi = (
  item: CompletedWorkoutLike,
  hr?: { avgHr?: number | null; maxHr?: number | null }
) => {
  const sets = item.sets ?? []
  const summary = buildWorkoutSummary(sets)
  const totals = computeTotals(sets ?? [])
  return {
    id: item.id,
    date: dayString(item.started_at ?? item.created_at ?? null),
    title: item.title ?? 'Workout',
    durationMinutes: item.duration_s ? Math.round((item.duration_s ?? 0) / 60) : null,
    rpe: item.rpe ?? null,
    tags: (item.tags ?? []).map((t) => t?.trim?.()).filter(Boolean).slice(0, 8),
    notes: truncate(item.notes, 240),
    totals,
    hr: hr
      ? {
          avg: hr.avgHr ?? null,
          max: hr.maxHr ?? null
        }
      : undefined,
    summary: truncate(summary.text || '', 800)
  }
}

export const buildAiPayloadBatch = (
  items: CompletedWorkoutLike[] = [],
  hrSummary: HrSummaryLike = {},
  limit = 25
) => {
  return items.slice(0, limit).map((it) => mapWorkoutForAi(it, hrSummary[it.id]))
}
