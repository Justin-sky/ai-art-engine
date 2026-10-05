import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveMediaOutputDir } from '../src/shared/domain'

const ROOT = join(__dirname, '..')

/**
 * `gen:speech` 的接线：必须走「生成 + 落盘登记」的那条路。
 *
 * 踩过的坑（回归就发生在这里）：facade 有两个方法 ——
 * `generateSpeech`（纯生成，返回类型里 **没有** assetId / relativePath）与
 * `generateSpeechAsset`（落盘 + 登记资产后补上这两个字段）。
 * 图节点拿到前者的结果会直接报「语音合成未返回资产」，而且日志里
 * response 只有 model / voice，看起来像成功 —— 极难联想。
 *
 * 这层是主进程接线，渲染进程测试环境（environment: node）挂不了 ipc，
 * 所以沿用仓库既有的「源码级接线断言」手法（见 upstreamFailureHint.test.ts）。
 */
describe('gen:speech 接线', () => {
  const ipc = readFileSync(join(ROOT, 'src/main/ipc.ts'), 'utf8')

  it('走 generateSpeechAsset（落盘 + 登记资产），不是裸的 generateSpeech', () => {
    const block = /handle\(IpcChannels\.GEN_SPEECH,[\s\S]*?\n  \}\)/.exec(ipc)?.[0] ?? ''
    expect(block).toBeTruthy()
    expect(block).toContain('generateSpeechAsset(')
    // 光看这一句不够：裸调用也含 generateSpeech，必须确认不是它
    expect(block).not.toMatch(/generateSpeech\(/)
  })

  it('与同样需要登记资产的 GEN_MUSIC 保持同一种写法', () => {
    const music = /handle\(IpcChannels\.GEN_MUSIC,[\s\S]*?\n  \}\)/.exec(ipc)?.[0] ?? ''
    expect(music).toContain('generateMusicAsset(')
    // 两者都要在写入后广播资产更新，资产库才会即时刷新
    const speech = /handle\(IpcChannels\.GEN_SPEECH,[\s\S]*?\n  \}\)/.exec(ipc)?.[0] ?? ''
    expect(speech).toContain('broadcastToAllWindows(IpcChannels.ASSET_UPDATED')
    expect(music).toContain('broadcastToAllWindows(IpcChannels.ASSET_UPDATED')
  })
})

/**
 * 落盘目录：图节点传的是工程相对目录，缺省也要给出一个（否则 attach 不知道往哪写）。
 */
describe('resolveMediaOutputDir（voice）', () => {
  it('优先用节点指定的目录', () => {
    expect(
      resolveMediaOutputDir({
        mediaOutputDir: 'Assets/Voice',
        cacheOutputDir: 'Cache',
        kind: 'voice'
      })
    ).toBe('Assets/Voice')
  })

  it('未指定时落到缓存目录下的 Voices（不自动进资产库）', () => {
    expect(resolveMediaOutputDir({ cacheOutputDir: 'Cache', kind: 'voice' })).toBe('Cache/Voices')
  })
})
