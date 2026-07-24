import type { InjectionKey, Ref } from 'vue'

export type GraphPreviewVisibility = {
  /** 视口内（含 margin）应加载预览的节点 */
  visibleNodeIds: Ref<ReadonlySet<string>>
  revision: Ref<number>
}

export const graphPreviewVisibilityKey: InjectionKey<GraphPreviewVisibility> =
  Symbol('graphPreviewVisibility')
