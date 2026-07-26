<template>
  <StudioFloatingWindow
    :open="open"
    :title="t('dialog.saveAsset.title')"
    :subtitle="t('dialog.saveAsset.subtitle')"
    :show-close="false"
    :z-index="2000"
    :default-width="400"
    :default-height="480"
    @close="onCancel"
  >
    <div class="form">
      <label class="field">
      {{ t('dialog.saveAsset.fileName') }}
      <input
        ref="nameInputEl"
        v-model="name"
        @keydown.enter.prevent="onConfirm"
        @keydown.esc.prevent="onCancel"
      />
    </label>

    <div class="field">
      <span class="field-label">{{ t('dialog.saveAsset.folder') }}</span>
      <div class="folder-tree">
        <button
          type="button"
          class="folder-row"
          :class="{ active: folderId === null }"
          @click="folderId = null"
        >
          📂 {{ t('asset.browser.assetsRoot') }}
        </button>
        <button
          v-for="row in flatFolders"
          :key="row.id"
          type="button"
          class="folder-row"
          :class="{ active: folderId === row.id }"
          :style="{ paddingLeft: `${12 + row.depth * 14}px` }"
          @click="folderId = row.id"
        >
          📁 {{ row.name }}
        </button>
      </div>
    </div>

    <p v-if="error" class="err">{{ error }}</p>
    </div>

    <template #footer>
      <button type="button" @click="onCancel">{{ t('common.cancel') }}</button>
      <button type="button" class="primary" :disabled="saving" @click="onConfirm">
        {{ saving ? t('common.saving') : t('common.save') }}
      </button>
    </template>
  </StudioFloatingWindow>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { buildFlatFolderTree } from '@shared/folderTree'
import { useProjectStore } from '../stores/project'
import { useStudioI18n } from '../composables/useStudioI18n'
import StudioFloatingWindow from './StudioFloatingWindow.vue'

const props = defineProps<{
  open: boolean
  defaultName: string
  defaultFolderId?: string | null
}>()

const emit = defineEmits<{
  confirm: [payload: { name: string; folderId: string | null }]
  cancel: []
}>()

const project = useProjectStore()
const { t } = useStudioI18n()
const name = ref('')
const folderId = ref<string | null>(null)
const error = ref('')
const saving = ref(false)
const nameInputEl = ref<HTMLInputElement | null>(null)

const flatFolders = computed(() => buildFlatFolderTree(project.folders))

watch(
  () => props.open,
  async (visible) => {
    if (!visible) return
    name.value = props.defaultName
    folderId.value = props.defaultFolderId ?? null
    error.value = ''
    saving.value = false
    await nextTick()
    nameInputEl.value?.focus()
    nameInputEl.value?.select()
  }
)

function onCancel(): void {
  if (saving.value) return
  emit('cancel')
}

function onConfirm(): void {
  if (saving.value) return
  const trimmed = name.value.trim()
  if (!trimmed) {
    error.value = t('validation.nameRequired')
    return
  }
  saving.value = true
  emit('confirm', { name: trimmed, folderId: folderId.value })
}

defineExpose({
  setSaving(value: boolean): void {
    saving.value = value
  },
  setError(message: string): void {
    error.value = message
    saving.value = false
  }
})
</script>

<style scoped>
.form {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
  color: var(--text-muted);
}

.field-label {
  font-size: 12px;
  color: var(--text-muted);
}

.folder-tree {
  border: 1px solid var(--border);
  border-radius: 6px;
  max-height: 200px;
  overflow: auto;
  background: var(--bg-panel);
}

.folder-row {
  display: block;
  width: 100%;
  text-align: left;
  border: none;
  background: transparent;
  color: var(--text);
  padding: 6px 10px;
  font-size: 12px;
  cursor: pointer;
}

.folder-row:hover,
.folder-row.active {
  background: var(--accent-18);
}

.err {
  margin: 0;
  color: var(--danger);
  font-size: 12px;
}
</style>
