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
    // 未选中时有提示文案（不是空白一片）
    expect(source).toContain("t('graph.semanticTimeline.selectHint')")
    expect(source).toContain('v-if="!selectedEvidence"')
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
    expect(pxOf('.stl-source-video', 'height')).toBe(720)
    expect(video).toMatch(/object-fit:\s*contain/)
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
    const evidenceIndex = source.indexOf("t('graph.semanticTimeline.evidence')")
    expect(videoIndex, '缺少原视频节点').toBeGreaterThan(-1)
    expect(evidenceIndex, '缺少证据标题').toBeGreaterThan(-1)
    expect(videoIndex, '视频必须在证据标题之前（面板上方）').toBeLessThan(evidenceIndex)
    expect(source).toContain('ref="videoRef"')
    // 地址来源：assetId → 资产相对路径；`path:` 型来源直接用后缀
    expect(source).toContain("assetId.startsWith('path:')")
    expect(source).toContain('window.studio.getAssetFileUrl(rel)')
    expect(source).toContain('project.assets.find((a) => a.id === assetId)')
    // 三个选中入口都要 seek（节拍 / 事件 / 实体）
    expect(source.match(/seekVideo\(/g)?.length ?? 0).toBeGreaterThanOrEqual(4) // 定义 1 + 调用 3
    expect(source).toContain('seekVideo(b.timeRange.start)')
    expect(source).toContain('seekVideo(e.timeRange.start)')
    expect(source).toContain('seekVideo(first.range.start)')
    // 夹取走纯函数（越界会被浏览器拒绝）
    expect(source).toContain('clampSeekSeconds(sec, duration)')
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
