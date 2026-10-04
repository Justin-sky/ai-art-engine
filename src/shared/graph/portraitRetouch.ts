/**
 * 人像处理（`image.portrait`）参数契约 —— 模型友好版。
 *
 * 这一层是**唯一真相来源**：编辑器 UI、节点卡、执行器、预设导入导出、外部 Agent
 * 全部从 `PORTRAIT_PARAM_SPECS` 派生，避免「UI 加了一个选项、执行器不知道」这类脱钩。
 *
 * 设计口径（v2 起）：
 * - **像素活全部交给图片模型**：节点不再做本地烘焙，参数的唯一去处是**提示词**。
 *   因此参数形态为「分段枚举档位 + 自由描述」，**没有任何连续滑块**
 *   —— 枚举值是稳定的机器可读令牌（`'strong'`），Agent 读写、预设序列化、
 *   两个版本间 diff 都不需要理解 0..100 的语义；
 * - **无破坏性**：全部参数存在 `params.portraitRetouch`，随时可重编辑，
 *   同一个节点参数重复 Cook 得到同样的提示词（模型侧不保证逐像素一致，
 *   这是「调模型」与「本地烘焙」的本质差别，不再承诺可复现出图）；
 * - **`needs` 声明依赖**：某组标了 `needs` 但依赖缺失时，UI 说明原因、
 *   执行器**跳过该组提示词**而不是报错（少修一项好过整张图失败）；
 * - 手动区域（`portraitRegions`）替代原来的逐笔笔刷：模型只认「要修哪里」的
 *   自然语言 + 可选蒙版参考图，逐笔位移数据对模型没有意义。
 */

// ── 档位与分组 ─────────────────────────────────────────────────

/**
 * 档位强度：`off` 恒等于「不动」，是每个档位字段的默认值。
 *
 * 注意 `strong` 用得越多，身份保真与皮肤质感的损失越明显 ——
 * `buildPortraitPrompt` 会据此自动补负面提示，`portraitTierRisk` 供 UI 二次确认。
 */
export type PortraitTier = 'off' | 'light' | 'standard' | 'strong' | 'max'

export const PORTRAIT_TIERS: readonly PortraitTier[] = [
  'off',
  'light',
  'standard',
  'strong',
  'max'
] as const

/** 参数依赖：人脸关键点 / 人像分割 / 人体姿态 */
export type PortraitNeed = 'face' | 'mask' | 'pose'

/** 工具分组 id：与编辑器左侧工具轨一一对应 */
export type PortraitToolGroupId =
  | 'heal'
  | 'skin'
  | 'tone'
  | 'face'
  | 'eyes'
  | 'makeup'
  | 'body'
  | 'light'
  | 'color'
  | 'texture'
  | 'region'
  | 'background'
  | 'idPhoto'
  | 'export'

export interface PortraitToolGroup {
  id: PortraitToolGroupId
  /** i18n key suffix under graph.portrait.groups.* */
  labelKey: string
  icon: string
  /** 依赖（整组）；缺失时跳过整组提示词 */
  needs?: readonly PortraitNeed[]
}

export const PORTRAIT_TOOL_GROUPS: readonly PortraitToolGroup[] = [
  { id: 'heal', labelKey: 'heal', icon: '🩹', needs: ['face'] },
  { id: 'skin', labelKey: 'skin', icon: '🧴', needs: ['face'] },
  { id: 'tone', labelKey: 'tone', icon: '✨', needs: ['face'] },
  { id: 'face', labelKey: 'face', icon: '🙂', needs: ['face'] },
  { id: 'eyes', labelKey: 'eyes', icon: '👁️', needs: ['face'] },
  { id: 'makeup', labelKey: 'makeup', icon: '💄', needs: ['face'] },
  { id: 'body', labelKey: 'body', icon: '🧍', needs: ['pose'] },
  { id: 'light', labelKey: 'light', icon: '💡', needs: ['face'] },
  { id: 'color', labelKey: 'color', icon: '🎚️' },
  { id: 'texture', labelKey: 'texture', icon: '🪶' },
  { id: 'region', labelKey: 'region', icon: '🎯' },
  { id: 'background', labelKey: 'background', icon: '🏞️', needs: ['mask'] },
  { id: 'idPhoto', labelKey: 'idPhoto', icon: '🪪' },
  { id: 'export', labelKey: 'export', icon: '💾' }
] as const

/** 当前参数结构版本：v1 = 旧本地烘焙的 103 个滑块，v2 = 模型档位 */
export const PORTRAIT_RETOUCH_VERSION = 2

// ── 状态 ───────────────────────────────────────────────────────

export interface PortraitRetouchState {
  v: number
  /** 最近一次套用的预设 id（仅用于 UI 高亮，不参与提示词） */
  presetId: string

  // ── 1 修复 ───────────────────────────────────────────────
  /** 祛痘祛斑 */
  blemishRemoval: PortraitTier
  /** 眼周（黑眼圈 / 眼袋） */
  underEye: PortraitTier
  /** 皱纹（抬头纹 / 法令纹 / 颈纹） */
  wrinkles: PortraitTier
  /** 油光 */
  shineRemoval: PortraitTier
  /** 红眼 */
  redEye: PortraitTier
  /** 碎发 */
  strayHair: PortraitTier

  // ── 2 肤质 ───────────────────────────────────────────────
  /** 磨皮 */
  skinSmoothing: PortraitTier
  /** 毛孔纹理保留（越高越保留真实质感，与磨皮互斥） */
  skinTexture: PortraitTier
  /** 肤色均匀 */
  skinEvenness: PortraitTier
  /** 降噪 */
  skinDenoise: PortraitTier

  // ── 3 肤色 ───────────────────────────────────────────────
  /** 美白 */
  skinWhiten: PortraitTier
  /** 红润 */
  skinRosy: PortraitTier
  /** 去黄 */
  skinDeYellow: PortraitTier
  /** 肤色调：暖 / 冷 */
  skinToneWarmth: PortraitWarmthTier

  // ── 4 五官 ───────────────────────────────────────────────
  /** 脸型（瘦脸） */
  faceSlim: PortraitTier
  /** 下颌线 / 颧骨轮廓 */
  jawline: PortraitTier
  /** 下巴 */
  chin: PortraitTier
  /** 眼睛大小 */
  eyeSize: PortraitTier
  /** 眼距 */
  eyeSpacing: PortraitSpacingTier
  /** 双眼皮 */
  doubleEyelid: PortraitTier
  /** 鼻型（鼻梁 / 鼻翼 / 鼻尖） */
  noseShape: PortraitTier
  /** 唇形 */
  lipShape: PortraitTier
  /** 眉毛 */
  brows: PortraitTier

  // ── 5 眼睛 ───────────────────────────────────────────────
  /** 眼神光 */
  catchlight: PortraitTier
  /** 眼白提亮 */
  eyeWhiten: PortraitTier
  /** 瞳孔 */
  pupilSize: PortraitTier

  // ── 6 妆容 ───────────────────────────────────────────────
  /** 妆面类型 */
  makeupStyle: PortraitMakeupStyle
  /** 妆面浓度 */
  makeupIntensity: PortraitTier
  /** 妆面色调 */
  makeupTone: PortraitMakeupTone

  // ── 7 身形 ───────────────────────────────────────────────
  /** 肩颈（美肩 / 美颈） */
  shoulderNeck: PortraitTier
  /** 腰身（瘦身 / 收腰） */
  waistSlim: PortraitTier
  /** 腿长 */
  legLengthen: PortraitTier

  // ── 8 光影 ───────────────────────────────────────────────
  /** 补光 / 阴影提亮 */
  fillLight: PortraitTier
  /** 轮廓光 */
  rimLight: PortraitTier
  /** 面部立体（修容光） */
  faceContour: PortraitTier
  /** 光比：柔 / 强 */
  lightRatio: PortraitLightRatio
  /** 光色温：暖 / 冷 */
  lightTemp: PortraitWarmthTier

  // ── 9 调色 ───────────────────────────────────────────────
  /** 影调（曝光 / 对比 / 高光阴影） */
  toneGrade: PortraitToneGrade
  /** 饱和度（自然饱和度 / 饱和） */
  saturation: PortraitSaturationTier
  /** 色温 */
  colorTemp: PortraitWarmthTier
  /** 色调（绿 → 品） */
  colorTint: PortraitTintTier
  /** 风格滤镜 */
  lutId: PortraitLutId

  // ── 10 质感 ──────────────────────────────────────────────
  /** 锐度 */
  sharpness: PortraitTier
  /** 清晰度（局部对比） */
  clarity: PortraitTier
  /** 胶片颗粒 */
  grain: PortraitTier
  /** 柔焦 */
  softFocus: PortraitTier
  /** 暗角 */
  vignette: PortraitTier

  // ── 11 手动区域 ──────────────────────────────────────────
  /** 手动标注区域（替代旧笔刷笔画） */
  manualRegions: PortraitManualRegion[]
  /** 整张图的补充说明（自由描述，追加到提示词末尾） */
  extraNote: string

  // ── 12 背景 ──────────────────────────────────────────────
  /** 背景处理 */
  bgMode: PortraitBackgroundMode
  /** 背景底色（`color` 时生效，亦可作为证件照底色参考） */
  bgColor: string
  /** 渐变终点（`gradient` 时生效） */
  bgColorTo: string
  /** 自定义背景描述（`prompt` 时生效） */
  bgPrompt: string
  /** 背景虚化 */
  bgBlur: PortraitTier

  // ── 13 证件照 ────────────────────────────────────────────
  /** 规格（模型按规格构图 + 节点按规格裁切） */
  idPhotoSpecId: PortraitIdPhotoSpecId
  /** 底色 */
  idPhotoBg: PortraitIdPhotoBg
  /** 额外产出 5 寸相纸拼版（纯几何，不调模型） */
  idPhotoSheet: boolean

  // ── 14 导出 ──────────────────────────────────────────────
  /** 模型输出尺寸偏好 */
  outputSize: PortraitOutputSize
  /** 证件照 DPI（决定裁切后的像素尺寸） */
  exportDpi: number
}

/** 模型输出尺寸偏好：与 /images 的 resolution 参数同口径 */
export type PortraitOutputSize = 'auto' | '1K' | '2K' | '4K'
export type PortraitWarmthTier = 'off' | 'coolLight' | 'cool' | 'warm' | 'warmStrong'
export type PortraitSpacingTier = 'off' | 'narrow' | 'slightNarrow' | 'slightWide' | 'wide'
export type PortraitLightRatio = 'off' | 'soft' | 'natural' | 'dramatic' | 'hard'
export type PortraitToneGrade =
  'off' | 'brightAiry' | 'natural' | 'highContrast' | 'lowKeyMoody' | 'filmFade'
export type PortraitSaturationTier =
  'off' | 'desaturateSoft' | 'desaturate' | 'boost' | 'boostVivid'
export type PortraitTintTier = 'off' | 'green' | 'slightGreen' | 'slightMagenta' | 'magenta'
export type PortraitLutId =
  | 'none'
  | 'clear'
  | 'warmFilm'
  | 'coolFilm'
  | 'fuji'
  | 'kodak'
  | 'hongkong'
  | 'japanese'
  | 'morandi'
  | 'blackGold'
  | 'bw'
  | 'sepia'
export type PortraitMakeupStyle =
  'none' | 'nude' | 'portrait' | 'bride' | 'child' | 'hongkong' | 'office' | 'stage'
export type PortraitMakeupTone = 'off' | 'cool' | 'natural' | 'warm' | 'rosy'
export type PortraitBackgroundMode = 'keep' | 'color' | 'gradient' | 'prompt' | 'blur'
export type PortraitIdPhotoBg = 'white' | 'blue' | 'red' | 'gradient'
export type PortraitIdPhotoSpecId =
  | 'none'
  | 'oneInch'
  | 'smallOneInch'
  | 'largeOneInch'
  | 'twoInch'
  | 'smallTwoInch'
  | 'passport'
  | 'visa'
  | 'driverLicense'
  | 'socialSecurity'
  | 'custom'

export type PortraitSpecKey =
  | PortraitTierKey
  | PortraitEnumKey
  | PortraitTextKey
  | PortraitColorKey
  | PortraitBooleanKey
  | PortraitNumberKey

/**
 * 分段档位字段的键。
 *
 * 刻意**不**要求「值恰好是标准五档」：色温、眼距、影调、滤镜这类字段的档位名
 * 各自不同（`coolLight` / `narrow` / `filmFade` / `fuji`），但它们与标准五档是
 * **同一种参数形态**（有限、有序、可选、机器可读），因此共用一套渲染与提示词管线，
 * 只是各自带一张片段表（`PortraitTierSpec.phrases`）。
 */
export type PortraitTierKey = {
  [K in keyof PortraitRetouchState]: PortraitRetouchState[K] extends string ? K : never
}[keyof PortraitRetouchState]

/** 具名选项字段与档位字段在「提示词片段」这件事上没有区别，统一收口 */
export type PortraitEnumKey = PortraitTierKey
/** 自由文本字段 */
export type PortraitTextKey = 'extraNote' | 'bgPrompt'
/** 全部字符串型键 */
export type PortraitStringKey = PortraitTierKey
export type PortraitColorKey = 'bgColor' | 'bgColorTo'
export type PortraitNumberKey = {
  [K in keyof PortraitRetouchState]: PortraitRetouchState[K] extends number ? K : never
}[keyof PortraitRetouchState]
export type PortraitBooleanKey = {
  [K in keyof PortraitRetouchState]: PortraitRetouchState[K] extends boolean ? K : never
}[keyof PortraitRetouchState]

// ── 档位文案（提示词片段） ──────────────────────────────────────

/** 档位 → 提示词片段：`off` 恒为空，其余缺项 = 不产出提示词 */
export type PortraitPhrases = Readonly<Partial<Record<string, string>>>

/**
 * 字段 → 片段表。用 `Partial` 而不是全量 `Record`：漏写一个字段应当在运行期表现为
 * 「不产出提示词」，而不是编译期强逼作者随便糊一句凑数（凑出来的句子会真的进提示词）。
 * 完整性由 `tests/portraitRetouchState.test.ts` 的覆盖用例兜住。
 */
export type PortraitTierPhrases = PortraitPhrases

/** 通用四档强度阶梯（`off` 由缺项隐式表达） */
function le(noun: string): PortraitTierPhrases {
  return {
    light: `轻微${noun}`,
    standard: `适度${noun}`,
    strong: `明显${noun}`,
    max: `强烈${noun}`
  }
}

/** 妆容浓度：单独维护后并入下方总表 */
export const PORTRAIT_MAKEUP_INTENSITY_PHRASES: PortraitTierPhrases = {
  light: '妆容轻薄透亮',
  standard: '妆容自然服帖',
  strong: '妆容明显有质感',
  max: '妆容浓郁精致、妆感强烈'
}

/** 色温类（暖 / 冷）字段片段表 */
export const PORTRAIT_WARMTH_PHRASES: PortraitTierPhrases = {
  cool: '明显偏冷',
  coolLight: '略偏冷',
  warm: '轻微偏暖',
  warmStrong: '明显偏暖'
}

/** 冷暖档位名（必须与 PORTRAIT_WARMTH_PHRASES 的键一一对应） */
const WARMTH_OPTIONS = ['cool', 'coolLight', 'warm', 'warmStrong'] as const

/** 眼距：narrow 侧收紧，wide 侧拉开 */
export const PORTRAIT_EYE_SPACING_PHRASES: PortraitTierPhrases = {
  narrow: '双眼明显向中间收紧，保持五官比例自然',
  slightNarrow: '双眼略向中间收紧',
  slightWide: '双眼略向外拉开',
  wide: '双眼明显向外拉开，保持五官比例自然'
}

/** 眼距档位名（必须与 PORTRAIT_EYE_SPACING_PHRASES 的键一一对应） */
const EYE_SPACING_OPTIONS = ['narrow', 'slightNarrow', 'slightWide', 'wide'] as const

/** 光比 */
export const PORTRAIT_LIGHT_RATIO_PHRASES: PortraitTierPhrases = {
  soft: '光比柔和，阴影通透',
  natural: '光比自然，光影层次清晰',
  dramatic: '光比强烈，明暗对比鲜明有戏剧感',
  hard: '光比硬朗，明暗交界清晰立体'
}

/** 影调 */
export const PORTRAIT_TONE_GRADE_PHRASES: PortraitTierPhrases = {
  brightAiry: '高调明亮通透，阴影轻微提亮不留死黑',
  natural: '影调自然，高光阴影过渡平滑',
  highContrast: '影调对比强烈，黑色扎实、高光有力',
  lowKeyMoody: '低调暗部为主，氛围沉静有电影感',
  filmFade: '胶片褪色影调，黑色抬升、层次柔和'
}

/** 饱和度 */
export const PORTRAIT_SATURATION_PHRASES: PortraitTierPhrases = {
  desaturateSoft: '略微降低整体饱和度',
  desaturate: '明显降低整体饱和度，接近低饱和胶片',
  boost: '自然提升色彩饱和度',
  boostVivid: '明显提升色彩饱和度，画面鲜艳'
}

/** 色调（绿 → 品） */
export const PORTRAIT_TINT_PHRASES: PortraitTierPhrases = {
  green: '色调偏绿（胶片感）',
  slightGreen: '色调略微偏绿',
  slightMagenta: '色调略微偏品红',
  magenta: '色调偏品红'
}

/**
 * 通用五档字段的提示词片段表；`off` 永远为空。
 *
 * 用 `Partial` 而不是全量 `Record`：漏写一个字段应当在运行期表现为「不产出提示词」，
 * 而不是编译期强逼作者随便糊一句凑数（凑出来的句子会真的进提示词）。
 * 完整性由 `tests/portraitRetouchState.test.ts` 的覆盖用例兜住。
 */
export const PORTRAIT_TIER_PHRASES: Readonly<
  Partial<Record<PortraitTierKey, PortraitTierPhrases>>
> = {
  // 修复
  blemishRemoval: {
    light: '保留皮肤真实质感，仅点除明显痘印',
    standard: '去除痘印、斑点与瑕疵，保留毛孔与皮肤纹理',
    strong: '彻底去除痘印、斑点、疤痕与杂乱毛孔，但保留皮肤真实纹理',
    max: '完全去除所有痘印、斑点与疤痕，皮肤平整干净'
  },
  underEye: le('淡化黑眼圈与眼袋'),
  wrinkles: {
    light: '轻微淡化细纹',
    standard: '淡化抬头纹、法令纹与颈纹',
    strong: '明显淡化抬头纹、法令纹与颈纹，表情纹保留自然',
    max: '基本抹平抬头纹、法令纹与颈纹，面部保持自然不僵硬'
  },
  shineRemoval: le('去除油光'),
  redEye: {
    light: '修正红眼',
    standard: '修正红眼，虹膜颜色自然',
    strong: '彻底修正红眼并还原自然虹膜',
    max: '彻底修正红眼并还原自然虹膜'
  },
  strayHair: {
    light: '轻微整理边缘碎发',
    standard: '整理边缘碎发，发际线干净',
    strong: '去除全部飞散碎发，发际线整洁',
    max: '去除全部飞散碎发，发际线整洁锐利'
  },

  // 肤质
  skinSmoothing: {
    light: '轻度磨皮，保留皮肤纹理',
    standard: '适度磨皮，肤质细腻但仍保留毛孔',
    strong: '明显磨皮，皮肤光滑细腻',
    max: '深度磨皮，皮肤光滑均匀'
  },
  skinTexture: {
    light: '保留自然毛孔与皮肤微观纹理',
    standard: '保留可辨识的毛孔与皮肤微观纹理，拒绝塑料感',
    strong: '强化毛孔与皮肤微观纹理，呈现真实质感',
    max: '高保真皮肤质感，毛孔与微纹理清晰可见'
  },
  skinEvenness: le('均匀肤色'),
  skinDenoise: le('降低皮肤噪点'),

  // 肤色
  skinWhiten: {
    light: '肤色轻微提亮',
    standard: '肤色白皙透亮，保留自然血色',
    strong: '肤色明显白皙透亮',
    max: '肤色白皙明亮'
  },
  skinRosy: le('增加肤色红润感'),
  skinDeYellow: le('去除肤色的黄气'),
  skinToneWarmth: {
    coolLight: '肤色略偏冷',
    light: '肤色偏暖',
    standard: '肤色明显偏暖',
    strong: '肤色略偏冷调',
    max: '肤色明显偏冷调'
  },

  // 五官
  faceSlim: {
    light: '脸型轻微收窄，保持原有骨相',
    standard: '瘦脸，脸颊略收，下颌显得清晰',
    strong: '明显瘦脸，脸型精致但骨相与身份不变',
    max: '明显瘦脸，脸型窄而精致，骨相与身份不变'
  },
  jawline: {
    light: '下颌线略清晰',
    standard: '下颌线清晰紧致，颧骨略收',
    strong: '下颌线锐利紧致，颧骨收窄，轮廓立体',
    max: '下颌线锐利紧致，颧骨收窄，轮廓非常立体'
  },
  chin: {
    light: '下巴轻微收尖',
    standard: '下巴略收尖，长度自然',
    strong: '下巴明显收尖并略拉长',
    max: '下巴明显收尖且精致'
  },
  eyeSize: {
    light: '眼睛略微放大',
    standard: '眼睛适度放大，眼神有神',
    strong: '眼睛明显放大，双眼皮清晰',
    max: '眼睛明显放大并更有神采'
  },
  eyeSpacing: le('收紧眼距'),
  doubleEyelid: {
    light: '双眼皮轻微加深',
    standard: '双眼皮清晰',
    strong: '双眼皮明显加深',
    max: '双眼皮明显加深并更宽'
  },
  noseShape: {
    light: '鼻型轻微精修',
    standard: '鼻梁略挺、鼻翼略收、鼻尖精致',
    strong: '鼻梁明显挺直、鼻翼收窄、鼻尖精致',
    max: '鼻梁高挺、鼻翼窄、鼻尖非常精致'
  },
  lipShape: {
    light: '唇形轻微修整，唇色自然',
    standard: '唇形饱满对称，唇线清晰',
    strong: '唇形明显饱满立体，唇峰清晰',
    max: '唇形非常饱满立体，唇峰分明'
  },
  brows: {
    light: '眉毛轻微整理',
    standard: '眉毛整齐有形、浓淡自然',
    strong: '眉形清晰立体、浓密有型',
    max: '眉形清晰立体、浓密有型'
  },

  // 眼睛
  catchlight: {
    light: '眼神略带光',
    standard: '眼中加入自然眼神光',
    strong: '眼神光明亮有神',
    max: '眼神明亮通透，有清晰眼神光'
  },
  eyeWhiten: le('提亮眼白'),
  pupilSize: le('加深瞳孔'),

  // 妆容浓度（表见 PORTRAIT_MAKEUP_INTENSITY_PHRASES，单独维护）
  makeupIntensity: PORTRAIT_MAKEUP_INTENSITY_PHRASES,

  // 身形
  shoulderNeck: {
    light: '肩颈轻微舒展',
    standard: '肩线平顺、颈部修长自然',
    strong: '肩线明显平顺、颈部明显修长，头身比例自然',
    max: '肩线平滑、颈部修长，头身比例自然'
  },
  waistSlim: {
    light: '腰身轻微收窄',
    standard: '腰身收窄，身线更流畅',
    strong: '腰身明显收窄，身线流畅自然',
    max: '腰身明显收窄，身线流畅自然'
  },
  legLengthen: {
    light: '腿部轻微拉长',
    standard: '腿部拉长，身材比例更好',
    strong: '腿部明显拉长，身材比例修长',
    max: '腿部明显拉长，身材比例修长'
  },

  // 光影
  fillLight: le('补光并提亮阴影'),
  rimLight: le('加入轮廓光'),
  faceContour: le('加强面部立体感'),
  lightTemp: {
    coolLight: '光线略偏冷',
    light: '光线偏暖',
    standard: '光线明显偏暖',
    strong: '光线略偏冷调',
    max: '光线明显偏冷调'
  },

  // 调色
  colorTemp: {
    coolLight: '整体色温略偏冷',
    light: '整体色温偏暖',
    standard: '整体色温明显偏暖',
    strong: '整体色温略偏冷',
    max: '整体色温明显偏冷'
  },
  // 质感
  sharpness: {
    light: '轻微锐化，细节自然',
    standard: '适度锐化，细节清晰',
    strong: '明显锐化，细节锐利',
    max: '强烈锐化，细节非常锐利'
  },
  clarity: {
    light: '轻微提升清晰度',
    standard: '提升清晰度与局部对比，画面通透',
    strong: '明显提升清晰度与局部对比，质感强烈',
    max: '强烈提升清晰度与局部对比，质感强烈'
  },
  grain: {
    light: '加入细腻胶片颗粒',
    standard: '加入明显胶片颗粒',
    strong: '加入较重胶片颗粒',
    max: '加入浓重胶片颗粒'
  },
  softFocus: {
    light: '轻微柔焦',
    standard: '柔焦处理，高光柔和',
    strong: '明显柔焦，画面梦幻',
    max: '强烈柔焦，画面唯美梦幻'
  },
  vignette: {
    light: '轻微暗角',
    standard: '四周暗角，视线集中',
    strong: '明显暗角，视线集中',
    max: '浓重暗角'
  },

  // 背景虚化
  bgBlur: {
    light: '背景轻微虚化',
    standard: '背景虚化，突出人物',
    strong: '背景明显虚化，人物突出',
    max: '背景强烈虚化，人物非常突出'
  }
} as Readonly<Partial<Record<PortraitTierKey, PortraitTierPhrases>>>

// ── 参数规格（面板渲染顺序 = 数组顺序） ─────────────────────────

/**
 * 分段档位字段。
 *
 * `tiers` 给 UI 渲染顺序（`off` 必须排第一）；`phrases` 缺省时回落到
 * `PORTRAIT_TIER_PHRASES[key]`。取值域不是标准五档的字段（色温 / 眼距…）
 * 用 `phrases` 自带片段表，`tiers` 列出它自己的档位名。
 */
export interface PortraitTierSpec {
  kind: 'tier'
  key: PortraitTierKey
  group: PortraitToolGroupId
  /** i18n key suffix under graph.portrait.fields.* */
  labelKey: string
  tiers: readonly string[]
  /** i18n key suffix under graph.portrait.hints.* —— 一句话说清「往哪改」 */
  hintKey: string
  phrases?: PortraitTierPhrases
  needs?: readonly PortraitNeed[]
}

export interface PortraitEnumSpec {
  kind: 'enum'
  key: PortraitEnumKey
  group: PortraitToolGroupId
  labelKey: string
  default: string
  /** i18n key suffix under graph.portrait.options.* */
  options: readonly string[]
  /** 每个选项的提示词片段（缺省 = 该选项不产出提示词） */
  phrases?: PortraitPhrases
  needs?: readonly PortraitNeed[]
}

export interface PortraitTextSpec {
  kind: 'text'
  key: PortraitTextKey
  group: PortraitToolGroupId
  labelKey: string
  /** i18n key suffix under graph.portrait.placeholders.* */
  placeholderKey: string
  maxLength: number
  needs?: readonly PortraitNeed[]
}

export interface PortraitColorSpec {
  kind: 'color'
  key: PortraitColorKey
  group: PortraitToolGroupId
  labelKey: string
  default: string
  needs?: readonly PortraitNeed[]
}

export interface PortraitBoolSpec {
  kind: 'boolean'
  key: PortraitBooleanKey
  group: PortraitToolGroupId
  labelKey: string
  default: boolean
  needs?: readonly PortraitNeed[]
}

export interface PortraitNumberSpec {
  kind: 'number'
  key: PortraitNumberKey
  group: PortraitToolGroupId
  labelKey: string
  default: number
  min: number
  max: number
  step: number
  /** 数字输入（不是滑块）：DPI / 画质 / 最长边这类精确值 */
  input: 'number'
  needs?: readonly PortraitNeed[]
}

export type PortraitParamSpec =
  | PortraitTierSpec
  | PortraitEnumSpec
  | PortraitTextSpec
  | PortraitColorSpec
  | PortraitBoolSpec
  | PortraitNumberSpec

const ALL_TIERS: readonly string[] = ['off', 'light', 'standard', 'strong', 'max']
/** 通用四档：部分操作没有「强烈」的必要（红眼 / 瞳孔 / 眉毛） */
const LIGHT_TO_STRONG: readonly string[] = ['off', 'light', 'standard', 'strong']

function tier(
  key: PortraitTierKey,
  group: PortraitToolGroupId,
  hintKey: string,
  needs?: readonly PortraitNeed[],
  tiers: readonly string[] = ALL_TIERS,
  phrases?: PortraitTierPhrases
): PortraitTierSpec {
  return {
    kind: 'tier',
    key,
    group,
    labelKey: key,
    tiers,
    hintKey,
    ...(phrases ? { phrases } : {}),
    needs
  }
}

/**
 * 双向档位字段（色温 / 眼距）。
 *
 * `options` 必须与 `phrases` 的键完全一致：声明一套、取值一套会让类型合法的档位
 * 被归一化悄悄抹成 `off`（曾经 `colorTemp: 'warm'` 就是这样失效的）。
 */
function biTier(
  key: PortraitTierKey,
  group: PortraitToolGroupId,
  hintKey: string,
  options: readonly string[],
  phrases: PortraitTierPhrases,
  needs?: readonly PortraitNeed[]
): PortraitTierSpec {
  return {
    kind: 'tier',
    key,
    group,
    labelKey: key,
    tiers: ['off', ...options],
    hintKey,
    phrases,
    needs
  }
}

/** 取值域是自有阶梯的档位字段（光比 / 影调 / 饱和度 / 色调） */
function customTier(
  key: PortraitTierKey,
  group: PortraitToolGroupId,
  hintKey: string,
  options: readonly string[],
  phrases: PortraitTierPhrases,
  needs?: readonly PortraitNeed[]
): PortraitTierSpec {
  return {
    kind: 'tier',
    key,
    group,
    labelKey: key,
    tiers: ['off', ...options],
    hintKey,
    phrases,
    needs
  }
}

/**
 * 全部参数规格。
 *
 * 与 v1 的 103 个滑块相比，这里**刻意合并**了同义项（例如「鼻梁 / 鼻翼 / 鼻尖」
 * 合成 `noseShape`、「抬头纹 / 法令纹 / 颈纹」合成 `wrinkles`）：
 * 图片模型对「鼻翼收窄 20%」与「鼻翼收窄 30%」没有稳定区分能力，
 * 拆成多项只会让提示词互相打架，档位越细反而越不可控。
 */
export const PORTRAIT_PARAM_SPECS: readonly PortraitParamSpec[] = [
  // ── 1 修复 ──
  tier('blemishRemoval', 'heal', 'blemishRemoval', ['face']),
  tier('underEye', 'heal', 'underEye', ['face']),
  tier('wrinkles', 'heal', 'wrinkles', ['face']),
  tier('shineRemoval', 'heal', 'shineRemoval', ['face']),
  tier('redEye', 'heal', 'redEye', ['face'], LIGHT_TO_STRONG),
  tier('strayHair', 'heal', 'strayHair'),

  // ── 2 肤质 ──
  tier('skinSmoothing', 'skin', 'skinSmoothing', ['face']),
  tier('skinTexture', 'skin', 'skinTexture', ['face']),
  tier('skinEvenness', 'skin', 'skinEvenness', ['face']),
  tier('skinDenoise', 'skin', 'skinDenoise'),

  // ── 3 肤色 ──
  tier('skinWhiten', 'tone', 'skinWhiten', ['face']),
  tier('skinRosy', 'tone', 'skinRosy', ['face']),
  tier('skinDeYellow', 'tone', 'skinDeYellow', ['face']),
  biTier('skinToneWarmth', 'tone', 'skinToneWarmth', WARMTH_OPTIONS, PORTRAIT_WARMTH_PHRASES, [
    'face'
  ]),

  // ── 4 五官 ──
  tier('faceSlim', 'face', 'faceSlim', ['face']),
  tier('jawline', 'face', 'jawline', ['face']),
  tier('chin', 'face', 'chin', ['face'], LIGHT_TO_STRONG),
  tier('eyeSize', 'face', 'eyeSize', ['face']),
  biTier('eyeSpacing', 'face', 'eyeSpacing', EYE_SPACING_OPTIONS, PORTRAIT_EYE_SPACING_PHRASES, [
    'face'
  ]),
  tier('doubleEyelid', 'face', 'doubleEyelid', ['face']),
  tier('noseShape', 'face', 'noseShape', ['face']),
  tier('lipShape', 'face', 'lipShape', ['face']),
  tier('brows', 'face', 'brows', ['face'], LIGHT_TO_STRONG),

  // ── 5 眼睛 ──
  tier('catchlight', 'eyes', 'catchlight', ['face']),
  tier('eyeWhiten', 'eyes', 'eyeWhiten', ['face']),
  tier('pupilSize', 'eyes', 'pupilSize', ['face'], ['off', 'light', 'standard']),

  // ── 6 妆容 ──
  {
    kind: 'enum',
    key: 'makeupStyle',
    group: 'makeup',
    labelKey: 'makeupStyle',
    default: 'none',
    needs: ['face'],
    options: ['none', 'nude', 'portrait', 'bride', 'child', 'hongkong', 'office', 'stage'],
    phrases: {
      nude: '妆容为清透裸妆，几乎看不出妆感',
      portrait: '妆容为写真妆，五官立体、肤质细腻',
      bride: '妆容为新娘妆，清透水润、眼神明亮',
      child: '妆容为儿童妆，仅腮红与唇色，干净自然',
      hongkong: '妆容为港风复古妆，眉形利落、唇色饱满',
      office: '妆容为通勤妆，干净利落、气色自然',
      stage: '妆容为舞台妆，轮廓与眼妆加强、有聚光灯感'
    }
  },
  tier(
    'makeupIntensity',
    'makeup',
    'makeupIntensity',
    ['face'],
    ALL_TIERS,
    PORTRAIT_MAKEUP_INTENSITY_PHRASES
  ),
  customTier(
    'makeupTone',
    'makeup',
    'makeupTone',
    ['cool', 'natural', 'warm', 'rosy'],
    {
      cool: '妆色偏冷调',
      natural: '妆色自然通透',
      warm: '妆色偏暖调（蜜桃 / 珊瑚）',
      rosy: '妆色偏玫瑰粉调'
    },
    ['face']
  ),

  // ── 7 身形 ──
  tier('shoulderNeck', 'body', 'shoulderNeck', ['pose']),
  tier('waistSlim', 'body', 'waistSlim', ['pose']),
  tier('legLengthen', 'body', 'legLengthen', ['pose']),

  // ── 8 光影 ──
  tier('fillLight', 'light', 'fillLight', ['face']),
  tier('rimLight', 'light', 'rimLight', ['face']),
  tier('faceContour', 'light', 'faceContour', ['face']),
  customTier(
    'lightRatio',
    'light',
    'lightRatio',
    ['soft', 'natural', 'dramatic', 'hard'],
    PORTRAIT_LIGHT_RATIO_PHRASES
  ),
  biTier('lightTemp', 'light', 'lightTemp', WARMTH_OPTIONS, PORTRAIT_WARMTH_PHRASES),

  // ── 9 调色 ──
  customTier(
    'toneGrade',
    'color',
    'toneGrade',
    ['brightAiry', 'natural', 'highContrast', 'lowKeyMoody', 'filmFade'],
    PORTRAIT_TONE_GRADE_PHRASES
  ),
  customTier(
    'saturation',
    'color',
    'saturation',
    ['desaturateSoft', 'desaturate', 'boost', 'boostVivid'],
    PORTRAIT_SATURATION_PHRASES
  ),
  biTier('colorTemp', 'color', 'colorTemp', WARMTH_OPTIONS, PORTRAIT_WARMTH_PHRASES),
  customTier(
    'colorTint',
    'color',
    'colorTint',
    ['green', 'slightGreen', 'slightMagenta', 'magenta'],
    PORTRAIT_TINT_PHRASES
  ),
  {
    kind: 'enum',
    key: 'lutId',
    group: 'color',
    labelKey: 'lutId',
    default: 'none',
    options: [
      'none',
      'clear',
      'warmFilm',
      'coolFilm',
      'fuji',
      'kodak',
      'hongkong',
      'japanese',
      'morandi',
      'blackGold',
      'bw',
      'sepia'
    ],
    phrases: {
      clear: '整体调色通透干净',
      warmFilm: '整体调色为暖调胶片',
      coolFilm: '整体调色为冷调胶片',
      fuji: '整体调色为富士胶片风格，绿意清透',
      kodak: '整体调色为柯达胶片风格，暖黄浓郁',
      hongkong: '整体调色为港风复古，青色阴影与暖肤色',
      japanese: '整体调色为日系清透，低对比高明度',
      morandi: '整体调色为莫兰迪灰调，低饱和高级感',
      blackGold: '整体调色为黑金风格，暗部压深、高光偏金',
      bw: '转为黑白照片，层次丰富',
      sepia: '整体调色为棕褐色复古'
    }
  },

  // ── 10 质感 ──
  tier('sharpness', 'texture', 'sharpness'),
  tier('clarity', 'texture', 'clarity'),
  tier('grain', 'texture', 'grain'),
  tier('softFocus', 'texture', 'softFocus'),
  tier('vignette', 'texture', 'vignette'),

  // ── 11 手动区域 ──
  {
    kind: 'text',
    key: 'extraNote',
    group: 'region',
    labelKey: 'extraNote',
    placeholderKey: 'extraNote',
    maxLength: 400
  },

  // ── 12 背景 ──
  {
    kind: 'enum',
    key: 'bgMode',
    group: 'background',
    labelKey: 'bgMode',
    default: 'keep',
    options: ['keep', 'color', 'gradient', 'prompt', 'blur'],
    phrases: {
      gradient: '背景替换为柔和渐变背景',
      prompt: '按描述替换背景，人物边缘自然融合'
    }
  },
  { kind: 'color', key: 'bgColor', group: 'background', labelKey: 'bgColor', default: '#ffffff' },
  {
    kind: 'color',
    key: 'bgColorTo',
    group: 'background',
    labelKey: 'bgColorTo',
    default: '#dbeafe'
  },
  {
    kind: 'text',
    key: 'bgPrompt',
    group: 'background',
    labelKey: 'bgPrompt',
    placeholderKey: 'bgPrompt',
    maxLength: 300
  },
  tier('bgBlur', 'background', 'bgBlur', ['mask']),

  // ── 13 证件照 ──
  {
    kind: 'enum',
    key: 'idPhotoSpecId',
    group: 'idPhoto',
    labelKey: 'idPhotoSpecId',
    default: 'none',
    options: [
      'none',
      'oneInch',
      'smallOneInch',
      'largeOneInch',
      'twoInch',
      'smallTwoInch',
      'passport',
      'visa',
      'driverLicense',
      'socialSecurity',
      'custom'
    ]
  },
  {
    kind: 'enum',
    key: 'idPhotoBg',
    group: 'idPhoto',
    labelKey: 'idPhotoBg',
    default: 'white',
    options: ['white', 'blue', 'red', 'gradient']
  },
  {
    kind: 'boolean',
    key: 'idPhotoSheet',
    group: 'idPhoto',
    labelKey: 'idPhotoSheet',
    default: false
  },

  // ── 14 导出 ──
  //
  // 只保留**真的会被消费**的两项：`outputSize` → 发给图片模型的 resolution；
  // `exportDpi` → 证件照裁切的目标像素密度。
  // 曾经还有 exportFormat / exportQuality / exportMaxEdge，但执行改为「调模型出图」后
  // 没有任何一环会重新编码或缩放模型返回的图 —— 留着只会让 UI 承诺不存在的功能。
  {
    kind: 'enum',
    key: 'outputSize',
    group: 'export',
    labelKey: 'outputSize',
    default: '2K',
    options: ['auto', '1K', '2K', '4K']
  },
  {
    kind: 'number',
    key: 'exportDpi',
    group: 'export',
    labelKey: 'exportDpi',
    default: 300,
    min: 72,
    max: 600,
    step: 1,
    input: 'number'
  }
] as const

/** 由规格表生成默认状态（单一来源，避免默认值两处维护） */
/** 规格的默认值：`tier` / `text` 没有 `default` 字段，各自落在 `off` / 空串 */
export function portraitSpecDefault(spec: PortraitParamSpec): string | number | boolean {
  switch (spec.kind) {
    case 'tier':
      return 'off'
    case 'text':
      return ''
    default:
      return spec.default
  }
}

export function defaultPortraitRetouch(): PortraitRetouchState {
  const out: Record<string, unknown> = {
    v: PORTRAIT_RETOUCH_VERSION,
    presetId: '',
    manualRegions: []
  }
  for (const spec of PORTRAIT_PARAM_SPECS) out[spec.key] = portraitSpecDefault(spec)
  return out as unknown as PortraitRetouchState
}

export function portraitSpecsForGroup(group: PortraitToolGroupId): PortraitParamSpec[] {
  return PORTRAIT_PARAM_SPECS.filter((spec) => spec.group === group)
}

export function portraitTierSpecsForGroup(group: PortraitToolGroupId): PortraitTierSpec[] {
  const specs: PortraitTierSpec[] = []
  for (const spec of PORTRAIT_PARAM_SPECS) {
    if (spec.group === group && spec.kind === 'tier') specs.push(spec)
  }
  return specs
}

/** 该字段的提示词片段（`off` / 未定义 → 空串）。优先取 spec 自带表，否则查通用表。 */
export function portraitTierPhrase(spec: PortraitTierSpec, value: string): string {
  if (value === 'off') return ''
  if (spec.phrases) return spec.phrases[value] ?? ''
  if (spec.key === 'makeupIntensity') return PORTRAIT_MAKEUP_INTENSITY_PHRASES[value] ?? ''
  return PORTRAIT_TIER_PHRASES[spec.key]?.[value] ?? ''
}

// ── 手动区域 ───────────────────────────────────────────────────

export type PortraitManualRegionKind =
  'blemish' | 'skin' | 'whiten' | 'slim' | 'background' | 'erase'

export const PORTRAIT_MANUAL_REGION_KINDS: readonly PortraitManualRegionKind[] = [
  'blemish',
  'skin',
  'whiten',
  'slim',
  'background',
  'erase'
] as const

/** 每类手动区域的提示词模板（`{where}` 由坐标描述填充） */
export const PORTRAIT_MANUAL_REGION_PHRASES: Readonly<Record<PortraitManualRegionKind, string>> = {
  blemish: '仅对{where}区域做瑕疵修复，用周围皮肤自然填补',
  skin: '仅对{where}区域做磨皮与肤质优化，保留毛孔纹理',
  whiten: '仅对{where}区域做肤色提亮，与周围肤色自然过渡',
  slim: '仅对{where}区域做形体收窄，周围结构自然过渡不变形',
  background: '仅替换{where}区域的背景，人物边缘自然融合',
  erase: '去除{where}区域内的人物与杂物，用周围背景自然填补，保持原图画质与光照方向'
}

export const PORTRAIT_MANUAL_REGION_LIMIT = 64

export interface PortraitManualRegion {
  id: string
  kind: PortraitManualRegionKind
  /**
   * 归一化坐标 0..1（相对**模型输入图**）。`null` 表示「整图」语义，
   * 用于没有画布信息时（例如 Agent 只写文字不画框）。
   */
  box: { x: number; y: number; w: number; h: number } | null
  /** 用户补充说明（可选） */
  note: string
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

export function normalizePortraitManualRegion(
  raw: Partial<PortraitManualRegion> | null | undefined
): PortraitManualRegion | null {
  if (!raw) return null
  const kind = PORTRAIT_MANUAL_REGION_KINDS.includes(raw.kind as PortraitManualRegionKind)
    ? (raw.kind as PortraitManualRegionKind)
    : null
  if (!kind) return null
  let box: PortraitManualRegion['box'] = null
  const rawBox = raw.box
  if (
    rawBox &&
    Number.isFinite(rawBox.x) &&
    Number.isFinite(rawBox.y) &&
    Number.isFinite(rawBox.w) &&
    Number.isFinite(rawBox.h)
  ) {
    const x = clamp01(rawBox.x)
    const y = clamp01(rawBox.y)
    const w = Math.min(1 - x, Math.max(0, rawBox.w))
    const h = Math.min(1 - y, Math.max(0, rawBox.h))
    if (w > 0.001 && h > 0.001) box = { x, y, w, h }
  }
  return {
    id:
      typeof raw.id === 'string' && raw.id
        ? raw.id
        : `region-${Math.random().toString(36).slice(2, 10)}`,
    kind,
    box,
    note: typeof raw.note === 'string' ? raw.note.slice(0, 200) : ''
  }
}

export function normalizePortraitManualRegions(
  raw?: readonly (Partial<PortraitManualRegion> | null | undefined)[] | null
): PortraitManualRegion[] {
  if (!Array.isArray(raw)) return []
  const out: PortraitManualRegion[] = []
  for (const item of raw) {
    const region = normalizePortraitManualRegion(item)
    if (region) out.push(region)
  }
  return out.slice(0, PORTRAIT_MANUAL_REGION_LIMIT)
}

/**
 * 归一化框 → 供模型理解的位置短语（九宫格 + 尺寸）。
 * 用自然语言而不是坐标数字：图片模型对「画面左上」的理解远好于「x=0.12」。
 */
export function portraitRegionWhere(box: PortraitManualRegion['box']): string {
  if (!box) return '整张画面'
  const cx = box.x + box.w / 2
  const cy = box.y + box.h / 2
  const col = cx < 1 / 3 ? '左侧' : cx > 2 / 3 ? '右侧' : '中部'
  const row = cy < 1 / 3 ? '上方' : cy > 2 / 3 ? '下方' : '中间'
  const area = box.w * box.h
  const scale = area < 0.02 ? '小块' : area < 0.12 ? '一块' : '大片'
  return `画面${row}${col}的${scale}`
}

// ── 归一化 ────────────────────────────────────────────────────

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/

function clampNumber(value: unknown, spec: PortraitNumberSpec): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : spec.default
  const stepped = Math.round(n / spec.step) * spec.step
  return Math.min(spec.max, Math.max(spec.min, Number(stepped.toFixed(4))))
}

function pickTier(value: unknown, spec: PortraitTierSpec): PortraitTier {
  return spec.tiers.includes(value as PortraitTier) ? (value as PortraitTier) : 'off'
}

function pickEnum(value: unknown, spec: PortraitEnumSpec): string {
  return spec.options.includes(value as string) ? (value as string) : spec.default
}
/** v1（103 个 0..100 滑块）→ v2 档位。阈值取「旧默认值附近」以免迁移后观感突变。 */
const LEGACY_V1_TIER_MAP: Readonly<Record<string, (value: number) => string>> = {
  blemishRemoval: (v) =>
    v >= 70 ? 'max' : v >= 45 ? 'strong' : v >= 15 ? 'standard' : v > 0 ? 'light' : 'off',
  darkCircle: (v) => (v >= 55 ? 'strong' : v >= 25 ? 'standard' : v > 0 ? 'light' : 'off'),
  eyeBag: (v) => (v >= 55 ? 'strong' : v >= 25 ? 'standard' : v > 0 ? 'light' : 'off'),
  nasolabial: (v) => (v >= 55 ? 'strong' : v >= 25 ? 'standard' : v > 0 ? 'light' : 'off'),
  foreheadLines: (v) => (v >= 55 ? 'strong' : v >= 25 ? 'standard' : v > 0 ? 'light' : 'off'),
  neckLines: (v) => (v >= 55 ? 'strong' : v >= 25 ? 'standard' : v > 0 ? 'light' : 'off'),
  shineRemoval: (v) => (v >= 55 ? 'strong' : v >= 25 ? 'standard' : v > 0 ? 'light' : 'off'),
  redEye: (v) => (v >= 25 ? 'standard' : v > 0 ? 'light' : 'off'),
  strayHair: (v) => (v >= 55 ? 'strong' : v >= 25 ? 'standard' : v > 0 ? 'light' : 'off'),
  skinSmoothing: (v) => (v >= 60 ? 'strong' : v >= 35 ? 'standard' : v > 0 ? 'light' : 'off'),
  skinPore: (v) =>
    v >= 80 ? 'max' : v >= 60 ? 'strong' : v >= 35 ? 'standard' : v > 0 ? 'light' : 'off',
  skinEvenness: (v) => (v >= 55 ? 'strong' : v >= 25 ? 'standard' : v > 0 ? 'light' : 'off'),
  skinDenoise: (v) => (v >= 55 ? 'strong' : v >= 25 ? 'standard' : v > 0 ? 'light' : 'off'),
  skinWhiten: (v) => (v >= 55 ? 'strong' : v >= 25 ? 'standard' : v > 0 ? 'light' : 'off'),
  skinRosy: (v) => (v >= 55 ? 'strong' : v >= 25 ? 'standard' : v > 0 ? 'light' : 'off'),
  skinDeYellow: (v) => (v >= 55 ? 'strong' : v >= 25 ? 'standard' : v > 0 ? 'light' : 'off'),
  faceSlim: (v) => (v >= 55 ? 'strong' : v >= 25 ? 'standard' : v > 0 ? 'light' : 'off'),
  cheekbone: (v) => (v >= 55 ? 'strong' : v >= 25 ? 'standard' : v > 0 ? 'light' : 'off'),
  jawline: (v) => (v >= 55 ? 'strong' : v >= 25 ? 'standard' : v > 0 ? 'light' : 'off'),
  chinLength: (v) => (v >= 55 ? 'strong' : v >= 25 ? 'standard' : v > 0 ? 'light' : 'off'),
  chinSharp: (v) => (v >= 55 ? 'strong' : v >= 25 ? 'standard' : v > 0 ? 'light' : 'off'),
  doubleEyelid: (v) => (v >= 55 ? 'strong' : v >= 25 ? 'standard' : v > 0 ? 'light' : 'off'),
  eyeSize: (v) => (v >= 55 ? 'strong' : v >= 25 ? 'standard' : v > 0 ? 'light' : 'off'),
  noseBridge: (v) => (v >= 55 ? 'strong' : v >= 25 ? 'standard' : v > 0 ? 'light' : 'off'),
  noseWing: (v) => (v >= 55 ? 'strong' : v >= 25 ? 'standard' : v > 0 ? 'light' : 'off'),
  noseTip: (v) => (v >= 55 ? 'strong' : v >= 25 ? 'standard' : v > 0 ? 'light' : 'off'),
  lipThickness: (v) => (v >= 55 ? 'strong' : v >= 25 ? 'standard' : v > 0 ? 'light' : 'off'),
  lipShape: (v) => (v >= 55 ? 'strong' : v >= 25 ? 'standard' : v > 0 ? 'light' : 'off'),
  browHeight: (v) => (v >= 55 ? 'strong' : v >= 25 ? 'standard' : v > 0 ? 'light' : 'off'),
  browThickness: (v) => (v >= 55 ? 'strong' : v >= 25 ? 'standard' : v > 0 ? 'light' : 'off'),
  catchlight: (v) => (v >= 55 ? 'strong' : v >= 25 ? 'standard' : v > 0 ? 'light' : 'off'),
  eyeWhiten: (v) => (v >= 55 ? 'strong' : v >= 25 ? 'standard' : v > 0 ? 'light' : 'off'),
  pupilSize: (v) => (v >= 55 ? 'standard' : v > 0 ? 'light' : 'off'),
  makeupIntensity: (v) =>
    v >= 70 ? 'max' : v >= 45 ? 'strong' : v >= 20 ? 'standard' : v > 0 ? 'light' : 'off',
  bodySlim: (v) => (v >= 55 ? 'strong' : v >= 25 ? 'standard' : v > 0 ? 'light' : 'off'),
  waistSlim: (v) => (v >= 55 ? 'strong' : v >= 25 ? 'standard' : v > 0 ? 'light' : 'off'),
  armSlim: (v) => (v >= 55 ? 'strong' : v >= 25 ? 'standard' : v > 0 ? 'light' : 'off'),
  shoulderBeauty: (v) => (v >= 55 ? 'strong' : v >= 25 ? 'standard' : v > 0 ? 'light' : 'off'),
  neckLengthen: (v) => (v >= 55 ? 'strong' : v >= 25 ? 'standard' : v > 0 ? 'light' : 'off'),
  legLengthen: (v) => (v >= 55 ? 'strong' : v >= 25 ? 'standard' : v > 0 ? 'light' : 'off'),
  fillLight: (v) => (v >= 55 ? 'strong' : v >= 25 ? 'standard' : v > 0 ? 'light' : 'off'),
  rimLight: (v) => (v >= 55 ? 'strong' : v >= 25 ? 'standard' : v > 0 ? 'light' : 'off'),
  faceContour: (v) => (v >= 55 ? 'strong' : v >= 25 ? 'standard' : v > 0 ? 'light' : 'off'),
  sharpness: (v) => (v >= 55 ? 'strong' : v >= 25 ? 'standard' : v > 0 ? 'light' : 'off'),
  clarity: (v) => (v >= 55 ? 'strong' : v >= 25 ? 'standard' : v > 0 ? 'light' : 'off'),
  grain: (v) => (v >= 55 ? 'strong' : v >= 25 ? 'standard' : v > 0 ? 'light' : 'off'),
  softFocus: (v) => (v >= 55 ? 'strong' : v >= 25 ? 'standard' : v > 0 ? 'light' : 'off'),
  vignette: (v) => (v >= 55 ? 'strong' : v >= 25 ? 'standard' : v > 0 ? 'light' : 'off'),
  bgBlur: (v) => (v >= 55 ? 'strong' : v >= 25 ? 'standard' : v > 0 ? 'light' : 'off'),
  lightTemp: (v) =>
    v >= 55 ? 'warmStrong' : v >= 20 ? 'warm' : v <= -55 ? 'cool' : v <= -20 ? 'coolLight' : 'off',
  colorTemp: (v) =>
    v >= 55 ? 'warmStrong' : v >= 20 ? 'warm' : v <= -55 ? 'cool' : v <= -20 ? 'coolLight' : 'off',
  skinTone: (v) =>
    v >= 55 ? 'warmStrong' : v >= 20 ? 'warm' : v <= -55 ? 'cool' : v <= -20 ? 'coolLight' : 'off',
  eyeSpacing: (v) =>
    v >= 55
      ? 'narrow'
      : v >= 20
        ? 'slightNarrow'
        : v <= -55
          ? 'wide'
          : v <= -20
            ? 'slightWide'
            : 'off',
  saturation: (v) =>
    v >= 55
      ? 'boostVivid'
      : v >= 20
        ? 'boost'
        : v <= -55
          ? 'desaturate'
          : v <= -20
            ? 'desaturateSoft'
            : 'off',
  // 色调：正向偏绿、负向偏品红（与 `PortraitTintTier` 的书写顺序一致）
  tint: (v) =>
    v >= 55
      ? 'green'
      : v >= 20
        ? 'slightGreen'
        : v <= -55
          ? 'magenta'
          : v <= -20
            ? 'slightMagenta'
            : 'off',
  lightRatio: (v) =>
    v >= 75 ? 'hard' : v >= 55 ? 'dramatic' : v >= 25 ? 'natural' : v > 0 ? 'soft' : 'off'
}

/** v1 的妆容预设 id 与 v2 同名，直接搬；`none` 保持 none */
function legacyMakeupStyle(value: unknown): string {
  const allowed = ['none', 'nude', 'portrait', 'bride', 'child', 'hongkong', 'office', 'stage']
  return typeof value === 'string' && allowed.includes(value) ? value : 'none'
}

/** v1 的 LUT id 与 v2 同名集合 */
function legacyLut(value: unknown): string {
  const allowed = [
    'clear',
    'warmFilm',
    'coolFilm',
    'fuji',
    'kodak',
    'hongkong',
    'japanese',
    'morandi',
    'blackGold',
    'bw',
    'sepia'
  ]
  return typeof value === 'string' && allowed.includes(value) ? value : 'none'
}

function legacyBackgroundMode(value: unknown): PortraitBackgroundMode {
  return value === 'color' || value === 'gradient' ? value : 'keep'
}

/**
 * v1 → v2 迁移：只保留「语义还在」的项，其余丢弃。
 *
 * 刻意**不做**穷尽映射：v1 的 103 个滑块里有一批在 v2 没有对应档位
 * （例如 `foreheadHeight` / `headBodyRatio` / `hslHue`），硬凑一个近义档位
 * 会让用户重开旧工程时看到一堆自己没设过的参数。丢掉的项下次 Cook 就不再生效，
 * 这与「节点换成调模型」这件事本身的语义变化是一致的。
 */
/** 该字段的合法取值域（迁移写入前再校验一次，防止映射表漂移后写入越域值） */
const SPEC_OPTIONS: ReadonlyMap<string, readonly string[]> = new Map(
  PORTRAIT_PARAM_SPECS.flatMap((spec) =>
    spec.kind === 'tier'
      ? [[spec.key, spec.tiers] as const]
      : spec.kind === 'enum'
        ? [[spec.key, spec.options] as const]
        : []
  )
)

/** 越域的值一律丢弃（回落默认），保证「归一化后的状态永远合法」 */
function assignIfValid(out: Record<string, unknown>, key: string, value: unknown): boolean {
  const options = SPEC_OPTIONS.get(key)
  if (!options || !options.includes(value as string)) return false
  out[key] = value
  return true
}

function portraitRetouchFromV1(raw: Record<string, unknown>): PortraitRetouchState {
  const out = defaultPortraitRetouch() as unknown as Record<string, unknown>

  for (const [legacyKey, map] of Object.entries(LEGACY_V1_TIER_MAP)) {
    const value = Number(raw[legacyKey])
    if (!Number.isFinite(value) || value === 0) continue
    const tierValue = map(value)
    if (tierValue === 'off') continue
    // 多个 v1 项映射到同一个 v2 字段时取「更强」的那个，避免后来者把前面的盖掉
    const target = LEGACY_V1_TARGET[legacyKey]
    if (!target) continue
    const merged = strongerTier(out[target] as string, tierValue)
    if (!assignIfValid(out, target, merged)) continue
  }

  if (legacyMakeupStyle(raw.makeupPresetId) !== 'none') {
    assignIfValid(out, 'makeupStyle', legacyMakeupStyle(raw.makeupPresetId))
  }
  if (legacyLut(raw.lutId) !== 'none') assignIfValid(out, 'lutId', legacyLut(raw.lutId))
  assignIfValid(out, 'bgMode', legacyBackgroundMode(raw.bgMode))
  if (HEX_COLOR_RE.test(String(raw.bgColor))) out.bgColor = raw.bgColor
  if (HEX_COLOR_RE.test(String(raw.bgColorTo))) out.bgColorTo = raw.bgColorTo
  // 枚举也走域校验：`{ v: 1, idPhotoSpecId: 'threeInch' }` 不该产出越域状态
  assignIfValid(out, 'idPhotoSpecId', raw.idPhotoSpecId)
  assignIfValid(out, 'idPhotoBg', raw.idPhotoBg)
  if (typeof raw.idPhotoSheet === 'boolean') out.idPhotoSheet = raw.idPhotoSheet
  if (typeof raw.makeupSaturation === 'number' && raw.makeupSaturation > 50) {
    assignIfValid(out, 'makeupTone', 'rosy')
  }
  return out as unknown as PortraitRetouchState
}

/** v1 键 → v2 键（同一个 v2 键可由多个 v1 键喂） */
const LEGACY_V1_TARGET: Readonly<Record<string, PortraitTierKey>> = {
  blemishRemoval: 'blemishRemoval',
  darkCircle: 'underEye',
  eyeBag: 'underEye',
  eyeBagVolume: 'underEye',
  nasolabial: 'wrinkles',
  foreheadLines: 'wrinkles',
  neckLines: 'wrinkles',
  shineRemoval: 'shineRemoval',
  highlightRepair: 'shineRemoval',
  redEye: 'redEye',
  strayHair: 'strayHair',
  skinSmoothing: 'skinSmoothing',
  softFocus: 'softFocus',
  skinPore: 'skinTexture',
  skinEvenness: 'skinEvenness',
  skinDenoise: 'skinDenoise',
  skinWhiten: 'skinWhiten',
  skinRosy: 'skinRosy',
  skinDeYellow: 'skinDeYellow',
  skinTone: 'skinToneWarmth',
  faceSlim: 'faceSlim',
  cheekbone: 'jawline',
  jawline: 'jawline',
  chinLength: 'chin',
  chinSharp: 'chin',
  doubleEyelid: 'doubleEyelid',
  eyeSize: 'eyeSize',
  eyeSpacing: 'eyeSpacing',
  noseBridge: 'noseShape',
  noseWing: 'noseShape',
  noseTip: 'noseShape',
  mouthSize: 'lipShape',
  lipThickness: 'lipShape',
  lipShape: 'lipShape',
  browHeight: 'brows',
  browThickness: 'brows',
  catchlight: 'catchlight',
  eyeWhiten: 'eyeWhiten',
  eyeShadow: 'eyeWhiten',
  pupilSize: 'pupilSize',
  makeupIntensity: 'makeupIntensity',
  bodySlim: 'waistSlim',
  waistSlim: 'waistSlim',
  armSlim: 'shoulderNeck',
  shoulderBeauty: 'shoulderNeck',
  neckLengthen: 'shoulderNeck',
  legLengthen: 'legLengthen',
  fillLight: 'fillLight',
  rimLight: 'rimLight',
  shadowLift: 'fillLight',
  faceContour: 'faceContour',
  sharpness: 'sharpness',
  clarity: 'clarity',
  grain: 'grain',
  vignette: 'vignette',
  bgBlur: 'bgBlur',
  lightTemp: 'lightTemp',
  colorTemp: 'colorTemp',
  saturation: 'saturation',
  vibrance: 'saturation',
  tint: 'colorTint',
  lightRatio: 'lightRatio'
}

const TIER_ORDER: readonly string[] = ['off', 'light', 'standard', 'strong', 'max']

/**
 * 取更强的档位。
 *
 * 两个值的取值域可能不含标准五档（`warmStrong` / `boostVivid` / `hard`…），
 * 此时 `TIER_ORDER.indexOf` 会给 -1 —— 直接拿 -1 参与比较，结果是
 * 「任何非标准档位都比 off 弱」，把整个迁移值抹掉。这里改成：
 * `off` 永远最弱；不在阶梯里的具体档位一律视为比 `off` 强。
 */
function strongerTier(a: string, b: string): string {
  if (a === 'off' || !a) return b
  if (b === 'off' || !b) return a
  const ia = TIER_ORDER.indexOf(a)
  const ib = TIER_ORDER.indexOf(b)
  if (ia < 0) return a
  if (ib < 0) return b
  return ib > ia ? b : a
}

/**
 * 归一化：夹取档位与枚举、校验颜色、补齐缺失字段。
 *
 * 同时充当**版本迁移入口**：读到 v1（本地烘焙时代的 103 个滑块）就按
 * `portraitRetouchFromV1` 折算成档位，读到 v2 之外的未来版本则保守回落默认值。
 */
export function normalizePortraitRetouch(
  raw?: Partial<PortraitRetouchState> | null
): PortraitRetouchState {
  const input = (raw ?? {}) as Record<string, unknown>
  const version = typeof input.v === 'number' ? input.v : 0
  // v1 = 本地烘焙时代的 103 个滑块：折算成档位后直接返回。
  // 迁移是纯函数且幂等（v1 输入永远得到同一个 v2 状态），不需要标记位。
  if (version > 0 && version < PORTRAIT_RETOUCH_VERSION) return portraitRetouchFromV1(input)

  const out = defaultPortraitRetouch() as unknown as Record<string, unknown>
  for (const spec of PORTRAIT_PARAM_SPECS) {
    const value = input[spec.key]
    if (value === undefined) continue
    if (spec.kind === 'tier') out[spec.key] = pickTier(value, spec)
    else if (spec.kind === 'enum') out[spec.key] = pickEnum(value, spec)
    else if (spec.kind === 'color')
      out[spec.key] = HEX_COLOR_RE.test(String(value)) ? value : spec.default
    else if (spec.kind === 'boolean')
      out[spec.key] = typeof value === 'boolean' ? value : spec.default
    else if (spec.kind === 'number') out[spec.key] = clampNumber(value, spec)
    else if (spec.kind === 'text')
      out[spec.key] = typeof value === 'string' ? value.slice(0, spec.maxLength) : ''
  }
  out.manualRegions = normalizePortraitManualRegions(
    input.manualRegions as PortraitManualRegion[] | undefined
  )
  out.presetId = typeof input.presetId === 'string' ? input.presetId : ''
  out.v = PORTRAIT_RETOUCH_VERSION
  return out as unknown as PortraitRetouchState
}

export function readPortraitRetouchFromNode(params: {
  portraitRetouch?: Partial<PortraitRetouchState>
}): PortraitRetouchState {
  return normalizePortraitRetouch(params.portraitRetouch)
}

export function portraitRetouchToNodePatch(state: PortraitRetouchState): {
  portraitRetouch: PortraitRetouchState
} {
  return { portraitRetouch: normalizePortraitRetouch(state) }
}

/** 该参数是否被改动过（相对默认值）——用于卡片角标「已修 N 项」与脏检查 */
export function isPortraitParamChanged(
  state: PortraitRetouchState,
  spec: PortraitParamSpec
): boolean {
  const current = (state as unknown as Record<string, unknown>)[spec.key]
  return current !== portraitSpecDefault(spec)
}

export function changedPortraitParamCount(state: PortraitRetouchState): number {
  const normalized = normalizePortraitRetouch(state)
  const regionCount = normalized.manualRegions.length
  return (
    PORTRAIT_PARAM_SPECS.filter((spec) => isPortraitParamChanged(normalized, spec)).length +
    regionCount
  )
}

/** `strong` / `max` 档位数量：UI 据此提示「身份保真风险」 */
export function portraitHighRiskTierCount(state: PortraitRetouchState): number {
  const normalized = normalizePortraitRetouch(state)
  let count = 0
  for (const spec of PORTRAIT_PARAM_SPECS) {
    if (spec.kind !== 'tier') continue
    const value = normalized[spec.key]
    if (value === 'strong' || value === 'max') count++
  }
  return count
}

// ── 预设 ──────────────────────────────────────────────────────

export interface PortraitPresetDef {
  id: string
  /** i18n key suffix under graph.portrait.presets.* */
  labelKey: string
  /** 内置预设的覆盖值（缺省字段取默认值） */
  patch: Partial<PortraitRetouchState>
}

/**
 * 内置预设：只覆盖关键字段，其余取默认，避免预设之间互相污染。
 * 每一项都是档位值，因此**预设本身就是一段可读的提示词配方**。
 */
export const PORTRAIT_PRESETS: readonly PortraitPresetDef[] = [
  {
    id: 'natural',
    labelKey: 'natural',
    patch: {
      skinSmoothing: 'light',
      skinTexture: 'strong',
      blemishRemoval: 'standard',
      sharpness: 'light'
    }
  },
  {
    id: 'portrait',
    labelKey: 'portrait',
    patch: {
      skinSmoothing: 'standard',
      skinTexture: 'standard',
      skinWhiten: 'light',
      faceContour: 'standard',
      blemishRemoval: 'standard',
      sharpness: 'standard',
      clarity: 'light',
      lutId: 'clear'
    }
  },
  {
    id: 'bride',
    labelKey: 'bride',
    patch: {
      skinSmoothing: 'strong',
      skinTexture: 'light',
      skinWhiten: 'standard',
      skinRosy: 'standard',
      blemishRemoval: 'strong',
      underEye: 'standard',
      catchlight: 'standard',
      eyeWhiten: 'light',
      makeupStyle: 'bride',
      makeupIntensity: 'standard',
      fillLight: 'standard',
      lutId: 'warmFilm'
    }
  },
  {
    id: 'child',
    labelKey: 'child',
    patch: {
      skinSmoothing: 'standard',
      skinTexture: 'strong',
      skinRosy: 'standard',
      skinWhiten: 'light',
      makeupStyle: 'child',
      makeupIntensity: 'light',
      saturation: 'boost',
      lutId: 'japanese'
    }
  },
  {
    id: 'idPhoto',
    labelKey: 'idPhoto',
    patch: {
      skinSmoothing: 'standard',
      skinTexture: 'standard',
      skinWhiten: 'standard',
      skinDeYellow: 'standard',
      bgMode: 'color',
      bgColor: '#ffffff',
      idPhotoSpecId: 'oneInch',
      idPhotoBg: 'white',
      sharpness: 'strong',
      lutId: 'none'
    }
  },
  {
    id: 'hongkong',
    labelKey: 'hongkong',
    patch: {
      skinSmoothing: 'standard',
      faceContour: 'strong',
      saturation: 'boost',
      toneGrade: 'highContrast',
      colorTemp: 'warm',
      makeupStyle: 'hongkong',
      makeupIntensity: 'standard',
      lutId: 'hongkong'
    }
  },
  {
    id: 'clear',
    labelKey: 'clear',
    patch: {
      skinSmoothing: 'light',
      skinWhiten: 'standard',
      skinDeYellow: 'standard',
      toneGrade: 'brightAiry',
      clarity: 'standard',
      lutId: 'clear'
    }
  },
  {
    id: 'texture',
    labelKey: 'texture',
    patch: {
      skinSmoothing: 'light',
      skinTexture: 'max',
      clarity: 'standard',
      sharpness: 'standard',
      grain: 'light'
    }
  },
  {
    id: 'film',
    labelKey: 'film',
    patch: {
      toneGrade: 'filmFade',
      saturation: 'desaturate',
      grain: 'standard',
      vignette: 'light',
      lutId: 'kodak'
    }
  },
  {
    id: 'bw',
    labelKey: 'bw',
    patch: {
      saturation: 'off',
      toneGrade: 'highContrast',
      clarity: 'standard',
      grain: 'light',
      lutId: 'bw'
    }
  },
  {
    id: 'legacyTone',
    labelKey: 'legacyTone',
    patch: {
      softFocus: 'standard',
      toneGrade: 'filmFade',
      saturation: 'desaturateSoft',
      lutId: 'sepia'
    }
  },
  {
    id: 'stage',
    labelKey: 'stage',
    patch: {
      skinSmoothing: 'strong',
      faceContour: 'strong',
      catchlight: 'strong',
      makeupStyle: 'stage',
      makeupIntensity: 'strong',
      rimLight: 'strong',
      lutId: 'blackGold'
    }
  }
]

/** 应用预设：以默认值为底叠加预设覆盖，再归一化 */
export function applyPortraitPreset(presetId: string): PortraitRetouchState {
  const preset = PORTRAIT_PRESETS.find((p) => p.id === presetId)
  const merged = { ...defaultPortraitRetouch(), ...(preset?.patch ?? {}) }
  const state = normalizePortraitRetouch(merged)
  return { ...state, presetId: preset?.id ?? '' }
}

export function portraitPresetDefault(): string {
  return PORTRAIT_PRESETS[0].id
}

// ── 预设导入导出（JSON） ────────────────────────────────────────

export interface PortraitPresetFile {
  app: 'aiartengine'
  kind: 'portrait-preset'
  v: number
  name: string
  state: PortraitRetouchState
}

export function exportPortraitPreset(name: string, state: PortraitRetouchState): string {
  const payload: PortraitPresetFile = {
    app: 'aiartengine',
    kind: 'portrait-preset',
    v: PORTRAIT_RETOUCH_VERSION,
    name: name.trim() || 'preset',
    state: normalizePortraitRetouch(state)
  }
  return JSON.stringify(payload, null, 2)
}

/** 解析预设 JSON；失败返回带原因的 null（调用方决定文案） */
export function importPortraitPreset(
  text: string
):
  | { ok: true; name: string; state: PortraitRetouchState }
  | { ok: false; reason: 'invalid-json' | 'not-preset' | 'version' } {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { ok: false, reason: 'invalid-json' }
  }
  if (!parsed || typeof parsed !== 'object') return { ok: false, reason: 'invalid-json' }
  const file = parsed as Partial<PortraitPresetFile>
  if (file.kind !== 'portrait-preset') return { ok: false, reason: 'not-preset' }
  const version = typeof file.v === 'number' ? file.v : 0
  if (version > PORTRAIT_RETOUCH_VERSION) return { ok: false, reason: 'version' }
  return {
    ok: true,
    name: typeof file.name === 'string' && file.name.trim() ? file.name.trim() : 'preset',
    state: normalizePortraitRetouch(file.state)
  }
}

// ── 提示词合成（本节点唯一的「执行」语义） ─────────────────────

/** 证件照规格的最小信息（避免 shared 层为一句提示词去 import 规格表） */
export interface PortraitIdPhotoPromptInfo {
  label: string
  widthMm: number
  heightMm: number
  background: string
  sheet: boolean
}

/** 可用依赖集：`face` / `mask` / `pose` 各自是否就绪 */
export type PortraitNeeds = Readonly<Record<PortraitNeed, boolean>>

export interface PortraitPromptInput {
  state: PortraitRetouchState
  /** 可用依赖：判断哪些组真的能生效 */
  needs: PortraitNeeds
  /** 证件照规格（`idPhotoSpecId === 'none'` 时传 null） */
  idPhoto: PortraitIdPhotoPromptInfo | null
}

export interface PortraitPrompt {
  /** 正向提示词（追加在系统提示词之后发给模型） */
  main: string
  /** 负面提示词；空串 = 不追加 */
  negative: string
  /** 实际生效的组（用于运行日志与 UI「本组已生效」提示） */
  appliedGroups: PortraitToolGroupId[]
  /** 因缺依赖被跳过的组（用于运行日志） */
  skippedGroups: PortraitToolGroupId[]
}

/** 档位字段按分组顺序收集提示词片段 */
function tierClauses(state: PortraitRetouchState, group: PortraitToolGroupId): string[] {
  const parts: string[] = []
  for (const spec of PORTRAIT_PARAM_SPECS) {
    if (spec.group !== group || spec.kind !== 'tier') continue
    const clause = portraitTierPhrase(spec, state[spec.key])
    if (clause) parts.push(clause)
  }
  return parts
}

function enumClause(state: PortraitRetouchState, group: PortraitToolGroupId): string[] {
  const parts: string[] = []
  for (const spec of PORTRAIT_PARAM_SPECS) {
    if (spec.group !== group || spec.kind !== 'enum' || !spec.phrases) continue
    const value = state[spec.key]
    const clause = spec.phrases[value]?.trim()
    if (clause) parts.push(clause)
  }
  return parts
}

/** 手动区域 → 提示词（坐标翻译成方位语，模型读得懂） */
function regionClauses(state: PortraitRetouchState): string[] {
  const parts: string[] = []
  const note = state.extraNote.trim()
  for (const region of state.manualRegions) {
    const where = portraitRegionWhere(region.box)
    const template = PORTRAIT_MANUAL_REGION_PHRASES[region.kind]
    const clause = template.replace('{where}', where)
    parts.push(region.note.trim() ? `${clause}（${region.note.trim()}）` : clause)
  }
  if (note) parts.push(`补充要求：${note}`)
  return parts
}

function backgroundClauses(state: PortraitRetouchState): string[] {
  const parts: string[] = []
  if (state.bgMode === 'color') {
    parts.push(`背景替换为纯色 ${state.bgColor.toUpperCase()}，人物边缘干净`)
  } else if (state.bgMode === 'gradient') {
    parts.push(
      `背景替换为 ${state.bgColor.toUpperCase()} 到 ${state.bgColorTo.toUpperCase()} 的柔和渐变`
    )
  } else if (state.bgMode === 'prompt' && state.bgPrompt.trim()) {
    parts.push(`背景替换为：${state.bgPrompt.trim()}，人物边缘自然融合，保留原人物光影与肤色`)
  } else if (state.bgMode === 'blur') {
    parts.push('保留原背景内容但整体虚化，虚化程度由背景虚化档位决定')
  }
  return parts
}

/** 该组在给定依赖下能否生效 */
export function portraitGroupEnabled(group: PortraitToolGroup, needs: PortraitNeeds): boolean {
  if (!group.needs?.length) return true
  return group.needs.every((need) => needs[need])
}

/**
 * 由参数合成提示词。
 *
 * 分工刻意明确：
 * - **这里只写「改什么、改多少」**（人物相关的正向诉求）；
 * - 「保持身份 / 骨相 / 背景不变」「不要塑料感」这类**一切人像精修都成立的硬约束**
 *   放在系统提示词（`resolvePortraitRetouchSystemPrompt`），
 *   否则每个节点的提示词都要重复一遍，还会随参数变化而漂移。
 *
 * 缺依赖的组**整组跳过**：模型看不到脸的关键点又硬让它「眼睛放大」，
 * 结果通常是随机改一张脸 —— 少修一项远好过改错。
 */
/** 依赖门禁需要为「被跳过的组」推导负面提示词，因此按组收集负面片段 */
function groupNegativeClauses(
  state: PortraitRetouchState
): Partial<Record<PortraitToolGroupId, string[]>> {
  const out: Partial<Record<PortraitToolGroupId, string[]>> = {}
  const heavy = (key: PortraitTierKey): boolean => {
    const value = state[key]
    return value === 'strong' || value === 'max'
  }
  const put = (group: PortraitToolGroupId, clauses: string[]): void => {
    if (clauses.length) out[group] = [...(out[group] ?? []), ...clauses]
  }

  // 磨皮质感类负面词按**字段实际所属的组**登记：softFocus 属于 texture，
  // 挂到 skin 会在「只推柔焦」时被按生效组裁剪掉（负面词永远发不出去）
  if (heavy('skinSmoothing')) {
    put('skin', ['过度磨皮', '塑料感', '蜡像皮肤', '毛孔完全消失'])
  }
  if (heavy('softFocus')) put('texture', ['塑料感', '蜡像皮肤', '毛孔完全消失'])
  if (heavy('skinWhiten')) put('tone', ['肤色过白失真', '过曝'])
  if (heavy('faceSlim') || heavy('jawline') || heavy('chin')) {
    put('face', ['脸型扭曲', '骨相改变', '五官变形'])
  }
  if (heavy('eyeSize') || heavy('pupilSize')) put('face', ['眼睛比例失真', '瞳孔异常'])
  if (heavy('noseShape') || heavy('lipShape')) put('face', ['鼻唇变形'])
  if (heavy('waistSlim') || heavy('shoulderNeck') || heavy('legLengthen')) {
    put('body', ['身体比例失真', '背景拉伸变形', '肢体扭曲'])
  }
  if (heavy('grain')) put('texture', ['噪点过重'])
  if (heavy('sharpness') || heavy('clarity')) put('texture', ['锐化过度', '边缘白边'])
  if (state.bgMode !== 'keep') put('background', ['人物边缘出现光晕', '背景与人物割裂'])
  if (state.idPhotoSpecId !== 'none') {
    put('idPhoto', ['歪头', '表情夸张', '侧脸', '额头或下巴被裁切'])
  }
  if (state.lutId === 'bw') put('color', ['残留彩色'])
  return out
}

/** 某组当前参数会产出的正向片段（提示词语序与门禁共用同一份口径） */
function clausesFor(state: PortraitRetouchState, groupId: PortraitToolGroupId): string[] {
  if (groupId === 'background') return backgroundClauses(state)
  // 妆容先定「妆面」再加细节，读起来才像一句话
  return groupId === 'makeup'
    ? [...enumClause(state, groupId), ...tierClauses(state, groupId)]
    : [...tierClauses(state, groupId), ...enumClause(state, groupId)]
}

export function buildPortraitPrompt(input: PortraitPromptInput): PortraitPrompt {
  const state = normalizePortraitRetouch(input.state)
  const appliedGroups: PortraitToolGroupId[] = []
  const skippedGroups: PortraitToolGroupId[] = []
  const parts: string[] = []

  // 证件照是「重构图」诉求，必须放在最前面，后面的美容诉求都是为它服务
  if (input.idPhoto) {
    const info = input.idPhoto
    parts.push(
      `按 ${info.label}（${info.widthMm}×${info.heightMm}mm）证件照规格构图：正面免冠、双肩入画、头部居中，` +
        `头顶留出约 8% 边距、下巴完整可见`
    )
    parts.push(`证件照底色为${info.background}`)
    appliedGroups.push('idPhoto')
  }

  // 提示词的语序刻意与工具轨的语义顺序（而非数组顺序）一致：
  // 先「修」再「调」最后「换背景」，读起来像一份连贯的修图单。
  const groupOrder: PortraitToolGroupId[] = [
    'heal',
    'skin',
    'tone',
    'face',
    'eyes',
    'makeup',
    'body',
    'light',
    'color',
    'texture',
    'background'
  ]

  for (const groupId of groupOrder) {
    const group = PORTRAIT_TOOL_GROUPS.find((item) => item.id === groupId)!
    // 背景组对蒙版的需求取决于具体做法：只有「虚化」要人像分割，
    // 换底色 / 换场景属于重绘背景，没有蒙版也能做 —— 所以背景组不吃 group.needs 的 mask 项
    const needMask = groupId === 'background' && state.bgMode === 'blur'
    const otherNeeds = (group.needs ?? []).filter((need) => need !== 'mask')
    const needsOk = otherNeeds.every((need) => input.needs[need]) && (!needMask || input.needs.mask)
    const clauses = clausesFor(state, groupId)
    if (!needsOk) {
      // 只有「本来想做、但缺依赖」的组才算 skipped；没被设置的组不该污染运行日志
      if (clauses.length) skippedGroups.push(groupId)
      continue
    }
    if (clauses.length) {
      appliedGroups.push(groupId)
      parts.push(...clauses)
    }
  }

  // 手动区域：位置诉求与「要修什么」无关，放在最后单独说明
  const regionParts = regionClauses(state)
  if (regionParts.length) {
    appliedGroups.push('region')
    parts.push(...regionParts)
  }

  // 负面提示词按**实际生效的组**裁剪：被 needs 跳过的组不该再对它压约束
  // （脸部工具全被跳过时还压「不要五官变形」，会削弱模型对其它诉求的执行力）
  const negativeByGroup = groupNegativeClauses(state)
  const negative: string[] = []
  for (const groupId of [...groupOrder, 'region', 'idPhoto'] as PortraitToolGroupId[]) {
    if (groupId !== 'idPhoto' && !appliedGroups.includes(groupId)) continue
    const clauses = negativeByGroup[groupId]
    if (clauses) negative.push(...clauses)
  }

  return {
    main: parts.join('；'),
    negative: negative.join('，'),
    appliedGroups,
    skippedGroups
  }
}

/** 副作用说明：档位推得太高时提醒身份保真风险（UI 展示，不参与提示词） */
export function portraitIdentityRiskKeys(state: PortraitRetouchState): PortraitTierKey[] {
  const s = normalizePortraitRetouch(state)
  const keys: PortraitTierKey[] = []
  for (const spec of PORTRAIT_PARAM_SPECS) {
    if (spec.kind !== 'tier') continue
    const value = s[spec.key]
    if (value === 'strong' || value === 'max') keys.push(spec.key)
  }
  return keys
}

// ── 编辑器内 AI 版本栈 ─────────────────────────────────────────
//
// 与主执行路径（运行节点 → 按参数调模型）是两条独立的路径：
// 版本栈是「用户在编辑器里针对当前画面手动试了几版」，结果落成工程资产并记进节点，
// 用户可选任一版作为下次 Cook 的底图（`portraitBaseLayerId`）。
// 之所以保留：无破坏性试错与可回滚是编辑器的核心体验，与内部实现无关。

export type PortraitAiTool =
  'erase' | 'expand' | 'background' | 'makeup' | 'upscale' | 'skinTexture'

/** 编辑器内 AI 处理产出的一个版本（存节点 params.portraitLayers） */
export interface PortraitAiLayer {
  id: string
  tool: PortraitAiTool
  /** 实际发出的提示词（含用户补充） */
  prompt: string
  model: string
  providerInstanceId: string
  /** 落盘后的工程相对路径 */
  relativePath: string
  /** 落盘产生的资产 id（若有） */
  assetId?: string
  at: string
}

export const PORTRAIT_AI_LAYER_LIMIT = 20

/** AI 版本栈归一化：丢弃没有落盘路径的条目，最多保留最近 N 个 */
export function normalizePortraitAiLayers(
  raw?: readonly (Partial<PortraitAiLayer> | null | undefined)[] | null
): PortraitAiLayer[] {
  if (!Array.isArray(raw)) return []
  const out: PortraitAiLayer[] = []
  for (const item of raw) {
    if (!item) continue
    const relativePath = typeof item.relativePath === 'string' ? item.relativePath.trim() : ''
    if (!relativePath) continue
    out.push({
      id: typeof item.id === 'string' && item.id ? item.id : `layer-${out.length + 1}`,
      tool: (item.tool ?? 'erase') as PortraitAiTool,
      prompt: typeof item.prompt === 'string' ? item.prompt : '',
      model: typeof item.model === 'string' ? item.model : '',
      providerInstanceId:
        typeof item.providerInstanceId === 'string' ? item.providerInstanceId : '',
      relativePath,
      ...(typeof item.assetId === 'string' && item.assetId ? { assetId: item.assetId } : {}),
      at: typeof item.at === 'string' && item.at ? item.at : new Date().toISOString()
    })
  }
  return out.slice(-PORTRAIT_AI_LAYER_LIMIT)
}

/**
 * AI 工具的中文提示词片段。
 * 与 `imageEdit.ts` 同口径：模型不认识应用内约定，需给出明确的画质与保持要求。
 */
export function buildPortraitAiPrompt(tool: PortraitAiTool, userPrompt?: string): string {
  const base: Record<PortraitAiTool, string> = {
    erase: '去除圈选区域内的人物与杂物，用周围背景自然填补，保持原图画质、光照方向与透视不变', // cjk-ok（提示词数据：发给图片模型的中文指令，非 UI 文案）
    expand: '在保持人物面部与身体比例完全不变的前提下向外扩展画面，补全背景与边缘', // cjk-ok（提示词数据）
    background: '替换背景为指定场景，人物边缘自然融合，保留原人物光影与肤色不变', // cjk-ok（提示词数据）
    makeup: '在保留人物五官形状、肤质与身份特征的前提下，按描述补足妆容细节，妆面自然不糊脸', // cjk-ok（提示词数据）
    upscale: '提升分辨率并补足细节，保持人物身份特征与五官形状不变，不改变构图', // cjk-ok（提示词数据）
    skinTexture: '在保留原始皮肤纹理与毛孔质感的前提下优化肤质，不做塑料感磨皮' // cjk-ok（提示词数据）
  }
  const tail = userPrompt?.trim()
  return tail ? `${base[tool]}。${tail}` : base[tool]
}
