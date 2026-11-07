/**
 * Video Reverse-Engineering & Remake IR (`rea-video` paradigm for `aiart.semantic-timeline@2`).
 *
 * Orthogonal 4-axis video breakdown:
 *   1. Base picture production taxonomy (11 classes + AI edits on filmed footage + calibrated probabilities)
 *   2. Vertical packaging & overlay separation (subtitles, huazi/styled text, titles, stickers, PiP vs scene text)
 *   3. Material provenance & cross-shot cast (embedded real user assets vs lockable `@image` generation references)
 *   4. Multi-track audio forensics & probabilistic source attribution (voice, music, SFX + cut noise-floor jump)
 *
 * Every claim carries explicit signal/VLM evidence; unresolved ambiguities surface as open questions.
 */

export const BASE_PRODUCTION_LABELS = [
  'live_action',
  'ai_video',
  'avatar',
  'cg_3d',
  'code_render',
  'screen_capture',
  'still_motion',
  'static_hold',
  'anim_2d',
  'stop_motion',
  'film_footage'
] as const

export type ProductionBaseLabel = (typeof BASE_PRODUCTION_LABELS)[number]

export const AI_EDIT_KINDS = [
  'face_swap',
  'lip_sync',
  'restyle',
  'outfit_swap',
  'bg_replace',
  'object_edit',
  'beautify'
] as const

export type AiEditKind = (typeof AI_EDIT_KINDS)[number]

export type BreakdownLang = 'zh' | 'en'

export const PRODUCTION_LABEL_META: Record<
  ProductionBaseLabel,
  { zh: string; en: string; color: string; shortZh: string; shortEn: string }
> = {
  live_action: {
    zh: '实拍画面', // cjk-ok
    en: 'Live action',
    shortZh: '实拍', // cjk-ok
    shortEn: 'Live',
    color: '#2a9d8f'
  },
  ai_video: {
    zh: 'AI 生成视频', // cjk-ok
    en: 'AI generated video',
    shortZh: 'AI 视频', // cjk-ok
    shortEn: 'AI video',
    color: '#7c5cff'
  },
  avatar: {
    zh: '数字人口播', // cjk-ok
    en: 'AI avatar / talking head',
    shortZh: '数字人', // cjk-ok
    shortEn: 'Avatar',
    color: '#e76f51'
  },
  cg_3d: {
    zh: '3D 渲染', // cjk-ok
    en: '3D CG render',
    shortZh: '3D 渲染', // cjk-ok
    shortEn: '3D CG',
    color: '#3a86ff'
  },
  code_render: {
    zh: '代码/模板渲染 (MG/UI/图表)', // cjk-ok
    en: 'Code / template render (MG/UI)',
    shortZh: '代码渲染', // cjk-ok
    shortEn: 'Code MG',
    color: '#00b4d8'
  },
  screen_capture: {
    zh: '录屏/软件实操', // cjk-ok
    en: 'Screen capture',
    shortZh: '录屏', // cjk-ok
    shortEn: 'Screen',
    color: '#457b9d'
  },
  still_motion: {
    zh: '静态图推拉 (Ken Burns)', // cjk-ok
    en: 'Still image zoom/pan (Ken Burns)',
    shortZh: '静态推拉', // cjk-ok
    shortEn: 'Ken Burns',
    color: '#f4a261'
  },
  static_hold: {
    zh: '静帧停留', // cjk-ok
    en: 'Static frame hold',
    shortZh: '静帧', // cjk-ok
    shortEn: 'Static',
    color: '#8d99ae'
  },
  anim_2d: {
    zh: '2D 动画/手绘', // cjk-ok
    en: '2D animation',
    shortZh: '2D 动画', // cjk-ok
    shortEn: '2D anim',
    color: '#ff6b9d'
  },
  stop_motion: {
    zh: '定格动画', // cjk-ok
    en: 'Stop motion',
    shortZh: '定格', // cjk-ok
    shortEn: 'Stop-mo',
    color: '#bc6c25'
  },
  film_footage: {
    zh: '影视/番剧片段', // cjk-ok
    en: 'Film / broadcast footage',
    shortZh: '影视片段', // cjk-ok
    shortEn: 'Film clip',
    color: '#6d597a'
  }
}

export const AI_EDIT_META: Record<AiEditKind, { zh: string; en: string }> = {
  face_swap: { zh: 'AI 换脸', en: 'Face swap' }, // cjk-ok
  lip_sync: { zh: 'AI 改口型', en: 'AI lip-sync' }, // cjk-ok
  restyle: { zh: '视频转绘', en: 'Video restyle' }, // cjk-ok
  outfit_swap: { zh: 'AI 换装', en: 'Outfit swap' }, // cjk-ok
  bg_replace: { zh: 'AI 换背景', en: 'Background replace' }, // cjk-ok
  object_edit: { zh: '局部物体编辑', en: 'Object edit' }, // cjk-ok
  beautify: { zh: '重度磨皮美颜', en: 'Heavy beauty filter' } // cjk-ok
}

// ─── Container & Metadata Provenance ──────────────────────────────────────────

export interface AigcImplicitLabel {
  /** GB 45438-2025 Label: '1' = generated, '2' = possible AI, '3' = assisted */
  label?: string
  contentProducer?: string
  produceId?: string
  reservedCode1?: string
  contentPropagator?: string
  propagateId?: string
  rawJson?: string
}

export interface ContainerProvenance {
  containerFormat?: string
  encoder?: string
  make?: string
  model?: string
  creationTime?: string
  aigcImplicitLabel?: AigcImplicitLabel
  hasC2pa?: boolean
  /** Kling / Jimeng / Seedance / Hailuo / Veo / Sora / Wan / Runway / Pika / PixVerse / Vidu */
  generatorHint?: string
  /** CapCut / Jianying / Premiere / Final Cut / DaVinci / Remotion / Blender / After Effects */
  editorHint?: string
  /** WeChat / Douyin / Bilibili / Xiaohongshu / YouTube */
  platformTranscode?: string
  evidence: string[]
}

// ─── Per-Shot Deterministic Forensics & Aspects ───────────────────────────────

export type CameraMotionForensicKind =
  'static' | 'static_with_subject_motion' | 'planar_zoom_pan' | 'handheld_like' | 'smooth_move'

export interface FramingAspectMeasured {
  subjectKind?: 'face' | 'focus' | 'frame'
  centerX?: number
  centerY?: number
  area?: number
  shotSize?: 'ecu' | 'cu' | 'mcu' | 'ms' | 'fs' | 'ls'
  position?: 'centred' | 'left' | 'right'
  cameraAngle?: string
}

export interface CameraAspectMeasured {
  support?: 'handheld' | 'moving' | 'fixed'
  move?: 'push_in' | 'pull_out' | 'pan_track' | 'static'
  shake?: number
  lens?: string
  speed?: string
}

export interface LightingAspectMeasured {
  ratio?: number
  keySide?: 'left' | 'right'
  topBottom?: number
  transition?: number | null
  subjectLuma?: number
  bgLuma?: number | null
  darkShare?: number
  warmth?: number
  bgWarmth?: number | null
  bgBlur?: number | null
  pointLights?: number
  bgStd?: number | null
  setupKey?: string
  setupName?: string
  setupDetail?: string
  keyDirection?: string
  quality?: string
  colorTemp?: string
  gear?: string[]
}

export interface GradeAspectMeasured {
  sat?: number
  contrast?: number
  black?: number
  white?: number
  shadowB?: number
  highlightB?: number
  meanB?: number
  meanL?: number
  brightShare?: number
  darkShare?: number
  brightSat?: number
  hueBins?: number
  lookKey?:
    | 'monochrome'
    | 'teal_orange'
    | 'airy_japanese'
    | 'vintage_film'
    | 'dark_cinematic'
    | 'vivid'
    | 'natural'
  look?: string
}

export interface ShotForensicFeatures {
  /** Immerkær high-frequency Laplacian noise estimate */
  noiseSigma?: number
  /** Inter-frame static-patch temporal noise */
  temporalNoise?: number
  /** Share of 8x8 blocks with near-zero internal variance (UI / flat vector grounds) */
  flatRatio?: number
  flatLit?: number
  darkShare?: number
  darkStd?: number
  /** Number of 4-bit RGB bins covering 95% of pixels (low = flat vector/UI palette) */
  palette95?: number
  /** Ratio of purely horizontal/vertical Sobel edges (high = UI/code/screenshots) */
  axisEdgeRatio?: number
  /** Bright thin strokes / particles on dark ground */
  fineDark?: number
  /** Dark thin lineart on light ground */
  fineLight?: number
  /** Smooth gradient / shader vector fills without sensor grain */
  vectorFill?: number
  /** Top/bottom black/white matte bar share */
  letterbox?: number
  /** Dominant hex colors sampled from keyframe */
  dominantHexPalette?: string[]
  /** Normalized 24-bin HSV signature for cross-shot scene clustering */
  hsvHist?: number[]
  /** Mean pixel absolute diff (0..255) across sampled frames in the shot */
  meanFrameDiff?: number
  /** Duplicate frame ratio (0..1) */
  dupRatio?: number
  /** Detected telecine/framerate pulldown cadence */
  pulldown?: '24->30' | '24->60' | null
  cameraMotionKind?: CameraMotionForensicKind
  /** Inlier fit quality (0..1) of uniform scale + translation across the frame */
  kenburnsScore?: number
  /** Fractional zoom per second (+ = push-in, - = pull-out) */
  zoomPerSec?: number
  /** Pan speed in normalized frame widths per second */
  panPxPerSec?: number
  /** Pan direction in degrees (0 = right, 90 = down, 180 = left, -90 = up) */
  panDirDeg?: number
  /** Motion direction sign-flip rate (high = handheld shake) */
  signFlipRate?: number
  /** High-edge static overlay boxes frozen across frames while background moves (burned-in subtitles/huazi/logos) */
  frozenOverlayBoxes?: Array<{
    x: number
    y: number
    w: number
    h: number
    band: 'top' | 'middle' | 'bottom'
  }>
  aspects?: {
    framing?: FramingAspectMeasured
    camera?: CameraAspectMeasured
    lighting?: LightingAspectMeasured
    grade?: GradeAspectMeasured
  }
}

// ─── Per-Shot Classification, Layers, Material & Replication Route ────────────

export interface ShotAiEditDetection {
  kind: AiEditKind
  confidence: number
  evidence: string
}

export interface ShotBaseClassification {
  label: ProductionBaseLabel
  probs: Partial<Record<ProductionBaseLabel, number>>
  confidence: number
  decidedBy: 'deterministic' | 'vlm_fused' | 'review_override'
  disputed?: boolean
  uncertain?: boolean
  reviewOverrideLabel?: ProductionBaseLabel
  vlmProbs?: Partial<Record<ProductionBaseLabel, number>>
  vlmEvidence?: string[]
  aiEdits?: ShotAiEditDetection[]
  evidence: string[]
}

export type ShotLayerKind =
  | 'subtitle'
  | 'huazi'
  | 'title'
  | 'label'
  | 'counter'
  | 'scene_text'
  | 'animated_sticker'
  | 'static_sticker'
  | 'pip'

export interface ShotLayerItem {
  id: string
  kind: ShotLayerKind
  text?: string
  start: number
  end: number
  position?: 'top' | 'middle' | 'bottom'
  box?: { x: number; y: number; w: number; h: number }
  style?: {
    fill?: string
    stroke?: string
    boxColor?: string
    animationIn?: 'cut' | 'pop' | 'fade' | 'slide' | 'reveal'
  }
}

export interface ShotMaterialItem {
  kind: string
  description: string
  /** true = real recorded/photographed asset that cannot be faked by gen-AI; null = uncertain */
  realMaterial: boolean | null
}

export interface ShotMaterialProvenance {
  origin: 'generated' | 'filmed' | 'recorded' | 'rendered' | 'mixed'
  items: ShotMaterialItem[]
  references: Array<{
    kind: 'character' | 'scene' | 'prop' | 'style'
    entityId?: string
    tag?: string
    note?: string
  }>
}

export type RemakeExecutorKind =
  | 'video_gen'
  | 'local_ffmpeg'
  | 'reshoot'
  | 'screen_record'
  | 'code_render'
  | 'avatar_tts'
  | 'passthrough'

export type CodeRenderStyleKind =
  'particles' | 'lineart' | 'procedural' | 'neon' | 'data' | 'ui' | 'gradient' | 'type' | 'shapes'

export interface ShotReplicationRoute {
  ruleId: string
  executor: RemakeExecutorKind
  mode?: 'first_last_frame' | 'image_to_video' | 'reference_video' | 'ken_burns' | 'static_hold'
  unitId?: string
  codeStyle?: CodeRenderStyleKind
  imagePrompt?: string
  videoPrompt?: string
  remakeNotes?: string[]
}

// ─── Audio Forensics & Sound Source Attribution ───────────────────────────────

export interface PerClipAudioJump {
  atCutsDb: number
  withinShotsDb: number
  ratio: number
  /** true when noise floor / spectral bed jumps sharply at shot cuts (characteristic of per-clip AI native audio) */
  resetsAtCuts: boolean
}

export interface SoundSourceVerdict {
  source: string
  sourceZh: string
  sourceEn: string
  probs: Record<string, number>
  confidence: number
  evidence: string[]
  howToConfirm: string[]
}

export interface AudioForensicAnalysis {
  hasAudio: boolean
  rmsDbfs?: number
  peakDbfs?: number
  perClipAudio?: PerClipAudioJump
  voice: {
    present: boolean
    speechRatio: number
    f0MedianHz?: number
    pitchCv?: number
    genderHint?: 'male' | 'female' | 'unclear'
    sung?: boolean
  }
  music: {
    present: boolean
    bpm?: number
    key?: string
    beatSyncedCutRatio?: number
    ending?: 'natural_end' | 'fade_out' | 'hard_cut'
    style?: string
    mood?: string
    instruments?: string[]
  }
  sfx: {
    present: boolean
    events: Array<{
      time: number
      kind: string
      syncedTo?: 'cut' | 'text_pop' | 'action'
      source: 'deterministic' | 'vlm' | 'merged'
    }>
  }
  soundSources?: {
    summaryZh: string
    summaryEn: string
    voice?: SoundSourceVerdict
    music?: SoundSourceVerdict
    sfx?: SoundSourceVerdict
  }
}

// ─── Whole-Video Narrative, Cast & Production Plan ────────────────────────────

export interface CastCharacterSpec {
  id: string
  entityId?: string
  name: string
  kind: 'human' | 'character' | 'avatar' | 'animal'
  look: string
  role?: string
  voice?: string
  refTag: string
  shotIds: string[]
}

export interface CastSceneSpec {
  id: string
  where: string
  when?: string
  look: string
  shotIds: string[]
}

export interface CastPropSpec {
  id: string
  entityId?: string
  name: string
  note?: string
  realMaterial?: boolean
  refTag?: string
  shotIds: string[]
}

export interface WholeVideoAnalysis {
  summary?: string
  format?: string
  hook?: string
  overallProduction?: string
  segments?: Array<{
    start: number
    end: number
    beat: string
    copy?: string
    audio?: string
  }>
  narration?: {
    type?: 'tts' | 'human' | 'mixed' | 'none'
    voice?: string
    style?: string
  }
  cast?: {
    characters: CastCharacterSpec[]
    scenes: CastSceneSpec[]
    props: CastPropSpec[]
  }
  openQuestions: string[]
}

export interface GenerationUnit {
  /** e.g. G1, G2 */
  id: string
  shotIds: string[]
  /** Non-generative shots bridged inside the same scene (e.g. a 1.5s UI insert between two shots of Scene S1) */
  bridgedInsertShotIds?: string[]
  sceneHeader: string
  conditioningMode: 'first_last_frame' | 'image_to_video' | 'reference_video'
  referenceTags: string[]
  durationSec: number
  imagePrompt: string
  videoPrompt: string
  /** True when user manually edited this unit's imagePrompt or videoPrompt */
  userEditedPrompt?: boolean
  perShotPrompts: Array<{
    shotId: string
    durationSec: number
    imagePrompt: string
    videoPrompt: string
  }>
  estimatedApiCalls: number
}

export interface ShootingSetup {
  /** e.g. S1, S2 */
  id: string
  shotIds: string[]
  sceneLabel: string
  shotSize?: string
  cameraSupport?: string
  lightingSetup?: string
  lightingDetail?: string
  gear: string[]
  aiFallbackPrompt?: string
}

export interface CodeCompositionSpec {
  /** e.g. C1, C2 */
  id: string
  shotIds: string[]
  codeStyle: CodeRenderStyleKind
  durationSec: number
  palette: string[]
  textTracks: string[]
  recipeZh: string
  recipeEn: string
}

export interface LocalMotionUnit {
  /** e.g. K1, K2 */
  id: string
  shotId: string
  mode: 'ken_burns' | 'static_hold'
  durationSec: number
  anchorKeyframePath?: string
  zoomPerSec: number
  panPxPerSec: number
  panDirDeg: number
}

export interface ReaProductionPlan {
  mode: 'fidelity' | 'adapt'
  units: GenerationUnit[]
  shootingSetups: ShootingSetup[]
  codeSpecs: CodeCompositionSpec[]
  localUnits: LocalMotionUnit[]
  userAssetsNeeded: Array<{
    shotId: string
    kind: string
    description: string
  }>
  summaryZh: string
  summaryEn: string
}

export interface BreakdownSummary {
  verdict: string
  verdictEn: string
  confidence: number
  decidedBy: 'deterministic' | 'deterministic+vlm' | 'deterministic+vlm+review'
  vlmStatus: {
    used: boolean
    shotModel?: string
    wholeVideoUsed?: boolean
    describedShots?: number
    failedShots?: number
    note?: string
  }
  shotCount: number
  avgShotSec: number
  transitions: Record<string, number>
  productionMix: Array<{
    label: ProductionBaseLabel
    labelZh: string
    labelEn: string
    seconds: number
    ratio: number
  }>
  storyboardRelativePath?: string
  reportRelativePath?: string
}

export interface UnitPromptOverride {
  imagePrompt?: string
  videoPrompt?: string
}

export interface BreakdownAnalysis {
  version: 'rea-breakdown@1'
  provenance: ContainerProvenance
  audioAnalysis?: AudioForensicAnalysis
  wholeVideo?: WholeVideoAnalysis
  summary: BreakdownSummary
  productionPlan: ReaProductionPlan
  /** User prompt overrides keyed by GenerationUnit id (`G1`, `G2`, ...) */
  unitPromptOverrides?: Record<string, UnitPromptOverride>
}
