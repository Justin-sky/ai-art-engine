import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { toolAccessOf } from '../src/shared/mcpModeAccess'

/**
 * 界面录制的接线守卫。
 *
 * 这一层没有 jsdom / 没有 Electron，组件与真实录制都跑不起来，所以盯的是**接线本身**：
 * 通道三处是否齐全、工具是否登记、录制的关键动作（抓帧 / 编码 / 登记资产 / 清临时目录）
 * 是否都在，以及两件**安全相关**的事：录制只能被显式触发（绝不自启），
 * 且带副作用的三个工具必须是 write 级（Plan 首轮不可用、Ask 完全不可见）。
 */

const ROOT = resolve(__dirname, '..')
const read = (p: string): string => readFileSync(resolve(ROOT, p), 'utf8')

const IPC = read('src/shared/ipc.ts')
const PRELOAD = read('src/preload/index.ts')
const MAIN_IPC = read('src/main/ipc.ts')
const SERVICE = read('src/main/services/screenRecordService.ts')
const MCP = read('src/main/services/mcpServerService.ts')
const INDEX = read('src/main/index.ts')

describe('界面录制：IPC 三处齐全', () => {
  const channels = [
    ['SCREEN_RECORD_START', 'screen-record:start'],
    ['SCREEN_RECORD_STEP', 'screen-record:step'],
    ['SCREEN_RECORD_STOP', 'screen-record:stop'],
    ['SCREEN_RECORD_STATUS', 'screen-record:status'],
    ['SCREEN_RECORD_HUD', 'screen-record:hud']
  ] as const

  it('通道常量与契约都在 shared/ipc.ts', () => {
    for (const [name, value] of channels) {
      expect(IPC, `缺通道 ${name}`).toContain(`${name}: '${value}'`)
    }
    expect(IPC).toMatch(/interface ScreenRecordStartInput/)
    expect(IPC).toMatch(/screenRecordStart: \(input\?: ScreenRecordStartInput\)/)
    expect(IPC).toMatch(/onScreenRecordHud:/)
  })

  it('preload 转发：四个 invoke + 一个事件订阅（订阅要能退订）', () => {
    // stop / status 不收参数，start / step 收 —— 按实际签名断言，别强求统一形状
    expect(PRELOAD).toContain('screenRecordStart: (input) =>')
    expect(PRELOAD).toContain('screenRecordStep: (input) =>')
    expect(PRELOAD).toContain('screenRecordStop: () =>')
    expect(PRELOAD).toContain('screenRecordStatus: () =>')
    for (const name of ['START', 'STEP', 'STOP', 'STATUS']) {
      expect(PRELOAD, `preload 的 screenRecord${name} 没转发到对应通道`).toContain(
        `IpcChannels.SCREEN_RECORD_${name}`
      )
    }
    expect(PRELOAD).toContain('onScreenRecordHud: (callback) =>')
    expect(PRELOAD).toMatch(/removeListener\(IpcChannels\.SCREEN_RECORD_HUD/)
  })

  it('主进程注册了四个 handler', () => {
    for (const name of ['START', 'STEP', 'STOP', 'STATUS']) {
      expect(MAIN_IPC, `主进程缺 handler ${name}`).toContain(`IpcChannels.SCREEN_RECORD_${name}`)
    }
  })
})

describe('界面录制：MCP 工具与访问等级', () => {
  it('四个工具都登记了，且状态查询是 read、其余是 write', () => {
    for (const name of [
      'screen_record_start',
      'screen_record_step',
      'screen_record_stop',
      'screen_record_status'
    ]) {
      expect(MCP, `工具清单里缺 ${name}`).toContain(`name: '${name}'`)
    }
    // 用真实判定函数，而不是抄一遍字符串比较
    expect(toolAccessOf('screen_record_status')).toBe('read')
    expect(toolAccessOf('screen_record_start')).toBe('write')
    expect(toolAccessOf('screen_record_step')).toBe('write')
    expect(toolAccessOf('screen_record_stop')).toBe('write')
  })

  it('start 的工具描述写明了「只录制应用窗口」与「仅在用户明确要求时调用」', () => {
    const at = MCP.indexOf("name: 'screen_record_start'")
    const block = MCP.slice(at, at + 2600)
    expect(block).toContain('应用自己的窗口')
    expect(block).toContain('只在用户明确要求录制时才调用')
    // 要告诉 Agent 完整链路，否则「一句话出教学视频」靠它自己猜
    expect(block).toContain('screen_record_stop')
    expect(block).toContain('timeline_edit')
  })
})

describe('界面录制：服务侧的硬性动作', () => {
  /**
   * 取一个函数的完整函数体（花括号配对，跳过字符串里的括号）。
   *
   * 不能只做「文件里有没有这个字符串」的检查：把调用包一层、或换个位置，字符串仍在，
   * 断言照样绿 —— 变异测试就是这么识破前两版守卫的。
   */
  function fnBody(name: string): string {
    const at = SERVICE.indexOf(`function ${name}`)
    expect(at, `应当能找到 ${name}`).toBeGreaterThan(-1)
    let depth = 0
    let quote: string | null = null
    for (let i = SERVICE.indexOf('{', at); i < SERVICE.length; i += 1) {
      const c = SERVICE[i]
      if (quote) {
        if (c === '\\') i += 1
        else if (c === quote) quote = null
        continue
      }
      if (c === "'" || c === '"' || c === '`') quote = c
      else if (c === '{') depth += 1
      else if (c === '}') {
        depth -= 1
        if (depth === 0) return SERVICE.slice(at, i + 1)
      }
    }
    return SERVICE.slice(at)
  }

  it('抓帧、编码、登记资产、清临时目录都在', () => {
    expect(SERVICE).toContain('capturePage(')
    expect(SERVICE).toContain('fingerprintOfBitmap(')
    expect(SERVICE).toContain('runFfmpeg(')
    expect(SERVICE).toContain('buildImageSequenceArgs(')
    // 登记资产要**真的是那句赋值调用**：包一层假对象也能让「字符串存在」通过
    expect(SERVICE).toMatch(
      /const asset = projectService\.attachExternalGeneratedFile\(\{\s*type: 'video'/
    )
    const stopBody = fnBody('stopScreenRecording')
    expect(stopBody, '停止路径必须清临时帧目录').toMatch(/rmSync\(recording\.workDir/)
    expect(stopBody, '登记完要广播给界面，否则资产库不刷新').toContain(
      'broadcastToAllWindows(IpcChannels.ASSET_UPDATED, asset)'
    )
  })

  it('重复帧用硬链接（失败退回复制），不靠平白复制撑大磁盘', () => {
    expect(SERVICE).toContain('linkSync(')
    expect(SERVICE).toContain('copyFileSync(')
  })

  it('开始前先确认 ffmpeg 可用：缺它就不录（录完才发现编不了码等于白录）', () => {
    expect(SERVICE).toContain("runFfmpeg(bin, ['-version'])")
    expect(SERVICE).toContain("reasonKey: 'ffmpegMissing'")
  })

  it('**绝不自启录制**：本模块里只有函数声明，没有任何一处调用它自己', () => {
    // 计数而不是正则：`export async function startScreenRecording(` 里那个 `(` 也会被
    // 「前面不是字母」的正则命中（前面是空格），那种守卫看着在守、其实永远红或永远绿
    const calls = SERVICE.split('startScreenRecording(').length - 1
    expect(calls, '只应有那一处函数声明').toBe(1)
    // 唯一入口在 IPC 与 MCP 工具两侧
    expect(MAIN_IPC).toContain('startScreenRecording(input)')
    expect(MCP).toContain('startScreenRecording({')
  })

  it('主窗口引用走独立小模块（服务不能反向 import 入口）', () => {
    expect(SERVICE).toContain("from '../mainWindowRef'")
    expect(INDEX).toContain('setMainWindowRef(window)')
    expect(SERVICE).not.toContain("from '../index'")
  })

  it('退出时收尾：清定时器与临时帧目录', () => {
    expect(INDEX).toContain('abortScreenRecording()')
    expect(SERVICE).toMatch(/export function abortScreenRecording/)
  })

  it('录制期间推 HUD 状态（录制指示必须可见）', () => {
    expect(SERVICE).toContain('IpcChannels.SCREEN_RECORD_HUD')
    expect(SERVICE).toMatch(/recording: true/)
    expect(SERVICE).toMatch(/recording: false/)
  })
})
