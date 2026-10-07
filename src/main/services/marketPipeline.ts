/**
 * 远端市场通用管道：拉索引 → 磁盘缓存 → 拉文件 → 校验 → **原子落盘** → 记账。
 *
 * ## 为什么抽成通用件
 *
 * 本仓库有两个结构同构的远端市场（工作流 `ai-art-engine-workflow`、技能
 * `aae-skills-market`），差别只是载荷与落盘位置。这个仓库已经多次因「同一逻辑写两处」
 * 返工，所以传输、缓存、原子写、记账这些共性收在这里，各市场只实现 `MarketSource`。
 *
 * ## 缓存与离线
 *
 * 索引带 1 小时 TTL 的内存缓存 + 一份磁盘副本。**网络失败时回退到磁盘副本并标记
 * `stale`** —— 市场页在断网时应当还能看到上次的目录并给出「离线」提示，
 * 而不是清空成一片空白。
 *
 * ## 原子落盘
 *
 * 安装先把内容写进同级的临时目录，校验通过后 **rename** 到目标目录。
 * 这样任何一步失败都不会在目标位置留下半成品（用户不该看到「装了一半」的技能/工作流）。
 *
 * ## 不追求断点续传
 *
 * 市场包都很小（工作流最大 ~95KB）。`resumableHttpDownload` 是为更新器的大文件写的，
 * 这里用一次 `fetch` + 超时更简单也更可控。
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** 拉取到的单个文件 */
export interface FetchedFile {
  /** 相对路径（用于落盘与错误信息） */
  path: string
  url: string
  bytes: Uint8Array
}

/** 一次安装的输入 */
export interface MarketInstallPlan {
  /** 安装目标目录（原子 rename 的目的地） */
  targetDir: string
  files: Array<{ path: string; url: string }>
  /**
   * 校验拉到的内容。返回 `{ ok: false }` 时**放弃安装且不留残留**。
   * 各市场在这里做自己的格式校验（工作流校验 plan，技能校验 frontmatter）。
   */
  verify: (files: FetchedFile[]) => { ok: true } | { ok: false; reasonKey: string }
}

export interface MarketPipelineOptions {
  /** 市场标识，用于日志与缓存目录 */
  kind: string
  /** 缓存根目录（通常 userData/<kind>-market） */
  cacheDir: string
  /** 单次请求超时 */
  timeoutMs?: number
  /** 单个文件大小上限，防呆（默认 8MB） */
  maxFileBytes?: number
}

export interface CatalogFetchResult<T> {
  ok: boolean
  catalog?: T
  /** 目录来自磁盘缓存且本次刷新失败 —— 界面应提示「离线，数据可能过期」 */
  stale?: boolean
  /** 可翻译的原因键（失败时） */
  reasonKey?: string
  /** 给日志/详情的原文（失败时） */
  error?: string
  /** 缓存写入时间（ISO），用于「上次更新」显示 */
  cachedAt?: string
}

const DEFAULT_TIMEOUT_MS = 20_000
const DEFAULT_MAX_FILE_BYTES = 8 * 1024 * 1024
const CATALOG_TTL_MS = 60 * 60 * 1000

/** 目录缓存的内存副本：避免每次打开市场页都发一次请求 */
const catalogMemo = new Map<string, { at: number; raw: unknown }>()

export class MarketPipeline {
  private readonly options: Required<MarketPipelineOptions>

  constructor(options: MarketPipelineOptions) {
    this.options = {
      timeoutMs: DEFAULT_TIMEOUT_MS,
      maxFileBytes: DEFAULT_MAX_FILE_BYTES,
      ...options
    }
  }

  private get tempRoot(): string {
    return join(this.options.cacheDir, 'tmp')
  }

  /**
   * 拉索引。`force` 跳过 TTL（用户手动刷新）。
   *
   * 返回结构**不抛异常**：市场页需要把失败原因与「离线缓存」都渲染出来，
   * 而不是套一层 try/catch 猜错误类型。
   */
  async fetchCatalog<T>(input: {
    url: string
    parse: (raw: unknown) => { ok: true; catalog: T } | { ok: false; reasonKey: string }
    force?: boolean
  }): Promise<CatalogFetchResult<T>> {
    const memoKey = `${this.options.kind}:${input.url}`
    const memo = catalogMemo.get(memoKey)
    if (!input.force && memo && Date.now() - memo.at < CATALOG_TTL_MS) {
      const parsed = input.parse(memo.raw)
      if (parsed.ok) return { ok: true, catalog: parsed.catalog }
    }

    try {
      const raw = await this.fetchJson(input.url)
      const parsed = input.parse(raw)
      if (!parsed.ok) {
        // 索引本身不合法：**不回退旧缓存**（那会掩盖「仓库发坏了」这件事）
        return { ok: false, reasonKey: parsed.reasonKey }
      }
      catalogMemo.set(memoKey, { at: Date.now(), raw })
      this.writeCatalogCache(input.url, raw)
      return { ok: true, catalog: parsed.catalog, cachedAt: new Date().toISOString() }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const cached = this.readCatalogCache(input.url)
      if (cached) {
        const parsed = input.parse(cached.raw)
        if (parsed.ok) {
          // 回退磁盘缓存：界面据此显示「离线，数据可能过期」
          return {
            ok: true,
            catalog: parsed.catalog,
            stale: true,
            cachedAt: cached.at,
            error: message
          }
        }
      }
      return { ok: false, reasonKey: 'network', error: message }
    }
  }

  /** 拉一个 JSON 文件（工作流的 bundle 用它） */
  async fetchJson(url: string): Promise<unknown> {
    const response = await this.request(url)
    const text = await response.text()
    try {
      return JSON.parse(text) as unknown
    } catch {
      // 网关错误页 / 被墙时返回的 HTML：归类成 badJson 而不是把 HTML 当 JSON 用。
      // 这里是**诊断原文**（进 error 字段与日志），用户可见文案由 reasonKey 决定，
      // 因此刻意用 ASCII —— 避免与 locale 形成第二份文案来源。
      throw new Error(`response is not valid JSON (HTTP ${response.status})`)
    }
  }

  /** 拉二进制（封面用它） */
  async fetchBinary(url: string): Promise<Uint8Array> {
    const response = await this.request(url)
    const buffer = await response.arrayBuffer()
    if (buffer.byteLength > this.options.maxFileBytes) {
      throw new Error(`file exceeds ${Math.round(this.options.maxFileBytes / 1024)}KB limit`)
    }
    return new Uint8Array(buffer)
  }

  private async request(url: string): Promise<Response> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs)
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { accept: 'application/json, image/*, */*', 'user-agent': 'AIArtEngine' }
      })
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }
      return response
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error(`request timed out (${this.options.timeoutMs}ms)`)
      }
      throw err instanceof Error ? err : new Error(String(err))
    } finally {
      clearTimeout(timer)
    }
  }

  /**
   * 安装：拉全部文件 → 校验 → 原子落到 `targetDir`。
   *
   * 失败路径一律清临时目录；成功路径用 rename，保证目标目录要么是完整的旧版本、
   * 要么是完整的新版本。
   */
  async install(
    plan: MarketInstallPlan
  ): Promise<{ ok: true } | { ok: false; reasonKey: string; error?: string }> {
    const staging = join(this.tempRoot, `${this.options.kind}-${Date.now().toString(36)}`)
    try {
      mkdirSync(staging, { recursive: true })
      const fetched: FetchedFile[] = []
      for (const file of plan.files) {
        const bytes = await this.fetchBinary(file.url)
        const dest = join(staging, file.path)
        mkdirSync(dirname(dest), { recursive: true })
        writeFileSync(dest, bytes)
        fetched.push({ path: file.path, url: file.url, bytes })
      }

      const verified = plan.verify(fetched)
      if (!verified.ok) return { ok: false, reasonKey: verified.reasonKey }

      this.commitDirectory(staging, plan.targetDir)
      return { ok: true }
    } catch (err) {
      return {
        ok: false,
        reasonKey: 'download',
        error: err instanceof Error ? err.message : String(err)
      }
    } finally {
      rmSync(staging, { recursive: true, force: true })
    }
  }

  /** 卸载：整目录删除（失败时不留半删状态） */
  uninstall(targetDir: string): { ok: true } | { ok: false; error: string } {
    try {
      rmSync(targetDir, { recursive: true, force: true })
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  /**
   * 原子换取目录：先把旧版本挪到一边，再把新版本 rename 进来，最后删旧。
   *
   * 直接 `rm -rf` 再 rename 会有一个「目录不存在」的窗口；先挪走再换，
   * 最坏情况也只是旧版本还在。失败时把旧版本挪回去。
   */
  private commitDirectory(staging: string, targetDir: string): void {
    mkdirSync(dirname(targetDir), { recursive: true })
    const backup = `${targetDir}.old`
    const hadPrevious = existsSync(targetDir)
    if (hadPrevious) {
      rmSync(backup, { recursive: true, force: true })
      renameSync(targetDir, backup)
    }
    try {
      renameSync(staging, targetDir)
    } catch (err) {
      // 换入失败：把旧版本挪回去，不留一个空目录
      if (hadPrevious && existsSync(backup) && !existsSync(targetDir)) {
        renameSync(backup, targetDir)
      }
      throw err
    }
    if (hadPrevious) rmSync(backup, { recursive: true, force: true })
  }

  /**
   * 目录缓存**按源分文件**。
   *
   * 早先所有源共用一个 `catalog.json`，而内存 memo 是按 URL 分的 —— 两者口径不一致会造成：
   * 镜像成功写入缓存后，主源失败时读到的是**镜像的内容**并返回 `stale`，
   * 于是应用显示「离线」且**再也不会去试镜像** —— 备用源恰好在自己该生效的场景下失效。
   * 缓存必须和 memo 一样按源区分。
   */
  private catalogPathFor(url: string): string {
    const key = createHash('sha256').update(url).digest('hex').slice(0, 16)
    return join(this.options.cacheDir, `catalog-${key}.json`)
  }

  private writeCatalogCache(url: string, raw: unknown): void {
    try {
      mkdirSync(this.options.cacheDir, { recursive: true })
      writeFileSync(
        this.catalogPathFor(url),
        JSON.stringify({ at: new Date().toISOString(), url, raw }),
        'utf8'
      )
    } catch {
      /* 缓存写失败不影响本次结果 */
    }
  }

  private readCatalogCache(url: string): { at: string; raw: unknown } | null {
    try {
      const path = this.catalogPathFor(url)
      if (!existsSync(path)) return null
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as {
        at?: unknown
        raw?: unknown
      }
      if (parsed && typeof parsed.at === 'string' && parsed.raw !== undefined) {
        return { at: parsed.at, raw: parsed.raw }
      }
      return null
    } catch {
      return null
    }
  }
}

/** 内容哈希：安装记账用（判断「已装的是不是这份内容」） */
export function sha256OfBytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/** 清掉某个市场的内存缓存（用户改了源地址时调用） */
export function clearCatalogMemo(kind?: string): void {
  if (!kind) {
    catalogMemo.clear()
    return
  }
  for (const key of [...catalogMemo.keys()]) {
    if (key.startsWith(`${kind}:`)) catalogMemo.delete(key)
  }
}

export const __marketPipelineTest = { CATALOG_TTL_MS }
