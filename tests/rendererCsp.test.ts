import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

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
})
