import { describe, expect, it } from 'vitest'
import {
  applyNodePreset,
  getNodeCapability,
  hashPromptForLog,
  listNodeCapabilities,
  registerNodeCapability
} from '../src/shared/graph'

describe('nodeCapabilities', () => {
  it('lists episode and builtin node capabilities', () => {
    const ids = listNodeCapabilities().map((cap) => cap.id)
    expect(ids).toContain('episode.breakdown')
    expect(ids).toContain('episode.beatboard')
    expect(ids).toContain('episode.review.motion')
    expect(ids).toContain('asset.image')
    expect(ids).not.toContain('screenplay.create')
  })

  it('applies episode node preset into node params without legacy skillId', () => {
    const params = applyNodePreset('episode.breakdown')
    expect('skillId' in params).toBe(false)
    expect(params.generateSystemPrompt).toContain('分镜师')
    expect(params.generateInstruction).toContain('节拍拆解表')
    expect(getNodeCapability('episode.breakdown')?.parse).toBe('beatBreakdown')
  })

  it('interpolates grid vars without touching typeId', () => {
    const params = applyNodePreset('episode.image.grid4', { vars: { group: 3 } })
    expect('skillId' in params).toBe(false)
    expect(params.generateInstruction).toContain('第 3 组')
    expect(params.generateSystemPrompt).toBeUndefined()
  })

  it('hashes prompt text stably for logs only', () => {
    expect(hashPromptForLog('hello', 'sys')).toBe(hashPromptForLog('hello', 'sys'))
    expect(hashPromptForLog('hello')).not.toBe(hashPromptForLog('hello!'))
  })

  it('overlays a node capability and restores the builtin on dispose', () => {
    const builtin = getNodeCapability('episode.breakdown')
    expect(builtin).toBeTruthy()
    const overlay = { ...builtin!, titleZh: '插件覆盖' }
    const dispose = registerNodeCapability(overlay)
    expect(getNodeCapability('episode.breakdown')?.titleZh).toBe('插件覆盖')
    dispose()
    expect(getNodeCapability('episode.breakdown')).toBe(builtin)
  })

  it('exposes blender node capabilities for the three 3D cook nodes', () => {
    for (const id of ['model.rigSkin', 'model.pose', 'model.animation'] as const) {
      const cap = getNodeCapability(id)
      expect(cap?.kind).toBe('blender')
      expect(cap?.usageEn).toContain('input.glb')
      expect(cap?.usageEn).toContain('result.json')
      expect(cap?.systemPromptEn).toContain('Never invent Euler JSON')
    }
    expect(applyNodePreset('model.pose').generateInstruction).toContain('IK')
  })

  it('exposes the svg vector node capability for the chat agent', () => {
    const cap = getNodeCapability('svg.gen')
    expect(cap?.kind).toBe('svg')
    expect(cap?.titleEn).toContain('SVG')
    expect(cap?.usageZh).toContain('svg.gen')
    expect(cap?.usageZh).toContain('svg.anim')
    expect(applyNodePreset('svg.gen').generateInstruction).toContain('SVG')
  })

  it('exposes the tutorial-recording capability for chat how-to videos', () => {
    const cap = getNodeCapability('tutorial.recording')
    expect(cap?.kind).toBe('tutorial')
    expect(cap?.usageZh).toContain('tutorial_compose')
    expect(cap?.usageEn).toContain('screen_record_stop')
    expect(cap?.systemPromptZh).toBeUndefined()
    expect(cap?.instructionZh).toBeUndefined()
    expect(cap?.usageZh).toContain('graph-ctx-group-filmTv')
    expect(cap?.usageZh).toContain('必须带 tutorialId')
    expect(cap?.usageZh).toContain('别再加字幕轨')
    expect(cap?.usageEn).toContain('graph-ctx-group-filmTv')
    expect(cap?.usageEn).toContain('tutorialId is REQUIRED')
  })

  it('exposes the procedural-assets capability for the chat game flow', () => {
    const cap = getNodeCapability('game.htmlGen')
    expect(cap?.kind).toBe('gameplay')
    expect(cap?.titleEn).toContain('procedural')
    for (const token of [
      'defineAsset',
      'createRng',
      'gameplay_prepare_project',
      'gameplay_build',
      'gameplay_job_status',
      'src/assets/'
    ]) {
      expect(cap?.usageZh, `能力缺 ${token}`).toContain(token)
      expect(cap?.usageEn, `能力缺 ${token}`).toContain(token)
    }
    expect(cap?.usageZh).toMatch(/禁止 Math\.random/)
    expect(cap?.usageEn).toMatch(/never run npm yourself/)
    expect(cap?.systemPromptZh).toBeUndefined()
    expect(cap?.instructionZh).toBeUndefined()
  })

  it('exposes updated film.workbench capability with Series Bible, variant inheritance, and concurrency', () => {
    const cap = getNodeCapability('film.workbench')
    expect(cap?.kind).toBe('film')
    expect(cap?.usageZh).toContain('film.workbench')
    expect(cap?.usageZh).toContain('in-cast')
    expect(cap?.usageZh).toContain('角色名#造型')
    expect(cap?.usageZh).toContain('filmRenderConcurrency')
    expect(cap?.usageEn).toContain('film.workbench')
    expect(cap?.usageEn).toContain('in-cast')
    expect(cap?.usageEn).toContain('BaseName#Variant')
    expect(cap?.usageEn).toContain('filmRenderConcurrency')
  })

  it('exposes latest consolidated node capabilities (image.process, image.adVariants, stage.2d, voice.tts, world.splatView)', () => {
    const imgProc = getNodeCapability('image.process')
    expect(imgProc?.usageZh).toContain('imageProcessTool')
    expect(imgProc?.usageEn).toContain('imageProcessTool')

    for (const id of [
      'image.upscale',
      'image.expand',
      'image.redraw',
      'image.erase',
      'image.matte'
    ] as const) {
      const s = getNodeCapability(id)
      expect(s?.usageZh, `${id} usageZh should reference image.process`).toContain('image.process')
      expect(s?.usageEn, `${id} usageEn should reference image.process`).toContain('image.process')
    }

    expect(getNodeCapability('image.adVariants')?.usageZh).toContain('adVariantMatrix')
    expect(getNodeCapability('stage.2d')?.usageZh).toContain('stage.2d')
    expect(getNodeCapability('stage.2d')?.usageZh).toContain('image.align')
    expect(getNodeCapability('voice.tts')?.usageZh).toContain('voice.tts')
    expect(getNodeCapability('voice.tts')?.usageZh).toContain('audio.separate')
    expect(getNodeCapability('world.splatView')?.usageZh).toContain('world.splatView')
    expect(getNodeCapability('semantic.analyze')?.usageZh).toContain('semantic.analyze')
    expect(getNodeCapability('semantic.rebuild')?.usageZh).toContain('semantic.rebuild')
  })

  it('registers a new node capability and removes it on dispose', () => {
    const dispose = registerNodeCapability({
      id: 'plugin.test.cap',
      kind: 'node',
      titleZh: '测试节点能力',
      titleEn: 'Test node capability'
    })
    expect(getNodeCapability('plugin.test.cap')?.titleZh).toBe('测试节点能力')
    expect(listNodeCapabilities().some((cap) => cap.id === 'plugin.test.cap')).toBe(true)
    dispose()
    expect(getNodeCapability('plugin.test.cap')).toBeUndefined()
    expect(listNodeCapabilities().some((cap) => cap.id === 'plugin.test.cap')).toBe(false)
  })
})

describe('third-party GitHub skill node capabilities bridge', () => {
  it('buildStudioNodeCapabilitiesBridge includes all core canvas node types and sub-tools', async () => {
    const { buildStudioNodeCapabilitiesBridge } =
      await import('../src/main/services/claudeSkillRuntime')
    const bridge = buildStudioNodeCapabilitiesBridge()
    expect(bridge).toContain('[AIArtEngine Project Built-in Node Capabilities Bridge]')
    for (const typeId of [
      'asset.image',
      'asset.video',
      'film.workbench',
      'image.process',
      'anim.2d',
      'stage.2d',
      'svg.gen',
      'svg.anim',
      'ui.split',
      'ui.gen',
      'image.iconPack',
      'comic.page',
      'semantic.analyze',
      'semantic.rebuild'
    ]) {
      expect(bridge, `bridge should include ${typeId}`).toContain(`\`${typeId}\``)
    }
    expect(bridge).toContain('generateTransparentBg')
  })

  it('preprocessSkillInvocation injects node capabilities bridge for slash and natural-language skill calls and auto-approves studio MCP tools', async () => {
    const { mkdtempSync, mkdirSync, rmSync, writeFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { preprocessSkillInvocation, shouldAutoApproveSkillTool } =
      await import('../src/main/services/claudeSkillRuntime')

    const tempSkillsDir = mkdtempSync(join(tmpdir(), 'aiart-gh-skill-test-'))
    try {
      const bundleDir = join(tempSkillsDir, 'frontend-design')
      mkdirSync(bundleDir, { recursive: true })
      writeFileSync(
        join(bundleDir, 'SKILL.md'),
        [
          '---',
          'name: frontend-design',
          'description: Third-party GitHub design skill',
          'allowed-tools: Read, Write, Bash',
          '---',
          'Follow bold typography and clean layout principles.'
        ].join('\n'),
        'utf8'
      )

      // 1. 行首 /frontend-design 调用
      const resSlash = preprocessSkillInvocation({
        taskText: '/frontend-design 设计一套RPG背包界面',
        personalSkillsDir: tempSkillsDir,
        enableDynamicCommands: false
      })
      expect(resSlash.matched).toBe(true)
      expect(resSlash.taskText).toContain('[Claude Code Skill Active: /frontend-design]')
      expect(resSlash.taskText).toContain('Follow bold typography and clean layout principles.')
      expect(resSlash.taskText).toContain('[AIArtEngine Project Built-in Node Capabilities Bridge]')
      expect(resSlash.taskText).toContain('`ui.split`')
      expect(resSlash.taskText).toContain('`ui.gen`')

      // 2. 自然语言点名已安装的第三方 GitHub 技能
      const resNatural = preprocessSkillInvocation({
        taskText: '请使用 frontend-design 技能帮我生成一套游戏图标和UI',
        personalSkillsDir: tempSkillsDir,
        enableDynamicCommands: false
      })
      expect(resNatural.matched).toBe(true)
      expect(resNatural.taskText).toContain('请使用 frontend-design 技能帮我生成一套游戏图标和UI')
      expect(resNatural.taskText).toContain(
        '[AIArtEngine Project Built-in Node Capabilities Bridge]'
      )

      // 3. 即使第三方技能只声明了 Read/Write/Bash，也自动放行本项目 MCP 工具
      expect(
        shouldAutoApproveSkillTool(resSlash.activeSkill, 'mcp__ai-art-engine__graph_edit')
      ).toBe(true)
      expect(shouldAutoApproveSkillTool(resSlash.activeSkill, 'mcp__ai-art-engine__task_run')).toBe(
        true
      )
    } finally {
      rmSync(tempSkillsDir, { recursive: true, force: true })
    }
  })
})
