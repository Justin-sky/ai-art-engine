import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  applyGraphEditOps,
  createNodeFromType,
  introspectAllNodeTypes,
  introspectNodeInstance,
  introspectNodeType,
  mergeSmartNodeParams,
  parseComicPage,
  parseFilmCast,
  parseFilmStoryboard,
  registerNodeType,
  stringifyFilmCast,
  stringifyFilmStoryboard,
  unregisterNodeType,
  type GraphDocument
} from '../src/shared/graph'
import {
  formatNodeEditableSchemaSummary,
  resolveActiveWorkspaceTargets
} from '../src/renderer/src/editor/control/surfaceRegistry'
import { useEditorKernel } from '../src/renderer/src/editor/kernel'
import { buildActiveWorkspaceContext } from '../src/renderer/src/features/mcp/buildActiveWorkspaceContext'
import { graphEditorHosts } from '../src/renderer/src/features/graph/model/graphEditorHosts'
import { useProjectStore } from '../src/renderer/src/stores/project'
import { useWorkspaceStore } from '../src/renderer/src/stores/workspace'

describe('Universal Workspace Control Architecture (4-Pillar Introspection, SmartPatch & SurfaceBus)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('automatically introspects all built-in node types, nested sub-documents, shorthands, and presets', () => {
    const allSchemas = introspectAllNodeTypes()
    expect(allSchemas.length).toBeGreaterThan(20)

    const portraitSchema = introspectNodeType('image.portrait')
    expect(portraitSchema).toBeDefined()
    expect(portraitSchema?.flatPaths).toContain('portraitRetouch.skinSmoothing')
    expect(portraitSchema?.flatPaths).toContain('portraitRetouch.faceSlim')
    expect(portraitSchema?.shorthandMap.skinSmoothing).toBe('portraitRetouch.skinSmoothing')
    expect(portraitSchema?.presets.length).toBeGreaterThan(0)

    const lightingSchema = introspectNodeType('image.lighting')
    expect(lightingSchema).toBeDefined()
    expect(lightingSchema?.flatPaths).toContain('lightingSetup.yaw')
    expect(lightingSchema?.flatPaths).toContain('lightingSetup.brightness')
    expect(lightingSchema?.shorthandMap.yaw).toBe('lightingSetup.yaw')
    expect(lightingSchema?.shorthandMap.mainDirection).toBe('lightingSetup.mainDirection')
    expect(lightingSchema?.presets.some((p) => p.id === 'rembrandt')).toBe(true)

    const comicSchema = introspectNodeType('comic.page')
    expect(comicSchema).toBeDefined()
    expect(comicSchema?.fields.comicPage?.type).toBe('json-string')
    expect(comicSchema?.flatPaths).toContain('comicPage.columns')
  })

  it('zero-touch adapts when a brand-new node type with new nested parameters is registered in code', () => {
    const customTypeId = 'custom.hologramShader'
    registerNodeType({
      typeId: customTypeId,
      category: 'process',
      label: 'Hologram Shader',
      defaultTitle: '全息着色器',
      defaultSize: { w: 280, h: 200 },
      sizeLimits: { minW: 200, minH: 140, maxW: 600, maxH: 500 },
      ports: [
        { id: 'in', direction: 'in', dataType: 'image' },
        { id: 'out', direction: 'out', dataType: 'image' }
      ],
      inspector: 'asset',
      card: 'media',
      addable: true,
      defaultParams: () =>
        ({
          prompt: 'holographic projection',
          hologramConfig: {
            scanlineDensity: 40,
            glitchIntensity: 0.25,
            tintColor: '#00ffff',
            wireframeOverlay: true
          }
        }) as any
    })

    try {
      // 1. Introspection immediately discovers the new node and its nested fields & shorthands
      const schema = introspectNodeType(customTypeId)
      expect(schema).toBeDefined()
      expect(schema?.flatPaths).toContain('hologramConfig.scanlineDensity')
      expect(schema?.flatPaths).toContain('hologramConfig.glitchIntensity')
      expect(schema?.shorthandMap.scanlineDensity).toBe('hologramConfig.scanlineDensity')
      expect(schema?.shorthandMap.glitchIntensity).toBe('hologramConfig.glitchIntensity')
      expect(schema?.shorthandMap.tintColor).toBe('hologramConfig.tintColor')

      // 2. Smart patcher routes shorthand, snake_case, and dot-path updates to the new nested object automatically
      const node = createNodeFromType(customTypeId, { x: 100, y: 100 })
      const doc: GraphDocument = {
        nodes: [node],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 }
      }

      const editRes = applyGraphEditOps(doc, [
        {
          op: 'node_update',
          nodeId: node.id,
          params: {
            scanline_density: 85, // snake_case shorthand -> hologramConfig.scanlineDensity
            'hologramConfig.tintColor': '#ff00ff' // dot-path
          }
        }
      ])

      expect(editRes.warnings).toEqual([])
      const updatedCfg = (editRes.graph.nodes[0].params as any).hologramConfig
      expect(updatedCfg.scanlineDensity).toBe(85)
      expect(updatedCfg.tintColor).toBe('#ff00ff')
      // Sibling properties are preserved!
      expect(updatedCfg.glitchIntensity).toBe(0.25)
      expect(updatedCfg.wireframeOverlay).toBe(true)

      // 3. Context summary formatter automatically outputs the new node's schema
      const summaryLines = formatNodeEditableSchemaSummary(editRes.graph.nodes[0])
      expect(summaryLines.join('\n')).toContain('hologramConfig.scanlineDensity')
      expect(summaryLines.join('\n')).toContain('scanlineDensity')
    } finally {
      unregisterNodeType(customTypeId)
    }
  })

  it('deep-patches sub-documents, syncs derived prompts, and applies presets across built-in nodes', () => {
    // 1. Portrait Retouch node: shorthand, Chinese aliases, dot-paths, and preset
    const portraitNode = createNodeFromType('image.portrait', { x: 0, y: 0 })
    const afterShorthand = mergeSmartNodeParams(portraitNode, {
      磨皮: '强烈',
      face_slimming: 'medium',
      'portraitRetouch.eyeBrightening': 'strong'
    })
    expect(afterShorthand.portraitRetouch?.skinSmoothing).toBe('strong')
    expect(afterShorthand.portraitRetouch?.faceSlim).toBe('standard')
    expect(afterShorthand.portraitRetouch?.catchlight).toBe('strong')
    // Unmodified sibling fields remain intact
    expect(afterShorthand.portraitRetouch?.skinWhiten).toBe('off')

    // 2. Lighting Setup node: shorthand & preset auto-syncs lightingPrompt
    const lightingNode = createNodeFromType('image.lighting', { x: 0, y: 0 })
    const afterLighting = mergeSmartNodeParams(lightingNode, {
      yaw: 45,
      brightness: 88,
      rim_light: true
    })
    expect(afterLighting.lightingSetup?.yaw).toBe(45)
    expect(afterLighting.lightingSetup?.brightness).toBe(88)
    expect(afterLighting.lightingSetup?.rimLight).toBe(true)
    expect(typeof afterLighting.lightingPrompt).toBe('string')
    expect(afterLighting.lightingPrompt?.length).toBeGreaterThan(5)

    const afterLightingPreset = mergeSmartNodeParams(lightingNode, {
      preset: 'rembrandt'
    })
    expect(afterLightingPreset.lightingSetup?.presetId).toBe('rembrandt')
    expect(afterLightingPreset.lightingPrompt).toBeTruthy()

    // 3. Multi-Angle Camera node: shorthand & preset auto-syncs multiAnglePrompt
    const cameraNode = createNodeFromType('image.multiAngle', { x: 0, y: 0 })
    const afterCamera = mergeSmartNodeParams(cameraNode, {
      yaw: -90,
      pitch: 30,
      distance: 0.8
    })
    expect(afterCamera.multiAngleCamera?.yaw).toBe(-90)
    expect(afterCamera.multiAngleCamera?.pitch).toBe(30)
    expect(afterCamera.multiAngleCamera?.shotScale).toBe(0.8)
    expect(afterCamera.multiAnglePrompt).toBeTruthy()

    // 4. Emotion Pad node: preset & shorthand auto-syncs emotionPrompt & emotionLabel
    const emotionNode = createNodeFromType('image.emotion', { x: 0, y: 0 })
    const afterEmotion = mergeSmartNodeParams(emotionNode, {
      preset: '兴奋愉悦'
    })
    expect(afterEmotion.emotionPad?.gridX).toBe(1)
    expect(afterEmotion.emotionPad?.gridY).toBe(3)
    expect(afterEmotion.emotionLabel).toBe('兴奋愉悦')
    expect(afterEmotion.emotionPrompt).toBeTruthy()
  })

  it('transparently unmarshals, deep-patches via dot-paths/selectors, and re-serializes JSON-string params (comicPage, filmStoryboard, filmCast)', () => {
    // 1. Comic Page node
    const comicNode = createNodeFromType('comic.page', { x: 0, y: 0 })
    const patchedComicParams = mergeSmartNodeParams(comicNode, {
      'comicPage.panels[0].title': '第一格：黎明',
      'comicPage.panels[1].caption': '少女站在天台仰望星空',
      'comicPage.readingOrder': 'rtl'
    })
    expect(typeof patchedComicParams.comicPage).toBe('string')
    const parsedComic = parseComicPage(patchedComicParams.comicPage)!
    expect(parsedComic).toBeTruthy()
    expect(parsedComic.readingDirection).toBe('rtl')
    expect(parsedComic.panels[0].title).toBe('第一格：黎明')
    expect(parsedComic.panels[1].caption).toBe('少女站在天台仰望星空')
    // Remaining panels stay intact!
    expect(parsedComic.panels.length).toBe(5)

    // 2. Film Workbench node (filmStoryboard & filmCast JSON strings)
    const filmNode = createNodeFromType('film.workbench', { x: 0, y: 0 })
    const initialSb = parseFilmStoryboard({
      title: '赛博夜行',
      style: '赛博朋克冷色调',
      shots: [
        {
          order: 1,
          title: '雨夜街头',
          durationSec: 4,
          location: '霓虹街角',
          characters: ['林小满'],
          shotSize: 'WS',
          angle: 'eye-level',
          cameraMove: 'static',
          action: '林小满撑伞走过水洼',
          dialogue: [],
          sound: '雨声',
          imagePrompt: 'rainy cyber street',
          videoPrompt: 'slow walk'
        },
        {
          order: 2,
          title: '转身特写',
          durationSec: 3,
          location: '霓虹街角',
          characters: ['林小满'],
          shotSize: 'CU',
          angle: 'low-angle',
          cameraMove: 'push-in',
          action: '林小满猛然回头',
          dialogue: [{ speaker: '林小满', line: '是谁？' }],
          sound: '脚步声',
          imagePrompt: 'close up turn around',
          videoPrompt: 'quick head turn'
        }
      ]
    })!
    filmNode.params.filmStoryboard = stringifyFilmStoryboard(initialSb)
    const initialCast = parseFilmCast({
      style: '赛博朋克冷色调',
      entries: [
        {
          id: 'char-lin',
          kind: 'character',
          name: '林小满',
          description: '短发清秀，透明雨衣'
        }
      ]
    })!
    filmNode.params.filmCast = stringifyFilmCast(initialCast)

    const patchedFilmParams = mergeSmartNodeParams(filmNode, {
      'filmStoryboard.shots[0].action': '林小满收起雨伞，奔向巷口',
      'filmStoryboard.shots[index=2].sound': '急促脚步声与雷声',
      'filmCast.characters[name=林小满].outfit': '短发清秀，黑色机能风衣'
    })

    const parsedSb = parseFilmStoryboard(patchedFilmParams.filmStoryboard)!
    expect(parsedSb).toBeTruthy()
    expect(parsedSb.style).toBe('赛博朋克冷色调')
    expect(parsedSb.shots).toHaveLength(2)
    expect(parsedSb.shots[0].action).toBe('林小满收起雨伞，奔向巷口')
    expect(parsedSb.shots[0].title).toBe('雨夜街头') // untouched field preserved
    expect(parsedSb.shots[1].sound).toBe('急促脚步声与雷声')

    const parsedCast = parseFilmCast(patchedFilmParams.filmCast)!
    expect(parsedCast).toBeTruthy()
    expect(parsedCast.entries[0].description).toBe('短发清秀，黑色机能风衣')
    expect(parsedCast.entries[0].name).toBe('林小满') // untouched field preserved
  })

  it('supports group_add, group_update, group_delete, node geometry/lock, and apply_preset in applyGraphEditOps', () => {
    const n1 = createNodeFromType('image.lighting', { x: 0, y: 0 })
    const n2 = createNodeFromType('image.portrait', { x: 300, y: 0 })
    const doc: GraphDocument = {
      nodes: [n1, n2],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 }
    }

    const res = applyGraphEditOps(
      doc,
      [
        {
          op: 'group_add',
          groupId: 'grp-1',
          title: '光影与精修组',
          nodeIds: [n1.id, n2.id]
        },
        {
          op: 'apply_preset',
          nodeId: n1.id,
          preset: 'golden-hour'
        },
        {
          op: 'node_update',
          nodeId: n2.id,
          title: '女主精修',
          x: 420,
          y: 160,
          locked: true,
          skinSmoothing: 'strong'
        }
      ],
      { autoLayout: false }
    )

    expect(res.warnings).toEqual([])
    expect(res.graph.groups).toEqual([{ id: 'grp-1', title: '光影与精修组' }])
    const outN1 = res.graph.nodes.find((n) => n.id === n1.id)!
    const outN2 = res.graph.nodes.find((n) => n.id === n2.id)!
    expect(outN1.groupId).toBe('grp-1')
    expect(outN2.groupId).toBe('grp-1')
    expect(outN1.params.lightingSetup?.presetId).toBe('goldenHour')
    expect(outN2.title).toBe('女主精修')
    expect(outN2.position).toEqual({ x: 420, y: 160 })
    expect(outN2.locked).toBe(true)
    expect(outN2.params.portraitRetouch?.skinSmoothing).toBe('strong')
  })

  it('resolves active workspace targets and injects live editable schema when dived into a node', () => {
    const project = useProjectStore()
    const workspace = useWorkspaceStore()
    const editor = useEditorKernel()

    const lightingNode = createNodeFromType('image.lighting', { x: 120, y: 80 })
    lightingNode.id = 'node-lighting-1'
    lightingNode.title = '主光源调节'

    const doc: GraphDocument = {
      nodes: [lightingNode],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 }
    }

    project.assets = [
      {
        id: 'canvas-main',
        name: '第一集画布',
        type: 'canvas',
        createdAt: new Date().toISOString(),
        genParams: { graphJson: doc }
      } as any
    ]

    const hostId = 'asset:canvas-main'
    const disposeHost = graphEditorHosts.register(hostId, {
      getDocument: () => doc,
      getNode: (nid) => doc.nodes.find((n) => n.id === nid) ?? null,
      updateNode: () => {},
      setNodeAsset: () => {},
      applyExternalGraph: () => {},
      selectNode: () => {},
      flush: async () => {}
    })

    try {
      workspace.openCanvasEditorIds = ['canvas-main']
      workspace.activeDiveRootKey = 'canvas-editor-canvas-main'
      workspace.editorDives['canvas-editor-canvas-main'] = [
        {
          id: 'dive-1',
          type: 'view',
          viewId: 'image.lighting',
          title: '主光源调节',
          meta: {
            viewId: 'image.lighting',
            hostId,
            nodeId: 'node-lighting-1'
          }
        } as any
      ]
      editor.selection.select({ kind: 'graph.node', id: 'node-lighting-1', hostId })

      const targets = resolveActiveWorkspaceTargets()
      expect(targets.defaultAssetId).toBe('canvas-main')
      expect(targets.defaultHostId).toBe(hostId)
      expect(targets.defaultNodeId).toBe('node-lighting-1')
      expect(targets.divedNode?.id).toBe('node-lighting-1')

      const ctx = buildActiveWorkspaceContext() ?? ''
      expect(ctx).toContain('Dived Node Target: assetId="canvas-main"')
      expect(ctx).toContain('Editable Params Schema (image.lighting)')
      expect(ctx).toContain('lightingSetup.yaw')
      expect(ctx).toContain('Supported Top-Level Shorthand Keys')
      expect(ctx).toContain('Supported One-Click Presets')
      expect(ctx).toContain('rembrandt')
    } finally {
      disposeHost()
    }
  })

  it('does not reuse old historical canvas when no canvas editor is open in the left window', () => {
    const project = useProjectStore()
    const workspace = useWorkspaceStore()
    const editor = useEditorKernel()

    project.assets = [
      {
        id: 'old-canvas-1',
        name: '历史旧画布',
        type: 'canvas',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        genParams: {
          graphJson: { version: 1, nodes: [], edges: [], groups: [] }
        }
      } as any
    ]
    workspace.openCanvasEditorIds = []
    workspace.activeDiveRootKey = null
    editor.selection.clear()

    const targets = resolveActiveWorkspaceTargets()
    expect(targets.defaultAssetId).toBe('')

    const ctx = buildActiveWorkspaceContext() ?? ''
    expect(ctx).toContain('Left Window Active Editor: None')
    expect(ctx).not.toContain('old-canvas-1')
  })
})
