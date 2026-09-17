import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeMediaStreamsUnder, handleStudioMediaRequest } from '../src/main/studioMediaProtocol'

function mediaUrl(abs: string): string {
  return `studio-media://local/?path=${encodeURIComponent(abs)}`
}

describe('studio-media 协议句柄管理', () => {
  let root: string
  let imagesDir: string
  let filePath: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'studio-media-'))
    imagesDir = join(root, 'Images')
    mkdirSync(imagesDir, { recursive: true })
    filePath = join(imagesDir, 'a.png')
    writeFileSync(filePath, Buffer.alloc(2048, 7))
  })

  afterEach(() => {
    closeMediaStreamsUnder(root)
    rmSync(root, { recursive: true, force: true })
  })

  it('GET 留下的在途读流能按目录强制关掉', () => {
    // 不消费 body，模拟 Chromium 取消请求后读流悬着的情况
    const res = handleStudioMediaRequest(new Request(mediaUrl(filePath)))
    expect(res.status).toBe(200)

    expect(closeMediaStreamsUnder(imagesDir)).toBe(1)
    // 已经关过的不会重复计数
    expect(closeMediaStreamsUnder(imagesDir)).toBe(0)
  })

  it('Range 请求的读流同样登记在案', () => {
    const res = handleStudioMediaRequest(
      new Request(mediaUrl(filePath), { headers: { Range: 'bytes=0-511' } })
    )
    expect(res.status).toBe(206)
    expect(closeMediaStreamsUnder(root)).toBe(1)
  })

  it('HEAD 不开文件句柄', () => {
    const res = handleStudioMediaRequest(new Request(mediaUrl(filePath), { method: 'HEAD' }))
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Length')).toBe('2048')
    expect(closeMediaStreamsUnder(root)).toBe(0)
  })

  it('同名前缀的兄弟目录不会被误伤', () => {
    const sibling = join(root, 'Images 2')
    mkdirSync(sibling, { recursive: true })
    const siblingFile = join(sibling, 'b.png')
    writeFileSync(siblingFile, Buffer.alloc(16, 1))

    handleStudioMediaRequest(new Request(mediaUrl(siblingFile)))
    // 要搬的是 Images，"Images 2" 里的流不该被关
    expect(closeMediaStreamsUnder(imagesDir)).toBe(0)
    expect(closeMediaStreamsUnder(sibling)).toBe(1)
  })
})
