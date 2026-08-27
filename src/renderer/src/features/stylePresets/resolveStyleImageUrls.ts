import {
  normalizeProjectStyleImages,
  type ProjectStyleImage
} from '@shared/domain'
import { defErr, fail } from '@shared/errors/appError'
import { getDefaultStylePreset } from './defaultLibrary'

/** 库缩略图 URL → data URL 缓存，避免每次生成重复 fetch */
const libraryDataUrlCache = new Map<string, string>()

/** 风格参考图全部解析失败（名称列表由两语言句式各自拼接） */
const STYLE_IMAGES_LOAD_FAILED = defErr<{ names: string[] }>(
  'stylePreset.imagesLoadFailed',
  ({ names }) => `风格参考图无法加载（${names.join('、') || '未知'}），请重试或改用自定义上传图`,
  ({ names }) =>
    `Failed to load style reference images (${names.join(', ') || 'unknown'}); please retry or switch to custom uploads`
)

async function fetchAsDataUrl(url: string): Promise<string> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`fetch style image failed: ${res.status}`)
  const blob = await res.blob()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error ?? new Error('read style image failed'))
    reader.readAsDataURL(blob)
  })
}

async function resolveLibraryStyleDataUrl(libraryId: string): Promise<string | null> {
  const cached = libraryDataUrlCache.get(libraryId)
  if (cached?.startsWith('data:')) return cached
  const preset = getDefaultStylePreset(libraryId)
  if (!preset?.imageUrl) return null
  const dataUrl = await fetchAsDataUrl(preset.imageUrl)
  if (!dataUrl.startsWith('data:')) return null
  libraryDataUrlCache.set(libraryId, dataUrl)
  return dataUrl
}

/** 将节点/工程风格参考图解析为 API 可用的 data URL 列表（保持条目顺序） */
export async function resolveStyleImageUrls(
  images?: ProjectStyleImage[] | null
): Promise<string[]> {
  const items = normalizeProjectStyleImages(images)
  const urls: string[] = []
  const errors: string[] = []
  for (const item of items) {
    if (item.dataUrl?.startsWith('data:')) {
      urls.push(item.dataUrl)
      continue
    }
    if (!item.libraryId) {
      errors.push(item.name || item.id)
      continue
    }
    try {
      const dataUrl = await resolveLibraryStyleDataUrl(item.libraryId)
      if (dataUrl) urls.push(dataUrl)
      else errors.push(item.name || item.libraryId)
    } catch {
      errors.push(item.name || item.libraryId)
    }
  }
  // 配置了风格图却一张都解析不出时抛错，避免「提示词有风格、API 无参考图」静默失效
  if (items.length > 0 && urls.length === 0) {
    throw fail(STYLE_IMAGES_LOAD_FAILED, { names: errors })
  }
  return urls
}
