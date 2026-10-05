import {
  STAGE_CONTROL_DEFAULTS,
  STAGE_CONTROL_RANGES,
  type StageControlPreferences
} from '@shared/domain'

/** 设置页与导演台浮层共用的滑块条目（顺序即展示顺序） */
export interface StageControlItem {
  key: keyof StageControlPreferences
  labelKey: string
  min: number
  max: number
  step: number
}

/**
 * 3D 视口操控灵敏度的滑块定义。
 *
 * **一处定义、两处渲染**（设置 → 通用，以及导演台视口工具栏的浮层）——
 * 复制两份的话，加一项或改范围时必然漏掉一处。
 */
export const STAGE_CONTROL_ITEMS: readonly StageControlItem[] = (
  [
    ['flyLookSpeed', 'settings.stageControls.flyLook'],
    ['flyMoveSpeed', 'settings.stageControls.flyMove'],
    ['orbitRotateSpeed', 'settings.stageControls.orbitRotate'],
    ['orbitPanSpeed', 'settings.stageControls.orbitPan'],
    ['orbitZoomSpeed', 'settings.stageControls.orbitZoom']
  ] as const
).map(([key, labelKey]) => ({ key, labelKey, ...STAGE_CONTROL_RANGES[key] }))

/** 显示当前档位：飞行转向量级很小，直接显示会是一串 0 */
export function formatStageControlValue(key: keyof StageControlPreferences, value: number): string {
  if (key === 'flyLookSpeed') return value.toFixed(4)
  return Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1)
}

/** 默认值（「恢复默认」按钮用；与当年的写死值一致） */
export function defaultStageControls(): StageControlPreferences {
  return { ...STAGE_CONTROL_DEFAULTS }
}
