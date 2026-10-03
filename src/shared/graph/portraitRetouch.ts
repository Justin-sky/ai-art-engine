/**
 * 人像处理（PixCake 式精修）参数契约。
 *
 * 这一层是**唯一真相来源**：编辑器 UI、节点卡、执行器、批量套用、预设导入导出
 * 全部从 `PORTRAIT_PARAM_SPECS` 派生，避免「UI 加了一个滑块、执行器不知道」这类脱钩。
 *
 * 设计口径：
 * - 全部参数无破坏性地存在节点 params 里（`portraitRetouch`），随时可重编辑；
 * - 笔刷类工具（修复 / 液化 / 局部磨皮 / 背景蒙版）的笔画单独存 `portraitStrokes`，
 *   因为它们是**逐笔数据**而非标量，且必须落盘才能让 Cook 可复现；
 * - 每个参数带 `needs` 声明依赖（人脸关键点 / 人像分割 / 人体姿态），
 *   依赖缺失时由 UI 禁用并给出原因，执行器跳过该组而不是报错。
 */

/** 参数依赖：人脸关键点 / 人像分割 / 人体姿态 */
export type PortraitNeed = 'face' | 'mask' | 'pose'

/** 工具分组 id：与编辑器左侧工具轨一一对应 */
export type PortraitToolGroupId =
  | 'heal'
  | 'skin'
  | 'tone'
  | 'face'
  | 'liquify'
  | 'eyes'
  | 'teeth'
  | 'makeup'
  | 'body'
  | 'light'
  | 'color'
  | 'texture'
  | 'background'
  | 'aiErase'
  | 'idPhoto'
  | 'preset'
  | 'export'

export interface PortraitToolGroup {
  id: PortraitToolGroupId
  /** i18n key suffix under graph.portrait.groups.* */
  labelKey: string
  icon: string
  /** 该组是否有笔刷工具（有则显示笔刷设置） */
  brush?: boolean
  /** 依赖（整组） */
  needs?: readonly PortraitNeed[]
}

export const PORTRAIT_TOOL_GROUPS: readonly PortraitToolGroup[] = [
  { id: 'heal', labelKey: 'heal', icon: '🩹', brush: true, needs: ['face'] },
  { id: 'skin', labelKey: 'skin', icon: '🧴', brush: true, needs: ['face'] },
  { id: 'tone', labelKey: 'tone', icon: '✨', needs: ['face'] },
  { id: 'face', labelKey: 'face', icon: '🙂', needs: ['face'] },
  { id: 'liquify', labelKey: 'liquify', icon: '💧', brush: true },
  { id: 'eyes', labelKey: 'eyes', icon: '👁️', needs: ['face'] },
  { id: 'teeth', labelKey: 'teeth', icon: '🦷', needs: ['face'] },
  { id: 'makeup', labelKey: 'makeup', icon: '💄', needs: ['face'] },
  { id: 'body', labelKey: 'body', icon: '🧍', needs: ['pose'] },
  { id: 'light', labelKey: 'light', icon: '💡', needs: ['face'] },
  { id: 'color', labelKey: 'color', icon: '🎚️' },
  { id: 'texture', labelKey: 'texture', icon: '🪶' },
  { id: 'background', labelKey: 'background', icon: '🏞️', brush: true, needs: ['mask'] },
  { id: 'aiErase', labelKey: 'aiErase', icon: '🪄' },
  { id: 'idPhoto', labelKey: 'idPhoto', icon: '🪪', needs: ['face'] },
  { id: 'preset', labelKey: 'preset', icon: '📚' },
  { id: 'export', labelKey: 'export', icon: '💾' }
] as const

/** 当前参数结构版本：结构变化时递增，用于读旧工程时补齐 / 迁移 */
export const PORTRAIT_RETOUCH_VERSION = 1

export interface PortraitRetouchState {
  v: number
  // ── 1 修复 ───────────────────────────────────────────────
  blemishRemoval: number
  darkCircle: number
  eyeBag: number
  nasolabial: number
  foreheadLines: number
  neckLines: number
  shineRemoval: number
  redEye: number
  strayHair: number
  // ── 2 磨皮 ───────────────────────────────────────────────
  skinSmoothing: number
  skinPore: number
  skinEvenness: number
  skinDenoise: number
  // ── 3 美白肤色 ───────────────────────────────────────────
  skinWhiten: number
  skinRosy: number
  skinTone: number
  skinDeYellow: number
  // ── 4 五官微调 ───────────────────────────────────────────
  faceSlim: number
  cheekbone: number
  jawline: number
  chinLength: number
  chinSharp: number
  foreheadHeight: number
  eyeSize: number
  eyeSpacing: number
  eyeTail: number
  doubleEyelid: number
  eyeBagVolume: number
  noseBridge: number
  noseWing: number
  noseTip: number
  mouthSize: number
  lipThickness: number
  lipShape: number
  browHeight: number
  browThickness: number
  // ── 6 眼睛 ───────────────────────────────────────────────
  catchlight: number
  eyeWhiten: number
  pupilSize: number
  eyeShadow: number
  // ── 7 牙齿 ───────────────────────────────────────────────
  teethWhiten: number
  teethBrighten: number
  lipColorRepair: number
  // ── 8 妆容 ───────────────────────────────────────────────
  makeupPresetId: string
  makeupIntensity: number
  makeupBrow: number
  makeupEyeShadow: number
  makeupEyeliner: number
  makeupLash: number
  makeupBlush: number
  makeupLip: number
  makeupContour: number
  makeupHighlight: number
  makeupHue: number
  makeupSaturation: number
  // ── 9 身形 ───────────────────────────────────────────────
  bodySlim: number
  waistSlim: number
  hipLift: number
  armSlim: number
  shoulderBeauty: number
  neckLengthen: number
  legLengthen: number
  headBodyRatio: number
  // ── 10 光影 ──────────────────────────────────────────────
  fillLight: number
  rimLight: number
  highlightRepair: number
  shadowLift: number
  faceContour: number
  lightRatio: number
  lightTemp: number
  // ── 11 调色 ──────────────────────────────────────────────
  exposure: number
  contrast: number
  highlights: number
  shadows: number
  whites: number
  blacks: number
  colorTemp: number
  tint: number
  vibrance: number
  saturation: number
  hslHue: number
  hslSat: number
  hslLum: number
  lutId: string
  // ── 12 质感 ──────────────────────────────────────────────
  sharpness: number
  clarity: number
  grain: number
  softFocus: number
  vignette: number
  // ── 13 背景 ──────────────────────────────────────────────
  bgBlur: number
  bgBlurRadius: number
  bgMode: PortraitBackgroundMode
  bgColor: string
  bgColorTo: string
  bgEdgeFeather: number
  bgEdgeDecontaminate: number
  // ── 15 证件照 ────────────────────────────────────────────
  idPhotoSpecId: string
  idPhotoBg: PortraitIdPhotoBg
  idPhotoSheet: boolean
  // ── 17 导出 ──────────────────────────────────────────────
  exportFormat: PortraitExportFormat
  exportQuality: number
  exportMaxEdge: number
  exportDpi: number
}

export type PortraitBackgroundMode = 'keep' | 'color' | 'gradient'
export type PortraitIdPhotoBg = 'white' | 'blue' | 'red' | 'gradient'
export type PortraitExportFormat = 'png' | 'jpeg'

export type PortraitNumericKey = {
  [K in keyof PortraitRetouchState]: PortraitRetouchState[K] extends number ? K : never
}[keyof PortraitRetouchState]
export type PortraitStringKey = {
  [K in keyof PortraitRetouchState]: PortraitRetouchState[K] extends string ? K : never
}[keyof PortraitRetouchState]

export interface PortraitNumericSpec {
  kind: 'number'
  key: PortraitNumericKey
  group: PortraitToolGroupId
  /** i18n key suffix under graph.portrait.fields.* */
  labelKey: string
  min: number
  max: number
  step: number
  default: number
  /** 依赖：缺依赖时 UI 禁用、执行器跳过 */
  needs?: readonly PortraitNeed[]
}

export interface PortraitEnumOption {
  id: string
  labelKey: string
}

export interface PortraitEnumSpec {
  kind: 'enum'
  key: PortraitStringKey
  group: PortraitToolGroupId
  labelKey: string
  default: string
  options: readonly PortraitEnumOption[]
  needs?: readonly PortraitNeed[]
}

export interface PortraitColorSpec {
  kind: 'color'
  key: PortraitStringKey
  group: PortraitToolGroupId
  labelKey: string
  default: string
  needs?: readonly PortraitNeed[]
}

export interface PortraitBoolSpec {
  kind: 'boolean'
  key: keyof PortraitRetouchState & string
  group: PortraitToolGroupId
  labelKey: string
  default: boolean
  needs?: readonly PortraitNeed[]
}

export type PortraitParamSpec =
  PortraitNumericSpec | PortraitEnumSpec | PortraitColorSpec | PortraitBoolSpec

/** 双向参数（-100..100）的常见档位：0 = 不动 */
function bi(
  key: PortraitNumericKey,
  group: PortraitToolGroupId,
  labelKey: string,
  needs?: readonly PortraitNeed[]
): PortraitNumericSpec {
  return { kind: 'number', key, group, labelKey, min: -100, max: 100, step: 1, default: 0, needs }
}

/** 单向强度参数（0..100）的常见档位：0 = 关闭 */
function uni(
  key: PortraitNumericKey,
  group: PortraitToolGroupId,
  labelKey: string,
  def = 0,
  needs?: readonly PortraitNeed[]
): PortraitNumericSpec {
  return { kind: 'number', key, group, labelKey, min: 0, max: 100, step: 1, default: def, needs }
}

/**
 * 全部参数规格。顺序 = 面板内展示顺序。
 */
export const PORTRAIT_PARAM_SPECS: readonly PortraitParamSpec[] = [
  // 1 修复
  uni('blemishRemoval', 'heal', 'blemishRemoval', 25, ['face']),
  uni('darkCircle', 'heal', 'darkCircle', 0, ['face']),
  uni('eyeBag', 'heal', 'eyeBag', 0, ['face']),
  uni('nasolabial', 'heal', 'nasolabial', 0, ['face']),
  uni('foreheadLines', 'heal', 'foreheadLines', 0, ['face']),
  uni('neckLines', 'heal', 'neckLines', 0, ['face']),
  uni('shineRemoval', 'heal', 'shineRemoval', 0, ['face']),
  uni('redEye', 'heal', 'redEye', 0, ['face']),
  uni('strayHair', 'heal', 'strayHair', 0, ['face']),
  // 2 磨皮
  uni('skinSmoothing', 'skin', 'skinSmoothing', 30, ['face']),
  uni('skinPore', 'skin', 'skinPore', 55, ['face']),
  uni('skinEvenness', 'skin', 'skinEvenness', 25, ['face']),
  uni('skinDenoise', 'skin', 'skinDenoise', 15),
  // 3 美白肤色
  uni('skinWhiten', 'tone', 'skinWhiten', 10, ['face']),
  uni('skinRosy', 'tone', 'skinRosy', 0, ['face']),
  bi('skinTone', 'tone', 'skinTone', ['face']),
  uni('skinDeYellow', 'tone', 'skinDeYellow', 10, ['face']),
  // 4 五官微调
  bi('faceSlim', 'face', 'faceSlim', ['face']),
  bi('cheekbone', 'face', 'cheekbone', ['face']),
  bi('jawline', 'face', 'jawline', ['face']),
  bi('chinLength', 'face', 'chinLength', ['face']),
  bi('chinSharp', 'face', 'chinSharp', ['face']),
  bi('foreheadHeight', 'face', 'foreheadHeight', ['face']),
  bi('eyeSize', 'face', 'eyeSize', ['face']),
  bi('eyeSpacing', 'face', 'eyeSpacing', ['face']),
  bi('eyeTail', 'face', 'eyeTail', ['face']),
  uni('doubleEyelid', 'face', 'doubleEyelid', 0, ['face']),
  uni('eyeBagVolume', 'face', 'eyeBagVolume', 0, ['face']),
  bi('noseBridge', 'face', 'noseBridge', ['face']),
  bi('noseWing', 'face', 'noseWing', ['face']),
  bi('noseTip', 'face', 'noseTip', ['face']),
  bi('mouthSize', 'face', 'mouthSize', ['face']),
  bi('lipThickness', 'face', 'lipThickness', ['face']),
  bi('lipShape', 'face', 'lipShape', ['face']),
  bi('browHeight', 'face', 'browHeight', ['face']),
  bi('browThickness', 'face', 'browThickness', ['face']),
  // 6 眼睛
  uni('catchlight', 'eyes', 'catchlight', 0, ['face']),
  uni('eyeWhiten', 'eyes', 'eyeWhiten', 0, ['face']),
  bi('pupilSize', 'eyes', 'pupilSize', ['face']),
  uni('eyeShadow', 'eyes', 'eyeShadow', 0, ['face']),
  // 7 牙齿
  uni('teethWhiten', 'teeth', 'teethWhiten', 0, ['face']),
  uni('teethBrighten', 'teeth', 'teethBrighten', 0, ['face']),
  uni('lipColorRepair', 'teeth', 'lipColorRepair', 0, ['face']),
  // 8 妆容
  {
    kind: 'enum',
    key: 'makeupPresetId',
    group: 'makeup',
    labelKey: 'makeupPresetId',
    default: 'none',
    needs: ['face'],
    options: [
      { id: 'none', labelKey: 'none' },
      { id: 'nude', labelKey: 'nude' },
      { id: 'portrait', labelKey: 'portrait' },
      { id: 'bride', labelKey: 'bride' },
      { id: 'child', labelKey: 'child' },
      { id: 'hongkong', labelKey: 'hongkong' },
      { id: 'office', labelKey: 'office' },
      { id: 'stage', labelKey: 'stage' }
    ]
  },
  uni('makeupIntensity', 'makeup', 'makeupIntensity', 0, ['face']),
  uni('makeupBrow', 'makeup', 'makeupBrow', 0, ['face']),
  uni('makeupEyeShadow', 'makeup', 'makeupEyeShadow', 0, ['face']),
  uni('makeupEyeliner', 'makeup', 'makeupEyeliner', 0, ['face']),
  uni('makeupLash', 'makeup', 'makeupLash', 0, ['face']),
  uni('makeupBlush', 'makeup', 'makeupBlush', 0, ['face']),
  uni('makeupLip', 'makeup', 'makeupLip', 0, ['face']),
  uni('makeupContour', 'makeup', 'makeupContour', 0, ['face']),
  uni('makeupHighlight', 'makeup', 'makeupHighlight', 0, ['face']),
  bi('makeupHue', 'makeup', 'makeupHue', ['face']),
  uni('makeupSaturation', 'makeup', 'makeupSaturation', 40, ['face']),
  // 9 身形
  uni('bodySlim', 'body', 'bodySlim', 0, ['pose']),
  uni('waistSlim', 'body', 'waistSlim', 0, ['pose']),
  uni('hipLift', 'body', 'hipLift', 0, ['pose']),
  uni('armSlim', 'body', 'armSlim', 0, ['pose']),
  uni('shoulderBeauty', 'body', 'shoulderBeauty', 0, ['pose']),
  uni('neckLengthen', 'body', 'neckLengthen', 0, ['pose']),
  uni('legLengthen', 'body', 'legLengthen', 0, ['pose']),
  uni('headBodyRatio', 'body', 'headBodyRatio', 0, ['pose']),
  // 10 光影
  uni('fillLight', 'light', 'fillLight', 0, ['face']),
  uni('rimLight', 'light', 'rimLight', 0, ['face']),
  uni('highlightRepair', 'light', 'highlightRepair', 0),
  uni('shadowLift', 'light', 'shadowLift', 0),
  uni('faceContour', 'light', 'faceContour', 0, ['face']),
  uni('lightRatio', 'light', 'lightRatio', 0, ['face']),
  bi('lightTemp', 'light', 'lightTemp'),
  // 11 调色
  bi('exposure', 'color', 'exposure'),
  bi('contrast', 'color', 'contrast'),
  bi('highlights', 'color', 'highlights'),
  bi('shadows', 'color', 'shadows'),
  bi('whites', 'color', 'whites'),
  bi('blacks', 'color', 'blacks'),
  bi('colorTemp', 'color', 'colorTemp'),
  bi('tint', 'color', 'tint'),
  bi('vibrance', 'color', 'vibrance'),
  bi('saturation', 'color', 'saturation'),
  bi('hslHue', 'color', 'hslHue'),
  bi('hslSat', 'color', 'hslSat'),
  bi('hslLum', 'color', 'hslLum'),
  {
    kind: 'enum',
    key: 'lutId',
    group: 'color',
    labelKey: 'lutId',
    default: 'none',
    options: [
      { id: 'none', labelKey: 'none' },
      { id: 'clear', labelKey: 'clear' },
      { id: 'warmFilm', labelKey: 'warmFilm' },
      { id: 'coolFilm', labelKey: 'coolFilm' },
      { id: 'fuji', labelKey: 'fuji' },
      { id: 'kodak', labelKey: 'kodak' },
      { id: 'hongkong', labelKey: 'hongkong' },
      { id: 'japanese', labelKey: 'japanese' },
      { id: 'morandi', labelKey: 'morandi' },
      { id: 'blackGold', labelKey: 'blackGold' },
      { id: 'bw', labelKey: 'bw' },
      { id: 'sepia', labelKey: 'sepia' }
    ]
  },
  // 12 质感
  uni('sharpness', 'texture', 'sharpness', 20),
  uni('clarity', 'texture', 'clarity', 0),
  uni('grain', 'texture', 'grain', 0),
  uni('softFocus', 'texture', 'softFocus', 0),
  uni('vignette', 'texture', 'vignette', 0),
  // 13 背景
  uni('bgBlur', 'background', 'bgBlur', 0, ['mask']),
  uni('bgBlurRadius', 'background', 'bgBlurRadius', 20, ['mask']),
  {
    kind: 'enum',
    key: 'bgMode',
    group: 'background',
    labelKey: 'bgMode',
    default: 'keep',
    needs: ['mask'],
    options: [
      { id: 'keep', labelKey: 'keep' },
      { id: 'color', labelKey: 'color' },
      { id: 'gradient', labelKey: 'gradient' }
    ]
  },
  { kind: 'color', key: 'bgColor', group: 'background', labelKey: 'bgColor', default: '#ffffff' },
  {
    kind: 'color',
    key: 'bgColorTo',
    group: 'background',
    labelKey: 'bgColorTo',
    default: '#dbeafe'
  },
  uni('bgEdgeFeather', 'background', 'bgEdgeFeather', 20, ['mask']),
  uni('bgEdgeDecontaminate', 'background', 'bgEdgeDecontaminate', 0, ['mask']),
  // 15 证件照
  {
    kind: 'enum',
    key: 'idPhotoSpecId',
    group: 'idPhoto',
    labelKey: 'idPhotoSpecId',
    default: 'none',
    options: [
      { id: 'none', labelKey: 'none' },
      { id: 'oneInch', labelKey: 'oneInch' },
      { id: 'smallOneInch', labelKey: 'smallOneInch' },
      { id: 'largeOneInch', labelKey: 'largeOneInch' },
      { id: 'twoInch', labelKey: 'twoInch' },
      { id: 'smallTwoInch', labelKey: 'smallTwoInch' },
      { id: 'passport', labelKey: 'passport' },
      { id: 'visa', labelKey: 'visa' },
      { id: 'driverLicense', labelKey: 'driverLicense' },
      { id: 'socialSecurity', labelKey: 'socialSecurity' },
      { id: 'custom', labelKey: 'custom' }
    ]
  },
  {
    kind: 'enum',
    key: 'idPhotoBg',
    group: 'idPhoto',
    labelKey: 'idPhotoBg',
    default: 'white',
    needs: ['face'],
    options: [
      { id: 'white', labelKey: 'white' },
      { id: 'blue', labelKey: 'blue' },
      { id: 'red', labelKey: 'red' },
      { id: 'gradient', labelKey: 'gradient' }
    ]
  },
  {
    kind: 'boolean',
    key: 'idPhotoSheet',
    group: 'idPhoto',
    labelKey: 'idPhotoSheet',
    default: false
  },
  // 17 导出
  {
    kind: 'enum',
    key: 'exportFormat',
    group: 'export',
    labelKey: 'exportFormat',
    default: 'jpeg',
    options: [
      { id: 'jpeg', labelKey: 'jpeg' },
      { id: 'png', labelKey: 'png' }
    ]
  },
  {
    kind: 'number',
    key: 'exportQuality',
    group: 'export',
    labelKey: 'exportQuality',
    min: 60,
    max: 100,
    step: 1,
    default: 92
  },
  {
    kind: 'number',
    key: 'exportMaxEdge',
    group: 'export',
    labelKey: 'exportMaxEdge',
    min: 0,
    max: 8192,
    step: 64,
    default: 0
  },
  {
    kind: 'number',
    key: 'exportDpi',
    group: 'export',
    labelKey: 'exportDpi',
    min: 72,
    max: 600,
    step: 1,
    default: 300
  }
] as const

/** 笔刷工具（笔画数据存 params.portraitStrokes） */
export type PortraitBrushTool = 'liquify' | 'heal' | 'smooth' | 'bgMask' | 'freeze'
export type PortraitLiquifyMode = 'push' | 'bloat' | 'pinch' | 'restore'

export interface PortraitStrokePoint {
  /** 归一化坐标 0..1（相对原图，与分辨率解耦） */
  x: number
  y: number
  /** 液化推拉的位移（归一化，其他工具为 0） */
  dx?: number
  dy?: number
}

export interface PortraitBrushStroke {
  id: string
  tool: PortraitBrushTool
  /** 液化子模式 */
  mode?: PortraitLiquifyMode
  /** 笔刷直径，相对原图长边的比例 0..1 */
  size: number
  /** 硬度 0..100 */
  hardness: number
  /** 力度 0..100 */
  strength: number
  points: PortraitStrokePoint[]
}

export const PORTRAIT_BRUSH_TOOLS: readonly PortraitBrushTool[] = [
  'liquify',
  'heal',
  'smooth',
  'bgMask',
  'freeze'
] as const

export const PORTRAIT_LIQUIFY_MODES: readonly PortraitLiquifyMode[] = [
  'push',
  'bloat',
  'pinch',
  'restore'
] as const

export const PORTRAIT_STROKE_LIMIT = 2000

export interface PortraitPresetDef {
  id: string
  /** i18n key suffix under graph.portrait.presets.* */
  labelKey: string
  /** 内置预设的覆盖值（缺省字段取默认值） */
  patch: Partial<PortraitRetouchState>
}

/** 内置预设：只覆盖关键字段，其余取默认，避免预设之间互相污染 */
export const PORTRAIT_PRESETS: readonly PortraitPresetDef[] = [
  { id: 'natural', labelKey: 'natural', patch: { skinSmoothing: 28, skinPore: 60, sharpness: 18 } },
  {
    id: 'portrait',
    labelKey: 'portrait',
    patch: {
      skinSmoothing: 45,
      skinPore: 40,
      skinWhiten: 22,
      faceContour: 30,
      sharpness: 30,
      clarity: 12,
      lutId: 'clear'
    }
  },
  {
    id: 'bride',
    labelKey: 'bride',
    patch: {
      skinSmoothing: 58,
      skinPore: 30,
      skinWhiten: 32,
      skinRosy: 18,
      teethWhiten: 35,
      catchlight: 30,
      eyeWhiten: 20,
      makeupPresetId: 'bride',
      makeupIntensity: 45,
      fillLight: 25,
      lutId: 'warmFilm'
    }
  },
  {
    id: 'child',
    labelKey: 'child',
    patch: {
      skinSmoothing: 35,
      skinPore: 55,
      skinRosy: 25,
      skinWhiten: 12,
      makeupPresetId: 'child',
      makeupIntensity: 20,
      saturation: 8,
      lutId: 'japanese'
    }
  },
  {
    id: 'idPhoto',
    labelKey: 'idPhoto',
    patch: {
      skinSmoothing: 30,
      skinWhiten: 25,
      skinDeYellow: 25,
      bgMode: 'color',
      bgColor: '#ffffff',
      idPhotoSpecId: 'oneInch',
      idPhotoBg: 'white',
      sharpness: 35,
      lutId: 'none'
    }
  },
  {
    id: 'hongkong',
    labelKey: 'hongkong',
    patch: {
      skinSmoothing: 40,
      faceContour: 35,
      saturation: 12,
      contrast: 15,
      colorTemp: 12,
      makeupPresetId: 'hongkong',
      makeupIntensity: 40,
      lutId: 'hongkong'
    }
  },
  {
    id: 'clear',
    labelKey: 'clear',
    patch: {
      skinSmoothing: 25,
      skinWhiten: 20,
      skinDeYellow: 20,
      exposure: 6,
      shadows: 12,
      clarity: 15,
      lutId: 'clear'
    }
  },
  {
    id: 'texture',
    labelKey: 'texture',
    patch: { skinSmoothing: 18, skinPore: 85, clarity: 22, sharpness: 30, grain: 12 }
  },
  {
    id: 'film',
    labelKey: 'film',
    patch: { contrast: 12, saturation: -8, grain: 25, vignette: 18, lutId: 'kodak' }
  },
  {
    id: 'bw',
    labelKey: 'bw',
    patch: { saturation: -100, contrast: 18, clarity: 18, grain: 15, lutId: 'bw' }
  },
  {
    id: 'legacyTone',
    labelKey: 'legacyTone',
    patch: { softFocus: 25, highlights: -10, saturation: -12, lutId: 'sepia' }
  },
  {
    id: 'stage',
    labelKey: 'stage',
    patch: {
      skinSmoothing: 55,
      faceContour: 45,
      catchlight: 45,
      makeupPresetId: 'stage',
      makeupIntensity: 55,
      rimLight: 35,
      lutId: 'blackGold'
    }
  }
] as const

/** 由规格表生成默认状态（单一来源，避免默认值两处维护） */
export function defaultPortraitRetouch(): PortraitRetouchState {
  const out: Record<string, number | string | boolean> = { v: PORTRAIT_RETOUCH_VERSION }
  for (const spec of PORTRAIT_PARAM_SPECS) out[spec.key] = spec.default
  return out as unknown as PortraitRetouchState
}

function clampNumber(value: unknown, spec: PortraitNumericSpec): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : spec.default
  const stepped = Math.round(n / spec.step) * spec.step
  return Math.min(spec.max, Math.max(spec.min, Number(stepped.toFixed(4))))
}

function pickEnum(value: unknown, spec: PortraitEnumSpec): string {
  return spec.options.some((o) => o.id === value) ? (value as string) : spec.default
}

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/

/**
 * 归一化：夹取数值、校验枚举与颜色、补齐缺失字段。
 * 读旧工程 / MCP 传入的脏参数都由这里兜住。
 */
export function normalizePortraitRetouch(
  raw?: Partial<PortraitRetouchState> | null
): PortraitRetouchState {
  const out = defaultPortraitRetouch() as unknown as Record<string, unknown>
  const input = (raw ?? {}) as Record<string, unknown>
  for (const spec of PORTRAIT_PARAM_SPECS) {
    const value = input[spec.key]
    if (value === undefined) continue
    if (spec.kind === 'number') out[spec.key] = clampNumber(value, spec)
    else if (spec.kind === 'enum') out[spec.key] = pickEnum(value, spec)
    else if (spec.kind === 'color')
      out[spec.key] = HEX_COLOR_RE.test(String(value)) ? value : spec.default
    else out[spec.key] = typeof value === 'boolean' ? value : spec.default
  }
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
  return current !== spec.default
}

export function changedPortraitParamCount(state: PortraitRetouchState): number {
  const normalized = normalizePortraitRetouch(state)
  return PORTRAIT_PARAM_SPECS.filter((spec) => isPortraitParamChanged(normalized, spec)).length
}

/** 取某工具组的参数规格（面板按组渲染） */
export function portraitSpecsForGroup(group: PortraitToolGroupId): PortraitParamSpec[] {
  return PORTRAIT_PARAM_SPECS.filter((spec) => spec.group === group)
}

/** 应用预设：以默认值为底叠加预设覆盖，再归一化 */
export function applyPortraitPreset(
  presetId: string,
  base?: Partial<PortraitRetouchState> | null
): PortraitRetouchState {
  const preset = PORTRAIT_PRESETS.find((p) => p.id === presetId)
  const merged = { ...defaultPortraitRetouch(), ...(base ?? {}), ...(preset?.patch ?? {}) }
  return normalizePortraitRetouch(merged)
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
  strokes?: PortraitBrushStroke[]
}

export function exportPortraitPreset(
  name: string,
  state: PortraitRetouchState,
  strokes?: readonly PortraitBrushStroke[]
): string {
  const payload: PortraitPresetFile = {
    app: 'aiartengine',
    kind: 'portrait-preset',
    v: PORTRAIT_RETOUCH_VERSION,
    name: name.trim() || 'preset',
    state: normalizePortraitRetouch(state),
    ...(strokes && strokes.length ? { strokes: normalizePortraitStrokes(strokes) } : {})
  }
  return JSON.stringify(payload, null, 2)
}

/** 解析预设 JSON；失败返回带原因的 null（调用方决定文案） */
export function importPortraitPreset(text: string):
  | { ok: true; name: string; state: PortraitRetouchState; strokes: PortraitBrushStroke[] }
  | {
      ok: false
      reason: 'invalid-json' | 'not-preset' | 'version'
    } {
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
    state: normalizePortraitRetouch(file.state),
    strokes: normalizePortraitStrokes(file.strokes)
  }
}

// ── 笔画归一化 ─────────────────────────────────────────────────

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

export function normalizePortraitStroke(
  raw: Partial<PortraitBrushStroke> | null | undefined
): PortraitBrushStroke | null {
  if (!raw) return null
  const tool = PORTRAIT_BRUSH_TOOLS.includes(raw.tool as PortraitBrushTool)
    ? (raw.tool as PortraitBrushTool)
    : null
  if (!tool) return null
  const points = Array.isArray(raw.points)
    ? raw.points
        .filter(
          (p): p is PortraitStrokePoint => !!p && Number.isFinite(p.x) && Number.isFinite(p.y)
        )
        .map((p) => ({
          x: clamp01(p.x),
          y: clamp01(p.y),
          ...(Number.isFinite(p.dx) ? { dx: p.dx } : {}),
          ...(Number.isFinite(p.dy) ? { dy: p.dy } : {})
        }))
    : []
  if (points.length === 0) return null
  const mode =
    tool === 'liquify' && PORTRAIT_LIQUIFY_MODES.includes(raw.mode as PortraitLiquifyMode)
      ? (raw.mode as PortraitLiquifyMode)
      : tool === 'liquify'
        ? 'push'
        : undefined
  return {
    id:
      typeof raw.id === 'string' && raw.id
        ? raw.id
        : `stroke-${Math.random().toString(36).slice(2, 10)}`,
    tool,
    ...(mode ? { mode } : {}),
    size: Math.min(1, Math.max(0.002, Number(raw.size) || 0.05)),
    hardness: Math.min(100, Math.max(0, Number(raw.hardness) || 60)),
    strength: Math.min(100, Math.max(0, Number(raw.strength) || 50)),
    points
  }
}

export function normalizePortraitStrokes(
  raw?: readonly (Partial<PortraitBrushStroke> | null | undefined)[] | null
): PortraitBrushStroke[] {
  if (!Array.isArray(raw)) return []
  const out: PortraitBrushStroke[] = []
  for (const item of raw) {
    const stroke = normalizePortraitStroke(item)
    if (stroke) out.push(stroke)
  }
  return out.slice(-PORTRAIT_STROKE_LIMIT)
}

/** 按工具筛选笔画（执行器逐组处理） */
export function portraitStrokesForTool(
  strokes: readonly PortraitBrushStroke[],
  tool: PortraitBrushTool
): PortraitBrushStroke[] {
  return strokes.filter((s) => s.tool === tool)
}

// ── AI 工具提示词（编辑器内直调图片模型时使用） ─────────────────

export type PortraitAiTool =
  'erase' | 'expand' | 'background' | 'makeup' | 'upscale' | 'skinTexture'

/**
 * 编辑器内 AI 处理产出的一个版本（存节点 params）。
 * 之所以把每次 AI 结果落成工程资产并记进节点，而不是只留在编辑器内存里：
 * Cook 必须确定性 —— 本地内核跑在一个**固定的底图**上，同一个节点参数重复运行
 * 才能得到同一张图；同时用户可以在版本列表里回滚到任意一次 AI 结果。
 */
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

/** AI 版本栈归一化：丢弃没有落盘路径的条目，最多保留最近 N 个 */
export const PORTRAIT_AI_LAYER_LIMIT = 20

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
