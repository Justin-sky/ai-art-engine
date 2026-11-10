import type { GraphNode } from '../types'
import { isAssetRefNode } from '../nodeRole'
import { expandInstructionMentions, instructionHasMentions } from '../instructionMentions'
import {
  extractSharedScreenplayHeader,
  splitScreenplayByExplicitEpisodeMarkers
} from '../screenplayFormat'
import { buildManjuScreenplayDirective, resolveManjuGenre } from '../film/manjuGenres'
import {
  resolveGameSystemSystemPrompt,
  resolveNovelOutlineSystemPrompt,
  resolveNovelSystemPrompt,
  resolveScreenplaySystemPrompt,
  resolveToPromptSystemPrompt
} from '../systemPromptSchemes'
import {
  buildNovelPrompt,
  buildScreenplayPrompt,
  defaultGameSystemUserPrompt,
  defaultNovelOutlineUserPrompt,
  defaultNovelUserPrompt,
  buildToPromptUserPrompt
} from '../userPromptSchemes'
import { resolveAssetTextFromGenParams } from '../assetText'
import {
  buildNovelForeshadowingAndRosterPromptBlock,
  buildNovelGenreDirectiveBlock,
  createDefaultNovelCharacterRoster,
  createDefaultNovelForeshadowingPool,
  createMxFromTemplate,
  createMxWorkbenchPreset,
  createXianxia200LifespanWorkbench,
  exportMxChapterEconomySlice,
  exportMxEconomyResourceNarrativeSpec,
  exportMxNarrativeProgressionBrief,
  extractNovelIpContextForGameSystem,
  generateMxArcChapterOutlinePlan,
  generateMxFullLifecycleArcScheduleMarkdown,
  inferGameSystemArchetypeFromContext,
  inferNovelGenreFromText,
  isGameSystemArchetypeId,
  normalizeNovelCharacterRoster,
  normalizeNovelForeshadowingPool,
  parseMxDocumentJson,
  resolveGameSystemArchetype,
  resolveNovelGenreProfile,
  synthesizeGameSystemDocOffline,
  synthesizeGenreNovelChapterOffline,
  unwrapEconomyBundleForGameSystem,
  unwrapEconomyBundleForNarrative,
  type MxNovelCharacterStatusEntry,
  type MxNovelForeshadowingEntry,
  type MxTemplateId,
  type NovelGenreProfile
} from '../../gameAssets'
import type { GraphTextItem, GraphValue, NodeExecuteContext } from './types'
import {
  dualTextGalleryOutputs,
  flattenAssetValues,
  flattenImagesValues,
  flattenTextValues
} from './gallery'
import { hydrateTextItems } from './helpers'
import { autoIncomingTextForInstruction, selectIncomingValuesForInstruction } from './incoming'
import { commitInMemoryTextGallery, persistScreenplayGeneration } from './materialize'
import { normalizeLocalScreenplayText, resolveMentionSources } from './context'
import { fail } from '@shared/errors/appError'
import { SHARED_ERRORS } from '../../errors/catalog'

const CN_DIGIT_MAP: Record<string, number> = {
  零: 0,
  〇: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9
}

export function parseChineseOrArabicChapterInt(raw: string): number | null {
  const token = (raw ?? '').trim()
  if (!token) return null
  if (/^\d+$/.test(token)) {
    const n = Number(token)
    return Number.isFinite(n) && n >= 1 ? Math.floor(n) : null
  }
  let total = 0
  let current = 0
  for (const ch of token) {
    if (ch in CN_DIGIT_MAP) {
      current = CN_DIGIT_MAP[ch]!
    } else if (ch === '十') {
      total += (current || 1) * 10
      current = 0
    } else if (ch === '百') {
      total += (current || 1) * 100
      current = 0
    } else if (ch === '千') {
      total += (current || 1) * 1000
      current = 0
    } else {
      return null
    }
  }
  const result = total + current
  return result >= 1 ? result : null
}

/**
 * 从节点标题或生成指令中提取显式的单章章号（如「第1章」「第2/868章」「第三章」「Chapter 2」「Ch.3」）。
 * 自动排除范围型或总纲型表述（如「第1-10章」「第1~3章」「868章分卷总纲」）。
 */
export function inferExplicitNovelChapterNumber(
  title?: string,
  instruction?: string
): number | null {
  const parseFromSource = (src: string | undefined): number | null => {
    const raw = (src ?? '').trim()
    if (!raw) return null
    if (
      raw === defaultNovelUserPrompt('zh-CN').trim() ||
      raw === defaultNovelUserPrompt('en-US').trim() ||
      raw === defaultNovelOutlineUserPrompt('zh-CN').trim() ||
      raw === defaultNovelOutlineUserPrompt('en-US').trim()
    ) {
      return null
    }
    // 剔除「第1-3章 / 第1章~第3章 / 第1至5章 / Chapter 1-3」等范围表达后再匹配单章章号
    const s = raw
      .replace(
        /第\s*[0-9一二三四五六七八九十百千两〇零]+\s*(?:章\s*)?[\-~～—至到]+\s*(?:第\s*)?[0-9一二三四五六七八九十百千两〇零]+\s*章/gi, // cjk-ok
        ' '
      )
      .replace(
        /\b(?:chapter|chap|ch)\.?\s*\d+\s*(?:[\-~～—]|to)\s*(?:(?:chapter|chap|ch)\.?\s*)?\d+\b/gi,
        ' '
      )
    const zhMatch = /第\s*([0-9一二三四五六七八九十百千两〇零]+)\s*(?:\/\s*\d+\s*)?章/i.exec(s) // cjk-ok
    if (zhMatch?.[1]) {
      const n = parseChineseOrArabicChapterInt(zhMatch[1])
      if (n !== null) return n
    }
    const enMatch = /\b(?:chapter|chap|ch)\.?\s*(\d+)\b/i.exec(s)
    if (enMatch?.[1]) {
      const n = Number(enMatch[1])
      if (Number.isFinite(n) && n >= 1) return Math.floor(n)
    }
    return null
  }
  return parseFromSource(title) ?? parseFromSource(instruction)
}

/**
 * 判断 `asset.novel` 节点是否为「小说创意 / 世界观设定集 / 分卷总纲」模式节点（而非单章正文连载节点）。
 */
export function isOutlineNovelNodeTitle(title?: string, instruction?: string): boolean {
  const t = (title ?? '').trim()
  if (inferExplicitNovelChapterNumber(t, undefined) !== null) {
    return false
  }
  if (/总纲|大纲|分卷|世界观|设定集|构思|企划|故事梗概|bible|outline/i.test(t)) {
    // cjk-ok
    return true
  }
  const inst = (instruction ?? '').trim()
  if (
    (!t || t === '创建小说' || /^novel$/i.test(t)) && // cjk-ok
    inst &&
    inferExplicitNovelChapterNumber(undefined, inst) === null &&
    /(?:撰写|生成|输出|构建|设计)[^。\n]{0,18}(?:分卷总纲|全书大纲|章节大纲|世界观设定集)/i.test(
      inst
    ) // cjk-ok
  ) {
    return true
  }
  return false
}

export function resolveNovelNodeExecutionMode(
  node: Pick<GraphNode, 'typeId' | 'title' | 'params'>
): 'outline' | 'chapter' {
  if (node.typeId === 'novel.outline') return 'outline'
  if (node.params.novelNodeMode === 'outline') return 'outline'
  if (isOutlineNovelNodeTitle(node.title, node.params.generateInstruction)) return 'outline'
  if (node.params.novelNodeMode === 'chapter') return 'chapter'
  return 'chapter'
}

interface OutlineRangeArcBlock {
  startChapter: number
  endChapter: number
  heading: string
  body: string
}

function parseOutlineRangeArcBlocks(rawOutline: string): OutlineRangeArcBlock[] {
  const lines = rawOutline.split(/\r?\n/)
  const blocks: OutlineRangeArcBlock[] = []
  let active: OutlineRangeArcBlock | null = null

  const zhRangeRe =
    /第\s*([0-9一二三四五六七八九十百千两〇零]+)\s*(?:章\s*)?[\-~～—至到]+\s*(?:第\s*)?([0-9一二三四五六七八九十百千两〇零]+)\s*章/i // cjk-ok
  const enRangeRe =
    /\b(?:chapters?|chaps?|ch)\.?\s*(\d+)\s*(?:[\-~～—]|to)\s*(?:(?:chapters?|chaps?|ch)\.?\s*)?(\d+)\b/i
  const singleChapHeadingRe =
    /^(?:#+\s*)?(?:第\s*[0-9一二三四五六七八九十百千两〇零]+\s*(?:\/\s*\d+\s*)?章(?:[:：\s—\-]|$)|(?:chapter|chap|ch)\.?\s*\d+(?:\s*\/\s*\d+)?(?:[:：\s—\-]|$))/i // cjk-ok

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line || line.startsWith('|')) continue

    const zhM = zhRangeRe.exec(line)
    const enM = !zhM ? enRangeRe.exec(line) : null
    if (zhM?.[1] && zhM?.[2]) {
      const start = parseChineseOrArabicChapterInt(zhM[1])
      const end = parseChineseOrArabicChapterInt(zhM[2])
      if (start !== null && end !== null && end >= start) {
        if (active) blocks.push(active)
        active = {
          startChapter: start,
          endChapter: end,
          heading: line.replace(/^[-*#]+\s*/, '').trim(),
          body: line
        }
        continue
      }
    } else if (enM?.[1] && enM?.[2]) {
      const start = Number(enM[1])
      const end = Number(enM[2])
      if (Number.isFinite(start) && Number.isFinite(end) && end >= start && start >= 1) {
        if (active) blocks.push(active)
        active = {
          startChapter: Math.floor(start),
          endChapter: Math.floor(end),
          heading: line.replace(/^[-*#]+\s*/, '').trim(),
          body: line
        }
        continue
      }
    }

    if (singleChapHeadingRe.test(line)) {
      if (active) {
        blocks.push(active)
        active = null
      }
      continue
    }

    if (active) {
      if (/^(?:#+\s*)?(?:【[^】]+】|第[一二三四五六七八九十0-9]+卷)/i.test(line)) {
        // cjk-ok
        blocks.push(active)
        active = null
      } else {
        active.body = `${active.body}\n${line}`
      }
    }
  }
  if (active) blocks.push(active)
  return blocks
}

function describeArcPhaseForChapter(
  targetChapter: number,
  startChapter: number,
  endChapter: number,
  isEn: boolean
): string {
  const span = Math.max(1, endChapter - startChapter)
  const ratio = Math.max(0, Math.min(1, (targetChapter - startChapter) / span))
  const microStep = Math.max(0, targetChapter - startChapter) % 4

  const microBeatEn = [
    'Micro-Beat [1/4 · Setup & New Friction]: Introduce a fresh local scene/obstacle or probe enemy weakness; forbid repeating the previous chapter venue.',
    'Micro-Beat [2/4 · Scheme & Escalation]: Antagonist/environment escalates pressure; protagonist maneuvers with allies or secures a tactical chip.',
    'Micro-Beat [3/4 · Opportunity & Poise]: Trigger a key discovery/resource breakthrough or decode the opponent core trump; push tension to boiling point.',
    'Micro-Beat [4/4 · Mini-Climax & Payoff]: 4-chapter unit climax! Unleash stage-allowed trump to crush the immediate blockade, harvest rewards, and hook the next sub-arc.'
  ][microStep]!

  const microBeatZh = [
    '四章微循环节拍【1/4 · 切入立规拍】：切入本卷新场景/新冲突切口，摸清对手底细或立下局部规矩（严禁停留在上一章旧场地重复口水战）', // cjk-ok
    '四章微循环节拍【2/4 · 设局博弈拍】：反派或环境危机加码施压，主角与盟友/次级势力展开筹码拉扯与反设局，夺取关键情报或局部先机', // cjk-ok
    '四章微循环节拍【3/4 · 机缘蓄势拍】：触发本阶段关键机缘/科技/功法突破或识破敌方杀招，将压迫感推至临界沸点，为高潮反杀蓄满势能', // cjk-ok
    '四章微循环节拍【4/4 · 小高潮清算拍】：四章单元高潮决战！动用本章准入底牌正面击穿当前阻碍，完成当众立威与筹码收割，并引出下一单元新危机' // cjk-ok
  ][microStep]!

  if (isEn) {
    const macroEn =
      ratio <= 0.25
        ? `Opening Phase (${Math.round(ratio * 100)}% of Ch.${startChapter}-${endChapter} arc — establish new conflict rules & initial friction)`
        : ratio <= 0.65
          ? `Rising Escalation Phase (${Math.round(ratio * 100)}% of Ch.${startChapter}-${endChapter} arc — deepen faction struggle & gather key leverage)`
          : ratio <= 0.88
            ? `Climax Breakthrough Phase (${Math.round(ratio * 100)}% of Ch.${startChapter}-${endChapter} arc — unleash stage-allowed trump card & turn the tables)`
            : `Arc Resolution & Next-Volume Hook Phase (${Math.round(ratio * 100)}% of Ch.${startChapter}-${endChapter} arc — settle current arc rewards & plant next-arc crisis)`
    return `${macroEn} | ${microBeatEn}`
  }

  const macroZh =
    ratio <= 0.25
      ? `区间起势切入期（位于第 ${startChapter}~${endChapter} 章区间的 ${Math.round(ratio * 100)}% 进度 —— 展开本卷新矛盾、立下局部博弈规矩）` // cjk-ok
      : ratio <= 0.65
        ? `区间中段博弈期（位于第 ${startChapter}~${endChapter} 章区间的 ${Math.round(ratio * 100)}% 进度 —— 冲突螺旋加码、多方势力拉扯与筹码积累）` // cjk-ok
        : ratio <= 0.88
          ? `区间高潮破局期（位于第 ${startChapter}~${endChapter} 章区间的 ${Math.round(ratio * 100)}% 进度 —— 引爆本阶段准入底牌、完成阶段性反杀立威）` // cjk-ok
          : `区间收官转折期（位于第 ${startChapter}~${endChapter} 章区间的 ${Math.round(ratio * 100)}% 进度 —— 清算本阶段战果，并抛出通往下一卷的高维悬念钩子）` // cjk-ok
  return `${macroZh} ｜ ${microBeatZh}`
}

export interface NarrowOutlineForChapterOptions {
  totalChapters?: number
  targetWords?: number
  genre?: NovelGenreProfile
}

/**
 * 当上游总纲节点（`novel.outline` 或总纲模式 `asset.novel`）直接连入单章节点 `C_t` 时，
 * 支持三级全生命周期自适应切片（Three-Tier Full-Lifecycle Outline Slicing）：
 * 1. **Tier 1（精确单章细纲匹配）**：若总纲中存在 `第 t 章` 专属细纲，提取【全局世界观与人物设定共享头】+【第 t 章专属细纲】+【下一章（第 t+1 章）衔接预告】，剥离其他无关单章；
 * 2. **Tier 2（分卷/章节区间自适应回退 + 确定性单章执行细纲合成）**：当连载推进到中后期（如第 25 章），而大纲节点仅输出了前几章单章细纲 + `第一卷（第1~30章）` / `第 21~30 章` 等区间总纲时，自动命中覆盖第 `t` 章的最精确分卷/区间大纲，并结合数值与经济曲线自动推演生成【第 `t` 章确定性单章执行细纲卡】；
 * 3. **Tier 3（跨区间全局延展 + 确定性单章执行细纲兜底）**：若连载章号超出大纲显式列出的单章细纲，自动提取全局世界观共享头并附上【第 `t` 章确定性单章执行细纲卡】，确保第 1 ~ `totalChapters` 章 100% 享有单章级大纲指令。
 */
export function narrowOutlineTextForChapter(
  rawOutline: string,
  targetChapter: number,
  locale?: string,
  options?: NarrowOutlineForChapterOptions
): string {
  const trimmed = (rawOutline ?? '').trim()
  if (!trimmed) return ''
  const isEn = (locale ?? '').toLowerCase().startsWith('en')
  const splitChaps = splitScreenplayByExplicitEpisodeMarkers(trimmed, {
    includeSharedBios: true,
    locale,
    skipStats: true
  })
  const resolveChapNum = (title: string, fallbackIndex: number): number => {
    const n = inferExplicitNovelChapterNumber(title, undefined)
    return n !== null ? n : fallbackIndex
  }

  const dynTotal = Math.max(
    targetChapter,
    Math.min(5000, Math.round(options?.totalChapters || 200))
  )
  const targetWords = Math.max(1000, Math.round(options?.targetWords || 3200))
  const isXianxiaLifespanOutline = /山海借命|借命契|残缺药经|续命丹/.test(trimmed) // cjk-ok
  const fallbackWb = isXianxiaLifespanOutline
    ? createXianxia200LifespanWorkbench()
    : createMxWorkbenchPreset('short_drama_progression')
  fallbackWb.roguelikeEnvelope.levelMax = dynTotal
  const arcPlanItems = generateMxArcChapterOutlinePlan(
    fallbackWb,
    targetChapter,
    dynTotal,
    targetWords,
    options?.genre
  )
  const exactChapterPlan = arcPlanItems.find((item) => item.chapter === targetChapter)
  const deterministicCard = exactChapterPlan
    ? isEn
      ? `### 🎯 [Chapter ${targetChapter}/${dynTotal} Deterministic Chapter Execution Card]\n${exactChapterPlan.outlinePromptEn}`
      : `### 🎯 【第 ${targetChapter}/${dynTotal} 章确定性单章执行细纲卡（大纲分卷 × 数值经济曲线联合推演）】\n${exactChapterPlan.outlinePromptZh}` // cjk-ok
    : ''

  const rangeBlocks = parseOutlineRangeArcBlocks(trimmed)
  const coveringBlocks = rangeBlocks
    .filter((b) => targetChapter >= b.startChapter && targetChapter <= b.endChapter)
    .sort((a, b) => a.endChapter - a.startChapter - (b.endChapter - b.startChapter))

  if (splitChaps.length >= 2) {
    const matchedIdx = splitChaps.findIndex(
      (ep) => resolveChapNum(ep.title, ep.index) === targetChapter
    )
    if (matchedIdx >= 0) {
      const matched = splitChaps[matchedIdx]!
      const nextEp = splitChaps[matchedIdx + 1]
      const primaryArc = coveringBlocks[0]
      const lines: string[] = isEn
        ? [
            `## 🗺️ [Chapter ${targetChapter} Specific Outline Slice (from Novel Outline Node)]`,
            `- **Target Chapter Heading**: ${matched.title}`,
            matched.text.trim()
          ]
        : [
            `## 🗺️ 【来自小说大纲节点的第 ${targetChapter} 章专属细纲切片 (Chapter ${targetChapter} Outline Slice)】`, // cjk-ok
            `- **本章细纲标题**: ${matched.title}`, // cjk-ok
            matched.text.trim()
          ]
      if (primaryArc && !matched.text.includes(primaryArc.heading)) {
        lines.push(
          isEn
            ? `### [Covering Arc Schedule (${primaryArc.heading})]\n${primaryArc.body.trim()}`
            : `### 【所属分幕排期与数值经济锚点（${primaryArc.heading}）】\n${primaryArc.body.trim()}` // cjk-ok
        )
      }
      if (deterministicCard) {
        lines.push(deterministicCard)
      }
      if (nextEp?.title) {
        lines.push(
          isEn
            ? `- **Next Chapter (Ch.${targetChapter + 1}) Transition Hook Preview (for cliffhanger setup ONLY; do NOT write Ch.${targetChapter + 1} events in this chapter)**: ${nextEp.title}`
            : `- **下一章（第 ${targetChapter + 1} 章）衔接方向预告（仅供本章章末断章钩子铺垫，严禁在本章提前展开下一章剧情）**: ${nextEp.title}` // cjk-ok
        )
      }
      return lines.join('\n\n')
    }
  }

  if (coveringBlocks.length > 0) {
    const primaryArc = coveringBlocks[0]!
    const broaderVolumeArc =
      coveringBlocks.length > 1 ? coveringBlocks[coveringBlocks.length - 1] : null
    const nextArc = rangeBlocks
      .filter((b) => b.startChapter > primaryArc.endChapter)
      .sort((a, b) => a.startChapter - b.startChapter)[0]
    const sharedHeader = extractSharedScreenplayHeader(trimmed).sharedHeader.trim()
    const phaseDesc = describeArcPhaseForChapter(
      targetChapter,
      primaryArc.startChapter,
      primaryArc.endChapter,
      isEn
    )

    const lines: string[] = isEn
      ? [
          `## 🗺️ [Chapter ${targetChapter} Volume / Arc Outline Slice (Hierarchical Range Fallback)]`,
          ...(sharedHeader ? [sharedHeader] : []),
          ...(broaderVolumeArc && broaderVolumeArc !== primaryArc
            ? [`- **Parent Volume Arc**: ${broaderVolumeArc.heading}`]
            : []),
          `- **Active Chapter Range Arc (Ch.${primaryArc.startChapter}–${primaryArc.endChapter})**:\n${primaryArc.body}`,
          `- **Chapter ${targetChapter} Pacing Phase in Arc**: ${phaseDesc}`,
          ...(deterministicCard ? [deterministicCard] : [])
        ]
      : [
          `## 🗺️ 【来自小说大纲节点的第 ${targetChapter} 章所属分卷/区间细纲切片 (Volume/Arc Outline Slice)】`, // cjk-ok
          ...(sharedHeader ? [sharedHeader] : []),
          ...(broaderVolumeArc && broaderVolumeArc !== primaryArc
            ? [`- **所属分卷总纲**: ${broaderVolumeArc.heading}`] // cjk-ok
            : []),
          `- **当前命中区间大纲（第 ${primaryArc.startChapter}~${primaryArc.endChapter} 章）**:\n${primaryArc.body}`, // cjk-ok
          `- **第 ${targetChapter} 章在当前区间内的叙事相位指令**: ${phaseDesc}`, // cjk-ok
          ...(deterministicCard ? [deterministicCard] : [])
        ]
    if (nextArc) {
      lines.push(
        isEn
          ? `- **Upcoming Arc Horizon (Ch.${nextArc.startChapter}–${nextArc.endChapter}, do NOT rush ahead)**: ${nextArc.heading}`
          : `- **后续区间远景预告（第 ${nextArc.startChapter}~${nextArc.endChapter} 章，严禁在本章提前透支）**: ${nextArc.heading}` // cjk-ok
      )
    }
    return lines.join('\n\n')
  }

  // Tier 3: 若既无精确单章匹配也无区间命中，但含多章单章块（如仅有第1-3章而当前是第4章），提取共享头 + 确定性单章执行细纲卡
  if (splitChaps.length >= 2) {
    const sharedHeader = extractSharedScreenplayHeader(trimmed).sharedHeader.trim()
    const lastDefined = splitChaps[splitChaps.length - 1]!
    const lastNum = resolveChapNum(lastDefined.title, lastDefined.index)
    if (sharedHeader && targetChapter > lastNum) {
      return isEn
        ? [
            `## 🗺️ [Chapter ${targetChapter} Global World Bible & Continuation Directive (from Novel Outline Node)]`,
            sharedHeader,
            `- **Progression Note**: Chapters 1–${lastNum} outlines are complete (latest: "${lastDefined.title}"). Advance the narrative naturally into Chapter ${targetChapter} following the global World Bible and current Markov state.`,
            ...(deterministicCard ? [deterministicCard] : [])
          ].join('\n\n')
        : [
            `## 🗺️ 【来自小说大纲节点的第 ${targetChapter} 章全局设定与延展指令 (Global Outline Continuation)】`, // cjk-ok
            sharedHeader,
            `- **连载延展提示**: 大纲节点前序单章细纲已推进至第 ${lastNum} 章（《${lastDefined.title}》），请严格遵循上述全书世界观设定集、单章执行细纲卡与上一章马尔可夫状态账本，推进第 ${targetChapter} 章剧情。`, // cjk-ok
            ...(deterministicCard ? [deterministicCard] : [])
          ].join('\n\n')
    }
  }

  return trimmed
}

async function hydrateGraphValueForTextConsumer(
  val: GraphValue,
  readRunText?: NodeExecuteContext['readRunText']
): Promise<GraphValue> {
  if (!readRunText) return val
  if (val.kind === 'text') {
    if (!val.text?.trim() && val.relativePath?.trim()) {
      const loaded = await readRunText(val.relativePath.trim())
      if (loaded?.trim()) {
        return { ...val, text: loaded }
      }
    }
    return val
  }
  if (val.kind === 'texts') {
    const needsHydrate = val.items.some((item) => !item.text?.trim() && item.relativePath?.trim())
    if (!needsHydrate) return val
    const hydratedItems = await hydrateTextItems(val.items, readRunText)
    return { ...val, items: hydratedItems }
  }
  return val
}

async function hydrateContextForTextConsumer(ctx: NodeExecuteContext): Promise<NodeExecuteContext> {
  if (!ctx.readRunText) return ctx
  const nextInputs: Record<string, GraphValue[]> = {}
  for (const [port, list] of Object.entries(ctx.inputs ?? {})) {
    nextInputs[port] = await Promise.all(
      (list ?? []).map((v) => hydrateGraphValueForTextConsumer(v, ctx.readRunText))
    )
  }
  const nextIncomingByIndex = ctx.incomingByIndex
    ? await Promise.all(
        ctx.incomingByIndex.map(async (entry) => ({
          ...entry,
          value: entry.value
            ? await hydrateGraphValueForTextConsumer(entry.value, ctx.readRunText)
            : entry.value
        }))
      )
    : undefined
  const baseMentionSources = resolveMentionSources({
    ...ctx,
    inputs: nextInputs,
    ...(nextIncomingByIndex ? { incomingByIndex: nextIncomingByIndex } : {})
  })
  const nextMentionSources = await Promise.all(
    baseMentionSources.map(async (ms, idx) => {
      const byIdxVal =
        nextIncomingByIndex?.find((e) => e.index === ms.index)?.value ??
        nextIncomingByIndex?.[idx]?.value
      const wasHydratedFromDisk =
        (byIdxVal?.kind === 'text' && Boolean(byIdxVal.relativePath?.trim())) ||
        (byIdxVal?.kind === 'texts' &&
          byIdxVal.items.some((it) => Boolean(it.relativePath?.trim())))
      if (ms.text?.trim() && !wasHydratedFromDisk) return ms
      if (byIdxVal?.kind === 'text' && byIdxVal.text?.trim()) {
        return { ...ms, text: byIdxVal.text }
      }
      if (byIdxVal?.kind === 'texts') {
        const joined = byIdxVal.items
          .map((item) => item.text?.trim() ?? '')
          .filter(Boolean)
          .join('\n\n')
        if (joined) return { ...ms, text: joined }
      }
      return ms
    })
  )
  return {
    ...ctx,
    inputs: nextInputs,
    ...(nextIncomingByIndex ? { incomingByIndex: nextIncomingByIndex } : {}),
    mentionSources: nextMentionSources
  }
}

export interface NovelChapterHistoryEntry {
  chapter: number
  title: string
  wordCount: number
  summary: string
  tailAnchor: string
  updatedAt: string
}

export function parseNovelChapterHistory(raw?: string): Record<string, NovelChapterHistoryEntry> {
  if (!raw || !raw.trim()) return {}
  try {
    const parsed = JSON.parse(raw) as Record<string, NovelChapterHistoryEntry>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

interface NovelChapterSynthesisOptions {
  currentChapter: number
  totalChapters: number
  targetWords: number
  worldBible?: string
  stateLedger?: string
  rollingSummary?: string
  prevTailAnchor?: string
  genre?: NovelGenreProfile
}

function synthesizeNovelFromProgressionBriefOffline(
  briefOrText: string,
  instructionHint: string,
  opts?: NovelChapterSynthesisOptions
): string {
  const raw = `${briefOrText}\n${instructionHint}`.trim()
  const hasProgressionBrief =
    raw.includes('角色成长体系与分集高潮冲突数值大纲') || // cjk-ok
    raw.includes('单章数值围栏与底牌配额锁') // cjk-ok
  if (!hasProgressionBrief && (!opts?.genre || opts.genre.id === 'urban_reversal')) {
    return ''
  }
  const curChap = Math.max(1, opts?.currentChapter ?? 1)
  const totalChaps = Math.max(curChap, opts?.targetWords ? (opts?.totalChapters ?? 800) : 800)
  const targetWords = Math.max(1000, opts?.targetWords ?? 3200)

  const realmMatch = /主角当前[^*]*\*\*([^*]+)\*\*/.exec(raw) // cjk-ok
  const ceilingMatch = /\*\*本章[^`]*上限\s*`([^`]+)`\*\*/.exec(raw) // cjk-ok
  const villainMatch = /\*\*本幕[^`]*\s*`([^`]+)`\*\*/.exec(raw) // cjk-ok
  const beatMatch = /\*\*本章戏剧节拍指令\*\*:\s*\*\*([^*]+)\*\*/.exec(raw) // cjk-ok
  const allowedMatch = /\*\*✅ 本章准入可用[^*]*\*\*:\s*([^\n]+)/.exec(raw) // cjk-ok
  const lockedMatch = /\*\*🔒 封存禁用的后期终局[^*]*\*\*:\s*([^\n]+)/.exec(raw) // cjk-ok
  const itemMatch = /\*\*🎁 本章推荐埋设\/触发的[^*]*\*\*:\s*([^\n]+)/.exec(raw) // cjk-ok
  const volMatch = /\*\*所属大卷篇章\*\*:\s*([^\n]+)/.exec(raw) // cjk-ok

  const genre = opts?.genre
  const defaultStage = genre
    ? `第 ${Math.floor((curChap - 1) / 20)} 阶·${genre.stageNamesZh[Math.min(genre.stageNamesZh.length - 1, Math.floor((curChap - 1) / 20))] ?? genre.stageNamesZh[0]}` // cjk-ok
    : `第 ${Math.floor((curChap - 1) / 20)} 阶·潜龙蜕变境` // cjk-ok
  const curRealm = realmMatch?.[1]?.trim() || defaultStage
  const curCeiling = ceilingMatch?.[1]?.trim() || String(35 + curChap * 12)
  const villainPress = villainMatch?.[1]?.trim() || String(30 + curChap * 10)
  const beatDesc =
    beatMatch?.[1]?.trim() || (genre ? genre.beats.setup_endure.labelZh : '起势铺垫与隐忍反击') // cjk-ok
  const allowedTrumps =
    allowedMatch?.[1]?.trim() ||
    (genre ? `【${genre.unlockItemsZh[0]}】` : '【系统百倍觉醒】、【甩出铁证】') // cjk-ok
  const lockedTrumps =
    lockedMatch?.[1]?.trim() ||
    (genre ? `【${genre.unlockItemsZh[genre.unlockItemsZh.length - 1]}】` : '【真身揭晓·全员震怖】') // cjk-ok
  const encounterItem =
    itemMatch?.[1]?.trim() || (genre ? `【${genre.encounterItemsZh[0]}】` : '【天命金手指觉醒】') // cjk-ok
  const volumeLabel =
    volMatch?.[1]?.trim() ||
    (genre
      ? `第 1 卷【${genre.volumeThemesZh[0]}】(第 1~${totalChaps} 章)` // cjk-ok
      : `第 1 卷【潜龙在渊】(第 1~${totalChaps} 章)`) // cjk-ok

  if (genre && genre.id !== 'urban_reversal') {
    return synthesizeGenreNovelChapterOffline(genre, {
      currentChapter: curChap,
      totalChapters: totalChaps,
      targetWords,
      stage: curRealm,
      ceiling: curCeiling,
      pressure: villainPress,
      allowed: allowedTrumps,
      locked: lockedTrumps,
      item: encounterItem,
      beatLabel: beatDesc,
      volumeLabel,
      prevTailAnchor: opts?.prevTailAnchor
    })
  }

  const prevHook = opts?.prevTailAnchor?.trim()
    ? `承接第 ${curChap - 1} 章末尾余波（“${opts.prevTailAnchor.trim().slice(-120)}”），` // cjk-ok
    : ''

  const chapterHeadings = [
    `订婚宴受辱与百倍系统觉醒`, // cjk-ok
    `奇遇信物震全场·江城首富躬身接驾`, // cjk-ok
    `名场面最优连招亮底牌·豪门当众审判`, // cjk-ok
    `暗流涌动·省域财阀围剿与反设局`, // cjk-ok
    `禁区拍卖会压轴竞价·百亿资金链瞬杀`, // cjk-ok
    `古武宗师踏江而来·一指震碎护族大阵` // cjk-ok
  ]
  const chapTitle =
    chapterHeadings[(curChap - 1) % chapterHeadings.length] +
    `（第 ${curChap}/${totalChaps} 章 · ${curRealm}）` // cjk-ok

  const cleanAllowed = allowedTrumps.replace(
    /(?:·?反手打脸)?\s*[(（](?:第\s*\d+\s*(?:~\d+\s*)?[卷幕][^)）]*|势力倍增|丹道乘区|越级反杀|舆论反转|前期启动|名场面铺垫|境界暴涨|铺垫|卡点|终结|高潮卡点)[)）]/g, // cjk-ok
    ''
  )
  const cleanItem = encounterItem.replace(
    /(?:·?反手打脸)?\s*[(（](?:第\s*\d+\s*(?:~\d+\s*)?[卷幕][^)）]*|势力倍增|丹道乘区|越级反杀|舆论反转|前期启动|名场面铺垫|境界暴涨|铺垫|卡点|终结|高潮卡点)[)）]/g, // cjk-ok
    ''
  )

  const sceneOpenPool = [
    `璀璨的水晶吊灯将江城云顶宴会厅照得如同白昼，冷冽的香槟气泡在杯壁上不断炸裂。满堂宾客交头接耳，目光像淬了冰的针尖一样汇聚在角落里的林玄身上。苏清雪高昂着下巴，将一纸加盖了苏氏集团法务鲜红印章的协议狠狠甩在桌面，纸张哗啦散落一地。`, // cjk-ok
    `夜雨敲打着云州商会顶层落地玻璃，会议长桌两侧的豪门董事面色阴沉。刚赶到现场的省城财阀代表将三份断供封杀令推到桌心，试图以雷霆手腕将林玄逼入绝境。`, // cjk-ok
    `黑金拍卖行地下贵宾厅内灯影幽暗，竞价牌起落间暗藏杀机。掌控半城渠道的对手冷笑着抬手封死竞拍上限，笃定林玄绝无翻盘筹码。`, // cjk-ok
    `江畔古武演武台四周旌旗猎猎，数道强横气机锁死了整片石坪。居中坐镇的世家供奉负手而立，居高临下地审视着缓步登台的林玄。` // cjk-ok
  ]
  const clashPool = [
    `“林玄，睁大你的眼睛看清楚，如今站在你面前的是省城豪门联席代表，捏死你不过是一句话的事！”豪门大少冷笑着拍出三份资产冻结令，凌厉的权势威压笼罩全场，试图在气势与资金链上将林玄彻底锁死。林玄缓缓弯腰拈起那页协议的一角，指节泛起微不可察的玉泽，抬眸直视对方：“你们以为握住几条商业渠道就能定人生死？三分钟之内，你们引以为傲的靠山，连站着跟我说话的资格都没有。”`, // cjk-ok
    `“断了你的原料与银根，看你还拿什么撑过今晚子时！”对手森然冷笑，身后十余名黑衣护卫同时踏前一步，肃杀威压令全场呼吸一滞。林玄神色古井无波，指尖轻轻叩击桌面三下，清朗嗓音穿透重重压迫：“账还没算完，急什么？你们吞下去的每一分血汗筹码，今晚都得连本带利吐出来。”`, // cjk-ok
    `“不知死活的东西，真以为凭一点微末底牌就能撼动百年世家的铁律？”主座强敌猛然拍案而起，狂暴气劲震得茶盏粉碎。林玄非但没有后退半步，反而迎着锋芒缓步上前，眸底寒芒如电：“世家铁律？从你们动我逆鳞的那一刻起，这江城的规矩就该换人来定了！”` // cjk-ok
  ]
  const turnPool = [
    `话音落下的刹那，林玄怀中的${cleanItem}骤然微烫——${cleanAllowed}顺势发动！厚重的雕花大门被人从外轰然推开，两排黑衣保镖疾步分列两侧，江城首富赵天豪快步入场，越过满脸堆笑的苏家众人，径直走到林玄面前九十度躬身行礼：“赵某救驾来迟，恭迎尊上！反收购铁证与审计底稿已全部送达！”林玄反手将铁证重重拍在主桌上，瞬间击碎豪门联席防线！`, // cjk-ok
    `电光石火之间，林玄袖中${cleanItem}轰然共鸣，${cleanAllowed}精准切入对手最致命的破绽枢纽！伴随着三道加密清算指令同步亮起，原本不可一世的封锁链条当场反噬崩断，替林玄护航的盟友精锐自四面合围而入，局势在十息之内彻底天翻地覆！`, // cjk-ok
    `就在全场以为胜负已定的一瞬，林玄掌心${cleanItem}绽出一抹冷冽幽芒，借${cleanAllowed}之势借力打力！只听一声闷雷般的气浪炸响，对手引以为傲的杀招寸寸瓦解，整个人气血翻涌连退数步，满堂哗然失色！` // cjk-ok
  ]
  const hookPool = [
    `铁证展开的瞬间，大屏幕上同步跳出资金链全线崩盘的红色预警，对手面如死灰地瘫坐在地。然而林玄正欲转身离席，口袋里的加密电话却突然震动——屏幕跳出一串猩红编码：“尊上，省域背后的隐世大族已察觉${cleanItem}的异动，三名护法长老正连夜封锁出城通道……”林玄眸光骤寒，望向风雨欲来的夜空。`, // cjk-ok
    `余波未平之际，暗处一名溃逃心腹怀中跌落半枚刻着古老图腾的玄铁残令，令牌背面赫然浮现出指向禁区地宫的血色坐标！林玄拾起残令，指尖刚一触及，远方天际便传来低沉压抑的轰鸣，一场更凶险的围猎已在暗夜中悄然张网！`, // cjk-ok
    `满场死寂之中，林玄冷静收拢战利筹码，然而手腕内侧一道隐秘印记却突然泛起灼人寒意——对手背后真正执棋的神秘主使，竟在此刻隔空传来了三日后的生死战帖！` // cjk-ok
  ]

  return [
    `第${curChap}章：${chapTitle}`, // cjk-ok
    ``,
    `${prevHook}${sceneOpenPool[(curChap - 1) % sceneOpenPool.length]}面对步步紧逼的危局，林玄并未急于亮出尚未解封的终极手段，而是稳稳运转体内【${curRealm}】的气机，在隐忍蓄势间静候致命破绽。`, // cjk-ok
    ``,
    clashPool[(curChap - 1) % clashPool.length],
    ``,
    turnPool[(curChap - 1) % turnPool.length],
    ``,
    hookPool[(curChap - 1) % hookPool.length]
  ].join('\n')
}

function synthesizeScreenplayFromNovelOffline(
  novelText: string,
  explicitGenreId?: string | null
): string {
  const trimmed = novelText.trim()
  if (!trimmed.startsWith('小说名：') && !/第\s*\d+\s*章/.test(trimmed)) {
    // cjk-ok
    return ''
  }
  const titleMatch = /小说名：《?([^》\n]+)》?/.exec(trimmed) // cjk-ok
  const chapMatch = /第\s*(\d+)\s*章[:：]\s*([^\n]+)/.exec(trimmed) // cjk-ok
  const title = titleMatch?.[1]?.trim() || '潜龙出渊' // cjk-ok
  const chapNum = chapMatch?.[1] || '1'
  const chapTitle = chapMatch?.[2]?.trim() || '退婚宴受辱与百倍觉醒' // cjk-ok
  const genre = resolveManjuGenre(explicitGenreId, trimmed)
  return [
    `剧本名：${title}`, // cjk-ok
    ``,
    `【项目圣经 · 阶段1】`, // cjk-ok
    `- 题材流派：${genre.nameZh}（${genre.id}）`, // cjk-ok
    `- 视觉定调（STYLE01）：${genre.visualStyleZh}`, // cjk-ok
    `- 核心爽点闭环：当众受辱压抑 → 底牌觉醒蓄势 → 首富接驾高能反转 → 断章钩子`, // cjk-ok
    `- 全局主光定律：同场戏锁定唯一世界主光方向与 180° 轴线站位`, // cjk-ok
    ``,
    `【人物小传】`, // cjk-ok
    `- 林玄（24岁，男，185cm）：表面寒素却眼神冷冽如渊；外观锚点：利落黑发、修身深色风衣、黑金龙卡、左腕古铜暗纹护腕。`, // cjk-ok
    `- 苏清雪（23岁，女，167cm）：妆容精致高傲，势利虚荣；外观锚点：微卷长发、定制白色晚礼服、碎钻项链。`, // cjk-ok
    `- 赵天豪（50岁，男，178cm）：江城首富，气场威严却对林玄恭敬如神；外观锚点：背头银丝、暗金唐装、金丝眼镜、翡翠扳指。`, // cjk-ok
    ``,
    `【场景设定】`, // cjk-ok
    `- 江城大酒店宴会厅（32m×20m×8m）：世界主光方向为穹顶水晶吊灯暖金顶光 + 大门方向冷白追光。`, // cjk-ok
    ``,
    `第${chapNum}集：${chapTitle}`, // cjk-ok
    `第1场 【内景 · 江城大酒店宴会厅 - 夜】`, // cjk-ok
    `△ 璀璨水晶灯下宾客云集。苏清雪高昂着头，将退婚协议狠狠甩在林玄胸口，纸张散落一地。`, // cjk-ok
    `苏清雪：林玄，认清你自己的身份！从今天起，你配不上我苏家！`, // cjk-ok
    `△ 林玄眼底金芒一闪（境界突破异象），缓步弯腰拾起纸页，嘴角勾起一抹冷冽弧度。`, // cjk-ok
    `林玄：这婚书，是我休你。三分钟后，你会跪着求我回头。`, // cjk-ok
    ``,
    `【本集卡点与进度 · 阶段3】`, // cjk-ok
    `- 黄金前3秒冷开场：苏清雪当众将退婚协议甩在林玄胸口，纸页漫天散落`, // cjk-ok
    `- 本集进度：${genre.episodeProgressTemplateZh}`, // cjk-ok
    `- 结尾钩子：林玄撕碎婚书立下三分钟赌约，宴会厅外传来百辆豪车轰鸣！`, // cjk-ok
    ``,
    `第${Number(chapNum) + 1}集：首富接驾·底牌连环亮出`, // cjk-ok
    `第1场 【内景 · 江城大酒店宴会厅大门 - 夜】`, // cjk-ok
    `△ 宴会厅大门轰然推开，两排黑衣保镖分列两侧，江城首富赵天豪快步入场。`, // cjk-ok
    `△ 苏清雪满脸堆笑迎上前，赵天豪却看都不看她一眼，径直走到林玄面前九十度躬身行礼！`, // cjk-ok
    `赵天豪：赵某救驾来迟，恭迎龙王尊上！百亿黑金卡与收购铁证已全部备妥！`, // cjk-ok
    `△ 林玄随手亮出至尊黑卡扔在主桌上，清脆金属声响彻死寂的大厅，苏清雪面如死灰瘫软在地。`, // cjk-ok
    ``,
    `【本集卡点与进度 · 阶段3】`, // cjk-ok
    `- 黄金前3秒冷开场：宴会厅大门轰然洞开，两排黑衣保镖气势如虹分列两侧`, // cjk-ok
    `- 本集进度：${genre.episodeProgressTemplateZh}`, // cjk-ok
    `- 结尾钩子：百亿黑卡拍碎苏家防线，暗处省城大族的加密战帖却骤然亮起！` // cjk-ok
  ].join('\n')
}
export async function executeTextAssetRefNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  if (!ctx.node.assetId || !ctx.node.assetType) {
    throw new Error('GRAPH_UNBOUND_ASSET')
  }
  if (ctx.hasAsset && !ctx.hasAsset(ctx.node.assetId)) {
    throw new Error('GRAPH_MISSING_ASSET')
  }
  if (ctx.node.assetType === 'screenplay') {
    let text = (await ctx.resolveAssetText?.(ctx.node.assetId))?.trim() ?? ''
    if (!text) {
      const genParams = ctx.resolveAssetGenParams?.(ctx.node.assetId)
      text = resolveAssetTextFromGenParams(genParams, ctx.node.params)
    }
    // 节点上缓存的正文（拖入时预填）作最后兜底
    if (!text) text = ctx.node.params.text?.trim() ?? ''
    return { out: { kind: 'text', text } }
  }
  const genParams = ctx.resolveAssetGenParams?.(ctx.node.assetId)
  const text = resolveAssetTextFromGenParams(genParams, ctx.node.params)
  return { out: { kind: 'text', text } }
}

function isDraftFromPreviousGeneration(
  localDraft: string,
  generatedTexts: GraphTextItem[] | undefined
): boolean {
  if (!localDraft) return false
  const items = generatedTexts ?? []
  if (!items.length) return false
  return items.some(
    (item) => (item.text ?? '').trim() === localDraft || Boolean(item.relativePath?.trim())
  )
}

/**
 * 剧本生成节点：调用大模型生成剧本，落盘到输出路径并追加 generatedTexts。
 * 未注入 generateText 时退回纯文本汇总（测试/无 API 环境），仍会落盘（若已注入 saveRunText）。
 */
export async function executeScreenplayGenerateNode(
  rawCtx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const ctx = await hydrateContextForTextConsumer(rawCtx)
  const { node } = ctx
  if (isAssetRefNode(node)) {
    return executeTextAssetRefNode(ctx)
  }

  const mentionSources = resolveMentionSources(ctx).map((s) => ({
    ...s,
    text: unwrapEconomyBundleForNarrative(s.text)
  }))
  const instructionRaw = node.params.generateInstruction?.trim() ?? ''
  const instruction = expandInstructionMentions(instructionRaw, mentionSources)
  const selected = selectIncomingValuesForInstruction(ctx, instructionRaw)
  const incomingTextRaw = autoIncomingTextForInstruction(instructionRaw, selected, mentionSources)
  const incomingText = incomingTextRaw
    .split('\n\n')
    .map((chunk) => unwrapEconomyBundleForNarrative(chunk))
    .join('\n\n')

  if (!ctx.generateText) {
    const localText = normalizeLocalScreenplayText(node.params.text)
    const adaptedFromNovel = synthesizeScreenplayFromNovelOffline(
      incomingText || instruction,
      node.params.filmGenre
    )
    const text = adaptedFromNovel || instruction.trim() || incomingText || localText
    if (!text.trim()) return dualTextGalleryOutputs([], '')
    return await persistScreenplayGeneration(ctx, text)
  }

  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  const localDraft = normalizeLocalScreenplayText(node.params.text)
  const draftIsPreviousOutput = isDraftFromPreviousGeneration(
    localDraft,
    node.params.generatedTexts
  )

  let prompt = buildScreenplayPrompt(instruction, ctx.locale)
  if (incomingText) {
    prompt = `${prompt.trim()}\n\n${incomingText}`
  }
  if (localDraft && !draftIsPreviousOutput) {
    const lead = (ctx.locale ?? '').toLowerCase().startsWith('en')
      ? 'Existing screenplay draft to expand / refine / continue:'
      : '当前已有剧本底稿（请在此基础上按上述指令创作、扩写或润色，保持标准影视剧本格式）：' // cjk-ok
    prompt = `${prompt.trim()}\n\n${lead}\n\n${localDraft}`
  }

  const activeManjuGenre = resolveManjuGenre(
    node.params.filmGenre,
    [instruction, incomingText, localDraft, node.title].filter(Boolean).join('\n')
  )
  const baseSystem = resolveScreenplaySystemPrompt(node.params.generateSystemPrompt, ctx.locale)
  const genreDirective = buildManjuScreenplayDirective(activeManjuGenre, ctx.locale)
  const system = `${baseSystem.trim()}\n\n${genreDirective}`

  const result = await ctx.generateText({
    prompt,
    system,
    model: node.params.generateModel || undefined,
    providerInstanceId: node.params.generateProviderInstanceId || undefined
  })
  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }
  const text = result.text.trim()
  if (!text)
    throw fail(SHARED_ERRORS.resultMissing, { what: { zh: '剧本文本', en: 'script text' } }) // cjk-ok 双语错误数据（zh/en，由 errors/catalog 统一格式化）

  return await persistScreenplayGeneration(ctx, text)
}

function buildLongRangeSkipRecallBlock(opts: {
  currentChapter: number
  historyMap?: Record<string, NovelChapterHistoryEntry>
  foreshadowings?: MxNovelForeshadowingEntry[]
  incomingOutlineAndInstruction?: string
  isEn?: boolean
}): string {
  const { currentChapter, historyMap, foreshadowings, incomingOutlineAndInstruction, isEn } = opts
  if (!historyMap || currentChapter <= 2) return ''

  const recallReasons = new Map<number, string[]>()
  const addRecall = (chap: number, reason: string): void => {
    if (!Number.isFinite(chap) || chap < 1 || chap >= currentChapter - 1) return
    if (!historyMap[String(chap)]) return
    const existing = recallReasons.get(chap) ?? []
    if (!existing.includes(reason)) {
      existing.push(reason)
      recallReasons.set(chap, existing)
    }
  }

  // 1. 伏笔到期或临近揭晓时，自动跨章闪回该伏笔埋设源头章节（Skip-Connection）
  const contextText = (incomingOutlineAndInstruction ?? '').trim()
  for (const f of normalizeNovelForeshadowingPool(foreshadowings ?? [])) {
    if (!f || f.plantedChapter >= currentChapter - 1) continue
    const isDueSoon =
      f.status === 'planted' &&
      currentChapter >= f.targetPayoffChapterRange[0] - 1 &&
      currentChapter <= f.targetPayoffChapterRange[1]
    const titleKeywords = (f.title.match(/[\u4e00-\u9fa5A-Za-z0-9]{2,6}/g) ?? []).filter(
      (tk) => tk.length >= 2
    )
    const isMentionedInCurrentSlice =
      contextText.length > 0 && titleKeywords.some((tk) => contextText.includes(tk))
    if (isDueSoon || isMentionedInCurrentSlice) {
      addRecall(
        f.plantedChapter,
        isEn
          ? `Origin of Foreshadowing "${f.title}"`
          : `伏笔《${f.title}》埋设源头（第 ${f.plantedChapter} 章）` // cjk-ok
      )
    }
  }

  // 2. 本章细纲或用户指令显式提及的早期章节（如「呼应第1章」「第3章的怀表」）
  if (contextText) {
    const zhChapRefs = contextText.matchAll(
      /第\s*([0-9一二三四五六七八九十百千两〇零]+)\s*章/g // cjk-ok
    )
    for (const m of zhChapRefs) {
      const n = m[1] ? parseChineseOrArabicChapterInt(m[1]) : null
      if (n !== null && n >= 1 && n < currentChapter - 1) {
        addRecall(n, isEn ? `Explicit callback to Ch.${n}` : `本章细纲显式呼应第 ${n} 章`) // cjk-ok
      }
    }
    const enChapRefs = contextText.matchAll(/\b(?:chapter|chap|ch)\.?\s*(\d+)\b/gi)
    for (const m of enChapRefs) {
      const n = m[1] ? Number(m[1]) : NaN
      if (Number.isFinite(n) && n >= 1 && n < currentChapter - 1) {
        addRecall(
          Math.floor(n),
          isEn ? `Explicit callback to Ch.${n}` : `本章细纲显式呼应第 ${n} 章`
        ) // cjk-ok
      }
    }
  }

  // 3. 当连载超过 21 章（第 1 章已滑出 L3 的 20 章滚动窗口）时，自动保留开篇第 1 章初心锚点
  if (currentChapter > 21 && historyMap['1']) {
    addRecall(
      1,
      isEn
        ? 'Opening Genesis Anchor (beyond 20-chapter rolling window)'
        : '全书开篇第 1 章初心锚点（防 20 章滚动窗口滑出失忆）' // cjk-ok
    )
  }

  const recalledChaps = [...recallReasons.keys()].sort((a, b) => a - b).slice(0, 4)
  if (recalledChaps.length === 0) return ''

  const lines: string[] = isEn
    ? [
        `### [L3.5 · Long-Range Skip-Connection Episodic Recall (Targeted Callback Memory)]`,
        `> The following earlier chapters are recalled via skip-connections because their planted hooks or events are directly relevant to Chapter ${currentChapter}:`
      ]
    : [
        `### [L3.5 · 跨章伏笔与远期关键章节靶向闪回 (Skip-Connection Episodic Recall)]`, // cjk-ok
        `> 以下早期章节因伏笔到期回收或剧情直接呼应被跨章靶向召回，请保持前后器物、台词与因果细节严丝合缝：` // cjk-ok
      ]

  for (const chapNum of recalledChaps) {
    const entry = historyMap[String(chapNum)]
    if (!entry) continue
    const reasons = (recallReasons.get(chapNum) ?? []).join('；')
    const anchorSnippet = entry.tailAnchor?.trim()
      ? entry.tailAnchor.trim().replace(/\s+/g, ' ').slice(-180)
      : ''
    lines.push(
      isEn
        ? `- **Ch.${chapNum} "${entry.title}"** [Recall Trigger: ${reasons}]: ${entry.summary}${anchorSnippet ? ` | Key Scene Anchor: "${anchorSnippet}"` : ''}`
        : `- **第 ${chapNum} 章《${entry.title}》**【召回原因：${reasons}】：${entry.summary}${anchorSnippet ? ` ｜ 原文关键细节锚点：「${anchorSnippet}」` : ''}` // cjk-ok
    )
  }
  return lines.join('\n')
}

function buildNovelChapterMemoryBlock(opts: {
  currentChapter: number
  totalChapters: number
  targetWords: number
  worldBible?: string
  stateLedger?: string
  rollingSummary?: string
  prevTailAnchor?: string
  characterRosterJson?: string
  foreshadowingJson?: string
  historyMap?: Record<string, NovelChapterHistoryEntry>
  incomingOutlineAndInstruction?: string
  locale?: string
  genre?: NovelGenreProfile
}): string {
  const isEn = (opts.locale ?? '').toLowerCase().startsWith('en')
  const lines: string[] = isEn
    ? [
        `## 📚 [Chapter-by-Chapter Serialization & 4-Tier Memory Context]`,
        `- **Current Target Chapter**: Chapter \`${opts.currentChapter}\` / Dynamic Total \`${opts.totalChapters}\` Chapters`,
        `- **Target Chapter Length**: \`${opts.targetWords}+\` words (strictly write ONLY Chapter ${opts.currentChapter} in full 4-beat scene detail; do NOT compress multiple chapters into an outline!)`
      ]
    : [
        `## 📚 【逐章连载调度与四层分层记忆上下文 (Stateful Chapter Serialization & 4-Tier Memory)】`, // cjk-ok
        `- **当前连载章号**: 第 \`${opts.currentChapter}\` 章 / 动态总章数 \`${opts.totalChapters}\` 章（总章数支持随时动态调整，当前按 ${opts.totalChapters} 章全局曲线配平）`, // cjk-ok
        `- **本章目标字数规格**: \`${opts.targetWords}+\` 字（请集中笔力完整精写【第${opts.currentChapter}章】的四拍场景细节，严禁将多章浓缩为大纲式流水账！）` // cjk-ok
      ]

  if (opts.genre) {
    lines.push(``, buildNovelGenreDirectiveBlock(opts.genre, opts.locale))
  }

  if (opts.worldBible?.trim()) {
    lines.push(
      ``,
      `### [L1 · 恒定世界观与力量体系宪法 (World Bible — 跨全书锁定不漂移)]`, // cjk-ok
      opts.worldBible.trim()
    )
  }
  if (opts.stateLedger?.trim()) {
    lines.push(
      ``,
      `### [L2 · 主角当前动态状态与持有底牌账本 (Live State Ledger — 承接上一章结算状态)]`, // cjk-ok
      opts.stateLedger.trim()
    )
  }
  if (opts.rollingSummary?.trim()) {
    lines.push(
      ``,
      `### [L3 · 前情滚动摘要与防套路黑名单 (Rolling Summary & Anti-Repetition)]`, // cjk-ok
      opts.rollingSummary.trim()
    )
  }

  const roster: MxNovelCharacterStatusEntry[] = normalizeNovelCharacterRoster(
    opts.characterRosterJson
  )
  const foreshadowings: MxNovelForeshadowingEntry[] = normalizeNovelForeshadowingPool(
    opts.foreshadowingJson,
    opts.totalChapters
  )

  const skipRecallBlock = buildLongRangeSkipRecallBlock({
    currentChapter: opts.currentChapter,
    historyMap: opts.historyMap,
    foreshadowings: Array.isArray(foreshadowings) ? foreshadowings : [],
    incomingOutlineAndInstruction: opts.incomingOutlineAndInstruction,
    isEn
  })
  if (skipRecallBlock) {
    lines.push(``, skipRecallBlock)
  }

  if (opts.currentChapter > 1 && opts.prevTailAnchor?.trim()) {
    lines.push(
      ``,
      `### [L4 · 上一章（第 ${opts.currentChapter - 1} 章）末尾原文无缝承接锚点 (Previous Chapter Tail Anchor)]`, // cjk-ok
      `> 请务必在【第${opts.currentChapter}章】第一自然段紧接以下第 ${opts.currentChapter - 1} 章末尾原文的时空、动作与悬念钩子无缝往下写，严禁断层跳戏：`, // cjk-ok
      `\`\`\`text`,
      opts.prevTailAnchor.trim(),
      `\`\`\``
    )
  }
  if (roster.length > 0 || foreshadowings.length > 0) {
    const rosterBlock = buildNovelForeshadowingAndRosterPromptBlock({
      currentChapter: opts.currentChapter,
      roster: Array.isArray(roster) ? roster : [],
      foreshadowings: Array.isArray(foreshadowings) ? foreshadowings : []
    })
    if (rosterBlock) {
      lines.push(``, rosterBlock)
    }
  }
  return lines.join('\n')
}

interface UpstreamNovelChainContext {
  isChainedOrFixedChapterNode: boolean
  inferredChapter: number | null
  inheritedWorldBible?: string
  inheritedStateLedger?: string
  inheritedRollingSummary?: string
  inheritedCharacterRosterJson?: string
  inheritedForeshadowingJson?: string
  inheritedHistoryMap: Record<string, NovelChapterHistoryEntry>
  inheritedPrevTailAnchor?: string
  inheritedGalleryItems: GraphTextItem[]
  inheritedGenre?: string
  inheritedTotalChapters?: number
  inheritedTargetWords?: number
  upstreamEconomyRawText?: string
  upstreamEconomyOnlyRawText?: string
  upstreamChapterOutlineSlice?: string
  outlinePassthroughValue?: GraphValue
  economyPassthroughValue?: GraphValue
  numericalPassthroughValue?: GraphValue
  directUpstreamChapterNodeIds: Set<string>
  directUpstreamChapterTexts: Set<string>
  directUpstreamOutlineTexts: Set<string>
}

function resolvePrevNovelNodeCompletedChapter(node: GraphNode): number {
  const fromTitle = inferExplicitNovelChapterNumber(node.title, node.params.generateInstruction)
  if (fromTitle !== null) return fromTitle
  const hist = parseNovelChapterHistory(node.params.novelChapterHistoryJson)
  const histNums = Object.keys(hist)
    .map((k) => Number(k))
    .filter((n) => Number.isFinite(n) && n >= 1)
  if (histNums.length > 0) {
    return Math.max(...histNums)
  }
  return Math.max(1, Math.round(Number(node.params.novelCurrentChapter) || 1))
}

function extractTailAnchorFromNovelBody(rawText: string | undefined): string {
  const cleanedLines = (rawText ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => Boolean(l) && !/^#+\s*第\s*\d+/i.test(l) && !/^#+\s*Chapter\s*\d+/i.test(l)) // cjk-ok
  if (!cleanedLines.length) return ''
  return cleanedLines.slice(-4).join('\n').slice(-580)
}

async function readNodeTextWithFallback(
  n: GraphNode | undefined,
  readRunText?: NodeExecuteContext['readRunText']
): Promise<string> {
  if (!n) return ''
  const inlineText = normalizeLocalScreenplayText(n.params.text).trim()
  if (inlineText) return inlineText
  if (!readRunText) return ''
  const previewRel = n.params.previewRelativePath?.trim()
  if (previewRel) {
    const loaded = await readRunText(previewRel)
    if (loaded?.trim()) return loaded.trim()
  }
  const gallery = n.params.generatedTexts ?? []
  const selId = n.params.selectedTextId?.trim()
  const picked =
    (selId ? gallery.find((item) => item.id === selId) : undefined) || gallery[gallery.length - 1]
  if (picked?.text?.trim()) return picked.text.trim()
  if (picked?.relativePath?.trim()) {
    const loaded = await readRunText(picked.relativePath.trim())
    if (loaded?.trim()) return loaded.trim()
  }
  return ''
}

async function resolveUpstreamNovelChainContext(
  ctx: NodeExecuteContext
): Promise<UpstreamNovelChainContext> {
  const { node, document: doc } = ctx
  const explicitFromTitle = inferExplicitNovelChapterNumber(node.title, undefined)
  const rawConfiguredChap = Number(node.params.novelCurrentChapter) || 1
  const explicitFromInstruction =
    rawConfiguredChap <= 1
      ? inferExplicitNovelChapterNumber(undefined, node.params.generateInstruction)
      : null
  const emptyResult: UpstreamNovelChainContext = {
    isChainedOrFixedChapterNode: explicitFromTitle !== null,
    inferredChapter: explicitFromTitle ?? explicitFromInstruction,
    inheritedHistoryMap: {},
    inheritedGalleryItems: [],
    directUpstreamChapterNodeIds: new Set(),
    directUpstreamChapterTexts: new Set(),
    directUpstreamOutlineTexts: new Set()
  }
  if (!doc || !Array.isArray(doc.nodes) || !Array.isArray(doc.edges)) {
    return emptyResult
  }

  const byId = new Map<string, GraphNode>(doc.nodes.map((n) => [n.id, n]))
  const directIncomingEdges = doc.edges.filter((e) => e.target === node.id)
  const directOutgoingEdges = doc.edges.filter((e) => e.source === node.id)

  let selectorChapter: number | null = null
  const directUpstreamChapterNodeIds = new Set<string>()
  const directUpstreamChapterTexts = new Set<string>()
  const directUpstreamOutlineTexts = new Set<string>()
  for (const edge of directIncomingEdges) {
    const src = byId.get(edge.source)
    if (!src) continue
    if (src.typeId === 'text.select') {
      const sel = src.params.selectedTextId?.trim() ?? ''
      const m = /^(?:ep|chap|ch):(\d+)$/i.exec(sel)
      if (m?.[1]) {
        selectorChapter = Number(m[1])
      }
    } else if (src.typeId === 'asset.novel' && resolveNovelNodeExecutionMode(src) === 'chapter') {
      directUpstreamChapterNodeIds.add(src.id)
      const directBody = await readNodeTextWithFallback(src, ctx.readRunText)
      if (directBody) directUpstreamChapterTexts.add(directBody)
      for (const item of src.params.generatedTexts ?? []) {
        const itemBody = (item.text ?? '').trim()
        if (itemBody) directUpstreamChapterTexts.add(itemBody)
      }
    } else if (
      src.typeId === 'novel.outline' ||
      (src.typeId === 'asset.novel' && resolveNovelNodeExecutionMode(src) === 'outline')
    ) {
      const outlineBody = await readNodeTextWithFallback(src, ctx.readRunText)
      if (outlineBody) directUpstreamOutlineTexts.add(outlineBody)
    }
  }

  const hasDownstreamChapterNode = directOutgoingEdges.some((e) => {
    const tgt = byId.get(e.target)
    return Boolean(
      tgt && tgt.typeId === 'asset.novel' && resolveNovelNodeExecutionMode(tgt) === 'chapter'
    )
  })

  // BFS 遍历上游祖先节点（按距离由近到远）
  const visited = new Set<string>([node.id])
  const queue: Array<{ id: string; depth: number }> = directIncomingEdges.map((e) => ({
    id: e.source,
    depth: 1
  }))
  const upstreamChapterNodes: Array<{ node: GraphNode; depth: number }> = []
  const upstreamOutlineNodes: Array<{ node: GraphNode; depth: number }> = []
  let upstreamNumericalNode: { node: GraphNode; depth: number } | null = null
  let upstreamEconomyOnlyNode: { node: GraphNode; depth: number } | null = null

  while (queue.length > 0) {
    const cur = queue.shift()!
    if (visited.has(cur.id)) continue
    visited.add(cur.id)
    const curNode = byId.get(cur.id)
    if (!curNode) continue

    if (curNode.typeId === 'novel.outline') {
      upstreamOutlineNodes.push({ node: curNode, depth: cur.depth })
    } else if (curNode.typeId === 'asset.novel') {
      const mode = resolveNovelNodeExecutionMode(curNode)
      if (mode === 'chapter') {
        upstreamChapterNodes.push({ node: curNode, depth: cur.depth })
      } else {
        upstreamOutlineNodes.push({ node: curNode, depth: cur.depth })
      }
    } else if (curNode.typeId === 'game.numerical' && !upstreamNumericalNode) {
      upstreamNumericalNode = { node: curNode, depth: cur.depth }
    } else if (curNode.typeId === 'game.economy' && !upstreamEconomyOnlyNode) {
      upstreamEconomyOnlyNode = { node: curNode, depth: cur.depth }
    }

    for (const inEdge of doc.edges) {
      if (inEdge.target === cur.id && !visited.has(inEdge.source)) {
        queue.push({ id: inEdge.source, depth: cur.depth + 1 })
      }
    }
  }

  upstreamChapterNodes.sort((a, b) => a.depth - b.depth)
  upstreamOutlineNodes.sort((a, b) => a.depth - b.depth)

  const prevChapterNode = upstreamChapterNodes[0]?.node
  const isChainedOrFixedChapterNode = Boolean(
    explicitFromTitle !== null ||
    selectorChapter !== null ||
    upstreamChapterNodes.length > 0 ||
    hasDownstreamChapterNode
  )

  let inferredChapter: number | null =
    explicitFromTitle ?? selectorChapter ?? explicitFromInstruction
  if (inferredChapter === null && prevChapterNode) {
    const prevChap = resolvePrevNovelNodeCompletedChapter(prevChapterNode)
    const ownConfiguredChap = Number(node.params.novelCurrentChapter) || 1
    if (ownConfiguredChap <= 1 || ownConfiguredChap <= prevChap) {
      inferredChapter = prevChap + 1
    } else {
      inferredChapter = ownConfiguredChap
    }
  }

  // 从远到近合并上游章节历史与图库条目（确保每个章节节点的 out-all「全部」端口都汇总第 1 ~ 当前章）
  const inheritedHistoryMap: Record<string, NovelChapterHistoryEntry> = {}
  const galleryByIdOrChap = new Map<string, GraphTextItem>()
  for (const { node: ancNode } of [...upstreamChapterNodes].reverse()) {
    const ancHist = parseNovelChapterHistory(ancNode.params.novelChapterHistoryJson)
    Object.assign(inheritedHistoryMap, ancHist)
    for (const item of ancNode.params.generatedTexts ?? []) {
      const chapM =
        /第\s*(\d+)\s*(?:\/\s*\d+\s*)?章/.exec(item.title ?? '') || // cjk-ok
        /Chapter\s*(\d+)/i.exec(item.title ?? '')
      const key = chapM?.[1] ? `chap:${chapM[1]}` : (item.id ?? `item-${galleryByIdOrChap.size}`)
      galleryByIdOrChap.set(key, item)
    }
    const ancChap = resolvePrevNovelNodeCompletedChapter(ancNode)
    const ancBody = normalizeLocalScreenplayText(ancNode.params.text).trim()
    if (ancBody) {
      const existing = galleryByIdOrChap.get(`chap:${ancChap}`)
      if (!existing) {
        const ancTitleRaw = ancNode.title?.trim() || `第${ancChap}章` // cjk-ok
        const hasChapPrefix =
          /第\s*\d+\s*(?:\/\s*\d+\s*)?章/.test(ancTitleRaw) || /Chapter\s*\d+/i.test(ancTitleRaw) // cjk-ok
        galleryByIdOrChap.set(`chap:${ancChap}`, {
          id: `chap:${ancChap}:${ancNode.id}`,
          title: hasChapPrefix ? ancTitleRaw : `第${ancChap}章：${ancTitleRaw}`, // cjk-ok
          text: ancBody,
          createdAt: new Date().toISOString()
        })
      } else if (!existing.relativePath && !existing.text?.trim()) {
        galleryByIdOrChap.set(`chap:${ancChap}`, {
          ...existing,
          text: ancBody
        })
      }
    }
  }

  const outlineNode = upstreamOutlineNodes[0]?.node
  const resolvedOutlineBody = outlineNode
    ? await readNodeTextWithFallback(outlineNode, ctx.readRunText)
    : ''
  const outlineText = outlineNode
    ? resolvedOutlineBody || outlineNode.params.novelWorldBible?.trim() || ''
    : ''
  const outlineRelPath = outlineNode?.params.previewRelativePath?.trim()
  const outlinePassthroughValue: GraphValue | undefined =
    outlineRelPath && ctx.readRunText
      ? { kind: 'text', text: '', relativePath: outlineRelPath }
      : outlineText
        ? { kind: 'text', text: outlineText }
        : undefined
  const rawOutlineBible =
    prevChapterNode?.params.novelWorldBible?.trim() ||
    outlineNode?.params.novelWorldBible?.trim() ||
    outlineText
  const inheritedWorldBible = rawOutlineBible
    ? (extractSharedScreenplayHeader(rawOutlineBible).sharedHeader || rawOutlineBible).slice(
        0,
        4000
      )
    : undefined

  const inheritedStateLedger = prevChapterNode?.params.novelStateLedger?.trim()
  const inheritedRollingSummary = prevChapterNode?.params.novelRollingSummary?.trim()
  const inheritedCharacterRosterJson =
    prevChapterNode?.params.novelCharacterRosterJson?.trim() ||
    outlineNode?.params.novelCharacterRosterJson?.trim()
  const inheritedForeshadowingJson =
    prevChapterNode?.params.novelForeshadowingJson?.trim() ||
    outlineNode?.params.novelForeshadowingJson?.trim()
  const inheritedGenre =
    prevChapterNode?.params.novelGenre?.trim() || outlineNode?.params.novelGenre?.trim()
  const inheritedTotalChapters =
    prevChapterNode?.params.novelTotalChapters || outlineNode?.params.novelTotalChapters
  const inheritedTargetWords =
    prevChapterNode?.params.novelTargetWords || outlineNode?.params.novelTargetWords
  const prevChapterBody = prevChapterNode
    ? await readNodeTextWithFallback(prevChapterNode, ctx.readRunText)
    : ''
  const inheritedPrevTailAnchor = prevChapterNode
    ? extractTailAnchorFromNovelBody(prevChapterBody) ||
      Object.values(parseNovelChapterHistory(prevChapterNode.params.novelChapterHistoryJson)).pop()
        ?.tailAnchor
    : undefined

  // 提取上游 game.numerical 与 game.economy 祖先（或直连但尚未显式运行节点）的数值与经济载荷，以便按本章章号同时解算单章数值围栏与经济资源供需法则
  let upstreamEconomyRawText: string | undefined
  let upstreamEconomyOnlyRawText: string | undefined
  let numericalPassthroughValue: GraphValue | undefined
  let economyPassthroughValue: GraphValue | undefined
  if (upstreamNumericalNode) {
    const numNode = upstreamNumericalNode.node
    const numRelPath = numNode.params.previewRelativePath?.trim()
    const rawText =
      (await readNodeTextWithFallback(numNode, ctx.readRunText)) ||
      (numNode.params.text?.trim() ?? '')
    if (rawText && rawText !== '…') {
      upstreamEconomyRawText = rawText
    } else {
      const wbJson = numNode.params.gameNumericalWorkbenchJson?.trim() ?? ''
      let wb = createMxWorkbenchPreset(
        (numNode.params.gameNumericalPreset as any) || 'short_drama_progression'
      )
      if (wbJson) {
        try {
          const parsedWb = JSON.parse(wbJson)
          if (parsedWb && typeof parsedWb === 'object') wb = { ...wb, ...parsedWb }
        } catch {
          // ignore
        }
      }
      const mxDoc = createMxFromTemplate('short_drama_reversal_loop')
      mxDoc.workbench = wb
      upstreamEconomyRawText = exportMxNarrativeProgressionBrief(wb, mxDoc)
    }
    numericalPassthroughValue =
      numRelPath && ctx.readRunText
        ? { kind: 'text', text: '', relativePath: numRelPath }
        : upstreamEconomyRawText
          ? { kind: 'text', text: upstreamEconomyRawText }
          : undefined
  }
  if (upstreamEconomyOnlyNode) {
    const econ = upstreamEconomyOnlyNode.node
    const econRelPath = econ.params.previewRelativePath?.trim()
    const rawText =
      (await readNodeTextWithFallback(econ, ctx.readRunText)) || (econ.params.text?.trim() ?? '')
    if (rawText && rawText !== '…') {
      upstreamEconomyOnlyRawText = rawText
    } else {
      const diagramRaw = econ.params.gameEconomyDiagramJson?.trim() ?? ''
      const parsedDoc = diagramRaw ? parseMxDocumentJson(diagramRaw) : null
      const mxDoc =
        parsedDoc ??
        createMxFromTemplate(
          (econ.params.gameEconomyPreset as MxTemplateId) || 'short_drama_reversal_loop'
        )
      const econSpec = exportMxEconomyResourceNarrativeSpec(mxDoc)
      if (mxDoc.workbench && !upstreamEconomyRawText) {
        upstreamEconomyOnlyRawText = [
          econSpec,
          exportMxNarrativeProgressionBrief(mxDoc.workbench, mxDoc)
        ]
          .filter(Boolean)
          .join('\n\n')
      } else {
        upstreamEconomyOnlyRawText = econSpec || undefined
      }
    }
    economyPassthroughValue =
      econRelPath && ctx.readRunText
        ? { kind: 'text', text: '', relativePath: econRelPath }
        : upstreamEconomyOnlyRawText
          ? { kind: 'text', text: upstreamEconomyOnlyRawText }
          : undefined
  }
  if (!upstreamEconomyRawText && upstreamEconomyOnlyRawText) {
    upstreamEconomyRawText = upstreamEconomyOnlyRawText
    upstreamEconomyOnlyRawText = undefined
  }

  // 若上游存在总纲节点且未直接连线到当前节点，提取对应章号的大纲分节
  const isDirectOutlineConnected = directIncomingEdges.some((e) => {
    const src = byId.get(e.source)
    return Boolean(
      src &&
      (src.typeId === 'novel.outline' ||
        (outlineNode && e.source === outlineNode.id) ||
        src.typeId === 'text.select')
    )
  })
  let upstreamChapterOutlineSlice: string | undefined
  const targetChapForSlice =
    inferredChapter ?? Math.max(1, Math.round(Number(node.params.novelCurrentChapter) || 1))
  if (outlineText && !isDirectOutlineConnected) {
    const sliced = narrowOutlineTextForChapter(outlineText, targetChapForSlice, ctx.locale, {
      totalChapters: inheritedTotalChapters || Number(node.params.novelTotalChapters) || 200,
      targetWords: inheritedTargetWords || Number(node.params.novelTargetWords) || 3200
    })
    if (sliced && sliced !== outlineText.trim()) {
      upstreamChapterOutlineSlice = sliced
    }
  }

  return {
    isChainedOrFixedChapterNode,
    inferredChapter,
    inheritedWorldBible,
    inheritedStateLedger,
    inheritedRollingSummary,
    inheritedCharacterRosterJson,
    inheritedForeshadowingJson,
    inheritedHistoryMap,
    inheritedPrevTailAnchor,
    inheritedGalleryItems: [...galleryByIdOrChap.values()],
    inheritedGenre,
    inheritedTotalChapters,
    inheritedTargetWords,
    upstreamEconomyRawText,
    upstreamEconomyOnlyRawText,
    upstreamChapterOutlineSlice,
    outlinePassthroughValue,
    economyPassthroughValue,
    numericalPassthroughValue,
    directUpstreamChapterNodeIds,
    directUpstreamChapterTexts,
    directUpstreamOutlineTexts
  }
}

const DEFAULT_TEMPLATE_CHARACTER_NAMES = new Set([
  '林玄', // cjk-ok
  '赵天豪', // cjk-ok
  '苏清雪', // cjk-ok
  '陆尘', // cjk-ok
  '苏若雪', // cjk-ok
  '赵元霸', // cjk-ok
  '血煞老祖', // cjk-ok
  '沈墨', // cjk-ok
  '林夏', // cjk-ok
  '周维民', // cjk-ok
  '谢云澜', // cjk-ok
  '萧景琰', // cjk-ok
  '沈娇娇', // cjk-ok
  '太后', // cjk-ok
  '霍星河', // cjk-ok
  '艾琳娜', // cjk-ok
  '维克多', // cjk-ok
  '陈烬', // cjk-ok
  '顾青', // cjk-ok
  '顾怀安' // cjk-ok
])

function isDefaultTemplateCharacterEntry(c: MxNovelCharacterStatusEntry): boolean {
  if (DEFAULT_TEMPLATE_CHARACTER_NAMES.has(c.name.trim())) return true
  return /^char_(?:protagonist|ally|villain|\d+)(?:_\d+)?$/.test(c.id)
}

function parseCharacterRosterFromOutlineText(
  outlineOrBible: string,
  baseRoster: MxNovelCharacterStatusEntry[],
  currentChapter = 1
): MxNovelCharacterStatusEntry[] {
  const raw = (outlineOrBible ?? '').trim()
  if (!raw) return baseRoster
  const lines = raw.split(/\r?\n/).map((l) => l.trim())
  const extracted: MxNovelCharacterStatusEntry[] = []
  const seenNames = new Set<string>()

  const pushExtracted = (
    nameRaw: string,
    roleTagRaw: string,
    descRaw: string,
    explicitFaction?: MxNovelCharacterStatusEntry['faction']
  ): void => {
    const name = nameRaw.replace(/[*`]/g, '').trim()
    if (!name || name.length < 2 || name.length > 10 || seenNames.has(name)) return
    if (
      /题材|规模|体系|阶梯|总章数|第一卷|第二卷|第三卷|第四卷|阶段|核心|力量|修炼|境界|主角|男主|女主|盟友|反派|宿敌|角色姓名/.test(
        name
      ) // cjk-ok
    ) {
      return
    }
    const roleTag = roleTagRaw.replace(/[*`]/g, '').trim() || '核心角色' // cjk-ok
    const desc = descRaw.replace(/[*`]/g, '').trim()
    const combinedTag = `${roleTag} ${desc}`
    const faction: MxNovelCharacterStatusEntry['faction'] =
      explicitFaction ??
      (/主角|男主|女主|protagonist|hero/i.test(combinedTag) // cjk-ok
        ? 'protagonist'
        : /盟友|伙伴|首富|人脉|护道|师姐|师妹|同盟|ally|partner/i.test(combinedTag) // cjk-ok
          ? 'ally'
          : /反派|宿敌|仇敌|执政官|大少|执事|管事|魔道|villain|antagonist|boss/i.test(combinedTag) // cjk-ok
            ? 'villain'
            : 'neutral')
    seenNames.add(name)
    extracted.push({
      id: `char_outline_${extracted.length + 1}_${name}`,
      name,
      faction,
      status: faction === 'ally' ? 'subdued' : 'active',
      realmOrRole: roleTag.slice(0, 32),
      relationNote: (desc || roleTag).slice(0, 120),
      updatedAtChapter: currentChapter
    })
  }

  const charBulletRe =
    /^[-*•]\s*\**([\u4e00-\u9fa5A-Za-z·]{2,10})\**\s*[（(]([^）)\n]{1,24})[）)]\**\s*[:：]\s*(.+)$/ // cjk-ok
  const roleLeadBulletRe =
    /^[-*•]?\s*\**(?:核心)?(主角|男主|女主|关键盟友|盟友|首卷反派|首卷宿敌|反派|宿敌)\**\s*[:：]\s*\**([\u4e00-\u9fa5A-Za-z·]{2,8})\**\s*[，,（(：:\s]*(.+)$/ // cjk-ok
  const tableRowRe =
    /^\|\s*\**([\u4e00-\u9fa5A-Za-z·]{2,8})\**\s*\|\s*([^|]+)\|\s*([^|]+)\|\s*([^|]+)\|/

  for (const line of lines) {
    const m = charBulletRe.exec(line)
    if (m?.[1] && m[2] && m[3]) {
      pushExtracted(m[1], m[2], m[3])
      continue
    }
    const rm = roleLeadBulletRe.exec(line)
    if (rm?.[1] && rm[2] && rm[3]) {
      const fTag = rm[1]
      const f: MxNovelCharacterStatusEntry['faction'] = /主角|男主|女主/.test(fTag) // cjk-ok
        ? 'protagonist'
        : /盟友/.test(fTag) // cjk-ok
          ? 'ally'
          : 'villain'
      pushExtracted(rm[2], fTag, rm[3], f)
      continue
    }
    const tm = tableRowRe.exec(line)
    if (tm?.[1] && tm[2] && tm[3] && tm[4] && !tm[1].includes('-')) {
      pushExtracted(tm[1], `${tm[2].trim()} · ${tm[3].trim()}`, tm[4].trim())
    }
  }

  // 同时支持从立项自然段（如「主角沈砚，山村药童……；盟友林照月，外门女弟子……；首卷反派外门执事裴玄，借采药任务……」) 提取
  const inlineProtagonistRe =
    /(?:主角|男主|女主)\s*[:：为是]?\s*([\u4e00-\u9fa5]{2,4})\s*[，,（(]([^；;。\n]+)/g // cjk-ok
  for (const m of raw.matchAll(inlineProtagonistRe)) {
    if (m[1] && m[2]) {
      const parts = m[2].split(/[，,]/)
      pushExtracted(m[1], parts[0]?.trim() || '主角', m[2].trim(), 'protagonist') // cjk-ok
    }
  }
  const inlineAllyRe =
    /(?:关键)?盟友(?:[\u4e00-\u9fa5]{0,6}?)\s*[:：为是]?\s*([\u4e00-\u9fa5]{2,4})\s*[，,（(]([^；;。\n]+)/g // cjk-ok
  for (const m of raw.matchAll(inlineAllyRe)) {
    if (m[1] && m[2]) {
      const parts = m[2].split(/[，,]/)
      pushExtracted(m[1], parts[0]?.trim() || '盟友', m[2].trim(), 'ally') // cjk-ok
    }
  }
  const inlineVillainRe =
    /(?:首卷|前期|核心)?(?:反派|宿敌)(?:外门执事|内门执事|管事|长老|大少)?\s*[:：为是]?\s*([\u4e00-\u9fa5]{2,4})\s*[，,（(]([^；;。\n]+)/g // cjk-ok
  for (const m of raw.matchAll(inlineVillainRe)) {
    if (m[1] && m[2]) {
      const parts = m[2].split(/[，,]/)
      pushExtracted(m[1], parts[0]?.trim() || '反派', m[2].trim(), 'villain') // cjk-ok
    }
  }

  if (extracted.length === 0) return baseRoster
  // 若从大纲或立项提取到了显式人物表，合并并剔除未在文本中出现的流派默认占位角色（如陆尘/苏若雪/赵元霸）
  const byName = new Map<string, MxNovelCharacterStatusEntry>()
  for (const c of extracted) {
    byName.set(c.name, c)
  }
  const hasOutlineProtagonist = extracted.some((c) => c.faction === 'protagonist')
  for (const existing of baseRoster) {
    if (byName.has(existing.name)) {
      const ext = byName.get(existing.name)!
      byName.set(existing.name, {
        ...ext,
        status: existing.status,
        realmOrRole: existing.realmOrRole || ext.realmOrRole,
        updatedAtChapter: Math.max(existing.updatedAtChapter, ext.updatedAtChapter)
      })
    } else if (!(
      hasOutlineProtagonist &&
      (isDefaultTemplateCharacterEntry(existing) || existing.faction === 'protagonist')
    )) {
      byName.set(existing.name, existing)
    }
  }
  return [...byName.values()]
}

function synthesizeChapterSemanticSummary(opts: {
  text: string
  currentChapter: number
  extractedChapTitle: string
  curRealm: string
  curCeiling: string
}): string {
  const { text, currentChapter, extractedChapTitle, curRealm, curCeiling } = opts
  const narrativeLines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(
      (l) =>
        Boolean(l) &&
        !/^#+\s*第\s*\d+/i.test(l) && // cjk-ok
        !/^#+\s*Chapter\s*\d+/i.test(l) &&
        !/^小说名[:：]/i.test(l) && // cjk-ok
        !/^【(?:核心设定|第一拍|第二拍|第三拍|第四拍)[^】]*】$/.test(l) // cjk-ok
    )

  if (narrativeLines.length === 0) {
    return `第${currentChapter}章《${extractedChapTitle}》(${curRealm}/上限${curCeiling})：剧情推进完成` // cjk-ok
  }

  const cleanSnippet = (s: string, maxLen: number): string =>
    s
      .replace(/^【[^】]+】\s*/, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, maxLen)

  const lastHook = cleanSnippet(narrativeLines[narrativeLines.length - 1]!, 72)

  if (narrativeLines.length <= 2) {
    return `第${currentChapter}章《${extractedChapTitle}》(${curRealm}/上限${curCeiling})：[钩子] ${lastHook}` // cjk-ok
  }

  const midCandidates = narrativeLines.slice(1, -1)
  const actionRe =
    /激活|引爆|亮出|突破|觉醒|反杀|震慑|击穿|斩杀|夺取|揭晓|跪|崩盘|封锁|逆熵|底牌|铁证|伏诛|覆灭/ // cjk-ok
  const climaxRaw =
    midCandidates.find((l) => actionRe.test(l)) ??
    midCandidates[Math.floor(midCandidates.length / 2)]!
  const climaxSnippet = cleanSnippet(climaxRaw, 52)

  return `第${currentChapter}章《${extractedChapTitle}》(${curRealm}/上限${curCeiling})：[破局] ${climaxSnippet} ➔ [钩子] ${lastHook}` // cjk-ok
}

function evolveCharacterRosterFromProse(opts: {
  proseText: string
  worldBible: string
  currentChapter: number
  curRealm: string
  curCeiling: string
  baseRoster: MxNovelCharacterStatusEntry[]
}): {
  roster: MxNovelCharacterStatusEntry[]
  activeInChapterNames: string[]
  statusTransitionNotes: string[]
} {
  const { proseText, worldBible, currentChapter, curRealm, curCeiling, baseRoster } = opts
  const mergedRoster = parseCharacterRosterFromOutlineText(
    worldBible,
    normalizeNovelCharacterRoster(baseRoster),
    currentChapter
  )
  const sentences = proseText
    .split(/[。！？!?\r\n]+/)
    .map((s) => s.trim())
    .filter(Boolean)

  const activeInChapterNames: string[] = []
  const statusTransitionNotes: string[] = []

  const updated = mergedRoster.map((c) => {
    const next: MxNovelCharacterStatusEntry = { ...c }
    if (next.faction === 'protagonist') {
      next.realmOrRole = `${curRealm} (上限 ${curCeiling})` // cjk-ok
      next.updatedAtChapter = currentChapter
    }
    if (!next.name || !proseText.includes(next.name)) {
      return next
    }
    activeInChapterNames.push(next.name)
    next.updatedAtChapter = currentChapter

    const charSentences = sentences.filter((s) => s.includes(next.name)).join('。')
    if (next.faction === 'villain' && next.status !== 'eliminated') {
      if (/伏诛|毙命|陨落|阵亡|灰飞烟灭|彻底覆灭|身死道消|气绝身亡|死不瞑目/.test(charSentences)) {
        // cjk-ok
        next.status = 'eliminated'
        if (!next.relationNote.includes(`第${currentChapter}章已伏诛`)) {
          // cjk-ok
          next.relationNote = `${next.relationNote}［第${currentChapter}章已伏诛退场］` // cjk-ok
        }
        statusTransitionNotes.push(`${next.name}（第${currentChapter}章已伏诛退场）`) // cjk-ok
      } else if (
        next.status === 'active' &&
        /重伤|吐血|败退|狼狈逃窜|瘫软|面如死灰|全线崩盘|防线击穿|被废/.test(charSentences) // cjk-ok
      ) {
        next.status = 'injured'
        if (!next.relationNote.includes(`第${currentChapter}章受创`)) {
          // cjk-ok
          next.relationNote = `${next.relationNote}［第${currentChapter}章交锋受创］` // cjk-ok
        }
        statusTransitionNotes.push(`${next.name}（第${currentChapter}章受创败退）`) // cjk-ok
      }
    } else if (
      (next.faction === 'ally' || next.faction === 'neutral') &&
      next.status !== 'subdued' &&
      /躬身行礼|救驾|结盟|归顺|唯命是从|马首是瞻|立誓效忠/.test(charSentences) // cjk-ok
    ) {
      next.status = 'subdued'
      statusTransitionNotes.push(`${next.name}（第${currentChapter}章深化同盟/归顺）`) // cjk-ok
    }
    return next
  })

  return {
    roster: updated,
    activeInChapterNames,
    statusTransitionNotes
  }
}

function evolveForeshadowingPoolFromProse(opts: {
  proseText: string
  currentChapter: number
  baseForeshadowings: MxNovelForeshadowingEntry[]
}): {
  foreshadowings: MxNovelForeshadowingEntry[]
  paidOffTitles: string[]
} {
  const { proseText, currentChapter, baseForeshadowings } = opts
  const paidOffTitles: string[] = []
  const payoffVerbRe = /揭晓|真相|原来|终于|解开|秘密|验证|当众|引爆|激活|易主|认出|水落石出/ // cjk-ok

  const updated = normalizeNovelForeshadowingPool(baseForeshadowings).map((f) => {
    if (f.status === 'paid_off') return f
    const [startChap, endChap] = f.targetPayoffChapterRange
    if (currentChapter < startChap) return f

    const tokens = (f.title.match(/[\u4e00-\u9fa5A-Za-z0-9]{2,5}/g) ?? []).filter(
      (tk) => tk.length >= 2 && !/之约|真伪|验证|线索|权限|解封/.test(tk) // cjk-ok
    )
    const matchedCount = tokens.filter((tk) => proseText.includes(tk)).length
    const isTriggered =
      matchedCount >= 2 ||
      (matchedCount >= 1 && payoffVerbRe.test(proseText)) ||
      (currentChapter >= endChap && matchedCount >= 1)

    if (isTriggered) {
      paidOffTitles.push(f.title)
      return {
        ...f,
        status: 'paid_off' as const,
        paidOffAtChapter: currentChapter
      }
    }
    return f
  })

  return {
    foreshadowings: updated,
    paidOffTitles
  }
}

function synthesizeNovelOutlineOffline(opts: {
  instruction: string
  incomingText: string
  totalChapters: number
  targetWords: number
  genre?: NovelGenreProfile
}): string {
  const { instruction, incomingText, totalChapters, targetWords, genre } = opts
  const raw = `${instruction}\n${incomingText}`.trim()
  const titleMatch = /《([^》\n]{1,30})》/.exec(raw)
  const bookTitle =
    titleMatch?.[1]?.trim() ||
    (genre ? `${genre.labelZh.split(' / ')[0]}·长篇连载总纲` : '潜龙出渊：长线分卷总纲') // cjk-ok
  const stageNames = genre?.stageNamesZh ?? ['潜龙蛰伏期', '锋芒初露期', '省域争霸期', '万界巅峰期'] // cjk-ok
  const protagonistName = genre?.roster[0]?.name || '林深' // cjk-ok
  const allyName = genre?.roster.find((r) => r.faction === 'ally')?.name || '苏凛' // cjk-ok
  const villainName = genre?.roster.find((r) => r.faction === 'villain')?.name || '赵天铭' // cjk-ok
  const stageTerm = genre?.stageTermZh || '境界/阶位' // cjk-ok
  const unlockTerm = genre?.unlockTermZh || '核心底牌' // cjk-ok
  const presetWb = createMxWorkbenchPreset('short_drama_progression')
  presetWb.roguelikeEnvelope.levelMax = totalChapters
  const fullLifecycleArcSchedule = generateMxFullLifecycleArcScheduleMarkdown(
    presetWb,
    totalChapters,
    genre
  )

  return [
    `# 小说名：《${bookTitle}》`, // cjk-ok
    ``,
    `> **题材流派**：${genre?.labelZh ?? '长线强剧情连载'} ｜ **规划总章数**：${totalChapters} 章 ｜ **单章规格**：${targetWords}+ 字 ｜ **文档规范**：GitHub README 标准连载大纲`, // cjk-ok
    ``,
    `## 【核心设定与人物档案】`, // cjk-ok
    `- **题材流派与总规模**：${genre?.labelZh ?? '长线强剧情连载'}（规划总章数：${totalChapters} 章 · 单章规格：${targetWords}+ 字）`, // cjk-ok
    `- **${stageTerm}突破阶梯**：\`${stageNames.join(' ➔ ')}\``,
    `- **${protagonistName}**（核心主角）：身处【${stageNames[0]}】逆境，凭借初期${unlockTerm}步步破局。`, // cjk-ok
    `- **${allyName}**（关键盟友）：掌握关键情报与资源渠道，在主角破局后建立深度同盟。`, // cjk-ok
    `- **${villainName}**（首卷宿敌）：掌控前期局部资源垄断，屡次施压设局。`, // cjk-ok
    ``,
    `| 角色姓名 | 阵营定位 | 初始阶段 / 阶位 | 核心动机与戏剧功能 |`, // cjk-ok
    `| :--- | :--- | :--- | :--- |`,
    `| **${protagonistName}** | 核心主角 | ${stageNames[0]} | 绝境觉醒初期${unlockTerm}，打破阶层封锁 |`, // cjk-ok
    `| **${allyName}** | 关键盟友 | 枢纽掌舵人 | 提供高阶情报与资源互换，结成战略同盟 |`, // cjk-ok
    `| **${villainName}** | 首卷宿敌 | 局部垄断者 | 封锁前期晋升通道，充当首卷立威踏脚石 |`, // cjk-ok
    ``,
    `---`,
    ``,
    `## 【全书分卷与长线大纲】`, // cjk-ok
    ``,
    `| 卷序 | 章节区间 | 分卷核心主题 | 对应${stageTerm}阶段 | 卷末高潮卡点 |`, // cjk-ok
    `| :--- | :--- | :--- | :--- | :--- |`,
    `| **第一卷** | 第 1~${Math.min(totalChapters, Math.max(10, Math.round(totalChapters * 0.25)))} 章 | ${genre?.volumeThemesZh[0] ?? '危机降临与初露锋芒'} | ${stageNames[0]} | 引爆初期${unlockTerm}，粉碎首轮围剿 |`, // cjk-ok
    `| **第二卷** | 第 ${Math.min(totalChapters, Math.max(10, Math.round(totalChapters * 0.25)) + 1)}~${Math.min(totalChapters, Math.max(20, Math.round(totalChapters * 0.6)))} 章 | ${genre?.volumeThemesZh[1] ?? '势力洗牌与破局立威'} | ${stageNames[1] ?? stageNames[0]} | 跨入更高版图，正面击溃宿敌主力 |`, // cjk-ok
    `| **第三卷** | 第 ${Math.min(totalChapters, Math.max(20, Math.round(totalChapters * 0.6)) + 1)}~${totalChapters} 章 | ${genre?.volumeThemesZh[2] ?? '终局决战与万界登顶'} | ${stageNames[stageNames.length - 1] ?? stageNames[0]} | 揭晓终极秘辛，完成全书大结局清算 |`, // cjk-ok
    ``,
    `- 第一卷（第 1~${Math.min(totalChapters, Math.max(10, Math.round(totalChapters * 0.25)))} 章）：${genre?.volumeThemesZh[0] ?? '危机降临与初露锋芒'}（当前阶段：${stageNames[0]}）`, // cjk-ok
    `- 第二卷（第 ${Math.min(totalChapters, Math.max(10, Math.round(totalChapters * 0.25)) + 1)}~${Math.min(totalChapters, Math.max(20, Math.round(totalChapters * 0.6)))} 章）：${genre?.volumeThemesZh[1] ?? '势力洗牌与破局立威'}（进阶阶段：${stageNames[1] ?? stageNames[0]}）`, // cjk-ok
    `- 第三卷（第 ${Math.min(totalChapters, Math.max(20, Math.round(totalChapters * 0.6)) + 1)}~${totalChapters} 章）：${genre?.volumeThemesZh[2] ?? '终局决战与万界登顶'}（终局阶段：${stageNames[stageNames.length - 1] ?? stageNames[0]}）`, // cjk-ok
    ``,
    fullLifecycleArcSchedule,
    ``,
    `---`,
    ``,
    `## 【分章细纲】`, // cjk-ok
    ``,
    `### 第1章：绝境死局与初次觉醒（第 1/${totalChapters} 章 · ${stageNames[0]}）`, // cjk-ok
    `- **章节导读与节拍**：起势铺垫期。${protagonistName}在底层绝境中遭遇${villainName}势力的极限挤压，在生死临界点首次触动初期${unlockTerm}，并在章末发现更深层的危机线索。`, // cjk-ok
    `- **数值与底牌锚点**：当前处于【${stageNames[0]}】起点，仅允许动用初期${unlockTerm}，严禁越阶秒杀。`, // cjk-ok
    `- **章末断章钩子**：暗中窥伺的神秘势力浮出水面，危机倒计时正式开启。`, // cjk-ok
    ``,
    `### 第2章：暗流博弈与机缘试锋（第 2/${totalChapters} 章 · ${stageNames[0]}）`, // cjk-ok
    `- **章节导读与节拍**：机缘成长期。承接第 1 章末尾的突发危机，${protagonistName}与${allyName}首次交锋试探，利用新掌控的初期${unlockTerm}化解杀局，反手夺取关键破局筹码。`, // cjk-ok
    `- **数值与底牌锚点**：巩固【${stageNames[0]}】核心筹码，解锁与${allyName}的初步情报渠道。`, // cjk-ok
    `- **章末断章钩子**：${villainName}察觉外围据点失守，调集核心人手布下天罗地网。`, // cjk-ok
    ``,
    `### 第3章：强敌反扑与底牌立威（第 3/${totalChapters} 章 · ${stageNames[0]}）`, // cjk-ok
    `- **章节导读与节拍**：高潮破局期。${villainName}亲自下场封锁退路，${protagonistName}引爆本阶段准入${unlockTerm}完成当众反杀，震动全场并引出幕后更高阶势力。`, // cjk-ok
    `- **数值与底牌锚点**：小高潮立威节点，完全兑现初期${unlockTerm}上限战力，收获首桶高阶资源。`, // cjk-ok
    `- **章末断章钩子**：战利品中惊现指向更高版图的机密残卷，新风暴酝酿成形。` // cjk-ok
  ].join('\n')
}

async function executeNovelOutlineNode(
  ctx: NodeExecuteContext,
  opts: {
    totalChapters: number
    targetWords: number
    activeGenre?: NovelGenreProfile
    instruction: string
    incomingText: string
  }
): Promise<Record<string, GraphValue>> {
  const { node } = ctx
  const { totalChapters, targetWords, activeGenre, instruction, incomingText } = opts
  const localDraft = normalizeLocalScreenplayText(node.params.text)

  let text = ''
  if (!ctx.generateText) {
    const hasExplicitChaptersInLocal =
      splitScreenplayByExplicitEpisodeMarkers(localDraft, {
        includeSharedBios: true,
        locale: ctx.locale
      }).length >= 2
    text = hasExplicitChaptersInLocal
      ? localDraft
      : synthesizeNovelOutlineOffline({
          instruction,
          incomingText,
          totalChapters,
          targetWords,
          genre: activeGenre
        })
  } else {
    if (ctx.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError')
    }
    const isEn = (ctx.locale ?? '').toLowerCase().startsWith('en')
    const rawSys = node.params.generateSystemPrompt?.trim() ?? ''
    const isDefaultChapterSys =
      !rawSys ||
      rawSys === resolveNovelSystemPrompt(undefined, 'zh-CN').trim() ||
      rawSys === resolveNovelSystemPrompt(undefined, 'en-US').trim()
    const outlineSystemPrompt = !isDefaultChapterSys
      ? rawSys
      : resolveNovelOutlineSystemPrompt(undefined, ctx.locale)

    const genreBlock = activeGenre ? buildNovelGenreDirectiveBlock(activeGenre, ctx.locale) : ''
    const outlineHeader = isEn
      ? `## 🗺️ [Novel World Bible & Volume/Chapter Outline Task (Total ${totalChapters} Chapters)]`
      : `## 🗺️ 【长篇小说世界观圣经与分卷分章总纲任务（全书规划 ${totalChapters} 章）】\n- 本节点为**总纲与分章企划节点**（非单章正文节点）：请输出完整的世界观设定集、核心人物档案、全书分卷架构，以及按「第1章：<标题>」「第2章：<标题>」格式排列的分章细纲，供下游各章节正文节点与分集选取器（text.select）按章承接。` // cjk-ok
    const baseUserPrompt =
      instruction.trim() ||
      (isEn
        ? `Please design the complete Novel World Bible, Character Roster, Volume Architecture (${totalChapters} chapters total), and detailed chapter outlines for the opening chapters.`
        : `请结合上游世界观与数值成长体系，设计完整的小说《世界观设定集与人物档案》、《全书 ${totalChapters} 章分卷总纲》以及开篇各章的详细分章细纲（按「第1章：…」「第2章：…」「第3章：…」分段列出）。`) // cjk-ok

    let prompt = `${outlineHeader}\n\n${baseUserPrompt.trim()}`
    if (genreBlock) {
      prompt = `${prompt.trim()}\n\n${genreBlock}`
    }
    if (incomingText) {
      prompt = `${prompt.trim()}\n\n${incomingText}`
    }
    const draftIsPreviousOutput = isDraftFromPreviousGeneration(
      localDraft,
      node.params.generatedTexts
    )
    if (localDraft && !draftIsPreviousOutput) {
      prompt = `${prompt.trim()}\n\n当前已有大纲底稿（请在此基础上扩写完善）：\n\n${localDraft}` // cjk-ok
    }

    const result = await ctx.generateText({
      prompt,
      system: outlineSystemPrompt,
      model: node.params.generateModel || undefined,
      providerInstanceId: node.params.generateProviderInstanceId || undefined
    })
    if (ctx.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError')
    }
    text = result.text.trim()
    if (!text) {
      throw fail(SHARED_ERRORS.resultMissing, { what: { zh: '小说总纲', en: 'novel outline' } }) // cjk-ok
    }
  }

  // 先标记 novelNodeMode = 'outline'，确保 persistScreenplayGeneration 按显式「第X章」拆分为 out-all 条目
  node.params = {
    ...node.params,
    novelNodeMode: 'outline'
  }
  const persisted = await persistScreenplayGeneration(ctx, text)
  const extractedHeader = extractSharedScreenplayHeader(text).sharedHeader
  const defaultOutlineRoster = createDefaultNovelCharacterRoster(
    createMxWorkbenchPreset('short_drama_progression'),
    totalChapters,
    activeGenre
  )
  const outlineRoster = parseCharacterRosterFromOutlineText(
    `${extractedHeader || text}\n${incomingText}\n${instruction}`,
    defaultOutlineRoster,
    1
  )
  const existingOutlineRoster = normalizeNovelCharacterRoster(node.params.novelCharacterRosterJson)
  const existingIsAllDefault =
    existingOutlineRoster.length === 0 ||
    existingOutlineRoster.every((c) => isDefaultTemplateCharacterEntry(c))
  const outlinePatch = {
    novelNodeMode: 'outline' as const,
    ...(activeGenre ? { novelGenre: activeGenre.id } : {}),
    novelTotalChapters: totalChapters,
    novelTargetWords: targetWords,
    novelWorldBible: (extractedHeader || text).slice(0, 6000),
    ...(existingIsAllDefault
      ? {
          novelCharacterRosterJson: JSON.stringify(outlineRoster)
        }
      : {}),
    ...(!node.params.novelForeshadowingJson?.trim()
      ? {
          novelForeshadowingJson: JSON.stringify(
            createDefaultNovelForeshadowingPool(
              createMxWorkbenchPreset('short_drama_progression'),
              totalChapters,
              activeGenre
            )
          )
        }
      : {})
  }
  // 确保 out 端口始终输出完整总纲（含世界观设定+全部分章细纲），而 out-all 保留按「第X章」拆分后的分章数组供 text.select (chap:1, chap:2) 提取
  let fullOutlineRelPath: string | undefined
  if (persisted.out?.kind === 'text') {
    if (ctx.saveRunText) {
      try {
        fullOutlineRelPath = await ctx.saveRunText({
          content: text,
          key: 'outline-full',
          outputDir: ctx.node.params.mediaOutputDir,
          node: ctx.node
        })
        persisted.out = {
          ...persisted.out,
          text: '',
          relativePath: fullOutlineRelPath
        }
      } catch {
        persisted.out = {
          ...persisted.out,
          text
        }
      }
    } else {
      persisted.out = {
        ...persisted.out,
        text
      }
    }
  }

  const outlineInlineText = fullOutlineRelPath ? '' : node.params.text
  const outlineRelPath = fullOutlineRelPath || node.params.previewRelativePath
  node.params = {
    ...node.params,
    text: outlineInlineText,
    ...(outlineRelPath ? { previewRelativePath: outlineRelPath } : {}),
    ...outlinePatch
  }
  ctx.patchNode?.({
    params: {
      text: outlineInlineText,
      ...(outlineRelPath ? { previewRelativePath: outlineRelPath } : {}),
      generatedTexts: node.params.generatedTexts,
      selectedTextId: node.params.selectedTextId,
      ...outlinePatch
    }
  })
  return persisted
}

interface ParsedNovelStateDeltaPayload {
  summary?: string
  characters?: Array<{
    name?: string
    faction?: 'protagonist' | 'ally' | 'villain' | 'neutral'
    status?: 'active' | 'subdued' | 'injured' | 'eliminated'
    role?: string
    note?: string
  }>
  resources?: Array<{
    name?: string
    status?: string
  }>
  paidOff?: string[]
  newForeshadowing?: {
    title?: string
    payoffSpan?: number
    hint?: string
  }
}

export function extractAndStripNovelStateDeltaComment(rawText: string): {
  cleanText: string
  delta: ParsedNovelStateDeltaPayload | null
} {
  const commentRe = /<!--\s*NOVEL_STATE_DELTA\s*:\s*(\{[\s\S]*?\})\s*-->/i
  const m = commentRe.exec(rawText)
  if (!m) {
    return { cleanText: sanitizeNovelChapterGeneratedText(rawText), delta: null }
  }
  const cleanText = sanitizeNovelChapterGeneratedText(rawText.replace(commentRe, ''))
  let delta: ParsedNovelStateDeltaPayload | null = null
  try {
    const parsed = JSON.parse(m[1]!) as ParsedNovelStateDeltaPayload
    if (parsed && typeof parsed === 'object') {
      delta = parsed
    }
  } catch {
    delta = null
  }
  return { cleanText, delta }
}

/**
 * 清洗单章生成正文中可能残留的模型思考链（<think> / 英文 CoT 复述提示词）、
 * 死循环重复行，以及旧版提示词产出的「小说名：《...》 / 【核心设定与人物档案】 / 【第一拍】」元信息头，
 * 确保章节节点落盘与展示的文本 100% 为纯净章节正文。
 */
export function sanitizeNovelChapterGeneratedText(rawText: string): string {
  let text = rawText
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<think>[\s\S]*$/i, '')
    .trim()
  if (!text) return ''

  // 折叠连续重复行与推理死循环短句
  const lines = text.split(/\r?\n/)
  const dedupedLines: string[] = []
  let lastNorm = ''
  let repeatCount = 0
  for (const line of lines) {
    const norm = line.trim()
    if (norm.length >= 8 && norm === lastNorm) {
      repeatCount += 1
      if (repeatCount >= 2) continue
    } else {
      lastNorm = norm
      repeatCount = 0
    }
    dedupedLines.push(line)
  }
  text = dedupedLines
    .join('\n')
    .replace(/(.{12,120}?)(?:\s*\1){3,}/g, '$1')
    .trim()

  // 若正文包含明确的「第X章」或「Chapter X」标题行，且标题行上方是设定档案/小说名/英文思考过程，直接剥离上方元信息头
  const chapHeadingRe = /^(?:#+\s*)?(?:第\s*\d+\s*(?:\/\s*\d+\s*)?章|Chapter\s+\d+)\b[^\n]*/im // cjk-ok
  const chapMatch = chapHeadingRe.exec(text)
  if (chapMatch && typeof chapMatch.index === 'number' && chapMatch.index > 0) {
    const prefix = text.slice(0, chapMatch.index)
    if (
      /小说名|核心设定与人物档案|本章准入|本章战力|Novel Title|Core World|The user wants|Wait\s*[—-]|system brief|Thinking/i.test(
        prefix
      ) // cjk-ok
    ) {
      text = text.slice(chapMatch.index).trim()
    }
  }

  // 剥离独立成行的【第一拍 · ...】/【第二拍 · ...】节拍标签行，以及首行误包在 HTML 注释中的章节标题、末尾残留的裸 JSON 状态行
  // 同时净化偶发泄露的面板数值括号（如「（当前气血底蕴 `2519`...）」「（映射全书经济仿真步 Step 36/200...）」「（Lv.36/200）」）与词条系统批注后缀
  text = text
    .replace(/^\s*<!--\s*(第\s*\d+\s*章[^\n]*?)\s*-->/i, '# $1') // cjk-ok
    .replace(/^\s*(?:#+\s*)?【第[一二三四1234]拍\s*[·:：—\-][^】\n]*】\s*\n?/gm, '') // cjk-ok
    .replace(
      /【(?:临界蓄满待发|蓄势敛息|局部激活|全功率解封爆发|高潮反噬与调息冷却)窗口[^】\n]*】/g,
      ''
    ) // cjk-ok
    .replace(/[（(](?:当前)?(?:气血底蕴|气血HP|实测战力|战力发挥上限)[^）)\n]*[）)]/g, '') // cjk-ok
    .replace(/[（(]映射全书经济仿真步[^）)\n]*[）)]/g, '') // cjk-ok
    .replace(/[（(](?:当前)?契约(?:\/代价)?反噬压力指数[^）)\n]*[）)]/g, '') // cjk-ok
    .replace(/[（(]Lv\.\s*\d+\s*\/\s*\d+[）)]/gi, '')
    .replace(/\$E\(t=[^$\n]+\)\$\s*/g, '')
    .replace(
      /【([^】\n]*?)(?:·?反手打脸)?\s*[(（](?:第\s*\d+\s*(?:~\d+\s*)?[卷幕][^)）\n]*|势力倍增|丹道乘区|越级反杀|舆论反转|前期启动|名场面铺垫|境界暴涨|铺垫|卡点|终结|高潮卡点)[)）]】/g, // cjk-ok
      '【$1】'
    )
    .replace(/`([+-]?\d+(?:\.\d+)?)`/g, '$1')
    .replace(/^\s*<!--[^\n]*?(?:完|下一章)[^\n]*?-->\s*$/gim, '') // cjk-ok
    .replace(/^\s*\{\s*\x22[A-Za-z]+\x22\s*:[^\n]*\}\s*$/gm, '')
    .replace(/(?:\n\s*---+\s*)+$/g, '')
    .trim()

  return text
}

/**
 * 跨章与章内段落防复读净化：
 * 剥离同一章内完全重复的长段落，以及与上一章正文高度雷同（归一化长度 >= 36 且完全一致）的套话段落。
 */
export function deduplicateNovelParagraphsAgainstPrevious(
  chapterText: string,
  prevChapterText?: string
): string {
  const trimmed = chapterText.trim()
  if (!trimmed) return ''
  const normPara = (s: string): string =>
    s
      .replace(/\s+/g, '')
      .replace(/[，。！？；：“”‘’「」『』、—…·,.!?;:'"()-]/g, '')
      .trim()

  const prevSet = new Set<string>()
  if (prevChapterText?.trim()) {
    for (const p of prevChapterText.split(/\n\s*\n/)) {
      const n = normPara(p)
      if (n.length >= 36) prevSet.add(n)
    }
  }

  const rawBlocks = trimmed.split(/\n\s*\n/)
  const seenSelf = new Set<string>()
  const kept: string[] = []
  for (let i = 0; i < rawBlocks.length; i++) {
    const block = rawBlocks[i]!.trim()
    if (!block) continue
    const isHeading = i === 0 && /^(?:#+\s*)?(?:第\s*\d+|Chapter\s+\d+)/i.test(block) // cjk-ok
    const isEndingHook = i === rawBlocks.length - 1
    const n = normPara(block)
    if (!isHeading && n.length >= 32) {
      if (seenSelf.has(n)) continue
      seenSelf.add(n)
      const remainingCandidates = rawBlocks.length - 1 - i
      if (
        !isEndingHook &&
        n.length >= 36 &&
        prevSet.has(n) &&
        kept.length + remainingCandidates >= 3
      ) {
        continue
      }
    }
    kept.push(block)
  }
  return kept.join('\n\n')
}

function isPureReasoningLeakWithoutNovelProse(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return true
  if (
    /^(?:The user wants|Wait\s*[—-]|Let's check|We need to write|Looking at the system brief)/i.test(
      trimmed
    ) &&
    !/^(?:#+\s*)?第\s*\d+\s*(?:\/\s*\d+\s*)?章/m.test(trimmed) // cjk-ok
  ) {
    return true
  }
  return false
}

function parseBracketedItemsList(rawLine: string): string[] {
  const items: string[] = []
  for (const m of rawLine.matchAll(/【([^】\n]{2,30})】/g)) {
    if (m[1]?.trim()) items.push(m[1].trim())
  }
  if (items.length > 0) return items
  return rawLine
    .split(/[、，,/\s]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2 && !/当前阶段|继续封存|无|None/i.test(s)) // cjk-ok
}

function sanitizeChapterProseAgainstGuardrails(opts: {
  proseText: string
  currentChapter: number
  allowedRaw: string
  lockedRaw: string
  baseRoster: MxNovelCharacterStatusEntry[]
}): {
  sanitizedText: string
  healedLockedTrumps: Array<{ from: string; to: string }>
  healedRevivedVillains: string[]
} {
  let sanitizedText = opts.proseText
  const allowedList = parseBracketedItemsList(opts.allowedRaw)
  const lockedList = parseBracketedItemsList(opts.lockedRaw).filter(
    (lk) => !allowedList.includes(lk)
  )
  const stripMetaSuffix = (s: string): string =>
    s
      .replace(
        /(?:·?反手打脸)?\s*[(（](?:第\s*\d+\s*(?:~\d+\s*)?[卷幕][^)）\n]*|势力倍增|丹道乘区|越级反杀|舆论反转|前期启动|名场面铺垫|境界暴涨|铺垫|卡点|终结|高潮卡点)[)）]$/g, // cjk-ok
        ''
      )
      .trim()
  const primaryAllowed = stripMetaSuffix(allowedList[0] || '') || '本阶段准入核心手段' // cjk-ok
  const healedLockedTrumps: Array<{ from: string; to: string }> = []

  for (const lockedItem of lockedList) {
    const cleanLocked = stripMetaSuffix(lockedItem)
    if (lockedItem.length >= 2 && sanitizedText.includes(lockedItem)) {
      sanitizedText = sanitizedText.split(lockedItem).join(primaryAllowed)
      healedLockedTrumps.push({ from: lockedItem, to: primaryAllowed })
    } else if (cleanLocked.length >= 2 && sanitizedText.includes(cleanLocked)) {
      sanitizedText = sanitizedText.split(cleanLocked).join(primaryAllowed)
      healedLockedTrumps.push({ from: lockedItem, to: primaryAllowed })
    }
  }

  const healedRevivedVillains: string[] = []
  for (const c of opts.baseRoster) {
    if (
      c.status === 'eliminated' &&
      c.updatedAtChapter < opts.currentChapter &&
      c.name &&
      c.name.trim().length >= 2 &&
      sanitizedText.includes(c.name.trim())
    ) {
      const deadName = c.name.trim()
      const replacement = `${deadName}旧部残党` // cjk-ok
      sanitizedText = sanitizedText.split(deadName).join(replacement)
      healedRevivedVillains.push(deadName)
    }
  }

  return {
    sanitizedText,
    healedLockedTrumps,
    healedRevivedVillains
  }
}

async function finalizeNovelChapterMemoryAndPersist(
  ctx: NodeExecuteContext,
  rawText: string,
  meta: {
    currentChapter: number
    totalChapters: number
    targetWords: number
    autoAdvance: boolean
    incomingBrief: string
    genre?: NovelGenreProfile
    inheritedWorldBible?: string
    inheritedStateLedger?: string
    inheritedRollingSummary?: string
    inheritedCharacterRosterJson?: string
    inheritedForeshadowingJson?: string
    inheritedHistoryMap?: Record<string, NovelChapterHistoryEntry>
    inheritedGalleryItems?: GraphTextItem[]
  }
): Promise<Record<string, GraphValue>> {
  const { node } = ctx
  const {
    currentChapter,
    totalChapters,
    targetWords,
    autoAdvance,
    incomingBrief,
    genre,
    inheritedWorldBible,
    inheritedRollingSummary,
    inheritedCharacterRosterJson,
    inheritedForeshadowingJson,
    inheritedHistoryMap,
    inheritedGalleryItems
  } = meta

  // 1. 提取并剥离末尾隐式状态增量注释 <!-- NOVEL_STATE_DELTA: {...} -->，确保正文 100% 纯净
  const { cleanText: strippedRawText, delta: llmDelta } =
    extractAndStripNovelStateDeltaComment(rawText)

  // 1b. 跨章与章内段落防复读净化：若上一章正文已落盘或在内联列表中，剥离完全雷同的套话长段落
  let prevChapterBody = ''
  if (currentChapter > 1) {
    const prevPool = [...(inheritedGalleryItems ?? []), ...(node.params.generatedTexts ?? [])]
    const prevRe = new RegExp(
      `^(?:#+\\s*)?(?:第\\s*${currentChapter - 1}\\s*(?:\\/\\s*\\d+\\s*)?章|Chapter\\s+${currentChapter - 1}\\b)`, // cjk-ok
      'i'
    )
    const prevItem =
      prevPool.find((it) => prevRe.test(it.title?.trim() ?? '')) ??
      prevPool[currentChapter - 2] ??
      prevPool[prevPool.length - 1]
    if (prevItem?.text?.trim()) {
      prevChapterBody = prevItem.text.trim()
    } else if (prevItem?.relativePath?.trim() && ctx.readRunText) {
      try {
        prevChapterBody = (await ctx.readRunText(prevItem.relativePath.trim()))?.trim() ?? ''
      } catch {
        prevChapterBody = ''
      }
    }
  }
  const strippedText = deduplicateNovelParagraphsAgainstPrevious(strippedRawText, prevChapterBody)

  // 提取本章关键信息以自动演进 L1/L2/L3/L4 记忆
  const realmMatch = /主角当前[^*]*\*\*([^*]+)\*\*/.exec(incomingBrief) // cjk-ok
  const ceilingMatch = /\*\*本章[^`]*上限\s*`([^`]+)`\*\*/.exec(incomingBrief) // cjk-ok
  const allowedMatch = /\*\*✅ 本章准入可用[^*]*\*\*:\s*([^\n]+)/.exec(incomingBrief) // cjk-ok
  const lockedMatch = /\*\*🔒 封存禁用的后期终局[^*]*\*\*:\s*([^\n]+)/.exec(incomingBrief) // cjk-ok
  const sysTitleMatch = /\*\*体系名称\*\*:\s*([^\n]+)/.exec(incomingBrief) // cjk-ok

  const curRealm =
    realmMatch?.[1]?.trim() ||
    (genre
      ? `第 ${Math.floor((currentChapter - 1) / 20)} 阶·${genre.stageNamesZh[Math.min(genre.stageNamesZh.length - 1, Math.floor((currentChapter - 1) / 20))] ?? genre.stageNamesZh[0]}` // cjk-ok
      : `第 ${Math.floor((currentChapter - 1) / 20)} 阶`) // cjk-ok
  const curCeiling = ceilingMatch?.[1]?.trim() || `${35 + currentChapter * 12}`
  const unlockTerm = genre?.unlockTermZh ?? '底牌/人脉' // cjk-ok
  const stageTerm = genre?.stageTermZh ?? '境界/阶位' // cjk-ok
  const axisTerm = genre?.protagonistAxisZh ?? '战力天花板' // cjk-ok
  const curAllowed = allowedMatch?.[1]?.trim() || `当前阶段已解锁${unlockTerm}` // cjk-ok
  const curLocked = lockedMatch?.[1]?.trim() || `高阶终局${unlockTerm}（继续封存）` // cjk-ok

  const baseRoster: MxNovelCharacterStatusEntry[] = (() => {
    const raw = node.params.novelCharacterRosterJson?.trim() || inheritedCharacterRosterJson?.trim()
    const normalized = normalizeNovelCharacterRoster(raw)
    if (normalized.length > 0) return normalized
    return createDefaultNovelCharacterRoster(
      createMxWorkbenchPreset('short_drama_progression'),
      totalChapters,
      genre
    )
  })()

  // 2. 生成后闭环围栏自愈拦截（自动修正封存底牌抢跑与已退场反派复活）
  const guardrailSanitized = sanitizeChapterProseAgainstGuardrails({
    proseText: strippedText,
    currentChapter,
    allowedRaw: curAllowed,
    lockedRaw: curLocked,
    baseRoster
  })
  const text = guardrailSanitized.sanitizedText

  const chapTitleMatch =
    new RegExp(
      `第\\s*${currentChapter}\\s*(?:\\/\\s*\\d+\\s*)?章(?:[:：\\s—\\-]+)\\s*([^\\n]+)`
    ).exec(text) || // cjk-ok
    /第\s*\d+\s*(?:\/\s*\d+\s*)?章(?:[:：\s—\-]+)\s*([^\n]+)/.exec(text) // cjk-ok
  const extractedChapTitle =
    chapTitleMatch?.[1]?.trim() || `第 ${currentChapter}/${totalChapters} 章` // cjk-ok
  const galleryItemTitle = `第${currentChapter}/${totalChapters}章：${extractedChapTitle.replace(/^第\s*\d+\s*(?:\/\s*\d+\s*)?章(?:[:：\s—\-]+)\s*/, '')}` // cjk-ok

  const cleanedLines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => Boolean(l) && !/^#+\s*第\s*\d+/i.test(l) && !/^#+\s*Chapter\s*\d+/i.test(l)) // cjk-ok
  const tailAnchor = cleanedLines.slice(-4).join('\n').slice(-580)
  const wordCount = text.replace(/\s+/g, '').length

  let nextWorldBible = node.params.novelWorldBible?.trim() || inheritedWorldBible?.trim() || ''
  if (!nextWorldBible) {
    const sysName =
      sysTitleMatch?.[1]?.trim() ||
      (genre ? `${genre.labelZh}叙事数值体系` : '角色成长与逆袭爽剧数值体系') // cjk-ok
    nextWorldBible = genre
      ? [
          `- 核心驱动体系：${sysName}（流派：${genre.labelZh}，全书动态总章数规划：${totalChapters} 章，单章目标 ${targetWords}+ 字）`, // cjk-ok
          ...genre.worldBibleSeedZh
        ].join('\n')
      : [
          `- 核心驱动体系：${sysName}（全书动态总章数规划：${totalChapters} 章，单章目标 ${targetWords}+ 字）`, // cjk-ok
          `- 力量与财富铁律：严格遵循数值工作台乘区公式与突破阶梯，跨阶对敌需借势或触发准入奇遇底牌，严禁无代价越级秒杀。`, // cjk-ok
          `- 主角核心底色：隐忍果决、谋定后动，不圣母、不降智，底牌按最优交锋序列层层递进揭晓。` // cjk-ok
        ].join('\n')
  }

  const lastSentenceHook = cleanedLines[cleanedLines.length - 1]?.slice(-110) || '章末危机悬念待解' // cjk-ok

  const baseForeshadowings: MxNovelForeshadowingEntry[] = (() => {
    const raw = node.params.novelForeshadowingJson?.trim() || inheritedForeshadowingJson?.trim()
    const normalized = normalizeNovelForeshadowingPool(raw, totalChapters)
    if (normalized.length > 0) return normalized
    return createDefaultNovelForeshadowingPool(
      createMxWorkbenchPreset('short_drama_progression'),
      totalChapters,
      genre
    )
  })()

  const evolvedRosterResult = evolveCharacterRosterFromProse({
    proseText: text,
    worldBible: `${nextWorldBible}\n${incomingBrief}`,
    currentChapter,
    curRealm,
    curCeiling,
    baseRoster
  })
  const evolvedForeshadowingResult = evolveForeshadowingPoolFromProse({
    proseText: text,
    currentChapter,
    baseForeshadowings
  })

  // 3. 若大模型输出了结构化 NOVEL_STATE_DELTA，将其合并至人物名录（含新登场角色）与伏笔池（含新埋伏笔与显式核销）
  if (llmDelta?.characters && Array.isArray(llmDelta.characters)) {
    const byName = new Map<string, MxNovelCharacterStatusEntry>(
      evolvedRosterResult.roster.map((c) => [c.name, c])
    )
    for (const dc of llmDelta.characters) {
      const cName = dc.name?.trim()
      if (!cName) continue
      const validFaction: MxNovelCharacterStatusEntry['faction'] =
        dc.faction === 'protagonist' ||
        dc.faction === 'ally' ||
        dc.faction === 'villain' ||
        dc.faction === 'neutral'
          ? dc.faction
          : 'neutral'
      const validStatus: MxNovelCharacterStatusEntry['status'] =
        dc.status === 'active' ||
        dc.status === 'subdued' ||
        dc.status === 'injured' ||
        dc.status === 'eliminated'
          ? dc.status
          : 'active'
      const existing = byName.get(cName)
      if (existing) {
        byName.set(cName, {
          ...existing,
          status: validStatus,
          realmOrRole: dc.role?.trim() || existing.realmOrRole,
          relationNote: dc.note?.trim() || existing.relationNote,
          updatedAtChapter: currentChapter
        })
        if (validStatus === 'eliminated' && existing.status !== 'eliminated') {
          evolvedRosterResult.statusTransitionNotes.push(
            `${cName}（第${currentChapter}章已伏诛退场）` // cjk-ok
          )
        }
      } else {
        byName.set(cName, {
          id: `char_delta_${currentChapter}_${cName}`,
          name: cName,
          faction: validFaction,
          status: validStatus,
          realmOrRole: dc.role?.trim() || `第${currentChapter}章新登场角色`, // cjk-ok
          relationNote: dc.note?.trim() || `第${currentChapter}章登场`, // cjk-ok
          updatedAtChapter: currentChapter
        })
        if (!evolvedRosterResult.activeInChapterNames.includes(cName)) {
          evolvedRosterResult.activeInChapterNames.push(cName)
        }
      }
    }
    const mergedList = [...byName.values()]
    const hasActiveCustomProtagonist = mergedList.some(
      (c) =>
        c.faction === 'protagonist' && !isDefaultTemplateCharacterEntry(c) && text.includes(c.name)
    )
    evolvedRosterResult.roster = hasActiveCustomProtagonist
      ? mergedList.filter((c) => !isDefaultTemplateCharacterEntry(c) || text.includes(c.name))
      : mergedList
  }

  if (llmDelta?.paidOff && Array.isArray(llmDelta.paidOff)) {
    for (const paidTitle of llmDelta.paidOff) {
      const cleanPaid = paidTitle?.trim()
      if (!cleanPaid) continue
      for (const f of evolvedForeshadowingResult.foreshadowings) {
        if (
          f.status !== 'paid_off' &&
          (f.title.includes(cleanPaid) || cleanPaid.includes(f.title))
        ) {
          f.status = 'paid_off'
          f.paidOffAtChapter = currentChapter
          if (!evolvedForeshadowingResult.paidOffTitles.includes(f.title)) {
            evolvedForeshadowingResult.paidOffTitles.push(f.title)
          }
        }
      }
    }
  }

  if (llmDelta?.newForeshadowing?.title?.trim()) {
    const newTitle = llmDelta.newForeshadowing.title.trim()
    const alreadyExists = evolvedForeshadowingResult.foreshadowings.some(
      (f) => f.title === newTitle
    )
    if (!alreadyExists) {
      const span = Math.max(
        3,
        Math.min(200, Math.round(Number(llmDelta.newForeshadowing.payoffSpan) || 15))
      )
      evolvedForeshadowingResult.foreshadowings.push({
        id: `fs_delta_${currentChapter}_${evolvedForeshadowingResult.foreshadowings.length + 1}`,
        title: newTitle,
        plantedChapter: currentChapter,
        targetPayoffChapterRange: [
          Math.min(totalChapters, currentChapter + 2),
          Math.min(totalChapters, currentChapter + span)
        ],
        status: 'planted',
        payoffHint:
          llmDelta.newForeshadowing.hint?.trim() ||
          `第 ${currentChapter} 章新埋设悬念，预计在第 ${Math.min(totalChapters, currentChapter + 2)}~${Math.min(totalChapters, currentChapter + span)} 章回收揭晓` // cjk-ok
      })
    }
  }

  const stateLedgerLines = [
    `- 最新结算章节：已完成第 ${currentChapter} / ${totalChapters} 章《${extractedChapTitle}》（本章正文字数：${wordCount} 字）`, // cjk-ok
    `- 主角当前${stageTerm}：${curRealm}（当前${axisTerm}：${curCeiling}）`, // cjk-ok
    `- 当前已解锁${unlockTerm}：${curAllowed}`, // cjk-ok
    `- 仍处于封存禁用的终局${unlockTerm}：${curLocked}` // cjk-ok
  ]
  const econSliceAtChap = exportMxChapterEconomySlice(
    { description: `${nextWorldBible}\n${incomingBrief}` },
    { steps: totalChapters },
    { currentChapter, totalChapters, genre }
  )
  const deltaResourceEntries = Array.isArray(llmDelta?.resources)
    ? llmDelta!.resources
        .map((r) => {
          const n = r.name?.trim()
          const s = r.status?.trim()
          return n && s ? `${n}（${s}）` : n || s || ''
        })
        .filter(Boolean)
    : []
  const econKeywords = Array.from(
    new Set(
      text.match(
        /(?:下品|中品|上品|极品)?灵石|丹药|药材|仙草|寿元|阳寿|生机|命火|气血|真元|功德|香火|符箓|阵盘|晶核|银两|铜钱|资金链/g // cjk-ok
      ) ?? []
    )
  ).slice(0, 5)
  const resourceDetailSuffix =
    deltaResourceEntries.length > 0
      ? `；本章资源明细：${deltaResourceEntries.join('；')}` // cjk-ok
      : econKeywords.length > 0
        ? `；本章涉及【${econKeywords.join('、')}】流转与损耗` // cjk-ok
        : ''
  stateLedgerLines.push(
    `- 当前核心资源与代价账本（经济系统时间序列 E(t=${currentChapter}) · ${econSliceAtChap.economyBeatLabelZh}）：期初储备 ${econSliceAtChap.openingReserve} ➔ 本章获取上限 +${econSliceAtChap.inflowQuota} / 刚性消耗 -${econSliceAtChap.mandatoryDrain} ➔ 期末结余 ${econSliceAtChap.closingReserveTarget}（契约反噬压力指数 ${econSliceAtChap.contractPressureIndex}）${resourceDetailSuffix}` // cjk-ok
  )
  if (evolvedRosterResult.activeInChapterNames.length > 0) {
    stateLedgerLines.push(
      `- 本章登场活跃人物：${evolvedRosterResult.activeInChapterNames.join('、')}` // cjk-ok
    )
  }
  if (evolvedRosterResult.statusTransitionNotes.length > 0) {
    stateLedgerLines.push(
      `- 本章人物关系/生死状态变更：${evolvedRosterResult.statusTransitionNotes.join('；')}` // cjk-ok
    )
  }
  if (evolvedForeshadowingResult.paidOffTitles.length > 0) {
    stateLedgerLines.push(
      `- 本章已成功回收伏笔：${evolvedForeshadowingResult.paidOffTitles.map((t) => `《${t}》`).join('、')}` // cjk-ok
    )
  }
  if (guardrailSanitized.healedLockedTrumps.length > 0) {
    stateLedgerLines.push(
      `- 🛡️ 数值围栏自愈记录：已自动拦截越界封存底牌并修正为本章准入手段（${guardrailSanitized.healedLockedTrumps.map((h) => `${h.from}➔${h.to}`).join('、')}）` // cjk-ok
    )
  }
  if (guardrailSanitized.healedRevivedVillains.length > 0) {
    stateLedgerLines.push(
      `- 🛡️ 角色生死防穿帮自愈：已自动拦截已退场反派（${guardrailSanitized.healedRevivedVillains.join('、')}）无故复活并替换为旧部残党` // cjk-ok
    )
  }
  stateLedgerLines.push(
    `- 待下一章（第 ${Math.min(totalChapters, currentChapter + 1)} 章）承接的章末悬念钩子：${lastSentenceHook}` // cjk-ok
  )
  const nextStateLedger = stateLedgerLines.join('\n')

  const baseSemanticSummary = synthesizeChapterSemanticSummary({
    text,
    currentChapter,
    extractedChapTitle,
    curRealm,
    curCeiling
  })
  const oneLineSummary = llmDelta?.summary?.trim()
    ? `第${currentChapter}章《${extractedChapTitle}》(${curRealm}/上限${curCeiling})：[核心推进] ${llmDelta.summary.trim()} ➔ ${baseSemanticSummary.replace(/^第\d+章《[^》]+》\([^)]+\)：/, '')}` // cjk-ok
    : baseSemanticSummary
  const baseRollingSummary =
    node.params.novelRollingSummary?.trim() || inheritedRollingSummary?.trim() || ''
  const existingSummaryLines = baseRollingSummary
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith(`- 第${currentChapter}章《`)) // cjk-ok
  existingSummaryLines.push(`- ${oneLineSummary}`)
  // 保持最近 20 章滚动摘要，防止 800 章连载时上下文膨胀
  const boundedSummaryLines = existingSummaryLines.slice(-20)
  const nextRollingSummary = boundedSummaryLines.join('\n')

  const historyMap: Record<string, NovelChapterHistoryEntry> = {
    ...(inheritedHistoryMap ?? {}),
    ...parseNovelChapterHistory(node.params.novelChapterHistoryJson)
  }
  historyMap[String(currentChapter)] = {
    chapter: currentChapter,
    title: extractedChapTitle,
    wordCount,
    summary: oneLineSummary,
    tailAnchor,
    updatedAt: new Date().toISOString()
  }
  const nextHistoryJson = JSON.stringify(historyMap)
  const nextChapterCursor = autoAdvance
    ? Math.min(totalChapters, currentChapter + 1)
    : currentChapter

  await persistScreenplayGeneration(ctx, text, { title: galleryItemTitle })

  // 合并上游章节节点的 generatedTexts + 同章号重写原地覆盖 + 按章号升序归档
  const parseChapNo = (title: string | undefined, fallbackIdx: number): number => {
    if (!title) return fallbackIdx + 1
    const m = /第\s*(\d+)\s*(?:\/\s*\d+\s*)?章/.exec(title) || /Chapter\s*(\d+)/i.exec(title) // cjk-ok
    return m && m[1] ? Number(m[1]) : fallbackIdx + 1
  }
  const ownRawGallery = [...(node.params.generatedTexts ?? [])]
  const newestItem = ownRawGallery[ownRawGallery.length - 1]
  const combinedGallery = [...(inheritedGalleryItems ?? []), ...ownRawGallery]
  const byChapterMap = new Map<number, GraphTextItem>()
  const unnumberedItems: GraphTextItem[] = []
  for (const [idx, item] of combinedGallery.entries()) {
    const chapNo = parseChapNo(item.title, -1)
    if (chapNo >= 1) {
      if (!autoAdvance && chapNo > currentChapter) continue
      const existing = byChapterMap.get(chapNo)
      byChapterMap.set(chapNo, {
        ...item,
        id: item.id || existing?.id || `chap-${chapNo}-${idx}`
      })
    } else {
      unnumberedItems.push(item)
    }
  }
  const dedupedGallery = [
    ...[...byChapterMap.entries()].sort((a, b) => a[0] - b[0]).map(([, item]) => item),
    ...unnumberedItems
  ]
  const targetSelectedId =
    byChapterMap.get(currentChapter)?.id ||
    dedupedGallery.find((item, idx) => parseChapNo(item.title, idx) === currentChapter)?.id ||
    newestItem?.id ||
    node.params.selectedTextId ||
    ''

  const memoryPatch = {
    ...(genre ? { novelGenre: genre.id } : {}),
    novelTotalChapters: totalChapters,
    novelCurrentChapter: nextChapterCursor,
    novelTargetWords: targetWords,
    novelAutoAdvanceChapter: autoAdvance,
    novelWorldBible: nextWorldBible,
    novelStateLedger: nextStateLedger,
    novelRollingSummary: nextRollingSummary,
    novelChapterHistoryJson: nextHistoryJson,
    novelCharacterRosterJson: JSON.stringify(evolvedRosterResult.roster),
    novelForeshadowingJson: JSON.stringify(evolvedForeshadowingResult.foreshadowings)
  }
  node.params = {
    ...node.params,
    generatedTexts: dedupedGallery,
    selectedTextId: targetSelectedId,
    ...memoryPatch
  }
  ctx.patchNode?.({
    params: {
      text: node.params.text,
      ...(node.params.previewRelativePath
        ? { previewRelativePath: node.params.previewRelativePath }
        : {}),
      generatedTexts: dedupedGallery,
      selectedTextId: targetSelectedId,
      ...memoryPatch
    }
  })

  return dualTextGalleryOutputs(dedupedGallery, targetSelectedId)
}

/**
 * 创建小说节点（`asset.novel`）：
 * 同时支持两种工作流范式：
 * 1. **短剧式分章串联工作流（推荐）**：
 *    `[总纲 asset.novel (novelNodeMode='outline')] -> [第1章 asset.novel] -> [第2章 asset.novel] -> [第3章 asset.novel]...`
 *    （或通过 `text.select` 按 `chap:1` / `chap:2` 提取分章大纲后喂给各章节点）。
 *    下游章节节点自动从上游章节节点继承 L1 世界观、L2 状态账本、L3 滚动摘要、L4 上一章末尾原文锚点与累计章节图库，并自动向祖先 `game.economy` 节点提取对应章号 `N` 的单章数值围栏。
 * 2. **单节点状态游标连载工作流**：
 *    单个 `asset.novel` 节点生成完第 N 章后自动推进游标至 N+1 章并沉淀到 `generatedTexts`。
 */
export async function executeNovelGenerateNode(
  rawCtx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const ctx = await hydrateContextForTextConsumer(rawCtx)
  const { node } = ctx
  if (isAssetRefNode(node)) {
    return executeTextAssetRefNode(ctx)
  }

  const executionMode = resolveNovelNodeExecutionMode(node)
  const upstreamChain = await resolveUpstreamNovelChainContext(ctx)

  const ownTotalChapters = Number(node.params.novelTotalChapters)
  const resolvedTotalChapters =
    !ownTotalChapters ||
    (ownTotalChapters === 800 &&
      upstreamChain.inheritedTotalChapters &&
      upstreamChain.inheritedTotalChapters !== 800)
      ? upstreamChain.inheritedTotalChapters || 800
      : ownTotalChapters
  const totalChapters = Math.max(1, Math.min(5000, Math.round(resolvedTotalChapters)))
  const rawConfiguredChapter = Math.max(
    1,
    Math.min(totalChapters, Math.round(Number(node.params.novelCurrentChapter) || 1))
  )
  const currentChapter = Math.max(
    1,
    Math.min(totalChapters, upstreamChain.inferredChapter ?? rawConfiguredChapter)
  )
  const targetWords = Math.max(
    1000,
    Math.min(
      15000,
      Math.round(Number(node.params.novelTargetWords) || upstreamChain.inheritedTargetWords || 3200)
    )
  )
  const effectiveAutoAdvance = upstreamChain.isChainedOrFixedChapterNode
    ? false
    : ctx.document
      ? node.params.novelAutoAdvanceChapter === true
      : node.params.novelAutoAdvanceChapter !== false

  const rawMentionSources = resolveMentionSources(ctx)
  const rawUpstreamSample = rawMentionSources
    .map((s) => s.text)
    .join('\n')
    .slice(0, 1500)

  const explicitOrInferredGenreId =
    node.params.novelGenre?.trim() ||
    upstreamChain.inheritedGenre ||
    inferNovelGenreFromText(
      `${node.title ?? ''} ${node.params.generateInstruction ?? ''} ${node.params.novelWorldBible ?? ''} ${upstreamChain.inheritedWorldBible ?? ''} ${rawUpstreamSample}`
    )
  const hasCustomOverrides = Boolean(
    node.params.novelCustomStagesText?.trim() ||
    node.params.novelCustomAxisProtagonist?.trim() ||
    node.params.novelCustomAxisAntagonist?.trim() ||
    node.params.novelCustomUnlockTerm?.trim()
  )
  const activeGenre = resolveNovelGenreProfile(
    explicitOrInferredGenreId || (hasCustomOverrides ? 'custom_literary' : undefined),
    {
      stagesText: node.params.novelCustomStagesText,
      axisProtagonist: node.params.novelCustomAxisProtagonist,
      axisAntagonist: node.params.novelCustomAxisAntagonist,
      unlockTerm: node.params.novelCustomUnlockTerm,
      sourceContextText: `${node.params.generateInstruction ?? ''}\n${node.params.novelWorldBible ?? ''}\n${upstreamChain.inheritedWorldBible ?? ''}\n${rawUpstreamSample}`
    }
  )

  const unwrapOpts = {
    currentChapter,
    totalChapters,
    targetWordsPerChapter: targetWords,
    genre: activeGenre
  }
  const narrowOpts = {
    totalChapters,
    targetWords,
    genre: activeGenre
  }

  const mentionSources = rawMentionSources.map((s) => {
    const unwrapped = unwrapEconomyBundleForNarrative(s.text, unwrapOpts)
    const isEconomyDoc =
      unwrapped !== s.text ||
      unwrapped.includes('单章数值围栏与底牌配额锁') || // cjk-ok
      unwrapped.includes('全书经济系统与核心资源供需法则') || // cjk-ok
      unwrapped.includes('叙事与爽点节奏导引书') // cjk-ok
    return {
      ...s,
      text:
        executionMode === 'chapter' && !isEconomyDoc
          ? narrowOutlineTextForChapter(unwrapped, currentChapter, ctx.locale, narrowOpts)
          : unwrapped
    }
  })
  const instructionRaw = node.params.generateInstruction?.trim() ?? ''
  const instruction = expandInstructionMentions(instructionRaw, mentionSources)
  const selected = selectIncomingValuesForInstruction(ctx, instructionRaw)
  const incomingTextRaw = autoIncomingTextForInstruction(instructionRaw, selected, mentionSources)

  // 三路条件输入马尔可夫链（P(C_t | C_{t-1}, O_t, E_t)）：
  // 1. E_t：game.economy 输入按本章章号 t 解包为单章数值围栏与准入底牌配额锁；
  // 2. O_t：novel.outline 输入按本章章号 t 切片为【全局设定 + 第 t 章专属细纲（或分卷区间相位切片）+ 第 t+1 章预告】；
  // 3. C_{t-1}：上一章正文节点通过源节点类型（directUpstreamChapterTexts）确定性识别，将其 L1/L2/L2.5/L3/L3.5/L4 传递到 memoryBlock，并自动剥离上一章 3000+ 字全文，保持上下文 O(1) 恒定大小。
  const outlinePortTexts = new Set(
    flattenTextValues(ctx.inputs['in-outline'] ?? [])
      .map((item) => item.text.trim())
      .filter(Boolean)
  )
  const rawIncomingDocs: string[] = instructionHasMentions(instructionRaw)
    ? []
    : (() => {
        const allPortValues = [
          ...selected,
          ...(ctx.inputs['in-outline'] ?? []),
          ...(ctx.inputs['in-economy'] ?? []),
          ...(ctx.inputs['in-numerical'] ?? []),
          ...(ctx.inputs.in ?? [])
        ]
        const seenTexts = new Set<string>()
        const fromPorts: string[] = []
        for (const item of flattenTextValues(allPortValues)) {
          const t = item.text.trim()
          if (t && !seenTexts.has(t)) {
            seenTexts.add(t)
            fromPorts.push(t)
          }
        }
        if (fromPorts.length > 0) return fromPorts
        return rawMentionSources.map((s) => s.text.trim()).filter(Boolean)
      })()

  const incomingChunks: string[] = []
  for (const rawDoc of rawIncomingDocs) {
    const trimmedRaw = rawDoc.trim()
    const unwrapped = unwrapEconomyBundleForNarrative(trimmedRaw, unwrapOpts).trim()
    if (!unwrapped) continue
    const isEconomyDoc =
      unwrapped !== trimmedRaw ||
      unwrapped.includes('单章数值围栏与底牌配额锁') || // cjk-ok
      unwrapped.includes('全书经济系统与核心资源供需法则') || // cjk-ok
      unwrapped.includes('叙事与爽点节奏导引书') // cjk-ok
    if (isEconomyDoc) {
      incomingChunks.push(unwrapped)
      continue
    }
    if (executionMode === 'chapter') {
      // (A) 确定性源节点识别：若直接来自上游单章 asset.novel 节点，则剥离其完整正文（马尔可夫状态已由 memoryBlock 承载）
      if (
        upstreamChain.directUpstreamChapterTexts.has(trimmedRaw) ||
        upstreamChain.directUpstreamChapterTexts.has(unwrapped)
      ) {
        continue
      }
      // (B) 确定性源节点识别、端口识别或结构识别：若来自 novel.outline 节点（或 in-outline 端口）、含多章细纲标记、或含分卷区间标记，则执行三级全生命周期大纲切片
      const isFromOutlineNode =
        outlinePortTexts.has(trimmedRaw) ||
        outlinePortTexts.has(unwrapped) ||
        upstreamChain.directUpstreamOutlineTexts.has(trimmedRaw) ||
        upstreamChain.directUpstreamOutlineTexts.has(unwrapped)
      const splitChaps = splitScreenplayByExplicitEpisodeMarkers(unwrapped, {
        includeSharedBios: true,
        locale: ctx.locale,
        skipStats: true
      })
      const hasRangeArcs = parseOutlineRangeArcBlocks(unwrapped).length > 0
      if (isFromOutlineNode || splitChaps.length >= 2 || hasRangeArcs) {
        incomingChunks.push(
          narrowOutlineTextForChapter(unwrapped, currentChapter, ctx.locale, narrowOpts)
        )
        continue
      }
      // (C) 兜底无图上下文（独立调用）时的上一章全文剥离
      if (upstreamChain.directUpstreamChapterNodeIds.size > 0 && currentChapter > 1) {
        const prevChapHeaderRe = new RegExp(
          `(?:第\\s*${currentChapter - 1}\\s*(?:\\/\\s*\\d+\\s*)?章(?:[:：\\s—\\-]|$)|\\bChapter\\s*${currentChapter - 1}(?:\\s*\\/\\s*\\d+)?(?:[:：\\s—\\-]|$))`, // cjk-ok
          'i'
        )
        const curChapHeaderRe = new RegExp(
          `(?:第\\s*${currentChapter}\\s*(?:\\/\\s*\\d+\\s*)?章(?:[:：\\s—\\-]|$)|\\bChapter\\s*${currentChapter}(?:\\s*\\/\\s*\\d+)?(?:[:：\\s—\\-]|$))`, // cjk-ok
          'i'
        )
        const isPrevChapterFullProse =
          prevChapHeaderRe.test(unwrapped) && !curChapHeaderRe.test(unwrapped)
        if (isPrevChapterFullProse) {
          continue
        }
      }
    }
    incomingChunks.push(unwrapped)
  }

  if (upstreamChain.upstreamEconomyRawText) {
    const econSlice = unwrapEconomyBundleForNarrative(
      upstreamChain.upstreamEconomyRawText,
      unwrapOpts
    ).trim()
    if (econSlice && !incomingChunks.some((c) => c.includes('单章数值围栏与底牌配额锁'))) {
      // cjk-ok
      incomingChunks.unshift(econSlice)
    }
  }
  if (upstreamChain.upstreamEconomyOnlyRawText) {
    const econOnlySlice = unwrapEconomyBundleForNarrative(
      upstreamChain.upstreamEconomyOnlyRawText,
      unwrapOpts
    ).trim()
    if (
      econOnlySlice &&
      !incomingChunks.some((c) => c.includes('全书经济系统与核心资源供需法则')) // cjk-ok
    ) {
      incomingChunks.unshift(econOnlySlice)
    }
  }
  if (upstreamChain.upstreamChapterOutlineSlice) {
    const outlineSlice = upstreamChain.upstreamChapterOutlineSlice.trim()
    if (outlineSlice && !incomingChunks.some((c) => c.includes(outlineSlice.slice(0, 40)))) {
      incomingChunks.push(outlineSlice)
    }
  }
  const incomingText = incomingChunks.join('\n\n')

  if (executionMode === 'outline') {
    return await executeNovelOutlineNode(ctx, {
      totalChapters,
      targetWords,
      activeGenre,
      instruction,
      incomingText
    })
  }

  const historyMap: Record<string, NovelChapterHistoryEntry> = {
    ...upstreamChain.inheritedHistoryMap,
    ...parseNovelChapterHistory(node.params.novelChapterHistoryJson)
  }
  const prevChapterEntry = currentChapter > 1 ? historyMap[String(currentChapter - 1)] : undefined
  const fallbackPrevTail =
    currentChapter > 1 && !prevChapterEntry?.tailAnchor
      ? upstreamChain.inheritedPrevTailAnchor ||
        extractTailAnchorFromNovelBody(node.params.text) ||
        (incomingTextRaw.includes(`第${currentChapter - 1}章`) // cjk-ok
          ? extractTailAnchorFromNovelBody(incomingTextRaw)
          : '')
      : ''
  const prevTailAnchor = prevChapterEntry?.tailAnchor || fallbackPrevTail

  const activeWorldBible = node.params.novelWorldBible?.trim() || upstreamChain.inheritedWorldBible
  const activeStateLedger =
    node.params.novelStateLedger?.trim() || upstreamChain.inheritedStateLedger
  const activeRollingSummary =
    node.params.novelRollingSummary?.trim() || upstreamChain.inheritedRollingSummary
  const activeCharacterRosterJson =
    node.params.novelCharacterRosterJson?.trim() || upstreamChain.inheritedCharacterRosterJson
  const activeForeshadowingJson =
    node.params.novelForeshadowingJson?.trim() || upstreamChain.inheritedForeshadowingJson

  const memoryBlock = buildNovelChapterMemoryBlock({
    currentChapter,
    totalChapters,
    targetWords,
    worldBible: activeWorldBible,
    stateLedger: activeStateLedger,
    rollingSummary: activeRollingSummary,
    prevTailAnchor,
    characterRosterJson: activeCharacterRosterJson,
    foreshadowingJson: activeForeshadowingJson,
    historyMap,
    incomingOutlineAndInstruction: `${incomingText}\n${instruction}`,
    locale: ctx.locale,
    genre: activeGenre
  })

  const passthroughOutputs: Record<string, GraphValue> = {}
  const outOutlineVal = rawCtx.inputs?.['in-outline']?.[0] ?? upstreamChain.outlinePassthroughValue
  const outEconomyVal = rawCtx.inputs?.['in-economy']?.[0] ?? upstreamChain.economyPassthroughValue
  const outNumericalVal =
    rawCtx.inputs?.['in-numerical']?.[0] ?? upstreamChain.numericalPassthroughValue
  if (outOutlineVal) passthroughOutputs['out-outline'] = outOutlineVal
  if (outEconomyVal) passthroughOutputs['out-economy'] = outEconomyVal
  if (outNumericalVal) passthroughOutputs['out-numerical'] = outNumericalVal

  if (!ctx.generateText) {
    const localText = normalizeLocalScreenplayText(node.params.text)
    const offlineNovel = synthesizeNovelFromProgressionBriefOffline(
      incomingText || instruction,
      instruction,
      {
        currentChapter,
        totalChapters,
        targetWords,
        worldBible: activeWorldBible,
        stateLedger: activeStateLedger,
        rollingSummary: activeRollingSummary,
        prevTailAnchor,
        genre: activeGenre
      }
    )
    const text = offlineNovel || instruction.trim() || incomingText || localText
    if (!text.trim()) return { ...dualTextGalleryOutputs([], ''), ...passthroughOutputs }
    const baseOut = await finalizeNovelChapterMemoryAndPersist(ctx, text, {
      currentChapter,
      totalChapters,
      targetWords,
      autoAdvance: effectiveAutoAdvance,
      incomingBrief: incomingText || instruction,
      genre: activeGenre,
      inheritedWorldBible: upstreamChain.inheritedWorldBible,
      inheritedStateLedger: upstreamChain.inheritedStateLedger,
      inheritedRollingSummary: upstreamChain.inheritedRollingSummary,
      inheritedCharacterRosterJson: upstreamChain.inheritedCharacterRosterJson,
      inheritedForeshadowingJson: upstreamChain.inheritedForeshadowingJson,
      inheritedHistoryMap: upstreamChain.inheritedHistoryMap,
      inheritedGalleryItems: upstreamChain.inheritedGalleryItems
    })
    return { ...baseOut, ...passthroughOutputs }
  }

  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  const localDraft = normalizeLocalScreenplayText(node.params.text)
  const draftIsPreviousOutput =
    isDraftFromPreviousGeneration(localDraft, node.params.generatedTexts) ||
    Object.keys(historyMap).length > 0

  let prompt = buildNovelPrompt(instruction || defaultNovelUserPrompt(ctx.locale), ctx.locale)
  prompt = `${prompt.trim()}\n\n${memoryBlock}`
  if (incomingText) {
    prompt = `${prompt.trim()}\n\n${incomingText}`
  }
  if (localDraft && !draftIsPreviousOutput) {
    const lead = (ctx.locale ?? '').toLowerCase().startsWith('en')
      ? 'Existing novel draft to expand / refine / continue:'
      : '当前已有小说底稿（请在此基础上按上述指令与数值体系扩写、润色或续写）：' // cjk-ok
    prompt = `${prompt.trim()}\n\n${lead}\n\n${localDraft}`
  }

  const result = await ctx.generateText({
    prompt,
    system: resolveNovelSystemPrompt(node.params.generateSystemPrompt, ctx.locale),
    model: node.params.generateModel || undefined,
    providerInstanceId: node.params.generateProviderInstanceId || undefined
  })
  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }
  const rawResultText = result.text.trim()
  const cleanedCandidate = sanitizeNovelChapterGeneratedText(rawResultText)
  const text = isPureReasoningLeakWithoutNovelProse(cleanedCandidate)
    ? synthesizeNovelFromProgressionBriefOffline(incomingText || instruction, instruction, {
        currentChapter,
        totalChapters,
        targetWords,
        worldBible: activeWorldBible,
        stateLedger: activeStateLedger,
        rollingSummary: activeRollingSummary,
        prevTailAnchor,
        genre: activeGenre
      }) || cleanedCandidate
    : cleanedCandidate
  if (!text) throw fail(SHARED_ERRORS.resultMissing, { what: { zh: '小说文本', en: 'novel text' } }) // cjk-ok 双语错误数据（zh/en，由 errors/catalog 统一格式化）

  const baseOut = await finalizeNovelChapterMemoryAndPersist(ctx, text, {
    currentChapter,
    totalChapters,
    targetWords,
    autoAdvance: effectiveAutoAdvance,
    incomingBrief: incomingText || instruction,
    genre: activeGenre,
    inheritedWorldBible: upstreamChain.inheritedWorldBible,
    inheritedStateLedger: upstreamChain.inheritedStateLedger,
    inheritedRollingSummary: upstreamChain.inheritedRollingSummary,
    inheritedCharacterRosterJson: upstreamChain.inheritedCharacterRosterJson,
    inheritedForeshadowingJson: upstreamChain.inheritedForeshadowingJson,
    inheritedHistoryMap: upstreamChain.inheritedHistoryMap,
    inheritedGalleryItems: upstreamChain.inheritedGalleryItems
  })
  return { ...baseOut, ...passthroughOutputs }
}

function unwrapIncomingChunkForGameSystem(
  rawChunk: string,
  upstreamNovelMeta?: {
    novelGenreId?: string
    worldBible?: string
    stateLedger?: string
    characterRosterJson?: string
    foreshadowingJson?: string
    totalChapters?: number
    customStagesText?: string
    customAxisProtagonist?: string
    customAxisAntagonist?: string
    customUnlockTerm?: string
  }
): string {
  const trimmed = (rawChunk ?? '').trim()
  if (!trimmed) return ''
  // 1. 优先识别并解包上游 game.economy 数值工作台与 Machinations 载荷
  const unwrappedEcon = unwrapEconomyBundleForGameSystem(trimmed)
  if (unwrappedEcon !== trimmed) {
    return unwrappedEcon
  }
  // 2. 识别上游 asset.novel 小说正文/大纲并提取 IP 角色卡池、境界阶梯、神兵道具与章节关卡表
  if (trimmed.includes('【上游小说 IP（asset.novel）➔ 游戏系统策划案')) {
    // cjk-ok
    return trimmed
  }
  const looksLikeNovel =
    !/#\s*系统概述|#\s*功能点设计/i.test(trimmed) && // cjk-ok
    (Boolean(upstreamNovelMeta) ||
      /小说名[：:]|【核心设定与人物档案】|【全书分卷与长线大纲】|第\s*\d+\s*(?:\/\s*\d+\s*)?章/.test(
        trimmed
      ) || // cjk-ok
      trimmed.length >= 600)
  if (
    looksLikeNovel &&
    (Boolean(upstreamNovelMeta) ||
      /小说名[：:]|【核心设定|第\s*\d+\s*(?:\/\s*\d+\s*)?章/.test(trimmed)) // cjk-ok
  ) {
    const ipBlock = extractNovelIpContextForGameSystem({
      novelText: trimmed,
      ...upstreamNovelMeta
    })
    return ipBlock ? `${trimmed}\n\n${ipBlock}` : trimmed
  }
  return trimmed
}

/** 游戏系统策划案生成：打通上游经济系统（game.economy）与小说 IP（asset.novel），生成可直接喂给下游 ui.split 的系统策划案 */
export async function executeGameSystemGenerateNode(
  rawCtx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const ctx = await hydrateContextForTextConsumer(rawCtx)
  const { node } = ctx
  if (isAssetRefNode(node)) {
    return executeTextAssetRefNode(ctx)
  }

  // 从画布拓扑识别直连的上游小说节点与经济系统节点，读取结构化世界观、人物名录与数值工作台
  const doc = ctx.document
  const directUpstreamNovelNode = doc?.edges
    ? doc.edges
        .filter((e) => e.target === node.id)
        .map((e) => doc.nodes.find((n) => n.id === e.source))
        .find((n) => n?.typeId === 'asset.novel' || n?.typeId === 'novel.outline')
    : undefined
  const directUpstreamEconomyNode = doc?.edges
    ? doc.edges
        .filter((e) => e.target === node.id)
        .map((e) => doc.nodes.find((n) => n.id === e.source))
        .find((n) => n?.typeId === 'game.numerical' || n?.typeId === 'game.economy')
    : undefined
  const upstreamEconomyDoc = (() => {
    if (!directUpstreamEconomyNode) return undefined
    const diagramRaw = directUpstreamEconomyNode.params.gameEconomyDiagramJson?.trim() ?? ''
    if (diagramRaw) {
      const parsed = parseMxDocumentJson(diagramRaw)
      if (parsed) return parsed
    }
    const textRaw = directUpstreamEconomyNode.params.text?.trim() ?? ''
    if (textRaw.includes('"machinations_economy_bundle"')) {
      try {
        const bundle = JSON.parse(textRaw) as { document?: unknown }
        if (bundle.document) {
          const parsed = parseMxDocumentJson(JSON.stringify(bundle.document))
          if (parsed) return parsed
        }
      } catch {
        // fallback below
      }
    }
    if (directUpstreamEconomyNode.typeId === 'game.numerical') {
      const mxDoc = createMxFromTemplate('roguelike_run')
      const wbJson = directUpstreamEconomyNode.params.gameNumericalWorkbenchJson?.trim() ?? ''
      let wb = createMxWorkbenchPreset(
        (directUpstreamEconomyNode.params.gameNumericalPreset as any) || 'slay_the_spire_dbg'
      )
      if (wbJson) {
        try {
          const parsedWb = JSON.parse(wbJson)
          if (parsedWb && typeof parsedWb === 'object') wb = { ...wb, ...parsedWb }
        } catch {
          // ignore
        }
      }
      mxDoc.workbench = wb
      return mxDoc
    }
    return createMxFromTemplate(
      (directUpstreamEconomyNode.params.gameEconomyPreset as MxTemplateId) || 'roguelike_run'
    )
  })()
  const upstreamNovelMeta = directUpstreamNovelNode
    ? {
        novelGenreId: directUpstreamNovelNode.params.novelGenre,
        worldBible: directUpstreamNovelNode.params.novelWorldBible,
        stateLedger: directUpstreamNovelNode.params.novelStateLedger,
        characterRosterJson: directUpstreamNovelNode.params.novelCharacterRosterJson,
        foreshadowingJson: directUpstreamNovelNode.params.novelForeshadowingJson,
        totalChapters: directUpstreamNovelNode.params.novelTotalChapters,
        customStagesText: directUpstreamNovelNode.params.novelCustomStagesText,
        customAxisProtagonist: directUpstreamNovelNode.params.novelCustomAxisProtagonist,
        customAxisAntagonist: directUpstreamNovelNode.params.novelCustomAxisAntagonist,
        customUnlockTerm: directUpstreamNovelNode.params.novelCustomUnlockTerm
      }
    : undefined

  const mentionSources = resolveMentionSources(ctx).map((s) => ({
    ...s,
    text: unwrapIncomingChunkForGameSystem(s.text, upstreamNovelMeta)
  }))
  const instructionRaw = node.params.generateInstruction?.trim() ?? ''
  const instruction = expandInstructionMentions(instructionRaw, mentionSources)
  const selected = selectIncomingValuesForInstruction(ctx, instructionRaw)

  // 按端口语义读取：in-economy（经济系统数值契约）+ in（文本/小说累计章节合集）
  const collectValueDocStrings = (vals: GraphValue[]): string[] => {
    const out: string[] = []
    for (const v of vals) {
      if (v.kind === 'text' && v.text.trim()) {
        out.push(v.text.trim())
      } else if (v.kind === 'texts') {
        const joined = v.items
          .map((it) => {
            const body = (it.text ?? '').trim()
            if (!body) return ''
            const title = (it.title ?? '').trim()
            if (title && !body.startsWith(title) && !body.startsWith(`# ${title}`)) {
              return `## ${title}\n${body}`
            }
            return body
          })
          .filter(Boolean)
          .join('\n\n')
        if (joined) out.push(joined)
      } else {
        for (const item of flattenTextValues([v])) {
          if (item.text.trim()) out.push(item.text.trim())
        }
      }
    }
    return out
  }

  const incomingDocs: string[] = instructionHasMentions(instructionRaw)
    ? []
    : (() => {
        const allPortVals = [
          ...(ctx.inputs['in-economy'] ?? []),
          ...(ctx.inputs['in-numerical'] ?? []),
          ...(ctx.inputs.in ?? []),
          ...selected
        ]
        const rawDocs = collectValueDocStrings(allPortVals)
        const deduped: string[] = []
        const seen = new Set<string>()
        for (const d of rawDocs) {
          const unwrapped = unwrapIncomingChunkForGameSystem(d, upstreamNovelMeta)
          if (unwrapped && !seen.has(unwrapped)) {
            seen.add(unwrapped)
            deduped.push(unwrapped)
          }
        }
        for (const s of mentionSources) {
          const t = s.text.trim()
          if (t && !seen.has(t)) {
            seen.add(t)
            deduped.push(t)
          }
        }
        return deduped
      })()
  const incomingText = incomingDocs.filter(Boolean).join('\n\n')

  const explicitArchetypeId = isGameSystemArchetypeId(node.params.gameSystemArchetype)
    ? node.params.gameSystemArchetype
    : undefined
  const targetAspect =
    node.params.gameSystemTargetAspect === '9:16' ||
    node.params.gameSystemTargetAspect === '16:9' ||
    node.params.gameSystemTargetAspect === '1:1'
      ? node.params.gameSystemTargetAspect
      : undefined
  const isDefaultGameSysInstr =
    !instruction.trim() ||
    instruction.trim() === defaultGameSystemUserPrompt('zh-CN').trim() ||
    instruction.trim() === defaultGameSystemUserPrompt('en-US').trim()
  const customInstruction = isDefaultGameSysInstr ? '' : instruction.trim()

  if (!ctx.generateText) {
    const localText = normalizeLocalScreenplayText(node.params.text)
    const hasRichUpstreamOrArchetype =
      Boolean(explicitArchetypeId) ||
      Boolean(directUpstreamEconomyNode) ||
      Boolean(directUpstreamNovelNode) ||
      incomingText.includes('【上游经济系统（game.economy）➔ 游戏系统策划案') || // cjk-ok
      incomingText.includes('【上游小说 IP（asset.novel）➔ 游戏系统策划案') // cjk-ok
    if (hasRichUpstreamOrArchetype) {
      const inferredArch =
        explicitArchetypeId ??
        inferGameSystemArchetypeFromContext({
          prompt: customInstruction || incomingText,
          novelGenre: upstreamNovelMeta?.novelGenreId,
          economyPreset: upstreamEconomyDoc?.templateId,
          workbenchPreset: upstreamEconomyDoc?.workbench?.activePresetId
        })
      const offlineDoc = synthesizeGameSystemDocOffline({
        archetypeId: inferredArch,
        customInstruction,
        incomingText,
        wb: upstreamEconomyDoc?.workbench,
        targetAspect
      })
      return await persistScreenplayGeneration(ctx, offlineDoc)
    }
    const text = customInstruction || incomingText || localText || instruction.trim()
    if (!text.trim()) return dualTextGalleryOutputs([], '')
    return await persistScreenplayGeneration(ctx, text)
  }

  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  const localDraft = normalizeLocalScreenplayText(node.params.text)
  // 底稿并入：指令为空且 text 非空时，以底稿为基础扩写。若 text 就是上次生成产物
  // （rerun 场景），不并入，保持「重新生成」语义、避免输出反复自喂漂移。
  const draftIsPreviousOutput = isDraftFromPreviousGeneration(
    localDraft,
    node.params.generatedTexts
  )
  // 若 Agent/用户已直接把完整 Markdown 策划案写入 params.text（非上次生成缓存且具备多级标题与正文的成稿），
  // 直接持久化落盘到 Cache/Texts 并返回，避免无意义地再跑一次 5 分钟的 LLM 重生覆盖掉已写好的 GDD。
  if (
    localDraft &&
    !draftIsPreviousOutput &&
    localDraft.length >= 600 &&
    /^#{1,3}\s+\S/m.test(localDraft)
  ) {
    return await persistScreenplayGeneration(ctx, localDraft)
  }
  let userPrompt: string
  if (customInstruction) {
    userPrompt = customInstruction
  } else if (localDraft && !draftIsPreviousOutput) {
    const lead =
      ctx.locale === 'en'
        ? 'Below is an existing human-readable draft of the game system design document. Expand and complete it into a deliverable version, preserving its structure and decisions:'
        : '以下是已有人类可读的策划案底稿，请在其结构与既有决策的基础上扩写、补全为完整交付版（不要推翻底稿结论）：' // cjk-ok
    userPrompt = `${defaultGameSystemUserPrompt(ctx.locale)}\n\n${lead}\n\n${localDraft}`
  } else {
    userPrompt = defaultGameSystemUserPrompt(ctx.locale)
  }

  const activeArchetypeId =
    explicitArchetypeId ??
    inferGameSystemArchetypeFromContext({
      prompt: customInstruction || incomingText,
      novelGenre: upstreamNovelMeta?.novelGenreId,
      economyPreset: upstreamEconomyDoc?.templateId,
      workbenchPreset: upstreamEconomyDoc?.workbench?.activePresetId
    })
  const arch = resolveGameSystemArchetype(activeArchetypeId)
  const hasCombatOrUpstreamModel =
    Boolean(explicitArchetypeId && explicitArchetypeId !== 'universal_full_ui') ||
    Boolean(directUpstreamEconomyNode) ||
    Boolean(directUpstreamNovelNode) ||
    arch.id !== 'universal_full_ui'
  const archetypeDirective =
    customInstruction && !hasCombatOrUpstreamModel
      ? [
          `【工程交付完备度约束（供下游 ui.split / ui.gen 自动拆图使用）】`, // cjk-ok
          `- 领域与模块边界：严格以用户主需求的业务/教学/仿真/产品定位及界面划分为准，严禁混入与主需求无关的战斗、境界突破、宿敌数值或概率抽卡模块。`, // cjk-ok
          `- 章节与界面拆图规范：确保包含完整系统概述、可验收目标、带 P0/P1/P2 与异常边界的功能设计、包含 ASCII 字符框线草图与 9-slice 九宫格 PSD 分层规范的 UI 布局设计（默认画幅 ${targetAspect ?? arch.defaultScreens[0]?.aspectRatio ?? '16:9'}）、交互反馈规范及业务数据配置表。` // cjk-ok
        ].join('\n')
      : [
          `【本案系统原型约束：${arch.icon} ${arch.labelZh}（${arch.id}）】`, // cjk-ok
          `- 核心玩法/交互闭环：${arch.coreLoopZh}`, // cjk-ok
          `- 核心体验目标：${arch.playerGoalZh}`, // cjk-ok
          `- 必备功能模块：${arch.defaultFeatures.map((f) => `${f.code || f.id}《${f.nameZh}》(${f.priority})`).join('、')}`, // cjk-ok
          `- 必备 UI 界面清单（供下游 ui.split 拆分）：${arch.defaultScreens.map((s) => `《${s.titleZh}》(${s.screenKind}/${targetAspect ?? s.aspectRatio})`).join('、')}` // cjk-ok
        ].join('\n')

  let prompt = incomingText ? `${userPrompt.trim()}\n\n${incomingText}` : userPrompt
  if (archetypeDirective) {
    prompt = `${prompt.trim()}\n\n${archetypeDirective}`
  }
  const system = resolveGameSystemSystemPrompt(node.params.generateSystemPrompt, ctx.locale)

  const result = await ctx.generateText({
    prompt,
    system,
    model: node.params.generateModel || undefined,
    providerInstanceId: node.params.generateProviderInstanceId || undefined
  })
  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }
  const text = result.text.trim()
  if (!text)
    throw fail(SHARED_ERRORS.resultMissing, {
      what: { zh: '游戏系统策划案', en: 'game system design document' }
    }) // cjk-ok 双语错误数据（zh/en，由 errors/catalog 统一格式化）

  return await persistScreenplayGeneration(ctx, text)
}

async function collectImageUrlsForPrompt(
  ctx: NodeExecuteContext,
  instructionRaw: string
): Promise<string[]> {
  const selected = selectIncomingValuesForInstruction(ctx, instructionRaw)
  const items = flattenImagesValues(selected).filter(
    (item) =>
      (typeof item.dataUrl === 'string' && item.dataUrl.length > 0) ||
      (typeof item.relativePath === 'string' && item.relativePath.length > 0)
  )
  const urls: string[] = []
  if (items.length && ctx.resolveImageUrls) {
    urls.push(...(await ctx.resolveImageUrls(items)))
  } else {
    for (const item of items) {
      const dataUrl = item.dataUrl?.trim()
      if (dataUrl) urls.push(dataUrl)
    }
  }
  if (ctx.resolveAssetImageUrl) {
    for (const asset of flattenAssetValues(selected)) {
      if (asset.assetType !== 'image') continue
      const url = await ctx.resolveAssetImageUrl(asset.assetId)
      if (url) urls.push(url)
    }
  }
  // 去重，最多传 4 张以免请求过大
  return [...new Set(urls.filter(Boolean))].slice(0, 4)
}

/**
 * 图片反推提示词：展开指令后调用视觉文本模型。
 * 未注入 generateText 时退回本地文本 / 上游资产说明。
 */
export async function executeImageToPromptNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const { node } = ctx
  const mentionSources = resolveMentionSources(ctx).map((s) => ({
    ...s,
    text: unwrapEconomyBundleForNarrative(s.text)
  }))
  const instructionRaw = node.params.generateInstruction?.trim() ?? ''
  const instruction = expandInstructionMentions(instructionRaw, mentionSources)
  const selected = selectIncomingValuesForInstruction(ctx, instructionRaw)
  const incomingTextRaw = autoIncomingTextForInstruction(instructionRaw, selected, mentionSources)
  const incomingText = incomingTextRaw
    .split('\n\n')
    .map((chunk) => unwrapEconomyBundleForNarrative(chunk))
    .join('\n\n')
  const localText = node.params.text?.trim() ?? ''
  const hints = flattenAssetValues(selected)
    .map((asset) => [asset.title, asset.label, asset.notes].filter(Boolean).join(' · '))
    .filter(Boolean)
    .join('\n')

  if (!ctx.generateText) {
    const text = instruction.trim() || incomingText || localText || hints
    if (text && text !== localText) {
      node.params = { ...node.params, text }
      ctx.patchNode?.({ params: { text } })
    }
    if (!text) return { out: { kind: 'text', text: '' } }
    return commitInMemoryTextGallery(ctx, text)
  }

  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  const images = await collectImageUrlsForPrompt(ctx, instructionRaw)
  if (!images.length) {
    // 反推必须有图；有指令但无图时仍提示需要图片输入（非「未连接」泛化）
    throw new Error('GRAPH_PROCESS_NO_INPUT')
  }

  let prompt = buildToPromptUserPrompt(instruction, ctx.locale)
  if (incomingText) {
    prompt = `${prompt.trim()}\n\n${incomingText}`
  }
  const result = await ctx.generateText({
    prompt,
    system: resolveToPromptSystemPrompt(node.params.generateSystemPrompt, ctx.locale),
    model: node.params.generateModel || undefined,
    providerInstanceId: node.params.generateProviderInstanceId || undefined,
    images
  })
  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }
  const text = result.text.trim()
  if (!text) throw fail(SHARED_ERRORS.resultMissing, { what: { zh: '提示词', en: 'prompt' } }) // cjk-ok 双语错误数据（zh/en，由 errors/catalog 统一格式化）

  return persistScreenplayGeneration(ctx, text)
}
