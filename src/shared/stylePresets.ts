/**
 * 工程画面风格参考图：可选库条目或自定义图，最多 MAX_STYLE_IMAGES 张。
 * 默认库清单与缩略图在 renderer `assets/style-presets/`（可改 library.json 增删）。
 */

/** 画面风格参考图上限 */
export const MAX_STYLE_IMAGES = 4

/** 新建风格图默认参考强度（0–1） */
export const DEFAULT_STYLE_IMAGE_WEIGHT = 0.75

/** 持久化到 project.json 的风格图条目 */
export interface ProjectStyleImage {
  id: string
  /** 展示名；库条目一般为风格名，自定义可为文件名 */
  name: string
  /** 参考强度 0–1 */
  weight: number
  /** 默认风格库 id（见 assets/style-presets/library.json） */
  libraryId?: string
  /** 自定义上传图的 data URL（非库条目时使用） */
  dataUrl?: string
  /**
   * 风格库详细提示词（选库时写入；执行/预览时也可按 libraryId 回填）。
   * 与参考图一并进入生成 prompt。
   */
  prompt?: string
}

/** 风格库分类：角色 / 场景 / 道具 / 武器 / UI 界面 */
export type StylePresetCategory = 'character' | 'scene' | 'prop' | 'weapon' | 'ui'

/** 默认库清单条目（配置文件形态，不含已解析 URL） */
export interface StylePresetLibraryEntry {
  id: string
  index: number
  /** 角色 | 场景 | 道具 | 武器 | UI 界面；缺省按 id 前缀推断 */
  category?: StylePresetCategory
  name: string
  nameEn: string
  /** 相对 style-presets 目录的文件名 */
  image: string
  /** 中文详细画风提示词（进生成 prompt） */
  prompt?: string
  /** 英文详细画风提示词 */
  promptEn?: string
}

export interface StylePresetLibraryFile {
  version: number
  styles: StylePresetLibraryEntry[]
}

export function resolveStylePresetCategory(
  entry: Pick<StylePresetLibraryEntry, 'id' | 'category'>
): StylePresetCategory {
  if (
    entry.category === 'character' ||
    entry.category === 'scene' ||
    entry.category === 'prop' ||
    entry.category === 'weapon' ||
    entry.category === 'ui'
  ) {
    return entry.category
  }
  if (entry.id.startsWith('character-')) return 'character'
  if (entry.id.startsWith('prop-')) return 'prop'
  if (entry.id.startsWith('weapon-')) return 'weapon'
  if (entry.id.startsWith('ui-')) return 'ui'
  return 'scene'
}

export function createStyleImageId(): string {
  return `style-${crypto.randomUUID()}`
}

/** 将参考强度夹到 0–1，缺省为 DEFAULT_STYLE_IMAGE_WEIGHT */
export function clampStyleImageWeight(weight?: number | null): number {
  if (typeof weight !== 'number' || !Number.isFinite(weight)) return DEFAULT_STYLE_IMAGE_WEIGHT
  return Math.min(1, Math.max(0, Math.round(weight * 100) / 100))
}

/** 规范化并截断到上限；丢弃无效项 */
export function normalizeProjectStyleImages(
  images?: ProjectStyleImage[] | null,
  max = MAX_STYLE_IMAGES
): ProjectStyleImage[] {
  if (!Array.isArray(images) || images.length === 0) return []
  const out: ProjectStyleImage[] = []
  for (const raw of images) {
    if (!raw || typeof raw !== 'object') continue
    const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : createStyleImageId()
    const name = typeof raw.name === 'string' ? raw.name.trim() : ''
    const libraryId =
      typeof raw.libraryId === 'string' && raw.libraryId.trim() ? raw.libraryId.trim() : undefined
    const dataUrl =
      typeof raw.dataUrl === 'string' && raw.dataUrl.startsWith('data:') ? raw.dataUrl : undefined
    const prompt =
      typeof raw.prompt === 'string' && raw.prompt.trim() ? raw.prompt.trim() : undefined
    if (!libraryId && !dataUrl) continue
    out.push({
      id,
      name: name || (libraryId ? libraryId : '自定义风格'),
      weight: clampStyleImageWeight(raw.weight),
      ...(libraryId ? { libraryId } : {}),
      ...(dataUrl ? { dataUrl } : {}),
      ...(prompt ? { prompt } : {})
    })
    if (out.length >= max) break
  }
  return out
}

/** 由已选风格生成提示词用的风格文本 */
export function styleImagesToPresetText(images: ProjectStyleImage[]): string {
  return normalizeProjectStyleImages(images)
    .map((item) => item.name.trim())
    .filter(Boolean)
    .join('、')
}

/**
 * 带参考强度的风格描述（仅展示/兼容用）。
 * 生成执行请用 buildStyleImagesReferencePrompt（@n + 强度，对齐多参考图 API）。
 */
export function styleImagesToStrengthText(images: ProjectStyleImage[]): string {
  return normalizeProjectStyleImages(images)
    .map((item) => {
      const name = item.name.trim()
      if (!name) return ''
      const pct = Math.round(clampStyleImageWeight(item.weight) * 100)
      return `${name}(${pct}%)`
    })
    .filter(Boolean)
    .join('、')
}

function isEnglishLocale(locale?: string): boolean {
  return locale === 'en-US' || (locale?.startsWith('en') ?? false)
}

/**
 * 风格参考图提示词（与 input_references / image[] 顺序对齐）。
 * 风格图占数组前 N 张，对应 @1..@N；须保留 @n 给模型指代，勿展开成正文。
 * 库条目的详细 prompt 会一并写入（选风格时带入 / 按 libraryId 回填）。
 *
 * 注：UI/执行层写 @n；火山方舟发送前会把 @n 转成「图n」。
 */
export function buildStyleImagesReferencePrompt(
  images?: ProjectStyleImage[] | null,
  options?: { locale?: string; startIndex?: number }
): string {
  const items = normalizeProjectStyleImages(images)
  if (!items.length) return ''
  const start = Math.max(1, Math.floor(options?.startIndex ?? 1))
  const en = isEnglishLocale(options?.locale)
  const clauses = items.map((item, i) => {
    const n = start + i
    const name = item.name.trim() || (en ? 'style' : '风格')
    const weight = clampStyleImageWeight(item.weight)
    const detail = item.prompt?.trim() || ''
    if (en) {
      const head = `use @${n} ("${name}") for style only, strength ${weight}`
      return detail ? `${head}. Style brief: ${detail}` : head
    }
    const head = `参考@${n}「${name}」画风，强度${weight}`
    return detail ? `${head}。画风要点：${detail}` : head
  })
  const joined = clauses.join(en ? '\n' : '\n')
  if (en) {
    return (
      `${joined}\nTreat those references only as visual-style cues (palette, medium, brushwork, lighting mood, texture). ` +
      `Do not copy faces, identity, body shape, clothing details, props, layout, or any recognizable subject from the style images; ` +
      `keep the subject and composition from the user prompt / other references.`
    )
  }
  return (
    `${joined}\n上述编号图仅借鉴画风（色调、媒介、笔触、光影氛围、材质质感），` +
    `严禁迁移其中的人脸、五官、身份特征、体态、服饰细节、道具与构图；` +
    `主体与构图以用户提示词及其他参考为准。`
  )
}

/** 把风格参考提示追加到用户提示词末尾（在 @ 展开之后调用，保留 @n） */
export function appendStyleImagesReferencePrompt(
  prompt: string,
  images?: ProjectStyleImage[] | null,
  options?: { locale?: string; startIndex?: number }
): string {
  const line = buildStyleImagesReferencePrompt(images, options)
  if (!line) return prompt
  const base = prompt.trim()
  return base ? `${base}\n\n${line}` : line
}

/**
 * 解析生成节点实际使用的风格图。
 * - useGlobal !== false（默认用全局）：取工程全局风格
 * - useGlobal === false：取节点本地风格；未配置则为空（不追加）
 */
export function resolveGenerateStyleImages(
  params: {
    styleImagesUseGlobal?: boolean
    styleImages?: ProjectStyleImage[] | null
  },
  globalStyleImages?: ProjectStyleImage[] | null
): ProjectStyleImage[] {
  if (params.styleImagesUseGlobal !== false) {
    return normalizeProjectStyleImages(globalStyleImages)
  }
  return normalizeProjectStyleImages(params.styleImages)
}

/**
 * 风格图占用的 `@n` 数量（与 API image[] / input_references 前缀一致）。
 * 端口连线引用从该值之后起编：第 1 条入边 = styleReserve + 1。
 */
export function resolveStyleMentionReserveCount(
  params: {
    styleImagesUseGlobal?: boolean
    styleImages?: ProjectStyleImage[] | null
  },
  globalStyleImages?: ProjectStyleImage[] | null
): number {
  return resolveGenerateStyleImages(params, globalStyleImages).length
}

/** 端口入边（0-based 序）→ 指令/API 用的 1-based `@n` */
export function portMentionIndex(portOrdinalZeroBased: number, styleReserve: number): number {
  const reserve = Math.max(0, Math.floor(styleReserve))
  const ordinal = Math.max(0, Math.floor(portOrdinalZeroBased))
  return reserve + ordinal + 1
}
