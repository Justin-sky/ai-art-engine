/**
 * 音频转写（语音识别）的 OpenAI 兼容实现：POST {baseUrl}/audio/transcriptions。
 * 适配 OpenAI 官方（whisper-1）以及任何暴露同名端点的兼容网关。
 */
import { readFileSync } from 'fs'
import { basename, extname } from 'path'
import type {
  ModelProviderInstance,
  TranscribeAudioInput,
  TranscribeAudioResult,
  TranscribeAudioSegment
} from '@shared/modelProvider'
import { fail, defErrSimple } from '@shared/errors/appError'
import { createProviderHttpClient, LONG_GENERATE_TIMEOUT_MS, readHttpError } from './http'
import { PROVIDER_ERRORS } from './catalog'

const E_TRANSCRIBE_FILE_MISSING = defErrSimple(
  'provider.transcribe.file-missing',
  '找不到要转写的音频文件',
  'Audio file to transcribe was not found'
)

type VerboseJsonTranscription = {
  task?: string
  language?: string
  duration?: number
  text?: string
  segments?: Array<{ start?: number; end?: number; text?: string }>
}

function audioMimeForPath(path: string): string {
  switch (extname(path).toLowerCase()) {
    case '.mp3':
      return 'audio/mpeg'
    case '.wav':
      return 'audio/wav'
    case '.m4a':
      return 'audio/mp4'
    case '.aac':
      return 'audio/aac'
    case '.ogg':
    case '.oga':
      return 'audio/ogg'
    case '.flac':
      return 'audio/flac'
    case '.wma':
      return 'audio/x-ms-wma'
    default:
      return 'audio/mpeg'
  }
}

function parseVerboseResult(data: VerboseJsonTranscription, durationSec?: number): TranscribeAudioSegment[] {
  const segments = (data.segments ?? [])
    .map((row) => {
      const start = Number.isFinite(row.start) ? Math.max(0, row.start!) : 0
      const end = Number.isFinite(row.end) ? Math.max(start, row.end!) : start
      const text = String(row.text ?? '').trim()
      return text ? { startSec: start, endSec: end, text } : null
    })
    .filter((item): item is TranscribeAudioSegment => item != null)
  if (segments.length) return segments
  const whole = String(data.text ?? '').trim()
  if (!whole) return []
  return [{ startSec: 0, endSec: durationSec ?? 0, text: whole }]
}

/**
 * 通过 OpenAI 兼容 `/audio/transcriptions` 端点转写本地音频文件。
 * @param absPath 本地音频绝对路径（已由门面解析）
 */
export async function transcribeAudioViaOpenAiCompatible(
  provider: ModelProviderInstance,
  modelId: string,
  input: TranscribeAudioInput,
  absPath: string
): Promise<TranscribeAudioResult> {
  const client = createProviderHttpClient(provider, LONG_GENERATE_TIMEOUT_MS)

  const buildForm = (responseFormat: 'verbose_json' | 'json'): FormData => {
    const form = new FormData()
    form.append('model', modelId)
    form.append('response_format', responseFormat)
    if (input.language?.trim()) form.append('language', input.language.trim())
    if (input.prompt?.trim()) form.append('prompt', input.prompt.trim())
    const buffer = readFileSync(absPath)
    form.append(
      'file',
      new Blob([new Uint8Array(buffer)], { type: audioMimeForPath(absPath) }),
      basename(absPath)
    )
    return form
  }

  const post = (form: FormData) =>
    client.post<VerboseJsonTranscription | { text?: string }>('/audio/transcriptions', form, {
      headers: { 'Content-Type': undefined },
      timeout: LONG_GENERATE_TIMEOUT_MS
    })

  try {
    // 优先 verbose_json 拿分段时间戳；兼容网关不支持时回退 json
    let data: VerboseJsonTranscription
    try {
      const { data: verbose } = await post(buildForm('verbose_json'))
      data = verbose as VerboseJsonTranscription
      if (typeof data.text !== 'string' && typeof (verbose as { text?: string }).text === 'string') {
        data.text = (verbose as { text?: string }).text
      }
    } catch {
      const { data: plain } = await post(buildForm('json'))
      const text = typeof plain.text === 'string' ? plain.text : ''
      return {
        segments: text.trim() ? [{ startSec: 0, endSec: 0, text: text.trim() }] : [],
        text: text.trim() || undefined,
        model: modelId
      }
    }

    const segments = parseVerboseResult(data, data.duration)
    const text = segments.map((s) => s.text).join('') || String(data.text ?? '').trim()
    return {
      segments,
      ...(text ? { text } : {}),
      model: modelId,
      ...(data.language ? { language: data.language } : {})
    }
  } catch (err) {
    if (err instanceof Error && (err as Error & { code?: string }).code === 'ENOENT') {
      throw fail(E_TRANSCRIBE_FILE_MISSING)
    }
    const detail = await readHttpError(err)
    throw fail(PROVIDER_ERRORS.actionFailed, {
      action: 'transcribe',
      detail: detail || 'Audio transcription request failed'
    })
  }
}
