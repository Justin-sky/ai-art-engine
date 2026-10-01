<script setup lang="ts">
import { useStudioI18n } from '../composables/useStudioI18n'

/**
 * 对话流里的「复制这条消息」图标按钮。
 *
 * 三处消息类型（用户气泡、助手气泡、状态行）共用同一套图标与反馈，
 * 所以抽成组件，避免三份重复标记各自漂移。
 * 只负责「长什么样 + 反馈态」，要复制什么由使用方的 copy 事件决定；
 * 位置由使用方的容器决定（气泡右上角 / 状态行右上角）。
 */
defineProps<{
  /** 当前是否处于「已复制」反馈态 */
  copied: boolean
}>()

const emit = defineEmits<{ copy: [] }>()

const { t } = useStudioI18n()
</script>

<template>
  <button
    type="button"
    class="bubble-action"
    :class="{ done: copied }"
    :title="copied ? t('studio.chat.copied') : t('studio.chat.copyTitle')"
    @click.stop="emit('copy')"
  >
    <svg
      viewBox="0 0 16 16"
      width="13"
      height="13"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <rect x="6" y="6" width="8" height="8" rx="1.5" />
      <path d="M10 4 H3.5 A1.5 1.5 0 0 0 2 5.5 V12" />
    </svg>
  </button>
</template>
