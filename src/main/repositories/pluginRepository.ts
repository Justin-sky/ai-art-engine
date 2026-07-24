import { app } from 'electron'
import { existsSync, mkdirSync, readdirSync } from 'fs'
import { join } from 'path'
import type { ExternalPluginManifest } from '@shared/ipc'
import { readJsonFile } from './jsonFile'

const PLUGIN_FILE = 'plugin.json'

export class PluginRepository {
  directory(): string {
    return join(app.getPath('userData'), 'plugins')
  }

  list(): ExternalPluginManifest[] {
    const root = this.directory()
    mkdirSync(root, { recursive: true })
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(root, entry.name, PLUGIN_FILE))
      .filter(existsSync)
      .map((path) => {
        try {
          const manifest = readJsonFile<ExternalPluginManifest>(path)
          return this.isCompatible(manifest) ? manifest : null
        } catch (error) {
          console.warn(`[plugins] ignored invalid manifest: ${path}`, error)
          return null
        }
      })
      .filter((manifest): manifest is ExternalPluginManifest => !!manifest)
  }

  private isCompatible(manifest: ExternalPluginManifest): boolean {
    return (
      !!manifest &&
      manifest.apiVersion === 1 &&
      /^[a-z0-9][a-z0-9._-]+$/i.test(manifest.id) &&
      /^\d+\.\d+\.\d+(?:[-+].+)?$/.test(manifest.version) &&
      typeof manifest.displayName === 'string'
    )
  }
}

export const pluginRepository = new PluginRepository()
