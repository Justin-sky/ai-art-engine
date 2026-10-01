import { describe, expect, it } from 'vitest'
import {
  buildInstructionFinalPromptPreview,
  resolveInstructionFinalPreviewKind
} from '../src/shared/graph/execute/context'
import { listInstructionPresets } from '../src/shared/graph/instructionPresets'
import zh from '../src/renderer/src/i18n/locales/zh-CN'
import en from '../src/renderer/src/i18n/locales/en-US'

/**
 * 「策划案生成」（asset.gameSystem）节点的指令窗口预览契约。
 *
 * 曾经的缺陷：InstructionFinalPreviewKind 里没有 gameSystem，而 asset.gameSystem 的
 * assetType 谁都不匹配，于是 resolveInstructionFinalPreviewKind 兜底成 'screenplay' ——
 * 策划案节点的指令窗口显示的是**剧本**的系统提示词与用户提示词（「只输出纯文本 /
 * 第一行必须是剧本名」），用户看到的就是「指令预设不对」。
 *
 * 这里钉住两件事：种类解析必须给出 gameSystem；预览内容必须是策划案规范而不是剧本规范。
 */

const gameSystemNode = { typeId: 'asset.gameSystem', assetType: 'gameSystem' as const }
const screenplayNode = { typeId: 'asset.screenplay', assetType: 'screenplay' as const }

/** 策划案系统提示词独有的结构标题 */
const GAME_SYSTEM_MARK = '# 功能点设计'
/** 剧本系统提示词独有的输出格式约束 */
const SCREENPLAY_MARK = '第一行必须是剧本名'
/** 策划案默认用户提示词独有措辞 */
const GAME_SYSTEM_USER_MARK = '可直接交付开发的游戏系统策划案'
/** 剧本默认用户提示词独有措辞 */
const SCREENPLAY_USER_MARK = '第一行写「剧本名：…」'

function preview(node: { typeId: string; assetType: string }, instruction: string): string {
  return buildInstructionFinalPromptPreview({
    kind: resolveInstructionFinalPreviewKind(node, null),
    instructionRaw: instruction,
    sources: [],
    locale: 'zh-CN'
  })
}

describe('指令窗口最终提示词预览：策划案生成', () => {
  it('asset.gameSystem 解析为 gameSystem，不再兜底成 screenplay', () => {
    expect(resolveInstructionFinalPreviewKind(gameSystemNode, null)).toBe('gameSystem')
    // 剧本节点保持原样，别被这次改动波及
    expect(resolveInstructionFinalPreviewKind(screenplayNode, null)).toBe('screenplay')
  })

  it('指令为空时预览用策划案规范，不出现剧本规范', () => {
    const text = preview(gameSystemNode, '')
    expect(text).toContain(GAME_SYSTEM_MARK)
    expect(text).toContain(GAME_SYSTEM_USER_MARK)
    expect(text).not.toContain(SCREENPLAY_MARK)
    expect(text).not.toContain(SCREENPLAY_USER_MARK)
  })

  it('填了指令时：用户提示词只用指令，不回落默认模板；系统提示词照常展示', () => {
    const text = preview(gameSystemNode, '做一个背包系统')
    expect(text).toContain('做一个背包系统')
    // 系统提示词是最终提示的组成部分，必须保留
    expect(text).toContain(GAME_SYSTEM_MARK)
    // 但默认「用户」提示词不得顶替用户填的指令（与 executeGameSystemGenerateNode 同口径）
    expect(text).not.toContain(GAME_SYSTEM_USER_MARK)
    expect(text).not.toContain(SCREENPLAY_MARK)
    expect(text).not.toContain(SCREENPLAY_USER_MARK)
  })

  it('对照：剧本节点仍然走剧本规范', () => {
    const text = preview(screenplayNode, '')
    expect(text).toContain(SCREENPLAY_MARK)
    expect(text).not.toContain(GAME_SYSTEM_MARK)
  })
})

/**
 * 预设本体契约。
 *
 * 这套预设的定位是「喂给下游 UI 拆分层」：策划案必须写清有哪些界面、每屏什么控件，
 * 否则「UI 界面拆分」拆不出可出图的提示词。所以这里钉住两件事：
 * 每条预设都要能在两种语言里取到标题（否则界面上会露出原始 key），
 * 且正文必须包含界面清单要求。
 */
describe('策划案预设：面向 UI 出图的契约', () => {
  const presets = listInstructionPresets('gameSystem')

  function resolveTitle(dict: unknown, key: string): unknown {
    return key
      .split('.')
      .reduce<unknown>((acc, part) => (acc as Record<string, unknown> | undefined)?.[part], dict)
  }

  /**
   * 「对齐检查」是对既有策划案的收尾动作，不是出图模板，天然不含界面清单与配色约束；
   * 其余每条都必须满足出图契约。
   */
  const generatingPresets = presets.filter((p) => p.id !== 'gameSystem.align')

  it('预设数量与必备项：覆盖背包 / 主界面 / 升级 / 商城 / 充值五个典型系统', () => {
    const ids = presets.map((p) => p.id)
    expect(ids).toContain('gameSystem.inventory')
    expect(ids).toContain('gameSystem.mainUi')
    expect(ids).toContain('gameSystem.levelUp')
    expect(ids).toContain('gameSystem.shop')
    expect(ids).toContain('gameSystem.recharge')
    expect(presets.length).toBeGreaterThanOrEqual(7)
  })

  it('每条预设的 titleKey 在中英两种语言里都能取到标题', () => {
    for (const preset of presets) {
      const zhTitle = resolveTitle(zh, preset.titleKey)
      const enTitle = resolveTitle(en, preset.titleKey)
      expect(typeof zhTitle, `${preset.id} 缺中文标题`).toBe('string')
      expect(typeof enTitle, `${preset.id} 缺英文标题`).toBe('string')
      expect(String(zhTitle).trim().length).toBeGreaterThan(0)
      expect(String(enTitle).trim().length).toBeGreaterThan(0)
    }
  })

  it('生成型预设正文都要求写「界面清单」，这是下游拆图的输入', () => {
    for (const preset of generatingPresets) {
      expect(preset.body, `${preset.id} 未要求界面清单`).toContain('界面清单')
      expect(preset.body.trim().length).toBeGreaterThan(100)
    }
  })

  it('生成型预设都禁止指定配色（视觉统一由风格参考图决定）', () => {
    for (const preset of generatingPresets) {
      expect(preset.body, `${preset.id} 未约束配色`).toContain('不要指定颜色')
    }
  })
})
