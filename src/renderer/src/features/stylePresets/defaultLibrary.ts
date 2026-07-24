/**
 * 默认画面风格库：清单见 assets/style-presets/library.json，缩略图同目录。
 * 分「角色 / 场景」两类；增删风格：改 JSON + 放入对应图片即可。
 */

import {
  normalizeProjectStyleImages,
  resolveStylePresetCategory,
  type ProjectStyleImage,
  type StylePresetCategory,
  type StylePresetLibraryEntry,
  type StylePresetLibraryFile
} from '@shared/stylePresets'
import libraryFile from '../../assets/style-presets/library.json'

const imageModules = import.meta.glob('../../assets/style-presets/*.{webp,png}', {
  eager: true,
  import: 'default'
}) as Record<string, string>

function resolveImageUrl(fileName: string): string {
  const key = Object.keys(imageModules).find((path) => path.endsWith(`/${fileName}`))
  return key ? imageModules[key] : ''
}

export interface ResolvedStylePreset extends StylePresetLibraryEntry {
  category: StylePresetCategory
  /** Vite 解析后的缩略图 URL */
  imageUrl: string
}

const meta = libraryFile as StylePresetLibraryFile

export const DEFAULT_STYLE_PRESET_LIBRARY: ResolvedStylePreset[] = (meta.styles ?? [])
  .map((entry) => ({
    ...entry,
    category: resolveStylePresetCategory(entry),
    imageUrl: resolveImageUrl(entry.image)
  }))
  .filter((entry) => Boolean(entry.id && entry.imageUrl))

const byId = new Map(DEFAULT_STYLE_PRESET_LIBRARY.map((item) => [item.id, item]))

export function getDefaultStylePreset(id: string): ResolvedStylePreset | undefined {
  return byId.get(id)
}

export function listStylePresetsByCategory(
  category: StylePresetCategory
): ResolvedStylePreset[] {
  return DEFAULT_STYLE_PRESET_LIBRARY.filter((item) => item.category === category).sort(
    (a, b) => a.index - b.index
  )
}

export function stylePresetDisplayName(
  entry: Pick<StylePresetLibraryEntry, 'name' | 'nameEn'>,
  locale: string
): string {
  if (locale.toLowerCase().startsWith('zh')) return entry.name
  return entry.nameEn?.trim() || entry.name
}

/** 按界面语言取风格库详细提示词 */
export function stylePresetPromptText(
  entry: Pick<StylePresetLibraryEntry, 'prompt' | 'promptEn'>,
  locale: string
): string {
  const en = locale.toLowerCase().startsWith('en')
  const text = en ? entry.promptEn?.trim() || entry.prompt?.trim() : entry.prompt?.trim()
  return text || ''
}

/**
 * 为已选风格回填库内详细提示词（仅 libraryId；已有 prompt 不覆盖）。
 * 自定义上传图无库条目则保持原样。
 */
export function enrichStyleImagesWithLibraryPrompts(
  images: ProjectStyleImage[] | null | undefined,
  locale: string
): ProjectStyleImage[] {
  return normalizeProjectStyleImages(images).map((item) => {
    if (item.prompt?.trim() || !item.libraryId) return item
    const preset = getDefaultStylePreset(item.libraryId)
    if (!preset) return item
    const prompt = stylePresetPromptText(preset, locale)
    return prompt ? { ...item, prompt } : item
  })
}
