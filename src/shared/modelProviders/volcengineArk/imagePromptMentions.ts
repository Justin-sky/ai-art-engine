/**
 * 应用内媒体/风格引用统一写 `@n`（与指令 chips、端口序一致）。
 * 火山方舟 Seedream `/images/generations` 的 `image[]` 需在 prompt 里用「图n」指代，
 * 发送前转换；否则模型无法对齐参考图，风格约束几乎不起作用。
 */
export function rewriteAtMentionsForVolcengineArkImagePrompt(prompt: string): string {
  if (!prompt) return prompt
  // 避免误伤 email@123 这类：要求 @ 前不是单词字符
  return prompt.replace(/(^|[^\w@])@(\d+)\b/g, '$1图$2')
}
