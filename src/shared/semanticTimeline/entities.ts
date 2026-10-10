/**
 * 关键帧检测框 → 实体轨道：镜头内按 IoU 串联同类别实例。
 */
import { entityId, makeTimeRange } from './ids'
import type { Entity, EntityKind, ShotEvidence, TimeRange } from './types'

export interface DetectBox {
  label: string
  confidence: number
  x: number
  y: number
  width: number
  height: number
}

export interface ShotDetection {
  shotId: string
  range: TimeRange
  boxes: DetectBox[]
  /** 检测图像素尺寸；给出时出现记录会带归一化框 */
  frameWidth?: number
  frameHeight?: number
}

function normalizedBox(box: DetectBox, det: ShotDetection): Entity['appearances'][number]['box'] {
  const fw = det.frameWidth ?? 0
  const fh = det.frameHeight ?? 0
  if (fw <= 0 || fh <= 0) return undefined
  const clamp = (v: number): number => Math.min(1, Math.max(0, v))
  return {
    x: clamp(box.x / fw),
    y: clamp(box.y / fh),
    w: clamp(box.width / fw),
    h: clamp(box.height / fh)
  }
}

function appearanceOf(det: ShotDetection, box: DetectBox): Entity['appearances'][number] {
  const norm = normalizedBox(box, det)
  return norm
    ? { shotId: det.shotId, range: det.range, box: norm }
    : { shotId: det.shotId, range: det.range }
}

function iou(a: DetectBox, b: DetectBox): number {
  const ax2 = a.x + a.width
  const ay2 = a.y + a.height
  const bx2 = b.x + b.width
  const by2 = b.y + b.height
  const ix = Math.max(0, Math.min(ax2, bx2) - Math.max(a.x, b.x))
  const iy = Math.max(0, Math.min(ay2, by2) - Math.max(a.y, b.y))
  const inter = ix * iy
  const uni = a.width * a.height + b.width * b.height - inter
  return uni > 0 ? inter / uni : 0
}

/**
 * 检测标签 → 实体类型。本地 YOLO 的 COCO 标签只覆盖人 / 杯子 / 瓶子这类；
 * 多模态大模型通常直接给 `kind`，给了未知值时也回落到这里（`entityDetectVlm` 复用）。
 */
export function kindOfLabel(label: string): EntityKind {
  const l = label.toLowerCase()
  if (l === 'person' || l === 'face') return 'person'
  if (['bottle', 'cup', 'wine glass', 'bowl'].includes(l)) return 'product'
  return 'object'
}

function displayName(label: string, index: number): string {
  if (label === 'person') return index === 0 ? 'host' : `person-${index + 1}`
  return `${label}-${index + 1}`
}

/**
 * 跨镜头串联：同类别、相邻镜头关键帧框 IoU ≥ 阈值则视为同一实体。
 * 同一镜头内同类别多框按置信度排序，各自开新轨道（不在同一帧内合并）。
 */
export function linkEntitiesFromDetections(
  detections: ShotDetection[],
  options?: { iouThreshold?: number; fps?: number }
): Entity[] {
  const thr = options?.iouThreshold ?? 0.3
  void options?.fps
  type Track = {
    kind: EntityKind
    label: string
    name: string
    appearances: Entity['appearances']
    lastBox: DetectBox
    lastShotIndex: number
  }
  const tracks: Track[] = []
  const kindCounters = new Map<string, number>()

  detections.forEach((det, shotIndex) => {
    const boxes = [...det.boxes].sort((a, b) => b.confidence - a.confidence)
    for (const box of boxes) {
      if (box.confidence < 0.35) continue
      const kind = kindOfLabel(box.label)
      let best: { track: Track; score: number } | undefined
      for (const track of tracks) {
        if (track.kind !== kind || track.label !== box.label) continue
        if (shotIndex - track.lastShotIndex > 2) continue
        const score = iou(track.lastBox, box)
        if (score >= thr && (!best || score > best.score)) best = { track, score }
      }
      if (best) {
        best.track.appearances.push(appearanceOf(det, box))
        best.track.lastBox = box
        best.track.lastShotIndex = shotIndex
      } else {
        const n = kindCounters.get(box.label) ?? 0
        kindCounters.set(box.label, n + 1)
        const name = displayName(box.label, n)
        tracks.push({
          kind,
          label: box.label,
          name,
          appearances: [appearanceOf(det, box)],
          lastBox: box,
          lastShotIndex: shotIndex
        })
      }
    }
  })

  return tracks.map((t) => ({
    id: entityId(t.kind, t.name),
    kind: t.kind,
    name: t.name,
    appearances: t.appearances,
    pixelEditable: true
  }))
}

/** 开放词汇命名的语义元素（无检测框）→ 不可像素编辑 */
export function semanticOnlyEntity(
  kind: EntityKind,
  name: string,
  shotIds: string[],
  shots: ShotEvidence[],
  fps: number
): Entity {
  return {
    id: entityId(kind, name),
    kind,
    name,
    appearances: shotIds.map((shotId) => {
      const shot = shots.find((s) => s.id === shotId)
      return {
        shotId,
        range: shot?.range ?? makeTimeRange(0, 0, fps)
      }
    }),
    pixelEditable: false
  }
}
