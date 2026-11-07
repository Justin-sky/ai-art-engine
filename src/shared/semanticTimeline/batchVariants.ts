/**
 * 1-to-N 视频批量变体矩阵编译器（Batch Variant Matrix）
 *
 * 直接基于 `SemanticTimeline` 与 `ScriptTimelineDocument` 派生多组变体配置：
 * - `instruction`：整片角色/画风/场景补充指令
 * - `dubVoice`：配音音色覆盖
 * - `dialogueOverrides`：按台词 ID / 镜头序号 `#1` / 原台词子串替换新文案（自动剥离 `@{tag}` 词级锚点）
 * - `shotPromptOverrides`：按镜头 ID 覆盖生成提示词
 * - `entityReferenceOverrides`：按实体 ID 或实体名称替换参考图（资产 ID 或工程相对路径）
 */

import type { ScriptTimelineDocument } from '../graph/scriptTimeline'
import type { TimelineSubtitleKaraokeMode } from '../graph/timelineWordCue'
import { parseInlineCueText, syncTimelineCueAnchors } from '../graph/timelineWordCue'
import { finalizeSemanticBreakdown } from './reaPlan'
import type { Entity, SemanticTimeline } from './types'

export interface SemanticBatchVariantSpec {
  /** 变体唯一标识（如 "goth-persona"、"hook-b"、"en-us"） */
  id: string
  /** 变体可读标题 */
  title?: string
  /** 覆盖或追加的整片画面生成指令 */
  instruction?: string
  /** 覆盖配音音色 */
  dubVoice?: string
  /** 台词替换表（键支持台词 id、镜头序号 `#1`、`"*"` 或原台词子串；值支持 `@{tag}` 内联锚点） */
  dialogueOverrides?: Record<string, string>
  /** 镜头提示词替换表（键为 `shotId`，如 `"shot.1"`） */
  shotPromptOverrides?: Record<string, string>
  /** 实体参考图替换表（键为 `entityId` 或 `entityName`，值为新参考图 `assetId` 或 `relativePath`） */
  entityReferenceOverrides?: Record<string, string>
  /** 可选覆盖的字幕逐词高亮（Karaoke）样式 */
  subtitleKaraokeMode?: TimelineSubtitleKaraokeMode
}

export interface SemanticBatchVariantRunItem {
  id: string
  title: string
  outputRelativePath: string
  generatedShots: number
  passthroughShots: number
  dubbedLines: number
}

export const BUILTIN_BATCH_VARIANT_TEMPLATES: ReadonlyArray<{
  id: string
  titleZh: string
  titleEn: string
  specs: SemanticBatchVariantSpec[]
}> = [
  {
    id: 'persona-swap',
    titleZh: '主播人设裂变（3 组风格）', // cjk-ok
    titleEn: 'Persona Swap (3 Styles)',
    specs: [
      {
        id: 'persona-cyber',
        title: '赛博霓虹科技博主', // cjk-ok
        instruction: '主持人变为赛博朋克霓虹风格的科技博主，背景带全息发光屏幕', // cjk-ok
        dubVoice: 'alloy'
      },
      {
        id: 'persona-anime',
        title: '二次元动漫主理人', // cjk-ok
        instruction: '画面转为高品质二次元新海诚动画风格，角色表情生动鲜明', // cjk-ok
        dubVoice: 'nova'
      },
      {
        id: 'persona-cat',
        title: '萌宠猫咪拟人主播', // cjk-ok
        instruction: '主持人替换为穿连帽衫的拟人化可爱橘猫主播，对着麦克风认真讲解', // cjk-ok
        dubVoice: 'shimmer'
      }
    ]
  },
  {
    id: 'hook-ab-test',
    titleZh: '黄金前 3 秒钩子 A/B 裂变', // cjk-ok
    titleEn: '3-Second Hook A/B Test',
    specs: [
      {
        id: 'hook-painpoint',
        title: '痛点暴击版钩子', // cjk-ok
        dialogueOverrides: {
          '#1': '别再花冤枉钱了！@{highlight}90%的人@{/highlight}第一步就选错了！' // cjk-ok
        }
      },
      {
        id: 'hook-ranking',
        title: '悬念榜单版钩子', // cjk-ok
        dialogueOverrides: {
          '#1': '今天把市面上最火的几款放到 @{highlight}S到D级梯度榜@{/highlight} 真实处刑！' // cjk-ok
        }
      }
    ]
  }
]

function sanitizeStringMap(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const key = String(k ?? '').trim()
    const val = typeof v === 'string' ? v.trim() : ''
    if (key && val) out[key] = val
  }
  return Object.keys(out).length ? out : undefined
}

/**
 * 解析并校验批量变体配置列表（支持 JSON 字符串或对象数组）。
 */
export function parseBatchVariantSpecs(raw: unknown): SemanticBatchVariantSpec[] {
  let list: unknown[] = []
  if (Array.isArray(raw)) {
    list = raw
  } else if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) list = parsed
    } catch {
      return []
    }
  }
  const usedIds = new Set<string>()
  const out: SemanticBatchVariantSpec[] = []
  list.forEach((item, idx) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return
    const obj = item as Record<string, unknown>
    const rawId = String(obj.id ?? `variant-${idx + 1}`)
      .trim()
      .replace(/[^a-zA-Z0-9_.-]/g, '-')
    const id = rawId || `variant-${idx + 1}`
    const uniqueId = usedIds.has(id) ? `${id}-${idx + 1}` : id
    usedIds.add(uniqueId)

    const instruction = typeof obj.instruction === 'string' ? obj.instruction.trim() : ''
    const dubVoice = typeof obj.dubVoice === 'string' ? obj.dubVoice.trim() : ''
    const dialogueOverrides = sanitizeStringMap(obj.dialogueOverrides)
    const shotPromptOverrides = sanitizeStringMap(obj.shotPromptOverrides)
    const entityReferenceOverrides = sanitizeStringMap(obj.entityReferenceOverrides)
    const rawKaraoke =
      typeof obj.subtitleKaraokeMode === 'string' ? obj.subtitleKaraokeMode.trim() : ''
    const subtitleKaraokeMode: TimelineSubtitleKaraokeMode | undefined =
      rawKaraoke === 'none' ||
      rawKaraoke === 'karaoke-pill' ||
      rawKaraoke === 'karaoke-pop' ||
      rawKaraoke === 'karaoke-glow' ||
      rawKaraoke === 'word-solo'
        ? rawKaraoke
        : undefined

    if (
      !instruction &&
      !dubVoice &&
      !dialogueOverrides &&
      !shotPromptOverrides &&
      !entityReferenceOverrides &&
      !subtitleKaraokeMode
    ) {
      return
    }

    out.push({
      id: uniqueId,
      ...(typeof obj.title === 'string' && obj.title.trim() ? { title: obj.title.trim() } : {}),
      ...(instruction ? { instruction } : {}),
      ...(dubVoice ? { dubVoice } : {}),
      ...(dialogueOverrides ? { dialogueOverrides } : {}),
      ...(shotPromptOverrides ? { shotPromptOverrides } : {}),
      ...(entityReferenceOverrides ? { entityReferenceOverrides } : {}),
      ...(subtitleKaraokeMode ? { subtitleKaraokeMode } : {})
    })
  })
  return out
}

function matchDialogueOverride(
  overrides: Record<string, string> | undefined,
  lineId: string,
  indexZeroBased: number,
  currentText: string
): string | undefined {
  if (!overrides) return undefined
  if (overrides[lineId]) return overrides[lineId]
  const hashKey = `#${indexZeroBased + 1}`
  if (overrides[hashKey]) return overrides[hashKey]
  if ('0' in overrides) {
    if (overrides[String(indexZeroBased)]) return overrides[String(indexZeroBased)]
  } else {
    if (overrides[String(indexZeroBased + 1)]) return overrides[String(indexZeroBased + 1)]
  }
  if (overrides['*'] && indexZeroBased === 0) return overrides['*']
  for (const [pattern, replacement] of Object.entries(overrides)) {
    if (pattern.length >= 2 && currentText.includes(pattern)) {
      return replacement
    }
  }
  return undefined
}

export interface VariantTimelineResult {
  timeline: SemanticTimeline
  instruction?: string
  dubVoice?: string
  /** True when the variant supplies a whole-video persona/style instruction without targeting single shots */
  promotesToAdapt: boolean
}

/**
 * 将单条变体规格直接应用到 `SemanticTimeline`，保留原 `baseline` 以便自动精准识别脏镜头与脏台词。
 */
export function applyBatchVariantToTimeline(
  baseDoc: SemanticTimeline,
  variant: SemanticBatchVariantSpec
): VariantTimelineResult {
  const baseline = baseDoc.baseline
  let touchedVisual = false

  const entities: Entity[] = (baseDoc.entities ?? []).map((ent) => {
    const refOverride =
      variant.entityReferenceOverrides?.[ent.id] ?? variant.entityReferenceOverrides?.[ent.name]
    if (!refOverride) return ent
    touchedVisual = true
    const isAsset =
      !refOverride.includes('/') &&
      !refOverride.includes('\\') &&
      !/\.[a-z0-9]+$/i.test(refOverride)
    const refItem = isAsset
      ? { assetId: refOverride, label: ent.name }
      : { relativePath: refOverride, label: ent.name }
    return {
      ...ent,
      replacement: {
        instruction: ent.replacement?.instruction ?? '',
        references: [refItem],
        masks: ent.replacement?.masks ?? []
      }
    }
  })

  const shots = (baseDoc.shots ?? []).map((shot) => {
    const shotOverride = variant.shotPromptOverrides?.[shot.id]
    if (!shotOverride) return shot
    touchedVisual = true
    return {
      ...shot,
      promptOverride: shotOverride,
      origin: 'user' as const
    }
  })

  const dialogue = (baseDoc.dialogue ?? []).map((line, idx) => {
    const overrideRaw = matchDialogueOverride(variant.dialogueOverrides, line.id, idx, line.text)
    if (!overrideRaw) return line
    const cleanText = parseInlineCueText(overrideRaw).cleanText || overrideRaw
    return {
      ...line,
      text: cleanText,
      origin: 'user' as const
    }
  })

  const edits = [...(baseDoc.edits ?? [])]
  if (variant.entityReferenceOverrides) {
    for (const ent of entities) {
      if (variant.entityReferenceOverrides[ent.id] || variant.entityReferenceOverrides[ent.name]) {
        edits.push({
          id: `edit.var.${variant.id}.${ent.id}`,
          op: 'entity.replace',
          target: ent.id,
          patch: {},
          origin: 'user',
          at: baseDoc.updatedAt
        })
      }
    }
  }

  let nextDoc: SemanticTimeline = {
    ...baseDoc,
    entities,
    shots,
    dialogue,
    edits
  }
  if (nextDoc.breakdown) {
    nextDoc = finalizeSemanticBreakdown(nextDoc)
  }
  if (baseline) {
    nextDoc = { ...nextDoc, baseline }
  }

  const instruction = variant.instruction?.trim() || undefined
  const dubVoice = variant.dubVoice?.trim() || undefined
  const promotesToAdapt = Boolean(instruction && !touchedVisual)

  return {
    timeline: nextDoc,
    ...(instruction ? { instruction } : {}),
    ...(dubVoice ? { dubVoice } : {}),
    promotesToAdapt
  }
}

/**
 * 将批量变体配置应用到 `ScriptTimelineDocument`（成片时间线）：
 * 替换带 `@{tag}` 的新台词后，自动调用 `syncTimelineCueAnchors` 重新对齐所有 B-Roll 弹窗、动态组件与音效。
 */
export function buildScriptTimelineBatchVariants(
  baseDoc: ScriptTimelineDocument,
  specs: ReadonlyArray<SemanticBatchVariantSpec>
): Array<{ id: string; title: string; document: ScriptTimelineDocument }> {
  return specs.map((spec) => {
    let subIdx = 0
    const nextClips = (baseDoc.clips ?? []).map((clip) => {
      if (clip.track === 'subtitle') {
        const currentIdx = subIdx++
        const currentRaw = clip.rawCueText || clip.text || clip.title || ''
        const override = matchDialogueOverride(
          spec.dialogueOverrides,
          clip.id,
          currentIdx,
          currentRaw
        )
        if (override) {
          return {
            ...clip,
            rawCueText: override,
            text: override,
            words: undefined
          }
        }
      }
      return { ...clip }
    })

    const synced = syncTimelineCueAnchors(nextClips)
    return {
      id: spec.id,
      title: spec.title || spec.id,
      document: {
        ...baseDoc,
        ...(spec.subtitleKaraokeMode
          ? {
              settings: {
                ...baseDoc.settings,
                subtitleKaraokeMode: spec.subtitleKaraokeMode
              }
            }
          : {}),
        clips: synced.clips
      }
    }
  })
}
