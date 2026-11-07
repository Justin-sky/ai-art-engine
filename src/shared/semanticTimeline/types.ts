/**
 * Semantic Timeline — `aiart.semantic-timeline@2`（四轴逆向拆解与分流复刻 IR）
 *
 * 两节点直连管线：
 *   1. `semantic.analyze`（视频拆解）：原片 → 确定性信号取证 + 多模态 VLM 四轴拆解 → `SemanticTimeline`
 *   2. `semantic.rebuild`（视频重制）：`SemanticTimeline` + 参考图 → 按 `G1..Gk` 单元合批生成 + `K1..Kk` 零成本运镜 + 原片直通拼接
 *
 * 不变量：局部改片模式（`edit`）下零修改时逐镜直通还原原片。
 */

import type {
  BreakdownAnalysis,
  ShotBaseClassification,
  ShotForensicFeatures,
  ShotLayerItem,
  ShotMaterialProvenance,
  ShotReplicationRoute
} from './reaTypes'

export const SEMANTIC_TIMELINE_SCHEMA = 'aiart.semantic-timeline@2' as const
export const SEMANTIC_TIMELINE_SCHEMA_V1 = 'aiart.semantic-timeline@1' as const
export type SemanticTimelineSchema = typeof SEMANTIC_TIMELINE_SCHEMA
/** 证据文件的 schema 标记：旧工程里的证据文件仍是 @1，读取时两者都认 */
export type SemanticEvidenceSchema = SemanticTimelineSchema | typeof SEMANTIC_TIMELINE_SCHEMA_V1

/** 帧级时间范围（秒 + 帧索引，帧索引按源视频 fps 对齐） */
export interface TimeRange {
  start: number
  end: number
  startFrame: number
  endFrame: number
}

export type Origin = 'analysis' | 'agent' | 'user'

export type EntityKind = 'person' | 'product' | 'object' | 'text' | 'logo' | 'background' | 'voice'

export type CameraAction =
  | 'push_in'
  | 'pan'
  | 'zoom'
  | 'orbit'
  | 'tilt'
  | 'dolly'
  | 'static'
  | 'handheld'
  | 'rack_focus'
  | string

// ─── Evidence ───────────────────────────────────────────────────────────────

export interface MediaFacts {
  durationSec: number
  fps: number
  width: number
  height: number
  hasAudio: boolean
  audioChannels?: number
  codec?: string
}

export interface ShotEvidence {
  id: string
  range: TimeRange
  /** 相对 semantic 根的关键帧路径（首/中/尾 + 三联帧时序拼图 strip） */
  keyframes: { first?: string; middle?: string; last?: string; strip?: string }
  /** 切镜置信度 0..1 */
  confidence: number
  /** 入点转场类型（硬切 / 淡入 / 叠化 / 闪白 / 版式切换） */
  transitionIn?: ShotTransition
  /** 确定性信号取证特征（噪点 / 推拉 / 调色 / 布光 / 纯色块 / 轴向边缘） */
  forensics?: ShotForensicFeatures
}

export interface WordTiming {
  text: string
  start: number
  end: number
  confidence?: number
}

export interface UtteranceEvidence {
  id: string
  range: TimeRange
  text: string
  speaker?: string
  /** 词级时间；缺省表示仅句级 */
  words?: WordTiming[]
  granularity: 'word' | 'sentence'
  confidence: number
}

export interface EntityAppearance {
  shotId: string
  range: TimeRange
  /** 框证据相对路径（JSON/PNG） */
  boxes?: string
  /** 掩码序列相对路径前缀 */
  masks?: string
  /** 关键帧检测框（归一化 0..1）；无掩码时按框做近似像素编辑 */
  box?: { x: number; y: number; w: number; h: number }
}

export interface Entity {
  id: string
  kind: EntityKind
  name: string
  appearances: EntityAppearance[]
  /** 身份参考资产 id（兼容单资产引用；局部替换优先写 `replacement`） */
  reference?: { assetId: string }
  /** 只有带检测框或掩码的实体才允许像素级替换 */
  pixelEditable: boolean
  /** 局部替换：换成谁（参考图）+ 换哪里（各镜掩码）+ 怎么换（指令） */
  replacement?: EntityReplacement
}

/** 替换用的身份参考图：资产 id 或工程相对路径（二选一） */
export interface EntityReplacementRef {
  assetId?: string
  relativePath?: string
  /** 显示名（候选列表里的名字） */
  label?: string
}

/** 某一镜里"要换的是哪一块"：在该镜首帧所用关键帧上点选 / 框选得到的黑白掩码 */
export interface EntityTargetMask {
  shotId: string
  /** 点选时用的关键帧（工程相对路径）；重绘以它为底图，也是图生视频的首帧来源 */
  keyframeRelativePath: string
  /** 黑白掩码 PNG（白 = 要替换的区域），工程相对路径 */
  maskRelativePath: string
  /** 归一化外接框（0..1），同镜多实体的重叠判断用 */
  box: { x: number; y: number; w: number; h: number }
  /** instance = 本地实例分割选中；rect = 手动拖框 */
  method: 'instance' | 'rect'
}

export interface EntityReplacement {
  /** 替换指令，含 `@n`（n 从 1 起，对应 references[n-1]） */
  instruction: string
  references: EntityReplacementRef[]
  masks: EntityTargetMask[]
}

export interface OcrRegion {
  id: string
  range: TimeRange
  text: string
  kind: 'product_name' | 'price' | 'caption' | 'logo' | 'other'
  /** 归一化框 0..1 */
  box?: { x: number; y: number; w: number; h: number }
  shotId?: string
  confidence: number
}

export interface AudioStems {
  /** 人声相对路径；拆不干净时可为 null */
  vocals?: string | null
  /** 背景声相对路径 */
  accompaniment?: string | null
  /** 未分离时的混合原声 */
  mixed?: string | null
  separated: boolean
  note?: string
}

export interface EvidenceIndex {
  mediaFacts: MediaFacts
  shotsPath: string
  utterancesPath: string
  entitiesPath: string
  ocrPath: string
  stems?: AudioStems
  /** 证据内容哈希（重新分析时复用） */
  hashes: Record<string, string>
}

export interface ShotEvidenceFile {
  schema: SemanticEvidenceSchema
  shots: ShotEvidence[]
}

export interface UtteranceEvidenceFile {
  schema: SemanticEvidenceSchema
  utterances: UtteranceEvidence[]
}

export interface EntityEvidenceFile {
  schema: SemanticEvidenceSchema
  entities: Entity[]
}

export interface OcrEvidenceFile {
  schema: SemanticEvidenceSchema
  regions: OcrRegion[]
}

// ─── Structured 4-axis shot tree ────────────────────────────────────────────

/** 镜头语言（景别 / 机位角度 / 运镜 / 焦段） */
export interface ShotCamera {
  shotSize?: string
  angle?: string
  motion?: CameraAction
  lens?: string
}

/** 画面风格（光影 / 调色 / 画风 / 画面描述） */
export interface ShotVisual {
  description?: string
  style?: string
  lighting?: string
  grade?: string
  palette?: string[]
}

/** 镜头里的主体：绑定实体（符号表）+ 本镜动作 */
export interface ShotSubject {
  entityId?: string
  name: string
  action?: string
  emotion?: string
}

export type ShotTransition = 'cut' | 'fade' | 'dissolve' | 'wipe' | string

/**
 * 结构化镜头节点。
 * `sourceSegment` 指向原片的入/出点 —— 未修改镜头或受保护真实素材在重制时直接裁原片。
 */
export interface SemanticShot {
  id: string
  range: TimeRange
  /** 原片入/出点（秒）；删镜 / 重排后仍指向原片 */
  sourceSegment: { start: number; end: number }
  /** 相对 semantic 根的关键帧路径（同 ShotEvidence） */
  keyframes: { first?: string; middle?: string; last?: string; strip?: string }
  transitionIn?: ShotTransition
  camera: ShotCamera
  visual: ShotVisual
  subjects: ShotSubject[]
  /** 本镜内的台词 id（`dialogue[].id`） */
  dialogueIds: string[]
  /** 本镜内的画面文字 id（`textLayers[].id`） */
  textLayerIds: string[]
  /** 人工补充 / 覆盖本镜画面提示词（非空 = 视作修改，重制时重新生成） */
  promptOverride?: string
  /** 删除本镜（重制时跳过） */
  removed?: boolean
  origin: Origin
  locked?: boolean
  /** `rea-video` 确定性信号取证特征 */
  forensics?: ShotForensicFeatures
  /** `rea-video` 11 类底层制作分类 + 贝叶斯证据融合结果 */
  base?: ShotBaseClassification
  /** `rea-video` 素材真伪溯源（真实录屏/实拍素材 vs 可生成参考元素） */
  material?: ShotMaterialProvenance
  /** `rea-video` 纵向剪辑包装层（字幕 / 花字 / 标题 / 贴纸 / 画中画） */
  layers?: ShotLayerItem[]
  /** `rea-video` 分流复刻路由（video_gen / local_ffmpeg / reshoot / code_render / screen_record） */
  replication?: ShotReplicationRoute
}

/** 台词（结构化；`sourceText` 是分析时的原文，`text` 被改 → 重新配音） */
export interface DialogueLine {
  id: string
  range: TimeRange
  text: string
  /** 分析时的原文（修改检测与审计用） */
  sourceText: string
  speaker?: string
  words?: WordTiming[]
  granularity: 'word' | 'sentence'
  confidence: number
  origin: Origin
}

/** 说话人（符号表）：配音时用它的音色 */
export interface SpeakerProfile {
  id: string
  name: string
  /** TTS 音色 id（供应商 voice） */
  voice?: string
  /** 声音克隆参考音频（工程相对路径） */
  referenceAudio?: string
}

export type SemanticEditOp =
  | 'shot.update'
  | 'shot.remove'
  | 'shot.restore'
  | 'shot.prompt'
  | 'shot.split'
  | 'shot.merge'
  | 'unit.prompt'
  | 'dialogue.update'
  | 'entity.update'
  /** 局部替换：`patch.replacement`（null = 清除） */
  | 'entity.replace'
  | 'speaker.update'

/** 修改审计（文档字段已是修改后的状态；这里只记录"谁在何时改了什么"） */
export interface SemanticEdit {
  id: string
  op: SemanticEditOp
  target: string
  patch: Record<string, unknown>
  origin: Origin
  at: string
}

/**
 * 基线：分析时（含富化）每个镜头 / 台词的内容哈希。
 * 重制时把当前内容哈希与它比对，得到脏集合；没有基线的镜头一律视作未改。
 */
export interface SemanticBaseline {
  shots: Record<string, string>
  dialogue: Record<string, string>
  createdAt: string
}

// ─── Document ───────────────────────────────────────────────────────────────

export interface SemanticTimelineSource {
  assetId: string
  fps: number
  duration: number
  width: number
  height: number
}

export interface SemanticTimeline {
  id: string
  schema: SemanticTimelineSchema
  source: SemanticTimelineSource
  evidence: EvidenceIndex
  entities: Entity[]
  /** 结构化镜头树 */
  shots?: SemanticShot[]
  /** 全部台词（来自转写，可修改） */
  dialogue?: DialogueLine[]
  /** 画面文字层（OCR） */
  textLayers?: OcrRegion[]
  /** 说话人符号表 */
  speakers?: SpeakerProfile[]
  /** 修改审计 */
  edits?: SemanticEdit[]
  /** 分析基线（脏检测） */
  baseline?: SemanticBaseline
  /** `rea-video` 四轴逆向工程总表（容器溯源 + 声源取证 + 整片角色道具 + 分流复刻方案） */
  breakdown?: BreakdownAnalysis
  updatedAt: string
  createdAt: string
}
