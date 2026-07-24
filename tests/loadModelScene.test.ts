import { describe, expect, it } from 'vitest'
import { modelFileExt } from '../src/renderer/src/features/director/loadModelScene'
import { detectImportAssetType, isModelFilePath } from '../src/shared/import'

describe('modelFileExt', () => {
  it('reads extension from asset paths; protocol URLs rely on filePathHint', () => {
    expect(modelFileExt('Models/hero.fbx')).toBe('.fbx')
    expect(modelFileExt('Models\\hero.GLB')).toBe('.glb')
    expect(modelFileExt('https://example.com/a.gltf?token=1')).toBe('.gltf')
    // studio-media URLs put the real path in query; callers pass relativePath as hint
    expect(modelFileExt('studio-media://local?path=C%3A%2FModels%2Fhero.fbx')).toBe('')
  })
})

describe('model import formats', () => {
  it('accepts fbx as model assets', () => {
    expect(isModelFilePath('char.fbx')).toBe(true)
    expect(detectImportAssetType('Assets/char.fbx')).toBe('model')
  })
})

describe('screenplay text import', () => {
  it('maps txt/md to screenplay assets', async () => {
    const { isTextFilePath } = await import('../src/shared/import')
    expect(isTextFilePath('story.txt')).toBe(true)
    expect(isTextFilePath('notes.md')).toBe(true)
    expect(detectImportAssetType('Assets/opening.txt')).toBe('screenplay')
    expect(detectImportAssetType('Assets/beat.md')).toBe('screenplay')
  })
})
