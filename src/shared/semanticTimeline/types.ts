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
  /** 旧版"参考资产 id"（换人 / 换商品）；新代码写 `replacement`，读取时两者都认 */
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
  /** 局部替换：`patch.replacement`（null = 清除） */
  | 'entity.replace'
  | 'speaker.update'
  /** 语义层：改了会经语义指纹让覆盖的镜头重新生成（见 shotSemantics.ts） */
  | 'event.update'
  | 'event.remove'
  | 'beat.update'
  | 'intent.update'
  | 'intent.remove'

/** 修改审计（文档字段已是修改后的状态；这里只记录"谁在何时改了什么"） */
export interface SemanticEdit {
  id: string
  op: SemanticEditOp
  target: string
  patch: Record<string, unknown>
  origin: Origin
  at: string
  /**
   * 语义层修改：这次修改改变了哪些镜头的语义输入（应用时算好）。
   * 用于解释"为什么要重新生成"，以及重设基线时保留这些镜头的旧指纹。
   */
  affectedShots?: string[]
}

/**
 * 基线：分析时（含富化）每个镜头 / 台词的内容哈希。
 * 编译把当前内容哈希与它比对，得到脏集合；没有基线的镜头一律视作未改。
 */
export interface SemanticBaseline {
  shots: Record<string, string>
  dialogue: Record<string, string>
  /**
   * 每镜的**语义输入**指纹（覆盖本镜的事件 / 节拍 / 意图，见 `shotSemanticSignature`）。
   * 可选：旧文档没有它，加载时补齐；缺省时语义层改动不参与脏检测。
   */
  semantic?: Record<string, string>
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
  /** 缺省 = 分析产出；用户改过为 'user'（重新分析时据此保留修改） */
  origin?: Origin
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
