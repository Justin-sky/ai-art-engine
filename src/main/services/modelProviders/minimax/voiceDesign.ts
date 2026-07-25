import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import type {
  GenerateSpeechInput,
  GenerateSpeechResult,
  ModelProviderInstance
} from '@shared/modelProvider'
import { projectService } from '../../projectService'
import {
  assertMiniMaxBaseResp,
  createMiniMaxHttpClient,
  formatMiniMaxError,
  readMiniMaxHttpError,
  type MiniMaxBaseResp
} from './http'

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
    throw new Error('音色设计返回的试听音频不是合法 hex')
  }
  return Buffer.from(cleaned, 'hex')
}

async function persistSpeechBuffer(
  buf: Buffer,
  input: GenerateSpeechInput,
  voiceId: string
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
    throw new Error('请提供音色描述（声音设计 prompt）')
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
    if (!trial) throw new Error('音色设计未返回试听音频')
    if (!voiceId) throw new Error('音色设计未返回 voice_id')
    const buf = hexToBuffer(trial)
    return persistSpeechBuffer(buf, input, voiceId)
  } catch (err) {
    if (err instanceof Error && /音色设计|请提供/.test(err.message)) throw err
    throw new Error(`音色设计失败: ${formatMiniMaxError(await readMiniMaxHttpError(err))}`)
  }
}
