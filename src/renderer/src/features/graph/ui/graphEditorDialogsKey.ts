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
  IconPackState,
  ImageCutoutState,
  ImageLayerSplitState,
  ImageLayerSplitNestedRequest,
  ImageMatteState,
  ImageRedrawState,
  LightingSetupState,
  MultiAngleCameraState,
  PortraitQualityState,
  PortraitRetouchState,
  PortraitManualRegion,
  PortraitAiLayer,
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
  /**
   * 人像处理（`image.portrait`）：参数面板 + 提示词预览编辑器。
   *
   * 节点本身已经没有本地像素实现（执行器直接调图片模型），因此编辑器不再做实时烘焙预览，
   * 而是把「参数 → 提示词」这一步显性化：右栏底部实时显示最终提示词，用户看到的就是
   * 模型会收到的东西。编辑态仍挂在宿主（受控组件），dive 回退 / 主界面撤销都不会丢编辑。
   */
  portrait: {
    open: boolean
    setup: PortraitRetouchState | null
    /** 手动标注区域（发丝级没法自动定位的局部诉求） */
    regions: PortraitManualRegion[]
    /** 编辑器内 AI 处理产出的版本栈 */
    layers: PortraitAiLayer[]
    /** 当前底图版本 id（'' = 上游原图） */
    baseLayerId: string
    sourceUrl: string
    /** 上游原图 URL：只给「对比原图」按住对比用，与所选的底图版本无关 */
    upstreamUrl: string
    sourceLoading: boolean
    generateModel: string
    generateProviderInstanceId: string
    /** 局部回贴开关：'local'（默认，只改对应部位）| 'global'（整图生效） */
    scopeMode: 'local' | 'global'
    /** 出图底图来源：true = 以上次「保存并出图」的产物为底（默认 false = 上游原图） */
    chainFromOutput: boolean
    /** AI 处理进行中（编辑器据此禁用按钮并显示进度） */
    aiRunning: boolean
    /** 最近一次 AI 处理的失败原因（成功时清空） */
    aiError: string
    /**
     * 「保存并出图」进行中：编辑器**不关窗**，就地显示进度；
     * 跑完左边底图换成这次的产物。
     */
    runRunning: boolean
    /** 最近一次「保存并出图」的失败原因（成功时清空） */
    runError: string
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
  iconPack: {
    open: boolean
    setup: IconPackState | null
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
    /** 节点已设置的动作帧导出帧率（0 = 未开启，仅用于回填对话框） */
    setupAnimFps: number
    /** 最近一次运行产出的动作帧数（0 = 尚未产出，用于回显节点产物） */
    setupAnimFrameCount: number
    /** 最近一次运行产出的帧序列 sheet 工程相对路径（'' = 尚未产出） */
    setupAnimSheetPath: string
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
  closePortrait: () => void
  previewPortrait: (payload: unknown) => void
  savePortrait: (payload: unknown) => void
  /** 保存参数后关闭编辑器并运行该节点（按当前提示词调一次图片模型） */
  runPortrait: (payload: unknown) => void
  /** 切换人像底图版本（AI 版本栈）；`''` = 上游原图 */
  selectPortraitVersion: (layerId: string) => void
  /** 出图底图来源：以上次「保存并出图」的产物为底（默认关） */
  setPortraitChainFromOutput: (value: boolean) => void
  /** dive 面包屑回退前提交人像精修的实时预览编辑，补充撤销命令 */
  flushPortrait: () => void
  /**
   * 编辑器内 AI 处理（智能消除 / 换背景 / 妆容增强…）：
   * 跑图 → 落盘为工程资产 → 追加到 `portrait.layers` 并把底图切到新版本。
   */
  runPortraitAi: (payload: unknown) => void
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
  closeIconPack: () => void
  previewIconPack: (payload: unknown) => void
  saveIconPack: (payload: unknown) => void
  /** dive 面包屑回退前提交图标包参数编辑，补记撤销命令 */
  flushIconPack: () => void
  closeCutout: () => void
  saveCutout: (payload: { imageCutout: ImageCutoutState; dataUrl?: string }) => void | Promise<void>
  /** dive 面包屑回退前结束抠图编辑，补记撤销命令 */
  flushCutout: () => void
  closeCompose: () => void
  saveCompose: (payload: {
    imageCompose: ImageComposeState
    dataUrl?: string
  }) => void | Promise<void>
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

export const graphEditorDialogsKey: InjectionKey<GraphEditorDialogsApi> =
  Symbol('graphEditorDialogs')
