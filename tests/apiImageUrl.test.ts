import { describe, expect, it } from 'vitest'
import { ensureApiImageUrl } from '../src/main/services/modelProviders/apiImageUrl'
import { writeFileSync, mkdtempSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { pathToFileURL } from 'url'

describe('ensureApiImageUrl', () => {
  it('keeps data and http urls', () => {
    expect(ensureApiImageUrl('data:image/png;base64,aaa')).toBe('data:image/png;base64,aaa')
    expect(ensureApiImageUrl('https://example.com/a.png')).toBe('https://example.com/a.png')
  })

  it('converts file:// to data url', () => {
    const dir = mkdtempSync(join(tmpdir(), 'api-img-'))
    const abs = join(dir, 'x.png')
    // minimal 1x1 png
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64'
    )
    writeFileSync(abs, png)
    const out = ensureApiImageUrl(pathToFileURL(abs).href)
    expect(out.startsWith('data:image/png;base64,')).toBe(true)
  })

  it('converts studio-media:// to data url', () => {
    const dir = mkdtempSync(join(tmpdir(), 'api-img-'))
    const abs = join(dir, 'y.png')
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64'
    )
    writeFileSync(abs, png)
    const studio = `studio-media://local/?path=${encodeURIComponent(abs)}&t=1`
    const out = ensureApiImageUrl(studio)
    expect(out.startsWith('data:image/png;base64,')).toBe(true)
  })
})
