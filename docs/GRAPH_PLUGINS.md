# 节点图插件开发指南

本文说明如何为 AIArtEngine 内部扩展贡献**节点类型**、**画布作用域（Scope）**、**图策略（Policy）**、**卡片**与**检查器**。

相关代码：

| 模块 | 路径 |
|------|------|
| 节点类型注册 | `src/shared/graph/registry.ts` |
| 画布 Scope | `src/shared/graph/scopes.ts` |
| 图策略（可添加节点 + 连线） | `src/shared/graph/policy/`、`default.graph-policy.json` |
| 图规范化 | `src/shared/graph/normalize.ts` |
| 卡片注册 | `src/renderer/src/graph/cards/registry.ts` |
| 检查器注册 | `src/renderer/src/inspector/registry.ts` |
| 扩展入口 | `src/renderer/src/editor/extensions/registry.ts` |

## 概念

### 节点角色

统一使用 `asset.*` 类型：

| 角色 | 标记 | 说明 |
|------|------|------|
| 资产引用 | `params.assetRef === true` | 从资产库拖入，仅输出 |
| 加工节点 | 无 `assetId`、无 `assetRef` | 右键菜单添加，有输入/输出 |

### 画布 Scope

内置 Scope：`workflow`、`shotWorkflow`、`visual`、`screenplayAsset`、`directorAsset`、`scriptAsset`。  
插件可注册自定义 Scope id（如 `plugin.myCanvas`）。

Scope 配置项（`GraphScopeDefinition`）：

- `persistNode` — 加载时过滤非法节点
- `output` — 默认/校正输出节点
- `coerceOutput` — 是否强制校正已有输出
- 默认节点拓扑见 `DEFAULT_GRAPH_TEMPLATES`（`defaultGraph.ts`），不再用单例列表硬编码连线
- `createParams` — 右键添加节点时的额外 `params`
- `dragAssets` — 拖入资产白名单（见下文）
- `shotCanvasField` — 分镜 `Shot.canvas` 上图 JSON 字段（默认 `graphJson`；`visual` 为 `visualGraphJson`）
- `hostIdSuffix` — 分镜内多画布时 `graphHostId` 后缀（如 `visual` → `script:…:visual`）

宿主解析：`resolveGraphScope({ assetId, assetType, purpose })`  
资产类型绑定：`registerGraphScopeHost({ assetType, scope, priority })`  
分镜持久化：`getScopeShotCanvasField(scope)` / `getScopeHostIdSuffix(scope)`

### 图策略（Policy）与端口连线

内置文件 [`src/shared/graph/policy/default.graph-policy.json`](../src/shared/graph/policy/default.graph-policy.json) 现主要提供：

1. **可添加节点白名单**（`addableNodeTypes`）

连线规则与策略无关：

1. 源节点有输出端口、目标节点有输入端口
2. **两端 `dataType` 严格相等**（见 `GraphPortType`：`image` / `images` / `voice` / `voices` / `video` / `videos` / `text` / `texts` / `world` / `beat` / `shots` / `model`）。目录 JSON 使用 `world` / `beat` / `shots`，不可与 `text` 互通。

端口上会显示类型名。需要接多种上游的节点应声明多个输入口（如导演台编辑：`in-text` / `in-model` / `in-image`）。导演台编辑另有方形输出口 `out-shots`（`images`，站位截图）与 `out-actions`（`videos`，动作录制）。

内置 scope 的 `addableNodeTypes` 均为 `["*"]`。插件可通过 manifest 的 `graphPolicy` 合并可添加节点白名单；卸载扩展时覆盖层自动移除。

### 能力缝（定义 / 提供商 / 消费）

节点图是唯一执行引擎。一种生成能力只在一处实现，节点只消费：

| 层 | 含义 | 代码 |
|---|---|---|
| 定义 | `typeId` + `ports` + `execute` | `registerNodeType` / `NodeTypeDefinition` |
| 提供商 | 文本 / 图 / 视频 / 语音生成 | `NodeExecuteContext.generateText` / `generateImage` / `generateVideo` |
| 消费 | 边两端 `dataType` 严格相等 | 现有 port policy |

新节点继续 `registerNodeType`。`execute` **必须**走已注入的 `generate*` 适配器，禁止在 execute 里直连 HTTP。P0 不重写 `builtins.ts` 执行表。

角色提示词（系统提示 + 指令 + 可选解析指针）走 `GraphSkill`（`src/shared/graph/graphSkills.ts`），用节点 `params.skillId` 绑定，**不要**按 `typeId` 绑死（同一 `asset.image` 可扮演九宫格、四宫格、立绘）。检查器插入片段仍用 `instructionPresets`，与 Skill 目录分开。扩展注册额外 Skill 的插件面预留 `registerGraphSkill`，完整 manifest 字段后续再加。

有意的现状（不是漏做）：

- **没有 `NodeTypeDefinition.defaultSkillKind`**：已被 `params.skillId` 替代。`asset.image` 等多角色类型不能按 typeId 绑死默认 Skill。
- **`applyGraphSkill` 是快照，不是引用**：写入当时的指令/系统提示；之后改 Skill 目录或改节点文案，互不自动跟随。执行层只读 `generateInstruction` / `generateSystemPrompt`。
- **`system.*` 不在运行时兜底**：目录镜像 `systemPromptSchemes` 的默认文案，供套预设时烤入。未绑 `skillId` 的节点仍走 `resolve*`。若改成「空文案则按 skillId 引用 Skill」，等于另做引用语义，需单独拍板，P0 不做。

## 最小扩展示例

```ts
import { activateExtension, registerExtensionManifest } from '@/editor/extensions/registry'
import MyNodeInspector from './MyNodeInspector.vue'
import MyNodeCard from './MyNodeCard.vue'
import { executePassthrough } from '@shared/graph'

registerExtensionManifest({
  id: 'example.graph',
  version: '1.0.0',
  apiVersion: 1,
  displayName: 'Example Graph',
  nodeTypes: [{
    typeId: 'plugin.custom',
    category: 'note',
    label: 'Custom',
    defaultTitle: 'Custom',
    defaultSize: { w: 200, h: 120 },
    sizeLimits: { minW: 120, minH: 80, maxW: 400, maxH: 300 },
    ports: [{ id: 'out', direction: 'out', dataType: 'text', multiple: true }],
    defaultParams: () => ({ text: '…' }),
    addable: true,
    inspector: 'note',
    inspectorId: 'plugin.custom.inspector',
    card: 'note',
    cardId: 'plugin.custom.card',
    execute: executePassthrough
  }],
  graphScopes: [{
    id: 'plugin.customCanvas',
    output: { kind: 'image', title: 'Custom output' },
    dragAssets: { allowTypes: ['image'] }
  }],
  graphScopeHosts: [{
    assetType: 'model',
    scope: 'plugin.customCanvas',
    priority: 200
  }],
  graphPolicy: {
    scopes: {
      'plugin.customCanvas': {
        addableNodeTypes: ['plugin.custom', 'note.text', 'play.script']
      }
    }
  },
  inspectors: [{
    id: 'plugin.custom.inspector',
    nodeTypeId: 'plugin.custom',
    component: MyNodeInspector
  }],
  activate(ctx) {
    ctx.registerGraphCard({
      id: 'plugin.custom.card',
      order: 5,
      match: (_node, typeDef) => typeDef?.typeId === 'plugin.custom',
      component: MyNodeCard
    })
  }
})

activateExtension('example.graph')
```

## 节点类型字段

| 字段 | 说明 |
|------|------|
| `typeId` | 唯一 id，建议 `plugin.*` 前缀 |
| `addable` | 全局是否可添加；具体出现在哪些画布由 `graphPolicy.addableNodeTypes` 决定 |
| `inspector` / `inspectorId` | 检查器种类或显式绑定 |
| `card` / `cardId` | 卡片种类（`note`/`media`）或显式绑定 |
| `presentation` | 备注类卡片 i18n 键（`badgeKey` 等） |
| `execute` | 节点执行器；缺省透传 |

默认检查器解析见 `src/renderer/src/inspector/defaults.ts`。  
默认卡片 id：`studio.graph.note` / `studio.graph.media`。

## 拖入资产规则

`dragAssets` 配置：

```ts
dragAssets: {
  enabled: false,                    // 禁止一切拖入
  allowTypes: ['screenplay'],        // 白名单
  allowTypes: 'all',                 // 允许全部（可配合 denyTypes）
  denyTypes: ['script']              // 黑名单
}
```

判断 API：`canScopeAcceptDraggedAsset(scope, assetType)`

内置规则：

| Scope | 拖入 |
|-------|------|
| 所有内置 Scope | 允许全部资产；资产编辑器仍拒绝拖入当前正在编辑的资产自身 |

## 连线

1. 源节点须有输出端口、目标节点须有输入端口（结构检查，`getNodePorts`）
2. **两端端口 `dataType` 严格相等**（无通配；目录 JSON 为 `world` / `beat` / `shots`）

API：`canConnectNodes(source, target, { sourcePort?, targetPort? })`。多输入口时需指定 `targetPort`（或由 `findCompatibleInPort` 按类型自动匹配）。

文本类上游（如 `play.script`）只能连到 `text` 输入口；执行时文本合并到节点 `notes`。

## 检查器匹配

声明式字段（`InspectorDefinition`）：

- `nodeTypeId` — 精确匹配
- `nodeInspectorKind` + `nodeAssetRef` — 按种类匹配（资产引用/加工）

## 子组件读取 Scope

```ts
import { useGraphScope } from '@/composables/useGraphScope'

const graphScope = useGraphScope()
const scopeDef = getGraphScopeDefinition(graphScope.value)
```

由 `NodeGraphEditor` 通过 `provide('graphScope')` 注入。  
分镜内多画布请传入 `scope` prop（如 `shotWorkflow` / `visual`）。

## 图数据

加载时经 `normalizeScopedGraph()` 规范化（`src/shared/graph/normalize.ts`）。  
不再维护独立的 `typeId` 迁移层；持久化数据应直接使用当前 `asset.*` 等内置 id。

## 示例模板

仓库内 `examples/graph-extension/` 提供 manifest 说明；**可运行演示**在 `src/renderer/src/editor/extensions/graphDemo/`，应用启动时自动加载。

## 测试

- `tests/graphScopes.test.ts` — Scope、宿主、拖入白名单
- `tests/graphPolicy.test.ts` — 图策略加载、通配、合并
- `tests/graphCards.test.ts` — 卡片注册表解析（`cardId` / `card` 种类）
- `tests/graphPorts.test.ts` — 连线
- `tests/graphSkills.test.ts` — GraphSkill 目录与 `params.skillId`
- `tests/inspectorMatch.test.ts` / `inspectorDefaults.test.ts` — 检查器

运行：`npm test`（`vitest.config.ts` 已配置 `@shared` 别名）
