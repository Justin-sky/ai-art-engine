/**
 * `asset.gamePlay`：接收上游工程目录 → cook（npm + node build.mjs）→ 单 HTML 写回 → 沙盒试玩。
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
import { gamePlayDshError } from '../../gamePlayDshJob'

function readStoredHtml(ctx: NodeExecuteContext): string {
  const fromParams = ctx.node.params.gamePlayHtml?.trim() || ctx.node.params.text?.trim() || ''
  if (fromParams && fromParams.includes('<html')) return fromParams
  if (ctx.node.assetId && ctx.resolveAssetGenParams) {
    const gp = ctx.resolveAssetGenParams(ctx.node.assetId) as
      { gamePlayHtml?: string; text?: string } | undefined
    const fromAsset = gp?.gamePlayHtml?.trim() || gp?.text?.trim() || ''
    if (fromAsset && fromAsset.includes('<html')) return fromAsset
  }
  return ''
}

function readProjectDir(ctx: NodeExecuteContext): string {
  const fromParams = ctx.node.params.gamePlayProjectDir?.trim() || ''
  if (fromParams) return fromParams.replace(/\\/g, '/')
  if (ctx.node.assetId && ctx.resolveAssetGenParams) {
    const gp = ctx.resolveAssetGenParams(ctx.node.assetId) as
      { gamePlayProjectDir?: string } | undefined
    const fromAsset = gp?.gamePlayProjectDir?.trim() || ''
    if (fromAsset) return fromAsset.replace(/\\/g, '/')
  }
  return ''
}

async function resolveIncomingProjectDir(ctx: NodeExecuteContext): Promise<string> {
  const stored = readProjectDir(ctx)
  if (stored) return stored

  const mentionSources = resolveMentionSources(ctx)
  const instructionRaw = ctx.node.params.generateInstruction?.trim() ?? ''
  const selected = selectIncomingValuesForInstruction(ctx, instructionRaw)

  for (const v of selected) {
    if (v.kind === 'project' && v.relativePath?.trim()) {
      return v.relativePath.replace(/\\/g, '/')
    }
  }

  // 兼容旧链路：上游仍以 text / texts 携带工程路径
  for (const v of selected) {
    if (v.kind === 'text' && v.relativePath?.includes('GamePlayJobs')) {
      return v.relativePath.replace(/\\/g, '/')
    }
    if (v.kind === 'texts') {
      for (const item of v.items) {
        if (item.relativePath?.includes('GamePlayJobs')) {
          return item.relativePath.replace(/\\/g, '/')
        }
      }
    }
  }

  const fromAuto = autoIncomingTextForInstruction(instructionRaw, selected, mentionSources)
  const match = /Cache\/GamePlayJobs\/[^\s\n]+/i.exec(fromAuto)
  if (match?.[0]) return match[0].replace(/\\/g, '/')

  for (const item of flattenTextsValues(selected)) {
    if (item.relativePath?.includes('GamePlayJobs')) {
      return item.relativePath.replace(/\\/g, '/')
    }
  }
  for (const item of flattenTextValues(selected)) {
    if (item.relativePath?.includes('GamePlayJobs')) {
      return item.relativePath.replace(/\\/g, '/')
    }
  }
  return ''
}

async function commitGamePlay(
  ctx: NodeExecuteContext,
  html: string,
  mode: '2d' | '3d',
  extra?: { projectDir?: string; buildPath?: string }
): Promise<Record<string, GraphValue>> {
  // 有落盘路径时不要把整页 HTML 塞进 params（卡片 textPreview / 响应式图文档都会拖垮拖拽）
  const buildPath = extra?.buildPath?.trim() || ''
  const params = {
    gamePlayHtml: buildPath ? '' : html,
    gamePlayMode: mode,
    text: '',
    ...(extra?.projectDir ? { gamePlayProjectDir: extra.projectDir } : {}),
    ...(buildPath ? { gamePlayBuildHtmlPath: buildPath, gamePlayHtmlPath: buildPath } : {})
  }
  ctx.node.params = { ...ctx.node.params, ...params }
  ctx.patchNode?.({ params })
  return {}
}

export async function executeGamePlayAssetNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const preferred = resolvePreferredGamePlayMode(ctx.node.params.gamePlayMode) as GamePlayMode

  // 资产引用：已有编译 HTML 则直接校验；否则尝试 cook 工程
  if (isAssetRefNode(ctx.node)) {
    const projectDir = readProjectDir(ctx)
    if (projectDir && ctx.buildGamePlayProject) {
      ctx.log?.('cook：构建 Node/esbuild 工程…')
      const built = await ctx.buildGamePlayProject({
        projectRelativeDir: projectDir,
        log: ctx.log
      })
      const prepared = prepareGameHtml(built.html, preferred)
      return commitGamePlay(ctx, prepared.html, prepared.mode, {
        projectDir,
        buildPath: built.buildHtmlRelativePath
      })
    }
    const stored = readStoredHtml(ctx)
    if (!stored) {
      const seeded = seedGameHtml(preferred)
      return commitGamePlay(ctx, seeded.html, seeded.mode)
    }
    const prepared = prepareGameHtml(stored, preferred)
    return commitGamePlay(ctx, prepared.html, prepared.mode)
  }

  const projectDir = await resolveIncomingProjectDir(ctx)
  if (projectDir) {
    if (!ctx.buildGamePlayProject) {
      throw new Error(gamePlayDshError('BUILD'))
    }
    ctx.log?.(`cook：${projectDir}`)
    const built = await ctx.buildGamePlayProject({
      projectRelativeDir: projectDir,
      log: ctx.log
    })
    const prepared = prepareGameHtml(built.html, preferred)
    return commitGamePlay(ctx, prepared.html, prepared.mode, {
      projectDir,
      buildPath: built.buildHtmlRelativePath
    })
  }

  // 兼容：上游仍是整页 HTML 文本
  const rawHtml = readStoredHtml(ctx)
  if (rawHtml) {
    const prepared = prepareGameHtml(rawHtml, preferred)
    return commitGamePlay(ctx, prepared.html, prepared.mode)
  }

  const mentionSources = resolveMentionSources(ctx)
  const instructionRaw = ctx.node.params.generateInstruction?.trim() ?? ''
  const selected = selectIncomingValuesForInstruction(ctx, instructionRaw)
  const fromAuto = autoIncomingTextForInstruction(instructionRaw, selected, mentionSources)
  if (fromAuto && /<html[\s>]/i.test(fromAuto)) {
    const prepared = prepareGameHtml(fromAuto, preferred)
    return commitGamePlay(ctx, prepared.html, prepared.mode)
  }

  const seeded = seedGameHtml(preferred)
  return commitGamePlay(ctx, seeded.html, seeded.mode)
}
