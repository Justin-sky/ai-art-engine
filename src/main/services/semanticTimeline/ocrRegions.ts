/**
 * VLM OCR 结果解析 → OcrRegion[]。
 * 实际 VLM 调用由上层注入；此处保证 Schema 合法并提供启发式兜底。
 */
import { makeTimeRange, ocrRegionId } from '@shared/semanticTimeline'
import type { OcrRegion, ShotEvidence, UtteranceEvidence } from '@shared/semanticTimeline'

export interface VlmOcrDraft {
  text: string
  kind?: OcrRegion['kind']
  shotId?: string
  start?: number
  end?: number
  box?: { x: number; y: number; w: number; h: number }
  confidence?: number
}

/** 解析 VLM JSON（数组或 {regions:[]}）；非法项丢弃 */
export function parseOcrDrafts(text: string): VlmOcrDraft[] {
  const trimmed = text.trim()
  if (!trimmed) return []
  try {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)
    const raw = fenced ? fenced[1]!.trim() : trimmed
    const parsed = JSON.parse(raw) as unknown
    const list = Array.isArray(parsed)
      ? parsed
      : parsed &&
          typeof parsed === 'object' &&
          Array.isArray((parsed as { regions?: unknown }).regions)
        ? (parsed as { regions: unknown[] }).regions
        : []
    return list
      .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
      .map((r) => ({
        text: String(r.text ?? ''),
        kind: r.kind as OcrRegion['kind'] | undefined,
        shotId: typeof r.shotId === 'string' ? r.shotId : undefined,
        start: typeof r.start === 'number' ? r.start : undefined,
        end: typeof r.end === 'number' ? r.end : undefined,
        box: r.box as VlmOcrDraft['box'],
        confidence: typeof r.confidence === 'number' ? r.confidence : undefined
      }))
      .filter((d) => d.text.trim().length > 0)
  } catch {
    return []
  }
}

export function draftsToOcrRegions(drafts: VlmOcrDraft[], fps: number): OcrRegion[] {
  return drafts.map((d, i) => {
    const start = d.start ?? 0
    const end = d.end ?? start + 1
    const kind = d.kind ?? inferKind(d.text)
    return {
      id: ocrRegionId(d.text, i),
      range: makeTimeRange(start, end, fps),
      text: d.text.trim(),
      kind,
      box: d.box,
      shotId: d.shotId,
      confidence: d.confidence ?? 0.6
    }
  })
}

function inferKind(text: string): OcrRegion['kind'] {
  if (/[¥$€]|元|块|折|价/.test(text)) return 'price' // cjk-ok
  if (/logo|品牌/i.test(text)) return 'logo' // cjk-ok
  return 'other'
}

/**
 * 无 VLM 时：从转写句与镜头时间构造弱 OCR 证据（字幕候选），
 * 标记可编辑性由上层决定（无框 → 非像素层）。
 */
export function heuristicOcrFromUtterances(
  utterances: UtteranceEvidence[],
  shots: ShotEvidence[],
  _fps: number
): OcrRegion[] {
  return utterances.map((u, i) => {
    const shot = shots.find(
      (s) => u.range.start >= s.range.start - 0.05 && u.range.start < s.range.end + 0.05
    )
    return {
      id: ocrRegionId(u.text, i),
      range: u.range,
      text: u.text,
      kind: 'caption' as const,
      shotId: shot?.id,
      confidence: 0.4
    }
  })
}

/** 供 GraphSkill / 节点使用的 OCR 系统提示片段 */
export const OCR_VLM_INSTRUCTION =
  '从关键帧宫格识别画面文字，输出 JSON 数组：[{text,kind,shotId,start,end,box:{x,y,w,h},confidence}]。kind 取 product_name|price|caption|logo|other。只输出 JSON。' // cjk-ok
