import {
  asWorldRefList,
  buildShotGenerationPrompt,
  createEmptyStoryboard,
  normalizeStoryboard,
  type Shot,
  type ShotStoryboard
} from '../domain'
import type { GraphNode, GraphNodeParams } from './types'
import { createNodeFromType } from './create'
import {
  bindingStoryboardFromShotSplitRow,
  findShotSplitRowForShot,
  mergeStoryboardBindings,
  mergeWorldRefListsPreferImages,
  parseShotSplitJson
} from './shotSplitParse'

/** 分镜参数：绑定图（角色/场景/道具/武器）输出口 */
export const SHOT_PARAMS_IMAGES_PORT_ID = 'out-images'

export type ShotParamsBindingImage = { id: string; name: string; relativePath: string }

/** 分镜参数节点默认 params（右键添加 / 新建节点） */
export function defaultShotParamsNodeParams(): Pick<GraphNodeParams, 'shotStoryboard'> {
  return { shotStoryboard: createEmptyStoryboard() }
}

/** 从 storyboard 收集绑定图（角色/场景/道具/武器，按路径去重） */
export function collectShotParamsBindingImages(
  storyboard: ShotStoryboard | undefined | null
): ShotParamsBindingImage[] {
  if (!storyboard) return []
  const lists = [
    storyboard.characters,
    storyboard.scenes,
    storyboard.props,
    storyboard.weapons
  ]
  const seen = new Set<string>()
  const out: ShotParamsBindingImage[] = []
  for (const list of lists) {
    for (const ref of asWorldRefList(list)) {
      const url = (ref.imageUrl ?? '').trim().replace(/\\/g, '/')
      if (!url || url.startsWith('data:') || seen.has(url)) continue
      seen.add(url)
      const name = ref.name?.trim() || url
      out.push({
        id: url,
        name,
        relativePath: url
      })
    }
  }
  return out
}

/**
 * 合并节点本地 storyboard 与 live 分镜 storyboard 的绑定列表后收集图片。
 * 切镜后节点 params 可能滞后，执行/软解析时以 live 补齐 imageUrl。
 */
export function collectShotParamsBindingImagesFromSources(
  ...storyboards: Array<ShotStoryboard | undefined | null>
): ShotParamsBindingImage[] {
  const merged: ShotStoryboard = {
    ...createEmptyStoryboard(),
    characters: [],
    scenes: [],
    props: [],
    weapons: []
  }
  for (const sb of storyboards) {
    if (!sb) continue
    merged.characters.push(...asWorldRefList(sb.characters))
    merged.scenes.push(...asWorldRefList(sb.scenes))
    merged.props.push(...asWorldRefList(sb.props))
    merged.weapons.push(...asWorldRefList(sb.weapons))
  }
  return collectShotParamsBindingImages(merged)
}

/**
 * 收集剧本下全部镜头的绑定图（角色/场景/道具/武器，按路径去重）。
 * 表格缓存可补齐 Shot.storyboard 为空时的 imageUrl。
 */
export function collectAllShotBindingImages(input: {
  shots: Array<Pick<Shot, 'id' | 'title' | 'storyboard'>>
  tableText?: string | null
}): ShotParamsBindingImage[] {
  const shots = input.shots ?? []
  const rows = parseShotSplitJson(input.tableText)
  const orderedIds = shots.map((shot) => shot.id)
  const storyboards: ShotStoryboard[] = []
  for (const shot of shots) {
    const row = findShotSplitRowForShot(rows, shot, orderedIds)
    storyboards.push(
      mergeStoryboardBindings(
        normalizeStoryboard(shot),
        row ? bindingStoryboardFromShotSplitRow(row) : null
      )
    )
  }
  // 尚无 Shot 列表时仍输出表格行上的绑定图
  if (!shots.length && rows?.length) {
    for (const row of rows) {
      storyboards.push(bindingStoryboardFromShotSplitRow(row))
    }
  }
  return collectShotParamsBindingImagesFromSources(...storyboards)
}

/** 将全镜绑定图写入节点 params，供不运行即可 softResolve */
export function syncShotParamsAllBindingImages(
  node: Pick<GraphNode, 'params'>,
  images: ShotParamsBindingImage[]
): void {
  node.params = {
    ...node.params,
    shotParamsAllBindingImages: images.map((item) => ({ ...item }))
  }
}

/** 从节点 params 读取全镜绑定图缓存 */
export function readShotParamsAllBindingImages(
  params: GraphNodeParams | undefined | null
): ShotParamsBindingImage[] {
  const raw = params?.shotParamsAllBindingImages
  if (!Array.isArray(raw) || !raw.length) return []
  const seen = new Set<string>()
  const out: ShotParamsBindingImage[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const path = (item.relativePath ?? item.id ?? '').trim().replace(/\\/g, '/')
    if (!path || path.startsWith('data:') || seen.has(path)) continue
    seen.add(path)
    out.push({
      id: typeof item.id === 'string' && item.id.trim() ? item.id.trim() : path,
      name: typeof item.name === 'string' && item.name.trim() ? item.name.trim() : path,
      relativePath: path
    })
  }
  return out
}

/** 解析分镜参数 out-images：优先全镜 resolver，其次节点缓存，再回落单镜合并 */
export function resolveShotParamsBindingImageItems(input: {
  node: Pick<GraphNode, 'params'>
  resolveAllShotBindingImages?: () => ShotParamsBindingImage[] | null | undefined
  resolveShotStoryboard?: (boundShotId?: string) => { storyboard: ShotStoryboard } | null
}): ShotParamsBindingImage[] {
  const fromAll = input.resolveAllShotBindingImages?.()
  if (fromAll?.length) return fromAll
  const cached = readShotParamsAllBindingImages(input.node.params)
  if (cached.length) return cached
  if (fromAll) return fromAll
  const local = readShotStoryboardFromNodeParams(input.node.params)
  const live = input.resolveShotStoryboard?.(input.node.params.boundShotId)?.storyboard
  return collectShotParamsBindingImagesFromSources(local, live)
}

/**
 * 用 live 分镜 + 可选表格绑定回写节点 params（保留本地文案字段）。
 * 绑定列表按 imageUrl 合并，避免空 Shot 覆盖表格/节点上已有绑定图。
 */
export function syncShotParamsBindingsFromShot(
  node: Pick<GraphNode, 'params'>,
  shot: Pick<Shot, 'storyboard' | 'prompt' | 'camera'>,
  overlayStoryboard?: ShotStoryboard | null
): void {
  const local = readShotStoryboardFromNodeParams(node.params)
  const live = normalizeStoryboard(shot)
  node.params = {
    ...node.params,
    ...shotStoryboardToNodeParams({
      ...local,
      characters: mergeWorldRefListsPreferImages(
        mergeWorldRefListsPreferImages(local.characters, live.characters),
        overlayStoryboard?.characters
      ),
      scenes: mergeWorldRefListsPreferImages(
        mergeWorldRefListsPreferImages(local.scenes, live.scenes),
        overlayStoryboard?.scenes
      ),
      props: mergeWorldRefListsPreferImages(
        mergeWorldRefListsPreferImages(local.props, live.props),
        overlayStoryboard?.props
      ),
      weapons: mergeWorldRefListsPreferImages(
        mergeWorldRefListsPreferImages(local.weapons, live.weapons),
        overlayStoryboard?.weapons
      )
    })
  }
}

/** 从节点 params 读取分镜参数字段；缺省为空 storyboard */
export function readShotStoryboardFromNodeParams(
  params: GraphNodeParams | undefined | null
): ShotStoryboard {
  const base = createEmptyStoryboard()
  if (!params?.shotStoryboard) return base
  return { ...base, ...params.shotStoryboard }
}

/** 将 ShotStoryboard 写入节点 params 片段 */
export function shotStoryboardToNodeParams(
  storyboard: ShotStoryboard
): Pick<GraphNodeParams, 'shotStoryboard'> {
  return { shotStoryboard: { ...createEmptyStoryboard(), ...storyboard } }
}

/** storyboard 是否仍为全空（未编辑过） */
export function isEmptyShotStoryboard(storyboard: ShotStoryboard): boolean {
  return !(
    storyboard.visualDescription.trim() ||
    storyboard.shotSize.trim() ||
    storyboard.lighting.trim() ||
    storyboard.dialogue.trim() ||
    storyboard.soundFx.trim() ||
    storyboard.cameraMove.trim() ||
    storyboard.finalPrompt.trim() ||
    storyboard.characters.length ||
    storyboard.scenes.length ||
    storyboard.props.length ||
    storyboard.weapons.length
  )
}

/** 读取节点绑定的分镜 id */
export function readBoundShotIdFromNodeParams(
  params: GraphNodeParams | undefined | null
): string | undefined {
  const id = params?.boundShotId?.trim()
  return id || undefined
}

/** 为指定分镜创建分镜参数节点（拖入分镜栏） */
export function createShotParamsNodeForShot(
  shot: Shot,
  position: { x: number; y: number },
  options?: { title?: string }
): GraphNode {
  const title = options?.title?.trim() || shot.title.trim() || 'Shot params'
  return createNodeFromType('script.shotParams', position, {
    title,
    params: {
      ...shotStoryboardToNodeParams(normalizeStoryboard(shot)),
      boundShotId: shot.id
    }
  })
}

/** 分镜参数节点在图未执行时的可读正文（与 executeShotParamsNode 输出一致） */
export function resolveShotParamsNodePrompt(
  node: Pick<GraphNode, 'typeId' | 'params'>,
  options?: { stylePreset?: string }
): string {
  if (node.typeId !== 'script.shotParams') return ''
  return buildShotGenerationPrompt(readShotStoryboardFromNodeParams(node.params), options)
}
