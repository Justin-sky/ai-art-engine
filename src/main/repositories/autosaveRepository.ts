import { existsSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import type {
  AutosaveEntry,
  AutosaveFilter,
  AutosaveManifest,
  AutosaveWriteInput
} from '@shared/ipc'
import type { AssetInfo } from '@shared/domain'
import { readJsonFile, writeJsonAtomic } from './jsonFile'

const EMPTY_MANIFEST: AutosaveManifest = {
  version: 1,
  updatedAt: '',
  entries: []
}

function nowIso(): string {
  return new Date().toISOString()
}

export class AutosaveRepository {
  private root(projectRoot: string): string {
    return join(projectRoot, '.aiartengine', 'autosave')
  }

  private manifestPath(projectRoot: string): string {
    return join(this.root(projectRoot), 'manifest.json')
  }

  list(projectRoot: string): AutosaveManifest {
    const path = this.manifestPath(projectRoot)
    if (!existsSync(path)) return { ...EMPTY_MANIFEST, entries: [] }
    try {
      const manifest = readJsonFile<AutosaveManifest>(path)
      return manifest.version === 1
        ? manifest
        : { ...EMPTY_MANIFEST, entries: [] }
    } catch {
      return { ...EMPTY_MANIFEST, entries: [] }
    }
  }

  write(projectRoot: string, input: AutosaveWriteInput): AutosaveEntry {
    const root = this.root(projectRoot)
    const directory = join(root, `${input.kind}s`)
    mkdirSync(directory, { recursive: true })
    const relativePath = `${input.kind}s/${encodeURIComponent(input.id)}.json`
    writeJsonAtomic(join(root, relativePath), input.payload)

    const savedAt = nowIso()
    const entry: AutosaveEntry = {
      kind: input.kind,
      id: input.id,
      relativePath,
      savedAt,
      canonicalUpdatedAt: input.canonicalUpdatedAt
    }
    const current = this.list(projectRoot)
    const entries = current.entries.filter(
      (item) => item.kind !== input.kind || item.id !== input.id
    )
    const manifest: AutosaveManifest = {
      version: 1,
      updatedAt: savedAt,
      entries: [...entries, entry]
    }
    writeJsonAtomic(this.manifestPath(projectRoot), manifest)
    return entry
  }

  read(
    projectRoot: string,
    filter: Required<AutosaveFilter>
  ): AssetInfo | null {
    const entry = this.list(projectRoot).entries.find(
      (item) => item.kind === filter.kind && item.id === filter.id
    )
    if (!entry) return null
    const path = join(this.root(projectRoot), entry.relativePath)
    return existsSync(path) ? readJsonFile<AssetInfo>(path) : null
  }

  discard(projectRoot: string, filter?: AutosaveFilter): void {
    const root = this.root(projectRoot)
    const current = this.list(projectRoot)
    const removed = current.entries.filter(
      (entry) =>
        (!filter?.kind || entry.kind === filter.kind) &&
        (!filter?.id || entry.id === filter.id)
    )
    for (const entry of removed) {
      const path = join(root, entry.relativePath)
      if (existsSync(path)) rmSync(path)
    }
    const entries = current.entries.filter((entry) => !removed.includes(entry))
    mkdirSync(root, { recursive: true })
    writeJsonAtomic(this.manifestPath(projectRoot), {
      version: 1,
      updatedAt: nowIso(),
      entries
    } satisfies AutosaveManifest)
  }
}

export const autosaveRepository = new AutosaveRepository()
