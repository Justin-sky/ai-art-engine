/**
 * 应用内媒体引用统一写 `@n`（与指令 chips、端口序一致）。
 * 火山方舟 Seedance 视频 API 要求按素材类型、上传顺序用中文指代：
 * `图片n` / `视频n` / `音频n`（见官方提示词指南）。
 * 首帧/尾帧也计入「图片」序号，故参考图 @n 会在其后顺延。
 */

export type VolcengineArkVideoMentionKind = 'image' | 'video' | 'voice'

export type VolcengineArkVideoMentionRef = {
  kind: 'image_url' | 'video_url' | 'audio_url' | string
}

function mentionKindOf(ref: VolcengineArkVideoMentionRef): VolcengineArkVideoMentionKind | null {
  if (ref.kind === 'image_url') return 'image'
  if (ref.kind === 'video_url') return 'video'
  if (ref.kind === 'audio_url') return 'voice'
  return null
}

function labelFor(kind: VolcengineArkVideoMentionKind, index: number): string {
  if (kind === 'video') return `视频${index}`
  if (kind === 'voice') return `音频${index}`
  return `图片${index}`
}

/**
 * 按 input_references 顺序（与执行侧 @n 一致）把 `@n` 改成 Seedance 官方指代。
 * `hasFirstFrame` / `hasLastFrame` 会占用「图片」序号前缀。
 */
export function rewriteAtMentionsForVolcengineArkVideoPrompt(
  prompt: string,
  options?: {
    inputReferences?: VolcengineArkVideoMentionRef[] | null
    hasFirstFrame?: boolean
    hasLastFrame?: boolean
  }
): string {
  if (!prompt) return prompt

  const refs = options?.inputReferences ?? []
  let imageIndex = (options?.hasFirstFrame ? 1 : 0) + (options?.hasLastFrame ? 1 : 0)
  let videoIndex = 0
  let audioIndex = 0
  const byMention = new Map<number, string>()

  refs.forEach((ref, i) => {
    const kind = mentionKindOf(ref)
    if (!kind) return
    const n = i + 1
    if (kind === 'image') {
      imageIndex += 1
      byMention.set(n, labelFor('image', imageIndex))
    } else if (kind === 'video') {
      videoIndex += 1
      byMention.set(n, labelFor('video', videoIndex))
    } else {
      audioIndex += 1
      byMention.set(n, labelFor('voice', audioIndex))
    }
  })

  return prompt.replace(/(^|[^\w@])@(\d+)\b/g, (full, prefix: string, num: string) => {
    const index = Number(num)
    const mapped = byMention.get(index)
    if (mapped) return `${prefix}${mapped}`
    // 无参考列表时：按图片序号兜底
    if (!refs.length) return `${prefix}图片${num}`
    return full
  })
}
