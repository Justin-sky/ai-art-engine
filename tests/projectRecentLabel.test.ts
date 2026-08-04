import { describe, expect, it } from 'vitest'
import { projectRecentLabel } from '../src/renderer/src/composables/useProjectLifecycle'

describe('projectRecentLabel', () => {
  it('uses parent folder name of project.json', () => {
    expect(projectRecentLabel('D:/films/MyShort/project.json')).toBe('MyShort')
    expect(projectRecentLabel('C:\\works\\Demo\\project.json')).toBe('Demo')
  })

  it('falls back to last path segment', () => {
    expect(projectRecentLabel('D:/films/orphan')).toBe('orphan')
  })
})
