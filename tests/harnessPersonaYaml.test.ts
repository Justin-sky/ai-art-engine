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

describe('画布节点生成与音效分流规则确实在系统提示里', () => {
  const joined = personaBody()

  it('明确规定所有媒体生成通过 graph_edit + task_run 在画布节点上完成', () => {
    expect(joined).toMatch(
      /Always create media by editing canvas nodes via `graph_edit` and executing them via `task_run`/
    )
    expect(joined).toContain('asset.image')
    expect(joined).toContain('asset.video')
    expect(joined).toContain('voice.tts')
    expect(joined).toContain('audio.sfx')
    expect(joined).toContain('audio.music')
  })

  it('含"按音频是什么分流到对应画布节点"的规则行', () => {
    expect(joined).toMatch(/Pick the audio node by what the audio IS/)
  })

  it('明确禁止用 voice.tts 顶替音效请求', () => {
    expect(joined).toMatch(/Never satisfy a sound-effect or ambience request with `voice\.tts`/)
    expect(joined).toMatch(/which is the wrong result and still costs a call/)
  })

  it('提醒无缝循环要传 loop: true', () => {
    expect(joined).toMatch(/pass `loop: true` in `audio\.sfx` node params/)
  })
})

describe('项目画布节点自动感知与内置节点能力路由', () => {
  const body = personaBody()
  const chatSrc = readFileSync(resolve('src/renderer/src/components/ChatPanel.vue'), 'utf8')

  it('buildPersona 含画布节点操作与核心节点能力路由规则', () => {
    expect(body).toContain('=== Project Canvas & Built-in Node Capabilities ===')
    expect(body).toContain('[Workspace Canvas & Node Context]')
    for (const token of [
      'graph_read',
      'graph_edit',
      'graph_node_types',
      'task_run',
      'film.workbench',
      'image.process',
      'image.portrait',
      'image.adVariants',
      'anim.2d',
      'stage.2d',
      'semantic.analyze',
      'world.splatView',
      'model.rigSkin'
    ]) {
      expect(body, `buildPersona 应包含 ${token}`).toContain(token)
    }
  })

  it('ChatPanel 采集当前打开画布与选中节点上下文并随 runHarnessTask 下发', () => {
    expect(chatSrc).toContain('function buildActiveCanvasContext(): string | undefined')
    expect(chatSrc).toContain('const canvasContext = buildActiveCanvasContext()')
    expect(chatSrc).toContain('...(canvasContext ? { canvasContext } : {})')
  })

  it('主进程 resolveProjectCanvasContext 支持渲染层上报与工程画布兜底注入', () => {
    expect(SRC).toContain('function resolveProjectCanvasContext(explicitContext?: string): string')
    expect(SRC).toContain('[Workspace Canvas & Node Context]')
  })

  it('创建游戏机制默认只建单个精简 game.economy 节点，仅在用户明确要求时才创建复杂全套机制或游戏策划案节点', async () => {
    const mcpSrc = readFileSync(resolve('src/main/services/mcpServerService.ts'), 'utf8')
    const ctxSrc = readFileSync(
      resolve('src/renderer/src/features/mcp/buildActiveWorkspaceContext.ts'),
      'utf8'
    )
    const { getNodeCapability } = await import('../src/shared/graph/nodeCapabilities')

    // 1. Harness 系统提示词：默认只建 1 个聚焦核心循环的 game.economy，禁默认建复杂全套机制或附带 asset.gameSystem
    expect(body).toContain('Default Lightweight Single-Node Rule (CRITICAL)')
    expect(body).toContain('Explicit Opt-In ONLY for Complete Multi-Layer Mechanics')
    expect(body).toContain(
      'ONLY create `asset.gameSystem` when the user explicitly asks to write/generate a game design document / GDD'
    )
    expect(body).not.toContain(
      'or full mechanics of a game like Slay the Spire / Hearthstone / Balatro / Tower Defense / ARPG / Idle'
    )
    expect(body).not.toContain('& Closed-Loop Pipeline:')

    // 2. MCP graph_node_types 与 graph_edit 说明同步去掉强制闭环/复杂全套默认约定
    expect(mcpSrc).toContain('默认**只创建单个 `game.economy` 节点**')
    expect(mcpSrc).toContain(
      '严禁默认创建全套复杂多图层机制，也严禁擅自附带创建 `asset.gameSystem`'
    )
    expect(mcpSrc).toContain(
      '仅在用户明确要求生成游戏策划案 / 系统策划案 / GDD 时创建，创建游戏机制时严禁默认附带创建'
    )

    // 3. 工作区实时上下文同步约束
    expect(ctxSrc).toContain('Focused Default vs. Explicit Complete Mechanics Rule')
    expect(ctxSrc).toContain(
      'NEVER auto-create `asset.gameSystem` (GDD / 策划案) or `game.numerical` nodes'
    )
    expect(ctxSrc).not.toContain('**Complete Mechanics & Multi-Layer Mandate**')

    // 4. 节点能力注册表同步更新
    const econCap = getNodeCapability('game.economy')
    const gddCap = getNodeCapability('asset.gameSystem')
    expect(econCap?.titleZh).not.toContain('多图层完整机制')
    expect(econCap?.usageZh).toContain('默认**只创建单个 `game.economy` 节点**')
    expect(econCap?.usageZh).toContain('严禁擅自附带创建 `asset.gameSystem`')
    expect(gddCap?.usageZh).toContain('仅在用户明确要求撰写/生成游戏策划案')
  })
})
