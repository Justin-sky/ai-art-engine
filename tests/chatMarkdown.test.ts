import { describe, expect, it } from 'vitest'
import {
  escapeChatText,
  isImageLikePath,
  renderChatMarkdown,
  renderInlineChatRefs
} from '../src/shared/chatMarkdown'

const labels = { copyCode: 'Copy code' }

describe('对话气泡 Markdown 渲染（shared）', () => {
  it('基础语法：标题 / 列表 / 引用 / 粗体 / 表格 / 分隔线 / 换行', () => {
    const html = renderChatMarkdown(
      ['## 标题', '', '- 一', '- 二', '', '> 引用', '', '**粗** 与 *斜*', '', '---'].join('\n'),
      labels
    )
    expect(html).toContain('<h2')
    expect(html).toContain('<li>一</li>')
    expect(html).toContain('<blockquote>')
    expect(html).toContain('<strong>粗</strong>')
    expect(html).toContain('<em>斜</em>')
    expect(html).toContain('<hr')

    const table = renderChatMarkdown('| a | b |\n| - | - |\n| 1 | 2 |', labels)
    expect(table).toContain('<table>')
    expect(table).toContain('<td>1</td>')

    // 对话场景按「单个换行即换行」渲染（breaks）
    expect(renderChatMarkdown('一\n二', labels)).toContain('一<br>二')
  })

  it('文本里的尖括号与 & 一律转义', () => {
    expect(renderChatMarkdown('a < b & c > d', labels)).toContain('a &lt; b &amp; c &gt; d')
    expect(escapeChatText('<img onerror=x>')).toBe('&lt;img onerror=x&gt;')
  })

  it('原始 HTML 丢弃：脚本与事件属性进不了气泡', () => {
    const script = renderChatMarkdown('前 <script>alert(1)</script> 后', labels)
    expect(script).not.toContain('<script')
    expect(script).not.toContain('</script')

    const img = renderChatMarkdown('**x** <img src=x onerror=alert(1)>', labels)
    expect(img).not.toContain('onerror')
    expect(img).not.toContain('<img src')

    const div = renderChatMarkdown('<div onclick="alert(1)">点我</div>', labels)
    expect(div).not.toContain('onclick')
    expect(div).not.toContain('<div onclick')
  })

  it('代码块与行内代码：内容保留但照常转义（不能变成真标签）', () => {
    const block = renderChatMarkdown('```html\n<script>alert(1)</script>\n```', labels)
    expect(block).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(block).not.toContain('<script')

    const inline = renderChatMarkdown('`<b>&x</b>`', labels)
    expect(inline).toContain('&lt;b&gt;&amp;x&lt;/b&gt;')
  })

  it('链接只放行 http(s) / mailto，危险协议降级成纯文本', () => {
    const ok = renderChatMarkdown('[官网](https://example.com/a?x=1&y=2)', labels)
    expect(ok).toContain('href="https://example.com/a?x=1&amp;y=2"')
    expect(ok).toContain('target="_blank"')
    expect(ok).toContain('rel="noopener noreferrer"')
    expect(renderChatMarkdown('[写信](mailto:a@b.com)', labels)).toContain('href="mailto:a@b.com"')

    // 大小写变形 / 实体编码 / 控制字符变形都不能绕过协议白名单
    for (const raw of [
      '[x](javascript:alert(1))',
      '[x](JaVaScRiPt:alert(1))',
      '[x](java&#115;cript:alert(1))',
      '[x](java&#x73;cript:alert(1))',
      '[x](data:text/html;base64,PHNjcmlwdD4=)',
      '[x](vbscript:msgbox(1))'
    ]) {
      const html = renderChatMarkdown(raw, labels)
      expect(html).not.toContain('<a ')
      expect(html).toContain('x')
    }
  })

  it('内联引用：图片出卡片，其它路径出文本 chip', () => {
    const html = renderChatMarkdown('完成 @Assets/Images/a.webp 与 @Assets/note.txt', labels)
    expect(html).toContain('class="chat-msg-card"')
    expect(html).toContain('data-src="Assets/Images/a.webp"')
    expect(html).toContain('class="chat-msg-card-name">a.webp<')
    expect(html).toContain('<span class="inline-ref">@Assets/note.txt</span>')

    // `@image:` 前缀与反斜杠路径同样识别为图片
    expect(renderChatMarkdown('@image:Assets\\b.png', labels)).toContain('data-src="Assets/b.png"')
    expect(isImageLikePath('a/bb.PNG')).toBe(true)
    expect(isImageLikePath('a/note.md')).toBe(false)
  })

  it('代码块里的 @路径 保持原样（不做引用替换）', () => {
    const html = renderChatMarkdown('```\n@Assets/a.png\n```', labels)
    expect(html).not.toContain('chat-msg-card')
    expect(html).toContain('@Assets/a.png')
  })

  it('Markdown 图片：本地路径出卡片，远端地址退回文本', () => {
    expect(renderChatMarkdown('![图](Assets/a.png)', labels)).toContain('data-src="Assets/a.png"')

    const remote = renderChatMarkdown('![图](https://example.com/a.png)', labels)
    expect(remote).not.toContain('data-src')
    expect(remote).toContain('图')
  })

  it('代码块带语言标注与复制按钮，按钮文案由调用方传入', () => {
    const html = renderChatMarkdown('```ts\nconst a = 1\n```', { copyCode: '复制代码' })
    expect(html).toContain('class="md-code-copy"')
    expect(html).toContain('title="复制代码"')
    expect(html).toContain('aria-label="复制代码"')
    expect(html).toContain('class="md-code-lang">ts<')
    expect(html).toContain('<pre class="md-pre"><code>const a = 1')
  })

  it('引用路径里的引号不会越出属性边界拼出新属性', () => {
    const html = renderChatMarkdown('@Assets/a"onmouseover="x.png', labels)
    // 引号被转义成实体：既不能提前闭合 data-src，也拼不出新的属性分隔
    expect(html).not.toContain('" onmouseover="')
    expect(html).toContain('&quot;onmouseover=&quot;')
  })

  it('缓存：同文案同文本复用结果，文案变化后重新渲染', () => {
    const first = renderChatMarkdown('**x**', labels)
    expect(renderChatMarkdown('**x**', labels)).toBe(first)

    const code = '```\nx\n```'
    expect(renderChatMarkdown(code, { copyCode: '复制代码' })).toContain('复制代码')
    const en = renderChatMarkdown(code, { copyCode: 'Copy code' })
    expect(en).toContain('Copy code')
    expect(en).not.toContain('复制代码')
  })

  it('纯文本模式：只转义 + 内联引用，不解析 Markdown', () => {
    const html = renderInlineChatRefs('**x** @Assets/a.png <b>y</b>')
    expect(html).toContain('**x**')
    expect(html).toContain('data-src="Assets/a.png"')
    expect(html).toContain('&lt;b&gt;y&lt;/b&gt;')
    expect(renderInlineChatRefs('')).toBe('')
  })
})
