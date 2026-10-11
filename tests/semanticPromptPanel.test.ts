import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  promptOverrideRows,
  readPromptOverrides,
  removePromptOverride,
  setPromptOverride,
  writePromptOverrides
} from '../src/renderer/src/features/graph/model/promptOverrides'
import type { VideoPromptPlan } from '../src/shared/semanticTimeline'
import zhCN from '../src/renderer/src/i18n/locales/zh-CN'
import enUS from '../src/renderer/src/i18n/locales/en-US'

/**
 * 任务 ⑧：语义编译的**逐镜提示词**能在 dive 里就地查看 / 修改，写回编译节点的
 * `promptOverridesJson`。
 *
 * 测试环境没有 jsdom（`environment: 'node'`），不能挂载 .vue，所以分两层：
 * 1. 覆盖读写的**纯函数**直接跑真实断言（不是源码扫描）；
 * 2. 界面接线用**源码守卫**，且断言必须锚定**调用点**（不是函数定义 —— 定义处同样含这些
 *    字符串，锚错了断言会恒真，前几轮反复踩过）。
 */
const read = (rel: string): string => readFileSync(join(process.cwd(), rel), 'utf8')

const panel = read('src/renderer/src/components/SemanticPromptPanel.vue')
const dive = read('src/renderer/src/components/dive/EditorDiveSemanticTimelineView.vue')
const editor = read('src/renderer/src/components/SemanticTimelineEditor.vue')
const card = read('src/renderer/src/components/GraphNodeCard.vue')

function planFixture(): VideoPromptPlan {
  return {
    schema: 'aiart.video-prompts@1',
    timelineId: 'stl.prompt01',
    sourceAssetId: 'asset-1',
    sourceRelativePath: 'Assets/a.mp4',
    lang: 'zh',
    fullPrompt: 'full',
    settings: { width: 1080, height: 1920, fps: 30, durationSec: 6 },
    shots: [
      {
        shotId: 'shot.a',
        startSec: 0,
        durationSec: 3,
        firstFrameRelativePath: 'Semantic/stl.prompt01/evidence/keyframes/a.jpg',
        prompt: '自动提示词 A',
        entities: [],
        eventLabels: ['hook'],
        sourceIntentIds: []
      },
      {
        shotId: 'shot.b',
        startSec: 3,
        durationSec: 3,
        prompt: '自动提示词 B',
        entities: [],
        eventLabels: [],
        sourceIntentIds: [],
        modelAuthored: true
      }
    ]
  }
}

describe('逐镜提示词覆盖（纯函数）', () => {
  it('readPromptOverrides 认紧凑对象与数组两种形状，非字符串值一律忽略', () => {
    expect(readPromptOverrides('{"shot.a":"改了 A"}')).toEqual({ 'shot.a': '改了 A' })
    expect(readPromptOverrides('[{"shotId":"shot.b","prompt":"改了 B"}]')).toEqual({
      'shot.b': '改了 B'
    })
    expect(readPromptOverrides({ 'shot.a': { prompt: '嵌套' } })).toEqual({ 'shot.a': '嵌套' })
    // 坏 JSON / 空 / 非对象：都退化成「没有覆盖」，而不是抛
    expect(readPromptOverrides('{oops')).toEqual({})
    expect(readPromptOverrides('')).toEqual({})
    expect(readPromptOverrides(null)).toEqual({})
    expect(readPromptOverrides('["nope"]')).toEqual({})
    expect(readPromptOverrides({ 'shot.a': 42 })).toEqual({})
  })

  it('setPromptOverride 只改目标镜头，其它镜头（含不认识的形状）原样保留', () => {
    const raw = JSON.stringify({ 'shot.a': 'A 原值', 'shot.c': 'C 原值' })
    const next = readPromptOverrides(setPromptOverride(raw, 'shot.b', 'B 新值'))
    expect(next).toEqual({ 'shot.a': 'A 原值', 'shot.c': 'C 原值', 'shot.b': 'B 新值' })
  })

  it('空文本 = 撤销这条覆盖（不是写一条空提示词）', () => {
    const raw = JSON.stringify({ 'shot.a': 'A', 'shot.b': 'B' })
    expect(readPromptOverrides(setPromptOverride(raw, 'shot.a', '   '))).toEqual({ 'shot.b': 'B' })
    expect(setPromptOverride(raw, 'shot.a', '')).not.toContain('shot.a')
  })

  it('removePromptOverride 删完最后一条就回到空串（参数留空 = 没有覆盖）', () => {
    expect(removePromptOverride('{"shot.a":"A"}', 'shot.a')).toBe('')
    expect(removePromptOverride('{"shot.a":"A"}', 'shot.zzz')).toBe(
      JSON.stringify({ 'shot.a': 'A' }, null, 2)
    )
    expect(writePromptOverrides({})).toBe('')
  })

  it('promptOverrideRows 给出起止秒 / 首帧 / 覆盖标记，并让覆盖值优先', () => {
    const rows = promptOverrideRows(planFixture(), JSON.stringify({ 'shot.a': '人工改过' }))
    expect(rows.map((r) => r.shotId)).toEqual(['shot.a', 'shot.b'])
    expect(rows[0]).toMatchObject({
      startSec: 0,
      endSec: 3,
      durationSec: 3,
      hasFirstFrame: true,
      prompt: '人工改过',
      overridden: true
    })
    expect(rows[1]).toMatchObject({
      startSec: 3,
      endSec: 6,
      hasFirstFrame: false,
      prompt: '自动提示词 B',
      overridden: false,
      modelAuthored: true
    })
    // 没有计划时给空行集，而不是抛（界面据此显示「还没有计划」）
    expect(promptOverrideRows(null, '{}')).toEqual([])
  })
})

describe('提示词面板的界面接线', () => {
  it('改动写回**编译节点参数**（锚定调用点，且不是只改本地 ref）', () => {
    // 调用点：dive 视图里把面板的 emit 落到 graphEditorHosts.updateNode
    expect(dive).toContain(
      'graphEditorHosts.updateNode(hostId, nodeId, { promptOverridesJson: value })'
    )
    expect(dive).toContain('@update:overrides-json="persistPromptOverrides"')
    // 面板自己不存状态：只 emit，参数是唯一事实来源
    expect(panel).toContain("emit('update:overridesJson', setPromptOverride(")
    expect(panel).toContain("emit('update:overridesJson', removePromptOverride(")
    // 反例：面板里不该出现直接写节点参数（那会绕过 undo / 自动保存）
    expect(panel).not.toContain('graphEditorHosts.updateNode')
  })

  it('两条计划来源都接了：运行输出优先，渲染侧本地重算兜底', () => {
    // ① 编译节点的运行输出（结构化 videoPrompts 值 / 文本都认）
    expect(dive).toContain("if (out.kind === 'videoPrompts') return out.plan")
    expect(dive).toContain('parsePromptPlan(out.text)')
    // ② 本地重算：证据镜头 + 规则包 + 导演命令 → buildPromptPlan
    expect(dive).toContain('window.studio.semanticLoadEvidence(doc.id)')
    expect(dive).toContain('collectRulePacks(packs, rulePackIds())')
    expect(dive).toContain('compileDirectorCommands(doc, {')
    expect(dive).toMatch(/buildPromptPlan\(\{[\s\S]{0,300}?shots,/)
    expect(dive).toContain('const plan = computed(() => planFromRun.value ?? localPlan.value)')
  })

  it('拿不到时间线 / 镜头时给明确提示（不能空白）', () => {
    expect(dive).toContain("if (!timeline.value) return t('graph.semanticPrompt.noTimeline')")
    expect(dive).toContain(
      "if ((plan.value?.shots.length ?? 0) === 0) return t('graph.semanticPrompt.noShots')"
    )
    // 面板把空提示当正文显示出来（而不是"什么都没有"）
    expect(panel).toContain('{{ emptyHint }}')
    // 读证据失败只是少几条镜头，不该把面板打成错误
    expect(dive).toMatch(/semanticLoadEvidence\(doc\.id\)[\s\S]{0,400}?catch \{/)
  })

  it('双击编译节点优先进提示词面板（排在通用文本结果分支之前）', () => {
    /**
     * 关键：必须锚定**分支本身**（`if (…=== 'semantic.compile') {`）。
     *
     * 只写 `props.node.typeId === 'semantic.compile'` 会先命中同一文件里
     * `const editable = props.node.typeId === 'semantic.compile'`（更靠前），
     * 于是「分支排在成片预览之前」变成恒真 —— 变异验证时实测踩到：
     * 把整个分支挪到通用工具分支之后，断言仍然是绿的。
     */
    const branch = /\n {4}if \(props\.node\.typeId === 'semantic\.compile'\) \{/
    const at = card.search(branch)
    expect(at, '缺少 semantic.compile 的双击分支').toBeGreaterThan(-1)

    // 分支体内必须是「开 dive 提示词面板」（真的调用，不是文件里别处的同名调用）
    const body = card.slice(at, at + 600)
    expect(body).toContain('openSemanticTimelineDive(title, target)')
    expect(body).toContain('resolveUpstreamTimelinePayload()')

    // 顺序：编译分支必须在「工具节点 → 成片预览」之前（否则先落到成片/文本分支）
    const builtVideoAt = card.indexOf('resolveBuiltVideoRelativePath(props.runState?.outputs)')
    expect(builtVideoAt).toBeGreaterThan(-1)
    expect(at).toBeLessThan(builtVideoAt)

    // 编译节点可写：dive meta 带上来源节点（否则面板没有可写目标）——锚定真正的展开点
    expect(card).toMatch(
      /const editable = props\.node\.typeId === 'semantic\.compile'[\s\S]{0,500}?\.\.\.\(editable && hostId \? \{ editorNodeId: props\.node\.id, hostId \} : \{\}\)/
    )
  })

  it('右栏页签 + 插槽：提示词面板挂在编辑器右栏，且只在可写时出现', () => {
    // 绑定发生在 dive 视图（它才知道有没有可写来源），编辑器只认 showPromptTab 这个入参
    expect(dive).toContain(':show-prompt-tab="canEditPrompts"')
    expect(editor).toContain('showPromptTab?: boolean')
    expect(editor).toContain("t('graph.semanticPrompt.tab')")
    expect(editor).toMatch(
      /<slot v-if="showPromptTab && paneTab === 'prompt'" name="prompt-panel" \/>/
    )
    expect(dive).toContain('<template #prompt-panel>')
    // 从编译节点进来直接落在提示词页签（用户来这就是为了改它）
    expect(editor).toContain(
      "ref<'evidence' | 'prompt'>(props.showPromptTab ? 'prompt' : 'evidence')"
    )
  })

  it('两套文案都有面板要用的 key（含"要重跑编译节点才生效"那句）', () => {
    const keys = [
      'tab',
      'rerunHint',
      'loading',
      'loadFailed',
      'empty',
      'noTimeline',
      'noShots',
      'timeRange',
      'firstFrame',
      'noFirstFrame',
      'modelAuthored',
      'overridden',
      'restore',
      'restoreHint',
      'promptPlaceholder'
    ]
    for (const [name, locale] of [
      ['zh-CN', zhCN],
      ['en-US', enUS]
    ] as const) {
      for (const key of keys) {
        const value = (locale as Record<string, unknown>).graph
        const group = (value as { semanticPrompt?: Record<string, unknown> })?.semanticPrompt
        const text = group?.[key]
        expect(typeof text === 'string' && text.trim().length > 0, `${name} 缺少 ${key}`).toBe(true)
      }
    }
    // 提示词面板必须点明"改动要重跑才生效"
    expect(
      (zhCN as never as { graph: { semanticPrompt: { rerunHint: string } } }).graph.semanticPrompt
        .rerunHint
    ).toContain('重跑')
  })
})
