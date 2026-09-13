import { describe, expect, it } from 'vitest'
import {
  MAX_ROUND_OUTPUT_CARDS,
  generatedAssetKeyOf,
  groupRoundOutputs,
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

describe('产物扫盘：同批次聚合出卡', () => {
  function file(relativePath: string, mtimeMs: number, size = 1024): ProjectOutputFile {
    return { relativePath, mtimeMs, size }
  }

  /** 走一遍真实链路：先筛选再聚合 */
  function cardsOf(files: ProjectOutputFile[], options?: { limit?: number; maxMembers?: number }) {
    const { picked } = selectRoundOutputs(files, { sinceMs: 0 })
    return groupRoundOutputs(picked, options)
  }

  it('同一资产的矢量源与烘焙位图合成一张卡（代表文件取最早写入的一份）', () => {
    const { cards, hidden } = cardsOf([
      file('Cache/Images/人像 v3_SVG 源_20260913-151235371.svg', 1_000_000),
      file('Cache/Images/人像 v3_烘焙预览 PNG_20260913-151235504.png', 1_000_133)
    ])
    expect(cards).toHaveLength(1)
    expect(cards[0]!.primary.relativePath).toBe(
      'Cache/Images/人像 v3_SVG 源_20260913-151235371.svg'
    )
    expect(cards[0]!.related.map((f) => f.relativePath)).toEqual([
      'Cache/Images/人像 v3_烘焙预览 PNG_20260913-151235504.png'
    ])
    expect(hidden).toBe(0)
  })

  it('节点参数预览副本（无资产名前缀）按紧窗口挂进同批次', () => {
    const { cards } = cardsOf([
      file('Cache/Images/人像 v3_SVG 源_20260913-151235371.svg', 1_000_000),
      file('Cache/Images/node-6548078e_param-preview.svg', 1_000_050)
    ])
    expect(cards).toHaveLength(1)
    expect(cards[0]!.related.map((f) => f.relativePath)).toEqual([
      'Cache/Images/node-6548078e_param-preview.svg'
    ])
  })

  it('预览副本先落盘时同样归并，并由随后的同源产物补上批次身份', () => {
    const { cards } = cardsOf([
      file('Cache/Images/node-abc_param-preview.svg', 1_000_000),
      file('Cache/Images/人像 v3_SVG 源_20260913-151235371.svg', 1_000_120),
      // 第三份与第二份同源：组身份已由第二份补上，因此必须与第二份同前缀才继续归并
      file('Cache/Images/人像 v3_烘焙预览 PNG_20260913-151235504.png', 1_000_260)
    ])
    expect(cards).toHaveLength(1)
    expect(cards[0]!.primary.relativePath).toBe('Cache/Images/node-abc_param-preview.svg')
    expect(cards[0]!.related).toHaveLength(2)
  })

  it('预览副本与产物相隔过久（超过紧窗口）则单独成卡', () => {
    const { cards } = cardsOf([
      file('Cache/Images/人像 v3_SVG 源_20260913-151235371.svg', 1_000_000),
      file('Cache/Images/node-6548078e_param-preview.svg', 1_003_000)
    ])
    expect(cards).toHaveLength(2)
    expect(cards[0]!.related).toHaveLength(0)
  })

  it('不同资产（v3 / v4）分批出卡', () => {
    const { cards } = cardsOf([
      file('Cache/Images/人像 v3_SVG 源_20260913-151235371.svg', 1_000_000),
      file('Cache/Images/人像 v3_烘焙预览 PNG_20260913-151235504.png', 1_000_133),
      file('Cache/Images/人像 v4_SVG 源_20260913-151542077.svg', 1_180_077),
      file('Cache/Images/人像 v4_烘焙预览 PNG_20260913-151542194.png', 1_180_194)
    ])
    expect(cards).toHaveLength(2)
    expect(cards[0]!.primary.relativePath).toBe(
      'Cache/Images/人像 v3_SVG 源_20260913-151235371.svg'
    )
    expect(cards[0]!.related).toHaveLength(1)
    expect(cards[1]!.primary.relativePath).toBe(
      'Cache/Images/人像 v4_SVG 源_20260913-151542077.svg'
    )
    expect(cards[1]!.related).toHaveLength(1)
  })

  it('带序号的帧序列与 GIF 同属一批（前缀相同即归并）', () => {
    const { cards, hidden } = cardsOf([
      file('Cache/Images/人像 v6_烘焙预览 PNG_20260913-152625969_1.png', 1_000_000),
      file('Cache/Images/人像 v6_烘焙预览 PNG_20260913-152625969_2.png', 1_000_100),
      file('Cache/Images/人像 v6_烘焙预览 PNG-gif_20260913-152626030.gif', 1_000_200)
    ])
    expect(cards).toHaveLength(1)
    expect(cards[0]!.related).toHaveLength(2)
    expect(hidden).toBe(0)
  })

  it('同源间距拉开（超过同源窗口）即开下一张卡', () => {
    const { cards } = cardsOf([
      file('Cache/Images/人像 v3_A_20260913-151235371.svg', 1_000_000),
      file('Cache/Images/人像 v3_B_20260913-151400000.png', 1_000_000 + 15_000)
    ])
    expect(cards).toHaveLength(2)
  })

  it('单卡成员上限：超出的文件只计数', () => {
    const files = Array.from({ length: 20 }, (_, i) =>
      file(`Cache/Images/人像 v6_烘焙预览 PNG_20260913-152625969_${i + 1}.png`, 1_000_000 + i * 50)
    )
    const { cards, hidden } = cardsOf(files, { maxMembers: 3 })
    expect(cards).toHaveLength(1)
    expect(cards[0]!.primary.relativePath).toContain('_1.png')
    expect(cards[0]!.related).toHaveLength(2)
    expect(hidden).toBe(17)
  })

  it('卡上限：整批被挡下时只计数', () => {
    const { cards, hidden } = cardsOf(
      [
        file('Cache/Images/人像 v3_A_20260913-151235371.svg', 1_000_000),
        file('Cache/Images/人像 v3_B_20260913-151235504.png', 1_000_133),
        file('Cache/Images/人像 v4_A_20260913-151542077.svg', 1_180_077),
        file('Cache/Images/人像 v4_B_20260913-151542194.png', 1_180_194)
      ],
      { limit: 1 }
    )
    expect(cards).toHaveLength(1)
    expect(cards[0]!.primary.relativePath).toContain('v3_A')
    expect(hidden).toBe(2)
  })

  it('空输入不产卡', () => {
    expect(cardsOf([])).toEqual({ cards: [], hidden: 0 })
  })
})

describe('产物扫盘：批次聚合键', () => {
  it('按生成媒体命名取资产名前缀（时间戳与序号都不算）', () => {
    expect(generatedAssetKeyOf('Cache/Images/鹈鹕_SVG 源_20260913-151235371.svg')).toBe('鹈鹕')
    expect(generatedAssetKeyOf('Cache/Images/鹈鹕_烘焙预览 PNG_20260913-152625969_3.png')).toBe(
      '鹈鹕'
    )
    expect(generatedAssetKeyOf('Cache\\Images\\人像 v3_SVG 源_20260913-151235371.svg')).toBe(
      '人像 v3'
    )
  })

  it('非生成命名（agent 手写 / 节点参数预览）返回 null，交给时间窗口兜底', () => {
    expect(generatedAssetKeyOf('Cache/Images/node-6548078e_param-preview.svg')).toBeNull()
    expect(generatedAssetKeyOf('Cache/Images/frame-001.png')).toBeNull()
    expect(generatedAssetKeyOf('Cache/Images/只有资产名.png')).toBeNull()
    expect(generatedAssetKeyOf('Output/_20260913-151235371.svg')).toBeNull()
  })
})
