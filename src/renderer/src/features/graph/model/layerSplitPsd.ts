import { writePsdUint8Array, type Layer, type LayerTextData, type Psd } from 'ag-psd'
import { defErrSimple, fail } from '@shared/errors/appError'
import {
  buildLayerSplitTree,
  isCanvasSafeImageSrc,
  isLayerSplitBase,
  orderLayerSplitTreeForPsd,
  sortLayersForCompose,
  type ImageLayerSplitLayer,
  type ImageLayerSplitState,
  type UiEditableTextMeta
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

/**
 * 构建 Photoshop 原生可编辑文本图层（`TySh`）描述符：
 * 当图层包含 `editableText` 元数据时，Photoshop 打开 PSD 后除直接显示预渲染像素外，
 * 用户可用文字工具（T）直接双击修改文案、字号与字体。
 */
export function buildAgPsdLayerTextData(
  layerOrText: Pick<ImageLayerSplitLayer, 'editableText'> | UiEditableTextMeta,
  left: number,
  top: number,
  width: number,
  height: number
): LayerTextData | undefined {
  const et: UiEditableTextMeta | undefined =
    'text' in layerOrText ? layerOrText : layerOrText.editableText
  if (!et || !et.text?.trim()) return undefined
  const fontSize = Math.max(10, Math.min(120, Math.round(et.fontSize || height * 0.72)))
  const [r, g, b] = et.color ?? [248, 236, 200]
  const baselineY = Math.round(top + height * 0.78)
  const originX =
    et.align === 'center'
      ? Math.round(left + width * 0.5)
      : et.align === 'right'
        ? Math.round(left + width)
        : left
  return {
    text: et.text.trim(),
    transform: [1, 0, 0, 1, originX, baselineY],
    antiAlias: 'smooth',
    orientation: 'horizontal',
    shapeType: 'point',
    style: {
      font: { name: et.fontName || 'MicrosoftYaHei-Bold' },
      fontSize,
      fillColor: { r, g, b }
    },
    paragraphStyle: {
      justification: et.align === 'center' ? 'center' : et.align === 'right' ? 'right' : 'left'
    }
  }
}

/** 把图层拆分结果序列化为 PSD（底图 + 透明图层 + 二级控件文件夹 + 原生可编辑文本层，保留分组层级/位置/尺寸/透明度/可见性/名称）。 */
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

  // 先把每个可绘制图层栅格化为像素，并同步构建原生可编辑文本元数据。
  const renderedWithText = new Map<string, Layer>()
  const renderedPixelOnly = new Map<string, Layer>()
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

    const basePsdLayer: Layer = {
      name: layerDisplayName(layer, isBase),
      left,
      top,
      blendMode: 'normal',
      opacity: 1,
      // 分组的可见性由分组节点自身承载，图层只反映自身开关，避免双重隐藏丢失原始状态。
      hidden: !layer.visible,
      imageData: { data: imageData.data, width, height }
    }
    renderedPixelOnly.set(layer.id, basePsdLayer)

    const textData = isBase ? undefined : buildAgPsdLayerTextData(layer, left, top, width, height)
    renderedWithText.set(layer.id, textData ? { ...basePsdLayer, text: textData } : basePsdLayer)
  }

  const tree = buildLayerSplitTree(state)
  const childrenWithText = orderLayerSplitTreeForPsd<Layer>(tree, {
    layer: (layer) => renderedWithText.get(layer.id) ?? null,
    group: (group, groupChildren) => ({
      name: group.name.trim() || group.id,
      opened: !group.collapsed,
      hidden: group.visible === false,
      blendMode: 'normal',
      opacity: 1,
      children: groupChildren
    })
  })
  if (!childrenWithText.length) throw fail(ERR_NO_EXPORTABLE_LAYERS)

  try {
    const psd: Psd = {
      width: canvasWidth,
      height: canvasHeight,
      children: childrenWithText
    }
    return writePsdUint8Array(psd, { noBackground: true })
  } catch {
    const childrenPixelOnly = orderLayerSplitTreeForPsd<Layer>(tree, {
      layer: (layer) => renderedPixelOnly.get(layer.id) ?? null,
      group: (group, groupChildren) => ({
        name: group.name.trim() || group.id,
        opened: !group.collapsed,
        hidden: group.visible === false,
        blendMode: 'normal',
        opacity: 1,
        children: groupChildren
      })
    })
    return writePsdUint8Array(
      {
        width: canvasWidth,
        height: canvasHeight,
        children: childrenPixelOnly
      },
      { noBackground: true }
    )
  }
}
