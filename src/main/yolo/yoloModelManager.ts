/**
 * YOLO 模型下载管理（主进程）。
 *
 * 背景：随包只内置 yolo11n / -seg / -pose 三个轻量模型（<resources>/yolo-models）。
 * 需要更高精度时，可从官方目录（@shared/yoloCatalog，Ultralytics assets release 的
 * fp32 ONNX）按需下载 detect / segment / pose × s / m / l / x。
 *
 * 实现要点：
 * - 单任务并发锁：一次只允许下载一个模型，避免多个大文件同时写盘；
 * - 流式下载到 `<模型目录>/<id>.onnx.part`，完成前通过 YOLO_MODEL_DOWNLOAD_PROGRESS
 *   向所有窗口广播实时进度（300ms 节流），落盘后 rename 为正式文件；
 * - onnxruntime CPU worker 在请求时才按文件路径解析模型，因此新模型下载完成即被
 *   yolo:status 扫描可见 / 推理可用，无需重启；
 * - 删除模型即删除目录下对应 .onnx；内置模型删除后由 bundled manifest 防复活，
 *   用户可放心清理不需要的大文件。
 */
import { BrowserWindow, dialog } from 'electron'
import { createHash } from 'crypto'
import { createWriteStream, existsSync, readFileSync } from 'fs'
import { mkdir, rename, stat, unlink } from 'fs/promises'
import { join } from 'path'
import { IpcChannels } from '@shared/ipc'
import type { YoloModelDownloadProgress, YoloModelOperationResult } from '@shared/yolo'
import { YOLO_CATALOG_ALL } from '@shared/yoloCatalog'
import { isAllowedYoloDownloadUrl } from '@shared/yoloDownload'
import { broadcastToAllWindows } from '../broadcast'
import { settingsService } from '../services/settingsService'
import { yoloService } from './yoloService'

/** 进行中的下载模型 id；null = 空闲 */
let activeModelId: string | null = null
let activeAbort: AbortController | null = null
let lastProgressAt = 0

function broadcastProgress(progress: YoloModelDownloadProgress): void {
  const now = Date.now()
  if (progress.phase === 'downloading' && now - lastProgressAt < 300) return
  lastProgressAt = now
  broadcastToAllWindows(IpcChannels.YOLO_MODEL_DOWNLOAD_PROGRESS, progress)
}

function errDetail(err: unknown): string {
  return err instanceof Error && err.message ? err.message.slice(0, 200) : String(err)
}

function fail(message: string): YoloModelOperationResult {
  return { ok: false, message }
}

/**
 * 允许的下载源主机（白名单）见 `@shared/yoloDownload`。
 *
 * 渲染层可以带 `sourceUrl` 覆盖目录里的地址（人脸两段式托管在本仓 Release，tag 变了
 * 不必重新打包）。主进程不能因此变成任意 URL 下载器，所以只放行自家 Release 会用到
 * 的主机。
 */
async function sha256OfFile(path: string): Promise<string> {
  const hash = createHash('sha256')
  hash.update(readFileSync(path))
  return hash.digest('hex')
}

/**
 * 下载官方目录模型到模型目录。耗时取决于体积与网络（s ~40MB → x ~250MB）；
 * 全程可被 cancelYoloModelDownload 中止，成功后 yolo:status 即时可见。
 *
 * `sourceUrl`（可选）：覆盖目录地址，仅接受白名单内的 https 主机。
 */
export async function downloadYoloModel(
  modelId: string,
  sourceUrl?: string
): Promise<YoloModelOperationResult> {
  const entry = YOLO_CATALOG_ALL.find((m) => m.id === modelId)
  if (!entry) return fail(`模型目录中不存在 ${modelId}。`) // cjk-ok 透传 UI
  const url = sourceUrl?.trim() || entry.url
  if (!isAllowedYoloDownloadUrl(url)) {
    return fail(`下载地址不被允许（只支持 https 且来源在白名单内）：${url}`) // cjk-ok
  }
  if (activeModelId) {
    return fail(`已有模型正在下载（${activeModelId}），请先完成或取消后再试。`) // cjk-ok
  }

  const dir = yoloService.modelDir()
  const destPath = join(dir, entry.fileName)
  if (existsSync(destPath)) {
    return fail(`模型 ${entry.fileName} 已存在，可直接使用；如需重新下载请先删除。`) // cjk-ok
  }

  const partPath = join(dir, `${entry.fileName}.part`)
  const controller = new AbortController()
  activeModelId = modelId
  activeAbort = controller

  try {
    if (!existsSync(dir)) await mkdir(dir, { recursive: true })

    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok || !response.body) {
      throw new Error(
        `HTTP ${response.status}（网络不可达或下载地址失效，请检查网络后重试）` // cjk-ok
      )
    }

    const total = Number(response.headers.get('content-length')) || 0
    const reader = (response.body as unknown as import('stream/web').ReadableStream).getReader()
    const writer = createWriteStream(partPath)
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
        broadcastProgress({
          modelId,
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
          if (writerError) throw writerError // cjk-ok
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

    // 落盘前做个基本完整性检查（防住「错误页 / 截断响应」被当成模型存下来）
    broadcastProgress({ modelId, phase: 'verifying' })
    try {
      const size = (await stat(partPath)).size
      if (size < entry.minBytes) {
        throw new Error('下载文件异常过小，已中止（可能为错误页/不完整响应）') // cjk-ok
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes('已中止')) throw err // cjk-ok
      throw new Error(`落盘校验失败：${errDetail(err)}`) // cjk-ok
    }

    // 目录声明了 sha256 就必须校验通过：自家 Release 的资产被替换/损坏要当场拦住，
    // 而不是等推理时维度不符、静默降级成「五官悄悄不生效」。
    if (entry.sha256) {
      const actual = await sha256OfFile(partPath)
      if (actual !== entry.sha256.toLowerCase()) {
        throw new Error(`SHA-256 校验不通过（期望 ${entry.sha256}，实际 ${actual}）`) // cjk-ok
      }
    }

    await rename(partPath, destPath)
    broadcastProgress({ modelId, phase: 'done' })
    return { ok: true, message: `模型 ${entry.fileName} 下载完成，本地推理可直接使用。` } // cjk-ok
  } catch (err) {
    if (controller.signal.aborted) {
      broadcastProgress({ modelId, phase: 'cancelled', message: '下载已取消' }) // cjk-ok
      return { ok: false, cancelled: true, message: '下载已取消。' } // cjk-ok
    }
    const message = `模型下载失败：${errDetail(err)}` // cjk-ok
    broadcastProgress({ modelId, phase: 'error', message })
    return fail(message)
  } finally {
    await unlink(partPath).catch(() => undefined)
    activeModelId = null
    activeAbort = null
  }
}

/** 中止进行中的模型下载（无下载时为空操作） */
export async function cancelYoloModelDownload(): Promise<void> {
  activeAbort?.abort()
}

/** 删除模型目录中的某模型文件（内置随包模型删除后不会自动复活） */
export async function deleteYoloModel(modelId: string): Promise<YoloModelOperationResult> {
  if (!/^[\w.-]+$/.test(modelId) || modelId === '.' || modelId === '..') {
    return fail(`非法的模型 id：${modelId}`) // cjk-ok
  }
  if (activeModelId === modelId) {
    return fail('该模型正在下载中，无法删除。') // cjk-ok
  }
  const fileName = `${modelId}.onnx`
  const dir = yoloService.modelDir()
  const target = join(dir, fileName)
  if (!existsSync(target)) return fail(`模型 ${fileName} 不存在于当前模型目录。`) // cjk-ok
  try {
    await unlink(target)
  } catch (err) {
    return fail(`删除失败（文件可能正被占用）：${errDetail(err)}`) // cjk-ok
  }
  return { ok: true, message: `已删除模型 ${fileName}，其它任务会自动改用剩余模型中体积最大者。` } // cjk-ok
}

/**
 * 立即将模型目录写入持久化设置（不经渲染层 500ms debounce，保证随后
 * getYoloStatus / 推理立刻以新目录生效）。空字符串表示恢复默认目录。
 */
export function setYoloModelDir(dir: string): void {
  const current = settingsService.get()
  settingsService.set({
    ...current,
    yolo: { ...current.yolo, modelDir: dir.trim() }
  })
}

/** 弹系统目录选择器挑选模型目录；返回 null 表示用户取消（不写设置，由渲染层落盘） */
export async function chooseYoloModelDir(): Promise<string | null> {
  const options = {
    title: '选择 YOLO 模型目录', // cjk-ok：原生对话框标题
    buttonLabel: '使用此目录', // cjk-ok
    properties: ['openDirectory', 'createDirectory'] as Array<'openDirectory' | 'createDirectory'>
  }
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  const result = win
    ? await dialog.showOpenDialog(win, options)
    : await dialog.showOpenDialog(options)
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]
}
