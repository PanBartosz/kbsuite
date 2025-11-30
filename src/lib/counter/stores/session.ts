import { derived, writable } from 'svelte/store'
import type { Calibration, DerivedThresholds } from '../pose/calibration'
import { defaultCalibration, thresholdsFromCalibration } from '../pose/calibration'

export type ExerciseId = 'swing' | 'lockout'

export interface PoseStats {
  fps: number
  backend: string
  ready: boolean
  confidence: number
}

const loadCalibration = (): Calibration => {
  if (typeof localStorage === 'undefined') return defaultCalibration()
  try {
    const raw = localStorage.getItem('gs-calibration')
    if (!raw) return defaultCalibration()
    const parsed = JSON.parse(raw) as Calibration
    if (!parsed) return defaultCalibration()
    return {
      hipAngleMin: parsed.hipAngleMin ?? defaultCalibration().hipAngleMin,
      hipAngleMax: parsed.hipAngleMax ?? defaultCalibration().hipAngleMax,
      handHeightMin: parsed.handHeightMin ?? defaultCalibration().handHeightMin,
      handHeightMax: parsed.handHeightMax ?? defaultCalibration().handHeightMax
    }
  } catch (err) {
    console.warn('Failed to load calibration', err)
    return defaultCalibration()
  }
}

const persistCalibration = (value: Calibration) => {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem('gs-calibration', JSON.stringify(value))
}

export const exercise = writable<ExerciseId>('swing')
export const repCount = writable(0)
export const runState = writable<'idle' | 'running' | 'paused'>('idle')
export const feedback = writable<string | null>(null)
export const poseStats = writable<PoseStats>({
  fps: 0,
  backend: '',
  ready: false,
  confidence: 0
})

const calibrationStore = writable<Calibration>(loadCalibration())
calibrationStore.subscribe((value) => persistCalibration(value))
export const calibration = calibrationStore

export const thresholds = derived<typeof calibrationStore, DerivedThresholds>(calibrationStore, (value) =>
  thresholdsFromCalibration(value)
)

export const setCalibration = (value: Calibration) => calibrationStore.set(value)
