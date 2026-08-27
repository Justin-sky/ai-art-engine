<template>
  <div
    v-if="node"
    class="node-inspector"
  >
    <div class="head">
      <span class="type">{{ typeLabel }}</span>
      <h2>{{ node.title || typeLabel }}</h2>
    </div>
    <p class="hint">
      {{ t('graph.inspector.portraitTexture.hint') }}
    </p>

    <GraphNodeRunControl
      v-if="hasInPort"
      :status="runStatus"
      :is-running="isGraphRunning"
      :blocked="blocked"
      @toggle="toggleRun"
    />

    <div
      v-if="node && hostId"
      class="before-after"
    >
      <div
        ref="compareEl"
        class="compare-pane"
        @pointermove="onCompareMove"
        @pointerup="onCompareUp"
        @pointercancel="onCompareUp"
      >
        <template v-if="beforeUrl && afterUrl">
          <img
            :src="afterUrl"
            alt=""
            class="compare-img"
            draggable="false"
          >
          <img
            :src="beforeUrl"
            alt=""
            class="compare-img before"
            :style="{ clipPath: `inset(0 ${100 - splitPos}% 0 0)` }"
            draggable="false"
          >
          <div
            class="compare-divider"
            :style="{ left: `${splitPos}%` }"
            @pointerdown="onCompareDown"
          >
            <span class="compare-handle" />
          </div>
          <span class="compare-tag before">{{ t('graph.portraitQuality.before') }}</span>
          <span class="compare-tag after">{{ t('graph.portraitQuality.generated') }}</span>
        </template>
        <img
          v-else-if="beforeUrl"
          :src="beforeUrl"
          alt=""
          class="compare-img"
          draggable="false"
        >
        <img
          v-else-if="afterUrl"
          :src="afterUrl"
          alt=""
          class="compare-img"
          draggable="false"
        >
        <div
          v-else
          class="compare-empty"
        >
          {{ t('graph.portraitQuality.previewEmpty') }}
        </div>
      </div>
    </div>

    <GraphNodeOutputPreview
      v-if="node && hostId"
      :node="node"
      :host-id="hostId"
    />

    <label>
      {{ t('graph.inspector.generate.systemPrompt') }}
      <ExpandableTextarea
        :key="`sys-${node.id}`"
        v-model="systemPrompt"
        :title="t('graph.inspector.generate.systemPrompt')"
        :rows="5"
        :placeholder="t('graph.inspector.generate.systemPromptPlaceholder')"
        @change="persistSystemPrompt"
      />
    </label>

    <label>
      {{ t('graph.portraitTexture.outputPrompt') }}
      <textarea
        class="prompt-view"
        :value="outputPrompt || emptyPrompt"
        rows="6"
        readonly
      />
    </label>
  </div>
  <div
    v-else
    class="node-inspector empty"
  >
    {{ t('graph.inspector.node.empty') }}
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  DEFAULT_PORTRAIT_TEXTURE_SYSTEM_PROMPT_EN,
  DEFAULT_PORTRAIT_TEXTURE_SYSTEM_PROMPT_ZH,
  defaultPortraitTextureSystemPrompt,
  flattenImagesValues,
  readPortraitQualityFromNode,
  resolvePortraitQualityOutputPrompt,
  resolvePortraitTextureSystemPrompt
} from '@shared/graph'
import GraphNodeRunControl from './GraphNodeRunControl.vue'
import GraphNodeOutputPreview from './GraphNodeOutputPreview.vue'
import ExpandableTextarea from './ExpandableTextarea.vue'
import { useStudioI18n } from '../composables/useStudioI18n'
import { useGraphNodeRun } from '../composables/useGraphNodeRun'
import { useEditorKernel } from '../editor/kernel'
import { graphEditorHosts } from '../features/graph/model/graphEditorHosts'
import { graphRunHosts } from '../features/graph/model/graphRunHosts'
import { resolveNodeUpstreamImageUrl } from '../features/graph/model/resolveNodeUpstreamImageUrl'
import { resolveAssetFileUrl } from '../features/media/assetUrlCache'
import { useProjectStore } from '../stores/project'

const { t, locale, graphTypeLabel } = useStudioI18n()
const editor = useEditorKernel()

const node = computed(() => {
  void graphEditorHosts.revision.value
  const selection = editor.selection.current.value
  const id = selection.kind === 'graph.node' ? selection.id : null
  if (!id) return null
  const current = graphEditorHosts.getNode(selection.hostId, id)
  return current?.typeId === 'image.portraitTexture' ? current : null
})

const hostId = computed(() => {
  const selection = editor.selection.current.value
  return selection.kind === 'graph.node' ? selection.hostId ?? '' : ''
})

const { hasInPort, runStatus, isGraphRunning, blocked, toggleRun } = useGraphNodeRun(node)

const typeLabel = computed(() => graphTypeLabel('image.portraitTexture'))
const emptyPrompt = computed(() => t('graph.portraitTexture.promptEmpty'))
const systemPrompt = ref('')
const loadedNodeId = ref<string | null>(null)
const loadedHostId = ref<string | null>(null)

const outputPrompt = computed(() => {
  const current = node.value
  if (!current) return ''
  // 始终按当前质感选项重算，编辑面板实时写回时 Inspector 同步刷新
  return resolvePortraitQualityOutputPrompt(readPortraitQualityFromNode(current.params))
})

const project = useProjectStore()
const beforeUrl = ref('')
const afterUrl = ref('')
const splitPos = ref(50)
const compareEl = ref<HTMLElement | null>(null)
let compareDragging = false

const runOutput = computed(() => {
  const current = node.value
  const hid = hostId.value
  if (!current || !hid) return null
  return graphRunHosts.get(hid)?.runStates[current.id]?.outputs?.out ?? null
})

const COMPARE_CANVAS_SIZE = 640

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(t('graph.portraitQuality.compareLoadFailed')))
    img.src = src
  })
}

/** 将原图 / 生成图归一化到同一尺寸画布（等比居中，不裁切） */
async function normalizeCompareImage(src: string): Promise<string> {
  try {
    const img = await loadImage(src)
    const canvas = document.createElement('canvas')
    canvas.width = COMPARE_CANVAS_SIZE
    canvas.height = COMPARE_CANVAS_SIZE
    const ctx = canvas.getContext('2d')
    if (!ctx) return src
    const scale = Math.min(
      COMPARE_CANVAS_SIZE / img.naturalWidth,
      COMPARE_CANVAS_SIZE / img.naturalHeight
    )
    const dw = Math.max(1, Math.round(img.naturalWidth * scale))
    const dh = Math.max(1, Math.round(img.naturalHeight * scale))
    const dx = Math.round((COMPARE_CANVAS_SIZE - dw) / 2)
    const dy = Math.round((COMPARE_CANVAS_SIZE - dh) / 2)
    ctx.drawImage(img, dx, dy, dw, dh)
    return canvas.toDataURL('image/png')
  } catch {
    return src
  }
}

async function resolveCompare(): Promise<void> {
  const current = node.value
  const hid = hostId.value
  if (!current || !hid) {
    beforeUrl.value = ''
    afterUrl.value = ''
    return
  }

  const document = graphEditorHosts.getDocument(hid)
  let before = await resolveNodeUpstreamImageUrl({
    document,
    nodeId: current.id,
    runStates: graphRunHosts.get(hid)?.runStates ?? {},
    assets: project.assets
  })

  let after = ''
  const runOut = runOutput.value
  for (const item of flattenImagesValues(runOut ? [runOut] : [])) {
    if (item.dataUrl?.trim()) {
      after = item.dataUrl
      break
    }
    if (item.relativePath?.trim()) {
      const url = await resolveAssetFileUrl(item.relativePath)
      if (url) {
        after = url
        break
      }
    }
  }

  if (!after) {
    const generated = current.params.generatedImages
    if (Array.isArray(generated) && generated.length) {
      const selectedId = current.params.selectedImageId?.trim()
      const picked =
        (selectedId ? generated.find((item) => item.id === selectedId) : undefined) ??
        generated[generated.length - 1]
      if (picked?.dataUrl?.trim()) {
        after = picked.dataUrl
      } else if (picked?.relativePath?.trim()) {
        after = await resolveAssetFileUrl(picked.relativePath)
      }
    }
  }

  if (before && after) {
    before = await normalizeCompareImage(before)
    after = await normalizeCompareImage(after)
  }
  beforeUrl.value = before
  afterUrl.value = after
}

watch([node, hostId, runOutput], () => {
  splitPos.value = 50
  void resolveCompare()
}, { immediate: true })

function setSplitFromClientX(clientX: number): void {
  const el = compareEl.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  if (!rect.width) return
  const ratio = (clientX - rect.left) / rect.width
  splitPos.value = Math.min(100, Math.max(0, ratio * 100))
}

function onCompareDown(e: PointerEvent): void {
  compareDragging = true
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  setSplitFromClientX(e.clientX)
}

function onCompareMove(e: PointerEvent): void {
  if (!compareDragging) return
  setSplitFromClientX(e.clientX)
}

function onCompareUp(): void {
  compareDragging = false
}

function loadSystemPrompt(current: NonNullable<typeof node.value>): void {
  loadedNodeId.value = current.id
  loadedHostId.value = hostId.value
  systemPrompt.value = resolvePortraitTextureSystemPrompt(
    current.params.generateSystemPrompt,
    String(locale.value)
  )
}

watch(
  node,
  (current) => {
    if (!current) {
      systemPrompt.value = ''
      loadedNodeId.value = null
      loadedHostId.value = null
      return
    }
    const sameNode = current.id === loadedNodeId.value && hostId.value === loadedHostId.value
    if (!sameNode) loadSystemPrompt(current)
  },
  { immediate: true }
)

watch(locale, (next) => {
  if (!node.value) return
  const cur = systemPrompt.value.trim()
  if (!cur || isDefaultSystemPrompt(cur)) {
    systemPrompt.value = defaultPortraitTextureSystemPrompt(String(next))
  }
})

function isDefaultSystemPrompt(value: string): boolean {
  return (
    value === DEFAULT_PORTRAIT_TEXTURE_SYSTEM_PROMPT_EN ||
    value === DEFAULT_PORTRAIT_TEXTURE_SYSTEM_PROMPT_ZH
  )
}

function persistSystemPrompt(): void {
  if (!node.value) return
  const selection = editor.selection.current.value
  graphEditorHosts.updateNode(selection.hostId, node.value.id, {
    generateSystemPrompt: systemPrompt.value
  })
}
</script>

<style scoped>
.node-inspector {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
  height: 100%;
  overflow: auto;
}

.node-inspector.empty {
  color: var(--text-muted);
  align-items: center;
  justify-content: center;
}

.before-after {
  flex: none;
  width: 100%;
  aspect-ratio: 1 / 1;
  max-height: 320px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg-panel);
  overflow: hidden;
}

.compare-pane {
  position: relative;
  width: 100%;
  height: 100%;
  cursor: col-resize;
  user-select: none;
  touch-action: none;
}

.compare-img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
  pointer-events: none;
}

.compare-img.before {
  z-index: 1;
}

.compare-divider {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  margin-left: -1px;
  background: var(--accent);
  z-index: 2;
  cursor: col-resize;
}

.compare-handle {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: var(--accent);
  border: 2px solid #fff;
  box-shadow: 0 1px 5px rgb(0 0 0 / 35%);
}

.compare-tag {
  position: absolute;
  top: 8px;
  padding: 2px 8px;
  font-size: 11px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--bg-elevated) 78%, transparent);
  color: var(--text);
  z-index: 3;
  pointer-events: none;
}

.compare-tag.before {
  left: 8px;
}

.compare-tag.after {
  right: 8px;
}

.compare-empty {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  font-size: 12px;
  text-align: center;
  padding: 20px;
  line-height: 1.5;
}

.head .type {
  font-size: 11px;
  color: var(--text-muted);
}

.head h2 {
  margin: 4px 0 0;
  font-size: 14px;
}

.hint {
  margin: 0;
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.4;
}

label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--text-muted);
}

.prompt-view {
  min-height: 120px;
  opacity: 0.9;
  cursor: default;
  background: var(--bg-elevated);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 8px 10px;
  font-size: 12px;
  line-height: 1.45;
  resize: vertical;
  font-family: inherit;
}
</style>
