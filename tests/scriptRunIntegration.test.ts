import { describe, expect, it, vi } from 'vitest'
import {
  createNodeFromType,
  getNodePorts,
  getNodeTypeOrThrow,
  resolveNodeType,
  type NodeExecuteContext
} from '../src/shared/graph'

/**
 * 端到端：`script.run` 经真实注册表解析 + 真实 QuickJS 沙箱执行。
 * 证明整条接线（注册 → 动态端口 → 执行器 → 沙箱 → om 治理桥）在真实路径下成立。
 */

describe('script.run 端到端（真实注册表 + QuickJS）', () => {
  it('已注册、是 note 分类但不降级为 note.text', () => {
    const def = getNodeTypeOrThrow('script.run')
    expect(def.typeId).toBe('script.run')
    const inferred = resolveNodeType({
      typeId: 'script.run',
      category: 'note',
      params: {}
    } as never)
    expect(inferred?.typeId).toBe('script.run')
  })

  it('端口按 params.ports 动态派生', () => {
    const node = createNodeFromType('script.run', { x: 0, y: 0 })
    node.params = {
      ...node.params,
      ports: {
        inputs: [{ id: 'a', dataType: 'image' }],
        outputs: [{ id: 'r', dataType: 'text' }]
      }
    } as never
    const ports = getNodePorts(node)
    expect(ports.map((p) => `${p.direction}:${p.id}:${p.dataType}`)).toEqual([
      'in:a:image',
      'out:r:text'
    ])
  })

  it('真实沙箱执行：读 inputs、调 om.generateText（走 ctx 治理）、返回 outputs', async () => {
    const node = createNodeFromType('script.run', { x: 0, y: 0 })
    node.params = {
      ...node.params,
      capabilities: ['generateText'],
      code: `export default async function ({ inputs, om }) {
        const res = await om.generateText({ prompt: inputs.in[0].text })
        return { out: { kind: 'text', text: res.text } }
      }`
    } as never

    const generateText = vi.fn(async (a: { prompt: string }) => ({
      text: a.prompt.toUpperCase(),
      model: 'fake'
    }))
    const def = getNodeTypeOrThrow('script.run')
    const ctx = {
      node,
      inputs: { in: [{ kind: 'text', text: 'hello' }] },
      generateText
    } as unknown as NodeExecuteContext

    const out = await def.execute!(ctx)
    expect(out).toEqual({ out: { kind: 'text', text: 'HELLO' } })
    expect(generateText).toHaveBeenCalledWith({ prompt: 'hello' })
  }, 30000)

  it('真实沙箱：声明了能力但环境没注入 → 该能力不可用，脚本调用即失败', async () => {
    const node = createNodeFromType('script.run', { x: 0, y: 0 })
    node.params = {
      ...node.params,
      capabilities: ['generateVideo'],
      code: `export default async function ({ om }) { return { out: await om.generateVideo({}) } }`
    } as never
    const def = getNodeTypeOrThrow('script.run')
    const ctx = { node, inputs: {} } as unknown as NodeExecuteContext
    await expect(def.execute!(ctx)).rejects.toThrow()
  }, 30000)
})
