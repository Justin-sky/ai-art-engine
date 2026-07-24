import { describe, expect, it } from 'vitest'
import {
  collectMentionedIndexes,
  expandInstructionMentions,
  selectByMentionIndexes,
  shouldKeepInstructionMentionToken
} from '../src/shared/graph/instructionMentions'
import {
  buildInstructionFinalPromptPreview,
  buildMentionSourcesForNode
} from '../src/shared/graph/execute/values'
import type { GraphDocument, GraphNode } from '../src/shared/graph/types'
import { portMentionIndex } from '../src/shared/domain'
import {
  buildMentionIndexMapAfterReorder,
  buildMentionIndexMapForStyleReserveChange,
  remapInstructionMentions
} from '../src/renderer/src/features/graph/model/graphEditorHosts'

describe('instruction mentions', () => {
  const sources = [
    { index: 1, title: '大纲', text: '第一幕发生火灾' },
    { index: 2, title: '角色', text: '主角是消防员' }
  ]

  it('replaces @n with source body only (no @n, no title wrapper)', () => {
    expect(expandInstructionMentions('请基于 @1 扩写，并融入 @2', sources)).toBe(
      '请基于 第一幕发生火灾 扩写，并融入 主角是消防员'
    )
  })

  it('removes unknown @n instead of keeping the token', () => {
    expect(expandInstructionMentions('参考 @9 继续', sources)).toBe('参考 继续')
  })

  it('keeps @n for media sources (API image array indexing)', () => {
    expect(
      expandInstructionMentions('主体参考 @3，风格另附', [
        { index: 3, title: '角色', text: '', keepMentionToken: true }
      ])
    ).toBe('主体参考 @3，风格另附')
  })

  it('collects mentioned indexes', () => {
    expect([...collectMentionedIndexes('用 @2 和 @1，再提 @2')].sort()).toEqual([1, 2])
  })

  it('selectByMentionIndexes auto-keeps all without @ and filters with @', () => {
    const indexed = [
      { index: 1, value: 'a' },
      { index: 2, value: 'b' }
    ]
    expect(selectByMentionIndexes('无引用', indexed)).toEqual(['a', 'b'])
    expect(selectByMentionIndexes('只要 @2', indexed)).toEqual(['b'])
  })

  it('buildMentionSourcesForNode falls back to source node text when output missing', () => {
    const source: GraphNode = {
      id: 'n1',
      category: 'note',
      typeId: 'note.text',
      title: '大纲',
      position: { x: 0, y: 0 },
      params: { text: '第一幕发生火灾' }
    }
    const target: GraphNode = {
      id: 'n2',
      category: 'asset',
      typeId: 'asset.screenplay',
      title: '剧本',
      position: { x: 200, y: 0 },
      params: {}
    }
    const graph: GraphDocument = {
      nodes: [source, target],
      edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
      viewport: { x: 0, y: 0, zoom: 1 }
    }
    const byId = new Map(graph.nodes.map((n) => [n.id, n]))
    const mentionSources = buildMentionSourcesForNode({
      graph,
      nodeId: 'n2',
      byId,
      outputs: new Map()
    })
    expect(mentionSources).toEqual([
      { index: 1, title: '大纲', text: '第一幕发生火灾', keepMentionToken: false }
    ])
    expect(expandInstructionMentions('基于 @1 扩写', mentionSources)).toContain('第一幕发生火灾')
  })
})

describe('style mention reserve indexing', () => {
  it('ports start after style reserve', () => {
    expect(portMentionIndex(0, 2)).toBe(3)
    expect(portMentionIndex(1, 2)).toBe(4)
    expect(portMentionIndex(0, 0)).toBe(1)
  })

  it('buildMentionSourcesForNode uses mentionIndexBase', () => {
    const source: GraphNode = {
      id: 'img1',
      category: 'asset',
      typeId: 'asset.image',
      assetType: 'image',
      assetId: 'a1',
      title: '角色',
      position: { x: 0, y: 0 },
      params: {}
    }
    const target: GraphNode = {
      id: 'gen',
      category: 'asset',
      typeId: 'asset.image',
      title: '生图',
      position: { x: 200, y: 0 },
      params: { nodeRole: 'processing' }
    }
    const graph: GraphDocument = {
      nodes: [source, target],
      edges: [{ id: 'e1', source: 'img1', target: 'gen' }],
      viewport: { x: 0, y: 0, zoom: 1 }
    }
    const byId = new Map(graph.nodes.map((n) => [n.id, n]))
    const sources = buildMentionSourcesForNode({
      graph,
      nodeId: 'gen',
      byId,
      outputs: new Map(),
      mentionIndexBase: 2
    })
    expect(sources).toEqual([
      { index: 3, title: '角色', text: '', keepMentionToken: true }
    ])
  })

  it('remaps port @n when style reserve changes', () => {
    const map = buildMentionIndexMapForStyleReserveChange(0, 2, 2)
    expect(remapInstructionMentions('用 @1 和 @2', map)).toBe('用 @3 和 @4')
  })

  it('reorder map respects style indexBase', () => {
    const map = buildMentionIndexMapAfterReorder(['e1', 'e2'], ['e2', 'e1'], 2)
    expect(map.get(3)).toBe(4)
    expect(map.get(4)).toBe(3)
    expect(remapInstructionMentions('参考 @3', map)).toBe('参考 @4')
  })
})

describe('shouldKeepInstructionMentionToken', () => {
  it('keeps media nodes, expands text nodes', () => {
    expect(shouldKeepInstructionMentionToken({ typeId: 'asset.image', assetType: 'image' })).toBe(
      true
    )
    expect(shouldKeepInstructionMentionToken({ typeId: 'note.text' })).toBe(false)
  })
})

describe('buildInstructionFinalPromptPreview style images', () => {
  it('appends style @n + strength for image/video (kept for API image array)', () => {
    const preview = buildInstructionFinalPromptPreview({
      kind: 'image',
      instructionRaw: '一只猫',
      sources: [],
      includeSystem: false,
      locale: 'zh-CN',
      styleImages: [{ id: '1', name: '水彩', libraryId: 'watercolor', weight: 0.8 }]
    })
    expect(preview).toContain('一只猫')
    expect(preview).toContain('参考@1「水彩」画风，强度0.8')
    expect(preview).not.toContain('画面风格：水彩')
  })

  it('keeps port media @n after style reserve (does not expand image to text)', () => {
    const preview = buildInstructionFinalPromptPreview({
      kind: 'image',
      instructionRaw: '主体参考 @2',
      sources: [
        {
          index: 2,
          title: '角色图',
          text: '不该出现在预览里的图片备注',
          keepMentionToken: true
        }
      ],
      includeSystem: false,
      locale: 'zh-CN',
      styleImages: [{ id: '1', name: '水彩', libraryId: 'watercolor', weight: 0.8 }]
    })
    expect(preview).toContain('主体参考 @2')
    expect(preview).not.toContain('不该出现在预览里的图片备注')
    expect(preview).toContain('参考@1「水彩」画风，强度0.8')
  })

  it('skips style reference line for non image/video kinds', () => {
    const preview = buildInstructionFinalPromptPreview({
      kind: 'screenplay',
      instructionRaw: '写剧本',
      sources: [],
      includeSystem: false,
      locale: 'zh-CN',
      styleImages: [{ id: '1', name: '水彩', libraryId: 'watercolor', weight: 0.8 }]
    })
    expect(preview).not.toContain('参考@1「水彩」画风')
  })
})
