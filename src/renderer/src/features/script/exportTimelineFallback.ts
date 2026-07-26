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

  const voiceMusic = input.clips.filter((c) => c.track === 'voice' || c.track === 'music')
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
    }

    const sub = clipAt(input.clips, 'subtitle', t)
    if (sub) {
      const text = (sub.text || sub.title).trim()
      if (text) {
        ctx.font = '36px sans-serif'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'bottom'
        ctx.lineWidth = 4
        ctx.strokeStyle = '#000'
        ctx.fillStyle = '#fff'
        const y = H - 56
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
