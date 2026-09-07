<template>
  <StudioFloatingWindow
    :open="open"
    :title="t('stage2d.title')"
    :z-index="1200"
    :default-width="1180"
    :default-height="760"
    :min-width="880"
    :min-height="560"
    body-class="pad-none stage2d-body"
    @close="emit('close')"
  >
    <div
      v-if="open"
      class="stage2d"
    >
      <section class="pane layers-pane">
        <div class="section-label">
          {{ t('stage2d.layers') }}
        </div>
        <ul class="layers">
          <li
            v-for="(layer, index) in layers"
            :key="layer.id"
            class="layer"
            :class="{ active: layer.id === selectedId, hidden: !layer.visible }"
            @click="selectedId = layer.id"
          >
            <img
              v-if="thumbUrls[layer.id]"
              :src="thumbUrls[layer.id]"
              alt=""
            >
            <span
              v-else
              class="thumb-fallback"
            >🖼</span>
            <span
              class="name"
              :title="layer.sourceUrl"
            >{{ layer.name }}</span>
            <button
              type="button"
              class="icon"
              :title="t('stage2d.moveUp')"
              :disabled="index === 0"
              @click.stop="move(layer.id, -1)"
            >
              ↑
            </button>
            <button
              type="button"
              class="icon"
              :title="t('stage2d.moveDown')"
              :disabled="index === layers.length - 1"
              @click.stop="move(layer.id, 1)"
            >
              ↓
            </button>
            <button
              type="button"
              class="icon"
              :title="layer.visible ? t('stage2d.hide') : t('stage2d.show')"
              @click.stop="toggleVisible(layer.id)"
            >
              {{ layer.visible ? '👁' : '⃝' }}
            </button>
            <button
              type="button"
              class="icon danger"
              :title="t('stage2d.remove')"
              @click.stop="remove(layer.id)"
            >
              ✕
            </button>
          </li>
        </ul>
        <p
          v-if="!layers.length"
          class="hint"
        >
          {{ t('stage2d.noLayer') }}
        </p>
        <button
          type="button"
          class="primary"
          @click="pickerOpen = true"
        >
          {{ t('stage2d.addLayer') }}
        </button>
      </section>

      <section class="pane stage-pane">
        <div class="section-label">
          {{ t('stage2d.result') }}
        </div>
        <div class="stage checker">
          <img
            v-if="previewUrl"
            :src="previewUrl"
            alt=""
          >
          <p
            v-else
            class="hint"
          >
            {{ t('stage2d.resultEmpty') }}
          </p>
        </div>
        <p class="apply-hint">
          {{ layers.length ? `${scene.canvasWidth}×${scene.canvasHeight}` : '' }}
        </p>
      </section>

      <section class="pane">
        <div class="section-label">
          {{ t('stage2d.scene') }}
        </div>
        <div class="grid2">
          <label class="field">
            <span>{{ t('graph.align.canvasWidth') }}</span>
            <input
              type="number"
              min="16"
              max="8192"
              step="16"
              :value="scene.canvasWidth"
              @change="patchCanvas('canvasWidth', $event)"
            >
          </label>
          <label class="field">
            <span>{{ t('graph.align.canvasHeight') }}</span>
            <input
              type="number"
              min="16"
              max="8192"
              step="16"
              :value="scene.canvasHeight"
              @change="patchCanvas('canvasHeight', $event)"
            >
          </label>
        </div>

        <label class="field">
          <span>{{ t('stage2d.anchor') }}</span>
          <select
            :value="scene.anchor"
            @change="patchSceneAnchor($event)"
          >
            <option value="ground">
              {{ t('stage2d.anchorGround') }}
            </option>
            <option value="center">
              {{ t('stage2d.anchorCenter') }}
            </option>
          </select>
        </label>

        <label
          v-if="scene.anchor === 'ground'"
          class="slider"
        >
          <span>
            {{ t('stage2d.groundGap') }}<b>{{ Math.round(scene.groundRatio * 100) }}%</b>
          </span>
          <input
            type="range"
            min="0"
            max="0.5"
            step="0.01"
            :value="scene.groundRatio"
            @input="patchSceneGroundRatio($event)"
          >
        </label>

        <template v-if="selected">
          <div class="section-label">
            {{ t('stage2d.layer') }}
          </div>
          <label class="field">
            <span>{{ t('stage2d.layerName') }}</span>
            <input
              type="text"
              :value="selected.name"
              @change="patchLayerName($event)"
            >
          </label>
          <label class="field">
            <span>{{ t('stage2d.anchor') }}</span>
            <select
              :value="selected.align.anchor"
              @change="patchLayerAnchor($event)"
            >
              <option value="ground">
                {{ t('stage2d.anchorGround') }}
              </option>
              <option value="center">
                {{ t('stage2d.anchorCenter') }}
              </option>
            </select>
          </label>
          <label class="slider">
            <span>
              {{ t('stage2d.subjectHeight')
              }}<b>{{ Math.round(selected.align.contentHeightRatio * 100) }}%</b>
            </span>
            <input
              type="range"
              min="0.1"
              max="1"
              step="0.05"
              :value="selected.align.contentHeightRatio"
              @input="patchLayerRatio('contentHeightRatio', $event)"
            >
          </label>
          <label
            v-if="selected.align.anchor === 'ground'"
            class="slider"
          >
            <span>
              {{ t('stage2d.groundGap')
              }}<b>{{ Math.round(selected.align.groundRatio * 100) }}%</b>
            </span>
            <input
              type="range"
              min="0"
              max="0.5"
              step="0.01"
              :value="selected.align.groundRatio"
              @input="patchLayerRatio('groundRatio', $event)"
            >
          </label>
          <label class="check">
            <input
              type="checkbox"
              :checked="selected.align.fitWithinWidth"
              @change="patchLayerFit($event)"
            >
            <span>{{ t('stage2d.fitWidth') }}</span>
          </label>
        </template>

        <div class="row">
          <span class="hint">{{ error }}</span>
          <button
            type="button"
            class="primary"
            @click="save"
          >
            {{ t('stage2d.apply') }}
          </button>
        </div>
        <p class="apply-hint">
          {{ t('stage2d.applyHint') }}
        </p>
      </section>
    </div>
  </StudioFloatingWindow>

  <AssetImagePickDialog
    :open="pickerOpen"
    :selected-asset-ids="[]"
    :remaining="16"
    @confirm="addFromAssets"
    @cancel="pickerOpen = false"
  />
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  normalizeStage2dScene,
  DEFAULT_STAGE2D_SCENE,
  type Stage2dSceneState
} from '@shared/graph'
import { useStudioI18n } from '../composables/useStudioI18n'
import { composeStage2dCanvas } from '../features/graph/model/composeStage2dCanvas'
import { resolveAssetPreviewUrl } from '../features/media/assetUrlCache'
import { useProjectStore } from '../stores/project'
import AssetImagePickDialog from './AssetImagePickDialog.vue'
import StudioFloatingWindow from './StudioFloatingWindow.vue'

type StageLayer = Stage2dSceneState['layers'][number]

const props = defineProps<{
  open: boolean
  setup?: Stage2dSceneState | null
}>()

const emit = defineEmits<{
  close: []
  save: [payload: { stage2dScene: Stage2dSceneState; dataUrl?: string }]
}>()

const { t } = useStudioI18n()
const project = useProjectStore()

const scene = ref<Stage2dSceneState>(normalizeStage2dScene(props.setup ?? undefined))
const selectedId = ref('')
const thumbUrls = ref<Record<string, string>>({})
const previewUrl = ref('')
const error = ref('')
const pickerOpen = ref(false)
/** 渲染请求递增号：连续调参时丢弃过期结果 */
let renderToken = 0
/** 缩略图请求递增号：与渲染互不干扰，避免互相取消 */
let thumbToken = 0
let renderTimer: ReturnType<typeof setTimeout> | null = null

const layers = computed(() => scene.value.layers)
const selected = computed(
  () => layers.value.find((layer) => layer.id === selectedId.value) ?? null
)

/** 每次会话先把舞台状态对准节点当前 stage2dScene */
function applySetup(): void {
  const next = normalizeStage2dScene(props.setup ?? DEFAULT_STAGE2D_SCENE)
  scene.value = next
  selectedId.value = next.layers[0]?.id ?? ''
}

function commit(next: Stage2dSceneState): void {
  scene.value = normalizeStage2dScene(next)
  scheduleRender()
}

function patchCanvas(key: 'canvasWidth' | 'canvasHeight', event: Event): void {
  const raw = Number((event.target as HTMLInputElement).value)
  const clamped = Math.min(8192, Math.max(16, Math.round(raw)))
  commit({ ...scene.value, [key]: clamped })
}

function patchSceneAnchor(event: Event): void {
  const value = (event.target as HTMLSelectElement).value
  commit({ ...scene.value, anchor: value === 'center' ? 'center' : 'ground' })
}

function patchSceneGroundRatio(event: Event): void {
  commit({ ...scene.value, groundRatio: Number((event.target as HTMLInputElement).value) })
}

function patchLayer(id: string, patch: Partial<StageLayer>): void {
  commit({
    ...scene.value,
    layers: layers.value.map((layer) => (layer.id === id ? { ...layer, ...patch } : layer))
  })
}

function patchLayerName(event: Event): void {
  if (!selected.value) return
  patchLayer(selected.value.id, { name: (event.target as HTMLInputElement).value })
}

function patchLayerAnchor(event: Event): void {
  if (!selected.value) return
  const value = (event.target as HTMLSelectElement).value
  patchLayer(selected.value.id, {
    align: { ...selected.value.align, anchor: value === 'center' ? 'center' : 'ground' }
  })
}

function patchLayerRatio(key: 'contentHeightRatio' | 'groundRatio', event: Event): void {
  if (!selected.value) return
  const value = Number((event.target as HTMLInputElement).value)
  patchLayer(selected.value.id, { align: { ...selected.value.align, [key]: value } })
}

function patchLayerFit(event: Event): void {
  if (!selected.value) return
  const checked = (event.target as HTMLInputElement).checked
  patchLayer(selected.value.id, { align: { ...selected.value.align, fitWithinWidth: checked } })
}

/** 层序即 z 序：后层覆盖前层，上移 = 往前挪 */
function move(id: string, delta: number): void {
  const list = [...layers.value]
  const index = list.findIndex((layer) => layer.id === id)
  const target = index + delta
  if (index < 0 || target < 0 || target >= list.length) return
  const [picked] = list.splice(index, 1)
  list.splice(target, 0, picked)
  commit({ ...scene.value, layers: list })
}

function remove(id: string): void {
  commit({ ...scene.value, layers: layers.value.filter((layer) => layer.id !== id) })
  if (selectedId.value === id) selectedId.value = layers.value[0]?.id ?? ''
}

function toggleVisible(id: string): void {
  const layer = layers.value.find((item) => item.id === id)
  if (!layer) return
  patchLayer(id, { visible: !layer.visible })
}

/** 资产库选图即按当前锚点入层（拖入/选取都走这里） */
function addFromAssets(assetIds: string[]): void {
  pickerOpen.value = false
  const picked = assetIds
    .map((id) => project.assets.find((asset) => asset.id === id))
    .filter((asset): asset is NonNullable<typeof asset> => !!asset)
    .map((asset) => asset.relativePath?.trim())
    .filter((path): path is string => !!path)
  if (!picked.length) return
  const base = layers.value.length
  const added: StageLayer[] = picked.map((sourceUrl, index) => ({
    id: `layer-${Date.now()}-${base + index}`,
    name: `Layer ${base + index + 1}`,
    sourceUrl,
    align: {
      anchor: scene.value.anchor,
      contentHeightRatio: 0.9,
      groundRatio: scene.value.groundRatio,
      fitWithinWidth: true
    },
    visible: true
  }))
  commit({ ...scene.value, layers: [...layers.value, ...added] })
  selectedId.value = added[0]?.id ?? selectedId.value
}

/** 层源多为项目相对路径，先解析成可绘制 URL 再交给合成层 */
async function resolveLayerUrl(sourceUrl: string): Promise<string> {
  const raw = sourceUrl.trim()
  if (!raw) return ''
  if (/^(data:|https?:\/\/|blob:)/i.test(raw)) return raw
  try {
    return await resolveAssetPreviewUrl(raw)
  } catch {
    return ''
  }
}

async function render(): Promise<void> {
  const token = ++renderToken
  const urls = await Promise.all(layers.value.map((layer) => resolveLayerUrl(layer.sourceUrl)))
  const drawable = layers.value.filter((_, index) => !!urls[index])
  if (token !== renderToken) return
  if (!drawable.length) {
    previewUrl.value = ''
    error.value = ''
    return
  }
  const composeScene = normalizeStage2dScene({
    ...scene.value,
    layers: layers.value.map((layer, index) => ({ ...layer, sourceUrl: urls[index] ?? '' }))
  })
  try {
    const out = await composeStage2dCanvas({ state: composeScene })
    if (token !== renderToken) return
    previewUrl.value = out.dataUrl
    error.value = ''
  } catch (err) {
    if (token !== renderToken) return
    error.value = err instanceof Error ? err.message : String(err)
  }
}

function scheduleRender(): void {
  if (renderTimer) clearTimeout(renderTimer)
  renderTimer = setTimeout(() => {
    renderTimer = null
    void render()
  }, 120)
}

function save(): void {
  emit('save', {
    stage2dScene: normalizeStage2dScene(scene.value),
    ...(previewUrl.value ? { dataUrl: previewUrl.value } : {})
  })
}

/** 层缩略图：复用资产预览缓存，仅在源变化时补齐 */
async function resolveThumbs(): Promise<void> {
  const token = ++thumbToken
  const next: Record<string, string> = { ...thumbUrls.value }
  await Promise.all(
    layers.value.map(async (layer) => {
      if (next[layer.id]) return
      const url = await resolveLayerUrl(layer.sourceUrl)
      if (url) next[layer.id] = url
    })
  )
  if (token !== thumbToken) return
  thumbUrls.value = next
}

watch(
  () => props.open,
  (open) => {
    if (!open) {
      previewUrl.value = ''
      error.value = ''
      return
    }
    applySetup()
    void resolveThumbs()
    void render()
  },
  { immediate: true }
)

watch(scene, () => {
  if (!props.open) return
  void resolveThumbs()
  scheduleRender()
})
</script>

<style scoped>
.stage2d {
  display: grid;
  grid-template-columns: 280px 1fr 300px;
  gap: 16px;
  height: 100%;
  min-height: 0;
  padding: 16px;
  overflow: auto;
}

.pane {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

.layers-pane {
  min-height: 0;
}

.section-label {
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.layers {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1;
  min-height: 0;
  margin: 0;
  padding: 0;
  overflow: auto;
  list-style: none;
}

.layer {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-input);
  cursor: pointer;
}

.layer.active {
  border-color: var(--accent);
}

.layer.hidden .name {
  opacity: 0.5;
  text-decoration: line-through;
}

.layer img {
  width: 32px;
  height: 32px;
  object-fit: contain;
  border-radius: 4px;
  background: var(--bg-elevated);
}

.thumb-fallback {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: 4px;
  background: var(--bg-elevated);
  font-size: 14px;
}

.name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: var(--text-secondary);
}

.stage {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  min-height: 260px;
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
  background: var(--bg-input);
}

.stage img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}

/* 透明 PNG 棋盘底：wash 叠色跨主题自适应 */
.checker {
  background-color: var(--bg-input);
  background-image:
    linear-gradient(
      45deg,
      var(--wash-16) 25%,
      transparent 25%,
      transparent 75%,
      var(--wash-16) 75%
    ),
    linear-gradient(45deg, var(--wash-16) 25%, transparent 25%, transparent 75%, var(--wash-16) 75%);
  background-size: 16px 16px;
  background-position:
    0 0,
    8px 8px;
}

.grid2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.field {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
  color: var(--text-secondary);
}

.field input[type='number'] {
  width: 84px;
}

.field input[type='text'] {
  width: 140px;
}

.field select {
  min-width: 120px;
  max-width: 160px;
}

.slider {
  display: grid;
  gap: 4px;
  font-size: 12px;
}

.slider span {
  display: flex;
  justify-content: space-between;
}

.slider b {
  font-weight: 600;
}

.check {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
}

.row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: auto;
}

.row .hint {
  margin-right: auto;
  color: var(--danger);
}

.hint {
  margin: 0;
  font-size: 12px;
  color: var(--text-muted);
}

.apply-hint {
  margin: 0;
  font-size: 11px;
  color: var(--text-muted);
}

.icon {
  padding: 2px 6px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-elevated);
  color: var(--text);
  font-size: 12px;
  line-height: 1.4;
  cursor: pointer;
}

.icon:hover:not(:disabled) {
  background: var(--bg-hover);
}

.icon:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.icon.danger:hover {
  border-color: var(--danger);
  color: var(--danger);
}

button.primary {
  padding: 6px 14px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: var(--accent);
  color: var(--on-accent);
  font-size: 13px;
  cursor: pointer;
}

button.primary:hover {
  background: var(--accent-hover);
}
</style>
