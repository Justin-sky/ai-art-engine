/**
 * 人像处理的画幅与尺寸：把**源图**的像素尺寸换算成模型能接受的参数。
 *
 * 为什么需要它（7.0.x 线上问题）：执行器原先只发 `resolution`（档位）与 `quality`，
 * **不发 `aspectRatio`** —— 于是模型按自己的默认画幅出图（多数是 1:1），
 * 修完的图和原图尺寸对不上：竖幅人像变方图、横幅变方图，构图也跟着变。
 * 节点的系统提示词里写着「取景与原片一致」，但那是文字约束，拦不住模型；
 * 画幅必须走接口参数。
 *
 * 这里只做纯计算（可单测），不含 DOM / 网络：
 * - `portraitAspectRatioForSize`：源图尺寸 → **最接近的标准比例**。
 *   必须是标准比例而不是 `4032:3024` 这种原始比：OpenAI / 方舟 / Gemini 各家的
 *   `size` / `aspect_ratio` 都只认固定枚举，非枚举值在适配器里会退化成「不发该字段」，
 *   等于又回到默认画幅。
 * - `portraitResolutionTierForSize`：「输出尺寸 = 自动」时按源图最大边选一个够用的档
 *   （源图 4032 宽就发 4K，别用 1K 出图再放大）。
 */

/**
 * 候选标准比例。
 *
 * 刻意收敛到各家**都认**的那一批（OpenAI 的 `RATIO_TO_SIZE`、方舟 Seedream 的档位表、
 * Gemini 的 `aspect_ratio` 三项取交集）：`1:1 / 4:3 / 3:4 / 3:2 / 2:3 / 16:9 / 9:16`。
 * 相机常见的 5:4、65:24 之类映射到最近的这一个；映射误差用对数比衡量（见下）。
 * 顺序不影响结果，只影响同分时的取舍。
 */
export const PORTRAIT_ASPECT_RATIOS: readonly string[] = [
  '1:1',
  '4:3',
  '3:4',
  '3:2',
  '2:3',
  '16:9',
  '9:16'
]

/** 应用内分辨率档位对应的长边像素（1K≈1024 / 2K≈2048 / 4K≈4096） */
export const PORTRAIT_RESOLUTION_EDGE: Readonly<Record<'1K' | '2K' | '4K', number>> = {
  '1K': 1024,
  '2K': 2048,
  '4K': 4096
}

/** 把 `16:9` 解析成数值比；非法输入返回 null */
export function parseAspectRatio(value: string | undefined): number | null {
  const raw = (value || '').trim().replace(/\s+/g, '')
  const m = /^(\d+):(\d+)$/.exec(raw)
  if (!m) return null
  const width = Number(m[1])
  const height = Number(m[2])
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null
  return width / height
}

/**
 * 源图尺寸 → 最接近的标准比例。
 *
 * 用 `|ln(候选比 / 目标比)|` 当误差：它与「横竖颠倒」无关地对称
 * （4:3 与 3:4 对同一个目标的误差相同，谁都不会被系统性偏向），
 * 而线性差值会偏向横幅候选。
 */
export function portraitAspectRatioForSize(width: number, height: number): string {
  const w = Number.isFinite(width) && width > 0 ? width : 1
  const h = Number.isFinite(height) && height > 0 ? height : 1
  const target = w / h
  let best = PORTRAIT_ASPECT_RATIOS[0]!
  let bestError = Number.POSITIVE_INFINITY
  for (const candidate of PORTRAIT_ASPECT_RATIOS) {
    const ratio = parseAspectRatio(candidate)
    if (!ratio) continue
    const error = Math.abs(Math.log(ratio / target))
    if (error < bestError) {
      bestError = error
      best = candidate
    }
  }
  return best
}

/**
 * 「输出尺寸 = 自动」时按源图最大边选档：取**恰好装得下**原图的最小档。
 *
 * 上限落在 4K：再大的原图（例如 8000px 的商业片）也只能要 4K，
 * 出图后由本地精确缩放到原尺寸 —— 想要更大就只能换支持更高分辨率的模型。
 */
export function portraitResolutionTierForSize(width: number, height: number): '1K' | '2K' | '4K' {
  const longest = Math.max(
    Number.isFinite(width) && width > 0 ? width : 0,
    Number.isFinite(height) && height > 0 ? height : 0
  )
  if (longest > PORTRAIT_RESOLUTION_EDGE['2K']) return '4K'
  if (longest > PORTRAIT_RESOLUTION_EDGE['1K']) return '2K'
  return '1K'
}

/**
 * 日志用的一行画幅说明：让「为什么出图是这个尺寸」在运行日志里可查。
 * 与执行器里其它日志同一口径（英文短句 + 关键数值），便于 grep。
 */
export function describePortraitFraming(input: {
  width: number
  height: number
  measured: boolean
  outputSize: 'auto' | '1K' | '2K' | '4K'
}): string {
  const source = `${input.width}x${input.height}${input.measured ? '' : ' (assumed)'}`
  const ratio = portraitAspectRatioForSize(input.width, input.height)
  if (input.outputSize === 'auto') {
    const tier = portraitResolutionTierForSize(input.width, input.height)
    return `framing: ${ratio} (source ${source}) · output size auto -> ${tier} tier, then fit back to source size`
  }
  return `framing: ${ratio} (source ${source}) · output size ${input.outputSize}`
}
