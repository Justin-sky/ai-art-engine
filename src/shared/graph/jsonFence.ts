/** 去掉模型常见的 markdown 代码围栏 */
export function stripJsonCodeFence(raw: string): string {
  const trimmed = raw.trim()
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  if (fenced?.[1]) return fenced[1].trim()
  return trimmed
}
