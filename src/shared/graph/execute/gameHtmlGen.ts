/**
 * `game.htmlGen`：一句话 → 可玩 HTML（2d Canvas / 3d Three）→ 校验落盘参数 → out / out-all。
 * 无 generateText 时退回内置样例（seed），保证沙盒可测通。
 */
import {
  buildGameHtmlUserPrompt,
  prepareGameHtml,
  resolveGameHtmlSystemPrompt,
  resolvePreferredGamePlayMode,
  seedGameHtml
} from '../../gamePlay'
import { formatGeneratedMediaStamp } from '../../domain'
import { expandInstructionMentions } from '../instructionMentions'
import { resolveMentionSources } from './context'
import { autoIncomingTextForInstruction, selectIncomingValuesForInstruction } from './incoming'
import { collectIncomingImageItems } from './mediaInputs'
import { dualTextGalleryOutputs, newestTextSelectedId } from './gallery'
import { mergeGeneratedTexts } from './materialize'
import type { GraphValue, NodeExecuteContext } from './types'
import { fail } from '../../errors/appError'
import { SHARED_ERRORS } from '../../errors/catalog'

/** 参考图上限，避免单次请求塞过多图 */
const GAME_HTML_REFERENCE_MAX = 4

async function resolveGameHtmlReferenceUrls(ctx: NodeExecuteContext): Promise<string[]> {
  const items = await collectIncomingImageItems(ctx)
  if (!items.length) return []
  const urls = ctx.resolveImageUrls
    ? await ctx.resolveImageUrls(items)
    : items.map((item) => item.dataUrl?.trim() ?? '')
  return urls
    .map((url) => url.trim())
    .filter(Boolean)
    .slice(0, GAME_HTML_REFERENCE_MAX)
}

function buildReferenceHint(count: number, locale?: string): string {
  if (count <= 0) return ''
  const en = (locale ?? '').toLowerCase().startsWith('en')
  return en
    ? `Use the ${count} attached reference image(s) for art style / characters / layout hints. Do not embed external image URLs; redraw with canvas/three primitives.`
    : `已附带 ${count} 张参考图：请参考其画风 / 角色 / 布局；不要外链图片 URL，用 canvas / three 几何重绘。`
}

async function persistGameHtml(
  ctx: NodeExecuteContext,
  html: string,
  mode: '2d' | '3d'
): Promise<Record<string, GraphValue>> {
  const { node } = ctx
  const createdAt = new Date().toISOString()
  const stamp = formatGeneratedMediaStamp()
  const id = `gen-html:${stamp}`
  let relativePath = ''
  if (ctx.saveRunText) {
    try {
      relativePath = await ctx.saveRunText({
        content: html,
        key: `${(node.title || 'game').replace(/[^\w\u4e00-\u9fff-]+/g, '_').slice(0, 40) || 'game'}_play`,
        outputDir: node.params.mediaOutputDir?.trim() || undefined,
        node
      })
    } catch (err) {
      console.warn('[graph] save game html failed', err)
    }
  }
  // 可玩 HTML 需在 out 口保留全文，供下游 asset.gamePlay / Dive 直接消费（同时落盘 relativePath）
  const generatedTexts = mergeGeneratedTexts(
    ctx,
    [
      {
        id,
        text: html,
        createdAt,
        ...(relativePath ? { relativePath } : {})
      }
    ],
    `${stamp}:keep`
  ).map((item) => ({
    id: item.id?.trim() || id,
    text: item.text || html,
    createdAt: item.createdAt ?? createdAt,
    ...(item.relativePath ? { relativePath: item.relativePath } : {})
  }))
  const selectedTextId = newestTextSelectedId(generatedTexts)
  const params = {
    gamePlayHtml: html,
    gamePlayMode: mode,
    ...(relativePath ? { gamePlayHtmlPath: relativePath } : {}),
    text: html,
    generatedTexts,
    selectedTextId
  }
  ctx.node.params = { ...ctx.node.params, ...params }
  ctx.patchNode?.({ params })
  return dualTextGalleryOutputs(generatedTexts, selectedTextId)
}

export async function executeGameHtmlGenNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const { node } = ctx
  const preferred = resolvePreferredGamePlayMode(node.params.gamePlayMode)
  const mentionSources = resolveMentionSources(ctx)
  const instructionRaw = node.params.generateInstruction?.trim() ?? ''
  const instruction = expandInstructionMentions(instructionRaw, mentionSources)
  const selected = selectIncomingValuesForInstruction(ctx, instructionRaw)
  const incomingText = autoIncomingTextForInstruction(instructionRaw, selected, mentionSources)
  const brief = [instruction, incomingText]
    .map((s) => s.trim())
    .filter(Boolean)
    .join('\n\n')

  // 离线 / 测试：无模型时优先吃指令里已有 HTML，否则 seed 样例
  if (!ctx.generateText) {
    if (brief && /<html[\s>]|```html/i.test(brief)) {
      const prepared = prepareGameHtml(brief, preferred)
      return persistGameHtml(ctx, prepared.html, prepared.mode)
    }
    const seeded = seedGameHtml(preferred)
    return persistGameHtml(ctx, seeded.html, seeded.mode)
  }

  if (!brief.trim()) {
    throw fail(SHARED_ERRORS.resultMissing, {
      what: { zh: '游戏一句话需求', en: 'one-sentence game brief' }
    })
  }

  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  const referenceUrls = await resolveGameHtmlReferenceUrls(ctx)
  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  const prompt = [
    buildGameHtmlUserPrompt(brief, preferred, ctx.locale),
    buildReferenceHint(referenceUrls.length, ctx.locale)
  ]
    .map((part) => part.trim())
    .filter(Boolean)
    .join('\n\n')

  const result = await ctx.generateText({
    prompt,
    system: resolveGameHtmlSystemPrompt(preferred, node.params.generateSystemPrompt, ctx.locale),
    model: node.params.generateModel || undefined,
    providerInstanceId: node.params.generateProviderInstanceId || undefined,
    ...(referenceUrls.length ? { images: referenceUrls } : {})
  })
  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  const prepared = prepareGameHtml(result.text ?? '', preferred)
  return persistGameHtml(ctx, prepared.html, prepared.mode)
}
