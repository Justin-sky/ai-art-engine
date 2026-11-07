/**
 * 画布节点 ↔ 主进程语义管线的 IPC 契约（纯类型）。
 * 路径一律为工程相对路径（正斜杠）；主进程负责解析为绝对路径。
 */
import type { SemanticTimeline, ShotEvidence, UtteranceEvidence } from './types'

export interface SemanticAnalyzeRequest {
  /** 源视频资产 id（优先；同时用于把 semanticTimelineId 写回资产） */
  sourceAssetId?: string
  /** 工程相对视频路径（无资产时，如上游生成的视频文件） */
  videoRelativePath?: string
  /** 调转写模型拿话语证据（默认 true；失败降级为无话语） */
  transcribe?: boolean
  transcribeProviderInstanceId?: string
  transcribeModel?: string
  separateAudio?: boolean
  entityProviderInstanceId?: string
  entityModel?: string
  detectEntities?: boolean
}

export interface SemanticAnalyzeResponse {
  timeline: SemanticTimeline
  shots: ShotEvidence[]
  utterances: UtteranceEvidence[]
  /** shotId → 中帧（缺省首帧）工程相对路径，供 VLM 看图 */
  keyframes: Record<string, string>
  sourceRelativePath: string
  method: 'scene' | 'fallback-single'
  notes: string[]
}

export interface SemanticEvidenceResponse {
  shots: ShotEvidence[]
  utterances: UtteranceEvidence[]
  keyframes: Record<string, string>
  /** 源视频工程相对路径（可从资产解析时给出） */
  sourceRelativePath?: string
}

/**
 * 成片段：`source` = 直通原片入/出点；`generate` = 生成片段（对齐到 `durationSec`）。
 * 支持跨镜合批单元（`G1..Gk`）通过 `clipOffsetRatio` + `clipDurationRatio` 从单段单元视频按比例回切本镜片段。
 */
export interface SemanticRebuildSegment {
  key: string
  kind: 'source' | 'generate'
  durationSec: number
  relativePath?: string
  /** 跨镜生成单元内的起始比例（0..1，如 `shot.3` 在 `G1` 的后半段 = 0.5） */
  clipOffsetRatio?: number
  /** 跨镜生成单元内的时长比例（0..1，如 `shot.1` 占 `G1` 的一半 = 0.5） */
  clipDurationRatio?: number
  sourceStartSec?: number
  sourceEndSec?: number
  /** 时长对齐策略：stretch=双向变速对齐；trim=超长截断/不足冻结尾帧；缺省=auto */
  fitMode?: 'auto' | 'stretch' | 'trim'
}

/** 重新配音的台词：合成好的音频 + 它替换的原片时间段 */
export interface SemanticRebuildDub {
  id: string
  relativePath: string
  sourceStartSec: number
  sourceEndSec: number
}

export interface SemanticRebuildLocalMotionClip {
  key: string
  mode: 'ken_burns' | 'static_hold'
  durationSec: number
  anchorImageRelativePath: string
  zoomPerSec: number
  panPxPerSec: number
  panDirDeg: number
}

export interface SemanticPackagingOverlayCue {
  sourceStartSec: number
  sourceEndSec: number
  text: string
  kind: 'title' | 'huazi' | 'label' | 'subtitle'
  position?: 'top' | 'middle' | 'bottom'
}

export interface SemanticRebuildRequest {
  timelineId: string
  /** 生成片段清单（key → 工程相对路径；支持单元 key 如 `G1` 或镜头 key） */
  clips: Array<{ key: string; relativePath: string }>
  /** 按输出顺序的全部段（含直通原片段与跨镜切片参数） */
  segments?: SemanticRebuildSegment[]
  /** 重新配音（原片时间轴上替换人声） */
  dubs?: SemanticRebuildDub[]
  /** 字幕（修改后的台词，原片时间）；缺省用转写证据 */
  subtitles?: Array<{ sourceStartSec: number; sourceEndSec: number; text: string }>
  /** 竖向包装/花字/顶部标题层（原片时间，成片以 ASS 分层动态样式烧录还原） */
  packagingOverlays?: SemanticPackagingOverlayCue[]
  /** 输出文件名后缀（重跑/多版本区分） */
  label?: string
  /** 保留原片音轨（默认 true） */
  keepAudio?: boolean
  sourceRelativePath?: string
  /** 烧录转写字幕（默认 true） */
  burnSubtitles?: boolean
  /** 同时输出 `Original | Remake` 同步并排对比视频 `compare.mp4`（默认 true） */
  renderCompare?: boolean
  /** 零成本本地 FFmpeg 推拉/静帧片段描述（由主进程在拼接前直接由关键帧渲染） */
  localMotionClips?: SemanticRebuildLocalMotionClip[]
  width?: number
  height?: number
  fps?: number
}

export interface SemanticRebuildResponse {
  ok: boolean
  outputRelativePath?: string
  /** 原片与重制成片的同步并排对比视频（`Semantic/<id>/rebuilds/<runId>/compare.mp4`） */
  compareRelativePath?: string
  manifestRelativePath: string
  clipCount: number
  /** 本地零成本 FFmpeg 推拉/静帧渲染的镜头数 */
  localClipCount?: number
  /** 直通原片的段数 / 实际混入的配音句数 */
  passthroughCount?: number
  dubCount?: number
  burnedSubtitles: number
  keptAudio: boolean
  notes: string[]
  error?: string
}
