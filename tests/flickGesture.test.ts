import { describe, expect, it } from 'vitest'
import { createFlickGestureTracker } from '../src/shared/graph/flickGesture'
import { GROUP_EXIT_FLICK_MIN_COUNT } from '../src/shared/graph/groups'

describe('flick gesture tracker', () => {
  it('ignores steady one-direction drags', () => {
    const tracker = createFlickGestureTracker()
    let t = 1000
    tracker.reset(0, 0, t)

    for (let step = 1; step <= 24; step += 1) {
      t += 16
      tracker.track(step * 18, 0, t)
    }

    expect(tracker.count).toBe(0)
  })

  it('counts rapid direction reversals', () => {
    const tracker = createFlickGestureTracker()
    let t = 1000
    tracker.reset(0, 0, t)

    const shakes = [
      [40, 0],
      [-40, 0],
      [40, 0],
      [-40, 0]
    ]

    for (const [x, y] of shakes) {
      t += 45
      tracker.track(x, y, t)
    }

    expect(tracker.count).toBeGreaterThanOrEqual(GROUP_EXIT_FLICK_MIN_COUNT)
  })

  it('does not count a single fast throw as enough flicks', () => {
    const tracker = createFlickGestureTracker()
    const t = 2000
    tracker.reset(0, 0, t)
    tracker.track(180, 0, t + 30)
    tracker.track(360, 0, t + 45)
    expect(tracker.count).toBeLessThan(GROUP_EXIT_FLICK_MIN_COUNT)
  })
})
