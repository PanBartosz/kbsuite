export type ProgramKind = 'dep-total-work'

export type ProgramStatus = 'draft' | 'planned' | 'active' | 'completed' | 'archived'

export type ProgramWorkoutStatus = 'generated' | 'planned' | 'completed' | 'skipped'

export type ProgramMetricMap = Record<string, number | string | boolean | null>

export type ProgramWorkoutDraft = {
  title: string
  dayIndex: number
  cycleIndex: number
  role: string
  plannedFor: number
  yamlSource: string
  notes?: string
  tags?: string[]
  plannedMetrics: ProgramMetricMap
}

export type ProgramAdapter<TSpec = any> = {
  id: ProgramKind
  title: string
  description: string
  normalizeSpec: (input: unknown) => TSpec
  generateWorkouts: (spec: TSpec, context?: { runId?: string }) => ProgramWorkoutDraft[]
}

export type ProgramRunSummary = {
  id: string
  kind: ProgramKind
  title: string
  status: ProgramStatus
  spec: any
  state: any
  started_at: number | null
  ended_at: number | null
  created_at: number
  updated_at: number
}

export type ProgramWorkoutSummary = {
  id: string
  program_run_id: string
  planned_workout_id: string | null
  completed_workout_id: string | null
  cycle_index: number
  day_index: number
  role: string
  title: string
  planned_for: number | null
  status: ProgramWorkoutStatus
  planned_metrics: ProgramMetricMap
  actual_metrics: ProgramMetricMap | null
  created_at: number
  updated_at: number
}
