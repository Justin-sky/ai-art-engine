import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import type {
  GenerateSpeechInput,
  GenerateSpeechResult,
  ModelProviderInstance
} from '@shared/modelProvider'
import { isAppError, fail, defErr, defErrSimple } from '@shared/errors/appError'
import { PROVIDER_ERRORS } from '../catalog'
import { projectService } from '../../projectService'
import {
  assertMiniMaxBaseResp,
  createMiniMaxHttpClient,
  readMiniMaxHttpError,
  type MiniMaxBaseResp
} from './http'

// —— 音色设计双语文案（中文保持原文不变，英文为新增映射）——
const E_MMVD_PROMPT_REQUIRED = defErrSimple(
  'provider.minimax.voiceDesign.promptRequired',
  '请提供音色描述（声音设计 prompt）',
  'Provide a voice description (voice design prompt)'
)
const E_MMVD_NO_PREVIEW_AUDIO = defErrSimple(
  'provider.minimax.voiceDesign.noPreviewAudio',
  '音色设计未返回试听音频',
  'Voice design returned no preview audio'
)
const E_MMVD_NO_VOICE_ID = defErrSimple(
  'provider.minimax.voiceDesign.noVoiceId',
  '音色设计未返回 voice_id',
  'Voice design returned no voice_id'
)
const E_MMVD_INVALID_HEX = defErrSimple(
  'provider.minimax.voiceDesign.invalidTrialAudioHex',
  '音色设计返回的试听音频不是合法 hex',
  'The preview audio returned by voice design is not valid hex'
)
/** 上游/网络错误包装句式：上游响应原文作为 detail 原样嵌入 */
const E_MMVD_FAILED = defErr<{ detail: string }>(
  'provider.minimax.voiceDesign.apiFailed',
  ({ detail }) => `音色设计失败: ${detail}`,
  ({ detail }) => `Voice design failed: ${detail}`
)

/** 官方示例试听文案（音色设计必填 preview_text，最长 500） */
const DEFAULT_PREVIEW_TEXT =
  '夜深了，古屋里只有他一人。窗外传来若有若无的脚步声，他屏住呼吸，慢慢地，慢慢地，走向那扇吱呀作响的门……'

function clip(text: string, max: number): string {
  const t = text.trim()
  if (t.length <= max) return t
  return t.slice(0, max)
}

function hexToBuffer(hex: string): Buffer {
  const cleaned = hex.trim().replace(/^0x/i, '').replace(/\s+/g, '')
  if (!cleaned || cleaned.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(cleaned)) {
    throw fail(E_MMVD_INVALID_HEX)
  }
  return Buffer.from(cleaned, 'hex')
}

async function persistSpeechBuffer(
  buf: Buffer,
  input: GenerateSpeechInput,
  voiceId: string
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
      model: voiceId,
      voice: voiceId,
      format: 'mp3',
      filePath: tmpPath,
      assetId: asset.id,
      relativePath: asset.relativePath
    }
  }

  return { model: voiceId, voice: voiceId, format: 'mp3', filePath: tmpPath }
}

/**
 * MiniMax 音色设计：POST /v1/voice_design
 * - prompt：声音描述（节点指令）
 * - preview_text：试听台词（默认官方示例；若指令很长可截取作描述、仍用默认试听）
 * - 可选 voice_id：input.voice 自定义
 */
export async function generateMiniMaxVoiceDesign(
  provider: ModelProviderInstance,
  baseUrl: string,
  input: GenerateSpeechInput
): Promise<GenerateSpeechResult> {
  const prompt = clip(input.input, 1000)
  if (!prompt) {
    throw fail(E_MMVD_PROMPT_REQUIRED)
  }

  const body: Record<string, unknown> = {
    prompt,
    preview_text: DEFAULT_PREVIEW_TEXT,
    aigc_watermark: false
  }
  const customVoiceId = input.voice?.trim()
  if (customVoiceId && customVoiceId !== 'voice-design') {
    body.voice_id = customVoiceId
  }

  const client = createMiniMaxHttpClient({ ...provider, baseUrl })
  try {
    const { data } = await client.post<{
      voice_id?: string
      trial_audio?: string
      base_resp?: MiniMaxBaseResp
    }>('/v1/voice_design', body)
    assertMiniMaxBaseResp(data.base_resp, '音色设计')
    const voiceId = data.voice_id?.trim()
    const trial = data.trial_audio?.trim()
    if (!trial) throw fail(E_MMVD_NO_PREVIEW_AUDIO)
    if (!voiceId) throw fail(E_MMVD_NO_VOICE_ID)
    const buf = hexToBuffer(trial)
    return persistSpeechBuffer(buf, input, voiceId)
  } catch (err) {
    if (
      isAppError(err) &&
      [
        E_MMVD_PROMPT_REQUIRED.code,
        E_MMVD_NO_PREVIEW_AUDIO.code,
        E_MMVD_NO_VOICE_ID.code,
        E_MMVD_INVALID_HEX.code
      ].includes(err.code)
    ) {
      throw err
    }
    if (err instanceof Error && /音色设计|请提供|voice design/i.test(err.message)) throw err
    throw fail(E_MMVD_FAILED, { detail: await readMiniMaxHttpError(err) })
  }
}
