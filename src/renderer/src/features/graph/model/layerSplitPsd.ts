import { writePsdUint8Array, type Layer, type Psd } from 'ag-psd'
import {
  buildLayerSplitTree,
  isCanvasSafeImageSrc,
  isLayerSplitBase,
  sortLayersForCompose,
  type ImageLayerSplitLayer,
  type ImageLayerSplitState,
  type LayerSplitTreeNode
} from '@shared/graph'

function loadImage(src: string): Promise<HTMLImageElement> {
  const url = src.trim()
  if (!isCanvasSafeImageSrc(url)) {
    return Promise.reject(new Error('LAYER_SPLIT_SOURCE_LOAD_FAILED'))
  }
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('LAYER_SPLIT_SOURCE_LOAD_FAILED'))
    img.src = url
  })
}

function layerDisplayName(layer: ImageLayerSplitLayer, isBase: boolean): string {
  const name = layer.name?.trim()
  if (name) return name
  return isBase ? 'Base' : `Layer ${layer.zIndex}`
}

/** 把图层拆分结果序列化为 PSD（底图 + 透明图层，保留分组层级/位置/尺寸/透明度/可见性/名称）。 */
export async function layerSplitToPsdUint8Array(input: {
  state: ImageLayerSplitState
  layerUrls: Record<string, string>
}): Promise<Uint8Array> {
  const state = input.state
  const urlFor = (layer: ImageLayerSplitLayer): string =>
    input.layerUrls[layer.imageId]?.trim() || input.layerUrls[layer.id]?.trim() || ''

  const drawable = sortLayersForCompose(state.layers).filter((layer) => Boolean(urlFor(layer)))
  if (!drawable.length) throw new Error('没有可导出的图层')

  const base = drawable.find((layer) => isLayerSplitBase(layer)) ?? drawable[0]!
  const baseUrl = urlFor(base)
  if (!baseUrl) throw new Error('缺少底图，无法导出 PSD')
  const baseImg = await loadImage(baseUrl)

  const canvasWidth = Math.max(1, Math.round(state.canvasWidth) || baseImg.naturalWidth || 1)
  const canvasHeight = Math.max(1, Math.round(state.canvasHeight) || baseImg.naturalHeight || 1)

  // 先把每个可绘制图层栅格化为像素，之后同步遍历分组树时按 id 取用。
  const rendered = new Map<string, Layer>()
  for (const layer of drawable) {
    const isBase = isLayerSplitBase(layer)
    const img = layer.id === base.id ? baseImg : await loadImage(urlFor(layer))
    const width = isBase ? canvasWidth : Math.max(1, layer.width)
    const height = isBase ? canvasHeight : Math.max(1, layer.height)
    const left = isBase ? 0 : layer.left
    const top = isBase ? 0 : layer.top

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('LAYER_SPLIT_CANVAS_UNAVAILABLE')
    ctx.drawImage(img, 0, 0, width, height)
    const imageData = ctx.getImageData(0, 0, width, height)

    rendered.set(layer.id, {
      name: layerDisplayName(layer, isBase),
      left,
      top,
      blendMode: 'normal',
      opacity: 1,
      // 分组的可见性由分组节点自身承载，图层只反映自身开关，避免双重隐藏丢失原始状态。
      hidden: !layer.visible,
      imageData: { data: imageData.data, width, height }
    })
  }

  // 按分组树写入 ag-psd children：组 → 带 children 的分组节点（保留 折叠/可见），叶 → 栅格化图层。
  // buildLayerSplitTree 同级已按 z 从高到低排列，正是 ag-psd children 的「顶 → 底」顺序。
  const toPsdNodes = (nodes: LayerSplitTreeNode[]): Layer[] => {
    const out: Layer[] = []
    for (const node of nodes) {
      if (node.kind === 'layer') {
        const layer = rendered.get(node.layer.id)
        if (layer) out.push(layer)
        continue
      }
      const children = toPsdNodes(node.children)
      if (!children.length) continue // 跳过没有任何可绘制内容的空分组
      out.push({
        name: node.group.name.trim() || node.group.id,
        opened: !node.group.collapsed,
        hidden: node.group.visible === false,
        blendMode: 'normal',
        opacity: 1,
        children
      })
    }
    return out
  }

  const children = toPsdNodes(buildLayerSplitTree(state))
  if (!children.length) throw new Error('没有可导出的图层')

  const psd: Psd = {
    width: canvasWidth,
    height: canvasHeight,
    children
  }

  return writePsdUint8Array(psd, { noBackground: true })
}
