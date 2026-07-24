import { GROUP_EXIT_FLICK_REVERSAL_SPEED } from './groups'

export interface FlickGestureTracker {
  reset: (x: number, y: number, time?: number) => void
  track: (x: number, y: number, time?: number) => void
  readonly count: number
}

/** 仅统计快速来回甩动（方向反转），普通单向拖动不计入。 */
export function createFlickGestureTracker(): FlickGestureTracker {
  let lastMove = { x: 0, y: 0, t: 0 }
  let lastVelocity = { x: 0, y: 0 }
  let flickCount = 0
  let lastFlickAt = 0
  let lastAxisSign = 0

  function registerFlick(time: number): void {
    if (time - lastFlickAt < 55) return
    flickCount += 1
    lastFlickAt = time
  }

  return {
    reset(x, y, time = performance.now()) {
      lastMove = { x, y, t: time }
      lastVelocity = { x: 0, y: 0 }
      flickCount = 0
      lastFlickAt = 0
      lastAxisSign = 0
    },
    track(x, y, time = performance.now()) {
      const dt = (time - lastMove.t) / 1000
      if (dt <= 0 || dt > 0.24) {
        lastMove = { x, y, t: time }
        lastVelocity = { x: 0, y: 0 }
        lastAxisSign = 0
        return
      }

      const vx = (x - lastMove.x) / dt
      const vy = (y - lastMove.y) / dt
      const speed = Math.hypot(vx, vy)
      const lastSpeed = Math.hypot(lastVelocity.x, lastVelocity.y)
      const useX = Math.abs(vx) >= Math.abs(vy)
      const axisVelocity = useX ? vx : vy
      const axisSign =
        Math.abs(axisVelocity) < GROUP_EXIT_FLICK_REVERSAL_SPEED * 0.28
          ? 0
          : Math.sign(axisVelocity)

      const minReversal = GROUP_EXIT_FLICK_REVERSAL_SPEED
      const softReversal = GROUP_EXIT_FLICK_REVERSAL_SPEED * 0.55

      const directionReversed =
        axisSign !== 0 &&
        lastAxisSign !== 0 &&
        axisSign !== lastAxisSign &&
        speed >= softReversal &&
        lastSpeed >= softReversal

      const vectorReversed =
        speed >= minReversal &&
        lastSpeed >= softReversal &&
        vx * lastVelocity.x + vy * lastVelocity.y < 0

      if (directionReversed || vectorReversed) {
        registerFlick(time)
      }

      if (axisSign !== 0) lastAxisSign = axisSign
      lastMove = { x, y, t: time }
      lastVelocity = { x: vx, y: vy }
    },
    get count() {
      return flickCount
    }
  }
}
