import type { InjectionKey } from 'vue'
import type {
  EmotionPadState,
  ImageCropState,
  ImageExpandState,
  ImageEraseState,
  ImageGridSplitState,
  ImageLayerSplitState,
  ImageLayerSplitNestedRequest,
  ImageMatteState,
  ImageRedrawState,
  LightingSetupState,
  MultiAngleCameraState,
  PortraitQualityState
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
  selectVoice: {
    open: boolean
    title: string
    items: unknown[]
    selectedVoiceId: string
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
    generateModel: string
    generateProviderInstanceId: string
  }
  lighting: {
    open: boolean
    previewUrl: string
    setup: LightingSetupState | null
    generateModel: string
    generateProviderInstanceId: string
  }
  framePull: {
    open: boolean
    hostId: string
    nodeId: string
  }
  reshoot: {
    open: boolean
    hostId: string
    nodeId: string
  }
  closeFramePull: () => void
  closeReshoot: () => void
  portraitTexture: {
    open: boolean
    setup: PortraitQualityState | null
    sourceUrl: string
    sourceLoading: boolean
    generateModel: string
    generateProviderInstanceId: string
  }
  emotion: {
    open: boolean
    previewUrl: string
    setup: EmotionPadState | null
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
  }
  layerSplit: {
    open: boolean
    setup: ImageLayerSplitState | null
    sourceUrl: string
    sourceLoading: boolean
    layerUrls: Record<string, string>
    generateModel: string
    generateProviderInstanceId: string
    splitting: boolean
    splitError: string
  }
  closeTextNotepad: () => void
  saveTextNotepad: (text: string) => void
  closeSelectImage: () => void
  saveSelectImage: (imageId: string) => void
  closeSelectVideo: () => void
  saveSelectVideo: (videoId: string) => void
  closeSelectVoice: () => void
  saveSelectVoice: (voiceId: string) => void
  closeSelectText: () => void
  saveSelectText: (textId: string) => void | Promise<void>
  closeTextsPreview: () => void
  closeMultiAngle: () => void
  previewMultiAngle: (payload: unknown) => void
  saveMultiAngle: (payload: unknown) => void
  closeLighting: () => void
  previewLighting: (payload: unknown) => void
  saveLighting: (payload: unknown) => void
  closePortraitTexture: () => void
  previewPortraitTexture: (payload: unknown) => void
  savePortraitTexture: (payload: unknown) => void
  closeEmotion: () => void
  previewEmotion: (payload: unknown) => void
  saveEmotion: (payload: unknown) => void
  closeExpand: () => void
  previewExpand: (payload: unknown) => void
  saveExpand: (payload: unknown) => void
  closeRedraw: () => void
  previewRedraw: (payload: unknown) => void
  saveRedraw: (payload: unknown) => void
  closeErase: () => void
  previewErase: (payload: unknown) => void
  saveErase: (payload: unknown) => void
  closeMatte: () => void
  previewMatte: (payload: unknown) => void
  saveMatte: (payload: unknown) => void
  closeCrop: () => void
  previewCrop: (payload: unknown) => void
  saveCrop: (payload: unknown) => void
  closeGridSplit: () => void
  previewGridSplit: (payload: unknown) => void
  saveGridSplit: (payload: unknown) => void
  closeLayerSplit: () => void
  previewLayerSplit: (payload: unknown) => void
  saveLayerSplit: (payload: unknown) => void
  splitSelectedLayerSplit: (payload: ImageLayerSplitNestedRequest) => void | Promise<void>
}

export const graphEditorDialogsKey: InjectionKey<GraphEditorDialogsApi> = Symbol('graphEditorDialogs')
