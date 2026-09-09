/**
 * 图标「逐枚精修回炉」共享纯逻辑层。
 *
 * 场景：gameIcons 一类整版 3×3 图标表 → image.gridSplit 切 9 枚 → image.iconPack 打包交付。
 * 某一枚不满意时，用户对这枚做「回炉」：重新绘制单枚图标 → 走与打包一致的
 * 键控透明 / 统一对齐出口替换该枚 PNG。
 *
 * 本模块负责把「要回炉的那一枚」在宿主图里的上下文解析出来（纯函数、可单测）：
 * - 该枚的名字（iconPack 的名单 in-text，按 row-major 顺序对齐 cellKey）；
 * - 画风主题句（喂给整版节点但没喂给打包节点的静态文本，避免把整版名单当主题）；
 * - 上游整版节点的标题 / 生成指令（作生成参数克隆来源）；
 * - 打包节点的 mediaOutputDir（回炉写回目录）。
 * 以及据此组装「单枚精修」的生图指令。
 */
import { readImageGridSplitFromNode } from './imageGridSplit'
import { parseIconCellKey, readIconPackFromNode } from './iconPack'
import type { GraphDocument, GraphEdge, GraphNode } from './types'

export { parseIconCellKey } from './iconPack'

/** 单枚回炉入口参数：宿主图中一次 gridSplit 的某一格位 */
export interface IconRefineCellRef {
  splitNodeId: string
  /** 格位 key，如 1-1 / 2-3 */
  cellKey: string
  row1: number
  col1: number
  /** 名单 row-major 序号（0-based） */
  index: number
  rows: number
  cols: number
}

/** 同源打包节点（写回目标）：名单 / 输出目录 */
export interface IconRefinePackRef {
  nodeId: string
  /** 名单行（按整版表 row-major 顺序，缺格为空行剔除） */
  names: string[]
  rows: number
  cols: number
  /** 透明 PNG 落盘目录（节点 mediaOutputDir） */
  mediaOutputDir?: string
}

/** 解析出的「这一枚」精修上下文 */
export interface IconRefineContext extends IconRefineCellRef {
  /** 该枚在打包名单里的名字；解析不到（无同源打包 / 名单不足）时为 null */
  name: string | null
  /** 上游整版节点（gridSplit 的 image 入边来源，类型 asset.image） */
  sheetNodeId?: string
  sheetTitle?: string
  /** 整版节点 generateInstruction（作生成参数/风格参考克隆来源） */
  sheetInstruction?: string
  /** 画风主题句：喂给整版节点、但未喂给打包节点的静态文本 */
  themeTexts: string[]
  /** 同源打包节点；未找到时为 null */
  pack: IconRefinePackRef | null
}

/** 单枚精修指令组装参数 */
export interface IconRefineInstructionOptions {
  locale?: 'zh' | 'en'
  /** 用户针对不满意的修正说明；空则按整版同规范重画该枚 */
  hint?: string
}

/** 名单文本行解析：去空白行与 # / // 注释（与 image.iconPack 执行器一致） */
function textLinesOf(node: GraphNode | undefined): string[] {
  const raw = node?.params?.text
  if (typeof raw !== 'string') return []
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && !line.startsWith('//'))
}

function isTextProvider(node: GraphNode | undefined): node is GraphNode {
  return Boolean(node && typeof node.params?.text === 'string')
}

function findNode(doc: GraphDocument, nodeId: string): GraphNode | undefined {
  return doc.nodes.find((n) => n.id === nodeId)
}

/** 连入某节点的入边（target 为该节点；targetPort 缺省视为 in） */
function incomingEdgesTo(doc: GraphDocument, nodeId: string, port?: string): GraphEdge[] {
  return doc.edges.filter(
    (e) =>
      e.target === nodeId &&
      ((e.targetPort ?? 'in') === port || port === undefined)
  )
}

/** 某节点出边的目标节点 id 集合（按端口过滤可选） */
function outgoingTargetIds(doc: GraphDocument, nodeId: string, port?: string): string[] {
  return doc.edges
    .filter(
      (e) =>
        e.source === nodeId &&
        ((e.sourcePort ?? 'out') === port || port === undefined)
    )
    .map((e) => e.target)
}

/**
 * 在宿主图里解析「gridSplit 第 cellKey 格」的回炉上下文。
 * 找不到 gridSplit 节点 / 格位非法 / 格位越界时返回 null。
 */
export function resolveIconRefineContext(
  doc: GraphDocument | null | undefined,
  splitNodeId: string,
  cellKey: string
): IconRefineContext | null {
  if (!doc || !splitNodeId?.trim()) return null
  const split = findNode(doc, splitNodeId)
  if (!split || split.typeId !== 'image.gridSplit') return null
  const splitState = readImageGridSplitFromNode(split.params)
  const rc = parseIconCellKey(cellKey)
  if (!rc || rc.row1 > splitState.rows || rc.col1 > splitState.cols) return null

  const rows = splitState.rows
  const cols = splitState.cols
  const index = (rc.row1 - 1) * cols + (rc.col1 - 1)
  const cellRef: IconRefineCellRef = {
    splitNodeId,
    cellKey,
    row1: rc.row1,
    col1: rc.col1,
    index,
    rows,
    cols
  }

  // 1) 上游整版节点：gridSplit 的 image 入边来源（asset.image）
  const imageIn = incomingEdgesTo(doc, split.id, 'in')
  let sheetNodeId: string | undefined
  for (const edge of imageIn) {
    const source = findNode(doc, edge.source)
    if (source && source.typeId === 'asset.image') {
      sheetNodeId = source.id
      break
    }
  }
  const sheet = sheetNodeId ? findNode(doc, sheetNodeId) : undefined

  // 2) 同源打包节点：与整版同源的 image.iconPack（row-major 名单对齐格位）
  const packIds = sheet ? outgoingTargetIds(doc, sheet.id, 'out') : []
  let packRef: IconRefinePackRef | null = null
  for (const packId of packIds) {
    const packNode = findNode(doc, packId)
    if (!packNode || packNode.typeId !== 'image.iconPack') continue
    const names = incomingEdgesTo(doc, packId, 'in-text')
      .flatMap((edge) => textLinesOf(findNode(doc, edge.source)))
    if (!names.length) continue
    const packState = readIconPackFromNode(packNode.params)
    const pRows = packState.rows || rows
    const pCols = packState.cols || cols
    packRef = {
      nodeId: packNode.id,
      names,
      rows: pRows,
      cols: pCols,
      mediaOutputDir:
        typeof packNode.params?.mediaOutputDir === 'string' && packNode.params.mediaOutputDir.trim()
          ? packNode.params.mediaOutputDir.trim()
          : undefined
    }
    break
  }

  // 3) 画风主题句：喂给整版节点但未喂给打包节点的文本（名单整块被排除）
  const packNodeIds = new Set(
    doc.edges.filter((e) => e.source === sheet?.id).map((e) => e.target)
  )
  const themeTexts: string[] = []
  if (sheet) {
    for (const edge of incomingEdgesTo(doc, sheet.id)) {
      const source = findNode(doc, edge.source)
      if (!isTextProvider(source)) continue
      const feedsPack = doc.edges.some(
        (e) => e.source === source.id && packNodeIds.has(e.target)
      )
      if (feedsPack) continue
      themeTexts.push(...textLinesOf(source))
    }
  }

  let name: string | null = null
  if (packRef) {
    const nameIndex = (rc.row1 - 1) * packRef.cols + (rc.col1 - 1)
    if (nameIndex >= 0 && nameIndex < packRef.names.length) {
      name = packRef.names[nameIndex]!
    }
  }

  return {
    ...cellRef,
    name,
    sheetNodeId: sheet?.id,
    sheetTitle: sheet?.title,
    sheetInstruction:
      typeof sheet?.params?.generateInstruction === 'string'
        ? sheet.params.generateInstruction
        : undefined,
    themeTexts,
    pack: packRef
  }
}

/** 从整版节点标题推导用途分类（如「技能图标·整版」→「技能图标」）；无则空串 */
export function refineCategoryOf(sheetTitle: string | undefined): string {
  if (!sheetTitle?.trim()) return ''
  return sheetTitle
    .trim()
    .replace(/·.*$/, '')
    .replace(/[（(].*[)）]$/, '')
    .trim()
}

/**
 * 组装单枚精修生图指令。
 * 该枚画面会与整版其余图标拼版共存，因此指令强调「与整版同风格同规范、仅重画本枚」。
 */
export function buildIconRefineInstruction(
  ctx: IconRefineContext | null | undefined,
  options?: IconRefineInstructionOptions
): string {
  const zh = (options?.locale ?? 'zh') !== 'en'
  const hint = options?.hint?.trim()
  const subject = ctx?.name?.trim() || (ctx ? `${ctx.row1}-${ctx.col1}` : '')
  const category = refineCategoryOf(ctx?.sheetTitle)
  const theme = (ctx?.themeTexts ?? []).filter((t) => t.trim()).join('\n')
  const lines: string[] = []

  if (zh) {
    if (category) lines.push(`用途分类：${category}。`)
    if (theme) lines.push(`画风主题：${theme}。`)
    lines.push(
      subject
        ? `绘制一枚方形图标卡片，主体为「${subject}」的单枚图标，画面中央留统一安全边距。`
        : `绘制一枚方形图标卡片，主体画面中央留统一安全边距。`
    )
    lines.push(
      '风格与同版其余图标保持一致：等线宽描边、统一圆角与内边距比例、主体简洁高对比（小尺寸可辨）、不画文字 / 网格线 / 外框 / 背景图案，画面仅一枚图标。'
    )
    if (hint) lines.push(`针对不满意点修正：${hint}。`)
  } else {
    if (category) lines.push(`Category: ${category}.`)
    if (theme) lines.push(`Art style theme: ${theme}.`)
    lines.push(
      subject
        ? `Draw a single square icon card whose subject is “${subject}”, centered with a uniform safe margin.`
        : `Draw a single square icon card, subject centered with a uniform safe margin.`
    )
    lines.push(
      'Keep the style consistent with sibling icons in the same sheet: even stroke width, unified corner radius and inner padding ratio, simple high-contrast subject readable at small sizes, no text / grid lines / frames / background patterns; only one icon on the canvas.'
    )
    if (hint) lines.push(`Fix the reported issue: ${hint}.`)
  }

  return lines.join('\n').trim()
}
