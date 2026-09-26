/**
 * 网格后处理 / 骨骼动画的**编排层**（与供应商无关）。
 *
 * - 部件补全 `meshComplete`：只吃 `mesh/segment` 任务的 task_id。
 * - 重拓扑 `retopology`：task_id / 公网 URL 都行。
 * - 绑骨检查 `rigCheck`：免费，返回 riggable + 推荐 rig_type（无模型产物）。
 * - 动画重定向 `retarget`：只吃 rig 任务的 task_id。
 * - 格式转换 `convert` / 贴图 `texture`：task_id / 公网 URL 都行。
 *
 * 端点路径、请求体、响应字段、枚举与版本常量都在供应商方言里
 * （`tripo/meshOps.ts`）；本文件只负责提交、轮询、错误归一与 token 编解码。
 */
import type {
  GenerateModel3dJob,
  Model3dPostProcessInput,
  ModelProviderInstance
} from '@shared/modelProvider'
import { isAppError, fail, defErr, defErrSimple } from '@shared/errors/appError'
import { meshOpSupported } from '@shared/meshOps'
import { readHttpError } from './http'
import { requireMeshOpsDialect } from './meshOpsDialect'
import { LEGACY_MESH_OPS_TOKENS, encodeMeshOpsJobToken, parseMeshOpsJobToken } from './meshOpsJob'
import type { VideoPollResult } from './types'

export {
  TRIPO_COMPLETE_MODEL,
  TRIPO_RETOPOLOGY_MODEL_BASIC,
  TRIPO_RETOPOLOGY_MODEL_SMART,
  TRIPO_TEXTURE_MODEL_DEFAULT,
  TRIPO_TEXTURE_MODEL_FAST
} from './tripo/meshOps'

const E_PP_UNSUPPORTED = defErr<{ kind: string }>(
  'provider.model3dPostProcess.unsupported',
  ({ kind }) => `供应商 ${kind} 不支持该网格后处理：请改用 Tripo`,
  ({ kind }) => `${kind} does not support this mesh post-process; use Tripo`
)
const E_PP_NO_TASK_ID = defErrSimple(
  'provider.model3dPostProcess.taskIdMissing',
  '后处理任务未返回 id',
  'Post-process task returned no id'
)
const E_PP_SUBMIT = defErr<{ detail: string }>(
  'provider.model3dPostProcess.submitFailed',
  ({ detail }) => `提交网格后处理失败: ${detail}`,
  ({ detail }) => `Failed to submit mesh post-process: ${detail}`
)
const E_PP_POLL = defErr<{ detail: string }>(
  'provider.model3dPostProcess.pollFailed',
  ({ detail }) => `轮询网格后处理失败: ${detail}`,
  ({ detail }) => `Failed to poll mesh post-process: ${detail}`
)
const E_PP_FAILED = defErrSimple(
  'provider.model3dPostProcess.failed',
  '网格后处理失败',
  'Mesh post-process failed'
)
const E_PP_RIG_CHECK_VIA_JOB = defErrSimple(
  'provider.model3dPostProcess.rigCheckNotAJob',
  '绑骨检查没有模型产物，请走绑骨检查通道',
  'Rig check has no model artifact; use the rig-check path'
)

/** 轮询 token 前缀（历史格式；写侧已改为 `<kind>-<op>::<taskId>`） */
export const MODEL3D_COMPLETE_TOKEN = LEGACY_MESH_OPS_TOKENS.meshComplete
export const MODEL3D_RETOPOLOGY_TOKEN = LEGACY_MESH_OPS_TOKENS.retopology
export const MODEL3D_RETARGET_TOKEN = LEGACY_MESH_OPS_TOKENS.retarget
export const MODEL3D_CONVERT_TOKEN = LEGACY_MESH_OPS_TOKENS.convert
export const MODEL3D_TEXTURE_TOKEN = LEGACY_MESH_OPS_TOKENS.texture

/** 走任务轮询的后处理 op */
export type Model3dPostProcessJobOp =
  'meshComplete' | 'retopology' | 'retarget' | 'convert' | 'texture'

const JOB_OPS: readonly Model3dPostProcessJobOp[] = [
  'meshComplete',
  'retopology',
  'retarget',
  'convert',
  'texture'
]

function isPostProcessJobOp(op: string): op is Model3dPostProcessJobOp {
  return (JOB_OPS as readonly string[]).includes(op)
}

/** 该 pollingUrl 是否属于后处理任务（新旧格式都认） */
export function isModel3dPostProcessPollingUrl(token: string | undefined): boolean {
  const op = parseMeshOpsJobToken(token)?.op
  return !!op && isPostProcessJobOp(op)
}

export function parseModel3dPostProcessToken(pollingUrl: string): {
  op: Model3dPostProcessJobOp
  taskId: string
} {
  const ref = parseMeshOpsJobToken(pollingUrl)
  if (ref && isPostProcessJobOp(ref.op)) return { op: ref.op, taskId: ref.taskId }
  return { op: 'meshComplete', taskId: ref?.taskId ?? '' }
}

/**
 * 提交后处理任务（部件补全 / 重拓扑 / 重定向 / 转换 / 贴图）。
 * 绑骨检查没有模型产物，走 `submitCloudRigCheck` + `pollCloudRigCheck`。
 */
export async function submitCloudModel3dPostProcess(
  provider: ModelProviderInstance,
  input: Model3dPostProcessInput & { source?: string }
): Promise<GenerateModel3dJob> {
  const op = input.op
  if (op === 'rigCheck') throw fail(E_PP_RIG_CHECK_VIA_JOB)
  if (!meshOpSupported(provider.providerKind, op)) {
    throw fail(E_PP_UNSUPPORTED, { kind: provider.providerKind })
  }

  const dialect = requireMeshOpsDialect(provider.providerKind)
  const client = dialect.createClient(provider)
  try {
    const request = dialect.buildPostProcessRequest({
      ...input,
      source: (input.source ?? input.modelUrl ?? '').trim()
    })
    const { data } = await client.post(request.path, request.body)
    const taskId = dialect.parseSubmit(data)
    if (!taskId) throw fail(E_PP_NO_TASK_ID)
    return {
      jobId: taskId,
      pollingUrl: encodeMeshOpsJobToken(provider.providerKind, op, taskId),
      status: 'submitted',
      model: `${provider.providerKind}-${op}`
    }
  } catch (err) {
    if (isAppError(err)) throw err
    throw fail(E_PP_SUBMIT, { detail: await readHttpError(err) })
  }
}

async function readTask(
  provider: ModelProviderInstance,
  op: Model3dPostProcessJobOp | 'rigCheck',
  taskId: string
) {
  const dialect = requireMeshOpsDialect(provider.providerKind)
  const client = dialect.createClient(provider)
  const { data } = await client.get(dialect.pollPath(op, taskId))
  return data
}

/** 轮询后处理任务；完成后给出模型下载地址 */
export async function pollCloudModel3dPostProcess(
  provider: ModelProviderInstance,
  job: { jobId: string; pollingUrl: string }
): Promise<VideoPollResult> {
  const { op, taskId } = parseModel3dPostProcessToken(job.pollingUrl || job.jobId)
  if (!taskId) throw fail(E_PP_POLL, { detail: 'bad pollingUrl' })

  try {
    const payload = await readTask(provider, op, taskId)
    const parsed = requireMeshOpsDialect(provider.providerKind).parseTask(op, payload)
    if (parsed.status === 'failed') {
      return {
        status: 'failed',
        progress: 100,
        error: parsed.error || fail(E_PP_FAILED).message
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
    throw fail(E_PP_POLL, { detail: await readHttpError(err) })
  }
}

/** 绑骨检查结果（无模型产物，由 facade 就地轮询） */
export type RigCheckPollResult = {
  status: VideoPollResult['status']
  progress: number
  riggable?: boolean
  rigType?: string
  error?: string
}

/** 提交绑骨检查（免费） */
export async function submitCloudRigCheck(
  provider: ModelProviderInstance,
  input: Pick<Model3dPostProcessInput, 'providerTaskId' | 'modelUrl'>
): Promise<string> {
  if (!meshOpSupported(provider.providerKind, 'rigCheck')) {
    throw fail(E_PP_UNSUPPORTED, { kind: provider.providerKind })
  }
  const dialect = requireMeshOpsDialect(provider.providerKind)
  const client = dialect.createClient(provider)
  try {
    const request = dialect.buildPostProcessRequest({
      op: 'rigCheck',
      providerTaskId: input.providerTaskId,
      modelUrl: input.modelUrl,
      source: (input.modelUrl ?? '').trim()
    })
    const { data } = await client.post(request.path, request.body)
    const taskId = dialect.parseSubmit(data)
    if (!taskId) throw fail(E_PP_NO_TASK_ID)
    return taskId
  } catch (err) {
    if (isAppError(err)) throw err
    throw fail(E_PP_SUBMIT, { detail: await readHttpError(err) })
  }
}

/** 轮询绑骨检查：完成后回 riggable + 推荐 rig_type */
export async function pollCloudRigCheck(
  provider: ModelProviderInstance,
  taskId: string
): Promise<RigCheckPollResult> {
  try {
    const payload = await readTask(provider, 'rigCheck', taskId)
    const parsed = requireMeshOpsDialect(provider.providerKind).parseTask('rigCheck', payload)
    if (parsed.status === 'failed') {
      return {
        status: 'failed',
        progress: 100,
        error: parsed.error || fail(E_PP_FAILED).message
      }
    }
    if (parsed.status === 'completed') {
      return {
        status: 'completed',
        progress: 100,
        riggable: parsed.riggable === true,
        rigType: parsed.rigType
      }
    }
    return {
      status: parsed.status,
      progress: parsed.progress ?? (parsed.status === 'in_progress' ? 55 : 15)
    }
  } catch (err) {
    if (isAppError(err)) throw err
    throw fail(E_PP_POLL, { detail: await readHttpError(err) })
  }
}
