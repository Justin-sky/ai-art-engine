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

| 概念      | 实现                                         |
| --------- | -------------------------------------------- |
| 身份      | `AssetInfo.id`（写在 meta 内）               |
| 组织      | 真实子目录；树由扫描得到                     |
| 文件夹    | 每目录 `.folder.json`（保留稳定 `folderId`） |
| 媒体 meta | `<file>.asset.json`                          |
| 文档资产  | `<Name>.<type>.asset.json`                   |

业务引用仍用 `assetId` / [AssetRef](./ASSET_REF.md)。仅支持本布局；旧版扁平工程需手动重建或另行转换。

## 导入

- **拖入文件**：图片 / 视频 / 声音 / 模型 / 剧本文本按扩展名判定类型，复制进资产库并写 meta。
- **拖入文件夹**：递归收集目录内支持的媒体文件，并**按源目录结构镜像**出资产目录 —— 顶层用被拖入目录的名字，子目录逐层对应；同父目录下已有同名目录时直接复用（重复拖入同一目录是合并，不会再长出「名称 2」），子目录按需创建（目录里没有可导入文件就不会落成空目录）。
  - 隐藏项（`.` 开头，含 `.asset.json` / `.folder.json` 等 meta）与符号链接一律忽略；单次上限 2000 个文件、32 层深度，命中上限时只导入前 2000 个并在结果里提示。
  - 目录内的 `.aipackage` 资产包**不在**本链路处理（导入包要逐个勾选条目），只在结果里计数提示，需要单独拖入。
- 落点：拖到目录行上导入该目录，拖在空白处导入当前目录。
- **进度条**：拖入目录后资产库内浮层显示进度（已处理 / 总数 + 当前文件），扫描阶段先显示「正在统计待导入文件」。进度由主进程按作业 id 推 `ASSET_IMPORT_PROGRESS` 事件；导入两趟走（先 `planAssetImport` 扫出分母，再逐文件导入），每个文件之间让出事件循环，上千个文件也不会把主进程和界面一起冻住。

## 删文件夹

- **删除目录（内容上移）**：子内容移到父目录后删除空目录（不丢资产）。
- **删除目录及内容**：永久删除子树内全部资产（脚本会级联删分镜），有外部引用时二次确认。

## 查找引用 / 删前确认

- `findAssetReferences`（IPC）：扫描其他资产的 `genParams`/文档树与分镜 JSON，收集对目标 GUID 的 [AssetRef](./ASSET_REF.md) 引用。
- 资产右键「查找引用」；删除时若存在外部引用则二次确认。
- 即将一并删除的资产之间的互相引用、以及所属脚本即将删除的分镜，不计入提示。

## 相关

- 扫描：`src/main/repositories/assetTreeStore.ts`
- 拖入文件 / 目录导入：`src/main/services/assetImportService.ts`
- 引用查找：`src/shared/assetReferences.ts`
- 资产包：[ASSET_PACKAGE.md](./ASSET_PACKAGE.md)
- 与 Unity 差异历史说明已收敛为本文件
