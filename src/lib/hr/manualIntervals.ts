export type HrSample = { t: number; hr: number }

export type WorkInterval = {
  round: number
  start: number
  end: number
}

export type HrIntervalMetricsConfig = {
  peakExtensionSec: number
  endWindowSec: number
  hrrWindowSec: number
}

export type HrIntervalRoundMetrics = {
  round: number
  workStart: number
  workEnd: number
  restStart: number
  restEnd: number
  maxHr: number | null
  hr_peak: number | null
  t_peak: number | null
  hr_end: number | null
  hrr60: number | null
  hr_at_hrr: number | null
  hrrTimeUsedSec: number | null
  tau_rec: number | null
  tau_fit_r2: number | null
  tau_fit_attempted: boolean
  tau_reliable: boolean | null
}

export type HrIntervalBlockTrends = {
  HRR60_slope_per_round: number | null
  HR_peak_slope_per_round: number | null
  HR_end_slope_per_round: number | null
  recoveryDegrading: boolean
}

const safeNumber = (value: unknown) => {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

export const safeInt = (value: unknown) => {
  const n = safeNumber(value)
  if (n === null) return 0
  return Math.round(n)
}

export const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n))

export const normalizeHrSamples = (raw: Array<{ t: unknown; hr: unknown }>, durationSeconds?: number | null) => {
  if (!Array.isArray(raw) || raw.length === 0) return [] as HrSample[]
  const sorted = raw
    .map((p) => ({ t: safeInt(p?.t), hr: safeNumber(p?.hr) }))
    .filter((p) => p.hr !== null)
    .map((p) => ({ t: Math.max(0, p.t), hr: p.hr as number }))
    .sort((a, b) => a.t - b.t)

  if (!sorted.length) return [] as HrSample[]

  const deduped: HrSample[] = []
  for (const p of sorted) {
    const last = deduped[deduped.length - 1]
    if (last && last.t === p.t) last.hr = p.hr
    else deduped.push({ ...p })
  }

  const first = deduped[0]
  if (first.t > 0) deduped.unshift({ t: 0, hr: first.hr })

  if (durationSeconds !== undefined && durationSeconds !== null) {
    const endT = Math.max(0, safeInt(durationSeconds))
    const last = deduped[deduped.length - 1]
    if (endT > last.t) deduped.push({ t: endT, hr: last.hr })
  }

  return deduped
}

export const buildWorkIntervals = ({
  rounds,
  workSeconds,
  restSeconds,
  offsetSeconds
}: {
  rounds: number
  workSeconds: number
  restSeconds: number
  offsetSeconds: number
}): WorkInterval[] => {
  const nRounds = Math.max(0, safeInt(rounds))
  const work = Math.max(0, safeInt(workSeconds))
  const rest = Math.max(0, safeInt(restSeconds))
  const offset = safeInt(offsetSeconds)

  if (!nRounds || !work) return []

  const intervals: WorkInterval[] = []
  let t = offset
  for (let i = 0; i < nRounds; i++) {
    intervals.push({ round: i + 1, start: t, end: t + work })
    t += work + rest
  }
  return intervals
}

export const computeMaxHr = (samples: HrSample[], startSeconds: number, endSeconds: number) => {
  if (!Array.isArray(samples) || !samples.length) return null as number | null
  const start = safeInt(startSeconds)
  const end = safeInt(endSeconds)
  if (end <= start) return null

  let max: number | null = null
  for (const s of samples) {
    const t = safeInt(s.t)
    if (t < start) continue
    if (t >= end) break
    if (max === null || s.hr > max) max = s.hr
  }
  return max
}

const lowerBoundByTime = (samples: HrSample[], t: number) => {
  let lo = 0
  let hi = samples.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (samples[mid].t < t) lo = mid + 1
    else hi = mid
  }
  return lo
}

const upperBoundByTime = (samples: HrSample[], t: number) => {
  let lo = 0
  let hi = samples.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (samples[mid].t <= t) lo = mid + 1
    else hi = mid
  }
  return lo
}

export const sliceSeries = (samples: HrSample[], t0: number, t1: number) => {
  if (!Array.isArray(samples) || !samples.length) return [] as HrSample[]
  if (!Number.isFinite(t0) || !Number.isFinite(t1)) return [] as HrSample[]
  const start = Math.min(t0, t1)
  const end = Math.max(t0, t1)
  const from = lowerBoundByTime(samples, start)
  const to = upperBoundByTime(samples, end)
  return samples.slice(from, to)
}

export const meanHR = (samples: HrSample[], t0: number, t1: number) => {
  const sliced = sliceSeries(samples, t0, t1)
  if (!sliced.length) return null as number | null
  let sum = 0
  for (const s of sliced) sum += s.hr
  return sum / sliced.length
}

export const hrAt = (samples: HrSample[], t: number) => {
  if (!Array.isArray(samples) || !samples.length) return null as number | null
  if (!Number.isFinite(t)) return null as number | null

  const i = lowerBoundByTime(samples, t)
  const hit = i < samples.length ? samples[i] : null
  if (hit && hit.t === t) return hit.hr

  const prev = i > 0 ? samples[i - 1] : null
  const next = i < samples.length ? samples[i] : null

  if (prev && next) {
    const dt = next.t - prev.t
    if (!dt) return next.hr
    const ratio = (t - prev.t) / dt
    return prev.hr + ratio * (next.hr - prev.hr)
  }

  const nearestWindowSec = 2
  const candidate = prev || next
  if (candidate && Math.abs(candidate.t - t) <= nearestWindowSec) return candidate.hr
  return null
}

const median = (values: number[]) => {
  if (!values.length) return null as number | null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2) return sorted[mid]
  return (sorted[mid - 1] + sorted[mid]) / 2
}

const linearRegression = (points: Array<{ x: number; y: number }>) => {
  const n = points.length
  if (n < 2) {
    return { slope: null as number | null, intercept: null as number | null, r2: null as number | null }
  }

  let sumX = 0
  let sumY = 0
  let sumXX = 0
  let sumXY = 0
  for (const p of points) {
    sumX += p.x
    sumY += p.y
    sumXX += p.x * p.x
    sumXY += p.x * p.y
  }
  const denom = n * sumXX - sumX * sumX
  if (!denom) {
    return { slope: null as number | null, intercept: null as number | null, r2: null as number | null }
  }
  const slope = (n * sumXY - sumX * sumY) / denom
  const intercept = (sumY - slope * sumX) / n

  const yMean = sumY / n
  let sse = 0
  let sst = 0
  for (const p of points) {
    const yHat = intercept + slope * p.x
    const err = p.y - yHat
    sse += err * err
    const d = p.y - yMean
    sst += d * d
  }
  const r2 = sst ? 1 - sse / sst : null
  return { slope, intercept, r2 }
}

const maxHrWithTime = (samples: HrSample[], t0: number, t1: number) => {
  const sliced = sliceSeries(samples, t0, t1)
  if (!sliced.length) return { hr: null as number | null, t: null as number | null }
  let bestHr = sliced[0].hr
  let bestT = sliced[0].t
  for (const s of sliced) {
    if (s.hr > bestHr) {
      bestHr = s.hr
      bestT = s.t
    }
  }
  return { hr: bestHr, t: bestT }
}

const computeHrEnd = (samples: HrSample[], workStart: number, workEnd: number, endWindowSec: number) => {
  if (workEnd <= workStart) return null as number | null
  const window = Math.max(0, safeInt(endWindowSec))
  const start = Math.max(workStart, workEnd - window)
  const mean = meanHR(samples, start, workEnd)
  if (mean !== null) return mean
  return hrAt(samples, workEnd)
}

const computeHrr = (samples: HrSample[], hrEnd: number | null, restStart: number, restEnd: number, hrrWindowSec: number) => {
  if (hrEnd === null) {
    return { hrr60: null as number | null, hrAtHrr: null as number | null, hrrTimeUsedSec: null as number | null }
  }
  if (restEnd <= restStart) {
    return { hrr60: null as number | null, hrAtHrr: null as number | null, hrrTimeUsedSec: null as number | null }
  }

  const tHrr = Math.min(restStart + 60, restEnd)
  const half = Math.max(0, safeInt(hrrWindowSec)) / 2
  const mean = meanHR(samples, tHrr - half, tHrr + half)
  const hrAtHrr = mean !== null ? mean : hrAt(samples, tHrr)
  const hrr60 = hrAtHrr === null ? null : hrEnd - hrAtHrr
  return { hrr60, hrAtHrr, hrrTimeUsedSec: tHrr - restStart }
}

const computeTauRecovery = (samples: HrSample[], restStart: number, restEnd: number) => {
  const restDuration = restEnd - restStart
  if (restDuration <= 0) {
    return {
      tau_rec: null as number | null,
      tau_fit_r2: null as number | null,
      tau_fit_attempted: false,
      tau_reliable: null as boolean | null
    }
  }

  if (restDuration < 10) {
    return {
      tau_rec: null as number | null,
      tau_fit_r2: null as number | null,
      tau_fit_attempted: false,
      tau_reliable: null as boolean | null
    }
  }

  const restSamples = sliceSeries(samples, restStart, restEnd)
  if (restSamples.length < 6) {
    return {
      tau_rec: null as number | null,
      tau_fit_r2: null as number | null,
      tau_fit_attempted: false,
      tau_reliable: false
    }
  }

  const tailWindowSec = restDuration >= 10 ? 10 : Math.max(1, Math.round(restDuration * 0.2))
  const tailSamples = sliceSeries(samples, restEnd - tailWindowSec, restEnd)
  const hrInf = median(tailSamples.map((s) => s.hr))
  if (hrInf === null) {
    return {
      tau_rec: null as number | null,
      tau_fit_r2: null as number | null,
      tau_fit_attempted: false,
      tau_reliable: false
    }
  }

  const points: Array<{ x: number; y: number }> = []
  for (const s of restSamples) {
    const d = s.hr - hrInf
    if (d <= 1) continue
    points.push({ x: s.t - restStart, y: Math.log(d) })
  }

  if (points.length < 6) {
    return {
      tau_rec: null as number | null,
      tau_fit_r2: null as number | null,
      tau_fit_attempted: true,
      tau_reliable: false
    }
  }

  const fit = linearRegression(points)
  if (fit.slope === null || fit.slope >= 0) {
    return {
      tau_rec: null as number | null,
      tau_fit_r2: fit.r2,
      tau_fit_attempted: true,
      tau_reliable: false
    }
  }

  const tau = -1 / fit.slope
  const tauInRange = tau >= 5 && tau <= 300
  const r2Ok = fit.r2 === null ? true : fit.r2 >= 0.4
  return {
    tau_rec: tauInRange ? tau : null,
    tau_fit_r2: fit.r2,
    tau_fit_attempted: true,
    tau_reliable: tauInRange && r2Ok
  }
}

export const computeHrIntervalMetrics = ({
  samples,
  workIntervals,
  restSeconds,
  config
}: {
  samples: HrSample[]
  workIntervals: WorkInterval[]
  restSeconds: number
  config: HrIntervalMetricsConfig
}) => {
  const rest = Math.max(0, safeInt(restSeconds))
  const peakExtensionSec = Math.max(0, safeInt(config.peakExtensionSec))
  const endWindowSec = Math.max(0, safeInt(config.endWindowSec))
  const hrrWindowSec = Math.max(0, safeInt(config.hrrWindowSec))

  const perRound: HrIntervalRoundMetrics[] = workIntervals.map((w) => {
    const workStart = safeInt(w.start)
    const workEnd = safeInt(w.end)
    const restStart = workEnd
    const restEnd = workEnd + rest

    const maxHr = computeMaxHr(samples, workStart, workEnd)

    const peakWindowEnd = Math.min(restEnd, workEnd + peakExtensionSec)
    const peak = maxHrWithTime(samples, workStart, peakWindowEnd)
    const hr_end = computeHrEnd(samples, workStart, workEnd, endWindowSec)
    const hrr = computeHrr(samples, hr_end, restStart, restEnd, hrrWindowSec)
    const tau = computeTauRecovery(samples, restStart, restEnd)

    return {
      round: w.round,
      workStart,
      workEnd,
      restStart,
      restEnd,
      maxHr,
      hr_peak: peak.hr,
      t_peak: peak.t,
      hr_end,
      hrr60: hrr.hrr60,
      hr_at_hrr: hrr.hrAtHrr,
      hrrTimeUsedSec: hrr.hrrTimeUsedSec,
      tau_rec: tau.tau_rec,
      tau_fit_r2: tau.tau_fit_r2,
      tau_fit_attempted: tau.tau_fit_attempted,
      tau_reliable: tau.tau_reliable
    }
  })

  const buildSlope = (selector: (row: HrIntervalRoundMetrics) => number | null) => {
    const points: Array<{ x: number; y: number }> = []
    for (const row of perRound) {
      const y = selector(row)
      if (y === null) continue
      points.push({ x: row.round - 1, y })
    }
    const fit = linearRegression(points)
    return fit.slope
  }

  const HRR60_slope_per_round = buildSlope((r) => r.hrr60)
  const HR_peak_slope_per_round = buildSlope((r) => r.hr_peak)
  const HR_end_slope_per_round = buildSlope((r) => r.hr_end)
  const recoveryDegrading = (HRR60_slope_per_round ?? 0) < -1.0

  const trends: HrIntervalBlockTrends = {
    HRR60_slope_per_round,
    HR_peak_slope_per_round,
    HR_end_slope_per_round,
    recoveryDegrading
  }

  return { perRound, trends }
}

export const formatSeconds = (seconds: unknown) => {
  const total = safeInt(seconds)
  const sign = total < 0 ? '-' : ''
  const abs = Math.abs(total)
  const mm = Math.floor(abs / 60)
  const ss = abs % 60
  return `${sign}${mm}:${String(ss).padStart(2, '0')}`
}
