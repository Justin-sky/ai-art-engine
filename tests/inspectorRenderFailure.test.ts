import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 「选中语义修复节点，inspector 没有显示」的守卫。
 *
 * 机制：检查器（含子组件 GraphNodeOutputPreview）在渲染时抛错 → Vue 把该子树留空 →
 * 用户只看到**空白**。`InspectorPanel` 本来就有 onErrorCaptured，但只 console.error，
 * 面板上没有任何提示 —— 所以两件事都要钉住：
 *   1. 面板必须把失败原因**显示出来**（并有 .inspector-error 样式）；
 *   2. 输出预览里对运行输出字段的访问必须**不假设类型**（失败/锁定/旧状态的值字段会缺）。
 */
const panel = readFileSync(
  join(process.cwd(), 'src/renderer/src/components/InspectorPanel.vue'),
  'utf8'
)
const preview = readFileSync(
  join(process.cwd(), 'src/renderer/src/components/GraphNodeOutputPreview.vue'),
  'utf8'
)

describe('检查器渲染失败的可见性', () => {
  it('InspectorPanel 把子组件错误显示到面板上，并在切换目标时清空', () => {
    expect(panel).toContain('const childError = ref(')
    expect(panel).toMatch(/onErrorCaptured\(\(err\) => \{[\s\S]{0,300}?childError\.value =/)
    expect(panel).toMatch(/<div v-if="childError" class="inspector-error">/)
    expect(panel).toContain("t('graph.inspector.renderFailed')")
    expect(panel).toContain('.inspector-error {')
    // 换选中目标要清掉旧错误
    expect(panel).toMatch(/const epoch = \+\+mountEpoch\n\s*\/\/[^\n]*\n\s*childError\.value = ''/)
  })

  it('输出预览不假设运行输出的字段类型（缺字段不能抛）', () => {
    // 先剥掉注释：解释性文字会引用旧写法，不该被当成"代码里还在用"
    const code = preview.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    // 曾经的崩点：直接 trim 运行输出的 text 字段 / 直接 entries() 可能缺失的数组
    expect(code).not.toMatch(/(value|note)\.text\.trim\(\)/)
    expect(code).not.toMatch(/value\.items\.entries\(\)/)
    expect(code).not.toMatch(/value\.notes\.entries\(\)/)
    expect(preview).toContain('function nonEmptyText(')
    expect(preview).toContain("typeof value === 'string' && value.trim().length > 0")
    expect(preview).toMatch(/nonEmptyText\(value\.text\)/)
    expect(preview).toMatch(/\(value\.items \?\? \[\]\)\.entries\(\)/)
    expect(preview).toMatch(
      /\(value\.notes \?\? \[\]\)\.some\(\(note\) => nonEmptyText\(note\?\.text\)\)/
    )
  })
})
