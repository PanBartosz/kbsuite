import { buildWorkoutSummary, type CompletedSetLike, type SummaryBlock } from './workoutSummary'
import { categorizeExercise } from '$lib/timer/lib/exerciseCategorizer'

export type CompletedWorkoutLike = {
  id: string
  workout_id?: string | null
  title?: string | null
  started_at?: number | null
  finished_at?: number | null
  created_at?: number | null
  duration_s?: number | null
  rpe?: number | null
  notes?: string | null
  tags?: string[] | null
  sets?: CompletedSetLike[] | null
}

export type WorkoutFingerprint = {
  id: string
  workoutId: string | null
  titleTokens: Set<string>
  tags: Set<string>
  labels: Set<string>
  categories: Set<string>
  summaryKeys: Set<string>
  summaryLabels: Set<string>
  totals: Totals
  summary: SummaryBlock[]
}

export type Totals = {
  totalReps: number
  totalWorkSeconds: number
  totalSets: number
  tonnage: number
  avgWeight: number | null
}

export type SimilarityResult = {
  workout: CompletedWorkoutLike
  score: number
  reasons: string[]
  fingerprint: WorkoutFingerprint
}

type RankOptions = { limit?: number }

const tokenize = (value?: string | null) =>
  (value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 3)

const normalizeLabel = (value?: string | null) =>
  (value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

const jaccard = (a: Set<string>, b: Set<string>) => {
  if (!a.size || !b.size) return 0
  let shared = 0
  a.forEach((v) => {
    if (b.has(v)) shared++
  })
  return shared / Math.max(1, a.size + b.size - shared)
}

const closeness = (a: number, b: number) => {
  if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) return 0
  const diff = Math.abs(a - b)
  const max = Math.max(a, b)
  return Math.max(0, 1 - diff / max)
}

const computeTotals = (sets: CompletedSetLike[] = []): Totals => {
  let tonnage = 0
  let weightCount = 0
  let weightSum = 0
  const filtered = sets.filter(Boolean)
  const totalReps = filtered.reduce((sum, s) => sum + (Number(s.reps) || 0), 0)
  const totalWorkSeconds = filtered.reduce(
    (sum, s) => sum + ((s.type && s.type !== 'work') ? 0 : Number(s.duration_s) || 0),
    0
  )
  const totalSets = filtered.filter((s) => !s.type || s.type === 'work').length

  filtered.forEach((s) => {
    const isWork = !s.type || s.type === 'work'
    if (!isWork) return
    const reps = Number(s.reps) || 0
    const weight = Number(s.weight) || 0
    if (reps && weight) {
      tonnage += reps * weight
      weightCount += 1
      weightSum += weight
    }
  })

  return {
    totalReps,
    totalWorkSeconds,
    totalSets,
    tonnage,
    avgWeight: weightCount ? weightSum / weightCount : null
  }
}

export const buildFingerprint = (item: CompletedWorkoutLike): WorkoutFingerprint => {
  const sets = (item.sets ?? []).filter(Boolean)
  const summary = buildWorkoutSummary(sets)
  const totals = computeTotals(sets)
  const titleTokens = new Set(tokenize(item.title))
  const labels = new Set<string>()
  const categories = new Set<string>()
  const summaryKeys = new Set<string>()
  const summaryLabels = new Set<string>()
  sets.forEach((s) => {
    const round = normalizeLabel(s.round_label)
    const label = normalizeLabel(s.set_label)
    if (round) labels.add(round)
    if (label) labels.add(label)
    categorizeExercise(s.set_label, s.round_label).forEach((c) => categories.add(c))
  })
  summary.blocks.forEach((block) => {
    block.items.forEach((it) => {
      if (it.key) summaryKeys.add(it.key)
      if (it.label) {
        const norm = normalizeLabel(it.label)
        if (norm) summaryLabels.add(norm)
      }
    })
  })
  const tags = new Set((item.tags ?? []).map((t) => normalizeLabel(t)).filter(Boolean))
  return {
    id: item.id,
    workoutId: item.workout_id ?? null,
    titleTokens,
    tags,
    labels,
    categories,
    summaryKeys,
    summaryLabels,
    totals,
    summary: summary.blocks
  }
}

const recencyBoost = (aTs?: number | null, bTs?: number | null) => {
  if (!aTs || !bTs) return 0
  const diffDays = Math.abs(aTs - bTs) / (1000 * 60 * 60 * 24)
  if (diffDays <= 7) return 0.6
  if (diffDays <= 30) return 0.35
  if (diffDays <= 90) return 0.15
  if (diffDays <= 180) return -0.1
  return -0.25
}

const reasonLabel = (label: string, score: number) => `${label} (+${score.toFixed(1)})`

const scorePair = (
  source: WorkoutFingerprint,
  candidate: WorkoutFingerprint,
  timestamps: { a: number | null; b: number | null }
) => {
  let score = 0
  const reasons: string[] = []

  if (source.workoutId && candidate.workoutId && source.workoutId === candidate.workoutId) {
    score += 6
    reasons.push('Same template/workout')
  }

  const titleOverlap = jaccard(source.titleTokens, candidate.titleTokens)
  if (titleOverlap > 0) {
    const pts = 2.5 * titleOverlap
    score += pts
    reasons.push(reasonLabel('Similar title', pts))
  }

  const tagOverlap = jaccard(source.tags, candidate.tags)
  if (tagOverlap > 0) {
    const pts = 2.2 * tagOverlap
    score += pts
    reasons.push(reasonLabel('Shared tags', pts))
  }

  const labelOverlap = jaccard(source.labels, candidate.labels)
  if (labelOverlap > 0.15) {
    const pts = 3 * labelOverlap
    score += pts
    reasons.push(reasonLabel('Similar exercise labels', pts))
  }

  const catOverlap = jaccard(source.categories, candidate.categories)
  if (catOverlap > 0) {
    const pts = 2.8 * catOverlap
    score += pts
    reasons.push(reasonLabel('Similar movement mix', pts))
  }

  const summaryOverlap = jaccard(source.summaryKeys, candidate.summaryKeys)
  if (summaryOverlap > 0.08) {
    const pts = 3.4 * summaryOverlap
    score += pts
    reasons.push(reasonLabel('Similar set patterns', pts))
  }

  const repClose = closeness(source.totals.totalReps, candidate.totals.totalReps)
  if (repClose > 0.25) {
    const pts = 1.2 * repClose
    score += pts
    reasons.push(reasonLabel('Close total reps', pts))
  }

  const durationClose = closeness(source.totals.totalWorkSeconds, candidate.totals.totalWorkSeconds)
  if (durationClose > 0.25) {
    const pts = 1.2 * durationClose
    score += pts
    reasons.push(reasonLabel('Close work duration', pts))
  }

  const tonnageClose = closeness(source.totals.tonnage, candidate.totals.tonnage)
  if (tonnageClose > 0.2) {
    const pts = 1.4 * tonnageClose
    score += pts
    reasons.push(reasonLabel('Similar tonnage', pts))
  }

  const avgWeightClose = closeness(
    source.totals.avgWeight ?? 0,
    candidate.totals.avgWeight ?? 0
  )
  if (avgWeightClose > 0.25) {
    const pts = 0.8 * avgWeightClose
    score += pts
    reasons.push(reasonLabel('Close average weight', pts))
  }

  const recency = recencyBoost(timestamps.a, timestamps.b)
  if (recency) {
    score += recency
    reasons.push(recency > 0 ? 'Recent similar block' : 'Older session (penalty)')
  }

  return { score, reasons }
}

export const rankSimilarWorkouts = (
  source: CompletedWorkoutLike,
  candidates: CompletedWorkoutLike[],
  opts: RankOptions = {}
): SimilarityResult[] => {
  if (!source || !source.id) return []
  const sourceFp = buildFingerprint(source)
  const list = candidates
    .filter((c) => c && c.id && c.id !== source.id)
    .map((c) => {
      const fp = buildFingerprint(c)
      const { score, reasons } = scorePair(sourceFp, fp, {
        a: source.started_at ?? source.created_at ?? null,
        b: c.started_at ?? c.created_at ?? null
      })
      return { workout: c, score, reasons, fingerprint: fp }
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)

  const limit = opts.limit ?? 10
  return list.slice(0, limit)
}
