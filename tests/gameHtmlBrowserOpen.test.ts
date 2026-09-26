import { describe, expect, it } from 'vitest'
import { gameHtmlBrowserIssue } from '../src/shared/gamePlay'

/**
 * 「试玩」默认交给系统默认程序（浏览器）打开，而 `file://` 下有两类东西会白屏——
 * 它们在应用内沙盒（`studio-gameplay://` 真 HTTP 文档）里反而正常。这里锁住自检口径：
 * 只有确实会白屏的形态才退回应用内窗口，别的（外链 / data: / 锚点）不要误判。
 */
describe('可玩 HTML 交给浏览器打开前的自检', () => {
  it('脚手架产出的自包含单文件：放行', () => {
    const cooked = `<!DOCTYPE html><html><head>
<!-- game-mode: 3d -->
<style>html,body{margin:0}</style>
</head><body><div id="app"></div><div id="hud"></div>
<script>!function(){"use strict";/* three bundled */}();</script>
</body></html>`
    expect(gameHtmlBrowserIssue(cooked)).toBeNull()
  })

  it('ES 模块脚本：拦下（file:// 下按 CORS 处理，直接拒绝执行）', () => {
    expect(gameHtmlBrowserIssue('<script type="module">export {}</script>')).toBe('module-script')
    expect(gameHtmlBrowserIssue("<script type='module' src='x.js'></script>")).toBe('module-script')
    expect(gameHtmlBrowserIssue('<script type=module>x()</script>')).toBe('module-script')
    // 经典脚本不受影响
    expect(gameHtmlBrowserIssue('<script type="text/javascript">x()</script>')).toBeNull()
  })

  it('相对引用的脚本 / 样式：拦下（cook 只写 dist/index.html，兄弟文件并不存在）', () => {
    expect(gameHtmlBrowserIssue('<script src="./assets/index.js"></script>')).toBe('relative-asset')
    expect(gameHtmlBrowserIssue('<link rel="stylesheet" href="style.css">')).toBe('relative-asset')
    expect(gameHtmlBrowserIssue('<script src="assets/index.js"></script>')).toBe('relative-asset')
  })

  it('外链 / data: / blob: / 锚点 / 根路径：不算本地文件依赖，放行', () => {
    for (const html of [
      '<script src="https://cdn.example/three.js"></script>',
      '<script src="data:text/javascript;base64,AAAA"></script>',
      '<script src="blob:http://localhost/abc"></script>',
      '<script src="//cdn.example/three.js"></script>',
      '<script src="/assets/index.js"></script>',
      '<link rel="stylesheet" href="#print">'
    ]) {
      expect(gameHtmlBrowserIssue(html)).toBeNull()
    }
  })

  it('空内容不拦（读盘失败时按可开处理，交给系统程序兜底）', () => {
    expect(gameHtmlBrowserIssue('')).toBeNull()
    expect(gameHtmlBrowserIssue('   ')).toBeNull()
  })

  it('模块脚本优先于相对引用上报（两种都命中时报更硬的那个原因）', () => {
    const html = '<script type="module" src="./assets/index.js"></script>'
    expect(gameHtmlBrowserIssue(html)).toBe('module-script')
  })
})
