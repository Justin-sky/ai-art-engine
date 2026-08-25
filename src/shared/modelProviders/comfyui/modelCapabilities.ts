import type { ModelModality } from '@shared/modelProvider'
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
    return /i2v|img2vid|image.?to.?video|ref/i.test(id)
      ? profileCapabilities('video-ref')
      : profileCapabilities('video-base')
  }
  return /i2i|img2img|image.?to.?image|ref/i.test(id)
    ? profileCapabilities('image-ref')
    : profileCapabilities('image-base')
}
