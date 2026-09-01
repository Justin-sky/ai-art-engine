import { describe, expect, it } from 'vitest'
import type { ProjectConfig } from '../src/shared/domain'
import {
  appendMemorySection,
  buildInitialMemoryContent,
  memorySectionTitle,
  parseMemorySections,
  PROJECT_MEMORY_RELATIVE_PATH,
  type ProjectMemorySectionId
} from '../src/shared/projectMemory'

function makeConfig(overrides: Partial<ProjectConfig> = {}): ProjectConfig {
  return {
    id: 'p1',
    name: 'Demo',
    version: 2,
    resolution: { w: 1080, h: 1920 },
    fps: 30,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}

describe('projectMemory', () => {
  it('相对路径固定为 .aiartengine/memory.md', () => {
    expect(PROJECT_MEMORY_RELATIVE_PATH).toBe('.aiartengine/memory.md')
  })

  it('buildInitialMemoryContent 包含标题、项目信息与四个分类', () => {
    const content = buildInitialMemoryContent(
      makeConfig({ stylePreset: '电影感', generateSeed: 42, styleImages: [{ id: 's1', name: 'ref', weight: 1 }] })
    )
    expect(content).toContain('# 项目记忆')
    expect(content).toContain('项目名称 / Project name: Demo')
    expect(content).toContain('1080x1920')
    expect(content).toContain('30')
    expect(content).toContain('42')
    expect(content).toContain('电影感')
    for (const section of ['style', 'camera', 'character', 'other'] as ProjectMemorySectionId[]) {
      const { zh, en } = memorySectionTitle(section)
      expect(content).toContain(`## ${zh} / ${en}`)
    }
  })

  it('parseMemorySections 解析出各分类条目', () => {
    const content = [
      '# 项目记忆 / Project Memory',
      '',
      '## 项目信息 / Project info',
      '',
      '- 项目名称 / Project name: Demo',
      '',
      '## 风格偏好 / Style',
      '',
      '- 画面偏暗黑电影风',
      '- 使用暖色调光',
      '',
      '## 机位 / 镜头偏好 / Camera & framing',
      '',
      '- 多用低机位仰拍',
      '',
      '## 角色一致性 / Character consistency',
      '',
      '## 其它偏好 / Other preferences',
      '',
      '- 台词避免英文'
    ].join('\n')
    const parsed = parseMemorySections(content)
    const byId = new Map(parsed.map((s) => [s.id, s.lines]))
    expect(byId.get('style')).toEqual(['画面偏暗黑电影风', '使用暖色调光'])
    expect(byId.get('camera')).toEqual(['多用低机位仰拍'])
    expect(byId.get('character')).toEqual([])
    expect(byId.get('other')).toEqual(['台词避免英文'])
  })

  it('appendMemorySection 向已有分类追加', () => {
    const base = buildInitialMemoryContent(makeConfig())
    const next = appendMemorySection(base, 'style', '主角配色为红黑')
    const parsed = parseMemorySections(next)
    expect(parsed.find((s) => s.id === 'style')?.lines).toEqual(['主角配色为红黑'])
  })

  it('appendMemorySection 追加到已有条目的末尾', () => {
    const base = appendMemorySection(buildInitialMemoryContent(makeConfig()), 'camera', '第一行')
    const next = appendMemorySection(base, 'camera', '第二行')
    expect(parseMemorySections(next).find((s) => s.id === 'camera')?.lines).toEqual([
      '第一行',
      '第二行'
    ])
  })

  it('appendMemorySection 空内容时能补建分类', () => {
    const next = appendMemorySection('', 'character', '主角始终穿蓝色外套')
    expect(next).toContain(memorySectionTitle('character').zh)
    const parsed = parseMemorySections(next)
    expect(parsed.find((s) => s.id === 'character')?.lines).toEqual(['主角始终穿蓝色外套'])
  })

  it('append 忽略空条目不改变内容', () => {
    const base = buildInitialMemoryContent(makeConfig())
    expect(appendMemorySection(base, 'style', '  ')).toBe(base)
  })
})
