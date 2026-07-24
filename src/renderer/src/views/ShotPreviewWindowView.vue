<template>
  <div
    ref="rootEl"
    class="shot-preview-window"
    tabindex="0"
    @wheel.prevent="onWheel"
    @keydown.esc.prevent="closeWindow"
  >
    <header class="chrome">
      <span class="title">{{ t('director.stage.shotPreviewTitle') }}</span>
      <div class="chrome-actions">
        <button
          v-if="mediaKind === 'image'"
          type="button"
          class="export-btn"
          :disabled="!dataUrl || exporting"
          @click="exportImage"
        >
          {{
            exporting
              ? t('director.stage.shotPreviewExporting')
              : t('director.stage.shotPreviewExport')
          }}
        </button>
      </div>
    </header>

    <div class="viewport" @click="onBackdropClick">
      <p v-if="!dataUrl" class="empty">{{ t('director.stage.shotPreviewEmpty') }}</p>
      <img
        v-else-if="mediaKind === 'image'"
        :src="dataUrl"
        alt=""
        class="image"
        :class="{ grabbing: panning }"
        :style="imageStyle"
        draggable="false"
        @pointerdown="onPanStart"
        @pointermove="onPanMove"
        @pointerup="onPanEnd"
        @pointercancel="onPanEnd"
        @click.stop
      />
      <video
        v-else-if="mediaKind === 'video'"
        :src="dataUrl"
        class="av-player"
        controls
        autoplay
        @click.stop
      />
      <audio
        v-else
        :src="dataUrl"
        class="av-player audio"
        controls
        autoplay
        @click.stop
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useStudioI18n } from '../composables/useStudioI18n'

const { t } = useStudioI18n()
const rootEl = ref<HTMLElement | null>(null)
const dataUrl = ref<string | null>(null)
const mediaKind = ref<'image' | 'video' | 'voice'>('image')
const scale = ref(1)
const offsetX = ref(0)
const offsetY = ref(0)
const panning = ref(false)
const exporting = ref(false)
let didPan = false
let panPointerId: number | null = null
let panStart = { x: 0, y: 0, ox: 0, oy: 0 }
let stopShotListener: (() => void) | null = null

const imageStyle = computed(() => ({
  transform: `translate(${offsetX.value}px, ${offsetY.value}px) scale(${scale.value})`
}))

function extensionFromMediaUrl(url: string): string {
  const trimmed = url.trim()
  if (!trimmed) return ''
  try {
    const parsed = new URL(trimmed)
    const fromQuery = parsed.searchParams.get('path')
    if (fromQuery) {
      const decoded = decodeURIComponent(fromQuery).replace(/\\/g, '/')
      const match = decoded.match(/\.([a-z0-9]+)$/i)
      if (match?.[1]) return match[1].toLowerCase()
    }
    const path = (parsed.pathname || '').split(/[?#]/)[0] ?? ''
    const match = path.match(/\.([a-z0-9]+)$/i)
    if (match?.[1]) return match[1].toLowerCase()
  } catch {
    const path = trimmed.split(/[?#]/)[0] ?? ''
    const match = path.match(/\.([a-z0-9]+)$/i)
    if (match?.[1]) return match[1].toLowerCase()
  }
  return ''
}

function detectMediaKind(url: string): 'image' | 'video' | 'voice' {
  const lower = url.trim().toLowerCase()
  if (lower.startsWith('data:video/')) return 'video'
  if (lower.startsWith('data:audio/')) return 'voice'
  const ext = extensionFromMediaUrl(url)
  if (ext && ['mp4', 'webm', 'mov', 'mkv', 'avi', 'm4v'].includes(ext)) return 'video'
  if (ext && ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac', 'opus'].includes(ext)) return 'voice'
  return 'image'
}

function resetView(): void {
  scale.value = 1
  offsetX.value = 0
  offsetY.value = 0
  panning.value = false
  didPan = false
  panPointerId = null
}

function applyShot(url: string): void {
  resetView()
  dataUrl.value = url
  mediaKind.value = detectMediaKind(url)
  void nextTick(() => rootEl.value?.focus())
}

async function closeWindow(): Promise<void> {
  await window.studio.closeShotPreviewWindow()
}

function onBackdropClick(): void {
  if (didPan) {
    didPan = false
    return
  }
  void closeWindow()
}

function onWheel(event: WheelEvent): void {
  if (mediaKind.value !== 'image') return
  const el = rootEl.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  const cursorX = event.clientX - rect.left - rect.width / 2
  const cursorY = event.clientY - rect.top - rect.height / 2
  const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12
  const nextScale = Math.min(8, Math.max(0.2, scale.value * factor))
  const ratio = nextScale / scale.value
  offsetX.value = cursorX - (cursorX - offsetX.value) * ratio
  offsetY.value = cursorY - (cursorY - offsetY.value) * ratio
  scale.value = nextScale
}

function onPanStart(event: PointerEvent): void {
  if (event.button !== 0 && event.button !== 1) return
  panning.value = true
  didPan = false
  panPointerId = event.pointerId
  panStart = {
    x: event.clientX,
    y: event.clientY,
    ox: offsetX.value,
    oy: offsetY.value
  }
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}

function onPanMove(event: PointerEvent): void {
  if (!panning.value || event.pointerId !== panPointerId) return
  const dx = event.clientX - panStart.x
  const dy = event.clientY - panStart.y
  if (Math.abs(dx) > 2 || Math.abs(dy) > 2) didPan = true
  offsetX.value = panStart.ox + dx
  offsetY.value = panStart.oy + dy
}

function onPanEnd(event: PointerEvent): void {
  if (event.pointerId !== panPointerId) return
  panning.value = false
  panPointerId = null
  try {
    ;(event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId)
  } catch {
    /* already released */
  }
}

function extensionFromMime(mime: string): string {
  const m = mime.toLowerCase()
  if (m.includes('jpeg') || m.includes('jpg')) return 'jpg'
  if (m.includes('webp')) return 'webp'
  if (m.includes('gif')) return 'gif'
  if (m.includes('bmp')) return 'bmp'
  return 'png'
}

function extensionFromUrl(url: string): string {
  const path = url.split(/[?#]/)[0] ?? ''
  const match = path.match(/\.([a-z0-9]+)$/i)
  const ext = match?.[1]?.toLowerCase()
  if (ext && ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'].includes(ext)) {
    return ext === 'jpeg' ? 'jpg' : ext
  }
  return 'png'
}

async function resolveImageBytes(
  url: string
): Promise<{ data: Uint8Array; ext: string }> {
  if (url.startsWith('data:')) {
    const match = url.match(/^data:([^;,]+)?(;base64)?,([\s\S]*)$/i)
    if (!match) throw new Error('invalid data URL')
    const mime = match[1] || 'image/png'
    const isBase64 = !!match[2]
    const payload = match[3] || ''
    const binary = isBase64 ? atob(payload) : decodeURIComponent(payload)
    const data = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) data[i] = binary.charCodeAt(i)
    return { data, ext: extensionFromMime(mime) }
  }

  const response = await fetch(url)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const buffer = new Uint8Array(await response.arrayBuffer())
  const mime = response.headers.get('content-type') || ''
  const ext = mime.startsWith('image/') ? extensionFromMime(mime) : extensionFromUrl(url)
  return { data: buffer, ext }
}

async function exportImage(): Promise<void> {
  const url = dataUrl.value?.trim()
  if (!url || exporting.value) return
  exporting.value = true
  try {
    const { data, ext } = await resolveImageBytes(url)
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    await window.studio.saveBinaryFile({
      data,
      defaultPath: `preview-${stamp}.${ext}`,
      filters: [
        {
          name: t('director.stage.shotPreviewExportFilterImage'),
          extensions: [ext, 'png', 'jpg', 'webp']
        },
        { name: t('director.stage.shotPreviewExportFilterAll'), extensions: ['*'] }
      ]
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    window.alert(t('director.stage.shotPreviewExportFailed', { error: message }))
  } finally {
    exporting.value = false
  }
}

onMounted(async () => {
  stopShotListener = window.studio.onShotPreviewSet((payload) => {
    applyShot(payload.dataUrl)
  })
  const pending = await window.studio.getShotPreviewPayload()
  if (pending?.dataUrl) applyShot(pending.dataUrl)
  rootEl.value?.focus()
})

onBeforeUnmount(() => {
  stopShotListener?.()
  stopShotListener = null
})
</script>

<style scoped>
.shot-preview-window {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
  background: var(--bg);
  color: var(--text);
  outline: none;
  overflow: hidden;
  touch-action: none;
  user-select: none;
}

.chrome {
  display: flex;
  align-items: center;
  gap: 12px;
  height: 40px;
  padding: 0 12px;
  padding-left: max(12px, env(titlebar-area-x, 0px));
  padding-right: max(
    12px,
    calc(100% - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100%) + 12px)
  );
  border-bottom: 1px solid var(--border);
  background: var(--bg-panel);
  flex-shrink: 0;
  -webkit-app-region: drag;
  app-region: drag;
  box-sizing: border-box;
}

.title {
  font-size: 12px;
  color: var(--text-muted);
}

.chrome-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 8px;
  -webkit-app-region: no-drag;
  app-region: no-drag;
}

.export-btn {
  height: 26px;
  padding: 0 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-elevated, var(--bg));
  color: var(--text);
  font-size: 12px;
  cursor: pointer;
}

.export-btn:hover:not(:disabled) {
  border-color: var(--accent, var(--border));
}

.export-btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.viewport {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  position: relative;
  background: var(--graph-preview-bg);
}

.empty {
  margin: 0;
  color: var(--text-muted);
  font-size: 13px;
}

.image {
  max-width: min(96vw, 1400px);
  max-height: calc(100% - 32px);
  object-fit: contain;
  border-radius: 8px;
  box-shadow: 0 16px 48px var(--shadow);
  transform-origin: center center;
  cursor: grab;
  will-change: transform;
}

.image.grabbing {
  cursor: grabbing;
}

.av-player {
  max-width: min(96vw, 1400px);
  max-height: calc(100% - 32px);
  border-radius: 8px;
  box-shadow: 0 16px 48px var(--shadow);
  background: #000;
}

.av-player.audio {
  width: min(520px, 86vw);
  max-height: none;
  background: transparent;
  box-shadow: none;
}
</style>
