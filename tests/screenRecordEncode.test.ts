import { execFileSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'
import { afterAll, describe, expect, it } from 'vitest'
import {
  buildImageSequenceArgs,
  planFrameKeeps,
  planFrameSequence,
  type CapturedFrame
} from '../src/shared/screenRecord'

/**
 * 「帧序列 → MP4」这一步的**真实**端到端验证。
 *
 * 这是整条链路里唯一没法靠单元测试证明的部分，而它确实抓到过真问题：第一版用
 * concat + `-vsync vfr`，本机 ffmpeg 9.0.2 早已移除 `-vsync`（`Unrecognized option`），
 * 整段录制根本编不出来；改成 concat 的 duration 行后又发现加 `-r` 会膨胀（3 秒编出 3.9 秒）、
 * 加 `-t` 会切尾（2.04 秒）。现在这套（硬链接展开 + image2 + `-framerate`）实测时长精确，
 * 且不依赖任何会被移除的选项。
 *
 * ffmpeg / ffprobe 不可用时整组 skip（与仓库既有的 ffmpeg 相关用例同口径）。
 */

/** 与 `videoFrameService.findFfmpegBin` 同一批候选位置（本测试不 import 主进程模块，避免拖进 Electron） */
function resolveFfmpegDir(): string | null {
  const exe = process.platform === 'win32' ? '.exe' : ''
  const candidates = [
    process.env.FFMPEG_PATH?.trim().replace(/[\\/][^\\/]+$/, '') ?? '',
    join(process.env.LOCALAPPDATA ?? '', 'ai-art-engine', 'ffmpeg', 'bin'),
    join(process.cwd(), 'out', 'ffmpeg', process.arch),
    'C:\\ffmpeg\\bin'
  ].filter(Boolean)
  for (const dir of candidates) {
    if (existsSync(join(dir, `ffmpeg${exe}`)) && existsSync(join(dir, `ffprobe${exe}`))) return dir
  }
  return null
}

const FFMPEG_DIR = resolveFfmpegDir()
const exe = process.platform === 'win32' ? '.exe' : ''
const FFMPEG = FFMPEG_DIR ? join(FFMPEG_DIR, `ffmpeg${exe}`) : ''
const FFPROBE = FFMPEG_DIR ? join(FFMPEG_DIR, `ffprobe${exe}`) : ''
const maybe = FFMPEG_DIR ? describe : describe.skip

// ── 最小 PNG 编码器（纯 node：zlib + CRC32），用来造真图 ──────────────────────
const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([len, body, crc])
}

/** 生成一张纯色 PNG（8bit truecolor） */
function solidPng(width: number, height: number, rgb: [number, number, number]): Buffer {
  const stride = width * 3 + 1
  const raw = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y += 1) {
    const off = y * stride
    raw[off] = 0 // filter: none
    for (let x = 0; x < width; x += 1) {
      raw[off + 1 + x * 3] = rgb[0]
      raw[off + 2 + x * 3] = rgb[1]
      raw[off + 3 + x * 3] = rgb[2]
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // color type: truecolor
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0))
  ])
}

function probeDurationSec(file: string): number {
  return Number(
    execFileSync(
      FFPROBE,
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file],
      { encoding: 'utf8' }
    ).trim()
  )
}

const workDir = mkdtempSync(join(tmpdir(), 'aae-screen-record-encode-'))
afterAll(() => {
  rmSync(workDir, { recursive: true, force: true })
})

maybe('帧序列 → MP4（真实编码）', () => {
  it('三张各停留 1 秒 → 成片时长精确到 3 秒（硬链接展开成 CFR）', () => {
    const fps = 10
    const colors: Array<[number, number, number]> = [
      [200, 30, 30],
      [30, 200, 30],
      [30, 30, 200]
    ]
    const uniq: string[] = []
    const frames: CapturedFrame[] = []
    colors.forEach((rgb, i) => {
      const file = join(workDir, `uniq-${i}.png`)
      writeFileSync(file, solidPng(320, 180, rgb))
      uniq.push(file)
      frames.push({ atMs: i * 1000, fingerprint: `f${i}` })
    })

    const plan = planFrameKeeps(frames, { tailHoldMs: 1000 })
    const order = planFrameSequence(plan.keeps, fps)
    expect(order).toHaveLength(30) // 3 段 × 1 秒 × 10fps

    const seqDir = join(workDir, 'seq')
    mkdirSync(seqDir, { recursive: true })
    order.forEach((sourceIndex, i) => {
      const dest = join(seqDir, `f-${String(i + 1).padStart(4, '0')}.png`)
      try {
        linkSync(uniq[sourceIndex]!, dest)
      } catch {
        copyFileSync(uniq[sourceIndex]!, dest)
      }
    })

    const outPath = join(workDir, 'out.mp4')
    execFileSync(
      FFMPEG,
      buildImageSequenceArgs({ seqPatternPath: join(seqDir, 'f-%04d.png'), outPath, fps }),
      { stdio: 'pipe' }
    )

    expect(existsSync(outPath)).toBe(true)
    expect(statSync(outPath).size).toBeGreaterThan(1024)
    // 精确：CFR 下时长 = 帧数 / 帧率，不受容器时间基与 concat 末帧重复的影响
    expect(probeDurationSec(outPath)).toBeCloseTo(3, 2)
  }, 90_000)

  it('停留时长被摊成重复帧，而不是靠 ffmpeg 猜（累计取整不累积误差）', () => {
    // 每步 250ms、10fps → 每步 2.5 帧；累计取整应让总数精确落在 100 帧（10 秒）
    const keeps = Array.from({ length: 40 }, (_, i) => ({
      index: i,
      atMs: i * 250,
      holdMs: 250
    }))
    const order = planFrameSequence(keeps, 10)
    expect(order).toHaveLength(100)
    expect(order[0]).toBe(0)
    expect(order[order.length - 1]).toBe(39)
  })

  it('窗口尺寸是奇数时也能编码：libx264 拒绝奇数宽高，编码参数必须取偶', () => {
    // 录制尺寸直接来自 getContentSize()，用户拖一下窗口就可能拿到奇数（1101×701 这种）。
    // 不加取偶 -vf 时 ffmpeg 直接报 "width not divisible by 2"，整段录制作废。
    const oddDir = join(workDir, 'odd')
    mkdirSync(oddDir, { recursive: true })
    const uniq = join(oddDir, 'u.png')
    writeFileSync(uniq, solidPng(641, 361, [40, 160, 190]))
    for (let i = 1; i <= 10; i += 1) {
      const dest = join(oddDir, 'seq', `f-${String(i).padStart(4, '0')}.png`)
      mkdirSync(join(oddDir, 'seq'), { recursive: true })
      try {
        linkSync(uniq, dest)
      } catch {
        copyFileSync(uniq, dest)
      }
    }

    const outPath = join(oddDir, 'odd.mp4')
    execFileSync(
      FFMPEG,
      buildImageSequenceArgs({
        seqPatternPath: join(oddDir, 'seq', 'f-%04d.png'),
        outPath,
        fps: 10
      }),
      { stdio: 'pipe' }
    )

    expect(existsSync(outPath)).toBe(true)
    expect(statSync(outPath).size).toBeGreaterThan(512)
    // 成片尺寸被取偶（641×361 → 640×360）
    const dims = execFileSync(
      FFPROBE,
      [
        '-v',
        'error',
        '-select_streams',
        'v:0',
        '-show_entries',
        'stream=width,height',
        '-of',
        'csv=p=0',
        outPath
      ],
      { encoding: 'utf8' }
    ).trim()
    expect(dims).toBe('640,360')
  }, 90_000)

  it('空闲帧合并后写盘的图确实变少，但时间轴仍覆盖整段', () => {
    const plan = planFrameKeeps(
      [
        { atMs: 0, fingerprint: 'a' },
        { atMs: 100, fingerprint: 'a' },
        { atMs: 200, fingerprint: 'a' },
        { atMs: 300, fingerprint: 'b' }
      ],
      { tailHoldMs: 500 }
    )
    expect(plan.droppedIdle).toBe(2)
    // 只有两张唯一图，但展开成 8 帧（300ms + 末帧停留 500ms = 800ms @10fps）
    expect(plan.keeps.filter((k) => k.index === 0)).toHaveLength(1)
    expect(planFrameSequence(plan.keeps, 10)).toHaveLength(8)
  })
})
