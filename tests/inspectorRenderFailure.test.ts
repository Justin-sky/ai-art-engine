import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 「选中语义节点，inspector 没有显示」的守卫。
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
const inspector = readFileSync(
  join(process.cwd(), 'src/renderer/src/components/SemanticTimelineInspector.vue'),
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

  /**
   * 检查器脚本里的**声明顺序**与**唯一性**。
   *
   * 实测踩到两次：
   * 1. 把用 `timelineDoc` 的 computed / `watch(immediate)` 写在 `const timelineDoc` **之前**
   *    → setup 阶段就抛 `Cannot access 'timelineDoc' before initialization`（TDZ）→ 面板空白；
   * 2. 搬移代码时**插入重复块**（同一段出现两次）→ 同一个 ref 被声明两遍。
   * 这两类都逃得过 typecheck（引用在回调里，TS 认为调用时机未知），所以用源码守卫钉住。
   */
  it('依赖 timelineDoc 的实现必须在它声明之后，且各声明只出现一次', () => {
    const script = inspector.slice(inspector.indexOf('<script setup'))
    const withoutComments = script.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

    const declIndex = (name: string): number => withoutComments.indexOf(`const ${name} =`)
    /**
     * 全文**第一次**出现该标识符的位置（跳过声明语句里那一次）。
     *
     * 注意不能用"声明之后的第一次用法"来比较 —— 那样断言恒真（之前的写法就是这个问题，
     * 靠变异验证才发现：把用法插到声明之前依然绿）。
     */
    const firstUse = (name: string): number => {
      const re = new RegExp(`\\b${name}\\b`, 'g')
      let m: RegExpExecArray | null
      while ((m = re.exec(withoutComments))) {
        const before = withoutComments.slice(Math.max(0, m.index - 8), m.index)
        if (/const\s$/.test(before)) continue // 声明本身
        return m.index
      }
      return -1
    }

    for (const name of ['timelineDoc', 'upstreamTimelineJson', 'node']) {
      expect(declIndex(name), `${name} 应该有声明`).toBeGreaterThan(-1)
      const use = firstUse(name)
      if (use >= 0) {
        expect(use, `${name} 的第一次使用必须在声明之后（否则 TDZ → 面板空白）`).toBeGreaterThan(
          declIndex(name)
        )
      }
    }

    // 时间线摘要那几个必须还在，且只能声明一次（防止搬移时插出重复块）
    for (const name of ['timelineSummary', 'runOutText', 'timelineDoc']) {
      const hits = withoutComments.split(`const ${name} =`).length - 1
      expect(hits, `${name} 必须存在且只能声明一次（重复块会导致同名重复声明）`).toBe(1)
    }
    // 只服务已删节点（语义事件 / 语义编辑 / 语义变体）的那几块不该再留在检查器里
    for (const name of [
      'planShots',
      'planPreviewResult',
      'planSummary',
      'planError',
      'planNeedsEvidence',
      'editsJson',
      'pickedEventLabels',
      'eventLabelOptions',
      'recipeSlots'
    ]) {
      const hits = withoutComments.split(`const ${name} =`).length - 1
      expect(hits, `${name} 属于已删节点，不应留在检查器`).toBe(0)
    }
  })
})
