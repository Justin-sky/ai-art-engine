<template>
  <div class="model3d-rig-controls">
    <select
      class="model3d-rig-select"
      :value="rigType"
      :title="t('graph.inspector.generate.model3dRigType')"
      :aria-label="t('graph.inspector.generate.model3dRigType')"
      @change="onRigTypeChange"
    >
      <option v-for="opt in rigTypeOptions" :key="opt.value" :value="opt.value">
        {{ opt.value === rigType ? '✓ ' : '' }}{{ opt.label }}
      </option>
    </select>
    <select
      v-if="showTripoOptions"
      class="model3d-rig-select"
      :value="spec"
      :title="t('graph.inspector.generate.model3dRigSpecHint')"
      :aria-label="t('graph.inspector.generate.model3dRigSpecHint')"
      @change="onSpecChange"
    >
      <option v-for="opt in specOptions" :key="opt.value" :value="opt.value">
        {{ opt.value === spec ? '✓ ' : '' }}{{ opt.label }}
      </option>
    </select>
    <select
      v-if="showTripoOptions"
      class="model3d-rig-select"
      :value="outFormat"
      :title="t('graph.inspector.generate.model3dRigOutFormatHint')"
      :aria-label="t('graph.inspector.generate.model3dRigOutFormatHint')"
      @change="onOutFormatChange"
    >
      <option v-for="opt in outFormatOptions" :key="opt.value" :value="opt.value">
        {{ opt.value === outFormat ? '✓ ' : '' }}{{ opt.label }}
      </option>
    </select>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useStudioI18n } from '../composables/useStudioI18n'

const props = defineProps<{
  rigType: string
  /** 骨架命名规范（Tripo 专用）；缺省 mixamo */
  spec?: string
  /** 输出格式（Tripo 专用）；缺省 glb */
  outFormat?: string
  /** 当前所选供应商：只有 Tripo 认 spec / out_format */
  providerKind?: string
}>()

const emit = defineEmits<{
  'update:rigType': [value: string]
  'update:spec': [value: string]
  'update:outFormat': [value: string]
}>()

const { t } = useStudioI18n()

/** spec / out_format 是 Tripo 独有参数，选 Meshy 时隐藏，避免给出无效选项 */
const showTripoOptions = computed(() => props.providerKind !== 'meshy')

const rigTypeOptions = computed(() =>
  [
    ['humanoid', 'graph.inspector.generate.model3dRigTypes.humanoid'],
    ['quadruped', 'graph.inspector.generate.model3dRigTypes.quadruped'],
    ['bipedal', 'graph.inspector.generate.model3dRigTypes.bipedal'],
    ['creature', 'graph.inspector.generate.model3dRigTypes.creature']
  ].map(([value, key]) => ({ value, label: t(key) }))
)

const specOptions = computed(() =>
  [
    ['mixamo', 'graph.inspector.generate.model3dRigSpecs.mixamo'],
    ['tripo', 'graph.inspector.generate.model3dRigSpecs.tripo']
  ].map(([value, key]) => ({ value, label: t(key) }))
)

const outFormatOptions = computed(() =>
  [
    ['glb', 'graph.inspector.generate.model3dRigOutFormats.glb'],
    ['fbx', 'graph.inspector.generate.model3dRigOutFormats.fbx']
  ].map(([value, key]) => ({ value, label: t(key) }))
)

function onRigTypeChange(event: Event): void {
  emit('update:rigType', (event.target as HTMLSelectElement).value)
}

function onSpecChange(event: Event): void {
  emit('update:spec', (event.target as HTMLSelectElement).value)
}

function onOutFormatChange(event: Event): void {
  emit('update:outFormat', (event.target as HTMLSelectElement).value)
}
</script>

<style scoped>
.model3d-rig-controls {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: none;
}

.model3d-rig-select {
  flex: none;
  max-width: 132px;
  height: 26px;
  padding: 0 6px;
  border-radius: 6px;
  border: 1px solid color-mix(in srgb, var(--border) 80%, transparent);
  background: color-mix(in srgb, var(--panel) 88%, transparent);
  color: var(--text);
  font-size: 11px;
}
</style>
