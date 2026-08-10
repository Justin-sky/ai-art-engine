/**
 * 应用内统一用 `@n` 指代第 n 张图片输入（风格图占前 N 张，端口参考图随后）。
 * 多数图片模型（Seedream / Gemini 等）不认识 `@n`，需在发送前转成「图n」这类
 * 模型能理解的指代；否则多参考图时 prompt 里的风格/构图约束无法与 image[] 对齐，
 * 风格约束几乎不起作用。
 * 仅替换 `@` 前不是单词字符的情况，避免误伤 email@123 之类。
 */
export function rewriteAtMentionsForImagePrompt(prompt: string): string {
  if (!prompt) return prompt
  return prompt.replace(/(^|[^\w@])@(\d+)\b/g, '$1图$2')
}
