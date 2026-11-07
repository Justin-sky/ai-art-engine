import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 语义时间线 dive 的轨道布局守卫（尺寸 / 字号 / 滚动 / 左侧固定栏 / 两栏拖拽 / 视频预览）。
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
    expect(top * 2 + block).toBeLessThanOrEqual(track)
  })

  it('轨道上的字号足够大（块文字 ≥13px，标签/刻度 ≥12px）', () => {
    expect(pxOf('.stl-block', 'font-size')).toBeGreaterThanOrEqual(13)
    expect(pxOf('.stl-row-label', 'font-size')).toBeGreaterThanOrEqual(13)
    expect(pxOf('.stl-tick', 'font-size')).toBeGreaterThanOrEqual(12)
    expect(pxOf('.stl-layer-title', 'font-size')).toBeGreaterThanOrEqual(13)
  })

  it('轨道名固定在左侧栏（sticky + 在流内占位，不绝对定位压块）', () => {
    const label = cssBlock('.stl-row-label')
    expect(label).toMatch(/position:\s*sticky/)
    expect(label).toMatch(/left:\s*0/)
    expect(label).toContain('var(--stl-gutter)')
    expect(label).not.toMatch(/position:\s*absolute/)
    expect(label).toMatch(/background:\s*var\(--bg-panel\)/)
    expect(source).toContain('class="stl-row-label"')
    expect(source).not.toContain('stl-ent-label')
    const labelIndex = source.indexOf('class="stl-row-label"')
    const trackIndex = source.indexOf('class="stl-track"')
    expect(labelIndex).toBeGreaterThan(-1)
    expect(trackIndex).toBeGreaterThan(labelIndex)
    expect(cssBlock('.stl-ruler')).toContain('margin-left: var(--stl-gutter)')
    const scroll = cssBlock('.stl-scroll')
    expect(scroll).toMatch(/padding:\s*8px 12px 16px 0/)
    expect(scroll).not.toMatch(/padding:\s*8px 12px 16px;/)
  })

  it('层标题与空态同样固定（sticky + 收缩宽度）', () => {
    const title = cssBlock('.stl-layer-title')
    expect(title, '层标题缺少样式').toBeTruthy()
    expect(title).toMatch(/position:\s*sticky/)
    expect(title).toMatch(/left:\s*0/)
    expect(title, '未收缩宽度（sticky 会失效）').toMatch(/width:\s*fit-content/)
    expect(title).toMatch(/background:\s*color-mix\(/)

    const empty = cssBlock('.stl-empty')
    expect(empty, '空态缺少样式').toBeTruthy()
    expect(empty).toMatch(/position:\s*sticky/)
    expect(empty).toMatch(/left:\s*0/)
    expect(empty).toMatch(/width:\s*fit-content/)
    expect(empty).toMatch(/background:\s*var\(--bg-panel\)/)
  })

  it('层标题栏有独立样式（背景条 + 分割线 + 主题色竖条），与轨道名拉开层次', () => {
    const head = cssBlock('.stl-layer-head')
    expect(head, '缺少标题栏样式').toBeTruthy()
    expect(head, '缺上分割线').toMatch(/border-top:\s*1px solid/)
    expect(head, '缺下分割线').toMatch(/border-bottom:\s*1px solid/)
    expect(head, '缺背景条').toMatch(/background:\s*color-mix\(/)
    for (const [modifier, accent] of [
      ['.stl-layer--footage', '#457b9d'],
      ['.stl-layer--entity', '#2a9d8f']
    ] as const) {
      const block = cssBlock(modifier)
      expect(block, `${modifier} 缺主题色`).toContain(accent)
      expect(block).toMatch(/--layer-accent\s*:/)
    }
    const title = cssBlock('.stl-layer-title')
    expect(title, '标题缺主题色竖条').toMatch(/box-shadow:\s*inset 3px 0 0 var\(--layer-accent\)/)
    expect(title, '标题未加粗').toMatch(/font-weight:\s*600/)
    expect(title, '标题未提亮（仍与轨道名同色）').toMatch(/color:\s*var\(--text\)/)
    const label = cssBlock('.stl-row-label')
    expect(label).not.toMatch(/font-weight/)
    expect(label).not.toMatch(/box-shadow/)
    expect(label).toMatch(/color:\s*var\(--text-muted\)/)
  })

  it('检查器面板常驻且钉在固定位置', () => {
    expect(source).toContain('class="stl-inspector"')
    expect(source).toContain("t('graph.semanticTimeline.selectHint')")
    expect(source).toContain('v-if="!resolvedSelection"')
    expect(source).toMatch(/<SemanticSelectionInspector\s+v-else/)
    const panel = cssBlock('.stl-inspector')
    expect(panel).toMatch(/align-self:\s*stretch/)
    expect(panel).not.toMatch(/align-self:\s*flex-start/)
    expect(panel).toMatch(/max-height:\s*100%/)
    expect(panel).toMatch(/overflow:\s*auto/)
    expect(panel).toMatch(/flex:\s*0 0 clamp\(420px, 44%, 720px\)/)
  })

  it('原视频宽度吃满右栏（出血 + contain + 按比例自适应）', () => {
    const sourceBox = cssBlock('.stl-source')
    expect(sourceBox).toMatch(/margin:\s*-12px -12px/)
    expect(sourceBox).toMatch(/background:\s*var\(--bg-panel\)/)
    expect(sourceBox).not.toMatch(/position:\s*sticky/)
    const video = cssBlock('.stl-source-video')
    expect(video).toMatch(/width:\s*100%/)
    expect(video).toMatch(/height:\s*auto/)
    expect(video).not.toMatch(/height:\s*\d+px/)
    expect(video).not.toMatch(/max-height/)
    expect(video).toMatch(/object-fit:\s*contain/)
    expect(source).toContain('sourceAspectRatio(')
    expect(source).toContain(':style="sourceAspect ? { aspectRatio: sourceAspect } : undefined"')
  })

  it('检查器面板上方是原视频，且选中各轨 clip 会移动播放条', () => {
    const videoIndex = source.indexOf('class="stl-source-video"')
    const inspectorIndex = source.indexOf('<SemanticSelectionInspector')
    expect(videoIndex, '缺少原视频节点').toBeGreaterThan(-1)
    expect(inspectorIndex, '缺少检查器').toBeGreaterThan(-1)
    expect(videoIndex, '视频必须在检查器之前（面板上方）').toBeLessThan(inspectorIndex)
    expect(source).toContain('ref="videoRef"')
    expect(source).toContain("assetId.startsWith('path:')")
    expect(source).toContain('window.studio.getAssetFileUrl(rel)')
    expect(source).toContain('project.assets.find((a) => a.id === assetId)')
    expect(source.match(/seekVideo\(/g)?.length ?? 0).toBeGreaterThanOrEqual(4)
    expect(source).toContain('seekVideo(shot.range.start)')
    expect(source).toContain('seekVideo(line.range.start)')
    expect(source).toContain('appearanceSeekSeconds(e.appearances, index)')
    expect(source).toContain('seekVideo(start)')
    expect(source).toContain('clampSeekSeconds(sec, dur)')
  })

  it('实体片段上写着实体名（长名截断）', () => {
    expect(source).toContain('{{ ent.name }}')
    expect(source).toMatch(/@click="selectEntity\(ent, i\)"\s*\n\s*>\s*\n\s*\{\{ ent\.name \}\}/)
    const block = cssBlock('.stl-block')
    expect(block).toMatch(/overflow:\s*hidden/)
    expect(block).toMatch(/text-overflow:\s*ellipsis/)
    expect(block).toMatch(/white-space:\s*nowrap/)
  })

  it('高亮按片段键（实体带出现序号，镜头与台词用 id）', () => {
    expect(source).toContain('const selection = ref<SemanticSelection | null>(null)')
    expect(source).toContain(
      'const selectedClip = computed(() => selectionClipKey(selection.value))'
    )
    expect(source).toContain('function clipKey(id: string, suffix?: string | number)')
    expect(source).toContain(':class="{ selected: selectedClip === clipKey(ent.id, i)')
    expect(source).toContain('selected: selectedClip === clipKey(shot.id)')
    expect(source).toContain('selected: selectedClip === clipKey(line.id)')
    expect(source).not.toContain('selected: selectedId === ent.id')
    expect(source).toContain("selection.value = { kind: 'entity', id: e.id, clip: index ?? 0 }")
  })

  it('实体片段点击传出现索引（不是永远跳第一次出现）', () => {
    expect(source).toContain('@click="selectEntity(ent, i)"')
    expect(source).not.toContain('@click="selectEntity(ent)"')
    expect(source).toContain('appearanceSeekSeconds(')
    expect(source).toContain('function selectEntity(e: Entity, index?: number)')
    expect(source).toContain('${ent.name} · ${ap.range.start.toFixed(2)}')
  })

  it('镜头 / 复刻批次 / 台词 / 包装层 / 实体五类轨道块都绑了点击', () => {
    expect(source).toContain('@click="selectShot(shot)"')
    expect(source).toContain('@click="selectUnitBlock(ub)"')
    expect(source).toContain('@click="selectDialogue(line)"')
    expect(source).toContain('@click="selectOverlayBlock(ov)"')
    expect(source).toContain('@click="selectEntity(ent, i)"')
  })

  it('两栏之间有可拖动手柄（鼠标 + 键盘 + 持久化 + 命中区够宽）', () => {
    expect(source).toContain('class="stl-splitter"')
    expect(source).toContain('@mousedown.prevent="onSplitterDown"')
    expect(source).toContain('@keydown="onSplitterKeydown"')
    expect(source).toContain('tabindex="0"')
    expect(source).toContain('role="separator"')
    expect(source).toContain("window.addEventListener('mousemove', onMove)")
    expect(source).toContain("window.removeEventListener('mousemove', onMove)")
    expect(source).toMatch(/isSplitterDragging\.value = false\s*\n\s*persistSideWidth\(\)/)
    expect(source).toMatch(
      /clampSidePaneWidth\(currentSideWidth\(rect\) \+ direction \* 24[\s\S]{0,160}?persistSideWidth\(\)/
    )
    expect(source).toContain('localStorage')
    expect(source).toContain('sidePaneWidthFromPointer({')
    expect(source).toContain('clampSidePaneWidth(')
    expect(source).toContain("flexBasis: sidePaneWidth + 'px'")
    const splitter = cssBlock('.stl-splitter')
    expect(splitter).toMatch(/cursor:\s*col-resize/)
    expect(splitter).toMatch(/flex:\s*0 0 \d+px/)
    expect(Number(/flex:\s*0 0 (\d+)px/.exec(splitter)?.[1] ?? 0)).toBeGreaterThanOrEqual(6)
  })

  it('轨道名与实体 kind 全部走 i18n（不直接渲染裸机器值）', () => {
    expect(source).toMatch(
      /import \{[\s\S]*?entityKindKey[\s\S]*?\} from '\.\.\/features\/graph\/model\/semanticTimelineView'/
    )
    expect(source).toContain('entityKindLabel(selectedEntity.item.kind)')
    expect(source).not.toContain('{{ selectedEntity.item.kind }}')
    for (const key of ['trackShots', 'trackUnits', 'trackDialogue', 'trackOverlays']) {
      expect(source).toContain(`t('graph.semanticTimeline.${key}')`)
    }
  })

  it('缩放符号按钮居中（flex 居中 + padding 归零 + 定尺寸）', () => {
    const btn = cssBlock('.stl-zoombar-btn')
    expect(btn, '缺少按钮样式').toBeTruthy()
    expect(btn).toMatch(/display:\s*inline-flex/)
    expect(btn).toMatch(/align-items:\s*center/)
    expect(btn).toMatch(/justify-content:\s*center/)
    expect(btn).toMatch(/padding:\s*0/)
    expect(btn).toMatch(/line-height:\s*1/)
    const w = pxOf('.stl-zoombar-btn', 'width')
    const h = pxOf('.stl-zoombar-btn', 'height')
    expect(w).toBe(h)
  })

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
