import type { InjectionKey } from 'vue'
import type { WorldElementKind } from '@shared/graph'

/** 与 Dock EditorPanelKind 对齐 */
export type EditorDiveKind =
  | 'asset'
  | 'screenplay'
  | 'canvas'
  | 'world'
  | 'beat'
  | 'director'

/** 逻辑视图 id（双击侧栏/表格/工具/预览等） */
export type EditorDiveViewId =
  | 'script.timeline'
  | 'world.editor'
  | 'world.table'
  | 'beat.gen'
  | 'beat.table'
  | 'director.stage'
  | 'ui.split'
  | 'node.notepad'
  | 'node.textsPreview'
  | 'node.selectImage'
  | 'node.selectVideo'
  | 'node.selectVoice'
  | 'node.selectText'
  | 'node.multiAngle'
  | 'node.adVariants'
  | 'node.lighting'
  | 'node.framePull'
  | 'node.reshoot'
  | 'node.portraitTexture'
  | 'node.emotion'
  | 'node.expand'
  | 'node.redraw'
  | 'node.erase'
  | 'node.matte'
  | 'node.crop'
  | 'node.gridSplit'
  | 'node.layerSplit'
  | 'node.instruction'
  | 'comic.page'
  | 'media.preview'

export type EditorDiveNodeToolViewId = Extract<
  EditorDiveViewId,
  | 'node.notepad'
  | 'node.textsPreview'
  | 'node.selectImage'
  | 'node.selectVideo'
  | 'node.selectVoice'
  | 'node.selectText'
  | 'node.multiAngle'
  | 'node.adVariants'
  | 'node.lighting'
  | 'node.framePull'
  | 'node.reshoot'
  | 'node.portraitTexture'
  | 'node.emotion'
  | 'node.expand'
  | 'node.redraw'
  | 'node.erase'
  | 'node.matte'
  | 'node.crop'
  | 'node.gridSplit'
  | 'node.layerSplit'
  | 'node.instruction'
>

export type EditorDiveViewMeta =
  | { viewId: 'script.timeline'; scriptAssetId: string; timelineNodeId?: string }
  | {
      viewId: 'world.editor'
      worldAssetId: string
      tab?: WorldElementKind
      /** 打开的 world.gen 节点；缺省 / 旧版默认节点编辑资产级共享子图 */
      worldGenNodeId?: string
    }
  | { viewId: 'world.table'; worldAssetId: string }
  | { viewId: 'beat.gen'; beatAssetId: string }
  | { viewId: 'beat.table'; beatAssetId: string }
  | {
      viewId: 'director.stage'
      directorAssetId: string
      processingNodeId?: string
    }
  | { viewId: 'ui.split'; hostId: string; nodeId: string }
  | { viewId: 'comic.page'; hostId: string; nodeId: string }
  | {
      viewId: EditorDiveNodeToolViewId
      hostId: string
      nodeId: string
      mode?: string
    }
  | {
      viewId: 'media.preview'
      mediaKind: 'image' | 'video' | 'audio' | 'text'
      url: string
      title?: string
      relativePath?: string
      text?: string
    }

export interface EditorDiveAssetFrame {
  type: 'asset'
  key: string
  assetId: string
  kind: EditorDiveKind
  title: string
}

export interface EditorDiveViewFrame {
  type: 'view'
  key: string
  viewId: EditorDiveViewId
  title: string
  meta: EditorDiveViewMeta
}

/** Dive 栈帧：资产宿主或逻辑视图 */
export type EditorDiveFrame = EditorDiveAssetFrame | EditorDiveViewFrame

/** 根面板提供的 dive 上下文（子图 NodeGraphEditor / GraphNodeCard 注入） */
export interface EditorDiveContext {
  rootKey: string
  rootTitle: string
  frames: EditorDiveFrame[]
  diveAsset: (assetId: string) => boolean | Promise<boolean>
  diveView: (meta: EditorDiveViewMeta, title?: string) => boolean | Promise<boolean>
  /** index=-1 回到根；否则 pop 到该帧（含） */
  popTo: (index: number) => void
}

export const editorDiveKey: InjectionKey<EditorDiveContext> = Symbol('editorDive')

const ROOT_KEY_PREFIX: Record<EditorDiveKind, string> = {
  asset: 'asset-editor-',
  screenplay: 'screenplay-editor-',
  canvas: 'canvas-editor-',
  world: 'world-editor-',
  beat: 'beat-editor-',
  director: 'director-editor-'
}

/** 与 Dock panel id 对齐 */
export function editorDiveRootKey(kind: EditorDiveKind, assetId: string): string {
  return `${ROOT_KEY_PREFIX[kind]}${assetId.trim()}`
}

export function editorDiveAssetFrameKey(kind: EditorDiveKind, assetId: string): string {
  return `asset:${kind}:${assetId.trim()}`
}

export function editorDiveViewFrameKey(rootKey: string, meta: EditorDiveViewMeta): string {
  const root = rootKey.trim()
  switch (meta.viewId) {
    case 'script.timeline':
      return `${root}/view:${meta.viewId}:${meta.scriptAssetId}:${meta.timelineNodeId ?? '_'}`
    case 'world.table':
      return `${root}/view:${meta.viewId}:${meta.worldAssetId}`
    case 'world.editor':
      return `${root}/view:${meta.viewId}:${meta.worldAssetId}:${meta.worldGenNodeId ?? '_'}:${meta.tab ?? 'characters'}`
    case 'beat.table':
    case 'beat.gen':
      return `${root}/view:${meta.viewId}:${meta.beatAssetId}`
    case 'director.stage':
      return `${root}/view:director.stage:${meta.directorAssetId}:${meta.processingNodeId ?? '_default'}`
    case 'ui.split':
      return `${root}/view:ui.split:${meta.hostId}:${meta.nodeId}`
    case 'comic.page':
      return `${root}/view:comic.page:${meta.hostId}:${meta.nodeId}`
    case 'media.preview':
      return `${root}/view:media.preview:${meta.mediaKind}:${meta.relativePath || meta.url}`
    default:
      return `${root}/view:${meta.viewId}:${meta.hostId}:${meta.nodeId}:${meta.mode ?? '_'}`
  }
}

export function isEditorDiveAssetFrame(
  frame: EditorDiveFrame | null | undefined
): frame is EditorDiveAssetFrame {
  return !!frame && frame.type === 'asset'
}

export function isEditorDiveViewFrame(
  frame: EditorDiveFrame | null | undefined
): frame is EditorDiveViewFrame {
  return !!frame && frame.type === 'view'
}

export function editorDiveFrameAssetId(frame: EditorDiveFrame | null | undefined): string | null {
  if (!frame) return null
  if (frame.type === 'asset') return frame.assetId
  return null
}
