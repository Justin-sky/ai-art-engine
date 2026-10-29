import { COMIC_LAYOUT_TEMPLATES, createComicPage, parseComicPage } from './comicPage'
import { DEFAULT_EMOTION_PAD, EMOTION_GRID } from './emotionPad'
import { emptyFilmStoryboard, parseFilmCast, parseFilmStoryboard } from './film/storyboard'
import { DEFAULT_ICON_PACK } from './iconPack'
import { DEFAULT_IMAGE_ALIGN, IMAGE_ALIGN_SIZE_PRESETS } from './imageAlign'
import { DEFAULT_IMAGE_COMPOSE } from './imageCompose'
import { CROP_ASPECT_PRESETS, DEFAULT_IMAGE_CROP } from './imageCrop'
import { DEFAULT_IMAGE_CUTOUT } from './imageCutout'
import { DEFAULT_IMAGE_ERASE } from './imageErase'
import { DEFAULT_IMAGE_EXPAND } from './imageExpand'
import { DEFAULT_IMAGE_GRID_SPLIT, GRID_SPLIT_PRESETS } from './imageGridSplit'
import { DEFAULT_IMAGE_LAYER_SPLIT, UI_LAYER_SPLIT_MODES } from './imageLayerSplit'
import { DEFAULT_IMAGE_MATTE } from './imageMatte'
import { DEFAULT_IMAGE_REDRAW } from './imageRedraw'
import {
  DEFAULT_IMAGE_TRANSFORM,
  IMAGE_TRANSFORM_ASPECTS,
  IMAGE_TRANSFORM_FILLS,
  IMAGE_TRANSFORM_SIZES
} from './imageTransform'
import { DEFAULT_IMAGE_UPSCALE, UPSCALE_SCALES, UPSCALE_VARIANTS } from './imageUpscale'
import { DEFAULT_LIGHTING_SETUP, LIGHTING_DIRECTIONS, LIGHTING_PRESETS } from './lightingSetup'
import { DEFAULT_MULTI_ANGLE_CAMERA, MULTI_ANGLE_PRESETS } from './multiAngleCamera'
import { defaultPortraitRetouch, PORTRAIT_PARAM_SPECS, PORTRAIT_PRESETS } from './portraitRetouch'
import { DEFAULT_PORTRAIT_TEXTURE, PORTRAIT_TEXTURE_FIELDS } from './portraitTexture'
import { getNodeType, listNodeTypes, resolveNodeType, type NodeTypeDefinition } from './registry'
import { createDefaultStage2dScene } from './stage2d'
import { STAGE2D_ACTION_PRESETS } from '../gameAssets/stage2dActionPresets'
import { createMxTemplate, MX_TEMPLATES, parseMxDocumentJson } from '../gameAssets/machinationsV2'
import type {
  GraphInspectorKind,
  GraphNode,
  GraphNodeCategory,
  GraphNodeParams,
  GraphPortDef
} from './types'

export type NodeParamValueType =
  'string' | 'number' | 'boolean' | 'enum' | 'object' | 'array' | 'json-string' | 'unknown'

export interface NodeParamFieldSchema {
  /** 完整点路径，例如 "prompt"、"portraitRetouch.skinSmoothing"、"filmStoryboard.shots[].action" */
  path: string
  /** 当前层级键名 */
  key: string
  /** 字段值类型 */
  type: NodeParamValueType
  /** 人类/Agent 可读说明 */
  label?: string
  description?: string
  /** 默认值示例 */
  defaultValue?: unknown
  /** 可选枚举值列表 */
  enumValues?: Array<string | number>
  /** 数值范围 */
  min?: number
  max?: number
  step?: number
  /** 对象子字段（含 json-string 解析后的内部结构） */
  children?: Record<string, NodeParamFieldSchema>
  /** 数组元素结构 */
  itemSchema?: NodeParamFieldSchema
}

export interface NodePresetSchema {
  id: string
  label: string
  description?: string
  category?: string
}

export interface NodeIntrospectedSchema {
  typeId: string
  category: GraphNodeCategory
  label: string
  defaultTitle: string
  description?: string
  inspector: GraphInspectorKind
  inspectorId?: string
  ports: GraphPortDef[]
  /** 顶层与嵌套参数树 */
  fields: Record<string, NodeParamFieldSchema>
  /** 扁平化的所有可编辑点路径列表 */
  flatPaths: string[]
  /**
   * 简写属性名到完整路径的自动路由映射（例如 "skinSmoothing" -> "portraitRetouch.skinSmoothing"）。
   * 仅当叶子名在当前节点内唯一或指向主控子文档时收录。
   */
  shorthandMap: Record<string, string>
  /** 当前节点可用的一键预设列表 */
  presets: NodePresetSchema[]
  /** 若该节点支持双击 Dive 进入子视图，标记其 Dive 类型 */
  diveKind?: 'stage3d' | 'stage2d' | 'subgraph'
}

/** 节点顶层通用可写属性说明（除 params 以外） */
export const NODE_TOP_LEVEL_EDITABLE_FIELDS: Record<string, NodeParamFieldSchema> = {
  title: {
    path: 'title',
    key: 'title',
    type: 'string',
    label: '节点标题 / Title',
    description: '画布与检查器顶部显示的节点名称'
  },
  x: {
    path: 'x',
    key: 'x',
    type: 'number',
    label: '画布 X 坐标'
  },
  y: {
    path: 'y',
    key: 'y',
    type: 'number',
    label: '画布 Y 坐标'
  },
  w: {
    path: 'w',
    key: 'w',
    type: 'number',
    label: '节点宽度'
  },
  h: {
    path: 'h',
    key: 'h',
    type: 'number',
    label: '节点高度'
  },
  locked: {
    path: 'locked',
    key: 'locked',
    type: 'boolean',
    label: '锁定状态 / Locked'
  }
}

function formatBilingualLabel(item: unknown): string {
  if (typeof item === 'string') return item
  if (!item || typeof item !== 'object') return String(item ?? '')
  const rec = item as Record<string, any>
  if (rec.label && typeof rec.label === 'object') {
    return [rec.label.zh, rec.label.en].filter(Boolean).join(' / ')
  }
  if (typeof rec.label === 'string' && rec.label) {
    return rec.label
  }
  if (rec.name && typeof rec.name === 'object') {
    return [rec.name.zh, rec.name.en].filter(Boolean).join(' / ')
  }
  if (typeof rec.name === 'string' && rec.name) {
    return rec.name
  }
  if (typeof rec.zh === 'string' || typeof rec.en === 'string') {
    return [rec.zh, rec.en].filter(Boolean).join(' / ')
  }
  if (typeof rec.title === 'string' && rec.title) {
    return rec.title
  }
  if (typeof rec.titleKey === 'string' && rec.titleKey) {
    return rec.titleKey
  }
  if (typeof rec.labelKey === 'string' && rec.labelKey) {
    return rec.labelKey
  }
  return String(rec.id ?? rec.key ?? '')
}

/**
 * 已知子文档或 JSON 字符串参数的静态增强元数据（提供枚举、范围、预设和深层样本）。
 * 即使未来新增未知子文档或新字段，反射器也会通过 `reflectValueToFieldSchema` 自动兜底提取。
 */
function buildKnownSubDocPrototype(key: string): {
  sample?: unknown
  isJsonString?: boolean
  fieldOverrides?: Record<string, Partial<NodeParamFieldSchema>>
  presets?: NodePresetSchema[]
} | null {
  switch (key) {
    case 'multiAngleCamera':
      return {
        sample: DEFAULT_MULTI_ANGLE_CAMERA,
        fieldOverrides: {
          'multiAngleCamera.yaw': {
            min: -180,
            max: 180,
            step: 1,
            description: '水平环绕角度 (-180 ~ 180)'
          },
          'multiAngleCamera.pitch': {
            min: -89,
            max: 89,
            step: 1,
            description: '俯仰角度 (-89 ~ 89)'
          },
          'multiAngleCamera.shotScale': {
            min: 0,
            max: 1,
            step: 0.05,
            description: '景别缩放 (0 全景 ~ 0.5 中景 ~ 1 特写)'
          }
        },
        presets: MULTI_ANGLE_PRESETS.map((p) => ({
          id: p.id,
          label: formatBilingualLabel(p),
          category: 'multiAngleCamera'
        }))
      }
    case 'lightingSetup':
      return {
        sample: DEFAULT_LIGHTING_SETUP,
        fieldOverrides: {
          'lightingSetup.yaw': {
            min: -180,
            max: 180,
            step: 1,
            description: '光源水平方位角 (-180 ~ 180)'
          },
          'lightingSetup.pitch': {
            min: -60,
            max: 60,
            step: 1,
            description: '光源俯仰角 (-60 ~ 60)'
          },
          'lightingSetup.brightness': {
            min: 0,
            max: 100,
            step: 1,
            description: '主光亮度 (0 ~ 100)'
          }
        },
        presets: [
          ...LIGHTING_PRESETS.map((p) => ({
            id: p.id,
            label: formatBilingualLabel(p),
            category: 'lightingPreset'
          })),
          ...LIGHTING_DIRECTIONS.map((d) => ({
            id: typeof d === 'string' ? d : (d as any).id,
            label: formatBilingualLabel(d),
            category: 'lightingDirection'
          }))
        ]
      }
    case 'portraitRetouch': {
      const overrides: Record<string, Partial<NodeParamFieldSchema>> = {}
      for (const spec of PORTRAIT_PARAM_SPECS) {
        const enumVals = Array.isArray((spec as any).tiers)
          ? [...(spec as any).tiers]
          : Array.isArray((spec as any).options)
            ? (spec as any).options.map((o: any) => (typeof o === 'string' ? o : (o.value ?? o.id)))
            : undefined
        overrides[`portraitRetouch.${spec.key}`] = {
          ...(enumVals ? { type: 'enum', enumValues: enumVals } : {}),
          label: formatBilingualLabel(spec)
        }
      }
      return {
        sample: defaultPortraitRetouch(),
        fieldOverrides: overrides,
        presets: PORTRAIT_PRESETS.map((p) => ({
          id: p.id,
          label: formatBilingualLabel(p),
          category: 'portraitRetouch'
        }))
      }
    }
    case 'portraitTexture': {
      const overrides: Record<string, Partial<NodeParamFieldSchema>> = {}
      for (const f of PORTRAIT_TEXTURE_FIELDS) {
        overrides[`portraitTexture.${f.field}`] = {
          min: 0,
          max: 100,
          step: 1,
          label: formatBilingualLabel(f)
        }
      }
      return {
        sample: DEFAULT_PORTRAIT_TEXTURE,
        fieldOverrides: overrides
      }
    }
    case 'emotionPad':
      return {
        sample: DEFAULT_EMOTION_PAD,
        fieldOverrides: {
          'emotionPad.gridX': {
            min: 0,
            max: 4,
            step: 1,
            description: '亲疏度坐标 X (0 亲近 ~ 4 疏离)'
          },
          'emotionPad.gridY': {
            min: 0,
            max: 4,
            step: 1,
            description: '激动度坐标 Y (0 平静 ~ 4 激动)'
          }
        },
        presets: EMOTION_GRID.flatMap((row, gridY) =>
          row.map((cell, gridX) => ({
            id: `${gridX},${gridY}`,
            label: cell.label,
            description: cell.prompt,
            category: 'emotionPad'
          }))
        )
      }
    case 'imageCrop':
      return {
        sample: DEFAULT_IMAGE_CROP,
        fieldOverrides: {
          'imageCrop.aspectId': {
            type: 'enum',
            enumValues: [...CROP_ASPECT_PRESETS]
          },
          'imageCrop.cropX': { min: 0, max: 0.95, step: 0.01 },
          'imageCrop.cropY': { min: 0, max: 0.95, step: 0.01 },
          'imageCrop.cropW': { min: 0.05, max: 1, step: 0.01 },
          'imageCrop.cropH': { min: 0.05, max: 1, step: 0.01 }
        },
        presets: CROP_ASPECT_PRESETS.map((p) => ({
          id: typeof p === 'string' ? p : (p as any).id,
          label: formatBilingualLabel(p),
          category: 'imageCrop'
        }))
      }
    case 'imageTransform':
      return {
        sample: DEFAULT_IMAGE_TRANSFORM,
        fieldOverrides: {
          'imageTransform.aspectPreset': {
            type: 'enum',
            enumValues: [...IMAGE_TRANSFORM_ASPECTS]
          },
          'imageTransform.sizePreset': {
            type: 'enum',
            enumValues: [...IMAGE_TRANSFORM_SIZES]
          },
          'imageTransform.fill': {
            type: 'enum',
            enumValues: [...IMAGE_TRANSFORM_FILLS]
          },
          'imageTransform.scale': { min: 0.1, max: 4, step: 0.05 },
          'imageTransform.offsetX': { min: -1, max: 1, step: 0.01 },
          'imageTransform.offsetY': { min: -1, max: 1, step: 0.01 },
          'imageTransform.rotate': { type: 'enum', enumValues: [0, 90, 180, 270] }
        }
      }
    case 'imageExpand':
      return {
        sample: DEFAULT_IMAGE_EXPAND,
        fieldOverrides: {
          'imageExpand.aspect': {
            type: 'enum',
            enumValues: ['free', '1:1', '3:4', '4:3', '9:16', '16:9', '21:9']
          },
          'imageExpand.top': { min: 0, max: 2, step: 0.05 },
          'imageExpand.bottom': { min: 0, max: 2, step: 0.05 },
          'imageExpand.left': { min: 0, max: 2, step: 0.05 },
          'imageExpand.right': { min: 0, max: 2, step: 0.05 }
        }
      }
    case 'imageUpscale':
      return {
        sample: DEFAULT_IMAGE_UPSCALE,
        fieldOverrides: {
          'imageUpscale.variantId': {
            type: 'enum',
            enumValues: UPSCALE_VARIANTS.map((v) => v.id)
          },
          'imageUpscale.scale': {
            type: 'enum',
            enumValues: [...UPSCALE_SCALES]
          }
        },
        presets: UPSCALE_VARIANTS.map((v) => ({
          id: v.id,
          label: formatBilingualLabel(v),
          category: 'imageUpscale'
        }))
      }
    case 'imageCutout':
      return {
        sample: DEFAULT_IMAGE_CUTOUT,
        fieldOverrides: {
          'imageCutout.mode': {
            type: 'enum',
            enumValues: ['auto', 'keep-subject', 'remove-subject']
          },
          'imageCutout.feather': { min: 0, max: 20, step: 1 },
          'imageCutout.threshold': { min: 0, max: 100, step: 1 },
          'imageCutout.bgPreview': {
            type: 'enum',
            enumValues: ['checker', 'white', 'black', 'green']
          }
        }
      }
    case 'imageCompose':
      return {
        sample: DEFAULT_IMAGE_COMPOSE,
        fieldOverrides: {
          'imageCompose.fgScale': { min: 0.1, max: 3, step: 0.05 },
          'imageCompose.fgX': { min: -1, max: 1, step: 0.02 },
          'imageCompose.fgY': { min: -1, max: 1, step: 0.02 },
          'imageCompose.fgOpacity': { min: 0, max: 1, step: 0.05 },
          'imageCompose.feather': { min: 0, max: 40, step: 1 },
          'imageCompose.harmonize': { type: 'boolean' }
        }
      }
    case 'imageAlign':
      return {
        sample: DEFAULT_IMAGE_ALIGN,
        fieldOverrides: {
          'imageAlign.canvasWidth': { min: 64, max: 4096, step: 8 },
          'imageAlign.canvasHeight': { min: 64, max: 4096, step: 8 },
          'imageAlign.anchor': { type: 'enum', enumValues: ['center', 'ground'] },
          'imageAlign.contentHeightRatio': { min: 0.1, max: 1, step: 0.05 },
          'imageAlign.groundRatio': { min: 0, max: 0.5, step: 0.01 },
          'imageAlign.fitWithinWidth': { type: 'boolean' }
        },
        presets: IMAGE_ALIGN_SIZE_PRESETS.map((p) => ({
          id: p.id,
          label: formatBilingualLabel(p),
          category: 'imageAlign'
        }))
      }
    case 'imageRedraw':
      return {
        sample: DEFAULT_IMAGE_REDRAW,
        fieldOverrides: {
          'imageRedraw.mode': { type: 'enum', enumValues: ['rect', 'lasso', 'brush'] },
          'imageRedraw.strength': { min: 0, max: 100, step: 1 },
          'imageRedraw.feather': { min: 0, max: 60, step: 1 }
        }
      }
    case 'imageErase':
      return {
        sample: DEFAULT_IMAGE_ERASE,
        fieldOverrides: {
          'imageErase.mode': { type: 'enum', enumValues: ['rect', 'lasso', 'brush'] },
          'imageErase.feather': { min: 0, max: 60, step: 1 },
          'imageErase.contextHint': { type: 'string' }
        }
      }
    case 'imageMatte':
      return {
        sample: DEFAULT_IMAGE_MATTE,
        fieldOverrides: {
          'imageMatte.keyColor': { type: 'enum', enumValues: ['green', 'blue', 'custom'] },
          'imageMatte.tolerance': { min: 0, max: 100, step: 1 },
          'imageMatte.softness': { min: 0, max: 100, step: 1 },
          'imageMatte.despill': { min: 0, max: 100, step: 1 }
        }
      }
    case 'imageGridSplit':
      return {
        sample: DEFAULT_IMAGE_GRID_SPLIT,
        fieldOverrides: {
          'imageGridSplit.rows': { min: 1, max: 6, step: 1 },
          'imageGridSplit.cols': { min: 1, max: 6, step: 1 }
        },
        presets: GRID_SPLIT_PRESETS.map((p) => ({
          id: `${p.rows}x${p.cols}`,
          label: formatBilingualLabel(p),
          category: 'imageGridSplit'
        }))
      }
    case 'iconPack':
      return {
        sample: DEFAULT_ICON_PACK,
        fieldOverrides: {
          'iconPack.rows': { min: 1, max: 6, step: 1 },
          'iconPack.cols': { min: 1, max: 6, step: 1 },
          'iconPack.keyMode': {
            type: 'enum',
            enumValues: ['auto-corner', 'green', 'white', 'black', 'custom']
          },
          'iconPack.tolerance': { min: 1, max: 100, step: 1 },
          'iconPack.softness': { min: 0, max: 50, step: 1 },
          'iconPack.paddingRatio': { min: 0, max: 0.3, step: 0.01 },
          'iconPack.outputSize': { type: 'enum', enumValues: [0, 128, 256, 512] }
        }
      }
    case 'imageLayerSplit':
      return {
        sample: DEFAULT_IMAGE_LAYER_SPLIT,
        fieldOverrides: {
          'imageLayerSplit.uiMode': {
            type: 'enum',
            enumValues: [...UI_LAYER_SPLIT_MODES]
          },
          'imageLayerSplit.layerCount': { min: 2, max: 8, step: 1 },
          'imageLayerSplit.selectedLayer': { min: 0, max: 7, step: 1 },
          'imageLayerSplit.exportAll': { type: 'boolean' }
        }
      }
    case 'stage2dScene':
      return {
        sample: createDefaultStage2dScene(),
        presets: STAGE2D_ACTION_PRESETS.map((p) => ({
          id: p.id,
          label: `${p.id} (${p.duration ?? 0}s)`,
          category: 'stage2dAction'
        }))
      }
    case 'comicPage':
      return {
        sample: {
          ...createComicPage(),
          readingDirection: 'ltr',
          panels: [
            {
              id: 'panel-1',
              row: 0,
              col: 0,
              rowSpan: 1,
              colSpan: 1,
              title: '',
              caption: '',
              bubbles: [
                {
                  id: 'bubble-1',
                  text: '',
                  x: 0.5,
                  y: 0.2,
                  tail: 'bl'
                }
              ]
            }
          ]
        },
        isJsonString: true,
        fieldOverrides: {
          'comicPage.readingDirection': {
            type: 'enum',
            enumValues: ['ltr', 'rtl']
          }
        },
        presets: COMIC_LAYOUT_TEMPLATES.map((t) => ({
          id: t.id,
          label: formatBilingualLabel(t),
          category: 'comicTemplate'
        }))
      }
    case 'filmStoryboard':
      return {
        sample: {
          ...emptyFilmStoryboard(),
          shots: [
            {
              id: 'S01-01',
              order: 1,
              sceneId: 'scene-1',
              title: '',
              shotSize: 'MS',
              angle: '',
              cameraMove: '',
              durationSec: 4,
              characters: [''],
              location: '',
              props: [''],
              action: '',
              dialogue: [{ speaker: '', line: '', tone: '' }],
              sound: '',
              transition: '',
              imagePrompt: '',
              videoPrompt: '',
              status: 'draft'
            }
          ]
        },
        isJsonString: true
      }
    case 'filmCast':
      return {
        sample: {
          schema: 'aiart.film-cast@1',
          style: '',
          entries: [
            {
              id: 'character-1',
              kind: 'character',
              name: '',
              description: '',
              imageRelativePath: '',
              imageUrl: '',
              locked: false
            }
          ]
        },
        isJsonString: true
      }
    case 'gameEconomyPreset':
      return {
        fieldOverrides: {
          gameEconomyPreset: {
            type: 'enum',
            enumValues: MX_TEMPLATES.map((t) => t.id),
            description: 'Machinations 游戏经济系统模板预设'
          }
        },
        presets: MX_TEMPLATES.map((t) => ({
          id: t.id,
          label: `${t.nameZh} / ${t.nameEn}`,
          description: `${t.descZh} (${t.descEn})`,
          category: 'gameEconomyPreset'
        }))
      }
    case 'gameEconomyDiagramJson':
      return {
        sample: {
          ...createMxTemplate('roguelike_run'),
          agents: [
            {
              id: 'agent_1',
              name: 'Rational Player',
              enabled: true,
              personality: 'rational',
              goals: [
                {
                  id: 'goal_1',
                  nodeId: 'gold',
                  targetFormula: '100',
                  importance: 'high',
                  continuePastTarget: true,
                  trajectory: 'upwards',
                  utilityCurve: 'linear'
                }
              ],
              controlledNodeIds: [],
              actionsPerStep: 1,
              lookaheadHorizon: 2
            }
          ]
        },
        isJsonString: true,
        fieldOverrides: {
          'gameEconomyDiagramJson.nodes[].kind': {
            type: 'enum',
            enumValues: [
              'source',
              'pool',
              'drain',
              'converter',
              'gate',
              'trader',
              'register',
              'delay',
              'queue',
              'end',
              'note'
            ]
          },
          'gameEconomyDiagramJson.nodes[].trigger': {
            type: 'enum',
            enumValues: ['passive', 'automatic', 'interactive', 'enabling']
          },
          'gameEconomyDiagramJson.nodes[].pullMode': {
            type: 'enum',
            enumValues: ['pull_any', 'pull_all', 'push_any', 'push_all']
          },
          'gameEconomyDiagramJson.nodes[].gateMode': {
            type: 'enum',
            enumValues: ['random', 'deterministic', 'skill']
          },
          'gameEconomyDiagramJson.edges[].kind': {
            type: 'enum',
            enumValues: ['resource', 'state']
          }
        },
        presets: MX_TEMPLATES.map((t) => ({
          id: t.id,
          label: `${t.nameZh} / ${t.nameEn}`,
          description: `${t.descZh} (${t.descEn})`,
          category: 'gameEconomyPreset'
        }))
      }
    default:
      return null
  }
}

function tryParseJsonObjectOrArray(raw: string): unknown | null {
  const trimmed = raw.trim()
  if (
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  ) {
    try {
      return JSON.parse(trimmed)
    } catch {
      return null
    }
  }
  return null
}

/**
 * 递归反射任意运行时值为结构化 `NodeParamFieldSchema`。
 */
export function reflectValueToFieldSchema(
  key: string,
  value: unknown,
  parentPath = '',
  overrides?: Record<string, Partial<NodeParamFieldSchema>>,
  skipJsonStringUnwrap = false
): NodeParamFieldSchema {
  const path = parentPath ? `${parentPath}.${key}` : key
  const knownProto = !parentPath ? buildKnownSubDocPrototype(key) : null
  const mergedOverrides = {
    ...(knownProto?.fieldOverrides ?? {}),
    ...(overrides ?? {})
  }
  const directOverride = mergedOverrides[path] ?? {}

  // 若是已知 JSON-string 参数（如 comicPage / filmStoryboard / filmCast）或值为合法 JSON 字符串
  if (!skipJsonStringUnwrap && knownProto?.isJsonString) {
    let parsed: unknown = knownProto.sample
    if (typeof value === 'string' && value.trim()) {
      if (key === 'comicPage') parsed = parseComicPage(value) ?? knownProto.sample
      else if (key === 'filmStoryboard') {
        const sb = parseFilmStoryboard(value)
        parsed = sb && sb.shots.length > 0 ? sb : knownProto.sample
      } else if (key === 'filmCast') {
        const cast = parseFilmCast(value)
        parsed = cast && cast.entries.length > 0 ? cast : knownProto.sample
      } else if (key === 'gameEconomyDiagramJson') {
        parsed = parseMxDocumentJson(value) ?? knownProto.sample
      } else {
        parsed = tryParseJsonObjectOrArray(value) ?? knownProto.sample
      }
    }
    const reflectedInner = reflectValueToFieldSchema(key, parsed, parentPath, mergedOverrides, true)
    return {
      ...reflectedInner,
      type: 'json-string',
      ...directOverride
    }
  }

  if (typeof value === 'string') {
    const dynamicParsed = tryParseJsonObjectOrArray(value)
    if (dynamicParsed && typeof dynamicParsed === 'object') {
      const inner = reflectValueToFieldSchema(key, dynamicParsed, parentPath, mergedOverrides)
      return {
        ...inner,
        type: 'json-string',
        ...directOverride
      }
    }
    return {
      path,
      key,
      type: 'string',
      defaultValue: value,
      ...directOverride
    }
  }

  if (typeof value === 'number') {
    return {
      path,
      key,
      type: 'number',
      defaultValue: value,
      ...directOverride
    }
  }

  if (typeof value === 'boolean') {
    return {
      path,
      key,
      type: 'boolean',
      defaultValue: value,
      ...directOverride
    }
  }

  const effectiveObj = value !== undefined && value !== null ? value : (knownProto?.sample ?? value)

  if (Array.isArray(effectiveObj)) {
    const sampleItem =
      effectiveObj.length > 0
        ? effectiveObj[0]
        : knownProto?.sample && Array.isArray(knownProto.sample)
          ? knownProto.sample[0]
          : undefined
    const itemSchema =
      sampleItem !== undefined
        ? reflectValueToFieldSchema('[]', sampleItem, path, mergedOverrides)
        : undefined
    return {
      path,
      key,
      type: 'array',
      defaultValue: effectiveObj,
      itemSchema,
      ...directOverride
    }
  }

  if (effectiveObj && typeof effectiveObj === 'object') {
    const protoObj =
      knownProto?.sample &&
      typeof knownProto.sample === 'object' &&
      !Array.isArray(knownProto.sample)
        ? (knownProto.sample as Record<string, unknown>)
        : {}
    const mergedObj: Record<string, unknown> = {
      ...protoObj,
      ...(effectiveObj as Record<string, unknown>)
    }
    const children: Record<string, NodeParamFieldSchema> = {}
    for (const [childKey, childVal] of Object.entries(mergedObj)) {
      children[childKey] = reflectValueToFieldSchema(childKey, childVal, path, mergedOverrides)
    }
    return {
      path,
      key,
      type: 'object',
      children,
      ...directOverride
    }
  }

  return {
    path,
    key,
    type: 'unknown',
    defaultValue: value,
    ...directOverride
  }
}

function collectFlatPathsAndShorthands(fields: Record<string, NodeParamFieldSchema>): {
  flatPaths: string[]
  shorthandMap: Record<string, string>
} {
  const flatPaths: string[] = []
  const leafCandidates = new Map<string, string[]>()

  function walk(field: NodeParamFieldSchema): void {
    flatPaths.push(field.path)
    if (field.path.includes('.') && !field.path.includes('[]') && field.key !== '[]') {
      const list = leafCandidates.get(field.key) ?? []
      list.push(field.path)
      leafCandidates.set(field.key, list)
    }
    if (field.children) {
      for (const child of Object.values(field.children)) {
        walk(child)
      }
    } else if (field.itemSchema) {
      walk(field.itemSchema)
    }
  }

  for (const f of Object.values(fields)) {
    walk(f)
  }

  const shorthandMap: Record<string, string> = {}
  for (const [leafKey, paths] of leafCandidates.entries()) {
    // 若顶层本身没有同名字段且子路径唯一，则自动建立简写路由
    if (!fields[leafKey] && paths.length === 1) {
      shorthandMap[leafKey] = paths[0]
    }
  }

  return { flatPaths, shorthandMap }
}

function detectNodeDiveKind(
  typeId: string,
  params: GraphNodeParams
): 'stage3d' | 'stage2d' | 'subgraph' | undefined {
  if (typeId === 'stage3d.scene') return 'stage3d'
  if (typeId === 'stage2d.scene') return 'stage2d'
  const rawAssetId = (params as Record<string, unknown>).assetId
  if (typeof rawAssetId === 'string' && rawAssetId.trim() && typeId.startsWith('asset.')) {
    return 'subgraph'
  }
  return undefined
}

/**
 * 从节点定义与实时参数构建完整的自省 Schema。
 * 新增节点或修改 defaultParams 时无需手工维护清单即可 100% 自动感知。
 */
export function buildNodeSchemaFromDefAndParams(
  def: NodeTypeDefinition,
  liveParams?: GraphNodeParams
): NodeIntrospectedSchema {
  const defaults = def.defaultParams ? def.defaultParams() : {}
  const mergedParams: GraphNodeParams = {
    ...defaults,
    ...(liveParams ?? {})
  }

  const fields: Record<string, NodeParamFieldSchema> = {}
  const presets: NodePresetSchema[] = [...(def.presets ?? [])]
  const customFieldOverrides = def.paramSchema ?? {}

  for (const [key, val] of Object.entries(mergedParams)) {
    const knownProto = buildKnownSubDocPrototype(key)
    if (knownProto?.presets) {
      for (const p of knownProto.presets) {
        if (!presets.some((existing) => existing.id === p.id && existing.category === p.category)) {
          presets.push(p)
        }
      }
    }
    fields[key] = reflectValueToFieldSchema(key, val, '', customFieldOverrides)
  }

  // 若节点定义显式声明了额外 paramSchema 字段（即便 defaultParams 未返回），也合并进来
  for (const [customPath, customOverride] of Object.entries(customFieldOverrides)) {
    if (!customPath.includes('.') && !fields[customPath]) {
      fields[customPath] = {
        path: customPath,
        key: customPath,
        type: customOverride.type ?? 'string',
        ...customOverride
      }
    }
  }

  const { flatPaths, shorthandMap } = collectFlatPathsAndShorthands(fields)

  return {
    typeId: def.typeId,
    category: def.category,
    label: def.label,
    defaultTitle: def.defaultTitle,
    description: def.description,
    inspector: def.inspector,
    inspectorId: def.inspectorId,
    ports: def.ports,
    fields,
    flatPaths,
    shorthandMap,
    presets,
    diveKind: detectNodeDiveKind(def.typeId, mergedParams)
  }
}

/**
 * 按节点 typeId 自省其完整参数结构、约束与预设。
 */
export function introspectNodeType(typeId: string): NodeIntrospectedSchema | undefined {
  listNodeTypes()
  const def = getNodeType(typeId)
  if (!def) return undefined
  return buildNodeSchemaFromDefAndParams(def)
}

/**
 * 按实时 GraphNode 实例自省其完整参数结构（包含运行时动态挂载的自定义或嵌套属性）。
 */
export function introspectNodeInstance(
  node: Pick<GraphNode, 'typeId' | 'category' | 'assetType' | 'params'>
): NodeIntrospectedSchema | undefined {
  const def = resolveNodeType(node)
  if (!def) return undefined
  return buildNodeSchemaFromDefAndParams(def, node.params)
}

/**
 * 列出所有已注册节点类型的自省 Schema。
 */
export function introspectAllNodeTypes(): NodeIntrospectedSchema[] {
  return listNodeTypes().map((def) => buildNodeSchemaFromDefAndParams(def))
}
