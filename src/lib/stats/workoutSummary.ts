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

const baseLabel = (set: CompletedSetLike, roundName: string) => {
  const label = (set.set_label || set.round_label || 'Work').trim()
  const round = roundName.trim().toLowerCase()
  const norm = label.toLowerCase()
  if (round && (norm.startsWith(round + ':') || norm.startsWith(round))) {
    return label.slice(roundName.length).replace(/^:/, '').trim() || label
  }
  return label
}

const formatWorkRestPair = (work: CompletedSetLike, rest: CompletedSetLike | null, roundName: string) => {
  const label = baseLabel(work, roundName)
  const parts: string[] = []
  if (work.reps !== null && work.reps !== undefined) parts.push(String(work.reps))
  if (work.weight !== null && work.weight !== undefined) parts.push(`@ ${work.weight}`)
  const dur = fmtDur(work.duration_s) ? ` (${fmtDur(work.duration_s)} on` : ''
  const restDur = rest?.duration_s ? `${fmtDur(rest.duration_s)} off` : ''
  const durPart = dur ? `${dur}${restDur ? ' / ' + restDur : ''})` : restDur ? ` (${restDur} off)` : ''
  const main = parts.length ? `${label}: ${parts.join(' ')}` : label
  return `${main}${durPart}`
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
    const roundName = seg.round
    const items: string[] = []
    const list = seg.sets
    let i = 0
    while (i < list.length) {
      const curr = list[i]
      const type = (curr.type ?? 'work').toLowerCase()

      if (type === 'work') {
        const next = list[i + 1]
        const hasRest = next && (next.type ?? 'rest').toLowerCase() !== 'work'
        if (hasRest) {
          items.push(formatWorkRestPair(curr, next, roundName))
          i += 2
        } else {
          items.push(formatWorkRestPair(curr, null, roundName))
          i += 1
        }
      } else {
        // rest-only (dangling)
        items.push(formatRestOnly(curr))
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
    lines.push(`- ${roundName || 'Session'}: ${joined}`)
  }

  return lines.join('\n')
}
