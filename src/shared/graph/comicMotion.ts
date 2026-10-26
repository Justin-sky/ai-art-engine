/**
 * 动态漫（Motion Comic）时间线编译器：
 * 将 `ComicPage`（漫画分格、斜切刀口线、漫画滤镜、集中线/速度线特效、台词气泡与拟声词 SFX）
 * 自动编译为 `output.timeline` 的多轨时间轴文档（`ScriptTimelineDocument`）。
 *
 * 核心能力：
 * 1. 开场整页全景建立镜头（Establishing Shot）→ 按阅读顺序（国漫左到右 / 日漫右到左 / 条漫上到下）逐格局部取景（`cropRect`）与推拉摇移运镜（`cameraMotion`）；
 * 2. 分镜格支持动静混排：静态分镜自动裁切整页合成图（保留斜切框、网点与气泡）或单格原图，高潮格若绑定 `videoUrl` 则直接播放动态视频；
 * 3. 气泡与拟声词动态触发：按格内阅读顺序计算每条台词气泡的发声时间窗，自动生成逐词卡拉 OK 字幕、冲击贴纸（`comic-boom` / `electric-lightning` / `neon-slash-combo` / `shockwave-ring`）与程序化音效（`boom` / `whoosh` / `pop` / `ding`）；
 * 4. 以音定画（Audio-First）：若提供配音列表（按气泡或按分格匹配），自动按真实配音时长反推每格运镜停留时间。
 */
import {
  comicPanelRects,
  normalizeComicPage,
  readingOrderPanels,
  type ComicPage,
  type ComicPanel,
  type ComicPanelFilter,
  type ComicSpeechBubble
} from './comicPage'
import {
  contentEndSecOfTimeline,
  type ScriptTimelineClip,
  type ScriptTimelineDocument,
  type ScriptTimelineSettings,
  type ScriptTimelineSource,
  type ScriptTimelineTransitionType
} from './scriptTimeline'
import type { TimelineFilterPresetId, TimelineVisualEffectId } from './timelineCreativePack'
import type { TimelineBuiltinStickerId, TimelineMainCameraPreset } from './timelineTween'
import { alignSubtitleWordsAndCues, type TimelineProceduralSfxId } from './timelineWordCue'

export interface ComicDialogueLine {
  panelId: string
  panelIndex: number
  bubbleId: string
  speaker?: string
  text: string
  shape: NonNullable<ComicSpeechBubble['shape']>
}

export interface ComicMotionVoiceInput {
  id?: string
  relativePath: string
  durationSec?: number
  text?: string
  title?: string
}

export interface ComicMotionMusicInput {
  id?: string
  relativePath: string
  title?: string
}

export interface BuildComicMotionTimelineInput {
  page: ComicPage
  /** 整页漫画合成图相对路径（有则优先用于整页建立镜头与带框分格裁切运镜） */
  pageImageRelativePath?: string
  /** 可选：每个分镜格预先从整页合成图裁切出的独立 PNG 相对路径（`panelId -> relativePath`，优先于整页 `cropRect`，消除转场 clipPath 冲突并让左侧素材库呈现独立分镜） */
  panelImageRelativePaths?: Record<string, string>
  /** 可选：每个台词气泡/拟声词独立渲染的透明 PNG 相对路径（`bubbleId -> relativePath`，用于在角色开口瞬间逐个动态弹出气泡） */
  bubbleImageRelativePaths?: Record<string, string>
  /** 来源 `comic.page` 节点 id */
  nodeId?: string
  /** 来源 `comic.page` 节点标题 */
  nodeTitle?: string
  /** 可选：上游配音列表（自动按气泡台词数或分镜格数对齐） */
  voices?: ComicMotionVoiceInput[]
  /** 可选：上游背景音乐列表 */
  music?: ComicMotionMusicInput[]
  /** 是否在开头插入整页漫画建立镜头（默认 true，当有效分格 >= 2 且有整页图时生效） */
  includeEstablishingShot?: boolean
  /** 开场整页建立镜头时长（秒，默认 1.2） */
  establishingDurationSec?: number
  /** 无台词/无配音分镜格的默认停留时长（秒，默认 2.4） */
  defaultPanelDurationSec?: number
  /** 分格裁切外扩留白比例（0~0.15，默认 0.025，用于保留漫画分镜框线与刀口间距） */
  panelCropMarginRatio?: number
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000
}

/** 按格内阅读顺序排列气泡（从上到下，同行按阅读方向 ltr 左→右 或 rtl 右→左） */
export function readingOrderBubbles(
  bubbles: readonly ComicSpeechBubble[],
  readingDirection?: 'ltr' | 'rtl'
): ComicSpeechBubble[] {
  const rtl = readingDirection === 'rtl'
  return [...bubbles].sort((a, b) => {
    const dy = a.y - b.y
    if (Math.abs(dy) > 0.12) return dy
    return rtl ? b.x - a.x : a.x - b.x
  })
}

/** 提取整页漫画的所有非拟声词对白（按分镜格与气泡阅读顺序排列） */
export function extractComicDialogueLines(page: ComicPage): ComicDialogueLine[] {
  const normalized = normalizeComicPage(page)
  const panels = readingOrderPanels(normalized)
  const out: ComicDialogueLine[] = []
  panels.forEach((panel, panelIndex) => {
    const orderedBubbles = readingOrderBubbles(panel.bubbles, normalized.readingDirection)
    for (const bubble of orderedBubbles) {
      const shape = bubble.shape ?? 'rounded'
      if (shape === 'sfx') continue
      const text = bubble.text.trim()
      if (!text) continue
      out.push({
        panelId: panel.id,
        panelIndex,
        bubbleId: bubble.id,
        ...(bubble.speaker ? { speaker: bubble.speaker } : {}),
        text,
        shape
      })
    }
  })
  return out
}

/** 估算单条漫画气泡台词的朗读时长（秒） */
export function estimateComicBubbleDurationSec(text?: string): number {
  const clean = (text ?? '').replace(/\s+/g, ' ').trim()
  if (!clean) return 1.8
  const cjkCount = (clean.match(/[\u4e00-\u9fff]/g) ?? []).length
  const nonCjkWords = clean
    .replace(/[\u4e00-\u9fff]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length
  const sec = cjkCount / 4.2 + nonCjkWords / 2.6 + 0.45
  return Math.min(12, Math.max(1.6, Math.round(sec * 100) / 100))
}

/** 计算某个分镜格在整页漫画上的归一化裁剪框 `[0..1]`（适度外扩以保留分格框线） */
export function computeComicPanelCropRect(
  page: ComicPage,
  panelId: string,
  marginRatio = 0.025
): { cropX: number; cropY: number; cropWidth: number; cropHeight: number } | null {
  const normalized = normalizeComicPage(page)
  const rect = comicPanelRects(normalized).get(panelId)
  if (!rect || normalized.width <= 0 || normalized.height <= 0) return null
  const panel = normalized.panels.find((p) => p.id === panelId)
  // 若带斜切 cornerOffsets，取四角多边形包围盒避免斜角被裁掉
  let minX = rect.x
  let minY = rect.y
  let maxX = rect.x + rect.width
  let maxY = rect.y + rect.height
  if (panel?.cornerOffsets) {
    const o = panel.cornerOffsets
    const xs = [
      rect.x + o[0] * rect.width,
      rect.x + rect.width + o[2] * rect.width,
      rect.x + rect.width + o[4] * rect.width,
      rect.x + o[6] * rect.width
    ]
    const ys = [
      rect.y + o[1] * rect.height,
      rect.y + o[3] * rect.height,
      rect.y + rect.height + o[5] * rect.height,
      rect.y + rect.height + o[7] * rect.height
    ]
    minX = Math.min(...xs)
    maxX = Math.max(...xs)
    minY = Math.min(...ys)
    maxY = Math.max(...ys)
  }

  const marginX = Math.max(0, Math.min(0.15, marginRatio)) * rect.width
  const marginY = Math.max(0, Math.min(0.15, marginRatio)) * rect.height
  const x0 = Math.max(0, minX - marginX)
  const y0 = Math.max(0, minY - marginY)
  const x1 = Math.min(normalized.width, maxX + marginX)
  const y1 = Math.min(normalized.height, maxY + marginY)

  const cropX = round3(Math.min(0.95, Math.max(0, x0 / normalized.width)))
  const cropY = round3(Math.min(0.95, Math.max(0, y0 / normalized.height)))
  const cropWidth = round3(Math.min(1 - cropX, Math.max(0.05, (x1 - x0) / normalized.width)))
  const cropHeight = round3(Math.min(1 - cropY, Math.max(0.05, (y1 - y0) / normalized.height)))
  return { cropX, cropY, cropWidth, cropHeight }
}

/** 按分镜格比例、镜头特效与阅读方向推算最佳运镜方式 */
export function inferComicPanelCameraMotion(
  page: ComicPage,
  panel: ComicPanel,
  panelIndex: number
): TimelineMainCameraPreset {
  if (panel.cameraMotion && panel.cameraMotion !== 'auto') {
    return panel.cameraMotion
  }
  const hasShout = panel.bubbles.some((b) => b.shape === 'shout')
  if (panel.effectType === 'focus-lines' || hasShout) {
    return 'kenBurnsIn'
  }
  const rtl = page.readingDirection === 'rtl'
  if (panel.effectType === 'speed-lines') {
    return rtl ? 'panLeft' : 'panRight'
  }
  const rect = comicPanelRects(page).get(panel.id)
  if (rect && rect.height > 0) {
    const aspect = rect.width / rect.height
    if (aspect >= 1.45) {
      return rtl ? 'panLeft' : 'panRight'
    }
    if (aspect <= 0.68) {
      return 'panDown'
    }
  }
  return panelIndex % 2 === 0 ? 'kenBurnsIn' : 'kenBurnsOut'
}

/** 按前后分镜格的网格位置与特效推算漫改转场类型 */
export function inferComicPanelTransition(
  prevPanel: ComicPanel | null,
  currPanel: ComicPanel,
  readingDirection?: 'ltr' | 'rtl'
): ScriptTimelineTransitionType {
  if (!prevPanel) return 'dissolve'
  if (currPanel.effectType === 'focus-lines') return 'circleopen'
  if (currPanel.cornerOffsets) {
    return readingDirection === 'rtl' ? 'wiperight' : 'diagtl'
  }
  if (currPanel.row === prevPanel.row) {
    return readingDirection === 'rtl' ? 'smoothright' : 'smoothleft'
  }
  return 'smoothup'
}

/** 将分镜格漫画滤镜映射为时间线滤镜预设 */
export function inferComicPanelFilterPreset(
  filter?: ComicPanelFilter
): TimelineFilterPresetId | undefined {
  switch (filter) {
    case 'manga-bw':
      return 'noir-bw'
    case 'sepia':
      return 'vintage-sepia'
    case 'dramatic':
      return 'black-gold'
    case 'halftone':
      return 'nordic-cold'
    default:
      return undefined
  }
}

/** 根据气泡文本与形状匹配动态漫贴纸与程序化音效 */
export function inferComicBubbleStickerAndSfx(bubble: ComicSpeechBubble): {
  stickerId: TimelineBuiltinStickerId
  stickerColor: string
  sfxPresetId: TimelineProceduralSfxId
} {
  const txt = bubble.text.trim()
  const electricRe = /雷|电|闪|滋|噼|zap|thunder|spark|volt/i // cjk-ok
  const slashRe = /斩|剑|刀|咔嚓|裂|slash|cut|blade/i // cjk-ok
  const dashRe = /嗖|咻|呼|疾|冲|whoosh|dash|zoom/i // cjk-ok
  const boomRe = /轰|砰|咚|啪|爆|震|boom|bang|doom|smack|crash/i // cjk-ok
  const shockRe = /！|？|!|\?|gasp|shock/i // cjk-ok

  if (electricRe.test(txt)) {
    return { stickerId: 'electric-lightning', stickerColor: '#FACC15', sfxPresetId: 'boom' }
  }
  if (slashRe.test(txt)) {
    return { stickerId: 'neon-slash-combo', stickerColor: '#0284C7', sfxPresetId: 'whoosh' }
  }
  if (dashRe.test(txt)) {
    return { stickerId: 'shockwave-ring', stickerColor: '#2563EB', sfxPresetId: 'whoosh' }
  }
  if (bubble.shape === 'shout' || boomRe.test(txt)) {
    return { stickerId: 'comic-boom', stickerColor: '#EF4444', sfxPresetId: 'boom' }
  }
  if (shockRe.test(txt)) {
    return { stickerId: 'shockwave-ring', stickerColor: '#F97316', sfxPresetId: 'ding' }
  }
  return {
    stickerId: 'comic-boom',
    stickerColor: bubble.textColor || '#F59E0B',
    sfxPresetId: 'pop'
  }
}

/**
 * 将 `ComicPage` 编译为完整的多轨动态漫时间线文档（`ScriptTimelineDocument`）。
 */
export function buildComicMotionTimeline(
  input: BuildComicMotionTimelineInput
): ScriptTimelineDocument {
  const page = normalizeComicPage(input.page)
  const pageRel = input.pageImageRelativePath?.trim() || ''
  const orderedPanels = readingOrderPanels(page).filter((p) =>
    Boolean(p.videoUrl || p.imageUrl || pageRel || p.bubbles.length > 0 || p.caption)
  )

  const isVerticalStrip = page.height / Math.max(1, page.width) >= 1.55
  const exportWidth = isVerticalStrip ? 720 : 1280
  const exportHeight = isVerticalStrip ? 1280 : 720

  const clips: ScriptTimelineClip[] = []
  const voices = input.voices ?? []
  const dialogueLines = extractComicDialogueLines(page)
  const matchVoiceByBubble =
    voices.length > 0 && dialogueLines.length > 0 && voices.length >= dialogueLines.length

  let cursor = 0
  let globalDialogueIdx = 0
  const stamp = 'comic'

  // 1. 开场整页漫画全景建立镜头（当存在整页合成图且分镜格 >= 2 时）
  const includeEstablishing =
    input.includeEstablishingShot !== false && Boolean(pageRel) && orderedPanels.length >= 2
  if (includeEstablishing) {
    const estDur = round3(Math.min(5, Math.max(0.6, input.establishingDurationSec ?? 1.2)))
    clips.push({
      id: `clip:auto:comic:est:${stamp}`,
      track: 'video',
      sourceId: pageRel,
      title: page.title?.trim() || input.nodeTitle?.trim() || 'Comic Page Overview',
      relativePath: pageRel,
      ...(input.nodeId ? { nodeId: input.nodeId } : {}),
      ...(input.nodeTitle ? { nodeTitle: input.nodeTitle } : {}),
      startSec: 0,
      durationSec: estDur,
      cameraMotion: isVerticalStrip ? 'panDown' : 'kenBurnsOut',
      transitionOutSec: 0.25
    })
    clips.push({
      id: `clip:auto:comic:est-sfx:${stamp}`,
      track: 'sfx',
      lane: 0,
      sourceId: 'procedural:whoosh',
      title: 'Page Turn Whoosh',
      sfxPresetId: 'whoosh',
      startSec: 0,
      durationSec: 0.45,
      volume: 0.55
    })
    if (page.title?.trim()) {
      const titleText = page.title.trim()
      const subDur = round3(Math.max(0.4, estDur - 0.16))
      clips.push({
        id: `clip:auto:comic:est-sub:${stamp}`,
        track: 'subtitle',
        lane: 0,
        sourceId: 'subtitle:comic:title',
        title: titleText,
        text: titleText,
        startSec: 0.08,
        durationSec: subDur,
        subtitleKaraokeMode: 'karaoke-pop',
        words: alignSubtitleWordsAndCues({ text: titleText, durationSec: subDur }).words
      })
    }
    cursor = round3(estDur)
  }

  // 2. 逐格运镜、气泡/拟声词弹跳、配音与卡拉 OK 字幕
  const defaultPanelDur = Math.min(15, Math.max(1.2, input.defaultPanelDurationSec ?? 2.4))
  const cropMargin = input.panelCropMarginRatio ?? 0.025

  orderedPanels.forEach((panel, panelIdx) => {
    const prevPanel = panelIdx > 0 ? orderedPanels[panelIdx - 1]! : null
    const orderedBubbles = readingOrderBubbles(panel.bubbles, page.readingDirection)
    const speechBubbles = orderedBubbles.filter((b) => (b.shape ?? 'rounded') !== 'sfx')
    const sfxBubbles = orderedBubbles.filter((b) => b.shape === 'sfx')

    // 计算每条对白气泡的时间窗与关联配音
    const bubbleEntries: Array<{
      bubble: ComicSpeechBubble
      voice?: ComicMotionVoiceInput
      durationSec: number
    }> = []

    if (speechBubbles.length > 0) {
      speechBubbles.forEach((b, bIdx) => {
        let matchedVoice: ComicMotionVoiceInput | undefined
        if (matchVoiceByBubble) {
          matchedVoice = voices[globalDialogueIdx]
        } else if (bIdx === 0 && panelIdx < voices.length) {
          matchedVoice = voices[panelIdx]
        }
        globalDialogueIdx++
        const dur =
          matchedVoice?.durationSec && matchedVoice.durationSec > 0.2
            ? round3(matchedVoice.durationSec + 0.15)
            : estimateComicBubbleDurationSec(b.text)
        bubbleEntries.push({ bubble: b, voice: matchedVoice, durationSec: dur })
      })
    } else if (!matchVoiceByBubble && panelIdx < voices.length) {
      const panelVoice = voices[panelIdx]!
      const dur =
        panelVoice.durationSec && panelVoice.durationSec > 0.2
          ? round3(panelVoice.durationSec + 0.2)
          : estimateComicBubbleDurationSec(panelVoice.text || panel.caption)
      bubbleEntries.push({
        bubble: {
          id: `${panel.id}-voice`,
          text: panelVoice.text || panel.caption || '',
          x: 0.5,
          y: 0.8,
          tail: 'bl',
          shape: 'narration'
        },
        voice: panelVoice,
        durationSec: dur
      })
    }

    const leadInSec = bubbleEntries.length > 0 ? 0.18 : 0
    const tailPadSec = bubbleEntries.length > 0 ? 0.18 : 0
    const bubblesTotalSec = bubbleEntries.reduce((acc, item) => acc + item.durationSec, 0)
    const computedPanelDur =
      panel.durationSec !== undefined
        ? panel.durationSec
        : bubbleEntries.length > 0
          ? Math.max(1.8, round3(leadInSec + bubblesTotalSec + tailPadSec))
          : panel.caption
            ? Math.max(2.0, estimateComicBubbleDurationSec(panel.caption))
            : defaultPanelDur
    const panelDur = round3(Math.min(30, Math.max(1.0, computedPanelDur)))
    const panelStartSec = cursor

    // 决定该格的视觉源：优先格内视频 -> 预裁切分镜切片图 -> 整页图局部裁切 -> 格内单图
    const usePanelVideo = Boolean(panel.videoUrl?.trim())
    const panelSliceRel = input.panelImageRelativePaths?.[panel.id]?.trim() || ''
    const usePanelSlice = !usePanelVideo && Boolean(panelSliceRel)
    const usePageCrop = !usePanelVideo && !usePanelSlice && Boolean(pageRel)
    const visualRel = usePanelVideo
      ? panel.videoUrl!.trim()
      : usePanelSlice
        ? panelSliceRel
        : usePageCrop
          ? pageRel
          : panel.imageUrl?.trim() || pageRel

    if (visualRel) {
      const crop = usePageCrop ? computeComicPanelCropRect(page, panel.id, cropMargin) : null
      const cameraMotion = usePanelVideo
        ? panel.cameraMotion && panel.cameraMotion !== 'auto'
          ? panel.cameraMotion
          : 'none'
        : inferComicPanelCameraMotion(page, panel, panelIdx)
      const transitionType =
        panelIdx === 0 && !includeEstablishing
          ? 'none'
          : inferComicPanelTransition(prevPanel, panel, page.readingDirection)
      const transitionInSec = transitionType && transitionType !== 'none' ? 0.28 : 0
      const filterPreset =
        !usePageCrop && !usePanelSlice ? inferComicPanelFilterPreset(panel.imageFilter) : undefined

      let visualEffect: TimelineVisualEffectId | undefined
      let effectIntensity: number | undefined
      if (panel.effectType === 'focus-lines') {
        visualEffect = 'zoom-burst'
        effectIntensity = Math.round((panel.effectIntensity ?? 0.65) * 100)
      } else if (panel.effectType === 'speed-lines') {
        visualEffect = 'rgb-glitch'
        effectIntensity = Math.round((panel.effectIntensity ?? 0.65) * 100)
      } else if (sfxBubbles.length > 0 || speechBubbles.some((b) => b.shape === 'shout')) {
        visualEffect = 'camera-shake'
        effectIntensity = 65
      }

      const panelTitle =
        panel.title?.trim() ||
        panel.caption?.trim().slice(0, 18) ||
        speechBubbles[0]?.text.trim().slice(0, 18) ||
        `Panel ${panelIdx + 1}`

      // 若当前镜头设置了入场转场，让前一段主视频尾部向后延伸 transitionInSec 形成几何重叠窗口（兼容 Web 预览转场与 FFmpeg xfade）
      if (transitionInSec > 0) {
        const prevVideoClip = [...clips].reverse().find((c) => c.track === 'video')
        if (
          prevVideoClip &&
          prevVideoClip.startSec + prevVideoClip.durationSec <= panelStartSec + 0.01
        ) {
          prevVideoClip.durationSec = round3(
            panelStartSec + transitionInSec - prevVideoClip.startSec
          )
          prevVideoClip.transitionOutSec = transitionInSec
        }
      }

      clips.push({
        id: `clip:auto:v:${panelIdx}:${stamp}`,
        track: 'video',
        sourceId: visualRel,
        title: panelTitle,
        relativePath: visualRel,
        ...(input.nodeId ? { nodeId: input.nodeId } : {}),
        ...(input.nodeTitle ? { nodeTitle: input.nodeTitle } : {}),
        startSec: panelStartSec,
        durationSec: panelDur,
        ...(crop
          ? {
              cropX: crop.cropX,
              cropY: crop.cropY,
              cropWidth: crop.cropWidth,
              cropHeight: crop.cropHeight
            }
          : {}),
        ...(cameraMotion && cameraMotion !== 'none' ? { cameraMotion } : {}),
        ...(transitionType && transitionType !== 'none' ? { transitionType, transitionInSec } : {}),
        ...(filterPreset ? { filterPreset, filterIntensity: 90 } : {}),
        ...(visualEffect ? { visualEffect, effectIntensity: effectIntensity ?? 70 } : {}),
        ...(panel.effectType === 'vignette'
          ? { vignette: Math.round((panel.effectIntensity ?? 0.6) * 80) }
          : {})
      })
    }

    // 2.5D 前后景差速视差图层（若分镜配置了 foregroundImageUrl，在 overlay lane 1 生成与背景反向/加速推拉的多平面视差动画）
    const fgRel = panel.foregroundImageUrl?.trim() || ''
    if (fgRel) {
      const depth = Math.max(0.1, Math.min(1, panel.parallaxDepth ?? 0.5))
      const cam = inferComicPanelCameraMotion(page, panel, panelIdx)
      let kf0 = { x: 0.1, y: 0.06, width: 0.8, height: 0.88 }
      let kf1 = { x: 0.05, y: 0.02, width: 0.9, height: 0.96 }
      if (cam === 'kenBurnsOut') {
        kf0 = { x: 0.04, y: 0.02, width: 0.92, height: 0.96 }
        kf1 = { x: 0.11, y: 0.06, width: 0.78, height: 0.88 }
      } else if (cam === 'panLeft') {
        const shift = round3(0.14 * depth)
        kf0 = { x: round3(0.06), y: 0.04, width: 0.84, height: 0.92 }
        kf1 = { x: round3(0.06 + shift), y: 0.04, width: 0.84, height: 0.92 }
      } else if (cam === 'panRight') {
        const shift = round3(0.14 * depth)
        kf0 = { x: round3(0.1 + shift), y: 0.04, width: 0.84, height: 0.92 }
        kf1 = { x: round3(0.1), y: 0.04, width: 0.84, height: 0.92 }
      } else if (cam === 'panUp') {
        const shift = round3(0.12 * depth)
        kf0 = { x: 0.08, y: round3(0.03), width: 0.84, height: 0.92 }
        kf1 = { x: 0.08, y: round3(0.03 + shift), width: 0.84, height: 0.92 }
      } else if (cam === 'panDown') {
        const shift = round3(0.12 * depth)
        kf0 = { x: 0.08, y: round3(0.04 + shift), width: 0.84, height: 0.92 }
        kf1 = { x: 0.08, y: round3(0.04), width: 0.84, height: 0.92 }
      } else {
        const grow = round3(0.16 * depth)
        kf0 = { x: 0.1, y: 0.06, width: 0.8, height: 0.88 }
        kf1 = {
          x: round3(0.1 - grow / 2),
          y: round3(0.06 - grow / 3),
          width: round3(0.8 + grow),
          height: round3(0.88 + (grow * 2) / 3)
        }
      }
      clips.push({
        id: `clip:auto:comic:parallax:${panelIdx}:${stamp}`,
        track: 'overlay',
        lane: 1,
        sourceId: fgRel,
        title: `${panel.title?.trim() || `Panel ${panelIdx + 1}`} · 2.5D FG`,
        relativePath: fgRel,
        startSec: panelStartSec,
        durationSec: panelDur,
        overlayX: kf0.x,
        overlayY: kf0.y,
        overlayWidth: kf0.width,
        overlayHeight: kf0.height,
        keyframes: [
          {
            offsetSec: 0,
            x: kf0.x,
            y: kf0.y,
            width: kf0.width,
            height: kf0.height,
            opacity: 1,
            ease: 'inOutSine'
          },
          {
            offsetSec: panelDur,
            x: kf1.x,
            y: kf1.y,
            width: kf1.width,
            height: kf1.height,
            opacity: 1,
            ease: 'inOutSine'
          }
        ],
        tweenIn: 'fadeIn',
        tweenInDurationSec: 0.18,
        tweenOut: 'fadeOut',
        tweenOutDurationSec: 0.18
      })
    }

    // 动态闪烁速度线 / 集中线全屏演出层（当分镜开启 focus-lines 或 speed-lines 时，在 overlay lane 1 叠加高频脉冲/震动漫画气氛线）
    if (panel.effectType === 'focus-lines' || panel.effectType === 'speed-lines') {
      const isFocus = panel.effectType === 'focus-lines'
      const lineStickerId: TimelineBuiltinStickerId = isFocus
        ? 'manga-focus-lines'
        : 'manga-speed-lines'
      clips.push({
        id: `clip:auto:comic:atmo:${panelIdx}:${stamp}`,
        track: 'overlay',
        lane: 1,
        sourceId: `sticker:${lineStickerId}:${panelIdx}`,
        stickerId: lineStickerId,
        stickerColor: panel.effectColor?.trim() || '#111111',
        title: isFocus ? `Panel ${panelIdx + 1} Focus Lines` : `Panel ${panelIdx + 1} Speed Lines`,
        startSec: panelStartSec,
        durationSec: panelDur,
        overlayX: 0,
        overlayY: 0,
        overlayWidth: 1,
        overlayHeight: 1,
        opacity: round3(Math.min(0.42, Math.max(0.22, (panel.effectIntensity ?? 0.65) * 0.48))),
        tweenLoop: isFocus ? 'pulse' : 'shake',
        tweenLoopSpeedHz: isFocus ? 3.6 : 4.5,
        tweenLoopIntensity: 0.65
      })
    }

    // 分镜格切入音效（带斜切或速度线/集中线的分镜格触发转场呼啸音）
    if (
      panel.effectType === 'speed-lines' ||
      panel.effectType === 'focus-lines' ||
      panel.cornerOffsets
    ) {
      clips.push({
        id: `clip:auto:comic:panel-sfx:${panelIdx}:${stamp}`,
        track: 'sfx',
        lane: 0,
        sourceId: 'procedural:whoosh',
        title: `Panel ${panelIdx + 1} Whoosh`,
        sfxPresetId: 'whoosh',
        startSec: panelStartSec,
        durationSec: 0.4,
        volume: 0.6
      })
    }

    // 分镜底部旁白条（若该格有 caption 且无对白气泡，或作为顶部旁白）
    if (panel.caption?.trim() && speechBubbles.length === 0 && bubbleEntries.length === 0) {
      const capText = panel.caption.trim()
      const subDur = round3(Math.max(0.5, panelDur - 0.2))
      clips.push({
        id: `clip:auto:sub:cap:${panelIdx}:${stamp}`,
        track: 'subtitle',
        lane: 0,
        sourceId: `subtitle:cap:${panel.id}`,
        title: capText.slice(0, 24),
        text: capText,
        startSec: round3(panelStartSec + 0.1),
        durationSec: subDur,
        subtitleKaraokeMode: 'karaoke-pop',
        words: alignSubtitleWordsAndCues({ text: capText, durationSec: subDur }).words
      })
    }

    // 铺设格内每条对白气泡的配音、逐词字幕、弹出音效与呐喊贴纸
    let bubbleCursor = round3(panelStartSec + leadInSec)
    bubbleEntries.forEach((entry, bIdx) => {
      const bStart = bubbleCursor
      const bDur = round3(
        Math.min(Math.max(0.4, panelStartSec + panelDur - bStart), entry.durationSec)
      )
      bubbleCursor = round3(bStart + bDur)

      if (entry.voice?.relativePath) {
        clips.push({
          id: `clip:auto:a:${panelIdx}_${bIdx}:${stamp}`,
          track: 'voice',
          lane: 0,
          sourceId: entry.voice.relativePath,
          title: entry.voice.title?.trim() || entry.bubble.speaker || `Voice ${panelIdx + 1}`,
          relativePath: entry.voice.relativePath,
          startSec: bStart,
          durationSec: bDur,
          volume: 1
        })
      }

      const rawText = entry.bubble.text.trim()
      if (rawText) {
        const displaySub = entry.bubble.speaker?.trim()
          ? `${entry.bubble.speaker.trim()}：${rawText}`
          : rawText
        const isShout = entry.bubble.shape === 'shout'
        clips.push({
          id: `clip:auto:sub:${panelIdx}_${bIdx}:${stamp}`,
          track: 'subtitle',
          lane: 0,
          sourceId: `subtitle:${entry.bubble.id}`,
          title: displaySub.slice(0, 24),
          text: displaySub,
          startSec: bStart,
          durationSec: bDur,
          subtitleKaraokeMode: 'karaoke-pop',
          ...(isShout
            ? {
                subtitleHighlightBgColor: '#EF4444',
                subtitleHighlightColor: '#FACC15'
              }
            : {}),
          words: alignSubtitleWordsAndCues({ text: displaySub, durationSec: bDur }).words
        })

        // 气泡弹出轻音效（呐喊框用 boom，普通对白框用 pop）
        const sfxInfo = inferComicBubbleStickerAndSfx(entry.bubble)
        clips.push({
          id: `clip:auto:comic:bsfx:${panelIdx}_${bIdx}:${stamp}`,
          track: 'sfx',
          lane: 1,
          sourceId: `procedural:${isShout ? sfxInfo.sfxPresetId : 'pop'}`,
          title: `${entry.bubble.speaker || 'Bubble'} SFX`,
          sfxPresetId: isShout ? sfxInfo.sfxPresetId : 'pop',
          startSec: bStart,
          durationSec: 0.35,
          volume: isShout ? 0.75 : 0.45
        })

        // 动态气泡随角色开口逐个弹出（置于 overlay lane 2，保持显示至当前分镜结束）
        const bubbleSliceRel = input.bubbleImageRelativePaths?.[entry.bubble.id]?.trim() || ''
        if (!usePageCrop || bubbleSliceRel) {
          const bScale = Math.min(2.2, Math.max(0.6, entry.bubble.scale ?? 1))
          const bw = round3(Math.min(0.56, Math.max(0.24, 0.32 * bScale)))
          const bh = round3(Math.min(0.46, Math.max(0.16, 0.22 * bScale)))
          const bx = round3(Math.min(1 - bw - 0.02, Math.max(0.02, entry.bubble.x - bw / 2)))
          // 限制气泡 Y 坐标上限为 0.72 - bh，避免与底部卡拉OK字幕条（y≈0.85）重叠
          const by = round3(
            Math.min(Math.max(0.08, 0.72 - bh), Math.max(0.08, entry.bubble.y - bh / 2))
          )
          const holdDur = round3(Math.max(0.45, panelStartSec + panelDur - bStart))
          const panelCam = inferComicPanelCameraMotion(page, panel, panelIdx)
          const driftDx =
            panelCam === 'panLeft'
              ? 0.018
              : panelCam === 'panRight'
                ? -0.018
                : panelCam === 'kenBurnsIn'
                  ? round3((entry.bubble.x - 0.5) * 0.024)
                  : 0
          const driftDy =
            panelCam === 'panUp'
              ? 0.016
              : panelCam === 'panDown'
                ? -0.016
                : panelCam === 'kenBurnsIn'
                  ? -0.012
                  : 0
          const endBx = round3(Math.min(1 - bw - 0.02, Math.max(0.02, bx + driftDx)))
          const endBy = round3(Math.min(Math.max(0.08, 0.72 - bh), Math.max(0.08, by + driftDy)))
          const fallbackBubbleSticker: TimelineBuiltinStickerId = isShout
            ? 'comic-shout-bubble'
            : 'comic-speech-bubble'
          clips.push({
            id: `clip:auto:comic:bpop:${panelIdx}_${bIdx}:${stamp}`,
            track: 'overlay',
            lane: 2,
            sourceId: bubbleSliceRel || `sticker:${fallbackBubbleSticker}:${entry.bubble.id}`,
            title: displaySub.slice(0, 20),
            text: bubbleSliceRel ? '' : displaySub.slice(0, 28),
            ...(bubbleSliceRel
              ? { relativePath: bubbleSliceRel }
              : {
                  stickerId: fallbackBubbleSticker,
                  stickerColor: entry.bubble.borderColor?.trim() || '#111111'
                }),
            startSec: bStart,
            durationSec: holdDur,
            overlayX: bx,
            overlayY: by,
            overlayWidth: bw,
            overlayHeight: bh,
            ...(entry.bubble.rotation ? { overlayRotation: entry.bubble.rotation } : {}),
            ...(Math.abs(endBx - bx) > 0.002 || Math.abs(endBy - by) > 0.002
              ? {
                  keyframes: [
                    {
                      offsetSec: 0,
                      x: bx,
                      y: by,
                      width: bw,
                      height: bh,
                      opacity: 1,
                      ease: 'inOutSine' as const
                    },
                    {
                      offsetSec: holdDur,
                      x: endBx,
                      y: endBy,
                      width: panelCam === 'kenBurnsIn' ? round3(bw * 1.03) : bw,
                      height: panelCam === 'kenBurnsIn' ? round3(bh * 1.03) : bh,
                      opacity: 1,
                      ease: 'inOutSine' as const
                    }
                  ]
                }
              : {}),
            tweenIn: isShout ? 'elasticIn' : 'popIn',
            tweenInDurationSec: 0.24,
            ...(isShout
              ? {
                  tweenLoop: 'shake' as const,
                  tweenLoopSpeedHz: 3.2,
                  tweenLoopIntensity: 0.35
                }
              : {}),
            tweenOut: 'fadeOut',
            tweenOutDurationSec: 0.16
          })
        }

        if (isShout) {
          clips.push({
            id: `clip:auto:comic:bsticker:${panelIdx}_${bIdx}:${stamp}`,
            track: 'overlay',
            lane: 3,
            sourceId: `sticker:${sfxInfo.stickerId}`,
            title: rawText.slice(0, 12),
            text: bubbleSliceRel ? '' : rawText.slice(0, 12),
            stickerId: sfxInfo.stickerId,
            stickerColor: sfxInfo.stickerColor,
            startSec: bStart,
            durationSec: round3(Math.min(1.4, bDur)),
            overlayX: round3(Math.min(0.78, Math.max(0.04, entry.bubble.x - 0.14))),
            overlayY: round3(Math.min(0.62, Math.max(0.04, entry.bubble.y - 0.14))),
            overlayWidth: 0.28,
            overlayHeight: 0.28,
            opacity: bubbleSliceRel ? 0.52 : 0.85,
            tweenIn: 'elasticIn',
            tweenInDurationSec: 0.28,
            tweenOut: 'fadeOut',
            tweenOutDurationSec: 0.2
          })
        }
      }
    })

    // 铺设格内拟声词（shape === 'sfx'）动态冲击贴纸与卡点音效
    sfxBubbles.forEach((sfxBubble, sIdx) => {
      const sfxInfo = inferComicBubbleStickerAndSfx(sfxBubble)
      const offsetRatio = sfxBubbles.length > 1 ? (sIdx / sfxBubbles.length) * 0.5 : 0.12
      const sStart = round3(panelStartSec + panelDur * offsetRatio)
      const sDur = round3(Math.min(1.5, Math.max(0.5, panelStartSec + panelDur - sStart)))
      const sfxSliceRel = input.bubbleImageRelativePaths?.[sfxBubble.id]?.trim() || ''

      if (sfxSliceRel) {
        clips.push({
          id: `clip:auto:comic:sfx-slice:${panelIdx}_${sIdx}:${stamp}`,
          track: 'overlay',
          lane: 2,
          sourceId: sfxSliceRel,
          title: sfxBubble.text.trim(),
          relativePath: sfxSliceRel,
          startSec: sStart,
          durationSec: round3(Math.max(0.5, panelStartSec + panelDur - sStart)),
          overlayX: round3(Math.min(0.74, Math.max(0.04, sfxBubble.x - 0.16))),
          overlayY: round3(Math.min(0.62, Math.max(0.04, sfxBubble.y - 0.14))),
          overlayWidth: 0.32,
          overlayHeight: 0.28,
          overlayRotation: sfxBubble.rotation ?? 0,
          tweenIn: 'elasticIn',
          tweenInDurationSec: 0.24,
          tweenLoop: 'shake',
          tweenLoopSpeedHz: 3.8,
          tweenLoopIntensity: 0.45,
          tweenOut: 'fadeOut',
          tweenOutDurationSec: 0.18
        })
      }

      clips.push({
        id: `clip:auto:comic:sfx-ov:${panelIdx}_${sIdx}:${stamp}`,
        track: 'overlay',
        lane: 3,
        sourceId: `sticker:${sfxInfo.stickerId}`,
        title: sfxBubble.text.trim(),
        text: sfxSliceRel ? '' : sfxBubble.text.trim(),
        stickerId: sfxInfo.stickerId,
        stickerColor: sfxInfo.stickerColor,
        startSec: sStart,
        durationSec: sDur,
        overlayX: round3(Math.min(0.76, Math.max(0.04, sfxBubble.x - 0.15))),
        overlayY: round3(Math.min(0.62, Math.max(0.04, sfxBubble.y - 0.15))),
        overlayWidth: 0.3,
        overlayHeight: 0.3,
        opacity: sfxSliceRel ? 0.55 : 0.88,
        overlayRotation: sfxBubble.rotation ?? -10,
        tweenIn: 'elasticIn',
        tweenInDurationSec: 0.25,
        tweenLoop: 'pulse',
        tweenOut: 'fadeOut',
        tweenOutDurationSec: 0.2
      })

      clips.push({
        id: `clip:auto:comic:sfx-aud:${panelIdx}_${sIdx}:${stamp}`,
        track: 'sfx',
        lane: 1,
        sourceId: `procedural:${sfxInfo.sfxPresetId}`,
        title: sfxBubble.text.trim(),
        sfxPresetId: sfxInfo.sfxPresetId,
        startSec: sStart,
        durationSec: 0.45,
        volume: 0.8
      })
    })

    cursor = round3(panelStartSec + panelDur)
  })

  const totalDur = Math.max(3, round3(contentEndSecOfTimeline(clips)))

  // 3. 背景音乐轨（自动铺满整条动态漫并开启人声闪避）
  const firstMusic = input.music?.[0]
  if (firstMusic?.relativePath) {
    clips.push({
      id: `clip:auto:m:0:${stamp}`,
      track: 'music',
      lane: 0,
      sourceId: firstMusic.relativePath,
      title: firstMusic.title?.trim() || 'Motion Comic BGM',
      relativePath: firstMusic.relativePath,
      startSec: 0,
      durationSec: totalDur,
      volume: 0.35,
      loop: true,
      fadeInSec: 0.5,
      fadeOutSec: 0.8
    })
  }

  const isLandscapePage = page.width >= page.height
  const settings: ScriptTimelineSettings = {
    durationSec: totalDur,
    exportWidth,
    exportHeight,
    exportFps: 24,
    scaleMode: isLandscapePage ? 'cover' : 'blur',
    subtitleFontSize: isVerticalStrip ? 42 : 46,
    subtitleYOffset: isVerticalStrip ? 140 : 88,
    subtitleColor: '#FACC15',
    subtitleBorderColor: '#000000',
    subtitleBorderWidth: 4,
    subtitleKaraokeMode: 'karaoke-pop',
    subtitleHighlightColor: '#FFFFFF',
    subtitleHighlightBgColor: '#FF3B5C',
    mixAutoDucking: true,
    mixDuckingRatio: 0.25,
    mixLoudnorm: true
  }

  // 4. 构建左侧素材箱列表（包含整页总览图、各分格独立切片/视频、配音与背景音乐）
  const sources: ScriptTimelineSource[] = []
  const seenSourcePaths = new Set<string>()
  const pushSource = (src: ScriptTimelineSource): void => {
    const key = src.relativePath?.trim() || src.id
    if (!key || seenSourcePaths.has(key)) return
    seenSourcePaths.add(key)
    sources.push(src)
  }
  for (const c of clips) {
    if (c.track === 'video' && c.relativePath) {
      pushSource({
        id: c.sourceId || c.relativePath,
        title: c.title,
        relativePath: c.relativePath,
        durationSec: c.durationSec,
        origin: 'input',
        mediaKind: 'video',
        ...(input.nodeId ? { nodeId: input.nodeId } : {}),
        ...(input.nodeTitle ? { nodeTitle: input.nodeTitle } : {})
      })
    } else if ((c.track === 'voice' || c.track === 'music') && c.relativePath) {
      pushSource({
        id: c.sourceId || c.relativePath,
        title: c.title,
        relativePath: c.relativePath,
        durationSec: c.durationSec,
        origin: 'input',
        mediaKind: 'voice'
      })
    }
  }

  return {
    clips,
    sources,
    settings
  }
}
