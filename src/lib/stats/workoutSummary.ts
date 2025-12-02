export type CompletedSetLike = {
  round_label?: string | null
  set_label?: string | null
  reps?: number | null
  weight?: number | null
  duration_s?: number | null
  type?: string | null
}

export type SummaryItem = {
  raw: string
  label: string
  work: string
  on?: string
  off?: string
  count?: number
}

export type SummaryBlock = { title: string; items: SummaryItem[] }
export type WorkoutSummary = { text: string; blocks: SummaryBlock[] }

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

const normalizeLabel = (value: string) => value.replace(/[^a-z0-9]/gi, '').toLowerCase()

const baseLabel = (set: CompletedSetLike, roundName: string) => {
  const label = (set.set_label || set.round_label || 'Work').trim()
  const round = normalizeLabel(roundName)
  const norm = normalizeLabel(label)
  if (round && norm.startsWith(round)) {
    const sliceIdx = Math.min(label.length, roundName.length)
    const trimmed = label.slice(sliceIdx).replace(/^:/, '').trim()
    return trimmed || label
  }
  return label
}

const buildEntry = (
  work: CompletedSetLike,
  rest: CompletedSetLike | null,
  roundName: string,
  includeLabel = true
): SummaryItem => {
  const label = includeLabel ? baseLabel(work, roundName) : ''
  const parts: string[] = []
  if (work.reps !== null && work.reps !== undefined) parts.push(String(work.reps))
  if (work.weight !== null && work.weight !== undefined) parts.push(`@ ${work.weight}`)
  const durOn = fmtDur(work.duration_s)
  const durOff = rest?.duration_s ? fmtDur(rest.duration_s) : ''
  const durPart =
    durOn && durOff
      ? ` (${durOn} on / ${durOff} off)`
      : durOn
        ? ` (${durOn})`
        : durOff
          ? ` (${durOff} off)`
          : ''
  const main = includeLabel
    ? parts.length
      ? `${label}: ${parts.join(' ')}`
      : label
    : parts.length
      ? parts.join(' ')
      : label
  const raw = `${main}${durPart}`.trim()
  const workText =
    parts.length > 0
      ? parts.join(' ')
      : !includeLabel && label
        ? label
        : ''
  return {
    raw,
    label: includeLabel ? label : '',
    work: workText,
    on: durOn || '',
    off: durOff || '',
    count: 1
  }
}

export const buildWorkoutSummary = (sets: CompletedSetLike[] = []): WorkoutSummary => {
  if (!Array.isArray(sets) || sets.length === 0) return { text: '', blocks: [] }

  // Group contiguous sets by normalized round label (rests without round stick to current)
  const segments: { round: string; sets: CompletedSetLike[] }[] = []
  let currentRound = normalizeRound(sets[0].round_label)
  let bucket: CompletedSetLike[] = []
  const pushBucket = () => {
    if (!bucket.length) return
    segments.push({ round: currentRound, sets: bucket })
    bucket = []
  }
  for (const s of sets) {
    const type = (s.type ?? 'work').toLowerCase()
    if (type === 'roundtransition') continue
    const roundRaw = normalizeRound(s.round_label)
    const isRest = type !== 'work'
    const round = isRest && !roundRaw ? currentRound : roundRaw
    if (round !== currentRound && bucket.length) {
      pushBucket()
    }
    currentRound = round
    bucket.push(s)
  }
  pushBucket()

  // Merge adjacent segments with same round
  const merged: { round: string; sets: CompletedSetLike[] }[] = []
  for (const seg of segments) {
    const last = merged[merged.length - 1]
    if (last && last.round === seg.round) {
      last.sets.push(...seg.sets)
    } else {
      merged.push({ ...seg })
    }
  }

  const blocks: SummaryBlock[] = []

  for (const seg of merged) {
    const roundName = seg.round || 'Session'
    const list = seg.sets
    if (list.every((s) => (s.type ?? 'rest').toLowerCase() !== 'work')) {
      continue
    }
    const items: SummaryItem[] = []
    let lastLabel = ''
    let lastNorm = ''
    let i = 0
    while (i < list.length) {
      const curr = list[i]
      const type = (curr.type ?? 'work').toLowerCase()

      if (type === 'work') {
        const next = list[i + 1]
        const hasRest = next && (next.type ?? 'rest').toLowerCase() !== 'work'
        const following = list[i + 2]
        const hasTrailingWork =
          hasRest &&
          following &&
          (following.type ?? 'work').toLowerCase() === 'work' &&
          normalizeLabel(baseLabel(following, roundName)) === normalizeLabel(baseLabel(curr, roundName)) &&
          following.reps === curr.reps &&
          following.weight === curr.weight

        const label = baseLabel(curr, roundName)
        const norm = normalizeLabel(label)
        const includeLabel = norm !== lastNorm
        lastLabel = label
        lastNorm = norm

        if (hasRest && hasTrailingWork && (!list[i + 3] || (list[i + 3].type ?? 'rest').toLowerCase() !== 'work')) {
          const entry = buildEntry(curr, next, roundName, includeLabel)
          entry.raw = `2 × ${entry.raw}`
          entry.work = entry.work ? `2 × ${entry.work}` : entry.raw
          entry.count = 2
          items.push(entry)
          i += 3
          continue
        }

        if (hasRest) {
          items.push(buildEntry(curr, next, roundName, includeLabel))
          i += 2
        } else {
          items.push(buildEntry(curr, null, roundName, includeLabel))
          i += 1
        }
      } else {
        // rest-only (dangling) -> omit
        i += 1
      }
    }

    // Collapse identical consecutive items
    const collapsed: SummaryItem[] = []
    let j = 0
    while (j < items.length) {
      let count = 1
      while (j + count < items.length && items[j + count].raw === items[j].raw) {
        count++
      }
      if (count > 1) {
        const base = { ...items[j] }
        base.raw = `${count} × ${base.raw}`
        base.work = base.work ? `${count} × ${base.work}` : base.raw
        base.count = count
        collapsed.push(base)
      } else {
        collapsed.push(items[j])
      }
      j += count
    }

    if (collapsed.length) {
      blocks.push({ title: roundName, items: collapsed })
    }
  }

  const text = blocks
    .map((block) => {
      const joined = block.items.map((it) => it.raw).join('; ')
      return `- ${block.title}: ${joined}`
    })
    .join('\n')

  return { text, blocks }
}

export const summarizeCompletedWorkout = (sets: CompletedSetLike[] = []) => buildWorkoutSummary(sets).text
