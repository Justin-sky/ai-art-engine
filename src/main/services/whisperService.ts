/**
 * 本地离线语音识别（Whisper / whisper.cpp）服务（主进程）。
 *
 * 职责：
 * 1. 引擎管理：探测 `WHISPER_CLI_PATH` / 应用私有目录 `%LOCALAPPDATA%/ai-art-engine/whisper/bin` / 系统 PATH 中的
 *    `whisper-cli`（或 `main`）；支持 Windows 一键自动下载官方 `ggml-org/whisper.cpp` 便携版并解压校验。
 * 2. 模型管理：扫描 `<local-models>/whisper/*.bin`；支持从 Hugging Face 官方 `ggerganov/whisper.cpp`
 *    按需流式下载、取消、校验与删除 GGML 语音模型，并实时广播下载进度。
 * 3. 离线转写：通过 `ffmpeg` 将任意音频/视频转为 16kHz 单声道 PCM WAV，调用 `whisper-cli -ojf`
 *    提取分段与词级时间戳，返回标准 `TranscribeAudioResult`。
 */
import { app, shell } from 'electron'
import { execFile } from 'child_process'
import { randomUUID } from 'crypto'
import { createWriteStream, existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { copyFile, mkdir, readdir, rename, rm, stat, unlink } from 'fs/promises'
import { tmpdir } from 'os'
import { extname, join } from 'path'
import { promisify } from 'util'
import { IpcChannels } from '@shared/ipc'
import { LOCAL_MODELS_DIR_NAME } from '@shared/localModelLayout'
import type { TranscribeAudioInput, TranscribeAudioResult } from '@shared/modelProvider'
import type { VideoBeatInstallResult } from '@shared/videoBeats'
import {
  findWhisperCatalogModel,
  parseWhisperCppJson,
  pickPreferredWhisperModel,
  WHISPER_SUBDIR,
  whisperInstallHintFor,
  type WhisperInstallProgress,
  type WhisperModelDownloadProgress,
  type WhisperModelInfo,
  type WhisperOperationResult,
  type WhisperRuntimeSource,
  type WhisperRuntimeStatus
} from '@shared/whisperCatalog'
import { isAllowedYoloDownloadUrl } from '@shared/yoloDownload'
import { broadcastToAllWindows } from '../broadcast'
import { resolveFfmpegForSemantic } from './semanticTimeline/resolveFfmpeg'
import { settingsService } from './settingsService'

const execFileAsync = promisify(execFile)

/** ggml-org/whisper.cpp 官方 Windows x64 便携包（含 whisper-cli.exe / main.exe 及 ggml/whisper DLL） */
const WHISPER_RELEASE_ZIP_URL =
  'https://github.com/ggml-org/whisper.cpp/releases/download/v1.7.4/whisper-bin-x64.zip'

const MANUAL_RELEASE_URL = 'https://github.com/ggml-org/whisper.cpp/releases'

let installingEngine = false
let lastEngineProgressAt = 0

interface ActiveModelDownload {
  controller: AbortController
  lastProgressAt: number
}
const activeModelDownloads = new Map<string, ActiveModelDownload>()

function errDetail(err: unknown): string {
  return err instanceof Error && err.message ? err.message.slice(0, 200) : String(err)
}

function exeName(name: string): string {
  return process.platform === 'win32' ? `${name}.exe` : name
}

/** 应用私有的 whisper.cpp 引擎安装根目录 */
export function whisperPrivateDir(): string {
  const base =
    process.env.LOCALAPPDATA?.trim() || (process.platform === 'darwin' ? process.env.HOME : '')
  return join(base || tmpdir(), 'ai-art-engine', 'whisper')
}

/** Whisper 模型目录：跟随设置中的 local-models 根目录下的 `whisper/` 子目录 */
export function whisperModelDir(): string {
  const custom = settingsService.get().yolo?.modelDir?.trim()
  const base = custom || join(app.getPath('userData'), LOCAL_MODELS_DIR_NAME)
  return join(base, WHISPER_SUBDIR)
}

function broadcastEngineProgress(progress: WhisperInstallProgress): void {
  const now = Date.now()
  if (progress.phase === 'downloading' && now - lastEngineProgressAt < 250) return
  lastEngineProgressAt = now
  broadcastToAllWindows(IpcChannels.WHISPER_INSTALL_PROGRESS, progress)
}

function broadcastModelProgress(progress: WhisperModelDownloadProgress): void {
  const now = Date.now()
  const task = activeModelDownloads.get(progress.modelId)
  if (progress.phase === 'downloading' && task && now - task.lastProgressAt < 250) return
  if (task) task.lastProgressAt = now
  broadcastToAllWindows(IpcChannels.WHISPER_MODEL_DOWNLOAD_PROGRESS, progress)
}

async function binWorks(bin: string): Promise<boolean> {
  try {
    await execFileAsync(bin, ['-h'], { timeout: 5_000, windowsHide: true })
    return true
  } catch (err) {
    // 部分版本 whisper-cli -h 以非 0 退出但 stderr/stdout 含 usage:
    const out = `${(err as { stdout?: string })?.stdout ?? ''}\n${(err as { stderr?: string })?.stderr ?? ''}`
    return /usage:|whisper/i.test(out)
  }
}

async function probeBinVersion(bin: string): Promise<string | null> {
  try {
    const { stdout, stderr } = await execFileAsync(bin, ['-h'], {
      timeout: 5_000,
      windowsHide: true,
      maxBuffer: 256 * 1024
    })
    const combined = `${stdout || ''}\n${stderr || ''}`
    const firstLine = combined
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l.length > 0)
    return firstLine ? firstLine.slice(0, 100) : 'whisper.cpp'
  } catch (err) {
    const out = `${(err as { stdout?: string })?.stdout ?? ''}\n${(err as { stderr?: string })?.stderr ?? ''}`
    if (/usage:|whisper/i.test(out)) return 'whisper.cpp'
    return null
  }
}

export interface WhisperBinProbe {
  bin: string
  source: WhisperRuntimeSource
}

/**
 * 探测可用的 whisper.cpp CLI 可执行文件：
 * 环境变量（WHISPER_CLI_PATH / WHISPER_CPP_PATH）→ 应用私有目录 → 系统 PATH。
 */
export async function resolveWhisperBin(): Promise<WhisperBinProbe> {
  const env = process.env.WHISPER_CLI_PATH?.trim() || process.env.WHISPER_CPP_PATH?.trim()
  if (env && existsSync(env)) return { bin: env, source: 'env' }

  const privBinDir = join(whisperPrivateDir(), 'bin')
  for (const name of ['whisper-cli', 'main', 'whisper-cpp']) {
    const candidate = join(privBinDir, exeName(name))
    if (existsSync(candidate)) return { bin: candidate, source: 'private' }
  }

  for (const name of ['whisper-cli', 'whisper-cpp']) {
    const cmd = exeName(name)
    if (await binWorks(cmd)) return { bin: cmd, source: 'path' }
  }

  return { bin: exeName('whisper-cli'), source: 'none' }
}

/** 扫描 `<local-models>/whisper/*.bin` */
export function scanWhisperModels(): WhisperModelInfo[] {
  const dir = whisperModelDir()
  if (!existsSync(dir)) return []
  const list: WhisperModelInfo[] = []
  for (const name of readdirSync(dir)) {
    if (!name.toLowerCase().endsWith('.bin')) continue
    const fullPath = join(dir, name)
    let sizeMb = 0
    try {
      const st = statSync(fullPath)
      if (!st.isFile()) continue
      sizeMb = Math.max(1, Math.round(st.size / (1024 * 1024)))
    } catch {
      continue
    }
    const id = name.replace(/\.bin$/i, '')
    list.push({ id, fileName: name, path: fullPath, sizeMb })
  }
  return list.sort((a, b) => a.id.localeCompare(b.id))
}

/** 查询本地 Whisper 运行时与模型状态 */
export async function getWhisperRuntimeStatus(): Promise<WhisperRuntimeStatus> {
  const hint = whisperInstallHintFor(process.platform)
  const probe = await resolveWhisperBin()
  const available = probe.source !== 'none'
  const version = available ? await probeBinVersion(probe.bin) : null
  const models = scanWhisperModels()
  const settings = settingsService.get()
  const preferred = pickPreferredWhisperModel(models, settings.whisper?.defaultModelId)
  return {
    available,
    ready: available && models.length > 0,
    source: probe.source,
    binPath: available ? probe.bin : null,
    version,
    installing: installingEngine,
    autoInstallSupported: hint.autoInstall,
    installDir: whisperPrivateDir(),
    modelDir: whisperModelDir(),
    models,
    preferredModelId: preferred?.id ?? null,
    downloadUrl: hint.url,
    command: hint.command,
    commandLabel: hint.commandLabel
  }
}

async function downloadFileStream(
  url: string,
  destAbs: string,
  onProgress: (loaded: number, total: number) => void,
  signal?: AbortSignal
): Promise<void> {
  const response = await fetch(url, { signal: signal ?? AbortSignal.timeout(15 * 60_000) })
  if (!response.ok || !response.body) {
    throw new Error(`HTTP ${response.status}`)
  }
  const total = Number(response.headers.get('content-length')) || 0
  const reader = (response.body as unknown as import('stream/web').ReadableStream).getReader()
  const writer = createWriteStream(destAbs)
  let writerError: Error | null = null
  writer.on('error', (err: Error) => {
    writerError = err
  })
  try {
    let loaded = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value || value.length === 0) continue
      if (writerError) throw writerError
      const ok = writer.write(value)
      loaded += value.length
      onProgress(loaded, total)
      if (!ok) {
        await new Promise<void>((resolve, reject) => {
          const onDrain = (): void => {
            writer.removeListener('error', onError)
            resolve()
          }
          const onError = (err: Error): void => {
            writer.removeListener('drain', onDrain)
            reject(err)
          }
          writer.once('drain', onDrain)
          writer.once('error', onError)
        })
        if (writerError) throw writerError
      }
    }
    await new Promise<void>((resolve, reject) => {
      writer.end((err?: Error | null) => {
        if (err) reject(err)
        else if (writerError) reject(writerError)
        else resolve()
      })
    })
  } finally {
    reader.releaseLock()
    if (!writer.writableFinished) writer.destroy()
  }
}

async function extractZip(zipAbs: string, destDir: string): Promise<void> {
  const systemTar = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe')
  if (existsSync(systemTar)) {
    await execFileAsync(systemTar, ['-xf', zipAbs, '-C', destDir], {
      timeout: 10 * 60_000,
      maxBuffer: 1024 * 1024,
      windowsHide: true
    })
    return
  }
  const script = `Expand-Archive -LiteralPath ${JSON.stringify(zipAbs)} -DestinationPath ${JSON.stringify(destDir)} -Force`
  await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    timeout: 10 * 60_000,
    maxBuffer: 1024 * 1024,
    windowsHide: true
  })
}

/** 递归查找解压目录中含 whisper-cli.exe 或 main.exe 的目录（最多 3 层） */
async function findWhisperBinFolder(dir: string, depth = 0): Promise<string | null> {
  if (existsSync(join(dir, exeName('whisper-cli'))) || existsSync(join(dir, exeName('main')))) {
    return dir
  }
  if (depth >= 3) return null
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const found = await findWhisperBinFolder(join(dir, entry.name), depth + 1)
    if (found) return found
  }
  return null
}

async function installWhisperWin(): Promise<VideoBeatInstallResult> {
  const binDir = join(whisperPrivateDir(), 'bin')
  const cacheDir = join(whisperPrivateDir(), 'cache')
  const zipAbs = join(cacheDir, 'whisper-bin-x64.zip')
  const extractRoot = join(cacheDir, 'whisper-extract')
  await mkdir(binDir, { recursive: true })
  await mkdir(extractRoot, { recursive: true })
  try {
    await downloadFileStream(WHISPER_RELEASE_ZIP_URL, zipAbs, (loaded, total) => {
      broadcastEngineProgress({
        phase: 'downloading',
        percent: total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : 0,
        loadedBytes: loaded,
        totalBytes: total > 0 ? total : undefined
      })
    })
    broadcastEngineProgress({ phase: 'extracting' })
    await extractZip(zipAbs, extractRoot)
    const srcFolder = await findWhisperBinFolder(extractRoot)
    if (!srcFolder) {
      throw new Error('whisper archive layout not recognized')
    }
    const files = await readdir(srcFolder, { withFileTypes: true })
    for (const file of files) {
      if (!file.isFile()) continue
      const lower = file.name.toLowerCase()
      if (lower.endsWith('.exe') || lower.endsWith('.dll')) {
        await copyFile(join(srcFolder, file.name), join(binDir, file.name))
      }
    }
    const cliCandidate = existsSync(join(binDir, exeName('whisper-cli')))
      ? join(binDir, exeName('whisper-cli'))
      : join(binDir, exeName('main'))
    if (!(await binWorks(cliCandidate))) {
      return {
        ok: false,
        message: 'whisper.cpp 已下载但运行校验未通过，请稍后重试或手动下载安装。', // cjk-ok 透传 UI
        downloadUrl: MANUAL_RELEASE_URL
      }
    }
    broadcastEngineProgress({ phase: 'done' })
    return {
      ok: true,
      message: 'whisper.cpp 引擎下载安装完成，再下载任意语音模型即可离线识别。' // cjk-ok 透传 UI
    }
  } catch (err) {
    return {
      ok: false,
      message: `whisper.cpp 引擎安装失败：${errDetail(err)}`, // cjk-ok 透传 UI
      downloadUrl: MANUAL_RELEASE_URL
    }
  } finally {
    await rm(zipAbs, { force: true }).catch(() => undefined)
    await rm(extractRoot, { recursive: true, force: true }).catch(() => undefined)
  }
}

/** 一键下载并安装 whisper.cpp 引擎（Windows 自动安装，macOS/Linux 引导） */
export async function installWhisper(): Promise<VideoBeatInstallResult> {
  if (installingEngine) {
    return { ok: false, message: 'whisper.cpp 引擎正在安装中，请稍候再试。' } // cjk-ok 透传 UI
  }
  const probe = await resolveWhisperBin()
  if (probe.source !== 'none') {
    return { ok: true, message: '已检测到可用的 whisper.cpp 引擎。' } // cjk-ok 透传 UI
  }
  if (process.platform !== 'win32') {
    return {
      ok: false,
      message: '当前系统请使用终端命令（brew install whisper-cpp）或前往发布页手动安装。', // cjk-ok 透传 UI
      downloadUrl: MANUAL_RELEASE_URL
    }
  }
  installingEngine = true
  try {
    return await installWhisperWin()
  } finally {
    installingEngine = false
  }
}

/** 下载官方 Whisper GGML 模型到 `<local-models>/whisper/` */
export async function downloadWhisperModel(modelId: string): Promise<WhisperOperationResult> {
  const entry = findWhisperCatalogModel(modelId)
  if (!entry) {
    return { ok: false, message: `Whisper 模型目录中不存在 ${modelId}。` } // cjk-ok 透传 UI
  }
  if (!isAllowedYoloDownloadUrl(entry.url)) {
    return { ok: false, message: `下载地址不在白名单内：${entry.url}` } // cjk-ok 透传 UI
  }
  if (activeModelDownloads.has(entry.id)) {
    return { ok: false, message: `模型 ${entry.id} 正在下载中，请勿重复发起。` } // cjk-ok 透传 UI
  }

  const dir = whisperModelDir()
  const destPath = join(dir, entry.fileName)
  if (existsSync(destPath)) {
    return {
      ok: false,
      message: `模型 ${entry.fileName} 已存在，可直接使用；如需重下请先删除。` // cjk-ok 透传 UI
    }
  }

  const partPath = join(dir, `${entry.fileName}.part`)
  const controller = new AbortController()
  activeModelDownloads.set(entry.id, { controller, lastProgressAt: 0 })

  try {
    if (!existsSync(dir)) await mkdir(dir, { recursive: true })

    await downloadFileStream(
      entry.url,
      partPath,
      (loaded, total) => {
        broadcastModelProgress({
          modelId: entry.id,
          phase: 'downloading',
          percent: total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : 0,
          loadedBytes: loaded,
          totalBytes: total > 0 ? total : undefined
        })
      },
      controller.signal
    )

    broadcastModelProgress({ modelId: entry.id, phase: 'verifying' })
    const size = (await stat(partPath)).size
    if (size < entry.minBytes) {
      throw new Error('下载文件异常过小，已中止（可能为错误页或网络截断）') // cjk-ok 透传 UI
    }

    await rename(partPath, destPath)
    broadcastModelProgress({ modelId: entry.id, phase: 'done' })
    return {
      ok: true,
      message: `模型 ${entry.fileName} 下载完成，已保存到 ${WHISPER_SUBDIR} 文件夹。` // cjk-ok 透传 UI
    }
  } catch (err) {
    if (controller.signal.aborted) {
      broadcastModelProgress({
        modelId: entry.id,
        phase: 'cancelled',
        message: '下载已取消' // cjk-ok 透传 UI
      })
      return { ok: false, cancelled: true, message: '下载已取消。' } // cjk-ok 透传 UI
    }
    const message = `模型下载失败：${errDetail(err)}` // cjk-ok 透传 UI
    broadcastModelProgress({ modelId: entry.id, phase: 'error', message })
    return { ok: false, message }
  } finally {
    await unlink(partPath).catch(() => undefined)
    activeModelDownloads.delete(entry.id)
  }
}

/** 取消进行中的 Whisper 模型下载 */
export async function cancelWhisperModelDownload(modelId?: string): Promise<void> {
  if (modelId) {
    const clean = modelId.trim().replace(/\.bin$/i, '')
    activeModelDownloads.get(clean)?.controller.abort()
    return
  }
  for (const task of activeModelDownloads.values()) {
    task.controller.abort()
  }
}

/** 删除 `<local-models>/whisper/` 中的指定模型文件 */
export async function deleteWhisperModel(modelId: string): Promise<WhisperOperationResult> {
  const clean = modelId.trim().replace(/\.bin$/i, '')
  if (!/^[\w.-]+$/.test(clean) || clean === '.' || clean === '..') {
    return { ok: false, message: `非法的模型 id：${modelId}` } // cjk-ok 透传 UI
  }
  if (activeModelDownloads.has(clean)) {
    return { ok: false, message: '该模型正在下载中，无法删除。' } // cjk-ok 透传 UI
  }
  const target = join(whisperModelDir(), `${clean}.bin`)
  if (!existsSync(target)) {
    return { ok: false, message: `模型 ${clean}.bin 不存在于当前目录。` } // cjk-ok 透传 UI
  }
  try {
    await unlink(target)
    return {
      ok: true,
      message: `已删除模型 ${clean}.bin。` // cjk-ok 透传 UI
    }
  } catch (err) {
    return { ok: false, message: `删除失败：${errDetail(err)}` } // cjk-ok 透传 UI
  }
}

/** 在系统资源管理器中打开 Whisper 模型目录 */
export async function openWhisperModelDir(): Promise<string | null> {
  const dir = whisperModelDir()
  if (!existsSync(dir)) await mkdir(dir, { recursive: true })
  await shell.openPath(dir)
  return dir
}

/** 当前是否具备本地 Whisper 离线转写条件（功能已启用 + 引擎可用 + 已安装至少 1 个模型） */
export async function canUseLocalWhisper(): Promise<boolean> {
  const settings = settingsService.get()
  if (settings.whisper?.enabled === false) return false
  const probe = await resolveWhisperBin()
  if (probe.source === 'none') return false
  return scanWhisperModels().length > 0
}

/** 规范化语言码供 whisper-cli `-l` 参数使用（如 `zh-CN` -> `zh`，空 -> `auto`） */
export function normalizeWhisperLanguageCode(raw?: string): string {
  const trimmed = raw?.trim().toLowerCase() ?? ''
  if (!trimmed || trimmed === 'auto') return 'auto'
  const primary = trimmed.split(/[-_]/)[0]
  return primary || 'auto'
}

/**
 * 使用本地 whisper.cpp + GGML 模型转写音频文件。
 */
export async function transcribeAudioViaLocalWhisper(
  input: TranscribeAudioInput,
  absPath: string
): Promise<TranscribeAudioResult> {
  const probe = await resolveWhisperBin()
  if (probe.source === 'none') {
    throw new Error('Local whisper-cli binary is not installed')
  }
  const models = scanWhisperModels()
  const settings = settingsService.get()
  const requestedModelId = input.model?.trim().replace(/\.bin$/i, '')
  const chosenModel =
    (requestedModelId ? models.find((m) => m.id === requestedModelId) : undefined) ??
    pickPreferredWhisperModel(models, settings.whisper?.defaultModelId)
  if (!chosenModel) {
    throw new Error('No local Whisper GGML model (.bin) is installed')
  }

  const workId = `whisper-${Date.now()}-${randomUUID().slice(0, 8)}`
  const workDir = join(tmpdir(), 'ai-art-engine-whisper')
  await mkdir(workDir, { recursive: true })
  const tempWav = join(workDir, `${workId}.wav`)
  const outPrefix = join(workDir, `${workId}-out`)
  const outJson = `${outPrefix}.json`

  let audioInputForWhisper = absPath
  try {
    // 优先通过 ffmpeg 转为 16kHz 单声道 16-bit PCM WAV（whisper-cli 标准输入格式）
    const ffmpegBin = resolveFfmpegForSemantic()
    try {
      await execFileAsync(
        ffmpegBin,
        ['-y', '-i', absPath, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', tempWav],
        { timeout: 5 * 60_000, windowsHide: true }
      )
      if (existsSync(tempWav)) {
        audioInputForWhisper = tempWav
      }
    } catch (ffErr) {
      // 若输入本身已是 .wav，允许直接尝试喂给 whisper-cli；否则抛出转换错误
      if (extname(absPath).toLowerCase() !== '.wav') {
        throw new Error(
          `Failed to convert audio to 16kHz WAV via ffmpeg (${errDetail(ffErr)}); please install ffmpeg in Settings`
        )
      }
    }

    const lang = normalizeWhisperLanguageCode(input.language || settings.whisper?.language)
    const args = ['-m', chosenModel.path, '-f', audioInputForWhisper, '-ojf', '-of', outPrefix]
    if (lang) {
      args.push('-l', lang)
    }
    if (input.prompt?.trim()) {
      args.push('--prompt', input.prompt.trim())
    }

    await execFileAsync(probe.bin, args, {
      timeout: 15 * 60_000,
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true
    })

    if (!existsSync(outJson)) {
      throw new Error('whisper-cli completed without producing JSON output')
    }
    const rawJson = JSON.parse(readFileSync(outJson, 'utf8')) as unknown
    return parseWhisperCppJson(rawJson, chosenModel.id, input.wordTimestamps !== false)
  } finally {
    await unlink(tempWav).catch(() => undefined)
    await unlink(outJson).catch(() => undefined)
  }
}
