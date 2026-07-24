import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { renameReplaceSync } from '../src/main/persistence/atomicRename'
import { writeJsonAtomic } from '../src/main/repositories/jsonFile'

describe('atomic rename / json write', () => {
  it('replaces an existing destination file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'studio-atomic-'))
    const target = join(dir, 'asset.json')
    const temp = join(dir, 'asset.json.tmp')
    writeFileSync(target, '{"v":1}', 'utf-8')
    writeFileSync(temp, '{"v":2}', 'utf-8')
    renameReplaceSync(temp, target)
    expect(readFileSync(target, 'utf-8')).toBe('{"v":2}')
  })

  it('writeJsonAtomic overwrites existing json', () => {
    const dir = mkdtempSync(join(tmpdir(), 'studio-json-'))
    const target = join(dir, 'asset.json')
    writeJsonAtomic(target, { a: 1 })
    writeJsonAtomic(target, { a: 2 })
    expect(JSON.parse(readFileSync(target, 'utf-8'))).toEqual({ a: 2 })
  })
})
