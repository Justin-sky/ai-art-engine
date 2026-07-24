import type { InjectionKey } from 'vue'
import type {
  EmotionPadState,
  ImageCropState,
  ImageExpandState,
  ImageEraseState,
  ImageGridSplitState,
  ImageMatteState,
  ImageRedrawState,
  ImageUpscaleState,
  LightingSetupState,
  MultiAngleCameraState,
  PortraitTextureState
} from '@shared/graph'

/** 图编辑器 Dialog 层：状态在父组件，但模板隔离，避免 open 时整图重渲 */
export type GraphEditorDialogsApi = {
  notepad: {
    open: boolean
    title: string
    text: string
    editable: boolean
  }
  selectImage: {
    open: boolean
    title: string
    items: unknown[]
    selectedImageId: string
  }
  selectVideo: {
    open: boolean
    title: string
    items: unknown[]
    selectedVideoId: string
  }
  selectText: {
    open: boolean
    title: string
    items: unknown[]
    selectedTextId: string
  }
  textsPreview: {
    open: boolean
    title: string
    items: unknown[]
  }
  multiAngle: {
    open: boolean
    previewUrl: string
    panelPrompt: string
    camera: MultiAngleCameraState | null
  }
  lighting: {
    open: boolean
    previewUrl: string
    setup: LightingSetupState | null
  }
  portraitTexture: {
    open: boolean
    setup: PortraitTextureState | null
  }
  emotion: {
    open: boolean
    previewUrl: string
    setup: EmotionPadState | null
  }
  upscale: {
    open: boolean
    setup: ImageUpscaleState | null
    generateModel: string
    generateProviderInstanceId: string
  }
  expand: {
    open: boolean
    setup: ImageExpandState | null
    sourceUrl: string
    sourceLoading: boolean
    generateModel: string
    generateProviderInstanceId: string
  }
  redraw: {
    open: boolean
    setup: ImageRedrawState | null
    sourceUrl: string
    sourceLoading: boolean
    generateModel: string
    generateProviderInstanceId: string
  }
  erase: {
    open: boolean
    setup: ImageEraseState | null
    sourceUrl: string
    sourceLoading: boolean
    generateModel: string
    generateProviderInstanceId: string
  }
  matte: {
    open: boolean
    setup: ImageMatteState | null
    sourceUrl: string
    sourceLoading: boolean
    generateModel: string
    generateProviderInstanceId: string
  }
  crop: {
    open: boolean
    setup: ImageCropState | null
    sourceUrl: string
    sourceLoading: boolean
  }
  gridSplit: {
    open: boolean
    setup: ImageGridSplitState | null
    sourceUrl: string
    sourceLoading: boolean
    generateModel: string
    generateProviderInstanceId: string
  }
  closeTextNotepad: () => void
  saveTextNotepad: (text: string) => void
  closeSelectImage: () => void
  saveSelectImage: (imageId: string) => void
  closeSelectVideo: () => void
  saveSelectVideo: (videoId: string) => void
  closeSelectText: () => void
  saveSelectText: (textId: string) => void | Promise<void>
  closeTextsPreview: () => void
  closeMultiAngle: () => void
  saveMultiAngle: (payload: unknown) => void
  closeLighting: () => void
  saveLighting: (payload: unknown) => void
  closePortraitTexture: () => void
  savePortraitTexture: (payload: unknown) => void
  closeEmotion: () => void
  saveEmotion: (payload: unknown) => void
  closeUpscale: () => void
  saveUpscale: (payload: unknown) => void
  closeExpand: () => void
  saveExpand: (payload: unknown) => void
  closeRedraw: () => void
  saveRedraw: (payload: unknown) => void
  closeErase: () => void
  saveErase: (payload: unknown) => void
  closeMatte: () => void
  saveMatte: (payload: unknown) => void
  closeCrop: () => void
  saveCrop: (payload: unknown) => void
  closeGridSplit: () => void
  saveGridSplit: (payload: unknown) => void
}

export const graphEditorDialogsKey: InjectionKey<GraphEditorDialogsApi> = Symbol('graphEditorDialogs')
