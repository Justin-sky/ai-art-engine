import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BUILTIN_VOCABULARIES } from '../src/shared/semanticTimeline'
import enUS from '../src/renderer/src/i18n/locales/en-US'
import zhCN from '../src/renderer/src/i18n/locales/zh-CN'

/**
 * 「语义时间线 dive 打不开 / 报 timeline not found」的回归守卫。
 *
 * 实测踩到：透传节点（`semantic.timeline`）自己没时间线时，卡片**编了一个假 id**
 * `stl.node.<nodeId>` 去开编辑器 → dive 去读不存在的 `Semantic/<假id>/timeline.json`
 * → 用户看到 `timeline not found`。正确做法是：回落上游节点；真没有就给提示。
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
const executor = readFileSync(
  join(process.cwd(), 'src/shared/graph/execute/semanticTimeline.ts'),
  'utf8'
)

describe('语义时间线 dive 的打开路径', () => {
  it('不再编造 stl.node.<nodeId> 假 id', () => {
    expect(card).not.toContain('`stl.node.${props.node.id}`')
    expect(card).not.toContain("'stl.node.'")
    // 空 id 也允许打开（由视图给提示），所以不再提前 return false
    expect(card).toContain("const timelineId = payload?.id || fallbackId || ''")
  })

  it('自己没有时间线时回落上游节点的 semanticTimelineId（并带上原视频路径）', () => {
    expect(card).toContain('function resolveUpstreamTimelinePayload(')
    expect(card).toContain('graphEditorHosts.listIncomingEdges(hostId, props.node.id)')
    expect(card).toContain('graphEditorHosts.getNode(hostId, edge.sourceNodeId)')
    // 必须真的拿上游节点去解析（否则"回落"是空壳：函数在、但永远返回 null）
    expect(card).toContain('resolveSemanticTimelineViewTarget(source, null)')
    expect(card).toMatch(
      /resolveSemanticTimelinePayload\(props\.node, props\.runState\) \?\?\s*\n\s*resolveUpstreamTimelinePayload\(\)/
    )
    expect(card).toContain('sourceRelativePath: payload?.sourceRelativePath')
  })

  it('视图把「还没有时间线」当提示、把「文件缺失」当错误（都不再是裸英文 timeline not found）', () => {
    expect(view).not.toContain("'timeline not found'")
    expect(view).not.toContain("'missing timelineId'")
    expect(view).toContain("hint.value = t('graph.semanticTimeline.noTimelineHint')")
    expect(view).toContain("error.value = t('graph.semanticTimeline.timelineFileMissing')")
    // 错误时把实际路径显示出来（便于排查）
    expect(view).toContain('missingPath.value = rel')
    expect(view).toContain('class="path"')
    // 提示态要有"下一步怎么做"的说明
    expect(view).toContain('noTimelineHintSub')
  })

  it('没有运行结果时双击也要有反应（不能静默什么都不做）', () => {
    // 工具节点（触发 / 编译 / 修复 / 变体）与分析的兜底都改成"开文本 dive 说明情况"
    expect(card).toContain('function semanticNoResultHint(')
    /**
     * 两个分支必须**分别**断言，而且不能用子串关系糊弄过去：
     * 工具分支那行是 `const ok = await …`，分析分支那行以 `await …` 起头 ——
     * 所以分析分支要**行首锚定**（`m` 模式）才真正独立（这点实测踩了两次）。
     */
    expect(card).toMatch(
      /^\s+await openSemanticResultTextDive\(title, raw \|\| semanticNoResultHint\(\)\)/m
    )
    expect(card).toContain(
      'const ok = await openSemanticResultTextDive(title, raw || semanticNoResultHint())'
    )
    // 旧的静默分支必须消失：`if (raw) { ... }` 之后直接 return
    expect(card).not.toMatch(/if \(raw\) \{\s*\n\s*const ok = await openSemanticResultTextDive/)
    expect(card).not.toMatch(
      /const raw = resolveSemanticOutText\(props\.node, props\.runState\)\s*\n\s*if \(raw\) await/
    )
    // 提示文案走 i18n
    expect(card).toContain("t('graph.semanticTimeline.noResultHint')")
    expect(card).toContain("t('graph.semanticTimeline.noResultHintSub')")
  })

  it('触发节点的「事件标签过滤」要真的列出候选（下拉 + 上游解析）', () => {
    /**
     * 以前候选项只来自"本节点 JSON / 本节点输出"，而触发节点的输出是
     * `{eventLabel, events, commands}`（不是时间线文档）→ 下拉永远是空的。
     */
    expect(inspector).toContain('eventLabelChoices(timelineDoc.value)')
    expect(inspector).toContain('const upstreamTimelineJson = ref(')
    expect(inspector).toContain('graphEditorHosts.listIncomingEdges(host, current.id)')
    // 三种上游来源：上游运行输出 → 上游 timelineJson → 上游 semanticTimelineId 读盘
    expect(inspector).toContain('graphRunHosts.get(host)?.runStates?.[source.id]?.outputs?.out')
    expect(inspector).toContain('Semantic/${stlId}/timeline.json')
    // 三者都要参与 timelineDoc 解析
    expect(inspector).toContain(
      '[timelineJson.value, runOutText.value, upstreamTimelineJson.value]'
    )
    // 候选项以**多选列表**呈现（原生 datalist 没箭头，很多人不知道有候选）
    expect(inspector).toContain('class="event-label-list"')
    expect(inspector).toContain('v-if="eventLabelOptions.length"')
    expect(inspector).toContain('@change="toggleEventLabel(label)"')
    // 列不出候选时要说清楚原因
    expect(inspector).toContain('eventLabelNoOptions')
  })

  it('事件标签支持多选（勾选写回逗号分隔，参数仍是单值字段）', () => {
    // 勾选状态从输入框解析（手填的 id/type 也保留）
    expect(inspector).toContain('const pickedEventLabels = computed(() => parseEventLabels(')
    // 复选框列表
    expect(inspector).toContain('class="event-label-item check"')
    expect(inspector).toContain('type="checkbox"')
    expect(inspector).toContain(':checked="pickedEventLabels.includes(label)"')
    expect(inspector).toContain('@change="toggleEventLabel(label)"')
    // 切换后重写成逗号分隔并落盘
    expect(inspector).toMatch(
      /function toggleEventLabel[\s\S]{0,320}?eventLabel\.value = next\.join\(', '\)[\s\S]{0,80}?persistTrigger\(\)/
    )
    /**
     * 多选就够，**不要再放一个单选下拉**（用户反馈：有多选为什么还有单选）。
     * 纯文本框保留（可手填 id / type / 逗号多值），但**不挂 datalist** ——
     * 挂了浏览器会画一个下拉箭头，看起来又像选择控件（用户第二次反馈）。
     */
    expect(inspector).not.toContain('event-label-select')
    expect(inspector).not.toContain('onPickEventLabel')
    expect(inspector).not.toContain('<datalist')
    expect(inspector).not.toContain('list="semantic-event-labels"')
    expect(zhCN.graph.inspector.semantic.eventLabelPick).toBeUndefined()
    expect(enUS.graph.inspector.semantic.eventLabelPick).toBeUndefined()
    /**
     * 复选框与标签**同一行**：选择器必须带 `.fields` 前缀提高权重，
     * 否则被 `.fields label { flex-direction: column }`（0,1,1）压成上下两行（用户反馈）。
     */
    expect(inspector).toContain('class="event-label-item check"')
    const itemRule = /\.fields \.event-label-item\s*\{([^}]*)\}/s.exec(inspector)?.[1] ?? ''
    expect(itemRule, '缺少 .fields .event-label-item 规则').toBeTruthy()
    expect(itemRule).toMatch(/display:\s*flex/)
    expect(itemRule).toMatch(/flex-direction:\s*row/)
    expect(itemRule).toMatch(/align-items:\s*center/)
    // 引擎侧：多值解析 + 归属筛选（行为由 tests/semanticEventNode.test.ts 覆盖）
    expect(executor).toContain('parseEventLabels(ctx.node.params?.eventLabel)')
    expect(executor).toContain('labels.includes(e.label)')
    expect(executor).toContain('commandBelongsToEvents(c, events, timeline.intents)')
    expect(executor).toContain('eventLabels: labels')
  })

  it('两套文案都有这五个 key', () => {
    for (const key of [
      'noTimelineHint',
      'noTimelineHintSub',
      'timelineFileMissing',
      'noResultHint',
      'noResultHintSub'
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

  it('内置词表的每个节拍类型在两套文案里都有名字（含中文，不再显示 hook）', () => {
    for (const vocabulary of BUILTIN_VOCABULARIES) {
      for (const beat of vocabulary.beats) {
        for (const [name, locale] of [
          ['zh-CN', zhCN],
          ['en-US', enUS]
        ] as const) {
          const value = (locale as Record<string, any>)?.graph?.semanticTimeline?.beat?.[beat.type]
          expect(
            typeof value === 'string' && value.trim().length > 0,
            `${name} 缺少 ${beat.type} 的节拍名`
          ).toBe(true)
        }
      }
    }
  })
})
