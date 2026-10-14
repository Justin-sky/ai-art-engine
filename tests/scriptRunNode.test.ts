import { describe, expect, it, vi } from 'vitest'
import { createScriptRunNodeExecutor } from '../src/shared/graph/execute/scriptRun'
import type { ScriptRunRequest, ScriptSandbox } from '../src/shared/graph/execute/scriptSandbox'
import type { NodeExecuteContext } from '../src/shared/graph/execute/types'
import {
  readScriptNodeParams,
  scriptNodeDefaultParams,
  scriptNodePorts,
  validateScriptNodeParams,
  SCRIPT_MAX_LIMITS
} from '../src/shared/graph/scriptNode'

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
})
