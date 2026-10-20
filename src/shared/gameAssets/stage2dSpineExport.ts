/**
 * 2D 骨骼 → Spine skeleton.json 导出（5.4「Spine 骨骼拆件与装配数据」）。
 *
 * 把 stage.2d 编辑器里装配好的 2D 骨骼（stage2dRig 关节层级 + 部件挂点 +
 * 当前摆姿）翻译成 Spine 3.8 JSON 格式的骨架数据 + atlas 页元数据，
 * 供引擎 / Spine 编辑器继续消费。纯函数、无 DOM 依赖、可单测。
 *
 * 坐标系换算约定（与 stage2dRig / stage2dScene 同一 y-down 舞台像素系）：
 * - 目标：Spine 世界为 y-up。整体做「垂直翻转」映射 (x, y) → (x, -y)，
 *   旋转角取相反数；位图本身不翻转（Spine 渲染时图像顶部朝 +y，
 *   y-down 画布里人物头部朝上，翻转到 y-up 后同样朝 +y，视觉一致）。
 * - 关节：spine bone 局部坐标 = (joint.x, -joint.y)；局部旋转 =
 *   -(bind.rotation + pose 覆盖值)，即把当前摆姿并入 setup pose
 *   （编辑器所见即导出所得）。
 * - 根：新增顶层 bone "root" 承载 stage rig.root（(root.x, -root.y)），
 *   原本 parent=null 的关节挂到它下面，局部偏移沿用同一翻转规则。
 * - 部件：每个挂点生成一根「attach 子骨」挂在所属关节下，局部坐标与
 *   自身旋转携带挂点偏移 / 部件旋转（同样做翻转换算）；槽挂在该
 *   attach 骨上，region attachment 仅描述「图像中心相对挂点的偏移」
 *   （ground 锚点 = 图像底边中点为挂点 → 中心上移半高；center = 中心即挂点）。
 *   这样未来在 Spine 里旋转 attach 骨 = 绕部件锚点旋转，语义与编辑器一致。
 */

import {
  normalizeStage2dRig,
  type Stage2dJoint,
  type Stage2dPose,
  type Stage2dRig
} from './stage2dRig'
import { normalizeStage2dAction, type Stage2dAction, type Stage2dEasing } from './stage2dAction'

/** Spine JSON 宽松结构（可 JSON.stringify，键为 spine 规范名） */
export type SpineJson = Record<string, unknown>

/** 单个部件（挂点层）的导出入参：几何由渲染层按放置计划算好 */
export interface Stage2dSpinePartInput {
  /** 舞台层 id（只用于内部校验，不进 Spine 数据） */
  layerId: string
  /** 部件名（做槽 / 附件名的基础，会安全化并去重） */
  name: string
  /** 挂载关节 id（必须是 rig 里的关节） */
  jointId: string
  /** 该层锚点语义（ground=图像底边中点为挂点 / center=中心为挂点） */
  anchor: 'center' | 'ground'
  /**
   * 枢轴像素（可选，页图像坐标 y-down，原点左上）。拆件部件的挂点常在
   * 图内任意位置（如头部件挂在脖子、大腿挂在髋），center / ground 只是
   * (dstW/2, dstH/2) 与 (dstW/2, dstH) 两个特例；带枢轴时优先。
   */
  pivotX?: number
  /** 枢轴像素（页图像坐标 y-down，原点左上） */
  pivotY?: number
  /** 部件页图像像素宽（= plan.dstW） */
  dstWidth: number
  /** 部件页图像像素高（= plan.dstH） */
  dstHeight: number
  /** 挂点相对关节的局部偏移（stage y-down 像素） */
  offsetX: number
  /** 挂点相对关节的局部偏移（stage y-down 像素） */
  offsetY: number
  /** 部件自身旋转（stage y-down 角度制，叠加在关节世界旋转之上） */
  rotation: number
}

/** 单张 atlas 页元数据（渲染层据 pageWidth/Height 裁图、fileName 命名） */
export interface Stage2dSpinePageInfo {
  /** 槽名（同时作为 region 名与 attach 骨名后缀，spine 内唯一） */
  slotName: string
  /** 对应舞台层 id */
  layerId: string
  /** 槽挂到的 attach 骨名 */
  attachBone: string
  /** 页面文件像素宽（= 部件 dst 尺寸） */
  pageWidth: number
  /** 页面文件像素高（= 部件 dst 尺寸） */
  pageHeight: number
  /** region 图中心相对 attach 骨原点的偏移（Spine y-up） */
  regionX: number
  /** region 图中心相对 attach 骨原点的偏移（Spine y-up） */
  regionY: number
}

/** 纯函数构建结果：skeleton JSON 对象 + atlas 页元数据 */
export interface Stage2dSpineBuildResult {
  skeleton: SpineJson
  pages: Stage2dSpinePageInfo[]
}

/** 参与导出的单个动作条目 */
export interface Stage2dSpineActionEntry {
  name: string
  action: Stage2dAction
}

export interface Stage2dSpineBuildInput {
  /** 骨骼装配（含关节层级与部件挂点） */
  rig: Stage2dRig
  /** 当前摆姿（可选，并入关节 setup 旋转） */
  pose?: Stage2dPose | null
  /** 参与导出的部件（通常只传挂到关节且可见的层） */
  parts: Stage2dSpinePartInput[]
  /** 可选导出动作表：将每个动作编译为 Spine 3.8 animations.<name>.bones 时间轴 */
  actions?: Stage2dSpineActionEntry[] | null
  /** 元数据 */
  meta?: {
    /** 骨架名（进 skeleton.hash 的可读线索，非必填） */
    name?: string
    /** 帧率（默认 30） */
    fps?: number
  } | null
}

/** 角度收敛到 (-180, 180]（与 rig 层同一约定） */
function normalizeAngle(raw: number): number {
  if (!Number.isFinite(raw)) return 0
  let a = (((raw % 360) + 540) % 360) - 180
  if (a === -180) a = 180
  return a
}

/**
 * 安全化名字：Spine 的 bone / slot / 附件名建议用 ASCII 字母数字与下划线。
 * 非安全字符替换为下划线；为空时给回退名。
 */
export function stage2dSpineSafeName(raw: unknown, fallback = 'part'): string {
  const base = String(raw ?? '')
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/^[^A-Za-z]+/, (m) => (m ? `p${m}` : m))
    .replace(/^_+|_+$/g, '')
  return base || fallback
}

/** 骨架 hash（FNV-1a，仅按骨架名做简短可读线索，输入确定输出即确定） */
function makeHash(name: string): string {
  let h = 2166136261
  const s = name || 'stage2d'
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(36)
}

function spineCurveForEasing(easing?: Stage2dEasing): string | number[] | undefined {
  switch (easing) {
    case 'stepped':
      return 'stepped'
    case 'easeIn':
      return [0.42, 0, 1, 1]
    case 'easeOut':
      return [0, 0, 0.58, 1]
    case 'easeInOut':
      return [0.42, 0, 0.58, 1]
    case 'linear':
    default:
      return undefined
  }
}

/**
 * 将 Stage2dAction 编译为 Spine 3.8 单个 animation 对象：
 * - `bones.<jointId>.rotate`: 相对 setup pose 的角度增量（Spine y-up 取反）；
 * - `bones.root.translate`: 根节点相对 setup root 的位移增量（Spine y-up 对 y 取反）。
 */
export function buildStage2dSpineAnimation(input: {
  rig: Stage2dRig
  setupPose?: Stage2dPose | null
  action: Stage2dAction
}): SpineJson | null {
  const action = normalizeStage2dAction(input.action)
  if (!action.keyframes.length) return null
  const validJointIds = new Set(input.rig.joints.map((j) => j.id))
  const setupPose = input.setupPose ?? null

  // 收集在任意关键帧出现过或 setupPose 非 0 的关节
  const animatedJoints = new Set<string>()
  let hasRootTranslate = false
  for (const kf of action.keyframes) {
    for (const jointId of Object.keys(kf.pose)) {
      if (validJointIds.has(jointId)) animatedJoints.add(jointId)
    }
    if (kf.rootOffset && (Math.abs(kf.rootOffset.x) > 1e-6 || Math.abs(kf.rootOffset.y) > 1e-6)) {
      hasRootTranslate = true
    }
  }
  if (!animatedJoints.size && !hasRootTranslate) return null

  const bonesAnim: Record<string, SpineJson> = {}

  if (hasRootTranslate) {
    const translateTrack: SpineJson[] = action.keyframes.map((kf, idx) => {
      const dx = round1(kf.rootOffset?.x ?? 0)
      const dy = round1(-(kf.rootOffset?.y ?? 0))
      const entry: SpineJson = {
        time: roundTime(kf.time)
      }
      if (dx !== 0) entry.x = dx
      if (dy !== 0) entry.y = dy
      if (idx < action.keyframes.length - 1) {
        const curve = spineCurveForEasing(kf.easing)
        if (curve) entry.curve = curve
      }
      return entry
    })
    bonesAnim.root = { translate: translateTrack }
  }

  for (const jointId of animatedJoints) {
    const setupOffset = Number(setupPose?.[jointId]) || 0
    const rotateTrack: SpineJson[] = action.keyframes.map((kf, idx) => {
      const kfOffset = Number(kf.pose[jointId]) || 0
      // Spine rotate timeline 角度相对 bone 的 setup rotation；y-up 下旋转取反
      const angle = round1(normalizeAngle(-(kfOffset - setupOffset)))
      const entry: SpineJson = {
        time: roundTime(kf.time),
        angle
      }
      if (idx < action.keyframes.length - 1) {
        const curve = spineCurveForEasing(kf.easing)
        if (curve) entry.curve = curve
      }
      return entry
    })
    bonesAnim[jointId] = { rotate: rotateTrack }
  }

  return { bones: bonesAnim }
}

/**
 * 从 stage.2d 装配数据构建 Spine skeleton JSON 与页元数据。
 * 过滤规则：关节引用不存在 / 部件图像非法尺寸（dstWidth/Height 非正）一律剔除。
 */
export function buildStage2dSpineData(input: Stage2dSpineBuildInput): Stage2dSpineBuildResult {
  const rig = normalizeStage2dRig(input.rig)
  const pose = input.pose ?? null
  const fps = Math.max(1, Math.min(120, Math.round(input.meta?.fps ?? 30)))

  const jointsById = new Map(rig.joints.map((joint) => [joint.id, joint]))
  /** 关节有效旋转：bind + pose 覆盖（pose 不改写绑定值） */
  const effRotation = (joint: Stage2dJoint): number =>
    normalizeAngle(joint.rotation + (pose?.[joint.id] ?? 0))

  /** root 承载 stage 根锚点；parent=null 关节挂 root 下 */
  const bones: SpineJson[] = [
    {
      name: 'root',
      x: round1(rig.root.x),
      y: round1(-rig.root.y)
    }
  ]
  for (const joint of rig.joints) {
    const bone: SpineJson = { name: joint.id }
    if (joint.parentId && jointsById.has(joint.parentId)) {
      bone.parent = joint.parentId
    } else {
      bone.parent = 'root'
    }
    bone.x = round1(joint.x)
    bone.y = round1(-joint.y)
    const rot = normalizeAngle(-effRotation(joint))
    if (rot !== 0) bone.rotation = round1(rot)
    bones.push(bone)
  }

  /** 部件：名字去重 + attach 子骨 + 槽 + region 元数据 */
  const parts = (input.parts ?? [])
    .filter((part) => !!part && jointsById.has(part.jointId))
    .filter(
      (part) =>
        Number.isFinite(part.dstWidth) &&
        Number.isFinite(part.dstHeight) &&
        part.dstWidth > 0 &&
        part.dstHeight > 0
    )
  const usedSlot = new Set<string>()
  const slots: SpineJson[] = []
  const skinSlots: Record<string, Record<string, SpineJson>> = {}
  const pages: Stage2dSpinePageInfo[] = []
  for (const part of parts) {
    const dstW = Math.round(part.dstWidth)
    const dstH = Math.round(part.dstHeight)
    let slotName = stage2dSpineSafeName(part.name, 'part')
    let suffix = 2
    while (usedSlot.has(slotName)) {
      slotName = `${stage2dSpineSafeName(part.name, 'part')}-${suffix}`
      suffix += 1
    }
    usedSlot.add(slotName)
    const attachBone = `attach_${slotName}`

    // attach 子骨：携带挂点偏移（翻转）与部件自身旋转（翻转）
    const attach: SpineJson = {
      name: attachBone,
      parent: part.jointId,
      x: round1(part.offsetX),
      y: round1(-part.offsetY)
    }
    const attachRot = normalizeAngle(-part.rotation)
    if (attachRot !== 0) attach.rotation = round1(attachRot)
    bones.push(attach)

    slots.push({ name: slotName, bone: attachBone })

    // region 图中心相对 attach 骨原点：挂点 = 图内枢轴像素（anchor 语义只是
    // 枢轴的两个特例）。枢轴 (px,py)（y-down、原点左上）→ Spine y-up 偏移：
    //   regionX = dstW/2 - px （图中心相对枢轴的横向偏移，翻转不改变）
    //   regionY = py - dstH/2 （ground 特例 py=dstH → +dstH/2；center → 0）
    // 渲染层按放置计划把 plan.bounds 源区裁出并缩放到 pageWidth/pageHeight
    // 即得页图像。
    const pivotX = Number.isFinite(Number(part.pivotX)) ? Number(part.pivotX) : dstW / 2
    const pivotY = Number.isFinite(Number(part.pivotY))
      ? Number(part.pivotY)
      : part.anchor === 'center'
        ? dstH / 2
        : dstH
    const regionX = round1(dstW / 2 - pivotX)
    const regionY = round1(pivotY - dstH / 2)
    const region: SpineJson = {
      x: regionX,
      y: regionY,
      width: dstW,
      height: dstH
    }
    skinSlots[slotName] = { [slotName]: region }

    pages.push({
      slotName,
      layerId: part.layerId,
      attachBone,
      pageWidth: dstW,
      pageHeight: dstH,
      regionX,
      regionY
    })
  }

  const animations: Record<string, SpineJson> = {}
  const usedAnimNames = new Set<string>()
  for (const item of input.actions ?? []) {
    if (!item || !item.action) continue
    const compiled = buildStage2dSpineAnimation({
      rig,
      setupPose: pose,
      action: item.action
    })
    if (!compiled) continue
    const baseName = stage2dSpineSafeName(item.name || item.action.name, 'anim')
    let animName = baseName
    let suffix = 2
    while (usedAnimNames.has(animName)) {
      animName = `${baseName}-${suffix}`
      suffix += 1
    }
    usedAnimNames.add(animName)
    animations[animName] = compiled
  }

  const skeleton: SpineJson = {
    skeleton: {
      spine: '3.8.99',
      hash: makeHash(input.meta?.name ?? 'stage2d'),
      images: '',
      fps,
      audio: ''
    },
    bones,
    slots,
    ik: [],
    transform: [],
    paths: [],
    skins: [{ name: 'default', attachments: skinSlots }],
    animations
  }

  return { skeleton, pages }
}

function round1(n: number): number {
  const r = Math.round(n * 10) / 10
  return r === 0 ? 0 : r
}

function roundTime(n: number): number {
  const r = Math.round(n * 1000) / 1000
  return r === 0 ? 0 : r
}

/** 由页元数据生成 Spine .atlas 文本（每部件一页，页内单 region） */
export function buildStage2dSpineAtlasText(input: {
  /** 页面清单：fileName 由渲染层负责（含目录/前缀），regionName 默认 slotName */
  pages: Array<{ fileName: string; slotName: string; width: number; height: number }>
}): string {
  const chunks: string[] = []
  for (const page of input.pages ?? []) {
    const w = Math.max(1, Math.round(page.width))
    const h = Math.max(1, Math.round(page.height))
    chunks.push(
      [
        `${page.fileName}`,
        `size: ${w}, ${h}`,
        'format: RGBA8888',
        'filter: Linear, Linear',
        'repeat: none',
        `${page.slotName}`,
        '  rotate: false',
        '  xy: 0, 0',
        `  size: ${w}, ${h}`,
        `  orig: ${w}, ${h}`,
        '  offset: 0, 0',
        '  index: -1'
      ].join('\n')
    )
  }
  return chunks.join('\n\n')
}

/** 单张合并纹理图集中的部件排布项 */
export interface Stage2dSpinePackedRegion extends Stage2dSpinePageInfo {
  /** 在合并图集中的左上角像素 X */
  x: number
  /** 在合并图集中的左上角像素 Y */
  y: number
  /** 对应输入 pages 的原始下标 */
  pageIndex: number
}

export interface Stage2dSpineAtlasPackResult {
  width: number
  height: number
  padding: number
  regions: Stage2dSpinePackedRegion[]
}

/**
 * 将多个部件页通过 Shelf 算法紧密拼合为单张纹理图集布局（带透明间距防采样溢色）。
 */
export function packStage2dSpineAtlas(
  pages: Stage2dSpinePageInfo[],
  options?: { padding?: number; maxWidth?: number }
): Stage2dSpineAtlasPackResult {
  const padding = Math.max(0, Math.round(options?.padding ?? 2))
  if (!pages.length) {
    return { width: 1, height: 1, padding, regions: [] }
  }
  const indexed = pages.map((page, pageIndex) => ({
    ...page,
    pageWidth: Math.max(1, Math.round(page.pageWidth)),
    pageHeight: Math.max(1, Math.round(page.pageHeight)),
    pageIndex
  }))

  const totalArea = indexed.reduce(
    (sum, p) => sum + (p.pageWidth + padding * 2) * (p.pageHeight + padding * 2),
    0
  )
  const maxPartW = indexed.reduce((m, p) => Math.max(m, p.pageWidth + padding * 2), 1)
  const targetWidth = Math.max(
    maxPartW,
    Math.min(options?.maxWidth ?? 2048, Math.ceil(Math.sqrt(totalArea * 1.25)))
  )

  // 按高度降序排列以提升 Shelf 紧致度，打包后再恢复原 pages 顺序
  const sorted = [...indexed].sort(
    (a, b) => b.pageHeight - a.pageHeight || a.pageIndex - b.pageIndex
  )
  let cursorX = padding
  let cursorY = padding
  let rowHeight = 0
  let usedWidth = 1
  const placed: Stage2dSpinePackedRegion[] = []

  for (const item of sorted) {
    if (cursorX > padding && cursorX + item.pageWidth + padding > targetWidth) {
      cursorX = padding
      cursorY += rowHeight + padding
      rowHeight = 0
    }
    placed.push({
      ...item,
      x: cursorX,
      y: cursorY
    })
    cursorX += item.pageWidth + padding
    if (cursorX > usedWidth) usedWidth = cursorX
    if (item.pageHeight > rowHeight) rowHeight = item.pageHeight
  }

  const usedHeight = Math.max(1, cursorY + rowHeight + padding)
  placed.sort((a, b) => a.pageIndex - b.pageIndex)

  return {
    width: Math.max(1, usedWidth),
    height: usedHeight,
    padding,
    regions: placed
  }
}

/** 由单张合并图集布局生成标准 Spine .atlas 文本（单张 PNG 承载全部部件 region） */
export function buildStage2dSpinePackedAtlasText(input: {
  fileName: string
  pack: Stage2dSpineAtlasPackResult
}): string {
  const w = Math.max(1, Math.round(input.pack.width))
  const h = Math.max(1, Math.round(input.pack.height))
  const header = [
    input.fileName,
    `size: ${w}, ${h}`,
    'format: RGBA8888',
    'filter: Linear, Linear',
    'repeat: none'
  ]
  const blocks = input.pack.regions.map((reg) =>
    [
      reg.slotName,
      '  rotate: false',
      `  xy: ${reg.x}, ${reg.y}`,
      `  size: ${reg.pageWidth}, ${reg.pageHeight}`,
      `  orig: ${reg.pageWidth}, ${reg.pageHeight}`,
      '  offset: 0, 0',
      '  index: -1'
    ].join('\n')
  )
  return [...header, ...blocks].join('\n')
}
