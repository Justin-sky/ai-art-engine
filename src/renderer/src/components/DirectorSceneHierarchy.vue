<template>
  <aside ref="rootEl" class="hierarchy">
    <div class="hierarchy-head">
      <div class="hierarchy-title">{{ t('director.stage.scenePanel') }}</div>
      <div class="create-wrap">
        <button
          type="button"
          class="create-btn"
          :title="t('director.stage.createMenu')"
          :aria-expanded="menuOpen && menuMode === 'dropdown'"
          @click.stop="toggleDropdownMenu"
        >
          <span class="create-plus" aria-hidden="true" />
        </button>
      </div>
    </div>
    <input
      v-model="query"
      class="search"
      type="search"
      :placeholder="t('director.stage.searchPlaceholder')"
    />
    <ul
      class="list"
      @click="onListClick"
      @dragover.prevent="onListDragOver"
      @drop.prevent="onDropRoot"
      @contextmenu="onListContextMenu"
    >
      <li
        v-for="item in filtered"
        :key="item.id"
        class="row"
        :class="{
          active: isSelected(item.id),
          locked: item.locked,
          hidden: !item.visible,
          'drop-target': dropTargetId === item.id,
          renaming: editingId === item.id
        }"
        :style="{ paddingLeft: `${8 + item.depth * 14}px` }"
        :draggable="
          item.kind !== 'camera' &&
          item.kind !== 'panorama' &&
          editingId !== item.id &&
          selectedIds.length <= 1
        "
        @click="onRowClick(item, $event)"
        @dblclick="onRowDblClick(item)"
        @contextmenu="onRowContextMenu(item, $event)"
        @dragstart="onDragStart(item.id, $event)"
        @dragend="onDragEnd"
        @dragover.prevent="onRowDragOver(item.id, $event)"
        @dragleave="onRowDragLeave(item.id)"
        @drop.prevent="onDropRow(item.id, $event)"
      >
        <template v-if="item.kind !== 'panorama'">
          <button
            type="button"
            class="icon-btn"
            :class="{ off: !item.visible }"
            :title="item.visible ? t('director.stage.hideObject') : t('director.stage.showObject')"
            @click.stop="toggleVisible(item)"
            @dblclick.stop
          >
            <span v-html="item.visible ? EYE_ICON : EYE_OFF_ICON" />
          </button>

          <button
            type="button"
            class="icon-btn"
            :class="{ on: item.locked }"
            :title="item.locked ? t('director.stage.unlockObject') : t('director.stage.lockObject')"
            @click.stop="toggleLocked(item)"
            @dblclick.stop
          >
            <span v-html="item.locked ? LOCK_ICON : UNLOCK_ICON" />
          </button>

          <button
            v-if="item.kind !== 'camera'"
            type="button"
            class="icon-btn"
            :class="{ off: !item.nameVisible }"
            :title="
              item.nameVisible
                ? t('director.stage.hideObjectName')
                : t('director.stage.showObjectName')
            "
            @click.stop="toggleNameVisible(item)"
            @dblclick.stop
          >
            <span v-html="item.nameVisible ? NAME_ICON : NAME_OFF_ICON" />
          </button>
        </template>

        <span
          class="kind"
          v-html="
            item.kind === 'camera'
              ? CAMERA_ICON
              : item.kind === 'panorama'
                ? PANORAMA_ICON
                : CUBE_ICON
          "
        />
        <input
          v-if="editingId === item.id"
          v-model="editName"
          class="rename-input"
          type="text"
          @click.stop
          @dblclick.stop
          @keydown.enter.prevent="commitRename"
          @keydown.escape.prevent="cancelRename"
          @blur="commitRename"
        />
        <span v-else class="name">{{ item.name }}</span>
      </li>
      <li v-if="filtered.length === 0" class="empty">{{ t('director.stage.hierarchyEmpty') }}</li>
    </ul>

    <div
      v-if="menuOpen"
      ref="menuEl"
      class="create-menu"
      :class="{ context: menuMode !== 'dropdown', dropdown: menuMode === 'dropdown' }"
      role="menu"
      :style="menuStyle"
    >
      <template v-if="menuMode === 'item'">
        <button
          type="button"
          class="menu-item danger"
          role="menuitem"
          :disabled="!contextCanDelete"
          :title="contextDeleteTitle"
          @click="deleteContextItem"
        >
          {{ t('director.stage.deleteObject') }}
        </button>
      </template>
      <template v-else>
        <button type="button" class="menu-item" role="menuitem" @click="createCamera">
          {{ t('director.stage.createCamera') }}
        </button>
        <button type="button" class="menu-item" role="menuitem" @click="createEmpty">
          {{ t('director.stage.createEmpty') }}
        </button>
        <div class="menu-sep" />
        <button
          v-for="item in primitiveItems"
          :key="item.primitive"
          type="button"
          class="menu-item"
          role="menuitem"
          @click="createPrimitive(item.primitive)"
        >
          {{ t(item.labelKey) }}
        </button>
      </template>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { DIRECTOR_PANORAMA_HIERARCHY_ID, type StagePrimitive } from '@shared/domain'
import { useStudioI18n } from '../composables/useStudioI18n'
import { directorStageSceneKey } from '../features/director/stageSceneKey'
import {
  STUDIO_ASSET_DRAG_MIME,
  STUDIO_ASSET_ID_DRAG_MIME,
  STUDIO_ASSET_IDS_DRAG_MIME,
  useWorkspaceStore
} from '../stores/workspace'

const { t } = useStudioI18n()
const workspace = useWorkspaceStore()
const scene = inject(directorStageSceneKey)!
const query = ref('')
const draggingId = ref<string | null>(null)
const dropTargetId = ref<string | null>(null)
const menuOpen = ref(false)
const menuMode = ref<'dropdown' | 'context' | 'item'>('dropdown')
const menuX = ref(0)
const menuY = ref(0)
const contextItemId = ref<string | null>(null)
const rootEl = ref<HTMLElement | null>(null)
const menuEl = ref<HTMLElement | null>(null)
const editingId = ref<string | null>(null)
const editName = ref('')
/** 层级多选（含相机）；全景主选中仍为其中一项，供 Inspector / Gizmo 使用。 */
const selectedIds = ref<string[]>([])
const anchorId = ref<string | null>(null)
let syncingFromHierarchy = false
let renameCommitted = false
/** 已选中项再单击后，稍候进入重命名（与双击聚焦区分）。 */
const RENAME_CLICK_DELAY_MS = 480
let renameTimer: ReturnType<typeof setTimeout> | null = null

const primitiveItems: { primitive: StagePrimitive; labelKey: string }[] = [
  { primitive: 'box', labelKey: 'director.stage.primitive.cube' },
  { primitive: 'sphere', labelKey: 'director.stage.primitive.sphere' },
  { primitive: 'capsule', labelKey: 'director.stage.primitive.capsule' },
  { primitive: 'cylinder', labelKey: 'director.stage.primitive.cylinder' },
  { primitive: 'plane', labelKey: 'director.stage.primitive.plane' },
  { primitive: 'quad', labelKey: 'director.stage.primitive.quad' }
]

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return scene.hierarchyRows.value
  return scene.hierarchyRows.value.filter((item) => item.name.toLowerCase().includes(q))
})

const menuStyle = computed(() => {
  if (menuMode.value === 'dropdown') return undefined
  return {
    left: `${menuX.value}px`,
    top: `${menuY.value}px`
  }
})

const contextCanDelete = computed(() => {
  const ids = contextDeleteIds()
  return ids.some((id) => scene.canDeleteObject(id))
})

const contextDeleteTitle = computed(() => {
  if (contextCanDelete.value) return ''
  const id = contextItemId.value
  if (!id) return ''
  const row = scene.hierarchyRows.value.find((item) => item.id === id)
  if (row?.kind === 'camera') return t('director.stage.cannotDeleteCamera')
  return ''
})

function scenePrimaryId(): string | null {
  if (scene.selectionKind.value === 'camera') return scene.selectedCameraId.value
  if (scene.selectionKind.value === 'object') return scene.selectedObjectId.value
  if (scene.selectionKind.value === 'panorama') return DIRECTOR_PANORAMA_HIERARCHY_ID
  return null
}

function isSelected(id: string): boolean {
  return selectedIds.value.includes(id)
}

function setSelection(ids: string[], primaryId?: string | null): void {
  const unique = [
    ...new Set(ids.filter((id) => scene.hierarchyRows.value.some((row) => row.id === id)))
  ]
  selectedIds.value = unique
  const primary =
    primaryId && unique.includes(primaryId)
      ? primaryId
      : unique.length > 0
        ? unique[unique.length - 1]
        : null
  syncingFromHierarchy = true
  if (primary) scene.selectHierarchyItem(primary)
  else scene.selectScene()
  void nextTick(() => {
    syncingFromHierarchy = false
  })
}

function onListClick(event: MouseEvent): void {
  if (event.target !== event.currentTarget) return
  setSelection([], null)
}

function pruneSelection(): void {
  const alive = new Set(scene.hierarchyRows.value.map((row) => row.id))
  const next = selectedIds.value.filter((id) => alive.has(id))
  if (next.length === selectedIds.value.length) return
  selectedIds.value = next
  if (anchorId.value && !alive.has(anchorId.value)) {
    anchorId.value = next[0] ?? null
  }
}

watch(
  () => [scene.selectionKind.value, scene.selectedObjectId.value, scene.selectedCameraId.value] as const,
  () => {
    if (syncingFromHierarchy) return
    const id = scenePrimaryId()
    selectedIds.value = id ? [id] : []
    anchorId.value = id
  }
)

watch(
  () => scene.hierarchyRows.value.map((row) => row.id).join('\0'),
  () => pruneSelection()
)

function selectedParentId(): string | null {
  return scene.selectionKind.value === 'object' ? scene.selectedObjectId.value : null
}

function closeMenu(): void {
  menuOpen.value = false
  contextItemId.value = null
}

function toggleDropdownMenu(): void {
  if (menuOpen.value && menuMode.value === 'dropdown') {
    closeMenu()
    return
  }
  menuMode.value = 'dropdown'
  contextItemId.value = null
  menuOpen.value = true
}

function openContextMenu(clientX: number, clientY: number): void {
  const root = rootEl.value
  if (!root) return
  const rect = root.getBoundingClientRect()
  menuX.value = clientX - rect.left
  menuY.value = clientY - rect.top
  menuOpen.value = true
  void nextTick(() => {
    const menu = menuEl.value
    if (!menu || !root) return
    const menuRect = menu.getBoundingClientRect()
    const rootRect = root.getBoundingClientRect()
    if (menuRect.right > rootRect.right) {
      menuX.value = Math.max(4, rootRect.width - menuRect.width - 4)
    }
    if (menuRect.bottom > rootRect.bottom) {
      menuY.value = Math.max(4, rootRect.height - menuRect.height - 4)
    }
  })
}

function onListContextMenu(event: MouseEvent): void {
  const target = event.target as HTMLElement | null
  if (target?.closest('.row')) return
  event.preventDefault()
  menuMode.value = 'context'
  contextItemId.value = null
  openContextMenu(event.clientX, event.clientY)
}

function onRowContextMenu(
  item: { id: string; kind: string; name: string },
  event: MouseEvent
): void {
  event.preventDefault()
  event.stopPropagation()
  clearRenameTimer()
  if (!isSelected(item.id)) {
    anchorId.value = item.id
    setSelection([item.id], item.id)
  } else {
    setSelection(selectedIds.value, item.id)
  }
  menuMode.value = 'item'
  contextItemId.value = item.id
  openContextMenu(event.clientX, event.clientY)
}

function createEmpty(): void {
  closeMenu()
  scene.createEmptyObject(selectedParentId())
}

function createCamera(): void {
  closeMenu()
  scene.createCameraObject()
}

function createPrimitive(primitive: StagePrimitive): void {
  closeMenu()
  scene.createPrimitiveObject(primitive, selectedParentId())
}

function contextDeleteIds(): string[] {
  const contextId = contextItemId.value
  if (contextId && isSelected(contextId) && selectedIds.value.length > 1) {
    return selectedIds.value.slice()
  }
  return contextId ? [contextId] : []
}

function deleteContextItem(): void {
  const ids = contextDeleteIds()
  closeMenu()
  for (const id of ids) {
    if (scene.canDeleteObject(id)) scene.removeObject(id)
  }
  pruneSelection()
}

function deleteSelectedObjects(): void {
  if (editingId.value) return
  const ids = selectedIds.value.slice()
  if (ids.length === 0) {
    const id = scenePrimaryId()
    if (id && scene.canDeleteObject(id)) scene.removeObject(id)
    return
  }
  for (const id of ids) {
    if (scene.canDeleteObject(id)) scene.removeObject(id)
  }
  pruneSelection()
}

function onDocumentPointerDown(event: PointerEvent): void {
  if (!menuOpen.value) return
  const target = event.target as Node | null
  if (menuEl.value?.contains(target)) return
  if (
    menuMode.value === 'dropdown' &&
    (event.target as HTMLElement | null)?.closest('.create-btn')
  ) {
    return
  }
  closeMenu()
}

function onHierarchyKeyDown(event: KeyboardEvent): void {
  const target = event.target as HTMLElement | null
  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target?.isContentEditable
  ) {
    return
  }
  if (editingId.value) return

  const mod = event.ctrlKey || event.metaKey
  if (mod && event.altKey && !event.shiftKey && event.code === 'KeyF') {
    event.preventDefault()
    if (selectedIds.value.length) scene.moveSelectionToView(selectedIds.value)
    return
  }
  if (mod && event.shiftKey && !event.altKey && event.code === 'KeyF') {
    event.preventDefault()
    if (selectedIds.value.length) scene.alignSelectionWithView(selectedIds.value)
    return
  }

  if (event.key !== 'Delete' && event.key !== 'Backspace') return
  const ids =
    selectedIds.value.length > 0
      ? selectedIds.value
      : scenePrimaryId()
        ? [scenePrimaryId()!]
        : []
  if (!ids.some((id) => scene.canDeleteObject(id))) return
  event.preventDefault()
  deleteSelectedObjects()
}

onMounted(() => {
  document.addEventListener('pointerdown', onDocumentPointerDown)
  window.addEventListener('keydown', onHierarchyKeyDown)
  const id = scenePrimaryId()
  selectedIds.value = id ? [id] : []
  anchorId.value = id
})

onBeforeUnmount(() => {
  clearRenameTimer()
  document.removeEventListener('pointerdown', onDocumentPointerDown)
  window.removeEventListener('keydown', onHierarchyKeyDown)
})

function clearRenameTimer(): void {
  if (renameTimer == null) return
  clearTimeout(renameTimer)
  renameTimer = null
}

function rangeSelectIds(fromId: string, toId: string): string[] {
  const rows = filtered.value
  const from = rows.findIndex((row) => row.id === fromId)
  const to = rows.findIndex((row) => row.id === toId)
  if (from < 0 || to < 0) return [toId]
  const start = Math.min(from, to)
  const end = Math.max(from, to)
  return rows.slice(start, end + 1).map((row) => row.id)
}

function onRowClick(
  item: { id: string; kind: string; name: string },
  event: MouseEvent
): void {
  if (editingId.value) return
  clearRenameTimer()
  const additive = event.ctrlKey || event.metaKey
  const ranged = event.shiftKey

  if (ranged) {
    const from = anchorId.value ?? selectedIds.value[0] ?? item.id
    const ids = rangeSelectIds(from, item.id)
    setSelection(ids, item.id)
    return
  }

  if (additive) {
    const set = new Set(selectedIds.value)
    if (set.has(item.id)) {
      set.delete(item.id)
      const next = [...set]
      if (next.length === 0) {
        anchorId.value = null
        setSelection([], null)
      } else {
        if (anchorId.value === item.id) anchorId.value = next[next.length - 1] ?? null
        setSelection(next, next[next.length - 1] ?? null)
      }
    } else {
      set.add(item.id)
      anchorId.value = item.id
      setSelection([...set], item.id)
    }
    return
  }

  const wasOnlySelected =
    selectedIds.value.length === 1 && selectedIds.value[0] === item.id
  anchorId.value = item.id
  setSelection([item.id], item.id)
  if (!wasOnlySelected || item.kind === 'panorama' || item.kind === 'camera') return
  renameTimer = setTimeout(() => {
    renameTimer = null
    if (!isSelected(item.id) || selectedIds.value.length !== 1 || editingId.value) return
    startRename(item)
  }, RENAME_CLICK_DELAY_MS)
}

function onRowDblClick(item: { id: string }): void {
  clearRenameTimer()
  scene.focusHierarchyItem(item.id)
}

function startRename(item: { id: string; kind: string; name: string }): void {
  closeMenu()
  clearRenameTimer()
  editingId.value = item.id
  editName.value = item.name
  renameCommitted = false
  void nextTick(() => {
    const input = rootEl.value?.querySelector('.rename-input') as HTMLInputElement | null
    input?.focus()
    input?.select()
  })
}

function cancelRename(): void {
  renameCommitted = true
  editingId.value = null
  editName.value = ''
}

function commitRename(): void {
  if (renameCommitted) return
  renameCommitted = true
  const id = editingId.value
  const nextName = editName.value.trim()
  editingId.value = null
  editName.value = ''
  if (!id || !nextName) return
  const current = scene.hierarchyRows.value.find((row) => row.id === id)
  if (!current || current.name === nextName) return
  scene.updateObjectTransform(id, { name: nextName })
}

/** 点中已选中项时，左侧工具作用于全部选中；否则只作用于该项。 */
function toolTargetIds(itemId: string): string[] {
  if (isSelected(itemId) && selectedIds.value.length > 1) return selectedIds.value.slice()
  return [itemId]
}

function toggleVisible(item: { id: string; visible: boolean }): void {
  const next = !item.visible
  for (const id of toolTargetIds(item.id)) {
    scene.setObjectVisible(id, next)
  }
}

function toggleLocked(item: { id: string; locked: boolean }): void {
  const next = !item.locked
  for (const id of toolTargetIds(item.id)) {
    scene.setObjectLocked(id, next)
  }
}

function toggleNameVisible(item: { id: string; nameVisible: boolean }): void {
  const next = !item.nameVisible
  for (const id of toolTargetIds(item.id)) {
    scene.setObjectNameVisible(id, next)
  }
}

function isStudioAssetDrag(event: DragEvent): boolean {
  if (workspace.draggingAsset) return true
  const types = event.dataTransfer ? Array.from(event.dataTransfer.types) : []
  return (
    types.includes(STUDIO_ASSET_DRAG_MIME) ||
    types.includes(STUDIO_ASSET_ID_DRAG_MIME) ||
    types.includes(STUDIO_ASSET_IDS_DRAG_MIME)
  )
}

function onDragStart(id: string, event: DragEvent): void {
  clearRenameTimer()
  draggingId.value = id
  event.dataTransfer?.setData('text/plain', id)
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
}

function onDragEnd(): void {
  draggingId.value = null
  dropTargetId.value = null
}

function onRowDragOver(id: string, event: DragEvent): void {
  if (isStudioAssetDrag(event)) {
    if (scene.hierarchyRows.value.some((item) => item.id === id && item.kind === 'camera')) {
      dropTargetId.value = null
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
      return
    }
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
    dropTargetId.value = id
    return
  }
  if (!draggingId.value || draggingId.value === id) return
  if (scene.hierarchyRows.value.some((item) => item.id === id && item.kind === 'camera')) {
    dropTargetId.value = null
    return
  }
  event.dataTransfer && (event.dataTransfer.dropEffect = 'move')
  dropTargetId.value = id
}

function onRowDragLeave(id: string): void {
  if (dropTargetId.value === id) dropTargetId.value = null
}

function onListDragOver(event: DragEvent): void {
  if (isStudioAssetDrag(event)) {
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
    return
  }
  if (!draggingId.value) return
  event.dataTransfer && (event.dataTransfer.dropEffect = 'move')
}

async function onDropRow(targetId: string, event: DragEvent): Promise<void> {
  if (isStudioAssetDrag(event)) {
    dropTargetId.value = null
    const asset = workspace.resolveDraggedAsset(event)
    if (!asset || asset.type !== 'model') return
    const row = scene.hierarchyRows.value.find((item) => item.id === targetId)
    const parentId =
      !row || row.kind === 'camera' || row.kind === 'panorama' ? null : targetId
    await scene.createModelObject(asset.id, parentId)
    return
  }
  const childId = draggingId.value
  dropTargetId.value = null
  draggingId.value = null
  if (!childId || childId === targetId) return
  if (scene.hierarchyRows.value.some((item) => item.id === targetId && item.kind === 'camera')) {
    scene.reparentObject(childId, null)
    return
  }
  scene.reparentObject(childId, targetId)
}

async function onDropRoot(event: DragEvent): Promise<void> {
  if (isStudioAssetDrag(event)) {
    dropTargetId.value = null
    const asset = workspace.resolveDraggedAsset(event)
    if (!asset || asset.type !== 'model') return
    await scene.createModelObject(asset.id, null)
    return
  }
  const childId = draggingId.value
  dropTargetId.value = null
  draggingId.value = null
  if (!childId) return
  scene.reparentObject(childId, null)
}

const CUBE_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.8 20.5 7v10L12 21.2 3.5 17V7L12 2.8Z"/><path d="M3.7 7.2 12 11.8l8.3-4.6"/><path d="M12 11.8v9.2"/></svg>`
const CAMERA_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3Z"/><circle cx="12" cy="13" r="3.5"/></svg>`
const PANORAMA_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18"/><path d="M12 3a14 14 0 0 0 0 18"/></svg>`
const EYE_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>`
const EYE_OFF_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l18 18"/><path d="M10.6 10.6a2.8 2.8 0 0 0 3.9 3.9"/><path d="M9.9 5.1A10.5 10.5 0 0 1 12 5c6.5 0 10 7 10 7a17.4 17.4 0 0 1-3.1 4.1"/><path d="M6.1 6.1C3.9 7.7 2 12 2 12s3.5 7 10 7c1.4 0 2.7-.3 3.9-.8"/></svg>`
const LOCK_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>`
const UNLOCK_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 7.5-2"/></svg>`
const NAME_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7V5h16v2"/><path d="M9 19h6"/><path d="M12 5v14"/></svg>`
const NAME_OFF_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7V5h16v2"/><path d="M9 19h6"/><path d="M12 5v14"/><path d="M3 3l18 18"/></svg>`
</script>

<style scoped>
.hierarchy {
  position: relative;
  display: flex;
  flex-direction: column;
  width: 300px;
  min-width: 240px;
  border-right: 1px solid var(--border);
  background: var(--bg-panel);
  flex-shrink: 0;
  min-height: 0;
  overflow: hidden;
}

.hierarchy-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 10px 6px 12px;
  flex-shrink: 0;
}

.hierarchy-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
}

.create-wrap {
  position: relative;
  flex-shrink: 0;
}

.create-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border-radius: 4px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
}

.create-plus {
  position: relative;
  width: 10px;
  height: 10px;
}

.create-plus::before,
.create-plus::after {
  content: '';
  position: absolute;
  left: 50%;
  top: 50%;
  background: currentColor;
  border-radius: 1px;
  transform: translate(-50%, -50%);
}

.create-plus::before {
  width: 10px;
  height: 1.5px;
}

.create-plus::after {
  width: 1.5px;
  height: 10px;
}

.create-btn:hover,
.create-btn[aria-expanded='true'] {
  color: var(--text);
  background: var(--wash-06);
}

.create-menu {
  z-index: 30;
  min-width: 140px;
  padding: 4px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
}

.create-menu.dropdown {
  position: absolute;
  top: 36px;
  right: 10px;
}

.create-menu.context {
  position: absolute;
}

.menu-item {
  display: block;
  width: 100%;
  padding: 6px 10px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--text);
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}

.menu-item:hover {
  background: rgba(91, 156, 245, 0.2);
}

.menu-item.danger {
  color: #f07178;
}

.menu-item.danger:hover:not(:disabled) {
  background: rgba(240, 113, 120, 0.18);
}

.menu-item:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.menu-sep {
  height: 1px;
  margin: 4px 6px;
  background: var(--border);
}

.search {
  margin: 0 10px 8px;
  padding: 6px 8px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--bg-input);
  color: var(--text);
  font-size: 12px;
  flex-shrink: 0;
}

.list {
  list-style: none;
  margin: 0;
  padding: 0 4px 10px;
  overflow: auto;
  flex: 1;
  min-height: 0;
  user-select: none;
}

.row {
  display: flex;
  align-items: center;
  gap: 4px;
  padding-top: 4px;
  padding-bottom: 4px;
  padding-right: 8px;
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
  color: var(--text);
  border: 1px solid transparent;
}

.row:hover {
  background: var(--wash-05);
}

.row.active {
  background: rgba(91, 156, 245, 0.22);
}

.row.drop-target {
  border-color: var(--accent, #5b8def);
  background: rgba(91, 156, 245, 0.12);
}

.row.hidden .name,
.row.hidden .kind {
  opacity: 0.45;
}

.row.locked .name {
  color: color-mix(in srgb, var(--text) 75%, #f0c674);
}

.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  padding: 0;
  border: none;
  border-radius: 3px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  flex-shrink: 0;
  opacity: 0.55;
}

.row:hover .icon-btn,
.row.active .icon-btn,
.icon-btn.on,
.icon-btn.off {
  opacity: 1;
}

.icon-btn:hover {
  background: var(--wash-08);
  color: var(--text);
}

.icon-btn.on {
  color: var(--warning);
}

.icon-btn.off {
  color: var(--text-muted);
}

.icon-btn :deep(svg),
.kind :deep(svg) {
  width: 14px;
  height: 14px;
  display: block;
}

.kind {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  color: var(--text-muted);
}

.row.active .kind {
  color: #7fb0f5;
}

.name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.rename-input {
  flex: 1;
  min-width: 0;
  height: 20px;
  margin: 0;
  padding: 0 4px;
  border-radius: 3px;
  border: 1px solid var(--accent, #5b8def);
  background: var(--bg-input);
  color: var(--text);
  font-size: 12px;
  outline: none;
}

.row.renaming {
  cursor: default;
}

.empty {
  color: var(--text-muted);
  cursor: default !important;
  padding: 8px;
  font-size: 12px;
}
</style>
