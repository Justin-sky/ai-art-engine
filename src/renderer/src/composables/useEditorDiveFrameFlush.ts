import { onBeforeUnmount, watch, type MaybeRefOrGetter, toValue } from 'vue'
import { editorDiveFlush } from '../features/graph/model/editorDiveFlush'

/** 按帧 key 注册 flush，离开/回退前由 useEditorDiveHost 调用 */
export function useEditorDiveFrameFlush(
  frameKey: MaybeRefOrGetter<string>,
  flush: () => void | Promise<void>
): void {
  let unregister: (() => void) | null = null

  watch(
    () => toValue(frameKey),
    (key) => {
      unregister?.()
      unregister = null
      if (!key) return
      unregister = editorDiveFlush.register(key, { flush })
    },
    { immediate: true }
  )

  onBeforeUnmount(() => {
    unregister?.()
    unregister = null
  })
}
