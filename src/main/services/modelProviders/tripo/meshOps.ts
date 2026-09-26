/**
 * Tripo 网格加工方言：只放**协议差异**——端点路径、请求体、响应字段、状态映射、
 * 枚举与模型版本常量。任务编排留在 `model3dSegment.ts` / `model3dPostProcess.ts` /
 * `model3dRig.ts`，不按供应商复制。
 *
 * 文档：https://developers.tripo3d.com/zh/docs/
 */
import type {
  Model3dPostProcessInput,
  Model3dPostProcessOp,
  ModelProviderInstance
} from '@shared/modelProvider'
import type { MeshOp } from '@shared/meshOps'
import { defErr, defErrSimple, fail } from '@shared/errors/appError'
import { createProviderHttpClient } from '../http'
import type {
  MeshOpsDialect,
  MeshOpsRequest,
  MeshOpsTaskParseResult,
  VideoPollResult
} from '../types'

// ── 协议级错误（端点输入不满足上游要求，提前拦下比透传 400 清楚）──

const E_NO_URL = defErrSimple(
  'provider.tripoMeshOps.noModelUrl',
  '该操作需要可访问的模型 URL',
  'This operation needs a reachable model URL'
)
const E_NO_TASK = defErr<{ op: string }>(
  'provider.tripoMeshOps.noTaskId',
  ({ op }) => `${op} 需要上游 Tripo 任务 id：请从对应的上游节点接入`,
  ({ op }) => `${op} needs an upstream Tripo task id: connect the matching upstream node`
)
const E_NO_ANIMATION = defErrSimple(
  'provider.tripoMeshOps.noAnimation',
  '动画重定向需要至少一个预设动画 id（如 preset:walk）',
  'Animation retargeting needs at least one preset animation id (e.g. preset:walk)'
)
const E_SEG_SMART_NOT_GLB = defErrSimple(
  'provider.tripoMeshOps.smartSegmentGlbOnly',
  '智能分割只接受 GLB 模型：请先把上游模型转成 GLB',
  'Smart segmentation accepts GLB only: convert the upstream model to GLB first'
)
const E_RIG_CHECK_NOT_GLB = defErrSimple(
  'provider.tripoMeshOps.rigCheckGlbOnly',
  '绑骨检查只接受 GLB 模型：请先把上游模型转成 GLB',
  'Riggability check accepts GLB only: convert the upstream model to GLB first'
)
const E_NO_FORMAT = defErrSimple(
  'provider.tripoMeshOps.noFormat',
  '格式转换需要目标格式（GLTF / FBX / USDZ / OBJ / STL / 3MF）',
  'Format conversion needs a target format (GLTF / FBX / USDZ / OBJ / STL / 3MF)'
)
const E_TEXTURE_FAST_VERSION = defErrSimple(
  'provider.tripoMeshOps.textureFastVersion',
  '贴图精度 fast 只在贴图模型 v3.5-20260815 上可用：请把贴图版本切到该版本',
  'texture_quality=fast requires texture model v3.5-20260815: switch the texture version'
)

// ── 模型版本与枚举 ──

/** 网格分割 v1：几何拓扑 */
export const TRIPO_SEGMENT_MODEL_V1 = 'v1.0-20250506'
/** 网格分割 v2（Beta）：语义标注 + 几何 */
export const TRIPO_SEGMENT_MODEL_V2 = 'v2.0-20260430'
/** 智能分割 model 模式要求的列主序 4×4 单位矩阵 */
export const TRIPO_SEGMENT_IDENTITY_TRANSFORM = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
/** 部件补全模型版本（当前仅一版） */
export const TRIPO_COMPLETE_MODEL = 'v1.0-20250506'
/** 重拓扑算法版本：智能（v2.0）/ 基础减面（v1.0） */
export const TRIPO_RETOPOLOGY_MODEL_SMART = 'v2.0'
export const TRIPO_RETOPOLOGY_MODEL_BASIC = 'v1.0'
/** 独立蒙皮模型版本：v1.0 只支持双足，v2.5 支持非人形生物 */
export const TRIPO_RIG_BIPED = 'v1.0-20240301'
export const TRIPO_RIG_CREATURE = 'v2.5-20260210'
/** 贴图模型默认版本（官方默认；fast 需要 v3.5-20260815） */
export const TRIPO_TEXTURE_MODEL_DEFAULT = 'v3.0-20250812'
/** fast 档唯一可用的贴图模型版本 */
export const TRIPO_TEXTURE_MODEL_FAST = 'v3.5-20260815'

const TEXTURE_MODELS = ['v3.5-20260815', 'v3.0-20250812', 'v2.5-20250123'] as const
const CONVERT_FORMATS: readonly string[] = ['GLTF', 'FBX', 'USDZ', 'OBJ', 'STL', '3MF']
const TEXTURE_FORMATS: readonly string[] = [
  'JPEG',
  'PNG',
  'WEBP',
  'BMP',
  'DPX',
  'HDR',
  'OPEN_EXR',
  'TARGA',
  'TIFF'
]
const TEXTURE_QUALITIES: readonly string[] = ['fast', 'standard', 'detailed', 'extreme']
const TEXTURE_ALIGNMENTS: readonly string[] = ['original_image', 'geometry']
const FBX_PRESETS: readonly string[] = ['blender', '3dsmax', 'mixamo', 'bake_scale']
const EXPORT_ORIENTATIONS: readonly string[] = ['+x', '-x', '+y', '-y']

/** 任务查询路径（拆分 / 后处理 / 蒙皮共用） */
const TASK_PATH = '/v3/tasks'

// ── base URL / 状态 / 输入判定 ──

/** 旧 Key 里粘的 v2 域名与后缀一律归一到 v3 域名 */
function resolveTripoBase(raw: string | undefined): string {
  let url = (raw || '').trim().replace(/\/+$/, '')
  url = url.replace(/\/v2\/openapi$/i, '').replace(/\/v3$/i, '')
  url = url.replace(
    /^https?:\/\/api\.tripo3d\.(ai|com)/i,
    (_m, tld: string) => `https://openapi.tripo3d.${tld.toLowerCase()}`
  )
  return url || 'https://openapi.tripo3d.ai'
}

function mapStatus(raw: string | undefined): VideoPollResult['status'] {
  const s = (raw ?? '').toLowerCase()
  if (s === 'success' || s === 'succeeded' || s === 'completed') return 'completed'
  if (s === 'failed' || s === 'error' || s === 'cancelled' || s === 'canceled') return 'failed'
  if (s === 'running' || s === 'processing' || s === 'in_progress') return 'in_progress'
  return 'pending'
}

function isGlbSource(raw: string): boolean {
  const path = raw.split(/[?#]/)[0] ?? ''
  return /\.glb$/i.test(path)
}

/** 任务输入的公共取值：优先上游任务 id，其次公网 URL */
function resolveTaskInput(
  input: Pick<Model3dPostProcessInput, 'providerTaskId'>,
  source: string | undefined,
  op: Model3dPostProcessInput['op'],
  requireTaskId: boolean
): string {
  const taskId = input.providerTaskId?.trim()
  if (taskId) return taskId
  if (requireTaskId) throw fail(E_NO_TASK, { op })
  const url = source?.trim()
  if (!url) throw fail(E_NO_URL)
  return url
}

/** UI 骨架类型 → Tripo rig_type */
export function mapTripoRigType(raw: string | undefined): string {
  const key = (raw || 'humanoid').trim().toLowerCase()
  if (key === 'quadruped') return 'quadruped'
  if (key === 'hexapod') return 'hexapod'
  if (key === 'octopod') return 'octopod'
  if (key === 'avian' || key === 'creature') return 'avian'
  if (key === 'serpentine') return 'serpentine'
  if (key === 'aquatic') return 'aquatic'
  return 'biped'
}

// ── 请求体构造 ──

const POST_PROCESS_PATH: Record<Model3dPostProcessOp, string> = {
  meshComplete: '/v3/mesh/complete',
  retopology: '/v3/mesh/decimate',
  retarget: '/v3/animations/retarget',
  convert: '/v3/models/convert',
  texture: '/v3/models/texture',
  // rigCheck 走独立提交路径，这里只为类型完备
  rigCheck: '/v3/animations/rig-check'
}

function buildPostProcessBody(input: Model3dPostProcessInput & { source: string }) {
  if (input.op === 'meshComplete') {
    const body: Record<string, unknown> = {
      input: resolveTaskInput(input, input.source, input.op, true),
      model: TRIPO_COMPLETE_MODEL
    }
    const parts = input.partNames?.map((name) => name.trim()).filter(Boolean) ?? []
    if (parts.length) body.part_names = parts
    if (input.completionMode) body.completion_mode = input.completionMode
    return body
  }

  if (input.op === 'retopology') {
    const basic = input.retopologyMode === 'basic'
    const body: Record<string, unknown> = {
      input: resolveTaskInput(input, input.source, input.op, false),
      model: basic ? TRIPO_RETOPOLOGY_MODEL_BASIC : TRIPO_RETOPOLOGY_MODEL_SMART
    }
    if (typeof input.faceLimit === 'number' && input.faceLimit > 0) {
      body.face_limit = Math.round(input.faceLimit)
    }
    if (input.quad) body.quad = true
    // v1.0 基础减面不支持 bake / part_names
    if (!basic) {
      if (input.bake !== undefined) body.bake = input.bake
      const parts = input.partNames?.map((name) => name.trim()).filter(Boolean) ?? []
      if (parts.length) body.part_names = parts
    }
    return body
  }

  if (input.op === 'rigCheck') {
    const source = resolveTaskInput(input, input.source, input.op, false)
    if (!source.startsWith('task_') && !isGlbSource(source)) throw fail(E_RIG_CHECK_NOT_GLB)
    return { input: source }
  }

  if (input.op === 'convert') {
    const format = (input.format ?? '').trim().toUpperCase()
    if (!CONVERT_FORMATS.includes(format)) throw fail(E_NO_FORMAT)
    const body: Record<string, unknown> = {
      input: resolveTaskInput(input, input.source, input.op, false),
      format
    }
    if (input.quad) body.quad = true
    if (input.forceSymmetry !== undefined) body.force_symmetry = input.forceSymmetry
    if (typeof input.faceLimit === 'number' && input.faceLimit > 0) {
      body.face_limit = Math.round(input.faceLimit)
    }
    if (input.flattenBottom !== undefined) body.flatten_bottom = input.flattenBottom
    if (typeof input.flattenBottomThreshold === 'number') {
      body.flatten_bottom_threshold = input.flattenBottomThreshold
    }
    if (typeof input.textureSize === 'number' && input.textureSize > 0) {
      body.texture_size = Math.round(input.textureSize)
    }
    const textureFormat = (input.textureFormat ?? '').trim().toUpperCase()
    if (TEXTURE_FORMATS.includes(textureFormat)) body.texture_format = textureFormat
    if (input.bake !== undefined) body.bake = input.bake
    if (input.packUv !== undefined) body.pack_uv = input.packUv
    if (input.exportVertexColors !== undefined) {
      body.export_vertex_colors = input.exportVertexColors
    }
    if (input.pivotToCenterBottom !== undefined) {
      body.pivot_to_center_bottom = input.pivotToCenterBottom
    }
    if (typeof input.scaleFactor === 'number' && input.scaleFactor > 0) {
      body.scale_factor = input.scaleFactor
    }
    if (input.withAnimation !== undefined) body.with_animation = input.withAnimation
    const fbxPreset = (input.fbxPreset ?? '').trim().toLowerCase()
    if (FBX_PRESETS.includes(fbxPreset)) body.fbx_preset = fbxPreset
    if (input.exportOrientation && EXPORT_ORIENTATIONS.includes(input.exportOrientation)) {
      body.export_orientation = input.exportOrientation
    }
    if (input.animateInPlace !== undefined) body.animate_in_place = input.animateInPlace
    const parts = input.partNames?.map((name) => name.trim()).filter(Boolean) ?? []
    if (parts.length) body.part_names = parts
    return body
  }

  if (input.op === 'texture') {
    const version = (input.textureVersion ?? '').trim()
    const model = TEXTURE_MODELS.includes(version as (typeof TEXTURE_MODELS)[number])
      ? version
      : TRIPO_TEXTURE_MODEL_DEFAULT
    const quality = (input.textureQuality ?? '').trim().toLowerCase()
    // fast 只在 v3.5-20260815 上有效，其它版本会被上游 1004 拒掉——提前拦下更清楚
    if (quality === 'fast' && model !== TRIPO_TEXTURE_MODEL_FAST) {
      throw fail(E_TEXTURE_FAST_VERSION)
    }
    const body: Record<string, unknown> = {
      input: resolveTaskInput(input, input.source, input.op, false),
      model
    }
    const promptText = input.texturePromptText?.trim()
    if (promptText) body.texture_prompt = { text: promptText }
    if (input.pbr !== undefined) body.pbr = input.pbr
    if (typeof input.textureSeed === 'number') body.texture_seed = Math.round(input.textureSeed)
    const alignment = (input.textureAlignment ?? '').trim().toLowerCase()
    if (TEXTURE_ALIGNMENTS.includes(alignment)) body.texture_alignment = alignment
    if (TEXTURE_QUALITIES.includes(quality)) body.texture_quality = quality
    if (input.delight !== undefined) body.delight = input.delight
    if (input.compress) body.compress = input.compress
    if (input.bake !== undefined) body.bake = input.bake
    const parts = input.partNames?.map((name) => name.trim()).filter(Boolean) ?? []
    if (parts.length) body.part_names = parts
    return body
  }

  // retarget：只吃 rig 任务 id
  const body: Record<string, unknown> = {
    input: resolveTaskInput(input, input.source, input.op, true)
  }
  const list = input.animations?.map((id) => id.trim()).filter(Boolean) ?? []
  const single = input.animation?.trim()
  if (list.length) body.animations = list
  else if (single) body.animation = single
  else throw fail(E_NO_ANIMATION)
  if (input.outFormat) body.out_format = input.outFormat
  if (input.bakeAnimation !== undefined) body.bake_animation = input.bakeAnimation
  if (input.exportWithGeometry !== undefined) {
    body.export_with_geometry = input.exportWithGeometry
  }
  if (input.animateInPlace !== undefined) body.animate_in_place = input.animateInPlace
  return body
}

type TripoTaskPayload = {
  data?: {
    status?: string
    progress?: number
    error_message?: string
    output?: {
      model_url?: string
      base_model_url?: string
      pbr_model_url?: string
      rigged_model_url?: string
      seg_model_url?: string
      mask_url?: string
      prompt?: string
      seg_task_id?: string
      riggable?: boolean
      rig_type?: string
    }
  }
}

export const tripoMeshOps: MeshOpsDialect = {
  kind: 'tripo',

  createClient(provider: ModelProviderInstance, timeoutMs = 120_000) {
    return createProviderHttpClient(
      { ...provider, baseUrl: resolveTripoBase(provider.baseUrl) },
      timeoutMs
    )
  },

  parseSubmit(payload: unknown): string | undefined {
    const taskId = (payload as { data?: { task_id?: string } } | undefined)?.data?.task_id
    return taskId?.trim() || undefined
  },

  /** Tripo 任务 id 一律 `task_` 前缀 */
  acceptsTaskId(taskId: string): boolean {
    return /^task_/i.test(taskId.trim())
  },

  buildRigRequest(input): MeshOpsRequest {
    const rigType = mapTripoRigType(input.rigType)
    // spec / out_format 只有 Tripo 认；非法值一律回落到可用默认，避免上游 400
    const spec = input.spec === 'tripo' ? 'tripo' : 'mixamo'
    const outFormat = input.outFormat === 'fbx' ? 'fbx' : 'glb'
    return {
      path: '/v3/animations/rig',
      body: {
        input: input.source,
        model: rigType === 'biped' ? TRIPO_RIG_BIPED : TRIPO_RIG_CREATURE,
        rig_type: rigType,
        spec,
        out_format: outFormat
      }
    }
  },

  buildSegmentRequest(input): MeshOpsRequest {
    if (input.mode === 'smart') {
      if (!isGlbSource(input.source)) throw fail(E_SEG_SMART_NOT_GLB)
      const body: Record<string, unknown> = {
        input: input.source,
        seg_type: 'model',
        transform: TRIPO_SEGMENT_IDENTITY_TRANSFORM
      }
      if (input.smartGranularity) body.granularity = input.smartGranularity
      const hint = input.hint?.trim()
      if (hint) body.hint = hint
      return { path: '/v3/mesh/smartsegment', body }
    }

    const body: Record<string, unknown> = { input: input.source }
    if (input.granularity || input.splitByConnectivity === false) {
      body.model = TRIPO_SEGMENT_MODEL_V2
      if (input.granularity) body.segmentation_granularity = input.granularity
      if (input.splitByConnectivity !== undefined) {
        body.split_by_connectivity = input.splitByConnectivity
      }
    }
    return { path: '/v3/mesh/segment', body }
  },

  buildPostProcessRequest(input): MeshOpsRequest {
    return { path: POST_PROCESS_PATH[input.op], body: buildPostProcessBody(input) }
  },

  /** Tripo 所有任务共用 `GET /v3/tasks/{id}` */
  pollPath(_op, taskId: string): string {
    return `${TASK_PATH}/${taskId}`
  },

  parseTask(_op: MeshOp | Model3dPostProcessOp, payload: unknown): MeshOpsTaskParseResult {
    const task = (payload as TripoTaskPayload)?.data
    const status = mapStatus(task?.status)
    const progress = typeof task?.progress === 'number' ? task.progress : undefined
    const output = task?.output
    const result: MeshOpsTaskParseResult = {
      status,
      ...(progress !== undefined ? { progress } : {})
    }

    if (status === 'failed') {
      const message = task?.error_message?.trim()
      if (message) result.error = message
      return result
    }

    if (status !== 'completed') return result

    const downloadUrl =
      output?.rigged_model_url?.trim() ||
      output?.seg_model_url?.trim() ||
      output?.model_url?.trim() ||
      output?.pbr_model_url?.trim() ||
      output?.base_model_url?.trim()
    if (downloadUrl) result.downloadUrl = downloadUrl
    if (typeof output?.riggable === 'boolean') result.riggable = output.riggable
    const rigType = output?.rig_type?.trim()
    if (rigType) result.rigType = rigType

    const maskUrl = output?.mask_url?.trim()
    const description = output?.prompt?.trim()
    const segTaskId = output?.seg_task_id?.trim()
    if (maskUrl || description || segTaskId) {
      result.extras = {
        ...(maskUrl ? { maskUrl } : {}),
        ...(description ? { description } : {}),
        ...(segTaskId ? { segTaskId } : {})
      }
    }
    return result
  }
}

/** 任务查询路径（轮询统一走这里） */
export function tripoTaskPath(taskId: string): string {
  return `${TASK_PATH}/${taskId}`
}
