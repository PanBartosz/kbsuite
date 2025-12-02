import type { FrameSignals, HandSignal } from './signals'

export interface DerivedThresholds {
  apexHeight: number
  resetHeight: number
  hingeExit: number
  minRepMs: number
}

const EMA_ALPHA = 0.35
const MIN_CONF = 0.25
const VEL_ENTER = 0.004
const RESET_FRAMES = 4
const SWING_HINGE_RESET = 150
const SWING_RESET_FRAMES = 3
const SWING_ACTIVE_TIMEOUT_MS = 1500
const SWING_IDLE_VEL = 0.0005

const smooth = (prev: number | null, next: number) =>
  prev === null || Number.isNaN(prev) ? next : prev * (1 - EMA_ALPHA) + next * EMA_ALPHA

const pickBestHand = (hands: HandSignal[]) => {
  if (!hands.length) return null
  const finite = hands.filter((h) => Number.isFinite(h.handHeightHip))
  if (finite.length) {
    return finite.reduce((best, h) => (h.handHeightHip > best.handHeightHip ? h : best), finite[0])
  }
  return hands.reduce((best, h) => (h.confidence > best.confidence ? h : best), hands[0])
}

export interface CounterUpdate {
  count: number
  state: string
  feedback?: string
}

export interface RepCounter {
  reset(): void
  update(signals: FrameSignals, now?: number): CounterUpdate | null
  getActiveHand?(): 'left' | 'right' | 'both' | null
}

// --- Swing ------------------------------------------------------------------

export class SwingRepCounter implements RepCounter {
  private state = {
    count: 0,
    phase: 'backswing' as 'backswing' | 'upswing' | 'top',
    lastRepTs: Date.now(),
    hipAngle: null as number | null,
    handHeights: { left: null as number | null, right: null as number | null },
    activeHand: null as 'left' | 'right' | null,
    resetFrames: { left: 0, right: 0 },
    ready: { left: true, right: true },
    readyFrames: { left: 0, right: 0 }
  }

  constructor(private thresholds: DerivedThresholds) {}

  reset() {
    this.state = {
      count: 0,
      phase: 'backswing',
      lastRepTs: Date.now(),
      hipAngle: null,
      handHeights: { left: null, right: null },
      activeHand: null,
      resetFrames: { left: 0, right: 0 },
      ready: { left: true, right: true },
      readyFrames: { left: 0, right: 0 }
    }
  }

  update(frame: FrameSignals, now = Date.now()): CounterUpdate | null {
    if (!Number.isFinite(frame.hipAngle)) return null
    if (frame.confidence < MIN_CONF) return null
    const hipAngle = smooth(this.state.hipAngle, frame.hipAngle) ?? frame.hipAngle
    let { count, phase, lastRepTs, activeHand, resetFrames, ready, readyFrames } = this.state
    let feedback: string | undefined

    const apexBand = this.thresholds.apexHeight - 0.1
    const stoodUp = hipAngle > this.thresholds.hingeExit - 10
    const bottomBand = 0.1
    const resetBand = Math.max(bottomBand, this.thresholds.resetHeight ?? bottomBand)

    const newHeights: Record<'left' | 'right', number | null> = { left: this.state.handHeights.left, right: this.state.handHeights.right }

    for (const hand of frame.hands) {
      if (!Number.isFinite(hand.handHeightHip)) continue
      const side = hand.side
      const prev = this.state.handHeights[side] ?? hand.handHeightHip
      const smoothed = smooth(this.state.handHeights[side], hand.handHeightHip) ?? hand.handHeightHip
      newHeights[side] = smoothed

      const crossedApex = prev < apexBand && smoothed >= apexBand
      const velocity = smoothed - prev

      // track readiness per hand
      if (smoothed < resetBand) {
        readyFrames[side] = readyFrames[side] + 1
        if (readyFrames[side] >= SWING_RESET_FRAMES) ready[side] = true
      } else {
        readyFrames[side] = 0
      }

      const movingUp = velocity > VEL_ENTER
      const canCount =
        ready[side] &&
        crossedApex &&
        movingUp &&
        stoodUp &&
        hand.confidence > MIN_CONF &&
        now - lastRepTs > this.thresholds.minRepMs

      const activeStale = activeHand !== null && now - lastRepTs > SWING_ACTIVE_TIMEOUT_MS

      if (activeHand === null || (activeStale && side !== activeHand)) {
        if (canCount) {
          count += 1
          lastRepTs = now
          feedback = 'Rep counted'
          phase = 'top'
          activeHand = side
          ready[side] = false
          readyFrames[side] = 0
        } else if (smoothed < bottomBand) {
          phase = 'backswing'
        } else if (smoothed >= bottomBand) {
          phase = 'upswing'
        }
      } else if (side === activeHand) {
        // active hand already set; wait for it to drop or time out
        const handReset = smoothed < bottomBand || smoothed < resetBand
        const hingeReset = hipAngle < SWING_HINGE_RESET
        const idle = Math.abs(velocity) < SWING_IDLE_VEL && activeStale
        if (handReset || hingeReset || idle) {
          resetFrames[side] += 1
          if (resetFrames[side] >= SWING_RESET_FRAMES) {
            activeHand = null
            phase = 'backswing'
            resetFrames[side] = 0
            ready[side] = smoothed < resetBand
          }
        } else {
          resetFrames[side] = 0
          phase = 'top'
        }
      }
    }

    this.state = { count, phase, lastRepTs, hipAngle, handHeights: newHeights, activeHand, resetFrames, ready, readyFrames }
    return { count, state: phase, feedback }
  }

  getActiveHand() {
    return null
  }
}

// --- Lockout-based patterns (snatch, half snatch, long cycle) ---------------

export interface LockoutConfig {
  lowBand: number
  headThresh: number
  holdMs: number
  minRepMs: number
  name: string
}

interface LockoutState {
  phase: 'ready' | 'lockout' | 'counted'
  count: number
  lastRepTs: number
  lockoutStart: Record<'left' | 'right', number>
  prevHeight: Record<'left' | 'right', number | null>
  resetFrames: Record<'left' | 'right', number>
  activeHand: 'left' | 'right' | null
}

abstract class LockoutRepCounter implements RepCounter {
  protected state: LockoutState = {
    phase: 'ready',
    count: 0,
    lastRepTs: Date.now(),
    lockoutStart: { left: 0, right: 0 },
    prevHeight: { left: null, right: null },
    resetFrames: { left: 0, right: 0 },
    activeHand: null
  }

  constructor(protected config: LockoutConfig) {}

  reset() {
    this.state = {
      phase: 'ready',
      count: 0,
      lastRepTs: Date.now(),
      lockoutStart: { left: 0, right: 0 },
      prevHeight: { left: null, right: null },
      resetFrames: { left: 0, right: 0 },
      activeHand: null
    }
  }

  getActiveHand() {
    return this.state.activeHand
  }

  update(frame: FrameSignals, now = Date.now()): CounterUpdate | null {
    if (!Number.isFinite(frame.hipAngle) || frame.confidence < MIN_CONF) return null
    let { phase, count, lastRepTs, lockoutStart, prevHeight, resetFrames, activeHand } = this.state
    let feedback: string | undefined

    const hands = frame.hands.filter((h) => Number.isFinite(h.handHeightHip) && Number.isFinite(h.elbowAngle))

    // Evaluate lockout per side
    for (const hand of hands) {
      const side = hand.side
      const prev = prevHeight[side] ?? hand.handHeightHip
      const velocity = hand.handHeightHip - prev
      prevHeight[side] = hand.handHeightHip

      const low = this.isLow(hand)
      const lockout = this.isLockout(hand, frame.hipAngle)

      if (activeHand === null) {
        if (lockout && hand.confidence > MIN_CONF) {
          if (!lockoutStart[side]) lockoutStart[side] = now
          if (now - lockoutStart[side] > this.config.holdMs && now - lastRepTs > this.config.minRepMs) {
            count += 1
            lastRepTs = now
            feedback = 'Rep counted'
            phase = 'counted'
            activeHand = side
            lockoutStart[side] = 0
          } else {
            phase = 'lockout'
          }
        } else {
          lockoutStart[side] = 0
        }
      } else {
        // active hand is set; wait for its backswing reset
        if (side === activeHand) {
          if (low) {
            resetFrames[side] += 1
            if (resetFrames[side] >= RESET_FRAMES) {
              activeHand = null
              phase = 'ready'
              resetFrames[side] = 0
            }
          } else {
            resetFrames[side] = 0
          }
        }
        // Ignore lockouts from the non-active hand until reset.
      }
    }

    this.state = { phase, count, lastRepTs, lockoutStart, prevHeight, resetFrames, activeHand }
    return { count, state: phase, feedback }
  }

  protected isLow(hand: HandSignal) {
    return hand.handAboveShoulder < this.config.lowBand
  }

  protected isLockout(hand: HandSignal, hipAngle: number) {
    return hand.handAboveHead > this.config.headThresh
  }
}

export class SnatchRepCounter extends LockoutRepCounter {
  constructor(config?: Partial<LockoutConfig>) {
    super({
      lowBand: 0.28,
      headThresh: 0.5,
      holdMs: 100,
      minRepMs: 400,
      name: 'snatch',
      ...config
    })
  }
}

export class HalfSnatchRepCounter extends LockoutRepCounter {
  constructor() {
    super({
      lowBand: 0.25,
      headThresh: 0.5,
      holdMs: 100,
      minRepMs: 400,
      name: 'half-snatch'
    })
  }
}

export class LongCycleRepCounter extends LockoutRepCounter {
  constructor() {
    super({
      lowBand: 0.3,
      headThresh: 0.5,
      holdMs: 100,
      minRepMs: 500,
      name: 'long-cycle'
    })
  }
}

// --- Jerk -------------------------------------------------------------------

export class JerkRepCounter extends LockoutRepCounter {
  constructor() {
    super({
      lowBand: 0.15, // rack/drop band (hand near shoulder)
      headThresh: 0.5,
      holdMs: 100,
      minRepMs: 400,
      name: 'jerk'
    })
  }

  // For jerks, we re-arm on a rack-like position: hand in shoulder band with a bent elbow.
  protected override isLow(hand: HandSignal) {
    return hand.handAboveShoulder > 0.05 && hand.handAboveShoulder < 0.9
  }
}
