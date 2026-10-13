/**
 * 画布节点 ↔ 主进程语义管线的 IPC 契约（纯类型）。
 * 路径一律为工程相对路径（正斜杠）；主进程负责解析为绝对路径。
 */
import type { SemanticPack, SemanticTimeline, ShotEvidence, UtteranceEvidence } from './types'

export interface SemanticAnalyzeRequest {
  /** 源视频资产 id（优先；同时用于把 semanticTimelineId 写回资产） */
  sourceAssetId?: string
  /** 工程相对视频路径（无资产时，如上游生成的视频文件） */
  videoRelativePath?: string
  vocabulary?: string
  /** 调转写模型拿话语证据（默认 true；失败降级为无话语） */
  transcribe?: boolean
  /**
   * 转写用的提供商实例 / 模型（可选）。
   *
   * 不给时沿用「首个支持转写的已配置实例」的老行为；**给了就严格用它** ——
   * 指定的实例不能转写时直接报错，不偷偷换一家（否则用户以为在用 A、实际走了 B）。
   */
  transcribeProviderInstanceId?: string
  transcribeModel?: string
  separateAudio?: boolean
  /**
   * 实体检测（人物 / 商品 / 物体 / 文字 / logo）用哪个模型 —— 现在是**多模态大模型**看关键帧，
   * 不再是本地 YOLO。缺省用应用默认文本模型；节点会把「富化模型」一并传下来。
   */
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

export interface SemanticPacksResponse {
  packs: SemanticPack[]
}

/**
 * 语义重建：主进程侧的拼接请求 / 结果。
 *
 * 素材是**模型新生成的片段**（不是按编辑列表裁剪原片 —— 那条"构建"路已随旧编辑 / 变体节点删除）：
 * 主进程负责统一重编码拼接、按需混回原片音轨、烧录转写字幕，并落一份清单。
 */
/**
 * v2 成片段：`source` = 直通原片入/出点；`generate` = 生成片段（对齐到 `durationSec`）。
 * 时间均为秒；入/出点是**原片时间**。
 */
export interface SemanticRebuildSegment {
  key: string
  kind: 'source' | 'generate'
  durationSec: number
  relativePath?: string
  sourceStartSec?: number
  sourceEndSec?: number
}

/** 重新配音的台词：合成好的音频 + 它替换的原片时间段 */
export interface SemanticRebuildDub {
  id: string
  relativePath: string
  sourceStartSec: number
  sourceEndSec: number
}

export interface SemanticRebuildRequest {
  timelineId: string
  /** 旧路径：只有生成片段（顺序拼接） */
  clips: Array<{ key: string; relativePath: string }>
  /** v2：按输出顺序的全部段（含直通原片段）；给了就忽略 `clips` 的拼接顺序 */
  segments?: SemanticRebuildSegment[]
  /** v2：重新配音（原片时间轴上替换人声） */
  dubs?: SemanticRebuildDub[]
  /** v2：字幕（修改后的台词，原片时间）；缺省用转写证据 */
  subtitles?: Array<{ sourceStartSec: number; sourceEndSec: number; text: string }>
  /** 输出文件名后缀（重跑/多版本区分） */
  label?: string
  /** 保留原片音轨（默认 true） */
  keepAudio?: boolean
  sourceRelativePath?: string
  /** 烧录转写字幕（默认 true） */
  burnSubtitles?: boolean
  width?: number
  height?: number
  fps?: number
}

export interface SemanticRebuildResponse {
  ok: boolean
  outputRelativePath?: string
  manifestRelativePath: string
  clipCount: number
  /** v2：直通原片的段数 / 实际混入的配音句数 */
  passthroughCount?: number
  dubCount?: number
  burnedSubtitles: number
  keptAudio: boolean
  notes: string[]
  error?: string
}
