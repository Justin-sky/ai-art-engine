/**
 * QuickJS（WASM）实现的脚本沙箱。
 *
 * 为什么是 QuickJS 而不是 `node:vm`：`vm` 不是安全边界（能经原型链 / constructor 逃逸）。
 * QuickJS 是独立 WASM 引擎，和宿主 JS 堆完全隔离 —— 里面没有 fs / network / require / process /
 * 任何宿主全局，宿主只能通过**显式注入的函数**与它通信。再叠加超时（deadline 中断）+ 内存上限。
 *
 * 代码契约：作者写 `export default async function ({ inputs, om, signal }) { ... return {...} }`。
 * 这里把它包成一个表达式求值，拿到那个 async 函数并调用，`om.<name>` 转成对宿主的异步回调。
 */
import {
  newQuickJSAsyncWASMModuleFromVariant,
  shouldInterruptAfterDeadline,
  type QuickJSAsyncWASMModule,
  type QuickJSHandle
} from 'quickjs-emscripten-core'
// single-file variant：WASM 以 base64 **内联进 JS**，运行时不再 fetch 独立 .wasm —— Electron
// 打包 / 渲染进程里相对 URL fetch 不到真实文件（会被 index.html 兜底），正是之前
// "expected magic word 00 61 73 6d, found 3c 21 64 6f（<!do）" 报错的根因。asyncify 变体
// 保留从 WASM 同步调用宿主异步函数的能力（om.* 需要）。
import releaseAsyncifyVariant from '@jitl/quickjs-singlefile-browser-release-asyncify'
import type {
  ScriptLogEntry,
  ScriptRunRequest,
  ScriptRunResult,
  ScriptSandbox
} from './scriptSandbox'

const MAX_SCRIPT_LOGS = 200
const MAX_LOG_MESSAGE_CHARS = 4000

/** 构建一次 WASM 模块后缓存：实例化 WASM 不便宜，每次 run 复用同一模块、只新建隔离 context */
let modulePromise: Promise<QuickJSAsyncWASMModule> | null = null
function getQuickJsModule(): Promise<QuickJSAsyncWASMModule> {
  if (!modulePromise) {
    modulePromise = newQuickJSAsyncWASMModuleFromVariant(releaseAsyncifyVariant)
  }
  return modulePromise
}

function resetQuickJsModule(): void {
  modulePromise = null
}

/**
 * 把作者代码包成"求值后得到默认导出函数"的入口脚本。
 *
 * 注意：前言固定占第 1 行，作者代码从第 2 行开始，这样报错栈里的 `script-node.js:L`
 * 减 1 就精确对应 Monaco 编辑器里的真实行号。
 */
function buildEntryScript(code: string): string {
  const normalized = code.replace(/export\s+default\s+/, '__om_default__ = ')
  return `(async () => { const __fmt = (v) => typeof v === 'string' ? v : (v instanceof Error ? (v.stack || (v.name + ': ' + v.message)) : (() => { try { return JSON.stringify(v); } catch { return String(v); } })()); globalThis.console = { log: (...a) => __om_console__('info', a.map(__fmt).join(' ')), info: (...a) => __om_console__('info', a.map(__fmt).join(' ')), warn: (...a) => __om_console__('warn', a.map(__fmt).join(' ')), error: (...a) => __om_console__('error', a.map(__fmt).join(' ')) }; const __fn__ = (() => { let __om_default__ = undefined;\n${normalized}\nif (typeof __om_default__ !== 'function') { throw new Error('script must export default an async function'); } return __om_default__; })(); return await __fn__({ inputs: __om_inputs__, om: __om_api__, signal: __om_signal__ }); })()`
}

export class QuickJsScriptSandbox implements ScriptSandbox {
  async run(request: ScriptRunRequest): Promise<ScriptRunResult> {
    let module = await getQuickJsModule()
    let context: ReturnType<QuickJSAsyncWASMModule['newContext']>
    try {
      context = module.newContext()
    } catch {
      resetQuickJsModule()
      module = await getQuickJsModule()
      context = module.newContext()
    }
    const runtime = context.runtime
    const disposables: QuickJSHandle[] = []
    const track = <T extends QuickJSHandle>(h: T): T => {
      disposables.push(h)
      return h
    }
    const abortError = { current: '' }
    const logs: ScriptLogEntry[] = []
    const withLogs = <T extends ScriptRunResult>(res: T): T =>
      logs.length ? ({ ...res, logs } as T) : res
    const codeLineCount = request.code.split('\n').length
    let suspendedHostCalls = 0
    let finishedCleanly = false

    try {
      // 内存上限
      runtime.setMemoryLimit(request.limits.memoryMb * 1024 * 1024)
      // 死循环 / 超时中断：deadline 到了 QuickJS 会在下一个检查点抛出中断。
      // 注意：
      // 1) await om.* 等待宿主 I/O 期间不计入 CPU 超时，回调完成后顺延 deadline；
      // 2) 当 suspendedHostCalls > 0（Asyncify 正在挂起或回卷 C 栈）时绝不能返回 true，
      //    否则 QuickJS 会在 suspended function 中抛错并破坏 WASM Asyncify 栈。
      let deadline = Date.now() + request.limits.timeoutMs
      runtime.setInterruptHandler(() => {
        if (suspendedHostCalls > 0) return false
        if (abortError.current) return true
        return shouldInterruptAfterDeadline(deadline)(runtime)
      })

      const signalObj = track(context.newObject())
      context.setProp(signalObj, 'aborted', request.signal?.aborted ? context.true : context.false)

      let resolveAbortRace: (() => void) | null = null
      const abortRacePromise = new Promise<'__aborted__'>((resolve) => {
        resolveAbortRace = () => resolve('__aborted__')
      })

      // 外部取消：标记后唤醒挂起的宿主回调，让 Asyncify 正常回卷栈并在下一个检查点停下
      const onAbort = (): void => {
        abortError.current = 'aborted'
        resolveAbortRace?.()
      }
      if (request.signal) {
        if (request.signal.aborted) onAbort()
        else request.signal.addEventListener('abort', onAbort, { once: true })
      }

      // ── 注入 console 收集钩子：仅接收纯字符串，不暴露宿主对象 ─────────────────
      const consoleFn = track(
        context.newFunction('__om_console__', (levelHandle, msgHandle) => {
          if (logs.length >= MAX_SCRIPT_LOGS) return
          const rawLevel = levelHandle ? String(context.dump(levelHandle) ?? 'info') : 'info'
          const level: 'info' | 'warn' | 'error' =
            rawLevel === 'warn' || rawLevel === 'error' ? rawLevel : 'info'
          const message = msgHandle
            ? String(context.dump(msgHandle) ?? '').slice(0, MAX_LOG_MESSAGE_CHARS)
            : ''
          logs.push({ level, message })
        })
      )
      context.setProp(context.global, '__om_console__', consoleFn)

      // ── 注入 om：每个声明过的能力是一个异步宿主函数 ───────────────────────────
      const allowed = new Set(request.allowedHostCalls)
      const omHandle = track(context.newObject())
      for (const name of allowed) {
        const fn = context.newAsyncifiedFunction(name, async (argsHandle) => {
          if (abortError.current) return context.undefined
          const args = argsHandle ? context.dump(argsHandle) : undefined
          const hostStart = Date.now()
          suspendedHostCalls += 1
          let result: unknown
          try {
            result = await Promise.race([request.hostCall({ name, args }), abortRacePromise])
          } finally {
            suspendedHostCalls -= 1
            // 宿主异步调用（如 AI 生图/生视频耗时数秒至数十秒）不计入脚本 CPU 超时配额
            deadline += Math.max(0, Date.now() - hostStart)
          }
          if (abortError.current || result === '__aborted__') {
            return context.undefined
          }
          // 回传纯 JSON：经 JSON 往返再进沙箱，杜绝把宿主对象泄漏进去
          const json = JSON.stringify(result ?? null)
          const parsed = context.unwrapResult(context.evalCode(`(${json})`))
          return parsed
        })
        track(fn)
        context.setProp(omHandle, name, fn)
      }

      // 注入 inputs（纯 JSON）
      const inputsJson = JSON.stringify(request.inputs ?? {})
      const inputsHandle = track(context.unwrapResult(context.evalCode(`(${inputsJson})`)))

      // 把 inputs / om / signal 挂到全局，供下面的入口脚本引用
      context.setProp(context.global, '__om_inputs__', inputsHandle)
      context.setProp(context.global, '__om_api__', omHandle)
      context.setProp(context.global, '__om_signal__', signalObj)

      /**
       * 入口脚本：求值作者代码得到默认导出函数，再 `await` 它。
       *
       * 必须整体走 `evalCodeAsync` —— `om.*` 是 asyncified 宿主函数，`await om.*` 会挂起
       * WASM 栈，只有异步求值路径能恢复它。用同步 `callFunction` + `resolvePromise` 会死等。
       */
      const entry = buildEntryScript(request.code)
      const evalResult = await context.evalCodeAsync(entry, 'script-node.js')
      if (abortError.current) return withLogs({ ok: false, error: 'script aborted' })
      if (evalResult.error) {
        const msg = context.dump(evalResult.error)
        evalResult.error.dispose()
        return withLogs({ ok: false, error: `script failed: ${stringifyErr(msg, codeLineCount)}` })
      }
      const promiseHandle = track(evalResult.value)
      /**
       * 驱动求值：`resolvePromise` 给的是宿主侧 Promise，只有把 QuickJS 的待执行作业
       * 泵完它才会 settle。asyncified 的 `om.*` 回调完成后会往作业队列塞续作业，
       * 所以这里循环泵作业，直到宿主 Promise settle（或超时 / 取消中断泵循环）。
       */
      let done = false
      let settledValue: Awaited<ReturnType<typeof context.resolvePromise>> | null = null
      // 取消 / 超时时这个 Promise 可能永不 settle；吞掉它的结局，避免未处理 rejection 噪音
      context.resolvePromise(promiseHandle).then(
        (r) => {
          settledValue = r
          done = true
        },
        () => {
          done = true
        }
      )
      while (!done) {
        if (abortError.current && suspendedHostCalls === 0) {
          return withLogs({ ok: false, error: 'script aborted' })
        }
        if (suspendedHostCalls === 0) {
          const jobs = runtime.executePendingJobs()
          if (jobs.error) {
            jobs.error.dispose()
            break
          }
        }
        // 让出事件循环：等 asyncified 宿主回调（真·异步）落地后再泵下一轮
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
      if (abortError.current) return withLogs({ ok: false, error: 'script aborted' })
      // settledValue 在 done=true 时必定已赋值
      const settled = settledValue!
      if (settled.error) {
        const msg = context.dump(settled.error)
        settled.error.dispose()
        return withLogs({
          ok: false,
          error: `script rejected: ${stringifyErr(msg, codeLineCount)}`
        })
      }
      const outputs = context.dump(settled.value)
      settled.value.dispose()
      finishedCleanly = true
      if (!outputs || typeof outputs !== 'object' || Array.isArray(outputs)) {
        return withLogs({
          ok: false,
          error: 'script must return an object of { [portId]: GraphValue }'
        })
      }
      return withLogs({ ok: true, outputs: outputs as Record<string, unknown> })
    } catch (e) {
      resetQuickJsModule()
      if (abortError.current) return withLogs({ ok: false, error: 'script aborted' })
      return withLogs({ ok: false, error: e instanceof Error ? e.message : String(e) })
    } finally {
      if (!finishedCleanly) {
        // 超时中断 / OOM / 外部取消可能使当前 WASM 实例的线性内存或 Asyncify 栈处于脏状态，
        // 丢弃缓存模块让下一次执行拉起干净的 WASM 实例。
        resetQuickJsModule()
      }
      for (const h of disposables.reverse()) {
        try {
          h.dispose()
        } catch {
          /* already disposed */
        }
      }
      try {
        context.dispose()
      } catch {
        /* ignore dispose errors on aborted/OOM runtime */
      }
    }
  }
}

function stringifyErr(value: unknown, codeLineCount: number): string {
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    const name = typeof obj.name === 'string' ? obj.name : 'Error'
    const message = typeof obj.message === 'string' ? obj.message : JSON.stringify(value)
    const stack = typeof obj.stack === 'string' ? obj.stack : ''
    const locMatch = stack.match(/script-node\.js:(\d+)(?::(\d+))?/)
    if (locMatch) {
      const rawLine = Number(locMatch[1])
      const userLine = rawLine - 1
      if (userLine >= 1 && userLine <= codeLineCount) {
        const col = locMatch[2] ? `:${locMatch[2]}` : ''
        return `${name}: ${message} (line ${userLine}${col})`
      }
    }
    return `${name}: ${message}`
  }
  return String(value)
}
