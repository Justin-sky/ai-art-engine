import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { sampleSemanticEdit, summarizeSemanticEdits } from '../src/shared/semanticTimeline'
import { resolveBuiltVideoRelativePath } from '../src/renderer/src/features/graph/model/semanticTimelineView'

/**
 * 「完善语义修复节点」这批改动的守卫：
 * 1. 双击优先看**成片**（`out-video` / `out-videos`），不是只看 JSON 计划；
 * 2. 检查器给出**编辑摘要 + 会被丢弃的条目 + 插入示例**（不跑节点就知道填得对不对）。
 */
const card = readFileSync(
  join(process.cwd(), 'src/renderer/src/components/GraphNodeCard.vue'),
  'utf8'
)
const inspector = readFileSync(
  join(process.cwd(), 'src/renderer/src/components/SemanticTimelineInspector.vue'),
  'utf8'
)

describe('语义修复节点完善', () => {
  it('resolveBuiltVideoRelativePath：单条 / 多条 / 空都要正确', () => {
    expect(resolveBuiltVideoRelativePath({ 'out-video': { relativePath: 'Build/a.mp4' } })).toBe(
      'Build/a.mp4'
    )
    expect(
      resolveBuiltVideoRelativePath({
        'out-videos': {
          kind: 'videos',
          // 三条：第一条空路径、目标在中间、最后一条是**另一条**成片 ——
          // 这样"取第一个可用"与"取最后一个"才会得到不同结果（否则测不出取错）
          items: [{ relativePath: '' }, { relativePath: 'B/v1.mp4' }, { relativePath: 'B/v2.mp4' }]
        }
      })
    ).toBe('B/v1.mp4')
    expect(resolveBuiltVideoRelativePath({})).toBeUndefined()
    expect(resolveBuiltVideoRelativePath(null)).toBeUndefined()
    expect(resolveBuiltVideoRelativePath({ 'out-video': { relativePath: '   ' } })).toBeUndefined()
    // 只有计划（文本）时没有成片 → 调用方回落到文本结果
    expect(resolveBuiltVideoRelativePath({ out: { kind: 'text', text: '{}' } })).toBeUndefined()
  })

  it('双击修复/变体时先开视频预览，再回落到文本', () => {
    expect(card).toContain('resolveBuiltVideoRelativePath(props.runState?.outputs)')
    expect(card).toContain("mediaKind: 'video'")
    expect(card).toMatch(
      /props\.node\.typeId === 'semantic\.repair' \|\| props\.node\.typeId === 'semantic\.variant'/
    )
    // 打不开视频时仍要有反应（下面那段文本分支）
    expect(card).toContain(
      'const ok = await openSemanticResultTextDive(title, raw || semanticNoResultHint())'
    )
  })

  it('检查器显示编辑摘要、丢弃原因，并能插入示例', () => {
    expect(inspector).toContain('summarizeSemanticEdits(editsJson.value)')
    expect(inspector).toContain('class="edits-summary"')
    expect(inspector).toContain('editsSummary.issues')
    expect(inspector).toContain("t('graph.inspector.semantic.editsInsertSample')")
    expect(inspector).toContain('function insertSampleEdit()')
    expect(inspector).toContain('sampleSemanticEdit()')
    // 插入后要落盘
    expect(inspector).toMatch(/function insertSampleEdit[\s\S]{0,700}?persistPlan\(\)/)
  })

  it('summarizeSemanticEdits：计数 + 类型分布 + 丢弃原因（稳定排序）', () => {
    const now = '2026-01-01T00:00:00.000Z'
    const raw = [
      { kind: 'grade', params: { brightness: 1.1 } },
      { kind: 'dropBeat', beatId: 'beat.a' },
      { kind: 'grade', params: {} },
      { kind: '不存在的类型' },
      'not-an-object'
    ]
    const summary = summarizeSemanticEdits(raw)
    expect(summary.count).toBe(3)
    expect(summary.kinds).toEqual([
      { kind: 'grade', count: 2 },
      { kind: 'dropBeat', count: 1 }
    ])
    expect(summary.issues.length).toBeGreaterThanOrEqual(2)
    // 空输入
    expect(summarizeSemanticEdits('').count).toBe(0)
    expect(summarizeSemanticEdits(null).count).toBe(0)
    // `{edits:[...]}` 形式也认（与 normalizeSemanticEdits 一致）
    expect(summarizeSemanticEdits({ edits: raw }).count).toBe(3)
    // 示例编辑本身必须是合法的（否则"插入示例"等于给用户挖坑）
    expect(summarizeSemanticEdits([sampleSemanticEdit(now)]).count).toBe(1)
    expect(summarizeSemanticEdits([sampleSemanticEdit(now)]).issues).toEqual([])
  })
})
