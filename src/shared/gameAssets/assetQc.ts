/**
 * 游戏资产规范质检（引擎就绪资产体检）纯函数地基（5.4「2D 游戏资产版」）。
 *
 * 与 `media.review`（视觉模型判画面语义质量）互补：这边判的是「能不能直接进引擎」
 * 的硬规范，全部本地算法完成、不耗模型——
 * - 抠图漏底：主体内部的透明孔洞（画布四周的外部空白不算）；
 * - 边缘白边 / 暗边：半透明过渡像素近白 / 近黑，即背景色残留与轮廓光晕；
 * - 半透明碎屑：四周全透明的孤立半透明噪点（抠图残留）；
 * - 主体贴边：alpha 外接框压住画布边，可能已被裁切；
 * - 空图与超大尺寸；
 * - 命名规范（可选，默认不查：存量中文名不应被刷屏）。
 *
 * 返工只做安全项：边缘去污染直接复用 `yoloCutout` 的 defringeRgba（对半透明像素
 * 按反混合公式恢复前景色）。孔洞 / 贴边 / 命名只报告不自动改——镂空可能是刻意设计，
 * 改画布与改名都会动到下游引用。
 *
 * 本模块只产出机器可读的 `code` 与 `metrics`，面向 Agent 的中文文案在工具层拼。
 */
import { defringeRgba } from '../yoloCutout'
import { extractAlphaBounds, type SpriteBounds } from './spriteGeometry'
import { extractAlphaPlane } from './stage2dAutoPart'

/** 质检问题码 */
export const ASSET_QC_ISSUE_CODES = [
  /** 主体内部透明孔洞（抠图漏底；刻意镂空也会命中） */
  'transparent-hole',
  /** 边缘半透明像素近白 / 近黑：背景色残留、白边、轮廓光晕 */
  'edge-fringe',
  /** 孤立半透明碎屑（抠图残留噪点） */
  'alpha-noise',
  /** 主体外接框贴住画布边：可能已被裁切 */
  'bounds-touch-edge',
  /** 整图全透明（没有可见内容） */
  'empty-image',
  /** 尺寸超上限 */
  'oversize',
  /** 命名不符合规范（可选检查项） */
  'naming'
] as const

export type AssetQcIssueCode = (typeof ASSET_QC_ISSUE_CODES)[number]

/** 严重度：error=资产不可用；warn=进引擎前应处理；info=建议 */
export type AssetQcSeverity = 'error' | 'warn' | 'info'

export interface AssetQcIssue {
  code: AssetQcIssueCode
  severity: AssetQcSeverity
  /** 该问题是否可自动返工（只有安全项为 true，当前仅边缘去污染） */
  fixable: boolean
  /** 支撑证据的数值（面积 / 计数 / 占比等，供 Agent 判断严重程度） */
  metrics: Record<string, number>
}

export interface AssetQcMetrics {
  width: number
  height: number
  /** alpha >= alphaOpaque 的完全遮盖像素数 */
  solidCount: number
  /** 完全遮盖像素占比 0~1 */
  coverage: number
  /** 主体外接框（全透明时为 null） */
  bounds: SpriteBounds | null
  /** 外接框面积占画布比 0~1 */
  boundsRatio: number
  /** 内部孔洞数（面积 >= holeMinArea） */
  holeCount: number
  /** 最大孔洞面积（像素） */
  holeLargestArea: number
  /** 孔洞总面积（像素） */
  holeTotalArea: number
  /** 半透明过渡像素数（0 < alpha < alphaOpaque） */
  translucentCount: number
  /** 半透明像素里近白的数量 */
  fringeLightCount: number
  /** 半透明像素里近黑的数量 */
  fringeDarkCount: number
  /** 半透明像素平均亮度（Rec.601，0~255） */
  translucentLuma: number
  /** 实心像素平均亮度（Rec.601，0~255） */
  solidLuma: number
  /** 边缘亮度偏移：translucentLuma − solidLuma（正=偏亮白边，负=偏暗黑边） */
  lumaDelta: number
  /** 四周全透明的孤立半透明像素数 */
  noiseCount: number
}

export interface AssetQcReport {
  issues: AssetQcIssue[]
  metrics: AssetQcMetrics
}

export interface AssetQcInput {
  /** RGBA 像素（长度需 >= width * height * 4） */
  data: Uint8Array | Uint8ClampedArray
  width: number
  height: number
}

export interface AssetQcOptions {
  /** 视为「有内容」的 alpha 下限 0~255（默认 8，与主体外接框同口径）：用于外接框与孔洞判定 */
  alphaSolid?: number
  /**
   * 视为「完全遮盖」的 alpha 下限 0~255（默认 250）：alpha 低于它即算半透明过渡像素。
   * 与 alphaSolid 是两件事——抠图件的羽化边缘 alpha 常在 100~200，属「有内容」但不遮盖，
   * 正是背景色残留发生的地方。
   */
  alphaOpaque?: number
  /** 孔洞判定：最小面积（像素，默认 16，滤掉抗锯齿噪点） */
  holeMinArea?: number
  /** 孔洞判定：最大孔洞占总像素比下限（默认 0.002） */
  holeRatio?: number
  /** 边缘白边判定：近白阈值 0~255（默认 236） */
  fringeLight?: number
  /** 边缘暗边判定：近黑阈值 0~255（默认 20） */
  fringeDark?: number
  /** 边缘白 / 暗边占半透明像素比例下限（默认 0.35） */
  fringeRatio?: number
  /**
   * 边缘亮度偏移下限（默认 32）：半透明过渡像素平均亮度 − 实心像素平均亮度。
   * 羽化边缘天然是「前景 × α + 背景 × (1−α)」的混合色，背景残留越多偏得越亮 / 越暗，
   * 因此这项比「纯白像素计数」更灵敏（纯白残留只是极端情形）。
   */
  fringeLumaDelta?: number
  /** 半透明像素少于此值不判边缘问题（默认 32） */
  minTranslucent?: number
  /** 碎屑判定：孤立半透明像素数下限（默认 24） */
  noiseMin?: number
  /** 尺寸上限（默认 8192，与统一画布上限一致） */
  maxSize?: number
}

export const DEFAULT_ASSET_QC_OPTIONS: Required<AssetQcOptions> = {
  alphaSolid: 8,
  alphaOpaque: 250,
  holeMinArea: 16,
  holeRatio: 0.002,
  fringeLight: 236,
  fringeDark: 20,
  fringeRatio: 0.35,
  fringeLumaDelta: 32,
  minTranslucent: 32,
  noiseMin: 24,
  maxSize: 8192
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

function clampInt(n: number, min: number, max: number): number {
  return Math.round(clamp(Number.isFinite(n) ? n : min, min, max))
}

/** 参数归一化：越界值夹取回可用区间，保证判定阈值全序可比 */
export function resolveAssetQcOptions(raw?: AssetQcOptions | null): Required<AssetQcOptions> {
  const base = { ...DEFAULT_ASSET_QC_OPTIONS, ...(raw ?? {}) }
  return {
    alphaSolid: clampInt(base.alphaSolid, 1, 255),
    alphaOpaque: clampInt(base.alphaOpaque, 1, 255),
    holeMinArea: Math.max(1, Math.trunc(base.holeMinArea)),
    holeRatio: clamp(base.holeRatio, 0, 1),
    fringeLight: clampInt(base.fringeLight, 0, 255),
    fringeDark: clampInt(base.fringeDark, 0, 255),
    fringeRatio: clamp(base.fringeRatio, 0, 1),
    fringeLumaDelta: Math.max(0, Number.isFinite(base.fringeLumaDelta) ? base.fringeLumaDelta : 32),
    minTranslucent: Math.max(0, Math.trunc(base.minTranslucent)),
    noiseMin: Math.max(1, Math.trunc(base.noiseMin)),
    maxSize: Math.max(16, Math.trunc(base.maxSize))
  }
}

export interface AlphaHolesResult {
  /** 面积 >= holeMinArea 的孔洞数 */
  count: number
  largestArea: number
  totalArea: number
  /** 最大孔洞左上角（画布坐标） */
  largestAt: { x: number; y: number } | null
}

/**
 * 求主体内部的透明孔洞。
 *
 * 做法：先把「与画布四边连通」的透明像素泛洪标记为外部（这部分是正常留白），
 * 剩余未标记的透明像素即被实心内容包围的孔洞，逐连通域累计面积。
 * 复杂度 O(width × height)，单趟遍历 + 复用队列。
 */
export function findAlphaHoles(
  alpha: ArrayLike<number>,
  width: number,
  height: number,
  options?: { alphaSolid?: number; holeMinArea?: number }
): AlphaHolesResult {
  const empty: AlphaHolesResult = { count: 0, largestArea: 0, totalArea: 0, largestAt: null }
  const w = Math.max(0, Math.floor(width))
  const h = Math.max(0, Math.floor(height))
  const total = w * h
  if (total <= 0 || alpha.length < total) return empty
  const solid = clampInt(options?.alphaSolid ?? DEFAULT_ASSET_QC_OPTIONS.alphaSolid, 1, 255)
  const minArea = Math.max(1, Math.trunc(options?.holeMinArea ?? 1))

  /** 0 = 未访问；1 = 已归入外部或孔洞 */
  const visited = new Uint8Array(total)
  const queue = new Int32Array(total)
  let head = 0
  let tail = 0

  const push = (index: number): void => {
    if (index < 0 || index >= total || visited[index] || alpha[index]! >= solid) return
    visited[index] = 1
    queue[tail++] = index
  }

  // 1) 四边泛洪：所有与边界连通的透明像素 = 外部背景
  for (let x = 0; x < w; x += 1) {
    push(x)
    push((h - 1) * w + x)
  }
  for (let y = 0; y < h; y += 1) {
    push(y * w)
    push(y * w + w - 1)
  }
  while (head < tail) {
    const index = queue[head++]!
    const x = index % w
    const y = (index - x) / w
    if (x > 0) push(index - 1)
    if (x + 1 < w) push(index + 1)
    if (y > 0) push(index - w)
    if (y + 1 < h) push(index + w)
  }

  // 2) 剩余未访问的透明像素 = 内部孔洞，逐域累计面积
  let count = 0
  let largestArea = 0
  let totalArea = 0
  let largestAt: { x: number; y: number } | null = null
  for (let start = 0; start < total; start += 1) {
    if (visited[start] || alpha[start]! >= solid) continue
    const startX = start % w
    const startY = (start - startX) / w
    head = 0
    tail = 0
    push(start)
    let area = 0
    while (head < tail) {
      const index = queue[head++]!
      area += 1
      const x = index % w
      const y = (index - x) / w
      if (x > 0) push(index - 1)
      if (x + 1 < w) push(index + 1)
      if (y > 0) push(index - w)
      if (y + 1 < h) push(index + w)
    }
    if (area < minArea) continue
    count += 1
    totalArea += area
    if (area > largestArea) {
      largestArea = area
      largestAt = { x: startX, y: startY }
    }
  }

  return { count, largestArea, totalArea, largestAt }
}

export interface AlphaEdgesResult {
  translucentCount: number
  lightCount: number
  darkCount: number
  noiseCount: number
  /** 半透明像素亮度之和（配合 translucentCount 求均值，量化边缘偏亮 / 偏暗） */
  translucentLumaSum: number
  solidCount: number
  solidLumaSum: number
}

/** 半透明过渡带统计：近白 / 近黑残留、孤立碎屑与亮度累计（单趟 O(n)） */
export function measureAlphaEdges(
  data: Uint8Array | Uint8ClampedArray,
  alpha: ArrayLike<number>,
  width: number,
  height: number,
  options?: {
    alphaSolid?: number
    alphaOpaque?: number
    fringeLight?: number
    fringeDark?: number
  }
): AlphaEdgesResult {
  const result: AlphaEdgesResult = {
    translucentCount: 0,
    lightCount: 0,
    darkCount: 0,
    noiseCount: 0,
    translucentLumaSum: 0,
    solidCount: 0,
    solidLumaSum: 0
  }
  const w = Math.max(0, Math.floor(width))
  const h = Math.max(0, Math.floor(height))
  const total = w * h
  if (total <= 0 || alpha.length < total || data.length < total * 4) return result
  const solid = clampInt(options?.alphaOpaque ?? DEFAULT_ASSET_QC_OPTIONS.alphaOpaque, 1, 255)
  const light = clampInt(options?.fringeLight ?? DEFAULT_ASSET_QC_OPTIONS.fringeLight, 0, 255)
  const dark = clampInt(options?.fringeDark ?? DEFAULT_ASSET_QC_OPTIONS.fringeDark, 0, 255)

  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const index = y * w + x
      const a = alpha[index]!
      if (a <= 0) continue
      const p = index * 4
      const r = data[p]!
      const g = data[p + 1]!
      const b = data[p + 2]!
      const luma = 0.299 * r + 0.587 * g + 0.114 * b
      if (a >= solid) {
        result.solidCount += 1
        result.solidLumaSum += luma
        continue
      }
      result.translucentCount += 1
      result.translucentLumaSum += luma
      if (r >= light && g >= light && b >= light) result.lightCount += 1
      else if (r <= dark && g <= dark && b <= dark) result.darkCount += 1
      const up = y > 0 ? alpha[index - w]! : 0
      const down = y + 1 < h ? alpha[index + w]! : 0
      const left = x > 0 ? alpha[index - 1]! : 0
      const right = x + 1 < w ? alpha[index + 1]! : 0
      if (up <= 0 && down <= 0 && left <= 0 && right <= 0) result.noiseCount += 1
    }
  }
  return result
}

const SEVERITY_ORDER: Record<AssetQcSeverity, number> = { error: 0, warn: 1, info: 2 }

/** 问题排序：error → warn → info，同级保持发现顺序 */
export function sortAssetQcIssues(issues: readonly AssetQcIssue[]): AssetQcIssue[] {
  return [...issues].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
}

/**
 * 资产规范体检：一次遍历全部维度，返回问题清单与度量。
 * 全透明 / 尺寸非法（0）时报 `empty-image` 并提前返回（其余维度无意义）。
 */
export function analyzeAssetQc(
  input: AssetQcInput,
  options?: AssetQcOptions | null
): AssetQcReport {
  const opts = resolveAssetQcOptions(options)
  const width = Math.max(0, Math.floor(input.width))
  const height = Math.max(0, Math.floor(input.height))
  const total = width * height
  const metrics: AssetQcMetrics = {
    width,
    height,
    solidCount: 0,
    coverage: 0,
    bounds: null,
    boundsRatio: 0,
    holeCount: 0,
    holeLargestArea: 0,
    holeTotalArea: 0,
    translucentCount: 0,
    fringeLightCount: 0,
    fringeDarkCount: 0,
    translucentLuma: 0,
    solidLuma: 0,
    lumaDelta: 0,
    noiseCount: 0
  }
  const issues: AssetQcIssue[] = []
  const alpha = total > 0 ? extractAlphaPlane(input.data, width, height) : null
  if (!alpha) {
    issues.push({
      code: 'empty-image',
      severity: 'error',
      fixable: false,
      metrics: { width, height, maxSize: opts.maxSize }
    })
    return { issues, metrics }
  }

  const bounds = extractAlphaBounds(input.data, width, height, { alphaMin: opts.alphaSolid })
  if (!bounds) {
    issues.push({
      code: 'empty-image',
      severity: 'error',
      fixable: false,
      metrics: { width, height, maxSize: opts.maxSize }
    })
    return { issues, metrics }
  }
  metrics.bounds = bounds
  metrics.boundsRatio = (bounds.width * bounds.height) / total

  // 漏底：主体内部透明孔洞（外部留白已由四边泛洪排除）
  const holes = findAlphaHoles(alpha, width, height, opts)
  metrics.holeCount = holes.count
  metrics.holeLargestArea = holes.largestArea
  metrics.holeTotalArea = holes.totalArea
  if (
    holes.count > 0 &&
    holes.largestArea >= opts.holeMinArea &&
    holes.largestArea / total >= opts.holeRatio
  ) {
    issues.push({
      code: 'transparent-hole',
      severity: 'warn',
      fixable: false,
      metrics: {
        count: holes.count,
        largestArea: holes.largestArea,
        totalArea: holes.totalArea,
        ratio: holes.largestArea / total
      }
    })
  }

  // 边缘：白边 / 暗边残留 + 孤立碎屑（实心像素统计也在这趟里一并拿到）
  const edges = measureAlphaEdges(input.data, alpha, width, height, opts)
  metrics.solidCount = edges.solidCount
  metrics.coverage = edges.solidCount / total
  metrics.translucentCount = edges.translucentCount
  metrics.fringeLightCount = edges.lightCount
  metrics.fringeDarkCount = edges.darkCount
  metrics.noiseCount = edges.noiseCount
  metrics.translucentLuma = edges.translucentCount
    ? edges.translucentLumaSum / edges.translucentCount
    : 0
  metrics.solidLuma = edges.solidCount ? edges.solidLumaSum / edges.solidCount : 0
  metrics.lumaDelta = metrics.translucentLuma - metrics.solidLuma
  const fringeTotal = edges.lightCount + edges.darkCount
  const fringeRatioValue = edges.translucentCount ? fringeTotal / edges.translucentCount : 0
  if (
    edges.translucentCount >= opts.minTranslucent &&
    (fringeRatioValue >= opts.fringeRatio || metrics.lumaDelta >= opts.fringeLumaDelta)
  ) {
    issues.push({
      code: 'edge-fringe',
      severity: 'warn',
      fixable: true,
      metrics: {
        translucent: edges.translucentCount,
        light: edges.lightCount,
        dark: edges.darkCount,
        ratio: fringeRatioValue,
        lumaDelta: metrics.lumaDelta
      }
    })
  }
  if (edges.noiseCount >= opts.noiseMin) {
    issues.push({
      code: 'alpha-noise',
      severity: 'info',
      fixable: false,
      metrics: { count: edges.noiseCount }
    })
  }

  // 贴边：外接框压住画布边，主体可能已被裁切
  if (
    bounds.x <= 0 ||
    bounds.y <= 0 ||
    bounds.x + bounds.width >= width ||
    bounds.y + bounds.height >= height
  ) {
    issues.push({
      code: 'bounds-touch-edge',
      severity: 'warn',
      fixable: false,
      metrics: {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        canvasWidth: width,
        canvasHeight: height
      }
    })
  }

  if (width > opts.maxSize || height > opts.maxSize) {
    issues.push({
      code: 'oversize',
      severity: 'warn',
      fixable: false,
      metrics: { width, height, maxSize: opts.maxSize }
    })
  }

  return { issues: sortAssetQcIssues(issues), metrics }
}

/** 命名禁止字符：空白 / 下划线 / 路径分隔符 / Windows 保留字符 */
const ASSET_NAME_BLOCKED_RE = /[\s_/\\:*?"<>|]/

/** 命名是否规范（kebab-case、无空白与保留字符；中文名合法，只在 checkNaming 时另判） */
export function isSafeAssetName(raw: string): boolean {
  const name = raw.trim()
  if (!name) return false
  if (ASSET_NAME_BLOCKED_RE.test(name)) return false
  return name === name.toLowerCase()
}

/** 由原图名推导规范名（kebab-case，去扩展名与非法字符；保留中日韩表意字） */
export function suggestAssetQcName(raw: string): string {
  return raw
    .trim()
    .replace(/\.(png|webp|jpe?g|gif)$/i, '')
    .replace(/[\s_]+/g, '-')
    .replace(/[^0-9a-zA-Z\u4e00-\u9fff-]+/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
}

/** 命名规范问题（仅 checkNaming 开启时由调用方使用；建议名见 suggestAssetQcName） */
export function checkAssetQcNaming(raw: string): AssetQcIssue | null {
  if (isSafeAssetName(raw)) return null
  return {
    code: 'naming',
    severity: 'info',
    fixable: false,
    metrics: { length: raw.trim().length }
  }
}

/**
 * 边缘去污染返工：就地修改 RGBA 的颜色通道（alpha 不变），
 * 按反混合公式剔除半透明像素里残留的背景色（白边 / 光晕）。
 * 这是当前唯一可自动执行的修复项——不改画布、不改 alpha，下游引用不受影响。
 */
export function applyAssetQcFringeFix(input: AssetQcInput, options?: { strength?: number }): void {
  const alpha = extractAlphaPlane(input.data, input.width, input.height)
  if (!alpha) return
  const total = input.width * input.height
  const normalized = new Float32Array(total)
  for (let i = 0; i < total; i += 1) normalized[i] = alpha[i]! / 255
  defringeRgba(
    input.data,
    normalized,
    input.width,
    input.height,
    options?.strength !== undefined ? { strength: options.strength } : {}
  )
}

export interface AssetQcSummary {
  /** 体检资产数 */
  total: number
  /** 有问题的资产数 */
  flagged: number
  errors: number
  warnings: number
  infos: number
  /** 可自动返工的问题码（去重，按 ASSET_QC_ISSUE_CODES 顺序） */
  fixable: AssetQcIssueCode[]
}

/** 批量体检汇总（供工具返回值与界面概览共用） */
export function summarizeAssetQc(reports: readonly AssetQcReport[]): AssetQcSummary {
  let errors = 0
  let warnings = 0
  let infos = 0
  let flagged = 0
  const fixable = new Set<AssetQcIssueCode>()
  for (const report of reports) {
    if (!report.issues.length) continue
    flagged += 1
    for (const issue of report.issues) {
      if (issue.severity === 'error') errors += 1
      else if (issue.severity === 'warn') warnings += 1
      else infos += 1
      if (issue.fixable) fixable.add(issue.code)
    }
  }
  return {
    total: reports.length,
    flagged,
    errors,
    warnings,
    infos,
    fixable: ASSET_QC_ISSUE_CODES.filter((code) => fixable.has(code))
  }
}
