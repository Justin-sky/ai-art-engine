import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  APPROVAL_MARKER,
  approvalAnswerFileText,
  approvalAnswerForDecision,
  approvalViewOf,
  isAssistantReportingSandboxBlock,
  normalizeApprovalDecision,
  parseApprovalMarker,
  resolvePromptSandboxModeIntent,
  shouldAppendAlwaysAllowOption
} from '../src/shared/dshApproval'

/**
 * dsh 审批应答：**失败即关闭**是这条链路唯一不能出错的性质。
 *
 * ## 为什么值得单独写一组测试
 *
 * 审批请求是 agent 想越过沙箱边界时发出的（`sandbox_permissions`）。dsh 只认
 * `allowed-once` 一种放行，且一次性；其余三种结果（rejected / cancelled / unavailable）
 * 都是「不放行」。因此本模块与应答插件里的**每一个**错误分支都必须落到不放行，
 * 而「忘记处理某个分支」在代码里看起来和「正常」没有区别 —— 只能靠断言把它钉住。
 *
 * ## 两段式验证
 *
 * 1. 纯函数（`@shared/dshApproval`）与应答插件里的判定函数**直接执行**：
 *    这里用假 deps（假时钟 / 假文件系统）驱动插件里那份真实实现，包括超时路径；
 * 2. 源码级守卫钉住主进程的接线（标记字面量两侧一致、回答文件只由一个函数写出）。
 */

const ANSWERER = resolve('src/main/services/aiartApprovalAnswerer.template.mjs')
const HARNESS = readFileSync(resolve('src/main/services/deepseekHarnessService.ts'), 'utf8')

interface AnswererModule {
  resolveApprovalAnswer: (raw: string) => { state: string; outcome?: string }
  approvalMarkerPayload: (
    request: Record<string, unknown>,
    requestId: string,
    answerFile: string
  ) => Record<string, unknown>
  answerApproval: (
    request: Record<string, unknown>,
    requestId: string,
    answerFile: string,
    deps: Record<string, unknown>
  ) => Promise<string>
}

/** 把生成的插件模板当普通模块导入：它只依赖 node 内置模块，没有构建期占位符 */
async function loadAnswerer(): Promise<AnswererModule> {
  return (await import(pathToFileURL(ANSWERER).href)) as unknown as AnswererModule
}

/** 假 deps：假时钟（每次读推进一个步进）+ 假文件系统 + 记账用的 stdout */
function fakeDeps(options: {
  answers?: string[]
  stepMs?: number
  writeMarkerThrows?: boolean
  readAnswerThrows?: boolean
}): {
  deps: Record<string, unknown>
  markers: string[]
  logs: string[]
} {
  const markers: string[] = []
  const logs: string[] = []
  const step = options.stepMs ?? 1_000
  const answers = options.answers ?? []
  let clock = 0
  let reads = 0
  return {
    markers,
    logs,
    deps: {
      now: () => {
        clock += step
        return clock
      },
      sleep: () => Promise.resolve(),
      readAnswer: () => {
        if (options.readAnswerThrows) throw new Error('read failed')
        const value = answers[Math.min(reads, answers.length - 1)]
        reads += 1
        return value ?? ''
      },
      writeMarker: (line: string) => {
        if (options.writeMarkerThrows) throw new Error('stdout closed')
        markers.push(line)
      },
      log: (text: string) => logs.push(text)
    }
  }
}

describe('应答插件的判定：只有亲笔写的 allow-once 才放行', () => {
  it('承认应用写下的两个决定', async () => {
    const answerer = await loadAnswerer()
    expect(answerer.resolveApprovalAnswer('{"decision":"allow-once"}')).toEqual({
      state: 'decided',
      outcome: 'allowed-once'
    })
    expect(answerer.resolveApprovalAnswer('{"decision":"reject"}')).toEqual({
      state: 'decided',
      outcome: 'rejected'
    })
  })

  it('半个 JSON / 空文件 = 还没决定，继续等（不当作任何结果）', async () => {
    const answerer = await loadAnswerer()
    expect(answerer.resolveApprovalAnswer('')).toEqual({ state: 'pending' })
    expect(answerer.resolveApprovalAnswer('{"decision":"allow-')).toEqual({ state: 'pending' })
  })

  it('**读得动但不认识的载荷一律 unavailable，绝不是放行**', async () => {
    const answerer = await loadAnswerer()
    const adversarial = [
      'null',
      'true',
      '[]',
      '"allow-once"',
      '{"decision":"allow"}',
      '{"decision":"allowOnce"}',
      '{"decision":"allowed-once"}',
      '{"decision":true}',
      '{"outcome":"allowed-once"}',
      '{"decision":"ALLOW-ONCE"}',
      '{"decision":{"decision":"allow-once"}}',
      '{"allowed":true}',
      '{"decision":null}'
    ]
    for (const raw of adversarial) {
      const result = answerer.resolveApprovalAnswer(raw)
      expect(result.outcome ?? 'none', raw).not.toBe('allowed-once')
    }
  })

  it('值必须逐字相等：多一个字符就不放行', async () => {
    const answerer = await loadAnswerer()
    expect(answerer.resolveApprovalAnswer('{"decision":"allow-once "}')).toEqual({
      state: 'decided',
      outcome: 'unavailable'
    })
  })
})

describe('answerApproval：每条错误路径都不放行', () => {
  it('用户选「拒绝」→ rejected', async () => {
    const answerer = await loadAnswerer()
    const fake = fakeDeps({ answers: ['{"decision":"reject"}'] })
    const outcome = await answerer.answerApproval(
      {},
      'approval:1',
      '/tmp/x.json',
      fake.deps as never
    )
    expect(outcome).toBe('rejected')
    // 标记行必须先发出去：不告诉用户就永远等不到决定
    expect(fake.markers).toHaveLength(1)
    expect(fake.markers[0]).toContain('===BEGIN_APPROVAL===')
  })

  it('用户选「允许一次」→ allowed-once（唯一放行路径）', async () => {
    const answerer = await loadAnswerer()
    const fake = fakeDeps({ answers: ['{"decision":"allow-once"}'] })
    expect(await answerer.answerApproval({}, 'approval:1', '/tmp/x.json', fake.deps as never)).toBe(
      'allowed-once'
    )
  })

  it('标记送不出去（stdout 坏了）→ unavailable，绝不因为「问不出口」就默认同意', async () => {
    const answerer = await loadAnswerer()
    const fake = fakeDeps({ writeMarkerThrows: true, answers: ['{"decision":"allow-once"}'] })
    expect(await answerer.answerApproval({}, 'approval:1', '/tmp/x.json', fake.deps as never)).toBe(
      'unavailable'
    )
    expect(fake.logs.join('')).toContain('marker delivery failed')
  })

  it('回答文件一直不来（超时）→ unavailable', async () => {
    const answerer = await loadAnswerer()
    // 假时钟每读一次推进 1s，读 400 次必然越过 5 分钟上限
    const fake = fakeDeps({ answers: [''] })
    const outcome = await answerer.answerApproval(
      {},
      'approval:1',
      '/tmp/x.json',
      fake.deps as never
    )
    expect(outcome).toBe('unavailable')
    expect(fake.logs.join('')).toContain('timeout')
  })

  it('载荷读坏（读到不认识的决定）→ unavailable，且**不再继续等**', async () => {
    const answerer = await loadAnswerer()
    const fake = fakeDeps({ answers: ['{"decision":"nope"}', '{"decision":"allow-once"}'] })
    const outcome = await answerer.answerApproval(
      {},
      'approval:1',
      '/tmp/x.json',
      fake.deps as never
    )
    // 坏载荷已经是一次「读到了但认不出」：直接失败即关闭，不给后面的 allow-once 翻盘机会
    expect(outcome).toBe('unavailable')
  })

  it('读文件本身抛错 → unavailable', async () => {
    const answerer = await loadAnswerer()
    const fake = fakeDeps({ readAnswerThrows: true })
    expect(await answerer.answerApproval({}, 'approval:1', '/tmp/x.json', fake.deps as never)).toBe(
      'unavailable'
    )
    expect(fake.logs.join('')).toContain('answerer error')
  })

  it('请求已中止 → cancelled（且不写标记、不等）', async () => {
    const answerer = await loadAnswerer()
    const fake = fakeDeps({ answers: ['{"decision":"allow-once"}'] })
    const outcome = await answerer.answerApproval(
      { signal: { aborted: true } },
      'approval:1',
      '/tmp/x.json',
      fake.deps as never
    )
    expect(outcome).toBe('cancelled')
    expect(fake.markers).toHaveLength(0)
  })

  it('等待期间中止 → cancelled（不再等决定）', async () => {
    const answerer = await loadAnswerer()
    const signal = { aborted: false }
    const fake = fakeDeps({ answers: [''] })
    // 第一次 readAnswer 之前就把请求标记成已中止
    const deps = fake.deps as { readAnswer: (file: string) => string }
    const original = deps.readAnswer
    deps.readAnswer = (file: string) => {
      signal.aborted = true
      return original(file)
    }
    expect(
      await answerer.answerApproval({ signal }, 'approval:1', '/tmp/x.json', fake.deps as never)
    ).toBe('cancelled')
  })
})

describe('标记行载荷', () => {
  it('带上界面需要的字段与回答文件路径，原因原样透传', async () => {
    const answerer = await loadAnswerer()
    const payload = answerer.approvalMarkerPayload(
      {
        toolName: 'pwsh',
        callId: 'call-1',
        reason: 'escalate sandbox to danger-full-access: need to write outside the workspace'
      },
      'approval:7:abc',
      '/tmp/aiart-approval-7-abc.json'
    )
    expect(payload).toEqual({
      requestId: 'approval:7:abc',
      toolName: 'pwsh',
      callId: 'call-1',
      reason: 'escalate sandbox to danger-full-access: need to write outside the workspace',
      answerFile: '/tmp/aiart-approval-7-abc.json'
    })
  })

  it('工具名缺失时给占位，不因为缺字段就把请求丢掉', async () => {
    const answerer = await loadAnswerer()
    const payload = answerer.approvalMarkerPayload({}, 'approval:1', '/tmp/x.json')
    expect(payload.toolName).toBe('tool')
  })
})

describe('主进程侧的解析与写盘（@shared/dshApproval）', () => {
  it('解析合法标记行', () => {
    const line = `${APPROVAL_MARKER}${JSON.stringify({
      requestId: 'approval:1:a',
      toolName: 'write',
      reason: 'escalate sandbox to workspace-write: needs a write',
      answerFile: '/tmp/a.json'
    })}`
    expect(parseApprovalMarker(line)).toEqual({
      requestId: 'approval:1:a',
      toolName: 'write',
      reason: 'escalate sandbox to workspace-write: needs a write',
      answerFile: '/tmp/a.json'
    })
  })

  it('答案文件路径缺失时拒绝 —— 没有回传通道就按不可用收敛', () => {
    expect(parseApprovalMarker(`${APPROVAL_MARKER}{"requestId":"approval:1"}`)).toBeNull()
  })

  it('不是审批标记 / 载荷不是 JSON 时返回 null（坏行不影响其它行）', () => {
    expect(parseApprovalMarker('===BEGIN_TOOL==={"x":1}')).toBeNull()
    expect(parseApprovalMarker(`${APPROVAL_MARKER}not json`)).toBeNull()
    expect(parseApprovalMarker(`${APPROVAL_MARKER}{"requestId":"","answerFile":""}`)).toBeNull()
  })

  it('界面视图**不含**回答文件路径：界面拿不到路径，也就无法伪造放行', () => {
    const view = approvalViewOf({
      requestId: 'approval:1:a',
      toolName: 'pwsh',
      answerFile: '/tmp/a.json'
    })
    expect(view).toEqual({ requestId: 'approval:1:a', toolName: 'pwsh' })
    expect(JSON.stringify(view)).not.toContain('a.json')
  })

  it('决定归一化只认两个字面量，其余一律 null（调用方按拒绝兜底）', () => {
    expect(normalizeApprovalDecision('allow-once')).toBe('allow-once')
    expect(normalizeApprovalDecision('reject')).toBe('reject')
    for (const bad of ['allow', 'allowOnce', true, '', null, undefined, 1, {}, ['allow-once']]) {
      expect(normalizeApprovalDecision(bad), String(bad)).toBeNull()
    }
  })

  it('回答文件正文：只有 allow-once 决定里出现 allow-once', () => {
    expect(JSON.parse(approvalAnswerFileText('allow-once'))).toEqual({ decision: 'allow-once' })
    const reject = approvalAnswerFileText('reject')
    expect(JSON.parse(reject)).toEqual({ decision: 'reject' })
    expect(reject).not.toContain('allow-once')
  })

  it('**写盘内容**（approvalAnswerForDecision）对任何非 allow-once 输入都不放行', () => {
    expect(JSON.parse(approvalAnswerForDecision('allow-once'))).toEqual({ decision: 'allow-once' })
    const adversarial = [
      'reject',
      'allow',
      'allowOnce',
      'allowed-once',
      'ALLOW-ONCE',
      'allow-once ',
      true,
      false,
      null,
      undefined,
      1,
      {},
      [],
      { decision: 'allow-once' },
      { toString: () => 'allow-once' }
    ]
    for (const bad of adversarial) {
      const text = approvalAnswerForDecision(bad)
      expect(JSON.parse(text), JSON.stringify(bad)).toEqual({ decision: 'reject' })
      expect(text, JSON.stringify(bad)).not.toContain('allow-once')
    }
  })
})

describe('真插件接线：fake ctx + 真实文件系统走完一次往返', () => {
  interface PluginModule extends AnswererModule {
    name: string
    apply: (ctx: unknown) => void
  }

  /** 把插件挂到假 ctx 上，返回它注册的 approval/request 监听器 */
  async function mountPlugin(): Promise<{
    plugin: PluginModule
    handle: (request: Record<string, unknown>) => Promise<string>
  }> {
    const plugin = (await import(pathToFileURL(ANSWERER).href)) as unknown as PluginModule
    const handlers: Array<(request: Record<string, unknown>) => Promise<string>> = []
    plugin.apply({
      on: (event: string, handler: (request: Record<string, unknown>) => Promise<string>) => {
        if (event === 'approval/request') handlers.push(handler)
      }
    })
    expect(handlers, 'apply 必须挂上 approval/request').toHaveLength(1)
    return { plugin, handle: handlers[0]! }
  }

  /**
   * 走一次真实往返：假 ctx → 真插件 → 真 stdout 捕获（测试在这里扮演应用，
   * 读到标记行就写下回答文件）→ 真文件系统 → 真结果。
   */
  async function roundTrip(options: {
    answer: 'allow-once' | 'reject' | null
    abort?: boolean
  }): Promise<{ outcome: string; markers: string[] }> {
    const { handle } = await mountPlugin()
    const dir = mkdtempSync(join(tmpdir(), 'aiart-approval-'))
    const previousAskDir = process.env.AIART_ASK_DIR
    process.env.AIART_ASK_DIR = dir
    const markers: string[] = []
    const originalWrite = process.stdout.write
    const controller = new AbortController()
    try {
      // 只替换「同步段」的 stdout：标记行是在第一次 await 之前写出的
      process.stdout.write = ((chunk: unknown) => {
        const text = String(chunk)
        if (text.includes(APPROVAL_MARKER)) {
          markers.push(text)
          const payload = JSON.parse(
            text.slice(text.indexOf(APPROVAL_MARKER) + APPROVAL_MARKER.length).trim()
          ) as { answerFile: string }
          if (options.answer) {
            // 用主进程真正的写盘实现：两侧的字节级格式由这条往返一起钉住
            writeFileSync(payload.answerFile, approvalAnswerForDecision(options.answer), 'utf8')
          }
        }
        return true
      }) as typeof process.stdout.write
      const promise = handle({
        toolName: 'pwsh',
        callId: 'call-9',
        reason: 'escalate sandbox to danger-full-access: needs to write outside the workspace',
        signal: controller.signal
      })
      process.stdout.write = originalWrite
      if (options.abort) controller.abort()
      return { outcome: await promise, markers }
    } finally {
      process.stdout.write = originalWrite
      if (previousAskDir === undefined) delete process.env.AIART_ASK_DIR
      else process.env.AIART_ASK_DIR = previousAskDir
      rmSync(dir, { recursive: true, force: true })
    }
  }

  it('插件名固定（patch 行按 id 引用它）', async () => {
    const { plugin } = await mountPlugin()
    expect(plugin.name).toBe('aiart-approval-answerer')
  })

  it('用户点「拒绝」→ rejected，标记行带工具名与原因', async () => {
    const { outcome, markers } = await roundTrip({ answer: 'reject' })
    expect(outcome).toBe('rejected')
    expect(markers).toHaveLength(1)
    expect(markers[0]).toMatch(/^\n===BEGIN_APPROVAL===\{"requestId":"approval:/)
    const payload = JSON.parse(markers[0]!.slice(APPROVAL_MARKER.length + 1).trim())
    expect(payload.toolName).toBe('pwsh')
    expect(payload.callId).toBe('call-9')
    expect(payload.reason).toContain('escalate sandbox to danger-full-access')
    expect(payload.answerFile).toContain('aiart-approval-')
  })

  it('用户点「允许一次」→ allowed-once（唯一放行）', async () => {
    const { outcome } = await roundTrip({ answer: 'allow-once' })
    expect(outcome).toBe('allowed-once')
  })

  it('**没人回答**且请求被中止 → cancelled，不是放行', async () => {
    const { outcome, markers } = await roundTrip({ answer: null, abort: true })
    expect(markers, '标记行必须先发出去').toHaveLength(1)
    expect(outcome).toBe('cancelled')
  })
})

describe('接线守卫：两侧字面量与 patch 行', () => {
  it('主进程与应答插件用同一个标记字面量', async () => {
    const source = readFileSync(ANSWERER, 'utf8')
    expect(source).toContain(`const APPROVAL_BEGIN = '${APPROVAL_MARKER}'`)
    expect(HARNESS).toContain(`const APPROVAL_BEGIN = '${APPROVAL_MARKER}'`)
    expect(HARNESS).toContain('parseApprovalMarker(line)')
  })

  it('patch 里确实注入了审批应答插件（第二个 insert 行）', () => {
    expect(HARNESS).toContain("'    - id: aiart-approval',")
    expect(HARNESS).toContain('aiart-approval-answerer.mjs')
    // 两份源码都进 hash：改任一份都必须重写 patch，否则磁盘上还是旧插件
    expect(HARNESS).toMatch(/\.update\(runnerSource\)[\s\S]{0,120}\.update\(approvalSource\)/)
  })

  it('挂载审批应答插件动了 dsh 的 approval watermark **但没碰策略**', () => {
    // 策略留 ask：只有 ask 之下应答器才有意义（never 在 waterfall 之前就拒了）
    expect(HARNESS).not.toContain('DSH_PERMISSION_MODE')
  })

  it('放行只从回答文件写出：主进程没有第二条写盘路径', () => {
    // 主进程把「用户意图 → 写盘内容」整段交给纯函数，安全性质在上面被直接执行断言
    expect(HARNESS).toContain('approvalAnswerForDecision(payload?.decision)')
    expect(HARNESS).not.toContain('normalizeApprovalDecision')
  })

  it('本轮结束 / 进程重置时清空待决定表（旧请求不会在新一轮里被点成放行）', () => {
    expect(HARNESS).toMatch(
      /for \(const \[id, entry\] of harnessApprovalRequests\) \{\s*if \(entry\.runId === runIdForRelease\) harnessApprovalRequests\.delete\(id\)/
    )
    expect(HARNESS).toMatch(/harnessApprovalRequests\.clear\(\)/)
  })

  it('思考流未闭合时到达的 APPROVAL_BEGIN 不会被吞进 reasoningBuf，且同 requestId 去重', () => {
    expect(HARNESS).toContain('!isControlMarker && inReasoning')
    expect(HARNESS).toContain('seenApprovalRequestIds.has(payload.requestId)')
    expect(HARNESS).toContain('seenApprovalRequestIds.add(payload.requestId)')
  })
})

describe('用户可选受限模式（workspace-write / danger-full-access）', () => {
  const RUNNER = resolve('src/main/services/aiartHeadlessRunner.template.mjs')
  const CHAT_PANEL = readFileSync(resolve('src/renderer/src/components/ChatPanel.vue'), 'utf8')

  interface RunnerSandboxExports {
    normalizeSandboxMode: (raw?: unknown) => 'workspace-write' | 'danger-full-access'
    applySessionSandboxMode: (
      ctx: { get: (name: string) => unknown },
      agent: { session?: Record<string, unknown> } | undefined,
      sandboxMode: unknown,
      chatMode: string
    ) => void
    modePreamble: (mode: string, sandboxMode?: string) => string
    detectSandboxBlockedResult: (
      eventData: Record<string, unknown> | undefined
    ) => string | undefined
  }

  it('normalizeSandboxMode 默认收敛到受限模式 workspace-write', async () => {
    const mod = (await import(pathToFileURL(RUNNER).href)) as unknown as RunnerSandboxExports
    expect(mod.normalizeSandboxMode(undefined)).toBe('workspace-write')
    expect(mod.normalizeSandboxMode('')).toBe('workspace-write')
    expect(mod.normalizeSandboxMode('invalid')).toBe('workspace-write')
    expect(mod.normalizeSandboxMode('workspace-write')).toBe('workspace-write')
    expect(mod.normalizeSandboxMode('danger-full-access')).toBe('danger-full-access')
  })

  it('applySessionSandboxMode 按用户选择切换会话 permissionPresets，且在 Ask 模式下保持受限', async () => {
    const mod = (await import(pathToFileURL(RUNNER).href)) as unknown as RunnerSandboxExports
    let activePreset = 'workspace-write'
    const calls: string[] = []
    const session = { id: 'session-1' }
    const ctx = {
      get: (serviceName: string) => {
        if (serviceName === 'permissionPresets') {
          return {
            current: () => activePreset,
            set: (_s: unknown, target: string) => {
              activePreset = target
              calls.push(target)
            }
          }
        }
        return undefined
      }
    }

    // 默认受限模式与初始状态一致：不重复追加事件
    mod.applySessionSandboxMode(ctx, { session }, 'workspace-write', 'craft')
    expect(calls).toEqual([])
    expect(activePreset).toBe('workspace-write')

    // 用户关闭受限模式（Craft / Plan）：切换为 danger-full-access
    mod.applySessionSandboxMode(ctx, { session }, 'danger-full-access', 'craft')
    expect(activePreset).toBe('danger-full-access')
    expect(calls).toEqual(['danger-full-access'])

    // Ask 模式不允许放开沙箱，自动收敛回 workspace-write
    mod.applySessionSandboxMode(ctx, { session }, 'danger-full-access', 'ask')
    expect(activePreset).toBe('workspace-write')
    expect(calls).toEqual(['danger-full-access', 'workspace-write'])

    // Plan 模式关闭受限模式同样生效，随后用户重开受限模式可切回 workspace-write
    mod.applySessionSandboxMode(ctx, { session }, 'danger-full-access', 'plan')
    expect(activePreset).toBe('danger-full-access')
    mod.applySessionSandboxMode(ctx, { session }, 'workspace-write', 'craft')
    expect(activePreset).toBe('workspace-write')
  })

  it('modePreamble 在关闭受限模式时明确告知模型本地完全访问已启用', async () => {
    const mod = (await import(pathToFileURL(RUNNER).href)) as unknown as RunnerSandboxExports
    expect(mod.modePreamble('craft', 'workspace-write')).not.toContain('danger-full-access')
    expect(mod.modePreamble('craft', 'danger-full-access')).toContain('danger-full-access')
    expect(mod.modePreamble('ask', 'danger-full-access')).not.toContain('danger-full-access')
  })

  it('前端工具栏持久化受限模式开关并透传 sandboxMode 到主进程', () => {
    expect(CHAT_PANEL).toContain(
      "const CHAT_SANDBOX_RESTRICTED_KEY = 'studio.chat.sandboxRestricted'"
    )
    expect(CHAT_PANEL).toContain(
      "sandboxMode: sandboxRestricted.value ? 'workspace-write' : 'danger-full-access'"
    )
    expect(HARNESS).toContain('sandboxMode = normalizeSandboxMode(input.sandboxMode)')
  })

  it('approvalMarkerPayload 兼容 dsh-sandbox 传入的 { zh, en } 多语言 displayReason 对象', async () => {
    const mod = await loadAnswerer()
    const payload = mod.approvalMarkerPayload(
      {
        toolName: 'pwsh',
        reason: 'escalate sandbox to danger-full-access',
        displayReason: { zh: '启动 IDA 逆向分析脚本', en: 'Run IDA script' }
      },
      'req-zh-1',
      '/tmp/ans.json'
    )
    expect(payload.displayReason).toBe('启动 IDA 逆向分析脚本')
  })

  it('detectSandboxBlockedResult 精准识别沙箱受阻结果并排除用户主动拒绝与普通错误', async () => {
    const mod = (await import(pathToFileURL(RUNNER).href)) as unknown as RunnerSandboxExports
    expect(
      mod.detectSandboxBlockedResult({
        message: {
          content: [
            { type: 'text', text: '[sandbox: file access denied under workspace-write mode]' }
          ]
        }
      })
    ).toBe('[sandbox: file access denied under workspace-write mode]')

    expect(
      mod.detectSandboxBlockedResult({
        message: {
          content: [
            {
              type: 'text',
              text: 'actions that require approval are rejected automatically under current policy'
            }
          ]
        }
      })
    ).toContain('actions that require approval are rejected automatically')

    // 用户主动点「拒绝」不应再弹二次提示卡
    expect(
      mod.detectSandboxBlockedResult({
        message: {
          content: [{ type: 'text', text: 'the user rejected escalating sandbox permissions' }]
        }
      })
    ).toBeUndefined()

    // 普通业务报错不应误判为沙箱拦截
    expect(
      mod.detectSandboxBlockedResult({
        message: {
          content: [{ type: 'text', text: 'ENOENT: no such file or directory' }]
        }
      })
    ).toBeUndefined()
  })

  it('isAssistantReportingSandboxBlock 识别 IDA 255 / 提权通道不可用等诊断汇报且不误伤普通说明', () => {
    expect(
      isAssistantReportingSandboxBlock(
        '受限模式下 IDA 确实起不来（255），而提权通道现在不可用。换一条不需要提权的路：Ghidra。'
      )
    ).toBe(true)
    expect(
      isAssistantReportingSandboxBlock(
        '沙箱提权通道现在不可用。但回头看，我之前从没在受限模式下用正确的 -S 顺序测过。'
      )
    ).toBe(true)
    expect(
      isAssistantReportingSandboxBlock(
        '在受限模式下，AI 默认只能写入当前项目工作区目录，外部目录操作需要单次审批。'
      )
    ).toBe(false)
  })

  it('resolvePromptSandboxModeIntent 与 shouldAppendAlwaysAllowOption 支持「总是允许」并按工程持久化自动放行', () => {
    expect(
      resolvePromptSandboxModeIntent('当前受限模式受阻，是否开启完全访问？', '开启完全访问')
    ).toBe('danger-full-access')
    expect(
      resolvePromptSandboxModeIntent('运行外部 IDA 脚本需要授权，是否允许？', '总是允许')
    ).toBe('danger-full-access')
    expect(resolvePromptSandboxModeIntent('Switch sandbox mode?', 'Always allow')).toBe(
      'danger-full-access'
    )
    expect(
      resolvePromptSandboxModeIntent('当前受限模式受阻，是否开启完全访问？', '保持受限模式')
    ).toBeNull()
    expect(resolvePromptSandboxModeIntent('请选择导出分辨率', '1920x1080')).toBeNull()

    expect(
      shouldAppendAlwaysAllowOption('运行外部 IDA 脚本需要授权，是否允许？', ['允许', '拒绝'])
    ).toBe(true)
    expect(shouldAppendAlwaysAllowOption('权限确认', ['允许一次', '拒绝'])).toBe(true)
    expect(shouldAppendAlwaysAllowOption('请选择导出分辨率', ['1080p', '4K'])).toBe(false)
    expect(
      shouldAppendAlwaysAllowOption('运行外部工具需要授权', ['允许一次', '总是允许', '拒绝'])
    ).toBe(false)
  })

  it('用户在受阻提示卡或审批卡选择「总是允许」后，按工程持久化放行并同步切换下方沙箱按钮', () => {
    expect(CHAT_PANEL).toContain(
      "const CHAT_PROJECT_SANDBOX_MAP_KEY = 'studio.chat.projectSandboxRestricted.v1'"
    )
    expect(CHAT_PANEL).toContain('function setSandboxRestrictedMode(')
    expect(CHAT_PANEL).toContain('approvalAllowAlways')
    expect(CHAT_PANEL).toContain("if (!sandboxRestricted.value && mode.value !== 'ask')")
    expect(CHAT_PANEL).toContain('.setHarnessSandboxMode({')
    expect(CHAT_PANEL).toContain('enableFullAccessForApproval')
    expect(CHAT_PANEL).toContain('decideSandboxBlockedPrompt')
    expect(HARNESS).toContain('export function setHarnessSandboxMode(')
    expect(HARNESS).toContain("op: 'set_sandbox_mode'")
    expect(HARNESS).toContain("const SANDBOX_BLOCKED_BEGIN = '===BEGIN_SANDBOX_BLOCKED==='")
  })
})
