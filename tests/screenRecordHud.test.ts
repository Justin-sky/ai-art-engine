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

/** i18n 字面量：`screenRecord: { hud: { recording: '…' } }` 里 hud 分组下有哪些键 */
function hudLocaleKeys(source: string): string[] {
  const group = source.match(/screenRecord:\s*\{[\s\S]*?hud:\s*\{([\s\S]*?)\n\s*\}/)?.[1] ?? ''
  return [...group.matchAll(/^\s*([A-Za-z][\w]*):/gm)].map((hit) => hit[1]!)
}

const STYLE = styleBlockOf(HUD)
const ZH_HUD_KEYS = hudLocaleKeys(ZH)
const EN_HUD_KEYS = hudLocaleKeys(EN)

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

  it('未录制时什么都不渲染（根元素带 v-if="recording"）', () => {
    expect(HUD).toMatch(/<div\s+v-if="recording"\s+class="recording-hud"/)
    expect(HUD).toMatch(/recording\.value = state\.recording === true/)
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

  it('1 秒一跳，且不在录制时立刻清掉定时器', () => {
    expect(HUD).toMatch(/clockTimer = window\.setInterval\(tickClock, 1000\)/)
    expect(HUD).toMatch(
      /function restartClock\(\): void \{[\s\S]{0,200}stopClock\(\)[\s\S]{0,120}if \(!recording\.value\) return/
    )
    // 录制结束仍留着定时器就是空转
    expect(HUD).toMatch(/onUnmounted\(\(\) => \{[\s\S]{0,300}stopClock\(\)/)
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
    expect(HUD).toMatch(/<div\s+v-if="recording"\s+class="recording-hud"/)
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

  it('组件用到的每个 key 两侧都有（模板里只允许出现 key 名）', () => {
    const used = [...HUD.matchAll(/t\('screenRecord\.hud\.([A-Za-z][\w]*)'/g)].map((hit) => hit[1]!)
    expect(used.length, '组件至少要用一个 HUD 文案键').toBeGreaterThan(0)
    expect(used).toContain('recording')
    for (const key of new Set(used)) {
      expect(ZH_HUD_KEYS, `zh-CN 缺 screenRecord.hud.${key}`).toContain(key)
      expect(EN_HUD_KEYS, `en-US 缺 screenRecord.hud.${key}`).toContain(key)
    }
  })
})
