/**
 * Semantic Timeline — `aiart.semantic-timeline@1`
 *
 * 新管线三层：证据层（Evidence）→ 语义层（Events/Beats/Intents）→ 生产层
 * （提示词计划 → 重建片段）。旧「编辑列表 / 变体配方 / 失效计划 / 冻结构建」
 * 那一层已随四个旧节点删除，这里不再有 `Edits` / `Plan` / `Build` 契约。
 * 本文件只含类型；校验与纯算法见同目录其它模块。
 */

export const SEMANTIC_TIMELINE_SCHEMA = 'aiart.semantic-timeline@1' as const
export type SemanticTimelineSchema = typeof SEMANTIC_TIMELINE_SCHEMA

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
  schema: SemanticTimelineSchema
  shots: ShotEvidence[]
}

export interface UtteranceEvidenceFile {
  schema: SemanticTimelineSchema
  utterances: UtteranceEvidence[]
}

export interface EntityEvidenceFile {
  schema: SemanticTimelineSchema
  entities: Entity[]
}

export interface OcrEvidenceFile {
  schema: SemanticTimelineSchema
  regions: OcrRegion[]
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
