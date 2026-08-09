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

// ——— 游戏系统策划案 ———

export const DEFAULT_GAME_SYSTEM_USER_PROMPT_EN =
  'Based on the connected requirements, worldbuilding, references, and project context, produce a complete, development-ready game system design document. Cover the system overview and goals, core loop, feature rules and priorities, UI wireframes and control states, data/configuration needs, edge cases, acceptance criteria, open questions, and risks. Make every item concrete, enumerable, and testable. Do not specify concrete colors in UI descriptions; the palette comes from the style reference.'

export const DEFAULT_GAME_SYSTEM_USER_PROMPT_ZH =
  '根据连接的需求、世界观、参考资料与项目背景，生成一份完整、可直接交付开发的游戏系统策划案。必须覆盖系统概述与目标、核心循环、功能规则与优先级、UI 布局草图与控件状态、数据/配置需求、边界与异常处理、验收标准、待确认项及风险；所有条目须具体、可穷举、可测试。UI 描述不要指定具体颜色，配色由风格参考图决定。'

export function defaultGameSystemUserPrompt(locale?: string): string {
  return pickByLocale(
    locale,
    DEFAULT_GAME_SYSTEM_USER_PROMPT_EN,
    DEFAULT_GAME_SYSTEM_USER_PROMPT_ZH
  )
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

// ——— 场拆解 ———

export const DEFAULT_BEAT_SPLIT_USER_PROMPT_EN =
  'Decompose the screenplay into beats and output ONLY the JSON array required by the system prompt. Work at scene/beat level, cover the whole story in order, use beat- ids, fill the new time/location/action/conflict/atmosphere fields, and keep 已审核 beats unchanged.'

export const DEFAULT_BEAT_SPLIT_USER_PROMPT_ZH =
  '请将剧本拆解为场，并仅输出系统提示词要求的 JSON 数组。按故事顺序覆盖全文，使用 beat- id，完整填写时间、地点、核心动作、冲突与目标、氛围与声音等新字段；已审核场原样保留。'

export function defaultBeatSplitUserPrompt(locale?: string): string {
  return pickByLocale(
    locale,
    DEFAULT_BEAT_SPLIT_USER_PROMPT_EN,
    DEFAULT_BEAT_SPLIT_USER_PROMPT_ZH
  )
}

export function buildBeatSplitPrompt(instruction: string, locale?: string): string {
  return buildOrDefault(instruction, locale, defaultBeatSplitUserPrompt)
}

// ——— 场生成（单元细化） ———

export const DEFAULT_BEAT_UNIT_GEN_USER_PROMPT_EN =
  'Deepen the upstream beat unit along theme, story spine, and environment. Follow the system prompt strictly; output production-ready prose only (no JSON).'

export const DEFAULT_BEAT_UNIT_GEN_USER_PROMPT_ZH =
  '请基于上游场参考，按系统提示词对主题、故事脉络与环境氛围做深度细化；仅输出生产级正文，不要 JSON。'

export function defaultBeatUnitGenUserPrompt(locale?: string): string {
  return pickByLocale(
    locale,
    DEFAULT_BEAT_UNIT_GEN_USER_PROMPT_EN,
    DEFAULT_BEAT_UNIT_GEN_USER_PROMPT_ZH
  )
}

export function buildBeatUnitGenPrompt(instruction: string, locale?: string): string {
  return buildOrDefault(instruction, locale, defaultBeatUnitGenUserPrompt)
}

// ——— UI 界面拆分 ———

export const DEFAULT_UI_SPLIT_USER_PROMPT_EN =
  'Split the game system design into independent UI screens and output ONLY the bare JSON array required by the system prompt — no object wrapper, no markdown list. Each item is one screen with id, title, and a detailed image-generation prompt. Prompts must not specify concrete colors or visual style; both come from the style reference.'

export const DEFAULT_UI_SPLIT_USER_PROMPT_ZH =
  '请将策划案中的 UI 拆分为独立界面，并仅输出系统提示词要求的 JSON 数组本身——不要用对象包裹，不要用 markdown 列表。每一项对应一个界面，包含 id、title，以及可用于生图的详细提示词 prompt。提示词不要指定具体颜色或视觉风格，颜色与风格都交给风格参考图。'

export function defaultUiSplitUserPrompt(locale?: string): string {
  return pickByLocale(locale, DEFAULT_UI_SPLIT_USER_PROMPT_EN, DEFAULT_UI_SPLIT_USER_PROMPT_ZH)
}

export function buildUiSplitPrompt(instruction: string, locale?: string): string {
  return buildOrDefault(instruction, locale, defaultUiSplitUserPrompt)
}
