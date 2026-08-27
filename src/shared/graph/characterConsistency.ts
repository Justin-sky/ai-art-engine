/**
 * 角色一致性注入：把 world 人物目录的「角色参考图」解析到分镜/场的角色引用上，
 * 供图片生成节点注入 input_references，保证跨格同人。
 */

import type { WorldEntityRef } from '../domain'
import { normalizeWorldEntityKind } from '../domain'
import { DEFAULT_MAX_INPUT_REFERENCES } from './imageGenerateParams'

/** 角色参考图源：名字 → 参考图 URL（来自世界元素「角色」生成结果） */
export interface CharacterReferenceImage {
  name: string
  imageUrl: string
}

/** 名字匹配键：去空白 + 小写，忽略中英文空格差异 */
function nameKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, '')
}

/**
 * 从世界元素生成结果（world.gen 的 worldElementOutputs）收集角色参考图：
 * 只取 type 为「角色」且名字/图 URL 非空的条目，按名字去重（首个命中优先）。
 */
export function characterReferenceImagesFromResults(
  results: ReadonlyArray<{ type?: string; name?: string; imageUrl?: string }>
): CharacterReferenceImage[] {
  const out: CharacterReferenceImage[] = []
  const seen = new Set<string>()
  for (const row of results ?? []) {
    // 兼容旧文档的中文 kind 值（'角色'），归一化到规范键
    if (normalizeWorldEntityKind(row.type ?? '') !== 'character') continue
    const name = row.name?.trim() ?? ''
    const imageUrl = row.imageUrl?.trim() ?? ''
    if (!name || !imageUrl) continue
    const key = nameKey(name)
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ name, imageUrl })
  }
  return out
}

/** 名字 → 参考图 URL 索引（首个命中优先，忽略空白/大小写） */
function indexCharacterImages(images: readonly CharacterReferenceImage[]): Map<string, string> {
  const byName = new Map<string, string>()
  for (const img of images ?? []) {
    const key = nameKey(img.name)
    if (!key || byName.has(key)) continue
    const url = img.imageUrl?.trim()
    if (url) byName.set(key, url)
  }
  return byName
}

/**
 * 解析角色引用的参考图 URL：
 * 优先用引用自带 imageUrl，否则按名字在角色参考图源里匹配；
 * 去重并按引用顺序，裁到 max 上限。
 */
export function resolveCharacterReferenceUrls(
  refs: readonly WorldEntityRef[],
  characterImages: readonly CharacterReferenceImage[] = [],
  max: number = DEFAULT_MAX_INPUT_REFERENCES
): string[] {
  const byName = indexCharacterImages(characterImages)
  const cap = Math.max(0, Math.floor(max))
  const urls: string[] = []
  const seen = new Set<string>()
  for (const ref of refs ?? []) {
    if (urls.length >= cap) break
    const own = ref?.imageUrl?.trim()
    const url = own || byName.get(nameKey(ref?.name ?? ''))
    if (!url || seen.has(url)) continue
    seen.add(url)
    urls.push(url)
  }
  return urls
}

/** 把角色参考图目录展开为可写入节点的 characterRefs（名字 + imageUrl，按 max 截断） */
export function characterRefsFromCatalog(
  characterImages: readonly CharacterReferenceImage[],
  max: number = DEFAULT_MAX_INPUT_REFERENCES
): WorldEntityRef[] {
  const cap = Math.max(0, Math.floor(max))
  return (characterImages ?? []).slice(0, cap).map((img) => ({
    name: img.name,
    imageUrl: img.imageUrl
  }))
}

/** 把解析出的角色参考图回填到引用的 imageUrl（不改动引用已有 imageUrl） */
export function applyCharacterReferenceUrls(
  refs: readonly WorldEntityRef[],
  characterImages: readonly CharacterReferenceImage[]
): WorldEntityRef[] {
  const byName = indexCharacterImages(characterImages)
  return (refs ?? []).map((ref) => {
    const own = ref?.imageUrl?.trim()
    if (own) return ref
    const url = byName.get(nameKey(ref?.name ?? ''))
    return url ? { ...ref, imageUrl: url } : ref
  })
}
