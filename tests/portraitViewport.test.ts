import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 人像处理面板视口变换（缩放 / 旋转 / 平移）的接线锁。
 *
 * 为什么用源码文本断言：这些接线**坏掉时不报错**——
 * 指针映射一旦退回 `getBoundingClientRect()`（叠加 `rotate()` 后它给的是外接框，
 * 不是图像四边形），表现是「转个角度之后区域框落点整体偏掉」；
 * 缩放 / 旋转少接一路则是「滚轮越滚画面越跑」。两种都要人对着屏幕才发现，
 * 所以在这里锁住关键几行。
 */

const ROOT = join(__dirname, '..')
const read = (relative: string): string => readFileSync(join(ROOT, relative), 'utf8')

describe('人像处理面板视口变换', () => {
  const source = read('src/renderer/src/components/PortraitEditorDialog.vue')

  it('指针映射走视口逆变换，按自然尺寸归一化', () => {
    const match = /function mapPointerToImage\([\s\S]*?\n\}/.exec(source)
    expect(match, 'mapPointerToImage 不见了').toBeTruthy()
    // 逆变换必须真的用到旋转角与缩放
    expect(match![0]).toContain('rotationDeg.value')
    expect(match![0]).toContain('zoom.value')
    expect(match![0]).not.toContain('(event.clientX - rect.left)')
    // 外接框在缩放 / 旋转后已经不是图像本身的大小：归一化必须除自然尺寸
    expect(match![0]).toContain('localX / naturalW')
    expect(match![0]).toContain('localY / naturalH')
    expect(match![0]).not.toMatch(/\/ imageRect\.(width|height) \+ 0\.5/)
    // 平移已含在 rect 里（变换挂在父层），再减一次会让落点整体偏移
    expect(match![0]).not.toContain('panOffset')
  })

  /**
   * 区域画框：曾经的线上问题是「松手那一步先清 drawing.active，再去读一个
   * 以 active 为条件的 computed」，读到的永远是 null → 每次画完都被当成框太小丢掉。
   * 这里锁住「先取框、后清 active」的顺序与共用同一份取框逻辑。
   */
  it('区域画框：松手时先取框再清 active，画的框不会白画', () => {
    expect(source).toMatch(/const draftBox = computed\(\(\) => currentDraftBox\(\)\)/)
    const draft = /function currentDraftBox\([\s\S]*?\n\}/.exec(source)
    expect(draft, 'currentDraftBox 不见了').toBeTruthy()
    expect(draft![0]).toContain('if (!drawing.active) return null')
    expect(draft![0]).toContain('Math.abs(drawing.x - drawing.startX)')
    expect(draft![0]).toContain('Math.abs(drawing.y - drawing.startY)')

    const up = /function onImagePointerUp\(\)[\s\S]*?\n\}/.exec(source)
    expect(up, 'onImagePointerUp 不见了').toBeTruthy()
    expect(up![0]).toContain('const box = currentDraftBox()')
    expect(up![0].indexOf('const box = currentDraftBox()')).toBeLessThan(
      up![0].indexOf('drawing.active = false')
    )
    // 落下就是一条区域（进撤销栈、写回宿主）
    expect(up![0]).toContain('normalizePortraitManualRegions')
    expect(up![0]).toContain('pushHistory()')
    // 触摸 / 手写笔要能画：画面必须自己接管手势
    const imgRule = /^\.stage-img\s*\{([\s\S]*?)\n\}/m.exec(source)
    expect(imgRule, '.stage-img 规则不见了').toBeTruthy()
    expect(imgRule![1]).toContain('touch-action: none')
  })

  it('画布容器同时带了平移 / 旋转 / 缩放三个变换', () => {
    expect(source).toMatch(
      /translate\(\$\{panOffset\.x\}px[^`]*rotate\(\$\{rotationDeg\.value\}deg\)[^`]*scale\(\$\{zoom\.value\}\)/
    )
  })

  it('旋转有按钮与快捷键两种入口，缩放有滚轮与按钮', () => {
    expect(source).toContain('rotateBy(')
    expect(source).toContain('ROTATE_STEP')
    expect(source).toContain('zoomBy(')
    expect(source).toContain('onStageWheel')
    // Shift+滚轮旋转，普通滚轮缩放
    expect(source).toContain('event.shiftKey')
  })

  it('平移 / 缩放 / 复位都不丢旋转角', () => {
    expect(source).toContain('rotationDeg.value = 0')
    expect(source).toMatch(/function resetView\(\)[\s\S]*?rotationDeg\.value = 0[\s\S]*?\n\}/)
  })

  it('视口文案中英两侧齐全', () => {
    for (const file of [
      'src/renderer/src/i18n/locales/zh-CN.ts',
      'src/renderer/src/i18n/locales/en-US.ts'
    ]) {
      const locale = read(file)
      for (const key of ['rotateCcw', 'rotateCw', 'rotateReset', 'viewHint']) {
        expect(locale, `${file} 缺 ${key}`).toContain(`${key}:`)
      }
    }
  })
})

describe('人像处理面板布局', () => {
  const source = read('src/renderer/src/components/PortraitEditorDialog.vue')
  const rootRule = /\.portrait-root\s*\{([\s\S]*?)\n\}/.exec(source)
  const containerRules = [...source.matchAll(/@container \(max-width:\s*(\d+)px\)/g)].map((m) =>
    Number(m[1])
  )
  const panelHead = /<div class="panel-head">([\s\S]*?)\n        <\/div>/.exec(source)
  const panelActions = /<div class="panel-actions">([\s\S]*?)\n          <\/div>/.exec(source)

  /** 从 `auto 6px minmax(300px, 1fr) var(--portrait-panel-w)` 里取画面列下限 */
  function stageMinWidth(): number {
    const value =
      /grid-template-columns:\s*auto\s+\d+px\s+minmax\((\d+)px,\s*1fr\)\s+var\(--portrait-panel-w\)/.exec(
        rootRule![1]
      )
    expect(value, '四轨没写成 auto + 拖动条 + minmax(画面) + 面板 CSS 变量').toBeTruthy()
    return Number(value![1])
  }

  it('画面列有下限、面板列走 CSS 变量（任一侧都不允许被压到 0）', () => {
    expect(rootRule, '.portrait-root 规则不见了').toBeTruthy()
    const stageMin = stageMinWidth()
    expect(stageMin).toBeGreaterThanOrEqual(240)
    // 面板宽度是运行时状态（拖动滑块写入），必须是变量而不是硬编码常量
    expect(rootRule![1]).toContain('--portrait-panel-w: 360px')
    // 拖动条的命中轨道要真的存在
    expect(rootRule![1]).toMatch(/grid-template-columns:[^;]*auto\s+\d+px\s+minmax/)
  })

  /**
   * 曾经的线上问题：只有工具轨写了 `grid-column: 1 / -1`，画面与面板靠自动放置，
   * 结果面板落到第 2 列、面板该在的那列整列空着 —— 表现就是
   * 「参数面板右边多出一大块空白，参数挤在左半边」。
   * 锁死：画面 = 第 3 列、拖动条 = 第 2 列、面板 = 第 4 列；堆叠档全部改回第 1 列。
   */
  it('画面 / 拖动条 / 面板显式落位（面板必须在最后一列，否则空列会留在右侧）', () => {
    const stageRule = /^\.stage\s*\{([\s\S]*?)\n\}/m.exec(source)
    const panelRule = /^\.panel\s*\{([\s\S]*?)\n\}/m.exec(source)
    const resizerRule = /^\.panel-resizer\s*\{([\s\S]*?)\n\}/m.exec(source)
    expect(stageRule, '.stage 规则不见了').toBeTruthy()
    expect(panelRule, '.panel 规则不见了').toBeTruthy()
    expect(resizerRule, '.panel-resizer 规则不见了').toBeTruthy()
    expect(stageRule![1]).toMatch(/grid-column:\s*3\s*;/)
    expect(resizerRule![1]).toMatch(/grid-column:\s*2\s*;/)
    expect(panelRule![1]).toMatch(/grid-column:\s*4\s*;/)
    expect(stageRule![1]).toMatch(/grid-row:\s*2\s*;/)
    expect(panelRule![1]).toMatch(/grid-row:\s*2\s*;/)

    // 堆叠档只剩一列：画面与面板都必须回到第 1 列，否则会落进自动补出来的列里
    const stack = /@container \(max-width:\s*820px\)\s*\{([\s\S]*?)\n\}/.exec(source)
    expect(stack, '没找到 820px 堆叠档').toBeTruthy()
    expect(stack![1]).toMatch(/\.stage\s*\{[^}]*grid-column:\s*1\s*;/)
    expect(stack![1]).toMatch(/\.panel\s*\{[^}]*grid-column:\s*1\s*;/)
    // 堆叠后左右关系不存在：拖动条整体隐藏
    expect(stack![1]).toMatch(/\.panel-resizer\s*\{[^}]*display:\s*none\s*;/)
  })

  it('窄窗降级阈值必须高于「画面下限 + 面板下限」，否则并排时网格会强行压轨道', () => {
    const stageMin = stageMinWidth()
    const panelMin = Number(/const PANEL_MIN_WIDTH = (\d+)/.exec(source)?.[1] ?? 0)
    expect(panelMin, '没读到 PANEL_MIN_WIDTH').toBeGreaterThan(0)
    // 这是曾经的线上问题：阈值 840 < 画面/面板下限之和，于是窗口分屏到 ~700px 时
    // 降级不触发、画面被压到 0、参数面板挤成一字一行。
    expect(containerRules.length, '没有 @container 降级档').toBeGreaterThan(0)
    const stackThreshold = Math.min(...containerRules)
    expect(stackThreshold).toBeGreaterThan(stageMin + panelMin)
    // 中窄档必须真的把面板收窄（否则它没有存在意义）
    expect(containerRules.some((px) => px > stageMin + panelMin)).toBe(true)
  })

  it('面板自身有 min-width 兜底（父容器异常变窄时也不会塌成一条）', () => {
    // `.panel` 有两处规则（显式落位 + 主样式），取带 flex 的那条主样式
    const panelMain = [...source.matchAll(/^\.panel\s*\{([\s\S]*?)\n\}/gm)]
      .map((m) => m[1])
      .find((body) => body.includes('flex-direction'))
    expect(panelMain, '.panel 主样式不见了').toBeTruthy()
    const minWidth = /min-width:\s*(\d+)px/.exec(panelMain!)
    expect(minWidth, '.panel 缺 min-width 兜底').toBeTruthy()
    expect(Number(minWidth![1])).toBeGreaterThanOrEqual(280)
  })

  it('重置（本组 / 全部）落在面板最上面，底边动作行只留「保存并出图」', () => {
    expect(panelHead, '.panel-head 不见了').toBeTruthy()
    expect(panelHead![1]).toContain('panel-title')
    // 重置搬到面板头：档位改坏了不用先滚到底部
    expect(panelHead![1]).toContain('resetGroup')
    expect(panelHead![1]).toContain('resetAll')
    expect(panelHead![1]).not.toContain('runNode')

    // 出图留在底边动作行（属性滚动区之后）
    expect(panelActions, '.panel-actions 不见了').toBeTruthy()
    expect(source.indexOf('class="panel-actions"')).toBeGreaterThan(
      source.indexOf('class="panel-body"')
    )
    expect(panelActions![1]).toContain('runNode')
    expect(panelActions![1]).toContain('emitRun')
    expect(panelActions![1]).not.toContain('resetGroup')
    expect(panelActions![1]).not.toContain('resetAll')
    // 窄面板下按钮宁可折行，也不要被压成竖排文字
    const actionsRule = /\.panel-actions\s*\{([\s\S]*?)\n\}/.exec(source)
    expect(actionsRule![1]).toContain('flex-wrap: wrap')
    // 面板头也要允许折行，否则组名 + 两颗重置在窄面板里会挤爆
    const headRule = /^\.panel-head\s*\{([\s\S]*?)\n\}/m.exec(source)
    expect(headRule![1], '.panel-head 规则不见了').toBeTruthy()
    expect(headRule![1]).toContain('flex-wrap: wrap')
  })

  it('「保存并出图」带图片模型下拉，选择进载荷也进 AI 增强', () => {
    const foot = /<div class="panel-foot">([\s\S]*?)\n        <\/div>/.exec(source)
    expect(foot, '.panel-foot 不见了').toBeTruthy()
    // 下拉与出图按钮同处底边动作区
    expect(foot![1]).toContain('ImageGenerateModelField')
    expect(foot![1]).toContain('ref="modelFieldEl"')
    expect(foot![1]).toContain('@change="onModelChange"')
    expect(foot![1]).toContain('runNode')
    expect(source).toContain("import ImageGenerateModelField from './ImageGenerateModelField.vue'")

    // 选中即写回节点：载荷里的模型来自下拉，AI 增强也读同一处
    expect(source).toMatch(/function buildPayload\(\)[\s\S]*?currentModelSelection\(\)/)
    expect(source).toContain('generateModel: model.generateModel')
    expect(source).toContain('generateProviderInstanceId: model.generateProviderInstanceId')
    expect(source).toMatch(/function runAi\([\s\S]*?currentModelSelection\(\)/)
    // 子组件挂载时解析出的首个默认值只填草稿，不算用户改过 —— 免得「开窗即给节点钉上模型」
    expect(source).toContain('let modelResolving = true')
    expect(source).toMatch(/if \(resolving\) return/)
  })

  it('提示词预览排在属性滚动区内、参数之后（不与底边动作行挤在一起）', () => {
    const block = /<section class="form-block prompt-block"[\s\S]*?<\/section>/.exec(source)
    expect(block, '提示词预览块不见了').toBeTruthy()

    const bodyStart = source.indexOf('class="panel-body"')
    const bodyEnd = source.indexOf('class="panel-foot"')
    const promptAt = source.indexOf('class="form-block prompt-block"')
    expect(bodyStart, '没有 .panel-body').toBeGreaterThan(-1)
    expect(bodyEnd, '没有 .panel-foot').toBeGreaterThan(bodyStart)
    // 提示词必须落在「参数区」里（panel-body 内部），而不是底部动作行那一层
    expect(promptAt).toBeGreaterThan(bodyStart)
    expect(promptAt).toBeLessThan(bodyEnd)
    // 预览文案、复制按钮、折叠开关三件套都在块内
    expect(block![0]).toContain('graph.portrait.promptPreview')
    expect(block![0]).toContain('copyPrompt')
    expect(block![0]).toContain('togglePromptCollapsed')
    expect(block![0]).toContain('promptCollapsed')
    // 折叠靠 class 切换 + textarea 隐藏，不能只是视觉上被盖住
    expect(source).toContain(':class="{ collapsed: promptCollapsed }"')
    expect(source).toContain('.prompt-block.collapsed .text-area.prompt')
  })

  it('提示词文本框右下角能拖（原生缩放柄 + 同源底色 + 不被 flex 压回去）', () => {
    const rule = /\.text-area\.prompt\s*\{([\s\S]*?)\n\}/.exec(source)
    expect(rule, '.text-area.prompt 规则不见了').toBeTruthy()
    // 曾经这里是 resize: none —— 右下角连手柄都没有
    expect(rule![1]).toContain('resize: vertical')
    expect(rule![1]).not.toContain('resize: none')
    // 参数区是 flex 列：不声明不压缩，拖出来的高度会被布局立刻压回去
    expect(rule![1]).toContain('flex: 0 0 auto')
    const blockRule = /^\.prompt-block\s*\{([\s\S]*?)\n\}/m.exec(source)
    expect(blockRule, '.prompt-block 规则不见了').toBeTruthy()
    expect(blockRule![1]).toContain('flex: 0 0 auto')
    // 缩放柄本体是全局主题化样式（斜纹用 --resizer-grip），本组件不自绘硬编码色手柄
    expect(source).toMatch(/--textarea-bg:\s*var\(--bg-input/)
    const mainCss = read('src/renderer/src/styles/main.css')
    expect(mainCss).toMatch(
      /textarea::-webkit-resizer\s*\{[\s\S]*?background-image:\s*var\(--resizer-grip\)/
    )
    // 没有自绘手柄：模板里不该冒出新的 split-handle 之类伪元素规则
    expect(source).not.toContain('.text-area.prompt::-webkit-resizer')
  })

  it('提示词折叠态文案中英齐全', () => {
    for (const file of [
      'src/renderer/src/i18n/locales/zh-CN.ts',
      'src/renderer/src/i18n/locales/en-US.ts'
    ]) {
      expect(read(file), `${file} 缺 promptToggle`).toContain('promptToggle:')
    }
  })
})

/**
 * 「对比原图」按钮：发布说明里写了这个能力，但组件里一直没实现（右下角只剩
 * 缩放 / 旋转）。这里锁住三件事：按钮在底栏、按住走同一个 ref、没有可比对象时隐藏。
 */
describe('人像处理「对比原图」', () => {
  const source = read('src/renderer/src/components/PortraitEditorDialog.vue')

  it('按钮挂在底栏、紧挨来源徽标，并带按住 / 松开两路指针事件', () => {
    const bar = /<div class="stage-bar">([\s\S]*?)<span class="view-group">/.exec(source)
    expect(bar, 'stage-bar 头部不见了').toBeTruthy()
    expect(bar![1]).toContain('sourceBadge')
    expect(bar![1]).toContain('compare-btn')
    expect(bar![1]).toContain('@pointerdown="onCompareDown"')
    expect(bar![1]).toContain('@pointerup="onCompareUp"')
    // 指针移出 / 取消 / 失焦都要复位，否则会卡在「正在看原图」
    expect(bar![1]).toContain('@pointerleave="onCompareUp"')
    expect(bar![1]).toContain('@pointercancel="onCompareUp"')
    expect(bar![1]).toContain('@blur="onCompareUp"')
    // 键盘空格也能按住对比
    expect(bar![1]).toContain('@keydown.space.prevent="onCompareDown"')
    expect(bar![1]).toContain('@keyup.space.prevent="onCompareUp"')
  })

  it('按住时画面切到上游原图，松开回到当前底图', () => {
    expect(source).toMatch(
      /const stageImageUrl = computed\(\(\) =>\s*compareHeld\.value && canCompare\.value \? upstreamUrl\.value : \(props\.sourceUrl \?\? ''\)\s*\)/
    )
    // 舞台图必须用 stageImageUrl，不能还是直接绑定 sourceUrl
    expect(source).toMatch(/class="stage-img"\s*\n\s*:src="stageImageUrl"/)
    expect(source).toContain('function onCompareDown(')
    expect(source).toContain('function onCompareUp(')
  })

  it('没有可比对象（当前底图就是上游原图）时按钮置灰而不是消失', () => {
    expect(source).toMatch(
      /const canCompare = computed\(\s*\(\) => !!upstreamUrl\.value && upstreamUrl\.value !== \(props\.sourceUrl\?\.trim\(\) \?\? ''\)\s*\)/
    )
    // 有上游原图就渲染按钮，可比性只控制 disabled —— 免得用户以为控件又没了
    expect(source).toContain('v-if="upstreamUrl"')
    expect(source).toContain(':disabled="!canCompare"')
    expect(source).toContain('compareUnavailable')
    // 上游原图由宿主解析后传入，组件不自己发明来源
    expect(source).toContain('upstreamUrl?: string')
  })

  it('对比文案中英齐全', () => {
    for (const file of [
      'src/renderer/src/i18n/locales/zh-CN.ts',
      'src/renderer/src/i18n/locales/en-US.ts'
    ]) {
      const locale = read(file)
      for (const key of [
        'compare:',
        'compareShowing:',
        'compareHoldHint:',
        'compareUnavailable:',
        'compareSplit:',
        'compareSplitHint:',
        'compareSideOriginal:',
        'compareSideCurrent:'
      ]) {
        expect(locale, `${file} 缺 ${key}`).toContain(key)
      }
    }
  })

  /**
   * 分割对比：切开画面看原图与当前底图的差别，中缝可拖。
   * 坏掉时不会报错，只会「拖不动」或「转个角度分割线就落不到指针下」，所以锁住接线。
   */
  it('分割对比：中缝可拖（含键盘），左原图右当前', () => {
    const bar = /<div class="stage-bar">([\s\S]*?)<span class="view-group">/.exec(source)
    expect(bar, 'stage-bar 头部不见了').toBeTruthy()
    // 切换按钮与「按住对比」并排，同样在没有可比对象时置灰
    expect(bar![1]).toContain('toggleCompareSplit')
    expect(bar![1]).toContain("t('graph.portrait.compareSplit')")

    // 原图叠在底图上，按比例裁掉右侧；两侧各有一枚标签
    expect(source).toMatch(/class="split-img"[\s\S]*?:style="splitClipStyle"/)
    expect(source).toMatch(
      /const splitClipStyle = computed\(\(\) => \(\{\s*clipPath: `inset\(0 \$\{\(1 - splitRatio\.value\) \* 100\}% 0 0\)`\s*\}\)\)/
    )
    expect(source).toContain('compareSideOriginal')
    expect(source).toContain('compareSideCurrent')

    // 手柄：可访问语义 + 指针 / 键盘两路入口 + 命中区加宽
    const handle =
      /<div\s+v-if="splitActive"[\s\S]*?class="split-handle"[\s\S]*?\n            >/.exec(source)
    expect(handle, 'split-handle 不见了').toBeTruthy()
    expect(handle![0]).toContain('role="separator"')
    expect(handle![0]).toContain('@pointerdown="onSplitPointerDown"')
    expect(handle![0]).toContain('@keydown="onSplitKeydown"')
    expect(handle![0]).toContain('tabindex="0"')
    expect(source).toContain('function onSplitKeydown(')
    expect(source).toContain('.split-handle::after')
    // 中缝与标签在 scale(zoom) 的容器里：按 1/zoom 抵消，放大后细线不会胀成宽带
    expect(source).toMatch(
      /const splitCounterScale = computed\(\(\) => \(zoom\.value > 0 \? 1 \/ zoom\.value : 1\)\)/
    )
    expect(source).toContain('scaleX(${splitCounterScale.value})')

    // 拖动走视口逆变换：旋转 / 缩放之后分割线仍落在指针下（不用外接框）
    expect(source).toMatch(/function onSplitPointerMove\([\s\S]*?mapPointerToImage\(event\)/)
    expect(source).toContain('setPointerCapture')
    // 指针移出画面也不断：窗口级监听同样驱动中缝
    expect(source).toMatch(/function onWindowPointerMove\([\s\S]*?onSplitPointerMove\(event\)/)
    expect(source).toMatch(/function onWindowPointerUp\([\s\S]*?onSplitPointerUp\(\)/)
    // 区域组里只认手柄，免得抢掉画框手势
    expect(source).toContain('splitDragSurface')
    expect(source).toMatch(
      /const splitDragSurface = computed\(\(\) => splitActive\.value && activeGroup\.value !== 'region'\)/
    )
    // 比例与开关落盘（下次开窗还是这个位置）
    expect(source).toContain("const COMPARE_SPLIT_KEY = 'portrait.compareSplit'")
    expect(source).toContain("const SPLIT_RATIO_KEY = 'portrait.splitRatio'")
    expect(source).toContain('function persistSplitPrefs(')
  })
})

/**
 * 画面 ↔ 参数之间的拖动滑块。坏掉时不会报错，只会「拖不动」或「拖完不记得」，
 * 所以这里锁住接线：指针能按住、移动走窗口级监听（指针移出滑块也不断）、
 * 松手落盘、宽度有上下限。
 */
describe('人像处理参数面板拖动滑块', () => {
  const source = read('src/renderer/src/components/PortraitEditorDialog.vue')

  it('滑块在模板里、带可访问语义与指针 / 键盘两路入口', () => {
    const handle = /<div\s+v-if="resizable"[\s\S]*?class="panel-resizer"[\s\S]*?\/>/.exec(source)
    expect(handle, 'panel-resizer 不见了').toBeTruthy()
    expect(handle![0]).toContain('role="separator"')
    expect(handle![0]).toContain('@pointerdown="onResizePointerDown"')
    expect(handle![0]).toContain('@pointermove="onResizePointerMove"')
    expect(handle![0]).toContain('@pointerup="onResizePointerUp"')
    expect(handle![0]).toContain('@pointercancel="onResizePointerUp"')
    expect(handle![0]).toContain('@keydown="onResizeKeydown"')
    expect(handle![0]).toContain('tabindex="0"')
  })

  it('拖动只改面板列宽（CSS 变量），画面列自动吃差额', () => {
    // 根元素把 panelWidth 写成内联 CSS 变量，网格第 4 轨用的就是这个变量
    expect(source).toMatch(/'--portrait-panel-w':\s*`\$\{panelWidth\}px`/)
    expect(source).toMatch(
      /grid-template-columns:\s*auto\s+\d+px\s+minmax\(300px,\s*1fr\)\s+var\(--portrait-panel-w\)/
    )
    // 指针往左 = 面板变宽
    expect(source).toMatch(
      /panelWidth\.value = clampPanelWidth\(resizeStart\.width - \(event\.clientX - resizeStart\.x\)\)/
    )
  })

  it('指针移出滑块也不断：移动 / 松手都走窗口级监听', () => {
    expect(source).toMatch(/function onWindowPointerMove\([\s\S]*?onResizePointerMove\(event\)/)
    expect(source).toMatch(/function onWindowPointerUp\([\s\S]*?onResizePointerUp\(\)/)
    expect(source).toContain("window.addEventListener('pointermove', onWindowPointerMove)")
    expect(source).toContain("window.addEventListener('pointerup', onWindowPointerUp)")
    expect(source).toContain("window.removeEventListener('pointerup', onWindowPointerUp)")
    // 指针捕获：按住后移出滑块仍能收到事件
    expect(source).toContain('setPointerCapture')
  })

  it('宽度被夹在上下限内并落盘，堆叠档下没有隐身拖拽区', () => {
    expect(source).toMatch(/const PANEL_MIN_WIDTH = (\d+)/)
    expect(source).toMatch(/const PANEL_MAX_WIDTH = (\d+)/)
    const min = Number(/const PANEL_MIN_WIDTH = (\d+)/.exec(source)![1])
    const max = Number(/const PANEL_MAX_WIDTH = (\d+)/.exec(source)![1])
    expect(min).toBeGreaterThanOrEqual(280)
    expect(max).toBeGreaterThan(min)
    expect(source).toContain('function clampPanelWidth(')
    // 松手落盘
    expect(source).toMatch(
      /function onResizePointerUp\([\s\S]*?resizing\.value = false\s*\n\s*persistPanelWidth\(\)/
    )
    // 容器窄到堆叠档时滑块消失，且 ResizeObserver 的阈值与 CSS 的 @container 对齐
    expect(source).toContain('resizable.value = width > 820')
    expect(source).toMatch(/@container \(max-width:\s*820px\)/)
  })
})
