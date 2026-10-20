import {
  AUDIO_FILE_EXTENSIONS,
  DELIVERABLE_FILE_EXTENSIONS,
  HTML_FILE_EXTENSIONS,
  IMAGE_FILE_EXTENSIONS,
  MODEL_FILE_EXTENSIONS,
  VIDEO_FILE_EXTENSIONS
} from '@shared/mediaFileExtensions'
import { SPLAT_EXTENSIONS } from '../director/splatMesh'

/**
 * 对话产物卡按什么渲染。
 *
 * 泼溅（`.ply` / `.spz`）**必须归 `model`**：`ModelPreview` 已经能把它们交给 Spark
 * 渲染（`loadModelScene` 内部按 `isSplatPath` 分流），但预览类型原先只按
 * `['glb', 'gltf']` 判断 —— 于是泼溅落成 `file`，对话里只显示一行路径文本，
 * 明明能预览却什么都不显示。
 *
 * 扩展名清单统一从 `@shared/mediaFileExtensions` 取（单一来源）。
 */
export type ChatPreviewKind =
  'image' | 'video' | 'audio' | 'model' | 'html' | 'deliverable' | 'file'

const IMAGE_EXTS = new Set<string>(IMAGE_FILE_EXTENSIONS)
const VIDEO_EXTS = new Set<string>(VIDEO_FILE_EXTENSIONS)
const AUDIO_EXTS = new Set<string>(AUDIO_FILE_EXTENSIONS)
const MODEL_EXTS = new Set<string>(MODEL_FILE_EXTENSIONS)
const HTML_EXTS = new Set<string>(HTML_FILE_EXTENSIONS)
const DELIVERABLE_EXTS = new Set<string>(DELIVERABLE_FILE_EXTENSIONS)

function extensionOf(relativePath: string): string {
  const name = (relativePath ?? '').split(/[?#]/)[0] ?? ''
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : ''
}

/** 是否高斯泼溅产物（`ModelPreview` 会交给 Spark 渲染） */
export function isSplatPreviewPath(relativePath: string): boolean {
  const ext = extensionOf(relativePath)
  return SPLAT_EXTENSIONS.some((splatExt) => splatExt.slice(1) === ext)
}

/** 按文件扩展名推断预览类型；未知类型降级为纯文本路径 */
export function chatPreviewKind(relativePath: string): ChatPreviewKind {
  const ext = extensionOf(relativePath)
  if (IMAGE_EXTS.has(ext)) return 'image'
  if (VIDEO_EXTS.has(ext)) return 'video'
  if (AUDIO_EXTS.has(ext)) return 'audio'
  if (MODEL_EXTS.has(ext)) return 'model'
  if (HTML_EXTS.has(ext)) return 'html'
  if (DELIVERABLE_EXTS.has(ext)) return 'deliverable'
  return 'file'
}

export interface DeliverableBadgeMeta {
  ext: string
  code: string
  icon: string
  labelZh: string
  labelEn: string
  descZh: string
  descEn: string
}

/** 专业交付物元信息（供 ChatAssetPreview 渲染高颜值交付物英雄卡） */
export function deliverableFormatBadge(relativePath: string): DeliverableBadgeMeta {
  const ext = extensionOf(relativePath)
  switch (ext) {
    case 'psd':
      return {
        ext,
        code: 'PSD',
        icon: '🗂️',
        labelZh: 'Photoshop 分层源文件 (.psd)',
        labelEn: 'Photoshop Layered Source (.psd)',
        descZh: '含完整透明图层树、坐标尺寸与游戏 UI 自动分组文件夹',
        descEn: 'Includes full transparent layer hierarchy, bounds & game UI folder groups'
      }
    case 'prefab':
      return {
        ext,
        code: 'UNITY',
        icon: '🎮',
        labelZh: 'Unity UGUI 预制体 (.prefab)',
        labelEn: 'Unity UGUI Prefab (.prefab)',
        descZh: '含 RectTransform 锚点、九宫格切片与 Button 交互组件',
        descEn: 'Includes RectTransform anchors, 9-slice borders & Button components'
      }
    case 'tscn':
      return {
        ext,
        code: 'GODOT',
        icon: '🤖',
        labelZh: 'Godot 4 界面场景 (.tscn)',
        labelEn: 'Godot 4 UI Scene (.tscn)',
        descZh: '含 Control 根节点、NinePatchRect 与 TextureButton 节点树',
        descEn: 'Includes Control root, NinePatchRect & TextureButton hierarchy'
      }
    case 'fcpxml':
      return {
        ext,
        code: 'FCPXML',
        icon: '🎬',
        labelZh: 'Final Cut / 达芬奇时间轴 (.fcpxml)',
        labelEn: 'FCPXML Timeline Project (.fcpxml)',
        descZh: '多轨视频、配音、音效与字幕非编工程',
        descEn: 'Multi-track video, voiceover, SFX & subtitle NLE timeline'
      }
    case 'otio':
      return {
        ext,
        code: 'OTIO',
        icon: '🎞️',
        labelZh: 'OpenTimelineIO 工程 (.otio)',
        labelEn: 'OpenTimelineIO Project (.otio)',
        descZh: '工业级通用非编时间轴交换格式',
        descEn: 'Industry-standard NLE timeline interchange format'
      }
    default:
      return {
        ext: ext || 'pkg',
        code: (ext || 'PKG').toUpperCase(),
        icon: '📦',
        labelZh: '工程交付包',
        labelEn: 'Deliverable Bundle',
        descZh: '可直接导入外部生产工具使用',
        descEn: 'Ready to import into external production tools'
      }
  }
}

/**
 * 产物卡左上角类型徽标用的 **`AssetType`**（交给 `assetTypeLabel()` 转文案）。
 */
export function chatPreviewAssetType(relativePath: string): string | null {
  const kind = chatPreviewKind(relativePath)
  if (kind === 'file' || kind === 'deliverable') return null
  if (kind === 'model' && isSplatPreviewPath(relativePath)) return 'splat'
  // 预览 kind 叫 audio，资产域类型是 voice（i18n：asset.type.voice =「声音」）
  if (kind === 'audio') return 'voice'
  if (kind === 'html') return 'gamePlay'
  return kind
}
