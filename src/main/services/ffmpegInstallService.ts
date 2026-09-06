/**
 * ffmpeg 一键安装（主进程侧）。
 *
 * 发布版安装包已随包内置 ffmpeg/ffprobe（<resources>/ffmpeg，构建前由
 * scripts/fetch-ffmpeg.mjs 拉取各平台静态构建），正常用户无需触发本流程；
 * 本服务仅作兜底：开发环境 / 未随包分发的旧构建等场景。
 *
 * Windows：自动下载 gyan.dev 官方便携包（essentials build，含 ffmpeg/ffprobe/ffplay），
 * 解压后把可执行文件放到应用私有目录 `%LOCALAPPDATA%/ai-art-engine/ffmpeg/bin`，
 * 全程免管理员权限、不写系统 PATH —— 视频打点 / 取帧 / 导出等定位函数探测该目录即可直接使用。
 *
 * 下载期间通过 FFMPEG_INSTALL_PROGRESS 向所有窗口广播实时进度（UI「安装中」弹窗显示进度条）；
 * macOS / Linux 无内置兜底下载，返回引导页 URL 供 UI 打开下载页或复制终端命令。
 *
 * 结果 message 为用户可见文案（透传渲染层弹窗展示）。
 */
import { app } from 'electron'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { createWriteStream, existsSync } from 'fs'
import { copyFile, mkdir, readdir, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { IpcChannels } from '@shared/ipc'
import type { FfmpegInstallProgress, VideoBeatInstallResult } from '@shared/videoBeats'
import { broadcastToAllWindows } from '../broadcast'

const execFileAsync = promisify(execFile)

/** gyan.dev Windows 便携版 ffmpeg（essentials build）下载直链 */
const GYAN_RELEASE_ZIP_URL = 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip'
/** 各平台手动安装引导页（与 shared/videoBeats 的 ffmpegInstallHintFor.url 保持一致） */
const MANUAL_PAGE_URL: Record<string, string> = {
  win32: 'https://www.gyan.dev/ffmpeg/builds/',
  darwin: 'https://evermeet.cx/ffmpeg/',
  default: 'https://ffmpeg.org/download.html'
}

/** 安装进行中锁（IPC 层防并发重复下载） */
let installing = false

/** 上次广播进度时间（下载阶段节流用） */
let lastProgressAt = 0

/** 应用私有的 ffmpeg 安装根目录（win: %LOCALAPPDATA%/ai-art-engine/ffmpeg，其它: ~/ai-art-engine/ffmpeg） */
export function ffmpegPrivateDir(): string {
  const base = process.env.LOCALAPPDATA?.trim() || (process.platform === 'darwin' ? process.env.HOME : '')
  return join(base || tmpdir(), 'ai-art-engine', 'ffmpeg')
}

/**
 * 随包内置 ffmpeg 目录：
 *  - 打包后 = <resources>/ffmpeg（electron-builder 由 out/ffmpeg/<arch> 拷入，见 electron-builder.yml）；
 *  - 开发模式 = <项目根>/out/ffmpeg/<arch>（scripts/fetch-ffmpeg.mjs 的产物布局，dev 下即可直接使用）。
 * 探测二进制时先走此处，避免 dev 下 process.resourcesPath 指向 Electron 自身而漏检。
 */
export function bundledFfmpegDir(): string {
  if (!app.isPackaged) return join(app.getAppPath(), 'out', 'ffmpeg', process.arch)
  return join(process.resourcesPath || '', 'ffmpeg')
}

/** 私有目录下的可执行文件绝对路径（ffmpeg / ffprobe） */
export function ffmpegPrivateBin(name: 'ffmpeg' | 'ffprobe'): string {
  const exe = process.platform === 'win32' ? `${name}.exe` : name
  return join(ffmpegPrivateDir(), 'bin', exe)
}

function manualPageUrl(): string {
  return MANUAL_PAGE_URL[process.platform] ?? MANUAL_PAGE_URL.default
}

/** 目标可执行名（win 带 .exe，其余不带） */
function exeName(name: string): string {
  return process.platform === 'win32' ? `${name}.exe` : name
}

/** 广播安装进度：下载阶段 300ms 节流，避免高频 IPC 洪峰 */
function broadcastInstallProgress(progress: FfmpegInstallProgress): void {
  const now = Date.now()
  if (progress.phase === 'downloading' && now - lastProgressAt < 300) return
  lastProgressAt = now
  broadcastToAllWindows(IpcChannels.FFMPEG_INSTALL_PROGRESS, progress)
}

/** 探测某可执行文件是否可运行（-version，5s 超时） */
async function binWorks(bin: string): Promise<boolean> {
  try {
    await execFileAsync(bin, ['-version'], { timeout: 5_000, windowsHide: true })
    return true
  } catch {
    return false
  }
}

/** ffmpeg 是否已可用（随包内置 resources、私有安装目录或 PATH） */
async function isFfmpegReady(): Promise<boolean> {
  const bundled = [
    join(bundledFfmpegDir(), exeName('ffmpeg')),
    join(process.resourcesPath || '', exeName('ffmpeg')),
    ffmpegPrivateBin('ffmpeg')
  ]
  for (const bin of bundled) {
    if (await binWorks(bin)) return true
  }
  return binWorks(exeName('ffmpeg'))
}

/**
 * 流式下载到本地文件并广播进度（gyan 包约 100 MB，15 分钟超时）。
 * 逐 chunk 写盘以便按字节回报下载百分比与已下载量。
 */
async function downloadTo(url: string, destAbs: string): Promise<void> {
  const response = await fetch(url, { signal: AbortSignal.timeout(15 * 60_000) })
  if (!response.ok || !response.body) {
    throw new Error(`ffmpeg download failed: HTTP ${response.status}`)
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
      broadcastInstallProgress({
        phase: 'downloading',
        percent: total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : 0,
        loadedBytes: loaded,
        totalBytes: total > 0 ? total : undefined
      })
      if (!ok) {
        // 等待可写缓冲排空。error 一次性监听在 drain 先到时若不主动移除，
        // 会按背压次数向同一 WriteStream 永久累积 error 监听器（MaxListeners 告警）。
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
        if (writerError) throw writerError ?? new Error('ffmpeg download aborted')
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

/** 解压 zip 到目录：优先系统自带 tar（bsdtar，Win10 1803+），退化到 PowerShell Expand-Archive */
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

/** 在解压根目录下定位含 ffmpeg.exe 的 bin 目录（gyan 包顶层形如 ffmpeg-*-essentials_build/bin） */
async function findExtractedBinDir(extractRoot: string): Promise<string> {
  const entries = await readdir(extractRoot, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const bin = join(extractRoot, entry.name, 'bin')
    if (existsSync(join(bin, exeName('ffmpeg')))) return bin
  }
  throw new Error('ffmpeg archive layout not recognized')
}

function errDetail(err: unknown): string {
  if (err instanceof Error && err.message) return err.message.slice(0, 200)
  return String(err)
}

/** Windows：下载便携版并复制到应用私有 bin 目录 */
async function installFfmpegWin(): Promise<VideoBeatInstallResult> {
  const binDir = join(ffmpegPrivateDir(), 'bin')
  const cacheDir = join(ffmpegPrivateDir(), 'cache')
  const zipAbs = join(cacheDir, 'ffmpeg-release-essentials.zip')
  const extractRoot = join(cacheDir, 'ffmpeg-extract')
  await mkdir(binDir, { recursive: true })
  await mkdir(extractRoot, { recursive: true })
  try {
    await downloadTo(GYAN_RELEASE_ZIP_URL, zipAbs)
    broadcastInstallProgress({ phase: 'extracting' })
    await extractZip(zipAbs, extractRoot)
    const srcBin = await findExtractedBinDir(extractRoot)
    for (const name of ['ffmpeg', 'ffprobe', 'ffplay']) {
      const src = join(srcBin, exeName(name))
      if (existsSync(src)) await copyFile(src, join(binDir, exeName(name)))
    }
    if (!(await binWorks(join(binDir, exeName('ffprobe'))))) {
      return { ok: false, message: 'ffmpeg 已下载但校验失败，请稍后重试；或打开下载页手动安装。', downloadUrl: manualPageUrl() } // cjk-ok 直接透传 UI
    }
    broadcastInstallProgress({ phase: 'done' })
    return { ok: true, message: 'ffmpeg 安装完成，正在重新打点…' } // cjk-ok 直接透传 UI
  } catch (err) {
    return { ok: false, message: `ffmpeg 安装失败：${errDetail(err)}`, downloadUrl: manualPageUrl() } // cjk-ok 直接透传 UI
  } finally {
    // 无论成败都清理缓存，避免残留超大 zip / 解压目录
    await rm(zipAbs, { force: true }).catch(() => undefined)
    await rm(extractRoot, { recursive: true, force: true }).catch(() => undefined)
  }
}

/** 一键安装 ffmpeg（渲染层「视频打点」缺 ffmpeg 时调用；可能耗时数分钟） */
export async function installFfmpeg(): Promise<VideoBeatInstallResult> {
  if (installing) {
    return { ok: false, message: 'ffmpeg 正在安装中，请稍候再试。' } // cjk-ok 直接透传 UI
  }
  if (await isFfmpegReady()) {
    return { ok: true, message: '已检测到 ffmpeg，可直接进行视频打点。' } // cjk-ok 直接透传 UI
  }
  if (process.platform !== 'win32') {
    return {
      ok: false,
      message: '当前系统暂不支持自动安装：请在终端按上方命令安装 ffmpeg，或打开下载页手动下载后重试。', // cjk-ok 直接透传 UI
      downloadUrl: manualPageUrl()
    }
  }
  installing = true
  try {
    return await installFfmpegWin()
  } finally {
    installing = false
  }
}
