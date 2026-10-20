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
    "toolbarItems": [{ "id": "example-image", "assetType": "image", "openOnCreate": true }]
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
- Graph Introspection：`src/shared/graph/introspection.ts`（零配置运行时节点参数树与预设自省引擎）
- Graph SmartPatch：`src/shared/graph/smartPatch.ts`（深层点路径、数组选择器、JSON-string 透明解包与中英别名自愈补丁）
- Workspace Surface Bus：`src/renderer/src/editor/control/surfaceRegistry.ts`（焦点感知、缺省目标解析与按需 Schema 注入）
- Director Stage Hosts：`src/renderer/src/features/director/model/directorStageHosts.ts`（3D 导演台实时操控宿主注册表）
- Graph Executor：`src/shared/graph/execute/`（覆盖栈 `registry.ts`；实现按域拆在 `host` / `generateMedia` / `generateText` / `imageEdit` / `narrative` 等；Cordis `ctx.editor.executor`）
- Graph Ports：`src/shared/graph/ports.ts`（`portsCompatible` 仅认两端 `dataType` 相同；单数与复数不互通）
- Graph Scope：`src/shared/graph/scopes.ts`
- Graph Card：`src/renderer/src/graph/cards/registry.ts`

节点图插件开发详见 [GRAPH_PLUGINS.md](./GRAPH_PLUGINS.md)。

新增 Feature 应优先注册贡献，不应继续扩大 `StudioView.vue` 的组件分发表。

## 全工作区 AI 对话直控架构（4-Pillar Universal Workspace Control）

为实现「所有手动 UI 可进行的操作（含画布节点、全部 Dive 子编辑器、Inspector 任意嵌套属性、3D 导演台）均可在 AI 对话中直接完成，且代码新增节点或修改参数后零配置自动适配」，系统采用四支柱架构：

1. **Pillar 1 · 零配置运行时参数自省引擎（`src/shared/graph/introspection.ts`）**
   - `introspectNodeType(typeId)` 与 `introspectNodeInstance(node)` 直接对已注册节点的 `defaultParams()` 返回值及实时 `node.params` 做递归结构反射。
   - 自动生成完整字段树 `fields`、扁平点路径列表 `flatPaths`、无歧义顶层简写路由表 `shorthandMap`（如 `skinSmoothing -> portraitRetouch.skinSmoothing`、`yaw -> lightingSetup.yaw`）以及一键预设清单 `presets`。
   - 任何新注册的节点（`registerNodeType`）或新增的嵌套参数无需手写 MCP Schema 即可自动被 AI 感知与操控。

2. **Pillar 2 · 深层点路径与模糊别名自愈补丁引擎（`src/shared/graph/smartPatch.ts`）**
   - `mergeSmartNodeParams(node, patch)` 支持任意深度的点路径与数组选择器（如 `portraitRetouch.skinSmoothing`、`comicPage.panels[0].caption`、`filmStoryboard.shots[index=2].sound`、`filmCast.characters[name=林小满].outfit`）。
   - 对 `comicPage`、`filmStoryboard`、`filmCast` 等 JSON 字符串字段透明执行 `Unmarshal -> Deep Patch -> Normalize -> Marshal`，保证局部修改绝不冲掉同级未修改字段。
   - 自动自愈 `snake_case`、中文口语键名（如 `磨皮`、`瘦脸`、`眼神光`、`镜头距离`）与中文档位词（如 `'强烈' -> 'strong'`、`'适中' -> 'standard'`），并在补丁完成后自动同步领域归一化器与派生提示词（`lightingPrompt`、`multiAnglePrompt`、`emotionPrompt` 等）。

3. **Pillar 3 · 全图/节点组/预设与 3D 舞台统一编辑协议（`mcpGraphEdit.ts` & `mcpDirectorStageOps.ts`）**
   - `applyGraphEditOps` 支持 `node_add`、`node_update`、`node_upsert`、`node_delete`、`edge_add`、`edge_delete`、`apply_preset`、`group_add`、`group_update`、`group_delete`、`auto_layout` 以及节点坐标/尺寸/锁定（`x, y, w, h, locked`）。
   - `director_stage_edit` 支持 3D 导演台中演员/道具/白模的增删、显隐（`visible`）、位移/旋转/缩放、56 根骨骼旋转、全身/手部/视线姿态预设、光源与环境预设、机位切换及运镜录制。

4. **Pillar 4 · 焦点感知上下文总线（`surfaceRegistry.ts` & `buildActiveWorkspaceContext.ts`）**
   - `resolveActiveWorkspaceTargets()` 实时解析左窗当前打开的画布、Dive 下钻栈顶节点与当前选中节点。当用户在 Dive 视图或选中某节点直接下达口语指令时，即使 AI 省略 `assetId` 或 `nodeId`，`mcpTaskRunner.ts` 也会自动绑定到当前焦点节点并实时热更新内存宿主。
   - `formatNodeEditableSchemaSummary()` 按需将当前下钻或选中节点的完整可编辑路径、枚举值、简写键名与预设注入 AI 上下文窗口。

## 工业级工程产物交付与本地服务（Production Deliverable Exporters）

- **游戏 UI 16 类控件拆解与多引擎导出**
  - `src/shared/graph/uiControlSpec.ts`：定义 16 类标准 HTML5 / Unity UI Toolkit 控件语义（`button`、`toggle`、`slider`、`progress-bar`、`input-field`、`scroll-view`、`panel`、`modal-dialog`、`tab-bar`、`list-item`、`slot-grid`、`icon-badge`、`avatar-frame`、`tooltip-bubble`、`hud-bar`、`text-label`）、九宫格切线自适应估算、字芯颜色（`color`）与描边（`strokeColor` / `strokeWidth`）环带采样、`hover`/`active` 状态像素合成，以及本地 OCR 文本框回填匹配（`matchOcrBoxesToControlRect`）。
  - `src/main/services/localOcrService.ts`：跨平台零配置本地离线 OCR 服务（Windows WinRT `Windows.Media.Ocr.OcrEngine` / macOS `Vision.framework` `VNRecognizeTextRequest` / Linux `tesseract` TSV），将检测到的行与单词聚类为紧致文本包围盒。
  - `src/shared/psdExport.ts` & `src/renderer/src/features/graph/model/composeImageLayerStack.ts`：导出支持二级嵌套分组（`groupPath`）与原生 Photoshop `TySh` 可编辑文本图层的 `.psd` 文件。
  - `src/shared/graph/uiEngineExport.ts`：一键导出 Unity UI Toolkit（`.uxml` + `.uss`）、Unity UGUI（C# 组装脚本）、Godot 4（`.tscn`）与响应式 HTML5 工程代码包。
- **PNG 即工作流（`src/shared/pngWorkflowCodec.ts`）**：在 PNG `iTXt` 块（关键字 `aiae:graph`）无损嵌入/提取完整 `NodeGraphDocument` JSON，支持拖拽任意产出 PNG 到画布一键复现整条生成管线。
- **剪映 / CapCut 多轨草稿工程导出（`src/shared/timelineNleExport.ts`）**：将时间线的视频、画中画、配音、音乐、音效与字幕轨编译为微秒级精度的 `draft_content.json` 与 `draft_meta_info.json`，并归档本地媒体至 `materials/`。
- **零配置即刻体验示例工程（`src/main/services/demoProjectService.ts`）**：离线生成自包含的 4 镜赛博朋克短剧示例工程（含合成 SVG/PNG 分镜、BMP-to-MP4 预演视频、可运行节点图与完整多轨时间线）。

## 后续迁移

- [x] 资产、分镜和节点主要编辑路径已包装为 `EditorCommand`，支持合并与文档级 Undo/Redo。
- [x] Asset、Script、Panorama、Director、NodeGraph 编辑器已接入 `EditorDocumentService`。
- [x] NodeGraph 已分离 graph document model、命令/节点交互 controller、geometry/grid renderer 工具。
- [x] Workbench 已分离面板标题和动态编辑器打开服务；Graph 运行会话已迁入 controller。
- [x] 主进程已拆出 Asset、Project、Autosave 与原子 JSON Repository。
- [x] 已实现外部声明式插件发现、API/权限校验和设置页清单；出于安全考虑不执行任意外部脚本。
- [x] 已落地四支柱全工作区 AI 对话直控架构（运行时自省、智能深层补丁、焦点上下文注入与 3D 导演台全量指令操控）。
- [x] 已落地 16 类游戏 UI 控件拆层、跨平台离线 OCR、原生 `TySh` 可编辑 PSD 导出、Unity/Godot/HTML5 代码导出、PNG 隐写工作流与剪映草稿工程导出。

## 自动化验证

使用 Vitest 覆盖 Editor Kernel、Graph Document 与全工作区 AI 直控架构的关键不变量：

- 文档级 Undo/Redo 隔离与命令合并
- clean / dirty / saving 状态迁移
- 自动保存开关与延时
- Graph Document 深拷贝和原位替换
- 全量内置节点与动态新注册节点的零配置自省、深层点路径/JSON 透明补丁、预设联动与焦点感知注入（`tests/universalWorkspaceControl.test.ts`）
- 左窗全态感知与 3D 导演台全量场景/骨骼/灯光/镜头操控（`tests/leftWindowPerceptionAndDirectorMcp.test.ts`）
- 16 类 UI 控件拆解、跨平台离线 OCR 聚类/匹配、PSD `TySh` 文本层导出、PNG 隐写编解码与剪映草稿导出（`tests/imageLayerSplit.test.ts`、`tests/blockbusterFeatures.test.ts`）

运行：`npm test`
