import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 录制 HUD 的**接线守卫**（源码级）。
 *
 * 这个组件存在的理由很特殊：`webContents.capturePage()` 只录渲染出来的页面、**录不到系统鼠标指针**，
 * 所以高亮框 / 步骤标题 / 合成光标必须由页面自己画 —— 它们才会出现在截下来的每一帧里。
 * 也就是说这里画的不是「界面装饰」，而是成片里观众唯一能看到的教学提示。
 *
 * 仓库的 vitest 跑在 `environment: 'node'`，没有 jsdom、也没有 @vue/test-utils，
 * 组件装不起来（`window.studio` 与 DOM 都不存在）。所以这里按既有约定钉**结构契约**：
 * 哪一行 CSS 不能被删、订阅必须成对、挂载点必须在市场分支之外、两侧文案键都得在。
 * 任何一处被改坏（例如有人给根层加上 `pointer-events: auto`、或把组件挪进市场分支），这里会红。
 *
 * ## 编码阶段（phase）的守卫为什么写成这个形状
 *
 * 本组件有过一次「守卫在行为被删掉之后依然是绿的」的教训，所以这里**不靠 `toContain('encoding')`**
 * 这种子串存在性断言（它连「`visible` 定义了却没人用」都抓不到）。凡是能把断言钉在真实结构上的，
 * 都钉死了：根元素 `v-if` 的**属性值**、`visible` 表达式的完整条件、`restartClock()` 的**整段函数体**、
 * 以及配对取出来的**编码徽标 DOM 块**。这样「行为被删掉」和「行为被改坏」都会红。
 */
const read = (...parts: string[]): string => readFileSync(resolve(...parts), 'utf8')

const HUD_PATH = resolve('src/renderer/src/components/RecordingHud.vue')
const HUD = read('src/renderer/src/components/RecordingHud.vue')
const APP = read('src/renderer/src/App.vue')
const ZH = read('src/renderer/src/i18n/locales/zh-CN.ts')
const EN = read('src/renderer/src/i18n/locales/en-US.ts')

/** 取 `<style …>…</style>` 的内容：模板里也可能出现同名类名，断言样式时必须只看样式块 */
function styleBlockOf(source: string): string {
  return source.match(/<style[^>]*>([\s\S]*?)<\/style>/)?.[1] ?? ''
}

/** 取组件某个 CSS 规则的声明体（从选择器到配对的 `}`，样式块内没有嵌套规则） */
function ruleBodyOf(style: string, rawSelector: string): string {
  /*
    传入的选择器**不要带 ` {`**：带上就会被当成选择器的一部分（`.hud-focus {` → 找 `.hud-focus { {`），
    断言就会以「找不到这条规则」的形式误导性地红掉。这里顺手把尾部的 `{` 去掉，
    调用处写成 `.hud-focus {` 也不会踩坑。
  */
  const selector = rawSelector.replace(/\s*\{$/, '')
  /*
    选择器允许折行：prettier 会把 `.a,\n.b {` 拆成两行，所以必须正则匹配
    「行首选择器 + 可选空白 + {」。用 indexOf 会在选择器是另一个规则名前缀时（`.hud-title`
    命中 `.hud-titlebar`）取到错位的规则体。
    末尾的 `(?![\w-])` 是必须的：`.hud-title` 也会在 `.hud-titlebar` 的规则里匹配到，
    而 `.hud-title` 自己写在多行选择器列表（`.hud-label,\n.hud-title { … }`）里，
    不带这个否定断言时会取到 `.hud-label` 那条的规则体。
  */
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const rule = style.match(
    new RegExp(`(?:^|\\n)\\s*${escaped}(?![\\w-])\\s*\\{([\\s\\S]*?)\\n\\s*\\}`)
  )
  expect(rule, `样式块里应当有 ${selector} 规则`).not.toBeNull()
  return rule?.[1] ?? ''
}

/**
 * 从 `openIndex` 处那个 `{` 开始，配对出整段花括号内容（用括号深度计，不是 `}` 的正则）。
 *
 * 不用 `/\{([\s\S]*?)\n\}/` 这类正则：函数体里本来就有嵌套块，懒惰匹配会提前在第一个
 * 顶格 `}` 前截断，于是断言实际只看到了函数的一半 —— 那正是「守卫看着在、其实没在守」的来源。
 */
function balancedBlock(source: string, openIndex: number): string | null {
  let depth = 0
  for (let i = openIndex; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1
    else if (source[i] === '}') {
      depth -= 1
      if (depth === 0) return source.slice(openIndex + 1, i)
    }
  }
  return null
}

/**
 * 取「某条声明」的完整实现体：先按 `pattern` 定位声明行，再配对它的花括号。
 *
 * 简洁箭头体（`computed(() => a || b)`，没有花括号）要单独处理：此时本行找不到 `{`，
 * 直接取到行尾 —— 否则会一路找到下一条声明的 `{`，把**别的**函数体当成它的实现
 * （这个坑在本文件的 probe 里真实踩到过：`visible` 取到了 `progressPercent` 的函数体）。
 */
function declBodyOf(source: string, pattern: RegExp): string {
  const head = source.match(pattern)
  expect(head, `源码里应当有 ${pattern} 这条声明`).not.toBeNull()
  const after = (head?.index ?? 0) + (head?.[0].length ?? 0)
  const lineEnd = source.indexOf('\n', head?.index ?? 0)
  const open = source.indexOf('{', after)
  if (open === -1 || open > lineEnd) return source.slice(after, lineEnd)
  const body = balancedBlock(source, open)
  expect(body, `应当能配对出 ${pattern} 的花括号`).not.toBeNull()
  return body ?? ''
}

/**
 * 去掉 `//` 行注释并压平空白：用于「整段实现体必须长得一模一样」这类断言。
 *
 * 之所以要剥注释：注释是给后人解释「为什么」的，改一改措辞不该让守卫变红；而实现本身
 * （哪个条件、什么顺序、开不开表）必须一字不差。所以比对的是**剥掉注释后的代码形状**。
 */
function normalizedCode(source: string): string {
  return source
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * 取组件模板里某个 `<div …>…</div>` 的整块（含子元素）。
 *
 * `openPattern` 必须精确匹配到开标签（属性值一起匹配）：这样「把编码徽标挪进录制徽标里」
 * 这类改动会让匹配失败，而不是断言静静地继续绿。
 *
 * 取不到时返回空串而**不在这里断言**：调用点都在模块顶层，真在这里抛异常就整个文件收不上来，
 * vitest 只报一个匿名的「Failed Suites」，看不出是哪条守卫拦下的。空串交给用到它的用例断言，
 * 失败就会挂在**那条用例**名下（本文件两种都试过：匿名收集失败确实能变红，但定位差得多）。
 *
 * 数的是 **`<div>` 标签深度**，不是花括号：模板里有 `{{ … }}` 插值（还有 `{ percent }` 这种
 * 对象字面量），按花括号配对会在插值处提前收尾 —— 那样取到的「块」其实只有前半截，
 * 断言看着在守其实只守了半块（本文件真踩过：编码块被截到 `{{ t(...) }` 就断了）。
 */
function pairedDivBlock(source: string, openPattern: RegExp): string {
  const head = source.match(openPattern)
  if (!head) return ''
  const start = (head.index ?? 0) + head[0].length
  let depth = 1
  let cursor = start
  while (cursor < source.length) {
    const openAt = source.indexOf('<div', cursor)
    const closeAt = source.indexOf('</div>', cursor)
    if (closeAt === -1) break
    if (openAt !== -1 && openAt < closeAt) {
      depth += 1
      cursor = openAt + 4
      continue
    }
    depth -= 1
    if (depth === 0) return source.slice(start, closeAt)
    cursor = closeAt + 6
  }
  return ''
}

/** 取模板里某个徽标块的整块；取不到就返回空串（由调用它的用例断言，见上） */
function badgeBlockOf(openPattern: RegExp): string {
  return pairedDivBlock(HUD, openPattern)
}

/** i18n 字面量：`screenRecord: { hud: { recording: '…' } }` 里 hud 分组下有哪些键 */
function hudLocaleKeys(source: string): string[] {
  const group = source.match(/screenRecord:\s*\{[\s\S]*?hud:\s*\{([\s\S]*?)\n\s*\}/)?.[1] ?? ''
  return [...group.matchAll(/^\s*([A-Za-z][\w]*):/gm)].map((hit) => hit[1]!)
}

const STYLE = styleBlockOf(HUD)
const ZH_HUD_KEYS = hudLocaleKeys(ZH)
const EN_HUD_KEYS = hudLocaleKeys(EN)

/** 模板（不带 `<script>` / `<style>`）：断言根元素 `v-if` 时必须只看模板 */
const TEMPLATE = HUD.match(/<template>([\s\S]*)<\/template>/)?.[1] ?? ''

/** 根元素的开标签（整段属性一起匹配，`v-if` 改成别的属性值就会失配） */
const ROOT_TAG = TEMPLATE.match(/<div v-if="[^"]+"[^>]*class="recording-hud"[^>]*>/)?.[0] ?? ''

/**
 * 根元素的 `v-if` 表达式。
 *
 * 这里刻意**不**写成 `v-if="visible"`：可见性判断本身可以被改成任何东西，
 * 守卫要钉的是「根是否只有在可见时才渲染」，表达式叫什么名字是次要的。
 */
const ROOT_V_IF = ROOT_TAG.match(/v-if="([^"]+)"/)?.[1] ?? ''

const VISIBLE_BODY = declBodyOf(HUD, /const visible = computed\(\(\) =>/)
const PROGRESS_BODY = declBodyOf(HUD, /const progressPercent = computed\(\(\) =>/)
const RESTART_CLOCK_BODY = declBodyOf(HUD, /function restartClock\(\): void/)
const ENCODING_BADGE = badgeBlockOf(/<div v-else class="hud-badge hud-badge-encoding">/)
const RECORDING_BADGE = badgeBlockOf(/<div v-if="phase === 'recording'" class="hud-badge">/)

describe('RecordingHud：订阅与生命周期', () => {
  it('组件存在，且从 shared/screenRecord 取类型（不自己抄一份状态形状）', () => {
    expect(existsSync(HUD_PATH), '缺少 src/renderer/src/components/RecordingHud.vue').toBe(true)
    expect(HUD).toContain('@shared/screenRecord')
    expect(HUD).toMatch(
      /import type \{[\s\S]{0,200}ScreenRecordHudState[\s\S]{0,200}\} from '@shared\/screenRecord'/
    )
  })

  it('onMounted 订阅，onUnmounted 退订（不退订就会跨窗口叠加回调）', () => {
    expect(HUD).toMatch(/onMounted\(\(\) => \{[\s\S]{0,400}window\.studio\.onScreenRecordHud\(/)
    expect(HUD).toMatch(/hudStop = window\.studio\.onScreenRecordHud\(onHudState\)/)
    expect(HUD).toMatch(/onUnmounted\(\(\) => \{[\s\S]{0,300}hudStop\?\.\(\)/)
  })

  it('录制中与编码中都渲染根元素，两者都不是时什么都不渲染（v-if 必须带上 phase）', () => {
    /*
      这两条断言必须**配对**才等价于「录制中或编码中」：
      1) 根挂在哪个表达式上（`visible`）—— 只断言 2) 的话，「定义了 visible 却把根写成
         `v-if="recording"`」依然全绿；
      2) 那个表达式的内容 —— 只断言 `v-if="visible"` 的话，把 `visible` 改成 `computed(() => false)`
         依然全绿。
    */
    expect(ROOT_TAG, '根元素应当带 v-if').not.toBe('')
    expect(ROOT_V_IF, '根元素的 v-if 应当是那个相位可见性判断').toBe('visible')
    // 用 token 而不是整段字符串都写死：上面那条失配时，这两条能指出究竟缺了哪一半
    expect(VISIBLE_BODY).toContain('recording.value')
    expect(VISIBLE_BODY).toContain("phase.value === 'encoding'")
  })

  it('编码开始（recording 变 false）不遮住可见性：phase 单独归一，收尾推送才清空', () => {
    /*
      主进程的推送顺序是 `{recording:true…}` → `{recording:false, phase:'encoding'}` →
      每 500ms `{recording:false, phase:'encoding', progress}` → `{recording:false}`。
      所以 phase 必须**独立于 recording** 地从推送里取，并在没有 phase 时按 recording 归一；
      取错（例如把 phase 写成 recording 的派生物）会让编码阶段整段没有 HUD 或一直不消失。
    */
    expect(HUD).toMatch(
      /phase\.value = state\.phase \?\? \(state\.recording === true \? 'recording' : null\)/
    )
    expect(HUD).toMatch(/const phase = ref<'recording' \| 'encoding' \| null>\(null\)/)
    // 没有 phase 的推送（编码收尾那次）必须归一到 null，否则 HUD 永远不消失
    expect(HUD).toContain("state.recording === true ? 'recording' : null")
  })

  it('挂载时补取一次当前状态（订阅前就开始录的话，等下一次推送会一直空着）', () => {
    // 用 indexOf 分段而不是正则的 `[\s\S]{0,n}`：中间夹着中文注释，
    // 按字符数放宽窗口很脆（注释一改写就红），分三段定位只约束顺序。
    const mounted = HUD.slice(HUD.indexOf('onMounted('), HUD.indexOf('onUnmounted('))
    expect(mounted, '应当有 onMounted 段').not.toBe('')
    const statusAt = mounted.indexOf('screenRecordStatus')
    const subAt = mounted.indexOf('onScreenRecordHud(')
    expect(statusAt, '挂载时要先取一次当前状态').toBeGreaterThan(-1)
    expect(subAt, '挂载时要订阅').toBeGreaterThan(statusAt)
    expect(HUD).toMatch(/if \(state\?\.recording\) onHudState\(state\)/)
  })
})

describe('RecordingHud：本地走秒', () => {
  it('用 startedAtMs 自己算 mm:ss，不指望主进程推时钟', () => {
    expect(HUD).toMatch(
      /elapsedMs\.value = startedAtMs\.value \? Date\.now\(\) - startedAtMs\.value : 0/
    )
    expect(HUD).toMatch(/String\(Math\.floor\(total \/ 60\)\)\.padStart\(2, '0'\)/)
    expect(HUD).toMatch(/String\(total % 60\)\.padStart\(2, '0'\)/)
  })

  it('1 秒一跳', () => {
    expect(HUD).toMatch(/clockTimer = window\.setInterval\(tickClock, 1000\)/)
  })

  it('编码中停表（不起定时器），只有 phase=recording 才重新起表', () => {
    /*
      整段函数体一起钉，而不是 `toContain('stopClock()')`：
      1) 编码必须停表 —— `tickClock` 按 `Date.now() - startedAtMs` 重算，表一直走会把几十秒的
         编码时间也算进「已录时长」（用户看到的是他没录过的时间）；
      2) 「录制中且 phase=recording」是唯一开表条件 —— 漏掉 phase 判断，编码阶段表就继续走；
         漏掉 recording 判断，录制结束后定时器会一直空转（组件在录制期间外也挂载着）；
      3) start/stop 必须在同一个函数里成对，否则会出现「表停了再也起不来」（新录制开始不走秒）。
    */
    const body = normalizedCode(RESTART_CLOCK_BODY)
    expect(body).toBe(
      "stopClock() if (!recording.value || phase.value !== 'recording') return tickClock() clockTimer = window.setInterval(tickClock, 1000)"
    )
    // 用 token 而不是整段字符串：上面那条失配时，这些能指出究竟违反了哪一点
    expect(RESTART_CLOCK_BODY).toMatch(
      /if \(!recording\.value \|\| phase\.value !== 'recording'\) return/
    )
    const stopAt = RESTART_CLOCK_BODY.indexOf('stopClock()')
    const guardAt = RESTART_CLOCK_BODY.indexOf("phase.value !== 'recording'")
    const startAt = RESTART_CLOCK_BODY.indexOf('window.setInterval(tickClock, 1000)')
    expect(stopAt, 'restartClock 要先停表').toBeGreaterThan(-1)
    expect(guardAt, '编码中/已结束必须提前 return').toBeGreaterThan(stopAt)
    expect(startAt, '过了守卫才开表').toBeGreaterThan(guardAt)
  })

  it('录制结束仍留着定时器就是空转', () => {
    expect(HUD).toMatch(/onUnmounted\(\(\) => \{[\s\S]{0,300}stopClock\(\)/)
  })
})

describe('RecordingHud：编码阶段（phase=encoding）', () => {
  it('编码中不显示录制徽标（否则编码几十秒里一直写着「录制中」）', () => {
    // 两组徽标的渲染条件必须互补：录制徽标挂 `phase === 'recording'`，编码徽标是它的 v-else
    expect(HUD).toMatch(/<div v-if="phase === 'recording'" class="hud-badge">/)
    expect(HUD).toMatch(/<div v-else class="hud-badge hud-badge-encoding">/)
    // 录制徽标块里不许再出现编码相关的东西（把编码文案塞进录制分支就会红）
    expect(RECORDING_BADGE, '应当能取出录制徽标块（开标签须原样保留）').not.toBe('')
    expect(RECORDING_BADGE, '录制徽标里不该有编码文案').not.toMatch(/encod/)
    expect(RECORDING_BADGE, '录制徽标里不该有编码百分比').not.toContain('progressPercent')
    // 录制徽标仍然带秒表（停表后读数留在可读状态，不是从画面上消失）
    expect(RECORDING_BADGE).toContain('elapsedLabel')
  })

  it('录制指示在模板里各只有一处，且都在录制徽标那一半里', () => {
    /*
      秒表读数虽然停了（`restartClock` 不再走秒），但只要它还被渲染出来，编码阶段屏幕上就写着
      「录制时长」，看起来仍像在录。这里按**出现次数**守：录制指示（红点/秒表/帧点/步骤）
      各只有一处，且都落在录制徽标块内；配合上面「编码徽标是 v-else」的同组关系，
      就等于「编码阶段不渲染任何录制指示」，也不许把这四样东西复制一份到别处去。
    */
    const countIn = (haystack: string, needle: string): number => haystack.split(needle).length - 1
    expect(RECORDING_BADGE, '应当能取出录制徽标块').not.toBe('')
    expect(ENCODING_BADGE, '应当能取出编码徽标块').not.toBe('')
    expect(countIn(TEMPLATE, 'hud-dot')).toBe(1)
    expect(countIn(TEMPLATE, 'elapsedLabel')).toBe(1)
    expect(countIn(TEMPLATE, 'hud-frames')).toBe(1)
    expect(countIn(TEMPLATE, 'hud-step')).toBe(1)
    for (const token of ['hud-dot', 'elapsedLabel', 'hud-frames', 'hud-step']) {
      expect(RECORDING_BADGE, `录制徽标里应当有 ${token}`).toContain(token)
      expect(ENCODING_BADGE, `编码徽标里不该有 ${token}`).not.toContain(token)
    }
  })

  it('两个徽标是同一个互斥组：编码徽标必须是 v-else，不能自带条件', () => {
    /*
      配对取块的断言有个盲区：`<div v-if="true" class="hud-badge">` 会取到与
      `<div v-if="phase === 'recording'">` **完全一样**的内容，于是「录制徽标条件被改成恒真」
      （编码时继续写着「录制中」）依然全绿。所以这里必须显式钉住条件表达式与 v-else 的配对关系。
    */
    expect(HUD, '录制徽标只该挂 phase === recording 这一个条件').toContain(
      `<div v-if="phase === 'recording'" class="hud-badge">`
    )
    const encodingHead = HUD.match(
      /<div\s+(v-[a-z-]+)(?:="[^"]*")?\s+class="hud-badge hud-badge-encoding">/
    )
    expect(encodingHead?.[1], '编码徽标必须是 v-else（与录制徽标互斥）').toBe('v-else')
    expect(HUD, '编码徽标不该自带条件：两半独立判断会出现两个徽标同时出现/同时消失').not.toMatch(
      /<div v-if="[^"]*"\s+class="hud-badge hud-badge-encoding">/
    )
    // 编码徽标自己的类名必须精确：它承载的深色实底样式是按这个类挂的
    expect(HUD, '编码徽标应当带 hud-badge-encoding 这个类').toContain(
      'class="hud-badge hud-badge-encoding"'
    )
  })

  it('编码徽标：⟳ + 百分比文案，且不再挂秒表/帧点/步骤（编码时那些都失去意义）', () => {
    expect(ENCODING_BADGE, '应当能取出编码徽标块（开标签须原样保留）').not.toBe('')
    // 快照整块 DOM 结构：删掉图标、删掉 i18n 调用、把 percent 参数改名都会失配
    expect(ENCODING_BADGE.replace(/\s+/g, ' ').trim()).toBe(
      '<span class="hud-encode-icon" aria-hidden="true">⟳</span> <span class="hud-label hud-encode-label"> {{ t(\'screenRecord.hud.encoding\', { percent: progressPercent }) }} </span>'
    )
    expect(ENCODING_BADGE).not.toContain('elapsedLabel')
    expect(ENCODING_BADGE).not.toContain('hud-frames')
    expect(ENCODING_BADGE).not.toContain('hud-step')
    // 图标要有自己的样式与旋转动画（否则只是一个静态字符，看着像排版错误）
    expect(ruleBodyOf(STYLE, '.hud-encode-icon {')).toMatch(/animation:\s*hud-encode-spin/)
    expect(STYLE).toMatch(/@keyframes hud-encode-spin/)
    // 编码徽标沿用那枚深色实底胶囊：这段画面要烧进视频，半透明底在亮图上会糊
    expect(ruleBodyOf(STYLE, '.hud-badge-encoding {')).toMatch(/background:\s*rgba\(12, 14, 18/)
  })

  it('百分比来自 progress 且夹紧到 0~100（主进程按 0~1 推，但不保证不越界）', () => {
    expect(normalizedCode(PROGRESS_BODY)).toBe(
      'const clamped = Math.min(1, Math.max(0, progress.value)) return Math.round(clamped * 100)'
    )
    expect(HUD).toMatch(
      /progress\.value = typeof state\.progress === 'number' \? state\.progress : 0/
    )
  })

  it('编码文案必须走 i18n（中文界面靠 key，英文界面不该漏句）', () => {
    /*
      `npm run check:cjk` 会拦「渲染层源码里的中文字面量」，但模板里的中文**字符串常量**
      （例如把手写死成 `编码中 {{ percent }}%`）在缩略版规则下未必拦得住；而写死中文
      直接违反仓库口径（界面文案一律走 i18n，中英两套键必须对齐）。所以这里显式钉：
      编码徽标用的是 `screenRecord.hud.encoding` 这个 key，并把 percent 传进去插值。
    */
    expect(ENCODING_BADGE, '应当能取出编码徽标块').not.toBe('')
    expect(ENCODING_BADGE).toContain("t('screenRecord.hud.encoding'")
    expect(ENCODING_BADGE).toContain('percent: progressPercent')
    // 文案本身来自 locale：模板里不许出现写死的中文百分比句子
    expect(ENCODING_BADGE).not.toMatch(/[编码中]/)
  })
})

describe('RecordingHud：步骤标题 / 高亮框 / 合成光标', () => {
  it('标题条烧短 title + 详细 caption 字卡（旁白音频另在 compose 生成）', () => {
    expect(HUD).toMatch(
      /<div v-if="title \|\| caption" :key="captionMotionKey" class="hud-titlebar">/
    )
    expect(HUD).toContain('class="hud-title"')
    expect(HUD).toContain('class="hud-caption"')
    expect(HUD).toMatch(/caption && caption !== title/)
  })

  it('高亮框按窗口内容坐标落位（CSS px），并钳进视口', () => {
    expect(HUD).toMatch(/<div v-if="focusBox" class="hud-focus"/)
    expect(HUD).toContain('const focusBox = computed')
    expect(HUD).toMatch(/Math\.min\(box\.width, vw - x\)/)
    // 高亮框要有主题色描边（不是纯装饰的透明框）
    expect(ruleBodyOf(STYLE, '.hud-focus {')).toMatch(/border:\s*\d+px solid/)
  })

  it('合成光标用手指 SVG + transform 平滑移动（transition 挂在 ready 类上）', () => {
    expect(HUD).toContain('hud-cursor-hand')
    expect(HUD).not.toContain('hud-cursor-arrow')
    expect(HUD).toMatch(
      /el\.style\.transform = `translate\(\$\{target\.x\}px, \$\{target\.y\}px\)`/
    )
    expect(ruleBodyOf(STYLE, '.hud-cursor-ready {')).toMatch(/transition:\s*transform/)
  })

  it('字卡不超出视频宽度（titlebar 限宽 + caption 换行）', () => {
    const titlebar = ruleBodyOf(STYLE, '.hud-titlebar {')
    expect(titlebar).toMatch(/max-width:\s*calc\(100vw - 48px\)/)
    expect(ruleBodyOf(STYLE, '.hud-caption {')).toMatch(/overflow-wrap:\s*anywhere/)
  })

  it('字卡切换带上滚淡入（专业字幕动效）', () => {
    expect(HUD).toContain('captionMotionKey')
    expect(HUD).toMatch(/:key="captionMotionKey"/)
    expect(ruleBodyOf(STYLE, '.hud-titlebar {')).toMatch(/animation:\s*hud-caption-roll/)
    expect(STYLE).toContain('@keyframes hud-caption-roll')
  })

  it('新录制第一次定位先瞬移（不让光标从上一段录制的位置滑过来）', () => {
    expect(HUD).toMatch(/positionCursor\(!cursorReady\.value\)/)
    expect(HUD).toMatch(/cursorReady\.value = false[\s\S]{0,260}requestAnimationFrame/)
    // 录制开始要复位过渡状态与点击签名：否则新录制的第一个光标会被上一段的过渡划过来
    expect(HUD).toMatch(
      /watch\(\s*\(\) => recording\.value,[\s\S]{0,400}cursorReady\.value = false[\s\S]{0,120}lastClickSignature = ''/
    )
  })
})

describe('RecordingHud：点击涟漪可重触发', () => {
  it('重放动画：先摘类 + 强制回流，再加类（否则同坐标连点会被吞掉）', () => {
    const fire = HUD.match(/function fireRipple\(\): void \{[\s\S]*?\n\}/)?.[0] ?? ''
    expect(fire, '应当有 fireRipple()').toContain('remove')
    expect(fire).toMatch(/void el\.offsetWidth/)
    const removeAt = fire.indexOf('remove')
    const reflowAt = fire.indexOf('offsetWidth')
    const addAt = fire.indexOf('classList.add')
    expect(removeAt).toBeGreaterThan(-1)
    expect(reflowAt, '回流必须发生在摘类之后、加类之前').toBeGreaterThan(removeAt)
    expect(addAt, '回流之后再加类，动画才会重新开始').toBeGreaterThan(reflowAt)
  })

  it('按「步骤 + 坐标」签名判重：同一步重复推状态不连爆，新一步/新坐标一定重放', () => {
    expect(HUD).toMatch(
      /const signature = `\$\{stepIndex\.value \?\? -1\}:\$\{Math\.round\(next\.x\)\}:\$\{Math\.round\(next\.y\)\}`/
    )
    expect(HUD).toMatch(/if \(signature === lastClickSignature\) return/)
    expect(HUD).toMatch(/lastClickSignature = signature[\s\S]{0,120}fireRipple\(\)/)
    // 步骤切换要清掉签名：下一步点同一个按钮时坐标不变，不清就又吞了
    expect(HUD).toMatch(
      /watch\(\s*\(\) => stepIndex\.value,\s*\(\) => \{\s*lastClickSignature = ''\s*\}\s*\)/
    )
    // 不是点击的状态推送（click 为假）同样要清签名
    expect(HUD).toMatch(/if \(!next\.click\) \{\s*lastClickSignature = ''\s*return\s*\}/)
  })
})

describe('RecordingHud：不挡交互与分层', () => {
  it('根元素 pointer-events: none（全屏层吃点击会让被录的演示点不动）', () => {
    expect(ruleBodyOf(STYLE, '.recording-hud {')).toMatch(/pointer-events:\s*none/)
    // 编码徽标也在这层里，所以根层的这条规则同样管住编码阶段
    expect(ROOT_TAG).toContain('class="recording-hud"')
    expect(ruleBodyOf(STYLE, '.recording-hud {')).not.toMatch(/pointer-events:\s*auto/)
  })

  it('z-index 落在「普通内容之上、模态弹窗之下」的空档里，并写明了理由', () => {
    const body = ruleBodyOf(STYLE, '.recording-hud {')
    const zIndex = Number(body.match(/z-index:\s*(\d+)/)?.[1] ?? Number.NaN)
    expect(Number.isFinite(zIndex), '.recording-hud 应当显式给 z-index').toBe(true)
    // 普通应用内容 / 图形编辑器内部层都 ≤ 60
    expect(zIndex).toBeGreaterThan(60)
    // 本仓库模态弹窗最低一级是 1200（StudioFloatingWindow 的 z-index prop 就是 mask 的 z-index）
    expect(zIndex).toBeLessThan(1200)
    // 为什么是这个值：注释里要提到模态，免得后人随手改大盖住对话框按钮
    expect(STYLE).toMatch(/z-index 取 \d+：高于应用内容，低于所有模态弹窗/)
  })

  it('高对比、无模糊：字号够大，且不用 filter: blur（1080p 下会糊进视频）', () => {
    const title = ruleBodyOf(STYLE, '.hud-title {')
    expect(Number(title.match(/font-size:\s*(\d+)px/)?.[1] ?? 0)).toBeGreaterThanOrEqual(18)
    expect(STYLE).not.toMatch(/filter:\s*blur/)
    /*
      HUD 要落在任意应用内容上，所以它自带深色实底；但**不能用硬编码白叠色**
      （`rgba(255, 255, 255, 0.2x)`）做描边 —— themeStylesAudit 判定为 white-wash
      （浅色主题下几乎无对比）。这里钉住它继续走 color-mix 的相对色写法。
      断言前先剥掉 CSS 注释：解释这条规则的注释本身就会写出被禁的写法。
    */
    const css = STYLE.replace(/\/\*[\s\S]*?\*\//g, '')
    expect(css).not.toMatch(/rgba\(\s*255\s*,\s*255\s*,\s*255\s*,/)
    expect(css).toMatch(/color-mix\(in srgb, #fff \d+%, transparent\)/)
  })
})

describe('App.vue：挂载点', () => {
  it('导入了组件并在模板里用上（不是死 import）', () => {
    expect(APP).toContain("import RecordingHud from './components/RecordingHud.vue'")
    expect(APP).toMatch(/<RecordingHud \/>/)
  })

  it('挂在应用级覆盖层那一段，且不在 isMarketplace 分支里', () => {
    /*
      市场是主进程另开的窗口，录制录的是主窗口；把 HUD 放进 `isMarketplace` 分支（或那个 `v-else`
      的 template 里）等于市场窗口也挂一份 —— 那边没有录制，只会多一个订阅。
      按 StudioPromptDialog 那一排的位置对齐：都在 `</template>` 之后、`isMarketplace` 判断之外。
    */
    const tpl = APP.match(/<template>([\s\S]*)<\/template>/)?.[1] ?? ''
    expect(tpl, '应当能取到 App.vue 的模板').not.toBe('')
    const mainTemplateEnd = tpl.indexOf('</template>')
    const hudAt = tpl.indexOf('<RecordingHud />')
    const promptAt = tpl.indexOf('<StudioPromptDialog />')
    expect(mainTemplateEnd, '应当有主界面那个 v-else template 的收尾').toBeGreaterThan(-1)
    expect(hudAt, '模板里应当有 <RecordingHud />').toBeGreaterThan(mainTemplateEnd)
    expect(promptAt, '模板里应当有 <StudioPromptDialog />').toBeGreaterThan(hudAt)
    // 市场分支的收尾必须在它前面：市场窗口里不该出现 HUD
    expect(hudAt).toBeGreaterThan(tpl.indexOf('<MarketplaceView v-if="isMarketplace" />'))
  })
})

describe('i18n：HUD 文案两侧都在', () => {
  it('zh-CN 的 screenRecord.hud 分组存在（中文界面文案必须走 i18n）', () => {
    expect(ZH_HUD_KEYS).toContain('recording')
  })

  it('en-US 的 screenRecord.hud 分组存在', () => {
    expect(EN_HUD_KEYS).toContain('recording')
  })

  it('两侧键集合一致（少一条就会 fallback 成另一种语言）', () => {
    expect(EN_HUD_KEYS).toEqual(ZH_HUD_KEYS)
  })

  it('两侧都有编码文案键（中文写死在模板里 = 英文界面漏文案）', () => {
    expect(ZH_HUD_KEYS, 'zh-CN 缺 screenRecord.hud.encoding').toContain('encoding')
    expect(EN_HUD_KEYS, 'en-US 缺 screenRecord.hud.encoding').toContain('encoding')
    // 文案必须带 {percent} 占位符：没有它就只是个不知所云的「编码中」
    expect(ZH).toMatch(/encoding: '[^']*\{percent\}[^']*'/)
    expect(EN).toMatch(/encoding: '[^']*\{percent\}[^']*'/)
  })

  it('组件用到的每个 key 两侧都有（模板里只允许出现 key 名）', () => {
    const used = [...HUD.matchAll(/t\('screenRecord\.hud\.([A-Za-z][\w]*)'/g)].map((hit) => hit[1]!)
    expect(used.length, '组件至少要用一个 HUD 文案键').toBeGreaterThan(0)
    expect(used).toContain('recording')
    expect(used, '编码文案也必须是 i18n 键（中文不能写死在模板里）').toContain('encoding')
    for (const key of new Set(used)) {
      expect(ZH_HUD_KEYS, `zh-CN 缺 screenRecord.hud.${key}`).toContain(key)
      expect(EN_HUD_KEYS, `en-US 缺 screenRecord.hud.${key}`).toContain(key)
    }
  })
})
