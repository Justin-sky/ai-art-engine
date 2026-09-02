/**
 * 双进程共享的应用错误工厂：
 * - 抛出时按当前语言（main 读设置 / renderer 读 vue-i18n）格式化中英消息；
 * - 上游未本地化的第三方文本（HTTP 响应、ffmpeg 输出等）一律作为参数嵌入句式；
 * - 错误对象附带稳定 `code`（供日志检索；等值比较型控制流哨兵如 GRAPH_* 不走这里）。
 *
 * 用法：
 *   // 目录条目
 *   export const ERRORS = {
 *     missingApiKey: defErr('provider.missingApiKey', () => '请先填写 API Key', () => 'API Key is required')
 *   }
 *   throw fail(ERRORS.missingApiKey)
 *   throw fail(ERRORS.actionFailed, { action: '图片生成', detail: raw })
 */

export type AppLanguage = 'zh-CN' | 'en-US'

/** 单语言格式化器：闭包取参，避免字符串模板替换的运行时解析 */
export type LangFormatter<P> = (params: P) => string

/** 带稳定 code 的双语错误条目；P 由 zh 闭包参数标注推导 */
export type BiDef<P> = {
  readonly code: string
  readonly zh: LangFormatter<P>
  readonly en: LangFormatter<P>
}

let localeResolver: () => AppLanguage = () => 'zh-CN'

/**
 * 注册本进程的错误语言解析器。
 * main：`() => settingsService.get().language`（懒取，跟随设置即时变化）；
 * renderer：`() => i18n.global.locale.value`。
 */
export function setAppErrorLocaleResolver(resolver: () => AppLanguage): void {
  localeResolver = resolver
}

export function resolveAppErrorLocale(): AppLanguage {
  return localeResolver()
}

/** 定义一个可复用的双语错误条目（P 从 zh 闭包的参数标注推导） */
export function defErr<P>(
  code: string,
  zh: LangFormatter<P>,
  en: LangFormatter<P>
): BiDef<P> {
  return { code, zh, en }
}

/** 无参简写：仅传字符串的条目（两语言同构无插值） */
export function defErrSimple(code: string, zh: string, en: string): BiDef<undefined> {
  return { code, zh: () => zh, en: () => en }
}

/** 带稳定 code 的应用错误。message 已按当前语言格式化。 */
export class AppError extends Error {
  readonly code: string
  readonly params: unknown

  constructor(message: string, code: string, params?: unknown) {
    super(message)
    this.name = 'AppError'
    this.code = code
    this.params = params
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError
}

function safeFormat(fmtFn: (p: never) => string, params: unknown, code: string): string {
  try {
    return fmtFn(params as never)
  } catch {
    return code
  }
}

/**
 * 按当前语言构造带 code 的错误，配合 `throw` / `Promise.reject` 使用。
 * 格式化异常时回退为 code 本身，保证消息永不悬空。
 */
export function fail<P>(def: BiDef<P>, ...rest: P extends undefined ? [] : [P]): AppError {
  const params = rest[0]
  const lang = resolveAppErrorLocale()
  const fmtFn = lang === 'en-US' ? def.en : def.zh
  return new AppError(safeFormat(fmtFn, params, def.code), def.code, params)
}

/**
 * 按当前语言格式化双语条目，不抛错。
 * 用于日志 / 结果提示等**非 throw** 场景，与 fail() 共用同一套 defErr 条目；
 * 格式化异常时同样回退为 code，保证文案永不悬空。
 */
export function formatBi<P>(def: BiDef<P>, ...rest: P extends undefined ? [] : [P]): string {
  const params = rest[0]
  const lang = resolveAppErrorLocale()
  const fmtFn = lang === 'en-US' ? def.en : def.zh
  return safeFormat(fmtFn, params, def.code)
}
