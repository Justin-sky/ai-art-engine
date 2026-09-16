# 教程：用 AI Art Engine 复现 GPT Astra 的「看屏幕 + 操作 Blender」效果

> 全程只需装一个桌面应用 + 一个 Blender 插件 + 填两个 API Key。
> 按顺序做完大约 20 分钟，之后你就能在对话里说「把角色绑上骨骼做个走路循环」，看 AI 自己写脚本、自己截图检查、自己改。
> 配套深度文见同目录 `tech-article-deepseek-blender-astra.md`，本文是可跟着做的实操版。

---

## 0. 我们要复现的是什么

Astra 演示里最让人印象深刻的一幕：屏幕开着 Blender，用户动嘴，模型**看视口画面 → 写 bpy 脚本 → 执行 → 截图自查 → 继续调整**，整个过程像有个住在你电脑里的动画师。

拆开看是四个环节：**看（多模态感知）→ 想（决策）→ 做（工具调用）→ 查（闭环反馈）**。

AI Art Engine 的复现方案：

| Astra 环节 | 我们的实现                                                  | 成本                    |
| ---------- | ----------------------------------------------------------- | ----------------------- |
| 看         | `get_viewport_screenshot` 视口截图回传 + 本地 YOLO 资产打标 | 边际成本 ≈ 0            |
| 想         | DeepSeek（或其他任一已配置文本模型）                        | 按 token 现结，几毛钱级 |
| 做         | MCP 工具面：Blender 工具集 9 个 + `generate_model3d` 等     | 本地，免费              |
| 查         | 截图自查 + `get_world_state_snapshot` 状态快照              | 本地，免费              |

需要准备的三样东西：

1. **AI Art Engine 6.3.0+**（Blender 工具集、3D rig 支持都在这个版本）——GitHub Releases 下载对应平台安装包
2. **Blender**（建议 3.6+，4.x 均可），正常安装即可
3. **两个 API Key**：一个文本模型（大脑，推荐 DeepSeek 官方），一个 3D 生成服务（Meshy / Tripo / Hyper3D 任选其一）

---

## 1. 配置大脑：DeepSeek 模型接入

AI 对话面板的大脑可以是任何已配置的文本模型，DeepSeek 官方体验最佳。

1. 启动 AI Art Engine，**打开或新建一个工程**（不打开工程 AI 只能闲聊，干不了活）
2. **设置 → 模型接入** → 找到 DeepSeek，填入 API Key 并启用
3. 打开工作区左侧底部的 **◈（AI 对话）面板**，首次使用它会做一次「体检」，缺什么会用大白话提示你
4. 面板顶部模型下拉里选 DeepSeek

> 没有其他服务商也完全够——对话、工具调用、写 bpy 脚本，DeepSeek 一个就全包了。

---

## 2. 配置 3D 模型生成

这是「图生 3D / 文生 3D + 骨骼绑定」的能力来源，对应 MCP 工具 `generate_model3d`。

### 2.1 启用一个 3D 服务商

**设置 → 模型接入** → 启用 Meshy / Tripo / Rodin（Hyper3D）任意一家，填 API Key。

三家简单对比（做角色动画推荐前三家，因为支持 rig 骨骼绑定）：

| 服务商          | rig 骨骼 | 特点                             |
| --------------- | -------- | -------------------------------- |
| Tripo           | ✅       | rig 质量稳，动画友好             |
| Meshy           | ✅       | rigging + rig_type + pose 选项细 |
| Hyper3D (Rodin) | ✅       | rig + rig_type + rig_animation   |
| Luma / Lux3D    | ❌       | 入口守卫会直接拒绝传 rig         |

### 2.2 一个容易漏的坑：对象存储

图生 3D 时如果你传的是**工程内相对路径或本地路径**的参考图，3D 供应商只收 http(s) 公网地址——应用会自动把本地图片上传到你配置的对象存储再转成公网 URL。

没配对象存储就会在这一步报错。**设置 → 对象存储** 配置一个（云厂商的 OSS / COS / S3 均可）；不确定当前状态时，在对话里问一句「调用 `storage_status` 看下对象存储配置」，工具会明确告诉你是否已配置、当前启用哪家。

> 也可以直接传 http(s) 地址或 data URL，绕开这个要求。

### 2.3 验证

在 ◈ AI 对话面板里说：

> 文生 3D：一只 Q 版魔幻战士，卡通风格，带骨骼绑定

正常流程：弹出工具卡片显示 `generate_model3d` 进度 → 供应商异步轮询 → GLB 落到工程 `Cache/Models/` → 对话产物卡上出现「保存到资产库」按钮，**由你决定是否真正入库**（点按钮选文件夹，进 `Assets/<folder>/`，拿到 assetId 才能被工作流引用）。

带 rig 的模型入库后，资产卡会直接有 `previewClip` 动画预览——这个我们后面要用。

---

## 3. 安装 Blender MCP 插件

AI Art Engine **主动出站连接** Blender addon 在 `localhost:9876` 的监听端口——不装 uv、不起 Python 子进程、不改 Blender 任何配置。你只需要在 Blender 里装一个 addon，两种方案**二选一**：

### 方案 A：社区 blender-mcp（默认，推荐先跑通用这个）

1. 打开 [github.com/ahujasid/blender-mcp](https://github.com/ahujasid/blender-mcp)，下载仓库里的 `addon.py`
2. Blender → **Edit → Preferences → Add-ons** → 右上角 **Install...** → 选中 `addon.py` → 勾选启用
3. 在 3D 视口按 **N** 打开侧边栏，找到 **BlenderMCP** 标签页 → 点击 **Start MCP Server**
4. 看到 "MCP server running" 即成功

### 方案 B：官方 Blender Lab「MCP Server」扩展

1. Blender → **Edit → Preferences → Get Extensions**，搜 **MCP Server**（Blender Lab 出品）
2. 安装后在扩展偏好设置里启动服务

> 两种 addon 的线协议**互不兼容**，但在 AI Art Engine 工具层被适配成同一套工具名、入参、输出——模型侧完全无感。你可以都装上试，在应用设置里切换即可。

**唯一要求：使用期间 Blender 保持运行，且窗口不要最小化**（视口截图需要窗口可见；最小化时离屏抓帧会失败）。

---

## 4. 配置 Blender MCP 连接

回到 AI Art Engine：

1. **设置 → MCP → Blender 工具集**（默认已开启）
2. **Addon 类型**：选你刚装的那个（方案 A → 社区 addon.py；方案 B → 官方扩展）。**选错的症状是「连接超时」或「连接已重置」**——遇到这两个报错先查这里
3. Addon 端口默认 `localhost:9876`，没改过 Blender 侧就不用动；改过就在这里同步填
4. 点**「应用并重连」**

设置面板里连接状态**每 4 秒自动刷新**，绿了就是通了。也可以在对话里随时问：「调用 `get_addon_status`，看下 addon 版本和协议版本」——它会告诉你 addon 版本、协议版本、能力清单、Blender 版本，连不上时能区分是「没启用」「版本不匹配」还是「Blender 没开」。

### 这一步之后你已经拥有什么

**应用内 ◈ AI 对话面板自动带上全部 Blender 工具**（内部为 dsh 注册了第二个 mcp-client 实例），直接在对话里说「用 Blender……」即可。

9 个工具一览：

| 工具                       | 用途                                                      | 写/读 |
| -------------------------- | --------------------------------------------------------- | ----- |
| `execute_blender_code`     | Blender 进程内执行 Python，完整 bpy / bmesh / mathutils   | 写    |
| `export_scene`             | 导出 GLB / GLTF / FBX / OBJ / USD / STL                   | 写    |
| `get_scene_info`           | 场景概览：对象 / 材质数量与位置                           | 读    |
| `get_world_state_snapshot` | 几何 / 关系 / **动画摘要、当前帧与帧范围、FPS**、激活相机 | 读    |
| `get_object_info`          | 对象详情（顶点 / 边 / 面数、包围盒）                      | 读    |
| `get_viewport_screenshot`  | **视口截图回传给多模态客户端**（AI 的眼睛）               | 读    |
| `describe_node_type`       | 查节点类型端口与属性（写着色器前先问它）                  | 读    |
| `bpy_api_lookup`           | 在运行中的 Blender 里查 bpy API（参数默认值来自真实 RNA） | 读    |
| `get_addon_status`         | addon 版本 / 协议版本 / 能力清单                          | 读    |

### 顺便：外部 Agent 也想用？

Blender 工具集挂在同一服务的另一个端点 `/mcp/blender`，Claude Code 等外部 Agent 再注册一条即可：

```bash
claude mcp add --transport http blender http://127.0.0.1:43110/mcp/blender --header "Authorization: Bearer <应用侧 mcp.json 里的 token>"
```

token 在 `%APPDATA%\aiartengine\mcp.json`（应用启动自动写、退出自动删，别手改）。

---

## 5. 安全边界：先弄清 AI 能干什么、不能干什么

让便宜模型操作专业软件，纪律必须由系统保证，AI Art Engine 有两层：

**第一层：safe mode 词法护栏**（默认开启）。`execute_blender_code` 只允许 import `bpy` / `bmesh` / `mathutils` 和纯 Python 标准库；禁 eval / exec / subprocess / 网络 / os；禁装饰器 / lambda / class 等结构性写法。渲染、保存、导入导出等 bpy 操作符**不受限制**——不然工具就没用了。

**第二层：面板模式约束**。对话面板的 Ask / Plan / Craft 是**硬约束**（随请求头下发，服务端执行），不是提示词：

- **Ask**：整组 Blender 工具不返回，纯问答
- **Plan**：只放行只读 7 个（截图、查状态、查 API 都行）；`execute_blender_code` / `export_scene` 属 write，被拒并记审计日志；你看完它的计划选「继续」，同一轮内放行
- **Craft**：不限制

推荐节奏：**先 Plan 看方案，没问题切 Craft 执行**。

另外记住两条运行特性：

- **一次只跑一条 Blender 命令**（socket 协议串行化，前一条没回完后一条排队）——批量操作让 AI 在**一条** `execute_blender_code` 里写完，别并发
- **Blender 一关整组工具失败**（报「连不上 addon」），应用不负责启动 Blender

---

## 6. 实战：复现「三视图 → 绑骨 → 走路循环」全链路

这是一次真实工程的完整流程（素材来自实跑记录，全程约 1 小时，模型成本个位数）。把每步的对话原文抄给你，照着说即可。

### 第 1 步：生成三视图母版

@ 引用是关键——输入框打 `@` 弹出资产列表，选张参考图（没有也行，纯文生图）：

> @参考图 出一张角色设定三视图稿：16 岁少女剑客，画面横向并排三个完整全身视图——左侧正面、中间侧面、右侧背面，同一角色同一比例，笔直站姿双手自然下垂。黑长直高马尾红色发带，深蓝振袖和服白袜木屐，腰侧佩黑鞘短刀。日系赛璐璐动画风格，平涂上色硬边阴影。纯白背景，无文字无边框，三视图水平等距对齐

三视图是图生 3D 的最佳输入——正面定比例、侧面定深度、背面补细节，比单张图质量高一大截。

### 第 2 步：图生 3D + 骨骼绑定

@ 刚生成的三视图：

> @三视图 把这个角色转成 3D 模型，带骨骼绑定，rig 用 humanoid

AI 会调 `generate_model3d`，参考图走对象存储转公网 URL，供应商异步轮询，GLB 落 `Cache/Models/`。带 rig 的模型在产物卡上直接能动——点「保存到资产库」入库，顺手把资产库里的 `previewClip` 预览看了。

上游绑骨的意义：**贵的重活（几何重建 + 蒙皮）交给专业生成服务，便宜模型干编排和精修**——这是省钱的关键分工。

### 第 3 步：Blender 精修（Astra 时刻）

切 **Craft** 模式，说：

> 在 Blender 里把这个 GLB 的骨骼动画调整成走路循环：接触帧、过渡帧各做两个并镜像，做完截张视口图给我看

接下来你会看到完整的 Astra 式闭环，AI 的实际动作序列：

```
get_scene_info                    看清场景现状
   ↓
execute_blender_code              import GLB、读骨骼、写关键帧
   ↓
get_viewport_screenshot           截视口画面 → 回传给模型
   ↓（模型看图判断：重心对不对、手臂摆幅自然吗）
execute_blender_code              不对就调参数重写
   ↓
export_scene                      满意后导出 GLB
   ↓
asset_import                      进 Cache/imports/ 缓存
   ↓
你在产物卡点「保存到资产库」      正式入 Assets/
```

两个让它做得更好的技巧：

- 提示它「先调 `bpy_api_lookup` 查一下这个 Blender 版本的 API」——bpy 每版都在变，查了再写比凭训练记忆写稳得多
- 截图自查不理想时直接用自然语言反馈：「手臂摆幅太大」「重心低了」——多轮修正

### 第 4 步：出动画预览

> 把调整好的走路循环渲染一段预览，GIF 和 MP4 都要

产物落在工程 `Output/` 下。到此，你完成了 Astra 演示的核心场景：**AI 看着屏幕、自己写脚本、自己检查、自己修正，全程你没碰过 Blender**。

---

## 7. 常见问题排查

| 症状                            | 原因                                                         | 解法                                                                                                              |
| ------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| Blender 工具报「连不上」        | Blender 没开 / addon 没启用 / 端口不是 9876 / addon 类型选错 | 确认 Blender 运行中、addon 已启用；换过 addon 类型或端口就去「设置 → MCP → Blender 工具集」同步，点「应用并重连」 |
| 连接超时 / 连接已重置           | addon 类型选错（社区 ↔ 官方互不兼容）                        | 设置里换成你实际装的那个                                                                                          |
| 截图工具时灵时不灵              | Blender 最小化（窗口抓屏失败）                               | 保持 Blender 窗口可见                                                                                             |
| Plan 模式下 AI 说「需要先确认」 | 符合预期                                                     | 看方案选「继续」，或切 Craft                                                                                      |
| 图生 3D 报对象存储错误          | 本地参考图无法转公网 URL                                     | 配置对象存储，或传 http(s) / data URL                                                                             |
| 3D 生成「卡住很久」             | 供应商异步轮询中（工具超时已放宽到 120 分钟）                | 正常等待；瞬时网络错误会自动退避重试，不会判死重发                                                                |

---

## 8. 下一步

- **外部 Agent 接入**：Claude Code / Codex 走 `/mcp` 主工具集 + `/mcp/blender`，和应用内面板同一套工具——详见 `docs/MCP.md`
- **stdio 反向桥**：让应用内对话直接消费任意第三方 stdio MCP server（设置 → MCP 工具服务 → stdio 桥 Tab 可视化配置）
- **成片链路**：调 `timeline_read` / `rough_cut` / `export` 让 AI 自己铺时间线剪片

仓库地址见阅读原文。装好后欢迎在评论区甩你的第一段走路循环。
