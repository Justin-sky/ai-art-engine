import { isAssetRefNode } from '../nodeRole'
import { expandInstructionMentions } from '../instructionMentions'
import {
  resolveGameSystemSystemPrompt,
  resolveNovelSystemPrompt,
  resolveScreenplaySystemPrompt,
  resolveToPromptSystemPrompt
} from '../systemPromptSchemes'
import {
  buildNovelPrompt,
  buildScreenplayPrompt,
  defaultGameSystemUserPrompt,
  defaultNovelUserPrompt,
  buildToPromptUserPrompt
} from '../userPromptSchemes'
import { resolveAssetTextFromGenParams } from '../assetText'
import {
  buildNovelForeshadowingAndRosterPromptBlock,
  buildNovelGenreDirectiveBlock,
  createDefaultNovelCharacterRoster,
  createDefaultNovelForeshadowingPool,
  createMxWorkbenchPreset,
  extractNovelIpContextForGameSystem,
  inferGameSystemArchetypeFromContext,
  inferNovelGenreFromText,
  isGameSystemArchetypeId,
  resolveGameSystemArchetype,
  resolveNovelGenreProfile,
  synthesizeGameSystemDocOffline,
  synthesizeGenreNovelChapterOffline,
  unwrapEconomyBundleForGameSystem,
  unwrapEconomyBundleForNarrative,
  type MxNovelCharacterStatusEntry,
  type MxNovelForeshadowingEntry,
  type NovelGenreProfile
} from '../../gameAssets'
import type { GraphValue, NodeExecuteContext } from './types'
import { dualTextGalleryOutputs, flattenAssetValues, flattenImagesValues } from './gallery'
import { autoIncomingTextForInstruction, selectIncomingValuesForInstruction } from './incoming'
import { commitInMemoryTextGallery, persistScreenplayGeneration } from './materialize'
import { normalizeLocalScreenplayText, resolveMentionSources } from './context'
import { fail } from '@shared/errors/appError'
import { SHARED_ERRORS } from '../../errors/catalog'

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

  const sysTitleMatch = /\*\*体系名称\*\*:\s*([^\n]+)/.exec(raw) // cjk-ok
  const seqMatch = /\*\*高潮单回合最优连招序列\*\*:\s*`([^`]+)`/.exec(raw) // cjk-ok
  const peakMatch = /\*\*高潮结局目标战力峰值\*\*:\s*`([^`]+)`/.exec(raw) // cjk-ok
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

  const sysTitle = sysTitleMatch?.[1]?.trim() || '逆袭爽剧角色成长体系' // cjk-ok
  const optimalSeq =
    seqMatch?.[1]?.trim() ||
    '系统百倍觉醒 (高潮卡点) ➔ 首富到场·下跪接驾 ➔ 甩出铁证·舆论崩塌 ➔ 真身揭晓·全员震怖 (终结)' // cjk-ok
  const peakPower = peakMatch?.[1]?.trim() || '74'

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
    `（第 ${curChap}/${totalChaps} 章 · ${curRealm} · 战力上限 ${curCeiling}）` // cjk-ok

  return [
    `小说名：《潜龙出渊：从退婚受辱到万界俯首》`, // cjk-ok
    ``,
    `【核心设定与人物档案】`, // cjk-ok
    `- 驱动数值体系：${sysTitle}（全书动态总章数：${totalChaps} 章 · 当前连载进度：第 ${curChap}/${totalChaps} 章 · 终局战力峰值：${peakPower}）`, // cjk-ok
    `- 所属篇章与境界围栏：${volumeLabel} · 当前境界【${curRealm}】· 本章战力天花板 ${curCeiling} vs 反派压迫阈值 ${villainPress}`, // cjk-ok
    `- 本章准入底牌：${allowedTrumps}（封存禁动底牌：${lockedTrumps}）`, // cjk-ok
    `- 林玄（男主）：24岁，表面是刚被家族边缘化的寒门赘婿，实则执掌黑金龙卡与百倍觉醒系统，隐忍果决，出手必见雷霆。`, // cjk-ok
    `- 苏清雪（前未婚妻/初级反派）：23岁，江城苏家千金，高傲势利，屡次伙同豪门大少打压林玄。`, // cjk-ok
    `- 赵天豪（江城首富/关键人脉）：50岁，威震江城的百亿巨擘，受林玄救命与神医针法大恩，唯林玄马首是瞻。`, // cjk-ok
    ``,
    `第${curChap}章：${chapTitle}`, // cjk-ok
    `【第一拍 · 悬念承接与压迫起势】`, // cjk-ok
    `${prevHook}璀璨的水晶吊灯将江城云顶宴会厅照得如同白昼，冷冽的香槟气泡在杯壁上不断炸裂。满堂宾客交头接耳，目光像淬了冰的针尖一样汇聚在角落里的林玄身上。苏清雪高昂着下巴，将一纸加盖了苏氏集团法务鲜红印章的协议狠狠甩在林玄面前的桌面，纸张哗啦散落一地。按照本章戏剧节拍（${beatDesc}），林玄并未急于暴露那些仍处于封存状态的终局底牌（${lockedTrumps}），而是平静地垂下眼帘，任由胸臆间的受辱蓄能池悄然攀升至临界值。他能清晰感知到体内【${curRealm}】的气场底蕴正在暗流下剧烈翻涌，距离本章战力发挥上限（${curCeiling}）只差一个引爆契机。`, // cjk-ok
    ``,
    `【第二拍 · 冲突加码与筹码拉扯】`, // cjk-ok
    `“林玄，睁大你的眼睛看清楚，如今站在你面前的是省城豪门联席代表，压迫门槛高达 ${villainPress}！”苏清雪身旁的豪门大少冷笑着拍出三份资产冻结令，试图在气势与资金链上将林玄彻底锁死在尘埃里。四周权贵纷纷附和嘲弄，有人幸灾乐祸地举起酒杯，等待看他跪地求饶的狼狈模样。林玄缓缓弯腰，修长的手指拈起那页协议的一角，指节因暗劲凝聚而泛起微不可察的玉泽。他抬眸直视对方，声音不大，却字字如刀：“你们以为握住几条商业渠道就能定人生死？三分钟之内，你们引以为傲的靠山，连站着跟我说话的资格都没有。”`, // cjk-ok
    ``,
    `【第三拍 · 准入底牌破局与奇遇共振】`, // cjk-ok
    `话音落下的刹那，林玄怀中的${encounterItem}骤然发烫，脑海中轰然炸响清脆的提示音——本章准入底牌（${allowedTrumps}）正式激活！宴会厅厚重的雕花大门被人从外轰然推开，两排黑衣保镖疾步分列两侧，原本被苏家苦苦巴结的江城首富赵天豪快步入场。在全场权贵呆滞的目光中，赵天豪越过满脸堆笑迎上来的苏家众人，径直走到林玄面前九十度躬身行礼：“赵某救驾来迟，恭迎尊上！您交代的百亿反收购铁证与审计底稿已全部送达！”林玄顺势踏着最优交锋序列（${optimalSeq}）中的本阶段准入杀招，将一叠铁证重重拍在主桌上，战力气场瞬间拉满至本章上限 ${curCeiling}，当场击穿反派 ${villainPress} 的防线！`, // cjk-ok
    ``,
    `【第四拍 · 全场震怖与章末断章强钩子】`, // cjk-ok
    `铁证展开的瞬间，大屏幕上同步跳出苏氏集团资金链全线崩盘的红色预警。苏清雪脸上的高傲寸寸碎裂，面如死灰地跌坐在红毯之上，满堂权贵鸦雀无声，冷汗浸透后背。然而林玄连多看她一眼的兴致都没有，他正欲转身离席，口袋里的加密卫星电话却突然震动起来——屏幕跳出一串来自更高层禁区的猩红编码，电话那头传来一道沙哑而急促的声音：“尊上，省域背后的隐世大族已经察觉到${encounterItem}的异动，三名护法长老正连夜封锁出城高速，目标直指您的软肋……”林玄眸光骤然一寒，望向窗外风雨欲来的夜空（目标字数规格：${targetWords}+ 字，静待第 ${Math.min(totalChaps, curChap + 1)} 章继续连载推进）。` // cjk-ok
  ].join('\n')
}

function synthesizeScreenplayFromNovelOffline(novelText: string): string {
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
  return [
    `剧本名：${title}`, // cjk-ok
    ``,
    `【人物小传】`, // cjk-ok
    `林玄：24岁，男，表面寒素却眼神冷冽如渊，身着剪裁利落的深色风衣，手握黑金龙卡，隐忍果决。`, // cjk-ok
    `苏清雪：23岁，女，妆容精致高傲，身穿定制白色晚礼服，势利虚荣。`, // cjk-ok
    `赵天豪：50岁，男，江城首富，唐装金丝眼镜，气场威严却对林玄恭敬如神。`, // cjk-ok
    ``,
    `第${chapNum}集：${chapTitle}`, // cjk-ok
    `第1场 【内景 · 江城大酒店宴会厅 - 夜】`, // cjk-ok
    `△ 璀璨水晶灯下宾客云集。苏清雪高昂着头，将退婚协议狠狠甩在林玄胸口，纸张散落一地。`, // cjk-ok
    `苏清雪：林玄，认清你自己的身份！从今天起，你配不上我苏家！`, // cjk-ok
    `△ 林玄眼底金芒一闪（境界突破异象），缓步弯腰拾起纸页，嘴角勾起一抹冷冽弧度。`, // cjk-ok
    `林玄：这婚书，是我休你。三分钟后，你会跪着求我回头。`, // cjk-ok
    ``,
    `第${Number(chapNum) + 1}集：首富接驾·底牌连环亮出`, // cjk-ok
    `第1场 【内景 · 江城大酒店宴会厅大门 - 夜】`, // cjk-ok
    `△ 宴会厅大门轰然推开，两排黑衣保镖分列两侧，江城首富赵天豪快步入场。`, // cjk-ok
    `△ 苏清雪满脸堆笑迎上前，赵天豪却看都不看她一眼，径直走到林玄面前九十度躬身行礼！`, // cjk-ok
    `赵天豪：赵某救驾来迟，恭迎龙王尊上！百亿黑金卡与收购铁证已全部备妥！`, // cjk-ok
    `△ 林玄随手亮出至尊黑卡扔在主桌上，清脆金属声响彻死寂的大厅，苏清雪面如死灰瘫软在地。` // cjk-ok
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

/**
 * 剧本生成节点：调用大模型生成剧本，落盘到输出路径并追加 generatedTexts。
 * 未注入 generateText 时退回纯文本汇总（测试/无 API 环境），仍会落盘（若已注入 saveRunText）。
 */
export async function executeScreenplayGenerateNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
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
    const adaptedFromNovel = synthesizeScreenplayFromNovelOffline(incomingText || instruction)
    const text = adaptedFromNovel || instruction.trim() || incomingText || localText
    if (!text.trim()) return dualTextGalleryOutputs([], '')
    return await persistScreenplayGeneration(ctx, text)
  }

  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  const localDraft = normalizeLocalScreenplayText(node.params.text)
  const draftIsPreviousOutput = (node.params.generatedTexts ?? []).some(
    (item) => (item.text ?? '').trim() === localDraft
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

  const result = await ctx.generateText({
    prompt,
    system: resolveScreenplaySystemPrompt(node.params.generateSystemPrompt, ctx.locale),
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
  if (opts.characterRosterJson?.trim() || opts.foreshadowingJson?.trim()) {
    let roster: MxNovelCharacterStatusEntry[] = []
    let foreshadowings: MxNovelForeshadowingEntry[] = []
    try {
      if (opts.characterRosterJson?.trim()) {
        roster = JSON.parse(opts.characterRosterJson) as MxNovelCharacterStatusEntry[]
      }
    } catch {
      roster = []
    }
    try {
      if (opts.foreshadowingJson?.trim()) {
        foreshadowings = JSON.parse(opts.foreshadowingJson) as MxNovelForeshadowingEntry[]
      }
    } catch {
      foreshadowings = []
    }
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

async function finalizeNovelChapterMemoryAndPersist(
  ctx: NodeExecuteContext,
  text: string,
  meta: {
    currentChapter: number
    totalChapters: number
    targetWords: number
    autoAdvance: boolean
    incomingBrief: string
    genre?: NovelGenreProfile
  }
): Promise<Record<string, GraphValue>> {
  const { node } = ctx
  const { currentChapter, totalChapters, targetWords, autoAdvance, incomingBrief, genre } = meta

  const chapTitleMatch =
    new RegExp(`第\\s*${currentChapter}\\s*章[:：]\\s*([^\\n]+)`).exec(text) || // cjk-ok
    /第\s*\d+\s*章[:：]\s*([^\n]+)/.exec(text) // cjk-ok
  const extractedChapTitle =
    chapTitleMatch?.[1]?.trim() || `第 ${currentChapter}/${totalChapters} 章` // cjk-ok
  const galleryItemTitle = `第${currentChapter}/${totalChapters}章：${extractedChapTitle.replace(/^第\s*\d+\s*章[:：]\s*/, '')}` // cjk-ok

  const cleanedLines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  const tailAnchor = cleanedLines.slice(-4).join('\n').slice(-580)
  const wordCount = text.replace(/\s+/g, '').length

  // 提取本章关键信息以自动演进 L1/L2/L3/L4 记忆
  const realmMatch = /主角当前[^*]*\*\*([^*]+)\*\*/.exec(incomingBrief) // cjk-ok
  const ceilingMatch = /\*\*本章[^`]*上限\s*`([^`]+)`\*\*/.exec(incomingBrief) // cjk-ok
  const allowedMatch = /\*\*✅ 本章准入可用[^*]*\*\*:\s*([^\n]+)/.exec(incomingBrief) // cjk-ok
  const lockedMatch = /\*\*🔒 封存禁用的后期终局[^*]*\*\*:\s*([^\n]+)/.exec(incomingBrief) // cjk-ok
  const sysTitleMatch = /\*\*体系名称\*\*:\s*([^\n]+)/.exec(incomingBrief) // cjk-ok

  let nextWorldBible = node.params.novelWorldBible?.trim() ?? ''
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
  const lastSentenceHook = cleanedLines[cleanedLines.length - 1]?.slice(-110) || '章末危机悬念待解' // cjk-ok

  const nextStateLedger = [
    `- 最新结算章节：已完成第 ${currentChapter} / ${totalChapters} 章《${extractedChapTitle}》（本章正文字数：${wordCount} 字）`, // cjk-ok
    `- 主角当前${stageTerm}：${curRealm}（当前${axisTerm}：${curCeiling}）`, // cjk-ok
    `- 当前已解锁${unlockTerm}：${curAllowed}`, // cjk-ok
    `- 仍处于封存禁用的终局${unlockTerm}：${curLocked}`, // cjk-ok
    `- 待下一章（第 ${Math.min(totalChapters, currentChapter + 1)} 章）承接的章末悬念钩子：${lastSentenceHook}` // cjk-ok
  ].join('\n')

  const oneLineSummary = `第${currentChapter}章《${extractedChapTitle}》(${curRealm}/上限${curCeiling})：${lastSentenceHook}` // cjk-ok
  const existingSummaryLines = (node.params.novelRollingSummary ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith(`- 第${currentChapter}章《`)) // cjk-ok
  existingSummaryLines.push(`- ${oneLineSummary}`)
  // 保持最近 20 章滚动摘要，防止 800 章连载时上下文膨胀
  const boundedSummaryLines = existingSummaryLines.slice(-20)
  const nextRollingSummary = boundedSummaryLines.join('\n')

  const historyMap = parseNovelChapterHistory(node.params.novelChapterHistoryJson)
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

  // 同章号重写原地覆盖 + 按章号升序归档（避免重写第 K 章时出现重复的「第 K 章」条目）
  const rawGallery = [...(node.params.generatedTexts ?? [])]
  const newestItem = rawGallery[rawGallery.length - 1]
  const parseChapNo = (title: string | undefined, fallbackIdx: number): number => {
    if (!title) return fallbackIdx + 1
    const m = /第\s*(\d+)\s*(?:\/\s*\d+\s*)?章/.exec(title) || /Chapter\s*(\d+)/i.exec(title) // cjk-ok
    return m && m[1] ? Number(m[1]) : fallbackIdx + 1
  }
  let dedupedGallery = rawGallery
  if (newestItem && rawGallery.length > 1) {
    const earlierSameChapIdx = rawGallery
      .slice(0, -1)
      .findIndex((item, idx) => parseChapNo(item.title, idx) === currentChapter)
    if (earlierSameChapIdx >= 0) {
      const prevId = rawGallery[earlierSameChapIdx]!.id || newestItem.id
      const replaced = {
        ...newestItem,
        id: prevId
      }
      dedupedGallery = rawGallery.slice(0, -1)
      dedupedGallery[earlierSameChapIdx] = replaced
    }
  }
  dedupedGallery.sort((a, b) => parseChapNo(a.title, 9999) - parseChapNo(b.title, 9999))
  const targetSelectedId =
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
    novelCharacterRosterJson: (() => {
      const existing = node.params.novelCharacterRosterJson?.trim()
      if (existing) {
        try {
          const parsed = JSON.parse(existing) as MxNovelCharacterStatusEntry[]
          if (Array.isArray(parsed) && parsed.length > 0) {
            return JSON.stringify(
              parsed.map((c) =>
                c.faction === 'protagonist'
                  ? {
                      ...c,
                      realmOrRole: `${curRealm} (上限 ${curCeiling})`, // cjk-ok
                      updatedAtChapter: currentChapter
                    }
                  : c
              )
            )
          }
        } catch {
          // fallback to default seed
        }
      }
      return JSON.stringify(
        createDefaultNovelCharacterRoster(
          createMxWorkbenchPreset('short_drama_progression'),
          totalChapters,
          genre
        )
      )
    })(),
    novelForeshadowingJson: (() => {
      const existing = node.params.novelForeshadowingJson?.trim()
      if (existing) return existing
      return JSON.stringify(
        createDefaultNovelForeshadowingPool(
          createMxWorkbenchPreset('short_drama_progression'),
          totalChapters,
          genre
        )
      )
    })()
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
      generatedTexts: dedupedGallery,
      selectedTextId: targetSelectedId,
      ...memoryPatch
    }
  })

  return dualTextGalleryOutputs(dedupedGallery, targetSelectedId)
}

/**
 * 创建小说节点（`asset.novel`）：
 * 支持动态总章数（如 60 / 80 / 800 / 2000 章，随时可调）与每章 3000+ 字的「逐章连载生成」：
 * - 自动将上游 `game.economy` 数值体系按 `(currentChapter, totalChapters)` 解算为【单章数值围栏与底牌配额锁】；
 * - 自动注入【L1 世界观宪法 + L2 动态状态账本 + L3 滚动前情摘要 + L4 上一章末尾原文锚点】四层记忆；
 * - 生成完第 N 章后自动提取章末钩子与状态更新账本，并将游标推进至第 N+1 章，同时把完整章节沉淀到 `generatedTexts` 供下游 `asset.screenplay` 改编剧本。
 */
export async function executeNovelGenerateNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const { node } = ctx
  if (isAssetRefNode(node)) {
    return executeTextAssetRefNode(ctx)
  }

  const totalChapters = Math.max(
    1,
    Math.min(5000, Math.round(Number(node.params.novelTotalChapters) || 800))
  )
  const currentChapter = Math.max(
    1,
    Math.min(totalChapters, Math.round(Number(node.params.novelCurrentChapter) || 1))
  )
  const targetWords = Math.max(
    1000,
    Math.min(15000, Math.round(Number(node.params.novelTargetWords) || 3200))
  )
  const autoAdvance = node.params.novelAutoAdvanceChapter !== false

  const explicitOrInferredGenreId =
    node.params.novelGenre?.trim() ||
    inferNovelGenreFromText(
      `${node.params.generateInstruction ?? ''} ${node.params.novelWorldBible ?? ''}`
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
      unlockTerm: node.params.novelCustomUnlockTerm
    }
  )

  const unwrapOpts = {
    currentChapter,
    totalChapters,
    targetWordsPerChapter: targetWords,
    genre: activeGenre
  }

  const mentionSources = resolveMentionSources(ctx).map((s) => ({
    ...s,
    text: unwrapEconomyBundleForNarrative(s.text, unwrapOpts)
  }))
  const instructionRaw = node.params.generateInstruction?.trim() ?? ''
  const instruction = expandInstructionMentions(instructionRaw, mentionSources)
  const selected = selectIncomingValuesForInstruction(ctx, instructionRaw)
  const incomingTextRaw = autoIncomingTextForInstruction(instructionRaw, selected, mentionSources)
  const incomingText = incomingTextRaw
    .split('\n\n')
    .map((chunk) => unwrapEconomyBundleForNarrative(chunk, unwrapOpts))
    .join('\n\n')

  const historyMap = parseNovelChapterHistory(node.params.novelChapterHistoryJson)
  const prevChapterEntry = currentChapter > 1 ? historyMap[String(currentChapter - 1)] : undefined
  const fallbackPrevTail =
    currentChapter > 1 && !prevChapterEntry?.tailAnchor
      ? (node.params.text ?? '').trim().slice(-500)
      : ''
  const prevTailAnchor = prevChapterEntry?.tailAnchor || fallbackPrevTail

  const memoryBlock = buildNovelChapterMemoryBlock({
    currentChapter,
    totalChapters,
    targetWords,
    worldBible: node.params.novelWorldBible,
    stateLedger: node.params.novelStateLedger,
    rollingSummary: node.params.novelRollingSummary,
    prevTailAnchor,
    characterRosterJson: node.params.novelCharacterRosterJson,
    foreshadowingJson: node.params.novelForeshadowingJson,
    locale: ctx.locale,
    genre: activeGenre
  })

  if (!ctx.generateText) {
    const localText = normalizeLocalScreenplayText(node.params.text)
    const offlineNovel = synthesizeNovelFromProgressionBriefOffline(
      incomingText || instruction,
      instruction,
      {
        currentChapter,
        totalChapters,
        targetWords,
        worldBible: node.params.novelWorldBible,
        stateLedger: node.params.novelStateLedger,
        rollingSummary: node.params.novelRollingSummary,
        prevTailAnchor,
        genre: activeGenre
      }
    )
    const text = offlineNovel || instruction.trim() || incomingText || localText
    if (!text.trim()) return dualTextGalleryOutputs([], '')
    return await finalizeNovelChapterMemoryAndPersist(ctx, text, {
      currentChapter,
      totalChapters,
      targetWords,
      autoAdvance,
      incomingBrief: incomingText || instruction,
      genre: activeGenre
    })
  }

  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  const localDraft = normalizeLocalScreenplayText(node.params.text)
  const draftIsPreviousOutput = (node.params.generatedTexts ?? []).some(
    (item) => (item.text ?? '').trim() === localDraft
  )

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
  const text = result.text.trim()
  if (!text) throw fail(SHARED_ERRORS.resultMissing, { what: { zh: '小说文本', en: 'novel text' } }) // cjk-ok 双语错误数据（zh/en，由 errors/catalog 统一格式化）

  return await finalizeNovelChapterMemoryAndPersist(ctx, text, {
    currentChapter,
    totalChapters,
    targetWords,
    autoAdvance,
    incomingBrief: incomingText || instruction,
    genre: activeGenre
  })
}

function unwrapIncomingChunkForGameSystem(rawChunk: string): string {
  const trimmed = (rawChunk ?? '').trim()
  if (!trimmed) return ''
  // 1. 优先识别并解包上游 game.economy 数值工作台与 Machinations 载荷
  const unwrappedEcon = unwrapEconomyBundleForGameSystem(trimmed)
  if (unwrappedEcon !== trimmed) {
    return unwrappedEcon
  }
  // 2. 识别上游 asset.novel 小说正文/大纲并提取 IP 角色卡池、境界阶梯、神兵道具与章节关卡表
  const looksLikeNovel =
    !/#\s*系统概述|#\s*功能点设计/i.test(trimmed) && // cjk-ok
    (/小说名[：:]|【核心设定与人物档案】|【全书分卷与长线大纲】|第\s*\d+\s*章/.test(trimmed) || // cjk-ok
      trimmed.length >= 600)
  if (looksLikeNovel && /小说名[：:]|【核心设定|第\s*\d+\s*章/.test(trimmed)) {
    // cjk-ok
    const ipBlock = extractNovelIpContextForGameSystem({ novelText: trimmed })
    return ipBlock ? `${trimmed}\n\n${ipBlock}` : trimmed
  }
  return trimmed
}

/** 游戏系统策划案生成：打通上游经济系统（game.economy）与小说 IP（asset.novel），生成可直接喂给下游 ui.split 的系统策划案 */
export async function executeGameSystemGenerateNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const { node } = ctx
  if (isAssetRefNode(node)) {
    return executeTextAssetRefNode(ctx)
  }

  const mentionSources = resolveMentionSources(ctx).map((s) => ({
    ...s,
    text: unwrapIncomingChunkForGameSystem(s.text)
  }))
  const instructionRaw = node.params.generateInstruction?.trim() ?? ''
  const instruction = expandInstructionMentions(instructionRaw, mentionSources)
  const selected = selectIncomingValuesForInstruction(ctx, instructionRaw)
  const incomingTextRaw = autoIncomingTextForInstruction(instructionRaw, selected, mentionSources)
  const incomingText = incomingTextRaw
    .split('\n\n')
    .map((chunk) => unwrapIncomingChunkForGameSystem(chunk))
    .join('\n\n')

  const explicitArchetypeId = isGameSystemArchetypeId(node.params.gameSystemArchetype)
    ? node.params.gameSystemArchetype
    : undefined
  const targetAspect =
    node.params.gameSystemTargetAspect === '9:16' ||
    node.params.gameSystemTargetAspect === '16:9' ||
    node.params.gameSystemTargetAspect === '1:1'
      ? node.params.gameSystemTargetAspect
      : undefined

  if (!ctx.generateText) {
    const localText = normalizeLocalScreenplayText(node.params.text)
    const hasRichUpstreamOrArchetype =
      Boolean(explicitArchetypeId) ||
      incomingText.includes('【上游经济系统（game.economy）➔ 游戏系统策划案') || // cjk-ok
      incomingText.includes('【上游小说 IP（asset.novel）➔ 游戏系统策划案') // cjk-ok
    if (hasRichUpstreamOrArchetype) {
      const inferredArch =
        explicitArchetypeId ??
        inferGameSystemArchetypeFromContext({
          prompt: `${instruction} ${incomingText}`
        })
      const offlineDoc = synthesizeGameSystemDocOffline({
        archetypeId: inferredArch,
        customInstruction: instruction,
        economyText: incomingText,
        novelText: incomingText,
        targetAspect
      })
      return await persistScreenplayGeneration(ctx, offlineDoc)
    }
    const text = instruction.trim() || incomingText || localText
    if (!text.trim()) return dualTextGalleryOutputs([], '')
    return await persistScreenplayGeneration(ctx, text)
  }

  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  const localDraft = normalizeLocalScreenplayText(node.params.text)
  // 底稿并入：指令为空且 text 非空时，以底稿为基础扩写。若 text 就是上次生成产物
  // （rerun 场景），不并入，保持「重新生成」语义、避免输出反复自喂漂移。
  const draftIsPreviousOutput = (node.params.generatedTexts ?? []).some(
    (item) => (item.text ?? '').trim() === localDraft
  )
  const hasOwnInstruction = instruction.trim().length > 0
  let userPrompt: string
  if (hasOwnInstruction) {
    userPrompt = instruction
  } else if (localDraft && !draftIsPreviousOutput) {
    const lead =
      ctx.locale === 'en'
        ? 'Below is an existing human-readable draft of the game system design document. Expand and complete it into a deliverable version, preserving its structure and decisions:'
        : '以下是已有人类可读的策划案底稿，请在其结构与既有决策的基础上扩写、补全为完整交付版（不要推翻底稿结论）：' // cjk-ok
    userPrompt = `${defaultGameSystemUserPrompt(ctx.locale)}\n\n${lead}\n\n${localDraft}`
  } else {
    userPrompt = defaultGameSystemUserPrompt(ctx.locale)
  }

  let archetypeDirective = ''
  if (explicitArchetypeId) {
    const arch = resolveGameSystemArchetype(explicitArchetypeId)
    archetypeDirective = [
      `【本案系统原型约束：${arch.icon} ${arch.labelZh}（${arch.id}）】`, // cjk-ok
      `- 核心玩法闭环：${arch.coreLoopZh}`, // cjk-ok
      `- 玩家核心体验目标：${arch.playerGoalZh}`, // cjk-ok
      `- 必备功能模块：${arch.defaultFeatures.map((f) => `${f.code || f.id}《${f.nameZh}》(${f.priority})`).join('、')}`, // cjk-ok
      `- 必备 UI 界面清单（供下游 ui.split 拆分）：${arch.defaultScreens.map((s) => `《${s.titleZh}》(${s.screenKind}/${targetAspect ?? s.aspectRatio})`).join('、')}` // cjk-ok
    ].join('\n')
  }

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
