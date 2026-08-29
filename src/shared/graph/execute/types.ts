import type {
  AssetType,
  DirectorViewerState,
  ProjectStyleImage
} from '../../domain'
import type { InstructionMentionSource } from '../instructionMentions'
import type { WorldElementGenResult } from '../worldElementParse'
import type { ImageGenerateParamCapabilities } from '../imageGenerateParams'
import type { VideoGenerateParamCapabilities } from '../videoGenerateParams'
import type { VideoGeneratePortLimits } from '../portInputLimits'
import type {
  GraphCatalogKind,
  GraphDocument,
  GraphNode,
  GraphNodeParams,
  GraphOutputKind
} from '../types'
import type { GraphImageReferenceMeta } from '../../modelProvider'

export type GraphNodeRunStatus =
  | 'idle'
  | 'pending'
  | 'running'
  | 'done'
  | 'error'
  | 'degraded'
  | 'skipped'

export interface GraphAssetValue {
  kind: 'asset'
  assetId: string
  assetType: AssetType
  /** 生成落盘后的工程相对路径；供输出节点写回预览，无需再查资产表 */
  relativePath?: string
  label?: string
  weight?: number
  volume?: number
  muted?: boolean
  notes?: string
  title?: string
}

export interface GraphTextValue {
  kind: 'text'
  text: string
  id?: string
  /** 物化后的工程相对路径（生成节点选中项可只有路径、无 inline 正文） */
  relativePath?: string
}

/** 世界目录 / 世界实体 / 场目录 JSON（端口 dataType 与 kind 同名） */
export interface GraphCatalogValue {
  kind: GraphCatalogKind
  text: string
  relativePath?: string
}

/**
 * 文本数组条目（剧本生成等）。
 * 对齐图片：有 `relativePath` 时边上以路径为主，`text` 可为空（预览/执行时再读文件）。
 */
export interface GraphTextItem {
  id?: string
  /** 展示名 / 落盘文件名（如场 title） */
  title?: string
  text: string
  createdAt?: string
  /** 物化后的工程相对路径（对齐图片 dataUrl→relativePath） */
  relativePath?: string
}

/** 剧本生成 → 剧本输出等文本数组 */
export interface GraphTextsValue {
  kind: 'texts'
  items: GraphTextItem[]
}

export interface GraphCameraValue {
  kind: 'camera'
  viewer?: DirectorViewerState
}

export interface GraphImageItem {
  id?: string
  /** 展示名（如世界元素实体名）；选取对话框优先显示 */
  title?: string
  dataUrl: string
  createdAt?: string
  /** 物化后的工程相对路径；有值时可清空 dataUrl 以减小落盘体积 */
  relativePath?: string
}

/** 站位截图等图片数组 */
export interface GraphImagesValue {
  kind: 'images'
  items: GraphImageItem[]
}

/** 视频数组条目 */
export interface GraphVideoItem {
  id?: string
  dataUrl?: string
  createdAt?: string
  /** 物化后的工程相对路径；有值时可清空 dataUrl 以减小落盘体积 */
  relativePath?: string
}

/** 视频数组 */
export interface GraphVideosValue {
  kind: 'videos'
  items: GraphVideoItem[]
}

/** 声音生成等音频数组条目（id 通常为资产 id） */
export interface GraphVoiceItem {
  id?: string
  createdAt?: string
  relativePath?: string
}

/** 声音生成 → 声音输出等音频数组 */
export interface GraphVoicesValue {
  kind: 'voices'
  items: GraphVoiceItem[]
}

/** 单条声音（生成节点 `out` 选中项） */
export interface GraphVoiceValue {
  kind: 'voice'
  id?: string
  createdAt?: string
  relativePath?: string
}

/** 单个视频（选取视频节点输出等） */
export interface GraphVideoValue {
  kind: 'video'
  id?: string
  dataUrl?: string
  createdAt?: string
  relativePath?: string
}

/** 单张图片（选取图片节点输出等） */
export interface GraphImageValue {
  kind: 'image'
  id?: string
  dataUrl: string
  createdAt?: string
  relativePath?: string
}

export interface GraphOutputValue {
  kind: 'output'
  outputKind: GraphOutputKind
  items: GraphAssetValue[]
  notes: GraphTextValue[]
  params: GraphNodeParams
  /** 导演台等：站位图图片数组 */
  images?: GraphImageItem[]
  /** 视频数组 */
  videos?: GraphVideoItem[]
  /** 剧本输出等：文本数组（与 images / videos 对称） */
  texts?: GraphTextItem[]
  /** 声音输出等：音频数组（与 images / videos / texts 对称） */
  voices?: GraphVoiceItem[]
}

export type GraphValue =
  | GraphAssetValue
  | GraphTextValue
  | GraphTextsValue
  | GraphCatalogValue
  | GraphOutputValue
  | GraphCameraValue
  | GraphImagesValue
  | GraphVideosValue
  | GraphVoicesValue
  | GraphVoiceValue
  | GraphImageValue
  | GraphVideoValue

export interface NodeExecuteContext {
  node: GraphNode
  /** portId → 该端口收到的上游值 */
  inputs: Record<string, GraphValue[]>
  /**
   * 与 UI `@n` 一致的入边引用源（含节点正文回退）。
   * 供 generateInstruction 展开；缺省时由 inputs 顺序推导。
   */
  mentionSources?: InstructionMentionSource[]
  /**
   * 与 `@n` / mentionSources 同序的入边端口值（无输出时 value 缺省）。
   * 用于「无 @ 全量引入 / 有 @ 仅引用」筛选。
   */
  incomingByIndex?: Array<{ index: number; value?: GraphValue }>
  /** 可选：执行中写回图上的节点参数（供 UI 持久化） */
  patchNode?: (patch: { params?: Partial<GraphNodeParams>; title?: string }) => void
  /**
   * 将生成图片写入工程目录，返回相对路径。
   * 注入后生成结果只保留 relativePath，避免 dataUrl 写入资产 JSON。
   */
  saveRunMedia?: (input: {
    dataUrl: string
    key: string
    outputDir?: string
    node: GraphNode
  }) => Promise<string>
  /**
   * 将生成剧本文本写入工程目录，返回相对路径。
   * 注入后 generatedTexts / out.texts 可只保留 relativePath（清空 text）。
   */
  saveRunText?: (input: {
    content: string
    key: string
    outputDir?: string
    node: GraphNode
  }) => Promise<string>
  /** 按工程相对路径读取落盘剧本文本（对齐 getAssetFileUrl + 读内容） */
  readRunText?: (relativePath: string) => Promise<string>
  /**
   * 剧集 Agent 流水线：读取该工作流作用域（宿主资产 id）的 agent-state.json 原文。
   * 未注入时闭环自动附加/落盘功能关闭，节点仍可正常运行。
   */
  readEpisodeAgentState?: (scopeKey: string) => Promise<string | null>
  /** 剧集 Agent 流水线：写入该工作流作用域的 agent-state.json 原文 */
  writeEpisodeAgentState?: (scopeKey: string, content: string) => Promise<void>
  /**
   * 能力缝·提供商：调用设置中的文本模型；未注入时剧本节点退回纯文本汇总。
   * 节点 execute 必须走这些适配器，禁止在 execute 内直连 HTTP。
   */
  generateText?: (input: {
    prompt: string
    system?: string
    model?: string
    providerInstanceId?: string
    /** 视觉多模态：data URL / http(s) */
    images?: string[]
  }) => Promise<{ text: string; model: string }>
  /** 可选：调用设置中的图片模型；未注入时图片生成退回上游透传。须走适配器，禁止直连 HTTP。 */
  generateImage?: (input: {
    prompt: string
    model?: string
    providerInstanceId?: string
    aspectRatio?: string
    resolution?: string
    quality?: string
    n?: number
    seed?: number
    inputReferences?: string[]
    /** 与 inputReferences 一一对应的参考图元信息（仅用于执行日志） */
    inputReferenceMeta?: GraphImageReferenceMeta[]
    layerDecomposition?: boolean
  }) => Promise<{
    images: string[]
    model: string
    layers?: import('../../modelProvider').GenerateImageLayer[]
  }>
  /**
   * 可选：调用设置中的视频模型（提交+轮询+落盘资产）。
   * 未注入时视频生成退回上游透传。
   */
  generateVideo?: (input: {
    prompt: string
    model?: string
    providerInstanceId?: string
    duration?: number
    resolution?: string
    aspectRatio?: string
    seed?: number
    generateAudio?: boolean
    firstFrameImageUrl?: string
    lastFrameImageUrl?: string
    inputReferences?: Array<
      | string
      | { kind: 'image_url' | 'video_url' | 'audio_url'; url: string }
    >
    /** 视频副本输出目录（相对工程根） */
    outputDir?: string
    /** 落盘文件名 stem */
    name?: string
    /** 图节点回写绑定 */
    graphBinding?: { hostId?: string; nodeId?: string; assetId?: string; shotId?: string; canvasField?: string }
  }) => Promise<{ assetId: string; relativePath: string; model: string }>
  /**
   * 可选：调用设置中的 3D 模型生成；未注入时退回上游透传。
   */
  generateModel3d?: (input: {
    prompt: string
    model?: string
    providerInstanceId?: string
    /** 风格（Lux3D 文生3D） */
    style?: string
    inputReferences?: Array<{ kind: 'image_url' | 'video_url' | 'audio_url'; url: string }>
    outputDir?: string
    name?: string
    /** 图节点回写绑定 */
    graphBinding?: { hostId?: string; nodeId?: string; assetId?: string; shotId?: string; canvasField?: string }
  }) => Promise<{ assetId: string; relativePath: string; model: string }>
  /**
   * 可选：调用设置中的语音合成；未注入时声音节点退回上游透传 / 文本。
   */
  generateSpeech?: (input: {
    input: string
    model?: string
    providerInstanceId?: string
    /** TTS 供应商声音 ID（API 字段名 voice）/ 方舟 speaker_id */
    voice?: string
    name?: string
    /** 声音设计参考图（data URL 或 http(s)） */
    images?: string[]
    /** 音频副本输出目录（相对工程根） */
    outputDir?: string
  }) => Promise<{
    assetId?: string
    relativePath?: string
    model: string
    voice: string
  }>
  /** 软件界面语言，用于默认系统提示词等 */
  locale?: string
  /** 工作流中止信号；长时间操作应监听并尽快退出 */
  signal?: AbortSignal
  /** 按资产 id 读取 genParams（导演台引用节点取站位图等） */
  resolveAssetGenParams?: (assetId: string) => Record<string, unknown> | undefined
  /** 打开中的资产内图（优先于落盘 graphJson，供 soft dig） */
  resolveLiveAssetGraph?: (assetId: string) => import('../types').GraphDocument | undefined
  /** 资产是否仍存在于工程（引用节点执行前校验） */
  hasAsset?: (assetId: string) => boolean
  /** 按资产 id 解析展示名（剧本生成落盘文件名等） */
  resolveAssetName?: (assetId: string) => string | undefined
  /** 当前图宿主资产名（剧本资产图内生成时优先用作文件名前缀） */
  resolveHostAssetName?: () => string | undefined
  /** 当前图宿主资产 id（用于生成任务回写绑定） */
  resolveHostAssetId?: () => string | undefined
  /**
   * 按资产 id 异步解析剧本文本（文件 URL / 旁挂正文）。
   * 注入后剧本引用节点优先走此路径，与图片 resolveAssetImageUrl 对称。
   */
  resolveAssetText?: (assetId: string) => Promise<string | undefined>
  /** 将图输出 / 相对路径解析为可供 API 使用的 data URL 或 http(s) */
  resolveImageUrls?: (
    items: Array<{ dataUrl?: string; relativePath?: string }>
  ) => Promise<string[]>
  /** 将图执行输出的视频解析为「首帧」图片 data URL（供视觉质检/文本模型看图） */
  resolveVideoFirstFrameImageUrls?: (
    items: Array<{ dataUrl?: string; relativePath?: string }>
  ) => Promise<string[]>
  /**
   * 将节点风格参考图解析为可供 API 使用的 data URL / http(s)。
   * 未注入时仅使用条目内已有的 dataUrl。
   */
  resolveStyleImageUrls?: (images: ProjectStyleImage[]) => Promise<string[]>
  /** 读取工程全局画面风格（供生成节点「使用全局风格」） */
  resolveProjectStyleImages?: () => ProjectStyleImage[]
  /** 读取工程全局随机种子（供生成节点「使用全局种子」） */
  resolveProjectGenerateSeed?: () => number | undefined
  /**
   * 为风格条目回填风格库详细提示词（按 libraryId）。
   * 未注入时仅使用条目内已有的 prompt 字段。
   */
  enrichStyleImages?: (images: ProjectStyleImage[]) => ProjectStyleImage[]
  /**
   * 按当前节点选中的图片模型解析能力（参考图上限等）。
   * 未注入时执行侧使用默认上限。
   */
  resolveImageGenerateCapabilities?: (input: {
    model?: string
    providerInstanceId?: string
  }) => Promise<ImageGenerateParamCapabilities | undefined>
  /**
   * 按当前节点选中的视频模型解析能力（时长/比例 + 参考口限额）。
   */
  resolveVideoGenerateCapabilities?: (input: {
    model?: string
    providerInstanceId?: string
  }) => Promise<
    | {
        params: VideoGenerateParamCapabilities
        portLimits: VideoGeneratePortLimits
      }
    | undefined
  >
  /** 按资产 id 解析图片 data URL（引用节点） */
  resolveAssetImageUrl?: (assetId: string) => Promise<string | undefined>
  /** 按资产 id 解析任意媒体 data URL（视频参考等） */
  resolveAssetMediaUrl?: (assetId: string) => Promise<string | undefined>
  /**
   * 扩图：将原图按锚点合成到扩展画布（透明底），返回 PNG data URL。
   * 未注入时退回直接用原图作参考。
   */
  composeImageExpandCanvas?: (input: {
    sourceDataUrl: string
    state: import('../imageExpand').ImageExpandState
  }) => Promise<{ dataUrl: string; aspectRatio?: string; width: number; height: number }>
  /**
   * 重绘/擦除/抠图：按蒙版挖空合成参考图（可选附带黑白 mask）。
   * punch=white 挖白区（重绘/擦除）；punch=black 挖黑区保留白区（抠图）。
   */
  composeImageRedrawCanvas?: (input: {
    sourceDataUrl: string
    state:
      | import('../imageRedraw').ImageRedrawState
      | import('../imageErase').ImageEraseState
      | import('../imageMatte').ImageMatteState
    punch?: 'white' | 'black'
  }) => Promise<{
    dataUrl: string
    maskDataUrl?: string
    aspectRatio?: string
    width: number
    height: number
  }>
  /** 裁剪：按归一化框裁出 PNG。 */
  composeImageCropCanvas?: (input: {
    sourceDataUrl: string
    state: import('../imageCrop').ImageCropState
  }) => Promise<{ dataUrl: string; width: number; height: number }>
  /** 宫格：裁出单个宫格 PNG。 */
  composeImageGridCell?: (input: {
    sourceDataUrl: string
    state: import('../imageGridSplit').ImageGridSplitState
    cellKey: string
    /** 向内收缩像素；`'auto'` 按格子尺寸估算，用于去掉序列图格线/黑边 */
    edgeInset?: number | 'auto'
  }) => Promise<{ dataUrl: string; width: number; height: number; cellKey: string }>
  /** 图层分离：按 z_index 与 bounding box 把底图+透明层合成一张 PNG。 */
  composeImageLayerStack?: (input: {
    state: import('../imageLayerSplit').ImageLayerSplitState
    layerUrls: Record<string, string>
  }) => Promise<{ dataUrl: string; width: number; height: number }>
  /** 漫画页：分镜格 + 气泡合成一张 PNG（浏览器 canvas）。 */
  composeComicPageImage?: (input: {
    page: import('../comicPage').ComicPage
    resolveImage?: (imageUrl: string) => Promise<string>
  }) => Promise<{ dataUrl: string; width: number; height: number }>
  /** 图片生成后按目标宽高比居中裁正（宫格画布保证每格比例） */
  normalizeImageAspectRatio?: (input: {
    dataUrl: string
    aspectRatio: string
  }) => Promise<string>
  /** 场参考节点：按 boundBeatId 解析目录行 */
  resolveBeatUnit?: (beatId: string) => import('../beatParse').BeatRow | null
  /**
   * 世界元素编辑：收集四类 elementWorkflow 已完成输出；`cookBatch` 为 true 时先入队批跑。
   */
  collectWorldElementOutputs?: (
    signal?: AbortSignal,
    options?: { cookBatch?: boolean; nodeId?: string }
  ) => Promise<{
    items: Array<{ type: string; name: string; imageUrl: string }>
  } | null>
  /**
   * 场生成：收集各单元 beatUnit 子图「场输出」已有文本（不级联跑子图生成）。
   */
  collectBeatUnitTexts?: (signal?: AbortSignal) => Promise<{
    items: GraphTextItem[]
  } | null>
  /**
   * 世界元素表格节点：把当前目录序列化为提取 JSON。
   */
  resolveWorldCatalogJson?: () => string | null
  /**
   * 世界元素表格 / 编辑节点执行时：把上游提取 JSON 同步到元素子图。
   */
  /**
   * 世界元素目录导入：sourceNodeId 为执行节点 id。
   * world.gen → 导入到该节点独立子图；world.extract/table → 导入到其下游 world.gen 节点。
   */
  importWorldCatalogJson?: (
    jsonText: string,
    sourceNodeId?: string
  ) => void | Promise<void>
  /**
   * 场表格节点：把当前目录序列化为拆解 JSON。
   */
  resolveBeatCatalogJson?: () => string | null
  /**
   * 场表格 / 编辑节点执行时：把上游拆解 JSON 写入资产 genParams。
   */
  importBeatCatalogJson?: (jsonText: string) => void | Promise<void>
  /**
   * 宿主有入边时：把已注入输入的内图整链交给任务列表执行。
   */
  runHostInnerGraph?: (input: HostInnerGraphRunInput) => Promise<HostInnerGraphRunResult>
  /** 当前宿主 cook 栈（assetId），防递归 */
  cookAssetIdStack?: string[]
  /**
   * 传给 runHostInnerGraph 的 skipCompletedNodes。
   * 未设置时由 runner 默认 true；Cook 子图路径会设为 false。
   */
  hostInnerSkipCompleted?: boolean
  /**
   * 批量子图编排节点（世界元素 / 场单元）是否入队 cook。
   * 与 cookHostInnerGraph 同默认：onlyTarget 时 false，其余 true。
   */
  cookBatchSubgraphs?: boolean
}

/** 宿主内图已准备好的执行包（输入槽已注入） */
export interface HostInnerGraphRunInput {
  hostNode: GraphNode
  document: GraphDocument
  priorNodeStates: Record<string, GraphNodeRunState>
  signal?: AbortSignal
  /** 当前 cook 栈（含祖先宿主 assetId），用于防递归 */
  cookAssetIdStack?: string[]
  /**
   * 内图是否跳过已成功节点。默认 true。
   * 圆形菜单「Cook 子图」应传 false，避免复用空/过期 done 导致出口为空。
   */
  skipCompletedNodes?: boolean
}

export interface HostInnerGraphRunResult {
  ok: boolean
  states: Record<string, GraphNodeRunState>
  /** 已按资产类型映射的宿主输出口 */
  outputs?: Record<string, GraphValue>
  error?: string
}

/** 返回 portId → 输出值 */
export type NodeExecuteFn = (
  ctx: NodeExecuteContext
) => Record<string, GraphValue> | Promise<Record<string, GraphValue>>

export interface GraphNodeRunState {
  status: GraphNodeRunStatus
  error?: string
  outputs?: Record<string, GraphValue>
  /** 开始执行时的输入端口值（供执行日志；落盘前应剥离） */
  inputs?: Record<string, GraphValue[]>
}

export interface GraphRunOptions {
  /** 默认跑到输出节点；可指定任意汇点 */
  targetNodeId?: string
  /** 多汇点：子集为各目标上游并集（优先于 targetNodeId） */
  targetNodeIds?: string[]
  /**
   * 为 true 时只执行 targetNodeId 自身，不重跑上游；
   * 上游输出优先用 priorNodeStates，否则做无副作用快照。
   */
  onlyTargetNode?: boolean
  /** 仅执行单节点时，用于灌入上游端口输出 */
  priorNodeStates?: Record<string, GraphNodeRunState>
  signal?: AbortSignal
  /** 每个节点执行前停顿，便于 UI 刷新与中途停止（毫秒，默认 80） */
  stepDelayMs?: number
  /**
   * 为 true 时不对子集外节点发布 skipped，避免节点级重跑抹掉其它节点状态。
   * 整图运行保持默认 false。
   */
  preserveOutsideSubset?: boolean
  /**
   * 为 true 时跳过子集内已成功（done）的上游节点，复用 priorNodeStates / 软快照输出；
   * 目标节点始终执行。
   */
  skipCompletedNodes?: boolean
  /**
   * 容错模式：节点执行失败时不整链中断，标记为 `degraded`（优先复用缓存/图库产物兜底），
   * 下游继续执行，整条长链「跑得完」。适用于 Agent 流水线等长链工作流；
   * 默认缺省保持严格模式（失败即中断并跳过下游）。
   */
  continueOnError?: boolean
  /**
   * 是否 cook 嵌套子图（宿主内图 + 世界元素/分镜图/分镜视频批量子图）。
   * 默认：`onlyTargetNode` 时为 false（复用缓存 / 只收集已有结果），
   * 其余运行为 true。圆形菜单「Cook 子图」显式传 true。
   */
  cookHostInnerGraph?: boolean
  /** 覆盖内图 skipCompletedNodes；未设时见 NodeExecuteContext.hostInnerSkipCompleted */
  hostInnerSkipCompleted?: boolean
  onNodeUpdate?: (nodeId: string, state: GraphNodeRunState) => void
  /** 将参数写回宿主图文档（克隆图执行时需要） */
  onNodePatch?: (
    nodeId: string,
    patch: { params?: Partial<GraphNodeParams>; title?: string }
  ) => void
  saveRunMedia?: NodeExecuteContext['saveRunMedia']
  saveRunText?: NodeExecuteContext['saveRunText']
  readRunText?: NodeExecuteContext['readRunText']
  readEpisodeAgentState?: NodeExecuteContext['readEpisodeAgentState']
  writeEpisodeAgentState?: NodeExecuteContext['writeEpisodeAgentState']
  generateText?: NodeExecuteContext['generateText']
  generateImage?: NodeExecuteContext['generateImage']
  generateVideo?: NodeExecuteContext['generateVideo']
  generateModel3d?: NodeExecuteContext['generateModel3d']
  generateSpeech?: NodeExecuteContext['generateSpeech']
  /** 软件界面语言，用于默认系统提示词等 */
  locale?: string
  resolveAssetGenParams?: NodeExecuteContext['resolveAssetGenParams']
  resolveLiveAssetGraph?: NodeExecuteContext['resolveLiveAssetGraph']
  hasAsset?: NodeExecuteContext['hasAsset']
  resolveAssetName?: NodeExecuteContext['resolveAssetName']
  resolveHostAssetName?: NodeExecuteContext['resolveHostAssetName']
  resolveHostAssetId?: NodeExecuteContext['resolveHostAssetId']
  resolveAssetText?: NodeExecuteContext['resolveAssetText']
  resolveImageUrls?: NodeExecuteContext['resolveImageUrls']
  resolveVideoFirstFrameImageUrls?: NodeExecuteContext['resolveVideoFirstFrameImageUrls']
  resolveStyleImageUrls?: NodeExecuteContext['resolveStyleImageUrls']
  resolveProjectStyleImages?: NodeExecuteContext['resolveProjectStyleImages']
  resolveProjectGenerateSeed?: NodeExecuteContext['resolveProjectGenerateSeed']
  enrichStyleImages?: NodeExecuteContext['enrichStyleImages']
  resolveImageGenerateCapabilities?: NodeExecuteContext['resolveImageGenerateCapabilities']
  resolveVideoGenerateCapabilities?: NodeExecuteContext['resolveVideoGenerateCapabilities']
  resolveAssetImageUrl?: NodeExecuteContext['resolveAssetImageUrl']
  resolveAssetMediaUrl?: NodeExecuteContext['resolveAssetMediaUrl']
  composeImageExpandCanvas?: NodeExecuteContext['composeImageExpandCanvas']
  composeImageRedrawCanvas?: NodeExecuteContext['composeImageRedrawCanvas']
  composeImageCropCanvas?: NodeExecuteContext['composeImageCropCanvas']
  composeImageGridCell?: NodeExecuteContext['composeImageGridCell']
  composeImageLayerStack?: NodeExecuteContext['composeImageLayerStack']
  composeComicPageImage?: NodeExecuteContext['composeComicPageImage']
  normalizeImageAspectRatio?: NodeExecuteContext['normalizeImageAspectRatio']
  resolveBeatUnit?: NodeExecuteContext['resolveBeatUnit']
  collectWorldElementOutputs?: NodeExecuteContext['collectWorldElementOutputs']
  /** world.gen 四类图片组口：params 为空时从 element 子图 soft 收集（选取/快照用） */
  resolveWorldElementOutputs?: (node: GraphNode) => WorldElementGenResult[]
  collectBeatUnitTexts?: NodeExecuteContext['collectBeatUnitTexts']
  resolveWorldCatalogJson?: NodeExecuteContext['resolveWorldCatalogJson']
  importWorldCatalogJson?: NodeExecuteContext['importWorldCatalogJson']
  resolveBeatCatalogJson?: NodeExecuteContext['resolveBeatCatalogJson']
  importBeatCatalogJson?: NodeExecuteContext['importBeatCatalogJson']
  runHostInnerGraph?: NodeExecuteContext['runHostInnerGraph']
  cookAssetIdStack?: string[]
}

export interface GraphGenerationContribution {
  genRefs: Array<{
    role: string
    assetId: string
    refIndex: number
    label?: string
    weight?: number
  }>
  audioRefs: Array<{
    kind: string
    assetId?: string
    text?: string
    refIndex?: number
  }>
}

export interface GraphRunResult {
  ok: boolean
  order: string[]
  states: Record<string, GraphNodeRunState>
  output?: GraphOutputValue
  contribution?: GraphGenerationContribution
  error?: string
  /** 容错模式下降级继续的节点 id（ok 为 true 但存在未达标节点） */
  degradedNodeIds?: string[]
}
