import { describe, expect, it, vi } from 'vitest'
import {
  instructionHasMentions,
  selectByMentionIndexes
} from '../src/shared/graph/instructionMentions'
import {
  executeAssetNode,
  executeImageGenerateNode,
  executeGridSplitNode,
  executePromptOptimizeNode,
  executeWorldExtractNode,
  selectIncomingValuesForInstruction
} from '../src/shared/graph/execute/values'
import type { GraphValue, NodeExecuteContext } from '../src/shared/graph/execute/types'
import type { GraphNode } from '../src/shared/graph/types'
import type { GraphTextItem } from '../src/shared/graph'

function imageNode(instruction: string): GraphNode {
  return {
    id: 'img',
    category: 'asset',
    typeId: 'asset.image',
    assetType: 'image',
    title: 'Image',
    position: { x: 0, y: 0 },
    params: { generateInstruction: instruction }
  }
}

function baseCtx(
  partial: Partial<NodeExecuteContext> & { node: GraphNode }
): NodeExecuteContext {
  return {
    inputs: {},
    ...partial
  }
}

describe('selectByMentionIndexes / instructionHasMentions', () => {
  const indexed = [
    { index: 1, value: 'a' },
    { index: 2, value: 'b' },
    { index: 3, value: 'c' }
  ]

  it('keeps all when instruction has no @', () => {
    expect(instructionHasMentions('画一只猫')).toBe(false)
    expect(selectByMentionIndexes('画一只猫', indexed)).toEqual(['a', 'b', 'c'])
  })

  it('keeps only mentioned indexes when any @ is present', () => {
    expect(instructionHasMentions('只用 @2')).toBe(true)
    expect(selectByMentionIndexes('只用 @2', indexed)).toEqual(['b'])
    expect(selectByMentionIndexes('参考 @1 和 @3', indexed)).toEqual(['a', 'c'])
  })
})

describe('generation input auto-include vs @ filter', () => {
  it('image generate without @ sends all connected references', async () => {
    const generateImage = vi.fn(async () => ({
      images: ['data:image/png;base64,aaa'],
      model: 'm'
    }))
    const ctx = baseCtx({
      node: imageNode('画一只猫'),
      incomingByIndex: [
        { index: 1, value: { kind: 'image', dataUrl: 'data:image/png;base64,one' } },
        { index: 2, value: { kind: 'image', dataUrl: 'data:image/png;base64,two' } }
      ],
      inputs: {
        in: [
          { kind: 'image', dataUrl: 'data:image/png;base64,one' },
          { kind: 'image', dataUrl: 'data:image/png;base64,two' }
        ]
      },
      generateImage
    })
    await executeImageGenerateNode(ctx)
    expect(generateImage).toHaveBeenCalledOnce()
    expect(generateImage.mock.calls[0]![0].inputReferences).toEqual([
      'data:image/png;base64,one',
      'data:image/png;base64,two'
    ])
  })

  it('image generate with @ only sends mentioned references', async () => {
    const generateImage = vi.fn(async () => ({
      images: ['data:image/png;base64,aaa'],
      model: 'm'
    }))
    const ctx = baseCtx({
      node: imageNode('基于 @2 重绘'),
      mentionSources: [
        { index: 1, title: '@1', text: '' },
        { index: 2, title: '@2', text: '' }
      ],
      incomingByIndex: [
        { index: 1, value: { kind: 'image', dataUrl: 'data:image/png;base64,one' } },
        { index: 2, value: { kind: 'image', dataUrl: 'data:image/png;base64,two' } }
      ],
      inputs: {
        in: [
          { kind: 'image', dataUrl: 'data:image/png;base64,one' },
          { kind: 'image', dataUrl: 'data:image/png;base64,two' }
        ]
      },
      generateImage
    })
    await executeImageGenerateNode(ctx)
    expect(generateImage.mock.calls[0]![0].inputReferences).toEqual([
      'data:image/png;base64,two'
    ])
  })

  it('image generate allows instruction-only without connected inputs', async () => {
    const generateImage = vi.fn(async () => ({
      images: ['data:image/png;base64,aaa'],
      model: 'm'
    }))
    const ctx = baseCtx({
      node: imageNode('画一只猫'),
      inputs: {},
      generateImage
    })
    const out = await executeImageGenerateNode(ctx)
    expect(generateImage).toHaveBeenCalledOnce()
    expect(generateImage.mock.calls[0]![0].inputReferences).toBeUndefined()
    // 选中项走单值 out；全量在 out-all
    expect(out.out?.kind).toBe('image')
    expect(out['out-all']?.kind).toBe('images')
  })

  it('image generate slices references by model maxInputReferences', async () => {
    const generateImage = vi.fn(async () => ({
      images: ['data:image/png;base64,aaa'],
      model: 'm'
    }))
    const ctx = baseCtx({
      node: imageNode('画一只猫'),
      incomingByIndex: [
        { index: 1, value: { kind: 'image', dataUrl: 'data:image/png;base64,one' } },
        { index: 2, value: { kind: 'image', dataUrl: 'data:image/png;base64,two' } },
        { index: 3, value: { kind: 'image', dataUrl: 'data:image/png;base64,three' } }
      ],
      inputs: {
        in: [
          { kind: 'image', dataUrl: 'data:image/png;base64,one' },
          { kind: 'image', dataUrl: 'data:image/png;base64,two' },
          { kind: 'image', dataUrl: 'data:image/png;base64,three' }
        ]
      },
      generateImage,
      resolveImageGenerateCapabilities: async () => ({
        aspectRatios: [],
        resolutions: [],
        qualities: [],
        counts: [],
        maxInputReferences: 2
      })
    })
    await executeImageGenerateNode(ctx)
    expect(generateImage.mock.calls[0]![0].inputReferences).toEqual([
      'data:image/png;base64,one',
      'data:image/png;base64,two'
    ])
  })

  it('image generate without @ appends upstream text into prompt', async () => {
    const generateImage = vi.fn(async () => ({
      images: ['data:image/png;base64,aaa'],
      model: 'm'
    }))
    const ctx = baseCtx({
      node: imageNode('画一只猫'),
      incomingByIndex: [
        { index: 1, value: { kind: 'text', text: '赛博朋克街道，霓虹灯' } },
        { index: 2, value: { kind: 'image', dataUrl: 'data:image/png;base64,ref' } }
      ],
      inputs: {
        'in-text': [{ kind: 'text', text: '赛博朋克街道，霓虹灯' }],
        'in-image': [{ kind: 'image', dataUrl: 'data:image/png;base64,ref' }]
      },
      generateImage
    })
    await executeImageGenerateNode(ctx)
    const prompt = generateImage.mock.calls[0]![0].prompt as string
    expect(prompt).toContain('赛博朋克街道，霓虹灯')
    expect(generateImage.mock.calls[0]![0].inputReferences).toEqual([
      'data:image/png;base64,ref'
    ])
  })

  it('image generate prepends style refs and appends style prompt with @n', async () => {
    const generateImage = vi.fn(async () => ({
      images: ['data:image/png;base64,aaa'],
      model: 'm'
    }))
    const ctx = baseCtx({
      node: {
        ...imageNode('画一只猫'),
        params: {
          generateInstruction: '画一只猫',
          styleImagesUseGlobal: false,
          styleImages: [
            {
              id: 's1',
              name: '水彩',
              libraryId: 'watercolor',
              weight: 0.8,
              dataUrl: 'data:image/png;base64,style'
            }
          ]
        }
      },
      inputs: {
        'in-image': [{ kind: 'image', dataUrl: 'data:image/png;base64,port' }]
      },
      incomingByIndex: [
        { index: 1, value: { kind: 'image', dataUrl: 'data:image/png;base64,port' } }
      ],
      resolveStyleImageUrls: async (images) =>
        (images ?? [])
          .map((item) => item.dataUrl?.trim())
          .filter((url): url is string => Boolean(url?.startsWith('data:'))),
      generateImage
    })
    await executeImageGenerateNode(ctx)
    const call = generateImage.mock.calls[0]![0]
    expect(call.inputReferences).toEqual([
      'data:image/png;base64,style',
      'data:image/png;base64,port'
    ])
    expect(call.prompt).toContain('参考@1「水彩」画风，强度0.8')
  })

  it('image generate with @ does not auto-append unmentioned text', async () => {
    const generateImage = vi.fn(async () => ({
      images: ['data:image/png;base64,aaa'],
      model: 'm'
    }))
    const ctx = baseCtx({
      node: imageNode('基于 @2 重绘'),
      mentionSources: [
        { index: 1, title: '@1', text: '不要拼这段' },
        { index: 2, title: '@2', text: '' }
      ],
      incomingByIndex: [
        { index: 1, value: { kind: 'text', text: '不要拼这段' } },
        { index: 2, value: { kind: 'image', dataUrl: 'data:image/png;base64,ref' } }
      ],
      inputs: {
        'in-text': [{ kind: 'text', text: '不要拼这段' }],
        'in-image': [{ kind: 'image', dataUrl: 'data:image/png;base64,ref' }]
      },
      generateImage
    })
    await executeImageGenerateNode(ctx)
    const prompt = generateImage.mock.calls[0]![0].prompt as string
    expect(prompt).not.toContain('不要拼这段')
    expect(generateImage.mock.calls[0]![0].inputReferences).toEqual([
      'data:image/png;base64,ref'
    ])
  })

  it('world extract without @ auto-appends input interface text', async () => {
    const generateText = vi.fn(async () => ({
      text: '{"characters":[],"scenes":[],"props":[],"weapons":[]}',
      model: 'm'
    }))
    const upstream: GraphValue = { kind: 'text', text: '输入接口剧本正文' }
    const ctx = baseCtx({
      node: {
        id: 'extract',
        category: 'note',
        typeId: 'world.extract',
        title: 'World extract',
        position: { x: 0, y: 0 },
        params: { generateInstruction: '提取世界元素' }
      },
      incomingByIndex: [{ index: 1, value: upstream }],
      inputs: { in: [upstream] },
      mentionSources: [{ index: 1, title: '输入接口', text: '输入接口剧本正文' }],
      generateText
    })
    await executeWorldExtractNode(ctx)
    expect(generateText.mock.calls[0]![0].prompt).toContain('输入接口剧本正文')
  })

  it('world extract without @ falls back to mentionSources when port text empty', async () => {
    const generateText = vi.fn(async () => ({
      text: '{"characters":[],"scenes":[],"props":[],"weapons":[]}',
      model: 'm'
    }))
    const empty: GraphValue = { kind: 'text', text: '' }
    const ctx = baseCtx({
      node: {
        id: 'extract',
        category: 'note',
        typeId: 'world.extract',
        title: 'World extract',
        position: { x: 0, y: 0 },
        params: { generateInstruction: '提取世界元素' }
      },
      incomingByIndex: [{ index: 1, value: empty }],
      inputs: { in: [empty] },
      mentionSources: [{ index: 1, title: '输入接口', text: '槽位缓存正文' }],
      generateText
    })
    await executeWorldExtractNode(ctx)
    expect(generateText.mock.calls[0]![0].prompt).toContain('槽位缓存正文')
  })

  it('world extract with @ does not auto-append unmentioned upstream', async () => {
    const generateText = vi.fn(async () => ({
      text: '{"characters":[],"scenes":[],"props":[],"weapons":[]}',
      model: 'm'
    }))
    const a: GraphValue = { kind: 'text', text: '内容A' }
    const b: GraphValue = { kind: 'text', text: '内容B' }
    const ctx = baseCtx({
      node: {
        id: 'extract',
        category: 'note',
        typeId: 'world.extract',
        title: 'World extract',
        position: { x: 0, y: 0 },
        params: { generateInstruction: '只提取 @1' }
      },
      incomingByIndex: [
        { index: 1, value: a },
        { index: 2, value: b }
      ],
      inputs: { in: [a, b] },
      mentionSources: [
        { index: 1, title: 'A', text: '内容A' },
        { index: 2, title: 'B', text: '内容B' }
      ],
      generateText
    })
    await executeWorldExtractNode(ctx)
    const prompt = generateText.mock.calls[0]![0].prompt as string
    expect(prompt).toContain('内容A')
    expect(prompt).not.toContain('内容B')
  })

  it('prompt optimize without @ auto-appends upstream text', async () => {
    const generateText = vi.fn(async () => ({
      text: 'optimized',
      model: 'm'
    }))
    const upstream: GraphValue = { kind: 'text', text: '上游剧本正文' }
    const ctx = baseCtx({
      node: {
        id: 'opt',
        category: 'note',
        typeId: 'prompt.optimize',
        title: 'Optimize',
        position: { x: 0, y: 0 },
        params: { generateInstruction: '请优化以下内容' }
      },
      incomingByIndex: [{ index: 1, value: upstream }],
      inputs: { in: [upstream] },
      mentionSources: [{ index: 1, title: '上游', text: '上游剧本正文' }],
      generateText
    })
    await executePromptOptimizeNode(ctx)
    expect(generateText.mock.calls[0]![0].prompt).toContain('上游剧本正文')
  })

  it('prompt optimize without @ falls back to mentionSources when port text empty', async () => {
    const generateText = vi.fn(async () => ({
      text: 'optimized',
      model: 'm'
    }))
    const empty: GraphValue = { kind: 'text', text: '' }
    const ctx = baseCtx({
      node: {
        id: 'opt',
        category: 'note',
        typeId: 'prompt.optimize',
        title: 'Optimize',
        position: { x: 0, y: 0 },
        params: { generateInstruction: '请优化以下内容' }
      },
      incomingByIndex: [{ index: 1, value: empty }],
      inputs: { in: [empty] },
      mentionSources: [{ index: 1, title: '输入接口', text: '槽位缓存正文' }],
      generateText
    })
    await executePromptOptimizeNode(ctx)
    expect(generateText.mock.calls[0]![0].prompt).toContain('槽位缓存正文')
  })

  it('prompt optimize with @ does not auto-append unmentioned upstream', async () => {
    const generateText = vi.fn(async () => ({ text: 'optimized', model: 'm' }))
    const a: GraphValue = { kind: 'text', text: '内容A' }
    const b: GraphValue = { kind: 'text', text: '内容B' }
    const ctx = baseCtx({
      node: {
        id: 'opt',
        category: 'note',
        typeId: 'prompt.optimize',
        title: 'Optimize',
        position: { x: 0, y: 0 },
        params: { generateInstruction: '只改写 @1' }
      },
      incomingByIndex: [
        { index: 1, value: a },
        { index: 2, value: b }
      ],
      inputs: { in: [a, b] },
      mentionSources: [
        { index: 1, title: 'A', text: '内容A' },
        { index: 2, title: 'B', text: '内容B' }
      ],
      generateText
    })
    await executePromptOptimizeNode(ctx)
    const prompt = generateText.mock.calls[0]![0].prompt as string
    expect(prompt).toContain('内容A')
    expect(prompt).not.toContain('内容B')
  })

  it('prompt optimize accumulates text history and returns out + out-all', async () => {
    const generateText = vi.fn(async () => ({ text: 'version-1', model: 'm' }))
    const ctx = baseCtx({
      node: {
        id: 'opt',
        category: 'note',
        typeId: 'prompt.optimize',
        title: 'Optimize',
        position: { x: 0, y: 0 },
        params: { generateInstruction: '请优化' }
      },
      generateText
    })
    const first = await executePromptOptimizeNode(ctx)
    expect(first.out).toMatchObject({ kind: 'text', text: 'version-1' })
    expect(first['out-all']).toMatchObject({ kind: 'texts' })
    expect((ctx.node.params.generatedTexts as GraphTextItem[]).length).toBe(1)

    generateText.mockResolvedValue({ text: 'version-2', model: 'm' })
    const second = await executePromptOptimizeNode(ctx)
    const items = ctx.node.params.generatedTexts as GraphTextItem[]
    expect(items.length).toBe(2)
    expect(items[1]?.text).toBe('version-2')
    expect(second.out).toMatchObject({ kind: 'text', text: 'version-2' })
    expect((second['out-all'] as { items: GraphTextItem[] }).items.length).toBe(2)
  })

  it('grid split upscale prefers configured aspect ratio', async () => {
    const generateImage = vi.fn(async () => ({
      images: ['data:image/png;base64,cell-upscaled'],
      model: 'm'
    }))
    const ctx = baseCtx({
      node: {
        id: 'split',
        category: 'note',
        typeId: 'image.gridSplit',
        title: 'Split',
        position: { x: 0, y: 0 },
        params: {
          generateAspectRatio: '16:9',
          imageGridSplit: { rows: 2, cols: 2, selected: ['1-1'], scale: 2 }
        }
      },
      inputs: { in: [{ kind: 'image', dataUrl: 'data:image/png;base64,canvas' }] },
      composeImageGridCell: async ({ cellKey }) => ({
        dataUrl: 'data:image/png;base64,cell',
        width: 500,
        height: 500,
        cellKey
      }),
      generateImage
    })
    await executeGridSplitNode(ctx)
    expect(generateImage.mock.calls[0]![0].aspectRatio).toBe('16:9')
  })

  it('video generate with text-only input does not throw no-input', async () => {
    const text: GraphValue = { kind: 'text', text: '分镜提示词' }
    const out = await executeAssetNode(
      baseCtx({
        node: {
          id: 'vid',
          category: 'asset',
          typeId: 'asset.video',
          assetType: 'video',
          title: 'Video',
          position: { x: 0, y: 0 },
          params: { generateInstruction: '' }
        },
        incomingByIndex: [{ index: 1, value: text }],
        inputs: { 'in-text': [text] },
        mentionSources: [{ index: 1, title: '参数', text: '分镜提示词' }]
      })
    )
    expect(out).toEqual({ out: { kind: 'text', text: '分镜提示词' } })
  })

  it('selectIncomingValuesForInstruction filters by @', () => {
    const a: GraphValue = { kind: 'text', text: 'A' }
    const b: GraphValue = { kind: 'text', text: 'B' }
    const ctx = baseCtx({
      node: imageNode('x'),
      incomingByIndex: [
        { index: 1, value: a },
        { index: 2, value: b }
      ]
    })
    expect(selectIncomingValuesForInstruction(ctx, '无引用')).toEqual([a, b])
    expect(selectIncomingValuesForInstruction(ctx, '只要 @1')).toEqual([a])
  })
})
