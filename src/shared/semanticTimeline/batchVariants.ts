/**
 * 1-to-N 视频批量变体矩阵编译器（Batch Variant Matrix）
 *
 * 对标并超越 hypit-ai/hypit 的「1 条工作流 → 100 条变体」能力：
 * - 支持在 `semantic.rebuild`（语义重建节点）与 `ScriptTimeline`（成片时间线）上传入多组变体配置 `SemanticBatchVariantSpec[]`；
 * - 每个变体可独立覆盖：
 *   1. `instruction`：整片角色/画风/场景补充指令（如「把主播换成穿黑色哥特裙的女孩」）
 *   2. `dubVoice`：配音音色覆盖
 *   3. `dialogueOverrides`：按台词 ID / 镜头序号 / 原台词子串替换新文案（支持 `@{tag}关键词@{/tag}` 词级锚点自动重对齐）
 *   4. `shotPromptOverrides`：按镜头 ID 覆盖生成提示词
 *   5. `entityReferenceOverrides`：按实体 ID 或实体名称替换参考图（资产 ID 或工程相对路径）
 * - 智能增量编译：仅被变体修改波及的镜头自动转为 `regenerate`，未波及的镜头保持 `passthrough` 直通或复用缓存，最大化降低出片成本。
 */

import type { ScriptTimelineDocument } from '../graph/scriptTimeline'
import type { TimelineSubtitleKaraokeMode } from '../graph/timelineWordCue'
import { parseInlineCueText, syncTimelineCueAnchors } from '../graph/timelineWordCue'
import {
  combinePlanFullPrompt,
  type DubLine,
  type PlanSubtitle,
  type VideoPromptPlan
} from './promptPlan'

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
    titleZh: '主播人设裂变（3 组风格）',
    titleEn: 'Persona Swap (3 Styles)',
    specs: [
      {
        id: 'persona-cyber',
        title: '赛博霓虹科技博主',
        instruction: '主持人变为赛博朋克霓虹风格的科技博主，背景带全息发光屏幕',
        dubVoice: 'alloy'
      },
      {
        id: 'persona-anime',
        title: '二次元动漫主理人',
        instruction: '画面转为高品质二次元新海诚动画风格，角色表情生动鲜明',
        dubVoice: 'nova'
      },
      {
        id: 'persona-cat',
        title: '萌宠猫咪拟人主播',
        instruction: '主持人替换为穿连帽衫的拟人化可爱橘猫主播，对着麦克风认真讲解',
        dubVoice: 'shimmer'
      }
    ]
  },
  {
    id: 'hook-ab-test',
    titleZh: '黄金前 3 秒钩子 A/B 裂变',
    titleEn: '3-Second Hook A/B Test',
    specs: [
      {
        id: 'hook-painpoint',
        title: '痛点暴击版钩子',
        dialogueOverrides: {
          '#1': '别再花冤枉钱了！@{highlight}90%的人@{/highlight}第一步就选错了！'
        }
      },
      {
        id: 'hook-ranking',
        title: '悬念榜单版钩子',
        dialogueOverrides: {
          '#1': '今天把市面上最火的几款放到 @{highlight}S到D级梯度榜@{/highlight} 真实处刑！'
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

/**
 * 将单条变体规格应用到基础 `VideoPromptPlan`，生成独立可执行的派生提示词计划。
 */
export function applyVariantToPromptPlan(
  basePlan: VideoPromptPlan,
  variant: SemanticBatchVariantSpec
): VideoPromptPlan {
  const sep = basePlan.lang === 'zh' ? '。' : '. '
  const extraInst = variant.instruction?.trim() ?? ''

  const shots = basePlan.shots.map((shot) => {
    let prompt = shot.prompt
    let changed = false
    const reasons = [...(shot.changeReasons ?? [])]

    const shotOverride = variant.shotPromptOverrides?.[shot.shotId]
    if (shotOverride) {
      prompt = shotOverride
      changed = true
      if (!reasons.includes('variant:prompt')) reasons.push('variant:prompt')
    }

    if (extraInst && prompt && !prompt.includes(extraInst)) {
      prompt = `${prompt}${sep}${extraInst}`
      changed = true
      if (!reasons.includes('variant:instruction')) reasons.push('variant:instruction')
    }

    let replacements = shot.replacements ? shot.replacements.map((r) => ({ ...r })) : undefined
    if (variant.entityReferenceOverrides && replacements?.length) {
      replacements = replacements.map((rep) => {
        const refOverride =
          variant.entityReferenceOverrides?.[rep.entityId] ??
          variant.entityReferenceOverrides?.[rep.entityName]
        if (!refOverride) return rep
        changed = true
        if (!reasons.includes('variant:entity')) reasons.push('variant:entity')
        const isAsset =
          !refOverride.includes('/') &&
          !refOverride.includes('\\') &&
          !/\.[a-z0-9]+$/i.test(refOverride)
        return {
          ...rep,
          references: [
            isAsset
              ? { assetId: refOverride, label: rep.entityName }
              : { relativePath: refOverride, label: rep.entityName }
          ]
        }
      })
    }

    return {
      ...shot,
      prompt,
      ...(replacements ? { replacements } : {}),
      strategy: changed ? ('regenerate' as const) : shot.strategy,
      ...(reasons.length ? { changeReasons: reasons } : {})
    }
  })

  // 处理字幕与配音覆盖（自动剥离 @{tag} 内联标记作为纯净 TTS 输入与字幕展示文本）
  const baseSubs: PlanSubtitle[] = (basePlan.subtitles ?? []).map((s) => ({ ...s }))
  const dubByRangeKey = new Map<string, DubLine>()
  for (const d of basePlan.dubs ?? []) {
    const key = `${d.sourceStartSec.toFixed(2)}:${d.sourceEndSec.toFixed(2)}`
    dubByRangeKey.set(key, {
      ...d,
      ...(variant.dubVoice ? { voice: variant.dubVoice } : {})
    })
  }

  const nextSubtitles: PlanSubtitle[] = baseSubs.map((sub, idx) => {
    const lineId = `utt.${idx + 1}`
    const overrideRaw = matchDialogueOverride(variant.dialogueOverrides, lineId, idx, sub.text)
    if (!overrideRaw) {
      const clean = parseInlineCueText(sub.text).cleanText || sub.text
      return { ...sub, text: clean }
    }
    const cleanText = parseInlineCueText(overrideRaw).cleanText || overrideRaw
    const key = `${sub.sourceStartSec.toFixed(2)}:${sub.sourceEndSec.toFixed(2)}`
    const existingDub = dubByRangeKey.get(key)
    dubByRangeKey.set(key, {
      id: existingDub?.id ?? lineId,
      sourceStartSec: sub.sourceStartSec,
      sourceEndSec: sub.sourceEndSec,
      text: cleanText,
      sourceText: existingDub?.sourceText ?? sub.text,
      ...(variant.dubVoice
        ? { voice: variant.dubVoice }
        : existingDub?.voice
          ? { voice: existingDub.voice }
          : {}),
      ...(existingDub?.referenceAudio ? { referenceAudio: existingDub.referenceAudio } : {})
    })
    return {
      ...sub,
      text: cleanText
    }
  })

  // 若 basePlan 没有 subtitles 但有 dubs，同样应用 dialogueOverrides
  for (const [idx, d] of [...dubByRangeKey.values()].entries()) {
    const overrideRaw = matchDialogueOverride(variant.dialogueOverrides, d.id, idx, d.text)
    if (overrideRaw) {
      const cleanText = parseInlineCueText(overrideRaw).cleanText || overrideRaw
      const key = `${d.sourceStartSec.toFixed(2)}:${d.sourceEndSec.toFixed(2)}`
      dubByRangeKey.set(key, {
        ...d,
        text: cleanText,
        ...(variant.dubVoice ? { voice: variant.dubVoice } : {})
      })
    }
  }

  const nextDubs = [...dubByRangeKey.values()].sort((a, b) => a.sourceStartSec - b.sourceStartSec)

  return {
    ...basePlan,
    shots,
    fullPrompt: combinePlanFullPrompt(shots, basePlan.lang),
    ...(nextSubtitles.length ? { subtitles: nextSubtitles } : {}),
    ...(nextDubs.length ? { dubs: nextDubs } : {})
  }
}

/**
 * 将批量变体配置应用到 `ScriptTimelineDocument`（成片时间线）：
 * 替换带 `@{tag}` 的新台词后，自动调用 `syncTimelineCueAnchors` 重新对齐所有 B-Roll 弹窗、动态组件与音效！
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
