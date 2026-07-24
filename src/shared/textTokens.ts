import { countTokens } from 'gpt-tokenizer/encoding/cl100k_base'

/**
 * 使用固定 cl100k_base 统计 token 数（非各厂商真实计费口径，但比字符启发式准确）。
 */
export function estimateTokenCount(text: string): number {
  if (!text) return 0
  return countTokens(text)
}
