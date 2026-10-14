import { describe, expect, it } from 'vitest'
import { QuickJsScriptSandbox } from '../src/shared/graph/execute/scriptSandboxQuickjs'
import type { ScriptHostCall } from '../src/shared/graph/execute/scriptSandbox'

const sandbox = new QuickJsScriptSandbox()

function run(
  code: string,
  opts: {
    inputs?: unknown
    allowed?: string[]
    hostCall?: (c: ScriptHostCall) => Promise<unknown>
    timeoutMs?: number
    memoryMb?: number
    signal?: AbortSignal
  } = {}
) {
  return sandbox.run({
    code,
    inputs: opts.inputs ?? {},
    allowedHostCalls: opts.allowed ?? [],
    limits: { timeoutMs: opts.timeoutMs ?? 5000, memoryMb: opts.memoryMb ?? 64 },
    hostCall: opts.hostCall ?? (async () => null),
    ...(opts.signal ? { signal: opts.signal } : {})
  })
}

describe('脚本沙箱：基本执行', () => {
  it('读 inputs、返回 outputs', async () => {
    const r = await run(
      `export default async function ({ inputs }) {
        return { out: { kind: 'text', text: inputs.in[0].text.toUpperCase() } }
      }`,
      { inputs: { in: [{ kind: 'text', text: 'hi' }] } }
    )
    expect(r).toEqual({ ok: true, outputs: { out: { kind: 'text', text: 'HI' } } })
  })

  it('await 宿主能力（om.*）并拿到结果', async () => {
    const calls: ScriptHostCall[] = []
    const r = await run(
      `export default async function ({ inputs, om }) {
        const img = await om.generateImage({ prompt: inputs.in[0].text })
        return { out: { kind: 'image', dataUrl: img.images[0] } }
      }`,
      {
        inputs: { in: [{ kind: 'text', text: 'a cat' }] },
        allowed: ['generateImage'],
        hostCall: async (c) => {
          calls.push(c)
          return { images: ['data:image/png;base64,XXX'] }
        }
      }
    )
    expect(r).toEqual({
      ok: true,
      outputs: { out: { kind: 'image', dataUrl: 'data:image/png;base64,XXX' } }
    })
    expect(calls).toEqual([{ name: 'generateImage', args: { prompt: 'a cat' } }])
  })

  it('返回值不是对象 → 报错', async () => {
    const r = await run(`export default async function () { return 42 }`)
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.error).toMatch(/object/)
  })

  it('没有 export default → 报错', async () => {
    const r = await run(`const x = 1`)
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.error).toMatch(/default/)
  })

  it('脚本内抛错 → 作为失败返回，不冒泡', async () => {
    const r = await run(`export default async function () { throw new Error('boom') }`)
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.error).toMatch(/boom/)
  })
})

describe('脚本沙箱：能力白名单', () => {
  it('只有声明过的能力才在 om 上', async () => {
    const r = await run(
      `export default async function ({ om }) {
        return { out: { has: typeof om.generateImage, missing: typeof om.generateVideo } }
      }`,
      { allowed: ['generateImage'] }
    )
    expect(r).toEqual({ ok: true, outputs: { out: { has: 'function', missing: 'undefined' } } })
  })

  it('调用未声明的能力 → 脚本内 TypeError', async () => {
    const r = await run(
      `export default async function ({ om }) { return { out: await om.generateVideo({}) } }`,
      { allowed: [] }
    )
    expect(r.ok).toBe(false)
  })
})

describe('脚本沙箱：隔离（逃逸尝试全部拿不到宿主）', () => {
  it.each([
    ['require', `typeof require`],
    ['process', `typeof process`],
    ['fetch', `typeof fetch`],
    ['globalThis.process', `typeof (globalThis.process)`],
    [
      'Function constructor to global',
      `(function(){ try { return typeof (new Function('return this')()).process } catch(e){ return 'blocked' } })()`
    ]
  ])('%s 不可达', async (_label, expr) => {
    const r = await run(`export default async function () { return { out: ${expr} } }`)
    expect(r.ok).toBe(true)
    // 要么 undefined（没有该全局），要么 constructor 路径拿到的 this 上也没有 process
    const out = r.ok && (r.outputs.out as unknown)
    expect(out === 'undefined' || out === 'blocked' || out === undefined).toBe(true)
  })

  it('宿主回调结果经 JSON 往返，函数 / 原型被剥掉', async () => {
    const r = await run(
      `export default async function ({ om }) {
        const v = await om.log({})
        return { out: { t: typeof v, keys: v && Object.keys(v) } }
      }`,
      {
        allowed: ['log'],
        // 宿主故意返回带函数的对象；JSON 往返后函数应消失
        hostCall: async () => ({ a: 1, fn: () => 1 }) as unknown
      }
    )
    expect(r).toEqual({ ok: true, outputs: { out: { t: 'object', keys: ['a'] } } })
  })
})

describe('脚本沙箱：资源与取消', () => {
  it('死循环被超时中断', async () => {
    const r = await run(`export default async function () { while (true) {} }`, { timeoutMs: 300 })
    expect(r.ok).toBe(false)
  })

  it('超内存被拒', async () => {
    // 内存上限小 + 分配块大：16MB 顶在几十次分配内必然触发。循环**显式有界**（而非
    // while(true)）：16MB / 每块 ~8MB(1e6 个数值) 只需几次就触顶，上限 4096 次是远超触顶
    // 所需的安全阀 —— 这样即便满量并行跑、WASM 线程被饿着，脚本也不会无限自旋把用例拖到超时，
    // 要么因内存被拒、要么因 deadline 被拒，两者都让 r.ok=false（被测行为不变）。
    const r = await run(
      `export default async function () {
        const a = []
        for (let i = 0; i < 4096; i++) { a.push(new Array(1000000).fill(0)) }
        return { out: { kind: 'text', text: 'should not reach' } }
      }`,
      { memoryMb: 16, timeoutMs: 2000 }
    )
    expect(r.ok).toBe(false)
  }, 30000)

  /**
   * 外部取消：对**让出过事件循环**的脚本（有 await）立即生效；对纯同步死循环，WASM 会
   * 占住线程，取消只能在下一个中断检查点生效，因此由 `timeoutMs`（deadline 中断）兜底。
   * 这里用一个会 await 的脚本验证"取消能提前打断"。
   */
  it('外部 signal 取消 → 中断（让出事件循环的脚本立即生效）', async () => {
    const ac = new AbortController()
    setTimeout(() => ac.abort(), 150)
    const r = await run(
      `export default async function ({ om }) {
        for (let i = 0; i < 1000; i++) { await om.wait() }
        return { out: 'never' }
      }`,
      {
        timeoutMs: 10000,
        allowed: ['wait'],
        hostCall: () => new Promise((resolve) => setTimeout(resolve, 20)),
        signal: ac.signal
      }
    )
    expect(r.ok).toBe(false)
  }, 15000)
})
