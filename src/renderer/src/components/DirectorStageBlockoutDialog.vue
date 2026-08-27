<template>
  <StudioFloatingWindow
    :open="open"
    :title="t('director.stage.blockoutTitle')"
    :default-width="560"
    :default-height="680"
    :min-width="440"
    :min-height="500"
    body-class="pad-none"
    @close="emitClose"
  >
    <div class="blockout-body">
      <div class="field">
        <span class="field-label">{{ t('director.stage.blockoutLayoutLabel') }}</span>
        <div
          class="layout-switch"
          role="radiogroup"
          :aria-label="t('director.stage.blockoutLayoutLabel')"
        >
          <button
            type="button"
            class="layout-opt"
            :class="{ active: layoutMode === 'perspective' }"
            :disabled="generating"
            @click="setLayoutMode('perspective')"
          >
            {{ t('director.stage.blockoutLayoutPerspective') }}
          </button>
          <button
            type="button"
            class="layout-opt"
            :class="{ active: layoutMode === 'panorama' }"
            :disabled="generating"
            @click="setLayoutMode('panorama')"
          >
            {{ t('director.stage.blockoutLayoutPanorama') }}
          </button>
        </div>
      </div>

      <label class="field">
        <span class="field-label">{{ t('director.stage.blockoutModelLabel') }}</span>
        <select
          v-model="modelKey"
          class="model-select"
          :disabled="generating"
        >
          <option
            v-if="!modelOptions.length"
            value=""
          >{{ t('director.stage.blockoutNoModels') }}</option>
          <option
            v-for="opt in modelOptions"
            :key="opt.key"
            :value="opt.key"
          >{{ opt.label }}</option>
        </select>
      </label>

      <label class="field">
        <span class="field-label">{{ t('director.stage.blockoutSystemLabel') }}</span>
        <textarea
          v-model="systemPrompt"
          class="system-prompt"
          rows="8"
          spellcheck="false"
          :disabled="generating"
        />
      </label>

      <div class="field instruction-field">
        <span class="field-label">{{ t('director.stage.blockoutInstructionLabel') }}</span>
        <div class="instruction-box">
          <div class="instruction-refs">
            <div
              v-for="(refItem, index) in references"
              :key="refItem.assetId"
              class="ref-chip"
              :title="refItem.name"
            >
              <span class="ref-index">{{ index + 1 }}</span>
              <img
                :src="refItem.previewUrl || refItem.dataUrl"
                class="ref-thumb"
                :alt="refItem.name"
              >
              <button
                type="button"
                class="ref-remove"
                :disabled="generating"
                :title="t('director.stage.blockoutRefRemove')"
                @click="removeReference(index)"
              >
                ×
              </button>
            </div>
            <button
              v-if="references.length < maxReferences"
              type="button"
              class="ref-add"
              :disabled="generating || addingLocal"
              :title="t('director.stage.blockoutRefAdd')"
              @click="onAddLocalClick"
            >
              {{ addingLocal ? '…' : '+' }}
            </button>
          </div>
          <textarea
            v-model="instruction"
            rows="4"
            spellcheck="false"
            :disabled="generating"
            :placeholder="defaultInstruction"
            @keydown="onInstructionKeydown"
          />
        </div>
        <button
          v-if="references.length < maxReferences"
          type="button"
          class="ghost-btn library-btn"
          :disabled="generating"
          @click="libraryOpen = true"
        >
          {{ t('director.stage.blockoutPickAsset') }}
        </button>
      </div>
    </div>

    <template #footer>
      <div class="blockout-footer">
        <span
          v-if="error"
          class="footer-error"
          :title="error"
        >{{ error }}</span>
        <span
          v-else
          class="footer-hint"
        >{{ t('director.stage.blockoutHint') }}</span>
        <button
          type="button"
          class="generate-btn"
          :disabled="generating || !canGenerate"
          @click="emitGenerate"
        >
          {{ generating ? t('director.stage.blockoutRunning') : t('director.stage.blockoutRun') }}
        </button>
      </div>
    </template>
  </StudioFloatingWindow>

  <AssetImagePickDialog
    :open="libraryOpen"
    :selected-asset-ids="referenceAssetIds"
    :remaining="libraryRemaining"
    @confirm="onLibraryConfirm"
    @cancel="libraryOpen = false"
  />
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import AssetImagePickDialog from './AssetImagePickDialog.vue'
import StudioFloatingWindow from './StudioFloatingWindow.vue'
import { useStudioI18n } from '../composables/useStudioI18n'
import {
  loadGenerateModelOptions,
  type GenerateModelOption
} from '../features/graph/model/generateModelOptions'
import {
  MAX_BLOCKOUT_REFERENCE_IMAGES,
  buildSceneBlockoutSystemPrompt,
  type BlockoutLayoutMode
} from '../features/director/aiSceneBlockout'
import { detectBlockoutLayoutMode } from '../features/director/equirectViews'
import { resolveAssetImageUrl } from '../features/graph/model/resolveGraphImageUrls'
import { resolveAssetPreviewUrl } from '../features/media/assetUrlCache'
import { useProjectStore } from '../stores/project'

interface BlockoutReference {
  assetId: string
  name: string
  previewUrl: string
  dataUrl: string
}

const props = defineProps<{
  open: boolean
  /** 舞台全景背景资产 id；仅 360 模式自动填入指令参考图 */
  initialAssetId: string
  generating: boolean
  error: string
}>()

const emit = defineEmits<{
  close: []
  generate: [
    payload: {
      providerInstanceId: string
      model: string
      system: string
      instruction: string
      images: string[]
      layoutMode: BlockoutLayoutMode
    }
  ]
}>()

const { t, locale } = useStudioI18n()
const project = useProjectStore()
const BLOCKOUT_MODEL_STORAGE_KEY = 'director.blockout.modelKey'

const maxReferences = MAX_BLOCKOUT_REFERENCE_IMAGES
const modelOptions = ref<GenerateModelOption[]>([])
const modelKey = ref('')
const systemPrompt = ref('')
const instruction = ref('')
const references = ref<BlockoutReference[]>([])
const libraryOpen = ref(false)
const addingLocal = ref(false)
const layoutMode = ref<BlockoutLayoutMode>('perspective')
const layoutModeManual = ref(false)
const autoAddedPanoramaAssetId = ref('')

const defaultInstruction = computed(() =>
  layoutMode.value === 'panorama'
    ? t('director.stage.blockoutDefaultInstructionPanorama')
    : t('director.stage.blockoutDefaultInstructionPerspective')
)

const canGenerate = computed(
  () => !!modelKey.value && !!instruction.value.trim() && references.value.length > 0
)
const referenceAssetIds = computed(() => references.value.map((item) => item.assetId))
const libraryRemaining = computed(() =>
  Math.max(0, maxReferences - references.value.length)
)

function applyLayoutMode(mode: BlockoutLayoutMode, options?: { resetInstruction?: boolean }): void {
  const prev = layoutMode.value
  layoutMode.value = mode
  systemPrompt.value = buildSceneBlockoutSystemPrompt(locale.value, mode)
  if (options?.resetInstruction || !instruction.value.trim() || instruction.value === defaultInstructionFor(prev)) {
    instruction.value = defaultInstructionFor(mode)
  }
}

function defaultInstructionFor(mode: BlockoutLayoutMode): string {
  return mode === 'panorama'
    ? t('director.stage.blockoutDefaultInstructionPanorama')
    : t('director.stage.blockoutDefaultInstructionPerspective')
}

function setLayoutMode(mode: BlockoutLayoutMode): void {
  layoutModeManual.value = true
  applyLayoutMode(mode, { resetInstruction: true })
  if (mode === 'panorama') void ensurePanoramaReference()
  else removeAutoAddedPanorama()
}

async function ensurePanoramaReference(): Promise<void> {
  const id = props.initialAssetId.trim()
  if (!id || references.value.some((item) => item.assetId === id)) return
  await addReferenceFromAsset(id)
  if (references.value.some((item) => item.assetId === id)) {
    autoAddedPanoramaAssetId.value = id
  }
}

function removeAutoAddedPanorama(): void {
  const id = autoAddedPanoramaAssetId.value
  if (!id) return
  const index = references.value.findIndex((item) => item.assetId === id)
  if (index >= 0) references.value.splice(index, 1)
  autoAddedPanoramaAssetId.value = ''
}

async function detectLayoutFromReferences(): Promise<void> {
  if (layoutModeManual.value) return
  const first = references.value[0]?.dataUrl
  if (!first) {
    applyLayoutMode('perspective')
    return
  }
  applyLayoutMode(await detectBlockoutLayoutMode(first))
}

watch(
  () => props.open,
  async (open) => {
    if (!open) return
    layoutModeManual.value = false
    autoAddedPanoramaAssetId.value = ''
    references.value = []
    libraryOpen.value = false
    applyLayoutMode('perspective', { resetInstruction: true })
    const preferred =
      localStorage.getItem(BLOCKOUT_MODEL_STORAGE_KEY) || modelOptions.value[0]?.key || undefined
    const { options, selectedKey } = await loadGenerateModelOptions('text', preferred)
    modelOptions.value = options
    modelKey.value = selectedKey || options[0]?.key || ''
  }
)

async function resolveReference(assetId: string): Promise<BlockoutReference | null> {
  const asset = project.assets.find((item) => item.id === assetId)
  if (!asset || asset.type !== 'image') return null
  const relativePath = asset.relativePath?.trim() || asset.thumbnailPath?.trim() || ''
  const [dataUrl, previewUrl] = await Promise.all([
    resolveAssetImageUrl(assetId),
    relativePath ? resolveAssetPreviewUrl(relativePath) : Promise.resolve('')
  ])
  if (!dataUrl) return null
  return {
    assetId,
    name: asset.name,
    previewUrl,
    dataUrl
  }
}

async function addReferenceFromAsset(assetId: string): Promise<void> {
  const id = assetId.trim()
  if (!id || generatingOrLimit()) return
  if (references.value.some((item) => item.assetId === id)) return
  const resolved = await resolveReference(id)
  if (resolved) {
    references.value.push(resolved)
    if (references.value.length === 1) await detectLayoutFromReferences()
  }
}

async function onLibraryConfirm(assetIds: string[]): Promise<void> {
  libraryOpen.value = false
  for (const id of assetIds) {
    if (references.value.length >= maxReferences) break
    await addReferenceFromAsset(id)
  }
}

function generatingOrLimit(): boolean {
  return props.generating || references.value.length >= maxReferences
}

function removeReference(index: number): void {
  if (props.generating) return
  const removed = references.value[index]
  references.value.splice(index, 1)
  if (removed && removed.assetId === autoAddedPanoramaAssetId.value) {
    autoAddedPanoramaAssetId.value = ''
  }
  if (!references.value.length) layoutModeManual.value = false
  void detectLayoutFromReferences()
}

async function onAddLocalClick(): Promise<void> {
  if (generatingOrLimit() || addingLocal.value) return
  addingLocal.value = true
  try {
    const filePaths = await window.studio.selectFiles([
      { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }
    ])
    if (!filePaths?.length) return
    const remaining = maxReferences - references.value.length
    const result = await window.studio.importAssets({
      filePaths: filePaths.slice(0, remaining),
      folderId: null
    })
    project.patchAssets(result.imported)
    for (const asset of result.imported) {
      if (references.value.length >= maxReferences) break
      await addReferenceFromAsset(asset.id)
    }
  } finally {
    addingLocal.value = false
  }
}

function emitClose(): void {
  if (props.generating) return
  libraryOpen.value = false
  emit('close')
}

function emitGenerate(): void {
  if (!canGenerate.value || props.generating) return
  const opt = modelOptions.value.find((item) => item.key === modelKey.value)
  if (!opt) return
  localStorage.setItem(BLOCKOUT_MODEL_STORAGE_KEY, modelKey.value)
  emit('generate', {
    providerInstanceId: opt.providerInstanceId,
    model: opt.model,
    system: systemPrompt.value,
    instruction: instruction.value,
    images: references.value.map((item) => item.dataUrl),
    layoutMode: layoutMode.value
  })
}

function onInstructionKeydown(event: KeyboardEvent): void {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault()
    emitGenerate()
  }
}
</script>

<style scoped>
.blockout-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 14px;
  overflow: auto;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-height: 0;
}

.field-label {
  font-size: 11px;
  color: var(--text-muted);
}

.instruction-box {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-input);
}

.instruction-box:focus-within {
  border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
}

.instruction-box textarea {
  border: none;
  background: transparent;
  padding: 0;
  min-height: 72px;
}

.instruction-box textarea:focus {
  outline: none;
  border: none;
}

.instruction-refs {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  min-height: 48px;
}

.ref-chip {
  position: relative;
  flex: none;
  width: 48px;
  height: 48px;
}

.ref-thumb {
  display: block;
  width: 48px;
  height: 48px;
  object-fit: cover;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--bg-elevated, var(--bg-panel));
}

.ref-index {
  position: absolute;
  left: 4px;
  top: 4px;
  z-index: 1;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--bg) 70%, #000 30%);
  color: #fff;
  font-size: 10px;
  font-weight: 700;
  line-height: 16px;
  text-align: center;
  pointer-events: none;
}

.ref-remove {
  position: absolute;
  top: -6px;
  right: -6px;
  width: 16px;
  height: 16px;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 50%;
  background: var(--bg-panel);
  color: var(--text-muted);
  font-size: 11px;
  line-height: 14px;
  cursor: pointer;
}

.ref-remove:hover:not(:disabled) {
  color: var(--text);
  border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
}

.ref-add {
  flex: none;
  width: 48px;
  height: 48px;
  border: 1px dashed var(--border);
  border-radius: 8px;
  background: transparent;
  color: var(--text-muted);
  font-size: 20px;
  cursor: pointer;
}

.ref-add:hover:not(:disabled) {
  color: var(--accent);
  border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
}

.library-btn {
  align-self: flex-start;
}

.layout-switch {
  display: flex;
  gap: 0;
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
}

.layout-opt {
  flex: 1;
  height: 26px;
  padding: 0 8px;
  border: none;
  background: var(--bg-input);
  color: var(--text-muted);
  font-size: 12px;
  cursor: pointer;
}

.layout-opt + .layout-opt {
  border-left: 1px solid var(--border);
}

.layout-opt.active {
  background: color-mix(in srgb, var(--accent) 18%, var(--bg-input));
  color: var(--text);
}

.layout-opt:disabled {
  opacity: 0.55;
  cursor: default;
}

.model-select {
  height: 26px;
  padding: 0 6px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-input);
  color: var(--text);
  font-size: 12px;
}

textarea {
  width: 100%;
  box-sizing: border-box;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-input);
  color: var(--text);
  font-size: 12px;
  line-height: 1.5;
  resize: vertical;
}

textarea:focus,
.model-select:focus {
  border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
  outline: none;
}

.ghost-btn {
  flex: none;
  height: 26px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-input);
  color: var(--text);
  font-size: 11px;
  cursor: pointer;
}

.ghost-btn:hover:not(:disabled) {
  border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
  color: var(--accent);
}

.ghost-btn:disabled,
.ref-add:disabled,
.ref-remove:disabled {
  opacity: 0.5;
  cursor: default;
}

.blockout-footer {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-top: 1px solid var(--border);
}

.footer-error,
.footer-hint {
  flex: 1;
  min-width: 0;
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.footer-error {
  color: var(--danger, #e05a5a);
}

.footer-hint {
  color: var(--text-muted);
}

.generate-btn {
  flex: none;
  height: 28px;
  padding: 0 16px;
  border: none;
  border-radius: 6px;
  background: var(--accent, #4a90e2);
  color: #fff;
  font-size: 12px;
  cursor: pointer;
}

.generate-btn:hover:not(:disabled) {
  filter: brightness(1.08);
}

.generate-btn:disabled {
  opacity: 0.55;
  cursor: default;
}
</style>
