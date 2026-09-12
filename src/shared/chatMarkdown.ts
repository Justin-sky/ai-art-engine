/**
 * 对话气泡 Markdown 渲染。
 *
 * 纯字符串进出、不依赖 DOM，因此可以在 node 环境的单测里直接跑；渲染层只负责把结果塞进气泡，
 * 解析与安全策略都收敛在这里。
 *
 * 几条必须守住的约定：
 * - **各 renderer 拿到的 token 文本都是未转义的原文**（text / code / codespan / image 皆如此），
 *   所以每个 renderer 都要自己转义，漏一处就等于把模型输出的 `<` 当标签用；
 * - 原始 HTML 一律丢弃：marked 默认会把 `<script>` / `<img onerror=…>` 原样透传；
 * - 链接只放行 http(s) / mailto，且**先做实体解码再判协议**（挡 `java&#115;cript:` 这类写法）；
 * - 图片一律走 `img[data-src]` 管线，真实 URL 由渲染层解析，不接受模型给定的 src；
 * - 内联 `@路径` / `@image:路径` 沿用既有语义：图片出卡片，其它出文本 chip。
 */
import { Marked, type Tokens } from 'marked'

/** 代码块复制按钮图标：默认复制，`.copied` 时由 CSS 换成对勾 */
const COPY_ICON =
  '<svg class="md-icon-copy" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">' +
  '<rect x="5.5" y="5.5" width="8" height="8" rx="1.5" fill="none" stroke="currentColor"></rect>' +
  '<path d="M10.5 5.5V4A1.5 1.5 0 0 0 9 2.5H4A1.5 1.5 0 0 0 2.5 4v5A1.5 1.5 0 0 0 4 10.5h1.5" fill="none" stroke="currentColor"></path>' +
  '</svg>'
const DONE_ICON =
  '<svg class="md-icon-done" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">' +
  '<path d="M3 8.5l3.2 3.2L13 5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"></path>' +
  '</svg>'

export interface ChatMarkdownLabels {
  /** 代码块复制按钮的 title / aria-label；渲染器不含界面文案，由调用方按当前语言传入 */
  copyCode: string
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|avif|svg|ico)$/i
/** 内联引用写法：`@路径` / `@image: 路径`（与输入区 @ 选择器一致） */
const INLINE_REF = /@(?:(image:)\s*)?([^\s@]+)/g
/** Markdown 里出现 `<` 时，只有这些协议允许生成可点击链接 */
const SAFE_HREF = /^(https?:\/\/|mailto:)/i
/** 属性值统一用双引号包裹，转义只需补 `"` */
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'"
}

export function escapeChatText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** 属性值：先 HTML 转义再补引号，避免路径里的引号越出属性边界 */
function attrValue(value: string): string {
  return escapeChatText(value).replace(/"/g, '&quot;')
}

/** 扩展名判断是否为图片（内联引用与 md 图片都据此决定是否出卡片） */
export function isImageLikePath(path: string): boolean {
  return IMAGE_EXT.test(path)
}

/** 带协议的远端地址：图片卡片只认工程内 / 本地文件路径，远端地址留给文本形态 */
function isRemoteUrl(path: string): boolean {
  if (/^[A-Za-z]:[\\/]/.test(path)) return false // Windows 盘符不是协议
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(path) || /^data:/i.test(path)
}

/** 图片卡片：src 交给渲染层的 data-src 管线解析，失败时由指令回退成文本 chip */
function imageCard(path: string, name: string): string {
  const label = name.trim() || (path.split('/').pop() ?? path)
  return (
    `<span class="chat-msg-card">` +
    `<img data-src="${attrValue(path)}" alt="${attrValue(label)}">` +
    `<span class="chat-msg-card-name">${escapeChatText(label)}</span>` +
    `</span>`
  )
}

/** 把未转义文本里的内联 `@路径` 换成卡片 / chip，其余部分照常转义 */
function substituteInlineRefs(text: string): string {
  let out = ''
  let last = 0
  INLINE_REF.lastIndex = 0
  for (let match = INLINE_REF.exec(text); match; match = INLINE_REF.exec(text)) {
    const [full, prefix, raw] = match
    const path = (raw ?? '').replace(/\\/g, '/')
    out += escapeChatText(text.slice(last, match.index))
    out += isImageLikePath(path)
      ? imageCard(path, path.split('/').pop() ?? path)
      : `<span class="inline-ref">@${escapeChatText(prefix ?? '')}${escapeChatText(raw ?? '')}</span>`
    last = match.index + full.length
  }
  return out + escapeChatText(text.slice(last))
}

/** 数字 / 命名实体解码：只用于链接协议判定，解码结果不会进入输出 */
function decodeHrefEntities(href: string): string {
  return href
    .replace(/&#x([0-9a-f]+);?/gi, (_m, hex: string) => codePointToString(parseInt(hex, 16)))
    .replace(/&#(\d+);?/g, (_m, dec: string) => codePointToString(Number(dec)))
    .replace(/&([a-z]+);?/gi, (_m, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? '')
}

function codePointToString(codePoint: number): string {
  if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) return ''
  try {
    return String.fromCodePoint(codePoint)
  } catch {
    return ''
  }
}

/**
 * 是否允许生成为可点击链接：先实体解码、再去掉空白与控制字符，
 * 然后只认 http(s) / mailto —— 挡 `JaVaScRiPt:`、`java&#115;cript:`、`java\nscript:` 等写法。
 */
function isSafeHref(href: string): boolean {
  const decoded = decodeHrefEntities(href).replace(/[\s\u0000-\u001f]/g, '')
  return SAFE_HREF.test(decoded)
}

/** 解析器按文案缓存：renderer 闭包捕获 labels，语言切换时才重建 */
let cachedParser: { copyCode: string; parser: Marked } | null = null

function parserFor(labels: ChatMarkdownLabels): Marked {
  if (cachedParser?.copyCode === labels.copyCode) return cachedParser.parser
  const parser = new Marked({
    gfm: true,
    // 对话场景按「单个换行即换行」更贴近模型的书写习惯
    breaks: true,
    renderer: {
      // 原始 HTML 一律丢弃：气泡里不需要内联 HTML，而模型输出不可信
      html: () => '',
      // 普通文本：转义后把内联 `@路径` 换成卡片 / chip
      text({ text }: Tokens.Text | Tokens.Escape) {
        return substituteInlineRefs(text)
      },
      codespan({ text }: Tokens.Codespan) {
        return `<code class="md-code-inline">${escapeChatText(text)}</code>`
      },
      code({ text, lang }: Tokens.Code) {
        const language = (lang ?? '').trim().split(/\s+/)[0] ?? ''
        const label = attrValue(labels.copyCode)
        return (
          '<div class="md-code">' +
          '<div class="md-code-bar">' +
          `<span class="md-code-lang">${escapeChatText(language)}</span>` +
          `<button type="button" class="md-code-copy" data-copy-code title="${label}" aria-label="${label}">` +
          COPY_ICON +
          DONE_ICON +
          '</button>' +
          '</div>' +
          `<pre class="md-pre"><code>${escapeChatText(text)}</code></pre>` +
          '</div>'
        )
      },
      link({ href, tokens }: Tokens.Link) {
        // 子 token 走本实例的 renderer，因此文本照常转义（this.parser 由 marked 注入）
        const label = this.parser.parseInline(tokens)
        if (!isSafeHref(href)) return label
        return (
          `<a class="md-link" href="${attrValue(href)}" target="_blank" rel="noopener noreferrer">` +
          `${label}</a>`
        )
      },
      image({ href, text }: Tokens.Image) {
        const path = href.replace(/\\/g, '/')
        if (isImageLikePath(path) && !isRemoteUrl(path)) return imageCard(path, text ?? '')
        return escapeChatText(text || path)
      }
    }
  })
  cachedParser = { copyCode: labels.copyCode, parser }
  return parser
}

/** 结果缓存：同一段文本会被多次渲染（状态变化、切会话重挂载），流式期间每帧文本都不同，不做长时间留存 */
let cachedHtml: { key: string; html: string } | null = null

/** 助手气泡：完整 Markdown 渲染 */
export function renderChatMarkdown(text: string, labels: ChatMarkdownLabels): string {
  if (!text) return ''
  const key = `${labels.copyCode}\u0000${text}`
  if (cachedHtml?.key === key) return cachedHtml.html
  const html = parserFor(labels).parse(text) as string
  cachedHtml = { key, html }
  return html
}

/** 纯文本气泡（用户输入 / 状态行 / 提问卡）：只转义 + 高亮内联引用，不做 Markdown 解析 */
export function renderInlineChatRefs(text: string): string {
  return substituteInlineRefs(text)
}
