import type { SummaryBlock, SummaryItem } from '$lib/stats/workoutSummary'

export type PlannedSummaryBlock = SummaryBlock & { count?: number }

const fmtDur = (seconds?: number | null) => {
  if (!seconds || seconds <= 0) return ''
  const mins = Math.floor(seconds / 60)
  const secs = Math.round(seconds % 60)
  return secs === 0 ? `${mins}:00` : `${mins}:${secs.toString().padStart(2, '0')}`
}

const normalizeRound = (round?: string | null) => {
  if (!round) return ''
  return round.trim().replace(/[-_]?block$/i, '').trim()
}

const normalizeRoundKey = (round?: string | null) =>
  normalizeRound(round || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gi, ' ')
    .trim()

const normalizeLabel = (value: string) => value.replace(/[^a-z0-9]/gi, '').toLowerCase()

export const buildPlannedSummary = (plan: any): PlannedSummaryBlock[] => {
  if (!plan?.rounds || !Array.isArray(plan.rounds)) return []
  const blocks: PlannedSummaryBlock[] = []
  const blockMap: Record<string, { title: string; count: number; items: SummaryItem[] }> = {}
  const order: string[] = []

  plan.rounds.forEach((round: any, roundIdx: number) => {
    const roundTitle = normalizeRound(round?.label) || `Round ${roundIdx + 1}`
    const roundKey = normalizeRoundKey(round?.label || roundTitle || `round-${roundIdx}`)
    const roundReps =
      round?.repetitions && Number.isFinite(round.repetitions) ? Math.max(1, Number(round.repetitions)) : 1
    const roundDisplay = roundTitle
    if (!blockMap[roundKey]) {
      blockMap[roundKey] = { title: roundDisplay, count: roundReps, items: [] }
      order.push(roundKey)
    } else {
      blockMap[roundKey].count += roundReps
    }
    const sets = Array.isArray(round?.sets) ? round.sets : []
    let lastNormLabel = ''
    sets.forEach((set: any, setIdx: number) => {
      const labelRaw = set?.label?.trim?.() || roundTitle || `Set ${setIdx + 1}`
      const normLabel = normalizeLabel(labelRaw)
      const includeLabel = normLabel !== lastNormLabel
      lastNormLabel = normLabel
      const on = fmtDur(set?.workSeconds)
      const off = fmtDur((set?.restSeconds ?? 0) + (set?.transitionSeconds ?? 0))
      const repCount =
        set?.repetitions && Number.isFinite(set.repetitions) ? Math.max(1, Number(set.repetitions)) : 1
      const workText = ''
      const item: SummaryItem = {
        raw: '',
        baseRaw: '',
        key: [normLabel, on, off].join('|'),
        label: includeLabel ? labelRaw : '',
        work: workText,
        on,
        off,
        count: repCount
      }
      item.baseRaw = [item.label || '', item.work, [on, off].filter(Boolean).join(' / ')].filter(Boolean).join(' ')
      item.raw = item.baseRaw
      const list = blockMap[roundKey].items
      const last = list[list.length - 1]
      if (last && last.key === item.key) {
        last.count = (last.count ?? 1) + (item.count ?? 1)
      } else {
        list.push(item)
      }
    })
  })

  order.forEach((key) => {
    const bucket = blockMap[key]
    if (!bucket) return
    const mapped: PlannedSummaryBlock = {
      title: bucket.title,
      items: bucket.items,
      count: bucket.count
    }
    blocks.push(mapped)
  })

  return blocks
}
