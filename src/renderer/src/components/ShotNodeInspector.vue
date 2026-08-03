<template>
  <div class="node-inspector" v-if="node">
    <div class="head">
      <span class="role">{{ t('graph.nodeRole.generate') }}</span>
      <span class="type">{{ typeLabel }}</span>
      <h2>{{ node.title || typeLabel }}</h2>
    </div>
    <p class="hint">{{ t('graph.inspector.generate.hint') }}</p>

    <GraphNodeRunControl
      v-if="hasInPort"
      :status="runStatus"
      :is-running="isGraphRunning"
      :blocked="blocked"
      @toggle="toggleRun"
    />

    <label>
      {{ t('graph.inspector.displayName') }}
      <input v-model="localTitle" @change="persist" />
    </label>

    <div class="lock-field">
      <label class="lock-option">
        <input
          type="checkbox"
          :checked="locked"
          @change="onLockChange(($event.target as HTMLInputElement).checked)"
        />
        <span>
          <span class="lock-option-title">{{ t('graph.inspector.generate.lock') }}</span>
          <span class="field-hint">{{ t('graph.inspector.generate.lockHint') }}</span>
        </span>
      </label>
    </div>

    <section v-if="isImage || isVideo" class="style-section">
      <div class="style-toolbar-heading">
        <span class="style-toolbar-title">{{ t('project.globals.stylePreset') }}</span>
        <span class="style-toolbar-count">
          {{ displayedStyleImages.length }}/{{ styleImageMax }}
        </span>
      </div>
      <label class="style-global-check">
        <input
          type="checkbox"
          :checked="useGlobalStyle"
          @change="onUseGlobalStyleChange(($event.target as HTMLInputElement).checked)"
        />
        <span>{{ t('stylePicker.useGlobal') }}</span>
      </label>
      <p class="style-toolbar-hint">
        {{
          useGlobalStyle ? t('stylePicker.readonlyHint') : t('project.globals.styleImagesHint')
        }}
      </p>
      <StyleImagePicker
        :model-value="displayedStyleImages"
        :max="styleImageMax"
        :readonly="useGlobalStyle"
        :show-header="false"
        @update:model-value="onStyleImagesChange"
      />
    </section>

    <template v-if="isImage || isScreenplay || isVoice || isVideo">
      <section class="gen-config">
        <label>
          {{ t('graph.inspector.generate.systemPrompt') }}
          <ExpandableTextarea
            :key="`sys-${node.id}`"
            v-model="systemPrompt"
            :title="t('graph.inspector.generate.systemPrompt')"
            :rows="4"
            :placeholder="t('graph.inspector.generate.systemPromptPlaceholder')"
            @change="persistGenerateConfig"
          />
        </label>
        <p v-if="modelOptions.length === 0" class="hint">
          {{ modelsHint }}
        </p>
      </section>
    </template>

    <GraphNodeOutputPreview
      v-if="node && hostId && !isImage && !isScreenplay && !isVoice && !isVideo"
      :node="node"
      :host-id="hostId"
    />

    <section
      v-if="isImage"
      class="generated-images"
      :aria-label="t('graph.inspector.generate.generatedImages')"
    >
      <div class="section-head">
        <span class="section-title">{{ t('graph.inspector.generate.generatedImages') }}</span>
        <span v-if="generatedImages.length" class="section-count">
          {{ t('graph.inspector.generate.generatedImagesCount', { n: generatedImages.length }) }}
        </span>
      </div>
      <p class="section-hint">{{ t('graph.inspector.generate.generatedImagesHint') }}</p>
      <div v-if="!generatedImages.length" class="empty-shots">
        {{ t('graph.inspector.generate.generatedImagesEmpty') }}
      </div>
      <div v-else class="shot-grid">
        <div
          v-for="(shot, index) in generatedImages"
          :key="shot.id || `index:${index}`"
          class="shot-card"
          :class="{ selected: isSelectedImage(shot.id || `index:${index}`) }"
        >
          <button
            type="button"
            class="shot-thumb"
            :title="t('graph.inspector.generate.setAsOutput')"
            @click="selectGeneratedImage(shot.id || `index:${index}`)"
            @dblclick="openGeneratedPreview(shot.id || `index:${index}`)"
          >
            <img
              v-if="resolvedGeneratedSrc[shot.id || `index:${index}`]"
              :src="resolvedGeneratedSrc[shot.id || `index:${index}`]"
              alt=""
              loading="lazy"
              decoding="async"
            />
            <span v-else class="shot-loading">…</span>
            <span class="shot-index">{{ index + 1 }}</span>
          </button>
          <button
            type="button"
            class="shot-delete"
            :title="t('graph.inspector.generate.generatedImagesDelete')"
            @click.stop="removeGeneratedImage(shot.id)"
          >
            ×
          </button>
        </div>
      </div>
    </section>

    <section
      v-if="isScreenplay"
      class="generated-texts"
      :aria-label="t('graph.inspector.generate.generatedTexts')"
    >
      <div class="section-head">
        <span class="section-title">{{ t('graph.inspector.generate.generatedTexts') }}</span>
        <span v-if="generatedTexts.length" class="section-count">
          {{ t('graph.inspector.generate.generatedTextsCount', { n: generatedTexts.length }) }}
        </span>
      </div>
      <p class="section-hint">{{ t('graph.inspector.generate.generatedTextsHint') }}</p>
      <div v-if="!generatedTexts.length" class="empty-shots">
        {{ t('graph.inspector.generate.generatedTextsEmpty') }}
      </div>
      <div v-else class="text-grid">
        <div
          v-for="(item, index) in generatedTexts"
          :key="item.id || `index:${index}`"
          class="text-card"
          :class="{ selected: isSelectedText(item.id || `index:${index}`) }"
        >
          <button
            type="button"
            class="text-thumb"
            :title="t('graph.inspector.generate.setAsOutput')"
            @click="selectGeneratedText(item.id || `index:${index}`)"
            @dblclick="openGeneratedText(item.id || `index:${index}`)"
          >
            <pre class="text-snippet">{{ resolvedGeneratedText[item.id || `index:${index}`] || '…' }}</pre>
            <span class="shot-index">{{ index + 1 }}</span>
          </button>
          <button
            type="button"
            class="shot-delete"
            :title="t('graph.inspector.generate.generatedTextsDelete')"
            @click.stop="removeGeneratedText(item.id)"
          >
            ×
          </button>
        </div>
      </div>
    </section>

    <section
      v-if="isVoice"
      class="generated-voices"
      :aria-label="t('graph.inspector.generate.generatedVoices')"
    >
      <div class="section-head">
        <span class="section-title">{{ t('graph.inspector.generate.generatedVoices') }}</span>
        <span v-if="generatedVoices.length" class="section-count">
          {{ t('graph.inspector.generate.generatedVoicesCount', { n: generatedVoices.length }) }}
        </span>
      </div>
      <p class="section-hint">{{ t('graph.inspector.generate.generatedVoicesHint') }}</p>
      <div v-if="!generatedVoices.length" class="empty-shots">
        {{ t('graph.inspector.generate.generatedVoicesEmpty') }}
      </div>
      <div v-else class="shot-grid">
        <div
          v-for="(item, index) in generatedVoices"
          :key="item.id || `index:${index}`"
          class="shot-card audio-card"
          :class="{ selected: isSelectedVoice(item.id || `index:${index}`) }"
        >
          <button
            type="button"
            class="audio-thumb audio-thumb-btn"
            :title="t('graph.inspector.generate.setAsOutput')"
            @click="selectGeneratedVoice(item.id || `index:${index}`)"
          >
            <audio
              v-if="resolvedGeneratedVoiceSrc[item.id || `index:${index}`]"
              :src="resolvedGeneratedVoiceSrc[item.id || `index:${index}`]"
              controls
              preload="metadata"
              @click.stop
            />
            <span v-else class="shot-loading">…</span>
            <span class="shot-index">{{ index + 1 }}</span>
          </button>
          <button
            type="button"
            class="shot-delete"
            :title="t('graph.inspector.generate.generatedVoicesDelete')"
            @click.stop="removeGeneratedVoice(item.id)"
          >
            ×
          </button>
        </div>
      </div>
    </section>

    <section
      v-if="isVideo"
      class="generated-videos"
      :aria-label="t('graph.inspector.generate.generatedVideos')"
    >
      <div class="section-head">
        <span class="section-title">{{ t('graph.inspector.generate.generatedVideos') }}</span>
        <span v-if="generatedVideos.length" class="section-count">
          {{ t('graph.inspector.generate.generatedVideosCount', { n: generatedVideos.length }) }}
        </span>
      </div>
      <p class="section-hint">{{ t('graph.inspector.generate.generatedVideosHint') }}</p>
      <div v-if="!generatedVideos.length" class="empty-shots">
        {{ t('graph.inspector.generate.generatedVideosEmpty') }}
      </div>
      <div v-else class="shot-grid">
        <div
          v-for="(item, index) in generatedVideos"
          :key="item.id || `index:${index}`"
          class="shot-card video-card"
          :class="{ selected: isSelectedVideo(item.id || `index:${index}`) }"
        >
          <button
            type="button"
            class="video-thumb video-thumb-btn"
            :title="t('graph.inspector.generate.setAsOutput')"
            @click="selectGeneratedVideo(item.id || `index:${index}`)"
            @dblclick="openGeneratedVideoPreview(item.id || `index:${index}`)"
          >
            <video
              v-if="resolvedGeneratedVideoSrc[item.id || `index:${index}`]"
              :src="resolvedGeneratedVideoSrc[item.id || `index:${index}`]"
              muted
              playsinline
              preload="metadata"
              :title="t('graph.selectVideo.previewHint')"
              @click.stop
              @dblclick.stop="openGeneratedVideoPreview(item.id || `index:${index}`)"
            />
            <span v-else class="shot-loading">…</span>
            <span class="shot-index">{{ index + 1 }}</span>
          </button>
          <button
            type="button"
            class="shot-delete"
            :title="t('graph.inspector.generate.generatedVideosDelete')"
            @click.stop="removeGeneratedVideo(item.id)"
          >
            ×
          </button>
        </div>
      </div>
    </section>

    <GraphTextNotepadDialog
      :open="textNotepadOpen"
      :title="textNotepadTitle"
      :text="textNotepadBody"
      :editable="false"
      @close="textNotepadOpen = false"
    />
  </div>
  <div v-else class="node-inspector empty">{{ t('graph.inspector.node.empty') }}</div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import {
  DEFAULT_IMAGE_SYSTEM_PROMPT_EN,
  DEFAULT_IMAGE_SYSTEM_PROMPT_ZH,
  DEFAULT_SCREENPLAY_SYSTEM_PROMPT_EN,
  DEFAULT_SCREENPLAY_SYSTEM_PROMPT_ZH,
  DEFAULT_VIDEO_SYSTEM_PROMPT_EN,
  DEFAULT_VIDEO_SYSTEM_PROMPT_ZH,
  DEFAULT_VOICE_SYSTEM_PROMPT_EN,
  DEFAULT_VOICE_SYSTEM_PROMPT_ZH,
  defaultImageSystemPrompt,
  defaultScreenplaySystemPrompt,
  defaultVideoSystemPrompt,
  defaultTimbreSystemPrompt,
  isProcessingAssetNode,
  resolveImageSystemPrompt,
  resolveNodeType,
  resolveScreenplaySystemPrompt,
  resolveVideoSystemPrompt,
  resolveVoiceSystemPrompt
} from '@shared/graph'
import GraphNodeRunControl from './GraphNodeRunControl.vue'
import GraphNodeOutputPreview from './GraphNodeOutputPreview.vue'
import GraphTextNotepadDialog from './GraphTextNotepadDialog.vue'
import ExpandableTextarea from './ExpandableTextarea.vue'
import { useStudioI18n } from '../composables/useStudioI18n'
import { useGraphNodeRun } from '../composables/useGraphNodeRun'
import { useEditorKernel } from '../editor/kernel'
import { graphEditorHosts } from '../features/graph/model/graphEditorHosts'
import { graphRunHosts } from '../features/graph/model/graphRunHosts'
import {
  loadGenerateModelOptions,
  parseModelKey,
  preferredModelKey,
  type GenerateModelModality,
  type GenerateModelOption
} from '../features/graph/model/generateModelOptions'
import { useProjectStore } from '../stores/project'
import { openFullImagePreview } from '../features/media/openFullImagePreview'
import { invalidateAssetUrlCache } from '../features/media/assetUrlCache'
import { thumbRelativePathFor } from '@shared/media/thumbnailPath'
import {
  MAX_STYLE_IMAGES,
  createStyleImageId,
  normalizeProjectStyleImages,
  type ProjectStyleImage
} from '@shared/domain'
import StyleImagePicker from './StyleImagePicker.vue'

type StoredGeneratedImage = {
  id?: string
  dataUrl: string
  createdAt?: string
  relativePath?: string
}

type StoredGeneratedText = {
  id?: string
  text: string
  createdAt?: string
  relativePath?: string
}

type StoredGeneratedVoice = {
  id?: string
  createdAt?: string
  relativePath?: string
}

type StoredGeneratedVideo = {
  id?: string
  dataUrl?: string
  createdAt?: string
  relativePath?: string
}

const { t, locale, graphTypeLabel, assetTypeLabel } = useStudioI18n()
const editor = useEditorKernel()

const node = computed(() => {
  const selection = editor.selection.current.value
  const id = selection.kind === 'graph.node' ? selection.id : null
  if (!id) return null
  const current = graphEditorHosts.getNode(selection.hostId, id)
  if (!current || resolveNodeType(current)?.inspector !== 'asset' || !isProcessingAssetNode(current)) {
    return null
  }
  return current
})

const hostId = computed(() => {
  const selection = editor.selection.current.value
  return selection.kind === 'graph.node' ? selection.hostId ?? '' : ''
})

const { hasInPort, runStatus, isGraphRunning, blocked, toggleRun } = useGraphNodeRun(node)

const localTitle = ref('')
const localLabel = ref('')
const localWeight = ref(0.85)
const localNotes = ref('')
const localText = ref('')
const volume = ref(1)
const muted = ref(false)
const loop = ref(false)
const durationSec = ref(5)
const playbackRate = ref(1)

const modelOptions = ref<GenerateModelOption[]>([])
const selectedModelKey = ref('')
const systemPrompt = ref('')
const instruction = ref('')
const localStyleImages = ref<ProjectStyleImage[]>([])
/** 默认跟随全局风格 */
const useGlobalStyle = ref(true)
const loadedNodeId = ref<string | null>(null)
const loadedHostId = ref<string | null>(null)
const project = useProjectStore()

const styleImageMax = MAX_STYLE_IMAGES
const globalStyleImages = computed(() =>
  normalizeProjectStyleImages(project.config?.styleImages)
)
const displayedStyleImages = computed(() =>
  useGlobalStyle.value ? globalStyleImages.value : localStyleImages.value
)

function clearGenerateConfig(): void {
  loadedNodeId.value = null
  loadedHostId.value = null
  instruction.value = ''
  selectedModelKey.value = ''
  systemPrompt.value = ''
  modelOptions.value = []
  localStyleImages.value = []
  useGlobalStyle.value = true
}

function clearLocalFields(): void {
  localTitle.value = ''
  localLabel.value = ''
  localWeight.value = 0.85
  localNotes.value = ''
  localText.value = ''
  volume.value = 1
  muted.value = false
  loop.value = false
  durationSec.value = 5
  playbackRate.value = 1
  clearGenerateConfig()
}

const assetType = computed(() => node.value?.assetType)
const typeLabel = computed(() => {
  if (node.value?.typeId) return graphTypeLabel(node.value.typeId)
  return assetType.value ? assetTypeLabel(assetType.value) : t('graph.defaultNode')
})
const isImage = computed(() => assetType.value === 'image')
const isVideo = computed(() => assetType.value === 'video')
const isVoice = computed(() => assetType.value === 'voice')
const isScreenplay = computed(() => assetType.value === 'screenplay')
const hasGenerateConfig = computed(
  () =>
    isImage.value ||
    isScreenplay.value ||
    isVoice.value ||
    isVideo.value
)
const locked = computed(() => node.value?.params.locked === true)

function onLockChange(checked: boolean): void {
  const current = node.value
  const hid = hostId.value
  if (!current || !hid) return
  graphEditorHosts.updateNode(hid, current.id, { locked: checked })
}

const generatedImages = computed((): StoredGeneratedImage[] => {
  void graphEditorHosts.revision.value
  const current = node.value
  if (!current || !isImage.value) return []
  return (current.params.generatedImages ?? []).filter(
    (item) => item.id && (item.dataUrl?.trim() || item.relativePath?.trim())
  )
})

const resolvedGeneratedSrc = ref<Record<string, string>>({})
let resolveGeneratedToken = 0

async function resolveGeneratedPreviews(): Promise<void> {
  const token = ++resolveGeneratedToken
  const next: Record<string, string> = {}
  await Promise.all(
    generatedImages.value.map(async (item, index) => {
      const key = item.id || `index:${index}`
      const dataUrl = item.dataUrl?.trim()
      if (dataUrl && (dataUrl.startsWith('data:') || /^https?:\/\//i.test(dataUrl))) {
        next[key] = dataUrl
        return
      }
      const relativePath = item.relativePath?.trim()
      if (!relativePath) return
      try {
        next[key] = await window.studio.getAssetPreviewUrl(relativePath)
      } catch {
        /* skip */
      }
    })
  )
  if (token !== resolveGeneratedToken) return
  resolvedGeneratedSrc.value = next
}

watch(generatedImages, () => void resolveGeneratedPreviews(), { immediate: true, deep: true })

onBeforeUnmount(() => {
  resolveGeneratedToken += 1
})

function isSelectedImage(key: string): boolean {
  const current = node.value
  if (!current) return false
  const selected = current.params.selectedImageId?.trim()
  if (selected) return selected === key || selected === current.params.generatedImages?.find((i) => i.id === key)?.id
  const list = generatedImages.value
  const last = list[list.length - 1]
  return Boolean(last && (last.id || '') === key)
}

function selectGeneratedImage(key: string): void {
  const current = node.value
  const hid = hostId.value
  if (!current || !hid) return
  const list = generatedImages.value
  const index = list.findIndex((item, i) => (item.id || `index:${i}`) === key)
  const shot = index >= 0 ? list[index] : undefined
  if (!shot?.id) return
  // 先同步 runStates.out，再 updateNode→scheduleSave，避免落盘仍是旧 out
  syncRunOutputsAfterGeneratedChange(list, shot.id)
  graphEditorHosts.updateNode(hid, current.id, {
    selectedImageId: shot.id,
    previewDataUrl: shot.dataUrl?.trim() ? shot.dataUrl : '',
    previewRelativePath: shot.relativePath?.trim() ? shot.relativePath : ''
  })
  graphEditorHosts.bumpRevision()
}

function syncRunOutputsAfterGeneratedChange(
  items: StoredGeneratedImage[],
  selectedImageId?: string
): void {
  const current = node.value
  const hid = hostId.value
  if (!current || !hid) return
  const host = graphRunHosts.get(hid)
  if (!host) return
  const prev = host.runStates[current.id] ?? { status: 'done' as const }
  const selectedId =
    selectedImageId?.trim() ||
    current.params.selectedImageId?.trim() ||
    items[items.length - 1]?.id ||
    ''
  const picked =
    items.find((item) => item.id === selectedId) || items[items.length - 1]
  host.runStates[current.id] = {
    ...prev,
    status: prev.status === 'idle' ? 'done' : prev.status,
    outputs: {
      ...(prev.outputs ?? {}),
      out: {
        kind: 'image',
        id: picked?.id,
        dataUrl: picked?.dataUrl || '',
        createdAt: picked?.createdAt,
        ...(picked?.relativePath ? { relativePath: picked.relativePath } : {})
      },
      'out-all': {
        kind: 'images',
        items: items.map((item) => ({
          id: item.id,
          dataUrl: item.dataUrl || '',
          createdAt: item.createdAt,
          ...(item.relativePath ? { relativePath: item.relativePath } : {})
        }))
      }
    }
  }
}

function removeGeneratedImage(imageId: string | undefined): void {
  const current = node.value
  const hid = hostId.value
  if (!current || !hid || !imageId) return
  const removed = (current.params.generatedImages ?? []).find((item) => item.id === imageId)
  const next = (current.params.generatedImages ?? []).filter((item) => item.id !== imageId)
  const nextSelected =
    current.params.selectedImageId === imageId
      ? next[next.length - 1]?.id || ''
      : current.params.selectedImageId || next[next.length - 1]?.id || ''
  const selected = next.find((item) => item.id === nextSelected) || next[next.length - 1]
  syncRunOutputsAfterGeneratedChange(next, nextSelected)
  graphEditorHosts.updateNode(hid, current.id, {
    generatedImages: next,
    selectedImageId: nextSelected,
    previewDataUrl: selected?.dataUrl?.trim() ? selected.dataUrl : '',
    previewRelativePath: selected?.relativePath?.trim() ? selected.relativePath : ''
  })
  graphEditorHosts.bumpRevision()

  const relativePath = removed?.relativePath?.trim()
  if (relativePath) {
    invalidateAssetUrlCache(relativePath)
    invalidateAssetUrlCache(thumbRelativePathFor(relativePath))
    void window.studio.deleteGraphRunMedia(relativePath).catch((err) => {
      console.warn('[ShotNodeInspector] delete graph media failed', relativePath, err)
    })
  }
}

async function openGeneratedPreview(key: string): Promise<void> {
  const list = generatedImages.value
  const index = list.findIndex((item, i) => (item.id || `index:${i}`) === key)
  const shot = index >= 0 ? list[index] : undefined
  if (shot) {
    await openFullImagePreview({
      dataUrl: shot.dataUrl,
      relativePath: shot.relativePath
    })
    return
  }
  const url = resolvedGeneratedSrc.value[key]?.trim()
  if (!url) return
  await openFullImagePreview({ dataUrl: url })
}

const generatedTexts = computed((): StoredGeneratedText[] => {
  void graphEditorHosts.revision.value
  const current = node.value
  if (!current || !isScreenplay.value) return []
  return (current.params.generatedTexts ?? []).filter(
    (item) => item.id && (item.text?.trim() || item.relativePath?.trim())
  )
})

const resolvedGeneratedText = ref<Record<string, string>>({})
const textNotepadOpen = ref(false)
const textNotepadTitle = ref('')
const textNotepadBody = ref('')
let resolveGeneratedTextToken = 0

async function loadGeneratedTextBody(item: StoredGeneratedText): Promise<string> {
  const inline = item.text?.trim()
  if (inline) return item.text
  const relativePath = item.relativePath?.trim()
  if (!relativePath) return ''
  try {
    const url = await window.studio.getAssetFileUrl(relativePath)
    if (!url) return ''
    const res = await fetch(url)
    if (!res.ok) return ''
    return await res.text()
  } catch {
    return ''
  }
}

async function resolveGeneratedTextPreviews(): Promise<void> {
  const token = ++resolveGeneratedTextToken
  const next: Record<string, string> = {}
  await Promise.all(
    generatedTexts.value.map(async (item, index) => {
      const key = item.id || `index:${index}`
      const body = await loadGeneratedTextBody(item)
      const snippet = body.trim()
      next[key] = snippet
        ? snippet.length > 160
          ? `${snippet.slice(0, 160)}…`
          : snippet
        : item.relativePath?.trim() || '…'
    })
  )
  if (token !== resolveGeneratedTextToken) return
  resolvedGeneratedText.value = next
}

watch(generatedTexts, () => void resolveGeneratedTextPreviews(), { immediate: true, deep: true })

onBeforeUnmount(() => {
  resolveGeneratedTextToken += 1
})

function isSelectedText(key: string): boolean {
  const current = node.value
  if (!current) return false
  const selected = current.params.selectedTextId?.trim()
  if (selected) return selected === key
  const list = generatedTexts.value
  const last = list[list.length - 1]
  return Boolean(last && (last.id || '') === key)
}

function selectGeneratedText(key: string): void {
  const current = node.value
  const hid = hostId.value
  if (!current || !hid) return
  const list = generatedTexts.value
  const item = list.find((entry, i) => (entry.id || `index:${i}`) === key)
  if (!item?.id) return
  syncRunOutputsAfterGeneratedTextsChange(list, item.id)
  graphEditorHosts.updateNode(hid, current.id, {
    selectedTextId: item.id,
    text: item.text?.trim() ? item.text : current.params.text
  })
  graphEditorHosts.bumpRevision()
}

function syncRunOutputsAfterGeneratedTextsChange(
  items: StoredGeneratedText[],
  selectedTextId?: string
): void {
  const current = node.value
  const hid = hostId.value
  if (!current || !hid) return
  const host = graphRunHosts.get(hid)
  if (!host) return
  const prev = host.runStates[current.id] ?? { status: 'done' as const }
  const selectedId =
    selectedTextId?.trim() ||
    current.params.selectedTextId?.trim() ||
    items[items.length - 1]?.id ||
    ''
  const picked = items.find((item) => item.id === selectedId) || items[items.length - 1]
  host.runStates[current.id] = {
    ...prev,
    status: prev.status === 'idle' ? 'done' : prev.status,
    outputs: {
      ...(prev.outputs ?? {}),
      out: {
        kind: 'text',
        text: picked?.text ?? '',
        id: picked?.id,
        ...(picked?.relativePath ? { relativePath: picked.relativePath } : {})
      },
      'out-all': {
        kind: 'texts',
        items: items.map((item) => ({
          id: item.id,
          text: item.text,
          createdAt: item.createdAt,
          ...(item.relativePath ? { relativePath: item.relativePath } : {})
        }))
      }
    }
  }
}

function removeGeneratedText(textId: string | undefined): void {
  const current = node.value
  const hid = hostId.value
  if (!current || !hid || !textId) return
  const removed = (current.params.generatedTexts ?? []).find((item) => item.id === textId)
  const next = (current.params.generatedTexts ?? []).filter((item) => item.id !== textId)
  const nextSelected =
    current.params.selectedTextId === textId
      ? next[next.length - 1]?.id || ''
      : current.params.selectedTextId || next[next.length - 1]?.id || ''
  const latest = next.find((item) => item.id === nextSelected) || next[next.length - 1]
  syncRunOutputsAfterGeneratedTextsChange(next, nextSelected)
  graphEditorHosts.updateNode(hid, current.id, {
    generatedTexts: next,
    selectedTextId: nextSelected,
    text: latest?.text?.trim()
      ? latest.text
      : next.length
        ? current.params.text
        : ''
  })
  graphEditorHosts.bumpRevision()

  const relativePath = removed?.relativePath?.trim()
  if (relativePath) {
    invalidateAssetUrlCache(relativePath)
    void window.studio.deleteGraphRunMedia(relativePath).catch((err) => {
      console.warn('[ShotNodeInspector] delete graph text failed', relativePath, err)
    })
  }
}

async function openGeneratedText(key: string): Promise<void> {
  const list = generatedTexts.value
  const index = list.findIndex((item, i) => (item.id || `index:${i}`) === key)
  const item = index >= 0 ? list[index] : undefined
  if (!item) return
  const body = await loadGeneratedTextBody(item)
  textNotepadTitle.value = t('graph.inspector.generate.generatedTexts')
  textNotepadBody.value = body
  textNotepadOpen.value = true
}

const generatedVoices = computed((): StoredGeneratedVoice[] => {
  void graphEditorHosts.revision.value
  const current = node.value
  if (!current || !isVoice.value) return []
  return (current.params.generatedVoices ?? []).filter(
    (item) => item.id && item.relativePath?.trim()
  )
})

const resolvedGeneratedVoiceSrc = ref<Record<string, string>>({})
let resolveGeneratedVoiceToken = 0

async function resolveGeneratedVoicePreviews(): Promise<void> {
  const token = ++resolveGeneratedVoiceToken
  const next: Record<string, string> = {}
  await Promise.all(
    generatedVoices.value.map(async (item, index) => {
      const key = item.id || `index:${index}`
      const relativePath = item.relativePath?.trim()
      if (!relativePath) return
      try {
        next[key] = await window.studio.getAssetFileUrl(relativePath)
      } catch {
        /* skip */
      }
    })
  )
  if (token !== resolveGeneratedVoiceToken) return
  resolvedGeneratedVoiceSrc.value = next
}

watch(generatedVoices, () => void resolveGeneratedVoicePreviews(), {
  immediate: true,
  deep: true
})

onBeforeUnmount(() => {
  resolveGeneratedVoiceToken += 1
})

function isSelectedVoice(key: string): boolean {
  const current = node.value
  if (!current) return false
  const selected = current.params.selectedVoiceId?.trim()
  if (selected) return selected === key
  const list = generatedVoices.value
  const last = list[list.length - 1]
  return Boolean(last && (last.id || '') === key)
}

function selectGeneratedVoice(key: string): void {
  const current = node.value
  const hid = hostId.value
  if (!current || !hid) return
  const list = generatedVoices.value
  const item = list.find((entry, i) => (entry.id || `index:${i}`) === key)
  if (!item?.id) return
  syncRunOutputsAfterGeneratedVoicesChange(list, item.id)
  graphEditorHosts.updateNode(hid, current.id, {
    selectedVoiceId: item.id,
    previewRelativePath: item.relativePath?.trim() ? item.relativePath : ''
  })
  graphEditorHosts.bumpRevision()
}

function syncRunOutputsAfterGeneratedVoicesChange(
  items: StoredGeneratedVoice[],
  selectedVoiceId?: string
): void {
  const current = node.value
  const hid = hostId.value
  if (!current || !hid) return
  const host = graphRunHosts.get(hid)
  if (!host) return
  const prev = host.runStates[current.id] ?? { status: 'done' as const }
  const selectedId =
    selectedVoiceId?.trim() ||
    current.params.selectedVoiceId?.trim() ||
    items[items.length - 1]?.id ||
    ''
  const picked = items.find((item) => item.id === selectedId) || items[items.length - 1]
  host.runStates[current.id] = {
    ...prev,
    status: prev.status === 'idle' ? 'done' : prev.status,
    outputs: {
      ...(prev.outputs ?? {}),
      out: {
        kind: 'voice',
        id: picked?.id,
        createdAt: picked?.createdAt,
        ...(picked?.relativePath ? { relativePath: picked.relativePath } : {})
      },
      'out-all': {
        kind: 'voices',
        items: items.map((item) => ({
          id: item.id,
          createdAt: item.createdAt,
          ...(item.relativePath ? { relativePath: item.relativePath } : {})
        }))
      }
    }
  }
}

function removeGeneratedVoice(voiceId: string | undefined): void {
  const current = node.value
  const hid = hostId.value
  if (!current || !hid || !voiceId) return
  const removed = (current.params.generatedVoices ?? []).find((item) => item.id === voiceId)
  const next = (current.params.generatedVoices ?? []).filter((item) => item.id !== voiceId)
  const nextSelected =
    current.params.selectedVoiceId === voiceId
      ? next[next.length - 1]?.id || ''
      : current.params.selectedVoiceId || next[next.length - 1]?.id || ''
  const selected = next.find((item) => item.id === nextSelected) || next[next.length - 1]
  syncRunOutputsAfterGeneratedVoicesChange(next, nextSelected)
  graphEditorHosts.updateNode(hid, current.id, {
    generatedVoices: next,
    selectedVoiceId: nextSelected,
    previewRelativePath: selected?.relativePath?.trim() ? selected.relativePath : ''
  })
  graphEditorHosts.bumpRevision()

  const relativePath = removed?.relativePath?.trim()
  if (relativePath) {
    invalidateAssetUrlCache(relativePath)
    void window.studio.deleteGraphRunMedia(relativePath).catch((err) => {
      console.warn('[ShotNodeInspector] delete graph audio failed', relativePath, err)
    })
  }
}

const generatedVideos = computed((): StoredGeneratedVideo[] => {
  const current = node.value
  if (!current || !isVideo.value) return []
  return (current.params.generatedVideos ?? []).filter(
    (item) => item.relativePath?.trim() || item.dataUrl?.trim()
  )
})

const resolvedGeneratedVideoSrc = ref<Record<string, string>>({})
let resolveGeneratedVideoToken = 0

async function resolveGeneratedVideoPreviews(): Promise<void> {
  const token = ++resolveGeneratedVideoToken
  const next: Record<string, string> = {}
  await Promise.all(
    generatedVideos.value.map(async (item, index) => {
      const key = item.id || `index:${index}`
      const dataUrl = item.dataUrl?.trim()
      if (dataUrl) {
        next[key] = dataUrl
        return
      }
      const relativePath = item.relativePath?.trim()
      if (!relativePath) return
      try {
        next[key] = await window.studio.getAssetFileUrl(relativePath)
      } catch {
        /* skip */
      }
    })
  )
  if (token !== resolveGeneratedVideoToken) return
  resolvedGeneratedVideoSrc.value = next
}

watch(generatedVideos, () => void resolveGeneratedVideoPreviews(), {
  immediate: true,
  deep: true
})

onBeforeUnmount(() => {
  resolveGeneratedVideoToken += 1
})

function isSelectedVideo(key: string): boolean {
  const current = node.value
  if (!current) return false
  const selected = current.params.selectedVideoId?.trim()
  if (selected) return selected === key
  const list = generatedVideos.value
  const last = list[list.length - 1]
  return Boolean(last && (last.id || '') === key)
}

function selectGeneratedVideo(key: string): void {
  const current = node.value
  const hid = hostId.value
  if (!current || !hid) return
  const list = generatedVideos.value
  const item = list.find((entry, i) => (entry.id || `index:${i}`) === key)
  if (!item?.id) return
  syncRunOutputsAfterGeneratedVideosChange(list, item.id)
  graphEditorHosts.updateNode(hid, current.id, {
    selectedVideoId: item.id,
    previewDataUrl: item.dataUrl?.trim() ? item.dataUrl : '',
    previewRelativePath: item.relativePath?.trim() ? item.relativePath : ''
  })
  graphEditorHosts.bumpRevision()
}

async function openGeneratedVideoPreview(key: string): Promise<void> {
  const list = generatedVideos.value
  const index = list.findIndex((item, i) => (item.id || `index:${i}`) === key)
  const item = index >= 0 ? list[index] : undefined
  if (item) {
    await openFullImagePreview({
      dataUrl: item.dataUrl,
      relativePath: item.relativePath
    })
    return
  }
  const url = resolvedGeneratedVideoSrc.value[key]?.trim()
  if (!url) return
  await openFullImagePreview({ dataUrl: url })
}

function syncRunOutputsAfterGeneratedVideosChange(
  items: StoredGeneratedVideo[],
  selectedVideoId?: string
): void {
  const current = node.value
  const hid = hostId.value
  if (!current || !hid) return
  const host = graphRunHosts.get(hid)
  if (!host) return
  const prev = host.runStates[current.id] ?? { status: 'done' as const }
  const selectedId =
    selectedVideoId?.trim() ||
    current.params.selectedVideoId?.trim() ||
    items[items.length - 1]?.id ||
    ''
  const picked = items.find((item) => item.id === selectedId) || items[items.length - 1]
  host.runStates[current.id] = {
    ...prev,
    status: prev.status === 'idle' ? 'done' : prev.status,
    outputs: {
      ...(prev.outputs ?? {}),
      out: {
        kind: 'video',
        id: picked?.id,
        dataUrl: picked?.dataUrl || '',
        createdAt: picked?.createdAt,
        ...(picked?.relativePath ? { relativePath: picked.relativePath } : {})
      },
      'out-all': {
        kind: 'videos',
        items: items.map((item) => ({
          id: item.id,
          dataUrl: item.dataUrl || '',
          createdAt: item.createdAt,
          ...(item.relativePath ? { relativePath: item.relativePath } : {})
        }))
      }
    }
  }
}

function removeGeneratedVideo(videoId: string | undefined): void {
  const current = node.value
  const hid = hostId.value
  if (!current || !hid || !videoId) return
  const removed = (current.params.generatedVideos ?? []).find((item) => item.id === videoId)
  const next = (current.params.generatedVideos ?? []).filter((item) => item.id !== videoId)
  const nextSelected =
    current.params.selectedVideoId === videoId
      ? next[next.length - 1]?.id || ''
      : current.params.selectedVideoId || next[next.length - 1]?.id || ''
  const selected = next.find((item) => item.id === nextSelected) || next[next.length - 1]
  syncRunOutputsAfterGeneratedVideosChange(next, nextSelected)
  graphEditorHosts.updateNode(hid, current.id, {
    generatedVideos: next,
    selectedVideoId: nextSelected,
    previewDataUrl: selected?.dataUrl?.trim() ? selected.dataUrl : '',
    previewRelativePath: selected?.relativePath?.trim() ? selected.relativePath : ''
  })
  graphEditorHosts.bumpRevision()

  const relativePath = removed?.relativePath?.trim()
  if (relativePath) {
    invalidateAssetUrlCache(relativePath)
    void window.studio.deleteGraphRunMedia(relativePath).catch((err) => {
      console.warn('[ShotNodeInspector] delete graph video failed', relativePath, err)
    })
  }
}

const modelsHint = computed(() => {
  if (isImage.value) {
    return t('graph.inspector.generate.configureImageModelsHint')
  }
  if (isVoice.value) return t('graph.inspector.generate.configureAudioModelsHint')
  if (isVideo.value) return t('graph.inspector.generate.configureVideoModelsHint')
  return t('graph.inspector.generate.configureModelsHint')
})

async function loadModels(
  modality: GenerateModelModality,
  preferredKey?: string
): Promise<void> {
  const { options, selectedKey } = await loadGenerateModelOptions(
    modality,
    preferredKey,
    selectedModelKey.value
  )
  modelOptions.value = options
  selectedModelKey.value = selectedKey
}

function loadGenerateConfig(current: NonNullable<typeof node.value>): void {
  loadedNodeId.value = current.id
  loadedHostId.value = hostId.value
  instruction.value = current.params.generateInstruction ?? ''
  if (current.assetType === 'image' || current.assetType === 'video') {
    localStyleImages.value = normalizeProjectStyleImages(current.params.styleImages)
    useGlobalStyle.value = current.params.styleImagesUseGlobal !== false
  } else {
    localStyleImages.value = []
    useGlobalStyle.value = true
  }
  const preferred = preferredModelKey(
    current.params.generateProviderInstanceId,
    current.params.generateModel
  )

  if (current.assetType === 'image') {
    systemPrompt.value = resolveImageSystemPrompt(
      current.params.generateSystemPrompt,
      String(locale.value)
    )
    void loadModels('image', preferred)
    return
  }

  if (current.assetType === 'screenplay') {
    systemPrompt.value = resolveScreenplaySystemPrompt(
      current.params.generateSystemPrompt,
      String(locale.value)
    )
    void loadModels('text', preferred)
    return
  }

  if (current.assetType === 'voice') {
    systemPrompt.value = resolveVoiceSystemPrompt(
      current.params.generateSystemPrompt,
      String(locale.value)
    )
    void loadModels('audio', preferred)
    return
  }

  if (current.assetType === 'video') {
    systemPrompt.value = resolveVideoSystemPrompt(
      current.params.generateSystemPrompt,
      String(locale.value)
    )
    void loadModels('video', preferred)
  }
}

watch(
  node,
  (current) => {
    if (!current) {
      clearLocalFields()
      return
    }
    localTitle.value = current.title ?? typeLabel.value
    localLabel.value = current.params.label ?? ''
    localWeight.value = current.params.weight ?? 0.85
    localNotes.value = current.params.notes ?? ''
    localText.value = current.params.text ?? ''
    volume.value = current.params.volume ?? 1
    muted.value = current.params.muted === true
    loop.value = current.params.loop === true
    durationSec.value = current.params.durationSec ?? 5
    playbackRate.value = current.params.playbackRate ?? 1

    const sameNode =
      current.id === loadedNodeId.value && hostId.value === loadedHostId.value
    const hasGen =
      current.assetType === 'image' ||
      current.assetType === 'screenplay' ||
      current.assetType === 'voice' ||
      current.assetType === 'video'
    if (hasGen && !sameNode) {
      loadGenerateConfig(current)
    } else if (!hasGen) {
      clearGenerateConfig()
    }
  },
  { immediate: true }
)

watch(
  () => project.sessionEpoch,
  () => {
    clearLocalFields()
  }
)

watch(
  () => node.value?.params.text,
  (text) => {
    if (text !== undefined && text !== localText.value) {
      localText.value = text
    }
  }
)

watch(
  () => node.value?.params.generateInstruction,
  (value) => {
    if (!hasGenerateConfig.value) return
    const next = value ?? ''
    if (next !== instruction.value) instruction.value = next
  }
)

watch(
  () => node.value?.params.styleImages,
  (value) => {
    if (!(isImage.value || isVideo.value) || useGlobalStyle.value) return
    localStyleImages.value = normalizeProjectStyleImages(value)
  },
  { deep: true }
)

watch(
  () => node.value?.params.styleImagesUseGlobal,
  (value) => {
    if (!(isImage.value || isVideo.value)) return
    useGlobalStyle.value = value !== false
  }
)

watch(
  () =>
    [
      node.value?.params.generateProviderInstanceId,
      node.value?.params.generateModel
    ] as const,
  ([providerInstanceId, model]) => {
    if (!hasGenerateConfig.value) return
    const key = preferredModelKey(providerInstanceId, model)
    if (key && key !== selectedModelKey.value && modelOptions.value.some((o) => o.key === key)) {
      selectedModelKey.value = key
    }
  }
)

watch(isImage, (yes) => {
  if (yes) void loadModels('image', selectedModelKey.value)
})

watch(isScreenplay, (yes) => {
  if (yes) void loadModels('text', selectedModelKey.value)
})

watch(isVoice, (yes) => {
  if (yes) void loadModels('audio', selectedModelKey.value)
})

watch(isVideo, (yes) => {
  if (yes) void loadModels('video', selectedModelKey.value)
})

watch(locale, (next) => {
  const cur = systemPrompt.value.trim()
  if (isImage.value) {
    if (
      !cur ||
      cur === DEFAULT_IMAGE_SYSTEM_PROMPT_EN ||
      cur === DEFAULT_IMAGE_SYSTEM_PROMPT_ZH
    ) {
      systemPrompt.value = defaultImageSystemPrompt(String(next))
    }
    return
  }
  if (isScreenplay.value) {
    if (
      !cur ||
      cur === DEFAULT_SCREENPLAY_SYSTEM_PROMPT_EN ||
      cur === DEFAULT_SCREENPLAY_SYSTEM_PROMPT_ZH
    ) {
      systemPrompt.value = defaultScreenplaySystemPrompt(String(next))
    }
    return
  }
  if (isVoice.value) {
    if (
      !cur ||
      cur === DEFAULT_VOICE_SYSTEM_PROMPT_EN ||
      cur === DEFAULT_VOICE_SYSTEM_PROMPT_ZH
    ) {
      systemPrompt.value = defaultTimbreSystemPrompt(String(next))
    }
    return
  }
  if (isVideo.value) {
    if (
      !cur ||
      cur === DEFAULT_VIDEO_SYSTEM_PROMPT_EN ||
      cur === DEFAULT_VIDEO_SYSTEM_PROMPT_ZH
    ) {
      systemPrompt.value = defaultVideoSystemPrompt(String(next))
    }
  }
})

function persist(): void {
  if (!node.value) return
  const selection = editor.selection.current.value
  const parsed = parseModelKey(selectedModelKey.value)
  graphEditorHosts.updateNode(
    selection.hostId,
    node.value.id,
    {
      label: localLabel.value,
      weight: localWeight.value,
      notes: localNotes.value,
      text: localText.value,
      volume: volume.value,
      muted: muted.value,
      loop: loop.value,
      durationSec: Math.min(60, Math.max(1, Math.round(durationSec.value || 5))),
      playbackRate: playbackRate.value,
      ...(hasGenerateConfig.value
        ? {
            generateSystemPrompt: systemPrompt.value,
            generateInstruction: instruction.value,
            generateModel: parsed?.model ?? '',
            generateProviderInstanceId: parsed?.providerInstanceId ?? ''
          }
        : {})
    },
    localTitle.value.trim()
  )
}

function persistNodeStyleImages(useGlobal: boolean, images: ProjectStyleImage[]): void {
  const current = node.value
  const hid = hostId.value
  if (!current || !hid || !(isImage.value || isVideo.value)) return
  graphEditorHosts.updateNode(hid, current.id, {
    styleImagesUseGlobal: useGlobal,
    styleImages: normalizeProjectStyleImages(images)
  })
}

function persistGenerateConfig(): void {
  const current = node.value
  const hid = hostId.value
  if (!current || !hid || !hasGenerateConfig.value) return
  const parsed = parseModelKey(selectedModelKey.value)
  graphEditorHosts.updateNode(hid, current.id, {
    generateSystemPrompt: systemPrompt.value,
    generateInstruction: instruction.value,
    generateModel: parsed?.model ?? '',
    generateProviderInstanceId: parsed?.providerInstanceId ?? '',
    ...((isImage.value || isVideo.value)
      ? {
          styleImagesUseGlobal: useGlobalStyle.value,
          styleImages: normalizeProjectStyleImages(localStyleImages.value)
        }
      : {})
  })
}

function onUseGlobalStyleChange(checked: boolean): void {
  useGlobalStyle.value = checked
  if (!node.value || !(isImage.value || isVideo.value)) return
  // 取消全局时：本地为空则复制当前全局风格，避免「界面曾显示风格、节点实际未写入」
  if (!checked && localStyleImages.value.length === 0 && globalStyleImages.value.length > 0) {
    localStyleImages.value = normalizeProjectStyleImages(
      globalStyleImages.value.map((item) => ({
        ...item,
        id: createStyleImageId()
      }))
    )
  }
  persistNodeStyleImages(checked, localStyleImages.value)
}

function onStyleImagesChange(images: ProjectStyleImage[]): void {
  if (useGlobalStyle.value) return
  localStyleImages.value = normalizeProjectStyleImages(images)
  persistNodeStyleImages(false, localStyleImages.value)
}
</script>

<style scoped>
.node-inspector {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  height: 100%;
  overflow: auto;
}

.node-inspector.empty {
  color: var(--text-muted);
  align-items: center;
  justify-content: center;
}

.head .role {
  display: inline-block;
  font-size: 10px;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 4px;
  background: rgba(61, 180, 120, 0.22);
  color: var(--success);
  margin-right: 6px;
}

.head .type {
  font-size: 11px;
  color: var(--text-muted);
}

.head h2 {
  margin: 6px 0 0;
  font-size: 14px;
}

.style-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-elevated);
}

.style-toolbar-heading {
  display: flex;
  flex-direction: row;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}

.style-toolbar-title {
  font-size: 12px;
  color: var(--text-muted);
  white-space: nowrap;
}

.style-toolbar-count {
  font-size: 11px;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

label.style-global-check {
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  gap: 8px;
  margin: 0;
  width: 100%;
  max-width: 100%;
  box-sizing: border-box;
  cursor: pointer;
  font-size: 12px;
  color: var(--text);
  line-height: 1.35;
  user-select: none;
}

label.style-global-check input[type='checkbox'] {
  flex: none;
  width: 14px;
  height: 14px;
  margin: 2px 0 0;
  padding: 0;
  border: none;
  border-radius: 0;
  background: transparent;
  accent-color: var(--accent);
}

label.style-global-check > span {
  flex: 1;
  min-width: 0;
  white-space: normal;
}

.lock-field {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.lock-option {
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  gap: 8px;
  margin: 0;
  font-size: 12px;
  color: var(--text);
  line-height: 1.35;
  cursor: pointer;
  user-select: none;
}

.lock-option > input[type='checkbox'] {
  flex: none;
  width: 14px;
  height: 14px;
  margin: 2px 0 0;
  padding: 0;
  border: none;
  border-radius: 0;
  background: transparent;
  accent-color: var(--accent);
}

.lock-option > span {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.lock-option-title {
  color: var(--text);
}

.style-toolbar-hint {
  margin: 0;
  font-size: 11px;
  line-height: 1.4;
  color: var(--text-muted);
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

label.row {
  flex-direction: row;
  align-items: center;
  gap: 8px;
}

.path-row {
  display: flex;
  gap: 6px;
  align-items: center;
}

.path-row input {
  flex: 1;
  min-width: 0;
}

.btn {
  flex-shrink: 0;
  padding: 4px 10px;
  font-size: 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-elevated);
  color: var(--text);
  cursor: pointer;
}

.field-hint {
  font-size: 11px;
  color: var(--text-muted);
  opacity: 0.85;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--text-muted);
}

.field-label {
  line-height: 1.2;
}

select,
input,
textarea,
:deep(textarea) {
  font-size: 12px;
}

.gen-config {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-top: 4px;
  border-top: 1px solid var(--border);
  margin-top: 4px;
}

.generated-images,
.generated-texts,
.generated-voices {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-top: 10px;
  border-top: 1px solid var(--border);
}

.audio-card .audio-thumb {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 72px;
  padding: 10px 8px 18px;
  box-sizing: border-box;
}

.audio-card audio {
  width: 100%;
  max-width: 100%;
}

.text-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 8px;
}

.text-card {
  position: relative;
  border: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
  border-radius: 8px;
  overflow: hidden;
  background: var(--graph-preview-bg, var(--bg-elevated));
  min-height: 96px;
}

.text-thumb {
  display: block;
  width: 100%;
  min-height: 96px;
  padding: 8px;
  border: 0;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
  box-sizing: border-box;
}

.text-snippet {
  margin: 0;
  max-height: 120px;
  overflow: hidden;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 11px;
  line-height: 1.4;
  color: var(--text);
}

.section-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.section-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
}

.section-count {
  font-size: 11px;
  color: var(--text-muted);
}

.section-hint {
  margin: 0;
  font-size: 11px;
  color: var(--text-muted);
}

.empty-shots {
  padding: 16px 8px;
  text-align: center;
  font-size: 12px;
  color: var(--text-muted);
  border: 1px dashed var(--border);
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.15);
}

.shot-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.shot-card,
.text-card {
  position: relative;
  border-radius: 8px;
  overflow: hidden;
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
}

.shot-card.selected,
.text-card.selected {
  border-color: color-mix(in srgb, var(--accent, #5a8cff) 75%, var(--border));
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent, #5a8cff) 45%, transparent);
}

.audio-thumb-btn,
.video-thumb-btn {
  display: block;
  width: 100%;
  padding: 0;
  border: none;
  background: transparent;
  cursor: pointer;
  text-align: left;
}

.video-thumb-btn {
  aspect-ratio: 16 / 9;
  position: relative;
}

.video-thumb-btn video {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
  background: #000;
}

.shot-thumb {
  display: block;
  width: 100%;
  padding: 0;
  border: none;
  background: var(--graph-preview-bg, var(--bg-elevated));
  cursor: zoom-in;
  aspect-ratio: 1;
}

.shot-thumb img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.shot-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  min-height: 72px;
  color: var(--text-muted);
  font-size: 14px;
}

.shot-index {
  position: absolute;
  left: 6px;
  bottom: 6px;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 9px;
  background: rgba(0, 0, 0, 0.65);
  color: #fff;
  font-size: 10px;
  font-weight: 700;
  line-height: 18px;
  text-align: center;
  pointer-events: none;
}

.shot-delete {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 22px;
  height: 22px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: var(--panel-glass);
  color: var(--text);
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
}

.shot-delete:hover {
  background: rgba(180, 60, 60, 0.9);
  color: #fff;
}

</style>
