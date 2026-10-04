import { describe, expect, it } from 'vitest'
import {
  PORTRAIT_AI_LAYER_LIMIT,
  PORTRAIT_MANUAL_REGION_LIMIT,
  PORTRAIT_PARAM_SPECS,
  PORTRAIT_PRESETS,
  PORTRAIT_RETOUCH_VERSION,
  PORTRAIT_TIER_PHRASES,
  PORTRAIT_TOOL_GROUPS,
  applyPortraitPreset,
  buildPortraitAiPrompt,
  buildPortraitPrompt,
  changedPortraitParamCount,
  defaultPortraitRetouch,
  exportPortraitPreset,
  importPortraitPreset,
  isPortraitParamChanged,
  normalizePortraitAiLayers,
  normalizePortraitManualRegion,
  normalizePortraitManualRegions,
  normalizePortraitRetouch,
  portraitGroupEnabled,
  portraitHighRiskTierCount,
  portraitIdentityRiskKeys,
  portraitRegionWhere,
  portraitRetouchToNodePatch,
  portraitSpecDefault,
  portraitSpecsForGroup,
  portraitTierPhrase,
  portraitTierSpecsForGroup,
  readPortraitRetouchFromNode,
  type PortraitManualRegion,
  type PortraitNeeds,
  type PortraitParamSpec,
  type PortraitRetouchState,
  type PortraitTierSpec
} from '../src/shared/graph/portraitRetouch'

/**
 * 人像处理参数契约（src/shared/graph/portraitRetouch.ts，v2 = 模型档位时代）。
 *
 * v2 把「本地烘焙的 103 个滑块」换成了「分段档位 + 自由描述」，节点唯一的执行语义
 * 就是**把参数翻译成提示词**。因此这个文件锁的是四类会被悄悄破坏的东西：
 * 1. 参数规格表是唯一真相来源：默认值、labelKey、档位取值域、分组全部从表里派生；
 * 2. 档位 → 提示词片段的覆盖：可选档位若没有片段，等于「面板能点、模型收不到」，
 *    这是最隐蔽的一类失效（本文件把已知缺口显式登记，见 KNOWN_EMPTY_TIER_PHRASES）；
 * 3. 归一化的兜底能力：脏数据（越界数字、非法颜色、未知枚举、退化框）必须被夹回
 *    合法值而不是抛错，v1 旧工程必须能迁移且迁移幂等；
 * 4. 依赖门禁与负面提示：缺人脸关键点/蒙版/姿态时整组不进提示词，
 *    风险负面词只由真实推高的档位推导。
 */

const ALL_NEEDS: PortraitNeeds = { face: true, mask: true, pose: true }
const NO_NEEDS: PortraitNeeds = { face: false, mask: false, pose: false }

function specOf(key: string): PortraitParamSpec {
  const spec = PORTRAIT_PARAM_SPECS.find((item) => item.key === key)
  if (!spec) throw new Error(`规格缺失：${key}`)
  return spec
}

function tierSpecOf(key: string): PortraitTierSpec {
  const spec = specOf(key)
  if (spec.kind !== 'tier') throw new Error(`不是档位规格：${key}`)
  return spec
}

function rawState(state: PortraitRetouchState): Record<string, unknown> {
  return state as unknown as Record<string, unknown>
}

function region(overrides: Partial<PortraitManualRegion> = {}): PortraitManualRegion {
  const region = normalizePortraitManualRegion({
    id: 'r1',
    kind: 'blemish',
    box: null,
    note: '',
    ...overrides
  })
  if (!region) throw new Error('region 用例应当是合法区域')
  return region
}

describe('portraitRetouch 规格表与默认值', () => {
  it('默认值只来自规格表，每个规格都有 labelKey，版本号是 2', () => {
    const state = defaultPortraitRetouch()
    const defaults = rawState(state)
    for (const spec of PORTRAIT_PARAM_SPECS) {
      expect(spec.labelKey.length, `labelKey 缺失：${spec.key}`).toBeGreaterThan(0)
      expect(defaults[spec.key], `默认值应由规格表给出：${spec.key}`).toBe(
        portraitSpecDefault(spec)
      )
    }
    expect(PORTRAIT_RETOUCH_VERSION).toBe(2)
    expect(state.v).toBe(PORTRAIT_RETOUCH_VERSION)
    expect(state.presetId).toBe('')
    expect(state.manualRegions).toEqual([])
  })

  it('portraitSpecDefault：tier 落 off、text 落空串、其余取规格 default', () => {
    expect(portraitSpecDefault(specOf('skinSmoothing'))).toBe('off')
    expect(portraitSpecDefault(specOf('extraNote'))).toBe('')
    expect(portraitSpecDefault(specOf('bgPrompt'))).toBe('')
    expect(portraitSpecDefault(specOf('lutId'))).toBe('none')
    expect(portraitSpecDefault(specOf('bgColor'))).toBe('#ffffff')
    expect(portraitSpecDefault(specOf('idPhotoSheet'))).toBe(false)
    expect(portraitSpecDefault(specOf('exportDpi'))).toBe(300)
  })

  it('tier / text 规格没有 default 字段（避免默认值两处维护）', () => {
    for (const spec of PORTRAIT_PARAM_SPECS) {
      if (spec.kind === 'tier') {
        expect('default' in spec, `${spec.key} 不应带 default`).toBe(false)
        expect(spec.tiers.length, `${spec.key} 应声明取值域`).toBeGreaterThan(1)
        expect(spec.tiers[0], `${spec.key} 的 off 必须排第一`).toBe('off')
      }
      if (spec.kind === 'text') {
        expect('default' in spec, `${spec.key} 不应带 default`).toBe(false)
        expect(spec.maxLength, `${spec.key} 应声明 maxLength`).toBeGreaterThan(0)
      }
    }
  })

  it('规格 key 唯一，且覆盖状态里除 v / presetId / manualRegions 之外的全部字段', () => {
    const specKeys = PORTRAIT_PARAM_SPECS.map((spec) => spec.key)
    expect(new Set(specKeys).size, '重复 key 会让面板渲染两次、归一化互相覆盖').toBe(
      specKeys.length
    )
    expect(new Set(Object.keys(defaultPortraitRetouch()))).toEqual(
      new Set(['v', 'presetId', 'manualRegions', ...specKeys])
    )
  })

  it('数值参数只剩证件照 DPI（v2 没有连续滑块）', () => {
    const numbers = PORTRAIT_PARAM_SPECS.filter((spec) => spec.kind === 'number').map(
      (spec) => spec.key
    )
    // exportFormat / exportQuality / exportMaxEdge 曾经存在，但改为「调模型出图」后
    // 没有任何一环会重新编码或缩放模型返回的图，留着等于 UI 承诺不存在的功能
    expect(numbers).toEqual(['exportDpi'])
    for (const spec of PORTRAIT_PARAM_SPECS) {
      if (spec.kind !== 'number') continue
      expect(spec.min).toBeLessThan(spec.max)
      expect(spec.step).toBeGreaterThan(0)
      expect(spec.default).toBeGreaterThanOrEqual(spec.min)
      expect(spec.default).toBeLessThanOrEqual(spec.max)
    }
  })

  it('按分组取规格（面板按组渲染）', () => {
    expect(portraitSpecsForGroup('face').length).toBe(9)
    expect(portraitSpecsForGroup('face').every((spec) => spec.group === 'face')).toBe(true)
    expect(portraitSpecsForGroup('color').some((spec) => spec.key === 'lutId')).toBe(true)
    expect(portraitTierSpecsForGroup('background').map((spec) => spec.key)).toEqual(['bgBlur'])
    expect(portraitTierSpecsForGroup('idPhoto')).toEqual([])

    const tierKeys = PORTRAIT_PARAM_SPECS.filter((spec) => spec.kind === 'tier').map(
      (spec) => spec.key
    )
    const byGroup = new Set(
      PORTRAIT_TOOL_GROUPS.flatMap((group) =>
        portraitTierSpecsForGroup(group.id).map((spec) => spec.key)
      )
    )
    expect([...byGroup].sort()).toEqual([...tierKeys].sort())
  })
})

describe('portraitRetouch 档位片段覆盖', () => {
  /**
   * 当前实现里「可选但取不到片段」的档位（选了等于没选）。测试显式登记，
   * 任何新增缺口都会让下面的用例失败，而不是悄悄溜过去：
   * - `eyeSpacing` 复用了双向档位 BI_TIERS（含 coolLight），但它的片段表没有这一档；
   * - `lightRatio` 的选项名是 soft/natural/dramatic/hard，片段表的键却是
   *   light/standard/strong/max，两者完全错位，四个选项全部取不到片段。
   */
  // 已经没有缺口：每个档位字段的每个非 off 档位都能取到片段。
  // 这个表刻意保留为空数组 —— 一旦有人加了档位却忘了写片段，测试会按名字报出来。
  const KNOWN_EMPTY_TIER_PHRASES: string[] = []

  it('每个档位字段的每个非 off 档位都要产出提示词片段（缺口表精确锁定）', () => {
    const missing: string[] = []
    for (const spec of PORTRAIT_PARAM_SPECS) {
      if (spec.kind !== 'tier') continue
      for (const option of spec.tiers) {
        if (option === 'off') continue
        if (!portraitTierPhrase(spec, option)) missing.push(`${spec.key}.${option}`)
      }
    }
    expect(missing).toEqual(KNOWN_EMPTY_TIER_PHRASES)
  })

  it('自带 phrases 的档位字段：表里每一项都能原样取回', () => {
    for (const spec of PORTRAIT_PARAM_SPECS) {
      if (spec.kind !== 'tier' || !spec.phrases) continue
      const entries = Object.entries(spec.phrases)
      expect(entries.length, `${spec.key} 的片段表是空的`).toBeGreaterThan(0)
      for (const [option, phrase] of entries) {
        expect(portraitTierPhrase(spec, option), `${spec.key}.${option}`).toBe(phrase)
      }
    }
  })

  it('依赖通用表 PORTRAIT_TIER_PHRASES 的字段：表里每一项都能原样取回', () => {
    const specs = PORTRAIT_PARAM_SPECS.filter(
      (spec): spec is PortraitTierSpec => spec.kind === 'tier' && !spec.phrases
    )
    // 覆盖面守卫：绝大多数档位字段靠通用表，一旦有人把表拆空要立刻发现
    expect(specs.length).toBeGreaterThan(30)
    for (const spec of specs) {
      const table = PORTRAIT_TIER_PHRASES[spec.key] ?? {}
      expect(Object.keys(table).length, `${spec.key} 在通用表里没有条目`).toBeGreaterThan(0)
      for (const [option, phrase] of Object.entries(table)) {
        expect(portraitTierPhrase(spec, option), `${spec.key}.${option}`).toBe(phrase)
      }
    }
  })

  it('off 与未知档位恒不产出片段（不会把脏值写进提示词）', () => {
    for (const spec of PORTRAIT_PARAM_SPECS) {
      if (spec.kind !== 'tier') continue
      expect(portraitTierPhrase(spec, 'off'), spec.key).toBe('')
      expect(portraitTierPhrase(spec, 'not-a-tier'), spec.key).toBe('')
    }
  })

  it('眼距这类双向档位用自有档位名（narrow = 收紧，wide = 拉开）', () => {
    const eyeSpacing = tierSpecOf('eyeSpacing')
    expect(portraitTierPhrase(eyeSpacing, 'slightNarrow')).toContain('收紧')
    expect(portraitTierPhrase(eyeSpacing, 'narrow')).toContain('收紧')
    expect(portraitTierPhrase(eyeSpacing, 'slightWide')).toContain('拉开')
    expect(portraitTierPhrase(eyeSpacing, 'wide')).toContain('拉开')
    // 双向字段不该出现通用五档名（它们的语义在这里没有定义）
    expect(eyeSpacing.tiers).not.toContain('standard')
  })
})

describe('portraitRetouch 归一化', () => {
  it('未知档位回落 off，未知枚举回落规格默认值', () => {
    const state = normalizePortraitRetouch({
      skinSmoothing: 'ultra' as never,
      skinTexture: 'max',
      lutId: 'not-a-lut' as never,
      bgMode: 'explode' as never,
      idPhotoSpecId: 'threeInch' as never,
      idPhotoBg: 'pink' as never,
      outputSize: '8K' as never
    })
    expect(state.skinSmoothing).toBe('off')
    expect(state.skinTexture).toBe('max')
    expect(state.lutId).toBe('none')
    expect(state.bgMode).toBe('keep')
    expect(state.idPhotoSpecId).toBe('none')
    expect(state.idPhotoBg).toBe('white')
    expect(state.outputSize).toBe('2K')
  })

  it('色温 / 眼距的取值域与自己的片段表键一一对应（不再有域与类型错位）', () => {
    // 曾经 spec.tiers 是通用 BI_TIERS，而 PortraitWarmthTier / PortraitSpacingTier 声明的是
    // 'warm' / 'cool' / 'wide' 这类名字 —— 类型合法的值会被归一化悄悄抹成 off，
    // hongkong 预设的 colorTemp: 'warm' 就是这样失效的。
    const state = normalizePortraitRetouch({
      skinToneWarmth: 'warm',
      colorTemp: 'cool',
      lightTemp: 'warmStrong'
    })
    expect(state.skinToneWarmth).toBe('warm')
    expect(state.colorTemp).toBe('cool')
    expect(state.lightTemp).toBe('warmStrong')
    expect(tierSpecOf('colorTemp').tiers).toEqual([
      'off',
      'cool',
      'coolLight',
      'warm',
      'warmStrong'
    ])
    // 通用五档名在这些字段上不再合法（它们的语义与冷暖无关）
    expect(normalizePortraitRetouch({ colorTemp: 'strong' as never }).colorTemp).toBe('off')
    expect(normalizePortraitRetouch({ eyeSpacing: 'wide' }).eyeSpacing).toBe('wide')
    expect(tierSpecOf('eyeSpacing').tiers).toEqual([
      'off',
      'narrow',
      'slightNarrow',
      'slightWide',
      'wide'
    ])
  })

  it('颜色只接受 6 位十六进制，其余回落默认', () => {
    const dirty = normalizePortraitRetouch({
      bgColor: 'red' as never,
      bgColorTo: '#abc' as never
    })
    expect(dirty.bgColor).toBe('#ffffff')
    expect(dirty.bgColorTo).toBe('#dbeafe')

    const ok = normalizePortraitRetouch({ bgColor: '#438EDB', bgColorTo: '#000000' })
    expect(ok.bgColor).toBe('#438EDB')
    expect(ok.bgColorTo).toBe('#000000')
  })

  it('数字夹取到 [min,max] 并按 step 取整，脏值回落默认', () => {
    const clamped = normalizePortraitRetouch({ exportDpi: 40 })
    expect(clamped.exportDpi).toBe(72) // 低于下限

    const fallback = normalizePortraitRetouch({ exportDpi: Number.NaN })
    expect(fallback.exportDpi).toBe(300)
  })

  it('布尔只接受真布尔，其余回落默认', () => {
    expect(normalizePortraitRetouch({ idPhotoSheet: 'yes' as never }).idPhotoSheet).toBe(false)
    expect(normalizePortraitRetouch({ idPhotoSheet: 1 as never }).idPhotoSheet).toBe(false)
    expect(normalizePortraitRetouch({ idPhotoSheet: true }).idPhotoSheet).toBe(true)
  })

  it('文本按 maxLength 截断，非字符串回落空串', () => {
    const state = normalizePortraitRetouch({
      bgPrompt: 'b'.repeat(500),
      extraNote: 42 as never
    })
    expect(state.bgPrompt).toHaveLength(300)
    expect(state.extraNote).toBe('')
    expect(normalizePortraitRetouch({ extraNote: 'm'.repeat(500) }).extraNote).toHaveLength(400)
  })

  it('缺失字段全部补齐，空输入等于默认状态', () => {
    expect(normalizePortraitRetouch()).toEqual(defaultPortraitRetouch())
    expect(normalizePortraitRetouch({})).toEqual(defaultPortraitRetouch())
    expect(normalizePortraitRetouch(null)).toEqual(defaultPortraitRetouch())
    expect(normalizePortraitRetouch({ skinSmoothing: 'light' })).toEqual({
      ...defaultPortraitRetouch(),
      skinSmoothing: 'light'
    })
  })

  it('未知键被丢弃（旧字段不会留在新状态里）', () => {
    const state = normalizePortraitRetouch({
      foreheadHeight: 30,
      exposure: 12
    } as never)
    expect(rawState(state)).not.toHaveProperty('foreheadHeight')
    expect(rawState(state)).not.toHaveProperty('exposure')
  })

  it('没有 v 标记的旧数值滑块不会走迁移，直接按档位归一化（回落 off）', () => {
    const state = normalizePortraitRetouch({ skinSmoothing: 80, faceSlim: 70 } as never)
    expect(state.skinSmoothing).toBe('off')
    expect(state.faceSlim).toBe('off')
    expect(state.v).toBe(PORTRAIT_RETOUCH_VERSION)
  })

  it('未来版本号只把 v 归一到 2，已知字段仍按常规归一化', () => {
    const state = normalizePortraitRetouch({
      v: 99,
      skinSmoothing: 'strong',
      lutId: 'bogus' as never
    })
    expect(state.v).toBe(PORTRAIT_RETOUCH_VERSION)
    expect(state.skinSmoothing).toBe('strong')
    expect(state.lutId).toBe('none')
  })

  it('读节点参数与写回 patch 走同一条归一化', () => {
    const fromNode = readPortraitRetouchFromNode({
      portraitRetouch: { skinSmoothing: 'strong', bgMode: 'color', bgColor: 'nope' as never }
    })
    expect(fromNode.skinSmoothing).toBe('strong')
    expect(fromNode.bgMode).toBe('color')
    expect(fromNode.bgColor).toBe('#ffffff')
    expect(readPortraitRetouchFromNode({})).toEqual(defaultPortraitRetouch())

    const patch = portraitRetouchToNodePatch({
      ...defaultPortraitRetouch(),
      lutId: 'bogus' as never
    })
    expect(patch.portraitRetouch.lutId).toBe('none')
    expect(patch.portraitRetouch.v).toBe(PORTRAIT_RETOUCH_VERSION)
  })

  it('归一化幂等：已经在 v2 域内的状态再归一化不变', () => {
    const once = normalizePortraitRetouch({
      skinSmoothing: 'strong',
      makeupStyle: 'bride',
      bgMode: 'gradient',
      bgColor: '#112233',
      exportMaxEdge: 100,
      manualRegions: [
        { id: 'r1', kind: 'erase', box: { x: 0.2, y: 0.2, w: 0.3, h: 0.3 }, note: '' }
      ]
    })
    expect(normalizePortraitRetouch(once)).toEqual(once)
  })
})

describe('portraitRetouch v1 → v2 迁移', () => {
  /** 旧工程的形态：v: 1 + 0..100（可负）的数值滑块 */
  const V1_PAYLOAD = {
    v: 1,
    skinSmoothing: 80,
    blemishRemoval: 50,
    darkCircle: 60,
    skinPore: 90,
    faceSlim: 70,
    colorTemp: 60,
    eyeSpacing: -60,
    saturation: 70,
    tint: -70,
    makeupPresetId: 'bride',
    lutId: 'kodak',
    bgMode: 'color',
    bgColor: '#438edb',
    idPhotoSpecId: 'oneInch'
  }

  it('数值滑块折算成档位，枚举 / 颜色 / 背景原样搬过来', () => {
    const state = normalizePortraitRetouch(V1_PAYLOAD as never)
    expect(state.v).toBe(PORTRAIT_RETOUCH_VERSION)
    expect(state.skinSmoothing).toBe('strong') // 80 ≥ 60
    expect(state.blemishRemoval).toBe('strong') // 50 ≥ 45
    expect(state.underEye).toBe('strong') // darkCircle 60 ≥ 55
    expect(state.skinTexture).toBe('max') // skinPore 90 ≥ 80
    expect(state.faceSlim).toBe('strong') // 70 ≥ 55
    expect(state.wrinkles).toBe('off') // 没给抬头纹 / 法令纹 / 颈纹
    expect(state.makeupStyle).toBe('bride')
    expect(state.lutId).toBe('kodak')
    expect(state.bgMode).toBe('color')
    expect(state.bgColor).toBe('#438edb')
    expect(state.idPhotoSpecId).toBe('oneInch')
  })

  it('多档阶梯：同一字段被多个旧滑块喂时取更强的一档', () => {
    const state = normalizePortraitRetouch({ v: 1, nasolabial: 30, foreheadLines: 60 } as never)
    expect(state.wrinkles).toBe('strong')
    expect(normalizePortraitRetouch({ v: 1, nasolabial: 30 } as never).wrinkles).toBe('standard')
    expect(normalizePortraitRetouch({ v: 1, nasolabial: 0 } as never).wrinkles).toBe('off')
  })

  it('v1 妆面饱和度 > 50 折算为 rosy 妆色', () => {
    expect(normalizePortraitRetouch({ v: 1, makeupSaturation: 80 } as never).makeupTone).toBe(
      'rosy'
    )
    expect(normalizePortraitRetouch({ v: 1, makeupSaturation: 20 } as never).makeupTone).toBe('off')
  })

  it('v1 里没有对应档位的项被丢弃（不硬凑近义档位）', () => {
    expect(
      normalizePortraitRetouch({ v: 1, foreheadHeight: 40, headBodyRatio: 30, hslHue: 10 } as never)
    ).toEqual(defaultPortraitRetouch())
  })

  it('迁移幂等：迁移结果再归一化得到同一个状态', () => {
    const once = normalizePortraitRetouch(V1_PAYLOAD as never)
    expect(normalizePortraitRetouch(once)).toEqual(once)
    expect(normalizePortraitRetouch(normalizePortraitRetouch(once))).toEqual(once)
  })

  /**
   * 回归用例：`strongerTier` 曾经只在标准五档 TIER_ORDER 里比较，而色温 / 眼距 /
   * 饱和度 / 色调的档位名是自带阶梯（`warmStrong` / `wide` / `boostVivid` / `magenta`），
   * `indexOf` 得到 -1（比 `off` 的 0 还小），于是整项被丢掉 —— 老工程一开就丢参数。
   */
  it('v1 的非标准档位（色温 / 眼距 / 饱和度 / 色调 / 光比）都能带着方向迁移过来', () => {
    const state = normalizePortraitRetouch(V1_PAYLOAD as never)
    expect(state.colorTemp).toBe('warmStrong')
    expect(state.eyeSpacing).toBe('wide')
    expect(state.saturation).toBe('boostVivid')
    expect(state.colorTint).toBe('magenta')
    // 同一批映射里其余非标准档位字段（fixture 没给值，单独构造）
    expect(normalizePortraitRetouch({ v: 1, lightTemp: 60 } as never).lightTemp).toBe('warmStrong')
    expect(normalizePortraitRetouch({ v: 1, lightRatio: 80 } as never).lightRatio).toBe('hard')
    expect(normalizePortraitRetouch({ v: 1, skinTone: 60 } as never).skinToneWarmth).toBe(
      'warmStrong'
    )
    // 反向也要有方向性，不能两边都给同一档
    expect(normalizePortraitRetouch({ v: 1, colorTemp: -60 } as never).colorTemp).toBe('cool')
    expect(normalizePortraitRetouch({ v: 1, eyeSpacing: 60 } as never).eyeSpacing).toBe('narrow')
  })

  it('v1 迁移逐项校验取值域：越域的枚举回落默认，不产出非法状态', () => {
    const state = normalizePortraitRetouch({
      v: 1,
      idPhotoSpecId: 'threeInch',
      idPhotoBg: 'pink'
    } as never)
    expect(state.idPhotoSpecId).toBe('none')
    expect(state.idPhotoBg).toBe('white')
    expect(normalizePortraitRetouch({ v: 1, makeupPresetId: 'bogus' } as never).makeupStyle).toBe(
      'none'
    )
    expect(normalizePortraitRetouch({ v: 1, lutId: 'bogus' } as never).lutId).toBe('none')
  })

  it('v1 背景模式只认 color / gradient，其余回落 keep', () => {
    expect(normalizePortraitRetouch({ v: 1, bgMode: 'blur' } as never).bgMode).toBe('keep')
    expect(normalizePortraitRetouch({ v: 1, bgMode: 'gradient' } as never).bgMode).toBe('gradient')
  })
})

describe('portraitRetouch 手动区域', () => {
  it('未知 kind 直接丢弃（返回 null），数组里的脏项被跳过', () => {
    expect(normalizePortraitManualRegion(null)).toBeNull()
    expect(normalizePortraitManualRegion(undefined)).toBeNull()
    expect(normalizePortraitManualRegion({ kind: 'bogus' as never })).toBeNull()
    expect(normalizePortraitManualRegion({} as never)).toBeNull()
    expect(
      normalizePortraitManualRegions([{ kind: 'bogus' as never }, null, { kind: 'erase' }])
    ).toHaveLength(1)
    expect(normalizePortraitManualRegions(null)).toEqual([])
    expect(normalizePortraitManualRegions('x' as never)).toEqual([])
  })

  it('超出画面的框被夹回 0..1，缺 id 时补一个随机 id', () => {
    const overflow = region({ kind: 'slim', box: { x: 0.9, y: -0.5, w: 0.6, h: 0.2 } })
    expect(overflow.box?.x).toBe(0.9)
    expect(overflow.box?.y).toBe(0)
    // 右边界按 1 - x 收窄，实现不做小数清理（实测 0.09999999999999998）
    expect(overflow.box?.w).toBeCloseTo(0.1, 6)
    expect(overflow.box?.h).toBe(0.2)
    const generated = normalizePortraitManualRegion({ kind: 'skin', box: null })
    expect(generated?.id).toMatch(/^region-/)

    const negative = region({ kind: 'skin', box: { x: -0.2, y: 0.3, w: 0.5, h: 0.4 } })
    expect(negative.box).toEqual({ x: 0, y: 0.3, w: 0.5, h: 0.4 })
    expect(negative.id).toBe('r1')
  })

  it('框的裁剪结果原样保留浮点尾巴（不四舍五入，只做 0..1 夹取）', () => {
    const box = region({ kind: 'slim', box: { x: 0.3, y: 0.1, w: 5, h: 5 } }).box
    expect(box).toEqual({ x: 0.3, y: 0.1, w: 1 - 0.3, h: 1 - 0.1 })
  })

  it('退化框降级为「整图」（box: null）而不是把区域整条丢掉', () => {
    expect(region({ kind: 'erase', box: { x: 0.2, y: 0.2, w: 0, h: 0.5 } }).box).toBeNull()
    expect(region({ kind: 'erase', box: { x: 0.2, y: 0.2, w: 0.0005, h: 0.5 } }).box).toBeNull()
    expect(region({ kind: 'erase', box: { x: Number.NaN, y: 0, w: 0.5, h: 0.5 } }).box).toBeNull()
    expect(normalizePortraitManualRegion({ kind: 'erase' })?.box).toBeNull()
  })

  it('note 截断到 200 字', () => {
    expect(
      normalizePortraitManualRegion({ kind: 'skin', note: 'n'.repeat(300) })?.note
    ).toHaveLength(200)
    expect(normalizePortraitManualRegion({ kind: 'skin', note: 5 as never })?.note).toBe('')
  })

  it('区域总量截断到 PORTRAIT_MANUAL_REGION_LIMIT', () => {
    const many = Array.from({ length: PORTRAIT_MANUAL_REGION_LIMIT + 10 }, (_, index) => ({
      id: `r${index}`,
      kind: 'skin' as const
    }))
    const out = normalizePortraitManualRegions(many)
    expect(out).toHaveLength(PORTRAIT_MANUAL_REGION_LIMIT)
    expect(out[0].id).toBe('r0')
    expect(out[out.length - 1].id).toBe(`r${PORTRAIT_MANUAL_REGION_LIMIT - 1}`)
  })

  it('框 → 九宫格方位短语（模型读方位比读坐标准）', () => {
    expect(portraitRegionWhere(null)).toBe('整张画面')
    expect(portraitRegionWhere({ x: 0.05, y: 0.05, w: 0.1, h: 0.1 })).toBe('画面上方左侧的小块')
    expect(portraitRegionWhere({ x: 0.4, y: 0.4, w: 0.2, h: 0.2 })).toBe('画面中间中部的一块')
    expect(portraitRegionWhere({ x: 0.6, y: 0.6, w: 0.35, h: 0.35 })).toBe('画面下方右侧的大片')
  })

  it('normalizePortraitRetouch 也归一化 manualRegions', () => {
    const state = normalizePortraitRetouch({
      manualRegions: [
        { kind: 'bogus' as never },
        { id: 'keep', kind: 'whiten', box: { x: 0.5, y: 0.5, w: 0.9, h: 0.9 } }
      ] as never
    })
    expect(state.manualRegions).toHaveLength(1)
    expect(state.manualRegions[0]).toEqual({
      id: 'keep',
      kind: 'whiten',
      box: { x: 0.5, y: 0.5, w: 0.5, h: 0.5 },
      note: ''
    })
  })
})

describe('portraitRetouch 依赖门禁', () => {
  it('portraitGroupEnabled 只看该组声明的 needs', () => {
    const heal = PORTRAIT_TOOL_GROUPS.find((group) => group.id === 'heal')!
    const color = PORTRAIT_TOOL_GROUPS.find((group) => group.id === 'color')!
    const background = PORTRAIT_TOOL_GROUPS.find((group) => group.id === 'background')!
    expect(portraitGroupEnabled(heal, { face: true, mask: false, pose: false })).toBe(true)
    expect(portraitGroupEnabled(heal, NO_NEEDS)).toBe(false)
    expect(portraitGroupEnabled(color, NO_NEEDS)).toBe(true)
    expect(portraitGroupEnabled(background, { face: true, mask: false, pose: true })).toBe(false)
  })
})

describe('portraitRetouch 提示词合成', () => {
  it('全默认：没有要发的正向提示词，也没有负面提示，没有生效的组', () => {
    const prompt = buildPortraitPrompt({
      state: defaultPortraitRetouch(),
      needs: ALL_NEEDS,
      idPhoto: null
    })
    expect(prompt.main).toBe('')
    expect(prompt.negative).toBe('')
    expect(prompt.appliedGroups).toEqual([])
    expect(prompt.skippedGroups).toEqual([])
  })

  it('设了档位的组进 appliedGroups，缺依赖的组进 skippedGroups 且不产出句子', () => {
    const state: PortraitRetouchState = {
      ...defaultPortraitRetouch(),
      skinSmoothing: 'standard',
      faceSlim: 'standard',
      waistSlim: 'standard',
      makeupStyle: 'bride'
    }
    const prompt = buildPortraitPrompt({
      state,
      needs: { face: true, mask: true, pose: false },
      idPhoto: null
    })
    expect(prompt.appliedGroups).toEqual(['skin', 'face', 'makeup'])
    expect(prompt.skippedGroups).toEqual(['body'])
    expect(prompt.main).toContain('适度磨皮')
    expect(prompt.main).toContain('瘦脸')
    expect(prompt.main).toContain('新娘妆')
    expect(prompt.main).not.toContain(portraitTierPhrase(tierSpecOf('waistSlim'), 'standard'))
  })

  it('依赖全缺时：需要人脸 / 姿态的组全部跳过，正向提示词为空', () => {
    const state: PortraitRetouchState = {
      ...defaultPortraitRetouch(),
      skinSmoothing: 'strong',
      faceSlim: 'strong',
      waistSlim: 'strong'
    }
    const prompt = buildPortraitPrompt({ state, needs: NO_NEEDS, idPhoto: null })
    expect(prompt.appliedGroups).toEqual([])
    expect(prompt.main).toBe('')
    // 只报「本来想做但缺依赖」的组，不把没设置的组也算成 skipped
    expect(prompt.skippedGroups).toEqual(['skin', 'face', 'body'])
    // 负面提示按实际生效的组裁剪：没有组生效就没有负面词，
    // 执行器因此不会产出「。负面提示：…」这种只有负面词的空提示词
    expect(prompt.negative).toBe('')
  })

  it('证件照规格句排在最前，并按规格补 ID 照片负面词', () => {
    const state: PortraitRetouchState = {
      ...defaultPortraitRetouch(),
      idPhotoSpecId: 'oneInch',
      skinSmoothing: 'light'
    }
    const prompt = buildPortraitPrompt({
      state,
      needs: ALL_NEEDS,
      idPhoto: { label: '一寸', widthMm: 25, heightMm: 35, background: '白底', sheet: false }
    })
    expect(
      prompt.main.startsWith('按 一寸（25×35mm）证件照规格构图：正面免冠、双肩入画、头部居中')
    ).toBe(true)
    expect(prompt.main).toContain('证件照底色为白底')
    expect(prompt.main).toContain('轻度磨皮')
    expect(prompt.main.indexOf('证件照规格构图')).toBeLessThan(prompt.main.indexOf('轻度磨皮'))
    expect(prompt.negative).toContain('歪头')
    expect(prompt.negative).toContain('侧脸')
  })

  it('ID 照片负面词只看 idPhotoSpecId，不看传入的规格信息（实现口径不一致）', () => {
    const prompt = buildPortraitPrompt({
      state: defaultPortraitRetouch(),
      needs: ALL_NEEDS,
      idPhoto: { label: '一寸', widthMm: 25, heightMm: 35, background: '白底', sheet: false }
    })
    expect(prompt.main).toContain('证件照规格构图')
    expect(prompt.negative).toBe('')
  })

  it('背景：color / gradient 用色值，prompt 用自由描述（不需要蒙版）', () => {
    const color = buildPortraitPrompt({
      state: { ...defaultPortraitRetouch(), bgMode: 'color', bgColor: '#438edb' },
      needs: NO_NEEDS,
      idPhoto: null
    })
    expect(color.main).toContain('背景替换为纯色 #438EDB')
    expect(color.appliedGroups).toContain('background')

    const gradient = buildPortraitPrompt({
      state: { ...defaultPortraitRetouch(), bgMode: 'gradient' },
      needs: ALL_NEEDS,
      idPhoto: null
    })
    expect(gradient.main).toContain('背景替换为 #FFFFFF 到 #DBEAFE 的柔和渐变')

    const prompted = buildPortraitPrompt({
      state: { ...defaultPortraitRetouch(), bgMode: 'prompt', bgPrompt: '海边日落' },
      needs: NO_NEEDS,
      idPhoto: null
    })
    expect(prompted.main).toContain('海边日落')
    expect(prompted.appliedGroups).toContain('background')

    const blank = buildPortraitPrompt({
      state: { ...defaultPortraitRetouch(), bgMode: 'prompt' },
      needs: ALL_NEEDS,
      idPhoto: null
    })
    expect(blank.main).toBe('')
    expect(blank.appliedGroups).toEqual([])
  })

  it('背景虚化需要蒙版：缺蒙版时整组跳过', () => {
    const missingMask = buildPortraitPrompt({
      state: { ...defaultPortraitRetouch(), bgMode: 'blur', bgBlur: 'strong' },
      needs: { face: true, mask: false, pose: true },
      idPhoto: null
    })
    expect(missingMask.main).toBe('')
    expect(missingMask.skippedGroups).toContain('background')

    const ok = buildPortraitPrompt({
      state: { ...defaultPortraitRetouch(), bgMode: 'blur', bgBlur: 'strong' },
      needs: ALL_NEEDS,
      idPhoto: null
    })
    expect(ok.main).toBe('保留原背景内容但整体虚化，虚化程度由背景虚化档位决定')
    expect(ok.appliedGroups).toEqual(['background'])
  })

  it('bgBlur 档位本身进不了提示词：blur 用固定文案，档位高低对 main 没有影响（实现缺口）', () => {
    const build = (bgBlur: PortraitRetouchState['bgBlur']): string =>
      buildPortraitPrompt({
        state: { ...defaultPortraitRetouch(), bgMode: 'blur', bgBlur },
        needs: ALL_NEEDS,
        idPhoto: null
      }).main
    const light = build('light')
    expect(light).toBe(build('max'))
    expect(light).toBe(build('off'))
    expect(light).not.toContain(portraitTierPhrase(tierSpecOf('bgBlur'), 'max'))
    // 参数算「改动过」（卡片角标会 +1），但提示词一个字都不变
    expect(changedPortraitParamCount({ ...defaultPortraitRetouch(), bgBlur: 'max' })).toBe(1)
  })

  it('手动区域与补充说明进提示词，方位用自然语言', () => {
    const state = normalizePortraitRetouch({
      extraNote: '口红再红一点',
      manualRegions: [
        { id: 'a', kind: 'blemish', box: { x: 0.05, y: 0.05, w: 0.1, h: 0.1 }, note: '' },
        { id: 'b', kind: 'erase', box: null, note: '把左边路人去掉' }
      ]
    })
    const prompt = buildPortraitPrompt({ state, needs: ALL_NEEDS, idPhoto: null })
    expect(prompt.appliedGroups).toEqual(['region'])
    expect(prompt.main).toContain('仅对画面上方左侧的小块区域做瑕疵修复')
    expect(prompt.main).toContain('去除整张画面区域内的人物与杂物')
    expect(prompt.main).toContain('（把左边路人去掉）')
    expect(prompt.main).toContain('补充要求：口红再红一点')
  })
})

describe('portraitRetouch 负面提示词', () => {
  /** 负面提示词是 buildPortraitPrompt 的产物（按实际生效的组裁剪），这里取全依赖口径 */
  const negativeOf = (state: PortraitRetouchState): string =>
    buildPortraitPrompt({ state, needs: ALL_NEEDS, idPhoto: null }).negative
  it('默认状态没有负面提示词', () => {
    expect(negativeOf(defaultPortraitRetouch())).toBe('')
  })

  it('磨皮 / 柔焦只有推到 strong 以上才补「塑料感」类负面词', () => {
    expect(negativeOf({ ...defaultPortraitRetouch(), skinSmoothing: 'standard' })).toBe('')
    const strong = negativeOf({
      ...defaultPortraitRetouch(),
      skinSmoothing: 'strong'
    })
    expect(strong).toContain('过度磨皮')
    expect(strong).toContain('塑料感')
    expect(strong).toContain('毛孔完全消失')
    expect(negativeOf({ ...defaultPortraitRetouch(), softFocus: 'max' })).toContain('塑料感')
  })

  it('五官 / 身形档位推高时补身份与比例风险词', () => {
    const face = negativeOf({ ...defaultPortraitRetouch(), faceSlim: 'strong' })
    expect(face).toContain('脸型扭曲')
    expect(face).toContain('骨相改变')
    expect(face).toContain('五官变形')
    const body = negativeOf({ ...defaultPortraitRetouch(), waistSlim: 'max' })
    expect(body).toContain('身体比例失真')
    expect(body).toContain('肢体扭曲')
    expect(negativeOf({ ...defaultPortraitRetouch(), eyeSize: 'max' })).toContain('眼睛比例失真')
  })

  it('背景替换与黑白 LUT 各自追加负面词', () => {
    expect(negativeOf({ ...defaultPortraitRetouch(), bgMode: 'color' })).toContain('背景与人物割裂')
    expect(negativeOf({ ...defaultPortraitRetouch(), lutId: 'bw' })).toContain('残留彩色')
  })
})

describe('portraitRetouch 预设', () => {
  it('内置预设都有 patch，applyPortraitPreset 的结果都不是默认值', () => {
    expect(PORTRAIT_PRESETS.length).toBeGreaterThan(5)
    const ids = PORTRAIT_PRESETS.map((preset) => preset.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const preset of PORTRAIT_PRESETS) {
      expect(Object.keys(preset.patch).length, preset.id).toBeGreaterThan(0)
      expect(preset.labelKey.length, preset.id).toBeGreaterThan(0)
      const state = applyPortraitPreset(preset.id)
      expect(state, preset.id).not.toEqual(defaultPortraitRetouch())
      expect(state.presetId, preset.id).toBe(preset.id)
    }
  })

  it('每个预设的 patch 都能原样通过归一化（写错档位名会在这里暴露）', () => {
    const lost: string[] = []
    for (const preset of PORTRAIT_PRESETS) {
      const state = rawState(applyPortraitPreset(preset.id))
      for (const [key, value] of Object.entries(preset.patch)) {
        if (state[key] !== value) lost.push(`${preset.id}.${key}`)
      }
    }
    // 每个预设的每一项都必须活下来：写错档位名（或在错误的取值域里写值）会在这里暴露
    expect(lost).toEqual([])
  })

  it('hongkong 预设的暖色调完整生效', () => {
    const patch = PORTRAIT_PRESETS.find((preset) => preset.id === 'hongkong')!.patch
    expect(patch.colorTemp).toBe('warm')
    expect(applyPortraitPreset('hongkong').colorTemp).toBe('warm')
  })

  it('未知预设 id 退化为默认值，不留 presetId', () => {
    expect(applyPortraitPreset('nope')).toEqual(defaultPortraitRetouch())
  })

  it('预设导出可原样导入（含手动区域与自由文本）', () => {
    const state = normalizePortraitRetouch({
      skinSmoothing: 'strong',
      extraNote: '口红偏正红',
      bgMode: 'prompt',
      bgPrompt: '纯白影棚',
      manualRegions: [
        { id: 'r1', kind: 'erase', box: { x: 0.6, y: 0.6, w: 0.3, h: 0.3 }, note: '去掉路人' }
      ]
    })
    const parsed = importPortraitPreset(exportPortraitPreset('我的配方', state))
    if (!parsed.ok) throw new Error(`预设应当可导入：${parsed.reason}`)
    expect(parsed.name).toBe('我的配方')
    expect(parsed.state).toEqual(state)
    expect(parsed.state.manualRegions).toHaveLength(1)
    expect(parsed.state.manualRegions[0].note).toBe('去掉路人')
    expect(parsed.state.bgPrompt).toBe('纯白影棚')
  })

  it('导出时名字为空回落到 preset', () => {
    const parsed = importPortraitPreset(exportPortraitPreset('   ', defaultPortraitRetouch()))
    if (!parsed.ok) throw new Error('预设应当可导入')
    expect(parsed.name).toBe('preset')
  })

  it('预设导入区分「不是 JSON」「不是本应用预设」「版本过新」', () => {
    expect(importPortraitPreset('{oops')).toEqual({ ok: false, reason: 'invalid-json' })
    expect(importPortraitPreset('5')).toEqual({ ok: false, reason: 'invalid-json' })
    expect(importPortraitPreset(JSON.stringify({ kind: 'other', v: 2 }))).toEqual({
      ok: false,
      reason: 'not-preset'
    })
    expect(
      importPortraitPreset(
        JSON.stringify({
          kind: 'portrait-preset',
          v: PORTRAIT_RETOUCH_VERSION + 1,
          name: 'x',
          state: {}
        })
      )
    ).toEqual({ ok: false, reason: 'version' })
  })

  it('v1 导出的旧预设文件也能导入（走迁移）', () => {
    const legacy = importPortraitPreset(
      JSON.stringify({
        kind: 'portrait-preset',
        v: 1,
        name: '旧预设',
        state: { v: 1, skinSmoothing: 80, makeupPresetId: 'bride' }
      })
    )
    if (!legacy.ok) throw new Error(`旧预设应当可导入：${legacy.reason}`)
    expect(legacy.state.skinSmoothing).toBe('strong')
    expect(legacy.state.makeupStyle).toBe('bride')
    expect(legacy.state.v).toBe(PORTRAIT_RETOUCH_VERSION)
  })
})

describe('portraitRetouch 统计与风险提示', () => {
  it('isPortraitParamChanged 相对规格默认值判断', () => {
    const state = defaultPortraitRetouch()
    for (const spec of PORTRAIT_PARAM_SPECS) {
      expect(isPortraitParamChanged(state, spec), spec.key).toBe(false)
    }
    const spec = tierSpecOf('skinSmoothing')
    expect(isPortraitParamChanged({ ...state, skinSmoothing: 'light' }, spec)).toBe(true)
    expect(isPortraitParamChanged({ ...state, skinSmoothing: 'off' }, spec)).toBe(false)
  })

  it('changedPortraitParamCount = 改动过的规格数 + 手动区域数（presetId 不算改动）', () => {
    expect(changedPortraitParamCount(defaultPortraitRetouch())).toBe(0)
    const state = normalizePortraitRetouch({
      skinSmoothing: 'strong',
      lutId: 'kodak',
      bgColor: '#000000',
      exportDpi: 200,
      presetId: 'bride',
      manualRegions: [
        { id: 'a', kind: 'skin', box: null, note: '' },
        { id: 'b', kind: 'erase', box: { x: 0.1, y: 0.1, w: 0.1, h: 0.1 }, note: '' }
      ]
    })
    expect(state.presetId).toBe('bride')
    expect(changedPortraitParamCount(state)).toBe(6) // 4 个规格 + 2 个区域
    expect(changedPortraitParamCount(normalizePortraitRetouch({ extraNote: '补一点腮红' }))).toBe(1)
    expect(
      changedPortraitParamCount(
        normalizePortraitRetouch({ manualRegions: [{ kind: 'skin' }] } as never)
      )
    ).toBe(1)
    // 脏值先归一化再统计：非法档位不算「改动过」
    expect(changedPortraitParamCount({ ...state, faceSlim: 'bogus' as never })).toBe(6)
  })

  it('高风险档位计数与键名（UI 二次确认用）', () => {
    expect(portraitHighRiskTierCount(defaultPortraitRetouch())).toBe(0)
    const state: PortraitRetouchState = {
      ...defaultPortraitRetouch(),
      skinSmoothing: 'max',
      faceSlim: 'strong',
      eyeSize: 'standard'
    }
    expect(portraitHighRiskTierCount(state)).toBe(2)
    expect(portraitIdentityRiskKeys(state).sort()).toEqual(['faceSlim', 'skinSmoothing'])
    // 双向档位（眼距）用 wide / narrow 表达方向，没有「强」的语义，
    // 因此不该被算作身份保真高风险
    expect(portraitIdentityRiskKeys({ ...defaultPortraitRetouch(), eyeSpacing: 'wide' })).toEqual(
      []
    )
    expect(
      portraitIdentityRiskKeys({
        ...defaultPortraitRetouch(),
        lightRatio: 'natural'
      } as PortraitRetouchState)
    ).toEqual([])
  })
})

describe('portraitRetouch 编辑器 AI 版本栈', () => {
  it('丢弃没有落盘路径的条目，补齐 id / at，保留最近 N 条', () => {
    const layers = normalizePortraitAiLayers([
      null,
      { tool: 'erase', prompt: 'x' },
      { tool: 'erase', relativePath: 'a.png' },
      {
        id: 'keep',
        tool: 'expand',
        relativePath: 'b.png',
        assetId: 'asset-1',
        at: '2024-01-01T00:00:00.000Z'
      }
    ])
    expect(layers).toHaveLength(2)
    expect(layers[0].id).toBe('layer-1')
    expect(layers[0].at.length).toBeGreaterThan(0)
    expect('assetId' in layers[0]).toBe(false)
    expect(layers[1]).toEqual({
      id: 'keep',
      tool: 'expand',
      prompt: '',
      model: '',
      providerInstanceId: '',
      relativePath: 'b.png',
      assetId: 'asset-1',
      at: '2024-01-01T00:00:00.000Z'
    })

    const many = Array.from({ length: PORTRAIT_AI_LAYER_LIMIT + 5 }, (_, index) => ({
      id: `l${index}`,
      relativePath: `p${index}.png`
    }))
    const capped = normalizePortraitAiLayers(many)
    expect(capped).toHaveLength(PORTRAIT_AI_LAYER_LIMIT)
    expect(capped[capped.length - 1].id).toBe(`l${PORTRAIT_AI_LAYER_LIMIT + 4}`)
    expect(normalizePortraitAiLayers(null)).toEqual([])
  })

  it('buildPortraitAiPrompt：基础约束 + 用户补充', () => {
    const base = buildPortraitAiPrompt('skinTexture')
    expect(base).toContain('不做塑料感磨皮')
    expect(buildPortraitAiPrompt('erase', '  把左边路人去掉  ')).toBe(
      `${buildPortraitAiPrompt('erase')}。把左边路人去掉`
    )
    expect(buildPortraitAiPrompt('erase', '   ')).toBe(buildPortraitAiPrompt('erase'))
  })
})
