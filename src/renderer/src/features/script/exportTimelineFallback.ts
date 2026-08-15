/**
 * 无 ffmpeg 时的成片导出回退：预览级录制（WebM）。
 * 覆盖视频轨画面、配音/音乐与字幕叠字。
 */
import type { ScriptTimelineClip } from '@shared/graph'

type ResolveSrc = (clip: {
  relativePath?: string
  assetId?: string
}) => Promise<string>

export type TimelineRecorderExportInput = {
  clips: ScriptTimelineClip[]
  durationSec: number
  playbackRate: number
  resolveSrc: ResolveSrc
  onProgress?: (ratio: number) => void
  defaultFileName?: string
  subtitleFontSize?: number
  subtitleYOffset?: number
  subtitleColor?: string
}

export type TimelineRecorderExportResult =
  | { ok: true; filePath: string; engine: 'recorder' }
  | { ok: false; canceled?: boolean; error: string }

function pickMime(): string {
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm'
  ]
  if (typeof MediaRecorder === 'undefined') return ''
  return candidates.find((t) => MediaRecorder.isTypeSupported(t)) ?? ''
}

function clipAt(
  clips: ScriptTimelineClip[],
  track: ScriptTimelineClip['track'],
  t: number
): ScriptTimelineClip | null {
  for (const clip of clips) {
    if (clip.track !== track) continue
    if (t >= clip.startSec && t < clip.startSec + clip.durationSec) return clip
  }
  return null
}

function clipVolumeAt(clip: ScriptTimelineClip, local: number): number {
  let volume = Number.isFinite(clip.volume) ? Math.min(1, Math.max(0, clip.volume!)) : 1
  const fadeIn = Number.isFinite(clip.fadeInSec)
    ? Math.min(clip.durationSec, Math.max(0, clip.fadeInSec!))
    : 0
  const fadeOut = Number.isFinite(clip.fadeOutSec)
    ? Math.min(clip.durationSec, Math.max(0, clip.fadeOutSec!))
    : 0
  if (fadeIn > 0 && local < fadeIn) volume *= local / fadeIn
  const fadeStart = clip.durationSec - fadeOut
  if (fadeOut > 0 && local > fadeStart) {
    volume *= Math.max(0, (clip.durationSec - local) / fadeOut)
  }
  return Math.min(1, Math.max(0, volume))
}

export async function exportTimelineViaRecorder(
  input: TimelineRecorderExportInput
): Promise<TimelineRecorderExportResult> {
  const mime = pickMime()
  if (!mime) {
    return { ok: false, error: '当前环境不支持 MediaRecorder，且未检测到 ffmpeg' }
  }

  const duration = Math.max(1, input.durationSec)
  const rate = input.playbackRate > 0 ? input.playbackRate : 1
  const W = 1280
  const H = 720
  const subtitleFontSize = Math.min(200, Math.max(12, Math.round(input.subtitleFontSize ?? 36)))
  const subtitleYOffset = Math.min(1000, Math.max(0, Math.round(input.subtitleYOffset ?? 80)))
  const subtitleColor =
    input.subtitleColor && /^#[0-9a-fA-F]{6}$/.test(input.subtitleColor.trim())
      ? input.subtitleColor.trim()
      : '#ffffff'

  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) return { ok: false, error: '无法创建画布' }

  const videoEl = document.createElement('video')
  videoEl.playsInline = true
  videoEl.muted = true
  videoEl.preload = 'auto'

  const audioCtx = new AudioContext()
  const dest = audioCtx.createMediaStreamDestination()
  const audioNodes: Array<{ el: HTMLAudioElement; source: MediaElementAudioSourceNode }> = []

  const voiceMusic = input.clips.filter(
    (c) => c.track === 'voice' || c.track === 'music' || c.track === 'overlay'
  )
  for (const clip of voiceMusic) {
    const el = new Audio()
    el.preload = 'auto'
    el.src = await input.resolveSrc(clip)
    try {
      const source = audioCtx.createMediaElementSource(el)
      source.connect(dest)
      audioNodes.push({ el, source })
    } catch {
      // 无法接入混音时仍保留元素以便同步播放尝试
      audioNodes.push({ el, source: null as unknown as MediaElementAudioSourceNode })
    }
  }

  // 静音底，避免无音轨时录制失败
  const osc = audioCtx.createOscillator()
  const gain = audioCtx.createGain()
  gain.gain.value = 0.0001
  osc.connect(gain)
  gain.connect(dest)
  osc.start()

  const canvasStream = canvas.captureStream(30)
  const mixed = new MediaStream([
    ...canvasStream.getVideoTracks(),
    ...dest.stream.getAudioTracks()
  ])

  const chunks: BlobPart[] = []
  const recorder = new MediaRecorder(mixed, { mimeType: mime, videoBitsPerSecond: 4_000_000 })
  recorder.ondataavailable = (ev) => {
    if (ev.data.size > 0) chunks.push(ev.data)
  }

  const stopped = new Promise<void>((resolve) => {
    recorder.onstop = () => resolve()
  })

  if (audioCtx.state === 'suspended') await audioCtx.resume()
  recorder.start(200)

  const videoClips = input.clips.filter((c) => c.track === 'video')
  const overlayClips = input.clips.filter((c) => c.track === 'overlay')
  const overlayVideos = new Map<string, HTMLVideoElement>()
  let currentVideoId = ''
  const startWall = performance.now()

  const drawFrame = async (t: number): Promise<void> => {
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, W, H)

    const vClip = clipAt(videoClips, 'video', t)
    if (vClip) {
      if (currentVideoId !== vClip.id) {
        currentVideoId = vClip.id
        videoEl.src = await input.resolveSrc(vClip)
        await videoEl.play().catch(() => undefined)
      }
      const local = Math.max(0, t - vClip.startSec)
      if (Math.abs(videoEl.currentTime - local) > 0.25) {
        try {
          videoEl.currentTime = local
        } catch {
          /* ignore */
        }
      }
      if (videoEl.readyState >= 2) {
        const vw = videoEl.videoWidth || W
        const vh = videoEl.videoHeight || H
        const scale = Math.min(W / vw, H / vh)
        const dw = vw * scale
        const dh = vh * scale
        ctx.drawImage(videoEl, (W - dw) / 2, (H - dh) / 2, dw, dh)
      }
    } else {
      currentVideoId = ''
      if (!videoEl.paused) videoEl.pause()
    }

    for (const clip of overlayClips) {
      const local = t - clip.startSec
      const inRange = local >= 0 && local < clip.durationSec
      if (!inRange) {
        const existing = overlayVideos.get(clip.id)
        if (existing && !existing.paused) existing.pause()
        continue
      }
      let el = overlayVideos.get(clip.id)
      if (!el) {
        el = document.createElement('video')
        el.playsInline = true
        el.muted = true
        el.preload = 'auto'
        el.src = await input.resolveSrc(clip)
        overlayVideos.set(clip.id, el)
        await el.play().catch(() => undefined)
      }
      if (Math.abs(el.currentTime - local) > 0.25) {
        try {
          el.currentTime = local
        } catch {
          /* ignore */
        }
      }
      if (el.paused) void el.play().catch(() => undefined)
      if (el.readyState >= 2) {
        const left = W * (clip.overlayX ?? 0.12)
        const top = H * (clip.overlayY ?? 0.12)
        const ow = W * (clip.overlayWidth ?? 0.36)
        const oh = H * (clip.overlayHeight ?? 0.36)
        const vw = el.videoWidth || ow
        const vh = el.videoHeight || oh
        const scale = Math.min(ow / vw, oh / vh)
        const dw = vw * scale
        const dh = vh * scale
        ctx.save()
        ctx.globalAlpha = Math.min(1, Math.max(0, clip.opacity ?? 1))
        ctx.drawImage(el, left + (ow - dw) / 2, top + (oh - dh) / 2, dw, dh)
        ctx.restore()
      }
    }

    for (const [i, clip] of voiceMusic.entries()) {
      const node = audioNodes[i]
      if (!node) continue
      const local = t - clip.startSec
      const inRange = local >= 0 && local < clip.durationSec
      if (!inRange) {
        if (!node.el.paused) node.el.pause()
        continue
      }
      try {
        if (Math.abs(node.el.currentTime - local) > 0.35) node.el.currentTime = local
      } catch {
        /* ignore */
      }
      if (node.el.paused) void node.el.play().catch(() => undefined)
      node.el.volume = clipVolumeAt(clip, local)
    }

    const sub = clipAt(input.clips, 'subtitle', t)
    if (sub) {
      const text = (sub.text || sub.title).trim()
      if (text) {
        ctx.font = `${subtitleFontSize}px sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'bottom'
        ctx.lineWidth = 4
        ctx.strokeStyle = '#000'
        ctx.fillStyle = subtitleColor
        const y = H - subtitleYOffset
        ctx.strokeText(text, W / 2, y)
        ctx.fillText(text, W / 2, y)
      }
    }
  }

  try {
    while (true) {
      const elapsed = ((performance.now() - startWall) / 1000) * rate
      if (elapsed >= duration) break
      await drawFrame(elapsed)
      input.onProgress?.(Math.min(0.98, elapsed / duration))
      await new Promise((r) => requestAnimationFrame(() => r(undefined)))
    }
  } finally {
    try {
      videoEl.pause()
      for (const el of overlayVideos.values()) el.pause()
      for (const n of audioNodes) n.el.pause()
      osc.stop()
      recorder.stop()
      await stopped
      await audioCtx.close()
    } catch {
      /* ignore */
    }
  }

  const blob = new Blob(chunks, { type: mime.split(';')[0] || 'video/webm' })
  if (!blob.size) return { ok: false, error: '录制结果为空' }

  const buffer = new Uint8Array(await blob.arrayBuffer())
  const fileName = (input.defaultFileName || `cut-${Date.now()}.webm`).replace(/\.mp4$/i, '.webm')
  const saved = await window.studio.saveBinaryFile({
    defaultPath: fileName,
    data: buffer,
    filters: [
      { name: 'WebM', extensions: ['webm'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  })
  if (!saved) return { ok: false, canceled: true, error: '已取消' }
  input.onProgress?.(1)
  return { ok: true, filePath: saved, engine: 'recorder' }
}
