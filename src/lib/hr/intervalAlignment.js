/**
 * HR interval alignment utilities.
 *
 * Designed to work in both browser (SvelteKit) and Node (for quick local checks).
 */

/**
 * @typedef {{ t: number, hr: number }} HrSample
 * @typedef {{
 *   type: string,
 *   durationSeconds: number,
 *   roundLabel?: string,
 *   setLabel?: string,
 *   reps?: number|null,
 *   weight?: number|null
 * }} Phase
 *
 * @typedef {{
 *   method: 'shift'|'warp',
 *   hrSeconds: number,
 *   planSeconds: number,
 *   shiftSeconds?: number,
 *   insertedSeconds?: number,
 *   deletedSeconds?: number,
 *   avgMatchError?: number,
 *   phases: Array<Phase & { planStart: number, planEnd: number, hrStart: number, hrEnd: number }>,
 * }} AlignmentResult
 */

const clamp = (n, min, max) => Math.max(min, Math.min(max, n))

const safeInt = (value) => {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.round(n))
}

const safeHr = (value) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/**
 * Build a phase list from completed sets rows.
 * @param {Array<any>} sets
 * @returns {Phase[]}
 */
export const buildPhasesFromSets = (sets) => {
  if (!Array.isArray(sets)) return []
  return sets
    .map((s) => {
      const type = (s?.type ?? 'work').toString()
      const durationSeconds = safeInt(s?.duration_s ?? s?.durationSeconds ?? 0)
      if (!durationSeconds) return null
      return {
        type,
        durationSeconds,
        roundLabel: s?.round_label ?? s?.roundLabel ?? undefined,
        setLabel: s?.set_label ?? s?.setLabel ?? undefined,
        reps: s?.reps !== undefined ? (Number.isFinite(Number(s.reps)) ? Number(s.reps) : null) : undefined,
        weight: s?.weight !== undefined ? (Number.isFinite(Number(s.weight)) ? Number(s.weight) : null) : undefined
      }
    })
    .filter(Boolean)
}

/**
 * Interpolate sparse HR samples into a 1Hz series.
 * @param {HrSample[]} samples
 * @returns {{ hr: Float32Array, minHr: number, maxHr: number, durationSeconds: number }}
 */
export const interpolateHr1s = (samples) => {
  if (!Array.isArray(samples) || !samples.length) {
    return { hr: new Float32Array(0), minHr: 0, maxHr: 0, durationSeconds: 0 }
  }
  const sorted = samples
    .map((s) => ({ t: safeInt(s?.t), hr: safeHr(s?.hr) }))
    .filter((s) => s.hr !== null)
    .sort((a, b) => a.t - b.t)
  if (!sorted.length) return { hr: new Float32Array(0), minHr: 0, maxHr: 0, durationSeconds: 0 }

  const maxT = sorted[sorted.length - 1].t
  const hr = new Float32Array(maxT + 1)

  let minHr = Number.POSITIVE_INFINITY
  let maxHr = Number.NEGATIVE_INFINITY

  const first = sorted[0]
  for (let t = 0; t <= Math.min(maxT, first.t); t++) {
    hr[t] = first.hr
  }

  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i]
    const b = sorted[i + 1]
    const t0 = a.t
    const t1 = Math.max(b.t, t0 + 1)
    const h0 = a.hr
    const h1 = b.hr
    hr[t0] = h0
    const span = t1 - t0
    for (let t = t0 + 1; t <= Math.min(t1, maxT); t++) {
      const alpha = span ? (t - t0) / span : 1
      hr[t] = h0 + (h1 - h0) * alpha
    }
  }

  const last = sorted[sorted.length - 1]
  for (let t = Math.max(0, last.t); t <= maxT; t++) {
    hr[t] = last.hr
  }

  for (let i = 0; i < hr.length; i++) {
    const v = hr[i]
    if (Number.isFinite(v)) {
      if (v < minHr) minHr = v
      if (v > maxHr) maxHr = v
    }
  }
  if (!Number.isFinite(minHr)) minHr = 0
  if (!Number.isFinite(maxHr)) maxHr = 0
  return { hr, minHr, maxHr, durationSeconds: maxT }
}

const smoothMovingAverage = (series, windowSize = 5) => {
  const n = series.length
  if (!n) return series
  const w = Math.max(1, Math.round(windowSize))
  if (w <= 1) return series
  const out = new Float32Array(n)
  let sum = 0
  let count = 0
  for (let i = 0; i < n; i++) {
    sum += series[i]
    count += 1
    if (i - w >= 0) {
      sum -= series[i - w]
      count -= 1
    }
    out[i] = sum / Math.max(1, count)
  }
  return out
}

const zScore = (series) => {
  const n = series.length
  if (!n) return { data: new Float32Array(0), mean: 0, std: 1 }
  let sum = 0
  for (let i = 0; i < n; i++) sum += series[i]
  const mean = sum / n
  let v = 0
  for (let i = 0; i < n; i++) {
    const d = series[i] - mean
    v += d * d
  }
  const std = Math.sqrt(v / Math.max(1, n - 1)) || 1
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) out[i] = (series[i] - mean) / std
  return { data: out, mean, std }
}

const buildEffortSignal = (phases) => {
  const planSeconds = phases.reduce((sum, p) => sum + safeInt(p.durationSeconds), 0)
  const effort = new Float32Array(planSeconds)
  const restLike = new Uint8Array(planSeconds)
  let u = 0
  for (const phase of phases) {
    const dur = safeInt(phase.durationSeconds)
    if (!dur) continue
    const type = (phase.type ?? 'work').toString().toLowerCase()
    const isWork = type === 'work'
    const isRestLike = !isWork
    const val = isWork ? 1 : type === 'transition' || type === 'roundtransition' ? 0.25 : 0
    for (let i = 0; i < dur && u < planSeconds; i++, u++) {
      effort[u] = val
      restLike[u] = isRestLike ? 1 : 0
    }
  }
  return { effort, restLike, planSeconds }
}

const simulateHrResponse = (effort, tauSeconds = 35) => {
  const n = effort.length
  const out = new Float32Array(n)
  const tau = Math.max(5, Number(tauSeconds) || 35)
  let p = 0
  for (let i = 0; i < n; i++) {
    p += (effort[i] - p) / tau
    out[i] = p
  }
  return out
}

const computePhaseBoundaries = (phases) => {
  const bounds = []
  let u = 0
  for (const phase of phases) {
    const dur = safeInt(phase.durationSeconds)
    const start = u
    const end = u + dur
    bounds.push({ start, end })
    u = end
  }
  return bounds
}

const buildShiftOnlyMapping = (predZ, obsZ, maxShiftSeconds = 900) => {
  const U = predZ.length
  const T = obsZ.length
  if (!U || !T) return { shift: 0, mapUtoT: new Int32Array(U + 1) }

  const maxShift = Math.max(0, Math.round(maxShiftSeconds))
  const minShift = -Math.min(maxShift, 300)
  const maxShiftBound = Math.min(maxShift, T)

  let bestShift = 0
  let bestCost = Number.POSITIVE_INFINITY

  for (let shift = minShift; shift <= maxShiftBound; shift++) {
    let cost = 0
    let n = 0
    for (let u = 0; u < U; u++) {
      const t = u + shift
      if (t < 0 || t >= T) continue
      const d = predZ[u] - obsZ[t]
      cost += d * d
      n++
    }
    if (!n) continue
    const avg = cost / n
    if (avg < bestCost) {
      bestCost = avg
      bestShift = shift
    }
  }

  const mapUtoT = new Int32Array(U + 1)
  mapUtoT[0] = clamp(bestShift, 0, T)
  for (let u = 1; u <= U; u++) {
    mapUtoT[u] = clamp(u + bestShift, 0, T)
  }
  return { shift: bestShift, mapUtoT, avgMatchError: Number.isFinite(bestCost) ? bestCost : undefined }
}

const buildWarpMapping = (
  predZ,
  obsZ,
  restLikeSeconds,
  {
    penaltyInsertMid = 0.7,
    penaltyInsertEdge = 0.06,
    penaltyDelete = 6.0
  } = {}
) => {
  const U = predZ.length
  const T = obsZ.length
  const W = T + 1
  const pred = new Uint8Array((U + 1) * W)

  const prev = new Float64Array(W)
  const cur = new Float64Array(W)
  prev.fill(Number.POSITIVE_INFINITY)
  prev[0] = 0

  const allowInsertAt = new Uint8Array(U + 1)
  allowInsertAt[0] = 1
  allowInsertAt[U] = 1
  for (let u = 1; u < U; u++) {
    const a = restLikeSeconds[u] ? 1 : 0
    const b = restLikeSeconds[u - 1] ? 1 : 0
    allowInsertAt[u] = a || b ? 1 : 0
  }

  for (let u = 0; u <= U; u++) {
    cur.fill(Number.POSITIVE_INFINITY)
    for (let t = 0; t <= T; t++) {
      if (u === 0 && t === 0) {
        cur[t] = 0
        pred[u * W + t] = 0
        continue
      }

      let best = Number.POSITIVE_INFINITY
      let bestMove = 0

      // insertion: consume HR time only (allowed in rest-like or at edges)
      if (t > 0 && allowInsertAt[u]) {
        const insPenalty = u === 0 || u === U ? penaltyInsertEdge : penaltyInsertMid
        const cost = cur[t - 1] + insPenalty
        if (cost < best) {
          best = cost
          bestMove = 2 // I
        }
      }

      // match: consume both
      if (u > 0 && t > 0) {
        const d = predZ[u - 1] - obsZ[t - 1]
        const cost = prev[t - 1] + d * d
        if (cost < best) {
          best = cost
          bestMove = 1 // M
        }
      }

      // deletion: consume plan only (only on HR edges)
      if (u > 0 && (t === 0 || t === T)) {
        const cost = prev[t] + penaltyDelete
        if (cost < best) {
          best = cost
          bestMove = 3 // D
        }
      }

      cur[t] = best
      pred[u * W + t] = bestMove
    }
    prev.set(cur)
  }

  const ops = []
  let u = U
  let t = T
  while (u > 0 || t > 0) {
    const move = pred[u * W + t]
    if (move === 1) {
      ops.push(1)
      u -= 1
      t -= 1
    } else if (move === 2) {
      ops.push(2)
      t -= 1
    } else if (move === 3) {
      ops.push(3)
      u -= 1
    } else {
      break
    }
  }
  ops.reverse()

  const mapUtoT = new Int32Array(U + 1)
  mapUtoT.fill(-1)
  let uPos = 0
  let tPos = 0
  mapUtoT[0] = 0
  let matchCostSum = 0
  let matchCount = 0
  let insertedSeconds = 0
  let deletedSeconds = 0
  for (const op of ops) {
    if (op === 1) {
      const d = predZ[uPos] - obsZ[tPos]
      matchCostSum += d * d
      matchCount += 1
      uPos += 1
      tPos += 1
      if (uPos === U) {
        if (mapUtoT[uPos] < 0) mapUtoT[uPos] = tPos
      } else {
        mapUtoT[uPos] = tPos
      }
    } else if (op === 2) {
      insertedSeconds += 1
      tPos += 1
      if (uPos !== U) {
        mapUtoT[uPos] = tPos
      }
    } else if (op === 3) {
      deletedSeconds += 1
      uPos += 1
      if (uPos === U) {
        if (mapUtoT[uPos] < 0) mapUtoT[uPos] = tPos
      } else {
        mapUtoT[uPos] = tPos
      }
    }
  }

  const avgMatchError = matchCount ? matchCostSum / matchCount : undefined
  return { mapUtoT, insertedSeconds, deletedSeconds, avgMatchError }
}

/**
 * Align phases to HR samples and return phase intervals in HR time.
 * @param {Phase[]} phases
 * @param {HrSample[]} samples
 * @param {{ method?: 'shift'|'warp', tauSeconds?: number, smoothWindow?: number }} [options]
 * @returns {AlignmentResult}
 */
export const alignPhasesToHr = (phases, samples, options = {}) => {
  const method = options.method ?? 'warp'
  const tauSeconds = options.tauSeconds ?? 35
  const smoothWindow = options.smoothWindow ?? 5

  const cleanPhases = Array.isArray(phases) ? phases.filter((p) => safeInt(p.durationSeconds) > 0) : []
  const { hr: hrRaw, durationSeconds } = interpolateHr1s(samples)
  const hrSmoothed = smoothMovingAverage(hrRaw, smoothWindow)
  const hrZ = zScore(hrSmoothed).data

  const { effort, restLike, planSeconds } = buildEffortSignal(cleanPhases)
  const pred = simulateHrResponse(effort, tauSeconds)
  const predZ = zScore(pred).data

  const phaseBounds = computePhaseBoundaries(cleanPhases)

  /** @type {Int32Array} */
  let mapUtoT = new Int32Array(planSeconds + 1)
  let shiftSeconds = 0
  let insertedSeconds = 0
  let deletedSeconds = 0
  let avgMatchError = undefined

  if (method === 'shift') {
    const res = buildShiftOnlyMapping(predZ, hrZ, 900)
    mapUtoT = res.mapUtoT
    shiftSeconds = res.shift
    avgMatchError = res.avgMatchError
  } else {
    const res = buildWarpMapping(predZ, hrZ, restLike, {
      penaltyInsertMid: 0.7,
      penaltyInsertEdge: 0.06,
      penaltyDelete: 6.0
    })
    mapUtoT = res.mapUtoT
    insertedSeconds = res.insertedSeconds ?? 0
    deletedSeconds = res.deletedSeconds ?? 0
    avgMatchError = res.avgMatchError
  }

  const mappedPhases = cleanPhases.map((phase, idx) => {
    const b = phaseBounds[idx]
    const hrStart = clamp(mapUtoT[b.start] ?? 0, 0, hrZ.length)
    const hrEnd = clamp(mapUtoT[b.end] ?? hrZ.length, 0, hrZ.length)
    return {
      ...phase,
      planStart: b.start,
      planEnd: b.end,
      hrStart,
      hrEnd
    }
  })

  return {
    method,
    hrSeconds: durationSeconds,
    planSeconds,
    shiftSeconds,
    insertedSeconds,
    deletedSeconds,
    avgMatchError,
    phases: mappedPhases
  }
}
