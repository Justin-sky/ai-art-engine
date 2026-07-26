<template>
  <div class="view-gizmo" @pointerdown.stop>
    <div class="dial" role="group" :aria-label="t('director.stage.viewOrientation')">
      <svg class="dial-svg" viewBox="0 0 100 100" aria-hidden="true">
        <circle cx="50" cy="50" r="46" class="dial-bg" />
        <line
          v-for="axis in axes"
          :key="`line-${axis.id}`"
          :x1="50"
          :y1="50"
          :x2="axis.x"
          :y2="axis.y"
          class="axis-line"
          :style="{ stroke: axis.lineColor }"
        />
      </svg>
      <button
        v-for="axis in axes"
        :key="axis.id"
        type="button"
        class="axis-dot"
        :class="[`axis-${axis.id}`, { active: axis.active }]"
        :style="{
          left: `${axis.x}%`,
          top: `${axis.y}%`,
          background: axis.dotColor
        }"
        :title="axis.title"
        @click="emit('set-orientation', axis.id)"
      />
      <button
        type="button"
        class="axis-dot center"
        :title="t('director.stage.viewFront')"
        @click="emit('set-orientation', 'z')"
      />
    </div>
    <button type="button" class="reset-btn" @click="emit('reset-view')">
      {{ t('director.stage.resetView') }}
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useStudioI18n } from '../composables/useStudioI18n'
import { themePreference } from '../editor/preferences'

export type ViewOrientationAxis = 'x' | '-x' | 'y' | '-y' | 'z' | '-z'

const emit = defineEmits<{
  'set-orientation': [axis: ViewOrientationAxis]
  'reset-view': []
}>()

const { t } = useStudioI18n()

/** 上 Y+、右 X+、下 Y-、左 X-；负轴用同色系弱化，避免灰点混同 */
const axes = computed(() => {
  const light = themePreference.value === 'light'
  return [
    {
      id: 'y' as const,
      x: 50,
      y: 14,
      active: true,
      dotColor: '#3ddc97',
      lineColor: 'rgba(61, 220, 151, 0.55)',
      title: t('director.stage.viewTop')
    },
    {
      id: 'x' as const,
      x: 86,
      y: 50,
      active: true,
      dotColor: '#e25555',
      lineColor: 'rgba(226, 85, 85, 0.55)',
      title: t('director.stage.viewRight')
    },
    {
      id: '-y' as const,
      x: 50,
      y: 86,
      active: false,
      dotColor: light ? '#7bc9a4' : '#2a6b52',
      lineColor: light ? 'rgba(61, 220, 151, 0.4)' : 'rgba(61, 220, 151, 0.28)',
      title: t('director.stage.viewBottom')
    },
    {
      id: '-x' as const,
      x: 14,
      y: 50,
      active: false,
      dotColor: light ? '#d08888' : '#6b3030',
      lineColor: light ? 'rgba(226, 85, 85, 0.4)' : 'rgba(226, 85, 85, 0.28)',
      title: t('director.stage.viewLeft')
    }
  ]
})
</script>

<style scoped>
.view-gizmo {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 5;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  pointer-events: auto;
}

.dial {
  position: relative;
  width: 84px;
  height: 84px;
}

.dial-svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: visible;
}

.dial-bg {
  fill: var(--panel-glass);
  stroke: var(--border);
  stroke-width: 1;
}

.axis-line {
  stroke-width: 1.5;
  stroke-linecap: round;
}

.axis-dot {
  position: absolute;
  width: 12px;
  height: 12px;
  margin: 0;
  padding: 0;
  border: none;
  border-radius: 50%;
  transform: translate(-50%, -50%);
  cursor: pointer;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.35);
}

.axis-dot:hover {
  filter: brightness(1.15);
  transform: translate(-50%, -50%) scale(1.12);
}

.axis-dot.center {
  left: 50%;
  top: 50%;
  width: 11px;
  height: 11px;
  background: var(--accent);
}

.reset-btn {
  padding: 4px 10px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--panel-glass);
  color: var(--text);
  font-size: 11px;
  cursor: pointer;
  white-space: nowrap;
}

.reset-btn:hover {
  background: var(--bg-hover);
}
</style>
