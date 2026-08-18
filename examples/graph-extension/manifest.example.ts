/**
 * 节点图插件骨架 — 与内置演示 `src/renderer/src/editor/extensions/graphDemo/` 等价。
 * 文档：docs/GRAPH_PLUGINS.md
 */
export {
  GRAPH_DEMO_EXTENSION_ID,
  GRAPH_DEMO_NODE_TYPE_ID,
  GRAPH_DEMO_SCOPE_ID,
  apply as graphDemoPlugin,
  registerGraphDemoExtension
} from '../../src/renderer/src/editor/extensions/graphDemo'

/**
 * 复制为新插件时，导出 Cordis plugin：
 *
 * export const name = 'plugin.example'
 * export const inject = ['kernel', 'editor']
 * export function apply(ctx) {
 *   ctx.editor.nodeType(...)
 *   ctx.editor.graphScope(...)
 *   ctx.editor.graphScopeHost(...)
 *   ctx.editor.graphPolicy(name, { scopes: { ... } })
 *   ctx.editor.inspector(...)
 *   ctx.editor.graphCard(...)
 *   ctx.editor.skill(...)
 * }
 */
