import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { toolAccessOf } from '../src/shared/mcpModeAccess'
import {
  buildHeadlessDomExtractorScript,
  buildHeadlessLazyScrollScript,
  extractArticleFromHtmlFallback,
  formatExtractedArticleMarkdown,
  materializeWebImageToImports,
  sniffImageExtension,
  validatePublicHttpUrl
} from '../src/main/services/webArticleExtractService'

describe('本地无头浏览器网页图文提取服务 (webArticleExtractService)', () => {
  it('validatePublicHttpUrl 放行公开 http/https URL 并拦截本地或内网地址（SSRF 防护）', () => {
    expect(validatePublicHttpUrl('https://juejin.cn/post/123456').href).toBe(
      'https://juejin.cn/post/123456'
    )
    expect(validatePublicHttpUrl('https://mp.weixin.qq.com/s/abcdef').hostname).toBe(
      'mp.weixin.qq.com'
    )
    expect(() => validatePublicHttpUrl('file:///etc/passwd')).toThrow(/仅支持/)
    expect(() => validatePublicHttpUrl('http://127.0.0.1:8080/admin')).toThrow(/禁止访问/)
    expect(() => validatePublicHttpUrl('http://localhost:3000/test')).toThrow(/禁止访问/)
    expect(() => validatePublicHttpUrl('http://192.168.1.10/secret')).toThrow(/禁止访问/)
    expect(() => validatePublicHttpUrl('http://10.0.0.5/internal')).toThrow(/禁止访问/)
    expect(() => validatePublicHttpUrl('http://169.254.169.254/latest/meta-data')).toThrow(
      /禁止访问/
    )
  })

  it('sniffImageExtension 根据文件头魔数与 wx_fmt 识别 PNG / JPG / WEBP / GIF / SVG', () => {
    const pngBuf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])
    expect(sniffImageExtension(pngBuf)).toBe('.png')

    const jpgBuf = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])
    expect(sniffImageExtension(jpgBuf)).toBe('.jpg')

    const gifBuf = Buffer.from('GIF89a____', 'ascii')
    expect(sniffImageExtension(gifBuf)).toBe('.gif')

    const webpBuf = Buffer.from([
      0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50
    ])
    expect(sniffImageExtension(webpBuf)).toBe('.webp')

    const svgBuf = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>', 'utf8')
    expect(sniffImageExtension(svgBuf)).toBe('.svg')

    const unknownBuf = Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05])
    expect(
      sniffImageExtension(unknownBuf, null, 'https://mmbiz.qpic.cn/mmbiz_png/xxx/640?wx_fmt=png')
    ).toBe('.png')
  })

  it('extractArticleFromHtmlFallback 与 formatExtractedArticleMarkdown 正确提取章节、代码块与懒加载 data-src 配图', () => {
    const html = `
      <!doctype html>
      <html>
        <head>
          <meta property="og:title" content="深入理解 WebGPU 渲染管线架构" />
          <meta property="og:site_name" content="技术专栏" />
          <meta name="author" content="AIArt Team" />
        </head>
        <body>
          <article>
            <h1>深入理解 WebGPU 渲染管线架构</h1>
            <p>WebGPU 提供了现代 GPU 的底层显式控制能力，大幅降低驱动开销。</p>
            <img data-src="https://mmbiz.qpic.cn/mmbiz_png/arch_diagram/640?wx_fmt=png" alt="WebGPU 架构总览图" />
            <h2>二、计算着色器管线</h2>
            <p>计算管线通过 Workgroup 并发调度大规模粒子与图像处理任务。</p>
            <pre>const pipeline = device.createComputePipeline({ layout: 'auto' });</pre>
            <p><img src="/images/compute-flow.webp" alt="Compute Shader 调度流程" /></p>
          </article>
        </body>
      </html>
    `
    const payload = extractArticleFromHtmlFallback(html, 'https://example.com/posts/webgpu', 8)
    expect(payload.title).toBe('深入理解 WebGPU 渲染管线架构')
    expect(payload.siteName).toBe('技术专栏')
    expect(payload.author).toBe('AIArt Team')
    expect(payload.images).toHaveLength(2)
    expect(payload.images[0]?.src).toBe(
      'https://mmbiz.qpic.cn/mmbiz_png/arch_diagram/640?wx_fmt=png'
    )
    expect(payload.images[0]?.alt).toBe('WebGPU 架构总览图')
    expect(payload.images[0]?.contextText).toContain('WebGPU 提供了现代 GPU')
    expect(payload.images[1]?.src).toBe('https://example.com/images/compute-flow.webp')
    expect(payload.images[1]?.sectionHeading).toBe('二、计算着色器管线')

    const formatted = formatExtractedArticleMarkdown(payload, [
      {
        index: 1,
        relativePath: 'Cache/imports/fig_1.png',
        originalUrl: payload.images[0]!.src,
        alt: payload.images[0]!.alt,
        caption: payload.images[0]!.caption,
        sectionHeading: payload.images[0]!.sectionHeading,
        contextText: payload.images[0]!.contextText,
        width: 800,
        height: 450
      },
      {
        index: 2,
        relativePath: 'Cache/imports/fig_2.webp',
        originalUrl: payload.images[1]!.src,
        alt: payload.images[1]!.alt,
        caption: payload.images[1]!.caption,
        sectionHeading: payload.images[1]!.sectionHeading,
        contextText: payload.images[1]!.contextText,
        width: 800,
        height: 450
      }
    ])
    expect(formatted).toContain('![图1：WebGPU 架构总览图](@Cache/imports/fig_1.png)')
    expect(formatted).toContain('![图2：Compute Shader 调度流程](@Cache/imports/fig_2.webp)')
    expect(formatted).toContain('createComputePipeline')
  })

  it('materializeWebImageToImports 支持将无头浏览器导出的 dataURL 落盘到工程 Cache/imports/', async () => {
    const tempProject = mkdtempSync(join(tmpdir(), 'aiart-web-extract-'))
    try {
      const importsDir = join(tempProject, 'Cache', 'imports')
      // 1x1 PNG base64
      const tinyPngB64 =
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
      const saved = await materializeWebImageToImports({
        src: 'https://example.com/diagram.png',
        dataUrl: `data:image/png;base64,${tinyPngB64}`,
        refererUrl: 'https://example.com/post',
        importsDirAbs: importsDir,
        projectRootAbs: tempProject,
        filePrefix: 'test_fig_1'
      })
      expect(saved).not.toBeNull()
      expect(saved?.relativePath).toBe('Cache/imports/test_fig_1.png')
    } finally {
      rmSync(tempProject, { recursive: true, force: true })
    }
  })

  it('无头浏览器脚本生成与 MCP 工具、Harness 路由已完整接线', () => {
    expect(buildHeadlessLazyScrollScript()).toContain('data-src')
    expect(buildHeadlessDomExtractorScript(8)).toContain('IMAGE_SLOT_')
    expect(toolAccessOf('web_extract_article')).toBe('read')

    const mcpSrc = readFileSync(resolve('src/main/services/mcpServerService.ts'), 'utf8')
    expect(mcpSrc).toContain("name: 'web_extract_article'")
    expect(mcpSrc).toContain('extractWebArticleWithHeadlessBrowser')

    const harnessSrc = readFileSync(resolve('src/main/services/deepseekHarnessService.ts'), 'utf8')
    expect(harnessSrc).toContain('web_extract_article')
    expect(harnessSrc).toContain('[Studio Host Pre-Extracted Web Article')
  })
})
