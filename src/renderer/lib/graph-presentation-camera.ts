export interface GraphPresentationCameraPoint {
  x: number
  y: number
  z: number
}

export interface GraphPresentationCameraPose {
  position: GraphPresentationCameraPoint
  target: GraphPresentationCameraPoint
}

export interface GraphPresentationCameraFrame extends GraphPresentationCameraPose {
  complete: boolean
}

interface GraphPresentationCameraMotion {
  from: GraphPresentationCameraPose
  to: GraphPresentationCameraPose
  startedAt: number
  durationMs: number
}

type GraphPresentationCameraMode = 'idle' | 'automatic' | 'manual'

function copyPoint(point: GraphPresentationCameraPoint): GraphPresentationCameraPoint {
  return { x: point.x, y: point.y, z: point.z }
}

function copyPose(pose: GraphPresentationCameraPose): GraphPresentationCameraPose {
  return {
    position: copyPoint(pose.position),
    target: copyPoint(pose.target)
  }
}

function interpolatePoint(
  from: GraphPresentationCameraPoint,
  to: GraphPresentationCameraPoint,
  progress: number
): GraphPresentationCameraPoint {
  return {
    x: from.x + (to.x - from.x) * progress,
    y: from.y + (to.y - from.y) * progress,
    z: from.z + (to.z - from.z) * progress
  }
}

/**
 * Cancellable camera ownership for presentation mode. Presentation camera
 * moves are kept out of three-render-objects' private tween group so user
 * input can stop them immediately without stopping node playback.
 */
export class GraphPresentationCameraController {
  private mode: GraphPresentationCameraMode = 'idle'
  private motion: GraphPresentationCameraMotion | null = null

  get shouldAutoFrame(): boolean {
    return this.mode === 'automatic'
  }

  begin(): void {
    this.mode = 'automatic'
    this.motion = null
  }

  finish(): void {
    this.mode = 'idle'
    this.motion = null
  }

  /** Returns true only when this interaction newly claims an automatic camera. */
  takeManualControl(): boolean {
    if (this.mode !== 'automatic') return false
    this.mode = 'manual'
    this.motion = null
    return true
  }

  cancelMotion(): void {
    this.motion = null
  }

  beginAutoMotion(
    from: GraphPresentationCameraPose,
    to: GraphPresentationCameraPose,
    startedAt: number,
    durationMs: number
  ): boolean {
    if (this.mode !== 'automatic') return false
    this.motion = {
      from: copyPose(from),
      to: copyPose(to),
      startedAt,
      durationMs: Math.max(0, durationMs)
    }
    return true
  }

  advance(timestamp: number): GraphPresentationCameraFrame | null {
    if (this.mode !== 'automatic' || !this.motion) return null
    const motion = this.motion
    const progress =
      motion.durationMs === 0
        ? 1
        : Math.min(1, Math.max(0, (timestamp - motion.startedAt) / motion.durationMs))
    // Match the quadratic-out easing used by three-render-objects.
    const eased = progress * (2 - progress)
    const frame: GraphPresentationCameraFrame = {
      position: interpolatePoint(motion.from.position, motion.to.position, eased),
      target: interpolatePoint(motion.from.target, motion.to.target, eased),
      complete: progress >= 1
    }
    if (frame.complete) this.motion = null
    return frame
  }
}
