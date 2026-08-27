import { fail } from '@shared/errors/appError'
import { SHARED_ERRORS } from '../../errors/catalog'
import { convertComfyUiWorkflowToApi, isComfyUiGraphWorkflow } from './uiToApi'

export type ComfyApiNode = {
  class_type?: string
  inputs?: Record<string, unknown>
  _meta?: { title?: string }
}

export type ComfyApiWorkflow = Record<string, ComfyApiNode>

export type ComfyWorkflowInjectInput = {
  prompt: string
  negativePrompt?: string
  seed?: number
  width?: number
  height?: number
  durationSec?: number
  imageFilenames?: string[]
  firstFrameFilenames?: string[]
  lastFrameFilenames?: string[]
  videoFilenames?: string[]
  audioFilenames?: string[]
}

const PROMPT_CLASSES = new Set([
  'cliptextencode',
  'cliptextencodesdxl',
  'cliptextencodeflux',
  't5textencode',
  'cliptextencodehunyuan',
  'primitivestring'
])

const SIZE_CLASSES = new Set([
  'emptylatentimage',
  'emptysd3latentimage',
  'emptyhunyuanlatentvideo',
  'emptyltxvlatents',
  'wanimagetovideo',
  'minimaxh3imagetovideo',
  'minimaxh3referencetovideo'
])

const MINIMAX_H3_VIDEO_CLASSES = new Set([
  'emptyminimaxh3latentav',
  'minimaxh3imagetovideo',
  'minimaxh3referencetovideo'
])

const SEED_CLASSES = new Set([
  'ksampler',
  'ksampleradvanced',
  'randomnoise',
  'samplercustom',
  'samplercustomadvanced'
])

export const LOAD_IMAGE_CLASSES = new Set(['loadimage', 'loadimagetensor'])

/** 视频加载节点（VHS 插件 + 常见变体），注入键为 `video` */
export const LOAD_VIDEO_CLASSES = new Set([
  'vhs_loadvideo',
  'vhs_loadvideopath',
  'loadvideo',
  'loadvideopath'
])

/** 音频加载节点（VHS 插件 + 内置），注入键为 `audio_file` */
export const LOAD_AUDIO_CLASSES = new Set([
  'vhs_loadaudio',
  'vhs_loadaudiopath',
  'vhs_loadaudioupload',
  'loadaudio',
  'loadaudiopath'
])

function className(node: ComfyApiNode): string {
  return String(node.class_type ?? '').trim().toLowerCase()
}

function titleOf(node: ComfyApiNode): string {
  return String(node._meta?.title ?? '').toLowerCase()
}

function isNegativeNode(node: ComfyApiNode): boolean {
  const title = titleOf(node)
  if (/\bneg(ative)?\b/.test(title)) return true
  const text = String(node.inputs?.text ?? node.inputs?.text_g ?? '')
  return text.trim().toLowerCase() === 'negative'
}

function cloneWorkflow(workflow: ComfyApiWorkflow): ComfyApiWorkflow {
  return JSON.parse(JSON.stringify(workflow)) as ComfyApiWorkflow
}

function setText(node: ComfyApiNode, value: string): void {
  const inputs = (node.inputs ??= {})
  if ('text' in inputs || !('text_g' in inputs || 'text_l' in inputs)) inputs.text = value
  if ('text_g' in inputs) inputs.text_g = value
  if ('text_l' in inputs) inputs.text_l = value
  if ('value' in inputs && typeof inputs.value === 'string') inputs.value = value
}

function classTypesFromNode(node: Record<string, unknown>): string[] {
  const meta = node._meta
  const title =
    meta && typeof meta === 'object' ? String((meta as { title?: unknown }).title ?? '').trim() : ''
  return [String(node.type ?? '').trim(), String(node.class_type ?? '').trim(), title].filter(Boolean)
}

/** 从 API 图或 UI 工作流里抽出节点 class / type，供目录按模态分类。 */
export function collectComfyNodeClassTypes(raw: unknown): string[] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return []
  const obj = raw as Record<string, unknown>
  if (Array.isArray(obj.nodes)) {
    const types = obj.nodes
      .filter((node): node is Record<string, unknown> => Boolean(node && typeof node === 'object'))
      .flatMap(classTypesFromNode)
    const subgraphs = (obj.definitions as { subgraphs?: unknown } | undefined)?.subgraphs
    if (Array.isArray(subgraphs)) {
      for (const subgraph of subgraphs) {
        types.push(...collectComfyNodeClassTypes(subgraph))
      }
    }
    return types
  }
  const prompt = obj.prompt
  if (prompt && typeof prompt === 'object' && !Array.isArray(prompt)) {
    return collectComfyNodeClassTypes(prompt)
  }
  const workflow = obj.workflow
  if (workflow && typeof workflow === 'object' && !Array.isArray(workflow)) {
    const nested = collectComfyNodeClassTypes(workflow)
    if (nested.length) return nested
  }
  return Object.values(obj)
    .filter((node): node is Record<string, unknown> =>
      Boolean(node && typeof node === 'object' && ('class_type' in node || 'type' in node))
    )
    .flatMap(classTypesFromNode)
}

/** 把 UI 导出（nodes/links / subgraph）或 { prompt } 包一层的 JSON 收成 API 图 */
export function unwrapComfyApiWorkflow(raw: unknown): ComfyApiWorkflow {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw fail(SHARED_ERRORS.comfyuiWorkflowNotObject)
  }
  const obj = raw as Record<string, unknown>
  if (isComfyUiGraphWorkflow(obj)) {
    return convertComfyUiWorkflowToApi(obj)
  }
  const prompt = obj.prompt
  if (prompt && typeof prompt === 'object' && !Array.isArray(prompt)) {
    return unwrapComfyApiWorkflow(prompt)
  }
  const workflow = obj.workflow
  if (workflow && typeof workflow === 'object' && !Array.isArray(workflow)) {
    if (isComfyUiGraphWorkflow(workflow)) return convertComfyUiWorkflowToApi(workflow)
    const values = Object.values(workflow as Record<string, unknown>)
    if (values.some((v) => v && typeof v === 'object' && 'class_type' in (v as object))) {
      return workflow as ComfyApiWorkflow
    }
  }
  const values = Object.values(obj)
  if (values.some((v) => v && typeof v === 'object' && 'class_type' in (v as object))) {
    return obj as ComfyApiWorkflow
  }
  throw fail(SHARED_ERRORS.comfyuiUnrecognizedFormat)
}

export function sizeFromAspectRatio(
  aspectRatio?: string,
  resolution?: string
): { width: number; height: number } {
  const table: Record<string, [number, number]> = {
    '1:1': [1024, 1024],
    '16:9': [1280, 720],
    '9:16': [720, 1280],
    '4:3': [1024, 768],
    '3:4': [768, 1024],
    '3:2': [1152, 768],
    '2:3': [768, 1152],
    '21:9': [1536, 640]
  }
  const key = (aspectRatio ?? '1:1').trim()
  let [width, height] = table[key] ?? table['1:1']!
  const res = (resolution ?? '').toLowerCase()
  if (res.includes('2k') || res.includes('1080')) {
    width = Math.round(width * 1.5)
    height = Math.round(height * 1.5)
  }
  return { width, height }
}

/** MiniMax H3 视频按 24fps 计帧，帧数需落在 17k+5 网格上（与官方 ComfyMathExpression 一致）。 */
function minimaxH3FrameCount(durationSec: number): number {
  const raw = Math.max(5, Math.round(durationSec * 24))
  return raw + ((5 - (raw % 17)) % 17)
}

/** MiniMax H3 原生画布：768 短边 + 768*1344 面积上限，逐轴对齐到 32。 */
export function minimaxH3NativeSize(
  width: number,
  height: number
): { width: number; height: number } {
  const ratio = width / height
  const short = 768
  const maxPixels = 768 * 1344
  let w = ratio >= 1 ? short * ratio : short
  let h = ratio >= 1 ? short : short / ratio
  if (w * h > maxPixels) {
    const s = Math.sqrt(maxPixels / (w * h))
    w *= s
    h *= s
  }
  return {
    width: Math.max(32, Math.round(w / 32) * 32),
    height: Math.max(32, Math.round(h / 32) * 32)
  }
}

/** 图生视频节点的首帧 socket（MiniMax H3 first_frame / Wan start_image） */
const FIRST_FRAME_SOCKET_KEYS = ['first_frame', 'start_image'] as const
/** 图生视频节点的尾帧 socket（MiniMax H3 last_frame / Wan end_image） */
const LAST_FRAME_SOCKET_KEYS = ['last_frame', 'end_image'] as const

/**
 * 解析首帧 / 尾帧 socket 指向的 LoadImage 节点 id。
 * ComfyUI API 图里 `first_frame: ['114', 0]` 表示节点 114 的输出喂给该 socket，
 * 注入时需把首帧文件名写进 114（LoadImage），尾帧同理。
 */
function resolveFrameNodeIds(workflow: ComfyApiWorkflow): {
  firstFrameNodeIds: Set<string>
  lastFrameNodeIds: Set<string>
} {
  const first = new Set<string>()
  const last = new Set<string>()
  for (const node of Object.values(workflow)) {
    const inputs = node?.inputs
    if (!inputs || typeof inputs !== 'object') continue
    for (const key of FIRST_FRAME_SOCKET_KEYS) {
      const ref = inputs[key]
      if (Array.isArray(ref) && typeof ref[0] === 'string' && ref[0].trim()) first.add(ref[0])
    }
    for (const key of LAST_FRAME_SOCKET_KEYS) {
      const ref = inputs[key]
      if (Array.isArray(ref) && typeof ref[0] === 'string' && ref[0].trim()) last.add(ref[0])
    }
  }
  return { firstFrameNodeIds: first, lastFrameNodeIds: last }
}

export function injectComfyWorkflow(
  workflow: ComfyApiWorkflow,
  input: ComfyWorkflowInjectInput
): ComfyApiWorkflow {
  const next = cloneWorkflow(workflow)
  const { firstFrameNodeIds, lastFrameNodeIds } = resolveFrameNodeIds(next)
  let filledPositive = false
  let filledNegative = false
  let imageIndex = 0
  let firstFrameIndex = 0
  let lastFrameIndex = 0
  let videoIndex = 0
  let audioIndex = 0

  for (const [nodeId, node] of Object.entries(next)) {
    const cls = className(node)
    const inputs = (node.inputs ??= {})

    if (PROMPT_CLASSES.has(cls)) {
      if (isNegativeNode(node)) {
        if (!filledNegative && input.negativePrompt != null) {
          setText(node, input.negativePrompt)
          filledNegative = true
        }
      } else if (!filledPositive && input.prompt.trim()) {
        setText(node, input.prompt)
        filledPositive = true
      }
    } else if (
      !filledPositive &&
      input.prompt.trim() &&
      typeof inputs.prompt === 'string'
    ) {
      inputs.prompt = input.prompt
      filledPositive = true
    }

    if (SIZE_CLASSES.has(cls) || ('width' in inputs && 'height' in inputs && typeof inputs.width === 'number')) {
      if (input.width && input.height) {
        if ('width' in inputs || cls.startsWith('empty')) inputs.width = input.width
        if ('height' in inputs || cls.startsWith('empty')) inputs.height = input.height
      }
    }

    if (SEED_CLASSES.has(cls) && input.seed != null && Number.isFinite(input.seed)) {
      if ('seed' in inputs || cls === 'ksampler' || cls === 'randomnoise') {
        inputs.seed = Math.floor(input.seed)
      }
      if ('noise_seed' in inputs) inputs.noise_seed = Math.floor(input.seed)
    }

    if (input.durationSec != null && Number.isFinite(input.durationSec)) {
      const frames = MINIMAX_H3_VIDEO_CLASSES.has(cls)
        ? minimaxH3FrameCount(input.durationSec)
        : Math.max(1, Math.round(input.durationSec * 16))
      if ('length' in inputs) inputs.length = frames
      if ('num_frames' in inputs) inputs.num_frames = frames
      if ('frames' in inputs) inputs.frames = frames
      if ('duration' in inputs && typeof inputs.duration === 'number') {
        inputs.duration = input.durationSec
      }
    }

    if (LOAD_IMAGE_CLASSES.has(cls)) {
      if (lastFrameNodeIds.has(nodeId) && input.lastFrameFilenames?.[lastFrameIndex]) {
        inputs.image = input.lastFrameFilenames[lastFrameIndex]
        lastFrameIndex += 1
      } else if (firstFrameNodeIds.has(nodeId) && input.firstFrameFilenames?.[firstFrameIndex]) {
        inputs.image = input.firstFrameFilenames[firstFrameIndex]
        firstFrameIndex += 1
      } else if (input.imageFilenames?.[imageIndex]) {
        inputs.image = input.imageFilenames[imageIndex]
        imageIndex += 1
      }
    }

    if (LOAD_VIDEO_CLASSES.has(cls) && input.videoFilenames?.[videoIndex]) {
      inputs.video = input.videoFilenames[videoIndex]
      videoIndex += 1
    }

    if (LOAD_AUDIO_CLASSES.has(cls) && input.audioFilenames?.[audioIndex]) {
      inputs.audio_file = input.audioFilenames[audioIndex]
      audioIndex += 1
    }
  }

  return next
}
