# 人像处理节点（`image.portrait`）

> 面向开发者。用户视角见官网手册（`website/manual.html` 的「图片修改」一节）。
> 一句话：**只有一条执行路径 —— 参数规格表 → 提示词 → 图片模型**；本地只保留模型做不可靠的
> **像素对齐**（证件照规格裁切 + 相纸拼版）与模型接口没有的**蒙版限制**（局部回贴）。

相关代码：

| 层           | 文件                                                                                       |
| ------------ | ------------------------------------------------------------------------------------------ |
| 参数契约     | `src/shared/graph/portraitRetouch.ts`、`portraitFace.ts`、`portraitScope.ts`、`idPhoto.ts` |
| 执行器       | `src/shared/graph/execute/portrait.ts`                                                     |
| 系统提示词   | `src/shared/graph/systemPromptSchemes.ts`（`resolvePortraitRetouchSystemPrompt`）          |
| 渲染层能力缝 | `src/renderer/src/features/graph/model/portraitCapabilities.ts`、`features/yolo/*`         |
| 编辑器       | `src/renderer/src/components/PortraitEditorDialog.vue`（宿主状态在 `NodeGraphEditor.vue`） |
| 检查器       | `src/renderer/src/components/PortraitInspector.vue` + `GraphNodeOutputPreview.vue`         |

## 1. 为什么「全部走图片模型」

v1 是本地像素流水线（`shared/media/portrait/{kernels,mask,warp,pipeline}.ts`，13 阶段滤镜 /
蒙版 / 形变），参数表驱动像素。它的问题是：要做到可信的皮肤质感、五官微调与换背景，每个档位
都得维护一套核函数，而这些正好是图片模型已经擅长的事。

v2 把像素活全部交给图片模型，本地只留下**模型做不可靠**的两件事：

- **像素对齐**：证件照按规格裁到确定像素尺寸、铺 5 寸相纸拼版（`composePortraitIdPhoto`）；
- **蒙版限制**：模型接口没有蒙版通道，出图后按蒙版回贴，只改请求的部位（§4）。

已删除：`shared/media/portrait/{kernels,mask,warp,pipeline}.ts`、
`features/graph/model/portraitBake.ts` 及三个对应测试。参数规格表仍是唯一真相来源，
但消费方从「滤镜」换成了「提示词合成」。

## 2. 参数契约（唯一真相来源）

`src/shared/graph/portraitRetouch.ts` 的 `PORTRAIT_PARAM_SPECS` 描述每个字段的形态与依赖，
**UI（字段渲染）/ 执行器（提示词合成）/ 预设 / 计数角标全部从它派生** ——
「UI 加了一个选项、执行器不知道」这类脱钩不会发生。

字段形态：

| 形态      | 渲染     | 说明                                              |
| --------- | -------- | ------------------------------------------------- |
| `tier`    | 分段按钮 | `off / light / standard / strong / max` 五档      |
| `enum`    | 下拉     | 具名选项（妆面 / 滤镜 / 背景处理 / 规格 / 底色…） |
| `text`    | 文本框   | 自由描述（背景描述、补充说明）                    |
| `color`   | 取色器   | 背景色、渐变终点                                  |
| `number`  | 数字输入 | 导出 DPI                                          |
| `boolean` | 勾选框   | 证件照拼版                                        |

归一化（`normalizePortraitRetouch`）做夹取 + 枚举与颜色域校验 + 缺字段补齐：越域值一律丢回
默认值而不抛错，所以外部 Agent / 老工程写进来的脏参数不会让出图失败。

14 组工具与依赖（`PORTRAIT_TOOL_GROUPS`，`needs` 同时是 UI 置灰依据与提示词门禁）：

| 组     | 依赖           | 参数                                                                                |
| ------ | -------------- | ----------------------------------------------------------------------------------- |
| 修复   | `face`         | 祛痘祛斑 / 眼周 / 皱纹 / 去油光 / 去红眼 / 去碎发（6 档）                           |
| 磨皮   | `face`         | 磨皮 / 毛孔纹理 / 肤色均匀 / 降噪（4 档）                                           |
| 肤色   | `face`         | 美白 / 红润 / 去黄 / 肤色调（4 档）                                                 |
| 五官   | `face`         | 瘦脸 / 下颌线 / 下巴 / 眼睛大小 / 眼距 / 双眼皮 / 鼻型 / 唇形 / 眉毛（9 档）        |
| 眼睛   | `face`         | 眼神光 / 眼白提亮 / 瞳孔（3 档）                                                    |
| 妆容   | `face`         | 妆面（8 种具名）+ 妆容浓度 + 妆色调                                                 |
| 身形   | `pose`         | 肩颈 / 腰身 / 腿长（3 档）                                                          |
| 光影   | `face`         | 补光 / 轮廓光 / 面部立体 / 光比 / 光影色温 / 影调（6 档）                           |
| 调色   | —              | 饱和度 / 色温 / 色调 + 滤镜（12 款具名）                                            |
| 质感   | —              | 锐化 / 清晰度 / 颗粒 / 柔焦 / 暗角（5 档）                                          |
| 区域   | —              | 手动区域框（6 类）+ 补充说明 + **局部回贴开关**                                     |
| 背景   | `mask`（分割） | 背景处理（保留 / 纯色 / 渐变 / 按描述 / 仅虚化）+ 背景色 / 渐变终点 / 描述 + 虚化档 |
| 证件照 | —              | 规格（10 种 + 无）/ 底色 / 拼版                                                     |
| 导出   | —              | 输出尺寸（auto / 1K / 2K / 4K）+ DPI                                                |

其余契约：

- **预设**：`PORTRAIT_PRESETS` 12 套（自然 / 写真 / 新娘 / 儿童 / 证件照 / 港风 / 通透 / 质感 /
  胶片 / 黑白 / 复古影调 / 舞台），只覆盖关键档位；导入导出走 JSON，拒绝来自更新版本的文件。
- **手动区域**：`PortraitManualRegion` = 类型（瑕疵 / 磨皮 / 提亮 / 收窄 / 换背景 / 消除）+
  归一化框 + 备注，最多 64 条。框的位置会翻译成「画面左上的小块」这类**方位语**进提示词。
- **证件照**：`idPhoto.ts` 的 10 种规格 + `planIdPhoto`（关键点与像素尺寸 → 裁切框）+
  5 寸相纸拼版几何。

## 3. 执行流程

`execute/portrait.ts` 的 `executePortraitNode`：

1. **取上游图** `collectIncomingImageItems`，最多 24 张（`PORTRAIT_BATCH_LIMIT`）；
2. 归一化参数；
3. **人脸关键点**：优先复用节点缓存 `params.portraitFaces`（带源图指纹 `sourceHash` 与版本号，
   源图变了自动失效），否则调 `ctx.detectPortraitFaces` 并回写。检测抛错 = 「没有人脸」，
   依赖人脸的组不进提示词，但**整图照常出**（绝不因为一次检测失败让整次出图失败）；
4. **局部范围计划** `portraitScopePlan(state)`（§4）；
5. 逐张：解析底图（AI 版本栈优先，否则上游）→ 按 `needs` 门禁合成提示词
   （`buildPortraitPrompt`，与编辑器里的提示词预览是同一份函数）→
   `ctx.generateImage({ prompt, inputReferences: [底图], model, providerInstanceId })`；
6. 逐张结果：**局部回贴** → 证件照规格裁切（+ 可选拼版）；
7. 落盘 `materializeGeneratedBatch` + `commitGeneratedImages`（写图库 `generatedImages`、
   `selectedImageId`、`previewRelativePath`）；
8. 回写 `portraitBakedRelativePath` / `portraitPrompt` / `portraitIdPhotoPlan`
   （没选规格时显式写 `null`，与 `portraitFaces` 一起构成「上一次到底发生了什么」）。

错误口径（都是**显式失败**，不允许静默错结果）：

| 情形                       | 结果                                                           |
| -------------------------- | -------------------------------------------------------------- |
| 没有上游图                 | `GRAPH_PROCESS_NO_INPUT`                                       |
| 未注入 `ctx.generateImage` | 能力错误（**绝不透传上游原图**：交付一张没修过的图比报错难查） |
| 合成出的提示词为空         | `GRAPH_PROCESS_EMPTY_PROMPT`，且不调用模型                     |

发给模型的提示词 = 系统提示词（`generateSystemPrompt` 可覆盖默认）+ 正文（档位短语 + 手动区域
方位语 + 负面提示）。合成结果回写 `portraitPrompt`，外部 Agent 与用户都能核对模型收到了什么。

## 4. 局部回贴：只处理对应部位

### 动机

图片模型接口 `GenerateImageInput` 只有 `prompt` + `inputReferences`，**没有蒙版通道**，
一次调用必定重绘整张图 —— 于是「磨皮」会连衣服背景一起糊，「瘦脸」会带着背景一起扭。
提示词里写「未请求的部分保持原样」只是文字约束，拦不住模型。

### 做法

照常整图出图，然后按蒙版把结果**羽化贴回原图**：未覆盖处直接就是原图像素（像素级不变）。

范围计划（`shared/graph/portraitScope.ts`，纯函数、可单测）：

| 请求内容                                              | 蒙版                       |
| ----------------------------------------------------- | -------------------------- |
| 修复 / 磨皮 / 肤色 / 五官 / 眼睛 / 妆容 / 光影 / 质感 | 脸（含颈）                 |
| 身形                                                  | 人物实例（本地实例分割）   |
| 手动区域框                                            | 一并并入（人像之外也能用） |
| 调色 / 背景 / 证件照                                  | **整体放弃**（整图语义）   |
| 只改了导出设置                                        | 放弃（`reason: 'off'`）    |

两个刻意的取舍：

- **有全局项就整体放弃**：LUT / 色温、换背景、证件照本来就是整图语义，只回贴局部会把它们
  一起裁掉 —— 那比「作用到全局」更糟。运行日志会写明 `scoped retouch off (global request)`。
- **蒙版由可用来源拼成**：缺关键点就少脸这一块（只剩手动框时仍可局部），缺分割模型就少人物
  这一块；**全都没有时返回 `applied:false`**，调用方沿用整张结果并记一行日志，
  不静默降级。

蒙版几何与合成：

- 脸：`portraitFaceMaskShape`（canonical-68 → 椭圆 + 颈梯形）。关键点外接框只到眉骨与下颌，
  所以椭圆上抬加高盖住额头、两侧放宽到耳缘，再补一段下巴以下的梯形盖住颈与锁骨 ——
  只罩脸会让脖子留在原样，磨皮后接缝极明显。
- 人物：本地实例分割取面积最大的 `person`，用抠图的纯函数 `buildCutoutAlpha` 做
  letterbox 反算 + 置信度阈值 + 边缘羽化。
- 合成（`composePortraitScopedRetouch`，渲染层能力缝）：蒙版画在 ≤1024 的小画布（模糊羽化），
  生成图 `destination-in` 取 alpha，再盖回原图；蒙版放大回原图分辨率时的插值天然形成软过渡。

开关：节点参数 `portraitScopeMode`（`'local'` 默认 / `'global'`），编辑器 🎯 区域 组顶部
勾选项；老节点没有这个参数时按默认（局部）处理。

待调参：`PORTRAIT_MASK_FEATHER_RATIO`（默认 0.012，占蒙版短边）与脸部椭圆 / 颈梯形的系数。
这些只能靠实拍反馈微调 —— 源码里没有像素级预览，改动后请至少跑一张正脸半身照核对接缝。

## 5. 编辑器（dive）

`PortraitEditorDialog.vue` 是受控组件：编辑态（参数草稿、手动区域、AI 版本栈、底图 URL）
挂在宿主 `NodeGraphEditor` 的 `portrait` 状态里，dive 回退 / 主界面撤销 / MCP 改写都不会丢编辑。

- **布局**：横向工具轨（铺满整宽）/ 舞台（左）/ 拖动条 / 参数面板（右，宽度可拖且记忆）。
- **视口**：滚轮缩放、Shift+滚轮或 `[` `]` 旋转、空格 / 中键平移、双击空白复位；
  底栏有缩放百分比与角度读数（点击即复位）。
- **指针映射**：指针 → 图像归一化坐标走 `features/graph/model/portraitViewportTransform.ts`
  的逆变换（纯函数 + 数值单测）：先减图片视觉中心（含平移），再反旋转、除以 zoom，最后按
  **未变换的布局尺寸**（`offsetWidth/offsetHeight`）归一化。分母不能用原始像素（指针横穿全图、
  比例只动一小截，表现为「拖分割线时线跟不上指针」），也不能用旋转后的外接框（越靠边越偏）。
  区域画框与分割线拖动共用这一份。
- **对比**：`⇆ 对比原图`（按住看上游原图）与 `◐ 分割对比`（可拖动中缝）。中缝装饰与缩放解耦：
  线宽 / 圆点按 1/zoom 均匀抵消（手柄自身的 `scale(1/zoom)` 与画面栈的 `scale(zoom)` 相乘为 1，
  所以那里写的 px 就是屏幕 px），并上下各伸出 3000px 让分割线铺满整个舞台而不是只贴住图片高度；
  拖动走上面那条逆变换，所以旋转 / 缩放后中缝仍落在指针下。
- **撤销**：草稿级撤销注册进 `diveEditorHistory`；面包屑回退前 flush 会把整段编辑折叠成
  主图一条撤销命令（否则「关窗即弃」）。
- **参数写回**：改档位即时落盘到节点（`previewPortrait`），关窗 / 出图时再收口成一条命令。
- **AI 增强**：智能消除 / 换背景 / 妆容增强 / 超分 —— 直接调图片模型（用当前画面当参考图），
  结果落盘为工程资产并追加进 `portraitLayers`（版本栈，最多 20），底图切到新版本。
- **保存并出图**：**不关窗** —— 跑图期间按钮与画面显示进度，失败原因留在窗口里；跑完把左边换成
  产物，并把出图前那张留给「对比原图」。
- **开窗默认底图**：**当前输出**（`selectedImageId` / `previewRelativePath`，与输出预览点选的
  同一张）→ 刚用过的 AI 版本（仅当它比当前输出更新）→ 上次产物 → 上游输入原图。
- **检查器联动**：检查器「输出预览」里换选中图时，编辑器左边跟着换
  （`syncPortraitStageFromNodePreview`，与开窗解析共用 `resolvePortraitOutputUrl`）。
- **提示词预览**：与执行器同一份 `buildPortraitPrompt`，可复制、可折叠，文本框右下角可拖大。

## 6. 检查器

`PortraitInspector.vue`：已修项目 / 手动区域数 / 证件照规格 / 高风险档位 / 上次产物路径，
加上统一的「输出预览」（`GraphNodeOutputPreview`：缩略图、双击全屏、存资产库、多版本点选）与
提示词预览。进入编辑器的入口是**双击节点卡片**（检查器里不再放按钮）。

## 7. 模型与依赖

- **图片模型**：节点级 `generateModel` / `generateProviderInstanceId`（面板底部下拉，与其它生成
  节点同一套选项来源）；系统提示词可用 `generateSystemPrompt` 覆盖。
- **本地视觉（可选依赖）**：详见 `ARCH_YOLO_LOCAL.md` §11。

| 能力   | 用途                                 | 缺失时                                          |
| ------ | ------------------------------------ | ----------------------------------------------- |
| `face` | 7 个组的提示词门禁、局部回贴的脸蒙版 | 这 7 组不进提示词；脸蒙版缺一块（手动框仍可用） |
| `mask` | 「背景」组门禁、身形类的画面判读     | 背景组置灰、不进提示词                          |
| `pose` | 「身形」组门禁                       | 身形组置灰、不进提示词                          |

人脸走本地两段式（BlazeFace short-range 检测器 + MediaPipe FaceMesh 468 点 → canonical-68），
模型由本仓 Release 分发、随包内置（`resources/face-models`），首次启动同步到模型目录。

## 8. 测试与回归锁

| 测试                                                              | 锁什么                                                                                        |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `portraitRetouchState.test`                                       | 参数契约、归一化（越域值）、预设、手动区域、提示词合成                                        |
| `portraitViewportTransform.test`                                  | 视口逆变换的数值正确性（往返一致、缩放 / 旋转 / 平移、分母口径必须是布局尺寸）                |
| `portraitScope.test`                                              | 局部范围计划（脸 / 人物 / 全局项 / 只画框 / 只改导出）与脸部蒙版几何                          |
| `graphPortraitExecute.test`                                       | 执行器接线：批量、关键点缓存与失效、缺能力缝报错、局部回贴四态（应用 / 开关 / 全局项 / 降级） |
| `portraitDiveWiring.test`                                         | dive 接线完整性（视图注册、五个分支、dialogs API、开窗底图优先级、开关链路）                  |
| `portraitViewport.test`                                           | 面板布局与视口变换（网格落位、拖动条、指针逆变换、区域画框提交顺序、提示词框可拖）            |
| `portraitInspector.test`                                          | 检查器挂的是统一输出预览组件，预览跟随选中节点                                                |
| `portraitOptionsI18n.test`                                        | 具名选项文案中英齐全 + 不再维护「要翻译的字段」白名单                                         |
| `portraitFaceWiring.test`                                         | 人脸模型从 worker → service → IPC → 渲染层的整条接线                                          |
| `mediaPreviewRotate.test`                                         | 预览弹窗旋转（按钮 / 键盘 / 复位 / 换图归零）                                                 |
| `faceMesh.test` / `yoloFaceModels.test` / `faceModelCatalog.test` | 人脸模型纯数学与目录挑选 / 下载条目                                                           |

其中 dive 接线、面板布局与 i18n 用**源码文本断言**：这些接线坏掉时不报错，表现只是
「双击没反应」「面板被压成一字一行」「下拉里显示裸令牌」，只有人对着屏幕才发现。

## 9. 未做 / 扩展位

- **真·inpainting 蒙版通道**：需要给各 provider 适配器加 mask 支持（多数供应商目前不认）。
  届时局部化可以精确到「只让模型重绘蒙版内」，而不是现在的「整图出图再回贴」。
- **局部 + 全局各一次调用**：现在「有全局项就整体整图」；若愿意付两次调用，可拆成
  「局部一次（罩蒙版）+ 全局一次（调色 / 背景）」。
- **i18n 命名空间**：具名选项共用一个 `graph.portrait.options.*` 扁平命名空间，`hongkong`
  同时被妆容与滤镜复用（妆容显示「港风妆」）；按字段拆一层可以修掉。
- **蒙版调参可视化**：羽化半径与脸部椭圆 / 颈梯形系数目前只能靠实拍反馈。
