export type CompletedSetLike = {
  round_label?: string | null
  set_label?: string | null
  reps?: number | null
  weight?: number | null
  duration_s?: number | null
  type?: string | null
}

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

const formatWorkRestPair = (
  work: CompletedSetLike,
  rest: CompletedSetLike | null,
  roundName: string,
  includeLabel = true
) => {
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
  return `${main}${durPart}`.trim()
}

const formatRestOnly = (rest: CompletedSetLike) => {
  const dur = fmtDur(rest.duration_s)
  return dur ? `Rest (${dur})` : 'Rest'
}

export const summarizeCompletedWorkout = (sets: CompletedSetLike[] = []) => {
  if (!Array.isArray(sets) || sets.length === 0) return ''

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

  const lines: string[] = []

  for (const seg of merged) {
    const roundName = seg.round || 'Session'
    const list = seg.sets
    if (list.every((s) => (s.type ?? 'rest').toLowerCase() !== 'work')) {
      continue
    }
    const items: string[] = []
    let lastLabel = ''
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
        const includeLabel = label !== lastLabel
        lastLabel = label

        if (hasRest && hasTrailingWork && (!list[i + 3] || (list[i + 3].type ?? 'rest').toLowerCase() !== 'work')) {
          items.push(`2 × ${formatWorkRestPair(curr, next, roundName, includeLabel)}`)
          i += 3
          continue
        }

        if (hasRest) {
          items.push(formatWorkRestPair(curr, next, roundName, includeLabel))
          i += 2
        } else {
          items.push(formatWorkRestPair(curr, null, roundName, includeLabel))
          i += 1
        }
      } else {
        // rest-only (dangling) -> omit
        i += 1
      }
    }

    // Collapse identical consecutive items
    const collapsed: string[] = []
    let j = 0
    while (j < items.length) {
      let count = 1
      while (j + count < items.length && items[j + count] === items[j]) {
        count++
      }
      collapsed.push(count > 1 ? `${count} × ${items[j]}` : items[j])
      j += count
    }

    const joined = collapsed.join('; ')
    lines.push(`- ${roundName}: ${joined}`)
  }

  return lines.join('\n')
}
