import type { GraphPolicyConfig, GraphPolicyPartial, GraphScopePolicy } from './types'

export function parseGraphPolicyConfig(raw: unknown): GraphPolicyConfig {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Invalid graph policy: expected object')
  }
  const config = raw as Record<string, unknown>
  if (config.version !== 1) {
    throw new Error(`Unsupported graph policy version: ${String(config.version)}`)
  }
  if (!config.scopes || typeof config.scopes !== 'object') {
    throw new Error('Invalid graph policy: missing scopes')
  }
  const scopes: Record<string, GraphScopePolicy> = {}
  for (const [scopeId, scopeRaw] of Object.entries(config.scopes as Record<string, unknown>)) {
    scopes[scopeId] = parseScopePolicy(scopeId, scopeRaw)
  }
  return { version: 1, scopes }
}

function parseScopePolicy(scopeId: string, raw: unknown): GraphScopePolicy {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`Invalid graph policy scope: ${scopeId}`)
  }
  const scope = raw as Record<string, unknown>
  if (!Array.isArray(scope.addableNodeTypes)) {
    throw new Error(`Invalid graph policy scope ${scopeId}: addableNodeTypes must be an array`)
  }
  return {
    addableNodeTypes: scope.addableNodeTypes.map(String)
  }
}

/** 将 partial 合并到 base（addable 去重并集） */
export function mergePolicyConfigs(
  base: GraphPolicyConfig,
  partial: GraphPolicyPartial | undefined
): GraphPolicyConfig {
  if (!partial?.scopes) return base
  const scopes: Record<string, GraphScopePolicy> = { ...base.scopes }
  for (const [scopeId, patch] of Object.entries(partial.scopes)) {
    const existing = scopes[scopeId]
    if (!existing) {
      scopes[scopeId] = {
        addableNodeTypes: [...(patch.addableNodeTypes ?? [])]
      }
      continue
    }
    const addable = new Set(existing.addableNodeTypes)
    for (const typeId of patch.addableNodeTypes ?? []) addable.add(typeId)
    scopes[scopeId] = {
      addableNodeTypes: [...addable]
    }
  }
  return { version: 1, scopes }
}
