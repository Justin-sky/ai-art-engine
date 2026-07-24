import type { AssetInfo, Shot } from '@shared/domain'
import { findOutputNode, type GraphDocument, type GraphNode } from '@shared/graph'

export interface ExportGraphPngInput {
  graph: GraphDocument
  shot: Pick<Shot, 'canvas'>
  assets: AssetInfo[]
  getAssetFileUrl: (path: string) => Promise<string>
  /** 可选：优先用预览缩略图，降低导出解码成本 */
  getAssetPreviewUrl?: (path: string) => Promise<string>
}

export async function exportGraphOutputPng(
  input: ExportGraphPngInput
): Promise<string | null> {
  const outputId = findOutputNode(input.graph)?.id
  if (!outputId) return null
  const connected = input.graph.edges
    .filter((edge) => edge.target === outputId)
    .map((edge) => input.graph.nodes.find((node) => node.id === edge.source))
    .filter((node): node is GraphNode => !!node && node.category === 'asset')
  const imageNode = connected.find(
    (node) => node.assetType === 'image'
  )
  if (!imageNode?.assetId) return null
  const asset = input.assets.find((item) => item.id === imageNode.assetId)
  const path = asset?.relativePath
  if (!path) return null

  try {
    const resolve = input.getAssetPreviewUrl ?? input.getAssetFileUrl
    const image = await loadImage(await resolve(path))
    const canvas = document.createElement('canvas')
    canvas.width = input.shot.canvas.width || 1280
    canvas.height = input.shot.canvas.height || 720
    const context = canvas.getContext('2d')
    if (!context) return null
    context.fillStyle = '#0d0f12'
    context.fillRect(0, 0, canvas.width, canvas.height)
    const scale = Math.min(canvas.width / image.width, canvas.height / image.height)
    const width = image.width * scale
    const height = image.height * scale
    context.drawImage(
      image,
      (canvas.width - width) / 2,
      (canvas.height - height) / 2,
      width,
      height
    )
    return canvas.toDataURL('image/png')
  } catch {
    return null
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = reject
    image.src = src
  })
}
