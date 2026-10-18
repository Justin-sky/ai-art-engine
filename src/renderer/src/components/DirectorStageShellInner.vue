<template>
  <div class="shell" :class="{ 'window-chrome': windowChrome }">
    <header class="titlebar" :class="{ drag: windowChrome }">
      <div class="title-block">
        <span class="app-mark">{{ t('director.title') }}</span>
        <h2 class="title">
          {{ t('director.stageDialog.title') }}
        </h2>
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
            <div v-if="viewMenuOpen" ref="viewMenuEl" class="menu-dropdown" role="menu">
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
          <button
            type="button"
            :class="{ active: scene.cameraPreviewOpen.value }"
            :aria-pressed="scene.cameraPreviewOpen.value"
            @click="scene.toggleCameraPreview"
          >
            {{ t('director.stage.cameraPreview') }}
          </button>
          <div class="preset-root">
            <button
              type="button"
              :class="{ active: presetMenuOpen }"
              :disabled="scene.selectionKind.value !== 'object'"
              :title="
                scene.selectionKind.value === 'object'
                  ? t('director.stage.cameraPreset.title')
                  : t('director.stage.cameraPreset.needObject')
              "
              :aria-expanded="presetMenuOpen"
              @click.stop="togglePresetMenu"
            >
              {{ t('director.stage.cameraPreset.title') }}
            </button>
            <div v-if="presetMenuOpen" ref="presetMenuEl" class="preset-dropdown" role="menu">
              <button
                v-for="group in presetGroups"
                :key="group.id"
                type="button"
                class="preset-group-item"
                :class="{ active: presetSubmenu === group.id }"
                role="menuitem"
                :aria-haspopup="true"
                :aria-expanded="presetSubmenu === group.id"
                @mouseenter="presetSubmenu = group.id"
                @click="presetSubmenu = group.id"
              >
                <span>{{ t(group.labelKey) }}</span>
                <span class="preset-sub-arrow">›</span>
              </button>
              <div v-if="presetSubmenu" class="preset-submenu" role="menu">
                <button
                  v-for="preset in presetSubmenuItems"
                  :key="preset.id"
                  type="button"
                  class="preset-item"
                  :class="{
                    disabled:
                      presetSubmenu === 'combination' && !scene.canApplyComboPreset(preset.id)
                  }"
                  :disabled="
                    presetSubmenu === 'combination' && !scene.canApplyComboPreset(preset.id)
                  "
                  :title="
                    presetSubmenu === 'combination' && !scene.canApplyComboPreset(preset.id)
                      ? t('director.stage.cameraPreset.comboNeedModels')
                      : ''
                  "
                  role="menuitem"
                  @click="onPickPreset(preset.id)"
                >
                  {{ t(preset.labelKey) }}
                </button>
              </div>
            </div>
          </div>
          <div class="ai-director-root">
            <button
              type="button"
              :class="{ active: aiDirectorMenuOpen }"
              :title="t('director.stage.aiDirector.title')"
              :aria-expanded="aiDirectorMenuOpen"
              @click.stop="toggleAiDirectorMenu"
            >
              ✦ {{ t('director.stage.aiDirector.title') }}
            </button>
            <div
              v-if="aiDirectorMenuOpen"
              ref="aiDirectorMenuEl"
              class="ai-director-dropdown"
              role="dialog"
              :aria-label="t('director.stage.aiDirector.title')"
            >
              <div class="ai-director-head">
                {{ t('director.stage.aiDirector.previzPacksTitle') }}
              </div>
              <div class="ai-director-subhint">
                {{ t('director.stage.aiDirector.previzPacksHint') }}
              </div>
              <div class="ai-director-pack-list">
                <button
                  v-for="pack in cinemachinePrevizPacks"
                  :key="pack.id"
                  type="button"
                  class="ai-director-pack-card"
                  :class="{ active: activePrevizPackId === pack.id }"
                  @click="onPickCinemachinePack(pack.id)"
                >
                  <div class="ai-director-pack-top">
                    <span class="ai-director-pack-title">{{ t(pack.labelKey) }}</span>
                    <span class="ai-director-pack-badge">{{ t(pack.badgeKey) }}</span>
                  </div>
                  <div class="ai-director-pack-desc">{{ t(pack.descKey) }}</div>
                </button>
              </div>
              <button
                type="button"
                class="ai-director-bake-btn"
                :title="t('director.stage.aiDirector.bakeStoryboardHint')"
                @click="onBakeCutStoryboard"
              >
                {{ t('director.stage.aiDirector.bakeStoryboard') }}
              </button>
              <div class="ai-director-divider" />
              <div class="ai-director-head">
                {{ t('director.stage.aiDirector.templates') }}
              </div>
              <div class="ai-director-templates">
                <button
                  v-for="tpl in aiBlockingTemplates"
                  :key="tpl.id"
                  type="button"
                  class="ai-director-pill"
                  @click="onPickAiTemplate(locale.startsWith('en') ? tpl.promptEn : tpl.promptZh)"
                >
                  {{ t(tpl.labelKey) }}
                </button>
              </div>
              <textarea
                v-model="aiDirectorPrompt"
                class="ai-director-textarea"
                rows="2"
                :placeholder="t('director.stage.aiDirector.placeholder')"
              />
              <div class="ai-director-footer">
                <span v-if="aiDirectorSummary" class="ai-director-summary">{{
                  aiDirectorSummary
                }}</span>
                <button
                  type="button"
                  class="ai-director-apply"
                  :disabled="!aiDirectorPrompt.trim()"
                  @click="onApplyAiBlocking"
                >
                  {{ t('director.stage.aiDirector.apply') }}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div class="title-actions no-drag">
        <div class="gizmos-root shading-root">
          <button
            type="button"
            class="shots-trigger gizmos-trigger"
            :class="{ open: shadingMenuOpen }"
            :aria-expanded="shadingMenuOpen"
            :title="t('director.stage.shadingMode')"
            @click.stop="toggleShadingMenu"
          >
            <span class="shots-trigger-icon" v-html="SHADING_ICON" />
          </button>
          <div
            v-if="shadingMenuOpen"
            ref="shadingMenuEl"
            class="gizmos-menu shading-menu"
            role="menu"
            :aria-label="t('director.stage.shadingMode')"
          >
            <div class="gizmos-title">
              {{ t('director.stage.shadingMode') }}
            </div>
            <button
              v-for="option in shadingOptions"
              :key="option.id"
              type="button"
              class="shading-item"
              :class="{ active: scene.shadingMode.value === option.id }"
              role="menuitem"
              @click="onPickShading(option.id)"
            >
              <span
                v-if="scene.shadingMode.value === option.id"
                class="shading-check"
                aria-hidden="true"
                >✓</span
              >
              <span v-else class="shading-check spacer" aria-hidden="true" />
              <span>{{ t(option.labelKey) }}</span>
            </button>
          </div>
        </div>
        <div class="gizmos-root">
          <button
            type="button"
            class="shots-trigger gizmos-trigger"
            :class="{ open: gizmosMenuOpen }"
            :aria-expanded="gizmosMenuOpen"
            :title="t('director.stage.gizmos.title')"
            @click.stop="toggleGizmosMenu"
          >
            <span class="shots-trigger-icon" v-html="GIZMOS_ICON" />
          </button>
          <div v-if="gizmosMenuOpen" ref="gizmosMenuEl" class="gizmos-menu">
            <div class="gizmos-title">
              {{ t('director.stage.gizmos.title') }}
            </div>
            <label class="gizmos-row">
              <span>{{ t('director.stage.gizmos.size') }}</span>
              <input
                type="range"
                min="0.1"
                max="2"
                step="0.05"
                :value="scene.gizmoSize.value"
                @input="onGizmoSizeInput"
              />
              <span class="gizmos-val">{{ scene.gizmoSize.value.toFixed(2) }}</span>
            </label>
            <label class="gizmos-row check">
              <input
                type="checkbox"
                :checked="scene.sceneLabelsVisible.value"
                @change="onGizmoToggle('labels', $event)"
              />
              <span>{{ t('director.stage.gizmos.labels') }}</span>
            </label>
            <label class="gizmos-row check">
              <input
                type="checkbox"
                :checked="scene.cameraGizmosVisible.value"
                @change="onGizmoToggle('cameras', $event)"
              />
              <span>{{ t('director.stage.gizmos.cameras') }}</span>
            </label>
            <label class="gizmos-row check">
              <input
                type="checkbox"
                :checked="scene.lightGizmosVisible.value"
                @change="onGizmoToggle('lights', $event)"
              />
              <span>{{ t('director.stage.gizmos.lights') }}</span>
            </label>
            <label class="gizmos-row check">
              <input
                type="checkbox"
                :checked="scene.gridGizmoVisible.value"
                @change="onGizmoToggle('grid', $event)"
              />
              <span>{{ t('director.stage.gizmos.grid') }}</span>
            </label>
            <label class="gizmos-row check">
              <input
                type="checkbox"
                :checked="scene.selectionBoundsVisible.value"
                @change="onGizmoToggle('bounds', $event)"
              />
              <span>{{ t('director.stage.gizmos.selectionBounds') }}</span>
            </label>
            <label class="gizmos-row check">
              <input
                type="checkbox"
                :checked="scene.captureLabelsVisible.value"
                @change="onGizmoToggle('captureLabels', $event)"
              />
              <span>{{ t('director.stage.gizmos.captureLabels') }}</span>
            </label>
            <label class="gizmos-row check">
              <input
                type="checkbox"
                :checked="scene.captureCameraLabelsVisible.value"
                @change="onGizmoToggle('captureCameraLabels', $event)"
              />
              <span>{{ t('director.stage.gizmos.captureCameraLabels') }}</span>
            </label>
          </div>
        </div>
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
            <DirectorCameraShotsPanel :initial-tab="shotsPanelTab" @close="closeShotsPanel" />
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
          :selection-bounds-visible="scene.selectionBoundsVisible.value"
          :composition-guide="scene.compositionGuide.value"
          :capture-pass="scene.capturePass.value"
          @set-mode="scene.setMode"
          @set-stage-edit-mode="scene.setStageEditMode"
          @capture="onCapture"
          @capture-first-last="onCaptureFirstLast"
          @capture-all-cameras="onCaptureAllCameras"
          @set-aspect-ratio="scene.setAspectRatio"
          @set-composition-guide="scene.setCompositionGuide"
          @set-capture-pass="scene.setCapturePass"
          @toggle-selection-bounds="scene.toggleSelectionBoundsVisible"
        />
        <div
          v-if="scene.aspectRatio.value !== 'auto' || scene.compositionGuide.value !== 'none'"
          class="aspect-frame"
          :class="{ 'guide-only': scene.aspectRatio.value === 'auto' }"
          :style="aspectFrameStyle"
        >
          <svg
            v-if="scene.compositionGuide.value !== 'none'"
            class="composition-guide-svg"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
          >
            <template v-if="scene.compositionGuide.value === 'thirds'">
              <line x1="33.33" y1="0" x2="33.33" y2="100" />
              <line x1="66.67" y1="0" x2="66.67" y2="100" />
              <line x1="0" y1="33.33" x2="100" y2="33.33" />
              <line x1="0" y1="66.67" x2="100" y2="66.67" />
            </template>
            <template v-else-if="scene.compositionGuide.value === 'golden'">
              <line x1="38.2" y1="0" x2="38.2" y2="100" />
              <line x1="61.8" y1="0" x2="61.8" y2="100" />
              <line x1="0" y1="38.2" x2="100" y2="38.2" />
              <line x1="0" y1="61.8" x2="100" y2="61.8" />
            </template>
            <template v-else-if="scene.compositionGuide.value === 'crosshair'">
              <line x1="50" y1="38" x2="50" y2="62" />
              <line x1="38" y1="50" x2="62" y2="50" />
              <circle cx="50" cy="50" r="6" />
            </template>
            <template v-else-if="scene.compositionGuide.value === 'safeArea'">
              <rect x="5" y="5" width="90" height="90" />
              <rect x="10" y="10" width="80" height="80" stroke-dasharray="1.5 1.5" />
            </template>
            <template v-else-if="scene.compositionGuide.value === 'diagonal'">
              <line x1="0" y1="0" x2="100" y2="100" />
              <line x1="100" y1="0" x2="0" y2="100" />
            </template>
          </svg>
        </div>
        <DirectorCameraPreviewPanel />
        <DirectorViewOrientationGizmo
          @set-orientation="scene.setViewOrientation"
          @reset-view="scene.resetViewer"
        />
        <!--
          「模型口接了线却没实例化」的原因提示。
          压在视口内而不是状态栏：这种情况下画面本来就是空的，用户不会去看底栏。
        -->
        <div v-if="incomingModelNoticeText" class="incoming-model-notice">
          {{ incomingModelNoticeText }}
        </div>
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
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { Ref } from 'vue'
import {
  DIRECTOR_SHADING_MODES,
  fitDirectorAspectFrame,
  isPoseModelAsset,
  type DirectorShadingMode
} from '@shared/domain'
import {
  DIRECTOR_COMBO_CAMERA_PRESETS,
  DIRECTOR_SHOT_CAMERA_PRESETS
} from '@shared/directorCameraPresets'
import {
  DIRECTOR_AI_BLOCKING_TEMPLATES,
  DIRECTOR_CINEMACHINE_PREVIZ_PACKS,
  type DirectorCinemachinePrevizPackId
} from '../features/director/directorAiBlocking'
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
import type { DirectorMediaGalleryTab } from '../features/director/useDirectorStageScene'
import DirectorCameraShotsPanel from './DirectorCameraShotsPanel.vue'
import DirectorAnimationPanel from './DirectorAnimationPanel.vue'
import DirectorCameraPreviewPanel from './DirectorCameraPreviewPanel.vue'

const CAMERA_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3Z"/><circle cx="12" cy="13" r="3.5"/></svg>`
const GIZMOS_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="7.6"/><path d="M4.4 12a7.6 3.1 0 0 0 15.2 0"/><path d="M12 4.4a3.1 7.6 0 0 1 0 15.2"/></svg>`
const SHADING_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.4 20.2 8v8L12 20.6 3.8 16V8L12 3.4Z" fill="currentColor" fill-opacity="0.14"/><path d="M3.8 8 12 12.6 20.2 8"/><path d="M12 12.6V20.6"/></svg>`

defineProps<{
  showClose?: boolean
  /** 独立 OS 窗口：标题栏可拖动 */
  windowChrome?: boolean
}>()

const emit = defineEmits<{
  close: []
  ready: [el: HTMLDivElement]
}>()

const { t, locale } = useStudioI18n()
const workspace = useWorkspaceStore()
const scene = inject(directorStageSceneKey)!
const viewportEl = inject<Ref<HTMLDivElement | null>>('directorViewportEl')!
const localViewport = ref<HTMLDivElement | null>(null)
const viewportSize = ref({ width: 0, height: 0 })
const viewportAssetDragOver = ref(false)

/**
 * 模型口问题的可读文案。
 *
 * 三种原因分开说：用户能据此判断是自己该去资产库确认、还是上游压根没产出 ——
 * 此前这三条路都静默失败，界面只呈现"空的导演台"。
 */
const incomingModelNoticeText = computed(() => {
  const notice = scene.incomingModelNotice.value
  if (!notice) return ''
  const key =
    notice.kind === 'noCandidate'
      ? 'director.incomingModel.noCandidate'
      : notice.kind === 'missingPath'
        ? 'director.incomingModel.missingPath'
        : 'director.incomingModel.notPlaceable'
  return t(key)
})
const viewMenuOpen = ref(false)
const viewMenuEl = ref<HTMLElement | null>(null)
const presetMenuOpen = ref(false)
const presetMenuEl = ref<HTMLElement | null>(null)
const presetSubmenu = ref<string | null>(null)
const aiDirectorMenuOpen = ref(false)
const aiDirectorMenuEl = ref<HTMLElement | null>(null)
const aiDirectorPrompt = ref('')
const aiDirectorSummary = ref('')
const activePrevizPackId = ref<DirectorCinemachinePrevizPackId | null>(null)
const aiBlockingTemplates = DIRECTOR_AI_BLOCKING_TEMPLATES
const cinemachinePrevizPacks = DIRECTOR_CINEMACHINE_PREVIZ_PACKS
const shotsPanelOpen = ref(false)
const shotsPanelTab = ref<DirectorMediaGalleryTab>('shots')
const gizmosMenuOpen = ref(false)
const gizmosMenuEl = ref<HTMLElement | null>(null)
const shadingMenuOpen = ref(false)
const shadingMenuEl = ref<HTMLElement | null>(null)
const shadingOptions = DIRECTOR_SHADING_MODES.map((id) => ({
  id,
  labelKey: `director.stage.shading.${id}` as const
}))
let resizeObserver: ResizeObserver | null = null

const hasSelection = computed(
  () =>
    (scene.selectionKind.value === 'object' && !!scene.selectedObjectId.value) ||
    (scene.selectionKind.value === 'camera' && !!scene.selectedCameraId.value)
)
const shotCount = computed(
  () => (scene.stage.value.cameraShots?.length ?? 0) + (scene.stage.value.cameraVideos?.length ?? 0)
)

const presetGroups = [
  {
    id: 'shotSize',
    labelKey: 'director.stage.cameraPreset.groupShotSize',
    items: DIRECTOR_SHOT_CAMERA_PRESETS.filter((p) => p.group === 'shotSize')
  },
  {
    id: 'angle',
    labelKey: 'director.stage.cameraPreset.groupAngle',
    items: DIRECTOR_SHOT_CAMERA_PRESETS.filter((p) => p.group === 'angle')
  },
  {
    id: 'combination',
    labelKey: 'director.stage.cameraPreset.groupCombination',
    items: DIRECTOR_COMBO_CAMERA_PRESETS.map((p) => ({ id: p.id, labelKey: p.labelKey }))
  }
]

const presetSubmenuItems = computed(
  () => presetGroups.find((g) => g.id === presetSubmenu.value)?.items ?? []
)

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
  if (viewMenuOpen.value) {
    closeShotsPanel()
    closeShadingMenu()
    gizmosMenuOpen.value = false
    aiDirectorMenuOpen.value = false
  }
}

function togglePresetMenu(): void {
  presetMenuOpen.value = !presetMenuOpen.value
  if (presetMenuOpen.value) {
    closeShotsPanel()
    closeShadingMenu()
    gizmosMenuOpen.value = false
    aiDirectorMenuOpen.value = false
  }
  if (!presetMenuOpen.value) presetSubmenu.value = null
}

function toggleAiDirectorMenu(): void {
  aiDirectorMenuOpen.value = !aiDirectorMenuOpen.value
  if (aiDirectorMenuOpen.value) {
    closeShotsPanel()
    closeShadingMenu()
    gizmosMenuOpen.value = false
    presetMenuOpen.value = false
    presetSubmenu.value = null
  }
}

function onPickAiTemplate(prompt: string): void {
  aiDirectorPrompt.value = prompt
  void onApplyAiBlocking()
}

async function onApplyAiBlocking(): Promise<void> {
  const text = aiDirectorPrompt.value.trim()
  if (!text) return
  activePrevizPackId.value = null
  const res = await scene.applyAiDirectorBlocking(text)
  aiDirectorSummary.value = res.summary
}

async function onPickCinemachinePack(packId: DirectorCinemachinePrevizPackId): Promise<void> {
  activePrevizPackId.value = packId
  const res = await scene.applyCinemachinePrevizPack(packId)
  aiDirectorSummary.value = res.summary
}

function onBakeCutStoryboard(): void {
  const shots = scene.captureCutTrackStoryboard()
  aiDirectorSummary.value = t('director.stage.aiDirector.bakedCount', { count: shots.length })
  aiDirectorMenuOpen.value = false
}

function onPickPreset(presetId: string): void {
  scene.applyCameraPreset(presetId)
  presetMenuOpen.value = false
  presetSubmenu.value = null
}

function closeViewMenu(): void {
  viewMenuOpen.value = false
}

function toggleShotsPanel(): void {
  shotsPanelOpen.value = !shotsPanelOpen.value
  if (shotsPanelOpen.value) {
    closeViewMenu()
    closeShadingMenu()
    gizmosMenuOpen.value = false
    aiDirectorMenuOpen.value = false
  }
}

function closeShadingMenu(): void {
  shadingMenuOpen.value = false
}

function toggleShadingMenu(): void {
  shadingMenuOpen.value = !shadingMenuOpen.value
  if (shadingMenuOpen.value) {
    closeShotsPanel()
    gizmosMenuOpen.value = false
    aiDirectorMenuOpen.value = false
  }
}

function onPickShading(mode: DirectorShadingMode): void {
  scene.setShadingMode(mode)
  closeShadingMenu()
}

function toggleGizmosMenu(): void {
  gizmosMenuOpen.value = !gizmosMenuOpen.value
  if (gizmosMenuOpen.value) {
    closeShotsPanel()
    closeShadingMenu()
    aiDirectorMenuOpen.value = false
  }
}

function onGizmoSizeInput(event: Event): void {
  const value = Number((event.target as HTMLInputElement).value)
  if (Number.isFinite(value)) scene.setGizmoSize(value)
}

function onGizmoToggle(
  kind:
    'labels' | 'cameras' | 'lights' | 'grid' | 'bounds' | 'captureLabels' | 'captureCameraLabels',
  event: Event
): void {
  const checked = (event.target as HTMLInputElement).checked
  if (kind === 'labels') scene.setSceneLabelsVisible(checked)
  else if (kind === 'cameras') scene.setCameraGizmosVisible(checked)
  else if (kind === 'lights') scene.setLightGizmosVisible(checked)
  else if (kind === 'grid') scene.setGridGizmoVisible(checked)
  else if (kind === 'bounds') scene.setSelectionBoundsVisible(checked)
  else if (kind === 'captureLabels') scene.setCaptureLabelsVisible(checked)
  else scene.setCaptureCameraLabelsVisible(checked)
}

function closeShotsPanel(): void {
  shotsPanelOpen.value = false
}

function openShotsPanel(tab: DirectorMediaGalleryTab = 'shots'): void {
  closeViewMenu()
  shotsPanelTab.value = tab
  shotsPanelOpen.value = true
}

watch(
  () => scene.mediaGallerySignal.value.seq,
  () => {
    openShotsPanel(scene.mediaGallerySignal.value.tab)
  }
)

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
  if (presetMenuOpen.value) {
    if (presetMenuEl.value?.contains(target)) return
    if (target?.closest('.preset-root')) return
    presetMenuOpen.value = false
    presetSubmenu.value = null
  }
  if (aiDirectorMenuOpen.value) {
    if (aiDirectorMenuEl.value?.contains(target)) return
    if (target?.closest('.ai-director-root')) return
    aiDirectorMenuOpen.value = false
  }
  if (shotsPanelOpen.value) {
    if (target?.closest('.shots-root')) return
    closeShotsPanel()
  }
  if (gizmosMenuOpen.value) {
    if (gizmosMenuEl.value?.contains(target)) return
    if (target?.closest('.gizmos-root:not(.shading-root)')) return
    gizmosMenuOpen.value = false
  }
  if (shadingMenuOpen.value) {
    if (shadingMenuEl.value?.contains(target)) return
    if (target?.closest('.shading-root')) return
    closeShadingMenu()
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
  openShotsPanel('shots')
}

function onCaptureFirstLast(): void {
  scene.takeFirstLastFramePair()
  openShotsPanel('shots')
}

function onCaptureAllCameras(): void {
  scene.captureAllCameras()
  openShotsPanel('shots')
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

.view-modes button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.preset-root {
  position: relative;
}

.preset-dropdown {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 60;
  min-width: 150px;
  padding: 4px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--bg-panel);
  box-shadow: 0 12px 32px var(--shadow);
}

.preset-group-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  padding: 7px 10px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text);
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
}

.preset-group-item:hover,
.preset-group-item.active {
  background: rgba(91, 156, 245, 0.16);
  color: var(--accent-fg);
}

.preset-sub-arrow {
  font-size: 14px;
  line-height: 1;
  color: var(--text-muted);
}

.preset-submenu {
  position: absolute;
  left: calc(100% + 4px);
  top: -4px;
  min-width: 170px;
  max-height: 60vh;
  overflow: auto;
  padding: 4px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--bg-panel);
  box-shadow: 0 12px 32px var(--shadow);
}

.preset-item {
  display: block;
  width: 100%;
  text-align: left;
  padding: 6px 10px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text);
  font-size: 12px;
  cursor: pointer;
}

.preset-item:hover {
  background: rgba(91, 156, 245, 0.16);
  color: var(--accent-fg);
}

.preset-item:disabled {
  opacity: 0.45;
  cursor: not-allowed;
  color: var(--text-muted);
}

.preset-item:disabled:hover {
  background: transparent;
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

.gizmos-root {
  position: relative;
}

.gizmos-trigger {
  width: 28px;
  padding: 0;
  justify-content: center;
}

.gizmos-trigger .shots-trigger-icon {
  width: 19px;
  height: 19px;
}

.gizmos-menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 55;
  min-width: 210px;
  padding: 8px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--bg-panel);
  box-shadow: 0 12px 32px var(--shadow);
}

.gizmos-title {
  margin-bottom: 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
}

.gizmos-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 2px;
  font-size: 12px;
  color: var(--text);
  cursor: pointer;
}

.gizmos-row input[type='range'] {
  flex: 1;
  min-width: 0;
  accent-color: var(--accent);
}

.gizmos-val {
  width: 34px;
  text-align: right;
  color: var(--text-muted);
  font-size: 11px;
}

.gizmos-row.check input {
  accent-color: var(--accent);
}

.shading-menu {
  min-width: 148px;
  padding: 6px;
}

.shading-item {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 6px 8px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text);
  cursor: pointer;
  font-size: 12px;
  text-align: left;
}

.shading-item:hover {
  background: var(--bg-hover);
}

.shading-item.active {
  background: color-mix(in srgb, var(--accent) 18%, transparent);
}

.shading-check {
  width: 12px;
  flex: 0 0 12px;
  font-size: 11px;
  line-height: 1;
  color: var(--accent);
}

.shading-check.spacer {
  visibility: hidden;
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
  overflow: hidden;
}

.aspect-frame.guide-only {
  border-color: transparent;
  box-shadow: none;
}

.composition-guide-svg {
  width: 100%;
  height: 100%;
  display: block;
}

.composition-guide-svg line,
.composition-guide-svg rect,
.composition-guide-svg circle {
  fill: none;
  stroke: var(--wash-42);
  stroke-width: 0.35;
  vector-effect: non-scaling-stroke;
}

.ai-director-root {
  position: relative;
}

.ai-director-dropdown {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 65;
  width: 368px;
  max-height: min(76vh, 620px);
  overflow-y: auto;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--bg-panel);
  box-shadow: 0 12px 32px var(--shadow);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ai-director-head {
  font-size: 11px;
  font-weight: 600;
  color: var(--text);
}

.ai-director-subhint {
  font-size: 10.5px;
  line-height: 1.4;
  color: var(--text-muted);
  margin-top: -4px;
}

.ai-director-pack-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.ai-director-pack-card {
  width: 100%;
  text-align: left;
  padding: 7px 9px !important;
  border: 1px solid var(--border) !important;
  border-radius: 7px !important;
  background: var(--bg-elevated) !important;
  color: var(--text) !important;
  display: flex;
  flex-direction: column;
  gap: 3px;
  cursor: pointer;
  transition:
    border-color 0.14s ease,
    background 0.14s ease;
}

.ai-director-pack-card:hover {
  background: var(--bg-hover) !important;
  border-color: color-mix(in srgb, var(--accent) 55%, var(--border)) !important;
}

.ai-director-pack-card.active {
  border-color: var(--accent) !important;
  background: color-mix(in srgb, var(--accent) 14%, var(--bg-elevated)) !important;
}

.ai-director-pack-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.ai-director-pack-title {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--text);
}

.ai-director-pack-badge {
  font-size: 10px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent) 20%, transparent);
  color: var(--accent);
  white-space: nowrap;
}

.ai-director-pack-desc {
  font-size: 10.5px;
  line-height: 1.35;
  color: var(--text-muted);
}

.ai-director-bake-btn {
  width: 100%;
  padding: 6px 10px !important;
  border-radius: 7px !important;
  border: 1px solid color-mix(in srgb, var(--accent) 45%, var(--border)) !important;
  background: color-mix(in srgb, var(--accent) 14%, var(--bg-elevated)) !important;
  color: var(--text) !important;
  font-size: 11.5px !important;
  font-weight: 600;
  cursor: pointer;
  text-align: center;
}

.ai-director-bake-btn:hover {
  background: color-mix(in srgb, var(--accent) 24%, var(--bg-elevated)) !important;
}

.ai-director-divider {
  height: 1px;
  background: var(--border);
  margin: 2px 0;
}

.ai-director-templates {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.ai-director-pill {
  padding: 4px 8px !important;
  border: 1px solid var(--border) !important;
  border-radius: 6px !important;
  background: var(--bg-elevated) !important;
  color: var(--text) !important;
  font-size: 11px !important;
  cursor: pointer;
}

.ai-director-pill:hover {
  background: var(--bg-hover) !important;
}

.ai-director-textarea {
  width: 100%;
  box-sizing: border-box;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-elevated);
  color: var(--text);
  font-size: 12px;
  line-height: 1.4;
  resize: vertical;
}

.ai-director-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.ai-director-summary {
  flex: 1;
  min-width: 0;
  font-size: 11px;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ai-director-apply {
  margin-left: auto;
  padding: 5px 12px !important;
  border-radius: 6px !important;
  background: var(--accent) !important;
  color: #fff !important;
  font-size: 12px !important;
  font-weight: 500;
  cursor: pointer;
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

/**
 * 模型口问题提示：压在视口下方居中，不挡取景也不随视口旋转。
 * 用主题变量（它叠在应用自己的画布上，与生成内容不同）。
 */
.incoming-model-notice {
  position: absolute;
  left: 50%;
  bottom: 16px;
  transform: translateX(-50%);
  max-width: min(560px, calc(100% - 32px));
  padding: 6px 10px;
  border-radius: 6px;
  border: 1px solid var(--border, rgba(255, 255, 255, 0.18));
  background: var(--panel-bg, rgba(0, 0, 0, 0.72));
  color: var(--text-muted);
  font-size: 11px;
  line-height: 1.5;
  text-align: center;
  pointer-events: none;
  z-index: 2;
}
</style>
