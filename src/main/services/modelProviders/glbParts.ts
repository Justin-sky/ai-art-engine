/**
 * 从 GLB 里读部件名。
 *
 * Tripo 拆件（`/v3/mesh/segment`、`/v3/mesh/smartsegment`）的输出是一个 GLB，
 * 每个部件是独立 node；下游按部件操作（补全 / 重拓扑 / 贴图 / 导出）用的
 * `part_names` 回指的就是这些 node 名——API 响应里并不单列部件名，只能自己解析。
 */
import { readFileSync } from 'node:fs'

/** glTF 二进制的 JSON chunk 类型标识（'JSON' 四字节小端） */
const GLB_JSON_CHUNK = 0x4e4f534a
/** GLB 头 magic：'glTF' 四字节小端 */
const GLB_MAGIC = 0x46546c67

/** 解析 GLB 字节流里的 node 名（去重、去空、保持原始顺序） */
export function parseGlbPartNames(data: Uint8Array): string[] {
  if (data.byteLength < 20) return []
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  if (view.getUint32(0, true) !== GLB_MAGIC) return []
  const jsonLength = view.getUint32(12, true)
  if (view.getUint32(16, true) !== GLB_JSON_CHUNK || jsonLength <= 0) return []

  let doc: { nodes?: Array<{ name?: unknown }> }
  try {
    const end = Math.min(20 + jsonLength, data.byteLength)
    const json = new TextDecoder().decode(data.subarray(20, end)).replace(/\0+$/, '')
    doc = JSON.parse(json) as { nodes?: Array<{ name?: unknown }> }
  } catch {
    return []
  }

  const names: string[] = []
  for (const node of doc.nodes ?? []) {
    const name = typeof node?.name === 'string' ? node.name.trim() : ''
    if (name && !names.includes(name)) names.push(name)
  }
  return names
}

/** 读本地 GLB 文件取部件名；读不到 / 非 GLB / 解析失败一律返回空数组 */
export function readGlbPartNames(absPath: string): string[] {
  try {
    return parseGlbPartNames(readFileSync(absPath))
  } catch {
    return []
  }
}
