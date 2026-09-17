<template>
  <div v-if="node" class="node-inspector">
    <div class="head">
      <div class="head-text">
        <span class="type">{{ typeLabel }}</span>
        <h2>{{ displayTitle }}</h2>
      </div>
      <button
        type="button"
        class="save-btn"
        :disabled="!canSave"
        :title="t('graph.inspector.modelPose.saveToAssetTitle')"
        @click="openSaveDialog"
      >
        <span class="save-btn-icon" aria-hidden="true">⤴</span>
        <span>{{ t('graph.inspector.modelPose.saveToAsset') }}</span>
      </button>
    </div>
    <p class="hint">
      {{ t('graph.inspector.modelPose.hint') }}
    </p>

    <GraphNodeRunControl
      v-if="hasInPort"
      :status="runStatus"
      :is-running="isGraphRunning"
      :blocked="blocked"
      @toggle="toggleRun"
    />

    <section
      v-if="modelPreviewPath && bonePose"
      class="pose-section"
      :aria-label="t('graph.inspector.modelPose.posePreview')"
    >
      <p class="pose-hint">
        {{ t('graph.inspector.modelPose.poseHint') }}
      </p>
      <ModelPreview
        :relative-path="modelPreviewPath"
        :bone-pose="bonePose"
        :show-skeleton="false"
      />
      <p v-if="posePresetId" class="pose-preset">
        <code>{{ posePresetId }}</code>
      </p>
    </section>
    <section
      v-else-if="!modelPreviewPath"
      class="pose-section"
      :aria-label="t('graph.inspector.modelPose.posePreview')"
    >
      <p class="section-hint">
        {{ t('graph.inspector.modelPose.noModel') }}
      </p>
    </section>
    <section v-else class="pose-section" :aria-label="t('graph.inspector.modelPose.posePreview')">
      <p class="section-hint">
        {{ t('graph.inspector.modelPose.poseEmpty') }}
      </p>
    </section>

    <p v-if="saveStatus === 'ok'" class="save-status ok" role="status">
      {{ t('graph.inspector.modelPose.saveDone', { path: savedPath }) }}
    </p>
    <p v-else-if="saveStatus === 'error'" class="save-status error" role="alert">
      {{ t('graph.inspector.modelPose.saveFailed', { message: saveError }) }}
    </p>

    <SaveAssetDialog
      ref="saveDialogRef"
      :open="saveDialogOpen"
      :default-name="saveDialogDefaultName"
      :title="t('graph.inspector.modelPose.saveDialogTitle')"
      :subtitle="t('graph.inspector.modelPose.saveDialogSubtitle')"
      :z-index="2600"
      @confirm="onSaveConfirm"
      @cancel="closeSaveDialog"
    />

    <GraphNodeOutputPreview v-if="node && hostId" :node="node" :host-id="hostId" />
  </div>
  <div v-else class="node-inspector empty">
    {{ t('graph.inspector.node.empty') }}
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import GraphNodeRunControl from './GraphNodeRunControl.vue'
import GraphNodeOutputPreview from './GraphNodeOutputPreview.vue'
import ModelPreview from './ModelPreview.vue'
import SaveAssetDialog from './SaveAssetDialog.vue'
import { useStudioI18n } from '../composables/useStudioI18n'
import { useNodeDisplayTitle } from '../composables/useNodeDisplayTitle'
import { useGraphNodeRun } from '../composables/useGraphNodeRun'
import { useEditorKernel } from '../editor/kernel'
import { useProjectStore } from '../stores/project'
import { graphEditorHosts } from '../features/graph/model/graphEditorHosts'
import { buildPoseAssetGenParams } from '@shared/domain'

/**
 * 3D 姿势节点的 inspector：
 *
 * - 「姿势预览」：上游 3D 模型 + 最近一次 Cook 写入的 `bonePose`，通过共享的
 *   `ModelPreview` 在浏览器端套上骨骼旋转（bind 局部 quaternion × Euler 偏移
 *   四元数，FK 链子骨跟随父骨变形、SkinnedMesh 按原始 vertex 权重自动 blend）
 *   —— 与导演台 `applyBonePoseForObject` 套用姿势的口径一致（rad 单位也一致）。
 *   模型路径从最近 Cook 写入的 `node.params.poseModelRelativePath` 取，路径缓
 *   存在 execute/modelPose.ts 写，与 rigSkin 的 `rigModelRelativePath` 对称。
 *   没有 Cook 结果时降级为「运行节点后查看」/「请先连接模型」提示，不强行渲染
 *   空场景。
 *
 * - 「保存到资产库」按钮（右上角）：把当前 Cook 写出的 `bonePose` 落成姿势资产
 *   —— 与导演台 `saveObjectPoseAsAsset` 共用同一条链路：encodeBonePoseNormalized
 *   归一化骨名（跨模型共用）→ buildPoseAssetGenParams 写
 *   `genParams = { modelKind: 'pose', pose: { schemaVersion: 1, bones, sourceModelAssetId } }`
 *   → `window.studio.createAsset({ type: 'model', genParams })`，资产库落地。
 *   路径与源模型 assetId 来自 Cook 缓存。文件夹选择复用既有 SaveAssetDialog，
 *   与 2D 帧动画 GIF 导出、Cutout/Composer 资产保存同口径；保存时把源模型
 *   assetId 一起写进资产元数据，下游「套用姿势」链路（导演台
 *   `applyPoseAssetToObject` → `mapNormalizedPoseToTargetBones`）能据此做
 *   骨骼名映射。无 bonePose / Cook 未运行时按钮禁用。
 *
 * 文本生成模型选择器、姿势指令输入框与常用姿势 chip 都已迁移到卡片下方的
 * 「生成指令」面板（双击卡片展开，参见 GraphNodeCard.vue 的 `instructionKind`）。
 */
const { t, graphTypeLabel } = useStudioI18n()
const editor = useEditorKernel()
const project = useProjectStore()

const node = computed(() => {
  void graphEditorHosts.revision.value
  const selection = editor.selection.current.value
  const id = selection.kind === 'graph.node' ? selection.id : null
  if (!id) return null
  const current = graphEditorHosts.getNode(selection.hostId, id)
  return current?.typeId === 'model.pose' ? current : null
})

const hostId = computed(() => {
  const selection = editor.selection.current.value
  return selection.kind === 'graph.node' ? (selection.hostId ?? '') : ''
})

const { hasInPort, runStatus, isGraphRunning, blocked, toggleRun } = useGraphNodeRun(node)

const typeLabel = computed(() => graphTypeLabel('model.pose'))
const displayTitle = useNodeDisplayTitle(node, typeLabel)

/** 输入端模型路径（最近 Cook 写入，供预览） */
const modelPreviewPath = computed((): string | null => {
  const current = node.value
  if (!current) return null
  return current.params.poseModelRelativePath?.trim() || null
})

/** 最近一次 Cook 写入的 bonePose（骨名 → 局部欧拉弧度） */
const bonePose = computed(() => node.value?.params.bonePose ?? null)

const posePresetId = computed(() => node.value?.params.posePresetId ?? null)

const canSave = computed(() => {
  if (!bonePose.value) return false
  return Object.keys(bonePose.value).length > 0
})

// --- 保存到资产库 -------------------------------------------------------------

const saveDialogRef = ref<InstanceType<typeof SaveAssetDialog> | null>(null)
const saveDialogOpen = ref(false)
const saving = ref(false)
const saveStatus = ref<'idle' | 'ok' | 'error'>('idle')
const saveError = ref('')
const savedPath = ref('')

const saveDialogDefaultName = computed(() => {
  const preset = posePresetId.value
  if (preset) return preset
  return t('graph.inspector.modelPose.saveDialogDefaultName')
})

function openSaveDialog(): void {
  if (!canSave.value || saving.value) return
  saveStatus.value = 'idle'
  saveError.value = ''
  savedPath.value = ''
  saveDialogOpen.value = true
}

function closeSaveDialog(): void {
  if (saving.value) return
  saveDialogOpen.value = false
}

async function onSaveConfirm(payload: { name: string; folderId: string | null }): Promise<void> {
  if (!canSave.value || saving.value) return
  const current = node.value
  if (!current) return
  saving.value = true
  saveDialogRef.value?.setSaving(true)
  try {
    const sourceAssetId = current.params.poseSourceAssetId?.trim() || null
    const pose = bonePose.value as Record<string, { x: number; y: number; z: number }>
    const genParams = buildPoseAssetGenParams(pose, sourceAssetId)
    const asset = await window.studio.createAsset({
      type: 'model',
      name: payload.name,
      folderId: payload.folderId,
      genParams
    })
    project.patchAssets([asset])
    saveStatus.value = 'ok'
    savedPath.value = asset.relativePath || asset.name
    saveDialogOpen.value = false
  } catch (err) {
    saveStatus.value = 'error'
    saveError.value = err instanceof Error ? err.message : String(err)
    saveDialogRef.value?.setError(saveError.value)
  } finally {
    saving.value = false
    saveDialogRef.value?.setSaving(false)
  }
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

.head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.head-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.head .type {
  font-size: 11px;
  color: var(--text-muted);
}

.head h2 {
  margin: 4px 0 0;
  font-size: 14px;
}

.save-btn {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  font-size: 11px;
  font-weight: 500;
  color: var(--text);
  background: var(--bg-elevated);
  border: 1px solid color-mix(in srgb, var(--border) 80%, transparent);
  border-radius: 6px;
  cursor: pointer;
  transition:
    background 0.12s ease,
    color 0.12s ease,
    border-color 0.12s ease;
}

.save-btn:hover:not(:disabled) {
  background: color-mix(in srgb, var(--accent) 18%, var(--bg-elevated));
  border-color: color-mix(in srgb, var(--accent) 60%, transparent);
  color: var(--accent);
}

.save-btn:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.save-btn-icon {
  font-size: 12px;
  line-height: 1;
}

.hint {
  margin: 0;
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.4;
}

.pose-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.pose-hint {
  margin: 0;
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.4;
}

.pose-preset {
  margin: 0;
  font-size: 11px;
  color: var(--text-muted);
}

.pose-preset code {
  font-family: var(--font-mono, ui-monospace, Menlo, monospace);
  color: var(--text);
}

.section-hint {
  margin: 0;
  padding: 12px;
  border: 1px dashed color-mix(in srgb, var(--border) 80%, transparent);
  border-radius: 6px;
  font-size: 11px;
  color: var(--text-muted);
  text-align: center;
}

.save-status {
  margin: 0;
  padding: 6px 10px;
  font-size: 11px;
  border-radius: 4px;
}

.save-status.ok {
  background: color-mix(in srgb, var(--accent) 14%, transparent);
  color: var(--accent);
}

.save-status.error {
  background: color-mix(in srgb, var(--danger) 16%, transparent);
  color: var(--danger);
}
</style>
