import { randomUUID } from 'crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { extname, join } from 'path'
import axios from 'axios'
import type {
  GenerateSpeechInput,
  GenerateSpeechResult,
  ModelProviderInstance
} from '@shared/modelProvider'
import { VOLCENGINE_OPENSPEECH_CREDENTIALS_URL } from '@shared/modelProvider'
import { AppError, resolveAppErrorLocale, fail, defErr, defErrSimple } from '@shared/errors/appError'
import { PROVIDER_ERRORS } from '../catalog'
import { projectService } from '../../projectService'
import { formatAuthError, readHttpError } from '../http'

// —— 声音设计（voice_design）双语文案 ——
const E_OS_MISSING_KEY = defErrSimple(
  'provider.volcengine.voiceDesign.missingApiKey',
  '请先填写火山方舟 / 豆包语音 API Key',
  'Fill in the Volcengine Ark / Doubao speech API Key first'
)
const E_OS_SPEAKER_ID_REQUIRED = defErrSimple(
  'provider.volcengine.voiceDesign.speakerIdRequired',
  '请填写已购买的 speaker_id（声音代号，形如 S_xxx）。在设置 → 方舟 → 声音中手填并勾选。',
  'Enter the purchased speaker_id (voice code shaped like S_xxx). Fill it in under Settings → Ark → Voice and enable it.'
)
const E_OS_PROMPT_OR_IMAGE_REQUIRED = defErrSimple(
  'provider.volcengine.voiceDesign.promptOrImageRequired',
  '请提供声音文本描述，或接入参考图片',
  'Provide a voice text description or attach a reference image'
)
const E_OS_TRAINING = defErrSimple(
  'provider.volcengine.voiceDesign.training',
  '声音设计训练中，请稍后重试（status=Training）',
  'Voice design is still training; please try again later (status=Training)'
)
const E_OS_FAILED_STATUS = defErrSimple(
  'provider.volcengine.voiceDesign.failedStatus',
  '声音设计失败（status=Failed）',
  'Voice design failed (status=Failed)'
)
/** 上游接口报错：错误码标签（data.message 缺失时的兜底） */
function errCodeLabel(code: number): string {
  return resolveAppErrorLocale() === 'en-US' ? `error code ${code}` : `错误码 ${code}`
}
const E_OS_API_FAILED = defErr<{ detail: string; logId?: string }>(
  'provider.volcengine.voiceDesign.apiFailed',
  ({ detail, logId }) => `声音设计失败: ${detail}${logId ? `（X-Tt-Logid: ${logId}）` : ''}`,
  ({ detail, logId }) => `Voice design failed: ${detail}${logId ? ` (X-Tt-Logid: ${logId})` : ''}`
)
const E_OS_NO_PREVIEW_AUDIO = defErr<{ logId?: string }>(
  'provider.volcengine.voiceDesign.noPreviewAudio',
  ({ logId }) =>
    `声音设计未返回试听音频${logId ? `（X-Tt-Logid: ${logId}）` : ''}。请确认 speaker_id 仍有设计次数`,
  ({ logId }) =>
    `Voice design returned no preview audio${logId ? ` (X-Tt-Logid: ${logId})` : ''}. Confirm the speaker_id still has design quota left`
)

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
  if (!buf.length) throw fail(PROVIDER_ERRORS.noAudioResult)
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
  if (!apiKey) throw fail(E_OS_MISSING_KEY)

  const speakerId = input.voice?.trim() || modelId.trim()
  if (!speakerId) throw fail(E_OS_SPEAKER_ID_REQUIRED)

  const textPrompt = clip(input.input, 200)
  const imageUrl = input.images?.map((u) => u.trim()).find(Boolean)
  const imagePrompt = imageUrl ? toVoiceDesignImagePrompt(imageUrl) : undefined
  const hasImage =
    Boolean(imagePrompt?.image_bytes?.trim()) || Boolean(imagePrompt?.image_url?.trim())

  // 文档：text_prompt 与 image_prompt 不能同时为空；同时存在时 image 优先
  if (!textPrompt && !hasImage) {
    throw fail(E_OS_PROMPT_OR_IMAGE_REQUIRED)
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
    const logIdParam: string | undefined = logId || undefined
    if (data?.code != null && data.code !== 0 && !data.demo_audio) {
      const detail = data.message || errCodeLabel(data.code)
      throw fail(E_OS_API_FAILED, { detail, logId: logIdParam })
    }

    const status = data?.status
    if (status === 1 && !data?.demo_audio) {
      throw fail(E_OS_TRAINING)
    }
    if (status === 3) {
      throw fail(E_OS_FAILED_STATUS)
    }
    if (!data?.demo_audio?.trim()) {
      throw fail(E_OS_NO_PREVIEW_AUDIO, { logId: logIdParam })
    }

    const buf = await downloadAudioUrl(data.demo_audio.trim())
    return persistSpeechBuffer(buf, input, speakerId)
  } catch (err) {
    if (
      (err instanceof AppError &&
        err.code.startsWith('provider.volcengine.voiceDesign.')) ||
      (err instanceof Error && err.message.startsWith('声音设计'))
    ) {
      throw err
    }
    throw fail(E_OS_API_FAILED, { detail: formatAuthError(await readHttpError(err), provider) })
  }
}

/** 方舟层声音：传入克隆参考音频 → 声音复刻（few-shot）；否则 voice_design */
export async function generateVolcengineOpenspeechSpeech(
  provider: ModelProviderInstance,
  modelId: string,
  input: GenerateSpeechInput
): Promise<GenerateSpeechResult> {
  if (input.referenceAudio?.trim()) {
    return cloneOpenspeechVoice(provider, modelId, input)
  }
  return generateOpenspeechVoiceDesign(provider, modelId, input)
}

const VOICE_CLONE_PATH = '/api/v3/tts/voice_clone'
const E_OS_CLONE_AUDIO_NOT_FOUND = defErrSimple(
  'provider.volcengine.voiceClone.audioNotFound',
  '克隆参考音频文件不存在',
  'Clone reference audio file not found'
)
const E_OS_CLONE_NO_DEMO = defErrSimple(
  'provider.volcengine.voiceClone.noDemo',
  '声音复刻已完成（speaker_id 已生成），但暂未返回试听音频',
  'Voice clone finished (speaker_id created) but no preview audio was returned'
)
const E_OS_CLONE_EMPTY_RESULT = defErrSimple(
  'provider.volcengine.voiceClone.emptyResult',
  '声音复刻未返回有效结果',
  'Voice clone returned no usable result'
)

function resolveCloneAudioSource(referenceAudio: string):
  | { kind: 'base64'; data: string; ext?: string }
  | { kind: 'url'; url: string } {
  const src = referenceAudio.trim()
  if (src.startsWith('data:audio/')) {
    return { kind: 'base64', data: src.slice(src.indexOf(',') + 1) }
  }
  if (/^https?:\/\//i.test(src)) return { kind: 'url', url: src }
  if (!projectService.isOpen()) {
    throw fail(
      defErrSimple(
        'provider.volcengine.voiceClone.noProject',
        '未打开工程，无法读取工程内参考音频',
        'No project is open; cannot read the in-project reference audio'
      )
    )
  }
  const abs = join(projectService.getRoot(), ...src.split('/'))
  if (!existsSync(abs)) throw fail(E_OS_CLONE_AUDIO_NOT_FOUND)
  const buf = readFileSync(abs)
  return { kind: 'base64', data: buf.toString('base64'), ext: extname(src).replace(/^\./, '') }
}

/**
 * 方舟声音复刻（few-shot voice clone）：以 10-30s 参考人声克隆新音色。
 * 成功后回填角色音色档案（voice = 新 speaker_id），并落盘试听音频。
 */
export async function cloneOpenspeechVoice(
  provider: ModelProviderInstance,
  modelId: string,
  input: GenerateSpeechInput
): Promise<GenerateSpeechResult> {
  void modelId
  const apiKey = provider.apiKey.trim()
  if (!apiKey) throw fail(E_OS_MISSING_KEY)
  const source = resolveCloneAudioSource(input.referenceAudio!)
  const format =
    source.kind === 'base64' && source.ext ? (source.ext === 'wav' ? 'wav' : 'mp3') : 'mp3'

  const body: Record<string, unknown> = {
    audio: source.kind === 'base64' ? source.data : source.url,
    text: clip(input.input, 200) || DEFAULT_VOICE_DESIGN_DEMO_TEXT,
    prompt: { text_prompt: clip(input.voice ?? '', 200) },
    language: 0,
    audio_format: format
  }

  try {
    const { data, headers } = await axios.post<{
      code?: number
      message?: string
      speaker_id?: string
      status?: number
      demo_audio?: string
    }>(`${VOLCENGINE_OPENSPEECH_BASE_URL}${VOICE_CLONE_PATH}`, body, {
      headers: openspeechHeaders(apiKey),
      timeout: 300_000,
      validateStatus: () => true
    })

    const logId = headers['x-tt-logid'] || headers['X-Tt-Logid']
    const logIdParam: string | undefined = logId || undefined
    if (data?.code != null && data.code !== 0 && !data.speaker_id) {
      throw fail(E_OS_API_FAILED, {
        detail: data.message || errCodeLabel(data.code),
        logId: logIdParam
      })
    }
    if (data?.status === 1) {
      throw fail(E_OS_TRAINING)
    }
    if (data?.status === 3) {
      throw fail(E_OS_FAILED_STATUS)
    }
    const speakerId = data?.speaker_id?.trim()
    if (!speakerId) throw fail(E_OS_CLONE_EMPTY_RESULT)
    if (!data?.demo_audio?.trim()) throw fail(E_OS_CLONE_NO_DEMO)

    const buf = await downloadAudioUrl(data.demo_audio.trim())
    const result = await persistSpeechBuffer(buf, input, speakerId)
    return result
  } catch (err) {
    if (err instanceof AppError) throw err
    throw fail(E_OS_API_FAILED, { detail: formatAuthError(await readHttpError(err), provider) })
  }
}
