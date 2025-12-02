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

const workKey = (set: CompletedSetLike) =>
  [
    set.round_label ?? '',
    set.set_label ?? '',
    set.reps ?? '',
    set.weight ?? '',
    set.duration_s ?? '',
    set.type ?? 'work'
  ].join('|')

const restKey = (set: CompletedSetLike) => `${set.type ?? 'rest'}|${set.duration_s ?? ''}`

const formatWork = (set: CompletedSetLike) => {
  const label =
    (set.round_label && set.set_label
      ? `${set.round_label}: ${set.set_label}`
      : set.set_label || set.round_label || 'Work') ?? 'Work'
  const parts: string[] = []
  if (set.reps !== null && set.reps !== undefined) parts.push(String(set.reps))
  if (set.weight !== null && set.weight !== undefined) parts.push(`@ ${set.weight}`)
  const repsWeight = parts.length ? `: ${parts.join(' ')}` : ''
  const dur = set.duration_s ? ` (${formatDuration(set.duration_s)})` : ''
  return `${label}${repsWeight}${dur}`
}

const formatRest = (set: CompletedSetLike) => {
  const dur = set.duration_s ? ` (${formatDuration(set.duration_s)})` : ''
  return `Rest${dur}`
}

export const summarizeCompletedWorkout = (sets: CompletedSetLike[] = []) => {
  if (!Array.isArray(sets) || sets.length === 0) return ''
  const lines: string[] = []
  let i = 0
  while (i < sets.length) {
    const current = sets[i]
    const currentType = (current.type ?? 'work').toLowerCase()

    // Detect repeating work/rest pair pattern
    if (currentType === 'work' && i + 1 < sets.length) {
      const next = sets[i + 1]
      const nextType = (next.type ?? 'rest').toLowerCase()
      if (nextType !== 'work') {
        const workKeyBase = workKey(current)
        const restKeyBase = restKey(next)
        let count = 1
        while (
          i + count * 2 + 1 < sets.length &&
          workKey(sets[i + count * 2]) === workKeyBase &&
          restKey(sets[i + count * 2 + 1]) === restKeyBase
        ) {
          count += 1
        }
        const pairText =
          count > 1
            ? `${count} × (${formatWork(current)}, ${formatRest(next)})`
            : `${formatWork(current)} + ${formatRest(next)}`
        lines.push(pairText)
        i += count * 2
        continue
      }
    }

    // Collapse identical consecutive sets of the same type
    let count = 1
    const keyFn = currentType === 'work' ? workKey : restKey
    const baseKey = keyFn(current)
    while (i + count < sets.length && keyFn(sets[i + count]) === baseKey && (sets[i + count].type ?? currentType) === current.type) {
      count += 1
    }

    if (currentType === 'work') {
      lines.push(count > 1 ? `${count} × ${formatWork(current)}` : formatWork(current))
    } else {
      lines.push(count > 1 ? `${count} × ${formatRest(current)}` : formatRest(current))
    }
    i += count
  }

  return lines.join('\n')
}
