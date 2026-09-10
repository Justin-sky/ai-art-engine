import { describe, expect, it, vi } from 'vitest'
import {
  createNodeFromType,
  executeAnim2dNode,
  type NodeExecuteContext
} from '../src/shared/graph'

/**
 * 2D帧动画的 GIF 输出（animGifFps）：帧率 > 0 时合成动图并落盘，
 * 走 MCP / 工作流（graph_edit 设置参数 + task_run）与界面运行同一条执行链路。
 */
function buildCtx(params: Record<string, unknown> = {}) {
  const node = createNodeFromType('anim.2d', { x: 0, y: 0 })
  node.params = { ...node.params, animRows: 2, animCols: 2, ...params }
  const composeGifFrames = vi.fn(async () => ({
    dataUrl: 'data:image/gif;base64,Z2lm',
    width: 32,
    height: 32,
    frameCount: 4,
    byteLength: 128
  }))
  const saveRunMedia = vi.fn(async (opts: { dataUrl: string; key: string }) => {
    // 逐帧 PNG 与合成 GIF 共用落盘入口，扩展名由 mime 决定
    const ext = opts.dataUrl.startsWith('data:image/gif') ? 'gif' : 'png'
    return `Cache/Images/${opts.key}.${ext}`
  })
  const ctx = {
    node,
    inputs: { in: [{ kind: 'image', dataUrl: 'data:image/png;base64,Z3JpZA==' }] },
    locale: 'zh-CN',
    signal: undefined,
    composeImageGridCell: async (input: { cellKey: string }) => ({
      dataUrl: `data:image/png;base64,Y2VsbA==${input.cellKey}`,
      width: 16,
      height: 16,
      cellKey: input.cellKey
    }),
    composeGifFrames,
    saveRunMedia,
    resolveHostAssetName: () => 'host',
    patchNode: (patch: { params: Record<string, unknown> }) => {
      node.params = { ...node.params, ...patch.params }
    }
  } as unknown as NodeExecuteContext
  return { node, ctx, composeGifFrames, saveRunMedia }
}

describe('anim.2d gif output', () => {
  it('composes and persists a gif when animGifFps > 0', async () => {
    const { node, ctx, composeGifFrames, saveRunMedia } = buildCtx({ animGifFps: 8 })

    const outputs = await executeAnim2dNode(ctx)

    expect(composeGifFrames).toHaveBeenCalledTimes(1)
    const call = composeGifFrames.mock.calls[0]![0] as {
      frameUrls: string[]
      fps: number
      loop?: boolean
    }
    expect(call.fps).toBe(8)
    expect(call.loop).toBe(true)
    expect(call.frameUrls).toHaveLength(4)

    const gif = outputs['out-gif'] as { kind: string; relativePath?: string; dataUrl?: string }
    expect(gif.kind).toBe('image')
    expect(gif.relativePath).toMatch(/\.gif$/)
    expect(gif.dataUrl).toBe('')
    // GIF 与逐帧 PNG 各落一次盘
    expect(saveRunMedia).toHaveBeenCalledTimes(5)
    expect(node.params.animGifRelativePath).toBe(gif.relativePath)
    expect(node.params.animGifFps).toBe(8)
    expect(node.params.animGifFrameCount).toBe(4)
    // 切帧产物不受影响
    expect((node.params.generatedImages as unknown[]).length).toBe(4)
  })

  it('stays pure frame split when gif fps is off', async () => {
    const { node, ctx, composeGifFrames } = buildCtx({ animGifFps: 0 })

    const outputs = await executeAnim2dNode(ctx)

    expect(composeGifFrames).not.toHaveBeenCalled()
    expect(outputs['out-gif']).toBeUndefined()
    expect(node.params.animGifRelativePath).toBeUndefined()
    expect((node.params.generatedImages as unknown[]).length).toBe(4)
  })

  it('skips gif when the renderer did not inject the composer', async () => {
    const { ctx, composeGifFrames } = buildCtx({ animGifFps: 8 })
    const withoutComposer = { ...ctx, composeGifFrames: undefined } as unknown as NodeExecuteContext

    const outputs = await executeAnim2dNode(withoutComposer)

    expect(composeGifFrames).not.toHaveBeenCalled()
    expect(outputs['out-gif']).toBeUndefined()
  })
})
