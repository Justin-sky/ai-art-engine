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

/**
 * 最终用户提示词：仅生成指令（已展开 @），不自动拼接上游/本节点正文。
 * 与 execute/generateText.ts 的 executeGameSystemGenerateNode 同口径。
 */
export function buildGameSystemPrompt(instruction: string, locale?: string): string {
  return buildOrDefault(instruction, locale, defaultGameSystemUserPrompt)
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

export const IMAGE_TRANSPARENT_BG_PROMPT_EN =
  'Isolated subject centered on a flat, uniform solid-color background with clean margins around the edges, no background clutter, no cast shadows, no ambient gradients, and strictly no checkerboard pattern.'

export const IMAGE_TRANSPARENT_BG_PROMPT_ZH =
  '主体独立居中，纯色均匀平涂背景，四周留出干净边缘，无背景杂物、无地面投影、无环境渐变、严禁绘制灰白棋盘格纹理。' // cjk-ok

const EXPLICIT_OPAQUE_BG_RE =
  /非透明背景|不透明背景|不要透明背景|不抠除背景|带完整背景|保留原背景|保留背景|实景背景|场景背景|环境背景|360\s*全景|全景氛围|\b(?:non-transparent\s+background|opaque\s+background|no\s+transparent\s+background|keep\s+(?:the\s+)?background|with\s+(?:a\s+)?full\s+background|detailed\s+(?:scene|environment)\s+background|360\s*panorama|equirectangular)\b/i // cjk-ok

/**
 * 判断提示词是否明确要求「非透明/带完整场景背景」：
 * 生图与 UI 生成默认开启透明背景，仅当节点显式设置 `generateTransparentBg: false` 或提示词明确要求非透明背景时跳过透明抠底。
 */
export function isExplicitOpaqueBgPrompt(prompt: string): boolean {
  const trimmed = prompt.trim()
  if (!trimmed) return false
  return EXPLICIT_OPAQUE_BG_RE.test(trimmed)
}

export function appendImageTransparentBgPrompt(prompt: string, locale?: string): string {
  const suffix = pickByLocale(
    locale,
    IMAGE_TRANSPARENT_BG_PROMPT_EN,
    IMAGE_TRANSPARENT_BG_PROMPT_ZH
  )
  const base = prompt.trim()
  if (!base) return suffix
  if (isExplicitOpaqueBgPrompt(base)) return base
  if (
    base.includes(IMAGE_TRANSPARENT_BG_PROMPT_ZH) ||
    base.includes(IMAGE_TRANSPARENT_BG_PROMPT_EN)
  ) {
    return base
  }
  return `${base}\n\n${suffix}`
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

// ——— 音效 ———

/**
 * 音效的用户提示词兜底。
 *
 * 与「声音」分开写：音效端点要的是**非人声的声音描述**，而『请根据创作意图生成声音』
 * 在音效场景下会被读成「生成一段人声」。有指令时仍以指令为准（见 `buildSoundEffectPrompt`）。
 */
export const DEFAULT_SOUND_EFFECT_USER_PROMPT_EN =
  'Generate the described non-speech sound effect (material, action, space, duration).'

export const DEFAULT_SOUND_EFFECT_USER_PROMPT_ZH =
  '生成所描述的音效（材质、动作、空间、时长），不要人声。' // cjk-ok（提示词模板：双语数据，随技能/SKILL 快照进入模型提示词）

export function defaultSoundEffectUserPrompt(locale?: string): string {
  return pickByLocale(
    locale,
    DEFAULT_SOUND_EFFECT_USER_PROMPT_EN,
    DEFAULT_SOUND_EFFECT_USER_PROMPT_ZH
  )
}

export function buildSoundEffectPrompt(instruction: string, locale?: string): string {
  return buildOrDefault(instruction, locale, defaultSoundEffectUserPrompt)
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
  'Extract a reusable visual catalog from the text and output ONLY the JSON object required by the system prompt (characters / scenes / props / weapons). First distill a detailed visual-style brief from the screenplay (genre, era, medium, palette, lighting, texture)—do NOT force UE5 / photoreal defaults. Hard framing rules: characters = front design sheet on plain background (no environment); scenes = empty of people; props/weapons = object-only product shots on plain background (no scenery). Appearance + materials + lighting + script-derived style—not plot summaries.'

export const DEFAULT_WORLD_EXTRACT_USER_PROMPT_ZH =
  '请从文本提取可复用的视觉元素目录，并仅输出系统提示词要求的 JSON 对象（characters / scenes / props / weapons）。先根据剧本提炼详细视觉风格简报（类型、时代、媒介、色板、光影、纹理）——禁止强制套用 UE5 / 真人写实默认。硬性构图：角色=正面设定照+纯色背景（无环境）；场景=空无一人；道具/武器=纯色底产品照（无场景）。写外观、材质、光影与剧本风格——不要写成剧情摘要。'

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
  return pickByLocale(locale, DEFAULT_BEAT_SPLIT_USER_PROMPT_EN, DEFAULT_BEAT_SPLIT_USER_PROMPT_ZH)
}

export function buildBeatSplitPrompt(instruction: string, locale?: string): string {
  return buildOrDefault(instruction, locale, defaultBeatSplitUserPrompt)
}

// ——— UI 界面拆分 ———

export const DEFAULT_UI_SPLIT_USER_PROMPT_EN =
  'Split the game system design into independent UI screens and output ONLY the bare JSON array required by the system prompt — no object wrapper, no markdown list. Each item is one screen with id, title, a detailed image-generation prompt, and a cleanPrompt textless base-layer prompt (identical layout, no readable glyphs). Prompts must NOT contain any visual-style, material, lighting or color description — strip such wording from the source document too; every visual detail comes from the style reference, and each prompt must end with the one-sentence style-lock clause telling the image model to follow the reference in UI elements, interface style, controls, colors and all other details.'

export const DEFAULT_UI_SPLIT_USER_PROMPT_ZH =
  '请将策划案中的 UI 拆分为独立界面，并仅输出系统提示词要求的 JSON 数组本身——不要用对象包裹，不要用 markdown 列表。每一项对应一个界面，包含 id、title、可用于生图的详细带字提示词 prompt，以及同界面的空字底图提示词 cleanPrompt（布局一致但无可读文字）。提示词禁止出现任何视觉风格/材质/光影/配色描述，策划案中的风格描述也要一并剔除；所有视觉细节都交给风格参考图，且每条 prompt 必须以风格锁定语结尾，明确要求图像模型参考风格参考图中的 UI 元素、界面风格、控件、配色等所有细节。'

export function defaultUiSplitUserPrompt(locale?: string): string {
  return pickByLocale(locale, DEFAULT_UI_SPLIT_USER_PROMPT_EN, DEFAULT_UI_SPLIT_USER_PROMPT_ZH)
}

export function buildUiSplitPrompt(instruction: string, locale?: string): string {
  return buildOrDefault(instruction, locale, defaultUiSplitUserPrompt)
}

// ——— 帧动画序列图 ———

export const DEFAULT_FRAME_ANIM_GEN_USER_PROMPT_EN =
  'Based on the existing content (upstream inputs and @ references), expand and organize it into a complete 2D frame-animation sequence description: a character/subject performs one continuous action; frames are ordered left to right then top to bottom in equal cells, identical look and art style across all frames, only the pose changes; clean output, no extra decoration.'

export const DEFAULT_FRAME_ANIM_GEN_USER_PROMPT_ZH =
  '根据现有内容（上游输入与 @ 引用）扩写、整理为完整的 2D 帧动画序列描述：角色/主体执行一个连贯动作，帧序从左到右、从上到下排布成等尺寸格子，所有帧外观与画风完全一致、仅动作变化；画面干净，不加多余装饰。'

export function defaultFrameAnimGenUserPrompt(locale?: string): string {
  return pickByLocale(
    locale,
    DEFAULT_FRAME_ANIM_GEN_USER_PROMPT_EN,
    DEFAULT_FRAME_ANIM_GEN_USER_PROMPT_ZH
  )
}

export function buildFrameAnimGenPrompt(instruction: string, locale?: string): string {
  return buildOrDefault(instruction, locale, defaultFrameAnimGenUserPrompt)
}

// ——— 3D 模型生成 ———

export const DEFAULT_MODEL3D_USER_PROMPT_EN =
  'Generate a 3D model according to the brief (text and/or reference images).'

export const DEFAULT_MODEL3D_USER_PROMPT_ZH = '根据创作意图（文本和/或参考图）生成 3D 模型。'

export function defaultModel3dUserPrompt(locale?: string): string {
  return pickByLocale(locale, DEFAULT_MODEL3D_USER_PROMPT_EN, DEFAULT_MODEL3D_USER_PROMPT_ZH)
}

export function buildModel3dPrompt(instruction: string, locale?: string): string {
  return buildOrDefault(instruction, locale, defaultModel3dUserPrompt)
}

// ——— 空间世界生成（World Labs Marble）———

export const DEFAULT_WORLD_MODEL_USER_PROMPT_EN =
  'Generate an explorable 3D world according to the brief (text and/or reference images).'

export const DEFAULT_WORLD_MODEL_USER_PROMPT_ZH =
  '根据创作意图（文本和/或参考图）生成可漫游的 3D 世界。'

export function defaultSpatialWorldUserPrompt(locale?: string): string {
  return pickByLocale(
    locale,
    DEFAULT_WORLD_MODEL_USER_PROMPT_EN,
    DEFAULT_WORLD_MODEL_USER_PROMPT_ZH
  )
}

export function buildSpatialWorldPrompt(instruction: string, locale?: string): string {
  return buildOrDefault(instruction, locale, defaultSpatialWorldUserPrompt)
}
