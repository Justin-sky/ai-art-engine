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
  'wanimagetovideo'
])

const SEED_CLASSES = new Set([
  'ksampler',
  'ksampleradvanced',
  'randomnoise',
  'samplercustom',
  'samplercustomadvanced'
])

const LOAD_IMAGE_CLASSES = new Set(['loadimage', 'loadimagetensor'])

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

/** 把 UI 导出（nodes/links）或 { prompt } 包一层的 JSON 收成 API 图 */
export function unwrapComfyApiWorkflow(raw: unknown): ComfyApiWorkflow {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('workflow 不是对象')
  }
  const obj = raw as Record<string, unknown>
  if (Array.isArray(obj.nodes) || Array.isArray(obj.links)) {
    throw new Error('收到 UI 格式 workflow（含 nodes/links）。请导出 API 格式后再用。')
  }
  const prompt = obj.prompt
  if (prompt && typeof prompt === 'object' && !Array.isArray(prompt)) {
    return unwrapComfyApiWorkflow(prompt)
  }
  const workflow = obj.workflow
  if (workflow && typeof workflow === 'object' && !Array.isArray(workflow)) {
    const values = Object.values(workflow as Record<string, unknown>)
    if (values.some((v) => v && typeof v === 'object' && 'class_type' in (v as object))) {
      return workflow as ComfyApiWorkflow
    }
  }
  const values = Object.values(obj)
  if (values.some((v) => v && typeof v === 'object' && 'class_type' in (v as object))) {
    return obj as ComfyApiWorkflow
  }
  throw new Error('无法识别 ComfyUI API 格式 workflow')
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

export function injectComfyWorkflow(
  workflow: ComfyApiWorkflow,
  input: ComfyWorkflowInjectInput
): ComfyApiWorkflow {
  const next = cloneWorkflow(workflow)
  const nodes = Object.values(next)
  let filledPositive = false
  let filledNegative = false
  let imageIndex = 0

  for (const node of nodes) {
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
    }

    if (SIZE_CLASSES.has(cls)) {
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
      const frames = Math.max(1, Math.round(input.durationSec * 16))
      if ('length' in inputs && typeof inputs.length === 'number') inputs.length = frames
      if ('num_frames' in inputs && typeof inputs.num_frames === 'number') {
        inputs.num_frames = frames
      }
      if ('frames' in inputs && typeof inputs.frames === 'number') inputs.frames = frames
      if ('duration' in inputs && typeof inputs.duration === 'number') {
        inputs.duration = input.durationSec
      }
    }

    if (LOAD_IMAGE_CLASSES.has(cls) && input.imageFilenames?.[imageIndex]) {
      inputs.image = input.imageFilenames[imageIndex]
      imageIndex += 1
    }
  }

  return next
}
