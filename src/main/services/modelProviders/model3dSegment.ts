/**
 * Tripo v3 模型拆分（拆件）。
 *
 * 两条路线都是异步任务：`POST` 提交拿 `task_id` → `GET /v3/tasks/{task_id}` 轮询 → 下载拆分后 GLB。
 * - 网格分割 `POST /v3/mesh/segment`：几何拓扑（v1，默认）或语义 + 几何（v2 Beta）。
 * - 智能分割 `POST /v3/mesh/smartsegment`：语义命名部件，额外返回 mask 图与部件描述。
 *
 * 部件名（`part_names`）不在响应里，等于输出 GLB 的各 node 名，由 `glbParts` 解析落盘文件。
 */
import type {
  GenerateModel3dJob,
  Model3dSegmentMode,
  ModelProviderInstance,
  SegmentModel3dInput
} from '@shared/modelProvider'
import { isAppError, fail, defErr, defErrSimple } from '@shared/errors/appError'
import { meshOpSupported } from '@shared/meshOps'
import { readHttpError } from './http'
import { requireMeshOpsDialect } from './meshOpsDialect'
import { LEGACY_MESH_OPS_TOKENS, encodeMeshOpsJobToken, parseMeshOpsJobToken } from './meshOpsJob'
import type { VideoPollResult } from './types'

export {
  TRIPO_SEGMENT_IDENTITY_TRANSFORM,
  TRIPO_SEGMENT_MODEL_V1,
  TRIPO_SEGMENT_MODEL_V2
} from './tripo/meshOps'

const E_SEG_UNSUPPORTED = defErr<{ kind: string }>(
  'provider.model3dSegment.unsupported',
  ({ kind }) => `供应商 ${kind} 不支持模型拆分：请改用 Tripo`,
  ({ kind }) => `${kind} does not support mesh segmentation; use Tripo`
)
const E_SEG_NO_URL = defErrSimple(
  'provider.model3dSegment.noModelUrl',
  '模型拆分需要可访问的模型 URL',
  'Mesh segmentation requires a reachable model URL'
)
const E_SEG_NO_TASK = defErrSimple(
  'provider.model3dSegment.noTaskId',
  '拆分任务未返回 id',
  'Segmentation task returned no id'
)
const E_SEG_SUBMIT = defErr<{ detail: string }>(
  'provider.model3dSegment.submitFailed',
  ({ detail }) => `提交模型拆分失败: ${detail}`,
  ({ detail }) => `Failed to submit mesh segmentation: ${detail}`
)
const E_SEG_POLL = defErr<{ detail: string }>(
  'provider.model3dSegment.pollFailed',
  ({ detail }) => `轮询模型拆分失败: ${detail}`,
  ({ detail }) => `Failed to poll mesh segmentation: ${detail}`
)
const E_SEG_FAILED = defErrSimple(
  'provider.model3dSegment.failed',
  '模型拆分失败',
  'Mesh segmentation failed'
)

/** 轮询 token 前缀（历史格式；写侧已改为 `<kind>-<op>::<taskId>`） */
export const MODEL3D_SEGMENT_TOKEN = LEGACY_MESH_OPS_TOKENS.segment
export const MODEL3D_SMART_SEGMENT_TOKEN = LEGACY_MESH_OPS_TOKENS.smartSegment

export type Model3dSegmentPollToken = { mode: Model3dSegmentMode; taskId: string }

/** 该 pollingUrl 是否属于拆件任务（新旧格式都认） */
export function isModel3dSegmentPollingUrl(token: string | undefined): boolean {
  const op = parseMeshOpsJobToken(token)?.op
  return op === 'segment' || op === 'smartSegment'
}

export function parseModel3dSegmentToken(pollingUrl: string): Model3dSegmentPollToken {
  const ref = parseMeshOpsJobToken(pollingUrl)
  return { mode: ref?.op === 'smartSegment' ? 'smart' : 'mesh', taskId: ref?.taskId ?? '' }
}

export type SegmentSubmitInput = Pick<
  SegmentModel3dInput,
  'mode' | 'granularity' | 'splitByConnectivity' | 'smartGranularity' | 'hint'
> & { modelUrl: string }

/**
 * 提交拆件任务。
 * 网格分割：给了粒度或显式 `splitByConnectivity` 才升到 v2（Beta）；否则走默认 v1。
 * 端点路径与请求体的协议差异在 `tripo/meshOps.ts` 方言里。
 */
export async function submitCloudModel3dSegment(
  provider: ModelProviderInstance,
  input: SegmentSubmitInput
): Promise<GenerateModel3dJob> {
  const modelUrl = input.modelUrl?.trim()
  if (!modelUrl) throw fail(E_SEG_NO_URL)
  if (!meshOpSupported(provider.providerKind, 'segment')) {
    throw fail(E_SEG_UNSUPPORTED, { kind: provider.providerKind })
  }

  const mode: Model3dSegmentMode = input.mode === 'smart' ? 'smart' : 'mesh'
  const dialect = requireMeshOpsDialect(provider.providerKind)
  const client = dialect.createClient(provider)
  const jobOp = mode === 'smart' ? 'smartSegment' : 'segment'

  try {
    const request = dialect.buildSegmentRequest({
      source: modelUrl,
      mode,
      granularity: input.granularity,
      splitByConnectivity: input.splitByConnectivity,
      smartGranularity: input.smartGranularity,
      hint: input.hint
    })
    const { data } = await client.post(request.path, request.body)
    const taskId = dialect.parseSubmit(data)
    if (!taskId) throw fail(E_SEG_NO_TASK)
    return {
      jobId: taskId,
      pollingUrl: encodeMeshOpsJobToken(provider.providerKind, jobOp, taskId),
      status: 'submitted',
      model: `${provider.providerKind}-${jobOp}`
    }
  } catch (err) {
    if (isAppError(err)) throw err
    throw fail(E_SEG_SUBMIT, { detail: await readHttpError(err) })
  }
}

async function readSegmentTask(provider: ModelProviderInstance, taskId: string) {
  const dialect = requireMeshOpsDialect(provider.providerKind)
  const client = dialect.createClient(provider)
  const { data } = await client.get(dialect.pollPath('segment', taskId))
  return data
}

/** 轮询拆件任务；完成后给出拆分后 GLB 的下载地址 */
export async function pollCloudModel3dSegment(
  provider: ModelProviderInstance,
  job: { jobId: string; pollingUrl: string }
): Promise<VideoPollResult> {
  const { taskId } = parseModel3dSegmentToken(job.pollingUrl || job.jobId)
  if (!taskId) throw fail(E_SEG_POLL, { detail: 'bad pollingUrl' })

  try {
    const payload = await readSegmentTask(provider, taskId)
    const parsed = requireMeshOpsDialect(provider.providerKind).parseTask('segment', payload)

    if (parsed.status === 'failed') {
      return {
        status: 'failed',
        progress: 100,
        error: parsed.error || fail(E_SEG_FAILED).message
      }
    }
    if (parsed.status === 'completed') {
      return { status: 'completed', progress: 100, downloadUrl: parsed.downloadUrl }
    }
    return {
      status: parsed.status,
      progress: parsed.progress ?? (parsed.status === 'in_progress' ? 55 : 15)
    }
  } catch (err) {
    if (isAppError(err)) throw err
    throw fail(E_SEG_POLL, { detail: await readHttpError(err) })
  }
}

/** 智能分割的附加产物（mask 图 + 部件描述 + 真实 mesh_segmentation 任务 id）；网格分割没有这些字段，返回空 */
export async function fetchCloudModel3dSegmentExtras(
  provider: ModelProviderInstance,
  job: { jobId: string; pollingUrl: string }
): Promise<{ maskUrl?: string; description?: string; segTaskId?: string }> {
  const { mode, taskId } = parseModel3dSegmentToken(job.pollingUrl || job.jobId)
  if (mode !== 'smart' || !taskId) return {}
  try {
    const payload = await readSegmentTask(provider, taskId)
    // 智能分割是「生成 + 分割」复合任务，部件补全要的是里面那次 mesh_segmentation 的 id
    return requireMeshOpsDialect(provider.providerKind).parseTask('segment', payload).extras ?? {}
  } catch {
    // 附加产物缺失不该让已经成功的拆件任务判失败
    return {}
  }
}
