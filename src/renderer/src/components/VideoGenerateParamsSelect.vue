<template>
  <div v-if="visible" class="video-params" @pointerdown.stop @dblclick.stop>
    <button
      ref="triggerEl"
      type="button"
      class="summary-btn"
      :class="{ open: menuOpen }"
      :title="t('graph.inspector.generate.videoParams.title')"
      :aria-expanded="menuOpen"
      @click.stop="toggleMenu"
    >
      <span class="summary-text">{{ summaryText }}</span>
      <span class="chevron" aria-hidden="true" />
    </button>

    <Teleport to="body">
      <div
        v-if="menuOpen"
        ref="menuEl"
        class="video-params-menu"
        :style="menuStyle"
        role="dialog"
        :aria-label="t('graph.inspector.generate.videoParams.title')"
        @mousedown.stop
        @click.stop
        @pointerdown.stop
      >
        <p v-if="loading" class="menu-status">{{ t('graph.inspector.generate.videoParams.loading') }}</p>
        <template v-else>
          <p v-if="!hasSections" class="menu-status">
            {{ t('graph.inspector.generate.videoParams.empty') }}
          </p>
          <template v-else>
          <section v-if="caps.durations.length" class="section">
            <div class="section-title">{{ t('graph.inspector.generate.videoParams.duration') }}</div>
            <div class="chip-row">
              <button
                v-for="sec in caps.durations"
                :key="sec"
                type="button"
                class="chip"
                :class="{ active: local.duration === sec }"
                @click="pickDuration(sec)"
              >
                {{ t('graph.inspector.generate.videoParams.durationOption', { n: sec }) }}
              </button>
            </div>
          </section>

          <section v-if="caps.resolutions.length" class="section">
            <div class="section-title">{{ t('graph.inspector.generate.videoParams.resolution') }}</div>
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

          <section v-if="caps.aspectRatios.length" class="section">
            <div class="section-title">{{ t('graph.inspector.generate.videoParams.aspectRatio') }}</div>
            <div class="ratio-grid">
              <button
                v-for="ratio in caps.aspectRatios"
                :key="ratio"
                type="button"
                class="ratio-item"
                :class="{ active: local.aspectRatio === ratio }"
                @click="pickAspectRatio(ratio)"
              >
                <span class="ratio-icon" v-html="ratioIcon(ratio)" />
                <span class="ratio-label">{{ ratio }}</span>
              </button>
            </div>
          </section>

          <section v-if="caps.supportsGenerateAudio" class="section">
            <div class="section-title">{{ t('graph.inspector.generate.videoParams.generateAudio') }}</div>
            <div class="chip-row">
              <button
                type="button"
                class="chip"
                :class="{ active: local.generateAudio === true }"
                @click="pickGenerateAudio(true)"
              >
                {{ t('graph.inspector.generate.videoParams.generateAudioOn') }}
              </button>
              <button
                type="button"
                class="chip"
                :class="{ active: local.generateAudio === false }"
                @click="pickGenerateAudio(false)"
              >
                {{ t('graph.inspector.generate.videoParams.generateAudioOff') }}
              </button>
            </div>
          </section>

          <section v-if="!hideFrameMode && frameModeOptions.length > 1" class="section">
            <div class="section-title">{{ t('graph.inspector.generate.videoParams.frameMode') }}</div>
            <div class="chip-row">
              <button
                v-for="mode in frameModeOptions"
                :key="mode"
                type="button"
                class="chip"
                :class="{ active: (local.frameMode ?? 'none') === mode }"
                @click="pickFrameMode(mode)"
              >
                {{ t(`graph.inspector.generate.videoParams.frameMode_${mode}`) }}
              </button>
            </div>
          </section>
          </template>

          <section class="section">
            <div class="section-title">{{ t('graph.inspector.generate.videoParams.seed') }}</div>
            <label class="seed-global-toggle">
              <input
                type="checkbox"
                :checked="local.seedUseGlobal !== false"
                @change="toggleSeedUseGlobal"
              />
              <span>{{ t('graph.inspector.generate.videoParams.seedUseGlobal') }}</span>
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
                :placeholder="t('graph.inspector.generate.videoParams.seedPlaceholder')"
                @input="pickSeed(($event.target as HTMLInputElement).value)"
              />
              <button
                type="button"
                class="chip"
                :class="{ active: local.seed == null }"
                :disabled="local.seedUseGlobal !== false"
                @click="pickSeed('')"
              >
                {{ t('graph.inspector.generate.videoParams.seedRandom') }}
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
  EMPTY_VIDEO_GENERATE_CAPABILITIES,
  MAX_GENERATE_SEED,
  availableVideoFrameModes,
  clampSeed,
  clampVideoGenerateParams,
  hasAnyVideoGenerateCapability,
  type VideoFrameMode,
  type VideoGenerateParamCapabilities,
  type VideoGenerateParams
} from '@shared/graph'
import {
  getCachedVideoGenerateCapabilities,
  loadVideoGenerateParamCapabilities
} from '../features/graph/model/videoGenerateCapabilities'
import { imageAspectRatioIcon } from '../features/graph/model/imageAspectRatioIcons'
import { useStudioI18n } from '../composables/useStudioI18n'

const props = withDefaults(
  defineProps<{
    modelKey: string
    modelValue: VideoGenerateParams
    /** 对口型等节点不展示首尾帧模式 */
    hideFrameMode?: boolean
  }>(),
  { hideFrameMode: false }
)

const emit = defineEmits<{
  'update:modelValue': [value: VideoGenerateParams]
  change: []
}>()

const { t } = useStudioI18n()

const triggerEl = ref<HTMLElement | null>(null)
const menuEl = ref<HTMLElement | null>(null)
const menuOpen = ref(false)
const loading = ref(false)
const menuStyle = ref<Record<string, string>>({})
const caps = ref<VideoGenerateParamCapabilities>({ ...EMPTY_VIDEO_GENERATE_CAPABILITIES })
const local = ref<VideoGenerateParams>({ ...props.modelValue })

const visible = computed(() => Boolean(props.modelKey.trim()))
const hasSections = computed(() => hasAnyVideoGenerateCapability(caps.value))
const hideFrameMode = computed(() => props.hideFrameMode)
const frameModeOptions = computed(() => availableVideoFrameModes(caps.value.supportedFrameImages))

const summaryText = computed(() => {
  const parts: string[] = []
  if (caps.value.durations.length && local.value.duration != null) {
    parts.push(t('graph.inspector.generate.videoParams.durationOption', { n: local.value.duration }))
  }
  if (caps.value.aspectRatios.length && local.value.aspectRatio) {
    parts.push(local.value.aspectRatio)
  }
  if (caps.value.resolutions.length && local.value.resolution) {
    parts.push(local.value.resolution)
  }
  if (caps.value.supportsGenerateAudio && typeof local.value.generateAudio === 'boolean') {
    parts.push(
      local.value.generateAudio
        ? t('graph.inspector.generate.videoParams.generateAudioOn')
        : t('graph.inspector.generate.videoParams.generateAudioOff')
    )
  }
  const mode = local.value.frameMode ?? 'none'
  if (!hideFrameMode.value && frameModeOptions.value.length > 1 && mode !== 'none') {
    parts.push(t(`graph.inspector.generate.videoParams.frameMode_${mode}`))
  }
  if (local.value.seedUseGlobal === false && local.value.seed != null) {
    parts.push(t('graph.inspector.generate.videoParams.seedSummary', { n: local.value.seed }))
  }
  return parts.length ? parts.join(' · ') : t('graph.inspector.generate.videoParams.placeholder')
})

function ratioIcon(ratio: string): string {
  return imageAspectRatioIcon(ratio)
}

function emitLocal(): void {
  emit('update:modelValue', { ...local.value })
  emit('change')
}

function pickDuration(sec: number): void {
  local.value = { ...local.value, duration: sec }
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

function pickGenerateAudio(on: boolean): void {
  local.value = { ...local.value, generateAudio: on }
  emitLocal()
}

function pickFrameMode(mode: VideoFrameMode): void {
  local.value = { ...local.value, frameMode: mode }
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

function applyCapabilities(nextCaps: VideoGenerateParamCapabilities): void {
  caps.value = nextCaps
  const clamped = clampVideoGenerateParams(props.modelValue, nextCaps)
  local.value = clamped
  if (
    clamped.aspectRatio !== props.modelValue.aspectRatio ||
    clamped.resolution !== props.modelValue.resolution ||
    clamped.duration !== props.modelValue.duration ||
    clamped.generateAudio !== props.modelValue.generateAudio ||
    (clamped.frameMode ?? 'none') !== (props.modelValue.frameMode ?? 'none')
  ) {
    emit('update:modelValue', { ...clamped })
    emit('change')
  }
}

async function refreshCapabilities(): Promise<void> {
  if (!props.modelKey.trim()) {
    caps.value = { ...EMPTY_VIDEO_GENERATE_CAPABILITIES }
    return
  }
  const cached = getCachedVideoGenerateCapabilities(props.modelKey)
  if (cached) {
    applyCapabilities(cached.params)
    return
  }
  loading.value = true
  try {
    applyCapabilities(await loadVideoGenerateParamCapabilities(props.modelKey))
  } finally {
    loading.value = false
  }
}

function hydrateCapabilitiesForModelKey(): void {
  if (!props.modelKey.trim()) {
    caps.value = { ...EMPTY_VIDEO_GENERATE_CAPABILITIES }
    return
  }
  const cached = getCachedVideoGenerateCapabilities(props.modelKey)
  if (cached) {
    applyCapabilities(cached.params)
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
.video-params {
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
.video-params-menu {
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

.video-params-menu .menu-status {
  margin: 0;
  padding: 8px 4px;
  font-size: 12px;
  color: var(--text-muted);
}

.video-params-menu .section + .section {
  margin-top: 14px;
}

.video-params-menu .section-title {
  margin-bottom: 8px;
  font-size: 12px;
  color: var(--text-muted);
}

.video-params-menu .chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.video-params-menu .seed-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.video-params-menu .seed-global-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
  font-size: 12px;
  color: var(--text);
  cursor: pointer;
}

.video-params-menu .seed-input {
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

.video-params-menu .seed-input:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.video-params-menu .chip {
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

.video-params-menu .chip:hover {
  background: var(--bg-hover);
}

.video-params-menu .chip.active {
  border-color: var(--accent);
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 14%, var(--bg-elevated));
}

.video-params-menu .ratio-grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 8px;
}

.video-params-menu .ratio-item {
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

.video-params-menu .ratio-item:hover {
  background: var(--bg-hover);
}

.video-params-menu .ratio-item.active {
  border-color: var(--accent);
  color: var(--accent);
}

.video-params-menu .ratio-icon {
  display: flex;
  width: 22px;
  height: 22px;
  color: currentColor;
}

.video-params-menu .ratio-icon svg {
  width: 100%;
  height: 100%;
}

.video-params-menu .ratio-label {
  font-size: 11px;
  line-height: 1.2;
}
</style>
