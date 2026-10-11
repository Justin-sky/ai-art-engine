import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  addEditDraft,
  buildEntityShotIndex,
  planInvalidation,
  readEditDrafts,
  removeEditDraft,
  sampleSemanticEdit,
  STRUCTURED_EDIT_KINDS,
  summarizeInvalidationPlan,
  summarizeSemanticEdits,
  timelineVersionHash,
  updateEditDraft,
  type SemanticTimeline
} from '../src/shared/semanticTimeline'
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

  it('summarizeInvalidationPlan：按 action 计数 + 费用字段 + 空值安全', () => {
    const plan = {
      targetLevel: 'L1',
      items: [
        { productId: 'a', action: 'keep', reason: 'unchanged' },
        { productId: 'b', action: 'keep', reason: 'unchanged' },
        { productId: 'c', action: 'replace', reason: 'entity swapped' },
        { productId: 'd', action: 'recompute', reason: 'grade' }
      ],
      cost: { paidSeconds: 4.5, localShotCount: 2, paidShotCount: 1, note: '需付费重生成 1 镜' }
    } as never
    expect(summarizeInvalidationPlan(plan)).toEqual({
      targetLevel: 'L1',
      kept: 2,
      replaced: 1,
      recompute: 1,
      paidSeconds: 4.5,
      paidShotCount: 1,
      localShotCount: 2,
      note: '需付费重生成 1 镜'
    })
    // 没有 cost / 没有 note 时不炸，note 不塞空串
    expect(summarizeInvalidationPlan({ targetLevel: 'L0', items: [] } as never)).toEqual({
      targetLevel: 'L0',
      kept: 0,
      replaced: 0,
      recompute: 0,
      paidSeconds: 0,
      paidShotCount: 0,
      localShotCount: 0
    })
    expect(summarizeInvalidationPlan(null)).toBeNull()
    expect(summarizeInvalidationPlan(undefined)).toBeNull()
  })

  it('检查器本地算计划预览（读证据 + 不构建）', () => {
    expect(inspector).toContain('window.studio.semanticLoadEvidence(id)')
    expect(inspector).toContain('planInvalidation({')
    expect(inspector).toContain('buildEntityShotIndex(timeline)')
    expect(inspector).toContain('summarizeInvalidationPlan(')
    expect(inspector).toContain('normalizeSemanticEdits(editsJson.value')
    expect(inspector).toContain('class="plan-preview"')
    // 读不到证据要说明（否则"直拷 0"会误导）—— 必须断言**绑定**：
    // 只查文案存在的话，把 v-if 改成 false（等于不提示）照样通过
    expect(inspector).toContain('const planNeedsEvidence = computed(')
    expect(inspector).toMatch(/<p v-if="planNeedsEvidence" class="field-hint">/)
    expect(inspector).toContain("t('graph.inspector.semantic.planNoEvidence')")
    // 只在计划类节点（修复/变体）上算
    expect(inspector).toMatch(
      /const planPreviewResult = computed<\{[\s\S]{0,140}?if \(!isPlan\.value\) return \{ plan: null, error: '' \}/
    )
  })

  /**
   * 结构化编辑器的行操作：**必须保留未知字段**（agent / 手写的高级编辑不能被表单吃掉）。
   */
  it('readEditDrafts / addEditDraft / updateEditDraft / removeEditDraft 保留未知字段', () => {
    const raw = JSON.stringify([
      { kind: 'grade', params: { LUT: 'cinematic.cube' }, note: '高级字段' },
      { kind: 'regenerateShot', shotId: 'shot.1', prompt: '重画这一镜' },
      'not-an-object'
    ])
    // 读：跳过非对象，保持顺序
    expect(readEditDrafts(raw).map((d) => d.kind)).toEqual(['grade', 'regenerateShot'])
    expect(readEditDrafts('')).toEqual([])
    expect(readEditDrafts('{oops')).toEqual([])
    expect(readEditDrafts({ edits: [{ kind: 'grade' }] }).length).toBe(1)

    // 改一个字段：**其它字段原样保留**
    const updated = JSON.parse(
      updateEditDraft(raw, 0, { kind: 'grade', params: { brightness: 1.2 } })
    )
    expect(updated[0].note).toBe('高级字段') // note 不被吃掉
    expect(updated[0].params).toEqual({ brightness: 1.2 }) // 只并进这一个字段（params 整体覆盖）
    expect(updated[0].params.LUT).toBeUndefined()
    expect(updated[1].prompt).toBe('重画这一镜') // 第二行没被动过
    // 改第二行时，第一行的高级字段同样保留
    const updatedB = JSON.parse(updateEditDraft(raw, 1, { prompt: '换个提示词' }))
    expect(updatedB[1].prompt).toBe('换个提示词')
    expect(updatedB[1].shotId).toBe('shot.1')
    expect(updatedB[0].note).toBe('高级字段')

    // 增
    expect(JSON.parse(addEditDraft(raw, { kind: 'dropBeat', beatId: 'b1' })).length).toBe(3)
    expect(JSON.parse(addEditDraft('', { kind: 'grade' }))).toEqual([{ kind: 'grade' }])
    // 删（越界不动）
    expect(JSON.parse(removeEditDraft(raw, 1)).map((d: { kind: string }) => d.kind)).toEqual([
      'grade'
    ])
    expect(JSON.parse(removeEditDraft(raw, 9)).length).toBe(2)
    // 只有本地可执行的 kind 出现在结构化表单里
    expect([...STRUCTURED_EDIT_KINDS]).toEqual([
      'grade',
      'dropBeat',
      'reorderBeats',
      'replaceEntity',
      'removeEntity',
      'editText'
    ])
  })

  it('检查器的结构化编辑器：真实节拍/实体可选，且只改认识的字段', () => {
    expect(inspector).toContain('readEditDrafts(editsJson.value)')
    expect(inspector).toContain('updateEditDraft(editsJson.value, index,')
    expect(inspector).toContain('removeEditDraft(editsJson.value, index)')
    expect(inspector).toContain('addEditDraft(editsJson.value, patch)')
    expect(inspector).toContain('STRUCTURED_EDIT_KINDS')
    expect(inspector).toContain('class="edits-struct"')
    // 节拍 / 实体从时间线文档里来（真实 id），不是让用户手打
    expect(inspector).toContain('timelineDoc.value?.beats')
    expect(inspector).toContain('timelineDoc.value?.entities')
    // 每次表单改动都要落盘
    expect(inspector).toMatch(/function setDraftField[\s\S]{0,200}?persistPlan\(\)/)
    expect(inspector).toMatch(/function addDraft[\s\S]{0,900}?persistPlan\(\)/)
    expect(inspector).toMatch(/function removeDraft[\s\S]{0,160}?persistPlan\(\)/)
  })

  /**
   * 字段不全的时间线文档**绝不能抛错**。
   *
   * 实测踩到：这种文档让 `buildEntityShotIndex` 抛 `undefined is not iterable`，
   * 而它跑在检查器的 computed 里 → **整个 inspector 面板空白**（用户报"inspector 为空"）。
   */
  it('字段不全的文档不抛错：buildEntityShotIndex / planInvalidation / 版本哈希', () => {
    const partial = {
      id: 'stl.partial',
      source: { assetId: 'a', fps: 30, duration: 10, width: 100, height: 100 },
      updatedAt: '2026-01-01T00:00:00.000Z'
      // 故意不给 entities / events / beats / edits
    } as unknown as SemanticTimeline

    expect(buildEntityShotIndex(partial).size).toBe(0)
    expect(() => planInvalidation({ timeline: partial, shots: [], edits: [] })).not.toThrow()
    expect(() => timelineVersionHash(partial)).not.toThrow()

    // 实体缺 appearances / 缺 id 也要能算
    const messy = {
      ...partial,
      entities: [
        { id: 'ent.a' }, // 没有 appearances
        { name: '没有 id' },
        { id: 'ent.b', appearances: [{ shotId: 'shot.1' }, { shotId: 'shot.1' }, { shotId: '' }] }
      ],
      edits: [],
      events: [],
      beats: []
    } as unknown as SemanticTimeline
    const index = buildEntityShotIndex(messy)
    expect(index.get('ent.a')).toEqual([])
    expect(index.has('undefined')).toBe(false)
    expect(index.get('ent.b')).toEqual(['shot.1']) // 去重 + 丢掉空 shotId
    expect(() =>
      planInvalidation({
        timeline: messy,
        shots: [
          { id: 'shot.1', range: { start: 0, end: 1, startFrame: 0, endFrame: 30 } } as never
        ],
        edits: [
          {
            id: 'edit.1',
            kind: 'removeEntity',
            origin: 'user',
            createdAt: '2026-01-01T00:00:00.000Z',
            entityId: 'ent.b'
          } as never
        ]
      })
    ).not.toThrow()
  })

  it('检查器：计划预览与摘要都包了异常，且失败时要把原因显示出来', () => {
    // computed 抛错 = 整个面板不渲染 → 必须 try/catch
    expect(inspector).toMatch(/const planPreviewResult = computed<\{[\s\S]{0,260}?try \{/)
    expect(inspector).toMatch(
      /const editsSummary = computed<EditsSummary>\(\(\) => \{\s*\n\s*try \{/
    )
    expect(inspector).toMatch(
      /const editDrafts = computed<Array<Record<string, unknown>>>\(\(\) => \{\s*\n\s*try \{/
    )
    // 出错也要有可见反馈（不能静默空白），所以渲染条件包含 planError
    expect(inspector).toMatch(/<div v-if="planSummary \|\| planError" class="plan-preview">/)
    expect(inspector).toMatch(/<p v-if="planError" class="edits-issue">/)
    expect(inspector).toContain("t('graph.inspector.semantic.planPreviewFailed')")
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
