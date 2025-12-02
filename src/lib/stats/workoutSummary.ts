export type CompletedSetLike = {
  round_label?: string | null
  set_label?: string | null
  reps?: number | null
  weight?: number | null
  duration_s?: number | null
  type?: string | null
}

const formatDuration = (seconds?: number | null) => {
  if (!seconds || seconds <= 0) return ''
  const mins = Math.floor(seconds / 60)
  const secs = Math.round(seconds % 60)
  return `${mins}m ${secs}s`
}

const normalizeRound = (round?: string | null) => {
  if (!round) return ''
  let value = round.trim()
  value = value.replace(/[-_]?block$/i, '').trim()
  return value
}

const baseLabel = (set: CompletedSetLike, roundName: string) => {
  const label = (set.set_label || set.round_label || 'Work').trim()
  const round = roundName.trim().toLowerCase()
  const norm = label.toLowerCase()
  if (round && (norm.startsWith(round + ':') || norm.startsWith(round))) {
    return label.slice(roundName.length).replace(/^:/, '').trim() || label
  }
  return label
}

const workKey = (set: CompletedSetLike, roundName: string) =>
  [
    baseLabel(set, roundName),
    set.reps ?? '',
    set.weight ?? '',
    set.duration_s ?? '',
    'work'
  ].join('|')

const restKey = (set: CompletedSetLike) => `rest|${set.duration_s ?? ''}`

const formatWork = (set: CompletedSetLike, roundName: string) => {
  const label = baseLabel(set, roundName)
  const parts: string[] = []
  if (set.reps !== null && set.reps !== undefined) parts.push(String(set.reps))
  if (set.weight !== null && set.weight !== undefined) parts.push(`@ ${set.weight}`)
  const labelNeeded = label && label.toLowerCase() !== roundName.trim().toLowerCase()
  const main = labelNeeded
    ? parts.length
      ? `${label}: ${parts.join(' ')}`
      : label
    : parts.length
      ? parts.join(' ')
      : label || 'Work'
  const dur = set.duration_s ? ` (${formatDuration(set.duration_s)})` : ''
  return `${main}${dur}`
}

const formatRest = (set: CompletedSetLike) => {
  const dur = set.duration_s ? ` (${formatDuration(set.duration_s)})` : ''
  return `Rest${dur}`
}

export const summarizeCompletedWorkout = (sets: CompletedSetLike[] = []) => {
  if (!Array.isArray(sets) || sets.length === 0) return ''

  // Group contiguous sets by normalized round label (rest with empty round sticks to current)
  const segments: { round: string; sets: CompletedSetLike[] }[] = []
  let currentRound = normalizeRound(sets[0].round_label)
  let bucket: CompletedSetLike[] = []
  const pushBucket = () => {
    if (!bucket.length) return
    segments.push({ round: currentRound, sets: bucket })
    bucket = []
  }
  for (const s of sets) {
    const roundRaw = normalizeRound(s.round_label)
    const isRest = (s.type ?? 'work').toLowerCase() !== 'work'
    const round = isRest && !roundRaw ? currentRound : roundRaw
    if (round !== currentRound && bucket.length) {
      pushBucket()
    }
    currentRound = round
    bucket.push(s)
  }
  pushBucket()

  // Merge adjacent segments with the same round
  const merged: { round: string; sets: CompletedSetLike[] }[] = []
  for (const seg of segments) {
    const last = merged[merged.length - 1]
    if (last && last.round === seg.round) {
      last.sets.push(...seg.sets)
    } else {
      merged.push({ ...seg })
    }
  }

  const lines: string[] = []

  for (const seg of merged) {
    const items: string[] = []
    const roundName = seg.round
    let i = 0
    const list = seg.sets
    while (i < list.length) {
      const curr = list[i]
      const type = (curr.type ?? 'work').toLowerCase()

      // Detect repeating work+rest pairs
      if (type === 'work' && i + 1 < list.length && (list[i + 1].type ?? 'rest').toLowerCase() !== 'work') {
        const work = curr
        const rest = list[i + 1]
        const workK = workKey(work, roundName)
        const restK = restKey(rest)
        let count = 1
        let trailingWork = 0
        while (
          i + count * 2 + 1 < list.length &&
          workKey(list[i + count * 2], roundName) === workK &&
          restKey(list[i + count * 2 + 1]) === restK
        ) {
          count++
        }
        // allow a final dangling work without matching rest (end of block)
        const nextIndex = i + count * 2
        if (nextIndex < list.length && (list[nextIndex].type ?? 'work').toLowerCase() === 'work' && workKey(list[nextIndex], roundName) === workK) {
          trailingWork = 1
        }
        if (trailingWork) {
          items.push(
            count > 1
              ? `${count} × (${formatWork(work, roundName)} + ${formatRest(rest)}) + ${formatWork(work, roundName)}`
              : `${formatWork(work, roundName)} + ${formatRest(rest)} + ${formatWork(work, roundName)}`
          )
          i += count * 2 + 1
        } else {
          items.push(
            count > 1
              ? `${count} × (${formatWork(work, roundName)} + ${formatRest(rest)})`
              : `${formatWork(work, roundName)} + ${formatRest(rest)}`
          )
          i += count * 2
        }
        continue
      }

      // Collapse consecutive identical singles
      let count = 1
      if (type === 'work') {
        const key = workKey(curr, roundName)
        while (i + count < list.length && (list[i + count].type ?? 'work').toLowerCase() === 'work' && workKey(list[i + count], roundName) === key) {
          count++
        }
        items.push(count > 1 ? `${count} × ${formatWork(curr, roundName)}` : formatWork(curr, roundName))
        i += count
        continue
      } else {
        const key = restKey(curr)
        while (i + count < list.length && (list[i + count].type ?? 'rest').toLowerCase() !== 'work' && restKey(list[i + count]) === key) {
          count++
        }
        items.push(count > 1 ? `${count} × ${formatRest(curr)}` : formatRest(curr))
        i += count
        continue
      }
    }

    const joined = items.join('; ')
    lines.push(roundName ? `${roundName}: ${joined}` : joined)
  }

  return lines.join('\n')
}
