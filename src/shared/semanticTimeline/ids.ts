import type { TimeRange } from './types'

/** FNV-1a 32-bit → hex，浏览器与 Node 均可 */
export function shortHash(input: string, len = 10): string {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  const hex = (h >>> 0).toString(16).padStart(8, '0')
  // 再混一轮长度，避免短输入碰撞
  let h2 = 0x811c9dc5
  const twice = input + hex
  for (let i = 0; i < twice.length; i++) {
    h2 ^= twice.charCodeAt(i)
    h2 = Math.imul(h2, 0x01000193)
  }
  return (hex + (h2 >>> 0).toString(16).padStart(8, '0')).slice(0, len)
}

export function eventId(label: string, startSec: number, endSec: number): string {
  return `ev.${shortHash(`${label}|${startSec.toFixed(3)}|${endSec.toFixed(3)}`)}`
}

export function beatId(type: string, startSec: number): string {
  return `beat.${shortHash(`${type}|${startSec.toFixed(3)}`)}`
}

export function shotId(index: number, startFrame: number): string {
  return `shot.${String(index + 1).padStart(3, '0')}.${startFrame}`
}

export function utteranceId(index: number, startSec: number): string {
  return `utt.${String(index + 1).padStart(3, '0')}.${shortHash(String(startSec))}`
}

export function entityId(kind: string, name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/gi, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 24)
  return `ent.${kind}.${slug || shortHash(name)}`
}

export function intentId(trigger: string, goal: string): string {
  return `intent.${shortHash(`${trigger}|${goal}`)}`
}

export function editId(kind: string, seed?: string): string {
  return `edit.${shortHash(`${kind}|${seed ?? Date.now()}|${Math.random()}`)}`
}

export function buildId(timelineId: string, editIds: string[]): string {
  return `build.${shortHash(`${timelineId}|${editIds.join(',')}`)}`
}

export function timelineId(sourceAssetId: string): string {
  return `stl.${shortHash(sourceAssetId)}`
}

export function ocrRegionId(text: string, index: number): string {
  return `ocr.${String(index + 1).padStart(3, '0')}.${shortHash(text.slice(0, 48))}`
}

/** 秒 → 帧（向下取整） */
export function secToFrame(sec: number, fps: number): number {
  if (!Number.isFinite(sec) || !Number.isFinite(fps) || fps <= 0) return 0
  return Math.max(0, Math.floor(sec * fps + 1e-9))
}

/** 帧 → 秒 */
export function frameToSec(frame: number, fps: number): number {
  if (!Number.isFinite(frame) || !Number.isFinite(fps) || fps <= 0) return 0
  return frame / fps
}

export function makeTimeRange(start: number, end: number, fps: number): TimeRange {
  const s = Math.max(0, start)
  const e = Math.max(s, end)
  return {
    start: s,
    end: e,
    startFrame: secToFrame(s, fps),
    endFrame: secToFrame(e, fps)
  }
}

/** 重新分析时：按时间重叠 + label 匹配旧事件 ID */
export function matchStableEventId(
  label: string,
  range: TimeRange,
  previous: Array<{ id: string; label: string; timeRange: TimeRange; locked?: boolean }>
): string | undefined {
  let best: { id: string; overlap: number } | undefined
  for (const prev of previous) {
    if (prev.label !== label) continue
    const overlap =
      Math.min(prev.timeRange.end, range.end) - Math.max(prev.timeRange.start, range.start)
    if (overlap <= 0) continue
    if (!best || overlap > best.overlap) best = { id: prev.id, overlap }
  }
  return best?.id
}
