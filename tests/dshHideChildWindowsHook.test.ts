import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import vm from 'node:vm'
import { describe, expect, it } from 'vitest'
import {
  appendNodeRequireOption,
  HIDE_CHILD_WINDOWS_HOOK_FILENAME,
  HIDE_CHILD_WINDOWS_HOOK_SOURCE,
  toNodeOptionsPath
} from '../src/main/services/dshHideChildWindowsHook'

/**
 * hook 的契约：把 child_process 各启动 API 的 windowsHide 默认置为 true，
 * 且不改变参数形态、返回值与调用方传入的 options 对象。
 * 用 vm 在沙箱里跑源码 + 注入假模块，避免真的起进程。
 */

type FakeChildProcess = Record<string, (...args: unknown[]) => unknown>

function runHookIn(context: vm.Context): Map<string, unknown[][]> {
  vm.runInContext(HIDE_CHILD_WINDOWS_HOOK_SOURCE, context)
  return callsOf(context)
}

/** 沙箱里挂载的假 child_process：记录每次调用的实参 */
function createSandbox(): { context: vm.Context; calls: Map<string, unknown[][]> } {
  const calls = new Map<string, unknown[][]>()
  const fake: FakeChildProcess = {}
  for (const name of [
    'spawn',
    'spawnSync',
    'fork',
    'exec',
    'execFile',
    'execSync',
    'execFileSync'
  ]) {
    fake[name] = (...args: unknown[]) => {
      const list = calls.get(name) ?? []
      list.push(args)
      calls.set(name, list)
      return `${name}-result`
    }
  }
  const context = vm.createContext({
    require: (id: string) => {
      if (id === 'node:child_process') return fake
      throw new Error(`unexpected require: ${id}`)
    },
    fake,
    calls
  })
  return { context, calls }
}

function callsOf(context: vm.Context): Map<string, unknown[][]> {
  return (context as unknown as { calls: Map<string, unknown[][]> }).calls
}

function fakeOf(context: vm.Context): FakeChildProcess {
  return (context as unknown as { fake: FakeChildProcess }).fake
}

function lastCall(calls: Map<string, unknown[][]>, name: string): unknown[] {
  const list = calls.get(name)
  expect(list?.length, `${name} should have been called`).toBeGreaterThan(0)
  return list![list!.length - 1]
}

describe('dsh 隐藏子进程窗口 hook', () => {
  it('spawn(command, args, options)：补 windowsHide 且保留原选项、不改写入参对象', () => {
    const { context, calls } = createSandbox()
    runHookIn(context)
    const options = { cwd: 'C:/work', detached: false }
    const result = fakeOf(context).spawn('git', ['status'], options)

    expect(result).toBe('spawn-result')
    expect(lastCall(calls, 'spawn')).toEqual([
      'git',
      ['status'],
      { cwd: 'C:/work', detached: false, windowsHide: true }
    ])
    // 调用方对象原样：hook 只在副本上补默认值
    expect(options).toEqual({ cwd: 'C:/work', detached: false })
  })

  it('spawn(command, options) 与省略 options 的形态都不破坏参数位', () => {
    const { context, calls } = createSandbox()
    runHookIn(context)

    fakeOf(context).spawn('ffmpeg', { stdio: 'ignore' })
    expect(lastCall(calls, 'spawn')).toEqual(['ffmpeg', { stdio: 'ignore', windowsHide: true }])

    fakeOf(context).spawnSync('taskkill', ['/PID', '1', '/T', '/F'], { stdio: 'ignore' })
    expect(lastCall(calls, 'spawnSync')).toEqual([
      'taskkill',
      ['/PID', '1', '/T', '/F'],
      { stdio: 'ignore', windowsHide: true }
    ])

    fakeOf(context).fork('worker.mjs')
    expect(lastCall(calls, 'fork')).toEqual(['worker.mjs', undefined, { windowsHide: true }])
  })

  it('execFileSync / fork 的 (program, args, options) 同形处理', () => {
    const { context, calls } = createSandbox()
    runHookIn(context)
    fakeOf(context).execFileSync('git', ['log'], { encoding: 'utf8' })
    expect(lastCall(calls, 'execFileSync')).toEqual([
      'git',
      ['log'],
      { encoding: 'utf8', windowsHide: true }
    ])
  })

  it('exec(command, callback)：callback 仍在回调位', () => {
    const { context, calls } = createSandbox()
    runHookIn(context)
    const callback = (): void => {}
    fakeOf(context).exec('whoami', callback)
    const called = lastCall(calls, 'exec')
    expect(called[0]).toBe('whoami')
    expect(called[1]).toEqual({ windowsHide: true })
    expect(called[2]).toBe(callback)
  })

  it('exec(command, options, callback) 与 execSync(command, options)', () => {
    const { context, calls } = createSandbox()
    runHookIn(context)
    const callback = (): void => {}
    fakeOf(context).exec('whoami', { timeout: 100 }, callback)
    expect(lastCall(calls, 'exec')).toEqual([
      'whoami',
      { timeout: 100, windowsHide: true },
      callback
    ])

    fakeOf(context).execSync('whoami', { stdio: 'inherit' })
    expect(lastCall(calls, 'execSync')).toEqual(['whoami', { stdio: 'inherit', windowsHide: true }])
  })

  it('execFile 的全部参数形态都补齐 windowsHide', () => {
    const { context, calls } = createSandbox()
    runHookIn(context)
    const callback = (): void => {}

    fakeOf(context).execFile('git')
    expect(lastCall(calls, 'execFile')).toEqual(['git', undefined, { windowsHide: true }])

    fakeOf(context).execFile('git', ['status'], callback)
    expect(lastCall(calls, 'execFile')).toEqual([
      'git',
      ['status'],
      { windowsHide: true },
      callback
    ])

    fakeOf(context).execFile('git', { cwd: 'C:/work' }, callback)
    expect(lastCall(calls, 'execFile')).toEqual([
      'git',
      undefined,
      { cwd: 'C:/work', windowsHide: true },
      callback
    ])
  })

  it('显式 windowsHide: false 也按目的覆盖为 true', () => {
    const { context, calls } = createSandbox()
    runHookIn(context)
    fakeOf(context).spawn('node', ['-v'], { windowsHide: false })
    expect(lastCall(calls, 'spawn')).toEqual(['node', ['-v'], { windowsHide: true }])
  })

  it('重复预载幂等：同一沙箱再执行一次不会二次包装', () => {
    const { context, calls } = createSandbox()
    runHookIn(context)
    const patchedSpawn = fakeOf(context).spawn
    runHookIn(context)

    expect(fakeOf(context).spawn).toBe(patchedSpawn)
    fakeOf(context).spawn('node', ['-v'])
    expect(calls.get('spawn')).toHaveLength(1)
  })

  it('hook 文件名与源码形态：.cjs 预载、CJS require 取模块', () => {
    expect(HIDE_CHILD_WINDOWS_HOOK_FILENAME.endsWith('.cjs')).toBe(true)
    expect(HIDE_CHILD_WINDOWS_HOOK_SOURCE).toContain("require('node:child_process')")
  })

  it('真实 Node 预载：hook 可被 --require 加载，已打标记且不改变子进程行为', () => {
    const dir = mkdtempSync(join(tmpdir(), 'aiart-hook-'))
    const hookPath = join(dir, HIDE_CHILD_WINDOWS_HOOK_FILENAME)
    writeFileSync(hookPath, HIDE_CHILD_WINDOWS_HOOK_SOURCE, 'utf8')
    const probe = [
      "const cp = require('node:child_process')",
      "const MARK = Symbol.for('aiart.hideChildWindows.patched')",
      "const r = cp.spawnSync(process.execPath, ['-e', 'process.stdout.write(\"ok\")'], { encoding: 'utf8' })",
      'process.stdout.write(JSON.stringify({ patched: cp.spawn[MARK] === true, exec: cp.execFile[MARK] === true, status: r.status, out: (r.stdout || "").trim() }))'
    ].join(';')

    try {
      const res = spawnSync(process.execPath, ['--require', hookPath, '-e', probe], {
        encoding: 'utf8',
        windowsHide: true
      })
      expect(res.status, res.stderr).toBe(0)
      expect(JSON.parse(res.stdout)).toEqual({
        patched: true,
        exec: true,
        status: 0,
        out: 'ok'
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('真实 Node 预载：NODE_OPTIONS 里的 hook（Windows 原生路径）不炸 MODULE_NOT_FOUND', () => {
    // 回归：早前把 `C:\Users\...\hook.cjs` 原样写进 NODE_OPTIONS，Node 分词时吃掉
    // 所有反斜杠 → 子进程启动即 Cannot find module 'C:UsersPSAppData...'（internal/preload）。
    // tmpdir 在 Windows 上就是反斜杠路径，正好覆盖这条链路。
    const dir = mkdtempSync(join(tmpdir(), 'aiart-hook-env-'))
    const hookPath = join(dir, HIDE_CHILD_WINDOWS_HOOK_FILENAME)
    writeFileSync(hookPath, HIDE_CHILD_WINDOWS_HOOK_SOURCE, 'utf8')
    const probe = [
      "const cp = require('node:child_process')",
      "const MARK = Symbol.for('aiart.hideChildWindows.patched')",
      "process.stdout.write(JSON.stringify({ patched: cp.spawn[MARK] === true, exec: cp.exec[MARK] === true }))"
    ].join(';')

    try {
      const res = spawnSync(process.execPath, ['-e', probe], {
        encoding: 'utf8',
        windowsHide: true,
        env: {
          ...process.env,
          NODE_OPTIONS: appendNodeRequireOption(process.env.NODE_OPTIONS, hookPath)
        }
      })
      expect(res.status, res.stderr).toBe(0)
      expect(res.stderr).not.toContain('MODULE_NOT_FOUND')
      expect(JSON.parse(res.stdout)).toEqual({ patched: true, exec: true })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('appendNodeRequireOption', () => {
  it('无既有 NODE_OPTIONS 时只给 --require（路径加双引号防空格拆参）', () => {
    expect(appendNodeRequireOption(undefined, 'C:/Users/a b/hook.cjs')).toBe(
      '--require "C:/Users/a b/hook.cjs"'
    )
    expect(appendNodeRequireOption('   ', 'C:/hook.cjs')).toBe('--require "C:/hook.cjs"')
  })

  it('既有 NODE_OPTIONS 原样保留并追加在后', () => {
    expect(appendNodeRequireOption('--max-old-space-size=4096', 'C:/hook.cjs')).toBe(
      '--max-old-space-size=4096 --require "C:/hook.cjs"'
    )
  })

  it('Windows 原生路径换成正斜杠：Node 分词 NODE_OPTIONS 会把 \\ 当转义符吃掉', () => {
    const native = 'C:\\Users\\PS\\AppData\\Roaming\\aiart-engine\\dsh-harness\\hook.cjs'
    expect(appendNodeRequireOption(undefined, native)).toBe(
      '--require "C:/Users/PS/AppData/Roaming/aiart-engine/dsh-harness/hook.cjs"'
    )
    expect(appendNodeRequireOption('--no-warnings', native)).toBe(
      '--no-warnings --require "C:/Users/PS/AppData/Roaming/aiart-engine/dsh-harness/hook.cjs"'
    )
    // 已经是正斜杠的路径（含 UNC 双斜杠开头）不动
    expect(toNodeOptionsPath('C:/hook.cjs')).toBe('C:/hook.cjs')
    expect(toNodeOptionsPath('\\\\server\\share\\hook.cjs')).toBe('//server/share/hook.cjs')
  })
})
