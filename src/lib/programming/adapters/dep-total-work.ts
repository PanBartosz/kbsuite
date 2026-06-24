import YAML from 'yaml'
import type { ProgramAdapter, ProgramKind, ProgramWorkoutDraft } from '../types'

type RepCounterMode = 'lockout' | 'swing' | 'disabled'
type SecondaryFormat = 'none' | 'lr-emom' | 'timed' | 'regular-sets'

type SecondarySlot = {
  dayIndex: number
  enabled: boolean
  exercise: string
  label: string
  format: SecondaryFormat
  load: number | null
  minutes: number
  rounds: number
  sets: number
  workSeconds: number
  restSeconds: number
  repCounterMode: RepCounterMode
}

export type DepTotalWorkSpec = {
  kind: ProgramKind
  version: 1
  title: string
  startDate: string
  primary: {
    exercise: string
    highLoad: number
    lowLoad: number
    baselineReps: number
    baselineStatus: 'valid' | 'provisional' | 'projected'
    testDurationMinutes: number
    symmetryMultiple: number
    repCounterMode: RepCounterMode
  }
  schedule: {
    microcycles: number
    restAfterDays: number[]
  }
  progression: {
    projectedRepsPerMicrocycle: number
  }
  workoutFormat: {
    warmupMinutes: number
    cooldownMinutes: number
    transitionMinutes: number
    primaryFormat: 'emom' | 'continuous'
    primaryMinutes: number
  }
  secondary: SecondarySlot[]
}

const DAY_INTENTS: Record<number, string> = {
  1: 'High effort / high load test',
  2: 'Low effort / low load recovery',
  3: 'Low effort / high load strength',
  4: 'High effort / low load speed',
  5: 'Low effort / high load strength',
  6: 'Low effort / low load recovery'
}

const DEFAULT_SECONDARY: SecondarySlot[] = [
  {
    dayIndex: 1,
    enabled: true,
    exercise: 'Single-arm press',
    label: 'Secondary press',
    format: 'lr-emom',
    load: 40,
    minutes: 6,
    rounds: 3,
    sets: 3,
    workSeconds: 60,
    restSeconds: 0,
    repCounterMode: 'lockout'
  },
  {
    dayIndex: 2,
    enabled: true,
    exercise: 'One-arm row',
    label: 'Light rows',
    format: 'timed',
    load: 32,
    minutes: 3,
    rounds: 1,
    sets: 1,
    workSeconds: 180,
    restSeconds: 0,
    repCounterMode: 'disabled'
  },
  {
    dayIndex: 3,
    enabled: true,
    exercise: 'Double front squat',
    label: 'Heavy squat',
    format: 'regular-sets',
    load: 48,
    minutes: 9,
    rounds: 1,
    sets: 3,
    workSeconds: 60,
    restSeconds: 180,
    repCounterMode: 'disabled'
  },
  {
    dayIndex: 4,
    enabled: true,
    exercise: 'Pushup',
    label: 'Light push',
    format: 'regular-sets',
    load: null,
    minutes: 9,
    rounds: 1,
    sets: 3,
    workSeconds: 60,
    restSeconds: 180,
    repCounterMode: 'disabled'
  },
  {
    dayIndex: 5,
    enabled: true,
    exercise: 'One-arm row',
    label: 'Heavy rows',
    format: 'lr-emom',
    load: 40,
    minutes: 6,
    rounds: 3,
    sets: 3,
    workSeconds: 60,
    restSeconds: 0,
    repCounterMode: 'disabled'
  },
  {
    dayIndex: 6,
    enabled: true,
    exercise: 'Goblet squat',
    label: 'Light squat',
    format: 'timed',
    load: 24,
    minutes: 3,
    rounds: 1,
    sets: 1,
    workSeconds: 180,
    restSeconds: 0,
    repCounterMode: 'disabled'
  }
]

const clamp = (value: unknown, fallback: number, min: number, max: number) => {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

const intClamp = (value: unknown, fallback: number, min: number, max: number) =>
  Math.round(clamp(value, fallback, min, max))

const asText = (value: unknown, fallback: string) => {
  const text = typeof value === 'string' ? value.trim() : ''
  return text || fallback
}

const mode = (value: unknown, fallback: RepCounterMode): RepCounterMode => {
  const v = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return v === 'swing' || v === 'lockout' || v === 'disabled' ? v : fallback
}

const format = (value: unknown, fallback: SecondaryFormat): SecondaryFormat => {
  const v = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return v === 'none' || v === 'lr-emom' || v === 'timed' || v === 'regular-sets' ? v : fallback
}

const dateToMs = (date: string) => {
  const ts = Date.parse(date)
  return Number.isFinite(ts) ? ts : Date.now()
}

const addDays = (ts: number, days: number) => {
  const d = new Date(ts)
  d.setDate(d.getDate() + days)
  return d.getTime()
}

const roundDownTo = (value: number, multiple: number) => {
  const m = Math.max(1, Math.round(multiple || 1))
  return Math.floor(value / m) * m
}

const distributeReps = (total: number, slots: number) => {
  const safeSlots = Math.max(1, Math.round(slots))
  const safeTotal = Math.max(0, Math.round(total))
  const base = Math.floor(safeTotal / safeSlots)
  const remainder = safeTotal % safeSlots
  return Array.from({ length: safeSlots }, (_, idx) => base + (idx < remainder ? 1 : 0))
}

const normalizeSecondary = (input: unknown): SecondarySlot[] => {
  const byDay = new Map(DEFAULT_SECONDARY.map((slot) => [slot.dayIndex, slot]))
  const items = Array.isArray(input) ? input : []
  items.forEach((item: any) => {
    const dayIndex = intClamp(item?.dayIndex, 0, 1, 6)
    if (!dayIndex) return
    const base = byDay.get(dayIndex) ?? DEFAULT_SECONDARY[dayIndex - 1]
    byDay.set(dayIndex, {
      ...base,
      enabled: item?.enabled === false ? false : item?.format === 'none' ? false : base.enabled,
      exercise: asText(item?.exercise, base.exercise),
      label: asText(item?.label, base.label),
      format: format(item?.format, base.format),
      load:
        item?.load === null || item?.load === ''
          ? null
          : Number.isFinite(Number(item?.load))
            ? Number(item.load)
            : base.load,
      minutes: intClamp(item?.minutes, base.minutes, 1, 60),
      rounds: intClamp(item?.rounds, base.rounds, 1, 20),
      sets: intClamp(item?.sets, base.sets, 1, 20),
      workSeconds: intClamp(item?.workSeconds, base.workSeconds, 10, 1800),
      restSeconds: intClamp(item?.restSeconds, base.restSeconds, 0, 1800),
      repCounterMode: mode(item?.repCounterMode, base.repCounterMode)
    })
  })
  return [1, 2, 3, 4, 5, 6].map((day) => byDay.get(day) ?? DEFAULT_SECONDARY[day - 1])
}

export const defaultDepTotalWorkSpec = (): DepTotalWorkSpec => ({
  kind: 'dep-total-work',
  version: 1,
  title: 'DEP Total Work Mesocycle',
  startDate: new Date().toISOString().slice(0, 10),
  primary: {
    exercise: 'Kettlebell snatch',
    highLoad: 32,
    lowLoad: 20,
    baselineReps: 96,
    baselineStatus: 'provisional',
    testDurationMinutes: 10,
    symmetryMultiple: 2,
    repCounterMode: 'lockout'
  },
  schedule: {
    microcycles: 1,
    restAfterDays: []
  },
  progression: {
    projectedRepsPerMicrocycle: 0
  },
  workoutFormat: {
    warmupMinutes: 10,
    cooldownMinutes: 10,
    transitionMinutes: 3,
    primaryFormat: 'emom',
    primaryMinutes: 10
  },
  secondary: DEFAULT_SECONDARY.map((slot) => ({ ...slot }))
})

export const normalizeDepTotalWorkSpec = (input: unknown): DepTotalWorkSpec => {
  const raw = input && typeof input === 'object' ? (input as any) : {}
  const defaults = defaultDepTotalWorkSpec()
  const primary = raw.primary ?? {}
  const schedule = raw.schedule ?? {}
  const progression = raw.progression ?? {}
  const workoutFormat = raw.workoutFormat ?? {}
  const baselineStatus = ['valid', 'provisional', 'projected'].includes(primary.baselineStatus)
    ? primary.baselineStatus
    : defaults.primary.baselineStatus
  const primaryFormat = workoutFormat.primaryFormat === 'continuous' ? 'continuous' : 'emom'
  const restAfterDays = Array.isArray(schedule.restAfterDays)
    ? schedule.restAfterDays
        .map((day: unknown) => Math.round(Number(day)))
        .filter((day: number) => day >= 1 && day <= 6)
    : []

  return {
    kind: 'dep-total-work',
    version: 1,
    title: asText(raw.title, defaults.title),
    startDate: asText(raw.startDate, defaults.startDate),
    primary: {
      exercise: asText(primary.exercise, defaults.primary.exercise),
      highLoad: clamp(primary.highLoad, defaults.primary.highLoad, 1, 500),
      lowLoad: clamp(primary.lowLoad, defaults.primary.lowLoad, 1, 500),
      baselineReps: intClamp(primary.baselineReps, defaults.primary.baselineReps, 1, 5000),
      baselineStatus,
      testDurationMinutes: intClamp(
        primary.testDurationMinutes,
        defaults.primary.testDurationMinutes,
        1,
        120
      ),
      symmetryMultiple: intClamp(primary.symmetryMultiple, defaults.primary.symmetryMultiple, 1, 20),
      repCounterMode: mode(primary.repCounterMode, defaults.primary.repCounterMode)
    },
    schedule: {
      microcycles: intClamp(schedule.microcycles, defaults.schedule.microcycles, 1, 12),
      restAfterDays: Array.from(new Set(restAfterDays))
    },
    progression: {
      projectedRepsPerMicrocycle: intClamp(
        progression.projectedRepsPerMicrocycle,
        defaults.progression.projectedRepsPerMicrocycle,
        -500,
        500
      )
    },
    workoutFormat: {
      warmupMinutes: intClamp(workoutFormat.warmupMinutes, defaults.workoutFormat.warmupMinutes, 0, 60),
      cooldownMinutes: intClamp(
        workoutFormat.cooldownMinutes,
        defaults.workoutFormat.cooldownMinutes,
        0,
        60
      ),
      transitionMinutes: intClamp(
        workoutFormat.transitionMinutes,
        defaults.workoutFormat.transitionMinutes,
        0,
        30
      ),
      primaryFormat,
      primaryMinutes: intClamp(workoutFormat.primaryMinutes, defaults.workoutFormat.primaryMinutes, 1, 120)
    },
    secondary: normalizeSecondary(raw.secondary)
  }
}

const primaryTargets = (spec: DepTotalWorkSpec, cycleIndex: number) => {
  const n = Math.max(
    1,
    spec.primary.baselineReps + (cycleIndex - 1) * spec.progression.projectedRepsPerMicrocycle
  )
  const high = spec.primary.highLoad
  const low = spec.primary.lowLoad
  const symmetry = spec.primary.symmetryMultiple
  const highStrength = roundDownTo((2 * n) / 3, symmetry)
  const lowMatch = roundDownTo((high * n) / low, symmetry)

  return {
    1: { reps: roundDownTo(n, symmetry), load: high, role: 'test', intent: DAY_INTENTS[1] },
    2: { reps: roundDownTo(n, symmetry), load: low, role: 'recovery', intent: DAY_INTENTS[2] },
    3: { reps: highStrength, load: high, role: 'strength', intent: DAY_INTENTS[3] },
    4: { reps: lowMatch, load: low, role: 'speed', intent: DAY_INTENTS[4] },
    5: { reps: highStrength, load: high, role: 'strength', intent: DAY_INTENTS[5] },
    6: { reps: roundDownTo(n, symmetry), load: low, role: 'recovery', intent: DAY_INTENTS[6] }
  } as const
}

const baseSet = (overrides: Record<string, unknown>) => ({
  workSeconds: 60,
  restSeconds: 0,
  transitionSeconds: 0,
  repCounterMode: 'disabled',
  enableModeChanging: false,
  ...overrides
})

const primaryRound = (spec: DepTotalWorkSpec, cycleIndex: number, dayIndex: number) => {
  const target = primaryTargets(spec, cycleIndex)[dayIndex as 1 | 2 | 3 | 4 | 5 | 6]
  const label = `Primary - ${spec.primary.exercise}`
  const minutes =
    dayIndex === 1 ? spec.primary.testDurationMinutes : spec.workoutFormat.primaryMinutes
  const plannedReps = distributeReps(target.reps, minutes)

  if (spec.workoutFormat.primaryFormat === 'continuous') {
    return {
      label,
      transitionAfterSeconds: spec.workoutFormat.transitionMinutes * 60,
      sets: [
        baseSet({
          label: `${spec.primary.exercise} ${target.load}kg`,
          exercise: spec.primary.exercise,
          workSeconds: minutes * 60,
          weight: target.load,
          plannedReps: target.reps,
          repCounterMode: spec.primary.repCounterMode
        })
      ]
    }
  }

  return {
    label,
    transitionAfterSeconds: spec.workoutFormat.transitionMinutes * 60,
    sets: plannedReps.map((reps, idx) =>
      baseSet({
        label: `${spec.primary.exercise} ${target.load}kg M${idx + 1}`,
        exercise: spec.primary.exercise,
        workSeconds: 60,
        weight: target.load,
        plannedReps: reps,
        repCounterMode: spec.primary.repCounterMode
      })
    )
  }
}

const secondaryRound = (spec: DepTotalWorkSpec, dayIndex: number) => {
  const slot = spec.secondary.find((item) => item.dayIndex === dayIndex)
  if (!slot || !slot.enabled || slot.format === 'none') return null
  const label = `Secondary - ${slot.label || slot.exercise}`
  const setBase = {
    exercise: slot.exercise,
    weight: slot.load,
    repCounterMode: slot.repCounterMode,
    enableModeChanging: false
  }

  if (slot.format === 'lr-emom') {
    return {
      label,
      transitionAfterSeconds: spec.workoutFormat.transitionMinutes * 60,
      repetitions: slot.rounds,
      sets: [
        baseSet({
          ...setBase,
          label: `${slot.exercise} right`,
          workSeconds: 60
        }),
        baseSet({
          ...setBase,
          label: `${slot.exercise} left`,
          workSeconds: 60
        })
      ]
    }
  }

  if (slot.format === 'regular-sets') {
    return {
      label,
      transitionAfterSeconds: spec.workoutFormat.transitionMinutes * 60,
      sets: [
        baseSet({
          ...setBase,
          label: slot.exercise,
          workSeconds: slot.workSeconds,
          restSeconds: slot.restSeconds,
          repetitions: slot.sets
        })
      ]
    }
  }

  return {
    label,
    transitionAfterSeconds: spec.workoutFormat.transitionMinutes * 60,
    sets: [
      baseSet({
        ...setBase,
        label: slot.exercise,
        workSeconds: slot.minutes * 60
      })
    ]
  }
}

const dayPlan = (
  spec: DepTotalWorkSpec,
  cycleIndex: number,
  dayIndex: number,
  plannedFor: number,
  runId?: string
) => {
  const target = primaryTargets(spec, cycleIndex)[dayIndex as 1 | 2 | 3 | 4 | 5 | 6]
  const title = `${spec.title} C${cycleIndex}D${dayIndex}`
  const rounds: any[] = []

  if (spec.workoutFormat.warmupMinutes > 0) {
    rounds.push({
      label: 'Warmup',
      transitionAfterSeconds: spec.workoutFormat.transitionMinutes * 60,
      sets: [
        baseSet({
          label: 'Warmup',
          workSeconds: spec.workoutFormat.warmupMinutes * 60
        })
      ]
    })
  }

  rounds.push(primaryRound(spec, cycleIndex, dayIndex))

  const secondary = secondaryRound(spec, dayIndex)
  if (secondary) rounds.push(secondary)

  if (spec.workoutFormat.cooldownMinutes > 0) {
    rounds.push({
      label: 'Cooldown',
      sets: [
        baseSet({
          label: 'Cooldown',
          workSeconds: spec.workoutFormat.cooldownMinutes * 60
        })
      ]
    })
  }

  const plan = {
    title,
    description: `${target.intent}. Generated by the modular programming layer.`,
    defaultRepCounterMode: 'disabled',
    enableRepCounter: 'work',
    enableModeChanging: false,
    program: {
      kind: spec.kind,
      runId: runId ?? null,
      cycleIndex,
      dayIndex,
      role: target.role,
      plannedFor,
      primary: {
        exercise: spec.primary.exercise,
        load: target.load,
        reps: target.reps,
        work: target.reps * target.load,
        baselineStatus: spec.primary.baselineStatus
      }
    },
    rounds
  }

  return {
    title,
    yamlSource: YAML.stringify(plan),
    target
  }
}

export const generateDepTotalWorkouts = (
  specInput: unknown,
  context: { runId?: string } = {}
): ProgramWorkoutDraft[] => {
  const spec = normalizeDepTotalWorkSpec(specInput)
  const drafts: ProgramWorkoutDraft[] = []
  const start = dateToMs(spec.startDate)
  let dayOffset = 0

  for (let cycleIndex = 1; cycleIndex <= spec.schedule.microcycles; cycleIndex += 1) {
    const targets = primaryTargets(spec, cycleIndex)
    for (let dayIndex = 1; dayIndex <= 6; dayIndex += 1) {
      const plannedFor = addDays(start, dayOffset)
      const { title, yamlSource, target } = dayPlan(
        spec,
        cycleIndex,
        dayIndex,
        plannedFor,
        context.runId
      )
      drafts.push({
        title,
        dayIndex,
        cycleIndex,
        role: target.role,
        plannedFor,
        yamlSource,
        notes: `${DAY_INTENTS[dayIndex]}. DEP Total Work generated from N=${targets[1].reps}.`,
        tags: ['program', 'dep-total-work', `cycle-${cycleIndex}`, `day-${dayIndex}`],
        plannedMetrics: {
          primaryReps: target.reps,
          primaryLoad: target.load,
          primaryWork: target.reps * target.load,
          totalReps: target.reps,
          totalWork: target.reps * target.load,
          cycleIndex,
          dayIndex,
          role: target.role,
          baselineReps: targets[1].reps,
          baselineStatus: spec.primary.baselineStatus
        }
      })
      dayOffset += spec.schedule.restAfterDays.includes(dayIndex) ? 2 : 1
    }
  }

  return drafts
}

export const depTotalWorkAdapter: ProgramAdapter<DepTotalWorkSpec> = {
  id: 'dep-total-work',
  title: 'DEP Total Work',
  description: 'Daily Effort Protocol total-work generator with high/low load wave calculations.',
  normalizeSpec: normalizeDepTotalWorkSpec,
  generateWorkouts: generateDepTotalWorkouts
}
