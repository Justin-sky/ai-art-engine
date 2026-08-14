<script setup lang="ts">
/**
 * 媒体播放控件风格图标，用于节点图执行工具栏。
 * play / replay / forward(跳过已执行) / rewind(强制重跑上游) / queue / stop / cook(宿主内图)
 */
withDefaults(
  defineProps<{
    kind: 'play' | 'replay' | 'forward' | 'rewind' | 'queue' | 'stop' | 'cook'
    size?: number | string
  }>(),
  {
    size: 16
  }
)
</script>

<template>
  <svg
    class="media-run-icon"
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    :width="size"
    :height="size"
    fill="currentColor"
    aria-hidden="true"
    focusable="false"
  >
    <!-- 停止 -->
    <rect
      v-if="kind === 'stop'"
      x="7"
      y="7"
      width="10"
      height="10"
      rx="1.5"
    />

    <!-- 播放：执行当前 -->
    <path
      v-else-if="kind === 'play'"
      d="M8 5.5v13l11-6.5z"
    />

    <!-- 重播：重新执行当前（标准环形重播箭头） -->
    <path
      v-else-if="kind === 'replay'"
      d="M12 6V2.5L7.5 7 12 11.5V8c2.76 0 5 2.24 5 5s-2.24 5-5 5-5-2.24-5-5H4.5c0 4.14 3.36 7.5 7.5 7.5s7.5-3.36 7.5-7.5S16.14 6 12 6z"
    />

    <!-- 快进：执行当前及上游（跳过已执行） -->
    <path
      v-else-if="kind === 'forward'"
      d="M4 6v12l8-6zm8 0v12l8-6z"
    />

    <!-- 快退：重新执行当前及上游 -->
    <path
      v-else-if="kind === 'rewind'"
      d="M20 6v12l-8-6zm-8 0v12L4 12z"
    />

    <!-- 播放列表：输出节点加入任务队列 -->
    <g v-else-if="kind === 'queue'">
      <path
        d="M3.5 6.5h10M3.5 12h10M3.5 17.5h6"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
      />
      <path d="M15 9.5v9l7.5-4.5z" />
    </g>

    <!-- 层叠：Cook 宿主子图 -->
    <g v-else-if="kind === 'cook'">
      <rect
        x="5"
        y="9"
        width="12"
        height="9"
        rx="1.5"
        opacity="0.45"
      />
      <rect
        x="7"
        y="6"
        width="12"
        height="9"
        rx="1.5"
      />
    </g>
  </svg>
</template>

<style scoped>
.media-run-icon {
  display: block;
  flex-shrink: 0;
  overflow: visible;
}
</style>
