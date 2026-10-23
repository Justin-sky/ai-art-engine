/**
 * 3D 导演台专业摄影光学、布光预设、多通道控制（AOV）、关键帧缓动与运镜提示词合成。
 * 纯函数模块，零 Three.js / DOM 依赖，可在 shared / main / renderer 通用。
 */

import {
  DEFAULT_DIRECTOR_CAMERA_FOV,
  directorViewerForwardFromRotation,
  directorViewerRotationFromLook,
  type DirectorStageState,
  type DirectorViewerState,
  type StageLightParams,
  type StageMannequinPreset,
  type StageObjectState,
  type StageVec3
} from './domain'

/** 全画幅 35mm 传感器高度（36×24mm 标准全画幅，Three.js PerspectiveCamera.fov 为垂直视场角） */
export const FULL_FRAME_SENSOR_HEIGHT_MM = 24

/** 经典电影定焦镜头焦段（mm） */
export const DIRECTOR_PRIME_LENSES_MM = [16, 24, 35, 50, 85, 135] as const
export const DIRECTOR_FOCAL_LENGTH_PRESETS_MM = DIRECTOR_PRIME_LENSES_MM
export type DirectorPrimeLensMm = (typeof DIRECTOR_PRIME_LENSES_MM)[number]

/** 取景器构图辅助线模式 */
export const DIRECTOR_COMPOSITION_GUIDES = [
  'none',
  'thirds',
  'golden',
  'crosshair',
  'safeArea',
  'diagonal'
] as const
export type DirectorCompositionGuide = (typeof DIRECTOR_COMPOSITION_GUIDES)[number]

export function normalizeDirectorCompositionGuide(raw: unknown): DirectorCompositionGuide {
  return DIRECTOR_COMPOSITION_GUIDES.includes(raw as DirectorCompositionGuide)
    ? (raw as DirectorCompositionGuide)
    : 'none'
}

/** 截屏 / 导出渲染通道（AOV 控制图） */
export const DIRECTOR_CAPTURE_PASSES = ['rgb', 'depth', 'normal', 'pose', 'canny'] as const
export type DirectorCapturePass = (typeof DIRECTOR_CAPTURE_PASSES)[number]

export function normalizeDirectorCapturePass(raw: unknown): DirectorCapturePass {
  return DIRECTOR_CAPTURE_PASSES.includes(raw as DirectorCapturePass)
    ? (raw as DirectorCapturePass)
    : 'rgb'
}

/** 关键帧插值缓动曲线类型 */
export const DIRECTOR_KEYFRAME_EASINGS = ['linear', 'easeIn', 'easeOut', 'easeInOut'] as const
export type DirectorKeyframeEasing = (typeof DIRECTOR_KEYFRAME_EASINGS)[number]

export function normalizeDirectorKeyframeEasing(raw: unknown): DirectorKeyframeEasing {
  return DIRECTOR_KEYFRAME_EASINGS.includes(raw as DirectorKeyframeEasing)
    ? (raw as DirectorKeyframeEasing)
    : 'linear'
}

/** 计算关键帧区间归一化进度 u ∈ [0,1] 经缓动曲线映射后的插值权重 */
export function evaluateKeyframeEasing(
  u: number,
  easing: DirectorKeyframeEasing = 'linear'
): number {
  const t = Math.min(1, Math.max(0, Number.isFinite(u) ? u : 0))
  switch (easing) {
    case 'easeIn':
      return t * t
    case 'easeOut':
      return 1 - (1 - t) * (1 - t)
    case 'easeInOut':
      return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
    case 'linear':
    default:
      return t
  }
}

/**
 * 全画幅等效焦距（mm）转垂直视场角 FOV（度）。
 * 公式：FOV = 2 * atan(sensorHeight / (2 * focalLength)) * (180 / π)
 */
export function focalLengthMmToFovDeg(focalMm: number): number {
  const clamped = Math.min(300, Math.max(8, Number.isFinite(focalMm) ? focalMm : 50))
  const rad = 2 * Math.atan(FULL_FRAME_SENSOR_HEIGHT_MM / (2 * clamped))
  return Math.min(120, Math.max(5, Number(((rad * 180) / Math.PI).toFixed(2))))
}

/**
 * 垂直视场角 FOV（度）转全画幅等效焦距（mm）。
 * 公式：f = sensorHeight / (2 * tan(FOV_rad / 2))
 */
export function fovDegToFocalLengthMm(fovDeg: number): number {
  const clamped = Math.min(
    140,
    Math.max(5, Number.isFinite(fovDeg) ? fovDeg : DEFAULT_DIRECTOR_CAMERA_FOV)
  )
  const halfRad = (clamped * Math.PI) / 360
  const tanVal = Math.tan(halfRad)
  if (tanVal <= 1e-6) return 200
  return Math.round(FULL_FRAME_SENSOR_HEIGHT_MM / (2 * tanVal))
}

export const focalLengthMmToFov = focalLengthMmToFovDeg
export const fovToFocalLengthMm = fovDegToFocalLengthMm
export const focalLengthToVerticalFov = focalLengthMmToFovDeg
export const verticalFovToFocalLength = fovDegToFocalLengthMm
export const verticalFovToFocalLengthMm = fovDegToFocalLengthMm

/**
 * 希区柯克变焦（Dolly Zoom / Vertigo Effect）求解器：
 * 改变相机 FOV（或焦段）时，保持 `viewer.target` 处的取景画面宽度恒定（主体在画面中大小不变），
 * 自动沿视线反向推拉相机距离，产生透视背景剧烈压缩/拉伸效果。
 */
export function solveDollyZoomViewer(
  viewer: DirectorViewerState,
  nextFovDeg: number
): DirectorViewerState {
  const prevFov = Math.min(
    140,
    Math.max(5, Number.isFinite(viewer.fov) ? (viewer.fov as number) : DEFAULT_DIRECTOR_CAMERA_FOV)
  )
  const targetFov = Math.min(140, Math.max(5, Number.isFinite(nextFovDeg) ? nextFovDeg : prevFov))
  const dx = viewer.position.x - viewer.target.x
  const dy = viewer.position.y - viewer.target.y
  const dz = viewer.position.z - viewer.target.z
  const prevDist = Math.hypot(dx, dy, dz)
  if (prevDist < 1e-4) {
    return { ...viewer, fov: targetFov }
  }
  const prevTan = Math.tan((prevFov * Math.PI) / 360)
  const nextTan = Math.tan((targetFov * Math.PI) / 360)
  if (nextTan <= 1e-6) {
    return { ...viewer, fov: targetFov }
  }
  const nextDist = Math.min(500, Math.max(0.2, prevDist * (prevTan / nextTan)))
  const scale = nextDist / prevDist
  const nextPos: StageVec3 = {
    x: Number((viewer.target.x + dx * scale).toFixed(4)),
    y: Number((viewer.target.y + dy * scale).toFixed(4)),
    z: Number((viewer.target.z + dz * scale).toFixed(4))
  }
  return {
    ...viewer,
    position: nextPos,
    fov: targetFov
  }
}

export function solveDollyZoomPosition(
  currentPos: StageVec3,
  target: StageVec3,
  prevFovDeg: number,
  nextFovDeg: number
): StageVec3 {
  return solveDollyZoomViewer({ position: currentPos, target, fov: prevFovDeg }, nextFovDeg)
    .position
}

/** 手持呼吸感微抖动参数 */
export interface DirectorHandheldShake {
  enabled?: boolean
  /** 抖动强度 0 ~ 1，默认 0.35 */
  intensity?: number
  /** 抖动频率（Hz 缩放），默认 1.0 */
  frequency?: number
}

export function normalizeDirectorHandheldShake(raw: unknown): DirectorHandheldShake | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const o = raw as Record<string, unknown>
  const enabled = o.enabled === true
  const intensity =
    typeof o.intensity === 'number' && Number.isFinite(o.intensity)
      ? Math.min(2, Math.max(0, o.intensity))
      : 0.35
  const frequency =
    typeof o.frequency === 'number' && Number.isFinite(o.frequency)
      ? Math.min(5, Math.max(0.1, o.frequency))
      : 1
  if (!enabled && intensity === 0.35 && frequency === 1) return undefined
  return { enabled, intensity, frequency }
}

/**
 * 计算指定时刻 t（秒）的程序化手持呼吸感微抖动偏移（位置米 + 欧拉弧度）。
 * 使用多倍频无理数正弦叠加（近似 1D Perlin 噪声），兼具低频呼吸起伏与高频手持微颤。
 */
export function evaluateHandheldCameraShake(
  timeSec: number,
  shake?: DirectorHandheldShake
): { posOffset: StageVec3; rotOffset: StageVec3 } {
  if (!shake?.enabled || (shake.intensity ?? 0) <= 0) {
    return {
      posOffset: { x: 0, y: 0, z: 0 },
      rotOffset: { x: 0, y: 0, z: 0 }
    }
  }
  const amp = Math.min(2, Math.max(0, shake.intensity ?? 0.35))
  const freq = Math.min(5, Math.max(0.1, shake.frequency ?? 1))
  const t = timeSec * freq

  // 无理数角频率组合，避免周期性机械重复感
  const nx =
    Math.sin(t * 1.73) * 0.55 + Math.sin(t * 3.91 + 1.2) * 0.3 + Math.sin(t * 7.43 + 2.7) * 0.15
  const ny =
    Math.sin(t * 1.37 + 0.6) * 0.6 +
    Math.sin(t * 3.17 + 2.1) * 0.25 +
    Math.sin(t * 6.89 + 4.0) * 0.15
  const nz = Math.sin(t * 1.13 + 1.9) * 0.65 + Math.sin(t * 2.83 + 0.4) * 0.35

  const posScale = 0.045 * amp
  const rotScale = 0.018 * amp // ~1 deg at amp=1

  return {
    posOffset: {
      x: nx * posScale,
      y: ny * posScale * 1.15,
      z: nz * posScale * 0.5
    },
    rotOffset: {
      x: ny * rotScale * 0.9,
      y: nx * rotScale * 0.8,
      z: nz * rotScale * 0.65
    }
  }
}

/** 内置三点人物布光预设 ID */
export const DIRECTOR_LIGHTING_PRESET_IDS = [
  'studio',
  'rembrandt',
  'butterfly',
  'silhouette',
  'cyberpunk',
  'goldenHour'
] as const
export type DirectorLightingPresetId = (typeof DIRECTOR_LIGHTING_PRESET_IDS)[number]

export interface DirectorLightingPresetLightSpec {
  role: 'key' | 'fill' | 'rim'
  name: string
  nameZh: string
  color: string
  /** 相对于主体锚点的偏移（单位：主体高度倍数） */
  offsetFactor: StageVec3
  /** 照射目标高度偏移比例（0=脚底，0.5=中心，0.8=头部） */
  aimHeightBias: number
  light: StageLightParams
}

export interface DirectorLightingPresetDef {
  id: DirectorLightingPresetId
  labelKey: string
  promptMoodEn: string
  promptMoodZh: string
  skyColor?: string
  fogEnabled?: boolean
  fogDensity?: number
  fogColor?: string
  lights: DirectorLightingPresetLightSpec[]
}

export const DIRECTOR_LIGHTING_PRESETS: readonly DirectorLightingPresetDef[] = [
  {
    id: 'studio',
    labelKey: 'director.stage.lightingPreset.studio',
    promptMoodEn:
      'professional three-point studio lighting, balanced key and fill light, crisp rim backlight',
    promptMoodZh: '专业标准三点布光，主辅光比均衡，边缘轮廓光清晰',
    lights: [
      {
        role: 'key',
        name: 'Key Light (Studio)',
        nameZh: '主光（标准棚拍）',
        color: '#fff6ec',
        offsetFactor: { x: 1.4, y: 1.1, z: 1.5 },
        aimHeightBias: 0.72,
        light: {
          type: 'spot',
          intensity: 2.2,
          distance: 18,
          decay: 1.5,
          angle: Math.PI / 4,
          penumbra: 0.45
        }
      },
      {
        role: 'fill',
        name: 'Fill Light (Studio)',
        nameZh: '辅光（标准棚拍）',
        color: '#dce9ff',
        offsetFactor: { x: -1.5, y: 0.6, z: 1.4 },
        aimHeightBias: 0.6,
        light: {
          type: 'spot',
          intensity: 0.95,
          distance: 18,
          decay: 1.5,
          angle: Math.PI / 3,
          penumbra: 0.7
        }
      },
      {
        role: 'rim',
        name: 'Rim Light (Studio)',
        nameZh: '轮廓光（标准棚拍）',
        color: '#ffffff',
        offsetFactor: { x: -0.7, y: 1.3, z: -1.6 },
        aimHeightBias: 0.78,
        light: {
          type: 'spot',
          intensity: 1.8,
          distance: 16,
          decay: 1.5,
          angle: Math.PI / 5,
          penumbra: 0.35
        }
      }
    ]
  },
  {
    id: 'rembrandt',
    labelKey: 'director.stage.lightingPreset.rembrandt',
    promptMoodEn:
      'dramatic Rembrandt chiaroscuro lighting, 45-degree warm key light, deep moody shadows',
    promptMoodZh: '戏剧性伦勃朗明暗对照布光，45度暖调主光，深邃立体阴影',
    lights: [
      {
        role: 'key',
        name: 'Key Light (Rembrandt)',
        nameZh: '主光（伦勃朗）',
        color: '#ffdcb4',
        offsetFactor: { x: 1.35, y: 1.25, z: 1.25 },
        aimHeightBias: 0.76,
        light: {
          type: 'spot',
          intensity: 2.8,
          distance: 16,
          decay: 1.6,
          angle: Math.PI / 5,
          penumbra: 0.35
        }
      },
      {
        role: 'fill',
        name: 'Fill Light (Rembrandt)',
        nameZh: '辅光（伦勃朗）',
        color: '#52688f',
        offsetFactor: { x: -1.4, y: 0.4, z: 1.1 },
        aimHeightBias: 0.55,
        light: { type: 'point', intensity: 0.38, distance: 14, decay: 2 }
      },
      {
        role: 'rim',
        name: 'Rim Light (Rembrandt)',
        nameZh: '轮廓光（伦勃朗）',
        color: '#ffe8c8',
        offsetFactor: { x: -0.9, y: 1.2, z: -1.4 },
        aimHeightBias: 0.8,
        light: {
          type: 'spot',
          intensity: 1.25,
          distance: 15,
          decay: 1.6,
          angle: Math.PI / 6,
          penumbra: 0.4
        }
      }
    ]
  },
  {
    id: 'butterfly',
    labelKey: 'director.stage.lightingPreset.butterfly',
    promptMoodEn:
      'Paramount butterfly beauty lighting, high frontal key light, soft under-chin bounce fill, glamour halo rim',
    promptMoodZh: '派拉蒙蝴蝶光美颜布光，正高机位主光，柔和底辅光与发丝轮廓光',
    lights: [
      {
        role: 'key',
        name: 'Key Light (Butterfly)',
        nameZh: '主光（蝴蝶美人光）',
        color: '#fff8f2',
        offsetFactor: { x: 0.0, y: 1.55, z: 1.45 },
        aimHeightBias: 0.78,
        light: {
          type: 'spot',
          intensity: 2.4,
          distance: 16,
          decay: 1.5,
          angle: Math.PI / 4,
          penumbra: 0.55
        }
      },
      {
        role: 'fill',
        name: 'Bounce Fill (Butterfly)',
        nameZh: '底反射辅光（蝴蝶美人光）',
        color: '#f0f4ff',
        offsetFactor: { x: 0.0, y: -0.1, z: 1.2 },
        aimHeightBias: 0.65,
        light: { type: 'point', intensity: 0.75, distance: 10, decay: 1.8 }
      },
      {
        role: 'rim',
        name: 'Hair Rim (Butterfly)',
        nameZh: '发丝轮廓光（蝴蝶美人光）',
        color: '#fff0dc',
        offsetFactor: { x: 0.0, y: 1.5, z: -1.4 },
        aimHeightBias: 0.85,
        light: {
          type: 'spot',
          intensity: 1.9,
          distance: 15,
          decay: 1.5,
          angle: Math.PI / 5,
          penumbra: 0.4
        }
      }
    ]
  },
  {
    id: 'silhouette',
    labelKey: 'director.stage.lightingPreset.silhouette',
    promptMoodEn:
      'cinematic backlit rim silhouette, volumetric atmospheric haze, strong glowing edge light, dark foreground',
    promptMoodZh: '电影感逆光剪影，体积雾气氛围，强烈边缘轮廓光，暗部前景',
    fogEnabled: true,
    fogDensity: 0.035,
    fogColor: '#1a2232',
    lights: [
      {
        role: 'rim',
        name: 'Back Rim Light (Silhouette)',
        nameZh: '背向逆光（逆光剪影）',
        color: '#ff9e5e',
        offsetFactor: { x: 0.15, y: 0.9, z: -1.8 },
        aimHeightBias: 0.65,
        light: {
          type: 'spot',
          intensity: 3.8,
          distance: 22,
          decay: 1.3,
          angle: Math.PI / 3.5,
          penumbra: 0.3
        }
      },
      {
        role: 'key',
        name: 'Side Edge Light (Silhouette)',
        nameZh: '侧边缘光（逆光剪影）',
        color: '#7cc4ff',
        offsetFactor: { x: -1.5, y: 0.95, z: -1.1 },
        aimHeightBias: 0.7,
        light: {
          type: 'spot',
          intensity: 2.1,
          distance: 18,
          decay: 1.5,
          angle: Math.PI / 4,
          penumbra: 0.4
        }
      },
      {
        role: 'fill',
        name: 'Subtle Front Fill (Silhouette)',
        nameZh: '正面微弱补光（逆光剪影）',
        color: '#2c3a52',
        offsetFactor: { x: 0.6, y: 0.4, z: 1.6 },
        aimHeightBias: 0.55,
        light: { type: 'point', intensity: 0.25, distance: 12, decay: 2 }
      }
    ]
  },
  {
    id: 'cyberpunk',
    labelKey: 'director.stage.lightingPreset.cyberpunk',
    promptMoodEn:
      'cyberpunk neon dual-tone lighting, vibrant magenta key light and electric cyan rim light, atmospheric night fog',
    promptMoodZh: '赛博朋克冷暖双色霓虹布光，品红主光配电光青轮廓光，都市夜雾氛围',
    fogEnabled: true,
    fogDensity: 0.025,
    fogColor: '#120c24',
    lights: [
      {
        role: 'key',
        name: 'Neon Magenta Key',
        nameZh: '霓虹品红主光',
        color: '#ff2e93',
        offsetFactor: { x: 1.35, y: 0.85, z: 1.1 },
        aimHeightBias: 0.68,
        light: {
          type: 'spot',
          intensity: 3.1,
          distance: 18,
          decay: 1.4,
          angle: Math.PI / 3.8,
          penumbra: 0.4
        }
      },
      {
        role: 'rim',
        name: 'Neon Cyan Rim',
        nameZh: '电光青轮廓光',
        color: '#00f0ff',
        offsetFactor: { x: -1.4, y: 1.0, z: -0.9 },
        aimHeightBias: 0.72,
        light: {
          type: 'spot',
          intensity: 3.2,
          distance: 18,
          decay: 1.4,
          angle: Math.PI / 3.8,
          penumbra: 0.4
        }
      },
      {
        role: 'fill',
        name: 'Violet Top Fill',
        nameZh: '紫罗兰顶辅光',
        color: '#7b2cbf',
        offsetFactor: { x: 0.0, y: 1.8, z: 0.3 },
        aimHeightBias: 0.5,
        light: { type: 'point', intensity: 1.1, distance: 14, decay: 1.8 }
      }
    ]
  },
  {
    id: 'goldenHour',
    labelKey: 'director.stage.lightingPreset.goldenHour',
    promptMoodEn:
      'golden hour sunset lighting, warm low-angle directional sunlight, soft sky-blue ambient shadow fill',
    promptMoodZh: '黄金时刻落日逆侧光，低角度温暖夕阳主光，柔和天蓝暗部补光',
    fogEnabled: true,
    fogDensity: 0.015,
    fogColor: '#2d211b',
    lights: [
      {
        role: 'key',
        name: 'Golden Sun Key',
        nameZh: '落日暖阳主光',
        color: '#ff9248',
        offsetFactor: { x: 1.8, y: 0.45, z: -0.6 },
        aimHeightBias: 0.62,
        light: { type: 'directional', intensity: 2.6 }
      },
      {
        role: 'fill',
        name: 'Sky Blue Fill',
        nameZh: '天蓝环境补光',
        color: '#7eb2dd',
        offsetFactor: { x: -1.4, y: 1.1, z: 1.3 },
        aimHeightBias: 0.6,
        light: { type: 'directional', intensity: 0.85 }
      },
      {
        role: 'rim',
        name: 'Warm Rim Glow',
        nameZh: '夕阳金色轮廓光',
        color: '#ffd08a',
        offsetFactor: { x: 1.1, y: 0.8, z: -1.4 },
        aimHeightBias: 0.75,
        light: {
          type: 'spot',
          intensity: 2.0,
          distance: 20,
          decay: 1.4,
          angle: Math.PI / 4,
          penumbra: 0.5
        }
      }
    ]
  }
] as const

export function findDirectorLightingPreset(
  presetId: string
): DirectorLightingPresetDef | undefined {
  return DIRECTOR_LIGHTING_PRESETS.find((item) => item.id === presetId)
}

/**
 * 根据布光预设与主体锚点（中心坐标与高度）生成三点灯光 StageObjectState 列表。
 */
export function buildLightingPresetObjects(
  presetId: DirectorLightingPresetId,
  anchorCenter: StageVec3 = { x: 0, y: 0.9, z: 0 },
  subjectHeight = 1.8,
  parentId: string | null = null,
  locale?: string
): {
  lights: StageObjectState[]
  fogPatch?: { fogEnabled: boolean; fogDensity: number; fogColor: string }
} {
  const preset = findDirectorLightingPreset(presetId) ?? DIRECTOR_LIGHTING_PRESETS[0]!
  const h = Math.max(0.5, Number.isFinite(subjectHeight) ? subjectHeight : 1.8)
  const footY = anchorCenter.y - h * 0.5
  const isZh = typeof locale === 'string' && locale.toLowerCase().startsWith('zh')
  const lights: StageObjectState[] = preset.lights.map((spec, idx) => {
    const aimY = footY + h * spec.aimHeightBias
    const target: StageVec3 = { x: anchorCenter.x, y: aimY, z: anchorCenter.z }
    const position: StageVec3 = {
      x: Number((anchorCenter.x + spec.offsetFactor.x * h).toFixed(3)),
      y: Number((aimY + spec.offsetFactor.y * h).toFixed(3)),
      z: Number((anchorCenter.z + spec.offsetFactor.z * h).toFixed(3))
    }
    const rotation = directorViewerRotationFromLook(position, target)
    return {
      id: `light:preset:${preset.id}:${spec.role}:${idx}`,
      name: isZh ? spec.nameZh : spec.name,
      kind: 'light',
      color: spec.color,
      light: { ...spec.light },
      parentId,
      visible: true,
      locked: false,
      nameVisible: false,
      position,
      rotation,
      scale: { x: 1, y: 1, z: 1 }
    }
  })

  const fogPatch =
    preset.fogEnabled !== undefined
      ? {
          fogEnabled: preset.fogEnabled,
          fogDensity: preset.fogDensity ?? 0.02,
          fogColor: preset.fogColor ?? '#1a2232'
        }
      : undefined

  return { lights, ...(fogPatch ? { fogPatch } : {}) }
}

/** 全身日常动作 / 手势细节 / 头部视线与情绪体态快速预设（body 为全身替换，hand/gaze 为局部叠加） */
export interface DirectorExpressivePosePreset {
  id: string
  category: 'body' | 'hand' | 'gaze'
  labelKey: string
  clipName?: string
  bones: Record<string, StageVec3>
}

const DEG = Math.PI / 180

export const DIRECTOR_EXPRESSIVE_POSE_PRESETS: readonly DirectorExpressivePosePreset[] = [
  // ==================== 全身日常与戏剧动作预设 (category: 'body') ====================
  {
    id: 'body.idle',
    category: 'body',
    labelKey: 'director.stage.expressivePose.bodyIdle',
    clipName: 'Idle',
    bones: {
      Spine: { x: 2 * DEG, y: 0, z: 0 },
      Chest: { x: 1 * DEG, y: -2 * DEG, z: 0 },
      Head: { x: -2 * DEG, y: 3 * DEG, z: 0 },
      LeftUpperArm: { x: 3 * DEG, y: 0, z: -8 * DEG },
      RightUpperArm: { x: 3 * DEG, y: 0, z: 8 * DEG },
      LeftForeArm: { x: -10 * DEG, y: 0, z: 0 },
      RightForeArm: { x: -10 * DEG, y: 0, z: 0 },
      LeftUpLeg: { x: -2 * DEG, y: 0, z: -2 * DEG },
      RightUpLeg: { x: 2 * DEG, y: 0, z: 2 * DEG },
      LeftLeg: { x: 4 * DEG, y: 0, z: 0 },
      RightLeg: { x: 4 * DEG, y: 0, z: 0 }
    }
  },
  {
    id: 'body.walk',
    category: 'body',
    labelKey: 'director.stage.expressivePose.bodyWalk',
    clipName: 'Walk',
    bones: {
      Spine: { x: 4 * DEG, y: -5 * DEG, z: 0 },
      Chest: { x: 2 * DEG, y: -4 * DEG, z: 0 },
      Head: { x: -3 * DEG, y: 6 * DEG, z: 0 },
      LeftUpperArm: { x: 22 * DEG, y: 0, z: -9 * DEG },
      RightUpperArm: { x: -24 * DEG, y: 0, z: 9 * DEG },
      LeftForeArm: { x: -20 * DEG, y: 0, z: 0 },
      RightForeArm: { x: -28 * DEG, y: 0, z: 0 },
      LeftUpLeg: { x: -26 * DEG, y: 0, z: 0 },
      LeftLeg: { x: 12 * DEG, y: 0, z: 0 },
      RightUpLeg: { x: 22 * DEG, y: 0, z: 0 },
      RightLeg: { x: 24 * DEG, y: 0, z: 0 }
    }
  },
  {
    id: 'body.run',
    category: 'body',
    labelKey: 'director.stage.expressivePose.bodyRun',
    clipName: 'Run',
    bones: {
      'Hips.position': { x: 0, y: -0.04, z: 0 },
      Spine: { x: 14 * DEG, y: -8 * DEG, z: 0 },
      Chest: { x: 8 * DEG, y: -6 * DEG, z: 0 },
      Head: { x: -14 * DEG, y: 10 * DEG, z: 0 },
      LeftUpperArm: { x: 38 * DEG, y: 0, z: -12 * DEG },
      RightUpperArm: { x: -42 * DEG, y: 0, z: 12 * DEG },
      LeftForeArm: { x: -55 * DEG, y: 0, z: 0 },
      RightForeArm: { x: -65 * DEG, y: 0, z: 0 },
      LeftUpLeg: { x: -48 * DEG, y: 0, z: 0 },
      LeftLeg: { x: 22 * DEG, y: 0, z: 0 },
      RightUpLeg: { x: 38 * DEG, y: 0, z: 0 },
      RightLeg: { x: 58 * DEG, y: 0, z: 0 }
    }
  },
  {
    id: 'body.sprint',
    category: 'body',
    labelKey: 'director.stage.expressivePose.bodySprint',
    clipName: 'Sprint',
    bones: {
      'Hips.position': { x: 0, y: -0.07, z: 0 },
      Spine: { x: 22 * DEG, y: -10 * DEG, z: 0 },
      Chest: { x: 12 * DEG, y: -8 * DEG, z: 0 },
      Head: { x: -22 * DEG, y: 12 * DEG, z: 0 },
      LeftUpperArm: { x: 50 * DEG, y: 0, z: -14 * DEG },
      RightUpperArm: { x: -54 * DEG, y: 0, z: 14 * DEG },
      LeftForeArm: { x: -68 * DEG, y: 0, z: 0 },
      RightForeArm: { x: -76 * DEG, y: 0, z: 0 },
      LeftUpLeg: { x: -62 * DEG, y: 0, z: 0 },
      LeftLeg: { x: 28 * DEG, y: 0, z: 0 },
      RightUpLeg: { x: 48 * DEG, y: 0, z: 0 },
      RightLeg: { x: 75 * DEG, y: 0, z: 0 }
    }
  },
  {
    id: 'body.jump',
    category: 'body',
    labelKey: 'director.stage.expressivePose.bodyJump',
    clipName: 'Jump',
    bones: {
      'Hips.position': { x: 0, y: 0.44, z: 0 },
      Spine: { x: -8 * DEG, y: 0, z: 0 },
      Chest: { x: -6 * DEG, y: 0, z: 0 },
      Head: { x: -12 * DEG, y: 0, z: 0 },
      LeftUpperArm: { x: -45 * DEG, y: 0, z: -78 * DEG },
      RightUpperArm: { x: -45 * DEG, y: 0, z: 78 * DEG },
      LeftForeArm: { x: -24 * DEG, y: 0, z: 0 },
      RightForeArm: { x: -24 * DEG, y: 0, z: 0 },
      LeftUpLeg: { x: -42 * DEG, y: 0, z: -6 * DEG },
      RightUpLeg: { x: -22 * DEG, y: 0, z: 6 * DEG },
      LeftLeg: { x: 58 * DEG, y: 0, z: 0 },
      RightLeg: { x: 42 * DEG, y: 0, z: 0 }
    }
  },
  {
    id: 'body.sit',
    category: 'body',
    labelKey: 'director.stage.expressivePose.bodySit',
    clipName: 'Sit',
    bones: {
      'Hips.position': { x: 0, y: -0.42, z: -0.08 },
      Spine: { x: 3 * DEG, y: 0, z: 0 },
      Chest: { x: 2 * DEG, y: 0, z: 0 },
      Head: { x: 0, y: 0, z: 0 },
      LeftUpperArm: { x: -14 * DEG, y: 0, z: -10 * DEG },
      RightUpperArm: { x: -14 * DEG, y: 0, z: 10 * DEG },
      LeftForeArm: { x: -42 * DEG, y: 0, z: 0 },
      RightForeArm: { x: -42 * DEG, y: 0, z: 0 },
      LeftUpLeg: { x: -85 * DEG, y: 4 * DEG, z: -4 * DEG },
      RightUpLeg: { x: -85 * DEG, y: -4 * DEG, z: 4 * DEG },
      LeftLeg: { x: 85 * DEG, y: 0, z: 0 },
      RightLeg: { x: 85 * DEG, y: 0, z: 0 }
    }
  },
  {
    id: 'body.sitFloor',
    category: 'body',
    labelKey: 'director.stage.expressivePose.bodySitFloor',
    clipName: 'SitFloor',
    bones: {
      'Hips.position': { x: 0, y: -0.75, z: 0 },
      Spine: { x: 4 * DEG, y: 0, z: 0 },
      Chest: { x: 2 * DEG, y: 0, z: 0 },
      Head: { x: 3 * DEG, y: 0, z: 0 },
      LeftUpperArm: { x: -12 * DEG, y: 0, z: -14 * DEG },
      RightUpperArm: { x: -12 * DEG, y: 0, z: 14 * DEG },
      LeftForeArm: { x: -34 * DEG, y: 0, z: 0 },
      RightForeArm: { x: -34 * DEG, y: 0, z: 0 },
      LeftUpLeg: { x: -78 * DEG, y: -32 * DEG, z: -38 * DEG },
      RightUpLeg: { x: -78 * DEG, y: 32 * DEG, z: 38 * DEG },
      LeftLeg: { x: 102 * DEG, y: 0, z: 0 },
      RightLeg: { x: 102 * DEG, y: 0, z: 0 }
    }
  },
  {
    id: 'body.crouch',
    category: 'body',
    labelKey: 'director.stage.expressivePose.bodyCrouch',
    clipName: 'Crouch',
    bones: {
      'Hips.position': { x: 0, y: -0.46, z: 0 },
      Spine: { x: 22 * DEG, y: 0, z: 0 },
      Chest: { x: 10 * DEG, y: 0, z: 0 },
      Head: { x: -22 * DEG, y: 0, z: 0 },
      LeftUpperArm: { x: -28 * DEG, y: 0, z: -14 * DEG },
      RightUpperArm: { x: -28 * DEG, y: 0, z: 14 * DEG },
      LeftForeArm: { x: -42 * DEG, y: 0, z: 0 },
      RightForeArm: { x: -42 * DEG, y: 0, z: 0 },
      LeftUpLeg: { x: -78 * DEG, y: 0, z: -8 * DEG },
      RightUpLeg: { x: -78 * DEG, y: 0, z: 8 * DEG },
      LeftLeg: { x: 106 * DEG, y: 0, z: 0 },
      RightLeg: { x: 106 * DEG, y: 0, z: 0 }
    }
  },
  {
    id: 'body.kneel',
    category: 'body',
    labelKey: 'director.stage.expressivePose.bodyKneel',
    clipName: 'Kneel',
    bones: {
      'Hips.position': { x: 0, y: -0.4, z: 0 },
      Spine: { x: 8 * DEG, y: 0, z: 0 },
      Chest: { x: 4 * DEG, y: 0, z: 0 },
      Head: { x: 6 * DEG, y: 0, z: 0 },
      LeftUpperArm: { x: -26 * DEG, y: 0, z: -12 * DEG },
      RightUpperArm: { x: 10 * DEG, y: 0, z: 12 * DEG },
      LeftForeArm: { x: -38 * DEG, y: 0, z: 0 },
      RightForeArm: { x: -22 * DEG, y: 0, z: 0 },
      LeftUpLeg: { x: -82 * DEG, y: 0, z: -4 * DEG },
      LeftLeg: { x: 84 * DEG, y: 0, z: 0 },
      RightUpLeg: { x: 10 * DEG, y: 0, z: 3 * DEG },
      RightLeg: { x: 94 * DEG, y: 0, z: 0 }
    }
  },
  {
    id: 'body.lieDown',
    category: 'body',
    labelKey: 'director.stage.expressivePose.bodyLieDown',
    clipName: 'LieDown',
    bones: {
      'Hips.position': { x: 0, y: -0.8, z: 0 },
      Hips: { x: -87 * DEG, y: 0, z: 0 },
      Spine: { x: 3 * DEG, y: 0, z: 0 },
      Head: { x: 8 * DEG, y: 4 * DEG, z: 0 },
      LeftUpperArm: { x: 4 * DEG, y: 0, z: -15 * DEG },
      RightUpperArm: { x: 4 * DEG, y: 0, z: 15 * DEG },
      LeftForeArm: { x: -12 * DEG, y: 0, z: 0 },
      RightForeArm: { x: -12 * DEG, y: 0, z: 0 },
      LeftUpLeg: { x: 2 * DEG, y: 0, z: -5 * DEG },
      RightUpLeg: { x: 2 * DEG, y: 0, z: 5 * DEG }
    }
  },
  {
    id: 'body.lean',
    category: 'body',
    labelKey: 'director.stage.expressivePose.bodyLean',
    clipName: 'Idle',
    bones: {
      'Hips.position': { x: 0.04, y: -0.03, z: -0.06 },
      Hips: { x: -8 * DEG, y: 0, z: -4 * DEG },
      Spine: { x: 4 * DEG, y: 0, z: 6 * DEG },
      Head: { x: 4 * DEG, y: -8 * DEG, z: 0 },
      LeftUpperArm: { x: 8 * DEG, y: 0, z: -14 * DEG },
      RightUpperArm: { x: -18 * DEG, y: 0, z: 14 * DEG },
      LeftForeArm: { x: -24 * DEG, y: 0, z: 0 },
      RightForeArm: { x: -45 * DEG, y: 0, z: 0 },
      LeftUpLeg: { x: 8 * DEG, y: 0, z: -2 * DEG },
      LeftLeg: { x: 4 * DEG, y: 0, z: 0 },
      RightUpLeg: { x: -18 * DEG, y: 0, z: 6 * DEG },
      RightLeg: { x: 36 * DEG, y: 0, z: 0 }
    }
  },
  {
    id: 'body.bow',
    category: 'body',
    labelKey: 'director.stage.expressivePose.bodyBow',
    clipName: 'Bow',
    bones: {
      Spine: { x: 32 * DEG, y: 0, z: 0 },
      Chest: { x: 16 * DEG, y: 0, z: 0 },
      Head: { x: 12 * DEG, y: 0, z: 0 },
      LeftUpperArm: { x: -10 * DEG, y: 0, z: -10 * DEG },
      RightUpperArm: { x: -10 * DEG, y: 0, z: 10 * DEG },
      LeftForeArm: { x: -18 * DEG, y: 0, z: 0 },
      RightForeArm: { x: -18 * DEG, y: 0, z: 0 }
    }
  },
  {
    id: 'body.wave',
    category: 'body',
    labelKey: 'director.stage.expressivePose.bodyWave',
    clipName: 'Wave',
    bones: {
      Spine: { x: 0, y: -4 * DEG, z: -3 * DEG },
      Head: { x: -4 * DEG, y: -6 * DEG, z: 4 * DEG },
      LeftUpperArm: { x: 4 * DEG, y: 0, z: -10 * DEG },
      LeftForeArm: { x: -12 * DEG, y: 0, z: 0 },
      RightUpperArm: { x: 8 * DEG, y: 0, z: 118 * DEG },
      RightForeArm: { x: -12 * DEG, y: 0, z: 45 * DEG }
    }
  },
  {
    id: 'body.cheer',
    category: 'body',
    labelKey: 'director.stage.expressivePose.bodyCheer',
    clipName: 'Cheer',
    bones: {
      Spine: { x: -6 * DEG, y: 0, z: 0 },
      Chest: { x: -6 * DEG, y: 0, z: 0 },
      Head: { x: -12 * DEG, y: 0, z: 0 },
      LeftUpperArm: { x: -12 * DEG, y: 0, z: -128 * DEG },
      RightUpperArm: { x: -12 * DEG, y: 0, z: 128 * DEG },
      LeftForeArm: { x: -18 * DEG, y: 0, z: -12 * DEG },
      RightForeArm: { x: -18 * DEG, y: 0, z: 12 * DEG },
      LeftUpLeg: { x: 0, y: 0, z: -6 * DEG },
      RightUpLeg: { x: 0, y: 0, z: 6 * DEG }
    }
  },
  {
    id: 'body.clap',
    category: 'body',
    labelKey: 'director.stage.expressivePose.bodyClap',
    clipName: 'Clap',
    bones: {
      Spine: { x: 3 * DEG, y: 0, z: 0 },
      Head: { x: -4 * DEG, y: 0, z: 3 * DEG },
      LeftUpperArm: { x: -38 * DEG, y: 0, z: -12 * DEG },
      RightUpperArm: { x: -38 * DEG, y: 0, z: 12 * DEG },
      LeftForeArm: { x: -66 * DEG, y: 0, z: 18 * DEG },
      RightForeArm: { x: -66 * DEG, y: 0, z: -18 * DEG }
    }
  },
  {
    id: 'body.dance',
    category: 'body',
    labelKey: 'director.stage.expressivePose.bodyDance',
    clipName: 'Dance',
    bones: {
      'Hips.position': { x: -0.04, y: -0.03, z: 0 },
      Spine: { x: 4 * DEG, y: -10 * DEG, z: 5 * DEG },
      Head: { x: -4 * DEG, y: 8 * DEG, z: -5 * DEG },
      LeftUpperArm: { x: -32 * DEG, y: 0, z: -96 * DEG },
      RightUpperArm: { x: -32 * DEG, y: 0, z: 22 * DEG },
      LeftForeArm: { x: -42 * DEG, y: 0, z: 0 },
      RightForeArm: { x: -55 * DEG, y: 0, z: 0 },
      LeftUpLeg: { x: -18 * DEG, y: 0, z: -8 * DEG },
      LeftLeg: { x: 28 * DEG, y: 0, z: 0 },
      RightUpLeg: { x: -6 * DEG, y: 0, z: 5 * DEG },
      RightLeg: { x: 10 * DEG, y: 0, z: 0 }
    }
  },
  {
    id: 'body.stretch',
    category: 'body',
    labelKey: 'director.stage.expressivePose.bodyStretch',
    clipName: 'Stretch',
    bones: {
      Spine: { x: -12 * DEG, y: 0, z: 0 },
      Chest: { x: -10 * DEG, y: 0, z: 0 },
      Head: { x: -14 * DEG, y: 4 * DEG, z: 0 },
      LeftUpperArm: { x: -16 * DEG, y: 0, z: -130 * DEG },
      RightUpperArm: { x: -16 * DEG, y: 0, z: 130 * DEG },
      LeftForeArm: { x: -22 * DEG, y: 0, z: 0 },
      RightForeArm: { x: -22 * DEG, y: 0, z: 0 }
    }
  },
  {
    id: 'body.think',
    category: 'body',
    labelKey: 'director.stage.expressivePose.bodyThink',
    clipName: 'Think',
    bones: {
      Spine: { x: 4 * DEG, y: 3 * DEG, z: 0 },
      Head: { x: 10 * DEG, y: -5 * DEG, z: 5 * DEG },
      LeftUpperArm: { x: -20 * DEG, y: 0, z: -12 * DEG },
      LeftForeArm: { x: -45 * DEG, y: 0, z: 0 },
      RightUpperArm: { x: -48 * DEG, y: 0, z: 14 * DEG },
      RightForeArm: { x: -82 * DEG, y: 0, z: -14 * DEG }
    }
  },
  {
    id: 'body.talk',
    category: 'body',
    labelKey: 'director.stage.expressivePose.bodyTalk',
    clipName: 'Talk',
    bones: {
      Spine: { x: 3 * DEG, y: -4 * DEG, z: 0 },
      Head: { x: -3 * DEG, y: 6 * DEG, z: 2 * DEG },
      LeftUpperArm: { x: -24 * DEG, y: 0, z: -16 * DEG },
      RightUpperArm: { x: -32 * DEG, y: 0, z: 20 * DEG },
      LeftForeArm: { x: -52 * DEG, y: 0, z: 0 },
      RightForeArm: { x: -64 * DEG, y: 0, z: 0 }
    }
  },
  {
    id: 'body.phone',
    category: 'body',
    labelKey: 'director.stage.expressivePose.bodyPhone',
    clipName: 'PhoneLook',
    bones: {
      Spine: { x: 6 * DEG, y: 0, z: 0 },
      Neck: { x: 12 * DEG, y: 0, z: 0 },
      Head: { x: 20 * DEG, y: 0, z: 0 },
      LeftUpperArm: { x: 4 * DEG, y: 0, z: -10 * DEG },
      LeftForeArm: { x: -14 * DEG, y: 0, z: 0 },
      RightUpperArm: { x: -38 * DEG, y: 0, z: 12 * DEG },
      RightForeArm: { x: -70 * DEG, y: 0, z: -12 * DEG }
    }
  },
  {
    id: 'body.drink',
    category: 'body',
    labelKey: 'director.stage.expressivePose.bodyDrink',
    clipName: 'Drink',
    bones: {
      Spine: { x: -4 * DEG, y: 0, z: 0 },
      Head: { x: -16 * DEG, y: 0, z: 0 },
      LeftUpperArm: { x: 4 * DEG, y: 0, z: -10 * DEG },
      LeftForeArm: { x: -12 * DEG, y: 0, z: 0 },
      RightUpperArm: { x: -58 * DEG, y: 0, z: 15 * DEG },
      RightForeArm: { x: -84 * DEG, y: 0, z: -12 * DEG }
    }
  },
  {
    id: 'body.lookAround',
    category: 'body',
    labelKey: 'director.stage.expressivePose.bodyLookAround',
    clipName: 'LookAround',
    bones: {
      Spine: { x: 3 * DEG, y: 14 * DEG, z: 0 },
      Head: { x: -4 * DEG, y: 26 * DEG, z: 0 },
      LeftUpperArm: { x: -12 * DEG, y: 0, z: -14 * DEG },
      LeftForeArm: { x: -24 * DEG, y: 0, z: 0 },
      RightUpperArm: { x: -44 * DEG, y: 0, z: 18 * DEG },
      RightForeArm: { x: -72 * DEG, y: 0, z: 0 }
    }
  },
  {
    id: 'body.crossArms',
    category: 'body',
    labelKey: 'director.stage.expressivePose.bodyCrossArms',
    clipName: 'Idle',
    bones: {
      Spine: { x: -3 * DEG, y: 0, z: 0 },
      Chest: { x: -4 * DEG, y: 0, z: 0 },
      Head: { x: -3 * DEG, y: 5 * DEG, z: 0 },
      LeftUpperArm: { x: -28 * DEG, y: 0, z: -12 * DEG },
      RightUpperArm: { x: -28 * DEG, y: 0, z: 12 * DEG },
      LeftForeArm: { x: -55 * DEG, y: 0, z: 32 * DEG },
      RightForeArm: { x: -55 * DEG, y: 0, z: -32 * DEG },
      LeftUpLeg: { x: 0, y: 0, z: -4 * DEG },
      RightUpLeg: { x: 0, y: 0, z: 4 * DEG }
    }
  },
  {
    id: 'body.handsOnHips',
    category: 'body',
    labelKey: 'director.stage.expressivePose.bodyHandsOnHips',
    clipName: 'Idle',
    bones: {
      Spine: { x: -4 * DEG, y: 0, z: 0 },
      Chest: { x: -6 * DEG, y: 0, z: 0 },
      Head: { x: -5 * DEG, y: 6 * DEG, z: 0 },
      LeftUpperArm: { x: 10 * DEG, y: 0, z: -28 * DEG },
      RightUpperArm: { x: 10 * DEG, y: 0, z: 28 * DEG },
      LeftForeArm: { x: -42 * DEG, y: 0, z: 24 * DEG },
      RightForeArm: { x: -42 * DEG, y: 0, z: -24 * DEG },
      LeftUpLeg: { x: 0, y: 0, z: -5 * DEG },
      RightUpLeg: { x: 0, y: 0, z: 5 * DEG }
    }
  },
  {
    id: 'body.pushUp',
    category: 'body',
    labelKey: 'director.stage.expressivePose.bodyPushUp',
    clipName: 'PushUp',
    bones: {
      'Hips.position': { x: 0, y: -0.58, z: 0 },
      Hips: { x: 76 * DEG, y: 0, z: 0 },
      Head: { x: -48 * DEG, y: 0, z: 0 },
      LeftUpperArm: { x: -72 * DEG, y: 0, z: -16 * DEG },
      RightUpperArm: { x: -72 * DEG, y: 0, z: 16 * DEG },
      LeftForeArm: { x: -12 * DEG, y: 0, z: 0 },
      RightForeArm: { x: -12 * DEG, y: 0, z: 0 },
      LeftUpLeg: { x: 3 * DEG, y: 0, z: -4 * DEG },
      RightUpLeg: { x: 3 * DEG, y: 0, z: 4 * DEG }
    }
  },
  {
    id: 'body.fall',
    category: 'body',
    labelKey: 'director.stage.expressivePose.bodyFall',
    clipName: 'Fall',
    bones: {
      'Hips.position': { x: 0, y: -0.76, z: -0.25 },
      Hips: { x: -85 * DEG, y: 0, z: 0 },
      Spine: { x: 6 * DEG, y: 0, z: 0 },
      Head: { x: 12 * DEG, y: 6 * DEG, z: 0 },
      LeftUpperArm: { x: -14 * DEG, y: 0, z: -38 * DEG },
      RightUpperArm: { x: -14 * DEG, y: 0, z: 38 * DEG },
      LeftForeArm: { x: -20 * DEG, y: 0, z: 0 },
      RightForeArm: { x: -20 * DEG, y: 0, z: 0 },
      LeftUpLeg: { x: -14 * DEG, y: 0, z: -8 * DEG },
      RightUpLeg: { x: -10 * DEG, y: 0, z: 8 * DEG },
      LeftLeg: { x: 20 * DEG, y: 0, z: 0 },
      RightLeg: { x: 16 * DEG, y: 0, z: 0 }
    }
  },
  {
    id: 'body.combat',
    category: 'body',
    labelKey: 'director.stage.expressivePose.bodyCombat',
    clipName: 'Action',
    bones: {
      'Hips.position': { x: 0, y: -0.06, z: 0 },
      Hips: { x: 8 * DEG, y: -14 * DEG, z: 0 },
      Spine: { x: 12 * DEG, y: 6 * DEG, z: 0 },
      Chest: { x: 8 * DEG, y: 8 * DEG, z: 0 },
      Head: { x: -12 * DEG, y: 12 * DEG, z: 0 },
      LeftUpperArm: { x: -45 * DEG, y: 8 * DEG, z: -20 * DEG },
      LeftForeArm: { x: -65 * DEG, y: 0, z: 0 },
      RightUpperArm: { x: -35 * DEG, y: -8 * DEG, z: 20 * DEG },
      RightForeArm: { x: -72 * DEG, y: 0, z: 0 },
      LeftUpLeg: { x: -24 * DEG, y: 8 * DEG, z: -5 * DEG },
      LeftLeg: { x: 36 * DEG, y: 0, z: 0 },
      RightUpLeg: { x: 18 * DEG, y: -8 * DEG, z: 5 * DEG },
      RightLeg: { x: 24 * DEG, y: 0, z: 0 }
    }
  },
  {
    id: 'body.kick',
    category: 'body',
    labelKey: 'director.stage.expressivePose.bodyKick',
    clipName: 'Action',
    bones: {
      Spine: { x: -8 * DEG, y: -10 * DEG, z: 0 },
      Chest: { x: -4 * DEG, y: -6 * DEG, z: 0 },
      Head: { x: 6 * DEG, y: 14 * DEG, z: 0 },
      LeftUpperArm: { x: -38 * DEG, y: 0, z: -22 * DEG },
      LeftForeArm: { x: -62 * DEG, y: 0, z: 0 },
      RightUpperArm: { x: 24 * DEG, y: 0, z: 24 * DEG },
      RightForeArm: { x: -48 * DEG, y: 0, z: 0 },
      LeftUpLeg: { x: 6 * DEG, y: 0, z: -4 * DEG },
      LeftLeg: { x: 10 * DEG, y: 0, z: 0 },
      RightUpLeg: { x: -88 * DEG, y: 0, z: 8 * DEG },
      RightLeg: { x: 12 * DEG, y: 0, z: 0 }
    }
  },

  // ==================== 手势预设 (category: 'hand') ====================
  {
    id: 'hand.relaxed',
    category: 'hand',
    labelKey: 'director.stage.expressivePose.handRelaxed',
    bones: {
      LeftHand: { x: 8 * DEG, y: 0, z: -6 * DEG },
      RightHand: { x: 8 * DEG, y: 0, z: 6 * DEG },
      LeftIndex: { x: 18 * DEG, y: 0, z: 0 },
      RightIndex: { x: 18 * DEG, y: 0, z: 0 },
      LeftThumb: { x: 10 * DEG, y: 12 * DEG, z: 0 },
      RightThumb: { x: 10 * DEG, y: -12 * DEG, z: 0 }
    }
  },
  {
    id: 'hand.fist',
    category: 'hand',
    labelKey: 'director.stage.expressivePose.handFist',
    bones: {
      LeftHand: { x: 15 * DEG, y: 0, z: 0 },
      RightHand: { x: 15 * DEG, y: 0, z: 0 },
      LeftIndex: { x: 82 * DEG, y: 0, z: 0 },
      RightIndex: { x: 82 * DEG, y: 0, z: 0 },
      LeftThumb: { x: 45 * DEG, y: 35 * DEG, z: 0 },
      RightThumb: { x: 45 * DEG, y: -35 * DEG, z: 0 }
    }
  },
  {
    id: 'hand.open',
    category: 'hand',
    labelKey: 'director.stage.expressivePose.handOpen',
    bones: {
      LeftHand: { x: -25 * DEG, y: 0, z: 0 },
      RightHand: { x: -25 * DEG, y: 0, z: 0 },
      LeftIndex: { x: -8 * DEG, y: 0, z: -6 * DEG },
      RightIndex: { x: -8 * DEG, y: 0, z: 6 * DEG },
      LeftThumb: { x: -10 * DEG, y: -25 * DEG, z: 0 },
      RightThumb: { x: -10 * DEG, y: 25 * DEG, z: 0 }
    }
  },
  {
    id: 'hand.pointRight',
    category: 'hand',
    labelKey: 'director.stage.expressivePose.handPoint',
    bones: {
      RightUpperArm: { x: -55 * DEG, y: 0, z: 12 * DEG },
      RightForeArm: { x: -20 * DEG, y: 0, z: 0 },
      RightHand: { x: 0, y: 0, z: 0 },
      RightIndex: { x: 0, y: 0, z: 0 },
      RightThumb: { x: 40 * DEG, y: -30 * DEG, z: 0 }
    }
  },
  {
    id: 'hand.peace',
    category: 'hand',
    labelKey: 'director.stage.expressivePose.handPeace',
    bones: {
      RightUpperArm: { x: -45 * DEG, y: 0, z: 16 * DEG },
      RightForeArm: { x: -65 * DEG, y: 0, z: 0 },
      RightHand: { x: -10 * DEG, y: 0, z: 8 * DEG },
      RightIndex: { x: -6 * DEG, y: 0, z: 8 * DEG },
      RightThumb: { x: 35 * DEG, y: -25 * DEG, z: 0 }
    }
  },
  {
    id: 'hand.thumbsUp',
    category: 'hand',
    labelKey: 'director.stage.expressivePose.handThumbsUp',
    bones: {
      RightUpperArm: { x: -38 * DEG, y: 0, z: 14 * DEG },
      RightForeArm: { x: -55 * DEG, y: 0, z: 0 },
      RightHand: { x: 10 * DEG, y: 0, z: 0 },
      RightIndex: { x: 78 * DEG, y: 0, z: 0 },
      RightThumb: { x: -35 * DEG, y: 20 * DEG, z: 0 }
    }
  },

  // ==================== 头部视线与情绪姿态 (category: 'gaze') ====================
  {
    id: 'gaze.lookUp',
    category: 'gaze',
    labelKey: 'director.stage.expressivePose.gazeUp',
    bones: {
      Neck: { x: -14 * DEG, y: 0, z: 0 },
      Head: { x: -22 * DEG, y: 0, z: 0 },
      Chest: { x: -8 * DEG, y: 0, z: 0 }
    }
  },
  {
    id: 'gaze.lookDown',
    category: 'gaze',
    labelKey: 'director.stage.expressivePose.gazeDown',
    bones: {
      Neck: { x: 16 * DEG, y: 0, z: 0 },
      Head: { x: 24 * DEG, y: 0, z: 0 },
      Chest: { x: 8 * DEG, y: 0, z: 0 }
    }
  },
  {
    id: 'gaze.tiltCuriosity',
    category: 'gaze',
    labelKey: 'director.stage.expressivePose.gazeTilt',
    bones: {
      Neck: { x: 0, y: 12 * DEG, z: 8 * DEG },
      Head: { x: 4 * DEG, y: 15 * DEG, z: 16 * DEG }
    }
  },
  {
    id: 'gaze.shy',
    category: 'gaze',
    labelKey: 'director.stage.expressivePose.gazeShy',
    bones: {
      Spine: { x: 6 * DEG, y: 0, z: 0 },
      Neck: { x: 12 * DEG, y: -10 * DEG, z: -6 * DEG },
      Head: { x: 18 * DEG, y: -14 * DEG, z: -10 * DEG }
    }
  },
  {
    id: 'gaze.sad',
    category: 'gaze',
    labelKey: 'director.stage.expressivePose.gazeSad',
    bones: {
      Spine: { x: 14 * DEG, y: 0, z: 0 },
      Chest: { x: 12 * DEG, y: 0, z: 0 },
      Neck: { x: 18 * DEG, y: 0, z: 0 },
      Head: { x: 22 * DEG, y: 0, z: 0 }
    }
  },
  {
    id: 'gaze.heroic',
    category: 'gaze',
    labelKey: 'director.stage.expressivePose.gazeHeroic',
    bones: {
      Spine: { x: -6 * DEG, y: 0, z: 0 },
      Chest: { x: -12 * DEG, y: 0, z: 0 },
      Neck: { x: 4 * DEG, y: 0, z: 0 },
      Head: { x: -8 * DEG, y: 10 * DEG, z: 0 },
      LeftUpperArm: { x: 8 * DEG, y: 0, z: -18 * DEG },
      RightUpperArm: { x: 8 * DEG, y: 0, z: 18 * DEG },
      LeftForeArm: { x: -35 * DEG, y: 0, z: 0 },
      RightForeArm: { x: -35 * DEG, y: 0, z: 0 }
    }
  },
  {
    id: 'gaze.combatReady',
    category: 'gaze',
    labelKey: 'director.stage.expressivePose.gazeCombat',
    bones: {
      Hips: { x: 8 * DEG, y: -20 * DEG, z: 0 },
      Spine: { x: 12 * DEG, y: 10 * DEG, z: 0 },
      Chest: { x: 10 * DEG, y: 12 * DEG, z: 0 },
      Head: { x: -12 * DEG, y: 18 * DEG, z: 0 },
      LeftUpperArm: { x: -45 * DEG, y: 15 * DEG, z: -22 * DEG },
      LeftForeArm: { x: -85 * DEG, y: 0, z: 0 },
      RightUpperArm: { x: -35 * DEG, y: -15 * DEG, z: 22 * DEG },
      RightForeArm: { x: -95 * DEG, y: 0, z: 0 },
      LeftUpLeg: { x: -22 * DEG, y: 12 * DEG, z: -5 * DEG },
      LeftLeg: { x: 38 * DEG, y: 0, z: 0 },
      RightUpLeg: { x: 18 * DEG, y: -12 * DEG, z: 5 * DEG },
      RightLeg: { x: 24 * DEG, y: 0, z: 0 }
    }
  }
] as const

export function findDirectorExpressivePosePreset(
  presetId: string
): DirectorExpressivePosePreset | undefined {
  return DIRECTOR_EXPRESSIVE_POSE_PRESETS.find((item) => item.id === presetId)
}

export interface DirectorCinematographyAnalysis {
  focalLengthMm: number
  fovDeg: number
  shotSizeZh: string
  shotSizeEn: string
  cameraAngleZh: string
  cameraAngleEn: string
  cameraMotionZh: string
  cameraMotionEn: string
  lightingMoodZh: string
  lightingMoodEn: string
  dofZh: string
  dofEn: string
  subjectsZh: string
  subjectsEn: string
  /** 合成的完整分镜摄影提示词（中英结构化，直接喂给文生图/图生视频节点） */
  prompt: string
}

/**
 * 从 3D 导演台场景状态自动合成专业摄影指令提示词（Shot size + Angle + Focal length + Lighting + Camera motion + Subject blocking）。
 */
export function buildDirectorCinematographyPrompt(
  stage: DirectorStageState | null | undefined,
  locale?: string
): DirectorCinematographyAnalysis {
  const defaultViewer: DirectorViewerState = {
    position: { x: 0, y: 2.2, z: 10 },
    target: { x: 0, y: 1.2, z: 0 },
    fov: DEFAULT_DIRECTOR_CAMERA_FOV
  }
  const cameras = stage?.cameras ?? []
  const activeCam = cameras.find((c) => c.id === stage?.activeCameraId) ??
    cameras[0] ?? { id: 'cam', name: 'Camera 1', viewer: defaultViewer }
  const viewer = activeCam.viewer ?? defaultViewer
  const fovDeg = Math.round(viewer.fov ?? DEFAULT_DIRECTOR_CAMERA_FOV)
  const focalLengthMm =
    viewer.focalLengthMm && viewer.focalLengthMm > 0
      ? Math.round(viewer.focalLengthMm)
      : fovDegToFocalLengthMm(fovDeg)

  // 1. 计算相机到目标的距离与可见画面高度，判断景别（Shot Size）
  const dx = viewer.target.x - viewer.position.x
  const dy = viewer.target.y - viewer.position.y
  const dz = viewer.target.z - viewer.position.z
  const dist = Math.max(0.1, Math.hypot(dx, dy, dz))
  const visibleHeight = 2 * dist * Math.tan((fovDeg * Math.PI) / 360)

  let shotSizeZh = '中景镜头'
  let shotSizeEn = 'medium shot (MS)'
  if (visibleHeight < 0.45) {
    shotSizeZh = '大特写镜头'
    shotSizeEn = 'extreme close-up (ECU)'
  } else if (visibleHeight < 0.85) {
    shotSizeZh = '特写镜头'
    shotSizeEn = 'close-up shot (CU)'
  } else if (visibleHeight < 1.35) {
    shotSizeZh = '中近景镜头'
    shotSizeEn = 'medium close-up (MCU)'
  } else if (visibleHeight < 2.2) {
    shotSizeZh = '中景镜头'
    shotSizeEn = 'medium shot (MS)'
  } else if (visibleHeight < 3.8) {
    shotSizeZh = '全景全身镜头'
    shotSizeEn = 'full shot (FS)'
  } else if (visibleHeight < 7.5) {
    shotSizeZh = '远景镜头'
    shotSizeEn = 'long wide shot (LS)'
  } else {
    shotSizeZh = '大远景建立镜头'
    shotSizeEn = 'extreme wide establishing shot (EWS)'
  }

  // 2. 判断相机俯仰角与荷兰角（Camera Angle）
  const rotation = viewer.rotation ?? directorViewerRotationFromLook(viewer.position, viewer.target)
  const pitchDeg = (rotation.x * 180) / Math.PI
  const rollDeg = (rotation.z * 180) / Math.PI

  let cameraAngleZh = '平视机位'
  let cameraAngleEn = 'eye-level angle'
  if (pitchDeg <= -38) {
    cameraAngleZh = '高空鸟瞰俯拍机位'
    cameraAngleEn = "high bird's-eye overhead angle"
  } else if (pitchDeg <= -12) {
    cameraAngleZh = '高机位俯拍'
    cameraAngleEn = 'high-angle shot looking down'
  } else if (pitchDeg >= 32) {
    cameraAngleZh = '极低机位大仰拍'
    cameraAngleEn = "worm's-eye extreme low-angle shot"
  } else if (pitchDeg >= 10) {
    cameraAngleZh = '低机位仰拍英雄视角'
    cameraAngleEn = 'low-angle heroic shot looking up'
  }
  if (Math.abs(rollDeg) >= 5) {
    const tiltDir = rollDeg > 0 ? '右倾' : '左倾'
    cameraAngleZh += `（荷兰角${tiltDir} ${Math.abs(Math.round(rollDeg))}°）`
    cameraAngleEn += `, Dutch angle tilt (${Math.round(rollDeg)}deg)`
  }

  // 3. 分析光影与大气雾（Lighting & Atmosphere）
  const visibleObjects = (stage?.objects ?? []).filter((o) => o.visible !== false)
  const lightObjects = visibleObjects.filter((o) => o.kind === 'light')
  let lightingMoodZh = '自然柔和立体光影，接触阴影清晰'
  let lightingMoodEn = 'natural soft cinematic lighting with grounded contact shadows'

  if (lightObjects.length > 0) {
    const presetHit = DIRECTOR_LIGHTING_PRESETS.find((p) =>
      lightObjects.some((l) => l.id.includes(`light:preset:${p.id}:`))
    )
    if (presetHit) {
      lightingMoodZh = presetHit.promptMoodZh
      lightingMoodEn = presetHit.promptMoodEn
    } else {
      const colors = lightObjects.map((l) => l.color ?? '#ffffff').join(', ')
      lightingMoodZh = `${lightObjects.length} 盏自定义舞台灯光（色调 ${colors}），电影感明暗层次`
      lightingMoodEn = `custom ${lightObjects.length}-light cinematic stage setup (${colors}), rich shadow depth`
    }
  }
  if (stage?.fogEnabled) {
    lightingMoodZh += '，空气透视体积雾氛围'
    lightingMoodEn += ', volumetric atmospheric fog and depth haze'
  }

  // 4. 分析景深与焦段光学质感（Lens & Depth of Field）
  let lensDescZh = `${focalLengthMm}mm 标准电影定焦镜头`
  let lensDescEn = `${focalLengthMm}mm cinema prime lens`
  if (focalLengthMm <= 20) {
    lensDescZh = `${focalLengthMm}mm 超广角镜头（强烈空间纵深透视）`
    lensDescEn = `${focalLengthMm}mm ultra-wide lens with dramatic spatial perspective`
  } else if (focalLengthMm <= 30) {
    lensDescZh = `${focalLengthMm}mm 广角电影镜头`
    lensDescEn = `${focalLengthMm}mm wide-angle cinema lens`
  } else if (focalLengthMm >= 100) {
    lensDescZh = `${focalLengthMm}mm 长焦镜头（强烈空间压缩感）`
    lensDescEn = `${focalLengthMm}mm telephoto lens with background compression`
  } else if (focalLengthMm >= 70) {
    lensDescZh = `${focalLengthMm}mm 人像特写镜头`
    lensDescEn = `${focalLengthMm}mm portrait cinema lens`
  }

  const aperture = viewer.aperture ?? 0
  const focusDist = viewer.focusDistance && viewer.focusDistance > 0 ? viewer.focusDistance : dist
  let dofZh = lensDescZh
  let dofEn = lensDescEn
  if (aperture > 0 && aperture <= 4) {
    dofZh += `，f/${aperture} 大光圈浅景深虚化（对焦距离 ${focusDist.toFixed(1)}m）`
    dofEn += `, shallow depth of field at f/${aperture} bokeh (focus at ${focusDist.toFixed(1)}m)`
  } else if (aperture > 4) {
    dofZh += `，f/${aperture} 景深控制`
    dofEn += `, f/${aperture} aperture`
  }

  // 5. 分析运镜轨迹（Camera Motion & Handheld Shake）
  const anim = stage?.animation
  const camTrack = anim?.tracks.find(
    (t) => !t.cameraCut && t.targetKind === 'camera' && t.targetId === activeCam.id
  )
  const cutTrack = anim?.tracks.find((t) => t.cameraCut && (t.cameraSegments?.length ?? 0) > 1)
  let cameraMotionZh = '固定稳定机位构图'
  let cameraMotionEn = 'locked-off static camera framing'
  let hasKeyframeMotion = false

  if (camTrack && (camTrack.keyframes?.length ?? 0) >= 2) {
    const first = camTrack.keyframes[0]!
    const last = camTrack.keyframes[camTrack.keyframes.length - 1]!
    const d0 = Math.hypot(
      first.position.x - viewer.target.x,
      first.position.y - viewer.target.y,
      first.position.z - viewer.target.z
    )
    const d1 = Math.hypot(
      last.position.x - viewer.target.x,
      last.position.y - viewer.target.y,
      last.position.z - viewer.target.z
    )
    const dyTrack = last.position.y - first.position.y
    const lateral = Math.hypot(
      last.position.x - first.position.x,
      last.position.z - first.position.z
    )

    if (camTrack.path?.kind === 'circle') {
      cameraMotionZh = '360度环绕运镜'
      cameraMotionEn = 'smooth orbital arc camera movement around the subject'
      hasKeyframeMotion = true
    } else if (d0 - d1 > 0.35) {
      cameraMotionZh = '缓慢推进运镜'
      cameraMotionEn = 'smooth dolly-in push camera movement toward the subject'
      hasKeyframeMotion = true
    } else if (d1 - d0 > 0.35) {
      cameraMotionZh = '缓慢拉远运镜'
      cameraMotionEn = 'smooth dolly-out pull-back camera movement'
      hasKeyframeMotion = true
    } else if (Math.abs(dyTrack) > 0.35 && Math.abs(dyTrack) > lateral * 0.6) {
      cameraMotionZh = dyTrack > 0 ? '摇臂升起运镜' : '摇臂下降运镜'
      cameraMotionEn = dyTrack > 0 ? 'crane-up camera movement' : 'crane-down camera movement'
      hasKeyframeMotion = true
    } else if (lateral > 0.25) {
      cameraMotionZh = '横移跟拍运镜'
      cameraMotionEn = 'lateral tracking camera movement'
      hasKeyframeMotion = true
    }
    if (first.fov != null && last.fov != null && Math.abs(last.fov - first.fov) >= 8) {
      cameraMotionZh += '，配合希区柯克变焦'
      cameraMotionEn += ' with Hitchcock dolly-zoom perspective shift'
      hasKeyframeMotion = true
    }
  } else if (cutTrack) {
    const segs = cutTrack.cameraSegments ?? []
    const count = segs.length
    const hasSmoothBlend = segs.some((s) => (s.blendInSec ?? 0) > 0.05)
    cameraMotionZh = hasSmoothBlend
      ? `Cinemachine 多机位平滑过渡运镜（共 ${count} 个镜头片段）`
      : `多机位分镜切换（共 ${count} 个切镜片段）`
    cameraMotionEn = hasSmoothBlend
      ? `Cinemachine smooth multi-camera blend sequence (${count} shot segments)`
      : `multi-camera sequence with ${count} editorial cuts`
  }

  // Cinemachine Body & Aim 运镜描述增强
  const cm = viewer.cinemachine
  if (cm) {
    if (cm.bodyMode === 'orbital') {
      cameraMotionZh = `Cinemachine 360度环绕跟拍运镜（半径 ${(cm.orbitRadius ?? 4).toFixed(1)}m）`
      cameraMotionEn = `Cinemachine 360-degree orbital tracking shot (radius ${(cm.orbitRadius ?? 4).toFixed(1)}m)`
    } else if (cm.bodyMode === 'transposer') {
      if (hasKeyframeMotion) {
        cameraMotionZh += '，配合 Cinemachine 阻尼平滑跟随（Transposer Follow）'
        cameraMotionEn += ', with Cinemachine damped follow tracking (Transposer)'
      } else {
        cameraMotionZh = 'Cinemachine 阻尼平滑跟随运镜（Transposer Follow）'
        cameraMotionEn = 'Cinemachine damped follow tracking camera (Transposer)'
      }
    } else if (cm.bodyMode === 'groupFraming') {
      if (hasKeyframeMotion) {
        cameraMotionZh += '，配合 Cinemachine 群像自动同框调度（Target Group Framing）'
        cameraMotionEn += ', with Cinemachine dynamic multi-subject group framing'
      } else {
        cameraMotionZh = 'Cinemachine 群像自动同框推拉调度（Target Group Framing）'
        cameraMotionEn = 'Cinemachine dynamic multi-subject group framing camera'
      }
    }
    if (cm.aimMode === 'composer') {
      const sx = cm.screenOffset?.x ?? 0
      const framingNoteZh =
        sx < -0.1 ? '左三分构图锁定' : sx > 0.1 ? '右三分构图锁定' : '智能死区追焦构图'
      const framingNoteEn =
        sx < -0.1
          ? 'left-third rule composer lock'
          : sx > 0.1
            ? 'right-third rule composer lock'
            : 'smart dead-zone composer aim tracking'
      cameraMotionZh += `，${framingNoteZh}`
      cameraMotionEn += `, with ${framingNoteEn}`
    } else if (cm.aimMode === 'groupComposer') {
      cameraMotionZh += '，群像中心自动摇摄构图'
      cameraMotionEn += ', with multi-target group composer aim'
    }
    if (cm.autoFocusPull) {
      cameraMotionZh += '，实时自动跟焦（Auto Focus Pull）'
      cameraMotionEn += ', live rack-focus tracking on subject'
    }
    if (cm.noisePreset && cm.noisePreset !== 'none') {
      const noiseMapZh: Record<string, string> = {
        handheld: '纪录片手持呼吸感',
        telephoto: '长焦镜头微颤感',
        carMount: '车载悬挂颠簸感',
        droneHover: '航拍无人机悬浮感'
      }
      const noiseMapEn: Record<string, string> = {
        handheld: 'documentary handheld camera sway',
        telephoto: 'telephoto lens micro-tremor',
        carMount: 'vehicle suspension mount vibration',
        droneHover: 'aerial drone hover drift'
      }
      if (noiseMapZh[cm.noisePreset]) {
        cameraMotionZh += `，${noiseMapZh[cm.noisePreset]}`
        cameraMotionEn += `, ${noiseMapEn[cm.noisePreset]}`
      }
    }
  }

  if (viewer.handheldShake?.enabled && (viewer.handheldShake.intensity ?? 0) > 0) {
    cameraMotionZh += '，带纪实感手持呼吸微晃动'
    cameraMotionEn += ', organic handheld camera breathing motion'
  }

  // 6. 分析画面主体与空间站位（Subject Blocking in Camera Space）
  const subjects = visibleObjects.filter(
    (o) =>
      o.kind === 'character' || o.kind === 'model' || o.kind === 'prop' || o.kind === 'primitive'
  )
  const forward = directorViewerForwardFromRotation(rotation)
  // 相机右向量 = forward × worldUp(0,1,0)
  const rightLen = Math.hypot(-forward.z, forward.x) || 1
  const rightX = -forward.z / rightLen
  const rightZ = forward.x / rightLen

  const subjectDescsZh: string[] = []
  const subjectDescsEn: string[] = []
  for (const sub of subjects.slice(0, 6)) {
    const relX = sub.position.x - viewer.position.x
    const relY = sub.position.y - viewer.position.y
    const relZ = sub.position.z - viewer.position.z
    const depth = relX * forward.x + relY * forward.y + relZ * forward.z
    if (depth <= 0.05) continue
    const horiz = relX * rightX + relZ * rightZ
    const normX = horiz / Math.max(0.5, depth * Math.tan((fovDeg * Math.PI) / 360))
    const posZh = normX < -0.25 ? '画面左侧' : normX > 0.25 ? '画面右侧' : '画面中央'
    const posEn = normX < -0.25 ? 'frame left' : normX > 0.25 ? 'frame right' : 'center frame'
    const layerZh = depth < dist * 0.7 ? '前景' : depth > dist * 1.35 ? '远景' : '中景'
    const layerEn =
      depth < dist * 0.7 ? 'foreground' : depth > dist * 1.35 ? 'background' : 'midground'
    subjectDescsZh.push(`${sub.name}（位于${layerZh}${posZh}）`)
    subjectDescsEn.push(`${sub.name} (${layerEn}, ${posEn})`)
  }

  const subjectsZh = subjectDescsZh.length ? subjectDescsZh.join('、') : '舞台中心主体'
  const subjectsEn = subjectDescsEn.length ? subjectDescsEn.join(', ') : 'center stage subject'

  // 7. 多机位切镜时间码脚本（Shot-by-Shot Storyboard Breakdown）
  const cutSegments = cutTrack?.cameraSegments ?? []
  const shotLinesZh: string[] = []
  const shotLinesEn: string[] = []
  if (cutSegments.length > 0) {
    const sortedSegs = [...cutSegments].sort((a, b) => a.start - b.start)
    for (let i = 0; i < sortedSegs.length; i++) {
      const seg = sortedSegs[i]!
      const segCam = cameras.find((c) => c.id === seg.cameraId) ?? activeCam
      const segViewer = segCam.viewer ?? defaultViewer
      const segFov = Math.round(segViewer.fov ?? DEFAULT_DIRECTOR_CAMERA_FOV)
      const segMm = segViewer.focalLengthMm ?? fovDegToFocalLengthMm(segFov)
      const segCm = segViewer.cinemachine
      const cmTagZh =
        segCm?.bodyMode === 'orbital'
          ? '环绕运镜'
          : segCm?.bodyMode === 'transposer'
            ? '跟随运镜'
            : segCm?.bodyMode === 'groupFraming'
              ? '群像同框'
              : segViewer.dollyZoomLock
                ? '希区柯克变焦'
                : '定机位'
      const cmTagEn =
        segCm?.bodyMode === 'orbital'
          ? 'Orbital track'
          : segCm?.bodyMode === 'transposer'
            ? 'Transposer follow'
            : segCm?.bodyMode === 'groupFraming'
              ? 'Group framing'
              : segViewer.dollyZoomLock
                ? 'Dolly-zoom'
                : 'Static/Keyframe'
      const blendNoteZh =
        i > 0 && (seg.blendInSec ?? 0) > 0.05
          ? `（平滑过渡 ${seg.blendInSec?.toFixed(1)}s）`
          : i > 0
            ? '（硬切）'
            : ''
      const blendNoteEn =
        i > 0 && (seg.blendInSec ?? 0) > 0.05
          ? ` (smooth blend ${seg.blendInSec?.toFixed(1)}s)`
          : i > 0
            ? ' (hard cut)'
            : ''
      shotLinesZh.push(
        `#${i + 1} [${seg.start.toFixed(1)}s-${seg.end.toFixed(1)}s] ${segCam.name}（${segMm}mm，${cmTagZh}）${blendNoteZh}`
      )
      shotLinesEn.push(
        `#${i + 1} [${seg.start.toFixed(1)}s-${seg.end.toFixed(1)}s] ${segCam.name} (${segMm}mm, ${cmTagEn})${blendNoteEn}`
      )
    }
  }

  const lowerLocale = typeof locale === 'string' ? locale.toLowerCase() : ''
  const prompt = lowerLocale.startsWith('zh')
    ? [
        `[摄影调度] ${shotSizeZh}，${cameraAngleZh}，${dofZh}。`,
        `[运镜方式] ${cameraMotionZh}。`,
        `[光影氛围] ${lightingMoodZh}。`,
        `[场面调度] ${subjectsZh}。`,
        ...(shotLinesZh.length ? [`[分镜切镜表] ${shotLinesZh.join(' → ')}。`] : [])
      ].join('\n')
    : lowerLocale.startsWith('en')
      ? [
          `[Cinematography] ${shotSizeEn}, ${cameraAngleEn}, ${dofEn}.`,
          `[Camera Motion] ${cameraMotionEn}.`,
          `[Lighting & Mood] ${lightingMoodEn}.`,
          `[Subject Blocking] ${subjectsEn}.`,
          ...(shotLinesEn.length ? [`[Shot Breakdown] ${shotLinesEn.join(' -> ')}.`] : [])
        ].join('\n')
      : [
          `[摄影调度 / Cinematography] ${shotSizeZh}（${shotSizeEn}），${cameraAngleZh}（${cameraAngleEn}），${dofZh}（${dofEn}）。`,
          `[运镜方式 / Camera Motion] ${cameraMotionZh}（${cameraMotionEn}）。`,
          `[光影氛围 / Lighting & Mood] ${lightingMoodZh}（${lightingMoodEn}）。`,
          `[场面调度 / Subject Blocking] ${subjectsZh}（${subjectsEn}）。`,
          ...(shotLinesZh.length
            ? [
                `[分镜切镜表 / Shot Breakdown] ${shotLinesZh.join(' → ')} (${shotLinesEn.join(' -> ')})。`
              ]
            : [])
        ].join('\n')

  return {
    focalLengthMm,
    fovDeg,
    shotSizeZh,
    shotSizeEn,
    cameraAngleZh,
    cameraAngleEn,
    cameraMotionZh,
    cameraMotionEn,
    lightingMoodZh,
    lightingMoodEn,
    dofZh,
    dofEn,
    subjectsZh,
    subjectsEn,
    prompt
  }
}

export interface DirectorShotPrevizCinematography extends DirectorCinematographyAnalysis {
  cameraId: string
  cameraName: string
  /** 用于关键帧生图的 3D 白模预演机位与空间站位提示词（中文） */
  imageSpecZh: string
  /** 用于关键帧生图的 3D 白模预演机位与空间站位提示词（英文） */
  imageSpecEn: string
  /** 用于图生视频的 3D 白模预演相机运镜与轨迹提示词（中文） */
  videoSpecZh: string
  /** 用于图生视频的 3D 白模预演相机运镜与轨迹提示词（英文） */
  videoSpecEn: string
}

/**
 * 从导演台机位 id (`cam:sb:<shotId>` / `sb_cam_<shotId>` / `cam_<shotId>`)
 * 或切镜片段 id (`cut:sb:<shotId>` / `cut_<shotId>`) 提取分镜镜头 ID。
 */
export function extractStoryboardShotIdFromDirectorId(
  id: string | null | undefined
): string | null {
  const raw = (id ?? '').trim()
  if (!raw) return null
  const m = raw.match(
    /^(?:cam:sb:|cut:sb:|sb[_:-]cam[_:-]|sb[_:-]cut[_:-]|cam[_-]|cut[_-]|shot[_:-])(.+)$/i
  )
  return m?.[1]?.trim() || null
}

/**
 * 从 3D 导演台白模预演舞台（DirectorStageState）中按分镜镜头 ID（如 `S01` -> `cam:sb:S01` 或 `sb_cam_S01`）
 * 提取该镜头的专属 3D 机位光学参数、空间站位以及 3D 运镜轨迹与 Cinemachine 跟随描述。
 */
export function resolveShotCinematographyFromDirectorStage(
  stage: DirectorStageState | null | undefined,
  shotId: string | null | undefined,
  options?: { allowActiveCameraFallback?: boolean }
): DirectorShotPrevizCinematography | null {
  const cameras = stage?.cameras ?? []
  const rawShotId = (shotId ?? '').trim()
  if (!cameras.length || !rawShotId) return null

  const lowerShotId = rawShotId.toLowerCase()
  let cam =
    cameras.find(
      (c) => (extractStoryboardShotIdFromDirectorId(c.id) ?? '').toLowerCase() === lowerShotId
    ) ??
    cameras.find((c) => {
      const n = (c.name ?? '').trim().toLowerCase()
      return (
        n === lowerShotId || n.startsWith(`${lowerShotId} ·`) || n.startsWith(`${lowerShotId} `)
      )
    }) ??
    null

  if (!cam && options?.allowActiveCameraFallback) {
    const hasStoryboardCams = cameras.some(
      (c) => extractStoryboardShotIdFromDirectorId(c.id) !== null
    )
    if (!hasStoryboardCams) {
      cam = cameras.find((c) => c.id === stage?.activeCameraId) ?? cameras[0] ?? null
    }
  }
  if (!cam) return null

  const singleShotStage: DirectorStageState = {
    ...stage!,
    activeCameraId: cam.id,
    animation: stage?.animation
      ? {
          ...stage.animation,
          tracks: stage.animation.tracks.filter((t) => !t.cameraCut)
        }
      : undefined
  }
  const analysis = buildDirectorCinematographyPrompt(singleShotStage)
  const viewer = cam.viewer
  const camTrack = stage?.animation?.tracks.find(
    (t) => !t.cameraCut && t.targetKind === 'camera' && t.targetId === cam.id
  )

  const trajPartsZh: string[] = []
  const trajPartsEn: string[] = []
  if (camTrack && (camTrack.keyframes?.length ?? 0) >= 2 && viewer) {
    const first = camTrack.keyframes[0]!
    const last = camTrack.keyframes[camTrack.keyframes.length - 1]!
    const d0 = Math.hypot(
      first.position.x - viewer.target.x,
      first.position.y - viewer.target.y,
      first.position.z - viewer.target.z
    )
    const d1 = Math.hypot(
      last.position.x - viewer.target.x,
      last.position.y - viewer.target.y,
      last.position.z - viewer.target.z
    )
    const dx = last.position.x - first.position.x
    const dy = last.position.y - first.position.y
    const rot0 = first.rotation ?? directorViewerRotationFromLook(first.position, viewer.target)
    const rot1 = last.rotation ?? directorViewerRotationFromLook(last.position, viewer.target)
    const dPitchDeg = Math.round(((rot1.x - rot0.x) * 180) / Math.PI)
    const dYawDeg = Math.round(((rot1.y - rot0.y) * 180) / Math.PI)

    if (d0 - d1 > 0.25) {
      trajPartsZh.push(`机位距离由 ${d0.toFixed(1)}m 推近至 ${d1.toFixed(1)}m`)
      trajPartsEn.push(`camera dollies in from ${d0.toFixed(1)}m to ${d1.toFixed(1)}m`)
    } else if (d1 - d0 > 0.25) {
      trajPartsZh.push(`机位距离由 ${d0.toFixed(1)}m 拉远至 ${d1.toFixed(1)}m`)
      trajPartsEn.push(`camera pulls back from ${d0.toFixed(1)}m to ${d1.toFixed(1)}m`)
    }
    if (Math.abs(dx) > 0.2) {
      trajPartsZh.push(`${dx > 0 ? '向右横移' : '向左横移'} ${Math.abs(dx).toFixed(1)}m`)
      trajPartsEn.push(`tracks ${dx > 0 ? 'right' : 'left'} ${Math.abs(dx).toFixed(1)}m`)
    }
    if (Math.abs(dy) > 0.2) {
      trajPartsZh.push(`${dy > 0 ? '摇臂上升' : '摇臂下降'} ${Math.abs(dy).toFixed(1)}m`)
      trajPartsEn.push(`cranes ${dy > 0 ? 'up' : 'down'} ${Math.abs(dy).toFixed(1)}m`)
    }
    if (Math.abs(dPitchDeg) >= 3) {
      trajPartsZh.push(`${dPitchDeg > 0 ? '镜头上仰' : '镜头下摇'} ${Math.abs(dPitchDeg)}°`)
      trajPartsEn.push(`tilts ${dPitchDeg > 0 ? 'up' : 'down'} ${Math.abs(dPitchDeg)}°`)
    }
    if (Math.abs(dYawDeg) >= 3) {
      trajPartsZh.push(`${dYawDeg > 0 ? '镜头左摇' : '镜头右摇'} ${Math.abs(dYawDeg)}°`)
      trajPartsEn.push(`pans ${dYawDeg > 0 ? 'left' : 'right'} ${Math.abs(dYawDeg)}°`)
    }
  }

  const cm = viewer?.cinemachine
  const findObjName = (id: string | null | undefined): string => {
    if (!id) return ''
    return (stage?.objects ?? []).find((o) => o.id === id)?.name?.trim() || ''
  }
  const lookAtName = findObjName(cm?.lookAtTargetId)
  const groupNames = (cm?.groupTargetIds ?? []).map(findObjName).filter(Boolean)
  if (lookAtName) {
    trajPartsZh.push(`注视焦点锁定「${lookAtName}」`)
    trajPartsEn.push(`focus locked on "${lookAtName}"`)
  } else if (groupNames.length > 0) {
    trajPartsZh.push(`群像同框锁定「${groupNames.join('、')}」`)
    trajPartsEn.push(`group framing on "${groupNames.join(', ')}"`)
  }

  const trajSuffixZh = trajPartsZh.length ? `（3D 轨迹：${trajPartsZh.join('，')}）` : ''
  const trajSuffixEn = trajPartsEn.length ? ` (3D trajectory: ${trajPartsEn.join(', ')})` : ''

  const imageSpecZh = `3D 白模预演机位与站位参考：${analysis.shotSizeZh}，${analysis.cameraAngleZh}，${analysis.dofZh}；3D 空间站位：${analysis.subjectsZh}；光影氛围：${analysis.lightingMoodZh}。`
  const imageSpecEn = `3D Previz Camera & Blocking Spec: ${analysis.shotSizeEn}, ${analysis.cameraAngleEn}, ${analysis.dofEn}; 3D subject blocking: ${analysis.subjectsEn}; lighting: ${analysis.lightingMoodEn}.`
  const videoSpecZh = `3D 白模预演相机运镜参考：${analysis.cameraAngleZh}，${analysis.focalLengthMm}mm 镜头，${analysis.cameraMotionZh}${trajSuffixZh}；人物空间方位：${analysis.subjectsZh}。请严格遵循 3D 预演的相机运动方向、推拉移摇轨迹、透视景深变化与主体画面构图关系。`
  const videoSpecEn = `3D Previz Camera Motion Reference: ${analysis.cameraAngleEn}, ${analysis.focalLengthMm}mm lens, ${analysis.cameraMotionEn}${trajSuffixEn}; spatial blocking: ${analysis.subjectsEn}. Strictly follow the 3D previz camera movement direction, dolly/track trajectory, perspective shift and subject framing.`

  return {
    ...analysis,
    cameraId: cam.id,
    cameraName: cam.name,
    imageSpecZh,
    imageSpecEn,
    videoSpecZh,
    videoSpecEn
  }
}

// ============================================================================
// Unity Cinemachine 虚拟相机系统（Body + Aim Composer + Group + Noise/Impulse + Brain Blend）
// ============================================================================

export type DirectorCinemachineBodyMode = 'none' | 'transposer' | 'orbital' | 'groupFraming'

export const DIRECTOR_CINEMACHINE_BODY_MODES: readonly DirectorCinemachineBodyMode[] = [
  'none',
  'transposer',
  'orbital',
  'groupFraming'
] as const

export type DirectorCinemachineAimMode = 'none' | 'composer' | 'groupComposer'

export const DIRECTOR_CINEMACHINE_AIM_MODES: readonly DirectorCinemachineAimMode[] = [
  'none',
  'composer',
  'groupComposer'
] as const

export type DirectorCinemachineAimPart = 'head' | 'chest' | 'root'

export const DIRECTOR_CINEMACHINE_AIM_PARTS: readonly DirectorCinemachineAimPart[] = [
  'head',
  'chest',
  'root'
] as const

export type DirectorCinemachineFollowSpace = 'world' | 'targetLocal'

export type DirectorCinemachineNoisePreset =
  'none' | 'handheld' | 'telephoto' | 'carMount' | 'droneHover'

export const DIRECTOR_CINEMACHINE_NOISE_PRESETS: readonly DirectorCinemachineNoisePreset[] = [
  'none',
  'handheld',
  'telephoto',
  'carMount',
  'droneHover'
] as const

export interface DirectorCinemachineConfig {
  /** Body 机身跟拍模式 */
  bodyMode?: DirectorCinemachineBodyMode
  /** Body 跟随目标物体 ID */
  followTargetId?: string | null
  /** Transposer 相对偏移（默认 { x: 0, y: 1.8, z: 3.5 }） */
  followOffset?: StageVec3
  /** Transposer 偏移参考空间：世界轴或目标自身朝向 */
  followSpace?: DirectorCinemachineFollowSpace
  /** 机身位置平滑阻尼（0 ~ 2，0 为无延迟锁死） */
  positionDamping?: number
  /** Orbital 环绕半径（米，默认 4） */
  orbitRadius?: number
  /** Orbital 环绕高度偏移（米，默认 1.6） */
  orbitHeight?: number
  /** Orbital 环绕角速度（度/秒，默认 25） */
  orbitSpeedDegPerSec?: number
  /** Orbital 起始角度（度，默认 0） */
  orbitStartAngleDeg?: number

  /** Aim 瞄准与构图模式 */
  aimMode?: DirectorCinemachineAimMode
  /** Aim 注视目标物体 ID */
  lookAtTargetId?: string | null
  /** Aim 注视身体部位（head=1.55m, chest=1.15m, root=0m） */
  aimTargetPart?: DirectorCinemachineAimPart
  /** Composer 屏幕构图偏移（x, y ∈ [-0.45, 0.45]，如三分法左 x=-0.17） */
  screenOffset?: { x: number; y: number }
  /** Composer 死区宽度（0 ~ 0.6，目标在死区内微动不触发摇摄） */
  deadZoneWidth?: number
  /** Composer 死区高度（0 ~ 0.6） */
  deadZoneHeight?: number
  /** Aim 摇摄阻尼（0 ~ 2） */
  aimDamping?: number
  /** 自动跟焦（Auto Focus Pull）：景深对焦距离实时锁定 Aim 目标距离 */
  autoFocusPull?: boolean

  /** Target Group 多目标同框物体 ID 列表（缺省自动取全部可见角色/模型） */
  groupTargetIds?: string[]
  /** Group Framing 距离留白倍率（默认 1.25） */
  groupFramingScale?: number

  /** 6DoF 程序化镜头噪声预设 */
  noisePreset?: DirectorCinemachineNoisePreset
  /** 冲击震屏（Impulse）触发时间点（秒），null/undefined 为不触发 */
  impulseTimeSec?: number | null
  /** 冲击震屏强度（0 ~ 2，默认 0.6） */
  impulseIntensity?: number
}

export function normalizeDirectorCinemachineConfig(
  raw: unknown
): DirectorCinemachineConfig | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const o = raw as Record<string, unknown>
  const bodyMode: DirectorCinemachineBodyMode = DIRECTOR_CINEMACHINE_BODY_MODES.includes(
    o.bodyMode as DirectorCinemachineBodyMode
  )
    ? (o.bodyMode as DirectorCinemachineBodyMode)
    : 'none'
  const aimMode: DirectorCinemachineAimMode = DIRECTOR_CINEMACHINE_AIM_MODES.includes(
    o.aimMode as DirectorCinemachineAimMode
  )
    ? (o.aimMode as DirectorCinemachineAimMode)
    : 'none'
  const aimTargetPart: DirectorCinemachineAimPart = DIRECTOR_CINEMACHINE_AIM_PARTS.includes(
    o.aimTargetPart as DirectorCinemachineAimPart
  )
    ? (o.aimTargetPart as DirectorCinemachineAimPart)
    : 'chest'
  const followSpace: DirectorCinemachineFollowSpace =
    o.followSpace === 'targetLocal' ? 'targetLocal' : 'world'
  const noisePreset: DirectorCinemachineNoisePreset = DIRECTOR_CINEMACHINE_NOISE_PRESETS.includes(
    o.noisePreset as DirectorCinemachineNoisePreset
  )
    ? (o.noisePreset as DirectorCinemachineNoisePreset)
    : 'none'

  const followTargetId =
    typeof o.followTargetId === 'string' && o.followTargetId.trim() ? o.followTargetId.trim() : null
  const lookAtTargetId =
    typeof o.lookAtTargetId === 'string' && o.lookAtTargetId.trim() ? o.lookAtTargetId.trim() : null

  const rawOffset = o.followOffset as Record<string, unknown> | undefined
  const followOffset: StageVec3 =
    rawOffset && typeof rawOffset === 'object'
      ? {
          x: typeof rawOffset.x === 'number' && Number.isFinite(rawOffset.x) ? rawOffset.x : 0,
          y: typeof rawOffset.y === 'number' && Number.isFinite(rawOffset.y) ? rawOffset.y : 1.8,
          z: typeof rawOffset.z === 'number' && Number.isFinite(rawOffset.z) ? rawOffset.z : 3.5
        }
      : { x: 0, y: 1.8, z: 3.5 }

  const rawScreen = o.screenOffset as Record<string, unknown> | undefined
  const screenOffset =
    rawScreen && typeof rawScreen === 'object'
      ? {
          x:
            typeof rawScreen.x === 'number' && Number.isFinite(rawScreen.x)
              ? Math.max(-0.45, Math.min(0.45, rawScreen.x))
              : 0,
          y:
            typeof rawScreen.y === 'number' && Number.isFinite(rawScreen.y)
              ? Math.max(-0.45, Math.min(0.45, rawScreen.y))
              : 0
        }
      : { x: 0, y: 0 }

  const positionDamping =
    typeof o.positionDamping === 'number' && Number.isFinite(o.positionDamping)
      ? Math.max(0, Math.min(2, o.positionDamping))
      : 0.35
  const orbitRadius =
    typeof o.orbitRadius === 'number' && Number.isFinite(o.orbitRadius)
      ? Math.max(0.5, Math.min(80, o.orbitRadius))
      : 4.0
  const orbitHeight =
    typeof o.orbitHeight === 'number' && Number.isFinite(o.orbitHeight)
      ? Math.max(-20, Math.min(40, o.orbitHeight))
      : 1.8
  const orbitSpeedDegPerSec =
    typeof o.orbitSpeedDegPerSec === 'number' && Number.isFinite(o.orbitSpeedDegPerSec)
      ? Math.max(-180, Math.min(180, o.orbitSpeedDegPerSec))
      : 25
  const orbitStartAngleDeg =
    typeof o.orbitStartAngleDeg === 'number' && Number.isFinite(o.orbitStartAngleDeg)
      ? o.orbitStartAngleDeg
      : 0
  const deadZoneWidth =
    typeof o.deadZoneWidth === 'number' && Number.isFinite(o.deadZoneWidth)
      ? Math.max(0, Math.min(0.6, o.deadZoneWidth))
      : 0.08
  const deadZoneHeight =
    typeof o.deadZoneHeight === 'number' && Number.isFinite(o.deadZoneHeight)
      ? Math.max(0, Math.min(0.6, o.deadZoneHeight))
      : 0.08
  const aimDamping =
    typeof o.aimDamping === 'number' && Number.isFinite(o.aimDamping)
      ? Math.max(0, Math.min(2, o.aimDamping))
      : 0.25
  const autoFocusPull = o.autoFocusPull === true
  const groupTargetIds = Array.isArray(o.groupTargetIds)
    ? o.groupTargetIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
    : undefined
  const groupFramingScale =
    typeof o.groupFramingScale === 'number' && Number.isFinite(o.groupFramingScale)
      ? Math.max(0.5, Math.min(3, o.groupFramingScale))
      : 1.25
  const impulseTimeSec =
    typeof o.impulseTimeSec === 'number' &&
    Number.isFinite(o.impulseTimeSec) &&
    o.impulseTimeSec >= 0
      ? o.impulseTimeSec
      : null
  const impulseIntensity =
    typeof o.impulseIntensity === 'number' && Number.isFinite(o.impulseIntensity)
      ? Math.max(0, Math.min(2, o.impulseIntensity))
      : 0.6

  return {
    bodyMode,
    followTargetId,
    followOffset,
    followSpace,
    positionDamping,
    orbitRadius,
    orbitHeight,
    orbitSpeedDegPerSec,
    orbitStartAngleDeg,
    aimMode,
    lookAtTargetId,
    aimTargetPart,
    screenOffset,
    deadZoneWidth,
    deadZoneHeight,
    aimDamping,
    autoFocusPull,
    ...(groupTargetIds?.length ? { groupTargetIds } : {}),
    groupFramingScale,
    noisePreset,
    impulseTimeSec,
    impulseIntensity
  }
}

/** 判断相机是否启用了任何 Cinemachine 动态行为（用于允许无关键帧直接播放/录制） */
export function directorViewerHasActiveCinemachine(viewer?: DirectorViewerState | null): boolean {
  if (!viewer) return false
  if (viewer.handheldShake?.enabled && (viewer.handheldShake.intensity ?? 0) > 0) return true
  const cm = viewer.cinemachine
  if (!cm) return false
  if (cm.bodyMode && cm.bodyMode !== 'none') return true
  if (cm.aimMode && cm.aimMode !== 'none') return true
  if (cm.noisePreset && cm.noisePreset !== 'none') return true
  if (cm.impulseTimeSec != null && Number.isFinite(cm.impulseTimeSec)) return true
  return false
}

function wrapAngleRad(angle: number): number {
  let a = (angle + Math.PI) % (Math.PI * 2)
  if (a < 0) a += Math.PI * 2
  return a - Math.PI
}

function lerpNumber(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function lerpVec3(a: StageVec3, b: StageVec3, t: number): StageVec3 {
  return {
    x: lerpNumber(a.x, b.x, t),
    y: lerpNumber(a.y, b.y, t),
    z: lerpNumber(a.z, b.z, t)
  }
}

function lerpEulerShortest(a: StageVec3, b: StageVec3, t: number): StageVec3 {
  return {
    x: a.x + wrapAngleRad(b.x - a.x) * t,
    y: a.y + wrapAngleRad(b.y - a.y) * t,
    z: a.z + wrapAngleRad(b.z - a.z) * t
  }
}

function resolveAimPartHeightBias(
  part: DirectorCinemachineAimPart,
  scaleY = 1,
  preset?: StageMannequinPreset
): number {
  const sy = Number.isFinite(scaleY) && scaleY > 0 ? scaleY : 1
  if (preset === 'chibi') {
    if (part === 'head') return 1.18 * sy
    if (part === 'chest') return 0.8 * sy
    return 0
  }
  if (preset === 'quadruped') {
    if (part === 'head') return 0.86 * sy
    if (part === 'chest') return 0.58 * sy
    return 0
  }
  if (part === 'head') return 1.75 * sy
  if (part === 'chest') return 1.38 * sy
  return 0
}

function resolveObjectAimPoint(
  obj: CinemachineSceneObjectInput,
  part: DirectorCinemachineAimPart
): StageVec3 {
  if (part === 'head' && obj.headWorldPosition) {
    return { ...obj.headWorldPosition }
  }
  if (part === 'chest' && obj.chestWorldPosition) {
    return { ...obj.chestWorldPosition }
  }
  const biasY = resolveAimPartHeightBias(part, obj.scale?.y ?? 1, obj.mannequinPreset)
  return {
    x: obj.position.x,
    y: obj.position.y + biasY,
    z: obj.position.z
  }
}

export interface CinemachineRuntimeMemory {
  position: StageVec3
  rotation: StageVec3
  time: number
}

export type CinemachineSceneObjectInput = Pick<
  StageObjectState,
  'id' | 'kind' | 'mannequinPreset' | 'visible' | 'position' | 'rotation' | 'scale'
> & {
  headWorldPosition?: StageVec3
  chestWorldPosition?: StageVec3
}

/**
 * 求解单台 Cinemachine 虚拟相机在指定时刻 time 的完整 Viewer 状态：
 * 1. Body 阶段：Transposer（世界/局部空间阻尼跟随）、Orbital（环绕运镜）、Group Framing（群像自适应景别距离）
 * 2. Aim 阶段：Composer（目标部位锁定 + 屏幕三分构图偏移 + 死区过滤 + 摇摄阻尼 + 自动景深跟焦）、Group Composer
 * 3. Noise & Impulse 阶段：6DoF 程序化摄影机噪声 + 时间点触发的冲击衰减震屏
 */
export function solveCinemachineVirtualCamera(
  baseViewer: DirectorViewerState,
  objects: ReadonlyArray<CinemachineSceneObjectInput>,
  time: number,
  prevMemory?: CinemachineRuntimeMemory | null,
  aspect = 16 / 9
): { viewer: DirectorViewerState; memory: CinemachineRuntimeMemory } {
  const cm = baseViewer.cinemachine
  let position: StageVec3 = { ...baseViewer.position }
  let rotation: StageVec3 = baseViewer.rotation
    ? { ...baseViewer.rotation }
    : directorViewerRotationFromLook(baseViewer.position, baseViewer.target)
  let target: StageVec3 = { ...baseViewer.target }
  const fov = baseViewer.fov ?? DEFAULT_DIRECTOR_CAMERA_FOV
  let focusDistance = baseViewer.focusDistance

  const dt =
    prevMemory && time >= prevMemory.time && time - prevMemory.time <= 0.5
      ? time - prevMemory.time
      : 0

  if (cm) {
    const findObj = (id?: string | null): CinemachineSceneObjectInput | undefined =>
      id ? objects.find((o) => o.id === id) : undefined

    const resolveGroupObjects = (): CinemachineSceneObjectInput[] => {
      if (cm.groupTargetIds?.length) {
        const set = new Set(cm.groupTargetIds)
        const matched = objects.filter((o) => set.has(o.id) && o.visible !== false)
        if (matched.length) return matched
      }
      return objects.filter((o) => o.visible !== false && o.kind !== 'light' && o.kind !== 'empty')
    }

    const followObj = findObj(cm.followTargetId) ?? findObj(cm.lookAtTargetId)

    // 1. Body 阶段
    if (cm.bodyMode === 'transposer' && followObj) {
      const offset = cm.followOffset ?? { x: 0, y: 1.8, z: 3.5 }
      let desiredPos: StageVec3
      if (cm.followSpace === 'targetLocal') {
        const yaw = followObj.rotation?.y ?? 0
        const cosY = Math.cos(yaw)
        const sinY = Math.sin(yaw)
        desiredPos = {
          x: followObj.position.x + offset.x * cosY + offset.z * sinY,
          y: followObj.position.y + offset.y,
          z: followObj.position.z - offset.x * sinY + offset.z * cosY
        }
      } else {
        desiredPos = {
          x: followObj.position.x + offset.x,
          y: followObj.position.y + offset.y,
          z: followObj.position.z + offset.z
        }
      }
      const damping = Math.max(0, cm.positionDamping ?? 0.35)
      if (prevMemory && dt > 0 && damping > 0) {
        const alpha = 1 - Math.exp((-dt * 6) / Math.max(0.05, damping))
        position = lerpVec3(prevMemory.position, desiredPos, alpha)
      } else {
        position = desiredPos
      }
    } else if (cm.bodyMode === 'orbital') {
      const center: StageVec3 = followObj
        ? { ...followObj.position }
        : { x: target.x, y: 0, z: target.z }
      const radius = Math.max(0.5, cm.orbitRadius ?? 4.0)
      const height = cm.orbitHeight ?? 1.8
      const speedRad = ((cm.orbitSpeedDegPerSec ?? 25) * Math.PI) / 180
      const startRad = ((cm.orbitStartAngleDeg ?? 0) * Math.PI) / 180
      const angle = startRad + speedRad * time
      position = {
        x: center.x + Math.sin(angle) * radius,
        y: center.y + height,
        z: center.z + Math.cos(angle) * radius
      }
    } else if (cm.bodyMode === 'groupFraming') {
      const group = resolveGroupObjects()
      if (group.length > 0) {
        let cx = 0
        let cy = 0
        let cz = 0
        for (const g of group) {
          cx += g.position.x
          cy += g.position.y + 1.1 * (g.scale?.y ?? 1)
          cz += g.position.z
        }
        cx /= group.length
        cy /= group.length
        cz /= group.length
        let maxR = 0.6
        for (const g of group) {
          const r =
            Math.hypot(
              g.position.x - cx,
              g.position.y + 1.1 * (g.scale?.y ?? 1) - cy,
              g.position.z - cz
            ) + 0.65
          if (r > maxR) maxR = r
        }
        const halfFovRad = (Math.max(15, Math.min(110, fov)) * Math.PI) / 360
        const framingScale = Math.max(0.5, cm.groupFramingScale ?? 1.25)
        const requiredDist = Math.max(
          2.0,
          (maxR * framingScale) / Math.max(0.18, Math.tan(halfFovRad))
        )
        const dirX = position.x - cx
        const dirY = position.y - cy
        const dirZ = position.z - cz
        const dirLen = Math.hypot(dirX, dirY, dirZ)
        const nx = dirLen > 1e-4 ? dirX / dirLen : 0
        const ny = dirLen > 1e-4 ? dirY / dirLen : 0.18
        const nz = dirLen > 1e-4 ? dirZ / dirLen : 1
        const desiredPos: StageVec3 = {
          x: cx + nx * requiredDist,
          y: cy + ny * requiredDist,
          z: cz + nz * requiredDist
        }
        const damping = Math.max(0, cm.positionDamping ?? 0.35)
        if (prevMemory && dt > 0 && damping > 0) {
          const alpha = 1 - Math.exp((-dt * 6) / Math.max(0.05, damping))
          position = lerpVec3(prevMemory.position, desiredPos, alpha)
        } else {
          position = desiredPos
        }
      }
    }

    // 2. Aim 阶段
    let aimPoint: StageVec3 | null = null
    if (cm.aimMode === 'composer') {
      const lookObj = findObj(cm.lookAtTargetId) ?? followObj
      if (lookObj) {
        aimPoint = resolveObjectAimPoint(lookObj, cm.aimTargetPart ?? 'chest')
      }
    } else if (cm.aimMode === 'groupComposer' || cm.bodyMode === 'groupFraming') {
      const group = resolveGroupObjects()
      if (group.length > 0) {
        let gx = 0
        let gy = 0
        let gz = 0
        for (const g of group) {
          const chestPt = resolveObjectAimPoint(g, 'chest')
          gx += chestPt.x
          gy += chestPt.y
          gz += chestPt.z
        }
        aimPoint = {
          x: gx / group.length,
          y: gy / group.length,
          z: gz / group.length
        }
      }
    } else if (cm.bodyMode === 'orbital') {
      if (followObj) {
        aimPoint = resolveObjectAimPoint(followObj, cm.aimTargetPart ?? 'chest')
      } else {
        aimPoint = { ...target }
      }
    }

    if (aimPoint) {
      target = { ...aimPoint }
      const desiredRot = directorViewerRotationFromLook(position, aimPoint)
      const sx = Math.max(-0.45, Math.min(0.45, cm.screenOffset?.x ?? 0))
      const sy = Math.max(-0.45, Math.min(0.45, cm.screenOffset?.y ?? 0))
      if (Math.abs(sx) > 1e-4 || Math.abs(sy) > 1e-4) {
        const tanHalfV = Math.tan((fov * Math.PI) / 360)
        const tanHalfH = tanHalfV * Math.max(0.25, aspect)
        // sx < 0 表示把目标放在画面左侧，相机应向右偏转（yaw 减小）
        desiredRot.y = wrapAngleRad(desiredRot.y + Math.atan(sx * 2 * tanHalfH))
        // sy > 0 表示把目标放在画面上半部，相机应向下俯视（pitch 减小）
        desiredRot.x = Math.max(
          -Math.PI / 2 + 0.02,
          Math.min(Math.PI / 2 - 0.02, desiredRot.x - Math.atan(sy * 2 * tanHalfV))
        )
      }

      const damping = Math.max(0, cm.aimDamping ?? 0.25)
      if (prevMemory && dt > 0) {
        const diffY = wrapAngleRad(desiredRot.y - prevMemory.rotation.y)
        const diffX = desiredRot.x - prevMemory.rotation.x
        const dzW = Math.max(0, Math.min(0.6, cm.deadZoneWidth ?? 0))
        const dzH = Math.max(0, Math.min(0.6, cm.deadZoneHeight ?? 0))
        const halfFovV = (fov * Math.PI) / 360
        const halfFovH = Math.atan(Math.tan(halfFovV) * Math.max(0.25, aspect))
        const deadYaw = dzW * halfFovH
        const deadPitch = dzH * halfFovV
        const effY = Math.abs(diffY) <= deadYaw ? 0 : diffY - Math.sign(diffY) * deadYaw
        const effX = Math.abs(diffX) <= deadPitch ? 0 : diffX - Math.sign(diffX) * deadPitch
        const alpha = damping > 0 ? 1 - Math.exp((-dt * 8) / Math.max(0.05, damping)) : 1
        rotation = {
          x: prevMemory.rotation.x + effX * alpha,
          y: wrapAngleRad(prevMemory.rotation.y + effY * alpha),
          z: desiredRot.z
        }
      } else {
        rotation = desiredRot
      }

      if (cm.autoFocusPull) {
        const distToAim = Math.hypot(
          aimPoint.x - position.x,
          aimPoint.y - position.y,
          aimPoint.z - position.z
        )
        focusDistance = Number(Math.max(0.3, distToAim).toFixed(2))
      }
    }
  }

  // 记录未叠加高频噪声前的平滑骨架记忆（防止噪声被阻尼反馈放大）
  const memory: CinemachineRuntimeMemory = {
    position: { ...position },
    rotation: { ...rotation },
    time
  }

  // 3. 6DoF 程序化镜头噪声 & Impulse 冲击震屏阶段
  if (cm?.noisePreset && cm.noisePreset !== 'none') {
    if (cm.noisePreset === 'handheld') {
      const shake = evaluateHandheldCameraShake(time, {
        enabled: true,
        intensity: 0.28,
        frequency: 1.15
      })
      position.x += shake.posOffset.x
      position.y += shake.posOffset.y
      position.z += shake.posOffset.z
      rotation.x += shake.rotOffset.x
      rotation.y += shake.rotOffset.y
      rotation.z += shake.rotOffset.z
    } else if (cm.noisePreset === 'telephoto') {
      const w = time * Math.PI * 2 * 2.6
      rotation.x += (Math.sin(w * 1.1) * 0.55 + Math.cos(w * 2.3) * 0.45) * 0.0085
      rotation.y += (Math.cos(w * 0.95) * 0.5 + Math.sin(w * 1.85) * 0.5) * 0.0085
    } else if (cm.noisePreset === 'carMount') {
      const w = time * Math.PI * 2 * 2.4
      position.y += (Math.sin(w) * 0.6 + Math.sin(w * 2.7 + 0.8) * 0.4) * 0.035
      rotation.z += Math.sin(w * 0.8 + 0.4) * 0.012
      rotation.x += Math.cos(w * 1.9) * 0.009
    } else if (cm.noisePreset === 'droneHover') {
      const w = time * Math.PI * 2 * 0.48
      position.x += Math.sin(w) * 0.08
      position.y += Math.cos(w * 1.3 + 0.5) * 0.06
      position.z += Math.sin(w * 0.7 + 1.1) * 0.05
      rotation.z += Math.sin(w * 0.9) * 0.01
    }
  }

  if (cm?.impulseTimeSec != null && Number.isFinite(cm.impulseTimeSec)) {
    const elapsed = time - cm.impulseTimeSec
    if (elapsed >= 0 && elapsed <= 0.85) {
      const amp = Math.max(0, Math.min(2, cm.impulseIntensity ?? 0.6))
      const env = Math.exp(-5.5 * elapsed)
      const wave = Math.sin(elapsed * 38) * env * amp
      position.y += wave * 0.14
      rotation.x += wave * 0.036
      rotation.z += Math.cos(elapsed * 29) * env * amp * 0.024
    }
  }

  return {
    viewer: {
      ...baseViewer,
      position,
      rotation,
      target,
      fov,
      focalLengthMm: fovToFocalLengthMm(fov),
      ...(focusDistance != null ? { focusDistance } : {})
    },
    memory
  }
}

/**
 * 在两台虚拟相机的 Viewer 状态之间按权重 weight ∈ [0, 1] 进行 Cinemachine Brain 平滑混合插值
 */
export function blendDirectorViewerStates(
  fromViewer: DirectorViewerState,
  toViewer: DirectorViewerState,
  weight: number
): DirectorViewerState {
  const w = Math.max(0, Math.min(1, weight))
  if (w <= 1e-5) return { ...fromViewer }
  if (w >= 1 - 1e-5) return { ...toViewer }

  const rotA =
    fromViewer.rotation ?? directorViewerRotationFromLook(fromViewer.position, fromViewer.target)
  const rotB =
    toViewer.rotation ?? directorViewerRotationFromLook(toViewer.position, toViewer.target)
  const position = lerpVec3(fromViewer.position, toViewer.position, w)
  const target = lerpVec3(fromViewer.target, toViewer.target, w)
  const rotation = lerpEulerShortest(rotA, rotB, w)
  const fov = lerpNumber(
    fromViewer.fov ?? DEFAULT_DIRECTOR_CAMERA_FOV,
    toViewer.fov ?? DEFAULT_DIRECTOR_CAMERA_FOV,
    w
  )

  const distA =
    fromViewer.focusDistance ??
    Math.max(
      0.5,
      Math.hypot(
        fromViewer.target.x - fromViewer.position.x,
        fromViewer.target.y - fromViewer.position.y,
        fromViewer.target.z - fromViewer.position.z
      )
    )
  const distB =
    toViewer.focusDistance ??
    Math.max(
      0.5,
      Math.hypot(
        toViewer.target.x - toViewer.position.x,
        toViewer.target.y - toViewer.position.y,
        toViewer.target.z - toViewer.position.z
      )
    )
  const hasFocus = fromViewer.focusDistance != null || toViewer.focusDistance != null
  const focusDistance = hasFocus ? Number(lerpNumber(distA, distB, w).toFixed(2)) : undefined

  const hasAperture = fromViewer.aperture != null || toViewer.aperture != null
  const aperture = hasAperture
    ? Number(lerpNumber(fromViewer.aperture ?? 8, toViewer.aperture ?? 8, w).toFixed(2))
    : undefined

  return {
    ...toViewer,
    position,
    rotation,
    target,
    fov,
    focalLengthMm: fovToFocalLengthMm(fov),
    ...(focusDistance != null ? { focusDistance } : {}),
    ...(aperture != null ? { aperture } : {})
  }
}

export interface CinemachineBrainSegmentInput {
  id: string
  cameraId: string
  start: number
  end: number
  blendInSec?: number
  blendCurve?: DirectorKeyframeEasing
}

export interface CinemachineBrainCutEvaluation {
  activeCameraId: string
  activeSegmentId: string
  fromCameraId?: string
  previousCameraId?: string
  blendWeight: number
  viewer: DirectorViewerState
}

/**
 * Cinemachine Brain 机位轨混合求解器：
 * - 当时间处于当前镜头片段开头的 `blendInSec` 窗口（或与前一片段交叠窗口）时，
 *   自动实时混合前一机位与当前机位的解算姿态（Position + Rotation + FOV + DOF FocusDistance）。
 */
export function solveCinemachineBrainCutAtTime(
  segments: ReadonlyArray<CinemachineBrainSegmentInput>,
  time: number,
  resolveCameraViewer?: (cameraId: string) => DirectorViewerState | undefined
): CinemachineBrainCutEvaluation | null {
  if (!segments.length) return null
  const sorted = [...segments].sort((a, b) => a.start - b.start)
  let activeIdx = -1
  for (let i = sorted.length - 1; i >= 0; i--) {
    const s = sorted[i]!
    if (time >= s.start - 1e-6 && time < s.end + 1e-6) {
      activeIdx = i
      break
    }
  }
  if (activeIdx < 0) return null

  const activeSeg = sorted[activeIdx]!
  const fallbackViewer: DirectorViewerState = {
    position: { x: 0, y: 1.5, z: 4 },
    target: { x: 0, y: 1, z: 0 },
    fov: DEFAULT_DIRECTOR_CAMERA_FOV
  }
  const toViewer = resolveCameraViewer ? resolveCameraViewer(activeSeg.cameraId) : fallbackViewer
  if (!toViewer) return null

  if (activeIdx > 0) {
    const prevSeg = sorted[activeIdx - 1]!
    if (prevSeg.cameraId !== activeSeg.cameraId) {
      const overlapDur = Math.max(0, prevSeg.end - activeSeg.start)
      const explicitBlend = Math.max(0, activeSeg.blendInSec ?? 0)
      const blendDuration = Math.min(
        Math.max(0.01, activeSeg.end - activeSeg.start),
        Math.max(overlapDur, explicitBlend)
      )
      const elapsedInSeg = Math.max(0, time - activeSeg.start)
      if (blendDuration > 1e-4 && elapsedInSeg < blendDuration) {
        const fromViewer = resolveCameraViewer
          ? resolveCameraViewer(prevSeg.cameraId)
          : fallbackViewer
        if (fromViewer) {
          const rawT = elapsedInSeg / blendDuration
          const weight = evaluateKeyframeEasing(rawT, activeSeg.blendCurve ?? 'easeInOut')
          return {
            activeCameraId: activeSeg.cameraId,
            activeSegmentId: activeSeg.id,
            fromCameraId: prevSeg.cameraId,
            previousCameraId: prevSeg.cameraId,
            blendWeight: weight,
            viewer: blendDirectorViewerStates(fromViewer, toViewer, weight)
          }
        }
      }
    }
  }

  return {
    activeCameraId: activeSeg.cameraId,
    activeSegmentId: activeSeg.id,
    blendWeight: 1,
    viewer: toViewer
  }
}
