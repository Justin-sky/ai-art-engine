/**
 * 可玩 HTML：工程构建（cook）服务。
 *
 * 游戏**生成**已改由 AI 对话面板驱动（MCP `gameplay_*` 工具 + 内置技能 `gameplay-proc-assets`）：
 * agent 写 `src/**`，宿主只负责 `npm install` + `node build.mjs` 并把结果内联成单文件。
 * 这里因此只剩两件事：构建内联，以及脚手架落盘后的文件清单（供工具回给 agent）。
 *
 * 兼容层：旧工程里的 `asset.gamePlay` 节点仍走同一套构建（IPC `gameplay:build`）。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs'
import { join, relative as pathRelative } from 'path'
import { spawn } from 'child_process'
import type { BuildGamePlayProjectInput, BuildGamePlayProjectResult } from '@shared/ipc'
import { projectService } from './projectService'

const MAX_SINGLE_HTML_BYTES = 8 * 1024 * 1024

function toPosix(path: string): string {
  return path.replace(/\\/g, '/')
}

export function gamePlayBuildError(code: string): string {
  return `GRAPH_GAMEPLAY_${code}`
}

function runCommand(
  command: string,
  args: string[],
  cwd: string,
  onLog?: (line: string) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      shell: true,
      env: { ...process.env, npm_config_fund: 'false', CI: '1' }
    })
    const fail = (err: Error): void => reject(err)
    child.stdout?.on('data', (buf: Buffer) => {
      const text = buf.toString('utf8')
      for (const line of text.split(/\r?\n/)) {
        if (line.trim()) onLog?.(line.trim())
      }
    })
    child.stderr?.on('data', (buf: Buffer) => {
      const text = buf.toString('utf8')
      for (const line of text.split(/\r?\n/)) {
        if (line.trim()) onLog?.(line.trim())
      }
    })
    child.on('error', fail)
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${command} ${args.join(' ')} exited ${code}`))
    })
  })
}

/**
 * 将 dist/index.html 中相对 script/link 内联为单文件（esbuild 已注入时多为 no-op）。
 */
export function inlineDistToSingleHtml(distDir: string): string {
  const indexAbs = join(distDir, 'index.html')
  if (!existsSync(indexAbs)) throw new Error(gamePlayBuildError('BUILD_NO_DIST'))
  let html = readFileSync(indexAbs, 'utf8')

  html = html.replace(
    /<script\b([^>]*)\bsrc=["']([^"']+)["']([^>]*)>\s*<\/script>/gi,
    (full, pre: string, src: string, post: string) => {
      if (/^https?:/i.test(src) || src.startsWith('data:')) return full
      const file = join(distDir, src.replace(/^\.\//, '').replace(/^\//, ''))
      if (!existsSync(file)) return full
      const js = readFileSync(file, 'utf8')
      const type = /\btype=["']module["']/i.test(`${pre} ${post}`) ? ' type="module"' : ''
      return `<script${type}>\n${js}\n</script>`
    }
  )

  html = html.replace(
    /<link\b([^>]*\brel=["']stylesheet["'][^>]*)\bhref=["']([^"']+)["']([^>]*)>/gi,
    (full, _pre: string, href: string) => {
      if (/^https?:/i.test(href) || href.startsWith('data:')) return full
      const file = join(distDir, href.replace(/^\.\//, '').replace(/^\//, ''))
      if (!existsSync(file)) return full
      const css = readFileSync(file, 'utf8')
      return `<style>\n${css}\n</style>`
    }
  )

  return html
}

export async function buildGamePlayProject(
  input: BuildGamePlayProjectInput & {
    /** 逐行回调：对话路径的作业服务用它做实时日志（IPC 调用方不传） */ // cjk-ok（JSDoc 注释：cjk 门禁的正则态误判，非 UI 文案）
    onLog?: (line: string) => void
  }
): Promise<BuildGamePlayProjectResult> {
  const root = projectService.getRoot()
  const rel = String(input.projectRelativeDir ?? '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
  if (!rel || rel.includes('..')) throw new Error(gamePlayBuildError('BAD_PROJECT'))
  const projectAbs = join(root, rel)
  if (!existsSync(join(projectAbs, 'package.json'))) {
    throw new Error(gamePlayBuildError('BAD_PROJECT'))
  }
  if (!existsSync(join(projectAbs, 'build.mjs'))) {
    throw new Error(gamePlayBuildError('BAD_PROJECT'))
  }

  const logs: string[] = []
  const onLog = (line: string): void => {
    logs.push(line)
    input.onLog?.(line)
  }

  onLog('npm install…')
  await runCommand('npm', ['install', '--no-audit', '--no-fund'], projectAbs, onLog)
  onLog('node build.mjs…')
  await runCommand('npm', ['run', 'build'], projectAbs, onLog)

  const distDir = join(projectAbs, 'dist')
  const html = inlineDistToSingleHtml(distDir)
  const bytes = Buffer.byteLength(html, 'utf8')
  if (bytes > MAX_SINGLE_HTML_BYTES) {
    throw new Error(gamePlayBuildError('HTML_TOO_LARGE'))
  }

  const outRel = `${rel}/dist/single.html`
  const outAbs = join(root, ...outRel.split('/'))
  mkdirSync(distDir, { recursive: true })
  writeFileSync(outAbs, html, 'utf8')

  return {
    html,
    buildHtmlRelativePath: outRel,
    bytes,
    logs: logs.slice(-80)
  }
}

/** Test helper: list relative paths written by the scaffold. */
export function listScaffoldFiles(projectAbs: string): string[] {
  const out: string[] = []
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, name.name)
      if (name.isDirectory()) walk(abs)
      else out.push(toPosix(pathRelative(projectAbs, abs)))
    }
  }
  if (existsSync(projectAbs)) walk(projectAbs)
  return out.sort()
}
