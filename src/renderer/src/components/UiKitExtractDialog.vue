<template>
  <StudioFloatingWindow
    :open="state.open"
    :title="t('uiKitExtract.title')"
    :z-index="2200"
    :default-width="1320"
    :default-height="800"
    :min-width="1020"
    :min-height="600"
    body-class="pad-none ui-kit-extract-body"
    @close="closeUiKitExtractDialog"
  >
    <div v-if="state.open" class="extract">
      <!-- 左侧：部件清单 + 导出 -->
      <aside class="side-pane">
        <div class="pane-title">
          {{ t('uiKitExtract.partsTitle', { n: parts.length }) }}
        </div>
        <div class="tool-row">
          <button
            type="button"
            class="tool"
            :class="{ active: tool === 'box' }"
            @click="setTool('box')"
          >
            <span aria-hidden="true">▣</span>
            {{ t('uiKitExtract.toolBox') }}
          </button>
          <button
            type="button"
            class="tool"
            :class="{ active: tool === 'select' }"
            :disabled="parts.length === 0"
            @click="setTool('select')"
          >
            <span aria-hidden="true">🖱</span>
            {{ t('uiKitExtract.toolSelect') }}
          </button>
        </div>
        <ul v-if="parts.length" class="part-list">
          <li
            v-for="(p, index) in parts"
            :key="p.id"
            :class="{ active: p.id === selectedId }"
            @click="selectPart(p.id)"
          >
            <span class="part-no">{{ index + 1 }}</span>
            <span class="part-name" :title="uiKitPartFileName(p)">{{ p.name }}</span>
            <span class="part-kind">{{ t(`uiKitExtract.kind.${p.kind}`) }}</span>
          </li>
        </ul>
        <p v-else class="hint empty">
          {{ t('uiKitExtract.emptyParts') }}
        </p>
        <div class="side-footer">
          <button
            type="button"
            class="primary"
            :disabled="busy || parts.length === 0"
            @click="exportParts"
          >
            {{ busy ? t('uiKitExtract.exporting') : t('uiKitExtract.export') }}
          </button>
          <p v-if="exportMsg" class="msg">
            {{ exportMsg }}
          </p>
        </div>
      </aside>

      <!-- 中部：整屏图 + 框选 -->
      <section class="stage-pane">
        <div class="pane-head">
          <div class="pane-title">
            {{ sourceLabel }}
          </div>
          <div class="zoom-row">
            <button type="button" class="zoom-btn" title="−" @click="zoomBy(0.8)">−</button>
            <span class="zoom-val">{{ Math.round(zoom * 100) }}%</span>
            <button type="button" class="zoom-btn" title="+" @click="zoomBy(1.25)">+</button>
          </div>
        </div>
        <div ref="scrollEl" class="stage-scroll">
          <div
            v-if="naturalW > 0"
            ref="stageEl"
            class="stage"
            :style="{ width: `${displayW}px`, height: `${displayH}px` }"
            @pointerdown.prevent="onStagePointerDown"
            @pointermove="onStagePointerMove"
            @pointerup.prevent="onStagePointerUp"
            @pointercancel="cancelDrawing"
          >
            <img :src="state.url" :width="displayW" :height="displayH" draggable="false" alt="" />
            <div
              v-for="p in parts"
              :key="p.id"
              class="box"
              :class="{ active: p.id === selectedId }"
              :style="boxStyle(p.rect)"
            >
              <span v-if="p.id === selectedId" class="box-tag">{{ uiKitPartFileName(p) }}</span>
            </div>
            <div v-if="draft" class="box draft" :style="boxStyle(draft)" />
          </div>
          <p v-else class="hint stage-hint">
            {{ imageError || t('uiKitExtract.loading') }}
          </p>
        </div>
        <p v-if="naturalW > 0" class="hint stage-footer">
          {{ t('uiKitExtract.stageHint') }}
        </p>
      </section>

      <!-- 右侧：选中部件标注参数 -->
      <aside class="detail-pane">
        <template v-if="selected">
          <div class="pane-title">
            {{ t('uiKitExtract.partParams') }}
          </div>
          <label class="field">
            <span>{{ t('uiKitExtract.fields.kind') }}</span>
            <select :value="selected.kind" @change="onKindChange(inputVal($event.target))">
              <option v-for="kind in UI_KIT_PART_KINDS" :key="kind" :value="kind">
                {{ t(`uiKitExtract.kind.${kind}`) }}
              </option>
            </select>
          </label>
          <label class="field">
            <span>{{ t('uiKitExtract.fields.name') }}</span>
            <input :value="selected.name" @change="onNameChange(inputVal($event.target))" />
          </label>
          <code class="file-name">{{ uiKitPartFileName(selected) }}</code>

          <div class="field-group">
            <span class="group-label">{{ t('uiKitExtract.fields.rect') }}</span>
            <div class="grid-4">
              <label>
                <span>{{ t('uiKitExtract.fields.x') }}</span>
                <input
                  type="number"
                  min="0"
                  :value="selected.rect.x"
                  @change="onRectChange('x', toNum($event.target))"
                />
              </label>
              <label>
                <span>{{ t('uiKitExtract.fields.y') }}</span>
                <input
                  type="number"
                  min="0"
                  :value="selected.rect.y"
                  @change="onRectChange('y', toNum($event.target))"
                />
              </label>
              <label>
                <span>{{ t('uiKitExtract.fields.width') }}</span>
                <input
                  type="number"
                  min="1"
                  :value="selected.rect.width"
                  @change="onRectChange('width', toNum($event.target))"
                />
              </label>
              <label>
                <span>{{ t('uiKitExtract.fields.height') }}</span>
                <input
                  type="number"
                  min="1"
                  :value="selected.rect.height"
                  @change="onRectChange('height', toNum($event.target))"
                />
              </label>
            </div>
          </div>

          <div class="field-group">
            <span class="group-label">{{ t('uiKitExtract.fields.border') }}</span>
            <InsetEditor :value="selected.border" @change="onBorderChange" />
            <p class="hint">
              {{ t('uiKitExtract.fields.borderHint') }}
            </p>
          </div>
          <div class="field-group">
            <span class="group-label">{{ t('uiKitExtract.fields.safe') }}</span>
            <InsetEditor :value="selected.safe" @change="onSafeChange" />
            <p class="hint">
              {{ t('uiKitExtract.fields.safeHint') }}
            </p>
          </div>

          <div class="pane-title preview-title">
            {{ t('uiKitExtract.preview.label') }}
          </div>
          <label class="field factor">
            <span>{{ t('uiKitExtract.preview.factor') }}</span>
            <select v-model.number="previewFactor">
              <option :value="1.5">1.5×</option>
              <option :value="2">2×</option>
              <option :value="3">3×</option>
            </select>
          </label>
          <div v-if="cropDataUrl" class="preview-crop">
            <span class="group-label">{{ t('uiKitExtract.preview.crop') }}</span>
            <div class="checker img-frame">
              <img :src="cropDataUrl" alt="" />
            </div>
            <span class="group-label dims"
              >{{ selected.rect.width }}×{{ selected.rect.height }}px</span
            >
          </div>
          <div class="preview-stretch">
            <span class="group-label">{{
              t('uiKitExtract.preview.wide', { n: previewFactor })
            }}</span>
            <canvas ref="wideCanvas" class="checker prev-canvas" />
            <span class="group-label">{{
              t('uiKitExtract.preview.tall', { n: previewFactor })
            }}</span>
            <canvas ref="tallCanvas" class="checker prev-canvas" />
          </div>

          <button type="button" class="danger" @click="removeSelected">
            {{ t('uiKitExtract.delete') }}
          </button>
        </template>
        <div v-else class="pane-placeholder">
          <p class="hint">
            {{ t('uiKitExtract.noSelection') }}
          </p>
        </div>
      </aside>
    </div>
  </StudioFloatingWindow>
</template>

<script setup lang="ts">
import { computed, nextTick, onScopeDispose, reactive, ref, watch } from 'vue'
import {
  UI_KIT_PART_KINDS,
  UI_KIT_PART_KIND_PREFIXES,
  buildUiKitManifest,
  clampInsetToSize,
  clampUiKitRect,
  defaultUiKitPartName,
  normalizeUiKitDocument,
  sanitizeUiKitPartName,
  uiKitPartFileName,
  type UiKitInset,
  type UiKitPart
} from '@shared/gameAssets'
import { useStudioI18n } from '../composables/useStudioI18n'
import {
  closeUiKitExtractDialog,
  uiKitExtractDialogState
} from '../features/uiKit/uiKitExtractDialog'
import {
  cropUiKitPartPng,
  loadUiKitSourceImage,
  paintUiKitNineSlice
} from '../features/uiKit/uiKitRender'
import { useProjectStore } from '../stores/project'
import InsetEditor from './InsetEditor.vue'
import StudioFloatingWindow from './StudioFloatingWindow.vue'

const { t } = useStudioI18n()
const state = uiKitExtractDialogState
const project = useProjectStore()

const parts = ref<UiKitPart[]>([])
const selectedId = ref('')
const tool = ref<'box' | 'select'>('box')
const naturalW = ref(0)
const naturalH = ref(0)
const image = ref<HTMLImageElement | null>(null)
const imageError = ref('')
const busy = ref(false)
const exportMsg = ref('')
const cropDataUrl = ref('')
const previewFactor = ref(2)

const scrollEl = ref<HTMLElement | null>(null)
const stageEl = ref<HTMLElement | null>(null)
const wideCanvas = ref<HTMLCanvasElement | null>(null)
const tallCanvas = ref<HTMLCanvasElement | null>(null)

/** 舞台几何：基准适配 + 用户缩放 */
const zoom = ref(1)
const fitScale = ref(1)
const scale = computed(() => fitScale.value * zoom.value)
const displayW = ref(0)
const displayH = ref(0)

/** 正在拖拽框选的草稿矩形（源图自然像素） */
const drawing = ref(false)
const draft = ref<{ x: number; y: number; width: number; height: number } | null>(null)
let draftStart = { x: 0, y: 0 }

const selected = computed(() => parts.value.find((p) => p.id === selectedId.value) ?? null)
const sourceLabel = computed(
  () => `${t('uiKitExtract.stageTitle')} · ${state.name || state.relativePath || ''}`
)
interface RawRect {
  x: number
  y: number
  width: number
  height: number
}
function boxStyle(r: RawRect): Record<string, string> {
  const s = scale.value
  return {
    left: `${r.x * s}px`,
    top: `${r.y * s}px`,
    width: `${Math.max(0, r.width * s)}px`,
    height: `${Math.max(0, r.height * s)}px`
  }
}

function toNum(target: EventTarget | null): number {
  const el = target as HTMLInputElement | null
  const n = Number(el?.value)
  return Number.isFinite(n) ? n : 0
}

function inputVal(target: EventTarget | null): string {
  const el = target as HTMLInputElement | null
  return el?.value ?? ''
}

let layoutTimer: ReturnType<typeof setTimeout> | null = null
function scheduleLayout(): void {
  if (layoutTimer) return
  layoutTimer = setTimeout(() => {
    layoutTimer = null
    layoutStage()
  }, 30)
}

function layoutStage(): void {
  const el = scrollEl.value
  if (!el || naturalW.value <= 0 || naturalH.value <= 0) return
  const availW = Math.max(80, el.clientWidth - 4)
  const availH = Math.max(80, el.clientHeight - 4)
  fitScale.value = Math.min(availW / naturalW.value, availH / naturalH.value, 1)
  const s = scale.value
  displayW.value = Math.max(1, Math.round(naturalW.value * s))
  displayH.value = Math.max(1, Math.round(naturalH.value * s))
}

function zoomBy(factor: number): void {
  zoom.value = Math.min(8, Math.max(0.2, zoom.value * factor))
  layoutStage()
}

/** 指针坐标 → 源图自然像素坐标 */
function toNaturalPos(e: PointerEvent): { x: number; y: number } | null {
  const el = stageEl.value
  if (!el || scale.value <= 0) return null
  const rect = el.getBoundingClientRect()
  return {
    x: (e.clientX - rect.left) / scale.value,
    y: (e.clientY - rect.top) / scale.value
  }
}

function onStagePointerDown(e: PointerEvent): void {
  if (tool.value === 'select') {
    // 点空白取消选择
    const pos = toNaturalPos(e)
    if (!pos) return
    const hit = [...parts.value].reverse().find((p) => pointInRect(pos, p.rect))
    if (hit) selectPart(hit.id)
    else selectedId.value = ''
    return
  }
  const pos = toNaturalPos(e)
  if (!pos) return
  stageEl.value?.setPointerCapture?.(e.pointerId)
  drawing.value = true
  draftStart = pos
  draft.value = { x: pos.x, y: pos.y, width: 0, height: 0 }
}

function onStagePointerMove(e: PointerEvent): void {
  if (!drawing.value) return
  const pos = toNaturalPos(e)
  if (pos) updateDraft(pos)
}

function onStagePointerUp(e: PointerEvent): void {
  if (!drawing.value) return
  const pos = toNaturalPos(e)
  drawing.value = false
  if (pos) updateDraft(pos)
  const d = draft.value
  draft.value = null
  if (!d) return
  const rect = clampUiKitRect(
    { x: d.x, y: d.y, width: d.width, height: d.height },
    naturalW.value,
    naturalH.value
  )
  if (rect.width < 3 || rect.height < 3) return
  createPart(rect)
  setTool('select')
}

function cancelDrawing(): void {
  drawing.value = false
  draft.value = null
}

function updateDraft(pos: { x: number; y: number }): void {
  if (!draft.value) return
  const x0 = Math.min(draftStart.x, pos.x)
  const y0 = Math.min(draftStart.y, pos.y)
  draft.value = {
    x: x0,
    y: y0,
    width: Math.abs(pos.x - draftStart.x),
    height: Math.abs(pos.y - draftStart.y)
  }
}

let partSeq = 0
function createPart(rect: RawRect): void {
  const kind: UiKitPart['kind'] = 'panel'
  const index = parts.value.length
  const id = `ui-kit-part-${Date.now()}-${partSeq++}`
  const name = nextFreePartName(defaultUiKitPartName(kind, index))
  parts.value.push(
    reactive<UiKitPart>({
      id,
      kind,
      name,
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      border: { left: 0, top: 0, right: 0, bottom: 0 },
      safe: { left: 0, top: 0, right: 0, bottom: 0 }
    })
  )
  selectedId.value = id
  exportMsg.value = ''
}

function nextFreePartName(base: string): string {
  const used = new Set(parts.value.map((p) => p.name))
  let name = base
  let suffix = 2
  while (used.has(name)) {
    name = `${base}-${suffix}`
    suffix += 1
  }
  return name
}

function selectPart(id: string): void {
  selectedId.value = id
  exportMsg.value = ''
}

function setTool(next: 'box' | 'select'): void {
  tool.value = next
  cancelDrawing()
}

function pointInRect(pos: { x: number; y: number }, r: RawRect): boolean {
  return pos.x >= r.x && pos.x <= r.x + r.width && pos.y >= r.y && pos.y <= r.y + r.height
}

function dedupeNames(): void {
  const used = new Set<string>()
  for (const p of parts.value) {
    const base = p.name || defaultUiKitPartName(p.kind, 0)
    let name = base
    let suffix = 2
    while (used.has(name)) {
      name = `${base}-${suffix}`
      suffix += 1
    }
    used.add(name)
    p.name = name
  }
}

function onNameChange(raw: string): void {
  const p = selected.value
  if (!p) return
  const idx = parts.value.findIndex((it) => it.id === p.id)
  p.name = sanitizeUiKitPartName(raw, defaultUiKitPartName(p.kind, idx))
  dedupeNames()
  schedulePreview()
}

function onKindChange(kind: string): void {
  const p = selected.value
  if (!p) return
  if (UI_KIT_PART_KINDS.includes(kind as UiKitPart['kind'])) {
    p.kind = kind as UiKitPart['kind']
  }
  const idx = parts.value.findIndex((it) => it.id === p.id)
  // 只重排默认名（用户起的名保留其业务含义，类型前缀由导出阶段拼入）
  if (/^[a-z]+-\d+$/.test(p.name)) {
    p.name = defaultUiKitPartName(p.kind, idx)
    dedupeNames()
  }
  schedulePreview()
}

function onRectChange(key: keyof RawRect, value: number): void {
  const p = selected.value
  if (!p) return
  const next = { ...p.rect, [key]: value }
  p.rect = clampUiKitRect(next, naturalW.value, naturalH.value)
  p.border = clampInsetToSize(p.border, p.rect.width, p.rect.height)
  p.safe = clampInsetToSize(p.safe, p.rect.width, p.rect.height)
  schedulePreview()
}

function onBorderChange(v: UiKitInset): void {
  const p = selected.value
  if (!p) return
  p.border = clampInsetToSize(v, p.rect.width, p.rect.height)
  schedulePreview()
}

function onSafeChange(v: UiKitInset): void {
  const p = selected.value
  if (!p) return
  p.safe = clampInsetToSize(v, p.rect.width, p.rect.height)
}

function removeSelected(): void {
  const p = selected.value
  if (!p) return
  const idx = parts.value.findIndex((it) => it.id === p.id)
  parts.value.splice(idx, 1)
  cropDataUrl.value = ''
  selectedId.value = parts.value[idx]?.id ?? parts.value[idx - 1]?.id ?? ''
}

let previewTimer: ReturnType<typeof setTimeout> | null = null
function schedulePreview(): void {
  if (previewTimer) return
  previewTimer = setTimeout(() => {
    previewTimer = null
    void renderSelectedPreview()
  }, 140)
}

async function renderSelectedPreview(): Promise<void> {
  const p = selected.value
  const img = image.value
  if (!p || !img) {
    cropDataUrl.value = ''
    return
  }
  try {
    cropDataUrl.value = cropUiKitPartPng(img, p)
    const f = previewFactor.value
    paintUiKitNineSlice(wideCanvas.value, img, p, p.rect.width * f, p.rect.height)
    paintUiKitNineSlice(tallCanvas.value, img, p, p.rect.width, p.rect.height * f)
  } catch (err) {
    cropDataUrl.value = ''
    console.warn('[uiKit] preview failed', err)
  }
}

async function loadSource(): Promise<void> {
  imageError.value = ''
  naturalW.value = 0
  naturalH.value = 0
  if (!state.url) return
  try {
    const img = await loadUiKitSourceImage(state.url)
    image.value = img
    naturalW.value = img.naturalWidth || img.width
    naturalH.value = img.naturalHeight || img.height
    await nextTick()
    layoutStage()
  } catch (err) {
    imageError.value = t('uiKitExtract.loadFail')
    console.warn('[uiKit] load source failed', err)
  }
}

function reset(): void {
  cancelDrawing()
  parts.value = []
  selectedId.value = ''
  image.value = null
  naturalW.value = 0
  naturalH.value = 0
  imageError.value = ''
  cropDataUrl.value = ''
  exportMsg.value = ''
  busy.value = false
  zoom.value = 1
  tool.value = 'box'
}

async function exportParts(): Promise<void> {
  if (busy.value || parts.value.length === 0) return
  const img = image.value
  if (!img) return
  busy.value = true
  exportMsg.value = ''
  try {
    const rawParts = parts.value.map((p) => ({
      id: p.id,
      kind: p.kind,
      name: p.name,
      rect: { ...p.rect },
      border: { ...p.border },
      safe: { ...p.safe }
    }))
    const doc = normalizeUiKitDocument(
      { parts: rawParts },
      { name: state.name, width: naturalW.value, height: naturalH.value }
    )
    if (doc.parts.length === 0) {
      exportMsg.value = t('uiKitExtract.needParts')
      return
    }
    const outDir = `Assets/UIKits/${doc.sourceName}`
    const saved: string[] = []
    for (const part of doc.parts) {
      const dataUrl = cropUiKitPartPng(img, part)
      const rel = await window.studio.saveGraphRunMedia({
        dataUrl,
        key: `${UI_KIT_PART_KIND_PREFIXES[part.kind]}-${part.name}`,
        outputDir: outDir
      })
      saved.push(rel)
    }
    const manifest = buildUiKitManifest({
      sourceName: doc.sourceName,
      sourceWidth: doc.sourceWidth,
      sourceHeight: doc.sourceHeight,
      parts: doc.parts
    })
    // 让清单 fileName 与实际落盘文件一致（同名二次导出时 uniqueFileName 会追加序号）
    for (let i = 0; i < manifest.parts.length; i += 1) {
      const rel = saved[i]
      if (!rel) continue
      const fileName = rel.slice(rel.lastIndexOf('/') + 1)
      if (fileName) manifest.parts[i]!.fileName = fileName
    }
    await window.studio.writeProjectFile({
      relativePath: `${outDir}/ui-kit.json`,
      content: JSON.stringify(manifest, null, 2)
    })
    await project.scheduleRefreshLibrary()
    exportMsg.value = t('uiKitExtract.saved', { count: saved.length, dir: outDir })
  } catch (err) {
    exportMsg.value = t('uiKitExtract.saveFail', {
      message: err instanceof Error ? err.message : String(err)
    })
    console.error('[uiKit] export failed', err)
  } finally {
    busy.value = false
  }
}

watch(
  () => state.open,
  (open) => {
    if (!open) {
      reset()
      return
    }
    reset()
    void loadSource()
  }
)

watch(
  () => selected.value?.id ?? '',
  () => {
    cropDataUrl.value = ''
    schedulePreview()
  }
)

watch(
  () => {
    const p = selected.value
    if (!p) return ''
    const b = p.border
    const s = p.safe
    const r = p.rect
    return `${p.id}|${r.x},${r.y},${r.width},${r.height}|${b.left},${b.top},${b.right},${b.bottom}|${s.left},${s.top},${s.right},${s.bottom}`
  },
  () => schedulePreview()
)

watch([() => state.open, naturalW, naturalH], () => {
  if (state.open) void nextTick(() => scheduleLayout())
})

watch(previewFactor, () => schedulePreview())
watch(
  () => image.value,
  () => {
    if (state.open) schedulePreview()
  }
)

const onWindowResize = (): void => {
  if (state.open) scheduleLayout()
}
window.addEventListener('resize', onWindowResize)
onScopeDispose(() => window.removeEventListener('resize', onWindowResize))
</script>

<style scoped>
.ui-kit-extract-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 0;
}

.extract {
  display: grid;
  grid-template-columns: 230px minmax(0, 1fr) 300px;
  gap: 12px;
  height: 100%;
  min-height: 0;
  padding: 14px;
  overflow: hidden;
}

.pane-title {
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.side-pane,
.stage-pane,
.detail-pane {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
  min-width: 0;
}

.side-pane,
.detail-pane {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px;
  background: var(--bg-panel);
  overflow-y: auto;
}

.tool-row {
  display: flex;
  gap: 6px;
}

.tool {
  flex: 1;
  padding: 5px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-input);
  color: var(--text);
  font-size: 12px;
  cursor: pointer;
}

.tool.active {
  border-color: var(--accent);
  color: var(--accent);
}

.tool:disabled {
  opacity: 0.45;
  cursor: default;
}

.part-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.part-list li {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 6px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
}

.part-list li:hover {
  background: var(--bg-hover);
}

.part-list li.active {
  background: var(--accent-weak, rgba(98, 164, 248, 0.14));
}

.part-no {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--text-muted);
}

.part-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--mono);
  font-size: 11px;
}

.part-kind {
  margin-left: auto;
  flex-shrink: 0;
  font-size: 11px;
  color: var(--text-muted);
}

.side-footer {
  margin-top: auto;
  padding-top: 8px;
  border-top: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.pane-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.pane-head .pane-title {
  flex: 1;
  min-width: 0;
}

.zoom-row {
  display: flex;
  align-items: center;
  gap: 4px;
}

.zoom-btn {
  width: 22px;
  height: 22px;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: var(--bg-input);
  color: var(--text);
  cursor: pointer;
  line-height: 1;
}

.zoom-val {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--text-muted);
  min-width: 34px;
  text-align: center;
}

.stage-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
  display: flex;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-input);
}

.stage {
  position: relative;
  margin: auto;
  flex-shrink: 0;
  line-height: 0;
  user-select: none;
}

.stage img {
  display: block;
}

.stage-hint {
  margin: auto;
  padding: 12px;
}

.stage-footer {
  margin: 0;
}

.box {
  position: absolute;
  box-sizing: border-box;
  border: 1px solid rgba(255, 255, 255, 0.9);
  box-shadow:
    0 0 0 1px rgba(0, 0, 0, 0.55) inset,
    0 0 0 1px rgba(0, 0, 0, 0.55);
  pointer-events: none;
}

.box.draft {
  border-style: dashed;
  opacity: 0.85;
}

.box.active {
  border: 2px solid var(--accent, #4a9eff);
}

.box-tag {
  position: absolute;
  top: -18px;
  left: 0;
  font-family: var(--mono);
  font-size: 10px;
  line-height: 1.2;
  color: #fff;
  background: var(--accent, #4a9eff);
  border-radius: 3px;
  padding: 1px 4px;
  white-space: nowrap;
  pointer-events: none;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
}

.field-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 2px;
}

.group-label {
  font-size: 11px;
  color: var(--text-muted);
}

.grid-4 {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 6px;
}

.grid-4 label {
  display: flex;
  flex-direction: column;
  gap: 3px;
  font-size: 11px;
  color: var(--text-muted);
}

input,
select {
  padding: 4px 6px;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: var(--bg-input);
  color: var(--text);
  font-size: 12px;
  width: 100%;
  box-sizing: border-box;
}

.file-name {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  display: block;
}

.hint {
  margin: 0;
  font-size: 12px;
  color: var(--text-muted);
}

.empty {
  padding: 4px 2px;
}

.msg {
  margin: 0;
  font-size: 12px;
  color: var(--accent);
  word-break: break-all;
}

button {
  padding: 6px 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-elevated);
  color: var(--text);
  font-size: 13px;
  cursor: pointer;
}

button:hover:not(:disabled) {
  background: var(--bg-hover);
}

button.primary {
  border-color: transparent;
  background: var(--accent);
  color: var(--on-accent);
}

button.primary:hover:not(:disabled) {
  background: var(--accent-hover);
}

button.danger {
  border-color: transparent;
  background: var(--danger);
  color: var(--on-accent);
}

button:disabled {
  opacity: 0.5;
  cursor: default;
}

.preview-title {
  margin-top: 6px;
}

.preview-crop {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.img-frame {
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 6px;
  display: flex;
  justify-content: center;
}

.img-frame img {
  max-width: 100%;
  max-height: 140px;
  object-fit: contain;
}

.dims {
  font-family: var(--mono);
}

.preview-stretch {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.prev-canvas {
  width: 100%;
  border: 1px solid var(--border);
  border-radius: 6px;
  background-repeat: repeat;
  background-size: 14px 14px;
}

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
  background-position:
    0 0,
    7px 7px;
}

.pane-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  text-align: center;
}
</style>
