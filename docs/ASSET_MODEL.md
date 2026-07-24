# AIArtEngine 资产管理（真实目录 + meta）

编辑器壳层借鉴 Unity；资产落盘自 **工程布局 version 2** 起对齐「真实目录 + 旁挂 meta」。

## 磁盘布局（version ≥ 2）

```text
Assets/
  Characters/
    .folder.json              # { id, name, parentId, ... }
    Hero.png
    Hero.png.asset.json       # AssetInfo，guid=id
  Scripts/
    .folder.json
    Opening.script.asset.json # 无媒体：meta 即主文件
```

| 概念 | 实现 |
|------|------|
| 身份 | `AssetInfo.id`（写在 meta 内） |
| 组织 | 真实子目录；树由扫描得到 |
| 文件夹 | 每目录 `.folder.json`（保留稳定 `folderId`） |
| 媒体 meta | `<file>.asset.json` |
| 文档资产 | `<Name>.<type>.asset.json` |

业务引用仍用 `assetId` / [AssetRef](./ASSET_REF.md)。仅支持本布局；旧版扁平工程需手动重建或另行转换。

## 删文件夹

- **删除目录（内容上移）**：子内容移到父目录后删除空目录（不丢资产）。
- **删除目录及内容**：永久删除子树内全部资产（脚本会级联删分镜），有外部引用时二次确认。

## 查找引用 / 删前确认

- `findAssetReferences`（IPC）：扫描其他资产的 `genParams`/文档树与分镜 JSON，收集对目标 GUID 的 [AssetRef](./ASSET_REF.md) 引用。
- 资产右键「查找引用」；删除时若存在外部引用则二次确认。
- 即将一并删除的资产之间的互相引用、以及所属脚本即将删除的分镜，不计入提示。

## 相关

- 扫描：`src/main/repositories/assetTreeStore.ts`
- 引用查找：`src/shared/assetReferences.ts`
- 资产包：[ASSET_PACKAGE.md](./ASSET_PACKAGE.md)
- 与 Unity 差异历史说明已收敛为本文件
