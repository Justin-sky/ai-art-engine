import type { ModelModality } from '@shared/modelProvider'
import {
  LOAD_AUDIO_CLASSES,
  LOAD_IMAGE_CLASSES,
  LOAD_VIDEO_CLASSES,
  type ComfyApiNode,
  type ComfyApiWorkflow
} from './injectWorkflow'
import catalog from './modelCapabilities.json'

export interface ComfyUiModelCapabilitiesCatalog {
  meta: { docs: string[]; note: string }
  profiles: Record<
    string,
    {
      modality: 'image' | 'video' | 'audio'
      label: string
      capabilities: Record<string, unknown>
    }
  >
}

const data = catalog as ComfyUiModelCapabilitiesCatalog

function profileCapabilities(profileId: string): Record<string, unknown> | null {
  const profile = data.profiles[profileId]
  if (!profile?.capabilities) return null
  return { ...profile.capabilities }
}

function classMatches(classTypes: string[], patterns: RegExp[]): boolean {
  return classTypes.some((raw) => {
    const text = raw.trim().toLowerCase()
    return text.length > 0 && patterns.some((pattern) => pattern.test(text))
  })
}

const AUDIO_NODE_PATTERNS = [
  /saveaudio/,
  /loadaudio/,
  /previewaudio/,
  /emptylatentaudio/,
  /vaedecodeaudio/,
  /stableaudio/,
  /^tts/,
  /indextts/,
  /cosyvoice/,
  /fishspeech/,
  /gptsovits/,
  /sovits/,
  /vocos/,
  /zonos/
]

const VIDEO_OUTPUT_PATTERNS = [
  /savevideo/,
  /createvideo/,
  /previewvideo/,
  /vhs_videocombine/,
  /vhs_savevideo/,
  /savewebm/,
  /videocombine/
]

const VIDEO_GENERATE_PATTERNS = [
  /emptyhunyuanlatentvideo/,
  /hunyuanvideo/,
  /emptyltxv/,
  /ltxvlatent/,
  /wanimagetovideo/,
  /wantovideo/,
  /wanvideo/,
  /wanfun/,
  /wanvace/,
  /wancamera/,
  /animatediff/,
  /svd_img2vid/,
  /img2vid/,
  /i2vgen/,
  /cogvideox/,
  /cogvideo/,
  /text2video/,
  /image2video/,
  /videolinear/,
  /^wan/,
  /minimax/
]

const IMAGE_NODE_PATTERNS = [
  /saveimage/,
  /previewimage/,
  /emptylatentimage/,
  /emptysd3latentimage/
]

export function inferComfyUiWorkflowModalityFromClassTypes(
  classTypes?: string[]
): 'image' | 'video' | 'audio' | null {
  if (!classTypes?.length) return null
  if (classMatches(classTypes, VIDEO_OUTPUT_PATTERNS)) return 'video'
  if (classMatches(classTypes, VIDEO_GENERATE_PATTERNS)) return 'video'
  if (classMatches(classTypes, AUDIO_NODE_PATTERNS)) return 'audio'
  if (classMatches(classTypes, IMAGE_NODE_PATTERNS)) return 'image'
  return null
}

export function inferComfyUiWorkflowModality(
  id: string,
  name?: string,
  classTypes?: string[]
): 'image' | 'video' | 'audio' {
  if (classTypes?.length) {
    return inferComfyUiWorkflowModalityFromClassTypes(classTypes) ?? 'image'
  }

  const raw = `${id} ${name ?? ''}`
  const text = raw.toLowerCase()
  if (
    /TTS|语音|声音|配音|音频/.test(raw) ||
    /\b(audio|sfx|music|sound|speech|tts)\b/.test(text) ||
    /stable.?audio/.test(text)
  ) {
    return 'audio'
  }
  if (
    /视频|文生视频|图生视频|首尾帧/.test(raw) ||
    /txt2vid|img2vid|txt2video|img2video/.test(text) ||
    /t2v|i2v|video|animatediff|ltxv|hunyuan.?video/.test(text) ||
    /svd[\d._-]|svd$/.test(text) ||
    /(?:^|[^a-z0-9])wan(?:[\d._-]|image|video|fun|vace|$)/i.test(raw) ||
    /animate/.test(text)
  ) {
    return 'video'
  }
  return 'image'
}

/**
 * 从视频工作流推断支持的媒体输入类型（image / video / audio）。
 * 命中 → 对应 max = 1（端口显示）；未命中 → 0（端口隐藏，如纯文生视频）。
 * 找不到生成节点 / graph 为空 → 返回 null（无法推断，交由调用方回退）。
 *
 * 两个信号取并集：
 * 1. 负载节点（LoadImage / VHS_LoadVideo / VHS_LoadAudio）——注入端 `injectComfyWorkflow`
 *    实际写文件的目标，与「参考媒体往哪灌」一致，比 socket 键名更可靠；
 * 2. 生成节点的 media 输入 socket 键名（image / start_image / reference_image、
 *    reference_video / reference_audio …）。
 * r2v 这类多模态参考工作流的视频/音频常经由 VHS_LoadVideo / VHS_LoadAudio 节点注入，
 * 生成节点上未必有对应 socket，只靠 socket 会误判为纯文生视频。
 */
export function inferComfyUiMediaInputs(graph: ComfyApiWorkflow | null): {
  maxImages: number
  maxVideos: number
  maxAudios: number
} | null {
  if (!graph) return null
  let foundGenerate = false
  let hasImage = false
  let hasVideo = false
  let hasAudio = false
  let anyMediaSignal = false
  for (const node of Object.values(graph)) {
    if (!node || typeof node !== 'object') continue
    const cls = String((node as ComfyApiNode).class_type ?? '').trim().toLowerCase()
    if (!cls) continue

    // 负载节点：注入端实际写文件的目标，优先级最高
    if (LOAD_IMAGE_CLASSES.has(cls)) {
      hasImage = true
      anyMediaSignal = true
    }
    if (LOAD_VIDEO_CLASSES.has(cls)) {
      hasVideo = true
      anyMediaSignal = true
    }
    if (LOAD_AUDIO_CLASSES.has(cls)) {
      hasAudio = true
      anyMediaSignal = true
    }

    // 生成节点的 media socket 键名作为补充信号
    if (!classMatches([cls], VIDEO_GENERATE_PATTERNS)) continue
    foundGenerate = true
    const inputs = (node as ComfyApiNode).inputs
    if (!inputs || typeof inputs !== 'object') continue
    for (const key of Object.keys(inputs)) {
      const k = key.toLowerCase()
      if (/image/.test(k)) {
        hasImage = true
        anyMediaSignal = true
      } else if (/video/.test(k)) {
        hasVideo = true
        anyMediaSignal = true
      } else if (/audio/.test(k)) {
        hasAudio = true
        anyMediaSignal = true
      }
    }
  }
  if (!foundGenerate) return null
  // 生成节点 + 负载节点都没有任何 media 输入 → 纯文生视频
  if (!anyMediaSignal) return { maxImages: 0, maxVideos: 0, maxAudios: 0 }
  return { maxImages: hasImage ? 1 : 0, maxVideos: hasVideo ? 1 : 0, maxAudios: hasAudio ? 1 : 0 }
}

export function resolveComfyUiModelCapabilities(
  modelId: string,
  modality?: ModelModality
): Record<string, unknown> | null {
  const id = modelId.trim()

  const inferred = modality === 'video' || modality === 'audio' || modality === 'image'
    ? modality
    : inferComfyUiWorkflowModality(id)
  if (inferred === 'audio') return profileCapabilities('audio-base')
  if (inferred === 'video') {
    // r2v（参考生视频）接受图片/视频/音频三类参考，i2v 只接受图片，先命中更具体的一支
    if (/r2v|ref.?to.?video|reference.?to.?video/i.test(id)) {
      return profileCapabilities('video-r2v')
    }
    return /i2v|img2vid|img2video|image2video|image.?to.?video|ref/i.test(id)
      ? profileCapabilities('video-ref')
      : profileCapabilities('video-base')
  }
  return /i2i|img2img|image.?to.?image|ref/i.test(id)
    ? profileCapabilities('image-ref')
    : profileCapabilities('image-base')
}
