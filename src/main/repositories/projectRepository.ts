import { existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import type { ProjectConfig } from '@shared/domain'
import { defErrSimple, fail } from '@shared/errors/appError'
import { readJsonFile, writeJsonAtomic } from './jsonFile'

const E_PROJECT_JSON_MISSING = defErrSimple(
  'project.jsonMissing',
  'workspace.json 不存在',
  'workspace.json does not exist'
)

export const WORKSPACE_CONFIG_FILE = 'workspace.json'
export const LEGACY_PROJECT_CONFIG_FILE = 'project.json'

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
    const workspaceFile = join(root, WORKSPACE_CONFIG_FILE)
    if (existsSync(workspaceFile)) return workspaceFile
    const legacyFile = join(root, LEGACY_PROJECT_CONFIG_FILE)
    if (existsSync(legacyFile)) return legacyFile
    return workspaceFile
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
    writeJsonAtomic(join(root, WORKSPACE_CONFIG_FILE), config)
  }
}

export const projectRepository = new ProjectRepository()
