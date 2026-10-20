/**
 * 脚本节点（`script.run`）的契约与纯校验 —— 主进程 / 渲染进程 / 市场校验共用，无副作用。
 *
 * 设计要点（见规划文档）：
 * - 工作流 `plan` 仍只引用**已注册节点类型**；`script.run` 就是其中一种，代码是它的参数。
 * - 代码在**受限 JS 沙箱**（QuickJS WASM）里跑：无 fs / 无网络 / 无 require / 无宿主全局。
 * - 沙箱只能 `await om.<capability>(...)`，`capability` 必须在节点的 `capabilities` 白名单里声明；
 *   每个 `om.*` 都转发到应用治理过的 `ctx` 能力（提供商 / 密钥 / 配额 / 日志），不是后门。
 * - 从市场导入带脚本节点的工作流必须逐次同意（见 skillMarket 的识别与同意流）。
 */
import { GraphPortType, type GraphPortDataType, type GraphPortDef } from './types'

export const SCRIPT_RUN_TYPE_ID = 'script.run'

/** 沙箱里可注入的受控能力（白名单；默认一个都不开，由节点 `capabilities` 声明开启） */
export const SCRIPT_CAPABILITIES = [
  'generateText',
  'generateImage',
  'generateVideo',
  'generateSpeech',
  'resolveAssetImageUrl',
  'readProjectImageDataUrl',
  'saveMedia',
  'log'
] as const

export type ScriptCapability = (typeof SCRIPT_CAPABILITIES)[number]

export function isScriptCapability(value: unknown): value is ScriptCapability {
  return typeof value === 'string' && (SCRIPT_CAPABILITIES as readonly string[]).includes(value)
}

/** 脚本节点可声明的端口（dataType 复用现有图端口类型体系） */
export interface ScriptPortDecl {
  id: string
  dataType: GraphPortDataType
  label?: string
  multiple?: boolean
}

export interface ScriptPorts {
  inputs: ScriptPortDecl[]
  outputs: ScriptPortDecl[]
}

/** 资源上限（有默认、有硬顶；超限由沙箱中断） */
export interface ScriptLimits {
  timeoutMs: number
  memoryMb: number
}

export const SCRIPT_DEFAULT_LIMITS: ScriptLimits = { timeoutMs: 15_000, memoryMb: 128 }
export const SCRIPT_MAX_LIMITS: ScriptLimits = { timeoutMs: 120_000, memoryMb: 512 }
/** 单段代码长度上限：挡住异常大的 payload（市场内容不可信） */
export const SCRIPT_MAX_CODE_CHARS = 100_000

export const SCRIPT_DEFAULT_CODE = `export default async function ({ inputs, om, signal }) {
  // inputs: { [portId]: GraphValue[] }  snapshot of upstream values (plain JSON)
  // om: declared capabilities (e.g. om.generateImage), all governed by the app
  // return { [outPortId]: GraphValue }
  const text = inputs.in?.[0]?.text ?? ''
  return { out: { kind: 'text', text } }
}
`

/** 脚本节点参数（存在 node.params 里） */
export interface ScriptNodeParams {
  code: string
  ports: ScriptPorts
  capabilities: ScriptCapability[]
  limits: ScriptLimits
}

const DEFAULT_PORTS: ScriptPorts = {
  inputs: [{ id: 'in', dataType: GraphPortType.text, label: 'In' }],
  outputs: [{ id: 'out', dataType: GraphPortType.text, label: 'Out' }]
}

export function scriptNodeDefaultParams(): ScriptNodeParams {
  return {
    code: SCRIPT_DEFAULT_CODE,
    ports: { inputs: [...DEFAULT_PORTS.inputs], outputs: [...DEFAULT_PORTS.outputs] },
    capabilities: [],
    limits: { ...SCRIPT_DEFAULT_LIMITS }
  }
}

const PORT_ID_RE = /^[a-zA-Z][\w-]*$/

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Math.round(Number(value))
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

function isPortDataType(value: unknown): value is GraphPortDataType {
  return (
    typeof value === 'string' && (Object.values(GraphPortType) as readonly string[]).includes(value)
  )
}

/** 规范化端口声明：丢非法项、去重 id；空列表回落默认 */
function normalizePorts(raw: unknown, fallback: ScriptPortDecl[]): ScriptPortDecl[] {
  if (!Array.isArray(raw)) return fallback.map((p) => ({ ...p }))
  const seen = new Set<string>()
  const out: ScriptPortDecl[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const spec = item as Record<string, unknown>
    const id = typeof spec.id === 'string' ? spec.id.trim() : ''
    if (!PORT_ID_RE.test(id) || seen.has(id)) continue
    const dataType = isPortDataType(spec.dataType) ? spec.dataType : GraphPortType.text
    seen.add(id)
    out.push({
      id,
      dataType,
      ...(typeof spec.label === 'string' && spec.label.trim() ? { label: spec.label.trim() } : {}),
      ...(spec.multiple === true ? { multiple: true } : {})
    })
  }
  return out.length ? out : fallback.map((p) => ({ ...p }))
}

/** 从任意 node.params 读出规范化的脚本参数（宽容读取，脏字段回落默认） */
export function readScriptNodeParams(
  params: Record<string, unknown> | undefined
): ScriptNodeParams {
  const raw = (params ?? {}) as Record<string, unknown>
  const code = typeof raw.code === 'string' ? raw.code : SCRIPT_DEFAULT_CODE
  const portsRaw = (raw.ports ?? {}) as Record<string, unknown>
  const capabilities = Array.isArray(raw.capabilities)
    ? [...new Set(raw.capabilities.filter(isScriptCapability))]
    : []
  const limitsRaw = (raw.limits ?? {}) as Record<string, unknown>
  return {
    code: code.slice(0, SCRIPT_MAX_CODE_CHARS),
    ports: {
      inputs: normalizePorts(portsRaw.inputs, DEFAULT_PORTS.inputs),
      outputs: normalizePorts(portsRaw.outputs, DEFAULT_PORTS.outputs)
    },
    capabilities,
    limits: {
      timeoutMs: clampInt(
        limitsRaw.timeoutMs,
        SCRIPT_DEFAULT_LIMITS.timeoutMs,
        100,
        SCRIPT_MAX_LIMITS.timeoutMs
      ),
      memoryMb: clampInt(
        limitsRaw.memoryMb,
        SCRIPT_DEFAULT_LIMITS.memoryMb,
        16,
        SCRIPT_MAX_LIMITS.memoryMb
      )
    }
  }
}

/** 脚本节点的运行时端口定义（供注册表 / 执行引擎用） */
export function scriptNodePorts(params: ScriptNodeParams): GraphPortDef[] {
  const toPort = (p: ScriptPortDecl, direction: 'in' | 'out'): GraphPortDef => ({
    id: p.id,
    direction,
    dataType: p.dataType,
    multiple: p.multiple === true,
    ...(p.label ? { label: p.label } : {})
  })
  return [
    ...params.ports.inputs.map((p) => toPort(p, 'in')),
    ...params.ports.outputs.map((p) => toPort(p, 'out'))
  ]
}

export interface ScriptValidationIssue {
  path: string
  message: string
}

/**
 * 校验脚本节点参数（市场导入 / 保存前）。
 *
 * 严格拒绝：代码为空 / 超长、能力名未知、端口 id 非法或重名、资源超硬顶。
 * 这里**不执行**代码，也不做语法分析（语法错留给沙箱运行时报），只做结构与白名单校验 ——
 * 市场内容不可信，但不可信的是"它要跑什么能力 / 多大代价"，而不是"它语法对不对"。
 */
export function validateScriptNodeParams(params: ScriptNodeParams): ScriptValidationIssue[] {
  const issues: ScriptValidationIssue[] = []
  if (!params.code.trim()) issues.push({ path: 'code', message: 'code is empty' })
  if (params.code.length >= SCRIPT_MAX_CODE_CHARS) {
    issues.push({ path: 'code', message: `code exceeds ${SCRIPT_MAX_CODE_CHARS} chars` })
  }
  for (const cap of params.capabilities) {
    if (!isScriptCapability(cap))
      issues.push({ path: 'capabilities', message: `unknown capability: ${cap}` })
  }
  const check = (ports: ScriptPortDecl[], side: string): void => {
    const seen = new Set<string>()
    for (const p of ports) {
      if (!PORT_ID_RE.test(p.id))
        issues.push({ path: `${side}.${p.id}`, message: 'invalid port id' })
      if (seen.has(p.id)) issues.push({ path: `${side}.${p.id}`, message: 'duplicate port id' })
      seen.add(p.id)
    }
    if (ports.length === 0) issues.push({ path: side, message: 'at least one port required' })
  }
  check(params.ports.inputs, 'ports.inputs')
  check(params.ports.outputs, 'ports.outputs')
  if (params.limits.timeoutMs > SCRIPT_MAX_LIMITS.timeoutMs) {
    issues.push({ path: 'limits.timeoutMs', message: 'timeout exceeds hard cap' })
  }
  if (params.limits.memoryMb > SCRIPT_MAX_LIMITS.memoryMb) {
    issues.push({ path: 'limits.memoryMb', message: 'memory exceeds hard cap' })
  }
  return issues
}

/** 市场导入展示用的脚本摘要（同意流逐条列出） */
export interface ScriptNodeSummary {
  nodeKey: string
  title?: string
  capabilities: ScriptCapability[]
  codeChars: number
  /** FNV-1a 短 hash（展示 / 变更检测用，非安全用途） */
  codeHash: string
}

/** 轻量 FNV-1a hash（与 ids.ts 同族；此处独立以免 shared/graph 依赖 semanticTimeline） */
export function scriptCodeHash(code: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < code.length; i++) {
    h ^= code.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

/** plan 里一个节点的最小形状（market / 校验侧只需 key + typeId + params） */
export interface ScriptScannableNode {
  key?: unknown
  typeId?: unknown
  title?: unknown
  params?: unknown
}

/** 该节点是否为脚本节点（plan 总带显式 typeId，直接按 typeId 判定，不依赖注册表推断） */
export function isScriptRunNode(node: ScriptScannableNode): boolean {
  return typeof node.typeId === 'string' && node.typeId === SCRIPT_RUN_TYPE_ID
}

/** 为单个脚本节点生成展示摘要（同意流逐条列出用） */
export function scriptNodeSummary(node: ScriptScannableNode): ScriptNodeSummary {
  const params = readScriptNodeParams(
    node.params && typeof node.params === 'object'
      ? (node.params as Record<string, unknown>)
      : undefined
  )
  const title = typeof node.title === 'string' && node.title.trim() ? node.title.trim() : undefined
  return {
    nodeKey: typeof node.key === 'string' ? node.key : '',
    ...(title ? { title } : {}),
    capabilities: params.capabilities,
    codeChars: params.code.length,
    codeHash: scriptCodeHash(params.code)
  }
}

/**
 * 扫描 plan 节点列表，产出全部脚本节点摘要（按 nodeKey 稳定排序，便于比对 / 展示）。
 * 市场导入时用它判定「是否含可执行代码」并驱动同意流。
 */
export function scriptSummariesOfNodes(nodes: readonly ScriptScannableNode[]): ScriptNodeSummary[] {
  return nodes
    .filter(isScriptRunNode)
    .map(scriptNodeSummary)
    .sort((a, b) => a.nodeKey.localeCompare(b.nodeKey))
}

/** plan 是否含可执行代码（即是否存在 script.run 节点） */
export function planHasExecutableCode(nodes: readonly ScriptScannableNode[]): boolean {
  return nodes.some(isScriptRunNode)
}

/**
 * 校验 plan 里全部脚本节点的参数（市场导入前）。返回每个有问题节点的 issue 列表。
 * 内容不可信：代码空 / 超长、能力越白名单、端口非法、资源超硬顶都会被标出。
 */
export function validateScriptNodesInPlan(
  nodes: readonly ScriptScannableNode[]
): { nodeKey: string; issues: ScriptValidationIssue[] }[] {
  const out: { nodeKey: string; issues: ScriptValidationIssue[] }[] = []
  for (const node of nodes) {
    if (!isScriptRunNode(node)) continue
    const params = readScriptNodeParams(
      node.params && typeof node.params === 'object'
        ? (node.params as Record<string, unknown>)
        : undefined
    )
    const issues = validateScriptNodeParams(params)
    if (issues.length) {
      out.push({ nodeKey: typeof node.key === 'string' ? node.key : '', issues })
    }
  }
  return out
}

export interface ScriptNodeTemplate {
  id: 'textClean' | 'jsonRouter' | 'batchPromptMatrix' | 'aiImageRefine' | 'conditionalFilter'
  ports: ScriptPorts
  capabilities: ScriptCapability[]
  code: string
}

/** 内置商用脚本模板：一键配置端口、所需受控能力与示例代码 */
export const SCRIPT_NODE_TEMPLATES: readonly ScriptNodeTemplate[] = [
  {
    id: 'textClean',
    ports: {
      inputs: [{ id: 'in', dataType: GraphPortType.text, label: 'In' }],
      outputs: [{ id: 'out', dataType: GraphPortType.text, label: 'Out' }]
    },
    capabilities: [],
    code: `export default async function ({ inputs }) {
  const raw = inputs.in?.[0]?.text ?? ''
  // Strip markdown code fences, normalize whitespace, and remove empty lines
  const cleaned = raw
    .replace(/^\`\`\`[\\w-]*\\s*/i, '')
    .replace(/\`\`\`\\s*$/i, '')
    .split('\\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\\n')
  console.log('cleaned chars:', cleaned.length)
  return {
    out: { kind: 'text', text: cleaned }
  }
}
`
  },
  {
    id: 'jsonRouter',
    ports: {
      inputs: [{ id: 'in', dataType: GraphPortType.text, label: 'JSON In' }],
      outputs: [
        { id: 'outPrompt', dataType: GraphPortType.text, label: 'Prompt' },
        { id: 'outMeta', dataType: GraphPortType.text, label: 'Meta' }
      ]
    },
    capabilities: [],
    code: `export default async function ({ inputs }) {
  const raw = inputs.in?.[0]?.text ?? '{}'
  let data = {}
  try {
    const jsonBlock = raw.match(/\\{[\\s\\S]*\\}/)?.[0] ?? raw
    data = JSON.parse(jsonBlock)
  } catch (err) {
    console.warn('JSON parse fallback:', String(err))
    data = { prompt: raw }
  }
  const prompt = String(data.prompt || data.visualPrompt || data.text || raw).trim()
  const meta = JSON.stringify(
    { style: data.style ?? 'cinematic', aspectRatio: data.aspectRatio ?? '16:9', tags: data.tags ?? [] },
    null,
    2
  )
  console.log('routed prompt:', prompt.slice(0, 60))
  return {
    outPrompt: { kind: 'text', text: prompt },
    outMeta: { kind: 'text', text: meta }
  }
}
`
  },
  {
    id: 'batchPromptMatrix',
    ports: {
      inputs: [
        { id: 'inSubjects', dataType: GraphPortType.text, label: 'Subjects' },
        { id: 'inStyles', dataType: GraphPortType.text, label: 'Styles' }
      ],
      outputs: [{ id: 'out', dataType: GraphPortType.texts, label: 'Prompts' }]
    },
    capabilities: [],
    code: `export default async function ({ inputs }) {
  const splitLines = (s) =>
    String(s ?? '')
      .split(/\\r?\\n/)
      .map((x) => x.trim())
      .filter(Boolean)

  const subjects = splitLines(inputs.inSubjects?.[0]?.text || 'Cyberpunk detective\\nAncient mech guardian')
  const styles = splitLines(inputs.inStyles?.[0]?.text || '35mm film noir lighting\\nAnime cel-shaded key visual')

  const items = []
  for (const subject of subjects) {
    for (const style of styles) {
      items.push({ text: \`\${subject}, \${style}, ultra-detailed, masterpiece\` })
    }
  }
  console.log(\`matrix generated \${items.length} prompts (\${subjects.length} x \${styles.length})\`)
  return {
    out: { kind: 'texts', items }
  }
}
`
  },
  {
    id: 'aiImageRefine',
    ports: {
      inputs: [{ id: 'in', dataType: GraphPortType.text, label: 'Concept' }],
      outputs: [
        { id: 'out', dataType: GraphPortType.image, label: 'Image' },
        { id: 'outPrompt', dataType: GraphPortType.text, label: 'Prompt' }
      ]
    },
    capabilities: ['generateText', 'generateImage', 'saveMedia'],
    code: `export default async function ({ inputs, om }) {
  const concept = inputs.in?.[0]?.text?.trim() || 'A cinematic neon-lit alley in rainy Tokyo at night'
  console.log('1. Refining prompt with LLM...')
  const refined = await om.generateText({
    system: 'You are a visual prompt director. Output ONLY one vivid image generation prompt without markdown.',
    prompt: \`Expand this concept into a rich cinematic image prompt:\\n\${concept}\`
  })
  const finalPrompt = refined.text.trim() || concept
  console.log('2. Generating image:', finalPrompt.slice(0, 80))

  const imgRes = await om.generateImage({ prompt: finalPrompt, aspectRatio: '16:9' })
  const dataUrl = imgRes.images?.[0] ?? ''
  const relativePath = dataUrl ? await om.saveMedia({ dataUrl, key: 'script-img' }) : undefined

  return {
    out: { kind: 'image', dataUrl, ...(relativePath ? { relativePath } : {}) },
    outPrompt: { kind: 'text', text: finalPrompt }
  }
}
`
  },
  {
    id: 'conditionalFilter',
    ports: {
      inputs: [{ id: 'in', dataType: GraphPortType.texts, label: 'Items', multiple: true }],
      outputs: [
        { id: 'outMatched', dataType: GraphPortType.texts, label: 'Matched' },
        { id: 'outSummary', dataType: GraphPortType.text, label: 'Summary' }
      ]
    },
    capabilities: [],
    code: `export default async function ({ inputs }) {
  const rawList = inputs.in ?? []
  const allTexts = []
  for (const val of rawList) {
    if (Array.isArray(val.items)) {
      for (const item of val.items) {
        if (item?.text?.trim()) allTexts.push(item.text.trim())
      }
    } else if (typeof val.text === 'string' && val.text.trim()) {
      allTexts.push(val.text.trim())
    }
  }
  const matched = allTexts.filter((t) => t.length >= 10)
  console.log(\`filtered \${matched.length} / \${allTexts.length} items\`)
  return {
    outMatched: { kind: 'texts', items: matched.map((text) => ({ text })) },
    outSummary: { kind: 'text', text: matched.map((t, i) => \`[\${i + 1}] \${t}\`).join('\\n\\n') }
  }
}
`
  }
]

export interface ScriptRunDiagnostics {
  logs: Array<{ level: 'info' | 'warn' | 'error'; message: string }>
  runMs: number | null
  error: string
  runAt: string
}

/** 读取节点 params 上持久化的最近一次脚本执行诊断信息 */
export function readScriptRunDiagnostics(
  params: Record<string, unknown> | undefined
): ScriptRunDiagnostics {
  const raw = (params ?? {}) as Record<string, unknown>
  const logs: Array<{ level: 'info' | 'warn' | 'error'; message: string }> = []
  if (Array.isArray(raw.scriptLastLogs)) {
    for (const item of raw.scriptLastLogs) {
      if (!item || typeof item !== 'object') continue
      const entry = item as Record<string, unknown>
      const level = entry.level === 'warn' || entry.level === 'error' ? entry.level : 'info'
      const message = typeof entry.message === 'string' ? entry.message : ''
      if (message) logs.push({ level, message })
    }
  }
  const runMs =
    typeof raw.scriptLastRunMs === 'number' && Number.isFinite(raw.scriptLastRunMs)
      ? Math.max(0, Math.round(raw.scriptLastRunMs))
      : null
  const error = typeof raw.scriptLastError === 'string' ? raw.scriptLastError : ''
  const runAt = typeof raw.scriptLastRunAt === 'string' ? raw.scriptLastRunAt : ''
  return { logs, runMs, error, runAt }
}
