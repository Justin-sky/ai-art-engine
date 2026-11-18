import type { GenerateImageLayer } from '../../modelProvider'
import { b64JsonToImageDataUrl, sniffImageDimensionsFromBase64 } from '../../media/imageMimeSniff'

function tuple4(raw: unknown): [number, number, number, number] | undefined {
  if (!Array.isArray(raw) || raw.length < 4) return undefined
  const nums = raw.slice(0, 4).map((n) => Number(n))
  if (nums.some((n) => !Number.isFinite(n))) return undefined
  return [nums[0]!, nums[1]!, nums[2]!, nums[3]!]
}

export interface VolcengineArkLayerMeta {
  z_index?: number
  background?: string
  bounding_box?: {
    absolute?: number[]
    normalized?: number[]
  }
  name?: string
  description?: string
}

export interface VolcengineArkImageRow extends VolcengineArkLayerMeta {
  b64_json?: string
  url?: string
  size?: string
  output_format?: string
  media_type?: string
  /** OpenRouter `/images` returns layer metadata nested under `data[i].layer` */
  layer?: VolcengineArkLayerMeta
}

export function rowImageUrl(row: VolcengineArkImageRow): string {
  if (row.b64_json) {
    const fmt = (row.output_format || row.media_type || '').toLowerCase()
    const fallbackMime =
      fmt.includes('jpeg') || fmt.includes('jpg')
        ? 'image/jpeg'
        : fmt.includes('webp')
          ? 'image/webp'
          : 'image/png'
    return b64JsonToImageDataUrl(row.b64_json, fallbackMime)
  }
  if (row.url?.trim()) return row.url.trim()
  return ''
}

export function parseVolcengineArkImageLayers(rows: VolcengineArkImageRow[] | undefined): {
  images: string[]
  layers: GenerateImageLayer[]
} {
  const images: string[] = []
  const layers: GenerateImageLayer[] = []
  for (const [index, row] of (rows ?? []).entries()) {
    const url = rowImageUrl(row)
    if (!url) continue
    images.push(url)
    const meta = row.layer ?? row
    const absolute = tuple4(meta.bounding_box?.absolute ?? row.bounding_box?.absolute)
    const normalized = tuple4(meta.bounding_box?.normalized ?? row.bounding_box?.normalized)
    const rawZ = meta.z_index ?? row.z_index
    const zIndex = rawZ != null && Number.isFinite(Number(rawZ)) ? Math.round(Number(rawZ)) : index
    let size = row.size?.trim() || undefined
    if (!size && (row.b64_json || url.startsWith('data:'))) {
      const dims = sniffImageDimensionsFromBase64(row.b64_json || url)
      if (dims) size = `${dims.width}x${dims.height}`
    }
    const name = meta.name?.trim() || row.name?.trim() || undefined
    const description = meta.description?.trim() || row.description?.trim() || undefined
    layers.push({
      url,
      zIndex,
      ...(size ? { size } : {}),
      ...(row.output_format ? { outputFormat: row.output_format } : {}),
      ...(absolute || normalized
        ? {
            boundingBox: {
              ...(absolute ? { absolute } : {}),
              ...(normalized ? { normalized } : {})
            }
          }
        : {}),
      ...(name ? { name } : {}),
      ...(description ? { description } : {})
    })
  }
  return { images, layers }
}
