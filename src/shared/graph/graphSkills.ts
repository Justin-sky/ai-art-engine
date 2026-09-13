/**
 * GraphSkill 目录：系统提示 + 用户指令 + 可选解析约定。
 * 节点用 params.skillId 绑定；执行仍读 generateInstruction / generateSystemPrompt。
 * instructionPresets（检查器插入片段）不在本目录。
 *
 * 语义约定：
 * - 快照：applyGraphSkill 把当前文案写入 params，之后修改 Skill 不会自动更新已应用节点；
 *   用户改节点 params 文案即覆盖。
 * - system.* 是 systemPromptSchemes 的镜像，供带 skillId 的节点绑定；未绑定的旧节点仍走
 *   systemPromptSchemes.resolve*。
 * - 采用 params.skillId 而非 NodeTypeDefinition.defaultSkillKind：同一 typeId（如
 *   asset.image）可扮演九宫格、四宫格、立绘等多种角色，按 typeId 绑死不成立。
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
  defaultBeatUnitGenSystemPrompt,
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
  defaultTimbreSystemPrompt,
  defaultWorldExtractSystemPrompt
} from './systemPromptSchemes'
import type { GraphNodeParams } from './types'
import { resolveFrameAnimGenSystemPrompt } from './anim2d'

export type GraphSkillKind =
  | 'episode'
  | 'episode-review'
  | 'episode-image'
  | 'episode-video'
  | 'anim2d'
  | 'svg'
  | 'system'

/** 解析入口指针；实现仍在 episodeBoardParse 等文件，此处不搬家 */
export type GraphSkillParseKind =
  | 'beatBreakdown'
  | 'beatBoard'
  | 'sequenceBoard'
  | 'motionPrompts'
  | 'directorVerdict'

export interface GraphSkill {
  id: string
  kind: GraphSkillKind
  titleZh: string
  titleEn: string
  systemPromptZh?: string
  systemPromptEn?: string
  instructionZh?: string
  instructionEn?: string
  /**
   * dsh 技能快照（SKILL.md）里给 Agent 看的「用法」说明：怎么把这个能力变成产物。
   * 只进技能文件，不参与 applyGraphSkill 写入节点 params（避免操作说明污染生成提示词）。
   */
  usageZh?: string
  usageEn?: string
  parse?: GraphSkillParseKind
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
  'From the upstream reference image and this dynamic cell\'s image-to-video instruction, generate the dynamic video for cell {group}-{cell}. The reference image only provides style and content reference; strictly follow the camera movement, subject action, environment interaction, and duration in the instruction.'

const VIDEO_GRID9_EN =
  'From the reference first-frame image and the upstream motion prompts, generate an image-to-video clip: preserve the character identity, outfit, hairstyle, scene, key-light direction, and composition tone from the reference image; strictly follow the timeline, camera movement, subject action, full dialogue, and ambient sound in the motion prompt.'

/** 2D 帧动画：动作描述模板（{action} / {rows} / {cols} 由 applyGraphSkill 的 vars 插值） */
const ANIM2D_FRAMES_INSTRUCTION_ZH =
  '为同一角色生成「{action}」动作的序列图（sprite sheet）：在一张图内按 {rows}×{cols} 分格绘制一个完整动作周期，帧序从左到右、从上到下；所有格子中角色的外观、体型、配色与画风完全一致，仅姿态变化，帧间过渡自然。'

const ANIM2D_FRAMES_INSTRUCTION_EN =
  'Generate a sprite sheet of the "{action}" action for the same character: draw one complete action cycle inside a single image as a {rows}×{cols} grid, frame order left to right then top to bottom; keep the character\'s look, proportions, palette and art style identical across every cell, changing only the pose, with smooth transitions between frames.'

/** 2D 帧动画：dsh 技能快照里的操作说明（GIF 产出的完整链路，不进节点 params） */
const ANIM2D_FRAMES_USAGE_ZH =
  '用法：在节点图里添加「2D帧动画」节点（typeId `anim.2d`），把一张按 rows×cols 分格的序列图（sprite sheet）接到 in 端口，设 animRows / animCols 与动作预设 animPresetId（或自定义 animInstruction），再把 animGifFps 设为 8–12 后运行：节点逐格切出帧 PNG，并额外经 out-gif 端口产出 GIF 动图（随运行落盘为工程资产）。还没有序列图时，可上游接一个按分格绘制的图片节点，或 dive 进本节点内图用生图 API 生成。' +
  '走 MCP 时最少 3 次调用，且不必先调 workflow_plan（workflow_commit 直接收手写 plan）：① workflow_commit({ plan, name }) —— plan 为 {"title":"2D 帧动画","nodes":[{"key":"sheet","typeId":"asset.image","params":{"generateInstruction":"为同一角色生成「<动作>」动作的序列图：一张图内按 <rows> 行 <cols> 列分格，帧序从左到右、从上到下，各格角色的外观、体型、配色与画风完全一致，仅姿态不同"}},{"key":"anim","typeId":"anim.2d","params":{"animRows":<rows>,"animCols":<cols>,"animPresetId":"walk","animInstruction":"<动作循环描述>","animGifFps":12}}],"edges":[{"from":"sheet","to":"anim"}]}，返回 assetId；② task_run({ assetId }) 返回 mcpTaskId；③ task_status({ mcpTaskId }) 取产物（生图加编码约 30–90 秒，可能要轮询若干次）。animRows / animCols 必须与序列图实际行列一致，animGifFps 必须显式给出且大于 0（默认 0 只切帧、不出 GIF）。只有改动已存在的资产时才用 graph_node_types / graph_read / graph_edit。'

const ANIM2D_FRAMES_USAGE_EN =
  'Usage: add a "2D frame animation" node (typeId `anim.2d`), wire a rows×cols sprite sheet into its `in` port, and set animRows / animCols plus the action preset animPresetId (or a custom animInstruction); then set animGifFps to 8–12 and run — the node slices per-frame PNGs and additionally emits a GIF through the `out-gif` port, persisted as a project asset. When no sprite sheet exists yet, either wire an upstream image node that draws the grid, or dive into this node\'s inner graph and generate it with the image API.' +
  ' Over MCP the minimum is 3 calls, and workflow_plan is not needed first (workflow_commit takes a hand-written plan directly): (1) workflow_commit({ plan, name }) — plan is {"title":"2D frame animation","nodes":[{"key":"sheet","typeId":"asset.image","params":{"generateInstruction":"Generate a sprite sheet of the <action> action for one character: a single image divided into <rows> rows x <cols> columns, frame order left to right then top to bottom, keeping the character look, proportions and art style identical across every cell, changing only the pose"}},{"key":"anim","typeId":"anim.2d","params":{"animRows":<rows>,"animCols":<cols>,"animPresetId":"walk","animInstruction":"<action cycle description>","animGifFps":12}}],"edges":[{"from":"sheet","to":"anim"}]}, which returns assetId; (2) task_run({ assetId }) returns mcpTaskId; (3) task_status({ mcpTaskId }) fetches the outputs (generation plus encoding takes roughly 30-90 seconds, so several polls may be needed). animRows / animCols must match the actual grid of the sprite sheet, and animGifFps must be set explicitly and be greater than 0 (the default 0 slices frames without producing a GIF). Use graph_node_types / graph_read / graph_edit only when modifying an existing asset.'

/** SVG 矢量动画（svg.gen）：生成指令模板（{subject} 由 applyGraphSkill 的 vars 插值） */
const SVG_MOTION_INSTRUCTION_ZH =
  '把「{subject}」绘制成一份独立可渲染的 SVG 矢量图：只用矢量元素（path / rect / circle / ellipse / polygon / g，可配 defs / gradient），不要位图、不要外部字体或网络资源。需要动画时把动效写在 SVG 自身内（<animate> / <animateTransform> / <animateMotion> 或 <style> 里的 CSS @keyframes），并构成一个可无缝循环的完整动作周期。' // cjk-ok（LLM 生成指令模板：与 anim2d 同域的双语提示词数据）

const SVG_MOTION_INSTRUCTION_EN =
  'Draw "{subject}" as a standalone, directly renderable SVG vector artwork using vector elements only (path / rect / circle / ellipse / polygon / g, optionally with defs / gradients) — no bitmaps, no external fonts or network resources. If animation is required, implement the motion inside the SVG itself (<animate> / <animateTransform> / <animateMotion> or CSS @keyframes inside <style>) as one seamless, loopable action cycle.'

/** SVG 矢量动画：dsh 技能快照里的操作说明（矢量 → 帧序列 / GIF 的完整链路，不进节点 params） */
const SVG_MOTION_USAGE_ZH =
  '用法：用户要**矢量**（SVG）而不是位图时，用「SVG 生成」节点（typeId `svg.gen`）：`in` 端口接文本指令、`in-image` 端口接参考图（可照着图片生成矢量图），节点自带 SVG 系统提示词并强制全矢量、禁外部资源，产出 .svg 工程资产（`out` 出选中结果、`out-all` 出历次结果）。需要位图帧序列或 GIF 动图时，再把矢量源接到「SVG 烘焙」节点（typeId `svg.anim`）的 `in` 端口（端口类型 svg）：含 SMIL / CSS 动效时按动画时间轴逐帧烘焙 PNG（`out` / `out-all`）并合成 GIF（`out-gif` 端口）；**静态 SVG 只出 1 帧、不产 GIF**，所以要动画就必须在生成指令里明确要求 SVG 内置动效。关键参数：svg.gen 的 generateInstruction（画面 + 动效描述）、svgGenWidth / svgGenHeight（16–2048，默认 512）、svgGenBackground（空串 = 透明，或 white / black）；svg.anim 的 svgFrames（2–60，默认 12，GIF 帧数即此值）、svgDurationSec（0 = 自动探测 SVG 自身动画周期，上限 30 秒）、svgWidth / svgHeight（0 = 用 SVG 自身尺寸）。' + // cjk-ok（dsh 技能用法文本：双语提示词数据）
  '走 MCP 时最少 3 次调用，且不必先调 workflow_plan（workflow_commit 直接收手写 plan）：① workflow_commit({ plan, name }) —— plan 为 {"title":"鹈鹕骑车 SVG 动画","nodes":[{"key":"svg","typeId":"svg.gen","params":{"generateInstruction":"把一只卡通鹈鹕骑自行车画成独立可渲染的 SVG：严格正侧面朝左，车轮、辐条、车架、车把、脚踏都要画全；用 <animateTransform> 让车轮与曲柄持续旋转、双腿交替蹬踏、身体随节奏轻微起伏，构成可无缝循环的蹬车动画","svgGenWidth":512,"svgGenHeight":512}},{"key":"bake","typeId":"svg.anim","params":{"svgFrames":24,"svgDurationSec":2,"svgWidth":512,"svgHeight":512}}],"edges":[{"from":"svg","to":"bake"}]}，返回 assetId；② task_run({ assetId }) 返回 mcpTaskId；③ task_status({ mcpTaskId }) 取产物（文本模型出 SVG 约十几秒，烘焙 + GIF 编码另需数秒）。只要一张静态矢量图时，plan 里只留 svg.gen 单节点、edges 留空，不要接 svg.anim。用户提到 SVG / 矢量 / 矢量动画 / 矢量图标时不要改用 generate_image —— 那是位图。只有改动已存在的资产时才用 graph_node_types / graph_read / graph_edit。' // cjk-ok（dsh 技能用法文本：双语提示词数据）

const SVG_MOTION_USAGE_EN =
  'Usage: when the user wants **vector** (SVG) output instead of a bitmap, use the "SVG gen" node (typeId `svg.gen`): wire the text instruction into `in` and reference images into `in-image` (it can redraw an image as vectors); the node ships its own SVG system prompt and forces pure vector output with no external resources, producing a .svg project asset (`out` = selected result, `out-all` = every run). To get a raster frame sequence or an animated GIF, wire the vector source into the `in` port (port type svg) of the "SVG bake" node (typeId `svg.anim`): with SMIL / CSS animation inside the SVG it bakes one PNG per frame along the animation timeline (`out` / `out-all`) and composes a GIF (`out-gif`); a **static SVG yields one frame and no GIF**, so ask for in-SVG motion explicitly when animation is wanted. Key params: svg.gen generateInstruction (artwork plus motion description), svgGenWidth / svgGenHeight (16-2048, default 512), svgGenBackground (empty string = transparent, or white / black); svg.anim svgFrames (2-60, default 12, which is also the GIF frame count), svgDurationSec (0 = auto-detect the SVG animation cycle, max 30 s), svgWidth / svgHeight (0 = use the SVG intrinsic size).' +
  ' Over MCP the minimum is 3 calls and workflow_plan is not needed first (workflow_commit accepts a hand-written plan): (1) workflow_commit({ plan, name }) — plan is {"title":"Pelican riding a bicycle (SVG)","nodes":[{"key":"svg","typeId":"svg.gen","params":{"generateInstruction":"Draw a cartoon pelican riding a bicycle as a standalone renderable SVG: strict left-facing side view with both wheels, spokes, frame, handlebars and pedals fully visible; use <animateTransform> to keep the wheels and crank rotating, the legs pedalling alternately and the body bobbing slightly, forming one seamless pedalling loop","svgGenWidth":512,"svgGenHeight":512}},{"key":"bake","typeId":"svg.anim","params":{"svgFrames":24,"svgDurationSec":2,"svgWidth":512,"svgHeight":512}}],"edges":[{"from":"svg","to":"bake"}]}, which returns assetId; (2) task_run({ assetId }) returns mcpTaskId; (3) task_status({ mcpTaskId }) fetches the outputs (the text model needs roughly ten seconds for the SVG, then baking and GIF encoding take a few more). For a single static vector image keep only the svg.gen node with an empty edges array and skip svg.anim. Do not switch to generate_image when the user asks for SVG / vector / vector animation / vector icons — that produces a bitmap. Use graph_node_types / graph_read / graph_edit only when modifying an existing asset.'

function fromEpisodePack(
  id: string,
  pack: EpisodeAgentPromptPack,
  titleZh: string,
  titleEn: string,
  parse: GraphSkillParseKind | undefined,
  kind: GraphSkillKind = 'episode'
): GraphSkill {
  return {
    id,
    kind,
    titleZh,
    titleEn,
    systemPromptZh: pack.systemPromptZh,
    systemPromptEn: pack.systemPromptEn,
    instructionZh: pack.instructionZh,
    instructionEn: pack.instructionEn,
    parse
  }
}

function fromSystemDefault(
  id: string,
  titleZh: string,
  titleEn: string,
  system: (locale?: string) => string
): GraphSkill {
  // system.* 镜像 systemPromptSchemes 的 default*；仅在节点绑定该 skillId 时使用，
  // 未绑定的旧节点仍直接走 systemPromptSchemes.resolve*。
  return {
    id,
    kind: 'system',
    titleZh,
    titleEn,
    systemPromptZh: system('zh-CN'),
    systemPromptEn: system('en-US')
  }
}

const BUILTIN_SKILLS: GraphSkill[] = [
  fromEpisodePack(
    'episode.breakdown',
    EPISODE_AGENT_BREAKDOWN,
    '分镜师·节拍拆解表',
    'Storyboard · beat breakdown',
    'beatBreakdown'
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
    // 2D 帧动画（anim.2d 节点）：参考图 + 动作描述 → 序列图 → 逐帧 PNG / GIF 动图
    id: 'anim2d.frames',
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
    // SVG 矢量动画（svg.gen → svg.anim）：矢量源码 → 帧序列 / GIF 动图，与 anim2d.frames 同口径
    id: 'svg.motion',
    kind: 'svg',
    titleZh: 'SVG 矢量图与矢量动画（GIF）', // cjk-ok（技能标题：与 builtins 节点名同域）
    titleEn: 'SVG vector art / vector animation (GIF)',
    instructionZh: SVG_MOTION_INSTRUCTION_ZH,
    instructionEn: SVG_MOTION_INSTRUCTION_EN,
    usageZh: SVG_MOTION_USAGE_ZH,
    usageEn: SVG_MOTION_USAGE_EN
  },
  fromSystemDefault('system.screenplay', '剧本', 'Screenplay', defaultScreenplaySystemPrompt),
  fromSystemDefault('system.gameSystem', '策划案', 'Game system', defaultGameSystemSystemPrompt),
  fromSystemDefault('system.image', '图片生成', 'Image', defaultImageSystemPrompt),
  fromSystemDefault('system.uiImage', '界面图', 'UI image', defaultUiImageSystemPrompt),
  fromSystemDefault('system.video', '视频生成', 'Video', defaultVideoSystemPrompt),
  fromSystemDefault('system.optimize', '提示词优化', 'Prompt optimize', defaultOptimizeSystemPrompt),
  fromSystemDefault('system.toPrompt', '图生提示词', 'Image to prompt', defaultToPromptSystemPrompt),
  fromSystemDefault('system.voice', '声音', 'Voice', defaultTimbreSystemPrompt),
  fromSystemDefault(
    'system.worldExtract',
    '世界提取',
    'World extract',
    defaultWorldExtractSystemPrompt
  ),
  fromSystemDefault('system.beatSplit', '节拍拆分', 'Beat split', defaultBeatSplitSystemPrompt),
  fromSystemDefault(
    'system.beatUnitGen',
    '节拍单元生成',
    'Beat unit gen',
    defaultBeatUnitGenSystemPrompt
  ),
  fromSystemDefault('system.uiSplit', '界面拆分', 'UI split', defaultUiSplitSystemPrompt),
  fromSystemDefault('system.upscale', '高清放大', 'Upscale', defaultUpscaleSystemPrompt),
  fromSystemDefault('system.expand', '扩图', 'Expand', defaultExpandSystemPrompt),
  fromSystemDefault('system.redraw', '重绘', 'Redraw', defaultRedrawSystemPrompt),
  fromSystemDefault('system.erase', '擦除', 'Erase', defaultEraseSystemPrompt),
  fromSystemDefault('system.matte', '抠图', 'Matte', defaultMatteSystemPrompt),
  fromSystemDefault(
    'system.multiAngle',
    '多角度',
    'Multi-angle',
    defaultMultiAngleSystemPrompt
  ),
  fromSystemDefault('system.lighting', '灯光', 'Lighting', defaultLightingSystemPrompt),
  fromSystemDefault(
    'system.portraitTexture',
    '肖像贴图',
    'Portrait texture',
    defaultPortraitTextureSystemPrompt
  ),
  fromSystemDefault('system.emotion', '情绪', 'Emotion', defaultEmotionSystemPrompt)
]

/**
 * Skill 覆盖栈（后注册优先）。
 * 内置 BUILTIN_SKILLS 在模块加载时入栈；插件用 registerGraphSkill 追加，dispose 后回落到内置。
 * 不要把内置 Skill 只挂在渲染进程 Cordis 上（主进程 / 测试共用本目录）。
 */
const skillStacks = new Map<string, GraphSkill[]>(
  BUILTIN_SKILLS.map((skill) => [skill.id, [skill]])
)

export function registerGraphSkill(skill: GraphSkill): () => void {
  const id = skill.id.trim()
  if (!id) throw new Error('GraphSkill id is empty')
  const entry = id === skill.id ? skill : { ...skill, id }
  const stack = skillStacks.get(id) ?? []
  stack.push(entry)
  skillStacks.set(id, stack)
  return () => {
    const next = (skillStacks.get(id) ?? []).filter((item) => item !== entry)
    if (next.length) skillStacks.set(id, next)
    else skillStacks.delete(id)
  }
}

export function getGraphSkill(id: string | undefined | null): GraphSkill | undefined {
  const key = id?.trim()
  if (!key) return undefined
  const stack = skillStacks.get(key)
  return stack?.[stack.length - 1]
}

export function listGraphSkills(): GraphSkill[] {
  return [...skillStacks.values()].flatMap((stack) => {
    const top = stack[stack.length - 1]
    return top ? [top] : []
  })
}

export type GraphSkillApplyVars = Record<string, string | number>

export interface ApplyGraphSkillOptions {
  locale?: string
  vars?: GraphSkillApplyVars
}

function interpolate(template: string, vars?: GraphSkillApplyVars): string {
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
 * 套用 Skill 到节点 params：写入 skillId 与当时的指令/系统提示（快照，非引用）。
 * 用户之后改节点文案即覆盖；Skill 文案后续升级不会传播到已应用节点；
 * 无 skillId 的旧节点不迁移。
 */
export function applyGraphSkill(
  id: string,
  options?: ApplyGraphSkillOptions
): Pick<GraphNodeParams, 'skillId' | 'generateInstruction' | 'generateSystemPrompt'> {
  const skill = getGraphSkill(id)
  if (!skill) {
    return { skillId: id }
  }
  const pack: EpisodeAgentPromptPack = {
    systemPromptZh: skill.systemPromptZh ?? '',
    systemPromptEn: skill.systemPromptEn ?? skill.systemPromptZh ?? '',
    instructionZh: skill.instructionZh ?? '',
    instructionEn: skill.instructionEn ?? skill.instructionZh ?? ''
  }
  const system = pickEpisodeAgentPrompt(pack, options?.locale, 'systemPrompt').trim()
  const instruction = interpolate(
    pickEpisodeAgentPrompt(pack, options?.locale, 'instruction'),
    options?.vars
  ).trim()
  return {
    skillId: skill.id,
    ...(system ? { generateSystemPrompt: system } : {}),
    ...(instruction ? { generateInstruction: instruction } : {})
  }
}

export function graphSkillTitle(skill: GraphSkill, locale?: string): string {
  return isEnglishLocale(locale) ? skill.titleEn : skill.titleZh
}
