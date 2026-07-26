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
    expect(t('graph.types.script.shotSplit')).toBe('分镜拆分')
    expect(t('graph.types.script.shotTable')).toBe('分镜表格')
    expect(t('graph.types.script.shotImageGen')).toBe('生成分镜图')
    expect(t('graph.types.script.shotVideoGen')).toBe('生成分镜视频')
    expect(t('graph.types.script.shotParams')).toBe('分镜参数')
    expect(t('graph.types.world.extract')).toBe('世界元素提取')
    expect(t('graph.types.world.table')).toBe('世界元素表格')
    expect(t('graph.types.world.editor')).toBe('世界元素编辑')
    expect(t('graph.inspector.shotParams.hint')).toContain('分镜')
    expect(t('graph.inspector.generate.presets.image.multiAngle9')).toBe('多机位九宫格')
    expect(t('graph.inspector.generate.presets.image.story25')).toBe('25宫格连贯分镜')
    expect(t('graph.inspector.generate.presets.titleImage')).toBe('图片生成模板')
    expect(t('graph.types.image.select')).toBe('选取图片')
    expect(t('graph.types.video.select')).toBe('选取视频')
    expect(t('graph.types.image.toPrompt')).toBe('图片反推提示词')
    expect(t('graph.types.prompt.optimize')).toBe('提示词优化')
    expect(t('graph.types.output.director')).toBe('导演台输出')
    expect(t('graph.types.output.script')).toBe('分镜输出')
    expect(t('graph.types.output.narrative')).toBe('叙事单元输出')
    expect(t('graph.types.output.world')).toBe('世界元素输出')
    expect(t('graph.titles.worldOutput')).toBe('世界元素输出')
  })

  it('resolves graph.port.types.* labels', () => {
    const t = i18n.global.t
    expect(t('graph.port.types.image')).toBe('图片')
    expect(t('graph.port.types.voice')).toBe('声音')
    expect(t('graph.port.types.video')).toBe('视频')
    expect(t('graph.port.types.text')).toBe('文本')
    expect(t('graph.port.types.model')).toBe('模型')
  })
})
