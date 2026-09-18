import { describe, expect, it } from 'vitest'
import { classifyBlenderExportTarget } from '../src/shared/blenderExportPath'

const root = 'F:/proj'

describe('classifyBlenderExportTarget', () => {
  it('keeps graph job exports under Cache/BlenderJobs', () => {
    expect(
      classifyBlenderExportTarget({
        requestedPath: 'F:/proj/Cache/BlenderJobs/abc/output.glb',
        projectRoot: root
      })
    ).toEqual({
      action: 'keep',
      relativePath: 'Cache/BlenderJobs/abc/output.glb',
      isJob: true
    })
  })

  it('keeps chat exports already under Cache/Models', () => {
    expect(
      classifyBlenderExportTarget({
        requestedPath: 'F:/proj/Cache/Models/hero.glb',
        projectRoot: root
      })
    ).toEqual({
      action: 'keep',
      relativePath: 'Cache/Models/hero.glb',
      isJob: false
    })
  })

  it('remaps Assets/Models into Cache so chat can preview then save', () => {
    expect(
      classifyBlenderExportTarget({
        requestedPath: 'F:/proj/Assets/Models/walk.glb',
        projectRoot: root
      })
    ).toEqual({ action: 'remap', fileName: 'walk.glb' })
  })

  it('remaps paths outside the project', () => {
    expect(
      classifyBlenderExportTarget({
        requestedPath: 'C:/Temp/out.glb',
        projectRoot: root
      })
    ).toEqual({ action: 'remap', fileName: 'out.glb' })
  })
})
