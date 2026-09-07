import type { InjectionKey } from 'vue'
import type {
  AdVariantMatrix,
  EmotionPadState,
  ImageAlignState,
  ImageComposeState,
  ImageCropState,
  ImageExpandState,
  ImageEraseState,
  ImageGridSplitState,
  ImageCutoutState,
  ImageLayerSplitState,
  ImageLayerSplitNestedRequest,
  ImageMatteState,
  ImageRedrawState,
  LightingSetupState,
  MultiAngleCameraState,
  PortraitQualityState,
  Stage2dPose,
  Stage2dRig,
  Stage2dSceneState,
  Stage2dAction
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
  adVariants: {
    open: boolean
    matrix: AdVariantMatrix | null
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
  cutout: {
    open: boolean
    setup: ImageCutoutState | null
    sourceUrl: string
    sourceLoading: boolean
  }
  compose: {
    open: boolean
    setup: ImageComposeState | null
    sourceUrl: string
    sourceLoading: boolean
  }
  align: {
    open: boolean
    setup: ImageAlignState | null
    sourceUrl: string
    sourceLoading: boolean
  }
  stage2d: {
    open: boolean
    setup: Stage2dSceneState | null
    setupRig: Stage2dRig | null
    setupPose: Stage2dPose | null
    setupAction: Stage2dAction | null
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
  closeAdVariants: () => void
  saveAdVariants: (payload: {
    matrix: AdVariantMatrix
    generateModel: string
    generateProviderInstanceId: string
  }) => void
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
  /** dive 面包屑回退前提交裁剪的实时预览编辑，补记撤销命令 */
  flushCrop: () => void
  closeGridSplit: () => void
  previewGridSplit: (payload: unknown) => void
  saveGridSplit: (payload: unknown) => void
  /** dive 面包屑回退前提交网格拆分的实时预览编辑，补记撤销命令 */
  flushGridSplit: () => void
  closeCutout: () => void
  saveCutout: (payload: { imageCutout: ImageCutoutState; dataUrl?: string }) => void | Promise<void>
  /** dive 面包屑回退前结束抠图编辑，补记撤销命令 */
  flushCutout: () => void
  closeCompose: () => void
  saveCompose: (payload: { imageCompose: ImageComposeState; dataUrl?: string }) => void | Promise<void>
  /** dive 面包屑回退前结束构图编辑，补记撤销命令 */
  flushCompose: () => void
  closeAlign: () => void
  saveAlign: (payload: { imageAlign: ImageAlignState; dataUrl?: string }) => void | Promise<void>
  /** dive 面包屑回退前结束对齐编辑，补记撤销命令 */
  flushAlign: () => void
  closeStage2d: () => void
  saveStage2d: (payload: {
    stage2dScene: Stage2dSceneState
    stage2dRig?: Stage2dRig
    stage2dPose?: Stage2dPose
    stage2dAction?: Stage2dAction | null
    dataUrl?: string
  }) => void | Promise<void>
  /** 导出 2D 骨骼动作帧序列：逐帧透明 PNG + 单张水平 sheet 落盘为工程资产（不入节点 params） */
  exportStage2dFrames: (payload: {
    actionId: string
    fps: number
    duration: number
    frames: string[]
    sheet: string | null
  }) => void | Promise<void>
  /** dive 面包屑回退前结束 2D 舞台编辑，补记撤销命令 */
  flushStage2d: () => void
  closeLayerSplit: () => void
  previewLayerSplit: (payload: unknown) => void
  saveLayerSplit: (payload: unknown) => void
  splitSelectedLayerSplit: (payload: ImageLayerSplitNestedRequest) => void | Promise<void>
  /** dive 面包屑回退前提交图层拆分的实时预览编辑，补记撤销命令 */
  flushLayerSplit: () => void
}

export const graphEditorDialogsKey: InjectionKey<GraphEditorDialogsApi> = Symbol('graphEditorDialogs')
