<template>
  <div
    class="graph-bundle"
    :class="{
      selected,
      connecting,
      'link-mode': linkMode,
      'force-chrome': forceShowChrome,
      'suppress-chrome': suppressChrome,
      'run-error': runStatus === 'error',
      'run-running': runStatus === 'running'
    }"
    :data-node-id="node.id"
    :style="{
      left: `${node.position.x}px`,
      top: `${node.position.y}px`,
      width: `${width}px`,
      height: `${height}px`
    }"
    :title="hint"
    @pointerdown.stop="onPointerDown"
  >
    <div class="bundle-body">
      <span class="bundle-mark">{{ t('graph.bundle.title') }}</span>
      <span v-if="incomingCount" class="bundle-count">{{ incomingCount }}</span>
    </div>

    <div
      v-for="(port, index) in inPorts"
      :key="`in-${port.id}`"
      class="port-wrap in"
      :style="portWrapStyle(inPorts.length, index)"
    >
      <button
        type="button"
        class="port in"
        :class="{
          'snap-highlight': snapHighlightPortIds?.has(port.id),
          'snap-ready': snapReadyPortIds?.has(port.id)
        }"
        :data-port-id="port.id"
        :title="`${t('graph.port.inTitle')} · ${portTypeLabel(port.dataType)}`"
        @pointerdown.stop.prevent="onInPortDown(port.id, $event)"
      />
    </div>
    <div
      v-for="(port, index) in outPorts"
      :key="`out-${port.id}`"
      class="port-wrap out"
      :style="portWrapStyle(outPorts.length, index)"
    >
      <button
        type="button"
        class="port out"
        :class="{
          'snap-highlight': snapHighlightPortIds?.has(port.id),
          'snap-ready': snapReadyPortIds?.has(port.id)
        }"
        :data-port-id="port.id"
        :title="`${t('graph.port.outTitle')} · ${portTypeLabel(port.dataType)}`"
        @pointerdown.stop.prevent="onOutPortDown(port.id, $event)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import {
  getNodePorts,
  getNodeSize,
  nodePortYRatio,
  type GraphNode,
  type GraphNodeRunState,
  type GraphPortDataType
} from '@shared/graph'
import { useStudioI18n } from '../composables/useStudioI18n'
import { graphEditorHosts, useGraphEditorRevision } from '../features/graph/model/graphEditorHosts'

const props = defineProps<{
  node: GraphNode
  selected?: boolean
  connecting?: boolean
  linkMode?: boolean
  forceShowChrome?: boolean
  suppressChrome?: boolean
  snapHighlightPortIds?: Set<string>
  snapReadyPortIds?: Set<string>
  runStatus?: GraphNodeRunState['status']
  runError?: string
  hostId?: string
}>()

const emit = defineEmits<{
  dragStart: [nodeId: string, e: PointerEvent]
  outPortDown: [nodeId: string, portId: string, e: PointerEvent]
  inPortDown: [nodeId: string, portId: string, e: PointerEvent]
}>()

const { t } = useStudioI18n()
const revision = useGraphEditorRevision()

const size = computed(() => getNodeSize(props.node))
const width = computed(() => size.value.w)
const height = computed(() => size.value.h)

const ports = computed(() => {
  void revision.value
  return getNodePorts(props.node)
})
const inPorts = computed(() => ports.value.filter((p) => p.direction === 'in'))
const outPorts = computed(() => ports.value.filter((p) => p.direction === 'out'))

const incomingCount = computed(() => {
  void revision.value
  if (!props.hostId) return 0
  return graphEditorHosts.listIncomingEdges(props.hostId, props.node.id).length
})

const hint = computed(() => {
  const type = props.node.params.bundleDataType
  const locked = type ? t(`graph.port.types.${type}`) : ''
  return locked ? `${t('graph.bundle.hint')} (${locked})` : t('graph.bundle.hint')
})

function portTypeLabel(dataType: GraphPortDataType): string {
  const key = `graph.port.types.${dataType}`
  return t(key)
}

function portWrapStyle(count: number, index: number): Record<string, string> {
  const ratio = nodePortYRatio(count, index)
  return { top: `${ratio * 100}%` }
}

function onPointerDown(e: PointerEvent): void {
  if (e.button !== 0) return
  emit('dragStart', props.node.id, e)
}

function onInPortDown(portId: string, e: PointerEvent): void {
  emit('inPortDown', props.node.id, portId, e)
}

function onOutPortDown(portId: string, e: PointerEvent): void {
  emit('outPortDown', props.node.id, portId, e)
}
</script>

<style scoped>
.graph-bundle {
  position: absolute;
  box-sizing: border-box;
  border-radius: 999px;
  border: 1.5px solid color-mix(in srgb, var(--studio-border, #3a3a42) 80%, #7a8a9a);
  background:
    linear-gradient(
      135deg,
      color-mix(in srgb, var(--studio-panel, #1e1e24) 88%, #4a6a7a) 0%,
      color-mix(in srgb, var(--studio-panel, #1e1e24) 94%, #2a2a32) 100%
    );
  box-shadow: 0 1px 0 rgba(255, 255, 255, 0.04) inset;
  cursor: grab;
  user-select: none;
  z-index: 2;
}

.graph-bundle.selected {
  border-color: color-mix(in srgb, var(--studio-accent, #6aa8ff) 70%, #fff);
  box-shadow:
    0 0 0 1px color-mix(in srgb, var(--studio-accent, #6aa8ff) 45%, transparent),
    0 1px 0 rgba(255, 255, 255, 0.06) inset;
}

.graph-bundle.connecting,
.graph-bundle.link-mode:hover {
  border-color: color-mix(in srgb, var(--studio-accent, #6aa8ff) 55%, #fff);
}

.graph-bundle.run-running {
  border-color: color-mix(in srgb, #e6b35a 70%, #fff);
}

.graph-bundle.run-error {
  border-color: color-mix(in srgb, #e85d5d 70%, #fff);
}

.bundle-body {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  height: 100%;
  padding: 0 14px;
  box-sizing: border-box;
}

.bundle-mark {
  font-size: 12px;
  font-weight: 650;
  letter-spacing: 0.06em;
  color: color-mix(in srgb, var(--studio-text, #ececf1) 88%, #9ab);
}

.bundle-count {
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 700;
  line-height: 16px;
  text-align: center;
  color: #111;
  background: color-mix(in srgb, var(--studio-accent, #6aa8ff) 85%, #fff);
}

.port-wrap {
  position: absolute;
  transform: translateY(-50%);
  display: flex;
  align-items: center;
  z-index: 3;
}

.port-wrap.in {
  left: -7px;
}

.port-wrap.out {
  right: -7px;
}

.port {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 1.5px solid color-mix(in srgb, var(--studio-border, #555) 70%, #9ab);
  background: color-mix(in srgb, var(--studio-panel, #222) 70%, #445);
  padding: 0;
  cursor: crosshair;
}

.port.snap-highlight {
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--studio-accent, #6aa8ff) 35%, transparent);
}

.port.snap-ready {
  background: var(--studio-accent, #6aa8ff);
  border-color: #fff;
}
</style>
