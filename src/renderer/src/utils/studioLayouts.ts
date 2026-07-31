/** 工作室 dock 命名布局：本地存储 + 导入导出 */

export const STUDIO_LAYOUTS_KEY = 'studio.dock.layouts.v1'

export const DEFAULT_LAYOUT_ID = 'default'
export const LAYOUT_FILE_FORMAT = 'aiartengine-layout'
export const LAYOUT_FILE_VERSION = 1

export interface StudioLayoutPreset {
  id: string
  name: string
  /** 内置默认：切换时重建代码默认布局，不存 dock JSON */
  builtIn?: boolean
  /** dockview api.toJSON() */
  data: Record<string, unknown> | null
  updatedAt: string
}

export interface StudioLayoutsState {
  version: 1
  activeId: string
  presets: StudioLayoutPreset[]
}

export interface StudioLayoutFile {
  format: typeof LAYOUT_FILE_FORMAT
  version: typeof LAYOUT_FILE_VERSION
  name: string
  exportedAt: string
  layout: Record<string, unknown>
}

function nowIso(): string {
  return new Date().toISOString()
}

function createId(): string {
  return `layout-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function createDefaultPreset(name = 'Default'): StudioLayoutPreset {
  return {
    id: DEFAULT_LAYOUT_ID,
    name,
    builtIn: true,
    data: null,
    updatedAt: nowIso()
  }
}

export function emptyLayoutsState(defaultName = 'Default'): StudioLayoutsState {
  return {
    version: 1,
    activeId: DEFAULT_LAYOUT_ID,
    presets: [createDefaultPreset(defaultName)]
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function isDockLayoutData(data: unknown): data is Record<string, unknown> {
  return isRecord(data) && 'panels' in data
}

function normalizePreset(raw: unknown): StudioLayoutPreset | null {
  if (!isRecord(raw)) return null
  const id = typeof raw.id === 'string' ? raw.id : ''
  const name = typeof raw.name === 'string' ? raw.name.trim() : ''
  if (!id || !name) return null
  const data = raw.data === null ? null : isDockLayoutData(raw.data) ? raw.data : null
  if (id !== DEFAULT_LAYOUT_ID && !data) return null
  return {
    id,
    name,
    builtIn: id === DEFAULT_LAYOUT_ID || raw.builtIn === true,
    data: id === DEFAULT_LAYOUT_ID ? null : data,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : nowIso()
  }
}

export function loadLayoutsState(defaultName = 'Default'): StudioLayoutsState {
  try {
    const raw = localStorage.getItem(STUDIO_LAYOUTS_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as unknown
      if (isRecord(parsed) && Array.isArray(parsed.presets)) {
        const presets = parsed.presets
          .map(normalizePreset)
          .filter((p): p is StudioLayoutPreset => !!p)
        const hasDefault = presets.some((p) => p.id === DEFAULT_LAYOUT_ID)
        const list = hasDefault ? presets : [createDefaultPreset(defaultName), ...presets]
        const activeId =
          typeof parsed.activeId === 'string' && list.some((p) => p.id === parsed.activeId)
            ? parsed.activeId
            : DEFAULT_LAYOUT_ID
        return { version: 1, activeId, presets: list }
      }
    }
  } catch {
    // fall through
  }

  return emptyLayoutsState(defaultName)
}

export function saveLayoutsState(state: StudioLayoutsState): void {
  localStorage.setItem(STUDIO_LAYOUTS_KEY, JSON.stringify(state))
}

export function getActivePreset(state: StudioLayoutsState): StudioLayoutPreset {
  return state.presets.find((p) => p.id === state.activeId) ?? state.presets[0]!
}

export function upsertNamedLayout(
  state: StudioLayoutsState,
  name: string,
  data: Record<string, unknown>,
  options?: { targetId?: string | null }
): StudioLayoutsState {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('nameRequired')
  if (!isDockLayoutData(data)) throw new Error('invalidLayout')

  const targetId = options?.targetId
  if (targetId && targetId !== DEFAULT_LAYOUT_ID) {
    const idx = state.presets.findIndex((p) => p.id === targetId)
    if (idx >= 0) {
      const next = [...state.presets]
      next[idx] = {
        ...next[idx]!,
        name: trimmed,
        data,
        updatedAt: nowIso(),
        builtIn: false
      }
      return { ...state, activeId: targetId, presets: next }
    }
  }

  // 同名覆盖（不含默认）
  const sameName = state.presets.find(
    (p) => p.id !== DEFAULT_LAYOUT_ID && p.name.toLowerCase() === trimmed.toLowerCase()
  )
  if (sameName) {
    const next = state.presets.map((p) =>
      p.id === sameName.id
        ? { ...p, name: trimmed, data, updatedAt: nowIso(), builtIn: false }
        : p
    )
    return { ...state, activeId: sameName.id, presets: next }
  }

  const created: StudioLayoutPreset = {
    id: createId(),
    name: trimmed,
    data,
    updatedAt: nowIso()
  }
  return {
    ...state,
    activeId: created.id,
    presets: [...state.presets, created]
  }
}

/** 仅更新当前选中的自定义布局快照；内置默认不写入 data */
export function updateActiveLayoutData(
  state: StudioLayoutsState,
  data: Record<string, unknown>
): StudioLayoutsState {
  if (!isDockLayoutData(data)) return state
  const active = getActivePreset(state)
  if (active.id === DEFAULT_LAYOUT_ID || active.builtIn) return state
  return {
    ...state,
    presets: state.presets.map((p) =>
      p.id === active.id ? { ...p, data, updatedAt: nowIso() } : p
    )
  }
}

export function deleteLayout(state: StudioLayoutsState, id: string): StudioLayoutsState {
  if (id === DEFAULT_LAYOUT_ID) return state
  const presets = state.presets.filter((p) => p.id !== id)
  const activeId = state.activeId === id ? DEFAULT_LAYOUT_ID : state.activeId
  return { ...state, activeId, presets }
}

export function buildLayoutFile(name: string, layout: Record<string, unknown>): StudioLayoutFile {
  return {
    format: LAYOUT_FILE_FORMAT,
    version: LAYOUT_FILE_VERSION,
    name: name.trim() || 'Layout',
    exportedAt: nowIso(),
    layout
  }
}

export function parseLayoutFile(raw: unknown): StudioLayoutFile | null {
  if (!isRecord(raw)) return null
  if (raw.format !== LAYOUT_FILE_FORMAT) {
    // 兼容直接导出的 dockview JSON
    if (isDockLayoutData(raw)) {
      return {
        format: LAYOUT_FILE_FORMAT,
        version: LAYOUT_FILE_VERSION,
        name: 'Imported',
        exportedAt: nowIso(),
        layout: raw
      }
    }
    return null
  }
  if (!isDockLayoutData(raw.layout)) return null
  return {
    format: LAYOUT_FILE_FORMAT,
    version: LAYOUT_FILE_VERSION,
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : 'Imported',
    exportedAt: typeof raw.exportedAt === 'string' ? raw.exportedAt : nowIso(),
    layout: raw.layout
  }
}

export function downloadLayoutFile(file: StudioLayoutFile): void {
  const safe = file.name.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'layout'
  const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${safe}.layout.json`
  a.click()
  URL.revokeObjectURL(url)
}

export async function readLayoutFileFromInput(file: File): Promise<StudioLayoutFile> {
  const text = await file.text()
  const parsed = parseLayoutFile(JSON.parse(text) as unknown)
  if (!parsed) throw new Error('invalidLayoutFile')
  return parsed
}

type GridNode = {
  type?: unknown
  data?: unknown
  size?: unknown
  visible?: unknown
}

function isGridNode(value: unknown): value is GridNode {
  return isRecord(value) && (value.type === 'leaf' || value.type === 'branch')
}

function cleanGroupViews(
  group: Record<string, unknown>,
  removeIds: Set<string>
): Record<string, unknown> | null {
  const viewsRaw = group.views
  if (!Array.isArray(viewsRaw)) return group
  const views = viewsRaw.filter(
    (id): id is string => typeof id === 'string' && !removeIds.has(id)
  )
  if (views.length === 0) return null
  const activeView =
    typeof group.activeView === 'string' && views.includes(group.activeView)
      ? group.activeView
      : views[0]
  return { ...group, views, activeView }
}

function cleanGridNode(node: unknown, removeIds: Set<string>): GridNode | null {
  if (!isGridNode(node)) return null
  if (node.type === 'leaf') {
    if (!isRecord(node.data)) return null
    const cleaned = cleanGroupViews(node.data, removeIds)
    if (!cleaned) return null
    return { ...node, data: cleaned }
  }
  if (!Array.isArray(node.data)) return null
  const children = node.data
    .map((child) => cleanGridNode(child, removeIds))
    .filter((child): child is GridNode => child != null)
  if (children.length === 0) return null
  if (children.length === 1) return children[0]!
  return { ...node, data: children }
}

function cleanSerializedGrid(
  grid: unknown,
  removeIds: Set<string>
): Record<string, unknown> | null {
  if (!isRecord(grid) || !isGridNode(grid.root)) return null
  const cleanedRoot = cleanGridNode(grid.root, removeIds)
  if (!cleanedRoot) return null
  const root =
    cleanedRoot.type === 'branch'
      ? cleanedRoot
      : { type: 'branch', data: [cleanedRoot], size: cleanedRoot.size }
  return { ...grid, root }
}

function cleanFloatingGroup(
  group: unknown,
  removeIds: Set<string>
): Record<string, unknown> | null {
  if (!isRecord(group)) return null
  if (isRecord(group.data)) {
    const cleaned = cleanGroupViews(group.data, removeIds)
    if (!cleaned) return null
    return { ...group, data: cleaned }
  }
  if (group.grid != null) {
    const cleanedGrid = cleanSerializedGrid(group.grid, removeIds)
    if (!cleanedGrid) return null
    return { ...group, grid: cleanedGrid }
  }
  return group
}

/**
 * 从 dockview 序列化布局中移除指定面板，并同步清理 grid / floating / popout 中的 views 引用。
 * 只删 panels 而不清 views 会导致 fromJSON 失败，表现为布局切换无效。
 */
export function stripPanelsFromDockLayout(
  data: Record<string, unknown>,
  shouldStrip: (panelId: string) => boolean
): Record<string, unknown> {
  if (!isDockLayoutData(data)) return data
  const panels = data.panels
  if (!isRecord(panels)) return data

  const removeIds = new Set(
    Object.keys(panels).filter((id) => shouldStrip(id))
  )
  if (removeIds.size === 0) {
    return healDockLayoutMissingPanelRefs(data)
  }

  const nextPanels: Record<string, unknown> = {}
  for (const [id, panel] of Object.entries(panels)) {
    if (!removeIds.has(id)) nextPanels[id] = panel
  }

  const next: Record<string, unknown> = { ...data, panels: nextPanels }

  const cleanedGrid = cleanSerializedGrid(data.grid, removeIds)
  if (cleanedGrid) next.grid = cleanedGrid

  if (Array.isArray(data.floatingGroups)) {
    next.floatingGroups = data.floatingGroups
      .map((group) => cleanFloatingGroup(group, removeIds))
      .filter((group): group is Record<string, unknown> => group != null)
  }

  if (Array.isArray(data.popoutGroups)) {
    next.popoutGroups = data.popoutGroups
      .map((group) => cleanFloatingGroup(group, removeIds))
      .filter((group): group is Record<string, unknown> => group != null)
  }

  return healDockLayoutMissingPanelRefs(next)
}

const SIDE_PANEL_LAYOUT_IDS = new Set(['assets', 'inspector'])

function leafHasSidePanel(group: Record<string, unknown>): boolean {
  const views = group.views
  if (!Array.isArray(views)) return false
  return views.some((id) => typeof id === 'string' && SIDE_PANEL_LAYOUT_IDS.has(id))
}

function healSidePanelLeafNode(
  node: GridNode,
  fallbackWidth: (id: string) => number
): GridNode {
  if (node.type === 'leaf') {
    if (!isRecord(node.data) || !leafHasSidePanel(node.data)) return node
    const next: GridNode = { ...node }
    if (node.visible === false) {
      delete next.visible
    }
    const size = typeof node.size === 'number' ? node.size : 0
    if (!(size > 16)) {
      const views = Array.isArray(node.data.views) ? node.data.views : []
      const sideId = views.find(
        (id): id is string => typeof id === 'string' && SIDE_PANEL_LAYOUT_IDS.has(id)
      )
      const fallback = sideId ? fallbackWidth(sideId) : 0
      if (fallback > 16) next.size = fallback
    }
    return next
  }
  if (!Array.isArray(node.data)) return node
  return {
    ...node,
    data: node.data.map((child) =>
      isGridNode(child) ? healSidePanelLeafNode(child, fallbackWidth) : child
    )
  }
}

/**
 * 布局 JSON 只保留侧栏「展开几何」：收起态（visible:false / maxWidth:0）由运行时
 * localStorage 偏好叠加。避免保存/重开后把收起运行时态当成布局几何还原成灰洞。
 */
export function sanitizeSidePanelCollapseFromLayoutData(
  data: Record<string, unknown>,
  options?: {
    minSide?: number
    fallbackWidth?: (id: 'assets' | 'inspector') => number
  }
): Record<string, unknown> {
  if (!isDockLayoutData(data)) return data
  const minSide = options?.minSide ?? 300
  const fallbackWidth =
    options?.fallbackWidth ??
    ((_id: 'assets' | 'inspector') => minSide)

  let changed = false
  const panels = data.panels
  let nextPanels = panels
  if (isRecord(panels)) {
    nextPanels = { ...panels }
    for (const id of SIDE_PANEL_LAYOUT_IDS) {
      const panel = nextPanels[id]
      if (!isRecord(panel)) continue
      const maxW = panel.maximumWidth
      const minW = panel.minimumWidth
      const needsHeal =
        maxW === 0 ||
        (typeof maxW === 'number' && maxW > 0 && maxW <= 8) ||
        minW === 0 ||
        (typeof minW === 'number' && minW > 0 && minW <= 8)
      if (!needsHeal) continue
      const healed = { ...panel, minimumWidth: minSide }
      delete healed.maximumWidth
      nextPanels[id] = healed
      changed = true
    }
  }

  const resolveFallback = (id: string): number => {
    if (id === 'assets' || id === 'inspector') return fallbackWidth(id)
    return minSide
  }

  let nextGrid = data.grid
  if (isRecord(data.grid) && isGridNode(data.grid.root)) {
    const before = JSON.stringify(data.grid.root)
    const healedRoot = healSidePanelLeafNode(data.grid.root, resolveFallback)
    if (JSON.stringify(healedRoot) !== before) {
      nextGrid = { ...data.grid, root: healedRoot }
      changed = true
    }
  }

  if (!changed) return data
  return { ...data, panels: nextPanels, grid: nextGrid }
}

/**
 * 清理 grid 中引用了 panels 里不存在的 id 的 views（修复旧版错误剥离留下的坏数据）。
 */
export function healDockLayoutMissingPanelRefs(
  data: Record<string, unknown>
): Record<string, unknown> {
  if (!isDockLayoutData(data) || !isRecord(data.panels)) return data
  const validIds = new Set(Object.keys(data.panels))
  const removeIds = new Set<string>()

  const collectOrphans = (group: Record<string, unknown>): void => {
    const views = group.views
    if (!Array.isArray(views)) return
    for (const id of views) {
      if (typeof id === 'string' && !validIds.has(id)) removeIds.add(id)
    }
  }

  const walkGrid = (node: unknown): void => {
    if (!isGridNode(node)) return
    if (node.type === 'leaf' && isRecord(node.data)) collectOrphans(node.data)
    else if (Array.isArray(node.data)) node.data.forEach(walkGrid)
  }

  if (isRecord(data.grid)) walkGrid(data.grid.root)
  if (Array.isArray(data.floatingGroups)) {
    for (const group of data.floatingGroups) {
      if (!isRecord(group)) continue
      if (isRecord(group.data)) collectOrphans(group.data)
      if (isRecord(group.grid)) walkGrid(group.grid.root)
    }
  }
  if (Array.isArray(data.popoutGroups)) {
    for (const group of data.popoutGroups) {
      if (!isRecord(group)) continue
      if (isRecord(group.data)) collectOrphans(group.data)
      if (isRecord(group.grid)) walkGrid(group.grid.root)
    }
  }

  if (removeIds.size === 0) return data

  const next: Record<string, unknown> = { ...data }
  const cleanedGrid = cleanSerializedGrid(data.grid, removeIds)
  if (cleanedGrid) next.grid = cleanedGrid
  if (Array.isArray(data.floatingGroups)) {
    next.floatingGroups = data.floatingGroups
      .map((group) => cleanFloatingGroup(group, removeIds))
      .filter((group): group is Record<string, unknown> => group != null)
  }
  if (Array.isArray(data.popoutGroups)) {
    next.popoutGroups = data.popoutGroups
      .map((group) => cleanFloatingGroup(group, removeIds))
      .filter((group): group is Record<string, unknown> => group != null)
  }
  return next
}
