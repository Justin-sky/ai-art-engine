import type { GraphNode } from './types'
import type { GraphNodeRunState, GraphValue } from './execute/types'
import { isProcessingAssetNode, isScriptShotParamsNode } from './nodeRole'

/** 记事本可写回的节点参数字段 */
export type GraphNodeTextField = 'text' | 'resultText'

export interface GraphNodeTextContent {
  text: string
  /** 可写回字段；null 表示仅只读展示 */
  field: GraphNodeTextField | null
}

/** 文本/剧本输出节点 */
export function isTextOutputNode(node: GraphNode): boolean {
  if (node.category !== 'output') return false
  return node.typeId === 'output.text' || node.params.outputKind === 'text'
}

/** 从运行时 GraphValue 提取可读文本 */
export function textFromGraphValue(value: GraphValue | undefined): string {
  if (!value) return ''
  if (value.kind === 'text') return value.text
  if (value.kind === 'texts') {
    return value.items
      .map((item) => item.text.trim())
      .filter(Boolean)
      .join('\n\n')
  }
  if (value.kind === 'output') {
    if (value.texts?.length) {
      return value.texts
        .map((item) => item.text.trim())
        .filter(Boolean)
        .join('\n\n')
    }
    return value.notes
      .map((item) => item.text.trim())
      .filter(Boolean)
      .join('\n\n')
  }
  return ''
}

/** 拆解 / 提取类工具：执行结果写在 params.text */
function isTextToolNode(node: GraphNode): boolean {
  return (
    node.typeId === 'narrative.split' ||
    node.typeId === 'screenplay.narrativeSplit' ||
    node.typeId === 'script.shotSplit' ||
    node.typeId === 'world.extract' ||
    node.typeId === 'prompt.optimize' ||
    node.typeId === 'image.toPrompt'
  )
}

/** 节点是否具备可打开的文本输出 / 正文 */
export function isNodeTextCapable(node: GraphNode): boolean {
  // 分镜参数走右侧 Inspector，不打开空记事本
  if (isScriptShotParamsNode(node)) return false
  if (node.category === 'note') return true
  if (node.typeId === 'note.text' || node.typeId === 'play.script') return true
  if (isTextToolNode(node)) return true
  if (isProcessingAssetNode(node) && node.assetType === 'screenplay') return true
  if (isTextOutputNode(node)) return true
  if (typeof node.params.resultText === 'string') return true
  if (typeof node.params.text === 'string' && node.params.text.length > 0) return true
  return false
}

function preferredField(node: GraphNode): GraphNodeTextField | null {
  if (isScriptShotParamsNode(node)) return null
  if (node.category === 'note' || node.typeId === 'note.text' || node.typeId === 'play.script') {
    return 'text'
  }
  if (isTextToolNode(node)) return 'text'
  if (isProcessingAssetNode(node) && node.assetType === 'screenplay') return 'text'
  if (isTextOutputNode(node)) return 'resultText'
  if (typeof node.params.resultText === 'string') return 'resultText'
  if (typeof node.params.text === 'string') return 'text'
  return null
}

/**
 * 解析节点用于「文本记事本」展示的内容。
 * 优先 live 运行输出，其次持久化的 resultText / text。
 */
export function resolveNodeTextContent(
  node: GraphNode,
  runState?: GraphNodeRunState | null
): GraphNodeTextContent | null {
  if (!isNodeTextCapable(node) && !textFromGraphValue(runState?.outputs?.out).trim()) {
    return null
  }

  const live = textFromGraphValue(runState?.outputs?.out)
  const field = preferredField(node)

  if (live.trim()) {
    return { text: live, field }
  }

  if (field === 'resultText') {
    return { text: node.params.resultText ?? '', field }
  }
  if (field === 'text') {
    return { text: node.params.text ?? '', field }
  }

  const fallback = node.params.resultText ?? node.params.text
  if (typeof fallback === 'string') {
    return {
      text: fallback,
      field: typeof node.params.resultText === 'string' ? 'resultText' : 'text'
    }
  }

  return isNodeTextCapable(node) ? { text: '', field } : null
}
