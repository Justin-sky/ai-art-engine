import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join, normalize } from 'path'
import {
  extractGuidFromUnityMeta,
  generateUnityMetaFile,
  type GameBundleCategory,
  type SyncGameEngineBundleInput,
  type SyncGameEngineBundleResult
} from '@shared/gameAssets'

function sanitizeRelativeBundlePath(rawPath: string): string {
  const normalized = normalize(String(rawPath || '').replace(/\\/g, '/'))
    .replace(/^(\.\.(\/|\\|$))+/, '')
    .replace(/^[/\\]+/, '')
  const segments = normalized
    .split(/[/\\]+/)
    .filter((seg) => seg.length > 0 && seg !== '.' && seg !== '..')
  return segments.join('/')
}

function decodeDataUrlToBuffer(content: string): Buffer {
  const commaIdx = content.indexOf(',')
  const header = commaIdx >= 0 ? content.slice(0, commaIdx) : ''
  const payload = commaIdx >= 0 ? content.slice(commaIdx + 1) : content
  if (header.includes(';base64')) {
    return Buffer.from(payload, 'base64')
  }
  return Buffer.from(decodeURIComponent(payload), 'utf8')
}

export async function syncGameEngineBundleToDirectory(
  input: SyncGameEngineBundleInput
): Promise<SyncGameEngineBundleResult> {
  const targetDir = String(input.targetDir ?? '').trim()
  if (!targetDir) {
    throw new Error('Target game project directory is required')
  }
  mkdirSync(targetDir, { recursive: true })

  const engineKind = input.engineKind ?? 'godot4'
  let writtenCount = 0
  let unityMetaCount = 0
  let preservedGuidCount = 0
  const writtenPaths: string[] = []

  for (const file of input.files ?? []) {
    const safeRel = sanitizeRelativeBundlePath(file.relativePath)
    if (!safeRel) continue

    const absPath = join(targetDir, safeRel)
    mkdirSync(dirname(absPath), { recursive: true })

    if (file.encoding === 'dataUrl' || file.content.startsWith('data:')) {
      const buf = decodeDataUrlToBuffer(file.content)
      writeFileSync(absPath, buf)
    } else {
      writeFileSync(absPath, String(file.content ?? ''), 'utf8')
    }
    writtenCount++
    writtenPaths.push(safeRel)

    if (
      engineKind === 'unity' &&
      !safeRel.endsWith('.meta') &&
      !safeRel.endsWith('.cs') &&
      !safeRel.endsWith('.tres') &&
      !safeRel.endsWith('.gd') &&
      !safeRel.endsWith('.gdshader')
    ) {
      const metaAbsPath = `${absPath}.meta`
      let existingMetaText: string | undefined
      if (existsSync(metaAbsPath)) {
        try {
          existingMetaText = readFileSync(metaAbsPath, 'utf8')
          if (extractGuidFromUnityMeta(existingMetaText)) {
            preservedGuidCount++
          }
        } catch {
          existingMetaText = undefined
        }
      }
      const rawCat = file.category ?? 'sprites'
      const category: GameBundleCategory =
        rawCat === 'sprite'
          ? 'sprites'
          : rawCat === 'tilemap'
            ? 'tilesets'
            : rawCat === 'pbr'
              ? 'pbr_maps'
              : rawCat === 'audio'
                ? safeRel.toLowerCase().includes('bgm') || safeRel.toLowerCase().includes('loop')
                  ? 'audio_bgm'
                  : 'audio_sfx'
                : (rawCat as GameBundleCategory)
      const extMatch = safeRel.match(/(\.[^./]+)$/)
      const metaResult = generateUnityMetaFile(
        {
          id: safeRel,
          name: safeRel.split('/').pop() || 'asset',
          category,
          sourcePath: safeRel,
          bundleRelativePath: safeRel,
          extension: extMatch ? extMatch[1]!.toLowerCase() : '.png'
        },
        {
          existingMetaText,
          spriteBorders: file.spriteBorders
        }
      )
      writeFileSync(metaAbsPath, metaResult.metaText, 'utf8')
      unityMetaCount++
      writtenPaths.push(`${safeRel}.meta`)
    }
  }

  return {
    targetDir,
    engineKind,
    writtenCount,
    unityMetaCount,
    preservedGuidCount,
    writtenPaths
  }
}
