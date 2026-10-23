import {
  applyComicLayoutTemplate,
  COMIC_LAYOUT_TEMPLATES,
  createComicPage,
  normalizeComicPage,
  parseComicPage,
  serializeComicPage
} from './comicPage'
import { EMOTION_GRID, emotionPadToNodePatch, normalizeEmotionPad } from './emotionPad'
import {
  emptyFilmStoryboard,
  FILM_CAST_SCHEMA,
  parseFilmCast,
  parseFilmStoryboard,
  stringifyFilmCast,
  stringifyFilmStoryboard
} from './film/storyboard'
import { iconPackToNodePatch, normalizeIconPackState } from './iconPack'
import { IMAGE_ALIGN_SIZE_PRESETS, imageAlignToNodePatch, normalizeImageAlign } from './imageAlign'
import { imageComposeToNodePatch, normalizeImageCompose } from './imageCompose'
import { CROP_ASPECT_PRESETS, imageCropToNodePatch, normalizeImageCrop } from './imageCrop'
import { imageCutoutToNodePatch, normalizeImageCutout } from './imageCutout'
import { imageEraseToNodePatch, normalizeImageErase } from './imageErase'
import { normalizeImageExpand } from './imageExpand'
import {
  GRID_SPLIT_PRESETS,
  imageGridSplitToNodePatch,
  normalizeImageGridSplit
} from './imageGridSplit'
import { imageLayerSplitToNodePatch, normalizeImageLayerSplit } from './imageLayerSplit'
import { imageMatteToNodePatch, normalizeImageMatte } from './imageMatte'
import { imageRedrawToNodePatch, normalizeImageRedraw } from './imageRedraw'
import { imageTransformToNodePatch, normalizeImageTransform } from './imageTransform'
import { imageUpscaleToNodePatch, normalizeImageUpscale, UPSCALE_VARIANTS } from './imageUpscale'
import { introspectNodeInstance, type NodeIntrospectedSchema } from './introspection'
import {
  applyLightingDirection,
  applyLightingPreset,
  LIGHTING_DIRECTIONS,
  LIGHTING_PRESETS,
  lightingSetupToNodePatch,
  normalizeLightingSetup
} from './lightingSetup'
import {
  applyMultiAnglePreset,
  MULTI_ANGLE_PRESETS,
  multiAngleCameraToNodePatch,
  normalizeMultiAngleCamera
} from './multiAngleCamera'
import {
  applyPortraitPreset,
  normalizePortraitRetouch,
  PORTRAIT_PRESETS,
  portraitRetouchToNodePatch
} from './portraitRetouch'
import { normalizePortraitTexture, portraitTextureToNodePatch } from './portraitTexture'
import { resolveNodeType } from './registry'
import { normalizeStage2dScene, stage2dSceneToNodePatch } from './stage2d'
import { stage2dActionToNodePatch } from './stage2dAction'
import { resolveStage2dActionPreset } from '../gameAssets/stage2dActionPresets'
import type { GraphNode, GraphNodeParams } from './types'

/** 常见中文/口语键名到标准属性名的语义别名映射 */
const SEMANTIC_KEY_ALIASES: Record<string, string> = {
  提示词: 'prompt',
  正向提示词: 'prompt',
  画面描述: 'prompt',
  标题: 'title',
  名称: 'title',
  备注: 'note',
  文本: 'text',
  内容: 'text',
  模型: 'modelId',
  宽高比: 'aspectRatio',
  比例: 'aspectRatio',
  时长: 'durationSec',
  秒数: 'durationSec',
  锁定: 'locked',
  磨皮: 'skinSmoothing',
  肌肤平滑: 'skinSmoothing',
  去瑕疵: 'blemishRemoval',
  祛痘: 'blemishRemoval',
  美白: 'skinWhiten',
  提亮肤色: 'skinWhiten',
  skinBrightening: 'skinWhiten',
  skinbrightening: 'skinWhiten',
  去黑眼圈: 'underEye',
  darkCircles: 'underEye',
  darkcircles: 'underEye',
  去法令纹: 'wrinkles',
  nasolabialFolds: 'wrinkles',
  nasolabialfolds: 'wrinkles',
  瘦脸: 'faceSlim',
  faceSlimming: 'faceSlim',
  faceslimming: 'faceSlim',
  face_slimming: 'faceSlim',
  大眼: 'eyeSize',
  eyeEnlarging: 'eyeSize',
  eyeenlarging: 'eyeSize',
  眼神光: 'catchlight',
  eyeBrightening: 'catchlight',
  eyebrightening: 'catchlight',
  亮眼: 'catchlight',
  眼白提亮: 'eyeWhiten',
  水平角: 'yaw',
  方位角: 'yaw',
  俯仰角: 'pitch',
  镜头距离: 'shotScale',
  距离: 'shotScale',
  distance: 'shotScale',
  景别: 'shotScale',
  亮度: 'brightness',
  轮廓光: 'rimLight',
  主光方向: 'mainDirection',
  对比度: 'contrast',
  颗粒感: 'filmGrain',
  暗角: 'vignette',
  景深: 'bokeh',
  锐度: 'sharpness',
  柔焦: 'softFocus',
  光泽: 'skinGlow',
  情绪强度: 'intensity',
  旋转: 'rotate',
  缩放: 'scale',
  行数: 'rows',
  列数: 'cols',
  容差: 'tolerance',
  柔和度: 'softness',
  羽化: 'feather',
  强度: 'strength',
  // 英文/工具简写别名
  crop: 'imageCrop',
  transform: 'imageTransform',
  compose: 'imageCompose',
  align: 'imageAlign',
  cutout: 'imageCutout',
  matte: 'imageMatte',
  erase: 'imageErase',
  redraw: 'imageRedraw',
  expand: 'imageExpand',
  upscale: 'imageUpscale',
  gridSplit: 'imageGridSplit',
  layerSplit: 'imageLayerSplit',
  lighting: 'lightingSetup',
  camera: 'multiAngleCamera',
  multiAngle: 'multiAngleCamera',
  emotion: 'emotionPad',
  portrait: 'portraitRetouch',
  portraitQuality: 'portraitTexture',
  storyboard: 'filmStoryboard',
  cast: 'filmCast',
  comicPageLayout: 'comicPage',
  readingOrder: 'readingDirection',
  reading_order: 'readingDirection',
  characters: 'entries',
  styleNote: 'style',
  style_note: 'style',
  outfit: 'description',
  appearance: 'description',
  adVariants: 'adVariantMatrix',
  html: 'gamePlayHtml',
  svg: 'svgText',
  code: 'scriptCode'
}

/** 常见中文/口语枚举值到标准枚举值的映射 */
const SEMANTIC_VALUE_ALIASES: Record<string, string> = {
  关闭: 'off',
  关: 'off',
  无: 'off',
  轻微: 'light',
  轻度: 'light',
  自然: 'standard',
  适中: 'standard',
  中度: 'standard',
  标准: 'standard',
  medium: 'standard',
  强: 'strong',
  强烈: 'strong',
  深度: 'strong',
  高: 'strong',
  极强: 'max',
  拉满: 'max',
  低: 'light'
}

function snakeToCamel(key: string): string {
  return key.replace(/_([a-zA-Z0-9])/g, (_, ch: string) => ch.toUpperCase())
}

function normalizeSingleKey(
  rawKey: string,
  targetContainer?: Record<string, unknown>,
  schema?: NodeIntrospectedSchema
): string {
  const trimmed = rawKey.trim()
  if (SEMANTIC_KEY_ALIASES[trimmed]) {
    return SEMANTIC_KEY_ALIASES[trimmed]
  }
  if (targetContainer && trimmed in targetContainer) {
    return trimmed
  }
  const camel = snakeToCamel(trimmed)
  if (targetContainer && camel in targetContainer) {
    return camel
  }
  if (schema) {
    if (camel in schema.fields || camel in schema.shorthandMap) {
      return camel
    }
    // 大小写不敏感匹配
    const lower = camel.toLowerCase()
    for (const k of Object.keys(schema.fields)) {
      if (k.toLowerCase() === lower) return k
    }
    for (const k of Object.keys(schema.shorthandMap)) {
      if (k.toLowerCase() === lower) return k
    }
  }
  if (targetContainer) {
    const lower = camel.toLowerCase()
    for (const k of Object.keys(targetContainer)) {
      if (k.toLowerCase() === lower) return k
    }
  }
  return camel !== trimmed && !trimmed.includes('.') ? camel : trimmed
}

function coerceSemanticValue(val: unknown): unknown {
  if (typeof val === 'string') {
    const trimmed = val.trim()
    if (SEMANTIC_VALUE_ALIASES[trimmed]) {
      return SEMANTIC_VALUE_ALIASES[trimmed]
    }
  }
  return val
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return Boolean(v && typeof v === 'object' && !Array.isArray(v))
}

interface ParsedPathToken {
  key: string
  arraySelector?:
    { kind: 'index'; index: number } | { kind: 'filter'; field: string; value: string }
}

/**
 * 解析点路径，支持：
 * - `portraitRetouch.skinSmoothing`
 * - `filmStoryboard.shots[0].action`
 * - `comicPage.panels[1].bubbles[0].text`
 * - `stage2dScene.layers[name=林小满].visible`
 */
export function parseSmartPath(pathStr: string): ParsedPathToken[] {
  const rawParts = pathStr
    .split('.')
    .map((s) => s.trim())
    .filter(Boolean)
  const tokens: ParsedPathToken[] = []

  const bracketRe = /^([^\[\]]+)\[([^\]]+)\](.*)$/
  for (const part of rawParts) {
    let rem = part
    const m = rem.match(bracketRe)
    if (!m) {
      tokens.push({ key: rem })
      continue
    }
    while (rem) {
      const match = rem.match(/^([^\[\]]+)?\[([^\]]+)\](.*)$/)
      if (!match) {
        if (rem) tokens.push({ key: rem })
        break
      }
      const [, propName, selectorRaw, rest] = match
      const selectorTrim = selectorRaw.trim()
      let arraySelector: ParsedPathToken['arraySelector']
      if (/^\d+$/.test(selectorTrim)) {
        arraySelector = { kind: 'index', index: Number(selectorTrim) }
      } else if (selectorTrim.includes('=')) {
        const eqIdx = selectorTrim.indexOf('=')
        const field = selectorTrim.slice(0, eqIdx).trim()
        const value = selectorTrim
          .slice(eqIdx + 1)
          .trim()
          .replace(/^['"]|['"]$/g, '')
        arraySelector = { kind: 'filter', field, value }
      } else {
        arraySelector = {
          kind: 'filter',
          field: 'id',
          value: selectorTrim.replace(/^['"]|['"]$/g, '')
        }
      }

      if (propName) {
        tokens.push({ key: propName, arraySelector })
      } else if (tokens.length > 0) {
        tokens.push({ key: '', arraySelector })
      }
      rem = rest
    }
  }

  return tokens
}

function resolveArrayElementIndex(
  arr: unknown[],
  selector: NonNullable<ParsedPathToken['arraySelector']>
): number {
  if (selector.kind === 'index') {
    if (selector.index >= 0 && selector.index < arr.length) return selector.index
    // 若用户按 1-based shot index/order 传但越界，检查是否存在 index/order === selector.index 的元素
    const byOneBased = arr.findIndex(
      (item) =>
        isPlainObject(item) &&
        (Number(item.index) === selector.index || Number(item.order) === selector.index)
    )
    if (byOneBased >= 0) return byOneBased
    return selector.index
  }
  const { field, value } = selector
  const lowerVal = value.toLowerCase()
  const idx = arr.findIndex((item) => {
    if (!isPlainObject(item)) return false
    const prop =
      item[field] ??
      (field === 'index' ? item.order : field === 'order' ? item.index : undefined) ??
      item.name ??
      item.title ??
      item.id
    if (prop === undefined || prop === null) return false
    return String(prop).toLowerCase() === lowerVal || String(prop).toLowerCase().includes(lowerVal)
  })
  return idx >= 0 ? idx : 0
}

/**
 * 在目标对象上按解析后的点路径写入值（自动展开中间对象与数组元素）。
 */
export function setBySmartPath(
  root: Record<string, unknown>,
  pathStr: string,
  rawValue: unknown,
  schema?: NodeIntrospectedSchema
): void {
  const tokens = parseSmartPath(pathStr)
  if (tokens.length === 0) return

  let current: any = root
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    const isLast = i === tokens.length - 1
    const normKey = token.key
      ? normalizeSingleKey(
          token.key,
          isPlainObject(current) ? current : undefined,
          i === 0 ? schema : undefined
        )
      : ''

    if (!token.arraySelector) {
      if (isLast) {
        current[normKey] = coerceSemanticValue(rawValue)
      } else {
        if (!isPlainObject(current[normKey])) {
          current[normKey] = isPlainObject(current[normKey]) ? { ...current[normKey] } : {}
        } else {
          current[normKey] = { ...current[normKey] }
        }
        current = current[normKey]
      }
    } else {
      const targetArrRaw = normKey ? current[normKey] : current
      const arr = Array.isArray(targetArrRaw) ? [...targetArrRaw] : []
      if (normKey) {
        current[normKey] = arr
      }
      const idx = resolveArrayElementIndex(arr, token.arraySelector)
      if (isLast) {
        if (isPlainObject(arr[idx]) && isPlainObject(rawValue)) {
          arr[idx] = deepMergeSmartValues(arr[idx], rawValue)
        } else {
          arr[idx] = coerceSemanticValue(rawValue)
        }
      } else {
        const nextItem = isPlainObject(arr[idx]) ? { ...arr[idx] } : {}
        arr[idx] = nextItem
        current = nextItem
      }
    }
  }
}

/**
 * 深度智能合并两个值：
 * - 普通对象递归合并并执行键名归一化（snake_case -> camelCase、中文别名转换）
 * - 对象数组：若 incoming 元素带唯一标识（id / index / name）且与现有数组局部匹配，支持按标识合并；否则整体替换
 */
export function deepMergeSmartValues(existing: unknown, incoming: unknown): unknown {
  if (incoming === undefined) return existing
  if (incoming === null || typeof incoming !== 'object') {
    return coerceSemanticValue(incoming)
  }

  if (Array.isArray(incoming)) {
    if (!Array.isArray(existing) || existing.length === 0 || incoming.length === 0) {
      return incoming
    }
    // 检查是否为带锚点（如局部修改某个分镜或图层）的增量对象数组
    const firstInc = incoming[0]
    const firstExt = existing[0]
    if (
      isPlainObject(firstInc) &&
      isPlainObject(firstExt) &&
      incoming.length < existing.length &&
      incoming.every(
        (item) =>
          isPlainObject(item) &&
          (typeof item.id === 'string' ||
            typeof item.index === 'number' ||
            typeof item.order === 'number' ||
            typeof item.name === 'string')
      )
    ) {
      const mergedArr = existing.map((extItem) =>
        isPlainObject(extItem) ? { ...extItem } : extItem
      )
      for (const incItem of incoming as Record<string, unknown>[]) {
        const matchIdx = mergedArr.findIndex((extItem) => {
          if (!isPlainObject(extItem)) return false
          if (incItem.id !== undefined && extItem.id === incItem.id) return true
          if (incItem.index !== undefined && extItem.index === incItem.index) return true
          if (incItem.order !== undefined && extItem.order === incItem.order) return true
          if (incItem.name !== undefined && extItem.name === incItem.name) return true
          return false
        })
        if (matchIdx >= 0) {
          mergedArr[matchIdx] = deepMergeSmartValues(mergedArr[matchIdx], incItem) as Record<
            string,
            unknown
          >
        } else {
          mergedArr.push(incItem)
        }
      }
      return mergedArr
    }
    return incoming
  }

  if (!isPlainObject(existing)) {
    const fresh: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(incoming as Record<string, unknown>)) {
      const nk = normalizeSingleKey(k)
      fresh[nk] = deepMergeSmartValues(undefined, v)
    }
    return fresh
  }

  const result: Record<string, unknown> = { ...existing }
  for (const [rawKey, rawVal] of Object.entries(incoming as Record<string, unknown>)) {
    if (rawKey.includes('.') || rawKey.includes('[')) {
      setBySmartPath(result, rawKey, rawVal)
      continue
    }
    const normKey = normalizeSingleKey(rawKey, result)
    result[normKey] = deepMergeSmartValues(result[normKey], rawVal)
  }
  return result
}

function defaultComicPageWithPanels() {
  return applyComicLayoutTemplate(createComicPage(), COMIC_LAYOUT_TEMPLATES[0]?.id ?? 'grid-2x2')
}

/**
 * 解包已知或动态检测到的 JSON-string 字段为可编辑对象，以便执行点路径与深合并。
 */
function unmarshalJsonStringField(key: string, currentVal: unknown): unknown {
  if (key === 'comicPage') {
    if (typeof currentVal === 'string') {
      return parseComicPage(currentVal) ?? defaultComicPageWithPanels()
    }
    if (currentVal === undefined || currentVal === null) {
      return defaultComicPageWithPanels()
    }
    return currentVal
  }
  if (key === 'filmStoryboard') {
    if (typeof currentVal === 'string' || currentVal === undefined || currentVal === null) {
      return (
        parseFilmStoryboard(typeof currentVal === 'string' ? currentVal : undefined) ??
        emptyFilmStoryboard()
      )
    }
    return currentVal
  }
  if (key === 'filmCast') {
    if (typeof currentVal === 'string' || currentVal === undefined || currentVal === null) {
      return (
        parseFilmCast(typeof currentVal === 'string' ? currentVal : undefined) ?? {
          schema: FILM_CAST_SCHEMA,
          style: '',
          entries: []
        }
      )
    }
    return currentVal
  }
  if (typeof currentVal === 'string') {
    const trimmed = currentVal.trim()
    if (
      (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'))
    ) {
      try {
        return JSON.parse(trimmed)
      } catch {
        return currentVal
      }
    }
  }
  return currentVal
}

/**
 * 将编辑后的对象重新序列化回 JSON-string 字段。
 */
function marshalJsonStringField(key: string, editedVal: unknown): string {
  if (key === 'comicPage') {
    if (typeof editedVal === 'string') {
      return serializeComicPage(parseComicPage(editedVal) ?? defaultComicPageWithPanels())
    }
    return serializeComicPage(normalizeComicPage(editedVal as any))
  }
  if (key === 'filmStoryboard') {
    const parsed = parseFilmStoryboard(editedVal)
    return stringifyFilmStoryboard(
      parsed ?? (isPlainObject(editedVal) ? (editedVal as any) : emptyFilmStoryboard())
    )
  }
  if (key === 'filmCast') {
    const parsed = parseFilmCast(editedVal)
    return stringifyFilmCast(
      parsed ??
        (isPlainObject(editedVal)
          ? (editedVal as any)
          : { schema: FILM_CAST_SCHEMA, style: '', entries: [] })
    )
  }
  if (typeof editedVal === 'string') return editedVal
  return JSON.stringify(editedVal)
}

function matchesPresetQuery(item: unknown, q: string): boolean {
  const candidates: string[] = []
  if (typeof item === 'string') {
    candidates.push(item)
  } else if (item && typeof item === 'object') {
    const rec = item as Record<string, any>
    if (typeof rec.id === 'string') candidates.push(rec.id)
    if (typeof rec.label === 'string') candidates.push(rec.label)
    if (rec.label && typeof rec.label === 'object') {
      if (typeof rec.label.zh === 'string') candidates.push(rec.label.zh)
      if (typeof rec.label.en === 'string') candidates.push(rec.label.en)
    }
    if (typeof rec.name === 'string') candidates.push(rec.name)
    if (rec.name && typeof rec.name === 'object') {
      if (typeof rec.name.zh === 'string') candidates.push(rec.name.zh)
      if (typeof rec.name.en === 'string') candidates.push(rec.name.en)
    }
    if (typeof rec.zh === 'string') candidates.push(rec.zh)
    if (typeof rec.en === 'string') candidates.push(rec.en)
    if (typeof rec.title === 'string') candidates.push(rec.title)
    if (typeof rec.titleKey === 'string') candidates.push(rec.titleKey)
    if (typeof rec.labelKey === 'string') candidates.push(rec.labelKey)
  }

  const compactQ = q.replace(/[-_\s]/g, '')
  for (const c of candidates) {
    const lower = c.toLowerCase()
    const compactC = lower.replace(/[-_\s]/g, '')
    if (lower === q || lower.includes(q) || (compactQ.length > 1 && compactC === compactQ)) {
      return true
    }
  }
  return false
}

/**
 * 对节点应用一键预设（支持预设 ID 或中英文预设名称模糊匹配）。
 * 返回匹配的预设 ID 及更新后的参数补丁。
 */
export function applySmartNodePreset(
  node: Pick<GraphNode, 'typeId' | 'category' | 'assetType' | 'params'>,
  presetQuery: string
): { matchedPresetId: string; paramsPatch: Partial<GraphNodeParams> } | null {
  const q = presetQuery.trim().toLowerCase()
  if (!q) return null

  const def = resolveNodeType(node)
  const baseParams: GraphNodeParams = {
    ...(def?.defaultParams ? def.defaultParams() : {}),
    ...(node.params ?? {})
  }

  // 1. 多角度镜头预设
  if ('multiAngleCamera' in baseParams || def?.typeId === 'image.multiAngle') {
    const hit = MULTI_ANGLE_PRESETS.find((p) => matchesPresetQuery(p, q))
    if (hit) {
      const nextState = applyMultiAnglePreset(
        hit.id,
        Boolean(baseParams.multiAngleCamera?.promptEnabled)
      )
      return {
        matchedPresetId: hit.id,
        paramsPatch: multiAngleCameraToNodePatch(nextState)
      }
    }
  }

  // 2. 光影预设与光位方向预设
  if ('lightingSetup' in baseParams || def?.typeId === 'image.lighting') {
    const hitPreset = LIGHTING_PRESETS.find((p) => matchesPresetQuery(p, q))
    if (hitPreset) {
      const nextState = applyLightingPreset(hitPreset.id)
      return {
        matchedPresetId: hitPreset.id,
        paramsPatch: lightingSetupToNodePatch(nextState)
      }
    }
    const hitDir = LIGHTING_DIRECTIONS.find((d) => matchesPresetQuery(d, q))
    if (hitDir) {
      const dirId = typeof hitDir === 'string' ? hitDir : (hitDir as any).id
      const nextState = applyLightingDirection(
        normalizeLightingSetup(baseParams.lightingSetup),
        dirId
      )
      return {
        matchedPresetId: dirId,
        paramsPatch: lightingSetupToNodePatch(nextState)
      }
    }
  }

  // 3. 人像精修预设
  if ('portraitRetouch' in baseParams || def?.typeId === 'image.portrait') {
    const hit = PORTRAIT_PRESETS.find((p) => matchesPresetQuery(p, q))
    if (hit) {
      const nextState = applyPortraitPreset(hit.id)
      return {
        matchedPresetId: hit.id,
        paramsPatch: portraitRetouchToNodePatch(nextState)
      }
    }
  }

  // 4. 情绪罗盘预设（5x5 二维矩阵）
  if ('emotionPad' in baseParams || def?.typeId === 'image.emotion') {
    for (let gridY = 0; gridY < EMOTION_GRID.length; gridY += 1) {
      const row = EMOTION_GRID[gridY] ?? []
      for (let gridX = 0; gridX < row.length; gridX += 1) {
        const cell = row[gridX]
        if (!cell) continue
        const coordId = `${gridX},${gridY}`
        if (
          coordId === q ||
          matchesPresetQuery({ id: coordId, label: cell.label, prompt: cell.prompt }, q)
        ) {
          const nextState = normalizeEmotionPad({
            gridX: gridX as any,
            gridY: gridY as any
          })
          return {
            matchedPresetId: cell.label,
            paramsPatch: emotionPadToNodePatch(nextState)
          }
        }
      }
    }
  }

  // 5. 图像裁剪比例预设
  if ('imageCrop' in baseParams || def?.typeId === 'image.crop') {
    const hit = CROP_ASPECT_PRESETS.find((p) => matchesPresetQuery(p, q))
    if (hit) {
      const aspectId = typeof hit === 'string' ? hit : (hit as any).id
      const currentCrop = normalizeImageCrop(baseParams.imageCrop)
      const nextState = normalizeImageCrop({
        ...currentCrop,
        aspectId
      })
      return {
        matchedPresetId: aspectId,
        paramsPatch: imageCropToNodePatch(nextState)
      }
    }
  }

  // 6. 图像尺寸对齐预设
  if ('imageAlign' in baseParams || def?.typeId === 'image.align') {
    const hit = IMAGE_ALIGN_SIZE_PRESETS.find((p) => matchesPresetQuery(p, q))
    if (hit) {
      const currentAlign = normalizeImageAlign(baseParams.imageAlign)
      const nextState = normalizeImageAlign({
        ...currentAlign,
        canvasWidth: hit.width,
        canvasHeight: hit.height
      })
      return {
        matchedPresetId: hit.id,
        paramsPatch: imageAlignToNodePatch(nextState)
      }
    }
  }

  // 7. 宫格切图预设
  if ('imageGridSplit' in baseParams || def?.typeId === 'image.gridSplit') {
    const hit = GRID_SPLIT_PRESETS.find((p) => matchesPresetQuery(p, q))
    if (hit) {
      const currentSplit = normalizeImageGridSplit(baseParams.imageGridSplit)
      const nextState = normalizeImageGridSplit({
        ...currentSplit,
        rows: hit.rows,
        cols: hit.cols,
        selected: []
      })
      return {
        matchedPresetId: `${hit.rows}x${hit.cols}`,
        paramsPatch: imageGridSplitToNodePatch(nextState)
      }
    }
  }

  // 8. 高清放大模式预设
  if ('imageUpscale' in baseParams || def?.typeId === 'image.upscale') {
    const hit = UPSCALE_VARIANTS.find((v) => matchesPresetQuery(v, q))
    if (hit) {
      const currentUp = normalizeImageUpscale(baseParams.imageUpscale)
      const nextState = normalizeImageUpscale({
        ...currentUp,
        variantId: hit.id
      })
      return {
        matchedPresetId: hit.id,
        paramsPatch: imageUpscaleToNodePatch(nextState)
      }
    }
  }

  // 9. 漫画分镜版式模板预设
  if ('comicPage' in baseParams || def?.typeId === 'comic.page') {
    const hit = COMIC_LAYOUT_TEMPLATES.find((t) => matchesPresetQuery(t, q))
    if (hit) {
      const currentComic = parseComicPage(baseParams.comicPage) ?? createComicPage()
      const nextComic = applyComicLayoutTemplate(currentComic, hit.id)
      return {
        matchedPresetId: hit.id,
        paramsPatch: {
          comicPage: serializeComicPage(nextComic)
        }
      }
    }
  }

  // 10. 2D 舞台骨骼动作预设
  if ('stage2dScene' in baseParams || def?.typeId === 'stage.2d') {
    const hit = resolveStage2dActionPreset(presetQuery)
    if (hit) {
      const { id: _id, ...action } = hit
      return {
        matchedPresetId: hit.id,
        paramsPatch: stage2dActionToNodePatch(action)
      }
    }
  }

  return null
}

/**
 * 同步所有已知子文档的归一化器与派生字段（例如 lightingPrompt / multiAnglePrompt / emotionPrompt 等）。
 */
function finalizeSubDocumentPatches(
  working: Record<string, unknown>,
  touchedTopKeys: Set<string>
): void {
  if (touchedTopKeys.has('multiAngleCamera') && working.multiAngleCamera !== undefined) {
    const norm = normalizeMultiAngleCamera(working.multiAngleCamera as any)
    Object.assign(working, multiAngleCameraToNodePatch(norm))
  }
  if (touchedTopKeys.has('lightingSetup') && working.lightingSetup !== undefined) {
    const norm = normalizeLightingSetup(working.lightingSetup as any)
    Object.assign(working, lightingSetupToNodePatch(norm))
  }
  if (touchedTopKeys.has('portraitRetouch') && working.portraitRetouch !== undefined) {
    const norm = normalizePortraitRetouch(working.portraitRetouch as any)
    Object.assign(working, portraitRetouchToNodePatch(norm))
  }
  if (touchedTopKeys.has('portraitTexture') && working.portraitTexture !== undefined) {
    const norm = normalizePortraitTexture(working.portraitTexture as any)
    Object.assign(working, portraitTextureToNodePatch(norm))
  }
  if (touchedTopKeys.has('emotionPad') && working.emotionPad !== undefined) {
    const norm = normalizeEmotionPad(working.emotionPad as any)
    Object.assign(working, emotionPadToNodePatch(norm))
  }
  if (touchedTopKeys.has('imageCrop') && working.imageCrop !== undefined) {
    const norm = normalizeImageCrop(working.imageCrop as any)
    Object.assign(working, imageCropToNodePatch(norm))
  }
  if (touchedTopKeys.has('imageTransform') && working.imageTransform !== undefined) {
    const norm = normalizeImageTransform(working.imageTransform as any)
    Object.assign(working, imageTransformToNodePatch(norm))
  }
  if (touchedTopKeys.has('imageExpand') && working.imageExpand !== undefined) {
    working.imageExpand = normalizeImageExpand(working.imageExpand as any)
  }
  if (touchedTopKeys.has('imageUpscale') && working.imageUpscale !== undefined) {
    const norm = normalizeImageUpscale(working.imageUpscale as any)
    Object.assign(working, imageUpscaleToNodePatch(norm))
  }
  if (touchedTopKeys.has('imageCutout') && working.imageCutout !== undefined) {
    const norm = normalizeImageCutout(working.imageCutout as any)
    Object.assign(working, imageCutoutToNodePatch(norm))
  }
  if (touchedTopKeys.has('imageCompose') && working.imageCompose !== undefined) {
    const norm = normalizeImageCompose(working.imageCompose as any)
    Object.assign(working, imageComposeToNodePatch(norm))
  }
  if (touchedTopKeys.has('imageAlign') && working.imageAlign !== undefined) {
    const norm = normalizeImageAlign(working.imageAlign as any)
    Object.assign(working, imageAlignToNodePatch(norm))
  }
  if (touchedTopKeys.has('imageRedraw') && working.imageRedraw !== undefined) {
    const norm = normalizeImageRedraw(working.imageRedraw as any)
    Object.assign(working, imageRedrawToNodePatch(norm))
  }
  if (touchedTopKeys.has('imageErase') && working.imageErase !== undefined) {
    const norm = normalizeImageErase(working.imageErase as any)
    Object.assign(working, imageEraseToNodePatch(norm))
  }
  if (touchedTopKeys.has('imageMatte') && working.imageMatte !== undefined) {
    const norm = normalizeImageMatte(working.imageMatte as any)
    Object.assign(working, imageMatteToNodePatch(norm))
  }
  if (touchedTopKeys.has('imageGridSplit') && working.imageGridSplit !== undefined) {
    const norm = normalizeImageGridSplit(working.imageGridSplit as any)
    Object.assign(working, imageGridSplitToNodePatch(norm))
  }
  if (touchedTopKeys.has('iconPack') && working.iconPack !== undefined) {
    const norm = normalizeIconPackState(working.iconPack as any)
    Object.assign(working, iconPackToNodePatch(norm))
  }
  if (touchedTopKeys.has('imageLayerSplit') && working.imageLayerSplit !== undefined) {
    const norm = normalizeImageLayerSplit(working.imageLayerSplit as any)
    Object.assign(working, imageLayerSplitToNodePatch(norm))
  }
  if (touchedTopKeys.has('stage2dScene') && working.stage2dScene !== undefined) {
    const norm = normalizeStage2dScene(working.stage2dScene as any)
    Object.assign(working, stage2dSceneToNodePatch(norm))
  }
  if (touchedTopKeys.has('stage2dAction') && working.stage2dAction !== undefined) {
    Object.assign(working, stage2dActionToNodePatch(working.stage2dAction as any))
  }
}

/**
 * 智能合并节点 `params`：
 * 1. 基于 `introspectNodeInstance(node)` 自动感知当前节点的所有顶层、嵌套子文档与 JSON-string 参数；
 * 2. 支持点路径与数组选择器（如 `"portraitRetouch.skinSmoothing": "strong"`、`"filmStoryboard.shots[0].action": "..."`）；
 * 3. 支持顶层简写自动路由（如在 `image.portrait` 上直接传 `{ skinSmoothing: "strong" }`，或在任意新节点上传其子对象独有字段）；
 * 4. 支持 JSON-string 参数（如 `comicPage`、`filmStoryboard`、`filmCast`）透明解包合并再序列化；
 * 5. 支持一键预设（`preset` / `presetId`）与后置归一化联动更新（自动刷新 `lightingPrompt` / `multiAnglePrompt` / `emotionPrompt` 等）。
 */
export function mergeSmartNodeParams(
  node: Pick<GraphNode, 'typeId' | 'category' | 'assetType' | 'params'>,
  incoming?: Record<string, unknown>
): GraphNodeParams {
  const def = resolveNodeType(node)
  const defaults = def?.defaultParams ? def.defaultParams() : {}
  const before: GraphNodeParams = {
    ...defaults,
    ...(node.params ?? {})
  }
  if (!incoming || Object.keys(incoming).length === 0) {
    return { ...before }
  }

  const schema = introspectNodeInstance({
    ...node,
    params: before
  })

  const working: Record<string, unknown> = { ...before }
  const touchedTopKeys = new Set<string>()
  const unmarshaledJsonKeys = new Set<string>()

  function ensureJsonFieldUnmarshaled(topKey: string): void {
    const fieldSchema = schema?.fields[topKey]
    if (
      fieldSchema?.type === 'json-string' ||
      topKey === 'comicPage' ||
      topKey === 'filmStoryboard' ||
      topKey === 'filmCast'
    ) {
      if (!unmarshaledJsonKeys.has(topKey)) {
        working[topKey] = unmarshalJsonStringField(topKey, working[topKey])
        unmarshaledJsonKeys.add(topKey)
      }
    }
  }

  // 先检查是否包含 preset / presetId 指令
  const presetVal = incoming.preset ?? incoming.presetId
  if (typeof presetVal === 'string' && presetVal.trim()) {
    const presetRes = applySmartNodePreset(
      { ...node, params: working as GraphNodeParams },
      presetVal
    )
    if (presetRes) {
      Object.assign(working, presetRes.paramsPatch)
    }
  }

  for (const [rawKey, rawVal] of Object.entries(incoming)) {
    if (rawKey === 'preset' || rawKey === 'presetId') continue

    // 情况 A：包含点路径或数组下标（如 "portraitRetouch.skinSmoothing" 或 "filmStoryboard.shots[0].action"）
    if (rawKey.includes('.') || rawKey.includes('[')) {
      const firstToken = parseSmartPath(rawKey)[0]
      if (firstToken?.key) {
        const normTopKey = normalizeSingleKey(firstToken.key, working, schema)
        ensureJsonFieldUnmarshaled(normTopKey)
        touchedTopKeys.add(normTopKey)
        const normalizedPath = [normTopKey, ...rawKey.split('.').slice(1)].join('.')
        setBySmartPath(working, normalizedPath, rawVal, schema)
      }
      continue
    }

    // 情况 B：先归一化键名，再检查是否命中简写路由（shorthandMap）
    const normKey = normalizeSingleKey(rawKey, working, schema)
    const routedPath =
      !(normKey in working) && schema?.shorthandMap[normKey]
        ? schema.shorthandMap[normKey]
        : undefined

    if (routedPath) {
      const topKey = routedPath.split('.')[0]
      ensureJsonFieldUnmarshaled(topKey)
      touchedTopKeys.add(topKey)
      setBySmartPath(working, routedPath, rawVal, schema)
      continue
    }

    // 情况 C：顶层参数直接更新或子对象深度合并
    touchedTopKeys.add(normKey)
    const fieldSchema = schema?.fields[normKey]
    if (
      (fieldSchema?.type === 'json-string' ||
        normKey === 'comicPage' ||
        normKey === 'filmStoryboard' ||
        normKey === 'filmCast') &&
      isPlainObject(rawVal)
    ) {
      ensureJsonFieldUnmarshaled(normKey)
      working[normKey] = deepMergeSmartValues(working[normKey], rawVal)
      continue
    }

    working[normKey] = deepMergeSmartValues(working[normKey], rawVal)
  }

  // 将解包过的 JSON-string 字段重新序列化回字符串
  for (const jsonKey of unmarshaledJsonKeys) {
    working[jsonKey] = marshalJsonStringField(jsonKey, working[jsonKey])
  }

  // 若 comicPage 发生 templateId 变更但 panels 尚未按新模板切换，且入参直接指定了 templateId，应用模板切换
  if (
    touchedTopKeys.has('comicPage') &&
    typeof working.comicPage === 'string' &&
    typeof (incoming.templateId ?? (incoming.comicPage as any)?.templateId) === 'string'
  ) {
    const requestedTpl = String(incoming.templateId ?? (incoming.comicPage as any)?.templateId)
    const parsed = parseComicPage(working.comicPage) ?? createComicPage()
    if (
      COMIC_LAYOUT_TEMPLATES.some((t) => t.id === requestedTpl) &&
      !(
        incoming.comicPage &&
        isPlainObject(incoming.comicPage) &&
        Array.isArray((incoming.comicPage as any).panels)
      )
    ) {
      working.comicPage = serializeComicPage(applyComicLayoutTemplate(parsed, requestedTpl as any))
    }
  }

  // 同步所有已知子文档的归一化器与派生提示词字段
  finalizeSubDocumentPatches(working, touchedTopKeys)

  const merged = working as GraphNodeParams
  const beforeRec = before as Record<string, unknown>

  // 保持 text / note / content 的既有向后兼容同步
  const incomingText =
    typeof incoming.text === 'string'
      ? incoming.text
      : typeof incoming.note === 'string'
        ? incoming.note
        : typeof incoming.content === 'string'
          ? incoming.content
          : undefined
  if (incomingText !== undefined) {
    merged.text = incomingText
    if (typeof beforeRec.note === 'string' || typeof incoming.note === 'string') {
      working.note = incomingText
    }
  }

  if (typeof incoming.prompt === 'string') {
    working.prompt = incoming.prompt
  }
  if (typeof incoming.NegativePrompt === 'string' && typeof incoming.negativePrompt !== 'string') {
    working.negativePrompt = incoming.NegativePrompt
  }

  // 生成类节点常用简写参数自动同步到标准 generate* / spatialWorld* 字段
  const incomingInstruction =
    typeof incoming.generateInstruction === 'string'
      ? incoming.generateInstruction
      : typeof incoming.instruction === 'string'
        ? incoming.instruction
        : typeof incoming.prompt === 'string'
          ? incoming.prompt
          : typeof working.prompt === 'string' && !(typeof beforeRec.prompt === 'string')
            ? working.prompt
            : typeof incoming.input === 'string'
              ? incoming.input
              : typeof incoming.script === 'string'
                ? incoming.script
                : node.typeId !== 'note.text' &&
                    typeof incomingText === 'string' &&
                    typeof before.generateInstruction === 'string'
                  ? incomingText
                  : undefined
  if (incomingInstruction !== undefined) {
    merged.generateInstruction = incomingInstruction
  }
  if (
    typeof incoming.systemPrompt === 'string' &&
    typeof incoming.generateSystemPrompt !== 'string'
  ) {
    merged.generateSystemPrompt = incoming.systemPrompt
  }
  const incomingModel =
    typeof incoming.model === 'string'
      ? incoming.model
      : typeof incoming.modelId === 'string'
        ? incoming.modelId
        : typeof working.modelId === 'string' && !(typeof beforeRec.modelId === 'string')
          ? String(working.modelId)
          : undefined
  if (incomingModel !== undefined && typeof incoming.generateModel !== 'string') {
    merged.generateModel = incomingModel
    if (
      (node.typeId === 'asset.spatialWorld' || node.typeId === 'spatialWorld.generate') &&
      typeof incoming.spatialWorldModel !== 'string'
    ) {
      merged.spatialWorldModel = incomingModel
    }
  }
  if (
    typeof incoming.providerInstanceId === 'string' &&
    typeof incoming.generateProviderInstanceId !== 'string'
  ) {
    merged.generateProviderInstanceId = incoming.providerInstanceId
  }
  const incomingAspectRatio =
    typeof incoming.aspectRatio === 'string'
      ? incoming.aspectRatio
      : typeof (merged as Record<string, unknown>).aspectRatio === 'string' &&
          !(typeof (before as Record<string, unknown>).aspectRatio === 'string')
        ? String((merged as Record<string, unknown>).aspectRatio)
        : undefined
  if (incomingAspectRatio !== undefined && typeof incoming.generateAspectRatio !== 'string') {
    merged.generateAspectRatio = incomingAspectRatio
  }
  const incomingResolution =
    typeof incoming.resolution === 'string'
      ? incoming.resolution
      : typeof incoming.size === 'string'
        ? incoming.size
        : undefined
  if (incomingResolution !== undefined && typeof incoming.generateResolution !== 'string') {
    merged.generateResolution = incomingResolution
  }
  if (typeof incoming.quality === 'string' && typeof incoming.generateQuality !== 'string') {
    merged.generateQuality = incoming.quality
  }
  const rawCount = incoming.count ?? incoming.n ?? incoming.imageCount
  if (
    typeof rawCount === 'number' &&
    Number.isFinite(rawCount) &&
    rawCount >= 1 &&
    incoming.generateCount === undefined
  ) {
    merged.generateCount = Math.floor(rawCount)
  }
  const rawDuration =
    incoming.duration ??
    incoming.durationSec ??
    incoming.durationSeconds ??
    ((merged as Record<string, unknown>).durationSec !==
    (before as Record<string, unknown>).durationSec
      ? (merged as Record<string, unknown>).durationSec
      : undefined)
  if (typeof rawDuration === 'number' && Number.isFinite(rawDuration) && rawDuration > 0) {
    if (node.typeId === 'asset.sfx') {
      if (incoming.generateSoundDurationSec === undefined) {
        merged.generateSoundDurationSec = rawDuration
      }
    } else if (incoming.generateDuration === undefined) {
      merged.generateDuration = Math.round(rawDuration)
    }
  }
  if (typeof incoming.seed === 'number' && Number.isFinite(incoming.seed)) {
    if (node.typeId === 'asset.spatialWorld') {
      if (incoming.spatialWorldSeed === undefined) {
        merged.spatialWorldSeed = Math.trunc(incoming.seed)
      }
    } else if (incoming.generateSeed === undefined) {
      merged.generateSeed = Math.trunc(incoming.seed)
      if (incoming.generateSeedUseGlobal === undefined && incoming.seedUseGlobal === undefined) {
        merged.generateSeedUseGlobal = false
      }
    }
  }
  if (typeof incoming.transparentBg === 'boolean' && incoming.generateTransparentBg === undefined) {
    merged.generateTransparentBg = incoming.transparentBg
  }
  if (typeof incoming.audio === 'boolean' && incoming.generateAudio === undefined) {
    merged.generateAudio = incoming.audio
  }
  if (typeof incoming.voice === 'string' && incoming.generateSpeechVoice === undefined) {
    merged.generateSpeechVoice = incoming.voice
  }
  const rawVoiceProfile =
    incoming.voiceProfile ?? incoming.voiceCharacter ?? incoming.speechCharacter
  if (typeof rawVoiceProfile === 'string' && incoming.generateSpeechCharacter === undefined) {
    merged.generateSpeechCharacter = rawVoiceProfile
  }
  if (
    typeof incoming.referenceAudio === 'string' &&
    incoming.generateSpeechReferenceAudio === undefined
  ) {
    merged.generateSpeechReferenceAudio = incoming.referenceAudio
  }
  if (
    incoming.voices &&
    typeof incoming.voices === 'object' &&
    !Array.isArray(incoming.voices) &&
    incoming.generateDialogueVoices === undefined
  ) {
    merged.generateDialogueVoices = incoming.voices as Record<string, string>
  }
  if (typeof incoming.loop === 'boolean' && incoming.generateSoundLoop === undefined) {
    merged.generateSoundLoop = incoming.loop
  }
  if (
    typeof incoming.promptInfluence === 'number' &&
    Number.isFinite(incoming.promptInfluence) &&
    incoming.generateSoundPromptInfluence === undefined
  ) {
    merged.generateSoundPromptInfluence = incoming.promptInfluence
  }
  if (typeof incoming.lyrics === 'string' && incoming.generateMusicLyrics === undefined) {
    merged.generateMusicLyrics = incoming.lyrics
  }
  if (
    typeof incoming.instrumental === 'boolean' &&
    incoming.generateMusicInstrumental === undefined
  ) {
    merged.generateMusicInstrumental = incoming.instrumental
  }
  if (
    node.typeId === 'asset.model3d' &&
    typeof incoming.style === 'string' &&
    incoming.generateStyle === undefined
  ) {
    merged.generateStyle = incoming.style
  }
  if (
    typeof incoming.panoMode === 'string' &&
    (incoming.panoMode === 'auto' ||
      incoming.panoMode === 'always' ||
      incoming.panoMode === 'never') &&
    incoming.spatialWorldPanoMode === undefined
  ) {
    merged.spatialWorldPanoMode = incoming.panoMode
  }
  if (
    typeof incoming.disableRecaption === 'boolean' &&
    incoming.spatialWorldDisableRecaption === undefined
  ) {
    merged.spatialWorldDisableRecaption = incoming.disableRecaption
  }
  if (node.typeId === 'svg.gen') {
    if (
      typeof incoming.width === 'number' &&
      Number.isFinite(incoming.width) &&
      incoming.svgGenWidth === undefined
    ) {
      merged.svgGenWidth = Math.round(incoming.width)
    }
    if (
      typeof incoming.height === 'number' &&
      Number.isFinite(incoming.height) &&
      incoming.svgGenHeight === undefined
    ) {
      merged.svgGenHeight = Math.round(incoming.height)
    }
    if (typeof incoming.background === 'string' && incoming.svgGenBackground === undefined) {
      if (
        incoming.background === 'white' ||
        incoming.background === 'black' ||
        incoming.background === ''
      ) {
        merged.svgGenBackground = incoming.background
      }
    }
    const ar = incomingAspectRatio ?? merged.generateAspectRatio
    if (
      incoming.svgGenWidth === undefined &&
      incoming.svgGenHeight === undefined &&
      incoming.width === undefined &&
      incoming.height === undefined
    ) {
      if (ar === '16:9') {
        merged.svgGenWidth = 1280
        merged.svgGenHeight = 720
      } else if (ar === '9:16') {
        merged.svgGenWidth = 720
        merged.svgGenHeight = 1280
      }
    }
  }
  if (node.typeId === 'svg.anim') {
    if (
      typeof incoming.frames === 'number' &&
      Number.isFinite(incoming.frames) &&
      incoming.svgFrames === undefined
    ) {
      merged.svgFrames = Math.round(incoming.frames)
    }
    if (
      typeof rawDuration === 'number' &&
      Number.isFinite(rawDuration) &&
      rawDuration >= 0 &&
      incoming.svgDurationSec === undefined
    ) {
      merged.svgDurationSec = rawDuration
    }
    if (
      typeof incoming.width === 'number' &&
      Number.isFinite(incoming.width) &&
      incoming.svgWidth === undefined
    ) {
      merged.svgWidth = Math.round(incoming.width)
    }
    if (
      typeof incoming.height === 'number' &&
      Number.isFinite(incoming.height) &&
      incoming.svgHeight === undefined
    ) {
      merged.svgHeight = Math.round(incoming.height)
    }
    if (typeof incoming.background === 'string' && incoming.svgBackground === undefined) {
      if (
        incoming.background === 'white' ||
        incoming.background === 'black' ||
        incoming.background === ''
      ) {
        merged.svgBackground = incoming.background
      }
    }
    const ar = incomingAspectRatio ?? merged.generateAspectRatio
    if (
      incoming.svgWidth === undefined &&
      incoming.svgHeight === undefined &&
      incoming.width === undefined &&
      incoming.height === undefined
    ) {
      if (ar === '16:9') {
        merged.svgWidth = 1280
        merged.svgHeight = 720
      } else if (ar === '9:16') {
        merged.svgWidth = 720
        merged.svgHeight = 1280
      }
    }
  }

  return merged
}

export interface SmartNodePatchInput {
  title?: string
  x?: number
  y?: number
  w?: number
  h?: number
  locked?: boolean
  preset?: string
  presetId?: string
  params?: Record<string, unknown>
  [extraKey: string]: unknown
}

export interface SmartNodePatchResult {
  title?: string
  x?: number
  y?: number
  w?: number
  h?: number
  locked?: boolean
  params: GraphNodeParams
}

/**
 * 统一节点级补丁入口：同时处理节点顶层属性（title/x/y/w/h/locked）、预设指令与深层 params。
 * 即便调用方把 params 内的字段直接平铺在顶层补丁对象上，也会智能路由到 `params`。
 */
export function applySmartNodePatch(
  node: GraphNode,
  patch: SmartNodePatchInput
): SmartNodePatchResult {
  const result: SmartNodePatchResult = {
    params: { ...(node.params ?? {}) }
  }

  const extraForParams: Record<string, unknown> = {}
  const topLevelReserved = new Set([
    'id',
    'nodeId',
    'op',
    'typeId',
    'category',
    'assetType',
    'ports',
    'params'
  ])

  for (const [rawK, val] of Object.entries(patch)) {
    if (val === undefined || topLevelReserved.has(rawK)) continue
    const normK = SEMANTIC_KEY_ALIASES[rawK.trim()] ?? rawK.trim()
    if (normK === 'title' && typeof val === 'string') {
      result.title = val
    } else if (
      normK === 'x' &&
      typeof val === 'number' &&
      Number.isFinite(val) &&
      !('emotionPad' in (node.params ?? {})) &&
      !('imageCrop' in (node.params ?? {}))
    ) {
      result.x = val
    } else if (
      normK === 'y' &&
      typeof val === 'number' &&
      Number.isFinite(val) &&
      !('emotionPad' in (node.params ?? {})) &&
      !('imageCrop' in (node.params ?? {}))
    ) {
      result.y = val
    } else if (
      normK === 'w' &&
      typeof val === 'number' &&
      Number.isFinite(val) &&
      !('imageCrop' in (node.params ?? {}))
    ) {
      result.w = val
    } else if (
      normK === 'h' &&
      typeof val === 'number' &&
      Number.isFinite(val) &&
      !('imageCrop' in (node.params ?? {}))
    ) {
      result.h = val
    } else if (normK === 'locked' && typeof val === 'boolean') {
      result.locked = val
    } else {
      extraForParams[rawK] = val
    }
  }

  // 若显式传入顶层 x/y/w/h，即使在 emotionPad / imageCrop 节点上也同时记录节点坐标/尺寸变更（当未传 params 时区分）
  if (typeof patch.x === 'number' && Number.isFinite(patch.x) && patch.params !== undefined) {
    result.x = patch.x
    delete extraForParams.x
  }
  if (typeof patch.y === 'number' && Number.isFinite(patch.y) && patch.params !== undefined) {
    result.y = patch.y
    delete extraForParams.y
  }
  if (typeof patch.w === 'number' && Number.isFinite(patch.w) && patch.params !== undefined) {
    result.w = patch.w
    delete extraForParams.w
  }
  if (typeof patch.h === 'number' && Number.isFinite(patch.h) && patch.params !== undefined) {
    result.h = patch.h
    delete extraForParams.h
  }

  const combinedParamsPatch: Record<string, unknown> = {
    ...extraForParams,
    ...(isPlainObject(patch.params) ? patch.params : {})
  }

  result.params = mergeSmartNodeParams(node, combinedParamsPatch)
  return result
}
