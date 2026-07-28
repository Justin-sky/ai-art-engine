import { matchesTypeIdPattern } from './match'
import { getScopePolicy } from './registry'

export function isNodeAddableInScope(scope: string, typeId: string): boolean {
  // classic output.* 已废弃：出口统一由 HDA boundary 承担，右键不可再添加
  if (typeId.startsWith('output.')) return false
  const policy = getScopePolicy(scope)
  if (!policy) return false
  return policy.addableNodeTypes.some((pattern) => matchesTypeIdPattern(pattern, typeId))
}
