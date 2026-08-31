import { reactive } from 'vue'
import type { DockviewApi, DockviewPanelApi, IDockviewPanel } from 'dockview-vue'

/** Collapsed panels leave the dock (Rider-style); the right rail owns the affordance. */
export const SIDE_COLLAPSE_WIDTH = 0
export type SidePanelId = 'assets' | 'inspector'

export const SIDE_PANEL_IDS: readonly SidePanelId[] = ['assets', 'inspector']

const COLLAPSED_STORAGE_PREFIX = 'studio.dock.sideCollapsed.'
const WIDTH_STORAGE_PREFIX = 'studio.dock.sideWidth.'
const WORKSPACE_PANEL_ID = 'workspace'

function readSideCollapsedPreference(id: SidePanelId): boolean {
  try {
    return localStorage.getItem(`${COLLAPSED_STORAGE_PREFIX}${id}`) === '1'
  } catch {
    return false
  }
}

function readStoredWidth(id: SidePanelId): number {
  try {
    const raw = localStorage.getItem(`${WIDTH_STORAGE_PREFIX}${id}`)
    const n = raw == null ? NaN : Number(raw)
    return Number.isFinite(n) && n > 16 ? Math.round(n) : 0
  } catch {
    return 0
  }
}

function writeStoredWidth(id: SidePanelId, width: number): void {
  if (!(width > 16)) return
  const opts = resolveSidePanelSizeOptions(id)
  const rounded = Math.round(
    Math.min(maxRememberedSideWidth(opts), Math.max(opts.minSide, width))
  )
  lastExpandedWidth[id] = rounded
  try {
    localStorage.setItem(`${WIDTH_STORAGE_PREFIX}${id}`, String(rounded))
  } catch {
    // ignore quota / private mode
  }
}

/** Reactive collapse flags for dock tab buttons */
export const sidePanelCollapsed = reactive<Record<SidePanelId, boolean>>({
  assets: readSideCollapsedPreference('assets'),
  inspector: readSideCollapsedPreference('inspector')
})

const lastExpandedWidth: Record<SidePanelId, number> = {
  assets: readStoredWidth('assets'),
  inspector: readStoredWidth('inspector')
}

/**
 * Width remembered while panels sit side-by-side.
 * Ignored while vertically stacked so dockview's "sum of both" column width is not persisted.
 */
const soloExpandedWidth: Record<SidePanelId, number> = {
  assets: readStoredWidth('assets'),
  inspector: readStoredWidth('inspector')
}

export type SidePanelSizeOptions = {
  minSide: number
  maxSide: number
  defaultWidth: number
}

let sizeOptionsProvider: ((id: SidePanelId) => SidePanelSizeOptions) | null = null
let dockApiRef: DockviewApi | null = null
const widthWatchDisposables: Array<{ dispose(): void }> = []

export function registerSidePanelSizeProvider(
  provider: ((id: SidePanelId) => SidePanelSizeOptions) | null
): void {
  sizeOptionsProvider = provider
}

export function registerSidePanelDockApi(api: DockviewApi | null): void {
  for (const d of widthWatchDisposables) d.dispose()
  widthWatchDisposables.length = 0
  dockApiRef = api
  if (!api) return
  attachExpandedWidthWatchers(api)
}

export function resolveSidePanelSizeOptions(id: SidePanelId): SidePanelSizeOptions {
  if (sizeOptionsProvider) return sizeOptionsProvider(id)
  const total =
    typeof window !== 'undefined' && window.innerWidth > 0 ? window.innerWidth : 1600
  const side = Math.round(Math.min(480, Math.max(300, total * 0.25)))
  return { minSide: 300, maxSide: 480, defaultWidth: side }
}

export function isSidePanelId(id: string): id is SidePanelId {
  return id === 'assets' || id === 'inspector'
}

export { readSideCollapsedPreference }

function writeSideCollapsedPreference(id: SidePanelId, collapsed: boolean): void {
  try {
    localStorage.setItem(`${COLLAPSED_STORAGE_PREFIX}${id}`, collapsed ? '1' : '0')
  } catch {
    // ignore quota / private mode
  }
}

/** 记忆宽度上限：可略宽于默认 maxSide，但不让单侧吃掉大半窗口（否则工作区被压没）。 */
function maxRememberedSideWidth(opts: SidePanelSizeOptions): number {
  const viewport =
    typeof window !== 'undefined' && window.innerWidth > 0 ? window.innerWidth : 1600
  return Math.max(opts.maxSide, Math.round(viewport * 0.35))
}

function resolveExpandedWidth(id: SidePanelId, opts: SidePanelSizeOptions): number {
  const remembered = lastExpandedWidth[id] || readStoredWidth(id)
  if (remembered > 16) {
    return Math.round(
      Math.min(maxRememberedSideWidth(opts), Math.max(opts.minSide, remembered))
    )
  }
  return Math.round(Math.min(opts.maxSide, Math.max(opts.minSide, opts.defaultWidth)))
}

function readPanelWidth(api: DockviewPanelApi): number {
  const panelW = api.width
  if (typeof panelW === 'number' && panelW > 0) return panelW
  const groupW = api.group?.api?.width
  if (typeof groupW === 'number' && groupW > 0) return groupW
  const box = api.group?.api?.boundingBox
  if (box && typeof box.width === 'number' && box.width > 0) return box.width
  return 0
}

function rememberCurrentWidth(api: DockviewPanelApi, id: SidePanelId): void {
  if (sidePanelCollapsed[id]) return
  const width = readPanelWidth(api)
  if (width > 16) writeStoredWidth(id, width)
}

/** Pending column width captured on willDrop before dockview sums both panels. */
let pendingStackColumnWidth = 0
let stackNormalizeTimer: ReturnType<typeof setTimeout> | null = null
let unlockingConstraints = false
/** Only auto-correct summed widths shortly after a vertical stack drop. */
let stackNormalizeUntil = 0

function armStackNormalizeWindow(ms = 800): void {
  stackNormalizeUntil = Date.now() + ms
}

/** 资产与参数是否已合并为同一 Tab 组（同 group 即 Tab 切换） */
function areSidePanelsTabbed(
  dock: DockviewApi,
  a: SidePanelId = 'assets',
  b: SidePanelId = 'inspector'
): boolean {
  const pa = dock.getPanel(a)
  const pb = dock.getPanel(b)
  return !!pa?.group && !!pb?.group && pa.group === pb.group
}

/**
 * Tab 合并组的可见性与激活项同步。
 *
 * 组由两个面板共享，因此这里绝不能走 group 级隐藏 / 0 宽收窄 / `studio-side-collapsed`
 * 样式——那些都作用在共享 group 上，会把另一个面板一起压没。合并态下「收起」只表达为
 * 切到另一个 Tab；两侧都收起时才整体隐藏组。
 */
function syncTabbedGroupActiveState(dock: DockviewApi, preferredId?: SidePanelId): void {
  const activeId =
    SIDE_PANEL_IDS.find((id) => id === preferredId && !sidePanelCollapsed[id]) ??
    SIDE_PANEL_IDS.find((id) => !sidePanelCollapsed[id])
  if (activeId) {
    const panel = dock.getPanel(activeId)
    if (!panel) return
    setSidePanelGroupVisible(panel.api, true)
    panel.api.setActive()
    return
  }
  const first = dock.getPanel(SIDE_PANEL_IDS[0])
  if (first) setSidePanelGroupVisible(first.api, false)
}

function areSidePanelsStackedVertically(
  assets: IDockviewPanel,
  inspector: IDockviewPanel
): boolean {
  if (assets.group?.id && assets.group.id === inspector.group?.id) return false
  const boxA = assets.group?.api?.boundingBox
  const boxB = inspector.group?.api?.boundingBox
  if (!boxA || !boxB) return false
  const overlap =
    Math.min(boxA.left + boxA.width, boxB.left + boxB.width) - Math.max(boxA.left, boxB.left)
  const minW = Math.min(boxA.width, boxB.width)
  const stackedX = minW > 0 && overlap > minW * 0.55
  const differentRow = Math.abs(boxA.top - boxB.top) > 20
  return stackedX && differentRow
}

function readSoloWidth(id: SidePanelId): number {
  return soloExpandedWidth[id] || lastExpandedWidth[id] || readStoredWidth(id)
}

function forceStackedColumnWidth(dock: DockviewApi, width: number): boolean {
  const assets = dock.getPanel('assets')
  const inspector = dock.getPanel('inspector')
  if (!assets || !inspector) return false
  if (sidePanelCollapsed.assets || sidePanelCollapsed.inspector) return false
  if (!areSidePanelsStackedVertically(assets, inspector)) return false

  const opts = resolveSidePanelSizeOptions('inspector')
  const next = Math.round(Math.max(opts.minSide, width))
  unlockingConstraints = true
  try {
    // Lock both groups to the target column so dockview cannot keep the summed width.
    for (const panel of [assets, inspector]) {
      panel.api.group.api.setConstraints({
        minimumWidth: next,
        maximumWidth: next
      })
      panel.api.setConstraints({
        minimumWidth: next,
        maximumWidth: next
      })
    }
    // Only size one group — vertical stack shares one column branch.
    inspector.api.group.api.setSize({ width: next })
    assets.api.group.api.setSize({ width: next })
  } finally {
    unlockingConstraints = false
  }

  window.setTimeout(() => {
    if (!dockApiRef) return
    const a = dockApiRef.getPanel('assets')
    const b = dockApiRef.getPanel('inspector')
    if (!a || !b || !areSidePanelsStackedVertically(a, b)) return
    const minSide = resolveSidePanelSizeOptions('inspector').minSide
    unlockingConstraints = true
    try {
      for (const panel of [a, b]) {
        panel.api.group.api.setConstraints({
          minimumWidth: minSide,
          maximumWidth: Number.MAX_SAFE_INTEGER
        })
        panel.api.setConstraints({
          minimumWidth: minSide,
          maximumWidth: Number.MAX_SAFE_INTEGER
        })
      }
      // Re-assert width after unlocking max constraint.
      b.api.group.api.setSize({ width: next })
    } finally {
      unlockingConstraints = false
    }
  }, 0)

  return true
}

function scheduleStackedColumnNormalize(dock: DockviewApi, preferredWidth?: number): void {
  const width = preferredWidth && preferredWidth > 16 ? preferredWidth : pendingStackColumnWidth
  if (width > 16) pendingStackColumnWidth = width

  const run = (): void => {
    const column =
      pendingStackColumnWidth > 16
        ? pendingStackColumnWidth
        : Math.min(readSoloWidth('assets') || Number.POSITIVE_INFINITY, readSoloWidth('inspector') || Number.POSITIVE_INFINITY)
    if (!(column > 16) || !Number.isFinite(column)) return
    if (forceStackedColumnWidth(dock, column)) {
      pendingStackColumnWidth = column
    }
  }

  requestAnimationFrame(() => {
    requestAnimationFrame(run)
  })
  if (stackNormalizeTimer) clearTimeout(stackNormalizeTimer)
  stackNormalizeTimer = setTimeout(run, 48)
}

function attachExpandedWidthWatchers(dock: DockviewApi): void {
  for (const d of widthWatchDisposables) d.dispose()
  widthWatchDisposables.length = 0
  for (const id of SIDE_PANEL_IDS) {
    const panel = dock.getPanel(id)
    if (!panel) continue
    widthWatchDisposables.push(
      panel.api.onDidDimensionsChange(({ width }) => {
        if (unlockingConstraints) return
        if (sidePanelCollapsed[id]) return
        if (!(width > 16)) return
        const assets = dock.getPanel('assets')
        const inspector = dock.getPanel('inspector')
        if (
          assets &&
          inspector &&
          !sidePanelCollapsed.assets &&
          !sidePanelCollapsed.inspector &&
          areSidePanelsStackedVertically(assets, inspector)
        ) {
          // Shared column while stacked — keep solo widths untouched.
          // If column looks like a sum of both solos, pull it back.
          const soloA = readSoloWidth('assets')
          const soloB = readSoloWidth('inspector')
          if (
            Date.now() <= stackNormalizeUntil &&
            soloA > 16 &&
            soloB > 16 &&
            width > soloA + soloB - 40
          ) {
            const target =
              pendingStackColumnWidth > 16 ? pendingStackColumnWidth : Math.min(soloA, soloB)
            scheduleStackedColumnNormalize(dock, target)
          }
          return
        }
        soloExpandedWidth[id] = Math.round(width)
        writeStoredWidth(id, width)
      })
    )
  }
}

/** Capture drop-target width before dockview merges column sizes. */
export function noteSidePanelWillStackDrop(
  dock: DockviewApi,
  position: string,
  targetGroup: { panels?: ReadonlyArray<{ id: string; api: DockviewPanelApi }> } | undefined
): void {
  if (position !== 'top' && position !== 'bottom') return
  const target = targetGroup?.panels?.find((panel) => isSidePanelId(panel.id))
  if (!target || !isSidePanelId(target.id)) return
  // Refresh solos from live layout while still side-by-side.
  for (const id of SIDE_PANEL_IDS) {
    const panel = dock.getPanel(id)
    if (!panel || sidePanelCollapsed[id]) continue
    const w = readPanelWidth(panel.api)
    if (w > 16) soloExpandedWidth[id] = Math.round(w)
  }
  pendingStackColumnWidth =
    soloExpandedWidth[target.id] || readPanelWidth(target.api) || readSoloWidth(target.id)
  armStackNormalizeWindow()
}

function groupHasSidePanel(
  group: { panels?: ReadonlyArray<{ id: string }> } | undefined
): boolean {
  return !!group?.panels?.some((panel) => isSidePanelId(panel.id))
}

/**
 * 侧栏互拖时禁止 left/right/center 半屏 drop 预览：先悬停半屏再丢到对方下方
 * 时，dockview 锚点 overlay / 列宽容易留下灰框。仅允许上下叠放。
 * 拖到工作区/文档等非侧栏目标时一律不显示预览；AI 对话页签（chat）除外，
 * 允许把资产/参数窗口拖入其中合并或拆分。
 */
export function shouldPreventSidePanelOverlay(event: {
  position: string
  kind?: string
  group?: { panels?: ReadonlyArray<{ id: string }> }
  getData: () => { panelId?: string | null } | undefined
}): boolean {
  const panelId = event.getData()?.panelId
  if (!panelId || !isSidePanelId(panelId)) return false

  if (event.kind === 'edge') return true
  if (!groupHasSidePanel(event.group)) {
    // 拖到 AI 对话页签（chat）时放行，其余非侧栏目标仍阻止
    if (event.group?.panels?.some((panel) => panel.id === 'chat')) return false
    return true
  }

  // 拖到对方面板内容区（center）：合并为 Tab 切换组
  if (event.position === 'center') return false

  return event.position !== 'top' && event.position !== 'bottom'
}

/** 清理未卸掉的 drop 锚点容器，避免拖放结束后半透明灰框残留 */
export function clearDockviewDropOverlays(root?: ParentNode | null): void {
  const host = root ?? (typeof document !== 'undefined' ? document : null)
  if (!host) return
  host.querySelectorAll('.dv-drop-target-container').forEach((el) => el.remove())
  host.querySelectorAll('.dv-drop-target').forEach((el) => {
    el.classList.remove('dv-drop-target')
  })
}

/** 侧栏上下叠放：上/下各半屏即可出预览（dockview 默认约 20%） */
const SIDE_PANEL_STACK_OVERLAY = {
  activationSize: { type: 'percentage' as const, value: 50 },
  size: { type: 'percentage' as const, value: 50 }
}

const SIDE_PANEL_STACK_ZONES = ['top', 'bottom', 'center'] as const

type DropTargetLike = {
  setTargetZones: (zones: string[]) => void
  setOverlayModel: (model: {
    activationSize?: { type: 'percentage' | 'pixels'; value: number }
    size?: { type: 'percentage' | 'pixels'; value: number }
  }) => void
}

function groupContentDropTargets(group: {
  model?: unknown
}): DropTargetLike[] {
  const model = group.model as
    | {
        contentDropTarget?: DropTargetLike
        contentContainer?: {
          dropTarget?: DropTargetLike
          pointerDropTarget?: DropTargetLike
        }
      }
    | undefined
  if (!model) return []
  const fromContainer = model.contentContainer
  if (fromContainer) {
    return [fromContainer.dropTarget, fromContainer.pointerDropTarget].filter(
      (target): target is DropTargetLike =>
        !!target &&
        typeof target.setTargetZones === 'function' &&
        typeof target.setOverlayModel === 'function'
    )
  }
  if (
    model.contentDropTarget &&
    typeof model.contentDropTarget.setTargetZones === 'function' &&
    typeof model.contentDropTarget.setOverlayModel === 'function'
  ) {
    return [model.contentDropTarget]
  }
  return []
}

/**
 * 资产/参数组仅接受上下落点，并把激活区扩到 50%。
 * dockview 在 group location 变更时会重置 zones，故布局/拖放后需再调用。
 */
export function configureSidePanelStackDropTargets(dock: DockviewApi): void {
  for (const id of SIDE_PANEL_IDS) {
    const panel = dock.getPanel(id)
    const group = panel?.group
    if (!group) continue
    for (const target of groupContentDropTargets(group)) {
      target.setTargetZones([...SIDE_PANEL_STACK_ZONES])
      target.setOverlayModel(SIDE_PANEL_STACK_OVERLAY)
    }
  }
}

/**
 * After dragging assets/inspector above/below each other, dockview often sizes the
 * new column to (assets + inspector). Snap the column to the drop-target panel's
 * pre-stack width (e.g. drag assets under inspector → keep inspector width).
 */
export function handleSidePanelMoved(dock: DockviewApi, movedId: string): void {
  if (!isSidePanelId(movedId)) return
  clearDockviewDropOverlays(
    typeof document !== 'undefined' ? document.querySelector('.studio-dock') : null
  )
  configureSidePanelStackDropTargets(dock)

  // 合并为 Tab 组：共享同一列，列宽归一化不适用（areSidePanelsStackedVertically 已同组短路）。
  // dockview 会激活被拖入的面板，若它处于收起态需切回未收起的一侧。
  if (areSidePanelsTabbed(dock)) {
    syncTabbedGroupActiveState(dock, movedId)
    // dockview 在下一帧才落定激活项，再同步一次
    requestAnimationFrame(() => {
      clearDockviewDropOverlays(
        typeof document !== 'undefined' ? document.querySelector('.studio-dock') : null
      )
      configureSidePanelStackDropTargets(dock)
      syncTabbedGroupActiveState(dock, movedId)
    })
    return
  }

  const targetId = otherSidePanelId(movedId)
  const columnWidth =
    pendingStackColumnWidth > 16
      ? pendingStackColumnWidth
      : readSoloWidth(targetId)
  armStackNormalizeWindow()
  scheduleStackedColumnNormalize(dock, columnWidth)
  // 叠放后偶发留下窄列灰洞；下一帧再压一次列宽并清 overlay
  requestAnimationFrame(() => {
    clearDockviewDropOverlays(
      typeof document !== 'undefined' ? document.querySelector('.studio-dock') : null
    )
    configureSidePanelStackDropTargets(dock)
    scheduleStackedColumnNormalize(dock, columnWidth)
    reassertCollapsedHidden(dock)
  })
}

/** Layout churn after DnD — keep correcting until the summed width is gone. */
export function handleSidePanelLayoutMaybeStacked(dock: DockviewApi): void {
  if (Date.now() > stackNormalizeUntil) return
  const assets = dock.getPanel('assets')
  const inspector = dock.getPanel('inspector')
  if (!assets || !inspector) return
  if (sidePanelCollapsed.assets || sidePanelCollapsed.inspector) return
  if (!areSidePanelsStackedVertically(assets, inspector)) return
  const current = readPanelWidth(inspector.api) || readPanelWidth(assets.api)
  const soloA = readSoloWidth('assets')
  const soloB = readSoloWidth('inspector')
  const target =
    pendingStackColumnWidth > 16
      ? pendingStackColumnWidth
      : Math.min(soloA || current, soloB || current)
  if (!(target > 16)) return
  // Prefer correcting only the classic "sum of both" widen.
  const looksLikeSum = soloA > 16 && soloB > 16 && current > soloA + soloB - 40
  if (looksLikeSum || current > target + 40) {
    scheduleStackedColumnNormalize(dock, target)
  }
}

type MutableDockConstraints = {
  _minimumWidth?: number
  _maximumWidth?: number
}

/** Keep panel constraint fields in sync so layout JSON round-trips correctly. */
function patchPanelWidthConstraints(
  panel: IDockviewPanel | undefined,
  minimumWidth: number,
  maximumWidth: number | undefined
): void {
  if (!panel) return
  const mutable = panel as unknown as MutableDockConstraints
  mutable._minimumWidth = minimumWidth
  mutable._maximumWidth = maximumWidth
}

function syncCollapsedClass(api: DockviewPanelApi, collapsed: boolean): void {
  const el = api.group?.element
  if (!(el instanceof HTMLElement)) return
  el.classList.toggle('studio-side-collapsed', collapsed)
}

/** Hide from layout entirely — width:0 + CSS max-width leaves a grey hole in the grid. */
function setSidePanelGroupVisible(api: DockviewPanelApi, visible: boolean): void {
  api.group?.api.setVisible(visible)
}

function applyWidthConstraints(
  api: DockviewPanelApi,
  panel: IDockviewPanel | undefined,
  minimumWidth: number,
  maximumWidth: number | undefined
): void {
  const max = maximumWidth ?? Number.MAX_SAFE_INTEGER
  api.group?.api.setConstraints({
    minimumWidth,
    maximumWidth: max
  })
  api.setConstraints({
    minimumWidth,
    maximumWidth: max
  })
  patchPanelWidthConstraints(panel, minimumWidth, maximumWidth)
}

function applyCollapsedState(
  api: DockviewPanelApi,
  panel: IDockviewPanel | undefined,
  collapsed: boolean,
  opts?: SidePanelSizeOptions
): void {
  if (collapsed) {
    // 先隐藏再钳 0 宽：若先 setSize(0) 仍可见，会在资产/参数旁留下灰条
    setSidePanelGroupVisible(api, false)
    applyWidthConstraints(api, panel, SIDE_COLLAPSE_WIDTH, SIDE_COLLAPSE_WIDTH)
    api.setSize({ width: SIDE_COLLAPSE_WIDTH })
    // moveTo 后 dockview 偶发重新显示组；再藏一次
    setSidePanelGroupVisible(api, false)
    syncCollapsedClass(api, true)
    return
  }
  // 必须先放开 min/max，再 setVisible：dockview 会按「当前」约束钳位缓存尺寸，
  // 若仍是 maximumWidth=0，先显示会把宽度永久钳成 0（灰洞）。
  const minSide = opts?.minSide ?? 300
  applyWidthConstraints(api, panel, minSide, undefined)
  setSidePanelGroupVisible(api, true)
  syncCollapsedClass(api, false)
}

function resolvePanel(api: DockviewPanelApi, panel?: IDockviewPanel): IDockviewPanel | undefined {
  if (panel) return panel
  return api.group?.panels?.find((item) => item.id === api.id)
}

function otherSidePanelId(id: SidePanelId): SidePanelId {
  return id === 'assets' ? 'inspector' : 'assets'
}

/**
 * Rail order is assets (upper) then inspector.
 * When expanding inspector while assets is empty, open beside the workspace (upper slot).
 * When collapsing, park the zero-width group to the far right so it does not leave a gap.
 */
function placeSidePanel(dock: DockviewApi, id: SidePanelId, expanding: boolean): void {
  const panel = dock.getPanel(id)
  if (!panel) return

  // Tab 合并组：收起 = 切到另一个 Tab，展开 = 切回本 Tab，两侧都收起则隐藏整组。
  // 不做位移摆放、宽度收窄与 group 级收起样式——共享 group 上这些都会连带压没另一个面板。
  // 该分支不依赖工作区面板，需先于 workspace 判空执行。
  if (areSidePanelsTabbed(dock)) {
    syncTabbedGroupActiveState(dock, expanding ? id : undefined)
    return
  }

  const workspace = dock.getPanel(WORKSPACE_PANEL_ID)
  if (!workspace) return

  if (expanding) {
    if (id === 'inspector' && sidePanelCollapsed.assets) {
      // 上方为空 → 贴工作区右侧打开，并把收起的资产挪到更外侧
      panel.api.moveTo({ group: workspace.group, position: 'right' })
      const assets = dock.getPanel('assets')
      if (assets) {
        assets.api.moveTo({ group: panel.group, position: 'right' })
        applyCollapsedState(assets.api, assets, true)
      }
      return
    }
    if (id === 'inspector') {
      const assets = dock.getPanel('assets')
      if (assets) {
        panel.api.moveTo({ group: assets.group, position: 'right' })
      }
      return
    }
    // assets：始终占靠工作区的上方位
    panel.api.moveTo({ group: workspace.group, position: 'right' })
    if (!sidePanelCollapsed.inspector) {
      const inspector = dock.getPanel('inspector')
      if (inspector) {
        inspector.api.moveTo({ group: panel.group, position: 'right' })
      }
    } else {
      const inspector = dock.getPanel('inspector')
      if (inspector) {
        inspector.api.moveTo({ group: panel.group, position: 'right' })
        applyCollapsedState(inspector.api, inspector, true)
      }
    }
    return
  }

  // collapsing：挪到任意仍展开的侧栏右侧，避免中间空挡
  const otherId = otherSidePanelId(id)
  if (!sidePanelCollapsed[otherId]) {
    const other = dock.getPanel(otherId)
    if (other && other.group.id !== panel.group.id) {
      panel.api.moveTo({ group: other.group, position: 'right' })
    }
  }
}

/** moveTo 之后再断言一次收起隐藏，避免 0 宽组重新入局形成灰洞 */
function reassertCollapsedHidden(dock: DockviewApi): void {
  // Tab 合并组：收起的面板只是非活动 Tab，无几何处理（避免把共享列宽收窄成灰条）
  if (areSidePanelsTabbed(dock)) return
  for (const id of SIDE_PANEL_IDS) {
    if (!sidePanelCollapsed[id]) continue
    const panel = dock.getPanel(id)
    if (!panel) continue
    applyCollapsedState(panel.api, panel, true)
  }
}

export function setSidePanelCollapsed(
  api: DockviewPanelApi,
  collapsed: boolean,
  opts: SidePanelSizeOptions,
  panel?: IDockviewPanel
): void {
  const id = api.id
  if (!isSidePanelId(id)) return
  const target = resolvePanel(api, panel)
  const dock = dockApiRef
  // Tab 合并组：group 由两个面板共享，group 级隐藏 / 0 宽 / 收起样式会连带压没另一个面板
  const tabbed = !!dock && areSidePanelsTabbed(dock)

  if (collapsed) {
    rememberCurrentWidth(api, id)
    sidePanelCollapsed[id] = true
    writeSideCollapsedPreference(id, true)
    if (dock) placeSidePanel(dock, id, false)
    // placeSidePanel 已按收起状态切好 Tab（两侧都收起时隐藏整组），不能再做几何收起
    if (!tabbed) {
      applyCollapsedState(api, resolvePanel(api, target), true)
      if (dock) reassertCollapsedHidden(dock)
    }
    return
  }

  // 先放开约束并显示，再 move，避免新 group 继承收起态
  sidePanelCollapsed[id] = false
  writeSideCollapsedPreference(id, false)
  if (tabbed) {
    // Tab 合并组：只切回本 Tab 并保证组可见，不改写共享列的约束与宽度
    if (dock) placeSidePanel(dock, id, true)
    return
  }
  const liveBeforeMove = resolvePanel(api, target)
  applyCollapsedState(api, liveBeforeMove, false, opts)
  if (dock) placeSidePanel(dock, id, true)

  const width = resolveExpandedWidth(id, opts)
  const live = resolvePanel(api, target)
  applyCollapsedState(api, live, false, opts)
  api.setSize({ width })
  writeStoredWidth(id, width)

  // 资产展开且参数仍开着时，参数被挪到资产右侧，需恢复其展开约束与宽度
  if (id === 'assets' && dock && !sidePanelCollapsed.inspector) {
    const inspector = dock.getPanel('inspector')
    if (inspector) {
      const inspectorOpts = resolveSidePanelSizeOptions('inspector')
      const inspectorWidth = resolveExpandedWidth('inspector', inspectorOpts)
      applyCollapsedState(inspector.api, inspector, false, inspectorOpts)
      inspector.api.setSize({ width: inspectorWidth })
      writeStoredWidth('inspector', inspectorWidth)
    }
  }

  // 展开一侧时另一侧可能被 moveTo 带出；再藏一次收起侧，去掉灰洞
  if (dock) {
    reassertCollapsedHidden(dock)
    attachExpandedWidthWatchers(dock)
  }
}

export function toggleSidePanelCollapsed(
  api: DockviewPanelApi,
  opts: SidePanelSizeOptions,
  panel?: IDockviewPanel
): void {
  const id = api.id
  if (!isSidePanelId(id)) return
  setSidePanelCollapsed(api, !sidePanelCollapsed[id], opts, panel)
}

/**
 * After layout restore / core panel ensure: detect narrow strips or honor
 * localStorage preference, then re-apply constraints so minSide=300 cannot reopen them.
 */
export function syncSidePanelCollapseState(
  dock: DockviewApi,
  optsFor: (id: SidePanelId) => SidePanelSizeOptions
): void {
  dockApiRef = dock

  // Tab 合并组：组由两个面板共享，逐面板做 group 级收起会把另一个面板一起压没，
  // 且 collapsed 会落 localStorage —— 刷新后整组消失。这里只同步状态位与 Tab 激活。
  if (areSidePanelsTabbed(dock)) {
    for (const id of SIDE_PANEL_IDS) {
      const panel = dock.getPanel(id)
      // 共享列宽仍记入展开宽度，拆开为独立面板后可沿用
      if (panel) {
        const width = readPanelWidth(panel.api)
        if (width > 16) writeStoredWidth(id, width)
      }
      const preferCollapsed = readSideCollapsedPreference(id) || sidePanelCollapsed[id]
      sidePanelCollapsed[id] = !!preferCollapsed
      writeSideCollapsedPreference(id, !!preferCollapsed)
    }
    syncTabbedGroupActiveState(dock)
    attachExpandedWidthWatchers(dock)
    configureSidePanelStackDropTargets(dock)
    return
  }

  for (const id of SIDE_PANEL_IDS) {
    const panel = dock.getPanel(id)
    if (!panel) {
      sidePanelCollapsed[id] = readSideCollapsedPreference(id)
      continue
    }

    const width = readPanelWidth(panel.api)
    // width===0 is ambiguous (pre-layout vs collapsed); prefer localStorage / known flag.
    const narrowStrip = width > 0 && width <= 8
    const preferCollapsed = readSideCollapsedPreference(id) || sidePanelCollapsed[id]
    const shouldCollapse = preferCollapsed || narrowStrip

    if (shouldCollapse) {
      if (width > 16) writeStoredWidth(id, width)
      sidePanelCollapsed[id] = true
      writeSideCollapsedPreference(id, true)
      applyCollapsedState(panel.api, panel, true)
      // 双保险：收起后若仍可见，会留下灰条/灰洞
      setSidePanelGroupVisible(panel.api, false)
    } else {
      if (width > 16) writeStoredWidth(id, width)
      sidePanelCollapsed[id] = false
      writeSideCollapsedPreference(id, false)
      const opts = optsFor(id)
      // 先放开约束再显示，避免 maxWidth=0 把展开宽度永久钳成灰洞
      applyCollapsedState(panel.api, panel, false, opts)
      setSidePanelGroupVisible(panel.api, true)
      // 仅在宽度已被收起态钳成 0/异常时拉回；正常展开尺寸保持 dockview 现状
      const liveW = readPanelWidth(panel.api)
      if (liveW <= 16) {
        const nextWidth = resolveExpandedWidth(id, opts)
        panel.api.setSize({ width: nextWidth })
        writeStoredWidth(id, nextWidth)
      }
    }
  }
  attachExpandedWidthWatchers(dock)
  configureSidePanelStackDropTargets(dock)
}

/** 展开宽度记忆（忽略当前是否收起），供布局 JSON 清洗 fallback */
export function rememberedExpandedSideWidth(
  id: SidePanelId,
  opts?: SidePanelSizeOptions
): number {
  return resolveExpandedWidth(id, opts ?? resolveSidePanelSizeOptions(id))
}

export function sidePanelInitialWidth(
  id: SidePanelId,
  expandedWidth: number,
  minSide: number,
  options?: { useRememberedWidth?: boolean; maxSide?: number }
): { initialWidth: number; minimumWidth: number; maximumWidth?: number } {
  if (readSideCollapsedPreference(id) || sidePanelCollapsed[id]) {
    return {
      initialWidth: SIDE_COLLAPSE_WIDTH,
      minimumWidth: SIDE_COLLAPSE_WIDTH,
      maximumWidth: SIDE_COLLAPSE_WIDTH
    }
  }
  // 工厂默认布局忽略记忆宽度，避免历史过大参数区把工作区压没
  if (options?.useRememberedWidth === false) {
    return {
      initialWidth: expandedWidth,
      minimumWidth: minSide
    }
  }
  const remembered = lastExpandedWidth[id] || readStoredWidth(id)
  if (!(remembered > 16)) {
    return { initialWidth: expandedWidth, minimumWidth: minSide }
  }
  const opts = {
    ...resolveSidePanelSizeOptions(id),
    ...(options?.maxSide != null ? { maxSide: options.maxSide } : {})
  }
  return {
    initialWidth: Math.round(
      Math.min(maxRememberedSideWidth(opts), Math.max(minSide, remembered))
    ),
    minimumWidth: minSide
  }
}
