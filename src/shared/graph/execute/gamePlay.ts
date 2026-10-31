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
import { compilePlayableGameSandboxHtml, type GameDataTableBundle } from '../../gameAssets'
import { flattenTextValues, flattenTextsValues } from './gallery'
import {
  autoIncomingTextForInstruction,
  collectIncomingValues,
  selectIncomingValuesForInstruction
} from './incoming'
import { resolveMentionSources } from './context'
import type { GraphValue, NodeExecuteContext } from './types'
import { gamePlayJobError } from '../../gamePlayJob'

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
      ctx.log?.('cook: building Node/esbuild project…')
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
      throw new Error(gamePlayJobError('BUILD'))
    }
    ctx.log?.(`cook: ${projectDir}`)
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

  // 若上游连入了 `game.economy`（machinations_economy_bundle）或结构化数值配表 JSON，直接将其卡牌与角色数值注入可玩沙盒
  const allIncoming = [...selected, ...collectIncomingValues(ctx.inputs)]
  const candidateTexts = [
    fromAuto,
    ...flattenTextValues(allIncoming).map((t) => t.text),
    ...flattenTextsValues(allIncoming).map((t) => t.text)
  ].filter(Boolean)

  for (const rawTxt of candidateTexts) {
    if (
      !rawTxt.includes('"machinations_economy_bundle"') &&
      !rawTxt.includes('"tableCsvs"') &&
      !rawTxt.includes('"dataTableBundle"')
    ) {
      continue
    }
    try {
      const parsed = JSON.parse(rawTxt) as {
        kind?: string
        document?: { title?: string; templateId?: string }
        dataTableBundle?: GameDataTableBundle
        workbenchReport?: { activePresetId?: string; dataTableBundle?: GameDataTableBundle }
        cards?: GameDataTableBundle['cards']
        characters?: GameDataTableBundle['characters']
      }
      const bundle =
        parsed.dataTableBundle ??
        parsed.workbenchReport?.dataTableBundle ??
        (Array.isArray(parsed.cards) ? (parsed as unknown as GameDataTableBundle) : undefined)
      if (bundle && (bundle.cards?.length || bundle.characters?.length)) {
        const hero = bundle.characters?.[0]
        const isBalatro =
          parsed.workbenchReport?.activePresetId === 'balatro_roguelike' ||
          parsed.document?.templateId === 'balatro_ante_jokers' ||
          /balatro|chips|joker|\u5c0f\u4e11/i.test(bundle.tableName || '')
        const compiled = compilePlayableGameSandboxHtml({
          title:
            parsed.document?.title || bundle.tableName || ctx.node.title || 'Roguelike Deckbuilder',
          mode: bundle.cards?.length ? 'card_dbg' : 'survivor',
          balatroScoring: isBalatro,
          customPlayerMaxHp: hero?.hp,
          customPlayerBaseAtk: hero?.atk,
          customCards: bundle.cards?.map((c) => ({
            id: c.id,
            name: c.name,
            cost: c.cost,
            cardType: c.cardType,
            damage: Number(c.damage ?? 0),
            block: Number(c.block ?? 0),
            description: c.description
          }))
        })
        const prepared = prepareGameHtml(compiled.html, preferred)
        return commitGamePlay(ctx, prepared.html, prepared.mode)
      }
    } catch {
      // ignore non-json text
    }
  }

  const seeded = seedGameHtml(preferred)
  return commitGamePlay(ctx, seeded.html, preparedModeOrDefault(seeded.mode))
}

function preparedModeOrDefault(mode: '2d' | '3d'): '2d' | '3d' {
  return mode
}
