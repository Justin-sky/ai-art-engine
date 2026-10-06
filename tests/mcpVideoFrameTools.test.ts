import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 视频帧操作接入 MCP 工具层（P2 缺口收尾）。
 *
 * 此前这四条能力只有 IPC（`video:detect-keyframes` / `-extract-frames` /
 * `-grab-timestamps` / `-beat-analyze`），Agent 拿不到画面也拿不到打点 ——
 * 而"看懂视频"正是它做剪辑决策的前提。
 *
 * 主进程服务依赖 Electron 单例，无法在此环境实例化，故用源码级接线断言
 * （与本仓其它 MCP 测试同一手法）。
 */
const SRC = readFileSync(resolve('src/main/services/mcpServerService.ts'), 'utf8')

function toolBlock(toolName: string): string {
  const marker = `name: '${toolName}',`
  const start = SRC.indexOf(marker)
  expect(start, `找不到工具 ${toolName} 的定义`).toBeGreaterThanOrEqual(0)
  const nextTool = SRC.indexOf("name: '", start + marker.length)
  const arrayEnd = SRC.indexOf('\n]\n', start + marker.length)
  const candidates = [nextTool, arrayEnd].filter((n) => n > 0)
  const end = candidates.length ? Math.min(...candidates) : SRC.length
  return SRC.slice(start, end)
}

const EXTRACT = toolBlock('extract_video_frames')
const GRAB = toolBlock('grab_video_frames')
const KEYFRAMES = toolBlock('detect_video_keyframes')
const BEATS = toolBlock('analyze_video_beats')

describe('四个视频工具都接上既有服务方法', () => {
  const cases: Array<[string, string, string]> = [
    ['extract_video_frames', EXTRACT, 'extractVideoFrames'],
    ['grab_video_frames', GRAB, 'grabVideoFramesAtTimestamps'],
    ['detect_video_keyframes', KEYFRAMES, 'detectVideoKeyframes'],
    ['analyze_video_beats', BEATS, 'analyzeVideoBeats']
  ]

  it.each(cases)('%s 调 projectService.%s', (_name, block, method) => {
    expect(block).toContain(`projectService.${method}(`)
  })

  it('三个取帧类工具都能用 assetId 或 relativePath 指定源', () => {
    for (const block of [EXTRACT, GRAB, KEYFRAMES]) {
      expect(block).toContain('resolveVideoRelativePath(args)')
      expect(block).toContain('assetId')
      expect(block).toContain('relativePath')
    }
  })

  it('打点只吃 assetId（结果要写回资产，路径没有可写落点）', () => {
    expect(BEATS).toMatch(/required: \['assetId'\]/)
    expect(BEATS).toContain("readString(args, 'assetId')")
    expect(BEATS).not.toContain('resolveVideoRelativePath')
  })

  it('四个工具都不写资产、不比生成闸门（本地处理，不产生上游费用）', () => {
    const gated = SRC.slice(SRC.indexOf('const GATED_TOOLS'), SRC.indexOf('interface McpToolDef'))
    for (const name of [
      'extract_video_frames',
      'grab_video_frames',
      'detect_video_keyframes',
      'analyze_video_beats'
    ]) {
      expect(gated).not.toContain(`'${name}'`)
    }
  })
})

describe('grab_video_frames：把画面回给客户端', () => {
  it('用既有的 mcpImages 约定（splitToolImages 会转成 image content）', () => {
    expect(GRAB).toContain('mcpImages:')
    // 该约定由 splitToolImages 消费；确认它仍在（否则图会以裸 data URL 进上下文）
    expect(SRC).toContain('function splitToolImages')
    expect(SRC).toContain('MCP_IMAGES_KEY')
  })

  it('限流并明确告知被截断（静默截断会让 agent 以为看到的就是全部）', () => {
    expect(GRAB).toContain('VIDEO_FRAME_MAX_IMAGES')
    expect(GRAB).toMatch(/kept = grabbed\.slice\(0, VIDEO_FRAME_MAX_IMAGES\)/)
    expect(GRAB).toMatch(/剩余时间点请分批再取/)
  })

  it('timestamps 必填且过滤负数', () => {
    expect(GRAB).toMatch(/required: \['timestamps'\]/)
    expect(GRAB).toMatch(/readNumberList\(args, 'timestamps'\)\.filter\(\(t\) => t >= 0\)/)
    expect(GRAB).toMatch(/需要至少一个非负的时间点/)
  })

  it('指南把"看一眼"与"要文件"分开（指向 extract_video_frames）', () => {
    expect(GRAB).toMatch(/extract_video_frames/)
  })
})

describe('extract_video_frames：落盘并限流', () => {
  it('count 有下限 1 与上限约束', () => {
    expect(EXTRACT).toMatch(/Math\.max\(1, rawCount === undefined \? 4 : Math\.floor\(rawCount\)\)/)
    expect(EXTRACT).toMatch(/VIDEO_FRAME_EXTRACT_MAX/)
  })

  it('ffmpeg 缺失时返回空数组并给出提示（既有服务约定，不改成抛错）', () => {
    expect(EXTRACT).toMatch(/没有抽到帧/)
    expect(EXTRACT).toMatch(/ffmpeg/)
  })

  it('指南把"要文件"与"看一眼"分开（指向 grab_video_frames）', () => {
    expect(EXTRACT).toMatch(/grab_video_frames/)
  })
})

describe('detect_video_keyframes', () => {
  it('返回时间点清单并说明用途（挑切点后精确取帧）', () => {
    expect(KEYFRAMES).toMatch(/keyframes: keyframes \?\? \[\]/)
    expect(KEYFRAMES).toMatch(/grab_video_frames/)
  })

  it('说明是 ffprobe 级轻量操作（不逐帧解码）', () => {
    expect(KEYFRAMES).toMatch(/ffprobe/)
    expect(KEYFRAMES).toMatch(/不逐帧解码/)
  })
})

describe('analyze_video_beats', () => {
  it('返回被打点结果的 assetId 一并回给 agent', () => {
    expect(BEATS).toMatch(/return \{ assetId, \.\.\.tags \}/)
  })

  it('拿不到结果时明确报错并点出可能原因', () => {
    expect(BEATS).toMatch(/不是视频资产/)
    expect(BEATS).toMatch(/分析被跳过/)
  })

  it('说明会写回资产 meta 且可能 skipped（不是抛错）', () => {
    expect(BEATS).toMatch(/写回该视频资产的 meta/)
    expect(BEATS).toMatch(/status: skipped/)
  })
})

describe('限流常量', () => {
  it('帧数上限是有限正整数（base64 内联会挤爆上下文）', () => {
    expect(SRC).toMatch(/const VIDEO_FRAME_MAX_IMAGES = \d+/)
    expect(SRC).toMatch(/const VIDEO_FRAME_EXTRACT_MAX = \d+/)
  })
})
