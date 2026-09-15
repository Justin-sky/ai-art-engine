/**
 * 对话资产卡内容指纹：用于聊天流去重。
 *
 * 为什么需要：MCP `generate_*` 现在一律落 Cache、不入资产库，但 agent 仍可能通过
 * `asset_import` / 手工 `Assets/` 拷贝 / 不同 outputDir 等"路径"绕路把同一份媒体再次
 * 入库，从而在聊天流里出两张指向同一文件的卡。这里的指纹就是兜底——
 * 同份文件已经在聊天流里展示过，新卡直接吃掉。
 *
 * 设计要点：
 *  - 指纹 = `文件总字节数_前 8KB 的 djb2`。
 *    仅取前 8KB 是为了避免大文件被全量 fetch；同时 studio-media 协议支持 Range，
 *    一次往返就够；同字节数撞同头哈希的概率对生成媒体而言极低，足够可靠。
 *  - 50MB 以上的文件跳过指纹（不太可能重复入库，IO 也不值）。
 *  - 失败一律返回 null（不去重），避免路径失效 / 文件被搬移时把新卡也吞掉。
 */
import { resolveAssetFileUrl } from './assetUrlCache'

const HEAD_SIZE = 8 * 1024
const SIZE_LIMIT = 50 * 1024 * 1024

type FingerprintState = 'pending' | 'ok' | 'skip'
const cache = new Map<string, string>()
const state = new Map<string, FingerprintState>()
const inflight = new Map<string, Promise<string | null>>()

function normalize(p: string): string {
  return p.replace(/\\/g, '/').trim()
}

function djb2(bytes: Uint8Array): number {
  let h = 5381
  for (let i = 0; i < bytes.length; i++) {
    h = (((h << 5) + h) + bytes[i]) | 0
  }
  return h
}

function parseTotalFromContentRange(header: string | null | undefined): number | null {
  if (!header) return null
  const match = /\/(\d+)$/.exec(header.trim())
  if (!match) return null
  const n = Number(match[1])
  return Number.isFinite(n) && n >= 0 ? n : null
}

/**
 * 取一份媒体文件的指纹，缓存命中时立即返回；命中失败路径（文件缺失 / 太大）则记
 * 'skip'，下次同路径直接返回 null，不再重 IO。
 */
export async function getChatAssetFingerprint(
  relativePath: string,
  fetchImpl?: typeof fetch
): Promise<string | null> {
  const key = normalize(relativePath)
  if (!key) return null
  const cached = cache.get(key)
  if (cached !== undefined) return cached
  if (state.get(key) === 'skip') return null
  const existing = inflight.get(key)
  if (existing) return existing

  const f = fetchImpl ?? globalThis.fetch.bind(globalThis)
  const promise = (async (): Promise<string | null> => {
    try {
      const url = await resolveAssetFileUrl(key)
      if (!url) {
        state.set(key, 'skip')
        return null
      }
      const res = await f(url, { headers: { Range: `bytes=0-${HEAD_SIZE - 1}` } })
      if (res.status !== 206 && res.status !== 200) {
        state.set(key, 'skip')
        return null
      }
      // 200 表示服务端忽略了 Range 返回整文件；同样能算出指纹，但要兜底字节数。
      const total =
        parseTotalFromContentRange(res.headers.get('Content-Range')) ??
        Number(res.headers.get('Content-Length')) ??
        0
      if (total > SIZE_LIMIT) {
        state.set(key, 'skip')
        return null
      }
      const buf = await res.arrayBuffer()
      const head = new Uint8Array(buf, 0, Math.min(buf.byteLength, HEAD_SIZE))
      const fp = `${total}_${djb2(head).toString(16)}`
      cache.set(key, fp)
      state.set(key, 'ok')
      return fp
    } catch {
      state.set(key, 'skip')
      return null
    } finally {
      inflight.delete(key)
    }
  })()

  inflight.set(key, promise)
  return promise
}

/** 清空指纹缓存（项目切换 / 强制刷新时调用） */
export function clearChatAssetFingerprintCache(): void {
  cache.clear()
  state.clear()
  inflight.clear()
}