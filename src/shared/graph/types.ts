import type { TaggedAssetRef } from '../assetRef'
import type {
  AssetType,
  DirectorCameraShot,
  DirectorCameraVideo,
  DirectorViewerState,
  ProjectStyleImage,
  ShotStoryboard
} from '../domain'
import type { MultiAngleCameraState } from './multiAngleCamera'
import type { LightingSetupState } from './lightingSetup'
import type { PortraitTextureState } from './portraitTexture'
import type { EmotionPadState } from './emotionPad'
import type { ImageUpscaleState } from './imageUpscale'
import type { ImageExpandState } from './imageExpand'
import type { ImageRedrawState } from './imageRedraw'
import type { ImageEraseState } from './imageErase'
import type { ImageMatteState } from './imageMatte'
import type { ImageCropState } from './imageCrop'
import type { ImageGridSplitState } from './imageGridSplit'

/** 按输出类型的规范单例 id */
export const GRAPH_OUTPUT_NODE_IDS = {
  image: 'image-output',
  video: 'video-output',
  voice: 'voice-output',
  text: 'text-output',
  director: 'director-output',
  timeline: 'timeline-output',
  narrative: 'narrative-output',
  narrativeUnit: 'narrative-unit-output',
  world: 'world-output'
} as const

export type GraphOutputNodeIdKey = keyof typeof GRAPH_OUTPUT_NODE_IDS

/** 分镜资产图：分镜拆分节点 */
export const GRAPH_SCRIPT_SHOT_SPLIT_NODE_ID = 'script-shot-split'

/** 分镜资产图：分镜表格节点 */
export const GRAPH_SCRIPT_SHOT_TABLE_NODE_ID = 'script-shot-table'

/** 分镜资产图：生成分镜图入口节点 */
export const GRAPH_SCRIPT_SHOT_IMAGE_GEN_NODE_ID = 'script-shot-image-gen'

/** 分镜资产图：生成分镜视频入口节点 */
export const GRAPH_SCRIPT_SHOT_VIDEO_GEN_NODE_ID = 'script-shot-video-gen'

/** 分镜工作流：分镜参数节点（从 Inspector 组装提示词） */
export const GRAPH_SCRIPT_SHOT_PARAMS_NODE_ID = 'script-shot-params'

/** 叙事单元资产图：叙事拆解节点 */
export const GRAPH_NARRATIVE_SPLIT_NODE_ID = 'narrative-split'

/** 叙事单元资产图：叙事表格节点 */
export const GRAPH_NARRATIVE_TABLE_NODE_ID = 'narrative-table'

/** 叙事单元资产图：叙事编辑入口节点 */
export const GRAPH_NARRATIVE_GEN_NODE_ID = 'narrative-gen'

/** 世界元素资产图：世界元素提取节点 */
export const GRAPH_WORLD_EXTRACT_NODE_ID = 'world-extract'

/** 世界元素资产图：世界元素表格节点 */
export const GRAPH_WORLD_TABLE_NODE_ID = 'world-table'

/** 世界元素资产图：世界元素编辑入口节点 */
export const GRAPH_WORLD_GEN_NODE_ID = 'world-gen'

/** 世界元素资产图：世界元素输出节点 */
export const GRAPH_WORLD_OUTPUT_NODE_ID = GRAPH_OUTPUT_NODE_IDS.world

export type GraphNodeCategory = 'asset' | 'output' | 'note'
export type GraphOutputKind = 'video' | 'image' | 'voice' | 'text'

/** 普通输出 kind → 规范节点 id */
export function graphOutputNodeId(kind: GraphOutputKind): string {
  return GRAPH_OUTPUT_NODE_IDS[kind]
}

/**
 * 按 typeId（优先）或 outputKind 解析规范输出节点 id。
 * `output.director` / `output.timeline` 等使用专用 id。
 */
export function graphOutputNodeIdForType(
  typeId: string | undefined,
  kind: GraphOutputKind = 'video'
): string {
  if (typeId === 'output.director') return GRAPH_OUTPUT_NODE_IDS.director
  if (typeId === 'output.timeline') return GRAPH_OUTPUT_NODE_IDS.timeline
  if (typeId === 'output.narrative') return GRAPH_OUTPUT_NODE_IDS.narrative
  if (typeId === 'output.narrativeUnit') return GRAPH_OUTPUT_NODE_IDS.narrativeUnit
  if (typeId === 'output.world') return GRAPH_OUTPUT_NODE_IDS.world
  if (typeId?.startsWith('output.')) {
    const suffix = typeId.slice('output.'.length)
    if (
      suffix === 'image' ||
      suffix === 'video' ||
      suffix === 'voice' ||
      suffix === 'text'
    ) {
      return GRAPH_OUTPUT_NODE_IDS[suffix]
    }
  }
  return graphOutputNodeId(kind)
}

const CANONICAL_OUTPUT_NODE_IDS = new Set<string>(Object.values(GRAPH_OUTPUT_NODE_IDS))

/** 是否为规范输出单例 id（不含画布上额外添加的随机 id） */
export function isCanonicalGraphOutputNodeId(id: string): boolean {
  return CANONICAL_OUTPUT_NODE_IDS.has(id)
}
export type GraphPortDirection = 'in' | 'out'

/**
 * 端口基本数据类型（单一来源）。
 * 连线规则：同类型可连，异类型不可连（复数≠单数）。
 * 图库「全部」口与 select 输入使用 images/videos/voices/texts；
 * 默认 `out` 与消费方使用单数类型。
 * world / worldEntities / shotEntities / videoEntities / narrative / narrativeEntity / shots 为目录 JSON 专用口，不可与 text 互通。
 */
export const GraphPortType = {
  image: 'image',
  images: 'images',
  voice: 'voice',
  voices: 'voices',
  video: 'video',
  videos: 'videos',
  text: 'text',
  texts: 'texts',
  world: 'world',
  /** 世界元素生成结果实体表（type/name/imageUrl），与目录口 world 区分 */
  worldEntities: 'worldEntities',
  /** 分镜图生成结果实体表（id/name/imageUrls），与目录口 shots 区分 */
  shotEntities: 'shotEntities',
  /** 分镜视频生成结果实体表（id/name/videoUrls），与单视频口 video 区分 */
  videoEntities: 'videoEntities',
  narrative: 'narrative',
  /** 单个叙事单元实体（一行 JSON），与目录口 narrative 区分 */
  narrativeEntity: 'narrativeEntity',
  shots: 'shots',
  model: 'model'
} as const

/** 目录 JSON 端口 / 运行时 kind（与 GraphPortType 同名） */
export type GraphCatalogKind =
  | typeof GraphPortType.world
  | typeof GraphPortType.worldEntities
  | typeof GraphPortType.shotEntities
  | typeof GraphPortType.videoEntities
  | typeof GraphPortType.narrative
  | typeof GraphPortType.narrativeEntity
  | typeof GraphPortType.shots

export const GRAPH_CATALOG_KINDS: readonly GraphCatalogKind[] = [
  GraphPortType.world,
  GraphPortType.worldEntities,
  GraphPortType.shotEntities,
  GraphPortType.videoEntities,
  GraphPortType.narrative,
  GraphPortType.narrativeEntity,
  GraphPortType.shots
]

export function isGraphCatalogKind(value: unknown): value is GraphCatalogKind {
  return (
    typeof value === 'string' &&
    (GRAPH_CATALOG_KINDS as readonly string[]).includes(value)
  )
}

export type GraphPortDataType = (typeof GraphPortType)[keyof typeof GraphPortType]

export const GRAPH_PORT_DATA_TYPES = Object.values(GraphPortType) as GraphPortDataType[]

export function isGraphPortDataType(value: unknown): value is GraphPortDataType {
  return typeof value === 'string' && (GRAPH_PORT_DATA_TYPES as readonly string[]).includes(value)
}

const PLURAL_GRAPH_PORT_DATA_TYPES = new Set<GraphPortDataType>([
  GraphPortType.images,
  GraphPortType.videos,
  GraphPortType.voices,
  GraphPortType.texts
])

export function isPluralGraphPortDataType(dataType: GraphPortDataType): boolean {
  return PLURAL_GRAPH_PORT_DATA_TYPES.has(dataType)
}

/** 单数 → 复数；已是复数或 model 则原样返回 */
export function toPluralGraphPortDataType(dataType: GraphPortDataType): GraphPortDataType {
  switch (dataType) {
    case GraphPortType.image:
      return GraphPortType.images
    case GraphPortType.video:
      return GraphPortType.videos
    case GraphPortType.voice:
      return GraphPortType.voices
    case GraphPortType.text:
      return GraphPortType.texts
    default:
      return dataType
  }
}

/** 复数 → 单数；已是单数或 model 则原样返回 */
export function toSingularGraphPortDataType(dataType: GraphPortDataType): GraphPortDataType {
  switch (dataType) {
    case GraphPortType.images:
      return GraphPortType.image
    case GraphPortType.videos:
      return GraphPortType.video
    case GraphPortType.voices:
      return GraphPortType.voice
    case GraphPortType.texts:
      return GraphPortType.text
    default:
      return dataType
  }
}

export type GraphNodeTypeId =
  | `asset.${AssetType}`
  | `output.${GraphOutputKind}`
  | 'output.director'
  | 'output.timeline'
  | 'output.narrative'
  | 'output.narrativeUnit'
  | 'output.world'
  | 'note.text'
  | 'play.script'
  | 'prompt.optimize'
  | 'image.select'
  | 'video.select'
  | 'voice.select'
  | 'text.select'
  | 'narrative.select'
  | 'shotEntities.select'
  | 'narrative.split'
  | 'narrative.table'
  | 'narrative.gen'
  | 'narrative.unitGen'
  | 'narrative.unitRef'
  | 'image.multiAngle'
  | 'image.lighting'
  | 'image.portraitTexture'
  | 'image.emotion'
  | 'image.upscale'
  | 'video.lipSync'
  | 'image.expand'
  | 'image.redraw'
  | 'image.erase'
  | 'image.matte'
  | 'image.crop'
  | 'image.gridSplit'
  | 'image.toPrompt'
  | 'graph.input.slot'
  | (string & {})

export type GraphInspectorKind = 'asset' | 'output' | 'note' | 'camera' | 'none'
export type GraphCardKind = 'media' | 'note'

export interface GraphNodeParams {
  weight?: number
  label?: string
  notes?: string
  text?: string
  /** 加工节点生成指令（剧本/图片/视频/声音/全景等） */
  generateInstruction?: string
  /** 加工节点系统提示词（可编辑；空则用该类型内置默认） */
  generateSystemPrompt?: string
  /** 加工节点模型 id（剧本=文本，图片/全景=图片，视频=视频，声音=音频） */
  generateModel?: string
  /** 加工节点提供商实例 id */
  generateProviderInstanceId?: string
  /** 图片/全景生成：宽高比（如 16:9） */
  generateAspectRatio?: string
  /** 图片/全景生成：清晰度档位（如 1K / 2K / 4K） */
  generateResolution?: string
  /** 图片/全景生成：画质（low / medium / high / auto） */
  generateQuality?: string
  /** 图片/全景生成：张数 n */
  generateCount?: number
  /** 视频生成：输出时长（秒） */
  generateDuration?: number
  /** 视频生成：是否生成音频（模型支持时） */
  generateAudio?: boolean
  /** 视频生成：帧模式 none | first | first_last */
  generateFrameMode?: 'none' | 'first' | 'first_last'
  /**
   * 图片/视频/剧本/声音生成落盘目录（相对工程根）。
   * 空则默认：宿主资产目录下的 {资产名}/Images、Videos、Texts 或 Audio。
   */
  mediaOutputDir?: string
  /**
   * 图片/视频生成：是否使用工程全局风格（默认 true）。
   * true：只读展示全局风格；false：使用并编辑节点本地 styleImages。
   */
  styleImagesUseGlobal?: boolean
  /** 图片/视频生成：节点本地画面风格参考图（styleImagesUseGlobal === false 时生效） */
  styleImages?: ProjectStyleImage[]
  /** 声音 TTS：供应商声音 ID（对应 API 字段 voice） */
  generateSpeechVoice?: string
  /** 「生成剧本」等输出节点：最近一次执行汇总的结果文本 */
  resultText?: string
  outputKind?: GraphOutputKind
  durationSec?: number
  playbackRate?: number
  volume?: number
  muted?: boolean
  loop?: boolean
  /** 输出节点输入端口类型覆盖（如画布分镜输出仅接受剧本） */
  inputDataType?: GraphPortDataType
  /** 拖入画布的资产引用节点：仅输出端口，在资产编辑器内修改 */
  assetRef?: boolean
  /**
   * 可编辑宿主拖入画布时为 true：保留类型定义上的加工输入口。
   * 导入引用与资产自身 workflow 内的媒体自绑引用不置此标记。
   */
  assetHost?: boolean
  /**
   * 宿主编辑器内「输入接口」槽位：绑定外层宿主入端口 + 稳定下标。
   */
  hostInputSlot?: {
    portId: string
    index: number
    dataType: GraphPortDataType
  }
  /**
   * 宿主实例端口快照（定义修改后由 renderer 同步）。
   * shared 层无法查项目资产，故实例必须自带 snapshot 供 getNodePorts 使用。
   */
  hostInterfaceSnapshot?: {
    version: number
    inputs: Array<{
      id: string
      label: string
      dataType: GraphPortDataType
      multiple?: boolean
    }>
    outputs: Array<{
      id: string
      label: string
      dataType: GraphPortDataType
      multiple?: boolean
    }>
  }
  /** 当前实例已同步的定义接口代数 */
  hostSchemaVersion?: number
  /**
   * boundary proxy：绑定宿主接口上的端口 id。
   */
  hostBoundaryPort?: {
    portId: string
    dataType: GraphPortDataType
    multiple?: boolean
  }
  /** 导演台 3D 相机节点参数 */
  viewer?: DirectorViewerState
  /** 导演台关闭时回传的站位截图 */
  cameraShots?: DirectorCameraShot[]
  /** 导演台关闭时回传的动作录制视频 */
  cameraVideos?: DirectorCameraVideo[]
  /**
   * 图片生成节点：历次生成累计的图片（重新执行追加，可在 Inspector 删除）。
   * 大图应物化为 relativePath，dataUrl 可为空。
   */
  generatedImages?: Array<{
    id?: string
    dataUrl: string
    createdAt?: string
    relativePath?: string
  }>
  /**
   * 世界元素生成节点：从子窗口已完成输出节点收集的实体结果
   *（type / name / imageUrl）。
   */
  worldElementOutputs?: Array<{
    type: string
    name: string
    imageUrl: string
  }>
  /** 分镜图生成：实体表 { id, name, imageUrls } */
  shotEntities?: Array<{
    id: string
    name: string
    imageUrls: string[]
  }>
  /** 分镜视频生成 / 分镜输出 / 成片时间线：实体表 { id, name, videoUrls } */
  videoEntities?: Array<{
    id: string
    name: string
    videoUrls: string[]
  }>
  /**
   * 视频生成 / 对口型节点：历次生成累计的视频（重新执行追加，可在 Inspector 删除）。
   * 对齐图片：有 relativePath 时 dataUrl 可为空。
   */
  generatedVideos?: Array<{
    id?: string
    dataUrl?: string
    createdAt?: string
    relativePath?: string
  }>
  /**
   * 剧本生成节点：历次生成累计的文本（重新执行追加，可在 Inspector 删除）。
   * 对齐图片：有 relativePath 时 text 可为空，预览时按路径读文件。
   */
  generatedTexts?: Array<{
    id?: string
    title?: string
    text: string
    createdAt?: string
    relativePath?: string
  }>
  /**
   * 声音生成节点：历次生成累计的音频（重新执行追加，可在 Inspector 删除）。
   * id 通常为资产 id；有 relativePath 时预览走相对路径。
   */
  generatedVoices?: Array<{
    id?: string
    createdAt?: string
    relativePath?: string
  }>
  /** 节点预览图（通常取 cameraShots[0].dataUrl） */
  previewDataUrl?: string
  /** 预览图物化后的工程相对路径（与 previewDataUrl 二选一） */
  previewRelativePath?: string
  /** 节点卡片收起预览区（仅保留标题栏） */
  previewCollapsed?: boolean
  /**
   * 节点锁定（输入/输出除外）：开启后跳过执行，直接复用图库/上次 runStates 输出。
   * 无可用缓存时运行报错，不静默成功。
   */
  locked?: boolean
  /**
   * 当前选中的图片 id：生成节点 `out` 默认输出口 / 选取图片节点共用。
   * 生成节点每次运行成功后强制切到最新一条。
   */
  selectedImageId?: string
  /** @deprecated 已改用 shotEntities.select */
  shotEntityPicker?: boolean
  /** 选择分镜实体节点：当前选中的 ShotEntityResult.id */
  selectedShotEntityId?: string
  /**
   * 当前选中的视频 id：生成节点 `out` / 选取视频节点共用。
   * 生成节点每次运行成功后强制切到最新一条。
   */
  selectedVideoId?: string
  /**
   * 当前选中的文本 id：生成节点 `out` / 选取剧本节点共用。
   * 生成节点每次运行成功后强制切到最新一条。
   */
  selectedTextId?: string
  /** 选择叙事单元节点：当前选中的 NarrativeUnitRow.id */
  selectedUnitId?: string
  /**
   * 当前选中的声音 id：生成节点 `out` 默认输出口。
   * 每次运行成功后强制切到最新一条。
   */
  selectedVoiceId?: string
  /** 多角度编辑器：机位参数 */
  multiAngleCamera?: Partial<MultiAngleCameraState>
  /** 多角度编辑器：最终提示词（机位句；promptEnabled 时含面板拼接） */
  multiAnglePrompt?: string
  /** 打光效果：灯光参数 */
  lightingSetup?: Partial<LightingSetupState>
  /** 打光效果：最终提示词 */
  lightingPrompt?: string
  /** 人像质感调节：五维选项 */
  portraitTexture?: Partial<PortraitTextureState>
  /** 人像质感调节：最终提示词 */
  portraitTexturePrompt?: string
  /** 情绪调节：坐标盘 */
  emotionPad?: Partial<EmotionPadState>
  /** 情绪调节：定位短名 */
  emotionLabel?: string
  /** 情绪调节：最终提示词 */
  emotionPrompt?: string
  /** 高清放大参数 */
  imageUpscale?: Partial<ImageUpscaleState>
  /** 扩图参数 */
  imageExpand?: Partial<ImageExpandState>
  /** 重绘（inpaint）参数 */
  imageRedraw?: Partial<ImageRedrawState>
  /** 擦除（object removal）参数 */
  imageErase?: Partial<ImageEraseState>
  /** 抠图（matting）参数 */
  imageMatte?: Partial<ImageMatteState>
  /** 裁剪参数 */
  imageCrop?: Partial<ImageCropState>
  /** 宫格切分 / 局部放大 */
  imageGridSplit?: Partial<ImageGridSplitState>
  /** 分镜参数节点：与 Shot Inspector 同构的分镜字段 */
  shotStoryboard?: ShotStoryboard
  /** 分镜参数节点绑定的 Shot.id；拖入分镜栏时写入 */
  boundShotId?: string
  /** 叙事单元参考节点绑定的 NarrativeUnitRow.id；拖入单元栏时写入 */
  boundUnitId?: string
  /** 世界元素托管节点 id（四类画布同步用，勿与用户手搓节点冲突） */
  worldElementId?: string
  /** 世界元素目录审核状态（未审核 | 已审核） */
  reviewStatus?: string
}

export interface GraphPortDef {
  id: string
  direction: GraphPortDirection
  dataType: GraphPortDataType
  /** 是否允许多条边连到同一端口 */
  multiple?: boolean
  label?: string
}

export interface GraphGroup {
  id: string
  title?: string
}

export interface GraphNode {
  id: string
  /** 注册表类型 id；缺失时由 normalize 推断补齐 */
  typeId?: GraphNodeTypeId
  category: GraphNodeCategory
  /**
   * 工程资产 GUID（内存主字段）。
   * 落盘时可同时写 `assetRef`（TaggedAssetRef）；hydrate 时二者会同步。
   */
  assetId?: string
  /** 统一 GUID 引用形态；与 assetId 指向同一资产 */
  assetRef?: TaggedAssetRef
  assetType?: AssetType
  position: { x: number; y: number }
  size?: { w: number; h: number }
  params: GraphNodeParams
  title?: string
  /** 所属分组 id */
  groupId?: string
}

export interface GraphEdge {
  id: string
  source: string
  target: string
  /** 默认 out / in */
  sourcePort?: string
  targetPort?: string
}

export interface GraphViewport {
  x: number
  y: number
  zoom: number
}

export interface GraphDocument {
  nodes: GraphNode[]
  edges: GraphEdge[]
  groups?: GraphGroup[]
  viewport: GraphViewport
  /**
   * 节点执行状态（随图持久化：status/error + 已物化的 outputs）
   * 关闭编辑器后再次打开可恢复预览与增量重跑。
   */
  runStates?: Record<string, GraphPersistedRunState>
}

/** 可落盘的执行状态（outputs 中大图应为 relativePath，而非 dataUrl） */
export interface GraphPersistedRunState {
  status: 'idle' | 'pending' | 'running' | 'done' | 'error' | 'skipped'
  error?: string
  outputs?: Record<string, import('./execute/types').GraphValue>
}

export type { GraphValue } from './execute/types'

export interface NormalizeGraphOptions {
  /** 空图时是否确保有输出节点，默认 true */
  ensureOutput?: boolean
  outputKind?: GraphOutputKind
  outputTitle?: string
  outputNodeId?: string
}
