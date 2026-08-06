import { existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import type { ProjectConfig } from '@shared/domain'
import { readJsonFile, writeJsonAtomic } from './jsonFile'

const PROJECT_DIRECTORIES = [
  'Assets',
  'Output',
  'Output/images',
  'Output/videos',
  'Thumbnails',
  '.aiartengine/autosave',
  '.aiartengine/gen-requests',
  '.aiartengine/graph-outputs',
  '.aiartengine/thumbs'
]

export class ProjectRepository {
  configPath(root: string): string {
    return join(root, 'project.json')
  }

  ensureScaffold(root: string): void {
    mkdirSync(root, { recursive: true })
    for (const relative of PROJECT_DIRECTORIES) {
      mkdirSync(join(root, relative), { recursive: true })
    }
  }

  read(root: string): ProjectConfig {
    const path = this.configPath(root)
    if (!existsSync(path)) throw new Error('project.json 不存在')
    return readJsonFile<ProjectConfig>(path)
  }

  write(root: string, config: ProjectConfig): void {
    writeJsonAtomic(this.configPath(root), config)
  }
}

export const projectRepository = new ProjectRepository()
