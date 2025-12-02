import type { DerivedThresholds, LockoutConfig } from '../pose/repCounter'
import type { HandMode } from '../pose/signals'
import {
  SwingRepCounter,
  SnatchRepCounter,
  type RepCounter
} from '../pose/repCounter'
import type { ExerciseId } from '../stores/session'

export interface ExerciseOption {
  id: ExerciseId
  label: string
  description: string
  handMode: HandMode
  type: 'swing' | 'lockout'
}

export const exerciseOptions: ExerciseOption[] = [
  { id: 'swing', label: 'Swing mode', description: 'Hinge-driven swing', handMode: 'auto', type: 'swing' },
  {
    id: 'lockout',
    label: 'Lockout mode',
    description: 'Overhead lockout (snatch-style count)',
    handMode: 'lockout',
    type: 'lockout'
  }
]

export const getExerciseOption = (id: ExerciseId) =>
  exerciseOptions.find((opt) => opt.id === id) ?? exerciseOptions[0]

export const createCounterForExercise = (
  id: ExerciseId,
  thresholds: { swing: DerivedThresholds; lockout: LockoutConfig }
): RepCounter => {
  const opt = getExerciseOption(id)
  switch (opt.type) {
    case 'swing':
      return new SwingRepCounter(thresholds.swing)
    case 'lockout':
      return new SnatchRepCounter(thresholds.lockout)
    default:
      return new SwingRepCounter(thresholds.swing)
  }
}
