import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs'
import { join, relative as pathRelative } from 'path'
import { randomUUID } from 'crypto'
import { spawn } from 'child_process'
import {
  GAME_PLAY_JOB_ROOT,
  buildGamePlayJobBrief,
  parseGamePlayJobResult,
  validateGamePlayJobDelivery,
  gamePlayDshError,
  type GamePlayDshMode,
  type GamePlayJobResult
} from '@shared/gamePlayDshJob'
import type {
  BuildGamePlayProjectInput,
  BuildGamePlayProjectResult,
  PrepareGamePlayDshJobInput,
  PrepareGamePlayDshJobResult
} from '@shared/ipc'
import { projectService } from './projectService'
import { writeNodeGamePlayScaffold } from './gamePlayScaffold'

const MAX_SINGLE_HTML_BYTES = 8 * 1024 * 1024

function toPosix(path: string): string {
  return path.replace(/\\/g, '/')
}

function jobDir(root: string, jobId: string): string {
  return join(root, GAME_PLAY_JOB_ROOT, jobId)
}

function resolvePreferredMode(raw: string | undefined): GamePlayDshMode {
  if (raw === '2d' || raw === '3d' || raw === 'auto') return raw
  return 'auto'
}

function projectEntryExists(projectAbs: string): boolean {
  return (
    existsSync(join(projectAbs, 'index.template.html')) &&
    existsSync(join(projectAbs, 'src', 'main.js')) &&
    existsSync(join(projectAbs, 'build.mjs'))
  )
}

/** 解析可复用的 job 目录；非法或不存在则返回 null */
export function resolveReusableGamePlayJob(
  root: string,
  projectRelativeDir: string | undefined
): PrepareGamePlayDshJobResult | null {
  const rel = String(projectRelativeDir ?? '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
  if (!rel || rel.includes('..')) return null
  const prefix = `${GAME_PLAY_JOB_ROOT}/`
  if (!rel.startsWith(prefix) || !rel.endsWith('/project')) return null
  const jobId = rel.slice(prefix.length, -'/project'.length)
  if (!jobId || jobId.includes('/')) return null
  const dir = jobDir(root, jobId)
  const projectAbs = join(dir, 'project')
  if (!existsSync(projectAbs) || !projectEntryExists(projectAbs)) return null
  return {
    jobId,
    projectAbs,
    resultAbs: join(dir, 'result.json'),
    briefAbs: join(dir, 'brief.md'),
    projectRelativeDir: toPosix(pathRelative(root, projectAbs))
  }
}

function writeBriefAndPendingResult(
  paths: Pick<PrepareGamePlayDshJobResult, 'projectAbs' | 'resultAbs' | 'briefAbs'>,
  input: PrepareGamePlayDshJobInput,
  preferredMode: GamePlayDshMode,
  resume: boolean
): void {
  writeFileSync(
    paths.briefAbs,
    buildGamePlayJobBrief({
      instruction: input.instruction,
      locale: input.locale,
      preferredMode,
      projectAbs: paths.projectAbs,
      resultAbs: paths.resultAbs,
      briefAbs: paths.briefAbs,
      referenceNote: input.referenceNote,
      resume
    }),
    'utf8'
  )
  writeFileSync(paths.resultAbs, JSON.stringify({ ok: false, error: 'pending' }, null, 2), 'utf8')
}

export function prepareGamePlayDshJob(
  input: PrepareGamePlayDshJobInput
): PrepareGamePlayDshJobResult {
  const root = projectService.getRoot()
  const preferredMode = resolvePreferredMode(input.preferredMode)
  const reused = resolveReusableGamePlayJob(root, input.projectRelativeDir)
  if (reused) {
    writeBriefAndPendingResult(reused, input, preferredMode, true)
    return reused
  }

  const jobId = randomUUID()
  const dir = jobDir(root, jobId)
  const projectAbs = join(dir, 'project')
  const resultAbs = join(dir, 'result.json')
  const briefAbs = join(dir, 'brief.md')
  mkdirSync(projectAbs, { recursive: true })

  writeNodeGamePlayScaffold(projectAbs, preferredMode)
  const prepared: PrepareGamePlayDshJobResult = {
    jobId,
    projectAbs,
    resultAbs,
    briefAbs,
    projectRelativeDir: toPosix(pathRelative(root, projectAbs))
  }
  writeBriefAndPendingResult(prepared, input, preferredMode, false)
  return prepared
}

export function readGamePlayJobResult(resultAbs: string): GamePlayJobResult | null {
  if (!existsSync(resultAbs)) return null
  try {
    return parseGamePlayJobResult(readFileSync(resultAbs, 'utf8'))
  } catch {
    return null
  }
}

export function validatePreparedGamePlayJob(input: {
  projectAbs: string
  resultAbs: string
}): { ok: true; result: GamePlayJobResult } | { ok: false; error: string } {
  const result = readGamePlayJobResult(input.resultAbs)
  const err = validateGamePlayJobDelivery({
    result,
    projectIndexExists: projectEntryExists(input.projectAbs)
  })
  if (err) return { ok: false, error: err }
  return { ok: true, result: result! }
}

/** Seed：仅脚手架，写 ok result，供无 dsh 冒烟；有旧目录则复用 */
export function seedGamePlayProject(input: {
  preferredMode?: string
  instruction?: string
  locale?: string
  referenceNote?: string
  projectRelativeDir?: string
}): PrepareGamePlayDshJobResult {
  const prepared = prepareGamePlayDshJob({
    instruction: input.instruction?.trim() || 'seed sample',
    preferredMode: input.preferredMode,
    locale: input.locale,
    referenceNote: input.referenceNote,
    projectRelativeDir: input.projectRelativeDir
  })
  const mode = input.preferredMode === '3d' ? '3d' : input.preferredMode === '2d' ? '2d' : '2d'
  writeFileSync(
    prepared.resultAbs,
    JSON.stringify({ ok: true, entry: 'index.template.html', gameMode: mode }, null, 2),
    'utf8'
  )
  return prepared
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
  if (!existsSync(indexAbs)) throw new Error(gamePlayDshError('BUILD_NO_DIST'))
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
    /<link\b([^>]*\brel=["']stylesheet["'][^>]*)\bhref=["']([^"']+)["']([^>]*)\/?>/gi,
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
  if (!rel || rel.includes('..')) throw new Error(gamePlayDshError('BAD_PROJECT'))
  const projectAbs = join(root, rel)
  if (!existsSync(join(projectAbs, 'package.json'))) {
    throw new Error(gamePlayDshError('BAD_PROJECT'))
  }
  if (!existsSync(join(projectAbs, 'build.mjs'))) {
    throw new Error(gamePlayDshError('BAD_PROJECT'))
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
    throw new Error(gamePlayDshError('HTML_TOO_LARGE'))
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
