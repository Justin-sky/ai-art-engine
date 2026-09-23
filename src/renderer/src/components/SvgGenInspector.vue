<template>
  <div v-if="node" class="node-inspector">
    <div class="head">
      <h2>{{ displayTitle }}</h2>
    </div>
    <p class="hint">
      {{ t('graph.svgGen.inspectorHint') }}
    </p>

    <GraphNodeRunControl
      v-if="hasInPort"
      :status="runStatus"
      :is-running="isGraphRunning"
      :blocked="blocked"
      @toggle="toggleRun"
    />

    <div class="config-row">
      <label class="field">
        <span>{{ t('graph.svgGen.width') }}</span>
        <input
          type="number"
          :min="String(SVG_GEN_SIZE_MIN)"
          :max="String(SVG_GEN_SIZE_MAX)"
          step="1"
          :value="state.width"
          @change="onWidthChange"
        />
      </label>
      <label class="field">
        <span>{{ t('graph.svgGen.height') }}</span>
        <input
          type="number"
          :min="String(SVG_GEN_SIZE_MIN)"
          :max="String(SVG_GEN_SIZE_MAX)"
          step="1"
          :value="state.height"
          @change="onHeightChange"
        />
      </label>
    </div>

    <label class="field">
      <span>{{ t('graph.svgGen.background') }}</span>
      <select :value="state.background" @change="onBackgroundChange">
        <option value="">
          {{ t('graph.svgGen.bgNone') }}
        </option>
        <option value="white">
          {{ t('graph.svgGen.bgWhite') }}
        </option>
        <option value="black">
          {{ t('graph.svgGen.bgBlack') }}
        </option>
      </select>
    </label>

    <label class="field">
      <span>{{ t('graph.svgGen.instruction') }}</span>
      <textarea
        v-model="instruction"
        class="instruction"
        rows="4"
        :placeholder="t('graph.svgGen.instructionPlaceholder')"
        @change="persistInstruction"
      />
    </label>

    <label class="field">
      <span>{{ t('graph.svgGen.systemPrompt') }}</span>
      <textarea
        v-model="systemPrompt"
        class="instruction"
        rows="6"
        :placeholder="t('graph.svgGen.systemPromptPlaceholder')"
        @change="persistSystemPrompt"
      />
    </label>

    <GraphNodeOutputPreview
      v-if="hostId"
      :node="node"
      :host-id="hostId"
      clearable
      @clear-output="onClearOutput"
    >
      <template #preview-actions-start="{ compact }">
        <button
          v-if="canExportGif"
          type="button"
          class="gif-chip"
          :class="{ compact: !!compact, busy: gifBusy }"
          :disabled="gifBusy"
          :title="t('graph.svgGen.exportGifHint')"
          :aria-label="t('graph.svgGen.exportGif')"
          @click.stop="openGifSave"
        >
          {{ gifBusy ? t('graph.svgGen.exportGifBusy') : t('graph.svgGen.exportGif') }}
        </button>
      </template>
    </GraphNodeOutputPreview>
    <p v-if="gifError" class="hint err">
      {{ gifError }}
    </p>
    <p v-else-if="gifStatus" class="hint">
      {{ gifStatus }}
    </p>
  </div>
  <div v-else class="node-inspector empty">
    {{ t('graph.inspector.node.empty') }}
  </div>

  <SaveAssetDialog
    ref="gifSaveRef"
    :open="gifSaveOpen"
    :default-name="gifSaveDefaultName"
    :title="t('graph.svgGen.exportGifTitle')"
    :subtitle="t('graph.svgGen.exportGifSubtitle')"
    :z-index="2600"
    @confirm="onGifSaveConfirm"
    @cancel="closeGifSave"
  />
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  DEFAULT_SVG_ANIM_STATE,
  SVG_ANIM_FRAMES_DEFAULT,
  SVG_GEN_SIZE_MAX,
  SVG_GEN_SIZE_MIN,
  extractSvgMarkup,
  readSvgGenFromNode,
  resolveSvgGenSystemPrompt
} from '@shared/graph'
import { resolveCacheOutputRoot } from '@shared/domain'
import GraphNodeRunControl from './GraphNodeRunControl.vue'
import GraphNodeOutputPreview from './GraphNodeOutputPreview.vue'
import SaveAssetDialog from './SaveAssetDialog.vue'
import { useStudioI18n } from '../composables/useStudioI18n'
import { useNodeDisplayTitle } from '../composables/useNodeDisplayTitle'
import { useGraphNodeRun } from '../composables/useGraphNodeRun'
import { useEditorKernel } from '../editor/kernel'
import { useProjectStore } from '../stores/project'
import { graphEditorHosts } from '../features/graph/model/graphEditorHosts'
import { graphRunHosts } from '../features/graph/model/graphRunHosts'
import { composeAnim2dGif } from '../features/graph/model/composeAnim2dGif'
import { renderSvgFrames } from '../features/graph/model/renderSvgFrames'

const { t, locale, graphTypeLabel } = useStudioI18n()
const editor = useEditorKernel()
const project = useProjectStore()

const node = computed(() => {
  void graphEditorHosts.revision.value
  const selection = editor.selection.current.value
  const id = selection.kind === 'graph.node' ? selection.id : null
  if (!id) return null
  const current = graphEditorHosts.getNode(selection.hostId, id)
  return current?.typeId === 'svg.gen' ? current : null
})

const hostId = computed(() => {
  const selection = editor.selection.current.value
  return selection.kind === 'graph.node' ? (selection.hostId ?? '') : ''
})

const { hasInPort, runStatus, isGraphRunning, blocked, toggleRun } = useGraphNodeRun(node)
const typeLabel = computed(() => graphTypeLabel('svg.gen'))
const displayTitle = useNodeDisplayTitle(node, typeLabel)

const state = computed(() =>
  node.value
    ? readSvgGenFromNode(node.value.params)
    : { width: 512, height: 512, background: '' as const }
)
const instruction = ref('')
const systemPrompt = ref('')

/** 当前选中的 SVG 源码（预览同款） */
const selectedSvgText = computed(() => {
  const params = node.value?.params
  if (!params) return ''
  const items = Array.isArray(params.generatedSvgs) ? params.generatedSvgs : []
  if (!items.length) return ''
  const selectedId = params.selectedSvgId?.trim()
  const item = (selectedId ? items.find((row) => row.id === selectedId) : null) ?? items[0]
  return extractSvgMarkup(item?.text?.trim() || '')
})

const canExportGif = computed(() => selectedSvgText.value.length > 0)

watch(
  () => node.value?.params.generateInstruction,
  (stored) => {
    instruction.value = stored ?? ''
  },
  { immediate: true }
)

watch(
  () => [node.value?.params.generateSystemPrompt, locale.value] as const,
  ([stored]) => {
    systemPrompt.value = resolveSvgGenSystemPrompt(stored, String(locale.value))
  },
  { immediate: true }
)

function patchParams(patch: Record<string, unknown>): void {
  if (!node.value || !hostId.value) return
  graphEditorHosts.updateNode(hostId.value, node.value.id, patch)
}

function onWidthChange(e: Event): void {
  const n = Number((e.target as HTMLInputElement).value)
  if (!Number.isFinite(n)) return
  patchParams({ svgGenWidth: n })
}

function onHeightChange(e: Event): void {
  const n = Number((e.target as HTMLInputElement).value)
  if (!Number.isFinite(n)) return
  patchParams({ svgGenHeight: n })
}

function onBackgroundChange(e: Event): void {
  const value = (e.target as HTMLSelectElement).value
  patchParams({ svgGenBackground: value === 'white' || value === 'black' ? value : '' })
}

function persistInstruction(): void {
  patchParams({ generateInstruction: instruction.value })
}

function persistSystemPrompt(): void {
  patchParams({ generateSystemPrompt: systemPrompt.value })
}

/** 删除已生成的输出：清空运行态与输出参数，便于重新生成 */
function onClearOutput(): void {
  if (!node.value || !hostId.value) return
  const host = graphRunHosts.get(hostId.value)
  if (host && !host.isRunning.value) {
    delete host.runStates[node.value.id]
  }
  graphEditorHosts.updateNode(hostId.value, node.value.id, {
    generatedSvgs: [],
    selectedSvgId: '',
    previewDataUrl: undefined,
    previewRelativePath: ''
  })
  gifStatus.value = ''
  gifError.value = ''
}

const gifBusy = ref(false)
const gifStatus = ref('')
const gifError = ref('')
const gifSaveOpen = ref(false)
const gifSaveDefaultName = ref('svg-gen-gif')
const gifSaveRef = ref<InstanceType<typeof SaveAssetDialog> | null>(null)
const gifSaving = ref(false)

function openGifSave(): void {
  if (!canExportGif.value || gifBusy.value) return
  gifError.value = ''
  gifSaveDefaultName.value = 'svg-gen-gif'
  gifSaveOpen.value = true
}

function closeGifSave(): void {
  if (gifSaving.value) return
  gifSaveOpen.value = false
}

/**
 * 把当前预览 SVG 按 SMIL 时间轴烘焙成帧再合成 GIF，落盘并登记到所选资产目录。
 * 静态 SVG（无动效）会提示无法导出。
 */
async function onGifSaveConfirm(payload: { name: string; folderId: string | null }): Promise<void> {
  if (!node.value || gifSaving.value) return
  const svgText = selectedSvgText.value
  if (!svgText) return
  gifSaving.value = true
  gifBusy.value = true
  gifStatus.value = ''
  gifError.value = ''
  gifSaveRef.value?.setSaving(true)
  try {
    const gen = state.value
    const rendered = await renderSvgFrames({
      svgText,
      state: {
        ...DEFAULT_SVG_ANIM_STATE,
        frames: SVG_ANIM_FRAMES_DEFAULT,
        durationSec: 0,
        width: gen.width,
        height: gen.height,
        background: gen.background
      }
    })
    if (!rendered.animated || rendered.frameCount < 2 || rendered.fps <= 0) {
      const message = t('graph.svgGen.exportGifStatic')
      gifError.value = message
      gifSaveRef.value?.setError(message)
      return
    }
    const gif = await composeAnim2dGif({
      frameUrls: rendered.frameUrls,
      fps: rendered.fps,
      loop: true
    })
    if (!gif) throw new Error('SVG_GEN_GIF_NO_FRAMES')
    const cacheRoot = resolveCacheOutputRoot(project.config?.cacheOutputDir)
    const stagedPath = await window.studio.saveGraphRunMedia({
      dataUrl: gif.dataUrl,
      key: `svg-gen-gif-${Date.now()}`,
      outputDir: `${cacheRoot}/Gifs`
    })
    if (!(await window.studio.projectFileExists(stagedPath))) {
      const name = stagedPath.split('/').pop() || stagedPath
      gifSaveRef.value?.setSourceMissing(stagedPath)
      gifSaveRef.value?.setError(t('dialog.saveAsset.sourceMissing', { name }))
      return
    }
    const asset = await window.studio.saveProjectAsset({
      relativePath: stagedPath,
      name: payload.name,
      folderId: payload.folderId
    })
    await project.scheduleRefreshLibrary()
    gifSaveOpen.value = false
    gifStatus.value = t('graph.svgGen.exportGifDone', {
      path: asset.relativePath || asset.name
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    gifError.value = message
    gifSaveRef.value?.setError(message)
  } finally {
    gifSaving.value = false
    gifBusy.value = false
    gifSaveRef.value?.setSaving(false)
  }
}

watch(
  () => node.value?.id ?? '',
  () => {
    if (!gifSaving.value) gifSaveOpen.value = false
    gifStatus.value = ''
    gifError.value = ''
  }
)
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

.head h2 {
  margin: 0;
  font-size: 14px;
}

.hint {
  margin: 0;
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.5;
}

.hint.err {
  color: var(--danger);
}

.gif-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  max-width: 100%;
  padding: 3px 8px;
  border: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
  border-radius: 6px;
  background: color-mix(in srgb, var(--bg-elevated) 88%, transparent);
  color: var(--text);
  font-size: 11px;
  line-height: 1.2;
  white-space: nowrap;
  cursor: pointer;
}

.gif-chip.compact {
  padding: 2px 6px;
  font-size: 10px;
}

.gif-chip:hover:not(:disabled) {
  border-color: var(--accent);
  background: var(--bg-hover);
}

.gif-chip:disabled,
.gif-chip.busy {
  opacity: 0.6;
  cursor: default;
}

.config-row {
  display: flex;
  gap: 8px;
}

.config-row .field {
  flex: 1;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
}

.field :is(input, select, textarea) {
  width: 100%;
  box-sizing: border-box;
}

.instruction {
  resize: vertical;
  font-family: inherit;
}
</style>
