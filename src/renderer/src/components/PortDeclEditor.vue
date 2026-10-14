<template>
  <div class="port-decl">
    <div class="pd-head">
      <span class="field-label">{{ title }}</span>
      <button type="button" class="pd-add" @click="addPort">
        {{ t('graph.scriptRun.addPort') }}
      </button>
    </div>
    <div v-for="(port, i) in ports" :key="i" class="pd-row">
      <input
        class="pd-id"
        :value="port.id"
        :placeholder="t('graph.scriptRun.portId')"
        @change="update(i, { id: valueOf($event) })"
      />
      <select class="pd-type" :value="port.dataType" @change="updateDataType(i, $event)">
        <option v-for="dt in dataTypes" :key="dt" :value="dt">{{ dt }}</option>
      </select>
      <button
        type="button"
        class="pd-del"
        :title="t('graph.scriptRun.removePort')"
        :aria-label="t('graph.scriptRun.removePort')"
        @click="remove(i)"
      >
        ×
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  GRAPH_PORT_DATA_TYPES,
  GraphPortType,
  type GraphPortDataType,
  type ScriptPortDecl
} from '@shared/graph'
import { useStudioI18n } from '../composables/useStudioI18n'

const props = defineProps<{ title: string; ports: ScriptPortDecl[] }>()
const emit = defineEmits<{ update: [ports: ScriptPortDecl[]] }>()
const { t } = useStudioI18n()

const dataTypes = GRAPH_PORT_DATA_TYPES

function valueOf(e: Event): string {
  return (e.target as HTMLInputElement | HTMLSelectElement).value
}

function nextId(): string {
  const base = 'p'
  let n = props.ports.length + 1
  const ids = new Set(props.ports.map((p) => p.id))
  while (ids.has(`${base}${n}`)) n += 1
  return `${base}${n}`
}

function addPort(): void {
  emit('update', [...props.ports, { id: nextId(), dataType: GraphPortType.text }])
}
function remove(index: number): void {
  emit(
    'update',
    props.ports.filter((_, i) => i !== index)
  )
}
function updateDataType(index: number, e: Event): void {
  update(index, { dataType: valueOf(e) as GraphPortDataType })
}
function update(index: number, patch: Partial<ScriptPortDecl>): void {
  emit(
    'update',
    props.ports.map((p, i) =>
      i === index
        ? {
            ...p,
            ...patch,
            ...(patch.dataType ? { dataType: patch.dataType as GraphPortDataType } : {})
          }
        : p
    )
  )
}
</script>

<style scoped>
.port-decl {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.pd-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.field-label {
  font-size: 12px;
  color: var(--text-muted);
}
.pd-add {
  padding: 1px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  font-size: 11px;
  cursor: pointer;
}
.pd-add:hover {
  color: var(--text);
}
.pd-row {
  display: flex;
  gap: 6px;
  align-items: center;
}
.pd-id {
  flex: 1 1 auto;
  min-width: 0;
}
.pd-type {
  flex: 0 0 120px;
}
.pd-id,
.pd-type {
  padding: 3px 6px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-input, var(--bg-panel));
  color: var(--text);
  font: inherit;
  font-size: 12px;
}
.pd-del {
  flex: 0 0 24px;
  height: 24px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
}
.pd-del:hover {
  color: var(--text);
}
</style>
