/**
 * Semantic Timeline 一等节点定义（注册进 builtins）。
 * 样式与双击对齐视频工具节点：`card: 'media'` + ASSET 尺寸，勿用 note 卡（会走记事本）。
 */
import { GraphPortType } from './types'
import type { NodeTypeDefinition } from './registry'
import {
  executeSemanticAnalyzeNode,
  executeSemanticCompileNode,
  executeSemanticRepairNode,
  executeSemanticTriggerNode,
  executeSemanticVariantNode
} from './execute/semanticTimeline'

/** 与 builtins 视频工具节点同尺寸 */
const ASSET_SIZE = { w: 168, h: 128 }
const ASSET_LIMITS = { minW: 120, minH: 72, maxW: 480, maxH: 400 }

const textOut = {
  id: 'out',
  direction: 'out' as const,
  dataType: GraphPortType.text,
  multiple: false,
  label: 'Out'
}

export const SEMANTIC_TIMELINE_NODE_TYPES: NodeTypeDefinition[] = [
  {
    typeId: 'video.semanticAnalyze',
    category: 'note',
    label: 'Semantic analyze',
    icon: '🧭',
    defaultTitle: 'Semantic analyze',
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
      textOut
    ],
    defaultParams: () => ({
      sourceAssetId: '',
      vocabulary: 'commerce.v1',
      semanticTranscribe: true,
      semanticSeparateAudio: true,
      semanticDetectEntities: true,
      semanticLlm: false,
      semanticFps: 30,
      semanticDuration: 60,
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
    typeId: 'semantic.timeline',
    category: 'note',
    label: 'Semantic timeline',
    icon: '🧭',
    defaultTitle: 'Semantic timeline',
    defaultSize: { ...ASSET_SIZE },
    sizeLimits: { ...ASSET_LIMITS },
    ports: [
      {
        id: 'in',
        direction: 'in',
        dataType: GraphPortType.text,
        multiple: false,
        label: 'Timeline JSON'
      },
      textOut
    ],
    defaultParams: () => ({ timelineJson: '' }),
    addable: true,
    deletable: true,
    inspector: 'none',
    inspectorId: 'studio.graph.semanticTimeline',
    card: 'media',
    contributeToGeneration: false,
    execute: async (ctx) => {
      const upstream = ctx.inputs.in?.[0]
      const text =
        upstream && upstream.kind === 'text'
          ? upstream.text
          : String(ctx.node.params?.timelineJson || '')
      return { out: { kind: 'text', text } }
    }
  },
  {
    typeId: 'semantic.trigger',
    category: 'note',
    label: 'Semantic trigger',
    icon: '⚡',
    defaultTitle: 'Semantic trigger',
    defaultSize: { ...ASSET_SIZE },
    sizeLimits: { ...ASSET_LIMITS },
    ports: [
      {
        id: 'in',
        direction: 'in',
        dataType: GraphPortType.text,
        multiple: false,
        label: 'Timeline'
      },
      textOut
    ],
    defaultParams: () => ({ timelineJson: '', eventLabel: '', rulePackIds: '' }),
    addable: true,
    deletable: true,
    inspector: 'none',
    inspectorId: 'studio.graph.semanticTrigger',
    card: 'media',
    contributeToGeneration: false,
    execute: executeSemanticTriggerNode
  },
  {
    typeId: 'semantic.compile',
    category: 'note',
    label: 'Director compile',
    icon: '🎬',
    defaultTitle: 'Director compile',
    defaultSize: { ...ASSET_SIZE },
    sizeLimits: { ...ASSET_LIMITS },
    ports: [
      {
        id: 'in',
        direction: 'in',
        dataType: GraphPortType.text,
        multiple: false,
        label: 'Timeline'
      },
      textOut
    ],
    defaultParams: () => ({ timelineJson: '', sourceRelativePath: '', rulePackIds: '' }),
    addable: true,
    deletable: true,
    inspector: 'none',
    inspectorId: 'studio.graph.semanticCompile',
    card: 'media',
    contributeToGeneration: false,
    execute: executeSemanticCompileNode
  },
  {
    typeId: 'video.repair',
    category: 'note',
    label: 'Video repair',
    icon: '🔧',
    defaultTitle: 'Video repair',
    defaultSize: { ...ASSET_SIZE },
    sizeLimits: { ...ASSET_LIMITS },
    ports: [
      {
        id: 'in',
        direction: 'in',
        dataType: GraphPortType.text,
        multiple: false,
        label: 'Timeline'
      },
      textOut,
      {
        id: 'out-video',
        direction: 'out',
        dataType: GraphPortType.video,
        multiple: false,
        label: 'Video'
      }
    ],
    defaultParams: () => ({
      timelineJson: '',
      editsJson: '[]',
      shotsJson: '',
      sourceRelativePath: '',
      semanticExecute: true
    }),
    addable: true,
    deletable: true,
    inspector: 'none',
    inspectorId: 'studio.graph.videoRepair',
    card: 'media',
    contributeToGeneration: false,
    execute: executeSemanticRepairNode
  },
  {
    typeId: 'video.variant',
    category: 'note',
    label: 'Video variant',
    icon: '🧬',
    defaultTitle: 'Video variant',
    defaultSize: { ...ASSET_SIZE },
    sizeLimits: { ...ASSET_LIMITS },
    ports: [
      {
        id: 'in',
        direction: 'in',
        dataType: GraphPortType.text,
        multiple: false,
        label: 'Timeline'
      },
      textOut,
      {
        id: 'out-videos',
        direction: 'out',
        dataType: GraphPortType.videos,
        multiple: false,
        label: 'Videos'
      }
    ],
    defaultParams: () => ({
      timelineJson: '',
      editsJson: '[]',
      shotsJson: '',
      recipeId: '',
      recipeSlotsJson: '',
      sourceRelativePath: '',
      semanticExecute: true
    }),
    addable: true,
    deletable: true,
    inspector: 'none',
    inspectorId: 'studio.graph.videoVariant',
    card: 'media',
    contributeToGeneration: false,
    execute: executeSemanticVariantNode
  }
]
