/**
 * Semantic Timeline — `aiart.semantic-timeline@1`
 *
 * 三层模型：证据层（Evidence）→ 语义层（Events/Beats/Intents/Edits）→ 生产层（Plan/ScriptTimeline/Build）。
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

/** 保真等级（完美复刻的可度量定义） */
export type FidelityLevel = 'L0' | 'L1' | 'L2' | 'L3'

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

// ─── Edits ──────────────────────────────────────────────────────────────────

export type SemanticEditKind =
  | 'replaceEntity'
  | 'removeEntity'
  | 'rewriteUtterance'
  | 'revoice'
  | 'editText'
  | 'retimeBeat'
  | 'reorderBeats'
  | 'dropBeat'
  | 'regenerateShot'
  | 'fixFrames'
  | 'grade'
  | 'audioFix'
  | 'applyIntent'

export interface SemanticEditBase {
  id: string
  kind: SemanticEditKind
  origin: Origin
  createdAt: string
  note?: string
}

export interface ReplaceEntityEdit extends SemanticEditBase {
  kind: 'replaceEntity'
  entityId: string
  newAssetId: string
  /** person 时可只换脸 */
  faceOnly?: boolean
}

export interface RemoveEntityEdit extends SemanticEditBase {
  kind: 'removeEntity'
  entityId: string
}

export interface RewriteUtteranceEdit extends SemanticEditBase {
  kind: 'rewriteUtterance'
  utteranceId: string
  newText: string
  voiceId?: string
  lipSync?: boolean
}

export interface RevoiceEdit extends SemanticEditBase {
  kind: 'revoice'
  language?: string
  voiceId?: string
  lipSync?: boolean
}

export interface EditTextEdit extends SemanticEditBase {
  kind: 'editText'
  regionId: string
  newText: string
}

export interface RetimeBeatEdit extends SemanticEditBase {
  kind: 'retimeBeat'
  beatId: string
  timeRange: TimeRange
}

export interface ReorderBeatsEdit extends SemanticEditBase {
  kind: 'reorderBeats'
  beatIds: string[]
}

export interface DropBeatEdit extends SemanticEditBase {
  kind: 'dropBeat'
  beatId: string
}

export interface RegenerateShotEdit extends SemanticEditBase {
  kind: 'regenerateShot'
  shotId: string
  prompt?: string
}

export interface FixFramesEdit extends SemanticEditBase {
  kind: 'fixFrames'
  shotId: string
  frameIndices: number[]
  prompt?: string
}

export interface GradeEdit extends SemanticEditBase {
  kind: 'grade'
  shotIds?: string[]
  params: Record<string, unknown>
}

export interface AudioFixEdit extends SemanticEditBase {
  kind: 'audioFix'
  params: Record<string, unknown>
}

export interface ApplyIntentEdit extends SemanticEditBase {
  kind: 'applyIntent'
  intent: DirectorIntent
}

export type SemanticEdit =
  | ReplaceEntityEdit
  | RemoveEntityEdit
  | RewriteUtteranceEdit
  | RevoiceEdit
  | EditTextEdit
  | RetimeBeatEdit
  | ReorderBeatsEdit
  | DropBeatEdit
  | RegenerateShotEdit
  | FixFramesEdit
  | GradeEdit
  | AudioFixEdit
  | ApplyIntentEdit

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
  edits: SemanticEdit[]
  vocabulary?: string
  updatedAt: string
  createdAt: string
}

// ─── Production / Build ─────────────────────────────────────────────────────

export type PlanAction = 'keep' | 'replace' | 'recompute'

export interface PlanItem {
  productId: string
  action: PlanAction
  reason: string
  /** 付费生成秒数；本地处理为 0 */
  paidSeconds?: number
  localOnly?: boolean
}

export interface CostEstimate {
  paidSeconds: number
  localShotCount: number
  paidShotCount: number
  note?: string
}

export interface InvalidationPlan {
  items: PlanItem[]
  cost: CostEstimate
  targetLevel: FidelityLevel
}

export interface BuildDefinition {
  id: string
  timelineId: string
  timelineVersionHash: string
  editIds: string[]
  plan: InvalidationPlan
  frozenAt: string
}

export interface BuildQcResult {
  level: FidelityLevel
  passed: boolean
  metrics: {
    psnrOutsideMask?: number
    ssimOutsideMask?: number
    frameDelta?: number
    audioSampleMatch?: boolean
    durationMatch?: boolean
  }
  failedShotIds?: string[]
  notes?: string[]
}

export interface BuildManifest {
  id: string
  definitionId: string
  status: 'pending' | 'running' | 'done' | 'failed' | 'cancelled'
  startedAt: string
  finishedAt?: string
  outputAssetId?: string
  outputRelativePath?: string
  shotActions: { shotId: string; action: 'copy' | 'mask_replace' | 'regenerate' | 'skip' }[]
  qc?: BuildQcResult
  error?: string
  reusedEvidence?: string[]
  /** 执行链的降级/跳过说明（如缺掩码、缺 TTS） */
  notes?: string[]
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

export interface VariantSlot {
  key: string
  kind: 'asset' | 'text' | 'voice' | 'language'
  label: string
}

export interface VariantRecipe {
  id: string
  title: string
  slots: VariantSlot[]
  /** 模板化 edits；槽位用 {{key}} 占位 */
  editTemplates: Array<Partial<SemanticEdit> & { kind: SemanticEditKind }>
  targetLevel: FidelityLevel
}

export interface SemanticPack {
  schemaVersion: 1
  id: string
  title: string
  kind: 'vocabulary' | 'rules' | 'recipe' | 'persona'
  vocabulary?: BeatVocabulary
  rules?: DirectorRulePack
  recipe?: VariantRecipe
  persona?: { id: string; title: string; systemPrompt: string }
}
