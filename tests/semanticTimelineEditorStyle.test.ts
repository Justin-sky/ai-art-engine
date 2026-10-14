import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 语义时间线 dive 的轨道布局守卫（尺寸 / 字号 / 滚动 / 左侧固定栏）。
 *
 * 组件在 node 环境渲染不了（无 jsdom），所以按本仓库既有做法做源码守卫。
 *
 * **断言前必须剥掉 CSS 注释**：注释里为了解释原因常写着同样的声明字样
 * （例如「必须 `width: fit-content`」），直接 `toContain` 会让变异（把声明真删掉）
 * 依然通过 —— 这条是实测踩出来的。
 */
const source = readFileSync(
  join(process.cwd(), 'src/renderer/src/components/SemanticTimelineEditor.vue'),
  'utf8'
)

function cssBlock(selector: string): string {
  const raw = new RegExp(`\\${selector}\\s*\\{([^}]*)\\}`, 's').exec(source)?.[1] ?? ''
  return raw.replace(/\/\*[\s\S]*?\*\//g, '')
}

function pxOf(selector: string, prop: string): number {
  const value = new RegExp(`(?:^|[;\\s])${prop}\\s*:\\s*(\\d+(?:\\.\\d+)?)px`).exec(
    cssBlock(selector)
  )?.[1]
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
    expect(pxOf('.stl-row-label', 'font-size')).toBeGreaterThanOrEqual(13)
    expect(pxOf('.stl-tick', 'font-size')).toBeGreaterThanOrEqual(12)
    expect(pxOf('.stl-layer-title', 'font-size')).toBeGreaterThanOrEqual(13)
  })

  /**
   * 轨道名必须**固定在最左边**，而且不能压在块上。
   *
   * 旧做法是 `position: absolute; left: 6px` 放在轨道里 —— 横向滚动时名字跟着跑，
   * 块从 0s 开始时还直接压在名字上。现在是「左侧标签栏（sticky + 在流内占位）+ 右侧轨道」。
   */
  it('轨道名固定在左侧栏（sticky + 在流内占位，不绝对定位压块）', () => {
    const label = cssBlock('.stl-row-label')
    expect(label).toMatch(/position:\s*sticky/)
    expect(label).toMatch(/left:\s*0/)
    expect(label).toContain('var(--stl-gutter)')
    expect(label).not.toMatch(/position:\s*absolute/)
    // 标签栏不透明：滚动时轨道从它底下穿过而不透出来
    expect(label).toMatch(/background:\s*var\(--bg-panel\)/)
    // 模板里标签是轨道的**兄弟**节点（在流内），不是轨道的子节点
    expect(source).toContain('class="stl-row-label"')
    expect(source).not.toContain('stl-ent-label')
    const labelIndex = source.indexOf('class="stl-row-label"')
    const trackIndex = source.indexOf('class="stl-track"')
    expect(labelIndex).toBeGreaterThan(-1)
    expect(trackIndex).toBeGreaterThan(labelIndex)
    // 刻度尺要让开标签栏（0s 与轨道起点对齐）
    expect(cssBlock('.stl-ruler')).toContain('margin-left: var(--stl-gutter)')
    /**
     * 滚动区**左边不能有内边距**：sticky 标签只盖得住内容盒，盖不住 padding 区，
     * 于是横向滚动时轨道会从标签栏左侧那条缝里露出 12px 的块（实测见过）。
     */
    const scroll = cssBlock('.stl-scroll')
    expect(scroll).toMatch(/padding:\s*8px 12px 16px 0/)
    expect(scroll).not.toMatch(/padding:\s*8px 12px 16px;/)
  })

  /**
   * 层标题（剧情 / 角色·实体 / 制作）与空态钉在左边。
   *
   * 关键点：必须 `width: fit-content` —— 块级元素撑满内容宽度时 sticky 没有可滑动余量，
   * 写了 `position: sticky` 也不生效（这条踩过）。
   */
  it('层标题与空态同样固定（sticky + 收缩宽度）', () => {
    const title = cssBlock('.stl-layer-title')
    expect(title, '层标题缺少样式').toBeTruthy()
    expect(title).toMatch(/position:\s*sticky/)
    expect(title).toMatch(/left:\s*0/)
    expect(title, '未收缩宽度（sticky 会失效）').toMatch(/width:\s*fit-content/)
    // 滚动时不透明：底色与标题栏同色，轨道从下面穿过也不透出来
    expect(title).toMatch(/background:\s*color-mix\(/)

    const empty = cssBlock('.stl-empty')
    expect(empty, '空态缺少样式').toBeTruthy()
    expect(empty).toMatch(/position:\s*sticky/)
    expect(empty).toMatch(/left:\s*0/)
    expect(empty).toMatch(/width:\s*fit-content/)
    expect(empty).toMatch(/background:\s*var\(--bg-panel\)/)
  })

  /**
   * 层标题要能和轨道名一眼区分：标题=章节（全宽背景条 + 上下分割线 + 主题色竖条 + 加粗提亮），
   * 轨道名=弱标签（灰、常规字重、无底无边）。
   */
  it('层标题栏有独立样式（背景条 + 分割线 + 主题色竖条），与轨道名拉开层次', () => {
    const head = cssBlock('.stl-layer-head')
    expect(head, '缺少标题栏样式').toBeTruthy()
    expect(head, '缺上分割线').toMatch(/border-top:\s*1px solid/)
    expect(head, '缺下分割线').toMatch(/border-bottom:\s*1px solid/)
    expect(head, '缺背景条').toMatch(/background:\s*color-mix\(/)
    // 每层一个主题色，与层内块色一致
    for (const [modifier, accent] of [
      ['.stl-layer--story', '#5b6cff'],
      ['.stl-layer--entity', '#2a9d8f'],
      ['.stl-layer--production', '#e76f51']
    ] as const) {
      const block = cssBlock(modifier)
      expect(block, `${modifier} 缺主题色`).toContain(accent)
      expect(block).toMatch(/--layer-accent\s*:/)
    }
    const title = cssBlock('.stl-layer-title')
    expect(title, '标题缺主题色竖条').toMatch(/box-shadow:\s*inset 3px 0 0 var\(--layer-accent\)/)
    expect(title, '标题未加粗').toMatch(/font-weight:\s*600/)
    expect(title, '标题未提亮（仍与轨道名同色）').toMatch(/color:\s*var\(--text\)/)
    // 轨道名保持弱化：不加粗、无竖条、无底色
    const label = cssBlock('.stl-row-label')
    expect(label).not.toMatch(/font-weight/)
    expect(label).not.toMatch(/box-shadow/)
    expect(label).toMatch(/color:\s*var\(--text-muted\)/)
  })

  /**
   * 证据面板必须**常驻固定位置**。
   *
   * 旧写法 `<aside v-if="selectedEvidence">`：点选一下面板才出现，整条时间线跟着左右跳；
   * 未选中时右侧还没有任何落点。现在常驻（未选中显示提示）+ sticky 钉在顶部。
   */
  it('证据面板常驻且钉在固定位置', () => {
    // 不再随选中项出现/消失
    expect(source).not.toContain('v-if="selectedEvidence" class="stl-inspector"')
    expect(source).toContain('class="stl-inspector"')
    // 未选中时有提示文案（不是空白一片）；选中任何类型都进检查器
    expect(source).toContain("t('graph.semanticTimeline.selectHint')")
    expect(source).toContain('v-if="!resolvedSelection"')
    expect(source).toMatch(/<SemanticSelectionInspector\s+v-else/)
    const panel = cssBlock('.stl-inspector')
    // 面板高度要撑满（与 dive / 窗口等高）：flex-start 会压成内容高度、边框断掉
    expect(panel).toMatch(/align-self:\s*stretch/)
    expect(panel).not.toMatch(/align-self:\s*flex-start/)
    expect(panel).toMatch(/max-height:\s*100%/)
    expect(panel).toMatch(/overflow:\s*auto/)
    // 两栏：右栏按比例固定宽度（够放 720 高的竖屏画面），不再用 flex-shrink
    expect(panel).toMatch(/flex:\s*0 0 clamp\(420px, 44%, 720px\)/)
  })

  /**
   * 原视频：高度固定 720（竖屏画面正好铺满），宽度吃满右栏，按 contain 留边。
   */
  it('原视频高度固定 720、宽度吃满右栏（出血 + contain）', () => {
    const sourceBox = cssBlock('.stl-source')
    expect(sourceBox).toMatch(/margin:\s*-12px -12px/) // 出血到手，抵消面板内边距
    expect(sourceBox).toMatch(/background:\s*var\(--bg-panel\)/)
    // 720 高的视频不能再粘顶：会把下面的证据全挡住
    expect(sourceBox).not.toMatch(/position:\s*sticky/)
    const video = cssBlock('.stl-source-video')
    expect(video).toMatch(/width:\s*100%/)
    // 按素材实际比例自适应：height: auto，**不许**再写死高度或限高
    expect(video).toMatch(/height:\s*auto/)
    expect(video).not.toMatch(/height:\s*\d+px/)
    expect(video).not.toMatch(/max-height/)
    expect(video).toMatch(/object-fit:\s*contain/)
    // 元数据到位前用时间线里的 source 宽高占位（避免从 0 高跳一下）
    expect(source).toContain('sourceAspectRatio(')
    expect(source).toContain(':style="sourceAspect ? { aspectRatio: sourceAspect } : undefined"')
  })

  /**
   * 证据面板上方要有**原视频**，且点选 clip 时播放条自动跳过去。
   *
   * 组件在 node 环境渲染不了，所以用源码守卫钉住：视频节点在证据标题**之前**、
   * 地址按 `timeline.source.assetId` 自己解析（宿主只给 timelineId 时也要有画面）、
   * 三个选中入口都调用 seek。
   */
  it('证据面板上方是原视频，且选中 clip 会移动播放条', () => {
    const videoIndex = source.indexOf('class="stl-source-video"')
    const inspectorIndex = source.indexOf('<SemanticSelectionInspector')
    expect(videoIndex, '缺少原视频节点').toBeGreaterThan(-1)
    expect(inspectorIndex, '缺少检查器').toBeGreaterThan(-1)
    expect(videoIndex, '视频必须在检查器之前（面板上方）').toBeLessThan(inspectorIndex)
    expect(source).toContain('ref="videoRef"')
    // 地址来源：assetId → 资产相对路径；`path:` 型来源直接用后缀
    expect(source).toContain("assetId.startsWith('path:')")
    expect(source).toContain('window.studio.getAssetFileUrl(rel)')
    expect(source).toContain('project.assets.find((a) => a.id === assetId)')
    // 三个选中入口都要 seek（节拍 / 事件 / 实体）
    expect(source.match(/seekVideo\(/g)?.length ?? 0).toBeGreaterThanOrEqual(4) // 定义 1 + 调用 3
    expect(source).toContain('seekVideo(b.timeRange.start)')
    expect(source).toContain('seekVideo(e.timeRange.start)')
    // 实体跳的是**被点那次出现**（`appearanceSeekSeconds` 的结果），不是写死的第一次出现
    expect(source).toContain('appearanceSeekSeconds(e.appearances, index)')
    expect(source).toContain('seekVideo(start)')
    // 夹取走纯函数（越界会被浏览器拒绝）
    expect(source).toContain('clampSeekSeconds(sec, duration)')
  })

  /**
   * **每类片段都必须能点** —— 制作层（机位/声音/字幕/特效）以前漏了 `@click`，
   * 用户点上去没任何反应（其它三类都正常）。
   */
  /**
   * 实体片段以前是**空块**（只有 tooltip），四类片段里唯一没字的 —— 现在把名字写上去。
   */
  it('实体片段上写着实体名（与节拍/事件/制作一致，长名截断）', () => {
    // 片段里渲染 ent.name，且不再是自闭合空块
    expect(source).toContain('{{ ent.name }}')
    expect(source).toMatch(/@click="selectEntity\(ent, i\)"\s*\n\s*>\s*\n\s*\{\{ ent\.name \}\}/)
    // 空块的写法必须消失（自闭合且紧跟 title）
    expect(source).not.toMatch(
      /\$\{ap\.range\.start\.toFixed\(2\)\}–\$\{ap\.range\.end\.toFixed\(2\)\}s`"\s*\n\s*@click="selectEntity\(ent, i\)"\s*\n\s*\/>/
    )
    // 截断能力来自 .stl-block 的通用样式
    const block = cssBlock('.stl-block')
    expect(block).toMatch(/overflow:\s*hidden/)
    expect(block).toMatch(/text-overflow:\s*ellipsis/)
    expect(block).toMatch(/white-space:\s*nowrap/)
  })

  /**
   * 高亮必须按**片段**算：一个实体有多次出现、一个意图横跨多条轨道，
   * 只比 id 会「点一个片段整行 / 整条轨道全亮」（用户反馈）。
   */
  it('高亮按片段键（实体带出现序号、制作层带轨道），不是只比 id', () => {
    // 唯一选中状态（类型 + id + 片段）；高亮键由它派生
    expect(source).toContain('const selection = ref<SemanticSelection | null>(null)')
    expect(source).toContain(
      'const selectedClip = computed(() => selectionClipKey(selection.value))'
    )
    expect(source).toContain('function clipKey(id: string, suffix?: string | number)')
    // 四类片段都按片段键判断
    expect(source).toContain(':class="{ selected: selectedClip === clipKey(ent.id, i)')
    expect(source).toContain(':class="{ selected: selectedClip === clipKey(intent.id, track.id) }"')
    expect(source).toContain(':class="{ selected: selectedClip === clipKey(b.id) }"')
    expect(source).toContain(':class="{ selected: selectedClip === clipKey(ev.id) }"')
    // 旧写法（只比 id）必须消失
    expect(source).not.toContain('selected: selectedId === ent.id')
    expect(source).not.toContain('selected: selectedId === intent.id')
    expect(source).not.toContain('selected: selectedId === b.id')
    expect(source).not.toContain('selected: selectedId === ev.id')
    // 制作层点击要带轨道
    expect(source).toContain('@click="selectIntent(intent, track.id)"')
    // 选中状态带上片段（否则点完不高亮 / 整行全亮）
    expect(source).toContain("selection.value = { kind: 'entity', id: e.id, clip: index ?? 0 }")
    expect(source).toContain(
      "selection.value = { kind: 'intent', id: intent.id, ...(track ? { clip: track } : {}) }"
    )
  })

  /**
   * 实体片段点击必须带**被点的那次出现**的索引 ——
   * 以前 `@click="selectEntity(ent)"` 无论点哪个片段都跳 appearances[0]（真 bug）。
   */
  it('实体片段点击传出现索引（不是永远跳第一次出现）', () => {
    expect(source).toContain('@click="selectEntity(ent, i)"')
    expect(source).not.toContain('@click="selectEntity(ent)"')
    expect(source).toContain('appearanceSeekSeconds(')
    expect(source).toContain('function selectEntity(e: Entity, index?: number)')
    // 片段要有可读 tooltip（名称 + 该次出现的时间），而不是裸 id
    expect(source).toContain('${ent.name} · ${ap.range.start.toFixed(2)}')
  })

  /**
   * 四类片段都绑了点击（节拍 / 实体 / 事件 / 制作）。
   */
  it('四类片段都绑了点击（节拍 / 实体 / 事件 / 制作）', () => {
    expect(source).toContain('@click="selectBeat(b)"')
    expect(source).toContain('@click="selectEntity(ent, i)"')
    expect(source).toContain('@click="selectEvent(ev)"')
    expect(source).toContain('@click="selectIntent(intent, track.id)"')
    // 制作层片段也要能选中高亮（与其它三类一致）
    expect(source).toContain('selected: selectedClip === clipKey(intent.id, track.id)')
    // 点选制作层片段同样要移动播放条
    expect(source).toContain('function selectIntent(')
    expect(source).toContain('seekVideo(start)')
  })

  /**
   * 两栏之间的拖动手柄：与 AssetBrowser 分栏同一套写法（mousedown + window 监听 + 松手持久化）。
   */
  it('两栏之间有可拖动手柄（鼠标 + 键盘 + 持久化 + 命中区够宽）', () => {
    expect(source).toContain('class="stl-splitter"')
    expect(source).toContain('@mousedown.prevent="onSplitterDown"')
    // 键盘也能调（手柄可聚焦）
    expect(source).toContain('@keydown="onSplitterKeydown"')
    expect(source).toContain('tabindex="0"')
    expect(source).toContain('role="separator"')
    // 松手持久化 + window 监听要摘干净
    expect(source).toContain("window.addEventListener('mousemove', onMove)")
    expect(source).toContain("window.removeEventListener('mousemove', onMove)")
    /**
     * 必须断言「松手这条路径」里就跟着持久化 —— 只查 `persistSideWidth()` 是否出现在文件里
     * 会被键盘分支里的同名调用蒙过去（实测：把 onUp 里的调用删掉，断言照过）。
     */
    expect(source).toMatch(/isSplitterDragging\.value = false\s*\n\s*persistSideWidth\(\)/)
    // 键盘那条路径同样要持久化（两个入口行为一致）
    expect(source).toMatch(
      /clampSidePaneWidth\(currentSideWidth\(rect\) \+ direction \* 24[\s\S]{0,160}?persistSideWidth\(\)/
    )
    expect(source).toContain('localStorage')
    // 宽度走抽出来的纯函数，别在组件里手算边界
    expect(source).toContain('sidePaneWidthFromPointer({')
    expect(source).toContain('clampSidePaneWidth(')
    // 拖动后右栏用内联 flex-basis 生效（沿用 CSS clamp 作为默认）
    expect(source).toContain("flexBasis: sidePaneWidth + 'px'")
    // 手柄命中区不能是 0 宽；光标要是拖动形
    const splitter = cssBlock('.stl-splitter')
    expect(splitter).toMatch(/cursor:\s*col-resize/)
    expect(splitter).toMatch(/flex:\s*0 0 \d+px/)
    expect(Number(/flex:\s*0 0 (\d+)px/.exec(splitter)?.[1] ?? 0)).toBeGreaterThanOrEqual(6)
  })

  /**
   * 界面里**不许**出现机器 id：轨道名（camera / character…）与实体 kind 都要本地化。
   */
  it('轨道名与实体 kind 走 i18n（不直接渲染 tech.track / item.kind）', () => {
    // 两个映射函数必须真的从视图模型里 import 进来
    expect(source).toMatch(
      /import \{[\s\S]*?entityKindKey[\s\S]*?trackLabelKey[\s\S]*?\} from '\.\.\/features\/graph\/model\/semanticTimelineView'/
    )
    // 手法的轨道名现在在意图表单里显示（下拉），同样走 trackLabelKey 映射
    const intentForm = readFileSync(
      join(process.cwd(), 'src/renderer/src/components/semanticInspector/IntentForm.vue'),
      'utf8'
    )
    expect(intentForm).toContain('trackLabelKey(track)')
    expect(intentForm).toContain('{{ trackLabel(track) }}')
    expect(intentForm).not.toContain('{{ track }}')
    expect(source).toContain('entityKindLabel(selectedEvidence.item.kind)')
    // 直接渲染机器值的写法必须消失
    expect(source).not.toContain('{{ tech.track }}')
    expect(source).not.toContain('{{ selectedEvidence.item.kind }}')
    // 生产轨道列表也要通过映射（单一来源）
    expect(source).toContain("{ id: 'camera', label: trackLabel('camera') }")
  })

  /**
   * 证据面板必须显示**人读标签**，不能把哈希 id 直接摆出来（`ev.c732c3a6d0` 没人看得懂）。
   */
  it('证据引用渲染成可读标签（可点跳播放条，原始 id 在 tooltip）', () => {
    expect(source).toContain('resolveEvidenceRef(')
    expect(source).toContain('class="stl-ref"')
    expect(source).toContain('refKindLabel(')
    /**
     * 两个分支（事件 / 节拍）都要绑：`toContain` 只看"字符串存在"，
     * 只留一个分支也会通过（实测：删掉一处断言照过）—— 所以数出现次数。
     */
    expect((source.match(/@click="seekToRef\(ref\)"/g) ?? []).length).toBe(2)
    expect(source).toContain('resolveRefs(selectedEvidence.item.evidence)')
    expect(source).toContain('resolveRefs(selectedEvidence.item.events)')
    // 原始 id 仍要看得到（排查用）
    expect(source).toContain(':title="refTimeLabel(ref) ? `${ref.raw}')
    // 旧的「裸 join」写法必须消失
    expect(source).not.toContain('evidence: {{')
    expect(source).not.toContain('item.evidence.join(')
    expect(source).not.toContain('item.events.join(')
    // 原句/镜头时间来自证据文件（best-effort）—— 断言**调用**而不是函数定义
    expect(source).toMatch(/void loadEvidenceIndex\(\)/)
    expect(source).toContain('utterancesPath')
    expect(source).toContain('shotsPath')
  })

  /**
   * 缩放条的符号按钮（− / + / ⟲）必须**正中心**：
   * 按钮默认带浏览器内边距、且不是 flex，不重置就会偏（实测踩到）。
   */
  it('缩放符号按钮居中（flex 居中 + padding 归零 + 定尺寸）', () => {
    const btn = cssBlock('.stl-zoombar-btn')
    expect(btn, '缺少按钮样式').toBeTruthy()
    expect(btn).toMatch(/display:\s*inline-flex/)
    expect(btn).toMatch(/align-items:\s*center/)
    expect(btn).toMatch(/justify-content:\s*center/)
    expect(btn).toMatch(/padding:\s*0/)
    expect(btn).toMatch(/line-height:\s*1/)
    // 定尺寸的圆（宽高一致），否则 flex 居中也会看着偏
    const w = pxOf('.stl-zoombar-btn', 'width')
    const h = pxOf('.stl-zoombar-btn', 'height')
    expect(w).toBe(h)
  })

  /**
   * 横向滚动条必须落在**可见区底部**。
   *
   * 实测踩过：编辑器不给高度、随内容长高，于是 `.stl-scroll` 的横向滚动条被推到内容最底部 ——
   * 轨道一多，视口里根本够不到它（只能先把整个视图滚到底）。
   * 修法是让编辑器吃满可用高度、由 `.stl-scroll` 自己滚；flex 子项还必须显式 `min-*: 0`，
   * 否则默认 `auto` 会撑开而不滚。
   */
  it('滚动区由编辑器内部承担（编辑器吃满高度 + min-*: 0）', () => {
    const editor = cssBlock('.stl-editor')
    const scroll = cssBlock('.stl-scroll')
    expect(editor).toMatch(/flex:\s*1 1 auto/)
    expect(editor).not.toMatch(/min-height:\s*280px/)
    expect(scroll).toMatch(/overflow:\s*auto/)
    expect(scroll).toMatch(/min-width:\s*0/)
    expect(scroll).toMatch(/min-height:\s*0/)
  })
})
