/**
 * SVG 生成节点（`svg.gen`）：用文本模型产出 SVG 源码，落盘为工程内的 .svg 资产，
 * 再以 `svg` 端口把矢量正文交给下游（SVG 烘焙节点转为位图序列 / GIF）。
 *
 * 与 `svgAnim.ts` 的分工一致：本文件只放常量、参数归一化与提示词，
 * 执行器在 `execute/svgGen.ts`。
 */
import type { GraphNodeParams } from './types'

/** 输出画布默认边长（px） */
export const SVG_GEN_SIZE_DEFAULT = 512
export const SVG_GEN_SIZE_MIN = 16
export const SVG_GEN_SIZE_MAX = 2048

/** 参考图数量上限（`in-image` 端口送进多模态文本模型的图片数） */
export const SVG_GEN_REFERENCE_MAX = 4

export type SvgGenBackground = '' | 'white' | 'black'

export interface SvgGenState {
  /** 画布宽 / 高（px），会写进提示词约束 viewBox */
  width: number
  height: number
  /** 背景填充（'' = 透明） */
  background: SvgGenBackground
}

export const DEFAULT_SVG_GEN_STATE: SvgGenState = {
  width: SVG_GEN_SIZE_DEFAULT,
  height: SVG_GEN_SIZE_DEFAULT,
  background: ''
}

export function normalizeSvgGenSize(raw: unknown): number {
  const value = Math.floor(Number(raw))
  if (!Number.isFinite(value) || value <= 0) return SVG_GEN_SIZE_DEFAULT
  return Math.min(SVG_GEN_SIZE_MAX, Math.max(SVG_GEN_SIZE_MIN, value))
}

export function normalizeSvgGenBackground(raw: unknown): SvgGenBackground {
  return raw === 'white' || raw === 'black' ? raw : ''
}

export function normalizeSvgGenState(raw?: Partial<SvgGenState> | null): SvgGenState {
  return {
    width: normalizeSvgGenSize(raw?.width),
    height: normalizeSvgGenSize(raw?.height),
    background: normalizeSvgGenBackground(raw?.background)
  }
}

export function readSvgGenFromNode(params: GraphNodeParams): SvgGenState {
  return normalizeSvgGenState({
    width: params.svgGenWidth,
    height: params.svgGenHeight,
    background: normalizeSvgGenBackground(params.svgGenBackground)
  })
}

export function svgGenToNodePatch(state: SvgGenState): {
  svgGenWidth: number
  svgGenHeight: number
  svgGenBackground: SvgGenBackground
} {
  const normalized = normalizeSvgGenState(state)
  return {
    svgGenWidth: normalized.width,
    svgGenHeight: normalized.height,
    svgGenBackground: normalized.background
  }
}

const SVG_GEN_SYSTEM_PROMPT_ZH =
  '你是 AIArtEngine 的 SVG 矢量图生成专家。请把描述绘制成一份可直接渲染的独立 SVG 源码：只输出一个根节点 <svg>…</svg>，不要 markdown 代码围栏、不要任何解释文字；必须带 xmlns="http://www.w3.org/2000/svg" 并用 viewBox 定义坐标系；图形用矢量元素表达（path/rect/circle/ellipse/polygon/line/g/text，配合 defs/gradient/clipPath），禁止引用外部图片、字体文件、脚本或网络资源，禁止内嵌 <image> 位图；需要动效时只用 SMIL 动画（<animate>/<animateTransform>/<set>）并把动效做成可无缝循环的完整周期，不要用 CSS @keyframes，也不要用 <animateMotion>（逐帧烘焙只求值 SMIL 的那几种属性动画，其余会被当作静态图）；配色、风格、构图与描述保持一致，形状边缘干净，不得出现 NaN、空 path 等无效数据。' // cjk-ok（LLM 系统提示词：随生成请求发给模型，不进入 UI）

const SVG_GEN_SYSTEM_PROMPT_EN = `You are an expert in SVG vector art for AIArtEngine.
Render the description as a standalone, directly renderable SVG source:
- Output only one root <svg>…</svg> element: no markdown fences, no explanations;
- Always include xmlns="http://www.w3.org/2000/svg" and define the coordinate system with viewBox;
- Express the artwork with vector elements (path/rect/circle/ellipse/polygon/line/g/text plus defs/gradient/clipPath); never reference external images, fonts, scripts or network resources, and never embed <image> bitmaps;
- For motion use SMIL only (<animate>/<animateTransform>/<set>) shaped as one seamless loop; never CSS @keyframes or <animateMotion>, since frame baking evaluates only those SMIL attribute animations and treats anything else as static;
- Keep palette, style and composition consistent with the description, with clean edges and no invalid data such as NaN or empty paths.`

export function resolveSvgGenSystemPrompt(override?: string | null, locale?: string): string {
  if (typeof override === 'string' && override.trim()) return override.trim()
  return locale?.startsWith('en') ? SVG_GEN_SYSTEM_PROMPT_EN : SVG_GEN_SYSTEM_PROMPT_ZH
}

/** 画布尺寸 / 背景约束：追加在指令后，让模型按目标尺寸建立 viewBox */
export function buildSvgGenCanvasInstruction(state: SvgGenState, locale?: string): string {
  const { width, height, background } = normalizeSvgGenState(state)
  if (locale?.startsWith('en')) {
    const backgroundEn =
      background === 'white' ? 'pure white' : background === 'black' ? 'pure black' : 'transparent'
    return `Canvas: ${width}×${height} px with viewBox="0 0 ${width} ${height}", background ${backgroundEn} (do not paint a full-canvas backdrop unless the description calls for one).`
  }
  const backgroundZh = background === 'white' ? '纯白' : background === 'black' ? '纯黑' : '透明' // cjk-ok（LLM 提示词片段）
  return `画布：${width}×${height} px，viewBox="0 0 ${width} ${height}"，背景${backgroundZh}（除非描述本身要求，否则不要铺满整块背景）。` // cjk-ok（LLM 提示词片段：约束 viewBox 与背景）
}

/**
 * 参考图说明：`in-image` 端口有上游图片时追加在指令后，让模型「看图生矢量」。
 * count 为实际可用的参考图数量；为 0 时返回空串（纯文生 SVG 路径不受影响）。
 */
export function buildSvgGenReferenceInstruction(count: number, locale?: string): string {
  if (!Number.isFinite(count) || count <= 0) return ''
  if (locale?.startsWith('en')) {
    return `Reference: ${count} image${count > 1 ? 's' : ''} attached. Reproduce the subject of the attached reference as clean vector shapes — follow its silhouette, proportions, palette and composition, but keep everything in vector form (no embedded bitmaps, no pixel-level tracing).`
  }
  return `参考图：已附 ${count} 张图。请把参考图中的主体用纯矢量图形重绘——遵循其轮廓、比例、配色与构图，且保持全矢量表达（不要内嵌位图，也不要逐像素描摹）。` // cjk-ok（LLM 提示词片段：说明可用的参考图）
}

/**
 * 从模型输出里抽出 `<svg>…</svg>` 标记：容忍 markdown 代码围栏与前后说明文字。
 * 返回空串表示没有可用的 SVG 标记。
 */
export function extractSvgMarkup(raw: string): string {
  const text = String(raw ?? '').trim()
  if (!text) return ''
  const unfenced = text.includes('```')
    ? text.replace(/```[a-zA-Z0-9_-]*\s*([\s\S]*?)```/g, '$1').trim()
    : text
  const source = unfenced.toLowerCase().includes('<svg') ? unfenced : text
  const lower = source.toLowerCase()
  const start = lower.indexOf('<svg')
  if (start < 0) return ''
  const end = lower.lastIndexOf('</svg>')
  if (end < start) return ''
  return source.slice(start, end + '</svg>'.length).trim()
}

/** SVG 源码 → `data:image/svg+xml;base64,…`（主进程按 MIME 落 .svg，卡片与下游可直接渲染） */
export function encodeSvgDataUrl(svg: string): string {
  const bytes = new TextEncoder().encode(svg)
  let binary = ''
  const chunk = 0x8000
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk))
  }
  return `data:image/svg+xml;base64,${btoa(binary)}`
}
