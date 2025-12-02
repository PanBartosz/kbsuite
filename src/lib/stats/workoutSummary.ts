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

const formatWork = (set: CompletedSetLike) => {
  const label = set.set_label || set.round_label || 'Work'
  const parts: string[] = []
  if (set.reps !== null && set.reps !== undefined) parts.push(String(set.reps))
  if (set.weight !== null && set.weight !== undefined) parts.push(`@ ${set.weight}`)
  const main = parts.length ? `${label}: ${parts.join(' ')}` : label
  const dur = set.duration_s ? ` (${formatDuration(set.duration_s)})` : ''
  return `${main}${dur}`
}

const formatRest = (set: CompletedSetLike) => {
  const dur = set.duration_s ? ` (${formatDuration(set.duration_s)})` : ''
  return `Rest${dur}`
}

const collapseConsecutive = (items: string[]) => {
  const out: string[] = []
  let i = 0
  while (i < items.length) {
    let count = 1
    while (i + count < items.length && items[i + count] === items[i]) {
      count++
    }
    out.push(count > 1 ? `${count} × ${items[i]}` : items[i])
    i += count
  }
  return out
}

const normalizeRound = (round?: string | null) => {
  if (!round) return ''
  let value = round.trim()
  if (/block$/i.test(value)) {
    value = value.replace(/block$/i, '').trim()
  }
  return value
}

const baseSetLabel = (set: CompletedSetLike, roundName: string) => {
  const roundLower = roundName.toLowerCase()
  let label = set.set_label || set.round_label || 'Work'
  const norm = label.trim().toLowerCase()
  if (roundLower && (norm.startsWith(roundLower + ':') || norm.startsWith(roundLower))) {
    label = label.slice(roundName.length).replace(/^:/, '').trim() || label
  }
  return label
}

export const summarizeCompletedWorkout = (sets: CompletedSetLike[] = []) => {
  if (!Array.isArray(sets) || sets.length === 0) return ''

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

  // merge adjacent segments with same round
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
    const parts: string[] = []
    for (const s of seg.sets) {
      const type = (s.type ?? 'work').toLowerCase()
      if (type === 'work') {
        const label = baseSetLabel(s, seg.round)
        const workStr = formatWork({ ...s, set_label: label, round_label: '' })
        parts.push(workStr)
      } else {
        parts.push(formatRest(s))
      }
    }
    const collapsed = collapseConsecutive(parts)
    const joined = collapsed.join('; ')
    lines.push(seg.round ? `${seg.round}: ${joined}` : joined)
  }

  return lines.join('\n')
}
