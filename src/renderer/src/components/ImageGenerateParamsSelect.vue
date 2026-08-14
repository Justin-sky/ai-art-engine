<template>
  <div
    v-if="visible"
    class="img-params"
    @pointerdown.stop
    @dblclick.stop
  >
    <button
      ref="triggerEl"
      type="button"
      class="summary-btn"
      :class="{ open: menuOpen }"
      :title="t('graph.inspector.generate.imageParams.title')"
      :aria-expanded="menuOpen"
      @click.stop="toggleMenu"
    >
      <span class="summary-text">{{ summaryText }}</span>
      <span
        class="chevron"
        aria-hidden="true"
      />
    </button>

    <Teleport to="body">
      <div
        v-if="menuOpen"
        ref="menuEl"
        class="img-params-menu"
        :style="menuStyle"
        role="dialog"
        :aria-label="t('graph.inspector.generate.imageParams.title')"
        @mousedown.stop
        @click.stop
        @pointerdown.stop
      >
        <p
          v-if="loading"
          class="menu-status"
        >
          {{ t('graph.inspector.generate.imageParams.loading') }}
        </p>
        <template v-else>
          <p
            v-if="!hasSections"
            class="menu-status"
          >
            {{ t('graph.inspector.generate.imageParams.empty') }}
          </p>
          <template v-else>
            <section
              v-if="caps.qualities.length"
              class="section"
            >
              <div class="section-title">
                {{ t('graph.inspector.generate.imageParams.quality') }}
              </div>
              <div class="chip-row">
                <button
                  v-for="q in caps.qualities"
                  :key="q"
                  type="button"
                  class="chip"
                  :class="{ active: local.quality === q }"
                  @click="pickQuality(q)"
                >
                  {{ qualityLabel(q) }}
                </button>
              </div>
            </section>

            <section
              v-if="caps.resolutions.length"
              class="section"
            >
              <div class="section-title">
                {{ t('graph.inspector.generate.imageParams.resolution') }}
              </div>
              <div class="chip-row">
                <button
                  v-for="r in caps.resolutions"
                  :key="r"
                  type="button"
                  class="chip"
                  :class="{ active: local.resolution === r }"
                  @click="pickResolution(r)"
                >
                  {{ r }}
                </button>
              </div>
            </section>

            <section
              v-if="caps.aspectRatios.length"
              class="section"
            >
              <div class="section-title">
                {{ t('graph.inspector.generate.imageParams.aspectRatio') }}
              </div>
              <div class="ratio-grid">
                <button
                  v-for="ratio in caps.aspectRatios"
                  :key="ratio"
                  type="button"
                  class="ratio-item"
                  :class="{ active: local.aspectRatio === ratio }"
                  @click="pickAspectRatio(ratio)"
                >
                  <span
                    class="ratio-icon"
                    v-html="ratioIcon(ratio)"
                  />
                  <span class="ratio-label">{{ ratio }}</span>
                </button>
              </div>
            </section>

            <section
              v-if="caps.counts.length"
              class="section"
            >
              <div class="section-title">
                {{ t('graph.inspector.generate.imageParams.count') }}
              </div>
              <div class="chip-row">
                <button
                  v-for="n in caps.counts"
                  :key="n"
                  type="button"
                  class="chip"
                  :class="{ active: local.count === n }"
                  @click="pickCount(n)"
                >
                  {{ t('graph.inspector.generate.imageParams.countOption', { n }) }}
                </button>
              </div>
            </section>
          </template>

          <section class="section">
            <div class="section-title">
              {{ t('graph.inspector.generate.imageParams.seed') }}
            </div>
            <label class="seed-global-toggle">
              <input
                type="checkbox"
                :checked="local.seedUseGlobal !== false"
                @change="toggleSeedUseGlobal"
              >
              <span>{{ t('graph.inspector.generate.imageParams.seedUseGlobal') }}</span>
            </label>
            <div class="seed-row">
              <input
                type="number"
                min="0"
                :max="String(MAX_GENERATE_SEED)"
                step="1"
                class="seed-input"
                :value="local.seed ?? ''"
                :disabled="local.seedUseGlobal !== false"
                :placeholder="t('graph.inspector.generate.imageParams.seedPlaceholder')"
                @input="pickSeed(($event.target as HTMLInputElement).value)"
              >
              <button
                type="button"
                class="chip"
                :class="{ active: local.seed == null }"
                :disabled="local.seedUseGlobal !== false"
                @click="pickSeed('')"
              >
                {{ t('graph.inspector.generate.imageParams.seedRandom') }}
              </button>
            </div>
          </section>
        </template>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import {
  MAX_GENERATE_SEED,
  clampSeed,
  clampImageGenerateParams,
  hasAnyImageGenerateCapability,
  type ImageGenerateParamCapabilities,
  type ImageGenerateParams
} from '@shared/graph'
import {
  getCachedImageGenerateCapabilities,
  loadImageGenerateCapabilities
} from '../features/graph/model/imageGenerateCapabilities'
import { imageAspectRatioIcon } from '../features/graph/model/imageAspectRatioIcons'
import { useStudioI18n } from '../composables/useStudioI18n'

const props = defineProps<{
  modelKey: string
  modelValue: ImageGenerateParams
}>()

const emit = defineEmits<{
  'update:modelValue': [value: ImageGenerateParams]
  change: []
}>()

const { t } = useStudioI18n()

const triggerEl = ref<HTMLElement | null>(null)
const menuEl = ref<HTMLElement | null>(null)
const menuOpen = ref(false)
const loading = ref(false)
const menuStyle = ref<Record<string, string>>({})
const caps = ref<ImageGenerateParamCapabilities>({
  aspectRatios: [],
  resolutions: [],
  qualities: [],
  counts: [],
  maxInputReferences: undefined
})
const local = ref<ImageGenerateParams>({ ...props.modelValue })

const visible = computed(() => Boolean(props.modelKey.trim()))
const hasSections = computed(() => hasAnyImageGenerateCapability(caps.value))

const summaryText = computed(() => {
  const parts: string[] = []
  if (caps.value.aspectRatios.length && local.value.aspectRatio) {
    parts.push(local.value.aspectRatio)
  }
  if (caps.value.qualities.length && local.value.quality) {
    parts.push(qualityLabel(local.value.quality))
  }
  if (caps.value.resolutions.length && local.value.resolution) {
    parts.push(local.value.resolution)
  }
  if (caps.value.counts.length && local.value.count != null) {
    parts.push(t('graph.inspector.generate.imageParams.countOption', { n: local.value.count }))
  }
  if (local.value.seedUseGlobal === false && local.value.seed != null) {
    parts.push(t('graph.inspector.generate.imageParams.seedSummary', { n: local.value.seed }))
  }
  return parts.length ? parts.join(' · ') : t('graph.inspector.generate.imageParams.placeholder')
})

function qualityLabel(q: string): string {
  const key = q.trim().toLowerCase()
  if (key === 'low') return t('graph.inspector.generate.imageParams.qualityLow')
  if (key === 'medium' || key === 'standard') {
    return t('graph.inspector.generate.imageParams.qualityMedium')
  }
  if (key === 'high') return t('graph.inspector.generate.imageParams.qualityHigh')
  if (key === 'auto') return t('graph.inspector.generate.imageParams.qualityAuto')
  return q
}

function ratioIcon(ratio: string): string {
  return imageAspectRatioIcon(ratio)
}

function emitLocal(): void {
  emit('update:modelValue', { ...local.value })
  emit('change')
}

function pickQuality(q: string): void {
  local.value = { ...local.value, quality: q }
  emitLocal()
}

function pickResolution(r: string): void {
  local.value = { ...local.value, resolution: r }
  emitLocal()
}

function pickAspectRatio(ratio: string): void {
  local.value = { ...local.value, aspectRatio: ratio }
  emitLocal()
}

function pickCount(n: number): void {
  local.value = { ...local.value, count: n }
  emitLocal()
}

function pickSeed(raw: string): void {
  const text = raw.trim()
  const n = text ? Number(text) : NaN
  local.value = { ...local.value, seed: clampSeed(n) }
  emitLocal()
}

function toggleSeedUseGlobal(e: Event): void {
  const on = (e.target as HTMLInputElement).checked
  local.value = { ...local.value, seedUseGlobal: on }
  emitLocal()
}

function applyCapabilities(nextCaps: ImageGenerateParamCapabilities): void {
  caps.value = nextCaps
  const clamped = clampImageGenerateParams(props.modelValue, nextCaps)
  local.value = clamped
  if (
    clamped.aspectRatio !== props.modelValue.aspectRatio ||
    clamped.resolution !== props.modelValue.resolution ||
    clamped.quality !== props.modelValue.quality ||
    clamped.count !== props.modelValue.count
  ) {
    emit('update:modelValue', { ...clamped })
    emit('change')
  }
}

async function refreshCapabilities(): Promise<void> {
  if (!props.modelKey.trim()) {
    caps.value = {
      aspectRatios: [],
      resolutions: [],
      qualities: [],
      counts: [],
      maxInputReferences: undefined
    }
    return
  }
  const cached = getCachedImageGenerateCapabilities(props.modelKey)
  if (cached) {
    applyCapabilities(cached)
    return
  }
  loading.value = true
  try {
    applyCapabilities(await loadImageGenerateCapabilities(props.modelKey))
  } finally {
    loading.value = false
  }
}

/** 打开指令面板时避免同步打 listModels；有缓存立刻用，否则延后拉取 */
function hydrateCapabilitiesForModelKey(): void {
  if (!props.modelKey.trim()) {
    caps.value = {
      aspectRatios: [],
      resolutions: [],
      qualities: [],
      counts: [],
      maxInputReferences: undefined
    }
    return
  }
  const cached = getCachedImageGenerateCapabilities(props.modelKey)
  if (cached) {
    applyCapabilities(cached)
    return
  }
  window.setTimeout(() => {
    void refreshCapabilities()
  }, 48)
}

function positionMenu(): void {
  const trigger = triggerEl.value
  if (!trigger) return
  const rect = trigger.getBoundingClientRect()
  const pad = 8
  const menuWidth = 320
  const estimatedHeight = menuEl.value?.offsetHeight ?? 360
  let left = rect.left
  let top = rect.bottom + 6
  if (left + menuWidth > window.innerWidth - pad) {
    left = Math.max(pad, window.innerWidth - menuWidth - pad)
  }
  if (top + estimatedHeight > window.innerHeight - pad) {
    top = Math.max(pad, rect.top - estimatedHeight - 6)
  }
  menuStyle.value = {
    position: 'fixed',
    left: `${Math.round(left)}px`,
    top: `${Math.round(top)}px`,
    width: `${menuWidth}px`,
    zIndex: '4100'
  }
}

async function toggleMenu(): Promise<void> {
  menuOpen.value = !menuOpen.value
  if (menuOpen.value) {
    await refreshCapabilities()
    await nextTick()
    positionMenu()
  }
}

function closeMenu(): void {
  menuOpen.value = false
}

function onWindowPointerDown(e: PointerEvent): void {
  if (!menuOpen.value) return
  const target = e.target as Node | null
  if (triggerEl.value?.contains(target) || menuEl.value?.contains(target)) return
  closeMenu()
}

function onReposition(): void {
  if (menuOpen.value) positionMenu()
}

watch(
  () => props.modelValue,
  (value) => {
    local.value = { ...value }
  },
  { deep: true }
)

watch(
  () => props.modelKey,
  () => {
    hydrateCapabilitiesForModelKey()
  },
  { immediate: true }
)

watch(menuOpen, (open) => {
  if (open) {
    window.addEventListener('pointerdown', onWindowPointerDown, true)
    window.addEventListener('scroll', onReposition, true)
    window.addEventListener('resize', onReposition)
  } else {
    window.removeEventListener('pointerdown', onWindowPointerDown, true)
    window.removeEventListener('scroll', onReposition, true)
    window.removeEventListener('resize', onReposition)
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', onWindowPointerDown, true)
  window.removeEventListener('scroll', onReposition, true)
  window.removeEventListener('resize', onReposition)
})
</script>

<style scoped>
.img-params {
  flex: none;
  min-width: 0;
  display: inline-flex;
  align-items: center;
}

.summary-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 220px;
  height: 24px;
  padding: 0 8px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--bg-input);
  color: var(--text);
  font-size: 11px;
  line-height: 22px;
  cursor: pointer;
}

.summary-btn:hover,
.summary-btn.open {
  border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
}

.summary-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chevron {
  flex: none;
  width: 0;
  height: 0;
  border-left: 3.5px solid transparent;
  border-right: 3.5px solid transparent;
  border-top: 4.5px solid var(--text-muted);
}

.summary-btn.open .chevron {
  transform: rotate(180deg);
}
</style>

<style>
.img-params-menu {
  max-height: min(420px, calc(100vh - 16px));
  overflow: auto;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--bg-panel);
  box-shadow: 0 12px 32px var(--shadow);
  color: var(--text);
  box-sizing: border-box;
}

.img-params-menu .menu-status {
  margin: 0;
  padding: 8px 4px;
  font-size: 12px;
  color: var(--text-muted);
}

.img-params-menu .section + .section {
  margin-top: 14px;
}

.img-params-menu .section-title {
  margin-bottom: 8px;
  font-size: 12px;
  color: var(--text-muted);
}

.img-params-menu .chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.img-params-menu .seed-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.img-params-menu .seed-global-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
  font-size: 12px;
  color: var(--text);
  cursor: pointer;
}

.img-params-menu .seed-input {
  flex: 1;
  min-width: 0;
  height: 34px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-input);
  color: var(--text);
  font-size: 12px;
}

.img-params-menu .seed-input:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.img-params-menu .chip {
  min-width: 64px;
  height: 34px;
  padding: 0 12px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: var(--bg-elevated);
  color: var(--text);
  font-size: 12px;
  cursor: pointer;
}

.img-params-menu .chip:hover {
  background: var(--bg-hover);
}

.img-params-menu .chip.active {
  border-color: var(--accent);
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 14%, var(--bg-elevated));
}

.img-params-menu .ratio-grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 8px;
}

.img-params-menu .ratio-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  min-height: 56px;
  padding: 6px 4px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: var(--bg-elevated);
  color: var(--text);
  cursor: pointer;
}

.img-params-menu .ratio-item:hover {
  background: var(--bg-hover);
}

.img-params-menu .ratio-item.active {
  border-color: var(--accent);
  color: var(--accent);
}

.img-params-menu .ratio-icon {
  display: flex;
  width: 22px;
  height: 22px;
  color: currentColor;
}

.img-params-menu .ratio-icon svg {
  width: 100%;
  height: 100%;
}

.img-params-menu .ratio-label {
  font-size: 11px;
  line-height: 1.2;
}
</style>
