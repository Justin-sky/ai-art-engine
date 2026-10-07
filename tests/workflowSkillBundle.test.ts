import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ref } from 'vue'
import {
  buildMarketplaceCards,
  skillBundleMeta,
  skillSourceKey
} from '../src/renderer/src/features/marketplace/buildMarketplaceCards'
import {
  isSafeSkillFilePath,
  parseWorkflowMarketEntry,
  parseWorkflowSkillManifest,
  plainSkillManifest,
  validateSkillEntryText,
  workflowMarketUrls
} from '../src/shared/workflowMarket'

/**
 * 工作流附带的 dsh 技能包：契约、路径安全、安装前校验。
 *
 * ## 为什么这几条特别要紧
 *
 * 1. **索引是远端内容**。技能清单里的路径会被拼进本地目录再写盘，所以必须当成
 *    敌意输入校验 —— 一个 `../..` 就能把文件写到工程外。
 * 2. **dsh 对不合法的技能是静默忽略**（只写一行日志）。不在安装时校验 `SKILL.md`，
 *    用户会看到「安装成功」而 agent 那里什么都没有 —— 这类静默能力缺失最难排查。
 * 3. **装一半比不装更糟**。卡片写着「含技能」而技能没落地，等于界面在骗人。
 */

const validSkill = {
  name: 'wf-world-model',
  description: '世界模型工作流的操作手册',
  entry: 'SKILL.md',
  hasScripts: false,
  files: [
    { path: 'SKILL.md', sizeBytes: 100 },
    { path: 'references/ports.md', sizeBytes: 200 }
  ],
  sizeBytes: 300
}

const SKILL_MD = `---
name: wf-world-model
description: 世界模型工作流的操作手册
workflow: world-model
---

# 世界模型

正文。
`

describe('parseWorkflowSkillManifest', () => {
  it('解析合法技能包', () => {
    const skill = parseWorkflowSkillManifest(validSkill)
    expect(skill).not.toBeNull()
    expect(skill!.name).toBe('wf-world-model')
    expect(skill!.entry).toBe('SKILL.md')
    expect(skill!.hasScripts).toBe(false)
    expect(skill!.files.map((f) => f.path)).toEqual(['SKILL.md', 'references/ports.md'])
    expect(skill!.sizeBytes).toBe(300)
  })

  it('缺 sizeBytes 时按文件体积求和', () => {
    const { sizeBytes: _drop, ...rest } = validSkill
    expect(parseWorkflowSkillManifest(rest)!.sizeBytes).toBe(300)
  })

  it('entry 不是 SKILL.md 时拒绝（dsh 只认 SKILL.md）', () => {
    expect(parseWorkflowSkillManifest({ ...validSkill, entry: 'README.md' })).toBeNull()
  })

  it('清单里没有入口文件时拒绝 —— 装不出可用技能就别装', () => {
    expect(
      parseWorkflowSkillManifest({ ...validSkill, files: [{ path: 'references/a.md' }] })
    ).toBeNull()
  })

  it('name 不是 kebab-case 时拒绝', () => {
    expect(parseWorkflowSkillManifest({ ...validSkill, name: 'WF_World' })).toBeNull()
  })

  it('缺 description 时拒绝', () => {
    expect(parseWorkflowSkillManifest({ ...validSkill, description: '' })).toBeNull()
  })

  it('files 不是数组时拒绝', () => {
    expect(parseWorkflowSkillManifest({ ...validSkill, files: 'SKILL.md' })).toBeNull()
  })

  it('重复路径时拒绝（后一份会静默覆盖前一份）', () => {
    expect(
      parseWorkflowSkillManifest({
        ...validSkill,
        files: [{ path: 'SKILL.md' }, { path: 'SKILL.md' }]
      })
    ).toBeNull()
  })

  it('hasScripts 只认布尔真值（字符串 "true" 不算）', () => {
    expect(parseWorkflowSkillManifest({ ...validSkill, hasScripts: true })!.hasScripts).toBe(true)
    expect(parseWorkflowSkillManifest({ ...validSkill, hasScripts: 'true' })!.hasScripts).toBe(
      false
    )
  })

  const badPaths = [
    '../evil.md',
    'references/../../evil.md',
    '/etc/passwd',
    'C:/windows/system32/x.md',
    'references\\ports.md',
    'other/thing.md',
    'SKILL.md/../../x',
    './SKILL.md'
  ]
  for (const path of badPaths) {
    it(`拒绝危险路径 ${JSON.stringify(path)}`, () => {
      expect(parseWorkflowSkillManifest({ ...validSkill, files: [{ path }] })).toBeNull()
    })
  }

  it('目录穿越被 isSafeSkillFilePath 直接挡住', () => {
    expect(isSafeSkillFilePath('SKILL.md')).toBe(true)
    expect(isSafeSkillFilePath('references/a.md')).toBe(true)
    expect(isSafeSkillFilePath('scripts/run.mjs')).toBe(true)
    expect(isSafeSkillFilePath('assets/logo.png')).toBe(true)
    expect(isSafeSkillFilePath('../a.md')).toBe(false)
    expect(isSafeSkillFilePath('a/b/c.md')).toBe(false)
  })
})

describe('skillFile URL 构造', () => {
  const urls = workflowMarketUrls('https://example.com/root')

  it('合法路径拼出完整地址', () => {
    expect(urls.skillFile('world-model', 'references/ports.md')).toBe(
      'https://example.com/root/workflows/world-model/skill/references/ports.md'
    )
  })

  it('非法路径返回 null（不发出请求）', () => {
    expect(urls.skillFile('world-model', '../../secrets.json')).toBeNull()
    expect(urls.skillFile('world-model', '/etc/passwd')).toBeNull()
    expect(urls.skillFile('world-model', 'nested/deep/file.md')).toBeNull()
  })
})

describe('索引条目的技能段是可选且宽容的', () => {
  const baseEntry = {
    id: 'world-model',
    title: '世界模型',
    summary: '一句话',
    category: 'game',
    version: '1.0.0',
    author: { name: 'a' },
    license: 'MIT',
    requires: { nodeTypes: ['asset.spatialWorld'] },
    nodeCount: 3,
    edgeCount: 2
  }

  it('没有 skill 字段时正常工作（向后兼容）', () => {
    const entry = parseWorkflowMarketEntry(baseEntry)
    expect(entry).not.toBeNull()
    expect(entry!.skill).toBeUndefined()
  })

  it('skill 合法时带上', () => {
    const entry = parseWorkflowMarketEntry({ ...baseEntry, skill: validSkill })
    expect(entry!.skill?.name).toBe('wf-world-model')
  })

  it('skill 非法时**只丢技能段、保留整条工作流**', () => {
    const entry = parseWorkflowMarketEntry({
      ...baseEntry,
      skill: { ...validSkill, files: [{ path: '../evil.md' }] }
    })
    // 一个坏技能不该让整条工作流从市场里消失
    expect(entry).not.toBeNull()
    expect(entry!.id).toBe('world-model')
    expect(entry!.skill).toBeUndefined()
  })
})

describe('validateSkillEntryText（安装前校验 SKILL.md）', () => {
  it('合法文件通过', () => {
    expect(validateSkillEntryText(SKILL_MD, 'wf-world-model')).toEqual({ ok: true })
  })

  it('没有 frontmatter 时拒绝', () => {
    expect(validateSkillEntryText('# 没有 frontmatter\n', 'wf-world-model')).toEqual({
      ok: false,
      reasonKey: 'skillNoFrontmatter'
    })
  })

  it('名称与清单不一致时拒绝（防止装进别人的技能目录）', () => {
    expect(validateSkillEntryText(SKILL_MD, 'wf-other')).toEqual({
      ok: false,
      reasonKey: 'skillNameMismatch'
    })
  })

  it('名称不是 kebab-case 时拒绝', () => {
    const text = SKILL_MD.replace('wf-world-model', 'WF_World')
    expect(validateSkillEntryText(text, 'WF_World')).toEqual({
      ok: false,
      reasonKey: 'skillBadName'
    })
  })

  it('缺 description 时拒绝', () => {
    const text = '---\nname: wf-world-model\n---\n\n正文\n'
    expect(validateSkillEntryText(text, 'wf-world-model')).toEqual({
      ok: false,
      reasonKey: 'skillNoDescription'
    })
  })

  it('用了 dsh 会抛错的 camelCase 旧键时拒绝', () => {
    const text = `---\nname: wf-world-model\ndescription: d\ndisableModelInvocation: true\n---\n`
    expect(validateSkillEntryText(text, 'wf-world-model')).toEqual({
      ok: false,
      reasonKey: 'skillLegacyInvocationKey'
    })
  })

  it('引号包裹的值同样接受（与仓库 validator 口径一致）', () => {
    const text = `---\nname: "wf-world-model"\ndescription: '说明'\n---\n`
    expect(validateSkillEntryText(text, 'wf-world-model')).toEqual({ ok: true })
  })
})

// ─────────────────────────────────────────────────────────────
// 源码级守卫：主进程的安装/卸载流程
// ─────────────────────────────────────────────────────────────
const read = (path: string): string => readFileSync(resolve(path), 'utf8')

/** 剥注释：解释这些约束的注释里会写出被禁的写法，直接断言会假失败 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}

const SERVICE = read('src/main/services/workflowMarketService.ts')
const SERVICE_CODE = stripComments(SERVICE)
const HARNESS = read('src/main/services/deepseekHarnessService.ts')
const VIEW = read('src/renderer/src/views/MarketplaceView.vue')

describe('安装流程的主进程守卫', () => {
  it('技能落在 dsh 技能根，而不是工作流目录里', () => {
    expect(SERVICE_CODE).toContain('join(dshSkillsDir(), manifest.name)')
  })

  it('**缺省不安装 scripts/**：没有用户明示同意时按老行为只装说明书', () => {
    // 这是安全底线，不是遗漏 —— 一旦有人「顺手」把同意判断去掉，这条会红
    expect(SERVICE_CODE).toContain('if (isScript && !options.allowScripts) continue')
  })

  it('安装前校验 SKILL.md（否则 dsh 静默忽略，用户只看到"装上了"）', () => {
    expect(SERVICE_CODE).toContain('validateSkillEntryText(')
  })

  it('技能失败时回滚工作流本体 —— 不留「卡片说含技能、实际没有」的半成品', () => {
    expect(SERVICE_CODE).toMatch(
      /if \(skillResult && !skillResult\.ok\) \{\s*getPipeline\(\)\.uninstall\(targetDir\)/
    )
  })

  it('技能失败的具体原因原样带回（而不是笼统的"技能安装失败"）', () => {
    expect(SERVICE_CODE).toContain('reasonKey: skillResult.reasonKey')
  })

  it('记账里存 skillName，供卸载时精确删除', () => {
    expect(SERVICE_CODE).toContain('skillName')
  })

  it('卸载只删记账里的那个技能名，且必须是目录才删', () => {
    const body = SERVICE_CODE.slice(SERVICE_CODE.indexOf('function removeInstalledSkill'))
    expect(body).toContain('if (!name) return')
    expect(body).toContain('statSync(dir).isDirectory()')
    // 绝不按前缀批量删（用户可能自建同名技能）
    expect(body).not.toMatch(/startsWith\(.wf-\)/)
  })
})

describe('回传给主进程的技能清单必须是纯数据（不能是 Vue 响应式代理）', () => {
  it('响应式代理过不了结构化克隆 —— 这就是「An object could not be cloned」的来源', () => {
    const entries = ref([{ id: 'x', skill: validSkill }])
    const proxied = entries.value[0]!.skill
    // 代理本身确实克隆不了：这条成立，下面的修复才有意义
    expect(() => structuredClone(proxied)).toThrow()
  })

  it('plainSkillManifest 产出可克隆的纯数据，且字段不丢', () => {
    const entries = ref([{ id: 'x', skill: validSkill }])
    const plain = plainSkillManifest(entries.value[0]!.skill)
    expect(() => structuredClone(plain)).not.toThrow()
    // 逐字段白名单不能悄悄丢键
    expect(plain).toEqual(validSkill)
  })

  it('顺带丢掉远端多带的字段（索引是远端内容，不该顺手带过界）', () => {
    const entries = ref([
      {
        id: 'x',
        skill: { ...validSkill, evil: 'x', files: [{ path: 'SKILL.md', extra: 1 }] }
      }
    ])
    const plain = plainSkillManifest(entries.value[0]!.skill)
    expect(plain).not.toHaveProperty('evil')
    expect(plain.files[0]).not.toHaveProperty('extra')
  })

  it('市场视图回传技能时走的是 plainSkillManifest（不是裸 card.skill）', () => {
    expect(VIEW).toContain('skill: plainSkillManifest(card.skill)')
    expect(VIEW).not.toContain('skill: card.skill')
  })
})

describe('技能可见性守卫', () => {
  it('市场服务不反向依赖 harness 服务（会拖垮整个测试图）', () => {
    /*
      `deepseekHarnessService` 引了 `virtual:` 开头的构建期模块，只有 Vite 打包时存在。
      市场服务一旦 import 它，模块加载就会在整个测试里失败 —— 实测连带 23 条测试崩掉，
      报的还是 "Cannot find package 'virtual:aiart-headless-runner-template'" 这种
      与调用点无关的错。路径共享走 `./dshPaths` 这个纯小文件。
    */
    expect(SERVICE_CODE).not.toContain("from './deepseekHarnessService'")
    expect(SERVICE_CODE).toContain("from './dshPaths'")
  })

  it('技能清单认目录型技能包（否则 agent 看得见、界面看不见）', () => {
    expect(HARNESS).toMatch(/if \(entry\.isDirectory\(\)\) \{[\s\S]{0,200}readSkillBundleInfo/)
  })

  it('会话技能清单同样认技能包', () => {
    const body = HARNESS.slice(HARNESS.indexOf('function getSessionSkills'))
    expect(body).toMatch(/entry\.isDirectory\(\)/)
    expect(body).toContain("join(skillsDir, entry.name, 'SKILL.md')")
  })

  it('技能包不参与反向导入，也不进 skipped（skipped 在界面上是失败通道）', () => {
    const body = HARNESS.slice(HARNESS.indexOf('function importCustomSkillsToGraph'))
    expect(body).toMatch(/if \(entry\.isDirectory\(\)\) continue/)
    const bundleSkip = body.slice(0, body.indexOf('if (!entry.isFile()'))
    expect(bundleSkip).not.toContain('skipped.push')
  })

  it('**回归**：技能快照的清理永远不删目录', () => {
    const body = HARNESS.slice(
      HARNESS.indexOf('function writeDshSkills'),
      HARNESS.indexOf('function readDshSkillsManifest')
    )
    // 只 rmSync 自己 manifest 里记着的文件，且没有 recursive 选项
    expect(body).toContain('rmSync(target, { force: true })')
    expect(body).not.toMatch(/rmSync\([^)]*recursive/)
  })
})

// ─────────────────────────────────────────────────────────────
// 卡片层：用户必须在**装之前**就看得见技能
// ─────────────────────────────────────────────────────────────
describe('市场卡片带上技能信息', () => {
  const entry = {
    id: 'world-model',
    title: '世界模型',
    summary: '一句话',
    category: 'game',
    tags: [],
    version: '1.0.0',
    author: { name: 'kal-' },
    license: 'MIT',
    requires: { nodeTypes: [] },
    nodeCount: 3,
    edgeCount: 2,
    missingNodeTypes: [],
    blockReason: null,
    installed: false,
    installedVersion: null,
    updatable: false,
    skill: validSkill
  }

  it('工作流卡带上 skill，安装时才传得回主进程', () => {
    const cards = buildMarketplaceCards({ mcp: null, skills: null, workflows: [entry] })
    const card = cards.find((item) => item.marketId === 'world-model')
    expect(card?.skill?.name).toBe('wf-world-model')
  })

  it('没有技能的条目不带 skill 字段', () => {
    const { skill: _drop, ...withoutSkill } = entry
    const cards = buildMarketplaceCards({ mcp: null, skills: null, workflows: [withoutSkill] })
    expect(cards[0]!.skill).toBeUndefined()
  })

  it('技能包的来源标签是「技能包」，不是「自定义」', () => {
    // 显示成「自定义」会让人以为是用户自己放进 .md 的东西，来源完全不同
    expect(skillSourceKey('bundle')).toBe('marketplace.source.skill.bundle')
  })

  it('技能卡带上文件数与脚本标记', () => {
    const cards = buildMarketplaceCards({
      mcp: null,
      workflows: [],
      skills: {
        dirPath: '/x/skills',
        builtinCount: 0,
        files: [
          {
            fileName: 'wf-world-model',
            kind: 'bundle',
            title: 'wf-world-model',
            hasScripts: true,
            extraFileCount: 3
          }
        ]
      }
    })
    const card = cards.find((item) => item.identifier === 'wf-world-model')
    expect(card?.meta).toContain('+3 files')
    // 磁盘上确实有 scripts/ 时必须出现：脚本是会被 agent 执行的代码，不能悄悄躺着
    expect(card?.meta).toContain('scripts')
  })

  it('无脚本技能包只显示文件数', () => {
    expect(skillBundleMeta({ extraFileCount: 2 })).toBe('+2 files')
    expect(skillBundleMeta({})).toBe('')
  })
})
