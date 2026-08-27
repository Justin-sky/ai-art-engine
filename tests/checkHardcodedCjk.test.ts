import { describe, expect, it } from 'vitest'
import {
  bilingualDefLineIndexes,
  isAllowlisted,
  scanText,
  stripCommentsPerLine
} from '../scripts/check-hardcoded-cjk.mjs'

describe('check-hardcoded-cjk: comment stripping', () => {
  it('strips line comments but keeps string contents', () => {
    const src = "const a = '图片' // 注释中文\nconst b = 1"
    expect(stripCommentsPerLine(src)[0]).toBe("const a = '图片'")
  })

  it('keeps URLs inside strings intact', () => {
    const src = 'const url = "https://example.com/x"'
    const lines = stripCommentsPerLine(src)
    expect(lines[0]).toContain('https://example.com')
  })

  it('handles template literals with nested ${} expressions', () => {
    const src = 'const t = `模板${flag ? "内" : `${n}层`}`; // 尾注'
    const lines = stripCommentsPerLine(src)
    expect(lines[0]).toContain('`模板')
    expect(scanText(src)).toHaveLength(1)
    expect(scanText(src)[0].line).toBe(1)
  })

  it('strips block comments across lines keeping line alignment', () => {
    const src = ['const ok = 1 /* 中文注释', '继续注释 */ + 2; const s = "残留"']
    const hits = scanText(src.join('\n'))
    // 第二行剩余代码从注释收尾处继续，行号对齐不受影响
    expect(hits).toHaveLength(1)
    expect(hits[0].text).toBe('+ 2; const s = "残留"')
    expect(hits[0].line).toBe(2)
  })

  it('strips vue html comments', () => {
    const src = '<!-- 模板提示 -->\n<div title="拖动">文本</div>'
    const hits = scanText(src)
    expect(hits).toHaveLength(1)
    expect(hits[0].text).toBe('<div title="拖动">文本</div>')
  })

  it('honors inline cjk-ok suppression on the raw line', () => {
    const src = "const keep = '专有名词' // cjk-ok"
    expect(scanText(src)).toHaveLength(0)
  })

  it('reports nothing for pure ascii code', () => {
    expect(scanText("import x from './y'\nexport default { foo: 'bar' }\n")).toHaveLength(0)
  })
})

describe('check-hardcoded-cjk: bilingual data suppression', () => {
  it('suppresses multi-line defErr initializer bodies', () => {
    const src = [
      "const E_X = defErr<{ guid: string }>(",
      "  'x.y',",
      "  ({ guid }) => `包条目不完整: ${guid}`,",
      "  ({ guid }) => `Incomplete entry: ${guid}`",
      ")"
    ].join('\n')
    expect(scanText(src)).toHaveLength(0)
  })

  it('still flags CJK outside the defErr span', () => {
    const src = [
      "const E_X = defErrSimple('x.y', '中文', 'English')",
      "throw new Error('残留的硬编码')"
    ].join('\n')
    const hits = scanText(src)
    expect(hits).toHaveLength(1)
    expect(hits[0].line).toBe(2)
  })

  it('suppresses inline zh/en pair literals and pickXxxBi selectors', () => {
    const src = [
      "const kind = { image: { zh: '图片生成', en: 'image generation' } }",
      "return pickKlingBi('视频生成失败', 'Video generation failed')"
    ].join('\n')
    expect(scanText(src)).toHaveLength(0)
  })

  it('def-span marking terminates safely on unbalanced windows', () => {
    const stripped = ["defErr('x.y', '中文'", "other('继续']"]
    const marked = bilingualDefLineIndexes(stripped)
    expect(marked.has(0)).toBe(true)
  })

  it('suppresses defErr with multi-line generic parameter list', () => {
    const src = [
      'const E = defErr<{',
      '  name: string',
      '}>(',
      "  'x.y',",
      "  ({ name }) => `找不到 ${name}`,",
      "  ({ name }) => `Not found: ${name}`",
      ')',
      "throw new Error('残留')"
    ].join('\n')
    const hits = scanText(src)
    expect(hits).toHaveLength(1)
    expect(hits[0].line).toBe(8)
  })
})

describe('check-hardcoded-cjk: regex literal state', () => {
  it('quote inside regex does not poison string state (later comments still stripped)', () => {
    const src = [
      "const a = p.replace(/'/g, \"\\\\'\")",
      '// 这行注释应被剥离',
      "const b = '保留'"
    ].join('\n')
    const lines = stripCommentsPerLine(src)
    expect(lines[1]).toBe('')
    const hits = scanText(src)
    expect(hits).toHaveLength(1)
    expect(hits[0].line).toBe(3)
  })

  it('char-class quotes stay inert and class contents remain visible', () => {
    const src = ['if (/["\']/.test(v)) { /* 注释 */', "throw new Error('残留')"].join('\n')
    const hits = scanText(src)
    expect(hits).toHaveLength(1)
    expect(hits[0].line).toBe(2)
  })

  it('division after identifier is not treated as regex', () => {
    const src = ["const r = total / count / ratio", "const s = '保留'"]
    const hits = scanText(src.join('\n'))
    expect(hits).toHaveLength(1)
    expect(hits[0].text).toContain("const s = '保留'")
  })
})

describe('check-hardcoded-cjk: allowlist matching', () => {
  it('matches exact stripped line only', () => {
    expect(isAllowlisted(['const a = "图"'], 'const a = "图"')).toBe(true)
    expect(isAllowlisted(['const a = "图"'], 'const a = "图片更长的行"')).toBe(false)
    expect(isAllowlisted(['const a = "图"'], 'other')).toBe(false)
  })
})
