import { describe, expect, it } from 'vitest'
import { createI18n } from 'vue-i18n'
import zhCN from '../src/renderer/src/i18n/locales/zh-CN'
import enUS from '../src/renderer/src/i18n/locales/en-US'
import { BUILTIN_NODE_TYPES } from '../src/shared/graph/builtins'
import { GRAPH_PORT_DATA_TYPES } from '../src/shared/graph'

describe('graph processing menu labels', () => {
  const i18n = createI18n({
    legacy: false,
    locale: 'zh-CN',
    messages: { 'zh-CN': zhCN }
  })

  it('resolves graph.types.asset.* menu labels with generation suffix', () => {
    const t = i18n.global.t
    expect(t('graph.types.asset.image')).toBe('图片生成')
    expect(t('graph.types.asset.video')).toBe('视频生成')
    expect(t('graph.types.asset.voice')).toBe('声音生成')
    expect(t('graph.types.asset.screenplay')).toBe('剧本生成')
    expect(t('graph.types.asset.motion')).toBe('3D导演台')
    expect(t('graph.types.world.extract')).toBe('世界元素提取')
    expect(t('graph.types.world.table')).toBe('世界元素审核')
    expect(t('graph.types.world.gen')).toBe('世界元素生成')
    expect(t('graph.inspector.generate.presets.image.multiAngle9')).toBe('多机位九宫格')
    expect(t('graph.inspector.generate.presets.image.story25')).toBe('25宫格连贯分镜')
    expect(t('graph.inspector.generate.presets.titleImage')).toBe('图片生成模板')
    expect(t('graph.types.image.select')).toBe('选取图片')
    expect(t('graph.types.video.select')).toBe('选取视频')
    expect(t('graph.types.semantic.analyze')).toBe('语义分析')
    // 「视频语义」组内统一用「语义」前缀（typeId 仍是 semantic.repair / semantic.variant）
    expect(t('graph.types.semantic.repair')).toBe('语义修复')
    expect(t('graph.types.semantic.variant')).toBe('语义变体')
    expect(t('graph.types.semantic.timeline')).toBe('语义时间线')
    expect(t('graph.types.semantic.trigger')).toBe('语义触发')
    expect(t('graph.types.semantic.compile')).toBe('语义编译')
    expect(t('graph.types.voice.select')).toBe('选取声音')
    expect(t('graph.types.image.toPrompt')).toBe('图片反推提示词')
    expect(t('graph.types.prompt.optimize')).toBe('提示词优化')
    expect(t('graph.types.output.director')).toBe('导演台输出')
    expect(t('graph.types.output.timeline')).toBe('成片时间线')
    expect(t('graph.titles.timelineOutput')).toBe('成片时间线')
    expect(t('graph.types.output.beat')).toBe('场输出')
    expect(t('graph.types.output.world')).toBe('世界元素实体输出')
    expect(t('graph.titles.worldOutput')).toBe('世界元素实体输出')
    expect(t('graph.types.beat.select')).toBe('选择场')
  })

  it('resolves persisted English enum ids to localized labels', () => {
    const t = i18n.global.t
    // 审核状态规范 id（review.unreviewed / review.reviewed）
    expect(t('review.unreviewed')).toBe('未审核')
    expect(t('review.reviewed')).toBe('已审核')
    // 世界元素 kind 规范 id（world.kind.*）
    expect(t('world.kind.character')).toBe('角色')
    expect(t('world.kind.scene')).toBe('场景')
    expect(t('world.kind.prop')).toBe('道具')
    expect(t('world.kind.weapon')).toBe('武器')
  })

  it('resolves episode agent stock stage titles for both generations', () => {
    const t = i18n.global.t
    // 新一代：写盘英文库存标题 → i18n 键
    expect(t('graph.episodeAgent.title.beatBreakdown')).toBe('节拍拆解表')
    expect(t('graph.episodeAgent.title.grid9Storyboard')).toBe('9宫格分镜表')
    expect(t('graph.episodeAgent.title.grid4Motion')).toBe('4宫格动态分镜表')
    expect(t('graph.episodeAgent.title.motionPrompt')).toBe('动态提示词表')
    expect(t('graph.episodeAgent.title.directorReview')).toBe('导演审核')
  })

  it('resolves graph.port.types.* labels', () => {
    const t = i18n.global.t
    expect(t('graph.port.types.image')).toBe('图片')
    expect(t('graph.port.types.images')).toBe('图片组')
    expect(t('graph.port.types.voice')).toBe('声音')
    expect(t('graph.port.types.voices')).toBe('声音组')
    expect(t('graph.port.types.video')).toBe('视频')
    expect(t('graph.port.types.videos')).toBe('视频组')
    expect(t('graph.port.types.text')).toBe('文本')
    expect(t('graph.port.types.texts')).toBe('文本组')
    expect(t('graph.port.types.world')).toBe('世界元素')
    expect(t('graph.port.types.worldEntities')).toBe('世界元素实体')
    expect(t('graph.port.types.beat')).toBe('场')
    expect(t('graph.port.types.model')).toBe('模型')
    expect(t('graph.port.types.spatialWorld')).toBe('空间世界')
    expect(t('graph.port.types.project')).toBe('工程')
  })

  /**
   * 运行失败码 → 文案的映射（useGraphRunSession 的 keys 表）是**按 code 精确查表**的，
   * 少一条就在画布上把 GRAPH_XXX 这种原始码直接摆给用户看。这里锁住本次新增的那条。
   */
  it('resolves the world export failure message', () => {
    expect(i18n.global.t('graph.run.worldExportNoWorld')).toContain('world_id')
  })
})

/**
 * 端口自带的显示名（`labelKey`）优先于类型名（GraphNodeCard 的 outPortTypeLabel /
 * inPortTypeLabel 都这么取），所以**每个 labelKey 都必须两侧语言都有文案** ——
 * 漏了就会在卡片上把 `graph.port.exportedMesh` 这种原始键直接画出来。
 * 这里按内置节点定义遍历所有端口，锁住这条不变量（新增节点时自动纳入）。
 */
describe('节点端口 labelKey 文案', () => {
  const i18n = createI18n({
    legacy: false,
    locale: 'zh-CN',
    messages: { 'zh-CN': zhCN, 'en-US': enUS }
  })

  function readMessage(messages: unknown, key: string): string | null {
    let cursor: unknown = messages
    for (const part of key.split('.')) {
      if (!cursor || typeof cursor !== 'object') return null
      cursor = (cursor as Record<string, unknown>)[part]
    }
    return typeof cursor === 'string' && cursor.trim() ? cursor : null
  }

  const portLabelKeys = [
    ...new Set(
      BUILTIN_NODE_TYPES.flatMap((def) =>
        (def.ports ?? []).map((port) => port.labelKey).filter((key): key is string => Boolean(key))
      )
    )
  ].sort()

  it('内置节点至少有一批 labelKey（防止遍历失效后空跑通过）', () => {
    expect(portLabelKeys.length).toBeGreaterThan(5)
    expect(portLabelKeys).toContain('graph.port.exportedMesh')
  })

  it('每个 labelKey 中英文案都齐（缺哪个就用原始键显示）', () => {
    const missing: string[] = []
    for (const key of portLabelKeys) {
      if (!readMessage(zhCN, key)) missing.push(`zh:${key}`)
      if (!readMessage(enUS, key)) missing.push(`en:${key}`)
      // vue-i18n 在缺键时返回键本身：解析成功也不该等于键
      if (i18n.global.t(key) === key) missing.push(`resolve:${key}`)
    }
    expect(missing).toEqual([])
  })

  it('每个端口类型都有类型名文案（卡片端口与「添加并连接」菜单都按它显示）', () => {
    const missing: string[] = []
    for (const dataType of GRAPH_PORT_DATA_TYPES) {
      const key = `graph.port.types.${dataType}`
      if (!readMessage(zhCN, key)) missing.push(`zh:${key}`)
      if (!readMessage(enUS, key)) missing.push(`en:${key}`)
      if (i18n.global.t(key) === key) missing.push(`resolve:${key}`)
    }
    expect(missing).toEqual([])
  })
})
