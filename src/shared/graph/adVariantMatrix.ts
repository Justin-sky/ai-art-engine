/**
 * 广告素材变体矩阵：一个产品/主体 × 若干维度（机位角度/钩子文案/视觉风格等），
 * 展开为「单元格 = 一组维度取值 + 生成提示词」，用于批量生成与 A/B 对比。
 */

import type { ReviewStatus } from './reviewStatus'
import { DEFAULT_REVIEW_STATUS, normalizeReviewStatus } from './reviewStatus'

export interface AdVariantDimension {
  id: string
  /** 维度名，如「机位角度」「钩子文案」「视觉风格」 */
  label: string
  /** 该维度的取值列表，每个取值直接作为提示词片段 */
  values: string[]
}

export interface AdVariantCell {
  id: string
  /** 各维度取值：键 = dimension.id */
  combo: Record<string, string>
  /** 由产品描述 + 各维度取值拼接出的默认生成提示词 */
  prompt: string
  /** 用户针对该单元格单独微调的覆盖提示词（非空时优先于 prompt） */
  customPrompt?: string
  /** 锁定标记：开启后整批重新生成时跳过此单元格，保护满意素材不被覆盖 */
  locked?: boolean
  /** 批量生成结果的相对路径/资产引用，跑完回填 */
  outputRefs: string[]
  /** 当前选中的历史输出索引（默认取最新一张 outputRefs.length - 1） */
  activeOutputIndex?: number
  status: ReviewStatus
  /** A/B 对比结论：入选 / 淘汰；未标记为 undefined */
  verdict?: AdVariantVerdict
  /** 审片备注 / 投放测试批注 */
  note?: string
}

/** 对比视图标记：入选 / 淘汰 */
export type AdVariantVerdict = 'selected' | 'rejected'

export const AD_VARIANT_VERDICTS = ['selected', 'rejected'] as const

/** 下游端口输出过滤策略：all = 全部非淘汰图；selectedOnly = 仅输出标记为入选的图 */
export type AdVariantOutputFilter = 'all' | 'selectedOnly'

export const AD_VARIANT_ASPECT_RATIOS = ['1:1', '9:16', '16:9', '3:4', '4:3', '2.39:1'] as const
export const AD_VARIANT_QUALITY_TIERS = ['1K', '2K', '4K'] as const

/** 归一化对比结论：非法值回落为 undefined（未标记） */
export function normalizeAdVariantVerdict(value: unknown): AdVariantVerdict | undefined {
  if (value === 'selected' || value === '入选') return 'selected'
  if (value === 'rejected' || value === '淘汰') return 'rejected'
  return undefined
}

export function normalizeAdVariantOutputFilter(value: unknown): AdVariantOutputFilter {
  return value === 'selectedOnly' ? 'selectedOnly' : 'all'
}

export interface AdVariantMatrix {
  product: string
  /** 核心卖点与受众痛点补充（如：24h持妆、防水防汗、针对油皮人群） */
  sellingPoints?: string
  /** 促销钩子 / 行动号召视觉提示（如：限时买一赠一、新品首发礼盒） */
  ctaText?: string
  aspectRatio?: string
  quality?: string
  /** 下游输出过滤：all | selectedOnly */
  outputFilter?: AdVariantOutputFilter
  dimensions: AdVariantDimension[]
  cells: AdVariantCell[]
}

export const DEFAULT_AD_VARIANT_MATRIX: AdVariantMatrix = {
  product: '',
  dimensions: [],
  cells: []
}

/** 单元格稳定 id：按维度 id 顺序拼接「id=value」 */
export function adVariantCellId(
  combo: Record<string, string>,
  dimensionIds: readonly string[]
): string {
  const parts = dimensionIds.map((id) => `${id}=${combo[id] ?? ''}`)
  return `cell-${parts.join('|')}`
}

export interface BuildAdVariantPromptOptions {
  sellingPoints?: string
  ctaText?: string
  locale?: string
}

/** 单元格生成提示词：产品描述 + 核心卖点/CTA（可选） + 每个维度的「label：value」 */
export function buildAdVariantCellPrompt(
  product: string,
  entries: ReadonlyArray<{ label: string; value: string }>,
  options?: BuildAdVariantPromptOptions
): string {
  const base = product.trim()
  const selling = options?.sellingPoints?.trim() ?? ''
  const cta = options?.ctaText?.trim() ?? ''
  const isEn = typeof options?.locale === 'string' && options.locale.toLowerCase().startsWith('en')
  const sep = isEn ? ': ' : '：'
  const modifiers = entries
    .map(({ label, value }) => {
      const l = label.trim()
      const v = value.trim()
      if (!v) return ''
      return l ? `${l}${sep}${v}` : v
    })
    .filter(Boolean)
  const extra: string[] = []
  if (selling) extra.push(isEn ? `Core Selling Points: ${selling}` : `核心卖点：${selling}`) // cjk-ok
  if (cta) extra.push(isEn ? `Promo Hook / CTA: ${cta}` : `视觉钩子/CTA：${cta}`) // cjk-ok
  return [base, ...extra, ...modifiers].filter(Boolean).join('\n')
}

/** 获取单元格实际用于生成的提示词（customPrompt 优先于自动合成的 prompt） */
export function getAdVariantCellEffectivePrompt(
  cell: Pick<AdVariantCell, 'prompt' | 'customPrompt'>
): string {
  const custom = cell.customPrompt?.trim()
  return custom || cell.prompt
}

/** 获取单元格当前激活的历史图索引（默认取最新一张 outputRefs.length - 1） */
export function getAdVariantCellActiveIndex(
  cell: Pick<AdVariantCell, 'outputRefs' | 'activeOutputIndex'>
): number {
  const len = cell.outputRefs?.length ?? 0
  if (len <= 0) return -1
  if (
    typeof cell.activeOutputIndex === 'number' &&
    Number.isInteger(cell.activeOutputIndex) &&
    cell.activeOutputIndex >= 0 &&
    cell.activeOutputIndex < len
  ) {
    return cell.activeOutputIndex
  }
  return len - 1
}

/** 获取单元格当前激活的输出图片路径（默认取最新一张，修复旧版固定取 outputRefs[0] 的问题） */
export function getAdVariantCellActiveRef(
  cell: Pick<AdVariantCell, 'outputRefs' | 'activeOutputIndex'>
): string {
  const idx = getAdVariantCellActiveIndex(cell)
  return idx >= 0 ? (cell.outputRefs[idx]?.trim() ?? '') : ''
}

/** 笛卡尔积展开：product × dimensions → cells（忽略无取值的维度） */
export function expandAdVariantMatrix(
  product: string,
  dimensions: AdVariantDimension[],
  options?: BuildAdVariantPromptOptions
): AdVariantCell[] {
  const active = dimensions.filter((d) => d && d.values?.length > 0)
  if (!active.length) return []

  const dimIds = active.map((d) => d.id)
  let combos: Record<string, string>[] = [{}]
  for (const dim of active) {
    const next: Record<string, string>[] = []
    for (const combo of combos) {
      for (const value of dim.values) {
        next.push({ ...combo, [dim.id]: value })
      }
    }
    combos = next
  }

  return combos.map((combo) => ({
    id: adVariantCellId(combo, dimIds),
    combo,
    prompt: buildAdVariantCellPrompt(
      product,
      active.map((d) => ({ label: d.label, value: combo[d.id] ?? '' })),
      options
    ),
    outputRefs: [],
    status: DEFAULT_REVIEW_STATUS
  }))
}

/**
 * 将已存在的单元格状态（outputRefs / verdict / customPrompt / locked / activeOutputIndex / note）
 * 按稳定 cell.id 合并进新展开的单元格列表，避免修改维度或产品描述时丢失已生成图片与审片结论。
 */
export function mergeExpandedAdVariantCells(
  existingCells: ReadonlyArray<AdVariantCell>,
  expandedCells: ReadonlyArray<AdVariantCell>
): AdVariantCell[] {
  const byId = new Map(existingCells.map((c) => [c.id, c]))
  return expandedCells.map((cell) => {
    const prev = byId.get(cell.id)
    if (!prev) return cell
    const outputRefs = [...(prev.outputRefs ?? [])]
    const activeOutputIndex =
      typeof prev.activeOutputIndex === 'number' &&
      prev.activeOutputIndex >= 0 &&
      prev.activeOutputIndex < outputRefs.length
        ? prev.activeOutputIndex
        : undefined
    return {
      ...cell,
      outputRefs,
      status: prev.status ?? cell.status,
      ...(prev.verdict ? { verdict: prev.verdict } : {}),
      ...(prev.customPrompt?.trim() ? { customPrompt: prev.customPrompt.trim() } : {}),
      ...(prev.locked ? { locked: true } : {}),
      ...(activeOutputIndex !== undefined ? { activeOutputIndex } : {}),
      ...(prev.note?.trim() ? { note: prev.note.trim() } : {})
    }
  })
}

/** 从持久化 JSON 归一化出变体矩阵；非法字段回退到默认/空值 */
export function normalizeAdVariantMatrix(raw?: Partial<AdVariantMatrix> | null): AdVariantMatrix {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_AD_VARIANT_MATRIX }

  const dimensions: AdVariantDimension[] = (Array.isArray(raw.dimensions) ? raw.dimensions : [])
    .filter((d): d is AdVariantDimension => !!d && typeof d === 'object')
    .map((d) => ({
      id: typeof d.id === 'string' ? d.id.trim() : '',
      label: typeof d.label === 'string' ? d.label : '',
      values: Array.isArray(d.values)
        ? d.values.filter((v): v is string => typeof v === 'string').map((v) => v.trim())
        : []
    }))
    .filter((d) => d.id)

  const cells: AdVariantCell[] = (Array.isArray(raw.cells) ? raw.cells : [])
    .filter((c): c is AdVariantCell => !!c && typeof c === 'object')
    .map((c) => {
      const outputRefs = Array.isArray(c.outputRefs)
        ? c.outputRefs.filter((r): r is string => typeof r === 'string' && !!r.trim())
        : []
      const verdict = normalizeAdVariantVerdict(c.verdict)
      const customPrompt = typeof c.customPrompt === 'string' ? c.customPrompt.trim() : ''
      const note = typeof c.note === 'string' ? c.note.trim() : ''
      const activeOutputIndex =
        typeof c.activeOutputIndex === 'number' &&
        Number.isInteger(c.activeOutputIndex) &&
        c.activeOutputIndex >= 0 &&
        c.activeOutputIndex < outputRefs.length
          ? c.activeOutputIndex
          : undefined
      return {
        id: typeof c.id === 'string' ? c.id : '',
        combo:
          c.combo && typeof c.combo === 'object' && !Array.isArray(c.combo)
            ? (c.combo as Record<string, string>)
            : {},
        prompt: typeof c.prompt === 'string' ? c.prompt : '',
        outputRefs,
        status: normalizeReviewStatus(c.status),
        ...(verdict ? { verdict } : {}),
        ...(customPrompt ? { customPrompt } : {}),
        ...(c.locked === true ? { locked: true } : {}),
        ...(activeOutputIndex !== undefined ? { activeOutputIndex } : {}),
        ...(note ? { note } : {})
      }
    })
    .filter((c) => c.id)

  const sellingPoints = typeof raw.sellingPoints === 'string' ? raw.sellingPoints.trim() : ''
  const ctaText = typeof raw.ctaText === 'string' ? raw.ctaText.trim() : ''
  const aspectRatio = typeof raw.aspectRatio === 'string' ? raw.aspectRatio.trim() : ''
  const quality = typeof raw.quality === 'string' ? raw.quality.trim() : ''
  const outputFilter =
    raw.outputFilter === 'selectedOnly' || raw.outputFilter === 'all' ? raw.outputFilter : undefined

  return {
    product: typeof raw.product === 'string' ? raw.product : '',
    ...(sellingPoints ? { sellingPoints } : {}),
    ...(ctaText ? { ctaText } : {}),
    ...(aspectRatio ? { aspectRatio } : {}),
    ...(quality ? { quality } : {}),
    ...(outputFilter ? { outputFilter } : {}),
    dimensions,
    cells
  }
}

/** 从节点 params 读取变体矩阵（节点内存储，随 .asset.json 落盘） */
export function readAdVariantMatrixFromNode(params: {
  adVariantMatrix?: Partial<AdVariantMatrix> | null
}): AdVariantMatrix {
  return normalizeAdVariantMatrix(params?.adVariantMatrix)
}

/**
 * 把本批生成结果的相对路径回填到对应单元格的 outputRefs（按批内顺序与 cellId 对齐）。
 * 纯函数，便于单测；重复运行会追加而非覆盖（与图库累积行为一致），并将 activeOutputIndex 指向最新生成的一张。
 */
export function applyAdVariantOutputRefs(
  cells: AdVariantCell[],
  cellIdsInOrder: string[],
  relativePathsInOrder: string[]
): AdVariantCell[] {
  const byCell = new Map<string, string[]>()
  for (let i = 0; i < relativePathsInOrder.length; i++) {
    const cellId = cellIdsInOrder[i]
    const path = relativePathsInOrder[i]?.trim()
    if (cellId && path) {
      const arr = byCell.get(cellId) ?? []
      arr.push(path)
      byCell.set(cellId, arr)
    }
  }
  return cells.map((cell) => {
    const refs = byCell.get(cell.id)
    if (!refs?.length) return cell
    const nextRefs = [...cell.outputRefs, ...refs]
    return {
      ...cell,
      outputRefs: nextRefs,
      activeOutputIndex: nextRefs.length - 1
    }
  })
}

/**
 * 纯函数：把某个单元格的对比结论（入选/淘汰/清除）写回 cells。
 * 传入 undefined 表示取消标记。
 */
export function withAdVariantCellVerdict(
  cells: AdVariantCell[],
  cellId: string,
  verdict: AdVariantVerdict | undefined
): AdVariantCell[] {
  return cells.map((cell) => (cell.id === cellId ? { ...cell, verdict } : cell))
}

/**
 * 根据单元格的对比结论（selected / rejected）与 outputFilter 计算向下游端口输出的圖片路径：
 * - primaryPath（`out` 单图端口）：优先取第一个标记为 `selected`（入选）单元格的当前激活图；若无入选则取第一个未淘汰单元格的激活图。
 * - allPaths（`out-all` 列表端口）：当 `outputFilter === 'selectedOnly'` 且存在已入选单元格时，仅向下游传递已入选变体；否则传递全部未淘汰变体（若全部被标为淘汰则兜底返回全部已生成图）。
 */
export function resolveAdVariantDownstreamPaths(
  cells: ReadonlyArray<AdVariantCell>,
  outputFilter: AdVariantOutputFilter = 'all'
): { primaryPath: string; allPaths: string[] } {
  const selectedPaths: string[] = []
  const nonRejectedPaths: string[] = []
  const allGeneratedPaths: string[] = []

  for (const cell of cells) {
    const activeRef = getAdVariantCellActiveRef(cell)
    if (!activeRef) continue
    allGeneratedPaths.push(activeRef)
    if (cell.verdict === 'selected') {
      selectedPaths.push(activeRef)
    }
    if (cell.verdict !== 'rejected') {
      nonRejectedPaths.push(activeRef)
    }
  }

  const primaryPath = selectedPaths[0] ?? nonRejectedPaths[0] ?? allGeneratedPaths[0] ?? ''
  let allPaths: string[]
  if (outputFilter === 'selectedOnly' && selectedPaths.length > 0) {
    allPaths = selectedPaths
  } else if (nonRejectedPaths.length > 0) {
    allPaths = nonRejectedPaths
  } else {
    allPaths = allGeneratedPaths
  }

  return { primaryPath, allPaths }
}

export type AdVariantPresetGroup = 'general' | 'industry' | 'promotion'

export interface AdVariantPresetDef {
  id: string
  /** i18n key suffix under graph.adVariants.presets.* */
  titleKey: string
  group: AdVariantPresetGroup
  /** 预设维度（label + 取值列表）；应用时替换当前维度 */
  dimensions: Array<{ label: string; values: string[] }>
  /** 英文版预设维度 */
  dimensionsEn?: Array<{ label: string; values: string[] }>
}

/** 预设分组顺序（labelKey under graph.adVariants.presetGroups.*） */
export const AD_VARIANT_PRESET_GROUPS: readonly {
  id: AdVariantPresetGroup
  labelKey: string
}[] = [
  { id: 'general', labelKey: 'general' },
  { id: 'industry', labelKey: 'industry' },
  { id: 'promotion', labelKey: 'promotion' }
]

/** 广告素材常用变体维度预设（面向同一单品的多维创意 A/B 测试） */
export const AD_VARIANT_PRESETS: readonly AdVariantPresetDef[] = [
  {
    id: 'basic-ab',
    titleKey: 'basicAb',
    group: 'general',
    dimensions: [
      {
        label: '卖点视觉焦点',
        values: ['核心成分/材质微距特写', '使用前后效果对比感', '礼盒全套陈列展示']
      }, // cjk-ok
      { label: '视觉风格', values: ['极简高定摄影棚', '清新自然生活流', '高对比杂志大片感'] } // cjk-ok
    ],
    dimensionsEn: [
      {
        label: 'Selling Point Focus',
        values: [
          'Macro close-up of core ingredient/texture',
          'Before & after efficacy contrast',
          'Full gift set hero display'
        ]
      },
      {
        label: 'Visual Style',
        values: [
          'Minimalist couture studio',
          'Fresh natural lifestyle',
          'High-contrast magazine editorial'
        ]
      }
    ]
  },
  {
    id: 'camera-angle',
    titleKey: 'cameraAngle',
    group: 'general',
    dimensions: [
      {
        label: '机位角度',
        values: [
          '正面平视英雄位',
          '45°斜侧立体透视',
          '桌面俯拍平铺（Flat Lay）',
          '低角度仰拍气场感'
        ]
      }, // cjk-ok
      {
        label: '景别构图',
        values: ['黄金分割中景', '微距局部质感特写', '带环境留白全景（预留排版区）']
      } // cjk-ok
    ],
    dimensionsEn: [
      {
        label: 'Camera Angle',
        values: [
          'Front eye-level hero shot',
          '45° three-quarter perspective',
          'Top-down flat lay',
          'Low-angle commanding hero shot'
        ]
      },
      {
        label: 'Framing & Scale',
        values: [
          'Golden-ratio medium shot',
          'Extreme macro texture close-up',
          'Wide shot with negative space for copy'
        ]
      }
    ]
  },
  {
    id: 'scene-tone',
    titleKey: 'sceneTone',
    group: 'general',
    dimensions: [
      {
        label: '背景场景',
        values: ['纯净几何展台静物', '现代极简居家桌面', '户外阳光自然绿植', '都市霓虹夜景氛围']
      }, // cjk-ok
      { label: '光影色调', values: ['晨间柔和暖阳', '清冷通透实验室光', '高反差戏剧轮廓光'] } // cjk-ok
    ],
    dimensionsEn: [
      {
        label: 'Background Scene',
        values: [
          'Clean geometric podium still life',
          'Modern minimalist home tabletop',
          'Outdoor sunlit botanical greenery',
          'Urban neon night ambiance'
        ]
      },
      {
        label: 'Lighting & Tone',
        values: [
          'Soft warm morning sunlight',
          'Crisp cool laboratory lighting',
          'High-contrast dramatic rim light'
        ]
      }
    ]
  },
  {
    id: 'audience-emotion',
    titleKey: 'audienceEmotion',
    group: 'general',
    dimensions: [
      {
        label: '目标受众代入',
        values: ['精致都市白领使用场景', '潮流Z世代街头张力', '温馨品质家庭生活']
      }, // cjk-ok
      { label: '情绪氛围', values: ['松弛治愈感', '活力多巴胺撞色', '黑金奢华尊享感'] } // cjk-ok
    ],
    dimensionsEn: [
      {
        label: 'Target Audience Persona',
        values: [
          'Refined urban professional routine',
          'Trendy Gen-Z street energy',
          'Warm quality family lifestyle'
        ]
      },
      {
        label: 'Mood & Vibe',
        values: [
          'Relaxed healing calm',
          'Vibrant dopamine color pop',
          'Black-and-gold luxury prestige'
        ]
      }
    ]
  },
  {
    id: 'copy-style',
    titleKey: 'copyStyle',
    group: 'general',
    dimensions: [
      {
        label: '创意切角（Hook）',
        values: [
          '直击痛点场景还原',
          '感官冲击（水花/光效/爆汁）',
          '专业科研背书质感',
          '开箱惊喜仪式感'
        ]
      }, // cjk-ok
      {
        label: '版式构图留白',
        values: ['居中聚焦主体', '左图右留白（适合横版信息流）', '上留白下主体（适合竖屏大字标题）']
      } // cjk-ok
    ],
    dimensionsEn: [
      {
        label: 'Creative Hook',
        values: [
          'Pain-point scenario visualization',
          'Sensory impact (splash/particles/glow)',
          'Clinical R&D authority look',
          'Unboxing ceremony surprise'
        ]
      },
      {
        label: 'Copy Space Layout',
        values: [
          'Centered hero focus',
          'Subject left + right copy space (landscape feed)',
          'Top copy space + bottom hero (vertical feed)'
        ]
      }
    ]
  },
  {
    id: 'vertical',
    titleKey: 'vertical',
    group: 'general',
    dimensions: [
      {
        label: '竖屏首帧构图',
        values: [
          '手持产品第一视角（POV）',
          '人物近景手持展示',
          '视觉奇观微距冲击',
          '三分法上下对比构图'
        ]
      }, // cjk-ok
      { label: '买量转化氛围', values: ['真实种草原生感', '强促销爆款吸睛感', '高审美品牌质感'] } // cjk-ok
    ],
    dimensionsEn: [
      {
        label: 'Vertical First-Frame Hook',
        values: [
          'First-person POV holding product',
          'Talent close-up holding product',
          'Scroll-stopping macro spectacle',
          'Rule-of-thirds split contrast'
        ]
      },
      {
        label: 'Conversion Vibe',
        values: [
          'Authentic UGC review feel',
          'High-urgency bestseller promo feel',
          'Elevated brand campaign aesthetic'
        ]
      }
    ]
  },
  {
    id: 'beauty',
    titleKey: 'beauty',
    group: 'industry',
    dimensions: [
      {
        label: '质地与呈现',
        values: [
          '瓶身+水润精华流体微距',
          '膏体/粉质一抹延展特写',
          '水面波纹涟漪悬浮展台',
          '模特脸部水光肌同框'
        ]
      }, // cjk-ok
      {
        label: '护肤美学风格',
        values: ['清透冰川水光感', '植萃自然草本风', '实验室成分极简风', '鎏金高定奢宠风']
      } // cjk-ok
    ],
    dimensionsEn: [
      {
        label: 'Texture & Presentation',
        values: [
          'Bottle + dewy serum droplet macro',
          'Cream/powder swatch smear close-up',
          'Floating podium over water ripples',
          'Model glowing glass-skin frame'
        ]
      },
      {
        label: 'Skincare Aesthetic',
        values: [
          'Crystal glacier hydration',
          'Botanical herbal naturalism',
          'Clinical lab minimalist',
          'Gilded luxury couture'
        ]
      }
    ]
  },
  {
    id: 'electronics',
    titleKey: 'electronics',
    group: 'industry',
    dimensions: [
      {
        label: '产品展示维度',
        values: [
          '金属机身精工微距特写',
          '悬浮结构光影陈列',
          '极客桌面（Desk Setup）实景',
          '户外便携高频使用瞬间'
        ]
      }, // cjk-ok
      {
        label: '科技光效氛围',
        values: ['冷冽钛金属暗调光', '极简苹果风纯白柔光', '赛博霓虹电竞光效']
      } // cjk-ok
    ],
    dimensionsEn: [
      {
        label: 'Product Showcase',
        values: [
          'Precision anodized metal macro',
          'Floating levitation hero display',
          'Minimalist creator desk setup',
          'On-the-go outdoor usage moment'
        ]
      },
      {
        label: 'Tech Lighting',
        values: [
          'Cold titanium dark-mode rim light',
          'Ultra-clean white studio softbox',
          'Cyberpunk RGB neon glow'
        ]
      }
    ]
  },
  {
    id: 'food',
    titleKey: 'food',
    group: 'industry',
    dimensions: [
      {
        label: '食欲感镜头',
        values: [
          '食材飞溅/爆汁高速快门瞬间',
          '热气腾腾刚出锅微距特写',
          '原产地新鲜原料环绕摆盘',
          '多人欢聚分享餐桌视角'
        ]
      }, // cjk-ok
      { label: '美食光影色调', values: ['清新夏日冰爽感', '暖调深夜食堂治愈感', '阳光早餐元气感'] } // cjk-ok
    ],
    dimensionsEn: [
      {
        label: 'Appetite Appeal Shot',
        values: [
          'High-speed juicy splash/burst',
          'Steaming hot fresh-cooked macro',
          'Surrounded by fresh raw ingredients',
          'Tabletop sharing feast perspective'
        ]
      },
      {
        label: 'Food Color & Lighting',
        values: [
          'Crisp summer icy refreshment',
          'Warm late-night comfort glow',
          'Sunny morning breakfast vibrancy'
        ]
      }
    ]
  },
  {
    id: 'fashion',
    titleKey: 'fashion',
    group: 'industry',
    dimensions: [
      {
        label: '穿搭呈现方式',
        values: [
          '街拍动态抓拍全身',
          '影棚几何光影半身像',
          '面料纹理与剪裁细节微距',
          '杂志感精致平铺搭配'
        ]
      }, // cjk-ok
      {
        label: '时尚风格语境',
        values: [
          '老钱风极简松弛（Old Money）',
          '美式复古街头潮流',
          '高智感都市通勤',
          '法式浪漫假日'
        ]
      } // cjk-ok
    ],
    dimensionsEn: [
      {
        label: 'Styling Presentation',
        values: [
          'Dynamic street-style full-body candid',
          'Studio geometric shadow half-body',
          'Fabric weave & tailoring macro',
          'Editorial curated flat-lay outfit'
        ]
      },
      {
        label: 'Fashion Aesthetic',
        values: [
          'Quiet luxury Old Money minimalism',
          'Vintage American streetwear',
          'Smart urban commuter chic',
          'Effortless French holiday romance'
        ]
      }
    ]
  },
  {
    id: 'baby',
    titleKey: 'baby',
    group: 'industry',
    dimensions: [
      {
        label: '安心感卖点画面',
        values: [
          '云朵般柔肤材质微距对比',
          '宝宝酣睡/开怀互动特写',
          '天然温和成分视觉化元素',
          '母婴外出便捷收纳实景'
        ]
      }, // cjk-ok
      {
        label: '亲子色彩氛围',
        values: ['马卡龙柔和粉彩', '阳光原木温馨居家', '纯净安全医护白绿调']
      } // cjk-ok
    ],
    dimensionsEn: [
      {
        label: 'Gentle Care Visual',
        values: [
          'Cloud-soft material macro comparison',
          'Peaceful sleeping / smiling baby close-up',
          'Natural gentle ingredient motifs',
          'Organized on-the-go parenting scene'
        ]
      },
      {
        label: 'Nursery Palette',
        values: [
          'Soft pastel macaron tones',
          'Sunlit warm wood nursery',
          'Pure clinical white & sage green'
        ]
      }
    ]
  },
  {
    id: 'home',
    titleKey: 'home',
    group: 'industry',
    dimensions: [
      {
        label: '空间搭配视角',
        values: [
          '落地窗采光客厅主视觉',
          '材质肌理与做工微距',
          '小户型整洁收纳前后感',
          '夜晚暖光氛围角落'
        ]
      }, // cjk-ok
      {
        label: '家装美学流派',
        values: ['北欧原木自然风', '意式现代极简轻奢', '法式温柔奶油风', '中古侘寂艺术风']
      } // cjk-ok
    ],
    dimensionsEn: [
      {
        label: 'Interior Perspective',
        values: [
          'Sunlit floor-to-ceiling window living room',
          'Material grain & craftsmanship macro',
          'Compact space tidy organization',
          'Cozy warm evening reading corner'
        ]
      },
      {
        label: 'Interior Style',
        values: [
          'Nordic natural oak',
          'Italian modern minimalist luxury',
          'Soft French cream aesthetic',
          'Mid-century Wabi-Sabi art'
        ]
      }
    ]
  },
  {
    id: 'auto',
    titleKey: 'auto',
    group: 'industry',
    dimensions: [
      {
        label: '镜头机位',
        values: [
          '低趴前脸45°动态追焦',
          '奢华座舱中控与座椅细节',
          '山海公路驰骋航拍全景',
          '车灯矩阵暗夜点亮特写'
        ]
      }, // cjk-ok
      {
        label: '环境光影',
        values: ['城市CBD蓝调时刻夜景', '旷野雪山日出金光', '极简未来感几何光棚']
      } // cjk-ok
    ],
    dimensionsEn: [
      {
        label: 'Camera Placement',
        values: [
          'Low-slung 45° front tracking shot',
          'Luxury cockpit console & stitching detail',
          'Coastal mountain highway aerial wide',
          'Matrix headlight signature in dark'
        ]
      },
      {
        label: 'Environment Lighting',
        values: [
          'CBD blue-hour cityscape',
          'Alpine sunrise golden hour',
          'Futuristic geometric light tunnel'
        ]
      }
    ]
  },
  {
    id: 'pet',
    titleKey: 'pet',
    group: 'industry',
    dimensions: [
      {
        label: '萌宠互动画面',
        values: [
          '猫咪/狗狗大口进食满足特写',
          '宠物广角大头萌态贴镜',
          '人宠温馨拥抱居家瞬间',
          '天然鲜肉原料与产品同框'
        ]
      }, // cjk-ok
      { label: '画面情绪色调', values: ['明快多巴胺活力色', '午后阳光地毯暖调', '清新草地自然感'] } // cjk-ok
    ],
    dimensionsEn: [
      {
        label: 'Pet Interaction',
        values: [
          'Happy cat/dog eating close-up',
          'Wide-angle cute nose-to-lens portrait',
          'Warm owner-pet cuddle at home',
          'Fresh natural ingredients beside product'
        ]
      },
      {
        label: 'Color Mood',
        values: [
          'Playful bright dopamine colors',
          'Warm afternoon sunlit rug',
          'Fresh green lawn outdoor vibe'
        ]
      }
    ]
  },
  {
    id: 'education',
    titleKey: 'education',
    group: 'industry',
    dimensions: [
      {
        label: '学习场景表现',
        values: [
          '专注高效书桌沉浸式学习',
          '亲子共读启发互动瞬间',
          'AI科技感智慧屏幕辅助',
          '拿到成果自信微笑特写'
        ]
      }, // cjk-ok
      { label: '视觉风格', values: ['专业名校知性蓝调', '趣味绘本多彩插画感', '温暖陪伴书香暖光'] } // cjk-ok
    ],
    dimensionsEn: [
      {
        label: 'Learning Scenario',
        values: [
          'Focused immersive study desk',
          'Parent-child interactive reading',
          'AI smart screen assisted learning',
          'Confident achiever smile portrait'
        ]
      },
      {
        label: 'Visual Tone',
        values: [
          'Academic prestigious navy blue',
          'Playful colorful storybook vibe',
          'Warm library reading lamp glow'
        ]
      }
    ]
  },
  {
    id: 'travel',
    titleKey: 'travel',
    group: 'industry',
    dimensions: [
      {
        label: '目的地体验视角',
        values: [
          '无边泳池面朝大海背影',
          '雪山森林徒步壮丽全景',
          '古城人间烟火街巷漫步',
          '精致露营篝火晚霞'
        ]
      }, // cjk-ok
      {
        label: '胶片与色彩氛围',
        values: ['高饱和度蔚蓝假日感', '富士胶片日系清新感', '国家地理史诗电影感']
      } // cjk-ok
    ],
    dimensionsEn: [
      {
        label: 'Destination Experience',
        values: [
          'Infinity pool overlooking turquoise ocean',
          'Epic alpine forest trekking panorama',
          'Historic old-town lantern street stroll',
          'Glamping campfire at sunset'
        ]
      },
      {
        label: 'Film & Color Grade',
        values: [
          'Vibrant Mediterranean azure holiday',
          'Airy Fujifilm daylight pastel',
          'Cinematic National Geographic epic'
        ]
      }
    ]
  },
  {
    id: 'health',
    titleKey: 'health',
    group: 'industry',
    dimensions: [
      {
        label: '健康价值视觉化',
        values: [
          '高纯度胶囊/饮品通透微距',
          '清晨运动后充沛活力状态',
          '科学分子结构与草本精粹同框',
          '全家三代健康守护场景'
        ]
      }, // cjk-ok
      {
        label: '信赖感色调',
        values: ['纯净瑞士医学白蓝调', '有机生态森林绿调', '温润东方滋补金棕调']
      } // cjk-ok
    ],
    dimensionsEn: [
      {
        label: 'Wellness Visualization',
        values: [
          'Translucent softgel/elixir macro',
          'Energetic morning post-workout glow',
          'Molecular structure + botanical extract',
          'Multi-generational family wellness'
        ]
      },
      {
        label: 'Trust Palette',
        values: [
          'Swiss clinical white & cyan',
          'Organic forest botanical green',
          'Warm herbal amber & gold'
        ]
      }
    ]
  },
  {
    id: 'realestate',
    titleKey: 'realestate',
    group: 'industry',
    dimensions: [
      {
        label: '空间价值呈现',
        values: [
          '270°环幕落地窗城市天际线',
          '大师级园林水景归家动线',
          '高定厨房与岛台生活场景',
          '黄昏万家灯火建筑立面'
        ]
      }, // cjk-ok
      { label: '光影质感', values: ['香槟金晨昏暖调', '高定酒店感静谧光影', '生机盎然森系自然光'] } // cjk-ok
    ],
    dimensionsEn: [
      {
        label: 'Space Value Showcase',
        values: [
          '270° panoramic skyline penthouse view',
          'Master landscaped water courtyard',
          'Bespoke kitchen island lifestyle',
          'Illuminated architectural facade at dusk'
        ]
      },
      {
        label: 'Lighting Atmosphere',
        values: [
          'Champagne gold twilight warmth',
          'Five-star hotel serene ambiance',
          'Lush biophilic natural daylight'
        ]
      }
    ]
  },
  {
    id: 'finance',
    titleKey: 'finance',
    group: 'industry',
    dimensions: [
      {
        label: '核心主题视觉',
        values: [
          '向上生长的金色光影阶梯与盾牌',
          '从容规划未来的精英商务场景',
          '三口之家稳健幸福生活画面',
          '数字化全球资产连接图景'
        ]
      }, // cjk-ok
      { label: '品牌质感', values: ['深海蓝沉稳权威感', '黑金尊贵私行质感', '温暖阳光亲和民生感'] } // cjk-ok
    ],
    dimensionsEn: [
      {
        label: 'Core Visual Metaphor',
        values: [
          'Ascending golden light steps & shield',
          'Confident executive wealth planning',
          'Secure happy family milestone',
          'Global digital asset network'
        ]
      },
      {
        label: 'Brand Prestige',
        values: [
          'Authoritative deep navy blue',
          'Private-banking black & gold',
          'Warm approachable sunlit tone'
        ]
      }
    ]
  },
  {
    id: 'game',
    titleKey: 'game',
    group: 'industry',
    dimensions: [
      {
        label: '买量吸睛构图',
        values: [
          '主角觉醒满屏大招特效冲击',
          '史诗级巨型Boss压迫感对峙',
          '稀有神装/SSR金光爆出瞬间',
          '高颜值角色眼神杀特写'
        ]
      }, // cjk-ok
      {
        label: '美术渲染风格',
        values: [
          'UE5次世代主机级写实',
          '高饱和度二次元番剧感',
          '东方幻想水墨流金国风',
          '赛博朋克霓虹机甲风'
        ]
      } // cjk-ok
    ],
    dimensionsEn: [
      {
        label: 'UA Scroll-Stopping Hook',
        values: [
          'Hero ultimate skill full-screen VFX',
          'Colossal boss showdown perspective',
          'SSR legendary loot golden burst',
          'Charismatic character intense close-up'
        ]
      },
      {
        label: 'Art Rendering Style',
        values: [
          'UE5 next-gen photorealistic',
          'Vibrant anime cel-shaded',
          'Eastern fantasy ink & gold',
          'Cyberpunk neon mecha'
        ]
      }
    ]
  },
  {
    id: 'fitness',
    titleKey: 'fitness',
    group: 'industry',
    dimensions: [
      {
        label: '运动张力瞬间',
        values: [
          '汗水滑落与肌肉线条爆发力特写',
          '清晨城市天际线晨跑剪影',
          '阳光瑜伽室舒展呼吸感',
          '运动装备科技面料微距'
        ]
      }, // cjk-ok
      {
        label: '光影情绪',
        values: ['硬核暗调高反差轮廓光', '清新多巴胺活力自然光', '极简高级运动美学']
      } // cjk-ok
    ],
    dimensionsEn: [
      {
        label: 'Athletic Peak Moment',
        values: [
          'Sweat & muscle power close-up',
          'Sunrise skyline runner silhouette',
          'Sunlit yoga studio mindful stretch',
          'Performance breathable fabric macro'
        ]
      },
      {
        label: 'Lighting Mood',
        values: [
          'Gritty high-contrast gym rim light',
          'Fresh energetic daylight',
          'Sleek minimalist athletic studio'
        ]
      }
    ]
  },
  {
    id: 'daily',
    titleKey: 'daily',
    group: 'industry',
    dimensions: [
      {
        label: '洁净力/品质视觉化',
        values: [
          '绵密微米泡沫包裹水珠微距',
          '污渍瞬间瓦解洁净如新对比',
          '鲜花植萃留香氛围缠绕',
          '极简整洁阳光卫浴/厨房台面'
        ]
      }, // cjk-ok
      {
        label: '色调氛围',
        values: ['透亮薄荷冰蓝洁净感', '春意花果芬芳柔光', '日式极简无印生活感']
      } // cjk-ok
    ],
    dimensionsEn: [
      {
        label: 'Cleaning Power Visual',
        values: [
          'Dense micro-foam & water droplets macro',
          'Instant stain-dissolve sparkle contrast',
          'Botanical floral fragrance aura',
          'Sunlit spotless bathroom/kitchen counter'
        ]
      },
      {
        label: 'Color Atmosphere',
        values: [
          'Crystal mint & ice-blue purity',
          'Spring floral soft pastel glow',
          'Japanese Muji-inspired calm'
        ]
      }
    ]
  },
  {
    id: 'beverage',
    titleKey: 'beverage',
    group: 'industry',
    dimensions: [
      {
        label: '畅饮感官镜头',
        values: [
          '冰块坠入激起晶莹水花高速抓拍',
          '杯壁冷凝水珠与绵密奶盖微距',
          '新鲜水果切片环绕炸裂感',
          '露营/下午茶碰杯微醺瞬间'
        ]
      }, // cjk-ok
      {
        label: '光影色彩',
        values: ['夏日正午阳光穿透冰饮折射', '醇厚油脂丝绒暖调光', '霓虹微醺夜店潮酷光效']
      } // cjk-ok
    ],
    dimensionsEn: [
      {
        label: 'Refreshment Sensory Shot',
        values: [
          'Ice cube plunge crystal splash',
          'Frosted glass condensation macro',
          'Exploding fresh fruit slices',
          'Outdoor camping / afternoon cheers'
        ]
      },
      {
        label: 'Light & Color',
        values: [
          'Midday sun refracting through ice drink',
          'Rich velvety espresso warm glow',
          'Trendy neon lounge bar vibe'
        ]
      }
    ]
  },
  {
    id: 'freshfood',
    titleKey: 'freshfood',
    group: 'industry',
    dimensions: [
      {
        label: '新鲜度特写',
        values: [
          '晨露挂在果皮/菜叶上的微距',
          '切开瞬间饱满多汁纹理特写',
          '高山果园/深海捕捞原产地实景',
          '冷链冰鲜高品质礼盒开箱'
        ]
      }, // cjk-ok
      {
        label: '视觉色调',
        values: ['原生态阳光自然高饱和色', '黑底精品超市高级静物光', '家常烟火气暖光']
      } // cjk-ok
    ],
    dimensionsEn: [
      {
        label: 'Freshness Close-Up',
        values: [
          'Morning dew on fruit skin/leaf macro',
          'Juicy cross-section slice texture',
          'Orchard / deep-sea origin backdrop',
          'Chilled premium gift box unboxing'
        ]
      },
      {
        label: 'Visual Tone',
        values: [
          'Sun-drenched organic natural colors',
          'Dark-background gourmet grocer lighting',
          'Warm home-kitchen comfort light'
        ]
      }
    ]
  },
  {
    id: 'hotel',
    titleKey: 'hotel',
    group: 'industry',
    dimensions: [
      {
        label: '度假心动瞬间',
        values: [
          '推开窗即见山海云雾全景第一视角',
          '高支棉床品与阳光洒入的慵懒清晨',
          '私汤泡池烛光晚霞静谧时刻',
          '特色在地文化下午茶摆盘'
        ]
      }, // cjk-ok
      {
        label: '美学影调',
        values: ['安缦式隐世禅意自然风', '浪漫法式海岛蔚蓝风', '王家卫式复古电影胶片感']
      } // cjk-ok
    ],
    dimensionsEn: [
      {
        label: 'Hospitality Hero Moment',
        values: [
          'First-person window opening to ocean/mountain mist',
          'Crisp linen bedding in lazy morning sun',
          'Private hot-spring pool at twilight candlelight',
          'Artisanal local afternoon tea tray'
        ]
      },
      {
        label: 'Aesthetic Grade',
        values: [
          'Aman-inspired zen sanctuary',
          'Romantic French Riviera azure',
          'Vintage cinematic film warmth'
        ]
      }
    ]
  },
  {
    id: 'livestream',
    titleKey: 'livestream',
    group: 'promotion',
    dimensions: [
      {
        label: '直播间引流画面',
        values: [
          '爆款礼盒堆头量感视觉冲击',
          '手持产品近距离展示质地细节',
          '使用前后强烈视觉反差对比',
          '奢华专柜/源头工厂实景背书'
        ]
      }, // cjk-ok
      {
        label: '转化紧迫感氛围',
        values: ['大促红金聚光灯舞台感', '高亮度纯净美妆灯近景', '源头产地真实原生感']
      } // cjk-ok
    ],
    dimensionsEn: [
      {
        label: 'Livestream Traffic Hook',
        values: [
          'Abundant gift-box tower volume impact',
          'Hand-held close-up showing texture',
          'Dramatic before/after visual contrast',
          'Flagship counter / factory origin proof'
        ]
      },
      {
        label: 'Urgency & Trust Vibe',
        values: [
          'Mega-sale red & gold spotlight stage',
          'Bright beauty ring-light close-up',
          'Raw authentic source origin feel'
        ]
      }
    ]
  },
  {
    id: 'holiday',
    titleKey: 'holiday',
    group: 'promotion',
    dimensions: [
      {
        label: '大促/佳节主题场景',
        values: [
          '双11/618狂欢礼盒丝带环绕展台',
          '国潮新春红金祥云喜庆陈列',
          '浪漫情人节玫瑰星光礼赠氛围',
          '秋日桂花满月东方雅致礼盒'
        ]
      }, // cjk-ok
      {
        label: '光影礼赞感',
        values: ['流光溢彩金粉粒子光效', '温暖团圆烛光暖调', '高定丝绒暗红奢华光影']
      } // cjk-ok
    ],
    dimensionsEn: [
      {
        label: 'Festival / Mega-Sale Scene',
        values: [
          'Mega-sale ribbon & gift podium',
          'Festive red & gold celebration display',
          'Valentine rose & starlight gifting',
          'Autumn full-moon poetic gift set'
        ]
      },
      {
        label: 'Celebration Lighting',
        values: [
          'Shimmering golden bokeh particles',
          'Warm family reunion candlelight',
          'Couture crimson velvet luxury glow'
        ]
      }
    ]
  }
] as const

/** 某分组下的预设（保持 AD_VARIANT_PRESETS 顺序） */
export function listAdVariantPresetsForGroup(group: AdVariantPresetGroup): AdVariantPresetDef[] {
  return AD_VARIANT_PRESETS.filter((item) => item.group === group)
}

/** 应用预设：把预设维度转成带稳定 id 的维度列表（替换当前维度，支持按 locale 自动选用中/英文预设） */
export function applyAdVariantPreset(presetId: string, locale?: string): AdVariantDimension[] {
  const preset = AD_VARIANT_PRESETS.find((item) => item.id === presetId)
  if (!preset) return []
  const isEn = typeof locale === 'string' && locale.toLowerCase().startsWith('en')
  const sourceDims = isEn && preset.dimensionsEn ? preset.dimensionsEn : preset.dimensions
  return sourceDims.map((dim, index) => ({
    id: `d-${preset.id}-${index + 1}`,
    label: dim.label,
    values: [...dim.values]
  }))
}
