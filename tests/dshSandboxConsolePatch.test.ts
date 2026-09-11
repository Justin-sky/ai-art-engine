import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  ACL_PATCHED_FLAGS,
  ACL_PATCHED_SHOW_WINDOW,
  ACL_SANDBOX_PACKAGE,
  patchAclConsoleSource,
  patchAclSandboxConsole
} from '../src/main/services/dshSandboxConsolePatch'

/**
 * ACL 沙箱控制台补丁的契约：把沙箱 spawn 的 STARTUPINFO 由 STARTF_USESTDHANDLES（256）
 * 改成 STARTF_USESTDHANDLES | STARTF_USESHOWWINDOW（257）+ wShowWindow = SW_HIDE（0），
 * 从而隐藏「宿主无控制台时受限子进程新建的控制台窗口」；除这两处字面量外不碰任何字节。
 *
 * 真实产物文件（node_modules 里的 dsh 沙箱包）只读不改：仓库依赖树不该被测试改写。
 */

/** 与上游 spawn 模块同形的两处调用点（管道 stdio 与继承 std handle），外加两处不该动的干扰项 */
const FIXTURE = [
  'function spawnSandboxed(api, token, options) {',
  '\tconst startupInfo = allocStartupInfo();',
  '\tencodeStartupInfo(startupInfo, {',
  '\t\tcb: 104,',
  '\t\tdwFlags: 256,',
  '\t\thStdInput: stdIn.read,',
  '\t\thStdOutput: stdOut.write,',
  '\t\thStdError: stdErr.write',
  '\t});',
  '\treturn startupInfo;',
  '}',
  'function spawnSandboxedInherited(api, token, options) {',
  '\tconst startupInfo = allocStartupInfo();',
  '\tencodeStartupInfo(startupInfo, {',
  '\t\tcb: 104,',
  '\t\tdwFlags: 256,',
  '\t\thStdInput: stdIn,',
  '\t\thStdOutput: stdOut,',
  '\t\thStdError: stdErr',
  '\t});',
  '\treturn startupInfo;',
  '}',
  '// 干扰项一：结构体声明里的字段类型（不是数值字面量）',
  'const STARTUPINFOW = koffi.struct("STARTUPINFOW", {',
  '\tdwFlags: "uint32",',
  '\twShowWindow: "uint16"',
  '});',
  '// 干扰项二：另一个 STARTUPINFO 编码点（没有 dwFlags，不该被改写）',
  'const other = allocStartupInfo();',
  'encodeStartupInfo(other, { cb: 104 });'
].join('\n')

/** 真实沙箱产物里那个带内容 hash 的 JS 文件（没装依赖时为 undefined） */
const aclLibDir = join(process.cwd(), 'node_modules', ...ACL_SANDBOX_PACKAGE.split('/'), 'lib')
const aclSourcePath = existsSync(aclLibDir)
  ? (() => {
      const name = readdirSync(aclLibDir).find((entry) => /^types-.*\.js$/.test(entry))
      return name ? join(aclLibDir, name) : undefined
    })()
  : undefined

/** 临时依赖树：<tmp>/node_modules/@deepseek-ai/dsh-sandbox-windows-acl/lib/types-xxx.js */
function makeTempModulesDir(source: string): {
  modulesDir: string
  file: string
  cleanup: () => void
} {
  const root = mkdtempSync(join(tmpdir(), 'aiart-acl-patch-'))
  const modulesDir = join(root, 'node_modules')
  const libDir = join(modulesDir, ...ACL_SANDBOX_PACKAGE.split('/'), 'lib')
  mkdirSync(libDir, { recursive: true })
  const file = join(libDir, 'types-abc123.js')
  writeFileSync(file, source, 'utf8')
  return { modulesDir, file, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

describe('ACL 沙箱控制台补丁（源码改写）', () => {
  it('两处 spawn 调用点都改成 257 + SW_HIDE，且缩进与其余字节原样', () => {
    const { source, sites } = patchAclConsoleSource(FIXTURE)

    expect(sites).toBe(2)
    expect(source).toContain(`\t\tdwFlags: 257,\n\t\t${ACL_PATCHED_SHOW_WINDOW},`)
    expect(source).not.toContain('dwFlags: 256')
    // 往返还原：补丁只做了「256 → 257」与「插入 wShowWindow: 0」两件事
    const restored = source
      .replace(new RegExp(`\\n\\t*${ACL_PATCHED_SHOW_WINDOW},`, 'g'), '')
      .replace(/dwFlags: 257/g, 'dwFlags: 256')
    expect(restored).toBe(FIXTURE)
  })

  it('干扰项不动：结构体字段与没有 dwFlags 的编码点保持原样', () => {
    const { source } = patchAclConsoleSource(FIXTURE)

    expect(source).toContain('\tdwFlags: "uint32",')
    expect(source).toContain('encodeStartupInfo(other, { cb: 104 });')
  })

  it('幂等：已是补丁状态再补一次不改动任何字节', () => {
    const once = patchAclConsoleSource(FIXTURE)
    const twice = patchAclConsoleSource(once.source)

    expect(twice.sites).toBe(0)
    expect(twice.source).toBe(once.source)
  })

  it('没有可改写的调用点（上游换实现）时原样返回', () => {
    const plain =
      'const startupInfo = allocStartupInfo();\nencodeStartupInfo(startupInfo, { cb: 104 });'
    expect(patchAclConsoleSource(plain)).toEqual({ source: plain, sites: 0 })
  })
})

describe('ACL 沙箱控制台补丁（依赖树落盘）', () => {
  it.skipIf(process.platform !== 'win32')('命中沙箱包时写盘，二次调用只报「已补丁」', () => {
    const { modulesDir, file, cleanup } = makeTempModulesDir(FIXTURE)
    try {
      const first = patchAclSandboxConsole(modulesDir)
      expect(first).toEqual({
        present: true,
        patchedFiles: 1,
        patchedSites: 2,
        alreadyFiles: 0,
        failedFiles: 0
      })
      expect(readFileSync(file, 'utf8')).toContain(`dwFlags: 257,`)

      const second = patchAclSandboxConsole(modulesDir)
      expect(second).toEqual({
        present: true,
        patchedFiles: 0,
        patchedSites: 0,
        alreadyFiles: 1,
        failedFiles: 0
      })
    } finally {
      cleanup()
    }
  })

  it.skipIf(process.platform !== 'win32')('依赖树里没有沙箱包时返回未命中，且不抛错', () => {
    const { modulesDir, cleanup } = makeTempModulesDir(FIXTURE)
    try {
      rmSync(join(modulesDir, ...ACL_SANDBOX_PACKAGE.split('/')), { recursive: true, force: true })
      expect(patchAclSandboxConsole(modulesDir)).toEqual({
        present: false,
        patchedFiles: 0,
        patchedSites: 0,
        alreadyFiles: 0,
        failedFiles: 0
      })
    } finally {
      cleanup()
    }
  })
})

describe.skipIf(!aclSourcePath)('ACL 沙箱控制台补丁（真实运行体产物）', () => {
  it('上游产物可被改写两处，改写后仍是合法 ESM 且只动这两处', () => {
    const source = readFileSync(aclSourcePath!, 'utf8')
    const { source: patched, sites } = patchAclConsoleSource(source)

    if (sites === 0) {
      // 该文件可能已被运行时补丁就地改过（在装了依赖的本机跑过应用即如此）：
      // 此时不再有可改写的 256，但产物必须已经是补丁态，否则说明上游换了编码点。
      expect(source).toContain(ACL_PATCHED_FLAGS)
      expect(source).toContain(ACL_PATCHED_SHOW_WINDOW)
      expect(source).not.toContain('dwFlags: 256')
    } else {
      expect(sites).toBe(2)
    }
    expect(patched).not.toContain('dwFlags: 256')
    expect(patched).toContain(ACL_PATCHED_FLAGS)

    // 语法仍然合法（ESM 解析，不解析 import 目标）
    const dir = mkdtempSync(join(tmpdir(), 'aiart-acl-syntax-'))
    const probe = join(dir, 'types-probe.mjs')
    try {
      writeFileSync(probe, patched, 'utf8')
      const res = spawnSync(process.execPath, ['--check', probe], {
        encoding: 'utf8',
        windowsHide: true
      })
      expect(res.status, res.stderr).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('构建期补丁与运行时补丁的口径一致（防漂移）', () => {
  it('bundle-dsh.mjs 使用同一组字面量：匹配 256、写入 257 + wShowWindow: 0', () => {
    const script = readFileSync(join(process.cwd(), 'scripts', 'bundle-dsh.mjs'), 'utf8')

    expect(script).toContain('dwFlags: 256')
    expect(script).toContain(ACL_PATCHED_FLAGS)
    expect(script).toContain(ACL_PATCHED_SHOW_WINDOW)
    // 构建脚本顺带覆盖了运行时补丁模块本身，防止「改了运行时忘了构建期」
    expect(
      readFileSync(join(process.cwd(), 'src/main/services/dshSandboxConsolePatch.ts'), 'utf8')
    ).toContain(ACL_SANDBOX_PACKAGE)
  })
})
