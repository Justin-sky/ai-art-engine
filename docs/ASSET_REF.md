# 统一资产 GUID 引用（AssetRef）

对标 Unity「同一套 GUID 序列化」的轻量实现：不自研完整序列化器，而是约定引用形态，使 `collect` / `remap` 可机械遍历。

## 落盘形态

推荐：

```json
{ "$type": "AssetRef", "guid": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }
```

兼容：

- 已知字段名上的裸 UUID 字符串（如 `assetId`、`modelAssetId`）
- `{ "guid": "<uuid>" }`（仅含 guid 一键）

字段名白名单见 `LEGACY_ASSET_REF_KEYS`（`src/shared/assetRef.ts`）。  
**不会**把 `shotIds`、`selectedImageId`、`folderId`、普通文本里的 UUID 当成引用。

## API

| 函数 | 作用 |
|------|------|
| `tagAssetRef` / `readAssetGuid` | 构造与读取 |
| `collectAssetGuids` | 收集值树中全部资产 GUID |
| `remapAssetGuids` | 按映射表重写引用 |
| `upgradeLegacyAssetRefs` | 裸字符串 → TaggedAssetRef（规范化） |
| `syncNodeAssetRefFields` | Graph 节点 `assetId` ↔ `assetRef` 同步 |

## Graph

- `GraphNode.assetId`：内存主字段（兼容现有 UI/执行）
- `GraphNode.assetRef`：统一引用形态；`normalizeGraph` / `createAssetGraphNode` 会双写

## 与资产包

`.aipackage` 导入冲突 remap 使用 `remapAssetGuids`；依赖收集使用 `collectAssetGuids`（同时识别 TaggedAssetRef 与已知字段上的裸 GUID）。

新功能写入工程资产引用时，优先 `tagAssetRef(guid)` 或双写 `assetId` + `assetRef`。
