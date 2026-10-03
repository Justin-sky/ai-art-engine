/**
 * 网格变形（液化 / 五官 / 身形）纯 TS 实现。
 *
 * 模型：
 * - `WarpControl` 是**编辑层**的意图（一个控制点把周围像素推向某处，或围绕某点做径向缩放）；
 * - `WarpMesh` 是把控制点烘焙成的 cols×rows 位移网格（归一化位移，IDW 加权 + 半径衰减）；
 * - 采样用「拉」式：`dst(x,y) = src(x - d(x,y))`，天然不会出现撕裂空洞；
 * - 预览与烘焙共用同一网格，保证「所见即所得」。
 */

import { type RgbaImage, sampleBilinear } from './kernels'

/** 位移与半径都用**归一化图像坐标**（0..1）；x 乘宽、y 乘高 */
export interface WarpControl {
  x: number
  y: number
  dx: number
  dy: number
  radius: number
  /**
   * 径向分量：>0 膨胀、<0 收缩；单位是「在 radius 处的归一化位移」。
   * 与 dx/dy 可同时存在（液化笔刷的推拉 + 膨胀的组合）。
   */
  radial?: number
}

export interface WarpMesh {
  cols: number
  rows: number
  /** 网格节点位移（归一化），长度 = cols*rows */
  dx: Float32Array
  dy: Float32Array
}

export const WARP_MESH_COLS = 40
export const WARP_MESH_ROWS = 40

function falloff(t: number): number {
  if (t >= 1) return 0
  if (t <= 0) return 1
  // 平滑衰减（3t² - 2t³ 的镜像），保证网格连续、不留硬边
  const s = 1 - t
  return s * s * (3 - 2 * s)
}

/**
 * 控制点 → 位移网格。
 * `aspect` = height/width，用于把距离度量做成长宽比无关（半径在像素空间是圆的）。
 */
export function buildWarpMesh(
  controls: readonly WarpControl[],
  cols = WARP_MESH_COLS,
  rows = WARP_MESH_ROWS,
  aspect = 1
): WarpMesh {
  const dx = new Float32Array(cols * rows)
  const dy = new Float32Array(cols * rows)
  if (controls.length === 0) return { cols, rows, dx, dy }

  for (let gy = 0; gy < rows; gy++) {
    const y = rows === 1 ? 0 : gy / (rows - 1)
    for (let gx = 0; gx < cols; gx++) {
      const x = cols === 1 ? 0 : gx / (cols - 1)
      let sx = 0
      let sy = 0
      let weight = 0
      for (const c of controls) {
        const ddx = (x - c.x) * 1
        const ddy = (y - c.y) * aspect
        const dist = Math.hypot(ddx, ddy)
        const r = Math.max(1e-5, c.radius * Math.max(0.35, aspect))
        const w = falloff(dist / r)
        if (w <= 0) continue
        sx += w * c.dx
        sy += w * c.dy
        if (c.radial) {
          const len = Math.max(1e-6, dist)
          const nx = (x - c.x) / len
          const ny = ((y - c.y) * aspect) / len / Math.max(1e-6, aspect)
          const magnitude = c.radial * w
          sx += nx * magnitude
          sy += ny * magnitude
        }
        weight += w
      }
      // IDW 归一：多个控制点重叠时取加权平均，避免位移叠加爆炸
      const norm = weight > 1 ? weight : 1
      dx[gy * cols + gx] = sx / norm
      dy[gy * cols + gx] = sy / norm
    }
  }
  return { cols, rows, dx, dy }
}

/** 网格双线性插值（归一化坐标） */
export function sampleWarpMesh(mesh: WarpMesh, x: number, y: number): [number, number] {
  const { cols, rows, dx, dy } = mesh
  const fx = Math.min(cols - 1, Math.max(0, x * (cols - 1)))
  const fy = Math.min(rows - 1, Math.max(0, y * (rows - 1)))
  const x0 = Math.floor(fx)
  const y0 = Math.floor(fy)
  const x1 = Math.min(cols - 1, x0 + 1)
  const y1 = Math.min(rows - 1, y0 + 1)
  const tx = fx - x0
  const ty = fy - y0
  const w00 = (1 - tx) * (1 - ty)
  const w10 = tx * (1 - ty)
  const w01 = (1 - tx) * ty
  const w11 = tx * ty
  const sample = (grid: Float32Array): number =>
    grid[y0 * cols + x0] * w00 +
    grid[y0 * cols + x1] * w10 +
    grid[y1 * cols + x0] * w01 +
    grid[y1 * cols + x1] * w11
  return [sample(dx), sample(dy)]
}

/** 网格是否真的会改变画面（全零则跳过整趟重采样） */
export function isWarpMeshIdentity(mesh: WarpMesh, epsilon = 1e-5): boolean {
  for (let i = 0; i < mesh.dx.length; i++) {
    if (Math.abs(mesh.dx[i]) > epsilon || Math.abs(mesh.dy[i]) > epsilon) return false
  }
  return true
}

/** 拉式重采样：dst(x,y) = src(x - d, y - d) */
export function warpImage(image: RgbaImage, mesh: WarpMesh): RgbaImage {
  if (isWarpMeshIdentity(mesh)) {
    return { data: new Uint8ClampedArray(image.data), width: image.width, height: image.height }
  }
  const { width: w, height: h } = image
  const out = new Uint8ClampedArray(image.data.length)
  const px = new Float32Array(4)
  for (let y = 0; y < h; y++) {
    const ny = y / Math.max(1, h - 1)
    for (let x = 0; x < w; x++) {
      const nx = x / Math.max(1, w - 1)
      const [dx, dy] = sampleWarpMesh(mesh, nx, ny)
      const sx = x - dx * (w - 1)
      const sy = y - dy * (h - 1)
      sampleBilinear(image, sx, sy, px)
      const i = (y * w + x) * 4
      out[i] = px[0]
      out[i + 1] = px[1]
      out[i + 2] = px[2]
      out[i + 3] = px[3]
    }
  }
  return { data: out, width: w, height: h }
}

/** 点集随同一个网格移动（关键点要跟着脸一起变形，后续蒙版才对得上） */
export function warpPoints(
  points: ReadonlyArray<readonly [number, number]>,
  mesh: WarpMesh
): Array<[number, number]> {
  return points.map(([x, y]) => {
    const [dx, dy] = sampleWarpMesh(mesh, x, y)
    return [x + dx, y + dy] as [number, number]
  })
}

// ── 液化笔画 → 控制点 ──────────────────────────────────────────

export interface LiquifyStrokeLike {
  mode?: string
  size: number
  strength: number
  points: ReadonlyArray<{ x: number; y: number; dx?: number; dy?: number }>
}

/**
 * 液化笔画 → 控制点。
 * - `push`：用笔画自带的位移（用户拖拽方向 × 力度）；
 * - `bloat` / `pinch`：围绕每个笔画点做径向缩放；
 * - `restore`：不产生位移（由编辑器把该区域的旧笔画摘掉来实现「还原」）。
 */
export function liquifyControlsFromStrokes(strokes: readonly LiquifyStrokeLike[]): WarpControl[] {
  const controls: WarpControl[] = []
  for (const stroke of strokes) {
    const strength = Math.min(1, Math.max(0, stroke.strength / 100))
    const radius = Math.max(0.004, stroke.size / 2)
    const mode = stroke.mode ?? 'push'
    if (mode === 'restore') continue
    for (const point of stroke.points) {
      if (mode === 'push') {
        const dx = (point.dx ?? 0) * strength
        const dy = (point.dy ?? 0) * strength
        if (dx === 0 && dy === 0) continue
        controls.push({ x: point.x, y: point.y, dx, dy, radius })
      } else if (mode === 'bloat') {
        controls.push({
          x: point.x,
          y: point.y,
          dx: 0,
          dy: 0,
          radius,
          radial: strength * radius * 0.6
        })
      } else if (mode === 'pinch') {
        controls.push({
          x: point.x,
          y: point.y,
          dx: 0,
          dy: 0,
          radius,
          radial: -strength * radius * 0.6
        })
      }
    }
  }
  return controls
}
