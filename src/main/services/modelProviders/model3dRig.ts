/**
 * 对已有 GLB 调用云端 Auto Rig（Meshy / Tripo standalone），不走生成端二段式。
 */
import type {
  GenerateModel3dJob,
  ModelProviderInstance,
  RigModel3dInput
} from '@shared/modelProvider'
import { isAppError, fail, defErr, defErrSimple } from '@shared/errors/appError'
import { createProviderHttpClient, readHttpError } from './http'
import type { VideoPollResult } from './types'

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

const TRIPO_RIG_BIPED = 'v1.0-20240301'
const TRIPO_RIG_CREATURE = 'v2.5-20260210'

export type Model3dRigKind = 'meshy' | 'tripo'

export function isModel3dRigProviderKind(kind: string): kind is Model3dRigKind {
  return kind === 'meshy' || kind === 'tripo'
}

function mapStatus(raw: string | undefined): VideoPollResult['status'] {
  const s = (raw ?? '').toLowerCase()
  if (s === 'success' || s === 'succeeded' || s === 'completed') return 'completed'
  if (s === 'failed' || s === 'error' || s === 'cancelled' || s === 'canceled') return 'failed'
  if (s === 'running' || s === 'processing' || s === 'in_progress') return 'in_progress'
  return 'pending'
}

/** UI rigType → Tripo rig_type */
export function mapCloudRigType(raw: string | undefined): string {
  const key = (raw || 'humanoid').trim().toLowerCase()
  if (key === 'quadruped') return 'quadruped'
  if (key === 'hexapod') return 'hexapod'
  if (key === 'octopod') return 'octopod'
  if (key === 'avian' || key === 'creature') return 'avian'
  if (key === 'serpentine') return 'serpentine'
  if (key === 'aquatic') return 'aquatic'
  return 'biped'
}

function resolveTripoBase(raw: string | undefined): string {
  let url = (raw || '').trim().replace(/\/+$/, '')
  url = url.replace(/\/v2\/openapi$/i, '').replace(/\/v3$/i, '')
  url = url.replace(
    /^https?:\/\/api\.tripo3d\.(ai|com)/i,
    (_m, tld: string) => `https://openapi.tripo3d.${tld.toLowerCase()}`
  )
  return url || 'https://openapi.tripo3d.ai'
}

function encodeJob(kind: Model3dRigKind, taskId: string): GenerateModel3dJob {
  return {
    jobId: taskId,
    pollingUrl: `${kind}::${taskId}`,
    status: 'submitted',
    model: kind
  }
}

function parseJob(job: { jobId: string; pollingUrl: string }): {
  kind: Model3dRigKind
  taskId: string
} {
  const raw = job.pollingUrl || job.jobId
  if (raw.includes('::')) {
    const [kind, taskId] = raw.split('::') as [string, string]
    if (isModel3dRigProviderKind(kind) && taskId) return { kind, taskId }
  }
  throw fail(E_RIG_POLL, { detail: `bad pollingUrl: ${raw}` })
}

export async function submitCloudModel3dRig(
  provider: ModelProviderInstance,
  input: Pick<RigModel3dInput, 'modelUrl' | 'rigType'>
): Promise<GenerateModel3dJob> {
  const modelUrl = input.modelUrl?.trim()
  if (!modelUrl) throw fail(E_RIG_NO_URL)
  if (!isModel3dRigProviderKind(provider.providerKind)) {
    throw fail(E_RIG_UNSUPPORTED, { kind: provider.providerKind })
  }

  if (provider.providerKind === 'meshy') {
    const client = createProviderHttpClient(provider)
    try {
      // 官方：POST /openapi/v1/rigging；create 的 result 是 string task id
      const { data } = await client.post<{ result?: string | { id?: string } }>(
        '/openapi/v1/rigging',
        {
          model_url: modelUrl,
          height_meters: 1.7
        }
      )
      const taskId =
        typeof data?.result === 'string'
          ? data.result
          : typeof data?.result === 'object'
            ? data.result?.id
            : undefined
      if (!taskId?.trim()) throw fail(E_RIG_NO_TASK)
      return encodeJob('meshy', taskId.trim())
    } catch (err) {
      if (isAppError(err)) throw err
      throw fail(E_RIG_SUBMIT, { detail: await readHttpError(err) })
    }
  }

  // Tripo Auto Rig：input 可为公网 URL
  const client = createProviderHttpClient({
    ...provider,
    baseUrl: resolveTripoBase(provider.baseUrl)
  })
  const rigType = mapCloudRigType(input.rigType)
  try {
    const { data } = await client.post<{ data?: { task_id?: string } }>('/v3/animations/rig', {
      input: modelUrl,
      model: rigType === 'biped' ? TRIPO_RIG_BIPED : TRIPO_RIG_CREATURE,
      rig_type: rigType,
      spec: 'mixamo',
      out_format: 'glb'
    })
    const taskId = data?.data?.task_id
    if (!taskId?.trim()) throw fail(E_RIG_NO_TASK)
    return encodeJob('tripo', taskId.trim())
  } catch (err) {
    if (isAppError(err)) throw err
    throw fail(E_RIG_SUBMIT, { detail: await readHttpError(err) })
  }
}

export async function pollCloudModel3dRig(
  provider: ModelProviderInstance,
  job: { jobId: string; pollingUrl: string }
): Promise<VideoPollResult> {
  const { kind, taskId } = parseJob(job)

  if (kind === 'meshy') {
    const client = createProviderHttpClient(provider)
    try {
      const { data } = await client.get<{
        status?: string
        progress?: number
        task_error?: { message?: string }
        result?: {
          rigged_character_glb_url?: string
          basic_animations?: { walking_glb_url?: string; running_glb_url?: string }
        } | null
      }>(`/openapi/v1/rigging/${taskId}`)
      const status = mapStatus(data?.status)
      if (status === 'completed') {
        const downloadUrl =
          data?.result?.rigged_character_glb_url?.trim() ||
          data?.result?.basic_animations?.walking_glb_url?.trim()
        return { status: 'completed', progress: 100, downloadUrl }
      }
      if (status === 'failed') {
        return {
          status: 'failed',
          progress: 100,
          error: data?.task_error?.message?.trim() || fail(E_RIG_FAILED).message
        }
      }
      return {
        status,
        progress: data?.progress ?? (status === 'in_progress' ? 55 : 15)
      }
    } catch (err) {
      throw fail(E_RIG_POLL, { detail: await readHttpError(err) })
    }
  }

  const client = createProviderHttpClient({
    ...provider,
    baseUrl: resolveTripoBase(provider.baseUrl)
  })
  try {
    const { data } = await client.get<{
      data?: {
        status?: string
        progress?: number
        output?: {
          model_url?: string
          base_model_url?: string
          pbr_model_url?: string
          rigged_model_url?: string
        }
      }
    }>(`/v3/tasks/${taskId}`)
    const task = data?.data
    const status = mapStatus(task?.status)
    if (status === 'completed') {
      const out = task?.output
      const downloadUrl =
        out?.rigged_model_url?.trim() ||
        out?.pbr_model_url?.trim() ||
        out?.model_url?.trim() ||
        out?.base_model_url?.trim()
      return { status: 'completed', progress: 100, downloadUrl }
    }
    if (status === 'failed') {
      return { status: 'failed', progress: 100, error: fail(E_RIG_FAILED).message }
    }
    return {
      status,
      progress: task?.progress ?? (status === 'in_progress' ? 55 : 15)
    }
  } catch (err) {
    throw fail(E_RIG_POLL, { detail: await readHttpError(err) })
  }
}
