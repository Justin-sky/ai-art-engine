import type { GraphNodeRunStatus } from './types'

export type GraphRunLogLevel = 'info' | 'warn' | 'error'

export type GraphRunLogEventKind = 'run_start' | 'run_end' | 'node_status' | 'run_message'

export type GraphRunLogMode = 'workflow' | 'toNode' | 'nodeOnly' | 'task'

export type GraphRunLogSessionStatus = 'running' | 'done' | 'error' | 'stopped'

/** 节点执行期间捕获的一次 API 调用（文本 / 图片生成等） */
export interface GraphRunLogApiCall {
  id: string
  ts: number
  kind: 'generateText' | 'generateImage' | 'generateVideo' | 'generateSpeech'
  nodeId: string
  request: {
    prompt?: string
    /** TTS / 声音设计输入 */
    input?: string
    system?: string
    model?: string
    providerInstanceId?: string
    /** 多模态附图 / 参考图数量（不落 data URL，避免日志膨胀） */
    imageCount?: number
    aspectRatio?: string
    resolution?: string
    quality?: string
    n?: number
    duration?: number
    generateAudio?: boolean
    inputReferenceCount?: number
    voice?: string
    name?: string
    /** 参考视频 TOS 上传摘要（不落完整签名参数） */
    tosUploads?: Array<{
      sourceLabel: string
      objectKey: string
      bytes: number
      urlPreview: string
    }>
  }
  response?: {
    text?: string
    model?: string
    voice?: string
    /** 生成图片张数（不落 data URL） */
    imageCount?: number
    assetId?: string
    relativePath?: string
  }
  error?: string
  durationMs?: number
}

export interface GraphRunLogEvent {
  id: string
  runId: string
  ts: number
  level: GraphRunLogLevel
  kind: GraphRunLogEventKind
  hostId?: string
  mode?: GraphRunLogMode
  nodeId?: string
  nodeTitle?: string
  typeId?: string
  status?: GraphNodeRunStatus
  message?: string
  /** node_status=done/error 时相对 running 的耗时 */
  durationMs?: number
  /** GRAPH_* 或原始错误短码 */
  errorCode?: string
}

export interface GraphRunLogSession {
  runId: string
  title: string
  hostId?: string
  mode: GraphRunLogMode
  targetNodeId?: string
  startedAt: number
  endedAt?: number
  status: GraphRunLogSessionStatus
  events: GraphRunLogEvent[]
  /** 按节点关联的 API 调用明细 */
  apiCalls: GraphRunLogApiCall[]
}
