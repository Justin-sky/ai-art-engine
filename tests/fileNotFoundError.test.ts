import { afterEach, describe, expect, it } from 'vitest'
import { MAIN_ERRORS } from '../src/main/errors/messages'
import {
  fail,
  formatBi,
  setAppErrorLocaleResolver,
  type AppLanguage
} from '../src/shared/errors/appError'

/**
 * MAIN_ERRORS.fileNotFound 必须带上 `path`，否则用户在 IPC 报错日志里看不到具体哪个文件丢失，
 * 排查「AI 对话产物保存到资产库」这一类 race 时基本无信息可循。
 *
 * 此前的 defErrSimple 实现只回吐「媒体文件不存在」，无法定位，CHANGELOG 之外需要单独测试守住这条契约。
 */
describe('MAIN_ERRORS.fileNotFound', () => {
  function withLocale(locale: AppLanguage, run: () => void): void {
    setAppErrorLocaleResolver(() => locale)
    try {
      run()
    } finally {
      setAppErrorLocaleResolver(() => 'zh-CN')
    }
  }

  afterEach(() => {
    // 双保险：保证 case 异常时也回到默认中文 locale，避免污染同进程其它测试
    setAppErrorLocaleResolver(() => 'zh-CN')
  })

  it('zh 文案拼接 path，code 仍为 fs.fileNotFound', () => {
    withLocale('zh-CN', () => {
      const err = fail(MAIN_ERRORS.fileNotFound, { path: 'Cache/Images/foo.png' })
      expect(err.code).toBe('fs.fileNotFound')
      expect(err.message).toContain('Cache/Images/foo.png')
      expect(err.message.startsWith('媒体文件不存在')).toBe(true)
    })
  })

  it('en 文案拼接 path', () => {
    withLocale('en-US', () => {
      const err = fail(MAIN_ERRORS.fileNotFound, { path: 'Cache/Images/foo.png' })
      expect(err.message).toContain('Cache/Images/foo.png')
      expect(err.message.startsWith('Media file not found')).toBe(true)
    })
  })

  it('path 为空时仍能正常格式化（不至于抛错或吞掉）', () => {
    withLocale('zh-CN', () => {
      const err = fail(MAIN_ERRORS.fileNotFound, { path: '' })
      // 文案仍以「媒体文件不存在」开头，不至于变成空字符串
      expect(err.message).toContain('媒体文件不存在')
    })
  })

  it('formatBi 同步返回字符串，供日志/非 throw 场景使用', () => {
    withLocale('en-US', () => {
      expect(formatBi(MAIN_ERRORS.fileNotFound, { path: 'Cache/x.png' })).toBe(
        'Media file not found: Cache/x.png'
      )
    })
  })
})
