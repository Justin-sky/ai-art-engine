import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  skillHasScripts,
  skillScriptPaths,
  skillScriptsConsentText
} from '../src/renderer/src/features/marketplace/buildMarketplaceCards'
import { parseWorkflowSkillManifest } from '../src/shared/workflowMarket'

/**
 * 技能包脚本的**明示同意**：脚本是会被 agent 在本机执行起来的代码。
 *
 * ## 这条链路上有三道门，每一道都必须能被单独证明
 *
 * 1. 界面：含脚本时安装前必须弹确认（并且把**具体哪些文件**列出来）；
 * 2. IPC：只有用户点了确认才带 `skillScriptsConsent: true`；
 * 3. 主进程：逐条判断 `scripts/` 是否获准，未获准就不下载、不落盘，且**不算安装失败**。
 *
 * 第 3 道门是真正的边界（界面会被绕过，主进程不会），所以对它的断言落在
 * 「同意判断出现在下载之前」这种结构性质上，而不是「代码里出现过某个字符串」。
 */

const read = (path: string): string => readFileSync(resolve(path), 'utf8')

/** 剥注释：解释这条约束的注释里会写出被禁的写法，直接断言会假失败 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}

const SERVICE = read('src/main/services/workflowMarketService.ts')
const SERVICE_CODE = stripComments(SERVICE)
const VIEW = read('src/renderer/src/views/MarketplaceView.vue')

const withScripts = {
  name: 'wf-world-model',
  description: '世界模型工作流的操作手册',
  entry: 'SKILL.md',
  hasScripts: true,
  files: [
    { path: 'SKILL.md', sizeBytes: 100 },
    { path: 'references/ports.md', sizeBytes: 200 },
    { path: 'scripts/build-world.mjs', sizeBytes: 300 },
    { path: 'scripts/export.mjs', sizeBytes: 400 }
  ],
  sizeBytes: 1000
}

describe('技能包脚本的判定与确认文案', () => {
  it('列出全部脚本文件，且只列脚本（按清单顺序）', () => {
    const skill = parseWorkflowSkillManifest(withScripts)!
    expect(skillScriptPaths(skill)).toEqual(['scripts/build-world.mjs', 'scripts/export.mjs'])
  })

  it('清单说没有脚本但文件里有 scripts/ 时，仍按「有脚本」处理', () => {
    // 索引是远端内容：两个字段不一致时按更严的一侧走，宁可多问一次
    expect(skillHasScripts({ hasScripts: false, files: [{ path: 'scripts/x.mjs' }] })).toBe(true)
    expect(skillHasScripts({ hasScripts: true, files: [{ path: 'SKILL.md' }] })).toBe(true)
    expect(skillHasScripts({ hasScripts: false, files: [{ path: 'SKILL.md' }] })).toBe(false)
    expect(skillHasScripts(undefined)).toBe(false)
  })

  it('确认文案**逐个列出**脚本文件，并带上文件数', () => {
    const skill = parseWorkflowSkillManifest(withScripts)!
    const seen: Array<{ key: string; named: Record<string, unknown> }> = []
    const text = skillScriptsConsentText(skill, (key, named) => {
      seen.push({ key, named })
      return `${key}|${named.count}|${named.files}`
    })
    expect(seen[0]!.key).toBe('marketplace.workflows.scriptsConfirm')
    expect(seen[0]!.named.count).toBe(2)
    // 少列一个文件就等于少告知一次：文案里必须逐条出现
    expect(text).toContain('scripts/build-world.mjs')
    expect(text).toContain('scripts/export.mjs')
  })
})

describe('界面：安装前必须确认，确认结果决定带不带同意', () => {
  it('含脚本时先弹确认，且确认发生在发起安装之前', () => {
    const at = VIEW.indexOf('async function installMarketWorkflow')
    expect(at, '应当能找到 installMarketWorkflow').toBeGreaterThan(0)
    const body = VIEW.slice(at, VIEW.indexOf('\n/**', at))
    expect(body).toContain('const withScripts = skillHasScripts(card.skill)')
    expect(body).toMatch(
      /const scriptsConsented =\s*withScripts && card\.skill\s*\?\s*window\.confirm\(skillScriptsConsentText\(card\.skill/
    )
    expect(body.indexOf('window.confirm(skillScriptsConsentText')).toBeLessThan(
      body.indexOf('installWorkflowMarket(')
    )
  })

  it('只有用户点了「确定」才带 skillScriptsConsent（取消 = 不装脚本，说明书照常装）', () => {
    const at = VIEW.indexOf('async function installMarketWorkflow')
    const body = VIEW.slice(at, VIEW.indexOf('\n/**', at))
    expect(body).toMatch(/\.\.\.\(scriptsConsented \? \{ skillScriptsConsent: true \} : \{\}\)/)
    // 不能无条件带上：那等于把「同意」变成一个恒真的字段
    expect(body).not.toMatch(/^\s*skillScriptsConsent: true,?\s*$/m)
    // 取消之后必须明确告知「这次没装脚本」，否则「脚本怎么没生效」会变成查不出来的线索
    expect(body).toContain("t('marketplace.workflows.installedWithoutScripts'")
  })

  it('卡片与详情都按「有脚本」展示（含脚本必须看得见）', () => {
    expect(VIEW).toContain('skillHasScripts(card.skill)')
    expect(VIEW).toContain("t('marketplace.workflows.skillScriptsNote'")
  })
})

describe('主进程：未获同意就不落盘，且不算安装失败', () => {
  it('逐条判断 scripts/：未获同意就跳过该文件', () => {
    const at = SERVICE_CODE.indexOf('async function installSkillBundle')
    expect(at).toBeGreaterThan(0)
    const body = SERVICE_CODE.slice(at, SERVICE_CODE.indexOf('async function removeInstalledSkill'))
    const skip = body.indexOf('if (isScript && !options.allowScripts) continue')
    const push = body.indexOf('files.push({ path: file.path, url })')
    expect(skip, '同意判断必须存在').toBeGreaterThan(-1)
    // 判断必须在加入下载清单之前 —— 放到后面就等于「先装了再不看」
    expect(skip).toBeLessThan(push)
  })

  it('同意开关来自调用方的字面量 true，不吃真值转换', () => {
    // 字符串 'false' 这类脏输入在真值判断下会变成「同意」，必须用完全相等
    expect(SERVICE_CODE).toContain('allowScripts: input.skillScriptsConsent === true')
  })

  it('未同意时仍继续安装（不是失败）：说明书与 references 照样落盘', () => {
    const at = SERVICE_CODE.indexOf('async function installSkillBundle')
    const body = SERVICE_CODE.slice(at, SERVICE_CODE.indexOf('async function removeInstalledSkill'))
    expect(body).not.toMatch(/if \(!options\.allowScripts\)[\s\S]{0,80}reasonKey/)
    expect(body).toContain('validateSkillEntryText(')
  })

  it('脚本文件仍走路径白名单（同意不等于免检）', () => {
    const at = SERVICE_CODE.indexOf('async function installSkillBundle')
    const body = SERVICE_CODE.slice(at, SERVICE_CODE.indexOf('async function removeInstalledSkill'))
    expect(body).toContain('urls.skillFile(workflowId, file.path)')
    expect(body).toContain("reasonKey: 'skillBadPath'")
  })

  it('只有脚本真的落盘才记账，且记下同意时刻', () => {
    expect(SERVICE_CODE).toContain('scriptsInstalled')
    expect(SERVICE_CODE).toMatch(
      /\.\.\.\(skillScripts\s*\?\s*\{ skillScripts: true, skillScriptsConsentAt:/
    )
    // 记账读回时不能丢字段（记账是整体重写的，漏读等于下次写盘时抹掉）
    expect(SERVICE_CODE).toMatch(/obj\.skillName/)
    expect(SERVICE_CODE).toMatch(/obj\.skillScripts === true/)
  })

  it('技能失败仍回滚工作流本体（原子性不能被这次改动带走）', () => {
    expect(SERVICE_CODE).toMatch(
      /if \(skillResult && !skillResult\.ok\) \{\s*getPipeline\(\)\.uninstall\(targetDir\)/
    )
  })
})

describe('IPC 契约：同意开关是可选的布尔量', () => {
  it('主进程只认字面量 true；契约里也写明缺省 = 不装脚本', () => {
    const IPC = read('src/shared/ipc.ts')
    expect(IPC).toContain('skillScriptsConsent?: boolean')
    expect(IPC).toMatch(/缺省 \/ false = 按老行为只装说明书与 references/)
    const MAIN_IPC = read('src/main/ipc.ts')
    expect(MAIN_IPC).toContain('skillScriptsConsent?: boolean')
  })
})
