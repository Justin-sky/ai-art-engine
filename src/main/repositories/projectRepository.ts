import { existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import type { ProjectConfig } from '@shared/domain'
import { defErrSimple, fail } from '@shared/errors/appError'
import { readJsonFile, writeJsonAtomic } from './jsonFile'

const E_PROJECT_JSON_MISSING = defErrSimple(
  'project.jsonMissing',
  'project.json 不存在',
  'project.json does not exist'
)

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
    if (!existsSync(path)) throw fail(E_PROJECT_JSON_MISSING)
    return readJsonFile<ProjectConfig>(path)
  }

  write(root: string, config: ProjectConfig): void {
    writeJsonAtomic(this.configPath(root), config)
  }
}

export const projectRepository = new ProjectRepository()
