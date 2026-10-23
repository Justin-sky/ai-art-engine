import {
  computeStage2dAttachmentTransforms,
  computeStage2dLayerPlacements,
  extractAlphaBounds,
  normalizeStage2dScene,
  type Stage2dPose,
  type Stage2dRig,
  type Stage2dSceneState
} from '@shared/gameAssets'
import { loadImageElement } from '../../yolo/cutout'

type ProbedStageSprite = {
  image: HTMLImageElement
  srcWidth: number
  srcHeight: number
  bounds: NonNullable<ReturnType<typeof extractAlphaBounds>>
}

const PROBE_CACHE_MAX = 16
const probeSpriteCache = new Map<string, ProbedStageSprite>()

/**
 * 逐层载入精灵并读透明通道主体外接框（对齐 align 的几何口径）。
 * 不可绘源 / 解码失败返回 null（该层跳过，不阻断其余层）。
 * 带 LRU 缓存：同一层源在 24 帧动作序列连续烘焙时无需重复 getImageData + 扫描像素。
 */
async function probeStageSprite(url: string): Promise<ProbedStageSprite | null> {
  const trimmed = url.trim()
  if (!trimmed) return null
  const cached = probeSpriteCache.get(trimmed)
  if (cached && cached.image.complete && cached.image.naturalWidth > 0) {
    probeSpriteCache.delete(trimmed)
    probeSpriteCache.set(trimmed, cached)
    return cached
  }
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
    const bounds = extractAlphaBounds(rgba.data, sw, sh, { alphaMin: 8 }) ?? {
      x: 0,
      y: 0,
      width: sw,
      height: sh
    }
    const result: ProbedStageSprite = { image: img, srcWidth: sw, srcHeight: sh, bounds }
    if (probeSpriteCache.size >= PROBE_CACHE_MAX) {
      const oldestKey = probeSpriteCache.keys().next().value
      if (oldestKey !== undefined) probeSpriteCache.delete(oldestKey)
    }
    probeSpriteCache.set(trimmed, result)
    return result
  } catch {
    return null
  }
}

/**
 * 当舞台层尚未拆件绑定到骨骼挂点（attachments 为空），但正在采样动作帧（存在 pose 或 rootOffset）时，
 * 根据根骨骼位移与躯干/四肢关节摆角合成整图层的呼吸缩放、重心起伏与轻柔摇摆，确保单图层角色也能驱动出平滑帧序列。
 */
function computeUnattachedWholeSpriteMotion(
  pose?: Stage2dPose | null,
  rootOffset?: { x: number; y: number } | null
): { dx: number; dy: number; rotationDeg: number; scaleX: number; scaleY: number } {
  const dx = Number(rootOffset?.x) || 0
  const dy = Number(rootOffset?.y) || 0
  if (!pose || Object.keys(pose).length === 0) {
    if (Math.abs(dx) < 1e-4 && Math.abs(dy) < 1e-4) {
      return { dx: 0, dy: 0, rotationDeg: 0, scaleX: 1, scaleY: 1 }
    }
    const stretch = Math.min(0.06, Math.max(-0.06, -dy * 0.0022))
    const scaleY = 1 + stretch
    const scaleX = 1 / Math.sqrt(scaleY)
    return { dx, dy, rotationDeg: 0, scaleX, scaleY }
  }

  const chest = Number(pose.chest) || 0
  const pelvis = Number(pose.pelvis) || 0
  const neck = Number(pose.neck) || 0
  const head = Number(pose.head) || 0
  const hipL = Number(pose.hipL) || 0
  const hipR = Number(pose.hipR) || 0
  const shoulderL = Number(pose.shoulderL) || 0
  const shoulderR = Number(pose.shoulderR) || 0
  const elbowL = Number(pose.elbowL) || 0
  const elbowR = Number(pose.elbowR) || 0

  let rotationDeg =
    chest * 0.55 +
    pelvis * 0.65 +
    neck * 0.25 +
    head * 0.2 +
    (hipL + hipR) * 0.1 +
    (elbowL + elbowR) * 0.04
  rotationDeg = Math.min(12, Math.max(-12, rotationDeg))

  const armLift = (Math.abs(shoulderL) + Math.abs(shoulderR)) * 0.00025
  const breathStretch = -dy * 0.0022 - chest * 0.0035 + armLift
  const clampedStretch = Math.min(0.06, Math.max(-0.06, breathStretch))
  const scaleY = 1 + clampedStretch
  const scaleX = 1 / Math.sqrt(scaleY)

  return { dx, dy, rotationDeg, scaleX, scaleY }
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
  /** 骨骼装配：挂到关节的层按 FK 结果旋转落位（缺省为纯锚点落位） */
  rig?: Stage2dRig | null
  /** 摆姿（关节旋转覆盖值） */
  pose?: Stage2dPose | null
  /** 根节点附加位移（跳跃/呼吸起伏等） */
  rootOffset?: { x: number; y: number } | null
}): Promise<{ dataUrl: string; width: number; height: number }> {
  const scene = normalizeStage2dScene(input.state)
  const rigTransforms = input.rig
    ? computeStage2dAttachmentTransforms(input.rig, input.pose ?? null, input.rootOffset ?? null)
    : []
  const rigByLayer = new Map(rigTransforms.map((item) => [item.layerId, item]))
  // 全部层都要探源：部件层（frame）需要参考层（可能是隐藏的整图层）的计划几何
  const probes = await Promise.all(
    scene.layers.map((layer) =>
      layer.sourceUrl.trim() ? probeStageSprite(layer.sourceUrl) : Promise.resolve(null)
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
    // 隐藏层不绘出（整图层拆件后隐藏，仅保留其几何给部件层继承）
    if (!probe || !plan || !placement.layer.visible) return
    const rigged = rigByLayer.get(placement.layer.id)
    const opacity = placement.layer.opacity ?? 1
    const flipX = placement.layer.flipX === true
    if (!rigged) {
      const wholeMotion =
        rigByLayer.size === 0
          ? computeUnattachedWholeSpriteMotion(input.pose, input.rootOffset)
          : { dx: 0, dy: 0, rotationDeg: 0, scaleX: 1, scaleY: 1 }
      const hasWholeMotion =
        Math.abs(wholeMotion.dx) > 1e-4 ||
        Math.abs(wholeMotion.dy) > 1e-4 ||
        Math.abs(wholeMotion.rotationDeg) > 1e-4 ||
        Math.abs(wholeMotion.scaleX - 1) > 1e-4 ||
        Math.abs(wholeMotion.scaleY - 1) > 1e-4

      ctx.save()
      ctx.globalAlpha = opacity
      if (hasWholeMotion) {
        const pivotX = plan.dstX + plan.dstW / 2 + wholeMotion.dx
        const pivotY =
          (placement.layer.align.anchor === 'center'
            ? plan.dstY + plan.dstH / 2
            : plan.dstY + plan.dstH) + wholeMotion.dy
        const localTopY = placement.layer.align.anchor === 'center' ? -plan.dstH / 2 : -plan.dstH
        ctx.translate(pivotX, pivotY)
        if (Math.abs(wholeMotion.rotationDeg) > 1e-4) {
          ctx.rotate((wholeMotion.rotationDeg * Math.PI) / 180)
        }
        ctx.scale((flipX ? -1 : 1) * wholeMotion.scaleX, wholeMotion.scaleY)
        ctx.drawImage(
          probe.image,
          plan.bounds.x,
          plan.bounds.y,
          plan.bounds.width,
          plan.bounds.height,
          -plan.dstW / 2,
          localTopY,
          plan.dstW,
          plan.dstH
        )
      } else if (flipX) {
        ctx.translate(plan.dstX + plan.dstW / 2, plan.dstY + plan.dstH / 2)
        ctx.scale(-1, 1)
        ctx.drawImage(
          probe.image,
          plan.bounds.x,
          plan.bounds.y,
          plan.bounds.width,
          plan.bounds.height,
          -plan.dstW / 2,
          -plan.dstH / 2,
          plan.dstW,
          plan.dstH
        )
      } else {
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
      }
      ctx.restore()
      return
    }
    // 挂到骨骼的层：以自身枢轴（缺省 ground=底边中点 / center=中心）对准挂点，再随关节旋转
    const bw = Math.max(1, plan.bounds.width)
    const bh = Math.max(1, plan.bounds.height)
    const layerPivot = placement.layer.pivot
    const anchorX = layerPivot ? (layerPivot.x / bw) * plan.dstW : plan.dstW / 2
    const anchorY = layerPivot
      ? (layerPivot.y / bh) * plan.dstH
      : placement.layer.align.anchor === 'center'
        ? plan.dstH / 2
        : plan.dstH
    ctx.save()
    ctx.globalAlpha = opacity
    ctx.translate(rigged.x, rigged.y)
    ctx.rotate((rigged.rotation * Math.PI) / 180)
    if (flipX) ctx.scale(-1, 1)
    ctx.drawImage(
      probe.image,
      plan.bounds.x,
      plan.bounds.y,
      plan.bounds.width,
      plan.bounds.height,
      -anchorX,
      -anchorY,
      plan.dstW,
      plan.dstH
    )
    ctx.restore()
  })
  return {
    dataUrl: canvas.toDataURL('image/png'),
    width: scene.canvasWidth,
    height: scene.canvasHeight
  }
}
