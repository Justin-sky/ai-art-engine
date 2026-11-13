# 节点图插件与扩展开发指南（v9.0.0）

本文说明如何基于 Cordis 运行时为 AI Art Engine 开发与扩展**节点类型（`NodeTypeDefinition`）**、**画布作用域（Scope）**、**图策略（Policy）**、**画布卡片（Card）**、**属性检查器（Inspector）**与**节点原生能力（`NodeCapabilityDef`）**。用户侧连线与节点手册见官网 [工作流与节点图手册](https://justin-sky.github.io/ai-art-engine/manual-workflow.html#graph)。

---

## 1. 核心代码映射

| 模块                | 代码路径                                                                                                  | 说明                                                       |
| ------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| 节点类型注册表      | `src/shared/graph/registry.ts`、`src/shared/graph/builtins.ts`                                            | 内置节点定义、端口声明与类型查询                           |
| 节点原生能力目录    | `src/shared/graph/nodeCapabilities.ts`                                                                    | 默认系统提示词、指令模板、用法说明与覆盖栈                 |
| 自省与深层智能补丁  | `src/shared/graph/introspection.ts`、`src/shared/graph/smartPatch.ts`                                     | 零配置向 AI 暴露参数 Schema 并支持点路径/简写补丁          |
| 画布 Scope          | `src/shared/graph/scopes.ts`、`src/shared/graph/defaultGraph.ts`                                          | 多宿主画布作用域、默认拓扑模板与拖入规则                   |
| 图策略与端口校验    | `src/shared/graph/policy/`、`src/shared/graph/ports.ts`                                                   | `default.graph-policy.json` 可添加节点白名单与严格类型连线 |
| 图规范化            | `src/shared/graph/normalize.ts`                                                                           | 加载时 `normalizeScopedGraph()` 结构与边界修复             |
| 右键菜单分组与画布  | `src/renderer/src/components/NodeGraphEditor.vue`、`src/renderer/src/features/graph/contextMenuGroups.ts` | 右键可添加节点分组、图标去重与影视流水线平铺分组           |
| 画布卡片注册        | `src/renderer/src/graph/cards/registry.ts`                                                                | `note` / `media` 默认壳与自定义节点卡片匹配                |
| 属性检查器注册      | `src/renderer/src/inspector/registry.ts`、`src/renderer/src/inspector/defaults.ts`                        | 声明式 Inspector 绑定与回退解析                            |
| Cordis 编辑器运行时 | `src/renderer/src/editor/runtime/`                                                                        | `Context` + `EditorHub` 插件生命周期与热卸载回滚           |

---

## 2. 核心概念与命名规范

### 2.1 `v9.0.0` 常用内置节点命名空间

扩展或编排节点时，建议对齐现有领域前缀（第三方或实验扩展统一使用 `plugin.*` 前缀）：

| 命名空间前缀              | 代表内置节点 `typeId`                                                                                        | 领域职责                                                                     |
| ------------------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| `asset.*`                 | `asset.image`、`asset.video`、`asset.voice`、`asset.model`、`asset.spatialWorld`                             | 多模态生成节点与工程资产引用节点（通过 `params.assetRef === true` 区分）     |
| `film.*`                  | `film.workbench`、`film.breakdown`、`film.cast`、`film.shot`、`film.render`、`film.review`                   | 21 流派 5 阶 AI 漫剧与影视制片流水线                                         |
| `semantic.*`              | `semantic.analyze`、`semantic.rebuild`                                                                       | 取证级爆款视频拆解与跨主体复刻双节点（`rea-video`）                          |
| `image.*`                 | `image.portrait`、`image.layerSplit`、`image.lighting`、`image.multiAngle`、`image.emotion`、`image.process` | 4 频段小波人像精修、16 类游戏 UI/通用拆层、打光/多机位/10 合 1 图像加工      |
| `ui.*`                    | `ui.atlasCompose`                                                                                            | 多控件散图打包 Sprite 纹理图集、九宫格导出与 PSD `TySh` / Unity / Godot 组装 |
| `game.*`                  | `game.economy`                                                                                               | Machinations v2 游戏经济系统建模、Monte Carlo 仿真与反推求解工作台           |
| `stage.*` / `director.*`  | `stage.2d`、`director.stage`                                                                                 | 2D Spine 立绘拆件绑骨舞台、3D 导演台 56 骨站位/灯光/运镜预演                 |
| `novel.*` / `script.*`    | `novel.outline`、`script.run`                                                                                | 长篇网文/剧本结构拆解、QuickJS 沙箱脚本计算节点                              |
| `decisions.*` / `media.*` | `decisions.judge`、`media.review`、`media.rework`                                                            | 结构化概率判定、多维媒体质检与自动返工闭环                                   |
| `output.*`                | `output.timeline`、`output.image`、`output.video`、`output.director`                                         | 6 轨非线性剪辑成片时间线（含剪映草稿导出）与各画布宿主输出槽                 |
| `plugin.*`                | `plugin.custom`                                                                                              | 内部实验或外部 Cordis 插件自定义节点命名空间                                 |

### 2.2 节点角色（资产引用 vs 加工生成）

| 角色                | 判定标记                    | 行为说明                                                           |
| ------------------- | --------------------------- | ------------------------------------------------------------------ |
| **资产引用节点**    | `params.assetRef === true`  | 从左侧资产库拖入画布，仅暴露输出端口供下游消费                     |
| **加工 / 生成节点** | 无 `assetId`、无 `assetRef` | 从画布右键菜单或 `graph_edit` 添加，兼具输入端口、参数面板与执行器 |

### 2.3 `category` ≠ `card`（高频易错点）

`category` 仅有三档：`asset` / `output` / `note`。**除资产节点与输出槽外，几乎所有加工/工作台/语义工具节点都必须声明 `category: 'note'`**（代表「非资产引用、非输出槽」）。

而 `card` 决定画布渲染哪套卡片外壳及双击行为，切勿把 `category: 'note'` 机械抄成 `card: 'note'`：

| 节点场景                         | `category` | `card`        | 画布表现与参考节点                                                                                                   |
| -------------------------------- | ---------- | ------------- | -------------------------------------------------------------------------------------------------------------------- |
| 纯文本记事本 / 剧本便签          | `'note'`   | `'note'`      | `GraphNoteCard`，双击打开文本编辑（如 `note.text`）                                                                  |
| 图像/视频/UI/语义/数值等工具节点 | `'note'`   | **`'media'`** | 标准媒体/工具壳，支持预览缩略图、运行态角标与 Dive 下钻（如 `image.layerSplit`、`semantic.analyze`、`game.economy`） |
| 多模态生成与资产引用节点         | `'asset'`  | `'media'`     | `asset.image`、`asset.video`、`asset.model` 等                                                                       |

新增内置可添加节点后，还需同步完成三步：

1. 在 `src/renderer/src/components/NodeGraphEditor.vue` 的 `CONTEXT_MENU_RESOURCE_GROUPS` 登记所属菜单分组（分组图标与影视分组平铺逻辑见 `src/renderer/src/features/graph/contextMenuGroups.ts`）。
2. 在中英文语言包（`src/renderer/src/i18n/locales/zh-CN.ts` 与 `en-US.ts`）补齐 `graph.types.<typeId>`。
3. 运行 `npm test -- tests/graphAddableNodeChrome.test.ts tests/contextMenuGroups.test.ts` 验证菜单分组、图标与多语言完整性。

---

## 3. 画布作用域（Scope）、图策略（Policy）与能力缝

### 3.1 画布 Scope（`src/shared/graph/scopes.ts`）

内置 Scope 包括：`workflow`、`shotWorkflow`、`visual`、`screenplayAsset`、`directorAsset`、`scriptAsset`；插件可通过 `ctx.editor.graphScope(...)` 注册自定义作用域（如 `plugin.myCanvas`）。

`GraphScopeDefinition` 关键配置项：

- `persistNode`：加载与规范化时过滤当前作用域不允许持久化的节点。
- `output` / `coerceOutput`：声明或强制校正当前画布的输出槽节点；新建画布的默认拓扑定义在 `src/shared/graph/defaultGraph.ts`（`DEFAULT_GRAPH_TEMPLATES`）。
- `createParams`：右键菜单创建节点时附加的默认 `params`。
- `dragAssets`：控制允许拖入当前画布的资产类型白名单/黑名单（`canScopeAcceptDraggedAsset(scope, assetType)`）。
- `shotCanvasField` / `hostIdSuffix`：分镜内多画布持久化字段与宿主后缀映射。

### 3.2 图策略与严格端口连线（`src/shared/graph/ports.ts`）

内置策略文件 [`src/shared/graph/policy/default.graph-policy.json`](../src/shared/graph/policy/default.graph-policy.json) 定义各 Scope 的 `addableNodeTypes`（内置画布默认为 `["*"]`，插件可通过 `ctx.editor.graphPolicy(id, partial)` 局部覆盖并在卸载时自动回滚）。

端口连线遵循**严格类型相等契约**（`canConnectNodes` / `portsCompatible`）：

1. 源节点具备输出端口（`direction: 'out'`），目标节点具备输入端口（`direction: 'in'`）。
2. **两端 `dataType` 必须完全一致**：单数与复数绝不互通（`image` 不能连入 `images`，`text` 不能连入 `texts`；集合汇聚/筛选走专用列表端口），领域专用口（`world` / `beat` / `shots`）不与 `text` 混连。
3. 需要接收多种模态输入的节点应显式声明多输入口（例如 `director.stage` 同时提供 `in-text`、`in-model`、`in-image`，并输出 `out-shots` 与 `out-actions`）。

### 3.3 能力缝（定义 / 提供商 / 消费）与 `NodeCapabilityDef`

节点图是唯一执行引擎，生成与推理能力严禁在节点 `execute` 内硬编码直连 HTTP，必须走 `NodeExecuteContext` 注入的统一适配器：

| 层次             | 职责                                                     | 核心接口与代码                                                                                 |
| ---------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| **节点定义层**   | 声明 `typeId`、`ports`、`defaultParams` 与默认 `execute` | `registerNodeType`（`src/shared/graph/registry.ts`）                                           |
| **能力提供商层** | 文本 / 图像 / 视频 / 语音 / 3D / 概率决策生成            | `NodeExecuteContext.generateText` / `generateImage` / `generateVideo` / `generateDecisions` 等 |
| **执行器覆盖栈** | 插件按 `typeId` 替换或增强执行逻辑，卸载自动回退         | `ctx.editor.executor(typeId, fn)`（`src/shared/graph/execute/registry.ts`）                    |
| **原生能力目录** | 节点系统提示词、指令预设与输入绑定说明                   | `NodeCapabilityDef`（`src/shared/graph/nodeCapabilities.ts`），由 MCP `graph_node_types` 暴露  |

> **结构化结果落参惯例**：像 `decisions.judge`（完整各档概率写入 `node.params.decisionVerdicts`）、`image.layerSplit`（图层清单与控件树写入节点参数）与 `media.review`（质检状态写入 `mediaReviewStatus`）一样，供 Inspector 与 Dive 工作台消费的结构化元数据应保存在节点 `params` 中，端口保持干净的标准媒体/文本流。

---

## 4. 零配置 AI 对话自省与深层智能补丁

任何通过 `registerNodeType` 或 `ctx.editor.nodeType` 注册的节点，**无需手写额外 MCP 工具胶水代码**，即可自动获得全工作区 AI 对话直控能力：

1. **运行时参数反射（`src/shared/graph/introspection.ts`）**：自动从 `defaultParams()` 提取字段树 `fields`、点路径 `flatPaths`（如 `simConfig.iterations`）与无歧义简写映射 `shorthandMap`；用户选中或双击 Dive 进入该节点时，`src/renderer/src/editor/control/surfaceRegistry.ts` 会将其实时 Schema 注入 Agent 焦点上下文，外部 Agent 也可通过 `graph_node_types` 查询。
2. **深层非破坏补丁（`src/shared/graph/smartPatch.ts`）**：AI 调用 `graph_edit` 传入点路径、顶层简写或 `snake_case` 字段名时，`mergeSmartNodeParams` 会精准合并至目标嵌套属性，完整保留同级其余配置。

---

## 5. 最小完整 Cordis 插件示例

```ts
import type { Context } from '@cordisjs/core'
import { executePassthrough } from '@shared/graph'
import MyNodeInspector from './MyNodeInspector.vue'
import MyNodeCard from './MyNodeCard.vue'

export const name = 'example.graph'
export const inject = ['kernel', 'editor']

export function apply(ctx: Context): void {
  ctx.editor.nodeType({
    typeId: 'plugin.custom',
    category: 'note',
    label: 'Custom Tool',
    defaultTitle: 'Custom Tool',
    defaultSize: { w: 240, h: 160 },
    sizeLimits: { minW: 160, minH: 120, maxW: 480, maxH: 360 },
    ports: [
      { id: 'in', direction: 'in', dataType: 'image', multiple: false },
      { id: 'out', direction: 'out', dataType: 'image', multiple: true }
    ],
    defaultParams: () => ({
      customConfig: { intensity: 65, mode: 'vivid' }
    }),
    presets: [{ id: 'soft', label: '柔和档', description: '降低对比度与边缘锐度' }],
    addable: true,
    inspector: 'note',
    inspectorId: 'plugin.custom.inspector',
    card: 'media',
    cardId: 'plugin.custom.card',
    execute: executePassthrough
  })

  ctx.editor.nodeCapability({
    id: 'plugin.custom.cap',
    kind: 'system',
    titleZh: '自定义图像滤镜',
    titleEn: 'Custom Image Filter',
    instructionZh: '根据输入图像执行自定义风格化处理……',
    instructionEn: 'Apply custom stylization to the input image...'
  })

  ctx.editor.graphScope({
    id: 'plugin.customCanvas',
    output: { kind: 'image', title: 'Custom Output' },
    dragAssets: { allowTypes: ['image'] }
  })

  ctx.editor.graphPolicy(name, {
    scopes: {
      'plugin.customCanvas': {
        addableNodeTypes: ['plugin.custom', 'asset.image', 'note.text']
      }
    }
  })

  ctx.editor.inspector({
    id: 'plugin.custom.inspector',
    nodeTypeId: 'plugin.custom',
    component: MyNodeInspector
  })

  ctx.editor.graphCard({
    id: 'plugin.custom.card',
    order: 5,
    match: (_node, typeDef) => typeDef?.typeId === 'plugin.custom',
    component: MyNodeCard
  })
}
```

仓库内参考骨架与演示：

- 独立插件最小模板：[`examples/graph-extension/`](../examples/graph-extension/README.md)
- 应用内可运行演示扩展：`src/renderer/src/editor/extensions/graphDemo/`（正式安装包默认不挂载，本地调试可调用 `registerGraphDemoExtension()`；销毁 `fork.dispose()` 自动回滚全部节点、策略、卡片与能力覆盖）

---

## 6. 回归测试清单

修改或新增节点插件机制后，请运行以下 Vitest 套件（`npm test`）：

- `tests/graphScopes.test.ts` — 画布 Scope、宿主绑定与拖入资产白名单
- `tests/graphPolicy.test.ts` — 图策略加载、通配符匹配与插件覆盖回滚
- `tests/graphCards.test.ts` — 画布卡片注册表解析（`cardId` 与 `card` 种类优先级）
- `tests/graphPorts.test.ts` — 端口严格类型相等与多输入口自动匹配
- `tests/graphSkills.test.ts`、`tests/graphCapabilitySeams.test.ts` — `NodeCapabilityDef` 节点原生能力目录、预设应用与覆盖栈回滚
- `tests/graphExecutorRegistry.test.ts` — 节点执行器覆盖栈与默认回退
- `tests/cordisEditor.test.ts` — Cordis `nodeType` / `executor` / `nodeCapability` 生命周期注册与回滚
- `tests/graphAddableNodeChrome.test.ts`、`tests/contextMenuGroups.test.ts` — 可添加节点的菜单分组、图标去重与多语言检查
- `tests/inspectorMatch.test.ts`、`tests/inspectorDefaults.test.ts` — 属性检查器精确与按类匹配
- `tests/universalWorkspaceControl.test.ts` — 新注册节点零配置自省、深层点路径/简写补丁与焦点上下文注入
