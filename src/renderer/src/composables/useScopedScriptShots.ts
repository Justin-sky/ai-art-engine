import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import { storeToRefs } from 'pinia'
import { isDraftAssetId, shotScriptAssetId } from '@shared/domain'
import { useDraftStore } from '../stores/drafts'
import { useProjectStore } from '../stores/project'

export function useScopedScriptShots(scriptAssetId: MaybeRefOrGetter<string | undefined>) {
  const project = useProjectStore()
  const { drafts } = storeToRefs(useDraftStore())

  const visibleShots = computed(() => {
    const id = toValue(scriptAssetId)
    if (id && isDraftAssetId(id)) {
      const draft = drafts.value.find((d) => d.id === id)
      return draft?.shots ?? []
    }
    if (id) {
      return project.shots.filter((s) => shotScriptAssetId(s) === id)
    }
    return project.shots.filter((s) => !shotScriptAssetId(s))
  })

  const activeShotIndex = computed(() => {
    const idx = visibleShots.value.findIndex((s) => s.id === project.activeShotId)
    return idx >= 0 ? idx : 0
  })

  return { visibleShots, activeShotIndex }
}
