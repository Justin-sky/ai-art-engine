/** Shared domain models for AIArtEngine P0 */

import {
  createEmptyModelsSettings,
  type ModelsSettings
} from './modelProvider'
import {
  createEmptyObjectStorageSettings,
  type ObjectStorageSettings
} from './objectStorage'
import type { ProjectStyleImage } from './stylePresets'

export type { ProjectStyleImage, StylePresetCategory, StyleReferenceSubject } from './stylePresets'
export {
  MAX_STYLE_IMAGES,
  DEFAULT_STYLE_IMAGE_WEIGHT,
  createStyleImageId,
  clampStyleImageWeight,
  normalizeProjectStyleImages,
  styleImagesToPresetText,
  styleImagesToStrengthText,
  buildStyleImagesReferencePrompt,
  appendStyleImagesReferencePrompt,
  resolveGenerateStyleImages,
  resolveStyleMentionReserveCount,
  portMentionIndex,
  resolveStylePresetCategory
} from './stylePresets'

export type { ModelsSettings, ModelModality, ModelProviderInstance, ModelProviderKind } from './modelProvider'
export type {
  ObjectStorageSettings,
  ObjectStorageProviderInstance,
  ObjectStorageProviderKind,
  VolcengineTosParams
} from './objectStorage'
export {
  MODEL_MODALITIES,
  MODEL_PROVIDER_KINDS,
  OPENROUTER_DEFAULT_BASE_URL,
  createEmptyModelsSettings,
  createProviderInstance,
  normalizeModelsSettings,
  pickActiveProvider
} from './modelProvider'
export {
  OBJECT_STORAGE_PROVIDER_KINDS,
  VOLCENGINE_TOS_REGION_PRESETS,
  applyVolcengineTosRegionPreset,
  createEmptyObjectStorageSettings,
  createObjectStorageProvider,
  normalizeObjectStorageSettings
} from './objectStorage'

export type AssetType =
  | 'image'
  | 'video'
  | 'voice'
  | 'motion'
  | 'model'
  | 'screenplay'
  | 'gameSystem'
  | 'canvas'
  | 'world'
  | 'beat'
  | 'subgraph'

/** 将任意字符串收窄为 AssetType */
export function normalizeAssetType(type: string): AssetType {
  return type as AssetType
}

export function isSoundAsset(type: AssetType | string): boolean {
  return normalizeAssetType(type) === 'voice'
}

/** 文件型媒体资产：图片 / 视频 / 声音（库 Inspector 精简、可宿主媒体引用） */
export function isMediaFileAsset(type: AssetType | string | null | undefined): boolean {
  if (!type) return false
  const t = normalizeAssetType(type)
  return t === 'image' || t === 'video' || t === 'voice'
}

/**
 * 可导入为旁挂文件的引用型资产类型（图/声/视/剧本 txt）。
 * 与 isMediaFileAsset 不同：剧本不参与媒体宿主同步等图/声/视专用逻辑。
 */
export function isImportableFileRefAssetType(
  type: AssetType | string | null | undefined
): boolean {
  if (!type) return false
  const t = normalizeAssetType(type)
  return isMediaFileAsset(t) || t === 'screenplay'
}

/**
 * 导入的图/声/视/剧本：仅作引用资源（可 Inspector 预览、可拖入节点图），无独立资产编辑器。
 * 由 importAssets 等写入 genParams.mediaRole = 'reference'。
 */
export function isImportedMediaRefAsset(
  asset: Pick<AssetInfo, 'type' | 'genParams'> | null | undefined
): boolean {
  if (!asset || !isImportableFileRefAssetType(asset.type)) return false
  return asset.genParams?.mediaRole === 'reference'
}

/** 标记为导入引用媒体（写入 genParams） */
export function withImportedMediaRefParams(
  genParams?: Record<string, unknown> | null
): Record<string, unknown> {
  return { ...(genParams ?? {}), mediaRole: 'reference' }
}

/** 世界元素引用（分镜绑定 / 叙事名称列表共用） */
export type WorldEntityKindLabel = '角色' | '场景' | '道具' | '武器'

export interface WorldEntityRef {
  name: string
  imageUrl?: string
  type?: WorldEntityKindLabel
}


function asWorldEntityString(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

function asWorldEntityKind(value: unknown): WorldEntityKindLabel | undefined {
  const raw = asWorldEntityString(value).trim()
  if (raw === '角色' || raw === '场景' || raw === '道具' || raw === '武器') {
    return raw
  }
  return undefined
}

function normalizeWorldEntityRef(item: unknown): WorldEntityRef | null {
  if (typeof item === 'string') {
    const name = item.trim()
    return name ? { name } : null
  }
  if (!item || typeof item !== 'object') return null
  const row = item as Record<string, unknown>
  const name =
    asWorldEntityString(row.name).trim() || asWorldEntityString(row['名称']).trim()
  if (!name) return null
  const imageUrl =
    asWorldEntityString(row.imageUrl).trim() ||
    asWorldEntityString(row.image_url).trim() ||
    asWorldEntityString(row.url).trim() ||
    undefined
  const type = asWorldEntityKind(row.type ?? row['类型'])
  return {
    name,
    ...(imageUrl ? { imageUrl } : {}),
    ...(type ? { type } : {})
  }
}

/** 数组或逗号串 → WorldEntityRef[] */
export function asWorldRefList(value: unknown): WorldEntityRef[] {
  if (Array.isArray(value)) {
    const out: WorldEntityRef[] = []
    for (const item of value) {
      const ref = normalizeWorldEntityRef(item)
      if (ref) out.push(ref)
    }
    return out
  }
  const raw = asWorldEntityString(value).trim()
  if (!raw) return []
  return raw
    .split(/[,，;；、]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((name) => ({ name }))
}


export interface Resolution {
  w: number
  h: number
}

export interface ProjectConfig {
  id: string
  name: string
  version: number
  resolution: Resolution
  fps: number
  /** 画面风格（画风 / 色调 / 材质等自由文本；可由 styleImages 名称同步） */
  stylePreset?: string
  /**
   * 画面风格参考图（最多 4 张）：来自默认风格库或自定义上传。
   * 库条目只存 libraryId；自定义图存 dataUrl。
   */
  styleImages?: ProjectStyleImage[]
  /**
   * 工程全局随机种子：生成节点默认使用（节点可关闭跟随并单独设置）。
   */
  generateSeed?: number
  /**
   * 生成缓存根目录（相对工程根）。缺省见 DEFAULT_CACHE_OUTPUT_DIR。
   * 实际落盘为 `{cacheOutputDir}/{Images|Videos|Texts|Voices}`。
   */
  cacheOutputDir?: string
  /**
   * @deprecated 已收敛为 cacheOutputDir；保留以兼容旧工程 JSON
   */
  imageOutputDir?: string
  /**
   * @deprecated 已收敛为 cacheOutputDir；保留以兼容旧工程 JSON
   */
  videoOutputDir?: string
  createdAt: string
  updatedAt: string
}

/** 工程级生成缓存根目录（相对工程根） */
export const DEFAULT_CACHE_OUTPUT_DIR = 'Cache'
/** @deprecated 历史默认；新代码请用 DEFAULT_CACHE_OUTPUT_DIR */
export const DEFAULT_IMAGE_OUTPUT_DIR = 'Output/images'
/** @deprecated 历史默认；新代码请用 DEFAULT_CACHE_OUTPUT_DIR */
export const DEFAULT_VIDEO_OUTPUT_DIR = 'Output/videos'
/** Cache / 历史资产目录下的图片子目录名 */
export const ASSET_IMAGE_OUTPUT_KIND_DIR = 'Images'
/** Cache / 历史资产目录下的视频子目录名 */
export const ASSET_VIDEO_OUTPUT_KIND_DIR = 'Videos'
/** Cache / 历史资产目录下的剧本文本子目录名 */
export const ASSET_TEXT_OUTPUT_KIND_DIR = 'Texts'
/** Cache / 历史资产目录下的声音音频子目录名 */
export const ASSET_VOICE_OUTPUT_KIND_DIR = 'Voices'

/** 规范化工程相对目录：去首尾斜杠、统一 `/`；空串视为未设置 */
export function normalizeProjectRelativeDir(dir?: string | null): string {
  return (dir ?? '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .replace(/\/+$/, '')
}

/** 工程相对文件路径的父目录；无父级时返回空串 */
export function dirnameProjectRelative(relativePath?: string | null): string {
  const posix = (relativePath ?? '').replace(/\\/g, '/').replace(/\/+$/, '').trim()
  if (!posix) return ''
  const idx = posix.lastIndexOf('/')
  if (idx <= 0) return ''
  return posix.slice(0, idx)
}

/** 宿主资产名 → 可作目录名的安全片段 */
export function sanitizeAssetOutputDirName(name?: string | null): string {
  let s = (name ?? '').normalize('NFC').trim()
  s = s.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
  s = s.replace(/\.+$/g, '')
  if (!s) s = 'Generated'
  if (s.length > 120) s = s.slice(0, 120)
  return s
}

/** 解析工程配置的缓存根（空则 DEFAULT_CACHE_OUTPUT_DIR） */
export function resolveCacheOutputRoot(cacheOutputDir?: string | null): string {
  return normalizeProjectRelativeDir(cacheOutputDir) || DEFAULT_CACHE_OUTPUT_DIR
}

/** 媒体种类对应的 Cache 子目录名 */
export function mediaOutputKindDir(kind: 'image' | 'video' | 'text' | 'voice'): string {
  if (kind === 'video') return ASSET_VIDEO_OUTPUT_KIND_DIR
  if (kind === 'text') return ASSET_TEXT_OUTPUT_KIND_DIR
  if (kind === 'voice') return ASSET_VOICE_OUTPUT_KIND_DIR
  return ASSET_IMAGE_OUTPUT_KIND_DIR
}

/** 相对路径是否落在工程缓存根下（不进资产库） */
export function isUnderCacheOutputDir(
  relativePathOrDir?: string | null,
  cacheOutputDir?: string | null
): boolean {
  const root = resolveCacheOutputRoot(cacheOutputDir)
  const posix = normalizeProjectRelativeDir(relativePathOrDir)
  if (!posix) return false
  return posix === root || posix.startsWith(`${root}/`)
}

/** 相对路径是否落在 Assets/ 资产库树下 */
export function isUnderAssetLibraryDir(relativePathOrDir?: string | null): boolean {
  const posix = normalizeProjectRelativeDir(relativePathOrDir)
  return posix === 'Assets' || posix.startsWith('Assets/')
}

/**
 * 生成落盘文件名 stem：`{资产名}_{节点名}_{YYYYMMDD-HHMMSSmmm}[_{序号}]`
 */
export function buildGeneratedMediaFileKey(input: {
  hostAssetName?: string | null
  nodeTitle?: string | null
  /** 缺省为当前时刻戳 */
  stamp?: string | null
  /** 多张时的 1-based 序号 */
  index?: number | null
}): string {
  const asset = sanitizeAssetOutputDirName(input.hostAssetName)
  const node = sanitizeAssetOutputDirName(input.nodeTitle || 'generate')
  const stamp = (input.stamp ?? '').trim() || formatGeneratedMediaStamp()
  const base = `${asset}_${node}_${stamp}`
  const index = input.index
  if (typeof index === 'number' && Number.isFinite(index) && index > 0) {
    return `${base}_${Math.floor(index)}`
  }
  return base
}

/** 生成媒体文件名用时间戳（含毫秒），固定宽度 yyyyMMdd-HHmmssSSS */
export function formatGeneratedMediaStamp(date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  const ms = String(date.getMilliseconds()).padStart(3, '0')
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}${ms}`
}

/**
 * 解析媒体输出目录：
 * 节点显式 mediaOutputDir > `{cacheOutputDir|Cache}/{Images|Videos|Texts|Voices}`。
 * host* 参数仅保留兼容旧调用方，默认路径不再按资产目录铺开。
 */
export function resolveMediaOutputDir(input: {
  mediaOutputDir?: string | null
  /** 工程配置的缓存根；缺省 Cache */
  cacheOutputDir?: string | null
  /** @deprecated 默认路径不再使用 */
  hostRelativePath?: string | null
  /** @deprecated 默认路径不再使用 */
  hostFolderDir?: string | null
  /** @deprecated 默认路径不再使用；文件名仍可带宿主名 */
  hostAssetName?: string | null
  kind: 'image' | 'video' | 'text' | 'voice'
}): string {
  const explicit = normalizeProjectRelativeDir(input.mediaOutputDir)
  if (explicit) return explicit
  return `${resolveCacheOutputRoot(input.cacheOutputDir)}/${mediaOutputKindDir(input.kind)}`
}

/**
 * 将工程内绝对路径转为相对目录；越界或不在工程内返回 null。
 * 不依赖 Node path，便于渲染进程使用。
 */
export function toProjectRelativeDir(absolutePath: string, projectRoot: string): string | null {
  const norm = (p: string) =>
    p
      .trim()
      .replace(/\\/g, '/')
      .replace(/\/+$/, '')
  const abs = norm(absolutePath)
  const root = norm(projectRoot)
  if (!abs || !root) return null
  const absCmp = abs.toLowerCase()
  const rootCmp = root.toLowerCase()
  if (absCmp === rootCmp) return ''
  if (!absCmp.startsWith(`${rootCmp}/`)) return null
  // 用绝对路径长度切分，保持原大小写
  return abs.slice(root.length + 1)
}

export interface AssetFolder {
  id: string
  name: string
  /** null = root */
  parentId: string | null
  createdAt: string
  updatedAt: string
}

export interface AssetInfo {
  id: string
  type: AssetType
  name: string
  /** Empty when asset is a placeholder without media yet */
  relativePath: string
  /** null/undefined = root */
  folderId?: string | null
  thumbnailPath?: string
  prompt?: string
  notes?: string
  genParams?: Record<string, unknown>
  version: number
  createdAt: string
  updatedAt: string
}

/** 未保存草稿资产 id 前缀（仅存在于渲染进程内存） */
export const DRAFT_ASSET_ID_PREFIX = 'draft:'

export function isDraftAssetId(id: string): boolean {
  return id.startsWith(DRAFT_ASSET_ID_PREFIX)
}

export function createDraftAssetId(): string {
  return `${DRAFT_ASSET_ID_PREFIX}${crypto.randomUUID()}`
}

export interface AppSettings {
  language: 'zh-CN' | 'en-US'
  theme: 'dark' | 'light'
  defaultProjectPath: string
  editor: {
    autoSaveEnabled: boolean
    autoSaveIntervalSec: number
  }
  /**
   * 模型提供商配置（文本 / 图片 / 视频 / 音频）。
   */
  models: ModelsSettings
  /** 对象存储（火山引擎 TOS 等，可扩展） */
  objectStorage: ObjectStorageSettings
  /** Seedance 直连 / Mock 流水线（未配置 OpenRouter 视频时回退） */
  seedance: {
    endpoint: string
    apiKey: string
    model: string
    useMock: boolean
  }
  /** 遗留 LLM 字段（设置页仍会读写；生成优先用 models.providers） */
  llm: {
    endpoint: string
    apiKey: string
    model: string
  }
}

export const DEFAULT_RESOLUTION: Resolution = { w: 1280, h: 720 }

export const ASSET_TYPE_LABELS: Record<AssetType, string> = {
  image: 'Image',
  video: 'Video',
  voice: 'Voice',
  motion: 'Director Deck',
  model: 'Model',
  screenplay: 'Screenplay',
  gameSystem: 'Game System Plan',
  canvas: 'Series',
  world: 'World Elements',
  beat: 'Beat Units',
  subgraph: 'Host Asset'
}

/** 中文资产类型名（落盘默认名 / 主进程命名用） */
export const ASSET_TYPE_LABELS_ZH: Record<AssetType, string> = {
  image: '图片',
  video: '视频',
  voice: '声音',
  motion: '导演台',
  model: '模型',
  screenplay: '剧本',
  gameSystem: '游戏系统策划案',
  canvas: '剧集',
  world: '世界元素',
  beat: '场',
  subgraph: '宿主资产'
}

export function isEnglishLanguage(language?: string | null): boolean {
  const raw = typeof language === 'string' ? language.trim().toLowerCase() : ''
  return raw === 'en-us' || raw.startsWith('en')
}

/** 按界面语言取资产类型显示名 */
export function assetTypeLabel(type: AssetType, language?: string | null): string {
  return (isEnglishLanguage(language) ? ASSET_TYPE_LABELS : ASSET_TYPE_LABELS_ZH)[type]
}

/** 视频资产图标 key（由 WorkspaceItemIcon / VideoAssetIcon 渲染，Windows 紫底三角） */
export const VIDEO_ASSET_ICON = 'video-file'

export const ASSET_TYPE_ICONS: Record<AssetType, string> = {
  image: '🖼️',
  video: VIDEO_ASSET_ICON,
  voice: '🔊',
  motion: '🎬',
  model: '🧊',
  screenplay: '📜',
  gameSystem: '🕹️',
  canvas: '📺',
  world: '🤺',
  beat: '📖',
  subgraph: '📦'
}

/** 仅含骨骼+动画、无网格的模型资产图标（动画片段） */
export const MODEL_ANIMATION_ICON = '🏃'
/** 姿势资产图标 */
export const MODEL_POSE_ICON = '🧍'
/** 自由画布图标 key（由 WorkspaceItemIcon / FreeCanvasIcon 渲染） */
export const FREE_CANVAS_ICON = 'free-canvas'

/** 画布资产子类：自由节点画布 / 剧集起步画布 */
export type CanvasAssetKind = 'free' | 'series'

export function readCanvasAssetKind(
  gen?: Record<string, unknown> | null
): CanvasAssetKind | null {
  if (gen?.canvasKind === 'free' || gen?.canvasKind === 'series') return gen.canvasKind
  return null
}

/** 无 canvasKind 时：含成片时间线输出节点的视为剧集起步图 */
function canvasGraphLooksLikeSeries(gen?: Record<string, unknown> | null): boolean {
  const raw = gen?.graphJson
  if (!raw || typeof raw !== 'object') return false
  const nodes = (raw as { nodes?: unknown }).nodes
  if (!Array.isArray(nodes)) return false
  return nodes.some((node) => {
    if (!node || typeof node !== 'object') return false
    const n = node as { id?: unknown; typeId?: unknown }
    return n.typeId === 'output.timeline' || n.id === 'timeline-output'
  })
}

/** 空白节点画布（非剧集起步） */
export function isFreeCanvasAsset(
  asset: Pick<AssetInfo, 'type' | 'genParams'> | null | undefined
): boolean {
  if (!asset || asset.type !== 'canvas') return false
  const kind = readCanvasAssetKind(asset.genParams)
  if (kind === 'free') return true
  if (kind === 'series') return false
  return !canvasGraphLooksLikeSeries(asset.genParams)
}

/** 模型资产子类：完整模型 / 仅动画片段 / 姿势 */
export type ModelAssetKind = 'model' | 'animation' | 'pose'

export function readModelAssetKind(gen?: Record<string, unknown>): ModelAssetKind {
  if (gen?.modelKind === 'animation') return 'animation'
  if (gen?.modelKind === 'pose') return 'pose'
  return 'model'
}

/** 仅骨骼+动画、无网格的 GLB（导入后写入 genParams.modelKind） */
export function isAnimationModelAsset(
  asset: Pick<AssetInfo, 'type' | 'genParams'> | null | undefined
): boolean {
  return !!asset && asset.type === 'model' && readModelAssetKind(asset.genParams) === 'animation'
}

/** 姿势资产（JSON 存于 genParams.pose，可跨模型套用） */
export function isPoseModelAsset(
  asset: Pick<AssetInfo, 'type' | 'genParams'> | null | undefined
): boolean {
  return !!asset && asset.type === 'model' && readModelAssetKind(asset.genParams) === 'pose'
}

/** 不可作为舞台网格物体放置的模型子类 */
export function isNonPlaceableModelAsset(
  asset: Pick<AssetInfo, 'type' | 'genParams'> | null | undefined
): boolean {
  return isAnimationModelAsset(asset) || isPoseModelAsset(asset)
}

/** 姿势资产数据（骨骼键为 normalizeBoneName 后的名字） */
export interface PoseAssetData {
  schemaVersion: 1
  bones: Record<string, StageVec3>
  sourceModelAssetId?: string | null
}

export function createPoseAssetData(
  bones: Record<string, StageVec3>,
  sourceModelAssetId?: string | null
): PoseAssetData {
  return {
    schemaVersion: 1,
    bones: { ...bones },
    sourceModelAssetId: sourceModelAssetId ?? null
  }
}

export function readPoseAssetData(gen?: Record<string, unknown>): PoseAssetData | null {
  if (readModelAssetKind(gen) !== 'pose') return null
  const raw = gen?.pose
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const bonesRaw = o.bones
  if (!bonesRaw || typeof bonesRaw !== 'object') return null
  const bones: Record<string, StageVec3> = {}
  for (const [name, value] of Object.entries(bonesRaw as Record<string, unknown>)) {
    const key = name.trim()
    if (!key || !value || typeof value !== 'object') continue
    const v = value as Record<string, unknown>
    const x = typeof v.x === 'number' && Number.isFinite(v.x) ? v.x : 0
    const y = typeof v.y === 'number' && Number.isFinite(v.y) ? v.y : 0
    const z = typeof v.z === 'number' && Number.isFinite(v.z) ? v.z : 0
    if (x === 0 && y === 0 && z === 0) continue
    bones[key] = { x, y, z }
  }
  return {
    schemaVersion: 1,
    bones,
    sourceModelAssetId:
      typeof o.sourceModelAssetId === 'string' ? o.sourceModelAssetId : null
  }
}

export function buildPoseAssetGenParams(
  bones: Record<string, StageVec3>,
  sourceModelAssetId?: string | null
): Record<string, unknown> {
  return {
    modelKind: 'pose',
    pose: createPoseAssetData(bones, sourceModelAssetId)
  }
}

/** 资产库/面板展示用图标（动画模型用片段图标；自由画布用专用 key） */
export function assetDisplayIcon(
  asset: Pick<AssetInfo, 'type' | 'genParams'> | null | undefined
): string {
  if (!asset) return '•'
  if (isAnimationModelAsset(asset)) return MODEL_ANIMATION_ICON
  if (isPoseModelAsset(asset)) return MODEL_POSE_ICON
  if (isFreeCanvasAsset(asset)) return FREE_CANVAS_ICON
  return ASSET_TYPE_ICONS[asset.type] ?? '•'
}

export const CREATABLE_ASSET_TYPES: AssetType[] = [
  'canvas',
  'image',
  'video',
  'voice',
  'motion'
]

export function isCanvasAsset(type: AssetType): boolean {
  return type === 'canvas'
}

/** Houdini HDA 风格通用宿主资产（可 dive / 动态端口 / 内图 cook） */
export function isSubgraphAsset(type: AssetType | string): boolean {
  return normalizeAssetType(type) === 'subgraph'
}

export function isWorldElementAsset(type: AssetType | string): boolean {
  return normalizeAssetType(type) === 'world'
}

export function isBeatAsset(type: AssetType | string): boolean {
  return normalizeAssetType(type) === 'beat'
}

export function isDirectorDeck(type: AssetType): boolean {
  return type === 'motion'
}

/** Default name when creating a director deck asset */
export const DEFAULT_DIRECTOR_DECK_NAME = 'New Director Deck'
export const DEFAULT_DIRECTOR_DECK_NAME_ZH = '新建导演台'

export type StagePrimitive = 'box' | 'capsule' | 'cylinder' | 'sphere' | 'plane' | 'quad'
export type StageObjectKind = 'character' | 'prop' | 'model' | 'primitive' | 'empty'
export type TransformMode = 'translate' | 'rotate' | 'scale'

export interface StageVec3 {
  x: number
  y: number
  z: number
}

/** 模型资产默认姿态（与舞台物体一致：rotation 为弧度） */
export interface ModelAssetTransform {
  position: StageVec3
  rotation: StageVec3
  scale: StageVec3
}

export function createDefaultModelAssetTransform(): ModelAssetTransform {
  return {
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 }
  }
}

export function readModelAssetTransform(gen?: Record<string, unknown>): ModelAssetTransform {
  const base = createDefaultModelAssetTransform()
  const raw = gen?.transform
  if (!raw || typeof raw !== 'object') return base
  const t = raw as Record<string, unknown>
  return {
    position: readVec3(t.position, base.position),
    rotation: readVec3(t.rotation, base.rotation),
    scale: readVec3(t.scale, base.scale)
  }
}

/** 模型资产默认颜色（舞台 Inspector / 放置时读取） */
export function readModelAssetColor(gen?: Record<string, unknown>): string | undefined {
  const raw = gen?.color
  if (typeof raw !== 'string') return undefined
  const value = raw.trim()
  if (!/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value)) return undefined
  return value.length === 4
    ? `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`
    : value
}

export function hasModelAssetTransform(gen?: Record<string, unknown>): boolean {
  return !!gen && typeof gen.transform === 'object' && gen.transform != null
}

export type ModelPreviewMeta = {
  hasMesh: boolean
  hasBones: boolean
  clipCount: number
  /** 无网格且有骨骼与动画 → 动画片段资产 */
  animationOnly: boolean
}

export function detectModelPreviewMeta(
  hasMesh: boolean,
  hasBones: boolean,
  clipCount: number
): ModelPreviewMeta {
  const clips = Math.max(0, Math.floor(clipCount))
  return {
    hasMesh,
    hasBones,
    clipCount: clips,
    animationOnly: !hasMesh && hasBones && clips > 0
  }
}

export interface StageObjectState {
  id: string
  name: string
  kind: StageObjectKind
  primitive?: StagePrimitive
  modelAssetId?: string
  color?: string
  /** 父物体 id；空表示全景根下 */
  parentId?: string | null
  /** 默认 true */
  visible?: boolean
  /** 锁定后不可变换 / 视口误操作，默认 false */
  locked?: boolean
  /** 是否在视口显示名称标签；缺省时 empty 为 false，其余为 true */
  nameVisible?: boolean
  position: StageVec3
  rotation: StageVec3
  scale: StageVec3
  /** 骨骼姿势偏移（局部欧拉角，弧度）；键为骨骼名 */
  bonePose?: Record<string, StageVec3>
  /** 用户保存的姿势预设 */
  posePresets?: DirectorPosePreset[]
  /** IK 目标槽手动覆盖（指定末端；links 可省略，运行时沿父链自动收集） */
  ikChains?: DirectorIkChainSpec[]
}

/** 舞台物体姿势预设 */
export interface DirectorPosePreset {
  id: string
  name: string
  /** 骨骼局部欧拉角偏移（弧度） */
  bones: Record<string, StageVec3>
}

/** IK 目标槽 id */
export type DirectorIkChainSlotId = 'slot1' | 'slot2' | 'slot3' | 'slot4'

export interface DirectorIkChainSpec {
  id: DirectorIkChainSlotId
  /** 末端效应器骨骼名 */
  effector: string
  /** 可选；从近末端到近根。省略则按骨骼层级自动收集 */
  links?: string[]
}

export type DirectorViewMode = 'director' | 'camera'

export interface DirectorCameraShot {
  id: string
  dataUrl: string
  createdAt: string
  /** 物化后的工程相对路径；有值时可清空 dataUrl */
  relativePath?: string
}

/** 导演台动画录制（动作） */
export interface DirectorCameraVideo {
  id: string
  createdAt: string
  /** 录制落盘后的工程相对路径（通常 Cache/Videos） */
  relativePath?: string
  /** 可选内嵌；有 relativePath 时可为空 */
  dataUrl?: string
}

/** 导演台机位（可多台） */
export interface DirectorCameraState {
  id: string
  name: string
  /** 相机所属父物体 id（机位预设创建的相机挂在物体下）；缺省为场景根 */
  parentId?: string | null
  /** 默认 true */
  visible?: boolean
  /** 默认 false */
  locked?: boolean
  viewer: DirectorViewerState
}

/** 机位组：组合机位预设批量创建的相机容器（挂在物体下） */
export interface DirectorCameraGroup {
  id: string
  name: string
  /** 所属物体 id（缺省为场景根） */
  parentId?: string | null
}

export interface DirectorStageState {
  linkedPanoramaAssetId?: string | null
  transformMode: TransformMode
  selectedObjectId?: string | null
  /** 全景中的全部机位；viewer 权威在 cameras[activeCameraId].viewer */
  cameras?: DirectorCameraState[]
  /** 机位组（组合机位预设批量创建的相机容器） */
  cameraGroups?: DirectorCameraGroup[]
  /** 活动机位：相机视图 / 截屏 / 图节点输出 */
  activeCameraId?: string | null
  /** 地面网格是否显示 */
  gridVisible?: boolean
  /** 地面网格透明度（0 全透明 · 1 不透明） */
  gridOpacity?: number
  /** 地面网格高度偏移 */
  gridOffsetY?: number
  /** 地面网格密度（固定为 Unity 默认：密度 8 = 1 单位小格） */
  gridDensity?: number
  /** 机位截屏历史（站位） */
  cameraShots?: DirectorCameraShot[]
  /** 动画录制历史（动作） */
  cameraVideos?: DirectorCameraVideo[]
  /** 视口画幅比例；默认 auto（跟随视口） */
  aspectRatio?: DirectorAspectRatio
  /** 全景内容根：缩放% / 平移 / 旋转 */
  world?: DirectorSceneWorld
  /** 无全景时的天空/清屏色 */
  skyColor?: string
  /** 全景球水平旋转（度） */
  panoramaYaw?: number
  /** 全景球半径 */
  panoramaRadius?: number
  /** 底部动画面板状态 */
  animation?: DirectorAnimationState
  /** 绑定的导演台编辑节点 id；节点删除重建后与之不匹配则重置舞台 */
  ownerProcessingNodeId?: string | null
  objects: StageObjectState[]
}

export type DirectorAspectRatio =
  | 'auto'
  | '21:9'
  | '16:9'
  | '4:3'
  | '1:1'
  | '3:4'
  | '9:16'

export const DIRECTOR_ASPECT_RATIOS: readonly DirectorAspectRatio[] = [
  'auto',
  '21:9',
  '16:9',
  '4:3',
  '1:1',
  '3:4',
  '9:16'
] as const

export function normalizeDirectorAspectRatio(raw: unknown): DirectorAspectRatio {
  return DIRECTOR_ASPECT_RATIOS.includes(raw as DirectorAspectRatio)
    ? (raw as DirectorAspectRatio)
    : 'auto'
}

/** 解析画幅宽高比；auto 时用视口尺寸。 */
export function directorAspectRatioValue(
  ratio: DirectorAspectRatio,
  viewportWidth: number,
  viewportHeight: number
): number {
  if (ratio === 'auto') {
    return viewportWidth > 0 && viewportHeight > 0 ? viewportWidth / viewportHeight : 16 / 9
  }
  const [w, h] = ratio.split(':').map(Number)
  if (!Number.isFinite(w) || !Number.isFinite(h) || h === 0) return 16 / 9
  return w / h
}

/** 在视口内居中拟合指定画幅的矩形（CSS 像素）。 */
export function fitDirectorAspectFrame(
  ratio: DirectorAspectRatio,
  viewportWidth: number,
  viewportHeight: number
): { left: number; top: number; width: number; height: number } {
  const vw = Math.max(1, viewportWidth)
  const vh = Math.max(1, viewportHeight)
  if (ratio === 'auto') {
    return { left: 0, top: 0, width: vw, height: vh }
  }
  const target = directorAspectRatioValue(ratio, vw, vh)
  let width = vw
  let height = width / target
  if (height > vh) {
    height = vh
    width = height * target
  }
  return {
    left: (vw - width) / 2,
    top: (vh - height) / 2,
    width,
    height
  }
}

/** 默认首个机位的稳定 id */
export const DIRECTOR_CAMERA_HIERARCHY_ID = '__stage_camera__'
/** 全景全局参数（Hierarchy 点空白时选中，不作为列表行） */
export const DIRECTOR_SCENE_HIERARCHY_ID = '__stage_scene__'
/** Hierarchy「全景背景」伪节点 */
export const DIRECTOR_PANORAMA_HIERARCHY_ID = '__stage_panorama__'

/** 跟随主题时的存储哨兵（与暗色主题 --director-sky 同值） */
export const DEFAULT_DIRECTOR_SKY_COLOR = '#121416'
/** 浅色主题 --director-sky；曾被误持久化为「自定义色」，读取时归一为哨兵 */
export const LIGHT_DIRECTOR_SKY_COLOR = '#e8eaee'
export const DEFAULT_DIRECTOR_PANORAMA_RADIUS = 500
export const DEFAULT_DIRECTOR_SCENE_SCALE_PERCENT = 100

/** 导演台全景内容根变换（缩放百分比 + 平移/旋转） */
export interface DirectorSceneWorld {
  /** 均匀缩放百分比，100 = 1× */
  scalePercent: number
  position: StageVec3
  /** 弧度 */
  rotation: StageVec3
}

export function createDefaultDirectorSceneWorld(): DirectorSceneWorld {
  return {
    scalePercent: DEFAULT_DIRECTOR_SCENE_SCALE_PERCENT,
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 }
  }
}

export function normalizeDirectorSkyColor(raw: unknown): string {
  if (typeof raw === 'string' && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(raw.trim())) {
    const color = raw.trim()
    // 浅色主题默认天空不是自定义色：统一存哨兵，避免切回暗色后视口仍发灰
    if (color.toLowerCase() === LIGHT_DIRECTOR_SKY_COLOR.toLowerCase()) {
      return DEFAULT_DIRECTOR_SKY_COLOR
    }
    return color
  }
  return DEFAULT_DIRECTOR_SKY_COLOR
}

/** 是否「跟随应用主题」的天空色（哨兵或历史浅色默认） */
export function isDirectorSkyFollowTheme(raw: unknown): boolean {
  if (typeof raw !== 'string') return true
  const color = raw.trim().toLowerCase()
  return (
    !color ||
    color === DEFAULT_DIRECTOR_SKY_COLOR.toLowerCase() ||
    color === LIGHT_DIRECTOR_SKY_COLOR.toLowerCase()
  )
}

export function clampDirectorSceneScalePercent(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_DIRECTOR_SCENE_SCALE_PERCENT
  return Math.min(1000, Math.max(1, value))
}

export function clampDirectorPanoramaRadius(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_DIRECTOR_PANORAMA_RADIUS
  return Math.min(2000, Math.max(10, value))
}

export function readDirectorSceneWorld(raw: unknown): DirectorSceneWorld {
  const base = createDefaultDirectorSceneWorld()
  if (!raw || typeof raw !== 'object') return base
  const o = raw as Record<string, unknown>
  return {
    scalePercent: clampDirectorSceneScalePercent(
      typeof o.scalePercent === 'number' ? o.scalePercent : base.scalePercent
    ),
    position: readVec3(o.position, base.position),
    rotation: readVec3(o.rotation, base.rotation)
  }
}

/** 动画路径类型（绘制轨迹） */
export type DirectorAnimPathKind = 'circle' | 'line' | 'rect' | 'pencil' | 'pen'

export const DIRECTOR_ANIM_PATH_KINDS: readonly DirectorAnimPathKind[] = [
  'circle',
  'line',
  'rect',
  'pencil',
  'pen'
] as const

/** 路径锚点的入/出切线手柄（绝对坐标，与 points 同空间） */
export interface DirectorAnimPathHandle {
  in: StageVec3
  out: StageVec3
}

export interface DirectorAnimPath {
  kind: DirectorAnimPathKind
  /** 路径采样/控制点（世界坐标；物体轨为本地坐标） */
  points: StageVec3[]
  closed?: boolean
  /** 与 points 等长；缺省时仍用 CatmullRom；钢笔编辑时写入 */
  handles?: DirectorAnimPathHandle[]
}

export interface DirectorAnimKeyframe {
  id: string
  /** 时间轴绝对时间（秒） */
  time: number
  position: StageVec3
  rotation?: StageVec3
  scale?: StageVec3
}

export const DIRECTOR_PATH_FORWARD_AXES = [
  '+x',
  '-x',
  '+y',
  '-y',
  '+z',
  '-z'
] as const

export type DirectorPathForwardAxis = (typeof DIRECTOR_PATH_FORWARD_AXES)[number]

export const DEFAULT_PATH_FORWARD_AXIS: DirectorPathForwardAxis = '-x'

export function normalizeDirectorPathForwardAxis(
  raw: unknown,
  fallback: DirectorPathForwardAxis = DEFAULT_PATH_FORWARD_AXIS
): DirectorPathForwardAxis {
  return DIRECTOR_PATH_FORWARD_AXES.includes(raw as DirectorPathForwardAxis)
    ? (raw as DirectorPathForwardAxis)
    : fallback
}

export interface DirectorSkeletonClipSegment {
  id: string
  /** GLB 内 clip 名 */
  clip: string
  /**
   * 外部动画资产 id（modelKind=animation）。
   * 缺省/空 = 使用目标模型内嵌动画。
   */
  assetId?: string | null
  start: number
  end: number
  /** 播放速度，默认 1 */
  speed?: number
  /** 片段窗口内循环，默认 true */
  loop?: boolean
}

/** 机位切换轨上的相机区间：播放到该区间时激活对应机位 */
export interface DirectorCameraCutSegment {
  id: string
  cameraId: string
  start: number
  end: number
}

export interface DirectorAnimTrack {
  id: string
  name: string
  targetKind: 'camera' | 'object'
  targetId: string
  start: number
  end: number
  path: DirectorAnimPath | null
  /** 位置关键帧；优先于 path 用于播放插值 */
  keyframes: DirectorAnimKeyframe[]
  /** 播放时角色/相机朝向轨迹切线方向 */
  orientToPath?: boolean
  /** 模型本地前方轴（orientToPath 时使用） */
  pathForwardAxis?: DirectorPathForwardAxis
  /** 时间轴上的骨骼动画片段（可多段、可调长度） */
  skeletonClips?: DirectorSkeletonClipSegment[]
  /** 机位切换轨：播放时按时间激活 cameraSegments 中对应相机（目标机位取景不做变换插值） */
  cameraCut?: boolean
  /** 机位切换区间（cameraCut=true 时使用） */
  cameraSegments?: DirectorCameraCutSegment[]
}

export interface DirectorAnimationState {
  /** 时间轴总时长（秒） */
  duration: number
  loop: boolean
  tracks: DirectorAnimTrack[]
}

export function createDefaultDirectorAnimation(): DirectorAnimationState {
  return {
    duration: 10,
    loop: true,
    tracks: []
  }
}

export function normalizeDirectorAnimPathKind(raw: unknown): DirectorAnimPathKind | null {
  return DIRECTOR_ANIM_PATH_KINDS.includes(raw as DirectorAnimPathKind)
    ? (raw as DirectorAnimPathKind)
    : null
}

function normalizeDirectorAnimPathHandle(raw: unknown): DirectorAnimPathHandle | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const inn = readVec3(o.in, { x: 0, y: 0, z: 0 })
  const out = readVec3(o.out, { x: 0, y: 0, z: 0 })
  if (
    !Number.isFinite(inn.x) ||
    !Number.isFinite(inn.y) ||
    !Number.isFinite(inn.z) ||
    !Number.isFinite(out.x) ||
    !Number.isFinite(out.y) ||
    !Number.isFinite(out.z)
  ) {
    return null
  }
  return { in: inn, out }
}

function normalizeDirectorAnimPath(raw: unknown): DirectorAnimPath | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const kind = normalizeDirectorAnimPathKind(o.kind)
  if (!kind) return null
  const points = Array.isArray(o.points)
    ? o.points
        .map((p) => readVec3(p, { x: 0, y: 0, z: 0 }))
        .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z))
    : []
  if (points.length < 2) return null
  const handlesRaw = Array.isArray(o.handles)
    ? o.handles.map((h) => normalizeDirectorAnimPathHandle(h))
    : null
  const handles =
    handlesRaw &&
    handlesRaw.length === points.length &&
    handlesRaw.every((h): h is DirectorAnimPathHandle => h != null)
      ? handlesRaw
      : undefined
  return {
    kind,
    points,
    closed: o.closed === true || kind === 'circle' || kind === 'rect',
    ...(handles ? { handles } : {})
  }
}

function normalizeDirectorAnimKeyframe(raw: unknown): DirectorAnimKeyframe | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (typeof o.id !== 'string' || !o.id.trim()) return null
  if (typeof o.time !== 'number' || !Number.isFinite(o.time)) return null
  return {
    id: o.id.trim(),
    time: Math.max(0, o.time),
    position: readVec3(o.position, { x: 0, y: 0, z: 0 }),
    rotation: o.rotation != null ? readVec3(o.rotation, { x: 0, y: 0, z: 0 }) : undefined,
    scale: o.scale != null ? readVec3(o.scale, { x: 1, y: 1, z: 1 }) : undefined
  }
}

function normalizeDirectorSkeletonClipSegment(
  raw: unknown
): DirectorSkeletonClipSegment | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (typeof o.id !== 'string' || !o.id.trim()) return null
  const clip = typeof o.clip === 'string' ? o.clip.trim() : ''
  if (!clip) return null
  const start = typeof o.start === 'number' && Number.isFinite(o.start) ? Math.max(0, o.start) : 0
  const end =
    typeof o.end === 'number' && Number.isFinite(o.end) ? Math.max(start + 0.1, o.end) : start + 1
  const assetId = typeof o.assetId === 'string' ? o.assetId.trim() : ''
  const speed =
    typeof o.speed === 'number' && Number.isFinite(o.speed) && o.speed > 0 ? o.speed : undefined
  return {
    id: o.id.trim(),
    clip,
    start,
    end,
    ...(assetId ? { assetId } : {}),
    ...(speed != null ? { speed } : {}),
    ...(o.loop === false ? { loop: false } : {})
  }
}

function normalizeDirectorCameraCutSegment(raw: unknown): DirectorCameraCutSegment | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (typeof o.id !== 'string' || !o.id.trim() || typeof o.cameraId !== 'string') return null
  const start = typeof o.start === 'number' && Number.isFinite(o.start) ? Math.max(0, o.start) : 0
  const end =
    typeof o.end === 'number' && Number.isFinite(o.end) ? Math.max(start + 0.05, o.end) : start + 1
  return { id: o.id.trim(), cameraId: o.cameraId, start, end }
}

function normalizeDirectorAnimTrack(raw: unknown): DirectorAnimTrack | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (typeof o.id !== 'string' || typeof o.targetId !== 'string') return null
  const targetKind = o.targetKind === 'camera' || o.targetKind === 'object' ? o.targetKind : null
  if (!targetKind) return null
  const start = typeof o.start === 'number' && Number.isFinite(o.start) ? Math.max(0, o.start) : 0
  const end =
    typeof o.end === 'number' && Number.isFinite(o.end) ? Math.max(start + 0.1, o.end) : start + 5
  const path = normalizeDirectorAnimPath(o.path)
  let keyframes = Array.isArray(o.keyframes)
    ? o.keyframes
        .map((kf) => normalizeDirectorAnimKeyframe(kf))
        .filter((kf): kf is DirectorAnimKeyframe => !!kf)
        .sort((a, b) => a.time - b.time)
    : []
  // 旧数据仅有 path：用路径端点生成起止关键帧，便于播放与编辑
  if (keyframes.length < 2 && path && path.points.length >= 2) {
    keyframes = [
      {
        id: `kf:${o.id}:0`,
        time: start,
        position: { ...path.points[0] }
      },
      {
        id: `kf:${o.id}:1`,
        time: end,
        position: { ...path.points[path.points.length - 1] }
      }
    ]
  }

  const skeletonClips = Array.isArray(o.skeletonClips)
    ? o.skeletonClips
        .map((item) => normalizeDirectorSkeletonClipSegment(item))
        .filter((item): item is DirectorSkeletonClipSegment => !!item)
        .sort((a, b) => a.start - b.start)
    : []

  const cameraCut = o.cameraCut === true
  const cameraSegments = Array.isArray(o.cameraSegments)
    ? o.cameraSegments
        .map((item) => normalizeDirectorCameraCutSegment(item))
        .filter((item): item is DirectorCameraCutSegment => !!item)
        .sort((a, b) => a.start - b.start)
    : []

  return {
    id: o.id,
    name: typeof o.name === 'string' && o.name.trim() ? o.name.trim() : 'Track',
    targetKind,
    targetId: o.targetId,
    start,
    end,
    path,
    keyframes,
    orientToPath: o.orientToPath === true,
    pathForwardAxis: normalizeDirectorPathForwardAxis(
      o.pathForwardAxis,
      targetKind === 'camera' ? '-z' : DEFAULT_PATH_FORWARD_AXIS
    ),
    ...(skeletonClips.length ? { skeletonClips } : {}),
    ...(cameraCut ? { cameraCut: true } : {}),
    ...(cameraSegments.length ? { cameraSegments } : {})
  }
}

/** 轨迹是否具备可播放内容（关帧 / 路径 / 骨骼 clip） */
export function directorAnimTrackHasContent(track: DirectorAnimTrack): boolean {
  if ((track.keyframes?.length ?? 0) >= 1) return true
  if (track.path && track.path.points.length >= 2) return true
  if ((track.skeletonClips?.length ?? 0) > 0) return true
  if ((track.cameraSegments?.length ?? 0) > 0) return true
  return false
}

/** 轨上有效的机位切换区间列表（已按 start 排序）；缺 cameraSegments 则空 */
export function directorTrackCameraCutSegments(
  track: Pick<DirectorAnimTrack, 'cameraSegments'>
): DirectorCameraCutSegment[] {
  if (!track.cameraSegments?.length) return []
  return [...track.cameraSegments].sort((a, b) => a.start - b.start)
}

/** 轨上有效的骨骼片段列表（已按 start 排序）；缺 skeletonClips 则空 */
export function directorTrackSkeletonClips(
  track: Pick<DirectorAnimTrack, 'skeletonClips'>
): DirectorSkeletonClipSegment[] {
  if (!track.skeletonClips?.length) return []
  return [...track.skeletonClips].sort((a, b) => a.start - b.start)
}

export function readDirectorAnimation(raw: unknown): DirectorAnimationState {
  const base = createDefaultDirectorAnimation()
  if (!raw || typeof raw !== 'object') return base
  const o = raw as Record<string, unknown>
  const duration =
    typeof o.duration === 'number' && Number.isFinite(o.duration) && o.duration > 0
      ? o.duration
      : base.duration
  return {
    duration,
    loop: o.loop !== false,
    tracks: Array.isArray(o.tracks)
      ? o.tracks
          .map((track) => normalizeDirectorAnimTrack(track))
          .filter((track): track is DirectorAnimTrack => !!track)
      : []
  }
}

export const DEFAULT_GRID_DENSITY = 8
export const MIN_GRID_DENSITY = 1
export const MAX_GRID_DENSITY = 16
export const DEFAULT_GRID_OFFSET_Y = -0.8
export const DEFAULT_GRID_OPACITY = 0.2
export const DEFAULT_GRID_VISIBLE = true
/** 密度换算基准：密度 8 = 1 单位单元格（与 Unity Scene 默认网格一致） */
const GRID_CELL_REFERENCE = 8

export function clampGridDensity(density: number): number {
  if (!Number.isFinite(density)) return DEFAULT_GRID_DENSITY
  return Math.min(MAX_GRID_DENSITY, Math.max(MIN_GRID_DENSITY, Math.round(density)))
}

export function clampGridOpacity(opacity: number): number {
  if (!Number.isFinite(opacity)) return DEFAULT_GRID_OPACITY
  return Math.min(1, Math.max(0, opacity))
}

export function gridDensityToCellSize(density: number): number {
  return GRID_CELL_REFERENCE / clampGridDensity(density)
}

export function gridCellSizeToDensity(cellSize: number): number {
  if (!Number.isFinite(cellSize) || cellSize <= 0) return DEFAULT_GRID_DENSITY
  return clampGridDensity(Math.round(GRID_CELL_REFERENCE / cellSize))
}

export interface DirectorViewerState {
  position: StageVec3
  /** Three.js Euler XYZ（弧度），相机本地前方为 -Z。 */
  rotation?: StageVec3
  scale?: StageVec3
  /** 导演环视使用的注视点，独立于机位 rotation。 */
  target: StageVec3
  /** 透视视场角（度） */
  fov?: number
}

export const DEFAULT_DIRECTOR_CAMERA_FOV = 50

/** Three.js 相机本地前方 (-Z) 经 XYZ 欧拉旋转后的世界方向。 */
export function directorViewerForwardFromRotation(rotation: StageVec3): StageVec3 {
  const cx = Math.cos(rotation.x)
  const sx = Math.sin(rotation.x)
  const cy = Math.cos(rotation.y)
  const sy = Math.sin(rotation.y)
  return {
    x: -sy,
    y: sx * cy,
    z: -cx * cy
  }
}

export function directorViewerRotationFromLook(
  position: StageVec3,
  target: StageVec3
): StageVec3 {
  const dx = target.x - position.x
  const dy = target.y - position.y
  const dz = target.z - position.z
  const len = Math.hypot(dx, dy, dz)
  if (len < 1e-8) return { x: 0, y: 0, z: 0 }
  const nx = dx / len
  const ny = dy / len
  const nz = dz / len
  return {
    x: Math.asin(Math.max(-1, Math.min(1, ny))),
    y: Math.atan2(-nx, -nz),
    z: 0
  }
}

export function createDefaultDirectorViewer(): DirectorViewerState {
  return {
    position: { x: 0, y: 2.2, z: 10 },
    rotation: {
      x: (5.71 * Math.PI) / 180,
      y: Math.PI,
      z: 0
    },
    scale: { x: 1, y: 1, z: 1 },
    target: { x: 0, y: 1.2, z: 0 },
    fov: DEFAULT_DIRECTOR_CAMERA_FOV
  }
}

export function createDefaultDirectorCamera(
  id: string = DIRECTOR_CAMERA_HIERARCHY_ID,
  name = 'Camera 1'
): DirectorCameraState {
  return {
    id,
    name,
    visible: true,
    locked: false,
    viewer: createDefaultDirectorViewer()
  }
}

export function createDefaultDirectorStage(): DirectorStageState {
  const camera = createDefaultDirectorCamera()
  return {
    linkedPanoramaAssetId: null,
    transformMode: 'translate',
    selectedObjectId: null,
    cameras: [camera],
    cameraGroups: [],
    activeCameraId: camera.id,
    gridVisible: DEFAULT_GRID_VISIBLE,
    gridOpacity: DEFAULT_GRID_OPACITY,
    gridOffsetY: DEFAULT_GRID_OFFSET_Y,
    gridDensity: DEFAULT_GRID_DENSITY,
    cameraShots: [],
    cameraVideos: [],
    aspectRatio: 'auto',
    world: createDefaultDirectorSceneWorld(),
    skyColor: DEFAULT_DIRECTOR_SKY_COLOR,
    panoramaYaw: 0,
    panoramaRadius: DEFAULT_DIRECTOR_PANORAMA_RADIUS,
    animation: createDefaultDirectorAnimation(),
    objects: []
  }
}

function normalizeDirectorCamera(raw: unknown, index: number): DirectorCameraState | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const id =
    typeof o.id === 'string' && o.id.trim()
      ? o.id.trim()
      : index === 0
        ? DIRECTOR_CAMERA_HIERARCHY_ID
        : `camera:${index + 1}`
  const name =
    typeof o.name === 'string' && o.name.trim() ? o.name.trim() : `Camera ${index + 1}`
  return {
    id,
    name,
    ...(typeof o.parentId === 'string' && o.parentId.trim()
      ? { parentId: o.parentId.trim() }
      : {}),
    visible: o.visible === false ? false : true,
    locked: o.locked === true,
    viewer: readDirectorViewer(o.viewer)
  }
}

function normalizeDirectorCameraGroup(raw: unknown): DirectorCameraGroup | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const id = typeof o.id === 'string' && o.id.trim() ? o.id.trim() : ''
  if (!id) return null
  return {
    id,
    name: typeof o.name === 'string' && o.name.trim() ? o.name.trim() : '机位组',
    ...(typeof o.parentId === 'string' && o.parentId.trim()
      ? { parentId: o.parentId.trim() }
      : {})
  }
}

/** 从 cameras[] 解析机位列表与活动 id；缺省则默认单机位 */
export function resolveDirectorCameras(stage: {
  cameras?: unknown
  activeCameraId?: unknown
}): { cameras: DirectorCameraState[]; activeCameraId: string } {
  const fromArray = Array.isArray(stage.cameras)
    ? stage.cameras
        .map((item, index) => normalizeDirectorCamera(item, index))
        .filter((item): item is DirectorCameraState => !!item)
    : []
  const cameras = fromArray.length > 0 ? fromArray : [createDefaultDirectorCamera()]
  const activeCameraId =
    typeof stage.activeCameraId === 'string' &&
    cameras.some((c) => c.id === stage.activeCameraId)
      ? stage.activeCameraId
      : cameras[0].id
  return { cameras, activeCameraId }
}

export function getActiveDirectorCamera(stage: DirectorStageState): DirectorCameraState {
  const { cameras, activeCameraId } = resolveDirectorCameras(stage)
  return cameras.find((c) => c.id === activeCameraId) ?? cameras[0]
}

export function readDirectorStage(gen?: Record<string, unknown>): DirectorStageState {
  const base = createDefaultDirectorStage()
  const raw = gen?.stage
  if (!raw || typeof raw !== 'object') return base
  const s = raw as Record<string, unknown>
  const objects = Array.isArray(s.objects)
    ? s.objects
        .map((o) => normalizeStageObject(o))
        .filter((o): o is StageObjectState => !!o)
    : []
  const { cameras, activeCameraId } = resolveDirectorCameras(s)
  return {
    linkedPanoramaAssetId:
      typeof s.linkedPanoramaAssetId === 'string'
        ? s.linkedPanoramaAssetId
        : s.linkedPanoramaAssetId === null
          ? null
          : base.linkedPanoramaAssetId,
    transformMode:
      s.transformMode === 'rotate' || s.transformMode === 'scale' ? s.transformMode : 'translate',
    selectedObjectId: typeof s.selectedObjectId === 'string' ? s.selectedObjectId : null,
    cameras,
    activeCameraId,
    cameraGroups: Array.isArray(s.cameraGroups)
      ? s.cameraGroups
          .map((g) => normalizeDirectorCameraGroup(g))
          .filter((g): g is DirectorCameraGroup => !!g)
      : [],
    gridVisible: s.gridVisible === false ? false : true,
    gridOpacity:
      typeof s.gridOpacity === 'number' ? clampGridOpacity(s.gridOpacity) : base.gridOpacity,
    gridOffsetY: typeof s.gridOffsetY === 'number' ? s.gridOffsetY : base.gridOffsetY,
    gridDensity:
      typeof s.gridDensity === 'number'
        ? clampGridDensity(s.gridDensity)
        : typeof s.gridCellSize === 'number'
          ? gridCellSizeToDensity(s.gridCellSize)
          : base.gridDensity,
    cameraShots: Array.isArray(s.cameraShots)
      ? s.cameraShots
          .map((shot) => normalizeCameraShot(shot))
          .filter((shot): shot is DirectorCameraShot => !!shot)
      : [],
    cameraVideos: Array.isArray(s.cameraVideos)
      ? s.cameraVideos
          .map((video) => normalizeCameraVideo(video))
          .filter((video): video is DirectorCameraVideo => !!video)
      : [],
    aspectRatio: normalizeDirectorAspectRatio(s.aspectRatio),
    world: readDirectorSceneWorld(s.world),
    skyColor: normalizeDirectorSkyColor(s.skyColor),
    panoramaYaw: typeof s.panoramaYaw === 'number' && Number.isFinite(s.panoramaYaw) ? s.panoramaYaw : 0,
    panoramaRadius: clampDirectorPanoramaRadius(
      typeof s.panoramaRadius === 'number' ? s.panoramaRadius : DEFAULT_DIRECTOR_PANORAMA_RADIUS
    ),
    animation: readDirectorAnimation(s.animation),
    ownerProcessingNodeId:
      typeof s.ownerProcessingNodeId === 'string'
        ? s.ownerProcessingNodeId
        : s.ownerProcessingNodeId === null
          ? null
          : base.ownerProcessingNodeId,
    objects
  }
}

function normalizeCameraShot(raw: unknown): DirectorCameraShot | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (typeof o.id !== 'string' || !o.id.trim()) return null
  const dataUrl = typeof o.dataUrl === 'string' ? o.dataUrl : ''
  const relativePath =
    typeof o.relativePath === 'string' && o.relativePath.trim()
      ? o.relativePath.trim()
      : undefined
  if (!dataUrl && !relativePath) return null
  return {
    id: o.id.trim(),
    dataUrl,
    createdAt: typeof o.createdAt === 'string' ? o.createdAt : new Date().toISOString(),
    ...(relativePath ? { relativePath } : {})
  }
}

function normalizeCameraVideo(raw: unknown): DirectorCameraVideo | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (typeof o.id !== 'string' || !o.id.trim()) return null
  const dataUrl = typeof o.dataUrl === 'string' && o.dataUrl.trim() ? o.dataUrl : undefined
  const relativePath =
    typeof o.relativePath === 'string' && o.relativePath.trim()
      ? o.relativePath.trim()
      : undefined
  if (!dataUrl && !relativePath) return null
  return {
    id: o.id.trim(),
    createdAt: typeof o.createdAt === 'string' ? o.createdAt : new Date().toISOString(),
    ...(dataUrl ? { dataUrl } : {}),
    ...(relativePath ? { relativePath } : {})
  }
}

function readDirectorViewer(raw: unknown): DirectorViewerState {
  const base = createDefaultDirectorViewer()
  if (!raw || typeof raw !== 'object') return base
  const v = raw as Record<string, unknown>
  const position = readVec3(v.position, base.position)
  const target = readVec3(v.target, base.target)
  const hasRotation = !!v.rotation && typeof v.rotation === 'object'
  const rotation = hasRotation
    ? readVec3(v.rotation, base.rotation ?? { x: 0, y: 0, z: 0 })
    : directorViewerRotationFromLook(position, target)
  return {
    position,
    rotation,
    scale: readVec3(v.scale, base.scale ?? { x: 1, y: 1, z: 1 }),
    target,
    fov: typeof v.fov === 'number' ? v.fov : base.fov
  }
}

function readVec3(v: unknown, fallback: StageVec3): StageVec3 {
  if (!v || typeof v !== 'object') return fallback
  const o = v as Record<string, unknown>
  return {
    x: typeof o.x === 'number' ? o.x : fallback.x,
    y: typeof o.y === 'number' ? o.y : fallback.y,
    z: typeof o.z === 'number' ? o.z : fallback.z
  }
}

function normalizeStageObject(raw: unknown): StageObjectState | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (typeof o.id !== 'string' || typeof o.name !== 'string') return null
  const kind = o.kind as StageObjectKind
  if (
    kind !== 'character' &&
    kind !== 'prop' &&
    kind !== 'model' &&
    kind !== 'primitive' &&
    kind !== 'empty'
  ) {
    return null
  }
  const parentId =
    typeof o.parentId === 'string' && o.parentId.trim() ? o.parentId : null
  return {
    id: o.id,
    name: o.name,
    kind,
    primitive:
      o.primitive === 'box' ||
      o.primitive === 'capsule' ||
      o.primitive === 'cylinder' ||
      o.primitive === 'sphere' ||
      o.primitive === 'plane' ||
      o.primitive === 'quad'
        ? o.primitive
        : undefined,
    modelAssetId: typeof o.modelAssetId === 'string' ? o.modelAssetId : undefined,
    color: typeof o.color === 'string' ? o.color : undefined,
    parentId,
    visible: o.visible === false ? false : true,
    locked: o.locked === true,
    nameVisible:
      o.nameVisible === false ? false : o.nameVisible === true ? true : kind !== 'empty',
    position: readVec3(o.position, { x: 0, y: 0, z: 0 }),
    rotation: readVec3(o.rotation, { x: 0, y: 0, z: 0 }),
    scale: readVec3(o.scale, { x: 1, y: 1, z: 1 }),
    bonePose: readBonePose(o.bonePose),
    posePresets: readPosePresets(o.posePresets),
    ikChains: readIkChains(o.ikChains)
  }
}

function readBonePose(raw: unknown): Record<string, StageVec3> | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const out: Record<string, StageVec3> = {}
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    const key = name.trim()
    if (!key || !value || typeof value !== 'object') continue
    const v = value as Record<string, unknown>
    const x = typeof v.x === 'number' && Number.isFinite(v.x) ? v.x : 0
    const y = typeof v.y === 'number' && Number.isFinite(v.y) ? v.y : 0
    const z = typeof v.z === 'number' && Number.isFinite(v.z) ? v.z : 0
    if (x === 0 && y === 0 && z === 0) continue
    out[key] = { x, y, z }
  }
  return Object.keys(out).length ? out : undefined
}

function readPosePresets(raw: unknown): DirectorPosePreset[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const out: DirectorPosePreset[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const id = typeof o.id === 'string' && o.id.trim() ? o.id.trim() : ''
    const name = typeof o.name === 'string' && o.name.trim() ? o.name.trim() : ''
    if (!id || !name) continue
    const bones = readBonePose(o.bones) ?? {}
    out.push({ id, name, bones })
  }
  return out.length ? out : undefined
}

const IK_CHAIN_SLOT_IDS = new Set<DirectorIkChainSlotId>(['slot1', 'slot2', 'slot3', 'slot4'])

function readIkChains(raw: unknown): DirectorIkChainSpec[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const out: DirectorIkChainSpec[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const id = typeof o.id === 'string' ? o.id.trim() : ''
    if (!IK_CHAIN_SLOT_IDS.has(id as DirectorIkChainSlotId) || seen.has(id)) continue
    const effector = typeof o.effector === 'string' ? o.effector.trim() : ''
    if (!effector) continue
    let links: string[] | undefined
    if (Array.isArray(o.links)) {
      links = o.links
        .map((v) => (typeof v === 'string' ? v.trim() : ''))
        .filter(Boolean)
      if (!links.length) links = undefined
    }
    seen.add(id)
    out.push({ id: id as DirectorIkChainSlotId, effector, links })
  }
  return out.length ? out : undefined
}

/** 剧本资产：新建为节点图编辑；导入 txt 为引用文件（记事本） */
export function isScreenplayAsset(type: AssetType | string): boolean {
  return normalizeAssetType(type) === 'screenplay'
}

/** 新建资产未显式命名时的默认显示名（随 language；默认 zh-CN） */
export function defaultAssetName(type: AssetType, language?: string | null): string {
  const en = isEnglishLanguage(language)
  const label = assetTypeLabel(type, language)
  switch (type) {
    case 'screenplay':
      return en ? 'New Screenplay' : '新建剧本'
    case 'gameSystem':
      return en ? 'New Game System Plan' : '新建游戏系统策划案'
    case 'canvas':
      return en ? 'New Series' : '新建剧集'
    case 'world':
      return en ? 'New World Elements' : '新建世界元素'
    case 'beat':
      return en ? 'New Beat Units' : '新建场'
    case 'motion':
      return en ? DEFAULT_DIRECTOR_DECK_NAME : DEFAULT_DIRECTOR_DECK_NAME_ZH
    case 'subgraph':
      return en ? 'New Host Asset' : '新建宿主资产'
    default:
      return en ? (label ? `New ${label}` : 'New Asset') : label ? `新建${label}` : '新建资产'
  }
}

/** If baseName is taken, append an incrementing number (e.g. New Panorama → New Panorama 2) */
export function resolveUniqueAssetName(baseName: string, existingNames: readonly string[]): string {
  const taken = new Set(existingNames.map((n) => n.trim()).filter(Boolean))
  const base = baseName.trim() || 'Untitled'
  if (!taken.has(base)) return base

  const numbered = base.match(/^(.*?)(\s+)(\d+)$/)
  const stem = numbered ? numbered[1].trimEnd() : base

  let maxNum = taken.has(stem) ? 1 : 0
  const escaped = stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`^${escaped}(?:\\s+(\\d+))?$`)

  for (const name of taken) {
    const m = name.match(re)
    if (!m) continue
    const n = m[1] ? Number.parseInt(m[1], 10) : 1
    if (Number.isFinite(n)) maxNum = Math.max(maxNum, n)
  }

  return `${stem} ${maxNum + 1}`
}

export const DEFAULT_SETTINGS: AppSettings = {
  language: 'zh-CN',
  theme: 'dark',
  defaultProjectPath: '',
  editor: {
    autoSaveEnabled: false,
    autoSaveIntervalSec: 30
  },
  models: createEmptyModelsSettings(),
  objectStorage: createEmptyObjectStorageSettings(),
  seedance: {
    endpoint: '',
    apiKey: '',
    model: 'seedance-1.0',
    useMock: false
  },
  llm: {
    endpoint: '',
    apiKey: '',
    model: 'gpt-4o-mini'
  }
}

