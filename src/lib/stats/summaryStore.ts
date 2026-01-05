import { get, writable } from 'svelte/store'

export type SummaryEntry = {
  id: string
  roundLabel: string
  setLabel: string
  phaseIndex: number
  type?: string
  durationSeconds?: number
  plannedReps?: number | null
  loggedReps?: number | null
  autoFilled?: boolean
  weight?: number | null
}

const summaryModalOpen = writable(false)
const summaryEntries = writable<SummaryEntry[]>([])
const summaryLatestRepCount = writable<number | null>(null)
const summaryPlanKey = writable<string | null>(null)
const summaryMetadata = writable<{
  title?: string
  workoutId?: string | null
  startedAt?: number | null
  finishedAt?: number | null
  durationSeconds?: number | null
}>({})

export const openSummaryModal = () => summaryModalOpen.set(true)
export const closeSummaryModal = () => summaryModalOpen.set(false)

export const setLatestRepCount = (value: number | null | undefined) => {
  if (value === null || value === undefined) {
    summaryLatestRepCount.set(null)
    return
  }
  const numeric = Number(value)
  summaryLatestRepCount.set(Number.isFinite(numeric) ? numeric : null)
}

export const setSummaryEntries = (entries: SummaryEntry[], planKey?: string | null) => {
  summaryEntries.set(entries ?? [])
  if (planKey !== undefined) {
    summaryPlanKey.set(planKey ?? null)
  }
}

export const seedSummaryEntries = (entries: SummaryEntry[], planKey?: string | null) => {
  const currentKey = get(summaryPlanKey)
  const normalizedKey = planKey ?? null
  if (currentKey === normalizedKey) return
  summaryEntries.set(entries ?? [])
  summaryPlanKey.set(normalizedKey)
}

export const applyRepCountToPhase = (
  phaseIndex: number,
  repCount: number | null | undefined,
  planKey?: string | null
) => {
  if (repCount === null || repCount === undefined) return
  const numeric = Number(repCount)
  if (!Number.isFinite(numeric)) return
  const currentKey = get(summaryPlanKey)
  if (planKey !== undefined && planKey !== null && currentKey !== planKey) {
    return
  }
  summaryEntries.update((list) =>
    list.map((entry) => {
      if (entry.phaseIndex !== phaseIndex) return entry
      if (entry.type && entry.type !== 'work') return entry
      return { ...entry, loggedReps: numeric, autoFilled: true }
    })
  )
}

export const setSummaryMetadata = (meta: {
  title?: string
  workoutId?: string | null
  startedAt?: number | null
  finishedAt?: number | null
  durationSeconds?: number | null
}) => summaryMetadata.set(meta ?? {})

export const clearSummaryDraft = () => {
  summaryEntries.set([])
  summaryLatestRepCount.set(null)
  summaryPlanKey.set(null)
  summaryMetadata.set({})
}

export { summaryEntries, summaryLatestRepCount, summaryModalOpen, summaryPlanKey, summaryMetadata }
