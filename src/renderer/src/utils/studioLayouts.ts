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
