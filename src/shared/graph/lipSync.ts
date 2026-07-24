/**
 * 对口型节点：角色图或参考视频 + 声音 → Seedance 等多模态视频模型。
 * Prompt 使用方舟 Seedance 约定「图片1 / 视频1 / 音频1」指代。
 */

export type LipSyncVisualKind = 'image' | 'video'

function isEnglishLocale(locale?: string): boolean {
  return locale === 'en-US' || (locale?.startsWith('en') ?? false)
}

function pickByLocale(locale: string | undefined, en: string, zh: string): string {
  return isEnglishLocale(locale) ? en : zh
}

function resolveOrDefault(
  raw: string | undefined,
  locale: string | undefined,
  fallback: (locale?: string) => string
): string {
  const trimmed = raw?.trim() ?? ''
  return trimmed || fallback(locale)
}

export const DEFAULT_LIP_SYNC_SYSTEM_PROMPT_EN =
  'You generate lip-sync video driven by reference audio. Keep the character identity and look from the reference image or video. Mouth shapes, facial motion, and timing must follow the reference audio closely. When a reference video is provided, preserve its camera, motion, and scene while replacing speech lip sync. Natural head motion; no subtitles or watermarks.'

export const DEFAULT_LIP_SYNC_SYSTEM_PROMPT_ZH =
  '你负责生成由参考音频驱动的对口型视频。严格保持参考图或参考视频中的人物身份与外观；口型、表情与节奏必须紧跟参考音频。若提供参考视频，尽量保留其运镜、动作与场景，仅让角色口型跟随新音频。允许自然头部微动；不要字幕、水印或多余 UI。'

export const DEFAULT_LIP_SYNC_IMAGE_USER_PROMPT_EN =
  'The character in image 1 speaks to camera. Lip sync and performance must follow audio 1 exactly. Medium shot, natural gestures, steady framing.'

export const DEFAULT_LIP_SYNC_IMAGE_USER_PROMPT_ZH =
  '图片1中的角色对着镜头自然说话，口型与动作严格跟随音频1。中景构图，轻微头部与手势，画面稳定，无字幕无水印。'

export const DEFAULT_LIP_SYNC_VIDEO_USER_PROMPT_EN =
  'Keep the character, camera, and motion from video 1. Make the character speak with precise lip sync to audio 1. Preserve scene continuity; no subtitles or watermarks.'

export const DEFAULT_LIP_SYNC_VIDEO_USER_PROMPT_ZH =
  '保持视频1中的角色形象、运镜与动作，让角色口型严格跟随音频1说话。尽量保留原视频场景与节奏，无字幕无水印。'

/** @deprecated 使用 DEFAULT_LIP_SYNC_IMAGE_USER_PROMPT_* */
export const DEFAULT_LIP_SYNC_USER_PROMPT_EN = DEFAULT_LIP_SYNC_IMAGE_USER_PROMPT_EN
/** @deprecated 使用 DEFAULT_LIP_SYNC_IMAGE_USER_PROMPT_* */
export const DEFAULT_LIP_SYNC_USER_PROMPT_ZH = DEFAULT_LIP_SYNC_IMAGE_USER_PROMPT_ZH

export function defaultLipSyncSystemPrompt(locale?: string): string {
  return pickByLocale(locale, DEFAULT_LIP_SYNC_SYSTEM_PROMPT_EN, DEFAULT_LIP_SYNC_SYSTEM_PROMPT_ZH)
}

export function resolveLipSyncSystemPrompt(raw: string | undefined, locale?: string): string {
  return resolveOrDefault(raw, locale, defaultLipSyncSystemPrompt)
}

export function defaultLipSyncUserPrompt(
  locale?: string,
  visual: LipSyncVisualKind = 'image'
): string {
  if (visual === 'video') {
    return pickByLocale(
      locale,
      DEFAULT_LIP_SYNC_VIDEO_USER_PROMPT_EN,
      DEFAULT_LIP_SYNC_VIDEO_USER_PROMPT_ZH
    )
  }
  return pickByLocale(
    locale,
    DEFAULT_LIP_SYNC_IMAGE_USER_PROMPT_EN,
    DEFAULT_LIP_SYNC_IMAGE_USER_PROMPT_ZH
  )
}

export function buildLipSyncPrompt(
  instruction: string,
  locale?: string,
  visual: LipSyncVisualKind = 'image'
): string {
  const trimmed = instruction.trim()
  return trimmed || defaultLipSyncUserPrompt(locale, visual)
}
