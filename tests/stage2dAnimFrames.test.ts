import { describe, expect, it } from 'vitest'
import {
  STAGE2D_ANIM_FPS_MAX,
  STAGE2D_ANIM_FRAME_MAX,
  STAGE2D_FRAMES_OUT_PORT_ID,
  STAGE2D_SHEET_OUT_PORT_ID,
  buildStage2dFrameTimes,
  createNodeFromType,
  normalizeStage2dAnimFps,
  readStage2dAnimFpsFromNode,
  runGraph,
  stage2dAnimFpsToNodePatch,
  type Stage2dAction
} from '../src/shared/graph'
import { createHumanoidStage2dRig } from '../src/shared/gameAssets'

/**
 * stage.2d「动作帧序列 / sheet」节点产物契约：
 * 渲染层弹窗里的「导出序列帧」此前只能手动导出，现在同一套逐帧合成 / 拼版也接进
 * 节点执行器，产出 out-frames（逐帧透明 PNG 图库）与 out-sheet（拼版 PNG）两个
 * 独立端口，并落盘为工程资产 + 记进节点 params —— Agent / 工作流运行节点即可拿到，
 * 与动图 GIF 产物同一套路。
 *
 * 这里锁定三点：
 * 1) 帧时刻表与编辑器导出同口径（帧数 = round(duration × fps)，**不含终点**）；
 * 2) 帧率 > 0 且有自定义动作时逐帧合成为 PNG 帧 + 1 张 sheet，路径写回节点参数；
 * 3) 帧率 0 / 无动作时保持「只出单帧舞台图」的原行为，不产生附加产物。
 */
describe('stage.2d 动作帧导出参数（帧率 / 帧时刻表）', () => {
  it('帧率归一化：非数 / 非正 → 关闭，超上限夹到上限', () => {
    expect(normalizeStage2dAnimFps(undefined)).toBe(0)
    expect(normalizeStage2dAnimFps(null)).toBe(0)
    expect(normalizeStage2dAnimFps(Number.NaN)).toBe(0)
    expect(normalizeStage2dAnimFps(-4)).toBe(0)
    expect(normalizeStage2dAnimFps(0)).toBe(0)
    expect(normalizeStage2dAnimFps(12)).toBe(12)
    expect(normalizeStage2dAnimFps(12.9)).toBe(12)
    expect(normalizeStage2dAnimFps(999)).toBe(STAGE2D_ANIM_FPS_MAX)
  })

  it('节点参数读写往返：缺失回落关闭，非法值归一化后写回', () => {
    expect(readStage2dAnimFpsFromNode(null)).toBe(0)
    expect(readStage2dAnimFpsFromNode({})).toBe(0)
    expect(readStage2dAnimFpsFromNode({ stage2dAnimFps: 15 })).toBe(15)
    expect(readStage2dAnimFpsFromNode(stage2dAnimFpsToNodePatch(999))).toBe(STAGE2D_ANIM_FPS_MAX)
    expect(stage2dAnimFpsToNodePatch(-1)).toEqual({ stage2dAnimFps: 0 })
  })

  it('帧时刻表：帧数 = round(duration × fps)、不含终点（循环无缝）', () => {
    const times = buildStage2dFrameTimes(1, 12)
    expect(times).toHaveLength(12)
    expect(times[0]).toBe(0)
    expect(times[11]).toBeCloseTo(11 / 12, 10)
    // 终点与起点同姿态，不能被采到
    expect(times.every((time) => time < 1)).toBe(true)
    expect(times[5]).toBeCloseTo(5 / 12, 10)
  })

  it('帧时刻表边界：时长缺失 / 帧率关闭收敛为单帧，超长动作夹到帧数上限', () => {
    expect(buildStage2dFrameTimes(0, 12)).toEqual([0])
    expect(buildStage2dFrameTimes(Number.NaN, 12)).toEqual([0])
    expect(buildStage2dFrameTimes(1, 0)).toEqual([0])
    expect(buildStage2dFrameTimes(4, 24)).toHaveLength(96)
    // 60s × 24fps = 1440 帧 → 夹到上限
    expect(buildStage2dFrameTimes(60, 24)).toHaveLength(STAGE2D_ANIM_FRAME_MAX)
  })
})

describe('stage.2d 动作帧序列节点产物（执行器）', () => {
  const FPS = 10
  const ACTION: Stage2dAction = {
    name: 'wave',
    loop: true,
    duration: 1,
    keyframes: [
      { time: 0, pose: {} },
      { time: 1, pose: { shoulderL: 30 } }
    ]
  }

  function buildGraph(overrides: Record<string, unknown> = {}) {
    const sprite = createNodeFromType(
      'asset.image',
      { x: 0, y: 0 },
      { id: 'sprite', title: '精灵' }
    )
    const stage = createNodeFromType(
      'stage.2d',
      { x: 200, y: 0 },
      {
        id: 'stage',
        title: '2D stage',
        params: {
          stage2dRig: createHumanoidStage2dRig(),
          stage2dAction: ACTION,
          stage2dAnimFps: FPS,
          ...overrides
        }
      }
    )
    return { sprite, stage }
  }

  function buildRunOptions() {
    const savedMedia: Array<{ key: string; dataUrl: string; outputDir?: string }> = []
    const poses: Array<Record<string, number>> = []
    const sheetInputs: string[][] = []
    const stub = {
      stepDelayMs: 1,
      resolveImageUrls: async (items: Array<{ dataUrl?: string }>) =>
        items.map((item) => item.dataUrl ?? ''),
      composeStage2dCanvas: async (input: { pose?: Record<string, number> | null }) => {
        poses.push({ ...(input.pose ?? {}) })
        return { dataUrl: 'data:image/png;base64,FRAME', width: 64, height: 64 }
      },
      composeStage2dFrameSheet: async (input: { frameUrls: string[] }) => {
        sheetInputs.push(input.frameUrls)
        return {
          dataUrl: 'data:image/png;base64,SHEET',
          frameWidth: 64,
          frameHeight: 64,
          scale: 1,
          rows: 2,
          columns: 5
        }
      },
      saveRunMedia: async (input: { dataUrl: string; key: string; outputDir?: string }) => {
        savedMedia.push(input)
        return `Assets/2D/${input.key}.png`
      }
    }
    return { savedMedia, poses, sheetInputs, stub }
  }

  function runStage(
    stage: ReturnType<typeof buildGraph>['stage'],
    sprite: ReturnType<typeof buildGraph>['sprite'],
    stub: Record<string, unknown>
  ) {
    return runGraph(
      {
        nodes: [sprite, stage],
        edges: [
          {
            id: 'e1',
            source: sprite.id,
            target: stage.id,
            sourcePort: 'out',
            targetPort: 'in'
          }
        ],
        viewport: { x: 0, y: 0, zoom: 1 }
      },
      {
        ...stub,
        targetNodeId: stage.id,
        onlyTargetNode: true,
        priorNodeStates: {
          [sprite.id]: {
            status: 'done',
            outputs: {
              out: {
                kind: 'image',
                id: 'sprite-out',
                dataUrl: 'data:image/png;base64,SPRITE',
                createdAt: '2026-09-09T00:00:00.000Z',
                relativePath: ''
              }
            }
          }
        }
      } as never
    )
  }

  it('帧率 > 0 + 自定义动作：逐帧 PNG + 1 张 sheet 落盘，并从 out-frames / out-sheet 输出', async () => {
    const { sprite, stage } = buildGraph()
    const { savedMedia, poses, sheetInputs, stub } = buildRunOptions()

    const result = await runStage(stage, sprite, stub)
    expect(result.ok, result.error).toBe(true)

    const outputs = result.states[stage.id]!.outputs!
    const frames = outputs[STAGE2D_FRAMES_OUT_PORT_ID] as {
      kind: string
      items: Array<{ relativePath?: string }>
    }
    expect(frames.kind).toBe('images')
    expect(frames.items).toHaveLength(FPS)
    // 逐帧 PNG 按动作名 + 序号落盘
    expect(frames.items[0]!.relativePath).toContain('-anim-wave-001')
    expect(frames.items[FPS - 1]!.relativePath).toContain(
      `-anim-wave-${String(FPS).padStart(3, '0')}`
    )

    // sheet 走单值端口，与帧序列分开
    const sheet = outputs[STAGE2D_SHEET_OUT_PORT_ID] as { kind: string; relativePath?: string }
    expect(sheet.kind).toBe('image')
    expect(sheet.relativePath).toContain('-anim-wave-sheet')

    // 落盘：单帧舞台图 1 + 逐帧 PNG 10 + sheet 1
    expect(savedMedia).toHaveLength(FPS + 2)
    expect(savedMedia.filter((media) => media.key.includes('-sheet'))).toHaveLength(1)
    // 拼版收到全部逐帧 dataUrl（顺序即时间顺序）
    expect(sheetInputs).toHaveLength(1)
    expect(sheetInputs[0]).toHaveLength(FPS)

    // 合成调用：1 次单帧舞台图 + 10 次动作帧；首帧为绑定姿势，随后逐帧插值
    expect(poses).toHaveLength(FPS + 1)
    expect(poses[0]).toEqual({})
    expect(poses[1]).toEqual({})
    expect(poses[FPS]!.shoulderL).toBeGreaterThan(0)
    expect(poses[FPS]!.shoulderL).toBeLessThan(30)

    // 产物路径与帧数写回节点参数（卡片 / 后续运行可复用）
    expect(stage.params.stage2dAnimFps).toBe(FPS)
    expect(stage.params.stage2dAnimFrameCount).toBe(FPS)
    expect(stage.params.stage2dAnimFramePaths).toHaveLength(FPS)
    expect(stage.params.stage2dAnimSheetRelativePath).toContain('-anim-wave-sheet')
  })

  it('帧率为 0（默认）：只出单帧舞台图，不产生帧序列 / sheet', async () => {
    const { sprite, stage } = buildGraph({ stage2dAnimFps: 0 })
    const { savedMedia, sheetInputs, stub } = buildRunOptions()

    const result = await runStage(stage, sprite, stub)
    expect(result.ok, result.error).toBe(true)

    const outputs = result.states[stage.id]!.outputs!
    expect(outputs[STAGE2D_FRAMES_OUT_PORT_ID]).toBeUndefined()
    expect(outputs[STAGE2D_SHEET_OUT_PORT_ID]).toBeUndefined()
    expect(savedMedia).toHaveLength(1)
    expect(sheetInputs).toHaveLength(0)
    expect(stage.params.stage2dAnimFrameCount).toBeUndefined()
  })

  it('设了帧率但没有自定义动作：保持只出单帧', async () => {
    const { sprite, stage } = buildGraph({ stage2dAction: null })
    const { savedMedia, sheetInputs, stub } = buildRunOptions()

    const result = await runStage(stage, sprite, stub)
    expect(result.ok, result.error).toBe(true)

    const outputs = result.states[stage.id]!.outputs!
    expect(outputs[STAGE2D_FRAMES_OUT_PORT_ID]).toBeUndefined()
    expect(savedMedia).toHaveLength(1)
    expect(sheetInputs).toHaveLength(0)
  })
})
