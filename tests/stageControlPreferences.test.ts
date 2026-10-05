/**
 * 3D 视口（导演台）操控灵敏度。
 *
 * 这几个值原本是**写死在 `useDirectorStageScene.ts` 里的常数**，用户无从调节。
 * 现在放进 `AppSettings.editor.stage`，由设置 → 通用里的 5 个滑块驱动。
 *
 * 两条最容易出错的地方，这里各钉一条：
 * 1. **默认值必须等于当年的写死值**（0.0022 / 5 / 1 / 1 / 1）——
 *    否则老用户升级后手感会莫名变化；
 * 2. **滑块范围与读盘钳制必须是同一份来源**（`STAGE_CONTROL_RANGES`）——
 *    否则滑块拖得到的地方会被归一化悄悄改回去，表现为「拖了没反应」。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SETTINGS,
  STAGE_CONTROL_DEFAULTS,
  STAGE_CONTROL_RANGES,
  normalizeStageControls
} from '../src/shared/domain'

describe('normalizeStageControls', () => {
  it('缺字段 / 空值 / 非对象一律回退默认', () => {
    expect(normalizeStageControls(undefined)).toEqual(STAGE_CONTROL_DEFAULTS)
    expect(normalizeStageControls({})).toEqual(STAGE_CONTROL_DEFAULTS)
    // 只有部分字段时，其它字段仍取默认（不能变成 undefined）
    expect(normalizeStageControls({ flyMoveSpeed: 12 })).toEqual({
      ...STAGE_CONTROL_DEFAULTS,
      flyMoveSpeed: 12
    })
  })

  it('默认值等于历史写死的手感（升级后不变）', () => {
    expect(STAGE_CONTROL_DEFAULTS).toEqual({
      flyLookSpeed: 0.0022,
      flyMoveSpeed: 5,
      orbitRotateSpeed: 1,
      orbitPanSpeed: 1,
      orbitZoomSpeed: 1
    })
    expect(DEFAULT_SETTINGS.editor.stage).toEqual(STAGE_CONTROL_DEFAULTS)
  })

  it('越界值钳到区间内（脏 settings.json 不该让视口拖不动或飞到失控）', () => {
    const clamped = normalizeStageControls({
      flyLookSpeed: 999,
      flyMoveSpeed: -5,
      orbitRotateSpeed: 100,
      orbitPanSpeed: 0,
      orbitZoomSpeed: 0.0001
    })
    for (const key of Object.keys(STAGE_CONTROL_RANGES) as Array<
      keyof typeof STAGE_CONTROL_RANGES
    >) {
      const { min, max } = STAGE_CONTROL_RANGES[key]
      expect(clamped[key], key).toBeGreaterThanOrEqual(min)
      expect(clamped[key], key).toBeLessThanOrEqual(max)
    }
    // 越界值必须真的被改掉，而不是原样留下
    expect(clamped.flyLookSpeed).toBe(STAGE_CONTROL_RANGES.flyLookSpeed.max)
    expect(clamped.flyMoveSpeed).toBe(STAGE_CONTROL_RANGES.flyMoveSpeed.min)
    expect(clamped.orbitRotateSpeed).toBe(STAGE_CONTROL_RANGES.orbitRotateSpeed.max)
    expect(clamped.orbitPanSpeed).toBe(STAGE_CONTROL_RANGES.orbitPanSpeed.min)
  })

  it('NaN / 非数字回退默认（不能把 speed 变成 NaN —— 那会让视口彻底不动）', () => {
    const out = normalizeStageControls({
      flyLookSpeed: Number.NaN,
      flyMoveSpeed: 'fast' as unknown as number,
      orbitRotateSpeed: null as unknown as number
    })
    expect(out.flyLookSpeed).toBe(STAGE_CONTROL_DEFAULTS.flyLookSpeed)
    expect(out.flyMoveSpeed).toBe(STAGE_CONTROL_DEFAULTS.flyMoveSpeed)
    expect(out.orbitRotateSpeed).toBe(STAGE_CONTROL_DEFAULTS.orbitRotateSpeed)
    // 全部是有限数
    for (const value of Object.values(out)) expect(Number.isFinite(value)).toBe(true)
  })

  /**
   * `Number(null)` 与 `Number('')` 都是 0（有限数），所以「先转换再判有限性」的写法
   * 会把缺字段当成「用户想要最低速度」而钳到 0.2 —— 表现为视口慢得几乎不动。
   * 这条钉住「缺字段必须回退默认」。
   */
  it('null / 空串 / 布尔等非数字一律回退默认，而不是被当成 0 钳到最低', () => {
    const out = normalizeStageControls({
      flyLookSpeed: null as unknown as number,
      flyMoveSpeed: '' as unknown as number,
      orbitRotateSpeed: false as unknown as number,
      orbitPanSpeed: undefined,
      orbitZoomSpeed: Number.POSITIVE_INFINITY
    })
    expect(out).toEqual(STAGE_CONTROL_DEFAULTS)
  })

  it('合法值原样保留（不因归一化被改动）', () => {
    const custom = {
      flyLookSpeed: 0.005,
      flyMoveSpeed: 20,
      orbitRotateSpeed: 1.7,
      orbitPanSpeed: 0.4,
      orbitZoomSpeed: 2.9
    }
    expect(normalizeStageControls(custom)).toEqual(custom)
  })
})

/**
 * 源码级守卫：灵敏度必须**从设置读**，不能再退回写死的常量。
 *
 * 这条是给未来改这段代码的人看的：只要有人为了省事把 `stageControls.value` 换回
 * 模块级常量，滑块就会变成装饰品（拖了没反应，而且不会有任何报错）。
 */
describe('导演台读的是设置而不是写死常量', () => {
  const scene = readFileSync('src/renderer/src/features/director/useDirectorStageScene.ts', 'utf8')

  it('飞行转向与移动速度取自 stageControls', () => {
    expect(scene).toContain('stageControls.value.flyLookSpeed')
    expect(scene).toContain('stageControls.value.flyMoveSpeed')
    // 旧的两个写死常量必须已经不存在
    expect(scene).not.toContain('FLY_LOOK_SPEED =')
    expect(scene).not.toContain('FLY_MOVE_SPEED =')
  })

  it('OrbitControls 的三个速度被写入，且偏好变化时会同步', () => {
    expect(scene).toContain('target.rotateSpeed = stageControls.value.orbitRotateSpeed')
    expect(scene).toContain('target.panSpeed = stageControls.value.orbitPanSpeed')
    expect(scene).toContain('target.zoomSpeed = stageControls.value.orbitZoomSpeed')
    // 建好控制器时要应用一次，之后靠 watch 同步（否则要重开视口才生效）
    expect(scene).toContain('applyStageControlSpeeds(orbit)')
    expect(scene).toMatch(/watch\([\s\S]{0,400}applyStageControlSpeeds\(orbit\)/)
  })

  it('设置页的滑块范围与读盘钳制共用 STAGE_CONTROL_RANGES', () => {
    const view = readFileSync('src/renderer/src/views/SettingsView.vue', 'utf8')
    expect(view).toContain('STAGE_CONTROL_RANGES[key]')
    expect(view).toContain('STAGE_CONTROL_DEFAULTS')
    expect(view).toContain('form.editor.stage[item.key]')
  })

  it('落盘前也做钳制（主进程侧不能只信渲染层的值）', () => {
    const service = readFileSync('src/main/services/settingsService.ts', 'utf8')
    expect(service).toContain('stage: normalizeStageControls(settings.editor?.stage)')
    // get() 那条路（读盘）同样要钳，否则手改过的 settings.json 脏值直接进渲染层
    expect(service).toContain('stage: normalizeStageControls(saved.editor?.stage)')
  })
})
