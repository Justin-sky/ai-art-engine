import { defErrSimple, formatBi } from '../errors/appError'

/**
 * 供应商侧失败的诊断增强：识别上游「通用失败」文案、附上可照做的清单，并标注这次打到了哪个网关。
 *
 * 背景（7.0.x 实测）：同一张参考图、同一个节点，先用 A 网关的 `gpt-image-2.5-flare` 失败，
 * 换 B 网关的 `nano-banana-2` 又失败 —— 两次回的是**一字不差**的同一段兜底文案：
 *
 *   We're unable to generate a result for this request at this time. This may be due to a content
 *   policy violation, invalid parameters, or an unknown issue. Please review your request and try again.
 *   本次请求可能因内容违规、参数错误或其他未知原因，暂时无法生成结果。请检查请求内容和参数后重试。
 *
 * 这段话把三种完全不同的原因（内容策略 / 参数不被支持 / 网关抖动）**并列**抛给用户，等于什么都没说，
 * 而它又是整条链路上唯一可见的信息（应用拿不到上游更细的错误码）。这个模块做三件事：
 *
 * 1. 认出这一族文案，并附一份能照着做的排查清单（应用不假装知道是哪一种）；
 * 2. 把**这次打到的主机与端点**缀在报错里 —— 「两个不同模型是不是同一个网关」是这类问题的关键分水岭，
 *    而运行日志原先只有 providerInstanceId，看不出这一点；
 * 3. 判定刻意收窄，鉴权失败 / 额度不足 / 超时 / 模型没返回图片这些自身已说清的报错不受影响。
 */

const LATIN_CANNOT_GENERATE =
  /unable to generate|cannot generate|can'?t generate|could not generate|failed to generate/i
const LATIN_CAUSE = /content policy|policy violation|invalid parameters?|unknown issue|moderation/i
const CJK_CANNOT_GENERATE = /无法生成|生成失败|暂时无法/
const CJK_CAUSE = /内容违规|违规内容|参数错误|未知原因|内容策略/

/**
 * 是否是上游的「通用失败」文案（并列多种原因、没有诊断价值）。
 *
 * 必须**同时**出现「生成不了」和至少一个原因词：只看「生成失败」会把
 * `图片生成失败`（我们自己的前缀）也算进来，反而给已有明确原因的报错加噪声。
 */
export function isGenericUpstreamGenerationFailure(message: string): boolean {
  const text = (message || '').trim()
  if (!text) return false
  const cjk = CJK_CANNOT_GENERATE.test(text) && CJK_CAUSE.test(text)
  const latin = LATIN_CANNOT_GENERATE.test(text) && LATIN_CAUSE.test(text)
  return cjk || latin
}

export const UPSTREAM_GENERIC_FAILURE_HINT = defErrSimple(
  'provider.genericUpstreamFailureHint',
  '（提示）这段是供应商返回的通用失败信息，应用无法判断具体属于哪一种。常见三类与对应做法：' +
    '① 参考图或提示词触发了上游内容策略 —— 同一张图换模型也失败时优先怀疑这一条：换一张不含真人肖像的图，' +
    '或先做一次重绘再精修；' +
    '② 参数不被该模型支持 —— 把分辨率档位调低一档（例如 2K → 自动 / 1K），或直接换一个模型跑同一张图；' +
    '③ 网关或模型侧临时故障 —— 间隔几十秒原样再跑一次。' +
    '若换个模型就成功，问题在该网关的模型别名或其通道，不在这一步的参数。',
  '(hint) This is the provider\u2019s generic failure text and the app cannot tell which cause applies. ' +
    'Three common ones: (1) the reference image or prompt tripped upstream content policy \u2014 if the same ' +
    'image also fails on another model, suspect this first: try an image without a real person\u2019s portrait, ' +
    'or run a redraw pass first; (2) the parameters are not supported by this model \u2014 lower the resolution ' +
    'tier (e.g. 2K \u2192 auto / 1K) or run the same image with another model; (3) a transient gateway or model ' +
    'failure \u2014 just run it again after a short wait. If switching models works, the problem is that ' +
    'gateway\u2019s model alias or its channel, not this step\u2019s parameters.'
)

/**
 * 命中通用失败时把提示缀在原文之后；否则原样返回。
 * 读上游错误的地方统一走它，用户就能在报错里直接看到下一步该做什么。
 * （文案按当前语言格式化：`formatBi` 走 `setAppErrorLocaleResolver` 注册的解析器。）
 */
export function withGenericUpstreamFailureHint(message: string): string {
  if (!isGenericUpstreamGenerationFailure(message)) return message
  return `${message}\n${formatBi(UPSTREAM_GENERIC_FAILURE_HINT)}`
}

/** 只保留主机名：去掉协议、账号密码、路径与查询串（日志里不该出现密钥或完整内网路径） */
export function providerHostOf(baseUrl: string): string {
  const raw = (baseUrl || '').trim()
  if (!raw) return ''
  try {
    return new URL(raw.includes('://') ? raw : `https://${raw}`).host
  } catch {
    return ''
  }
}

/**
 * 把「这次打到哪个网关的哪个端点」缀到报错尾部。
 *
 * 为什么必须带上：同一张图在两个不同模型上都失败、回的还是同一段兜底文案时，
 * 「这两个模型是不是同一个网关」是判断方向的关键 —— 是网关侧统一拒了（内容策略/通道），
 * 还是每个模型各自的问题。日志里只有 providerInstanceId，用户和我们都看不出这一点。
 */
export function annotateProviderTarget(
  message: string,
  baseUrl: string,
  endpoint?: string
): string {
  const host = providerHostOf(baseUrl)
  const path = (endpoint || '').trim()
  if (!host && !path) return message
  const target = [host, path].filter(Boolean).join(' · ')
  if (!target || message.includes(target)) return message
  return `${message}（provider: ${target}）`
}
