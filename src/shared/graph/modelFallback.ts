/**
 * 备选模型链：单个模型调用失败（限流 / 不可用 / 超时）时自动切下一个候选。
 *
 * 长链上「首选模型临时挂掉 → 整轮返工白跑」是最常见的浪费：一次返工可能已经烧掉
 * 多轮生图 + 质检，只因为首选模型 429 就全丢，重试又要从零开始。这里把候选模型
 * 按顺序尝试，前一个抛错（用户中止除外）即换下一个，并把跳过记录回传给调用方，
 * 供运行日志与节点状态展示——「换了哪个模型、为什么换」必须可追溯。
 *
 * 纯函数 + 无渲染环境依赖，供 media.rework / media.review 等执行器共用。
 */

/** 模型引用：供应商实例 + 模型名；两者皆空表示沿用调用方默认模型 */
export interface ModelRef {
  model?: string
  providerInstanceId?: string
}

/** 失败并已跳过的候选 */
export interface ModelFallbackFailure {
  model?: string
  providerInstanceId?: string
  error: string
}

export interface ModelChainResult<T> {
  value: T
  /** 最终成功的模型引用 */
  used: ModelRef
  /** 失败并跳过的候选，按尝试顺序 */
  skipped: ModelFallbackFailure[]
}

/** 与 renderer generateModelOptions 的 modelKey 保持一致的格式：`providerInstanceId::model` */
const MODEL_KEY_SEP = '::'

export function modelRefKey(ref: ModelRef): string {
  const provider = ref.providerInstanceId?.trim() ?? ''
  const model = ref.model?.trim() ?? ''
  if (!provider || !model) return ''
  return `${provider}${MODEL_KEY_SEP}${model}`
}

export function parseModelRefKey(key: string): ModelRef | null {
  const idx = key.indexOf(MODEL_KEY_SEP)
  if (idx <= 0) return null
  const model = key.slice(idx + MODEL_KEY_SEP.length).trim()
  if (!model) return null
  return { providerInstanceId: key.slice(0, idx).trim(), model }
}

function splitKeys(text: string): string[] {
  return text
    .split(/[\n,;]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

/** 归一为 modelKey 字符串数组：支持数组 / JSON 数组字符串 / 换行或逗号分隔文本 */
function normalizeKeyList(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.flatMap((item) => (typeof item === 'string' ? splitKeys(item) : []))
  }
  if (typeof raw === 'string') {
    const text = raw.trim()
    if (!text) return []
    if (text.startsWith('[')) {
      try {
        const parsed: unknown = JSON.parse(text)
        if (Array.isArray(parsed)) {
          return parsed.flatMap((item) => (typeof item === 'string' ? splitKeys(item) : []))
        }
      } catch {
        // 非合法 JSON 时按分隔符文本解析
      }
    }
    return splitKeys(text)
  }
  return []
}

/** 解析 params 中的备选模型链；非法项直接丢弃（不影响主流程） */
export function parseModelChain(raw: unknown): ModelRef[] {
  const out: ModelRef[] = []
  for (const key of normalizeKeyList(raw)) {
    const ref = parseModelRefKey(key)
    if (ref) out.push(ref)
  }
  return out
}

/** 序列化为 params 存储用的 modelKey 数组 */
export function serializeModelChain(chain: readonly ModelRef[]): string[] {
  return chain.map(modelRefKey).filter(Boolean)
}

/** 组装完整候选链：首选在前，备选依次排后，重复的备选剔除 */
export function buildModelChain(
  primary: ModelRef,
  fallbacks: readonly ModelRef[]
): ModelRef[] {
  const out: ModelRef[] = []
  const seen = new Set<string>()
  const primaryKey = modelRefKey(primary)
  // 首选未配 provider 时（旧图只有 model）仍保留，只是无法参与去重
  if (primary.model?.trim() || primary.providerInstanceId?.trim()) {
    out.push(primary)
    if (primaryKey) seen.add(primaryKey)
  }
  for (const ref of fallbacks) {
    const key = modelRefKey(ref)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(ref)
  }
  return out
}

function isAbortError(err: unknown): boolean {
  if (!err) return false
  if (typeof err === 'object' && (err as { name?: unknown }).name === 'AbortError') return true
  return err instanceof DOMException && err.name === 'AbortError'
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export interface RunModelChainOptions {
  signal?: AbortSignal
  /** 每次切模型时回调，供执行器写日志 / 节点状态 */
  onFallback?: (failed: ModelRef, error: string, next: ModelRef | null) => void
  /** 是否值得换模型重试；默认除中止外都重试 */
  isRetryable?: (err: unknown) => boolean
}

/**
 * 按顺序尝试候选模型，返回最终成功的模型与跳过记录。
 * 全部失败时原样抛出最后一次的错误（信息不丢），中止信号立即上抛、不换模型。
 */
export async function runWithModelFallback<T>(
  candidates: readonly ModelRef[],
  call: (ref: ModelRef) => Promise<T>,
  options: RunModelChainOptions = {}
): Promise<ModelChainResult<T>> {
  const list = candidates.length ? candidates : [{} as ModelRef]
  const skipped: ModelFallbackFailure[] = []
  let lastError: unknown = null

  for (let i = 0; i < list.length; i += 1) {
    const ref = list[i]!
    if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    try {
      const value = await call(ref)
      return { value, used: ref, skipped }
    } catch (err) {
      // 用户中止不应被误判为模型故障，否则会换模型继续烧钱
      if (isAbortError(err) || options.signal?.aborted) throw err
      const retryable = options.isRetryable ? options.isRetryable(err) : true
      if (!retryable) throw err
      lastError = err
      skipped.push({ ...ref, error: errorMessage(err) })
      options.onFallback?.(ref, errorMessage(err), list[i + 1] ?? null)
    }
  }
  throw lastError ?? new Error('GRAPH_MODEL_CHAIN_EMPTY')
}
