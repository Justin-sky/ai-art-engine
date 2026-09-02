/**
 * YOLO 本地视觉服务（主进程）：
 * - 管理推理子进程（utilityProcess）生命周期：懒启动 / 请求路由 / 崩溃标记 / 退出清理；
 * - 扫描模型目录（默认 <userData>/yolo-models，可被设置覆盖）并按任务类型选模型；
 * - 把渲染层的相对路径输入解析为绝对路径后再下发 worker。
 */
import { app, shell, utilityProcess, type UtilityProcess } from 'electron'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs'
import { mkdir } from 'fs/promises'
import { isAbsolute, join } from 'path'
import {
  YOLO_INFER_TIMEOUT_MS,
  type YoloDetectResult,
  type YoloImageInput,
  type YoloInferenceInput,
  type YoloModelInfo,
  type YoloPoseResult,
  type YoloSegmentResult,
  type YoloStatus,
  type YoloTaskKind
} from '@shared/yolo'
import { settingsService } from '../services/settingsService'
import { projectService } from '../services/projectService'
import type {
  YoloWorkerInferParams,
  YoloWorkerRequest,
  YoloWorkerResponse,
  YoloWorkerStatus
} from './protocol'

/** 模型目录下的内置模型安装清单（隐藏文件，不参与模型扫描） */
const BUNDLED_MANIFEST = '.bundled-models.json'

class YoloService {
  private child: UtilityProcess | null = null
  private nextId = 1
  private pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }
  >()
  private crashed = false
  private spawning: Promise<void> | null = null
  private bundledSynced = false

  /** 模型目录：优先用户自定义，缺省 userData/yolo-models */
  modelDir(): string {
    const custom = settingsService.get().yolo?.modelDir?.trim()
    if (custom) return custom
    return join(app.getPath('userData'), 'yolo-models')
  }

  // ── 对外 IPC 入口 ──────────────────────────────────────────────

  async status(): Promise<YoloStatus> {
    this.ensureBundledModels()
    const models = this.scanModels()
    const base: YoloStatus = { ready: false, backend: 'cpu', modelDir: this.modelDir(), models }
    if (this.crashed) {
      return { ...base, error: 'YOLO: inference process crashed; restart the app to retry' }
    }
    if (!this.child) {
      try {
        await this.ensureStarted()
      } catch (err) {
        return { ...base, error: err instanceof Error ? err.message : String(err) }
      }
    }
    try {
      const ws = (await this.call('status', undefined, 5000)) as YoloWorkerStatus
      return { ...base, ready: ws.ready, ortVersion: ws.ortVersion, error: ws.error }
    } catch (err) {
      return { ...base, error: err instanceof Error ? err.message : String(err) }
    }
  }

  async detect(input: YoloInferenceInput): Promise<YoloDetectResult> {
    return (await this.infer(input, 'detect')) as YoloDetectResult
  }

  async segment(input: YoloInferenceInput): Promise<YoloSegmentResult> {
    return (await this.infer(input, 'segment')) as YoloSegmentResult
  }

  async pose(input: YoloInferenceInput): Promise<YoloPoseResult> {
    return (await this.infer(input, 'pose')) as YoloPoseResult
  }

  async openModelDir(): Promise<string | null> {
    const dir = this.modelDir()
    if (!existsSync(dir)) await mkdir(dir, { recursive: true })
    await shell.openPath(dir)
    return dir
  }

  stop(): void {
    if (this.child) {
      this.child.kill()
      this.child = null
    }
    this.crashed = true
    this.rejectAll(new Error('YOLO: service stopped'))
  }

  // ── 推理路由 ───────────────────────────────────────────────────

  private async infer(input: YoloInferenceInput, kind: YoloTaskKind): Promise<unknown> {
    this.ensureBundledModels()
    await this.ensureStarted()
    const modelPath = this.resolveModelPath(kind, input.modelId)
    const params: YoloWorkerInferParams = {
      ...input,
      image: resolveImageInput(input.image),
      kind,
      modelPath,
      modelId: input.modelId ?? basenameWithoutExt(modelPath)
    }
    return this.call('infer', params, YOLO_INFER_TIMEOUT_MS)
  }

  /** 模型文件解析：显式 modelId 精确匹配；缺省按任务类型选（detect 取无后缀的普通检测模型） */
  private resolveModelPath(kind: YoloTaskKind, modelId?: string): string {
    const models = this.scanModels()
    if (models.length === 0) {
      throw new Error(
        `YOLO: no .onnx model found in ${this.modelDir()}; place a YOLO ONNX model there (or configure the dir in settings)`
      )
    }
    if (modelId) {
      const hit = models.find((m) => m.id === modelId)
      if (hit) return hit.path
      throw new Error(
        `YOLO: model "${modelId}" not found; available: ${models.map((m) => m.id).join(', ')}`
      )
    }
    const kindMatch = models.filter((m) => m.kind === kind)
    const chosen = kindMatch.length > 0
      ? kindMatch.sort((a, b) => b.sizeMb - a.sizeMb)[0]
      : models.find((m) => m.kind === 'detect')
    if (!chosen) {
      throw new Error(
        `YOLO: no model suitable for "${kind}"; available: ${models.map((m) => m.id).join(', ')}`
      )
    }
    return chosen.path
  }

  // ── 子进程生命周期 ─────────────────────────────────────────────

  private workerPath(): string {
    // 与 main 同目录：electron-vite 多入口产物 out/main/yoloWorker.js
    return join(__dirname, 'yoloWorker.js')
  }

  private async ensureStarted(): Promise<void> {
    if (this.child && !this.crashed) return
    if (this.spawning) return this.spawning
    this.spawning = this.spawn()
    try {
      await this.spawning
    } finally {
      this.spawning = null
    }
  }

  private spawn(): Promise<void> {
    this.crashed = false
    const child = utilityProcess.fork(this.workerPath(), [], {
      serviceName: 'yolo-inference',
      stdio: 'pipe'
    })
    this.child = child

    child.on('message', (msg: unknown) => this.onMessage(msg))
    child.on('exit', (code) => {
      if (this.child !== child) return
      this.child = null
      this.crashed = true
      this.rejectAll(new Error(`YOLO: inference process exited unexpectedly (code ${code})`))
    })
    child.stdout?.on('data', (chunk: unknown) => {
      const text = String(chunk)
      if (text.trim()) console.log(`[yolo-worker] ${text.trimEnd()}`)
    })
    child.stderr?.on('data', (chunk: unknown) => {
      const text = String(chunk)
      if (text.trim()) console.error(`[yolo-worker] ${text.trimEnd()}`)
    })

    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(-1)
        reject(new Error('YOLO: inference process did not respond to ping'))
      }, 8000)
      this.pending.set(-1, {
        resolve: () => {
          clearTimeout(timer)
          resolve()
        },
        reject: (e: Error) => {
          clearTimeout(timer)
          reject(e)
        },
        timer
      })
      child.postMessage({ id: -1, method: 'ping' } satisfies YoloWorkerRequest)
    })
  }

  private onMessage(msg: unknown): void {
    const res = msg as YoloWorkerResponse
    if (!res || typeof res.id !== 'number') return
    const entry = this.pending.get(res.id)
    if (!entry) return
    this.pending.delete(res.id)
    clearTimeout(entry.timer)
    if (res.ok) entry.resolve(res.result)
    else entry.reject(new Error(res.error))
  }

  private call(method: YoloWorkerRequest['method'], params: unknown, timeoutMs: number): Promise<unknown> {
    if (!this.child) return Promise.reject(new Error('YOLO: inference process is not running'))
    return new Promise((resolve, reject) => {
      const id = this.nextId++
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`YOLO: inference request timed out after ${timeoutMs}ms`))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      this.child?.postMessage({ id, method, params } satisfies YoloWorkerRequest)
    })
  }

  private rejectAll(error: Error): void {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer)
      entry.reject(error)
    }
    this.pending.clear()
  }

  // ── 随包内置模型同步 ───────────────────────────────────────────

  /** 内置模型源目录：打包后 <resourcesPath>/yolo-models；开发期 项目 resources/yolo-models */
  private bundledModelDir(): string | null {
    const dir = app.isPackaged
      ? join(process.resourcesPath, 'yolo-models')
      : join(app.getAppPath(), 'resources', 'yolo-models')
    return existsSync(dir) ? dir : null
  }

  /**
   * 把随包内置模型落到模型目录（进程内仅执行一次）：
   * - 内置但模型目录缺失的模型会被安装；
   * - 清单中已记录过的模型不再重复落地，用户主动删除后不会被"复活"。
   */
  private ensureBundledModels(): void {
    if (this.bundledSynced) return
    this.bundledSynced = true
    const src = this.bundledModelDir()
    if (!src) return
    const target = this.modelDir()
    if (!existsSync(target)) mkdirSync(target, { recursive: true })
    const manifest = this.readManifest(target)
    let changed = false
    for (const file of readdirSync(src)) {
      if (!file.toLowerCase().endsWith('.onnx') || manifest.includes(file)) continue
      const dest = join(target, file)
      if (existsSync(dest)) {
        manifest.push(file)
        changed = true
        continue
      }
      try {
        copyFileSync(join(src, file), dest)
        manifest.push(file)
        changed = true
        console.log(`[yolo] installed bundled model: ${file}`)
      } catch (err) {
        console.error(`[yolo] failed to install bundled model ${file}:`, err)
      }
    }
    if (changed) this.writeManifest(target, manifest)
  }

  private readManifest(dir: string): string[] {
    try {
      const raw = JSON.parse(readFileSync(join(dir, BUNDLED_MANIFEST), 'utf8')) as unknown
      return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : []
    } catch {
      return []
    }
  }

  private writeManifest(dir: string, list: string[]): void {
    try {
      writeFileSync(join(dir, BUNDLED_MANIFEST), JSON.stringify(list))
    } catch {
      /* manifest 写入失败不影响推理 */
    }
  }

  // ── 模型目录扫描 ───────────────────────────────────────────────

  private scanModels(): YoloModelInfo[] {
    const dir = this.modelDir()
    if (!existsSync(dir)) return []
    const files: YoloModelInfo[] = []
    for (const name of readdirSync(dir)) {
      if (!name.toLowerCase().endsWith('.onnx')) continue
      const id = name.replace(/\.onnx$/i, '')
      let sizeMb = 0
      try {
        sizeMb = Math.max(1, Math.round(statSync(join(dir, name)).size / 1024 / 1024))
      } catch {
        /* ignore stat errors */
      }
      files.push({ id, kind: kindOfModelId(id), path: join(dir, name), sizeMb })
    }
    return files.sort((a, b) => a.id.localeCompare(b.id))
  }
}

/** 按模型文件名推断任务类型：含 seg → 分割；含 pose → 姿态；否则检测 */
export function kindOfModelId(id: string): YoloTaskKind {
  const lower = id.toLowerCase()
  if (lower.includes('seg')) return 'segment'
  if (lower.includes('pose')) return 'pose'
  return 'detect'
}

function basenameWithoutExt(p: string): string {
  const base = p.split(/[\\/]/).pop() ?? p
  return base.replace(/\.onnx$/i, '')
}

/** 把渲染层可能传入的相对路径（工程内）解析为绝对路径 */
export function resolveImageInput(input: YoloImageInput): YoloImageInput {
  if (input.kind !== 'file' || isAbsolute(input.path)) return input
  if (!projectService.isOpen()) {
    throw new Error(`YOLO: relative image path "${input.path}" but no project is open`)
  }
  return { kind: 'file', path: join(projectService.getRoot(), input.path) }
}

export const yoloService = new YoloService()
