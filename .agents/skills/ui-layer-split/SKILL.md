---
name: ui-layer-split
description: '一键把 UI 截图 / 设计稿精准拆成专业美工级 PSD 分层（本地 OCR + 多模态大模型 + 逐级剥层补底）。Precisely split a UI screenshot into professional, complete, editable PSD layers using local OCR + a multimodal LLM.'
argument-hint: '[图片资产名或路径] [可选：拆分重点 / 界面说明]'
when_to_use: '用户要求拆分 UI 图层、切图、把界面图拆成 PSD、把游戏 UI / App 界面分层、提取按钮图标面板等界面元素时使用。Use when the user wants to slice / decompose a UI image into layers or a PSD.'
allowed-tools: mcp__studio__models_list, mcp__studio__asset_list, mcp__studio__asset_import, mcp__studio__graph_node_types, mcp__studio__graph_read, mcp__studio__graph_edit, mcp__studio__task_run, mcp__studio__task_status, mcp__studio__ask_user
version: 1.0.0
author: ai-art-engine
---

# UI 精准拆层（ui-layer-split）

把一张 UI 图（游戏界面、App 页面、弹窗、HUD、设计稿截图）**一键拆成美工可直接交付的分层 PSD**：

- 每个控件一层（面板、底框、按钮、Tab、道具格、图标、角标、头像、立绘、进度条、装饰、特效、艺术字……）
- 被上层挡住的部分会**补全**（逐级剥层），每层单独拿出来都是完整的
- 普通文字导出为 **Photoshop 可编辑文字层**（OCR 文本 + 估算字号 / 颜色）
- 图层按 **控件树嵌套分组**（面板组 ⊃ 按钮组 ⊃ 按钮底 + 文字）
- 底图是去掉所有元素后的干净背景

能力已内置在 `image.layerSplit`（UI 图层拆分）节点的 **`precise` 精准拆层** 模式里，本技能负责编排、选模型、检查结果和二次修正。

## 前置条件

1. **视觉模型（必需）**：设置里至少启用一个支持图片输入的文本模型。推荐 **Gemini 2.5 Pro / 3 Pro**（原生 box_2d 定位最准），其次 Gemini Flash、GPT-4.1/5、Claude、Qwen-VL。
   - 节点不指定时会自动挑选视觉定位能力最强的已启用模型（Gemini 优先）。
   - 也可以在节点参数里写 `visionModel` / `visionProviderInstanceId` 来固定。
2. **图片模型（推荐）**：节点的 `generateModel` 用于逐级剥层补底（Gemini 2.5 Flash Image / Nano Banana、GPT-Image、Seedream 4.x 等支持参考图编辑的模型）。没有图片模型时会全部用本地补底，被遮挡区域会稍差。
3. **本地 OCR（自动）**：Windows 用系统 OCR，macOS 用 Vision，其余用 tesseract；没有也能跑（只靠大模型读字）。

## 工作流程

1. **确认素材**：`asset_list` 找到用户指的图片；不在工程里就 `asset_import` 导入。
2. **检查模型**：`models_list` 确认有已启用的视觉文本模型（见前置条件）。没有就用 `ask_user` 提示用户去设置里启用 Gemini，**不要**退回到无视觉模型的方式硬拆。
3. **建节点**：`graph_node_types` 查 `image.layerSplit` 的参数，然后 `graph_edit`：
   - 新建图片输入节点（引用该资产）→ 连到 `image.layerSplit`
   - 参数：`imageLayerSplit.splitMode = "precise"`；`imageLayerSplit.prompt` 写用户补充说明（可选，例如"这是抽卡礼包弹窗，右侧立绘要单独一层"）；`generateModel` 选一个图片编辑模型；`imageLayerSplit.resolution = "2K"`
4. **运行**：`task_run` 只运行该节点，`task_status` 等待完成。日志里搜 `[precise-split]` 可以看到：OCR 框数、VLM 元素数、放大复检、每级剥层方式（generative / local / transparent）、**重建误差**。
5. **验收**（`graph_read` 读节点的 `imageLayerSplit.layers / groups`）：
   - 重建误差 `recon error` < 3 通常是无损；> 6 说明有元素没拆干净或补底漂移
   - 检查是否漏掉控件（与原图逐区域对比）、是否把一个控件拆碎、文字是否被识别为可编辑文字层
6. **修正**（按需）：
   - 漏拆 / 误拆：把问题写进 `imageLayerSplit.prompt`（例如"底部 4 个导航按钮各自独立""金币数字是艺术字不要当普通文字"）后重跑（提示词 / 模型变化会自动使缓存失效）
   - 某个大图层里还有东西没拆开：在拆层编辑器里对该图层「继续拆分」
   - 补底质量差：换更强的图片编辑模型（`generateModel`）后重跑
7. **交付**：节点输出 `out-psd` 即 PSD 路径；告诉用户 PSD 位置、图层数、分组结构和重建误差。

## 结果说明

| 图层   | 说明                                                                                  |
| ------ | ------------------------------------------------------------------------------------- |
| `Base` | 移除全部元素后的干净背景（role = canvas-base）                                        |
| 控件层 | 名称来自大模型（按界面语言命名），`description` 为元素类别（panel / button / icon …） |
| 文字层 | `editableText` 带文字内容、字号、颜色、对齐，PSD 中为可编辑文字                       |
| 分组   | 有子元素的控件自成一组，组内含其本体图层，组可嵌套                                    |

## 成本

一次拆分 ≈ 1 次 VLM 版面解析 + 最多 3 次放大复检 + 最多 3 次图片编辑（每个遮挡层级一次，通常 2–3 次）。设 `splitMode = "auto"` 时若没有视觉模型会自动回退到传统引擎。

更多原理与排错见 [references/pipeline.md](references/pipeline.md)。
