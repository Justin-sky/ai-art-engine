import { describe, expect, it } from 'vitest'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  handleStudioGameplayRequest,
  openGameplayDocument,
  releaseGameplayDocument
} from '../src/main/studioGameplayProtocol'

/**
 * 渲染层的 CSP 必须允许编译 wasm。
 *
 * 高斯泼溅（Spark）把 Rust/wasm 以 base64 内联进 bundle，运行时走 `WebAssembly.compile`。
 * CSP 里 `script-src` 少写 `'wasm-unsafe-eval'` 时 Chromium **直接拒绝编译**，
 * 而 Spark 那条初始化 promise 不会把失败暴露出来 —— 界面表现是泼溅永远「正在加载」，
 * 既不报错也不结束（图库缩略图与 3D 预览一起卡住）。这个坑踩过一次，钉住。
 */
const CSP_META_RE = /http-equiv="Content-Security-Policy"[\s\S]*?content="([^"]+)"/

function readCsp(file: string): string {
  const html = readFileSync(file, 'utf8')
  const match = CSP_META_RE.exec(html)
  return match?.[1] ?? ''
}

describe('renderer CSP', () => {
  it('allows wasm compilation in the renderer document', () => {
    const csp = readCsp(resolve(import.meta.dirname, '../src/renderer/index.html'))
    expect(csp).not.toBe('')
    const scriptSrc = /script-src([^;]*)/.exec(csp)?.[1] ?? ''
    expect(scriptSrc).toContain("'wasm-unsafe-eval'")
  })

  it('keeps the built shell in sync when it has been built', () => {
    const built = resolve(import.meta.dirname, '../out/renderer/index.html')
    if (!existsSync(built)) return
    expect(readCsp(built)).toContain("'wasm-unsafe-eval'")
  })

  it('forbids iframe srcdoc in renderer Vue components so inline HTML scripts always run under studio-gameplay:// CSP', () => {
    const root = resolve(import.meta.dirname, '../src/renderer/src')
    const vueFiles: string[] = []
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) walk(full)
        else if (entry.isFile() && entry.name.endsWith('.vue')) vueFiles.push(full)
      }
    }
    walk(root)

    const offenders = vueFiles.filter((file) =>
      /\bsrcdoc\s*=|:srcdoc\s*=/.test(readFileSync(file, 'utf8'))
    )
    expect(offenders).toEqual([])
  })

  it('serves registered HTML via studio-gameplay:// with inline, eval, wasm, and studio-media CSP', async () => {
    const html = '<!doctype html><html><body><script>window.__OK__=1</script></body></html>'
    const url = openGameplayDocument(html)
    expect(url).toMatch(/^studio-gameplay:\/\/local\/\?id=/)

    const res = handleStudioGameplayRequest(new Request(url))
    expect(res.status).toBe(200)
    expect(await res.text()).toBe(html)
    const csp = res.headers.get('Content-Security-Policy') ?? ''
    expect(csp).toContain("'unsafe-inline'")
    expect(csp).toContain("'wasm-unsafe-eval'")
    expect(csp).toContain('studio-media:')
    expect(csp).toContain("connect-src 'none'")

    releaseGameplayDocument(url)
    const afterRelease = handleStudioGameplayRequest(new Request(url))
    expect(afterRelease.status).toBe(404)
  })
})
