import {
  computed,
  onBeforeUnmount,
  provide,
  reactive,
  toValue,
  watch,
  type MaybeRefOrGetter
} from 'vue'
import {
  editorDiveKey,
  editorDiveRootKey,
  isEditorDiveAssetFrame,
  type EditorDiveFrame,
  type EditorDiveKind,
  type EditorDiveViewMeta
} from '../features/graph/model/editorDive'
import { editorDiveFlush } from '../features/graph/model/editorDiveFlush'
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
    return { diving, diveTop, diveRootKey, diveFrames, diveContext: null }
  }

  async function flushTop(): Promise<void> {
    const top = diveTop.value
    if (!top) return
    await editorDiveFlush.flush(top.key)
    if (isEditorDiveAssetFrame(top)) {
      try {
        await graphEditorHosts.flush(`asset:${top.assetId}`)
      } catch (err) {
        console.error('[EditorDive] asset flush failed', err)
      }
    }
  }

  async function diveAsset(assetId: string): Promise<boolean> {
    await flushTop()
    return workspace.diveIntoAsset(diveRootKey.value, assetId)
  }

  async function diveView(meta: EditorDiveViewMeta, title?: string): Promise<boolean> {
    await flushTop()
    return workspace.diveIntoView(diveRootKey.value, meta, title)
  }

  const diveContext = reactive({
    rootKey: diveRootKey.value,
    rootTitle: toValue(options.rootTitle),
    frames: [] as EditorDiveFrame[],
    diveAsset: (assetId: string) => diveAsset(assetId),
    diveView: (meta: EditorDiveViewMeta, title?: string) => diveView(meta, title),
    popTo: (index: number) => {
      void (async () => {
        await flushTop()
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

  watch(
    diveRootKey,
    (key) => {
      workspace.setActiveDiveRootKey(key)
    },
    { immediate: true }
  )

  onBeforeUnmount(() => {
    if (workspace.activeDiveRootKey === diveRootKey.value) {
      workspace.setActiveDiveRootKey(null)
    }
    workspace.diveClear(diveRootKey.value)
  })

  return { diving, diveTop, diveRootKey, diveFrames, diveContext }
}
