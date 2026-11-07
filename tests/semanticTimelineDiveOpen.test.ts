import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import enUS from '../src/renderer/src/i18n/locales/en-US'
import zhCN from '../src/renderer/src/i18n/locales/zh-CN'

/**
 * 「语义时间线 dive 打不开 / 报 timeline not found」的回归守卫。
 */
const card = readFileSync(
  join(process.cwd(), 'src/renderer/src/components/GraphNodeCard.vue'),
  'utf8'
)
const view = readFileSync(
  join(process.cwd(), 'src/renderer/src/components/dive/EditorDiveSemanticTimelineView.vue'),
  'utf8'
)
const inspector = readFileSync(
  join(process.cwd(), 'src/renderer/src/components/SemanticTimelineInspector.vue'),
  'utf8'
)

describe('语义时间线 dive 的打开路径', () => {
  it('不再编造 stl.node.<nodeId> 假 id', () => {
    expect(card).not.toContain('`stl.node.${props.node.id}`')
    expect(card).not.toContain("'stl.node.'")
    expect(card).toContain("const timelineId = payload?.id || fallbackId || ''")
  })

  it('dive 带上原视频路径；只有分析节点双击进时间线', () => {
    expect(card).toContain('sourceRelativePath: payload?.sourceRelativePath')
    expect(card).not.toContain('function resolveUpstreamTimelinePayload(')
  })

  it('视图把「还没有时间线」当提示、把「文件缺失」当错误（都不再是裸英文 timeline not found）', () => {
    expect(view).not.toContain("'timeline not found'")
    expect(view).not.toContain("'missing timelineId'")
    expect(view).toContain("hint.value = t('graph.semanticTimeline.noTimelineHint')")
    expect(view).toContain("error.value = t('graph.semanticTimeline.timelineFileMissing')")
    expect(view).toContain('missingPath.value = rel')
    expect(view).toContain('class="path"')
    expect(view).toContain('noTimelineHintSub')
  })

  it('没有运行结果时双击也要有反应（不能静默什么都不做）', () => {
    expect(card).toContain('function semanticNoResultHint(')
    expect(card).toMatch(
      /^\s+await openSemanticResultTextDive\(title, raw \|\| semanticNoResultHint\(\)\)/m
    )
    expect(card).toContain(
      'const ok = await openSemanticResultTextDive(title, raw || semanticNoResultHint())'
    )
    expect(card).not.toMatch(/if \(raw\) \{\s*\n\s*const ok = await openSemanticResultTextDive/)
    expect(card).not.toMatch(
      /const raw = resolveSemanticOutText\(props\.node, props\.runState\)\s*\n\s*if \(raw\) await/
    )
    expect(card).toContain("t('graph.semanticTimeline.noResultHint')")
    expect(card).toContain("t('graph.semanticTimeline.noResultHintSub')")
  })

  it('检查器仍然从「本节点 / 本节点输出 / 上游」三处解析时间线文档', () => {
    expect(inspector).toContain('const upstreamTimelineJson = ref(')
    expect(inspector).toContain('graphEditorHosts.listIncomingEdges(host, current.id)')
    expect(inspector).toContain('graphRunHosts.get(host)?.runStates?.[source.id]?.outputs?.out')
    expect(inspector).toContain('Semantic/${stlId}/timeline.json')
    expect(inspector).toContain(
      '[timelineJson.value, runOutText.value, upstreamTimelineJson.value]'
    )
    expect(inspector).not.toContain('eventLabelChoices(')
    expect(inspector).not.toContain('eventLabelOptions')
    expect(zhCN.graph.inspector.semantic.eventLabelPick).toBeUndefined()
    expect(enUS.graph.inspector.semantic.eventLabelPick).toBeUndefined()
  })

  it('两套文案都有这五个提示 key 与四轴分流轨道 key', () => {
    for (const key of [
      'noTimelineHint',
      'noTimelineHintSub',
      'timelineFileMissing',
      'noResultHint',
      'noResultHintSub',
      'layerFootage',
      'trackUnits',
      'trackOverlays'
    ]) {
      for (const [name, locale] of [
        ['zh-CN', zhCN],
        ['en-US', enUS]
      ] as const) {
        const value = (locale as Record<string, any>)?.graph?.semanticTimeline?.[key]
        expect(typeof value === 'string' && value.trim().length > 0, `${name} 缺少 ${key}`).toBe(
          true
        )
      }
    }
  })
})
