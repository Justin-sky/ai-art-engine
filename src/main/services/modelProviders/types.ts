import type {
  CatalogModel,
  GenerateImageInput,
  GenerateImageResult,
  GenerateModel3dInput,
  GenerateModel3dJob,
  GenerateMusicInput,
  GenerateMusicResult,
  GenerateSpeechInput,
  GenerateSpeechResult,
  GenerateTextInput,
  GenerateTextResult,
  GenerateVideoInput,
  GenerateVideoJob,
  Model3dPostProcessInput,
  Model3dPostProcessOp,
  Model3dAnimationAction,
  ModelModality,
  ModelProviderInstance,
  ModelProviderKind,
  TranscribeAudioInput,
  TranscribeAudioResult
} from '@shared/modelProvider'
import type { MeshOp } from '@shared/meshOps'
import type { MeshOpsJobOp } from './meshOpsJob'
import type { AxiosInstance } from 'axios'

export type VideoPollResult = {
  status: 'pending' | 'in_progress' | 'completed' | 'failed'
  progress: number
  error?: string
  downloadUrl?: string
  /**
   * 多阶段任务（如 Tripo 生成 → Auto Rig）可回写下一阶段轮询 token；
   * videoJobService 会持久化到 VideoJobRecord.pollingUrl。
   */
  pollingUrl?: string
}

/** 供应商方言返回的「端点 + 请求体」（纯数据，便于单测） */
export interface MeshOpsRequest {
  path: string
  body: Record<string, unknown>
}

/** 任务查询响应的归一化结果 */
export interface MeshOpsTaskParseResult {
  status: VideoPollResult['status']
  /** 上游给的原始进度；缺省时由编排层补默认值 */
  progress?: number
  downloadUrl?: string
  error?: string
  /** 绑骨检查（rig-check）结论 */
  riggable?: boolean
  rigType?: string
  /** 附加产物：智能分割的 mask / 部件描述 / 真实子任务 id */
  extras?: { maskUrl?: string; description?: string; segTaskId?: string }
}

/**
 * 3D 网格加工「供应商方言」：只承载**协议差异**——端点路径、请求体、响应字段、
 * base URL 归一化、状态字映射、枚举与版本常量。
 *
 * 任务编排（提交后建 job、videoJobService 轮询、产物落盘登记、GLB 部件名解析）
 * 一律留在能力模块里，不按供应商复制。
 */
export interface MeshOpsDialect {
  readonly kind: ModelProviderKind
  /** 该供应商的 HTTP 客户端（含 base URL 归一化） */
  createClient(provider: ModelProviderInstance, timeoutMs?: number): AxiosInstance
  /**
   * 从创建任务的响应里取 task id。
   * 各家形状不同：Tripo `data.task_id`；Meshy `result`（字符串或 `{ id }`）。
   */
  parseSubmit(payload: unknown): string | undefined
  /**
   * 该 task id 是否属于本供应商的命名空间。
   *
   * 上游节点带来的 `providerTaskId` 可能是**别家**的任务 id（如在 Tripo 拆分节点后面
   * 接一个选 Meshy 的贴图节点）：`task_*` 是 Tripo 的，UUID 形态是 Meshy 的。
   * 编排层据此决定「直接用 id」还是「退回上传模型换公网 URL」。
   */
  acceptsTaskId(taskId: string): boolean
  /** 独立蒙皮 `rig` */
  buildRigRequest(input: {
    source: string
    rigType?: string
    spec?: string
    outFormat?: string
  }): MeshOpsRequest
  /** 拆分 `segment`（网格分割 / 智能分割） */
  buildSegmentRequest(input: {
    source: string
    mode: 'mesh' | 'smart'
    granularity?: string
    splitByConnectivity?: boolean
    smartGranularity?: string
    hint?: string
  }): MeshOpsRequest
  /** 后处理各 op；`source` 由编排层按能力矩阵解析（task id 优先，其次公网 URL） */
  buildPostProcessRequest(input: Model3dPostProcessInput & { source: string }): MeshOpsRequest
  /**
   * 任务查询路径：各家不同（Tripo 统一 `/v3/tasks/{id}`；Meshy 按任务族
   * `/openapi/v1/<任务名>/{id}`），所以按 op 取路径。
   */
  pollPath(op: MeshOpsJobOp, taskId: string): string
  /** 解析 `GET <任务查询路径>/{id}` 的响应体 */
  parseTask(op: MeshOp | Model3dPostProcessOp, payload: unknown): MeshOpsTaskParseResult
  /**
   * 可选：拉取「可选动画」列表（Meshy 动作库 / 未来的预设目录）。
   * 未实现即该供应商没有可选择项（如 Tripo 用固定 preset:xxx 字符串）。
   */
  listAnimations?(
    provider: ModelProviderInstance,
    query?: { search?: string }
  ): Promise<Model3dAnimationAction[]>
}

/**
 * 单一模型供应商适配器。
 * 新增厂商：实现本接口 → Cordis `createProviderPlugin`（kind 目录随插件登记）
 * → shared MODEL_PROVIDER_KINDS 加一项（设置落盘 / 规范化）。
 */
export interface ModelProviderAdapter {
  readonly kind: ModelProviderKind
  /**
   * 可选：3D 网格加工方言（拆分 / 蒙皮 / 补全 / 重拓扑 / 绑骨检查 / 重定向 / 转换 / 贴图）。
   * 未实现即该供应商不支持这些加工能力；能力矩阵见 `@shared/meshOps`。
   */
  meshOps?: MeshOpsDialect
  assertAuth(provider: ModelProviderInstance): Promise<void>
  fetchCatalog(provider: ModelProviderInstance, modality: ModelModality): Promise<CatalogModel[]>
  generateText(
    provider: ModelProviderInstance,
    modelId: string,
    input: GenerateTextInput
  ): Promise<GenerateTextResult>
  generateImage(
    provider: ModelProviderInstance,
    modelId: string,
    input: GenerateImageInput
  ): Promise<GenerateImageResult>
  submitVideo(
    provider: ModelProviderInstance,
    modelId: string,
    input: GenerateVideoInput
  ): Promise<GenerateVideoJob>
  pollVideo(
    provider: ModelProviderInstance,
    job: { jobId: string; pollingUrl: string }
  ): Promise<VideoPollResult>
  generateSpeech(
    provider: ModelProviderInstance,
    modelId: string,
    input: GenerateSpeechInput
  ): Promise<GenerateSpeechResult>
  /**
   * 音乐 / BGM 生成。可选：未实现时门面提示该提供商不支持。
   * 同步返回音频下载地址，由门面统一下载并登记资产。
   */
  generateMusic?(
    provider: ModelProviderInstance,
    modelId: string,
    input: GenerateMusicInput
  ): Promise<GenerateMusicResult>
  /**
   * 音频转写（语音识别）。可选：未实现时「配音转字幕」会提示该提供商不支持。
   * 输入 absPath 已由门面解析为绝对路径。
   */
  transcribeAudio?(
    provider: ModelProviderInstance,
    modelId: string,
    input: TranscribeAudioInput
  ): Promise<TranscribeAudioResult>
  submitModel3d(
    provider: ModelProviderInstance,
    modelId: string,
    input: GenerateModel3dInput
  ): Promise<GenerateModel3dJob>
  pollModel3d(
    provider: ModelProviderInstance,
    job: { jobId: string; pollingUrl: string }
  ): Promise<VideoPollResult>
}
