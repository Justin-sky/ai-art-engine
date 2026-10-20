/**
 * 脚本节点的沙箱接口（抽象）。
 *
 * 执行器只依赖这个接口，便于单测注入假沙箱；真正的 QuickJS 实现见 `scriptSandboxQuickjs.ts`
 *（它依赖 WASM，放在能加载 WASM 的运行环境里）。
 *
 * 安全边界（实现方必须守住）：
 * - 代码跑在与宿主完全隔离的上下文里，**没有** fs / network / require / process / 宿主全局；
 * - 代码只能通过 `host.<name>(argsJson)` 回调宿主，`name` 必须在 `allowedHostCalls` 白名单内；
 * - 超时 / 内存 / 指令数都有上限，超限中断；外部 `signal` 取消时沙箱停。
 */

export interface ScriptHostCall {
  /** 受控能力名（已过白名单） */
  name: string
  /** 结构化克隆安全的参数（纯 JSON） */
  args: unknown
}

export interface ScriptRunRequest {
  /** 作者代码：`export default async function ({ inputs, om, signal }) {...}` */
  code: string
  /** 注入给代码的 `inputs`（纯 JSON 快照） */
  inputs: unknown
  /** 允许代码调用的宿主能力名白名单（= 节点声明的 capabilities） */
  allowedHostCalls: readonly string[]
  limits: { timeoutMs: number; memoryMb: number }
  /**
   * 宿主回调：代码 `await om.<name>(args)` 时触发。
   * 实现方把结果以**纯 JSON**传回沙箱；抛错则在沙箱里 reject。
   */
  hostCall: (call: ScriptHostCall) => Promise<unknown>
  /** 取消信号：触发时中断沙箱执行 */
  signal?: AbortSignal
}

export interface ScriptLogEntry {
  level: 'info' | 'warn' | 'error'
  message: string
}

export type ScriptRunResult =
  | { ok: true; outputs: Record<string, unknown>; logs?: ScriptLogEntry[] }
  | { ok: false; error: string; logs?: ScriptLogEntry[] }

export interface ScriptSandbox {
  run(request: ScriptRunRequest): Promise<ScriptRunResult>
}
