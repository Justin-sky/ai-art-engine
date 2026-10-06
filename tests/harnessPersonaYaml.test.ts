import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 守 `buildPersona` 里**逐条新增的提示行**不会破坏 YAML。
 *
 * 这些文案最终会被写成 `personaPrefix: >-` 的折叠块标量（见
 * `deepseekHarnessService.ts` 的 `writeDshConfig`）。块标量里有一个很隐蔽的坑：
 * **以 `: ` 开头的行会被 YAML 当成映射键**，整份 cordis patch 就解析失败了 ——
 * 用户看到的现象是"聊天用不了"，几乎不可能联想到"是因为提示文案里冒号在行首"。
 *
 * 我加"音效工具分流规则"时正好写了含冒号的句子
 * （`speech (lines / narration) → generate_speech; ...`），所以补上这条守卫。
 *
 * 注意断言的是**行首**：句中冒号完全安全（现有文案里就有）。
 *
 * 为什么只用正则扫单行、不做完整字面量解析：完整解析需要跨引号、三元运算符与
 * 模板串，我第一版扫描器就把代码里的 `: []` 误判成了字符串内容，
 * 出了假失败。宁可少测一点也不能留一个会误报的守卫。
 */
const SRC = readFileSync(resolve('src/main/services/deepseekHarnessService.ts'), 'utf8')

/** buildPersona 的函数体 */
function personaBody(): string {
  const start = SRC.indexOf('function buildPersona(')
  expect(start, '找不到 buildPersona').toBeGreaterThanOrEqual(0)
  const nextFn = SRC.indexOf('\nfunction ', start + 10)
  return SRC.slice(start, nextFn > 0 ? nextFn : SRC.length)
}

/** 逐行取出以单引号开头、单引号结尾的提示行（这些是新增提示的书写形式） */
function singleLinePromptLiterals(): string[] {
  const out: string[] = []
  for (const raw of personaBody().split('\n')) {
    const line = raw.trim()
    if (!line.startsWith("'") || (!line.endsWith("',") && !line.endsWith("'"))) continue
    const inner = line.slice(1, line.lastIndexOf("'"))
    if (!inner) continue
    out.push(inner)
  }
  return out
}

describe('buildPersona 的单行提示不会破坏 YAML 折叠块', () => {
  const lines = singleLinePromptLiterals()

  it('确实扫到了提示行（否则守卫是空的）', () => {
    expect(lines.length).toBeGreaterThan(15)
  })

  it('没有以「: 」开头的行（会被 YAML 当成映射键）', () => {
    const offenders = lines.filter((l) => /^\s*:(\s|$)/.test(l))
    expect(offenders, `这些行会让 cordis patch 解析失败：\n${offenders.join('\n')}`).toEqual([])
  })

  it('没有以「- 」开头的行（会被当成 YAML 序列项）', () => {
    const offenders = lines.filter((l) => /^\s*-\s/.test(l))
    expect(offenders).toEqual([])
  })

  it('没有制表符（折叠块里非法）', () => {
    expect(lines.filter((l) => l.includes('\t'))).toEqual([])
  })

  it('没有空行（会变成空段落，语义与预期不符）', () => {
    expect(lines.filter((l) => l.trim() === '')).toEqual([])
  })
})

describe('音效分流规则确实在系统提示里', () => {
  const joined = SRC.slice(SRC.indexOf('function buildPersona(')).slice(0, 6000)

  it('生成工具枚举里含 generate_sound_effect', () => {
    expect(joined).toMatch(
      /generate_image \/ generate_video \/ generate_speech \/ generate_sound_effect \/ generate_music/
    )
  })

  it('含"按音频是什么分流"的规则行', () => {
    expect(joined).toMatch(/Pick the audio tool by what the audio IS/)
  })

  it('明确禁止用 TTS 顶替音效请求', () => {
    expect(joined).toMatch(/Never satisfy a sound-effect or ambience request with generate_speech/)
    expect(joined).toMatch(/which is the wrong result and still costs a call/)
  })

  it('提醒无缝循环要传 loop', () => {
    expect(joined).toMatch(/pass loop: true to generate_sound_effect/)
  })
})
