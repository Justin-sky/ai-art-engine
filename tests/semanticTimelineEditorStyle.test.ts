import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 语义时间线 dive 的轨道尺寸/字号守卫。
 *
 * 需求是「轨道高一点、字大一点」—— 这类纯样式调整最容易被后续改动悄悄改回去
 * （组件在 node 环境渲染不了，测不到计算样式），所以把下限钉在源码里。
 */
const source = readFileSync(
  join(process.cwd(), 'src/renderer/src/components/SemanticTimelineEditor.vue'),
  'utf8'
)

/** 取某个选择器块里的 px 值 */
function pxOf(selector: string, prop: string): number {
  const block = new RegExp(`\\${selector}\\s*\\{([^}]*)\\}`, 's').exec(source)?.[1] ?? ''
  const value = new RegExp(`${prop}\\s*:\\s*(\\d+(?:\\.\\d+)?)px`).exec(block)?.[1]
  expect(value, `${selector} 缺少 ${prop}`).toBeTruthy()
  return Number(value)
}

describe('SemanticTimelineEditor 轨道尺寸与字号', () => {
  it('轨道足够高（≥40px），且块与上下留白加起来正好填满', () => {
    const track = pxOf('.stl-track', 'height')
    const block = pxOf('.stl-block', 'height')
    const top = pxOf('.stl-block', 'top')
    expect(track).toBeGreaterThanOrEqual(40)
    expect(block).toBeGreaterThanOrEqual(28)
    // 5 + 30 + 5 = 40：块不溢出轨道，也不塌在顶部
    expect(top * 2 + block).toBeLessThanOrEqual(track)
  })

  it('轨道上的字号足够大（块文字 ≥13px，标签/刻度 ≥12px）', () => {
    expect(pxOf('.stl-block', 'font-size')).toBeGreaterThanOrEqual(13)
    expect(pxOf('.stl-ent-label', 'font-size')).toBeGreaterThanOrEqual(13)
    expect(pxOf('.stl-tick', 'font-size')).toBeGreaterThanOrEqual(12)
    expect(pxOf('.stl-layer > header', 'font-size')).toBeGreaterThanOrEqual(13)
  })

  it('轨道标签垂直居中（轨道变高后不能还钉在固定 top 上）', () => {
    const label = /\.stl-ent-label\s*\{([^}]*)\}/s.exec(source)?.[1] ?? ''
    expect(label).toContain('top: 50%')
    expect(label).toContain('translateY(-50%)')
  })
})
