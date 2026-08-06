# 旧分镜（Shot）体系清理 TODO

> 用途：把旧「分镜 / 镜头」工作流的残留代码从仓库中彻底移除。当前仓库已处于可编译、测试全绿状态；本清单按依赖顺序分阶段执行，每阶段必须跑 `typecheck:node`、`typecheck:web` 与全量测试。

## 已完成（勿重复）

- 分镜节点类型全部删除：`script.shotSplit` / `script.shotTable` / `script.shotParams` / `script.shotImageGen` / `script.shotVideoGen`（注册、执行、角色、检查器、提示词、指令预设、i18n、默认图）。
- 分镜编辑器与入口删除：`ScriptEditor` / `ShotEditorBody` / `ShotTable` / `ShotStrip` / `ShotInspector` / `ShotParamsInspector` / `EditorDiveScriptTableView`；Dock 面板 `scriptEditor`、`useEditorPanelOpener` 的 script 定义、workspace 的 `openScriptEditor*`、StudioView 清理、草稿迁移分支。
- 工具栏 / 右键菜单移除「新建分镜」。
- 时间线已解耦：`collectScriptTimelineSources` 改为从宿主图 `output.video / output.timeline / asset.video` 收集素材，不再依赖镜头管线。
- 相关测试删除：`shotTableNodeRun.test.ts`、`graphShotParams.test.ts`、`seriesStarter.test.ts`、`seriesHostBoundaryInput.test.ts`；其余测试已同步更新。

## 剩余施工清单

### 阶段 1：NodeGraphEditor 收敛为纯资产模式

文件：`src/renderer/src/components/NodeGraphEditor.vue`

镜头模式与资产图共用同一份持久化链路，需先收敛：

- 镜头状态：`loadedGraphShotId`(1689)、`graphCache`(1691)、`savedShotCache`(1693)、`dirtyShotIds`(1695)、`shotDocumentDisposers`(1007)、`shotCanvasField`(887)、`scopedActiveShot`(1037)。
- 镜头文档：`shotDocumentId`(1009)、`ensureShotDocument`(1013)、`activeDocumentId`(1030)、`touchGraphCache`(1079)。
- 镜头读写：`resolveShotCanvasGraphRaw`(1085)、`readShotCanvasGraph`(1202)、`readGraphForShot`(1206)、`shotWithGraph`(1217)、`commitGraphLocal`(1233)、`loadGraphFromShot`(1357)、`resolveShotById`(1592)、`shotParamsSeedFromActiveShot`(1609)。
- 保存链路：`flushSaveToDisk`(3494)、`persistGraph`(3509)、`dirtyShotIds` 相关（3488–3529、3768–3770、7697–7707、7979–7999、7854–7860）。
- 镜头收集回调（runGraph 选项）：`resolveShotStoryboard`/`resolveAllShotBindingImages`(1843–1862)、`resolveShotSplitTableJson`/`importShotSplitTableJson`(1871–1887)、`collectScriptShotImages`/`collectScriptShotVideos`(1889–1945)。
- 镜头拖拽 / 参数节点：`STUDIO_SHOT_DRAG_MIME` 等(592–593)、`addShotParamsNodeFromShot`(4730)、`syncShotParamsNodeBindingOutputs`(4703)、`resolveShotTableBindingOverlay`(4669)、`resolveAllShotBindingImagesForScript`(4683–4708)。
- 任务目标：`kind: 'script-shot'`(2062)、`taskStore.enqueueScriptShotBatch`(1904、1934)。
- 导入清理：`useScopedScriptShots`(602、1035)、`applyShotSplitOnOpen`(622)、`shotVisualPipeline`(624–627)、`shotParams` 系列(715–783)、`getScopeShotCanvasField`(661)、domain `Shot` 相关(607–615)。

目标：`isAssetGraph` 恒真路径下编译通过；`activeDocumentId()` 恒为 `graph:asset:<id>`。

### 阶段 2：删除分镜渲染层剩余模块

- `src/renderer/src/composables/useScopedScriptShots.ts`
- `src/renderer/src/features/script/applyShotSplitOnOpen.ts`
- `src/renderer/src/features/script/readShotTableWorldOutputs.ts`
- `src/renderer/src/features/script/shotVisualPipeline.ts`
- `src/renderer/src/components/CanvasEditor.vue`：移除 `useScopedScriptShots` 引用（126、158、373）。
- `src/renderer/src/stores/graphTasks.ts`：移除 `enqueueScriptShotBatch`(715)、`script-shot` 任务类型(98、746)、`applyVisualGraphGenRefsToShot`/`shotNeeds*`(67–70、654、734)。
- `src/renderer/src/stores/project.ts`：移除 `shots` / `activeShot` / `refreshShots` / `persistShot*` / `syncShotSelection`（21–29、49–69、122–160）。
- 检查器：`ShotNodeInspector` / `ShotNoteInspector` / `ShotGenRefsEditor` / `ShotStagingPresetPicker` 及其注册。

### 阶段 3：删除数据模型 / 仓库 / IPC / 测试

- `src/shared/domain.ts`：`Shot`(529)、`ShotStoryboard`(210)、`ShotGenRef`(237)、`ShotAudioRef`(249)、`ShotStatus`(115)、`ShotReviewStatus`(118–120)、`SHOT_SIZE_OPTIONS`(130)、`isDraftShotId`(496)、`isStoryboardScript`(1900)、`shotScriptAssetId`(1909)、`createEmptyStoryboard`(1983)、`normalizeStoryboard`(2018) 等。
- `src/main/repositories/shotRepository.ts`（整文件）。
- `src/main/services/projectService.ts`：Shots 区块（998 起）、`createShot`/`updateShot`/`deleteShot`/`reorderShots`/`syncScriptShots`、`appendShotToScript`(456)、`removeShotFromScript`(466)、`deleteAsset` 内镜头清理(484–487)、`createAsset('script')` 自动建镜(449)、`ProjectConfig.shotIds`(217、391)。
- `src/shared/ipc.ts` / `src/main/ipc.ts` / `src/preload/index.ts`：`SHOT_LIST/GET/CREATE/UPDATE/DELETE/REORDER/SYNC_SCRIPT` 通道、`CreateShotInput`、`SyncScriptShotsInput`、`StudioApi.listShots/getShot/createShot/updateShot/deleteShot/reorderShots/syncScriptShots`、`saveCanvasPng`。
- 共享图模块：`shotSplitParse.ts`、`shotParams.ts`、`shotStagingPresets.ts`、`shotVisualBridge.ts`、`shotVideoBridge.ts`、`shotEntitiesParse.ts`、`shotEntities.select` 节点（与 `GraphPortType.shotEntities` 一并评估）。
- 测试：删除 `applyShotSplitOnOpen` / `shotSplitParse` / `shotStagingPresets` / `shotTableWorldBind` / `shotVisualBridge` / `shotVideoBridge` / `shotVisualCollect` / `shotEntitiesSelectExecute` / `shotEntityImageUrls` / `shotRefMentionOptions` / `graphScriptAsset`；更新 `graphPorts` / `graphLock` / `graphScopes` / `graphTextOutput` / `boundaryInputAutoLink` / `beatSelectExecute` / `assetEditorGraph` 中的剩余镜头断言。

## 验证

每阶段结束：

```bash
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false
node node_modules/vue-tsc/bin/vue-tsc.js --noEmit -p tsconfig.web.json --composite false
node node_modules/vitest/vitest.mjs run
```

全量通过后再进入下一阶段。
