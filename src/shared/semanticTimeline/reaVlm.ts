/**
 * Evidence-guided Multimodal VLM Prompts & Parsers (`rea-video/vlm.py` port).
 *
 * Injects deterministic forensic measurements (`shotForensicHints`) into per-shot VLM calls
 * so the model inspects visual texture, anatomy/physics, UI/packaging overlays, and real-material
 * provenance against hard signal measurements rather than guessing blindly.
 */
import {
  AI_EDIT_KINDS,
  BASE_PRODUCTION_LABELS,
  type AiEditKind,
  type BreakdownLang,
  type ContainerProvenance,
  type ProductionBaseLabel,
  type ShotAiEditDetection,
  type ShotForensicFeatures,
  type ShotLayerItem,
  type ShotLayerKind,
  type ShotMaterialItem,
  type WholeVideoAnalysis
} from './reaTypes'
import type { SemanticShot } from './types'

/** Extract a JSON array from raw LLM/VLM text (with optional markdown code fences). */
export function parseJsonArray<T = unknown>(text: string): T[] {
  const trimmed = (text ?? '').trim()
  if (!trimmed) return []
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed)
  const body = fence ? fence[1]!.trim() : trimmed
  const start = body.indexOf('[')
  const end = body.lastIndexOf(']')
  if (start < 0 || end < start) return []
  try {
    const parsed = JSON.parse(body.slice(start, end + 1)) as unknown
    return Array.isArray(parsed) ? (parsed as T[]) : []
  } catch {
    return []
  }
}

export interface ReaShotVlmDraft {
  shotId: string
  baseLabel?: ProductionBaseLabel
  probs?: Partial<Record<ProductionBaseLabel, number>>
  evidence?: string[]
  aiEdits?: ShotAiEditDetection[]
  subject?: string
  action?: string
  emotion?: string
  shotSize?: string
  angle?: string
  cameraSupport?: string
  cameraMotion?: string
  lens?: string
  lightingLocation?: string
  lightingSetup?: string
  visualDescription?: string
  style?: string
  grade?: string
  layers?: Array<{
    kind: ShotLayerKind
    text?: string
    position?: 'top' | 'middle' | 'bottom'
  }>
  realMaterials?: ShotMaterialItem[]
  imagePrompt?: string
  videoPrompt?: string
}

/** Build concise deterministic forensic hint line for a single shot (`rea_video/vlm.py:shot_hints`). */
export function formatShotForensicHint(
  shot: SemanticShot,
  provenance?: ContainerProvenance
): string {
  const f: ShotForensicFeatures | undefined = shot.forensics
  const dur = Math.max(0.1, shot.range.end - shot.range.start).toFixed(2)
  const bits: string[] = [
    `${shot.id} (${shot.range.start.toFixed(2)}-${shot.range.end.toFixed(2)}s, ${dur}s)`
  ]
  if (provenance?.aigcImplicitLabel?.label) {
    bits.push(`container_aigc_label=${provenance.aigcImplicitLabel.label}`)
  }
  if (provenance?.generatorHint) bits.push(`gen_hint=${provenance.generatorHint}`)
  if (provenance?.platformTranscode) bits.push(`transcode=${provenance.platformTranscode}`)
  if (f) {
    if (f.meanFrameDiff != null) bits.push(`frameDiff=${f.meanFrameDiff.toFixed(2)}`)
    if (f.dupRatio != null) bits.push(`dup=${(f.dupRatio * 100).toFixed(0)}%`)
    if (f.cameraMotionKind) bits.push(`motion=${f.cameraMotionKind}`)
    if (f.kenburnsScore != null && f.kenburnsScore >= 0.6) {
      bits.push(
        `kenburns=${(f.kenburnsScore * 100).toFixed(0)}%(zoom=${((f.zoomPerSec ?? 0) * 100).toFixed(1)}%/s,pan=${((f.panPxPerSec ?? 0) * 100).toFixed(1)}%/s)`
      )
    }
    if (f.noiseSigma != null) bits.push(`noise=${f.noiseSigma.toFixed(2)}`)
    if (f.flatRatio != null) bits.push(`flat=${(f.flatRatio * 100).toFixed(0)}%`)
    if (f.axisEdgeRatio != null) bits.push(`axisEdge=${(f.axisEdgeRatio * 100).toFixed(0)}%`)
    if (f.palette95 != null) bits.push(`palette95=${f.palette95}`)
    if (f.frozenOverlayBoxes?.length) {
      const bands = [...new Set(f.frozenOverlayBoxes.map((b) => b.band))].join('+')
      bits.push(`frozenOverlays=${f.frozenOverlayBoxes.length}(${bands})`)
    }
    if (f.aspects?.lighting?.setupName) bits.push(`light="${f.aspects.lighting.setupName}"`)
    if (f.aspects?.grade?.look) bits.push(`grade="${f.aspects.grade.look}"`)
  }
  return bits.join(', ')
}

export function buildReaShotBatchPrompt(input: {
  shots: SemanticShot[]
  provenance?: ContainerProvenance
  lang?: BreakdownLang
}): { system: string; prompt: string } {
  const lang = input.lang ?? 'zh'
  const labels = BASE_PRODUCTION_LABELS.join(' | ')
  const aiEdits = AI_EDIT_KINDS.join(' | ')
  const hints = input.shots
    .map((s, idx) => `${idx + 1}. ${formatShotForensicHint(s, input.provenance)}`)
    .join('\n')

  const system =
    lang === 'en'
      ? 'You are a video reverse-engineering & forensics specialist (`rea-video` methodology). Return strictly valid JSON array with no markdown prose.'
      : '你是专业的视频逆向拆解与取证分析师（遵循 rea-video 证据驱动拆解范式）。只输出严格合法的 JSON 数组，禁止任何多余解释文字。' // cjk-ok

  const prompt = [
    lang === 'en'
      ? `Analyze the following ${input.shots.length} shot keyframes (in exact order) combined with their deterministic signal measurements:`
      : `请按顺序逐张审看以下 ${input.shots.length} 个镜头的关键帧，并结合实测信号取证指标完成四轴逆向拆解：`, // cjk-ok
    hints,
    '',
    `Allowed baseLabel values: ${labels}`,
    `Allowed aiEdits kinds: ${aiEdits}`,
    'Allowed layer kinds: subtitle | huazi | title | label | counter | scene_text | animated_sticker | static_sticker | pip',
    '',
    'Rules:',
    '0. Each shot image may be a 3-panel horizontal temporal strip `[Start | Middle | End]` (left-to-right). Compare the 3 panels to read camera motion, subject action progression, ending pose, and whether text/graphics stay frozen across frames (`layers` packaging) vs move with scene perspective (`scene_text`).',
    '1. Separate base picture from vertical overlays (`layers`): subtitles/huazi/titles/stickers added in editing go into `layers`, NOT into `imagePrompt`/`videoPrompt` (unless `baseLabel` is `code_render` or `screen_capture` where text IS the base picture).',
    '2. Flag `realMaterials` (`realMaterial: true`) whenever the shot embeds a real software UI, screen recording, physical branded product, or real footage that generative video models cannot fake.',
    '3. `videoPrompt` must be positive-only (no negative words like "no blur"), describing action process + ending state + camera movement.',
    '',
    'Return JSON array of objects with exact schema:',
    '[{"shotId":"shot.xxx","baseLabel":"ai_video","probs":{"ai_video":0.8,"live_action":0.2},"evidence":["reason 1"],"aiEdits":[],"subject":"...","action":"...","emotion":"...","shotSize":"...","angle":"...","cameraMotion":"...","lens":"...","lightingLocation":"...","lightingSetup":"...","visualDescription":"...","style":"...","grade":"...","layers":[{"kind":"huazi","text":"...","position":"top"}],"realMaterials":[{"kind":"product","description":"...","realMaterial":true}],"imagePrompt":"...","videoPrompt":"..."}]'
  ].join('\n')

  return { system, prompt }
}

const VALID_LABELS = new Set<string>(BASE_PRODUCTION_LABELS)
const VALID_AI_EDITS = new Set<string>(AI_EDIT_KINDS)
const VALID_LAYER_KINDS = new Set<string>([
  'subtitle',
  'huazi',
  'title',
  'label',
  'counter',
  'scene_text',
  'animated_sticker',
  'static_sticker',
  'pip'
])

export function parseReaShotVlmBatch(rawText: string): ReaShotVlmDraft[] {
  const arr = parseJsonArray<Record<string, unknown>>(rawText)
  const out: ReaShotVlmDraft[] = []
  for (const item of arr) {
    const shotId = typeof item.shotId === 'string' ? item.shotId.trim() : ''
    if (!shotId) continue

    const baseRaw = typeof item.baseLabel === 'string' ? item.baseLabel.trim() : ''
    const baseLabel = VALID_LABELS.has(baseRaw) ? (baseRaw as ProductionBaseLabel) : undefined

    const probs: Partial<Record<ProductionBaseLabel, number>> = {}
    if (item.probs && typeof item.probs === 'object' && !Array.isArray(item.probs)) {
      for (const [k, v] of Object.entries(item.probs as Record<string, unknown>)) {
        if (VALID_LABELS.has(k) && typeof v === 'number' && Number.isFinite(v) && v >= 0) {
          probs[k as ProductionBaseLabel] = v
        }
      }
    }
    if (baseLabel && Object.keys(probs).length === 0) {
      probs[baseLabel] = 0.8
    }

    const evidence = Array.isArray(item.evidence)
      ? item.evidence.map((e) => String(e ?? '').trim()).filter(Boolean)
      : []

    const aiEdits: ShotAiEditDetection[] = []
    if (Array.isArray(item.aiEdits)) {
      for (const ed of item.aiEdits) {
        if (!ed || typeof ed !== 'object') continue
        const rec = ed as Record<string, unknown>
        const kind = String(rec.kind ?? '').trim()
        if (!VALID_AI_EDITS.has(kind)) continue
        aiEdits.push({
          kind: kind as AiEditKind,
          confidence:
            typeof rec.confidence === 'number' && Number.isFinite(rec.confidence)
              ? Math.max(0, Math.min(1, rec.confidence))
              : 0.7,
          evidence: String(rec.evidence ?? kind).trim()
        })
      }
    }

    const layers: NonNullable<ReaShotVlmDraft['layers']> = []
    if (Array.isArray(item.layers)) {
      for (const l of item.layers) {
        if (!l || typeof l !== 'object') continue
        const rec = l as Record<string, unknown>
        const kind = String(rec.kind ?? '').trim()
        if (!VALID_LAYER_KINDS.has(kind)) continue
        const pos = String(rec.position ?? '').trim()
        layers.push({
          kind: kind as ShotLayerKind,
          ...(typeof rec.text === 'string' && rec.text.trim() ? { text: rec.text.trim() } : {}),
          ...(pos === 'top' || pos === 'middle' || pos === 'bottom' ? { position: pos } : {})
        })
      }
    }

    const realMaterials: ShotMaterialItem[] = []
    if (Array.isArray(item.realMaterials)) {
      for (const rm of item.realMaterials) {
        if (!rm || typeof rm !== 'object') continue
        const rec = rm as Record<string, unknown>
        const desc = String(rec.description ?? '').trim()
        if (!desc) continue
        realMaterials.push({
          kind: String(rec.kind ?? 'asset').trim() || 'asset',
          description: desc,
          realMaterial: typeof rec.realMaterial === 'boolean' ? rec.realMaterial : null
        })
      }
    }

    const str = (k: string): string | undefined => {
      const v = item[k]
      return typeof v === 'string' && v.trim() ? v.trim() : undefined
    }

    out.push({
      shotId,
      ...(baseLabel ? { baseLabel } : {}),
      ...(Object.keys(probs).length ? { probs } : {}),
      ...(evidence.length ? { evidence } : {}),
      ...(aiEdits.length ? { aiEdits } : {}),
      subject: str('subject'),
      action: str('action'),
      emotion: str('emotion'),
      shotSize: str('shotSize'),
      angle: str('angle'),
      cameraSupport: str('cameraSupport'),
      cameraMotion: str('cameraMotion'),
      lens: str('lens'),
      lightingLocation: str('lightingLocation'),
      lightingSetup: str('lightingSetup'),
      visualDescription: str('visualDescription'),
      style: str('style'),
      grade: str('grade'),
      ...(layers.length ? { layers } : {}),
      ...(realMaterials.length ? { realMaterials } : {}),
      imagePrompt: str('imagePrompt'),
      videoPrompt: str('videoPrompt')
    })
  }
  return out
}

export function convertDraftLayersToShotLayers(
  shotId: string,
  range: { start: number; end: number },
  drafts: ReaShotVlmDraft['layers'],
  frozenBoxes?: ShotForensicFeatures['frozenOverlayBoxes']
): ShotLayerItem[] {
  if (!drafts?.length) return []
  return drafts.map((d, i) => {
    const pos =
      d.position ?? (d.kind === 'title' ? 'top' : d.kind === 'subtitle' ? 'bottom' : 'middle')
    const matchedBox = frozenBoxes?.find((b) => b.band === pos)
    return {
      id: `lyr.${shotId}.${i + 1}`,
      kind: d.kind,
      ...(d.text ? { text: d.text } : {}),
      start: range.start,
      end: range.end,
      ...(d.position ? { position: d.position } : {}),
      ...(matchedBox
        ? { box: { x: matchedBox.x, y: matchedBox.y, w: matchedBox.w, h: matchedBox.h } }
        : {})
    }
  })
}

export function buildReaWholeVideoPrompt(input: {
  durationSec: number
  shotSummaries: string[]
  transcriptLines: string[]
  lang?: BreakdownLang
}): { system: string; prompt: string } {
  const lang = input.lang ?? 'zh'
  const system =
    lang === 'en'
      ? 'You are a senior video reverse-engineering director. Synthesize whole-video structure, hook, recurring cast/props, and audio style as a single valid JSON object.'
      : '你是资深视频拆解与复刻导演。请根据全片镜头序列与台词，总结整片结构、开头钩子、跨镜角色/场景/道具设定与声音形态，只输出单个合法 JSON 对象。' // cjk-ok

  const prompt = [
    `Video duration: ${input.durationSec.toFixed(2)}s`,
    'Shots:',
    ...input.shotSummaries.slice(0, 40),
    'Transcript:',
    ...(input.transcriptLines.length ? input.transcriptLines.slice(0, 40) : ['(none)']),
    '',
    'Return a single JSON object with schema:',
    '{"summary":"1-2 sentence summary","format":"e.g. talking-head + B-roll / short drama / product ad","hook":"how the first 3s hooks viewers","overallProduction":"how the whole piece was assembled","narration":{"type":"tts|human|mixed|none","voice":"voice tone","style":"pacing"},"segments":[{"start":0,"end":3.2,"beat":"Hook","copy":"...","audio":"..."}],"cast":{"characters":[{"id":"C1","name":"...","kind":"human|character|avatar|animal","look":"consistent appearance prompt for @image","role":"...","shotIds":["shot.1"]}],"scenes":[{"id":"SC1","where":"...","when":"day|night","look":"set & lighting","shotIds":["shot.1"]}],"props":[{"id":"P1","name":"...","note":"...","realMaterial":true,"shotIds":["shot.1"]}]}}'
  ].join('\n')

  return { system, prompt }
}

export function parseReaWholeVideoResponse(rawText: string): Partial<WholeVideoAnalysis> | null {
  const trimmed = rawText.trim()
  if (!trimmed) return null
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenceMatch ? fenceMatch[1]!.trim() : trimmed
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const obj = JSON.parse(candidate.slice(start, end + 1)) as Record<string, unknown>
    const str = (k: string): string | undefined =>
      typeof obj[k] === 'string' && (obj[k] as string).trim()
        ? (obj[k] as string).trim()
        : undefined
    const segments: NonNullable<WholeVideoAnalysis['segments']> = []
    if (Array.isArray(obj.segments)) {
      for (const sg of obj.segments) {
        if (!sg || typeof sg !== 'object') continue
        const r = sg as Record<string, unknown>
        const s = Number(r.start ?? 0)
        const e = Number(r.end ?? 0)
        const beat = String(r.beat ?? '').trim()
        if (!beat || !Number.isFinite(s) || !Number.isFinite(e)) continue
        segments.push({
          start: s,
          end: e,
          beat,
          ...(typeof r.copy === 'string' ? { copy: r.copy } : {}),
          ...(typeof r.audio === 'string' ? { audio: r.audio } : {})
        })
      }
    }
    let narration: WholeVideoAnalysis['narration']
    if (obj.narration && typeof obj.narration === 'object') {
      const n = obj.narration as Record<string, unknown>
      const t = String(n.type ?? '')
      narration = {
        ...(t === 'tts' || t === 'human' || t === 'mixed' || t === 'none' ? { type: t } : {}),
        ...(typeof n.voice === 'string' ? { voice: n.voice } : {}),
        ...(typeof n.style === 'string' ? { style: n.style } : {})
      }
    }
    let cast: WholeVideoAnalysis['cast']
    if (obj.cast && typeof obj.cast === 'object') {
      const rawCast = obj.cast as Record<string, unknown>
      const toShotIds = (v: unknown): string[] =>
        (Array.isArray(v) ? v : v != null ? [v] : [])
          .map((x) => String(x ?? '').trim())
          .filter(Boolean)
      const characters: NonNullable<WholeVideoAnalysis['cast']>['characters'] = []
      if (Array.isArray(rawCast.characters)) {
        rawCast.characters.forEach((c, idx) => {
          if (!c || typeof c !== 'object') return
          const r = c as Record<string, unknown>
          const name = String(r.name ?? '').trim()
          if (!name) return
          const k = String(r.kind ?? 'human')
            .trim()
            .toLowerCase()
          characters.push({
            id: String(r.id ?? `C${idx + 1}`).trim() || `C${idx + 1}`,
            name,
            kind:
              k === 'character' || k === 'avatar' || k === 'animal' || k === 'human' ? k : 'human',
            look: String(r.look ?? '').trim() || '保持统一服装、发型与面部特征一致', // cjk-ok
            ...(typeof r.role === 'string' && r.role.trim() ? { role: r.role.trim() } : {}),
            ...(typeof r.voice === 'string' && r.voice.trim() ? { voice: r.voice.trim() } : {}),
            refTag: `@图片${idx + 1}`, // cjk-ok
            shotIds: toShotIds(r.shotIds ?? r.shots)
          })
        })
      }
      const scenes: NonNullable<WholeVideoAnalysis['cast']>['scenes'] = []
      if (Array.isArray(rawCast.scenes)) {
        rawCast.scenes.forEach((sc, idx) => {
          if (!sc || typeof sc !== 'object') return
          const r = sc as Record<string, unknown>
          const where = String(r.where ?? r.name ?? '').trim()
          if (!where) return
          scenes.push({
            id: String(r.id ?? `SC${idx + 1}`).trim() || `SC${idx + 1}`,
            where,
            ...(typeof r.when === 'string' && r.when.trim() ? { when: r.when.trim() } : {}),
            look: String(r.look ?? '').trim() || '统一环境光线与色调', // cjk-ok
            shotIds: toShotIds(r.shotIds ?? r.shots)
          })
        })
      }
      const props: NonNullable<WholeVideoAnalysis['cast']>['props'] = []
      if (Array.isArray(rawCast.props)) {
        rawCast.props.forEach((pr, idx) => {
          if (!pr || typeof pr !== 'object') return
          const r = pr as Record<string, unknown>
          const name = String(r.name ?? '').trim()
          if (!name) return
          props.push({
            id: String(r.id ?? `P${idx + 1}`).trim() || `P${idx + 1}`,
            name,
            ...(typeof r.note === 'string' && r.note.trim() ? { note: r.note.trim() } : {}),
            ...(typeof r.realMaterial === 'boolean' ? { realMaterial: r.realMaterial } : {}),
            shotIds: toShotIds(r.shotIds ?? r.shots)
          })
        })
      }
      if (characters.length || scenes.length || props.length) {
        cast = { characters, scenes, props }
      }
    }
    return {
      summary: str('summary'),
      format: str('format'),
      hook: str('hook'),
      overallProduction: str('overallProduction'),
      ...(segments.length ? { segments } : {}),
      ...(narration ? { narration } : {}),
      ...(cast ? { cast } : {})
    }
  } catch {
    return null
  }
}
