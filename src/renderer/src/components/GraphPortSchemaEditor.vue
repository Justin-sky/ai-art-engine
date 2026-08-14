<template>
  <div
    class="port-schema-editor"
    :class="{ collapsed }"
  >
    <div class="head-row">
      <button
        type="button"
        class="collapse-tri-btn"
        :class="{ collapsed }"
        :title="collapsed ? t('graph.hostInterface.expandPorts') : t('graph.hostInterface.collapsePorts')"
        :aria-expanded="!collapsed"
        :aria-label="collapsed ? t('graph.hostInterface.expandPorts') : t('graph.hostInterface.collapsePorts')"
        @click="collapsed = !collapsed"
      >
        <span
          class="collapse-tri"
          aria-hidden="true"
        />
      </button>
      <button
        type="button"
        class="title-btn"
        @click="collapsed = !collapsed"
      >
        <h3>{{ title }}</h3>
        <span class="count">{{ modelValue.length }}</span>
      </button>
      <button
        v-if="!collapsed"
        type="button"
        class="add-btn"
        @click="addPort"
      >
        {{ t('graph.hostInterface.addPort') }}
      </button>
    </div>
    <template v-if="!collapsed">
      <p
        v-if="modelValue.length > 1"
        class="reorder-hint"
      >
        {{ t('graph.hostInterface.reorderHint') }}
      </p>
      <div
        v-if="!modelValue.length"
        class="empty"
      >
        {{ t('graph.hostInterface.emptyPorts') }}
      </div>
      <div
        v-for="(port, index) in modelValue"
        :key="port.id"
        class="port-row"
        :class="{
          dragging: dragFromIndex === index,
          'drop-before': dropIndex === index && dragFromIndex !== null && dragFromIndex > index,
          'drop-after': dropIndex === index && dragFromIndex !== null && dragFromIndex < index
        }"
        @dragover.prevent="onDragOver(index, $event)"
        @drop.prevent="onDrop(index)"
      >
        <button
          type="button"
          class="drag-handle"
          draggable="true"
          :title="t('graph.hostInterface.reorderHandle')"
          :aria-label="t('graph.hostInterface.reorderHandle')"
          @dragstart="onDragStart(index, $event)"
          @dragend="onDragEnd"
        >
          ⋮⋮
        </button>
        <div class="port-fields">
          <label>
            {{ t('graph.hostInterface.portType') }}
            <select
              :value="port.dataType"
              @change="
                patch(index, {
                  dataType: ($event.target as HTMLSelectElement).value as GraphPortDataType
                })
              "
            >
              <option
                v-for="dt in dataTypes"
                :key="dt"
                :value="dt"
              >
                {{ t(`graph.port.types.${dt}`) }}
              </option>
            </select>
          </label>
          <label>
            {{ t('graph.hostInterface.portLabel') }}
            <input
              :value="port.label"
              @change="patch(index, { label: ($event.target as HTMLInputElement).value.trim() || port.id })"
            >
          </label>
          <button
            type="button"
            class="remove"
            :title="t('common.delete')"
            :aria-label="t('common.delete')"
            @pointerdown.stop
            @click.stop="remove(index)"
          >
            <svg
              viewBox="0 0 24 24"
              width="14"
              height="14"
              aria-hidden="true"
            >
              <path
                fill="currentColor"
                d="M9 3h6l1 2h4v2H4V5h4l1-2Zm-2 6h10l-1 11H8L7 9Zm3 2v7h2v-7h-2Zm4 0v7h2v-7h-2Z"
              />
            </svg>
            <span>{{ t('common.delete') }}</span>
          </button>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import {
  GraphPortType,
  hostBoundaryPortLabel,
  type GraphPortDataType,
  type HostBoundaryPort
} from '@shared/graph'
import { useStudioI18n } from '../composables/useStudioI18n'

const props = withDefaults(
  defineProps<{
    title: string
    direction: 'in' | 'out'
    modelValue: HostBoundaryPort[]
    /** 默认是否折叠 */
    defaultCollapsed?: boolean
  }>(),
  { defaultCollapsed: true }
)

const emit = defineEmits<{
  'update:modelValue': [value: HostBoundaryPort[]]
}>()

const { t } = useStudioI18n()

const dataTypes = Object.values(GraphPortType) as GraphPortDataType[]
const collapsed = ref(props.defaultCollapsed)
const dragFromIndex = ref<number | null>(null)
const dropIndex = ref<number | null>(null)

function emitNext(next: HostBoundaryPort[]): void {
  emit('update:modelValue', next)
}

function typeOrdinal(dataType: GraphPortDataType, beforeIndex?: number): number {
  let count = 0
  for (let i = 0; i < props.modelValue.length; i++) {
    if (beforeIndex != null && i >= beforeIndex) break
    if (props.modelValue[i]?.dataType === dataType) count += 1
  }
  return count + 1
}

function patch(index: number, partial: Partial<HostBoundaryPort>): void {
  const next = props.modelValue.map((port, i) => {
    if (i !== index) return port
    const merged: HostBoundaryPort = { ...port, ...partial }
    if (partial.dataType && partial.dataType !== port.dataType) {
      const sameTypeBefore = props.modelValue
        .slice(0, index)
        .filter((p) => p.dataType === partial.dataType).length
      merged.label = hostBoundaryPortLabel(partial.dataType, props.direction, sameTypeBefore + 1)
    }
    return merged
  })
  emitNext(next)
}

function remove(index: number): void {
  emitNext(props.modelValue.filter((_, i) => i !== index))
}

function addPort(): void {
  const used = new Set(props.modelValue.map((port) => port.id))
  let index = 0
  while (used.has(`${props.direction}-${index}`)) index += 1
  const id = `${props.direction}-${index}`
  const dataType = GraphPortType.text
  emitNext([
    ...props.modelValue,
    {
      id,
      label: hostBoundaryPortLabel(dataType, props.direction, typeOrdinal(dataType)),
      dataType,
      multiple: props.direction === 'in'
    }
  ])
}

function onDragStart(index: number, event: DragEvent): void {
  dragFromIndex.value = index
  dropIndex.value = index
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', String(index))
  }
}

function onDragOver(index: number, event: DragEvent): void {
  if (dragFromIndex.value == null) return
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  dropIndex.value = index
}

function onDrop(index: number): void {
  const from = dragFromIndex.value
  if (from == null || from === index) {
    onDragEnd()
    return
  }
  const next = [...props.modelValue]
  const [item] = next.splice(from, 1)
  if (!item) {
    onDragEnd()
    return
  }
  next.splice(index, 0, item)
  emitNext(next)
  onDragEnd()
}

function onDragEnd(): void {
  dragFromIndex.value = null
  dropIndex.value = null
}
</script>

<style scoped>
.port-schema-editor {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.head-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.title-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  min-width: 0;
  margin: 0;
  padding: 0;
  border: none;
  background: transparent;
  color: inherit;
  cursor: pointer;
  text-align: left;
}
.head-row h3 {
  margin: 0;
  font-size: 13px;
}
.count {
  flex-shrink: 0;
  min-width: 16px;
  padding: 0 5px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--border) 55%, transparent);
  font-size: 10px;
  line-height: 16px;
  color: var(--text-muted);
  text-align: center;
}
.collapse-tri-btn {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  padding: 0;
  margin: 0;
  border: none;
  border-radius: 3px;
  background: transparent;
  cursor: pointer;
  color: var(--text-muted);
}
.collapse-tri-btn:hover {
  background: var(--wash-06);
  color: var(--text);
}
.collapse-tri {
  display: block;
  width: 0;
  height: 0;
  border-left: 4px solid transparent;
  border-right: 4px solid transparent;
  border-top: 5px solid currentColor;
}
.collapse-tri-btn.collapsed .collapse-tri {
  border-top: 4px solid transparent;
  border-bottom: 4px solid transparent;
  border-left: 5px solid currentColor;
  border-right: none;
}
.add-btn {
  margin-left: auto;
}
.reorder-hint {
  margin: 0;
  font-size: 11px;
  opacity: 0.7;
}
.add-btn {
  font-size: 12px;
  padding: 2px 8px;
}
.remove {
  grid-column: 1 / -1;
  justify-self: end;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  width: auto;
  margin: 2px 0 0;
  padding: 3px 10px;
  border: 1px solid color-mix(in srgb, var(--danger) 40%, var(--border));
  border-radius: 6px;
  background: var(--bg-elevated);
  color: var(--danger);
  font-size: 11px;
  font-weight: 600;
  line-height: 1.2;
  cursor: pointer;
}
.remove svg {
  width: 12px;
  height: 12px;
}
.remove:hover {
  background: color-mix(in srgb, var(--danger) 14%, var(--bg-elevated));
}
.port-row {
  display: grid;
  grid-template-columns: 22px 1fr;
  gap: 6px;
  padding: 8px;
  border: 1px solid color-mix(in srgb, var(--border) 80%, transparent);
  border-radius: 6px;
  transition: border-color 0.12s ease, opacity 0.12s ease;
}
.port-row.dragging {
  opacity: 0.55;
}
.port-row.drop-before {
  border-top-color: var(--accent);
  box-shadow: inset 0 2px 0 var(--accent);
}
.port-row.drop-after {
  border-bottom-color: var(--accent);
  box-shadow: inset 0 -2px 0 var(--accent);
}
.drag-handle {
  align-self: start;
  margin-top: 18px;
  width: 22px;
  height: 22px;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--text-muted);
  cursor: grab;
  font-size: 12px;
  line-height: 1;
  letter-spacing: -1px;
}
.drag-handle:active {
  cursor: grabbing;
}
.drag-handle:hover {
  background: color-mix(in srgb, var(--accent) 16%, transparent);
  color: var(--text);
}
.port-fields {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px 8px;
  min-width: 0;
}
.port-fields label {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 11px;
}
.port-fields input,
.port-fields select {
  font-size: 12px;
}
.empty {
  font-size: 12px;
  opacity: 0.7;
}
</style>
