/**
 * ACL 沙箱子进程的「隐藏控制台窗口」运行时补丁（仅 Windows 生效）。
 *
 * 背景：dsh 的 Windows 沙箱（`@deepseek-ai/dsh-sandbox-windows-acl`）用受限令牌 +
 * `CreateProcessAsUserW` 拉起子进程，并且**刻意不用** `CREATE_NO_WINDOW` /
 * `CREATE_NEW_CONSOLE`——上游 spawn 模块的注释记录：受限令牌下带控制台隔离的子进程会在
 * DLL 初始化阶段以 `STATUS_DLL_INIT_FAILED`（0xC0000142）死掉，实测如此。它只传
 * `STARTF_USESTDHANDLES`，并假定「子进程共享宿主控制台」。
 *
 * 而本应用是 GUI 进程，dsh 自身也没有控制台（见 dshHideChildWindowsHook：所有
 * child_process spawn 都补了 windowsHide），受限子进程因此只能**新建**一个控制台——
 * 用户看到的就是每条沙箱命令弹一次黑窗（dshHideChildWindowsHook 只能管住非沙箱命令）。
 *
 * 修法：把沙箱 spawn 的 STARTUPINFO 由 `STARTF_USESTDHANDLES`（256）改为
 * `STARTF_USESTDHANDLES | STARTF_USESHOWWINDOW`（257），并置 `wShowWindow = SW_HIDE`（0）。
 * 只影响「新建控制台窗口如何显示」：受限令牌、沙箱模式、stdio 管道与 fail-closed 语义
 * 全都不变；若子进程最终共享了某个已有控制台，该标志不产生任何作用（没有新窗口可隐藏）。
 *
 * 上游修好（或 dsh 换实现）后本补丁自然失效：找不到调用点就静默跳过，绝不抛错、绝不
 * 拖累对话。独立成模块（不 import electron）是为了可被单测直接加载验证；模块内不出现
 * 中文字符串字面量（硬编码中文守卫），注释不受限。
 *
 * dsh 0.1.5 起 `CreateProcessAsUserW` + STARTUPINFO 编码被抽到新包
 * `@deepseek-ai/dsh-win32-process`（ACL 沙箱包改为依赖它），因此补丁要同时覆盖新旧两个
 * 包的位置：任一包缺失都只是「没这条链路」，不报错。
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** ACL 沙箱包名（scoped，按 / 分段拼目录）：0.1.4 及更早的 spawn 实现位置 */
export const ACL_SANDBOX_PACKAGE = '@deepseek-ai/dsh-sandbox-windows-acl'

/** 受限进程包名：0.1.5 起 STARTUPINFO 编码实际所在位置 */
export const WIN32_PROCESS_PACKAGE = '@deepseek-ai/dsh-win32-process'

/** 需要扫描的包，按「新位置优先」排序（先命中新包即可覆盖沙箱链路） */
export const SANDBOX_SPAWN_PACKAGES = [WIN32_PROCESS_PACKAGE, ACL_SANDBOX_PACKAGE]

/** 补丁标志之一：命中说明该文件已经打过补丁（幂等判定锚点） */
export const ACL_PATCHED_FLAGS = 'dwFlags: 257'

/** 补丁标志之二：补丁写入的窗口显示态字段（SW_HIDE） */
export const ACL_PATCHED_SHOW_WINDOW = 'wShowWindow: 0'

/** 改写结果：新源码 + 本次改写的 STARTUPINFO 调用点数 */
export interface AclConsoleSourcePatch {
  source: string
  sites: number
}

/** 打补丁结果（按文件与调用点分别计数，便于日志与测试断言） */
export interface AclConsolePatchReport {
  /** 是否命中 ACL 沙箱包：false = 这棵依赖树没有该链路，无需补丁 */
  present: boolean
  /** 本次实际写入补丁的文件数 */
  patchedFiles: number
  /** 本次改写的 STARTUPINFO 调用点数 */
  patchedSites: number
  /** 已是补丁状态、跳过的文件数 */
  alreadyFiles: number
  /** 读写失败的文件数（只读安装目录、被安全软件锁定等） */
  failedFiles: number
}

/**
 * 纯函数：把源码里每个「沙箱子进程 spawn 的 STARTUPINFO 编码」改成隐藏新建控制台窗口。
 *
 * 匹配 `encodeStartupInfo(startupInfo, { … })` 而不是裸字符串 `dwFlags: 256`，避免误伤
 * 结构体声明等其它位置；两个 spawn 变体（管道 stdio 与继承 std handle）各一处调用点。
 * 已是补丁状态时原样返回（幂等）。
 */
export function patchAclConsoleSource(source: string): AclConsoleSourcePatch {
  // 每一次调用都新建正则：带 g 的正则留在模块级会带 lastIndex 状态，容易埋雷
  const encodeCall = /encodeStartupInfo\(\s*startupInfo,\s*\{([\s\S]*?)\}\)/g
  const pristineFlags = /(\r?\n)([ \t]*)dwFlags:\s*256,/
  let sites = 0

  const patched = source.replace(encodeCall, (call: string, fields: string) => {
    if (!pristineFlags.test(fields)) return call
    const patchedFields = fields.replace(
      pristineFlags,
      (_match, eol: string, indent: string) =>
        `${eol}${indent}${ACL_PATCHED_FLAGS},${eol}${indent}${ACL_PATCHED_SHOW_WINDOW},`
    )
    sites += 1
    const start = call.indexOf(fields)
    return call.slice(0, start) + patchedFields + call.slice(start + fields.length)
  })

  return { source: patched, sites }
}

/**
 * 对一棵 dsh 依赖树（其 `node_modules` 目录）里的沙箱 spawn 实现打补丁。
 *
 * 遍历 {@link SANDBOX_SPAWN_PACKAGES}：新包（dsh-win32-process）与旧包
 * （dsh-sandbox-windows-acl）各扫一遍，命中即改写，互不干扰（同一份实现不会同时出现在两处）。
 *
 * 只读失败、写盘失败、目录不存在都在此消化：调用方拿到的是报告而不是异常——补丁只是
 * 体验优化，任何情况下都不该影响对话。
 */
export function patchAclSandboxConsole(dshModulesDir: string): AclConsolePatchReport {
  const report: AclConsolePatchReport = {
    present: false,
    patchedFiles: 0,
    patchedSites: 0,
    alreadyFiles: 0,
    failedFiles: 0
  }
  if (process.platform !== 'win32') return report

  for (const packageName of SANDBOX_SPAWN_PACKAGES) {
    const libDir = join(dshModulesDir, ...packageName.split('/'), 'lib')
    if (!existsSync(libDir)) continue
    report.present = true
    patchSandboxLibDir(libDir, report)
  }
  return report
}

/** 对单个包的 `lib/` 目录逐文件打补丁，结果累加进 report（单文件失败不影响其它文件） */
function patchSandboxLibDir(libDir: string, report: AclConsolePatchReport): void {
  for (const file of listSandboxJsFiles(libDir)) {
    try {
      const source = readFileSync(file, 'utf8')
      // 与沙箱 spawn 无关的文件（runner 入口、invariant 等）连读都不用读第二遍
      if (!source.includes('dwFlags: 256') && !source.includes(ACL_PATCHED_FLAGS)) continue
      if (source.includes(ACL_PATCHED_FLAGS)) {
        report.alreadyFiles += 1
        continue
      }
      const { source: patched, sites } = patchAclConsoleSource(source)
      if (sites === 0) continue
      writeFileSync(file, patched, 'utf8')
      report.patchedFiles += 1
      report.patchedSites += sites
    } catch (error) {
      report.failedFiles += 1
      console.warn('[aiart] acl sandbox console patch failed:', file, error)
    }
  }
}

/** 列出沙箱包 `lib/` 下的 JS 文件（递归以适配上游改名与文件拆分） */
function listSandboxJsFiles(dir: string): string[] {
  const files: string[] = []
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (/\.[cm]?js$/.test(entry.name)) files.push(path)
    }
  }
  walk(dir)
  return files
}
