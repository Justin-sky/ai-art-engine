import type { TaggedAssetRef } from '../assetRef'
import type {
  AssetType,
  DirectorCameraShot,
  DirectorCameraVideo,
  DirectorViewerState,
  ProjectStyleImage,
  StyleReferenceSubject,
  WorldEntityRef,
  StageVec3
} from '../domain'
import type { MultiAngleCameraState } from './multiAngleCamera'
import type { SpatialWorldExtra } from '../spatialWorldMeta'
import type { LightingSetupState } from './lightingSetup'
import type { PortraitTextureState } from './portraitTexture'
import type { PortraitAiLayer, PortraitRetouchState } from './portraitRetouch'
import type { PortraitFacesPayload } from './portraitFace'
import type {
  PortraitCubeLut,
  PortraitLiquifyStroke,
  PortraitSpotHealPoint
} from './portraitLiveMath'
import type { EmotionPadState } from './emotionPad'
import type { ImageUpscaleState } from './imageUpscale'
import type { ImageExpandState } from './imageExpand'
import type { ImageRedrawState } from './imageRedraw'
import type { ImageEraseState } from './imageErase'
import type { ImageMatteState } from './imageMatte'
import type { ImageCropState } from './imageCrop'
import type { ImageCutoutState } from './imageCutout'
import type { ImageComposeState } from './imageCompose'
import type { ImageGridSplitState } from './imageGridSplit'
import type { ImageLayerSplitState } from './imageLayerSplit'
import type { AdVariantMatrix } from './adVariantMatrix'

/** 按输出类型的规范单例 id */
export const GRAPH_OUTPUT_NODE_IDS = {
  image: 'image-output',
  video: 'video-output',
  voice: 'voice-output',
  text: 'text-output',
  director: 'director-output',
  timeline: 'timeline-output'
} as const

export type GraphOutputNodeIdKey = keyof typeof GRAPH_OUTPUT_NODE_IDS

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
  if (typeId?.startsWith('output.')) {
    const suffix = typeId.slice('output.'.length)
    if (suffix === 'image' || suffix === 'video' || suffix === 'voice' || suffix === 'text') {
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
 * world / worldEntities / beat 为目录 JSON 专用口，不可与 text 互通。
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
  /** SVG 矢量图：生成节点产出源码并落盘 .svg，动画/烘焙类节点消费 */
  svg: 'svg',
  svgs: 'svgs',
  world: 'world',
  /** 世界元素生成结果实体表（type/name/imageUrl），与目录口 world 区分 */
  worldEntities: 'worldEntities',
  beat: 'beat',
  model: 'model',
  /**
   * 空间世界（World Labs Marble）产物口：产物在磁盘上仍是一个 GLB 模型资产，
   * 但它**带 world_id、还可能是「世界」而非单个模型**（网格 + 高斯泼溅 + 全景），
   * 与空间世界导出（`worlds/{id}:export` 只认 world_id）在语义上是一对。
   *
   * 连接规则是**单向**的：`spatialWorld → model` 允许（世界产物就是网格，
   * 照旧能接 3D 加工节点与导演台模型口），反向不允许 —— 普通模型没有 world_id，
   * 接进空间世界导出只会得到一个说不清的失败。
   */
  spatialWorld: 'spatialWorld',
  /** 可玩 HTML 等：磁盘上的工程目录（相对工程根） */
  project: 'project',
  /**
   * 语义时间线文档（`SemanticTimeline`，schema `aiart.semantic-timeline@1`，id 形如 `stl.*`）。
   *
   * 语义分析那条管线（分析 / 时间线 / 触发 / 编译 / 修复 / 多版本）传递的是**这份文档**，
   * 而不是随便一段文本。以前它们共用 `text` 口，后果是：任何文本产地（提示词、剧本、OCR）
   * 都能接进语义口，且要等运行期解析才报「不是合法 JSON / 不是语义时间线文档」。
   *
   * 连接规则**单向放宽**：`semanticTimeline → text` 允许（展示、交给文本消费者、给 agent 读），
   * 反向不允许 —— 普通文本没有 schema，也没有 `stl.` id。手写 JSON 请走节点参数
   * `timelineJson`，或先过语义分析节点。
   */
  semanticTimeline: 'semanticTimeline',
  /**
   * 视频生成提示词计划（`VideoPromptPlan`，schema `aiart.video-prompts@1`）。
   *
   * 语义编译的产物、语义重建的输入 —— 每一镜一条提示词 + 该镜首帧（来自分析证据的关键帧），
   * 所以重建是**图生视频**而不是凭空文生视频。与 `semanticTimeline` 同一套路：
   * 单向放宽 `videoPrompts → text`（交给文本消费者/agent 读），反向不允许。
   */
  videoPrompts: 'videoPrompts',
  /**
   * 影视分镜文档（`FilmStoryboard`，schema `aiart.film-storyboard@1`）：
   * 剧本拆出的场 / 镜头 / 角色场景实体 / 审核结论 / 每镜产物，一整份结构化 JSON。
   * film.breakdown → film.review → film.cast / film.shot / film.render 之间传它。
   * 与语义时间线同一套路：单向放宽 `storyboard → text`（给 LLM 指令节点 / agent 读），反向不允许。
   */
  storyboard: 'storyboard',
  /**
   * 影视设定库（`FilmCast`，schema `aiart.film-cast@1`）：角色 / 场景 / 道具的设定图与描述。
   * film.cast 产出，film.shot / film.render 按镜头出场名单自动取参考图锁一致性。
   * 单向放宽 `filmCast → text`。
   */
  filmCast: 'filmCast'
} as const

/** 目录 JSON 端口 / 运行时 kind（与 GraphPortType 同名） */
export type GraphCatalogKind =
  typeof GraphPortType.world | typeof GraphPortType.worldEntities | typeof GraphPortType.beat

export const GRAPH_CATALOG_KINDS: readonly GraphCatalogKind[] = [
  GraphPortType.world,
  GraphPortType.worldEntities,
  GraphPortType.beat
]

export function isGraphCatalogKind(value: unknown): value is GraphCatalogKind {
  return typeof value === 'string' && (GRAPH_CATALOG_KINDS as readonly string[]).includes(value)
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
  GraphPortType.texts,
  GraphPortType.svgs
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
    case GraphPortType.svg:
      return GraphPortType.svgs
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
    case GraphPortType.svgs:
      return GraphPortType.svg
    default:
      return dataType
  }
}

export type GraphNodeTypeId =
  | `asset.${AssetType}`
  | `output.${GraphOutputKind}`
  | 'output.director'
  | 'output.timeline'
  | 'note.text'
  | 'media.bundle'
  | 'text.plain'
  | 'prompt.optimize'
  | 'image.select'
  | 'video.select'
  | 'voice.select'
  | 'text.select'
  | 'film.workbench'
  | 'film.breakdown'
  | 'film.review'
  | 'film.cast'
  | 'film.shot'
  | 'film.render'
  | 'image.multiAngle'
  | 'image.lighting'
  | 'image.portraitTexture'
  | 'image.portrait'
  | 'image.emotion'
  | 'image.process'
  | 'image.upscale'
  | 'video.lipSync'
  | 'video.framePull'
  | 'video.reshoot'
  | 'image.expand'
  | 'image.redraw'
  | 'image.erase'
  | 'image.matte'
  | 'image.crop'
  | 'image.transform'
  | 'image.gridSplit'
  | 'image.layerSplit'
  | 'image.toPrompt'
  | 'decisions.judge'
  | 'svg.gen'
  | 'model.pose'
  | 'model.rigSkin'
  | 'model.segment'
  | 'model.meshComplete'
  | 'model.retopology'
  | 'model.rigCheck'
  | 'model.retarget'
  | 'model.convert'
  | 'model.texture'
  | 'model.animation'
  | 'graph.input.slot'
  | (string & {})

export type GraphInspectorKind = 'asset' | 'output' | 'note' | 'camera' | 'none'
export type GraphCardKind = 'media' | 'note' | 'bundle'

export interface GraphNodeParams {
  weight?: number
  label?: string
  notes?: string
  text?: string
  /** 加工节点生成指令（剧本/图片/视频/声音/全景等） */
  generateInstruction?: string
  /** 加工节点系统提示词（可编辑；空则用该类型内置默认） */
  generateSystemPrompt?: string
  /**
   * 决策节点（decisions.judge）问题清单，每行一条：
   * `问题名 | noul|choice|score | 问题 | 判定说明`。
   * 解析规则见 @shared/decisionQuestion 的 parseDecisionQuestions。
   */
  decisionQuestions?: string
  /** 决策节点：noul 判「是」的概率阈值（缺省 0.5） */
  decisionNoulYesThreshold?: number
  /** 决策节点：choice 视为可信的最低置信度（低于该值时 confident=false） */
  decisionChoiceMinConfidence?: number
  /** 决策节点：score 视为达标的最低分位 */
  decisionScoreMin?: number
  /** 决策节点：上次执行的判定结论快照（卡片 / 检查器展示用） */
  decisionVerdicts?: import('../modelProvider').DecisionVerdict[]
  /** 决策节点：实际服务的模型（上游可能回带日期快照） */
  decisionModelUsed?: string
  /** 决策节点：上游 provider 名（如 TypeSafe） */
  decisionProvider?: string
  /** Semantic Timeline：源视频资产 id */
  sourceAssetId?: string
  /** Semantic Timeline：节拍词表 id */
  vocabulary?: string
  /** Semantic Timeline：分析用帧率 / 时长（无探测时的兜底） */
  semanticFps?: number
  semanticDuration?: number
  /** Semantic Timeline：镜头 / 话语 / 时间线 JSON 旁路入参 */
  shotsJson?: string
  utterancesJson?: string
  timelineJson?: string
  /** Semantic Timeline：源相对路径 */
  sourceRelativePath?: string
  /** Semantic Timeline：上次分析落盘的时间线 id（stl.…） */
  semanticTimelineId?: string
  /** Semantic Timeline：分析时调转写 / 人声分离 / 实体检测（默认 true） */
  semanticTranscribe?: boolean
  semanticSeparateAudio?: boolean
  semanticDetectEntities?: boolean
  /** Semantic Timeline：分析后跑 LLM 镜头描述 / 事件抽取 / 导演意图（默认 false） */
  semanticLlm?: boolean
  /** 语义重建：是否真正调模型出片（默认 true；false 只产出清单，可以先看再开） */
  semanticExecute?: boolean
  /** Semantic Timeline：只启用这些导演规则包（逗号分隔；空 = 内置 + 全部已装） */
  rulePackIds?: string
  /**
   * 语义编译：人工改过的提示词（按 shotId 覆盖）。
   * 紧凑格式 `{"shot.1":"提示词"}`，也接受 `[{shotId,prompt,negativePrompt?}]`。
   */
  promptOverridesJson?: string
  /**
   * 语义编译：上次编译产出的提示词计划（规范 JSON）。**节点参数随图落盘**，
   * 是运行态 outputs 之外的第二份缓存 —— 运行态丢了（旧存档 / 撤销 / 任务快照）时，
   * 下游「语义重建」仍能从这里把计划复原，无需重跑编译、更不用重跑分析。
   */
  planJson?: string
  /** 语义重建：生成粒度（`shots` 逐镜头，默认；`full` 整片一次） */
  rebuildMode?: string
  /** 语义重建：每镜生成时长（秒；空 = 跟随镜头时长） */
  rebuildDurationSec?: number
  /** 语义重建：分辨率 / 画幅（空 = 跟随源片设置与模型默认） */
  rebuildResolution?: string
  rebuildAspectRatio?: string
  /** 语义重建：逐镜头模式的上限（默认 12，防误点跑几十次生成） */
  rebuildMaxShots?: number
  /** 语义重建：保留原片音轨（默认 true） */
  rebuildKeepAudio?: boolean
  /** 语义重建：烧录转写字幕（默认 true） */
  rebuildBurnSubtitles?: boolean
  /**
   * 语义重建：全部镜头重新生成（默认 false）。
   * false = 只生成**改过**的镜头，未改镜头直通原片段（零修改即还原原片）。
   */
  rebuildRegenerateAll?: boolean
  /** 语义重建：改过的台词重新配音（默认 true） */
  rebuildDub?: boolean
  /** 语义重建：配音没有指定音色时，用原片分离出的人声做声音克隆参考（默认 true） */
  rebuildDubClone?: boolean
  /** 语义重建：实体局部替换时首帧重绘用的图片模型 / 实例（空 = 设置里的默认图片模型） */
  replaceImageModel?: string
  replaceImageProviderInstanceId?: string
  /** 语义重建：配音用的 TTS 模型 / 实例 / 音色（空 = 设置里的默认语音模型） */
  dubModel?: string
  dubProviderInstanceId?: string
  dubVoice?: string
  /** 语义重建：上次运行（或只出计划时）的清单 JSON —— 节点已无文本输出口，Inspector 读它 */
  rebuildLastReport?: string
  /** 语义重建：上次成片（工程相对路径），Inspector 预览用 */
  rebuildLastOutput?: string
  /** 加工节点模型 id（剧本=文本，图片/全景=图片，视频=视频，声音=音频） */
  generateModel?: string
  /** 加工节点提供商实例 id */
  generateProviderInstanceId?: string
  /**
   * 语义分析节点的**转写**覆盖（与上面的 `generateModel` 分开：转写是另一个端点/模型体系）。
   * 留空 = 首个支持转写的已配置实例；**填了就严格用它**，该实例不能转写时直接报错。
   */
  transcribeModel?: string
  transcribeProviderInstanceId?: string
  /**
   * UI 精准拆层（image.layerSplit / splitMode = precise|auto）的**多模态版面解析**模型覆盖。
   * 留空 = 自动挑选视觉定位最强的已启用文本模型（Gemini 优先，见 `pickVisionGroundingProvider`）。
   */
  visionModel?: string
  visionProviderInstanceId?: string
  /**
   * 加工节点备选模型链：首选模型调用失败（限流/不可用/超时）时依次自动切换。
   * 每项为 modelKey（providerInstanceId::model），按数组顺序尝试。
   */
  generateModelFallbacks?: string[]
  /** 图片/全景生成：宽高比（如 16:9） */
  generateAspectRatio?: string
  /** 图片/全景生成：清晰度档位（如 1K / 2K / 4K） */
  generateResolution?: string
  /** 图片/全景生成：画质（low / medium / high / auto） */
  generateQuality?: string
  /** 图片/全景生成：张数 n */
  generateCount?: number
  /** 图片生成：是否生成透明背景（自动附加纯色干净背景提示词并在出图后键控抠除背景，输出透明 PNG） */
  generateTransparentBg?: boolean
  /** 3D 模型生成：风格（Lux3D 文生3D photorealistic/cartoon/anime/hand_painted/cyberpunk/fantasy/glass） */
  generateStyle?: string
  /**
   * 空间世界生成（World Labs Marble）：随机种子 0–4294967295。
   * 0 / 未设置表示不传 seed，由上游随机；同种子同参数可复现同一世界。
   */
  spatialWorldSeed?: number
  /**
   * 空间世界生成：单图参考是否按等距柱状全景处理（官方 `is_pano`）。
   * auto（默认，自动识别 2:1 equirect）/ always 强制 / never 当普通图片。
   */
  spatialWorldPanoMode?: 'auto' | 'always' | 'never'
  /** 语义时间线重建：1-to-N 批量变体矩阵 JSON（SemanticBatchVariantSpec[]） */
  rebuildVariantsJson?: string
  /**
   * 空间世界生成：关闭上游 recaption（用指令原文，不再由上游补写画面描述）。
   * 缺省 false：上游会自行 recaption，同一份输入两次结果可能不同。
   */
  spatialWorldDisableRecaption?: boolean
  /** 空间世界生成：指定模型 ID（与 generateModel 同步兼容） */
  spatialWorldModel?: string
  /**
   * 空间世界生成：随世界一起落盘的附加产物（高斯泼溅 SPZ / 360 全景图），
   * 相对路径与主产物同目录同名，仅后缀不同（`splats` → `.spz`、`pano` → `.pano.png`）。
   *
   * 形状见 `@shared/spatialWorldMeta`（与资产 `genParams` 共用同一组键名）——
   * 这里不再单独声明一份，否则又是两处口径。
   */
  spatialWorldExtras?: SpatialWorldExtra[]
  /** 空间世界生成：World Labs 的 `World.id`（导出端点只认它；与资产 `genParams` 同名） */
  spatialWorldId?: string
  /** 空间世界导出：导出哪一族（mesh 高质量网格 GLB / splats PLY 泼溅） */
  spatialWorldExportMode?: 'mesh' | 'splats'
  /** 空间世界导出（mesh）：网格变体，textured 约 600k 面带贴图 / vertex_colored 约 1M 面顶点色 */
  spatialWorldExportVariant?: 'textured' | 'vertex_colored'
  /** 空间世界导出（splats）：PLY 分辨率档 */
  spatialWorldExportResolution?: 'full_res' | '500k' | '150k' | '100k'
  /** 空间世界导出：最近一次产物的工程相对路径（PLY 泼溅没有资产，路径只能记在这里） */
  spatialWorldExportRelativePath?: string
  /** 空间世界导出：最近一次导出的资产族 */
  spatialWorldExportAssetType?: 'mesh' | 'splats'
  /** 3D 模型生成：是否要求上游附加骨骼蒙皮（rig）；仅 Tripo / Meshy / Rodin 支持 */
  generateRig?: boolean
  /** 3D 模型生成：骨架类型（humanoid / quadruped / bipedal / creature…）；未启 rig 时忽略 */
  generateRigType?: string
  /** 3D 模型生成：绑定动画预设 id；未启 rig 或上游不支持时忽略 */
  generateRigAnimation?: string
  /**
   * AI 姿势节点：最近一次 Cook 写入的骨名 → 局部欧拉弧度。
   * 输出端口同时带在 GraphAssetValue.bonePose 上，供导演台套用。
   */
  bonePose?: Record<string, StageVec3>
  /** AI 姿势节点：Inspector 当前高亮的常用姿势 id */
  posePresetId?: string
  /**
   * AI 姿势节点：最近一次 Cook 写入的输入端模型相对路径，供 Inspector 姿势预览。
   * 与 `model.rigSkin.rigModelRelativePath` 同口径——只缓存路径、不烘焙文件。
   */
  poseModelRelativePath?: string
  /** AI 姿势节点：输入端模型 assetId（保存姿势资产时携带源模型引用） */
  poseSourceAssetId?: string
  /**
   * 3D 动画节点：最近一次 Cook 写入的输入端模型相对路径，供 Inspector 动画预览。
   * 与 `model.pose.poseModelRelativePath` / `model.rigSkin.rigModelRelativePath`
   * 同口径——只缓存路径，不烘焙文件。
   */
  animationModelRelativePath?: string
  /** 3D 动画节点：输入端模型 assetId（保存动画资产时携带源模型引用） */
  animationSourceAssetId?: string
  /**
   * 3D 骨骼蒙皮节点：最近一次 Cook 写入的 rigMeta（armature + bones + vertex groups）。
   * 输出端口同时带在 GraphAssetValue.rigMeta 上，供导演台套用。
   */
  rigMeta?: {
    armature: string
    bones: string[]
    vertexGroups: string[]
    presetId?: string
    boneGeom?: Array<{
      name: string
      parent: string
      head: [number, number, number]
      tail: [number, number, number]
    }>
    deformMeshes?: string[]
  }
  /** 最近一次 Cook 的硬 QA（失败时也保留，供 Inspector 展示） */
  rigQa?: import('../blenderRigSkinPipeline').RigQaReport
  /** 3D 骨骼蒙皮节点：Inspector 当前高亮的常用拓扑 id */
  rigPresetId?: string
  /**
   * 3D 骨骼蒙皮节点：最近一次 Cook 写入的「输入端 3D 模型」的工程相对路径。
   * rig 本身不重写模型文件，所以 inspector 预览的就是上游资产节点生成的同一份
   * glTF/GLB/FBX/OBJ。Cook 时由 `executeModelRigSkinNode` 用 `ctx.patchNode` 写入；
   * inspector 拿到这个字段直接喂给 ModelPreview 即可，不要从入边再回溯——避免在
   * 多级 pipeline（rigSkin → rigSkin → ...）里走出错模型。
   */
  rigModelRelativePath?: string
  /**
   * 3D 模型拆分节点（`model.segment`）：拆分模式。
   * `mesh`=网格分割（几何拓扑；给粒度时升级到 v2 语义 + 几何），`smart`=智能分割（语义命名 + mask）。
   */
  segmentMode?: 'mesh' | 'smart'
  /** 网格分割粒度（`/v3/mesh/segment` v2 专用）；空串 = 走 v1 几何拓扑（默认） */
  segmentGranularity?: 'simple' | 'balanced' | 'detailed' | ''
  /** 网格分割 v2：是否按连通域拆分（默认 true） */
  segmentSplitByConnectivity?: boolean
  /** 智能分割粒度（与网格分割不是同一套枚举） */
  segmentSmartGranularity?: 'coarse' | 'medium' | 'fine'
  /** 智能分割：点名要拆哪些部件（如「带剑与盔甲的游戏角色」） */
  segmentHint?: string
  /**
   * 3D 模型拆分节点：最近一次 Cook 写入的输入端模型相对路径（拆分不重写源文件），
   * 与 `model.rigSkin.rigModelRelativePath` 同口径，供 Inspector 预览。
   */
  segmentModelRelativePath?: string
  /** 3D 模型拆分节点：最近一次 Cook 解析出的部件名（= 拆分后 GLB 的 node 名） */
  segmentParts?: string[]
  /** 3D 模型拆分节点：智能分割返回的部件描述 */
  segmentDescription?: string
  /** 3D 模型拆分节点：智能分割返回的部件 mask 图 URL */
  segmentMaskUrl?: string
  /**
   * 3D 骨骼蒙皮节点：Tripo rig 任务 id。
   * 动画重定向（`/v3/animations/retarget`）只吃 rig 任务 id，靠输出值上的
   * `providerTaskId` 传给下游节点，这里存一份供 Inspector 展示。
   */
  rigTaskId?: string
  /** 3D 骨骼蒙皮节点：Tripo 骨架命名规范（mixamo 兼容 Mixamo 动作库 / tripo 原生） */
  generateRigSpec?: 'tripo' | 'mixamo'
  /** 3D 骨骼蒙皮节点：Tripo 输出格式（glb 网页预览 / fbx 进 DCC 与游戏引擎） */
  generateRigOutFormat?: 'glb' | 'fbx'
  /** 3D 模型拆分节点：Tripo 拆分任务 id（部件补全只吃 mesh/segment 任务 id） */
  segmentTaskId?: string
  /** 3D 部件补全节点：上游拆件任务 id（未连接时为空） */
  meshCompleteTaskId?: string
  /** 3D 部件补全节点：要补全的部件，省略 = 全部 */
  meshCompletePartNames?: string[]
  /** 3D 部件补全节点：补全模式（AI 补全 / 快速封口） */
  meshCompleteMode?: 'ai_completion' | 'quick_cap'
  /** 3D 部件补全节点：上游模型相对路径（Inspector 预览） */
  meshCompleteModelRelativePath?: string
  /** 3D 重拓扑节点：算法档位（v2.0 智能 / v1.0 基础减面） */
  retopologyMode?: 'smart' | 'basic'
  /** 3D 重拓扑节点：目标面数（留空 = 自适应） */
  retopologyFaceLimit?: number
  /** 3D 重拓扑节点：输出四边面 */
  retopologyQuad?: boolean
  /** 3D 重拓扑节点：把贴图烘焙到低模（v1.0 不支持） */
  retopologyBake?: boolean
  /** 3D 重拓扑节点：要重拓扑的部件（v1.0 不支持） */
  retopologyPartNames?: string[]
  /** 3D 重拓扑节点：结果模型相对路径（Inspector 预览） */
  retopologyModelRelativePath?: string
  /** 3D 重拓扑节点：最近一次任务 id */
  retopologyTaskId?: string
  /** 3D 绑骨检查节点：模型是否可绑骨 */
  rigCheckRiggable?: boolean
  /** 3D 绑骨检查节点：Tripo 推荐的骨架类型 */
  rigCheckRigType?: string
  /** 3D 绑骨检查节点：检查任务 id */
  rigCheckTaskId?: string
  /** 3D 绑骨检查节点：被检查模型相对路径（Inspector 预览） */
  rigCheckModelRelativePath?: string
  /** 3D 动画重定向节点：预设动画 id 列表（如 preset:walk） */
  retargetAnimations?: string[]
  /** 3D 动画重定向节点：动作库动画 id 列表（Meshy action_id；从动作库选择器挑） */
  retargetActionIds?: number[]
  /** 3D 动画重定向节点：输出格式 */
  retargetOutFormat?: 'glb' | 'fbx'
  /** 3D 动画重定向节点：把动画烘焙进模型（仅 glb 生效） */
  retargetBakeAnimation?: boolean
  /** 3D 动画重定向节点：带几何导出 */
  retargetExportWithGeometry?: boolean
  /** 3D 动画重定向节点：原地播放（不产生位移） */
  retargetAnimateInPlace?: boolean
  /** 3D 动画重定向节点：结果模型相对路径（Inspector 预览） */
  retargetModelRelativePath?: string
  /** 3D 动画重定向节点：最近一次任务 id */
  retargetTaskId?: string
  /** 3D 格式转换节点：目标格式 */
  convertFormat?: 'GLTF' | 'FBX' | 'USDZ' | 'OBJ' | 'STL' | '3MF'
  /** 3D 格式转换节点：输出四边面（会强制回 FBX） */
  convertQuad?: boolean
  /** 3D 格式转换节点：目标面数上限 */
  convertFaceLimit?: number
  /** 3D 格式转换节点：导出贴图尺寸 */
  convertTextureSize?: number
  /** 3D 格式转换节点：导出贴图格式 */
  convertTextureFormat?: string
  /** 3D 格式转换节点：FBX 兼容预设 */
  convertFbxPreset?: string
  /** 3D 格式转换节点：pivot 移到模型底部中心 */
  convertPivotToCenterBottom?: boolean
  /** 3D 格式转换节点：统一打包 UV */
  convertPackUv?: boolean
  /** 3D 格式转换节点：烘焙材质到基础贴图 */
  convertBake?: boolean
  /** 3D 格式转换节点：保留骨骼与动画 */
  convertWithAnimation?: boolean
  /** 3D 格式转换节点：导出部件子集（留空 = 整模） */
  convertPartNames?: string[]
  /** 3D 格式转换节点：结果模型相对路径（Inspector 预览） */
  convertModelRelativePath?: string
  /** 3D 格式转换节点：最近一次任务 id */
  convertTaskId?: string
  /** 3D 贴图节点：文生贴图提示词（与卡片指令框同源） */
  texturePromptText?: string
  /** 3D 贴图节点：贴图模型版本 */
  textureVersion?: string
  /** 3D 贴图节点：精度档位（fast / standard / detailed / extreme） */
  textureQuality?: string
  /** 3D 贴图节点：对齐优先项 */
  textureAlignment?: string
  /** 3D 贴图节点：生成 PBR 材质 */
  texturePbr?: boolean
  /**
   * 3D 贴图节点：是否去掉参考图里的烘焙光照。
   * 未设置 = 用上游默认（Tripo delight 默认开、Meshy remove_lighting 默认不动）。
   */
  textureDelight?: boolean
  /** 3D 贴图节点：随机种子（留空随机） */
  textureSeed?: number
  /** 3D 贴图节点：只贴这些部件（留空 = 全部） */
  texturePartNames?: string[]
  /** 3D 贴图节点：结果模型相对路径（Inspector 预览） */
  textureModelRelativePath?: string
  /** 3D 贴图节点：最近一次任务 id */
  textureTaskId?: string
  /**
   * 3D 关键帧动画节点：最近一次 Cook 写入的 clip（action + fps + 帧范围 + 关键帧表）。
   * 输出端口同时带在 GraphAssetValue.clip 上，供导演台按帧驱动。
   */
  clip?: {
    name: string
    fps: number
    frameRange: [number, number]
    keyframes: Record<string, Record<number, [number, number, number]>>
    presetId?: string
  }
  /** 图片/视频生成：随机种子（固定可复现，留空随机） */
  generateSeed?: number
  /** 图片/视频生成：是否跟随工程全局种子（默认 true；false 时用 generateSeed） */
  generateSeedUseGlobal?: boolean
  /** 声音生成：角色音色档案中的角色名（跨镜头一致配音） */
  generateSpeechCharacter?: string
  /** 声音生成：克隆参考音频（工程内相对路径或 http(s) URL） */
  generateSpeechReferenceAudio?: string
  /** 2D帧动画：帧行数 / 列数 */
  animRows?: number
  animCols?: number
  /** 2D帧动画：动画动作预设 id（见 ANIM2D_PRESETS） */
  animPresetId?: string
  /** 2D帧动画：视角锁定（''|side|iso|front|top） */
  animViewAngle?: '' | 'side' | 'iso' | 'front' | 'top'
  /** 2D帧动画：画风锁定（''|cel|pixel|hd2d|vfx） */
  animStyleLock?: '' | 'cel' | 'pixel' | 'hd2d' | 'vfx'
  /** 2D帧动画：自定义动作描述（留空用预设） */
  animInstruction?: string
  /** 2D帧动画：dive 子图资产 id */
  animAssetId?: string
  /** 2D帧动画：dive 内图结构版本（变化时重建内图） */
  animGraphVersion?: number
  /** 2D帧动画：序列图预览（dataUrl 或 relativePath） */
  animGridImage?: { dataUrl?: string; relativePath?: string }
  /** 2D帧动画：特效/角色透明化背景模式（''|black|white|auto） */
  animKeyColor?: '' | 'black' | 'white' | 'auto'
  /** 2D帧动画：背景键控容差阈值（5~180，默认 60） */
  animKeyThreshold?: number
  /** 2D帧动画：切格边缘内缩（'auto' 或 0~24 px） */
  animEdgeInset?: 'auto' | number
  /** 2D帧动画：帧间防抖稳像模式（off|ground|center） */
  animStabilize?: 'off' | 'ground' | 'center'
  /** 2D帧动画：播放/合成模式（loop=正向循环 / pingpong=往返循环） */
  animPlayMode?: 'loop' | 'pingpong'
  /** 2D帧动画：禁用/跳过的坏帧格子键列表（如 ['1-3']） */
  animDisabledCells?: string[]
  /** 2D帧动画：逐格停留时长倍率（如 {'1-1': 1.5, '1-2': 0.5, '1-3': 2.5}，用于 Hit-Stop 打击感顿帧） */
  animCellHolds?: Record<string, number>
  /** 2D帧动画：单格像素级偏移微调与水平翻转（如 {'1-2': { dx: 4, dy: -2, flipX: false }}） */
  animCellOffsets?: Record<string, { dx: number; dy: number; flipX?: boolean }>
  /** 2D帧动画：PixelOver 级精灵自动外描边颜色（''|black|white|gold|cyan） */
  animOutline?: '' | 'black' | 'white' | 'gold' | 'cyan'
  /** 2D帧动画：PixelOver 级真像素晶格规整块尺寸（0=关闭，2/3/4/6 px） */
  animPixelSnap?: number
  /** 2D帧动画：脚底接触椭圆阴影开关 */
  animGroundShadow?: boolean
  /** 2D帧动画：跨帧调色板锁死与限色量化（0=关闭，16/32/64=像素画定色，128=跨帧首帧色彩防闪烁） */
  animPaletteLock?: 0 | 16 | 32 | 64 | 128
  /** 2D帧动画：动作残影/幻影拖尾（''|cyan|gold|purple|crimson|echo） */
  animMotionTrail?: '' | 'cyan' | 'gold' | 'purple' | 'crimson' | 'echo'
  /** 2D帧动画：首尾循环无缝平滑闭合开关 */
  animLoopBlend?: boolean
  /**
   * 生成帧动画序列图模式：
   * - 'auto'：智能判别（仅接视频→视频直抽拼表；视频+角色图→视频姿态引导重绘；多张散图→散帧拼表；单张角色图→AI生图）
   * - 'video-sheet'：视频直接抽帧拼合序列图（零API成本、100%动作连续、支持抠底与原地稳像）
   * - 'video-restyle'：视频抽帧作为姿态参考网格 + 角色参考图交给生图模型重绘
   * - 'frames-sheet'：多张关键帧散图（如逐帧拉片/2D舞台输出）直接对齐拼合为序列图
   * - 'ai-sheet'：纯角色参考图 + 动作预设提示词 AI 生图
   */
  animGenMode?: 'auto' | 'video-sheet' | 'video-restyle' | 'frames-sheet' | 'ai-sheet'
  /** 视频抽帧起始时间占比（0~0.95，默认 0） */
  animVideoStartRatio?: number
  /** 视频抽帧结束时间占比（0.05~1，默认 1） */
  animVideoEndRatio?: number
  /**
   * 2D帧动画：运行后输出 GIF 的帧率（0 = 关闭，只切帧）。
   * 合成发生在渲染层（浏览器 canvas），由 `ctx.composeGifFrames` 注入。
   */
  animGifFps?: number
  /** 2D帧动画：最近一次运行产出的 GIF 工程相对路径 */
  animGifRelativePath?: string
  /** 2D帧动画：最近一次运行产出的 GIF 规格（供 Inspector 展示） */
  animGifFrameCount?: number
  animGifWidth?: number
  animGifHeight?: number
  /** SVG 烘焙：采样帧数（决定 GIF 帧数） */
  svgFrames?: number
  /** SVG 烘焙：取样时长（秒）；0 = 自动探测 SVG 自身动画周期 */
  svgDurationSec?: number
  /** SVG 烘焙：输出宽 / 高；0 = 用 SVG 自身尺寸 */
  svgWidth?: number
  svgHeight?: number
  /** SVG 烘焙：背景填充（'' = 透明） */
  svgBackground?: '' | 'white' | 'black'
  /** SVG 烘焙：输入的 SVG 图库资产工程相对路径（最近一次运行） */
  svgSourceRelativePath?: string
  /** SVG 烘焙：最近一次运行实际取样的动画周期（秒），供 Inspector 展示 */
  svgDetectedPeriodSec?: number
  /** SVG 烘焙：最近一次运行产出的 GIF 工程相对路径 */
  svgGifRelativePath?: string
  /** SVG 烘焙：最近一次运行产出的 GIF 规格（供 Inspector 展示） */
  svgGifFps?: number
  svgGifFrameCount?: number
  svgGifWidth?: number
  svgGifHeight?: number
  /** 视频生成：输出时长（秒） */
  generateDuration?: number
  /** 视频生成：是否生成音频（模型支持时） */
  generateAudio?: boolean
  /** 视频生成：帧模式 none | first | first_last */
  generateFrameMode?: 'none' | 'first' | 'first_last'
  /** 视频生成：模型声明的图片输入口上限（0 隐藏 in-image；缺省显示） */
  generateMaxInputImages?: number
  /** 视频生成：模型声明的视频输入口上限（0 隐藏 in-video；缺省显示） */
  generateMaxInputVideos?: number
  /** 视频生成：模型声明的音频输入口上限（0 隐藏 in-voice；缺省显示） */
  generateMaxInputVoices?: number
  /** 片段重拍：重拍区间起点（秒） */
  reshootStartSec?: number
  /** 片段重拍：重拍区间终点（秒） */
  reshootEndSec?: number
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
  /**
   * 图片生成：风格参考图追加语义（默认 default）。
   * 'ui'：UI 界面生图，允许复刻参考图的界面视觉语言，不写“严禁迁移构图”。
   */
  styleReferenceSubject?: StyleReferenceSubject
  /** 声音 TTS：供应商声音 ID（对应 API 字段 voice） */
  generateSpeechVoice?: string
  /**
   * 多说话人对话节点：说话人 → 音色 id 的映射。
   *
   * 对话稿里写 `A: 台词`、`B: 台词`，这里给 A / B 各绑定一个音色
   * （ElevenLabs Text to Dialogue 一次合成整段对话）。
   * 没绑定的说话人沿用节点音色 `generateSpeechVoice`。
   */
  generateDialogueVoices?: Record<string, string>
  /** 音效生成：是否生成可无缝循环的音频（环境音常用） */
  generateSoundLoop?: boolean
  /** 音效生成：期望时长（秒）；规范范围 0.5–30 */
  generateSoundDurationSec?: number
  /** 音效生成：提示词影响力 0–1（越高越贴合描述） */
  generateSoundPromptInfluence?: number
  /** 音乐生成：歌词（多段用 \n 分隔，支持 [Intro]/[Verse] 等结构标签）；纯音乐时留空 */
  generateMusicLyrics?: string
  /** 音乐生成：是否纯音乐（无人声）；缺省 true */
  generateMusicInstrumental?: boolean
  /** 「生成剧本」等输出节点：最近一次执行汇总的结果文本 */
  resultText?: string
  outputKind?: GraphOutputKind
  durationSec?: number
  playbackRate?: number
  volume?: number
  muted?: boolean
  loop?: boolean
  /** 输出节点输入端口类型覆盖 */
  inputDataType?: GraphPortDataType
  /**
   * 束结（media.bundle）锁定的单数端口类型；空/未设表示未锁定，可接首条任意可接受类型。
   */
  bundleDataType?: GraphPortDataType
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
      description?: string
      notes?: string
      fileRelativePath?: string
    }>
    outputs: Array<{
      id: string
      label: string
      dataType: GraphPortDataType
      multiple?: boolean
      description?: string
      notes?: string
      fileRelativePath?: string
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
    slotIndex?: number
    slotSourceId?: string
  }
  /** 导演台 3D 相机节点参数 */
  viewer?: DirectorViewerState
  /** 导演台关闭时回传的站位截图 */
  cameraShots?: DirectorCameraShot[]
  /** 导演台关闭时回传的动作录制视频 */
  cameraVideos?: DirectorCameraVideo[]
  /** 导演台自动合成的运镜与打光结构化提示词（out-prompt 端口直出） */
  directorPrompt?: string
  /**
   * 图片生成节点：历次生成累计的图片（重新执行追加，可在 Inspector 删除）。
   * 大图应物化为 relativePath，dataUrl 可为空。
   */
  generatedImages?: Array<{
    id?: string
    title?: string
    dataUrl: string
    createdAt?: string
    relativePath?: string
    /** UI 生成节点：该界面对应的图层分离拆层指令（供下游 image.layerSplit 自动继承） */
    layerPrompt?: string
  }>
  /**
   * SVG 生成节点：历次生成累计的矢量源码（含落盘 .svg 路径）。
   * `text` 是端口直传用的源码正文；`dataUrl` 仅供卡片缩略，不写进资产 JSON。
   */
  generatedSvgs?: Array<{
    id?: string
    title?: string
    text: string
    dataUrl?: string
    createdAt?: string
    relativePath?: string
  }>
  /** SVG 生成节点当前选中的那一条（写入 out 端口） */
  selectedSvgId?: string
  /** SVG 生成画布：宽高与背景（背景空 = 透明） */
  svgGenWidth?: number
  svgGenHeight?: number
  svgGenBackground?: string
  /**
   * 世界元素生成节点：从子窗口已完成输出节点收集的实体结果
   *（type / name / imageUrl）。
   */
  worldElementOutputs?: Array<{
    type: string
    name: string
    imageUrl: string
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
   * 3D 生成 / 蒙皮 / 姿势 / 动画：历次 Cook 累计的模型（重新执行追加，可在 Inspector 删除）。
   */
  generatedModels?: Array<{
    id?: string
    createdAt?: string
    relativePath?: string
    assetId?: string
    /**
     * 上游供应商任务 id（Tripo / Meshy…）。只吃 task_id 的下游端点
     *（部件补全 / 动画重定向）在单节点执行时要靠它链式调用，别在落盘 / 重建时丢掉。
     */
    providerTaskId?: string
    /** World Labs 世界 id：下游「空间世界导出」只认它，落盘与重建都必须带上 */
    spatialWorldId?: string
    rigMeta?: GraphNodeParams['rigMeta']
    rigQa?: GraphNodeParams['rigQa']
    bonePose?: GraphNodeParams['bonePose']
    clip?: GraphNodeParams['clip']
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
    /** UI 界面拆分：该条目的空字底图轨提示词（随 texts 载荷透传，避免 dive 重建时丢失） */
    cleanPrompt?: string
    /** UI 界面拆分：界面形态分类（fullscreen / hud / popup / panel / component） */
    screenKind?: 'fullscreen' | 'hud' | 'popup' | 'panel' | 'component'
    /** UI 界面拆分：界面画幅比例（9:16 / 16:9 / 1:1 / 4:3 / 3:4） */
    aspectRatio?: '9:16' | '16:9' | '1:1' | '4:3' | '3:4'
    /** UI 界面拆分：供下游 UI 图层分离（image.layerSplit → PSD）使用的拆层提示词 */
    layerPrompt?: string
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
   * 多图卡片预览是否平铺展开。
   * 未设置 / false：错位叠放只突出一张；true：按数量方阵平铺。
   */
  cardImageGridExpanded?: boolean
  /**
   * 用户手动拖过右下角缩放后为 true，停止按预览媒体比例自动改尺寸。
   */
  sizeManuallyResized?: boolean
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
  /**
   * 当前选中的视频 id：生成节点 `out` / 选取视频节点共用。
   * 生成节点每次运行成功后强制切到最新一条。
   */
  selectedVideoId?: string
  /**
   * 当前选中的 3D 模型 id：生成 / 蒙皮 / 姿势 / 动画节点 `out`。
   * 每次运行成功后强制切到最新一条。
   */
  selectedModelId?: string
  /**
   * 当前选中的文本 id：生成节点 `out` / 选取剧本节点共用。
   * 生成节点每次运行成功后强制切到最新一条。
   */
  selectedTextId?: string
  /** UI 界面拆分：拆分出的界面提示词数组（每条对应 dive 内图一条输出链，可含空字底图轨 cleanPrompt、画幅、形态与拆层提示词） */
  uiScreens?: Array<{
    id: string
    title: string
    prompt: string
    cleanPrompt?: string
    screenKind?: 'fullscreen' | 'hud' | 'popup' | 'panel' | 'component'
    aspectRatio?: '9:16' | '16:9' | '1:1' | '4:3' | '3:4'
    layerPrompt?: string
    /** 单屏是否启用生成（缺省 true；false 时在批量生成中跳过该屏） */
    enabled?: boolean
  }>
  /** UI 界面生成：出图轨道模式（'dual' = 带字预览 + 无字底图双轨，'clean-only' = 仅无字底图直通拆层，'preview-only' = 仅带字预览） */
  uiGenTrackMode?: 'dual' | 'clean-only' | 'preview-only'
  /** UI 界面生成：游戏 UI 视觉材质基底预设 */
  uiGenStylePreset?: string
  /** UI 界面生成：当前选中界面对应的专属拆层提示词（供下游 UI 图层分离自动继承） */
  uiSelectedLayerPrompt?: string
  /** UI 界面拆分：dive 内图对应的子图资产 id（懒创建） */
  uiSplitAssetId?: string
  /** UI 界面拆分：dive 内图结构版本（结构变化时递增，旧资产强制重建） */
  uiSplitGraphVersion?: number
  /**
   * 当前选中的声音 id：生成节点 `out` 默认输出口。
   * 每次运行成功后强制切到最新一条。
   */
  selectedVoiceId?: string
  /** 广告变体矩阵：产品 × 维度展开的生成矩阵（随节点落盘） */
  adVariantMatrix?: Partial<AdVariantMatrix>
  /** 广告变体矩阵：单格执行目标 cellId（仅运行该单元格后自动清除） */
  adVariantOnlyCellId?: string
  /** 广告变体矩阵：批量运行模式（'missing' = 仅生成未出图单元格，'all' = 全部未锁定单元格） */
  adVariantRunMode?: 'missing' | 'all'
  /** 角色一致性：绑定的角色引用（含 imageUrl），图片生成时注入 inputReferences */
  characterRefs?: WorldEntityRef[]
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
  /** 人像处理：精修参数（档位枚举 + 自由描述，无破坏性） */
  portraitRetouch?: Partial<PortraitRetouchState>
  /** 人像处理：人脸分析缓存（关键点 + 源图指纹，避免每次 Cook 重新检测） */
  portraitFaces?: Partial<PortraitFacesPayload>
  /** 人像处理：手动液化推拉/膨胀/收缩笔画列表（本地实时精修管线） */
  portraitLiquifyStrokes?: PortraitLiquifyStroke[]
  /** 人像处理：手动污点祛痘点击列表（本地实时精修管线） */
  portraitSpotHeals?: PortraitSpotHealPoint[]
  /** 人像处理：导入的自定义 .cube 3D LUT 色彩查找表 */
  portraitCustomLut?: PortraitCubeLut | null
  /** 人像处理：编辑器内 AI 处理产出的版本栈 */
  portraitLayers?: PortraitAiLayer[]
  /** 人像处理：当前底图版本 id（缺省 = 上游原图） */
  portraitBaseLayerId?: string
  /**
   * 「以上次出图结果为底继续精修」（默认关）。
   *
   * 默认每次 Cook 都从**上游原图**重来，避免反复叠加导致画质逐轮劣化；打开它则以
   * `portraitBakedRelativePath`（上一次「保存并出图」的产物）为底图。
   * 优先级：显式选中的 AI 版本（`portraitBaseLayerId`）> 上次出图 > 上游原图。
   */
  portraitChainFromOutput?: boolean
  /** 人像处理：最近一次 Cook 的产物相对路径 */
  portraitBakedRelativePath?: string
  /**
   * 人像处理：局部回贴开关。'local'（默认）= 模型结果按脸/人物/手动框蒙版贴回原图，
   * 未请求部位保持原图像素；'global' = 整图生效（旧行为）。
   */
  portraitScopeMode?: 'local' | 'global'
  /**
   * 人像处理：引擎分流策略。
   * - 'smart'：智能双擎路由（纯计算摄影项走本地 0 漂移管线，含生成项走大模型 + 三重身份锁）
   * - 'local'：强制走本地确定性计算摄影引擎
   * - 'cloud'：走生图大模型 + 三重身份锁
   */
  portraitEngineMode?: 'smart' | 'cloud' | 'local'
  /**
   * 人像处理：大模型三重身份锁开关（默认 true 开启：68 点 MLS 几何回正 + 换装面部锁死 / 高低频微纹理融合）。
   */
  portraitIdentityLock?: boolean
  /** 人像处理：最近一次 Cook **实际发给模型**的完整提示词（含系统提示词与负面提示） */
  portraitPrompt?: string
  /** 人像处理：最近一次证件照几何计划（规格 / 裁切框 / 拼版） */
  portraitIdPhotoPlan?: {
    specId: string
    outputWidth: number
    outputHeight: number
    crop: { x: number; y: number; w: number; h: number }
    sheet: {
      cols: number
      rows: number
      cellWidth: number
      cellHeight: number
      gapPx: number
      width: number
      height: number
      count: number
      paper: string
    } | null
  } | null
  /** 情绪调节：坐标盘 */
  emotionPad?: Partial<EmotionPadState>
  /** 情绪调节：定位短名 */
  emotionLabel?: string
  /** 情绪调节：最终提示词 */
  emotionPrompt?: string
  /** 高清放大参数 */
  imageUpscale?: Partial<ImageUpscaleState>
  /**
   * 逐帧拉片节点：按帧号记录的批注（key 为取帧条目的 id）。
   */
  frameNotes?: Record<string, string>
  /**
   * 逐帧拉片节点：胶片条缩略图（首次生成后持久化，同源视频复用，避免重复抽帧）。
   */
  frameFilmstrip?: Array<{ frame: number; dataUrl: string }>
  /** 胶片条来源标识（当前视频 URL 的短哈希），来源变化时自动重新生成 */
  frameFilmstripKey?: string
  /** 生成胶片条时快照的总帧数；复用缓存时直接使用，不再现场计算 */
  frameFilmstripTotalFrames?: number
  /** 生成胶片条时快照的帧率；复用缓存时锁定该帧率换算当前帧号 */
  frameFilmstripFps?: number
  /** 胶片条模式：keyframe=关键帧；hybrid=关键帧+均匀混合；uniform=均匀抽样；frame=逐帧回退；空=未生成 */
  frameFilmstripMode?: import('./framePull').FramePullFilmstripMode
  /** 逐帧拉片：框选区间入点帧号（含） */
  framePullInFrame?: number
  /** 逐帧拉片：框选区间出点帧号（含） */
  framePullOutFrame?: number
  /** 逐帧拉片：区间重生成锚定模式（first_last=首尾帧锚定 / first_only=仅首帧 / video_ref=原片参考） */
  framePullConditioningMode?: import('./framePull').FramePullConditioningMode
  /** 逐帧拉片：重生成片段替换回原视频时的时长对齐策略（stretch=双向变速对齐 / trim=裁切补帧对齐） */
  framePullFitMode?: import('./framePull').FramePullFitMode
  /** 逐帧拉片：替换回原视频时是否保留原片音轨（默认 true） */
  framePullKeepAudio?: boolean
  /** 逐帧拉片：可选指定某张已抽取帧作为区间重拍首帧（留空自动抓取 inFrame） */
  framePullFirstFrameId?: string
  /** 逐帧拉片：可选指定某张已抽取帧作为区间重拍尾帧（留空自动抓取 outFrame） */
  framePullLastFrameId?: string
  /** 逐帧拉片：当前已替换成片的工程相对路径（为空则使用上游原视频） */
  framePullActiveVideoPath?: string
  /** 逐帧拉片：原始上游视频工程相对路径快照（用于对比/还原原片） */
  framePullSourceVideoPath?: string
  /** 逐帧拉片：区间重生成并替换回原视频的历史记录栈（支持多段连续修补与撤销） */
  framePullSpliceHistory?: import('./framePull').FramePullSpliceRecord[]
  /** 图像处理综合节点（image.process）：当前激活子工具 */
  imageProcessTool?: import('./nodeRole').ImageProcessToolId
  /** 图像处理综合节点（image.process）：子工具切换时是否以上一步产出图为底图继续链式加工 */
  imageProcessChainFromOutput?: boolean
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
  /** 图片变换参数（缩放 / 旋转 / 镜像 / 平移；纯本地像素，不调模型） */
  imageTransform?: Partial<import('./imageTransform').ImageTransformState>
  /** 本地抠图参数（节点图版一键抠图） */
  imageCutout?: Partial<ImageCutoutState>
  /** 智能构图参数（节点图版一键构图） */
  imageCompose?: Partial<ImageComposeState>
  /** 精灵统一对齐参数（透明 PNG 上统一画布 + 锚点） */
  imageAlign?: Partial<import('./imageAlign').ImageAlignState>
  /** 2D 舞台场景参数（5.5「2D 导演台」：统一画布 + 按 z 序精灵层叠放，随节点图持久化） */
  stage2dScene?: Partial<import('./stage2d').Stage2dSceneState>
  /** 2D 骨骼装配（5.5 骨骼摆姿：关节层级 + 部件挂点，随节点图持久化） */
  stage2dRig?: Partial<import('./stage2dRig').Stage2dRig>
  /** 摆姿：关节 id → 旋转覆盖值（不改写绑定旋转） */
  stage2dPose?: import('./stage2dRig').Stage2dPose | null
  /** 自定义关键帧动作（参考视频逐帧转骨架关键帧动画等；内置预设不落节点） */
  stage2dAction?: import('./stage2dAction').Stage2dAction | null
  /** 2D 舞台动作帧导出帧率（0 = 关闭，只出单帧舞台图；> 0 时运行节点额外产出帧序列 + sheet） */
  stage2dAnimFps?: number
  /** 2D 舞台最近一次运行产出的逐帧 PNG 工程相对路径（与 out-frames 同批） */
  stage2dAnimFramePaths?: string[]
  /** 2D 舞台最近一次运行产出的帧序列 sheet 工程相对路径（out-sheet） */
  stage2dAnimSheetRelativePath?: string
  /** 2D 舞台最近一次运行产出的帧数（供节点卡片 / Inspector 展示） */
  stage2dAnimFrameCount?: number
  /** 2D 舞台最近一次运行产出的 sheet 列数（拼版信息，供引擎按格切帧） */
  stage2dAnimSheetColumns?: number
  /** 2D 舞台最近一次运行产出的 sheet 行数 */
  stage2dAnimSheetRows?: number
  /** 可玩 HTML：完整文档源码（编译后的单文件；沙盒预览源） */
  gamePlayHtml?: string
  /** 可玩 HTML：2d / 3d / auto */
  gamePlayMode?: '2d' | '3d' | 'auto'
  /** 可玩 HTML：单文件落盘相对路径（可选） */
  gamePlayHtmlPath?: string
  /** 可玩 HTML：纯 Node（esbuild）工程相对工程根路径 */
  gamePlayProjectDir?: string
  /** 可玩 HTML：cook 构建产物相对路径 */
  gamePlayBuildHtmlPath?: string
  /** 宫格切分 / 局部放大 */
  imageGridSplit?: Partial<ImageGridSplitState>
  /** 图标包导出（image.iconPack）：逐格键控透明 / 统一画布 / 命名打包参数 */
  iconPack?: Partial<import('./iconPack').IconPackState>
  /** 图标包最近一次运行清单（manifest 回写，供检查 / 排障） */
  iconPackManifest?: unknown
  /** 图标包 manifest 落盘相对路径（icons 文本，与 PNG 同目录） */
  iconPackManifestRelativePath?: string
  /** 图标包单枚回炉覆盖（逐枚精修）：cellKey → 精修后单图 dataURL，再跑打包即顶替对应格位 */
  iconPackCellRefines?: import('./iconPack').IconPackCellRefines
  /** 图层分离（Seedream layer_decomposition） */
  imageLayerSplit?: Partial<ImageLayerSplitState>
  /** 图层分离：最近一次运行自动导出的分层 PSD 工程相对路径（out-psd） */
  layerSplitPsdRelativePath?: string
  /** 剧集 Agent 流水线：分镜师/动画师生成步骤（breakdown/beatboard/sequence/motion） */
  episodeStep?: 'breakdown' | 'beatboard' | 'sequence' | 'motion'
  /** 剧集 Agent 流水线：导演审核目标步骤（与 episodeStep 互斥） */
  episodeReviewTarget?: 'breakdown' | 'beatboard' | 'sequence' | 'motion'
  /** 剧集 Agent 流水线：导演审核变体（如 motion 的 9宫格直出变体） */
  episodeReviewVariant?: string
  /** 剧集 Agent 流水线：导演审核回标结果（PASS / FAIL） */
  episodeReviewStatus?: 'PASS' | 'FAIL'
  /** 剧集 Agent 流水线：导演审核回标原因 */
  episodeReviewReason?: string
  /** 剧集 Agent 流水线：重新生成后等待导演审核 */
  episodeReviewPending?: boolean
  /** 剧集 Agent 流水线：宫格选择节点选中的宫格编号（1..9） */
  anchorIndex?: number
  /** 剧集 Agent 流水线：动态格选择节点选中的组编号（1..9） */
  cellGroupIndex?: number
  /** 剧集 Agent 流水线：动态格选择节点选中的格编号（1..4） */
  cellIndex?: number
  /** 剧集 Agent 流水线：状态文件作用域键（通常为集编号，如 ep01） */
  episodeScopeKey?: string
  /** 剧集 Agent 流水线：9 宫格提取节点（image.gridSplit）对应的锚点宫格编号（1..9）；替代按标题探测 */
  anchorCellIndex?: number
  /** 剧集 Agent 流水线：4 宫格提取节点对应的「组-格」编号（如 "2-3"；组 1..9、格 1..4） */
  gridCellIndex?: string
  /** 剧集 Agent 流水线：动态视频生成节点对应的「组-格」编号（如 "2-3"） */
  motionCellIndex?: string
  /** 世界元素托管节点 id（四类画布同步用，勿与用户手搓节点冲突） */
  worldElementId?: string
  /** 世界元素目录审核状态（unreviewed | reviewed；旧文档中的「未审核/已审核」读取时归一化） */
  reviewStatus?: string
  /** 媒体质检（导演 PASS/FAIL）：回标结果 */
  mediaReviewStatus?: 'PASS' | 'FAIL'
  /** 媒体质检（导演 PASS/FAIL）：FAIL 原因 */
  mediaReviewReason?: string
  /** 媒体质检（导演 PASS/FAIL）：上游重新生成后等待再次审核 */
  mediaReviewPending?: boolean
  /** 媒体自动返工循环：最大尝试次数（含首次，默认 3） */
  mediaReworkMaxAttempts?: number
  /** 媒体自动返工循环：序列化状态 JSON（见 mediaRework.ts） */
  mediaReworkState?: string
  /** 媒体自动返工循环：终态（running / passed / exhausted） */
  mediaReworkStatus?: 'running' | 'passed' | 'exhausted'
  /**
   * 媒体质检：专用视觉模型 id。
   * 缺省时回退 generateModel（旧图兼容）。返工节点必须显式配置，
   * 否则会拿图像模型去跑文本质检——那是质检结论不可信的根因。
   */
  reviewModel?: string
  /** 媒体质检：专用提供商实例 id（缺省回退 generateProviderInstanceId） */
  reviewProviderInstanceId?: string
  /**
   * 媒体质检备选模型链：质检模型调用失败时依次自动切换，格式同 generateModelFallbacks。
   * 质检卡住会让整条返工链空转，备选视觉模型可避免「一次 429 全链停摆」。
   */
  reviewModelFallbacks?: string[]
  /**
   * 媒体质检：前 N 张输入视为参考图（比对基准，不参与评分），其余为待审产物。
   * 缺省自动判定：仅 1 张则全为产物；多张时首张作基准（用户通常把参考图接在最前）。
   * 显式设 0 表示全部是待审产物。
   */
  mediaReviewReferenceCount?: number
  /** 媒体质检：五维评分明细 JSON（见 mediaReview.ts MediaReviewScores） */
  mediaReviewScores?: string
  /** 媒体质检：程序判定的客观未通过项 JSON（见 mediaReview.ts MediaObjectiveIssue[]） */
  mediaReviewObjectiveIssues?: string
  /** 媒体返工：返工策略（auto=按轮次自动升级，或固定 guidance / reseed / stronger） */
  mediaReworkStrategy?: 'auto' | 'guidance' | 'reseed' | 'stronger'
  /** 媒体返工：首轮出图后暂停等待人工确认，确认后才继续后续返工 */
  mediaReworkConfirmFirst?: boolean
  /** 媒体返工：正等待人工确认（首轮已出图、尚未决定继续） */
  mediaReworkAwaitingConfirm?: boolean
  /** 媒体返工：各轮调用开销 JSON（见 mediaRework.ts MediaReworkCostEntry[]） */
  mediaReworkCost?: string
  /** 漫画页：序列化 JSON 文本（见 comicPage.ts），由 ComicPageInspector 编辑/预览/导出 */
  comicPage?: string
  /**
   * 影视流水线（film.*）：结构化分镜文档 JSON（schema `aiart.film-storyboard@1`，见 film/storyboard.ts）。
   * film.breakdown / film.review 执行后写回；人工可直接编辑（锁定的镜头不会被 AI 重写）。
   */
  filmStoryboard?: string
  /** 影视流水线：角色 / 场景 / 道具设定库 JSON（schema `aiart.film-cast@1`），film.cast 写回 */
  filmCast?: string
  /** 影视流水线：film.render 每镜产物缓存 JSON（shotId → 关键帧 / 视频 / 指纹 / 质检） */
  filmRenders?: string
  /** 分镜拆解：目标镜头数（0 = 由剧情节奏自动决定） */
  filmTargetShots?: number
  /** 分镜拆解：单镜目标时长（秒，0 = 自动；如 15 表示拆解为约 15s 的长分镜并按时间段写动态提示词） */
  filmShotDurationSec?: number
  /** 分镜拆解：统一画幅（如 16:9 / 9:16 / 2.39:1），写入分镜文档并作为下游出图默认值 */
  filmAspectRatio?: string
  /** 分镜拆解：全片视觉风格（画风 / 色调 / 年代质感），写入分镜文档并注入所有出图提示词 */
  filmStyle?: string
  /** 分镜拆解：输入指纹（剧本 + 选项 + 模型）；未变化时直接复用已有分镜，不重复调模型 */
  filmSourceHash?: string
  /** 导演审核：最多自动修订轮数（0 = 只审不改） */
  filmReviewMaxRounds?: number
  /** 导演审核：上次审核报告（Markdown，供卡片与检查器展示） */
  filmReviewReport?: string
  /** 导演审核：上次结论 */
  filmReviewVerdict?: 'PASS' | 'FAIL' | ''
  /** 角色场景设定：参与生成的实体种类，逗号分隔（character,location,prop） */
  filmCastKinds?: string
  /** 角色场景设定：单次只生成指定实体 id（或名称）的设定图，执行后自动清空 */
  filmCastOnlyId?: string
  /** 角色场景设定 / 批量拍摄：忽略缓存强制重生成 */
  filmForce?: boolean
  /** 镜头装配：镜头引用（1 起序号或镜头 id） */
  filmShotRef?: string
  /** 批量拍摄：产出模式（keyframe = 只出关键帧；video = 关键帧 + 图生视频；sheets = 设定图） */
  filmRenderMode?: 'keyframe' | 'keyframes' | 'video' | 'sheets'
  /** 批量拍摄：镜头范围（如 `1-5,8`；空 = 全部） */
  filmShotRange?: string
  /** 批量拍摄：单次只拍摄指定镜头 id（或序号），执行后自动清空 */
  filmRenderOnlyShotId?: string
  /** 批量拍摄：同场相邻镜头衔接（默认开启：注入上一镜动作/光影上下文并将上一镜关键帧作为参考图） */
  filmRenderContinuity?: boolean
  /** 批量拍摄：生成视频时是否参考 3D 白模运镜视频（@2，默认开启；关闭后生视频仅用 @1 写实首帧图） */
  filmRenderPrevizVideoRef?: boolean
  /** 批量拍摄：关键帧视觉质检（不合格自动重拍） */
  filmRenderQc?: boolean
  /** 批量拍摄：单镜最大重拍次数 */
  filmRenderMaxRetries?: number
  /** 批量拍摄与设定图：最大并发数（1~8，默认 3；同场次关键帧内部按顺序保持连续性，跨场次关键帧与图生视频并发执行） */
  filmRenderConcurrency?: number
  /** 批量拍摄：视频模型（generateModel 是关键帧图片模型） */
  filmVideoModel?: string
  filmVideoProviderInstanceId?: string
  /** 批量拍摄：视频生成参数（与关键帧图片参数独立存储，避免 2K vs 1080p 等互相覆盖） */
  filmVideoResolution?: string
  filmVideoAspectRatio?: string
  filmVideoDuration?: number
  filmVideoAudio?: boolean
  filmVideoSeed?: number
  filmVideoSeedUseGlobal?: boolean
  /** 批量拍摄：质检用视觉文本模型（缺省 = 设置里默认文本模型） */
  filmQcModel?: string
  filmQcProviderInstanceId?: string
  /** 影视工作台（film.workbench）：当前选中的阶段 Tab */
  filmWorkbenchStage?: 'breakdown' | 'review' | 'cast' | 'render'
  /** 影视工作台：单次执行的阶段目标（空或 all = 按顺序执行全流程；执行后自动清空） */
  filmWorkbenchRunMode?: 'all' | 'breakdown' | 'review' | 'cast' | 'render' | ''
  /** 影视工作台：分镜拆解与导演审核使用的文本模型（与图片生成模型 generateModel 独立存储） */
  filmTextModel?: string
  filmTextProviderInstanceId?: string
  /** 影视工作台：各阶段独立额外指令（旧单阶段节点回退读 generateInstruction） */
  filmBreakdownInstruction?: string
  filmReviewInstruction?: string
  filmCastInstruction?: string
  /** 脚本节点（script.run）：最近一次执行的 console 日志快照 */
  scriptLastLogs?: Array<{ level: 'info' | 'warn' | 'error'; message: string }>
  /** 脚本节点（script.run）：最近一次执行耗时（毫秒） */
  scriptLastRunMs?: number
  /** 脚本节点（script.run）：最近一次执行错误信息 */
  scriptLastError?: string
  /** 脚本节点（script.run）：最近一次执行时间戳（ISO 字符串） */
  scriptLastRunAt?: string
}

export interface GraphPortDef {
  id: string
  direction: GraphPortDirection
  dataType: GraphPortDataType
  /** 是否允许多条边连到同一端口 */
  multiple?: boolean
  label?: string
  /**
   * 端口在卡片上的显示名（i18n key）。缺省时按 `dataType` 翻译——
   * 同类型的多个端口（如图库节点的 out / out-gif 都是 image）需要它来区分。
   */
  labelKey?: string
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
  /** 节点是否锁定 */
  locked?: boolean
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
  status: 'idle' | 'pending' | 'running' | 'done' | 'error' | 'degraded' | 'skipped'
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
