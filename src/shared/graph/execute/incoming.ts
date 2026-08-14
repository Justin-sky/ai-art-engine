import type { GraphValue, NodeExecuteContext } from './types'
import { flattenTextValues } from './gallery'
import {
  instructionHasMentions,
  selectByMentionIndexes,
  type InstructionMentionSource
} from '../instructionMentions'

/** 合并所有输入端口上的值（多输入口节点） */
export function collectIncomingValues(inputs: Record<string, GraphValue[]>): GraphValue[] {
  if (inputs.in?.length) return inputs.in
  return Object.values(inputs).flat()
}

/** 与 `@n` 同序的入边值；无 incomingByIndex 时回退到端口扁平顺序 */
export function resolveIncomingByIndex(
  ctx: NodeExecuteContext
): Array<{ index: number; value: GraphValue }> {
  if (ctx.incomingByIndex?.length) {
    return ctx.incomingByIndex
      .filter((entry): entry is { index: number; value: GraphValue } => Boolean(entry.value))
      .map((entry) => ({ index: entry.index, value: entry.value }))
  }
  return collectIncomingValues(ctx.inputs).map((value, i) => ({ index: i + 1, value }))
}

/**
 * 按指令筛选上游值：无 `@` 全量；有 `@` 仅命中编号。
 */
export function selectIncomingValuesForInstruction(
  ctx: NodeExecuteContext,
  instructionRaw: string
): GraphValue[] {
  return selectByMentionIndexes(instructionRaw, resolveIncomingByIndex(ctx))
}

/**
 * 无 `@` 时拼接全部上游正文；端口值为空时回退 mentionSources（含输入接口槽）。
 * 有 `@` 时不自动拼接（只靠展开后的指令）。
 */
export function autoIncomingTextForInstruction(
  instructionRaw: string,
  values: GraphValue[],
  mentionSources?: InstructionMentionSource[]
): string {
  if (instructionHasMentions(instructionRaw)) return ''
  const fromPorts = flattenTextValues(values)
    .map((item) => item.text.trim())
    .filter(Boolean)
    .join('\n\n')
  if (fromPorts) return fromPorts
  if (!mentionSources?.length) return ''
  return mentionSources
    .map((source) => source.text.trim())
    .filter(Boolean)
    .join('\n\n')
}
