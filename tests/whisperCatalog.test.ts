import { describe, expect, it } from 'vitest'
import {
  findWhisperCatalogModel,
  parseWhisperCppJson,
  parseWhisperTimestampSec,
  pickPreferredWhisperModel,
  WHISPER_CATALOG,
  whisperInstallHintFor
} from '../src/shared/whisperCatalog'
import { isAllowedYoloDownloadUrl } from '../src/shared/yoloDownload'

describe('whisperCatalog & local Whisper JSON parser', () => {
  it('WHISPER_CATALOG entries all point to whitelisted HTTPS download hosts', () => {
    expect(WHISPER_CATALOG.length).toBeGreaterThanOrEqual(4)
    for (const model of WHISPER_CATALOG) {
      expect(isAllowedYoloDownloadUrl(model.url)).toBe(true)
      expect(model.fileName).toBe(`${model.id}.bin`)
      expect(model.minBytes).toBeGreaterThan(10 * 1024 * 1024)
    }
  })

  it('findWhisperCatalogModel strips optional .bin suffix', () => {
    expect(findWhisperCatalogModel('ggml-small')?.id).toBe('ggml-small')
    expect(findWhisperCatalogModel('ggml-small.bin')?.id).toBe('ggml-small')
    expect(findWhisperCatalogModel('non-existent')).toBeUndefined()
  })

  it('pickPreferredWhisperModel respects explicit preferredId and falls back to priority', () => {
    const installed = [
      { id: 'ggml-tiny', fileName: 'ggml-tiny.bin', path: '/m/ggml-tiny.bin', sizeMb: 75 },
      { id: 'ggml-small', fileName: 'ggml-small.bin', path: '/m/ggml-small.bin', sizeMb: 466 },
      {
        id: 'ggml-large-v3-turbo-q5_0',
        fileName: 'ggml-large-v3-turbo-q5_0.bin',
        path: '/m/ggml-large-v3-turbo-q5_0.bin',
        sizeMb: 547
      }
    ]
    // 默认按 priority 选 ggml-large-v3-turbo-q5_0
    expect(pickPreferredWhisperModel(installed)?.id).toBe('ggml-large-v3-turbo-q5_0')
    // 显式指定已安装的模型
    expect(pickPreferredWhisperModel(installed, 'ggml-tiny')?.id).toBe('ggml-tiny')
    // 显式指定未安装的模型时自动回退最高优先级
    expect(pickPreferredWhisperModel(installed, 'ggml-base')?.id).toBe('ggml-large-v3-turbo-q5_0')
  })

  it('parseWhisperTimestampSec parses HH:MM:SS,mmm and HH:MM:SS.mmm', () => {
    expect(parseWhisperTimestampSec('00:00:01,250')).toBeCloseTo(1.25, 3)
    expect(parseWhisperTimestampSec('00:01:02.500')).toBeCloseTo(62.5, 3)
    expect(parseWhisperTimestampSec('invalid')).toBeNull()
  })

  it('parseWhisperCppJson extracts segments and filters special tokens from word timestamps', () => {
    const raw = {
      result: { language: 'zh' },
      transcription: [
        {
          timestamps: { from: '00:00:00,000', to: '00:00:02,400' },
          offsets: { from: 0, to: 2400 },
          text: ' 拔刀吧，决一死战！',
          tokens: [
            { text: '[_BEG_]', offsets: { from: 0, to: 0 } },
            { text: ' 拔刀吧', offsets: { from: 100, to: 900 }, p: 0.96 },
            { text: '，决一死战！', offsets: { from: 900, to: 2350 }, p: 0.92 },
            { text: '<|endoftext|>', offsets: { from: 2400, to: 2400 } }
          ]
        },
        {
          offsets: { from: 2400, to: 3000 },
          text: '[BLANK_AUDIO]'
        }
      ]
    }
    const res = parseWhisperCppJson(raw, 'ggml-small', true)
    expect(res.language).toBe('zh')
    expect(res.model).toBe('ggml-small')
    expect(res.granularity).toBe('word')
    expect(res.segments).toHaveLength(1)
    expect(res.segments[0].startSec).toBe(0)
    expect(res.segments[0].endSec).toBeCloseTo(2.4, 3)
    expect(res.segments[0].text).toBe('拔刀吧，决一死战！')
    expect(res.segments[0].words).toHaveLength(2)
    expect(res.segments[0].words?.[0]).toEqual({
      text: '拔刀吧',
      startSec: 0.1,
      endSec: 0.9,
      confidence: 0.96
    })
  })

  it('whisperInstallHintFor returns autoInstall=true on win32', () => {
    expect(whisperInstallHintFor('win32').autoInstall).toBe(true)
    expect(whisperInstallHintFor('darwin').autoInstall).toBe(false)
  })
})
