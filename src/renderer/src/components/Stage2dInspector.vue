<template>
  <aside v-if="node" class="inspector-panel">
    <div class="panel-header">
      <div>
        <h3>{{ displayTitle }}</h3>
      </div>
      <span class="type-pill">stage.2d</span>
    </div>

    <div class="panel-body">
      <GraphNodeRunControl
        v-if="hasInPort"
        :status="runStatus"
        :is-running="isGraphRunning"
        :blocked="blocked"
        @toggle="toggleRun"
      />

      <!-- 舞台画布规格 -->
      <div class="section">
        <div class="section-head">
          <span class="section-label">{{ t('stage2d.scene') }}</span>
          <span class="badge">{{ scene.canvasWidth }} × {{ scene.canvasHeight }}</span>
        </div>

        <div class="preset-chips">
          <button
            v-for="preset in canvasPresets"
            :key="preset.id"
            type="button"
            class="chip"
            :class="{
              active: scene.canvasWidth === preset.width && scene.canvasHeight === preset.height
            }"
            @click="applyCanvasPreset(preset.width, preset.height)"
          >
            {{ preset.label }}
          </button>
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
              @change="onCanvasWidthChange"
            />
          </label>
          <label class="field">
            <span>{{ t('graph.align.canvasHeight') }}</span>
            <input
              type="number"
              min="16"
              max="8192"
              step="16"
              :value="scene.canvasHeight"
              @change="onCanvasHeightChange"
            />
          </label>
        </div>

        <label class="field">
          <span>{{ t('stage2d.anchor') }}</span>
          <select :value="scene.anchor" @change="onAnchorChange">
            <option value="ground">
              {{ t('stage2d.anchorGround') }}
            </option>
            <option value="center">
              {{ t('stage2d.anchorCenter') }}
            </option>
          </select>
        </label>

        <label v-if="scene.anchor === 'ground'" class="slider-field">
          <div class="slider-head">
            <span>{{ t('stage2d.groundGap') }}</span>
            <b>{{ Math.round(scene.groundRatio * 100) }}%</b>
          </div>
          <input
            type="range"
            min="0"
            max="0.5"
            step="0.01"
            :value="scene.groundRatio"
            @input="onGroundRatioInput"
          />
        </label>
      </div>

      <!-- 图层栈管理 -->
      <div class="section">
        <div class="section-head">
          <span class="section-label">{{ t('stage2d.layers') }}</span>
          <span class="badge">
            {{ t('stage2d.inspectorLayerCount', { count: scene.layers.length }) }}
          </span>
        </div>

        <ul v-if="scene.layers.length" class="layer-list">
          <li
            v-for="(layer, index) in scene.layers"
            :key="layer.id"
            class="layer-item"
            :class="{ hidden: !layer.visible }"
          >
            <button
              type="button"
              class="icon-btn"
              :title="layer.visible ? t('stage2d.hide') : t('stage2d.show')"
              @click="toggleLayerVisible(layer.id)"
            >
              {{ layer.visible ? '👁' : '⃝' }}
            </button>
            <span class="layer-name" :title="layer.sourceUrl">{{ layer.name }}</span>
            <button
              v-if="index > 0 && scene.layers.length > 2"
              type="button"
              class="icon-btn"
              :title="t('stage2d.soloLayer')"
              @click="soloLayerVariant(layer.id)"
            >
              🎯
            </button>
            <button
              type="button"
              class="icon-btn"
              :class="{ active: !!layer.flipX }"
              :title="t('stage2d.layerFlipX')"
              @click="toggleLayerFlipX(layer.id)"
            >
              ⇄
            </button>
            <button
              type="button"
              class="icon-btn"
              :disabled="index === 0"
              :title="t('stage2d.moveUp')"
              @click="moveLayer(layer.id, -1)"
            >
              ↑
            </button>
            <button
              type="button"
              class="icon-btn"
              :disabled="index === scene.layers.length - 1"
              :title="t('stage2d.moveDown')"
              @click="moveLayer(layer.id, 1)"
            >
              ↓
            </button>
            <button
              type="button"
              class="icon-btn danger"
              :title="t('stage2d.remove')"
              @click="removeLayer(layer.id)"
            >
              ✕
            </button>
          </li>
        </ul>
        <p v-else class="hint">
          {{ t('stage2d.noLayer') }}
        </p>

        <button type="button" class="action-btn" @click="pickerOpen = true">
          + {{ t('stage2d.addLayer') }}
        </button>
      </div>

      <!-- 骨骼与动作烘焙 -->
      <div class="section">
        <div class="section-head">
          <span class="section-label">{{ t('stage2d.inspectorRigSection') }}</span>
          <span class="badge">
            {{
              rig.joints.length
                ? t('stage2d.inspectorRigStatus', {
                    joints: rig.joints.length,
                    attachments: rig.attachments.length
                  })
                : t('stage2d.inspectorNoRig')
            }}
          </span>
        </div>

        <button type="button" class="action-btn secondary" @click="applyHumanoidRig">
          🦴 {{ t('stage2d.rigHumanoid') }}
        </button>

        <label class="field">
          <span>{{ t('stage2d.actionPick') }}</span>
          <select :value="selectedActionId" @change="onActionSelect">
            <option value="">
              {{ t('stage2d.actionNone') }}
            </option>
            <option v-if="isCustomAction" value="custom">
              {{
                currentAction?.name
                  ? `${t('stage2dVideo.actionCustom')} · ${currentAction.name}`
                  : t('stage2dVideo.actionCustom')
              }}
            </option>
            <option v-for="item in actionPresets" :key="item.id" :value="item.id">
              {{ t(`stage2d.actions.${item.id}`) }}
            </option>
          </select>
        </label>

        <label class="field">
          <span>{{ t('stage2d.inspectorAnimFps') }}</span>
          <select :value="animFps" @change="onAnimFpsChange">
            <option :value="0">
              {{ t('stage2d.inspectorAnimFpsOff') }}
            </option>
            <option v-for="fps in fpsOptions" :key="fps" :value="fps">{{ fps }} FPS</option>
          </select>
        </label>

        <p v-if="bakedFrameCount > 0" class="hint ok">
          {{
            t('stage2d.exportNodeOutput', {
              count: bakedFrameCount,
              path: bakedSheetPath || t('stage2d.exportNodeOutputPending')
            })
          }}
        </p>
      </div>

      <p class="dive-hint">
        {{ t('stage2d.inspectorDiveHint') }}
      </p>

      <GraphNodeOutputPreview v-if="node && hostId" :node="node" :host-id="hostId" />
    </div>

    <AssetImagePickDialog
      :open="pickerOpen"
      :selected-asset-ids="[]"
      :remaining="16"
      @confirm="addFromAssets"
      @cancel="pickerOpen = false"
    />
  </aside>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  readStage2dSceneFromNode,
  stage2dSceneToNodePatch,
  readStage2dRigFromNode,
  stage2dRigToNodePatch,
  readStage2dActionFromNode,
  stage2dActionToNodePatch,
  readStage2dAnimFpsFromNode,
  stage2dAnimFpsToNodePatch,
  type GraphNodeParams,
  type Stage2dSceneState
} from '@shared/graph'
import {
  STAGE2D_CANVAS_PRESETS,
  STAGE2D_ACTION_PRESETS,
  stage2dActionPresetById,
  createHumanoidStage2dRig,
  stage2dGroundY
} from '@shared/gameAssets'
import { useStudioI18n } from '../composables/useStudioI18n'
import { useNodeDisplayTitle } from '../composables/useNodeDisplayTitle'
import { useGraphNodeRun } from '../composables/useGraphNodeRun'
import { useEditorKernel } from '../editor/kernel'
import { graphEditorHosts } from '../features/graph/model/graphEditorHosts'
import { useProjectStore } from '../stores/project'
import AssetImagePickDialog from './AssetImagePickDialog.vue'
import GraphNodeOutputPreview from './GraphNodeOutputPreview.vue'
import GraphNodeRunControl from './GraphNodeRunControl.vue'

const { t, graphTypeLabel } = useStudioI18n()
const editor = useEditorKernel()
const project = useProjectStore()

const canvasPresets = STAGE2D_CANVAS_PRESETS
const actionPresets = STAGE2D_ACTION_PRESETS
const fpsOptions = [6, 8, 10, 12, 15, 24]
const pickerOpen = ref(false)

const node = computed(() => {
  void graphEditorHosts.revision.value
  const selection = editor.selection.current.value
  const id = selection.kind === 'graph.node' ? selection.id : null
  if (!id) return null
  const current = graphEditorHosts.getNode(selection.hostId, id)
  return current?.typeId === 'stage.2d' ? current : null
})

const hostId = computed(() => {
  const selection = editor.selection.current.value
  return selection.kind === 'graph.node' ? (selection.hostId ?? '') : ''
})

const { hasInPort, runStatus, isGraphRunning, blocked, toggleRun } = useGraphNodeRun(node)

const typeLabel = computed(() => graphTypeLabel('stage.2d'))
const displayTitle = useNodeDisplayTitle(node, typeLabel)

const scene = computed<Stage2dSceneState>(() => readStage2dSceneFromNode(node.value?.params))
const rig = computed(() => readStage2dRigFromNode(node.value?.params))
const currentAction = computed(() => readStage2dActionFromNode(node.value?.params))
const animFps = computed(() => readStage2dAnimFpsFromNode(node.value?.params))

const selectedActionId = computed(() => {
  const act = currentAction.value
  if (!act) return ''
  const matched = actionPresets.find((p) => p.id === act.name || p.name === act.name)
  return matched ? matched.id : 'custom'
})

const isCustomAction = computed(() => selectedActionId.value === 'custom')

const bakedFrameCount = computed(() => Number(node.value?.params?.stage2dAnimFrameCount ?? 0) || 0)
const bakedSheetPath = computed(() =>
  String(node.value?.params?.stage2dAnimSheetRelativePath ?? '').trim()
)

function updateNodeParams(patch: Partial<GraphNodeParams>): void {
  if (!node.value || !hostId.value) return
  graphEditorHosts.updateNode(hostId.value, node.value.id, patch)
}

function commitScene(next: Stage2dSceneState): void {
  updateNodeParams(stage2dSceneToNodePatch(next))
}

function applyCanvasPreset(width: number, height: number): void {
  commitScene({ ...scene.value, canvasWidth: width, canvasHeight: height })
}

function onCanvasWidthChange(event: Event): void {
  const val = Number((event.target as HTMLInputElement).value)
  commitScene({ ...scene.value, canvasWidth: val })
}

function onCanvasHeightChange(event: Event): void {
  const val = Number((event.target as HTMLInputElement).value)
  commitScene({ ...scene.value, canvasHeight: val })
}

function onAnchorChange(event: Event): void {
  const val = (event.target as HTMLSelectElement).value === 'center' ? 'center' : 'ground'
  commitScene({ ...scene.value, anchor: val })
}

function onGroundRatioInput(event: Event): void {
  const val = Number((event.target as HTMLInputElement).value)
  commitScene({ ...scene.value, groundRatio: val })
}

function toggleLayerVisible(id: string): void {
  commitScene({
    ...scene.value,
    layers: scene.value.layers.map((l) => (l.id === id ? { ...l, visible: !l.visible } : l))
  })
}

/** 独显差分层：保留底图（第 0 层）+ 目标差分层可见，隐藏其余上层；若已处于独显则恢复全部可见 */
function soloLayerVariant(id: string): void {
  const list = scene.value.layers
  const alreadySolo = list.every((l, idx) => (idx === 0 || l.id === id ? l.visible : !l.visible))
  commitScene({
    ...scene.value,
    layers: list.map((l, idx) => ({
      ...l,
      visible: alreadySolo ? true : idx === 0 || l.id === id
    }))
  })
}

function toggleLayerFlipX(id: string): void {
  commitScene({
    ...scene.value,
    layers: scene.value.layers.map((l) => (l.id === id ? { ...l, flipX: !l.flipX } : l))
  })
}

function moveLayer(id: string, delta: number): void {
  const list = [...scene.value.layers]
  const index = list.findIndex((l) => l.id === id)
  const target = index + delta
  if (index < 0 || target < 0 || target >= list.length) return
  const [picked] = list.splice(index, 1)
  list.splice(target, 0, picked)
  commitScene({ ...scene.value, layers: list })
}

function removeLayer(id: string): void {
  if (!node.value) return
  const nextScene = {
    ...scene.value,
    layers: scene.value.layers.filter((l) => l.id !== id)
  }
  const nextRig = {
    ...rig.value,
    attachments: rig.value.attachments.filter((a) => a.layerId !== id)
  }
  updateNodeParams({
    ...stage2dSceneToNodePatch(nextScene),
    ...stage2dRigToNodePatch(nextRig)
  })
}

function addFromAssets(assetIds: string[]): void {
  pickerOpen.value = false
  const picked = assetIds
    .map((id) => project.assets.find((asset) => asset.id === id))
    .filter((asset): asset is NonNullable<typeof asset> => !!asset)
    .map((asset) => asset.relativePath?.trim())
    .filter((path): path is string => !!path)
  if (!picked.length) return
  const base = scene.value.layers.length
  const added = picked.map((sourceUrl, index) => ({
    id: `layer-${Date.now()}-${base + index}`,
    name: `Layer ${base + index + 1}`,
    sourceUrl,
    align: {
      anchor: scene.value.anchor,
      contentHeightRatio: 0.9,
      groundRatio: scene.value.groundRatio,
      fitWithinWidth: true
    },
    offset: { x: 0, y: 0 },
    visible: true
  }))
  commitScene({ ...scene.value, layers: [...scene.value.layers, ...added] })
}

function applyHumanoidRig(): void {
  if (!node.value) return
  const s = scene.value
  const rawGround = stage2dGroundY(s)
  const feetY =
    rawGround >= 0
      ? Math.max(8, Math.min(Math.round(rawGround), s.canvasHeight - 8))
      : Math.max(8, s.canvasHeight - 8)
  const height = Math.max(60, Math.min(feetY - 8, s.canvasWidth * 0.7, s.canvasHeight * 0.92))
  const nextRig = createHumanoidStage2dRig({
    x: Math.round(s.canvasWidth / 2),
    groundY: feetY,
    height: Math.round(height)
  })
  updateNodeParams({
    ...stage2dRigToNodePatch(nextRig),
    stage2dPose: {}
  })
}

function onActionSelect(event: Event): void {
  if (!node.value) return
  const id = (event.target as HTMLSelectElement).value
  if (!id) {
    updateNodeParams(stage2dActionToNodePatch(null))
    return
  }
  if (id === 'custom') return
  const preset = stage2dActionPresetById(id)
  if (!preset) return
  const patch: Record<string, unknown> = {
    ...stage2dActionToNodePatch({
      name: preset.id,
      duration: preset.duration,
      loop: preset.loop,
      keyframes: preset.keyframes
    })
  }
  // 首次选预设动作且帧率未开时，自动开启 12 FPS 以便运行节点直接产出动作帧
  if (animFps.value <= 0) {
    Object.assign(patch, stage2dAnimFpsToNodePatch(12))
  }
  updateNodeParams(patch)
}

function onAnimFpsChange(event: Event): void {
  if (!node.value) return
  const val = Number((event.target as HTMLSelectElement).value)
  updateNodeParams(stage2dAnimFpsToNodePatch(val))
}
</script>

<style scoped>
.inspector-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-elevated);
  color: var(--text);
}

.panel-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  padding: 14px 16px 10px;
  border-bottom: 1px solid var(--border);
}

.eyebrow {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-muted);
}

.panel-header h3 {
  margin: 2px 0 0;
  font-size: 14px;
  font-weight: 600;
}

.type-pill {
  font-size: 10px;
  padding: 2px 7px;
  border-radius: 999px;
  background: rgba(56, 189, 248, 0.14);
  color: #7dd3fc;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

.panel-body {
  flex: 1;
  overflow-y: auto;
  padding: 12px 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.section {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--bg-input) 70%, transparent);
  border: 1px solid var(--border);
}

.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.section-label {
  font-size: 11px;
  font-weight: 600;
  color: #cbd5e1;
}

.badge {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 999px;
  background: rgba(148, 163, 184, 0.14);
  color: #94a3b8;
}

.preset-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.chip {
  padding: 3px 8px;
  border-radius: 6px;
  border: 1px solid rgba(148, 163, 184, 0.22);
  background: rgba(15, 23, 42, 0.55);
  color: #cbd5e1;
  font-size: 11px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.chip:hover {
  border-color: rgba(56, 189, 248, 0.45);
  color: #f8fafc;
}

.chip.active {
  background: rgba(56, 189, 248, 0.18);
  border-color: rgba(56, 189, 248, 0.65);
  color: #7dd3fc;
}

.grid2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 11px;
  color: var(--text-muted, #9ca3af);
}

.field input,
.field select {
  padding: 5px 8px;
  border-radius: 6px;
  border: 1px solid rgba(148, 163, 184, 0.22);
  background: rgba(15, 23, 42, 0.65);
  color: var(--text-primary, #f3f4f6);
  font-size: 12px;
}

.slider-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 11px;
  color: var(--text-muted, #9ca3af);
}

.slider-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.slider-head b {
  color: #e2e8f0;
  font-weight: 600;
}

.layer-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.layer-item {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 6px;
  border-radius: 6px;
  background: rgba(15, 23, 42, 0.55);
  border: 1px solid rgba(148, 163, 184, 0.14);
}

.layer-item.hidden {
  opacity: 0.5;
}

.layer-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  color: #e2e8f0;
}

.icon-btn {
  padding: 2px 5px;
  border-radius: 4px;
  border: 1px solid rgba(148, 163, 184, 0.2);
  background: rgba(30, 41, 59, 0.6);
  color: #cbd5e1;
  font-size: 11px;
  cursor: pointer;
}

.icon-btn:hover:not(:disabled) {
  border-color: rgba(56, 189, 248, 0.5);
  color: #f8fafc;
}

.icon-btn.active {
  background: rgba(56, 189, 248, 0.22);
  border-color: rgba(56, 189, 248, 0.65);
  color: #7dd3fc;
}

.icon-btn.danger:hover:not(:disabled) {
  border-color: rgba(248, 113, 113, 0.6);
  color: #fca5a5;
}

.icon-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.action-btn {
  padding: 6px 10px;
  border-radius: 6px;
  border: 1px solid rgba(56, 189, 248, 0.4);
  background: rgba(56, 189, 248, 0.14);
  color: #bae6fd;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
}

.action-btn:hover {
  background: rgba(56, 189, 248, 0.22);
}

.action-btn.secondary {
  border-color: rgba(148, 163, 184, 0.28);
  background: rgba(30, 41, 59, 0.65);
  color: #e2e8f0;
}

.action-btn.secondary:hover {
  border-color: rgba(56, 189, 248, 0.45);
}

.hint {
  margin: 0;
  font-size: 11px;
  color: var(--text-muted, #9ca3af);
  line-height: 1.45;
}

.hint.ok {
  color: #6ee7b7;
}

.dive-hint {
  margin: 0;
  font-size: 11px;
  color: #64748b;
  line-height: 1.45;
}
</style>
