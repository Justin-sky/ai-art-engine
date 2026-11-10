<script setup lang="ts">
/**
 * Machinations 底部结果与调试面板 + 播放控制栏（1:1 复刻官方下方面板）：
 *  - Results 标签页：左侧 PLAYS 列表 + Compare、中间多序列折线图（含 Monte Carlo P10~P90 置信带）+ 右侧 STEP N 数值表、
 *    底部横向滚动的节点自然语言趋势卡片（Summary + 各追踪节点的 Sparkline 与趋势文案）
 *  - Runtime Debugger 标签页：逐步事件流表格，点击事件定位画布节点并跳转到对应 Step
 *  - 最底部 Transport Bar：Reset / Play / Step / Speed / Play again / Steps 输入 / 进度滑杆 / Forecast
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  analyzeMxEconomyHealth,
  autoSolveMxCurveTarget,
  canQuickFixMxDiagnosticFinding,
  extractMxPlayableHudSnapshot,
  extractMxTunableEdgeNumericValue,
  mxNodeColor,
  runMx2DParameterMatrix,
  runMxGoalSeek,
  runMxParameterSweep,
  suggestMxBalancerTargetForFinding,
  summarizeMxSeries,
  type Mx2DMatrixCell,
  type Mx2DMatrixResult,
  type MxCurveTargetSolution,
  type MxDiagnosticFinding,
  type MxGoalSeekMetric,
  type MxGoalSeekResult,
  type MxParamSweepResult,
  type MxPlayableActionCard,
  type MxPlayableHudSnapshot,
  type MxPlayableMacroStep,
  type MxSeriesSummary,
  type MxTunableKind
} from '@shared/gameAssets'
import { useMxStudioStore } from './mxStudioStore'
import MxNumericalWorkbenchPanel from './MxNumericalWorkbenchPanel.vue'

const { t, locale } = useI18n()
const isEn = computed(() =>
  String(locale.value || '')
    .toLowerCase()
    .startsWith('en')
)
const s = useMxStudioStore()

const compareMode = ref(false)
const showForecastBand = ref(true)
const showTrendCardsStrip = ref(true)
const debugFilterStep = ref<number | ''>('')
const dockHeight = ref(320)
const isResizingDock = ref(false)
let resizeCleanup: (() => void) | null = null

watch(
  () => s.resultsTab.value,
  (tab) => {
    if (tab === 'playable' && dockHeight.value < 360) {
      dockHeight.value = 380
    }
  }
)

function startResizeDock(ev: PointerEvent): void {
  if (ev.button !== 0) return
  ev.preventDefault()
  const startY = ev.clientY
  const startHeight = s.resultsOpen.value ? dockHeight.value : 0
  isResizingDock.value = true

  const onMove = (moveEv: PointerEvent): void => {
    const deltaY = startY - moveEv.clientY
    const nextHeight = startHeight + deltaY
    if (nextHeight < 80) {
      s.resultsOpen.value = false
      return
    }
    if (!s.resultsOpen.value) {
      s.resultsOpen.value = true
    }
    const maxAllowed = typeof window !== 'undefined' ? Math.max(340, window.innerHeight - 165) : 720
    dockHeight.value = Math.max(150, Math.min(maxAllowed, Math.round(nextHeight)))
  }

  const onUp = (): void => {
    isResizingDock.value = false
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    window.removeEventListener('pointercancel', onUp)
    resizeCleanup = null
  }

  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  window.addEventListener('pointercancel', onUp)
  resizeCleanup = onUp
}

function toggleDockHeight(): void {
  if (!s.resultsOpen.value) {
    s.resultsOpen.value = true
    dockHeight.value = 340
    return
  }
  const maxAllowed = typeof window !== 'undefined' ? Math.max(420, window.innerHeight - 200) : 560
  dockHeight.value = dockHeight.value < 420 ? Math.min(540, maxAllowed) : 280
}

onBeforeUnmount(() => {
  resizeCleanup?.()
})

const trackedNodes = computed(() =>
  s.doc.value.nodes.filter(
    (n) => (n.kind === 'pool' || n.kind === 'register') && n.tracked !== false
  )
)

const currentSnapshots = computed<Array<Record<string, number>>>(() => {
  if (s.activeRun.value) return s.activeRun.value.snapshots
  if (s.liveSnapshots.value.length) return s.liveSnapshots.value
  return []
})

const maxSteps = computed(() => {
  if (s.activeRun.value) return s.activeRun.value.stepsRun
  return s.doc.value.settings.steps
})

const inspectedStep = computed(() => {
  if (s.hoverStep.value !== null) return Math.min(s.hoverStep.value, maxSteps.value)
  return Math.min(s.playStep.value, maxSteps.value)
})

interface SeriesItem {
  id: string
  label: string
  color: string
  values: number[]
  summary: MxSeriesSummary
  currentVal: number
}

const MAX_CHART_SERIES = 32

const CHART_SERIES_PALETTE = [
  '#3b82f6', // Blue
  '#10b981', // Emerald Green
  '#f97316', // Orange
  '#a855f7', // Purple
  '#ef4444', // Red
  '#06b6d4', // Cyan
  '#eab308', // Yellow Gold
  '#ec4899', // Hot Pink
  '#84cc16', // Lime
  '#6366f1', // Indigo
  '#14b8a6', // Teal
  '#f43f5e', // Rose
  '#0284c7', // Sky
  '#d97706', // Ochre
  '#c026d3', // Fuchsia
  '#65a30d' // Olive
]

function parseHexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '').trim()
  if (clean.length === 3) {
    return [
      parseInt(clean[0]! + clean[0]!, 16) || 0,
      parseInt(clean[1]! + clean[1]!, 16) || 0,
      parseInt(clean[2]! + clean[2]!, 16) || 0
    ]
  }
  return [
    parseInt(clean.slice(0, 2), 16) || 0,
    parseInt(clean.slice(2, 4), 16) || 0,
    parseInt(clean.slice(4, 6), 16) || 0
  ]
}

function rgbColorDistance(a: string, b: string): number {
  const [r1, g1, b1] = parseHexToRgb(a)
  const [r2, g2, b2] = parseHexToRgb(b)
  return Math.hypot(r1 - r2, g1 - g2, b1 - b2)
}

/**
 * 为每个被追踪的图表节点分配高区分度颜色（两阶段 RGB 感知色差校验）：
 * - 第一阶段保留各节点首次出现的显著区分原色（RGB 欧氏距离 >= 80）；
 * - 第二阶段为发生撞色或近似色（如两个相近紫、两个相近蓝）的节点从高对比调色盘分配与所有已用颜色距离最大的颜色。
 */
const nodeDistinctColorMap = computed<Map<string, string>>(() => {
  const map = new Map<string, string>()
  const assignedColors: string[] = []
  const deferredNodes: string[] = []
  const MIN_DIST = 80

  for (const n of trackedNodes.value) {
    const raw = (n.color || mxNodeColor(s.doc.value, n) || '#3b82f6').trim()
    const tooClose = assignedColors.some((u) => rgbColorDistance(raw, u) < MIN_DIST)
    if (!tooClose) {
      assignedColors.push(raw)
      map.set(n.id, raw)
    } else {
      deferredNodes.push(n.id)
    }
  }

  for (const nodeId of deferredNodes) {
    let bestCand = CHART_SERIES_PALETTE[0]!
    let bestMinDist = -1
    for (const cand of CHART_SERIES_PALETTE) {
      const minDist = assignedColors.length
        ? Math.min(...assignedColors.map((u) => rgbColorDistance(cand, u)))
        : 999
      if (minDist >= MIN_DIST) {
        bestCand = cand
        bestMinDist = minDist
        break
      }
      if (minDist > bestMinDist) {
        bestMinDist = minDist
        bestCand = cand
      }
    }
    assignedColors.push(bestCand)
    map.set(nodeId, bestCand)
  }
  return map
})

function seriesColorForNode(nodeId: string): string {
  return nodeDistinctColorMap.value.get(nodeId) ?? '#3b82f6'
}

const chartScaleMode = ref<'raw' | 'norm'>('raw')

// 底层序列快照与统计摘要（不依赖 hoverStep / inspectedStep，避免鼠标移动或拖拽时重复遍历快照与重算趋势摘要）
const baseSeriesList = computed<Omit<SeriesItem, 'currentVal'>[]>(() => {
  const snaps = currentSnapshots.value
  const allNodes = trackedNodes.value
  let nodesToBuild = allNodes
  if (allNodes.length > MAX_CHART_SERIES) {
    const priorityIds = new Set<string>([
      ...(s.focusedSeriesId.value ? [s.focusedSeriesId.value] : []),
      ...s.selection.nodes
    ])
    const prioritized = allNodes.filter((n) => priorityIds.has(n.id))
    const rest = allNodes.filter((n) => !priorityIds.has(n.id))
    nodesToBuild = [...prioritized, ...rest].slice(0, MAX_CHART_SERIES)
  }
  return nodesToBuild.map((n) => {
    const vals = snaps.length
      ? snaps.map((snap) => Number(snap[n.id] ?? 0))
      : [Number(s.displayValues.value?.[n.id] ?? n.initial ?? 0)]
    const summary = summarizeMxSeries(vals)
    return {
      id: n.id,
      label: n.label || n.id,
      color: seriesColorForNode(n.id),
      values: vals,
      summary
    }
  })
})

const seriesList = computed<SeriesItem[]>(() => {
  const step = inspectedStep.value
  return baseSeriesList.value.map((sr) => {
    const idx = Math.min(step, sr.values.length - 1)
    return {
      ...sr,
      currentVal: Number((sr.values[idx] ?? 0).toFixed(2))
    }
  })
})

const visibleSeries = computed<SeriesItem[]>(() => {
  const focusId = s.focusedSeriesId.value
  if (!focusId) return seriesList.value
  return [...seriesList.value].sort((a, b) => {
    if (a.id === focusId) return 1
    if (b.id === focusId) return -1
    return 0
  })
})

function isSeriesHighlighted(id: string): boolean {
  return Boolean(s.focusedSeriesId.value && s.focusedSeriesId.value === id)
}

function isSeriesDimmed(id: string): boolean {
  return Boolean(s.focusedSeriesId.value && s.focusedSeriesId.value !== id)
}

function toggleFocusSeries(id: string): void {
  const next = s.focusedSeriesId.value === id ? '' : id
  s.focusedSeriesId.value = next
  if (next) s.select([next])
}

const changedNodesCount = computed(
  () => seriesList.value.filter((sr) => sr.summary.changes > 0).length
)

// ───────── SVG 折线图几何计算 ─────────
const CW = 560
const CH = 148
const PAD_L = 36
const PAD_R = 12
const PAD_T = 10
const PAD_B = 22
const PW = CW - PAD_L - PAD_R
const PH = CH - PAD_T - PAD_B

function getSingleSeriesBounds(sr: SeriesItem): { min: number; max: number } {
  let min = Infinity
  let max = -Infinity
  for (const v of sr.values) {
    if (v < min) min = v
    if (v > max) max = v
  }
  if (showForecastBand.value && s.forecast.value) {
    const f = s.forecast.value.series.find((x) => x.nodeId === sr.id)
    if (f) {
      for (const v of f.p90) if (v > max) max = v
      for (const v of f.p10) if (v < min) min = v
    }
  }
  if (!Number.isFinite(min)) min = 0
  if (!Number.isFinite(max)) max = 10
  if (max === min) {
    min = Math.min(0, min)
    max = min + 10
  }
  return { min, max }
}

// 拖拽曲线靶心期间锁定的 Y 轴量程（保证鼠标与靶心 1:1 绝对跟手，并在拖过顶边时平滑向上扩容）
const dragLockedYBounds = ref<{ min: number; max: number } | null>(null)

const yBounds = computed(() => {
  if (dragLockedYBounds.value) {
    return dragLockedYBounds.value
  }
  // 当用户聚焦某条图例序列时，Y 轴自动适配该序列自身的 [min, max]，使其波形与下方趋势卡片完全一致，不被大数值节点压平
  if (s.focusedSeriesId.value) {
    const focused = baseSeriesList.value.find((sr) => sr.id === s.focusedSeriesId.value)
    if (focused) {
      const b = getSingleSeriesBounds(focused as SeriesItem)
      if (curveDragActive.value) {
        // 开启拖拽反推时预留充足上方操作余量，无需在拖动中途动态缩放坐标轴
        b.max = Math.max(b.max * 1.25, b.min + 10)
        if (Number.isFinite(curveTargetVal.value)) {
          b.min = Math.min(b.min, curveTargetVal.value)
          b.max = Math.max(b.max, curveTargetVal.value * 1.22)
        }
        if (curveDualPinActive.value && Number.isFinite(curveTargetVal2.value)) {
          b.min = Math.min(b.min, curveTargetVal2.value)
          b.max = Math.max(b.max, curveTargetVal2.value * 1.22)
        }
      }
      if (activeCurveSolution.value?.predictedSeries.length) {
        for (const pv of activeCurveSolution.value.predictedSeries) {
          if (pv < b.min) b.min = pv
          if (pv > b.max * 0.92) b.max = Math.max(b.max, pv * 1.12)
        }
      }
      if (b.max === b.min) b.max = b.min + 10
      return b
    }
  }
  let min = 0
  let max = 10
  for (const sr of baseSeriesList.value) {
    for (const v of sr.values) {
      if (v < min) min = v
      if (v > max) max = v
    }
  }
  if (showForecastBand.value && s.forecast.value) {
    for (const sr of baseSeriesList.value) {
      const f = s.forecast.value.series.find((x) => x.nodeId === sr.id)
      if (!f) continue
      for (const v of f.p90) if (v > max) max = v
      for (const v of f.p10) if (v < min) min = v
    }
  }
  if (max === min) max = min + 10
  return { min, max }
})

function xAt(step: number, totalSteps: number): number {
  const denom = Math.max(1, totalSteps)
  return PAD_L + (step / denom) * PW
}

function yAt(val: number): number {
  const { min, max } = yBounds.value
  return PAD_T + PH - ((val - min) / Math.max(1e-6, max - min)) * PH
}

function yAtForSeries(sr: Pick<SeriesItem, 'id' | 'values'>, val: number): number {
  // 1) 若选中了某条图例：选中的折线按自身真实 yBounds 撑满显示，未选中的背景折线各自归一化在视口内作为参考上下文
  if (s.focusedSeriesId.value) {
    if (sr.id === s.focusedSeriesId.value) {
      return yAt(val)
    }
    const { min, max } = getSingleSeriesBounds(sr as SeriesItem)
    return PAD_T + 4 + (PH - 8) - ((val - min) / Math.max(1e-6, max - min)) * (PH - 8)
  }
  // 2) 总览 Summary 模式下：若开启独立趋势归一化（Norm），每条折线按自身 [min, max] 映射，与下方卡片波形一致
  if (chartScaleMode.value === 'norm') {
    const { min, max } = getSingleSeriesBounds(sr as SeriesItem)
    return PAD_T + 2 + (PH - 4) - ((val - min) / Math.max(1e-6, max - min)) * (PH - 4)
  }
  // 3) 默认统一绝对量纲（Y1）
  return yAt(val)
}

function polylinePointsForSeries(
  sr: Pick<SeriesItem, 'id' | 'values'>,
  values = sr.values,
  totalSteps = maxSteps.value
): string {
  const total = Math.max(1, totalSteps)
  return values
    .map((v, i) => `${xAt(i, total).toFixed(1)},${yAtForSeries(sr, v).toFixed(1)}`)
    .join(' ')
}

// 预计算并缓存所有背景折线的 SVG points 字符串（拖拽或悬停期间 yBounds 不变时完全零重算）
const seriesPolylineMap = computed<Record<string, string>>(() => {
  const total = Math.max(1, maxSteps.value)
  const out: Record<string, string> = {}
  for (const sr of baseSeriesList.value) {
    out[sr.id] = polylinePointsForSeries(sr, sr.values, total)
  }
  return out
})

function forecastAreaPath(nodeId: string): string {
  const f = s.forecast.value?.series.find((x) => x.nodeId === nodeId)
  if (!f || !f.p10.length) return ''
  const sr = seriesList.value.find((x) => x.id === nodeId)
  const total = Math.max(1, f.p10.length - 1)
  const mapY = (v: number) => (sr ? yAtForSeries(sr, v) : yAt(v))
  const top = f.p90.map((v, i) => `${xAt(i, total).toFixed(1)},${mapY(v).toFixed(1)}`)
  const bot = [...f.p10].reverse().map((v, idx) => {
    const i = f.p10.length - 1 - idx
    return `${xAt(i, total).toFixed(1)},${mapY(v).toFixed(1)}`
  })
  return `M ${top.join(' L ')} L ${bot.join(' L ')} Z`
}

function sparklinePoints(values: number[]): string {
  if (!values.length) return ''
  let min = Infinity
  let max = -Infinity
  for (const v of values) {
    if (v < min) min = v
    if (v > max) max = v
  }
  const span = Math.max(1e-6, max - min)
  const n = Math.max(1, values.length - 1)
  return values
    .map((v, i) => `${((i / n) * 68 + 2).toFixed(1)},${(26 - ((v - min) / span) * 22).toFixed(1)}`)
    .join(' ')
}

interface CursorIntersectionPill {
  id: string
  color: string
  valText: string
  cx: number
  cy: number
  labelY: number
  rectX: number
  rectY: number
  pillW: number
  pillH: number
  textX: number
  side: 'left' | 'right'
  highlighted: boolean
}

const inspectedIntersectionLabels = computed<CursorIntersectionPill[]>(() => {
  if (isDraggingCurvePin.value) return []
  const step = inspectedStep.value
  const cx = xAt(step, maxSteps.value)
  const canUseLeft = cx >= PAD_L + 44
  const canUseRight = cx <= CW - PAD_R - 44

  const activeList = visibleSeries.value.filter((sr) => !isSeriesDimmed(sr.id))
  const rawItems = activeList.map((sr) => {
    const rawVal = sr.values[Math.min(step, sr.values.length - 1)] ?? 0
    const rounded = Math.round(rawVal * 100) / 100
    const valText =
      Math.abs(rounded) >= 10000
        ? `${(rounded / 1000).toFixed(1).replace(/\.0$/, '')}k`
        : String(rounded)
    const cy = yAtForSeries(sr, rawVal)
    return {
      id: sr.id,
      color: sr.color,
      valText,
      cx,
      cy,
      labelY: cy,
      side: (canUseRight ? 'right' : 'left') as 'left' | 'right',
      highlighted: isSeriesHighlighted(sr.id)
    }
  })

  rawItems.sort((a, b) => a.cy - b.cy)

  // 当两条折线在交点处高度接近且左右两侧均有空间时，自动交错分列在虚线左右两侧，避免数字胶囊重叠
  if (canUseLeft && canUseRight) {
    for (let i = 1; i < rawItems.length; i++) {
      const prev = rawItems[i - 1]!
      const cur = rawItems[i]!
      if (Math.abs(cur.cy - prev.cy) < 12.5 && prev.side === 'right') {
        cur.side = 'left'
      }
    }
  }

  // 对同侧标签执行一维纵向防重叠松弛
  const minY = PAD_T + 5.5
  const maxY = CH - PAD_B - 5.5
  const minGap = 12
  for (const side of ['right', 'left'] as const) {
    const group = rawItems.filter((it) => it.side === side)
    if (!group.length) continue
    for (let i = 0; i < group.length; i++) {
      group[i]!.labelY = Math.max(minY, Math.min(maxY, group[i]!.cy))
      if (i > 0) {
        group[i]!.labelY = Math.max(group[i]!.labelY, group[i - 1]!.labelY + minGap)
      }
    }
    if (group[group.length - 1]!.labelY > maxY) {
      group[group.length - 1]!.labelY = maxY
      for (let i = group.length - 2; i >= 0; i--) {
        group[i]!.labelY = Math.min(group[i]!.labelY, group[i + 1]!.labelY - minGap)
      }
      if (group[0]!.labelY < minY) {
        group[0]!.labelY = minY
      }
    }
  }

  return rawItems.map((it) => {
    const pillH = 11.5
    const pillW = Math.max(18, Math.round(it.valText.length * 5.4 + 8))
    const rectX = it.side === 'right' ? it.cx + 6 : it.cx - 6 - pillW
    const rectY = it.labelY - pillH / 2
    const textX = rectX + pillW / 2
    return {
      ...it,
      rectX,
      rectY,
      pillW,
      pillH,
      textX
    }
  })
})

function onChartMouseMove(e: MouseEvent): void {
  if (isDraggingCurvePin.value) return
  const svg = e.currentTarget as SVGSVGElement
  const rect = svg.getBoundingClientRect()
  const relX = ((e.clientX - rect.left) / rect.width) * CW
  const ratio = Math.max(0, Math.min(1, (relX - PAD_L) / PW))
  const steps = Math.max(1, maxSteps.value)
  s.hoverStep.value = Math.round(ratio * steps)
}

function onChartClick(): void {
  if (s.hoverStep.value !== null) {
    s.playStep.value = s.hoverStep.value
  }
}

function formatTrendLine1(sum: MxSeriesSummary): string {
  switch (sum.pattern) {
    case 'flat':
      return t('mx.trend.flat', { val: sum.final })
    case 'rose':
      return t('mx.trend.rose', { from: sum.initial, to: sum.final })
    case 'fell':
      return t('mx.trend.fell', { from: sum.initial, to: sum.final })
    case 'rose_then_fell':
      return t('mx.trend.peaked', { max: sum.max, step: sum.maxStep, to: sum.final })
    case 'fell_then_rose':
      return t('mx.trend.fellThenRose', { min: sum.min, step: sum.minStep, to: sum.final })
    default:
      return t('mx.trend.volatile', { min: sum.min, max: sum.max, to: sum.final })
  }
}

function formatTrendLine2(sum: MxSeriesSummary): string {
  const sign = sum.avgDelta > 0 ? `+${sum.avgDelta}` : `${sum.avgDelta}`
  return t('mx.trend.avgChanges', { avg: sign, changes: sum.changes })
}

function cycleSpeed(): void {
  const speeds = [1, 2, 4, 0.5]
  const cur = s.doc.value.settings.speed || 1
  const next = speeds[(speeds.indexOf(cur) + 1) % speeds.length] ?? 1
  s.mutate((d) => {
    d.settings.speed = next
  }, 'speed')
}

function onStepsInput(e: Event): void {
  const raw = (e.target as HTMLInputElement).value.trim()
  if (!raw) return
  const num = Number(raw)
  if (!Number.isFinite(num) || num < 1) return
  s.setSteps(num)
}

function onStepsCommit(e: Event): void {
  const input = e.target as HTMLInputElement
  const num = Number(input.value)
  const next = Number.isFinite(num) && num >= 1 ? Math.min(500, Math.round(num)) : 20
  s.setSteps(next)
  input.value = String(s.doc.value.settings.steps)
}

function onPlaysInput(e: Event): void {
  const raw = (e.target as HTMLInputElement).value.trim()
  if (!raw) return
  const num = Number(raw)
  if (!Number.isFinite(num) || num < 1) return
  s.forecastRuns.value = Math.min(500, Math.round(num))
  if (num >= 5) {
    s.setForecastRuns(num)
    showForecastBand.value = true
  }
}

function onPlaysCommit(e: Event): void {
  const input = e.target as HTMLInputElement
  const num = Number(input.value)
  const next = Number.isFinite(num) && num >= 5 ? Math.min(500, Math.round(num)) : 50
  s.setForecastRuns(next)
  showForecastBand.value = true
  input.value = String(s.forecastRuns.value)
}

function toggleCompareRun(id: string): void {
  const list = s.compareRunIds.value
  if (list.includes(id)) {
    s.compareRunIds.value = list.filter((x) => x !== id)
  } else {
    s.compareRunIds.value = [...list, id]
  }
}

function onRunAllCompare(): void {
  s.runAllScenariosCompare()
  compareMode.value = true
}

const healthReport = computed(() => {
  void s.topologyRevision.value
  return analyzeMxEconomyHealth(s.peekDoc(), s.activeRun.value)
})

const healthIssueCount = computed(
  () =>
    healthReport.value.findings.filter((f) => f.severity === 'warn' || f.severity === 'critical')
      .length
)

const fixableIssueCount = computed(
  () => healthReport.value.findings.filter((f) => canQuickFixMxDiagnosticFinding(f)).length
)

function formatFindingText(f: MxDiagnosticFinding): string {
  switch (f.kind) {
    case 'topology_error':
      return `⚠ ${f.nodeLabel ?? ''}`
    case 'inflation':
      if (f.id === 'diag_inflation_nosink') {
        return t('mx.diag.inflationNoSink', {
          produced: f.value ?? 0,
          net: f.secondaryValue ?? 0
        })
      }
      return t('mx.diag.inflation', {
        ratio: f.value ?? 1,
        net: f.secondaryValue ?? 0
      })
    case 'deflation':
      return t('mx.diag.deflation', {
        ratio: f.value ?? 1,
        net: f.secondaryValue ?? 0
      })
    case 'starved_converter':
      return t('mx.diag.starvedConverter', {
        node: f.nodeLabel ?? f.nodeId ?? '',
        count: f.value ?? 0,
        pct: f.secondaryValue ?? 0,
        step: f.step ?? 1
      })
    case 'pool_capped':
      return t('mx.diag.poolCapped', {
        node: f.nodeLabel ?? f.nodeId ?? '',
        cap: f.value ?? 0,
        step: f.step ?? 1
      })
    case 'pool_depleted':
      return t('mx.diag.poolDepleted', {
        node: f.nodeLabel ?? f.nodeId ?? '',
        step: f.step ?? 1
      })
    case 'exponential_runaway':
      return t('mx.diag.exponentialRunaway', {
        node: f.nodeLabel ?? f.nodeId ?? '',
        mult: f.value ?? 2,
        final: f.secondaryValue ?? 0
      })
    case 'idle_node':
      return t('mx.diag.idleNode', {
        node: f.nodeLabel ?? f.nodeId ?? '',
        val: f.value ?? 0
      })
    case 'balanced':
    default:
      return t('mx.diag.balanced', {
        ratio: f.value ?? 1,
        net: f.secondaryValue ?? 0
      })
  }
}

function jumpToFinding(f: MxDiagnosticFinding): void {
  if (f.step !== undefined) s.playStep.value = f.step
  if (f.nodeId) {
    s.select([f.nodeId])
    s.focusedSeriesId.value = f.nodeId
  }
}

function onQuickFixFinding(f: MxDiagnosticFinding): void {
  s.applyDiagnosticQuickFix(f, t('mx.diag.autoSinkLabel'))
}

function onQuickFixAllFindings(): void {
  s.applyAllDiagnosticQuickFixes(t('mx.diag.autoSinkLabel'))
}

function openFindingInBalancer(f: MxDiagnosticFinding): void {
  const hint = suggestMxBalancerTargetForFinding(s.peekDoc(), f)
  if (hint) {
    const key = `${hint.kind}:${hint.id}`
    if (tunableOptions.value.some((o) => o.key === key)) {
      selectedTunableKey.value = key
    }
    tuneMin.value = hint.minVal
    tuneMax.value = hint.maxVal
  }
  balancerMode.value = 'goal_seek'
  goalMetric.value = 'health_score'
  goalTargetValue.value = 100
  s.resultsTab.value = 'balancer'
  s.resultsOpen.value = true
  executeGoalSeek()
}

const debugEvents = computed(() => {
  const evs = s.activeRun.value ? s.activeRun.value.events : s.liveEvents.value
  if (debugFilterStep.value === '') return evs.slice(-200)
  return evs.filter((e) => e.step === Number(debugFilterStep.value))
})

const nodeNameById = computed(() => new Map(s.doc.value.nodes.map((n) => [n.id, n.label || n.id])))

function nodeName(id?: string): string {
  if (!id) return '-'
  return nodeNameById.value.get(id) ?? id
}

// ═════════════ 逆向目标求解器 (Goal-Seek) & 敏感度扫描 (Parameter Sweep) & 2D 热力矩阵 ═════════════
const balancerMode = ref<'goal_seek' | 'sweep' | 'matrix'>('goal_seek')

interface TunableOption {
  key: string
  kind: MxTunableKind
  id: string
  label: string
  currentVal: number
  influencer?: boolean
}

const tunableOptions = computed<TunableOption[]>(() => {
  const list: TunableOption[] = []
  for (const p of s.doc.value.params ?? []) {
    list.push({
      key: `param:${p.name}`,
      kind: 'param',
      id: p.name,
      label: `[Param] ${p.name} (${p.value})`,
      currentVal: Number(p.value) || 0
    })
  }
  for (const e of s.doc.value.edges) {
    const src = nodeName(e.from)
    const tgt = e.targetEdgeId ? `#${e.targetEdgeId}` : nodeName(e.to)
    const numVal = extractMxTunableEdgeNumericValue(e)
    const isInf = Boolean(e.influencer)
    list.push({
      key: `edge:${e.id}`,
      kind: 'edge',
      id: e.id,
      label: `${isInf ? '★ ' : ''}[Edge] ${src} -> ${tgt} (${e.formula || '1'})`,
      currentVal: Number.isFinite(numVal) ? numVal : 1,
      influencer: isInf
    })
  }
  for (const n of s.doc.value.nodes) {
    if (n.kind === 'pool' || n.kind === 'register') {
      const isInf = Boolean(n.influencer)
      list.push({
        key: `node_initial:${n.id}`,
        kind: 'node_initial',
        id: n.id,
        label: `${isInf ? '★ ' : ''}[Init] ${n.label} (${n.initial ?? 0})`,
        currentVal: Number(n.initial ?? 0),
        influencer: isInf
      })
    }
  }
  list.sort((a, b) => Number(Boolean(b.influencer)) - Number(Boolean(a.influencer)))
  return list
})

const selectedTunableKey = ref('')
const activeTunable = computed<TunableOption | null>(() => {
  const opts = tunableOptions.value
  if (!opts.length) return null
  return opts.find((o) => o.key === selectedTunableKey.value) ?? opts[0]
})

const selectedTunableYKey = ref('')
const activeTunableY = computed<TunableOption | null>(() => {
  const opts = tunableOptions.value
  if (!opts.length) return null
  return opts.find((o) => o.key === selectedTunableYKey.value) ?? opts[Math.min(1, opts.length - 1)]
})

const tuneMin = ref(0)
const tuneMax = ref(20)
const tuneMinY = ref(0)
const tuneMaxY = ref(20)
const goalMetric = ref<MxGoalSeekMetric>('health_score')
const goalTargetNodeId = ref('')
const goalTargetStep = ref(30)
const goalTargetValue = ref(50)
const sweepSamples = ref(9)

const activeTargetNodeId = computed(() => {
  if (goalTargetNodeId.value && trackedNodes.value.some((n) => n.id === goalTargetNodeId.value)) {
    return goalTargetNodeId.value
  }
  return trackedNodes.value[0]?.id ?? ''
})

const goalSeekRes = ref<MxGoalSeekResult | null>(null)
const sweepRes = ref<MxParamSweepResult | null>(null)
const matrixRes = ref<Mx2DMatrixResult | null>(null)
const selectedMatrixCell = ref<Mx2DMatrixCell | null>(null)

function onSelectTunableChange(ev: Event): void {
  const val = (ev.target as HTMLSelectElement).value
  selectedTunableKey.value = val
  const item = tunableOptions.value.find((o) => o.key === val)
  if (item) {
    const base = Math.max(1, Math.abs(item.currentVal))
    tuneMin.value = Math.max(0, Math.round((item.currentVal - base * 2) * 10) / 10)
    tuneMax.value = Math.round((item.currentVal + base * 3 + 5) * 10) / 10
  }
}

function onSelectTunableYChange(ev: Event): void {
  const val = (ev.target as HTMLSelectElement).value
  selectedTunableYKey.value = val
  const item = tunableOptions.value.find((o) => o.key === val)
  if (item) {
    const base = Math.max(1, Math.abs(item.currentVal))
    tuneMinY.value = Math.max(0, Math.round((item.currentVal - base * 2) * 10) / 10)
    tuneMaxY.value = Math.round((item.currentVal + base * 3 + 5) * 10) / 10
  }
}

function executeGoalSeek(): void {
  const tItem = activeTunable.value
  if (!tItem) return
  goalSeekRes.value = runMxGoalSeek(s.doc.value, {
    variableKind: tItem.kind,
    variableId: tItem.id,
    minVal: Number(tuneMin.value),
    maxVal: Number(tuneMax.value),
    goalMetric: goalMetric.value,
    goalNodeId: activeTargetNodeId.value,
    atStep: Number(goalTargetStep.value) || s.doc.value.settings.steps,
    targetValue: Number(goalTargetValue.value),
    samples: 12,
    runsPerSample: 4
  })
}

function applyBestGoalSeek(): void {
  if (!goalSeekRes.value) return
  s.applyTunableValue(
    goalSeekRes.value.variableKind,
    goalSeekRes.value.variableId,
    goalSeekRes.value.bestValue
  )
}

function executeSweep(): void {
  const tItem = activeTunable.value
  if (!tItem) return
  sweepRes.value = runMxParameterSweep(s.doc.value, {
    variableKind: tItem.kind,
    variableId: tItem.id,
    minVal: Number(tuneMin.value),
    maxVal: Number(tuneMax.value),
    stepsCount: Math.max(3, Math.min(25, Number(sweepSamples.value) || 9)),
    runsPerPoint: 4
  })
}

function applySweepPoint(val: number): void {
  if (!sweepRes.value) return
  s.applyTunableValue(sweepRes.value.variableKind, sweepRes.value.variableId, val)
}

function executeMatrix(): void {
  const tx = activeTunable.value
  const ty = activeTunableY.value
  if (!tx || !ty) return
  const res = runMx2DParameterMatrix(s.doc.value, {
    varXKind: tx.kind,
    varXId: tx.id,
    minX: Number(tuneMin.value),
    maxX: Number(tuneMax.value),
    stepsX: 6,
    varYKind: ty.kind,
    varYId: ty.id,
    minY: Number(tuneMinY.value),
    maxY: Number(tuneMaxY.value),
    stepsY: 5,
    metric: goalMetric.value === 'end_step' ? 'end_step' : 'node_value',
    targetNodeId: activeTargetNodeId.value,
    runsPerCell: 2
  })
  matrixRes.value = res
  selectedMatrixCell.value = res.cells[0]?.[0] ?? null
}

function applyMatrixCell(cell: Mx2DMatrixCell): void {
  const res = matrixRes.value
  if (!res) return
  s.applyTunablePair(res.varXKind, res.varXId, cell.xVal, res.varYKind, res.varYId, cell.yVal)
}

function matrixCellStyle(val: number): Record<string, string> {
  const res = matrixRes.value
  if (!res) return {}
  const span = Math.max(1e-6, res.maxValue - res.minValue)
  const ratio = Math.max(0, Math.min(1, (val - res.minValue) / span))
  // Hue 210 (cool blue) -> 145 (emerald sweet spot) -> 25 (warm amber)
  const hue = Math.round(210 - ratio * 180)
  return {
    background: `hsla(${hue}, 78%, 46%, 0.25)`,
    borderColor: `hsla(${hue}, 78%, 46%, 0.55)`
  }
}

function sweepSeriesPolyline(nodeId: string): string {
  const res = sweepRes.value
  if (!res || !res.points.length) return ''
  const vals = res.points.map((p) => p.nodeFinals[nodeId] ?? 0)
  const allVals = res.points.flatMap((p) => Object.values(p.nodeFinals))
  const minY = Math.min(0, ...allVals)
  const maxY = Math.max(10, ...allVals)
  const spanY = Math.max(1e-6, maxY - minY)
  const w = 440
  const h = 130
  return vals
    .map((v, i) => {
      const x = 36 + (i / Math.max(1, vals.length - 1)) * (w - 52)
      const y = h - 18 - ((v - minY) / spanY) * (h - 32)
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
}

// ═════════════ 下一代演进 1：🎯 图表直接拖拽曲线反推配平 (Direct Curve Drag Goal-Seek) ═════════════
const curveDragActive = ref(false)
const isDraggingCurvePin = ref(false)
const curveAutoApply = ref(true)
const curveAppliedToast = ref('')
const curveTargetStep = ref(20)
const curveTargetVal = ref(50)
const curveDualPinActive = ref(true)
const curveTargetStep2 = ref(8)
const curveTargetVal2 = ref(25)
const curveSlopeGamma = ref(1)
const lastDraggedPinIndex = ref<1 | 2>(1)
const curveSolutions = ref<MxCurveTargetSolution[]>([])
const selectedCurveSolutionIdx = ref(0)
let curvePinDragCleanup: (() => void) | null = null
let dragSolveRafId: number | null = null
let curveToastTimer: ReturnType<typeof setTimeout> | null = null

const nextGenUi = computed(() =>
  isEn.value
    ? {
        tabPlayable: '🎮 Playable Deck',
        curveDragBtn: '🎯 Drag Curve to Balance',
        curveDragTip:
          'Grab any point on a curve and drag up/down — engine live-solves and updates upstream rates!',
        curveBarTitle: '🎯 Curve Goal-Seek:',
        dualPinBtn: '◆ Slope Handle',
        dualPinTip:
          'Show/hide the Bezier-style ◆ Slope Control Point to bend curve curvature (Exponential / Linear / Logarithmic)!',
        slopeExpBtn: '📈 Slow→Fast',
        slopeLinearBtn: '📏 Linear',
        slopeLogBtn: '📉 Fast→Slow',
        slopeExpTip: 'Concave exponential growth (γ=2.0: slow early, steep late)',
        slopeLinearTip: 'Constant linear slope (γ=1.0)',
        slopeLogTip: 'Convex logarithmic convergence (γ=0.45: fast early, tapering late)',
        autoApplyBtn: '⚡ Auto-Apply on Drop',
        autoApplyTip:
          'When enabled, releasing the dragged curve immediately applies the best parameter to the diagram (Ctrl+Z to undo)',
        undoBtn: '↩ Undo',
        atStepLabel: 'Step',
        targetValLabel: 'Target =',
        atStep2Label: '◆ Step',
        targetVal2Label: 'Ctrl =',
        solveBtn: 'Re-Solve',
        applySolBtn: '⚡ Apply Balance',
        noSolHint:
          'Grab and drag 🎯 Endpoint or ◆ Slope Control Point to live-solve upstream parameters.',
        hudTitle: '🔵 Live State & Resource HUD',
        deckTitle: '🃏 Interactive Action & Recipe Cards',
        turnTitle: '⚔ Turn Controls & Battle Log',
        stepBadge: (n: number) => `Turn / Step ${n}`,
        endedBanner: (r: string) => `🏁 Ended: ${r}`,
        nextTurnBtn: '▶ End Turn (+1 Step)',
        fast5Btn: '⏩ Fast-Forward (+5 Steps)',
        resetRunBtn: '↺ Restart Run',
        playCardBtn: '🃏 Play Card (Instant)',
        forceFireBtn: '⚡ Test',
        zeroCostTag: '🌱 Free Action (0 Cost)',
        trigClickBadge: '👆 Click Card',
        trigAutoBadge: '⚡ Auto/Turn',
        trigPassiveBadge: '· Passive',
        aiBestMoveBadge: '💡 AI Best Move',
        cdLockedBadge: (n: number) => `⏳ CD ${n}T`,
        cdConfigBadge: (n: number) => `⏱ CD:${n}`,
        playedBannerPrefix: '🃏 Played',
        aiAutoPlayBtn: '🤖 AI Auto-Play',
        aiAutoPlayStopBtn: '⏸ Stop AI Spectator',
        macroTapeTitle: (n: number) => `📼 Recorded Sequence (${n})`,
        macroReplayBtn: '📼 Replay & Compare',
        macroClearTip: 'Clear recorded sequence',
        macroReplayedPrefix: (n: number) => `📼 Replayed ${n} actions`,
        trendCardsBtn: '📊 Cards',
        trendCardsTip:
          'Show or hide bottom node trend summary cards to give the line chart more vertical space',
        toggleMaxDockTip: 'Expand / restore bottom panel height',
        emptyLogHint:
          'Click any Action Card to play within the current turn, then click "End Turn"!'
      }
    : {
        tabPlayable: '🎮 卡片试玩', // cjk-ok
        curveDragBtn: '🎯 拖拽曲线反推', // cjk-ok
        curveDragTip:
          '在折线图直接拖动「🎯 终点靶心」或「◆ 斜率控制点」，像调节贝塞尔曲线一样实时弯曲斜率并反推公式！', // cjk-ok
        curveBarTitle: '🎯 曲线反推：', // cjk-ok
        dualPinBtn: '◆ 斜率控制点', // cjk-ok
        dualPinTip:
          '开启贝塞尔式「◆ 斜率控制点」，直接拖动线身中段弯曲斜率（先慢后快 / 线性匀速 / 先快后慢）！', // cjk-ok
        slopeExpBtn: '📈 先慢后快', // cjk-ok
        slopeLinearBtn: '📏 线性', // cjk-ok
        slopeLogBtn: '📉 先快后慢', // cjk-ok
        slopeExpTip: '切换为下凹指数加速斜率 (γ=2.0：前期平缓蓄力、后期陡峭爆发)', // cjk-ok
        slopeLinearTip: '切换为恒定斜率直线增长 (γ=1.0：每步匀速产出)', // cjk-ok
        slopeLogTip: '切换为上凸对数收敛斜率 (γ=0.45：前期快速拉升、后期平缓收敛)', // cjk-ok
        autoApplyBtn: '⚡ 松手即应用', // cjk-ok
        autoApplyTip: '开启后，拖动曲线松开鼠标即刻将最优参数写回画布并重算（支持 Ctrl+Z 撤销）', // cjk-ok
        undoBtn: '↩ 撤销', // cjk-ok
        atStepLabel: '第', // cjk-ok
        targetValLabel: '步 =', // cjk-ok
        atStep2Label: '◆ 第', // cjk-ok
        targetVal2Label: '步 =', // cjk-ok
        solveBtn: '重算', // cjk-ok
        applySolBtn: '⚡ 立即应用', // cjk-ok
        noSolHint: '直接拖动「🎯 终点靶心」或「◆ 斜率控制点」，实时弯曲斜率并反推上游参数。', // cjk-ok
        hudTitle: '🔵 实时状态与资源槽 (HUD)', // cjk-ok
        deckTitle: '🃏 可点击动作与合成卡牌台', // cjk-ok
        turnTitle: '⚔ 回合控制与实时战报', // cjk-ok
        stepBadge: (n: number) => `第 ${n} 回合 (Step ${n})`, // cjk-ok
        endedBanner: (r: string) => `🏁 已触发终局：${r}`, // cjk-ok
        nextTurnBtn: '▶ 结束回合 / 推进 1 步', // cjk-ok
        fast5Btn: '⏩ 连跑 5 回合', // cjk-ok
        resetRunBtn: '↺ 重新开局', // cjk-ok
        playCardBtn: '🃏 打出卡牌 (本回合立即结算)', // cjk-ok
        forceFireBtn: '⚡ 强行触发', // cjk-ok
        zeroCostTag: '🌱 零消耗直接触发', // cjk-ok
        trigClickBadge: '👆 玩家点击卡', // cjk-ok
        trigAutoBadge: '⚡ 每回合自动', // cjk-ok
        trigPassiveBadge: '· 被动触发', // cjk-ok
        aiBestMoveBadge: '💡 AI 推荐最优手', // cjk-ok
        cdLockedBadge: (n: number) => `⏳ 冷却剩余 ${n} 回合`, // cjk-ok
        cdConfigBadge: (n: number) => `⏱ 冷却:${n}步`, // cjk-ok
        playedBannerPrefix: '🃏 已打出', // cjk-ok
        aiAutoPlayBtn: '🤖 AI 自动观战打牌', // cjk-ok
        aiAutoPlayStopBtn: '⏸ 停止 AI 观战', // cjk-ok
        macroTapeTitle: (n: number) => `📼 已录制操作序列 (${n}步)`, // cjk-ok
        macroReplayBtn: '📼 一键重放对比', // cjk-ok
        macroClearTip: '清空录制序列', // cjk-ok
        macroReplayedPrefix: (n: number) => `📼 已重放 ${n} 步操作`, // cjk-ok
        trendCardsBtn: '📊 趋势卡', // cjk-ok
        trendCardsTip: '展开或收起底部节点趋势卡片条，为折线图与靶心拖拽腾出更大垂直空间', // cjk-ok
        toggleMaxDockTip: '展开大图 / 恢复分屏高度', // cjk-ok
        emptyLogHint:
          '点击中间「🃏 打出卡牌」在当前回合内连打操作，再点右侧「▶ 结束回合」结算自然增长！' // cjk-ok
      }
)

const focusedSeriesObj = computed<SeriesItem | null>(() => {
  if (!s.focusedSeriesId.value) return null
  const base = baseSeriesList.value.find((sr) => sr.id === s.focusedSeriesId.value)
  if (!base) return null
  return {
    ...base,
    currentVal: Number((base.values[base.values.length - 1] ?? 0).toFixed(2))
  }
})

const activeCurveSolution = computed<MxCurveTargetSolution | null>(
  () => curveSolutions.value[selectedCurveSolutionIdx.value] ?? curveSolutions.value[0] ?? null
)

function syncSlopeControlPointFromGamma(gammaVal: number): void {
  const sr = focusedSeriesObj.value
  const v0 = sr?.values[0] ?? 0
  const tEnd = Math.max(2, curveTargetStep.value)
  const yEnd = curveTargetVal.value
  const st2 = Math.max(1, Math.min(tEnd - 1, Math.round(tEnd * 0.45)))
  curveTargetStep2.value = st2
  const u = st2 / tEnd
  const g = Math.max(0.25, Math.min(3.5, gammaVal))
  curveSlopeGamma.value = Math.round(g * 100) / 100
  const rawY2 = v0 + (yEnd - v0) * Math.pow(u, g)
  curveTargetVal2.value = Math.max(0, Math.round(rawY2 * 10) / 10)
}

function updateSlopeGammaFromControlPoint(): void {
  const sr = focusedSeriesObj.value
  const v0 = sr?.values[0] ?? 0
  const [tMid, yMid, tEnd, yEnd] =
    curveTargetStep2.value < curveTargetStep.value
      ? [curveTargetStep2.value, curveTargetVal2.value, curveTargetStep.value, curveTargetVal.value]
      : [curveTargetStep.value, curveTargetVal.value, curveTargetStep2.value, curveTargetVal2.value]
  const deltaEnd = yEnd - v0
  const uMid = tMid / Math.max(1, tEnd)
  if (Math.abs(deltaEnd) > 0.5 && uMid > 0.04 && uMid < 0.96) {
    const wMid = Math.max(0.03, Math.min(0.97, (yMid - v0) / deltaEnd))
    const g = Math.max(0.25, Math.min(3.5, Math.log(wMid) / Math.log(uMid)))
    curveSlopeGamma.value = Math.round(g * 100) / 100
  } else {
    curveSlopeGamma.value = 1
  }
}

const curveSlopeBadgeText = computed<string>(() => {
  const g = curveSlopeGamma.value
  if (g >= 1.15) return isEn.value ? `Exp γ=${g}` : `先慢后快 γ=${g}` // cjk-ok
  if (g <= 0.85) return isEn.value ? `Log γ=${g}` : `先快后慢 γ=${g}` // cjk-ok
  return isEn.value ? 'Linear γ=1' : '线性 γ=1' // cjk-ok
})

// 贝塞尔控制柄切线导引折线：(0, Y0) ---> (Tc, Yc) ---> (T1, Y1)
const curveTangentGuidePoints = computed<string>(() => {
  const sr = focusedSeriesObj.value
  if (!sr || !sr.values.length || !curveDualPinActive.value) return ''
  const v0 = sr.values[0] ?? 0
  const x0 = xAt(0, maxSteps.value)
  const y0 = yAtForSeries(sr, v0)
  const xc = xAt(curveTargetStep2.value, maxSteps.value)
  const yc = yAtForSeries(sr, curveTargetVal2.value)
  const x1 = xAt(curveTargetStep.value, maxSteps.value)
  const y1 = yAtForSeries(sr, curveTargetVal.value)
  return `${x0.toFixed(1)},${y0.toFixed(1)} ${xc.toFixed(1)},${yc.toFixed(1)} ${x1.toFixed(1)},${y1.toFixed(1)}`
})

// 拖动过程中使用 <0.01ms 零仿真开销的贝塞尔/幂律平滑形变曲线实时预览；松手后使用真实仿真预测序列
const curvePreviewPolylinePoints = computed<string>(() => {
  const sr = focusedSeriesObj.value
  if (!sr || !sr.values.length) return ''
  if (isDraggingCurvePin.value) {
    const baseVals = sr.values
    const n = baseVals.length
    const v0 = baseVals[0] ?? 0
    const t1 = Math.max(1, Math.min(n - 1, curveTargetStep.value))
    const y1 = curveTargetVal.value
    const baseAtT1 = baseVals[t1] ?? v0
    const baseDelta1 = baseAtT1 - v0
    const targetDelta1 = y1 - v0

    const warped = new Array<number>(n)
    if (!curveDualPinActive.value) {
      const useScale = Math.abs(baseDelta1) > 0.5
      const scale = useScale ? targetDelta1 / baseDelta1 : 1
      const slopeShift = (y1 - baseAtT1) / Math.max(1, t1)
      for (let i = 0; i < n; i++) {
        const bv = baseVals[i] ?? v0
        const wv = useScale ? v0 + (bv - v0) * scale : bv + slopeShift * i
        warped[i] = Math.max(0, wv)
      }
    } else {
      const t2 = Math.max(1, Math.min(n - 1, curveTargetStep2.value))
      const y2 = curveTargetVal2.value
      const [tMid, yMid, tEnd, yEnd] = t2 < t1 ? [t2, y2, t1, y1] : [t1, y1, t2, y2]
      const deltaEnd = yEnd - v0
      const uMid = tMid / Math.max(1, tEnd)
      const rawRatio = Math.abs(deltaEnd) > 0.5 ? (yMid - v0) / deltaEnd : 0.5
      if (
        Math.abs(deltaEnd) > 0.5 &&
        uMid > 0.04 &&
        uMid < 0.96 &&
        rawRatio > 0.03 &&
        rawRatio < 0.97
      ) {
        const g = Math.max(0.25, Math.min(3.5, Math.log(rawRatio) / Math.log(uMid)))
        for (let i = 0; i < n; i++) {
          const u = i / Math.max(1, tEnd)
          warped[i] = Math.max(0, v0 + deltaEnd * Math.pow(u, g))
        }
      } else {
        // 三点拉格朗日二次平滑抛物线插值（过 (0,v0), (tMid,yMid), (tEnd,yEnd)）
        const a0 = tMid * tEnd
        const a1 = tMid * (tMid - tEnd)
        const a2 = tEnd * (tEnd - tMid)
        for (let i = 0; i < n; i++) {
          const l0 = a0 !== 0 ? ((i - tMid) * (i - tEnd)) / a0 : 0
          const l1 = a1 !== 0 ? (i * (i - tEnd)) / a1 : 0
          const l2 = a2 !== 0 ? (i * (i - tMid)) / a2 : 1
          warped[i] = Math.max(0, v0 * l0 + yMid * l1 + yEnd * l2)
        }
      }
    }
    return polylinePointsForSeries(sr, warped, maxSteps.value)
  }
  const pred = activeCurveSolution.value?.predictedSeries
  if (!pred?.length) return ''
  return polylinePointsForSeries(sr, pred, maxSteps.value)
})

const curveOriginalValAtStep = computed<number>(() => {
  const sr = focusedSeriesObj.value
  if (!sr || !sr.values.length) return 0
  const idx = Math.max(0, Math.min(curveTargetStep.value, sr.values.length - 1))
  return Math.round((sr.values[idx] ?? 0) * 10) / 10
})

function focusSolutionOnCanvas(sol: MxCurveTargetSolution | null): void {
  if (!sol) return
  if (sol.variableKind === 'edge') {
    s.selection.edges = [sol.variableId]
    s.selection.nodes = []
  } else if (
    sol.variableKind === 'node_auto_inflow' ||
    sol.variableKind === 'node_auto_outflow' ||
    sol.variableKind === 'node_initial' ||
    sol.variableKind === 'node_capacity'
  ) {
    s.selection.nodes = [sol.variableId]
    s.selection.edges = []
  }
}

function selectCurveSolution(idx: number): void {
  selectedCurveSolutionIdx.value = idx
  focusSolutionOnCanvas(curveSolutions.value[idx] ?? null)
}

function runCurveTargetSolve(fastPreview = false): void {
  const sr = focusedSeriesObj.value
  if (!sr) return
  const prevSelected = curveSolutions.value[selectedCurveSolutionIdx.value]
  const prevKey = prevSelected
    ? `${prevSelected.variableKind}:${prevSelected.variableId}:${prevSelected.secondVariableId ?? ''}:${prevSelected.formulaOverride ? 'fx' : ''}`
    : ''
  const useSecondAnchor =
    curveDualPinActive.value &&
    (Math.abs(curveSlopeGamma.value - 1) > 0.08 || lastDraggedPinIndex.value === 2)
  const sols = autoSolveMxCurveTarget(s.doc.value, {
    targetNodeId: sr.id,
    atStep: curveTargetStep.value,
    targetValue: curveTargetVal.value,
    fastPreview,
    ...(useSecondAnchor
      ? {
          secondTarget: {
            atStep: curveTargetStep2.value,
            targetValue: curveTargetVal2.value
          }
        }
      : {})
  })
  curveSolutions.value = sols
  if (useSecondAnchor) {
    const slopeIdx = sols.findIndex((x) => Boolean(x.formulaOverride))
    if (slopeIdx >= 0) {
      selectedCurveSolutionIdx.value = slopeIdx
      return
    }
  }
  if (prevKey && sols.length > 1) {
    const matchedIdx = sols.findIndex(
      (x) =>
        `${x.variableKind}:${x.variableId}:${x.secondVariableId ?? ''}:${x.formulaOverride ? 'fx' : ''}` ===
        prevKey
    )
    selectedCurveSolutionIdx.value = matchedIdx >= 0 ? matchedIdx : 0
  } else {
    selectedCurveSolutionIdx.value = 0
  }
}

function applyCurveSlopePreset(gammaVal: number): void {
  curveDualPinActive.value = true
  lastDraggedPinIndex.value = 2
  syncSlopeControlPointFromGamma(gammaVal)
  runCurveTargetSolve(false)
  if (curveAutoApply.value && activeCurveSolution.value) {
    applySelectedCurveSolution(true)
  } else if (activeCurveSolution.value) {
    focusSolutionOnCanvas(activeCurveSolution.value)
  }
}

function toggleCurveDualPin(): void {
  curveDualPinActive.value = !curveDualPinActive.value
  if (curveDualPinActive.value) {
    syncSlopeControlPointFromGamma(curveSlopeGamma.value)
  }
  runCurveTargetSolve()
}

function toggleCurveDragMode(): void {
  if (!curveDragActive.value) {
    if (!s.focusedSeriesId.value && seriesList.value[0]) {
      s.focusedSeriesId.value = seriesList.value[0].id
    }
    const sr = focusedSeriesObj.value
    // 默认锚定在曲线 80% 步数位置（避开最右侧边缘裁切，且靶心直接落在当前曲线上，不发生突兀跳变）
    const defaultStep = Math.max(2, Math.round(maxSteps.value * 0.8))
    curveTargetStep.value = defaultStep
    const curVal = sr ? (sr.values[Math.min(defaultStep, sr.values.length - 1)] ?? 10) : 10
    curveTargetVal.value = Math.max(0, Math.round(curVal * 10) / 10)
    curveDualPinActive.value = true
    lastDraggedPinIndex.value = 1
    const st2 = Math.max(1, Math.min(defaultStep - 1, Math.round(defaultStep * 0.45)))
    curveTargetStep2.value = st2
    const curVal2 = sr ? (sr.values[Math.min(st2, sr.values.length - 1)] ?? curVal * 0.45) : 5
    curveTargetVal2.value = Math.max(0, Math.round(curVal2 * 10) / 10)
    updateSlopeGammaFromControlPoint()
    curveDragActive.value = true
    showTrendCardsStrip.value = false
    if (dockHeight.value < 320) dockHeight.value = 340
    runCurveTargetSolve()
  } else {
    curveDragActive.value = false
    dragLockedYBounds.value = null
    showTrendCardsStrip.value = true
    curveSolutions.value = []
  }
}

watch(
  () => s.focusedSeriesId.value,
  (nextId) => {
    if (curveDragActive.value && nextId) {
      const sr = seriesList.value.find((x) => x.id === nextId)
      if (sr) {
        const st = Math.min(curveTargetStep.value, Math.max(2, sr.values.length - 1))
        curveTargetStep.value = st
        curveTargetVal.value = Math.round((sr.values[st] ?? 10) * 10) / 10
        const st2 = Math.max(1, Math.min(st - 1, Math.round(st * 0.45)))
        curveTargetStep2.value = st2
        curveTargetVal2.value = Math.round((sr.values[st2] ?? 5) * 10) / 10
        lastDraggedPinIndex.value = 1
        updateSlopeGammaFromControlPoint()
        runCurveTargetSolve()
      }
    }
  }
)

function startCurvePinDrag(
  ev: PointerEvent,
  pinIndex: 1 | 2 = 1,
  svgOverride?: SVGSVGElement
): void {
  const sr = focusedSeriesObj.value
  if (!sr) return
  ev.preventDefault()
  ev.stopPropagation()
  const svg =
    svgOverride ?? ((ev.currentTarget as Element | null)?.closest('svg') as SVGSVGElement | null)
  if (!svg) return
  const rect = svg.getBoundingClientRect()
  const curB = yBounds.value
  const lockedMin = curB.min
  const lockedMax = Math.max(curB.max, curB.min + 10)
  // 整个单次拖拽手势期间严格固定 Y 轴量程（零重缩放、零背景折线重算、100% 像素级跟手）
  dragLockedYBounds.value = { min: lockedMin, max: lockedMax }
  isDraggingCurvePin.value = true
  lastDraggedPinIndex.value = pinIndex
  let hasMoved = false
  let pendingClientX = ev.clientX
  let pendingClientY = ev.clientY

  const flushPointerFrame = (): void => {
    dragSolveRafId = null
    if (!isDraggingCurvePin.value) return
    const relX = ((pendingClientX - rect.left) / Math.max(1, rect.width)) * CW
    const relY = ((pendingClientY - rect.top) / Math.max(1, rect.height)) * CH
    const stepRatio = Math.max(0, Math.min(1, (relX - PAD_L) / PW))
    const rawValRatio = 1 - (relY - PAD_T) / PH
    const nextStep = Math.max(1, Math.round(stepRatio * Math.max(1, maxSteps.value)))
    const clampedRatio = Math.max(0, Math.min(1.06, rawValRatio))
    const rawVal = lockedMin + clampedRatio * (lockedMax - lockedMin)
    const nextVal = Math.max(0, Math.round(rawVal * 10) / 10)

    if (pinIndex === 2) {
      const safeStep2 = nextStep === curveTargetStep.value ? Math.max(1, nextStep - 1) : nextStep
      if (curveTargetStep2.value !== safeStep2 || curveTargetVal2.value !== nextVal) {
        hasMoved = true
      }
      curveTargetStep2.value = safeStep2
      curveTargetVal2.value = nextVal
      updateSlopeGammaFromControlPoint()
    } else {
      const safeStep1 = Math.max(2, nextStep)
      if (curveTargetStep.value !== safeStep1 || curveTargetVal.value !== nextVal) {
        hasMoved = true
      }
      curveTargetStep.value = safeStep1
      curveTargetVal.value = nextVal
      if (curveDualPinActive.value) {
        syncSlopeControlPointFromGamma(curveSlopeGamma.value)
      }
    }
  }

  const onMove = (me: PointerEvent): void => {
    pendingClientX = me.clientX
    pendingClientY = me.clientY
    if (dragSolveRafId === null) {
      dragSolveRafId = requestAnimationFrame(flushPointerFrame)
    }
  }

  const onUp = (): void => {
    if (dragSolveRafId !== null) {
      cancelAnimationFrame(dragSolveRafId)
      dragSolveRafId = null
      flushPointerFrame()
    }
    isDraggingCurvePin.value = false
    dragLockedYBounds.value = null
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    window.removeEventListener('pointercancel', onUp)
    curvePinDragCleanup = null
    runCurveTargetSolve(false)
    const sol = activeCurveSolution.value
    if (
      hasMoved &&
      curveAutoApply.value &&
      sol &&
      (Boolean(sol.formulaOverride) || Math.abs(sol.bestValue - sol.fromValue) > 1e-4)
    ) {
      applySelectedCurveSolution(true)
    } else if (sol) {
      focusSolutionOnCanvas(sol)
    }
  }

  window.addEventListener('pointermove', onMove, { passive: true })
  window.addEventListener('pointerup', onUp)
  window.addEventListener('pointercancel', onUp)
  curvePinDragCleanup = onUp
}

/**
 * 在开启「🎯 拖拽曲线反推」时，点击/按住图表任意位置即可直接抓取终点靶心或斜率控制点并上下拖动
 */
function onChartPointerDown(ev: PointerEvent): void {
  if (!curveDragActive.value || !focusedSeriesObj.value || ev.button !== 0) return
  const svg = ev.currentTarget as SVGSVGElement
  const rect = svg.getBoundingClientRect()
  const relX = ((ev.clientX - rect.left) / Math.max(1, rect.width)) * CW
  const relY = ((ev.clientY - rect.top) / Math.max(1, rect.height)) * CH
  if (relX < PAD_L - 6 || relX > CW - PAD_R + 6 || relY < PAD_T - 8 || relY > CH - PAD_B + 8) {
    return
  }
  const stepRatio = Math.max(0, Math.min(1, (relX - PAD_L) / PW))
  const clickedStep = Math.max(1, Math.round(stepRatio * Math.max(1, maxSteps.value)))
  const lb = yBounds.value
  const valRatio = Math.max(0, Math.min(1, 1 - (relY - PAD_T) / PH))
  const clickedVal = Math.max(0, Math.round((lb.min + valRatio * (lb.max - lb.min)) * 10) / 10)

  let pinIdx: 1 | 2 = 1
  if (curveDualPinActive.value) {
    const dist1 = Math.abs(clickedStep - curveTargetStep.value)
    const dist2 = Math.abs(clickedStep - curveTargetStep2.value)
    if (dist2 < dist1) pinIdx = 2
  }
  if (pinIdx === 2) {
    curveTargetStep2.value =
      clickedStep === curveTargetStep.value ? Math.max(1, clickedStep - 1) : clickedStep
    curveTargetVal2.value = clickedVal
    updateSlopeGammaFromControlPoint()
  } else {
    curveTargetStep.value = Math.max(2, clickedStep)
    curveTargetVal.value = clickedVal
    if (curveDualPinActive.value) {
      syncSlopeControlPointFromGamma(curveSlopeGamma.value)
    }
  }
  startCurvePinDrag(ev, pinIdx, svg)
}

/**
 * 直接在任意折线上按住上下拖动（无需预先点按钮）即可自动聚焦该折线并启动曲线反推；
 * 若只是轻点未拖动（|dy| <= 5px），则保持原有的切换聚焦图例行为。
 */
function onSeriesPointerDown(ev: PointerEvent, sr: SeriesItem): void {
  if (ev.button !== 0) return
  const svg = (ev.currentTarget as Element).closest('svg') as SVGSVGElement | null
  if (!svg) return
  if (curveDragActive.value) {
    if (s.focusedSeriesId.value !== sr.id) {
      s.focusedSeriesId.value = sr.id
    }
    onChartPointerDown(Object.assign(ev, { currentTarget: svg }) as unknown as PointerEvent)
    return
  }
  const startY = ev.clientY
  const rect = svg.getBoundingClientRect()
  const relX = ((ev.clientX - rect.left) / Math.max(1, rect.width)) * CW
  const stepRatio = Math.max(0, Math.min(1, (relX - PAD_L) / PW))
  const grabStep = Math.max(2, Math.round(stepRatio * Math.max(1, maxSteps.value)))

  const onCheckMove = (me: PointerEvent): void => {
    if (Math.abs(me.clientY - startY) > 5) {
      cleanupCheck()
      s.focusedSeriesId.value = sr.id
      curveDragActive.value = true
      curveDualPinActive.value = true
      showTrendCardsStrip.value = false
      if (dockHeight.value < 320) dockHeight.value = 340
      curveTargetStep.value = grabStep
      const curVal = sr.values[Math.min(grabStep, sr.values.length - 1)] ?? 10
      curveTargetVal.value = Math.max(0, Math.round(curVal * 10) / 10)
      syncSlopeControlPointFromGamma(1)
      startCurvePinDrag(me, 1, svg)
    }
  }
  const cleanupCheck = (): void => {
    window.removeEventListener('pointermove', onCheckMove)
    window.removeEventListener('pointerup', cleanupCheck)
    window.removeEventListener('pointercancel', cleanupCheck)
  }
  window.addEventListener('pointermove', onCheckMove)
  window.addEventListener('pointerup', cleanupCheck)
  window.addEventListener('pointercancel', cleanupCheck)
}

function applySelectedCurveSolution(fromAutoRelease = false): void {
  const sol = activeCurveSolution.value
  const sr = focusedSeriesObj.value
  if (!sol) return
  const capOpts = sr
    ? {
        targetNodeId: sr.id,
        ensureTargetCap: curveDualPinActive.value
          ? Math.max(curveTargetVal.value, curveTargetVal2.value)
          : curveTargetVal.value,
        ...(sol.formulaOverride ? { formulaOverride: sol.formulaOverride } : {})
      }
    : sol.formulaOverride
      ? { formulaOverride: sol.formulaOverride }
      : undefined
  if (
    sol.isPair &&
    sol.secondVariableKind &&
    sol.secondVariableId &&
    sol.secondBestValue !== undefined
  ) {
    s.applyTunablePair(
      sol.variableKind,
      sol.variableId,
      sol.bestValue,
      sol.secondVariableKind,
      sol.secondVariableId,
      sol.secondBestValue,
      capOpts
    )
  } else {
    s.applyTunableValue(sol.variableKind, sol.variableId, sol.bestValue, capOpts)
  }
  focusSolutionOnCanvas(sol)
  if (curveToastTimer) clearTimeout(curveToastTimer)
  curveAppliedToast.value = sol.formulaOverride
    ? `${sol.variableLabel}: ƒx ➔ ${sol.formulaOverride}`
    : `${sol.variableLabel}: ${sol.currentValue} ➔ ${sol.bestValue}`
  curveToastTimer = setTimeout(() => {
    curveAppliedToast.value = ''
  }, 2800)
  if (!fromAutoRelease) {
    runCurveTargetSolve(false)
  } else {
    // 松手自动应用后刷新候选基准值，便于继续连续拖动微调
    runCurveTargetSolve(false)
  }
}

onBeforeUnmount(() => {
  curvePinDragCleanup?.()
  if (dragSolveRafId !== null) cancelAnimationFrame(dragSolveRafId)
  if (curveToastTimer) clearTimeout(curveToastTimer)
  if (cardFeedbackTimer) clearTimeout(cardFeedbackTimer)
  stopAiSpectator()
})

// ═════════════ 下一代演进 2：🎮 机制一键试玩卡片台 (Playable Card & HUD Prototype) ═════════════
const justChangedNodeIds = ref<string[]>([])
const lastPlayedCardBanner = ref<string>('')
let cardFeedbackTimer: ReturnType<typeof setTimeout> | null = null

// 🤖 AI 自动观战打牌状态与 📼 操作序列录制/回归重放状态
const aiSpectatorActive = ref(false)
const aiCardsPlayedInTurn = ref(0)
let aiSpectatorTimer: ReturnType<typeof setInterval> | null = null
const recordedMacroSteps = ref<MxPlayableMacroStep[]>([...(s.doc.value.playableMacroSteps ?? [])])
const recordedBaselineValues = ref<Record<string, number>>({})

watch(
  () => s.doc.value.playableMacroSteps,
  (next) => {
    const incoming = next ?? []
    if (JSON.stringify(incoming) !== JSON.stringify(recordedMacroSteps.value)) {
      recordedMacroSteps.value = [...incoming]
    }
  }
)

function isNumericFormula(v?: string | number): boolean {
  if (v === undefined || v === null) return false
  return /^\s*\d+(\.\d+)?\s*$/.test(String(v))
}

function canTuneEdgeExpr(expr?: string): boolean {
  if (!expr) return false
  if (isNumericFormula(expr)) return true
  const trimmed = expr.trim()
  return s.doc.value.params.some((p) => p.name === trimmed)
}

function nudgePlayableTunable(
  kind: MxTunableKind,
  id: string,
  rawVal: number | string | undefined,
  dir: -1 | 1
): void {
  const num = Number(rawVal)
  if (!Number.isFinite(num)) return
  const step = num >= 20 ? 5 : num >= 10 ? 2 : 1
  const minVal = kind === 'edge' ? 1 : 0
  const nextVal = Math.max(minVal, Math.round((num + dir * step) * 100) / 100)
  if (nextVal === num) return
  const prevStep = s.playStep.value
  s.applyTunableValue(kind, id, nextVal)
  if (recordedMacroSteps.value.length > 0) {
    onReplayRecordedMacro()
  } else {
    s.playStep.value = Math.min(prevStep, s.activeRun.value?.stepsRun ?? prevStep)
  }
}

function nudgePlayableEdgeExpr(edgeId: string, expr: string | undefined, dir: -1 | 1): void {
  if (!expr) return
  const trimmed = expr.trim()
  const matchedParam = s.doc.value.params.find((p) => p.name === trimmed)
  if (matchedParam) {
    nudgePlayableTunable('param', matchedParam.name, matchedParam.value, dir)
    return
  }
  if (isNumericFormula(trimmed)) {
    nudgePlayableTunable('edge', edgeId, trimmed, dir)
  }
}

function stopAiSpectator(): void {
  if (aiSpectatorTimer) {
    clearInterval(aiSpectatorTimer)
    aiSpectatorTimer = null
  }
  aiSpectatorActive.value = false
}

const playableHud = computed<MxPlayableHudSnapshot>(() => {
  const curVals = s.displayValues.value ?? {}
  const prevVals = s.previousStepValues.value ?? {}
  const isLive = s.liveState.value !== null
  const step = s.playStep.value
  const ended = isLive
    ? Boolean(s.liveState.value?.ended)
    : Boolean(s.activeRun.value?.ended && step >= (s.activeRun.value?.stepsRun ?? 0))
  const endReason = isLive ? s.liveState.value?.endReason : s.activeRun.value?.endReason
  return extractMxPlayableHudSnapshot(s.doc.value, curVals, prevVals, {
    step,
    ended,
    endReason,
    liveState: s.liveState.value
  })
})

const playableBattleLog = computed(() => {
  const evs = s.liveState.value
    ? s.liveEvents.value
    : (s.activeRun.value?.events ?? []).filter((e) => e.step <= s.playStep.value)
  return [...evs].reverse().slice(0, 24)
})

function snapshotMacroBaseline(): void {
  recordedBaselineValues.value = { ...(s.displayValues.value ?? {}) }
}

function onPlayCard(card: MxPlayableActionCard): void {
  s.select([card.id])
  const beforeVals = { ...(s.displayValues.value ?? {}) }
  const { changedNodeIds } = s.playCardInstant(card.id)
  recordedMacroSteps.value = [
    ...recordedMacroSteps.value,
    { kind: 'card', nodeId: card.id, label: card.label }
  ]
  s.setPlayableMacroSteps(recordedMacroSteps.value)
  snapshotMacroBaseline()
  const afterVals = s.displayValues.value ?? {}
  justChangedNodeIds.value = [card.id, ...changedNodeIds]
  const deltaParts: string[] = []
  for (const nid of changedNodeIds) {
    const nd = s.doc.value.nodes.find((x) => x.id === nid)
    if (!nd || (nd.kind !== 'pool' && nd.kind !== 'register')) continue
    const diff = Math.round(((afterVals[nid] ?? 0) - (beforeVals[nid] ?? 0)) * 100) / 100
    if (diff !== 0) {
      deltaParts.push(`${nd.label || nd.id} ${diff > 0 ? `+${diff}` : diff}`)
    }
  }
  lastPlayedCardBanner.value = `${nextGenUi.value.playedBannerPrefix} [${card.label}]${
    deltaParts.length ? `：${deltaParts.join(' · ')}` : ''
  }` // cjk-ok
  if (cardFeedbackTimer) clearTimeout(cardFeedbackTimer)
  cardFeedbackTimer = setTimeout(() => {
    justChangedNodeIds.value = []
    lastPlayedCardBanner.value = ''
  }, 2200)
}

function onNextTurnClick(): void {
  aiCardsPlayedInTurn.value = 0
  s.stepOnce()
  const prevLast = recordedMacroSteps.value[recordedMacroSteps.value.length - 1]
  if (prevLast && prevLast.kind === 'end_turn') {
    const copy = [...recordedMacroSteps.value]
    copy[copy.length - 1] = { kind: 'end_turn', steps: (prevLast.steps ?? 1) + 1 }
    recordedMacroSteps.value = copy
  } else {
    recordedMacroSteps.value = [...recordedMacroSteps.value, { kind: 'end_turn', steps: 1 }]
  }
  s.setPlayableMacroSteps(recordedMacroSteps.value)
  snapshotMacroBaseline()
}

function onFastForward5Click(): void {
  aiCardsPlayedInTurn.value = 0
  s.stepMultiple(5)
  recordedMacroSteps.value = [...recordedMacroSteps.value, { kind: 'end_turn', steps: 5 }]
  s.setPlayableMacroSteps(recordedMacroSteps.value)
  snapshotMacroBaseline()
}

function onResetPlayClick(): void {
  stopAiSpectator()
  aiCardsPlayedInTurn.value = 0
  curveDragActive.value = false
  curveSolutions.value = []
  debugFilterStep.value = ''
  s.resetPlayback()
}

function clearRecordedMacro(): void {
  recordedMacroSteps.value = []
  recordedBaselineValues.value = {}
  s.setPlayableMacroSteps([])
}

function onReplayRecordedMacro(): void {
  if (!recordedMacroSteps.value.length) return
  stopAiSpectator()
  const prevBase = { ...recordedBaselineValues.value }
  const res = s.replayActionMacro(recordedMacroSteps.value)
  const newVals = res.finalState.values
  const diffs: string[] = []
  const changedIds: string[] = []
  for (const nd of s.doc.value.nodes) {
    if (nd.kind !== 'pool' && nd.kind !== 'register') continue
    const nv = Math.round((newVals[nd.id] ?? 0) * 100) / 100
    const pv = Math.round((prevBase[nd.id] ?? nv) * 100) / 100
    const delta = Math.round((nv - pv) * 100) / 100
    if (delta !== 0) {
      changedIds.push(nd.id)
      diffs.push(`${nd.label || nd.id}: ${nv} (${delta > 0 ? `+${delta}` : delta})`)
    } else if (nv > 0 && diffs.length < 3) {
      diffs.push(`${nd.label || nd.id}: ${nv}`)
    }
  }
  recordedBaselineValues.value = { ...newVals }
  justChangedNodeIds.value = changedIds
  lastPlayedCardBanner.value = `${nextGenUi.value.macroReplayedPrefix(
    recordedMacroSteps.value.length
  )}${diffs.length ? `：${diffs.slice(0, 4).join(' · ')}` : ''}` // cjk-ok
  if (cardFeedbackTimer) clearTimeout(cardFeedbackTimer)
  cardFeedbackTimer = setTimeout(() => {
    justChangedNodeIds.value = []
    lastPlayedCardBanner.value = ''
  }, 3000)
}

function stepAiSpectatorOnce(): void {
  if (playableHud.value.ended || playableHud.value.step >= maxSteps.value) {
    stopAiSpectator()
    return
  }
  const cards = playableHud.value.actionCards
  const rec =
    cards.find((c) => c.canPlay && c.aiRecommended) ??
    cards.find((c) => c.canPlay && c.costs.length > 0)
  if (rec && aiCardsPlayedInTurn.value < 2) {
    if (rec.costs.length === 0 && aiCardsPlayedInTurn.value >= 1) {
      onNextTurnClick()
      return
    }
    aiCardsPlayedInTurn.value++
    onPlayCard(rec)
  } else {
    onNextTurnClick()
  }
}

function toggleAiSpectator(): void {
  if (aiSpectatorActive.value) {
    stopAiSpectator()
    return
  }
  if (playableHud.value.ended) {
    s.resetPlayback()
  }
  aiSpectatorActive.value = true
  aiCardsPlayedInTurn.value = 0
  stepAiSpectatorOnce()
  aiSpectatorTimer = setInterval(stepAiSpectatorOnce, 520)
}
</script>

<template>
  <section class="mx-bottom-dock" :class="{ 'is-full-workbench': s.mode.value === 'workbench' }">
    <!-- ═════════════ 顶部可拖拽缩放手柄 ═════════════ -->
    <div
      v-if="s.mode.value !== 'workbench'"
      class="mx-dock-resize-handle"
      :class="{ 'is-dragging': isResizingDock }"
      @pointerdown="startResizeDock"
      @dblclick="toggleDockHeight"
    >
      <span class="mx-dock-resize-pill" />
    </div>

    <!-- ═════════════ 顶部标签栏：Results | Diagnostics | Auto-Balancer | Runtime Debugger ═════════════ -->
    <header v-if="s.resultsTab.value !== 'workbench'" class="mx-res-tabs">
      <div class="mx-res-tabs-left">
        <button
          type="button"
          class="mx-res-tab"
          :class="{ 'is-active': s.resultsTab.value === 'results' }"
          @click="
            () => {
              s.resultsTab.value = 'results'
              s.resultsOpen.value = true
            }
          "
        >
          {{ t('mx.results.tabResults') }}
        </button>
        <button
          type="button"
          class="mx-res-tab is-playable-tab"
          :class="{ 'is-active': s.resultsTab.value === 'playable' }"
          @click="
            () => {
              s.resultsTab.value = 'playable'
              s.resultsOpen.value = true
            }
          "
        >
          {{ nextGenUi.tabPlayable }}
          <span class="mx-diag-pill is-ok">
            {{ playableHud.actionCards.length }}
          </span>
        </button>
        <button
          type="button"
          class="mx-res-tab"
          :class="{ 'is-active': s.resultsTab.value === 'diagnostics' }"
          @click="
            () => {
              s.resultsTab.value = 'diagnostics'
              s.resultsOpen.value = true
            }
          "
        >
          🩺 {{ t('mx.results.tabDiagnostics') }}
          <span class="mx-diag-pill" :class="healthIssueCount > 0 ? 'is-warn' : 'is-ok'">
            {{ healthReport.grade }}
          </span>
        </button>
        <button
          type="button"
          class="mx-res-tab"
          :class="{ 'is-active': s.resultsTab.value === 'balancer' }"
          @click="
            () => {
              s.resultsTab.value = 'balancer'
              s.resultsOpen.value = true
            }
          "
        >
          🎯 {{ t('mx.results.tabBalancer') }}
        </button>
        <button
          type="button"
          class="mx-res-tab"
          :class="{ 'is-active': s.resultsTab.value === 'debugger' }"
          @click="
            () => {
              s.resultsTab.value = 'debugger'
              s.resultsOpen.value = true
            }
          "
        >
          {{ t('mx.results.tabDebugger') }}
        </button>
        <button
          type="button"
          class="mx-res-icon-btn"
          :title="t('mx.results.clearRuns')"
          @click="s.clearRuns()"
        >
          ↺
        </button>
      </div>

      <div class="mx-res-tabs-right">
        <label v-if="s.forecast.value" class="mx-forecast-toggle">
          <input v-model="showForecastBand" type="checkbox" />
          <span>P10–P90 ({{ s.forecast.value.runs }})</span>
        </label>
        <button
          type="button"
          class="mx-res-icon-btn"
          :title="nextGenUi.toggleMaxDockTip"
          @click="toggleDockHeight"
        >
          ⛶
        </button>
        <button
          type="button"
          class="mx-res-icon-btn"
          @click="s.resultsOpen.value = !s.resultsOpen.value"
        >
          {{ s.resultsOpen.value ? '▾' : '▴' }}
        </button>
      </div>
    </header>

    <!-- ═════════════ 面板主体 ═════════════ -->
    <div
      v-if="s.resultsOpen.value || s.mode.value === 'workbench'"
      class="mx-res-content"
      :style="
        s.mode.value === 'workbench'
          ? { flex: '1', minHeight: '0', height: 'auto' }
          : { height: `${dockHeight}px` }
      "
    >
      <!-- ─── TAB 1: RESULTS ─── -->
      <template v-if="s.resultsTab.value === 'results'">
        <div class="mx-res-upper">
          <!-- 左侧 PLAYS 列表 -->
          <aside class="mx-plays-col">
            <div class="mx-compare-row">
              <button
                type="button"
                class="mx-compare-btn"
                :class="{ 'is-active': compareMode }"
                @click="compareMode = !compareMode"
              >
                ⇄ {{ t('mx.results.compare') }}
              </button>
              <button
                type="button"
                class="mx-compare-all-btn"
                :title="t('mx.results.compareAllTip')"
                @click="onRunAllCompare"
              >
                ⚡
              </button>
            </div>
            <div class="mx-plays-hdr">{{ t('mx.results.plays') }}</div>
            <div class="mx-plays-list">
              <div
                v-for="r in s.runs.value"
                :key="r.id"
                class="mx-play-item"
                :class="{ 'is-active': s.activeRunId.value === r.id }"
                @click="
                  () => {
                    s.activeRunId.value = r.id
                    s.playStep.value = r.stepsRun
                  }
                "
              >
                <input
                  v-if="compareMode"
                  type="checkbox"
                  :checked="s.compareRunIds.value.includes(r.id)"
                  @click.stop="toggleCompareRun(r.id)"
                />
                <span class="mx-play-name">{{ r.name }}</span>
                <button type="button" class="mx-play-del" @click.stop="s.deleteRun(r.id)">×</button>
              </div>
              <div v-if="!s.runs.value.length" class="mx-plays-empty">
                {{ t('mx.results.noPlaysYet') }}
              </div>
            </div>
          </aside>

          <!-- 中间 SVG 折线图 -->
          <div class="mx-chart-col">
            <div class="mx-chart-crumb">
              <span class="mx-crumb-main">
                {{ s.activeRun.value ? s.activeRun.value.name : t('mx.results.livePreview') }}
              </span>
              <span class="mx-crumb-sep">&gt;</span>
              <button
                type="button"
                class="mx-crumb-pill"
                :class="{ 'is-active': !s.focusedSeriesId.value }"
                @click="s.focusedSeriesId.value = ''"
              >
                {{ t('mx.results.summary') }}
              </button>
              <button
                v-for="sr in seriesList"
                :key="sr.id"
                type="button"
                class="mx-crumb-pill"
                :class="{
                  'is-active': isSeriesHighlighted(sr.id),
                  'is-dimmed': isSeriesDimmed(sr.id)
                }"
                :style="
                  isSeriesHighlighted(sr.id)
                    ? {
                        borderColor: sr.color,
                        color: sr.color,
                        boxShadow: `0 0 0 1px ${sr.color}40`
                      }
                    : undefined
                "
                @click="toggleFocusSeries(sr.id)"
              >
                <span class="mx-dot" :style="{ background: sr.color }" />
                {{ sr.label }}
              </button>
              <button
                v-if="!s.focusedSeriesId.value"
                type="button"
                class="mx-crumb-pill mx-scale-toggle"
                :class="{ 'is-active': chartScaleMode === 'norm' }"
                @click="chartScaleMode = chartScaleMode === 'raw' ? 'norm' : 'raw'"
              >
                {{ chartScaleMode === 'norm' ? 'NORM %' : 'Y1 RAW' }}
              </button>
              <button
                type="button"
                class="mx-crumb-pill mx-curve-drag-btn"
                :class="{ 'is-active': curveDragActive }"
                :title="nextGenUi.curveDragTip"
                @click="toggleCurveDragMode"
              >
                {{ nextGenUi.curveDragBtn }}
              </button>
              <button
                type="button"
                class="mx-crumb-pill"
                :class="{ 'is-active': showTrendCardsStrip }"
                :title="nextGenUi.trendCardsTip"
                @click="showTrendCardsStrip = !showTrendCardsStrip"
              >
                {{ nextGenUi.trendCardsBtn }}
              </button>
            </div>

            <!-- 🎯 拖拽曲线反推配平交互控制栏 -->
            <div v-if="curveDragActive && focusedSeriesObj" class="mx-curve-solver-bar">
              <div class="mx-cs-left">
                <span class="mx-cs-title">{{ nextGenUi.curveBarTitle }}</span>
                <span class="mx-cs-node-tag" :style="{ borderColor: focusedSeriesObj.color }">
                  <span class="mx-dot" :style="{ background: focusedSeriesObj.color }" />
                  {{ focusedSeriesObj.label }}
                </span>
                <label class="mx-cs-field">
                  <span>{{ nextGenUi.atStepLabel }}</span>
                  <input
                    v-model.number="curveTargetStep"
                    type="number"
                    min="1"
                    :max="Math.max(1, maxSteps)"
                    class="mx-cs-input is-step"
                    @change="runCurveTargetSolve()"
                  />
                  <span>{{ nextGenUi.targetValLabel }}</span>
                  <input
                    v-model.number="curveTargetVal"
                    type="number"
                    step="0.5"
                    class="mx-cs-input is-val"
                    @change="runCurveTargetSolve()"
                  />
                </label>
                <button
                  type="button"
                  class="mx-cs-mini-btn"
                  :class="{ 'is-active': curveDualPinActive }"
                  :title="nextGenUi.dualPinTip"
                  @click="toggleCurveDualPin"
                >
                  {{ nextGenUi.dualPinBtn }}
                </button>
                <template v-if="curveDualPinActive">
                  <button
                    type="button"
                    class="mx-cs-mini-btn"
                    :class="{ 'is-active': curveSlopeGamma >= 1.2 }"
                    :title="nextGenUi.slopeExpTip"
                    @click="applyCurveSlopePreset(2.0)"
                  >
                    {{ nextGenUi.slopeExpBtn }}
                  </button>
                  <button
                    type="button"
                    class="mx-cs-mini-btn"
                    :class="{
                      'is-active': curveSlopeGamma > 0.85 && curveSlopeGamma < 1.2
                    }"
                    :title="nextGenUi.slopeLinearTip"
                    @click="applyCurveSlopePreset(1.0)"
                  >
                    {{ nextGenUi.slopeLinearBtn }}
                  </button>
                  <button
                    type="button"
                    class="mx-cs-mini-btn"
                    :class="{ 'is-active': curveSlopeGamma <= 0.85 }"
                    :title="nextGenUi.slopeLogTip"
                    @click="applyCurveSlopePreset(0.45)"
                  >
                    {{ nextGenUi.slopeLogBtn }}
                  </button>
                </template>
                <button
                  type="button"
                  class="mx-cs-mini-btn"
                  :class="{ 'is-active': curveAutoApply }"
                  :title="nextGenUi.autoApplyTip"
                  @click="curveAutoApply = !curveAutoApply"
                >
                  {{ nextGenUi.autoApplyBtn }}
                </button>
                <button
                  v-if="s.canUndo.value"
                  type="button"
                  class="mx-cs-mini-btn"
                  @click="
                    () => {
                      s.undo()
                      runCurveTargetSolve()
                    }
                  "
                >
                  {{ nextGenUi.undoBtn }}
                </button>
                <span v-if="curveAppliedToast" class="mx-cs-toast">
                  ✓ {{ curveAppliedToast }}
                </span>
              </div>
              <div v-if="curveSolutions.length" class="mx-cs-right">
                <div class="mx-cs-sol-pills">
                  <button
                    v-for="(sol, idx) in curveSolutions.slice(0, 3)"
                    :key="
                      sol.variableKind +
                      ':' +
                      sol.variableId +
                      ':' +
                      (sol.secondVariableId || '') +
                      ':' +
                      (sol.formulaOverride || '')
                    "
                    type="button"
                    class="mx-cs-sol-pill"
                    :class="{ 'is-selected': selectedCurveSolutionIdx === idx }"
                    @mouseenter="focusSolutionOnCanvas(sol)"
                    @click="selectCurveSolution(idx)"
                  >
                    <span class="mx-cs-sol-lbl">{{ sol.variableLabel }}</span>
                    <span class="mx-cs-sol-arrow">
                      <template v-if="sol.formulaOverride"> ƒx→{{ sol.formulaOverride }} </template>
                      <template v-else>
                        {{ sol.currentValue }}→{{ sol.bestValue }}
                        <template v-if="sol.isPair && sol.secondBestValue !== undefined">
                          &amp; {{ sol.secondCurrentValue }}→{{ sol.secondBestValue }}
                        </template>
                      </template>
                    </span>
                  </button>
                </div>
                <button
                  type="button"
                  class="mx-cs-apply-btn"
                  @click="applySelectedCurveSolution(false)"
                >
                  {{ nextGenUi.applySolBtn }}
                </button>
              </div>
              <div v-else class="mx-cs-empty">
                {{ nextGenUi.noSolHint }}
              </div>
            </div>

            <svg
              class="mx-chart-svg"
              :class="{
                'is-curve-drag-mode': curveDragActive,
                'is-dragging-pin': isDraggingCurvePin
              }"
              :viewBox="`0 0 ${CW} ${CH}`"
              preserveAspectRatio="none"
              @pointerdown="onChartPointerDown"
              @mousemove="onChartMouseMove"
              @mouseleave="s.hoverStep.value = null"
              @click="onChartClick"
            >
              <!-- 水平网格线与 Y 轴刻度 -->
              <g v-for="frac in [0, 0.5, 1]" :key="frac">
                <line
                  :x1="PAD_L"
                  :x2="CW - PAD_R"
                  :y1="PAD_T + frac * PH"
                  :y2="PAD_T + frac * PH"
                  stroke="var(--border)"
                  stroke-opacity="0.65"
                  stroke-width="1"
                />
                <text
                  :x="PAD_L - 5"
                  :y="PAD_T + frac * PH + 3"
                  text-anchor="end"
                  font-size="9"
                  fill="var(--text-muted)"
                >
                  {{
                    !s.focusedSeriesId.value && chartScaleMode === 'norm'
                      ? `${Math.round((1 - frac) * 100)}%`
                      : Math.round((yBounds.max - frac * (yBounds.max - yBounds.min)) * 10) / 10
                  }}
                </text>
              </g>

              <!-- Forecast P10~P90 阴影置信带 -->
              <template v-if="showForecastBand && s.forecast.value">
                <path
                  v-for="sr in visibleSeries"
                  :key="'fc-' + sr.id"
                  :d="forecastAreaPath(sr.id)"
                  :fill="sr.color"
                  :fill-opacity="
                    isSeriesHighlighted(sr.id) ? 0.24 : isSeriesDimmed(sr.id) ? 0.04 : 0.14
                  "
                />
              </template>

              <!-- Compare 对比运行虚线 -->
              <template v-if="compareMode">
                <template v-for="cid in s.compareRunIds.value" :key="cid">
                  <polyline
                    v-for="sr in visibleSeries"
                    :key="cid + '-' + sr.id"
                    fill="none"
                    :stroke="sr.color"
                    :stroke-width="
                      isSeriesHighlighted(sr.id) ? 1.8 : isSeriesDimmed(sr.id) ? 1 : 1.2
                    "
                    stroke-dasharray="3 3"
                    :stroke-opacity="
                      isSeriesHighlighted(sr.id) ? 0.85 : isSeriesDimmed(sr.id) ? 0.15 : 0.55
                    "
                    :points="
                      polylinePointsForSeries(
                        sr,
                        (s.runs.value.find((r) => r.id === cid)?.snapshots ?? []).map((sn) =>
                          Number(sn[sr.id] ?? 0)
                        )
                      )
                    "
                  />
                </template>
              </template>

              <!-- 主序列完整折线（选中图例时保留全部折线，高亮目标折线并外发光，其余折线降暗置底） -->
              <template v-for="sr in visibleSeries" :key="sr.id">
                <polyline
                  v-if="isSeriesHighlighted(sr.id)"
                  fill="none"
                  :stroke="sr.color"
                  stroke-width="7.5"
                  stroke-opacity="0.24"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  pointer-events="none"
                  :points="seriesPolylineMap[sr.id]"
                />
                <!-- 宽热区隐形折线：让鼠标无需精确瞄准 2px 细线即可轻松按住上下拖动曲线 -->
                <polyline
                  v-if="isSeriesHighlighted(sr.id)"
                  class="mx-chart-polyline-hit"
                  fill="none"
                  stroke="transparent"
                  stroke-width="14"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  :points="seriesPolylineMap[sr.id]"
                  @pointerdown.stop="onSeriesPointerDown($event, sr)"
                  @click.stop="toggleFocusSeries(sr.id)"
                />
                <polyline
                  class="mx-chart-polyline"
                  fill="none"
                  :stroke="sr.color"
                  :stroke-width="
                    isSeriesHighlighted(sr.id) ? 3.5 : isSeriesDimmed(sr.id) ? 1.4 : 2.2
                  "
                  :stroke-opacity="isSeriesDimmed(sr.id) ? 0.2 : 1"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  :points="seriesPolylineMap[sr.id]"
                  @pointerdown.stop="onSeriesPointerDown($event, sr)"
                  @click.stop="toggleFocusSeries(sr.id)"
                />
              </template>

              <!-- 🎯 曲线反推预测虚线与可拖拽靶心手柄 + ◆ 贝塞尔斜率控制点 -->
              <template v-if="curveDragActive && focusedSeriesObj">
                <!-- 贝塞尔控制柄切线导引虚线：(0, Y0) --->
                (Tc, Yc) ---> (T1, Y1) -->
                <polyline
                  v-if="curveDualPinActive && curveTangentGuidePoints"
                  fill="none"
                  :stroke="focusedSeriesObj.color"
                  stroke-width="1.3"
                  stroke-dasharray="3 4"
                  stroke-opacity="0.5"
                  pointer-events="none"
                  :points="curveTangentGuidePoints"
                />
                <polyline
                  v-if="curvePreviewPolylinePoints"
                  fill="none"
                  :stroke="focusedSeriesObj.color"
                  stroke-width="2.6"
                  stroke-dasharray="5 3"
                  stroke-opacity="0.92"
                  pointer-events="none"
                  :points="curvePreviewPolylinePoints"
                />
                <line
                  :x1="xAt(curveTargetStep, maxSteps)"
                  :x2="xAt(curveTargetStep, maxSteps)"
                  :y1="PAD_T"
                  :y2="CH - PAD_B"
                  :stroke="focusedSeriesObj.color"
                  stroke-width="1"
                  stroke-dasharray="3 3"
                  stroke-opacity="0.4"
                  pointer-events="none"
                />
                <!-- 原始值到目标靶心的橡皮筋牵引线与基线锚点 -->
                <line
                  v-if="Math.abs(curveTargetVal - curveOriginalValAtStep) > 0.2"
                  :x1="xAt(curveTargetStep, maxSteps)"
                  :x2="xAt(curveTargetStep, maxSteps)"
                  :y1="yAtForSeries(focusedSeriesObj, curveOriginalValAtStep)"
                  :y2="yAtForSeries(focusedSeriesObj, curveTargetVal)"
                  :stroke="focusedSeriesObj.color"
                  stroke-width="2.2"
                  stroke-opacity="0.75"
                  pointer-events="none"
                />
                <circle
                  v-if="Math.abs(curveTargetVal - curveOriginalValAtStep) > 0.2"
                  :cx="xAt(curveTargetStep, maxSteps)"
                  :cy="yAtForSeries(focusedSeriesObj, curveOriginalValAtStep)"
                  r="3.5"
                  fill="var(--bg-panel)"
                  :stroke="focusedSeriesObj.color"
                  stroke-width="1.6"
                  stroke-opacity="0.75"
                  pointer-events="none"
                />
                <g
                  class="mx-curve-target-pin"
                  :transform="`translate(${xAt(curveTargetStep, maxSteps)}, ${yAtForSeries(focusedSeriesObj, curveTargetVal)})`"
                  @pointerdown.stop="startCurvePinDrag($event, 1)"
                  @click.stop
                >
                  <!-- 扩大的透明抓取热区 -->
                  <circle r="18" fill="transparent" />
                  <circle
                    r="11.5"
                    :fill="focusedSeriesObj.color"
                    fill-opacity="0.2"
                    :stroke="focusedSeriesObj.color"
                    stroke-width="1.5"
                    stroke-dasharray="2 2"
                  />
                  <circle
                    r="6"
                    :fill="focusedSeriesObj.color"
                    stroke="var(--bg-panel)"
                    stroke-width="2"
                  />
                  <text
                    :x="
                      curveTargetStep > maxSteps * 0.78
                        ? -13
                        : curveTargetStep < maxSteps * 0.18
                          ? 13
                          : 0
                    "
                    :y="yAtForSeries(focusedSeriesObj, curveTargetVal) < PAD_T + 20 ? 19 : -13"
                    :text-anchor="
                      curveTargetStep > maxSteps * 0.78
                        ? 'end'
                        : curveTargetStep < maxSteps * 0.18
                          ? 'start'
                          : 'middle'
                    "
                    font-size="9.5"
                    font-weight="700"
                    :fill="focusedSeriesObj.color"
                    stroke="var(--bg-panel)"
                    stroke-width="3"
                    paint-order="stroke"
                  >
                    🎯 {{ curveTargetVal }} (T={{ curveTargetStep }})
                  </text>
                </g>
                <template v-if="curveDualPinActive">
                  <line
                    :x1="xAt(curveTargetStep2, maxSteps)"
                    :x2="xAt(curveTargetStep2, maxSteps)"
                    :y1="PAD_T"
                    :y2="CH - PAD_B"
                    :stroke="focusedSeriesObj.color"
                    stroke-width="1.1"
                    stroke-dasharray="2 3"
                    stroke-opacity="0.38"
                    pointer-events="none"
                  />
                  <g
                    class="mx-curve-target-pin mx-curve-slope-pin"
                    :transform="`translate(${xAt(curveTargetStep2, maxSteps)}, ${yAtForSeries(focusedSeriesObj, curveTargetVal2)})`"
                    @pointerdown.stop="startCurvePinDrag($event, 2)"
                    @click.stop
                  >
                    <circle r="18" fill="transparent" />
                    <circle
                      r="10.5"
                      :fill="focusedSeriesObj.color"
                      fill-opacity="0.16"
                      :stroke="focusedSeriesObj.color"
                      stroke-width="1.4"
                      stroke-dasharray="2 2"
                    />
                    <rect
                      x="-5.2"
                      y="-5.2"
                      width="10.4"
                      height="10.4"
                      rx="1.8"
                      transform="rotate(45)"
                      :fill="focusedSeriesObj.color"
                      stroke="var(--bg-panel)"
                      stroke-width="2"
                    />
                    <text
                      :x="
                        curveTargetStep2 > maxSteps * 0.78
                          ? -12
                          : curveTargetStep2 < maxSteps * 0.18
                            ? 12
                            : 0
                      "
                      :y="yAtForSeries(focusedSeriesObj, curveTargetVal2) < PAD_T + 20 ? 18 : -13"
                      :text-anchor="
                        curveTargetStep2 > maxSteps * 0.78
                          ? 'end'
                          : curveTargetStep2 < maxSteps * 0.18
                            ? 'start'
                            : 'middle'
                      "
                      font-size="9"
                      font-weight="700"
                      :fill="focusedSeriesObj.color"
                      stroke="var(--bg-panel)"
                      stroke-width="3"
                      paint-order="stroke"
                    >
                      ◆ {{ curveTargetVal2 }} ({{ curveSlopeBadgeText }})
                    </text>
                  </g>
                </template>
              </template>

              <!-- 当前/悬停 Step 竖向游标线与圆点 + 交点数值胶囊 -->
              <line
                :x1="xAt(inspectedStep, maxSteps)"
                :x2="xAt(inspectedStep, maxSteps)"
                :y1="PAD_T"
                :y2="CH - PAD_B"
                stroke="var(--text-muted)"
                stroke-width="1"
                stroke-dasharray="2 2"
              />
              <circle
                v-for="sr in visibleSeries"
                :key="'dot-' + sr.id"
                :cx="xAt(inspectedStep, maxSteps)"
                :cy="
                  yAtForSeries(sr, sr.values[Math.min(inspectedStep, sr.values.length - 1)] ?? 0)
                "
                :r="isSeriesHighlighted(sr.id) ? 5 : isSeriesDimmed(sr.id) ? 2.5 : 3.5"
                :fill="sr.color"
                :opacity="isSeriesDimmed(sr.id) ? 0.25 : 1"
                stroke="var(--bg-panel)"
                :stroke-width="isSeriesHighlighted(sr.id) ? 2 : 1.5"
              />
              <g
                v-for="pt in inspectedIntersectionLabels"
                :key="'val-' + pt.id"
                pointer-events="none"
              >
                <line
                  v-if="Math.abs(pt.labelY - pt.cy) > 1.5"
                  :x1="pt.cx"
                  :y1="pt.cy"
                  :x2="pt.side === 'right' ? pt.rectX : pt.rectX + pt.pillW"
                  :y2="pt.labelY"
                  :stroke="pt.color"
                  stroke-width="1"
                  stroke-opacity="0.65"
                />
                <rect
                  :x="pt.rectX"
                  :y="pt.rectY"
                  :width="pt.pillW"
                  :height="pt.pillH"
                  rx="3.5"
                  fill="var(--bg-panel)"
                  fill-opacity="0.9"
                  :stroke="pt.color"
                  :stroke-width="pt.highlighted ? 1.4 : 0.9"
                  stroke-opacity="0.8"
                />
                <text
                  :x="pt.textX"
                  :y="pt.labelY + 3.1"
                  text-anchor="middle"
                  :font-size="pt.highlighted ? 9.2 : 8.5"
                  font-weight="700"
                  :fill="pt.color"
                >
                  {{ pt.valText }}
                </text>
              </g>

              <!-- X 轴刻度 -->
              <text :x="PAD_L" :y="CH - 5" font-size="9" fill="var(--text-muted)">0</text>
              <text
                :x="PAD_L + PW / 2"
                :y="CH - 5"
                text-anchor="middle"
                font-size="9"
                fill="var(--text-muted)"
              >
                {{ Math.round(maxSteps / 2) }}
              </text>
              <text
                :x="CW - PAD_R"
                :y="CH - 5"
                text-anchor="end"
                font-size="9"
                fill="var(--text-muted)"
              >
                {{ maxSteps }}
              </text>
            </svg>
          </div>

          <!-- 右侧 STEP N 数值简表 -->
          <aside class="mx-step-table-col">
            <div class="mx-step-hdr">
              <span>STEP {{ inspectedStep }}</span>
              <span>VALUE</span>
              <span
                class="mx-step-axis-hdr"
                @click="chartScaleMode = chartScaleMode === 'raw' ? 'norm' : 'raw'"
              >
                AXIS
              </span>
            </div>
            <div class="mx-step-rows">
              <div
                v-for="sr in seriesList"
                :key="sr.id"
                class="mx-step-row"
                :class="{
                  'is-focused': isSeriesHighlighted(sr.id),
                  'is-dimmed': isSeriesDimmed(sr.id)
                }"
                @click="toggleFocusSeries(sr.id)"
              >
                <span class="mx-step-name">
                  <span class="mx-dot" :style="{ background: sr.color }" />
                  <span class="mx-step-label-text">{{ sr.label }}</span>
                </span>
                <span class="mx-step-val">{{ sr.currentVal }}</span>
                <span class="mx-step-axis">
                  {{
                    isSeriesHighlighted(sr.id)
                      ? 'Y1*'
                      : isSeriesDimmed(sr.id) || chartScaleMode === 'norm'
                        ? 'NORM'
                        : 'Y1'
                  }}
                </span>
              </div>
            </div>
          </aside>
        </div>

        <!-- 底部横向滚动的节点自然语言趋势卡片（复刻截图下半部分） -->
        <div v-if="showTrendCardsStrip" class="mx-cards-strip">
          <!-- 总览卡片（含全序列微缩折线图） -->
          <div
            class="mx-summary-card is-overview"
            :class="{ 'is-focused': !s.focusedSeriesId.value }"
            @click="s.focusedSeriesId.value = ''"
          >
            <div class="mx-card-top">
              <span class="mx-card-title">{{ t('mx.results.summary') }}</span>
              <span class="mx-card-step">{{ seriesList.length }} series</span>
            </div>
            <div class="mx-card-mid">
              <div class="mx-card-big">
                {{ s.activeRun.value ? s.activeRun.value.stepsRun : s.playStep.value }}
                <span class="mx-card-sub">
                  {{ t('mx.results.ofSteps', { n: s.doc.value.settings.steps }) }}
                </span>
              </div>
              <svg class="mx-sparkline" viewBox="0 0 72 28">
                <polyline
                  v-for="sr in seriesList"
                  :key="'ov-' + sr.id"
                  fill="none"
                  :stroke="sr.color"
                  stroke-width="1.3"
                  stroke-opacity="0.85"
                  :points="sparklinePoints(sr.values)"
                />
              </svg>
            </div>
            <div class="mx-card-line">
              ✓
              {{
                t('mx.results.finishedChanged', {
                  changed: changedNodesCount,
                  total: seriesList.length
                })
              }}
            </div>
            <div class="mx-card-line is-muted">
              +{{ s.activeRun.value?.totalProduced ?? 0 }} / -{{
                s.activeRun.value?.totalConsumed ?? 0
              }}
            </div>
          </div>

          <!-- 各追踪节点卡片 -->
          <div
            v-for="sr in seriesList"
            :key="sr.id"
            class="mx-summary-card"
            :class="{
              'is-focused': isSeriesHighlighted(sr.id),
              'is-dimmed': isSeriesDimmed(sr.id)
            }"
            :style="isSeriesHighlighted(sr.id) ? { borderColor: sr.color } : undefined"
            @click="toggleFocusSeries(sr.id)"
          >
            <div class="mx-card-top">
              <span class="mx-dot" :style="{ background: sr.color }" />
              <span class="mx-card-title">{{ sr.label }}</span>
              <span class="mx-card-step">at step {{ maxSteps }}</span>
            </div>
            <div class="mx-card-mid">
              <span class="mx-card-big">{{ sr.summary.final }}</span>
              <svg class="mx-sparkline" viewBox="0 0 72 28">
                <polyline
                  fill="none"
                  :stroke="sr.color"
                  stroke-width="1.8"
                  :points="sparklinePoints(sr.values)"
                />
              </svg>
            </div>
            <div class="mx-card-line">{{ formatTrendLine1(sr.summary) }}</div>
            <div class="mx-card-line is-muted">{{ formatTrendLine2(sr.summary) }}</div>
          </div>
        </div>
      </template>

      <!-- ─── TAB 1.5: PLAYABLE CARD & HUD PROTOTYPE (🎮 机制一键试玩卡片台) ─── -->
      <template v-else-if="s.resultsTab.value === 'playable'">
        <div class="mx-playable-wrap">
          <!-- 左栏：实时状态与资源槽 HUD -->
          <aside class="mx-playable-hud-col">
            <div class="mx-playable-sec-hdr">
              <span>{{ nextGenUi.hudTitle }}</span>
              <span class="mx-playable-cnt">{{ playableHud.gauges.length }}</span>
            </div>
            <div class="mx-hud-gauge-list">
              <div
                v-for="g in playableHud.gauges"
                :key="g.id"
                class="mx-hud-gauge"
                :class="{
                  'is-danger': g.isDanger,
                  'is-selected': s.selection.nodes.includes(g.id),
                  'is-just-changed': justChangedNodeIds.includes(g.id)
                }"
                @click="s.select([g.id])"
              >
                <div class="mx-hud-top">
                  <span class="mx-hud-name">
                    <span class="mx-dot" :style="{ background: g.color }" />
                    {{ g.label }}
                  </span>
                  <span class="mx-hud-val-group">
                    <strong class="mx-hud-val">{{ g.value }}</strong>
                    <span v-if="g.capacity && g.capacity > 0" class="mx-hud-cap"
                      >/ {{ g.capacity }}</span
                    >
                    <span
                      v-if="g.delta !== 0"
                      class="mx-hud-delta"
                      :class="g.delta > 0 ? 'is-pos' : 'is-neg'"
                    >
                      {{ g.delta > 0 ? `+${g.delta}` : g.delta }}
                    </span>
                  </span>
                </div>
                <div class="mx-hud-bar-track">
                  <div
                    class="mx-hud-bar-fill"
                    :style="{ width: `${g.fillPercent}%`, background: g.color }"
                  />
                </div>
                <div v-if="g.autoInflow || g.autoOutflow || g.endWhen" class="mx-hud-badges">
                  <span v-if="g.autoInflow" class="mx-hud-badge is-in">
                    <button
                      v-if="isNumericFormula(g.autoInflow)"
                      type="button"
                      class="mx-inline-nudge-btn"
                      @click.stop="nudgePlayableTunable('node_auto_inflow', g.id, g.autoInflow, -1)"
                    >
                      -
                    </button>
                    <span>+{{ g.autoInflow }}/T</span>
                    <button
                      v-if="isNumericFormula(g.autoInflow)"
                      type="button"
                      class="mx-inline-nudge-btn"
                      @click.stop="nudgePlayableTunable('node_auto_inflow', g.id, g.autoInflow, 1)"
                    >
                      +
                    </button>
                  </span>
                  <span v-if="g.autoOutflow" class="mx-hud-badge is-out">
                    <button
                      v-if="isNumericFormula(g.autoOutflow)"
                      type="button"
                      class="mx-inline-nudge-btn"
                      @click.stop="
                        nudgePlayableTunable('node_auto_outflow', g.id, g.autoOutflow, -1)
                      "
                    >
                      -
                    </button>
                    <span>-{{ g.autoOutflow }}/T</span>
                    <button
                      v-if="isNumericFormula(g.autoOutflow)"
                      type="button"
                      class="mx-inline-nudge-btn"
                      @click.stop="
                        nudgePlayableTunable('node_auto_outflow', g.id, g.autoOutflow, 1)
                      "
                    >
                      +
                    </button>
                  </span>
                  <span v-if="g.endWhen" class="mx-hud-badge is-end">🏁 {{ g.endWhen }}</span>
                </div>
              </div>
            </div>
          </aside>

          <!-- 中栏：可点击动作与合成卡牌台 -->
          <main class="mx-playable-deck-col">
            <div class="mx-playable-sec-hdr">
              <span>{{ nextGenUi.deckTitle }}</span>
              <span class="mx-playable-cnt">{{ playableHud.actionCards.length }} cards</span>
            </div>
            <div v-if="lastPlayedCardBanner" class="mx-played-feedback-banner">
              {{ lastPlayedCardBanner }}
            </div>
            <div class="mx-play-cards-grid">
              <div
                v-for="card in playableHud.actionCards"
                :key="card.id"
                class="mx-play-card"
                :class="{
                  'is-playable': card.canPlay,
                  'is-disabled': !card.canPlay,
                  'is-selected': s.selection.nodes.includes(card.id),
                  'is-ai-recommended': card.aiRecommended,
                  'is-just-changed': justChangedNodeIds.includes(card.id)
                }"
                :style="{ '--card-accent': card.color }"
                @click="s.select([card.id])"
              >
                <div class="mx-pc-header">
                  <span class="mx-pc-title">{{ card.label }}</span>
                  <div class="mx-pc-hdr-badges">
                    <span v-if="card.aiRecommended" class="mx-pc-ai-badge">
                      {{ nextGenUi.aiBestMoveBadge }}
                    </span>
                    <span
                      v-if="card.cooldownRemaining && card.cooldownRemaining > 0"
                      class="mx-pc-cd-badge is-locked"
                    >
                      {{ nextGenUi.cdLockedBadge(card.cooldownRemaining) }}
                    </span>
                    <span
                      v-else-if="card.cooldownSteps && card.cooldownSteps > 0"
                      class="mx-pc-cd-badge"
                    >
                      {{ nextGenUi.cdConfigBadge(card.cooldownSteps) }}
                    </span>
                    <span class="mx-pc-trig-badge" :class="`trig-${card.trigger}`">
                      {{
                        card.trigger === 'interactive'
                          ? nextGenUi.trigClickBadge
                          : card.trigger === 'automatic'
                            ? nextGenUi.trigAutoBadge
                            : nextGenUi.trigPassiveBadge
                      }}
                    </span>
                  </div>
                </div>

                <!-- 消耗 Costs -->
                <div class="mx-pc-body">
                  <div v-if="card.costs.length" class="mx-pc-section">
                    <div
                      v-for="c in card.costs"
                      :key="c.edgeId"
                      class="mx-pc-cost-chip"
                      :class="c.affordable ? 'is-ok' : 'is-lack'"
                    >
                      <span class="mx-pc-chip-main">
                        <button
                          v-if="canTuneEdgeExpr(c.requiredExpr)"
                          type="button"
                          class="mx-inline-nudge-btn"
                          @click.stop="nudgePlayableEdgeExpr(c.edgeId, c.requiredExpr, -1)"
                        >
                          -
                        </button>
                        <span
                          >{{ c.affordable ? '✓' : '✗' }} -{{ c.requiredExpr }}
                          {{ c.sourceLabel }}</span
                        >
                        <button
                          v-if="canTuneEdgeExpr(c.requiredExpr)"
                          type="button"
                          class="mx-inline-nudge-btn"
                          @click.stop="nudgePlayableEdgeExpr(c.edgeId, c.requiredExpr, 1)"
                        >
                          +
                        </button>
                      </span>
                      <span class="mx-pc-chip-sub">({{ c.available }})</span>
                    </div>
                  </div>
                  <div v-else class="mx-pc-free-tag">
                    {{ nextGenUi.zeroCostTag }}
                  </div>

                  <!-- 状态守卫条件 -->
                  <div v-if="card.conditions.length" class="mx-pc-section">
                    <div
                      v-for="cond in card.conditions"
                      :key="cond.edgeId"
                      class="mx-pc-cond-chip"
                      :class="cond.met ? 'is-ok' : 'is-lack'"
                    >
                      🔒 {{ cond.sourceLabel }} {{ cond.condition }} ({{ cond.currentValue }})
                    </div>
                  </div>

                  <!-- 产出与暴击/掉落分支 -->
                  <div v-if="card.rewards.length" class="mx-pc-section is-rewards">
                    <div v-for="rw in card.rewards" :key="rw.edgeId" class="mx-pc-reward-row">
                      <template v-if="rw.isGate && rw.gateBranches?.length">
                        <div class="mx-pc-gate-box">
                          <div class="mx-pc-gate-hdr">
                            <span>🎲 {{ rw.targetLabel }}</span>
                            <span v-if="rw.gatePityInfo" class="mx-pc-pity-pill">
                              🎯 {{ rw.gatePityInfo }}
                            </span>
                          </div>
                          <div v-if="rw.pityHardMax && rw.pityHardMax > 0" class="mx-pc-pity-track">
                            <div
                              class="mx-pc-pity-fill"
                              :style="{
                                width: `${Math.min(100, Math.round(((rw.pityCurrentPulls ?? 0) / rw.pityHardMax) * 100))}%`
                              }"
                            />
                          </div>
                          <div class="mx-pc-gate-branches">
                            <span
                              v-for="(br, bIdx) in rw.gateBranches"
                              :key="bIdx"
                              class="mx-pc-branch-chip"
                            >
                              {{ br.weightLabel }} → {{ br.targetLabel }}
                            </span>
                          </div>
                        </div>
                      </template>
                      <template v-else>
                        <span class="mx-pc-reward-chip">
                          <button
                            v-if="canTuneEdgeExpr(rw.amountExpr)"
                            type="button"
                            class="mx-inline-nudge-btn"
                            @click.stop="nudgePlayableEdgeExpr(rw.edgeId, rw.amountExpr, -1)"
                          >
                            -
                          </button>
                          <span>✨ +{{ rw.amountExpr }} {{ rw.targetLabel }}</span>
                          <button
                            v-if="canTuneEdgeExpr(rw.amountExpr)"
                            type="button"
                            class="mx-inline-nudge-btn"
                            @click.stop="nudgePlayableEdgeExpr(rw.edgeId, rw.amountExpr, 1)"
                          >
                            +
                          </button>
                        </span>
                      </template>
                    </div>
                  </div>
                </div>

                <!-- 底部动作按钮与不可用原因 -->
                <div class="mx-pc-footer">
                  <button
                    type="button"
                    class="mx-pc-play-btn"
                    :disabled="playableHud.ended"
                    @click.stop="onPlayCard(card)"
                  >
                    {{ card.canPlay ? nextGenUi.playCardBtn : nextGenUi.forceFireBtn }}
                  </button>
                  <span v-if="card.disabledReason" class="mx-pc-reason">
                    {{ card.disabledReason }}
                  </span>
                </div>
              </div>
            </div>
          </main>

          <!-- 右栏：回合控制与实时战报 -->
          <aside class="mx-playable-turn-col">
            <div class="mx-playable-sec-hdr">
              <span>{{ nextGenUi.turnTitle }}</span>
              <span class="mx-playable-step-pill">{{ nextGenUi.stepBadge(playableHud.step) }}</span>
            </div>

            <div v-if="playableHud.ended" class="mx-playable-ended-banner">
              {{ nextGenUi.endedBanner(playableHud.endReason || 'Done') }}
            </div>

            <div class="mx-playable-turn-btns">
              <button
                type="button"
                class="mx-turn-btn is-primary"
                :disabled="playableHud.ended"
                @click="onNextTurnClick"
              >
                {{ nextGenUi.nextTurnBtn }}
              </button>
              <button
                type="button"
                class="mx-turn-btn is-ai-spectator"
                :class="{ 'is-active': aiSpectatorActive }"
                @click="toggleAiSpectator"
              >
                {{ aiSpectatorActive ? nextGenUi.aiAutoPlayStopBtn : nextGenUi.aiAutoPlayBtn }}
              </button>
              <div class="mx-turn-btn-row">
                <button
                  type="button"
                  class="mx-turn-btn"
                  :disabled="playableHud.ended"
                  @click="onFastForward5Click"
                >
                  {{ nextGenUi.fast5Btn }}
                </button>
                <button type="button" class="mx-turn-btn" @click="onResetPlayClick">
                  {{ nextGenUi.resetRunBtn }}
                </button>
              </div>
            </div>

            <!-- 📼 已录制出牌操作序列与一键回归重放 -->
            <div v-if="recordedMacroSteps.length" class="mx-macro-tape-box">
              <div class="mx-macro-hdr">
                <span class="mx-macro-title">
                  {{ nextGenUi.macroTapeTitle(recordedMacroSteps.length) }}
                </span>
                <div class="mx-macro-hdr-btns">
                  <button type="button" class="mx-macro-replay-btn" @click="onReplayRecordedMacro">
                    {{ nextGenUi.macroReplayBtn }}
                  </button>
                  <button
                    type="button"
                    class="mx-macro-clear-btn"
                    :title="nextGenUi.macroClearTip"
                    @click="clearRecordedMacro"
                  >
                    ×
                  </button>
                </div>
              </div>
              <div class="mx-macro-chips">
                <span
                  v-for="(mStep, mIdx) in recordedMacroSteps.slice(-8)"
                  :key="mIdx"
                  class="mx-macro-chip"
                >
                  {{
                    mStep.kind === 'card'
                      ? `🃏 ${mStep.label || mStep.nodeId}`
                      : `▶ +${mStep.steps ?? 1}T`
                  }}
                </span>
              </div>
            </div>

            <div class="mx-playable-log-list">
              <div
                v-for="(ev, idx) in playableBattleLog"
                :key="idx"
                class="mx-playable-log-item"
                :class="`kind-${ev.type}`"
              >
                <span class="mx-plog-step">T{{ ev.step }}</span>
                <span class="mx-plog-msg">
                  {{ nodeName(ev.nodeId) }}{{ ev.targetId ? ` → ${nodeName(ev.targetId)}` : '' }}
                  {{ ev.amount ?? '' }} {{ ev.detail ?? '' }}
                </span>
              </div>
              <div v-if="!playableBattleLog.length" class="mx-playable-log-empty">
                {{ nextGenUi.emptyLogHint }}
              </div>
            </div>
          </aside>
        </div>
      </template>

      <!-- ─── TAB 2: ECONOMY DIAGNOSTICS (深度数值健康度与瓶颈诊断) ─── -->
      <template v-else-if="s.resultsTab.value === 'diagnostics'">
        <div class="mx-diag-wrap">
          <div class="mx-diag-kpis">
            <div class="mx-diag-score-card" :class="`grade-${healthReport.grade.toLowerCase()}`">
              <div class="mx-diag-grade">{{ healthReport.grade }}</div>
              <div class="mx-diag-score-meta">
                <span class="mx-diag-score-num">{{ healthReport.score }}/100</span>
                <span class="mx-diag-score-lbl">{{ t('mx.diag.healthScore') }}</span>
              </div>
            </div>
            <div class="mx-diag-kpi">
              <span class="mx-diag-kpi-lbl">{{ t('mx.diag.faucetSinkRatio') }}</span>
              <span class="mx-diag-kpi-val">{{ healthReport.faucetSinkRatio }}x</span>
            </div>
            <div class="mx-diag-kpi">
              <span class="mx-diag-kpi-lbl">{{ t('mx.diag.netFlowPerStep') }}</span>
              <span class="mx-diag-kpi-val">
                {{
                  healthReport.netFlowPerStep > 0
                    ? `+${healthReport.netFlowPerStep}`
                    : healthReport.netFlowPerStep
                }}
              </span>
            </div>
            <div class="mx-diag-kpi">
              <span class="mx-diag-kpi-lbl">{{ t('mx.diag.blockedConverters') }}</span>
              <span class="mx-diag-kpi-val" :class="{ 'is-warn': healthReport.blockedCount > 0 }">
                {{ healthReport.blockedCount }}
              </span>
            </div>
            <div class="mx-diag-kpi">
              <span class="mx-diag-kpi-lbl">{{ t('mx.diag.cappedDepleted') }}</span>
              <span class="mx-diag-kpi-val">
                {{ healthReport.cappedPoolsCount }} / {{ healthReport.depletedPoolsCount }}
              </span>
            </div>
            <button
              v-if="fixableIssueCount > 0"
              type="button"
              class="mx-diag-fix-all-btn"
              @click="onQuickFixAllFindings"
            >
              ⚡ {{ t('mx.diag.fixAllBtn', { count: fixableIssueCount }) }}
            </button>
          </div>

          <div class="mx-diag-list">
            <div
              v-for="f in healthReport.findings"
              :key="f.id"
              class="mx-diag-item"
              :class="`sev-${f.severity}`"
              @click="jumpToFinding(f)"
            >
              <span class="mx-diag-badge">{{ f.severity.toUpperCase() }}</span>
              <span class="mx-diag-text">{{ formatFindingText(f) }}</span>
              <span v-if="f.step !== undefined" class="mx-diag-jump"> Step #{{ f.step }} → </span>
              <div v-if="canQuickFixMxDiagnosticFinding(f)" class="mx-diag-actions">
                <button
                  type="button"
                  class="mx-diag-action-btn is-primary"
                  @click.stop="onQuickFixFinding(f)"
                >
                  ⚡ {{ t('mx.diag.quickFixBtn') }}
                </button>
                <button
                  type="button"
                  class="mx-diag-action-btn"
                  @click.stop="openFindingInBalancer(f)"
                >
                  🎯 {{ t('mx.diag.tuneInBalancerBtn') }}
                </button>
              </div>
            </div>
          </div>
        </div>
      </template>

      <!-- ─── TAB 3: AUTO-BALANCER (GOAL-SEEK & PARAMETER SWEEP) ─── -->
      <template v-else-if="s.resultsTab.value === 'balancer'">
        <div class="mx-balancer-wrap">
          <div class="mx-balancer-controls">
            <div class="mx-bal-mode-pills">
              <button
                type="button"
                class="mx-bal-pill"
                :class="{ 'is-active': balancerMode === 'goal_seek' }"
                @click="balancerMode = 'goal_seek'"
              >
                🎯 {{ t('mx.balancer.modeGoalSeek') }}
              </button>
              <button
                type="button"
                class="mx-bal-pill"
                :class="{ 'is-active': balancerMode === 'sweep' }"
                @click="balancerMode = 'sweep'"
              >
                📊 {{ t('mx.balancer.modeSweep') }}
              </button>
              <button
                type="button"
                class="mx-bal-pill"
                :class="{ 'is-active': balancerMode === 'matrix' }"
                @click="balancerMode = 'matrix'"
              >
                🔥 {{ t('mx.balancer.modeMatrix') }}
              </button>
            </div>

            <div class="mx-bal-form-row">
              <label class="mx-bal-field">
                <span>{{ t('mx.balancer.tunableVar') }}</span>
                <select
                  :value="activeTunable?.key ?? ''"
                  class="mx-bal-select"
                  @change="onSelectTunableChange"
                >
                  <option v-for="opt in tunableOptions" :key="opt.key" :value="opt.key">
                    {{ opt.label }}
                  </option>
                </select>
              </label>

              <label class="mx-bal-field mx-bal-field--sm">
                <span>{{ t('mx.balancer.minVal') }}</span>
                <input v-model.number="tuneMin" type="number" step="0.5" class="mx-bal-input" />
              </label>

              <label class="mx-bal-field mx-bal-field--sm">
                <span>{{ t('mx.balancer.maxVal') }}</span>
                <input v-model.number="tuneMax" type="number" step="0.5" class="mx-bal-input" />
              </label>

              <template v-if="balancerMode === 'goal_seek'">
                <label class="mx-bal-field">
                  <span>{{ t('mx.balancer.metric') }}</span>
                  <select v-model="goalMetric" class="mx-bal-select">
                    <option value="health_score">
                      🩺 {{ t('mx.balancer.metricHealthScore') }}
                    </option>
                    <option value="node_value">{{ t('mx.balancer.metricNodeVal') }}</option>
                    <option value="end_step">{{ t('mx.balancer.metricEndStep') }}</option>
                  </select>
                </label>

                <label v-if="goalMetric === 'node_value'" class="mx-bal-field">
                  <span>{{ t('mx.balancer.targetNode') }}</span>
                  <select
                    :value="activeTargetNodeId"
                    class="mx-bal-select"
                    @change="goalTargetNodeId = ($event.target as HTMLSelectElement).value"
                  >
                    <option v-for="n in trackedNodes" :key="n.id" :value="n.id">
                      {{ n.label }}
                    </option>
                  </select>
                </label>

                <label v-if="goalMetric === 'node_value'" class="mx-bal-field mx-bal-field--sm">
                  <span>{{ t('mx.balancer.atStep') }}</span>
                  <input
                    v-model.number="goalTargetStep"
                    type="number"
                    min="1"
                    class="mx-bal-input"
                  />
                </label>

                <label v-if="goalMetric !== 'health_score'" class="mx-bal-field mx-bal-field--sm">
                  <span>{{ t('mx.balancer.targetVal') }}</span>
                  <input
                    v-model.number="goalTargetValue"
                    type="number"
                    step="1"
                    class="mx-bal-input"
                  />
                </label>

                <button type="button" class="mx-bal-run-btn" @click="executeGoalSeek">
                  ⚡ {{ t('mx.balancer.runGoalSeek') }}
                </button>
              </template>

              <template v-else-if="balancerMode === 'sweep'">
                <label class="mx-bal-field mx-bal-field--sm">
                  <span>{{ t('mx.balancer.samples') }}</span>
                  <input
                    v-model.number="sweepSamples"
                    type="number"
                    min="3"
                    max="25"
                    class="mx-bal-input"
                  />
                </label>

                <button type="button" class="mx-bal-run-btn" @click="executeSweep">
                  📊 {{ t('mx.balancer.runSweep') }}
                </button>
              </template>

              <template v-else>
                <label class="mx-bal-field">
                  <span>Y:</span>
                  <select
                    :value="activeTunableY?.key ?? ''"
                    class="mx-bal-select"
                    @change="onSelectTunableYChange"
                  >
                    <option v-for="opt in tunableOptions" :key="opt.key" :value="opt.key">
                      {{ opt.label }}
                    </option>
                  </select>
                </label>

                <label class="mx-bal-field mx-bal-field--sm">
                  <span>{{ t('mx.balancer.minVal') }}</span>
                  <input v-model.number="tuneMinY" type="number" step="0.5" class="mx-bal-input" />
                </label>

                <label class="mx-bal-field mx-bal-field--sm">
                  <span>{{ t('mx.balancer.maxVal') }}</span>
                  <input v-model.number="tuneMaxY" type="number" step="0.5" class="mx-bal-input" />
                </label>

                <label class="mx-bal-field">
                  <span>{{ t('mx.balancer.targetNode') }}</span>
                  <select
                    :value="activeTargetNodeId"
                    class="mx-bal-select"
                    @change="goalTargetNodeId = ($event.target as HTMLSelectElement).value"
                  >
                    <option v-for="n in trackedNodes" :key="n.id" :value="n.id">
                      {{ n.label }}
                    </option>
                  </select>
                </label>

                <button type="button" class="mx-bal-run-btn" @click="executeMatrix">
                  🔥 {{ t('mx.balancer.runMatrix') }}
                </button>
              </template>
            </div>
          </div>

          <!-- Goal-Seek Result Area -->
          <div v-if="balancerMode === 'goal_seek'" class="mx-bal-body">
            <div v-if="goalSeekRes" class="mx-gs-result">
              <div class="mx-gs-summary-card">
                <div class="mx-gs-stat">
                  <span class="mx-gs-lbl">{{ t('mx.balancer.bestValue') }}</span>
                  <strong class="mx-gs-val is-accent">{{ goalSeekRes.bestValue }}</strong>
                </div>
                <div class="mx-gs-stat">
                  <span class="mx-gs-lbl">{{ t('mx.balancer.achievedValue') }}</span>
                  <strong class="mx-gs-val">{{ goalSeekRes.achievedValue }}</strong>
                </div>
                <div class="mx-gs-stat">
                  <span class="mx-gs-lbl">{{ t('mx.balancer.errorDelta') }}</span>
                  <strong class="mx-gs-val">±{{ goalSeekRes.error }}</strong>
                </div>
                <button type="button" class="mx-gs-apply-btn" @click="applyBestGoalSeek">
                  ✓ {{ t('mx.balancer.applyBest') }}
                </button>
              </div>

              <div class="mx-gs-samples-table-wrap">
                <table class="mx-debugger-table">
                  <thead>
                    <tr>
                      <th>{{ t('mx.balancer.colParamVal') }}</th>
                      <th>{{ t('mx.balancer.colAchieved') }}</th>
                      <th>{{ t('mx.balancer.colError') }}</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr
                      v-for="(sp, idx) in goalSeekRes.candidates"
                      :key="idx"
                      :class="{ 'is-best-row': sp.variableValue === goalSeekRes.bestValue }"
                    >
                      <td class="mx-mono">{{ sp.variableValue }}</td>
                      <td class="mx-mono">{{ sp.achievedValue }}</td>
                      <td class="mx-mono">{{ sp.error }}</td>
                      <td>
                        <button
                          type="button"
                          class="mx-mini-apply"
                          @click="
                            s.applyTunableValue(
                              goalSeekRes.variableKind,
                              goalSeekRes.variableId,
                              sp.variableValue
                            )
                          "
                        >
                          {{ t('mx.balancer.useVal') }}
                        </button>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
            <div v-else class="mx-bal-empty">
              {{ t('mx.balancer.goalSeekHint') }}
            </div>
          </div>

          <!-- Parameter Sweep Result Area -->
          <div v-else-if="balancerMode === 'sweep'" class="mx-bal-body">
            <div v-if="sweepRes" class="mx-sweep-result">
              <div class="mx-sweep-chart-box">
                <svg viewBox="0 0 440 130" class="mx-sweep-svg">
                  <line
                    x1="36"
                    y1="112"
                    x2="424"
                    y2="112"
                    stroke="var(--border)"
                    stroke-width="1"
                  />
                  <polyline
                    v-for="n in trackedNodes"
                    :key="n.id"
                    :points="sweepSeriesPolyline(n.id)"
                    fill="none"
                    :stroke="seriesColorForNode(n.id)"
                    stroke-width="2"
                  />
                </svg>
              </div>
              <div class="mx-gs-samples-table-wrap">
                <table class="mx-debugger-table">
                  <thead>
                    <tr>
                      <th>{{ sweepRes.variableId }}</th>
                      <th v-for="n in trackedNodes.slice(0, 4)" :key="n.id">{{ n.label }}</th>
                      <th>F/S Ratio</th>
                      <th>End Step</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="(pt, idx) in sweepRes.points" :key="idx">
                      <td class="mx-mono">
                        <strong>{{ pt.paramValue }}</strong>
                      </td>
                      <td v-for="n in trackedNodes.slice(0, 4)" :key="n.id" class="mx-mono">
                        {{ pt.nodeFinals[n.id] ?? 0 }}
                      </td>
                      <td class="mx-mono">{{ pt.faucetSinkRatio }}</td>
                      <td class="mx-mono">{{ pt.endStep ?? '-' }}</td>
                      <td>
                        <button
                          type="button"
                          class="mx-mini-apply"
                          @click="applySweepPoint(pt.paramValue)"
                        >
                          {{ t('mx.balancer.useVal') }}
                        </button>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
            <div v-else class="mx-bal-empty">
              {{ t('mx.balancer.sweepHint') }}
            </div>
          </div>

          <!-- 2D Parameter Matrix Heatmap Area -->
          <div v-else class="mx-bal-body">
            <div v-if="matrixRes" class="mx-sweep-result">
              <div class="mx-gs-samples-table-wrap">
                <table class="mx-debugger-table mx-matrix-table">
                  <thead>
                    <tr>
                      <th>Y \ X ({{ matrixRes.varXId }})</th>
                      <th v-for="xv in matrixRes.xValues" :key="xv" class="mx-mono">{{ xv }}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="(row, yIdx) in matrixRes.cells" :key="yIdx">
                      <td class="mx-mono">
                        <strong>{{ matrixRes.varYId }}={{ matrixRes.yValues[yIdx] }}</strong>
                      </td>
                      <td
                        v-for="(cell, xIdx) in row"
                        :key="xIdx"
                        class="mx-mono mx-matrix-cell"
                        :class="{
                          'is-selected':
                            selectedMatrixCell?.xVal === cell.xVal &&
                            selectedMatrixCell?.yVal === cell.yVal
                        }"
                        :style="matrixCellStyle(cell.value)"
                        @click="selectedMatrixCell = cell"
                      >
                        {{ cell.value }}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div v-if="selectedMatrixCell" class="mx-gs-summary-card">
                <div class="mx-gs-stat">
                  <span class="mx-gs-lbl">X ({{ matrixRes.varXId }})</span>
                  <strong class="mx-gs-val">{{ selectedMatrixCell.xVal }}</strong>
                </div>
                <div class="mx-gs-stat">
                  <span class="mx-gs-lbl">Y ({{ matrixRes.varYId }})</span>
                  <strong class="mx-gs-val">{{ selectedMatrixCell.yVal }}</strong>
                </div>
                <div class="mx-gs-stat">
                  <span class="mx-gs-lbl">{{ t('mx.balancer.achievedValue') }}</span>
                  <strong class="mx-gs-val is-accent">{{ selectedMatrixCell.value }}</strong>
                </div>
                <div class="mx-gs-stat">
                  <span class="mx-gs-lbl">F/S Ratio</span>
                  <strong class="mx-gs-val">{{ selectedMatrixCell.faucetSinkRatio }}x</strong>
                </div>
                <button
                  type="button"
                  class="mx-gs-apply-btn"
                  @click="applyMatrixCell(selectedMatrixCell)"
                >
                  ✓ {{ t('mx.balancer.applyPair') }}
                </button>
              </div>
            </div>
            <div v-else class="mx-bal-empty">
              {{ t('mx.balancer.matrixHint') }}
            </div>
          </div>
        </div>
      </template>

      <!-- ─── TAB 3.5: NUMERICAL & ROGUELIKE LAB ─── -->
      <template v-else-if="s.resultsTab.value === 'workbench'">
        <MxNumericalWorkbenchPanel />
      </template>

      <!-- ─── TAB 4: RUNTIME DEBUGGER ─── -->
      <template v-else>
        <div class="mx-debugger-wrap">
          <div class="mx-debugger-toolbar">
            <span>{{ t('mx.results.filterStep') }}:</span>
            <input
              v-model="debugFilterStep"
              type="number"
              class="mx-mini-input"
              placeholder="All"
              min="1"
            />
            <span class="mx-dbg-count">{{ debugEvents.length }} events</span>
          </div>
          <div class="mx-debugger-table-wrap">
            <table class="mx-debugger-table">
              <thead>
                <tr>
                  <th>Step</th>
                  <th>Type</th>
                  <th>Source</th>
                  <th>Target</th>
                  <th>Amount / Detail</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="(ev, idx) in debugEvents"
                  :key="idx"
                  @click="
                    () => {
                      s.playStep.value = ev.step
                      if (ev.nodeId) s.select([ev.nodeId])
                    }
                  "
                >
                  <td class="mx-mono">#{{ ev.step }}</td>
                  <td>
                    <span class="mx-ev-badge" :class="`is-${ev.type}`">{{ ev.type }}</span>
                  </td>
                  <td>{{ nodeName(ev.nodeId) }}</td>
                  <td>{{ nodeName(ev.targetId) }}</td>
                  <td class="mx-mono">{{ ev.amount ?? '' }} {{ ev.detail ?? '' }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </template>
    </div>

    <!-- ═════════════ 最底部播放控制栏（Transport Bar） ═════════════ -->
    <footer v-show="s.mode.value !== 'workbench'" class="mx-transport-bar">
      <div class="mx-tp-left">
        <button
          type="button"
          class="mx-tp-btn"
          :title="t('mx.transport.reset')"
          @click="onResetPlayClick"
        >
          ↺
        </button>
        <button
          type="button"
          class="mx-tp-btn is-play"
          :class="{ 'is-playing': s.playing.value }"
          :title="t('mx.transport.playPause')"
          @click="s.play()"
        >
          {{ s.playing.value ? '⏸' : '▶' }}
        </button>
        <button
          type="button"
          class="mx-tp-btn"
          :title="t('mx.transport.stepOnce')"
          @click="s.stepOnce()"
        >
          ⏭
        </button>
        <button type="button" class="mx-tp-pill" @click="cycleSpeed">
          {{ s.doc.value.settings.speed || 1 }}x
        </button>
        <button type="button" class="mx-tp-action" @click="s.playAgain()">
          ▶ {{ t('mx.transport.playAgain') }}
        </button>
        <button
          type="button"
          class="mx-tp-pill"
          :class="{
            'is-bot-on':
              (s.doc.value.settings.botMode ?? 'off') !== 'off' ||
              (s.doc.value.agents ?? []).some((a) => a.enabled)
          }"
          :title="t('mx.transport.botToggleTip')"
          @click="s.cycleBotMode()"
        >
          🤖
          {{
            (s.doc.value.settings.botMode ?? 'off') !== 'off'
              ? t(`mx.inspector.botMode_${s.doc.value.settings.botMode ?? 'off'}`)
              : (s.doc.value.agents ?? []).some((a) => a.enabled)
                ? 'Agent'
                : t('mx.inspector.botMode_off')
          }}
        </button>
        <label class="mx-tp-steps-box" :title="t('mx.inspector.steps')">
          <input
            type="number"
            min="1"
            max="500"
            :value="s.doc.value.settings.steps"
            @input="onStepsInput"
            @change="onStepsCommit"
            @keydown.enter="($event.target as HTMLInputElement).blur()"
          />
          <span>steps</span>
        </label>
      </div>

      <div class="mx-tp-center">
        <input
          type="range"
          class="mx-scrubber"
          min="0"
          :max="maxSteps"
          :value="s.playStep.value"
          @input="s.playStep.value = Number(($event.target as HTMLInputElement).value)"
        />
        <span class="mx-scrubber-lbl">{{ s.playStep.value }}/{{ maxSteps }} steps</span>
      </div>

      <div class="mx-tp-right">
        <label class="mx-tp-steps-box">
          <input
            type="number"
            min="5"
            max="500"
            :value="s.forecastRuns.value"
            @input="onPlaysInput"
            @change="onPlaysCommit"
            @keydown.enter="($event.target as HTMLInputElement).blur()"
          />
          <span>plays</span>
        </label>
        <button type="button" class="mx-tp-forecast" @click="s.runForecast()">
          ⚡ {{ t('mx.transport.forecast') }}
        </button>
      </div>
    </footer>
  </section>
</template>

<style scoped>
.mx-bottom-dock {
  position: relative;
  background: var(--bg-panel);
  border-top: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  color: var(--text);
  font-size: 12px;
  user-select: none;
  flex-shrink: 0;
}
.mx-bottom-dock.is-full-workbench {
  flex: 1;
  min-height: 0;
  border-top: none;
}

.mx-dock-resize-handle {
  position: relative;
  height: 8px;
  margin-top: -4px;
  cursor: ns-resize;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 12;
  background: transparent;
  transition: background 0.15s ease;
}
.mx-dock-resize-handle:hover,
.mx-dock-resize-handle.is-dragging {
  background: color-mix(in srgb, var(--accent) 18%, transparent);
}
.mx-dock-resize-pill {
  width: 44px;
  height: 4px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--text-muted) 45%, transparent);
  transition:
    background 0.15s ease,
    width 0.15s ease;
}
.mx-dock-resize-handle:hover .mx-dock-resize-pill,
.mx-dock-resize-handle.is-dragging .mx-dock-resize-pill {
  width: 64px;
  background: var(--accent);
}

.mx-res-tabs {
  height: 32px;
  padding: 0 12px;
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--bg-elevated);
}
.mx-res-tabs-left,
.mx-res-tabs-right {
  display: flex;
  align-items: center;
  gap: 6px;
}
.mx-res-tab {
  height: 32px;
  padding: 0 10px;
  border: none;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.mx-res-tab.is-active {
  color: var(--accent);
  border-bottom-color: var(--accent);
}
.mx-diag-pill {
  display: inline-block;
  margin-left: 4px;
  padding: 0 5px;
  border-radius: 8px;
  font-size: 10px;
  font-weight: 800;
}
.mx-diag-pill.is-ok {
  background: rgba(34, 197, 94, 0.18);
  color: color-mix(in srgb, #16a34a 78%, var(--text));
}
.mx-diag-pill.is-warn {
  background: rgba(245, 158, 11, 0.22);
  color: color-mix(in srgb, #d97706 78%, var(--text));
}
.mx-res-icon-btn {
  border: none;
  background: transparent;
  color: var(--text-muted);
  padding: 2px 6px;
  border-radius: 4px;
  cursor: pointer;
}
.mx-res-icon-btn:hover {
  background: var(--bg-hover);
  color: var(--text);
}
.mx-forecast-toggle {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--accent);
  font-weight: 600;
}

.mx-res-content {
  height: 278px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.mx-res-upper {
  flex: 1;
  min-height: 0;
  display: flex;
  border-bottom: 1px solid var(--border);
}

.mx-plays-col {
  width: 148px;
  border-right: 1px solid var(--border);
  padding: 6px 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.mx-compare-row {
  display: flex;
  gap: 4px;
}
.mx-compare-btn {
  flex: 1;
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: var(--bg-input);
  color: var(--text-muted);
  font-size: 11px;
  cursor: pointer;
}
.mx-compare-btn.is-active {
  background: var(--accent-12);
  border-color: var(--accent);
  color: var(--accent);
  font-weight: 600;
}
.mx-compare-all-btn {
  width: 26px;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: var(--bg-input);
  color: var(--accent);
  font-size: 11px;
  cursor: pointer;
}
.mx-compare-all-btn:hover {
  background: var(--accent-12);
  border-color: var(--accent);
}
.mx-plays-hdr {
  font-size: 10px;
  font-weight: 700;
  color: var(--text-muted);
  letter-spacing: 0.05em;
  margin-top: 2px;
}
.mx-plays-list {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.mx-play-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 11px;
  color: var(--text);
}
.mx-play-item:hover {
  background: var(--bg-hover);
}
.mx-play-item.is-active {
  background: var(--accent-12);
  color: var(--accent);
  font-weight: 600;
}
.mx-play-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mx-play-del {
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
}
.mx-plays-empty {
  font-size: 11px;
  color: var(--text-muted);
  padding: 8px 2px;
}

.mx-chart-col {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  padding: 4px 10px;
}
.mx-chart-crumb {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  margin-bottom: 2px;
}
.mx-crumb-main {
  font-weight: 700;
  color: var(--text);
  font-size: 11px;
}
.mx-crumb-sep {
  color: var(--text-muted);
}
.mx-crumb-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 7px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--bg-elevated);
  color: var(--text-muted);
  font-size: 10px;
  cursor: pointer;
}
.mx-crumb-pill.is-active {
  background: var(--accent-12);
  border-color: var(--accent);
  color: var(--accent);
  font-weight: 600;
}
.mx-crumb-pill.is-dimmed {
  opacity: 0.55;
}
.mx-scale-toggle {
  margin-left: auto;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-weight: 700;
}
.mx-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: inline-block;
  flex-shrink: 0;
}
.mx-chart-svg {
  flex: 1;
  width: 100%;
  min-height: 0;
  cursor: crosshair;
}
.mx-chart-polyline {
  cursor: pointer;
  transition:
    stroke-opacity 0.15s ease,
    stroke-width 0.15s ease;
}

.mx-step-table-col {
  width: 226px;
  border-left: 1px solid var(--border);
  padding: 6px 10px;
  display: flex;
  flex-direction: column;
}
.mx-step-hdr {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 48px 36px;
  gap: 4px;
  font-size: 10px;
  font-weight: 700;
  color: var(--text-muted);
  padding-bottom: 4px;
  border-bottom: 1px solid var(--border);
}
.mx-step-axis-hdr {
  cursor: pointer;
  user-select: none;
}
.mx-step-axis-hdr:hover {
  color: var(--accent);
}
.mx-step-rows {
  flex: 1;
  overflow-y: auto;
}
.mx-step-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 48px 36px;
  gap: 4px;
  align-items: center;
  padding: 3px 4px;
  border-radius: 4px;
  font-size: 11px;
  cursor: pointer;
  transition:
    opacity 0.15s ease,
    background-color 0.15s ease;
}
.mx-step-row:hover,
.mx-step-row.is-focused {
  background: var(--accent-12);
  font-weight: 700;
}
.mx-step-row.is-dimmed {
  opacity: 0.42;
}
.mx-step-name {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  overflow: hidden;
}
.mx-step-label-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mx-step-val {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-weight: 600;
}
.mx-step-axis {
  color: var(--text-muted);
  font-size: 10px;
}

/* 底部节点趋势卡片条 */
.mx-cards-strip {
  height: 102px;
  padding: 6px 10px;
  display: flex;
  gap: 8px;
  overflow-x: auto;
  background: var(--bg-elevated);
}
.mx-summary-card {
  min-width: 196px;
  max-width: 220px;
  padding: 7px 10px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--bg-panel);
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  cursor: pointer;
  flex-shrink: 0;
}
.mx-summary-card:hover,
.mx-summary-card.is-focused {
  border-color: var(--accent);
  box-shadow: 0 2px 8px var(--accent-18);
}
.mx-summary-card.is-dimmed {
  opacity: 0.6;
}
.mx-card-top {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
}
.mx-card-title {
  font-weight: 700;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mx-card-step {
  color: var(--text-muted);
  font-size: 10px;
  margin-left: auto;
}
.mx-card-mid {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.mx-card-big {
  font-size: 18px;
  font-weight: 800;
  color: var(--text);
}
.mx-card-sub {
  font-size: 11px;
  font-weight: 500;
  color: var(--text-muted);
}
.mx-sparkline {
  width: 72px;
  height: 26px;
}
.mx-card-line {
  font-size: 10px;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.mx-card-line.is-muted {
  color: var(--text-muted);
}

/* Economy Diagnostics */
.mx-diag-wrap {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: 10px 14px;
  gap: 10px;
  overflow-y: auto;
}
.mx-diag-kpis {
  display: flex;
  align-items: stretch;
  gap: 10px;
  flex-shrink: 0;
}
.mx-diag-score-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 14px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--bg-elevated);
}
.mx-diag-grade {
  width: 34px;
  height: 34px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  font-weight: 900;
  background: rgba(34, 197, 94, 0.18);
  color: #22c55e;
}
.mx-diag-score-card.grade-b .mx-diag-grade {
  background: rgba(59, 130, 246, 0.18);
  color: #3b82f6;
}
.mx-diag-score-card.grade-c .mx-diag-grade,
.mx-diag-score-card.grade-d .mx-diag-grade {
  background: rgba(245, 158, 11, 0.2);
  color: #f59e0b;
}
.mx-diag-score-meta {
  display: flex;
  flex-direction: column;
}
.mx-diag-score-num {
  font-size: 14px;
  font-weight: 800;
  color: var(--text);
}
.mx-diag-score-lbl {
  font-size: 10px;
  color: var(--text-muted);
}
.mx-diag-kpi {
  flex: 1;
  padding: 8px 12px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 2px;
}
.mx-diag-kpi-lbl {
  font-size: 10px;
  color: var(--text-muted);
}
.mx-diag-kpi-val {
  font-size: 15px;
  font-weight: 800;
  color: var(--text);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.mx-diag-kpi-val.is-warn {
  color: color-mix(in srgb, #d97706 78%, var(--text));
}
.mx-diag-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.mx-diag-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 10px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  cursor: pointer;
}
.mx-diag-item:hover {
  border-color: var(--accent);
  background: var(--bg-hover);
}
.mx-diag-badge {
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 9.5px;
  font-weight: 800;
}
.mx-diag-item.sev-ok .mx-diag-badge {
  background: rgba(34, 197, 94, 0.18);
  color: color-mix(in srgb, #16a34a 78%, var(--text));
}
.mx-diag-item.sev-info .mx-diag-badge {
  background: rgba(56, 189, 248, 0.18);
  color: color-mix(in srgb, #0284c7 78%, var(--text));
}
.mx-diag-item.sev-warn .mx-diag-badge {
  background: rgba(245, 158, 11, 0.2);
  color: color-mix(in srgb, #d97706 78%, var(--text));
}
.mx-diag-item.sev-critical .mx-diag-badge {
  background: rgba(239, 68, 68, 0.2);
  color: color-mix(in srgb, #dc2626 78%, var(--text));
}
.mx-diag-text {
  flex: 1;
  font-size: 11.5px;
  color: var(--text);
}
.mx-diag-jump {
  font-size: 10.5px;
  font-weight: 700;
  color: var(--accent);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.mx-diag-fix-all-btn {
  margin-left: auto;
  align-self: center;
  padding: 7px 13px;
  border-radius: 7px;
  border: 1px solid rgba(16, 185, 129, 0.45);
  background: rgba(16, 185, 129, 0.16);
  color: color-mix(in srgb, #10b981 82%, var(--text));
  font-size: 11.5px;
  font-weight: 700;
  cursor: pointer;
  white-space: nowrap;
  transition:
    background 0.15s ease,
    border-color 0.15s ease;
}
.mx-diag-fix-all-btn:hover {
  background: rgba(16, 185, 129, 0.26);
  border-color: rgba(16, 185, 129, 0.72);
}
.mx-diag-actions {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}
.mx-diag-action-btn {
  padding: 3px 8px;
  border-radius: 5px;
  border: 1px solid var(--border);
  background: var(--bg-panel, var(--bg));
  color: var(--text);
  font-size: 10.5px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  transition:
    background 0.15s ease,
    border-color 0.15s ease;
}
.mx-diag-action-btn:hover {
  border-color: var(--accent);
  background: var(--bg-hover);
}
.mx-diag-action-btn.is-primary {
  border-color: rgba(16, 185, 129, 0.45);
  background: rgba(16, 185, 129, 0.14);
  color: color-mix(in srgb, #10b981 82%, var(--text));
}
.mx-diag-action-btn.is-primary:hover {
  background: rgba(16, 185, 129, 0.24);
  border-color: rgba(16, 185, 129, 0.7);
}

/* Runtime Debugger */
.mx-debugger-wrap {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.mx-debugger-toolbar {
  padding: 6px 12px;
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  gap: 8px;
}
.mx-mini-input {
  width: 68px;
  padding: 3px 6px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-input);
  color: var(--text);
  font-size: 11px;
}
.mx-dbg-count {
  color: var(--text-muted);
  font-size: 11px;
}
.mx-debugger-table-wrap {
  flex: 1;
  overflow-y: auto;
}
.mx-debugger-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 11px;
}
.mx-debugger-table th {
  text-align: left;
  padding: 5px 10px;
  background: var(--bg-elevated);
  color: var(--text-muted);
  position: sticky;
  top: 0;
}
.mx-debugger-table td {
  padding: 4px 10px;
  border-bottom: 1px solid var(--border);
  cursor: pointer;
}
.mx-debugger-table tr:hover td {
  background: var(--bg-hover);
}
.mx-ev-badge {
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 600;
  background: var(--bg-elevated);
  color: var(--text);
}
.mx-ev-badge.is-transfer {
  background: rgba(34, 197, 94, 0.16);
  color: color-mix(in srgb, #16a34a 78%, var(--text));
}
.mx-ev-badge.is-gate {
  background: rgba(245, 158, 11, 0.16);
  color: color-mix(in srgb, #d97706 78%, var(--text));
}
.mx-ev-badge.is-end {
  background: rgba(239, 68, 68, 0.16);
  color: color-mix(in srgb, #dc2626 78%, var(--text));
}

/* Transport Bar */
.mx-transport-bar {
  height: 40px;
  padding: 0 12px;
  border-top: 1px solid var(--border);
  background: var(--bg-panel);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  overflow-x: auto;
  scrollbar-width: none;
}
.mx-transport-bar::-webkit-scrollbar {
  display: none;
}
.mx-tp-left,
.mx-tp-right {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}
.mx-tp-center {
  flex: 1;
  min-width: 140px;
  max-width: 420px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.mx-tp-btn {
  width: 28px;
  height: 28px;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-elevated);
  color: var(--text);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  white-space: nowrap;
}
.mx-tp-btn:hover {
  background: var(--bg-hover);
}
.mx-tp-btn.is-play {
  background: var(--accent);
  border-color: var(--accent);
  color: #ffffff;
}
.mx-tp-btn.is-playing {
  background: #dc2626;
  border-color: #dc2626;
  color: #ffffff;
}
.mx-tp-pill {
  height: 28px;
  padding: 0 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-elevated);
  color: var(--text);
  font-weight: 700;
  font-size: 11px;
  line-height: 1;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  white-space: nowrap;
  flex-shrink: 0;
}
.mx-tp-action {
  height: 28px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-input);
  color: var(--text);
  font-weight: 600;
  font-size: 11px;
  line-height: 1;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  white-space: nowrap;
  flex-shrink: 0;
}
.mx-tp-action:hover {
  background: var(--bg-hover);
}
.mx-tp-steps-box {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0 8px 0 5px;
  height: 28px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-input);
  font-size: 11px;
  line-height: 1;
  color: var(--text-muted);
  white-space: nowrap;
  flex-shrink: 0;
}
.mx-tp-steps-box span {
  white-space: nowrap;
}
.mx-tp-steps-box input {
  width: 40px;
  height: 20px;
  padding: 0 2px;
  margin: 0;
  border: 1px solid transparent;
  border-radius: 4px;
  background: rgba(128, 128, 128, 0.14);
  font-size: 11.5px;
  font-weight: 700;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  line-height: 20px;
  color: var(--text);
  text-align: center;
  outline: none;
  -moz-appearance: textfield;
  appearance: textfield;
}
.mx-tp-steps-box input::-webkit-outer-spin-button,
.mx-tp-steps-box input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
.mx-tp-steps-box input:hover {
  background: rgba(128, 128, 128, 0.22);
}
.mx-tp-steps-box input:focus {
  border-color: var(--accent);
  background: var(--accent-12);
  color: var(--accent);
}
.mx-scrubber {
  flex: 1;
  min-width: 72px;
  accent-color: var(--accent);
}
.mx-scrubber-lbl {
  font-size: 11px;
  color: var(--text-muted);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  min-width: 72px;
  white-space: nowrap;
  flex-shrink: 0;
}
.mx-tp-forecast {
  height: 28px;
  padding: 0 10px;
  border: 1px solid var(--accent);
  border-radius: 6px;
  background: var(--accent-12);
  color: var(--accent);
  font-weight: 700;
  font-size: 11px;
  line-height: 1;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  white-space: nowrap;
  flex-shrink: 0;
}
.mx-tp-forecast:hover {
  background: var(--accent);
  color: #ffffff;
}

/* ─── Auto-Balancer & Parameter Sweep ─── */
.mx-balancer-wrap {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  padding: 8px 12px;
  gap: 8px;
}
.mx-balancer-controls {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
  border-bottom: 1px solid var(--border);
  padding-bottom: 6px;
}
.mx-bal-mode-pills {
  display: inline-flex;
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: 7px;
  padding: 2px;
  gap: 2px;
}
.mx-bal-pill {
  border: none;
  background: transparent;
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 700;
  padding: 4px 10px;
  border-radius: 5px;
  cursor: pointer;
}
.mx-bal-pill.is-active {
  background: var(--bg-panel);
  color: var(--accent);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
}
.mx-bal-form-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  flex: 1;
}
.mx-bal-field {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--text-muted);
}
.mx-bal-select,
.mx-bal-input {
  height: 26px;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: var(--bg-input);
  color: var(--text);
  font-size: 11px;
  padding: 0 6px;
}
.mx-bal-field--sm .mx-bal-input {
  width: 58px;
}
.mx-bal-run-btn {
  height: 26px;
  padding: 0 12px;
  border: 1px solid var(--accent);
  border-radius: 6px;
  background: var(--accent);
  color: #ffffff;
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
}
.mx-bal-body {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: flex;
}
.mx-gs-result,
.mx-sweep-result {
  display: flex;
  gap: 12px;
  width: 100%;
  height: 100%;
  min-height: 0;
}
.mx-gs-summary-card {
  width: 240px;
  flex-shrink: 0;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 6px;
}
.mx-gs-stat {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  font-size: 11px;
}
.mx-gs-lbl {
  color: var(--text-muted);
}
.mx-gs-val {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 13px;
}
.mx-gs-val.is-accent {
  color: var(--accent);
  font-size: 15px;
}
.mx-gs-apply-btn {
  height: 28px;
  border: 1px solid #16a34a;
  border-radius: 6px;
  background: rgba(22, 163, 74, 0.14);
  color: #16a34a;
  font-weight: 700;
  font-size: 11px;
  cursor: pointer;
}
.mx-gs-apply-btn:hover {
  background: #16a34a;
  color: #ffffff;
}
.mx-gs-samples-table-wrap {
  flex: 1;
  min-width: 0;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 8px;
}
.is-best-row {
  background: var(--accent-12);
  font-weight: 700;
}
.mx-mini-apply {
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-elevated);
  color: var(--text);
  font-size: 10px;
  padding: 1px 6px;
  cursor: pointer;
}
.mx-mini-apply:hover {
  border-color: var(--accent);
  color: var(--accent);
}
.mx-sweep-chart-box {
  width: 340px;
  flex-shrink: 0;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-elevated);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4px;
}
.mx-sweep-svg {
  width: 100%;
  height: 100%;
}
.mx-bal-empty {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  font-size: 12px;
  border: 1px dashed var(--border);
  border-radius: 8px;
}
.mx-matrix-table th,
.mx-matrix-table td {
  text-align: center;
}
.mx-matrix-cell {
  cursor: pointer;
  font-weight: 700;
  border: 1px solid transparent;
  transition: transform 0.1s ease;
}
.mx-matrix-cell:hover,
.mx-matrix-cell.is-selected {
  outline: 2px solid var(--accent);
  z-index: 1;
}
.mx-tp-pill.is-bot-on {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--accent-12);
}

/* ═════════════ 下一代演进 1：🎯 拖拽曲线反推配平 ═════════════ */
.mx-curve-drag-btn.is-active {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--accent-12);
  font-weight: 700;
}
.mx-curve-solver-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
  padding: 5px 10px;
  margin-bottom: 4px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 11px;
}
.mx-cs-left,
.mx-cs-right {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.mx-cs-title {
  font-weight: 700;
  color: var(--text);
}
.mx-cs-node-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 1px 6px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--bg-panel);
  font-weight: 600;
}
.mx-cs-field {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--text-muted);
}
.mx-cs-input {
  width: 52px;
  padding: 2px 5px;
  border-radius: 4px;
  border: 1px solid var(--border);
  background: var(--bg-panel);
  color: var(--text);
  font-size: 11px;
  font-weight: 600;
}
.mx-cs-input.is-step {
  width: 44px;
}
.mx-cs-mini-btn {
  padding: 2px 7px;
  border-radius: 4px;
  border: 1px solid var(--border);
  background: var(--bg-panel);
  color: var(--text);
  font-size: 11px;
  cursor: pointer;
}
.mx-cs-mini-btn:hover,
.mx-cs-mini-btn.is-active {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--accent-12);
}
.mx-cs-toast {
  display: inline-flex;
  align-items: center;
  padding: 1px 7px;
  border-radius: 999px;
  background: rgba(34, 197, 94, 0.14);
  border: 1px solid rgba(34, 197, 94, 0.45);
  color: #4ade80;
  font-size: 10.5px;
  font-weight: 600;
}
.mx-cs-sol-pills {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex-wrap: wrap;
}
.mx-cs-sol-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--bg-panel);
  color: var(--text);
  font-size: 11px;
  cursor: pointer;
}
.mx-cs-sol-pill.is-selected {
  border-color: var(--accent);
  background: var(--accent-12);
  color: var(--accent);
  font-weight: 600;
}
.mx-cs-sol-arrow {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-weight: 700;
}
.mx-cs-apply-btn {
  padding: 3px 9px;
  border-radius: 5px;
  border: 1px solid var(--accent);
  background: var(--accent);
  color: var(--bg-panel);
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
}
.mx-cs-empty {
  color: var(--text-muted);
  font-size: 11px;
}
.mx-chart-svg.is-curve-drag-mode,
.mx-chart-svg.is-dragging-pin,
.mx-chart-polyline-hit,
.mx-curve-target-pin {
  cursor: ns-resize;
  user-select: none;
  touch-action: none;
}

/* ═════════════ 下一代演进 2：🎮 机制一键试玩卡片台 ═════════════ */
.mx- playable-wrap,
.mx-playable-wrap {
  display: grid;
  grid-template-columns: 250px 1fr 265px;
  gap: 10px;
  height: 100%;
  min-height: 0;
  padding: 8px 10px;
  overflow: hidden;
}
.mx-playable-hud-col,
.mx-playable-deck-col,
.mx-playable-turn-col {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px 10px;
  overflow: hidden;
}
.mx-playable-sec-hdr {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11.5px;
  font-weight: 700;
  color: var(--text);
  padding-bottom: 4px;
  border-bottom: 1px solid var(--border);
}
.mx-playable-cnt,
.mx-playable-step-pill {
  font-size: 10.5px;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  color: var(--text-muted);
}
.mx-hud-gauge-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  overflow-y: auto;
  flex: 1;
  min-height: 0;
}
.mx-hud-gauge {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px 8px;
  border-radius: 6px;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  cursor: pointer;
}
.mx-hud-gauge.is-selected {
  border-color: var(--accent);
}
.mx-hud-gauge.is-danger {
  border-style: dashed;
}
.mx-hud-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11.5px;
}
.mx-hud-name {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-weight: 600;
  color: var(--text);
}
.mx-hud-val-group {
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.mx-hud-val {
  font-size: 13px;
  color: var(--text);
}
.mx-hud-cap {
  font-size: 10.5px;
  color: var(--text-muted);
}
.mx-hud-delta {
  font-size: 10.5px;
  font-weight: 700;
}
.mx-hud-delta.is-pos {
  color: var(--accent);
}
.mx-hud-delta.is-neg {
  color: var(--text-muted);
}
.mx-hud-bar-track {
  width: 100%;
  height: 5px;
  border-radius: 999px;
  background: var(--bg-elevated);
  overflow: hidden;
}
.mx-hud-bar-fill {
  height: 100%;
  border-radius: 999px;
  transition: width 0.2s ease;
}
.mx-hud-badges {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
}
.mx-hud-badge {
  font-size: 9.5px;
  padding: 0 5px;
  border-radius: 4px;
  border: 1px solid var(--border);
  color: var(--text-muted);
}
.mx-play-cards-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(215px, 1fr));
  gap: 8px;
  overflow-y: auto;
  flex: 1;
  min-height: 0;
  align-content: start;
}
.mx-play-card {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 7px;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-top: 3px solid var(--card-accent, var(--accent));
  transition:
    transform 0.12s ease,
    border-color 0.12s ease;
}
.mx-play-card.is-selected {
  border-color: var(--accent);
}
.mx-play-card.is-disabled {
  opacity: 0.78;
}
.mx-pc-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}
.mx-pc-title {
  font-size: 12px;
  font-weight: 700;
  color: var(--text);
}
.mx-pc-trig-badge {
  font-size: 9.5px;
  padding: 1px 5px;
  border-radius: 999px;
  border: 1px solid var(--border);
  color: var(--text-muted);
}
.mx-pc-body {
  display: flex;
  flex-direction: column;
  gap: 5px;
  font-size: 11px;
}
.mx-pc-section {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.mx-pc-cost-chip,
.mx-pc-cond-chip,
.mx-pc-reward-chip,
.mx-pc-free-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 6px;
  border-radius: 4px;
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  font-size: 10.5px;
  color: var(--text);
}
.mx-pc-cost-chip.is-lack,
.mx-pc-cond-chip.is-lack {
  color: var(--text-muted);
  border-style: dashed;
}
.mx-pc-chip-sub {
  font-size: 9.5px;
  color: var(--text-muted);
}
.mx-pc-gate-box {
  width: 100%;
  padding: 4px 6px;
  border-radius: 5px;
  border: 1px dashed var(--border);
  background: var(--bg-elevated);
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.mx-pc-gate-hdr {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 10px;
  font-weight: 600;
}
.mx-pc-pity-pill {
  font-size: 9.5px;
  padding: 0 5px;
  border-radius: 999px;
  border: 1px solid var(--accent);
  color: var(--accent);
}
.mx-pc-gate-branches {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.mx-pc-branch-chip {
  font-size: 9.5px;
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--bg-panel);
  border: 1px solid var(--border);
}
.mx-pc-footer {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.mx-pc-play-btn {
  width: 100%;
  padding: 5px 8px;
  border-radius: 5px;
  border: 1px solid var(--accent);
  background: var(--accent-12);
  color: var(--accent);
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
}
.mx-pc-play-btn:hover:not(:disabled) {
  background: var(--accent);
  color: var(--bg-panel);
}
.mx-pc-play-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.mx-pc-reason {
  font-size: 10px;
  color: var(--text-muted);
}
.mx-playable-ended-banner {
  padding: 5px 8px;
  border-radius: 5px;
  border: 1px solid var(--accent);
  background: var(--accent-12);
  color: var(--accent);
  font-size: 11px;
  font-weight: 700;
}
.mx-playable-turn-btns {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.mx-turn-btn-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 5px;
}
.mx-turn-btn {
  padding: 5px 8px;
  border-radius: 5px;
  border: 1px solid var(--border);
  background: var(--bg-panel);
  color: var(--text);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
}
.mx-turn-btn.is-primary {
  border-color: var(--accent);
  background: var(--accent);
  color: var(--bg-panel);
  font-weight: 700;
}
.mx-turn-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.mx-playable-log-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  overflow-y: auto;
  flex: 1;
  min-height: 0;
}
.mx-playable-log-item {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 4px 6px;
  border-radius: 4px;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  font-size: 10.5px;
  color: var(--text);
}
.mx-plog-step {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-weight: 700;
  color: var(--accent);
  flex-shrink: 0;
}
.mx-playable-log-empty {
  color: var(--text-muted);
  font-size: 11px;
  padding: 12px 6px;
  text-align: center;
}
.mx-cs-mini-btn.is-active {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--accent-12);
  font-weight: 700;
}
.mx-played-feedback-banner {
  padding: 5px 10px;
  border-radius: 6px;
  border: 1px solid var(--accent);
  background: var(--accent-12);
  color: var(--accent);
  font-size: 11px;
  font-weight: 700;
}
.mx-hud-gauge.is-just-changed,
.mx-play-card.is-just-changed {
  border-color: var(--accent);
  background: var(--accent-12);
}
.mx-play-card.is-ai-recommended {
  border-color: var(--accent);
}
.mx-pc-hdr-badges {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
}
.mx-pc-ai-badge {
  font-size: 9.5px;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 999px;
  border: 1px solid var(--accent);
  background: var(--accent-12);
  color: var(--accent);
}
.mx-pc-cd-badge {
  font-size: 9.5px;
  padding: 1px 5px;
  border-radius: 999px;
  border: 1px solid var(--border);
  color: var(--text-muted);
}
.mx-pc-cd-badge.is-locked {
  border-style: dashed;
  font-weight: 700;
}
.mx-pc-pity-track {
  width: 100%;
  height: 4px;
  border-radius: 999px;
  background: var(--bg-panel);
  overflow: hidden;
}
.mx-pc-pity-fill {
  height: 100%;
  border-radius: 999px;
  background: var(--accent);
  transition: width 0.2s ease;
}
.mx-turn-btn.is-ai-spectator {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--bg-panel);
  font-weight: 700;
}
.mx-turn-btn.is-ai-spectator.is-active {
  background: var(--accent-12);
}
.mx-macro-tape-box {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 6px 8px;
  border-radius: 6px;
  background: var(--bg-panel);
  border: 1px dashed var(--border);
}
.mx-macro-hdr {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
}
.mx-macro-title {
  font-size: 10.5px;
  font-weight: 700;
  color: var(--text);
}
.mx-macro-hdr-btns {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.mx-macro-replay-btn {
  padding: 2px 6px;
  border-radius: 4px;
  border: 1px solid var(--accent);
  background: var(--accent-12);
  color: var(--accent);
  font-size: 10px;
  font-weight: 700;
  cursor: pointer;
}
.mx-macro-clear-btn {
  padding: 1px 5px;
  border-radius: 4px;
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  color: var(--text-muted);
  font-size: 11px;
  cursor: pointer;
}
.mx-macro-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
}
.mx-macro-chip {
  font-size: 9.5px;
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  color: var(--text-muted);
}
.mx-pc-chip-main {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}
.mx-hud-badge {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}
.mx-pc-reward-chip {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}
.mx-inline-nudge-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  padding: 0;
  border-radius: 3px;
  border: 1px solid var(--border);
  background: var(--bg-panel);
  color: var(--text-muted);
  font-size: 10px;
  font-weight: 700;
  line-height: 1;
  cursor: pointer;
}
.mx-inline-nudge-btn:hover {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--accent-12);
}
</style>
