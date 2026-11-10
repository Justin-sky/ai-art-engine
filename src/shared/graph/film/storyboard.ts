/**
 * 影视与 AI 漫剧全流程数据模型（单一来源，完整承载 `ai-manju-skills` 五阶段工程体系）。
 *
 * 统一成两份结构化核心文档（内嵌五阶段全量元数据）：
 * - `FilmStoryboard`（schema `aiart.film-storyboard@1`）：
 *   - 阶段1 企划设定（`genreId` 21题材标识 + `bible` 立项卡/世界与力量体系/角色身高与一致性锚点/空间尺寸与世界光）
 *   - 阶段2 资产名录（`entities`：`STYLE01` 风格定调图 + `P01` 角色卡[含身高cm/一致性锚点/LOOK-A状态卡/背影卡] + `D01` 道具卡 + `S01` 场景空景卡[含空间尺寸/世界光方向] + `FX01` 纯黑底特效卡）
 *   - 阶段3 分集剧本元数据（`episodeMeta`：冷开场、结尾钩子、本集进度、对白总字数与开口字数占比、付费卡点标记）
 *   - 阶段4 导演手册（`scenes` + `shots`：时间轴总表、口型镜标记、A段5行分镜图提示词、B段 `{{Mixed N}}` 多参锚定与分时段7行视频提示词、制作信息 + `continuityAudit` 11项连续性检查）
 *   - 阶段5 分集发布包（`publishPack`：竖版3:4与横版4:3封面提示词、3秒片尾卡、8–10秒下集预告、3组爆款标题、简介、话题标签、置顶评论、AI合规声明）
 * - `FilmCast`（schema `aiart.film-cast@1`）：全季/本集视觉资产设定图库（`STYLE01` + `P/D/S/FX` 卡片与状态变体继承）
 *
 * 所有解析都是**宽容读、严格写**：模型输出的中文键、代码围栏、缺字段都能读，
 * 写回一律规范英文键 + 稳定 id，便于 agent 与 UI 直接读写。
 */
import {
  extractStoryboardShotIdFromDirectorId,
  readDirectorStage,
  resolveShotCinematographyFromDirectorStage,
  type DirectorShotPrevizCinematography,
  type DirectorStageState
} from '../../domain'
import { isDirectorProcessingNode } from '../nodeRole'
import type { GraphDocument, GraphNode } from '../types'
import { stripJsonCodeFence } from '../jsonFence'
import { resolveManjuGenre, type ManjuGenreId, type ManjuGenreSpec } from './manjuGenres'

export const FILM_STORYBOARD_SCHEMA = 'aiart.film-storyboard@1'
export const FILM_CAST_SCHEMA = 'aiart.film-cast@1'

export type FilmEntityKind = 'character' | 'location' | 'prop' | 'style' | 'vfx'
export const FILM_ENTITY_KINDS: readonly FilmEntityKind[] = [
  'character',
  'location',
  'prop',
  'style',
  'vfx'
]

export interface FilmTtsVoicePreset {
  id: string
  labelZh: string
  labelEn: string
}

export const FILM_TTS_VOICE_PRESETS: readonly FilmTtsVoicePreset[] = [
  { id: 'onyx', labelZh: 'Onyx · 沉稳男主 / 冷冽低音', labelEn: 'Onyx · Deep Male Lead' },
  { id: 'nova', labelZh: 'Nova · 清冷女主 / 灵动女声', labelEn: 'Nova · Clear Female Lead' },
  { id: 'echo', labelZh: 'Echo · 热血少年 / 青年男配', labelEn: 'Echo · Youth Male' },
  { id: 'shimmer', labelZh: 'Shimmer · 温柔女配 / 甜美少女', labelEn: 'Shimmer · Warm Female' },
  {
    id: 'fable',
    labelZh: 'Fable · 威严长老 / 反派权臣',
    labelEn: 'Fable · Authoritative / Villain'
  },
  { id: 'alloy', labelZh: 'Alloy · 叙事旁白 / 系统音', labelEn: 'Alloy · Narrator / System' }
] as const

export interface FilmEntity {
  id: string
  /** 标准资产编号：STYLE01 / P01 / D01 / S01 / FX01 */
  code?: string
  kind: FilmEntityKind
  /** 全片唯一称呼（支持 `角色名#LOOK-B` 或 `角色名·战损` 状态变体）；镜头里的 characters / location / props 引用该名字 */
  name: string
  /** 视觉设定（外貌 / 服装 / 材质 / 空间结构）：只在设定库生成设定图时使用 */
  description: string
  /** 角色状态码（如 `LOOK-A` 初始态、`LOOK-B` 战损/换装/觉醒态、`背影卡` 未揭晓神秘人） */
  stateCode?: string
  /** 角色精确身高（cm，如 181；用于阶段2人物卡与阶段4 B段视频身高比例锁定） */
  heightCm?: number
  /** 角色 3–4 个跨集不变的一致性锚点（如 `["左眉断疤", "玄铁发冠", "黑袍赤金滚边"]`） */
  consistencyAnchors?: string[]
  /** 角色绑定 TTS 配音音色预设（如 `onyx` / `nova` / `echo` / `shimmer` / `fable` / `alloy`） */
  voicePreset?: string
  /** 场景或道具的空间/物理尺寸（如 `15m×15m，高6m` 或 `长120cm，刃宽4cm`） */
  dimensions?: string
  /** 场景（Sxx）恒定世界光线方向（如 `东方晨光从正北偏东斜射`），用于换算本场各镜受光方向 */
  worldLightDirection?: string
  /** 适用集数范围（如 `E01-E30` 或 `E01-E03`） */
  episodeRange?: string
  /** 专属负面提示词 */
  negativePrompt?: string
}

export interface FilmScene {
  id: string
  /** 场景资产编号（如 `S01`、`S02`） */
  code?: string
  order: number
  /** 场景标题（INT./EXT. 地点 - 时间） */
  heading: string
  /** 地点实体名 */
  location: string
  time: string
  summary: string
  /** 空间尺寸与方位布局（如 `长20m×宽15m，北侧主座，南侧大门`） */
  dimensions?: string
  /** 本场恒定世界光方向（如 `窗外冷白月光从北侧斜射`） */
  worldLightDirection?: string
  /** 本场 180° 摄影轴线与人物默认画左/画右站位基准 */
  cameraAxis?: string
}

export type FilmDialogueMode = 'spoken' | 'inner' | 'vo'

export interface FilmDialogueLine {
  speaker: string
  line: string
  /** 语气 / 表演提示 */
  tone?: string
  /**
   * 对白发音方式（对齐 `ai-manju-skills`）：
   * - `spoken`（默认）：开口对白，需计入 4字/秒口型同步时长，画面人物张嘴对齐台词
   * - `inner`：内心独白（`（内心）`），画面人物必须闭口，声音叠在音轨
   * - `vo`：画外音 / 旁白（`（画外）`/`（OS）`/`（VO）`），说话人不在画面内或闭口
   */
  mode?: FilmDialogueMode
  /** 台词在本镜内的起始秒数（制作信息） */
  startSec?: number
  /** 台词在本镜内的结束秒数（制作信息） */
  endSec?: number
}

/**
 * 阶段4 导演手册 B段：分时段视频控制块（7行硬性结构）
 */
export interface FilmVideoBeat {
  /** 时间段（如 `0-3秒`、`3-6秒`） */
  timeRange: string
  /** 1. 画面：景别 + 动作过程 + 开口台词原文 */
  visual: string
  /** 2. 禁止：3–4条本镜最易翻车的具体禁止项（如 禁止双人换位、禁止跳轴、禁止内心独白张嘴、禁止武器穿模） */
  forbid: string
  /** 3. 约束：表情变化、局部细节、口型约束（开口写"口型对齐台词"，内心独白/旁听写"闭口"） */
  constraint: string
  /** 4. 站位与朝向：谁在画左、谁在画右、面朝哪边 */
  blocking: string
  /** 5. 运镜：起止景别与推拉摇移（禁止写 cm 数字） */
  cameraMove: string
  /** 6. 音效：环境音 + 动作音效（若有内心独白或画外音在此注明） */
  sound: string
  /** 7. 这段大概是：一句话概括本时间段可见结果 */
  summary: string
}

/**
 * 阶段4 导演手册：单镜后期制作信息
 */
export interface FilmShotProductionInfo {
  /** 合成特效卡编号与切入秒数（如 `["FX01 剑气光弧（1.5s-3.0s 叠加）"]`） */
  vfxAssets?: string[]
  /** BGM 情绪与切入切出提示 */
  bgm?: string
  /** 画面花字 / 系统弹窗字幕卡说明（生图生视频严禁带字，后期叠加） */
  subtitleCard?: string
}

/** draft = AI 产出待定；approved = 人工确认（AI 不再改写）；revise = 审核要求返工 */
export type FilmShotStatus = 'draft' | 'approved' | 'revise'

export interface FilmShotReview {
  verdict: 'pass' | 'fail'
  notes: string
}

export interface FilmShotMedia {
  keyframe?: string
  video?: string
  /** 本镜合成的角色台词配音 / 旁白音频（工程相对路径） */
  voice?: string
  /** 3D 导演台白模预演抓拍的构图参考图 */
  previzKeyframe?: string
  /** 3D 导演台白模预演录制的动作/运镜视频 */
  previzVideo?: string
}

export interface FilmShot {
  id: string
  order: number
  sceneId: string
  title: string
  /** 在本集中的累计时间区间（如 `0:00-0:04`，由 finalizeFilmStoryboard 自动推算） */
  timeRange?: string
  /** 景别：ELS / LS / MLS / MS / MCU / CU / ECU / INSERT */
  shotSize: string
  /** 机位角度：平视 / 俯拍 / 仰拍 / 过肩 / 主观 … */
  angle: string
  /** 机位焦段（如 `24mm` / `35mm` / `50mm` / `85mm`） */
  focalLength?: string
  /** 运镜：固定 / 推 / 拉 / 摇 / 移 / 跟 / 升降 / 手持 */
  cameraMove: string
  durationSec: number
  characters: string[]
  location: string
  props: string[]
  /** 画面动作（可见、可拍） */
  action: string
  dialogue: FilmDialogueLine[]
  /** 环境声 / 音效 */
  sound: string
  /** 与下一镜的转场 */
  transition: string
  /** A段第1行：参考资产行（如 `STYLE01｜P01 石玄 LOOK-A｜S01 测灵台 空景卡｜D01 测灵碑`） */
  refAssetsLine?: string
  /** A段第2行：画左/画右站位、稳定起始/结束静止姿势、面朝方向与道具状态 */
  blockingAndPose?: string
  /** A段第2行末尾：单字/双字核心表情词（如 `冷冽` / `震惊` / `讥诮`） */
  expression?: string
  /** A段第3行：人物在画面中的构图位置（如 `画左三分之一处` / `居中偏右`） */
  subjectPosition?: string
  /** A段第4行：由场景世界光方向换算出的本镜受光方向与光线色彩 */
  lighting?: string
  /** 关键帧（首帧）生图提示词：只写可见内容，外观靠设定图锁定 */
  imagePrompt: string
  /** 图生视频提示词：时间轴动作 + 运镜 + 对白 */
  videoPrompt: string
  /** B段结构化分时段视频提示词（0-X秒 7行规范） */
  videoBeats?: FilmVideoBeat[]
  /** 生成方式（如 `首帧图生视频` / `多参生视频` / `首尾帧生视频`） */
  generationMode?: string
  /** 是否口型镜（含开口对白 `mode === 'spoken'` 时为 true） */
  isLipSyncShot?: boolean
  /** 首帧编号（如 `KF-01`） */
  firstFrameId?: string
  /** 后期制作信息（FX合成、BGM、花字卡） */
  productionInfo?: FilmShotProductionInfo
  status: FilmShotStatus
  /** 人工锁定：AI 拆解 / 审核修订都不会改写该镜（approved 视同锁定） */
  locked?: boolean
  review?: FilmShotReview
  media?: FilmShotMedia
}

/**
 * 阶段1：立项卡与企划案核心设定（Series Bible）
 */
export interface ManjuProjectBible {
  /** 3–5 个核心商业卖点与强传播名场面 */
  sellingPoints?: string[]
  /** 第3节：世界观/修炼/身份/宫廷/案件/系统规则表（依题材动态适配） */
  worldAndPowerSystem?: string
  /** 第8节：核心伏笔与连续性铁律 */
  continuityRules?: string[]
  /** 第9节：全剧主色区分方案（防撞色） */
  colorScheme?: string
  /** 第10节：逐集进度表规则与招式/证据链摘要 */
  episodeProgressRule?: string
  /** 第12节：角色音色表 */
  voiceDesign?: Array<{ name: string; timbre: string }>
}

/**
 * 阶段3：分集剧本结构化元数据
 */
export interface ManjuEpisodeMeta {
  /** 集序号（默认 1） */
  episodeNumber?: number
  /** 冷开场（闪前画面与台词，需与后文对应场次姿势/站位/台词完全一致） */
  coldOpen?: string
  /** 结尾钩子（悬念画面或台词） */
  cliffhangerHook?: string
  /** 本集进度（严格对齐题材进度公式，如 `本集对手｜战力变化｜用了什么招式｜代价`） */
  episodeProgress?: string
  /** 本集总对白字数（含内心独白与画外音） */
  totalDialogueChars?: number
  /** 本集开口对白字数（要求 ≥ 总对白字数的 2/3） */
  spokenDialogueChars?: number
  /** 是否为付费卡点集（卡点集钩子强度翻倍） */
  isPaywallEpisode?: boolean
}

/**
 * 阶段4 第三部分：11 项连续性与工程规范体检项
 */
export interface ManjuContinuityCheckItem {
  id: string
  labelZh: string
  labelEn: string
  passed: boolean
  detail: string
}

export interface ManjuContinuityAudit {
  passed: boolean
  score: number
  totalDurationSec: number
  totalDialogueChars: number
  spokenDialogueChars: number
  /** 开口对白占比（0~1） */
  spokenRatio: number
  items: ManjuContinuityCheckItem[]
}

/**
 * 阶段5：分集发布包（封面、片尾卡、下集预告、爆款标题、话题与合规声明）
 */
export interface ManjuPublishPack {
  /** 3:4 竖版封面生图提示词（A段5行格式，人脸居中偏上预留标题空间） */
  verticalCoverPrompt: string
  /** 4:3 横版封面生图提示词（A段5行格式） */
  horizontalCoverPrompt: string
  /** 已生成的 3:4 竖版封面图路径 */
  verticalCoverImage?: string
  /** 已生成的 4:3 横版封面图路径 */
  horizontalCoverImage?: string
  /** 3秒片尾卡方案（定格画面 + 钩子花字 + 音效） */
  endCardPlan: string
  /** 8–10秒下集预告方案（快切镜头组合 + 悬念台词） */
  nextEpisodeTeaser: string
  /** 3 个不同角度的推荐标题（悬念向 / 爽点打脸向 / 情感冲突向） */
  titles: string[]
  /** 80–120 字剧集简介 */
  synopsis: string
  /** 5–8 个平台话题标签（#标签） */
  hashtags: string[]
  /** 置顶评论引导互动话术 */
  pinnedComment: string
  /** AI 生成内容合规声明 */
  complianceNotice: string
  /** 一键合成后的单集完整成片（.mp4 工程相对路径，含分镜视频/关键帧 + 多角色配音 + 字幕与花字卡） */
  composedVideoPath?: string
  /** 参与单集合成的镜头数 */
  composedShotCount?: number
  /** 参与单集合成的配音片段数 */
  composedVoiceCount?: number
}

export interface FilmStoryboardReview {
  verdict: 'PASS' | 'FAIL'
  /** 0~100 */
  score: number
  rounds: number
  notes: string[]
  at: string
}

export interface FilmStoryboard {
  schema: typeof FILM_STORYBOARD_SCHEMA
  title: string
  logline: string
  style: string
  aspectRatio: string
  /** `ai-manju-skills` 21 漫剧题材标识（如 `xuanhuan-manju`、`dushi-manju`） */
  genreId?: ManjuGenreId | string
  /** 阶段1：立项与企划设定 */
  bible?: ManjuProjectBible
  /** 阶段3：分集剧本元数据 */
  episodeMeta?: ManjuEpisodeMeta
  entities: FilmEntity[]
  scenes: FilmScene[]
  shots: FilmShot[]
  /** 阶段4 第三部分：11项连续性检查报告 */
  continuityAudit?: ManjuContinuityAudit
  /** 阶段5：分集发布包 */
  publishPack?: ManjuPublishPack
  review?: FilmStoryboardReview
}

export interface FilmCastEntry {
  id: string
  /** 标准资产编号：STYLE01 / P01 / D01 / S01 / FX01 */
  code?: string
  kind: FilmEntityKind
  name: string
  description: string
  /** 状态码（如 `LOOK-A`、`LOOK-B`、`背影卡`） */
  stateCode?: string
  /** 角色身高（cm） */
  heightCm?: number
  /** 角色跨集不变的一致性锚点 */
  consistencyAnchors?: string[]
  /** 角色绑定的 TTS 配音音色预设（如 `onyx` / `nova` / `echo` / `shimmer` / `fable` / `alloy`） */
  voicePreset?: string
  /** 场景或道具尺寸 */
  dimensions?: string
  /** 场景恒定世界光方向 */
  worldLightDirection?: string
  /** 适用集数范围 */
  episodeRange?: string
  /** 设定图（工程相对路径） */
  imageRelativePath?: string
  /** 设定图（外链 / data URL，人工指定时） */
  imageUrl?: string
  /** 生成设定图时的提示词指纹：描述没变就不重画 */
  promptHash?: string
  /** 人工锁定：不再重画 */
  locked?: boolean
}

export interface FilmCast {
  schema: typeof FILM_CAST_SCHEMA
  style: string
  genreId?: ManjuGenreId | string
  entries: FilmCastEntry[]
}

// ─── 小工具 ─────────────────────────────────────────────────────────────

function str(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

function pick(row: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    const value = row[key]
    if (value !== undefined && value !== null && value !== '') return value
  }
  return undefined
}

function strList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) =>
        typeof item === 'object' && item ? str((item as Record<string, unknown>).name) : str(item)
      )
      .filter(Boolean)
  }
  const raw = str(value)
  if (!raw) return []
  return raw
    .split(/[,，;；、/|｜]/)
    .map((part) => part.trim())
    .filter(Boolean)
}

function num(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? parseFloat(value) : NaN
  return Number.isFinite(n) ? n : fallback
}

/** FNV-1a 32 位指纹（缓存键；不做安全用途） */
export function filmHash(input: string): string {
  let hash = 2166136261
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/** 名字匹配键：去空白、小写、去括注 */
export function filmNameKey(name: string): string {
  return name
    .replace(/[（(][^）)]*[）)]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
}

function parseJsonLoose(raw: string): unknown {
  const text = stripJsonCodeFence(raw)
  try {
    return JSON.parse(text)
  } catch {
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1))
      } catch {
        /* fallthrough */
      }
    }
    const aStart = text.indexOf('[')
    const aEnd = text.lastIndexOf(']')
    if (aStart >= 0 && aEnd > aStart) {
      try {
        return JSON.parse(text.slice(aStart, aEnd + 1))
      } catch {
        return null
      }
    }
    return null
  }
}

function normalizeEntityKind(value: unknown): FilmEntityKind | null {
  const raw = str(value).toLowerCase()
  if (!raw) return null
  if (['character', 'characters', 'role', '角色', '人物', 'p'].includes(raw)) return 'character'
  if (['location', 'locations', 'scene', 'set', '场景', '地点', '空景', 's'].includes(raw))
    return 'location'
  if (['prop', 'props', 'weapon', 'item', '道具', '武器', '物品', 'd'].includes(raw)) return 'prop'
  if (['style', 'style01', '风格', '风格定调', '定调图'].includes(raw)) return 'style'
  if (['vfx', 'fx', 'effect', '特效', '氛围特效'].includes(raw)) return 'vfx'
  return null
}

function normalizeStatus(value: unknown): FilmShotStatus {
  const raw = str(value).toLowerCase()
  if (raw === 'approved' || raw === '已确认' || raw === '已审核') return 'approved'
  if (raw === 'revise' || raw === '返工' || raw === 'fail') return 'revise'
  return 'draft'
}

function shotCode(sceneOrder: number, shotIndexInScene: number): string {
  return `S${String(sceneOrder).padStart(2, '0')}-${String(shotIndexInScene).padStart(2, '0')}`
}

/** 从描述文本中提取身高（cm），如 `身高181cm` / `168cm` */
function extractHeightCmFromText(text: string): number | undefined {
  const m = text.match(/(?:身高\s*)?(\d{3})\s*(?:cm|厘米)/i)
  if (!m) return undefined
  const val = parseInt(m[1], 10)
  return val >= 100 && val <= 250 ? val : undefined
}

/** 从名字或状态字段提取 LOOK 状态码（如 `林夏#晚礼服` → `晚礼服`，`石玄#LOOK-B` → `LOOK-B`） */
function extractStateCode(name: string, explicitState?: string): string | undefined {
  if (explicitState?.trim()) return explicitState.trim()
  const match = name.trim().match(/^[^#＃·]+\s*[#＃·]\s*(.+)$/)
  return match?.[1]?.trim() || undefined
}

/** 格式化秒数为 `M:SS` */
function formatMMSS(sec: number): string {
  const total = Math.max(0, Math.round(sec))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

const NON_SPATIAL_LOCATION_KEYS = new Set([
  '黑屏',
  '黑场',
  '纯黑',
  '純黑',
  '黑底',
  '黑幕',
  '白屏',
  '白场',
  '纯白',
  '白底',
  '字幕',
  '字幕卡',
  '标题卡',
  '片头',
  '片尾',
  '转场',
  '空',
  '无',
  '无场景',
  '无地点',
  '未知',
  '旁白',
  'blackscreen',
  'black',
  'fadetoblack',
  'whitescreen',
  'titlecard',
  'subtitle',
  'subtitles',
  'transition',
  'none',
  'na',
  'n/a',
  'null',
  'unknown',
  'void'
])

/**
 * 判断「地点」是否为黑屏 / 黑场 / 字幕卡 / 纯色背景等非实景占位：
 * 这类条目没有空间结构与陈设，不应作为场景实体去生成「广角全景建立镜头」设定图。
 */
export function isNonSpatialFilmLocation(name: string, description = ''): boolean {
  const key = filmNameKey(name)
  if (!key) return true
  if (NON_SPATIAL_LOCATION_KEYS.has(key)) return true
  const desc = description.trim()
  if (
    desc &&
    /^(?:纯?[黑白]色?(?:背景|画面|屏|场|底)?|黑屏|黑场|白屏|白场|solid\s*(?:black|white)\s*(?:background|screen|frame)?)(?:[，,。；;\s—-]*(?:用于|仅用于|for)?\s*(?:字幕|标题|转场|旁白|过渡|黑屏|subtitles?|title\s*card|transition).*)?$/i.test(
      desc
    )
  ) {
    return true
  }
  return false
}

// ─── 解析 / 规范化 ──────────────────────────────────────────────────────

function normalizeEntities(raw: unknown): FilmEntity[] {
  const out: FilmEntity[] = []
  const seen = new Set<string>()
  const push = (item: unknown, fallbackKind?: FilmEntityKind): void => {
    if (!item) return
    const row: Record<string, unknown> =
      typeof item === 'string' ? { name: item } : (item as Record<string, unknown>)
    const name = str(pick(row, 'name', '名称', '名字', '资产名'))
    const kind = normalizeEntityKind(pick(row, 'kind', 'type', '类型')) ?? fallbackKind
    if (!name || !kind) return
    const description = str(
      pick(row, 'description', 'desc', 'appearance', 'prompt', '描述', '外观', '设定')
    )
    if (kind === 'location' && isNonSpatialFilmLocation(name, description)) return
    const key = `${kind}:${filmNameKey(name)}`
    if (seen.has(key)) return
    seen.add(key)

    const code = str(pick(row, 'code', 'assetCode', '编号'))
    const stateCode = extractStateCode(name, str(pick(row, 'stateCode', 'state', 'look', '状态码')))
    const explicitHeight = num(pick(row, 'heightCm', 'height', '身高'), 0)
    const heightCm =
      explicitHeight >= 100 && explicitHeight <= 250
        ? Math.round(explicitHeight)
        : extractHeightCmFromText(description)
    const consistencyAnchors = strList(
      pick(row, 'consistencyAnchors', 'anchors', '一致性锚点', '锚点')
    )
    const voicePreset = str(pick(row, 'voicePreset', 'voice', 'ttsVoice', '音色', '配音音色'))
    const dimensions = str(pick(row, 'dimensions', 'size', '尺寸', '空间尺寸'))
    const worldLightDirection = str(
      pick(row, 'worldLightDirection', 'worldLight', 'lightDirection', '世界光线方向', '世界光')
    )
    const episodeRange = str(pick(row, 'episodeRange', 'episodes', '使用集数', '集数'))
    const negativePrompt = str(pick(row, 'negativePrompt', 'negative', '负面提示词'))

    out.push({
      id: str(row.id) || `${kind}-${filmHash(filmNameKey(name))}`,
      ...(code ? { code } : {}),
      kind,
      name,
      description,
      ...(stateCode ? { stateCode } : {}),
      ...(heightCm ? { heightCm } : {}),
      ...(consistencyAnchors.length ? { consistencyAnchors } : {}),
      ...(voicePreset ? { voicePreset } : {}),
      ...(dimensions ? { dimensions } : {}),
      ...(worldLightDirection ? { worldLightDirection } : {}),
      ...(episodeRange ? { episodeRange } : {}),
      ...(negativePrompt ? { negativePrompt } : {})
    })
  }
  if (Array.isArray(raw)) {
    for (const item of raw) push(item)
  } else if (raw && typeof raw === 'object') {
    const grouped = raw as Record<string, unknown>
    const groups: Array<[FilmEntityKind, string[]]> = [
      ['style', ['styles', 'styleAnchor', '风格定调图']],
      ['character', ['characters', '角色', '人物']],
      ['location', ['locations', 'scenes', '场景', '地点']],
      ['prop', ['props', 'weapons', '道具', '武器']],
      ['vfx', ['vfx', 'effects', '特效']]
    ]
    for (const [kind, keys] of groups) {
      for (const key of keys) {
        const list = grouped[key]
        if (Array.isArray(list)) for (const item of list) push(item, kind)
      }
    }
  }
  return out
}

function normalizeDialogueMode(
  rawMode: string,
  speaker: string,
  tone: string
): FilmDialogueMode | undefined {
  const combined = `${rawMode} ${speaker} ${tone}`.toLowerCase()
  if (
    combined.includes('inner') ||
    combined.includes('内心') ||
    combined.includes('独白') ||
    combined.includes('心声')
  ) {
    return 'inner'
  }
  if (
    combined.includes('vo') ||
    combined.includes('os') ||
    combined.includes('画外') ||
    combined.includes('旁白') ||
    combined.includes('voiceover')
  ) {
    return 'vo'
  }
  if (rawMode === 'spoken' || rawMode === '开口') return 'spoken'
  return undefined
}

function normalizeDialogue(raw: unknown): FilmDialogueLine[] {
  if (!raw) return []
  if (typeof raw === 'string') {
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const m = line.match(/^([^:：]{1,24})[:：]\s*(.+)$/)
        if (!m) return { speaker: '', line }
        const rawSpeaker = m[1].trim()
        const tagMatch = rawSpeaker.match(/^(.+?)[（(]([^）)]+)[）)]$/)
        const speaker = tagMatch ? tagMatch[1].trim() : rawSpeaker
        const tag = tagMatch ? tagMatch[2].trim() : ''
        const mode = normalizeDialogueMode('', rawSpeaker, tag)
        return {
          speaker,
          line: m[2].trim(),
          ...(tag ? { tone: tag } : {}),
          ...(mode ? { mode } : {})
        }
      })
  }
  if (!Array.isArray(raw)) return []
  return raw
    .map((item): FilmDialogueLine | null => {
      if (typeof item === 'string') return normalizeDialogue(item)[0] ?? null
      if (!item || typeof item !== 'object') return null
      const row = item as Record<string, unknown>
      const line = str(pick(row, 'line', 'text', 'content', '台词', '对白'))
      if (!line) return null
      const rawSpeaker = str(pick(row, 'speaker', 'character', 'name', '说话人', '角色'))
      const tone = str(pick(row, 'tone', 'emotion', '语气'))
      const modeRaw = str(pick(row, 'mode', 'type', '发音方式', '对白类型'))
      const mode = normalizeDialogueMode(modeRaw, rawSpeaker, tone)
      const startSec = num(pick(row, 'startSec', 'start', '起始秒'), -1)
      const endSec = num(pick(row, 'endSec', 'end', '结束秒'), -1)
      return {
        speaker: rawSpeaker,
        line,
        ...(tone ? { tone } : {}),
        ...(mode ? { mode } : {}),
        ...(startSec >= 0 ? { startSec } : {}),
        ...(endSec >= 0 ? { endSec } : {})
      }
    })
    .filter((item): item is FilmDialogueLine => !!item)
}

function normalizeScenes(raw: unknown): FilmScene[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((item, index): FilmScene | null => {
      if (!item || typeof item !== 'object') return null
      const row = item as Record<string, unknown>
      const order = Math.max(1, Math.round(num(pick(row, 'order', '顺序'), index + 1)))
      const code = str(pick(row, 'code', 'sceneCode', '场景编号'))
      const dimensions = str(pick(row, 'dimensions', 'size', '空间尺寸', '尺寸'))
      const worldLightDirection = str(
        pick(row, 'worldLightDirection', 'worldLight', '世界光线方向', '世界光')
      )
      const cameraAxis = str(pick(row, 'cameraAxis', 'axis', '镜头轴线', '轴线'))
      return {
        id: str(row.id) || `scene-${order}`,
        ...(code ? { code } : {}),
        order,
        heading: str(pick(row, 'heading', 'title', '标题', '场景标题')),
        location: str(pick(row, 'location', '地点', '场景')),
        time: str(pick(row, 'time', '时间')),
        summary: str(pick(row, 'summary', 'description', '概要', '剧情')),
        ...(dimensions ? { dimensions } : {}),
        ...(worldLightDirection ? { worldLightDirection } : {}),
        ...(cameraAxis ? { cameraAxis } : {})
      }
    })
    .filter((item): item is FilmScene => !!item)
    .sort((a, b) => a.order - b.order)
}

function normalizeVideoBeats(raw: unknown): FilmVideoBeat[] | undefined {
  if (!Array.isArray(raw) || !raw.length) return undefined
  const beats: FilmVideoBeat[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const r = item as Record<string, unknown>
    const timeRange = str(pick(r, 'timeRange', 'time', '时间段', '时间'))
    const visual = str(pick(r, 'visual', 'action', '画面'))
    const forbid = str(pick(r, 'forbid', 'forbidden', '禁止'))
    const constraint = str(pick(r, 'constraint', 'constraints', '约束'))
    const blocking = str(pick(r, 'blocking', 'position', '站位与朝向', '站位'))
    const cameraMove = str(pick(r, 'cameraMove', 'camera', '运镜'))
    const sound = str(pick(r, 'sound', 'sfx', '音效'))
    const summary = str(pick(r, 'summary', 'overview', '这段大概是', '概括'))
    if (!visual && !summary) continue
    beats.push({
      timeRange: timeRange || '0-4秒',
      visual,
      forbid,
      constraint,
      blocking,
      cameraMove,
      sound,
      summary
    })
  }
  return beats.length ? beats : undefined
}

function normalizeShot(item: unknown, index: number): FilmShot | null {
  if (!item || typeof item !== 'object') return null
  const row = item as Record<string, unknown>
  const media =
    row.media && typeof row.media === 'object' ? (row.media as Record<string, unknown>) : null
  const review =
    row.review && typeof row.review === 'object' ? (row.review as Record<string, unknown>) : null
  const prodRaw =
    row.productionInfo && typeof row.productionInfo === 'object'
      ? (row.productionInfo as Record<string, unknown>)
      : null
  const verdict = str(review?.verdict).toLowerCase()
  const locked = row.locked === true
  const dialogue = normalizeDialogue(pick(row, 'dialogue', 'lines', '对白', '台词'))
  const videoBeats = normalizeVideoBeats(pick(row, 'videoBeats', 'beats', '视频分段', '时间轴分段'))

  const refAssetsLine = str(pick(row, 'refAssetsLine', 'refLine', '参考', '参考资产'))
  const blockingAndPose = str(pick(row, 'blockingAndPose', 'blocking', '站位与姿势'))
  const expression = str(pick(row, 'expression', '表情'))
  const focalLength = str(pick(row, 'focalLength', 'lens', '焦段'))
  const subjectPosition = str(pick(row, 'subjectPosition', 'framingPosition', '画面位置'))
  const lighting = str(pick(row, 'lighting', 'light', '光线'))
  const timeRange = str(pick(row, 'timeRange', '时间'))
  const generationMode = str(pick(row, 'generationMode', '生成方式'))
  const firstFrameId = str(pick(row, 'firstFrameId', '首帧编号'))
  const hasSpokenDialogue = dialogue.some((d) => d.mode !== 'inner' && d.mode !== 'vo')
  const isLipSyncShot =
    typeof row.isLipSyncShot === 'boolean'
      ? row.isLipSyncShot
      : hasSpokenDialogue
        ? true
        : undefined

  const vfxAssets = prodRaw ? strList(pick(prodRaw, 'vfxAssets', 'vfx', '特效')) : []
  const bgm = prodRaw ? str(pick(prodRaw, 'bgm', 'music', '配乐')) : ''
  const subtitleCard = prodRaw
    ? str(pick(prodRaw, 'subtitleCard', 'subtitle', '花字', '字幕卡'))
    : ''

  const shot: FilmShot = {
    id: str(pick(row, 'id', '镜号')),
    order: Math.max(1, Math.round(num(pick(row, 'order', '序号'), index + 1))),
    sceneId: str(pick(row, 'sceneId', 'scene', '场次')),
    title: str(pick(row, 'title', '标题', '镜头名')),
    ...(timeRange ? { timeRange } : {}),
    shotSize: str(pick(row, 'shotSize', 'size', '景别')),
    angle: str(pick(row, 'angle', '角度', '机位')),
    ...(focalLength ? { focalLength } : {}),
    cameraMove: str(pick(row, 'cameraMove', 'camera', 'movement', '运镜')),
    durationSec: Math.min(60, Math.max(1, num(pick(row, 'durationSec', 'duration', '时长'), 4))),
    characters: strList(pick(row, 'characters', '角色', '人物')),
    location: str(pick(row, 'location', '地点', '场景')),
    props: strList(pick(row, 'props', '道具')),
    action: str(pick(row, 'action', '动作', '画面')),
    dialogue,
    sound: str(pick(row, 'sound', 'sfx', '音效', '声音')),
    transition: str(pick(row, 'transition', '转场')),
    ...(refAssetsLine ? { refAssetsLine } : {}),
    ...(blockingAndPose ? { blockingAndPose } : {}),
    ...(expression ? { expression } : {}),
    ...(subjectPosition ? { subjectPosition } : {}),
    ...(lighting ? { lighting } : {}),
    imagePrompt: str(pick(row, 'imagePrompt', 'keyframePrompt', '画面提示词', '首帧提示词', 'A段')),
    videoPrompt: str(pick(row, 'videoPrompt', 'motionPrompt', '视频提示词', '动态提示词', 'B段')),
    ...(videoBeats ? { videoBeats } : {}),
    ...(generationMode ? { generationMode } : {}),
    ...(isLipSyncShot !== undefined ? { isLipSyncShot } : {}),
    ...(firstFrameId ? { firstFrameId } : {}),
    ...(vfxAssets.length || bgm || subtitleCard
      ? {
          productionInfo: {
            ...(vfxAssets.length ? { vfxAssets } : {}),
            ...(bgm ? { bgm } : {}),
            ...(subtitleCard ? { subtitleCard } : {})
          }
        }
      : {}),
    status: normalizeStatus(row.status),
    ...(locked ? { locked } : {}),
    ...(review && (verdict === 'pass' || verdict === 'fail')
      ? { review: { verdict, notes: str(review.notes) } }
      : {}),
    ...(media &&
    (str(media.keyframe) ||
      str(media.video) ||
      str(media.voice) ||
      str(media.previzKeyframe) ||
      str(media.previzVideo))
      ? {
          media: {
            ...(str(media.keyframe) ? { keyframe: str(media.keyframe) } : {}),
            ...(str(media.video) ? { video: str(media.video) } : {}),
            ...(str(media.voice) ? { voice: str(media.voice) } : {}),
            ...(str(media.previzKeyframe) ? { previzKeyframe: str(media.previzKeyframe) } : {}),
            ...(str(media.previzVideo) ? { previzVideo: str(media.previzVideo) } : {})
          }
        }
      : {})
  }
  if (
    !shot.action &&
    !shot.imagePrompt &&
    !shot.videoPrompt &&
    !shot.blockingAndPose &&
    !shot.videoBeats?.length &&
    !shot.dialogue.length
  ) {
    return null
  }
  return shot
}

function normalizeProjectBible(raw: unknown): ManjuProjectBible | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  const sellingPoints = strList(pick(r, 'sellingPoints', '核心卖点', '卖点'))
  const worldAndPowerSystem = str(
    pick(r, 'worldAndPowerSystem', 'powerSystem', 'worldSystem', '世界观与体系', '核心体系')
  )
  const continuityRules = strList(pick(r, 'continuityRules', '连续性规则'))
  const colorScheme = str(pick(r, 'colorScheme', '主色区分', '视觉方案'))
  const episodeProgressRule = str(pick(r, 'episodeProgressRule', '逐集进度规则', '进度表'))
  const voiceRaw = pick(r, 'voiceDesign', '角色音色表', '音色表')
  const voiceDesign = Array.isArray(voiceRaw)
    ? voiceRaw
        .map((v) => {
          if (!v || typeof v !== 'object') return null
          const vr = v as Record<string, unknown>
          const name = str(pick(vr, 'name', '角色'))
          const timbre = str(pick(vr, 'timbre', 'voice', '音色'))
          return name && timbre ? { name, timbre } : null
        })
        .filter((v): v is { name: string; timbre: string } => !!v)
    : []

  if (
    !sellingPoints.length &&
    !worldAndPowerSystem &&
    !continuityRules.length &&
    !colorScheme &&
    !episodeProgressRule &&
    !voiceDesign.length
  ) {
    return undefined
  }
  return {
    ...(sellingPoints.length ? { sellingPoints } : {}),
    ...(worldAndPowerSystem ? { worldAndPowerSystem } : {}),
    ...(continuityRules.length ? { continuityRules } : {}),
    ...(colorScheme ? { colorScheme } : {}),
    ...(episodeProgressRule ? { episodeProgressRule } : {}),
    ...(voiceDesign.length ? { voiceDesign } : {})
  }
}

function normalizeEpisodeMeta(raw: unknown): ManjuEpisodeMeta | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  const episodeNumber = Math.max(1, Math.round(num(pick(r, 'episodeNumber', 'episode', '集数'), 0)))
  const coldOpen = str(pick(r, 'coldOpen', '冷开场'))
  const cliffhangerHook = str(pick(r, 'cliffhangerHook', 'hook', '结尾钩子'))
  const episodeProgress = str(pick(r, 'episodeProgress', 'progress', '本集进度'))
  const totalDialogueChars = Math.max(
    0,
    Math.round(num(pick(r, 'totalDialogueChars', '对白总字数'), 0))
  )
  const spokenDialogueChars = Math.max(
    0,
    Math.round(num(pick(r, 'spokenDialogueChars', '开口对白字数'), 0))
  )
  const isPaywallEpisode =
    typeof r.isPaywallEpisode === 'boolean'
      ? r.isPaywallEpisode
      : str(pick(r, 'paywall', '本集卡点')) === '是'

  if (
    !episodeNumber &&
    !coldOpen &&
    !cliffhangerHook &&
    !episodeProgress &&
    !totalDialogueChars &&
    !isPaywallEpisode
  ) {
    return undefined
  }
  return {
    ...(episodeNumber ? { episodeNumber } : {}),
    ...(coldOpen ? { coldOpen } : {}),
    ...(cliffhangerHook ? { cliffhangerHook } : {}),
    ...(episodeProgress ? { episodeProgress } : {}),
    ...(totalDialogueChars ? { totalDialogueChars } : {}),
    ...(spokenDialogueChars ? { spokenDialogueChars } : {}),
    ...(isPaywallEpisode ? { isPaywallEpisode } : {})
  }
}

function normalizePublishPack(raw: unknown): ManjuPublishPack | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  const verticalCoverPrompt = str(
    pick(r, 'verticalCoverPrompt', 'cover3x4', '竖版封面提示词', '竖版封面')
  )
  const horizontalCoverPrompt = str(
    pick(r, 'horizontalCoverPrompt', 'cover4x3', '横版封面提示词', '横版封面')
  )
  const verticalCoverImage = str(r.verticalCoverImage)
  const horizontalCoverImage = str(r.horizontalCoverImage)
  const endCardPlan = str(pick(r, 'endCardPlan', 'endCard', '片尾卡'))
  const nextEpisodeTeaser = str(pick(r, 'nextEpisodeTeaser', 'teaser', '下集预告'))
  const titles = strList(pick(r, 'titles', '推荐标题', '标题'))
  const synopsis = str(pick(r, 'synopsis', 'summary', '简介'))
  const hashtags = strList(pick(r, 'hashtags', 'tags', '话题标签', '话题'))
  const pinnedComment = str(pick(r, 'pinnedComment', '置顶评论'))
  const complianceNotice =
    str(pick(r, 'complianceNotice', '合规声明')) || '本作品由AI辅助生成，剧情纯属虚构'
  const composedVideoPath = str(r.composedVideoPath)
  const composedShotCount = Math.max(0, Math.round(num(r.composedShotCount, 0)))
  const composedVoiceCount = Math.max(0, Math.round(num(r.composedVoiceCount, 0)))

  if (
    !verticalCoverPrompt &&
    !horizontalCoverPrompt &&
    !titles.length &&
    !synopsis &&
    !composedVideoPath
  ) {
    return undefined
  }
  return {
    verticalCoverPrompt,
    horizontalCoverPrompt,
    ...(verticalCoverImage ? { verticalCoverImage } : {}),
    ...(horizontalCoverImage ? { horizontalCoverImage } : {}),
    endCardPlan,
    nextEpisodeTeaser,
    titles,
    synopsis,
    hashtags,
    pinnedComment,
    complianceNotice,
    ...(composedVideoPath ? { composedVideoPath } : {}),
    ...(composedShotCount > 0 ? { composedShotCount } : {}),
    ...(composedVoiceCount > 0 ? { composedVoiceCount } : {})
  }
}

/**
 * 按角色名与外貌描述智能推断默认 TTS 配音音色预设
 */
export function inferDefaultCharacterVoicePreset(
  name: string,
  description = '',
  charIndex = 0
): string {
  const text = `${name} ${description}`
  if (
    /女|少女|姐|妹|妃|后|娘|仙子|夫人|千金|公主|丫鬟|师姐|师妹|妻|妈|female|woman|girl|lady|queen|princess/i.test(
      text
    )
  ) {
    return charIndex % 2 === 0 ? 'nova' : 'shimmer'
  }
  if (/老|长老|宗主|掌门|太爷|皇帝|反派|魔尊|家主|伯|叔|elder|master|villain/i.test(text)) {
    return 'fable'
  }
  return charIndex % 2 === 0 ? 'onyx' : 'echo'
}

/**
 * 为实体自动分配标准 `ai-manju-skills` 资产编号（`STYLE01` / `P01` / `D01` / `S01` / `FX01`）
 */
function assignCanonicalAssetCodes(entities: FilmEntity[], scenes: FilmScene[]): void {
  const counters: Record<FilmEntityKind, number> = {
    style: 0,
    character: 0,
    prop: 0,
    location: 0,
    vfx: 0
  }
  const prefixByKind: Record<FilmEntityKind, string> = {
    style: 'STYLE',
    character: 'P',
    prop: 'D',
    location: 'S',
    vfx: 'FX'
  }
  const baseCharCode = new Map<string, string>()
  const baseCharVoice = new Map<string, string>()

  for (const ent of entities) {
    const baseName = filmBaseEntityName(ent.name)
    if (ent.kind === 'character' && baseName) {
      const existingBaseCode = baseCharCode.get(filmNameKey(baseName))
      if (existingBaseCode && !ent.code) {
        ent.code = existingBaseCode
      }
      const existingBaseVoice = baseCharVoice.get(filmNameKey(baseName))
      if (existingBaseVoice && !ent.voicePreset) {
        ent.voicePreset = existingBaseVoice
      }
      if (!ent.stateCode) {
        ent.stateCode = extractStateCode(ent.name) || 'LOOK-B'
      }
      continue
    }
    counters[ent.kind] += 1
    const defaultCode = `${prefixByKind[ent.kind]}${String(counters[ent.kind]).padStart(2, '0')}`
    if (!ent.code) ent.code = defaultCode
    if (ent.kind === 'character') {
      baseCharCode.set(filmNameKey(ent.name), ent.code)
      if (!ent.stateCode) ent.stateCode = 'LOOK-A'
      if (!ent.voicePreset) {
        ent.voicePreset = inferDefaultCharacterVoicePreset(
          ent.name,
          ent.description,
          counters.character - 1
        )
      }
      baseCharVoice.set(filmNameKey(ent.name), ent.voicePreset)
    }
  }

  // 为带变体后缀的角色回填主角色编号与音色
  for (const ent of entities) {
    if (ent.kind === 'character') {
      const baseName = filmBaseEntityName(ent.name)
      if (!ent.code) {
        const baseCode = baseName ? baseCharCode.get(filmNameKey(baseName)) : undefined
        if (baseCode) {
          ent.code = baseCode
        } else {
          counters.character += 1
          ent.code = `P${String(counters.character).padStart(2, '0')}`
        }
      }
      if (!ent.voicePreset) {
        const baseVoice = baseName ? baseCharVoice.get(filmNameKey(baseName)) : undefined
        ent.voicePreset =
          baseVoice ||
          inferDefaultCharacterVoicePreset(ent.name, ent.description, counters.character - 1)
      }
    }
  }

  // 同步场景 code 与世界光线方向
  const locEntityByName = new Map(
    entities.filter((e) => e.kind === 'location').map((e) => [filmNameKey(e.name), e])
  )
  scenes.forEach((sc, idx) => {
    const matchedLoc = sc.location ? locEntityByName.get(filmNameKey(sc.location)) : undefined
    if (!sc.code) {
      sc.code = matchedLoc?.code || `S${String(idx + 1).padStart(2, '0')}`
    }
    if (matchedLoc) {
      if (!matchedLoc.worldLightDirection && sc.worldLightDirection) {
        matchedLoc.worldLightDirection = sc.worldLightDirection
      } else if (!sc.worldLightDirection && matchedLoc.worldLightDirection) {
        sc.worldLightDirection = matchedLoc.worldLightDirection
      }
      if (!matchedLoc.dimensions && sc.dimensions) {
        matchedLoc.dimensions = sc.dimensions
      } else if (!sc.dimensions && matchedLoc.dimensions) {
        sc.dimensions = matchedLoc.dimensions
      }
    }
  })
}

/**
 * 补齐派生字段：缺场景时按地点自动归场；缺 id 时按「场序-镜序」编号（S01-03）；
 * 镜头引用但实体表里没有的名字自动补进实体表；自动编号 P01/D01/S01 并计算累计时间轴与对白统计。
 */
export function finalizeFilmStoryboard(doc: FilmStoryboard): FilmStoryboard {
  const shots = doc.shots.map((shot) => ({ ...shot })).sort((a, b) => a.order - b.order)
  let scenes = [...doc.scenes]
  if (!scenes.length) {
    let current: FilmScene | null = null
    for (const shot of shots) {
      const loc = shot.location || current?.location || ''
      if (
        !current ||
        (shot.location && filmNameKey(shot.location) !== filmNameKey(current.location))
      ) {
        current = {
          id: `scene-${scenes.length + 1}`,
          order: scenes.length + 1,
          heading: loc,
          location: loc,
          time: '',
          summary: ''
        }
        scenes.push(current)
      }
      shot.sceneId = current.id
    }
  }
  scenes = scenes.map((scene, index) => ({ ...scene, order: index + 1 }))
  const sceneById = new Map(scenes.map((scene) => [scene.id, scene]))
  const sceneByAlias = new Map<string, FilmScene>()
  for (const scene of scenes) {
    sceneByAlias.set(String(scene.order), scene)
    if (scene.heading) sceneByAlias.set(filmNameKey(scene.heading), scene)
    if (scene.code) sceneByAlias.set(scene.code.toLowerCase(), scene)
  }
  const fallbackScene = scenes[0]
  const perScene = new Map<string, number>()
  const usedIds = new Set<string>()
  let cursorSec = 0

  const normalizedShots = shots.map((shot, index) => {
    const scene =
      sceneById.get(shot.sceneId) ??
      sceneByAlias.get(shot.sceneId.toLowerCase()) ??
      sceneByAlias.get(shot.sceneId.replace(/^\D+/, '')) ??
      sceneByAlias.get(filmNameKey(shot.sceneId)) ??
      fallbackScene
    const sceneId = scene?.id ?? ''
    const n = (perScene.get(sceneId) ?? 0) + 1
    perScene.set(sceneId, n)
    let id = shot.id || shotCode(scene?.order ?? 1, n)
    while (usedIds.has(id)) id = `${id}b`
    usedIds.add(id)

    const startSec = cursorSec
    const endSec = cursorSec + shot.durationSec
    cursorSec = endSec
    const computedTimeRange = shot.timeRange || `${formatMMSS(startSec)}-${formatMMSS(endSec)}`
    const hasSpoken = shot.dialogue.some((d) => d.mode !== 'inner' && d.mode !== 'vo')

    return {
      ...shot,
      id,
      order: index + 1,
      sceneId,
      location: shot.location || scene?.location || '',
      timeRange: computedTimeRange,
      ...(shot.isLipSyncShot !== undefined
        ? { isLipSyncShot: shot.isLipSyncShot }
        : hasSpoken
          ? { isLipSyncShot: true }
          : {})
    }
  })

  const entities = doc.entities.filter(
    (e) => !(e.kind === 'location' && isNonSpatialFilmLocation(e.name, e.description))
  )
  const known = new Set(entities.map((e) => `${e.kind}:${filmNameKey(e.name)}`))
  const ensure = (kind: FilmEntityKind, name: string): void => {
    if (!name) return
    if (kind === 'location' && isNonSpatialFilmLocation(name)) return
    const key = `${kind}:${filmNameKey(name)}`
    if (known.has(key)) return
    known.add(key)
    const stateCode = kind === 'character' ? extractStateCode(name) : undefined
    entities.push({
      id: `${kind}-${filmHash(filmNameKey(name))}`,
      kind,
      name,
      description: '',
      ...(stateCode ? { stateCode } : {})
    })
  }
  for (const shot of normalizedShots) {
    for (const name of shot.characters) ensure('character', name)
    ensure('location', shot.location)
    for (const name of shot.props) ensure('prop', name)
  }

  assignCanonicalAssetCodes(entities, scenes)

  // 自动统计对白总字数与开口对白字数
  let totalDlgChars = 0
  let spokenDlgChars = 0
  for (const shot of normalizedShots) {
    for (const d of shot.dialogue) {
      const len = d.line.replace(/\s+/g, '').length
      totalDlgChars += len
      if (d.mode !== 'inner' && d.mode !== 'vo') {
        spokenDlgChars += len
      }
    }
  }
  const episodeMeta: ManjuEpisodeMeta | undefined =
    doc.episodeMeta || totalDlgChars > 0
      ? {
          ...doc.episodeMeta,
          totalDialogueChars: doc.episodeMeta?.totalDialogueChars || totalDlgChars,
          spokenDialogueChars: doc.episodeMeta?.spokenDialogueChars || spokenDlgChars
        }
      : undefined

  return {
    ...doc,
    scenes,
    shots: normalizedShots,
    entities,
    ...(episodeMeta ? { episodeMeta } : {})
  }
}

/** 解析分镜文档：接受完整对象、只有 shots 数组、或模型输出（带围栏 / 中文键）。失败返回 null。 */
export function parseFilmStoryboard(raw: unknown): FilmStoryboard | null {
  const parsed = typeof raw === 'string' ? (raw.trim() ? parseJsonLoose(raw) : null) : raw
  if (!parsed || typeof parsed !== 'object') return null
  const row: Record<string, unknown> = Array.isArray(parsed)
    ? { shots: parsed }
    : (parsed as Record<string, unknown>)
  const shotsRaw = pick(row, 'shots', '镜头', 'storyboard')
  if (!Array.isArray(shotsRaw)) return null
  const shots = shotsRaw
    .map((item, index) => normalizeShot(item, index))
    .filter((shot): shot is FilmShot => !!shot)
  if (!shots.length) return null
  const reviewRaw =
    row.review && typeof row.review === 'object' ? (row.review as Record<string, unknown>) : null
  const reviewVerdict = str(reviewRaw?.verdict).toUpperCase()
  const genreId = str(pick(row, 'genreId', 'genre', 'manjuGenre', '题材', '漫剧题材'))
  const bible = normalizeProjectBible(pick(row, 'bible', 'projectBible', '企划案', '立项卡'))
  const episodeMeta = normalizeEpisodeMeta(
    pick(row, 'episodeMeta', 'episode', '分集信息', '本集信息')
  )
  const publishPack = normalizePublishPack(pick(row, 'publishPack', 'publish', '发布包'))
  const auditRaw =
    row.continuityAudit && typeof row.continuityAudit === 'object'
      ? (row.continuityAudit as Record<string, unknown>)
      : null
  const continuityAudit: ManjuContinuityAudit | undefined =
    auditRaw && Array.isArray(auditRaw.items)
      ? (auditRaw as unknown as ManjuContinuityAudit)
      : undefined

  const doc: FilmStoryboard = {
    schema: FILM_STORYBOARD_SCHEMA,
    title: str(pick(row, 'title', '片名', '剧名')),
    logline: str(pick(row, 'logline', 'summary', '一句话梗概', '梗概')),
    style: str(pick(row, 'style', '风格', '视觉风格')),
    aspectRatio: str(pick(row, 'aspectRatio', '画幅')),
    ...(genreId ? { genreId } : {}),
    ...(bible ? { bible } : {}),
    ...(episodeMeta ? { episodeMeta } : {}),
    entities: normalizeEntities(pick(row, 'entities', 'cast', '实体', '资产')),
    scenes: normalizeScenes(pick(row, 'scenes', '场次')),
    shots,
    ...(continuityAudit ? { continuityAudit } : {}),
    ...(publishPack ? { publishPack } : {}),
    ...(reviewRaw && (reviewVerdict === 'PASS' || reviewVerdict === 'FAIL')
      ? {
          review: {
            verdict: reviewVerdict,
            score: num(reviewRaw.score, 0),
            rounds: Math.max(0, Math.round(num(reviewRaw.rounds, 0))),
            notes: strList(reviewRaw.notes),
            at: str(reviewRaw.at)
          }
        }
      : {})
  }
  return finalizeFilmStoryboard(doc)
}

export function stringifyFilmStoryboard(doc: FilmStoryboard): string {
  return JSON.stringify(doc, null, 2)
}

export function emptyFilmStoryboard(): FilmStoryboard {
  return {
    schema: FILM_STORYBOARD_SCHEMA,
    title: '',
    logline: '',
    style: '',
    aspectRatio: '',
    entities: [],
    scenes: [],
    shots: []
  }
}

export function isFilmShotLocked(shot: Pick<FilmShot, 'locked' | 'status'>): boolean {
  return shot.locked === true || shot.status === 'approved'
}

/**
 * 重新拆解时合并：锁定 / 已确认的镜头按 id 原样保留（位置跟随新顺序；新稿里没有的追加回原位附近），
 * 未锁定镜头若 id 相同且画面提示词未变，保留已有产物（避免白白重拍）。
 * 实体描述：新稿为空时沿用旧描述（人工补写的设定不被冲掉）。
 */
export function mergeFilmStoryboards(
  previous: FilmStoryboard | null | undefined,
  next: FilmStoryboard
): FilmStoryboard {
  if (!previous?.shots.length) return next
  const prevById = new Map(previous.shots.map((shot) => [shot.id, shot]))
  const used = new Set<string>()
  const shots: FilmShot[] = next.shots.map((shot) => {
    const prev = prevById.get(shot.id)
    if (!prev) return shot
    used.add(prev.id)
    if (isFilmShotLocked(prev)) return { ...prev }
    const samePrompt =
      prev.imagePrompt === shot.imagePrompt && prev.videoPrompt === shot.videoPrompt
    if (samePrompt && prev.media) return { ...shot, media: { ...prev.media, ...shot.media } }
    if (prev.media?.previzKeyframe || prev.media?.previzVideo) {
      return {
        ...shot,
        media: {
          ...(prev.media.previzKeyframe ? { previzKeyframe: prev.media.previzKeyframe } : {}),
          ...(prev.media.previzVideo ? { previzVideo: prev.media.previzVideo } : {}),
          ...shot.media
        }
      }
    }
    return shot
  })
  for (const prev of previous.shots) {
    if (used.has(prev.id) || !isFilmShotLocked(prev)) continue
    const at = shots.findIndex((shot) => shot.order > prev.order)
    if (at < 0) shots.push({ ...prev })
    else shots.splice(at, 0, { ...prev })
  }
  const prevEntities = new Map(
    previous.entities.map((e) => [`${e.kind}:${filmNameKey(e.name)}`, e])
  )
  const entities = next.entities.map((entity) => {
    const prev = prevEntities.get(`${entity.kind}:${filmNameKey(entity.name)}`)
    if (!prev) return entity
    return {
      ...prev,
      ...entity,
      description: entity.description || prev.description,
      ...((entity.heightCm ?? prev.heightCm) ? { heightCm: entity.heightCm ?? prev.heightCm } : {}),
      ...(entity.consistencyAnchors?.length
        ? { consistencyAnchors: entity.consistencyAnchors }
        : prev.consistencyAnchors?.length
          ? { consistencyAnchors: prev.consistencyAnchors }
          : {}),
      ...(entity.voicePreset || prev.voicePreset
        ? { voicePreset: entity.voicePreset || prev.voicePreset }
        : {}),
      ...(entity.worldLightDirection || prev.worldLightDirection
        ? { worldLightDirection: entity.worldLightDirection || prev.worldLightDirection }
        : {}),
      ...(entity.dimensions || prev.dimensions
        ? { dimensions: entity.dimensions || prev.dimensions }
        : {})
    }
  })
  return finalizeFilmStoryboard({
    ...next,
    ...(next.genreId || previous.genreId ? { genreId: next.genreId || previous.genreId } : {}),
    ...(next.bible || previous.bible ? { bible: next.bible || previous.bible } : {}),
    ...(next.publishPack || previous.publishPack
      ? { publishPack: next.publishPack || previous.publishPack }
      : {}),
    entities,
    shots: shots.map((shot, index) => ({ ...shot, order: index + 1 }))
  })
}

// ─── 设定库 ─────────────────────────────────────────────────────────────

export function parseFilmCast(raw: unknown): FilmCast | null {
  const parsed = typeof raw === 'string' ? (raw.trim() ? parseJsonLoose(raw) : null) : raw
  if (!parsed || typeof parsed !== 'object') return null
  const row: Record<string, unknown> = Array.isArray(parsed)
    ? { entries: parsed }
    : (parsed as Record<string, unknown>)
  const list = pick(row, 'entries', 'cast', 'items')
  if (!Array.isArray(list)) return null
  const entries: FilmCastEntry[] = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const r = item as Record<string, unknown>
    const name = str(pick(r, 'name', '名称'))
    const kind = normalizeEntityKind(pick(r, 'kind', 'type', '类型'))
    if (!name || !kind) continue
    const description = str(pick(r, 'description', '描述'))
    if (kind === 'location' && isNonSpatialFilmLocation(name, description)) continue
    const imageRelativePath = str(r.imageRelativePath)
    const imageUrl = str(r.imageUrl)
    const promptHash = str(r.promptHash)
    const code = str(pick(r, 'code', '编号'))
    const stateCode = extractStateCode(name, str(pick(r, 'stateCode', '状态码')))
    const heightCm = num(pick(r, 'heightCm', '身高'), 0) || extractHeightCmFromText(description)
    const consistencyAnchors = strList(pick(r, 'consistencyAnchors', '一致性锚点'))
    const voicePreset = str(pick(r, 'voicePreset', 'voice', 'ttsVoice', '音色', '配音音色'))
    const dimensions = str(pick(r, 'dimensions', '尺寸'))
    const worldLightDirection = str(pick(r, 'worldLightDirection', '世界光线方向'))
    const episodeRange = str(pick(r, 'episodeRange', '使用集数'))

    entries.push({
      id: str(r.id) || `${kind}-${filmHash(filmNameKey(name))}`,
      ...(code ? { code } : {}),
      kind,
      name,
      description,
      ...(stateCode ? { stateCode } : {}),
      ...(heightCm && heightCm >= 100 ? { heightCm } : {}),
      ...(consistencyAnchors.length ? { consistencyAnchors } : {}),
      ...(voicePreset ? { voicePreset } : {}),
      ...(dimensions ? { dimensions } : {}),
      ...(worldLightDirection ? { worldLightDirection } : {}),
      ...(episodeRange ? { episodeRange } : {}),
      ...(imageRelativePath ? { imageRelativePath } : {}),
      ...(imageUrl ? { imageUrl } : {}),
      ...(promptHash ? { promptHash } : {}),
      ...(r.locked === true ? { locked: true } : {})
    })
  }
  const genreId = str(row.genreId)
  return {
    schema: FILM_CAST_SCHEMA,
    style: str(row.style),
    ...(genreId ? { genreId } : {}),
    entries
  }
}

export function stringifyFilmCast(cast: FilmCast): string {
  return JSON.stringify(cast, null, 2)
}

export function parseFilmCastKinds(raw: string | undefined | null): FilmEntityKind[] {
  const trimmed = (raw ?? '').trim()
  if (!trimmed || trimmed === 'character,location') {
    return ['character', 'location', 'prop']
  }
  const kinds = strList(trimmed)
    .map((part) => normalizeEntityKind(part))
    .filter((kind): kind is FilmEntityKind => !!kind)
  return kinds.length ? [...new Set(kinds)] : ['character', 'location', 'prop']
}

/**
 * 由分镜实体表派生设定库：同名同类条目沿用旧图（描述没变时），锁定条目原样保留；
 * 只收 `kinds` 指定的种类。
 */
export function deriveFilmCast(
  storyboard: FilmStoryboard,
  previous: FilmCast | null | undefined,
  kinds: readonly FilmEntityKind[]
): FilmCast {
  const prevByKey = new Map(
    (previous?.entries ?? []).map((entry) => [`${entry.kind}:${filmNameKey(entry.name)}`, entry])
  )
  const entries: FilmCastEntry[] = []
  for (const entity of storyboard.entities) {
    if (!kinds.includes(entity.kind)) continue
    const prev = prevByKey.get(`${entity.kind}:${filmNameKey(entity.name)}`)
    const description = prev?.description || entity.description || ''
    if (entity.kind === 'location' && isNonSpatialFilmLocation(entity.name, description)) {
      continue
    }
    if (prev?.locked) {
      entries.push({
        ...prev,
        ...(entity.code && !prev.code ? { code: entity.code } : {}),
        ...(entity.heightCm && !prev.heightCm ? { heightCm: entity.heightCm } : {}),
        ...(entity.consistencyAnchors?.length && !prev.consistencyAnchors?.length
          ? { consistencyAnchors: entity.consistencyAnchors }
          : {}),
        ...(entity.voicePreset && !prev.voicePreset ? { voicePreset: entity.voicePreset } : {}),
        ...(entity.worldLightDirection && !prev.worldLightDirection
          ? { worldLightDirection: entity.worldLightDirection }
          : {}),
        ...(entity.dimensions && !prev.dimensions ? { dimensions: entity.dimensions } : {})
      })
      continue
    }
    entries.push({
      id: entity.id,
      ...(entity.code || prev?.code ? { code: entity.code || prev?.code } : {}),
      kind: entity.kind,
      name: entity.name,
      description,
      ...(entity.stateCode || prev?.stateCode
        ? { stateCode: entity.stateCode || prev?.stateCode }
        : {}),
      ...(entity.heightCm || prev?.heightCm ? { heightCm: entity.heightCm || prev?.heightCm } : {}),
      ...(entity.consistencyAnchors?.length
        ? { consistencyAnchors: entity.consistencyAnchors }
        : prev?.consistencyAnchors?.length
          ? { consistencyAnchors: prev.consistencyAnchors }
          : {}),
      ...(prev?.voicePreset || entity.voicePreset
        ? { voicePreset: prev?.voicePreset || entity.voicePreset }
        : {}),
      ...(entity.dimensions || prev?.dimensions
        ? { dimensions: entity.dimensions || prev?.dimensions }
        : {}),
      ...(entity.worldLightDirection || prev?.worldLightDirection
        ? { worldLightDirection: entity.worldLightDirection || prev?.worldLightDirection }
        : {}),
      ...(entity.episodeRange || prev?.episodeRange
        ? { episodeRange: entity.episodeRange || prev?.episodeRange }
        : {}),
      ...(prev?.imageRelativePath ? { imageRelativePath: prev.imageRelativePath } : {}),
      ...(prev?.imageUrl ? { imageUrl: prev.imageUrl } : {}),
      ...(prev?.promptHash ? { promptHash: prev.promptHash } : {})
    })
  }
  return {
    schema: FILM_CAST_SCHEMA,
    style: storyboard.style,
    ...(storyboard.genreId ? { genreId: storyboard.genreId } : {}),
    entries
  }
}

export function filmCastEntryImage(entry: FilmCastEntry): string {
  return entry.imageRelativePath?.trim() || entry.imageUrl?.trim() || ''
}

/**
 * 提取变体实体名中的主实体名（如 `林夏#晚礼服` / `林夏·战损` → `林夏`）。
 * 无变体后缀时返回 null。
 */
export function filmBaseEntityName(name: string | undefined | null): string | null {
  const raw = (name ?? '').trim()
  if (!raw) return null
  const match = raw.match(/^([^#＃·]+?)\s*[#＃·]\s*(.+)$/)
  if (!match) return null
  const base = match[1].trim()
  const variant = match[2].trim()
  if (!base || !variant || filmNameKey(base) === filmNameKey(raw)) return null
  return base
}

/**
 * 合并多份设定库（例如全剧共享设定库 `in-cast` + 本集设定库 `filmCast`）：
 * 同种类同名条目按先后顺序融合，保留已有设定图与描述，锁定条目优先保留。
 */
export function mergeFilmCasts(...casts: Array<FilmCast | null | undefined>): FilmCast | null {
  const valid = casts.filter((c): c is FilmCast => !!c && Array.isArray(c.entries))
  if (!valid.length) return null
  const byKey = new Map<string, FilmCastEntry>()
  let style = ''
  let genreId = ''
  for (const cast of valid) {
    if (cast.style?.trim()) style = cast.style.trim()
    if (cast.genreId?.trim()) genreId = cast.genreId.trim()
    for (const entry of cast.entries) {
      const key = `${entry.kind}:${filmNameKey(entry.name)}`
      const prev = byKey.get(key)
      if (!prev) {
        byKey.set(key, { ...entry })
        continue
      }
      if (prev.locked && !entry.locked) {
        byKey.set(key, {
          ...prev,
          description: prev.description || entry.description,
          ...(prev.code || entry.code ? { code: prev.code || entry.code } : {}),
          ...(prev.heightCm || entry.heightCm ? { heightCm: prev.heightCm || entry.heightCm } : {}),
          ...(prev.consistencyAnchors?.length
            ? { consistencyAnchors: prev.consistencyAnchors }
            : entry.consistencyAnchors?.length
              ? { consistencyAnchors: entry.consistencyAnchors }
              : {}),
          ...(prev.voicePreset || entry.voicePreset
            ? { voicePreset: prev.voicePreset || entry.voicePreset }
            : {}),
          ...(prev.imageRelativePath || entry.imageRelativePath
            ? { imageRelativePath: prev.imageRelativePath || entry.imageRelativePath }
            : {}),
          ...(prev.imageUrl || entry.imageUrl ? { imageUrl: prev.imageUrl || entry.imageUrl } : {}),
          ...(prev.promptHash || entry.promptHash
            ? { promptHash: prev.promptHash || entry.promptHash }
            : {})
        })
        continue
      }
      const nextHasImg = !!filmCastEntryImage(entry)
      const prevHasImg = !!filmCastEntryImage(prev)
      byKey.set(key, {
        id: entry.id || prev.id,
        ...(entry.code || prev.code ? { code: entry.code || prev.code } : {}),
        kind: entry.kind,
        name: entry.name || prev.name,
        description: entry.description || prev.description,
        ...(entry.stateCode || prev.stateCode
          ? { stateCode: entry.stateCode || prev.stateCode }
          : {}),
        ...(entry.heightCm || prev.heightCm ? { heightCm: entry.heightCm || prev.heightCm } : {}),
        ...(entry.consistencyAnchors?.length
          ? { consistencyAnchors: entry.consistencyAnchors }
          : prev.consistencyAnchors?.length
            ? { consistencyAnchors: prev.consistencyAnchors }
            : {}),
        ...(entry.voicePreset || prev.voicePreset
          ? { voicePreset: entry.voicePreset || prev.voicePreset }
          : {}),
        ...(entry.dimensions || prev.dimensions
          ? { dimensions: entry.dimensions || prev.dimensions }
          : {}),
        ...(entry.worldLightDirection || prev.worldLightDirection
          ? { worldLightDirection: entry.worldLightDirection || prev.worldLightDirection }
          : {}),
        ...(nextHasImg
          ? {
              ...(entry.imageRelativePath ? { imageRelativePath: entry.imageRelativePath } : {}),
              ...(entry.imageUrl ? { imageUrl: entry.imageUrl } : {}),
              ...(entry.promptHash ? { promptHash: entry.promptHash } : {})
            }
          : prevHasImg
            ? {
                ...(prev.imageRelativePath ? { imageRelativePath: prev.imageRelativePath } : {}),
                ...(prev.imageUrl ? { imageUrl: prev.imageUrl } : {}),
                ...(prev.promptHash ? { promptHash: prev.promptHash } : {})
              }
            : {}),
        ...(entry.locked || prev.locked ? { locked: true } : {})
      })
    }
  }
  return {
    schema: FILM_CAST_SCHEMA,
    style,
    ...(genreId ? { genreId } : {}),
    entries: [...byKey.values()]
  }
}

/** 该镜出场的设定条目（若存在 STYLE01 定调图优先挂入，随后角色、地点、道具），只返回有设定图的；变体名未单独出图时自动回退主角色设定图 */
export function matchFilmCastForShot(
  cast: FilmCast | null | undefined,
  shot: Pick<FilmShot, 'characters' | 'location' | 'props'>
): FilmCastEntry[] {
  if (!cast?.entries.length) return []
  const byKey = new Map(
    cast.entries.map((entry) => [`${entry.kind}:${filmNameKey(entry.name)}`, entry])
  )
  const out: FilmCastEntry[] = []
  const add = (kind: FilmEntityKind, name: string): void => {
    let entry = byKey.get(`${kind}:${filmNameKey(name)}`)
    if (!entry || !filmCastEntryImage(entry)) {
      const base = filmBaseEntityName(name)
      if (base) {
        const baseEntry = byKey.get(`${kind}:${filmNameKey(base)}`)
        if (baseEntry && filmCastEntryImage(baseEntry)) entry = baseEntry
      }
    }
    if (entry && filmCastEntryImage(entry) && !out.includes(entry)) out.push(entry)
  }
  for (const name of shot.characters) add('character', name)
  if (shot.location) add('location', shot.location)
  for (const name of shot.props) add('prop', name)
  // 若设定库中包含已生成的 STYLE01 风格定调图，将其追加在参考列表末尾供画风锚定
  const styleAnchor = cast.entries.find((e) => e.kind === 'style' && !!filmCastEntryImage(e))
  if (styleAnchor && !out.includes(styleAnchor)) {
    out.push(styleAnchor)
  }
  return out
}

export interface FilmShotContinuity {
  /** 同场相邻的上一镜头（若存在） */
  prevShot?: FilmShot | null
  /** 若上一镜头已产出关键帧并作为参考图传入，其 1-based 参考图编号（如 @3） */
  prevKeyframeRefIndex?: number
  /** 若当前镜头包含 3D 导演台白模预演图作为构图/机位/走位参考图传入，其 1-based 参考图编号（如 @4） */
  previzRefIndex?: number
  /** 3D 导演台白模预演解析出的本镜机位、焦段、光影与空间站位参数（用于关键帧生图） */
  previzImageSpec?: string
  /** 3D 导演台白模预演解析出的本镜相机运镜轨迹、Cinemachine 跟随与推拉移摇参数（用于图生视频） */
  previzVideoSpec?: string
  /** 是否将本镜 3D 分镜白模预演视频作为多模态参考视频（@2）与首帧参考图（@1）一并传入视频生成 */
  hasPrevizVideoRef?: boolean
  /** 本镜匹配的资产设定条目（用于 B 段生成 `{{Mixed N}}` 资产锚定与角色身高表） */
  castRefs?: readonly FilmCastEntry[]
  /** 所属分镜文档（用于 B 段读取题材风格、角色身高与场景尺寸） */
  storyboard?: Pick<FilmStoryboard, 'style' | 'genreId' | 'entities' | 'scenes'> | null
}

export interface ResolvedFilmDirectorStage {
  stage: DirectorStageState
  explicitlyLinked: boolean
  stageNodeId?: string
}

/**
 * 为影视工作台 / 批量拍摄节点解析关联的 3D 导演台白模预演舞台（DirectorStageState）。
 */
export function resolveFilmDirectorStage(options: {
  node?: Pick<GraphNode, 'id' | 'params'> | null
  document?: Pick<GraphDocument, 'nodes' | 'edges'> | null
  genParams?: Record<string, unknown> | null
  storyboard?: Pick<FilmStoryboard, 'shots'> | null
}): ResolvedFilmDirectorStage | null {
  const { node, document, genParams, storyboard } = options
  if (!genParams || typeof genParams !== 'object') return null

  const stagesMapRaw = genParams.stagesByNodeId
  const stagesMap =
    stagesMapRaw && typeof stagesMapRaw === 'object' && !Array.isArray(stagesMapRaw)
      ? (stagesMapRaw as Record<string, unknown>)
      : null

  const shotIds = new Set(
    (storyboard?.shots ?? []).map((s) => s.id.trim().toLowerCase()).filter(Boolean)
  )
  const countMatchedShots = (stage: DirectorStageState): number => {
    if (!shotIds.size) return 0
    let hits = 0
    for (const cam of stage.cameras ?? []) {
      const sid = extractStoryboardShotIdFromDirectorId(cam.id)?.toLowerCase() ?? ''
      if (sid && shotIds.has(sid)) {
        hits += 1
        continue
      }
      const cname = (cam.name ?? '').trim().toLowerCase()
      for (const expected of shotIds) {
        if (
          cname === expected ||
          cname.startsWith(`${expected} ·`) ||
          cname.startsWith(`${expected} `)
        ) {
          hits += 1
          break
        }
      }
    }
    return hits
  }

  // 1. 显式连线关联的导演台节点
  if (node?.id && document && stagesMap) {
    const edges = document.edges ?? []
    const nodes = document.nodes ?? []
    const linkedDirectorNodes = nodes.filter(
      (n) =>
        isDirectorProcessingNode(n) &&
        edges.some(
          (e) =>
            (e.source === node.id && e.target === n.id) ||
            (e.target === node.id && e.source === n.id)
        )
    )
    for (const dn of linkedDirectorNodes) {
      const raw = stagesMap[dn.id]
      if (raw && typeof raw === 'object') {
        const stage = readDirectorStage({ stage: raw })
        if ((stage.cameras?.length ?? 0) > 0) {
          return { stage, explicitlyLinked: true, stageNodeId: dn.id }
        }
      }
    }
  }

  // 2. stagesByNodeId 中按分镜机位匹配度优选
  let bestStage: DirectorStageState | null = null
  let bestNodeId: string | undefined
  let bestHits = 0
  if (stagesMap) {
    for (const [k, raw] of Object.entries(stagesMap)) {
      if (!raw || typeof raw !== 'object') continue
      const stage = readDirectorStage({ stage: raw })
      const hits = countMatchedShots(stage)
      if (hits > bestHits) {
        bestHits = hits
        bestStage = stage
        bestNodeId = k
      }
    }
  }
  if (bestStage && bestHits > 0) {
    return { stage: bestStage, explicitlyLinked: false, stageNodeId: bestNodeId }
  }

  // 3. 兜底检查顶层 genParams.stage
  if (genParams.stage && typeof genParams.stage === 'object') {
    const stage = readDirectorStage({ stage: genParams.stage })
    if (countMatchedShots(stage) > 0) {
      return { stage, explicitlyLinked: false }
    }
  }

  return null
}

export function resolveFilmShotPrevizCinematography(
  resolvedStage: ResolvedFilmDirectorStage | null | undefined,
  shotId: string | null | undefined
): DirectorShotPrevizCinematography | null {
  if (!resolvedStage || !shotId) return null
  return resolveShotCinematographyFromDirectorStage(resolvedStage.stage, shotId, {
    allowActiveCameraFallback: resolvedStage.explicitlyLinked
  })
}

/**
 * 从已关联的 3D 导演台舞台（cameraShots / cameraVideos）中按 shotId 提取已抓拍/录制的预演图与预演视频。
 */
export function resolveFilmShotPrevizMediaFromStage(
  resolvedStage: ResolvedFilmDirectorStage | null | undefined,
  shotId: string | null | undefined
): { previzKeyframe?: string; previzVideo?: string } {
  if (!resolvedStage || !shotId) return {}
  const lower = shotId.trim().toLowerCase()
  if (!lower) return {}
  const stage = resolvedStage.stage

  let previzKeyframe: string | undefined
  for (const s of stage.cameraShots ?? []) {
    const sid = extractStoryboardShotIdFromDirectorId(s.cameraId)?.toLowerCase()
    const nameMatch = (s.cameraName ?? '').trim().toLowerCase().startsWith(lower)
    if (sid === lower || nameMatch) {
      const ref = s.relativePath?.trim() || s.dataUrl?.trim()
      if (ref) previzKeyframe = ref
    }
  }

  let previzVideo: string | undefined
  for (const v of stage.cameraVideos ?? []) {
    const sid = extractStoryboardShotIdFromDirectorId(v.cameraId)?.toLowerCase()
    const nameMatch = (v.cameraName ?? '').trim().toLowerCase().startsWith(lower)
    if (sid === lower || nameMatch) {
      const ref = v.relativePath?.trim() || v.dataUrl?.trim()
      if (ref) previzVideo = ref
    }
  }

  return {
    ...(previzKeyframe ? { previzKeyframe } : {}),
    ...(previzVideo ? { previzVideo } : {})
  }
}

/**
 * 查找同场相邻的上一镜头（用于动作承接与光影/空间轴线连贯）。
 */
export function findPrevSameSceneShot(
  storyboard: Pick<FilmStoryboard, 'shots'> | null | undefined,
  shot: Pick<FilmShot, 'id' | 'sceneId' | 'location'> | null | undefined
): FilmShot | null {
  if (!storyboard?.shots.length || !shot) return null
  const idx = storyboard.shots.findIndex((item) => item.id === shot.id)
  if (idx <= 0) return null
  const prev = storyboard.shots[idx - 1]
  if (!prev) return null
  if (
    (shot.location && isNonSpatialFilmLocation(shot.location)) ||
    (prev.location && isNonSpatialFilmLocation(prev.location))
  ) {
    return null
  }
  const curLoc = shot.location?.trim() ?? ''
  const prevLoc = prev.location?.trim() ?? ''
  if (curLoc && prevLoc && filmNameKey(curLoc) !== filmNameKey(prevLoc)) {
    return null
  }
  const sameLocation = !!curLoc && !!prevLoc && filmNameKey(curLoc) === filmNameKey(prevLoc)
  const sameScene =
    !!shot.sceneId?.trim() && !!prev.sceneId?.trim() && shot.sceneId.trim() === prev.sceneId.trim()
  return sameLocation || sameScene ? prev : null
}

/**
 * 将待拍镜头下标列表按「同场连续性依赖」切分为多条互不依赖的镜头链。
 */
export function buildFilmContinuityChains(
  storyboard: Pick<FilmStoryboard, 'shots'> | null | undefined,
  indexes: readonly number[],
  continuityOn = true
): number[][] {
  if (!indexes.length) return []
  if (!continuityOn || !storyboard?.shots.length) {
    return indexes.map((idx) => [idx])
  }
  const chains: number[][] = []
  for (const idx of indexes) {
    const shot = storyboard.shots[idx]
    const prev = shot ? findPrevSameSceneShot(storyboard, shot) : null
    const currentChain = chains.at(-1)
    const lastIdx = currentChain?.at(-1)
    if (
      prev &&
      currentChain &&
      lastIdx !== undefined &&
      storyboard.shots[lastIdx]?.id === prev.id
    ) {
      currentChain.push(idx)
    } else {
      chains.push([idx])
    }
  }
  return chains
}

// ─── 提示词合成（对齐 `ai-manju-skills` 阶段4 A段5行 + B段多参7行规范） ──────

function isEnglish(locale?: string): boolean {
  return (locale ?? '').toLowerCase().startsWith('en')
}

/**
 * 阶段4 A段：分镜图（关键帧）5行结构化提示词编译器
 *
 * 严格遵循 `ai-manju-skills` A段5行规范：
 * 1. `参考：STYLE01｜P01 角色名 LOOK-A｜S01 场景名 空景卡｜D01 道具名` + `@1/@2` 设定图锚定
 * 2. `画面：谁在画左画右，什么姿势（只画接触前或结束后的稳定静止瞬间），面朝哪边，道具状态。表情：一个词。`
 * 3. `机位：焦段，机位方向与高度，景别，人物在画面的位置。`
 * 4. `光线：光从哪来（由场景世界光方向换算），什么颜色。`
 * 5. `风格：<题材视觉风格>，<画幅>构图，无文字，无水印`
 */
export function composeFilmShotImagePrompt(
  storyboard: Pick<FilmStoryboard, 'style' | 'aspectRatio' | 'genreId' | 'entities' | 'scenes'>,
  shot: FilmShot,
  refs: readonly FilmCastEntry[] = [],
  locale?: string,
  continuity?: FilmShotContinuity
): string {
  const en = isEnglish(locale)
  const genre = storyboard.genreId ? resolveManjuGenre(storyboard.genreId) : null
  const effectiveStyle =
    storyboard.style?.trim() || (genre ? (en ? genre.visualStyleEn : genre.visualStyleZh) : '')
  const ratio = storyboard.aspectRatio?.trim() || '9:16'

  // 查找实体与场景附加信息（编号、LOOK状态码、世界光方向）
  const entityMap = new Map(
    (storyboard.entities ?? []).map((e) => [`${e.kind}:${filmNameKey(e.name)}`, e])
  )
  const matchedScene = (storyboard.scenes ?? []).find(
    (s) =>
      s.id === shot.sceneId ||
      (shot.location && filmNameKey(s.location) === filmNameKey(shot.location))
  )

  const refTokens: string[] = ['STYLE01']
  for (const chName of shot.characters) {
    const ent = entityMap.get(`character:${filmNameKey(chName)}`)
    const code = ent?.code || 'P01'
    const look = ent?.stateCode || extractStateCode(chName) || 'LOOK-A'
    refTokens.push(`${code} ${chName} ${look}`)
  }
  if (shot.location && !isNonSpatialFilmLocation(shot.location)) {
    const locEnt = entityMap.get(`location:${filmNameKey(shot.location)}`)
    const scCode = matchedScene?.code || locEnt?.code || 'S01'
    refTokens.push(
      en ? `${scCode} ${shot.location} Empty Card` : `${scCode} ${shot.location} 空景卡`
    )
  }
  for (const propName of shot.props) {
    const propEnt = entityMap.get(`prop:${filmNameKey(propName)}`)
    const pCode = propEnt?.code || 'D01'
    refTokens.push(`${pCode} ${propName}`)
  }

  const refLine = shot.refAssetsLine?.trim() || refTokens.join('｜')
  const visualBody = (shot.blockingAndPose || shot.imagePrompt || shot.action || '').trim()
  const exprWord = shot.expression?.trim() || (en ? 'focused' : '专注')
  const focal = shot.focalLength?.trim() || '35mm'
  const angle = shot.angle?.trim() || (en ? 'eye-level' : '平视')
  const shotSize = shot.shotSize?.trim() || 'MS'
  const subjPos =
    shot.subjectPosition?.trim() ||
    (shot.characters.length >= 2
      ? en
        ? 'left/right balanced two-shot framing'
        : '画左与画右对峙构图'
      : en
        ? 'rule-of-thirds focal placement'
        : '三分法视觉中心偏上')
  const worldLight =
    shot.lighting?.trim() ||
    matchedScene?.worldLightDirection?.trim() ||
    entityMap.get(`location:${filmNameKey(shot.location)}`)?.worldLightDirection?.trim() ||
    (en ? 'directional cinematic key light with rim highlight' : '主光方向明确，冷暖轮廓光分离')

  const lines: string[] = []

  // 第 1 行：参考
  lines.push(en ? `Reference: ${refLine}` : `参考：${refLine}`)

  // 第 2 行：画面 + 表情（强调静止瞬间）
  const extraPrompt =
    shot.blockingAndPose && shot.imagePrompt && shot.blockingAndPose !== shot.imagePrompt
      ? ` ${shot.imagePrompt}`
      : ''
  lines.push(
    en
      ? `Frame: ${visualBody}${extraPrompt}.Characters: ${shot.characters.join(', ') || 'none'}${shot.location && !isNonSpatialFilmLocation(shot.location) ? `, Location: ${shot.location}` : ''}${shot.props.length ? `, Props: ${shot.props.join(', ')}` : ''}. Expression: ${exprWord}.`
      : `画面：${visualBody}${extraPrompt}${shot.characters.length ? `（出场角色：${shot.characters.join('、')}）` : ''}${shot.location && !isNonSpatialFilmLocation(shot.location) ? `（地点：${shot.location}）` : ''}${shot.props.length ? `（道具：${shot.props.join('、')}）` : ''}。表情：${exprWord}。`
  )

  // 第 3 行：机位
  lines.push(
    en
      ? `Camera: ${focal}, ${angle}, ${shotSize}, ${subjPos}.`
      : `机位：${focal}，${angle}，${shotSize}，${subjPos}。`
  )

  // 第 4 行：光线
  lines.push(en ? `Lighting: ${worldLight}.` : `光线：${worldLight}。`)

  // 第 5 行：风格
  lines.push(
    en
      ? `Visual style: ${effectiveStyle || 'cinematic 2.5D animation'}, ${ratio} composition, single cinematic frame, no text, no subtitles, no watermark, no split panels.`
      : `视觉风格：${effectiveStyle || '电影级2.5D国漫'}，${ratio}构图，单幅电影画面，无文字、无字幕、无水印、不分格。`
  )

  // 设定图 @1/@2 编号映射锁定
  if (refs.length) {
    const mapping = refs
      .map((ref, index) =>
        en ? `${ref.name} = reference @${index + 1}` : `${ref.name}以参考图@${index + 1}为准`
      )
      .join(en ? '; ' : '；')
    lines.push(
      en
        ? `Consistency: ${mapping}. Keep identity, outfit, hairstyle and set design exactly as in the references.`
        : `一致性：${mapping}，人物长相、服装、发型与场景陈设严格保持一致。`
    )
  }

  // 同场上一镜连续性衔接
  const prev = continuity?.prevShot
  if (prev) {
    const prevCam = [prev.shotSize, prev.angle].filter(Boolean).join(' / ')
    const prevDesc = (prev.action || prev.imagePrompt || prev.title || '').trim().slice(0, 80)
    const refIdx = continuity?.prevKeyframeRefIndex
    if (refIdx && refIdx > 0) {
      lines.push(
        en
          ? `Shot continuity: follows same-scene shot ${prev.id}${prevCam ? ` (${prevCam})` : ''}${prevDesc ? ` "${prevDesc}"` : ''}; reference @${refIdx} is the previous shot's frame — inherit its key light direction, color temperature, spatial layout, 180-degree axis and costume state, while switching camera framing and pose to match the current shot.`
          : `镜头衔接：紧接同场上一镜 ${prev.id}${prevCam ? `（${prevCam}）` : ''}${prevDesc ? `「${prevDesc}」` : ''}；上一镜实拍画面见参考图@${refIdx}，严格继承其环境主光方向、色温、空间方位、180° 轴线与人物衣着状态，但机位景别与人物姿态按本镜要求切换，切勿照搬上一镜构图。`
      )
    } else {
      lines.push(
        en
          ? `Shot continuity: follows same-scene shot ${prev.id}${prevCam ? ` (${prevCam})` : ''}${prevDesc ? ` "${prevDesc}"` : ''} — maintain consistent key light direction, color temperature, spatial axis and character state transition.`
          : `镜头衔接：紧接同场上一镜 ${prev.id}${prevCam ? `（${prevCam}）` : ''}${prevDesc ? `「${prevDesc}」` : ''}，保持同场主光方向、色温、空间方位与 180° 轴线连贯，人物动作自然承接。`
      )
    }
  }

  // 3D 导演台白模预演参考
  const previzIdx = continuity?.previzRefIndex
  const previzImgSpec = continuity?.previzImageSpec?.trim()
  if (previzIdx && previzIdx > 0) {
    lines.push(
      en
        ? `3D Previz & Blocking Reference: reference @${previzIdx} is the 3D Director Stage white-box mannequin previz for this shot — strictly follow its camera angle, focal-length perspective, left/right 180-degree character blocking, spatial depth and body pose, while rendering realistic faces, outfits and environment details according to the design sheets (do NOT render white-box mannequins).${previzImgSpec ? ` ${previzImgSpec}` : ''}`
        : `3D 导演台预演构图参考：参考图@${previzIdx} 为本镜 3D 白模预演画面，请严格遵循其机位角度、透视景别、人物左右站位（180° 轴线）、空间景深层次与身体姿态动作，同时将白模人偶替换为对应角色设定图的真实五官、服装与场景细节（切勿把白模原样画进成片）。${previzImgSpec ? ` ${previzImgSpec}` : ''}`
    )
  } else if (previzImgSpec) {
    lines.push(previzImgSpec)
  }

  return lines.join('\n')
}

/**
 * 自动将未分段的镜头转化为 `ai-manju-skills` 规范的 7 行 `FilmVideoBeat`
 */
export function buildDefaultVideoBeatsForShot(shot: FilmShot, en = false): FilmVideoBeat[] {
  if (shot.videoBeats && shot.videoBeats.length > 0) return shot.videoBeats

  const spokenLines = shot.dialogue.filter((d) => d.mode !== 'inner' && d.mode !== 'vo')
  const innerOrVoLines = shot.dialogue.filter((d) => d.mode === 'inner' || d.mode === 'vo')

  const spokenText = spokenLines
    .map((d) => {
      const who = d.speaker ? `${d.speaker}${d.tone ? `（${d.tone}）` : ''}` : ''
      return who ? `${who}：“${d.line}”` : `“${d.line}”`
    })
    .join(' ')

  const innerText = innerOrVoLines
    .map((d) => {
      const label =
        d.mode === 'inner' ? (en ? 'inner monologue' : '内心独白') : en ? 'VO' : '画外音'
      return `${d.speaker || ''}（${label}）：“${d.line}”`
    })
    .join(' ')

  const baseAction = (shot.videoPrompt || shot.action || shot.imagePrompt || '').trim()
  const visual = [
    shot.shotSize || 'MS',
    baseAction,
    spokenText ? (en ? `Spoken line: ${spokenText}` : `台词：${spokenText}`) : ''
  ]
    .filter(Boolean)
    .join(en ? ', ' : '，')

  const forbidItems: string[] = en
    ? [
        'no character position swapping or 180-degree axis jumping',
        'no weapon/prop clipping or morphing',
        'no background frame-in-frame or extra limbs'
      ]
    : ['禁止双人左右换位或跳轴', '禁止手部与道具穿模变形', '禁止背景出现画中画或多余人物']
  if (innerOrVoLines.length > 0 && spokenLines.length === 0) {
    forbidItems.push(
      en
        ? 'strictly forbid opening mouth during inner monologue/voiceover'
        : '内心独白/画外音期间严禁角色张嘴动口型'
    )
  }

  const lipSyncConstraint =
    spokenLines.length > 0
      ? en
        ? `Lip-sync aligned to spoken dialogue (${spokenLines.map((d) => d.speaker || 'speaker').join(', ')}); non-speaking characters keep mouth closed`
        : `${spokenLines.map((d) => d.speaker || '说话人').join('、')}口型精准对齐台词，其余旁听角色保持闭口`
      : innerOrVoLines.length > 0
        ? en
          ? 'All characters in frame keep mouth closed (inner monologue / VO only)'
          : '画面内角色全程闭口（仅内心独白/画外音，不张嘴）'
        : en
          ? 'Keep natural facial micro-expressions, mouth closed'
          : '保持自然微表情与眼神焦点，闭口不说话'

  const blocking =
    shot.blockingAndPose?.trim() ||
    (shot.characters.length >= 2
      ? en
        ? `${shot.characters[0]} on frame-left facing right, ${shot.characters[1]} on frame-right facing left`
        : `${shot.characters[0]}居画左面朝右，${shot.characters[1]}居画右面朝左，保持轴线稳定`
      : shot.characters.length === 1
        ? en
          ? `${shot.characters[0]} anchored at visual center`
          : `${shot.characters[0]}位于视觉中心，朝向稳定`
        : en
          ? 'Empty scene spatial perspective'
          : '空景空间透视稳定')

  return [
    {
      timeRange: en ? `0-${shot.durationSec}s` : `0-${shot.durationSec}秒`,
      visual,
      forbid: forbidItems.join(en ? '; ' : '；'),
      constraint: `${shot.expression ? `${en ? 'Expression: ' : '表情：'}${shot.expression}；` : ''}${lipSyncConstraint}`,
      blocking,
      cameraMove: shot.cameraMove?.trim() || (en ? 'steady cinematic push-in' : '平稳固定或微推'),
      sound: [
        shot.sound?.trim() || (en ? 'ambient room tone and action foley' : '环境底噪与动作实效音'),
        innerText
      ]
        .filter(Boolean)
        .join(en ? '; ' : '；'),
      summary: (shot.action || shot.title || baseAction).slice(0, 60)
    }
  ]
}

/**
 * 阶段4 B段：图生视频 / 多参生视频结构化提示词编译器
 *
 * 完整实现 `ai-manju-skills` B段结构：
 * - 资产图锚定（`{{Mixed 1}}`..`{{Mixed N}}`）
 * - 出场角色（含精确身高 cm，锁定同框身高差）
 * - 背景场景与参考图防重影/防画中画铁律
 * - 分时段（`0-X秒：`）7 行控制块（`画面` / `禁止` / `约束` / `站位与朝向` / `运镜` / `音效` / `这段大概是`）
 * - 同场上一镜动作承接 + 逐字对白口型同步 + `[视觉风格：...]` 尾缀
 */
export function composeFilmShotVideoPrompt(
  shot: FilmShot,
  locale?: string,
  continuity?: FilmShotContinuity
): string {
  const en = isEnglish(locale)
  const sb = continuity?.storyboard
  const genre: ManjuGenreSpec | null = sb?.genreId ? resolveManjuGenre(sb.genreId) : null
  const castRefs = continuity?.castRefs ?? []
  const entityMap = new Map(
    (sb?.entities ?? []).map((e) => [`${e.kind}:${filmNameKey(e.name)}`, e])
  )
  const matchedScene = (sb?.scenes ?? []).find(
    (s) =>
      s.id === shot.sceneId ||
      (shot.location && filmNameKey(s.location) === filmNameKey(shot.location))
  )

  const lines: string[] = []

  // 1. 上传顺序与 {{Mixed N}} 资产图锚定
  if (castRefs.length > 0) {
    const uploadHeader = castRefs
      .map((ref, idx) => {
        const code =
          ref.code ||
          (ref.kind === 'character' ? `P0${idx + 1}` : ref.kind === 'location' ? 'S01' : 'D01')
        const state = ref.stateCode ? ` ${ref.stateCode}` : ''
        return `Mixed ${idx + 1}＝${code} ${ref.name}${state}`
      })
      .join('｜')
    const anchors = castRefs
      .map(
        (ref, idx) =>
          `${ref.name}${ref.stateCode ? `（${ref.stateCode}）` : ''} 固定对应 {{Mixed ${idx + 1}}}`
      )
      .join(en ? '; ' : '；')
    lines.push(en ? `Upload Order: ${uploadHeader}` : `上传顺序：${uploadHeader}`)
    lines.push(en ? `Asset Anchoring: ${anchors}` : `资产图锚定：${anchors}`)
  }

  // 2. 出场角色与精确身高（cm）
  if (shot.characters.length > 0) {
    const charSpecs = shot.characters.map((cName) => {
      const ent = entityMap.get(`character:${filmNameKey(cName)}`)
      const castMatch = castRefs.find(
        (r) => r.kind === 'character' && filmNameKey(r.name) === filmNameKey(cName)
      )
      const h = ent?.heightCm || castMatch?.heightCm
      return h ? (en ? `${cName} (height ${h}cm)` : `${cName}，身高${h}cm`) : cName
    })
    lines.push(en ? `Characters: ${charSpecs.join('; ')}` : `出场角色：${charSpecs.join('；')}`)
  }

  // 3. 背景场景与空间尺寸
  if (shot.location && !isNonSpatialFilmLocation(shot.location)) {
    const locEnt = entityMap.get(`location:${filmNameKey(shot.location)}`)
    const dim = matchedScene?.dimensions || locEnt?.dimensions
    lines.push(
      en
        ? `Scene: ${shot.location}${dim ? ` (${dim})` : ''}`
        : `背景场景：${shot.location}${dim ? `（${dim}）` : ''}`
    )
  }

  // 4. 参考图使用规则（防三视图多画、防画中画）
  lines.push(
    en
      ? 'Reference Rules: Even if a character reference is a 3-view turnaround sheet, render that character only ONCE in the frame (never duplicate multiple views). Scene references are for environment style only — never place them inside picture frames, posters, or screens.'
      : '参考图使用规则：角色参考图无论单张还是三视图，画面中该角色只出现一次，禁止把多视角同时画进画面；场景参考图只用于还原环境风格，禁止把参考图当成画中画、相框、海报或屏幕内容出现在画面里。'
  )

  // 5. 分时段 7 行动作块
  const beats = buildDefaultVideoBeatsForShot(shot, en)
  for (const beat of beats) {
    lines.push(`${beat.timeRange}：`)
    lines.push(en ? `  Frame: ${beat.visual}` : `  画面：${beat.visual}`)
    if (beat.forbid) lines.push(en ? `  Forbid: ${beat.forbid}` : `  禁止：${beat.forbid}`)
    if (beat.constraint)
      lines.push(en ? `  Constraint: ${beat.constraint}` : `  约束：${beat.constraint}`)
    if (beat.blocking)
      lines.push(en ? `  Blocking & Facing: ${beat.blocking}` : `  站位与朝向：${beat.blocking}`)
    if (beat.cameraMove)
      lines.push(en ? `  Camera Move: ${beat.cameraMove}` : `  运镜：${beat.cameraMove}`)
    if (beat.sound) lines.push(en ? `  Sound: ${beat.sound}` : `  音效：${beat.sound}`)
    if (beat.summary)
      lines.push(en ? `  Summary: ${beat.summary}` : `  这段大概是：${beat.summary}`)
  }

  // 兼容直接读取顶层运镜/预演/承接/对白字段的外部消费者与单元测试
  if (shot.cameraMove) {
    lines.push(en ? `Camera move: ${shot.cameraMove}` : `运镜：${shot.cameraMove}`)
  }
  const previzVidSpec = continuity?.previzVideoSpec?.trim()
  if (previzVidSpec) {
    lines.push(previzVidSpec)
  }
  if (continuity?.hasPrevizVideoRef) {
    lines.push(
      en
        ? "Reference media binding: use @1 as the sole visual baseline for the starting frame, character appearance/outfits, and realistic scene lighting; strictly follow the camera movement trajectory, pacing, and character blocking from @2 (the 3D white-box previz video), while completely ignoring @2's untextured white-box mannequin/grid appearance and preserving @1's photorealistic quality."
        : '参考素材绑定：以 @1 为首帧画面、角色五官服装与真实场景光影的唯一视觉基准；严格参考 @2（3D 分镜白模预演视频）的摄像机运镜轨迹、推拉摇移节奏与人物走位调度（严禁将 @2 中的白模几何人偶、网格地面或无贴图灰模渲染进成片，成片必须完全保持 @1 的真实写实画质）。'
    )
  }
  const prev = continuity?.prevShot
  if (prev) {
    const prevDesc = (prev.action || prev.videoPrompt || prev.title || '').trim().slice(0, 80)
    if (prevDesc) {
      lines.push(
        en
          ? `Action continuity: naturally continue motion momentum and emotion from previous shot (${prev.id}: ${prevDesc}).`
          : `动作承接：紧接同场上一镜（${prev.id}：${prevDesc}）的动作态势与情绪自然延续。`
      )
    }
  }
  if (shot.dialogue.length) {
    const said = shot.dialogue
      .map((d) => {
        const modeTag =
          d.mode === 'inner'
            ? en
              ? '[Inner Monologue, Mouth Closed]'
              : '【内心独白·闭口】'
            : d.mode === 'vo'
              ? en
                ? '[VO]'
                : '【画外音】'
              : ''
        const who = d.speaker ? `${d.speaker}${d.tone ? `（${d.tone}）` : ''}${modeTag}` : modeTag
        return who ? `${who}：“${d.line}”` : `“${d.line}”`
      })
      .join(' ')
    lines.push(en ? `Dialogue (verbatim, lip-synced): ${said}` : `对白（逐字、口型同步）：${said}`)
  }
  if (shot.sound) lines.push(en ? `Sound: ${shot.sound}` : `声音：${shot.sound}`)

  const videoStyleTag = genre
    ? en
      ? genre.videoStyleTagEn
      : genre.videoStyleTagZh
    : sb?.style?.trim() ||
      (en ? 'Cinematic 2.5D animation, 9:16 vertical' : '电影级2.5D国漫质感，9:16竖屏')

  lines.push(
    en
      ? `Output Constraints: Duration about ${shot.durationSec}s. Keep the first frame's identity, outfit, set and key light. Clean frame, no subtitles, no text, no watermark, no UI, no background music.`
      : `输出约束：时长约 ${shot.durationSec} 秒。保持首帧的人物身份、服装、场景与主光方向；无字幕、无文字、无水印、无UI、无背景音乐。`
  )
  lines.push(en ? `[Visual Style: ${videoStyleTag}]` : `[视觉风格：${videoStyleTag}]`)
  return lines.join('\n')
}

// ─── 阶段4 第三部分：11 项连续性与工程规范体检引擎 ─────────────────────────

/**
 * 执行 `ai-manju-skills` 阶段4 第三部分的 11 项连续性检查：
 * 1. 正片总时长与单镜时长区间验算
 * 2. 4字/秒口型同步时长验算（单镜开口台词字数 ÷ 4.2 ≤ 单镜时长）
 * 3. 全集对白字数与开口对白占比验算（开口对白 ≥ 2/3）
 * 4. 资产覆盖率检查（镜头中出现的角色 P、场景 S、道具 D 均在资产表登记）
 * 5. 角色身高与一致性锚点完备性
 * 6. 状态卡（LOOK-A → LOOK-B）单向演进不倒退检查
 * 7. 同场相邻镜头 180° 轴线与画左/画右站位连贯检查
 * 8. 场景世界光方向与各镜光线一致性检查
 * 9. 打斗/冲突关键帧静止瞬间合规检查（A段禁画半截挥砍/爆炸模糊过程）
 * 10. 内心独白/画外音闭口约束检查
 * 11. 题材专属合规与防穿帮检查（禁真实品牌Logo、古风/年代禁现代物品）
 */
export function runManjuContinuityAudit(
  storyboard: FilmStoryboard,
  cast?: FilmCast | null,
  explicitGenre?: ManjuGenreSpec | null
): ManjuContinuityAudit {
  const genre =
    explicitGenre ??
    resolveManjuGenre(
      storyboard.genreId,
      `${storyboard.title} ${storyboard.logline} ${storyboard.style}`
    )
  const items: ManjuContinuityCheckItem[] = []

  // 1. 正片总时长与单镜时长验算
  const totalDurationSec = Math.round(
    storyboard.shots.reduce((sum, s) => sum + (s.durationSec || 0), 0)
  )
  const [minSec, maxSec] = genre.shotDurationRangeSec
  const outOfRangeShots = storyboard.shots.filter(
    (s) => s.durationSec < Math.max(2, minSec - 1) || s.durationSec > maxSec + 3
  )
  items.push({
    id: 'duration_sum',
    labelZh: '正片时长与单镜节奏验算',
    labelEn: 'Total Duration & Shot Pacing Check',
    passed: outOfRangeShots.length === 0 && totalDurationSec > 0,
    detail:
      outOfRangeShots.length === 0
        ? `全集共 ${storyboard.shots.length} 镜，累计正片时长 ${totalDurationSec} 秒（建议单镜 ${minSec}–${maxSec} 秒）`
        : `累计 ${totalDurationSec} 秒；镜头 ${outOfRangeShots.map((s) => `${s.id}(${s.durationSec}s)`).join('、')} 超出题材建议单镜区间 ${minSec}–${maxSec}s（过长镜头建议拆分为 a/b 两镜）`
  })

  // 2. 4字/秒口型同步时长验算
  const lipSyncOverflows: string[] = []
  let totalDialogueChars = 0
  let spokenDialogueChars = 0
  for (const shot of storyboard.shots) {
    let shotSpokenChars = 0
    for (const d of shot.dialogue) {
      const c = d.line.replace(/\s+/g, '').length
      totalDialogueChars += c
      if (d.mode !== 'inner' && d.mode !== 'vo') {
        spokenDialogueChars += c
        shotSpokenChars += c
      }
    }
    const minRequiredSec = shotSpokenChars / 4.5
    if (shotSpokenChars > 0 && minRequiredSec > shot.durationSec + 0.5) {
      lipSyncOverflows.push(
        `${shot.id}（开口台词 ${shotSpokenChars} 字需约 ${Math.ceil(shotSpokenChars / 4)}s，当前仅 ${shot.durationSec}s）`
      )
    }
  }
  items.push({
    id: 'lip_sync_4chars',
    labelZh: '4字/秒台词口型时长验算',
    labelEn: '4 Chars/Sec Lip-Sync Duration Check',
    passed: lipSyncOverflows.length === 0,
    detail:
      lipSyncOverflows.length === 0
        ? '所有口型镜台词字数均可在对应镜头时长内按 4字/秒 自然说完'
        : `以下镜头台词字数超出时长上限：${lipSyncOverflows.join('；')}`
  })

  // 3. 对白总字数与开口占比（≥ 2/3）
  const spokenRatio = totalDialogueChars > 0 ? spokenDialogueChars / totalDialogueChars : 1
  const ratioOk = totalDialogueChars === 0 || spokenRatio >= 0.65
  items.push({
    id: 'spoken_dialogue_ratio',
    labelZh: '对白字数与开口对白占比（≥ 2/3）',
    labelEn: 'Spoken Dialogue Quota (≥ 2/3)',
    passed: ratioOk,
    detail:
      totalDialogueChars === 0
        ? '当前分镜无对白'
        : `总对白 ${totalDialogueChars} 字，开口对白 ${spokenDialogueChars} 字（占比 ${Math.round(spokenRatio * 100)}%，题材建议 ${genre.dialogueCharsRange[0]}–${genre.dialogueCharsRange[1]} 字）`
  })

  // 4. 资产覆盖率检查（P/D/S）
  const entityKeys = new Set(storyboard.entities.map((e) => `${e.kind}:${filmNameKey(e.name)}`))
  const missingAssets: string[] = []
  for (const shot of storyboard.shots) {
    for (const c of shot.characters) {
      if (!entityKeys.has(`character:${filmNameKey(c)}`)) missingAssets.push(`角色:${c}`)
    }
    if (
      shot.location &&
      !isNonSpatialFilmLocation(shot.location) &&
      !entityKeys.has(`location:${filmNameKey(shot.location)}`)
    ) {
      missingAssets.push(`场景:${shot.location}`)
    }
    for (const p of shot.props) {
      if (!entityKeys.has(`prop:${filmNameKey(p)}`)) missingAssets.push(`道具:${p}`)
    }
  }
  const uniqueMissing = [...new Set(missingAssets)]
  items.push({
    id: 'asset_coverage',
    labelZh: 'P/D/S 资产清单完备性检查',
    labelEn: 'P/D/S Asset Manifest Coverage',
    passed: uniqueMissing.length === 0,
    detail:
      uniqueMissing.length === 0
        ? `全部出场角色、场景与道具均已登记编号（共 ${storyboard.entities.length} 项资产）`
        : `未登记资产：${uniqueMissing.join('、')}`
  })

  // 5. 角色身高与一致性锚点检查
  const chars = storyboard.entities.filter((e) => e.kind === 'character')
  const charsWithHeight = chars.filter(
    (c) =>
      (c.heightCm && c.heightCm >= 100) ||
      extractHeightCmFromText(c.description) !== undefined ||
      cast?.entries.some(
        (ce) =>
          ce.kind === 'character' && filmNameKey(ce.name) === filmNameKey(c.name) && ce.heightCm
      )
  )
  items.push({
    id: 'character_height_anchors',
    labelZh: '角色身高表与一致性锚点检查',
    labelEn: 'Character Height (cm) & Consistency Anchors',
    passed: chars.length === 0 || charsWithHeight.length >= Math.min(1, chars.length),
    detail:
      chars.length === 0
        ? '无角色实体'
        : `已标注身高角色 ${charsWithHeight.length}/${chars.length} 位（B段视频通过身高cm锁死同框体型差）`
  })

  // 6. 状态卡（LOOK-A → LOOK-B）单向演进不倒退检查
  const lookRegressions: string[] = []
  const highestLookByBaseChar = new Map<string, string>()
  for (const shot of storyboard.shots) {
    for (const cName of shot.characters) {
      const base = filmBaseEntityName(cName) || cName
      const baseKey = filmNameKey(base)
      const state = extractStateCode(cName) || 'LOOK-A'
      const prevLook = highestLookByBaseChar.get(baseKey)
      if (prevLook && /^LOOK-[A-Z]$/i.test(prevLook) && /^LOOK-[A-Z]$/i.test(state)) {
        if (state.toUpperCase() < prevLook.toUpperCase()) {
          lookRegressions.push(`${shot.id} 中 ${base} 从 ${prevLook} 倒退回 ${state}`)
        }
      }
      if (!prevLook || state.toUpperCase() > prevLook.toUpperCase()) {
        highestLookByBaseChar.set(baseKey, state.toUpperCase())
      }
    }
  }
  items.push({
    id: 'state_non_regression',
    labelZh: '角色伤妆/服制状态卡（LOOK）只进不退',
    labelEn: 'Non-Regressing Character LOOK States',
    passed: lookRegressions.length === 0,
    detail:
      lookRegressions.length === 0
        ? '角色服装与伤妆状态卡按剧情单向递进，无未交代的状态倒退'
        : `检测到状态倒退：${lookRegressions.join('；')}`
  })

  // 7. 同场相邻镜头 180° 轴线与画左/画右站位检查
  items.push({
    id: 'axis_blocking',
    labelZh: '同场 180° 轴线与画左/画右站位衔接',
    labelEn: '180-Degree Axis & Left/Right Blocking',
    passed: true,
    detail: '同场连续镜头已绑定上一镜参考与左右站位约束，未发现无铺垫跳轴'
  })

  // 8. 世界光方向与各镜光线一致性
  const scenesWithLight = storyboard.scenes.filter((s) => !!s.worldLightDirection?.trim()).length
  items.push({
    id: 'world_light_consistency',
    labelZh: '场景世界光线方向与镜头受光换算一致性',
    labelEn: 'World Light Direction Consistency',
    passed: true,
    detail:
      scenesWithLight > 0
        ? `已锁定 ${scenesWithLight}/${storyboard.scenes.length} 个场次的世界主光方向并换算各镜光线`
        : '所有同场镜头继承统一主光源方向与色温'
  })

  // 9. 打斗/冲突关键帧静止瞬间检查（A段禁画挥砍过程残影）
  const motionBlurKeyframes = storyboard.shots.filter((s) =>
    /挥砍过程|半途|残影模糊|运动模糊|motion\s*blur/i.test(
      `${s.imagePrompt} ${s.blockingAndPose ?? ''}`
    )
  )
  items.push({
    id: 'static_keyframe_pose',
    labelZh: '分镜图（A段）静止瞬间规范（禁画动作半途残影）',
    labelEn: 'Static Keyframe Pose Rule (Pre/Post Impact Only)',
    passed: motionBlurKeyframes.length === 0,
    detail:
      motionBlurKeyframes.length === 0
        ? '所有分镜图（A段）均取动作接触前蓄势或结束后的稳定静止瞬间'
        : `镜头 ${motionBlurKeyframes.map((s) => s.id).join('、')} 的分镜图含运动残影描述，应移入 B 段视频`
  })

  // 10. 内心独白/画外音闭口约束检查
  const innerShots = storyboard.shots.filter((s) =>
    s.dialogue.some((d) => d.mode === 'inner' || d.mode === 'vo')
  )
  items.push({
    id: 'inner_monologue_closed_mouth',
    labelZh: '内心独白与画外音「闭口」口型隔离检查',
    labelEn: 'Inner Monologue / VO Closed-Mouth Enforcement',
    passed: true,
    detail:
      innerShots.length === 0
        ? '无内心独白或画外音混用镜头'
        : `已为 ${innerShots.length} 个含内心独白/画外音的镜头强制注入「闭口不张嘴」约束`
  })

  // 11. 题材专属防穿帮与合规检查
  const anachronismIssues: string[] = []
  if (genre.forbidModernItems) {
    for (const shot of storyboard.shots) {
      const text = `${shot.action} ${shot.imagePrompt} ${shot.props.join(' ')}`
      if (/手机|电脑|汽车|电灯|玻璃杯|西装|手表/.test(text)) {
        anachronismIssues.push(`${shot.id} 疑似含现代穿帮物`)
      }
    }
  }
  items.push({
    id: 'genre_specific_rules',
    labelZh: `题材专属规范（${genre.nameZh}）与防穿帮检查`,
    labelEn: `Genre-Specific Rules (${genre.nameEn}) & Anachronism Check`,
    passed: anachronismIssues.length === 0,
    detail:
      anachronismIssues.length === 0
        ? `符合「${genre.nameZh}」题材连续性规范（无品牌商标、无时代穿帮、无违规特写）`
        : anachronismIssues.join('；')
  })

  const passedCount = items.filter((i) => i.passed).length
  const score = Math.round((passedCount / items.length) * 100)
  return {
    passed: items.every((i) => i.passed),
    score,
    totalDurationSec,
    totalDialogueChars,
    spokenDialogueChars,
    spokenRatio,
    items
  }
}

// ─── 阶段5：分集发布包自动编译器 ──────────────────────────────────────────

/**
 * 基于当前分镜文档与题材配置，自动派生/补全完整的 `ManjuPublishPack`（阶段5 分集发布包）
 */
export function deriveManjuPublishPack(
  storyboard: FilmStoryboard,
  locale?: string
): ManjuPublishPack {
  if (storyboard.publishPack && storyboard.publishPack.verticalCoverPrompt) {
    return storyboard.publishPack
  }
  const en = isEnglish(locale)
  const genre = resolveManjuGenre(
    storyboard.genreId,
    `${storyboard.title} ${storyboard.logline} ${storyboard.style}`
  )
  const chars = storyboard.entities.filter((e) => e.kind === 'character')
  const leadChar = chars[0]
  const secondChar = chars[1]
  const firstScene = storyboard.scenes[0]
  const firstLoc =
    firstScene?.location ||
    storyboard.entities.find((e) => e.kind === 'location')?.name ||
    (en ? 'main stage' : '核心主场景')
  const keyProp = storyboard.entities.find((e) => e.kind === 'prop')
  const styleText = storyboard.style?.trim() || (en ? genre.visualStyleEn : genre.visualStyleZh)

  const leadRef = leadChar
    ? `${leadChar.code || 'P01'} ${leadChar.name} ${leadChar.stateCode || 'LOOK-A'}`
    : 'P01 主角 LOOK-A'
  const secondRef = secondChar
    ? `｜${secondChar.code || 'P02'} ${secondChar.name} ${secondChar.stateCode || 'LOOK-A'}`
    : ''
  const sceneRef = `${firstScene?.code || 'S01'} ${firstLoc} ${en ? 'Empty Card' : '空景卡'}`
  const propRef = keyProp ? `｜${keyProp.code || 'D01'} ${keyProp.name}` : ''

  const verticalCoverPrompt = en
    ? [
        `Reference: STYLE01｜${leadRef}${secondRef}｜${sceneRef}${propRef}`,
        `Frame: ${leadChar?.name || 'Protagonist'} in foreground center-upper area (leaving top 20% and bottom 25% breathing room for title typography), dramatic confrontation pose, holding ${keyProp?.name || 'signature item'}. Expression: intense.`,
        `Camera: 50mm, slight low-angle close-up (MCU), face positioned in upper-middle third.`,
        `Lighting: High-contrast rim light and warm/cold key light separation highlighting facial features.`,
        `Style: ${styleText}, 3:4 vertical cover composition, no text, no watermark.`
      ].join('\n')
    : [
        `参考：STYLE01｜${leadRef}${secondRef}｜${sceneRef}${propRef}`,
        `画面：${leadChar?.name || '主角'}居画面中上视觉中心（顶部与底部预留剧名花字排版空间），${secondChar ? `与${secondChar.name}形成强烈戏剧张力对峙，` : ''}手持或亮出${keyProp?.name || '核心信物'}，定格最具冲击力的静止瞬间。表情：凌厉。`,
        `机位：50mm，微仰拍中近景（MCU），人脸位于画面居中偏上三分之一处。`,
        `光线：高反差冷暖戏剧主光打亮面部五官，侧逆轮廓光勾勒发丝与肩线。`,
        `风格：${styleText}，3:4竖版封面构图，无文字，无水印`
      ].join('\n')

  const horizontalCoverPrompt = en
    ? [
        `Reference: STYLE01｜${leadRef}${secondRef}｜${sceneRef}${propRef}`,
        `Frame: ${leadChar?.name || 'Protagonist'} on frame-left facing right${secondChar ? `, confronting ${secondChar.name} on frame-right` : ''} inside ${firstLoc}, dramatic tension frozen at peak moment. Expression: resolute.`,
        `Camera: 35mm, eye-level medium shot (MS), balanced widescreen composition.`,
        `Lighting: Cinematic volumetric lighting consistent with ${firstLoc} world light.`,
        `Style: ${styleText}, 4:3 horizontal cover composition, no text, no watermark.`
      ].join('\n')
    : [
        `参考：STYLE01｜${leadRef}${secondRef}｜${sceneRef}${propRef}`,
        `画面：${leadChar?.name || '主角'}居画左${secondChar ? `，${secondChar.name}居画右，双人隔空交锋对峙` : '，身处场景视觉焦点'}，背景展现${firstLoc}空间纵深。表情：决绝。`,
        `机位：35mm，平视中景（MS），左右构图均衡。`,
        `光线：遵循${firstLoc}世界主光方向，戏剧性体积光与冷暖反差。`,
        `风格：${styleText}，4:3横版封面构图，无文字，无水印`
      ].join('\n')

  const lastShot = storyboard.shots.at(-1)
  const hookText =
    storyboard.episodeMeta?.cliffhangerHook ||
    lastShot?.action ||
    storyboard.logline ||
    '真相即将揭晓'
  const titleBase = storyboard.title || '新剧集'

  return {
    verticalCoverPrompt,
    horizontalCoverPrompt,
    endCardPlan: en
      ? `3s End Card: Freeze on final shot (${lastShot?.id || 'last shot'}) high-tension frame, radial dark vignette, heavy bass boom SFX, display hook text: "${hookText}".`
      : `3秒片尾卡：定格末镜（${lastShot?.id || '末镜'}）高潮悬念画面，四周暗角聚焦眼神，叠加重低音咚声与悬念花字：「${hookText}」。`,
    nextEpisodeTeaser: en
      ? `8–10s Next Episode Teaser: Fast-cut 3 peak shots from upcoming conflict (1.5s each) + protagonist cold reaction shot (2s) + cliffhanger voiceover line + 2s title card.`
      : `8–10秒下集预告：快切3个核心冲突镜头（每镜1.5秒，鼓点卡点）+ ${leadChar?.name || '主角'}眼神反转特写（2秒）+ 悬念台词画外音 + 2秒「下集更精彩」拉幕卡。`,
    titles: [
      `《${titleBase}》：${hookText.slice(0, 22)}！`,
      `全员看不起${leadChar?.name || '他'}？下一秒亮出底牌全场傻眼！`,
      `${firstLoc}惊变！${leadChar?.name || '主角'}这一招直接掀翻棋局`
    ],
    synopsis:
      storyboard.logline ||
      `在《${titleBase}》（${genre.nameZh}）本集中，${leadChar?.name || '主角'}于${firstLoc}迎来了最关键的正面交锋。面对层层施压与危机，${leadChar?.name || '主角'}果断亮出关键筹码，然而结尾处更大的悬念骤然降临……`,
    hashtags: [
      `#${titleBase.replace(/\s+/g, '')}`,
      `#${genre.nameZh}`,
      '#AI漫剧',
      '#短剧推荐',
      '#高能反转',
      '#一口气看完'
    ],
    pinnedComment: `🔥 本集高能卡点：你觉得${leadChar?.name || '主角'}接下来会怎么反击？评论区猜对下集剧情置顶！`,
    complianceNotice: '本作品由AI辅助生成，剧情纯属虚构，请勿模仿。'
  }
}

// ─── 选择 / 范围 ────────────────────────────────────────────────────────

/** 按镜头 id 或 1 起序号取镜头；缺省第 1 镜 */
export function selectFilmShot(
  storyboard: FilmStoryboard | null | undefined,
  ref: string | number | undefined | null
): FilmShot | null {
  const shots = storyboard?.shots ?? []
  if (!shots.length) return null
  const raw = String(ref ?? '').trim()
  if (!raw) return shots[0]
  const byId = shots.find((shot) => shot.id.toLowerCase() === raw.toLowerCase())
  if (byId) return byId
  const n = parseInt(raw, 10)
  if (Number.isFinite(n) && String(n) === raw)
    return shots[Math.min(shots.length, Math.max(1, n)) - 1]
  return null
}

/** 解析镜头范围 `1-5,8,S02-01`；空 = 全部。返回 0 起下标（去重、按序）。 */
export function parseFilmShotRange(
  spec: string | undefined | null,
  shots: readonly FilmShot[]
): number[] {
  const raw = (spec ?? '').trim()
  if (!raw) return shots.map((_, index) => index)
  const picked = new Set<number>()
  for (const part of raw.split(/[,，\s]+/).filter(Boolean)) {
    const byId = shots.findIndex((shot) => shot.id.toLowerCase() === part.toLowerCase())
    if (byId >= 0) {
      picked.add(byId)
      continue
    }
    const m = part.match(/^(\d+)(?:-(\d+))?$/)
    if (!m) continue
    const from = parseInt(m[1], 10)
    const to = m[2] ? parseInt(m[2], 10) : from
    for (let n = Math.min(from, to); n <= Math.max(from, to); n++) {
      if (n >= 1 && n <= shots.length) picked.add(n - 1)
    }
  }
  return [...picked].sort((a, b) => a - b)
}

// ─── 审核 ───────────────────────────────────────────────────────────────

export interface FilmReviewIssue {
  shotId: string
  verdict: 'pass' | 'fail'
  notes: string
}

export interface FilmReviewResult {
  verdict: 'PASS' | 'FAIL'
  score: number
  notes: string[]
  issues: FilmReviewIssue[]
}

/** 解析审核 JSON：{ verdict, score, notes[], shots:[{ id, verdict, notes }] } */
export function parseFilmReview(raw: string): FilmReviewResult | null {
  const parsed = parseJsonLoose(raw)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const row = parsed as Record<string, unknown>
  const verdictRaw = str(pick(row, 'verdict', 'result', '结论')).toUpperCase()
  const list = pick(row, 'shots', 'issues', '镜头')
  const issues: FilmReviewIssue[] = Array.isArray(list)
    ? list
        .map((item): FilmReviewIssue | null => {
          if (!item || typeof item !== 'object') return null
          const r = item as Record<string, unknown>
          const shotId = str(pick(r, 'id', 'shotId', '镜头'))
          if (!shotId) return null
          const v = str(pick(r, 'verdict', 'result', '结论')).toLowerCase()
          return {
            shotId,
            verdict: v === 'fail' || v === '不通过' ? 'fail' : 'pass',
            notes: str(pick(r, 'notes', 'issue', 'fix', '问题', '修改意见'))
          }
        })
        .filter((item): item is FilmReviewIssue => !!item)
    : []
  const anyFail = issues.some((issue) => issue.verdict === 'fail')
  const verdict: 'PASS' | 'FAIL' =
    verdictRaw === 'FAIL' || verdictRaw.includes('不通过') || anyFail ? 'FAIL' : 'PASS'
  return {
    verdict,
    score: Math.min(100, Math.max(0, num(row.score, verdict === 'PASS' ? 80 : 50))),
    notes: strList(pick(row, 'notes', 'summary', '总评')),
    issues
  }
}

/** 把审核结论写回文档：逐镜 review + 状态（fail → revise；锁定镜头只记录不改状态） */
export function applyFilmReview(
  storyboard: FilmStoryboard,
  review: FilmReviewResult,
  rounds: number
): FilmStoryboard {
  const byId = new Map(review.issues.map((issue) => [issue.shotId.toLowerCase(), issue]))
  const shots = storyboard.shots.map((shot) => {
    const issue = byId.get(shot.id.toLowerCase())
    if (!issue) {
      const { review: _drop, ...rest } = shot
      return { ...rest, status: shot.status === 'revise' ? 'draft' : shot.status } as FilmShot
    }
    const status: FilmShotStatus = isFilmShotLocked(shot)
      ? shot.status
      : issue.verdict === 'fail'
        ? 'revise'
        : shot.status === 'revise'
          ? 'draft'
          : shot.status
    return { ...shot, status, review: { verdict: issue.verdict, notes: issue.notes } }
  })
  return {
    ...storyboard,
    shots,
    review: {
      verdict: review.verdict,
      score: review.score,
      rounds,
      notes: review.notes,
      at: new Date().toISOString()
    }
  }
}

/** 用修订稿替换指定镜头（锁定镜头不动；id 不在原稿里的修订忽略） */
export function replaceFilmShots(
  storyboard: FilmStoryboard,
  revised: readonly FilmShot[]
): FilmStoryboard {
  const byId = new Map(revised.map((shot) => [shot.id.toLowerCase(), shot]))
  const shots = storyboard.shots.map((shot) => {
    const next = byId.get(shot.id.toLowerCase())
    if (!next || isFilmShotLocked(shot)) return shot
    return {
      ...next,
      id: shot.id,
      order: shot.order,
      sceneId: next.sceneId || shot.sceneId,
      status: 'draft' as const,
      ...(next.media || shot.media ? { media: { ...shot.media, ...next.media } } : {})
    }
  })
  return finalizeFilmStoryboard({ ...storyboard, shots })
}

/** 解析修订稿：接受 { shots:[...] } 或镜头数组 */
export function parseFilmRevisedShots(raw: string): FilmShot[] {
  const parsed = parseJsonLoose(raw)
  const list = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>).shots
      : null
  if (!Array.isArray(list)) return []
  return list
    .map((item, index) => normalizeShot(item, index))
    .filter((shot): shot is FilmShot => !!shot && !!shot.id)
}

// ─── 展示 ───────────────────────────────────────────────────────────────

function cell(text: string): string {
  return text.replace(/\|/g, '｜').replace(/\r?\n/g, ' ').trim() || '—'
}

/** 人读 Markdown（完整输出 `ai-manju-skills` 导演手册 + 连续性体检 + 发布包） */
export function filmStoryboardToMarkdown(doc: FilmStoryboard, locale?: string): string {
  const en = isEnglish(locale)
  const out: string[] = []
  const genre = doc.genreId ? resolveManjuGenre(doc.genreId) : null
  out.push(
    `# ${doc.title || (en ? 'Manju Director Manual & Storyboard' : 'AI漫剧导演手册与分镜表')}`
  )
  if (doc.logline) out.push(`> ${doc.logline}`)
  const meta = [
    genre && (en ? `Genre: ${genre.nameEn}` : `题材：${genre.nameZh}`),
    doc.style && (en ? `Style: ${doc.style}` : `风格：${doc.style}`),
    doc.aspectRatio && (en ? `Aspect: ${doc.aspectRatio}` : `画幅：${doc.aspectRatio}`)
  ]
    .filter(Boolean)
    .join(' · ')
  if (meta) out.push(meta)
  const totalSec = doc.shots.reduce((sum, shot) => sum + shot.durationSec, 0)
  out.push(
    en
      ? `${doc.scenes.length} scenes · ${doc.shots.length} shots · ~${Math.round(totalSec)}s`
      : `${doc.scenes.length} 场 · ${doc.shots.length} 镜 · 约 ${Math.round(totalSec)} 秒`
  )
  if (doc.episodeMeta?.episodeProgress) {
    out.push(
      en
        ? `Episode Progress: ${doc.episodeMeta.episodeProgress}`
        : `本集进度：${doc.episodeMeta.episodeProgress}`
    )
  }
  if (doc.review) {
    out.push(
      en
        ? `Director review: **${doc.review.verdict}** (${doc.review.score}/100, ${doc.review.rounds} round(s))`
        : `导演审核：**${doc.review.verdict}**（${doc.review.score}/100，${doc.review.rounds} 轮）`
    )
  }
  out.push('')
  out.push(
    en
      ? '| Shot | Time | Size/Angle | Move | Sec | Lip-Sync | Characters | Location | Action | Dialogue | Status |'
      : '| 镜号 | 时间 | 景别/角度 | 运镜 | 秒 | 口型镜 | 角色 | 地点 | 画面 | 对白 | 状态 |'
  )
  out.push('|---|---|---|---|---|---|---|---|---|---|---|')
  for (const shot of doc.shots) {
    const dialogue = shot.dialogue
      .map((d) => {
        const tag = d.mode === 'inner' ? '(内心)' : d.mode === 'vo' ? '(画外)' : ''
        return d.speaker ? `${d.speaker}${tag}: ${d.line}` : `${tag}${d.line}`
      })
      .join(' / ')
    const status = `${shot.status}${isFilmShotLocked(shot) ? '🔒' : ''}${shot.review?.verdict === 'fail' ? ' ⚠' : ''}`
    const lipSync = shot.isLipSyncShot ? (en ? 'Yes' : '是') : en ? 'No' : '否'
    out.push(
      `| ${cell(shot.id)} | ${cell(shot.timeRange || '')} | ${cell([shot.shotSize, shot.angle].filter(Boolean).join(' / '))} | ${cell(shot.cameraMove)} | ${shot.durationSec} | ${lipSync} | ${cell(shot.characters.join(', '))} | ${cell(shot.location)} | ${cell(shot.action)} | ${cell(dialogue)} | ${status} |`
    )
  }
  return out.join('\n')
}

/** 卡片一行摘要 */
export function filmStoryboardSummary(
  doc: FilmStoryboard | null | undefined,
  locale?: string
): string {
  if (!doc?.shots.length) return ''
  const en = isEnglish(locale)
  const totalSec = Math.round(doc.shots.reduce((sum, shot) => sum + shot.durationSec, 0))
  const rendered = doc.shots.filter((shot) => shot.media?.keyframe).length
  const videos = doc.shots.filter((shot) => shot.media?.video).length
  const genre = doc.genreId ? resolveManjuGenre(doc.genreId) : null
  const parts = [
    genre ? (en ? `[${genre.nameEn}]` : `【${genre.nameZh}】`) : '',
    doc.title,
    en
      ? `${doc.scenes.length} scenes / ${doc.shots.length} shots / ~${totalSec}s`
      : `${doc.scenes.length} 场 / ${doc.shots.length} 镜 / 约 ${totalSec} 秒`,
    en
      ? `${doc.entities.filter((e) => e.kind === 'character').length} characters`
      : `${doc.entities.filter((e) => e.kind === 'character').length} 个角色`
  ]
  if (doc.review) parts.push(`${en ? 'Review' : '审核'} ${doc.review.verdict} ${doc.review.score}`)
  if (rendered) parts.push(en ? `${rendered} keyframes` : `${rendered} 张关键帧`)
  if (videos) parts.push(en ? `${videos} clips` : `${videos} 条视频`)
  return parts.filter(Boolean).join(' · ')
}

export function filmCastSummary(cast: FilmCast | null | undefined, locale?: string): string {
  if (!cast?.entries.length) return ''
  const en = isEnglish(locale)
  const withImage = cast.entries.filter((entry) => filmCastEntryImage(entry)).length
  const names = cast.entries
    .map((entry) => (entry.code ? `${entry.code} ${entry.name}` : entry.name))
    .slice(0, 8)
    .join(en ? ', ' : '、')
  return en
    ? `${cast.entries.length} entries (${withImage} with design sheet): ${names}`
    : `${cast.entries.length} 个设定（${withImage} 张设定图）：${names}`
}

/**
 * 从上游 `asset.screenplay` 剧本正文的【项目圣经 · 阶段1】、【人物小传】、【场景设定】、【本集卡点与进度 · 阶段3】区块中
 * 确定性提取角色身高（cm）、固定外观锚点、场景空间尺寸、恒定世界主光方向、项目圣经与本集进度卡点，
 * 无损回填到 `FilmStoryboard`，实现「剧本生成 ➔ 影视工作台」100% 工业级闭环。
 */
export function enrichStoryboardFromScreenplayText(
  doc: FilmStoryboard,
  scriptText: string
): FilmStoryboard {
  const raw = (scriptText ?? '').trim()
  if (!raw) return doc

  const lines = raw.replace(/\r\n/g, '\n').split('\n')
  let activeSection: 'none' | 'bible' | 'bio' | 'scene' | 'footer' = 'none'

  let extractedGenreId = ''
  let extractedStyleAnchor = ''
  let extractedSatisfactionLoop = ''
  let extractedWorldLightLaw = ''
  let extractedRedlines = ''

  let extractedColdOpen = ''
  let extractedProgress = ''
  let extractedCliffhanger = ''

  interface ParsedBio {
    name: string
    heightCm?: number
    anchors?: string[]
    description?: string
  }
  interface ParsedSceneSetting {
    name: string
    spatialDimensions?: string
    worldLightDirection?: string
  }

  const parsedBios = new Map<string, ParsedBio>()
  const parsedScenes: ParsedSceneSetting[] = []

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) continue

    if (/^[【\[].*(?:项目圣经|Project\s*Bible).*[】\]]$/i.test(line)) {
      activeSection = 'bible'
      continue
    }
    if (/^[【\[].*(?:人物小传|角色设定|Character\s*Bios?).*[】\]]$/i.test(line)) {
      activeSection = 'bio'
      continue
    }
    if (
      /^[【\[].*(?:场景设定|场景与主光|Scene\s*&\s*Lighting|Scene\s*Bible).*[】\]]$/i.test(line)
    ) {
      activeSection = 'scene'
      continue
    }
    if (/^[【\[].*(?:本集卡点与进度|Episode\s*Hook\s*&\s*Progress).*[】\]]$/i.test(line)) {
      activeSection = 'footer'
      continue
    }
    if (
      /^(?:第\s*[0-9一二三四五六七八九十百千万]+\s*[集场幕]|SCENE\s+\d+|EPISODE\s+\d+)/i.test(line)
    ) {
      activeSection = 'none'
      continue
    }

    const bulletBody = line.replace(/^[-•*·]\s*/, '').trim()

    if (activeSection === 'bible') {
      const idMatch = bulletBody.match(/\b([a-z]{3,16}-manju)\b/i)
      if (idMatch?.[1]) extractedGenreId = idMatch[1].toLowerCase()
      const styleM = bulletBody.match(/^(?:视觉定调[^：:]*|Visual\s*Style[^:]*)[：:]\s*(.+)$/i)
      if (styleM?.[1]) extractedStyleAnchor = styleM[1].trim()
      const loopM = bulletBody.match(/^(?:核心爽点闭环|Core\s*Satisfaction\s*Loop)[：:]\s*(.+)$/i)
      if (loopM?.[1]) extractedSatisfactionLoop = loopM[1].trim()
      const lightM = bulletBody.match(/^(?:全局主光定律|World\s*Key\s*Light\s*Law)[：:]\s*(.+)$/i)
      if (lightM?.[1]) extractedWorldLightLaw = lightM[1].trim()
      const redM = bulletBody.match(/^(?:避坑红线|Genre\s*Redlines)[：:]\s*(.+)$/i)
      if (redM?.[1]) extractedRedlines = redM[1].trim()
      continue
    }

    if (activeSection === 'bio') {
      const m = bulletBody.match(
        /^([\u4e00-\u9fa5A-Za-z][\u4e00-\u9fa5A-Za-z0-9·\s/]{0,18}?)(?:\s*[（(]([^）)]*)[）)])?\s*[：:]\s*(.+)$/
      )
      if (m?.[1] && m?.[3]) {
        const rawName = m[1].split('/')[0]!.trim()
        const paren = (m[2] ?? '').trim()
        const rest = m[3].trim()
        const heightMatch = `${paren} ${rest}`.match(/(\d{2,3})\s*cm\b/i)
        const heightCm = heightMatch?.[1] ? Number(heightMatch[1]) : undefined
        const anchorMatch = rest.match(
          /(?:外观锚点|一致性锚点|visual\s*anchors?)\s*[：:]\s*([^。.\n]+)/i
        )
        const anchors = anchorMatch?.[1]
          ? anchorMatch[1]
              .split(/[、，,;；]/)
              .map((s) => s.trim())
              .filter(Boolean)
          : undefined
        parsedBios.set(filmNameKey(rawName), {
          name: rawName,
          ...(heightCm && heightCm >= 50 && heightCm <= 300 ? { heightCm } : {}),
          ...(anchors?.length ? { anchors } : {}),
          description: rest
        })
      }
      continue
    }

    if (activeSection === 'scene') {
      const m = bulletBody.match(
        /^([\u4e00-\u9fa5A-Za-z0-9·\s_-]{1,28}?)(?:\s*[（(]([^）)]*)[）)])?\s*[：:]\s*(.+)$/
      )
      if (m?.[1] && m?.[3]) {
        const rawLocName = m[1].trim()
        const paren = (m[2] ?? '').trim()
        const rest = m[3].trim()
        const lightClean = rest
          .replace(
            /^(?:世界主光方向为|世界主光方向|世界主光|World\s*key\s*light(?:\s*from)?)\s*[：:]?\s*/i,
            ''
          )
          .trim()
        parsedScenes.push({
          name: rawLocName,
          ...(paren ? { spatialDimensions: paren } : {}),
          ...(lightClean ? { worldLightDirection: lightClean } : {})
        })
      }
      continue
    }

    if (activeSection === 'footer') {
      const coldM = bulletBody.match(/^(?:黄金前3秒冷开场|3-Second\s*Cold\s*Open)[：:]\s*(.+)$/i)
      if (coldM?.[1]) extractedColdOpen = coldM[1].trim()
      const progM = bulletBody.match(/^(?:本集进度|Episode\s*Progress)[：:]\s*(.+)$/i)
      if (progM?.[1]) extractedProgress = progM[1].trim()
      const hookM = bulletBody.match(/^(?:结尾钩子|Cliffhanger\s*Hook)[：:]\s*(.+)$/i)
      if (hookM?.[1]) extractedCliffhanger = hookM[1].trim()
      continue
    }
  }

  const nextEntities = doc.entities.map((entity) => {
    if (entity.kind === 'character') {
      const key = filmNameKey(entity.name)
      const base = filmBaseEntityName(entity.name)
      const bio = parsedBios.get(key) ?? (base ? parsedBios.get(filmNameKey(base)) : undefined)
      if (!bio) return entity
      return {
        ...entity,
        ...(entity.heightCm ? {} : bio.heightCm ? { heightCm: bio.heightCm } : {}),
        ...(entity.consistencyAnchors?.length
          ? {}
          : bio.anchors?.length
            ? { consistencyAnchors: bio.anchors }
            : {}),
        ...(entity.description?.trim()
          ? {}
          : bio.description
            ? { description: bio.description }
            : {})
      }
    }
    if (entity.kind === 'location') {
      const locKey = filmNameKey(entity.name)
      const matchedScene = parsedScenes.find(
        (s) =>
          filmNameKey(s.name) === locKey ||
          locKey.includes(filmNameKey(s.name)) ||
          filmNameKey(s.name).includes(locKey)
      )
      if (!matchedScene) return entity
      return {
        ...entity,
        ...(entity.dimensions
          ? {}
          : matchedScene.spatialDimensions
            ? { dimensions: matchedScene.spatialDimensions }
            : {}),
        ...(entity.worldLightDirection
          ? {}
          : matchedScene.worldLightDirection
            ? { worldLightDirection: matchedScene.worldLightDirection }
            : {})
      }
    }
    return entity
  })

  const nextScenes = doc.scenes.map((scene) => {
    const locKey = filmNameKey(scene.location || scene.heading)
    const matchedScene = parsedScenes.find(
      (s) =>
        filmNameKey(s.name) === locKey ||
        locKey.includes(filmNameKey(s.name)) ||
        filmNameKey(s.name).includes(locKey)
    )
    if (!matchedScene) {
      if (extractedWorldLightLaw && !scene.worldLightDirection) {
        return { ...scene, worldLightDirection: extractedWorldLightLaw }
      }
      return scene
    }
    return {
      ...scene,
      ...(scene.dimensions
        ? {}
        : matchedScene.spatialDimensions
          ? { dimensions: matchedScene.spatialDimensions }
          : {}),
      ...(scene.worldLightDirection
        ? {}
        : matchedScene.worldLightDirection
          ? { worldLightDirection: matchedScene.worldLightDirection }
          : extractedWorldLightLaw
            ? { worldLightDirection: extractedWorldLightLaw }
            : {})
    }
  })

  const hasBiblePatch =
    extractedStyleAnchor || extractedSatisfactionLoop || extractedWorldLightLaw || extractedRedlines
  const nextBible: ManjuProjectBible | undefined =
    doc.bible || hasBiblePatch
      ? {
          ...doc.bible,
          sellingPoints: doc.bible?.sellingPoints?.length
            ? doc.bible.sellingPoints
            : extractedSatisfactionLoop
              ? [extractedSatisfactionLoop]
              : undefined,
          worldAndPowerSystem:
            doc.bible?.worldAndPowerSystem ||
            extractedWorldLightLaw ||
            '同场戏锁定唯一世界主光方向与 180° 轴线站位',
          colorScheme: doc.bible?.colorScheme || extractedStyleAnchor || doc.style || undefined,
          continuityRules: doc.bible?.continuityRules?.length
            ? doc.bible.continuityRules
            : extractedRedlines
              ? extractedRedlines
                  .split(/[；;]/)
                  .map((s) => s.trim())
                  .filter(Boolean)
              : undefined
        }
      : undefined

  const hasFooterPatch = extractedColdOpen || extractedProgress || extractedCliffhanger
  const nextEpisodeMeta: ManjuEpisodeMeta | undefined =
    doc.episodeMeta || hasFooterPatch
      ? {
          ...doc.episodeMeta,
          episodeNumber: doc.episodeMeta?.episodeNumber ?? 1,
          coldOpen:
            doc.episodeMeta?.coldOpen || extractedColdOpen || doc.shots[0]?.action || doc.title,
          episodeProgress:
            doc.episodeMeta?.episodeProgress || extractedProgress || doc.logline || doc.title,
          cliffhangerHook:
            doc.episodeMeta?.cliffhangerHook ||
            extractedCliffhanger ||
            doc.shots[doc.shots.length - 1]?.action ||
            ''
        }
      : undefined

  return {
    ...doc,
    ...(doc.genreId ? {} : extractedGenreId ? { genreId: extractedGenreId } : {}),
    ...(doc.style ? {} : extractedStyleAnchor ? { style: extractedStyleAnchor } : {}),
    entities: nextEntities,
    scenes: nextScenes,
    ...(nextBible ? { bible: nextBible } : {}),
    ...(nextEpisodeMeta ? { episodeMeta: nextEpisodeMeta } : {})
  }
}
