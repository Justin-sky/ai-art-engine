/**
 * src/shared/domain.ts 中 BlenderMcpSettings 兜底归一化测试：
 * - 老 settings.json 缺 blenderMcp 段时调用，保证写盘前结构完整
 * - 非法值（端口越界、空字符串、错误类型）回退默认
 * - 合法值原样保留
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

  it('合法字段全部保留', () => {
    const input = {
      enabled: false,
      command: 'python',
      args: '-m blender_mcp',
      serverHost: '192.168.1.10',
      serverPort: 9877,
      safeMode: false,
      bridgePort: 43200
    }
    expect(normalizeBlenderMcpSettings(input)).toEqual(input)
  })

  it('serverPort / bridgePort 越界 / 非法值回退默认', () => {
    const defaults = createDefaultBlenderMcpSettings()
    expect(normalizeBlenderMcpSettings({ serverPort: 0 }).serverPort).toBe(defaults.serverPort)
    expect(normalizeBlenderMcpSettings({ serverPort: 99999 }).serverPort).toBe(defaults.serverPort)
    expect(normalizeBlenderMcpSettings({ serverPort: 'not-a-number' }).serverPort).toBe(
      defaults.serverPort
    )
    expect(normalizeBlenderMcpSettings({ serverPort: 3.7 }).serverPort).toBe(3)
    expect(normalizeBlenderMcpSettings({ bridgePort: 70000 }).bridgePort).toBe(defaults.bridgePort)
    expect(normalizeBlenderMcpSettings({ bridgePort: -1 }).bridgePort).toBe(defaults.bridgePort)
  })

  it('空白 command / serverHost 回退默认', () => {
    const defaults = createDefaultBlenderMcpSettings()
    expect(normalizeBlenderMcpSettings({ command: '   ' }).command).toBe(defaults.command)
    expect(normalizeBlenderMcpSettings({ command: '' }).command).toBe(defaults.command)
    expect(normalizeBlenderMcpSettings({ serverHost: '' }).serverHost).toBe(defaults.serverHost)
    expect(normalizeBlenderMcpSettings({ serverHost: '  ' }).serverHost).toBe(defaults.serverHost)
  })

  it('非布尔 safeMode / enabled 回退默认', () => {
    const defaults = createDefaultBlenderMcpSettings()
    expect(normalizeBlenderMcpSettings({ safeMode: 'yes' }).safeMode).toBe(defaults.safeMode)
    expect(normalizeBlenderMcpSettings({ safeMode: 1 }).safeMode).toBe(defaults.safeMode)
    expect(normalizeBlenderMcpSettings({ enabled: 'true' as unknown as boolean }).enabled).toBe(
      defaults.enabled
    )
  })

  it('未知字段被忽略（不会进结果）', () => {
    const result = normalizeBlenderMcpSettings({
      enabled: true,
      command: 'uvx',
      args: 'blender-mcp',
      extraField: 'dropped',
      __proto__: { malicious: true }
    })
    expect(result).not.toHaveProperty('extraField')
    expect(result).not.toHaveProperty('malicious')
  })
})
