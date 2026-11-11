# AI Art Engine MCP 服务与 102 工具完整规范（v8.9.1）

> 线上图文接入教程见官网：[guide-mcp.html](https://justin-sky.github.io/ai-art-engine/guide-mcp.html)（[English](https://justin-sky.github.io/ai-art-engine/guide-mcp.en.html)）。本文档为 `v8.9.1` 服务端架构、安全门禁与 **全部 102 个实时工具（`/mcp` 93 个 + `/mcp/blender` 9 个）** 的权威技术规范。

---

## 1. 概述与设计范式

AI Art Engine 桌面端内置基于 **Model Context Protocol (MCP)** 的本机双向工具服务（核心实现位于 `src/main/services/mcpServerService.ts`、`src/shared/mcpProtocol.ts` 与 `src/main/services/blenderMcpService.ts`）：

- **内外同源架构**：外部编程 Agent（Claude Code、Cursor、Codex、Windsurf 等）与应用内 **◈ AI 对话面板**（DeepSeek Harness `dsh`）调用的是**完全同一套 MCP 端点与工具实现**。
- **节点图为唯一生成底座**：所有图像、视频、语音、音乐、3D 模型与空间世界的生成及加工，统一通过 **强类型 DAG 节点图**（`graph_node_types` 自省 → `graph_edit` 编排或 `workflow_use_installed` 装载模板 → `task_run` 拓扑执行 → `task_status` 跟踪）完成，确保画布状态、资产血缘、缓存复用与 Undo/Redo 历史 100% 一致。`graph_*` 与 `director_stage_*` 均为一等公民核心工具。
- **全工作区零配置直控**：配合运行时参数自省（`introspection.ts`）、深层点路径智能补丁（`smartPatch.ts`）与焦点上下文总线（`surfaceRegistry.ts`），任何画布节点、Dive 子工作台（UI 拆层、Machinations 数值沙盘、漫剧五阶段、2D 骨骼、3D 导演台、小波人像、6 栏时间线）均可由一句话精准操控。

### 典型对话指令与工具映射示例

- 「列出最近的工作区并打开 `cyber-drama`，看看 Git 改了哪些文件」→ `project_list` + `project_open` + `project_git_status` + `project_git_diff`
- 「在当前画布建一个 21 题材漫剧工作台并运行，跑完告诉我进度」→ `graph_node_types` + `graph_edit` + `task_run` + `task_status`
- 「把 3D 导演台里的林小满切成端坐姿态，主光调成暖金色，切到 85mm 特写机位」→ `director_stage_read` + `director_stage_edit`
- 「搜一下官方技能市场的古画复活技能并装上，把种子拓扑并入当前画布」→ `skill_search` + `skill_install` + `workflow_use_installed`
- 「用本地离线 OCR 提取这张游戏截图里的所有文字框，再用 SAM2 分割中间的按钮」→ `vision_local_ocr` + `vision_local_yolo`
- 「往数值沙盘插入抽卡软保底积木，把第 60 步出金期望反推配平并导出 Unity C# 脚本」→ `machinations_building_blocks` + `machinations_studio`
- 「拆解这条参考短视频的四轴视听结构，再去剪掉时间线静默段并导出成片」→ `semantic_analyze_video` + `semantic_timeline_read` + `timeline_rough_cut` + `timeline_export`
- 「在 Blender 里用 `bpy` 搭一座低多边形浮空岛，截视口图给我看，确认后导成 GLB 入工程缓存」→ `get_scene_info` + `execute_blender_code` + `get_viewport_screenshot` + `export_scene` + `asset_import`

---

## 2. 传输架构、鉴权与模式门禁

```text
┌──────────────────────┐  MCP (stdio)  ┌──────────────────────────┐  HTTP POST  ┌───────────────────────────────┐
│ Claude Code / Cursor │──────────────▶│ resources/mcp-bridge.mjs │────────────▶│ AI Art Engine 主进程          │
│ Codex / Windsurf     │◀──────────────│ (或 scripts/mcp-bridge)  │◀────────────│ 127.0.0.1:43110 (/mcp &      │
└──────────────────────┘               └──────────────────────────┘             │ /mcp/blender) + Token + 闸门  │
                                                                                └───────────────────────────────┘
```

### 2.1 Streamable HTTP 服务端与 stdio 隧道桥

| 组件                    | 说明                                                                                                                                                                                                                        |
| :---------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **监听地址与端口**      | 严格绑定本机回环 `127.0.0.1`（拒绝局域网/公网连入）。默认端口 `43110`，被占用时自动顺延探测 `43110–43119`；单次请求体上限 `8 MB`。                                                                                          |
| **HTTP 路由**           | `GET /health`（无鉴权健康探针）、`POST /mcp`（93 个核心工具，JSON-RPC 请求回 `200`、通知回 `202`）、`POST /mcp/blender`（9 个 Blender 实时建模工具）、`POST /mcp/ext/<id>`（反向代理已注册的第三方 MCP 服务）。             |
| **stdio 纯隧道桥**      | 源码位于 `scripts/mcp-bridge.mjs`，安装包内置于 `<安装目录>/resources/mcp-bridge.mjs`（见 `electron-builder.yml` `extraResources`）。桥脚本**只做字节流转发、不维护协议与工具定义**，确保升级应用后工具 Schema 永远零漂移。 |
| **连接凭证 `mcp.json`** | 应用启动绑定端口后自动写入 `<userData>/mcp.json`（Windows 为 `%APPDATA%\aiartengine\mcp.json`），结构为 `{ port, token, pid, version }`。**Token 跨重启持久保留**；如需轮换密钥，删除该文件重启应用即可重新生成。           |
| **反向外部 MCP 桥**     | 通过 `src/main/services/externalMcpClient.ts`，应用内 `dsh` 对话面板也可挂载用户自定义的任意外部 `stdio` 或 `http` MCP 服务（在「技能市场 → MCP」或「设置 → MCP 工具服务」配置）。                                          |

### 2.2 并发闸门与审计日志

- **同步长任务并发闸门（`AsyncSemaphore`）**：`task_run`、`decide`、`tutorial_compose` 三个重负载同步阻塞工具共享并发信号量（默认上限 `3`，可通过环境变量 `AIAE_MCP_GEN_LIMIT` 覆盖），防止多路并发压垮渲染进程或打爆云端配额。
- **全量落盘审计（`mcp-audit.jsonl`）**：所有工具调用（含被权限门禁拦截的越权请求）均以时间安全比对鉴权后追加记录至 `<userData>/logs/mcp-audit.jsonl`（记录时间戳、工具名、200 字符截断参数摘要、耗时与结果，单文件满 `5 MB` 自动滚动为 `.1`，自动剔除图片 Base64 载荷）。

### 2.3 `Agent (Craft) / Plan / Ask` 请求级模式门禁（`src/shared/mcpModeAccess.ts`）

应用内 AI 对话面板顶部的三种工作模式并非单纯的提示词约束，而是随每次运行通过 HTTP 请求头 `X-AIArt-Mode`（线协议取值为 `craft` / `plan` / `ask`）与 `X-AIArt-Run-Id` 强制执行的**工具面硬门禁**（同时约束 `/mcp` 与 `/mcp/blender`）：

| 面板模式（线协议值）         | `tools/list` 可见范围                         | `tools/call` 放行规则                                                                                                                                                  |
| :--------------------------- | :-------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Agent / Craft**（`craft`） | 全部工具（`read` + `write` + `generate`）     | 全量放行（默认执行模式）。                                                                                                                                             |
| **Plan**（`plan`）           | 确认前仅暴露只读工具（`read`，含 `ask_user`） | 用户通过 `ask_user` 确认分步方案前，任何 `write` / `generate` 调用均被直接拦截并返回引导文案；确认「继续」后，同一轮运行自动解锁写与生成权限（点击「取消」保持锁定）。 |
| **Ask**（`ask`）             | 空列表（隐藏全部 MCP 工具）                   | 拒绝一切 MCP 工具调用，强制模型仅以纯文本解答问题。                                                                                                                    |
| **外部客户端**（无模式头）   | 全部已启用工具                                | 不携带 `X-AIArt-Mode` 头时视为用户在外部宿主显式授权，不受面板模式开关影响。                                                                                           |

> 工具副作用分为三级：`read`（只读查询、抽帧预览、离线 OCR/YOLO、状态检查）、`write`（修改工程/画布/时间线/资产/安装技能；未显式登记为 `read` 或 `generate` 的工具默认按 `write` 安全兜底）、`generate`（直接消耗云端模型/ASR/TTS 额度或执行不可逆重型构建，包括 `decide`、`transcribe_audio`、`gameplay_build`、`tutorial_compose`、`semantic_analyze_video`、`game_one_sentence_create`、`game_ui_suite_create`）。

---

## 3. 快速接入（Claude Code / Cursor / Codex）

### 方式 A：stdio 桥接（推荐，自动感知端口与持久 Token）

```bash
# 安装包用户（路径指向安装目录下的 resources/mcp-bridge.mjs）
claude mcp add aiartengine -- node "<安装目录>/resources/mcp-bridge.mjs"

# 源码开发用户
claude mcp add aiartengine -- node "<仓库绝对路径>/scripts/mcp-bridge.mjs"
```

### 方式 B：Streamable HTTP 直连（无需本机安装 Node.js）

从 `<userData>/mcp.json` 读取 `port`（默认 `43110`）与 `token`：

```bash
# 注册 93 工具主端点
claude mcp add --transport http aiartengine http://127.0.0.1:43110/mcp \
  --header "Authorization: Bearer <token>"

# 可选：注册 9 工具 Blender 实时建模端点
claude mcp add --transport http blender http://127.0.0.1:43110/mcp/blender \
  --header "Authorization: Bearer <token>"
```

> **环境变量覆盖**：桥脚本支持 `AIAE_MCP_CONFIG`（自定义 `mcp.json` 路径）或 `AIAE_MCP_PORT` + `AIAE_MCP_TOKEN`（最高优先级直连覆盖）。注意区分应用自动维护的 `%APPDATA%\aiartengine\mcp.json` 与团队项目根目录手写的 `.mcp.json`。

---

## 4. 全部 102 个实时工具完整清单（`93` `/mcp` + `9` `/mcp/blender`）

### 4.1 系统状态、多工程工作区、Git 与定时任务（14 个）

| 工具名                  |  权限   | 功能与关键参数说明                                                                                               | 前置条件     |
| :---------------------- | :-----: | :--------------------------------------------------------------------------------------------------------------- | :----------- |
| `app_status`            | `read`  | 查询应用版本、当前打开工作区路径与名称、资产总数。                                                               | 应用运行中   |
| `models_list`           | `read`  | 列出已启用的模型提供商与各模态（文本/图片/视频/音频/音乐/3D/空间世界/决策）勾选模型清单，**不含任何 API 密钥**。 | 无           |
| `storage_status`        | `read`  | 查询当前激活的对象存储配置状态（S3 / 阿里云 OSS / 腾讯云 COS / 火山 TOS，不含密钥）。                            | 无           |
| `project_list`          | `read`  | 返回最近打开的工作区/工程根目录列表。                                                                            | 无           |
| `project_open`          | `write` | 按磁盘绝对路径 `path` 打开已有工作区（兼容 `workspace.json` 与历史 `project.json`）。                            | 应用运行中   |
| `project_create`        | `write` | 在指定目录新建工作区（写入 `workspace.json` 并初始化 `Assets/`、`Output/`、`.aiartengine/` 目录树）并切换打开。  | 应用运行中   |
| `project_memory_read`   | `read`  | 读取当前工作区的跨会话 Agent 长期记忆（`.aiartengine/memory.md`）。                                              | 已打开工程   |
| `project_memory_write`  | `write` | 整体覆盖写入 `.aiartengine/memory.md`（用于整理归档工程全局偏好）。                                              | 已打开工程   |
| `project_memory_append` | `write` | 向项目记忆指定分类（`style` / `camera` / `character` / `other`）追加一条创作偏好，后续轮次自动注入上下文。       | 已打开工程   |
| `project_git_status`    | `read`  | 只读查询当前工程 Git 仓库状态（分支名、仓库根、已修改/新增/删除/未跟踪文件清单及增删行数统计）。                 | 已打开工程   |
| `project_git_diff`      | `read`  | 只读读取工程内指定相对路径 `path` 相对于 `HEAD` 的统一 Diff（未跟踪新文件自动合成全文新增 Diff）。               | 已打开工程   |
| `schedule_list`         | `read`  | 列出当前会话所有待触发的定时提醒与周期自动化任务（`id`、`summary`、`cron` / `fireAt`、`nextFireAt`、剩余次数）。 | 应用运行中   |
| `schedule_delete`       | `write` | 按 `scheduleId`（及可选 `sessionId`）取消并移除待触发的定时提醒或周期任务。                                      | 应用运行中   |
| `ask_user`              | `read`  | 向对话面板弹出单选/多选/自由输入确认卡并等待用户答复；Plan 模式靠此工具提交方案并在用户点「继续」后解锁写权限。  | 对话面板在场 |

### 4.2 资产库、交付包、音色档案、质检与 Spine/SVG（21 个）

| 工具名                 |  权限   | 功能与关键参数说明                                                                                                                                                                    | 前置条件              |
| :--------------------- | :-----: | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | :-------------------- |
| `asset_list`           | `read`  | 列出当前工作区资产库中的全部资产元数据（`id`、名称、类型、所属文件夹、相对路径）。                                                                                                    | 已打开工程            |
| `asset_read_file`      | `read`  | 按工程内相对路径读取文本文件内容（剧本、配置、JSON、代码等，禁止越出工程根）。                                                                                                        | 已打开工程            |
| `asset_write_text`     | `write` | 更新文本类资产正文并实时广播刷新编辑器界面。                                                                                                                                          | 已打开工程            |
| `asset_create`         | `write` | 新建工程资产（自由画布、剧本、策划案、世界观、分镜、子图、图片、视频、声音、2D 动作等），重名自动递增去重。                                                                           | 已打开工程            |
| `asset_import`         | `write` | 将工程外部本机绝对路径媒体（含 PNG/JPG/WebP/PSD/SVG、视频、音频、3D 模型、文本，单次 ≤50 条）考入 `Cache/imports/` 并在对话流生成带「保存到资产库」按钮的产物卡（拒绝工程内部路径）。 | 已打开工程            |
| `asset_rename`         | `write` | 按 `assetId` 重命名资产。                                                                                                                                                             | 已打开工程            |
| `asset_move`           | `write` | 将资产移动到目标 `folderId`（省略或传 `null` 移回资产库根目录，物理文件随目录原子搬移）。                                                                                             | 已打开工程            |
| `asset_delete`         | `write` | 从资产库移除资产登记（默认拦截仍被其他画布/资产引用的条目并返回引用方，传 `force: true` 可强制出库）。                                                                                | 已打开工程            |
| `folder_list`          | `read`  | 列出资产库文件夹树结构与 `folderId`。                                                                                                                                                 | 已打开工程            |
| `folder_create`        | `write` | 新建资产库文件夹（支持父目录嵌套），返回 `folderId`。                                                                                                                                 | 已打开工程            |
| `folder_move`          | `write` | 将文件夹及其子孙资产整体迁移至新父目录（防环校验，同名冲突自动追加序号）。                                                                                                            | 已打开工程            |
| `asset_package_export` | `write` | 将选定资产（可选含依赖链与生成缓存）打包导出为跨工程 `.aipackage` 文件（无界面调用需传绝对 `targetPath`）。                                                                           | 已打开工程            |
| `asset_package_import` | `write` | 从本机绝对路径 `packPath` 导入 `.aipackage` 资产包（支持按 GUID 挑选子集）并刷新素材库。                                                                                              | 已打开工程            |
| `storage_upload`       | `write` | 将工程内媒体上传至当前已启用的对象存储桶，返回公网或预签名访问 URL。                                                                                                                  | 已打开工程 + 对象存储 |
| `voice_profile_list`   | `read`  | 列出当前工程的角色音色档案表（角色名 → 音色 ID / 克隆参考音频与说明）。                                                                                                               | 已打开工程            |
| `voice_profile_upsert` | `write` | 新建或更新角色音色档案（供漫剧工作台与配音节点跨集保持角色声线一致）。                                                                                                                | 已打开工程            |
| `voice_profile_delete` | `write` | 删除指定角色的音色档案。                                                                                                                                                              | 已打开工程            |
| `asset_qc`             | `read`  | 图片资产「引擎就绪」像素级体检：检查抠图漏底、半透明白边、孤立碎屑、主体贴边、空图与尺寸规范（纯只读不改盘）。                                                                        | 已打开工程 + 界面在场 |
| `asset_qc_fix`         | `write` | 自动执行边缘去污染反混合修复（消除半透明白边与背景光晕），新资产落盘至 `Assets/QC/<原名>/` 并附前后对比。                                                                             | 已打开工程 + 界面在场 |
| `stage2d_spine_export` | `write` | 将画布 `stage.2d` 节点的 2D 骨骼与部件装配烘焙导出为标准 Spine 2D 工程包（`skeleton.json` + `.atlas` + 独立部件透明图集）。                                                           | 已打开工程 + 界面在场 |
| `render_svg`           | `read`  | 使用应用内置栅格化管线将内联 SVG 代码或工程内 `.svg` 渲染为静帧或逐帧动画快照（最多随 MCP 响应内联回传 4 帧供多模态视觉自查，不落盘、无需外部浏览器）。                               | 已打开工程 + 界面在场 |

### 4.3 DAG 节点图、3D 导演台、任务执行与技能市场（18 个）

| 工具名                    |    权限    | 功能与关键参数说明                                                                                                                                                                                                                                                                                                                                                                                                                                                    | 前置条件              |
| :------------------------ | :--------: | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------- |
| `graph_node_types`        |   `read`   | 查询全量可添加节点类型清单（`typeId`、分类、端口定义、`NodeCapabilityDef` 用法说明，以及由 `introspection.ts` 自动反射的 `editablePaths`、`shorthandMap`、`presets`、`diveKind`）。                                                                                                                                                                                                                                                                                   | 应用运行中            |
| `graph_read`              |   `read`   | 读取指定或当前焦点画布的完整拓扑结构（节点列表、连线、分组框；`includeParams: true` 返回完整参数）。                                                                                                                                                                                                                                                                                                                                                                  | 已打开工程            |
| `graph_edit`              |  `write`   | 全工作区画布、Dive 子工作台与 Inspector 统一编辑操作批：支持 `node_add` / `node_update` / `node_upsert` / `node_delete`、`edge_add` / `edge_delete`、`apply_preset`、`group_add` / `group_update` / `group_delete`、`auto_layout` 及节点几何/锁定属性；`params` 原生支持深层点路径、数组条件选择器（如 `filmCast.characters[name=林小满].outfit`）、JSON-string 透明解包与中英文口语别名自愈；省略 `assetId` 时自动绑定当前打开画布（未打开画布则自动新建自由画布）。 | 已打开工程            |
| `graph_icon_refine`       |  `write`   | 九宫格图标包（`image.iconPack`）单枚图标定点回炉重绘：保持整套画风一致重画指定格位并自动重跑切分抠底打包。                                                                                                                                                                                                                                                                                                                                                            | 已打开工程            |
| `director_stage_read`     |   `read`   | 读取当前打开（或指定 `assetId` + `nodeId`）的 3D 导演台（`director.stage`）完整状态：角色白模/3D 模型/几何体/灯光、机位与 Cinemachine 配置、天空与地面环境、动画时间轴及视口着色模式。                                                                                                                                                                                                                                                                                | 已打开工程 + 界面在场 |
| `director_stage_edit`     |  `write`   | 实时操控 3D 导演台：支持对象增删改查、显隐锁定、位移/旋转/缩放、56 根人形骨骼 FK/IK 微调、38 种全身/手势/视线姿态预设、24 种内置程序化动作片段切换与多段序列编排（`skeletonClips`）、多光源与全景天光、Cinemachine 跟拍机位、AI 场面调度与分镜白模预演抓拍。                                                                                                                                                                                                          | 已打开工程 + 界面在场 |
| `task_run`                |  `write`   | 按拓扑序运行指定画布（整图或目标节点子集），支持后台无头打开画布宿主、上游指纹缓存复用与容错降级，返回 `mcpTaskId`（受并发闸门保护）。                                                                                                                                                                                                                                                                                                                                | 已打开工程 + 界面在场 |
| `task_status`             |   `read`   | 按 `mcpTaskId` 查询节点图运行进度、各节点状态与产出路径（终态报告保留 10 分钟）。                                                                                                                                                                                                                                                                                                                                                                                     | 应用运行中            |
| `video_job_list`          |   `read`   | 列出异步视频生成作业队列及状态摘要。                                                                                                                                                                                                                                                                                                                                                                                                                                  | 应用运行中            |
| `video_job_get`           |   `read`   | 按作业 ID 查询单条异步视频生成任务的状态、进度与落盘路径。                                                                                                                                                                                                                                                                                                                                                                                                            | 应用运行中            |
| `list_model3d_animations` |   `read`   | 查询 3D 供应商（Meshy 动作库）可用的预设骨骼动画列表（支持 `search` 关键词过滤，供 `model.retarget` 节点选型）。                                                                                                                                                                                                                                                                                                                                                      | 已打开工程 + Meshy    |
| `decide`                  | `generate` | 调用决策模型对多行结构化问题（`noul` 二元概率 / `choice` 多选置信度 / `score` 量表加权分）做类型化概率判定，直接返回可分支结论而不写资产（与持久化在画布里的 `decisions.judge` 节点互补）。                                                                                                                                                                                                                                                                           | 已打开工程 + 决策模型 |
| `skill_list`              |   `read`   | 列出本机已安装的全部技能包（含官方市场 `wf-*` 技能、GitHub 直装 Claude Code 技能、工作区 `.claude/skills` 与个人自定义技能），可选附带 `SKILL.md` 正文。                                                                                                                                                                                                                                                                                                              | 无                    |
| `skill_search`            |   `read`   | 按关键词联网联合检索 Claude Code 精选技能库、AI Art Engine 官方技能市场（`ai-art-engine-skills`）与 GitHub 公开 `SKILL.md` 仓库。                                                                                                                                                                                                                                                                                                                                     | 应用运行中            |
| `skill_inspect_github`    |   `read`   | 只读预检任意 GitHub 仓库/子目录/`SKILL.md` 链接，返回发现的技能清单、文件数及是否包含 `scripts/` 可执行脚本。                                                                                                                                                                                                                                                                                                                                                         | 应用运行中            |
| `skill_install`           |  `write`   | 从 GitHub `url` 或官方市场 `marketId` 原子安装技能至 `$DSH_HOME/skills/`（默认跳过 `scripts/`，仅在用户经 `ask_user` 明示同意且传 `allowScripts: true` 时落盘脚本），返回完整 `SKILL.md` 指令供当轮立即生效。                                                                                                                                                                                                                                                         | 应用运行中            |
| `skill_uninstall`         |  `write`   | 按技能名卸载已安装的技能包（市场条目同步清理对应工作流模板记账）。                                                                                                                                                                                                                                                                                                                                                                                                    | 应用运行中            |
| `workflow_use_installed`  |  `write`   | 加载已安装或市场技能的工作流种子拓扑，支持三种模式：`seed`（一键落入种子节点与连线）、`merge`（保留当前画布既有节点增量混搭多个技能并汇聚同一 `output.timeline`）、`blueprint`（纯只读返回蓝图 JSON 与 `SKILL.md` 指南）。                                                                                                                                                                                                                                            | 已打开工程            |

### 4.4 本地视觉、音频处理、视频逆向取证与成片时间线 NLE（15 个）

| 工具名                   |    权限    | 功能与关键参数说明                                                                                                                                                                         | 前置条件                       |
| :----------------------- | :--------: | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :----------------------------- |
| `vision_local_ocr`       |   `read`   | 调用跨平台系统原生离线 OCR（Windows WinRT / macOS Vision / Linux Tesseract）提取工程图片中的全部文字与紧致包围盒坐标，零云端额度消耗。                                                     | 已打开工程                     |
| `vision_local_yolo`      |   `read`   | 调用独立 `utilityProcess` 中的本地 ONNX 视觉引擎，支持 `task: "status" \| "detect" \| "segment" \| "pose" \| "face" \| "sam2"`（含 `useMatting: true` 高精抠图与 SAM 2.1 点/框提示分割）。 | 应用运行中（推理需已打开工程） |
| `transcribe_audio`       | `generate` | 将工程内音频或视频音轨语音转写为带起止秒数时间戳的分段台词/字幕底稿。                                                                                                                      | 已打开工程 + ASR/本地 Whisper  |
| `audio_separate`         |  `write`   | 对音频/视频执行人声（干声）与伴奏 BGM 音轨分离，产物落盘 `Cache/Separated/`。                                                                                                              | 已打开工程                     |
| `extract_video_frames`   |  `write`   | 按时间均匀抽取视频序列帧（`count` 默认 4、上限 24）并落盘为工程缓存图片，返回相对路径列表。                                                                                                | 已打开工程 + FFmpeg            |
| `grab_video_frames`      |   `read`   | 按指定时间点抓取最多 6 张视频画面帧并随 MCP 响应直接内联回传给多模态客户端（不写资产库，专供 Agent 视觉审片）。                                                                            | 已打开工程 + FFmpeg            |
| `detect_video_keyframes` |   `read`   | 基于 `ffprobe` 轻量提取视频关键帧（I 帧）秒级时间点列表，无需逐帧解码。                                                                                                                    | 已打开工程 + FFprobe           |
| `analyze_video_beats`    |  `write`   | 对视频抽帧执行目标检测，产出人物/物体出现区间（beat tags）并写回视频资产元数据。                                                                                                           | 已打开工程 + FFmpeg + 检测模型 |
| `semantic_analyze_video` | `generate` | 对视频执行 `rea-video` 四轴逆向取证拆解（GB 45438/C2PA 容器溯源、切镜与运镜取证、11 类制作方式贝叶斯判定、多轨声音分析与复刻单元规划），生成 `Semantic/<id>/` 与 `report.md`。             | 已打开工程 + FFmpeg            |
| `semantic_timeline_read` |   `read`   | 读取 `Semantic/<timelineId>/timeline.json` 的完整四轴拆解结论、制作占比、生成/本地复刻单元（`G1`/`K1`）、逐镜证据、台词与角色实体表。                                                      | 已打开工程                     |
| `timeline_read`          |   `read`   | 读取成片时间线（`output.timeline` / 剧本时间线）的轨道片段、创意特效/滤镜/转场配置、总时长与画幅设置。                                                                                     | 已打开工程                     |
| `timeline_rough_cut`     |  `write`   | 基于配音轨转写自动剔除停顿静默段并全轨涟漪前移（默认 `apply: false` 先回预览计划；`apply: true` 写盘前需关闭对应时间线编辑器）。                                                           | 已打开工程                     |
| `timeline_export`        |  `write`   | 将多轨时间线通过 FFmpeg 滤镜链（含 120+ 特效/转场/LUT、画中画、多轨混音闪避、TD-PSOLA 调音歌唱、字幕烧录）合成为高清 `.mp4` 成片并在对话流生成视频预览卡。                                 | 已打开工程 + FFmpeg            |
| `timeline_edit`          |  `write`   | 对成片时间线执行片段增删改、字幕按转写重建、批量轨道特效/滤镜/转场/12 维调色更新（`batchUpdate`）及一键套用 12 款成片剪辑模板（`applyTemplate`）。                                         | 已打开工程                     |
| `timeline_preview`       |   `read`   | 复用与 `timeline_export` 完全同源的 FFmpeg 滤镜图定点渲染成片预览静帧，直接通过 MCP image content 回传给多模态客户端检视画面。                                                             | 已打开工程 + FFmpeg            |

### 4.5 网页图文视频抓取与自动化录屏教程合成（10 个）

| 工具名                 |    权限    | 功能与关键参数说明                                                                                                                                                                | 前置条件                       |
| :--------------------- | :--------: | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :----------------------------- |
| `web_extract_article`  |   `read`   | 在主进程内启动本地无头 Chromium 渲染技术文章或动态网页（掘金/知乎/公众号/Medium 等），自动触发懒加载滚动，提取结构化 Markdown 并将原位架构图/配图下载至 `Cache/imports/`。        | 已打开工程                     |
| `web_fetch_video`      |  `write`   | 按影视/小品名场面关键词（`query`）检索或直接解析 B 站 BV 号 / 链接 / MP4 URL（`url`），下载并按 `startSec` / `maxDurationSec` 无损截取高清素材至 `Cache/imports/`。               | 已打开工程                     |
| `screen_record_start`  |  `write`   | 启动针对应用自身窗口（非全桌面）的教学录屏会话，支持 HUD 标题提示与光标高亮。                                                                                                     | 已打开工程 + FFmpeg + 界面在场 |
| `screen_record_step`   |  `write`   | 在录屏过程中打下步骤对齐锚点（写入 `alignment` 时间轴）、更新 HUD 短标题/字卡并可联动高亮目标控件。                                                                               | 录屏进行中                     |
| `screen_record_wait`   |  `write`   | 录屏期间阻塞等待指定条件达成（如 `until: "graph-idle"` 等待节点图运行完毕且预览贴图上屏；空闲段自动编码压缩封顶约 2 秒）。                                                        | 录屏进行中                     |
| `screen_record_stop`   |  `write`   | 结束窗口录屏并将帧序列编码为 `Cache/Videos/` 下的 MP4，返回压缩后时间轴精确对齐的 `alignment` 清单。                                                                              | 录屏进行中                     |
| `screen_record_status` |   `read`   | 查询当前是否有进行中的窗口录屏会话及已录帧数状态。                                                                                                                                | 应用运行中                     |
| `ui_bounds`            |   `read`   | 按 `data-tutorial-id` 只读查询应用界面控件的屏幕矩形坐标，用于教学步骤定位。                                                                                                      | 界面在场                       |
| `ui_click`             |  `write`   | 按 `data-tutorial-id` 在目标界面控件中心派发真实交互点击，驱动自动化功能演示录屏。                                                                                                | 界面在场                       |
| `tutorial_compose`     | `generate` | 将录屏视频、`alignment` 步骤时间轴与每步 `narration` 口播文案（自动 TTS 合成且顺序不重叠排布）及可选演示音效 `sfxRelativePath` 一键合成为带字幕的教学成片 MP4（受并发闸门保护）。 | 已打开工程 + FFmpeg            |

### 4.6 游戏工业化生产、可玩 HTML5 与 Machinations 数值沙盘（15 个）

| 工具名                          |    权限    | 功能与关键参数说明                                                                                                                                                                                                                                                                                                                                       | 前置条件                       |
| :------------------------------ | :--------: | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :----------------------------- |
| `gameplay_prepare_project`      |  `write`   | 为自定义 2D/3D 可玩 HTML5 游戏生成纯 Node + esbuild 工程脚手架（确定性随机种子、调色板、程序化资产注册表），返回 `projectRelativeDir`。                                                                                                                                                                                                                  | 已打开工程                     |
| `gameplay_build`                | `generate` | 后台编译单文件 `dist/single.html` 并在资产库登记 `gamePlay` 资产，同时自动在隐藏窗口真跑 3 秒执行 5 帧亮度与帧差分**无头冒烟门禁（`smoke`）**。                                                                                                                                                                                                          | 已打开工程 + Node/npm          |
| `gameplay_job_status`           |   `read`   | 查询可玩 HTML5 构建作业进度、体积、日志尾部及无头冒烟报告 `smoke`（未捕获异常、黑屏、死帧告警）。                                                                                                                                                                                                                                                        | 应用运行中                     |
| `game_tile_pbr_process`         |  `write`   | 2D/3D 贴图与 UI 本地工程化算子：C1 无缝平铺贴图、单图派生 PBR 通道（Normal OpenGL/DirectX、Roughness、Height、AO、Metallic、glTF ORM）、UI 九宫格切线检测、Wang-16 / Blob-47 Auto-Tile 掩码与 2D 碰撞多边形（Hurtbox/Hitbox）提取。                                                                                                                      | 已打开工程 + 界面在场          |
| `game_audio_variants`           |  `write`   | 游戏音频工程化后处理：`sfx_variants` 模式裁切首尾静音实现 0ms 瞬发响应并按音高/速度/明暗度批量派生防听觉疲劳音效变体；`bgm_loop` 模式以相位连续交叉淡化生成无缝循环 BGM。                                                                                                                                                                                | 已打开工程 + FFmpeg            |
| `game_bundle_export`            |  `write`   | 将工程内精灵、瓦片、UI 九宫格、PBR、3D GLB、Spine 骨骼包与音频按 `godot` / `unity`（自动生成保 GUID 的 `.meta`）/ `cocos` / `web` 规范增量导出至 `Output/GameBundles/`，附 `game-asset-manifest.json` 与引擎导入脚本。                                                                                                                                   | 已打开工程                     |
| `game_data_table_generate`      |  `write`   | 生成全品类游戏结构化数值配表（角色/技能/道具/DBG 卡牌/波次/AVG 分支对白树 JSON + RFC-4180 CSV）并自动抽取 `zh-CN` / `en-US` / `ja-JP` 多语言 `localization.csv` 落盘 `Assets/GameData/`。                                                                                                                                                                | 已打开工程                     |
| `game_level_map_generate`       |  `write`   | 基于 `bsp_dungeon`（地牢）/ `cellular_cave`（洞穴）/ `platformer_course`（横版跳跃）/ `arena_waves`（割草竞技场）程序化生成 Wang-16 自动瓦片地图与实体点位，导出标准 Tiled `.tmj` 与 ASCII 预览至 `Assets/GameLevels/`。                                                                                                                                 | 已打开工程                     |
| `game_shader_particle_generate` |  `write`   | 一键导出 8 款跨引擎核心游戏 Shader（受击闪白、余烬溶解、像素外描边、2D 水波、CRT 扫描线、全息故障、植被风摆、稀有度扫光，同步生成 Godot `.gdshader` / Unity `.shader` / WebGL `.glsl`）与 8 款 GPU 粒子预设至 `Assets/GameShaders/`。                                                                                                                    | 已打开工程                     |
| `game_systems_graph_generate`   |  `write`   | 构建带 DAG 无环校验的天赋技能树、合成配方、任务成就链、敌人/Boss AI 有限状态机（附 Mermaid 状态图）及 AngelCode BMFont `.fnt` 暴击跳字位图字体清单。                                                                                                                                                                                                     | 已打开工程                     |
| `game_one_sentence_create`      | `generate` | 将一句话游戏需求转化为完整可运行画布工作流（主角/怪物/地砖生图自动去底 → 关卡地图 → AI/程序化 BGM+SFX → 60fps 五大品类 HTML5 可玩沙盒）。                                                                                                                                                                                                                | 已打开工程                     |
| `game_ui_suite_create`          | `generate` | 将一句话全套游戏 UI 需求构建为 8 屏游戏界面画布工作流，支持 `ai_generate`（`asset.gameSystem → ui.split → ui.gen → image.layerSplit`）与 `atlas_compose`（`ui.componentLib → ui.atlasCompose` 图集确定性分层拼装）双模式及 8 大美术母题预设。                                                                                                            | 已打开工程                     |
| `game_playable_preview_compile` |  `write`   | 自动发现工程内主角/怪物/地砖精灵并内联为零依赖单文件可玩 HTML5 微缩沙盒（支持 `survivor` 肉鸽割草与 `platformer` 横版跳跃切换），输出至 `Assets/GamePlayable/`。                                                                                                                                                                                         | 已打开工程                     |
| `machinations_building_blocks`  |  `write`   | 检索、预览或向画布 `game.economy` 节点无冲突拼装 **59 款** Machinations 标准数值积木（`op: "list" \| "search" \| "insert" \| "create_doc"`，自动重映射重名变量、包裹分组框并执行拓扑健康自愈）。                                                                                                                                                         | 应用运行中（写画布需打开工程） |
| `machinations_studio`           |  `write`   | 对 `game.economy` 节点运行 Machinations Studio 高阶算子：`quick_fix`（一键自动修复饥饿/死锁/爆仓/通胀）、`goal_seek`（单变量目标求解）、`curve_solve`（单/双锚点曲线拖拽逆向反推配平与动态公式合成）、`parameter_sweep`（一维敏感度扫描）、`matrix_2d`（二维正交参数热力矩阵）与 `export`（导出 Godot GDScript / Unity C# / Mermaid / 矢量 SVG / CSV）。 | 应用运行中（写盘需打开工程）   |

### 4.7 Blender 实时建模桥 `/mcp/blender`（9 个）

这一组工具挂载在独立端点 `http://127.0.0.1:43110/mcp/blender`（「设置 → MCP 工具服务 → Blender 工具集」默认开启），由主进程主动出站直连本机 Blender Addon 监听端口（默认 `localhost:9876`，无需安装 `uv` 或额外 Python 子进程），同时兼容社区 [blender-mcp](https://github.com/ahujasid/blender-mcp) `addon.py` 与官方 [Blender Lab MCP Server](https://projects.blender.org/lab/blender_mcp) 扩展：

| 工具名                     |  权限   | 功能与关键参数说明                                                                                                                                | 前置条件         |
| :------------------------- | :-----: | :------------------------------------------------------------------------------------------------------------------------------------------------ | :--------------- |
| `get_scene_info`           | `read`  | 获取当前 Blender 场景概览：场景名、对象与材质计数、核心对象名称/类型/空间坐标。                                                                   | Blender 运行中   |
| `get_world_state_snapshot` | `read`  | 获取完整世界快照：几何层级关系、动画帧范围与当前帧、FPS、激活相机与灯光配置。                                                                     | Blender 运行中   |
| `get_object_info`          | `read`  | 查询单个 Blender 对象详情（网格顶点数/边数/面数、材质槽与世界包围盒）。                                                                           | Blender 运行中   |
| `get_viewport_screenshot`  | `read`  | 截取 Blender 3D 视口画面并随 MCP 响应直接回传多模态客户端做视觉自检（经系统临时文件读取后立即销毁，不污染工程与审计日志）。                       | Blender 窗口可见 |
| `execute_blender_code`     | `write` | 在 Blender 进程内执行任意 Python 脚本（完整访问 `bpy` / `bmesh` / `mathutils`），捕获 `stdout` 并在异常时返回完整 traceback（串行队列保序执行）。 | Blender 运行中   |
| `export_scene`             | `write` | 将当前场景、选中对象或指定对象导出为 `glb` / `gltf` / `fbx` / `obj` / `usd` / `stl`（随后可接 `asset_import` 收编入工程缓存）。                   | Blender 运行中   |
| `describe_node_type`       | `read`  | 查询 Blender 着色器或几何节点类型（如 `ShaderNodeBsdfPrincipled`）的输入输出插槽与可设属性。                                                      | Blender 运行中   |
| `bpy_api_lookup`           | `read`  | 从运行中的 Blender RNA 实时反射查询 `bpy` 操作符、类型、属性签名与默认值。                                                                        | Blender 运行中   |
| `get_addon_status`         | `read`  | 查询当前连接的 Blender 版本、MCP Addon 类型、协议版本与可用能力清单，用于连接诊断。                                                               | Blender 运行中   |

---

## 5. 关键使用边界与排障速查

1. **工程路径沙箱隔离**：除 `asset_import` 允许按显式绝对路径将工程外部媒体拷入 `Cache/imports/`（及 `asset_package_export` / `asset_package_import` 的 `.aipackage` 绝对路径）外，所有文件读写与媒体工具严格限制在当前打开的工作区根目录内，任何含 `..` 的越界路径一律拒绝。
2. **编辑器打开态保护**：`timeline_rough_cut` 与 `timeline_edit` 在 `apply: true` 写盘时，若对应剧本的时间线编辑器正在前台打开会拒绝覆盖（防止内存脏态回写冲掉 Agent 改动）；默认 `apply: false` 可随时安全预览方案。而 `graph_edit` 与 `director_stage_edit` 已通过内存宿主桥（`mcpGraphLiveCanvas.ts` / `directorStageHosts.ts`）支持对当前打开的画布与 3D 导演台实时热更新。
3. **沙箱内视觉自检请用内置渲染工具**：应用内 `dsh` 的终端命令运行在受限安全沙箱中，不支持在命令沙箱内直接拉起外部 Chromium 进程。Agent 检视 SVG/矢量动画请调 `render_svg`，检视视频与成片请调 `grab_video_frames` / `timeline_preview`，抓取外部网页图文请调主进程托管的 `web_extract_article`，校验可玩 HTML5 请看 `gameplay_build` / `gameplay_job_status` 返回的 `smoke` 报告。

| 常见报错 / 现象                             | 原因定位                                                        | 解决办法                                                                                                          |
| :------------------------------------------ | :-------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------- |
| `未找到 mcp.json` / `ECONNREFUSED`          | AI Art Engine 桌面端未启动，或端口顺延后直连写死了旧端口        | 启动桌面应用；优先改用 `mcp-bridge.mjs` 自动读取实际端口，或核对 `%APPDATA%\aiartengine\mcp.json` 中的 `port`。   |
| HTTP `401 Unauthorized`                     | 请求头缺少 `Authorization: Bearer <token>` 或重置过 `mcp.json`  | 从最新 `mcp.json` 复制 `token` 更新外部 Agent 配置并重开会话。                                                    |
| 工具列表为空或提示 `Ask 模式不提供任何工具` | 应用内对话面板处于 `Ask` 模式，或 `Plan` 模式尚未确认方案       | 在对话面板底部将模式切回 `Agent (Craft)`，或在 `Plan` 模式的确认卡点击「继续」。                                  |
| Blender 工具报连接失败 / 超时               | Blender 未打开、未启用 MCP Addon，或社区版/官方扩展协议类型选反 | 确认 Blender 已开启 Addon 监听（默认 `9876`），在「设置 → MCP 工具服务 → Blender 工具集」选对协议类型并点击重连。 |
