<template>
  <div class="glyph" :data-kind="visual.kind" aria-hidden="true">
    <div
      v-if="visual.kind === 'grid' && visual.grid"
      class="grid"
      :style="gridStyle"
    >
      <span v-for="n in gridCells" :key="n" class="grid-cell" />
    </div>

    <div v-else-if="visual.kind === 'chips' && visual.chips?.length" class="chips">
      <span v-for="(chip, i) in visual.chips.slice(0, 4)" :key="i" class="chip">
        {{ chipLabel(chip) }}
      </span>
    </div>

    <div
      v-else-if="visual.kind === 'shotSize'"
      class="shot-size"
      :data-size="visual.shotSize || 'medium'"
    >
      <span class="frame outer" />
      <span class="frame subject" />
      <span v-if="visual.camera" class="cam-hint" />
    </div>

    <div v-else-if="visual.kind === 'camera'" class="camera" :data-cam="visual.camera || 'dolly'">
      <span class="cam-box" />
      <span class="cam-arrow" />
    </div>

    <div v-else-if="visual.kind === 'facing'" class="facing" :data-facing="visual.facing || 'front'">
      <span class="head" />
      <span class="body" />
    </div>

    <div
      v-else-if="visual.kind === 'lighting'"
      class="lighting"
      :data-light="visual.lighting || 'side'"
    >
      <span class="face" />
      <span class="beam" />
    </div>

    <div v-else-if="visual.kind === 'mood'" class="mood" :data-mood="visual.mood || 'confidence'">
      <span class="face-circle" />
      <span class="brow" />
      <span class="mouth" />
    </div>

    <div v-else class="icon-fallback">
      {{ visual.icon || '✦' }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { PresetVisual } from '@shared/graph'
import { useStudioI18n } from '../composables/useStudioI18n'

const props = defineProps<{
  visual: PresetVisual
}>()

const { t, te } = useStudioI18n()

const gridCells = computed(() => {
  const g = props.visual.grid
  if (!g) return 0
  return Math.min(25, Math.max(1, g.cols * g.rows))
})

const gridStyle = computed(() => {
  const cols = props.visual.grid?.cols ?? 3
  return {
    gridTemplateColumns: `repeat(${cols}, 1fr)`
  }
})

function chipLabel(chip: string): string {
  if (chip.includes('.') && te(chip)) return t(chip)
  return chip
}
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

.grid {
  display: grid;
  gap: 2px;
  width: 70%;
  height: 70%;
}

.grid-cell {
  background: color-mix(in srgb, var(--text) 12%, transparent);
  border-radius: 1px;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
  justify-content: center;
  padding: 4px;
  max-width: 92%;
}

.chip {
  font-size: 9px;
  line-height: 1;
  padding: 3px 5px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent) 16%, transparent);
  color: var(--text);
  border: 1px solid color-mix(in srgb, var(--accent) 35%, var(--border));
}

.shot-size {
  position: relative;
  width: 72%;
  height: 62%;
}

.frame {
  position: absolute;
  border: 1.5px solid color-mix(in srgb, var(--text) 45%, transparent);
  border-radius: 2px;
  box-sizing: border-box;
}

.frame.outer {
  inset: 0;
  opacity: 0.45;
}

.frame.subject {
  background: color-mix(in srgb, var(--accent) 22%, transparent);
  border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
}

.shot-size[data-size='extremeWide'] .subject {
  inset: 28% 8%;
}
.shot-size[data-size='wide'] .subject {
  inset: 22% 12%;
}
.shot-size[data-size='full'] .subject {
  inset: 14% 18%;
}
.shot-size[data-size='medium'] .subject {
  inset: 18% 26%;
}
.shot-size[data-size='mediumClose'] .subject {
  inset: 16% 30%;
}
.shot-size[data-size='close'] .subject {
  inset: 20% 34%;
}
.shot-size[data-size='extremeClose'] .subject {
  inset: 28% 38%;
}

.cam-hint {
  position: absolute;
  right: -2px;
  bottom: -2px;
  width: 10px;
  height: 10px;
  border-right: 2px solid var(--accent);
  border-bottom: 2px solid var(--accent);
  transform: rotate(-45deg);
  opacity: 0.85;
}

.camera {
  position: relative;
  width: 64%;
  height: 48%;
}

.cam-box {
  position: absolute;
  inset: 18% 28%;
  border: 1.5px solid color-mix(in srgb, var(--text) 50%, transparent);
  border-radius: 2px;
  background: color-mix(in srgb, var(--text) 8%, transparent);
}

.cam-arrow {
  position: absolute;
  left: 8%;
  right: 8%;
  top: 50%;
  height: 2px;
  background: var(--accent);
  transform: translateY(-50%);
}

.cam-arrow::after {
  content: '';
  position: absolute;
  right: -1px;
  top: 50%;
  width: 7px;
  height: 7px;
  border-right: 2px solid var(--accent);
  border-top: 2px solid var(--accent);
  transform: translateY(-50%) rotate(45deg);
}

.camera[data-cam='orbit'] .cam-arrow {
  left: 50%;
  right: auto;
  width: 34%;
  height: 34%;
  top: 33%;
  border: 2px solid var(--accent);
  border-left-color: transparent;
  background: transparent;
  border-radius: 50%;
  transform: none;
}

.camera[data-cam='orbit'] .cam-arrow::after {
  top: 0;
  right: 2px;
  transform: rotate(10deg);
}

.camera[data-cam='crane'] .cam-arrow,
.camera[data-cam='tilt'] .cam-arrow {
  width: 2px;
  height: 60%;
  left: 50%;
  top: 18%;
  right: auto;
  transform: none;
}

.camera[data-cam='crane'] .cam-arrow::after,
.camera[data-cam='tilt'] .cam-arrow::after {
  top: -1px;
  right: 50%;
  transform: translateX(50%) rotate(-45deg);
}

.camera[data-cam='static'] .cam-arrow {
  display: none;
}

.camera[data-cam='dutch'] .cam-box {
  transform: rotate(-18deg);
}

.facing {
  position: relative;
  width: 42%;
  height: 70%;
}

.head {
  position: absolute;
  top: 8%;
  left: 50%;
  width: 38%;
  height: 28%;
  border-radius: 50%;
  border: 1.5px solid color-mix(in srgb, var(--text) 55%, transparent);
  transform: translateX(-50%);
  background: color-mix(in srgb, var(--accent) 18%, transparent);
}

.body {
  position: absolute;
  top: 40%;
  left: 50%;
  width: 62%;
  height: 48%;
  border: 1.5px solid color-mix(in srgb, var(--text) 45%, transparent);
  border-radius: 6px 6px 2px 2px;
  transform: translateX(-50%);
  background: color-mix(in srgb, var(--text) 6%, transparent);
}

.facing[data-facing='profile'] .head {
  left: 62%;
}
.facing[data-facing='profile'] .body {
  width: 40%;
  left: 58%;
}
.facing[data-facing='threeQuarter'] .head {
  left: 58%;
}
.facing[data-facing='back'],
.facing[data-facing='backThreeQuarter'] {
  opacity: 0.72;
}
.facing[data-facing='back'] .head,
.facing[data-facing='backThreeQuarter'] .head {
  background: color-mix(in srgb, var(--text) 10%, transparent);
}

.lighting {
  position: relative;
  width: 58%;
  height: 70%;
}

.face {
  position: absolute;
  inset: 18% 22%;
  border-radius: 50%;
  border: 1.5px solid color-mix(in srgb, var(--text) 40%, transparent);
  background: color-mix(in srgb, var(--text) 8%, transparent);
}

.beam {
  position: absolute;
  width: 42%;
  height: 42%;
  border-radius: 50%;
  background: color-mix(in srgb, var(--accent) 35%, transparent);
  filter: blur(2px);
}

.lighting[data-light='top'] .beam {
  top: -6%;
  left: 29%;
}
.lighting[data-light='side'] .beam {
  top: 20%;
  left: -10%;
}
.lighting[data-light='rembrandt'] .beam {
  top: 6%;
  left: -4%;
}
.lighting[data-light='volumetric'] .beam {
  inset: 10% 10%;
  width: auto;
  height: auto;
  opacity: 0.55;
}
.lighting[data-light='backlight'] .beam {
  top: 8%;
  right: -8%;
  left: auto;
}
.lighting[data-light='practical'] .beam {
  bottom: 4%;
  left: 29%;
  top: auto;
}

.mood {
  position: relative;
  width: 48%;
  height: 48%;
}

.face-circle {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  border: 1.5px solid color-mix(in srgb, var(--text) 50%, transparent);
}

.brow,
.mouth {
  position: absolute;
  left: 22%;
  right: 22%;
  height: 2px;
  background: color-mix(in srgb, var(--text) 55%, transparent);
  border-radius: 1px;
}

.brow {
  top: 32%;
}

.mouth {
  top: 64%;
}

.mood[data-mood='anger'] .brow {
  transform: rotate(-12deg);
  background: var(--danger);
}
.mood[data-mood='anger'] .mouth {
  transform: scaleX(0.7);
}
.mood[data-mood='relief'] .mouth,
.mood[data-mood='confidence'] .mouth {
  height: 6px;
  border: 1.5px solid color-mix(in srgb, var(--text) 55%, transparent);
  border-top: none;
  background: transparent;
  border-radius: 0 0 8px 8px;
}
.mood[data-mood='grief'] .mouth,
.mood[data-mood='anxiety'] .mouth {
  height: 6px;
  border: 1.5px solid color-mix(in srgb, var(--text) 55%, transparent);
  border-bottom: none;
  background: transparent;
  border-radius: 8px 8px 0 0;
}
.mood[data-mood='surprise'] .mouth {
  left: 38%;
  right: 38%;
  height: 8px;
  border-radius: 50%;
  background: transparent;
  border: 1.5px solid color-mix(in srgb, var(--text) 55%, transparent);
}

.icon-fallback {
  font-size: 16px;
  line-height: 1;
  opacity: 0.85;
}
</style>
