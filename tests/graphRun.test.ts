import { describe, expect, it, vi } from 'vitest'
import {
  boundaryOutputNodeId,
  createNodeFromType,
  createOutputGraphNode,
  createDefaultScopedGraph,
  runGraph
} from '../src/shared/graph'
import { graphOutputNodeId } from '../src/shared/graph/types'

const TEXT_OUTPUT_ID = graphOutputNodeId('text')
const IMAGE_OUTPUT_ID = graphOutputNodeId('image')

describe('graph run', () => {
  it('merges play.script text through screenplay processing into output notes', async () => {
    const text = createNodeFromType('play.script', { x: 0, y: 0 }, {
      params: { text: '开场独白' }
    })
    const screenplay = createNodeFromType('asset.screenplay', { x: 200, y: 0 })
    const output = createOutputGraphNode('text', { x: 400, y: 0 }, {
      id: TEXT_OUTPUT_ID
    })

    const result = await runGraph(
      {
        nodes: [text, screenplay, output],
        edges: [
          {
            id: 'e1',
            source: text.id,
            target: screenplay.id,
            sourcePort: 'out',
            targetPort: 'in'
          },
          {
            id: 'e2',
            source: screenplay.id,
            target: output.id,
            sourcePort: 'out',
            targetPort: 'in'
          }
        ],
        viewport: { x: 0, y: 0, zoom: 1 }
      },
      { stepDelayMs: 1 }
    )

    expect(result.ok, result.error).toBe(true)
    expect(result.contribution?.genRefs.length ?? 0).toBe(0)
    expect(result.output?.notes.map((item) => item.text).join('\n')).toContain('开场独白')
  })

  it('preserves outside nodes when running to a target with preserveOutsideSubset', async () => {
    const a = createNodeFromType('play.script', { x: 0, y: 0 }, {
      id: 'a',
      params: { text: 'A' }
    })
    const b = createNodeFromType('asset.screenplay', { x: 120, y: 0 }, { id: 'b' })
    const c = createNodeFromType('asset.screenplay', { x: 240, y: 80 }, { id: 'c' })
    const updates: Array<{ id: string; status: string }> = []

    await runGraph(
      {
        nodes: [a, b, c],
        edges: [
          {
            id: 'e1',
            source: 'a',
            target: 'b',
            sourcePort: 'out',
            targetPort: 'in'
          }
        ],
        viewport: { x: 0, y: 0, zoom: 1 }
      },
      {
        stepDelayMs: 1,
        targetNodeId: 'b',
        preserveOutsideSubset: true,
        onNodeUpdate: (id, state) => {
          updates.push({ id, status: state.status })
        }
      }
    )

    expect(updates.some((u) => u.id === 'c' && u.status === 'skipped')).toBe(false)
    expect(updates.some((u) => u.id === 'b' && u.status === 'done')).toBe(true)
  })

  it('generates screenplay text via generateText service and patches node', async () => {
    const text = createNodeFromType('play.script', { x: 0, y: 0 }, {
      params: { text: '草稿' }
    })
    const screenplay = createNodeFromType('asset.screenplay', { x: 200, y: 0 }, {
      id: 'sp-1',
      params: { text: '…', generateInstruction: '写成完整剧本' }
    })
    const patches: Array<{ id: string; text?: string; generatedCount?: number }> = []

    const result = await runGraph(
      {
        nodes: [text, screenplay],
        edges: [
          {
            id: 'e1',
            source: text.id,
            target: screenplay.id,
            sourcePort: 'out',
            targetPort: 'in'
          }
        ],
        viewport: { x: 0, y: 0, zoom: 1 }
      },
      {
        stepDelayMs: 1,
        targetNodeId: 'sp-1',
        preserveOutsideSubset: true,
        generateText: async () => ({ text: '完整故事剧本正文', model: 'test' }),
        onNodePatch: (nodeId, patch) => {
          patches.push({
            id: nodeId,
            text: patch.params?.text,
            generatedCount: patch.params?.generatedTexts?.length
          })
        }
      }
    )

    expect(result.ok, result.error).toBe(true)
    expect(patches).toEqual([
      { id: 'sp-1', text: '完整故事剧本正文', generatedCount: 1 }
    ])
    expect(result.states['sp-1']?.outputs?.out).toMatchObject({
      kind: 'text',
      text: '完整故事剧本正文'
    })
    expect(result.states['sp-1']?.outputs?.['out-all']).toMatchObject({
      kind: 'texts',
      items: [{ text: '完整故事剧本正文' }]
    })
  })

  it('onlyTargetNode executes a single node without re-running upstream generateText', async () => {
    const text = createNodeFromType('play.script', { x: 0, y: 0 }, {
      id: 't1',
      params: { text: '草稿' }
    })
    const screenplay = createNodeFromType('asset.screenplay', { x: 200, y: 0 }, {
      id: 'sp',
      params: { text: '旧文本', generateInstruction: '扩写' }
    })
    let calls = 0

    const result = await runGraph(
      {
        nodes: [text, screenplay],
        edges: [
          {
            id: 'e1',
            source: 't1',
            target: 'sp',
            sourcePort: 'out',
            targetPort: 'in'
          }
        ],
        viewport: { x: 0, y: 0, zoom: 1 }
      },
      {
        stepDelayMs: 1,
        targetNodeId: 'sp',
        onlyTargetNode: true,
        preserveOutsideSubset: true,
        generateText: async () => {
          calls += 1
          return { text: '仅当前节点生成', model: 'm' }
        }
      }
    )

    expect(result.ok, result.error).toBe(true)
    expect(result.order).toEqual(['sp'])
    expect(calls).toBe(1)
    expect(result.states.sp?.outputs?.out).toMatchObject({
      kind: 'text',
      text: '仅当前节点生成'
    })
    expect(result.states.sp?.outputs?.['out-all']).toMatchObject({
      kind: 'texts',
      items: [{ text: '仅当前节点生成' }]
    })
  })

  it('onlyTargetNode soft-passthroughs boundary.output from upstream gallery without generateImage', async () => {
    const boutId = boundaryOutputNodeId('out')
    const gen = createNodeFromType('asset.image', { x: 0, y: 0 }, {
      id: 'gen',
      params: {
        generatedImages: [
          {
            id: 'pick',
            dataUrl: 'data:image/png;base64,PICK',
            relativePath: 'Cache/Images/pick.png'
          }
        ],
        selectedImageId: 'pick'
      }
    })
    const boundary = createNodeFromType('graph.boundary.output', { x: 200, y: 0 }, {
      id: boutId,
      params: { hostBoundaryPort: { portId: 'out', dataType: 'image' } }
    })
    const generateImage = vi.fn(async () => ({
      images: ['data:image/png;base64,SHOULD_NOT'],
      model: 'm'
    }))

    const result = await runGraph(
      {
        nodes: [gen, boundary],
        edges: [
          {
            id: 'e1',
            source: 'gen',
            target: boutId,
            sourcePort: 'out',
            targetPort: 'in'
          }
        ],
        viewport: { x: 0, y: 0, zoom: 1 }
      },
      {
        stepDelayMs: 1,
        targetNodeId: boutId,
        onlyTargetNode: true,
        preserveOutsideSubset: true,
        generateImage
      }
    )

    expect(result.ok, result.error).toBe(true)
    expect(result.order).toEqual([boutId])
    expect(generateImage).not.toHaveBeenCalled()
    expect(result.states[boutId]?.outputs?.out).toMatchObject({
      kind: 'image',
      id: 'pick',
      relativePath: 'Cache/Images/pick.png'
    })
    // 画布备注卡依赖边界节点 params 上的预览路径
    expect(boundary.params.previewRelativePath).toBe('Cache/Images/pick.png')
    expect(boundary.params.previewCollapsed).toBe(false)
  })

  it('onlyTargetNode ignores empty prior text and re-resolves screenplay ref', async () => {
    const assetId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    const ref = createNodeFromType('asset.screenplay', { x: 0, y: 0 }, {
      id: 'ref',
      assetId,
      assetType: 'screenplay',
      params: { assetRef: true }
    })
    const split = createNodeFromType('beat.split', { x: 200, y: 0 }, {
      id: 'split'
    })
    let promptSeen = ''

    const result = await runGraph(
      {
        nodes: [ref, split],
        edges: [
          {
            id: 'e-ref-split',
            source: 'ref',
            target: 'split',
            sourcePort: 'out',
            targetPort: 'in'
          }
        ],
        viewport: { x: 0, y: 0, zoom: 1 }
      },
      {
        stepDelayMs: 1,
        targetNodeId: 'split',
        onlyTargetNode: true,
        preserveOutsideSubset: true,
        priorNodeStates: {
          ref: {
            status: 'done',
            outputs: { out: { kind: 'text', text: '' } }
          }
        },
        resolveAssetText: async (id) => (id === assetId ? '缓存为空后重读正文' : undefined),
        generateText: async ({ prompt }) => {
          promptSeen = prompt
          return {
            text: JSON.stringify([
              {
                id: 'nu-1',
                title: '开场',
                order: 1,
                summary: '登场',
                dramaticFunction: '建置',
                characters: [],
                scenes: [],
                props: [],
                weapons: [],
                sourceExcerpt: '',
                emotionalBeat: '',
                durationHint: '',
                status: '未审核'
              }
            ]),
            model: 'm'
          }
        }
      }
    )

    expect(result.ok, result.error).toBe(true)
    expect(promptSeen).toContain('缓存为空后重读正文')
  })

  it('onlyTargetNode soft-snapshots screenplay asset ref text into beat.split', async () => {
    const assetId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    const ref = createNodeFromType('asset.screenplay', { x: 0, y: 0 }, {
      id: 'ref',
      assetId,
      assetType: 'screenplay',
      params: { assetRef: true }
    })
    const split = createNodeFromType('beat.split', { x: 200, y: 0 }, {
      id: 'split'
    })
    let promptSeen = ''

    const result = await runGraph(
      {
        nodes: [ref, split],
        edges: [
          {
            id: 'e-ref-split',
            source: 'ref',
            target: 'split',
            sourcePort: 'out',
            targetPort: 'in'
          }
        ],
        viewport: { x: 0, y: 0, zoom: 1 }
      },
      {
        stepDelayMs: 1,
        targetNodeId: 'split',
        onlyTargetNode: true,
        preserveOutsideSubset: true,
        resolveAssetText: async (id) => (id === assetId ? '雨夜开场剧本正文' : undefined),
        generateText: async ({ prompt }) => {
          promptSeen = prompt
          return {
            text: JSON.stringify([
              {
                id: 'nu-1',
                title: '开场',
                order: 1,
                summary: '登场',
                dramaticFunction: '建置',
                characters: ['林晓'],
                scenes: ['街道'],
                props: [],
                weapons: [],
                sourceExcerpt: '……',
                emotionalBeat: '平静',
                durationHint: '中',
                status: '未审核'
              }
            ]),
            model: 'm'
          }
        }
      }
    )

    expect(result.ok, result.error).toBe(true)
    expect(promptSeen).toContain('雨夜开场剧本正文')
    expect(result.states.split?.outputs?.out).toMatchObject({
      kind: 'beat'
    })
  })

  it('skipCompletedNodes never skips any multi-target sink', async () => {
    const shared = createNodeFromType('play.script', { x: 0, y: 0 }, {
      id: 'shared',
      params: { text: '共同上游' }
    })
    const outA = createNodeFromType('asset.screenplay', { x: 200, y: 0 }, {
      id: 'out-a',
      params: { text: '', generateInstruction: 'A' }
    })
    const outB = createNodeFromType('asset.screenplay', { x: 200, y: 80 }, {
      id: 'out-b',
      params: { text: '', generateInstruction: 'B' }
    })
    const called: string[] = []
    const result = await runGraph(
      {
        nodes: [shared, outA, outB],
        edges: [
          {
            id: 'e1',
            source: 'shared',
            target: 'out-a',
            sourcePort: 'out',
            targetPort: 'in'
          },
          {
            id: 'e2',
            source: 'shared',
            target: 'out-b',
            sourcePort: 'out',
            targetPort: 'in'
          }
        ],
        viewport: { x: 0, y: 0, zoom: 1 }
      },
      {
        stepDelayMs: 1,
        targetNodeIds: ['out-a', 'out-b'],
        skipCompletedNodes: true,
        priorNodeStates: {
          shared: {
            status: 'done',
            outputs: { out: { kind: 'text', text: '共同上游' } }
          },
          'out-a': {
            status: 'done',
            outputs: { out: { kind: 'text', text: '旧A' } }
          },
          'out-b': {
            status: 'done',
            outputs: { out: { kind: 'text', text: '旧B' } }
          }
        },
        generateText: async ({ prompt }) => {
          called.push(prompt)
          return { text: `新:${prompt}`, model: 'm' }
        }
      }
    )
    expect(result.ok, result.error).toBe(true)
    expect(result.states.shared?.status).toBe('done')
    expect(called.length).toBe(2)
    expect(result.states['out-a']?.outputs?.out).toMatchObject({ kind: 'text' })
    expect(result.states['out-b']?.outputs?.out).toMatchObject({ kind: 'text' })
  })

  it('skipCompletedNodes reuses done upstream and still runs the target', async () => {
    const mid = createNodeFromType('play.script', { x: 120, y: 0 }, {
      id: 'mid',
      params: { text: '已缓存中游' }
    })
    const target = createNodeFromType('asset.screenplay', { x: 240, y: 0 }, {
      id: 'sp',
      params: { text: '旧目标', generateInstruction: '扩写目标' }
    })
    const called: string[] = []

    const result = await runGraph(
      {
        nodes: [mid, target],
        edges: [
          {
            id: 'e2',
            source: 'mid',
            target: 'sp',
            sourcePort: 'out',
            targetPort: 'in'
          }
        ],
        viewport: { x: 0, y: 0, zoom: 1 }
      },
      {
        stepDelayMs: 1,
        targetNodeId: 'sp',
        preserveOutsideSubset: true,
        skipCompletedNodes: true,
        priorNodeStates: {
          mid: {
            status: 'done',
            outputs: { out: { kind: 'text', text: '已缓存中游' } }
          }
        },
        generateText: async ({ prompt }) => {
          called.push(prompt)
          return { text: '新目标文本', model: 'm' }
        }
      }
    )

    expect(result.ok, result.error).toBe(true)
    expect(result.states.mid?.status).toBe('done')
    expect(result.states.sp?.outputs?.out).toMatchObject({
      kind: 'text',
      text: '新目标文本'
    })
    expect(result.states.sp?.outputs?.['out-all']).toMatchObject({
      kind: 'texts',
      items: [{ text: '新目标文本' }]
    })
    expect(called.length).toBe(1)
  })

  it('screenplay output node passes text through without calling generateText twice', async () => {
    const screenplay = createNodeFromType('asset.screenplay', { x: 0, y: 0 }, {
      id: 'sp',
      params: { text: '已有剧本' }
    })
    const output = createOutputGraphNode('text', { x: 200, y: 0 }, {
      id: TEXT_OUTPUT_ID,
      title: 'Screenplay output'
    })
    let generateCalls = 0

    const result = await runGraph(
      {
        nodes: [screenplay, output],
        edges: [
          {
            id: 'e1',
            source: 'sp',
            target: TEXT_OUTPUT_ID,
            sourcePort: 'out',
            targetPort: 'in'
          }
        ],
        viewport: { x: 0, y: 0, zoom: 1 }
      },
      {
        stepDelayMs: 1,
        generateText: async () => {
          generateCalls += 1
          return { text: '生成结果', model: 'x' }
        }
      }
    )

    expect(result.ok, result.error).toBe(true)
    expect(generateCalls).toBe(1)
    expect(result.states[TEXT_OUTPUT_ID]?.outputs?.out).toMatchObject({
      kind: 'output',
      outputKind: 'text',
      texts: [{ text: '生成结果' }]
    })
    expect(result.output?.texts?.map((n) => n.text).join('\n')).toContain('生成结果')
    expect(result.output?.notes.map((n) => n.text).join('\n')).toContain('生成结果')
  })

  it('screenplay generate with saveRunText transmits relativePath without inline text', async () => {
    const screenplay = createNodeFromType('asset.screenplay', { x: 0, y: 0 }, {
      id: 'sp',
      title: '雨夜',
      params: { generateInstruction: '写剧本' }
    })
    const output = createOutputGraphNode('text', { x: 200, y: 0 }, {
      id: TEXT_OUTPUT_ID
    })
    const files = new Map<string, string>()
    const keys: string[] = []
    const result = await runGraph(
      {
        nodes: [screenplay, output],
        edges: [
          {
            id: 'e1',
            source: 'sp',
            target: TEXT_OUTPUT_ID,
            sourcePort: 'out',
            targetPort: 'in'
          }
        ],
        viewport: { x: 0, y: 0, zoom: 1 }
      },
      {
        stepDelayMs: 1,
        generateText: async () => ({
          text: '剧本名：落盘测试\n\n落盘剧本正文',
          model: 'x'
        }),
        saveRunText: async ({ content, key }) => {
          keys.push(key)
          const relativePath = `Texts/${key}.txt`
          files.set(relativePath, content)
          return relativePath
        },
        readRunText: async (relativePath) => files.get(relativePath) ?? ''
      }
    )
    expect(result.ok, result.error).toBe(true)
    expect(keys).toHaveLength(1)
    expect(keys[0]).toMatch(/^落盘测试_雨夜_\d{8}-\d{9}$/)
    const relativePath = `Texts/${keys[0]}.txt`
    expect(result.states.sp?.outputs?.out).toMatchObject({
      kind: 'text',
      text: '',
      relativePath
    })
    expect(result.states.sp?.outputs?.['out-all']).toMatchObject({
      kind: 'texts',
      items: [{ text: '', relativePath }]
    })
    expect(result.states[TEXT_OUTPUT_ID]?.outputs?.out).toMatchObject({
      kind: 'output',
      texts: [{ text: '', relativePath }],
      notes: [{ kind: 'text', text: '剧本名：落盘测试\n\n落盘剧本正文' }]
    })
    expect(screenplay.params.generatedTexts?.[0]).toMatchObject({
      text: '',
      relativePath
    })
    // 节点本地编辑仍保留最近一次全文
    expect(screenplay.params.text).toBe('剧本名：落盘测试\n\n落盘剧本正文')
  })

  it('screenplay generate file key falls back to host name when title line missing', async () => {
    const screenplay = createNodeFromType('asset.screenplay', { x: 0, y: 0 }, {
      id: 'sp',
      title: '节点标题',
      params: {
        generateInstruction: '写剧本',
        generatedTexts: [
          { id: 't1', text: '', createdAt: '2026-01-01T00:00:00.000Z', relativePath: 'Texts/a.txt' }
        ]
      }
    })
    const keys: string[] = []
    const result = await runGraph(
      {
        nodes: [screenplay],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 }
      },
      {
        stepDelayMs: 1,
        targetNodeId: 'sp',
        onlyTargetNode: true,
        generateText: async () => ({ text: '第二版', model: 'x' }),
        resolveHostAssetName: () => '雨夜剧本',
        saveRunText: async ({ key }) => {
          keys.push(key)
          return `Texts/${key}.txt`
        }
      }
    )
    expect(result.ok, result.error).toBe(true)
    expect(keys).toHaveLength(1)
    expect(keys[0]).toMatch(/^雨夜剧本_节点标题_\d{8}-\d{9}$/)
  })

  it('screenplay generate file key prefers title line from generated text', async () => {
    const screenplay = createNodeFromType('asset.screenplay', { x: 0, y: 0 }, {
      id: 'sp',
      title: '节点标题',
      params: { generateInstruction: '写剧本' }
    })
    const keys: string[] = []
    const result = await runGraph(
      {
        nodes: [screenplay],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 }
      },
      {
        stepDelayMs: 1,
        targetNodeId: 'sp',
        onlyTargetNode: true,
        generateText: async () => ({
          text: '剧本名：潮汐\n\n第一场 外景 海边 夜\n浪打上岸。',
          model: 'x'
        }),
        resolveHostAssetName: () => '雨夜剧本',
        saveRunText: async ({ key }) => {
          keys.push(key)
          return `Texts/${key}.txt`
        }
      }
    )
    expect(result.ok, result.error).toBe(true)
    expect(keys).toHaveLength(1)
    expect(keys[0]).toMatch(/^潮汐_节点标题_\d{8}-\d{9}$/)
  })

  it('screenplay output receives accumulated generatedTexts after multiple runs', async () => {
    const screenplay = createNodeFromType('asset.screenplay', { x: 0, y: 0 }, {
      id: 'sp',
      params: { generateInstruction: '写剧本' }
    })
    const output = createOutputGraphNode('text', { x: 200, y: 0 }, {
      id: TEXT_OUTPUT_ID
    })
    const doc = {
      nodes: [screenplay, output],
      edges: [
        {
          id: 'e1',
          source: 'sp',
          target: TEXT_OUTPUT_ID,
          sourcePort: 'out',
          targetPort: 'in'
        }
      ],
      viewport: { x: 0, y: 0, zoom: 1 }
    }
    let n = 0
    const generateText = async () => {
      n += 1
      return { text: `剧本版本${n}`, model: 'x' }
    }

    const first = await runGraph(doc, { stepDelayMs: 1, generateText })
    expect(first.ok, first.error).toBe(true)
    expect(first.states.sp?.outputs?.out).toMatchObject({ kind: 'text', text: '剧本版本1' })
    // 把第一次落盘的 generatedTexts 写回节点，模拟第二次执行前的状态
    const firstTexts = screenplay.params.generatedTexts ?? []
    expect(firstTexts.length).toBe(1)
    screenplay.params = {
      ...screenplay.params,
      generatedTexts: firstTexts.map((item) => ({
        id: item.id || 't1',
        text: item.text,
        createdAt: item.createdAt,
        ...(item.relativePath ? { relativePath: item.relativePath } : {})
      })),
      selectedTextId: firstTexts[0]?.id || 't1'
    }

    // 全量历史走 out-all；默认 out 仅为最新一条
    doc.edges = [
      {
        id: 'e1',
        source: 'sp',
        target: TEXT_OUTPUT_ID,
        sourcePort: 'out-all',
        targetPort: 'in'
      }
    ]

    const second = await runGraph(doc, { stepDelayMs: 1, generateText })
    expect(second.ok, second.error).toBe(true)
    expect(screenplay.params.selectedTextId).toBeTruthy()
    expect(second.states.sp?.outputs?.out).toMatchObject({
      kind: 'text',
      text: '剧本版本2'
    })
    expect(second.states.sp?.outputs?.['out-all']).toMatchObject({
      kind: 'texts',
      items: [{ text: '剧本版本1' }, { text: '剧本版本2' }]
    })
    expect(second.states[TEXT_OUTPUT_ID]?.outputs?.out).toMatchObject({
      kind: 'output',
      texts: [{ text: '剧本版本1' }, { text: '剧本版本2' }]
    })
  })

  it('merges director deck images into output.images (not genRefs)', async () => {
    const motion = createNodeFromType('asset.motion', { x: 0, y: 0 }, {
      id: 'motion',
      params: {
        cameraShots: [
          {
            id: 'shot:0',
            dataUrl: 'data:image/png;base64,dir',
            createdAt: '2026-01-01T00:00:00.000Z'
          }
        ]
      }
    })
    const select = createNodeFromType('image.select', { x: 120, y: 0 }, { id: 'pick' })
    const output = createOutputGraphNode('image', { x: 240, y: 0 }, {
      id: IMAGE_OUTPUT_ID,
      title: 'Director deck output',
      params: { outputKind: 'image', inputDataType: 'image' }
    })

    const result = await runGraph(
      {
        nodes: [motion, select, output],
        edges: [
          {
            id: 'e1',
            source: 'motion',
            target: 'pick',
            sourcePort: 'out-shots',
            targetPort: 'in'
          },
          {
            id: 'e2',
            source: 'pick',
            target: IMAGE_OUTPUT_ID,
            sourcePort: 'out',
            targetPort: 'in'
          }
        ],
        viewport: { x: 0, y: 0, zoom: 1 }
      },
      { stepDelayMs: 1 }
    )

    expect(result.ok, result.error).toBe(true)
    expect(result.contribution?.genRefs.length ?? 0).toBe(0)
    expect(result.output?.images?.map((item) => item.dataUrl)).toEqual([
      'data:image/png;base64,dir'
    ])
  })

  it('runs independent fan-in sources in parallel then skips only downstream on failure', async () => {
    const a = createNodeFromType('asset.screenplay', { x: 0, y: 0 }, {
      id: 'a',
      params: { generateInstruction: '写 A' }
    })
    const b = createNodeFromType('asset.screenplay', { x: 0, y: 80 }, {
      id: 'b',
      params: { generateInstruction: '写 B' }
    })
    const output = createOutputGraphNode('text', { x: 240, y: 40 }, {
      id: TEXT_OUTPUT_ID
    })
    let inflight = 0
    let maxInflight = 0
    const result = await runGraph(
      {
        nodes: [a, b, output],
        edges: [
          {
            id: 'e1',
            source: 'a',
            target: TEXT_OUTPUT_ID,
            sourcePort: 'out',
            targetPort: 'in'
          },
          {
            id: 'e2',
            source: 'b',
            target: TEXT_OUTPUT_ID,
            sourcePort: 'out',
            targetPort: 'in'
          }
        ],
        viewport: { x: 0, y: 0, zoom: 1 }
      },
      {
        stepDelayMs: 1,
        generateText: async ({ prompt }) => {
          inflight += 1
          maxInflight = Math.max(maxInflight, inflight)
          await new Promise((r) => setTimeout(r, 30))
          inflight -= 1
          if (prompt.includes('写 A')) throw new Error('provider unavailable')
          return { text: 'ok-b', model: 'x' }
        }
      }
    )

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/provider unavailable/)
    expect(maxInflight).toBeGreaterThanOrEqual(2)
    expect(result.states.a?.status).toBe('error')
    expect(result.states.b?.status).toBe('done')
    expect(result.states[TEXT_OUTPUT_ID]?.status).toBe('skipped')
    expect(
      Object.values(result.states).some((s) => s.status === 'pending' || s.status === 'running')
    ).toBe(false)
  })

  it('world.gen collects element entities into four image group outputs', async () => {
    const doc = createDefaultScopedGraph('worldAsset', 'world')
    const editor = doc.nodes.find((node) => node.typeId === 'world.gen')
    expect(editor).toBeTruthy()

    const result = await runGraph(doc, {
      stepDelayMs: 1,
      targetNodeId: editor!.id,
      onlyTargetNode: true,
      collectWorldElementOutputs: async () => ({
        items: [
          {
            type: '角色',
            name: 'Hero',
            imageUrl: '.aiartengine/graph-outputs/hero.png'
          },
          {
            type: '场景',
            name: 'Town',
            imageUrl: '.aiartengine/graph-outputs/town.png'
          }
        ]
      })
    })

    expect(result.ok, result.error).toBe(true)
    const editorState = result.states[editor!.id]
    expect(editorState?.status).toBe('done')
    expect(editorState?.outputs?.out).toBeUndefined()
    const characters = editorState?.outputs?.['out-characters']
    expect(characters?.kind).toBe('images')
    if (characters?.kind === 'images') {
      expect(characters.items).toEqual([
        {
          id: '角色:Hero:0',
          title: 'Hero',
          dataUrl: '',
          relativePath: '.aiartengine/graph-outputs/hero.png'
        }
      ])
    }
    const scenes = editorState?.outputs?.['out-scenes']
    expect(scenes?.kind).toBe('images')
    if (scenes?.kind === 'images') {
      expect(scenes.items.map((item) => item.relativePath)).toEqual([
        '.aiartengine/graph-outputs/town.png'
      ])
    }
    expect(editorState?.outputs?.['out-props']?.kind).toBe('images')
    expect(editorState?.outputs?.['out-weapons']?.kind).toBe('images')
    expect(editor?.params.worldElementOutputs).toEqual([
      {
        type: '角色',
        name: 'Hero',
        imageUrl: '.aiartengine/graph-outputs/hero.png'
      },
      {
        type: '场景',
        name: 'Town',
        imageUrl: '.aiartengine/graph-outputs/town.png'
      }
    ])
  })

  it('batch cook nodes: onlyTarget skips cookBatch; Cook / chain enables it', async () => {
    const worldDoc = createDefaultScopedGraph('worldAsset', 'world')
    const worldGen = worldDoc.nodes.find((node) => node.typeId === 'world.gen')
    expect(worldGen).toBeTruthy()
    const worldCalls: Array<boolean | undefined> = []
    const worldCollect = async (
      _signal?: AbortSignal,
      options?: { cookBatch?: boolean }
    ) => {
      worldCalls.push(options?.cookBatch)
      return { items: [] }
    }

    await runGraph(worldDoc, {
      stepDelayMs: 1,
      onlyTargetNode: true,
      targetNodeId: worldGen!.id,
      collectWorldElementOutputs: worldCollect
    })
    expect(worldCalls.at(-1)).toBe(false)

    await runGraph(worldDoc, {
      stepDelayMs: 1,
      onlyTargetNode: true,
      targetNodeId: worldGen!.id,
      cookHostInnerGraph: true,
      collectWorldElementOutputs: worldCollect
    })
    expect(worldCalls.at(-1)).toBe(true)

    await runGraph(worldDoc, {
      stepDelayMs: 1,
      targetNodeId: worldGen!.id,
      collectWorldElementOutputs: worldCollect
    })
    expect(worldCalls.at(-1)).toBe(true)

  })
})
