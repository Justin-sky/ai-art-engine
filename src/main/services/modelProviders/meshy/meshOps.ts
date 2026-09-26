/**
 * Meshy 网格加工方言：端点路径、请求体、响应字段、状态映射。
 *
 * 目前只接入独立蒙皮 `rig`（`POST /openapi/v1/rigging`）；retexture / remesh /
 * convert / animations 尚未接入，能力矩阵里也没有声明——声明即实现（见
 * `tests/meshOpsCaps.test.ts` 的不变量）。
 *
 * 与 Tripo 的协议差异（供后续扩 op 时对照）：
 * - 端点是 `/openapi/v1/<任务名>`，创建返回 `result`（字符串 task id 或 `{ id }`）；
 * - 轮询 `GET /openapi/v1/<任务名>/{id}`，状态是大写枚举 PENDING / IN_PROGRESS /
 *   SUCCEEDED / FAILED / CANCELED / EXPIRED；
 * - 产物在 `result` 下按格式给 URL（`model_urls`、`rigged_character_glb_url` …），
 *   而不是 Tripo 的 `output.<字段>`。
 */
import type { Model3dAnimationAction, ModelProviderInstance } from '@shared/modelProvider'
import { defErr, defErrSimple, fail } from '@shared/errors/appError'
import { createProviderHttpClient } from '../http'
import type { MeshOpsDialect, MeshOpsRequest, MeshOpsTaskParseResult } from '../types'

const E_MESHY_OP_UNSUPPORTED = defErr<{ op: string }>(
  'provider.meshyMeshOps.unsupported',
  ({ op }) => `Meshy 暂未接入该网格加工能力（${op}）`,
  ({ op }) => `Meshy does not expose this mesh operation yet (${op})`
)
const E_MESHY_NO_SOURCE = defErrSimple(
  'provider.meshyMeshOps.noSource',
  'Meshy 该操作需要模型 URL',
  'This Meshy operation needs a model URL'
)
const E_MESHY_RETARGET_RIG_TASK = defErrSimple(
  'provider.meshyMeshOps.retargetNeedsRigTask',
  'Meshy 重定向只吃 Meshy 自己的绑骨任务 id：请把上游「3D 骨骼蒙皮」节点切到 Meshy',
  'Meshy retargeting needs a Meshy rig task id: switch the upstream rig node to Meshy'
)
const E_MESHY_NO_ACTION = defErrSimple(
  'provider.meshyMeshOps.noAction',
  '请在动作库里至少选择一个动画（action_id）',
  'Pick at least one animation from the action library (action_id)'
)
const E_MESHY_NO_FORMAT = defErrSimple(
  'provider.meshyMeshOps.noFormat',
  '格式转换需要目标格式（GLTF / FBX / USDZ / OBJ / STL / 3MF）',
  'Format conversion needs a target format (GLTF / FBX / USDZ / OBJ / STL / 3MF)'
)

/** 我们节点里的目标格式（Tripo 口径）→ Meshy `target_formats`（小写枚举，GLTF 走 glb） */
const MESHY_CONVERT_FORMATS: Record<string, string> = {
  GLTF: 'glb',
  FBX: 'fbx',
  USDZ: 'usdz',
  OBJ: 'obj',
  STL: 'stl',
  '3MF': '3mf'
}

type MeshyTaskPayload = {
  status?: string
  progress?: number
  task_error?: { message?: string } | null
  result?: {
    rigged_character_glb_url?: string
    animation_glb_url?: string
    animation_fbx_url?: string
    basic_animations?: { walking_glb_url?: string; running_glb_url?: string }
  } | null
  /** retexture / remesh 等直接返回在顶层 */
  model_url?: string
  model_urls?: Record<string, string> | null
}

/** Tripo 的贴图精度 → Meshy retexture 的贴图分辨率（两家的精度轴不同，只能近似映射） */
function textureResolutionFor(quality: string | undefined): '2k' | '4k' | '8k' | undefined {
  switch ((quality ?? '').trim().toLowerCase()) {
    case 'extreme':
      return '8k'
    case 'detailed':
      return '4k'
    case 'fast':
    case 'standard':
      return '2k'
    default:
      return undefined
  }
}

/** Meshy 的输入源：`input_task_id` 与 `model_url` 二选一 */
function meshySource(input: { providerTaskId?: string; source: string }): Record<string, string> {
  const taskId = input.providerTaskId?.trim()
  if (taskId && !/^task_/i.test(taskId)) return { input_task_id: taskId }
  const url = input.source?.trim()
  if (!url) throw fail(E_MESHY_NO_SOURCE)
  return { model_url: url }
}

/** 取产物下载地址：优先 glb，其次 fbx / gltf / 单字段 model_url */
function meshyDownloadUrl(task: MeshyTaskPayload | undefined): string | undefined {
  const urls = task?.model_urls ?? undefined
  return (
    urls?.glb?.trim() ||
    task?.result?.rigged_character_glb_url?.trim() ||
    task?.result?.animation_glb_url?.trim() ||
    task?.result?.basic_animations?.walking_glb_url?.trim() ||
    task?.model_url?.trim() ||
    urls?.fbx?.trim() ||
    task?.result?.animation_fbx_url?.trim() ||
    urls?.gltf?.trim() ||
    undefined
  )
}

/** 动作库条目 → 统一结构（`action_id` 才是要回传的标识） */
function toAnimationActions(payload: unknown): Model3dAnimationAction[] {
  if (!Array.isArray(payload)) return []
  return payload
    .map((raw) => {
      const item = raw as {
        action_id?: number
        name?: string
        key?: string
        category?: string
        sub_category?: string
        preview_url?: string
      }
      const id = typeof item.action_id === 'number' ? String(item.action_id) : ''
      if (!id) return null
      const action: Model3dAnimationAction = {
        id,
        label: item.name?.trim() || item.key?.trim() || `#${id}`
      }
      const category = item.category?.trim()
      if (category) action.category = category
      const subCategory = item.sub_category?.trim()
      if (subCategory) action.subCategory = subCategory
      const previewUrl = item.preview_url?.trim()
      if (previewUrl) action.previewUrl = previewUrl
      return action
    })
    .filter((item): item is Model3dAnimationAction => !!item)
}

function mapMeshyStatus(raw: string | undefined): MeshOpsTaskParseResult['status'] {
  const s = (raw ?? '').trim().toUpperCase()
  if (s === 'SUCCEEDED' || s === 'SUCCESS' || s === 'COMPLETED') return 'completed'
  // EXPIRED 以前落进 pending 会一直轮询到瞬时失败上限，按失败处理更快暴露
  if (s === 'FAILED' || s === 'CANCELED' || s === 'CANCELLED' || s === 'EXPIRED') return 'failed'
  if (s === 'IN_PROGRESS' || s === 'RUNNING' || s === 'PROCESSING') return 'in_progress'
  return 'pending'
}

export const meshyMeshOps: MeshOpsDialect = {
  kind: 'meshy',

  createClient(provider: ModelProviderInstance, timeoutMs = 120_000) {
    return createProviderHttpClient(provider, timeoutMs)
  },

  parseSubmit(payload: unknown): string | undefined {
    // create 返回 result：字符串 task id，或 { id }
    const result = (payload as { result?: string | { id?: string } } | undefined)?.result
    if (typeof result === 'string') return result.trim() || undefined
    if (result && typeof result === 'object') return result.id?.trim() || undefined
    return undefined
  },

  /** Meshy 任务 id 是 UUID 形态；Tripo 的 `task_*` 不认（跨供应商链路要退回 URL） */
  acceptsTaskId(taskId: string): boolean {
    const id = taskId.trim()
    return !!id && !/^task_/i.test(id)
  },

  buildRigRequest(input): MeshOpsRequest {
    return {
      path: '/openapi/v1/rigging',
      body: {
        model_url: input.source,
        height_meters: 1.7
      }
    }
  },

  buildSegmentRequest(input): MeshOpsRequest {
    throw fail(E_MESHY_OP_UNSUPPORTED, { op: `segment:${input.mode}` })
  },

  buildPostProcessRequest(input): MeshOpsRequest {
    if (input.op === 'texture') {
      // retexture：文生贴图（text_style_prompt）或按参考图重绘；PBR / 去光照按开关透传
      const body: Record<string, unknown> = { ...meshySource(input) }
      const prompt = input.texturePromptText?.trim()
      if (prompt) body.text_style_prompt = prompt
      if (input.pbr !== undefined) body.enable_pbr = input.pbr
      if (input.delight !== undefined) body.remove_lighting = input.delight
      const resolution = textureResolutionFor(input.textureQuality)
      if (resolution) body.texture_resolution = resolution
      return { path: '/openapi/v1/retexture', body }
    }

    if (input.op === 'retopology') {
      // remesh：topology + target_polycount；Tripo 的智能/基础档（decimation_mode）语义不同，不透传
      const body: Record<string, unknown> = {
        ...meshySource(input),
        topology: input.quad ? 'quad' : 'triangle'
      }
      if (typeof input.faceLimit === 'number' && input.faceLimit > 0) {
        body.target_polycount = Math.round(input.faceLimit)
      }
      if (input.pivotToCenterBottom !== undefined) {
        body.origin_at = input.pivotToCenterBottom ? 'bottom' : 'center'
      }
      return { path: '/openapi/v1/remesh', body }
    }

    if (input.op === 'convert') {
      // convert：只吃 target_formats（数组，至少一项）；没有 FBX 预设 / pivot / UV 等高级参数
      const format = MESHY_CONVERT_FORMATS[(input.format ?? '').trim().toUpperCase()]
      if (!format) throw fail(E_MESHY_NO_FORMAT)
      return {
        path: '/openapi/v1/convert',
        body: { ...meshySource(input), target_formats: [format] }
      }
    }

    if (input.op === 'retarget') {
      // animations：只吃 Meshy 自己的 rig_task_id（不接受 URL），动画用动作库 action_id
      const rigTaskId = input.providerTaskId?.trim()
      if (!rigTaskId || /^task_/i.test(rigTaskId)) throw fail(E_MESHY_RETARGET_RIG_TASK)
      const actionIds = [
        ...new Set(
          (input.actionIds ?? [])
            .map((id) => Math.round(Number(id)))
            .filter((id) => Number.isFinite(id) && id > 0)
        )
      ]
      if (!actionIds.length) throw fail(E_MESHY_NO_ACTION)
      const body: Record<string, unknown> = { rig_task_id: rigTaskId }
      if (actionIds.length > 1) body.action_ids = actionIds
      else body.action_id = actionIds[0]
      return { path: '/openapi/v1/animations', body }
    }

    throw fail(E_MESHY_OP_UNSUPPORTED, { op: input.op })
  },

  /** Meshy 按任务族分路径 */
  pollPath(op, taskId: string): string {
    if (op === 'rig') return `/openapi/v1/rigging/${taskId}`
    if (op === 'retarget') return `/openapi/v1/animations/${taskId}`
    if (op === 'texture') return `/openapi/v1/retexture/${taskId}`
    if (op === 'retopology') return `/openapi/v1/remesh/${taskId}`
    if (op === 'convert') return `/openapi/v1/convert/${taskId}`
    throw fail(E_MESHY_OP_UNSUPPORTED, { op })
  },

  /** 动作库（免费，一次全量返回，用于填充选择器） */
  async listAnimations(provider, query): Promise<Model3dAnimationAction[]> {
    const client = createProviderHttpClient(provider)
    const search = query?.search?.trim()
    const { data } = await client.get('/openapi/v1/animations/library', {
      ...(search ? { params: { search } } : {})
    })
    return toAnimationActions(data)
  },

  parseTask(op, payload: unknown): MeshOpsTaskParseResult {
    const task = payload as MeshyTaskPayload | undefined
    const status = mapMeshyStatus(task?.status)
    const progress = typeof task?.progress === 'number' ? task.progress : undefined
    const result: MeshOpsTaskParseResult = {
      status,
      ...(progress !== undefined ? { progress } : {})
    }

    if (status === 'failed') {
      const message = task?.task_error?.message?.trim()
      if (message) result.error = message
      return result
    }
    if (status !== 'completed') return result

    // rig 的产物在 result；retexture / remesh 在顶层 model_urls / model_url
    void op
    const downloadUrl = meshyDownloadUrl(task)
    if (downloadUrl) result.downloadUrl = downloadUrl
    return result
  }
}
