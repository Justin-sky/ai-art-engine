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
        :title="t('graph.inspector.modelAnimation.saveToAssetTitle')"
        @click="openSaveDialog"
      >
        <span class="save-btn-icon" aria-hidden="true">⤴</span>
        <span>{{ t('graph.inspector.modelAnimation.saveToAsset') }}</span>
      </button>
    </div>
    <p class="hint">
      {{ t('graph.inspector.modelAnimation.hint') }}
    </p>

    <GraphNodeRunControl
      v-if="hasInPort"
      :status="runStatus"
      :is-running="isGraphRunning"
      :blocked="blocked"
      @toggle="toggleRun"
    />
    <BlenderDshLiveStatus :node-id="node.id" />

    <section
      v-if="modelPreviewPath && clip"
      class="anim-section"
      :aria-label="t('graph.inspector.modelAnimation.animPreview')"
    >
      <p class="anim-hint">
        {{ t('graph.inspector.modelAnimation.animHint') }}
      </p>
      <ModelPreview
        :relative-path="modelPreviewPath"
        :bone-pose="currentPose"
        :show-skeleton="false"
        :show-save-to-library="true"
      />

      <div class="timeline">
        <button
          type="button"
          class="play-btn"
          :aria-label="
            playing
              ? t('graph.inspector.modelAnimation.pause')
              : t('graph.inspector.modelAnimation.play')
          "
          @click="togglePlay"
        >
          <span aria-hidden="true">{{ playing ? '❚❚' : '▶' }}</span>
        </button>
        <input
          class="frame-slider"
          type="range"
          :min="frameStart"
          :max="frameEnd"
          step="1"
          :value="currentFrame"
          :aria-label="
            t('graph.inspector.modelAnimation.frameLabel', {
              n: currentFrame,
              total: frameEnd - frameStart + 1
            })
          "
          @input="onScrub($event)"
        />
        <code class="frame-readout"> {{ currentFrame }} / {{ frameEnd }} </code>
      </div>

      <dl class="clip-meta">
        <div class="clip-meta-row">
          <dt>{{ t('graph.inspector.modelAnimation.clipName') }}</dt>
          <dd>
            <code>{{ clip.name || '—' }}</code>
          </dd>
        </div>
        <div class="clip-meta-row">
          <dt>{{ t('graph.inspector.modelAnimation.fps') }}</dt>
          <dd>
            <code>{{ clip.fps }}</code>
          </dd>
        </div>
        <div class="clip-meta-row">
          <dt>{{ t('graph.inspector.modelAnimation.frameCount') }}</dt>
          <dd>
            <code>{{ frameEnd - frameStart + 1 }}</code>
          </dd>
        </div>
        <div v-if="clip.presetId" class="clip-meta-row">
          <dt>{{ t('graph.inspector.modelAnimation.preset') }}</dt>
          <dd>
            <code>{{ clip.presetId }}</code>
          </dd>
        </div>
      </dl>
    </section>
    <section
      v-else-if="!modelPreviewPath"
      class="anim-section"
      :aria-label="t('graph.inspector.modelAnimation.animPreview')"
    >
      <p class="section-hint">
        {{ t('graph.inspector.modelAnimation.noModel') }}
      </p>
    </section>
    <section
      v-else
      class="anim-section"
      :aria-label="t('graph.inspector.modelAnimation.animPreview')"
    >
      <p class="section-hint">
        {{ t('graph.inspector.modelAnimation.animEmpty') }}
      </p>
    </section>

    <GeneratedModelsGallery v-if="node && hostId" :node="node" :host-id="hostId" />

    <p v-if="saveStatus === 'ok'" class="save-status ok" role="status">
      {{ t('graph.inspector.modelAnimation.saveDone', { path: savedPath }) }}
    </p>
    <p v-else-if="saveStatus === 'error'" class="save-status error" role="alert">
      {{ t('graph.inspector.modelAnimation.saveFailed', { message: saveError }) }}
    </p>

    <SaveAssetDialog
      ref="saveDialogRef"
      :open="saveDialogOpen"
      :default-name="saveDialogDefaultName"
      :title="t('graph.inspector.modelAnimation.saveDialogTitle')"
      :subtitle="t('graph.inspector.modelAnimation.saveDialogSubtitle')"
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
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import GraphNodeRunControl from './GraphNodeRunControl.vue'
import BlenderDshLiveStatus from './BlenderDshLiveStatus.vue'
import GraphNodeOutputPreview from './GraphNodeOutputPreview.vue'
import ModelPreview from './ModelPreview.vue'
import GeneratedModelsGallery from './GeneratedModelsGallery.vue'
import SaveAssetDialog from './SaveAssetDialog.vue'
import { useStudioI18n } from '../composables/useStudioI18n'
import { useNodeDisplayTitle } from '../composables/useNodeDisplayTitle'
import { useGraphNodeRun } from '../composables/useGraphNodeRun'
import { useEditorKernel } from '../editor/kernel'
import { useProjectStore } from '../stores/project'
import { graphEditorHosts } from '../features/graph/model/graphEditorHosts'
import { buildAnimationAssetGenParams, type StageVec3 } from '@shared/domain'

/**
 * 3D 动画节点的 inspector：
 *
 * - 「动画预览」：共享 `ModelPreview` + 帧级 scrubber + play/pause。关键帧字典
 *   `clip.keyframes` 是离散的「骨名 → 帧号 → [x, y, z] 局部欧拉弧度」（与
 *   `GraphAssetValue.clip` 同口径）。ModelPreview 的 `previewClip` 只能放
 *   GLB 内嵌 AnimationClip，不能直接吃运行时关键帧字典——所以走已有的
 *   `bonePose` 通路：当前帧 = 在关键帧之间按时间线性插值得到的局部欧拉姿态，
 *   喂给 ModelPreview → bind × Euler 子骨 FK 跟随父骨变形 / SkinnedMesh 按原始
 *   vertex 权重自动 blend，与姿势预览同口径（同样 rad 单位）。
 *
 *   时间轴在 1..frameRange[1] 之间播放（循环）；用户拖动 slider 可单帧定位。
 *   关键帧的「骨名」原样来自 Blender readback，未匹配到模型骨骼的那一帧会自动
 *   跳过（与姿势预览同一套行为）；播放/暂停按钮 ❚❚ / ▶ 与键盘友好；不插帧，
 *   一帧 1/fps s 的步进以保持与 fps 实际节奏同步（fps 高时一次跳多帧）。
 *
 * - 「保存到资产库」按钮（右上角）：把当前 Cook 写出的 clip 落成动画资产
 *   —— 新增 `AnimationAssetData` + `buildAnimationAssetGenParams`（与姿势资产
 *   对称）：`genParams = { modelKind: 'animation', animation: { schemaVersion: 1,
 *   clipName, fps, frameRange, keyframes, presetId, sourceModelAssetId } }`。
 *   源模型 assetId 来自 Cook 缓存。`isAnimationModelAsset` 早就识别 'animation'
 *   modelKind —— 这次把数据形状落稳；stage `loadAnimationAsset` 仍按 GLB 文件
 *   加载，「缺文件则按 genParams 构造 AnimationClip」的集成留作跟进。空 clip /
 *   Cook 未运行时按钮禁用。
 *
 * 文本生成模型选择器、动画指令输入框与常用动画 chip 都已迁移到卡片下方的
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
  return current?.typeId === 'model.animation' ? current : null
})

const hostId = computed(() => {
  const selection = editor.selection.current.value
  return selection.kind === 'graph.node' ? (selection.hostId ?? '') : ''
})

const { hasInPort, runStatus, isGraphRunning, blocked, toggleRun } = useGraphNodeRun(node)

const typeLabel = computed(() => graphTypeLabel('model.animation'))
const displayTitle = useNodeDisplayTitle(node, typeLabel)

/** 输入端模型路径（最近 Cook 写入，供预览） */
const modelPreviewPath = computed((): string | null => {
  const current = node.value
  if (!current) return null
  return current.params.animationModelRelativePath?.trim() || null
})

/** 最近一次 Cook 写入的关键帧 clip */
const clip = computed(() => node.value?.params.clip ?? null)

const frameStart = computed(() => clip.value?.frameRange?.[0] ?? 1)
const frameEnd = computed(() => {
  const end = clip.value?.frameRange?.[1] ?? 1
  return Math.max(end, frameStart.value)
})

const currentFrame = ref<number>(1)
const playing = ref(false)

watch(
  () => clip.value,
  (next) => {
    currentFrame.value = next?.frameRange?.[0] ?? 1
    playing.value = false
  },
  { immediate: true }
)

/** 当前帧的插值后姿态（骨名 → 局部欧拉弧度） */
const currentPose = computed((): Record<string, StageVec3> | null => {
  const c = clip.value
  if (!c) return null
  const out: Record<string, StageVec3> = {}
  const f = currentFrame.value
  for (const [bone, frameMap] of Object.entries(c.keyframes)) {
    const frames = Object.keys(frameMap)
      .map((k) => Number(k))
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => a - b)
    if (frames.length === 0) continue
    const first = frames[0]
    const last = frames[frames.length - 1]
    if (f <= first) {
      const e = frameMap[String(first)]
      if (e) {
        out[bone] = { x: e[0], y: e[1], z: e[2] }
        continue
      }
    }
    if (f >= last) {
      const e = frameMap[String(last)]
      if (e) {
        out[bone] = { x: e[0], y: e[1], z: e[2] }
        continue
      }
    }
    let prev = first
    let next = last
    for (let i = 0; i < frames.length - 1; i++) {
      if (frames[i] <= f && frames[i + 1] >= f) {
        prev = frames[i]
        next = frames[i + 1]
        break
      }
    }
    const span = next - prev
    const tNorm = span > 0 ? (f - prev) / span : 0
    const a = frameMap[String(prev)]
    const b = frameMap[String(next)]
    if (!a || !b) continue
    out[bone] = {
      x: a[0] + (b[0] - a[0]) * tNorm,
      y: a[1] + (b[1] - a[1]) * tNorm,
      z: a[2] + (b[2] - a[2]) * tNorm
    }
  }
  return Object.keys(out).length ? out : null
})

// --- 播放循环（按 fps 节拍推进 currentFrame，循环到 frameStart） -----------

let rafHandle = 0
let lastTickTs = 0
let frameAccumulator = 0

function tickFrame(ts: number): void {
  rafHandle = 0
  if (!playing.value) return
  if (!lastTickTs) {
    lastTickTs = ts
    rafHandle = requestAnimationFrame(tickFrame)
    return
  }
  const dtMs = ts - lastTickTs
  lastTickTs = ts
  const c = clip.value
  if (!c) return
  const fps = c.fps > 0 ? c.fps : 24
  const dtFrames = (dtMs / 1000) * fps
  frameAccumulator += dtFrames
  let nextFrame = currentFrame.value
  while (frameAccumulator >= 1) {
    nextFrame += 1
    frameAccumulator -= 1
  }
  if (nextFrame > frameEnd.value) nextFrame = frameStart.value
  currentFrame.value = nextFrame
  rafHandle = requestAnimationFrame(tickFrame)
}

function startLoop(): void {
  if (rafHandle) return
  lastTickTs = 0
  frameAccumulator = 0
  rafHandle = requestAnimationFrame(tickFrame)
}

function stopLoop(): void {
  if (rafHandle) {
    cancelAnimationFrame(rafHandle)
    rafHandle = 0
  }
  lastTickTs = 0
  frameAccumulator = 0
}

watch(playing, (next) => {
  if (next) startLoop()
  else stopLoop()
})

onBeforeUnmount(() => {
  stopLoop()
})

function togglePlay(): void {
  if (!clip.value) return
  playing.value = !playing.value
}

function onScrub(ev: Event): void {
  const target = ev.target as HTMLInputElement
  const v = Number(target.value)
  if (!Number.isFinite(v)) return
  playing.value = false
  currentFrame.value = v
}

// --- 保存到资产库 -------------------------------------------------------------

const canSave = computed(() => {
  const c = clip.value
  if (!c) return false
  return Boolean(c.name) && Object.keys(c.keyframes).length > 0
})

const saveDialogRef = ref<InstanceType<typeof SaveAssetDialog> | null>(null)
const saveDialogOpen = ref(false)
const saving = ref(false)
const saveStatus = ref<'idle' | 'ok' | 'error'>('idle')
const saveError = ref('')
const savedPath = ref('')

const saveDialogDefaultName = computed(() => {
  const preset = clip.value?.presetId
  if (preset) return preset
  if (clip.value?.name) return clip.value.name
  return t('graph.inspector.modelAnimation.saveDialogDefaultName')
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
  const c = clip.value
  if (!current || !c) return
  saving.value = true
  saveDialogRef.value?.setSaving(true)
  try {
    const sourceAssetId = current.params.animationSourceAssetId?.trim() || null
    const genParams = buildAnimationAssetGenParams(c, sourceAssetId)
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

.anim-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.anim-hint {
  margin: 0;
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.4;
}

.timeline {
  display: flex;
  align-items: center;
  gap: 8px;
}

.play-btn {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 24px;
  font-size: 10px;
  color: var(--text);
  background: var(--bg-elevated);
  border: 1px solid color-mix(in srgb, var(--border) 80%, transparent);
  border-radius: 4px;
  cursor: pointer;
}

.play-btn:hover {
  background: color-mix(in srgb, var(--accent) 18%, var(--bg-elevated));
  border-color: color-mix(in srgb, var(--accent) 60%, transparent);
  color: var(--accent);
}

.frame-slider {
  flex: 1;
  min-width: 0;
  accent-color: var(--accent);
}

.frame-readout {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--text-muted);
  font-family: var(--font-mono, ui-monospace, Menlo, monospace);
  min-width: 56px;
  text-align: right;
}

.clip-meta {
  margin: 0;
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 4px 10px;
  padding: 8px 10px;
  border: 1px solid color-mix(in srgb, var(--border) 80%, transparent);
  border-radius: 6px;
  background: color-mix(in srgb, var(--bg-elevated) 60%, transparent);
  font-size: 11px;
}

.clip-meta-row {
  display: contents;
}

.clip-meta dt {
  color: var(--text-muted);
  font-weight: 500;
}

.clip-meta dd {
  margin: 0;
  color: var(--text);
  font-family: var(--font-mono, ui-monospace, Menlo, monospace);
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
