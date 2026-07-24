import defaultPolicyJson from './default.graph-policy.json'
import { mergePolicyConfigs, parseGraphPolicyConfig } from './loader'
import type { GraphPolicyConfig, GraphPolicyPartial, GraphScopePolicy } from './types'

let builtinPolicy: GraphPolicyConfig | null = null
const overlays = new Map<string, GraphPolicyPartial>()
let cachedEffective: GraphPolicyConfig | null = null
const changeListeners = new Set<() => void>()

function notifyChanged(): void {
  cachedEffective = null
  for (const listener of changeListeners) listener()
}

export function onGraphPolicyChanged(listener: () => void): () => void {
  changeListeners.add(listener)
  return () => changeListeners.delete(listener)
}

/** 加载内置策略；幂等 */
export function loadBuiltinGraphPolicy(): GraphPolicyConfig {
  if (!builtinPolicy) {
    builtinPolicy = parseGraphPolicyConfig(defaultPolicyJson)
    notifyChanged()
  }
  return builtinPolicy
}

function ensureBuiltin(): GraphPolicyConfig {
  return loadBuiltinGraphPolicy()
}

export function getGraphPolicy(): GraphPolicyConfig {
  if (cachedEffective) return cachedEffective
  let effective = ensureBuiltin()
  for (const overlay of overlays.values()) {
    effective = mergePolicyConfigs(effective, overlay)
  }
  cachedEffective = effective
  return effective
}

export function getScopePolicy(scope: string): GraphScopePolicy | undefined {
  return getGraphPolicy().scopes[scope]
}

/**
 * 注册策略覆盖层（插件）。返回 dispose，移除该覆盖。
 * @param overlayId 唯一 id（通常为扩展 manifest.id）
 */
export function mergeGraphPolicy(overlayId: string, partial: GraphPolicyPartial): () => void {
  overlays.set(overlayId, partial)
  notifyChanged()
  return () => {
    if (overlays.delete(overlayId)) notifyChanged()
  }
}

/** 测试用：清空覆盖层并重新加载内置 */
export function resetGraphPolicyForTests(): void {
  overlays.clear()
  builtinPolicy = null
  cachedEffective = null
  loadBuiltinGraphPolicy()
}
