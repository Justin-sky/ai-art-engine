import { describe, expect, it, vi } from 'vitest'
import { createNodeFromType } from '../src/shared/graph/create'
import { executeScreenplayGenerateNode } from '../src/shared/graph/execute/generateText'
import { resolveGalleryOutputsFromNodeParams } from '../src/shared/graph/execute/helpers'
import { executeSelectTextNode } from '../src/shared/graph/execute/select'
import { createScriptRunNodeExecutor } from '../src/shared/graph/execute/scriptRun'
import { executePlainTextNode } from '../src/shared/graph/execute/slots'
import type { ScriptRunRequest, ScriptSandbox } from '../src/shared/graph/execute/scriptSandbox'
import type { NodeExecuteContext } from '../src/shared/graph/execute/types'
import {
  readScriptNodeParams,
  readScriptRunDiagnostics,
  scriptNodeDefaultParams,
  scriptNodePorts,
  validateScriptNodeParams,
  SCRIPT_MAX_LIMITS,
  SCRIPT_NODE_TEMPLATES
} from '../src/shared/graph/scriptNode'
import {
  analyzeScreenplay,
  buildNextEpisodeInstruction,
  extractScreenplayScenes,
  formatScreenplayText,
  SCREENPLAY_TEMPLATES,
  splitScreenplayByExplicitEpisodeMarkers,
  splitScreenplayIntoEpisodes
} from '../src/shared/graph/screenplayFormat'

// ── 假沙箱：不跑 WASM，直接按注入的 handler 返回，让执行器测试又快又确定 ──
function fakeSandbox(
  handler: (req: ScriptRunRequest) => Promise<unknown> | unknown
): ScriptSandbox {
  return {
    async run(req) {
      try {
        const outputs = await handler(req)
        return { ok: true, outputs: (outputs ?? {}) as Record<string, unknown> }
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
      }
    }
  }
}

function ctxWith(
  params: Record<string, unknown>,
  inputs: Record<string, unknown[]>,
  caps: Partial<NodeExecuteContext> = {}
): NodeExecuteContext {
  return {
    node: { id: 'n1', typeId: 'script.run', category: 'note', position: { x: 0, y: 0 }, params },
    inputs,
    ...caps
  } as unknown as NodeExecuteContext
}

describe('脚本节点契约（纯函数）', () => {
  it('默认参数：一进一出、无能力、默认上限、校验通过', () => {
    const p = scriptNodeDefaultParams()
    expect(p.ports.inputs.map((x) => x.id)).toEqual(['in'])
    expect(p.ports.outputs.map((x) => x.id)).toEqual(['out'])
    expect(p.capabilities).toEqual([])
    expect(validateScriptNodeParams(p)).toEqual([])
  })

  it('动态端口：按 params.ports 派生图端口', () => {
    const p = readScriptNodeParams({
      ports: {
        inputs: [
          { id: 'a', dataType: 'image' },
          { id: 'b', dataType: 'text' }
        ],
        outputs: [{ id: 'r', dataType: 'video' }]
      }
    })
    const ports = scriptNodePorts(p)
    expect(ports).toEqual([
      { id: 'a', direction: 'in', dataType: 'image', multiple: false },
      { id: 'b', direction: 'in', dataType: 'text', multiple: false },
      { id: 'r', direction: 'out', dataType: 'video', multiple: false }
    ])
  })

  it('脏参数回落：未知能力丢弃、超限夹到硬顶、端口重名拒绝', () => {
    const p = readScriptNodeParams({
      capabilities: ['generateImage', 'evilCap', 42],
      limits: { timeoutMs: 999_999_999, memoryMb: 99_999 }
    })
    expect(p.capabilities).toEqual(['generateImage'])
    expect(p.limits.timeoutMs).toBe(SCRIPT_MAX_LIMITS.timeoutMs)
    expect(p.limits.memoryMb).toBe(SCRIPT_MAX_LIMITS.memoryMb)
    const dup = readScriptNodeParams({
      ports: { inputs: [{ id: 'x', dataType: 'text' }], outputs: [{ id: 'x', dataType: 'text' }] }
    })
    // 输入 / 输出各自去重，但同名 in/out 合法（不同方向）；这里构造输出内重名
    const bad = {
      ...dup,
      ports: { inputs: dup.ports.inputs, outputs: [dup.ports.outputs[0]!, dup.ports.outputs[0]!] }
    }
    expect(validateScriptNodeParams(bad).some((i) => i.message.includes('duplicate'))).toBe(true)
  })
})

describe('脚本执行器：输入装配与输出校验', () => {
  it('按输入端口把上游值快照成 inputs 传进沙箱', async () => {
    let seen: unknown = null
    const run = createScriptRunNodeExecutor({
      sandbox: fakeSandbox((req) => {
        seen = req.inputs
        return { out: { kind: 'text', text: 'ok' } }
      })
    })
    const ctx = ctxWith(
      {
        ports: {
          inputs: [{ id: 'in', dataType: 'text' }],
          outputs: [{ id: 'out', dataType: 'text' }]
        }
      },
      { in: [{ kind: 'text', text: 'hi' }], ignored: [{ kind: 'text', text: 'x' }] }
    )
    const out = await run(ctx)
    expect(seen).toEqual({ in: [{ kind: 'text', text: 'hi' }] })
    expect(out).toEqual({ out: { kind: 'text', text: 'ok' } })
  })

  it('输出：丢弃未声明的端口；缺 kind 报错', async () => {
    const run = createScriptRunNodeExecutor({
      sandbox: fakeSandbox(() => ({ out: { kind: 'text', text: 'y' }, bogus: { kind: 'text' } }))
    })
    const ctx = ctxWith(
      {
        ports: {
          inputs: [{ id: 'in', dataType: 'text' }],
          outputs: [{ id: 'out', dataType: 'text' }]
        }
      },
      {}
    )
    expect(await run(ctx)).toEqual({ out: { kind: 'text', text: 'y' } })

    const runBad = createScriptRunNodeExecutor({
      sandbox: fakeSandbox(() => ({ out: { text: 'no kind' } }))
    })
    await expect(runBad(ctx)).rejects.toThrow(/kind/)
  })

  it('沙箱失败 → 执行器抛错', async () => {
    const run = createScriptRunNodeExecutor({
      sandbox: {
        async run() {
          return { ok: false, error: 'boom' }
        }
      }
    })
    const ctx = ctxWith({ ports: scriptNodeDefaultParams().ports }, {})
    await expect(run(ctx)).rejects.toThrow(/boom/)
  })
})

describe('脚本执行器：能力白名单与治理转发', () => {
  it('只有声明过 + 环境真有的能力进 allowedHostCalls；om 调用转发到 ctx 能力', async () => {
    const generateImage = vi.fn(async () => ({ images: ['data:image/png;base64,Z'] }))
    let allowed: readonly string[] = []
    let hostResult: unknown = null
    const run = createScriptRunNodeExecutor({
      sandbox: fakeSandbox(async (req) => {
        allowed = req.allowedHostCalls
        hostResult = await req.hostCall({ name: 'generateImage', args: { prompt: 'cat' } })
        return { out: { kind: 'image', dataUrl: (hostResult as { images: string[] }).images[0] } }
      })
    })
    const ctx = ctxWith(
      {
        // 声明了两个能力，但环境只注入了 generateImage
        capabilities: ['generateImage', 'generateVideo'],
        ports: scriptNodeDefaultParams().ports
      },
      {},
      { generateImage: generateImage as unknown as NodeExecuteContext['generateImage'] }
    )
    const out = await run(ctx)
    expect(allowed).toEqual(['generateImage']) // generateVideo 环境没有，被剔除
    expect(generateImage).toHaveBeenCalledWith({ prompt: 'cat' })
    expect(out).toEqual({ out: { kind: 'image', dataUrl: 'data:image/png;base64,Z' } })
  })

  it('调用未在 bridge 里的能力 → hostCall 抛错', async () => {
    const run = createScriptRunNodeExecutor({
      sandbox: fakeSandbox(async (req) => {
        await req.hostCall({ name: 'generateVideo', args: {} })
        return {}
      })
    })
    const ctx = ctxWith({ capabilities: [], ports: scriptNodeDefaultParams().ports }, {})
    await expect(run(ctx)).rejects.toThrow(/not available/)
  })

  it('saveMedia 转发到 ctx.saveRunMedia 并带上当前节点', async () => {
    const saveRunMedia = vi.fn(async () => 'Cache/Images/x.png')
    let rel: unknown = null
    const run = createScriptRunNodeExecutor({
      sandbox: fakeSandbox(async (req) => {
        rel = await req.hostCall({
          name: 'saveMedia',
          args: { dataUrl: 'data:image/png;base64,Q', key: 'k' }
        })
        return { out: { kind: 'image', relativePath: rel } }
      })
    })
    const ctx = ctxWith(
      { capabilities: ['saveMedia'], ports: scriptNodeDefaultParams().ports },
      {},
      { saveRunMedia: saveRunMedia as unknown as NodeExecuteContext['saveRunMedia'] }
    )
    await run(ctx)
    expect(rel).toBe('Cache/Images/x.png')
    expect(saveRunMedia).toHaveBeenCalledWith(
      expect.objectContaining({ dataUrl: 'data:image/png;base64,Q', key: 'k', node: ctx.node })
    )
  })

  it('内置商用脚本模板全部通过参数校验，执行器将 console 日志与诊断写回节点 params', async () => {
    expect(SCRIPT_NODE_TEMPLATES.length).toBeGreaterThanOrEqual(5)
    for (const tpl of SCRIPT_NODE_TEMPLATES) {
      const p = readScriptNodeParams({
        code: tpl.code,
        ports: tpl.ports,
        capabilities: tpl.capabilities
      })
      expect(validateScriptNodeParams(p)).toEqual([])
    }

    const logSpy = vi.fn()
    const patchSpy = vi.fn()
    const run = createScriptRunNodeExecutor({
      sandbox: {
        async run() {
          return {
            ok: true,
            outputs: { out: { kind: 'text', text: 'done' } },
            logs: [{ level: 'info', message: 'step 1 ok' }]
          }
        }
      }
    })
    const ctx = ctxWith(
      { ports: scriptNodeDefaultParams().ports },
      {},
      { log: logSpy, patchNode: patchSpy }
    )
    await run(ctx)
    expect(logSpy).toHaveBeenCalledWith('step 1 ok', 'info')
    expect(patchSpy).toHaveBeenCalled()
    const diag = readScriptRunDiagnostics(ctx.node.params as Record<string, unknown>)
    expect(diag.logs).toEqual([{ level: 'info', message: 'step 1 ok' }])
    expect(diag.error).toBe('')
    expect(typeof diag.runMs).toBe('number')
  })
})

describe('剧本生成节点（asset.screenplay）与纯文本节点（text.plain）', () => {
  it('analyzeScreenplay 准确识别场次、人物小传与对白角色、动作段与预估时长', () => {
    const tpl = SCREENPLAY_TEMPLATES[0]!
    const stats = analyzeScreenplay(tpl.textZh)
    expect(stats.sceneCount).toBe(1)
    expect(stats.characters).toEqual(['林晚', '苏蔓', '陆景深'])
    expect(stats.dialogueCount).toBe(3)
    expect(stats.actionCount).toBe(4)
    expect(stats.estimatedDurationSec).toBeGreaterThanOrEqual(15)
  })

  it('formatScreenplayText 规范化场次标题、△ 动作标记与中文对白冒号括号', () => {
    const messy = [
      '第 1 场:  【内景 · 咖啡馆 - 日】',
      '▲ 林晚推门走进来。',
      '[动作] 顾沉放下咖啡杯。',
      '林晚(OS): 这就是他约我见面的地方？',
      '',
      '',
      '顾沉: 坐吧。'
    ].join('\n')
    const formatted = formatScreenplayText(messy)
    expect(formatted).toContain('第1场 【内景 · 咖啡馆 - 日】')
    expect(formatted).toContain('△ 林晚推门走进来。')
    expect(formatted).toContain('△ 顾沉放下咖啡杯。')
    expect(formatted).toContain('林晚（OS）：这就是他约我见面的地方？')
    expect(formatted).toContain('顾沉：坐吧。')
  })

  it('text.plain 仅同步透传纯文本', () => {
    const plainNode = createNodeFromType(
      'text.plain',
      { x: 0, y: 0 },
      { params: { text: '纯文本内容' } }
    )
    expect(plainNode.typeId).toBe('text.plain')
    const syncOut = executePlainTextNode({
      node: plainNode,
      inputs: {}
    } as unknown as NodeExecuteContext)
    expect(syncOut).toEqual({ out: { kind: 'text', text: '纯文本内容' } })
  })

  it('executeScreenplayGenerateNode 将节点内草稿合并进提示词并调用文本模型写回 params.text', async () => {
    const generateText = vi.fn(async () => ({
      text: '第1场 【内景 · 拍卖厅 - 夜】\n△ 灯光亮起。\n林晚：开始吧。',
      model: 'mock-llm'
    }))
    const patchNode = vi.fn()
    const aiCtx = {
      node: {
        id: 's2',
        typeId: 'asset.screenplay',
        category: 'asset',
        assetType: 'screenplay',
        position: { x: 0, y: 0 },
        params: {
          text: '林晚在拍卖会反击苏蔓',
          generateInstruction: '扩写为标准短剧第一场'
        }
      },
      inputs: {},
      generateText,
      patchNode
    } as unknown as NodeExecuteContext

    const aiOut = await executeScreenplayGenerateNode(aiCtx)
    expect(generateText).toHaveBeenCalledTimes(1)
    const promptSent = (generateText.mock.calls[0] as unknown as [{ prompt: string }])[0].prompt
    expect(promptSent).toContain('扩写为标准短剧第一场')
    expect(promptSent).toContain('林晚在拍卖会反击苏蔓')
    expect(aiOut).toMatchObject({
      out: { kind: 'text', text: '第1场 【内景 · 拍卖厅 - 夜】\n△ 灯光亮起。\n林晚：开始吧。' }
    })
    expect(patchNode).toHaveBeenCalled()
  })

  it('splitScreenplayIntoEpisodes 支持按「第X集」标记与按每集固定场次数拆分，并自动携带共享【人物小传】', () => {
    const multiEpisodeScript = [
      '【人物小传】',
      '- 林晚（24岁，女）：天才设计师。',
      '- 陆景深（29岁，男）：首席鉴宝师。',
      '',
      '第1集：拍卖惊变',
      '第1场 【内景 · 拍卖厅 - 夜】',
      '△ 聚光灯照亮展台。',
      '林晚：这件作品暗藏第三道星轨。',
      '',
      '第2集：真相浮现',
      '第1场 【内景 · 鉴定室 - 夜】',
      '△ 紫外灯缓缓亮起。',
      '陆景深：请看宝石切面里的签名。'
    ].join('\n')

    const byMarkers = splitScreenplayIntoEpisodes(multiEpisodeScript, {
      mode: 'auto',
      includeSharedBios: true
    })
    expect(byMarkers).toHaveLength(2)
    expect(byMarkers[0]!.title).toBe('第1集：拍卖惊变')
    expect(byMarkers[0]!.text).toContain('【人物小传】')
    expect(byMarkers[0]!.text).toContain('林晚：这件作品暗藏第三道星轨。')
    expect(byMarkers[1]!.title).toBe('第2集：真相浮现')
    expect(byMarkers[1]!.text).toContain('【人物小传】')
    expect(byMarkers[1]!.text).toContain('陆景深：请看宝石切面里的签名。')

    const fourSceneScript = [
      '【人物小传】',
      '- 林晚（24岁，女）：天才设计师。',
      '',
      '第1场 【内景 · 珠宝展厅 - 夜】',
      '△ 灯光璀璨。',
      '林晚：开始了。',
      '',
      '第2场 【内景 · 后台走廊 - 夜】',
      '△ 脚步急促。',
      '林晚：拦住她。',
      '',
      '第3场 【内景 · 鉴定中心 - 夜】',
      '△ 仪器运转。',
      '林晚：证据在此。',
      '',
      '第4场 【外景 · 大厦天台 - 黎明】',
      '△ 晨光破晓。',
      '林晚：一切都结束了。'
    ].join('\n')

    const byScenes = splitScreenplayIntoEpisodes(fourSceneScript, {
      mode: 'scenes',
      scenesPerEpisode: 2,
      includeSharedBios: true
    })
    expect(byScenes).toHaveLength(2)
    expect(byScenes[0]!.title).toContain('第1集')
    expect(byScenes[0]!.sceneCount).toBe(2)
    expect(byScenes[0]!.text).toContain('【人物小传】')
    expect(byScenes[0]!.text).toContain('第1场')
    expect(byScenes[0]!.text).toContain('第2场')
    expect(byScenes[1]!.title).toContain('第2集')
    expect(byScenes[1]!.sceneCount).toBe(2)
    expect(byScenes[1]!.text).toContain('【人物小传】')
    expect(byScenes[1]!.text).toContain('第3场')
    expect(byScenes[1]!.text).toContain('第4场')

    const outlines = extractScreenplayScenes(fourSceneScript)
    expect(outlines).toHaveLength(4)
    expect(outlines[0]!.title).toContain('第1场')
    expect(outlines[0]!.preview).toContain('灯光璀璨')

    const nextPrompt = buildNextEpisodeInstruction('第1集：拍卖惊变', 2, 'zh-CN')
    expect(nextPrompt).toContain('第2集')
    expect(nextPrompt).toContain('人物小传')
  })

  it('screenplay.workbench Dive 工作台完成注册、卡片双击路由与 Inspector 精简入口接线', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const diveModel = readFileSync(
      join(process.cwd(), 'src/renderer/src/features/graph/model/editorDive.ts'),
      'utf8'
    )
    expect(diveModel).toContain("'screenplay.workbench'")

    const hostCode = readFileSync(
      join(process.cwd(), 'src/renderer/src/components/EditorDiveChildHost.vue'),
      'utf8'
    )
    expect(hostCode).toContain("'screenplay.workbench'")
    expect(hostCode).toContain('./dive/EditorDiveScreenplayView.vue')

    const cardCode = readFileSync(
      join(process.cwd(), 'src/renderer/src/components/GraphNodeCard.vue'),
      'utf8'
    )
    expect(cardCode).toContain("viewId: 'screenplay.workbench'")

    const inspectorCode = readFileSync(
      join(process.cwd(), 'src/renderer/src/components/ShotNodeInspector.vue'),
      'utf8'
    )
    expect(inspectorCode).toContain("viewId: 'screenplay.workbench'")
    expect(inspectorCode).toContain('openScreenplayWorkbench')
  })

  it('剧本生成含2集时 out-all 自动展开为 2 条剧集并支持 text.select 按集选取', async () => {
    const twoEpText = [
      '【人物小传】',
      '- 林晚（24岁，女）：天才设计师。',
      '',
      '## 第1集：雨夜惊变',
      '第1场 【内景 · 拍卖厅 - 夜】',
      '△ 聚光灯照亮展台。',
      '林晚：这是第一集。',
      '',
      '## 第2集：真相水落石出',
      '第1场 【内景 · 鉴定室 - 夜】',
      '△ 紫外灯缓缓亮起。',
      '林晚：这是第二集。'
    ].join('\n')

    const explicit = splitScreenplayByExplicitEpisodeMarkers(twoEpText)
    expect(explicit).toHaveLength(2)
    expect(explicit[0]!.title).toBe('第1集：雨夜惊变')
    expect(explicit[1]!.title).toBe('第2集：真相水落石出')

    // 单集多场次不应被显式分集标记误拆
    const singleEpTwoScenes = [
      '第1场 【内景 · 咖啡厅 - 日】',
      '△ 陽光洒在桌面。',
      '第2场 【外景 · 街道 - 夜】',
      '△ 霓虹闪烁。'
    ].join('\n')
    expect(splitScreenplayByExplicitEpisodeMarkers(singleEpTwoScenes)).toHaveLength(0)

    // 1. 剧本生成节点生成 2 集剧本时自动拆入 generatedTexts 与 out-all
    const spNode = createNodeFromType('asset.screenplay', { x: 0, y: 0 }, { id: 'sp-2ep' })
    const savedFiles: Record<string, string> = {}
    const spResult = await executeScreenplayGenerateNode({
      node: spNode,
      document: { nodes: [spNode], edges: [] },
      inputs: {},
      generateText: async () => ({ text: twoEpText, model: 'mock' }),
      saveRunText: async ({ key, content }) => {
        const rel = `Texts/${key}.txt`
        savedFiles[rel] = content
        return rel
      }
    } as unknown as NodeExecuteContext)

    expect(spNode.params.generatedTexts).toHaveLength(2)
    expect(spNode.params.generatedTexts?.[0]?.title).toBe('第1集：雨夜惊变')
    expect(spNode.params.generatedTexts?.[1]?.title).toBe('第2集：真相水落石出')

    const outAll = spResult['out-all']
    expect(outAll?.kind).toBe('texts')
    if (outAll?.kind === 'texts') {
      expect(outAll.items).toHaveLength(2)
    }

    // 2. 即使旧节点仅存了 1 条未拆分的 2 集剧本，resolveGalleryOutputsFromNodeParams 与 executeSelectTextNode 也能识别出 2 集并选出第 2 集
    const legacyOutputs = resolveGalleryOutputsFromNodeParams(
      {
        text: twoEpText,
        generatedTexts: [{ id: 'legacy-1', text: '', relativePath: 'Texts/legacy.txt' }]
      },
      { typeId: 'asset.screenplay' }
    )
    expect(legacyOutputs?.['out-all']).toMatchObject({
      kind: 'texts',
      items: [
        { id: 'legacy-1:ep:1', title: '第1集：雨夜惊变' },
        { id: 'legacy-1:ep:2', title: '第2集：真相水落石出' }
      ]
    })

    const selectNode = createNodeFromType('text.select', { x: 200, y: 0 }, { id: 'sel-ep2' })
    selectNode.params.selectedTextId = 'legacy-1:ep:2'
    const selectOut = await executeSelectTextNode({
      node: selectNode,
      document: { nodes: [selectNode], edges: [] },
      inputs: {
        in: [
          {
            kind: 'texts',
            items: [{ id: 'legacy-1', text: '', relativePath: 'Texts/legacy.txt' }]
          }
        ]
      },
      readRunText: async () => twoEpText
    } as unknown as NodeExecuteContext)

    expect(selectOut.out).toMatchObject({
      kind: 'text'
    })
    if (selectOut.out?.kind === 'text') {
      expect(selectOut.out.text).toContain('这是第二集')
      expect(selectOut.out.text).not.toContain('这是第一集')
    }

    // 3. 符号化分集选择器 selectedTextId = "ep:1" / "ep:2" 能直接命中 asset.screenplay out-all 产出的 gen-text:<stamp>:1 / :2，且保持 selectedTextId 不变
    const ep2Node = createNodeFromType('text.select', { x: 200, y: 120 }, { id: 'sel-sym-ep2' })
    ep2Node.params.selectedTextId = 'ep:2'
    const ep2Out = await executeSelectTextNode({
      node: ep2Node,
      document: { nodes: [ep2Node], edges: [] },
      inputs: {
        in: [outAll!]
      },
      readRunText: async (relPath: string) => savedFiles[relPath] ?? ''
    } as unknown as NodeExecuteContext)
    expect(ep2Node.params.selectedTextId).toBe('ep:2')
    expect(ep2Out.out?.kind).toBe('text')
    if (ep2Out.out?.kind === 'text') {
      expect(ep2Out.out.text).toContain('这是第二集')
      expect(ep2Out.out.text).not.toContain('这是第一集')
    }
  })
})
