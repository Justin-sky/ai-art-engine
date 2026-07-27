import type { InjectionKey } from 'vue'

/** 与 Dock EditorPanelKind 对齐 */
export type EditorDiveKind =
  | 'asset'
  | 'screenplay'
  | 'script'
  | 'canvas'
  | 'world'
  | 'narrative'
  | 'director'

/** Dive 栈帧：同面板内进入的子资产层 */
export interface EditorDiveFrame {
  assetId: string
  title: string
  kind: EditorDiveKind
}

/** 根面板提供的 dive 上下文（子图 NodeGraphEditor / GraphNodeCard 注入） */
export interface EditorDiveContext {
  rootKey: string
  rootTitle: string
  frames: EditorDiveFrame[]
  /** index=-1 回到根；否则 pop 到该帧（含） */
  popTo: (index: number) => void
}

export const editorDiveKey: InjectionKey<EditorDiveContext> = Symbol('editorDive')

const ROOT_KEY_PREFIX: Record<EditorDiveKind, string> = {
  asset: 'asset-editor-',
  screenplay: 'screenplay-editor-',
  script: 'script-editor-',
  canvas: 'canvas-editor-',
  world: 'world-editor-',
  narrative: 'narrative-editor-',
  director: 'director-editor-'
}

/** 与 Dock panel id 对齐 */
export function editorDiveRootKey(kind: EditorDiveKind, assetId: string): string {
  return `${ROOT_KEY_PREFIX[kind]}${assetId.trim()}`
}
