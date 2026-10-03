import { describe, expect, it } from 'vitest'
import { summarizeMediaUrlForLog } from '../src/shared/graph/execute/runLog'

/**
 * 运行日志里的媒体摘要必须自带单位：
 * 起因是一次排查——日志打印 `data:image/jpeg;base64,27232535B`，
 * 被读成「27MB 的二进制」甚至「坏掉的 base64」，实际它是整个 data URL 的**字符数**。
 * 现在统一写成 `~19.5MB (b64 27.2M chars)`，一眼能看出参考图有多大。
 */
describe('summarizeMediaUrlForLog', () => {
  it('base64 data URL：给出解码后体积与 base64 字符数', () => {
    // 4Mi 个 base64 字符 → 3MiB 字节
    const payload = 'A'.repeat(4 * 1024 * 1024)
    const summary = summarizeMediaUrlForLog(`data:image/jpeg;base64,${payload}`)
    expect(summary).toBe('data:image/jpeg;base64,~3.0MB (b64 4.2M chars)')
  })

  it('非 base64 data URL（如 svg 内联）：只报字符数', () => {
    const summary = summarizeMediaUrlForLog(`data:image/svg+xml,${'a'.repeat(1500)}`)
    expect(summary).toBe('data:image/svg+xml,~1.5K chars')
  })

  it('没有逗号的残缺 data URL 不抛错', () => {
    expect(summarizeMediaUrlForLog('data:image/png;base64')).toBe('data:image/png;base64')
  })

  it('短 http(s) URL 原样保留，长 URL 截断并标注长度', () => {
    expect(summarizeMediaUrlForLog('https://example.com/a.png')).toBe('https://example.com/a.png')
    const long = `https://example.com/${'a'.repeat(400)}.png`
    const summary = summarizeMediaUrlForLog(long)
    expect(summary.startsWith('https://example.com/')).toBe(true)
    expect(summary.endsWith(`…(${long.length})`)).toBe(true)
  })

  it('空串 / 空白返回空串', () => {
    expect(summarizeMediaUrlForLog('')).toBe('')
    expect(summarizeMediaUrlForLog('   ')).toBe('')
  })
})
