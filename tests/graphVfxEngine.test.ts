import { beforeEach, describe, expect, it } from 'vitest'
import { computed, ref } from 'vue'
import { DEFAULT_SETTINGS } from '../src/shared/domain'
import {
  createDefaultScopedGraph,
  type GraphDocument,
  type GraphNodeRunState
} from '../src/shared/graph'
import { setCanvasVfxEnabled } from '../src/renderer/src/editor/preferences'
import {
  clearHostVfx,
  consumeCameraFocusTarget,
  emitGraphDiffVfx,
  emitNodeCookVfx,
  getActiveCanvasVfxSnapshot,
  getActiveDomVfxSnapshot,
  getNodeFlipWorldOffset,
  hasActiveCanvasVfx,
  isCanvasVfxEnabled,
  summarizeNodeBuffToast,
  triggerPortDockBurst
} from '../src/renderer/src/graph/vfx/graphVfxEngine'
import {
  drawCanvasVfxOverlay,
  drawGraphEdges,
  edgePointAt,
  type EdgeScreenGeometry,
  type TempEdgeScreen
} from '../src/renderer/src/graph/edgeCanvas'
import { graphEditorHosts } from '../src/renderer/src/features/graph/model/graphEditorHosts'
import { graphRunHosts } from '../src/renderer/src/features/graph/model/graphRunHosts'
import {
  seedLiveCanvasRunStates,
  syncLiveCanvasRunState
} from '../src/renderer/src/features/mcp/mcpGraphLiveCanvas'

describe('graphVfxEngine SLG 战术画布特效引擎', () => {
  const hostId = 'asset:test-slg-vfx'

  beforeEach(() => {
    setCanvasVfxEnabled(true)
    clearHostVfx()
  })

  it('批量创建节点与连线时，生成分步时序编排的空投、冲击波、能量管线与战区聚焦目标', () => {
    const before = createDefaultScopedGraph('canvasAsset', 'canvas')
    const after: GraphDocument = {
      ...before,
      nodes: [
        {
          id: 'n1',
          typeId: 'asset.image',
          title: '先锋侦察图',
          position: { x: 100, y: 120 },
          params: { generateInstruction: '机甲先锋' }
        },
        {
          id: 'n2',
          typeId: 'asset.video',
          title: '主战镜头',
          position: { x: 460, y: 120 },
          params: { generateInstruction: '机甲推进' }
        }
      ],
      edges: [
        {
          id: 'e1',
          source: 'n1',
          sourcePort: 'out',
          target: 'n2',
          targetPort: 'in-first-frame'
        }
      ]
    }

    emitGraphDiffVfx(hostId, before, after, {
      source: 'ai',
      fitView: false,
      nowMs: 1000
    })

    const domSnap = getActiveDomVfxSnapshot(hostId)
    expect(domSnap.nodeEffects.get('n1')?.kind).toBe('spawn')
    expect(domSnap.nodeEffects.get('n1')?.delayMs).toBe(0)
    expect(domSnap.nodeEffects.get('n2')?.kind).toBe('spawn')
    expect(domSnap.nodeEffects.get('n2')?.delayMs).toBe(220)

    expect(domSnap.floatingToasts).toHaveLength(2)
    expect(domSnap.floatingToasts[0]?.text).toContain('✚ 部署 · 先锋侦察图')
    expect(domSnap.floatingToasts[1]?.text).toContain('✚ 部署 · 主战镜头')

    const canvasSnap = getActiveCanvasVfxSnapshot(hostId, 1000)
    expect(canvasSnap).not.toBeNull()
    expect(canvasSnap?.edgeSpawns.get('e1')?.delayMs).toBeGreaterThan(220)
    expect(canvasSnap?.canvasBursts.filter((b) => b.kind === 'spawn-shockwave')).toHaveLength(2)

    const cam = consumeCameraFocusTarget(hostId)
    expect(cam).not.toBeNull()
    expect(cam?.bounds.x).toBe(100)
    expect(cam?.bounds.w).toBeGreaterThan(360)
    // 消费一次后清空
    expect(consumeCameraFocusTarget(hostId)).toBeNull()
  })

  it('删除节点与断线时，生成量子瓦解幽灵残影与断线火花', () => {
    const before: GraphDocument = {
      nodes: [
        {
          id: 'n1',
          typeId: 'asset.image',
          title: '旧哨站',
          position: { x: 80, y: 90 },
          params: {}
        },
        {
          id: 'n2',
          typeId: 'asset.video',
          title: '旧中继',
          position: { x: 400, y: 90 },
          params: {}
        }
      ],
      edges: [
        {
          id: 'e1',
          source: 'n1',
          sourcePort: 'out',
          target: 'n2',
          targetPort: 'in'
        }
      ],
      viewport: { x: 0, y: 0, zoom: 1 }
    }
    const after: GraphDocument = {
      nodes: [before.nodes[1]!],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 }
    }

    emitGraphDiffVfx(hostId, before, after, { source: 'manual', nowMs: 2000 })

    const domSnap = getActiveDomVfxSnapshot(hostId)
    expect(domSnap.ghostNodes).toHaveLength(1)
    expect(domSnap.ghostNodes[0]?.nodeId).toBe('n1')
    expect(domSnap.ghostNodes[0]?.title).toBe('旧哨站')

    const canvasSnap = getActiveCanvasVfxSnapshot(hostId, 2000)
    expect(canvasSnap?.canvasBursts.some((b) => b.kind === 'cook-error-burst')).toBe(true)
    expect(canvasSnap?.canvasBursts.some((b) => b.kind === 'edge-sever')).toBe(true)
  })

  it('修改参数或应用预设时，精准提炼 SLG 战术强化飘字并忽略后台缓存路径字段', () => {
    const baseNode = {
      id: 'n1',
      typeId: 'asset.image',
      title: '主视觉',
      position: { x: 0, y: 0 },
      params: { generateInstruction: '初稿' }
    }

    expect(
      summarizeNodeBuffToast(baseNode, {
        ...baseNode,
        params: { generateInstruction: '全息赛博城市夜景' }
      })
    ).toBe('⚡ 指令已注入')

    expect(
      summarizeNodeBuffToast(baseNode, { ...baseNode, params: { generateInstruction: '初稿' } }, [
        { op: 'apply_preset', nodeId: 'n1', preset: 'cyberpunk' }
      ])
    ).toBe('★ 预设 · cyberpunk')

    expect(
      summarizeNodeBuffToast(baseNode, {
        ...baseNode,
        params: { generateInstruction: '初稿', generateAspectRatio: '21:9' }
      })
    ).toBe('📐 画幅 · 21:9')

    // 仅内部预览缓存改变时不弹多余飘字
    expect(
      summarizeNodeBuffToast(baseNode, {
        ...baseNode,
        params: {
          generateInstruction: '初稿',
          previewRelativePath: 'Cache/out.png',
          generatedImages: [{ id: '1', url: 'Cache/out.png' }]
        }
      })
    ).toBeNull()

    // 真实修改参数时触发专属 buff-burst 强化升腾光羽粒子簇
    const beforeDoc: GraphDocument = {
      nodes: [baseNode],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 }
    }
    const afterDoc: GraphDocument = {
      nodes: [{ ...baseNode, params: { generateInstruction: '机甲女武神终极形态' } }],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 }
    }
    emitGraphDiffVfx(hostId, beforeDoc, afterDoc, { source: 'ai', nowMs: 1000 })
    const snap = getActiveCanvasVfxSnapshot(hostId, 1000)
    expect(snap?.canvasBursts.some((b) => b.kind === 'buff-burst')).toBe(true)
  })

  it('自动布局或节点大幅位移时，计算平滑衰减的 FLIP 阵型偏移向量', () => {
    const before: GraphDocument = {
      nodes: [
        {
          id: 'n1',
          typeId: 'asset.image',
          title: '小队 A',
          position: { x: 0, y: 0 },
          params: {}
        }
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 }
    }
    const after: GraphDocument = {
      nodes: [
        {
          id: 'n1',
          typeId: 'asset.image',
          title: '小队 A',
          position: { x: 300, y: 200 },
          params: {}
        }
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 }
    }

    emitGraphDiffVfx(hostId, before, after, { source: 'ai', nowMs: 1000 })
    const startOffset = getNodeFlipWorldOffset(hostId, 'n1', 1000)
    expect(startOffset).toEqual({ dx: -300, dy: -200 })

    const midOffset = getNodeFlipWorldOffset(hostId, 'n1', 1410)
    expect(midOffset).not.toBeNull()
    expect(Math.abs(midOffset!.dx)).toBeLessThan(300)
    expect(Math.abs(midOffset!.dx)).toBeGreaterThan(0)

    const endOffset = getNodeFlipWorldOffset(hostId, 'n1', 1900)
    expect(endOffset).toBeNull()
  })

  it('Cook 状态跃迁（running / done / error）触发熔炉特效，且 seedLiveCanvasRunStates 不误触发', () => {
    const node = {
      id: 'n1',
      typeId: 'asset.image',
      title: '概念图',
      position: { x: 50, y: 60 },
      params: {}
    }
    const runStates: Record<string, GraphNodeRunState> = {}
    const unregEditor = graphEditorHosts.register(hostId, {
      getNode: (id) => (id === 'n1' ? node : null),
      updateNode: () => {},
      setNodeAsset: () => {},
      flush: async () => {}
    })
    const unregRun = graphRunHosts.register(hostId, {
      runStates,
      isRunning: ref(false),
      runningTargetNodeId: ref(null),
      blockedNodeIds: computed(() => new Set<string>()),
      activeRunNodeIds: computed(() => new Set<string>()),
      runToNode: async () => null,
      stopWorkflow: () => {},
      toggleNodeRun: () => {}
    })

    try {
      // 1) seed 预置已完成状态：不应触发完成爆炸特效
      seedLiveCanvasRunStates(hostId, { n1: { status: 'done' } })
      expect(getActiveDomVfxSnapshot(hostId).nodeEffects.size).toBe(0)

      // 2) 进入 running：触发熔炉启动飘字与冲击波
      syncLiveCanvasRunState(hostId, 'n1', { status: 'running' })
      expect(
        getActiveDomVfxSnapshot(hostId).floatingToasts.some((t) => t.text === '🔥 熔炉启动')
      ).toBe(true)

      // 3) running -> done：触发出炉完成特效与双层冲击波
      syncLiveCanvasRunState(hostId, 'n1', { status: 'done' })
      expect(getActiveDomVfxSnapshot(hostId).nodeEffects.get('n1')?.kind).toBe('cook-done')
      expect(
        getActiveCanvasVfxSnapshot(hostId)?.canvasBursts.some((b) => b.kind === 'cook-done-burst')
      ).toBe(true)

      // 4) 跃迁至 error：触发 EMP 故障告警
      emitNodeCookVfx(hostId, 'n1', 'running', 'error', node, 5000)
      expect(getActiveDomVfxSnapshot(hostId).nodeEffects.get('n1')?.kind).toBe('cook-error')
    } finally {
      unregEditor()
      unregRun()
    }
  })

  it('triggerPortDockBurst 与 edgePointAt 支持正交与曲线能量弹头采样', () => {
    triggerPortDockBurst(hostId, 240, 180, 3000)
    expect(hasActiveCanvasVfx(hostId, 3100)).toBe(true)
    const snap = getActiveCanvasVfxSnapshot(hostId, 3100)
    expect(snap?.canvasBursts[0]?.kind).toBe('port-dock')

    const orthoGeom: EdgeScreenGeometry = {
      id: 'e-ortho',
      source: 'a',
      target: 'b',
      pathStyle: 'orthogonal',
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 }
      ],
      sx: 0,
      sy: 0,
      c1x: 100,
      c1y: 0,
      c2x: 100,
      c2y: 0,
      ex: 100,
      ey: 100
    }
    expect(edgePointAt(orthoGeom, 0)).toEqual({ x: 0, y: 0 })
    expect(edgePointAt(orthoGeom, 0.5)).toEqual({ x: 100, y: 0 })
    expect(edgePointAt(orthoGeom, 1)).toEqual({ x: 100, y: 100 })
  })

  it('超大集群部署（>6 节点）自动聚合为单条集群飘字，防止满屏文字重叠', () => {
    const before = createDefaultScopedGraph('canvasAsset', 'canvas')
    const after: GraphDocument = {
      ...before,
      nodes: Array.from({ length: 8 }, (_, idx) => ({
        id: `n-${idx + 1}`,
        typeId: 'asset.image',
        title: `镜头 ${idx + 1}`,
        position: { x: idx * 240, y: 120 },
        params: {}
      }))
    }

    emitGraphDiffVfx(hostId, before, after, { source: 'ai', nowMs: 1000 })
    const domSnap = getActiveDomVfxSnapshot(hostId)
    expect(domSnap.nodeEffects.size).toBe(8)
    // 超过 6 个节点时不再生成 8 条独立飘字，而是合并为 1 条战术集群部署飘字
    expect(domSnap.floatingToasts).toHaveLength(1)
    expect(domSnap.floatingToasts[0]?.text).toBe('✚ 战术集群部署 ×8')
  })

  it('设置开关默认开启，关闭后跳过全部特效派发与渲染查询', () => {
    expect(DEFAULT_SETTINGS.editor.canvasVfxEnabled).toBe(true)
    expect(isCanvasVfxEnabled()).toBe(true)

    setCanvasVfxEnabled(false)
    expect(isCanvasVfxEnabled()).toBe(false)

    const before = createDefaultScopedGraph('canvasAsset', 'canvas')
    const after: GraphDocument = {
      ...before,
      nodes: [
        {
          id: 'n1',
          typeId: 'asset.image',
          title: '测试节点',
          position: { x: 100, y: 120 },
          params: {}
        }
      ]
    }
    emitGraphDiffVfx(hostId, before, after, { source: 'ai', nowMs: 1000 })
    triggerPortDockBurst(hostId, 200, 200, 1000)

    expect(hasActiveCanvasVfx(hostId, 1050)).toBe(false)
    expect(getActiveCanvasVfxSnapshot(hostId, 1050)).toBeNull()
    expect(getActiveDomVfxSnapshot(hostId).nodeEffects.size).toBe(0)
    expect(getActiveDomVfxSnapshot(hostId).floatingToasts).toHaveLength(0)

    setCanvasVfxEnabled(true)
  })

  it('Cook 运行中同时绘制熔炉星火、临时拖线与各类粒子爆发不中断', () => {
    const noop = () => {}
    const ctx = {
      setTransform: noop,
      clearRect: noop,
      beginPath: noop,
      moveTo: noop,
      lineTo: noop,
      bezierCurveTo: noop,
      quadraticCurveTo: noop,
      closePath: noop,
      roundRect: noop,
      arc: noop,
      stroke: noop,
      fill: noop,
      save: noop,
      restore: noop,
      setLineDash: noop,
      lineCap: 'round',
      lineJoin: 'round',
      lineWidth: 1,
      globalAlpha: 1,
      strokeStyle: '',
      fillStyle: '',
      shadowColor: '',
      shadowBlur: 0,
      lineDashOffset: 0
    } as unknown as CanvasRenderingContext2D

    const geoms: EdgeScreenGeometry[] = [
      {
        id: 'e1',
        source: 'n1',
        target: 'n2',
        pathStyle: 'curve',
        points: [
          { x: 100, y: 100 },
          { x: 300, y: 180 }
        ],
        sx: 100,
        sy: 100,
        c1x: 180,
        c1y: 100,
        c2x: 220,
        c2y: 180,
        ex: 300,
        ey: 180
      }
    ]
    const tempEdge: TempEdgeScreen = {
      pathStyle: 'curve',
      points: [
        { x: 300, y: 180 },
        { x: 460, y: 220 }
      ],
      sx: 300,
      sy: 180,
      c1x: 360,
      c1y: 180,
      c2x: 400,
      c2y: 220,
      ex: 460,
      ey: 220
    }

    expect(() => {
      drawGraphEdges(ctx, geoms, [tempEdge], {
        dpr: 1,
        width: 1200,
        height: 800,
        offsetX: 600,
        offsetY: 600,
        zoom: 1,
        selectedEdgeIds: new Set(),
        flowEdgeIds: new Set(['n1']),
        cookingNodeIds: new Set(['n2']),
        cookingNodeRects: [{ x: 300, y: 120, w: 220, h: 160 }],
        edgeSpawns: new Map([
          ['e1', { edgeId: 'e1', startedAt: 1000, delayMs: 0, durationMs: 1050, docked: false }]
        ]),
        canvasBursts: [
          {
            id: 'b1',
            kind: 'spawn-shockwave',
            x: 100,
            y: 100,
            w: 200,
            h: 160,
            startedAt: 1000,
            delayMs: 0,
            durationMs: 1450
          },
          {
            id: 'b2',
            kind: 'buff-burst',
            x: 100,
            y: 100,
            w: 200,
            h: 160,
            startedAt: 1000,
            delayMs: 0,
            durationMs: 1550
          },
          {
            id: 'b3',
            kind: 'port-dock',
            x: 300,
            y: 180,
            startedAt: 1000,
            delayMs: 0,
            durationMs: 850
          },
          {
            id: 'b4',
            kind: 'cook-done-burst',
            x: 300,
            y: 120,
            w: 220,
            h: 160,
            startedAt: 1000,
            delayMs: 0,
            durationMs: 1700
          }
        ],
        viewport: { x: 0, y: 0, zoom: 1 },
        flowTimeMs: 1300,
        reduceEffects: false,
        colors: { edge: '#5a8fd4', selected: '#3d8bfd', temp: '#f0a020' }
      })
    }).not.toThrow()

    // 验证顶层独立 VFX 画布（drawCanvasVfxOverlay）开启 lighter 发光混合，且 overscan 偏移为正值（+offsetX * dpr）
    let observedComposite = 'source-over'
    let lastTransformArgs: number[] = []
    const vfxCtx = {
      ...ctx,
      setTransform: (...args: number[]) => {
        lastTransformArgs = args
      },
      set globalCompositeOperation(val: GlobalCompositeOperation) {
        if (val === 'lighter') observedComposite = val
      },
      get globalCompositeOperation(): GlobalCompositeOperation {
        return observedComposite as GlobalCompositeOperation
      }
    } as unknown as CanvasRenderingContext2D

    expect(() => {
      drawCanvasVfxOverlay(vfxCtx, {
        dpr: 2,
        width: 1200,
        height: 800,
        offsetX: 600,
        offsetY: 600,
        viewport: { x: 0, y: 0, zoom: 1 },
        cookingNodeRects: [{ x: 100, y: 100, w: 200, h: 160 }],
        canvasBursts: [
          {
            id: 'b1',
            kind: 'spawn-shockwave',
            x: 100,
            y: 100,
            w: 200,
            h: 160,
            startedAt: 1000,
            delayMs: 0,
            durationMs: 1450
          },
          {
            id: 'b-sever',
            kind: 'edge-sever',
            x: 100,
            y: 120,
            toX: 360,
            toY: 220,
            startedAt: 1000,
            delayMs: 0,
            durationMs: 1350
          }
        ],
        nowMs: 1250,
        reduceEffects: false,
        colors: { edge: '#5a8fd4', selected: '#3d8bfd', temp: '#f0a020' }
      })
    }).not.toThrow()
    expect(observedComposite).toBe('lighter')
    expect(lastTransformArgs).toEqual([2, 0, 0, 2, 1200, 1200])
  })

  it('创建节点后立刻拖动节点时，部署飘字与落地冲击波实时跟随节点最新坐标', () => {
    const before = createDefaultScopedGraph('canvasAsset', 'canvas')
    const liveNode = {
      id: 'n-drag',
      typeId: 'script',
      title: '脚本',
      position: { x: 100, y: 120 },
      params: {}
    }
    const after: GraphDocument = {
      ...before,
      nodes: [liveNode],
      edges: []
    }

    const unregEditor = graphEditorHosts.register(hostId, {
      getNode: (id: string) => after.nodes.find((n) => n.id === id) ?? null,
      updateNode: () => {},
      setNodeAsset: () => {},
      flush: async () => {}
    })

    try {
      emitGraphDiffVfx(hostId, before, after, { source: 'manual', nowMs: 1000 })

      // 模拟用户创建节点后立即拖拽到新坐标 (360, 280)
      liveNode.position.x = 360
      liveNode.position.y = 280

      const domSnap = getActiveDomVfxSnapshot(hostId)
      expect(domSnap.floatingToasts).toHaveLength(1)
      expect(domSnap.floatingToasts[0]?.y).toBe(280)
      expect(domSnap.floatingToasts[0]?.x).toBeGreaterThan(360)

      const canvasSnap = getActiveCanvasVfxSnapshot(hostId, 1100)
      const shockwave = canvasSnap?.canvasBursts.find((b) => b.nodeId === 'n-drag')
      expect(shockwave?.x).toBe(360)
      expect(shockwave?.y).toBe(280)
    } finally {
      unregEditor()
    }
  })
})
