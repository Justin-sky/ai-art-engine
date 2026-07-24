<template>
  <div class="node-inspector" v-if="node">
    <div class="head">
      <span class="type">{{ typeLabel }}</span>
      <h2>{{ node.title || typeLabel }}</h2>
    </div>
    <p class="hint">{{ t('graph.inspector.shotParams.hint') }}</p>

    <GraphNodeOutputPreview v-if="hostId" :node="node" :host-id="hostId" />

    <label>
      {{ t('graph.inspector.shotParams.boundShot') }}
      <input :value="boundShotLabel" disabled />
    </label>

    <label>
      {{ t('graph.inspector.displayName') }}
      <input v-model="localTitle" @change="persistTitle" />
    </label>

    <ShotStagingPresetPicker
      :storyboard="localStoryboard"
      :resolve-insertion-positions="resolveStagingInsertionPositions"
      @apply="applyStagingPreset"
    />

    <label>
      {{ t('shot.field.visual') }}
      <RefMentionTextarea
        ref="visualDescriptionEl"
        v-model="localStoryboard.visualDescription"
        :options="mentionOptions"
        :rows="4"
        :placeholder="t('shot.mention.labelHint')"
        :hint="t('shot.mention.labelHint')"
        @focus="activeStagingField = 'visualDescription'"
        @change="persistStoryboard"
      />
    </label>

    <label>
      {{ t('shot.field.shotSize') }}
      <select v-model="localStoryboard.shotSize" @change="persistStoryboard">
        <option value="">{{ t('common.pleaseSelect') }}</option>
        <option v-for="opt in SHOT_SIZE_OPTIONS" :key="opt" :value="opt">{{ shotSizeLabel(opt) }}</option>
      </select>
    </label>

    <label>
      {{ t('shot.field.lighting') }}
      <textarea
        ref="lightingEl"
        v-model="localStoryboard.lighting"
        rows="3"
        @focus="activeStagingField = 'lighting'"
        @change="persistStoryboard"
        :placeholder="t('shot.placeholder.lighting')"
      />
      <ShotStagingPresetPicker
        field="lighting"
        :storyboard="localStoryboard"
        :resolve-insertion-positions="resolveStagingInsertionPositions"
        @focusin="activeStagingField = 'lighting'"
        @apply="applyStagingPreset"
      />
    </label>

    <label>
      {{ t('shot.field.dialogue') }}
      <textarea
        v-model="localStoryboard.dialogue"
        rows="3"
        @change="persistStoryboard"
        :placeholder="t('shot.placeholder.dialogue')"
      />
    </label>

    <label>
      {{ t('shot.field.soundFx') }}
      <input
        v-model="localStoryboard.soundFx"
        @change="persistStoryboard"
        :placeholder="t('shot.placeholder.soundFx')"
      />
    </label>

    <label>
      {{ t('shot.field.cameraMove') }}
      <textarea
        ref="cameraMoveEl"
        v-model="localStoryboard.cameraMove"
        rows="3"
        @focus="activeStagingField = 'cameraMove'"
        @change="persistStoryboard"
        :placeholder="t('shot.placeholder.cameraMove')"
      />
      <ShotStagingPresetPicker
        field="cameraMove"
        :storyboard="localStoryboard"
        :resolve-insertion-positions="resolveStagingInsertionPositions"
        @focusin="activeStagingField = 'cameraMove'"
        @apply="applyStagingPreset"
      />
    </label>

    <label>
      {{ t('shot.field.finalPrompt') }}
      <textarea class="final-prompt" :value="finalPromptDisplay" rows="4" readonly />
    </label>
  </div>
  <div v-else class="node-inspector empty">{{ t('graph.inspector.node.empty') }}</div>
</template>

<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue'
import {
  SHOT_SIZE_OPTIONS,
  buildShotGenerationPrompt,
  listRefMentionOptions,
  normalizeAudioRefs,
  normalizeGenRefs,
  reindexAllShotRefs,
  type ShotStoryboard
} from '@shared/domain'
import {
  listVideoMentionContribution,
  readBoundShotIdFromNodeParams,
  readShotStoryboardFromNodeParams,
  shotStoryboardToNodeParams,
  type ShotStagingTextField
} from '@shared/graph'
import GraphNodeOutputPreview from './GraphNodeOutputPreview.vue'
import RefMentionTextarea from './RefMentionTextarea.vue'
import ShotStagingPresetPicker from './ShotStagingPresetPicker.vue'
import { useStudioI18n } from '../composables/useStudioI18n'
import { useEditorKernel } from '../editor/kernel'
import { graphEditorHosts } from '../features/graph/model/graphEditorHosts'
import { useProjectStore } from '../stores/project'
import { useWorkspaceStore } from '../stores/workspace'

const { t, graphTypeLabel, shotSizeLabel } = useStudioI18n()
const editor = useEditorKernel()
const project = useProjectStore()
const workspace = useWorkspaceStore()

const localTitle = ref('')
type MentionTextareaHandle = {
  getSelection: () => { start: number; end: number }
  setSelection: (start: number, end?: number) => void
}
const visualDescriptionEl = ref<MentionTextareaHandle | null>(null)
const lightingEl = ref<HTMLTextAreaElement | null>(null)
const cameraMoveEl = ref<HTMLTextAreaElement | null>(null)
const activeStagingField = ref<ShotStagingTextField | null>(null)
const localStoryboard = reactive<ShotStoryboard>({
  visualDescription: '',
  shotSize: '',
  lighting: '',
  dialogue: '',
  soundFx: '',
  cameraMove: '',
  finalPrompt: ''
})

const node = computed(() => {
  const selection = editor.selection.current.value
  const id = selection.kind === 'graph.node' ? selection.id : null
  if (!id) return null
  const current = graphEditorHosts.getNode(selection.hostId, id)
  return current?.typeId === 'script.shotParams' ? current : null
})

const hostId = computed(() => {
  const selection = editor.selection.current.value
  return selection.kind === 'graph.node' ? selection.hostId ?? '' : ''
})

const typeLabel = computed(() => graphTypeLabel('script.shotParams'))

const boundShotLabel = computed(() => {
  const shotId = readBoundShotIdFromNodeParams(node.value?.params)
  if (!shotId) return t('graph.inspector.shotParams.unbound')
  const shot = project.shots.find((s) => s.id === shotId)
  if (!shot) return shotId
  const index = project.shots.findIndex((s) => s.id === shotId)
  return t('graph.inspector.shotParams.boundShotValue', {
    n: index >= 0 ? index + 1 : '?',
    title: shot.title || t('common.unnamed')
  })
})

const assetNameMap = computed(() => new Map(project.assets.map((a) => [a.id, a.name])))
const assetTypeMap = computed(() => new Map(project.assets.map((a) => [a.id, a.type])))

const indexedRefs = computed(() => {
  const graph = workspace.getActiveGraph()
  if (graph) {
    const { genRefs, audioRefs } = listVideoMentionContribution(graph)
    return reindexAllShotRefs(genRefs, audioRefs)
  }
  const shot = project.activeShot
  if (!shot) return reindexAllShotRefs([], [])
  return reindexAllShotRefs(normalizeGenRefs(shot), normalizeAudioRefs(shot))
})

const mentionOptions = computed(() =>
  listRefMentionOptions(
    indexedRefs.value.genRefs,
    indexedRefs.value.audioRefs,
    assetNameMap.value,
    assetTypeMap.value
  )
)

const finalPromptDisplay = computed(() =>
  buildShotGenerationPrompt(localStoryboard, {
    stylePreset: project.config?.stylePreset
  })
)

function resolveStagingInsertionPositions(): Partial<Record<ShotStagingTextField, number>> {
  return {
    visualDescription: visualDescriptionEl.value?.getSelection().start,
    lighting: lightingEl.value?.selectionStart ?? localStoryboard.lighting.length,
    cameraMove: cameraMoveEl.value?.selectionStart ?? localStoryboard.cameraMove.length
  }
}

watch(
  node,
  (current) => {
    if (!current) {
      localTitle.value = ''
      Object.assign(localStoryboard, readShotStoryboardFromNodeParams(undefined))
      return
    }
    localTitle.value = current.title ?? typeLabel.value
    Object.assign(localStoryboard, readShotStoryboardFromNodeParams(current.params))
  },
  { immediate: true }
)

function persistTitle(): void {
  if (!node.value) return
  const selection = editor.selection.current.value
  graphEditorHosts.updateNode(selection.hostId, node.value.id, {}, localTitle.value.trim())
}

function persistStoryboard(): void {
  if (!node.value) return
  const selection = editor.selection.current.value
  graphEditorHosts.updateNode(
    selection.hostId,
    node.value.id,
    shotStoryboardToNodeParams({ ...localStoryboard })
  )
}

function applyStagingPreset(storyboard: ShotStoryboard): void {
  const field = activeStagingField.value
  const position = field ? resolveStagingInsertionPositions()[field] : undefined
  const insertedLength = field
    ? storyboard[field].length - localStoryboard[field].length
    : 0
  Object.assign(localStoryboard, storyboard)
  persistStoryboard()
  if (!field || position === undefined || insertedLength <= 0) return
  void nextTick(() => {
    const cursor = position + insertedLength
    if (field === 'visualDescription') visualDescriptionEl.value?.setSelection(cursor)
    else {
      const el = field === 'lighting' ? lightingEl.value : cameraMoveEl.value
      el?.focus()
      el?.setSelectionRange(cursor, cursor)
    }
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

.final-prompt {
  opacity: 0.85;
  cursor: default;
  background: var(--bg-elevated);
}
</style>
