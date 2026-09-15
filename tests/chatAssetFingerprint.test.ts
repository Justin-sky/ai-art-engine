import { beforeEach, describe, expect, it, vi } from 'vitest'

const { resolveAssetFileUrlMock } = vi.hoisted(() => ({
  resolveAssetFileUrlMock: vi.fn()
}))

vi.mock('../src/renderer/src/features/media/assetUrlCache', () => ({
  resolveAssetFileUrl: resolveAssetFileUrlMock
}))

import {
  clearChatAssetFingerprintCache,
  getChatAssetFingerprint
} from '../src/renderer/src/features/media/chatAssetFingerprint'

type MockResponseInit = {
  status?: number
  total?: number
  contentRange?: string | null
  bytes?: Uint8Array
  ok?: boolean
}

function makeResponse({
  status = 206,
  total,
  contentRange,
  bytes,
  ok
}: MockResponseInit = {}): Response {
  const resolvedStatus = ok === false ? status || 404 : status
  const buf = bytes ?? new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
  const headers = new Map<string, string>()
  if (contentRange !== undefined) {
    if (contentRange !== null) headers.set('Content-Range', contentRange)
  } else if (status === 206) {
    headers.set('Content-Range', `bytes 0-${buf.byteLength - 1}/${total ?? buf.byteLength}`)
  }
  if (total !== undefined) headers.set('Content-Length', String(total))
  return {
    status: resolvedStatus,
    ok: ok ?? (resolvedStatus === 200 || resolvedStatus === 206),
    headers: {
      get: (name: string) => headers.get(name) ?? null
    },
    arrayBuffer: async () =>
      buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  } as unknown as Response
}

/**
 * 内容指纹关键测：用 Node 24 内置 fetch 直接走 studio-media:// 时会报 fetch failed，
 * 所以测试时把 fetch 抽成参数透传一份 mock 进去，避开 vitest worker 复位的坑。
 */
describe('chatAssetFingerprint', () => {
  beforeEach(() => {
    clearChatAssetFingerprintCache()
    resolveAssetFileUrlMock.mockReset()
    resolveAssetFileUrlMock.mockResolvedValue('studio-media://local/?path=%2Ftest%2Ffoo.png')
  })

  function fp(relativePath: string, fetchImpl: typeof fetch) {
    return getChatAssetFingerprint(relativePath, fetchImpl)
  }

  it('同份文件（同字节同头部）返回一致指纹', async () => {
    const fetchImpl = vi.fn(async () =>
      makeResponse({ status: 206, total: 1000, contentRange: 'bytes 0-7/1000' })
    )
    const a = await fp('Cache/Images/foo.png', fetchImpl as unknown as typeof fetch)
    const b = await fp('Cache/Images/foo.png', fetchImpl as unknown as typeof fetch)
    expect(a).not.toBeNull()
    expect(a).toBe(b)
  })

  it('内容不同指纹不同', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        makeResponse({ status: 206, total: 100, contentRange: 'bytes 0-7/100' })
      )
      .mockResolvedValueOnce(
        makeResponse({
          status: 206,
          total: 200,
          contentRange: 'bytes 0-7/200',
          bytes: new Uint8Array([10, 20, 30, 40])
        })
      )
    const a = await fp('Cache/a.png', fetchImpl as unknown as typeof fetch)
    const b = await fp('Cache/b.png', fetchImpl as unknown as typeof fetch)
    expect(a).not.toBeNull()
    expect(b).not.toBeNull()
    expect(a).not.toBe(b)
  })

  it('同字节同内容 → 跨 Cache/Assets 路径视为同一份（指纹一致）', async () => {
    const fetchImpl = vi.fn(async () =>
      makeResponse({
        status: 206,
        total: 64,
        contentRange: 'bytes 0-7/64',
        bytes: new Uint8Array([9, 8, 7, 6, 5, 4, 3, 2])
      })
    )
    const cacheFp = await fp('Cache/Images/foo.png', fetchImpl as unknown as typeof fetch)
    const libraryFp = await fp('Assets/Advert/foo.png', fetchImpl as unknown as typeof fetch)
    expect(cacheFp).toBe(libraryFp)
  })

  it('超过 50MB 的文件跳过指纹（IO 太大）', async () => {
    const big = 80 * 1024 * 1024
    const fetchImpl = vi.fn(async () =>
      makeResponse({
        status: 206,
        total: big,
        contentRange: `bytes 0-7/${big}`
      })
    )
    const first = await fp('Cache/Videos/big.mp4', fetchImpl as unknown as typeof fetch)
    expect(first).toBeNull()
    const second = await fp('Cache/Videos/big.mp4', fetchImpl as unknown as typeof fetch)
    expect(second).toBeNull()
    // skip 后第二次不应再发起 IO
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('Range 请求失败回退到 null（不去重），不抛异常', async () => {
    const fetchImpl = vi.fn(async () => makeResponse({ status: 500, ok: false }))
    const a = await fp('Cache/Images/broken.png', fetchImpl as unknown as typeof fetch)
    expect(a).toBeNull()
  })

  it('空 / 空白路径直接返回 null', async () => {
    const fetchImpl = vi.fn()
    expect(await fp('', fetchImpl as unknown as typeof fetch)).toBeNull()
    expect(await fp('   ', fetchImpl as unknown as typeof fetch)).toBeNull()
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('路径分隔符归一化（反斜杠与正斜杠视为同一份）', async () => {
    const fetchImpl = vi.fn(async () =>
      makeResponse({ status: 206, total: 32, contentRange: 'bytes 0-7/32' })
    )
    const a = await fp('Cache\\Images\\foo.png', fetchImpl as unknown as typeof fetch)
    const b = await fp('Cache/Images/foo.png', fetchImpl as unknown as typeof fetch)
    expect(a).toBe(b)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('Content-Range 缺失时回退到 Content-Length 拿总字节数', async () => {
    const fetchImpl = vi.fn(async () =>
      makeResponse({ status: 200, total: 4321, contentRange: null })
    )
    const a = await fp('Cache/Images/x.png', fetchImpl as unknown as typeof fetch)
    expect(a).toBeTruthy()
    expect(a).toContain('4321_')
  })
})