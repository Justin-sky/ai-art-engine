import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { ref } from 'vue'
import {
  createDefaultDirectorCamera,
  createDefaultDirectorStage,
  type DirectorStageState
} from '../src/shared/domain'
import {
  FILM_STORYBOARD_SCHEMA,
  stringifyFilmStoryboard
} from '../src/shared/graph/film/storyboard'
import { toolAccessOf } from '../src/shared/mcpModeAccess'
import {
  clearActiveDirectorStageScene,
  setActiveDirectorStageScene
} from '../src/renderer/src/features/director/activeDirectorStageScene'
import {
  executeDirectorStageEdit,
  executeDirectorStageRead,
  serializeDirectorStageSnapshot
} from '../src/renderer/src/features/director/mcpDirectorStageOps'
import { graphEditorHosts } from '../src/renderer/src/features/graph/model/graphEditorHosts'
import { buildActiveWorkspaceContext } from '../src/renderer/src/features/mcp/buildActiveWorkspaceContext'
import {
  isTimelineEditorOpen,
  notifyOpenTimelineEditorUpdated,
  registerOpenTimelineEditor,
  unregisterOpenTimelineEditor
} from '../src/renderer/src/features/mcp/openTimelineEditors'
import { useProjectStore } from '../src/renderer/src/stores/project'
import { useWorkspaceStore } from '../src/renderer/src/stores/workspace'

vi.mock('../src/renderer/src/composables/useAssetRecord', () => ({
  persistAssetRecord: vi.fn(async () => {})
}))

function createMockLiveStageScene(
  directorAssetId: string,
  processingNodeId: string,
  initialStage: DirectorStageState
) {
  const stage = ref<DirectorStageState>(initialStage)
  const viewMode = ref<'director' | 'camera'>('director')
  const shadingMode = ref<'shaded' | 'wireframe' | 'shadedWireframe'>('shaded')
  const selectionKind = ref<string | null>('object')
  const selectedObjectId = ref<string | null>('sb-actor:林小满')
  const selectedCameraId = ref<string | null>(initialStage.activeCameraId ?? null)
  const animPlaying = ref(false)
  const animTime = ref(0)

  const api = {
    directorAssetId,
    processingNodeId,
    stage,
    viewMode,
    shadingMode,
    selectionKind,
    selectedObjectId,
    selectedCameraId,
    animPlaying,
    animTime,
    setObjectVisible: vi.fn((id: string, visible: boolean) => {
      const obj = stage.value.objects.find((o) => o.id === id)
      if (obj) obj.visible = visible
      const cam = stage.value.cameras?.find((c) => c.id === id)
      if (cam) cam.visible = visible
    }),
    setObjectLocked: vi.fn((id: string, locked: boolean) => {
      const obj = stage.value.objects.find((o) => o.id === id)
      if (obj) obj.locked = locked
      const cam = stage.value.cameras?.find((c) => c.id === id)
      if (cam) cam.locked = locked
    }),
    setObjectNameVisible: vi.fn((id: string, nameVisible: boolean) => {
      const obj = stage.value.objects.find((o) => o.id === id)
      if (obj) obj.nameVisible = nameVisible
    }),
    updateObjectTransform: vi.fn((id: string, patch: Record<string, unknown>) => {
      const obj = stage.value.objects.find((o) => o.id === id)
      if (obj) Object.assign(obj, patch)
      const cam = stage.value.cameras?.find((c) => c.id === id)
      if (cam && typeof patch.name === 'string') cam.name = patch.name
    }),
    reparentObject: vi.fn((id: string, parentId: string | null) => {
      const obj = stage.value.objects.find((o) => o.id === id)
      if (obj) obj.parentId = parentId
    }),
    resetObjectBonePose: vi.fn(),
    applyExpressivePosePreset: vi.fn(() => ({ matched: 1, total: 1 })),
    applyObjectPosePreset: vi.fn(() => true),
    applyObjectBonePoseMap: vi.fn(),
    createCameraObject: vi.fn(() => {
      const id = 'cam:new'
      const cam = createDefaultDirectorCamera(id, 'Camera New')
      stage.value.cameras = [...(stage.value.cameras ?? []), cam]
      stage.value.activeCameraId = id
      return id
    }),
    createMannequinObject: vi.fn((preset: string, parentId: string | null) => {
      const id = 'mannequin:new'
      stage.value.objects.push({
        id,
        name: 'New Actor',
        kind: 'character',
        mannequinPreset: preset as 'humanoid',
        parentId,
        visible: true,
        locked: false,
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 }
      })
      return id
    }),
    createLightObject: vi.fn(),
    createEmptyObject: vi.fn(),
    createModelObject: vi.fn(),
    createPrimitiveObject: vi.fn((primitive: string, parentId: string | null) => {
      const id = 'primitive:new'
      stage.value.objects.push({
        id,
        name: 'New Box',
        kind: 'primitive',
        primitive: primitive as 'box',
        parentId,
        visible: true,
        locked: false,
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 }
      })
      return id
    }),
    removeObject: vi.fn((id: string) => {
      stage.value.objects = stage.value.objects.filter((o) => o.id !== id)
      stage.value.cameras = (stage.value.cameras ?? []).filter((c) => c.id !== id)
      return true
    }),
    selectObject: vi.fn((id: string | null) => {
      selectedObjectId.value = id
      selectionKind.value = id ? 'object' : 'scene'
    }),
    selectCamera: vi.fn((id: string) => {
      selectedCameraId.value = id
      selectionKind.value = 'camera'
      stage.value.activeCameraId = id
    }),
    focusHierarchyItem: vi.fn(),
    applyCameraPreset: vi.fn(),
    setViewer: vi.fn((viewer: DirectorStageState['cameras'][0]['viewer']) => {
      const active = stage.value.cameras?.find((c) => c.id === stage.value.activeCameraId)
      if (active) active.viewer = viewer
    }),
    applyLightingPreset: vi.fn((presetId: string) => {
      stage.value.lightingPreset = presetId as 'studio'
    }),
    updateSkyColor: vi.fn((color: string) => {
      stage.value.skyColor = color
    }),
    updateGround: vi.fn((patch: { visible?: boolean }) => {
      if (patch.visible !== undefined) stage.value.gridVisible = patch.visible
    }),
    updateStageEnvironment: vi.fn((patch: { fogEnabled?: boolean }) => {
      if (patch.fogEnabled !== undefined) stage.value.fogEnabled = patch.fogEnabled
    }),
    updatePanoramaVisible: vi.fn(),
    updatePanoramaYaw: vi.fn(),
    updatePanoramaRadius: vi.fn(),
    setViewMode: vi.fn((vm: 'director' | 'camera') => {
      viewMode.value = vm
    }),
    setShadingMode: vi.fn((sm: 'shaded' | 'wireframe' | 'shadedWireframe') => {
      shadingMode.value = sm
    }),
    setAspectRatio: vi.fn((ar: '16:9') => {
      stage.value.aspectRatio = ar
    }),
    setCompositionGuide: vi.fn(),
    setCapturePass: vi.fn(),
    setSceneLabelsVisible: vi.fn(),
    setCameraGizmosVisible: vi.fn(),
    setLightGizmosVisible: vi.fn(),
    setGridGizmoVisible: vi.fn(),
    playAnimation: vi.fn(() => {
      animPlaying.value = true
    }),
    pauseAnimation: vi.fn(() => {
      animPlaying.value = false
    }),
    stopAnimation: vi.fn(() => {
      animPlaying.value = false
      animTime.value = 0
    }),
    seekAnimation: vi.fn((t: number) => {
      animTime.value = t
    }),
    setAnimDuration: vi.fn(),
    setAnimLoop: vi.fn(),
    flushPreview: vi.fn(),
    saveNow: vi.fn(async () => {})
  }

  return api
}

describe('Left window perception and 3D Director Stage MCP live editing', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    clearActiveDirectorStageScene()
  })

  it('registers director_stage_read as read and director_stage_edit as write', () => {
    expect(toolAccessOf('director_stage_read')).toBe('read')
    expect(toolAccessOf('director_stage_edit')).toBe('write')
  })

  it('perceives the left window Dive stack, 3D Director Stage objects (like 林小满), and dived node params', () => {
    const project = useProjectStore()
    const workspace = useWorkspaceStore()

    const storyboardJson = stringifyFilmStoryboard({
      schema: FILM_STORYBOARD_SCHEMA,
      title: '职场觉醒',
      logline: '林小满在深夜工位决定辞职',
      style: '写实电影感',
      aspectRatio: '16:9',
      entities: [{ id: 'E1', kind: 'character', name: '林小满', description: '年轻女白领' }],
      scenes: [
        {
          id: 'S01',
          order: 1,
          heading: 'INT. 办公室格子间 - 夜',
          location: '办公室格子间',
          time: '夜',
          summary: '林小满坐在工位前'
        }
      ],
      shots: [
        {
          id: 'S01-01',
          order: 1,
          sceneId: 'S01',
          title: '林小满工位中景',
          shotSize: 'MS',
          angle: '平视',
          cameraMove: '固定',
          durationSec: 3,
          characters: ['林小满'],
          location: '办公室格子间',
          props: ['办公桌', '电脑显示器'],
          action: '林小满盯着电脑屏幕',
          dialogue: [],
          sound: '键盘声',
          transition: '切',
          imagePrompt: '林小满坐在工位前',
          videoPrompt: '固定镜头',
          status: 'draft'
        }
      ]
    })

    project.assets = [
      {
        id: 'canvas-2',
        name: '新建自由画布 2',
        type: 'canvas',
        relativePath: '',
        createdAt: '2026-10-19T00:00:00Z',
        updatedAt: '2026-10-19T00:00:00Z',
        genParams: {
          graphJson: {
            version: 1,
            nodes: [
              {
                id: 'node-film-1',
                typeId: 'film.workbench',
                title: '影视工作台1111',
                position: { x: 100, y: 100 },
                params: {
                  filmStoryboard: storyboardJson
                }
              }
            ],
            edges: []
          }
        }
      }
    ]

    workspace.openCanvasEditorIds = ['canvas-2']
    workspace.setActiveDiveRootKey('canvas:canvas-2')
    workspace.diveIntoView(
      'canvas:canvas-2',
      { viewId: 'film.workbench', hostId: 'asset:canvas-2', nodeId: 'node-film-1' },
      '影视工作台1111'
    )
    workspace.diveIntoView(
      'canvas:canvas-2',
      {
        viewId: 'director.stage',
        directorAssetId: 'canvas-2',
        processingNodeId: 'node-film-1'
      },
      '3D 分镜白模预演'
    )

    const initialStage = createDefaultDirectorStage()
    initialStage.objects = [
      {
        id: 'sb-actor:林小满',
        name: '林小满',
        kind: 'character',
        mannequinPreset: 'humanoid',
        visible: true,
        locked: false,
        position: { x: 0, y: 0, z: -0.18 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 }
      },
      {
        id: 'sb-prop:办公桌',
        name: '办公桌',
        kind: 'primitive',
        primitive: 'box',
        visible: true,
        locked: false,
        position: { x: 0, y: 0, z: 0.34 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1.4, y: 0.74, z: 0.7 }
      }
    ]
    const mockScene = createMockLiveStageScene('canvas-2', 'node-film-1', initialStage)
    setActiveDirectorStageScene(
      mockScene as unknown as Parameters<typeof setActiveDirectorStageScene>[0]
    )

    const context = buildActiveWorkspaceContext()
    expect(context).toBeDefined()
    expect(context).toContain('Left Window Dive Breadcrumb: 新建自由画布 2 > 影视工作台1111')
    expect(context).toContain(
      '3D 分镜白模预演 [view:director.stage, directorAssetId="canvas-2", processingNodeId="node-film-1"]'
    )
    expect(context).toContain(
      'Active 3D Director Stage in Left Window: directorAssetId="canvas-2", processingNodeId="node-film-1"'
    )
    expect(context).toContain('id="sb-actor:林小满" name="林小满" [character]')
    expect(context).toContain('visible=true')
  })

  it('hides and modifies "林小满" in real time via executeDirectorStageEdit by name', async () => {
    const initialStage = createDefaultDirectorStage()
    initialStage.objects = [
      {
        id: 'sb-actor:林小满',
        name: '林小满',
        kind: 'character',
        mannequinPreset: 'humanoid',
        visible: true,
        locked: false,
        position: { x: 0, y: 0, z: -0.18 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 }
      }
    ]
    const mockScene = createMockLiveStageScene('canvas-2', 'node-film-1', initialStage)
    setActiveDirectorStageScene(
      mockScene as unknown as Parameters<typeof setActiveDirectorStageScene>[0]
    )

    // 1. Read stage
    const readSnap = await executeDirectorStageRead({})
    expect(readSnap.live).toBe(true)
    expect((readSnap.objects as Array<{ name: string; visible: boolean }>)[0]).toMatchObject({
      name: '林小满',
      visible: true
    })

    // 2. Hide 林小满 by name ("隐藏林小满")
    const editRes = await executeDirectorStageEdit({
      ops: [{ op: 'hide_object', name: '林小满' }]
    })
    expect(editRes.ok).toBe(true)
    expect(mockScene.setObjectVisible).toHaveBeenCalledWith('sb-actor:林小满', false)
    expect(mockScene.stage.value.objects[0].visible).toBe(false)

    // 3. Show and move 林小满 + update camera focal length
    const editRes2 = await executeDirectorStageEdit({
      ops: [
        {
          op: 'object_update',
          name: '林小满',
          visible: true,
          position: { x: 0.5, y: 0, z: -0.5 },
          rotationDeg: { x: 0, y: 45, z: 0 },
          scale: 1.2
        },
        {
          op: 'camera_update',
          focalLengthMm: 85,
          position: { x: 0, y: 1.6, z: 2.2 }
        }
      ]
    })
    expect(editRes2.ok).toBe(true)
    expect(mockScene.stage.value.objects[0].visible).toBe(true)
    expect(mockScene.stage.value.objects[0].position).toEqual({ x: 0.5, y: 0, z: -0.5 })
    expect(mockScene.stage.value.objects[0].scale).toEqual({ x: 1.2, y: 1.2, z: 1.2 })
    expect(mockScene.setViewer).toHaveBeenCalled()
  })

  it('perceives dived node tools and notifies open timeline editors on live external updates', () => {
    const project = useProjectStore()
    const workspace = useWorkspaceStore()

    project.assets = [
      {
        id: 'canvas-tools',
        name: '节点工具画布',
        type: 'canvas',
        relativePath: '',
        createdAt: '2026-10-19T00:00:00Z',
        updatedAt: '2026-10-19T00:00:00Z',
        genParams: {
          graphJson: {
            version: 1,
            nodes: [
              {
                id: 'node-img-1',
                typeId: 'image.process',
                title: '十合一修图台',
                position: { x: 0, y: 0 },
                params: {
                  imageProcessTool: 'redraw',
                  redrawPrompt: '换成红色机甲外壳'
                }
              }
            ],
            edges: []
          }
        }
      }
    ]

    const unregisterHost = graphEditorHosts.register('asset:canvas-tools', {
      getDocument: () => project.assets[0].genParams!.graphJson as never,
      getNode: (nodeId: string) =>
        (project.assets[0].genParams!.graphJson as { nodes: Array<{ id: string }> }).nodes.find(
          (n) => n.id === nodeId
        ) as never,
      findNode: () => null,
      updateNode: () => {},
      setNodeAsset: () => {},
      flush: async () => {}
    })

    workspace.openCanvasEditorIds = ['canvas-tools']
    workspace.setActiveDiveRootKey('canvas:canvas-tools')
    workspace.diveIntoView(
      'canvas:canvas-tools',
      { viewId: 'image.redraw', hostId: 'asset:canvas-tools', nodeId: 'node-img-1' },
      '局部重绘'
    )

    const ctx = buildActiveWorkspaceContext()
    expect(ctx).toContain(
      'Frontmost Dive View in Left Window: viewId="image.redraw", title="局部重绘"'
    )
    expect(ctx).toContain(
      'Dived Node Target: assetId="canvas-tools", hostId="asset:canvas-tools", nodeId="node-img-1", typeId="image.process"'
    )
    expect(ctx).toContain('"redrawPrompt":"换成红色机甲外壳"')

    // Verify openTimelineEditors live reload callback
    const onReload = vi.fn()
    registerOpenTimelineEditor('script-1', onReload)
    expect(isTimelineEditorOpen('script-1')).toBe(true)
    expect(notifyOpenTimelineEditorUpdated('script-1')).toBe(true)
    expect(onReload).toHaveBeenCalledTimes(1)
    unregisterOpenTimelineEditor('script-1')
    expect(isTimelineEditorOpen('script-1')).toBe(false)

    unregisterHost()
  })

  it('serializes DirectorStageState snapshot cleanly', () => {
    const stage = createDefaultDirectorStage()
    const snap = serializeDirectorStageSnapshot(stage, {
      live: false,
      directorAssetId: 'asset-1',
      processingNodeId: 'node-1'
    })
    expect(snap.directorAssetId).toBe('asset-1')
    expect(snap.processingNodeId).toBe('node-1')
    expect(snap.cameraCount).toBeGreaterThanOrEqual(1)
  })

  it('supports top-level patch shorthand, Chinese color names, FK/IK pose, Cinemachine, sceneWorld, and viewport orientation', async () => {
    const initialStage = createDefaultDirectorStage()
    initialStage.objects = [
      {
        id: 'sb-actor:林小满',
        name: '林小满',
        kind: 'character',
        mannequinPreset: 'humanoid',
        visible: true,
        locked: false,
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 }
      },
      {
        id: 'sb-prop:办公桌',
        name: '办公桌',
        kind: 'primitive',
        primitive: 'box',
        visible: true,
        locked: false,
        position: { x: 1, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 }
      }
    ]
    const mockScene = createMockLiveStageScene('canvas-2', 'node-film-1', initialStage)
    const setPoseEditMode = vi.fn()
    const setObjectIkChainEffector = vi.fn()
    const setViewOrientation = vi.fn()
    const updateSceneWorld = vi.fn()
    Object.assign(mockScene, {
      setPoseEditMode,
      setObjectIkChainEffector,
      setViewOrientation,
      updateSceneWorld
    })
    setActiveDirectorStageScene(
      mockScene as unknown as Parameters<typeof setActiveDirectorStageScene>[0]
    )

    // 1. Top-level single-op patch shorthand without `ops` array
    const shorthandRes = await executeDirectorStageEdit({
      directorAssetId: 'canvas-2',
      processingNodeId: 'node-film-1',
      objectId: 'sb-actor:林小满',
      patch: { visible: false }
    })
    expect(shorthandRes.ok).toBe(true)
    expect(mockScene.stage.value.objects[0].visible).toBe(false)

    // 2. Fallback to currently selected object + Chinese color + IK pose + reparent + camera cinemachine + sceneWorld + viewport orientation
    const fullRes = await executeDirectorStageEdit({
      ops: [
        {
          op: 'object_update',
          visible: true,
          color: '红色',
          parentName: '办公桌',
          poseEditMode: 'ik',
          ikEffectors: { armR: 'RightHand' },
          posePreset: '英雄凝视'
        },
        {
          op: 'camera_update',
          rotationDeg: { x: -10, y: 30, z: 0 },
          handheldShake: { enabled: true, intensity: 0.6, frequency: 1.2 },
          cinemachine: {
            bodyMode: 'thirdPersonFollow',
            followTargetName: '林小满',
            aimMode: 'composer',
            lookAtTargetName: '林小满',
            aimTargetPart: 'head'
          }
        },
        {
          op: 'environment_update',
          skyColor: '深蓝',
          sceneWorld: { scalePercent: 150, position: { x: 1, y: 0, z: -1 } },
          environment: { fogEnabled: true, fogDensity: 0.03, fogColor: '白色' }
        },
        {
          op: 'viewport_update',
          viewOrientation: 'front'
        }
      ]
    })
    expect(fullRes.ok).toBe(true)
    expect(mockScene.stage.value.objects[0].visible).toBe(true)
    expect(mockScene.stage.value.objects[0].color).toBe('#ef4444')
    expect(mockScene.stage.value.objects[0].parentId).toBe('sb-prop:办公桌')
    expect(setPoseEditMode).toHaveBeenCalledWith('ik')
    expect(setObjectIkChainEffector).toHaveBeenCalledWith('sb-actor:林小满', 'slot2', 'RightHand')
    expect(mockScene.applyExpressivePosePreset).toHaveBeenCalledWith(
      'sb-actor:林小满',
      'gaze.heroic'
    )
    expect(updateSceneWorld).toHaveBeenCalled()
    expect(setViewOrientation).toHaveBeenCalledWith('z')
    const activeCam = mockScene.stage.value.cameras?.[0]
    expect(activeCam?.viewer.cinemachine?.followTargetId).toBe('sb-actor:林小满')
    expect(activeCam?.viewer.cinemachine?.lookAtTargetId).toBe('sb-actor:林小满')
    expect(activeCam?.viewer.handheldShake?.enabled).toBe(true)

    const ctx = buildActiveWorkspaceContext()
    expect(ctx).toContain('[MANDATORY 3D STAGE EDIT PROTOCOL]')
    expect(ctx).toContain('mcp__studio__graph_edit')
  })

  it('supports UI editorDiveRootKey ("canvas-editor-<id>"), all Dive views (node tools, comic.page, world.editor, timeline view), and bumps externalRevision on applyExternalGraph', () => {
    const project = useProjectStore()
    const workspace = useWorkspaceStore()

    project.assets = [
      {
        id: 'canvas-dive-all',
        name: '全能画布',
        type: 'canvas',
        relativePath: '',
        createdAt: '2026-10-19T00:00:00Z',
        updatedAt: '2026-10-19T00:00:00Z',
        genParams: {
          graphJson: {
            version: 1,
            nodes: [
              {
                id: 'node-crop-1',
                typeId: 'image.crop',
                title: '裁剪节点',
                position: { x: 0, y: 0 },
                params: {
                  imageCrop: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 }
                }
              }
            ],
            edges: []
          }
        }
      }
    ]

    const rootKey = 'canvas-editor-canvas-dive-all'
    workspace.openCanvasEditorIds = ['canvas-dive-all']
    workspace.setActiveDiveRootKey(rootKey)
    workspace.diveIntoView(
      rootKey,
      { viewId: 'node.crop', hostId: 'asset:canvas-dive-all', nodeId: 'node-crop-1' },
      '裁剪节点'
    )

    const ctxCrop = buildActiveWorkspaceContext()
    expect(ctxCrop).toContain(
      'Left Window Dive Breadcrumb: 全能画布 > 裁剪节点 [view:node.crop, hostId="asset:canvas-dive-all", nodeId="node-crop-1"]'
    )
    expect(ctxCrop).toContain(
      'Dived Node Target: assetId="canvas-dive-all", hostId="asset:canvas-dive-all", nodeId="node-crop-1"'
    )
    expect(ctxCrop).toContain('"imageCrop"')

    // Verify world.editor dive perception with activeElementHostId
    workspace.diveIntoView(
      rootKey,
      {
        viewId: 'world.editor',
        worldAssetId: 'world-1',
        tab: 'scenes',
        worldGenNodeId: 'node-wg-1'
      },
      '世界观编辑器'
    )
    const ctxWorld = buildActiveWorkspaceContext()
    expect(ctxWorld).toContain('activeTab="scenes"')
    expect(ctxWorld).toContain('activeHostId="asset:world-1:element:scenes:node-wg-1"')

    // Verify timeline view dive perception (even when hostId and nodeId are also set)
    workspace.diveIntoView(
      rootKey,
      {
        viewId: 'semantic.timeline', // view-id-keep
        timelineId: 'stl.demo123',
        hostId: 'asset:canvas-dive-all',
        nodeId: 'node-crop-1'
      },
      '语义时间线'
    )
    const ctxSemantic = buildActiveWorkspaceContext()
    expect(ctxSemantic).toContain('Active Semantic Timeline: timelineId="stl.demo123"')
    expect(ctxSemantic).toContain('op="semantic_timeline_edit"')

    // Verify graphEditorHosts.applyExternalGraph increments externalRevision for EditorDiveNodeToolHost
    const beforeExtRev = graphEditorHosts.externalRevision.value
    const unreg = graphEditorHosts.register('asset:canvas-dive-all', {
      getNode: () => null,
      updateNode: () => {},
      setNodeAsset: () => {},
      applyExternalGraph: () => {},
      flush: async () => {}
    })
    graphEditorHosts.applyExternalGraph('asset:canvas-dive-all', {
      version: 1,
      nodes: [],
      edges: []
    })
    expect(graphEditorHosts.externalRevision.value).toBe(beforeExtRev + 1)
    unreg()
  })

  it('intercepts and transpiles raw DSML tool-call markup in both llm/stream and chatMarkdown', async () => {
    const { renderChatMarkdown, stripChatDsmlMarkup } = await import('../src/shared/chatMarkdown')
    const { parseDsmlToolCalls, stripDsmlFromText, wrapDsmlStream } =
      await import('../src/main/services/aiartHeadlessRunner.template.mjs')

    const screenshotDsml = `< | DSML | calls>
< | DSML | invoke name="mcp__studio__graph_edit">
< | DSML | parameter name="assetId" string="true">f892c688-9502-4422-b712-d138c3263c02</ | DSML | parameter>
< | DSML | parameter name="ops" string="false">
[{"nodeId": "node-2b133d63-450e-4e5d-b663-565f305d8558", "action": "update_data", "data": {"objects": [{"id": "obj-1", "visible": false}]}}]
</ | DSML | parameter>
</ | DSML | invoke>
</ | DSML | calls>`

    // 1. Verify parser extracts structured tool calls with typed JSON vs string args
    const calls = parseDsmlToolCalls(screenshotDsml)
    expect(calls).toHaveLength(1)
    expect(calls[0].name).toBe('mcp__studio__graph_edit')
    const parsedArgs = JSON.parse(calls[0].arguments)
    expect(parsedArgs.assetId).toBe('f892c688-9502-4422-b712-d138c3263c02')
    expect(Array.isArray(parsedArgs.ops)).toBe(true)
    expect(parsedArgs.ops[0].nodeId).toBe('node-2b133d63-450e-4e5d-b663-565f305d8558')

    // 2. Verify chatMarkdown strips raw DSML tags and collapses pure DSML bubbles into a clean pill
    expect(stripChatDsmlMarkup(screenshotDsml)).toBe('`⚡ graph_edit`')
    const html = renderChatMarkdown(screenshotDsml)
    expect(html).not.toContain('DSML')
    expect(html).toContain('⚡ graph_edit')

    // Verify mixed prose + partial streaming DSML suffix strips the DSML suffix cleanly
    const partialStreamText =
      '我将为您隐藏林小满：\n\n< | DSML | calls>\n< | DSML | invoke name="mcp__studio__graph_edit">'
    expect(stripChatDsmlMarkup(partialStreamText)).toBe('我将为您隐藏林小满：')
    expect(stripDsmlFromText(partialStreamText)).toBe('我将为您隐藏林小满：')

    // 3. Verify wrapDsmlStream suppresses DSML from text-delta and emits valid tool-call chunks
    async function* fakeUpstream() {
      yield { type: 'start', id: 'resp-1', model: 'deepseek-chat' }
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: '好的，马上隐藏林小满。\n' }
      yield { type: 'text-delta', index: 0, text: '< | DS' }
      yield {
        type: 'text-delta',
        index: 0,
        text: 'ML | calls>\n< | DSML | invoke name="mcp__studio__graph_edit">\n'
      }
      yield {
        type: 'text-delta',
        index: 0,
        text: '< | DSML | parameter name="ops" string="false">[{"op":"hide_object","name":"林小满"}]</ | DSML | parameter>\n</ | DSML | invoke>\n</ | DSML | calls>'
      }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: '' } }
      yield {
        type: 'finish',
        reason: { kind: 'stop', raw: 'stop' }
      }
    }

    const emitted: Array<Record<string, unknown>> = []
    for await (const chunk of wrapDsmlStream(fakeUpstream())) {
      emitted.push(chunk as Record<string, unknown>)
    }

    const textDeltas = emitted
      .filter((c) => c.type === 'text-delta')
      .map((c) => String(c.text))
      .join('')
    expect(textDeltas).toBe('好的，马上隐藏林小满。\n')
    expect(textDeltas).not.toContain('DSML')

    const toolStarts = emitted.filter(
      (c) => c.type === 'block-start' && c.blockType === 'tool-call'
    )
    expect(toolStarts).toHaveLength(1)

    const toolDeltas = emitted.filter((c) => c.type === 'tool-call-delta')
    expect(toolDeltas).toHaveLength(1)
    expect(toolDeltas[0].name).toBe('mcp__studio__graph_edit')
    expect(JSON.parse(String(toolDeltas[0].argumentsDelta))).toEqual({
      ops: [{ op: 'hide_object', name: '林小满' }]
    })

    const finishChunk = emitted.find((c) => c.type === 'finish')
    expect((finishChunk?.reason as { kind: string })?.kind).toBe('tool-calls')
  })

  it('sniffs actual JPEG magic bytes (FF D8 FF E0) when wrapped as data:image/png or .png so extension and visual check MIME stay consistent', async () => {
    const {
      b64JsonToImageDataUrl,
      imageExtFromMime,
      normalizeImageDataUrlMime,
      sniffImageMimeFromBytes
    } = await import('../src/shared/media/imageMimeSniff')
    const { resolveMediaBytesFromUrl } =
      await import('../src/main/services/resolveMediaBytesFromUrl')

    const jpegBytes = Buffer.from([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01
    ])
    const jpegB64 = jpegBytes.toString('base64')

    expect(sniffImageMimeFromBytes(jpegBytes)).toBe('image/jpeg')
    expect(b64JsonToImageDataUrl(jpegB64)).toBe(`data:image/jpeg;base64,${jpegB64}`)

    // Even if an upstream adapter mislabeled JPEG bytes as data:image/png;base64,...
    const mislabeledDataUrl = `data:image/png;base64,${jpegB64}`
    expect(normalizeImageDataUrlMime(mislabeledDataUrl)).toBe(`data:image/jpeg;base64,${jpegB64}`)

    const resolved = await resolveMediaBytesFromUrl(mislabeledDataUrl)
    expect(resolved.mime).toBe('image/jpeg')
    expect(imageExtFromMime(resolved.mime)).toBe('jpg')
  })
})
