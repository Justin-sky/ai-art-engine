/**
 * 本地无头浏览器网页图文提取服务（运行于 Electron 主进程特权环境）。
 *
 * 解决痛点：
 * 1. `dsh` 的 `pwsh` 沙箱因 Windows 受限令牌无法直接拉起外部 `msedge.exe` / `chrome.exe`（会触发 0x80000003 崩溃弹窗），
 *    而主进程内建隐藏的 Electron `BrowserWindow({ show: false })` 本身就是完整的本地无头 Chromium，
 *    零外部依赖、零沙箱弹窗，天然支持 SPA 动态渲染、掘金/知乎/微信公众号/CSDN/Medium/文档站等页面。
 * 2. 普通 `web_fetch` 只拿纯文本、丢失文章里的架构图/流程图/代码截图，且微信公众号 `data-src` 懒加载图片与防盗链
 *    `Referer` 无法直接入库。本服务在无头浏览器中自动预置懒加载属性、平滑滚动触发 `IntersectionObserver`、
 *    按阅读顺序提取结构化章节正文 + 代码块 + 原位配图上下文，并将文章配图（含 `<img>`、`<canvas>`、`<svg>`）
 *    携带源站 `Referer` 下载或截屏落盘到工程 `Cache/imports/`，直接供画布节点（`output.timeline` / `asset.image` / `asset.video`）使用。
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { normalizePathSegment } from '@shared/assetPackage/pathname'
import { resolveCacheOutputRoot } from '@shared/domain'
import { projectService } from './projectService'

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'

const DEFAULT_MAX_IMAGES = 8
const HARD_MAX_IMAGES = 16
const PAGE_LOAD_TIMEOUT_MS = 18_000
const IMAGE_DOWNLOAD_TIMEOUT_MS = 12_000
const MAX_IMAGE_BYTES = 20 * 1024 * 1024

export interface ExtractedWebImageCandidate {
  /** 原始图片地址（或 data:image URL） */
  src: string
  /** img.alt 或标题 */
  alt: string
  /** 图注（figcaption 或相邻说明文字） */
  caption: string
  /** 所属章节标题（最近的 h1-h4） */
  sectionHeading: string
  /** 图片前后的正文上下文摘要，供 AI 判断该图对应的分镜段落 */
  contextText: string
  /** 渲染或原始像素宽 */
  width: number
  /** 渲染或原始像素高 */
  height: number
  /** 页面内直接导出的 dataURL（如 canvas 或同源图片），免二次网络请求 */
  dataUrl?: string
  /** 页面内元素坐标（当网络下载被防盗链拦截时可用于无头浏览器元素级截图兜底） */
  rect?: { x: number; y: number; width: number; height: number }
}

export interface DomExtractedArticlePayload {
  title: string
  siteName: string
  author: string
  description: string
  /** 含 `[IMAGE_SLOT_N]` 占位符的结构化 Markdown 正文 */
  markdownWithSlots: string
  images: ExtractedWebImageCandidate[]
}

export interface MaterializedWebArticleImage {
  /** 序号（从 1 开始，对应正文中 `[图1]`） */
  index: number
  /** 工程内相对路径（如 `Cache/imports/web_img_...png`），可直接传给画布节点 */
  relativePath: string
  /** 原始图片 URL */
  originalUrl: string
  /** 图片标题/Alt */
  alt: string
  /** 图注 */
  caption: string
  /** 所属文章章节标题 */
  sectionHeading: string
  /** 上下文段落摘要 */
  contextText: string
  width: number
  height: number
}

export interface WebArticleExtractResult {
  url: string
  title: string
  siteName: string
  author: string
  description: string
  /** 是否经由本地无头 Chromium 浏览器渲染提取 */
  renderedByHeadlessBrowser: boolean
  /** 结构化 Markdown 正文（已将原位图片替换为工程内 `@Cache/imports/...` 路径与图注） */
  markdown: string
  /** 已下载并写入 `Cache/imports/` 的文章配图列表 */
  images: MaterializedWebArticleImage[]
  /** 可选：网页首屏高清快照相对路径 */
  pageScreenshotRelativePath?: string
}

export interface WebArticleExtractOptions {
  url: string
  /** 最多提取并下载的文章配图数（默认 8，上限 16） */
  maxImages?: number
  /** 是否额外截取网页首屏快照（默认 false；当页面无普通图片时若开启可作为视觉参考） */
  capturePageScreenshot?: boolean
  /** 覆盖输出根目录（单测用；默认取当前打开工程根目录） */
  projectRootOverride?: string
  /** 覆盖缓存目录名（单测用；默认取工程 cacheOutputDir） */
  cacheOutputDirOverride?: string
}

/**
 * 校验公开 HTTP/HTTPS URL，拦截内网回环/链路本地地址（SSRF 防护）。
 */
export function validatePublicHttpUrl(rawUrl: string): URL {
  const trimmed = String(rawUrl ?? '').trim()
  if (!trimmed) {
    throw new Error('缺少网页 URL') // cjk-ok
  }
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    throw new Error(`无效的 URL 格式：${trimmed}`) // cjk-ok
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`仅支持 http:// 或 https:// 协议：${parsed.protocol}`) // cjk-ok
  }
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host.endsWith('.local') ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
  ) {
    throw new Error(`安全策略禁止访问本地或内网地址：${parsed.hostname}`) // cjk-ok
  }
  return parsed
}

/**
 * 通过文件头魔数（Magic Bytes）识别图片真实扩展名。
 * 微信公众号（`wx_fmt=png` 但无文件后缀）、知乎、掘金 CDN 经常返回无扩展名路径，必须按魔数或 Content-Type 落盘。
 */
export function sniffImageExtension(
  buf: Buffer,
  contentType?: string | null,
  urlHint?: string
): '.png' | '.jpg' | '.webp' | '.gif' | '.svg' | null {
  if (!buf || buf.length < 4) return null
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return '.png'
  }
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return '.jpg'
  }
  // GIF: GIF87a / GIF89a
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) {
    return '.gif'
  }
  // WEBP: RIFF....WEBP
  if (
    buf.length >= 12 &&
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  ) {
    return '.webp'
  }
  // SVG text
  const headText = buf.subarray(0, Math.min(buf.length, 512)).toString('utf8').trimStart()
  if (/^(?:<\?xml[^>]*>\s*)?<svg[\s>]/i.test(headText)) {
    return '.svg'
  }
  const ct = (contentType ?? '').toLowerCase()
  if (ct.includes('image/png')) return '.png'
  if (ct.includes('image/jpeg') || ct.includes('image/jpg')) return '.jpg'
  if (ct.includes('image/webp')) return '.webp'
  if (ct.includes('image/gif')) return '.gif'
  if (ct.includes('image/svg')) return '.svg'
  if (urlHint) {
    if (/[?&]wx_fmt=png\b|\.png(?:$|[?#])/i.test(urlHint)) return '.png'
    if (/[?&]wx_fmt=jpe?g\b|\.jpe?g(?:$|[?#])/i.test(urlHint)) return '.jpg'
    if (/[?&]wx_fmt=webp\b|\.webp(?:$|[?#])/i.test(urlHint)) return '.webp'
    if (/[?&]wx_fmt=gif\b|\.gif(?:$|[?#])/i.test(urlHint)) return '.gif'
  }
  return null
}

/**
 * 生成注入到无头浏览器页面内的「懒加载唤醒 + 自动分段滚动」脚本。
 */
export function buildHeadlessLazyScrollScript(): string {
  return `
    (async () => {
      try {
        const lazyAttrs = ['data-src', 'data-original', 'data-actualsrc', 'data-lazy-src', 'data-url', 'data- echo'];
        const promoteLazyImages = () => {
          for (const img of Array.from(document.querySelectorAll('img'))) {
            img.removeAttribute('loading');
            const cur = (img.getAttribute('src') || '').trim();
            const isPlaceholder = !cur || cur.startsWith('data:image/svg') || cur.startsWith('data:image/gif') || cur.includes('1x1') || cur.includes('blank.');
            for (const attr of lazyAttrs) {
              const candidate = (img.getAttribute(attr) || '').trim();
              if (candidate && !candidate.startsWith('data:image/svg') && isPlaceholder) {
                img.setAttribute('src', candidate);
                break;
              }
            }
          }
        };
        promoteLazyImages();
        const viewportH = Math.max(window.innerHeight || 800, 600);
        const maxSteps = 8;
        for (let step = 1; step <= maxSteps; step++) {
          const totalH = Math.max(
            document.body ? document.body.scrollHeight : 0,
            document.documentElement ? document.documentElement.scrollHeight : 0
          );
          const targetY = Math.min(step * Math.round(viewportH * 0.85), totalH);
          window.scrollTo(0, targetY);
          promoteLazyImages();
          await new Promise((r) => setTimeout(r, 160));
          if (targetY >= totalH) break;
        }
        window.scrollTo(0, 0);
        await new Promise((r) => setTimeout(r, 250));
        const pendingImgs = Array.from(document.querySelectorAll('img'))
          .filter((img) => img.src && !img.complete)
          .slice(0, 16);
        if (pendingImgs.length > 0) {
          await Promise.race([
            Promise.all(
              pendingImgs.map(
                (img) =>
                  new Promise((resolve) => {
                    img.addEventListener('load', resolve, { once: true });
                    img.addEventListener('error', resolve, { once: true });
                  })
              )
            ),
            new Promise((resolve) => setTimeout(resolve, 2200))
          ]);
        }
      } catch {}
      return true;
    })()
  `
}

/**
 * 生成注入到无头浏览器页面内的「结构化文章正文 + 代码块 + 配图及上下文提取」脚本。
 */
export function buildHeadlessDomExtractorScript(maxImages: number): string {
  const safeMax = Math.max(1, Math.min(HARD_MAX_IMAGES, maxImages))
  return `
    (() => {
      const MAX_IMGS = ${safeMax};
      const metaContent = (selector) => {
        const el = document.querySelector(selector);
        return el ? (el.getAttribute('content') || '').trim() : '';
      };
      const title =
        metaContent('meta[property="og:title"]') ||
        metaContent('meta[name="twitter:title"]') ||
        (document.querySelector('h1') ? (document.querySelector('h1').innerText || '').trim() : '') ||
        (document.title || '').trim();
      const siteName =
        metaContent('meta[property="og:site_name"]') ||
        location.hostname.replace(/^www\\./, '');
      const author =
        metaContent('meta[name="author"]') ||
        metaContent('meta[property="article:author"]') ||
        (document.querySelector('#js_name, .author-name, .user-name, [rel="author"]')
          ? (document.querySelector('#js_name, .author-name, .user-name, [rel="author"]').innerText || '').trim()
          : '');
      const description =
        metaContent('meta[property="og:description"]') ||
        metaContent('meta[name="description"]') ||
        '';

      const rootSelectors = [
        '#js_content',
        'article.markdown-body',
        'article',
        '.markdown-body',
        '.article-content',
        '.post-content',
        '.RichContent-inner',
        '.entry-content',
        '[role="main"] article',
        'main article',
        'main',
        '[role="main"]'
      ];
      let root = null;
      for (const sel of rootSelectors) {
        const candidate = document.querySelector(sel);
        if (candidate && (candidate.innerText || '').trim().length >= 120) {
          root = candidate;
          break;
        }
      }
      if (!root) root = document.body || document.documentElement;

      const NOISE_RE = /(?:\\b(?:nav|navbar|footer|sidebar|comment|comments|recommend|related|share|reward|donate|advert|ad-box|qrcode|copyright|breadcrumb|toc-container)\\b)/i;
      const isNoiseNode = (el) => {
        if (!el || el === root || el === document.body) return false;
        const tag = (el.tagName || '').toLowerCase();
        if (tag === 'nav' || tag === 'footer' || tag === 'aside' || tag === 'script' || tag === 'style' || tag === 'noscript') {
          return true;
        }
        const clsAndId = ((el.className && typeof el.className === 'string' ? el.className : '') + ' ' + (el.id || '')).trim();
        return NOISE_RE.test(clsAndId);
      };

      const resolveImgUrl = (img) => {
        const attrs = ['src', 'data-src', 'data-original', 'data-actualsrc', 'data-lazy-src', 'data-url'];
        for (const attr of attrs) {
          const val = (img.getAttribute(attr) || '').trim();
          if (!val || val.startsWith('data:image/svg') || val.startsWith('data:image/gif;base64,R0lGOD')) continue;
          try {
            return new URL(val, location.href).href;
          } catch {
            return val;
          }
        }
        if (img.currentSrc) return img.currentSrc;
        return '';
      };

      const isDecorativeImage = (img, src, w, h) => {
        if (!src) return true;
        const lower = (src + ' ' + (img.alt || '') + ' ' + (img.className || '')).toLowerCase();
        if (/(?:avatar|emoji|emoticon|icon|logo|badge|qrcode|qr-code| loading|spinner|pixel|tracker)/i.test(lower)) {
          if (w < 240 && h < 240) return true;
        }
        if (w > 0 && h > 0 && (w < 110 || h < 70)) return true;
        if (w === 0 && h === 0) return false;
        return false;
      };

      const tryCanvasExport = (el) => {
        try {
          if (el.tagName && el.tagName.toLowerCase() === 'canvas') {
            return el.toDataURL('image/png');
          }
          if (el.tagName && el.tagName.toLowerCase() === 'img' && el.complete && el.naturalWidth >= 120) {
            const c = document.createElement('canvas');
            const maxDim = 1600;
            let cw = el.naturalWidth;
            let ch = el.naturalHeight;
            if (cw > maxDim || ch > maxDim) {
              const s = maxDim / Math.max(cw, ch);
              cw = Math.round(cw * s);
              ch = Math.round(ch * s);
            }
            c.width = cw;
            c.height = ch;
            const ctx = c.getContext('2d');
            if (ctx) {
              ctx.drawImage(el, 0, 0, cw, ch);
              return c.toDataURL('image/png');
            }
          }
        } catch {}
        return undefined;
      };

      const images = [];
      const seenImgUrls = new Set();
      const lines = [];
      let currentHeading = title || 'Section';
      let lastParagraphText = '';

      const registerImage = (el, src, altText) => {
        if (images.length >= MAX_IMGS) return null;
        if (seenImgUrls.has(src)) return null;
        const rect = el.getBoundingClientRect ? el.getBoundingClientRect() : { x: 0, y: 0, width: 0, height: 0 };
        const w = Math.round(el.naturalWidth || el.width || rect.width || 0);
        const h = Math.round(el.naturalHeight || el.height || rect.height || 0);
        if (isDecorativeImage(el, src, w, h)) return null;
        seenImgUrls.add(src);
        let caption = '';
        const fig = el.closest ? el.closest('figure') : null;
        if (fig) {
          const fc = fig.querySelector('figcaption');
          if (fc) caption = (fc.innerText || '').trim();
        }
        if (!caption && el.nextElementSibling) {
          const nextTag = (el.nextElementSibling.tagName || '').toLowerCase();
          const nextTxt = (el.nextElementSibling.innerText || '').trim();
          if ((nextTag === 'figcaption' || nextTag === 'span' || nextTag === 'em') && nextTxt.length > 0 && nextTxt.length <= 120) {
            caption = nextTxt;
          }
        }
        const dataUrl = tryCanvasExport(el);
        const idx = images.length + 1;
        images.push({
          src,
          alt: (altText || caption || '').slice(0, 160),
          caption: caption.slice(0, 200),
          sectionHeading: currentHeading.slice(0, 120),
          contextText: lastParagraphText.slice(0, 280),
          width: w || 800,
          height: h || 450,
          ...(dataUrl ? { dataUrl } : {}),
          ...(rect && rect.width >= 100 && rect.height >= 60
            ? {
                rect: {
                  x: Math.max(0, Math.round(rect.x + window.scrollX)),
                  y: Math.max(0, Math.round(rect.y + window.scrollY)),
                  width: Math.round(rect.width),
                  height: Math.round(rect.height)
                }
              }
            : {})
        });
        return idx;
      };

      const walk = (node) => {
        if (!node) return;
        if (node.nodeType === Node.TEXT_NODE) return;
        if (node.nodeType !== Node.ELEMENT_NODE) return;
        const el = node;
        if (isNoiseNode(el)) return;
        const tag = (el.tagName || '').toLowerCase();

        if (/^h[1-6]$/.test(tag)) {
          const level = Number(tag.slice(1));
          const text = (el.innerText || '').replace(/\\s+/g, ' ').trim();
          if (text) {
            currentHeading = text;
            lines.push('', '#'.repeat(Math.min(level, 4)) + ' ' + text, '');
          }
          return;
        }

        if (tag === 'pre') {
          const code = (el.innerText || '').trim();
          if (code) {
            lines.push('', '\`\`\`', code.slice(0, 1600), '\`\`\`', '');
          }
          return;
        }

        if (tag === 'img') {
          const src = resolveImgUrl(el);
          const idx = registerImage(el, src, el.getAttribute('alt') || el.getAttribute('title') || '');
          if (idx !== null) {
            lines.push('', '[IMAGE_SLOT_' + idx + ']', '');
          }
          return;
        }

        if (tag === 'canvas') {
          const rect = el.getBoundingClientRect ? el.getBoundingClientRect() : { width: 0, height: 0 };
          if ((el.width >= 200 || rect.width >= 200) && (el.height >= 120 || rect.height >= 120)) {
            const dataUrl = tryCanvasExport(el);
            if (dataUrl) {
              const idx = registerImage(el, dataUrl, 'Canvas Chart');
              if (idx !== null) {
                lines.push('', '[IMAGE_SLOT_' + idx + ']', '');
              }
            }
          }
          return;
        }

        if (tag === 'p' || tag === 'li' || tag === 'blockquote') {
          const innerImgs = Array.from(el.querySelectorAll('img'));
          const text = (el.innerText || '').replace(/\\s+/g, ' ').trim();
          if (text) {
            lastParagraphText = text;
            const prefix = tag === 'li' ? '- ' : tag === 'blockquote' ? '> ' : '';
            lines.push(prefix + text);
          }
          for (const img of innerImgs) {
            const src = resolveImgUrl(img);
            const idx = registerImage(img, src, img.getAttribute('alt') || img.getAttribute('title') || '');
            if (idx !== null) {
              lines.push('', '[IMAGE_SLOT_' + idx + ']', '');
            }
          }
          return;
        }

        for (const child of Array.from(el.children || [])) {
          walk(child);
        }
      };

      walk(root);

      let markdownWithSlots = lines.join('\\n').replace(/\\n{3,}/g, '\\n\\n').trim();
      if (markdownWithSlots.length < 80 && root && root.innerText) {
        markdownWithSlots = root.innerText.replace(/\\n{3,}/g, '\\n\\n').trim();
      }

      return {
        title,
        siteName,
        author,
        description,
        markdownWithSlots: markdownWithSlots.slice(0, 28000),
        images
      };
    })()
  `
}

/**
 * 纯 HTML 静态解析兜底（当无头浏览器不可用或在纯 Node 单测环境下使用）。
 */
export function extractArticleFromHtmlFallback(
  html: string,
  pageUrl: string,
  maxImages = DEFAULT_MAX_IMAGES
): DomExtractedArticlePayload {
  const safeMax = Math.max(1, Math.min(HARD_MAX_IMAGES, maxImages))
  const pickMeta = (re: RegExp): string => {
    const m = re.exec(html)
    return m?.[1] ? decodeHtmlEntities(m[1].trim()) : ''
  }
  const title =
    pickMeta(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ||
    pickMeta(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i) ||
    pickMeta(/<title[^>]*>([\s\S]*?)<\/title>/i) ||
    '技术文章' // cjk-ok
  const siteName =
    pickMeta(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i) ||
    (() => {
      try {
        return new URL(pageUrl).hostname.replace(/^www\./, '')
      } catch {
        return ''
      }
    })()
  const author = pickMeta(/<meta[^>]+name=["']author["'][^>]+content=["']([^"']+)["']/i) || ''
  const description =
    pickMeta(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i) ||
    pickMeta(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) ||
    ''

  // 剔除 script / style / nav / footer
  const bodyHtml = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')

  const images: ExtractedWebImageCandidate[] = []
  const seenUrls = new Set<string>()
  let currentHeading = title
  let lastParagraph = ''
  const lines: string[] = []

  const tokenRe = /<(h[1-4]|p|pre|li|blockquote|img)\b([^>]*)(?:>([\s\S]*?)<\/\1>|\/?>)/gi
  let match: RegExpExecArray | null
  while ((match = tokenRe.exec(bodyHtml)) !== null) {
    const tag = match[1].toLowerCase()
    const attrs = match[2] ?? ''
    const inner = match[3] ?? ''

    if (tag === 'img') {
      const imgIdx = tryCollectImgTag(attrs)
      if (imgIdx !== null) lines.push('', `[IMAGE_SLOT_${imgIdx}]`, '')
      continue
    }

    // 检查段落内部是否含 <img>
    const innerImgRegex = /<img\b([^>]*)\/?>/gi
    const innerSlots: number[] = []
    let imgMatch: RegExpExecArray | null
    while ((imgMatch = innerImgRegex.exec(inner)) !== null) {
      const idx = tryCollectImgTag(imgMatch[1] ?? '')
      if (idx !== null) innerSlots.push(idx)
    }

    const plain = decodeHtmlEntities(
      inner
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    )
    if (!plain && innerSlots.length === 0) continue

    if (/^h[1-4]$/.test(tag) && plain) {
      const level = Number(tag.slice(1))
      currentHeading = plain
      lines.push('', `${'#'.repeat(level)} ${plain}`, '')
    } else if (tag === 'pre' && plain) {
      lines.push('', '```', plain.slice(0, 1600), '```', '')
    } else if (plain) {
      lastParagraph = plain
      const prefix = tag === 'li' ? '- ' : tag === 'blockquote' ? '> ' : ''
      lines.push(`${prefix}${plain}`)
    }

    for (const slot of innerSlots) {
      lines.push('', `[IMAGE_SLOT_${slot}]`, '')
    }
  }

  function tryCollectImgTag(attrs: string): number | null {
    if (images.length >= safeMax) return null
    const srcMatch =
      /\b(?:data-src|data-original|data-actualsrc|data-lazy-src|src)=["']([^"']+)["']/i.exec(attrs)
    const rawSrc = srcMatch?.[1]?.trim() ?? ''
    if (!rawSrc || rawSrc.startsWith('data:image/svg') || rawSrc.startsWith('data:image/gif')) {
      return null
    }
    let resolved = rawSrc
    try {
      resolved = new URL(rawSrc, pageUrl).href
    } catch {
      /* keep rawSrc */
    }
    if (seenUrls.has(resolved)) return null
    if (/(?:avatar|emoji|icon|logo|badge|qrcode|pixel|tracker)/i.test(resolved)) return null
    seenUrls.add(resolved)
    const altMatch = /\balt=["']([^"']*)["']/i.exec(attrs)
    const alt = decodeHtmlEntities(altMatch?.[1]?.trim() ?? '')
    const idx = images.length + 1
    images.push({
      src: resolved,
      alt: alt.slice(0, 160),
      caption: alt.slice(0, 160),
      sectionHeading: currentHeading.slice(0, 120),
      contextText: lastParagraph.slice(0, 280),
      width: 800,
      height: 450
    })
    return idx
  }

  const markdownWithSlots = lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return {
    title,
    siteName,
    author,
    description,
    markdownWithSlots: markdownWithSlots.slice(0, 28000),
    images
  }
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
}

/**
 * 将 `markdownWithSlots` 中的 `[IMAGE_SLOT_N]` 替换为已落盘到工程 `Cache/imports/` 的真实图片标记。
 */
export function formatExtractedArticleMarkdown(
  payload: DomExtractedArticlePayload,
  materializedImages: MaterializedWebArticleImage[]
): string {
  const byIndex = new Map<number, MaterializedWebArticleImage>()
  for (const img of materializedImages) {
    byIndex.set(img.index, img)
  }
  let md = payload.markdownWithSlots.replace(/\[IMAGE_SLOT_(\d+)\]/g, (_full, rawIdx) => {
    const idx = Number(rawIdx)
    const item = byIndex.get(idx)
    if (!item) return ''
    const label = item.alt || item.caption || item.sectionHeading || `文章配图 ${idx}` // cjk-ok
    return `![图${idx}：${label}](@${item.relativePath})\n> [图${idx} 工程素材路径: \`@${item.relativePath}\` | 章节: ${item.sectionHeading || '正文'}${item.caption ? ` | 图注: ${item.caption}` : ''}]` // cjk-ok
  })
  md = md.replace(/\n{3,}/g, '\n\n').trim()
  return md
}

/**
 * 下载远程图片或解码 dataURL，并写入工程 `Cache/imports/` 目录。
 */
export async function materializeWebImageToImports(input: {
  src: string
  dataUrl?: string
  refererUrl: string
  importsDirAbs: string
  projectRootAbs: string
  filePrefix: string
}): Promise<{ relativePath: string; basename: string } | null> {
  const { src, dataUrl, refererUrl, importsDirAbs, projectRootAbs, filePrefix } = input
  let buffer: Buffer | null = null
  let contentType: string | null = null

  // 1. 若无头浏览器已直接从 DOM/Canvas 导出 data:image/...;base64
  const effectiveDataUrl = dataUrl?.startsWith('data:image/')
    ? dataUrl
    : src.startsWith('data:image/')
      ? src
      : null
  if (effectiveDataUrl) {
    const commaIdx = effectiveDataUrl.indexOf(',')
    if (commaIdx > 0) {
      const header = effectiveDataUrl.slice(0, commaIdx)
      const b64 = effectiveDataUrl.slice(commaIdx + 1)
      contentType = /^data:([^;]+)/i.exec(header)?.[1] ?? 'image/png'
      buffer = Buffer.from(b64, 'base64')
    }
  }

  // 2. 否则携带原网页 Referer 与桌面 User-Agent 请求图片二进制（支持微信公众号 mmbiz.qpic.cn / 知乎 / 掘金防盗链）
  if (!buffer && /^https?:\/\//i.test(src)) {
    validatePublicHttpUrl(src)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), IMAGE_DOWNLOAD_TIMEOUT_MS)
    try {
      const res = await fetch(src, {
        headers: {
          'User-Agent': DEFAULT_USER_AGENT,
          Referer: refererUrl,
          Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
        },
        redirect: 'follow',
        signal: controller.signal
      })
      if (res.ok) {
        contentType = res.headers.get('content-type')
        const ab = await res.arrayBuffer()
        if (ab.byteLength > 0 && ab.byteLength <= MAX_IMAGE_BYTES) {
          buffer = Buffer.from(ab)
        }
      }
    } catch {
      buffer = null
    } finally {
      clearTimeout(timer)
    }
  }

  if (!buffer || buffer.length < 64) return null
  const ext = sniffImageExtension(buffer, contentType, src)
  if (!ext) return null

  mkdirSync(importsDirAbs, { recursive: true })
  const safeBase = normalizePathSegment(filePrefix) || 'web_img'
  let fileName = `${safeBase}${ext}`
  let counter = 1
  while (existsSync(join(importsDirAbs, fileName))) {
    counter += 1
    fileName = `${safeBase}_${counter}${ext}`
  }
  const destAbs = join(importsDirAbs, fileName)
  writeFileSync(destAbs, buffer)
  const relPosix = relative(projectRootAbs, destAbs).replace(/\\/g, '/')
  return {
    relativePath: relPosix,
    basename: safeBase
  }
}

/**
 * 在 Electron 主进程启动隐藏的本地无头 `BrowserWindow` 渲染目标网页、触发懒加载滚动并提取图文与截图。
 */
async function renderAndExtractWithElectronHeadlessBrowser(
  url: string,
  maxImages: number,
  capturePageScreenshot: boolean
): Promise<{
  payload: DomExtractedArticlePayload
  pageScreenshotPng?: Buffer
  elementScreenshots: Map<number, Buffer>
} | null> {
  let BrowserWindowCtor: typeof import('electron').BrowserWindow | undefined
  try {
    const electronMod = await import('electron')
    BrowserWindowCtor = electronMod.BrowserWindow
  } catch {
    return null
  }
  if (!BrowserWindowCtor || typeof BrowserWindowCtor !== 'function') {
    return null
  }

  const win = new BrowserWindowCtor({
    show: false,
    width: 1280,
    height: 900,
    backgroundColor: '#ffffff',
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      partition: 'temp:aiart-web-extract'
    }
  })

  try {
    win.webContents.setAudioMuted(true)
    win.webContents.setUserAgent(DEFAULT_USER_AGENT)
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.webContents.session.setPermissionRequestHandler((_wc, _perm, callback) => callback(false))

    await Promise.race([
      win.loadURL(url, {
        userAgent: DEFAULT_USER_AGENT
      }),
      new Promise<void>((resolve) => setTimeout(resolve, PAGE_LOAD_TIMEOUT_MS))
    ])

    // 留出 SPA 框架首屏挂载时间
    await new Promise((r) => setTimeout(r, 900))

    // 执行懒加载属性提升与分段滚动
    await win.webContents.executeJavaScript(buildHeadlessLazyScrollScript(), true)

    // 提取文章 DOM 结构化正文与配图列表
    const rawPayload = (await win.webContents.executeJavaScript(
      buildHeadlessDomExtractorScript(maxImages),
      true
    )) as DomExtractedArticlePayload | null

    if (!rawPayload || typeof rawPayload !== 'object') {
      return null
    }

    let pageScreenshotPng: Buffer | undefined
    if (capturePageScreenshot) {
      try {
        windowScrollTo(win, 0, 0)
        await new Promise((r) => setTimeout(r, 150))
        const img = await win.webContents.capturePage()
        if (!img.isEmpty()) {
          pageScreenshotPng = img.toPNG()
        }
      } catch {
        /* ignore screenshot error */
      }
    }

    // 对未拿到 dataUrl 的图片，若后续防盗链下载失败，可利用无头浏览器按元素坐标截图兜底
    const elementScreenshots = new Map<number, Buffer>()
    for (let i = 0; i < rawPayload.images.length; i++) {
      const candidate = rawPayload.images[i]
      if (candidate.dataUrl || !candidate.rect) continue
      const { y, width, height } = candidate.rect
      if (width < 100 || height < 60) continue
      try {
        await win.webContents.executeJavaScript(`window.scrollTo(0, ${Math.max(0, y - 80)})`, true)
        await new Promise((r) => setTimeout(r, 120))
        const localRect = (await win.webContents.executeJavaScript(
          `(() => {
            const imgs = Array.from(document.querySelectorAll('img'));
            const match = imgs.find((el) => (el.currentSrc || el.src || '').includes(${JSON.stringify(candidate.src.slice(0, 48))}));
            if (!match) return null;
            const r = match.getBoundingClientRect();
            return { x: Math.max(0, Math.round(r.x)), y: Math.max(0, Math.round(r.y)), width: Math.round(r.width), height: Math.round(r.height) };
          })()`,
          true
        )) as { x: number; y: number; width: number; height: number } | null
        if (
          localRect &&
          localRect.width >= 100 &&
          localRect.height >= 60 &&
          localRect.x + localRect.width <= 1280 &&
          localRect.y + localRect.height <= 900
        ) {
          const captured = await win.webContents.capturePage(localRect)
          if (!captured.isEmpty()) {
            elementScreenshots.set(i + 1, captured.toPNG())
          }
        }
      } catch {
        /* ignore element capture error */
      }
    }

    return {
      payload: rawPayload,
      pageScreenshotPng,
      elementScreenshots
    }
  } catch {
    return null
  } finally {
    if (!win.isDestroyed()) {
      win.destroy()
    }
  }
}

function windowScrollTo(win: import('electron').BrowserWindow, x: number, y: number): void {
  void win.webContents.executeJavaScript(`window.scrollTo(${x}, ${y})`, true).catch(() => {})
}

/**
 * 主入口：使用本地无头浏览器抓取技术文章 URL，提取结构化 Markdown 正文并将配图下载到 `Cache/imports/`。
 */
export async function extractWebArticleWithHeadlessBrowser(
  options: WebArticleExtractOptions
): Promise<WebArticleExtractResult> {
  const parsedUrl = validatePublicHttpUrl(options.url)
  const normalizedUrl = parsedUrl.href
  const maxImages = Math.max(
    1,
    Math.min(HARD_MAX_IMAGES, Number(options.maxImages ?? DEFAULT_MAX_IMAGES) || DEFAULT_MAX_IMAGES)
  )
  const capturePageScreenshot = Boolean(options.capturePageScreenshot)

  const projectRoot = options.projectRootOverride?.trim() || projectService.getRoot()
  const cacheRoot = resolveCacheOutputRoot(
    options.cacheOutputDirOverride ?? projectService.getConfig().cacheOutputDir
  )
  const importsDirAbs = join(projectRoot, cacheRoot, 'imports')
  mkdirSync(importsDirAbs, { recursive: true })

  const stamp = new Date()
    .toISOString()
    .replace(/[-:.TZ]/g, '')
    .slice(0, 15)

  // 1. 优先通过本地无头 Chromium 浏览器渲染提取
  let renderedByHeadlessBrowser = false
  let payload: DomExtractedArticlePayload | null = null
  let pageScreenshotPng: Buffer | undefined
  let elementScreenshots = new Map<number, Buffer>()

  const headlessRes = await renderAndExtractWithElectronHeadlessBrowser(
    normalizedUrl,
    maxImages,
    capturePageScreenshot
  )
  if (headlessRes && headlessRes.payload.markdownWithSlots.trim().length > 0) {
    renderedByHeadlessBrowser = true
    payload = headlessRes.payload
    pageScreenshotPng = headlessRes.pageScreenshotPng
    elementScreenshots = headlessRes.elementScreenshots
  }

  // 2. 若在纯 Node 测试环境或无头窗口未能提取，回退 HTTP 抓取 + HTML 解析
  if (!payload) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), PAGE_LOAD_TIMEOUT_MS)
    try {
      const res = await fetch(normalizedUrl, {
        headers: {
          'User-Agent': DEFAULT_USER_AGENT,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        },
        redirect: 'follow',
        signal: controller.signal
      })
      if (!res.ok) {
        throw new Error(`网页请求失败（HTTP ${res.status}）`) // cjk-ok
      }
      const html = await res.text()
      payload = extractArticleFromHtmlFallback(html, normalizedUrl, maxImages)
    } finally {
      clearTimeout(timer)
    }
  }

  // 3. 将提取到的文章配图逐一下载/导出到工程 `Cache/imports/`
  const materializedImages: MaterializedWebArticleImage[] = []
  for (let i = 0; i < payload.images.length && materializedImages.length < maxImages; i++) {
    const candidate = payload.images[i]
    const slotIndex = i + 1
    const filePrefix = `${stamp}_article_fig_${slotIndex}`
    let saved = await materializeWebImageToImports({
      src: candidate.src,
      dataUrl: candidate.dataUrl,
      refererUrl: normalizedUrl,
      importsDirAbs,
      projectRootAbs: projectRoot,
      filePrefix
    })

    // 若防盗链/跨域导致直接下载失败，使用无头浏览器對该图片元素截取的 PNG 兜底
    if (!saved && elementScreenshots.has(slotIndex)) {
      const pngBuf = elementScreenshots.get(slotIndex)!
      const fallbackDataUrl = `data:image/png;base64,${pngBuf.toString('base64')}`
      saved = await materializeWebImageToImports({
        src: candidate.src,
        dataUrl: fallbackDataUrl,
        refererUrl: normalizedUrl,
        importsDirAbs,
        projectRootAbs: projectRoot,
        filePrefix
      })
    }

    if (saved) {
      materializedImages.push({
        index: slotIndex,
        relativePath: saved.relativePath,
        originalUrl: candidate.src,
        alt: candidate.alt,
        caption: candidate.caption,
        sectionHeading: candidate.sectionHeading,
        contextText: candidate.contextText,
        width: candidate.width,
        height: candidate.height
      })
    }
  }

  // 4. 可选保存首屏网页快照
  let pageScreenshotRelativePath: string | undefined
  if (pageScreenshotPng && pageScreenshotPng.length > 64) {
    const shotSaved = await materializeWebImageToImports({
      src: normalizedUrl,
      dataUrl: `data:image/png;base64,${pageScreenshotPng.toString('base64')}`,
      refererUrl: normalizedUrl,
      importsDirAbs,
      projectRootAbs: projectRoot,
      filePrefix: `${stamp}_article_page`
    })
    if (shotSaved) {
      pageScreenshotRelativePath = shotSaved.relativePath
    }
  }

  const markdown = formatExtractedArticleMarkdown(payload, materializedImages)

  return {
    url: normalizedUrl,
    title: payload.title || '技术文章', // cjk-ok
    siteName: payload.siteName,
    author: payload.author,
    description: payload.description,
    renderedByHeadlessBrowser,
    markdown,
    images: materializedImages,
    ...(pageScreenshotRelativePath ? { pageScreenshotRelativePath } : {})
  }
}
