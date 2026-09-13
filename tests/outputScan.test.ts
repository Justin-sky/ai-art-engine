import { describe, expect, it } from 'vitest'
import {
  MAX_ROUND_OUTPUT_CARDS,
  isScannedOutputPath,
  normalizeOutputPathKey,
  selectRoundOutputs,
  type ProjectOutputFile
} from '@shared/outputScan'

describe('产物扫盘：路径口径', () => {
  it('收录 Output / Cache 下的可预览媒体', () => {
    expect(isScannedOutputPath('Output/images/a.png')).toBe(true)
    expect(isScannedOutputPath('Cache/Images/a.PNG')).toBe(true)
    expect(isScannedOutputPath('Cache/Voices/a.mp3')).toBe(true)
    expect(isScannedOutputPath('Output/PortraitSVG/a.svg')).toBe(true)
    expect(isScannedOutputPath('Cache/3D/a.glb')).toBe(true)
    expect(isScannedOutputPath('Cache/Videos/a.mp4')).toBe(true)
  })

  it('反斜杠与前导斜杠写法等价', () => {
    expect(isScannedOutputPath('Cache\\Images\\a.png')).toBe(true)
    expect(isScannedOutputPath('/Output/a.webp')).toBe(true)
  })

  it('目录名大小写不敏感（Windows 上写法并不统一）', () => {
    expect(isScannedOutputPath('cache/images/a.png')).toBe(true)
    expect(isScannedOutputPath('OUTPUT/a.gif')).toBe(true)
  })

  it('排除资产库 / 图产物目录与裸文件', () => {
    expect(isScannedOutputPath('Assets/Generated/Images/a.png')).toBe(false)
    expect(isScannedOutputPath('.aiartengine/graph-outputs/a.png')).toBe(false)
    expect(isScannedOutputPath('a.png')).toBe(false)
    expect(isScannedOutputPath('images/a.png')).toBe(false)
    expect(isScannedOutputPath('Output/images')).toBe(false)
    expect(isScannedOutputPath('')).toBe(false)
  })

  it('产物目录根下直接落文件也算（agent 常这么写）', () => {
    expect(isScannedOutputPath('Output/a.png')).toBe(true)
    expect(isScannedOutputPath('Cache/a.svg')).toBe(true)
  })

  it('排除隐藏路径段与元数据文件', () => {
    expect(isScannedOutputPath('Cache/.tmp/a.png')).toBe(false)
    expect(isScannedOutputPath('Cache/Images/.hidden.png')).toBe(false)
    expect(isScannedOutputPath('Cache/Images/a.png.asset.json')).toBe(false)
    expect(isScannedOutputPath('Cache/Images/a.thumbnail.webp')).toBe(false)
  })

  it('排除不可预览的类型（文本 / JSON / 无扩展名）', () => {
    expect(isScannedOutputPath('Cache/Texts/a.txt')).toBe(false)
    expect(isScannedOutputPath('Output/data.json')).toBe(false)
    expect(isScannedOutputPath('Output/noext')).toBe(false)
  })

  it('路径比对键：统一正斜杠并去掉前导斜杠', () => {
    expect(normalizeOutputPathKey('\\Cache\\Images\\a.png')).toBe('Cache/Images/a.png')
    expect(normalizeOutputPathKey('  /Output/x.svg  ')).toBe('Output/x.svg')
  })
})

describe('产物扫盘：本轮筛选', () => {
  function file(relativePath: string, mtimeMs: number, size = 1024): ProjectOutputFile {
    return { relativePath, mtimeMs, size }
  }

  it('只收本轮（sinceMs 之后）写入的文件', () => {
    const files = [file('Cache/Images/old.png', 1_000), file('Cache/Images/new.png', 5_000)]
    const { picked, hidden } = selectRoundOutputs(files, { sinceMs: 3_000 })
    expect(picked.map((f) => f.relativePath)).toEqual(['Cache/Images/new.png'])
    expect(hidden).toBe(0)
  })

  it('按写入时间升序（与对话的时间顺序一致）', () => {
    const files = [
      file('Cache/Images/b.png', 5_000),
      file('Cache/Images/a.png', 4_000),
      file('Cache/Images/c.png', 6_000)
    ]
    expect(selectRoundOutputs(files, { sinceMs: 0 }).picked.map((f) => f.relativePath)).toEqual([
      'Cache/Images/a.png',
      'Cache/Images/b.png',
      'Cache/Images/c.png'
    ])
  })

  it('exclude 命中的路径不再出卡（路径写法不同也认）', () => {
    const files = [file('Cache/Images/a.png', 5_000), file('Cache/Images/b.png', 5_000)]
    const { picked } = selectRoundOutputs(files, {
      sinceMs: 0,
      exclude: ['Cache\\Images\\a.png', 'Output/none.svg']
    })
    expect(picked.map((f) => f.relativePath)).toEqual(['Cache/Images/b.png'])
  })

  it('同一路径只出一次卡', () => {
    const files = [file('Cache/Images/a.png', 5_000), file('Cache/Images/a.png', 6_000)]
    expect(selectRoundOutputs(files, { sinceMs: 0 }).picked).toHaveLength(1)
  })

  it('空文件（半截产物）不出卡', () => {
    const files = [file('Cache/Images/empty.png', 5_000, 0), file('Cache/Images/ok.png', 5_000)]
    expect(selectRoundOutputs(files, { sinceMs: 0 }).picked.map((f) => f.relativePath)).toEqual([
      'Cache/Images/ok.png'
    ])
  })

  it('范围外的路径即使传进来也不出卡', () => {
    const files = [
      file('Assets/a.png', 5_000),
      file('Cache/Texts/a.txt', 5_000),
      file('Output/x.svg', 5_000)
    ]
    expect(selectRoundOutputs(files, { sinceMs: 0 }).picked.map((f) => f.relativePath)).toEqual([
      'Output/x.svg'
    ])
  })

  it('超出上限的部分只计数', () => {
    const files = Array.from({ length: 30 }, (_, i) => file(`Cache/Images/${i}.png`, 5_000 + i))
    const { picked, hidden } = selectRoundOutputs(files, { sinceMs: 0, limit: 3 })
    expect(picked).toHaveLength(3)
    expect(hidden).toBe(27)
  })

  it('缺省上限为单轮产物卡上限', () => {
    const files = Array.from({ length: MAX_ROUND_OUTPUT_CARDS + 5 }, (_, i) =>
      file(`Cache/Images/${i}.png`, 5_000 + i)
    )
    const { picked, hidden } = selectRoundOutputs(files, { sinceMs: 0 })
    expect(picked).toHaveLength(MAX_ROUND_OUTPUT_CARDS)
    expect(hidden).toBe(5)
  })
})
