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

export interface Stage2dSpineBuildInput {
  /** 骨骼装配（含关节层级与部件挂点） */
  rig: Stage2dRig
  /** 当前摆姿（可选，并入关节 setup 旋转） */
  pose?: Stage2dPose | null
  /** 参与导出的部件（通常只传挂到关节且可见的层） */
  parts: Stage2dSpinePartInput[]
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
      (part) => Number.isFinite(part.dstWidth) && Number.isFinite(part.dstHeight) && part.dstWidth > 0 && part.dstHeight > 0
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

    // region 图中心相对 attach 骨原点：center=挂点即中心；ground=图像底边中点
    // 为挂点 → 中心上移半高（Spine y-up 的 +y）。渲染层按放置计划把
    // plan.bounds 源区裁出并缩放到 pageWidth/pageHeight 即得页图像。
    const regionX = 0
    const regionY = part.anchor === 'center' ? 0 : round1(dstH / 2)
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
    animations: {}
  }

  return { skeleton, pages }
}

function round1(n: number): number {
  const r = Math.round(n * 10) / 10
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
        '  index: 0'
      ].join('\n')
    )
  }
  return chunks.join('\n\n')
}
