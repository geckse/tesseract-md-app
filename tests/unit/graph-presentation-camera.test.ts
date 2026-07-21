import { describe, expect, it } from 'vitest'

import {
  GraphPresentationCameraController,
  type GraphPresentationCameraPose
} from '@renderer/lib/graph-presentation-camera'

const from: GraphPresentationCameraPose = {
  position: { x: 0, y: 10, z: 20 },
  target: { x: 0, y: 0, z: 0 }
}
const to: GraphPresentationCameraPose = {
  position: { x: 100, y: 30, z: 60 },
  target: { x: 20, y: 10, z: 0 }
}

describe('GraphPresentationCameraController', () => {
  it('advances an automatic presentation camera with quadratic-out easing', () => {
    const camera = new GraphPresentationCameraController()
    camera.begin()

    expect(camera.beginAutoMotion(from, to, 1_000, 1_000)).toBe(true)
    expect(camera.advance(1_500)).toEqual({
      position: { x: 75, y: 25, z: 50 },
      target: { x: 15, y: 7.5, z: 0 },
      complete: false
    })
    expect(camera.advance(2_000)).toEqual({ ...to, complete: true })
    expect(camera.advance(2_001)).toBeNull()
  })

  it('cancels an in-flight motion and rejects later auto-framing after manual control', () => {
    const camera = new GraphPresentationCameraController()
    camera.begin()
    camera.beginAutoMotion(from, to, 0, 1_000)
    expect(camera.advance(250)).not.toBeNull()

    expect(camera.takeManualControl()).toBe(true)
    expect(camera.shouldAutoFrame).toBe(false)
    expect(camera.advance(500)).toBeNull()
    expect(camera.beginAutoMotion(from, to, 500, 1_000)).toBe(false)
    expect(camera.advance(750)).toBeNull()
    expect(camera.takeManualControl()).toBe(false)
  })

  it('preserves auto-follow when merely paused and resets ownership for a new presentation', () => {
    const camera = new GraphPresentationCameraController()
    camera.begin()
    camera.beginAutoMotion(from, to, 0, 1_000)
    camera.cancelMotion()

    expect(camera.shouldAutoFrame).toBe(true)
    expect(camera.advance(500)).toBeNull()

    camera.takeManualControl()
    camera.finish()
    expect(camera.shouldAutoFrame).toBe(false)

    camera.begin()
    expect(camera.shouldAutoFrame).toBe(true)
    expect(camera.beginAutoMotion(from, to, 0, 0)).toBe(true)
    expect(camera.advance(0)).toEqual({ ...to, complete: true })
  })
})
