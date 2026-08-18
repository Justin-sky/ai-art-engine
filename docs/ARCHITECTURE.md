# AIArtEngine Architecture

## 设计目标

项目采用 Unity Editor 式的“内核 + Feature + 扩展注册”思路，但保持 Electron 的安全边界：

- Renderer：Editor Kernel、工作台、Feature UI、临时状态。
- Shared：领域模型、IPC 契约、节点图纯逻辑。
- Main：文件系统、系统对话框、生成服务等特权能力。
- Preload：Renderer 与 Main 之间唯一的类型化桥接。

工程文件格式不依赖编辑器实现，仍使用可读的 JSON + 媒体文件。

资产管线自工程 version 2 起为真实目录 + 旁挂 meta，详见 [ASSET_MODEL.md](./ASSET_MODEL.md)。

工程内资产引用正向 [AssetRef](./ASSET_REF.md) 统一（`{ $type: "AssetRef", guid }` + collect/remap）。跨工程素材包见 [ASSET_PACKAGE.md](./ASSET_PACKAGE.md)。

## Editor Kernel

路径：`src/renderer/src/editor/kernel/`

- `selection`：统一表示 shot、asset、graph node 等当前选择。
- `commands`：修改命令及 Undo/Redo 历史。
- `events`：Feature 间的进程内领域事件。
- `documents`：文档 dirty、save、autosave 生命周期。

Feature 不应直接操作另一个 Feature 的组件，应通过 Kernel、领域 Store 或明确的端口通信。

命令历史与 Document Session 均按文档 scope 隔离；一个宿主资产标签聚合其所有
子文档的 dirty 状态，不会把一张图的保存或撤销应用到另一张图。

## 扩展清单

路径：`src/renderer/src/editor/extensions/`

一个扩展可贡献：

- Dock 工作窗口
- Inspector / CustomEditor
- PropertyDrawer
- 节点类型、画布 Scope、Scope 宿主绑定
- Graph 卡片组件
- 资产导入器
- 工作区工具栏条目
- 可绑定快捷键的编辑器命令
- 自定义激活和销毁逻辑

```ts
export const name = 'example.feature'
export const inject = ['kernel', 'editor']

export function apply(ctx) {
  ctx.editor.window(/* ... */)
  ctx.on('ready', () => {
    ctx.kernel.events.on('selection:changed', ({ current }) => {
      console.debug(current)
    })
  })
}
```

目前只开放应用内部扩展。受控插件清单必须声明 `apiVersion` 和权限，并经过兼容校验；
宿主不使用 `eval`、远程 URL 或任意 Node 权限加载插件。

外部声明式扩展放在 Electron 用户数据目录的 `plugins/<plugin-id>/plugin.json`：

```json
{
  "id": "example.assets",
  "version": "1.0.0",
  "apiVersion": 1,
  "displayName": "Example Assets",
  "permissions": ["workspace.write"],
  "contributions": {
    "toolbarItems": [
      { "id": "example-image", "assetType": "image", "openOnCreate": true }
    ]
  }
}
```

设置页会列出发现的扩展。当前外部扩展仅允许数据化贡献，不能注入组件或执行脚本。

## 状态边界

- `project store`：工程领域数据的 Renderer 镜像。
- `workspace store`：窗口与拖放状态；选择已同步到 Editor Kernel。
- `drafts store`：未提交、仅内存存在的资产。
- `Editor Kernel`：跨 Feature 的编辑器级状态与服务。

Editor Kernel 是选择状态的唯一来源；workspace 暴露的选择字段只是只读兼容投影。
Graph 编辑端口已迁到 `features/graph/model/graphEditorHosts.ts`，不再由 workspace
承担领域读写服务。

## Autosave 与 Repository

- Asset、Folder、Project 均有独立 Repository；list 不再隐式写盘。
- 媒体导入和附件替换使用原子复制与事务回滚。
- `repositories/autosaveRepository.ts` 将影子文档写入 `.aiartengine/autosave`。
- `repositories/jsonFile.ts` 使用临时文件 + rename，避免半写 JSON。
- 正式保存会删除对应影子条目；重新打开工程时先恢复到 Renderer 内存。

节点图默认采用严格手动保存：切换文档只保留内存缓存，用户按 `Ctrl+S`
后才写入当前脏文档。用户可在设置中启用自动保存并配置间隔秒数；
启用后由 `EditorDocumentService` 在文档停止变化达到该间隔时写入正式文件。

## 注册表

- Inspector：`src/renderer/src/inspector/registry.ts`
- Editor runtime：`src/renderer/src/editor/runtime/`（Cordis）
- Main runtime：`src/main/runtime/`（Cordis；模型提供商 / 对象存储为 `ctx.plugin`）
- Graph Node：`src/shared/graph/registry.ts`
- Graph Executor：`src/shared/graph/execute/`（覆盖栈 `registry.ts`；实现按域拆在 `host` / `generateMedia` / `generateText` / `imageEdit` / `narrative` 等；Cordis `ctx.editor.executor`）
- Graph Scope：`src/shared/graph/scopes.ts`
- Graph Card：`src/renderer/src/graph/cards/registry.ts`

节点图插件开发详见 [GRAPH_PLUGINS.md](./GRAPH_PLUGINS.md)。

新增 Feature 应优先注册贡献，不应继续扩大 `StudioView.vue` 的组件分发表。

## 后续迁移

- [x] 资产、分镜和节点主要编辑路径已包装为 `EditorCommand`，支持合并与文档级 Undo/Redo。
- [x] Asset、Script、Panorama、Director、NodeGraph 编辑器已接入 `EditorDocumentService`。
- [x] NodeGraph 已分离 graph document model、命令/节点交互 controller、geometry/grid renderer 工具。
- [x] Workbench 已分离面板标题和动态编辑器打开服务；Graph 运行会话已迁入 controller。
- [x] 主进程已拆出 Asset、Project、Autosave 与原子 JSON Repository。
- [x] 已实现外部声明式插件发现、API/权限校验和设置页清单；出于安全考虑不执行任意外部脚本。

## 自动化验证

使用 Vitest 覆盖 Editor Kernel 和 Graph Document 的关键不变量：

- 文档级 Undo/Redo 隔离与命令合并
- clean / dirty / saving 状态迁移
- 自动保存开关与延时
- Graph Document 深拷贝和原位替换

运行：`npm test`
