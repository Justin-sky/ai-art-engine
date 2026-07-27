import { computed, onBeforeUnmount, provide, reactive, toValue, watch, type MaybeRefOrGetter } from 'vue'
import {
  editorDiveKey,
  editorDiveRootKey,
  type EditorDiveFrame,
  type EditorDiveKind
} from '../features/graph/model/editorDive'
import { graphEditorHosts } from '../features/graph/model/graphEditorHosts'
import { useWorkspaceStore } from '../stores/workspace'

/**
 * 主画布作为 dive 根：provide 上下文，返回 diving / diveTop。
 * embedded 子层传 enabled=false，继承外层 dive。
 */
export function useEditorDiveHost(options: {
  kind: MaybeRefOrGetter<EditorDiveKind>
  assetId: MaybeRefOrGetter<string>
  rootTitle: MaybeRefOrGetter<string>
  enabled?: MaybeRefOrGetter<boolean>
}) {
  const workspace = useWorkspaceStore()
  const enabled = toValue(options.enabled) !== false
  const diveRootKey = computed(() =>
    editorDiveRootKey(toValue(options.kind), toValue(options.assetId))
  )
  const diveFrames = computed(() => (enabled ? workspace.diveStack(diveRootKey.value) : []))
  const diving = computed(() => diveFrames.value.length > 0)
  const diveTop = computed(() => diveFrames.value[diveFrames.value.length - 1] ?? null)

  if (!enabled) {
    return { diving, diveTop }
  }

  async function flushDiveTop(): Promise<void> {
    const top = diveTop.value
    if (!top) return
    try {
      await graphEditorHosts.flush(`asset:${top.assetId}`)
    } catch (err) {
      console.error('[EditorDive] flush failed', err)
    }
  }

  const diveContext = reactive({
    rootKey: diveRootKey.value,
    rootTitle: toValue(options.rootTitle),
    frames: [] as EditorDiveFrame[],
    popTo: (index: number) => {
      void (async () => {
        await flushDiveTop()
        workspace.divePopTo(diveRootKey.value, index)
      })()
    }
  })

  watch(diveRootKey, (key) => {
    diveContext.rootKey = key
  })
  watch(
    () => toValue(options.rootTitle),
    (title) => {
      diveContext.rootTitle = title
    },
    { immediate: true }
  )
  watch(
    diveFrames,
    (frames) => {
      diveContext.frames = frames
    },
    { immediate: true }
  )
  provide(editorDiveKey, diveContext)

  onBeforeUnmount(() => {
    workspace.diveClear(diveRootKey.value)
  })

  return { diving, diveTop }
}
