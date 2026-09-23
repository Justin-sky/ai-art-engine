/**
 * src/shared/domain.ts 中 BlenderMcpSettings 兜底归一化测试：
 * - 老 settings.json 缺 blenderMcp 段时调用，保证写盘前结构完整
 * - 非法值（端口越界、空字符串、错误类型）回退默认
 * - 旧版本写入的 command / args / bridgePort 已被移除，必须当未知字段丢弃
 */
import { describe, expect, it } from 'vitest'
import {
  createDefaultBlenderMcpSettings,
  DEFAULT_SETTINGS,
  normalizeBlenderMcpSettings
} from '../src/shared/domain'

describe('normalizeBlenderMcpSettings', () => {
  it('返回 createDefaultBlenderMcpSettings 当输入为空 / null / 非对象', () => {
    const defaults = createDefaultBlenderMcpSettings()
    expect(normalizeBlenderMcpSettings(undefined)).toEqual(defaults)
    expect(normalizeBlenderMcpSettings(null)).toEqual(defaults)
    expect(normalizeBlenderMcpSettings('not-an-object')).toEqual(defaults)
    expect(normalizeBlenderMcpSettings(42)).toEqual(defaults)
    expect(normalizeBlenderMcpSettings({})).toEqual(defaults)
  })

  it('DEFAULT_SETTINGS.blenderMcp 本身就是合法的（与 createDefault 一致）', () => {
    expect(normalizeBlenderMcpSettings(DEFAULT_SETTINGS.blenderMcp)).toEqual(
      createDefaultBlenderMcpSettings()
    )
  })

  it('默认值指向 addon.py 的默认监听地址，且词法护栏已关闭', () => {
    const defaults = createDefaultBlenderMcpSettings()
    expect(defaults).toEqual({
      enabled: true,
      serverHost: 'localhost',
      serverPort: 9876,
      safeMode: false,
      addonType: 'community'
    })
  })

  it('合法字段全部保留（safeMode 历史 true 也会被强制关闭）', () => {
    const input = {
      enabled: false,
      serverHost: '192.168.1.10',
      serverPort: 9877,
      safeMode: true,
      addonType: 'official' as const
    }
    expect(normalizeBlenderMcpSettings(input)).toEqual({ ...input, safeMode: false })
  })

  it('addonType 只有 official 合法，其余回退 community', () => {
    expect(normalizeBlenderMcpSettings({ addonType: 'official' }).addonType).toBe('official')
    expect(normalizeBlenderMcpSettings({ addonType: 'Community' }).addonType).toBe('community')
    expect(normalizeBlenderMcpSettings({ addonType: 'blender-lab' }).addonType).toBe('community')
    expect(normalizeBlenderMcpSettings({ addonType: 1 }).addonType).toBe('community')
    expect(normalizeBlenderMcpSettings({}).addonType).toBe('community')
  })

  it('serverPort 越界 / 非法值回退默认', () => {
    const defaults = createDefaultBlenderMcpSettings()
    expect(normalizeBlenderMcpSettings({ serverPort: 0 }).serverPort).toBe(defaults.serverPort)
    expect(normalizeBlenderMcpSettings({ serverPort: 99999 }).serverPort).toBe(defaults.serverPort)
    expect(normalizeBlenderMcpSettings({ serverPort: 'not-a-number' }).serverPort).toBe(
      defaults.serverPort
    )
    expect(normalizeBlenderMcpSettings({ serverPort: 3.7 }).serverPort).toBe(3)
  })

  it('空白 serverHost 回退默认', () => {
    const defaults = createDefaultBlenderMcpSettings()
    expect(normalizeBlenderMcpSettings({ serverHost: '' }).serverHost).toBe(defaults.serverHost)
    expect(normalizeBlenderMcpSettings({ serverHost: '  ' }).serverHost).toBe(defaults.serverHost)
    expect(normalizeBlenderMcpSettings({ serverHost: ' 10.0.0.2 ' }).serverHost).toBe('10.0.0.2')
  })

  it('非布尔 safeMode / enabled 回退默认', () => {
    const defaults = createDefaultBlenderMcpSettings()
    expect(normalizeBlenderMcpSettings({ safeMode: 'yes' }).safeMode).toBe(defaults.safeMode)
    expect(normalizeBlenderMcpSettings({ safeMode: 1 }).safeMode).toBe(defaults.safeMode)
    expect(normalizeBlenderMcpSettings({ enabled: 'true' as unknown as boolean }).enabled).toBe(
      defaults.enabled
    )
  })

  it('旧版本的 command / args / bridgePort 被当作未知字段丢弃', () => {
    const result = normalizeBlenderMcpSettings({
      enabled: true,
      command: 'uvx',
      args: 'blender-mcp',
      bridgePort: 43120,
      serverPort: 9876,
      safeMode: true
    })
    expect(result).toEqual({
      enabled: true,
      serverHost: 'localhost',
      serverPort: 9876,
      safeMode: false,
      addonType: 'community'
    })
    expect(result).not.toHaveProperty('command')
    expect(result).not.toHaveProperty('args')
    expect(result).not.toHaveProperty('bridgePort')
  })

  it('未知字段 / 原型污染被忽略（不会进结果）', () => {
    const result = normalizeBlenderMcpSettings({
      enabled: true,
      extraField: 'dropped',
      __proto__: { malicious: true }
    })
    expect(result).not.toHaveProperty('extraField')
    expect(result).not.toHaveProperty('malicious')
  })
})
