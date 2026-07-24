/** 与 builtins 循环依赖隔离：本模块无重依赖。 */

export const builtinRegistrationState = {
  registered: false
}

let ensureImpl: (() => void) | null = null

/** 由 builtins.ts 在模块加载末尾绑定真正的注册逻辑 */
export function bindEnsureBuiltinNodeTypes(fn: () => void): void {
  ensureImpl = fn
}

/** 惰性确保内置节点类型已注册（可在 builtins 完成绑定后调用） */
export function ensureBuiltinNodeTypes(): void {
  ensureImpl?.()
}
