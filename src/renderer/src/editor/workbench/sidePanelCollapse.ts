import { reactive } from 'vue'
import type { DockviewApi, DockviewPanelApi, IDockviewPanel } from 'dockview-vue'

export const SIDE_COLLAPSE_WIDTH = 36
export type SidePanelId = 'assets' | 'inspector'

export const SIDE_PANEL_IDS: readonly SidePanelId[] = ['assets', 'inspector']

const COLLAPSED_STORAGE_PREFIX = 'studio.dock.sideCollapsed.'

function readSideCollapsedPreference(id: SidePanelId): boolean {
  try {
    return localStorage.getItem(`${COLLAPSED_STORAGE_PREFIX}${id}`) === '1'
  } catch {
    return false
  }
}

/** Reactive collapse flags for dock tab buttons */
export const sidePanelCollapsed = reactive<Record<SidePanelId, boolean>>({
  assets: readSideCollapsedPreference('assets'),
  inspector: readSideCollapsedPreference('inspector')
})

const lastExpandedWidth: Record<SidePanelId, number> = {
  assets: 0,
  inspector: 0
}

export type SidePanelSizeOptions = {
  minSide: number
  maxSide: number
  defaultWidth: number
}

let sizeOptionsProvider: ((id: SidePanelId) => SidePanelSizeOptions) | null = null

export function registerSidePanelSizeProvider(
  provider: ((id: SidePanelId) => SidePanelSizeOptions) | null
): void {
  sizeOptionsProvider = provider
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

function clampExpandedWidth(width: number, opts: SidePanelSizeOptions): number {
  return Math.round(Math.min(opts.maxSide, Math.max(opts.minSide, width)))
}

function readPanelWidth(api: DockviewPanelApi): number {
  const panelW = api.width
  if (typeof panelW === 'number' && panelW > 0) return panelW
  const groupW = api.group?.api?.width
  if (typeof groupW === 'number' && groupW > 0) return groupW
  return 0
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
  // Panel-level setConstraints is a no-op for DockviewPanel width fields;
  // still call it in case future dockview wires it through.
  api.setConstraints({
    minimumWidth,
    maximumWidth: max
  })
  patchPanelWidthConstraints(panel, minimumWidth, maximumWidth)
}

function resolvePanel(api: DockviewPanelApi, panel?: IDockviewPanel): IDockviewPanel | undefined {
  if (panel) return panel
  return api.group?.panels?.find((item) => item.id === api.id)
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

  if (collapsed) {
    const current = readPanelWidth(api)
    if (current > SIDE_COLLAPSE_WIDTH + 16) {
      lastExpandedWidth[id] = current
    }
    applyWidthConstraints(api, target, SIDE_COLLAPSE_WIDTH, SIDE_COLLAPSE_WIDTH)
    api.setSize({ width: SIDE_COLLAPSE_WIDTH })
  } else {
    const remembered = lastExpandedWidth[id]
    const width =
      remembered > SIDE_COLLAPSE_WIDTH
        ? clampExpandedWidth(remembered, opts)
        : clampExpandedWidth(opts.defaultWidth, opts)
    applyWidthConstraints(api, target, opts.minSide, undefined)
    api.setSize({ width })
  }

  sidePanelCollapsed[id] = collapsed
  writeSideCollapsedPreference(id, collapsed)
  syncCollapsedClass(api, collapsed)
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
  for (const id of SIDE_PANEL_IDS) {
    const panel = dock.getPanel(id)
    if (!panel) {
      sidePanelCollapsed[id] = readSideCollapsedPreference(id)
      continue
    }

    const width = readPanelWidth(panel.api)
    const narrow = width > 0 && width <= SIDE_COLLAPSE_WIDTH + 8
    const preferCollapsed = readSideCollapsedPreference(id)
    const shouldCollapse = narrow || preferCollapsed

    if (shouldCollapse) {
      if (width > SIDE_COLLAPSE_WIDTH + 16) {
        lastExpandedWidth[id] = width
      }
      setSidePanelCollapsed(panel.api, true, optsFor(id), panel)
    } else {
      // Ensure expanded constraints (layout may still have stale max=36 from a prior session).
      sidePanelCollapsed[id] = false
      applyWidthConstraints(panel.api, panel, optsFor(id).minSide, undefined)
      syncCollapsedClass(panel.api, false)
    }
  }
}

export function sidePanelInitialWidth(
  id: SidePanelId,
  expandedWidth: number,
  minSide: number
): { initialWidth: number; minimumWidth: number; maximumWidth?: number } {
  if (readSideCollapsedPreference(id) || sidePanelCollapsed[id]) {
    return {
      initialWidth: SIDE_COLLAPSE_WIDTH,
      minimumWidth: SIDE_COLLAPSE_WIDTH,
      maximumWidth: SIDE_COLLAPSE_WIDTH
    }
  }
  return {
    initialWidth: expandedWidth,
    minimumWidth: minSide
  }
}
