import { rewriteAtMentionsForImagePrompt } from '../imagePromptMentions'

/**
 * 应用内媒体/风格引用统一写 `@n`（与指令 chips、端口序一致）。
 * 火山方舟 Seedream `/images/generations` 的 `image[]` 需在 prompt 里用「图n」指代，
 * 发送前转换；否则模型无法对齐参考图，风格约束几乎不起作用。
 * 复用通用图片指代改写，独立导出以保留调用点语义与既有测试。
 */
export function rewriteAtMentionsForVolcengineArkImagePrompt(prompt: string): string {
  return rewriteAtMentionsForImagePrompt(prompt)
}
