/**
 * `game.htmlGen`：一句话 → dsh 多轮生成纯 Node（esbuild）工程 → 写出 projectDir（单 HTML 由 asset.gamePlay cook）。
 * 宿主注入的 runGamePlayDshJob 在无 dsh 时会自动 seed 样例工程。
 */
import { resolvePreferredGamePlayMode } from '../../gamePlay'
import { formatGeneratedMediaStamp } from '../../domain'
import { expandInstructionMentions } from '../instructionMentions'
import { resolveMentionSources } from './context'
import { autoIncomingTextForInstruction, selectIncomingValuesForInstruction } from './incoming'
import { collectIncomingImageItems } from './mediaInputs'
import { newestTextSelectedId } from './gallery'
import { mergeGeneratedTexts } from './materialize'
import type { GraphProjectValue, GraphValue, NodeExecuteContext } from './types'
import { fail } from '../../errors/appError'
import { SHARED_ERRORS } from '../../errors/catalog'
import { gamePlayDshError } from '../../gamePlayDshJob'
import { GRAPH_OUT_ALL_PORT_ID } from '../ports'

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

async function persistProjectMeta(
  ctx: NodeExecuteContext,
  projectRelativeDir: string,
  mode: '2d' | '3d'
): Promise<Record<string, GraphValue>> {
  const createdAt = new Date().toISOString()
  const stamp = formatGeneratedMediaStamp()
  const id = `gen-html-project:${stamp}`
  const summary = `Node/esbuild project\n${projectRelativeDir}\nmode=${mode}`
  const generatedTexts = mergeGeneratedTexts(
    ctx,
    [
      {
        id,
        text: summary,
        createdAt,
        relativePath: projectRelativeDir
      }
    ],
    `${stamp}:keep`
  ).map((item) => ({
    id: item.id?.trim() || id,
    text: item.text || summary,
    createdAt: item.createdAt ?? createdAt,
    ...(item.relativePath ? { relativePath: item.relativePath } : {})
  }))
  const selectedTextId = newestTextSelectedId(generatedTexts)
  const params = {
    gamePlayProjectDir: projectRelativeDir,
    gamePlayMode: mode,
    // 单 HTML 等 cook；清空旧全文避免误预览未编译源码
    gamePlayHtml: '',
    gamePlayHtmlPath: '',
    gamePlayBuildHtmlPath: '',
    text: summary,
    generatedTexts,
    selectedTextId
  }
  ctx.node.params = { ...ctx.node.params, ...params }
  ctx.patchNode?.({ params })
  const projectOut: GraphProjectValue = {
    kind: 'project',
    relativePath: projectRelativeDir,
    text: summary,
    gameMode: mode,
    id
  }
  return { out: projectOut, [GRAPH_OUT_ALL_PORT_ID]: projectOut }
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
  const referenceNote = buildReferenceHint(referenceUrls.length, ctx.locale)

  const runner = ctx.runGamePlayDshJob
  if (!runner) {
    throw new Error(gamePlayDshError('DSH'))
  }

  const result = await runner({
    node,
    instruction: brief.trim(),
    preferredMode: preferred,
    locale: ctx.locale,
    referenceNote: referenceNote || undefined,
    model: node.params.generateModel || undefined,
    providerInstanceId: node.params.generateProviderInstanceId || undefined,
    signal: ctx.signal,
    projectRelativeDir: node.params.gamePlayProjectDir?.trim() || undefined,
    log: ctx.log
  })

  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  return persistProjectMeta(ctx, result.projectRelativeDir, result.gameMode)
}
