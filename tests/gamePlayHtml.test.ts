import { describe, expect, it } from 'vitest'
import {
  detectGamePlayMode,
  extractGameHtml,
  injectThreeIntoHtml,
  prepareGameHtml,
  rewriteThreeCoreRelativeImports,
  SAMPLE_GAME_HTML_2D,
  SAMPLE_GAME_HTML_3D,
  seedGameHtml,
  THREE_INJECT_MARKER,
  validateGameHtml
} from '../src/shared/gamePlay'

describe('gamePlay html contract', () => {
  it('extracts fenced html and wraps fragments', () => {
    const fenced = extractGameHtml('```html\n<html><body><canvas></canvas></body></html>\n```')
    expect(fenced).toMatch(/<html/i)
    const frag = extractGameHtml('<canvas id="c"></canvas><script>1</script>')
    expect(frag).toMatch(/<!DOCTYPE html>/i)
    expect(extractGameHtml('just text')).toBeNull()
  })

  it('prefers html fence over earlier non-html fence', () => {
    const raw = [
      '说明如下：',
      '```js',
      'console.log(1)',
      '```',
      '```html',
      '<!DOCTYPE html><html><body><canvas></canvas><script></script></body></html>',
      '```'
    ].join('\n')
    const html = extractGameHtml(raw)
    expect(html).toMatch(/<!DOCTYPE html>/i)
    expect(html).toMatch(/<canvas/i)
  })

  it('validates sample 2d / 3d and detects mode', () => {
    const v2 = validateGameHtml(SAMPLE_GAME_HTML_2D, 'auto')
    expect(v2.ok).toBe(true)
    expect(v2.mode).toBe('2d')
    const v3 = validateGameHtml(SAMPLE_GAME_HTML_3D, 'auto')
    expect(v3.ok).toBe(true)
    expect(v3.mode).toBe('3d')
    expect(detectGamePlayMode(SAMPLE_GAME_HTML_3D)).toBe('3d')
  })

  it('rejects dangerous patterns', () => {
    const bad = SAMPLE_GAME_HTML_2D.replace('</script>', 'parent.location=1</script>')
    const v = validateGameHtml(bad, '2d')
    expect(v.ok).toBe(false)
    expect(v.errors.some((e) => /parent/i.test(e))).toBe(true)
  })

  it('injects three importmap for 3d', () => {
    const next = injectThreeIntoHtml(SAMPLE_GAME_HTML_3D, 'export const THREE=1')
    expect(next).toContain('importmap')
    expect(next).toContain(THREE_INJECT_MARKER)
    expect(next).toContain('data:text/javascript')
  })

  it('rewrites three.core relative imports to absolute data URLs', () => {
    const moduleSrc =
      'import{Matrix3 as e}from"./three.core.min.js";export{WebGLRenderer}from"./three.core.min.js";'
    const coreSrc = 'export class Matrix3 {} export class WebGLRenderer {}'
    const rewritten = rewriteThreeCoreRelativeImports(moduleSrc, coreSrc)
    expect(rewritten).not.toContain('./three.core')
    expect(rewritten).toContain('data:text/javascript;charset=utf-8,')
    const next = injectThreeIntoHtml(SAMPLE_GAME_HTML_3D, moduleSrc, coreSrc)
    expect(next).toContain('importmap')
    expect(next).not.toMatch(/\.\/three\.core(?:\.min)?\.js/)
  })

  it('prepare + seed roundtrip', () => {
    const prepared = prepareGameHtml(SAMPLE_GAME_HTML_2D, '2d')
    expect(prepared.mode).toBe('2d')
    expect(prepared.html).toMatch(/game-mode:\s*2d/i)
    const seeded = seedGameHtml('3d')
    expect(seeded.mode).toBe('3d')
    expect(seeded.html).toContain(THREE_INJECT_MARKER)
  })

  it('ignores builtin system prompts when resolving by mode', async () => {
    const {
      DEFAULT_GAME_HTML_SYSTEM_PROMPT_2D_ZH,
      isBuiltinGameHtmlSystemPrompt,
      resolveGameHtmlSystemPrompt
    } = await import('../src/shared/gamePlay')
    expect(isBuiltinGameHtmlSystemPrompt(DEFAULT_GAME_HTML_SYSTEM_PROMPT_2D_ZH)).toBe(true)
    expect(isBuiltinGameHtmlSystemPrompt('自定义系统词')).toBe(false)
    const resolved = resolveGameHtmlSystemPrompt(
      '3d',
      DEFAULT_GAME_HTML_SYSTEM_PROMPT_2D_ZH,
      'zh-CN'
    )
    expect(resolved).toMatch(/Three\.js/)
    expect(resolved).not.toMatch(/只用原生 Canvas 2D/)
  })
})
