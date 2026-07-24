import { existsSync, rmSync } from 'fs'
import { join } from 'path'
import type { Shot } from '@shared/domain'
import { readJsonFile, writeJsonAtomic } from './jsonFile'

export class ShotRepository {
  path(root: string, shotId: string): string {
    return join(root, 'Storyboard', 'shots', `${shotId}.json`)
  }

  list(root: string, orderedIds: string[]): Shot[] {
    return orderedIds
      .map((id) => this.read(root, id))
      .filter((shot): shot is Shot => !!shot)
  }

  read(root: string, shotId: string): Shot | null {
    const path = this.path(root, shotId)
    return existsSync(path) ? readJsonFile<Shot>(path) : null
  }

  write(root: string, shot: Shot): void {
    writeJsonAtomic(this.path(root, shot.id), shot)
  }

  remove(root: string, shotId: string): void {
    const path = this.path(root, shotId)
    if (existsSync(path)) rmSync(path)
  }
}

export const shotRepository = new ShotRepository()
