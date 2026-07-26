import type { AssetType } from '../domain'
import {
  bindEnsureBuiltinNodeTypes,
  builtinRegistrationState
} from './builtinState'
import { registerNodeType, type NodeTypeDefinition } from './registry'
import {
  GRAPH_OUTPUT_NODE_IDS,
  GRAPH_SCRIPT_SHOT_IMAGE_GEN_NODE_ID,
  GRAPH_SCRIPT_SHOT_VIDEO_GEN_NODE_ID,
  GRAPH_SCRIPT_SHOT_SPLIT_NODE_ID,
  GRAPH_SCRIPT_SHOT_TABLE_NODE_ID,
  GRAPH_NARRATIVE_SPLIT_NODE_ID,
  GRAPH_NARRATIVE_TABLE_NODE_ID,
  GRAPH_NARRATIVE_GEN_NODE_ID,
  GRAPH_WORLD_GEN_NODE_ID,
  GRAPH_WORLD_EXTRACT_NODE_ID,
  GRAPH_WORLD_TABLE_NODE_ID,
  graphOutputNodeId,
  GraphPortType,
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
  executeImageToPromptNode,
  executePromptOptimizeNode,
  executeScreenplayGenerateNode,
  executeSelectImageNode,
  executeSelectVideoNode,
  executeSelectScreenplayNode,
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
  executeShotParamsNode,
  executeShotSplitNode,
  executeShotTableNode,
  executeShotImageGenNode,
  executeShotVideoGenNode,
  executeNarrativeSplitNode,
  executeNarrativeTableNode,
  executeNarrativeGenNode,
  executeNarrativeUnitGenNode,
  executeNarrativeUnitRefNode,
  executeNarrativeOutputNode,
  executeWorldGenNode,
  executeWorldExtractNode,
  executeWorldTableNode
} from './execute/values'
import {
  ASSET_DIRECTOR_OUTPUT_TITLE,
  ASSET_NARRATIVE_OUTPUT_TITLE,
  ASSET_SCRIPT_OUTPUT_TITLE,
  ASSET_WORLD_OUTPUT_TITLE,
  NARRATIVE_UNIT_OUTPUT_TITLE
} from './scopes'
import { defaultShotParamsNodeParams } from './shotParams'
import { defaultNarrativeUnitGenParams } from './narrativeUnitParams'
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
    icon: '🎨',
    outType: GraphPortType.image,
    addable: false,
    weight: 0.7
  },
  {
    type: 'world',
    label: 'World Elements',
    icon: '🤺',
    outType: GraphPortType.image,
    addable: false,
    weight: 0.7
  },
  {
    type: 'narrative',
    label: 'Narrative Units',
    icon: '🧩',
    outType: GraphPortType.text,
    addable: false,
    weight: 0.7
  },
  {
    type: 'video',
    label: 'Video',
    icon: '🎞️',
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
    type: 'script',
    label: 'Shot',
    icon: '🎥',
    outType: GraphPortType.text,
    addable: true,
    weight: 0.85
  }
]

function motionProcessingPorts(): GraphPortDef[] {
  return [
    { id: 'out', direction: 'out', dataType: GraphPortType.image, multiple: true, label: 'Out' }
  ]
}

/** 图片生成：可接文本提示 / 图片参考 */
function imageProcessingPorts(): GraphPortDef[] {
  return [
    { id: 'in-text', direction: 'in', dataType: GraphPortType.text, multiple: true, label: 'Text' },
    { id: 'in-image', direction: 'in', dataType: GraphPortType.image, multiple: true, label: 'Image' },
    { id: 'out', direction: 'out', dataType: GraphPortType.image, multiple: true, label: 'Out' }
  ]
}

/** 视频生成：可接文本 / 图片 / 视频 / 音频参考；输出口为 video + multiple */
function videoProcessingPorts(): GraphPortDef[] {
  return [
    { id: 'in-text', direction: 'in', dataType: GraphPortType.text, multiple: true, label: 'Text' },
    { id: 'in-image', direction: 'in', dataType: GraphPortType.image, multiple: true, label: 'Image' },
    { id: 'in-video', direction: 'in', dataType: GraphPortType.video, multiple: true, label: 'Video' },
    { id: 'in-voice', direction: 'in', dataType: GraphPortType.voice, multiple: true, label: 'Audio' },
    { id: 'out', direction: 'out', dataType: GraphPortType.video, multiple: true, label: 'Out' }
  ]
}

/** 音频 / 声音设计：可接文本描述 / 图片提示（openspeech voice_design） */
function voiceProcessingPorts(): GraphPortDef[] {
  return [
    { id: 'in-text', direction: 'in', dataType: GraphPortType.text, multiple: true, label: 'Text' },
    { id: 'in-image', direction: 'in', dataType: GraphPortType.image, multiple: true, label: 'Image' },
    { id: 'out', direction: 'out', dataType: GraphPortType.voice, multiple: true, label: 'Out' }
  ]
}

function assetDef(meta: (typeof ASSET_META)[number]): NodeTypeDefinition {
  const ports: GraphPortDef[] =
    meta.type === 'motion'
      ? motionProcessingPorts()
      : meta.type === 'image'
        ? imageProcessingPorts()
        : meta.type === 'video'
          ? videoProcessingPorts()
          : meta.type === 'voice'
            ? voiceProcessingPorts()
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
              {
                id: 'out',
                direction: 'out',
                dataType: meta.outType,
                multiple: true,
                label: 'Out'
              }
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
    card: 'media',
    contributeToGeneration: meta.type !== 'motion',
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
    addable: true,
    singletonId: graphOutputNodeId(kind),
    deletable: false,
    inspector: 'output',
    card: 'media',
    contributeToGeneration: false,
    execute: executeOutputNode
  }
}

/** 导演台 / 分镜 / 叙事 / 世界元素资产编辑窗口的专用输出（仅输入口，无输出端口） */
function specializedOutputDef(
  typeId:
    | 'output.director'
    | 'output.script'
    | 'output.narrative'
    | 'output.narrativeUnit'
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
    addable: true,
    singletonId:
      typeId === 'output.director'
        ? GRAPH_OUTPUT_NODE_IDS.director
        : typeId === 'output.script'
          ? GRAPH_OUTPUT_NODE_IDS.script
          : typeId === 'output.narrative'
            ? GRAPH_OUTPUT_NODE_IDS.narrative
            : typeId === 'output.narrativeUnit'
              ? GRAPH_OUTPUT_NODE_IDS.narrativeUnit
              : GRAPH_OUTPUT_NODE_IDS.world,
    // 叙事 / 分镜 / 世界元素输出允许删除；导演台输出仍锁定
    deletable:
      typeId === 'output.narrative' ||
      typeId === 'output.narrativeUnit' ||
      typeId === 'output.script' ||
      typeId === 'output.world',
    inspector: 'output',
    ...(inspectorId ? { inspectorId } : {}),
    card: 'media',
    contributeToGeneration: false,
    execute
  }
}

export const BUILTIN_NODE_TYPES: NodeTypeDefinition[] = [
  ...ASSET_META.map(assetDef),
  outputDef('video', 'Video output', '🎞️'),
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
    'output.script',
    'Shot output',
    '🎥',
    ASSET_SCRIPT_OUTPUT_TITLE,
    'video',
    GraphPortType.video
  ),
  specializedOutputDef(
    'output.narrative',
    'Narrative output',
    '📜',
    ASSET_NARRATIVE_OUTPUT_TITLE,
    'text',
    GraphPortType.text,
    executeNarrativeOutputNode,
    'studio.graph.narrativeOutput'
  ),
  specializedOutputDef(
    'output.narrativeUnit',
    'Narrative output',
    '📜',
    NARRATIVE_UNIT_OUTPUT_TITLE,
    'text',
    GraphPortType.text
  ),
  specializedOutputDef(
    'output.world',
    'World element output',
    '🌍',
    ASSET_WORLD_OUTPUT_TITLE,
    'image',
    GraphPortType.image
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
    typeId: 'image.select',
    category: 'note',
    label: 'Select image',
    icon: '🖼️',
    defaultTitle: 'Select image',
    defaultSize: { ...ASSET_SIZE },
    sizeLimits: { ...ASSET_LIMITS },
    ports: [
      { id: 'in', direction: 'in', dataType: GraphPortType.image, multiple: true, label: 'In' },
      { id: 'out', direction: 'out', dataType: GraphPortType.image, multiple: true, label: 'Out' }
    ],
    defaultParams: () => ({}),
    addable: true,
    deletable: true,
    inspector: 'none',
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
      { id: 'in', direction: 'in', dataType: GraphPortType.video, multiple: true, label: 'In' },
      { id: 'out', direction: 'out', dataType: GraphPortType.video, multiple: true, label: 'Out' }
    ],
    defaultParams: () => ({}),
    addable: true,
    deletable: true,
    inspector: 'none',
    card: 'media',
    contributeToGeneration: false,
    execute: executeSelectVideoNode
  },
  {
    typeId: 'screenplay.select',
    category: 'note',
    label: 'Select screenplay',
    icon: '📜',
    defaultTitle: 'Select screenplay',
    defaultSize: { ...ASSET_SIZE },
    sizeLimits: { ...ASSET_LIMITS },
    ports: [
      { id: 'in', direction: 'in', dataType: GraphPortType.text, multiple: true, label: 'In' },
      { id: 'out', direction: 'out', dataType: GraphPortType.text, multiple: true, label: 'Out' }
    ],
    defaultParams: () => ({
      text: '',
      selectedTextId: ''
    }),
    addable: true,
    deletable: true,
    inspector: 'none',
    card: 'media',
    contributeToGeneration: false,
    execute: executeSelectScreenplayNode
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
      { id: 'out', direction: 'out', dataType: GraphPortType.text, multiple: true, label: 'Out' }
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
      multiAnglePrompt: ''
    }),
    addable: true,
    deletable: true,
    inspector: 'none',
    inspectorId: 'studio.graph.multiAngle',
    card: 'media',
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
      { id: 'out', direction: 'out', dataType: GraphPortType.text, multiple: true, label: 'Out' }
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
      lightingPrompt: ''
    }),
    addable: true,
    deletable: true,
    inspector: 'none',
    inspectorId: 'studio.graph.lighting',
    card: 'media',
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
      { id: 'out', direction: 'out', dataType: GraphPortType.text, multiple: true, label: 'Out' }
    ],
    defaultParams: () => ({
      portraitTexture: {
        personScene: 'natural',
        lightShadow: 'natural',
        skin: 'natural',
        texture: 'natural',
        sharpness: 'standard'
      },
      portraitTexturePrompt: ''
    }),
    addable: true,
    deletable: true,
    inspector: 'none',
    inspectorId: 'studio.graph.portraitTexture',
    card: 'media',
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
      { id: 'out', direction: 'out', dataType: GraphPortType.text, multiple: true, label: 'Out' }
    ],
    defaultParams: () => ({
      emotionPad: { gridX: 2, gridY: 2 },
      emotionLabel: '',
      emotionPrompt: ''
    }),
    addable: true,
    deletable: true,
    inspector: 'none',
    inspectorId: 'studio.graph.emotion',
    card: 'media',
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
      { id: 'out', direction: 'out', dataType: GraphPortType.image, multiple: true, label: 'Out' }
    ],
    defaultParams: () => ({
      imageUpscale: {
        engineId: 'imageApi',
        variantId: 'general',
        scale: 2
      },
      generateModel: '',
      generateProviderInstanceId: ''
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
      {
        id: 'out',
        direction: 'out',
        dataType: GraphPortType.video,
        multiple: true,
        label: 'Out'
      }
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
      { id: 'out', direction: 'out', dataType: GraphPortType.image, multiple: true, label: 'Out' }
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
      { id: 'out', direction: 'out', dataType: GraphPortType.image, multiple: true, label: 'Out' }
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
      { id: 'out', direction: 'out', dataType: GraphPortType.image, multiple: true, label: 'Out' }
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
      { id: 'out', direction: 'out', dataType: GraphPortType.image, multiple: true, label: 'Out' }
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
      { id: 'out', direction: 'out', dataType: GraphPortType.image, multiple: true, label: 'Out' }
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
      { id: 'out', direction: 'out', dataType: GraphPortType.image, multiple: true, label: 'Out' }
    ],
    defaultParams: () => ({
      imageGridSplit: {
        rows: 3,
        cols: 3,
        selected: [],
        scale: 2
      },
      generateModel: '',
      generateProviderInstanceId: '',
      generateSystemPrompt: ''
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
      { id: 'out', direction: 'out', dataType: GraphPortType.text, multiple: true, label: 'Out' }
    ],
    defaultParams: () => ({
      text: '',
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
      { id: 'out', direction: 'out', dataType: GraphPortType.text, multiple: true, label: 'Out' }
    ],
    defaultParams: () => ({
      text: '',
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
    typeId: 'script.shotSplit',
    category: 'note',
    label: 'Shot split',
    icon: '✂️',
    defaultTitle: 'Shot split',
    defaultSize: { ...ASSET_SIZE },
    sizeLimits: { ...ASSET_LIMITS },
    ports: [
      { id: 'in', direction: 'in', dataType: GraphPortType.text, multiple: true, label: 'In' },
      { id: 'out', direction: 'out', dataType: GraphPortType.text, multiple: true, label: 'Out' }
    ],
    defaultParams: () => ({
      text: '',
      generateInstruction: '',
      generateSystemPrompt: '',
      generateModel: '',
      generateProviderInstanceId: ''
    }),
    addable: true,
    singletonId: GRAPH_SCRIPT_SHOT_SPLIT_NODE_ID,
    deletable: true,
    inspector: 'none',
    inspectorId: 'studio.graph.shotSplit',
    card: 'media',
    contributeToGeneration: false,
    execute: executeShotSplitNode
  },
  {
    typeId: 'narrative.split',
    category: 'note',
    label: 'Narrative split',
    icon: '🧩',
    defaultTitle: 'Narrative split',
    defaultSize: { ...ASSET_SIZE },
    sizeLimits: { ...ASSET_LIMITS },
    ports: [
      { id: 'in', direction: 'in', dataType: GraphPortType.text, multiple: true, label: 'In' },
      { id: 'out', direction: 'out', dataType: GraphPortType.text, multiple: true, label: 'Out' }
    ],
    defaultParams: () => ({
      text: '',
      generateInstruction: '',
      generateSystemPrompt: '',
      generateModel: '',
      generateProviderInstanceId: ''
    }),
    addable: true,
    singletonId: GRAPH_NARRATIVE_SPLIT_NODE_ID,
    deletable: true,
    inspector: 'none',
    inspectorId: 'studio.graph.narrativeSplit',
    card: 'media',
    contributeToGeneration: false,
    execute: executeNarrativeSplitNode
  },
  {
    typeId: 'narrative.table',
    category: 'note',
    label: 'Narrative table',
    icon: '📋',
    defaultTitle: 'Narrative table',
    defaultSize: { ...ASSET_SIZE },
    sizeLimits: { ...ASSET_LIMITS },
    ports: [
      { id: 'in', direction: 'in', dataType: GraphPortType.text, multiple: false, label: 'In' },
      { id: 'out', direction: 'out', dataType: GraphPortType.text, multiple: true, label: 'Out' }
    ],
    defaultParams: () => ({ text: '' }),
    addable: true,
    singletonId: GRAPH_NARRATIVE_TABLE_NODE_ID,
    deletable: true,
    inspector: 'none',
    inspectorId: 'studio.graph.narrativeTable',
    card: 'media',
    contributeToGeneration: false,
    execute: executeNarrativeTableNode
  },
  {
    typeId: 'narrative.gen',
    category: 'note',
    label: 'Narrative unit gen',
    icon: '🧩',
    defaultTitle: 'Narrative unit gen',
    defaultSize: { ...ASSET_SIZE },
    sizeLimits: { ...ASSET_LIMITS },
    ports: [
      { id: 'in', direction: 'in', dataType: GraphPortType.text, multiple: false, label: 'In' },
      { id: 'out', direction: 'out', dataType: GraphPortType.text, multiple: true, label: 'Out' }
    ],
    defaultParams: () => ({}),
    addable: true,
    singletonId: GRAPH_NARRATIVE_GEN_NODE_ID,
    deletable: true,
    inspector: 'none',
    inspectorId: 'studio.graph.narrativeGen',
    card: 'media',
    contributeToGeneration: false,
    execute: executeNarrativeGenNode
  },
  {
    typeId: 'narrative.unitGen',
    category: 'note',
    label: 'Narrative gen',
    icon: '🧩',
    defaultTitle: 'Narrative gen',
    defaultSize: { ...ASSET_SIZE },
    sizeLimits: { ...ASSET_LIMITS },
    ports: [
      { id: 'in', direction: 'in', dataType: GraphPortType.text, multiple: true, label: 'In' },
      { id: 'out', direction: 'out', dataType: GraphPortType.text, multiple: true, label: 'Out' }
    ],
    defaultParams: () => defaultNarrativeUnitGenParams(),
    addable: true,
    deletable: true,
    inspector: 'none',
    inspectorId: 'studio.graph.narrativeUnitGen',
    card: 'media',
    contributeToGeneration: false,
    execute: executeNarrativeUnitGenNode
  },
  {
    typeId: 'narrative.unitRef',
    category: 'note',
    label: 'Narrative ref',
    icon: '📎',
    defaultTitle: 'Narrative ref',
    defaultSize: { ...ASSET_SIZE },
    sizeLimits: { ...ASSET_LIMITS },
    ports: [
      { id: 'out', direction: 'out', dataType: GraphPortType.text, multiple: true, label: 'Out' }
    ],
    defaultParams: () => ({}),
    addable: true,
    deletable: true,
    inspector: 'none',
    inspectorId: 'studio.graph.narrativeUnitRef',
    card: 'media',
    contributeToGeneration: false,
    execute: executeNarrativeUnitRefNode
  },
  {
    typeId: 'script.shotTable',
    category: 'note',
    label: 'Shot table',
    icon: '📊',
    defaultTitle: 'Shot table',
    defaultSize: { ...ASSET_SIZE },
    sizeLimits: { ...ASSET_LIMITS },
    ports: [
      { id: 'in', direction: 'in', dataType: GraphPortType.text, multiple: false, label: 'In' },
      { id: 'out', direction: 'out', dataType: GraphPortType.text, multiple: true, label: 'Out' }
    ],
    defaultParams: () => ({ text: '' }),
    addable: true,
    singletonId: GRAPH_SCRIPT_SHOT_TABLE_NODE_ID,
    deletable: true,
    inspector: 'none',
    inspectorId: 'studio.graph.shotTable',
    card: 'media',
    contributeToGeneration: false,
    execute: executeShotTableNode
  },
  {
    typeId: 'script.shotImageGen',
    category: 'note',
    label: 'Shot image gen',
    icon: '🖼️',
    defaultTitle: 'Shot image gen',
    defaultSize: { ...ASSET_SIZE },
    sizeLimits: { ...ASSET_LIMITS },
    ports: [
      { id: 'in', direction: 'in', dataType: GraphPortType.text, multiple: false, label: 'In' },
      { id: 'out', direction: 'out', dataType: GraphPortType.image, multiple: true, label: 'Out' }
    ],
    defaultParams: () => ({}),
    addable: true,
    singletonId: GRAPH_SCRIPT_SHOT_IMAGE_GEN_NODE_ID,
    deletable: true,
    inspector: 'none',
    card: 'media',
    contributeToGeneration: false,
    execute: executeShotImageGenNode
  },
  {
    typeId: 'script.shotVideoGen',
    category: 'note',
    label: 'Shot video gen',
    icon: '🎬',
    defaultTitle: 'Shot video gen',
    defaultSize: { ...ASSET_SIZE },
    sizeLimits: { ...ASSET_LIMITS },
    ports: [
      { id: 'in-text', direction: 'in', dataType: GraphPortType.text, multiple: false, label: 'Text' },
      {
        id: 'in-image',
        direction: 'in',
        dataType: GraphPortType.image,
        multiple: true,
        label: 'Image'
      },
      { id: 'out', direction: 'out', dataType: GraphPortType.video, multiple: true, label: 'Out' }
    ],
    defaultParams: () => ({}),
    addable: true,
    singletonId: GRAPH_SCRIPT_SHOT_VIDEO_GEN_NODE_ID,
    deletable: true,
    inspector: 'none',
    card: 'media',
    contributeToGeneration: false,
    execute: executeShotVideoGenNode
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
      { id: 'out', direction: 'out', dataType: GraphPortType.text, multiple: true, label: 'Out' }
    ],
    defaultParams: () => ({
      text: '',
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
      { id: 'in', direction: 'in', dataType: GraphPortType.text, multiple: false, label: 'In' },
      { id: 'out', direction: 'out', dataType: GraphPortType.text, multiple: true, label: 'Out' }
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
      { id: 'in', direction: 'in', dataType: GraphPortType.text, multiple: false, label: 'In' },
      { id: 'out', direction: 'out', dataType: GraphPortType.image, multiple: true, label: 'Out' }
    ],
    defaultParams: () => ({}),
    addable: true,
    singletonId: GRAPH_WORLD_GEN_NODE_ID,
    deletable: true,
    inspector: 'none',
    inspectorId: 'studio.graph.worldGen',
    card: 'media',
    contributeToGeneration: false,
    /** 同步目录后收集四类子图已有图片；不级联跑元素生成 */
    execute: executeWorldGenNode
  },
  {
    typeId: 'script.shotParams',
    category: 'note',
    label: 'Shot params',
    icon: '📋',
    defaultTitle: 'Shot params',
    defaultSize: { ...ASSET_SIZE },
    sizeLimits: { ...ASSET_LIMITS },
    ports: [
      { id: 'out', direction: 'out', dataType: GraphPortType.text, multiple: true, label: 'Out' }
    ],
    defaultParams: () => defaultShotParamsNodeParams(),
    addable: true,
    deletable: true,
    inspector: 'none',
    inspectorId: 'studio.graph.shotParams',
    card: 'media',
    contributeToGeneration: false,
    execute: executeShotParamsNode
  }
]

export function ensureBuiltinNodeTypes(): void {
  if (builtinRegistrationState.registered) return
  builtinRegistrationState.registered = true
  for (const definition of BUILTIN_NODE_TYPES) registerNodeType(definition)
}

bindEnsureBuiltinNodeTypes(ensureBuiltinNodeTypes)
