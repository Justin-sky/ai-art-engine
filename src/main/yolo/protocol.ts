/**
 * 推理子进程（utilityProcess）与主进程之间的内部消息协议。
 * JSON-RPC 风格：{ id, method, params } → { id, ok, result | error }。
 * 与对外契约（shared/yolo.ts）解耦，仅存在于主进程内部。
 */

import type { YoloInferenceInput, YoloStatus, YoloTaskKind } from '@shared/yolo'

export type YoloWorkerMethod = 'ping' | 'status' | 'infer'

/** infer 的参数：模型路径由 service 解析为绝对路径后下发 */
export interface YoloWorkerInferParams extends YoloInferenceInput {
  kind: YoloTaskKind
  /** 模型绝对路径 */
  modelPath: string
  /** 模型名（错误信息用） */
  modelId: string
}

export interface YoloWorkerRequest {
  id: number
  method: YoloWorkerMethod
  params?: unknown
}

export type YoloWorkerResponse =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: string }

/** status 方法返回：ready + ortVersion + 会话缓存信息 */
export interface YoloWorkerStatus {
  ready: boolean
  ortVersion?: string
  backend: YoloStatus['backend']
  loadedSession?: { modelId: string; kind: YoloTaskKind }
  error?: string
}
