/**
 * Semantic Timeline 一等节点定义（注册进 builtins）。
 * 两节点直连管线：`semantic.analyze`（视频拆解） → `semantic.rebuild`（视频重制）。
 * 样式与双击对齐视频工具节点：`card: 'media'` + ASSET 尺寸，勿用 note 卡（会走记事本）。
 */
import { GraphPortType } from './types'
import type { NodeTypeDefinition } from './registry'
import { executeSemanticAnalyzeNode, executeSemanticRebuildNode } from './execute/semanticTimeline'

/** 语义拆解 / 视频重制节点的参考图入口（`@图片1..k` 主体参考与局部替换候选来源） */
export const SEMANTIC_REFERENCE_IMAGES_PORT_ID = 'in-images'

/** 与 builtins 视频工具节点同尺寸 */
const ASSET_SIZE = { w: 168, h: 128 }
const ASSET_LIMITS = { minW: 120, minH: 72, maxW: 480, maxH: 400 }

/**
 * 语义时间线文档口（`SemanticTimeline`，schema `aiart.semantic-timeline@1`）。
 * `semantic.analyze` 产出整份四轴拆解与复刻规划文档，`semantic.rebuild` 直接消费它执行多路径分流复刻。
 */
const timelineIn = {
  id: 'in',
  direction: 'in' as const,
  dataType: GraphPortType.semanticTimeline,
  multiple: false,
  label: 'Timeline'
}

const timelineOut = {
  id: 'out',
  direction: 'out' as const,
  dataType: GraphPortType.semanticTimeline,
  multiple: false,
  label: 'Timeline'
}

const referenceImagesIn = {
  id: SEMANTIC_REFERENCE_IMAGES_PORT_ID,
  direction: 'in' as const,
  dataType: GraphPortType.image,
  multiple: true,
  label: 'Reference images'
}

const videoOut = {
  id: 'out-video',
  direction: 'out' as const,
  dataType: GraphPortType.video,
  multiple: false,
  label: 'Video'
}

export const SEMANTIC_TIMELINE_NODE_TYPES: NodeTypeDefinition[] = [
  {
    typeId: 'semantic.analyze',
    category: 'note',
    label: 'Video breakdown',
    icon: '🧭',
    defaultTitle: 'Video breakdown',
    defaultSize: { ...ASSET_SIZE },
    sizeLimits: { ...ASSET_LIMITS },
    ports: [
      {
        id: 'in-video',
        direction: 'in',
        dataType: GraphPortType.video,
        multiple: false,
        label: 'Video'
      },
      referenceImagesIn,
      timelineOut
    ],
    defaultParams: () => ({
      sourceAssetId: '',
      semanticTranscribe: true,
      semanticSeparateAudio: true,
      semanticDetectEntities: true,
      semanticLlm: true,
      semanticFps: 30,
      semanticDuration: 60,
      generateModel: '',
      generateProviderInstanceId: '',
      transcribeModel: '',
      transcribeProviderInstanceId: '',
      shotsJson: '',
      utterancesJson: '',
      previewCollapsed: false
    }),
    addable: true,
    deletable: true,
    inspector: 'none',
    inspectorId: 'studio.graph.semanticAnalyze',
    card: 'media',
    contributeToGeneration: false,
    execute: executeSemanticAnalyzeNode
  },
  {
    typeId: 'semantic.rebuild',
    category: 'note',
    label: 'Video remake',
    icon: '🎞️',
    defaultTitle: 'Video remake',
    defaultSize: { ...ASSET_SIZE },
    sizeLimits: { ...ASSET_LIMITS },
    ports: [timelineIn, referenceImagesIn, videoOut],
    defaultParams: () => ({
      remakeStrategy: 'edit',
      rebuildGenerateAnchors: false,
      rebuildCleanOverlays: true,
      rebuildUseCache: true,
      rebuildUnitCacheJson: '',
      rebuildOnlyShotIds: '',
      generateModel: '',
      generateProviderInstanceId: '',
      generateInstruction: '',
      generateResolution: '',
      generateAspectRatio: '',
      rebuildDurationSec: 0,
      rebuildMaxShots: 24,
      rebuildRenderCompare: true,
      rebuildKeepAudio: true,
      rebuildBurnSubtitles: true,
      rebuildDub: true,
      rebuildDubClone: true,
      dubModel: '',
      dubProviderInstanceId: '',
      dubVoice: '',
      replaceImageModel: '',
      replaceImageProviderInstanceId: '',
      rebuildVariantsJson: '',
      semanticExecute: true
    }),
    addable: true,
    deletable: true,
    inspector: 'none',
    inspectorId: 'studio.graph.semanticRebuild',
    card: 'media',
    contributeToGeneration: true,
    execute: executeSemanticRebuildNode
  }
]
