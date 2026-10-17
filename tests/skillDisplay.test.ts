import { describe, expect, it } from 'vitest'
import {
  extractDynamicContextCommands,
  interpolateClaudeSkillPrompt,
  isValidClaudeSkillName,
  matchesAllowedTool,
  normalizeClaudeSkillMarkdown,
  parseClaudeSkillMarkdown,
  parseGitHubSkillSourceUrl,
  parseSlashSkillCommand,
  replaceDynamicContextCommands,
  sanitizeClaudeSkillName
} from '../src/shared/claudeSkill'
import { getNodeCapability, listNodeCapabilities } from '../src/shared/graph/nodeCapabilities'
import { isAllowedClaudeSkillBundleRelPath } from '../src/main/services/githubSkillInstaller'

describe('NodeCapability 注册表（原内置技能彻底转为内置节点能力）', () => {
  it('内置节点能力数量充足且全部具备中英文标题与提示词', () => {
    const caps = listNodeCapabilities()
    expect(caps.length).toBeGreaterThan(25)
    for (const cap of caps) {
      expect(cap.id.trim()).not.toBe('')
      expect(cap.titleZh.trim()).not.toBe('')
      expect(cap.titleEn.trim()).not.toBe('')
    }
  })

  it('按节点 typeId 查询关键节点能力', () => {
    expect(getNodeCapability('asset.image')?.titleZh).toBe('图片生成')
    expect(getNodeCapability('episode.image.grid9')?.titleZh).toContain('9宫格')
    expect(getNodeCapability('model.rigSkin')?.titleZh).toBe('3D 骨骼蒙皮')
  })
})

describe('Claude Code 技能名称规整与校验', () => {
  it('sanitizeClaudeSkillName 将任意标识转为合法 kebab-case', () => {
    expect(sanitizeClaudeSkillName('My_Cool.Skill')).toBe('my-cool-skill')
    expect(sanitizeClaudeSkillName('  --weird__name--  ')).toBe('weird-name')
    expect(sanitizeClaudeSkillName('---', 'fallback-skill')).toBe('fallback-skill')
  })

  it('isValidClaudeSkillName 严格遵守小写字母数字与连字符规则', () => {
    expect(isValidClaudeSkillName('explain-code')).toBe(true)
    expect(isValidClaudeSkillName('wf-world-model-2')).toBe(true)
    expect(isValidClaudeSkillName('Invalid_Name')).toBe(false)
    expect(isValidClaudeSkillName('-leading')).toBe(false)
  })
})

describe('parseClaudeSkillMarkdown：完整支持 Claude Code 全部 frontmatter 特性', () => {
  it('解析完整的 Claude Code frontmatter 字段与 Hooks', () => {
    const raw = `---
name: pr-reviewer
description: "Review pull requests and check security"
argument-hint: "[pr-number] [focus]"
disable-model-invocation: true
user-invocable: true
allowed-tools: Read, Grep, Bash(git *), mcp__github__*
model: deepseek-reasoner
context: fork
agent: Explore
when_to_use: "Use when user asks for PR review"
version: "1.2.0"
license: MIT
author: anthropics
hooks:
  PreToolUse:
    - matcher: "Bash"
      hooks:
        - type: command
          command: "echo checking bash"
          timeout: 15
  Stop:
    - hooks:
        - type: command
          command: "echo done"
---

# PR Reviewer

Check PR #$0 focusing on $1.
Diff summary:
!\`git diff --stat\`
`
    const parsed = parseClaudeSkillMarkdown(raw, 'fallback-name')
    expect(parsed.frontmatter.name).toBe('pr-reviewer')
    expect(parsed.frontmatter.description).toBe('Review pull requests and check security')
    expect(parsed.frontmatter.argumentHint).toBe('[pr-number] [focus]')
    expect(parsed.frontmatter.disableModelInvocation).toBe(true)
    expect(parsed.frontmatter.userInvocable).toBe(true)
    expect(parsed.frontmatter.allowedTools).toEqual([
      'Read',
      'Grep',
      'Bash(git *)',
      'mcp__github__*'
    ])
    expect(parsed.frontmatter.model).toBe('deepseek-reasoner')
    expect(parsed.frontmatter.context).toBe('fork')
    expect(parsed.frontmatter.agent).toBe('Explore')
    expect(parsed.frontmatter.whenToUse).toBe('Use when user asks for PR review')
    expect(parsed.frontmatter.version).toBe('1.2.0')
    expect(parsed.frontmatter.license).toBe('MIT')
    expect(parsed.frontmatter.author).toBe('anthropics')
    expect(parsed.frontmatter.hooks?.PreToolUse?.[0]?.matcher).toBe('Bash')
    expect(parsed.frontmatter.hooks?.PreToolUse?.[0]?.hooks[0]?.command).toBe('echo checking bash')
    expect(parsed.frontmatter.hooks?.Stop?.[0]?.hooks[0]?.command).toBe('echo done')
    expect(parsed.dynamicCommands).toEqual(['git diff --stat'])
  })

  it('省略 name 与 description 时自动用目录名与正文首段补齐（Claude Code 官方约定）', () => {
    const raw = `# 漫画分镜助手

根据剧本自动拆解分镜与景别提示词。

## 步骤
1. 阅读大纲
`
    const parsed = parseClaudeSkillMarkdown(raw, 'comic-storyboard')
    expect(parsed.frontmatter.name).toBe('comic-storyboard')
    expect(parsed.frontmatter.description).toBe('根据剧本自动拆解分镜与景别提示词。')
    expect(parsed.frontmatter.userInvocable).toBe(true)
    expect(parsed.frontmatter.disableModelInvocation).toBe(false)
    expect(parsed.frontmatter.context).toBe('inline')
  })

  it('normalizeClaudeSkillMarkdown 生成与 dsh-skill-filesystem 100% 兼容的 SKILL.md', () => {
    const raw = `---
disableModelInvocation: true
---
自动总结代码变更。
`
    const normalized = normalizeClaudeSkillMarkdown(raw, 'summarize-diff')
    expect(normalized).toContain('name: summarize-diff')
    expect(normalized).toContain('description: "自动总结代码变更。"')
    expect(normalized).toContain('disable-model-invocation: true')
  })
})

describe('Claude Code 变量替换与动态上下文注入', () => {
  it('支持 $ARGUMENTS、$ARGUMENTS[n]、$n 与环境变量插值', () => {
    const body =
      'Migrate $0 from $ARGUMENTS[1] to $2. All: $ARGUMENTS. Dir: ${CLAUDE_SKILL_DIR}, Session: ${CLAUDE_SESSION_ID}, Root: ${WORKSPACE_ROOT}'
    const rendered = interpolateClaudeSkillPrompt(body, {
      rawArgs: 'SearchBar React Vue',
      skillDir: '/skills/migrator',
      sessionId: 'sess-42',
      workspaceRoot: '/workspace/app'
    })
    expect(rendered).toBe(
      'Migrate SearchBar from React to Vue. All: SearchBar React Vue. Dir: /skills/migrator, Session: sess-42, Root: /workspace/app'
    )
  })

  it('正文中未出现参数占位符但用户传了参数时，自动在末尾追加 ARGUMENTS:（Claude Code 规范）', () => {
    const rendered = interpolateClaudeSkillPrompt('Follow the coding guide.', {
      rawArgs: 'fix login bug'
    })
    expect(rendered).toBe('Follow the coding guide.\n\nARGUMENTS: fix login bug')
  })

  it('提取并替换 !`command` 动态上下文占位符', () => {
    const text = 'Branch: !`git branch --show-current`\nFiles:\n!`ls -1`'
    expect(extractDynamicContextCommands(text)).toEqual(['git branch --show-current', 'ls -1'])
    const replaced = replaceDynamicContextCommands(text, (cmd) =>
      cmd.startsWith('git') ? 'main' : 'a.ts\nb.ts'
    )
    expect(replaced).toBe('Branch: main\nFiles:\na.ts\nb.ts')
  })
})

describe('allowed-tools 模式匹配与斜杠命令解析', () => {
  it('matchesAllowedTool 支持精确工具名、通配符与 Bash(cmd *) 细粒度匹配', () => {
    const allowed = ['Read', 'Grep', 'Bash(git *)', 'mcp__github__*']
    expect(matchesAllowedTool(allowed, 'Read')).toBe(true)
    expect(matchesAllowedTool(allowed, 'Write')).toBe(false)
    expect(matchesAllowedTool(allowed, 'mcp__github__create_pr')).toBe(true)
    expect(matchesAllowedTool(allowed, 'Bash', 'git status -s')).toBe(true)
    expect(matchesAllowedTool(allowed, 'Bash', 'rm -rf /')).toBe(false)
  })

  it('parseSlashSkillCommand 解析 /skill-name 与引号参数', () => {
    expect(parseSlashSkillCommand('/pr-reviewer 123 "security check"')).toEqual({
      skillName: 'pr-reviewer',
      rawArgs: '123 "security check"',
      argv: ['123', 'security check']
    })
    expect(parseSlashSkillCommand('普通对话消息')).toBeNull()
  })
})

describe('GitHub 技能源 URL 解析与路径安全守卫', () => {
  it('支持 owner/repo、owner/repo/subpath、tree URL、blob SKILL.md URL 四种输入格式', () => {
    expect(parseGitHubSkillSourceUrl('anthropics/skills')).toEqual({
      owner: 'anthropics',
      repo: 'skills',
      subpath: '',
      canonicalUrl: 'https://github.com/anthropics/skills'
    })

    expect(parseGitHubSkillSourceUrl('anthropics/skills/skills/pdf')).toEqual({
      owner: 'anthropics',
      repo: 'skills',
      subpath: 'skills/pdf',
      canonicalUrl: 'https://github.com/anthropics/skills/tree/main/skills/pdf'
    })

    expect(
      parseGitHubSkillSourceUrl('https://github.com/anthropics/skills/tree/main/skills/xlsx')
    ).toEqual({
      owner: 'anthropics',
      repo: 'skills',
      ref: 'main',
      subpath: 'skills/xlsx',
      canonicalUrl: 'https://github.com/anthropics/skills/tree/main/skills/xlsx'
    })

    expect(
      parseGitHubSkillSourceUrl(
        'https://github.com/anthropics/skills/blob/main/skills/docx/SKILL.md'
      )
    ).toEqual({
      owner: 'anthropics',
      repo: 'skills',
      ref: 'main',
      subpath: 'skills/docx',
      canonicalUrl: 'https://github.com/anthropics/skills/tree/main/skills/docx'
    })
  })

  it('拒绝非法或非 GitHub 地址', () => {
    expect(parseGitHubSkillSourceUrl('')).toBeNull()
    expect(parseGitHubSkillSourceUrl('https://evil.example.com/a/b')).toBeNull()
    expect(parseGitHubSkillSourceUrl('owner/../etc')).toBeNull()
  })

  it('isAllowedClaudeSkillBundleRelPath 允许标准 Claude Code 多级目录并拦截越界路径', () => {
    expect(isAllowedClaudeSkillBundleRelPath('SKILL.md')).toBe(true)
    expect(isAllowedClaudeSkillBundleRelPath('workflow.json')).toBe(true)
    expect(isAllowedClaudeSkillBundleRelPath('references/api/spec.md')).toBe(true)
    expect(isAllowedClaudeSkillBundleRelPath('scripts/helper.py')).toBe(true)
    expect(isAllowedClaudeSkillBundleRelPath('assets/template.html')).toBe(true)
    expect(isAllowedClaudeSkillBundleRelPath('../outside.md')).toBe(false)
    expect(isAllowedClaudeSkillBundleRelPath('/abs/path.md')).toBe(false)
  })
})
