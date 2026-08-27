import { describe, expect, it } from 'vitest'
import { createI18n } from 'vue-i18n'
import zhCN from '../src/renderer/src/i18n/locales/zh-CN'

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
    expect(t('graph.types.asset.motion')).toBe('导演台编辑')
    expect(t('graph.types.world.extract')).toBe('世界元素提取')
    expect(t('graph.types.world.table')).toBe('世界元素审核')
    expect(t('graph.types.world.gen')).toBe('世界元素生成')
    expect(t('graph.inspector.generate.presets.image.multiAngle9')).toBe('多机位九宫格')
    expect(t('graph.inspector.generate.presets.image.story25')).toBe('25宫格连贯分镜')
    expect(t('graph.inspector.generate.presets.titleImage')).toBe('图片生成模板')
    expect(t('graph.types.image.select')).toBe('选取图片')
    expect(t('graph.types.video.select')).toBe('选取视频')
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
  })
})
