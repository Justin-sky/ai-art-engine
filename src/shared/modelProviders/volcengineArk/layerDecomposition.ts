import type { GenerateImageLayer } from '../../modelProvider'

function tuple4(raw: unknown): [number, number, number, number] | undefined {
  if (!Array.isArray(raw) || raw.length < 4) return undefined
  const nums = raw.slice(0, 4).map((n) => Number(n))
  if (nums.some((n) => !Number.isFinite(n))) return undefined
  return [nums[0]!, nums[1]!, nums[2]!, nums[3]!]
}

export interface VolcengineArkImageRow {
  b64_json?: string
  url?: string
  size?: string
  output_format?: string
  z_index?: number
  bounding_box?: {
    absolute?: number[]
    normalized?: number[]
  }
  name?: string
  description?: string
}

export function rowImageUrl(row: VolcengineArkImageRow): string {
  if (row.b64_json) return `data:image/png;base64,${row.b64_json}`
  if (row.url?.trim()) return row.url.trim()
  return ''
}

export function parseVolcengineArkImageLayers(
  rows: VolcengineArkImageRow[] | undefined
): { images: string[]; layers: GenerateImageLayer[] } {
  const images: string[] = []
  const layers: GenerateImageLayer[] = []
  for (const [index, row] of (rows ?? []).entries()) {
    const url = rowImageUrl(row)
    if (!url) continue
    images.push(url)
    const absolute = tuple4(row.bounding_box?.absolute)
    const normalized = tuple4(row.bounding_box?.normalized)
    const zIndex = Number.isFinite(Number(row.z_index)) ? Math.round(Number(row.z_index)) : index
    layers.push({
      url,
      zIndex,
      ...(row.size ? { size: row.size } : {}),
      ...(row.output_format ? { outputFormat: row.output_format } : {}),
      ...(absolute || normalized
        ? {
            boundingBox: {
              ...(absolute ? { absolute } : {}),
              ...(normalized ? { normalized } : {})
            }
          }
        : {}),
      ...(row.name ? { name: row.name } : {}),
      ...(row.description ? { description: row.description } : {})
    })
  }
  return { images, layers }
}
