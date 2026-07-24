/**
 * 各生成/工具节点的默认用户提示词方案（指令为空时的 fallback）。
 * 改文案只改本文件；执行与预览通过 build*Prompt 读取。
 */

function isEnglishLocale(locale?: string): boolean {
  return locale === 'en-US' || (locale?.startsWith('en') ?? false)
}

function pickByLocale(locale: string | undefined, en: string, zh: string): string {
  return isEnglishLocale(locale) ? en : zh
}

function buildOrDefault(
  instruction: string,
  locale: string | undefined,
  fallback: (locale?: string) => string
): string {
  const trimmed = instruction.trim()
  return trimmed || fallback(locale)
}

// ——— 剧本 ———

export const DEFAULT_SCREENPLAY_USER_PROMPT_EN =
  'Please write a complete, readable story screenplay in plain text (no Markdown). Start with a Title: line, then the body.'

export const DEFAULT_SCREENPLAY_USER_PROMPT_ZH =
  '请用纯文本创作一个完整、可读的故事剧本（不要使用 Markdown）。第一行写「剧本名：…」，空一行后再写正文。'

export function defaultScreenplayUserPrompt(locale?: string): string {
  return pickByLocale(locale, DEFAULT_SCREENPLAY_USER_PROMPT_EN, DEFAULT_SCREENPLAY_USER_PROMPT_ZH)
}

/** 最终用户提示词：仅生成指令（已展开 @），不自动拼接上游/本节点正文 */
export function buildScreenplayPrompt(instruction: string, locale?: string): string {
  return buildOrDefault(instruction, locale, defaultScreenplayUserPrompt)
}

// ——— 图片 ———

export const DEFAULT_IMAGE_USER_PROMPT_EN =
  'Please generate the image according to the creative brief.'

export const DEFAULT_IMAGE_USER_PROMPT_ZH = '请根据创作意图生成图片。'

export function defaultImageUserPrompt(locale?: string): string {
  return pickByLocale(locale, DEFAULT_IMAGE_USER_PROMPT_EN, DEFAULT_IMAGE_USER_PROMPT_ZH)
}

export function buildImagePrompt(instruction: string, locale?: string): string {
  return buildOrDefault(instruction, locale, defaultImageUserPrompt)
}

// ——— 视频 ———

export const DEFAULT_VIDEO_USER_PROMPT_EN =
  'Please generate the video according to the creative brief.'

export const DEFAULT_VIDEO_USER_PROMPT_ZH = '请根据创作意图生成视频。'

export function defaultVideoUserPrompt(locale?: string): string {
  return pickByLocale(locale, DEFAULT_VIDEO_USER_PROMPT_EN, DEFAULT_VIDEO_USER_PROMPT_ZH)
}

export function buildVideoPrompt(instruction: string, locale?: string): string {
  return buildOrDefault(instruction, locale, defaultVideoUserPrompt)
}

// ——— 声音 ———

export const DEFAULT_TIMBRE_USER_PROMPT_EN =
  'Please generate the audio / speech audio according to the brief.'

export const DEFAULT_TIMBRE_USER_PROMPT_ZH = '请根据创作意图生成声音。'

export function defaultTimbreUserPrompt(locale?: string): string {
  return pickByLocale(locale, DEFAULT_TIMBRE_USER_PROMPT_EN, DEFAULT_TIMBRE_USER_PROMPT_ZH)
}

export function buildVoicePrompt(instruction: string, locale?: string): string {
  return buildOrDefault(instruction, locale, defaultTimbreUserPrompt)
}

// ——— 提示词优化 ———

export const DEFAULT_OPTIMIZE_USER_PROMPT_EN =
  'Please optimize the prompt for clarity and model readiness.'

export const DEFAULT_OPTIMIZE_USER_PROMPT_ZH = '请优化提示词，使其更清晰、更适合模型执行。'

export function defaultOptimizeUserPrompt(locale?: string): string {
  return pickByLocale(locale, DEFAULT_OPTIMIZE_USER_PROMPT_EN, DEFAULT_OPTIMIZE_USER_PROMPT_ZH)
}

export function buildOptimizePrompt(instruction: string, locale?: string): string {
  return buildOrDefault(instruction, locale, defaultOptimizeUserPrompt)
}

// ——— 图片反推提示词 ———

export const DEFAULT_TO_PROMPT_USER_PROMPT_EN =
  'Generate a structured Chinese prompt from the image, covering subject, environment, lighting, camera language, and style keywords.'

export const DEFAULT_TO_PROMPT_USER_PROMPT_ZH =
  '根据图片生成结构化中文提示词，包括主体描述、环境、光影、镜头语言、风格关键词。'

export function defaultToPromptUserPrompt(locale?: string): string {
  return pickByLocale(locale, DEFAULT_TO_PROMPT_USER_PROMPT_EN, DEFAULT_TO_PROMPT_USER_PROMPT_ZH)
}

export function buildToPromptUserPrompt(instruction: string, locale?: string): string {
  return buildOrDefault(instruction, locale, defaultToPromptUserPrompt)
}

// ——— 分镜拆分 ———

export const DEFAULT_SHOT_SPLIT_USER_PROMPT_EN =
  'Split the screenplay into shots and output ONLY the JSON array required by the system prompt (Shot Editor table schema).'

export const DEFAULT_SHOT_SPLIT_USER_PROMPT_ZH =
  '请将剧本拆分为分镜，并仅输出系统提示词要求的 JSON 数组（对齐分镜编辑表格字段）。'

export function defaultShotSplitUserPrompt(locale?: string): string {
  return pickByLocale(locale, DEFAULT_SHOT_SPLIT_USER_PROMPT_EN, DEFAULT_SHOT_SPLIT_USER_PROMPT_ZH)
}

export function buildShotSplitPrompt(instruction: string, locale?: string): string {
  return buildOrDefault(instruction, locale, defaultShotSplitUserPrompt)
}

// ——— 世界元素提取 ———

export const DEFAULT_WORLD_EXTRACT_USER_PROMPT_EN =
  'Extract a reusable visual catalog from the text and output ONLY the JSON object required by the system prompt (characters / scenes / props / weapons). Hard rules: characters = front portrait on plain background (no environment); scenes = empty of people; props/weapons = object-only product shots on plain background (no scenery). Appearance + materials + lighting—not plot summaries.'

export const DEFAULT_WORLD_EXTRACT_USER_PROMPT_ZH =
  '请从文本提取可复用的视觉元素目录，并仅输出系统提示词要求的 JSON 对象（characters / scenes / props / weapons）。硬性要求：角色=正面设定照+纯色背景（无环境）；场景=空无一人；道具/武器=纯色底产品照（无场景）。写外观、材质、光影——不要写成剧情摘要。'

export function defaultWorldExtractUserPrompt(locale?: string): string {
  return pickByLocale(
    locale,
    DEFAULT_WORLD_EXTRACT_USER_PROMPT_EN,
    DEFAULT_WORLD_EXTRACT_USER_PROMPT_ZH
  )
}

export function buildWorldExtractPrompt(instruction: string, locale?: string): string {
  return buildOrDefault(instruction, locale, defaultWorldExtractUserPrompt)
}

// ——— 叙事单元拆解 ———

export const DEFAULT_NARRATIVE_SPLIT_USER_PROMPT_EN =
  'Decompose the screenplay into narrative units and output ONLY the JSON array required by the system prompt. Rules of thumb: scene/beat level (not shots); cover the whole story in order; merge same-goal micro-actions; split on reveals/escalations/decisions; pick one dramaticFunction from 建置|冲突|转折|高潮|收束|过渡; keep 已审核 units unchanged.'

export const DEFAULT_NARRATIVE_SPLIT_USER_PROMPT_ZH =
  '请将剧本拆解为叙事单元，并仅输出系统提示词要求的 JSON 数组。要点：场/节拍级（非镜头）；按序覆盖全文；同目标微动作合并；遇揭露/升级/抉择再拆；dramaticFunction 只选 建置|冲突|转折|高潮|收束|过渡；已审核单元原样保留。'

export function defaultNarrativeSplitUserPrompt(locale?: string): string {
  return pickByLocale(
    locale,
    DEFAULT_NARRATIVE_SPLIT_USER_PROMPT_EN,
    DEFAULT_NARRATIVE_SPLIT_USER_PROMPT_ZH
  )
}

export function buildNarrativeSplitPrompt(instruction: string, locale?: string): string {
  return buildOrDefault(instruction, locale, defaultNarrativeSplitUserPrompt)
}
