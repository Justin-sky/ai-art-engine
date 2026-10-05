import { describe, expect, it } from 'vitest'
import { BUILTIN_NODE_TYPES, getAiWorkflowPresetPlan, getNodePorts } from '../src/shared/graph'

/**
 * 「世界模型」一键工作流：空间世界生成 → 空间世界导出 → 3D 导演台。
 *
 * 这条链的形状是被**端口类型规则**逼出来的，不是随便连的：
 * - 世界生成节点的出口是 `spatialWorld`（严格同类型），**不能**直接接导演台；
 * - 导出节点是唯一的转换点，出口才是 `model`，导演台的 `in-model` 只吃它。
 * 所以这里逐条钉住节点类型与端口，避免以后有人「顺手」把它直连上。
 */
describe('世界模型一键工作流', () => {
  const plan = getAiWorkflowPresetPlan('worldModel')

  it('存在预设，且串起生成 → 导出 → 导演台三个节点', () => {
    expect(plan).toBeTruthy()
    const typeIds = plan!.nodes.map((node) => node.typeId)
    expect(typeIds).toContain('asset.spatialWorld')
    expect(typeIds).toContain('spatialWorld.export')
    expect(typeIds).toContain('asset.motion')
  })

  it('世界节点的出口接进导出节点的世界口（不是直接接导演台）', () => {
    const world = plan!.nodes.find((node) => node.typeId === 'asset.spatialWorld')!
    const exportNode = plan!.nodes.find((node) => node.typeId === 'spatialWorld.export')!
    const motion = plan!.nodes.find((node) => node.typeId === 'asset.motion')!

    const worldPorts = getNodePorts({ typeId: 'asset.spatialWorld' } as never)
    const outPort = worldPorts.find((port) => port.direction === 'out' && port.id === 'out')!
    expect(outPort.dataType).toBe('spatialWorld')

    // 世界 → 导出：必须连到 in-world
    expect(plan!.edges).toContainEqual({
      from: world.key,
      to: exportNode.key,
      fromPort: 'out',
      toPort: 'in-world'
    })
    // 导出 → 导演台：导出的出口是 model，接导演台的 in-model
    expect(plan!.edges).toContainEqual({
      from: exportNode.key,
      to: motion.key,
      fromPort: 'out',
      toPort: 'in-model'
    })
    // 反向禁止：世界节点不能直连导演台（端口类型不兼容）
    const direct = plan!.edges.find((edge) => edge.from === world.key && edge.to === motion.key)
    expect(direct).toBeUndefined()
  })

  it('文本设定喂给世界生成节点的文本口', () => {
    const brief = plan!.nodes.find((node) => node.typeId === 'play.script')!
    const world = plan!.nodes.find((node) => node.typeId === 'asset.spatialWorld')!
    expect(plan!.edges).toContainEqual({
      from: brief.key,
      to: world.key,
      fromPort: 'out',
      toPort: 'in-text'
    })
  })

  it('导出默认出 HQ 网格（导演台能直接用），并可切到泼溅', () => {
    const exportNode = plan!.nodes.find((node) => node.typeId === 'spatialWorld.export')!
    expect(exportNode.params?.spatialWorldExportMode).toBe('mesh')
    expect(exportNode.params?.spatialWorldExportVariant).toBe('textured')
    expect(exportNode.params?.spatialWorldExportResolution).toBe('full_res')
    // 节点类型本身两种模式都在（切 splats 时不再登记模型，只落 PLY）
    const def = BUILTIN_NODE_TYPES.find((item) => item.typeId === 'spatialWorld.export')
    expect(def?.ports?.some((port) => port.id === 'in-world')).toBe(true)
    expect(def?.defaultParams?.().spatialWorldExportMode).toBe('mesh')
  })

  it('说明节点把「为什么必须经过导出」写给用户', () => {
    const note = plan!.nodes.find((node) => node.typeId === 'note.text')!
    const text = String(note.params?.text ?? '')
    expect(text).toContain('空间世界导出')
    expect(text).toContain('严格同类型')
  })
})
