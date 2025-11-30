import type { Keypoint, Pose } from '@tensorflow-models/pose-detection'

export type HandMode = 'left' | 'right' | 'auto' | 'both' | 'highest' | 'lockout'

export interface MotionSignals {
  hipAngle: number
  handHeightHip: number
  handAboveShoulder: number
  handAboveHead: number
  elbowAngle: number
  confidence: number
  handUsed: 'left' | 'right' | 'both'
}

export interface HandSignal {
  side: 'left' | 'right'
  handHeightHip: number
  handAboveShoulder: number
  handAboveHead: number
  elbowAngle: number
  confidence: number
}

export interface FrameSignals {
  hipAngle: number
  confidence: number
  hands: HandSignal[]
}

type NamedKeypoints = Record<string, Keypoint | undefined>

const distance = (a?: Keypoint, b?: Keypoint) => {
  if (!a || !b) return 0
  const dx = a.x - b.x
  const dy = a.y - b.y
  return Math.sqrt(dx * dx + dy * dy)
}

const angleDeg = (a?: Keypoint, b?: Keypoint, c?: Keypoint) => {
  if (!a || !b || !c) return NaN
  const ab = { x: a.x - b.x, y: a.y - b.y }
  const cb = { x: c.x - b.x, y: c.y - b.y }
  const dot = ab.x * cb.x + ab.y * cb.y
  const mag = Math.sqrt((ab.x * ab.x + ab.y * ab.y) * (cb.x * cb.x + cb.y * cb.y))
  if (!mag) return NaN
  const cos = Math.min(1, Math.max(-1, dot / mag))
  return (Math.acos(cos) * 180) / Math.PI
}

const byName = (pose: Pose): NamedKeypoints => {
  const map: NamedKeypoints = {}
  for (const kp of pose.keypoints) {
    if (kp.name) map[kp.name] = kp
  }
  return map
}

export const extractMotionSignals = (
  pose: Pose,
  handMode: HandMode = 'auto',
  forcedHand?: 'left' | 'right' | 'both'
): MotionSignals => {
  const named = byName(pose)
  const leftHip = named['left_hip']
  const rightHip = named['right_hip']
  const leftShoulder = named['left_shoulder']
  const rightShoulder = named['right_shoulder']
  const leftKnee = named['left_knee']
  const rightKnee = named['right_knee']
  const leftWrist = named['left_wrist']
  const rightWrist = named['right_wrist']
  const leftElbow = named['left_elbow']
  const rightElbow = named['right_elbow']
  const nose = named['nose']
  const leftEye = named['left_eye']
  const rightEye = named['right_eye']

  const torsoLeft = distance(leftShoulder, leftHip)
  const torsoRight = distance(rightShoulder, rightHip)
  const torso = Math.max(10, (torsoLeft + torsoRight) / 2) // pixels; avoid divide by zero

  const hips = averagePoint(leftHip, rightHip)
  const shoulders = averagePoint(leftShoulder, rightShoulder)
  const head = averagePoint(nose, averagePoint(leftEye, rightEye))
  const shoulderScore = averageScore(leftShoulder, rightShoulder)
  const hipScore = averageScore(leftHip, rightHip)

  const hipAngleLeft = angleDeg(leftShoulder, leftHip, leftKnee)
  const hipAngleRight = angleDeg(rightShoulder, rightHip, rightKnee)
  const hipAngles = [hipAngleLeft, hipAngleRight].filter((v) => Number.isFinite(v))
  const hipAngle = hipAngles.length ? hipAngles.reduce((a, b) => a + b, 0) / hipAngles.length : NaN

  // hand selection
  const wristChoice = chooseHand({ left: leftWrist, right: rightWrist }, handMode, forcedHand)
  const elbowChoice = chooseHand({ left: leftElbow, right: rightElbow }, handMode, forcedHand ?? wristChoice.handUsed)
  const shoulderChoice = chooseHand({ left: leftShoulder, right: rightShoulder }, handMode, forcedHand ?? wristChoice.handUsed)

  const wrist = wristChoice.kp
  const elbow = elbowChoice.kp
  const shoulder = shoulderChoice.kp

  const wristScore = wrist?.score ?? 0
  const handUsed = forcedHand ?? wristChoice.handUsed

  // Fall back to elbow/shoulder position if wrist is occluded so we still track height.
  const handPoint = wrist ?? elbow ?? shoulder

  const handHeightHip = handPoint && hips ? -(handPoint.y - hips.y) / torso : NaN
  const handAboveShoulder = handPoint && shoulders ? (shoulders.y - handPoint.y) / torso : NaN
  const handAboveHead = handPoint && head ? (head.y - handPoint.y) / torso : NaN

  const elbowAngle = angleDeg(shoulder, elbow, wrist)

  const confidence = Math.min(hipScore, shoulderScore, wristScore)
  return {
    hipAngle,
    handHeightHip,
    handAboveShoulder,
    handAboveHead,
    elbowAngle,
    confidence,
    handUsed
  }
}

export const extractFrameSignals = (pose: Pose): FrameSignals => {
  const named = byName(pose)
  const leftHip = named['left_hip']
  const rightHip = named['right_hip']
  const leftShoulder = named['left_shoulder']
  const rightShoulder = named['right_shoulder']
  const leftKnee = named['left_knee']
  const rightKnee = named['right_knee']
  const leftWrist = named['left_wrist']
  const rightWrist = named['right_wrist']
  const leftElbow = named['left_elbow']
  const rightElbow = named['right_elbow']
  const nose = named['nose']
  const leftEye = named['left_eye']
  const rightEye = named['right_eye']

  const torsoLeft = distance(leftShoulder, leftHip)
  const torsoRight = distance(rightShoulder, rightHip)
  const torso = Math.max(10, (torsoLeft + torsoRight) / 2)

  const hips = averagePoint(leftHip, rightHip)
  const shoulders = averagePoint(leftShoulder, rightShoulder)
  const head = averagePoint(nose, averagePoint(leftEye, rightEye))
  const shoulderScore = averageScore(leftShoulder, rightShoulder)
  const hipScore = averageScore(leftHip, rightHip)

  const hipAngleLeft = angleDeg(leftShoulder, leftHip, leftKnee)
  const hipAngleRight = angleDeg(rightShoulder, rightHip, rightKnee)
  const hipAngles = [hipAngleLeft, hipAngleRight].filter((v) => Number.isFinite(v))
  const hipAngle = hipAngles.length ? hipAngles.reduce((a, b) => a + b, 0) / hipAngles.length : NaN

  const makeHand = (side: 'left' | 'right'): HandSignal => {
    const wrist = side === 'left' ? leftWrist : rightWrist
    const elbow = side === 'left' ? leftElbow : rightElbow
    const shoulder = side === 'left' ? leftShoulder : rightShoulder
    const handPoint = wrist ?? elbow ?? shoulder
    const handHeightHip = handPoint && hips ? -(handPoint.y - hips.y) / torso : NaN
    const handAboveShoulder = handPoint && shoulders ? (shoulders.y - handPoint.y) / torso : NaN
    const handAboveHead = handPoint && head ? (head.y - handPoint.y) / torso : NaN
    let elbowAngle = angleDeg(shoulder, elbow, wrist)
    // If wrist is missing but shoulder+elbow are present, assume extended arm.
    if (!Number.isFinite(elbowAngle) && shoulder && elbow) {
      elbowAngle = 180
    }
    const handScore = Math.max(wrist?.score ?? 0, elbow?.score ?? 0, shoulder?.score ?? 0)
    // Per-hand confidence: be lenient on hips; rely on hand + shoulder visibility.
    const confidence = Math.min(handScore, shoulderScore)
    return { side, handHeightHip, handAboveShoulder, handAboveHead, elbowAngle, confidence }
  }

  const hands: HandSignal[] = [makeHand('left'), makeHand('right')]
  const confidence = Math.min(hipScore, shoulderScore)

  return { hipAngle, confidence, hands }
}

const averagePoint = (a?: Keypoint, b?: Keypoint): Keypoint | undefined => {
  if (!a && !b) return undefined
  if (a && !b) return a
  if (!a && b) return b
  if (!a || !b) return undefined
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    name: '',
    score: ((a.score ?? 0) + (b.score ?? 0)) / 2
  }
}

const averageScore = (a?: Keypoint, b?: Keypoint) => {
  const scores = [a?.score, b?.score].filter((v) => typeof v === 'number') as number[]
  return scores.length ? scores.reduce((p, n) => p + n, 0) / scores.length : 0
}

export const resetHandSelection = () => {
  // no-op placeholder for future sticky reset
}

const chooseHand = (
  kp: { left?: Keypoint; right?: Keypoint },
  mode: HandMode,
  forced?: 'left' | 'right' | 'both'
): { kp?: Keypoint; handUsed: 'left' | 'right' | 'both' } => {
  if (forced === 'both') {
    if (kp.left && kp.right) return { kp: averagePoint(kp.left, kp.right), handUsed: 'both' }
    if (kp.left) return { kp: kp.left, handUsed: 'left' }
    if (kp.right) return { kp: kp.right, handUsed: 'right' }
  }
  if (forced === 'left' || forced === 'right') {
    return { kp: kp[forced], handUsed: forced }
  }
  if (mode === 'left' || mode === 'right') {
    return { kp: kp[mode], handUsed: mode }
  }
  const leftScore = kp.left?.score ?? 0
  const rightScore = kp.right?.score ?? 0

  if (mode === 'both') {
    if (!kp.left || !kp.right)
      return leftScore >= rightScore ? { kp: kp.left, handUsed: 'left' } : { kp: kp.right, handUsed: 'right' }
    return { kp: averagePoint(kp.left, kp.right), handUsed: 'both' }
  }

  if (mode === 'highest') {
    const leftY = kp.left?.y ?? Number.POSITIVE_INFINITY
    const rightY = kp.right?.y ?? Number.POSITIVE_INFINITY
    // lower y means higher on screen
    if (!kp.left && !kp.right) return { kp: undefined, handUsed: 'left' }
    return leftY <= rightY ? { kp: kp.left, handUsed: 'left' } : { kp: kp.right, handUsed: 'right' }
  }

  if (mode === 'lockout') {
    const candidate = leftScore >= rightScore ? 'left' : 'right'
    return { kp: candidate === 'left' ? kp.left : kp.right, handUsed: candidate }
  }

  // auto: pick higher confidence
  return leftScore >= rightScore ? { kp: kp.left, handUsed: 'left' } : { kp: kp.right, handUsed: 'right' }
}
