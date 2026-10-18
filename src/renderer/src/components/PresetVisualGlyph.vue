<template>
  <div
    class="glyph"
    :data-kind="visual.kind"
    :data-preset-id="presetId || undefined"
    aria-hidden="true"
  >
    <!-- eslint-disable-next-line vue/no-v-html -->
    <div class="schematic-wrap" v-html="schematicSvg" />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { PresetVisual } from '@shared/graph'
import { buildPresetSchematicSvg } from '../features/graph/presetSchematicSvg'

const props = defineProps<{
  visual: PresetVisual
  presetId?: string | null
  presetKind?: string | null
}>()

const schematicSvg = computed(() =>
  buildPresetSchematicSvg({
    visual: props.visual,
    presetId: props.presetId,
    presetKind: props.presetKind
  })
)
</script>

<style scoped>
.glyph {
  width: 100%;
  height: 100%;
  min-height: 44px;
  display: grid;
  place-items: center;
  border-radius: 6px;
  background: color-mix(in srgb, var(--bg-input) 70%, var(--bg-elevated));
  border: 1px solid var(--border);
  overflow: hidden;
  position: relative;
  color: var(--text-muted);
}

.schematic-wrap {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2px 4px;
  box-sizing: border-box;
}

.schematic-wrap :deep(.schematic-svg) {
  width: 100%;
  height: 100%;
  max-width: 116px;
  max-height: 44px;
  display: block;
}
</style>
