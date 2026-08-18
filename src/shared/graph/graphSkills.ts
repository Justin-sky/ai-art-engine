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

export type GraphSkillKind =
  | 'episode'
  | 'episode-review'
  | 'episode-image'
  | 'episode-video'
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
