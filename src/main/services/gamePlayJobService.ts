/**
 * 可玩 HTML 作业服务（AI 对话路径）：
 * prepare（落脚手架）→ build（npm install + node build.mjs）→ status（轮询）。
 *
 * 为什么由宿主跑 npm：与既有 brief 的禁止项一致，且沙箱里 npm 行为不确定；
 * 产物必须落在约定位置（`<project>/dist/single.html`）才能被沙盒按路径读取。
 *
 * 作业记录留在内存（一次对话内完成提交 / 轮询）；磁盘上的工程目录才是可长期引用的句柄，
 * 所以工具入参同时接受 `projectRelativeDir`。
 */
import { randomUUID } from 'crypto'
import { existsSync } from 'fs'
import { join } from 'path'
import {
  GAME_PLAY_PROJECT_ROOT,
  appendGamePlayJobLog,
  gamePlayJobError,
  gamePlayJobIdOf,
  gamePlayJobLogTail,
  normalizeGamePlayJobMode,
  resolveGamePlayProjectRelativeDir,
  type GamePlayJobMode,
  type GamePlayJobSnapshot,
  type GamePlayJobStatus
} from '@shared/gamePlayJob'
import { projectService } from './projectService'
import { writeNodeGamePlayScaffold } from './gamePlayScaffold'
import { buildGamePlayProject, listScaffoldFiles } from './gamePlayDshJobService'

interface GamePlayJobRecord {
  jobId: string
  projectRelativeDir: string
  mode: GamePlayJobMode
  status: GamePlayJobStatus
  logs: string[]
  error?: string
  buildHtmlRelativePath?: string
  bytes?: number
  updatedAt: number
}

const records = new Map<string, GamePlayJobRecord>()

function snapshot(record: GamePlayJobRecord): GamePlayJobSnapshot {
  return {
    jobId: record.jobId,
    projectRelativeDir: record.projectRelativeDir,
    mode: record.mode,
    status: record.status,
    logs: gamePlayJobLogTail(record.logs),
    ...(record.error ? { error: record.error } : {}),
    ...(record.buildHtmlRelativePath
      ? { buildHtmlRelativePath: record.buildHtmlRelativePath }
      : {}),
    ...(typeof record.bytes === 'number' ? { bytes: record.bytes } : {}),
    updatedAt: new Date(record.updatedAt).toISOString()
  }
}

function touch(record: GamePlayJobRecord): void {
  record.updatedAt = Date.now()
}

function requireProjectRoot(): string {
  const root = projectService.getRoot()
  if (!root) throw new Error(gamePlayJobError('NO_PROJECT'))
  return root
}

function findRecordByProjectDir(projectRelativeDir: string): GamePlayJobRecord | undefined {
  for (const record of records.values()) {
    if (record.projectRelativeDir === projectRelativeDir) return record
  }
  return undefined
}

export interface PrepareGamePlayProjectResult {
  jobId: string
  projectAbs: string
  projectRelativeDir: string
  mode: GamePlayJobMode
  /** 脚手架写入的文件清单（相对 project 根），便于 agent 确认结构 */
  files: string[]
}

/**
 * 落宿主脚手架。传 `projectRelativeDir` 时在既有工程上续写（保留 agent 已写的 src/**），
 * 不传则新建一个作业目录。
 */
export function prepareGamePlayProject(input: {
  mode?: string
  projectRelativeDir?: string
}): PrepareGamePlayProjectResult {
  const root = requireProjectRoot()
  const mode = normalizeGamePlayJobMode(input.mode)
  const existingRel = resolveGamePlayProjectRelativeDir(input.projectRelativeDir)
  if (input.projectRelativeDir && !existingRel) {
    throw new Error(gamePlayJobError('BAD_PROJECT'))
  }

  let jobId: string
  let projectAbs: string
  let projectRelativeDir: string

  if (existingRel) {
    const jobIdFromPath = gamePlayJobIdOf(existingRel)
    if (!jobIdFromPath) throw new Error(gamePlayJobError('BAD_PROJECT'))
    jobId = jobIdFromPath
    projectRelativeDir = existingRel
    projectAbs = join(root, ...existingRel.split('/'))
    if (!existsSync(projectAbs)) throw new Error(gamePlayJobError('BAD_PROJECT'))
  } else {
    jobId = randomUUID()
    projectRelativeDir = `${GAME_PLAY_PROJECT_ROOT}/${jobId}/project`
    projectAbs = join(root, ...projectRelativeDir.split('/'))
  }

  writeNodeGamePlayScaffold(projectAbs, mode)
  const files = listScaffoldFiles(projectAbs)
  const record: GamePlayJobRecord = {
    jobId,
    projectRelativeDir,
    mode,
    status: 'ready',
    logs: [`scaffold ready: ${projectRelativeDir} (${files.length} files)`],
    updatedAt: Date.now()
  }
  records.set(jobId, record)
  return { jobId, projectAbs, projectRelativeDir, mode, files }
}

/**
 * 提交 cook（后台跑）。同一个工程重复提交时复用既有记录并追加日志——
 * 对话里「再改一版」会反复 build，不应该每次生成一条新作业。
 */
export function startGamePlayBuild(input: { projectRelativeDir: string }): GamePlayJobSnapshot {
  requireProjectRoot()
  const projectRelativeDir = resolveGamePlayProjectRelativeDir(input.projectRelativeDir)
  if (!projectRelativeDir) throw new Error(gamePlayJobError('BAD_PROJECT'))

  const existing = findRecordByProjectDir(projectRelativeDir)
  if (existing?.status === 'building') {
    return snapshot(existing)
  }

  const jobId = existing?.jobId ?? gamePlayJobIdOf(projectRelativeDir)
  if (!jobId) throw new Error(gamePlayJobError('BAD_PROJECT'))
  const record: GamePlayJobRecord = existing ?? {
    jobId,
    projectRelativeDir,
    mode: 'auto',
    status: 'ready',
    logs: [],
    updatedAt: Date.now()
  }
  record.status = 'building'
  delete record.error
  delete record.buildHtmlRelativePath
  delete record.bytes
  appendGamePlayJobLog(record.logs, 'build: npm install + node build.mjs…')
  touch(record)
  records.set(record.jobId, record)

  void (async () => {
    try {
      const built = await buildGamePlayProject({
        projectRelativeDir,
        onLog: (line) => {
          appendGamePlayJobLog(record.logs, line)
          touch(record)
        }
      })
      record.status = 'done'
      record.buildHtmlRelativePath = built.buildHtmlRelativePath
      record.bytes = built.bytes
      appendGamePlayJobLog(
        record.logs,
        `build done: ${built.buildHtmlRelativePath} (${Math.round(built.bytes / 1024)} KB)`
      )
    } catch (error) {
      record.status = 'error'
      record.error = error instanceof Error ? error.message : String(error)
      appendGamePlayJobLog(record.logs, `build failed: ${record.error}`)
    } finally {
      touch(record)
    }
  })()

  return snapshot(record)
}

export function getGamePlayJob(jobId: string): GamePlayJobSnapshot | null {
  const record = records.get(String(jobId ?? '').trim())
  return record ? snapshot(record) : null
}

export function listGamePlayJobs(): GamePlayJobSnapshot[] {
  return [...records.values()]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((record) => snapshot(record))
}

/** 测试用：清空内存记录（避免用例间串味） */
export function resetGamePlayJobsForTest(): void {
  records.clear()
}
