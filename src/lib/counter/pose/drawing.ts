import type { Keypoint, Pose } from '@tensorflow-models/pose-detection'

const CONNECTORS: Array<[string, string]> = [
  ['left_hip', 'left_knee'],
  ['left_knee', 'left_ankle'],
  ['right_hip', 'right_knee'],
  ['right_knee', 'right_ankle'],
  ['left_shoulder', 'left_elbow'],
  ['left_elbow', 'left_wrist'],
  ['right_shoulder', 'right_elbow'],
  ['right_elbow', 'right_wrist'],
  ['left_shoulder', 'right_shoulder'],
  ['left_hip', 'right_hip'],
  ['left_shoulder', 'left_hip'],
  ['right_shoulder', 'right_hip']
]

export interface DrawOptions {
  color?: string
  lowConfidenceColor?: string
  minScore?: number
}

export const drawPose = (
  ctx: CanvasRenderingContext2D,
  pose: Pose,
  { color = '#22d3ee', lowConfidenceColor = '#f97316', minScore = 0.3 }: DrawOptions = {}
) => {
  ctx.lineWidth = 4
  const named: Record<string, Keypoint> = {}
  for (const kp of pose.keypoints) {
    if (kp.name) named[kp.name] = kp
  }

  CONNECTORS.forEach(([a, b]) => {
    const pa = named[a]
    const pb = named[b]
    if (!pa || !pb) return
    const visible = (pa.score ?? 0) > minScore && (pb.score ?? 0) > minScore
    ctx.strokeStyle = visible ? color : lowConfidenceColor
    ctx.beginPath()
    ctx.moveTo(pa.x, pa.y)
    ctx.lineTo(pb.x, pb.y)
    ctx.stroke()
  })

  for (const kp of pose.keypoints) {
    if (!kp.name) continue
    const visible = (kp.score ?? 0) > minScore
    ctx.fillStyle = visible ? color : lowConfidenceColor
    ctx.beginPath()
    ctx.arc(kp.x, kp.y, 5, 0, Math.PI * 2)
    ctx.fill()
  }
}
