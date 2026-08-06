import { computed, type ComputedRef } from 'vue'
import { resolveNodeType } from '@shared/graph'
import { useEditorKernel } from '../editor/kernel'
import { useProjectStore } from '../stores/project'
import { useWorkspaceStore } from '../stores/workspace'
import { graphEditorHosts } from '../features/graph/model/graphEditorHosts'
import { loadBeatCatalog } from '../features/beat/applyBeatCatalogOnOpen'
import type { InspectorTarget } from './types'

/**
 * 集中解析选择状态。舞台目标（stage.*）与资产/图节点共用同一管线，
 * 宿主只需挂 InspectorPanel，不必再写 v-if。
 */
export function useInspectorTarget(): ComputedRef<InspectorTarget> {
  const project = useProjectStore()
  const workspace = useWorkspaceStore()
  const editor = useEditorKernel()

  return computed(() => {
    const selection = editor.selection.current.value

    if (selection.kind === 'asset') {
      const asset = workspace.selectedAsset
      return {
        kind: 'asset',
        key: selection.key,
        subject: asset
      }
    }

    if (selection.kind === 'asset.multi') {
      return {
        kind: 'asset.multi',
        key: selection.key,
        subject: null,
        meta: selection.meta
      }
    }

    if (selection.kind === 'stage.object') {
      return {
        kind: 'stage.object',
        key: selection.key,
        subject: selection.id ? { id: selection.id } : null,
        meta: { stageObjectId: selection.id }
      }
    }

    if (selection.kind === 'stage.camera') {
      return {
        kind: 'stage.camera',
        key: selection.key,
        subject: selection.id ? { id: selection.id } : null,
        meta: { stageCameraId: selection.id }
      }
    }

    if (selection.kind === 'stage.scene') {
      return {
        kind: 'stage.scene',
        key: selection.key,
        subject: { id: 'scene' }
      }
    }

    if (selection.kind === 'stage.panorama') {
      return {
        kind: 'stage.panorama',
        key: selection.key,
        subject: { id: selection.id ?? 'panorama' }
      }
    }

    if (selection.kind === 'none') {
      return {
        kind: 'none',
        key: selection.key,
        subject: null
      }
    }

    if (selection.kind === 'project') {
      return {
        kind: 'project',
        key: selection.key,
        subject: project.config
      }
    }

    const nodeId = selection.kind === 'graph.node' ? selection.id ?? null : null
    const node = nodeId
      ? graphEditorHosts.getNode(selection.hostId, nodeId)
      : null
    if (node) {
      return {
        kind: 'graph.node',
        key: selection.key,
        subject: node,
        graphNodeType: resolveNodeType(node)
      }
    }

    if (selection.kind === 'graph.group') {
      const groupId = selection.id ?? null
      const group = groupId
        ? graphEditorHosts.getGroup(selection.hostId, groupId)
        : null
      if (group) {
        const memberCount = graphEditorHosts.getGroupMemberIds(selection.hostId, groupId!).length
        return {
          kind: 'graph.group',
          key: selection.key,
          subject: group,
          memberCount
        }
      }
    }

    if (selection.kind === 'beatUnit') {
      const beatId = selection.id ?? workspace.activeBeatId
      const assetId = workspace.activeBeatAssetId
      const unit =
        beatId && assetId
          ? loadBeatCatalog(assetId).find((row) => row.id === beatId) ?? null
          : null
      return {
        kind: 'beatUnit',
        key: beatId ? `beatUnit:${beatId}` : 'beatUnit:none',
        subject: unit,
        meta: assetId ? { beatAssetId: assetId } : undefined
      }
    }

    // 未知 / 失效的图选中：不回退到分镜，交给空态
    return {
      kind: 'none',
      key: 'none',
      subject: null
    }
  })
}
