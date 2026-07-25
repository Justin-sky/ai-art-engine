import { randomUUID } from 'crypto'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import axios from 'axios'
import type {
  GenerateSpeechInput,
  GenerateSpeechResult,
  ModelProviderInstance
} from '@shared/modelProvider'
import { VOLCENGINE_OPENSPEECH_CREDENTIALS_URL } from '@shared/modelProvider'
import { projectService } from '../../projectService'
import { formatAuthError, readHttpError } from '../http'

/** 豆包语音 openspeech（与方舟 ark Base URL 独立） */
export const VOLCENGINE_OPENSPEECH_BASE_URL = 'https://openspeech.bytedance.com'

export { VOLCENGINE_OPENSPEECH_CREDENTIALS_URL }

const VOICE_DESIGN_PATH = '/api/v3/tts/voice_design'

/** 文档示例试听文案（声音设计必填 text，限制 300 字） */
const DEFAULT_VOICE_DESIGN_DEMO_TEXT =
  '夜色渐浓，城市的灯火次第亮起，每个人都在为自己的生活奔波，从未停歇。'

function clip(text: string, max: number): string {
  const t = text.trim()
  if (t.length <= max) return t
  return t.slice(0, max)
}

function openspeechHeaders(apiKey: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'X-Api-Key': apiKey.trim(),
    'X-Api-Request-Id': randomUUID()
  }
}

/** data URL → image_bytes；http(s) → image_url */
export function toVoiceDesignImagePrompt(url: string): {
  image_url?: string
  image_bytes?: string
} {
  const u = url.trim()
  if (!u) return {}
  const dataMatch = /^data:image\/[a-z0-9.+-]+;base64,(.+)$/i.exec(u)
  if (dataMatch?.[1]) {
    return { image_bytes: dataMatch[1] }
  }
  if (/^https?:\/\//i.test(u)) {
    return { image_url: u }
  }
  // 裸 base64
  if (u.length > 64 && !u.includes('://') && !u.includes('/')) {
    return { image_bytes: u }
  }
  return { image_url: u }
}

async function persistSpeechBuffer(
  buf: Buffer,
  input: GenerateSpeechInput,
  speakerId: string
): Promise<GenerateSpeechResult> {
  if (!buf.length) throw new Error('模型未返回音频数据')
  const stamp = Date.now()

  const tmpDir = join(process.cwd(), '.aiartengine-tmp', 'tts')
  if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true })
  const tmpPath = join(tmpDir, `audio-${stamp}.mp3`)
  writeFileSync(tmpPath, buf)

  if (projectService.isOpen()) {
    const asset = projectService.attachExternalGeneratedFile({
      type: 'voice',
      sourceFilePath: tmpPath,
      name: input.name ?? `声音 ${new Date().toLocaleString()}`,
      prompt: input.input,
      outputDir: input.outputDir?.trim() || undefined
    })
    return {
      model: speakerId,
      voice: speakerId,
      format: 'mp3',
      filePath: tmpPath,
      assetId: asset.id,
      relativePath: asset.relativePath
    }
  }

  return { model: speakerId, voice: speakerId, format: 'mp3', filePath: tmpPath }
}

async function downloadAudioUrl(url: string): Promise<Buffer> {
  const { data } = await axios.get<ArrayBuffer>(url, {
    responseType: 'arraybuffer',
    timeout: 120_000
  })
  return Buffer.from(data)
}

/**
 * 声音设计 HTTP：https://openspeech.bytedance.com/api/v3/tts/voice_design
 * - speaker_id：控制台购买的声音代号（手填，如 S_xxx）
 * - prompt.text_prompt：声音描述
 * - text：试听文本
 *
 * speaker 优先取 input.voice，否则用 modelId（设置里手填并勾选的购买声音）。
 */
export async function generateOpenspeechVoiceDesign(
  provider: ModelProviderInstance,
  modelId: string,
  input: GenerateSpeechInput
): Promise<GenerateSpeechResult> {
  const apiKey = provider.apiKey.trim()
  if (!apiKey) throw new Error('请先填写火山方舟 / 豆包语音 API Key')

  const speakerId = input.voice?.trim() || modelId.trim()
  if (!speakerId) {
    throw new Error(
      '请填写已购买的 speaker_id（声音代号，形如 S_xxx）。在设置 → 方舟 → 声音中手填并勾选。'
    )
  }

  const textPrompt = clip(input.input, 200)
  const imageUrl = input.images?.map((u) => u.trim()).find(Boolean)
  const imagePrompt = imageUrl ? toVoiceDesignImagePrompt(imageUrl) : undefined
  const hasImage =
    Boolean(imagePrompt?.image_bytes?.trim()) || Boolean(imagePrompt?.image_url?.trim())

  // 文档：text_prompt 与 image_prompt 不能同时为空；同时存在时 image 优先
  if (!textPrompt && !hasImage) {
    throw new Error('请提供声音文本描述，或接入参考图片')
  }

  const prompt: Record<string, unknown> = {}
  if (textPrompt) prompt.text_prompt = textPrompt
  if (hasImage && imagePrompt) prompt.image_prompt = imagePrompt

  const body = {
    speaker_id: speakerId,
    text: DEFAULT_VOICE_DESIGN_DEMO_TEXT,
    prompt,
    language: 0
  }

  try {
    const { data, headers } = await axios.post<{
      code?: number
      message?: string
      speaker_id?: string
      status?: number
      demo_audio?: string
      available_training_times?: number
    }>(`${VOLCENGINE_OPENSPEECH_BASE_URL}${VOICE_DESIGN_PATH}`, body, {
      headers: openspeechHeaders(apiKey),
      timeout: 180_000,
      validateStatus: () => true
    })

    const logId = headers['x-tt-logid'] || headers['X-Tt-Logid']
    if (data?.code != null && data.code !== 0 && !data.demo_audio) {
      const detail = data.message || `错误码 ${data.code}`
      throw new Error(
        `声音设计失败: ${detail}${logId ? `（X-Tt-Logid: ${logId}）` : ''}`
      )
    }

    const status = data?.status
    if (status === 1 && !data?.demo_audio) {
      throw new Error('声音设计训练中，请稍后重试（status=Training）')
    }
    if (status === 3) {
      throw new Error('声音设计失败（status=Failed）')
    }
    if (!data?.demo_audio?.trim()) {
      throw new Error(
        `声音设计未返回试听音频${logId ? `（X-Tt-Logid: ${logId}）` : ''}。请确认 speaker_id 仍有设计次数`
      )
    }

    const buf = await downloadAudioUrl(data.demo_audio.trim())
    return persistSpeechBuffer(buf, input, speakerId)
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('声音设计')) throw err
    throw new Error(
      `声音设计失败: ${formatAuthError(await readHttpError(err), provider)}`
    )
  }
}

/** 方舟层声音：仅 voice_design（手填已购 speaker_id） */
export async function generateVolcengineOpenspeechSpeech(
  provider: ModelProviderInstance,
  modelId: string,
  input: GenerateSpeechInput
): Promise<GenerateSpeechResult> {
  return generateOpenspeechVoiceDesign(provider, modelId, input)
}
