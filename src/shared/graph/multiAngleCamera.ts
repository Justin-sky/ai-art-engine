/**
 * 多角度编辑器：机位参数 ↔ 预设 ↔ 提示词（对齐 liblib 多角度编辑器行为）。
 */

export type MultiAnglePresetId =
  | 'custom'
  | 'fisheye'
  | 'dutch'
  | 'frontHigh'
  | 'frontLow'
  | 'panoramaHigh'
  | 'back'

/** 景别档：滑条 0=全景 … 1=特写 */
export type MultiAngleShotScaleLabel = '全景' | '中景' | '特写'

export interface MultiAngleCameraState {
  presetId: MultiAnglePresetId
  /** 水平环绕，度，[-180, 180] */
  yaw: number
  /** 垂直俯仰，度，[-60, 60]；正=俯，负=仰 */
  pitch: number
  /** 景别缩放 0..1（0 全景，0.5 中景，1 特写） */
  shotScale: number
  /** 是否把机位提示词拼接到面板提示词（关闭时仍按机位输出提示词） */
  promptEnabled: boolean
}

export interface MultiAnglePresetDef {
  id: MultiAnglePresetId
  /** i18n key suffix under graph.multiAngle.presets.* */
  titleKey: string
  yaw: number
  pitch: number
  shotScale: number
  /** 预设自带提示词；点选时写入面板并打开拼接开关 */
  prompt?: string
}

export const MULTI_ANGLE_YAW_MIN = -180
export const MULTI_ANGLE_YAW_MAX = 180
export const MULTI_ANGLE_PITCH_MIN = -60
export const MULTI_ANGLE_PITCH_MAX = 60

/** 截图对齐的预设参数表 */
export const MULTI_ANGLE_PRESETS: readonly MultiAnglePresetDef[] = [
  { id: 'custom', titleKey: 'custom', yaw: 0, pitch: 0, shotScale: 0.5 },
  {
    id: 'fisheye',
    titleKey: 'fisheye',
    yaw: 0,
    pitch: 30,
    shotScale: 1,
    prompt: '极度特写镜头，广角镜头，边缘带有鱼眼畸变效果'
  },
  {
    id: 'dutch',
    titleKey: 'dutch',
    yaw: 45,
    pitch: -30,
    shotScale: 0.5,
    prompt: '荷兰角，画面垂直线明显倾斜，主体与环境关系失衡，心理不稳定感'
  },
  {
    id: 'frontHigh',
    titleKey: 'frontHigh',
    yaw: 0,
    pitch: 60,
    shotScale: 0.5,
    prompt: '正面高机位俯拍，主体在环境中显得渺小，带压迫与无助感'
  },
  {
    id: 'frontLow',
    titleKey: 'frontLow',
    yaw: 0,
    pitch: -30,
    shotScale: 0.5,
    prompt: '正面低机位仰拍，强化主体力量、权威与英雄感'
  },
  {
    id: 'panoramaHigh',
    titleKey: 'panoramaHigh',
    yaw: 45,
    pitch: 30,
    shotScale: 0,
    prompt: '四分之三高机位全景，交代主体与环境的空间关系和叙事动线'
  },
  {
    id: 'back',
    titleKey: 'back',
    yaw: 180,
    pitch: 0,
    shotScale: 0.5,
    prompt: '背面视角，人物与观众共同面对未知空间，孤独、疏离或窥视感'
  }
] as const

export const DEFAULT_MULTI_ANGLE_CAMERA: MultiAngleCameraState = {
  presetId: 'custom',
  yaw: 0,
  pitch: 0,
  shotScale: 0.5,
  promptEnabled: false
}

export function clampMultiAngleYaw(yaw: number): number {
  if (!Number.isFinite(yaw)) return 0
  let v = yaw
  while (v > MULTI_ANGLE_YAW_MAX) v -= 360
  while (v < MULTI_ANGLE_YAW_MIN) v += 360
  return Math.round(v)
}

export function clampMultiAnglePitch(pitch: number): number {
  if (!Number.isFinite(pitch)) return 0
  return Math.max(
    MULTI_ANGLE_PITCH_MIN,
    Math.min(MULTI_ANGLE_PITCH_MAX, Math.round(pitch))
  )
}

export function clampMultiAngleShotScale(scale: number): number {
  if (!Number.isFinite(scale)) return 0.5
  return Math.max(0, Math.min(1, scale))
}

export function normalizeMultiAngleCamera(
  raw?: Partial<MultiAngleCameraState> | null
): MultiAngleCameraState {
  const base = { ...DEFAULT_MULTI_ANGLE_CAMERA, ...(raw ?? {}) }
  const presetId = MULTI_ANGLE_PRESETS.some((p) => p.id === base.presetId)
    ? base.presetId
    : 'custom'
  return {
    presetId,
    yaw: clampMultiAngleYaw(base.yaw),
    pitch: clampMultiAnglePitch(base.pitch),
    shotScale: clampMultiAngleShotScale(base.shotScale),
    promptEnabled: Boolean(base.promptEnabled)
  }
}

export function applyMultiAnglePreset(
  id: MultiAnglePresetId,
  promptEnabled?: boolean
): MultiAngleCameraState {
  const preset =
    MULTI_ANGLE_PRESETS.find((p) => p.id === id) ?? MULTI_ANGLE_PRESETS[0]!
  return normalizeMultiAngleCamera({
    presetId: preset.id,
    yaw: preset.yaw,
    pitch: preset.pitch,
    shotScale: preset.shotScale,
    promptEnabled: promptEnabled ?? false
  })
}

/** 拖动滑条后标记为自定义（保留当前数值） */
export function markMultiAngleCustom(
  state: MultiAngleCameraState
): MultiAngleCameraState {
  return { ...state, presetId: 'custom' }
}

export function shotScaleLabel(scale: number): MultiAngleShotScaleLabel {
  const t = clampMultiAngleShotScale(scale)
  if (t < 0.34) return '全景'
  if (t < 0.67) return '中景'
  return '特写'
}

function shotScalePromptZh(label: MultiAngleShotScaleLabel): string {
  if (label === '特写') return '极度特写镜头'
  if (label === '全景') return '全景镜头'
  return '中景镜头'
}

function yawPromptZh(yaw: number): string {
  const a = clampMultiAngleYaw(yaw)
  if (Math.abs(a) < 8) return '正面'
  if (Math.abs(Math.abs(a) - 180) < 8) return '背面'
  if (a > 0) return `右侧约${a}°`
  return `左侧约${Math.abs(a)}°`
}

function pitchPromptZh(pitch: number): string {
  const p = clampMultiAnglePitch(pitch)
  if (p >= 45) return '强俯拍'
  if (p >= 15) return '俯拍'
  if (p <= -45) return '强仰拍'
  if (p <= -15) return '仰拍'
  return '平视'
}

/**
 * 根据机位参数生成提示词（始终按 yaw/pitch/景别映射；与 promptEnabled 无关）。
 * 鱼眼/倾斜等风格句属于预设面板文案，不在此拼接。
 */
export function buildMultiAnglePrompt(state: MultiAngleCameraState): string {
  const s = normalizeMultiAngleCamera(state)
  const scale = shotScaleLabel(s.shotScale)
  const parts: string[] = [
    shotScalePromptZh(scale),
    yawPromptZh(s.yaw),
    pitchPromptZh(s.pitch)
  ]
  return parts.join('，')
}

/**
 * 点选预设时写入面板的提示词：仅返回预设自带文案；无则空（不自动填入、不打开开关）。
 */
export function resolveMultiAnglePresetPanelPrompt(
  id: MultiAnglePresetId
): string {
  const preset = MULTI_ANGLE_PRESETS.find((p) => p.id === id)
  return preset?.prompt?.trim() || ''
}

/**
 * 最终输出提示词：始终含机位句；promptEnabled 时再拼接面板提示词（与机位句相同时不重复）。
 */
export function resolveMultiAngleOutputPrompt(
  state: MultiAngleCameraState,
  panelPrompt = ''
): string {
  const camera = buildMultiAnglePrompt(state).trim()
  const panel = panelPrompt.trim()
  if (state.promptEnabled && panel) {
    if (!camera || panel === camera) return panel
    return `${panel}\n${camera}`
  }
  return camera
}

export function readMultiAngleCameraFromNode(params: {
  multiAngleCamera?: Partial<MultiAngleCameraState>
}): MultiAngleCameraState {
  return normalizeMultiAngleCamera(params.multiAngleCamera)
}

export function multiAngleCameraToNodePatch(
  state: MultiAngleCameraState,
  panelPrompt = ''
): {
  multiAngleCamera: MultiAngleCameraState
  multiAnglePrompt: string
} {
  const normalized = normalizeMultiAngleCamera(state)
  return {
    multiAngleCamera: normalized,
    multiAnglePrompt: resolveMultiAngleOutputPrompt(normalized, panelPrompt)
  }
}

/** 球面坐标：yaw/pitch → 单位球上的点（Y-up，yaw 绕 Y） */
export function multiAngleSphericalPoint(
  yawDeg: number,
  pitchDeg: number,
  radius = 1
): { x: number; y: number; z: number } {
  const yaw = (clampMultiAngleYaw(yawDeg) * Math.PI) / 180
  const pitch = (clampMultiAnglePitch(pitchDeg) * Math.PI) / 180
  const cp = Math.cos(pitch)
  return {
    x: radius * cp * Math.sin(yaw),
    y: radius * Math.sin(pitch),
    z: radius * cp * Math.cos(yaw)
  }
}
