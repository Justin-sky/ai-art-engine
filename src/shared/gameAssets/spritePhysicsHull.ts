/**
 * 2D 精灵物理碰撞多边形（Collision Hull）与攻防判定框（Hurtbox / Hitbox / GroundSensor）纯函数层。
 *
 * 面向动作（ACT）、格斗（FTG）、平台跳跃（Platformer）、弹幕肉鸽（Survivor / STG）游戏：
 * 1. `extractSpriteCollisionHull`：从 RGBA 透明通道提取外轮廓点集，经 Andrew 单调链凸包 +
 *    面积保持顶点简化算法，生成顶点数可控（4~24 点，默认 8 点）的紧致碰撞多边形，
 *    同时给出像素坐标与相对锚点（bottom_center / center）偏移坐标，直通 Godot `CollisionPolygon2D` 与 Unity `PolygonCollider2D`；
 * 2. `deriveCombatBoxesFromAlpha`：基于水平质量分布自动分离「躯干核心受击框（Hurtbox）」、
 *    「前伸武器/刀光攻击判定框（Hitbox）」与「脚底着地传感器（GroundSensor）」。
 */

import { extractAlphaBounds, type SpriteBounds } from './spriteGeometry'

export interface Point2D {
  x: number
  y: number
}

export type PhysicsPivotMode = 'bottom_center' | 'center' | 'top_left'

export interface SpriteCollisionHullOptions {
  /** 视为不透明实体像素的最小 Alpha（0~255，默认 16） */
  alphaMin?: number
  /** 碰撞多边形最大顶点数（4~24，默认 8；引擎物理引擎推荐 <= 8~12 点以保证性能） */
  maxVertices?: number
  /** 坐标原点锚定方式（默认 bottom_center 脚底中心） */
  pivotMode?: PhysicsPivotMode
}

export interface SpriteCollisionHullResult {
  width: number
  height: number
  pivotMode: PhysicsPivotMode
  pivot: Point2D
  bounds: SpriteBounds
  /** 图像左上角像素系下的多边形顶点（顺时针） */
  verticesPx: Point2D[]
  /** 相对 pivot 锚点的像素偏移顶点（可直接喂给 Godot CollisionPolygon2D.polygon） */
  verticesRelativeToPivot: Point2D[]
  /** 归一化 [0..1] 顶点（供跨分辨率缩放） */
  verticesNormalized: Point2D[]
}

export interface CombatBoxesOptions {
  alphaMin?: number
  /** 默认角色朝向（当剪影完全对称时，攻击判定框默认朝该侧展开，默认 'right'） */
  facing?: 'right' | 'left'
}

export interface SpriteCombatBoxes {
  /** 躯干受击框（比外接框内缩，避免衣角/刀光被判定为受击） */
  hurtbox: SpriteBounds
  /** 武器/前伸攻击判定框 */
  hitbox: SpriteBounds
  /** 脚底地面接触检测条（Platformer 判定 is_on_floor） */
  groundSensor: SpriteBounds
  /** 自动识别出的朝向（根据像素质心与前伸武器不对称度推断） */
  inferredFacing: 'right' | 'left'
}

export interface SpritePhysicsManifest {
  schemaVersion: 1
  assetName: string
  width: number
  height: number
  hull: SpriteCollisionHullResult
  combatBoxes: SpriteCombatBoxes
  engineSnippets: {
    /** Godot 4 CollisionPolygon2D PackedVector2Array 文本 */
    godotPackedVector2Array: string
    /** Unity PolygonCollider2D 以单位（PPU=100）计的局部坐标 */
    unityLocalPointsPpu100: Point2D[]
  }
}

function cross(o: Point2D, a: Point2D, b: Point2D): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
}

function triangleArea2(a: Point2D, b: Point2D, c: Point2D): number {
  return Math.abs(cross(a, b, c))
}

/** Andrew 单调链求 2D 凸包（返回顺时针/逆时针闭合环路顶点，不含重复终点） */
export function computeConvexHull(points: Point2D[]): Point2D[] {
  if (points.length <= 3) return points.map((p) => ({ ...p }))
  const sorted = [...points].sort((a, b) => (a.x !== b.x ? a.x - b.x : a.y - b.y))

  const lower: Point2D[] = []
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) {
      lower.pop()
    }
    lower.push(p)
  }

  const upper: Point2D[] = []
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i]!
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) {
      upper.pop()
    }
    upper.push(p)
  }

  lower.pop()
  upper.pop()
  return [...lower, ...upper]
}

/**
 * Visvalingam-Whyatt 面积最小化迭代简化：每次移除构成的三角形面积最小的顶点，
 * 直至顶点数 <= maxVertices。
 */
export function simplifyPolygonToMaxVertices(hull: Point2D[], maxVertices: number): Point2D[] {
  const limit = Math.max(4, Math.min(24, Math.round(maxVertices)))
  const pts = hull.map((p) => ({ ...p }))
  while (pts.length > limit) {
    let minArea = Infinity
    let removeIdx = 0
    const n = pts.length
    for (let i = 0; i < n; i++) {
      const prev = pts[(i - 1 + n) % n]!
      const curr = pts[i]!
      const next = pts[(i + 1) % n]!
      const area = triangleArea2(prev, curr, next)
      if (area < minArea) {
        minArea = area
        removeIdx = i
      }
    }
    pts.splice(removeIdx, 1)
  }
  return pts
}

/**
 * 从透明 PNG 的 RGBA 缓冲区提取紧致物理碰撞多边形。
 */
export function extractSpriteCollisionHull(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  options?: SpriteCollisionHullOptions
): SpriteCollisionHullResult {
  const safeW = Math.max(1, Math.floor(width))
  const safeH = Math.max(1, Math.floor(height))
  const alphaMin = Math.max(1, Math.min(254, Math.round(options?.alphaMin ?? 16)))
  const maxVertices = Math.max(4, Math.min(24, Math.round(options?.maxVertices ?? 8)))
  const pivotMode: PhysicsPivotMode =
    options?.pivotMode === 'center' || options?.pivotMode === 'top_left'
      ? options.pivotMode
      : 'bottom_center'

  const bounds = extractAlphaBounds(rgba, safeW, safeH, { alphaMin }) ?? {
    x: 0,
    y: 0,
    width: safeW,
    height: safeH
  }

  const contour: Point2D[] = []
  for (let y = bounds.y; y < bounds.y + bounds.height; y++) {
    let firstX = -1
    let lastX = -1
    const rowOffset = y * safeW
    for (let x = bounds.x; x < bounds.x + bounds.width; x++) {
      const a = rgba[(rowOffset + x) * 4 + 3] ?? 0
      if (a >= alphaMin) {
        if (firstX < 0) firstX = x
        lastX = x
      }
    }
    if (firstX >= 0) {
      contour.push({ x: firstX, y })
      if (lastX > firstX) contour.push({ x: lastX, y })
    }
  }

  let verticesPx: Point2D[]
  if (contour.length < 4) {
    verticesPx = [
      { x: bounds.x, y: bounds.y },
      { x: bounds.x + bounds.width, y: bounds.y },
      { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
      { x: bounds.x, y: bounds.y + bounds.height }
    ]
  } else {
    const rawHull = computeConvexHull(contour)
    verticesPx = simplifyPolygonToMaxVertices(rawHull, maxVertices)
  }

  const pivot: Point2D =
    pivotMode === 'bottom_center'
      ? {
          x: Math.round(bounds.x + bounds.width / 2),
          y: bounds.y + bounds.height
        }
      : pivotMode === 'center'
        ? {
            x: Math.round(safeW / 2),
            y: Math.round(safeH / 2)
          }
        : { x: 0, y: 0 }

  const verticesRelativeToPivot = verticesPx.map((p) => ({
    x: p.x - pivot.x,
    y: p.y - pivot.y
  }))

  const verticesNormalized = verticesPx.map((p) => ({
    x: Number((p.x / safeW).toFixed(4)),
    y: Number((p.y / safeH).toFixed(4))
  }))

  return {
    width: safeW,
    height: safeH,
    pivotMode,
    pivot,
    bounds,
    verticesPx,
    verticesRelativeToPivot,
    verticesNormalized
  }
}

/**
 * 自动推算 2D 角色/怪物的躯干受击框（Hurtbox）、武器攻击框（Hitbox）与脚底地面传感器（GroundSensor）。
 */
export function deriveCombatBoxesFromAlpha(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  options?: CombatBoxesOptions
): SpriteCombatBoxes {
  const safeW = Math.max(1, Math.floor(width))
  const safeH = Math.max(1, Math.floor(height))
  const alphaMin = Math.max(1, Math.min(254, Math.round(options?.alphaMin ?? 16)))

  const bounds = extractAlphaBounds(rgba, safeW, safeH, { alphaMin }) ?? {
    x: 0,
    y: 0,
    width: safeW,
    height: safeH
  }

  // 计算 Alpha 加权水平质心，用于定位躯干核心与判断前伸武器朝向
  let sumX = 0
  let totalWeight = 0
  for (let y = bounds.y; y < bounds.y + bounds.height; y++) {
    const rowOffset = y * safeW
    for (let x = bounds.x; x < bounds.x + bounds.width; x++) {
      const a = rgba[(rowOffset + x) * 4 + 3] ?? 0
      if (a >= alphaMin) {
        sumX += x * a
        totalWeight += a
      }
    }
  }

  const bboxCenterX = bounds.x + bounds.width * 0.5
  const massCenterX = totalWeight > 0 ? sumX / totalWeight : bboxCenterX
  // 若外接框中心明显偏离躯干质心，说明武器/刀光向该侧大幅伸出
  const extDelta = bboxCenterX - massCenterX
  const inferredFacing: 'right' | 'left' =
    Math.abs(extDelta) > bounds.width * 0.04
      ? extDelta > 0
        ? 'right'
        : 'left'
      : (options?.facing ?? 'right')

  // Hurtbox：围绕躯干质心，宽度取主体框 56%，高度取主体框 78%（顶部留头顶余量，底部对齐脚底）
  const hurtW = Math.max(4, Math.round(bounds.width * 0.56))
  const hurtH = Math.max(4, Math.round(bounds.height * 0.78))
  const hurtX = Math.max(
    bounds.x,
    Math.min(bounds.x + bounds.width - hurtW, Math.round(massCenterX - hurtW * 0.5))
  )
  const hurtY = bounds.y + bounds.height - hurtH
  const hurtbox: SpriteBounds = { x: hurtX, y: hurtY, width: hurtW, height: hurtH }

  // Hitbox：沿朝向从躯干前侧向外延伸
  const hitW = Math.max(6, Math.round(bounds.width * 0.52))
  const hitH = Math.max(6, Math.round(bounds.height * 0.62))
  const hitY = bounds.y + Math.round(bounds.height * 0.16)
  const hitX =
    inferredFacing === 'right'
      ? Math.min(safeW - hitW, Math.round(massCenterX))
      : Math.max(0, Math.round(massCenterX - hitW))
  const hitbox: SpriteBounds = { x: hitX, y: hitY, width: hitW, height: hitH }

  // GroundSensor：位于脚底中心的高 4px 检测条
  const sensorW = Math.max(4, Math.round(hurtW * 0.7))
  const sensorH = Math.min(6, Math.max(2, Math.round(bounds.height * 0.05)))
  const sensorX = Math.round(hurtX + (hurtW - sensorW) * 0.5)
  const sensorY = Math.max(0, bounds.y + bounds.height - sensorH)
  const groundSensor: SpriteBounds = {
    x: sensorX,
    y: sensorY,
    width: sensorW,
    height: sensorH
  }

  return {
    hurtbox,
    hitbox,
    groundSensor,
    inferredFacing
  }
}

/**
 * 构建包含碰撞多边形与攻防判定框的完整 2D 物理 Manifest。
 */
export function buildSpritePhysicsManifest(
  assetName: string,
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  options?: SpriteCollisionHullOptions & CombatBoxesOptions
): SpritePhysicsManifest {
  const hull = extractSpriteCollisionHull(rgba, width, height, options)
  const combatBoxes = deriveCombatBoxesFromAlpha(rgba, width, height, options)

  const godotCoords = hull.verticesRelativeToPivot.flatMap((p) => [p.x, p.y]).join(', ')
  const godotPackedVector2Array = `PackedVector2Array(${godotCoords})`

  // Unity 2D 默认 PPU = 100 且 +Y 向上
  const unityLocalPointsPpu100 = hull.verticesRelativeToPivot.map((p) => ({
    x: Number((p.x / 100).toFixed(4)),
    y: Number((-p.y / 100).toFixed(4))
  }))

  return {
    schemaVersion: 1,
    assetName: (assetName || 'sprite').trim() || 'sprite',
    width: hull.width,
    height: hull.height,
    hull,
    combatBoxes,
    engineSnippets: {
      godotPackedVector2Array,
      unityLocalPointsPpu100
    }
  }
}
