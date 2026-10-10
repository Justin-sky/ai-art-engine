/**
 * 画布节点 ↔ 主进程语义管线的 IPC 契约（纯类型）。
 * 路径一律为工程相对路径（正斜杠）；主进程负责解析为绝对路径。
 */
import type {
  BuildDefinition,
  BuildManifest,
  InvalidationPlan,
  SemanticEdit,
  SemanticPack,
  SemanticTimeline,
  ShotEvidence,
  UtteranceEvidence
} from './types'

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

export interface SemanticBuildRequest {
  /** 当前文档（可能已被上游 LLM / 用户改过；主进程会以它为准落盘） */
  timeline: SemanticTimeline
  edits: SemanticEdit[]
  /** 源视频；缺省按 timeline.source.assetId 解析 */
  sourceRelativePath?: string
  /** 输出文件名后缀（变体区分） */
  label?: string
}

export interface SemanticBuildResponse {
  plan: InvalidationPlan
  definition: BuildDefinition
  manifest: BuildManifest
  /** 成片工程相对路径（成功时） */
  outputRelativePath?: string
  notes: string[]
}

export interface SemanticPacksResponse {
  packs: SemanticPack[]
}
