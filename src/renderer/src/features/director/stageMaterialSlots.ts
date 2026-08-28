/**
 * 舞台物体材质槽枚举（纯函数，便于单测）。
 *
 * 同一材质被多个网格共享时只枚举一次；材质名即覆盖键（稳定，随 GLTF 持久化），
 * 空名材质按枚举顺序合成 `material-N`。
 */
export interface StageMaterialSlotInput<TMaterial> {
  material: TMaterial
  name?: string
}

export interface StageMaterialSlotRef<TMaterial> {
  /** 覆盖键：材质名或合成名 */
  key: string
  /** 展示名 */
  label: string
  material: TMaterial
}

export function collectStageMaterialSlots<TMaterial>(
  items: Iterable<StageMaterialSlotInput<TMaterial>>
): StageMaterialSlotRef<TMaterial>[] {
  const byMaterial = new Map<TMaterial, string>()
  const byKey = new Map<string, StageMaterialSlotRef<TMaterial>>()
  let unnamed = 0
  for (const item of items) {
    if (byMaterial.has(item.material)) continue
    const label = (item.name ?? '').trim()
    const key = label || `material-${++unnamed}`
    if (byKey.has(key)) continue
    byKey.set(key, { key, label: label || key, material: item.material })
    byMaterial.set(item.material, key)
  }
  return [...byKey.values()]
}
