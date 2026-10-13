/**
 * Semantic Timeline — `aiart.semantic-timeline@2`（视频语义中间表示，VSIR）
 *
 * 借鉴编译原理的逆向视频工程：
 *   前端（语义分析）  原视频 → 证据层（Evidence）+ 结构化镜头树（shots / dialogue / textLayers）
 *   中间表示          本文档；用户/agent 的修改直接改字段，并记一条 `edits` 审计
 *   中端（语义编译）  与 `baseline`（分析时的内容哈希）比对得出**脏镜头 / 脏台词**
 *   后端（语义重建）  未改镜头直通原片段、改过的镜头生成、改过的台词重新配音
 *
 * 不变量：零修改时 `rebuild(compile(analyze(V)))` 逐镜直通，还原原片。
 *
 * v1 → v2：v1 文档没有内联镜头树 / 台词 / 基线；读入时由 `migrateSemanticTimeline`
 * 自动补齐（见 `migrate.ts`）。本文件只含类型。
 */

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

export type SemanticEventType =
  'story' | 'character' | 'camera' | 'emotion' | 'audio' | 'text' | 'product'

export type SemanticTrackKind =
  'story' | 'character' | 'camera' | 'emotion' | 'audio' | 'text' | 'vfx' | 'edit'

export type EntityKind = 'person' | 'product' | 'object' | 'text' | 'logo' | 'background' | 'voice'

export type DirectorGoal = 'emphasize' | 'reveal' | 'build_tension' | 'clarify' | 'sell' | string

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
  /** 相对 semantic 根的关键帧路径（首/中/尾） */
  keyframes: { first?: string; middle?: string; last?: string }
  /** 切镜置信度 0..1 */
  confidence: number
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
  reference?: { assetId: string }
  /** 只有带检测框或掩码的实体才允许像素级替换 */
  pixelEditable: boolean
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

// ─── Structured shot tree (v2) ──────────────────────────────────────────────

/** 镜头语言（结构化；以前只在 LLM 富化时拼成一句话、用完即丢） */
export interface ShotCamera {
  /** 景别：特写 / 近景 / 中景 / 全景 … */
  shotSize?: string
  /** 机位角度：平视 / 俯拍 / 仰拍 … */
  angle?: string
  /** 运镜 */
  motion?: CameraAction
  /** 焦段 / 镜头提示 */
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
 * 结构化镜头节点（VSIR 的"语句"）。
 *
 * `sourceSegment` 指向原片的入/出点 —— 未修改的镜头在重建时**直接裁原片**，这是
 * "零修改还原原片"的根据；被修改的镜头才交给生成模型。
 */
export interface SemanticShot {
  id: string
  range: TimeRange
  /** 原片入/出点（秒）；删镜 / 重排后仍指向原片 */
  sourceSegment: { start: number; end: number }
  /** 相对 semantic 根的关键帧路径（同 ShotEvidence） */
  keyframes: { first?: string; middle?: string; last?: string }
  transitionIn?: ShotTransition
  camera: ShotCamera
  visual: ShotVisual
  subjects: ShotSubject[]
  /** 本镜内的台词 id（`dialogue[].id`） */
  dialogueIds: string[]
  /** 本镜内的画面文字 id（`textLayers[].id`） */
  textLayerIds: string[]
  /** 人工补充 / 覆盖本镜画面提示词（非空 = 视作修改，重建时重新生成） */
  promptOverride?: string
  /** 删除本镜（重建时跳过） */
  removed?: boolean
  origin: Origin
  locked?: boolean
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
  | 'dialogue.update'
  | 'entity.update'
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
 * 编译把当前内容哈希与它比对，得到脏集合；没有基线的镜头一律视作未改。
 */
export interface SemanticBaseline {
  shots: Record<string, string>
  dialogue: Record<string, string>
  createdAt: string
}

// ─── Semantic layer ─────────────────────────────────────────────────────────

export interface SemanticEvent {
  id: string
  timeRange: TimeRange
  type: SemanticEventType
  /** 机器可读标签，如 dramatic_reveal / price_announce */
  label: string
  description: string
  importance: number
  entities: string[]
  evidence: string[]
  intents: string[]
  confidence: number
  origin: Origin
  locked?: boolean
}

export interface StoryBeat {
  id: string
  type: string
  vocabulary: string
  timeRange: TimeRange
  emotion: { label: string; intensity: number }
  description: string
  events: string[]
}

export interface IntentTechnique {
  track: SemanticTrackKind
  action: string
  params?: Record<string, unknown>
}

export interface DirectorIntent {
  id: string
  /** 事件 ID 或事件 label */
  trigger: string
  goal: DirectorGoal
  techniques: IntentTechnique[]
  reason: string
  origin: Origin
}

export interface SemanticTrack {
  kind: SemanticTrackKind
  items: string[]
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
  events: SemanticEvent[]
  beats: StoryBeat[]
  intents: DirectorIntent[]
  tracks: SemanticTrack[]
  vocabulary?: string
  /** v2：结构化镜头树（迁移 / 分析时由证据内联） */
  shots?: SemanticShot[]
  /** v2：全部台词（来自转写，可修改） */
  dialogue?: DialogueLine[]
  /** v2：画面文字层（OCR） */
  textLayers?: OcrRegion[]
  /** v2：说话人符号表 */
  speakers?: SpeakerProfile[]
  /** v2：修改审计 */
  edits?: SemanticEdit[]
  /** v2：分析基线（脏检测） */
  baseline?: SemanticBaseline
  updatedAt: string
  createdAt: string
}

// ─── Market packs (data only) ───────────────────────────────────────────────

export interface BeatVocabulary {
  id: string
  title: string
  beats: { type: string; label: string; description?: string }[]
}

export interface DirectorRule {
  id: string
  when: {
    eventLabel?: string
    beatType?: string
    emotion?: string
  }
  then: IntentTechnique[]
  reason?: string
}

export interface DirectorRulePack {
  id: string
  title: string
  rules: DirectorRule[]
}

export interface SemanticPack {
  schemaVersion: 1
  id: string
  title: string
  kind: 'vocabulary' | 'rules' | 'persona'
  vocabulary?: BeatVocabulary
  rules?: DirectorRulePack
  persona?: { id: string; title: string; systemPrompt: string }
}
