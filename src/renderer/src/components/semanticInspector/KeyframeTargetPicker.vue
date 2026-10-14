<template>
  <div class="si-picker">
    <div
      class="si-picker-bar"
      role="radiogroup"
      :aria-label="t('graph.semanticInspector.pickMode')"
    >
      <button
        v-for="m in modes"
        :key="m"
        type="button"
        role="radio"
        class="si-chip"
        :class="{ regenerate: mode === m }"
        :aria-checked="mode === m"
        @click="mode = m"
      >
        {{ t(`graph.semanticInspector.pickMode_${m}`) }}
      </button>
      <span v-if="busy" class="si-note">{{ t('graph.semanticInspector.pickBusy') }}</span>
      <button v-if="mask" type="button" class="si-link si-picker-clear" @click="emit('clear')">
        {{ t('graph.semanticInspector.pickClear') }}
      </button>
    </div>

    <div
      ref="stageRef"
      class="si-picker-stage"
      :class="{ busy, rect: mode === 'rect' }"
      :style="aspect ? { aspectRatio: aspect } : undefined"
      tabindex="0"
      role="application"
      :aria-label="t('graph.semanticInspector.pickStageLabel')"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="dragStart = null"
    >
      <img v-if="frameUrl" :src="frameUrl" alt="" draggable="false" @load="onFrameLoad" />
      <div
        v-if="maskUrl"
        class="si-picker-mask"
        :style="{ maskImage: `url(${maskUrl})`, WebkitMaskImage: `url(${maskUrl})` }"
      />
      <div v-if="dragBox" class="si-picker-drag" :style="boxStyle(dragBox)" />
    </div>
    <p v-if="message" class="si-note" role="status">{{ message }}</p>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import type { EntityTargetMask } from '@shared/semanticTimeline'
import { useStudioI18n } from '../../composables/useStudioI18n'
import { resolveAssetFileUrl } from '../../features/media/assetUrlCache'
import {
  keyframeSize,
  maskFromPoint,
  maskFromRect,
  segmentKeyframe,
  type EntityMaskResult
} from '../../features/graph/model/semanticEntityMask'
import { rectFromDrag, type NormBox } from '../../features/graph/model/semanticEntityMaskMath'

/**
 * 在关键帧上选"要换的是哪一块"：
 * - 点选：本地实例分割，取包含点击点的最小实例（一帧里有多个人时只选中被点的那个）；
 * - 框选：YOLO 认不出的物体（多数商品）直接拖一个框。
 * 选中结果以 `pick` 上抛（掩码 data URL + 归一化框），由表单落盘。
 */
const props = defineProps<{
  keyframeRelativePath: string
  mask?: EntityTargetMask
}>()
const emit = defineEmits<{ pick: [result: EntityMaskResult]; clear: [] }>()
const { t } = useStudioI18n()

const modes = ['point', 'rect'] as const
const mode = ref<(typeof modes)[number]>('point')
const busy = ref(false)
const message = ref('')
const frameUrl = ref('')
const maskUrl = ref('')
const aspect = ref('')
const stageRef = ref<HTMLElement | null>(null)
const dragStart = ref<{ x: number; y: number } | null>(null)
const dragBox = ref<NormBox | null>(null)

watch(
  () => props.keyframeRelativePath,
  async (rel) => {
    message.value = ''
    frameUrl.value = rel ? await resolveAssetFileUrl(rel).catch(() => '') : ''
  },
  { immediate: true }
)
watch(
  () => props.mask?.maskRelativePath,
  async (rel) => {
    maskUrl.value = rel ? await resolveAssetFileUrl(rel).catch(() => '') : ''
  },
  { immediate: true }
)

function onFrameLoad(e: Event): void {
  const img = e.target as HTMLImageElement
  if (img.naturalWidth && img.naturalHeight)
    aspect.value = `${img.naturalWidth} / ${img.naturalHeight}`
}

function normPoint(e: PointerEvent): { x: number; y: number } | null {
  const rect = stageRef.value?.getBoundingClientRect()
  if (!rect || rect.width <= 0 || rect.height <= 0) return null
  return {
    x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
    y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height))
  }
}

function boxStyle(box: NormBox): Record<string, string> {
  return {
    left: `${box.x * 100}%`,
    top: `${box.y * 100}%`,
    width: `${box.w * 100}%`,
    height: `${box.h * 100}%`
  }
}

async function run(task: () => Promise<EntityMaskResult | null>): Promise<void> {
  busy.value = true
  message.value = ''
  try {
    const result = await task()
    if (result) emit('pick', result)
    else message.value = t('graph.semanticInspector.pickMiss')
  } catch (e) {
    message.value = `${t('graph.semanticInspector.pickFailed')}${e instanceof Error ? e.message : String(e)}`
  } finally {
    busy.value = false
  }
}

function onPointerDown(e: PointerEvent): void {
  if (busy.value || e.button !== 0) return
  const p = normPoint(e)
  if (!p) return
  if (mode.value === 'rect') {
    dragStart.value = p
    dragBox.value = null
    ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
    return
  }
  void run(async () => maskFromPoint(await segmentKeyframe(props.keyframeRelativePath), p))
}

function onPointerMove(e: PointerEvent): void {
  if (!dragStart.value) return
  const p = normPoint(e)
  if (p) dragBox.value = rectFromDrag(dragStart.value, p, 0)
}

function onPointerUp(e: PointerEvent): void {
  if (!dragStart.value) return
  const p = normPoint(e)
  const box = p ? rectFromDrag(dragStart.value, p) : null
  dragStart.value = null
  dragBox.value = null
  if (!box) return
  void run(async () => maskFromRect(await keyframeSize(props.keyframeRelativePath), box))
}
</script>
