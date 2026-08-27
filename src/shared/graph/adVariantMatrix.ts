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
  /** 由产品描述 + 各维度取值拼接出的生成提示词 */
  prompt: string
  /** 批量生成结果的相对路径/资产引用，跑完回填 */
  outputRefs: string[]
  status: ReviewStatus
  /** A/B 对比结论：入选 / 淘汰；未标记为 undefined */
  verdict?: AdVariantVerdict
}

/** 对比视图标记：入选 / 淘汰 */
export type AdVariantVerdict = 'selected' | 'rejected'

export const AD_VARIANT_VERDICTS = ['selected', 'rejected'] as const

/** 归一化对比结论：非法值回落为 undefined（未标记） */
export function normalizeAdVariantVerdict(value: unknown): AdVariantVerdict | undefined {
  if (value === 'selected' || value === '入选') return 'selected'
  if (value === 'rejected' || value === '淘汰') return 'rejected'
  return undefined
}

export interface AdVariantMatrix {
  product: string
  aspectRatio?: string
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

/** 单元格生成提示词：产品描述 + 每个维度的「label：value」 */
export function buildAdVariantCellPrompt(
  product: string,
  entries: ReadonlyArray<{ label: string; value: string }>
): string {
  const base = product.trim()
  const modifiers = entries
    .map(({ label, value }) => {
      const l = label.trim()
      const v = value.trim()
      if (!v) return ''
      return l ? `${l}：${v}` : v
    })
    .filter(Boolean)
  return [base, ...modifiers].filter(Boolean).join('\n')
}

/** 笛卡尔积展开：product × dimensions → cells（忽略无取值的维度） */
export function expandAdVariantMatrix(
  product: string,
  dimensions: AdVariantDimension[]
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
      active.map((d) => ({ label: d.label, value: combo[d.id] ?? '' }))
    ),
    outputRefs: [],
    status: DEFAULT_REVIEW_STATUS
  }))
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
    .map((c) => ({
      id: typeof c.id === 'string' ? c.id : '',
      combo:
        c.combo && typeof c.combo === 'object' && !Array.isArray(c.combo)
          ? (c.combo as Record<string, string>)
          : {},
      prompt: typeof c.prompt === 'string' ? c.prompt : '',
      outputRefs: Array.isArray(c.outputRefs)
        ? c.outputRefs.filter((r): r is string => typeof r === 'string')
        : [],
      status: normalizeReviewStatus(c.status),
      ...(normalizeAdVariantVerdict(c.verdict)
        ? { verdict: normalizeAdVariantVerdict(c.verdict) }
        : {})
    }))
    .filter((c) => c.id)

  return {
    product: typeof raw.product === 'string' ? raw.product : '',
    aspectRatio:
      typeof raw.aspectRatio === 'string' && raw.aspectRatio.trim()
        ? raw.aspectRatio.trim()
        : undefined,
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
 * 纯函数，便于单测；重复运行会追加而非覆盖（与图库累积行为一致）。
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
    return refs?.length ? { ...cell, outputRefs: [...cell.outputRefs, ...refs] } : cell
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

export type AdVariantPresetGroup = 'general' | 'industry' | 'promotion'

export interface AdVariantPresetDef {
  id: string
  /** i18n key suffix under graph.adVariants.presets.* */
  titleKey: string
  group: AdVariantPresetGroup
  /** 预设维度（label + 取值列表）；应用时替换当前维度 */
  dimensions: Array<{ label: string; values: string[] }>
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

/** 广告素材常用变体维度预设 */
export const AD_VARIANT_PRESETS: readonly AdVariantPresetDef[] = [
  {
    id: 'basic-ab',
    titleKey: 'basicAb',
    group: 'general',
    dimensions: [
      { label: '卖点钩子', values: ['限时五折', '新品首发', '买一送一'] },
      { label: '视觉风格', values: ['简约高级感', '活力年轻感'] }
    ]
  },
  {
    id: 'camera-angle',
    titleKey: 'cameraAngle',
    group: 'general',
    dimensions: [
      { label: '机位角度', values: ['正面平视', '45°侧面', '俯拍', '仰拍'] },
      { label: '景别', values: ['全景', '中景', '特写'] }
    ]
  },
  {
    id: 'scene-tone',
    titleKey: 'sceneTone',
    group: 'general',
    dimensions: [
      { label: '场景', values: ['纯色摄影棚', '居家场景', '户外自然光', '都市夜景'] },
      { label: '色调', values: ['暖色调', '冷色调', '高对比黑白'] }
    ]
  },
  {
    id: 'audience-emotion',
    titleKey: 'audienceEmotion',
    group: 'general',
    dimensions: [
      { label: '目标人群', values: ['年轻女性', '都市男性', '家庭用户'] },
      { label: '情绪基调', values: ['温馨治愈', '潮流酷感', '高端奢华'] }
    ]
  },
  {
    id: 'copy-style',
    titleKey: 'copyStyle',
    group: 'general',
    dimensions: [
      { label: '文案钩子', values: ['痛点共鸣', '好奇心悬念', '权威背书', '限时紧迫'] },
      { label: '风格', values: ['专业商务', '俏皮网络语', '故事叙述'] }
    ]
  },
  {
    id: 'vertical',
    titleKey: 'vertical',
    group: 'general',
    dimensions: [
      { label: '构图', values: ['9:16竖屏', '大字标题', '上下分割', '居中聚焦'] },
      { label: '语气', values: ['直接促销', '悬念反转', '情感共鸣', '权威背书'] }
    ]
  },
  {
    id: 'beauty',
    titleKey: 'beauty',
    group: 'industry',
    dimensions: [
      { label: '产品', values: ['精华液', '面霜', '口红', '香水'] },
      { label: '视觉风格', values: ['高级裸妆感', '水光肌', '复古名媛风', '极简药妆风'] }
    ]
  },
  {
    id: 'electronics',
    titleKey: 'electronics',
    group: 'industry',
    dimensions: [
      { label: '展示方式', values: ['整机特写', '产品拆解', '场景使用', '参数对比'] },
      { label: '氛围', values: ['科技蓝调', '极简灰白', '电竞炫彩'] }
    ]
  },
  {
    id: 'food',
    titleKey: 'food',
    group: 'industry',
    dimensions: [
      { label: '呈现方式', values: ['食材特写', '成品摆盘', '食用瞬间', '配料展示'] },
      { label: '氛围', values: ['清新夏日', '温暖居家', '深夜治愈', '元气活力'] }
    ]
  },
  {
    id: 'fashion',
    titleKey: 'fashion',
    group: 'industry',
    dimensions: [
      { label: '拍摄方式', values: ['模特上身', '平铺展示', '街拍场景', '细节特写'] },
      { label: '风格', values: ['极简通勤', '复古文艺', '运动街头', '甜美少女'] }
    ]
  },
  {
    id: 'baby',
    titleKey: 'baby',
    group: 'industry',
    dimensions: [
      { label: '产品', values: ['纸尿裤', '奶粉', '婴儿车', '益智玩具'] },
      { label: '场景', values: ['宝宝日常', '亲子互动', '温馨家庭', '户外出行'] }
    ]
  },
  {
    id: 'home',
    titleKey: 'home',
    group: 'industry',
    dimensions: [
      { label: '产品', values: ['沙发', '床垫', '灯具', '收纳用品'] },
      { label: '风格', values: ['北欧简约', '现代轻奢', '奶油风', '原木自然'] }
    ]
  },
  {
    id: 'auto',
    titleKey: 'auto',
    group: 'industry',
    dimensions: [
      { label: '展示', values: ['整车外观', '内饰细节', '动态行驶', '细节特写'] },
      { label: '场景', values: ['都市通勤', '户外自驾', '展厅静态', '夜间灯光'] }
    ]
  },
  {
    id: 'pet',
    titleKey: 'pet',
    group: 'industry',
    dimensions: [
      { label: '对象', values: ['猫咪', '狗狗', '仓鼠', '观赏鱼'] },
      { label: '场景', values: ['萌宠日常', '互动瞬间', '产品使用', '温馨陪伴'] }
    ]
  },
  {
    id: 'education',
    titleKey: 'education',
    group: 'industry',
    dimensions: [
      { label: '目标', values: ['少儿启蒙', '职场提升', '考证冲刺', '兴趣培养'] },
      { label: '风格', values: ['专业权威', '活泼趣味', '温暖陪伴', '科技互动'] }
    ]
  },
  {
    id: 'travel',
    titleKey: 'travel',
    group: 'industry',
    dimensions: [
      { label: '目的地', values: ['海滨度假', '山川自然', '古城人文', '都市漫步'] },
      { label: '氛围', values: ['治愈度假', '探险刺激', '浪漫蜜月', '亲子同游'] }
    ]
  },
  {
    id: 'health',
    titleKey: 'health',
    group: 'industry',
    dimensions: [
      { label: '产品', values: ['保健品', '医疗器械', '口腔护理', '健康监测'] },
      { label: '风格', values: ['专业可信', '温和关怀', '科技感', '清爽洁净'] }
    ]
  },
  {
    id: 'realestate',
    titleKey: 'realestate',
    group: 'industry',
    dimensions: [
      { label: '户型', values: ['刚需两居', '改善三居', '大平层', '别墅'] },
      { label: '场景', values: ['样板间', '园林景观', '区位配套', '夜景灯光'] }
    ]
  },
  {
    id: 'finance',
    titleKey: 'finance',
    group: 'industry',
    dimensions: [
      { label: '产品', values: ['信用卡', '贷款', '保险', '理财'] },
      { label: '风格', values: ['专业可信', '温馨家庭', '科技数字', '精英商务'] }
    ]
  },
  {
    id: 'game',
    titleKey: 'game',
    group: 'industry',
    dimensions: [
      { label: '题材', values: ['仙侠', '二次元', '射击', '策略'] },
      { label: '风格', values: ['酷炫特效', '国风写实', '像素复古', '赛博朋克'] }
    ]
  },
  {
    id: 'fitness',
    titleKey: 'fitness',
    group: 'industry',
    dimensions: [
      { label: '场景', values: ['健身房', '户外跑步', '瑜伽', '球类运动'] },
      { label: '氛围', values: ['热血燃动', '自律专注', '轻松解压', '活力青春'] }
    ]
  },
  {
    id: 'daily',
    titleKey: 'daily',
    group: 'industry',
    dimensions: [
      { label: '产品', values: ['洗衣液', '洗洁精', '纸品', '清洁工具'] },
      { label: '场景', values: ['厨房', '卫生间', '客厅', '阳台'] }
    ]
  },
  {
    id: 'beverage',
    titleKey: 'beverage',
    group: 'industry',
    dimensions: [
      { label: '产品', values: ['咖啡', '茶饮', '气泡水', '果汁'] },
      { label: '氛围', values: ['清爽冰凉', '醇香浓郁', '元气活力', '微醺放松'] }
    ]
  },
  {
    id: 'freshfood',
    titleKey: 'freshfood',
    group: 'industry',
    dimensions: [
      { label: '品类', values: ['水果', '海鲜', '蔬菜', '肉类'] },
      { label: '呈现', values: ['产地直采', '新鲜特写', '烹饪过程', '餐桌成品'] }
    ]
  },
  {
    id: 'hotel',
    titleKey: 'hotel',
    group: 'industry',
    dimensions: [
      { label: '房型', values: ['海景房', '山景房', '亲子房', '特色民宿'] },
      { label: '氛围', values: ['浪漫度假', '温馨舒适', '轻奢商务', '自然野趣'] }
    ]
  },
  {
    id: 'livestream',
    titleKey: 'livestream',
    group: 'promotion',
    dimensions: [
      { label: '钩子', values: ['价格锚点', '福利预告', '明星同款', '限时抢购'] },
      { label: '场景', values: ['主播讲解', '产品堆头', '效果对比', '开箱体验'] }
    ]
  },
  {
    id: 'holiday',
    titleKey: 'holiday',
    group: 'promotion',
    dimensions: [
      { label: '节日', values: ['双11', '618', '春节', '情人节', '中秋'] },
      { label: '氛围', values: ['喜庆红金', '清新粉彩', '科技未来', '温馨暖黄'] }
    ]
  }
] as const

/** 某分组下的预设（保持 AD_VARIANT_PRESETS 顺序） */
export function listAdVariantPresetsForGroup(
  group: AdVariantPresetGroup
): AdVariantPresetDef[] {
  return AD_VARIANT_PRESETS.filter((item) => item.group === group)
}

/** 应用预设：把预设维度转成带稳定 id 的维度列表（替换当前维度） */
export function applyAdVariantPreset(presetId: string): AdVariantDimension[] {
  const preset = AD_VARIANT_PRESETS.find((item) => item.id === presetId)
  if (!preset) return []
  return preset.dimensions.map((dim, index) => ({
    id: `d-${preset.id}-${index + 1}`,
    label: dim.label,
    values: [...dim.values]
  }))
}
