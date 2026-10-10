import type { SemanticTimeline } from '../../semanticTimeline'
import type { GraphSemanticTimelineValue } from './types'

/**
 * 造一个语义时间线值：文档本体 + 规范 JSON 文本。
 *
 * 文本随值一起带，是为了目标端口是 `text` 时能被**端口边界**直接投影过去
 * （语义时间线 → 文本口是允许的单向兼容），不必让消费侧再序列化一次。
 */
export function semanticTimelineValue(doc: SemanticTimeline): GraphSemanticTimelineValue {
  return { kind: 'semanticTimeline', doc, text: JSON.stringify(doc, null, 2) }
}
