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
  newAsyncContext,
  shouldInterruptAfterDeadline,
  type QuickJSHandle
} from 'quickjs-emscripten'
import type { ScriptRunRequest, ScriptRunResult, ScriptSandbox } from './scriptSandbox'

/**
 * 把作者代码包成"求值后得到默认导出函数"的表达式。
 *
 * 支持两种写法：`export default async function(...)` 和直接写一个 async 函数体（无 export）。
 * 用一个轻量转换：把 `export default` 去掉改成赋值给内部变量，最后返回它。
 */
function wrapAuthorCode(code: string): string {
  const normalized = code.replace(/export\s+default\s+/, '__om_default__ = ')
  return `(() => {
  let __om_default__ = undefined;
  ${normalized}
  if (typeof __om_default__ !== 'function') {
    throw new Error('script must export default an async function');
  }
  return __om_default__;
})()`
}

export class QuickJsScriptSandbox implements ScriptSandbox {
  async run(request: ScriptRunRequest): Promise<ScriptRunResult> {
    const context = await newAsyncContext()
    const runtime = context.runtime
    const disposables: QuickJSHandle[] = []
    const track = <T extends QuickJSHandle>(h: T): T => {
      disposables.push(h)
      return h
    }
    const abortError = { current: '' }

    try {
      // 内存上限
      runtime.setMemoryLimit(request.limits.memoryMb * 1024 * 1024)
      // 死循环 / 超时中断：deadline 到了 QuickJS 会在下一个检查点抛出中断
      const deadline = Date.now() + request.limits.timeoutMs
      runtime.setInterruptHandler(shouldInterruptAfterDeadline(deadline))
      // 外部取消：标记后让解释器在下一个检查点停下
      const onAbort = (): void => {
        abortError.current = 'aborted'
        runtime.setInterruptHandler(() => true)
      }
      if (request.signal) {
        if (request.signal.aborted) onAbort()
        else request.signal.addEventListener('abort', onAbort, { once: true })
      }

      // ── 注入 om：每个声明过的能力是一个异步宿主函数 ───────────────────────────
      const allowed = new Set(request.allowedHostCalls)
      const omHandle = track(context.newObject())
      for (const name of allowed) {
        const fn = context.newAsyncifiedFunction(name, async (argsHandle) => {
          const args = argsHandle ? context.dump(argsHandle) : undefined
          const result = await request.hostCall({ name, args })
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
      const signalObj = track(context.newObject())
      context.setProp(signalObj, 'aborted', request.signal?.aborted ? context.true : context.false)
      context.setProp(context.global, '__om_signal__', signalObj)

      /**
       * 入口脚本：求值作者代码得到默认导出函数，再 `await` 它。
       *
       * 必须整体走 `evalCodeAsync` —— `om.*` 是 asyncified 宿主函数，`await om.*` 会挂起
       * WASM 栈，只有异步求值路径能恢复它。用同步 `callFunction` + `resolvePromise` 会死等。
       */
      const entry = `(async () => {
        const __fn__ = ${wrapAuthorCode(request.code)};
        return await __fn__({ inputs: __om_inputs__, om: __om_api__, signal: __om_signal__ });
      })()`
      const evalResult = await context.evalCodeAsync(entry, 'script-node.js')
      if (abortError.current) return { ok: false, error: 'script aborted' }
      if (evalResult.error) {
        const msg = context.dump(evalResult.error)
        evalResult.error.dispose()
        return { ok: false, error: `script failed: ${stringifyErr(msg)}` }
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
        if (abortError.current) return { ok: false, error: 'script aborted' }
        const jobs = runtime.executePendingJobs()
        if (jobs.error) {
          jobs.error.dispose()
          break
        }
        // 让出事件循环：等 asyncified 宿主回调（真·异步）落地后再泵下一轮
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
      if (abortError.current) return { ok: false, error: 'script aborted' }
      // settledValue 在 done=true 时必定已赋值
      const settled = settledValue!
      if (settled.error) {
        const msg = context.dump(settled.error)
        settled.error.dispose()
        return { ok: false, error: `script rejected: ${stringifyErr(msg)}` }
      }
      const outputs = context.dump(settled.value)
      settled.value.dispose()
      if (!outputs || typeof outputs !== 'object' || Array.isArray(outputs)) {
        return { ok: false, error: 'script must return an object of { [portId]: GraphValue }' }
      }
      return { ok: true, outputs: outputs as Record<string, unknown> }
    } catch (e) {
      if (abortError.current) return { ok: false, error: 'script aborted' }
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    } finally {
      for (const h of disposables.reverse()) {
        try {
          h.dispose()
        } catch {
          /* already disposed */
        }
      }
      context.dispose()
    }
  }
}

function stringifyErr(value: unknown): string {
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    const name = typeof obj.name === 'string' ? obj.name : 'Error'
    const message = typeof obj.message === 'string' ? obj.message : JSON.stringify(value)
    return `${name}: ${message}`
  }
  return String(value)
}
