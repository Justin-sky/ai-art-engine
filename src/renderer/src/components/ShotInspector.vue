<template>
  <div class="inspector" v-if="shot">
    <div class="head">
      <div>
        <div class="type">{{ t('shot.index', { n: shotIndex }) }}</div>
        <h2>{{ t('shot.inspector.title') }}</h2>
      </div>
      <span class="status" :data-status="shot.status">{{ statusLabel(shot.status) }}</span>
    </div>

    <ShotGenRefsEditor
      v-if="!compact"
      :gen-refs="local.genRefs"
      :audio-refs="local.audioRefs"
      :host-id="graphHostId"
      @change="onGenRefsChange"
      @insert-mention="insertVisualMention"
    />

    <label>
      {{ t('shot.table.column.name') }}
      <input v-model="local.title" @change="persist" :placeholder="t('shot.table.placeholder.name')" />
    </label>

    <label>
      {{ t('shot.duration') }}
      <div class="duration-row">
        <input
          type="number"
          min="1"
          max="60"
          v-model.number="local.durationSec"
          @change="persist"
        />
        <span class="unit">{{ t('common.second') }}</span>
      </div>
    </label>

    <label>
      {{ t('shot.field.visual') }}
      <RefMentionTextarea
        v-model="local.storyboard.visualDescription"
        :options="mentionOptions"
        :rows="4"
        :placeholder="t('shot.mention.hint')"
        @change="persist"
      />
    </label>

    <label>
      {{ t('shot.field.shotSize') }}
      <select v-model="local.storyboard.shotSize" @change="persist">
        <option value="">{{ t('common.pleaseSelect') }}</option>
        <option v-for="opt in SHOT_SIZE_OPTIONS" :key="opt" :value="opt">{{ shotSizeLabel(opt) }}</option>
      </select>
    </label>

    <label>
      {{ t('shot.field.lighting') }}
      <input
        v-model="local.storyboard.lighting"
        @change="persist"
        :placeholder="t('shot.placeholder.lighting')"
      />
    </label>

    <label>
      {{ t('shot.field.dialogue') }}
      <textarea
        v-model="local.storyboard.dialogue"
        rows="3"
        @change="persist"
        :placeholder="t('shot.placeholder.dialogue')"
      />
    </label>

    <label>
      {{ t('shot.field.soundFx') }}
      <input
        v-model="local.storyboard.soundFx"
        @change="persist"
        :placeholder="t('shot.placeholder.soundFx')"
      />
    </label>

    <label>
      {{ t('shot.field.cameraMove') }}
      <input
        v-model="local.storyboard.cameraMove"
        @change="persist"
        :placeholder="t('shot.placeholder.cameraMove')"
      />
    </label>

    <label>
      {{ t('shot.field.finalPrompt') }}
      <textarea
        class="final-prompt"
        :value="finalPromptDisplay"
        rows="4"
        readonly
      />
    </label>

    <section class="history" v-if="shot.generations.length">
      <h3>{{ t('shot.history.title') }}</h3>
      <ul>
        <li v-for="g in shot.generations.slice().reverse()" :key="g.id">
          <div class="g-status" :data-ok="g.status === 'done'">{{ g.status }}</div>
          <div class="g-prompt">{{ g.prompt || t('shot.history.noPrompt') }}</div>
          <div class="g-time">{{ formatTime(g.createdAt) }}</div>
        </li>
      </ul>
    </section>
  </div>
  <div v-else class="inspector empty">{{ t('shot.inspector.empty') }}</div>
</template>

<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import ShotGenRefsEditor from './ShotGenRefsEditor.vue'
import RefMentionTextarea from './RefMentionTextarea.vue'
import {
  SHOT_SIZE_OPTIONS,
  buildShotGenerationPrompt,
  listRefMentionOptions,
  normalizeAudioRefs,
  normalizeGenRefs,
  normalizeStoryboard,
  reindexAllShotRefs,
  shotScriptAssetId,
  type Shot,
  type ShotAudioRef,
  type ShotGenRef,
  type ShotStoryboard
} from '@shared/domain'
import { useProjectStore } from '../stores/project'
import { useWorkspaceStore } from '../stores/workspace'
import { listVideoMentionContribution } from '@shared/graph'
import { useStudioI18n } from '../composables/useStudioI18n'
import { useEditorKernel } from '../editor/kernel'
import { graphEditorHosts } from '../features/graph/model/graphEditorHosts'

defineProps<{
  exportCanvas?: () => Promise<string | null>
  /** 节点图模式：引用由画布节点提供，隐藏列表式参考编辑器 */
  compact?: boolean
}>()

const project = useProjectStore()
const workspace = useWorkspaceStore()
const editor = useEditorKernel()
const { t, shotStatusLabel: statusLabel, shotSizeLabel } = useStudioI18n()

const local = reactive({
  title: '',
  durationSec: 5,
  storyboard: {
    visualDescription: '',
    shotSize: '',
    lighting: '',
    dialogue: '',
    soundFx: '',
    cameraMove: '',
    finalPrompt: ''
  } as ShotStoryboard,
  genRefs: [] as ShotGenRef[],
  audioRefs: [] as ShotAudioRef[]
})

const shot = computed(() => project.activeShot)

const graphHostId = computed(() => {
  const s = shot.value
  if (!s) return null
  const scriptId = shotScriptAssetId(s)
  return scriptId ? `script:${scriptId}` : null
})

const shotIndex = computed(() => {
  const s = shot.value
  if (!s) return 0
  const owner = shotScriptAssetId(s)
  const pool = owner
    ? project.shots.filter((x) => shotScriptAssetId(x) === owner)
    : project.shots.filter((x) => !shotScriptAssetId(x))
  const idx = pool.findIndex((x) => x.id === s.id)
  return idx >= 0 ? idx + 1 : 0
})

const assetNameMap = computed(() => new Map(project.assets.map((a) => [a.id, a.name])))
const assetTypeMap = computed(() => new Map(project.assets.map((a) => [a.id, a.type])))

const indexedRefs = computed(() => reindexAllShotRefs(local.genRefs, local.audioRefs))

const finalPromptDisplay = computed(() =>
  buildShotGenerationPrompt(local.storyboard, {
    genRefs: indexedRefs.value.genRefs,
    audioRefs: indexedRefs.value.audioRefs,
    assetNames: assetNameMap.value,
    assetTypes: assetTypeMap.value,
    stylePreset: project.config?.stylePreset
  })
)

const mentionOptions = computed(() =>
  listRefMentionOptions(
    indexedRefs.value.genRefs,
    indexedRefs.value.audioRefs,
    assetNameMap.value,
    assetTypeMap.value
  )
)

watch(
  shot,
  (s) => {
    if (!s) return
    local.title = s.title
    local.durationSec = s.camera.durationSec
    Object.assign(local.storyboard, normalizeStoryboard(s))
    local.genRefs = normalizeGenRefs(s)
    local.audioRefs = normalizeAudioRefs(s)
  },
  { immediate: true }
)

function onGenRefsChange(payload: {
  genRefs: ShotGenRef[]
  audioRefs: ShotAudioRef[]
}): void {
  local.genRefs = payload.genRefs
  local.audioRefs = payload.audioRefs
  void persist()
}

function insertVisualMention(token: string): void {
  const text = local.storyboard.visualDescription
  local.storyboard.visualDescription = text.trim() ? `${text.trim()} ${token}` : token
  void persist()
}

function syncRefsFromGraph(): void {
  const graph = workspace.getActiveGraph()
  if (!graph) return
  const { genRefs, audioRefs } = listVideoMentionContribution(graph)
  local.genRefs = genRefs
  local.audioRefs = audioRefs
}

function buildShotPayload(): Shot | null {
  if (!shot.value) return null
  syncRefsFromGraph()
  const storyboard: ShotStoryboard = { ...local.storyboard }
  const indexed = reindexAllShotRefs(local.genRefs, local.audioRefs)
  const prompt = buildShotGenerationPrompt(storyboard, {
    genRefs: indexed.genRefs,
    audioRefs: indexed.audioRefs,
    assetNames: assetNameMap.value,
    assetTypes: assetTypeMap.value,
    stylePreset: project.config?.stylePreset
  })
  const liveGraph = workspace.getActiveGraph()
  const canvas = shot.value.canvas
  return {
    ...shot.value,
    title: local.title.trim() || shot.value.title,
    prompt,
    storyboard,
    genRefs: indexed.genRefs.map((r) => ({ ...r })),
    audioRefs: indexed.audioRefs.map((r) => ({ ...r })),
    canvas: {
      ...canvas,
      graphJson: liveGraph ?? canvas.graphJson ?? null
    },
    camera: {
      motion: shot.value.camera.motion,
      durationSec: local.durationSec
    }
  }
}

async function persist(): Promise<void> {
  const selectedHost = editor.selection.current.value.hostId
  const scriptId = shot.value ? shotScriptAssetId(shot.value) : undefined
  await graphEditorHosts.flush(selectedHost ?? (scriptId ? `script:${scriptId}` : null))
  const next = buildShotPayload()
  if (!next) return
  await project.persistShotCommand(next, 'Update shot inspector')
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}
</script>

<style scoped>
.inspector {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
  height: 100%;
  overflow: auto;
}

.inspector.empty {
  color: var(--text-muted);
  align-items: center;
  justify-content: center;
}

.head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.head h2 {
  margin: 2px 0 0;
  font-size: 14px;
}

.type {
  font-size: 11px;
  color: var(--text-muted);
  letter-spacing: 0.04em;
}

.status {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--bg-elevated);
  color: var(--text-muted);
  flex-shrink: 0;
}

.status[data-status='generating'] {
  color: var(--warning);
}

.status[data-status='done'] {
  color: var(--success);
}

.status[data-status='failed'] {
  color: var(--danger);
}

label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  color: var(--text-muted);
  font-size: 12px;
}

.duration-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.duration-row input {
  width: 72px;
}

.unit {
  color: var(--text-muted);
  font-size: 12px;
}

.final-prompt {
  opacity: 0.85;
  cursor: default;
  background: var(--bg-elevated);
}

.history h3 {
  font-size: 12px;
  color: var(--text-muted);
  margin-bottom: 8px;
}

.history ul {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.history li {
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 8px;
}

.g-status {
  font-size: 11px;
  text-transform: uppercase;
  color: var(--danger);
  margin-bottom: 4px;
}

.g-status[data-ok='true'] {
  color: var(--success);
}

.g-prompt {
  font-size: 12px;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.g-time {
  margin-top: 4px;
  font-size: 10px;
  color: var(--text-muted);
}
</style>
