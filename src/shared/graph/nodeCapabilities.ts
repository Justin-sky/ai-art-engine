/**
 * 画布节点与内置管线能力目录（Node Capability Catalog）。
 *
 * 重构说明：
 * - 原 `graphSkills.ts` 中的「内置技能」本质上是**画布节点的系统提示词、默认指令与 MCP 节点使用指南**，
 *   并非独立的 Claude Code Agent 技能包。
 * - 本模块将其正式归位为**节点能力定义（`NodeCapabilityDef`）**，按节点 `typeId` 索引，
 *   直接服务于节点默认提示词、预设应用与 MCP `graph_node_types` 自发现，不再向 `$DSH_HOME/skills`
 *   生成 40+ 个伪技能 `.md` 文件。
 */

import {
  EPISODE_AGENT_BEATBOARD,
  EPISODE_AGENT_BREAKDOWN,
  EPISODE_AGENT_MOTION,
  EPISODE_AGENT_MOTION_9,
  EPISODE_AGENT_REVIEW_BEATBOARD,
  EPISODE_AGENT_REVIEW_BREAKDOWN,
  EPISODE_AGENT_REVIEW_MOTION,
  EPISODE_AGENT_REVIEW_MOTION_9,
  EPISODE_AGENT_REVIEW_SEQUENCE,
  EPISODE_AGENT_SEQUENCE,
  pickEpisodeAgentPrompt,
  type EpisodeAgentPromptPack
} from './episodeAgentPrompts'
import {
  defaultBeatSplitSystemPrompt,
  defaultEmotionSystemPrompt,
  defaultEraseSystemPrompt,
  defaultExpandSystemPrompt,
  defaultGameSystemSystemPrompt,
  defaultImageSystemPrompt,
  defaultLightingSystemPrompt,
  defaultMatteSystemPrompt,
  defaultMultiAngleSystemPrompt,
  defaultOptimizeSystemPrompt,
  defaultPortraitTextureSystemPrompt,
  defaultRedrawSystemPrompt,
  defaultScreenplaySystemPrompt,
  defaultToPromptSystemPrompt,
  defaultUiImageSystemPrompt,
  defaultUiSplitSystemPrompt,
  defaultUpscaleSystemPrompt,
  defaultVideoSystemPrompt,
  defaultWorldExtractSystemPrompt
} from './systemPromptSchemes'
import type { GraphNodeParams } from './types'
import { resolveFrameAnimGenSystemPrompt } from './anim2d'
import { FILM_BREAKDOWN_SYSTEM, pickFilmPrompt } from './film/prompts'

export type NodeCapabilityKind =
  | 'node'
  | 'episode'
  | 'episode-review'
  | 'episode-image'
  | 'episode-video'
  | 'anim2d'
  | 'svg'
  | 'blender'
  | 'gameplay'
  | 'tutorial'
  | 'film'

export type NodeCapabilityParseKind =
  'beatBreakdown' | 'beatBoard' | 'sequenceBoard' | 'motionPrompts' | 'directorVerdict'

export interface NodeCapabilityDef {
  /** 节点 typeId 或内置管线预设 ID（如 `asset.image`、`film.workbench`、`episode.breakdown`） */
  id: string
  kind: NodeCapabilityKind
  titleZh: string
  titleEn: string
  systemPromptZh?: string
  systemPromptEn?: string
  instructionZh?: string
  instructionEn?: string
  /** 给 MCP `graph_node_types` 与 Agent 提供的节点端口、参数与串联用法说明 */
  usageZh?: string
  usageEn?: string
  parse?: NodeCapabilityParseKind
}

const GRID_FILL_ZH =
  '每格独立成幅、无缝拼接，格与格之间不要边框、分隔线或白边；每格内容必须严格铺满自己的格子区域，格子边界即画面边界，不得内缩、留边距或留白；整张画布严格保持生成设置中的宽高比，无文字水印。'

const GRID9_IMAGE_ZH = `基于上游 9宫格分镜表生成一张 3×3 九宫格拼图画布：9 格按表内顺序依次对应 9 个核心锚点，人物服饰、主光方向、场景严格按表内描述保持绝对一致；${GRID_FILL_ZH}`

const GRID4_IMAGE_ZH = `基于上游 4宫格动态分镜表生成第 {group} 组的 2×2 四宫格拼图画布：左上定场、右上引入、左下冲突、右下收尾，人物服饰、主光方向、场景与参考首帧严格一致；${GRID_FILL_ZH}`

const VIDEO_GRID4_ZH =
  '基于上游参考图与该动态格的图生视频指令生成 格{group}-{cell} 的动态视频，参考图只提供风格与内容参考，严格遵循指令中的镜头运动、主体动作、环境交互与时长。'

const VIDEO_GRID9_ZH =
  '基于参考首帧图与上游动态提示词生成图生视频：保留参考图中人物身份、服装、发型、场景、主光方向与构图基调，严格按动态提示词中的时间轴、镜头运动、主体动作、完整对白与环境音执行。'

const GRID_FILL_EN =
  'Each cell must be a complete, seamless frame with no borders, divider lines, or white gaps between cells; every cell must fill its own region edge-to-edge — the cell boundary is the frame boundary, with no inset, margin, or empty space; the full canvas must keep the configured aspect ratio, with no text watermark.'

const GRID9_IMAGE_EN = `From the upstream 9-grid storyboard table, generate a single 3×3 nine-grid collage canvas: the 9 cells map in order to the 9 key anchors, keeping character outfits, key-light direction, and scene absolutely consistent with the table; ${GRID_FILL_EN}`

const GRID4_IMAGE_EN = `From the upstream 4-grid dynamic storyboard table, generate the 2×2 four-grid collage for group {group}: top-left establish, top-right introduce, bottom-left conflict, bottom-right resolve, keeping character outfits, key-light direction, and scene consistent with the reference first frame; ${GRID_FILL_EN}`

const VIDEO_GRID4_EN =
  "From the upstream reference image and this dynamic cell's image-to-video instruction, generate the dynamic video for cell {group}-{cell}. The reference image only provides style and content reference; strictly follow the camera movement, subject action, environment interaction, and duration in the instruction."

const VIDEO_GRID9_EN =
  'From the reference first-frame image and the upstream motion prompts, generate an image-to-video clip: preserve the character identity, outfit, hairstyle, scene, key-light direction, and composition tone from the reference image; strictly follow the timeline, camera movement, subject action, full dialogue, and ambient sound in the motion prompt.'

const ANIM2D_FRAMES_INSTRUCTION_ZH =
  '为同一角色生成「{action}」动作的序列图（sprite sheet）：在一张图内按 {rows}×{cols} 分格绘制一个完整动作周期，帧序从左到右、从上到下；所有格子中角色的外观、体型、配色与画风完全一致，仅姿态变化，帧间过渡自然。'

const ANIM2D_FRAMES_INSTRUCTION_EN =
  'Generate a sprite sheet of the "{action}" action for the same character: draw one complete action cycle inside a single image as a {rows}×{cols} grid, frame order left to right then top to bottom; keep the character\'s look, proportions, palette and art style identical across every cell, changing only the pose, with smooth transitions between frames.'

export const ANIM2D_FRAMES_USAGE_ZH =
  '用法：在节点图里添加「2D帧动画」节点（typeId `anim.2d`，双击可进入全屏帧动画工作台），支持 3 种模式（`params.anim2dMode`）：① `sheet`（序列图/视频切帧：把按 rows×cols 分格的 sprite sheet 接 `in` 端口，或动作视频接 `in-video` 端口抽帧；设 `animRows` / `animCols`、动作预设 `animPresetId` 或 `animInstruction`，可选自动抠底 `animKeyColor: "auto"` 与脚底稳像 `animStabilize: "ground"`，设 `animGifFps: 8~12` 产出逐帧 PNG `out`/`out-frames`、拼合雪碧图 `out-sheet` 与 GIF 动图 `out-gif`）；② `interpolate`（首尾帧插值：`in` 接首帧、`in-end` 接尾帧，生成中间过渡帧）；③ `bones`（2D 骨骼绑定与动作采样，经 `out-rig` 输出绑定数据）。若需批量立绘去底/描边净化/无缝贴图/九宫格切图，上游可先接 `image.align`（精灵规整）；若需多图层 Z 轴舞台编排与程序化动作烘焙，下游可接 `stage.2d`（2D 舞台导演）。' +
  '走 MCP 时最少 3 次调用，且不必先调 workflow_plan（workflow_commit 直接收手写 plan）：① workflow_commit({ plan, name }) —— plan 为 {"title":"2D 帧动画","nodes":[{"key":"sheet","typeId":"asset.image","params":{"generateInstruction":"为同一角色生成「<动作>」动作的序列图：一张图内按 <rows> 行 <cols> 列分格，帧序从左到右、从上到下，纯色干净背景，各格角色的外观、体型、配色与画风完全一致，仅姿态不同"}},{"key":"anim","typeId":"anim.2d","params":{"animRows":<rows>,"animCols":<cols>,"animPresetId":"walk","animInstruction":"<动作循环描述>","animKeyColor":"auto","animStabilize":"ground","animGifFps":12}}],"edges":[{"from":"sheet","to":"anim"}]}，返回 assetId；② task_run({ assetId }) 返回 mcpTaskId；③ task_status({ mcpTaskId }) 取产物（生图加编码约 30–90 秒，可能要轮询若干次）。animRows / animCols 必须与序列图实际行列一致，animGifFps 必须显式给出且大于 0（默认 0 只切帧、不出 GIF）。只有改动已存在的资产时才用 graph_node_types / graph_read / graph_edit。'

export const ANIM2D_FRAMES_USAGE_EN =
  'Usage: add a "2D frame animation" node (typeId `anim.2d`; double-click to open the full-screen frame animation workbench), supporting 3 modes (`params.anim2dMode`): (1) `sheet` (wire a rows×cols sprite sheet into `in` or a motion video into `in-video`; set `animRows` / `animCols`, `animPresetId` or `animInstruction`, optional `animKeyColor: "auto"` and `animStabilize: "ground"`, plus `animGifFps: 8-12` to emit per-frame PNGs `out`/`out-frames`, atlas `out-sheet`, and animated GIF `out-gif`); (2) `interpolate` (wire start frame to `in` and end frame to `in-end` for in-between interpolation); (3) `bones` (2D bone rigging and action sampling via `out-rig`). Pair with upstream `image.align` for sprite background keying/defringe/9-slice, or downstream `stage.2d` for multi-layer 2D stage direction.' +
  ' Over MCP the minimum is 3 calls, and workflow_plan is not needed first (workflow_commit takes a hand-written plan directly): (1) workflow_commit({ plan, name }) — plan is {"title":"2D frame animation","nodes":[{"key":"sheet","typeId":"asset.image","params":{"generateInstruction":"Generate a sprite sheet of the <action> action for one character: a single image divided into <rows> rows x <cols> columns, frame order left to right then top to bottom, solid clean background, keeping the character look, proportions and art style identical across every cell, changing only the pose"}},{"key":"anim","typeId":"anim.2d","params":{"animRows":<rows>,"animCols":<cols>,"animPresetId":"walk","animInstruction":"<action cycle description>","animKeyColor":"auto","animStabilize":"ground","animGifFps":12}}],"edges":[{"from":"sheet","to":"anim"}]}, which returns assetId; (2) task_run({ assetId }) returns mcpTaskId; (3) task_status({ mcpTaskId }) fetches the outputs (generation plus encoding takes roughly 30-90 seconds, so several polls may be needed). animRows / animCols must match the actual grid of the sprite sheet, and animGifFps must be set explicitly and be greater than 0 (the default 0 slices frames without producing a GIF). Use graph_node_types / graph_read / graph_edit only when modifying an existing asset.'

export const TUTORIAL_RECORDING_USAGE_ZH =
  '仅当用户明确要求「录制教程 / 教学视频 / 录屏讲解」时启用。' +
  '**大纲**：用户已说清主题则不要 ask_user；含糊才问一次，确认后立刻开拍。' +
  '文案三分法：title≤12 字；caption=完整一句；narration=口播（compose.steps 必带）。' +
  '**口播=画面（最高优先级，禁止「嘴上说选中/点击，实际没点」）**：' +
  'caption/narration 写到的每个操作，下一步工具必须做出**可见**动作。' +
  '说「右键添加节点」→ step(graph-canvas, doContextMenu:true) → step(graph-ctx-group-{分组}, doClick) → step(graph-ctx-type-{typeId点改横杠}, doClick)；例图片：graph-ctx-group-image → graph-ctx-type-asset-image；十合一图像处理：graph-ctx-group-imageEdit → graph-ctx-type-image-process；人像精修/多视角/打光：graph-ctx-group-imageRefine → graph-ctx-type-image-portrait / graph-ctx-type-image-multiAngle / graph-ctx-type-image-lighting；广告变体矩阵：graph-ctx-group-ad → graph-ctx-type-image-adVariants；视频语义：graph-ctx-group-videoSemantic → graph-ctx-type-semantic-analyze；动效与2D舞台：graph-ctx-group-motionFx → graph-ctx-type-anim-2d / graph-ctx-type-stage-2d / graph-ctx-type-image-align（禁止静默 node_upsert）；' +
  '**影视类要多一层**：graph-ctx-group-filmTv → graph-ctx-group-filmPre（前期）/ filmArt（美术）/ filmShoot（拍摄）→ graph-ctx-type-film-workbench 或 graph-ctx-type-film-shot（第二层不开，type 项根本不在 DOM 里）；' +
  '说「选中节点」→ graph_edit node_select（编辑器没开时它会自己打开，保证画布上真的高亮）；' +
  '说「改提示词/参数」→ 指令面板节点：doDblClick → fillText(graph-instruction-input) → 可选 graph-model-select / graph-gen-params；**禁止**静默 node_update；' +
  '说「打开记事本/正文」→ doDblClick → 高亮 graph-notepad，编辑用 fillText(graph-notepad-input)；' +
  '说「打开漫画页/节点工具/dive」→ doDblClick → 高亮 graph-dive（或 graph-dive-view-{viewId}，如 film.workbench / image.process / anim.2d / stage.2d / image.portrait / image.adVariants / comic-page / node-multiAngle）；返回用 graph-dive-up；' +
  '说「点击运行/生成」→ step(graph-run, doClick:true) → screen_record_wait(graph-idle) → step(graph-selected-node) 讲结果 → screen_record_stop；**禁止点完立刻 stop**。' +
  '**开场**：asset_create(type=canvas)+openEditor 空白自由画布，录制中右键添加；不要预热假演示。' +
  '**单次连续拍完**：screen_record_start→screen_record_step×N→screen_record_wait→screen_record_stop→tutorial_compose。录制中允许 step/wait/node_select/ui_click；禁止 task_run/generate_*。' +
  '高亮只用 tutorialId（固定 id + graph-ctx-* / graph-dive-view-*）。fps:10 maxSeconds:180。compose 必传 steps[{index,narration,caption}]。' +
  '**动作必须带 tutorialId**：doClick / doDblClick / doContextMenu / fillText 少了它工具会直接报错（以前是静默跳过、成片里什么都没发生）。' +
  '**别再加字幕轨**：title/caption 已由录制 HUD 烧进画面，`tutorial_compose` 默认不铺字幕（要叠字才显式 subtitles:true）。' +
  '**把被演示的音效放进去**：讲音效/音乐的教程，每步把该步生成的音频用 `steps[].sfxRelativePath` 传给 compose（铺 sfx 轨、与口播对齐）——只铺口播等于「讲了没演示」，观众听不到那个音效。' +
  '旁白长度由音频真实时长决定，长句不会被截断（画面会跟着延长收尾）。' +
  '**口播要配得上步骤间隔**：声轨顺序排布、不会重叠，但口播比间隔长时只能往后顺延（画面落后于旁白）。' +
  '每步口播控制在 ~1–2 句、或 step 之间多留几秒；compose 返回的 narrationShiftedSec > 0 就是顺延了的信号。' +
  '示例图片：右键→type-asset-image→双击指令面板→fillText→run→wait→compose。记事本/漫画页同用 doDblClick，随后跟 graph-notepad 或 graph-dive-view-comic-page。'

export const TUTORIAL_RECORDING_USAGE_EN =
  'Use only when the user explicitly asks to record a tutorial / how-to video. ' +
  'Outline: if the topic is clear, skip ask_user; otherwise ask once then shoot. ' +
  'Three fields: title ≤12 chars; caption = full sentence; narration required in compose.steps. ' +
  'SAY=SHOW (critical): every named action must be a visible tool action. ' +
  'Right-click add: step(graph-canvas, doContextMenu) → graph-ctx-group-{group} → graph-ctx-type-{typeId with dots→dashes}; e.g. graph-ctx-group-image → graph-ctx-type-asset-image; 10-in-1 image process: graph-ctx-group-imageEdit → graph-ctx-type-image-process; portrait/multiAngle/lighting: graph-ctx-group-imageRefine → graph-ctx-type-image-portrait / graph-ctx-type-image-multiAngle / graph-ctx-type-image-lighting; ad matrix: graph-ctx-group-ad → graph-ctx-type-image-adVariants; semantic video: graph-ctx-group-videoSemantic → graph-ctx-type-semantic-analyze; motion/2D stage: graph-ctx-group-motionFx → graph-ctx-type-anim-2d / graph-ctx-type-stage-2d / graph-ctx-type-image-align. Never silent node_upsert. ' +
  'Film/TV needs one more level: graph-ctx-group-filmTv → graph-ctx-group-filmPre / filmArt / filmShoot → graph-ctx-type-film-workbench or graph-ctx-type-film-shot etc. ' +
  'Select: graph_edit node_select (it opens the editor if needed, so the canvas really highlights). ' +
  'Edit prompt/params: doDblClick → fillText graph-instruction-input (+ optional graph-model-select / graph-gen-params). Never silent node_update. ' +
  'Notepad/text: doDblClick → graph-notepad / fillText graph-notepad-input. ' +
  'Comic/dive/node tools: doDblClick → graph-dive or graph-dive-view-{viewId} (e.g. film.workbench, image.process, anim.2d, stage.2d, image.portrait, image.adVariants, comic-page, node-multiAngle); back via graph-dive-up. ' +
  'Run: doClick graph-run → screen_record_wait(graph-idle) → highlight result → screen_record_stop. Never stop right after click. ' +
  'ONE continuous take: screen_record_start→screen_record_step×N→screen_record_wait→screen_record_stop→tutorial_compose. ' +
  'A tutorialId is REQUIRED for doClick/doDblClick/doContextMenu/fillText (without it the tool errors out; it used to silently do nothing). ' +
  'Do NOT add a subtitle track: title/caption are already burned into the picture by the HUD, and tutorial_compose leaves subtitles off by default. ' +
  'ALWAYS include the demonstrated audio: pass the sound effect/music generated in that step as `steps[].sfxRelativePath` (goes on the sfx track, aligned with the narration) — otherwise a sound-effect lesson never lets the viewer hear the effect. ' +
  'Narration length comes from the real audio duration, so long sentences are never cut (the picture is extended instead). ' +
  'Keep narration in proportion to the step gap: the voice track is laid out sequentially and never overlaps, so over-long narration is pushed later (the picture falls behind the voice) — `narrationShiftedSec` > 0 in the compose result is that signal. ' +
  'tutorialId = fixed ids + graph-ctx-* / graph-dive-view-*. fps:10 maxSeconds:180.'

const SVG_MOTION_INSTRUCTION_ZH =
  '把「{subject}」绘制成一份独立可渲染的 SVG 矢量图：只用矢量元素（path / rect / circle / ellipse / polygon / g，可配 defs / gradient），不要位图、不要外部字体或网络资源。需要动画时把动效写成 SVG 自身的 SMIL 动画（<animate> / <animateTransform> / <set>），不要用 CSS @keyframes、也不要用 <animateMotion>（逐帧烘焙不求值），并构成一个可无缝循环的完整动作周期。'

const SVG_MOTION_INSTRUCTION_EN =
  'Draw "{subject}" as a standalone, directly renderable SVG vector artwork using vector elements only (path / rect / circle / ellipse / polygon / g, optionally with defs / gradients) — no bitmaps, no external fonts or network resources. If animation is required, implement the motion as SMIL animation inside the SVG itself (<animate> / <animateTransform> / <set>) — not CSS @keyframes and not <animateMotion>, which frame baking does not evaluate — as one seamless, loopable action cycle.'

export const GAMEPLAY_PROC_ASSETS_USAGE_ZH =
  '用途：用户要「一句话生成可玩的 2D / 3D 小游戏」时走这条路（若在节点图画布内把策划案 + 精灵图合成单文件 HTML 游戏，可用节点 `game.htmlGen`，端口 `in`:text + `in-images`:image → `out`:html）。对话式完整工程交付物是一个纯 Node + esbuild 工程（agent 写 src/**），宿主 cook 成单文件 HTML 后在沙盒窗口里试玩，同时自动登记为一个 gamePlay 资产。' +
  '核心原则：**所有美术与音频资产都由你写代码生成**——不要去找图片 / 模型素材，也不要外链任何资源。' +
  '工程结构（脚手架已生成，照着填）：src/core/rng.js（种子随机 hashSeed / createRng / rngHelpers / createGameSeed）、src/core/palette.js（hsl / createPalette 给出一套自洽配色）、src/core/registry.js（defineAsset / buildAsset / listAssets）、src/assets/geometry/（BufferGeometry 造形体）、src/assets/texture/（Canvas 2D 画贴图，返回 HTMLCanvasElement）、src/assets/material/（把贴图包成 MeshStandardMaterial）、src/assets/audio/（WebAudio 合成音效）、src/assets/level/（关卡布局数据）、src/game/（玩法与输入）、src/main.js（只做装配）。' +
  '硬规则：① 每个资产都要 defineAsset({ id, kind, build }) 注册，id 形如 <kind>_<slug>，玩法侧只 buildAsset(id, ctx) 取用；② 禁止 Math.random，一律用 core/rng.js 的种子随机（同种子必须产出同一批资产）；③ 贴图用 Canvas 画（条纹 / 噪点 / 渐变 / 色块拼接），不要只用纯色 color；④ 音效用 WebAudio 合成（Oscillator + BiquadFilter + 包络，或噪声脉冲），不要静音；⑤ src/core/* 不得 import three（2D 工程没有 three 依赖），需要 three 的模块自己 import；⑥ 禁止自定义 shader（用 MeshStandardMaterial 这类标准材质），禁止 eval / new Function / 外链 URL；⑦ 玩法必须有可交互输入（WASD / 方向键 / 鼠标至少一种）与胜负或得分反馈，R 键重置，主循环用 requestAnimationFrame；⑧ index.template.html 保持内联经典脚本（保留 /*APP_JS*/ 占位符，不要给 <script> 加 type="module"、也不要引相对的兄弟文件）——cook 只产出单个 HTML，用了 ES 模块或相对引用就只能在应用内试玩窗口跑，浏览器里会白屏。' +
  '工具流程（不要自己跑 npm）：① gameplay_prepare_project —— 在工作目录落下脚手架，返回 projectRelativeDir；② 用你自己的文件工具写 src/**（先出一个最小可玩版本，再迭代）；③ gameplay_build({ projectRelativeDir }) —— 宿主执行 npm install + node build.mjs，返回 jobId，随后用 gameplay_job_status 轮询到 done；④ 完成后对话流会出现一张卡，卡上「试玩」按钮直接打开试玩窗口。用户说「再暗一点 / 加个跳跃音效 / 换个种子」时，只改 src/assets/** 与 src/game/** 再重新 build 即可，不要重建工程。' +
  '试玩门禁：每次构建成功后宿主会自动把游戏在隐藏窗口里真跑几秒，结论在 gameplay_job_status 的 smoke 字段——`smoke.ok === false` 表示确实跑不起来（errors 里会写清楚：未捕获异常 / 加载失败 / 渲染进程崩溃 / 黑屏 / 一帧都没渲染），**先按 errors 改代码再重新 build 一次**，不要把它当交付完成；`smoke.status === "warn"`（例如画面静止）多半是「等输入才动」的设计，看一眼 warnings 判断即可。' +
  '建议：3D 就明确用 three（camera / light / 程序化几何 / 实例化摆件）；2D 只用 Canvas 2D。改一个字符的种子就会换一整套配色与布局，需要换风格时优先动种子而不是堆参数。'

export const GAMEPLAY_PROC_ASSETS_USAGE_EN =
  'Use when the user asks for a playable 2D/3D mini-game from one sentence (on a node graph canvas, you can also use node `game.htmlGen` wiring `in`:text + `in-images`:image → `out`:html). For the chat project flow, the deliverable is a pure Node + esbuild project (you write src/**); the host cooks it into a single-file HTML, opens it in the sandbox window for play-testing, and registers it as a gamePlay asset.' +
  ' Core principle: **every art and audio asset is generated by the code you write** — do not look for image/model assets and never link external resources.' +
  ' Project layout (the scaffold already created it; fill it in): src/core/rng.js (hashSeed / createRng / rngHelpers / createGameSeed), src/core/palette.js (hsl / createPalette for one coherent palette), src/core/registry.js (defineAsset / buildAsset / listAssets), src/assets/geometry/ (BufferGeometry shapes), src/assets/texture/ (Canvas 2D painted textures returning an HTMLCanvasElement), src/assets/material/ (wrap a texture into MeshStandardMaterial), src/assets/audio/ (WebAudio synthesized SFX), src/assets/level/ (layout data), src/game/ (gameplay and input), src/main.js (assembly only).' +
  ' Hard rules: (1) register every asset with defineAsset({ id, kind, build }) using ids like <kind>_<slug>, and consume it only through buildAsset(id, ctx); (2) never use Math.random — always the seeded helpers in core/rng.js, so the same seed yields the same asset set; (3) paint textures with Canvas (stripes / noise / gradients / block patterns) instead of flat colors; (4) synthesize SFX with WebAudio (Oscillator + BiquadFilter + envelope, or noise bursts) — never ship silence; (5) src/core/* must not import three (2D projects have no three dependency) — modules that need three must import it themselves; (6) no custom shaders (stick to standard materials such as MeshStandardMaterial), no eval / new Function / external URLs; (7) the game needs real input (WASD / arrows / mouse), win-or-score feedback, an R reset, and a requestAnimationFrame loop; (8) keep index.template.html on inline classic scripts (keep the /*APP_JS*/ placeholder, never add type="module" to the script tag or reference sibling files) — the cook emits a single HTML file, so ES modules or relative references only run inside the in-app play window and show a blank page in a browser.' +
  ' Tool flow (never run npm yourself): (1) gameplay_prepare_project — writes the scaffold and returns projectRelativeDir; (2) write src/** with your own file tools, shipping a minimal playable version first and then iterating; (3) gameplay_build({ projectRelativeDir }) — the host runs npm install + node build.mjs and returns a jobId, which you poll with gameplay_job_status until done; (4) an artifact card appears in the conversation whose Play button opens the game with the system default app (usually the browser), falling back to the in-app sandbox window when the build is not self-contained. When the user says "make it darker / add a jump sound / change the seed", edit only src/assets/** and src/game/** and rebuild — never recreate the project.' +
  ' Playtest gate: after every successful build the host runs the game in a hidden window for a few seconds; the verdict is the `smoke` field of gameplay_job_status — `smoke.ok === false` means it genuinely does not run (errors spell out uncaught exceptions / load failures / renderer crashes / a black screen / not a single rendered frame), so **fix the code from those errors and rebuild once** instead of calling it delivered; `smoke.status === "warn"` (e.g. a static frame) is usually a game that waits for input — read the warnings and judge.' +
  ' Advice: use three explicitly for 3D (camera / lights / procedural geometry / instanced props); use Canvas 2D only for 2D. Changing the seed by one character swaps the whole palette and layout, so prefer moving the seed over piling on parameters.'

export const SVG_MOTION_USAGE_ZH =
  '用法：用户要**矢量**（SVG）而不是位图时，用「SVG 生成」节点（typeId `svg.gen`）：`in` 端口接文本指令、`in-image` 端口接参考图（可照着图片生成矢量图），节点自带 SVG 系统提示词并强制全矢量、禁外部资源，产出 .svg 工程资产（`out` 出选中结果、`out-all` 出历次结果）。需要位图帧序列或 GIF 动图时，再把矢量源接到「SVG 烘焙」节点（typeId `svg.anim`）的 `in` 端口（端口类型 svg）：含 SMIL 动效时按动画时间轴逐帧烘焙 PNG（`out` / `out-all`）并合成 GIF（`out-gif` 端口）；**静态 SVG 只出 1 帧、不产 GIF**，所以要动画就必须在生成指令里明确要求 SVG 内置动效。关键参数：svg.gen 的 generateInstruction（画面 + 动效描述）、svgGenWidth / svgGenHeight（16–2048，默认 512）、svgGenBackground（空串 = 透明，或 white / black）；svg.anim 的 svgFrames（2–60，默认 12，GIF 帧数即此值）、svgDurationSec（0 = 自动探测 SVG 自身动画周期，上限 30 秒）、svgWidth / svgHeight（0 = 用 SVG 自身尺寸）。' +
  '走 MCP 时最少 3 次调用，且不必先调 workflow_plan（workflow_commit 直接收手写 plan）：① workflow_commit({ plan, name }) —— plan 为 {"title":"鹈鹕骑车 SVG 动画","nodes":[{"key":"svg","typeId":"svg.gen","params":{"generateInstruction":"把一只卡通鹈鹕骑自行车画成独立可渲染的 SVG：严格正侧面朝左，车轮、辐条、车架、车把、脚踏都要画全；用 <animateTransform> 让车轮与曲柄持续旋转、双腿交替蹬踏、身体随节奏轻微起伏，构成可无缝循环的蹬车动画","svgGenWidth":512,"svgGenHeight":512}},{"key":"bake","typeId":"svg.anim","params":{"svgFrames":24,"svgDurationSec":2,"svgWidth":512,"svgHeight":512}}],"edges":[{"from":"svg","to":"bake"}]}，返回 assetId；② task_run({ assetId }) 返回 mcpTaskId；③ task_status({ mcpTaskId }) 取产物（文本模型出 SVG 约十几秒，烘焙 + GIF 编码另需数秒）。只要一张静态矢量图时，plan 里只留 svg.gen 单节点、edges 留空，不要接 svg.anim。用户提到 SVG / 矢量 / 矢量动画 / 矢量图标时不要改用 generate_image —— 那是位图。只有改动已存在的资产时才用 graph_node_types / graph_read / graph_edit。' +
  '视觉自查（画了什么、动效对不对）用 `render_svg` 工具直接看画面（传内联 SVG 标记或工程内 .svg 文件路径，画面随本次响应回给你，不落盘、不需要浏览器）；要看资产化的帧序列与 GIF 就用 svg.anim 烘出的 PNG 帧与 GIF 产物（task_status 会给出产物路径）。不要用本机浏览器做无头截图：沙箱里 msedge / chrome 建不出内部 IPC 管道，会以 0x80000003 崩掉、在用户桌面上弹出系统错误框，而且工具调用照样失败（这类命令会在运行前被拒）。'

export const SVG_MOTION_USAGE_EN =
  'Usage: when the user wants **vector** (SVG) output instead of a bitmap, use the "SVG gen" node (typeId `svg.gen`): wire the text instruction into `in` and reference images into `in-image` (it can redraw an image as vectors); the node ships its own SVG system prompt and forces pure vector output with no external resources, producing a .svg project asset (`out` = selected result, `out-all` = every run). To get a raster frame sequence or an animated GIF, wire the vector source into the `in` port (port type svg) of the "SVG bake" node (typeId `svg.anim`): with SMIL animation inside the SVG it bakes one PNG per frame along the animation timeline (`out` / `out-all`) and composes a GIF (`out-gif`); a **static SVG yields one frame and no GIF**, so ask for in-SVG motion explicitly when animation is wanted. Key params: svg.gen generateInstruction (artwork plus motion description), svgGenWidth / svgGenHeight (16-2048, default 512), svgGenBackground (empty string = transparent, or white / black); svg.anim svgFrames (2-60, default 12, which is also the GIF frame count), svgDurationSec (0 = auto-detect the SVG animation cycle, max 30 s), svgWidth / svgHeight (0 = use the SVG intrinsic size).' +
  ' Over MCP the minimum is 3 calls and workflow_plan is not needed first (workflow_commit accepts a hand-written plan): (1) workflow_commit({ plan, name }) — plan is {"title":"Pelican riding a bicycle (SVG)","nodes":[{"key":"svg","typeId":"svg.gen","params":{"generateInstruction":"Draw a cartoon pelican riding a bicycle as a standalone renderable SVG: strict left-facing side view with both wheels, spokes, frame, handlebars and pedals fully visible; use <animateTransform> to keep the wheels and crank rotating, the legs pedalling alternately and the body bobbing slightly, forming one seamless pedalling loop","svgGenWidth":512,"svgGenHeight":512}},{"key":"bake","typeId":"svg.anim","params":{"svgFrames":24,"svgDurationSec":2,"svgWidth":512,"svgHeight":512}}],"edges":[{"from":"svg","to":"bake"}]}, which returns assetId; (2) task_run({ assetId }) returns mcpTaskId; (3) task_status({ mcpTaskId }) fetches the outputs (the text model needs roughly ten seconds for the SVG, then baking and GIF encoding take a few more). For a single static vector image keep only the svg.gen node with an empty edges array and skip svg.anim. Do not switch to generate_image when the user asks for SVG / vector / vector animation / vector icons — that produces a bitmap. Use graph_node_types / graph_read / graph_edit only when modifying an existing asset.' +
  ' For a visual self-check (what was drawn, whether the motion reads) call the `render_svg` tool — pass inline SVG markup or a project-relative .svg path and the picture comes back with the response, nothing written to disk, no browser needed; to inspect the asset-side frame sequence and GIF, use the PNG frames and the GIF that svg.anim bakes, whose paths task_status reports. Do not take headless screenshots with a local browser: inside the sandbox msedge / chrome cannot create their internal IPC pipe, so they abort with 0x80000003 and pop an out-of-app Windows error dialog, and the tool call fails anyway (such commands are refused before they run).'

export const FILM_PIPELINE_USAGE_ZH =
  '用途：用户要把剧本 / 故事做成分镜、设定图、关键帧或成片视频时走这条链（不要再用 prompt.optimize 手搭 9 宫格 / 36 格）。' +
  '节点与端口：① `film.workbench`（影视工作台四合一节点，双击进入全屏工作台，集成分镜拆解、导演审核、角色场景设定与批量拍摄四个阶段。输入端口：`in`:text 剧本、`in-cast`:filmCast 全剧/上集共享设定库（可多连，Series Bible）、`in-image`:image 现成参考图（可多连，同名直绑实体、其余作画风参考）；输出端口：`out`:storyboard 分镜文档、`out-cast`:filmCast 设定库、`out-sheets`:images 设定图集、`out-images`:images 关键帧序列、`out-videos`:videos 镜头视频序列、`out-text`:text 报告；关键 params：`filmWorkbenchStage` 当前页签、`filmWorkbenchRunMode` 运行范围 `""|"all"|"breakdown"|"review"|"cast"|"render"`、`filmTargetShots` 0=自动、`filmShotDurationSec` 单镜时长 0/4/8/10/15、`filmAspectRatio` 如 `"9:16"`/`"16:9"`、`filmStyle`、`filmReviewMaxRounds` 自动修订轮数、`filmCastKinds` 如 `"character,location"`、`filmRenderMode` `"keyframe"|"video"`、`filmShotRange` 如 `"1-5,8"`、`filmRenderConcurrency` 并发场次数 1~8（默认 3，按场次连续性链并发拍关键帧，视频在独立并发池后台生成）、`filmRenderContinuity` 同场连续性参考（默认 true）、`filmRenderQc` 视觉质检自动重拍、`filmCastOnlyId` 单实体重跑、`filmRenderOnlyShotId` 单镜重跑、`filmTextModel` / `generateModel` / `filmVideoModel` / `filmQcModel` 各阶段模型）；② `film.shot`（单镜头精修拆出节点：`in`:storyboard + `in-cast`:filmCast → `out`:text 关键帧提示词、`out-motion`:text 动态提示词、`out-refs`:image 按 @1/@2 排序的出场设定图、`out-keyframe`:image、`out-video`:video；设 `filmShotRef` 为序号或镜头 id，接 `asset.image` / `asset.video` 单独精修重点镜头）。' +
  '百集短剧 / 多集连载（Series Bible 跨集共享与换装变体）：把「全剧圣经工作台」或上一集 `film.workbench` 的 `out-cast` 连到本集 `film.workbench` 的 `in-cast` 端口——① 分镜拆解自动将常驻角色与场景标准名注入提示词并继承外观描述；③ 设定阶段直接复用已有设定图不重画，仅生成新出场角色/新场景；若角色换装/换造型/跨年龄，命名写 `角色名#造型` 或 `角色名·造型`（如 `林夏#晚礼服`、`林夏(战损)`），设定阶段会自动把主角色 `林夏` 的设定图作为 `@1` 参考图传给生图模型，保持五官骨相 100% 一致仅切换服饰造型。' +
  '走 MCP 最少 3 次调用：① `workflow_commit({ plan, name })`，plan 为 `{"title":"影视全流程","nodes":[{"key":"script","typeId":"play.script","params":{"text":"<剧本>"}},{"key":"workbench","typeId":"film.workbench","params":{"filmAspectRatio":"9:16","filmReviewMaxRounds":2,"filmRenderMode":"video","filmRenderConcurrency":3,"filmRenderQc":true}}],"edges":[{"from":"script","to":"workbench","fromPort":"out","toPort":"in"}]}`；② `task_run({ assetId })`；③ `task_status` 轮询取产物。' +
  '迭代闭环：分镜文档与设定库存在 `film.workbench` 节点的 `params.filmStoryboard`（schema `aiart.film-storyboard@1`）与 `params.filmCast`（schema `aiart.film-cast@1`），用 `graph_read` 读、`graph_edit` 改；把满意或人工改过的镜头设 `locked:true`，重新拆解 / 审核修订都不会改写它；批量拍摄按提示词指纹增量缓存，只改一镜就只重拍一镜（`filmForce:true` 才全部重拍）。' +
  '一致性：角色 / 地点外观只写在 `entities[].description` 里，镜头提示词写实体名；设定图会按每镜出场名单自动以 `@1`、`@2` 顺序注入关键帧生成。'

export const FILM_PIPELINE_USAGE_EN =
  'Use this chain whenever the user wants a script / story turned into a storyboard, design sheets, keyframes or shot videos (do not hand-build 9/36-grid chains from prompt.optimize).' +
  ' Nodes and ports: (1) `film.workbench` (unified 4-in-1 Film Workbench node integrating Breakdown, Director Review, Cast & Locations, and Batch Shoot; inputs: `in`:text script, `in-cast`:filmCast multi-connect Series Bible from master/previous episodes, `in-image`:image existing refs; outputs: `out`:storyboard document, `out-cast`:filmCast library, `out-sheets`:images design sheets, `out-images`:images keyframes, `out-videos`:videos clips, `out-text`:text report; key params: `filmWorkbenchStage`, `filmWorkbenchRunMode` `""|"all"|"breakdown"|"review"|"cast"|"render"`, `filmTargetShots` 0=auto, `filmShotDurationSec` 0/4/8/10/15, `filmAspectRatio`, `filmStyle`, `filmReviewMaxRounds`, `filmCastKinds` e.g. `"character,location"`, `filmRenderMode` `"keyframe"|"video"`, `filmShotRange` e.g. `"1-5,8"`, `filmRenderConcurrency` 1-8 default 3 for concurrent scene-chain keyframe rendering + background video pool, `filmRenderContinuity` default true, `filmRenderQc`, `filmCastOnlyId`, `filmRenderOnlyShotId`, `filmTextModel` / `generateModel` / `filmVideoModel` / `filmQcModel`); (2) `film.shot` (`in`:storyboard + `in-cast`:filmCast → `out`:text keyframe prompt, `out-motion`:text motion prompt, `out-refs`:image ordered @1/@2 cast refs, `out-keyframe`:image, `out-video`:video; set `filmShotRef` to polish a single shot with `asset.image` / `asset.video`).' +
  " Multi-episode / 100+ episode Series Bible & costume variants: wire the master or previous episode `film.workbench` `out-cast` into the current episode `in-cast` port — Breakdown automatically injects canonical character/location names into prompts and inherits descriptions, while Cast reuses existing design sheets without redrawing; for costume/makeup/age variants, name the character `BaseName#Variant` or `BaseName·Variant` (e.g. `LinXia#EveningGown`) and Cast will automatically pass `LinXia`'s base sheet as `@1` reference image to preserve facial identity while changing outfits." +
  ' Over MCP the minimum is 3 calls: (1) `workflow_commit({ plan, name })` with nodes `play.script` → `film.workbench`; (2) `task_run({ assetId })`; (3) poll `task_status` for outputs.' +
  ' Iterate in a closed loop: the storyboard and cast library live on `film.workbench` in `params.filmStoryboard` (schema `aiart.film-storyboard@1`) and `params.filmCast` (schema `aiart.film-cast@1`) — read with `graph_read`, edit with `graph_edit`; set `locked:true` on approved shots so re-breakdowns and review revisions never overwrite them; batch shoot caches by prompt fingerprint so editing one shot reshoots only that shot (`filmForce:true` reshoots all).' +
  ' Consistency: appearance lives only in `entities[].description`; shot prompts reference entity names; design sheets are injected automatically as `@1`/`@2` keyframe references per shot cast list.'

const BLENDER_JOB_SYSTEM_ZH =
  '你是 Blender 操作员，不是观察者。读场景最多一次，然后必须改场景。禁止用 execute_blender_code 反复列物体、量 bbox 或自己写截图脚本（img=bpy / render）。截图只用 get_viewport_screenshot，且必须在真正改过骨架/姿态之后。只加工作业目录里的 input.glb，禁止 generate_model3d。禁止在对话里编造 Euler JSON 当最终产物。最后必须 export_scene 到 brief 里的 output.glb。不要用 open() 写 result.json，应用会从 Blender 回读骨架。'

const BLENDER_JOB_SYSTEM_EN =
  'You operate Blender; you are not a spectator. Inspect the scene at most once, then you MUST edit it. Do not loop execute_blender_code to list objects, remeasure bbox, or write custom screenshot scripts (img=bpy / render). Screenshots: get_viewport_screenshot only after a real rig/pose change. Process only the job input.glb — never generate_model3d. Never invent Euler JSON as the deliverable. Finally export_scene to the brief output.glb. Do not write result.json with open(); the app reads the armature back.'

const BLENDER_RIG_SYSTEM_ZH =
  '你是 Blender 操作员，不是观察者。读场景每轮最多一次，然后必须改场景。禁止用 execute_blender_code 空转列物体。截图只用 get_viewport_screenshot，且必须在真正改过骨架之后；同轮禁止无改动重复截图。只加工作业目录里的 input.glb，禁止 generate_model3d。禁止在对话里编造 Euler JSON。不要用 open() 写 result.json。人形蒙皮：先跑 AIAE_HUMANOID_LANDMARKS，再按需挪 Empty，再跑 AIAE_HUMANOID_BIND_FROM_LANDMARKS；不要自行导出，应用会跑硬 QA。'

const BLENDER_RIG_SYSTEM_EN =
  'You operate Blender; you are not a spectator. Inspect the scene at most once per attempt, then you MUST edit it. Do not loop execute_blender_code just to list objects. Screenshots: get_viewport_screenshot only after a real change; never spam identical shots. Process only the job input.glb — never generate_model3d. Never invent Euler JSON. Do not write result.json with open(). For humanoid skinning: run AIAE_HUMANOID_LANDMARKS, optionally nudge empties, then AIAE_HUMANOID_BIND_FROM_LANDMARKS; do not export — the app runs hard QA.'

const BLENDER_RIG_INSTRUCTION_ZH =
  '按网格 landmark 建可用骨架并自动权重；应用硬 QA 通过后才导出带 armature 的 GLB。'
const BLENDER_RIG_INSTRUCTION_EN =
  'Build a usable armature from mesh landmarks, auto-weight it; the app exports a skinned GLB only after hard QA passes.'
const BLENDER_POSE_INSTRUCTION_ZH =
  '在已有骨架上用 IK/约束做出静帧姿势，保持 bind/rest，导出 GLB 并读回 bonePose。'
const BLENDER_POSE_INSTRUCTION_EN =
  'Pose the existing armature with IK/constraints. Keep bind/rest. Export the GLB and read bonePose back.'
const BLENDER_ANIM_INSTRUCTION_ZH =
  '在已有骨架上制作可循环关键帧动作，烘焙后导出带 AnimationClip 的 GLB。'
const BLENDER_ANIM_INSTRUCTION_EN =
  'Create a loopable keyframed action on the existing armature, bake it, and export a GLB with AnimationClip.'

const BLENDER_RIG_USAGE_ZH =
  '用法：图节点 `model.rigSkin`（迭代，上游通常接 `asset.model3d` 生成的 3D 白模/带贴图 GLB，或经 `model.meshEdit` 减面拓扑后的模型）。① import input.glb（首轮一次）。② execute_blender_code 原样跑 brief 的 AIAE_HUMANOID_LANDMARKS（建 AIAE_LM_* Empty，配件/头发不参与端点）。③ 必要时 get_viewport_screenshot 后挪 Empty。④ 原样跑 AIAE_HUMANOID_BIND_FROM_LANDMARKS（只从 Empty 建 21 骨 + ARMATURE_AUTO + 权重清理）。⑤ 不要 export、不要写 result.json；应用跑硬 QA，失败会把失败项塞回下一轮（不限轮次，直到通过或判定卡死）。返工：关节错 → 调 Empty 再 bind；权重错 → 跑 AIAE_RIG_WEIGHT_REPAIR。空转检查 = 失败。'
const BLENDER_RIG_USAGE_EN =
  'Usage: graph node `model.rigSkin` (iterative; upstream is typically `asset.model3d` or `model.meshEdit`). (1) Import input.glb once on attempt 1. (2) Run AIAE_HUMANOID_LANDMARKS from the brief verbatim (AIAE_LM_* empties; accessories/hair excluded). (3) Optionally screenshot then nudge empties. (4) Run AIAE_HUMANOID_BIND_FROM_LANDMARKS verbatim (21 bones from empties only + ARMATURE_AUTO + weight cleanup). (5) Do not export or write result.json; the app runs hard QA and may send failures back without a fixed attempt cap (until PASS or stuck). Repair: bad joints → move empties + rebind; bad weights → AIAE_RIG_WEIGHT_REPAIR. Inspect-only loops fail.'

const BLENDER_POSE_USAGE_ZH =
  '用法：图节点 `model.pose` 只加工已蒙皮模型（上游接 `model.rigSkin` 的 `out`）。流程：① import input.glb，列出 pose.bones 真名；② 用 IK（手脚）和约束做静帧，指令来自检查器芯片或手写，二者同一条通路；③ 禁止填欧拉表交差；④ 导出时保留 bind/rest，把当前姿态作为 default pose 或单帧 action，不要把姿势烤进 rest；⑤ 不要写 result.json，应用会回读 bonePose。上游无骨则失败。'
const BLENDER_POSE_USAGE_EN =
  'Usage: graph node `model.pose` only processes a skinned model (wired from `model.rigSkin` `out`). (1) Import input.glb and list real pose.bones names; (2) build a still pose with IK (hands/feet) and constraints — inspector chips and free text are the same path; (3) never invent an Euler table; (4) export while keeping bind/rest, using the current pose as the default pose or a one-frame action — do not bake the pose into rest; (5) Do not write result.json; the app reads bonePose. If the import has no armature, the job fails.'

const BLENDER_ANIM_USAGE_ZH =
  '用法：图节点 `model.animation` 在已蒙皮模型上产出 GLB AnimationClip（上游接 `model.rigSkin` 或 `model.pose`，下游可接 `model.View3D` 预览截图或 `model.physics` 物理碰撞配置）。流程：① import input.glb 并确认 armature；② 建 action + fcurves，循环动作用周期与踩地 IK，不要按 Hips/LeftUpperArm 硬编码帧表；③ Bake 到 pose bones 并写入 GLTF NLA/animation；④ export_scene 带 animations 到 output.glb；⑤ 不要写 result.json，应用会回读 clip。无骨架则失败。'
const BLENDER_ANIM_USAGE_EN =
  'Usage: graph node `model.animation` produces a GLB AnimationClip on a skinned model (upstream `model.rigSkin` or `model.pose`, downstream `model.View3D` or `model.physics`). (1) Import input.glb and confirm the armature; (2) create an action + fcurves — use cycles and planted-foot IK for loops, never a hardcoded Hips/LeftUpperArm frame table; (3) bake onto pose bones and write GLTF NLA/animation; (4) export_scene with animations to output.glb; (5) Do not write result.json; the app reads clip. If there is no armature, the job fails.'

export const IMAGE_PROCESS_USAGE_ZH =
  '用法：画布上所有图像编辑/抠图/重绘/扩图/超分/切格已统一收敛到「图像处理工作台」节点（typeId `image.process`，双击可进入全屏图像处理工作台；旧的独立节点 `image.upscale`/`image.expand`/`image.redraw`/`image.erase`/`image.matte`/`image.cutout`/`image.gridSplit`/`image.compose`/`image.crop`/`image.transform` 仅作存量兼容，新建图一律用 `image.process` 并通过 `params.imageProcessTool` 切换 10 种工具）：' +
  '① 本地像素工具：`crop`（裁剪，`cropAspectPreset`/`cropX`/`cropY`/`cropW`/`cropH`）、`transform`（旋转翻转缩放，`transformRotate`/`transformFlipH`/`transformFlipV`/`transformScale`）、`compose`（图层合成，`in` 前景 + `in-bg` 背景 + 可选 `in-mask` 蒙版，`composeBlendMode`/`composeOpacity`/`composeX`/`composeY`/`composeScale`）、`gridSplit`（宫格切图，`gridRows`/`gridCols`/`gridTrimTol` → `out-cells` 切出的全部单格图片 + `out` 首格）、`cutout`（本地去背景，`cutoutMode: "auto"|"color"|"rembg"`、`cutoutTolerance`、`cutoutFeather` → `out` 透明 PNG + `out-mask`）；' +
  '② AI 模型工具：`matte`（AI 精细抠图，`generateInstruction` 填主体描述 → `out` + `out-mask`）、`erase`（智能擦除，`in` + `in-mask` 或 `eraseMaskDataUrl`）、`redraw`（局部重绘，`in` + `in-mask` 或 `redrawMaskDataUrl` + `generateInstruction`）、`expand`（AI 扩图，`expandTop`/`expandBottom`/`expandLeft`/`expandRight` 或 `expandAspectRatio` + `generateInstruction`）、`upscale`（高清放大，`upscaleScale: 2|4` + `generateInstruction`）。'

export const IMAGE_PROCESS_USAGE_EN =
  'Usage: all image editing, matting, inpainting, outpainting, upscaling, and grid-slicing operations on the canvas are unified in the "Image Process Workbench" node (typeId `image.process`; double-click to open the full-screen workbench; legacy standalone `image.upscale`/`image.expand`/`image.redraw`/`image.erase`/`image.matte`/`image.cutout`/`image.gridSplit`/`image.compose`/`image.crop`/`image.transform` nodes are kept only for saved-graph compatibility — always create `typeId: "image.process"` and select the tool via `params.imageProcessTool`):' +
  ' (1) Local pixel tools: `crop` (`cropAspectPreset`/`cropX`/`cropY`/`cropW`/`cropH`), `transform` (`transformRotate`/`transformFlipH`/`transformFlipV`/`transformScale`), `compose` (foreground `in` + background `in-bg` + optional `in-mask`; `composeBlendMode`/`composeOpacity`/`composeX`/`composeY`/`composeScale`), `gridSplit` (`gridRows`/`gridCols`/`gridTrimTol` → `out-cells` sliced images + `out` first cell), `cutout` (`cutoutMode: "auto"|"color"|"rembg"`, `cutoutTolerance`, `cutoutFeather` → `out` RGBA + `out-mask`);' +
  ' (2) AI model tools: `matte` (`generateInstruction` subject → `out` + `out-mask`), `erase` (`in` + `in-mask` or `eraseMaskDataUrl`), `redraw` (`in` + `in-mask` or `redrawMaskDataUrl` + `generateInstruction`), `expand` (`expandTop`/`expandBottom`/`expandLeft`/`expandRight` or `expandAspectRatio` + `generateInstruction`), `upscale` (`upscaleScale: 2|4` + `generateInstruction`).'

export const AD_VARIANTS_USAGE_ZH =
  '用法：在节点图里添加「广告多维变体矩阵」节点（typeId `image.adVariants`，双击进入 4 步全屏工作台）。端口：`in`:image（可多连，接入产品白底图/主视觉锚点图）、`in-text`:text（产品卖点/Brief）→ `out`:image（主选变体图）、`out-all`:images（全部生成的广告变体图）、`out-prompts`:text（笛卡尔积提示词表）。' +
  '配置与运行：通过 `params.adVariantMatrix` 配置：① `industryPresetId`（内置 22 个行业预设，如美妆、3C、服饰、餐饮、游戏买量等）；② `aspectRatio`（如 `"9:16"` / `"1:1"` / `"16:9"`）与 `resolution`；③ `dimensions` 定义多维变量轴（`audience` 受众人群、`scene` 消费场景、`tone` 视觉调性、`copyAngle` 痛点利益点、`custom` 自定义维度）；④ 自动展开为 `cells` 笛卡尔积矩阵，支持勾选目标单元格批量并发出图，保持产品主体一致的同时一次性产出多受众×多场景×多调性的买量素材矩阵。'

export const AD_VARIANTS_USAGE_EN =
  'Usage: add the "Ad Multi-Variant Matrix" node (typeId `image.adVariants`; double-click for the 4-step full-screen workbench). Ports: `in`:image (multi-connect product/hero anchor images), `in-text`:text (product brief) → `out`:image (primary variant), `out-all`:images (all generated ad variants), `out-prompts`:text (Cartesian prompt table).' +
  ' Configure via `params.adVariantMatrix`: (1) `industryPresetId` (22 built-in industry presets across beauty, 3C, apparel, food, game UA, etc.); (2) `aspectRatio` and `resolution`; (3) `dimensions` (`audience`, `scene`, `tone`, `copyAngle`, `custom`); (4) Cartesian `cells` matrix for batch concurrent generation while preserving product identity.'

export const STAGE2D_DIRECTOR_USAGE_ZH =
  '用法：包含两个协同节点——①「精灵规整」（typeId `image.align`）：端口 `in`:image（可多连，批量输入立绘/图标/贴图）→ `out`:image、`out-all`:images、`out-preview`:image、`out-report`:text；支持自动/色度去底（`alignBgKey: "none"|"auto"|"color"`）、边缘杂色净化（`alignDefringe`）、统一画布尺寸与脚底/中心锚点对齐（`alignCanvasW`/`alignCanvasH`/`alignAnchor`）、四方连续无缝贴图化（`alignTileSeamless`）与 UI 九宫格切分检测（`alignNineSlice`）。' +
  '②「2D 舞台导演」（typeId `stage.2d`，双击进入全屏 2D 舞台与骨骼导演台）：端口 `in`:image（可多连，图层/角色立绘）、`in-bg`:image（舞台背景）→ `out`:image（合成舞台静帧）、`out-frames`:images（烘焙动作序列帧）、`out-sheet`:image（烘焙雪碧图）；支持多图层 Z 轴景深排布、2D 人形骨骼绑定、程序化动作（呼吸/行走/攻击/受击）与关键帧时间轴调姿，设 `stage2dAnimFps` 可直接烘焙序列帧与雪碧图，并支持在工作台内一键导出 Spine 兼容 JSON。'

export const STAGE2D_DIRECTOR_USAGE_EN =
  'Usage: combines two 2D production nodes — (1) "Sprite Align" (typeId `image.align`): ports `in`:image (multi-connect batch sprites/icons/tiles) → `out`:image, `out-all`:images, `out-preview`:image, `out-report`:text; supports background keying (`alignBgKey: "none"|"auto"|"color"`), edge defringing (`alignDefringe`), uniform canvas padding & anchor alignment (`alignCanvasW`/`alignCanvasH`/`alignAnchor`), seamless tile synthesis (`alignTileSeamless`), and 9-slice border detection (`alignNineSlice`).' +
  ' (2) "2D Stage Director" (typeId `stage.2d`; double-click for the full-screen 2D stage & bone director): ports `in`:image (multi-connect character/prop layers), `in-bg`:image (background) → `out`:image (composited stage), `out-frames`:images (baked animation frames), `out-sheet`:image (baked sprite sheet); supports multi-layer Z-stacking, 2D humanoid skeletal rigging, procedural/keyframe action baking (`stage2dAnimFps`), and Spine JSON export.'

export const VOICE_AUDIO_USAGE_ZH =
  '用法：语音与音频生成/处理由 4 个节点组成：① `voice.design`（音色设计：`in`:text 音色描述 + 可选 `in-sample`:audio 参考录音 → `out-voice`:voiceId 音色标识 + `out-preview`:audio 试听音频）；② `voice.tts`（AI 配音：`in`:text 台词/旁白 + 可选 `in-voice`:voiceId 绑定音色 → `out`:audio 语音资产；params：`ttsVoice`、`ttsSpeed`、`ttsEmotion`）；③ `audio.music`（音乐与音效生成：`in`:text 描述 → `out`:audio；params：`musicMode: "bgm"|"sfx"`、`musicDurationSec`、`musicInstrumental` 纯音乐开关）；④ `audio.separate`（人声伴奏分离：`in`:audio → `out-vocals`:audio 纯人声轨、`out-bgm`:audio 纯伴奏/环境音轨、`out-stems`:audio 全部分离音轨，适合短视频去人声换配音或提取纯净 BGM）。多镜头音画时间轴合成可再接 `video.compose`（支持视频轨、BGM 轨、音效轨、配音轨与字幕轨）。'

export const VOICE_AUDIO_USAGE_EN =
  'Usage: voice and audio workflows use 4 nodes: (1) `voice.design` (`in`:text voice prompt + optional `in-sample`:audio → `out-voice`:voiceId + `out-preview`:audio); (2) `voice.tts` (`in`:text script + optional `in-voice`:voiceId → `out`:audio speech; params `ttsVoice`, `ttsSpeed`, `ttsEmotion`); (3) `audio.music` (`in`:text prompt → `out`:audio; params `musicMode: "bgm"|"sfx"`, `musicDurationSec`, `musicInstrumental`); (4) `audio.separate` (local Demucs stem separation: `in`:audio → `out-vocals`:audio clean vocals, `out-bgm`:audio accompaniment, `out-stems`:audio all stems). Feed into `video.compose` for multi-track video/voice/BGM/subtitle editing.'

export const WORLD_SPATIAL_USAGE_ZH =
  '用法：空间世界建模与自由机位取景由 4 节点流水线组成：① `world.graph`（世界图谱：`in`:text 场景描述 + `in-image`:image 概念参考 → `out`:worldGraph 空间实体关系图、`out-scene-prompt`:text 全景提示词、`out-cam-json`:text 机位预设）；② `world.panoramic`（360° 全景图：`in`:text + `in-world`:worldGraph → `out-pano`:image 等距柱状全景图 + `out-depth`:image 深度图）；③ `world.extract`（世界提取：`in-pano`:image + `in-depth`:image + `in-world`:worldGraph 或 `in-images`:image 多视角图 → `out-splat`:model3d 3D 高斯点云 `.splat`/`.ply`、`out-mesh`:model3d 网格 `.glb`、`out-Collider`:model3d 碰撞体）；④ `world.splatView`（空间相机取景：`in-splat`:model3d 或 `in-mesh`:model3d + `in-cam`:text 机位轨迹 → `out`:image 当前机位渲染图、`out-frames`:images 序列帧、`out-video`:video 漫游视频，保持同一 3D 空间内任意机位切换绝对一致）。'

export const WORLD_SPATIAL_USAGE_EN =
  'Usage: spatial world modeling and free-camera rendering use a 4-node pipeline: (1) `world.graph` (`in`:text scene description + `in-image`:image concept ref → `out`:worldGraph spatial entity graph, `out-scene-prompt`:text, `out-cam-json`:text camera presets); (2) `world.panoramic` (`in`:text + `in-world`:worldGraph → `out-pano`:image 360° equirectangular panorama + `out-depth`:image depth map); (3) `world.extract` (`in-pano`:image + `in-depth`:image + `in-world`:worldGraph or `in-images`:image → `out-splat`:model3d 3DGS `.splat`/`.ply`, `out-mesh`:model3d `.glb`, `out-Collider`:model3d collision mesh); (4) `world.splatView` (`in-splat`:model3d or `in-mesh`:model3d + `in-cam`:text camera path → `out`:image view render, `out-frames`:images sequence, `out-video`:video camera walkthrough with 100% spatial consistency).'

export const SEMANTIC_TIMELINE_USAGE_ZH =
  '用法：视频语义级解构、要素替换（如电商换品/短剧换人换景）与镜头重建由 3 个节点组成：① `semantic.analyze`（视频语义解析：`in`:video 原片 + 可选 `in-text`:text 台词/提示 → `out-timeline`:semanticTimeline 结构化语义时间轴、`out-text`:text JSON 摘要；params：`semanticGranularity: "coarse"|"medium"|"fine"`，内部自动完成切镜、关键帧抽样、镜头语言描述、带证据链的事件抽取与导演意图反推）；② `semantic.compile`（语义编辑编译：`in-timeline`:semanticTimeline + `in-images`:image 新主体/新商品参考图（可多连，指令中可用 `@图片1`、`@角色A` 引用）+ `in-text`:text 自然语言改片指令 → `out-plan`:editPlan 镜头级重建计划、`out-timeline`、`out-prompt`、`out-refs`:images；params：`semanticOperation: "replace_entity"|"restyle"|"repace"|"highlight"|"custom"`、`semanticTargetId`、`semanticRulePackIds`）；③ `semantic.rebuild`（语义视频重建：`in-video`:video 原片 + `in-timeline` + `in-plan`:editPlan + `in-images`:image + 可选 `in-voice`:voiceId 配音音色 → `out`:video 重建成片、`out-shots`:videos 分镜视频组、`out-keyframes`:images 重建关键帧；未改动镜头自动无损复用原片切片，仅重拍受影响镜头并可自动合成新配音 `semanticAutoTts: true`）。'

export const SEMANTIC_TIMELINE_USAGE_EN =
  'Usage: semantic video deconstruction, entity replacement (e.g. e-commerce product swap or character/scene replacement), and shot-level video rebuild use a 3-node pipeline: (1) `semantic.analyze` (`in`:video source + optional `in-text`:text → `out-timeline`:semanticTimeline structured timeline, `out-text`:text JSON; params `semanticGranularity: "coarse"|"medium"|"fine"`, automatically running shot detection, shot description, evidence-backed event extraction, and director intent inference); (2) `semantic.compile` (`in-timeline`:semanticTimeline + `in-images`:image multi-connect replacement assets referenced via `@Image1`/`@Entity` + `in-text`:text edit instruction → `out-plan`:editPlan, `out-timeline`, `out-prompt`, `out-refs`:images; params `semanticOperation: "replace_entity"|"restyle"|"repace"|"highlight"|"custom"`, `semanticTargetId`, `semanticRulePackIds`); (3) `semantic.rebuild` (`in-video`:video + `in-timeline` + `in-plan`:editPlan + `in-images`:image + optional `in-voice`:voiceId → `out`:video rebuilt full video, `out-shots`:videos per-shot clips, `out-keyframes`:images; untouched shots reuse original video slices while modified shots are regenerated with optional TTS dubbing `semanticAutoTts: true`).'

function fromEpisodePack(
  id: string,
  pack: EpisodeAgentPromptPack,
  titleZh: string,
  titleEn: string,
  parse: NodeCapabilityParseKind | undefined,
  kind: NodeCapabilityKind = 'episode',
  usage?: { usageZh: string; usageEn: string }
): NodeCapabilityDef {
  return {
    id,
    kind,
    titleZh,
    titleEn,
    systemPromptZh: pack.systemPromptZh,
    systemPromptEn: pack.systemPromptEn,
    instructionZh: pack.instructionZh,
    instructionEn: pack.instructionEn,
    ...(usage ? { usageZh: usage.usageZh, usageEn: usage.usageEn } : {}),
    parse
  }
}

function fromNodeSystemDefault(
  id: string,
  titleZh: string,
  titleEn: string,
  system: (locale?: string) => string,
  usage?: { usageZh: string; usageEn: string }
): NodeCapabilityDef {
  return {
    id,
    kind: 'node',
    titleZh,
    titleEn,
    systemPromptZh: system('zh-CN'),
    systemPromptEn: system('en-US'),
    ...(usage ? { usageZh: usage.usageZh, usageEn: usage.usageEn } : {})
  }
}

const BUILTIN_NODE_CAPABILITIES: NodeCapabilityDef[] = [
  fromEpisodePack(
    'episode.breakdown',
    EPISODE_AGENT_BREAKDOWN,
    '分镜师·节拍拆解表',
    'Storyboard · beat breakdown',
    'beatBreakdown',
    'episode',
    {
      usageZh:
        '提示：这是传统 9 宫格 / 4 宫格分镜板管线（`episode.*`）的节拍拆解预设。若用户要做短剧、漫剧、多集连载或影视全流程（结构化分镜 + 导演审核 + 角色场景设定图 + 批量关键帧与视频），请优先使用合一的 `film.workbench`（影视工作台）。',
      usageEn:
        'Note: this preset belongs to the classic 9-grid / 4-grid contact-sheet beatboard pipeline (`episode.*`). For short dramas, multi-episode series, or full film production (structured storyboard + director review + cast/location sheets + batch keyframes & videos), prefer the unified `film.workbench` node.'
    }
  ),
  fromEpisodePack(
    'episode.beatboard',
    EPISODE_AGENT_BEATBOARD,
    '分镜师·9宫格分镜表',
    'Storyboard · 9-grid beat board',
    'beatBoard'
  ),
  fromEpisodePack(
    'episode.sequence',
    EPISODE_AGENT_SEQUENCE,
    '分镜师·4宫格动态分镜表',
    'Storyboard · 4-grid sequence',
    'sequenceBoard'
  ),
  fromEpisodePack(
    'episode.motion',
    EPISODE_AGENT_MOTION,
    '动画师·动态提示词表',
    'Animator · motion prompts',
    'motionPrompts'
  ),
  fromEpisodePack(
    'episode.motion9',
    EPISODE_AGENT_MOTION_9,
    '动画师·9宫格动态提示词表',
    'Animator · 9-grid motion prompts',
    'motionPrompts'
  ),
  fromEpisodePack(
    'episode.review.breakdown',
    EPISODE_AGENT_REVIEW_BREAKDOWN,
    '导演审核·节拍拆解表',
    'Director review · beat breakdown',
    'directorVerdict',
    'episode-review'
  ),
  fromEpisodePack(
    'episode.review.beatboard',
    EPISODE_AGENT_REVIEW_BEATBOARD,
    '导演审核·9宫格分镜表',
    'Director review · 9-grid beat board',
    'directorVerdict',
    'episode-review'
  ),
  fromEpisodePack(
    'episode.review.sequence',
    EPISODE_AGENT_REVIEW_SEQUENCE,
    '导演审核·4宫格动态分镜表',
    'Director review · 4-grid sequence',
    'directorVerdict',
    'episode-review'
  ),
  fromEpisodePack(
    'episode.review.motion',
    EPISODE_AGENT_REVIEW_MOTION,
    '导演审核·动态提示词表',
    'Director review · motion prompts',
    'directorVerdict',
    'episode-review'
  ),
  fromEpisodePack(
    'episode.review.motion9',
    EPISODE_AGENT_REVIEW_MOTION_9,
    '导演审核·9宫格动态提示词表',
    'Director review · 9-grid motion',
    'directorVerdict',
    'episode-review'
  ),
  {
    id: 'episode.image.grid9',
    kind: 'episode-image',
    titleZh: '9宫格拼图·锚点画布',
    titleEn: '9-grid collage canvas',
    instructionZh: GRID9_IMAGE_ZH,
    instructionEn: GRID9_IMAGE_EN
  },
  {
    id: 'episode.image.grid4',
    kind: 'episode-image',
    titleZh: '4宫格拼图',
    titleEn: '4-grid collage',
    instructionZh: GRID4_IMAGE_ZH,
    instructionEn: GRID4_IMAGE_EN
  },
  {
    id: 'episode.video.grid4',
    kind: 'episode-video',
    titleZh: '动态视频·4宫格',
    titleEn: 'Motion video · 4-grid',
    instructionZh: VIDEO_GRID4_ZH,
    instructionEn: VIDEO_GRID4_EN
  },
  {
    id: 'episode.video.grid9',
    kind: 'episode-video',
    titleZh: '动态视频·9宫格直出',
    titleEn: 'Motion video · 9-grid',
    instructionZh: VIDEO_GRID9_ZH,
    instructionEn: VIDEO_GRID9_EN
  },
  {
    id: 'anim.2d',
    kind: 'anim2d',
    titleZh: '2D 帧动画（GIF）',
    titleEn: '2D frame animation (GIF)',
    systemPromptZh: resolveFrameAnimGenSystemPrompt(undefined, 'zh-CN'),
    systemPromptEn: resolveFrameAnimGenSystemPrompt(undefined, 'en-US'),
    instructionZh: ANIM2D_FRAMES_INSTRUCTION_ZH,
    instructionEn: ANIM2D_FRAMES_INSTRUCTION_EN,
    usageZh: ANIM2D_FRAMES_USAGE_ZH,
    usageEn: ANIM2D_FRAMES_USAGE_EN
  },
  {
    id: 'stage.2d',
    kind: 'anim2d',
    titleZh: '2D 舞台导演与精灵规整',
    titleEn: '2D stage director & sprite align',
    usageZh: STAGE2D_DIRECTOR_USAGE_ZH,
    usageEn: STAGE2D_DIRECTOR_USAGE_EN
  },
  {
    id: 'image.align',
    kind: 'anim2d',
    titleZh: '精灵规整',
    titleEn: 'Sprite align',
    usageZh: STAGE2D_DIRECTOR_USAGE_ZH,
    usageEn: STAGE2D_DIRECTOR_USAGE_EN
  },
  {
    id: 'svg.gen',
    kind: 'svg',
    titleZh: 'SVG 矢量图与矢量动画（GIF）',
    titleEn: 'SVG vector art / vector animation (GIF)',
    instructionZh: SVG_MOTION_INSTRUCTION_ZH,
    instructionEn: SVG_MOTION_INSTRUCTION_EN,
    usageZh: SVG_MOTION_USAGE_ZH,
    usageEn: SVG_MOTION_USAGE_EN
  },
  {
    id: 'svg.anim',
    kind: 'svg',
    titleZh: 'SVG 烘焙',
    titleEn: 'SVG bake',
    usageZh: SVG_MOTION_USAGE_ZH,
    usageEn: SVG_MOTION_USAGE_EN
  },
  {
    id: 'film.workbench',
    kind: 'film',
    titleZh: '影视全流程（分镜 / 设定 / 拍摄）',
    titleEn: 'Film pipeline (storyboard / cast / shoot)',
    systemPromptZh: pickFilmPrompt(FILM_BREAKDOWN_SYSTEM, 'zh-CN'),
    systemPromptEn: pickFilmPrompt(FILM_BREAKDOWN_SYSTEM, 'en-US'),
    usageZh: FILM_PIPELINE_USAGE_ZH,
    usageEn: FILM_PIPELINE_USAGE_EN
  },
  {
    id: 'film.shot',
    kind: 'film',
    titleZh: '单镜头精修',
    titleEn: 'Film shot polish',
    usageZh: FILM_PIPELINE_USAGE_ZH,
    usageEn: FILM_PIPELINE_USAGE_EN
  },
  {
    id: 'game.htmlGen',
    kind: 'gameplay',
    titleZh: '可玩 HTML（程序化资产）',
    titleEn: 'Playable HTML (procedural assets)',
    usageZh: GAMEPLAY_PROC_ASSETS_USAGE_ZH,
    usageEn: GAMEPLAY_PROC_ASSETS_USAGE_EN
  },
  {
    id: 'tutorial.recording',
    kind: 'tutorial',
    titleZh: '教学视频自动录制',
    titleEn: 'Tutorial screen recording',
    usageZh: TUTORIAL_RECORDING_USAGE_ZH,
    usageEn: TUTORIAL_RECORDING_USAGE_EN
  },
  {
    id: 'model.rigSkin',
    kind: 'blender',
    titleZh: '3D 骨骼蒙皮',
    titleEn: '3D rig & skin',
    systemPromptZh: BLENDER_RIG_SYSTEM_ZH,
    systemPromptEn: BLENDER_RIG_SYSTEM_EN,
    instructionZh: BLENDER_RIG_INSTRUCTION_ZH,
    instructionEn: BLENDER_RIG_INSTRUCTION_EN,
    usageZh: BLENDER_RIG_USAGE_ZH,
    usageEn: BLENDER_RIG_USAGE_EN
  },
  {
    id: 'model.pose',
    kind: 'blender',
    titleZh: '3D 姿势',
    titleEn: '3D pose',
    systemPromptZh: BLENDER_JOB_SYSTEM_ZH,
    systemPromptEn: BLENDER_JOB_SYSTEM_EN,
    instructionZh: BLENDER_POSE_INSTRUCTION_ZH,
    instructionEn: BLENDER_POSE_INSTRUCTION_EN,
    usageZh: BLENDER_POSE_USAGE_ZH,
    usageEn: BLENDER_POSE_USAGE_EN
  },
  {
    id: 'model.animation',
    kind: 'blender',
    titleZh: '3D 关键帧动画',
    titleEn: '3D keyframe animation',
    systemPromptZh: BLENDER_JOB_SYSTEM_ZH,
    systemPromptEn: BLENDER_JOB_SYSTEM_EN,
    instructionZh: BLENDER_ANIM_INSTRUCTION_ZH,
    instructionEn: BLENDER_ANIM_INSTRUCTION_EN,
    usageZh: BLENDER_ANIM_USAGE_ZH,
    usageEn: BLENDER_ANIM_USAGE_EN
  },
  {
    id: 'image.process',
    kind: 'node',
    titleZh: '图像处理工作台（十合一）',
    titleEn: 'Image process workbench (10-in-1)',
    usageZh: IMAGE_PROCESS_USAGE_ZH,
    usageEn: IMAGE_PROCESS_USAGE_EN
  },
  {
    id: 'image.adVariants',
    kind: 'node',
    titleZh: '广告多维变体矩阵',
    titleEn: 'Ad multi-variant matrix',
    usageZh: AD_VARIANTS_USAGE_ZH,
    usageEn: AD_VARIANTS_USAGE_EN
  },
  {
    id: 'voice.tts',
    kind: 'node',
    titleZh: 'AI 配音、音色设计与音乐分离',
    titleEn: 'AI voice TTS, voice design, music & stem separation',
    usageZh: VOICE_AUDIO_USAGE_ZH,
    usageEn: VOICE_AUDIO_USAGE_EN
  },
  {
    id: 'voice.design',
    kind: 'node',
    titleZh: '音色设计',
    titleEn: 'Voice design',
    usageZh: VOICE_AUDIO_USAGE_ZH,
    usageEn: VOICE_AUDIO_USAGE_EN
  },
  {
    id: 'audio.music',
    kind: 'node',
    titleZh: '音乐与音效生成',
    titleEn: 'Music & SFX',
    usageZh: VOICE_AUDIO_USAGE_ZH,
    usageEn: VOICE_AUDIO_USAGE_EN
  },
  {
    id: 'audio.separate',
    kind: 'node',
    titleZh: '人声伴奏分离',
    titleEn: 'Audio stem separation',
    usageZh: VOICE_AUDIO_USAGE_ZH,
    usageEn: VOICE_AUDIO_USAGE_EN
  },
  {
    id: 'world.splatView',
    kind: 'node',
    titleZh: '世界模型与 3DGS 空间相机',
    titleEn: 'World model & 3DGS spatial camera',
    systemPromptZh: defaultWorldExtractSystemPrompt('zh-CN'),
    systemPromptEn: defaultWorldExtractSystemPrompt('en-US'),
    usageZh: WORLD_SPATIAL_USAGE_ZH,
    usageEn: WORLD_SPATIAL_USAGE_EN
  },
  fromNodeSystemDefault('play.script', '剧本', 'Screenplay', defaultScreenplaySystemPrompt, {
    usageZh:
      '对应画布节点 `play.script`（剧本/策划案节点）：既可直接将成稿剧本写入 `params.text` 作为 `film.workbench` 的上游输入，也可设 `params.generateInstruction` 让文本模型按专业影视剧本格式创作、续写或改写剧本，经 `out`:text 输出。',
    usageEn:
      'Maps to canvas node `play.script`: either store an existing script directly in `params.text` to feed `film.workbench`, or set `params.generateInstruction` to have the LLM write/continue/rewrite a formatted screenplay emitted via `out`:text.'
  }),
  fromNodeSystemDefault(
    'asset.gameSystem',
    '策划案',
    'Game system',
    defaultGameSystemSystemPrompt,
    {
      usageZh:
        '对应画布节点 `play.script` / `asset.gameSystem`：输入一句话玩法或题材，产出结构化游戏系统策划案，可下游接 `ui.split`（界面拆分）、`image.iconPack`（图标套包）或 `game.htmlGen`（可玩 HTML 生成）。',
      usageEn:
        'Maps to canvas node `play.script` / `asset.gameSystem`: turns a high-level game pitch into a structured game system design document that can feed `ui.split`, `image.iconPack`, or `game.htmlGen`.'
    }
  ),
  fromNodeSystemDefault('asset.image', '图片生成', 'Image', defaultImageSystemPrompt, {
    usageZh:
      '对应画布节点 `asset.image`（图片生成）：端口 `in`:text（提示词）、`in-image`:image（可多连参考图，提示词中可用 `@1`、`@2` 或 `[图1]` 按连接顺序引用）→ `out`:image（当前选中图）、`out-all`:images（单次并发或历次生成的全部图片，供 `image.select` 选图）。关键 params：`generateInstruction`、`generateAspectRatio`（如 `"1:1"`/`"16:9"`/`"9:16"`）、`generateResolution`（`"1K"`/`"2K"`/`"4K"`）、`generateCount`（并发张数 1~4）、`generateTransparentBg`（布尔值，开启后自动附加纯色干净背景提示词并在出图后键控抠除背景输出透明 PNG）、`imageCamera`（可选 3D 虚拟摄影机视角控制）。',
    usageEn:
      'Maps to canvas node `asset.image`: ports `in`:text (prompt), `in-image`:image (multi-connect reference images, referenced in prompts as `@1`, `@2` or `[Image1]`) → `out`:image (selected), `out-all`:images (all generated images for `image.select`). Key params: `generateInstruction`, `generateAspectRatio`, `generateResolution`, `generateCount`, `generateTransparentBg` (boolean, auto-appends solid-bg prompt and keys out background into a transparent PNG), `imageCamera`.'
  }),
  fromNodeSystemDefault('ui.gen', '界面图', 'UI image', defaultUiImageSystemPrompt, {
    usageZh:
      '对应画布节点 `ui.gen`（游戏 UI 生成，上游常接 `ui.split`）：端口 `in`:text（界面描述）、`in-manifest`:uiManifest（`ui.split` 产出的结构化组件清单）、`in-image`:image（风格参考图）→ `out-preview`:image（整张 UI 效果图）、`out`:images（切出的独立透明组件 PNG 序列）、`out-sheet`:image（UI 图集 Atlas）、`out-meta`:text（组件坐标布局 JSON）。',
    usageEn:
      'Maps to canvas node `ui.gen` (often wired after `ui.split`): ports `in`:text, `in-manifest`:uiManifest, `in-image`:image (style ref) → `out-preview`:image (full UI mockup), `out`:images (sliced transparent component PNGs), `out-sheet`:image (atlas), `out-meta`:text (layout JSON).'
  }),
  fromNodeSystemDefault('asset.video', '视频生成', 'Video', defaultVideoSystemPrompt, {
    usageZh:
      '对应画布节点 `asset.video`（视频生成）：端口 `in`:text（动态提示词）、`in-image`:image（首帧图）、`in-last-frame`:image（尾帧图，用于首尾帧过渡视频）、`in-ref-images`:image（可多连主体参考图）、`in-video`:video（参考视频）、`in-audio`:audio（驱动音频）→ `out`:video、`out-all`:videos。关键 params：`generateInstruction`、`videoDurationSec`（如 `5`/`10`）、`videoResolution`（`"720p"`/`"1080p"`）、`videoWithAudio`（是否生成原生音效）、`videoCameraMove`。',
    usageEn:
      'Maps to canvas node `asset.video`: ports `in`:text (motion prompt), `in-image`:image (first frame), `in-last-frame`:image (end frame), `in-ref-images`:image (multi-ref), `in-video`:video, `in-audio`:audio → `out`:video, `out-all`:videos. Key params: `generateInstruction`, `videoDurationSec`, `videoResolution`, `videoWithAudio`, `videoCameraMove`.'
  }),
  fromNodeSystemDefault(
    'prompt.optimize',
    '提示词优化',
    'Prompt optimize',
    defaultOptimizeSystemPrompt,
    {
      usageZh:
        '对应画布节点 `prompt.optimize`（提示词优化）：端口 `in`:text（粗略想法）、`in-image`:image（可选视觉参考）→ `out`:text（润色后的高质量生图/生视频提示词），可直接连入 `asset.image` 或 `asset.video` 的 `in` 端口。',
      usageEn:
        'Maps to canvas node `prompt.optimize`: ports `in`:text (rough idea), `in-image`:image (optional visual ref) → `out`:text (polished image/video prompt) ready to wire into `asset.image` or `asset.video`.'
    }
  ),
  fromNodeSystemDefault(
    'image.toPrompt',
    '图生提示词',
    'Image to prompt',
    defaultToPromptSystemPrompt,
    {
      usageZh:
        '对应画布节点 `image.toPrompt`（图生提示词）：端口 `in`:image → `out`:text，用视觉多模态模型反推输入图片的主体、构图、光影、材质与画风提示词。',
      usageEn:
        'Maps to canvas node `image.toPrompt`: ports `in`:image → `out`:text, reverse-engineering an image into a detailed subject, composition, lighting, material, and style prompt.'
    }
  ),
  fromNodeSystemDefault(
    'world.extract',
    '世界提取',
    'World extract',
    defaultWorldExtractSystemPrompt,
    {
      usageZh: WORLD_SPATIAL_USAGE_ZH,
      usageEn: WORLD_SPATIAL_USAGE_EN
    }
  ),
  fromNodeSystemDefault('beat.split', '节拍拆分', 'Beat split', defaultBeatSplitSystemPrompt, {
    usageZh:
      '对应传统节拍拆分文本节点；若需在画布上构建完整的短剧/影视分镜、角色场景设定与批量关键帧视频拍摄，请优先使用 `film.workbench` 节点。',
    usageEn:
      'Classic beat-splitting text prompt node; for full storyboard breakdown, cast/location sheets, and batch keyframe/video production on the canvas, prefer `film.workbench`.'
  }),
  fromNodeSystemDefault('ui.split', '界面拆分', 'UI split', defaultUiSplitSystemPrompt, {
    usageZh:
      '对应画布节点 `ui.split`（界面拆分）：端口 `in`:text（策划案或界面需求）、`in-image`:image（可选草图/线框图）→ `out`:text（可读界面规范）、`out-manifest`:uiManifest（结构化 UI 组件清单，直接连入下游 `ui.gen` 的 `in-manifest` 端口生成整套游戏 UI 与切图）。',
    usageEn:
      'Maps to canvas node `ui.split`: ports `in`:text (game doc or UI spec), `in-image`:image (optional wireframe) → `out`:text (spec), `out-manifest`:uiManifest (structured component manifest to wire into `ui.gen` `in-manifest`).'
  }),
  fromNodeSystemDefault('image.upscale', '高清放大', 'Upscale', defaultUpscaleSystemPrompt, {
    usageZh: IMAGE_PROCESS_USAGE_ZH,
    usageEn: IMAGE_PROCESS_USAGE_EN
  }),
  fromNodeSystemDefault('image.expand', '扩图', 'Expand', defaultExpandSystemPrompt, {
    usageZh: IMAGE_PROCESS_USAGE_ZH,
    usageEn: IMAGE_PROCESS_USAGE_EN
  }),
  fromNodeSystemDefault('image.redraw', '重绘', 'Redraw', defaultRedrawSystemPrompt, {
    usageZh: IMAGE_PROCESS_USAGE_ZH,
    usageEn: IMAGE_PROCESS_USAGE_EN
  }),
  fromNodeSystemDefault('image.erase', '擦除', 'Erase', defaultEraseSystemPrompt, {
    usageZh: IMAGE_PROCESS_USAGE_ZH,
    usageEn: IMAGE_PROCESS_USAGE_EN
  }),
  fromNodeSystemDefault('image.matte', '抠图', 'Matte', defaultMatteSystemPrompt, {
    usageZh: IMAGE_PROCESS_USAGE_ZH,
    usageEn: IMAGE_PROCESS_USAGE_EN
  }),
  fromNodeSystemDefault(
    'image.multiAngle',
    '多角度',
    'Multi-angle',
    defaultMultiAngleSystemPrompt,
    {
      usageZh:
        '对应画布节点 `image.multiAngle`（多视角生成）：端口 `in`:image（主体参考图）、`in-text`:text → `out`:image、`out-all`:images。支持 `params.multiAngleMode`：`"sheet"`（生成正/侧/背三视图或四视图设定表）、`"views"`（多机位并发单图）、`"camera"`（按 `multiAngleAzimuth` 水平角、`multiAngleElevation` 俯仰角、`multiAngleDistance` 景别切换单张机位），可直接为下游 `asset.model3d`（3D 模型生成）提供正侧背多视角输入。',
      usageEn:
        'Maps to canvas node `image.multiAngle`: ports `in`:image (subject ref), `in-text`:text → `out`:image, `out-all`:images. Supports `params.multiAngleMode`: `"sheet"` (orthographic turnaround sheet), `"views"` (multi-view batch), or `"camera"` (3D orbit camera via `multiAngleAzimuth`, `multiAngleElevation`, `multiAngleDistance`), ideal for feeding multi-view inputs into `asset.model3d`.'
    }
  ),
  fromNodeSystemDefault('image.lighting', '灯光', 'Lighting', defaultLightingSystemPrompt, {
    usageZh:
      '对应画布节点 `image.lighting`（智能打光工作台）：端口 `in`:image、`in-text`:text → `out`:image。通过 `params.lightingPresetId`（棚拍柔光、赛博霓虹、伦勃朗光、黄金时刻等预设）或 `params.lightingState`（多光源 3D 方向、色温、强度、轮廓光与环境光配置）对画面重打光，`lightingPreserveSubject: true` 时严格锁死人物五官与商品材质仅改变光影。',
    usageEn:
      'Maps to canvas node `image.lighting`: ports `in`:image, `in-text`:text → `out`:image. Configure studio relighting via `params.lightingPresetId` or `params.lightingState` (multi-light 3D azimuth/elevation, color, intensity, rim light) with `lightingPreserveSubject: true` to preserve subject identity.'
  }),
  fromNodeSystemDefault(
    'image.portrait',
    '人像精修',
    'Portrait retouch',
    defaultPortraitTextureSystemPrompt,
    {
      usageZh:
        '对应画布节点 `image.portrait`（人像精修与证件照工作台，双击进入全屏人像精修台）：端口 `in`:image（可多连，支持单张或批量商业人像精修）、`in-text`:text → `out`:image、`out-all`:images、`out-sheet`:image（证件照排版冲印版）。通过 `params.portraitRetouch` 配置 5 档强度（`off|light|standard|strong|max`）的磨皮保留毛孔质感（`skin`）、五官立体微调（`face`）、眼神光与亮眼（`eyes`）、美体塑形（`slimming`）、妆容（`makeup`）、发丝（`hair`）、光影（`lighting`），支持局部手动圈选精修区域（`manualRegions`）以及一寸/二寸/小二寸/美签等标准证件照换底与冲印排版（`idPhotoSpecId`、`idPhotoBg`、`idPhotoSheet`）。',
      usageEn:
        'Maps to canvas node `image.portrait` (AI Portrait Retouch & ID Photo Workbench; double-click for the full-screen editor): ports `in`:image (multi-connect for batch retouching), `in-text`:text → `out`:image, `out-all`:images, `out-sheet`:image (ID photo print sheet). Configure via `params.portraitRetouch` with 5-tier controls (`off|light|standard|strong|max`) for `skin`, `face`, `eyes`, `slimming`, `makeup`, `hair`, `lighting`, plus `manualRegions` and standard ID photo specs (`idPhotoSpecId`, `idPhotoBg`, `idPhotoSheet`).'
    }
  ),
  fromNodeSystemDefault(
    'image.Consistent',
    '角色一致性',
    'Consistent character',
    defaultEmotionSystemPrompt,
    {
      usageZh:
        '对应画布节点 `image.Consistent`（角色一致性与表情姿态面板）：端口 `in`:image（角色基准图）、`in-pose`:image（可选姿态参考图）、`in-text`:text → `out`:image、`out-all`:images。支持通过 2D 情绪面板（`params.emotionPad`：愉悦度 valence × 唤醒度 arousal）与锁定项（`consistentLockIds`：锁脸型、锁服饰、锁发型、锁画风）生成同一角色的不同表情包或新动作立绘。',
      usageEn:
        'Maps to canvas node `image.Consistent` (character consistency & expression/pose generator): ports `in`:image (character ref), `in-pose`:image (optional pose ref), `in-text`:text → `out`:image, `out-all`:images. Use `params.emotionPad` (2D valence × arousal pad) and `consistentLockIds` (`face`, `outfit`, `hair`, `style`) to generate consistent character expressions and poses.'
    }
  ),
  {
    id: 'semantic.analyze',
    kind: 'node',
    titleZh: '视频语义解析',
    titleEn: 'Semantic analyze',
    usageZh: SEMANTIC_TIMELINE_USAGE_ZH,
    usageEn: SEMANTIC_TIMELINE_USAGE_EN
  },
  {
    id: 'semantic.compile',
    kind: 'node',
    titleZh: '语义编辑编译',
    titleEn: 'Semantic compile',
    usageZh: SEMANTIC_TIMELINE_USAGE_ZH,
    usageEn: SEMANTIC_TIMELINE_USAGE_EN
  },
  {
    id: 'semantic.rebuild',
    kind: 'node',
    titleZh: '语义视频重建',
    titleEn: 'Semantic rebuild',
    usageZh: SEMANTIC_TIMELINE_USAGE_ZH,
    usageEn: SEMANTIC_TIMELINE_USAGE_EN
  }
]

const capabilityStacks = new Map<string, NodeCapabilityDef[]>(
  BUILTIN_NODE_CAPABILITIES.map((cap) => [cap.id, [cap]])
)

export function registerNodeCapability(cap: NodeCapabilityDef): () => void {
  const id = cap.id.trim()
  if (!id) throw new Error('NodeCapabilityDef id is empty')
  const entry = id === cap.id ? cap : { ...cap, id }
  const stack = capabilityStacks.get(id) ?? []
  stack.push(entry)
  capabilityStacks.set(id, stack)
  return () => {
    const next = (capabilityStacks.get(id) ?? []).filter((item) => item !== entry)
    if (next.length) capabilityStacks.set(id, next)
    else capabilityStacks.delete(id)
  }
}

export function getNodeCapability(id: string | undefined | null): NodeCapabilityDef | undefined {
  const key = id?.trim()
  if (!key) return undefined
  const stack = capabilityStacks.get(key)
  return stack?.[stack.length - 1]
}

export function listNodeCapabilities(): NodeCapabilityDef[] {
  return [...capabilityStacks.values()].flatMap((stack) => {
    const top = stack[stack.length - 1]
    return top ? [top] : []
  })
}

export type NodePresetApplyVars = Record<string, string | number>

export interface ApplyNodePresetOptions {
  locale?: string
  vars?: NodePresetApplyVars
}

function interpolate(template: string, vars?: NodePresetApplyVars): string {
  if (!vars) return template
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = vars[key]
    return value == null ? match : String(value)
  })
}

function isEnglishLocale(locale?: string): boolean {
  return (locale ?? '').toLowerCase().startsWith('en')
}

/**
 * 套用节点预设到节点 params：直接写入当时的指令与系统提示词（不再写入伪 `skillId`）。
 */
export function applyNodePreset(
  id: string,
  options?: ApplyNodePresetOptions
): Pick<GraphNodeParams, 'generateInstruction' | 'generateSystemPrompt'> {
  const cap = getNodeCapability(id)
  if (!cap) {
    return {}
  }
  const pack: EpisodeAgentPromptPack = {
    systemPromptZh: cap.systemPromptZh ?? '',
    systemPromptEn: cap.systemPromptEn ?? cap.systemPromptZh ?? '',
    instructionZh: cap.instructionZh ?? '',
    instructionEn: cap.instructionEn ?? cap.instructionZh ?? ''
  }
  const system = pickEpisodeAgentPrompt(pack, options?.locale, 'systemPrompt').trim()
  const instruction = interpolate(
    pickEpisodeAgentPrompt(pack, options?.locale, 'instruction'),
    options?.vars
  ).trim()
  return {
    ...(system ? { generateSystemPrompt: system } : {}),
    ...(instruction ? { generateInstruction: instruction } : {})
  }
}

export function nodeCapabilityTitle(cap: NodeCapabilityDef, locale?: string): string {
  return isEnglishLocale(locale) ? cap.titleEn : cap.titleZh
}
