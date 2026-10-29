/**
 * 本地离线语音识别（Whisper / whisper.cpp）目录、状态类型与 JSON 结果解析（跨进程共享）。
 *
 * 架构说明：
 * - 运行时引擎：探测系统 `WHISPER_CLI_PATH` / 应用私有目录 `%LOCALAPPDATA%/ai-art-engine/whisper/bin` / 系统 PATH 中的
 *   `whisper-cli`（或 `main`）；Windows 支持一键下载官方 `ggml-org/whisper.cpp` 便携版 zip。
 * - 模型权重：从 Hugging Face 官方 `ggerganov/whisper.cpp` 仓库按需流式下载 `.bin` GGML 权重到
 *   `<local-models>/whisper/`，支持实时进度、取消下载、SHA/最小体积校验与删除。
 * - 转写联动：在 `modelProviderFacade.transcribeAudio` 中，当开启「优先使用本地 Whisper」或未配置云端转写提供商时，
 *   自动调用本地 Whisper 完成离线字幕与词级时间戳识别。
 */
import { WHISPER_MODEL_SUBDIR } from './localModelLayout'
import type {
  TranscribeAudioResult,
  TranscribeAudioSegment,
  TranscribeAudioWord
} from './modelProvider'
import type { YoloModelDownloadPhase, YoloModelOperationResult } from './yolo'

export const WHISPER_SUBDIR = WHISPER_MODEL_SUBDIR

export const WHISPER_HF_BASE_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main'

export interface WhisperCatalogModel {
  /** 模型标识（去 `.bin` 后缀，如 `ggml-base`、`ggml-large-v3-turbo-q5_0`） */
  id: string
  /** 落盘文件名（`<id>.bin`） */
  fileName: string
  /** 官方下载直链（位于白名单 `huggingface.co`） */
  url: string
  /** 约计体积（MB） */
  sizeMb: number
  /** 落盘完整性校验最小字节数（防止错误页或截断被当作模型） */
  minBytes: number
  /** 自动选型优先级（同目录安装多个模型且未指定默认模型时，按 priority 降序选用） */
  priority: number
  /** 是否支持多语种（中/英/日/韩等 99 种语言） */
  multilingual: boolean
}

export interface WhisperModelInfo {
  id: string
  fileName: string
  path: string
  sizeMb: number
}

export type WhisperRuntimeSource = 'env' | 'private' | 'path' | 'none'

export interface WhisperInstallHint {
  url: string
  command: string
  commandLabel: string
  autoInstall: boolean
}

export interface WhisperRuntimeStatus {
  /** whisper-cli 二进制是否可用 */
  available: boolean
  /** 二进制可用且至少已安装 1 个 `.bin` 模型 */
  ready: boolean
  /** 二进制来源 */
  source: WhisperRuntimeSource
  /** 可执行文件路径 */
  binPath: string | null
  /** 版本或帮助摘要 */
  version: string | null
  /** 是否正在安装引擎二进制 */
  installing: boolean
  /** 当前系统是否支持应用内一键下载安装引擎（Windows x64） */
  autoInstallSupported: boolean
  /** 引擎私有安装目录 */
  installDir: string
  /** 模型存放目录（`<local-models>/whisper`） */
  modelDir: string
  /** 已安装的 Whisper 模型列表 */
  models: WhisperModelInfo[]
  /** 当前自动或指定选用的模型 id */
  preferredModelId: string | null
  /** 手动下载引导页 */
  downloadUrl: string
  /** 终端安装命令示例 */
  command: string
  /** 终端名称 */
  commandLabel: string
}

export interface WhisperInstallProgress {
  phase: 'downloading' | 'extracting' | 'done'
  percent?: number
  loadedBytes?: number
  totalBytes?: number
}

export interface WhisperModelDownloadProgress {
  modelId: string
  phase: YoloModelDownloadPhase
  percent?: number
  loadedBytes?: number
  totalBytes?: number
  message?: string
}

export type WhisperOperationResult = YoloModelOperationResult

/** 官方可下载的 Whisper GGML 模型目录 */
export const WHISPER_CATALOG: readonly WhisperCatalogModel[] = [
  {
    id: 'ggml-large-v3-turbo-q5_0',
    fileName: 'ggml-large-v3-turbo-q5_0.bin',
    url: `${WHISPER_HF_BASE_URL}/ggml-large-v3-turbo-q5_0.bin`,
    sizeMb: 547,
    minBytes: 250 * 1024 * 1024,
    priority: 100,
    multilingual: true
  },
  {
    id: 'ggml-small',
    fileName: 'ggml-small.bin',
    url: `${WHISPER_HF_BASE_URL}/ggml-small.bin`,
    sizeMb: 466,
    minBytes: 200 * 1024 * 1024,
    priority: 85,
    multilingual: true
  },
  {
    id: 'ggml-base',
    fileName: 'ggml-base.bin',
    url: `${WHISPER_HF_BASE_URL}/ggml-base.bin`,
    sizeMb: 142,
    minBytes: 60 * 1024 * 1024,
    priority: 75,
    multilingual: true
  },
  {
    id: 'ggml-tiny',
    fileName: 'ggml-tiny.bin',
    url: `${WHISPER_HF_BASE_URL}/ggml-tiny.bin`,
    sizeMb: 75,
    minBytes: 30 * 1024 * 1024,
    priority: 60,
    multilingual: true
  },
  {
    id: 'ggml-large-v3-turbo',
    fileName: 'ggml-large-v3-turbo.bin',
    url: `${WHISPER_HF_BASE_URL}/ggml-large-v3-turbo.bin`,
    sizeMb: 1550,
    minBytes: 800 * 1024 * 1024,
    priority: 95,
    multilingual: true
  }
]

export function findWhisperCatalogModel(modelId: string): WhisperCatalogModel | undefined {
  const clean = modelId.trim().replace(/\.bin$/i, '')
  return WHISPER_CATALOG.find((item) => item.id === clean)
}

/**
 * 从已安装的 Whisper 模型列表中挑选优先使用的模型：
 * 1. 若传入了 `preferredId` 且该模型已安装，直接命中；
 * 2. 否则按目录定义的 priority 降序（Large-v3-Turbo-Q5 > Large-v3-Turbo > Small > Base > Tiny）；
 * 3. 用户自行放入的非目录模型按体积降序兜底。
 */
export function pickPreferredWhisperModel(
  installed: readonly WhisperModelInfo[],
  preferredId?: string
): WhisperModelInfo | undefined {
  if (!installed.length) return undefined
  const cleanPref = preferredId?.trim().replace(/\.bin$/i, '')
  if (cleanPref) {
    const exact = installed.find((m) => m.id === cleanPref)
    if (exact) return exact
  }
  return [...installed].sort((a, b) => {
    const pa = findWhisperCatalogModel(a.id)?.priority ?? 50
    const pb = findWhisperCatalogModel(b.id)?.priority ?? 50
    if (pb !== pa) return pb - pa
    return b.sizeMb - a.sizeMb
  })[0]
}

/** 各平台安装引导信息 */
export function whisperInstallHintFor(platform: string): WhisperInstallHint {
  if (platform === 'win32') {
    return {
      url: 'https://github.com/ggml-org/whisper.cpp/releases',
      command: 'winget install ggml.whisper.cpp',
      commandLabel: 'PowerShell',
      autoInstall: true
    }
  }
  if (platform === 'darwin') {
    return {
      url: 'https://github.com/ggml-org/whisper.cpp/releases',
      command: 'brew install whisper-cpp',
      commandLabel: 'Terminal',
      autoInstall: false
    }
  }
  return {
    url: 'https://github.com/ggml-org/whisper.cpp/releases',
    command: 'brew install whisper-cpp',
    commandLabel: 'Terminal',
    autoInstall: false
  }
}

/** 解析 `"00:01:23,450"` 或 `"00:01:23.450"` 为秒数 */
export function parseWhisperTimestampSec(raw: unknown): number | null {
  if (typeof raw !== 'string') return null
  const m = raw.trim().match(/^(\d+):(\d{2}):(\d{2})[,.](\d{1,3})$/)
  if (!m) return null
  const hours = Number(m[1])
  const mins = Number(m[2])
  const secs = Number(m[3])
  const ms = Number(m[4].padEnd(3, '0'))
  return hours * 3600 + mins * 60 + secs + ms / 1000
}

interface WhisperCppJsonToken {
  text?: string
  timestamps?: { from?: string; to?: string }
  offsets?: { from?: number; to?: number }
  p?: number
}

interface WhisperCppJsonSegment {
  timestamps?: { from?: string; to?: string }
  offsets?: { from?: number; to?: number }
  text?: string
  tokens?: WhisperCppJsonToken[]
}

interface WhisperCppJsonOutput {
  result?: { language?: string }
  params?: { language?: string; model?: string }
  transcription?: WhisperCppJsonSegment[]
}

function isSpecialWhisperToken(text: string): boolean {
  const t = text.trim()
  if (!t) return true
  return (
    (t.startsWith('[_') && t.endsWith('_]')) ||
    (t.startsWith('<|') && t.endsWith('|>')) ||
    t === '[BLANK_AUDIO]'
  )
}

function resolveOffsetSec(
  offsets?: { from?: number; to?: number },
  timestamps?: { from?: string; to?: string }
): { startSec: number; endSec: number } {
  const fromMs = offsets?.from
  const toMs = offsets?.to
  if (typeof fromMs === 'number' && Number.isFinite(fromMs)) {
    const startSec = Math.max(0, fromMs / 1000)
    const endSec =
      typeof toMs === 'number' && Number.isFinite(toMs) ? Math.max(startSec, toMs / 1000) : startSec
    return { startSec, endSec }
  }
  const tsStart = parseWhisperTimestampSec(timestamps?.from) ?? 0
  const tsEnd = Math.max(tsStart, parseWhisperTimestampSec(timestamps?.to) ?? tsStart)
  return { startSec: tsStart, endSec: tsEnd }
}

/**
 * 将 `whisper-cli -ojf`（或 `-oj`）输出的 JSON 解析为统一的 `TranscribeAudioResult`。
 */
export function parseWhisperCppJson(
  raw: unknown,
  modelId = 'whisper-local',
  wantWords = true
): TranscribeAudioResult {
  const data = (raw && typeof raw === 'object' ? raw : {}) as WhisperCppJsonOutput
  const rows = Array.isArray(data.transcription) ? data.transcription : []
  const segments: TranscribeAudioSegment[] = []
  let hasWords = false

  for (const row of rows) {
    const text = String(row.text ?? '').trim()
    if (!text || text === '[BLANK_AUDIO]') continue
    const { startSec, endSec } = resolveOffsetSec(row.offsets, row.timestamps)
    let words: TranscribeAudioWord[] | undefined
    if (wantWords && Array.isArray(row.tokens) && row.tokens.length > 0) {
      const parsedWords: TranscribeAudioWord[] = []
      for (const tok of row.tokens) {
        const rawTokText = String(tok.text ?? '')
        if (isSpecialWhisperToken(rawTokText)) continue
        const tokText = rawTokText.trim()
        if (!tokText) continue
        const tokSpan = resolveOffsetSec(tok.offsets, tok.timestamps)
        parsedWords.push({
          text: tokText,
          startSec: tokSpan.startSec,
          endSec: tokSpan.endSec,
          ...(typeof tok.p === 'number' && Number.isFinite(tok.p) ? { confidence: tok.p } : {})
        })
      }
      if (parsedWords.length > 0) {
        words = parsedWords
        hasWords = true
      }
    }
    segments.push({
      startSec,
      endSec,
      text,
      ...(words ? { words } : {})
    })
  }

  const fullText = segments
    .map((s) => s.text)
    .join(' ')
    .trim()
  const language = data.result?.language?.trim() || data.params?.language?.trim() || undefined

  return {
    segments,
    text: fullText || undefined,
    language,
    model: modelId,
    granularity: hasWords ? 'word' : 'sentence'
  }
}
