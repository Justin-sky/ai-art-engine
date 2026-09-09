import {
  buildIconPackManifest,
  sanitizeIconStem
} from '../../gameAssets'
import {
  iconPackCellKeyAt,
  iconPackCellRefinesToOverrides,
  readIconPackFromNode,
  readIconPackRefinesFromNode
} from '../iconPack'
import type { NodeExecuteContext, GraphValue } from './types'
import { collectIncomingImageItems } from './mediaInputs'
import { flattenTextsValues } from './gallery'
import { commitGeneratedImages } from './materialize'

/**
 * 图标包导出节点（image.iconPack）：
 * 整版图标表 + 名单文本 → 逐格（cellKey）裁切 → 采样色键控透明 →
 * 统一画布中心对齐 → 按名单命名 PNG 落盘 → 同目录写 icons manifest。
 * 纯本地处理；名单顺序即整版表逐行格位顺序，名单不足处为空白格不导出。
 */
export async function executeIconPackNode(ctx: NodeExecuteContext): Promise<Record<string, GraphValue>> {
  const state = readIconPackFromNode(ctx.node.params)

  const sourceItems = await collectIncomingImageItems(ctx)
  if (!sourceItems.length) {
    throw new Error('GRAPH_PROCESS_NO_INPUT')
  }
  let sourceUrl = ''
  if (ctx.resolveImageUrls) {
    sourceUrl = (await ctx.resolveImageUrls(sourceItems.slice(0, 1))).find(Boolean) ?? ''
  } else {
    sourceUrl = sourceItems[0]?.dataUrl?.trim() ?? ''
  }
  if (!sourceUrl && ctx.resolveAssetImageUrl) {
    for (const value of collectIncomingValues(ctx.inputs)) {
      if (value.kind !== 'asset' || value.assetType !== 'image') continue
      const url = await ctx.resolveAssetImageUrl(value.assetId)
      if (url) {
        sourceUrl = url
        break
      }
    }
  }
  if (!sourceUrl) {
    throw new Error('GRAPH_PROCESS_NO_INPUT')
  }

  const names = await collectIconNames(ctx)

  if (!ctx.composeImageIconPackSheet) {
    throw new Error('ICON_PACK_CANVAS_UNAVAILABLE')
  }
  const cellOverrides = iconPackCellRefinesToOverrides(
    readIconPackRefinesFromNode(ctx.node.params)
  )
  const result = await ctx.composeImageIconPackSheet({
    sourceDataUrl: sourceUrl,
    state,
    names,
    ...(Object.keys(cellOverrides).length ? { cellOverrides } : {}),
    signal: ctx.signal
  })

  const stamp = Date.now()
  const createdAt = new Date().toISOString()
  const outputDir = ctx.node.params.mediaOutputDir?.trim() || undefined

  const entries: Array<{
    name: string
    fileName: string
    cellKey: string
    width: number
    height: number
  }> = []
  const generatedImages: Array<{
    id: string
    title?: string
    dataUrl: string
    relativePath?: string
    createdAt: string
  }> = []

  for (const item of result.items) {
    if (ctx.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const stem = sanitizeIconStem(item.name)
    let relativePath = ''
    if (ctx.saveRunMedia) {
      try {
        relativePath = await ctx.saveRunMedia({
          dataUrl: item.dataUrl,
          key: stem,
          outputDir,
          node: ctx.node
        })
      } catch {
        // 落盘失败不阻断图库：退化为内存展示（dataUrl 保留）
        relativePath = ''
      }
    }
    const fileName = relativePath
      ? relativePath.split(/[\\/]/).pop() || `${stem}.png`
      : `${stem}.png`
    const cellKey = iconPackCellKeyAt(state.rows, state.cols, generatedImages.length)
    entries.push({
      name: item.name,
      fileName,
      cellKey,
      width: item.width,
      height: item.height
    })
    generatedImages.push({
      id: `iconPack:${ctx.node.id}:${stamp}:${cellKey}`,
      title: item.name,
      dataUrl: relativePath ? '' : item.dataUrl,
      ...(relativePath ? { relativePath } : {}),
      createdAt
    })
  }

  const manifest = buildIconPackManifest({
    packId: `${ctx.node.id}:${stamp}`,
    createdAt,
    canvasSize: result.canvasSize,
    background: result.background,
    rows: state.rows,
    cols: state.cols,
    icons: entries
  })

  let manifestRelativePath = ''
  if (ctx.saveRunText) {
    try {
      manifestRelativePath = await ctx.saveRunText({
        content: JSON.stringify(manifest, null, 2),
        key: 'icons',
        outputDir,
        node: ctx.node
      })
    } catch {
      manifestRelativePath = ''
    }
  }

  const previewRelativePath =
    generatedImages[generatedImages.length - 1]?.relativePath ?? ''
  return commitGeneratedImages(
    ctx,
    generatedImages as Parameters<typeof commitGeneratedImages>[1],
    previewRelativePath,
    {
      iconPackManifest: manifest,
      iconPackManifestRelativePath: manifestRelativePath
    }
  )
}

async function collectIconNames(ctx: NodeExecuteContext): Promise<string[]> {
  const raw: string[] = []
  // 注意：不能走 collectIncomingValues（in 有图片时它会只返回 in 而丢掉 in-text 文本）。
  // iconPack 是多口节点（in=整版图 / in-text=名单），需铺平全部输入口再筛文本。
  const texts = flattenTextsValues(Object.values(ctx.inputs).flat())
  for (const text of texts) {
    if (text.text?.trim()) {
      raw.push(text.text)
    } else if (text.relativePath?.trim() && ctx.readRunText) {
      try {
        const content = await ctx.readRunText(text.relativePath)
        if (content?.trim()) raw.push(content)
      } catch {
        // 读盘失败忽略该条名单
      }
    }
  }
  const lines = raw
    .flatMap((chunk) => chunk.split(/\r?\n/))
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && !line.startsWith('//'))
  return lines
}
