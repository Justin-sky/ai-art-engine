/**
 * 图库里「本节点产物 + 额外产物」的合成规则。
 *
 * 抽成纯函数是因为它要被单测盯住：额外产物（空间世界随世界免费返回的 SPZ 泼溅 /
 * 全景图）**不是本节点 Cook 出来的**，所以它们只能看、不能被选成出口、也不能被删 ——
 * 弄错了就会把上游世界的产物从本节点的出口里删掉。
 */
export type GalleryExtraItem = {
  key: string
  relativePath: string
  label?: string
}

export type GalleryEntry = {
  key: string
  /** 本节点 Cook 出来的产物（可选中当出口 / 可删）；额外产物不可选 */
  selectable: boolean
  relativePath: string
  label?: string
}

export function buildGalleryEntries(input: {
  own: Array<{ id?: string; relativePath?: string }>
  extras?: readonly GalleryExtraItem[]
}): GalleryEntry[] {
  const own: GalleryEntry[] = input.own
    .map((item, index) => ({
      item,
      key: item.id || `index:${index}`
    }))
    .filter(({ item }) => Boolean(item.id && item.relativePath?.trim()))
    .map(({ item, key }) => ({
      key,
      selectable: true,
      relativePath: item.relativePath!.trim()
    }))

  const extras: GalleryEntry[] = (input.extras ?? [])
    .filter((item) => Boolean(item.relativePath?.trim()))
    .map((item) => ({
      key: item.key,
      selectable: false,
      relativePath: item.relativePath.trim(),
      ...(item.label ? { label: item.label } : {})
    }))

  return [...own, ...extras]
}
