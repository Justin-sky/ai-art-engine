<template>
  <nav class="workspace-toolbar" :aria-label="t('asset.create.default')">
    <button
      v-for="item in displayItems"
      :key="item.id"
      type="button"
      class="tool-btn"
      :disabled="busyId === item.id"
      :aria-label="assetTypeLabel(item.assetType)"
      @click="onCreate(item)"
      @mouseenter="showTip($event, assetTypeLabel(item.assetType))"
      @mouseleave="hideTip"
      @focus="showTip($event, assetTypeLabel(item.assetType))"
      @blur="hideTip"
    >
      <span class="tool-icon" aria-hidden="true">{{ item.icon }}</span>
    </button>
    <Teleport to="body">
      <div v-if="activeTip" class="tool-tip-floating" :style="tipStyle">{{ activeTip }}</div>
    </Teleport>
  </nav>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import type { ResolvedWorkspaceToolbarItem } from '@shared/workspaceToolbar'
import { useAssetCreation } from '../composables/useAssetCreation'
import { useDraftSave } from '../composables/useDraftSave'
import { useStudioI18n } from '../composables/useStudioI18n'
import { listRegisteredToolbarItems } from '../editor/extensions'

const props = withDefaults(
  defineProps<{
    folderId?: string | null
    items?: ResolvedWorkspaceToolbarItem[]
    /** true：仅打开草稿，Ctrl+S 再保存；false：立即创建文件 */
    deferSave?: boolean
  }>(),
  {
    folderId: null,
    items: undefined,
    deferSave: true
  }
)

const displayItems = computed(() =>
  props.items ?? listRegisteredToolbarItems({ toolbar: true })
)

const { createAsset } = useAssetCreation()
const { createDraftAndOpen } = useDraftSave()
const { t, assetTypeLabel } = useStudioI18n()
const busyId = ref<string | null>(null)
const activeTip = ref<string | null>(null)
const tipStyle = ref<{ top: string; left: string }>({ top: '0px', left: '0px' })

function showTip(e: MouseEvent | FocusEvent, tooltip: string): void {
  const el = e.currentTarget as HTMLElement | null
  if (!el) return
  const rect = el.getBoundingClientRect()
  activeTip.value = tooltip
  tipStyle.value = {
    top: `${rect.top + rect.height / 2}px`,
    left: `${rect.right + 8}px`
  }
}

function hideTip(): void {
  activeTip.value = null
}

async function onCreate(item: ResolvedWorkspaceToolbarItem): Promise<void> {
  if (busyId.value) return
  busyId.value = item.id
  try {
    if (props.deferSave) {
      createDraftAndOpen(item.assetType)
      return
    }
    await createAsset(item.assetType, props.folderId ?? null, {
      openEditor: item.openOnCreate
    })
  } finally {
    busyId.value = null
  }
}
</script>

<style scoped>
.workspace-toolbar {
  flex-shrink: 0;
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 4px;
  padding: 8px 4px;
  border-right: 1px solid var(--border);
  background: var(--bg-elevated);
}

.tool-btn {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  margin: 0 auto;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--text);
  cursor: pointer;
}

.tool-btn:hover:not(:disabled),
.tool-btn:focus-visible:not(:disabled) {
  background: var(--bg-panel);
  border-color: var(--border);
}

.tool-btn:disabled {
  opacity: 0.55;
  cursor: wait;
}

.tool-icon {
  font-size: 18px;
  line-height: 1;
}

.tool-tip-floating {
  position: fixed;
  transform: translateY(-50%);
  padding: 4px 8px;
  border-radius: 6px;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  color: var(--text);
  font-size: 12px;
  white-space: nowrap;
  pointer-events: none;
  z-index: 10000;
  box-shadow: 0 4px 12px var(--shadow);
}
</style>
