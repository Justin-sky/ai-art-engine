/**
 * 打光效果编辑器：灯光参数 ↔ 预设 ↔ 提示词。
 */

export type LightingViewMode = 'perspective' | 'frontal'

export type LightingDirection =
  'left' | 'top' | 'right' | 'front' | 'bottom' | 'back'

export type LightingPresetId =
  | 'custom'
  | 'overexposedFilm'
  | 'blueBacklight'
  | 'rembrandt'
  | 'cyberpunk'
  | 'sunsetPsychedelic'
  | 'mysteriousLowKey'
  | 'goldenHour'
  | 'nolanColdGrey'

export interface LightingSetupState {
  presetId: LightingPresetId
  viewMode: LightingViewMode
  /** 主光水平方位，度，[-180, 180]；0=正前 */
  yaw: number
  /** 主光俯仰，度，[-60, 60]；正=上方 */
  pitch: number
  /** 亮度 0..100 */
  brightness: number
  /** 主光颜色 #RRGGBB */
  color: string
  mainDirection: LightingDirection
  rimLight: boolean
  /** 智能模式：拼接 smartPrompt */
  smartMode: boolean
  smartPrompt: string
}

export interface LightingPresetDef {
  id: LightingPresetId
  titleKey: string
  yaw: number
  pitch: number
  brightness: number
  color: string
  mainDirection: LightingDirection
  rimLight: boolean
  /** 风格提示词 */
  prompt: string
}

export const LIGHTING_YAW_MIN = -180
export const LIGHTING_YAW_MAX = 180
export const LIGHTING_PITCH_MIN = -60
export const LIGHTING_PITCH_MAX = 60

export const LIGHTING_DIRECTIONS: readonly LightingDirection[] = [
  'left',
  'top',
  'right',
  'front',
  'bottom',
  'back'
] as const

/** 六向快捷方位 */
export const LIGHTING_DIRECTION_POSE: Record<
  LightingDirection,
  { yaw: number; pitch: number }
> = {
  front: { yaw: 0, pitch: 0 },
  back: { yaw: 180, pitch: 0 },
  left: { yaw: -90, pitch: 0 },
  right: { yaw: 90, pitch: 0 },
  top: { yaw: 0, pitch: 45 },
  bottom: { yaw: 0, pitch: -45 }
}

export const LIGHTING_PRESETS: readonly LightingPresetDef[] = [
  {
    id: 'custom',
    titleKey: 'custom',
    yaw: 0,
    pitch: 0,
    brightness: 50,
    color: '#ffffff',
    mainDirection: 'front',
    rimLight: false,
    prompt: ''
  },
  {
    id: 'overexposedFilm',
    titleKey: 'overexposedFilm',
    yaw: 35,
    pitch: 20,
    brightness: 85,
    color: '#fff4e0',
    mainDirection: 'right',
    rimLight: false,
    prompt: '过曝胶片感，高光溢出，柔和散射光，轻微褪色'
  },
  {
    id: 'blueBacklight',
    titleKey: 'blueBacklight',
    yaw: 180,
    pitch: 15,
    brightness: 60,
    color: '#7eb6ff',
    mainDirection: 'back',
    rimLight: true,
    prompt: '蓝色逆光，冷色轮廓光勾边，主体略暗，戏剧感强'
  },
  {
    id: 'rembrandt',
    titleKey: 'rembrandt',
    yaw: -45,
    pitch: 25,
    brightness: 55,
    color: '#ffe0b8',
    mainDirection: 'left',
    rimLight: false,
    prompt: '伦勃朗光，面颊三角光斑，明暗对比分明，古典油画感'
  },
  {
    id: 'cyberpunk',
    titleKey: 'cyberpunk',
    yaw: 90,
    pitch: -10,
    brightness: 70,
    color: '#ff3d9a',
    mainDirection: 'right',
    rimLight: true,
    prompt: '赛博朋克霓虹打光，品红与青色对比，潮湿反射，未来都市感'
  },
  {
    id: 'sunsetPsychedelic',
    titleKey: 'sunsetPsychedelic',
    yaw: -120,
    pitch: 10,
    brightness: 65,
    color: '#ff7a3d',
    mainDirection: 'back',
    rimLight: true,
    prompt: '落日迷幻光影，橙紫渐变天空光，长阴影，梦幻氛围'
  },
  {
    id: 'mysteriousLowKey',
    titleKey: 'mysteriousLowKey',
    yaw: -60,
    pitch: 5,
    brightness: 30,
    color: '#c8d0e0',
    mainDirection: 'left',
    rimLight: false,
    prompt: '神秘暗调，低调照明，大面积阴影，局部高光点缀'
  },
  {
    id: 'goldenHour',
    titleKey: 'goldenHour',
    yaw: -135,
    pitch: 20,
    brightness: 70,
    color: '#ffb347',
    mainDirection: 'back',
    rimLight: true,
    prompt: '黄金时刻暖色侧逆光，柔和高光，金色氛围，皮肤通透'
  },
  {
    id: 'nolanColdGrey',
    titleKey: 'nolanColdGrey',
    yaw: 30,
    pitch: 10,
    brightness: 45,
    color: '#d0d6de',
    mainDirection: 'right',
    rimLight: false,
    prompt: '诺兰冷灰色调，低饱和硬光，理性疏离，电影感布光'
  }
] as const

export const DEFAULT_LIGHTING_SETUP: LightingSetupState = {
  presetId: 'custom',
  viewMode: 'perspective',
  yaw: 0,
  pitch: 0,
  brightness: 50,
  color: '#ffffff',
  mainDirection: 'front',
  rimLight: false,
  smartMode: true,
  smartPrompt: ''
}

export function clampLightingYaw(yaw: number): number {
  if (!Number.isFinite(yaw)) return 0
  let v = yaw
  while (v > LIGHTING_YAW_MAX) v -= 360
  while (v < LIGHTING_YAW_MIN) v += 360
  return Math.round(v)
}

export function clampLightingPitch(pitch: number): number {
  if (!Number.isFinite(pitch)) return 0
  return Math.max(
    LIGHTING_PITCH_MIN,
    Math.min(LIGHTING_PITCH_MAX, Math.round(pitch))
  )
}

export function clampLightingBrightness(value: number): number {
  if (!Number.isFinite(value)) return 50
  return Math.max(0, Math.min(100, Math.round(value)))
}

export function normalizeLightingColor(color: string | undefined): string {
  const raw = (color ?? '').trim()
  if (/^#[0-9a-fA-F]{6}$/.test(raw)) return raw.toLowerCase()
  if (/^#[0-9a-fA-F]{3}$/.test(raw)) {
    const r = raw[1]!
    const g = raw[2]!
    const b = raw[3]!
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase()
  }
  return '#ffffff'
}

export function normalizeLightingSetup(
  raw?: Partial<LightingSetupState> | null
): LightingSetupState {
  const base = { ...DEFAULT_LIGHTING_SETUP, ...(raw ?? {}) }
  const presetId = LIGHTING_PRESETS.some((p) => p.id === base.presetId)
    ? base.presetId
    : 'custom'
  const mainDirection = LIGHTING_DIRECTIONS.includes(base.mainDirection)
    ? base.mainDirection
    : 'front'
  const viewMode: LightingViewMode =
    base.viewMode === 'frontal' ? 'frontal' : 'perspective'
  return {
    presetId,
    viewMode,
    yaw: clampLightingYaw(base.yaw),
    pitch: clampLightingPitch(base.pitch),
    brightness: clampLightingBrightness(base.brightness),
    color: normalizeLightingColor(base.color),
    mainDirection,
    rimLight: Boolean(base.rimLight),
    smartMode: Boolean(base.smartMode),
    smartPrompt: typeof base.smartPrompt === 'string' ? base.smartPrompt : ''
  }
}

export function applyLightingPreset(id: LightingPresetId): LightingSetupState {
  const preset =
    LIGHTING_PRESETS.find((p) => p.id === id) ?? LIGHTING_PRESETS[0]!
  return normalizeLightingSetup({
    presetId: preset.id,
    yaw: preset.yaw,
    pitch: preset.pitch,
    brightness: preset.brightness,
    color: preset.color,
    mainDirection: preset.mainDirection,
    rimLight: preset.rimLight,
    smartMode: true,
    smartPrompt: preset.prompt
  })
}

export function applyLightingDirection(
  state: LightingSetupState,
  direction: LightingDirection
): LightingSetupState {
  const pose = LIGHTING_DIRECTION_POSE[direction]
  return normalizeLightingSetup({
    ...state,
    presetId: 'custom',
    mainDirection: direction,
    yaw: pose.yaw,
    pitch: pose.pitch
  })
}

export function markLightingCustom(
  state: LightingSetupState
): LightingSetupState {
  return { ...state, presetId: 'custom' }
}

/** 根据 yaw/pitch 推断最接近的六向（用于拖拽后回写方向按钮） */
export function nearestLightingDirection(
  yaw: number,
  pitch: number
): LightingDirection {
  const y = clampLightingYaw(yaw)
  const p = clampLightingPitch(pitch)
  let best: LightingDirection = 'front'
  let bestScore = Infinity
  for (const dir of LIGHTING_DIRECTIONS) {
    const pose = LIGHTING_DIRECTION_POSE[dir]
    let dy = Math.abs(y - pose.yaw)
    if (dy > 180) dy = 360 - dy
    const dp = Math.abs(p - pose.pitch)
    const score = dy + dp * 1.2
    if (score < bestScore) {
      bestScore = score
      best = dir
    }
  }
  return best
}

function brightnessPromptZh(brightness: number): string {
  const b = clampLightingBrightness(brightness)
  if (b >= 80) return '高亮度'
  if (b >= 60) return '偏亮'
  if (b <= 25) return '低亮度暗调'
  if (b <= 40) return '偏暗'
  return '中等亮度'
}

function directionPromptZh(direction: LightingDirection): string {
  switch (direction) {
    case 'left':
      return '正侧主光来自左侧，左脸清晰、右脸进入阴影'
    case 'right':
      return '正侧主光来自右侧，右脸清晰、左脸进入阴影'
    case 'top':
      return '垂直顶光，眼窝处形成明显阴影'
    case 'bottom':
      return '主光来自下方，面部形成反常上投阴影'
    case 'back':
      return '主光来自后方（逆光），轮廓与发丝被勾亮'
    default:
      return '主光来自前方，面部光线均匀、五官清晰'
  }
}

function colorPromptZh(color: string): string {
  const hex = normalizeLightingColor(color)
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  if (max - min < 18 && max > 220) return '白色光'
  if (max - min < 18 && max < 80) return '冷灰光'
  if (r > g + 20 && r > b + 20 && g > b) return '暖橙色光'
  if (r > g && r > b) return '暖色光'
  if (b > r + 15 && b > g) return '冷蓝色光'
  if (g > r && g > b) return '绿色光'
  if (r > 180 && b > 150 && g < 120) return '品红霓虹光'
  return `色温约 ${hex}`
}

/**
 * 由手动参数生成打光句（不含智能模式文案）。
 */
export function buildLightingManualPrompt(state: LightingSetupState): string {
  const s = normalizeLightingSetup(state)
  const parts = [
    directionPromptZh(s.mainDirection),
    colorPromptZh(s.color),
    brightnessPromptZh(s.brightness),
    s.rimLight ? '带轮廓光勾边' : '无轮廓光'
  ]
  return parts.join('，')
}

/**
 * 最终输出：手动句；智能模式开启且有文案时再拼接。
 */
export function resolveLightingOutputPrompt(
  state: LightingSetupState,
  extraText = ''
): string {
  const s = normalizeLightingSetup(state)
  const manual = buildLightingManualPrompt(s).trim()
  const smart = s.smartPrompt.trim()
  const extra = extraText.trim()
  const chunks: string[] = []
  if (s.smartMode && smart) chunks.push(smart)
  if (manual) chunks.push(manual)
  if (extra) chunks.push(extra)
  // 去重相邻相同句
  const deduped: string[] = []
  for (const chunk of chunks) {
    if (deduped[deduped.length - 1] === chunk) continue
    deduped.push(chunk)
  }
  return deduped.join('\n')
}

export function readLightingSetupFromNode(params: {
  lightingSetup?: Partial<LightingSetupState>
}): LightingSetupState {
  return normalizeLightingSetup(params.lightingSetup)
}

export function lightingSetupToNodePatch(state: LightingSetupState): {
  lightingSetup: LightingSetupState
  lightingPrompt: string
} {
  const normalized = normalizeLightingSetup(state)
  return {
    lightingSetup: normalized,
    lightingPrompt: resolveLightingOutputPrompt(normalized)
  }
}

/** 球面坐标：yaw/pitch → 单位球上的点（Y-up，yaw 绕 Y；0° 朝 +Z） */
export function lightingSphericalPoint(
  yawDeg: number,
  pitchDeg: number,
  radius = 1
): { x: number; y: number; z: number } {
  const yaw = (clampLightingYaw(yawDeg) * Math.PI) / 180
  const pitch = (clampLightingPitch(pitchDeg) * Math.PI) / 180
  const cp = Math.cos(pitch)
  return {
    x: radius * cp * Math.sin(yaw),
    y: radius * Math.sin(pitch),
    z: radius * cp * Math.cos(yaw)
  }
}
