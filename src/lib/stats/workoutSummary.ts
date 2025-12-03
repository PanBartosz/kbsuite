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
  baseRaw: string
  key: string
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

const normalizeRoundKey = (round?: string | null) =>
  normalizeRound(round || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gi, ' ')
    .trim()

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
  baseLabelValue: string,
  baseLabelNorm: string,
  includeLabel = true
): SummaryItem => {
  const label = includeLabel ? baseLabelValue : ''
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
    baseRaw: raw,
    key: [
      baseLabelNorm,
      work.reps ?? '',
      work.weight ?? '',
      durOn || '',
      durOff || '',
      rest ? 'r' : 'n'
    ]
      .map((p) => String(p).trim())
      .join('|'),
    label: includeLabel ? label : '',
    work: workText,
    on: durOn || '',
    off: durOff || '',
    count: 1
  }
}

export const buildWorkoutSummary = (sets: CompletedSetLike[] = []): WorkoutSummary => {
  if (!Array.isArray(sets) || sets.length === 0) return { text: '', blocks: [] }

  const sameItem = (a: SummaryItem, b: SummaryItem) =>
    a.key === b.key && (!a.label || !b.label || normalizeLabel(a.label) === normalizeLabel(b.label))

  const hasNextWindow = (start: number, len: number, repeat: number, total: number) =>
    start + (repeat + 1) * len <= total

  // Find the best contiguous cycle starting at `start`. Picks the cycle that covers the most items,
  // preferring longer patterns when coverage ties (to surface maximal sub-cycles).
  const findCycleAt = (arr: SummaryItem[], start: number) => {
    const remaining = arr.length - start
    const maxLen = Math.floor(remaining / 2)
    let best: { len: number; count: number; coverage: number } | null = null

    for (let len = 1; len <= maxLen; len++) {
      let repeats = 1
      while (
        hasNextWindow(start, len, repeats, arr.length) &&
        (() => {
          for (let i = 0; i < len; i++) {
            if (!sameItem(arr[start + i], arr[start + repeats * len + i])) return false
          }
          return true
        })()
      ) {
        repeats++
      }

      if (repeats > 1) {
        const coverage = repeats * len
        const shouldTake =
          !best ||
          coverage > best.coverage ||
          (coverage === best.coverage && repeats > best.count) ||
          (coverage === best.coverage && repeats === best.count && len < best.len)

        if (shouldTake) best = { len, count: repeats, coverage }
      }
    }

    return best ? { len: best.len, count: best.count } : null
  }

  // Group sets by normalized round key (allow non-contiguous merging)
  const blockMap: Record<string, { title: string; sets: CompletedSetLike[] }> = {}
  const order: string[] = []
  let currentKey = ''
  let currentTitle = ''
  for (const s of sets) {
    const type = (s.type ?? 'work').toLowerCase()
    if (type === 'roundtransition') continue
    const rawLabel = s.round_label ?? ''
    const displayLabel = normalizeRound(rawLabel) || currentTitle || 'Session'
    const isRest = type !== 'work'
    const key = normalizeRoundKey(isRest && !rawLabel ? currentTitle : rawLabel || currentKey || displayLabel || 'session')
    const titleForBlock = key === currentKey && currentTitle ? currentTitle : displayLabel
    if (!blockMap[key]) {
      blockMap[key] = { title: titleForBlock || 'Session', sets: [] }
      order.push(key)
    }
    blockMap[key].sets.push(s)
    currentKey = key
    currentTitle = blockMap[key].title
  }

  const blocks: SummaryBlock[] = []

  for (const key of order) {
    const seg = blockMap[key]
    const roundName = seg.title || 'Session'
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
          const entry = buildEntry(curr, next, roundName, label, norm, includeLabel)
          entry.count = 2
          items.push(entry)
          i += 3
          continue
        }

        if (hasRest) {
          items.push(buildEntry(curr, next, roundName, label, norm, includeLabel))
          i += 2
        } else {
          items.push(buildEntry(curr, null, roundName, label, norm, includeLabel))
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
      let total = items[j].count ?? 1
      while (j + count < items.length && items[j + count].key === items[j].key) {
        total += items[j + count].count ?? 1
        count++
      }
      const base = { ...items[j], count: total }
      collapsed.push(base)
      j += count
    }

    // Second pass: detect repeating cycles within the sequence (supports multiple cycles per round)
    const pendingPlain: SummaryItem[] = []
    const flushPlain = () => {
      if (pendingPlain.length) {
        blocks.push({ title: roundName, items: [...pendingPlain] })
        pendingPlain.length = 0
      }
    }

    let cursor = 0
    while (cursor < collapsed.length) {
      const cycle = findCycleAt(collapsed, cursor)
      if (cycle) {
        flushPlain()
        const pattern = collapsed.slice(cursor, cursor + cycle.len)
        blocks.push({ title: `${cycle.count} × ${roundName}`, items: pattern })
        cursor += cycle.len * cycle.count
        continue
      }
      pendingPlain.push(collapsed[cursor])
      cursor++
    }
    flushPlain()
  }

  const text = blocks
    .map((block) => {
      const joined = block.items
        .map((it) => {
          const prefix = it.count && it.count > 1 ? `${it.count} × ` : ''
          return `${prefix}${it.baseRaw}`
        })
        .join('; ')
      return `- ${block.title}: ${joined}`
    })
    .join('\n')

  return { text, blocks }
}

export const summarizeCompletedWorkout = (sets: CompletedSetLike[] = []) => buildWorkoutSummary(sets).text
