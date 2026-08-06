import type { AssetType } from '../domain'

/** 与 domain.VIDEO_ASSET_ICON 同值；勿从 domain 导入（domain→graph→builtins 循环会 TDZ） */
const VIDEO_ASSET_ICON = 'video-file'
import {
  bindEnsureBuiltinNodeTypes,
  builtinRegistrationState
} from './builtinState'
import { registerNodeType, type NodeTypeDefinition } from './registry'
import {
  GRAPH_OUTPUT_NODE_IDS,
  GRAPH_BEAT_SPLIT_NODE_ID,
  GRAPH_BEAT_TABLE_NODE_ID,
  GRAPH_BEAT_GEN_NODE_ID,
  GRAPH_WORLD_GEN_NODE_ID,
  GRAPH_WORLD_EXTRACT_NODE_ID,
  GRAPH_WORLD_TABLE_NODE_ID,
  graphOutputNodeId,
  GraphPortType,
  toPluralGraphPortDataType,
  toSingularGraphPortDataType,
  type GraphOutputKind,
  type GraphPortDataType,
  type GraphPortDef
} from './types'
import type { NodeExecuteContext } from './execute/types'
import {
  executeAssetNode,
  executeCamera3dNode,
  executeMotionAssetRefNode,
  executeNoteNode,
  executeOutputNode,
  executePlayScriptNode,
  executeHostInputSlotNode,
  executeBoundaryInputNode,
  executeBoundaryOutputNode,
  executeImageToPromptNode,
  executePromptOptimizeNode,
  executeScreenplayGenerateNode,
  executeSelectImageNode,
  executeSelectVideoNode,
  executeSelectVoiceNode,
  executeSelectTextNode,
  executeSelectBeatNode,
  executeMultiAngleNode,
  executeLightingNode,
  executePortraitTextureNode,
  executeEmotionNode,
  executeUpscaleNode,
  executeLipSyncNode,
  executeExpandNode,
  executeRedrawNode,
  executeEraseNode,
  executeMatteNode,
  executeCropNode,
  executeGridSplitNode,
  executeBeatSplitNode,
  executeBeatTableNode,
  executeBeatGenNode,
  executeBeatUnitGenNode,
  executeBeatUnitRefNode,
  executeEpisodeAnchorSelectNode,
  executeEpisodeCellSelectNode,
  executeWorldGenNode,
  executeWorldEntitiesOutputNode,
  executeBeatCatalogOutputNode,
  executeTimelineOutputNode,
  executeWorldExtractNode,
  executeWorldTableNode
} from './execute/values'
import {
  ASSET_DIRECTOR_OUTPUT_TITLE,
  ASSET_BEAT_OUTPUT_TITLE,
  ASSET_TIMELINE_OUTPUT_TITLE,
  ASSET_WORLD_OUTPUT_TITLE,
  BEAT_UNIT_OUTPUT_TITLE
} from './scopes'
import { defaultBeatUnitGenParams } from './beatParams'
import { isAssetRefNode } from './nodeRole'

const ASSET_SIZE = { w: 168, h: 128 }
const OUTPUT_SIZE = { w: 184, h: 140 }
const NOTE_SIZE = { w: 220, h: 120 }

const ASSET_LIMITS = { minW: 120, minH: 72, maxW: 480, maxH: 400 }
const OUTPUT_LIMITS = { minW: 140, minH: 96, maxW: 400, maxH: 320 }
const NOTE_LIMITS = { minW: 160, minH: 80, maxW: 520, maxH: 420 }

const ASSET_META: Array<{
  type: AssetType
  label: string
  icon: string
  /** 输出端口类型 */
  outType: GraphPortDataType
  addable: boolean
  weight: number
  /** 单输入口（加工节点）；motion 使用多输入，不走此字段 */
  processingIn?: GraphPortDataType
}> = [
  {
    type: 'image',
    label: 'Image',
    icon: '🖼️',
    // 引用节点输出仍为单图；加工节点输出口在 resolveTypeDefPorts 中改为 images
    outType: GraphPortType.image,
    addable: true,
    weight: 0.85
    // 输入口见 imageProcessingPorts：text / image
  },
  {
    type: 'canvas',
    label: 'Canvas',
    icon: '📺',
    outType: GraphPortType.image,
    addable: false,
    weight: 0.7
  },
  {
    type: 'world',
    label: 'World Elements',
    icon: '🤺',
    outType: GraphPortType.worldEntities,
    addable: false,
    weight: 0.7,
    processingIn: GraphPortType.text
  },
  {
    type: 'beat',
    label: 'Beat Units',
    icon: '📖',
    outType: GraphPortType.text,
    addable: false,
    weight: 0.7,
    processingIn: GraphPortType.text
  },
  {
    type: 'video',
    label: 'Video',
    icon: VIDEO_ASSET_ICON,
    outType: GraphPortType.video,
    addable: true,
    weight: 0.85
    // 输入口见 videoProcessingPorts：text / image / video / audio
  },
  {
    type: 'voice',
    label: 'Audio',
    icon: '🔊',
    outType: GraphPortType.voice,
    addable: true,
    weight: 0.85
    // 输入口见 voiceProcessingPorts：text / image
  },
  {
    type: 'motion',
    label: 'Director Deck',
    icon: '🎬',
    outType: GraphPortType.image,
    addable: true,
    weight: 0.85
  },
  {
    type: 'model',
    label: 'Model',
    icon: '🧩',
    outType: GraphPortType.model,
    addable: false,
    weight: 0.85
  },
  {
    type: 'screenplay',
    label: 'Screenplay',
    icon: '📜',
    outType: GraphPortType.text,
    addable: true,
    weight: 0.85,
    processingIn: GraphPortType.text
  },
  {
    type: 'subgraph',
    label: 'Host Asset',
    icon: '📦',
    outType: GraphPortType.text,
    addable: false,
    weight: 0.7,
    processingIn: GraphPortType.text
  }
]

/** 导演台编辑：站位（images）与动作（videos），均为方形复数口 */
function motionProcessingPorts(): GraphPortDef[] {
  return [
    {
      id: 'out-shots',
      direction: 'out',
      dataType: GraphPortType.images,
      multiple: true,
      label: '站位'
    },
    {
      id: 'out-actions',
      direction: 'out',
      dataType: GraphPortType.videos,
      multiple: true,
      label: '动作'
    }
  ]
}

/** 生成/加工图库节点：`out` 当前选中单条（默认连线）；`out-all` 全部历史（复数类型，仅连 select） */
function galleryOutPorts(dataType: GraphPortDataType): GraphPortDef[] {
  const singular = toSingularGraphPortDataType(dataType)
  const plural = toPluralGraphPortDataType(singular)
  return [
    { id: 'out', direction: 'out', dataType: singular, multiple: false, label: 'Selected' },
    { id: 'out-all', direction: 'out', dataType: plural, multiple: true, label: 'All' }
  ]
}

/** 图片生成：可接文本提示 / 图片参考 */
function imageProcessingPorts(): GraphPortDef[] {
  return [
    { id: 'in-text', direction: 'in', dataType: GraphPortType.text, multiple: true, label: 'Text' },
    { id: 'in-image', direction: 'in', dataType: GraphPortType.image, multiple: true, label: 'Image' },
    ...galleryOutPorts(GraphPortType.image)
  ]
}

/** 视频生成：可接文本 / 图片 / 视频 / 音频参考 */
function videoProcessingPorts(): GraphPortDef[] {
  return [
    { id: 'in-text', direction: 'in', dataType: GraphPortType.text, multiple: true, label: 'Text' },
    { id: 'in-image', direction: 'in', dataType: GraphPortType.image, multiple: true, label: 'Image' },
    { id: 'in-video', direction: 'in', dataType: GraphPortType.video, multiple: true, label: 'Video' },
    { id: 'in-voice', direction: 'in', dataType: GraphPortType.voice, multiple: true, label: 'Audio' },
    ...galleryOutPorts(GraphPortType.video)
  ]
}

/** 音频 / 声音设计：可接文本描述 / 图片提示（openspeech voice_design） */
function voiceProcessingPorts(): GraphPortDef[] {
  return [
    { id: 'in-text', direction: 'in', dataType: GraphPortType.text, multiple: true, label: 'Text' },
    { id: 'in-image', direction: 'in', dataType: GraphPortType.image, multiple: true, label: 'Image' },
    ...galleryOutPorts(GraphPortType.voice)
  ]
}

/** 世界元素宿主：剧本文本入；出口为世界元素实体 */
function worldHostPorts(): GraphPortDef[] {
  return [
    { id: 'in', direction: 'in', dataType: GraphPortType.text, multiple: true, label: 'In' },
    {
      id: 'out',
      direction: 'out',
      dataType: GraphPortType.worldEntities,
      multiple: true,
      label: 'Out'
    }
  ]
}

/** 场宿主：剧本文本入；出口为场目录 */
function beatHostPorts(): GraphPortDef[] {
  return [
    { id: 'in', direction: 'in', dataType: GraphPortType.text, multiple: true, label: 'In' },
    {
      id: 'out',
      direction: 'out',
      dataType: GraphPortType.beat,
      multiple: true,
      label: 'Out'
    }
  ]
}

function assetDef(meta: (typeof ASSET_META)[number]): NodeTypeDefinition {
  // subgraph 宿主端口由 getNodePorts → hostInterface 动态提供；typeDef 仅作加工/回退
  const ports: GraphPortDef[] =
    meta.type === 'subgraph'
      ? [
          {
            id: 'in',
            direction: 'in',
            dataType: GraphPortType.text,
            multiple: true,
            label: 'In'
          },
          {
            id: 'out',
            direction: 'out',
            dataType: GraphPortType.text,
            multiple: false,
            label: 'Out'
          }
        ]
      : meta.type === 'motion'
        ? motionProcessingPorts()
        : meta.type === 'image'
          ? imageProcessingPorts()
          : meta.type === 'video'
            ? videoProcessingPorts()
            : meta.type === 'voice'
              ? voiceProcessingPorts()
              : meta.type === 'world'
                ? worldHostPorts()
                : meta.type === 'beat'
                  ? beatHostPorts()
                  : [
                      ...(meta.processingIn
                        ? [
                            {
                                id: 'in',
                                direction: 'in' as const,
                                dataType: meta.processingIn,
                                multiple: true,
                                label: 'In'
                              }
                            ]
                          : []),
                        ...galleryOutPorts(meta.outType)
                      ]

  const defaultViewer = {
    position: { x: 0, y: 2.2, z: 10 },
    rotation: { x: (5.71 * Math.PI) / 180, y: Math.PI, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    target: { x: 0, y: 1.2, z: 0 },
    fov: 50
  }
  return {
    typeId: `asset.${meta.type}`,
    category: 'asset',
    label: `${meta.label} node`,
    icon: meta.icon,
    defaultTitle: meta.label,
    defaultSize: { ...ASSET_SIZE },
    sizeLimits: { ...ASSET_LIMITS },
    ports,
    defaultParams: () => {
      if (meta.type === 'image') {
        return { weight: meta.weight, volume: 1, muted: false, loop: true }
      }
      if (meta.type === 'video') {
        return { durationSec: 5, playbackRate: 1, volume: 1, muted: false, loop: true }
      }
      if (meta.type === 'voice') {
        return { volume: 1, muted: false, loop: true }
      }
      if (meta.type === 'screenplay') {
        return { text: '…', weight: meta.weight, volume: 1, muted: false, loop: true }
      }
      if (meta.type === 'motion') {
        return { viewer: defaultViewer }
      }
      return { weight: meta.weight, volume: 1, muted: false, loop: true }
    },
    addable: meta.addable,
    assetType: meta.type,
    deletable: true,
    inspector: meta.type === 'motion' ? 'camera' : 'asset',
    inspectorId: meta.type === 'subgraph' ? 'studio.graph.host' : undefined,
    card: 'media',
    contributeToGeneration: meta.type !== 'motion' && meta.type !== 'subgraph',
    execute:
      meta.type === 'motion'
        ? (ctx: NodeExecuteContext) =>
            isAssetRefNode(ctx.node)
              ? executeMotionAssetRefNode(ctx)
              : executeCamera3dNode(ctx)
        : meta.type === 'screenplay'
          ? executeScreenplayGenerateNode
          : executeAssetNode
  }
}

function outputInputType(kind: GraphOutputKind): GraphPortDataType {
  // 输出节点仅输入口；多结果靠 multiple + 运行时 items
  if (kind === 'voice') return GraphPortType.voice
  if (kind === 'video') return GraphPortType.video
  if (kind === 'image') return GraphPortType.image
  if (kind === 'text') return GraphPortType.text
  return GraphPortType.image
}

function outputDef(kind: GraphOutputKind, label: string, icon: string): NodeTypeDefinition {
  return {
    typeId: `output.${kind}`,
    category: 'output',
    label,
    icon,
    defaultTitle: label,
    defaultSize: { ...OUTPUT_SIZE },
    sizeLimits: { ...OUTPUT_LIMITS },
    ports: [
      {
        id: 'in',
        direction: 'in',
        dataType: outputInputType(kind),
        multiple: true,
        label: 'In'
      }
    ],
    defaultParams: () => ({
      outputKind: kind,
      ...(kind === 'image' ? { inputDataType: GraphPortType.image } : {}),
      ...(kind === 'video' ? { inputDataType: GraphPortType.video } : {}),
      ...(kind === 'voice' ? { inputDataType: GraphPortType.voice } : {}),
      ...(kind === 'text' ? { inputDataType: GraphPortType.text } : {}),
      durationSec: kind === 'video' ? 5 : undefined,
      playbackRate: kind === 'video' ? 1 : undefined,
      volume: 1,
      muted: false,
      loop: kind === 'voice' || kind === 'video'
    }),
    addable: false,
    singletonId: graphOutputNodeId(kind),
    deletable: true,
    inspector: 'output',
    card: 'media',
    contributeToGeneration: false,
    execute: executeOutputNode
  }
}

/** 导演台 / 成片时间线 / 叙事 / 世界元素资产编辑窗口的专用输出（仅输入口，无输出端口） */
function specializedOutputDef(
  typeId:
    | 'output.director'
    | 'output.timeline'
    | 'output.beat'
    | 'output.beatUnit'
    | 'output.world',
  label: string,
  icon: string,
  defaultTitle: string,
  kind: GraphOutputKind,
  inputDataType: GraphPortDataType,
  execute: NodeTypeDefinition['execute'] = executeOutputNode,
  inspectorId?: string
): NodeTypeDefinition {
  return {
    typeId,
    category: 'output',
    label,
    icon,
    defaultTitle,
    defaultSize: { ...OUTPUT_SIZE },
    sizeLimits: { ...OUTPUT_LIMITS },
    ports: [
      {
        id: 'in',
        direction: 'in',
        dataType: inputDataType,
        multiple: true,
        label: 'In'
      }
    ],
    defaultParams: () => ({
      outputKind: kind,
      inputDataType,
      mediaOutputDir: '',
      generatedTexts: [],
      durationSec: kind === 'video' ? 5 : undefined,
      playbackRate: kind === 'video' ? 1 : undefined,
      volume: 1,
      muted: false,
      loop: kind === 'voice' || kind === 'video'
    }),
    addable: false,
    singletonId:
      typeId === 'output.director'
        ? GRAPH_OUTPUT_NODE_IDS.director
        : typeId === 'output.timeline'
          ? GRAPH_OUTPUT_NODE_IDS.timeline
          : typeId === 'output.beat'
            ? GRAPH_OUTPUT_NODE_IDS.beat
            : typeId === 'output.beatUnit'
              ? GRAPH_OUTPUT_NODE_IDS.beatUnit
              : GRAPH_OUTPUT_NODE_IDS.world,
    // classic 输出已从菜单移除；残留节点允许删除
    deletable: true,
    inspector: 'output',
    ...(inspectorId ? { inspectorId } : {}),
    card: 'media',
    contributeToGeneration: false,
    execute
  }
}

export const BUILTIN_NODE_TYPES: NodeTypeDefinition[] = [
  ...ASSET_META.map(assetDef),
  outputDef('video', 'Video output', VIDEO_ASSET_ICON),
  outputDef('image', 'Image output', '🖼️'),
  outputDef('voice', 'Audio output', '🔊'),
  outputDef('text', 'Text output', '📝'),
  specializedOutputDef(
    'output.director',
    'Director deck output',
    '🎬',
    ASSET_DIRECTOR_OUTPUT_TITLE,
    'image',
    GraphPortType.image
  ),
  specializedOutputDef(
    'output.timeline',
    'Cut timeline',
    '🎥',
    ASSET_TIMELINE_OUTPUT_TITLE,
    'video',
    GraphPortType.video,
    executeTimelineOutputNode
  ),
  specializedOutputDef(
    'output.beat',
    'Beat output',
    '📖',
    ASSET_BEAT_OUTPUT_TITLE,
    'text',
    GraphPortType.beat,
    executeBeatCatalogOutputNode
  ),
  specializedOutputDef(
    'output.beatUnit',
    'Beat output',
    '📖',
    BEAT_UNIT_OUTPUT_TITLE,
    'text',
    GraphPortType.text
  ),
  specializedOutputDef(
    'output.world',
    'World element output',
    '🌍',
    ASSET_WORLD_OUTPUT_TITLE,
    'text',
    GraphPortType.worldEntities,
    executeWorldEntitiesOutputNode
  ),
  {
    typeId: 'note.text',
    category: 'note',
    label: 'Note',
    icon: '📝',
    defaultTitle: 'Note',
    defaultSize: { ...NOTE_SIZE },
    sizeLimits: { ...NOTE_LIMITS },
    ports: [],
    defaultParams: () => ({ text: 'Note…' }),
    addable: true,
    deletable: true,
    inspector: 'note',
    card: 'note',
    presentation: {
      badgeKey: 'graph.note.badge',
      defaultTitleKey: 'graph.note.title',
      textPlaceholderKey: 'graph.note.placeholder'
    },
    contributeToGeneration: false,
    execute: executeNoteNode
  },
  {
    typeId: 'play.script',
    category: 'note',
    label: 'Text',
    icon: '📝',
    defaultTitle: 'Text',
    defaultSize: { ...NOTE_SIZE },
    sizeLimits: { ...NOTE_LIMITS },
    ports: [{ id: 'out', direction: 'out', dataType: GraphPortType.text, multiple: true, label: 'Out' }],
    defaultParams: () => ({ text: '…' }),
    addable: true,
    deletable: true,
    inspector: 'note',
    card: 'note',
    presentation: {
      badgeKey: 'graph.scriptNode.badge',
      defaultTitleKey: 'graph.scriptNode.title',
      textPlaceholderKey: 'graph.scriptNode.placeholder'
    },
    contributeToGeneration: false,
    execute: executePlayScriptNode
  },
  {
    typeId: 'graph.input.slot',
    category: 'note',
    label: 'Input interface',
    icon: '📥',
    defaultTitle: 'Input',
    defaultSize: { ...NOTE_SIZE },
    sizeLimits: { ...NOTE_LIMITS },
    ports: [
      { id: 'out', direction: 'out', dataType: GraphPortType.text, multiple: false, label: 'Out' }
    ],
    defaultParams: () => ({ previewCollapsed: true }),
    addable: false,
    deletable: false,
    inspector: 'note',
    card: 'note',
    presentation: {
      badgeKey: 'graph.inputInterface.badge',
      defaultTitleKey: 'graph.inputInterface.title'
    },
    contributeToGeneration: false,
    execute: executeHostInputSlotNode
  },
  {
    typeId: 'graph.boundary.input',
    category: 'note',
    label: 'Boundary input',
    icon: '⬚',
    defaultTitle: 'Input',
    defaultSize: { ...NOTE_SIZE },
    sizeLimits: { ...NOTE_LIMITS },
    ports: [
      { id: 'out', direction: 'out', dataType: GraphPortType.text, multiple: false, label: 'Out' }
    ],
    defaultParams: () => ({ previewCollapsed: true }),
    addable: false,
    deletable: false,
    inspector: 'note',
    card: 'note',
    presentation: {
      badgeKey: 'graph.boundaryInput.badge',
      defaultTitleKey: 'graph.boundaryInput.title'
    },
    contributeToGeneration: false,
    execute: executeBoundaryInputNode
  },
  {
    typeId: 'graph.boundary.output',
    category: 'note',
    label: 'Boundary output',
    icon: '⧉',
    defaultTitle: 'Output',
    defaultSize: { ...NOTE_SIZE },
    sizeLimits: { ...NOTE_LIMITS },
    ports: [
      { id: 'in', direction: 'in', dataType: GraphPortType.text, multiple: true, label: 'In' }
    ],
    defaultParams: () => ({ previewCollapsed: true }),
    addable: false,
    deletable: false,
    inspector: 'note',
    card: 'note',
    presentation: {
      badgeKey: 'graph.boundaryOutput.badge',
      defaultTitleKey: 'graph.boundaryOutput.title'
    },
    contributeToGeneration: false,
    execute: executeBoundaryOutputNode
  },
  {
    typeId: 'image.select',
    category: 'note',
    label: 'Select image',
    icon: '🖼️',
    defaultTitle: 'Select image',
    defaultSize: { ...ASSET_SIZE },
    sizeLimits: { ...ASSET_LIMITS },
    ports: [
      { id: 'in', direction: 'in', dataType: GraphPortType.images, multiple: true, label: 'In' },
      { id: 'out', direction: 'out', dataType: GraphPortType.image, multiple: true, label: 'Out' }
    ],
    defaultParams: () => ({}),
    addable: true,
    deletable: true,
    inspector: 'none',
    inspectorId: 'studio.graph.select',
    card: 'media',
    contributeToGeneration: false,
    execute: executeSelectImageNode
  },
  {
    typeId: 'video.select',
    category: 'note',
    label: 'Select video',
    icon: '🎬',
    defaultTitle: 'Select video',
    defaultSize: { ...ASSET_SIZE },
    sizeLimits: { ...ASSET_LIMITS },
    ports: [
      { id: 'in', direction: 'in', dataType: GraphPortType.videos, multiple: true, label: 'In' },
      { id: 'out', direction: 'out', dataType: GraphPortType.video, multiple: true, label: 'Out' }
    ],
    defaultParams: () => ({}),
    addable: true,
    deletable: true,
    inspector: 'none',
    inspectorId: 'studio.graph.select',
    card: 'media',
    contributeToGeneration: false,
    execute: executeSelectVideoNode
  },
  {
    typeId: 'voice.select',
    category: 'note',
    label: 'Select voice',
    icon: '🔊',
    defaultTitle: 'Select voice',
    defaultSize: { ...ASSET_SIZE },
    sizeLimits: { ...ASSET_LIMITS },
    ports: [
      { id: 'in', direction: 'in', dataType: GraphPortType.voices, multiple: true, label: 'In' },
      { id: 'out', direction: 'out', dataType: GraphPortType.voice, multiple: true, label: 'Out' }
    ],
    defaultParams: () => ({}),
    addable: true,
    deletable: true,
    inspector: 'none',
    inspectorId: 'studio.graph.select',
    card: 'media',
    contributeToGeneration: false,
    execute: executeSelectVoiceNode
  },
  {
    typeId: 'text.select',
    category: 'note',
    label: 'Select text',
    icon: '📝',
    defaultTitle: 'Select text',
    defaultSize: { ...ASSET_SIZE },
    sizeLimits: { ...ASSET_LIMITS },
    ports: [
      { id: 'in', direction: 'in', dataType: GraphPortType.texts, multiple: true, label: 'In' },
      { id: 'out', direction: 'out', dataType: GraphPortType.text, multiple: true, label: 'Out' }
    ],
    defaultParams: () => ({
      text: '',
      selectedTextId: ''
    }),
    addable: true,
    deletable: true,
    inspector: 'none',
    inspectorId: 'studio.graph.select',
    card: 'media',
    contributeToGeneration: false,
    execute: executeSelectTextNode
  },
  {
    typeId: 'beat.select',
    category: 'note',
    label: 'Select beat unit',
    icon: '📖',
    defaultTitle: 'Select beat unit',
    defaultSize: { ...ASSET_SIZE },
    sizeLimits: { ...ASSET_LIMITS },
    ports: [
      { id: 'in', direction: 'in', dataType: GraphPortType.beat, multiple: false, label: 'In' },
      {
        id: 'out',
        direction: 'out',
        dataType: GraphPortType.text,
        multiple: true,
        label: 'Out'
      }
    ],
    defaultParams: () => ({
      text: '',
      selectedBeatId: ''
    }),
    addable: true,
    deletable: true,
    inspector: 'none',
    inspectorId: 'studio.graph.select',
    card: 'media',
    contributeToGeneration: false,
    execute: executeSelectBeatNode
  },
  {
    typeId: 'image.multiAngle',
    category: 'note',
    label: 'Multi-angle editor',
    icon: '🎥',
    defaultTitle: 'Multi-angle editor',
    defaultSize: { ...ASSET_SIZE },
    sizeLimits: { ...ASSET_LIMITS },
    ports: [
      { id: 'in', direction: 'in', dataType: GraphPortType.image, multiple: false, label: 'In' },
      ...galleryOutPorts(GraphPortType.image)
    ],
    defaultParams: () => ({
      text: '',
      multiAngleCamera: {
        presetId: 'custom',
        yaw: 0,
        pitch: 0,
        shotScale: 0.5,
        promptEnabled: false
      },
      multiAnglePrompt: '',
      generateModel: '',
      generateProviderInstanceId: '',
      generateSystemPrompt: ''
    }),
    addable: true,
    deletable: true,
    inspector: 'none',
    inspectorId: 'studio.graph.multiAngle',
    card: 'media',
    assetType: 'image',
    contributeToGeneration: false,
    execute: executeMultiAngleNode
  },
  {
    typeId: 'image.lighting',
    category: 'note',
    label: 'Lighting editor',
    icon: '💡',
    defaultTitle: 'Lighting editor',
    defaultSize: { ...ASSET_SIZE },
    sizeLimits: { ...ASSET_LIMITS },
    ports: [
      { id: 'in', direction: 'in', dataType: GraphPortType.image, multiple: false, label: 'In' },
      ...galleryOutPorts(GraphPortType.image)
    ],
    defaultParams: () => ({
      lightingSetup: {
        presetId: 'custom',
        viewMode: 'perspective',
        yaw: 0,
        pitch: 0,
        brightness: 50,
        color: '#ffffff',
        mainDirection: 'front',
        rimLight: false,
        smartMode: true,
        smartPrompt: ''
      },
      lightingPrompt: '',
      generateModel: '',
      generateProviderInstanceId: '',
      generateSystemPrompt: ''
    }),
    addable: true,
    deletable: true,
    inspector: 'none',
    inspectorId: 'studio.graph.lighting',
    card: 'media',
    assetType: 'image',
    contributeToGeneration: false,
    execute: executeLightingNode
  },
  {
    typeId: 'image.portraitTexture',
    category: 'note',
    label: 'Portrait texture',
    icon: '🪞',
    defaultTitle: 'Portrait texture',
    defaultSize: { ...ASSET_SIZE },
    sizeLimits: { ...ASSET_LIMITS },
    ports: [
      { id: 'in', direction: 'in', dataType: GraphPortType.image, multiple: false, label: 'In' },
      ...galleryOutPorts(GraphPortType.image)
    ],
    defaultParams: () => ({
      portraitTexture: {
        personScene: 'natural',
        lightShadow: 'natural',
        skin: 'natural',
        texture: 'natural',
        sharpness: 'standard'
      },
      portraitTexturePrompt: '',
      generateModel: '',
      generateProviderInstanceId: '',
      generateSystemPrompt: ''
    }),
    addable: true,
    deletable: true,
    inspector: 'none',
    inspectorId: 'studio.graph.portraitTexture',
    card: 'media',
    assetType: 'image',
    contributeToGeneration: false,
    execute: executePortraitTextureNode
  },
  {
    typeId: 'image.emotion',
    category: 'note',
    label: 'Emotion pad',
    icon: '😶',
    defaultTitle: 'Emotion pad',
    defaultSize: { ...ASSET_SIZE },
    sizeLimits: { ...ASSET_LIMITS },
    ports: [
      { id: 'in', direction: 'in', dataType: GraphPortType.image, multiple: false, label: 'In' },
      ...galleryOutPorts(GraphPortType.image)
    ],
    defaultParams: () => ({
      emotionPad: { gridX: 2, gridY: 2 },
      emotionLabel: '',
      emotionPrompt: '',
      generateModel: '',
      generateProviderInstanceId: '',
      generateSystemPrompt: ''
    }),
    addable: true,
    deletable: true,
    inspector: 'none',
    inspectorId: 'studio.graph.emotion',
    card: 'media',
    assetType: 'image',
    contributeToGeneration: false,
    execute: executeEmotionNode
  },
  {
    typeId: 'image.upscale',
    category: 'note',
    label: 'HD upscale',
    icon: '🔍',
    defaultTitle: 'HD upscale',
    defaultSize: { ...ASSET_SIZE },
    sizeLimits: { ...ASSET_LIMITS },
    ports: [
      { id: 'in', direction: 'in', dataType: GraphPortType.image, multiple: false, label: 'In' },
      ...galleryOutPorts(GraphPortType.image)
    ],
    defaultParams: () => ({
      imageUpscale: {
        engineId: 'imageApi',
        variantId: 'general',
        scale: 2
      },
      generateInstruction: '将输入图片高清放大，保持构图、色彩与主体身份不变，不裁切、不改风格。',
      generateSystemPrompt: '',
      generateModel: '',
      generateProviderInstanceId: '',
      generateAspectRatio: ''
    }),
    addable: true,
    deletable: true,
    inspector: 'none',
    inspectorId: 'studio.graph.upscale',
    card: 'media',
    assetType: 'image',
    contributeToGeneration: false,
    execute: executeUpscaleNode
  },
  {
    typeId: 'video.lipSync',
    category: 'note',
    label: 'Lip sync',
    icon: '👄',
    defaultTitle: 'Lip sync',
    defaultSize: { ...ASSET_SIZE },
    sizeLimits: { ...ASSET_LIMITS },
    ports: [
      {
        id: 'in-image',
        direction: 'in',
        dataType: GraphPortType.image,
        multiple: false,
        label: 'Image'
      },
      {
        id: 'in-video',
        direction: 'in',
        dataType: GraphPortType.video,
        multiple: false,
        label: 'Video'
      },
      {
        id: 'in-voice',
        direction: 'in',
        dataType: GraphPortType.voice,
        multiple: false,
        label: 'Audio'
      },
      {
        id: 'in-text',
        direction: 'in',
        dataType: GraphPortType.text,
        multiple: true,
        label: 'Text'
      },
      ...galleryOutPorts(GraphPortType.video)
    ],
    defaultParams: () => ({
      generateModel: '',
      generateProviderInstanceId: '',
      generateInstruction: '',
      generateAudio: true,
      generateFrameMode: 'none' as const
    }),
    addable: true,
    deletable: true,
    inspector: 'none',
    inspectorId: 'studio.graph.lipSync',
    card: 'media',
    assetType: 'video',
    contributeToGeneration: false,
    execute: executeLipSyncNode
  },
  {
    typeId: 'image.expand',
    category: 'note',
    label: 'Image expand',
    icon: '⛶',
    defaultTitle: 'Image expand',
    defaultSize: { ...ASSET_SIZE },
    sizeLimits: { ...ASSET_LIMITS },
    ports: [
      { id: 'in', direction: 'in', dataType: GraphPortType.image, multiple: false, label: 'In' },
      ...galleryOutPorts(GraphPortType.image)
    ],
    defaultParams: () => ({
      imageExpand: {
        expandLeft: 0,
        expandRight: 0.5,
        expandTop: 0.5,
        expandBottom: 0,
        aspectId: 'original',
        resolution: '2K',
        count: 1
      },
      generateModel: '',
      generateProviderInstanceId: '',
      generateSystemPrompt: ''
    }),
    addable: true,
    deletable: true,
    inspector: 'none',
    inspectorId: 'studio.graph.expand',
    card: 'media',
    assetType: 'image',
    contributeToGeneration: false,
    execute: executeExpandNode
  },
  {
    typeId: 'image.redraw',
    category: 'note',
    label: 'Image redraw',
    icon: '🖌️',
    defaultTitle: 'Image redraw',
    defaultSize: { ...ASSET_SIZE },
    sizeLimits: { ...ASSET_LIMITS },
    ports: [
      { id: 'in', direction: 'in', dataType: GraphPortType.image, multiple: false, label: 'In' },
      ...galleryOutPorts(GraphPortType.image)
    ],
    defaultParams: () => ({
      imageRedraw: {
        maskDataUrl: '',
        prompt: '',
        brushSize: 28,
        aspectId: 'original',
        resolution: '2K',
        count: 1
      },
      generateModel: '',
      generateProviderInstanceId: '',
      generateSystemPrompt: ''
    }),
    addable: true,
    deletable: true,
    inspector: 'none',
    inspectorId: 'studio.graph.redraw',
    card: 'media',
    assetType: 'image',
    contributeToGeneration: false,
    execute: executeRedrawNode
  },
  {
    typeId: 'image.erase',
    category: 'note',
    label: 'Image erase',
    icon: '🧹',
    defaultTitle: 'Image erase',
    defaultSize: { ...ASSET_SIZE },
    sizeLimits: { ...ASSET_LIMITS },
    ports: [
      { id: 'in', direction: 'in', dataType: GraphPortType.image, multiple: false, label: 'In' },
      ...galleryOutPorts(GraphPortType.image)
    ],
    defaultParams: () => ({
      imageErase: {
        maskDataUrl: '',
        prompt: '',
        brushSize: 28,
        aspectId: 'original',
        resolution: '2K',
        count: 1
      },
      generateModel: '',
      generateProviderInstanceId: '',
      generateSystemPrompt: ''
    }),
    addable: true,
    deletable: true,
    inspector: 'none',
    inspectorId: 'studio.graph.erase',
    card: 'media',
    assetType: 'image',
    contributeToGeneration: false,
    execute: executeEraseNode
  },
  {
    typeId: 'image.matte',
    category: 'note',
    label: 'Image matte',
    icon: '✂️',
    defaultTitle: 'Image matte',
    defaultSize: { ...ASSET_SIZE },
    sizeLimits: { ...ASSET_LIMITS },
    ports: [
      { id: 'in', direction: 'in', dataType: GraphPortType.image, multiple: false, label: 'In' },
      ...galleryOutPorts(GraphPortType.image)
    ],
    defaultParams: () => ({
      imageMatte: {
        maskDataUrl: '',
        prompt: '',
        brushSize: 28,
        aspectId: 'original',
        resolution: '2K',
        count: 1
      },
      generateModel: '',
      generateProviderInstanceId: '',
      generateSystemPrompt: ''
    }),
    addable: true,
    deletable: true,
    inspector: 'none',
    inspectorId: 'studio.graph.matte',
    card: 'media',
    assetType: 'image',
    contributeToGeneration: false,
    execute: executeMatteNode
  },
  {
    typeId: 'image.crop',
    category: 'note',
    label: 'Image crop',
    icon: '❐',
    defaultTitle: 'Image crop',
    defaultSize: { ...ASSET_SIZE },
    sizeLimits: { ...ASSET_LIMITS },
    ports: [
      { id: 'in', direction: 'in', dataType: GraphPortType.image, multiple: false, label: 'In' },
      ...galleryOutPorts(GraphPortType.image)
    ],
    defaultParams: () => ({
      imageCrop: {
        cropX: 0.1,
        cropY: 0.1,
        cropW: 0.8,
        cropH: 0.8,
        aspectId: 'original'
      }
    }),
    addable: true,
    deletable: true,
    inspector: 'none',
    inspectorId: 'studio.graph.crop',
    card: 'media',
    assetType: 'image',
    contributeToGeneration: false,
    execute: executeCropNode
  },
  {
    typeId: 'image.gridSplit',
    category: 'note',
    label: 'Grid split',
    icon: '▦',
    defaultTitle: 'Grid split',
    defaultSize: { ...ASSET_SIZE },
    sizeLimits: { ...ASSET_LIMITS },
    ports: [
      { id: 'in', direction: 'in', dataType: GraphPortType.image, multiple: false, label: 'In' },
      ...galleryOutPorts(GraphPortType.image)
    ],
    defaultParams: () => ({
      imageGridSplit: {
        rows: 3,
        cols: 3,
        selected: []
      }
    }),
    addable: true,
    deletable: true,
    inspector: 'none',
    inspectorId: 'studio.graph.gridSplit',
    card: 'media',
    assetType: 'image',
    contributeToGeneration: false,
    execute: executeGridSplitNode
  },
  {
    typeId: 'prompt.optimize',
    category: 'note',
    label: 'Prompt optimize',
    icon: '✨',
    defaultTitle: 'Prompt optimize',
    defaultSize: { ...ASSET_SIZE },
    sizeLimits: { ...ASSET_LIMITS },
    ports: [
      { id: 'in', direction: 'in', dataType: GraphPortType.text, multiple: true, label: 'In' },
      ...galleryOutPorts(GraphPortType.text)
    ],
    defaultParams: () => ({
      text: '',
      generatedTexts: [],
      selectedTextId: '',
      generateInstruction: '',
      generateSystemPrompt: '',
      generateModel: '',
      generateProviderInstanceId: ''
    }),
    addable: true,
    deletable: true,
    inspector: 'none',
    inspectorId: 'studio.graph.promptOptimize',
    card: 'media',
    contributeToGeneration: false,
    execute: executePromptOptimizeNode
  },
  {
    typeId: 'image.toPrompt',
    category: 'note',
    label: 'Image reverse prompt',
    icon: '🔎',
    defaultTitle: 'Image reverse prompt',
    defaultSize: { ...ASSET_SIZE },
    sizeLimits: { ...ASSET_LIMITS },
    ports: [
      { id: 'in', direction: 'in', dataType: GraphPortType.image, multiple: true, label: 'In' },
      ...galleryOutPorts(GraphPortType.text)
    ],
    defaultParams: () => ({
      text: '',
      generatedTexts: [],
      selectedTextId: '',
      generateInstruction:
        '根据图片生成结构化中文提示词，包括主体描述、环境、光影、镜头语言、风格关键词。',
      generateSystemPrompt: '',
      generateModel: '',
      generateProviderInstanceId: ''
    }),
    addable: true,
    deletable: true,
    inspector: 'none',
    inspectorId: 'studio.graph.imageToPrompt',
    card: 'media',
    contributeToGeneration: false,
    execute: executeImageToPromptNode
  },
  {
    typeId: 'beat.split',
    category: 'note',
    label: 'Beat split',
    icon: '📖',
    defaultTitle: 'Beat split',
    defaultSize: { ...ASSET_SIZE },
    sizeLimits: { ...ASSET_LIMITS },
    ports: [
      { id: 'in', direction: 'in', dataType: GraphPortType.text, multiple: true, label: 'In' },
      {
        id: 'out',
        direction: 'out',
        dataType: GraphPortType.beat,
        multiple: false,
        label: 'Selected'
      },
      {
        id: 'out-all',
        direction: 'out',
        dataType: GraphPortType.texts,
        multiple: true,
        label: 'All'
      }
    ],
    defaultParams: () => ({
      text: '',
      generatedTexts: [],
      selectedTextId: '',
      generateInstruction: '',
      generateSystemPrompt: '',
      generateModel: '',
      generateProviderInstanceId: ''
    }),
    addable: true,
    singletonId: GRAPH_BEAT_SPLIT_NODE_ID,
    deletable: true,
    inspector: 'none',
    inspectorId: 'studio.graph.beatSplit',
    card: 'media',
    contributeToGeneration: false,
    execute: executeBeatSplitNode
  },
  {
    typeId: 'beat.table',
    category: 'note',
    label: 'Beat table',
    icon: '📋',
    defaultTitle: 'Beat table',
    defaultSize: { ...ASSET_SIZE },
    sizeLimits: { ...ASSET_LIMITS },
    ports: [
      { id: 'in', direction: 'in', dataType: GraphPortType.beat, multiple: false, label: 'In' },
      { id: 'out', direction: 'out', dataType: GraphPortType.beat, multiple: true, label: 'Out' }
    ],
    defaultParams: () => ({ text: '' }),
    addable: true,
    singletonId: GRAPH_BEAT_TABLE_NODE_ID,
    deletable: true,
    inspector: 'none',
    inspectorId: 'studio.graph.beatTable',
    card: 'media',
    contributeToGeneration: false,
    execute: executeBeatTableNode
  },
  {
    typeId: 'beat.gen',
    category: 'note',
    label: 'Beat unit gen',
    icon: '📖',
    defaultTitle: 'Beat unit gen',
    defaultSize: { ...ASSET_SIZE },
    sizeLimits: { ...ASSET_LIMITS },
    ports: [
      { id: 'in', direction: 'in', dataType: GraphPortType.beat, multiple: false, label: 'In' },
      {
        id: 'out',
        direction: 'out',
        dataType: GraphPortType.text,
        multiple: false,
        label: 'Selected'
      },
      {
        id: 'out-all',
        direction: 'out',
        dataType: GraphPortType.texts,
        multiple: true,
        label: 'All'
      }
    ],
    defaultParams: () => ({
      mediaOutputDir: '',
      generatedTexts: [],
      selectedTextId: ''
    }),
    addable: false,
    singletonId: GRAPH_BEAT_GEN_NODE_ID,
    deletable: true,
    inspector: 'none',
    inspectorId: 'studio.graph.beatGen',
    card: 'media',
    contributeToGeneration: false,
    execute: executeBeatGenNode
  },
  {
    typeId: 'beat.unitGen',
    category: 'note',
    label: 'Beat gen',
    icon: '📖',
    defaultTitle: 'Beat gen',
    defaultSize: { ...ASSET_SIZE },
    sizeLimits: { ...ASSET_LIMITS },
    ports: [
      { id: 'in', direction: 'in', dataType: GraphPortType.text, multiple: true, label: 'In' },
      ...galleryOutPorts(GraphPortType.text)
    ],
    defaultParams: () => defaultBeatUnitGenParams(),
    addable: true,
    deletable: true,
    inspector: 'none',
    inspectorId: 'studio.graph.beatUnitGen',
    card: 'media',
    contributeToGeneration: false,
    execute: executeBeatUnitGenNode
  },
  {
    typeId: 'beat.unitRef',
    category: 'note',
    label: 'Beat ref',
    icon: '📎',
    defaultTitle: 'Beat ref',
    defaultSize: { ...ASSET_SIZE },
    sizeLimits: { ...ASSET_LIMITS },
    ports: [
      { id: 'out', direction: 'out', dataType: GraphPortType.text, multiple: true, label: 'Out' }
    ],
    defaultParams: () => ({}),
    addable: true,
    deletable: true,
    inspector: 'none',
    inspectorId: 'studio.graph.beatUnitRef',
    card: 'media',
    contributeToGeneration: false,
    execute: executeBeatUnitRefNode
  },
  {
    typeId: 'episode.anchorSelect',
    category: 'note',
    label: 'Anchor select',
    icon: '🎯',
    defaultTitle: 'Anchor select',
    defaultSize: { ...ASSET_SIZE },
    sizeLimits: { ...ASSET_LIMITS },
    ports: [
      { id: 'in', direction: 'in', dataType: GraphPortType.text, multiple: false, label: 'In' },
      { id: 'out', direction: 'out', dataType: GraphPortType.text, multiple: false, label: 'Out' }
    ],
    defaultParams: () => ({ text: '', anchorIndex: 1 }),
    addable: true,
    deletable: true,
    inspector: 'none',
    inspectorId: 'studio.graph.episodeAnchorSelect',
    card: 'media',
    contributeToGeneration: false,
    execute: executeEpisodeAnchorSelectNode
  },
  {
    typeId: 'episode.cellSelect',
    category: 'note',
    label: 'Dynamic cell select',
    icon: '🔲',
    defaultTitle: 'Dynamic cell select',
    defaultSize: { ...ASSET_SIZE },
    sizeLimits: { ...ASSET_LIMITS },
    ports: [
      { id: 'in', direction: 'in', dataType: GraphPortType.text, multiple: false, label: 'In' },
      { id: 'out', direction: 'out', dataType: GraphPortType.text, multiple: false, label: 'Out' }
    ],
    defaultParams: () => ({ text: '', cellGroupIndex: 1, cellIndex: 1 }),
    addable: true,
    deletable: true,
    inspector: 'none',
    inspectorId: 'studio.graph.episodeCellSelect',
    card: 'media',
    contributeToGeneration: false,
    execute: executeEpisodeCellSelectNode
  },
  {
    typeId: 'world.extract',
    category: 'note',
    label: 'World extract',
    icon: '🗡️',
    defaultTitle: 'World extract',
    defaultSize: { ...ASSET_SIZE },
    sizeLimits: { ...ASSET_LIMITS },
    ports: [
      { id: 'in', direction: 'in', dataType: GraphPortType.text, multiple: true, label: 'In' },
      {
        id: 'out',
        direction: 'out',
        dataType: GraphPortType.world,
        multiple: false,
        label: 'Selected'
      },
      {
        id: 'out-all',
        direction: 'out',
        dataType: GraphPortType.texts,
        multiple: true,
        label: 'All'
      }
    ],
    defaultParams: () => ({
      text: '',
      generatedTexts: [],
      selectedTextId: '',
      generateInstruction: '',
      generateSystemPrompt: '',
      generateModel: '',
      generateProviderInstanceId: ''
    }),
    addable: true,
    singletonId: GRAPH_WORLD_EXTRACT_NODE_ID,
    deletable: true,
    inspector: 'none',
    inspectorId: 'studio.graph.worldExtract',
    card: 'media',
    contributeToGeneration: false,
    execute: executeWorldExtractNode
  },
  {
    typeId: 'world.table',
    category: 'note',
    label: 'World table',
    icon: '📋',
    defaultTitle: 'World table',
    defaultSize: { ...ASSET_SIZE },
    sizeLimits: { ...ASSET_LIMITS },
    ports: [
      { id: 'in', direction: 'in', dataType: GraphPortType.world, multiple: false, label: 'In' },
      { id: 'out', direction: 'out', dataType: GraphPortType.world, multiple: true, label: 'Out' }
    ],
    defaultParams: () => ({ text: '' }),
    addable: true,
    singletonId: GRAPH_WORLD_TABLE_NODE_ID,
    deletable: true,
    inspector: 'none',
    inspectorId: 'studio.graph.worldTable',
    card: 'media',
    contributeToGeneration: false,
    execute: executeWorldTableNode
  },
  {
    typeId: 'world.gen',
    category: 'note',
    label: 'World element gen',
    icon: '🤺',
    defaultTitle: 'World element gen',
    defaultSize: { ...ASSET_SIZE },
    sizeLimits: { ...ASSET_LIMITS },
    ports: [
      { id: 'in', direction: 'in', dataType: GraphPortType.world, multiple: false, label: 'In' },
      {
        id: 'out',
        direction: 'out',
        dataType: GraphPortType.worldEntities,
        multiple: true,
        label: 'Out'
      }
    ],
    defaultParams: () => ({
      worldElementOutputs: [],
      text: ''
    }),
    addable: true,
    singletonId: GRAPH_WORLD_GEN_NODE_ID,
    deletable: true,
    inspector: 'none',
    inspectorId: 'studio.graph.worldGen',
    card: 'media',
    contributeToGeneration: false,
    /** 同步目录后收集实体；批跑元素子图由 cookBatchSubgraphs / Cook 子图控制 */
    execute: executeWorldGenNode
  },
]

export function ensureBuiltinNodeTypes(): void {
  if (builtinRegistrationState.registered) return
  builtinRegistrationState.registered = true
  for (const definition of BUILTIN_NODE_TYPES) registerNodeType(definition)
}

bindEnsureBuiltinNodeTypes(ensureBuiltinNodeTypes)
