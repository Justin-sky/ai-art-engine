<template>
  <StudioFloatingWindow
    :open="open"
    :title="t('studio.layout.saveTitle')"
    :subtitle="t('studio.layout.saveHint')"
    :show-close="false"
    :z-index="300"
    :default-width="360"
    :default-height="240"
    @close="onCancel"
  >
    <label class="field">
      {{ t('studio.layout.name') }}
      <input
        ref="nameInputEl"
        v-model="name"
        :placeholder="t('studio.layout.namePlaceholder')"
        @keydown.enter.prevent="onConfirm"
        @keydown.esc.prevent="onCancel"
      >
    </label>

    <p
      v-if="error"
      class="err"
    >
      {{ error }}
    </p>

    <template #footer>
      <button
        type="button"
        @click="onCancel"
      >
        {{ t('common.cancel') }}
      </button>
      <button
        type="button"
        class="primary"
        @click="onConfirm"
      >
        {{ t('common.save') }}
      </button>
    </template>
  </StudioFloatingWindow>
</template>

<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { useStudioI18n } from '../composables/useStudioI18n'
import StudioFloatingWindow from './StudioFloatingWindow.vue'

const props = defineProps<{
  open: boolean
  defaultName: string
}>()

const emit = defineEmits<{
  confirm: [name: string]
  cancel: []
}>()

const { t } = useStudioI18n()
const name = ref('')
const error = ref('')
const nameInputEl = ref<HTMLInputElement | null>(null)

watch(
  () => props.open,
  async (visible) => {
    if (!visible) return
    name.value = props.defaultName
    error.value = ''
    await nextTick()
    nameInputEl.value?.focus()
    nameInputEl.value?.select()
  }
)

function onCancel(): void {
  emit('cancel')
}

function onConfirm(): void {
  const trimmed = name.value.trim()
  if (!trimmed) {
    error.value = t('validation.nameRequired')
    return
  }
  emit('confirm', trimmed)
}
</script>

<style scoped>
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  color: var(--text-muted);
  font-size: 12px;
}

.field input {
  width: 100%;
}

.err {
  margin: 0;
  color: var(--danger);
  font-size: 12px;
}
</style>
