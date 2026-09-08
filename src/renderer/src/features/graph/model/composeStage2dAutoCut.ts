import {
  computeStage2dLayerPlacements,
  computeStage2dRigTransforms,
  extractAlphaBounds,
  normalizeStage2dRig,
  normalizeStage2dScene,
  partitionStage2dAutoPart,
  type Stage2dAutoPartPiece,
  type Stage2dAutoPoint,
  type Stage2dAutoPartSlot,
  type Stage2dLayer,
  type Stage2dRig,
  type Stage2dSceneState
} from '@shared/gameAssets'
import { loadImageElement } from '../../yolo/cutout'

/**
 * 立绘自动拆件（5.4 半自动工具 v1）：把「整图层立绘」沿当前骨骼的关节
 * 骨段切成部件层，部件以 frame 共享整图层几何精确贴回原图位置、以 pivot
 * 任意枢轴对准挂点，随后即可随骨骼摆姿 / 导出 Spine。
 *
 * v1 假设（可后续成熟化）：
 * - 内容为普通立绘（透明 PNG），骨骼已按人形模板建立（含 head / torso /
 *   shoulder/elbow/wrist、hip/knee/ankle 等标准关节）；
 * - 以「绑定姿势」切割：调用前请先复位摆姿，切完 pose 清空，
 *   当前视觉（绑定姿势）即整图层原图。
 */

/** 人形槽位定义：折线端点 = 关节 id 序列，首点为挂点关节 */
const HUMAN_SLOTS: Array<Pick<Stage2dAutoPartSlot, 'id' | 'name' | 'jointId'> & { pointIds: string[] }> = [
  { id: 'head', name: '头', jointId: 'neck', pointIds: ['neck', 'head'] },
  { id: 'torso', name: '躯干', jointId: 'pelvis', pointIds: ['pelvis', 'chest', 'neck'] },
  { id: 'upperarmL', name: '上臂L', jointId: 'shoulderL', pointIds: ['shoulderL', 'elbowL'] },
  { id: 'forearmL', name: '前臂L', jointId: 'elbowL', pointIds: ['elbowL', 'wristL'] },
  { id: 'upperarmR', name: '上臂R', jointId: 'shoulderR', pointIds: ['shoulderR', 'elbowR'] },
  { id: 'forearmR', name: '前臂R', jointId: 'elbowR', pointIds: ['elbowR', 'wristR'] },
  { id: 'thighL', name: '大腿L', jointId: 'hipL', pointIds: ['hipL', 'kneeL'] },
  { id: 'shinL', name: '小腿L', jointId: 'kneeL', pointIds: ['kneeL', 'ankleL'] },
  { id: 'thighR', name: '大腿R', jointId: 'hipR', pointIds: ['hipR', 'kneeR'] },
  { id: 'shinR', name: '小腿R', jointId: 'kneeR', pointIds: ['kneeR', 'ankleR'] }
]

export interface Stage2dAutoCutResult {
  state: Stage2dSceneState
  rig: Stage2dRig
  /** 切出的部件数（0 = 无可切内容） */
  partCount: number
}

/** 把一张「已解码图像」的 alpha 外接框内容拷到独立 RGBA 缓冲 */
function extractContentRgba(
  image: HTMLImageElement
): { rgba: Uint8ClampedArray; contentWidth: number; contentHeight: number; bounds: NonNullable<ReturnType<typeof extractAlphaBounds>> } | null {
  const sw = image.naturalWidth || 1
  const sh = image.naturalHeight || 1
  const probe = document.createElement('canvas')
  probe.width = sw
  probe.height = sh
  const probeCtx = probe.getContext('2d')
  if (!probeCtx) throw new Error('STAGE_CANVAS_UNAVAILABLE')
  probeCtx.drawImage(image, 0, 0)
  const full = probeCtx.getImageData(0, 0, sw, sh)
  const bounds =
    extractAlphaBounds(full.data, sw, sh, { alphaMin: 8 }) ?? {
      x: 0,
      y: 0,
      width: sw,
      height: sh
    }
  const contentWidth = bounds.width
  const contentHeight = bounds.height
  const rgba = new Uint8ClampedArray(contentWidth * contentHeight * 4)
  for (let y = 0; y < contentHeight; y += 1) {
    const srcStart = ((bounds.y + y) * sw + bounds.x) * 4
    rgba.set(full.data.subarray(srcStart, srcStart + contentWidth * 4), y * contentWidth * 4)
  }
  return { rgba, contentWidth, contentHeight, bounds }
}

/** 由整图层内容 + 分区结果合成一张部件 PNG dataUrl */
function buildPartDataUrl(
  contentRgba: Uint8ClampedArray,
  contentWidth: number,
  assignment: Int32Array,
  slot: number,
  crop: Stage2dAutoPartPiece['crop']
): string {
  const canvas = document.createElement('canvas')
  canvas.width = crop.width
  canvas.height = crop.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('STAGE_CANVAS_UNAVAILABLE')
  const img = ctx.createImageData(crop.width, crop.height)
  const out = img.data
  for (let y = 0; y < crop.height; y += 1) {
    const contentY = crop.y + y
    for (let x = 0; x < crop.width; x += 1) {
      const contentX = crop.x + x
      const srcIdx = contentY * contentWidth + contentX
      if (assignment[srcIdx] !== slot) continue
      const inOff = srcIdx * 4
      const outOff = (y * crop.width + x) * 4
      out[outOff] = contentRgba[inOff]
      out[outOff + 1] = contentRgba[inOff + 1]
      out[outOff + 2] = contentRgba[inOff + 2]
      out[outOff + 3] = contentRgba[inOff + 3]
    }
  }
  ctx.putImageData(img, 0, 0)
  return canvas.toDataURL('image/png')
}

/** 唯一层 id（避免与既有层冲突） */
function uniqueLayerId(layers: Stage2dLayer[], base: string): string {
  const used = new Set(layers.map((layer) => layer.id))
  let id = base
  let suffix = 2
  while (used.has(id)) {
    id = `${base}-${suffix}`
    suffix += 1
  }
  return id
}

/**
 * 自动拆件：切整图层 → 新部件层（frame 共享几何 + pivot 枢轴）+ 挂点。
 * 返回 null 表示前提不满足（无法给出可用部件）。
 */
export async function autoCutStage2dLayer(input: {
  state: Stage2dSceneState
  rig: Stage2dRig
  /** 要拆的整图层 id（须非空 sourceUrl、未绑定骨骼） */
  frameLayerId: string
  /** 层 sourceUrl → 可绘制 URL 的 resolver */
  resolveLayerUrl: (sourceUrl: string) => Promise<string>
}): Promise<Stage2dAutoCutResult | null> {
  const scene = normalizeStage2dScene(input.state)
  const rig = normalizeStage2dRig(input.rig)
  const frameIndex = scene.layers.findIndex((layer) => layer.id === input.frameLayerId)
  if (frameIndex < 0 || !scene.layers[frameIndex].sourceUrl.trim()) return null
  if (scene.layers[frameIndex].visible === false) return null
  if (rig.attachments.some((a) => a.layerId === input.frameLayerId)) return null

  // 探测全部层：参考层的放置几何（拆完整图层隐藏，但仍是部件层几何来源）
  const probes = await Promise.all(
    scene.layers.map(async (layer) => {
      if (!layer.sourceUrl.trim()) return null
      const url = await input.resolveLayerUrl(layer.sourceUrl)
      return url ? loadImageElement(url) : null
    })
  )
  const frameImg = probes[frameIndex]
  if (!frameImg) return null
  const content = extractContentRgba(frameImg)
  if (!content || content.contentWidth < 4 || content.contentHeight < 4) return null

  const sourceInfos = scene.layers.map((_, index) => {
    const img = probes[index]
    const sw = img?.naturalWidth || 0
    const sh = img?.naturalHeight || 0
    if (!img || !sw || !sh) return { srcWidth: 0, srcHeight: 0, bounds: null }
    const probe = document.createElement('canvas')
    probe.width = sw
    probe.height = sh
    const probeCtx = probe.getContext('2d')
    if (!probeCtx) throw new Error('STAGE_CANVAS_UNAVAILABLE')
    probeCtx.drawImage(img, 0, 0)
    const rgba = probeCtx.getImageData(0, 0, sw, sh)
    const bounds = extractAlphaBounds(rgba.data, sw, sh, { alphaMin: 8 })
    return { srcWidth: sw, srcHeight: sh, bounds: bounds ?? null }
  })
  const placements = computeStage2dLayerPlacements(scene, sourceInfos)
  const framePlacement = placements[frameIndex]
  if (!framePlacement?.plan) return null
  const fp = framePlacement.plan
  // 用参考层精确 scale 做内容坐标 ↔ 画布坐标换算（与 computeStage2dLayerPlacements 的 frame 子层一致）
  const scale = fp.scale > 0 ? fp.scale : 0
  if (!(scale > 0)) return null

  // 关节绑定世界坐标 → 整图层内容坐标
  const jointTransforms = computeStage2dRigTransforms(rig, null)
  const jointWorld = new Map(jointTransforms.map((t) => [t.jointId, { x: t.x, y: t.y }]))
  const toContent = (pt: { x: number; y: number }): Stage2dAutoPoint => ({
    x: (pt.x - fp.dstX) / scale,
    y: (pt.y - fp.dstY) / scale
  })

  // 组装槽位（缺关键关节的槽跳过）
  const slots: Stage2dAutoPartSlot[] = []
  for (const def of HUMAN_SLOTS) {
    const pts: Stage2dAutoPoint[] = []
    for (const id of def.pointIds) {
      const world = jointWorld.get(id)
      if (!world) break
      pts.push(toContent(world))
    }
    if (pts.length >= 2) {
      slots.push({ id: def.id, name: def.name, jointId: def.jointId, polyline: pts })
    }
  }
  if (slots.length < 3) return null

  const alpha = new Uint8Array(content.contentWidth * content.contentHeight)
  for (let i = 0; i < alpha.length; i += 1) alpha[i] = content.rgba[i * 4 + 3]

  const partition = partitionStage2dAutoPart({
    width: content.contentWidth,
    height: content.contentHeight,
    alpha,
    slots
  })
  if (!partition.pieces.length) return null

  // 每个部件：生成 PNG、建层、算挂点
  const layers = scene.layers.map((layer) =>
    layer.id === input.frameLayerId ? { ...layer, visible: false } : layer
  )
  const attachments = [...rig.attachments]
  const partCount = partition.pieces.length
  partition.pieces.forEach((piece, slotIndex) => {
    const layerId = uniqueLayerId(layers, `part-${piece.id}`)
    const dataUrl = buildPartDataUrl(
      content.rgba,
      content.contentWidth,
      partition.assignment,
      slotIndex,
      piece.crop
    )
    const pivotContent = piece.pivot
    const pivotWorld = { x: fp.dstX + pivotContent.x * scale, y: fp.dstY + pivotContent.y * scale }
    const joint = jointWorld.get(piece.jointId) ?? { x: pivotWorld.x, y: pivotWorld.y }
    // 挂点偏移 = 枢轴（图内容位置）− 关节绑定世界位；绑定姿势下部件精确贴图
    const offsetX = pivotWorld.x - joint.x
    const offsetY = pivotWorld.y - joint.y
    layers.push({
      id: layerId,
      name: piece.name,
      sourceUrl: dataUrl,
      align: {
        anchor: 'ground',
        contentHeightRatio: 0.9,
        groundRatio: scene.groundRatio,
        fitWithinWidth: true
      },
      offset: { x: 0, y: 0 },
      frame: {
        layerId: input.frameLayerId,
        crop: {
          x: piece.crop.x,
          y: piece.crop.y,
          width: piece.crop.width,
          height: piece.crop.height
        }
      },
      pivot: { x: piece.pivot.x - piece.crop.x, y: piece.pivot.y - piece.crop.y },
      visible: true
    })
    attachments.push({
      layerId,
      jointId: piece.jointId,
      offsetX,
      offsetY,
      rotation: 0
    })
  })

  const state = normalizeStage2dScene({ ...scene, layers })
  const nextRig = normalizeStage2dRig({ ...rig, attachments })
  return { state, rig: nextRig, partCount }
}
