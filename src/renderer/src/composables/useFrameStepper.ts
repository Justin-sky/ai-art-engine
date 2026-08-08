import { computed, ref, type Ref } from 'vue'

/**
 * 逐帧拉片核心：按真实帧率前后步进、跳帧、取帧。
 * 帧率用 requestVideoFrameCallback 在真实播放中实测（连续出帧的 mediaTime 间隔），
 * 不支持时回退到默认 30fps。
 */

export interface VideoFrameCallbackMeta {
  mediaTime: number
  presentationTime: number
  expectedDisplayTime: number
  width: number
  height: number
}

type RvfcVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (
    callback: (now: number, meta: VideoFrameCallbackMeta) => void
  ) => number
  cancelVideoFrameCallback?: (handle: number) => void
}

export interface FrameStepper {
  /** 实测/回退帧率 */
  fps: Ref<number>
  /** 当前帧号（0 起） */
  frame: Ref<number>
  /** 总帧数 */
  totalFrames: Ref<number>
  /** 当前时间（秒） */
  time: Ref<number>
  /** 播放一小段实测真实帧率（失败时返回当前值） */
  measureFps: () => Promise<number>
  /** 视频元数据（时长等）变化后调用，刷新总帧数等派生值 */
  refreshMetadata: () => void
  /** 前后一帧 */
  step: (dir: 1 | -1) => Promise<number | null>
  /** 精确跳转到指定秒（内部先暂停），返回实际落点帧号；被更新的 seek 作废时返回 null */
  seekToTime: (t: number) => Promise<number | null>
  /** 把当前画面截为 PNG dataURL；无可解码画面时返回 null */
  captureFrame: (maxWidth?: number) => string | null
}

export function useFrameStepper(
  el: Ref<HTMLVideoElement | null>,
  options?: { fpsFallback?: number }
): FrameStepper {
  const fps = ref(Math.max(1, Math.round(options?.fpsFallback ?? 30)))
  const frame = ref(0)
  const time = ref(0)
  /** 元数据版本：视频时长加载/变化后 bump，驱动 totalFrames 重算 */
  const metadataVersion = ref(0)
  const totalFrames = computed(() => {
    void metadataVersion.value
    const v = el.value
    return v && Number.isFinite(v.duration) && v.duration > 0
      ? Math.round(v.duration * fps.value)
      : 0
  })

  /** seek 序号：后发 seek 会作废仍在等待的旧 seek，避免旧落点覆盖新位置 */
  let seekSeq = 0

  function video(): RvfcVideo | null {
    return (el.value as RvfcVideo | null) ?? null
  }

  /** 常见标准帧率：吸附到最近标准值，避免抖动导致 30/31 之间跳变 */
  const STANDARD_FPS = [24, 25, 30, 48, 50, 60, 90, 120, 240]

  function snapFps(raw: number): number {
    const snapped = STANDARD_FPS.find((rate) => Math.abs(raw - rate) / rate < 0.02)
    return snapped ?? Math.min(240, Math.max(1, Math.round(raw)))
  }

  /**
   * 播放一小段实测真实帧率：连续出帧的 mediaTime 间隔才是帧间隔；
   * seek 触发的 rVFC 回调间隔是跳帧距离，不能用于测帧率。
   */
  function measureFps(): Promise<number> {
    const v = video()
    if (!v || typeof v.requestVideoFrameCallback !== 'function') {
      return Promise.resolve(fps.value)
    }
    return new Promise((resolve) => {
      const prev = {
        currentTime: v.currentTime,
        paused: v.paused,
        muted: v.muted,
        volume: v.volume
      }
      const times: number[] = []
      let handle = 0
      let settled = false
      const finish = (): void => {
        if (settled) return
        settled = true
        if (handle) v.cancelVideoFrameCallback?.(handle)
        v.pause()
        v.muted = prev.muted
        v.volume = prev.volume
        try {
          v.currentTime = prev.currentTime
        } catch {
          /* ignore */
        }
        if (times.length >= 2) {
          const dt = (times[times.length - 1] - times[0]) / (times.length - 1)
          if (dt > 0) fps.value = snapFps(1 / dt)
        }
        resolve(fps.value)
      }
      const callback = (_now: number, meta: VideoFrameCallbackMeta): void => {
        void _now
        times.push(meta.mediaTime)
        if (times.length >= 12 || (times.length >= 2 && meta.mediaTime - times[0] >= 0.6)) {
          finish()
        } else {
          handle = v.requestVideoFrameCallback(callback)
        }
      }
      v.pause()
      v.muted = true
      // 从靠近开头处播放，避开首帧解码/加载抖动；太短则从 0 开始
      const startTime =
        v.duration > 1.5 ? Math.min(0.2 * v.duration, v.duration - 0.5) : 0
      v.currentTime = startTime
      window.setTimeout(finish, 3000)
      handle = v.requestVideoFrameCallback(callback)
      void v.play().catch(() => finish())
    })
  }

  function refreshMetadata(): void {
    metadataVersion.value += 1
  }

  function syncFrame(): void {
    const v = el.value
    if (!v) return
    time.value = v.currentTime || 0
    frame.value = Math.round(time.value * fps.value)
  }

  function waitSeeked(v: HTMLVideoElement): Promise<void> {
    return new Promise((resolve) => {
      const timer = window.setTimeout(done, 1500)
      function done(): void {
        window.clearTimeout(timer)
        v.removeEventListener('seeked', done)
        resolve()
      }
      v.addEventListener('seeked', done, { once: true })
    })
  }

  async function seekToTime(t: number): Promise<number | null> {
    const v = el.value
    if (!v || !Number.isFinite(v.duration)) return null
    const target = Math.min(v.duration, Math.max(0, t))
    const seq = ++seekSeq
    if (Math.abs(target - v.currentTime) < 1e-4) {
      syncFrame()
      return frame.value
    }
    v.pause()
    v.currentTime = target
    await waitSeeked(v)
    if (seq !== seekSeq) return null
    syncFrame()
    return frame.value
  }

  async function step(dir: 1 | -1): Promise<number | null> {
    const v = el.value
    if (!v || !Number.isFinite(v.duration)) return null
    return seekToTime(v.currentTime + dir / fps.value)
  }

  function captureFrame(maxWidth = 960): string | null {
    const v = el.value
    if (!v || !v.videoWidth || !v.videoHeight) return null
    const scale = Math.min(1, maxWidth / v.videoWidth)
    const w = Math.max(1, Math.round(v.videoWidth * scale))
    const h = Math.max(1, Math.round(v.videoHeight * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(v, 0, 0, w, h)
    return canvas.toDataURL('image/png')
  }

  return {
    fps,
    frame,
    totalFrames,
    time,
    measureFps,
    refreshMetadata,
    step,
    seekToTime,
    captureFrame
  }
}
