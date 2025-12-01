import { buildTimeline } from './timeline'

const EMPTY_TOTALS = Object.freeze({ work: 0, rest: 0, total: 0 })

const durationOf = (phase: any) => {
  const raw = phase?.durationSeconds ?? phase?.duration ?? 0
  const seconds = Number(raw)
  return Number.isFinite(seconds) && seconds > 0 ? seconds : 0
}

export const computePlanTotals = (plan: any) => {
  if (!plan || !Array.isArray(plan.rounds)) {
    return { ...EMPTY_TOTALS }
  }

  const derivedTimeline = buildTimeline(plan)
  return derivedTimeline.reduce(
    (totals, phase) => {
      const duration = durationOf(phase)
      totals.total += duration
      if (phase.type === 'work') {
        totals.work += duration
      } else {
        totals.rest += duration
      }
      return totals
    },
    { work: 0, rest: 0, total: 0 }
  )
}
