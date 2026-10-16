import { stripJsonCodeFence } from './jsonFence'
import { createNodeFromType } from './create'
import {
  GRAPH_BOUNDARY_INPUT_TYPE_ID,
  GRAPH_BOUNDARY_OUTPUT_TYPE_ID,
  HOST_INTERFACE_FORMAT_VERSION,
  boundaryInputNodeId,
  boundaryOutputNodeId,
  type HostInterfaceDocument
} from './hostInterface'
import { GraphPortType, type GraphDocument, type GraphEdge, type GraphNode } from './types'
import { resolveUiImageSystemPrompt } from './systemPromptSchemes'

export type UiScreenKind = 'fullscreen' | 'hud' | 'popup' | 'panel' | 'component'
export type UiScreenAspectRatio = '9:16' | '16:9' | '1:1' | '4:3' | '3:4'
export type UiGenTrackMode = 'dual' | 'clean-only' | 'preview-only'
export type UiGenStylePresetId =
  'auto' | 'anime-flat' | 'dark-fantasy' | 'eastern-xianxia' | 'casual-cartoon' | 'scifi-hud'

export interface UiGenStylePreset {
  id: UiGenStylePresetId
  promptZh: string
  promptEn: string
}

export const UI_GEN_STYLE_PRESETS: readonly UiGenStylePreset[] = [
  {
    id: 'auto',
    promptZh: '',
    promptEn: ''
  },
  {
    id: 'anime-flat',
    promptZh:
      '视觉材质规范：二次元现代扁平毛玻璃 UI，半透明磨砂亚克力底板、锐利斜切高光几何边框、高对比度科技感指示色与干净利落的无衬线排版，各功能区块边界分明、便于九宫格切图。', // cjk-ok 游戏 UI 风格预设
    promptEn:
      'Visual material spec: modern anime flat frosted-glass UI, translucent acrylic panels, crisp angled geometric borders with specular highlights, high-contrast accent colors, clean modular 9-sliceable widget boundaries.'
  },
  {
    id: 'dark-fantasy',
    promptZh:
      '视觉材质规范：暗黑哥特幻想 RPG UI，深色做旧黑铁与浮雕石刻底框、暗金巴洛克包角装饰、内凹宝石镶嵌槽位与羊皮纸质感内衬，控件边缘厚重清晰、独立可拆。', // cjk-ok 游戏 UI 风格预设
    promptEn:
      'Visual material spec: dark gothic fantasy RPG UI, weathered wrought-iron and carved stone panel frames, antique gold filigree corner ornaments, recessed gem-socketed slots, crisp isolated widget borders.'
  },
  {
    id: 'eastern-xianxia',
    promptZh:
      '视觉材质规范：国风仙侠修真 UI，温润白玉与鎏金云纹边框、丝绸卷轴与宣纸底板、朱砂印章式主操作按钮與青金石色调点缀，层级雅致清晰、支持九宫格拉伸。', // cjk-ok 游戏 UI 风格预设
    promptEn:
      'Visual material spec: Eastern Xianxia fantasy UI, carved white jade and gilded cloud-motif borders, silk scroll and rice-paper backing plates, cinnabar-seal CTA buttons, clean modular 9-sliceable hierarchy.'
  },
  {
    id: 'casual-cartoon',
    promptZh:
      '视觉材质规范：欧美休闲卡通 Q 弹 UI，高饱和糖果色圆角立体胶囊按钮、明亮高光与柔和内阴影、奶油白与浅木纹圆润面板底框，图标与按钮颗粒感饱满、轮廓干净独立。', // cjk-ok 游戏 UI 风格预设
    promptEn:
      'Visual material spec: vibrant casual cartoon UI, glossy candy-colored rounded pill buttons with specular top highlights and soft bevels, warm cream and light wood panel frames, crisp isolated widget silhouettes.'
  },
  {
    id: 'scifi-hud',
    promptZh:
      '视觉材质规范：硬核科幻机甲全息 HUD UI，深空碳纤维半透明战术底板、45度切角青色/琥珀色霓虹发光线框、精密FUI刻度装饰与模块化能量槽，边缘锐利规整。', // cjk-ok 游戏 UI 风格预设
    promptEn:
      'Visual material spec: sci-fi mecha tactical holographic HUD UI, dark carbon-fiber translucent plates, 45-degree chamfered cyan/amber neon wireframe borders, precision FUI telemetry ticks and modular energy bars.'
  }
]

export function normalizeUiGenTrackMode(raw: unknown): UiGenTrackMode {
  const s = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  if (s === 'clean-only' || s === 'preview-only' || s === 'dual') {
    return s
  }
  return 'dual'
}

export function normalizeUiGenStylePreset(raw: unknown): UiGenStylePresetId {
  const s = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  if (
    s === 'anime-flat' ||
    s === 'dark-fantasy' ||
    s === 'eastern-xianxia' ||
    s === 'casual-cartoon' ||
    s === 'scifi-hud'
  ) {
    return s
  }
  return 'auto'
}

export function applyUiGenStylePreset(prompt: string, presetId?: unknown, locale?: string): string {
  const trimmed = prompt.trim()
  if (!trimmed) return ''
  const normalized = normalizeUiGenStylePreset(presetId)
  if (normalized === 'auto') return trimmed
  const spec = UI_GEN_STYLE_PRESETS.find((item) => item.id === normalized)
  if (!spec) return trimmed
  const useEn = locale?.toLowerCase().startsWith('en') || !/[\u4e00-\u9fff]/.test(trimmed)
  const suffix = useEn ? spec.promptEn : spec.promptZh
  if (!suffix || trimmed.includes(suffix)) return trimmed
  return `${trimmed}${useEn ? ' ' : '。'}${suffix}`
}

export interface UiScreenPromptItem {
  id: string
  title: string
  prompt: string
  /**
   * 空字底图轨提示词（可选）：与 prompt 同布局同控件但不绘制任何文字，
   * 供引擎叠加本地化文字、绕开 AI 像素文字。
   * 缺省时构建内图用 buildTextlessUiPrompt 兜底派生。
   */
  cleanPrompt?: string
  /** 界面形态分类：全屏主界面 / HUD / 模态弹窗 / 侧边面板 / 独立复用组件 */
  screenKind?: UiScreenKind
  /** 界面画幅比例：竖屏 9:16、横屏 16:9、方形弹窗/组件 1:1、宽弹窗 4:3 等（缺省回退 9:16） */
  aspectRatio?: UiScreenAspectRatio
  /**
   * UI 图层分离提示词（可选）：指导下游 image.layerSplit（UI 图层分离 / PSD 导出）
   * 按游戏引擎拼 UI 规范拆出底板、框体、顶底栏、按钮、列表格与图标层。
   */
  layerPrompt?: string
  /** 单屏是否启用生成（缺省 true；false 时在批量生成中跳过该屏） */
  enabled?: boolean
}

const VALID_SCREEN_KINDS = new Set<UiScreenKind>([
  'fullscreen',
  'hud',
  'popup',
  'panel',
  'component'
])

const VALID_ASPECT_RATIOS = new Set<UiScreenAspectRatio>(['9:16', '16:9', '1:1', '4:3', '3:4'])

export function normalizeUiScreenKind(
  raw: unknown,
  title?: string,
  prompt?: string
): UiScreenKind | undefined {
  const s = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  if (VALID_SCREEN_KINDS.has(s as UiScreenKind)) return s as UiScreenKind
  if (/^(modal|dialog|弹窗|对话框)$/i.test(s)) return 'popup' // cjk-ok
  if (/^(drawer|sidebar|面板|侧栏|抽屉)$/i.test(s)) return 'panel' // cjk-ok
  if (/^(card|cell|item|组件|卡片)$/i.test(s)) return 'component' // cjk-ok
  if (/^(screen|page|全屏)$/i.test(s)) return 'fullscreen' // cjk-ok
  const text = `${title ?? ''} ${prompt ?? ''}`
  if (/弹窗|对话框|确认框|\b(?:popup|modal|dialog)\b/i.test(text)) return 'popup' // cjk-ok
  if (/\bhud\b|战斗主界面|常驻信息条/i.test(text)) return 'hud' // cjk-ok
  if (/侧栏|抽屉|半屏面板|\b(?:drawer|side\s*panel)\b/i.test(text)) return 'panel' // cjk-ok
  return undefined
}

export function normalizeUiScreenAspectRatio(
  raw: unknown,
  prompt?: string,
  title?: string
): UiScreenAspectRatio | undefined {
  const s = typeof raw === 'string' ? raw.trim() : ''
  if (VALID_ASPECT_RATIOS.has(s as UiScreenAspectRatio)) return s as UiScreenAspectRatio
  if (/^(landscape|horizontal|横屏|横版)$/i.test(s)) return '16:9' // cjk-ok
  if (/^(portrait|vertical|竖屏|竖版)$/i.test(s)) return '9:16' // cjk-ok
  if (/^(square|方形|正方形)$/i.test(s)) return '1:1' // cjk-ok
  const text = `${title ?? ''} ${prompt ?? ''}`
  const landscapeRe =
    /16\s*[:：]\s*9|横屏|横版手游|PC\s*端游|主机端|\b(?:landscape|widescreen|desktop\s+ui)\b/i // cjk-ok
  if (landscapeRe.test(text)) {
    return '16:9'
  }
  if (/9\s*[:：]\s*16|竖屏|竖版/i.test(text)) return '9:16' // cjk-ok
  if (/1\s*[:：]\s*1\b/i.test(text)) return '1:1'
  if (/4\s*[:：]\s*3\b/i.test(text)) return '4:3'
  if (/3\s*[:：]\s*4\b/i.test(text)) return '3:4'
  return undefined
}

/**
 * 为指定游戏 UI 界面生成标准的「UI 图层分离（Seedream layer_decomposition → PSD）」提示词。
 * 按游戏引擎（UGUI / FairyGUI / UMG）拼 UI 的动静分离层级拆解：
 * 底板层（9-Slice）→ 容器面板框 → 顶底导航与状态栏 → 交互按钮与列表格槽位 → 图标与前景装饰。
 */
export function buildDefaultUiLayerSplitPrompt(
  screen: Pick<UiScreenPromptItem, 'title' | 'prompt' | 'screenKind'>,
  locale?: string
): string {
  const title = screen.title?.trim() || 'UI'
  const kind = screen.screenKind ?? normalizeUiScreenKind(undefined, screen.title, screen.prompt)
  const useEn =
    locale?.toLowerCase().startsWith('en') ||
    (!!screen.prompt && !/[\u4e00-\u9fff]/.test(`${screen.title ?? ''}${screen.prompt}`))

  if (useEn) {
    if (kind === 'popup') {
      return `Game UI modal popup layer decomposition (${title}): isolate into clean, engine-ready transparent PNG layers for PSD assembly — 1. backdrop overlay & base plate; 2. main modal frame container (9-sliceable); 3. top title banner & close button; 4. center content slots, item cells & reward frames; 5. bottom primary/secondary action buttons & ornamental badges. Keep widget edges crisp and non-overlapping.`
    }
    if (kind === 'hud') {
      return `Game HUD layer decomposition (${title}): isolate into clean, engine-ready transparent PNG layers for PSD assembly — 1. scene background base; 2. top-left avatar frame, HP/energy bars & currency strip; 3. top-right minimap & event entry icons; 4. bottom navigation tab bar or skill dock; 5. floating action buttons & status badges. Keep widget edges crisp and non-overlapping.`
    }
    return `Game UI screen layer decomposition (${title}): isolate into clean, engine-ready transparent PNG layers for PSD assembly — 1. full-screen background base plate; 2. main panel & container frames (9-sliceable); 3. top resource bar & tab navigation bar; 4. interactive buttons, switches & progress bars; 5. list/grid item cell slots, icon wells & foreground ornaments. Keep widget edges crisp and non-overlapping.`
  }

  if (kind === 'popup') {
    return `游戏UI模态弹窗分层拆解（${title}）：请按游戏引擎拼UI与PSD规范拆分为独立透明图层：1.底层暗色遮罩与背景底板；2.弹窗主底框容器（保持九宫格边框完整）；3.顶部标题横幅与关闭按钮；4.中部内容槽位、奖励格与道具底框；5.底部确认/取消主次操作按钮与前景装饰徽章。各控件边缘干净独立、互不粘连。` // cjk-ok
  }
  if (kind === 'hud') {
    return `游戏HUD界面分层拆解（${title}）：请按游戏引擎拼UI与PSD规范拆分为独立透明图层：1.底层主城/战斗场景背景；2.顶部角色状态栏（头像框、血条/能量条底槽、货币资源条）；3.右上小地图与活动功能入口图标组；4.底部页签导航栏或技能快捷栏底座；5.独立操作按钮与浮动角标控件。各控件边缘干净独立、互不粘连。` // cjk-ok
  }
  return `游戏UI界面分层拆解（${title}）：请按游戏引擎拼UI与PSD规范拆分为独立透明图层：1.底层背景底板；2.主面板与容器底框（保持九宫格边框完整可复用）；3.顶部资源信息栏与页签导航栏；4.核心操作按钮、开关与进度条控件；5.列表卡片底槽、独立图标槽位与前景装饰元素。各控件边缘干净独立、互不粘连。` // cjk-ok
}

/** 空字底图兜底派生：在提示词末尾追加“不绘制任何文字 / 文字位留空占位”约束 */
export const UI_TEXTLESS_SUFFIX_ZH =
  '。本图须作为空字底图使用：不得绘制任何文字——所有文案、数字、符号、字母徽标一律省略，' +
  '文字所在位置只以空白面板、色条或槽位占位呈现，不得出现任何可读字符，' +
  '其余布局、控件、状态与视觉层级与本图带字版完全一致'
export const UI_TEXTLESS_SUFFIX_EN =
  '. This image must be a textless base layer: do NOT draw any text at all — omit every label, number, ' +
  'symbol or letter badge, leaving each word position as an empty panel, bar or well placeholder only; ' +
  'nothing readable may appear. Keep the rest of the layout, controls, states and visual hierarchy ' +
  'exactly as in the text version.'

/** 依据提示词语言追加空字约束（中文提示词用中文后缀，其余用英文后缀） */
export function buildTextlessUiPrompt(prompt: string): string {
  const trimmed = prompt.trim()
  if (!trimmed) return trimmed
  const hasCjk = /[\u4e00-\u9fff]/.test(trimmed)
  return `${trimmed}${hasCjk ? UI_TEXTLESS_SUFFIX_ZH : UI_TEXTLESS_SUFFIX_EN}`
}

/**
 * 把输入端口收到的提示词载荷直接展开为界面列表。
 * 供 ui.gen 执行与 dive 打开共用：dive 时无需先 cook，直接按端口数组展开。
 * cleanPrompt / screenKind / aspectRatio / layerPrompt 可选随载荷透传。
 */
export function screensFromUiGenIncoming(values: unknown[]): UiScreenPromptItem[] {
  const raw: Array<{
    title: string
    prompt: string
    cleanPrompt?: string
    screenKind?: UiScreenKind
    aspectRatio?: UiScreenAspectRatio
    layerPrompt?: string
  }> = []
  for (const value of values) {
    if (!value || typeof value !== 'object') continue
    const entry = value as { kind?: unknown; text?: unknown; items?: unknown }
    if (entry.kind === 'texts' && Array.isArray(entry.items)) {
      for (const item of entry.items) {
        const rec = (item ?? {}) as {
          title?: unknown
          text?: unknown
          cleanPrompt?: unknown
          screenKind?: unknown
          aspectRatio?: unknown
          layerPrompt?: unknown
        }
        const prompt = typeof rec.text === 'string' ? rec.text.trim() : ''
        if (prompt) {
          const title = typeof rec.title === 'string' ? rec.title.trim() : ''
          const screenKind = normalizeUiScreenKind(rec.screenKind, title, prompt)
          const aspectRatio = normalizeUiScreenAspectRatio(rec.aspectRatio, prompt, title)
          const layerPrompt =
            typeof rec.layerPrompt === 'string' && rec.layerPrompt.trim()
              ? rec.layerPrompt.trim()
              : undefined
          raw.push({
            title,
            prompt,
            cleanPrompt: typeof rec.cleanPrompt === 'string' ? rec.cleanPrompt.trim() : undefined,
            ...(screenKind ? { screenKind } : {}),
            ...(aspectRatio ? { aspectRatio } : {}),
            ...(layerPrompt ? { layerPrompt } : {})
          })
        }
      }
    } else if (entry.kind === 'text' && typeof entry.text === 'string' && entry.text.trim()) {
      const prompt = entry.text.trim()
      const aspectRatio = normalizeUiScreenAspectRatio(undefined, prompt)
      raw.push({ title: '', prompt, ...(aspectRatio ? { aspectRatio } : {}) })
    }
  }
  return raw.map((item, index) => ({
    id: `ui-${index + 1}`,
    title: item.title || `界面 ${index + 1}`,
    prompt: item.prompt,
    cleanPrompt: item.cleanPrompt,
    ...(item.screenKind ? { screenKind: item.screenKind } : {}),
    ...(item.aspectRatio ? { aspectRatio: item.aspectRatio } : {}),
    ...(item.layerPrompt ? { layerPrompt: item.layerPrompt } : {})
  }))
}

/** UI界面拆分 dive 内图槽位上限（按屏数计，每屏双轨输出：带字精修 + 空字底图） */
export const UI_SPLIT_SLOT_CAP = 12

/**
 * dive 内图结构版本：边界节点/连线结构变化时递增，
 * 使已存在的内图资产在下一次 dive 时按新结构重建。
 * v5：每屏从单轨升级为双轨——带字精修链 + 空字底图链（cleanPrompt）。
 * v6：底图节点默认接本屏带字精修图的输出（in-image），底图以带字图为基准去字。
 */
export const UI_SPLIT_INNER_GRAPH_VERSION = 6

/** 带字轨输出口 id：out-<slot>（保持既有槽位语义，旧数据兼容） */
export function uiSplitOutPortId(slot: number): string {
  return `out-${slot}`
}

/** 空字底图轨输出口 id：out-<slot>-clean */
export function uiSplitCleanOutPortId(slot: number): string {
  return `out-${slot}-clean`
}

/**
 * ui.split 内图资产的宿主接口：每屏一个提示词输入口；
 * 输出口每屏两个（带字精修图 + 空字底图，供引擎叠本地化文字）。
 */
export function buildUiSplitHostInterface(screens: UiScreenPromptItem[]): HostInterfaceDocument {
  const cap = Math.min(UI_SPLIT_SLOT_CAP, screens.length)
  const items = screens.slice(0, cap)
  const inputs = items.map((screen, i) => ({
    id: `in-${i + 1}`,
    label: `提示词·${screen.title}`,
    dataType: GraphPortType.text,
    multiple: false
  }))
  const outputs = items.flatMap((screen, i) => {
    const slot = i + 1
    return [
      {
        id: uiSplitOutPortId(slot),
        label: `图片·${screen.title}`,
        dataType: GraphPortType.image,
        multiple: false
      },
      {
        id: uiSplitCleanOutPortId(slot),
        label: `底图·${screen.title}`,
        dataType: GraphPortType.image,
        multiple: false
      }
    ]
  })
  return { version: HOST_INTERFACE_FORMAT_VERSION, inputs, outputs }
}

export interface BuildUiSplitInnerGraphOptions {
  generateModel?: string
  generateProviderInstanceId?: string
  defaultAspectRatio?: UiScreenAspectRatio
  stylePreset?: UiGenStylePresetId
  styleImagesUseGlobal?: boolean
  generatedImages?: Array<{
    id?: string
    title?: string
    dataUrl?: string
    relativePath?: string
    createdAt?: string
  }>
}

/**
 * 构建 ui.split 的 dive 内图：每屏两条链——双轨输出。
 * - 带字精修轨：提示词输入边界 → 图像生成（asset.image）→ 图片输出边界。
 * - 空字底图轨：图像生成（asset.image，cleanPrompt 直接烘焙为 generateInstruction）→ 底图输出边界。
 * 两轨共用同一套生成参数（9:16、全局风格参考 UI、uiImage 系统提示词），保证画面一一对应。
 */
export function buildUiSplitInnerGraph(
  screens: UiScreenPromptItem[],
  locale?: string,
  options?: BuildUiSplitInnerGraphOptions
): GraphDocument {
  const nodes: GraphNode[] = []
  const edges: GraphEdge[] = []
  const cap = Math.min(UI_SPLIT_SLOT_CAP, screens.length)
  // 游戏 UI 生成专用系统提示词：对齐风格参考图的 UI 元素/界面风格/控件/配色等细节，
  // 不影响标准图片生成的默认系统提示词
  const uiImageSystemPrompt = resolveUiImageSystemPrompt(undefined, locale)
  const defaultAspect = options?.defaultAspectRatio ?? '9:16'
  const cleanBaseParams = {
    generateAspectRatio: defaultAspect,
    styleImagesUseGlobal: options?.styleImagesUseGlobal !== false,
    styleReferenceSubject: 'ui' as const,
    generateSystemPrompt: uiImageSystemPrompt,
    ...(options?.generateModel?.trim() ? { generateModel: options.generateModel.trim() } : {}),
    ...(options?.generateProviderInstanceId?.trim()
      ? { generateProviderInstanceId: options.generateProviderInstanceId.trim() }
      : {})
  }
  const existingImages = Array.isArray(options?.generatedImages) ? options!.generatedImages! : []

  for (let i = 0; i < cap; i += 1) {
    const screen = screens[i]!
    const slot = i + 1
    const y = 80 * i + 40
    const screenAspectRatio =
      normalizeUiScreenAspectRatio(screen.aspectRatio, screen.prompt, screen.title) ?? defaultAspect
    const styledPrompt = applyUiGenStylePreset(screen.prompt, options?.stylePreset, locale)
    const screenBaseParams = {
      ...cleanBaseParams,
      generateAspectRatio: screenAspectRatio
    }
    const portIn = `in-${slot}`
    const portOut = uiSplitOutPortId(slot)
    const portOutClean = uiSplitCleanOutPortId(slot)
    // 用规范边界 id：资产打开时 ensureBoundaryProxyNodes 按接口补齐/复用，
    // 自定义 id 会导致同一端口出现两套边界节点且连线错位
    const inId = boundaryInputNodeId(portIn)
    const imgId = `ui-img-${slot}`
    const outId = boundaryOutputNodeId(portOut)
    const cleanImgId = `ui-img-clean-${slot}`
    const cleanOutId = boundaryOutputNodeId(portOutClean)

    const previewTitle = `图片·${screen.title}` // cjk-ok
    const cleanTitle = `底图·${screen.title}` // cjk-ok
    const matchedPreview = existingImages.filter((item) => item.title === previewTitle)
    const matchedClean = existingImages.filter((item) => item.title === cleanTitle)

    nodes.push({
      id: inId,
      typeId: GRAPH_BOUNDARY_INPUT_TYPE_ID,
      category: 'note',
      position: { x: 40, y },
      title: `提示词·${screen.title}`,
      params: {
        previewCollapsed: true,
        hostBoundaryPort: {
          portId: portIn,
          dataType: GraphPortType.text,
          multiple: false
        },
        text: styledPrompt
      }
    })
    // 标题对齐输出口 label（wireDanglingOutsToBoundaryOutputs 按标题配对出口，
    // 双轨同屏两个图片口时避免跨轨串线）
    nodes.push(
      createNodeFromType(
        'asset.image',
        { x: 260, y },
        {
          id: imgId,
          title: previewTitle,
          params: {
            ...screenBaseParams,
            ...(matchedPreview.length
              ? {
                  generatedImages: matchedPreview.map((item, idx) => ({
                    id: item.id || `${imgId}:${idx}`,
                    title: item.title,
                    dataUrl: item.dataUrl ?? '',
                    relativePath: item.relativePath,
                    createdAt: item.createdAt ?? new Date().toISOString()
                  })),
                  selectedImageId: matchedPreview[matchedPreview.length - 1]?.id ?? ''
                }
              : {})
          }
        }
      )
    )
    nodes.push({
      id: outId,
      typeId: GRAPH_BOUNDARY_OUTPUT_TYPE_ID,
      category: 'note',
      position: { x: 480, y },
      title: previewTitle,
      params: {
        previewCollapsed: true,
        hostBoundaryPort: {
          portId: portOut,
          dataType: GraphPortType.image,
          multiple: false
        }
      }
    })
    // 空字底图轨：无输入边界，cleanPrompt 直接烘焙进图像节点指令（执行时不再取上游文本）
    const rawClean = screen.cleanPrompt?.trim() || buildTextlessUiPrompt(screen.prompt)
    const cleanPrompt = applyUiGenStylePreset(rawClean, options?.stylePreset, locale)
    nodes.push(
      createNodeFromType(
        'asset.image',
        { x: 700, y },
        {
          id: cleanImgId,
          title: cleanTitle,
          params: {
            ...screenBaseParams,
            generateInstruction: cleanPrompt,
            ...(matchedClean.length
              ? {
                  generatedImages: matchedClean.map((item, idx) => ({
                    id: item.id || `${cleanImgId}:${idx}`,
                    title: item.title,
                    dataUrl: item.dataUrl ?? '',
                    relativePath: item.relativePath,
                    createdAt: item.createdAt ?? new Date().toISOString()
                  })),
                  selectedImageId: matchedClean[matchedClean.length - 1]?.id ?? ''
                }
              : {})
          }
        }
      )
    )
    nodes.push({
      id: cleanOutId,
      typeId: GRAPH_BOUNDARY_OUTPUT_TYPE_ID,
      category: 'note',
      position: { x: 920, y },
      title: cleanTitle,
      params: {
        previewCollapsed: true,
        hostBoundaryPort: {
          portId: portOutClean,
          dataType: GraphPortType.image,
          multiple: false
        }
      }
    })
    edges.push({
      id: `ui-e-in-${slot}`,
      source: inId,
      target: imgId,
      sourcePort: 'out',
      // 图片生成节点的文本输入口为 in-text（in 仅用于引用类单值口）
      targetPort: 'in-text'
    })
    edges.push({
      id: `ui-e-out-${slot}`,
      source: imgId,
      target: outId,
      sourcePort: 'out',
      targetPort: 'in'
    })
    // 带字精修图默认接到同屏底图节点的图片输入：底图以本屏带字图为基准去字，
    // 与 buildTextlessUiPrompt 的「与本图带字版完全一致」措辞对应，避免两条轨各画各的布局
    edges.push({
      id: `ui-e-clean-ref-${slot}`,
      source: imgId,
      target: cleanImgId,
      sourcePort: 'out',
      targetPort: 'in-image'
    })
    edges.push({
      id: `ui-e-clean-${slot}`,
      source: cleanImgId,
      target: cleanOutId,
      sourcePort: 'out',
      targetPort: 'in'
    })
  }
  return { nodes, edges, groups: [], viewport: { x: 0, y: 0, zoom: 1 } }
}

function slugify(raw: string, index: number): string {
  const base = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return `ui-${base || `screen-${index + 1}`}`
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** 常见对象包裹键，兼容模型输出 {"screens": [...]} 等非标准形式 */
const WRAPPER_KEYS = ['screens', 'items', 'list', 'interfaces', 'ui', 'data', 'result', 'output']

function tryParseArray(text: string): unknown | null {
  try {
    return JSON.parse(text)
  } catch {
    // 容错：截取首个 [...] 再试（兼容对象包裹 / 前后附带说明文字）
    const start = text.indexOf('[')
    const end = text.lastIndexOf(']')
    if (start < 0 || end <= start) return null
    try {
      return JSON.parse(text.slice(start, end + 1))
    } catch {
      return null
    }
  }
}

function normalizeUiScreenRows(parsed: unknown[]): UiScreenPromptItem[] {
  const seen = new Set<string>()
  const items: UiScreenPromptItem[] = []
  for (let i = 0; i < parsed.length; i += 1) {
    const row = parsed[i]
    let title = ''
    let prompt = ''
    let cleanPrompt = ''
    let rawScreenKind: unknown
    let rawAspectRatio: unknown
    let layerPrompt = ''
    let id = ''
    if (typeof row === 'string') {
      prompt = row.trim()
      title = `界面 ${i + 1}`
    } else if (row && typeof row === 'object') {
      const obj = row as Record<string, unknown>
      title = asString(obj.title) || asString(obj.name) || asString(obj.screen) || `界面 ${i + 1}`
      prompt =
        asString(obj.prompt) ||
        asString(obj.text) ||
        asString(obj.content) ||
        asString(obj.description)
      // 空字底图轨：模型直接输出两套提示词时随行携带
      cleanPrompt = asString(obj.cleanPrompt) || asString(obj.textlessPrompt) || asString(obj.clean)
      rawScreenKind = obj.screenKind ?? obj.kind ?? obj.type
      rawAspectRatio = obj.aspectRatio ?? obj.ratio ?? obj.orientation
      layerPrompt =
        asString(obj.layerPrompt) ||
        asString(obj.layerSplitPrompt) ||
        asString(obj.psdPrompt) ||
        asString(obj.layers)
      id = asString(obj.id)
    }
    if (!prompt) continue
    let nextId = id || slugify(title, i)
    if (seen.has(nextId)) nextId = `${nextId}-${i + 1}`
    seen.add(nextId)
    const item: UiScreenPromptItem = { id: nextId, title, prompt }
    if (cleanPrompt) item.cleanPrompt = cleanPrompt
    const screenKind = normalizeUiScreenKind(rawScreenKind, title, prompt)
    if (screenKind) item.screenKind = screenKind
    const aspectRatio = normalizeUiScreenAspectRatio(rawAspectRatio, prompt, title)
    if (aspectRatio) item.aspectRatio = aspectRatio
    if (layerPrompt) item.layerPrompt = layerPrompt
    items.push(item)
  }
  return items
}

/** 容错：模型忽略 JSON 要求、输出 markdown 列表（- / * / 1. 标题：提示词）时逐行转条目 */
function parseUiScreenMarkdownList(text: string): UiScreenPromptItem[] {
  const items: UiScreenPromptItem[] = []
  const seen = new Set<string>()
  let index = 0
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*(?:[-*•]|\d+[.、)])\s*(.*)$/.exec(line)
    if (!match) continue
    const body = match[1]
      .replace(/\*\*([^*]*)\*\*/g, '$1')
      .replace(/`([^`]*)`/g, '$1')
      .trim()
    if (!body) continue
    const sep = body.search(/[:：]/)
    const title = sep > 0 ? body.slice(0, sep).trim() : `界面 ${index + 1}`
    const prompt = sep > 0 ? body.slice(sep + 1).trim() : body
    if (!prompt) continue
    let nextId = slugify(title, index)
    if (seen.has(nextId)) nextId = `${nextId}-${index + 1}`
    seen.add(nextId)
    items.push({ id: nextId, title, prompt })
    index += 1
  }
  return items
}

/**
 * 解析 UI 界面拆分模型输出：JSON 数组，每项含 title + prompt（可含 cleanPrompt 空字轨），
 * 或纯字符串。
 */
export function parseUiScreenPrompts(raw: string): UiScreenPromptItem[] {
  const text = stripJsonCodeFence(raw)
  if (!text) return []

  let parsed = tryParseArray(text)

  // 容错：模型用对象包裹数组（{"screens": [...]} 等）
  if (parsed && !Array.isArray(parsed) && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>
    const wrapped =
      WRAPPER_KEYS.map((key) => obj[key]).find((value) => Array.isArray(value)) ??
      Object.values(obj).find((value) => Array.isArray(value))
    if (Array.isArray(wrapped)) parsed = wrapped
  }

  if (Array.isArray(parsed)) return normalizeUiScreenRows(parsed)

  // 容错：模型输出 markdown 列表时逐行兜底
  return parseUiScreenMarkdownList(text)
}
