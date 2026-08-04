# 资产包 `.aipackage`

对标 Unity `.unitypackage` 的跨工程素材包：ZIP + GUID 目录 + `pathname` / `asset` / `asset.meta`。

## 能力

- 导出选中资产或文件夹子树（含祖先文件夹）
- 类型：image / video / audio / model / panorama / **script** / canvas / screenplay / motion
- 脚本工作流：导出时把 `Storyboard/shots` 快照写入 `asset.meta.shots`；导入时还原分镜并登记 `project.shotIds`
- `includeDependencies`：经 [AssetRef](./ASSET_REF.md) 收集 `genParams` **与脚本分镜**内引用
- `includeGeneratedOutputs`（导出可选，默认关）：收集所选资产 `genParams` / 分镜中的 `relativePath`，打包 `Cache/*`、历史 `Output/*`、`.aiartengine/graph-outputs/*` 等到包内 `generated/`；导入时按原相对路径还原（已存在则跳过）
- **Unity 式勾选树**：导出/导入前弹出目录列表，可全选、全不选、按项勾选（文件夹联动子项）
- 导入：无冲突保留 GUID；内容相同则复用；冲突则 remap（不覆盖）
- UI：右键导出/导入；将 `.aipackage` 拖入资产列表 → 预览勾选后导入
- 导入落盘：真实目录树（与工程 Assets 布局 version 2 一致）

## 非目标（后续）

- 强制覆盖、UPM 升级
- 分镜缩略图（`.aiartengine/thumbs`）一并打包

## 关键代码

- `src/shared/assetPackage/`（含 `tree.ts`）
- `src/main/services/assetPackageService.ts`
- `src/main/repositories/assetPackageArchive.ts`
- `src/renderer/src/components/AssetPackageTreeDialog.vue`
