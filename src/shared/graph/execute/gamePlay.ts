/**
 * `asset.gamePlay`：接收上游 HTML → 校验写回 → 双击沙盒试玩（无输出端口，仅预览终端）。
 */
import { isAssetRefNode } from '../nodeRole'
import {
  prepareGameHtml,
  resolvePreferredGamePlayMode,
  seedGameHtml,
  type GamePlayMode
} from '../../gamePlay'
import { flattenTextValues, flattenTextsValues } from './gallery'
import { autoIncomingTextForInstruction, selectIncomingValuesForInstruction } from './incoming'
import { resolveMentionSources } from './context'
import type { GraphValue, NodeExecuteContext } from './types'

function readStoredHtml(ctx: NodeExecuteContext): string {
  const fromParams = ctx.node.params.gamePlayHtml?.trim() || ctx.node.params.text?.trim() || ''
  if (fromParams) return fromParams
  if (ctx.node.assetId && ctx.resolveAssetGenParams) {
    const gp = ctx.resolveAssetGenParams(ctx.node.assetId) as
      { gamePlayHtml?: string; text?: string } | undefined
    const fromAsset = gp?.gamePlayHtml?.trim() || gp?.text?.trim() || ''
    if (fromAsset) return fromAsset
  }
  return ''
}

async function hydratePathOnlyTexts(
  ctx: NodeExecuteContext,
  values: GraphValue[]
): Promise<string> {
  const fromPorts = flattenTextValues(values)
    .map((item) => item.text.trim())
    .filter(Boolean)
    .join('\n\n')
  if (fromPorts) return fromPorts

  if (!ctx.readRunText) return ''
  const items = flattenTextsValues(values)
  for (const item of items) {
    const path = item.relativePath?.trim()
    if (!path) continue
    try {
      const text = (await ctx.readRunText(path))?.trim() ?? ''
      if (text) return text
    } catch {
      // try next
    }
  }
  // 单条 text 口也可能只有 relativePath
  for (const v of values) {
    if (v.kind !== 'text') continue
    const path = v.relativePath?.trim()
    if (!path || v.text.trim()) continue
    try {
      const text = (await ctx.readRunText(path))?.trim() ?? ''
      if (text) return text
    } catch {
      // try next
    }
  }
  return ''
}

async function resolveIncomingHtml(ctx: NodeExecuteContext): Promise<string> {
  const mentionSources = resolveMentionSources(ctx)
  const instructionRaw = ctx.node.params.generateInstruction?.trim() ?? ''
  const selected = selectIncomingValuesForInstruction(ctx, instructionRaw)
  const fromAuto = autoIncomingTextForInstruction(instructionRaw, selected, mentionSources)
  if (fromAuto.trim()) return fromAuto.trim()
  const hydrated = await hydratePathOnlyTexts(ctx, selected)
  if (hydrated.trim()) return hydrated.trim()
  return readStoredHtml(ctx)
}

async function commitGamePlay(
  ctx: NodeExecuteContext,
  html: string,
  mode: '2d' | '3d'
): Promise<Record<string, GraphValue>> {
  const params = {
    gamePlayHtml: html,
    gamePlayMode: mode,
    text: html
  }
  ctx.node.params = { ...ctx.node.params, ...params }
  ctx.patchNode?.({ params })
  // 仅作沙盒预览终端，无输出口
  return {}
}

export async function executeGamePlayAssetNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const preferred = resolvePreferredGamePlayMode(ctx.node.params.gamePlayMode) as GamePlayMode

  if (isAssetRefNode(ctx.node)) {
    const stored = readStoredHtml(ctx)
    if (!stored) {
      const seeded = seedGameHtml(preferred)
      return commitGamePlay(ctx, seeded.html, seeded.mode)
    }
    const prepared = prepareGameHtml(stored, preferred)
    return commitGamePlay(ctx, prepared.html, prepared.mode)
  }

  const raw = await resolveIncomingHtml(ctx)

  if (!raw) {
    const seeded = seedGameHtml(preferred)
    return commitGamePlay(ctx, seeded.html, seeded.mode)
  }

  const prepared = prepareGameHtml(raw, preferred)
  return commitGamePlay(ctx, prepared.html, prepared.mode)
}
