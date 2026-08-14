import type {
  GraphAssetValue,
  GraphImageItem,
  GraphTextItem,
  GraphTextValue,
  GraphVoiceItem,
  GraphValue,
  GraphVideoItem
} from './types'
import { GRAPH_OUT_ALL_PORT_ID } from '../ports'

function voiceItemToAsset(item: GraphVoiceItem): GraphAssetValue | null {
  const assetId = item.id?.trim()
  const relativePath = item.relativePath?.trim()
  if (!assetId && !relativePath) return null
  return {
    kind: 'asset',
    assetId: assetId || relativePath || '',
    assetType: 'voice',
    ...(relativePath ? { relativePath } : {})
  }
}

export function flattenAssetValues(values: GraphValue[]): GraphAssetValue[] {
  const out: GraphAssetValue[] = []
  for (const v of values) {
    if (v.kind === 'asset') out.push(v)
    else if (v.kind === 'voices') {
      for (const item of v.items) {
        const asset = voiceItemToAsset(item)
        if (asset) out.push(asset)
      }
    } else if (v.kind === 'output') {
      out.push(...v.items)
      for (const item of v.voices ?? []) {
        const asset = voiceItemToAsset(item)
        if (asset) out.push(asset)
      }
    }
  }
  return out
}

export function flattenTextValues(values: GraphValue[]): GraphTextValue[] {
  const out: GraphTextValue[] = []
  for (const v of values) {
    if (v.kind === 'text') out.push(v)
    else if (v.kind === 'texts') {
      for (const item of v.items) {
        if (typeof item.text === 'string') out.push({ kind: 'text', text: item.text })
      }
    } else if (v.kind === 'output') out.push(...v.notes)
  }
  return out
}

function pushTextItem(out: GraphTextItem[], item: GraphTextItem): void {
  const text = typeof item.text === 'string' ? item.text : ''
  const relativePath = item.relativePath?.trim()
  const title = item.title?.trim()
  if (!text.trim() && !relativePath) return
  out.push({
    ...(item.id ? { id: item.id } : {}),
    ...(title ? { title } : {}),
    text,
    ...(item.createdAt ? { createdAt: item.createdAt } : {}),
    ...(relativePath ? { relativePath } : {})
  })
}

/** 收集上游文本数组（texts / text / output.texts / output.notes） */
export function flattenTextsValues(values: GraphValue[]): GraphTextItem[] {
  const out: GraphTextItem[] = []
  for (const v of values) {
    if (v.kind === 'texts') {
      for (const item of v.items) pushTextItem(out, item)
    } else if (v.kind === 'text' && (v.text.trim() || v.relativePath?.trim())) {
      out.push({
        text: v.text,
        ...(v.id ? { id: v.id } : {}),
        ...(v.relativePath?.trim() ? { relativePath: v.relativePath.trim() } : {})
      })
    } else if (v.kind === 'output') {
      if (v.texts?.length) {
        for (const item of v.texts) pushTextItem(out, item)
      } else {
        for (const note of v.notes) {
          if (note.text.trim()) out.push({ text: note.text })
        }
      }
    }
  }
  return out
}

export function flattenImagesValues(values: GraphValue[]): GraphImageItem[] {
  const out: GraphImageItem[] = []
  for (const v of values) {
    if (v.kind === 'images') out.push(...v.items)
    else if (v.kind === 'image' && (v.dataUrl || v.relativePath)) {
      out.push({
        id: v.id,
        dataUrl: v.dataUrl,
        createdAt: v.createdAt,
        relativePath: v.relativePath
      })
    } else if (v.kind === 'output' && v.images?.length) out.push(...v.images)
  }
  return out
}

export function flattenVideosValues(values: GraphValue[]): GraphVideoItem[] {
  const out: GraphVideoItem[] = []
  for (const v of values) {
    if (v.kind === 'videos') out.push(...v.items)
    else if (v.kind === 'video' && (v.dataUrl || v.relativePath)) {
      out.push({
        id: v.id,
        dataUrl: v.dataUrl,
        createdAt: v.createdAt,
        relativePath: v.relativePath
      })
    } else if (v.kind === 'output' && v.videos?.length) out.push(...v.videos)
  }
  return out
}

/** 收集上游声音数组（voices / voice / audio asset / output.voices） */
export function flattenVoicesValues(values: GraphValue[]): GraphVoiceItem[] {
  const out: GraphVoiceItem[] = []
  for (const v of values) {
    if (v.kind === 'voices') {
      for (const item of v.items) {
        if (!item.id?.trim() && !item.relativePath?.trim()) continue
        out.push({
          ...(item.id ? { id: item.id } : {}),
          ...(item.createdAt ? { createdAt: item.createdAt } : {}),
          ...(item.relativePath?.trim() ? { relativePath: item.relativePath.trim() } : {})
        })
      }
    } else if (v.kind === 'voice') {
      if (!v.id?.trim() && !v.relativePath?.trim()) continue
      out.push({
        ...(v.id ? { id: v.id } : {}),
        ...(v.createdAt ? { createdAt: v.createdAt } : {}),
        ...(v.relativePath?.trim() ? { relativePath: v.relativePath.trim() } : {})
      })
    } else if (v.kind === 'asset' && v.assetType === 'voice') {
      out.push({
        id: v.assetId,
        ...(v.relativePath?.trim() ? { relativePath: v.relativePath.trim() } : {})
      })
    } else if (v.kind === 'output') {
      if (v.voices?.length) {
        for (const item of v.voices) {
          if (!item.id?.trim() && !item.relativePath?.trim()) continue
          out.push({
            ...(item.id ? { id: item.id } : {}),
            ...(item.createdAt ? { createdAt: item.createdAt } : {}),
            ...(item.relativePath?.trim() ? { relativePath: item.relativePath.trim() } : {})
          })
        }
      } else {
        for (const item of v.items) {
          if (item.assetType !== 'voice') continue
          out.push({
            id: item.assetId,
            ...(item.relativePath?.trim() ? { relativePath: item.relativePath.trim() } : {})
          })
        }
      }
    }
  }
  return out
}

export function pickVideoItem(
  items: GraphVideoItem[],
  selectedVideoId?: string | null
): GraphVideoItem | undefined {
  if (!items.length) return undefined
  if (selectedVideoId) {
    const byId = items.find((item, index) => videoItemKey(item, index) === selectedVideoId)
    if (byId) return byId
    const byRawId = items.find((item) => item.id === selectedVideoId)
    if (byRawId) return byRawId
  }
  return items[0]
}

export function videoItemKey(item: GraphVideoItem, index: number): string {
  return item.id?.trim() || item.relativePath?.trim() || item.dataUrl?.trim() || `video:${index}`
}

export function pickImageItem(
  items: GraphImageItem[],
  selectedImageId?: string | null
): GraphImageItem | undefined {
  if (!items.length) return undefined
  if (selectedImageId) {
    const byId = items.find((item) => (item.id ?? '') === selectedImageId)
    if (byId) return byId
    const indexMatch = /^index:(\d+)$/.exec(selectedImageId)
    if (indexMatch) {
      const index = Number(indexMatch[1])
      if (Number.isFinite(index) && items[index]) return items[index]
    }
  }
  return items[0]
}

export function imageItemKey(item: GraphImageItem, index: number): string {
  return item.id?.trim() || `index:${index}`
}

export function textItemKey(item: GraphTextItem, index: number): string {
  return item.id?.trim() || item.relativePath?.trim() || `text:${index}`
}

export function pickTextItem(
  items: GraphTextItem[],
  selectedTextId?: string | null
): GraphTextItem | undefined {
  if (!items.length) return undefined
  if (selectedTextId) {
    const byKey = items.find((item, index) => textItemKey(item, index) === selectedTextId)
    if (byKey) return byKey
    const byRawId = items.find((item) => item.id === selectedTextId)
    if (byRawId) return byRawId
  }
  return items[0]
}

export function voiceItemKey(item: GraphVoiceItem, index: number): string {
  return item.id?.trim() || item.relativePath?.trim() || `voice:${index}`
}

export function pickVoiceItem(
  items: GraphVoiceItem[],
  selectedVoiceId?: string | null
): GraphVoiceItem | undefined {
  if (!items.length) return undefined
  if (selectedVoiceId) {
    const byKey = items.find((item, index) => voiceItemKey(item, index) === selectedVoiceId)
    if (byKey) return byKey
    const byRawId = items.find((item) => item.id === selectedVoiceId)
    if (byRawId) return byRawId
  }
  return items[0]
}

/** 生成图库双输出口：`out` 选中单条，`out-all` 全部历史 */
export function dualImageGalleryOutputs(
  items: GraphImageItem[],
  selectedImageId: string
): Record<string, GraphValue> {
  const picked = pickImageItem(items, selectedImageId)
  return {
    out: {
      kind: 'image',
      id: picked?.id,
      dataUrl: picked?.dataUrl || '',
      createdAt: picked?.createdAt,
      ...(picked?.relativePath ? { relativePath: picked.relativePath } : {})
    },
    [GRAPH_OUT_ALL_PORT_ID]: { kind: 'images', items }
  }
}

export function dualVideoGalleryOutputs(
  items: GraphVideoItem[],
  selectedVideoId: string
): Record<string, GraphValue> {
  const picked = pickVideoItem(items, selectedVideoId)
  return {
    out: {
      kind: 'video',
      id: picked?.id,
      dataUrl: picked?.dataUrl || '',
      createdAt: picked?.createdAt,
      ...(picked?.relativePath ? { relativePath: picked.relativePath } : {})
    },
    [GRAPH_OUT_ALL_PORT_ID]: { kind: 'videos', items }
  }
}

export function dualVoiceGalleryOutputs(
  items: GraphVoiceItem[],
  selectedVoiceId: string
): Record<string, GraphValue> {
  const picked = pickVoiceItem(items, selectedVoiceId)
  return {
    out: {
      kind: 'voice',
      id: picked?.id,
      createdAt: picked?.createdAt,
      ...(picked?.relativePath ? { relativePath: picked.relativePath } : {})
    },
    [GRAPH_OUT_ALL_PORT_ID]: { kind: 'voices', items }
  }
}

export function dualTextGalleryOutputs(
  items: GraphTextItem[],
  selectedTextId: string
): Record<string, GraphValue> {
  const picked = pickTextItem(items, selectedTextId)
  return {
    out: {
      kind: 'text',
      text: picked?.text ?? '',
      id: picked?.id,
      ...(picked?.relativePath ? { relativePath: picked.relativePath } : {})
    },
    [GRAPH_OUT_ALL_PORT_ID]: { kind: 'texts', items }
  }
}

export function newestImageSelectedId(items: GraphImageItem[]): string {
  if (!items.length) return ''
  const index = items.length - 1
  return imageItemKey(items[index]!, index)
}

export function newestVideoSelectedId(items: GraphVideoItem[]): string {
  if (!items.length) return ''
  const index = items.length - 1
  return videoItemKey(items[index]!, index)
}

export function newestVoiceSelectedId(items: GraphVoiceItem[]): string {
  if (!items.length) return ''
  const index = items.length - 1
  return voiceItemKey(items[index]!, index)
}

export function newestTextSelectedId(items: GraphTextItem[]): string {
  if (!items.length) return ''
  const index = items.length - 1
  return textItemKey(items[index]!, index)
}
