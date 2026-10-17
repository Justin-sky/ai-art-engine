import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  detectChatSkillInstallOrSearchIntent,
  parseGitHubSkillSourceUrl
} from '../src/shared/claudeSkill'
import {
  inspectGitHubSkillSource,
  installGitHubSkills,
  searchOnlineSkills
} from '../src/main/services/githubSkillInstaller'

describe('GitHub 技能 URL 解析与在线搜索/安装（githubSkillInstaller）', () => {
  let tempSkillsDir = ''

  beforeEach(() => {
    tempSkillsDir = mkdtempSync(join(tmpdir(), 'aiart-gh-skill-test-'))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    if (tempSkillsDir && existsSync(tempSkillsDir)) {
      rmSync(tempSkillsDir, { recursive: true, force: true })
    }
  })

  it('支持解析多种 GitHub 技能 URL（仓库根、tree 子目录、blob SKILL.md、raw 链接）', () => {
    expect(parseGitHubSkillSourceUrl('https://github.com/anthropics/skills')).toEqual({
      owner: 'anthropics',
      repo: 'skills',
      subpath: '',
      canonicalUrl: 'https://github.com/anthropics/skills'
    })

    expect(
      parseGitHubSkillSourceUrl('https://github.com/anthropics/skills/tree/main/skills/mcp-builder')
    ).toEqual({
      owner: 'anthropics',
      repo: 'skills',
      ref: 'main',
      subpath: 'skills/mcp-builder',
      canonicalUrl: 'https://github.com/anthropics/skills/tree/main/skills/mcp-builder'
    })

    expect(
      parseGitHubSkillSourceUrl(
        'https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md'
      )
    ).toEqual({
      owner: 'anthropics',
      repo: 'skills',
      ref: 'main',
      subpath: 'skills/frontend-design',
      canonicalUrl: 'https://github.com/anthropics/skills/tree/main/skills/frontend-design'
    })

    expect(
      parseGitHubSkillSourceUrl(
        'https://raw.githubusercontent.com/anthropics/skills/main/skills/pdf/SKILL.md'
      )
    ).toEqual({
      owner: 'anthropics',
      repo: 'skills',
      ref: 'main',
      subpath: 'skills/pdf',
      canonicalUrl: 'https://github.com/anthropics/skills/tree/main/skills/pdf'
    })
  })

  it('detectChatSkillInstallOrSearchIntent 能从自然语言对话中识别 GitHub 技能 URL 与联网搜技能安装意图', () => {
    const urlIntent = detectChatSkillInstallOrSearchIntent(
      '帮我安装这个技能：https://github.com/anthropics/skills/tree/main/skills/frontend-design，然后用它帮我设计一个赛博朋克风格的控制面板'
    )
    expect(urlIntent.githubUrls).toEqual([
      'https://github.com/anthropics/skills/tree/main/skills/frontend-design'
    ])
    expect(urlIntent.mentionsSkillOrInstall).toBe(true)

    const searchIntent = detectChatSkillInstallOrSearchIntent(
      '帮我上网搜索一个前端设计相关的技能并安装，然后做一个仪表盘'
    )
    expect(searchIntent.isOnlineSearchIntent).toBe(true)
    expect(searchIntent.wantsInstall).toBe(true)
    expect(searchIntent.matchedCurated[0]?.name).toBe('frontend-design')
  })

  it('searchOnlineSkills 支持按中英文关键词检索 Claude Code 官方精选技能与 GitHub 仓库', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url.includes('api.github.com/search/repositories')) {
        return new Response(JSON.stringify({ items: [] }), { status: 200 })
      }
      return new Response('not found', { status: 404 })
    })

    const mcpRes = await searchOnlineSkills({ query: 'mcp', skillsRoot: tempSkillsDir })
    expect(mcpRes.ok).toBe(true)
    expect(mcpRes.items.some((i) => i.name === 'mcp-builder')).toBe(true)

    const zhRes = await searchOnlineSkills({ query: '前端 界面设计', skillsRoot: tempSkillsDir })
    expect(zhRes.ok).toBe(true)
    expect(zhRes.items.some((i) => i.name === 'frontend-design')).toBe(true)

    const gifRes = await searchOnlineSkills({ query: 'gif 动图', skillsRoot: tempSkillsDir })
    expect(gifRes.ok).toBe(true)
    expect(gifRes.items.some((i) => i.name === 'slack-gif-creator')).toBe(true)
  })

  it('inspectGitHubSkillSource 与 installGitHubSkills 能从 GitHub URL 发现并落盘技能（含跳过脚本提示与元数据记账）', async () => {
    const sampleSkillMd = [
      '---',
      'name: demo-skill',
      'description: A demo skill from GitHub for testing installation.',
      '---',
      '',
      '# Demo Skill Instructions',
      'Follow these steps when executing demo-skill.'
    ].join('\n')

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url === 'https://api.github.com/repos/example/demo-skill') {
        return new Response(JSON.stringify({ default_branch: 'main' }), { status: 200 })
      }
      if (url.includes('/git/trees/main?recursive=1')) {
        return new Response(
          JSON.stringify({
            tree: [
              { path: 'SKILL.md', type: 'blob', size: sampleSkillMd.length },
              { path: 'references/guide.md', type: 'blob', size: 18 },
              { path: 'scripts/helper.py', type: 'blob', size: 24 }
            ]
          }),
          { status: 200 }
        )
      }
      if (url.endsWith('/SKILL.md')) {
        return new Response(sampleSkillMd, { status: 200 })
      }
      if (url.endsWith('/references/guide.md')) {
        return new Response('# Reference Guide\n', { status: 200 })
      }
      if (url.endsWith('/scripts/helper.py')) {
        return new Response('print("hello")\n', { status: 200 })
      }
      return new Response('not found', { status: 404 })
    })

    const inspected = await inspectGitHubSkillSource({
      url: 'https://github.com/example/demo-skill',
      skillsRoot: tempSkillsDir
    })
    expect(inspected.ok).toBe(true)
    expect(inspected.skills).toHaveLength(1)
    expect(inspected.skills?.[0]?.name).toBe('demo-skill')
    expect(inspected.skills?.[0]?.hasScripts).toBe(true)

    const installed = await installGitHubSkills({
      url: 'https://github.com/example/demo-skill',
      skillScriptsConsent: false,
      skillsRoot: tempSkillsDir
    })
    expect(installed.ok).toBe(true)
    expect(installed.installed).toEqual(['demo-skill'])
    expect(installed.skippedScriptsFor).toEqual(['demo-skill'])

    const skillMdFile = join(tempSkillsDir, 'demo-skill', 'SKILL.md')
    const metaFile = join(tempSkillsDir, 'demo-skill', '.aiart-github-skill.json')
    const scriptFile = join(tempSkillsDir, 'demo-skill', 'scripts', 'helper.py')
    expect(existsSync(skillMdFile)).toBe(true)
    expect(existsSync(metaFile)).toBe(true)
    expect(existsSync(scriptFile)).toBe(false)

    const meta = JSON.parse(readFileSync(metaFile, 'utf8')) as {
      owner: string
      repo: string
      resolvedRef: string
    }
    expect(meta.owner).toBe('example')
    expect(meta.repo).toBe('demo-skill')
    expect(meta.resolvedRef).toBe('main')
  })
})
