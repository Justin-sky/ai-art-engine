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

/**
 * 语义时间线文档口。
 *
 * 语义管线的入边一律是**整份 `SemanticTimeline` 文档**（schema `aiart.semantic-timeline@1`），
 * 不是随便一段文本 —— 所以它有自己的类型：文本口谁都能接，接错了要等运行期解析才报错。
 *
 * 只有**产物确实是整份文档**的口才用这个类型：语义分析节点的出口，以及语义时间线节点的
 * 进出（它是透传）。触发 / 编译 / 修复 / 多版本的出口是各自的信封
 * （`{eventLabels,events,commands}` / `{rulePacks,commands,scriptTimeline}` /
 * `{plan,definition}` / `{recipeId,variants}`），仍保持 `text`。
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
    typeId: 'semantic.timeline',
    category: 'note',
    label: 'Semantic timeline',
    icon: '🧭',
    defaultTitle: 'Semantic timeline',
    defaultSize: { ...ASSET_SIZE },
    sizeLimits: { ...ASSET_LIMITS },
    ports: [timelineIn, timelineOut],
    defaultParams: () => ({ timelineJson: '' }),
    addable: true,
    deletable: true,
    inspector: 'none',
    inspectorId: 'studio.graph.semanticTimeline',
    card: 'media',
    contributeToGeneration: false,
    execute: async (ctx) => {
      const upstream = ctx.inputs.in?.[0]
      // 上游是结构化时间线值：原样透传（保住 doc，不让它在半路被序列化掉）
      if (upstream && upstream.kind === 'semanticTimeline') return { out: upstream }
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
    ports: [timelineIn, textOut],
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
    label: 'Semantic compile',
    icon: '🎬',
    defaultTitle: 'Semantic compile',
    defaultSize: { ...ASSET_SIZE },
    sizeLimits: { ...ASSET_LIMITS },
    ports: [timelineIn, textOut],
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
    typeId: 'semantic.repair',
    category: 'note',
    label: 'Semantic repair',
    icon: '🔧',
    defaultTitle: 'Semantic repair',
    defaultSize: { ...ASSET_SIZE },
    sizeLimits: { ...ASSET_LIMITS },
    ports: [
      timelineIn,
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
    typeId: 'semantic.variant',
    category: 'note',
    label: 'Semantic variant',
    icon: '🧬',
    defaultTitle: 'Semantic variant',
    defaultSize: { ...ASSET_SIZE },
    sizeLimits: { ...ASSET_LIMITS },
    ports: [
      timelineIn,
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
