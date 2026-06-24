import type { ProgramMetricMap } from './types'

export type CompletedSetMetricInput = {
  round_label?: string | null
  roundLabel?: string | null
  set_label?: string | null
  setLabel?: string | null
  reps?: number | null
  loggedReps?: number | null
  weight?: number | null
  duration_s?: number | null
  durationSeconds?: number | null
  type?: string | null
}

const numberOrNull = (value: unknown) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

const text = (value: unknown) => (typeof value === 'string' ? value : '').trim()

export const computeCompletedProgramMetrics = (
  sets: CompletedSetMetricInput[] = []
): ProgramMetricMap => {
  let totalReps = 0
  let totalWork = 0
  let primaryReps = 0
  let primaryWork = 0
  let workSeconds = 0
  let workSetCount = 0

  sets.forEach((set) => {
    const type = text(set.type || 'work').toLowerCase()
    if (type && type !== 'work') return

    const reps = numberOrNull(set.reps ?? set.loggedReps) ?? 0
    const weight = numberOrNull(set.weight) ?? 0
    const duration = numberOrNull(set.duration_s ?? set.durationSeconds) ?? 0
    const roundLabel = text(set.round_label ?? set.roundLabel)
    const setLabel = text(set.set_label ?? set.setLabel)
    const label = `${roundLabel} ${setLabel}`.toLowerCase()
    const work = reps * weight

    workSetCount += 1
    totalReps += reps
    totalWork += work
    workSeconds += duration

    if (label.includes('primary')) {
      primaryReps += reps
      primaryWork += work
    }
  })

  if (primaryReps <= 0 && totalReps > 0) {
    primaryReps = totalReps
    primaryWork = totalWork
  }

  return {
    totalReps,
    totalWork,
    primaryReps,
    primaryWork,
    workSeconds,
    workMinutes: workSeconds ? Number((workSeconds / 60).toFixed(2)) : 0,
    workRate: workSeconds ? Number((totalReps / (workSeconds / 60)).toFixed(2)) : null,
    primaryWorkRate: workSeconds ? Number((primaryReps / (workSeconds / 60)).toFixed(2)) : null,
    workSetCount
  }
}

export const summarizeProgramWorkouts = (
  workouts: { planned_metrics?: ProgramMetricMap | null; actual_metrics?: ProgramMetricMap | null; status?: string }[]
) => {
  const totals = workouts.reduce(
    (acc, item) => {
      const planned = item.planned_metrics ?? {}
      const actual = item.actual_metrics ?? {}
      acc.plannedPrimaryWork += Number(planned.primaryWork ?? planned.totalWork ?? 0) || 0
      acc.actualPrimaryWork += Number(actual.primaryWork ?? actual.totalWork ?? 0) || 0
      acc.plannedPrimaryReps += Number(planned.primaryReps ?? planned.totalReps ?? 0) || 0
      acc.actualPrimaryReps += Number(actual.primaryReps ?? actual.totalReps ?? 0) || 0
      if (item.status === 'completed') acc.completedDays += 1
      acc.totalDays += 1
      return acc
    },
    {
      plannedPrimaryWork: 0,
      actualPrimaryWork: 0,
      plannedPrimaryReps: 0,
      actualPrimaryReps: 0,
      completedDays: 0,
      totalDays: 0
    }
  )

  return {
    ...totals,
    completionPercent: totals.plannedPrimaryWork
      ? Number(((totals.actualPrimaryWork / totals.plannedPrimaryWork) * 100).toFixed(1))
      : null
  }
}
