/**
 * 专业导演机位预设：景别 + 角度一键套用到当前/活动相机。
 * 以「选中物体」为主体，按其世界包围盒高度与朝向自动取景（无选中时用舞台中心 + 平均身高）。
 */

export interface DirectorShotCameraPreset {
  id: string
  labelKey: string
  group: 'shotSize' | 'angle'
  /** 取景高度 = 主体高度 × 该系数（决定相机距离） */
  frameFactor: number
  /** 取景目标点在主体高度内的比例：0=脚底，1=头顶，默认 0.5 */
  frameBias?: number
  /** 相机相对取景目标的高度偏移（单位：主体高度；负数=低机位仰拍，正数=高机位俯拍） */
  cameraHeightBias?: number
  /** 水平方位角（相对主体朝向）：0=正面，45=四分之三，90=侧面，135=后四分之三，180=背面 */
  azimuthDeg: number
  /** 荷兰角滚动（度） */
  rollDeg?: number
  /** 相机 FOV（度）；缺省用导演台默认 */
  fov?: number
}

/** 组合机位中的单台相机定义（A/B/C 为选中物体下前三个模型子物体） */
export interface DirectorComboCameraDef {
  /** 相机名 i18n key */
  nameKey: string
  /** 相机锚点：A/B/C=主体，mid=A-B 中点，abc=三点中心 */
  anchor: 'A' | 'B' | 'C' | 'mid' | 'abc'
  /** 相机相对锚点沿 A→B 轴偏移（主体高度 × 系数；负=偏向 A 侧，正=偏向 B 侧；环绕机位可省） */
  alongFactor?: number
  /** 垂直轴线侧移（主体高度 × 系数；全部相机同一符号 → 保持 180° 轴线同侧；环绕机位可省） */
  sideFactor?: number
  /** 相机高度相对取景目标偏移（主体高度 × 系数；负=低机位） */
  heightFactor: number
  /** 取景目标：A / B / C / mid / abc */
  target: 'A' | 'B' | 'C' | 'mid' | 'abc'
  /** 取景目标高度在主体高度内比例（0=脚底，1=头顶） */
  targetBias: number
  /** 环绕角（度）：以锚点为圆心按水平角放置相机（与 along/side 二选一） */
  orbitAngleDeg?: number
  /** 环绕半径（主体高度 × 系数；缺省 2） */
  orbitDistanceFactor?: number
  /** 荷兰角（度） */
  rollDeg?: number
}

export interface DirectorComboCameraPreset {
  id: string
  labelKey: string
  group: 'combination'
  /** 至少需要的模型子物体数 */
  minSubjects: number
  cameras: DirectorComboCameraDef[]
}

export const DIRECTOR_SHOT_CAMERA_PRESETS: readonly DirectorShotCameraPreset[] = [
  // 景别（frameFactor 越大画面越远）
  { id: 'shot.extreme-wide', labelKey: 'director.stage.cameraPreset.extremeWide', group: 'shotSize', frameFactor: 6, frameBias: 0.45, azimuthDeg: 0 },
  { id: 'shot.long', labelKey: 'director.stage.cameraPreset.long', group: 'shotSize', frameFactor: 4, frameBias: 0.5, azimuthDeg: 0 },
  { id: 'shot.full', labelKey: 'director.stage.cameraPreset.full', group: 'shotSize', frameFactor: 2.2, frameBias: 0.55, azimuthDeg: 0 },
  { id: 'shot.medium', labelKey: 'director.stage.cameraPreset.medium', group: 'shotSize', frameFactor: 1.4, frameBias: 0.6, azimuthDeg: 0 },
  { id: 'shot.medium-close', labelKey: 'director.stage.cameraPreset.mediumClose', group: 'shotSize', frameFactor: 1.0, frameBias: 0.65, azimuthDeg: 0 },
  { id: 'shot.close', labelKey: 'director.stage.cameraPreset.close', group: 'shotSize', frameFactor: 0.7, frameBias: 0.7, azimuthDeg: 0 },
  { id: 'shot.close-up', labelKey: 'director.stage.cameraPreset.closeUp', group: 'shotSize', frameFactor: 0.4, frameBias: 0.78, azimuthDeg: 0 },
  { id: 'shot.extreme-close-up', labelKey: 'director.stage.cameraPreset.extremeCloseUp', group: 'shotSize', frameFactor: 0.22, frameBias: 0.8, azimuthDeg: 0 },
  // 角度（默认中景取景，强调机位高度/方位）
  { id: 'angle.eye-level', labelKey: 'director.stage.cameraPreset.eyeLevel', group: 'angle', frameFactor: 1.4, frameBias: 0.6, cameraHeightBias: 0, azimuthDeg: 0 },
  { id: 'angle.low', labelKey: 'director.stage.cameraPreset.low', group: 'angle', frameFactor: 1.2, frameBias: 0.6, cameraHeightBias: -0.5, azimuthDeg: 0 },
  { id: 'angle.high', labelKey: 'director.stage.cameraPreset.high', group: 'angle', frameFactor: 1.5, frameBias: 0.6, cameraHeightBias: 0.6, azimuthDeg: 0 },
  { id: 'angle.bird', labelKey: 'director.stage.cameraPreset.bird', group: 'angle', frameFactor: 2.2, frameBias: 0.5, cameraHeightBias: 2.2, azimuthDeg: 0 },
  { id: 'angle.dutch', labelKey: 'director.stage.cameraPreset.dutch', group: 'angle', frameFactor: 1.3, frameBias: 0.6, cameraHeightBias: 0, azimuthDeg: 0, rollDeg: 12 },
  { id: 'angle.over-shoulder', labelKey: 'director.stage.cameraPreset.overShoulder', group: 'angle', frameFactor: 1.0, frameBias: 0.65, cameraHeightBias: 0, azimuthDeg: 25 },
  { id: 'angle.three-quarter', labelKey: 'director.stage.cameraPreset.threeQuarter', group: 'angle', frameFactor: 1.3, frameBias: 0.6, cameraHeightBias: 0, azimuthDeg: 45 },
  { id: 'angle.profile', labelKey: 'director.stage.cameraPreset.profile', group: 'angle', frameFactor: 1.3, frameBias: 0.6, cameraHeightBias: 0, azimuthDeg: 90 },
  { id: 'angle.back', labelKey: 'director.stage.cameraPreset.back', group: 'angle', frameFactor: 1.3, frameBias: 0.6, cameraHeightBias: 0, azimuthDeg: 180 }
]

/**
 * 组合机位：对话/双人场面的多机位套路。
 * 全部相机放在 A→B 轴线的同一侧（sideFactor 同号），保持 180° 法则与视线方向一致。
 */
export const DIRECTOR_COMBO_CAMERA_PRESETS: readonly DirectorComboCameraPreset[] = [
  {
    id: 'combo.reverse-shot',
    labelKey: 'director.stage.cameraPreset.comboReverse',
    group: 'combination',
    minSubjects: 2,
    cameras: [
      {
        nameKey: 'director.stage.cameraPreset.comboOtsAB',
        anchor: 'A',
        alongFactor: -0.55,
        sideFactor: 0.42,
        heightFactor: 0.1,
        target: 'B',
        targetBias: 0.7
      },
      {
        nameKey: 'director.stage.cameraPreset.comboOtsBA',
        anchor: 'B',
        alongFactor: 0.55,
        sideFactor: 0.42,
        heightFactor: 0.1,
        target: 'A',
        targetBias: 0.7
      }
    ]
  },
  {
    id: 'combo.three-shot',
    labelKey: 'director.stage.cameraPreset.comboThree',
    group: 'combination',
    minSubjects: 2,
    cameras: [
      {
        nameKey: 'director.stage.cameraPreset.comboMaster',
        anchor: 'mid',
        alongFactor: 0,
        sideFactor: 2.4,
        heightFactor: 0.25,
        target: 'mid',
        targetBias: 0.55
      },
      {
        nameKey: 'director.stage.cameraPreset.comboOtsAB',
        anchor: 'A',
        alongFactor: -0.55,
        sideFactor: 0.42,
        heightFactor: 0.1,
        target: 'B',
        targetBias: 0.7
      },
      {
        nameKey: 'director.stage.cameraPreset.comboCloseB',
        anchor: 'B',
        alongFactor: -0.7,
        sideFactor: 0.3,
        heightFactor: 0,
        target: 'B',
        targetBias: 0.8
      }
    ]
  },
  {
    id: 'combo.axis-rule',
    labelKey: 'director.stage.cameraPreset.comboAxis',
    group: 'combination',
    minSubjects: 2,
    cameras: [
      // 标准五机位（轴线法则）：全景双人 + 双向过肩 + 双人特写，全部位于轴线同侧
      {
        nameKey: 'director.stage.cameraPreset.comboMaster',
        anchor: 'mid',
        alongFactor: 0,
        sideFactor: 2.4,
        heightFactor: 0.25,
        target: 'mid',
        targetBias: 0.55
      },
      {
        nameKey: 'director.stage.cameraPreset.comboOtsAB',
        anchor: 'A',
        alongFactor: -0.55,
        sideFactor: 0.42,
        heightFactor: 0.1,
        target: 'B',
        targetBias: 0.7
      },
      {
        nameKey: 'director.stage.cameraPreset.comboOtsBA',
        anchor: 'B',
        alongFactor: 0.55,
        sideFactor: 0.42,
        heightFactor: 0.1,
        target: 'A',
        targetBias: 0.7
      },
      {
        nameKey: 'director.stage.cameraPreset.comboCloseA',
        anchor: 'A',
        alongFactor: 0.7,
        sideFactor: 0.3,
        heightFactor: 0,
        target: 'A',
        targetBias: 0.8
      },
      {
        nameKey: 'director.stage.cameraPreset.comboCloseB',
        anchor: 'B',
        alongFactor: -0.7,
        sideFactor: 0.3,
        heightFactor: 0,
        target: 'B',
        targetBias: 0.8
      }
    ]
  },
  {
    id: 'combo.interview',
    labelKey: 'director.stage.cameraPreset.comboInterview',
    group: 'combination',
    minSubjects: 2,
    cameras: [
      {
        nameKey: 'director.stage.cameraPreset.comboMaster',
        anchor: 'mid',
        alongFactor: 0,
        sideFactor: 2.4,
        heightFactor: 0.25,
        target: 'mid',
        targetBias: 0.55
      },
      {
        nameKey: 'director.stage.cameraPreset.comboCloseA',
        anchor: 'A',
        alongFactor: 0.6,
        sideFactor: 0.3,
        heightFactor: 0,
        target: 'A',
        targetBias: 0.8
      }
    ]
  },
  {
    id: 'combo.eyeline-closeups',
    labelKey: 'director.stage.cameraPreset.comboEyeline',
    group: 'combination',
    minSubjects: 2,
    cameras: [
      {
        nameKey: 'director.stage.cameraPreset.comboCloseA',
        anchor: 'A',
        alongFactor: 0.55,
        sideFactor: 0.25,
        heightFactor: 0,
        target: 'A',
        targetBias: 0.85
      },
      {
        nameKey: 'director.stage.cameraPreset.comboCloseB',
        anchor: 'B',
        alongFactor: -0.55,
        sideFactor: 0.25,
        heightFactor: 0,
        target: 'B',
        targetBias: 0.85
      }
    ]
  },
  {
    id: 'combo.orbit-trio',
    labelKey: 'director.stage.cameraPreset.comboOrbit',
    group: 'combination',
    minSubjects: 1,
    cameras: [
      {
        nameKey: 'director.stage.cameraPreset.comboOrbitName',
        anchor: 'mid',
        orbitAngleDeg: 0,
        orbitDistanceFactor: 2.6,
        heightFactor: 0.25,
        target: 'mid',
        targetBias: 0.55
      },
      {
        nameKey: 'director.stage.cameraPreset.comboOrbitName',
        anchor: 'mid',
        orbitAngleDeg: 120,
        orbitDistanceFactor: 2.6,
        heightFactor: 0.25,
        target: 'mid',
        targetBias: 0.55
      },
      {
        nameKey: 'director.stage.cameraPreset.comboOrbitName',
        anchor: 'mid',
        orbitAngleDeg: 240,
        orbitDistanceFactor: 2.6,
        heightFactor: 0.25,
        target: 'mid',
        targetBias: 0.55
      }
    ]
  },
  {
    id: 'combo.three-way',
    labelKey: 'director.stage.cameraPreset.comboThreeWay',
    group: 'combination',
    minSubjects: 3,
    cameras: [
      {
        nameKey: 'director.stage.cameraPreset.comboMaster3',
        anchor: 'abc',
        alongFactor: 0,
        sideFactor: 2.8,
        heightFactor: 0.25,
        target: 'abc',
        targetBias: 0.55
      },
      {
        nameKey: 'director.stage.cameraPreset.comboOtsAB',
        anchor: 'A',
        alongFactor: -0.55,
        sideFactor: 0.42,
        heightFactor: 0.1,
        target: 'B',
        targetBias: 0.7
      },
      {
        nameKey: 'director.stage.cameraPreset.comboOtsBC',
        anchor: 'B',
        alongFactor: -0.55,
        sideFactor: 0.42,
        heightFactor: 0.1,
        target: 'C',
        targetBias: 0.7
      },
      {
        nameKey: 'director.stage.cameraPreset.comboOtsCA',
        anchor: 'C',
        alongFactor: -0.55,
        sideFactor: 0.42,
        heightFactor: 0.1,
        target: 'A',
        targetBias: 0.7
      }
    ]
  },
  {
    id: 'combo.stage-trio',
    labelKey: 'director.stage.cameraPreset.comboStageTrio',
    group: 'combination',
    minSubjects: 1,
    cameras: [
      {
        nameKey: 'director.stage.cameraPreset.comboStageWide',
        anchor: 'mid',
        orbitAngleDeg: 0,
        orbitDistanceFactor: 2.8,
        heightFactor: 0.2,
        target: 'mid',
        targetBias: 0.5
      },
      {
        nameKey: 'director.stage.cameraPreset.comboStageLeft',
        anchor: 'mid',
        orbitAngleDeg: 120,
        orbitDistanceFactor: 1.3,
        heightFactor: 0,
        target: 'mid',
        targetBias: 0.75
      },
      {
        nameKey: 'director.stage.cameraPreset.comboStageRight',
        anchor: 'mid',
        orbitAngleDeg: 240,
        orbitDistanceFactor: 1.3,
        heightFactor: 0,
        target: 'mid',
        targetBias: 0.75
      }
    ]
  },
  {
    id: 'combo.stage-quint',
    labelKey: 'director.stage.cameraPreset.comboStageQuint',
    group: 'combination',
    minSubjects: 1,
    cameras: [
      {
        nameKey: 'director.stage.cameraPreset.comboStageWide',
        anchor: 'mid',
        orbitAngleDeg: 0,
        orbitDistanceFactor: 3.0,
        heightFactor: 0.25,
        target: 'mid',
        targetBias: 0.5
      },
      {
        nameKey: 'director.stage.cameraPreset.comboStageLeft',
        anchor: 'mid',
        orbitAngleDeg: 108,
        orbitDistanceFactor: 1.3,
        heightFactor: 0,
        target: 'mid',
        targetBias: 0.75
      },
      {
        nameKey: 'director.stage.cameraPreset.comboStageRight',
        anchor: 'mid',
        orbitAngleDeg: 252,
        orbitDistanceFactor: 1.3,
        heightFactor: 0,
        target: 'mid',
        targetBias: 0.75
      },
      {
        nameKey: 'director.stage.cameraPreset.comboStageLow',
        anchor: 'mid',
        orbitAngleDeg: 180,
        orbitDistanceFactor: 2.2,
        heightFactor: -0.8,
        target: 'mid',
        targetBias: 0.7
      },
      {
        nameKey: 'director.stage.cameraPreset.comboStageHigh',
        anchor: 'mid',
        orbitAngleDeg: 90,
        orbitDistanceFactor: 2.5,
        heightFactor: 0.9,
        target: 'mid',
        targetBias: 0.4
      }
    ]
  }
]

export function findDirectorShotCameraPreset(
  id: string
): DirectorShotCameraPreset | undefined {
  return DIRECTOR_SHOT_CAMERA_PRESETS.find((p) => p.id === id)
}

export function findDirectorComboCameraPreset(
  id: string
): DirectorComboCameraPreset | undefined {
  return DIRECTOR_COMBO_CAMERA_PRESETS.find((p) => p.id === id)
}
