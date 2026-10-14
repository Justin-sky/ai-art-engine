<template>
  <div class="si-actions">
    <button v-if="!confirming" type="button" class="si-btn danger" @click="confirming = true">
      {{ label }}
    </button>
    <div v-else class="si-confirm" role="alertdialog" :aria-label="label">
      <p v-for="(line, i) in details" :key="i" class="si-note">{{ line }}</p>
      <div class="si-confirm-row">
        <button ref="confirmRef" type="button" class="si-btn danger" @click="confirm">
          {{ t('graph.semanticInspector.confirmDelete') }}
        </button>
        <button type="button" class="si-btn" @click="confirming = false">
          {{ t('graph.semanticInspector.cancel') }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { useStudioI18n } from '../../composables/useStudioI18n'

/**
 * 两步删除：先点删除，就地展开后果说明（会级联删掉什么、哪些镜头会重新生成），再确认。
 * 不用 window.confirm —— 后果要写清楚，原生弹窗排版不了，也打断键盘流。
 */
const props = defineProps<{
  label: string
  details: string[]
  /** 外部（Delete 快捷键）请求进入确认态 */
  armed?: number
}>()
const emit = defineEmits<{ confirm: [] }>()
const { t } = useStudioI18n()

const confirming = ref(false)
const confirmRef = ref<HTMLButtonElement | null>(null)

watch(
  () => props.armed,
  (value) => {
    if (value) confirming.value = true
  }
)
watch(confirming, (on) => {
  if (on) void nextTick(() => confirmRef.value?.focus())
})

function confirm(): void {
  confirming.value = false
  emit('confirm')
}
</script>
