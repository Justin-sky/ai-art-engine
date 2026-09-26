/**
 * 对已有 GLB 调用云端 Auto Rig（Meshy / Tripo standalone），不走生成端二段式。
 *
 * 纯编排：端点、请求体、响应解析按供应商取方言（`meshy/meshOps.ts` / `tripo/meshOps.ts`），
 * 本文件不含任何供应商分支。
 */
import type {
  GenerateModel3dJob,
  ModelProviderInstance,
  ModelProviderKind,
  RigModel3dInput
} from '@shared/modelProvider'
import { isAppError, fail, defErr, defErrSimple } from '@shared/errors/appError'
import { meshOpSupported } from '@shared/meshOps'
import { readHttpError } from './http'
import { requireMeshOpsDialect } from './meshOpsDialect'
import { encodeMeshOpsJobToken, parseMeshOpsJobToken } from './meshOpsJob'
import { mapTripoRigType } from './tripo/meshOps'
import type { VideoPollResult } from './types'

/** UI rigType → Tripo rig_type（映射表在 tripo 方言里，这里保留导出给既有调用方） */
export const mapCloudRigType = mapTripoRigType

const E_RIG_UNSUPPORTED = defErr<{ kind: string }>(
  'provider.model3dRig.unsupported',
  ({ kind }) => `供应商 ${kind} 不支持独立骨骼蒙皮：请改用 Meshy 或 Tripo`,
  ({ kind }) => `${kind} does not support standalone rigging; use Meshy or Tripo`
)
const E_RIG_NO_URL = defErrSimple(
  'provider.model3dRig.noModelUrl',
  '骨骼蒙皮需要可访问的模型 URL',
  'Rigging requires a reachable model URL'
)
const E_RIG_NO_TASK = defErrSimple(
  'provider.model3dRig.noTaskId',
  '蒙皮任务未返回 id',
  'Rigging task returned no id'
)
const E_RIG_SUBMIT = defErr<{ detail: string }>(
  'provider.model3dRig.submitFailed',
  ({ detail }) => `提交骨骼蒙皮失败: ${detail}`,
  ({ detail }) => `Failed to submit rigging: ${detail}`
)
const E_RIG_POLL = defErr<{ detail: string }>(
  'provider.model3dRig.pollFailed',
  ({ detail }) => `轮询骨骼蒙皮失败: ${detail}`,
  ({ detail }) => `Failed to poll rigging: ${detail}`
)
const E_RIG_FAILED = defErrSimple('provider.model3dRig.failed', '骨骼蒙皮失败', 'Rigging failed')

/** 该供应商是否支持独立蒙皮（由能力矩阵判定） */
export function isModel3dRigProviderKind(kind: string): boolean {
  return meshOpSupported(kind, 'rig')
}

function encodeJob(kind: ModelProviderKind, taskId: string): GenerateModel3dJob {
  return {
    jobId: taskId,
    pollingUrl: encodeMeshOpsJobToken(kind, 'rig', taskId),
    status: 'submitted',
    model: kind
  }
}

function parseJob(job: { jobId: string; pollingUrl: string }): {
  kind: ModelProviderKind
  taskId: string
} {
  const raw = job.pollingUrl || job.jobId
  const ref = parseMeshOpsJobToken(raw)
  if (ref?.op === 'rig' && isModel3dRigProviderKind(ref.kind)) {
    return { kind: ref.kind, taskId: ref.taskId }
  }
  throw fail(E_RIG_POLL, { detail: `bad pollingUrl: ${raw}` })
}

export async function submitCloudModel3dRig(
  provider: ModelProviderInstance,
  input: Pick<RigModel3dInput, 'modelUrl' | 'rigType' | 'spec' | 'outFormat'>
): Promise<GenerateModel3dJob> {
  const modelUrl = input.modelUrl?.trim()
  if (!modelUrl) throw fail(E_RIG_NO_URL)
  if (!isModel3dRigProviderKind(provider.providerKind)) {
    throw fail(E_RIG_UNSUPPORTED, { kind: provider.providerKind })
  }

  const dialect = requireMeshOpsDialect(provider.providerKind)
  const client = dialect.createClient(provider)
  try {
    const request = dialect.buildRigRequest({
      source: modelUrl,
      rigType: input.rigType,
      spec: input.spec,
      outFormat: input.outFormat
    })
    const { data } = await client.post(request.path, request.body)
    const taskId = dialect.parseSubmit(data)
    if (!taskId) throw fail(E_RIG_NO_TASK)
    return encodeJob(provider.providerKind, taskId)
  } catch (err) {
    if (isAppError(err)) throw err
    throw fail(E_RIG_SUBMIT, { detail: await readHttpError(err) })
  }
}

export async function pollCloudModel3dRig(
  provider: ModelProviderInstance,
  job: { jobId: string; pollingUrl: string }
): Promise<VideoPollResult> {
  // parseJob 同时做 token 校验（供应商必须实现了 rig）
  const { taskId } = parseJob(job)
  const dialect = requireMeshOpsDialect(provider.providerKind)
  const client = dialect.createClient(provider)

  try {
    const { data } = await client.get(dialect.pollPath('rig', taskId))
    const parsed = dialect.parseTask('rig', data)
    if (parsed.status === 'completed') {
      return { status: 'completed', progress: 100, downloadUrl: parsed.downloadUrl }
    }
    if (parsed.status === 'failed') {
      return {
        status: 'failed',
        progress: 100,
        error: parsed.error || fail(E_RIG_FAILED).message
      }
    }
    return {
      status: parsed.status,
      progress: parsed.progress ?? (parsed.status === 'in_progress' ? 55 : 15)
    }
  } catch (err) {
    throw fail(E_RIG_POLL, { detail: await readHttpError(err) })
  }
}
