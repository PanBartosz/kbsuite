import type { DerivedThresholds } from './calibration'
import type { FrameSignals, HandSignal } from './signals'

export type GestureId = 'reset' | 'swing_mode' | 'lockout_mode'

export interface GestureEvent {
  id: GestureId
  ts: number
}

type HoldState = {
  holdStart: number | null
  lastTrigger: number
}

type GestureCheck = (frame: FrameSignals, thresholds: DerivedThresholds, velocities: Record<'left' | 'right', number>) => boolean

interface GestureConfig {
  id: GestureId
  holdMs: number
  cooldownMs: number
  check: GestureCheck
}

const MIN_CONF = 0.25
const MAX_VEL = 0.006 // torso-normalized units per ms

export class GestureEngine {
  private gestures: Record<GestureId, { config: GestureConfig; state: HoldState }> = {
    reset: {
      config: {
        id: 'reset',
        holdMs: 900,
        cooldownMs: 2000,
        check: this.isTPoseReset
      },
      state: { holdStart: null, lastTrigger: 0 }
    },
    swing_mode: {
      config: {
        id: 'swing_mode',
        holdMs: 1000,
        cooldownMs: 2000,
        check: this.isSwingPark
      },
      state: { holdStart: null, lastTrigger: 0 }
    },
    lockout_mode: {
      config: {
        id: 'lockout_mode',
        holdMs: 1000,
        cooldownMs: 2000,
        check: this.isLockoutHold
      },
      state: { holdStart: null, lastTrigger: 0 }
    }
  }

  private lastHeights: Record<'left' | 'right', number | null> = { left: null, right: null }
  private lastTs: number | null = null

  reset() {
    for (const key of Object.keys(this.gestures) as GestureId[]) {
      this.gestures[key].state = { holdStart: null, lastTrigger: 0 }
    }
    this.lastHeights = { left: null, right: null }
    this.lastTs = null
  }

  update(frame: FrameSignals, thresholds: DerivedThresholds, now = Date.now()): GestureEvent[] {
    if (!Number.isFinite(frame.hipAngle) || frame.confidence < MIN_CONF) {
      this.updateHistory(frame, now)
      return []
    }

    const velocities = this.computeVelocities(frame, now)
    const events: GestureEvent[] = []

    for (const key of Object.keys(this.gestures) as GestureId[]) {
      const { config, state } = this.gestures[key]
      if (now - state.lastTrigger < config.cooldownMs) {
        continue
      }

      const active = config.check(frame, thresholds, velocities)
      if (!active) {
        state.holdStart = null
        continue
      }

      if (state.holdStart === null) {
        state.holdStart = now
      }

      if (now - state.holdStart >= config.holdMs) {
        events.push({ id: config.id, ts: now })
        state.lastTrigger = now
        state.holdStart = null
      }
    }

    this.updateHistory(frame, now)
    return events
  }

  private updateHistory(frame: FrameSignals, now: number) {
    for (const hand of frame.hands) {
      if (!Number.isFinite(hand.handHeightHip)) continue
      this.lastHeights[hand.side] = hand.handHeightHip
    }
    this.lastTs = now
  }

  private computeVelocities(frame: FrameSignals, now: number): Record<'left' | 'right', number> {
    const velocities: Record<'left' | 'right', number> = { left: 0, right: 0 }
    if (this.lastTs === null) return velocities
    const dt = now - this.lastTs
    if (dt <= 0) return velocities
    for (const hand of frame.hands) {
      const prev = this.lastHeights[hand.side]
      if (!Number.isFinite(hand.handHeightHip) || prev === null || Number.isNaN(prev)) continue
      velocities[hand.side] = Math.abs(hand.handHeightHip - prev) / dt
    }
    return velocities
  }

  // Detect a T-pose style reset: both hands at shoulder height, elbows extended, upright, and stable.
  private isTPoseReset(frame: FrameSignals, thresholds: DerivedThresholds, velocities: Record<'left' | 'right', number>): boolean {
    if (frame.hands.length < 2) return false
    const upright = frame.hipAngle > thresholds.hingeExit - 12

    const handsOk = frame.hands.every((hand) => {
      if (hand.confidence < MIN_CONF) return false
      if (!Number.isFinite(hand.handAboveShoulder) || !Number.isFinite(hand.handAboveHead) || !Number.isFinite(hand.elbowAngle))
        return false
      const shoulderBand = hand.handAboveShoulder > -0.16 && hand.handAboveShoulder < 0.16
      const belowHead = hand.handAboveHead < 0.08
      const extended = hand.elbowAngle > 150
      const slow = velocities[hand.side] <= MAX_VEL
      return shoulderBand && belowHead && extended && slow
    })

    return upright && handsOk
  }

  // Detect hands parked low with a hinge: both hands well below hips, slow, and torso flexed.
  private isSwingPark(frame: FrameSignals, thresholds: DerivedThresholds, velocities: Record<'left' | 'right', number>): boolean {
    if (frame.hands.length < 2) return false
    const hinged = frame.hipAngle < thresholds.hingeExit - 15
    const handsOk = frame.hands.every((hand) => {
      if (hand.confidence < MIN_CONF) return false
      if (!Number.isFinite(hand.handHeightHip) || !Number.isFinite(hand.elbowAngle)) return false
      const low = hand.handHeightHip < -0.35
      const relaxedElbow = hand.elbowAngle > 140
      const slow = velocities[hand.side] <= MAX_VEL
      return low && relaxedElbow && slow
    })
    return hinged && handsOk
  }

  // Detect overhead lockout hold: both hands above head, elbows extended, upright, and stable.
  private isLockoutHold(frame: FrameSignals, thresholds: DerivedThresholds, velocities: Record<'left' | 'right', number>): boolean {
    if (frame.hands.length < 2) return false
    const upright = frame.hipAngle > thresholds.hingeExit - 5
    const handsOk = frame.hands.every((hand) => {
      if (hand.confidence < MIN_CONF) return false
      if (!Number.isFinite(hand.handAboveHead) || !Number.isFinite(hand.elbowAngle)) return false
      const overhead = hand.handAboveHead > 0.45
      const extended = hand.elbowAngle > 150
      const slow = velocities[hand.side] <= MAX_VEL
      return overhead && extended && slow
    })
    return upright && handsOk
  }
}
