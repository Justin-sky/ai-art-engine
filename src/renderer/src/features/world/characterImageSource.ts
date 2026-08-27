/**
 * 角色参考图来源：从工程内世界资产（world / subgraph）的 world.gen 节点
 * `worldElementOutputs` 收集「角色」参考图，供图片生成节点绑定角色一致性参考。
 *
 * 只做纯数据收集，不解析相对路径 URL（解析发生在生成执行侧，复用端口参考图同款解析）。
 */
import {
  characterReferenceImagesFromResults,
  worldElementOutputsFromParams,
  type CharacterReferenceImage,
  type GraphDocument,
  type WorldElementGenResult
} from '@shared/graph'
import { useProjectStore } from '../../stores/project'
import { useDraftStore } from '../../stores/drafts'

function worldAssetGraphs(): GraphDocument[] {
  const project = useProjectStore()
  const drafts = useDraftStore().drafts
  const graphs: GraphDocument[] = []
  for (const asset of project.assets) {
    if (asset.type !== 'world' && asset.type !== 'subgraph') continue
    const raw = asset.genParams?.graphJson
    if (raw && typeof raw === 'object') graphs.push(raw as GraphDocument)
  }
  for (const draft of drafts) {
    if (draft.type !== 'world' && draft.type !== 'subgraph') continue
    const raw = draft.genParams?.graphJson
    if (raw && typeof raw === 'object') graphs.push(raw as GraphDocument)
  }
  return graphs
}

/** 收集工程内所有世界资产的角色参考图（名字去重，首个命中优先） */
export function loadWorldCharacterImages(): CharacterReferenceImage[] {
  const results: WorldElementGenResult[] = []
  for (const graph of worldAssetGraphs()) {
    for (const node of graph.nodes ?? []) {
      results.push(...worldElementOutputsFromParams(node.params))
    }
  }
  return characterReferenceImagesFromResults(results)
}
