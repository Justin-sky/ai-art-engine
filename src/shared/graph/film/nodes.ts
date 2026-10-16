/**
 * 影视流水线节点定义（右键菜单「影视」）。
 *
 * 数据流（全部结构化口，连错类型在连线时就被拒）：
 *
 *   剧本(text) → film.breakdown ─storyboard→ film.review ─storyboard→ film.cast ─filmCast┐
 *                                                     └─storyboard──────────────→ film.render → images / videos
 *                                                     └─storyboard→ film.shot(+filmCast) → asset.image / asset.video（精修单镜）
 *
 * 样式对齐视频工具节点：`card: 'media'` + ASSET 尺寸。
 */
import { GraphPortType, type GraphPortDef } from '../types'
import type { NodeTypeDefinition } from '../registry'
import {
  executeFilmBreakdownNode,
  executeFilmCastNode,
  executeFilmRenderNode,
  executeFilmReviewNode,
  executeFilmShotNode,
  executeFilmWorkbenchNode
} from '../execute/film'

const ASSET_SIZE = { w: 168, h: 128 }
const ASSET_LIMITS = { minW: 120, minH: 72, maxW: 480, maxH: 400 }

/** 菜单与预设共用的 typeId（film.workbench 为合一工作台节点；其余四个阶段节点保留存档兼容） */
export const FILM_NODE_TYPE_IDS = [
  'film.workbench',
  'film.breakdown',
  'film.review',
  'film.cast',
  'film.shot',
  'film.render'
] as const

export type FilmNodeTypeId = (typeof FILM_NODE_TYPE_IDS)[number]

const storyboardIn: GraphPortDef = {
  id: 'in',
  direction: 'in',
  dataType: GraphPortType.storyboard,
  multiple: false,
  label: 'Storyboard'
}

const storyboardOut: GraphPortDef = {
  id: 'out',
  direction: 'out',
  dataType: GraphPortType.storyboard,
  multiple: true,
  label: 'Storyboard'
}

const castIn: GraphPortDef = {
  id: 'in-cast',
  direction: 'in',
  dataType: GraphPortType.filmCast,
  multiple: false,
  label: 'Cast',
  labelKey: 'graph.port.filmCastIn'
}

const textModelParams = (): Record<string, string> => ({
  generateInstruction: '',
  generateSystemPrompt: '',
  generateModel: '',
  generateProviderInstanceId: ''
})

export const FILM_NODE_TYPES: NodeTypeDefinition[] = [
  {
    typeId: 'film.workbench',
    category: 'note',
    label: 'Film workbench',
    icon: '🪄',
    defaultTitle: 'Film workbench',
    defaultSize: { ...ASSET_SIZE },
    sizeLimits: { ...ASSET_LIMITS },
    ports: [
      { id: 'in', direction: 'in', dataType: GraphPortType.text, multiple: true, label: 'Script' },
      {
        id: 'in-image',
        direction: 'in',
        dataType: GraphPortType.image,
        multiple: true,
        label: 'Reference',
        labelKey: 'graph.port.referenceImage'
      },
      storyboardOut,
      {
        id: 'out-cast',
        direction: 'out',
        dataType: GraphPortType.filmCast,
        multiple: true,
        label: 'Cast'
      },
      {
        id: 'out-sheets',
        direction: 'out',
        dataType: GraphPortType.images,
        multiple: true,
        label: 'Design sheets',
        labelKey: 'graph.port.filmDesignSheets'
      },
      {
        id: 'out-images',
        direction: 'out',
        dataType: GraphPortType.images,
        multiple: true,
        label: 'Keyframes',
        labelKey: 'graph.port.filmKeyframes'
      },
      {
        id: 'out-videos',
        direction: 'out',
        dataType: GraphPortType.videos,
        multiple: true,
        label: 'Clips',
        labelKey: 'graph.port.filmClips'
      },
      {
        id: 'out-text',
        direction: 'out',
        dataType: GraphPortType.text,
        multiple: true,
        label: 'Shot list',
        labelKey: 'graph.port.filmShotList'
      }
    ],
    defaultParams: () => ({
      ...textModelParams(),
      filmTextModel: '',
      filmTextProviderInstanceId: '',
      filmBreakdownInstruction: '',
      filmReviewInstruction: '',
      filmCastInstruction: '',
      generateAspectRatio: '',
      generateResolution: '',
      generateQuality: '',
      text: '',
      filmWorkbenchStage: 'breakdown',
      filmWorkbenchRunMode: '',
      filmStoryboard: '',
      filmSourceHash: '',
      filmForce: false,
      filmTargetShots: 0,
      filmShotDurationSec: 0,
      filmAspectRatio: '16:9',
      filmStyle: '',
      filmReviewMaxRounds: 2,
      filmReviewReport: '',
      filmReviewVerdict: '',
      filmCast: '',
      filmCastKinds: 'character,location',
      filmRenders: '',
      filmRenderMode: 'keyframe',
      filmShotRange: '',
      filmRenderContinuity: true,
      filmRenderQc: false,
      filmRenderMaxRetries: 1,
      filmVideoModel: '',
      filmVideoProviderInstanceId: '',
      filmQcModel: '',
      filmQcProviderInstanceId: '',
      mediaOutputDir: ''
    }),
    addable: true,
    deletable: true,
    inspector: 'none',
    inspectorId: 'studio.graph.film',
    card: 'media',
    contributeToGeneration: true,
    execute: executeFilmWorkbenchNode
  },
  {
    typeId: 'film.breakdown',
    category: 'note',
    label: 'Storyboard breakdown',
    icon: '🗂️',
    defaultTitle: 'Storyboard breakdown',
    defaultSize: { ...ASSET_SIZE },
    sizeLimits: { ...ASSET_LIMITS },
    ports: [
      { id: 'in', direction: 'in', dataType: GraphPortType.text, multiple: true, label: 'Script' },
      storyboardOut,
      {
        id: 'out-text',
        direction: 'out',
        dataType: GraphPortType.text,
        multiple: true,
        label: 'Shot list',
        labelKey: 'graph.port.filmShotList'
      }
    ],
    defaultParams: () => ({
      ...textModelParams(),
      text: '',
      filmStoryboard: '',
      filmSourceHash: '',
      filmForce: false,
      filmTargetShots: 0,
      filmShotDurationSec: 0,
      filmAspectRatio: '16:9',
      filmStyle: ''
    }),
    addable: false,
    deletable: true,
    inspector: 'none',
    inspectorId: 'studio.graph.film',
    card: 'media',
    contributeToGeneration: false,
    execute: executeFilmBreakdownNode
  },
  {
    typeId: 'film.review',
    category: 'note',
    label: 'Director review',
    icon: '🧐',
    defaultTitle: 'Director review',
    defaultSize: { ...ASSET_SIZE },
    sizeLimits: { ...ASSET_LIMITS },
    ports: [
      storyboardIn,
      {
        id: 'in-script',
        direction: 'in',
        dataType: GraphPortType.text,
        multiple: true,
        label: 'Script',
        labelKey: 'graph.port.filmScriptIn'
      },
      storyboardOut,
      {
        id: 'out-text',
        direction: 'out',
        dataType: GraphPortType.text,
        multiple: true,
        label: 'Report',
        labelKey: 'graph.port.filmReport'
      }
    ],
    defaultParams: () => ({
      ...textModelParams(),
      text: '',
      filmStoryboard: '',
      filmReviewMaxRounds: 2,
      filmReviewReport: '',
      filmReviewVerdict: ''
    }),
    addable: false,
    deletable: true,
    inspector: 'none',
    inspectorId: 'studio.graph.film',
    card: 'media',
    contributeToGeneration: false,
    execute: executeFilmReviewNode
  },
  {
    typeId: 'film.cast',
    category: 'note',
    label: 'Cast & locations',
    icon: '🎭',
    defaultTitle: 'Cast & locations',
    defaultSize: { ...ASSET_SIZE },
    sizeLimits: { ...ASSET_LIMITS },
    ports: [
      storyboardIn,
      {
        id: 'in-image',
        direction: 'in',
        dataType: GraphPortType.image,
        multiple: true,
        label: 'Reference',
        labelKey: 'graph.port.referenceImage'
      },
      {
        id: 'out',
        direction: 'out',
        dataType: GraphPortType.filmCast,
        multiple: true,
        label: 'Cast'
      },
      {
        id: 'out-sheets',
        direction: 'out',
        dataType: GraphPortType.images,
        multiple: true,
        label: 'Design sheets',
        labelKey: 'graph.port.filmDesignSheets'
      }
    ],
    defaultParams: () => ({
      generateInstruction: '',
      generateModel: '',
      generateProviderInstanceId: '',
      generateAspectRatio: '',
      generateResolution: '',
      text: '',
      filmCast: '',
      filmCastKinds: 'character,location',
      filmForce: false,
      mediaOutputDir: ''
    }),
    addable: false,
    deletable: true,
    inspector: 'none',
    inspectorId: 'studio.graph.film',
    card: 'media',
    contributeToGeneration: false,
    execute: executeFilmCastNode
  },
  {
    typeId: 'film.shot',
    category: 'note',
    label: 'Shot',
    icon: '📷',
    defaultTitle: 'Shot',
    defaultSize: { ...ASSET_SIZE },
    sizeLimits: { ...ASSET_LIMITS },
    ports: [
      storyboardIn,
      castIn,
      {
        id: 'out',
        direction: 'out',
        dataType: GraphPortType.text,
        multiple: true,
        label: 'Keyframe prompt',
        labelKey: 'graph.port.filmKeyframePrompt'
      },
      {
        id: 'out-motion',
        direction: 'out',
        dataType: GraphPortType.text,
        multiple: true,
        label: 'Motion prompt',
        labelKey: 'graph.port.filmMotionPrompt'
      },
      {
        // 类型用单数 image：可直接接图片 / 视频生成节点的参考图口；值里携带该镜全部出场设定图
        id: 'out-refs',
        direction: 'out',
        dataType: GraphPortType.image,
        multiple: true,
        label: 'Cast refs',
        labelKey: 'graph.port.filmCastRefs'
      }
    ],
    defaultParams: () => ({ text: '', filmShotRef: '1' }),
    addable: true,
    deletable: true,
    inspector: 'none',
    inspectorId: 'studio.graph.film',
    card: 'media',
    contributeToGeneration: false,
    execute: executeFilmShotNode
  },
  {
    typeId: 'film.render',
    category: 'note',
    label: 'Batch shoot',
    icon: '🪄',
    defaultTitle: 'Batch shoot',
    defaultSize: { ...ASSET_SIZE },
    sizeLimits: { ...ASSET_LIMITS },
    ports: [
      storyboardIn,
      castIn,
      storyboardOut,
      {
        id: 'out-images',
        direction: 'out',
        dataType: GraphPortType.images,
        multiple: true,
        label: 'Keyframes',
        labelKey: 'graph.port.filmKeyframes'
      },
      {
        id: 'out-videos',
        direction: 'out',
        dataType: GraphPortType.videos,
        multiple: true,
        label: 'Clips',
        labelKey: 'graph.port.filmClips'
      }
    ],
    defaultParams: () => ({
      generateInstruction: '',
      generateModel: '',
      generateProviderInstanceId: '',
      generateAspectRatio: '',
      generateResolution: '',
      generateQuality: '',
      text: '',
      filmRenders: '',
      filmRenderMode: 'keyframe',
      filmShotRange: '',
      filmRenderContinuity: true,
      filmRenderQc: false,
      filmRenderMaxRetries: 1,
      filmForce: false,
      filmVideoModel: '',
      filmVideoProviderInstanceId: '',
      filmQcModel: '',
      filmQcProviderInstanceId: '',
      mediaOutputDir: ''
    }),
    addable: false,
    deletable: true,
    inspector: 'none',
    inspectorId: 'studio.graph.film',
    card: 'media',
    contributeToGeneration: true,
    execute: executeFilmRenderNode
  }
]

export function isFilmNodeTypeId(typeId: string | undefined | null): typeId is FilmNodeTypeId {
  return !!typeId && (FILM_NODE_TYPE_IDS as readonly string[]).includes(typeId)
}
