import { execFileSync } from 'child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SEMANTIC_TIMELINE_SCHEMA, validateSemanticTimeline } from '../src/shared/semanticTimeline'
import { generateSolidVideoFixture } from '../src/main/services/semanticTimeline/mediaFacts'
import { resolveFfmpegForSemantic } from '../src/main/services/semanticTimeline/resolveFfmpeg'
import { analyzeShotsOnly } from '../src/main/services/semanticTimeline/SemanticTimelineService'

/**
 * `analyzeShotsOnly` 的落盘守卫（ffmpeg 门控）。
 *
 * 这条用例原先和已删除的 roundtrip（按镜头裁剪重建原片）挤在
 * `semanticTimelineRoundtrip.test.ts` 里，删 roundtrip 时被一起带走了 ——
 * 但 `analyzeShotsOnly` 是**活代码**：分析节点走
 * `analyzeSemanticTimeline` → 它就是其中的阶段 0/1（探测媒体事实 + 切镜 + 关键帧 +
 * 落盘骨架文档）。所以单独搬到这里继续覆盖。
 *
 * 它**不依赖** roundtrip：只 import 媒体夹具、ffmpeg 解析与语义分析服务。
 *
 * 门控口径：用 `resolveFfmpegForSemantic()`（= 被测代码自己用的那个解析器）取二进制并
 * 真的探一次 `-version`。比只查 PATH 更贴合 —— 应用随包的 ffmpeg 不在 PATH 上，
 * 只查 PATH 会在"代码明明能跑"的机器上静默 skip，覆盖就假了；反过来，解析器找不到时
 * 它会回退成裸名字，探活失败即 skip（不会变成必然失败）。
 */
const hasFfmpeg = (() => {
  try {
    execFileSync(resolveFfmpegForSemantic(), ['-version'], {
      stdio: 'ignore',
      windowsHide: true,
      timeout: 10_000
    })
    return true
  } catch {
    return false
  }
})()

describe.runIf(hasFfmpeg)('analyzeShotsOnly 落盘（ffmpeg）', () => {
  let dir = ''

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'stl-analyze-'))
  })

  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  it('写出可解析的 aiart.semantic-timeline@1 文档与 shots 证据', async () => {
    const src = join(dir, 'analyze.mp4')
    await generateSolidVideoFixture(src, { durationSec: 1.5, fps: 12 })
    const project = join(dir, 'project')
    const result = await analyzeShotsOnly(project, 'asset-video-1', src)

    expect(result.timeline.source.assetId).toBe('asset-video-1')

    const docPath = join(project, 'Semantic', result.timeline.id, 'timeline.json')
    expect(existsSync(docPath), `timeline.json 未落盘：${docPath}`).toBe(true)

    // 关键：落盘的要是一份**能解析、且校验器认可**的文档。
    // 只断"文件存在"会漏掉写空文件 / 半截 JSON / schema 漂移这几种坏法。
    const raw: unknown = JSON.parse(readFileSync(docPath, 'utf8'))
    const validation = validateSemanticTimeline(raw)
    expect(
      validation.issues,
      `落盘文档未过校验：${validation.issues.map((i) => `${i.path}: ${i.message}`).join('; ')}`
    ).toEqual([])
    expect(validation.ok).toBe(true)

    const doc = raw as {
      id: string
      schema: string
      source: { assetId: string; fps: number; duration: number; width: number; height: number }
      tracks: unknown[]
    }
    expect(doc.schema).toBe(SEMANTIC_TIMELINE_SCHEMA)
    expect(doc.id).toBe(result.timeline.id)
    expect(doc.source.assetId).toBe('asset-video-1')
    expect(doc.source.fps).toBeGreaterThan(0)
    expect(doc.source.duration).toBeGreaterThan(1)
    expect(doc.source.width).toBeGreaterThan(0)
    expect(doc.tracks).toHaveLength(8)

    // 另一半产出：同目录的 shots 证据
    expect(
      existsSync(join(project, 'Semantic', result.timeline.id, 'evidence', 'shots.json'))
    ).toBe(true)
  }, 120_000)
})
