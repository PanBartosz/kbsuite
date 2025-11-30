import type { MotionSignals } from './signals'

export interface Calibration {
  hipAngleMin: number
  hipAngleMax: number
  handHeightMin: number
  handHeightMax: number
}

export interface DerivedThresholds {
  apexHeight: number
  resetHeight: number
  hingeExit: number
  minRepMs: number
}

export const defaultCalibration = (): Calibration => ({
  hipAngleMin: 95, // deepest hinge angle observed
  hipAngleMax: 175, // upright hip angle
  handHeightMin: 0.05, // hands near hips (normalized)
  handHeightMax: 1.6 // hands overhead (normalized to torso length)
})

export const thresholdsFromCalibration = (cal: Calibration): DerivedThresholds => {
  const hipRange = Math.max(10, cal.hipAngleMax - cal.hipAngleMin)
  const handRange = Math.max(0.3, cal.handHeightMax - cal.handHeightMin)

  return {
    apexHeight: cal.handHeightMin + handRange * 0.8, // count when hands reach 80% of observed apex
    resetHeight: cal.handHeightMin + handRange * 0.35, // re-arm when hands drop below this
    hingeExit: cal.hipAngleMin + hipRange * 0.65, // consider “stood up” when past this angle
    minRepMs: 400
  }
}

export const calibrationFromSamples = (samples: MotionSignals[], fallback = defaultCalibration()): Calibration => {
  if (!samples.length) return fallback
  const hipAngles = samples.map((s) => s.hipAngle).filter((v) => Number.isFinite(v))
  const handHeights = samples.map((s) => s.handHeightHip).filter((v) => Number.isFinite(v))
  if (!hipAngles.length || !handHeights.length) return fallback

  return {
    hipAngleMin: Math.min(...hipAngles),
    hipAngleMax: Math.max(...hipAngles),
    handHeightMin: Math.min(...handHeights),
    handHeightMax: Math.max(...handHeights)
  }
}
