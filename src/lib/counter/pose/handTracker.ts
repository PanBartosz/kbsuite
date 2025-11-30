import type { Keypoint, Pose } from '@tensorflow-models/pose-detection'
import type { HandMode } from './signals'

type Side = 'left' | 'right'

interface HandScores {
  left: number
  right: number
}

export interface HandSelection {
  active: 'left' | 'right' | 'both' | null
  scores: HandScores
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v))

const scoreSide = (named: Record<string, Keypoint | undefined>, side: Side, heightBias: number): number => {
  const wrist = named[`${side}_wrist`]
  const elbow = named[`${side}_elbow`]
  const shoulder = named[`${side}_shoulder`]
  const parts = [
    { kp: wrist, weight: 1 },
    { kp: elbow, weight: 0.75 },
    { kp: shoulder, weight: 0.6 }
  ]
  let total = 0
  let weights = 0
  for (const part of parts) {
    if (typeof part.kp?.score === 'number') {
      total += part.kp.score * part.weight
      weights += part.weight
    }
  }
  const base = weights ? total / weights : 0

  // Small bias: if the hand is above the shoulder, it is likely the working side.
  const shoulderY = shoulder?.y
  const handY = wrist?.y ?? elbow?.y ?? shoulder?.y
  const bias = shoulderY !== undefined && handY !== undefined && handY < shoulderY ? heightBias : 0

  return clamp01(base + bias)
}

interface TrackerConfig {
  enter: number
  exit: number
  switchHold: number
  lockoutSwitchHold: number
  switchLead: number
  lockoutSwitchLead: number
  dropHold: number
  restHold: number
  restThresh: number
  stickFrames: number
  heightBias: number
}

const DEFAULT_CFG: TrackerConfig = {
  enter: 0.45,
  exit: 0.25,
  switchHold: 6,
  lockoutSwitchHold: 12,
  switchLead: 0.07,
  lockoutSwitchLead: 0.14,
  dropHold: 10,
  restHold: 24,
  restThresh: 0.2,
  stickFrames: 20,
  heightBias: 0.12
}

export class HandTracker {
  private active: 'left' | 'right' | null = null
  private otherHighFrames = 0
  private bothLowFrames = 0
  private restFrames = 0
  private stickFramesLeft = 0

  constructor(private cfg: TrackerConfig = DEFAULT_CFG) {}

  reset() {
    this.active = null
    this.otherHighFrames = 0
    this.bothLowFrames = 0
    this.restFrames = 0
    this.stickFramesLeft = 0
  }

  update(pose: Pose, mode: HandMode, locked?: 'left' | 'right' | 'both' | null): HandSelection {
    const named: Record<string, Keypoint | undefined> = {}
    for (const kp of pose.keypoints) {
      if (kp.name) named[kp.name] = kp
    }

    const scores: HandScores = {
      left: scoreSide(named, 'left', this.cfg.heightBias),
      right: scoreSide(named, 'right', this.cfg.heightBias)
    }

    // Two-arm modes just use both hands.
    if (mode === 'both' || locked === 'both') {
      this.reset()
      return { active: 'both', scores }
    }

    const best: Side = scores.left >= scores.right ? 'left' : 'right'
    const bestScore = scores[best]

    // Honor external lock if provided.
    if (locked === 'left' || locked === 'right') {
      this.active = locked
      this.stickFramesLeft = this.cfg.stickFrames
    }

    // Acquire if none selected.
    if (!this.active && bestScore >= this.cfg.enter) {
      this.active = best
      this.stickFramesLeft = this.cfg.stickFrames
    }

    if (this.active) {
      const current = this.active
      const other: Side = current === 'left' ? 'right' : 'left'

      if (this.stickFramesLeft > 0) {
        this.stickFramesLeft -= 1
      }

      // Consider switching if the other side is consistently stronger.
      if (this.active && this.stickFramesLeft === 0) {
        const aheadBy = scores[other] - scores[current]
        const switchHold = mode === 'lockout' ? this.cfg.lockoutSwitchHold : this.cfg.switchHold
        const switchLead = mode === 'lockout' ? this.cfg.lockoutSwitchLead : this.cfg.switchLead
        if (aheadBy > switchLead && scores[other] >= this.cfg.enter) {
          this.otherHighFrames += 1
          if (this.otherHighFrames >= switchHold) {
            this.active = other
            this.otherHighFrames = 0
            this.bothLowFrames = 0
            this.stickFramesLeft = this.cfg.stickFrames
          }
        } else {
          this.otherHighFrames = 0
        }
      }
    }

    // Drop to neutral only if both hands stay low (resting/out of view).
    if (scores.left < this.cfg.exit && scores.right < this.cfg.exit) {
      this.bothLowFrames += 1
      if (this.bothLowFrames >= this.cfg.dropHold) {
        this.active = null
        this.otherHighFrames = 0
        this.stickFramesLeft = 0
      }
    } else {
      this.bothLowFrames = 0
    }

    // Re-acquire if we dropped active.
    if (!this.active && bestScore >= this.cfg.enter) {
      this.active = best
      this.stickFramesLeft = this.cfg.stickFrames
    }

    // Release during rest when nothing is visible for a while.
    if (scores.left < this.cfg.restThresh && scores.right < this.cfg.restThresh) {
      this.restFrames += 1
      if (this.restFrames >= this.cfg.restHold) {
        this.reset()
      }
    } else {
      this.restFrames = 0
    }

    return { active: this.active, scores }
  }
}
