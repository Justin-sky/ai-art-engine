import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { BlenderDshLivePhase } from '@shared/blenderDshLive'

export const useBlenderDshLiveStore = defineStore('blenderDshLive', () => {
  const byNodeId = ref<Record<string, BlenderDshLivePhase>>({})

  function set(nodeId: string, phase: BlenderDshLivePhase): void {
    const id = nodeId.trim()
    if (!id) return
    byNodeId.value = { ...byNodeId.value, [id]: phase }
  }

  function clear(nodeId: string): void {
    const id = nodeId.trim()
    if (!id || !byNodeId.value[id]) return
    const next = { ...byNodeId.value }
    delete next[id]
    byNodeId.value = next
  }

  function phaseOf(nodeId: string | undefined | null): BlenderDshLivePhase | null {
    const id = nodeId?.trim()
    if (!id) return null
    return byNodeId.value[id] ?? null
  }

  function livePhase(nodeId: () => string | undefined | null) {
    return computed(() => phaseOf(nodeId()))
  }

  return { byNodeId, set, clear, phaseOf, livePhase }
})
