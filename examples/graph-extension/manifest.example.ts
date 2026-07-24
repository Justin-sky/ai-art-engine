/**
 * 节点图插件 manifest 骨架 — 与内置演示 `src/renderer/src/editor/extensions/graphDemo/` 等价。
 * 文档：docs/GRAPH_PLUGINS.md
 */
export {
  GRAPH_DEMO_EXTENSION_ID,
  GRAPH_DEMO_NODE_TYPE_ID,
  GRAPH_DEMO_SCOPE_ID,
  registerGraphDemoExtension
} from '../../src/renderer/src/editor/extensions/graphDemo'

/**
 * 复制为新插件时，参照 graphDemo/index.ts 中的 registerExtensionManifest 结构：
 *
 * - nodeTypes: typeId、inspectorId、cardId、execute（addable 全局开关）
 * - graphScopes: output、dragAssets、createParams
 * - graphScopeHosts: assetType → scope
 * - graphPolicy: 各 scope 的 addableNodeTypes
 * - inspectors: nodeTypeId → component
 * - activate: ctx.registerGraphCard(...)
 */
