import {
  computeStage2dLayerPlacements,
  extractAlphaBounds,
  normalizeStage2dScene,
  type Stage2dSceneState
} from '@shared/gameAssets'
import { loadImageElement } from '../../yolo/cutout'

/**
 * 逐层载入精灵并读透明通道主体外接框（对齐 align 的几何口径）。
 * 不可绘源 / 解码失败返回 null（该层跳过，不阻断其余层）。
 */
async function probeStageSprite(
  url: string
): Promise<{
  image: HTMLImageElement
  srcWidth: number
  srcHeight: number
  bounds: NonNullable<ReturnType<typeof extractAlphaBounds>>
} | null> {
  const trimmed = url.trim()
  if (!trimmed) return null
  try {
    const img = await loadImageElement(trimmed)
    const sw = img.naturalWidth || 1
    const sh = img.naturalHeight || 1
    const probe = document.createElement('canvas')
    probe.width = sw
    probe.height = sh
    const probeCtx = probe.getContext('2d')
    if (!probeCtx) throw new Error('STAGE_CANVAS_UNAVAILABLE')
    probeCtx.drawImage(img, 0, 0)
    const rgba = probeCtx.getImageData(0, 0, sw, sh)
    const bounds =
      extractAlphaBounds(rgba.data, sw, sh, { alphaMin: 8 }) ?? {
        x: 0,
        y: 0,
        width: sw,
        height: sh
      }
    return { image: img, srcWidth: sw, srcHeight: sh, bounds }
  } catch {
    return null
  }
}

/**
 * 2D 舞台像素合成：把场景内多个精灵层按各自锚点对齐计划
 * （computeStage2dLayerPlacements 纯几何）依层序叠绘到舞台画布，
 * 合成单帧透明 PNG。层 sourceUrl 需已是可绘制 URL
 * （data:/http(s)/blob；相对路径先经宿主 resolver 读成 dataUrl）。
 * 与 composeImageAlignCanvas 同构：只做像素搬移，不调用任何模型。
 */
export async function composeStage2dCanvas(input: {
  state: Stage2dSceneState
}): Promise<{ dataUrl: string; width: number; height: number }> {
  const scene = normalizeStage2dScene(input.state)
  const probes = await Promise.all(
    scene.layers.map((layer) =>
      layer.visible && layer.sourceUrl.trim()
        ? probeStageSprite(layer.sourceUrl)
        : Promise.resolve(null)
    )
  )
  const sourceInfos = scene.layers.map((_, index) => {
    const probe = probes[index]
    return probe
      ? { srcWidth: probe.srcWidth, srcHeight: probe.srcHeight, bounds: probe.bounds }
      : { srcWidth: 0, srcHeight: 0, bounds: null }
  })
  const placements = computeStage2dLayerPlacements(scene, sourceInfos)

  const canvas = document.createElement('canvas')
  canvas.width = scene.canvasWidth
  canvas.height = scene.canvasHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('STAGE_CANVAS_UNAVAILABLE')
  ctx.clearRect(0, 0, scene.canvasWidth, scene.canvasHeight)
  placements.forEach((placement, index) => {
    const probe = probes[index]
    const { plan } = placement
    if (!probe || !plan) return
    // 只搬主体框内容（自动丢弃半透明孤立点 / 残留边）
    ctx.drawImage(
      probe.image,
      plan.bounds.x,
      plan.bounds.y,
      plan.bounds.width,
      plan.bounds.height,
      plan.dstX,
      plan.dstY,
      plan.dstW,
      plan.dstH
    )
  })
  return {
    dataUrl: canvas.toDataURL('image/png'),
    width: scene.canvasWidth,
    height: scene.canvasHeight
  }
}
