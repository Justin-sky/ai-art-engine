import { writePsdUint8Array, type Layer, type Psd } from 'ag-psd'
import { defErrSimple, fail } from '@shared/errors/appError'
import {
  buildLayerSplitTree,
  isCanvasSafeImageSrc,
  isLayerSplitBase,
  orderLayerSplitTreeForPsd,
  sortLayersForCompose,
  type ImageLayerSplitLayer,
  type ImageLayerSplitState
} from '@shared/graph'

/** PSD 导出侧错误：语境是「导出」而非执行期拆层，文案与 SHARED_ERRORS.layerSplit* 不同，单列条目 */
const ERR_NO_EXPORTABLE_LAYERS = defErrSimple(
  'graph.layerSplitPsd.noExportableLayers',
  '没有可导出的图层',
  'No layers to export'
)
const ERR_NO_BASE_LAYER = defErrSimple(
  'graph.layerSplitPsd.missingBaseLayer',
  '缺少底图，无法导出 PSD',
  'Missing base layer; cannot export PSD'
)

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
  if (!drawable.length) throw fail(ERR_NO_EXPORTABLE_LAYERS)

  const base = drawable.find((layer) => isLayerSplitBase(layer)) ?? drawable[0]!
  const baseUrl = urlFor(base)
  if (!baseUrl) throw fail(ERR_NO_BASE_LAYER)
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

  // 按分组树写入 ag-psd children：叶 → 栅格化图层，枝 → 带 children 的分组节点（保留 折叠/可见）。
  // ag-psd 的 children[0] 是最底层，orderLayerSplitTreeForPsd 已把「顶 → 底」的树反转成「底 → 顶」，
  // 否则整摞图层会上下颠倒。
  const children = orderLayerSplitTreeForPsd<Layer>(buildLayerSplitTree(state), {
    layer: (layer) => rendered.get(layer.id) ?? null,
    group: (group, groupChildren) => ({
      name: group.name.trim() || group.id,
      opened: !group.collapsed,
      hidden: group.visible === false,
      blendMode: 'normal',
      opacity: 1,
      children: groupChildren
    })
  })
  if (!children.length) throw fail(ERR_NO_EXPORTABLE_LAYERS)

  const psd: Psd = {
    width: canvasWidth,
    height: canvasHeight,
    children
  }

  return writePsdUint8Array(psd, { noBackground: true })
}
