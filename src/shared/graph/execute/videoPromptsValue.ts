import type { VideoPromptPlan } from '../../semanticTimeline'
import type { GraphVideoPromptsValue } from './types'

/**
 * 造一个视频生成提示词值：计划本体 + 规范 JSON 文本。
 *
 * 文本随值一起带，是为了目标端口是 `text` 时能被**端口边界**直接投影过去
 * （提示词 → 文本口是允许的单向兼容），不必让消费侧再序列化一次。
 */
export function videoPromptsValue(plan: VideoPromptPlan): GraphVideoPromptsValue {
  return { kind: 'videoPrompts', plan, text: JSON.stringify(plan, null, 2) }
}
