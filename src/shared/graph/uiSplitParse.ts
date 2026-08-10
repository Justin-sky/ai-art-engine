import { stripJsonCodeFence } from './jsonFence'
import { createNodeFromType } from './create'
import {
  GRAPH_BOUNDARY_INPUT_TYPE_ID,
  GRAPH_BOUNDARY_OUTPUT_TYPE_ID,
  HOST_INTERFACE_FORMAT_VERSION,
  type HostInterfaceDocument
} from './hostInterface'
import { GraphPortType, type GraphDocument, type GraphEdge, type GraphNode } from './types'

export interface UiScreenPromptItem {
  id: string
  title: string
  prompt: string
}

/** UI界面拆分 dive 内图槽位上限（每条提示词一条输出链） */
export const UI_SPLIT_SLOT_CAP = 12

/** ui.split 内图资产的宿主接口：每条链一个提示词输入口 + 一个图片输出口 */
export function buildUiSplitHostInterface(
  screens: UiScreenPromptItem[]
): HostInterfaceDocument {
  const cap = Math.min(UI_SPLIT_SLOT_CAP, screens.length)
  const items = screens.slice(0, cap)
  return {
    version: HOST_INTERFACE_FORMAT_VERSION,
    inputs: items.map((screen, i) => ({
      id: `in-${i + 1}`,
      label: `提示词·${screen.title}`,
      dataType: GraphPortType.text,
      multiple: false
    })),
    outputs: items.map((screen, i) => ({
      id: `out-${i + 1}`,
      label: `图片·${screen.title}`,
      dataType: GraphPortType.image,
      multiple: false
    }))
  }
}

/**
 * 构建 ui.split 的 dive 内图：每个界面一条链
 * 提示词输入边界 → 图像生成（asset.image）→ 图片输出边界。
 * 提示词直接烘焙进边界节点 params.text，图像节点用空指令接收上游文本。
 */
export function buildUiSplitInnerGraph(screens: UiScreenPromptItem[]): GraphDocument {
  const nodes: GraphNode[] = []
  const edges: GraphEdge[] = []
  const cap = Math.min(UI_SPLIT_SLOT_CAP, screens.length)
  for (let i = 0; i < cap; i += 1) {
    const screen = screens[i]!
    const slot = i + 1
    const y = 80 * i + 40
    const inId = `graph-boundary-in-ui-${slot}`
    const imgId = `ui-img-${slot}`
    const outId = `graph-boundary-out-ui-${slot}`

    nodes.push({
      id: inId,
      typeId: GRAPH_BOUNDARY_INPUT_TYPE_ID,
      category: 'note',
      position: { x: 40, y },
      title: `提示词·${screen.title}`,
      params: {
        previewCollapsed: true,
        hostBoundaryPort: {
          portId: `in-${slot}`,
          dataType: GraphPortType.text,
          multiple: false
        },
        text: screen.prompt
      }
    })
    nodes.push(
      createNodeFromType(
        'asset.image',
        { x: 260, y },
        {
          id: imgId,
          title: `UI图·${screen.title}`,
          params: { generateAspectRatio: '9:16', styleImagesUseGlobal: true }
        }
      )
    )
    nodes.push({
      id: outId,
      typeId: GRAPH_BOUNDARY_OUTPUT_TYPE_ID,
      category: 'note',
      position: { x: 480, y },
      title: `图片·${screen.title}`,
      params: {
        previewCollapsed: true,
        hostBoundaryPort: {
          portId: `out-${slot}`,
          dataType: GraphPortType.image,
          multiple: false
        }
      }
    })
    edges.push({
      id: `ui-e-in-${slot}`,
      source: inId,
      target: imgId,
      sourcePort: 'out',
      targetPort: 'in'
    })
    edges.push({
      id: `ui-e-out-${slot}`,
      source: imgId,
      target: outId,
      sourcePort: 'out',
      targetPort: 'in'
    })
  }
  return { nodes, edges, groups: [], viewport: { x: 0, y: 0, zoom: 1 } }
}

function slugify(raw: string, index: number): string {
  const base = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return `ui-${base || `screen-${index + 1}`}`
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** 常见对象包裹键，兼容模型输出 {"screens": [...]} 等非标准形式 */
const WRAPPER_KEYS = ['screens', 'items', 'list', 'interfaces', 'ui', 'data', 'result', 'output']

function tryParseArray(text: string): unknown | null {
  try {
    return JSON.parse(text)
  } catch {
    // 容错：截取首个 [...] 再试（兼容对象包裹 / 前后附带说明文字）
    const start = text.indexOf('[')
    const end = text.lastIndexOf(']')
    if (start < 0 || end <= start) return null
    try {
      return JSON.parse(text.slice(start, end + 1))
    } catch {
      return null
    }
  }
}

function normalizeUiScreenRows(parsed: unknown[]): UiScreenPromptItem[] {
  const seen = new Set<string>()
  const items: UiScreenPromptItem[] = []
  for (let i = 0; i < parsed.length; i += 1) {
    const row = parsed[i]
    let title = ''
    let prompt = ''
    let id = ''
    if (typeof row === 'string') {
      prompt = row.trim()
      title = `界面 ${i + 1}`
    } else if (row && typeof row === 'object') {
      const obj = row as Record<string, unknown>
      title = asString(obj.title) || asString(obj.name) || asString(obj.screen) || `界面 ${i + 1}`
      prompt =
        asString(obj.prompt) ||
        asString(obj.text) ||
        asString(obj.content) ||
        asString(obj.description)
      id = asString(obj.id)
    }
    if (!prompt) continue
    let nextId = id || slugify(title, i)
    if (seen.has(nextId)) nextId = `${nextId}-${i + 1}`
    seen.add(nextId)
    items.push({ id: nextId, title, prompt })
  }
  return items
}

/** 容错：模型忽略 JSON 要求、输出 markdown 列表（- / * / 1. 标题：提示词）时逐行转条目 */
function parseUiScreenMarkdownList(text: string): UiScreenPromptItem[] {
  const items: UiScreenPromptItem[] = []
  const seen = new Set<string>()
  let index = 0
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*(?:[-*•]|\d+[.、)])\s*(.*)$/.exec(line)
    if (!match) continue
    const body = match[1]
      .replace(/\*\*([^*]*)\*\*/g, '$1')
      .replace(/`([^`]*)`/g, '$1')
      .trim()
    if (!body) continue
    const sep = body.search(/[:：]/)
    const title = sep > 0 ? body.slice(0, sep).trim() : `界面 ${index + 1}`
    const prompt = sep > 0 ? body.slice(sep + 1).trim() : body
    if (!prompt) continue
    let nextId = slugify(title, index)
    if (seen.has(nextId)) nextId = `${nextId}-${index + 1}`
    seen.add(nextId)
    items.push({ id: nextId, title, prompt })
    index += 1
  }
  return items
}

/**
 * 解析 UI 界面拆分模型输出：JSON 数组，每项含 title + prompt（或纯字符串）。
 */
export function parseUiScreenPrompts(raw: string): UiScreenPromptItem[] {
  const text = stripJsonCodeFence(raw)
  if (!text) return []

  let parsed = tryParseArray(text)

  // 容错：模型用对象包裹数组（{"screens": [...]} 等）
  if (parsed && !Array.isArray(parsed) && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>
    const wrapped =
      WRAPPER_KEYS.map((key) => obj[key]).find((value) => Array.isArray(value)) ??
      Object.values(obj).find((value) => Array.isArray(value))
    if (Array.isArray(wrapped)) parsed = wrapped
  }

  if (Array.isArray(parsed)) return normalizeUiScreenRows(parsed)

  // 容错：模型输出 markdown 列表时逐行兜底
  return parseUiScreenMarkdownList(text)
}
