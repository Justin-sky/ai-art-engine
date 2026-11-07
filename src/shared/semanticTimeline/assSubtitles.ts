/**
 * ASS v4+ 分层包装花字与字幕生成器（`assSubtitles.ts`）—— 纯函数，主进程拼接与测试共用。
 *
 * 将底部对白字幕（`Dialogue`）、顶部标题横幅（`TitleTop`）与花字强调弹词（`Huazi`）
 * 按成片分辨率等比缩放，花字支持 `\t` 弹性放大微动效，并自动与口播字幕去重避免叠字。
 */
import type { SemanticPackagingOverlayCue } from './bridge'
import { mapCuesToOutput, type LaidOutSegment, type OutputCue } from './rebuildTimeline'
import type { SemanticTimeline } from './types'

function normalizeTextForDedup(text: string): string {
  return (text ?? '')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '')
    .trim()
}

function escapeAssText(raw: string): string {
  return (raw ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/\r?\n/g, '\\N')
    .trim()
}

/** 格式化秒数为 ASS 时间码 `H:MM:SS.CC`（百分之一秒精度） */
export function formatAssTimestamp(sec: number): string {
  const clamped = Math.max(0, Number.isFinite(sec) ? sec : 0)
  const totalCentis = Math.round(clamped * 100)
  const cs = totalCentis % 100
  const totalSecs = Math.floor(totalCentis / 100)
  const s = totalSecs % 60
  const totalMins = Math.floor(totalSecs / 60)
  const m = totalMins % 60
  const h = Math.floor(totalMins / 60)
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`
}

/**
 * 从 `SemanticTimeline` 的镜头纵向图层（`shot.layers`）与文字层（`doc.textLayers`）收集需要还原的包装花字/标题。
 * 排除画面内原生文字（`scene_text`）以及受保护直通的原片镜头（直通镜头本身已带原画面包装，避免重影）。
 */
export function collectTimelinePackagingOverlays(
  doc: SemanticTimeline | null | undefined,
  options: { excludeShotIds?: ReadonlySet<string> } = {}
): SemanticPackagingOverlayCue[] {
  if (!doc) return []
  const out: SemanticPackagingOverlayCue[] = []
  const seen = new Set<string>()
  const shots = (doc.shots ?? []).filter((s) => !s.removed)
  const shotById = new Map(shots.map((s) => [s.id, s]))

  for (const shot of shots) {
    if (options.excludeShotIds?.has(shot.id)) continue
    const shotRangeStart = shot.range?.start ?? 0
    const srcBase = Number.isFinite(shot.sourceSegment?.start)
      ? shot.sourceSegment.start
      : shotRangeStart
    const srcMax =
      Number.isFinite(shot.sourceSegment?.end) && shot.sourceSegment.end > srcBase
        ? shot.sourceSegment.end
        : (shot.range?.end ?? srcBase + 0.5)

    for (const layer of shot.layers ?? []) {
      const text = layer.text?.trim()
      if (!text) continue
      if (
        layer.kind !== 'huazi' &&
        layer.kind !== 'title' &&
        layer.kind !== 'label' &&
        layer.kind !== 'counter' &&
        layer.kind !== 'subtitle'
      ) {
        continue
      }
      const relStart = Number.isFinite(layer.start) ? Math.max(0, layer.start - shotRangeStart) : 0
      const relEnd =
        Number.isFinite(layer.end) && layer.end > (layer.start ?? shotRangeStart)
          ? layer.end - shotRangeStart
          : srcMax - srcBase
      const sourceStartSec = Number((srcBase + relStart).toFixed(3))
      const sourceEndSec = Number(Math.min(srcMax, srcBase + Math.max(0.15, relEnd)).toFixed(3))
      if (!(sourceEndSec > sourceStartSec)) continue

      const kind: SemanticPackagingOverlayCue['kind'] =
        layer.kind === 'counter' ? 'label' : layer.kind
      const position: SemanticPackagingOverlayCue['position'] =
        layer.position ?? (kind === 'title' ? 'top' : kind === 'subtitle' ? 'bottom' : 'middle')
      const dedupKey = `${kind}|${position}|${sourceStartSec.toFixed(2)}|${normalizeTextForDedup(text)}`
      if (seen.has(dedupKey)) continue
      seen.add(dedupKey)
      out.push({ sourceStartSec, sourceEndSec, text, kind, position })
    }
  }

  for (const ocr of doc.textLayers ?? []) {
    const text = ocr.text?.trim()
    if (!text) continue
    if (ocr.kind !== 'price' && ocr.kind !== 'product_name') continue
    if (ocr.shotId && options.excludeShotIds?.has(ocr.shotId)) continue
    if (ocr.shotId && !shotById.has(ocr.shotId)) continue
    const sourceStartSec = Number((ocr.range?.start ?? 0).toFixed(3))
    const sourceEndSec = Number((ocr.range?.end ?? 0).toFixed(3))
    if (!(sourceEndSec > sourceStartSec)) continue
    const kind: SemanticPackagingOverlayCue['kind'] = ocr.kind === 'price' ? 'huazi' : 'label'
    const cy = ocr.box ? ocr.box.y + ocr.box.h * 0.5 : 0.5
    const position: SemanticPackagingOverlayCue['position'] =
      cy < 0.3 ? 'top' : cy > 0.7 ? 'bottom' : 'middle'
    const dedupKey = `${kind}|${position}|${sourceStartSec.toFixed(2)}|${normalizeTextForDedup(text)}`
    if (seen.has(dedupKey)) continue
    seen.add(dedupKey)
    out.push({ sourceStartSec, sourceEndSec, text, kind, position })
  }

  return out.sort((a, b) => a.sourceStartSec - b.sourceStartSec)
}

interface MappedOverlayEvent {
  startSec: number
  endSec: number
  text: string
  kind: SemanticPackagingOverlayCue['kind']
  position: 'top' | 'middle' | 'bottom'
}

function mapOverlaysToOutput(
  overlays: SemanticPackagingOverlayCue[],
  laid: LaidOutSegment[] | undefined
): MappedOverlayEvent[] {
  if (!overlays.length) return []
  if (!laid?.length) {
    return overlays
      .filter((o) => o.text?.trim() && o.sourceEndSec > o.sourceStartSec)
      .map((o) => ({
        startSec: o.sourceStartSec,
        endSec: o.sourceEndSec,
        text: o.text.trim(),
        kind: o.kind,
        position:
          o.position ?? (o.kind === 'title' ? 'top' : o.kind === 'subtitle' ? 'bottom' : 'middle')
      }))
  }

  const out: MappedOverlayEvent[] = []
  for (const ov of overlays) {
    const mapped = mapCuesToOutput(
      [{ sourceStartSec: ov.sourceStartSec, sourceEndSec: ov.sourceEndSec, text: ov.text }],
      laid
    )
    const pos =
      ov.position ?? (ov.kind === 'title' ? 'top' : ov.kind === 'subtitle' ? 'bottom' : 'middle')
    for (const m of mapped) {
      out.push({
        startSec: m.startSec,
        endSec: m.endSec,
        text: m.text,
        kind: ov.kind,
        position: pos
      })
    }
  }
  return out
}

export interface BuildAssSubtitlesInput {
  cues: OutputCue[]
  packagingOverlays?: SemanticPackagingOverlayCue[]
  laid?: LaidOutSegment[]
  width: number
  height: number
  fontFamily?: string
}

export interface BuildAssSubtitlesResult {
  assText: string
  dialogueCount: number
  overlayCount: number
  totalEvents: number
}

/**
 * 构建完整 ASS v4+ 字幕与竖屏花字脚本。
 */
export function buildAssSubtitles(input: BuildAssSubtitlesInput): BuildAssSubtitlesResult {
  const width = Math.max(320, Math.round(input.width || 1080))
  const height = Math.max(320, Math.round(input.height || 1920))
  const minDim = Math.min(width, height)
  const font = (input.fontFamily || 'Microsoft YaHei').replace(/,/g, ' ')

  const dialogueSize = Math.max(22, Math.round(minDim * 0.044))
  const titleSize = Math.max(26, Math.round(minDim * 0.054))
  const huaziSize = Math.max(28, Math.round(minDim * 0.062))
  const outlineBase = Math.max(2, Number((minDim * 0.0032).toFixed(1)))
  const outlineBold = Math.max(3, Number((minDim * 0.0046).toFixed(1)))

  const marginH = Math.max(24, Math.round(width * 0.06))
  const marginVBottom = Math.max(28, Math.round(height * 0.085))
  const marginVTop = Math.max(28, Math.round(height * 0.075))
  const marginVMiddle = Math.max(24, Math.round(height * 0.18))

  const validDialogues = (input.cues ?? []).filter(
    (c) => c.text?.trim() && c.endSec > c.startSec + 0.02
  )
  const mappedOverlays = mapOverlaysToOutput(input.packagingOverlays ?? [], input.laid)

  const filteredOverlays: MappedOverlayEvent[] = []
  const overlayDedup = new Set<string>()
  for (const ov of mappedOverlays) {
    const norm = normalizeTextForDedup(ov.text)
    if (!norm) continue
    // 若与时间重叠的底部口播台词文字相同，跳过重复的底部字幕/同句叠字
    const duplicatesDialogue = validDialogues.some((cue) => {
      const timeOverlaps = cue.startSec <= ov.endSec + 0.4 && cue.endSec >= ov.startSec - 0.4
      if (!timeOverlaps) return false
      const cueNorm = normalizeTextForDedup(cue.text)
      if (!cueNorm) return false
      if (ov.kind === 'subtitle' || ov.position === 'bottom') {
        return cueNorm === norm || cueNorm.includes(norm) || norm.includes(cueNorm)
      }
      return cueNorm === norm
    })
    if (duplicatesDialogue) continue

    const key = `${ov.kind}|${ov.position}|${Math.round(ov.startSec * 5)}|${norm}`
    if (overlayDedup.has(key)) continue
    overlayDedup.add(key)
    filteredOverlays.push(ov)
  }

  const events: string[] = []
  for (const cue of validDialogues) {
    const start = formatAssTimestamp(cue.startSec)
    const end = formatAssTimestamp(cue.endSec)
    const body = escapeAssText(cue.text)
    if (!body) continue
    events.push(`Dialogue: 0,${start},${end},Dialogue,,0,0,0,,${body}`)
  }

  for (const ov of filteredOverlays) {
    const start = formatAssTimestamp(ov.startSec)
    const end = formatAssTimestamp(ov.endSec)
    const body = escapeAssText(ov.text)
    if (!body) continue
    if (ov.kind === 'title' || (ov.kind === 'label' && ov.position === 'top')) {
      events.push(`Dialogue: 1,${start},${end},TitleTop,,0,0,0,,{\\fad(100,120)}${body}`)
    } else if (ov.kind === 'huazi') {
      const alignTag =
        ov.position === 'top' ? '\\an8' : ov.position === 'bottom' ? '\\an2' : '\\an5'
      const popTag = `{${alignTag}\\fscx86\\fscy86\\t(0,140,\\fscx108\\fscy108)\\t(140,250,\\fscx100\\fscy100)}`
      events.push(`Dialogue: 2,${start},${end},Huazi,,0,0,0,,${popTag}${body}`)
    } else {
      const alignTag =
        ov.position === 'top' ? '\\an8' : ov.position === 'bottom' ? '\\an2' : '\\an5'
      events.push(`Dialogue: 1,${start},${end},TitleTop,,0,0,0,,{${alignTag}\\fad(80,100)}${body}`)
    }
  }

  if (events.length === 0) {
    return { assText: '', dialogueCount: 0, overlayCount: 0, totalEvents: 0 }
  }

  const lines = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Dialogue,${font},${dialogueSize},&H00FFFFFF,&H000000FF,&H00181311,&H80000000,0,0,0,0,100,100,0.5,0,1,${outlineBase},1.2,2,${marginH},${marginH},${marginVBottom},1`,
    `Style: TitleTop,${font},${titleSize},&H00DCFAFF,&H000000FF,&H00141010,&H90000000,-1,0,0,0,100,100,1.0,0,1,${outlineBold},2.0,8,${marginH},${marginH},${marginVTop},1`,
    `Style: Huazi,${font},${huaziSize},&H004DE1FF,&H000000FF,&H00101010,&HA0000000,-1,0,0,0,100,100,1.5,0,1,${outlineBold},2.4,5,${marginH},${marginH},${marginVMiddle},1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    ...events,
    ''
  ]

  return {
    assText: lines.join('\n'),
    dialogueCount: validDialogues.length,
    overlayCount: filteredOverlays.length,
    totalEvents: events.length
  }
}
