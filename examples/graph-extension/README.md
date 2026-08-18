# 节点图扩展示例

本目录说明 **AIArtEngine 图插件** 的 manifest 结构；**可运行的内置演示**已接入应用。

## 可运行演示（内置）

源码：`src/renderer/src/editor/extensions/graphDemo/`

正式包默认不加载。本地调试时在 runtime 启动后调用 `registerGraphDemoExtension()`（内部是 `ctx.plugin`）。

### 如何体验

1. 打开任意**模型**资产的节点图（`model` 资产 → 节点图画布）
2. 右键菜单应出现 **「图插件示例」**（`plugin.example.node`）
3. 添加后节点为蓝紫色自定义卡片；选中后在检查器面板看到演示说明
4. 在普通工作流 / 分镜工作流画布中也可右键添加同一节点

演示扩展注册内容：

| 贡献 | id |
|------|-----|
| 节点类型 | `plugin.example.node` |
| 画布 Scope | `plugin.exampleCanvas` |
| Scope 宿主 | `assetType: model` → 上述 Scope |
| 图策略 | `graphPolicy`（示例 scope + workflow / shotWorkflow） |
| 卡片 | `plugin.example.card` |
| 检查器 | `plugin.example.inspector` |

## 本目录文件

| 文件 | 说明 |
|------|------|
| `manifest.example.ts` | 与内置演示等价的 manifest 骨架（供复制参考） |

完整文档：[docs/GRAPH_PLUGINS.md](../../docs/GRAPH_PLUGINS.md)

## 复制为新插件

1. 复制 `graphDemo/` 目录并重命名
2. 修改 `typeId` / `scope` id（建议 `plugin.*` 前缀）
3. 导出 Cordis `apply(ctx)`，在 `startEditorRuntime()` 之后 `ctx.plugin(yourPlugin)`
4. 补充 `tests/` 用例；运行 `npm test`

## 测试

- `tests/graphCards.test.ts` — 卡片注册表解析
- `tests/graphScopes.test.ts` — Scope 与拖入规则
- `tests/graphPolicy.test.ts` — 图策略（可添加节点 + 连线）
