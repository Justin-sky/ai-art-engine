<template>
  <aside ref="rootEl" class="hierarchy" :style="{ width: `${paneWidth}px` }">
    <div class="hierarchy-head">
      <div class="hierarchy-title">
        {{ t('director.stage.scenePanel') }}
      </div>
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
          item.kind !== 'panorama' && item.kind !== 'cameraGroup' && editingId !== item.id
        "
        @click="onRowClick(item, $event)"
        @dblclick="onRowDblClick(item)"
        @contextmenu="onRowContextMenu(item, $event)"
        @dragstart="onDragStart(item.id, $event)"
        @dragend="onDragEnd"
        @dragover.prevent="onRowDragOver(item.id, $event)"
        @dragleave="onRowDragLeave(item.id)"
        @drop.prevent.stop="onDropRow(item.id, $event)"
      >
        <button
          v-if="item.hasChildren"
          type="button"
          class="tree-chevron"
          :class="{ collapsed: !isExpanded(item.id) }"
          :title="isExpanded(item.id) ? t('director.stage.collapse') : t('director.stage.expand')"
          :aria-expanded="isExpanded(item.id)"
          @click.stop="toggleExpanded(item.id)"
          @dblclick.stop
        >
          <span class="chevron-icon" v-html="CHEVRON_ICON" />
        </button>
        <template v-if="item.kind !== 'panorama' && item.kind !== 'cameraGroup'">
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
              : item.kind === 'cameraGroup'
                ? GROUP_ICON
                : item.kind === 'panorama'
                  ? PANORAMA_ICON
                  : item.kind === 'light'
                    ? LIGHT_ICON
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
      <li v-if="filtered.length === 0" class="empty">
        {{ t('director.stage.hierarchyEmpty') }}
      </li>
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
        <button type="button" class="menu-item" role="menuitem" @click="copyContextItems">
          <span class="menu-item-icon" aria-hidden="true" v-html="COPY_ICON" />
          <span class="menu-item-label">{{ t('director.stage.copy') }}</span>
        </button>
        <button
          type="button"
          class="menu-item"
          role="menuitem"
          :disabled="!scene.canPasteStageClipboard()"
          @click="pasteContextItems"
        >
          <span class="menu-item-icon" aria-hidden="true" v-html="PASTE_ICON" />
          <span class="menu-item-label">{{ t('director.stage.paste') }}</span>
        </button>
        <div class="menu-sep" />
        <button
          type="button"
          class="menu-item danger"
          role="menuitem"
          :disabled="!contextCanDelete"
          :title="contextDeleteTitle"
          @click="deleteContextItem"
        >
          <span class="menu-item-icon" aria-hidden="true" v-html="DELETE_ICON" />
          <span class="menu-item-label">{{ t('director.stage.deleteObject') }}</span>
        </button>
      </template>
      <template v-else>
        <button
          type="button"
          class="menu-item"
          role="menuitem"
          :disabled="!scene.canPasteStageClipboard()"
          @click="pasteContextItems"
        >
          <span class="menu-item-icon" aria-hidden="true" v-html="PASTE_ICON" />
          <span class="menu-item-label">{{ t('director.stage.paste') }}</span>
        </button>
        <div class="menu-sep" />
        <button type="button" class="menu-item" role="menuitem" @click="createCamera">
          <span class="menu-item-icon" aria-hidden="true" v-html="CAMERA_ICON" />
          <span class="menu-item-label">{{ t('director.stage.createCamera') }}</span>
        </button>
        <button type="button" class="menu-item" role="menuitem" @click="createEmpty">
          <span class="menu-item-icon" aria-hidden="true" v-html="EMPTY_OBJECT_ICON" />
          <span class="menu-item-label">{{ t('director.stage.createEmpty') }}</span>
        </button>
        <div class="menu-sep" />
        <button
          v-for="item in mannequinItems"
          :key="item.preset"
          type="button"
          class="menu-item"
          role="menuitem"
          @click="createMannequin(item.preset)"
        >
          <span class="menu-item-icon" aria-hidden="true" v-html="item.icon" />
          <span class="menu-item-label">{{ t(item.labelKey) }}</span>
        </button>
        <div class="menu-sep" />
        <button
          v-for="item in lightItems"
          :key="item.type"
          type="button"
          class="menu-item"
          role="menuitem"
          @click="createLight(item.type)"
        >
          <span class="menu-item-icon" aria-hidden="true" v-html="item.icon" />
          <span class="menu-item-label">{{ t(item.labelKey) }}</span>
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
          <span class="menu-item-icon" aria-hidden="true" v-html="item.icon" />
          <span class="menu-item-label">{{ t(item.labelKey) }}</span>
        </button>
      </template>
    </div>
    <div
      class="hierarchy-splitter"
      :class="{ dragging: splitterDragging }"
      :title="t('director.stage.resizePanel')"
      @mousedown.prevent="onSplitterDown"
    />
  </aside>
</template>

<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  DIRECTOR_PANORAMA_HIERARCHY_ID,
  type StageLightType,
  type StageMannequinPreset,
  type StagePrimitive
} from '@shared/domain'
import { useStudioI18n } from '../composables/useStudioI18n'
import { directorStageSceneKey } from '../features/director/stageSceneKey'

/** 相机行拖入动画机位轨时使用的 MIME（与 DirectorAnimationPanel 一致） */
const DIRECTOR_CAMERA_DRAG_MIME = 'application/x-director-camera-id'

import {
  STUDIO_ASSET_DRAG_MIME,
  STUDIO_ASSET_ID_DRAG_MIME,
  STUDIO_ASSET_IDS_DRAG_MIME,
  useWorkspaceStore
} from '../stores/workspace'

const { t } = useStudioI18n()
const workspace = useWorkspaceStore()
const scene = inject(directorStageSceneKey)!

const PANE_WIDTH_KEY = 'studio.director.hierarchyWidth'
const DEFAULT_PANE_WIDTH = 300
const PANE_MIN_WIDTH = 200
const PANE_MAX_RATIO = 0.55

function clampPaneWidth(n: number, maxWidth = Infinity): number {
  if (!Number.isFinite(n)) return DEFAULT_PANE_WIDTH
  return Math.round(Math.min(maxWidth, Math.max(PANE_MIN_WIDTH, n)))
}

function readPaneMaxWidth(): number {
  const total = rootEl.value?.parentElement?.clientWidth ?? 0
  if (total <= 0) return 560
  return Math.max(PANE_MIN_WIDTH + 120, Math.round(total * PANE_MAX_RATIO))
}

const query = ref('')
const draggingId = ref<string | null>(null)
const draggingIds = ref<string[]>([])
const dropTargetId = ref<string | null>(null)
const menuOpen = ref(false)
const menuMode = ref<'dropdown' | 'context' | 'item'>('dropdown')
const menuX = ref(0)
const menuY = ref(0)
const contextItemId = ref<string | null>(null)
const rootEl = ref<HTMLElement | null>(null)
const paneWidth = ref(
  clampPaneWidth(Number(localStorage.getItem(PANE_WIDTH_KEY) || DEFAULT_PANE_WIDTH))
)
const splitterDragging = ref(false)
let splitterMove: ((ev: MouseEvent) => void) | null = null
let splitterUp: (() => void) | null = null

function persistPaneWidth(): void {
  localStorage.setItem(PANE_WIDTH_KEY, String(paneWidth.value))
}

function endSplitterDrag(): void {
  if (splitterMove) window.removeEventListener('mousemove', splitterMove)
  if (splitterUp) window.removeEventListener('mouseup', splitterUp)
  splitterMove = null
  splitterUp = null
  if (splitterDragging.value) {
    splitterDragging.value = false
    persistPaneWidth()
  }
}

function onSplitterDown(e: MouseEvent): void {
  if (e.button !== 0) return
  endSplitterDrag()
  splitterDragging.value = true
  const startX = e.clientX
  const startWidth = paneWidth.value
  splitterMove = (ev: MouseEvent) => {
    paneWidth.value = clampPaneWidth(startWidth + (ev.clientX - startX), readPaneMaxWidth())
  }
  splitterUp = () => endSplitterDrag()
  window.addEventListener('mousemove', splitterMove)
  window.addEventListener('mouseup', splitterUp)
}
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

const COPY_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`
const PASTE_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/></svg>`
const DELETE_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>`
const EMPTY_OBJECT_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="2.2"/><path d="M12 3v6.8M12 14.2V21M3 12h6.8M14.2 12H21"/><path d="M6.2 6.2l4.2 4.2M13.6 13.6l4.2 4.2"/></svg>`

const MANNEQUIN_HUMANOID_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="4.5" r="2.3"/><path d="M6.5 9.2h11"/><path d="M12 6.8v7.4"/><path d="M9.5 21l2.5-6.8 2.5 6.8"/></svg>`
const MANNEQUIN_CHIBI_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="7.2" r="4.2"/><path d="M7.5 14h9"/><path d="M12 11.4v5.1"/><path d="M9.6 20.8l2.4-4.3 2.4 4.3"/></svg>`
const MANNEQUIN_QUADRUPED_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M16.5 9.5 19 7l2 1.5-1.2 3.2-3.3.3Z"/><path d="M6.5 11.5h10v3.2H6.5a2 2 0 0 1-2-2v-1.2Z"/><path d="M6.5 11.5 3.5 9.5"/><path d="M7.5 14.7v4.8M10.2 14.7v4.8M14.2 14.7v4.8M16.5 14.7v4.8"/></svg>`

const LIGHT_DIRECTIONAL_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="3.2"/><path d="M13 13l7 7M16.5 10.5l4.5 4.5M10.5 16.5l4.5 4.5"/><path d="M17 20h3v-3"/></svg>`
const LIGHT_POINT_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3.5"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.2 5.2l1.6 1.6M17.2 17.2l1.6 1.6M5.2 18.8l1.6-1.6M17.2 6.8l1.6-1.6"/></svg>`
const LIGHT_SPOT_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 3.5h5l1.5 3.5h-8l1.5-3.5Z"/><path d="M8 7l-4.5 12h17L16 7"/><ellipse cx="12" cy="19" rx="8.5" ry="2"/></svg>`

const PRIM_BOX_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.8 20.5 7v10L12 21.2 3.5 17V7L12 2.8Z"/><path d="M3.7 7.2 12 11.8l8.3-4.6"/><path d="M12 11.8v9.2"/></svg>`
const PRIM_SPHERE_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><ellipse cx="12" cy="12" rx="8.5" ry="3.2"/><ellipse cx="12" cy="12" rx="3.2" ry="8.5"/></svg>`
const PRIM_CAPSULE_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="6.5" y="2.8" width="11" height="18.4" rx="5.5"/><path d="M6.5 12c0 1.4 2.5 2.5 5.5 2.5s5.5-1.1 5.5-2.5"/></svg>`
const PRIM_CYLINDER_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="6" rx="7" ry="2.8"/><path d="M5 6v12c0 1.55 3.13 2.8 7 2.8s7-1.25 7-2.8V6"/></svg>`
const PRIM_CONE_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.2 4.5 18"/><path d="M12 3.2 19.5 18"/><ellipse cx="12" cy="18" rx="7.5" ry="2.6"/></svg>`
const PRIM_PYRAMID_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.2 3.2 16.8 12 20.8l8.8-4L12 3.2Z"/><path d="M12 3.2v17.6"/></svg>`
const PRIM_HEMISPHERE_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 15.5a8.5 8.5 0 0 1 17 0"/><ellipse cx="12" cy="15.5" rx="8.5" ry="2.8"/></svg>`
const PRIM_TORUS_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="12" rx="9" ry="5.5"/><ellipse cx="12" cy="11.5" rx="3.8" ry="1.8"/></svg>`
const PRIM_ARCH_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V11a8 8 0 0 1 16 0v9h-4.5v-8a3.5 3.5 0 0 0-7 0v8H4Z"/></svg>`
const PRIM_POINTED_ARCH_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20v-8c0-4.2 3.5-7.6 8-9.2 4.5 1.6 8 5 8 9.2v8h-4.5v-7.2c0-2.1-1.5-4-3.5-5-2 1-3.5 2.9-3.5 5V20H4Z"/></svg>`
const PRIM_CROSS_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 3.5h5v6h6v5h-6v6h-5v-6h-6v-5h6v-6Z"/></svg>`
const PRIM_TUBE_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="6.2" rx="7.2" ry="2.8"/><ellipse cx="12" cy="6.2" rx="3.2" ry="1.2"/><path d="M4.8 6.2v11.6c0 1.55 3.22 2.8 7.2 2.8s7.2-1.25 7.2-2.8V6.2"/></svg>`
const PRIM_PRISM_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="12,2.8 19,5.8 19,18.2 12,21.2 5,18.2 5,5.8"/><path d="M5 5.8 12 8.8l7-3"/><path d="M12 8.8v12.4"/></svg>`
const PRIM_TETRAHEDRON_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="12,3 3.5,18.5 20.5,18.5"/><path d="M12 3v10.5M12 13.5 3.5 18.5M12 13.5l8.5 5"/></svg>`
const PRIM_OCTAHEDRON_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="12,2.5 20.5,12 12,21.5 3.5,12"/><path d="M3.5 12 12 14.5 20.5 12"/><path d="M12 2.5v19"/></svg>`
const PRIM_ICOSPHERE_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><polygon points="12,2.5 19.8,7 19.8,17 12,21.5 4.2,17 4.2,7"/><polygon points="12,6.5 16.8,14.8 7.2,14.8"/><path d="M12 2.5v4M19.8 7l-3 7.8M4.2 7l3 7.8M12 21.5l-4.8-6.7M12 21.5l4.8-6.7"/></svg>`
const PRIM_WEDGE_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 17.5 14.5 5.5l6 3v9l-11 3-6-3Z"/><path d="M14.5 5.5v9l-11 3"/><path d="M14.5 14.5l6 3"/></svg>`
const PRIM_DISC_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="12" rx="8.8" ry="5.2"/><circle cx="12" cy="12" r="1.2"/><path d="M12 12l6.2-3.6"/></svg>`
const PRIM_RING_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.2"/></svg>`
const PRIM_PLANE_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="12,5 21,11.5 12,18 3,11.5"/><path d="M7.5 8.25 16.5 14.75M16.5 8.25 7.5 14.75"/></svg>`
const PRIM_QUAD_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="4.5" y="4.5" width="15" height="15" rx="1.5"/><path d="M4.5 19.5 19.5 4.5"/></svg>`

const mannequinItems: { preset: StageMannequinPreset; labelKey: string; icon: string }[] = [
  {
    preset: 'humanoid',
    labelKey: 'director.stage.mannequin.humanoid',
    icon: MANNEQUIN_HUMANOID_ICON
  },
  { preset: 'chibi', labelKey: 'director.stage.mannequin.chibi', icon: MANNEQUIN_CHIBI_ICON },
  {
    preset: 'quadruped',
    labelKey: 'director.stage.mannequin.quadruped',
    icon: MANNEQUIN_QUADRUPED_ICON
  }
]

const lightItems: { type: StageLightType; labelKey: string; icon: string }[] = [
  {
    type: 'directional',
    labelKey: 'director.stage.light.directional',
    icon: LIGHT_DIRECTIONAL_ICON
  },
  { type: 'point', labelKey: 'director.stage.light.point', icon: LIGHT_POINT_ICON },
  { type: 'spot', labelKey: 'director.stage.light.spot', icon: LIGHT_SPOT_ICON }
]

const primitiveItems: { primitive: StagePrimitive; labelKey: string; icon: string }[] = [
  { primitive: 'box', labelKey: 'director.stage.primitive.cube', icon: PRIM_BOX_ICON },
  { primitive: 'sphere', labelKey: 'director.stage.primitive.sphere', icon: PRIM_SPHERE_ICON },
  { primitive: 'capsule', labelKey: 'director.stage.primitive.capsule', icon: PRIM_CAPSULE_ICON },
  {
    primitive: 'cylinder',
    labelKey: 'director.stage.primitive.cylinder',
    icon: PRIM_CYLINDER_ICON
  },
  { primitive: 'cone', labelKey: 'director.stage.primitive.cone', icon: PRIM_CONE_ICON },
  { primitive: 'pyramid', labelKey: 'director.stage.primitive.pyramid', icon: PRIM_PYRAMID_ICON },
  {
    primitive: 'hemisphere',
    labelKey: 'director.stage.primitive.hemisphere',
    icon: PRIM_HEMISPHERE_ICON
  },
  { primitive: 'torus', labelKey: 'director.stage.primitive.torus', icon: PRIM_TORUS_ICON },
  { primitive: 'arch', labelKey: 'director.stage.primitive.arch', icon: PRIM_ARCH_ICON },
  {
    primitive: 'pointedArch',
    labelKey: 'director.stage.primitive.pointedArch',
    icon: PRIM_POINTED_ARCH_ICON
  },
  { primitive: 'cross', labelKey: 'director.stage.primitive.cross', icon: PRIM_CROSS_ICON },
  { primitive: 'tube', labelKey: 'director.stage.primitive.tube', icon: PRIM_TUBE_ICON },
  { primitive: 'prism', labelKey: 'director.stage.primitive.prism', icon: PRIM_PRISM_ICON },
  {
    primitive: 'tetrahedron',
    labelKey: 'director.stage.primitive.tetrahedron',
    icon: PRIM_TETRAHEDRON_ICON
  },
  {
    primitive: 'octahedron',
    labelKey: 'director.stage.primitive.octahedron',
    icon: PRIM_OCTAHEDRON_ICON
  },
  {
    primitive: 'icosphere',
    labelKey: 'director.stage.primitive.icosphere',
    icon: PRIM_ICOSPHERE_ICON
  },
  { primitive: 'wedge', labelKey: 'director.stage.primitive.wedge', icon: PRIM_WEDGE_ICON },
  { primitive: 'disc', labelKey: 'director.stage.primitive.disc', icon: PRIM_DISC_ICON },
  { primitive: 'ring', labelKey: 'director.stage.primitive.ring', icon: PRIM_RING_ICON },
  { primitive: 'plane', labelKey: 'director.stage.primitive.plane', icon: PRIM_PLANE_ICON },
  { primitive: 'quad', labelKey: 'director.stage.primitive.quad', icon: PRIM_QUAD_ICON }
]

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  const rows = scene.hierarchyRows.value
  if (q) return rows.filter((item) => item.name.toLowerCase().includes(q))
  // 折叠：隐藏已折叠节点的全部子孙
  const hidden = new Set<string>()
  const visible: typeof rows = []
  for (const row of rows) {
    if (row.parentId != null && hidden.has(row.parentId)) {
      hidden.add(row.id)
      continue
    }
    visible.push(row)
    if (row.hasChildren && !expandedIds.value.has(row.id)) {
      hidden.add(row.id)
    }
  }
  return visible
})

const expandedIds = ref<Set<string>>(new Set())

function isExpanded(id: string): boolean {
  return expandedIds.value.has(id)
}

function toggleExpanded(id: string): void {
  const next = new Set(expandedIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expandedIds.value = next
}

watch(
  () => scene.hierarchyRows.value.map((r) => r.id).join('\0'),
  () => {
    const next = new Set(expandedIds.value)
    const alive = new Set(scene.hierarchyRows.value.map((r) => r.id))
    for (const id of [...next]) {
      if (!alive.has(id)) next.delete(id)
    }
    // 新出现的可折叠节点默认展开
    for (const row of scene.hierarchyRows.value) {
      if (row.hasChildren && !next.has(row.id)) next.add(row.id)
    }
    expandedIds.value = next
  },
  { immediate: true }
)

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
  scene.setCameraPreviewSelection(unique)
  scene.setMultiSelection(unique)
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
  () =>
    [
      scene.selectionKind.value,
      scene.selectedObjectId.value,
      scene.selectedCameraId.value
    ] as const,
  () => {
    if (syncingFromHierarchy) return
    const id = scenePrimaryId()
    selectedIds.value = id ? [id] : []
    anchorId.value = id
    scene.setCameraPreviewSelection(selectedIds.value)
    scene.setMultiSelection(selectedIds.value)
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

function createMannequin(preset: StageMannequinPreset): void {
  closeMenu()
  scene.createMannequinObject(preset, selectedParentId())
}

function createPrimitive(primitive: StagePrimitive): void {
  closeMenu()
  scene.createPrimitiveObject(primitive, selectedParentId())
}

function createLight(type: StageLightType): void {
  closeMenu()
  scene.createLightObject(type, selectedParentId())
}

function contextDeleteIds(): string[] {
  const contextId = contextItemId.value
  if (contextId && isSelected(contextId) && selectedIds.value.length > 1) {
    return selectedIds.value.slice()
  }
  return contextId ? [contextId] : []
}

function copyContextItems(): void {
  // 先取值再关菜单：closeMenu 会清空 contextItemId
  const ids = contextDeleteIds()
  const fallback = selectedIds.value.length ? selectedIds.value.slice() : undefined
  closeMenu()
  scene.copyStageSelection(ids.length ? ids : fallback)
}

function pasteContextItems(): void {
  const blank = menuMode.value === 'context'
  closeMenu()
  void scene.pasteStageClipboard({ blank })
}

function deleteContextItem(): void {
  const ids = contextDeleteIds()
  closeMenu()
  scene.removeObjectsWithUndo(ids)
  pruneSelection()
}

function deleteSelectedObjects(): void {
  if (editingId.value) return
  const ids = selectedIds.value.slice()
  if (ids.length === 0) {
    const id = scenePrimaryId()
    if (id) scene.removeObjectsWithUndo([id])
    return
  }
  scene.removeObjectsWithUndo(ids)
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
    selectedIds.value.length > 0 ? selectedIds.value : scenePrimaryId() ? [scenePrimaryId()!] : []
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
  endSplitterDrag()
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

function onRowClick(item: { id: string; kind: string; name: string }, event: MouseEvent): void {
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

  const wasOnlySelected = selectedIds.value.length === 1 && selectedIds.value[0] === item.id
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

function descendantIds(rootId: string): string[] {
  const childrenOf = new Map<string, string[]>()
  for (const row of scene.hierarchyRows.value) {
    if (!row.parentId) continue
    const list = childrenOf.get(row.parentId) ?? []
    list.push(row.id)
    childrenOf.set(row.parentId, list)
  }
  const out: string[] = []
  const walk = (id: string): void => {
    for (const child of childrenOf.get(id) ?? []) {
      out.push(child)
      walk(child)
    }
  }
  walk(rootId)
  return out
}

/** 父节点上的显隐 / 文本 / 锁定，连同全部子孙一起改。 */
function flagTargetIds(itemId: string): string[] {
  const kindById = new Map(scene.hierarchyRows.value.map((row) => [row.id, row.kind]))
  const seen = new Set<string>()
  const out: string[] = []
  const push = (id: string): void => {
    if (seen.has(id)) return
    const kind = kindById.get(id)
    if (kind === 'panorama' || kind === 'cameraGroup') return
    seen.add(id)
    out.push(id)
  }
  for (const id of toolTargetIds(itemId)) {
    push(id)
    for (const child of descendantIds(id)) push(child)
  }
  return out
}

function toggleVisible(item: { id: string; visible: boolean }): void {
  const next = !item.visible
  for (const id of flagTargetIds(item.id)) {
    scene.setObjectVisible(id, next)
  }
}

function toggleLocked(item: { id: string; locked: boolean }): void {
  const next = !item.locked
  for (const id of flagTargetIds(item.id)) {
    scene.setObjectLocked(id, next)
  }
}

function toggleNameVisible(item: { id: string; nameVisible: boolean }): void {
  const next = !item.nameVisible
  for (const id of flagTargetIds(item.id)) {
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
  // 拖拽已选中的项且存在多选 → 整组一起移动；否则只移动当前项
  draggingIds.value =
    isSelected(id) && selectedIds.value.length > 1 ? selectedIds.value.slice() : [id]
  // 兜底：跨组件 drop 时 dataTransfer 可能读不到，临时记到 window（drop 端校验是否相机）
  ;(window as unknown as { __directorCameraDragId?: string }).__directorCameraDragId = id
  const row = scene.hierarchyRows.value.find((r) => r.id === id)
  if (row?.kind === 'camera') {
    event.dataTransfer?.setData(DIRECTOR_CAMERA_DRAG_MIME, id)
    // 机位轨使用 copy 效果；effectAllowed 必须兼容 copy，否则 drop 不会触发
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copyMove'
  } else {
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
  }
  event.dataTransfer?.setData('text/plain', id)
}

function onDragEnd(): void {
  draggingId.value = null
  draggingIds.value = []
  dropTargetId.value = null
  delete (window as unknown as { __directorCameraDragId?: string }).__directorCameraDragId
}

/** 本次拖拽中可重挂父级的物体 id（排除相机/机位组/全景，以及祖先也在拖拽集合中的子级） */
function reparentableDragIds(): string[] {
  const rows = scene.hierarchyRows.value
  const rowById = new Map(rows.map((row) => [row.id, row]))
  const candidates = draggingIds.value.filter((id) => {
    const row = rowById.get(id)
    return !!row && row.kind !== 'camera' && row.kind !== 'cameraGroup' && row.kind !== 'panorama'
  })
  const candidateSet = new Set(candidates)
  return candidates.filter((id) => {
    let parentId = rowById.get(id)?.parentId ?? null
    while (parentId) {
      if (candidateSet.has(parentId)) return false
      parentId = rowById.get(parentId)?.parentId ?? null
    }
    return true
  })
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
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
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
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
}

async function onDropRow(targetId: string, event: DragEvent): Promise<void> {
  if (isStudioAssetDrag(event)) {
    dropTargetId.value = null
    const asset = workspace.resolveDraggedAsset(event)
    if (!asset || asset.type !== 'model') return
    const row = scene.hierarchyRows.value.find((item) => item.id === targetId)
    const parentId = !row || row.kind === 'camera' || row.kind === 'panorama' ? null : targetId
    await scene.createModelObject(asset.id, parentId)
    return
  }
  const dropIds = reparentableDragIds().filter((id) => id !== targetId)
  dropTargetId.value = null
  draggingId.value = null
  draggingIds.value = []
  if (!dropIds.length) return
  if (scene.hierarchyRows.value.some((item) => item.id === targetId && item.kind === 'camera')) {
    for (const childId of dropIds) scene.reparentObject(childId, null)
    return
  }
  for (const childId of dropIds) scene.reparentObject(childId, targetId)
}

async function onDropRoot(event: DragEvent): Promise<void> {
  if (isStudioAssetDrag(event)) {
    dropTargetId.value = null
    const asset = workspace.resolveDraggedAsset(event)
    if (!asset || asset.type !== 'model') return
    await scene.createModelObject(asset.id, null)
    return
  }
  const dropIds = reparentableDragIds()
  dropTargetId.value = null
  draggingId.value = null
  draggingIds.value = []
  if (!dropIds.length) return
  for (const childId of dropIds) scene.reparentObject(childId, null)
}

const CUBE_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.8 20.5 7v10L12 21.2 3.5 17V7L12 2.8Z"/><path d="M3.7 7.2 12 11.8l8.3-4.6"/><path d="M12 11.8v9.2"/></svg>`
const LIGHT_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3.5"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.2 5.2l1.6 1.6M17.2 17.2l1.6 1.6M5.2 18.8l1.6-1.6M17.2 6.8l1.6-1.6"/></svg>`
const CHEVRON_ICON = `<svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4l4 4-4 4"/></svg>`
const CAMERA_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3Z"/><circle cx="12" cy="13" r="3.5"/></svg>`
const GROUP_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/><path d="M3 11h18"/></svg>`
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
  min-width: 0;
  border-right: 1px solid var(--border);
  background: var(--bg-panel);
  flex-shrink: 0;
  min-height: 0;
  overflow: hidden;
}

.hierarchy-splitter {
  position: absolute;
  top: 0;
  right: -2px;
  width: 5px;
  height: 100%;
  cursor: col-resize;
  z-index: 4;
  touch-action: none;
  background: transparent;
}

.hierarchy-splitter:hover,
.hierarchy-splitter.dragging {
  background: var(--accent);
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
  min-width: 172px;
  max-height: min(420px, calc(100% - 46px));
  overflow-y: auto;
  overflow-x: hidden;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
  padding: 4px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
}

.create-menu::-webkit-scrollbar {
  width: 6px;
}

.create-menu::-webkit-scrollbar-thumb {
  background: var(--scrollbar-thumb, rgba(255, 255, 255, 0.22));
  border-radius: 3px;
}

.create-menu::-webkit-scrollbar-track {
  background: transparent;
}

.create-menu.dropdown {
  position: absolute;
  top: 36px;
  right: 10px;
}

.create-menu.context {
  position: absolute;
  max-height: min(420px, calc(100% - 12px));
}

.menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
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

.menu-item-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 15px;
  height: 15px;
  flex-shrink: 0;
  color: var(--text-muted);
  transition: color 0.12s ease;
}

.menu-item-icon :deep(svg) {
  width: 15px;
  height: 15px;
  display: block;
}

.menu-item-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.menu-item:hover {
  background: rgba(91, 156, 245, 0.2);
}

.menu-item:hover:not(:disabled) .menu-item-icon {
  color: #7fb0f5;
}

.menu-item.danger {
  color: #f07178;
}

.menu-item.danger .menu-item-icon {
  color: currentColor;
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

.tree-chevron {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 18px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  flex-shrink: 0;
  opacity: 0.65;
}

.tree-chevron:hover {
  opacity: 1;
  color: var(--text);
}

.chevron-icon {
  display: flex;
  transition: transform 0.12s ease;
  transform: rotate(0deg);
}

.tree-chevron.collapsed .chevron-icon {
  transform: rotate(0deg);
}

.tree-chevron:not(.collapsed) .chevron-icon {
  transform: rotate(90deg);
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
