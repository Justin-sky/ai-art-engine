import { describe, expect, it } from 'vitest'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  builtinSkillDisplayMap,
  dshSkillNameOf,
  firstSkillParagraph,
  humanizeSkillStem,
  parseSkillFrontmatter,
  skillDisplayInfo,
  skillFileStem
} from '../src/shared/skillDisplay'
import { listGraphSkills } from '../src/shared/graph/graphSkills'

/**
 * 技能展示元数据的推导（纯函数）。
 *
 * 起因是一个真实缺陷：界面只拿到 `fileName` + `kind`，于是卡片标题只能是
 * `system-image` 这种 id 风格的主干、展开详情对所有技能都是同一句通用提示
 *（用户原话「内置技能的详情都一样」）。而技能文件其实**各不相同** ——
 * 每个都有 frontmatter description 与正文。
 *
 * 这里覆盖「文件名 → 可展示标题与描述」的全部取值路径。
 */

const BUILTIN = builtinSkillDisplayMap([
  { id: 'system.image', titleZh: '图片生成', titleEn: 'Image' },
  { id: 'episode.image.grid9', titleZh: '9宫格拼图·锚点画布', titleEn: '9-grid collage canvas' },
  { id: 'blender.rigSkin', titleZh: '骨骼装配', titleEn: 'Rig & skin' }
])

describe('dshSkillNameOf：与主进程同一口径', () => {
  it('GraphSkill id → kebab-case 文件名主干', () => {
    expect(dshSkillNameOf('system.image')).toBe('system-image')
    expect(dshSkillNameOf('episode.image.grid9')).toBe('episode-image-grid9')
    expect(dshSkillNameOf('blender.rigSkin')).toBe('blender-rigskin')
    expect(dshSkillNameOf('anim2d.frames')).toBe('anim2d-frames')
  })

  it('首尾多余分隔符被剥掉，重复分隔符合并', () => {
    expect(dshSkillNameOf('..weird__id..')).toBe('weird-id')
    expect(dshSkillNameOf('  A.B  ')).toBe('a-b')
  })

  it('产出的名字符合 dsh 的 skill 名规则', () => {
    for (const skill of listGraphSkills()) {
      const name = dshSkillNameOf(skill.id)
      expect(name, `技能 ${skill.id} 的名字不合法`).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    }
  })
})

describe('skillFileStem / humanizeSkillStem', () => {
  it('去掉最后一个扩展名', () => {
    expect(skillFileStem('system-image.md')).toBe('system-image')
    expect(skillFileStem('my-skill.example')).toBe('my-skill')
    expect(skillFileStem('noext')).toBe('noext')
  })

  it('整名就是扩展名时保留原名（剥成空串会让卡片没有名字）', () => {
    expect(skillFileStem('.md')).toBe('.md')
  })

  it('把 kebab-case 还原成可读短语（回落标题不该还是连字符）', () => {
    expect(humanizeSkillStem('my-cool-skill')).toBe('my cool skill')
    expect(humanizeSkillStem('snake_case')).toBe('snake case')
    // 全是分隔符时不能产出空标题
    expect(humanizeSkillStem('---')).toBe('---')
  })
})

describe('builtinSkillDisplayMap：内置项反查', () => {
  it('按 dsh 技能名建索引，标题取中文名', () => {
    expect(BUILTIN.get('system-image')?.title).toBe('图片生成')
    expect(BUILTIN.get('episode-image-grid9')?.title).toBe('9宫格拼图·锚点画布')
  })

  it('描述口径与技能文件 frontmatter 一致：`English — 中文`', () => {
    expect(BUILTIN.get('system-image')?.description).toBe('Image — 图片生成')
  })

  it('缺英文名时只用中文，不产出 `undefined — x` 这类脏文案', () => {
    const map = builtinSkillDisplayMap([{ id: 'a.b', titleZh: '甲', titleEn: '' }])
    expect(map.get('a-b')?.description).toBe('甲')
  })

  it('标题全空时回落到技能名（不出现空标题）', () => {
    const map = builtinSkillDisplayMap([{ id: 'a.b', titleZh: '', titleEn: '' }])
    expect(map.get('a-b')?.title).toBe('a b')
  })

  it('同名重复注册时首个生效（避免注册顺序变化让界面文字跳动）', () => {
    const map = builtinSkillDisplayMap([
      { id: 'dup.id', titleZh: '先', titleEn: 'First' },
      { id: 'dup.id', titleZh: '后', titleEn: 'Second' }
    ])
    expect(map.get('dup-id')?.title).toBe('先')
  })

  it('真实内置技能全部能反查到名字，且没有空标题', () => {
    const map = builtinSkillDisplayMap(listGraphSkills())
    expect(map.size).toBeGreaterThan(20)
    for (const [name, info] of map) {
      expect(info.title.trim(), `${name} 标题为空`).not.toBe('')
    }
  })

  /**
   * 拿**应用真实生成的技能快照目录**核对一遍反查链路。
   *
   * 其余用例都用自造数据，只有这条能证明「用户机器上那 42 个文件名确实能对上标题」——
   * 也就是反查规则（kebab-case 口径）与主进程写文件时用的是同一套。
   * 目录不存在（没跑过应用 / 非本机）时跳过，不让测试依赖运行环境。
   */
  it('真实技能目录里的内置文件都能反查到标题', () => {
    const dir = join(process.env['APPDATA'] ?? '', 'aiartengine', 'dsh-harness', 'skills')
    if (!dir || !existsSync(dir)) return
    const map = builtinSkillDisplayMap(listGraphSkills())
    const names = readdirSync(dir).filter((name) => !name.startsWith('.'))
    expect(names.length).toBeGreaterThan(0)
    const unresolved = names.filter(
      (name) => !map.has(skillFileStem(name)) && !name.startsWith('my-skill')
    )
    expect(unresolved, `这些文件没能反查到标题：${unresolved.join(', ')}`).toEqual([])
  })
})

describe('parseSkillFrontmatter：只认需要的那两个字段', () => {
  it('双引号写法（应用自己生成的就是这种）', () => {
    const parsed = parseSkillFrontmatter(
      '---\nname: system-image\ndescription: "Image — 图片生成"\n---\n\n# Image\n'
    )
    expect(parsed.name).toBe('system-image')
    expect(parsed.description).toBe('Image — 图片生成')
  })

  it('裸值与单引号写法都能读（用户手写常见）', () => {
    expect(parseSkillFrontmatter('---\ndescription: 手写技能\n---\n')).toEqual({
      description: '手写技能'
    })
    expect(parseSkillFrontmatter("---\ndescription: '单引号'\n---\n")).toEqual({
      description: '单引号'
    })
  })

  it('不成对的引号原样保留（手写不完整时不吞内容）', () => {
    expect(parseSkillFrontmatter('---\ndescription: "没闭合\n---\n')?.description).toBe('"没闭合')
  })

  it('没有 frontmatter / 不是从文件开头起 → 空结果', () => {
    expect(parseSkillFrontmatter('# 只有正文\n')).toEqual({})
    expect(parseSkillFrontmatter('前言\n---\ndescription: x\n---\n')).toEqual({})
  })

  it('忽略无关字段与空值', () => {
    const parsed = parseSkillFrontmatter('---\nname: x\nversion: 3\ntags: a,b\ndescription:\n---\n')
    expect(parsed.name).toBe('x')
    expect(parsed.description).toBeUndefined()
  })

  it('CRLF 换行也能解析（用户在 Windows 上编辑过）', () => {
    expect(
      parseSkillFrontmatter('---\r\nname: x\r\ndescription: "y"\r\n---\r\n')?.description
    ).toBe('y')
  })
})

describe('firstSkillParagraph：正文首段兜底', () => {
  it('跳过 frontmatter、标题与小节标题', () => {
    const text = firstSkillParagraph(
      '---\nname: x\n---\n\n# 标题\n\n### 系统提示（中文）\n\n你是一名专业图像创作者。\n'
    )
    expect(text).toBe('你是一名专业图像创作者。')
  })

  it('多行连成一段', () => {
    const text = firstSkillParagraph('# T\n\n第一行\n第二行\n\n后面不要\n')
    expect(text).toBe('第一行 第二行')
  })

  it('跳过代码块内容', () => {
    const text = firstSkillParagraph('# T\n\n```\ncode\n```\n\n真正的说明\n')
    expect(text).toBe('真正的说明')
  })

  it('正文为空 / 只有标题 → undefined（不产出空描述）', () => {
    expect(firstSkillParagraph('---\nname: x\n---\n')).toBeUndefined()
    expect(firstSkillParagraph('# 只有标题\n')).toBeUndefined()
  })
})

describe('skillDisplayInfo：取值优先级', () => {
  const base = {
    builtin: BUILTIN,
    kind: 'builtin' as const
  }

  it('内置项用 GraphSkill 的标题（比解析生成的 md 更准）', () => {
    const info = skillDisplayInfo({ ...base, fileName: 'system-image.md' })
    expect(info.title).toBe('图片生成')
    expect(info.description).toBe('Image — 图片生成')
  })

  it('内置项即使给了文件内容也以 GraphSkill 为准', () => {
    const info = skillDisplayInfo({
      ...base,
      fileName: 'system-image.md',
      content: '---\ndescription: "别的"\n---\n'
    })
    expect(info.description).toBe('Image — 图片生成')
  })

  it('内置项在映射里查不到时回落文件名主干（快照与注册表不同步也不崩）', () => {
    const info = skillDisplayInfo({ ...base, fileName: 'ghost-skill.md' })
    expect(info.title).toBe('ghost skill')
    expect(info.description).toBeUndefined()
  })

  it('自定义 .md 用 frontmatter 的 description', () => {
    const info = skillDisplayInfo({
      builtin: BUILTIN,
      kind: 'custom',
      fileName: 'my-skill.md',
      content: '---\ndescription: "我的技能"\n---\n\n正文\n'
    })
    expect(info.title).toBe('my skill')
    expect(info.description).toBe('我的技能')
  })

  it('自定义 .md 没写 description 时用正文首段兜底', () => {
    const info = skillDisplayInfo({
      builtin: BUILTIN,
      kind: 'custom',
      fileName: 'my-skill.md',
      content: '# 我的技能\n\n这是它干的事情。\n'
    })
    expect(info.title).toBe('my skill')
    expect(info.description).toBe('这是它干的事情。')
  })

  it('读不到文件内容时只给标题（不为此报错、也不编描述）', () => {
    const info = skillDisplayInfo({ builtin: BUILTIN, kind: 'custom', fileName: 'x.md' })
    expect(info).toEqual({ title: 'x' })
  })

  it('任何输入都产出非空标题', () => {
    for (const input of [
      { fileName: 'system-image.md', kind: 'builtin' as const },
      { fileName: 'a.b.c.md', kind: 'custom' as const },
      { fileName: 'my-skill.example', kind: 'template' as const },
      { fileName: '.md', kind: 'custom' as const }
    ]) {
      const info = skillDisplayInfo({ ...input, builtin: BUILTIN })
      expect(info.title.trim(), `${input.fileName} 标题为空`).not.toBe('')
    }
  })
})
