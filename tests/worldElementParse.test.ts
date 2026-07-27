import { describe, expect, it } from 'vitest'
import {
  extractWorldCatalogJsonText,
  mergeWorldCatalogPreservingReviewed,
  parseWorldElementCatalog,
  parseWorldElementGenResults,
  stringifyWorldElementCatalog,
  stringifyWorldElementGenResults,
  type GraphDocument,
  type WorldElementCatalog
} from '../src/shared/graph'

describe('worldElementParse', () => {
  it('parses english keys with default review status', () => {
    const catalog = parseWorldElementCatalog(`{
      "characters": [{ "id": "a1", "name": "Ada", "prompt": "portrait" }],
      "scenes": [],
      "props": [],
      "weapons": []
    }`)
    expect(catalog?.characters).toHaveLength(1)
    expect(catalog?.characters[0]).toMatchObject({
      id: 'a1',
      name: 'Ada',
      prompt: 'portrait',
      status: '未审核'
    })
  })

  it('parses explicit reviewed status and chinese aliases', () => {
    const catalog = parseWorldElementCatalog(`\`\`\`json
{
  "角色": [{ "名称": "小林", "提示词": "旅人", "状态": "已审核" }],
  "场景": [],
  "道具": [],
  "武器": [{ "名称": "青玉剑", "提示词": "剑" }]
}
\`\`\``)
    expect(catalog?.characters).toHaveLength(1)
    expect(catalog?.characters[0]?.name).toBe('小林')
    expect(catalog?.characters[0]?.prompt).toBe('旅人')
    expect(catalog?.characters[0]?.status).toBe('已审核')
    expect(catalog?.characters[0]?.id).toMatch(/^we-characters-/)
    expect(catalog?.weapons).toHaveLength(1)
    expect(catalog?.weapons[0]?.name).toBe('青玉剑')
  })

  it('ignores unknown top-level keys', () => {
    const catalog = parseWorldElementCatalog(`{
      "characters": [],
      "scenes": [],
      "props": [],
      "weapons": [{ "id": "w1", "name": "Blade", "prompt": "sword" }],
      "extra": [{ "id": "x", "name": "X", "prompt": "y" }]
    }`)
    expect(catalog?.weapons).toEqual([
      { id: 'w1', name: 'Blade', prompt: 'sword', status: '未审核' }
    ])
  })

  it('merges catalogs preserving reviewed items by id', () => {
    const previous: WorldElementCatalog = {
      characters: [
        { id: 'a1', name: 'Ada', prompt: 'keep-me', status: '已审核' },
        { id: 'a2', name: 'Bob', prompt: 'old', status: '未审核' }
      ],
      scenes: [],
      props: [],
      weapons: []
    }
    const next: WorldElementCatalog = {
      characters: [
        { id: 'a1', name: 'AdaX', prompt: 'changed', status: '未审核' },
        { id: 'a3', name: 'Cara', prompt: 'new', status: '未审核' }
      ],
      scenes: [],
      props: [],
      weapons: []
    }
    const merged = mergeWorldCatalogPreservingReviewed(previous, next)
    expect(merged?.characters).toEqual([
      { id: 'a1', name: 'Ada', prompt: 'keep-me', status: '已审核' },
      { id: 'a3', name: 'Cara', prompt: 'new', status: '未审核' }
    ])
  })

  it('serializes status field', () => {
    const text = stringifyWorldElementCatalog({
      characters: [{ id: 'a1', name: 'Ada', prompt: 'p', status: '已审核' }],
      scenes: [],
      props: [],
      weapons: []
    })
    expect(text).toContain('"status": "已审核"')
    expect(text).toContain('"weapons"')
  })

  it('extracts upstream text linked into world.table', () => {
    const doc: GraphDocument = {
      nodes: [
        {
          id: 'world-extract',
          typeId: 'world.extract',
          category: 'note',
          position: { x: 0, y: 0 },
          params: { text: '{"characters":[],"scenes":[],"props":[],"weapons":[]}' },
          title: 'extract'
        },
        {
          id: 'world-table',
          typeId: 'world.table',
          category: 'note',
          position: { x: 200, y: 0 },
          params: {},
          title: 'table'
        },
        {
          id: 'world-gen',
          typeId: 'world.gen',
          category: 'note',
          position: { x: 400, y: 0 },
          params: {},
          title: 'gen'
        }
      ],
      edges: [
        {
          id: 'e1',
          source: 'world-extract',
          target: 'world-table',
          sourcePort: 'out',
          targetPort: 'in'
        },
        {
          id: 'e2',
          source: 'world-table',
          target: 'world-gen',
          sourcePort: 'out',
          targetPort: 'in'
        }
      ],
      groups: [],
      viewport: { x: 0, y: 0, zoom: 1 }
    }
    expect(extractWorldCatalogJsonText(doc)).toContain('characters')
  })

  it('round-trips world element gen results', () => {
    const text = stringifyWorldElementGenResults([
      { type: '角色', name: 'Ada', imageUrl: 'Assets/a.png' },
      { type: '武器', name: '剑', imageUrl: 'Assets/w.png' }
    ])
    expect(parseWorldElementGenResults(text)).toEqual([
      { type: '角色', name: 'Ada', imageUrl: 'Assets/a.png' },
      { type: '武器', name: '剑', imageUrl: 'Assets/w.png' }
    ])
    expect(parseWorldElementGenResults(`[{"type":"character","name":"X","imageUrl":"p.png"}]`)).toEqual([
      { type: '角色', name: 'X', imageUrl: 'p.png' }
    ])
  })
})
