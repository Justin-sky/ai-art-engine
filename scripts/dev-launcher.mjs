#!/usr/bin/env node
/**
 * 开发启动器：清掉会把 Electron 变成纯 Node 的环境变量，再拉起 electron-vite。
 *
 * 起因（典型现象）：终端里 `npm run dev` 打印完 `start electron app...` 就回到命令行，
 * 窗口从不出现，报错类似：
 *
 *   TypeError: Cannot read properties of undefined (reading 'isPackaged')
 *       at node_modules/@electron-toolkit/utils/dist/index.cjs:6
 *   Node.js v24.x
 *
 * 机理：`electron-vite dev` 最后用 `spawn(electron.exe, ...)` 起应用，子进程继承父进程
 * 的环境变量。若父进程带着 `ELECTRON_RUN_AS_NODE=1`（例如从 Electron 壳应用内嵌的终端
 * / IDE 终端 / 某些 agent 宿主启动的 shell 里跑），Electron 二进制不会进 GUI 主进程，
 * 而是以「纯 Node」模式执行 out/main/index.js——此时 `require('electron').app` 是
 * undefined，第 6 行 `electron.app.isPackaged` 立刻抛错；又因为 electron-vite 里
 * `ps.on('close', process.exit)`，主进程一退整个 dev 也随之退出，于是「回到命令行」。
 *
 * 注意：清掉它只影响「开发期用 electron.exe 跑 GUI」这一件事。应用自己要用内置 Node
 * 跑 dsh 时是显式注入 `ELECTRON_RUN_AS_NODE=1` 的（见 src/main/services/deepseekHarnessService.ts
 * 的 resolveNodeCommand），不依赖这里继承来的值，所以本修复不会影响 dsh 运行。
 *
 * 另一类同样表现为「打印完 start electron app... 就回到命令行」的原因（本文件会自动重置）：
 * 工作区被打了**低完整性级别标签**（Mandatory Label\Low）。标签会随目录继承到 node_modules 里的
 * electron.exe，而低完整性的 Chromium 主进程无法建立它的沙箱，启动阶段直接以
 * `0x80000003`(STATUS_BREAKPOINT) 中止——全程不执行一行 JS、没有任何输出，所以极难自查。
 * 实测：同一份 electron.exe 放到 %TEMP% 正常，给它加低完整性标签后复现中止，去掉标签即恢复。
 * 常见来源是强沙箱的 agent 宿主为工作区加的标签（agent 的 workspace-write 模式等）。
 * 见 ensureWorkspaceIntegrity()：启动前把工作区根目录（连带整棵子树）重置回中等完整性，
 * 并单独确认 electron 解包目录。判断逻辑与 scripts/fix-workspace-integrity.mjs 共用。
 */
import { execFileSync, spawn } from 'node:child_process'
import { isLowIntegrity, readIntegrityLabel } from './lib/integrity-label.mjs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

/** 这些变量会让 Electron 以非 GUI 形态启动，dev 期必须剔除 */
const NEUTRALIZE = ['ELECTRON_RUN_AS_NODE', 'ELECTRON_NO_ATTACH_CONSOLE']

const scriptDir = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(scriptDir, '..')

const removed = []
const env = { ...process.env }
for (const key of NEUTRALIZE) {
  if (env[key] !== undefined) {
    removed.push(`${key}=${env[key]}`)
    delete env[key]
  }
}
if (removed.length > 0) {
  console.log(
    `[dev-launcher] 已忽略继承来的 ${removed.join(' ')}，避免 Electron 退化为纯 Node 模式`
  )
}

const cli = resolve(projectRoot, 'node_modules', 'electron-vite', 'bin', 'electron-vite.js')
const args = [cli, ...process.argv.slice(2)]

/**
 * 低完整性标签兜底：工作区里任何可执行程序都起不来（Electron 表现得最明显——静默 0x80000003），
 * 所以检测到就把标签重置回中等。
 *
 * 先修**工作区根目录**：标签 ACE 带 (OI)(CI) 可继承标志，改根目录这一处，Windows 会重算子对象的
 * 继承 ACE，整棵树一起刷新（不必 /T 递归），顺带保证以后新建的文件也不再继承「低」。
 * 再单独确认 electron 解包目录——根目录修复失败时它是最后一道保险。
 * `/setintegritylevel` 在没有标签时是空操作，正常机器上不会改动任何东西。
 * 修复失败（权限不足等）只告警、照常启动，好让人能看到原始报错。
 */
function ensureWorkspaceIntegrity() {
  if (process.platform !== 'win32') return
  const targets = [
    {
      label: '工作区根目录',
      path: projectRoot,
      args: [projectRoot, '/setintegritylevel', '(OI)(CI)M']
    },
    {
      label: 'electron 解包目录',
      path: resolve(projectRoot, 'node_modules', 'electron', 'dist'),
      args: null // 运行时按路径拼
    }
  ]
  for (const target of targets) {
    try {
      if (!isLowIntegrity(readIntegrityLabel(target.path))) continue
      console.log(
        `[dev-launcher] ${target.label}带「低完整性级别」标签（低完整性进程无法建立 Chromium 沙箱，Electron 启动即 0x80000003 中止），正在重置为中等完整性…`
      )
      const args = target.args ?? [target.path, '/setintegritylevel', 'M']
      execFileSync('icacls', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      if (isLowIntegrity(readIntegrityLabel(target.path))) {
        console.warn(
          [
            `[dev-launcher] ${target.label}重置失败（可能权限不足）。手动处理：`,
            `  icacls "${target.path}" /setintegritylevel M /T /C`,
            '  或把 electron 解包目录移到工作区之外，并设置 ELECTRON_OVERRIDE_DIST_PATH 指向它'
          ].join('\n')
        )
      } else {
        console.log(`[dev-launcher] ${target.label}已重置为中等完整性，继续启动`)
      }
    } catch {
      // 检测或重置失败不影响启动；icacls 缺失、目录不存在、权限不足都走这里
    }
  }
}

ensureWorkspaceIntegrity()

const child = spawn(process.execPath, args, { stdio: 'inherit', env, cwd: projectRoot })
child.on('close', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exit(code ?? 0)
})
child.on('error', (err) => {
  console.error(`[dev-launcher] 启动 electron-vite 失败：${err.message}`)
  process.exit(1)
})
