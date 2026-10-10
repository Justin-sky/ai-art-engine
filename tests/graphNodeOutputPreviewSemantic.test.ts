import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 输出预览的语义时间线分支：组件在 node 环境渲染不了（无 jsdom），
 * 用源码守卫钉住「跑完不能是一片空白」。
 */
describe('GraphNodeOutputPreview semanticTimeline', () => {
  const source = readFileSync(
    join(process.cwd(), 'src/renderer/src/components/GraphNodeOutputPreview.vue'),
    'utf8'
  )
  it('有 semanticTimeline 分支且用摘要函数（不塞整份 JSON）', () => {
    expect(source).toContain("value.kind === 'semanticTimeline'")
    expect(source).toContain('semanticTimelineSummaryText(value)')
    expect(source).not.toContain(
      "into.push({ key: `semanticTimeline:${value.doc?.id ?? ''}`, kind: 'text', text: value.text })"
    )
  })
})
