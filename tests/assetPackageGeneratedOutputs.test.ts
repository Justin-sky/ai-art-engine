import { describe, expect, it } from 'vitest'
import {
  collectRelativePathStrings,
  isPackableGeneratedRelativePath,
  normalizePackableRelativePath
} from '../src/shared/assetPackage/generatedOutputs'

describe('asset package generated outputs', () => {
  it('normalizes and rejects unsafe paths', () => {
    expect(normalizePackableRelativePath('Cache\\Images\\a.png')).toBe('Cache/Images/a.png')
    expect(normalizePackableRelativePath('../etc/passwd')).toBe('')
    expect(normalizePackableRelativePath('/abs.png')).toBe('')
  })

  it('accepts cache / output paths and rejects Assets', () => {
    expect(isPackableGeneratedRelativePath('Cache/Images/a.png')).toBe(true)
    expect(isPackableGeneratedRelativePath('Output/videos/b.mp4')).toBe(true)
    expect(isPackableGeneratedRelativePath('.aiartengine/graph-outputs/x.png')).toBe(true)
    expect(isPackableGeneratedRelativePath('Assets/Images/a.png')).toBe(false)
  })

  it('collects relativePath fields from nested graph runStates', () => {
    const paths = collectRelativePathStrings({
      graphJson: {
        runStates: {
          n1: {
            outputs: [{ relativePath: 'Cache/Images/out.png' }],
            previewRelativePath: 'Cache/Videos/preview.mp4'
          }
        }
      }
    })
    expect([...paths].sort()).toEqual([
      'Cache/Images/out.png',
      'Cache/Videos/preview.mp4'
    ])
  })
})
