/**
 * 立绘自动拆件（5.4「自动拆件」半自动工具的核心切分算法）。
 *
 * 思路：把一张整立绘的像素按其到「骨架槽骨段」（由关节位置驱动的折线）
 * 的最近距离归属到各部件槽，得到逐像素分区。之后渲染层按分区把整图裁剪
 * 成 N 张部件页，并把每件以 frame 共享几何 + pivot 枢轴挂回骨骼。
 *
 * 纯函数、无 DOM / 图像解码依赖：输入 alpha 平面 + 槽骨段端点，输出每个
 * 像素的部件归属（assignment）与每部件的裁剪外接框 / 枢轴。可单测。
 *
 * 交互校正（成熟化 v2）：自动分区后宽松衣物 / 肢体交叠常切不干净，本层
 * 额外提供不可变编辑纯函数——把矩形区域内的像素改投到指定槽（框选提边）
 * 或整槽擦除（抠为透明），以及按最新 assignment 重算部件清单；渲染层 UI
 * 据此做「半自动拆件精修」，而不必重写整张分区。
 */

export interface Stage2dAutoPoint {
  x: number
  y: number
}

export interface Stage2dAutoRect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * 一个部件槽 = 一条（或折成多段的）骨段折线 + 它绑定的关节。
 * 折线端点用「同一内容像素系」坐标（见 partition 输入说明）。
 */
export interface Stage2dAutoPartSlot {
  /** 槽 id（同时做部件层命名基础，须 ASCII 安全） */
  id: string
  /** 展示名（部件层名，如 头 / 上臂L） */
  name: string
  /** 该部件挂到的关节 id */
  jointId: string
  /**
   * 骨段折线端点（内容像素系）。折线的每一段都参与最近距离判定，
   * 至少 2 个端点。
   */
  polyline: Stage2dAutoPoint[]
}

export interface Stage2dAutoPartInput {
  /** 内容宽度（px） */
  width: number
  /** 内容高度（px） */
  height: number
  /**
   * alpha 平面：长度 = width * height，取 0~255。调用方负责从内容区
   * 图像提取（如 RGBA 的 a 通道）。alpha < alphaMin 的像素视为透明。
   */
  alpha: ArrayLike<number>
  /** alpha 判定阈值（默认 8） */
  alphaMin?: number
  /** 待切部件槽（按 id 判重，后者覆盖前者） */
  slots: Stage2dAutoPartSlot[]
}

export interface Stage2dAutoPartPiece {
  /** 槽 id（对应输入 slots 的 id） */
  id: string
  /** 部件层名 */
  name: string
  /** 挂到关节 id */
  jointId: string
  /** 部件裁剪外接框（内容像素系；内部件像素均在此框内） */
  crop: Stage2dAutoRect
  /** 枢轴（内容像素系）= 挂点关节在内容里的位置；切完用于设层 pivot */
  pivot: Stage2dAutoPoint
  /** 该部件掩码像素数 */
  pixelCount: number
  /**
   * 槽下标（= assignment 里该部件的取值；与 pieces 顺序一致地指回
   * 输入 slots 的索引）。交互编辑后仍用它匹配逐像素归属。
   */
  slotIndex: number
}

export interface Stage2dAutoPartResult {
  /** 逐像素部件归属：assignment[i] = 槽下标（对应 slots），未归属 -1 */
  assignment: Int32Array
  /** 有像素的部件（按下标对应 assignment） */
  pieces: Stage2dAutoPartPiece[]
}

/** 像素到线段的平方距离（垂足落在线段外时取近端点到端点的距离） */
function distSqToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): number {
  const abx = bx - ax
  const aby = by - ay
  const lenSq = abx * abx + aby * aby
  if (lenSq <= 1e-6) {
    const dx = px - ax
    const dy = py - ay
    return dx * dx + dy * dy
  }
  let t = ((px - ax) * abx + (py - ay) * aby) / lenSq
  t = Math.max(0, Math.min(1, t))
  const cx = ax + t * abx
  const cy = ay + t * aby
  const dx = px - cx
  const dy = py - cy
  return dx * dx + dy * dy
}

/**
 * 由「最新 assignment + 槽定义」重算有像素的部件清单。
 * assignment 值 = 输入槽下标（-1 = 未归属 / 已擦除）。
 * 纯函数：只读 assignment / slots，不做像素归属判断。
 */
export function recomputeStage2dAutoPieces(input: {
  width: number
  height: number
  assignment: Int32Array
  slots: Stage2dAutoPartSlot[]
}): { pieces: Stage2dAutoPartPiece[] } {
  const width = Math.max(1, Math.round(input.width))
  const height = Math.max(1, Math.round(input.height))
  const total = width * height
  const assignment = input.assignment
  const slotMap = new Map<string, Stage2dAutoPartSlot>()
  for (const slot of input.slots ?? []) {
    if (slot?.id && Array.isArray(slot.polyline) && slot.polyline.length >= 2) {
      slotMap.set(slot.id, slot)
    }
  }
  const slots = [...slotMap.values()]
  const slotCount = slots.length
  const pieces: Stage2dAutoPartPiece[] = []
  if (slotCount === 0 || total === 0) return { pieces }

  const pixelCount = new Array<number>(slotCount).fill(0)
  for (let i = 0; i < total; i += 1) {
    const s = assignment[i]
    if (s >= 0 && s < slotCount) pixelCount[s] += 1
  }
  for (let s = 0; s < slotCount; s += 1) {
    if (pixelCount[s] <= 0) continue
    const slot = slots[s]
    let minX = width
    let minY = height
    let maxX = -1
    let maxY = -1
    for (let i = 0; i < total; i += 1) {
      if (assignment[i] !== s) continue
      const px = i % width
      const py = (i / width) | 0
      if (px < minX) minX = px
      if (px > maxX) maxX = px
      if (py < minY) minY = py
      if (py > maxY) maxY = py
    }
    if (maxX < 0) continue
    // 枢轴 = 槽绑定的关节位置（polyline 首点语义即挂点关节），落到裁剪框内
    const anchorPt = slot.polyline[0]
    const pivot: Stage2dAutoPoint = {
      x: Math.min(Math.max(anchorPt.x, minX + 0.5), maxX + 0.5),
      y: Math.min(Math.max(anchorPt.y, minY + 0.5), maxY + 0.5)
    }
    pieces.push({
      id: slot.id,
      name: slot.name,
      jointId: slot.jointId,
      crop: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
      pivot,
      pixelCount: pixelCount[s],
      slotIndex: s
    })
  }
  return { pieces }
}

/**
 * 切分主函数：把内容里每个 alpha 像素归属到最近骨段槽。
 * 未覆盖像素（alpha 达标但离所有骨段都远）仍归到最近槽，避免丢像素。
 */
export function partitionStage2dAutoPart(input: Stage2dAutoPartInput): Stage2dAutoPartResult {
  const width = Math.max(1, Math.round(input.width))
  const height = Math.max(1, Math.round(input.height))
  const alphaMin = Number.isFinite(Number(input.alphaMin)) ? Number(input.alphaMin) : 8
  const slotMap = new Map<string, Stage2dAutoPartSlot>()
  for (const slot of input.slots ?? []) {
    if (slot?.id && Array.isArray(slot.polyline) && slot.polyline.length >= 2) {
      slotMap.set(slot.id, slot)
    }
  }
  const slots = [...slotMap.values()]
  const slotCount = slots.length
  const total = width * height
  const assignment = new Int32Array(total).fill(-1)
  if (slotCount === 0) return { assignment, pieces: [] }

  // 预展平折线段，加速逐像素判定
  const segs: Array<{ slot: number; ax: number; ay: number; bx: number; by: number }> = []
  for (let s = 0; s < slots.length; s += 1) {
    const poly = slots[s].polyline
    for (let i = 1; i < poly.length; i += 1) {
      segs.push({ slot: s, ax: poly[i - 1].x, ay: poly[i - 1].y, bx: poly[i].x, by: poly[i].y })
    }
  }
  const segCount = segs.length

  for (let i = 0; i < total; i += 1) {
    const a = input.alpha[i]
    if (!(Number(a) >= alphaMin)) continue
    const px = i % width
    const py = (i / width) | 0
    let bestSlot = -1
    let bestDist = Infinity
    for (let k = 0; k < segCount; k += 1) {
      const seg = segs[k]
      const d = distSqToSegment(px + 0.5, py + 0.5, seg.ax, seg.ay, seg.bx, seg.by)
      if (d < bestDist) {
        bestDist = d
        bestSlot = seg.slot
      }
    }
    if (bestSlot >= 0) assignment[i] = bestSlot
  }

  return {
    assignment,
    pieces: recomputeStage2dAutoPieces({ width, height, assignment, slots }).pieces
  }
}

/**
 * 框选提边 / 擦除（不可变编辑）：把矩形区域内的归属像素改投到 to 槽。
 * - to 取目标槽下标（分配进该部件）；取 -1 表示抠除（置为未归属 / 透明）。
 * - 只动「当前已归属」的像素：已擦除（-1）的像素不会被复活，避免把
 *   空背景 / 抗锯齿残留重新拉入任何部件。
 * - 返回新 Int32Array，不改输入。
 */
export function assignStage2dAutoPartRegion(input: {
  assignment: Int32Array
  width: number
  /** 区域（内容像素系）；超出画布部分自动夹取 */
  region: Stage2dAutoRect
  /** 目标槽下标；-1 = 抠除 */
  to: number
}): Int32Array {
  const width = Math.max(1, Math.round(input.width))
  const src = input.assignment
  const height = Math.max(1, Math.round(src.length / width))
  const out = new Int32Array(src.length)
  out.set(src)
  if (!Number.isFinite(input.to)) return out

  let x0 = Math.floor(input.region.x)
  let y0 = Math.floor(input.region.y)
  let x1 = Math.ceil(input.region.x + input.region.width)
  let y1 = Math.ceil(input.region.y + input.region.height)
  x0 = Math.max(0, Math.min(width, x0))
  x1 = Math.max(0, Math.min(width, x1))
  y0 = Math.max(0, Math.min(height, y0))
  y1 = Math.max(0, Math.min(height, y1))

  const to = Math.round(input.to)
  for (let y = y0; y < y1; y += 1) {
    const row = y * width
    for (let x = x0; x < x1; x += 1) {
      const idx = row + x
      const cur = src[idx]
      // -1（透明）不复活；目标相同则无需写
      if (cur >= 0 && cur !== to) out[idx] = to
    }
  }
  return out
}

/** 整槽擦除（不可变编辑）：把某个槽的全部像素置为未归属（透明）。 */
export function eraseStage2dAutoPartSlot(input: {
  assignment: Int32Array
  slot: number
}): Int32Array {
  const src = input.assignment
  const out = new Int32Array(src.length)
  const slot = Math.round(input.slot)
  if (!Number.isFinite(slot) || slot < 0) {
    out.set(src)
    return out
  }
  for (let i = 0; i < src.length; i += 1) {
    out[i] = src[i] === slot ? -1 : src[i]
  }
  return out
}

/** 内容 alpha 平面提取（RGBA → 单通道 alpha），宽高校验失败返回 null */
export function extractAlphaPlane(
  data: ArrayLike<number>,
  width: number,
  height: number
): Uint8Array | null {
  if (width <= 0 || height <= 0) return null
  const total = width * height
  if (!data || total * 4 > data.length) return null
  const out = new Uint8Array(total)
  for (let i = 0; i < total; i += 1) out[i] = data[i * 4 + 3]
  return out
}
