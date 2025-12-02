import { derived, writable } from 'svelte/store'
import type { DerivedThresholds, LockoutConfig } from '../pose/repCounter'
import { settings } from '$lib/stores/settings'

export type ExerciseId = 'swing' | 'lockout'

export interface PoseStats {
  fps: number
  backend: string
  ready: boolean
  confidence: number
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

export const thresholds = derived<typeof settings, { swing: DerivedThresholds; lockout: LockoutConfig }>(
  settings,
  (value) => ({
    swing: {
      apexHeight: value.counter.swingApexHeight,
      resetHeight: value.counter.swingResetHeight,
      hingeExit: value.counter.swingHingeExit,
      minRepMs: value.counter.swingMinRepMs
    },
    lockout: {
      lowBand: value.counter.lockoutLowBand,
      headThresh: value.counter.lockoutHeadThresh,
      holdMs: value.counter.lockoutHoldMs,
      minRepMs: value.counter.lockoutMinRepMs,
      name: 'lockout'
    }
  })
)
