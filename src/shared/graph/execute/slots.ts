import {
  GraphPortType,
  isGraphCatalogKind,
  isPluralGraphPortDataType,
  toSingularGraphPortDataType
} from '../types'
import { catalogValue } from '../catalogValue'
import { readHostInputSlot } from '../hostInput'
import type { GraphValue, NodeExecuteContext } from './types'
import {
  flattenImagesValues,
  flattenTextsValues,
  flattenVideosValues,
  flattenVoicesValues
} from './gallery'

export function executeNoteNode(ctx: NodeExecuteContext): Record<string, GraphValue> {
  const text = ctx.node.params.text?.trim() ?? ''
  return {
    out: { kind: 'text', text }
  }
}

export function executePlayScriptNode(ctx: NodeExecuteContext): Record<string, GraphValue> {
  const text = ctx.node.params.text?.trim() ?? ''
  return {
    out: { kind: 'text', text }
  }
}

/** 宿主编辑器输入接口槽：输出外层注入或节点上缓存的标量值 */
export async function executeHostInputSlotNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const slot = readHostInputSlot(ctx.node)
  const portType = slot?.dataType ?? GraphPortType.text
  const dataType = toSingularGraphPortDataType(portType)
  const plural = isPluralGraphPortDataType(portType)
  if (dataType === GraphPortType.text) {
    let text = ctx.node.params.text ?? ''
    const path = ctx.node.params.previewRelativePath?.trim()
    if (!text.trim() && path && ctx.readRunText) {
      try {
        text = (await ctx.readRunText(path))?.trim() ?? ''
      } catch {
        text = ''
      }
      if (text) {
        ctx.node.params = { ...ctx.node.params, text }
        ctx.patchNode?.({ params: { text } })
      }
    }
    if (plural) {
      return {
        out: {
          kind: 'texts',
          items: text.trim() || path ? [{ text, ...(path ? { relativePath: path } : {}) }] : []
        }
      }
    }
    return {
      out: {
        kind: 'text',
        text,
        ...(path ? { relativePath: path } : {})
      }
    }
  }
  if (dataType === GraphPortType.image) {
    const path = ctx.node.params.previewRelativePath?.trim()
    const dataUrl = ctx.node.params.previewDataUrl?.trim() ?? ''
    if (plural) {
      return {
        out: {
          kind: 'images',
          items: dataUrl || path ? [{ dataUrl, relativePath: path }] : []
        }
      }
    }
    return {
      out: {
        kind: 'image',
        dataUrl,
        relativePath: path || undefined
      }
    }
  }
  if (dataType === GraphPortType.video) {
    const path = ctx.node.params.previewRelativePath?.trim()
    const dataUrl = ctx.node.params.previewDataUrl?.trim()
    if (plural) {
      return {
        out: {
          kind: 'videos',
          items: dataUrl || path ? [{ dataUrl: dataUrl ?? '', relativePath: path }] : []
        }
      }
    }
    return {
      out: {
        kind: 'video',
        dataUrl: dataUrl || undefined,
        relativePath: path || undefined
      }
    }
  }
  if (dataType === GraphPortType.voice) {
    return {
      out: {
        kind: 'voices',
        items: ctx.node.params.previewRelativePath
          ? [{ relativePath: ctx.node.params.previewRelativePath }]
          : []
      }
    }
  }
  if (isGraphCatalogKind(dataType)) {
    const text = ctx.node.params.text ?? ''
    const path = ctx.node.params.previewRelativePath?.trim()
    return {
      out: catalogValue(dataType, text, path)
    }
  }
  return { out: { kind: 'text', text: ctx.node.params.text ?? '' } }
}

/** 宿主边界输入：优先用 prior seed（引擎 skip），否则读 params 缓存 */
export async function executeBoundaryInputNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  return executeHostInputSlotNode({
    ...ctx,
    node: {
      ...ctx.node,
      typeId: 'graph.input.slot',
      params: {
        ...ctx.node.params,
        hostInputSlot: {
          portId: ctx.node.params.hostBoundaryPort?.portId ?? 'in',
          index: 0,
          dataType: ctx.node.params.hostBoundaryPort?.dataType ?? GraphPortType.text
        }
      }
    }
  })
}

/** 边界输出透传后，把媒体路径写到节点 params，供画布备注卡预览 */
export function patchBoundaryOutputPreview(ctx: NodeExecuteContext, value: GraphValue): void {
  const apply = (params: {
    previewRelativePath: string
    previewDataUrl?: string
    previewCollapsed: false
  }): void => {
    ctx.node.params = { ...ctx.node.params, ...params }
    ctx.patchNode?.({ params })
  }
  if (value.kind === 'image') {
    const rel = value.relativePath?.trim()
    if (!rel && !value.dataUrl?.trim()) return
    apply({
      previewRelativePath: rel || '',
      previewDataUrl: rel ? undefined : value.dataUrl,
      previewCollapsed: false
    })
    return
  }
  if (value.kind === 'images') {
    const item = value.items.find((i) => i.relativePath?.trim() || i.dataUrl?.trim())
    if (!item) return
    const rel = item.relativePath?.trim()
    apply({
      previewRelativePath: rel || '',
      previewDataUrl: rel ? undefined : item.dataUrl,
      previewCollapsed: false
    })
    return
  }
  if (value.kind === 'video') {
    const rel = value.relativePath?.trim()
    if (!rel && !value.dataUrl?.trim()) return
    apply({
      previewRelativePath: rel || '',
      previewDataUrl: rel ? undefined : value.dataUrl,
      previewCollapsed: false
    })
    return
  }
  if (value.kind === 'videos') {
    const item = value.items.find((i) => i.relativePath?.trim() || i.dataUrl?.trim())
    if (!item) return
    const rel = item.relativePath?.trim()
    apply({
      previewRelativePath: rel || '',
      previewDataUrl: rel ? undefined : item.dataUrl,
      previewCollapsed: false
    })
  }
}

/** 宿主边界输出：单数透传首个输入；复数口按类别合并为数组 */
export function executeBoundaryOutputNode(ctx: NodeExecuteContext): Record<string, GraphValue> {
  const incoming = ctx.inputs.in ?? Object.values(ctx.inputs).flat()
  const dataType = ctx.node.params.hostBoundaryPort?.dataType ?? GraphPortType.text
  const aggregate =
    ctx.node.params.hostBoundaryPort?.multiple === true || isPluralGraphPortDataType(dataType)

  if (aggregate && incoming.length) {
    if (dataType === GraphPortType.image || dataType === GraphPortType.images) {
      const items = flattenImagesValues(incoming)
      const value: GraphValue = { kind: 'images', items }
      if (items.length) patchBoundaryOutputPreview(ctx, value)
      return { out: value }
    }
    if (dataType === GraphPortType.video || dataType === GraphPortType.videos) {
      const items = flattenVideosValues(incoming)
      const value: GraphValue = { kind: 'videos', items }
      if (items.length) patchBoundaryOutputPreview(ctx, value)
      return { out: value }
    }
    if (dataType === GraphPortType.voice || dataType === GraphPortType.voices) {
      const items = flattenVoicesValues(incoming)
      const value: GraphValue = { kind: 'voices', items }
      if (items.length) patchBoundaryOutputPreview(ctx, value)
      return { out: value }
    }
    if (dataType === GraphPortType.text || dataType === GraphPortType.texts) {
      const items = flattenTextsValues(incoming)
      const value: GraphValue = { kind: 'texts', items }
      if (items.length) patchBoundaryOutputPreview(ctx, value)
      return { out: value }
    }
  }

  const first = incoming[0]
  if (first) {
    patchBoundaryOutputPreview(ctx, first)
    return { out: first }
  }
  if (
    dataType === GraphPortType.beat ||
    dataType === GraphPortType.worldEntities ||
    dataType === GraphPortType.world
  ) {
    return { out: catalogValue(dataType, '') }
  }
  if (dataType === GraphPortType.image || dataType === GraphPortType.images) {
    return { out: { kind: 'images', items: [] } }
  }
  if (dataType === GraphPortType.video || dataType === GraphPortType.videos) {
    return { out: { kind: 'videos', items: [] } }
  }
  if (dataType === GraphPortType.voice || dataType === GraphPortType.voices) {
    return { out: { kind: 'voices', items: [] } }
  }
  if (dataType === GraphPortType.texts) {
    return { out: { kind: 'texts', items: [] } }
  }
  return { out: { kind: 'text', text: '' } }
}
