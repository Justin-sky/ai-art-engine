import {
  writePsdUint8Array,
  type Layer,
  type LayerTextData,
  type LinkedFile,
  type PlacedLayer,
  type Psd
} from 'ag-psd'
import { defErrSimple, fail } from '@shared/errors/appError'
import {
  buildLayerSplitTree,
  componentIdToPsdGuid,
  isCanvasSafeImageSrc,
  isLayerSplitBase,
  orderLayerSplitTreeForPsd,
  sanitizeComponentExportName,
  sortLayersForCompose,
  type ImageLayerSplitLayer,
  type ImageLayerSplitState,
  type UiEditableTextMeta,
  type UiSharedComponentItem
} from '@shared/graph'
import { renderComponentToRect } from '@shared/graph/uiPreciseSplit'

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
    if (!url.startsWith('data:') && !url.startsWith('blob:') && !url.startsWith('file:')) {
      img.crossOrigin = 'anonymous'
    }
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
  const strokeStyle =
    et.strokeColor && et.strokeColor.length === 3
      ? {
          strokeFlag: true,
          fillFirst: true,
          outlineWidth: Math.max(1, et.strokeWidth ?? 2),
          strokeColor: {
            r: et.strokeColor[0],
            g: et.strokeColor[1],
            b: et.strokeColor[2]
          }
        }
      : {}
  return {
    text: et.text.trim(),
    transform: [1, 0, 0, 1, originX, baselineY],
    antiAlias: 'smooth',
    orientation: 'horizontal',
    shapeType: 'point',
    style: {
      font: { name: et.fontName || 'MicrosoftYaHei-Bold' },
      fontSize,
      fillColor: { r, g, b },
      ...strokeStyle
    },
    paragraphStyle: {
      justification: et.align === 'center' ? 'center' : et.align === 'right' ? 'right' : 'left'
    }
  }
}

export interface PsdDecodedRgba {
  data: Uint8ClampedArray
  width: number
  height: number
}

async function defaultDecodeRgba(
  src: string,
  targetWidth?: number,
  targetHeight?: number
): Promise<PsdDecodedRgba> {
  const img = await loadImage(src)
  const width = Math.max(1, targetWidth ? Math.round(targetWidth) : img.naturalWidth || 1)
  const height = Math.max(1, targetHeight ? Math.round(targetHeight) : img.naturalHeight || 1)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('LAYER_SPLIT_CANVAS_UNAVAILABLE')
  ctx.drawImage(img, 0, 0, width, height)
  const imageData = ctx.getImageData(0, 0, width, height)
  return { data: imageData.data, width, height }
}

function buildEmbeddedSmartObjectPsdBytes(
  exportName: string,
  masterRgba: PsdDecodedRgba
): Uint8Array {
  return writePsdUint8Array(
    {
      width: masterRgba.width,
      height: masterRgba.height,
      children: [
        {
          name: exportName,
          left: 0,
          top: 0,
          blendMode: 'normal',
          opacity: 1,
          imageData: {
            data: masterRgba.data,
            width: masterRgba.width,
            height: masterRgba.height
          }
        }
      ]
    },
    { noBackground: true }
  )
}

/**
 * 把图层拆分结果序列化为 PSD（底图 + 透明图层 + 共享组件智能对象 `SoLd`/`lnk2` + 二级控件文件夹 + 原生可编辑文本层）。
 */
export async function layerSplitToPsdUint8Array(input: {
  state: ImageLayerSplitState
  layerUrls: Record<string, string>
  /** 可选解码器注入（供 Node / 单元测试在无 DOM Canvas 环境下验证完整智能对象 PSD 二进制） */
  decodeRgba?: (src: string, targetWidth?: number, targetHeight?: number) => Promise<PsdDecodedRgba>
}): Promise<Uint8Array> {
  const state = input.state
  const decode = input.decodeRgba ?? defaultDecodeRgba
  const urlFor = (layer: ImageLayerSplitLayer): string =>
    input.layerUrls[layer.imageId]?.trim() || input.layerUrls[layer.id]?.trim() || ''

  const drawable = sortLayersForCompose(state.layers).filter((layer) => Boolean(urlFor(layer)))
  if (!drawable.length) throw fail(ERR_NO_EXPORTABLE_LAYERS)

  const base = drawable.find((layer) => isLayerSplitBase(layer)) ?? drawable[0]!
  const baseUrl = urlFor(base)
  if (!baseUrl) throw fail(ERR_NO_BASE_LAYER)
  const baseDecoded = await decode(
    baseUrl,
    state.canvasWidth > 0 ? Math.round(state.canvasWidth) : undefined,
    state.canvasHeight > 0 ? Math.round(state.canvasHeight) : undefined
  )

  const canvasWidth = Math.max(1, Math.round(state.canvasWidth) || baseDecoded.width || 1)
  const canvasHeight = Math.max(1, Math.round(state.canvasHeight) || baseDecoded.height || 1)
  const baseFinal =
    baseDecoded.width === canvasWidth && baseDecoded.height === canvasHeight
      ? baseDecoded
      : await decode(baseUrl, canvasWidth, canvasHeight)

  const compMap = new Map<string, UiSharedComponentItem>()
  for (const comp of state.componentLibrary ?? []) {
    compMap.set(comp.id, comp)
  }

  const linkedFiles: LinkedFile[] = []
  const linkedByGuid = new Map<string, { width: number; height: number }>()

  const resolveMasterSourceUrl = (comp: UiSharedComponentItem): string => {
    if (comp.imageId && input.layerUrls[comp.imageId]?.trim()) {
      return input.layerUrls[comp.imageId]!.trim()
    }
    if (comp.imageUrl && isCanvasSafeImageSrc(comp.imageUrl)) {
      return comp.imageUrl.trim()
    }
    return ''
  }

  // 先把每个可绘制图层栅格化为像素，并同步构建共享智能对象与原生可编辑文本元数据。
  const renderedFull = new Map<string, Layer>()
  const renderedWithText = new Map<string, Layer>()
  const renderedPixelOnly = new Map<string, Layer>()

  for (const layer of drawable) {
    const isBase = isLayerSplitBase(layer)
    const width = isBase ? canvasWidth : Math.max(1, layer.width)
    const height = isBase ? canvasHeight : Math.max(1, layer.height)
    const left = isBase ? 0 : layer.left
    const top = isBase ? 0 : layer.top
    const imageData = layer.id === base.id ? baseFinal : await decode(urlFor(layer), width, height)

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
    const withTextLayer: Layer = textData ? { ...basePsdLayer, text: textData } : basePsdLayer
    renderedWithText.set(layer.id, withTextLayer)

    // 共享组件智能对象：当图层绑定了 componentId 且未设为 keepOriginalPixels（且不是纯文字层）时挂载 placedLayer
    let placedLayer: PlacedLayer | undefined
    const activeCompId =
      !isBase && !textData && !layer.keepOriginalPixels ? layer.componentId?.trim() || '' : ''
    if (activeCompId) {
      const comp = compMap.get(activeCompId)
      const masterCw = Math.max(1, comp?.canonicalWidth ?? width)
      const masterCh = Math.max(1, comp?.canonicalHeight ?? height)
      const masterAr = masterCw / masterCh
      const targetAr = width / height
      const arDelta = Math.abs(targetAr - masterAr) / Math.max(0.01, masterAr)
      const isNonUniformNineSlice = comp?.scalePolicy === 'nine-slice' && arDelta > 0.08

      const guid = isNonUniformNineSlice
        ? componentIdToPsdGuid(`${activeCompId}@${width}x${height}`)
        : componentIdToPsdGuid(comp?.psdGuid || activeCompId)
      const exportName = sanitizeComponentExportName(
        isNonUniformNineSlice
          ? `${comp?.exportName || activeCompId}_${width}x${height}`
          : comp?.exportName || layer.exportName || activeCompId
      )

      if (!linkedByGuid.has(guid)) {
        let masterRgba: PsdDecodedRgba = imageData
        if (comp) {
          const masterUrl = resolveMasterSourceUrl(comp)
          if (masterUrl) {
            try {
              const rawMaster = await decode(masterUrl, masterCw, masterCh)
              if (isNonUniformNineSlice) {
                const borders = layer.nineSliceBorders ?? comp.nineSliceBorders
                masterRgba = renderComponentToRect(rawMaster, width, height, 'nine-slice', borders)
              } else {
                masterRgba = rawMaster
              }
            } catch {
              masterRgba = imageData
            }
          }
        }
        const embeddedBytes = buildEmbeddedSmartObjectPsdBytes(exportName, masterRgba)
        linkedFiles.push({
          id: guid,
          name: `${exportName}.psd`,
          type: '8BPS',
          creator: '8BIM',
          data: embeddedBytes
        })
        linkedByGuid.set(guid, { width: masterRgba.width, height: masterRgba.height })
      }

      // 若当前图层直接引用了原始组件母版 imageId 且尺寸与实例不同（如非等比九宫格拉伸），同步用九宫格无损像素更新 PSD 图层通道预览
      if (isNonUniformNineSlice && comp) {
        const masterUrl = resolveMasterSourceUrl(comp)
        if (masterUrl) {
          try {
            const rawMaster = await decode(masterUrl, masterCw, masterCh)
            const baked = renderComponentToRect(
              rawMaster,
              width,
              height,
              'nine-slice',
              layer.nineSliceBorders ?? comp.nineSliceBorders
            )
            basePsdLayer.imageData = { data: baked.data, width: baked.width, height: baked.height }
          } catch {
            // keep existing imageData fallback
          }
        }
      }

      const masterDim = linkedByGuid.get(guid)!
      placedLayer = {
        id: guid,
        type: 'raster',
        width: masterDim.width,
        height: masterDim.height,
        transform: [left, top, left + width, top, left + width, top + height, left, top + height]
      }
    }

    renderedFull.set(layer.id, placedLayer ? { ...withTextLayer, placedLayer } : withTextLayer)
  }

  const tree = buildLayerSplitTree(state)
  const buildPsdChildren = (layerMap: ReadonlyMap<string, Layer>): Layer[] =>
    orderLayerSplitTreeForPsd<Layer>(tree, {
      layer: (layer) => layerMap.get(layer.id) ?? null,
      group: (group, groupChildren) => ({
        name: group.name.trim() || group.id,
        opened: !group.collapsed,
        hidden: group.visible === false,
        blendMode: 'normal',
        opacity: 1,
        children: groupChildren
      })
    })

  const childrenFull = buildPsdChildren(renderedFull)
  if (!childrenFull.length) throw fail(ERR_NO_EXPORTABLE_LAYERS)

  if (linkedFiles.length > 0) {
    try {
      const psd: Psd = {
        width: canvasWidth,
        height: canvasHeight,
        linkedFiles,
        children: childrenFull
      }
      return writePsdUint8Array(psd, { noBackground: true })
    } catch {
      // Fall through to text + pixel PSD without Smart Objects
    }
  }

  try {
    const psd: Psd = {
      width: canvasWidth,
      height: canvasHeight,
      children: buildPsdChildren(renderedWithText)
    }
    return writePsdUint8Array(psd, { noBackground: true })
  } catch {
    return writePsdUint8Array(
      {
        width: canvasWidth,
        height: canvasHeight,
        children: buildPsdChildren(renderedPixelOnly)
      },
      { noBackground: true }
    )
  }
}
