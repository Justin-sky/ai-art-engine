<template>
  <div
    ref="rootEl"
    class="media-preview"
    tabindex="0"
    @wheel.prevent="onWheel"
    @keydown="onKeydown"
  >
    <div class="viewport" :class="{ text: mediaKind === 'text' }" @click="onBackdropClick">
      <textarea
        v-if="mediaKind === 'text'"
        class="text-view"
        readonly
        spellcheck="false"
        :value="textContent"
        @click.stop
      />
      <p v-else-if="!resolvedUrl" class="empty">
        {{ emptyText }}
      </p>
      <img
        v-else-if="mediaKind === 'image'"
        :src="resolvedUrl"
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
        :src="resolvedUrl"
        class="av-player"
        controls
        autoplay
        @click.stop
      />
      <audio v-else :src="resolvedUrl" class="av-player audio" controls autoplay @click.stop />
    </div>

    <!--
      图片工具条：旋转 / 复位。
      刻意放在 .viewport 之外并 @click.stop —— viewport 的点击是「复位视图」，
      工具条落在里面就会点一下旋转、顺手把刚转的角度又复位掉。
    -->
    <div v-if="isImageReady" class="image-bar" @click.stop>
      <button
        type="button"
        class="bar-btn"
        :title="t('graph.preview.rotateCcw')"
        :aria-label="t('graph.preview.rotateCcw')"
        @click="rotateBy(-90)"
      >
        ↺
      </button>
      <button
        type="button"
        class="bar-btn"
        :title="t('graph.preview.rotateCw')"
        :aria-label="t('graph.preview.rotateCw')"
        @click="rotateBy(90)"
      >
        ↻
      </button>
      <button
        type="button"
        class="bar-btn angle"
        :title="t('graph.preview.rotateReset')"
        :disabled="rotationDeg === 0"
        @click="resetRotation"
      >
        {{ rotationLabel }}
      </button>
      <span class="bar-hint">{{ t('graph.preview.imageHint') }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useStudioI18n } from '../../composables/useStudioI18n'

const props = defineProps<{
  frameKey: string
  mediaKind: 'image' | 'video' | 'audio' | 'text'
  url: string
  relativePath?: string
  title?: string
  text?: string
}>()

const { t } = useStudioI18n()
const rootEl = ref<HTMLElement | null>(null)
const resolvedUrl = ref('')
const scale = ref(1)
const offsetX = ref(0)
const offsetY = ref(0)
/** 视角旋转（度）。只对图片有意义，且与缩放 / 平移叠加 */
const rotationDeg = ref(0)
const panning = ref(false)
let didPan = false
let panPointerId: number | null = null
let panStart = { x: 0, y: 0, ox: 0, oy: 0 }

const isImageReady = computed(() => props.mediaKind === 'image' && !!resolvedUrl.value)
const rotationLabel = computed(() => `${Math.round(rotationDeg.value)}°`)

const imageStyle = computed(() => ({
  transform: `translate(${offsetX.value}px, ${offsetY.value}px) scale(${scale.value}) rotate(${rotationDeg.value}deg)`
}))

const textContent = computed(() => props.text ?? props.url ?? '')

const emptyText = computed(() => {
  if (props.mediaKind === 'video') return t('director.stage.shotPreviewEmptyVideo')
  if (props.mediaKind === 'audio') return t('director.stage.shotPreviewEmptyVoice')
  if (props.mediaKind === 'text') return t('graph.notepad.emptyReadonly')
  return t('director.stage.shotPreviewEmpty')
})

async function resolveUrl(): Promise<void> {
  const relativePath = props.relativePath?.trim()
  if (relativePath) {
    try {
      const url = await window.studio.getAssetFileUrl(relativePath)
      if (url) {
        resolvedUrl.value = url
        return
      }
    } catch {
      /* fall through */
    }
  }
  resolvedUrl.value = props.url?.trim() || ''
}

watch(
  () => [props.url, props.relativePath] as const,
  () => {
    // 换图不继承上一张的缩放 / 平移 / 旋转：弹窗是复用的，转过的角度会让人以为图本身是歪的
    resetView()
    void resolveUrl()
  },
  { immediate: true }
)

onMounted(() => {
  rootEl.value?.focus()
})

/** 细调步长（Shift+滚轮）；按钮与 [ / ] 走 90° 整步 */
const ROTATE_STEP = 15

function onWheel(e: WheelEvent): void {
  if (!isImageReady.value) return
  // Shift + 滚轮 = 细调角度（与精修面板同一套手势）
  if (e.shiftKey) {
    rotateBy(e.deltaY > 0 ? ROTATE_STEP : -ROTATE_STEP)
    return
  }
  const next = scale.value * (e.deltaY < 0 ? 1.1 : 0.9)
  scale.value = Math.min(8, Math.max(0.2, next))
}

/** 旋转角归一化到 [0, 360)：连点也不会堆出 720 / -90 这类值 */
function rotateBy(deg: number): void {
  rotationDeg.value = (rotationDeg.value + deg + 360) % 360
}

function resetRotation(): void {
  rotationDeg.value = 0
}

/** 复位视图：缩放 / 平移 / 旋转一起回到初始（点空白处与「0」键） */
function resetView(): void {
  scale.value = 1
  offsetX.value = 0
  offsetY.value = 0
  rotationDeg.value = 0
}

/**
 * 键盘：[ / ] 转 90°，0 复位。
 * 预览是浮在画布之上的窗，且画布 / 精修面板都挂了 window 级快捷键，
 * 所以这里必须 stopPropagation，免得转一下把底下的画布或参数也一起转了。
 */
function onKeydown(event: KeyboardEvent): void {
  if (!isImageReady.value) return
  if (event.key === '[') rotateBy(-90)
  else if (event.key === ']') rotateBy(90)
  else if (event.key === '0') resetView()
  else return
  event.preventDefault()
  event.stopPropagation()
}

function onPanStart(e: PointerEvent): void {
  if (e.button !== 0) return
  panning.value = true
  didPan = false
  panPointerId = e.pointerId
  ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
  panStart = { x: e.clientX, y: e.clientY, ox: offsetX.value, oy: offsetY.value }
}

function onPanMove(e: PointerEvent): void {
  if (!panning.value || panPointerId !== e.pointerId) return
  const dx = e.clientX - panStart.x
  const dy = e.clientY - panStart.y
  if (Math.abs(dx) > 2 || Math.abs(dy) > 2) didPan = true
  offsetX.value = panStart.ox + dx
  offsetY.value = panStart.oy + dy
}

function onPanEnd(e: PointerEvent): void {
  if (panPointerId !== e.pointerId) return
  panning.value = false
  panPointerId = null
}

function onBackdropClick(): void {
  if (didPan) {
    didPan = false
    return
  }
  resetView()
}
</script>

<style scoped>
.media-preview {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  /* 工具条浮在画面之上 */
  position: relative;
  outline: none;
  background: #0b0b0d;
}
.viewport {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
.empty {
  color: var(--text-muted);
  font-size: 13px;
}
.image {
  max-width: none;
  max-height: none;
  transform-origin: center center;
  cursor: grab;
  user-select: none;
}
.image.grabbing {
  cursor: grabbing;
}

/* 图片工具条：浮在画面下沿居中，压在深色画布上（本窗固定深底，不跟主题） */
.image-bar {
  position: absolute;
  left: 50%;
  bottom: 12px;
  z-index: 2;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: calc(100% - 24px);
  padding: 4px 8px;
  transform: translateX(-50%);
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.62);
  color: #fff;
  font-size: 11px;
}

.bar-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 22px;
  height: 22px;
  padding: 0 6px;
  border: 1px solid rgba(0, 0, 0, 0.35);
  border-radius: 999px;
  background: transparent;
  color: #fff;
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
}

.bar-btn:hover:not(:disabled) {
  background: rgba(0, 0, 0, 0.35);
}

.bar-btn:disabled {
  opacity: 0.45;
  cursor: default;
}

.bar-btn.angle {
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.bar-hint {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: rgba(255, 255, 255, 0.75);
}

/* 窄窗先收提示文案，按钮始终在 */
@media (max-width: 560px) {
  .bar-hint {
    display: none;
  }
}
.av-player {
  max-width: 100%;
  max-height: 100%;
}
.av-player.audio {
  width: min(480px, 90%);
}
.viewport.text {
  align-items: stretch;
  justify-content: stretch;
  padding: 12px;
}
.text-view {
  flex: 1;
  width: 100%;
  min-height: 0;
  resize: none;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 12px;
  background: var(--bg-panel);
  color: var(--text);
  font: inherit;
  line-height: 1.5;
}
</style>
