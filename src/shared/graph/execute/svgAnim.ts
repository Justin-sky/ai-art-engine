import type { GraphImageItem, GraphImageValue, GraphValue, NodeExecuteContext } from './types'
import { readSvgAnimFromNode, SVG_ANIM_GIF_OUT_PORT_ID } from '../svgAnim'
import { buildGeneratedMediaFileKey } from '../../domain'
import { dedupeGalleryIds } from './gallery'
import { commitGeneratedImages, materializeGeneratedBatch } from './materialize'
import { collectIncomingImageItems } from './mediaInputs'
import { fail } from '@shared/errors/appError'
import { SHARED_ERRORS } from '../../errors/catalog'

/**
 * SVG 烘焙节点（svg.anim）：把入端口接到的矢量源（SVG 生成节点 / 图库 SVG 资产）
 * 当作模板，按动效时间轴逐帧烘焙成 PNG（out / out-all），并合成 GIF 动图落盘（out-gif）。
 * 无动效的静态 SVG 只出一帧、不产 GIF。
 *
 * 与 2D 帧动画节点同构：帧是主产物（可逐帧检查、可继续送后续节点），GIF 是附加产物。
 * 差别只在帧来源——那边是切序列图，这边是把 SVG 的时间轴求值后栅格化。因此
 * 「怎么求值」在 shared（media/svgTimeline），「怎么栅格化」在渲染层
 * （features/graph/model/renderSvgFrames），本文件只做装配与落盘。
 */
export async function executeSvgAnimNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const { node } = ctx
  const state = readSvgAnimFromNode(node.params)
  const incoming = await collectIncomingImageItems(ctx)
  const source = incoming[0]
  if (!source) {
    throw new Error('GRAPH_PROCESS_NO_INPUT')
  }
  const svgText = await resolveSvgSourceText(ctx, source)
  if (!svgText) {
    throw fail(SHARED_ERRORS.svgSourceUnreadable)
  }
  if (!ctx.renderSvgFrames) {
    throw fail(SHARED_ERRORS.capabilitySvgRender)
  }
  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  const rendered = await ctx.renderSvgFrames({ svgText, state, signal: ctx.signal })
  if (!rendered?.frameUrls.length) {
    throw fail(SHARED_ERRORS.svgRenderEmpty)
  }

  const createdAt = new Date().toISOString()
  const stamp = Date.now()
  const batch: GraphImageItem[] = rendered.frameUrls.map((dataUrl, index) => ({
    id: `svgAnim:${node.id}:${stamp}:${index + 1}`,
    dataUrl,
    createdAt
  }))
  const materializedBatch = await materializeGeneratedBatch(
    ctx,
    batch,
    `svgAnim:${node.id}:${stamp}`
  )
  if (!materializedBatch.length) {
    throw fail(SHARED_ERRORS.persistImageFailed, { detail: '' })
  }
  // 与 2D 帧动画一致：每次 cook 只保留本次烘焙的帧，不累积历史
  const generatedImages = dedupeGalleryIds(
    [],
    materializedBatch,
    `svgAnim:${node.id}:${stamp}:keep`
  )
  const gif = await composeSvgAnimGifOutput(ctx, batch, rendered)
  const outputs = commitGeneratedImages(
    ctx,
    generatedImages,
    materializedBatch[0]?.relativePath?.trim(),
    {
      svgFrames: state.frames,
      svgDurationSec: state.durationSec,
      svgWidth: state.width,
      svgHeight: state.height,
      svgBackground: state.background,
      svgSourceRelativePath: source.relativePath?.trim() || '',
      svgDetectedPeriodSec: rendered.durationSec,
      ...gif.params
    }
  )
  return gif.value ? { ...outputs, [SVG_ANIM_GIF_OUT_PORT_ID]: gif.value } : outputs
}

/**
 * 取输入 SVG 的源文本：优先 data URL（`data:image/svg+xml`，端口直传的矢量内容），
 * 否则按工程相对路径读原文件。拿到的是位图（PNG/JPEG）时返回空串，由调用方报错。
 */
async function resolveSvgSourceText(
  ctx: NodeExecuteContext,
  item: GraphImageItem
): Promise<string> {
  const dataUrl = item.dataUrl?.trim() ?? ''
  if (dataUrl.startsWith('data:image/svg+xml')) {
    return decodeSvgDataUrl(dataUrl)
  }
  const relativePath = item.relativePath?.trim()
  if (relativePath && ctx.readRunText) {
    try {
      const text = (await ctx.readRunText(relativePath)) ?? ''
      if (text.includes('<svg')) return text
    } catch (err) {
      console.warn('[graph] read svg source failed', err)
    }
  }
  // 兜底：端口只给了资产引用时，再经 resolveImageUrls 取一次内容
  if (!dataUrl && ctx.resolveImageUrls) {
    const resolved = (await ctx.resolveImageUrls([item])).find(Boolean) ?? ''
    if (resolved.startsWith('data:image/svg+xml')) return decodeSvgDataUrl(resolved)
  }
  return ''
}

function decodeSvgDataUrl(dataUrl: string): string {
  const comma = dataUrl.indexOf(',')
  if (comma < 0) return ''
  const meta = dataUrl.slice(0, comma)
  const payload = dataUrl.slice(comma + 1)
  if (!payload) return ''
  try {
    if (meta.includes(';base64')) {
      const binary = atob(payload)
      const bytes = new Uint8Array(binary.length)
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index)
      }
      return new TextDecoder().decode(bytes)
    }
    return decodeURIComponent(payload)
  } catch (err) {
    console.warn('[graph] decode svg data url failed', err)
    return ''
  }
}

/**
 * 运行后输出 GIF：把本次烘焙的帧合成动图并落盘为工程资产。
 * 静态 SVG（无动画）、帧数不足两帧、渲染层未注入合成能力时不产出，节点保持纯出帧行为。
 */
async function composeSvgAnimGifOutput(
  ctx: NodeExecuteContext,
  frames: GraphImageItem[],
  rendered: { fps: number; animated: boolean }
): Promise<{ value?: GraphImageValue; params: Record<string, unknown> }> {
  const fps = rendered.fps
  if (!rendered.animated || fps <= 0 || !ctx.composeGifFrames || !ctx.saveRunMedia) {
    return { params: {} }
  }
  const frameUrls = frames
    .map((item) => item.dataUrl?.trim() ?? '')
    .filter((url): url is string => Boolean(url))
  // 单帧动图没有播放价值
  if (frameUrls.length < 2) return { params: {} }
  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }
  const gif = await ctx.composeGifFrames({ frameUrls, fps, loop: true })
  if (!gif?.dataUrl) return { params: {} }
  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }
  const stem = ctx.node.title?.trim() || ctx.node.typeId || 'svg-anim'
  const relativePath = await ctx.saveRunMedia({
    dataUrl: gif.dataUrl,
    key: buildGeneratedMediaFileKey({
      hostAssetName: ctx.resolveHostAssetName?.(),
      nodeTitle: `${stem}-gif`
    }),
    outputDir: ctx.node.params.mediaOutputDir?.trim() || undefined,
    node: ctx.node
  })
  return {
    value: { kind: 'image', dataUrl: '', relativePath },
    params: {
      svgGifRelativePath: relativePath,
      svgGifFps: fps,
      svgGifFrameCount: gif.frameCount,
      svgGifWidth: gif.width,
      svgGifHeight: gif.height
    }
  }
}

