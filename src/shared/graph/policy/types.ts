export interface GraphScopePolicy {
  /** 右键菜单可添加的节点 typeId；支持 `*` 与 `prefix.*` */
  addableNodeTypes: string[]
}

export interface GraphPolicyConfig {
  version: 1
  scopes: Record<string, GraphScopePolicy>
}

export type GraphPolicyPartial = {
  version?: 1
  scopes?: Record<string, Partial<GraphScopePolicy> & { addableNodeTypes?: string[] }>
}
