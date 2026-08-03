<template>
  <div class="beat-unit-strip">
    <div class="strip-toolbar">
      <span>{{ t('beat.strip.title') }}</span>
      <span class="strip-hint">{{ t('beat.strip.switchHint') }}</span>
      <span class="strip-count">{{ units.length }}</span>
    </div>
    <div class="strip">
      <div
        v-for="(unit, index) in units"
        :key="unit.id"
        class="unit-card"
        :class="{ active: unit.id === workspace.activeBeatId }"
        role="button"
        tabindex="0"
        draggable="true"
        @click="selectUnit(unit.id)"
        @keydown.enter="selectUnit(unit.id)"
        @dragstart="onUnitDragStart($event, unit)"
      >
        <div class="thumb">
          <span class="thumb-placeholder">{{ index + 1 }}</span>
        </div>
        <div class="meta">
          <div class="title">#{{ unit.order }} {{ unit.title || t('beat.table.unit') }}</div>
          <div class="status" :data-status="unit.status">{{ unit.status }}</div>
        </div>
      </div>
      <p v-if="!units.length" class="strip-empty">{{ t('beat.strip.empty') }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import type { BeatRow } from '@shared/graph'
import { useStudioI18n } from '../composables/useStudioI18n'
import { loadBeatCatalog } from '../features/beat/applyBeatCatalogOnOpen'
import {
  useWorkspaceStore,
  STUDIO_BEAT_UNIT_DRAG_MIME,
  STUDIO_BEAT_UNIT_ID_DRAG_MIME
} from '../stores/workspace'
import { useProjectStore } from '../stores/project'
import { useDraftStore } from '../stores/drafts'

const props = defineProps<{
  beatAssetId: string
}>()

const { t } = useStudioI18n()
const workspace = useWorkspaceStore()
const project = useProjectStore()
const draftStore = useDraftStore()
const { assets } = storeToRefs(project)
const { drafts } = storeToRefs(draftStore)
const units = ref<BeatRow[]>([])

function reload(): void {
  const rows = loadBeatCatalog(props.beatAssetId)
  units.value = [...rows].sort((a, b) => a.order - b.order || a.title.localeCompare(b.title))
  if (!units.value.length) {
    // 目录短暂为空时不要清空选中，否则会拆掉正在运行的单元图（运行卡死）
    return
  }
  const current = workspace.activeBeatId
  if (!(current && units.value.some((u) => u.id === current))) {
    workspace.selectBeatUnit(units.value[0].id, props.beatAssetId)
  }
}

function selectUnit(id: string): void {
  workspace.selectBeatUnit(id, props.beatAssetId)
  workspace.focusBeatUnit()
}

function onUnitDragStart(e: DragEvent, unit: BeatRow): void {
  if (!e.dataTransfer) return
  e.dataTransfer.effectAllowed = 'copy'
  e.dataTransfer.setData(STUDIO_BEAT_UNIT_ID_DRAG_MIME, unit.id)
  e.dataTransfer.setData(
    STUDIO_BEAT_UNIT_DRAG_MIME,
    JSON.stringify({
      id: unit.id,
      title: unit.title,
      beatAssetId: props.beatAssetId
    })
  )
}

onMounted(reload)
watch(() => props.beatAssetId, reload)
watch([assets, drafts], reload, { deep: false })

defineExpose({ reload })
</script>

<style scoped>
.beat-unit-strip {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--bg-elevated);
}

.strip-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 10px;
  font-size: 12px;
  color: var(--text-muted);
  flex-shrink: 0;
}

.strip-hint {
  flex: 1;
  min-width: 0;
  font-size: 11px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.strip-count {
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
}

.strip {
  display: flex;
  gap: 8px;
  padding: 6px 10px 10px;
  overflow-x: auto;
  overflow-y: hidden;
  flex: 1;
  min-height: 0;
  align-items: stretch;
}

.unit-card {
  flex: none;
  width: 148px;
  display: flex;
  gap: 8px;
  padding: 6px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-panel);
  cursor: pointer;
  user-select: none;
}

.unit-card.active {
  border-color: var(--accent);
}

.thumb {
  width: 36px;
  height: 36px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--bg-elevated) 70%, var(--border));
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.thumb-placeholder {
  font-size: 12px;
  color: var(--text-muted);
}

.meta {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.title {
  font-size: 12px;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.status {
  font-size: 11px;
  color: var(--text-muted);
}

.strip-empty {
  margin: 0;
  font-size: 12px;
  color: var(--text-muted);
  align-self: center;
}
</style>
