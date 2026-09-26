import { describe, expect, it, vi } from 'vitest'
import {
  executeModelConvertNode,
  executeModelMeshCompleteNode,
  executeModelRetopologyNode,
  executeModelRetargetNode,
  executeModelRigCheckNode,
  executeModelTextureNode,
  normalizePostProcessList,
  type GraphNode,
  type NodeExecuteContext
} from '../src/shared/graph'

function node(typeId: string, params: Record<string, unknown> = {}): GraphNode {
  return {
    id: `${typeId}-1`,
    typeId,
    category: 'note',
    position: { x: 0, y: 0 },
    params
  } as GraphNode
}

const segmentOutput = {
  kind: 'asset' as const,
  assetId: 'model-1',
  assetType: 'model' as const,
  relativePath: 'Cache/Models/seg.glb',
  providerTaskId: 'task_seg'
}

const rigOutput = {
  kind: 'asset' as const,
  assetId: 'model-1',
  assetType: 'model' as const,
  relativePath: 'Cache/Models/rigged.glb',
  providerTaskId: 'task_rig'
}

describe('normalizePostProcessList', () => {
  it('trims, drops blanks and dedupes', () => {
    expect(normalizePostProcessList([' head ', '', 'head', 'torso'])).toEqual(['head', 'torso'])
    expect(normalizePostProcessList(undefined)).toEqual([])
  })
})

describe('executeModelMeshCompleteNode', () => {
  it('throws GRAPH_MODEL_POST_NO_MODEL / GRAPH_MODEL_POST_API', async () => {
    await expect(
      executeModelMeshCompleteNode({
        node: node('model.meshComplete'),
        inputs: {}
      } as unknown as NodeExecuteContext)
    ).rejects.toThrow('GRAPH_MODEL_POST_NO_MODEL')

    await expect(
      executeModelMeshCompleteNode({
        node: node('model.meshComplete'),
        inputs: { 'in-model': [segmentOutput] }
      } as unknown as NodeExecuteContext)
    ).rejects.toThrow('GRAPH_MODEL_POST_API')
  })

  it('passes the upstream segmentation task id and writes the result task id', async () => {
    const postProcessModel3d = vi.fn(async () => ({
      op: 'meshComplete' as const,
      taskId: 'task_fixed',
      assetId: 'model-1',
      relativePath: 'Cache/Models/fixed.glb',
      model: 'tripo-meshComplete'
    }))
    const current = node('model.meshComplete', {
      meshCompleteMode: 'quick_cap',
      meshCompletePartNames: ['head', 'torso'],
      generateProviderInstanceId: 'tripo-1'
    })
    const ctx = {
      node: current,
      inputs: { 'in-model': [segmentOutput] },
      postProcessModel3d
    } as unknown as NodeExecuteContext

    const out = await executeModelMeshCompleteNode(ctx)
    expect(postProcessModel3d.mock.calls[0]![0]).toMatchObject({
      op: 'meshComplete',
      providerTaskId: 'task_seg',
      modelRelativePath: 'Cache/Models/seg.glb',
      partNames: ['head', 'torso'],
      completionMode: 'quick_cap',
      providerInstanceId: 'tripo-1'
    })
    expect(current.params.meshCompleteTaskId).toBe('task_fixed')
    expect(current.params.meshCompleteModelRelativePath).toBe('Cache/Models/fixed.glb')
    const value = out.out as { providerTaskId?: string; relativePath?: string }
    expect(value.providerTaskId).toBe('task_fixed')
    expect(value.relativePath).toBe('Cache/Models/fixed.glb')
  })
})

describe('executeModelRetopologyNode', () => {
  it('maps tier / face limit / quad / bake into the request', async () => {
    const postProcessModel3d = vi.fn(async () => ({
      op: 'retopology' as const,
      taskId: 'task_low',
      assetId: 'model-1',
      relativePath: 'Cache/Models/low.glb',
      model: 'tripo-retopology'
    }))
    const current = node('model.retopology', {
      retopologyMode: 'smart',
      retopologyFaceLimit: 5000,
      retopologyQuad: true,
      retopologyBake: false,
      retopologyPartNames: ['head']
    })
    const ctx = {
      node: current,
      inputs: { 'in-model': [segmentOutput] },
      postProcessModel3d
    } as unknown as NodeExecuteContext

    await executeModelRetopologyNode(ctx)
    expect(postProcessModel3d.mock.calls[0]![0]).toMatchObject({
      op: 'retopology',
      providerTaskId: 'task_seg',
      retopologyMode: 'smart',
      faceLimit: 5000,
      quad: true,
      bake: false,
      partNames: ['head']
    })
    expect(current.params.retopologyTaskId).toBe('task_low')
  })

  it('falls back to the project model when no task id is available', async () => {
    const postProcessModel3d = vi.fn(async () => ({
      op: 'retopology' as const,
      taskId: 'task_low',
      assetId: 'model-1',
      relativePath: 'Cache/Models/low.glb',
      model: 'tripo-retopology'
    }))
    const ctx = {
      node: node('model.retopology', { retopologyMode: 'basic' }),
      inputs: {
        'in-model': [{ ...segmentOutput, providerTaskId: undefined }]
      },
      postProcessModel3d
    } as unknown as NodeExecuteContext

    await executeModelRetopologyNode(ctx)
    expect(postProcessModel3d.mock.calls[0]![0].providerTaskId).toBeUndefined()
    expect(postProcessModel3d.mock.calls[0]![0]).toMatchObject({
      modelRelativePath: 'Cache/Models/seg.glb',
      retopologyMode: 'basic',
      bake: true,
      quad: false
    })
  })
})

describe('executeModelRigCheckNode', () => {
  it('writes the check result and passes the model through', async () => {
    const postProcessModel3d = vi.fn(async () => ({
      op: 'rigCheck' as const,
      taskId: 'task_check',
      riggable: true,
      rigType: 'biped'
    }))
    const current = node('model.rigCheck')
    const ctx = {
      node: current,
      inputs: { 'in-model': [{ ...segmentOutput, providerTaskId: undefined }] },
      postProcessModel3d
    } as unknown as NodeExecuteContext

    const out = await executeModelRigCheckNode(ctx)
    expect(postProcessModel3d.mock.calls[0]![0]).toMatchObject({ op: 'rigCheck' })
    expect(current.params.rigCheckRiggable).toBe(true)
    expect(current.params.rigCheckRigType).toBe('biped')
    expect(current.params.rigCheckTaskId).toBe('task_check')
    const value = out.out as { relativePath?: string; assetType?: string }
    expect(value.relativePath).toBe('Cache/Models/seg.glb')
    expect(value.assetType).toBe('model')
  })
})

describe('executeModelRetargetNode', () => {
  it('sends a single animation when only one id is configured', async () => {
    const postProcessModel3d = vi.fn(async () => ({
      op: 'retarget' as const,
      taskId: 'task_anim',
      assetId: 'model-1',
      relativePath: 'Cache/Models/walk.glb',
      model: 'tripo-retarget'
    }))
    const current = node('model.retarget', {
      retargetAnimations: ['preset:walk'],
      retargetActionIds: [7, 12],
      retargetOutFormat: 'glb',
      retargetAnimateInPlace: true
    })
    const ctx = {
      node: current,
      inputs: { 'in-model': [rigOutput] },
      postProcessModel3d
    } as unknown as NodeExecuteContext

    await executeModelRetargetNode(ctx)
    const request = postProcessModel3d.mock.calls[0]![0]
    expect(request).toMatchObject({
      op: 'retarget',
      providerTaskId: 'task_rig',
      animation: 'preset:walk',
      actionIds: [7, 12],
      outFormat: 'glb',
      animateInPlace: true,
      bakeAnimation: true,
      exportWithGeometry: true
    })
    expect(request.animations).toBeUndefined()
    expect(current.params.retargetTaskId).toBe('task_anim')
  })

  it('sends a batch list for several animations and honours fbx output', async () => {
    const postProcessModel3d = vi.fn(async () => ({
      op: 'retarget' as const,
      taskId: 'task_anim',
      assetId: 'model-1',
      relativePath: 'Cache/Models/batch.fbx',
      model: 'tripo-retarget'
    }))
    const ctx = {
      node: node('model.retarget', {
        retargetAnimations: ['preset:idle', 'preset:run'],
        retargetOutFormat: 'fbx'
      }),
      inputs: { 'in-model': [rigOutput] },
      postProcessModel3d
    } as unknown as NodeExecuteContext

    await executeModelRetargetNode(ctx)
    const request = postProcessModel3d.mock.calls[0]![0]
    expect(request.animations).toEqual(['preset:idle', 'preset:run'])
    expect(request.animation).toBeUndefined()
    expect(request.outFormat).toBe('fbx')
  })
})

describe('executeModelConvertNode', () => {
  it('maps format / fbx preset / texture options and part subset', async () => {
    const postProcessModel3d = vi.fn(async () => ({
      op: 'convert' as const,
      taskId: 'task_conv',
      assetId: 'model-1',
      relativePath: 'Cache/Models/out.fbx',
      model: 'tripo-convert'
    }))
    const current = node('model.convert', {
      convertFormat: 'FBX',
      convertFbxPreset: '3dsmax',
      convertFaceLimit: 8000,
      convertTextureSize: 2048,
      convertTextureFormat: 'PNG',
      convertQuad: true,
      convertPivotToCenterBottom: true,
      convertPackUv: true,
      convertBake: false,
      convertWithAnimation: false,
      convertPartNames: ['head']
    })
    const ctx = {
      node: current,
      inputs: { 'in-model': [segmentOutput] },
      postProcessModel3d
    } as unknown as NodeExecuteContext

    await executeModelConvertNode(ctx)
    expect(postProcessModel3d.mock.calls[0]![0]).toMatchObject({
      op: 'convert',
      providerTaskId: 'task_seg',
      format: 'FBX',
      fbxPreset: '3dsmax',
      faceLimit: 8000,
      textureSize: 2048,
      textureFormat: 'PNG',
      quad: true,
      pivotToCenterBottom: true,
      packUv: true,
      bake: false,
      withAnimation: false,
      partNames: ['head']
    })
    expect(current.params.convertTaskId).toBe('task_conv')
    expect(current.params.convertModelRelativePath).toBe('Cache/Models/out.fbx')
  })

  it('defaults to FBX with bake / animation kept when params are empty', async () => {
    const postProcessModel3d = vi.fn(async () => ({
      op: 'convert' as const,
      taskId: 'task_conv',
      assetId: 'model-1',
      relativePath: 'Cache/Models/out.fbx',
      model: 'tripo-convert'
    }))
    const ctx = {
      node: node('model.convert'),
      inputs: { 'in-model': [{ ...segmentOutput, providerTaskId: undefined }] },
      postProcessModel3d
    } as unknown as NodeExecuteContext

    await executeModelConvertNode(ctx)
    expect(postProcessModel3d.mock.calls[0]![0]).toMatchObject({
      format: 'FBX',
      quad: false,
      bake: true,
      withAnimation: true,
      pivotToCenterBottom: false,
      packUv: false
    })
    expect(postProcessModel3d.mock.calls[0]![0].partNames).toBeUndefined()
  })
})

describe('executeModelTextureNode', () => {
  it('forwards the prompt from the instruction box and texture options', async () => {
    const postProcessModel3d = vi.fn(async () => ({
      op: 'texture' as const,
      taskId: 'task_tex',
      assetId: 'model-1',
      relativePath: 'Cache/Models/textured.glb',
      model: 'tripo-texture'
    }))
    const current = node('model.texture', {
      generateInstruction: 'worn leather with scratches',
      textureVersion: 'v3.5-20260815',
      textureQuality: 'detailed',
      textureAlignment: 'geometry',
      texturePbr: false,
      textureSeed: 7,
      texturePartNames: ['torso']
    })
    const ctx = {
      node: current,
      inputs: { 'in-model': [segmentOutput] },
      postProcessModel3d
    } as unknown as NodeExecuteContext

    await executeModelTextureNode(ctx)
    expect(postProcessModel3d.mock.calls[0]![0]).toMatchObject({
      op: 'texture',
      providerTaskId: 'task_seg',
      texturePromptText: 'worn leather with scratches',
      textureVersion: 'v3.5-20260815',
      textureQuality: 'detailed',
      textureAlignment: 'geometry',
      pbr: false,
      textureSeed: 7,
      partNames: ['torso']
    })
    expect(current.params.textureTaskId).toBe('task_tex')
  })

  it('omits the prompt when neither the instruction box nor the param has text', async () => {
    const postProcessModel3d = vi.fn(async () => ({
      op: 'texture' as const,
      taskId: 'task_tex',
      assetId: 'model-1',
      relativePath: 'Cache/Models/textured.glb',
      model: 'tripo-texture'
    }))
    const ctx = {
      node: node('model.texture', { texturePromptText: '   ' }),
      inputs: { 'in-model': [segmentOutput] },
      postProcessModel3d
    } as unknown as NodeExecuteContext

    await executeModelTextureNode(ctx)
    expect(postProcessModel3d.mock.calls[0]![0].texturePromptText).toBeUndefined()
    expect(postProcessModel3d.mock.calls[0]![0].pbr).toBe(true)
  })
})
