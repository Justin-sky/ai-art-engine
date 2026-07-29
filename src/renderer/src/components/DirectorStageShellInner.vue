<template>
  <div class="shell" :class="{ 'window-chrome': windowChrome }">
    <header class="titlebar" :class="{ drag: windowChrome }">
      <div class="title-block">
        <span class="app-mark">{{ t('director.title') }}</span>
        <h2 class="title">{{ t('director.stageDialog.title') }}</h2>
        <div class="menubar no-drag">
          <div class="menu-root">
            <button
              type="button"
              class="menu-trigger"
              :class="{ open: viewMenuOpen }"
              :aria-expanded="viewMenuOpen"
              @click.stop="toggleViewMenu"
            >
              {{ t('director.stage.viewMenu') }}
            </button>
            <div
              v-if="viewMenuOpen"
              ref="viewMenuEl"
              class="menu-dropdown"
              role="menu"
            >
              <button
                type="button"
                class="menu-item"
                role="menuitem"
                :disabled="!hasSelection"
                @click="runMoveToView"
              >
                <span>{{ t('director.stage.moveToView') }}</span>
                <span class="menu-shortcut">{{ t('director.stage.moveToViewShortcut') }}</span>
              </button>
              <button
                type="button"
                class="menu-item"
                role="menuitem"
                :disabled="!hasSelection"
                @click="runAlignWithView"
              >
                <span>{{ t('director.stage.alignWithView') }}</span>
                <span class="menu-shortcut">{{ t('director.stage.alignWithViewShortcut') }}</span>
              </button>
              <button
                type="button"
                class="menu-item"
                role="menuitem"
                :disabled="!hasSelection"
                @click="runAlignViewToSelected"
              >
                <span>{{ t('director.stage.alignViewToSelected') }}</span>
              </button>
            </div>
          </div>
        </div>
        <div class="view-modes no-drag">
          <button
            type="button"
            :class="{ active: scene.viewMode.value === 'director' }"
            @click="scene.setViewMode('director')"
          >
            {{ t('director.stage.viewDirector') }}
          </button>
          <button
            type="button"
            :class="{ active: scene.viewMode.value === 'camera' }"
            @click="scene.setViewMode('camera')"
          >
            {{ t('director.stage.viewCamera') }}
          </button>
        </div>
      </div>
      <div class="title-actions no-drag">
        <div class="shots-root">
          <button
            type="button"
            class="shots-trigger"
            :class="{ open: shotsPanelOpen }"
            :aria-expanded="shotsPanelOpen"
            :title="t('director.stage.tabShots')"
            @click.stop="toggleShotsPanel"
          >
            <span class="shots-trigger-icon" v-html="CAMERA_ICON" />
            <span>{{ t('director.stage.tabShots') }}</span>
            <span v-if="shotCount" class="shots-count">{{ shotCount }}</span>
          </button>
          <div v-if="shotsPanelOpen" class="shots-dropdown">
            <DirectorCameraShotsPanel @close="closeShotsPanel" />
          </div>
        </div>
        <button
          v-if="showClose"
          type="button"
          class="close-btn"
          :title="t('director.stageDialog.close')"
          @click="emit('close')"
        >
          ×
        </button>
      </div>
    </header>

    <div class="body">
      <DirectorSceneHierarchy />
      <div class="viewport-wrap">
        <div
          ref="localViewport"
          class="viewport"
          :class="{
            panning: scene.isPanning.value,
            orbiting: scene.isOrbiting.value,
            cameraMode: scene.viewMode.value === 'camera',
            'asset-drag-over': viewportAssetDragOver
          }"
          @contextmenu.prevent
          @dragenter.prevent="onViewportDragEnter"
          @dragover.prevent="onViewportDragOver"
          @dragleave="onViewportDragLeave"
          @drop.prevent="onViewportDrop"
        />
        <DirectorViewportToolbar
          :transform-mode="scene.transformMode.value"
          :aspect-ratio="scene.aspectRatio.value"
          :stage-edit-mode="scene.stageEditMode.value"
          @set-mode="scene.setMode"
          @set-stage-edit-mode="scene.setStageEditMode"
          @reset-view="scene.resetViewer"
          @capture="onCapture"
          @set-aspect-ratio="scene.setAspectRatio"
        />
        <div
          v-if="scene.aspectRatio.value !== 'auto'"
          class="aspect-frame"
          :style="aspectFrameStyle"
        />
        <DirectorViewOrientationGizmo
          @set-orientation="scene.setViewOrientation"
          @reset-view="scene.resetViewer"
        />
      </div>
    </div>

    <DirectorAnimationPanel v-if="scene.stageEditMode.value === 'animation'" />

    <footer class="statusbar">
      <span>{{ t('director.hint.stage') }}</span>
      <span v-if="scene.error.value" class="status-error">{{ scene.error.value }}</span>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, onBeforeUnmount, onMounted, ref } from 'vue'
import type { Ref } from 'vue'
import { fitDirectorAspectFrame, isPoseModelAsset } from '@shared/domain'
import { useStudioI18n } from '../composables/useStudioI18n'
import { directorStageSceneKey } from '../features/director/stageSceneKey'
import {
  STUDIO_ASSET_DRAG_MIME,
  STUDIO_ASSET_ID_DRAG_MIME,
  STUDIO_ASSET_IDS_DRAG_MIME,
  useWorkspaceStore
} from '../stores/workspace'
import DirectorSceneHierarchy from './DirectorSceneHierarchy.vue'
import DirectorViewportToolbar from './DirectorViewportToolbar.vue'
import DirectorViewOrientationGizmo from './DirectorViewOrientationGizmo.vue'
import DirectorCameraShotsPanel from './DirectorCameraShotsPanel.vue'
import DirectorAnimationPanel from './DirectorAnimationPanel.vue'

const CAMERA_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3Z"/><circle cx="12" cy="13" r="3.5"/></svg>`

defineProps<{
  showClose?: boolean
  /** 独立 OS 窗口：标题栏可拖动 */
  windowChrome?: boolean
}>()

const emit = defineEmits<{
  close: []
  ready: [el: HTMLDivElement]
}>()

const { t } = useStudioI18n()
const workspace = useWorkspaceStore()
const scene = inject(directorStageSceneKey)!
const viewportEl = inject<Ref<HTMLDivElement | null>>('directorViewportEl')!
const localViewport = ref<HTMLDivElement | null>(null)
const viewportSize = ref({ width: 0, height: 0 })
const viewportAssetDragOver = ref(false)
const viewMenuOpen = ref(false)
const viewMenuEl = ref<HTMLElement | null>(null)
const shotsPanelOpen = ref(false)
let resizeObserver: ResizeObserver | null = null

const hasSelection = computed(
  () =>
    (scene.selectionKind.value === 'object' && !!scene.selectedObjectId.value) ||
    (scene.selectionKind.value === 'camera' && !!scene.selectedCameraId.value)
)
const shotCount = computed(() => scene.stage.value.cameraShots?.length ?? 0)

const aspectFrameStyle = computed(() => {
  const frame = fitDirectorAspectFrame(
    scene.aspectRatio.value,
    viewportSize.value.width,
    viewportSize.value.height
  )
  return {
    left: `${frame.left}px`,
    top: `${frame.top}px`,
    width: `${frame.width}px`,
    height: `${frame.height}px`
  }
})

function toggleViewMenu(): void {
  viewMenuOpen.value = !viewMenuOpen.value
  if (viewMenuOpen.value) closeShotsPanel()
}

function closeViewMenu(): void {
  viewMenuOpen.value = false
}

function toggleShotsPanel(): void {
  shotsPanelOpen.value = !shotsPanelOpen.value
  if (shotsPanelOpen.value) closeViewMenu()
}

function closeShotsPanel(): void {
  shotsPanelOpen.value = false
}

function openShotsPanel(): void {
  closeViewMenu()
  shotsPanelOpen.value = true
}

function runMoveToView(): void {
  closeViewMenu()
  scene.moveSelectionToView()
}

function runAlignWithView(): void {
  closeViewMenu()
  scene.alignSelectionWithView()
}

function runAlignViewToSelected(): void {
  closeViewMenu()
  scene.alignViewToSelected()
}

function onDocumentPointerDown(event: PointerEvent): void {
  const target = event.target as HTMLElement | null
  if (viewMenuOpen.value) {
    if (viewMenuEl.value?.contains(target)) return
    if (target?.closest('.menu-root')) return
    closeViewMenu()
  }
  if (shotsPanelOpen.value) {
    if (target?.closest('.shots-root')) return
    closeShotsPanel()
  }
}

onMounted(() => {
  document.addEventListener('pointerdown', onDocumentPointerDown)
  if (localViewport.value) {
    viewportEl.value = localViewport.value
    emit('ready', localViewport.value)
    const syncSize = (): void => {
      const el = localViewport.value
      if (!el) return
      viewportSize.value = { width: el.clientWidth, height: el.clientHeight }
    }
    syncSize()
    resizeObserver = new ResizeObserver(syncSize)
    resizeObserver.observe(localViewport.value)
  }
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocumentPointerDown)
  resizeObserver?.disconnect()
  resizeObserver = null
})

function onCapture(): void {
  scene.takeCameraShot()
  openShotsPanel()
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

function onViewportDragEnter(event: DragEvent): void {
  if (!isStudioAssetDrag(event)) return
  viewportAssetDragOver.value = true
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
}

function onViewportDragOver(event: DragEvent): void {
  if (!isStudioAssetDrag(event)) return
  viewportAssetDragOver.value = true
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
}

function onViewportDragLeave(event: DragEvent): void {
  const next = event.relatedTarget as Node | null
  if (next && localViewport.value?.contains(next)) return
  viewportAssetDragOver.value = false
}

async function onViewportDrop(event: DragEvent): Promise<void> {
  viewportAssetDragOver.value = false
  const asset = workspace.resolveDraggedAsset(event)
  if (!asset) return
  if (isPoseModelAsset(asset)) {
    const id = scene.selectedObjectId.value
    if (id && scene.objectSupportsPose(id)) {
      scene.applyPoseAssetToObject(id, asset.id)
    }
    return
  }
  if (asset.type !== 'model') return
  await scene.createModelObject(asset.id)
}
</script>

<style scoped>
.shell {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.shell.window-chrome .titlebar.drag {
  -webkit-app-region: drag;
  app-region: drag;
  /* Windows titleBarOverlay 控件占位 */
  padding-right: 140px;
  padding-top: 10px;
  min-height: 40px;
  box-sizing: border-box;
}

.shell.window-chrome .no-drag {
  -webkit-app-region: no-drag;
  app-region: no-drag;
}

.titlebar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  flex-wrap: wrap;
  cursor: move;
  user-select: none;
}

.titlebar :deep(.no-drag),
.titlebar .no-drag {
  cursor: default;
  user-select: auto;
}

.title-block {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  flex-wrap: wrap;
}

.app-mark {
  font-size: 11px;
  color: var(--text-muted);
}

.title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
  white-space: nowrap;
}

.menubar {
  display: flex;
  align-items: center;
  gap: 4px;
}

.menu-root {
  position: relative;
}

.menu-trigger {
  padding: 4px 10px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text);
  font-size: 12px;
  cursor: pointer;
}

.menu-trigger:hover,
.menu-trigger.open {
  background: var(--wash-08);
}

.menu-dropdown {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  z-index: 40;
  min-width: 260px;
  padding: 4px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--bg-panel);
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.45);
}

.menu-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
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

.menu-item:hover:not(:disabled) {
  background: rgba(91, 156, 245, 0.2);
}

.menu-item:disabled {
  opacity: 0.45;
  cursor: default;
}

.menu-shortcut {
  color: var(--text-muted);
  font-size: 11px;
  flex-shrink: 0;
}

.view-modes {
  display: flex;
  gap: 2px;
  padding: 2px;
  border-radius: 8px;
  background: var(--wash-04);
  border: 1px solid var(--border);
}

.view-modes button {
  padding: 4px 10px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  font-size: 12px;
  cursor: pointer;
}

.view-modes button.active {
  background: var(--accent);
  color: #fff;
}

.title-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.shots-root {
  position: relative;
}

.shots-trigger {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: transparent;
  color: var(--text);
  font-size: 12px;
  cursor: pointer;
}

.shots-trigger:hover,
.shots-trigger.open {
  background: var(--wash-08);
}

.shots-trigger-icon {
  display: flex;
  width: 14px;
  height: 14px;
  color: currentColor;
}

.shots-trigger-icon :deep(svg) {
  width: 100%;
  height: 100%;
}

.shots-count {
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 8px;
  background: var(--accent);
  color: #fff;
  font-size: 10px;
  line-height: 16px;
  text-align: center;
}

.shots-dropdown {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 50;
}

.close-btn {
  width: 28px;
  height: 28px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: transparent;
  color: var(--text);
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
}

.body {
  flex: 1;
  min-height: 0;
  display: flex;
}

.viewport-wrap {
  flex: 1;
  min-width: 0;
  min-height: 0;
  position: relative;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  isolation: isolate;
}

.viewport {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  touch-action: none;
  cursor: default;
  background: var(--director-sky);
  position: relative;
}

.viewport.orbiting {
  cursor: grab;
}

.viewport.panning {
  cursor: move;
}

.viewport.cameraMode {
  cursor: default;
}

.viewport.asset-drag-over {
  outline: 2px dashed color-mix(in srgb, var(--accent) 70%, white 30%);
  outline-offset: -6px;
}

.viewport :deep(canvas) {
  display: block;
  width: 100% !important;
  height: 100% !important;
}

.aspect-frame {
  position: absolute;
  z-index: 4;
  pointer-events: none;
  border: 1px solid var(--wash-42);
  border-radius: 2px;
  box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.45);
  box-sizing: border-box;
}

.statusbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 6px 12px;
  border-top: 1px solid var(--border);
  font-size: 11px;
  color: var(--text-muted);
  flex-shrink: 0;
}

.status-error {
  color: #ff8f8f;
}
</style>
