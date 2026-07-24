import { existsSync, mkdirSync, readdirSync, unlinkSync } from 'fs'
import { join } from 'path'
import type { VideoJobRecord, VideoJobStatus } from '@shared/videoJob'
import { isVideoJobActive } from '@shared/videoJob'
import { readJsonFile, writeJsonAtomic } from './jsonFile'

const MAX_TERMINAL_JOBS = 50

function nowIso(): string {
  return new Date().toISOString()
}

export class VideoJobRepository {
  private root(projectRoot: string): string {
    return join(projectRoot, '.aiartengine', 'video-jobs')
  }

  private ensureRoot(projectRoot: string): string {
    const dir = this.root(projectRoot)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    return dir
  }

  private pathFor(projectRoot: string, localJobId: string): string {
    return join(this.root(projectRoot), `${localJobId}.json`)
  }

  list(projectRoot: string): VideoJobRecord[] {
    const dir = this.root(projectRoot)
    if (!existsSync(dir)) return []
    const out: VideoJobRecord[] = []
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.json')) continue
      try {
        const job = readJsonFile<VideoJobRecord>(join(dir, name))
        if (job?.version === 1 && job.localJobId) out.push(job)
      } catch {
        /* skip corrupt */
      }
    }
    return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  listActive(projectRoot: string): VideoJobRecord[] {
    return this.list(projectRoot).filter((job) => isVideoJobActive(job.status))
  }

  get(projectRoot: string, localJobId: string): VideoJobRecord | null {
    const path = this.pathFor(projectRoot, localJobId)
    if (!existsSync(path)) return null
    try {
      const job = readJsonFile<VideoJobRecord>(path)
      return job?.version === 1 ? job : null
    } catch {
      return null
    }
  }

  write(projectRoot: string, job: VideoJobRecord): VideoJobRecord {
    this.ensureRoot(projectRoot)
    const next: VideoJobRecord = { ...job, updatedAt: nowIso() }
    writeJsonAtomic(this.pathFor(projectRoot, next.localJobId), next)
    return next
  }

  patch(
    projectRoot: string,
    localJobId: string,
    patch: Partial<Omit<VideoJobRecord, 'localJobId' | 'version'>>
  ): VideoJobRecord | null {
    const current = this.get(projectRoot, localJobId)
    if (!current) return null
    return this.write(projectRoot, { ...current, ...patch })
  }

  remove(projectRoot: string, localJobId: string): void {
    const path = this.pathFor(projectRoot, localJobId)
    if (existsSync(path)) unlinkSync(path)
  }

  /** 终态任务过多时删掉最旧的 */
  pruneTerminal(projectRoot: string, keep = MAX_TERMINAL_JOBS): void {
    const terminal = this.list(projectRoot).filter((job) => !isVideoJobActive(job.status))
    if (terminal.length <= keep) return
    const drop = terminal.slice(keep)
    for (const job of drop) {
      this.remove(projectRoot, job.localJobId)
    }
  }
}

export const videoJobRepository = new VideoJobRepository()

export type { VideoJobStatus }
