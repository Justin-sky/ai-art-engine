/**
 * Semantic Timeline 一等节点定义（注册进 builtins）。
 * 样式与双击对齐视频工具节点：`card: 'media'` + ASSET 尺寸，勿用 note 卡（会走记事本）。
 */
import { GraphPortType } from './types'
import type { NodeTypeDefinition } from './registry'
import {
  executeSemanticAnalyzeNode,
  executeSemanticCompileNode,
  executeSemanticRebuildNode
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

/**
 * 语义时间线文档口。
 *
 * 语义管线的入边一律是**整份 `SemanticTimeline` 文档**（schema `aiart.semantic-timeline@1`），
 * 不是随便一段文本 —— 所以它有自己的类型：文本口谁都能接，接错了要等运行期解析才报错。
 *
 * 只有**产物确实是整份文档**的口才用这个类型：语义分析节点的出口，以及语义编译节点的入口。
 * 语义编译的出口是**提示词计划**（见下 `videoPrompts`），不再走文本口。
 */
const timelineIn = {
  id: 'in',
  direction: 'in' as const,
  dataType: GraphPortType.semanticTimeline,
  multiple: false,
  label: 'Timeline'
}

/**
 * 视频生成提示词口（语义编译 → 语义重建）。
 *
 * 出口是**结构化计划**（每镜提示词 + 该镜首帧），不是一段文本：接错类型在连线时就被拒，
 * 不必等运行期才发现"上游给的是一段普通文本"。文本消费者仍可接（单向投影）。
 */
const promptsOut = {
  id: 'out',
  direction: 'out' as const,
  dataType: GraphPortType.videoPrompts,
  multiple: false,
  label: 'Prompts'
}

const promptsIn = {
  id: 'in',
  direction: 'in' as const,
  dataType: GraphPortType.videoPrompts,
  multiple: false,
  label: 'Prompts'
}

const videoOut = {
  id: 'out-video',
  direction: 'out' as const,
  dataType: GraphPortType.video,
  multiple: false,
  label: 'Video'
}

const timelineOut = {
  id: 'out',
  direction: 'out' as const,
  dataType: GraphPortType.semanticTimeline,
  multiple: false,
  label: 'Timeline'
}

export const SEMANTIC_TIMELINE_NODE_TYPES: NodeTypeDefinition[] = [
  {
    typeId: 'semantic.analyze',
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
      timelineOut
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
      /**
       * 富化（三步 LLM）用哪家/哪个模型。空 = 应用默认文本模型。
       *
       * 之前这两个字段**没被声明**，而 `runSkill` 一直在读它们 —— 等于按节点指定模型是条死路，
       * 用户只能吃「设置里第一个合格实例」，撞上未开通的模型就三步全失败（实测踩过）。
       */
      generateModel: '',
      generateProviderInstanceId: '',
      /** 转写用哪家/哪个模型；空 = 首个支持转写的已配置实例（老行为） */
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
    typeId: 'semantic.compile',
    category: 'note',
    label: 'Semantic compile',
    icon: '🎬',
    defaultTitle: 'Semantic compile',
    defaultSize: { ...ASSET_SIZE },
    sizeLimits: { ...ASSET_LIMITS },
    // 出口是**提示词计划**（结构化口）：接错类型在连线时就被拒，不必等运行期解析
    ports: [timelineIn, promptsOut],
    defaultParams: () => ({
      timelineJson: '',
      sourceRelativePath: '',
      rulePackIds: '',
      promptOverridesJson: ''
    }),
    addable: true,
    deletable: true,
    inspector: 'none',
    inspectorId: 'studio.graph.semanticCompile',
    card: 'media',
    contributeToGeneration: false,
    execute: executeSemanticCompileNode
  },
  {
    typeId: 'semantic.rebuild',
    category: 'note',
    label: 'Semantic rebuild',
    icon: '🎞️',
    defaultTitle: 'Semantic rebuild',
    defaultSize: { ...ASSET_SIZE },
    sizeLimits: { ...ASSET_LIMITS },
    ports: [promptsIn, textOut, videoOut],
    defaultParams: () => ({
      rebuildMode: 'shots',
      generateModel: '',
      generateProviderInstanceId: '',
      rebuildDurationSec: 0,
      rebuildResolution: '',
      rebuildAspectRatio: '',
      rebuildMaxShots: 12,
      rebuildKeepAudio: true,
      rebuildBurnSubtitles: true,
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
