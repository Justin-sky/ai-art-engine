/**
 * 解析图节点当前生效的 3D 供应商 kind。
 *
 * Inspector 需要它来决定「哪些参数属于当前供应商」：节点参数里可能还没写
 * `generateProviderInstanceId`（用户没手动选过），此时与卡片同口径——按
 * `loadGenerateModelOptions` 的默认选中项取 kind，避免面板显示一堆对面不识的参数。
 */
import { ref, watch, type ComputedRef, type Ref } from 'vue'
import type { GraphNode } from '@shared/graph'
import { loadGenerateModelOptions, preferredModelKey } from './generateModelOptions'

export function useMeshOpsNodeProviderKind(node: ComputedRef<GraphNode | null>): {
  providerKind: Ref<string>
} {
  const providerKind = ref('')
  let token = 0

  watch(
    () => {
      const current = node.value
      if (!current) return ''
      return `${current.id}:${current.params.generateProviderInstanceId ?? ''}:${
        current.params.generateModel ?? ''
      }`
    },
    async (key) => {
      const current = node.value
      if (!key || !current) {
        providerKind.value = ''
        return
      }
      const seq = ++token
      const preferred = preferredModelKey(
        current.params.generateProviderInstanceId,
        current.params.generateModel
      )
      const { options, selectedKey } = await loadGenerateModelOptions('model3d', preferred, '')
      if (seq !== token) return
      const hit = options.find((item) => item.key === selectedKey)
      providerKind.value = hit?.providerKind ?? ''
    },
    { immediate: true }
  )

  return { providerKind }
}
