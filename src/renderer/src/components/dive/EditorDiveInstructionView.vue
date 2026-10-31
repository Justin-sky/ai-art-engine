<template>
  <div class="dive-view">
    <EditorDiveGameSystemView
      v-if="node?.typeId === 'asset.gameSystem'"
      :frame-key="frameKey"
      :host-id="hostId"
      :node-id="nodeId"
    />
    <GraphInstructionEditorDialog
      v-else
      :open="true"
      :model-value="instruction"
      :host-id="hostId"
      :node-id="nodeId"
      :preset-kind="presetKind"
      :placeholder="placeholder"
      @update:model-value="onUpdate"
      @change="onChange"
      @close="onClose"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, inject, ref, watch } from 'vue'
import type { InstructionPresetKind } from '@shared/graph/instructionPresets'
import { editorDiveKey } from '../../features/graph/model/editorDive'
import { graphEditorHosts } from '../../features/graph/model/graphEditorHosts'
import { useEditorDiveFrameFlush } from '../../composables/useEditorDiveFrameFlush'
import { useStudioI18n } from '../../composables/useStudioI18n'
import GraphInstructionEditorDialog from '../GraphInstructionEditorDialog.vue'
import EditorDiveGameSystemView from './EditorDiveGameSystemView.vue'

const props = defineProps<{
  frameKey: string
  hostId: string
  nodeId: string
}>()

const { t } = useStudioI18n()
const editorDive = inject(editorDiveKey, null)
const instruction = ref('')
const dirty = ref(false)

const node = computed(() => graphEditorHosts.getNode(props.hostId, props.nodeId))

const presetKind = computed((): InstructionPresetKind | null => {
  const current = node.value
  if (!current?.typeId) return null
  switch (current.typeId) {
    case 'image.toPrompt':
      return 'toPrompt'
    case 'prompt.optimize':
      return 'optimize'
    case 'ui.split':
      return 'uiSplit'
    case 'frame.animGen':
      return 'frameAnimGen'
    case 'svg.gen':
      return 'svgGen'
    case 'asset.novel':
      return 'novel'
    case 'asset.screenplay':
      return 'screenplay'
    case 'asset.gameSystem':
      return 'gameSystem'
    case 'asset.image':
    case 'image.upscale':
      return 'image'
    case 'asset.video':
    case 'semantic.rebuild':
      return 'video'
    case 'video.lipSync':
      return 'lipSync'
    case 'video.reshoot':
      return 'reshoot'
    case 'semantic.compile':
      return 'semanticCompile'
    case 'asset.voice':
      return 'voice'
    case 'asset.dialogue':
      return 'dialogue'
    case 'asset.sfx':
      return 'sfx'
    case 'asset.music':
      return 'music'
    case 'asset.model3d':
      return 'model3d'
    case 'asset.spatialWorld':
      return 'spatialWorld'
    case 'model.pose':
      return 'modelPose'
    case 'model.rigSkin':
      return 'modelRigSkin'
    case 'model.segment':
      return 'modelSegment'
    case 'model.retarget':
      return 'modelRetarget'
    case 'model.texture':
      return 'modelTexture'
    case 'model.animation':
      return 'modelAnimation'
    default:
      return null
  }
})

const placeholder = computed(() => t('graph.inspector.generate.instructionPlaceholder'))

function load(): void {
  instruction.value = String(node.value?.params?.generateInstruction ?? '')
  dirty.value = false
}

watch(
  () => [props.hostId, props.nodeId, graphEditorHosts.revision.value] as const,
  () => load(),
  { immediate: true }
)

function onUpdate(value: string): void {
  instruction.value = value
  dirty.value = true
}

function persist(): void {
  if (!dirty.value) return
  graphEditorHosts.updateNode(props.hostId, props.nodeId, {
    generateInstruction: instruction.value
  })
  dirty.value = false
}

function onChange(): void {
  persist()
}

useEditorDiveFrameFlush(() => props.frameKey, persist)

function onClose(): void {
  persist()
  if (!editorDive) return
  const idx = editorDive.frames.findIndex((frame) => frame.key === props.frameKey)
  editorDive.popTo(idx < 0 ? -1 : idx - 1)
}
</script>

<style scoped>
.dive-view {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
</style>
