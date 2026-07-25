<template>
  <aside class="inspector" :class="{ embedded }">
    <div class="body">
      <div class="head">
        <div>
          <div class="type">{{ selectionTypeLabel }}</div>
          <h2>{{ t('asset.inspector.title') }}</h2>
        </div>
        <span class="icon" :title="selectionTypeLabel">{{ selectionIcon }}</span>
      </div>

      <div
        v-if="showCameraPreview"
        class="camera-preview"
        :style="{ aspectRatio: previewAspectCss }"
      >
        <canvas ref="previewCanvas" />
        <span class="fov">FOV {{ Math.round(viewer.fov ?? DEFAULT_DIRECTOR_CAMERA_FOV) }}&deg;</span>
      </div>

      <template v-if="scene.selectionKind.value === 'camera'">
        <p v-if="editingKeyframeHint" class="keyframe-hint">{{ editingKeyframeHint }}</p>
        <p v-if="cameraLocked" class="locked-hint">{{ t('director.stage.lockedHint') }}</p>
        <div class="fields" @focusin="isEditingViewer = true" @focusout="onViewerFocusOut">
          <label>
            {{ t('asset.field.name') }}
            <input v-model="cameraName" type="text" @change="persistCameraName" />
          </label>
          <div class="section-label">{{ t('director.stage.position') }}</div>
          <div class="vec-row" :class="{ disabled: cameraLocked }">
            <label>X <input v-model.number="posX" v-number-scrub type="number" step="0.01" :disabled="cameraLocked" @input="persistViewer" /></label>
            <label>Y <input v-model.number="posY" v-number-scrub type="number" step="0.01" :disabled="cameraLocked" @input="persistViewer" /></label>
            <label>Z <input v-model.number="posZ" v-number-scrub type="number" step="0.01" :disabled="cameraLocked" @input="persistViewer" /></label>
          </div>
          <div class="section-label">{{ t('director.stage.rotationDeg') }}</div>
          <div class="vec-row" :class="{ disabled: cameraLocked }">
            <label>X <input v-model.number="rotX" v-number-scrub type="number" step="0.1" :disabled="cameraLocked" @input="persistViewer" /></label>
            <label>Y <input v-model.number="rotY" v-number-scrub type="number" step="0.1" :disabled="cameraLocked" @input="persistViewer" /></label>
            <label>Z <input v-model.number="rotZ" v-number-scrub type="number" step="0.1" :disabled="cameraLocked" @input="persistViewer" /></label>
          </div>
          <div class="section-label">{{ t('director.stage.scale') }}</div>
          <div class="vec-row" :class="{ disabled: cameraLocked }">
            <label>X <input v-model.number="scaleX" v-number-scrub type="number" step="0.01" min="0.001" :disabled="cameraLocked" @input="persistViewer" /></label>
            <label>Y <input v-model.number="scaleY" v-number-scrub type="number" step="0.01" min="0.001" :disabled="cameraLocked" @input="persistViewer" /></label>
            <label>Z <input v-model.number="scaleZ" v-number-scrub type="number" step="0.01" min="0.001" :disabled="cameraLocked" @input="persistViewer" /></label>
          </div>
          <label class="fov-row">
            {{ t('graph.inspector.camera.fov') }}
            <input v-model.number="fov" type="range" min="20" max="100" step="1" :disabled="cameraLocked" @input="persistViewer" />
            <span>{{ fov }}&deg;</span>
          </label>
        </div>
      </template>

      <template v-else-if="obj">
        <p v-if="editingKeyframeHint" class="keyframe-hint">{{ editingKeyframeHint }}</p>
        <p v-if="obj.locked" class="locked-hint">{{ t('director.stage.lockedHint') }}</p>
        <div v-if="showPoseTab" class="object-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            class="object-tab"
            :class="{ active: objectInspectorTab === 'props' }"
            :aria-selected="objectInspectorTab === 'props'"
            @click="setObjectInspectorTab('props')"
          >
            {{ t('director.stage.tabProps') }}
          </button>
          <button
            type="button"
            role="tab"
            class="object-tab"
            :class="{ active: objectInspectorTab === 'pose' }"
            :aria-selected="objectInspectorTab === 'pose'"
            @click="setObjectInspectorTab('pose')"
          >
            {{ t('director.stage.tabPose') }}
          </button>
        </div>
        <div
          v-if="!showPoseTab || objectInspectorTab === 'props'"
          class="fields"
          @focusin="isEditingObject = true"
          @focusout="onObjectFocusOut"
        >
          <label>
            {{ t('asset.field.name') }}
            <input v-model="objName" type="text" @change="persistObject" />
          </label>
          <div class="section-label">{{ t('director.stage.position') }}</div>
          <div class="vec-row" :class="{ disabled: obj.locked }">
            <label>X <input v-model.number="objPosX" v-number-scrub type="number" step="0.01" :disabled="obj.locked" @input="persistObject" /></label>
            <label>Y <input v-model.number="objPosY" v-number-scrub type="number" step="0.01" :disabled="obj.locked" @input="persistObject" /></label>
            <label>Z <input v-model.number="objPosZ" v-number-scrub type="number" step="0.01" :disabled="obj.locked" @input="persistObject" /></label>
          </div>
          <div class="section-label">{{ t('director.stage.rotationDeg') }}</div>
          <div class="vec-row" :class="{ disabled: obj.locked }">
            <label>X <input v-model.number="objRotX" v-number-scrub type="number" step="0.1" :disabled="obj.locked" @input="persistObject" /></label>
            <label>Y <input v-model.number="objRotY" v-number-scrub type="number" step="0.1" :disabled="obj.locked" @input="persistObject" /></label>
            <label>Z <input v-model.number="objRotZ" v-number-scrub type="number" step="0.1" :disabled="obj.locked" @input="persistObject" /></label>
          </div>
          <div class="section-label">{{ t('director.stage.scale') }}</div>
          <div class="vec-row" :class="{ disabled: obj.locked }">
            <label>X <input v-model.number="objScaleX" v-number-scrub type="number" step="0.01" min="0.001" :disabled="obj.locked" @input="persistObject" /></label>
            <label>Y <input v-model.number="objScaleY" v-number-scrub type="number" step="0.01" min="0.001" :disabled="obj.locked" @input="persistObject" /></label>
            <label>Z <input v-model.number="objScaleZ" v-number-scrub type="number" step="0.01" min="0.001" :disabled="obj.locked" @input="persistObject" /></label>
          </div>
          <label class="uniform-row">
            {{ t('director.stage.uniformScale') }}
            <span class="uniform-control">
              <input
                v-model.number="objUniformScale"
                type="range"
                min="0.01"
                max="5"
                step="0.01"
                :disabled="obj.locked"
                @input="applyUniformScale"
              />
              <input
                v-model.number="objUniformScale"
                v-number-scrub
                type="number"
                step="0.01"
                min="0.01"
                :disabled="obj.locked"
                @input="applyUniformScale"
              />
            </span>
          </label>
          <label class="color-row">
            {{ t('director.stage.color') }}
            <span class="color-control">
              <input v-model="objColor" type="color" @input="persistObject" />
              <input v-model="objColor" type="text" @input="persistObject" />
            </span>
          </label>
        </div>
        <div v-else class="fields pose-panel">
          <div class="section-label">{{ t('director.stage.poseAssets') }}</div>
          <div
            class="pose-asset-bar"
            :class="{ 'asset-drag-over': poseAssetDragOver }"
            @dragenter.prevent="onPoseAssetDragEnter"
            @dragover.prevent="onPoseAssetDragOver"
            @dragleave="onPoseAssetDragLeave"
            @drop.prevent="onPoseAssetDrop"
          >
            <div v-if="poseAssets.length" class="pose-preset-list">
              <button
                v-for="asset in poseAssets"
                :key="asset.id"
                type="button"
                class="pose-asset-chip"
                :class="{ active: activePoseAssetId === asset.id }"
                :disabled="obj.locked"
                :title="asset.name"
                @click="onApplyPoseAsset(asset.id)"
              >
                <span class="pose-asset-icon">{{ poseAssetIcon }}</span>
                <span class="pose-asset-name">{{ asset.name }}</span>
              </button>
            </div>
            <p v-else class="pose-hint">{{ t('director.stage.poseAssetsEmpty') }}</p>
            <p v-if="poseAssetApplyHint" class="pose-hint">{{ poseAssetApplyHint }}</p>
            <div class="pose-asset-actions">
              <button
                type="button"
                class="pose-preset-save-btn"
                :disabled="obj.locked || !canSavePosePreset || savingPoseAsset"
                @click="openSavePoseAssetDialog"
              >
                {{ t('director.stage.poseAssetSave') }}
              </button>
              <button
                type="button"
                class="pose-preset-reset-btn"
                :disabled="obj.locked || !hasBonePose"
                @click="onResetBonePose"
              >
                {{ t('director.stage.poseReset') }}
              </button>
            </div>
          </div>

          <div class="section-label">
            {{ t('director.stage.poseBones', { n: poseBoneNames.length }) }}
          </div>
          <div class="pose-mode-tabs" role="tablist">
            <button
              type="button"
              class="pose-mode-tab"
              :class="{ active: poseEditMode === 'fk' }"
              role="tab"
              :aria-selected="poseEditMode === 'fk'"
              @click="setPoseEditMode('fk')"
            >
              {{ t('director.stage.poseModeFk') }}
            </button>
            <button
              type="button"
              class="pose-mode-tab"
              :class="{ active: poseEditMode === 'ik' }"
              role="tab"
              :aria-selected="poseEditMode === 'ik'"
              @click="setPoseEditMode('ik')"
            >
              {{ t('director.stage.poseModeIk') }}
            </button>
          </div>
          <template v-if="poseEditMode === 'ik'">
            <p class="pose-hint">{{ t('director.stage.poseIkHint') }}</p>
            <p class="pose-hint">{{ t('director.stage.poseIkManualHint') }}</p>
            <div class="pose-ik-list">
              <div v-for="slot in ikTargetSlots" :key="slot.id" class="pose-ik-row">
                <button
                  type="button"
                  class="pose-ik-chip"
                  :class="{ active: selectedIkChainId === slot.id && !!slot.effector }"
                  :disabled="obj.locked || !slot.effector"
                  @click="onSelectIkChain(slot.id)"
                >
                {{ ikSlotLabel(slot.id) }}
                  <span v-if="slot.manual" class="pose-ik-badge">{{ t('director.stage.poseIkManual') }}</span>
                </button>
                <select
                  class="pose-ik-select"
                  :disabled="obj.locked"
                  :value="slot.manual ? slot.effector ?? '' : ''"
                  @change="onIkEffectorChange(slot.id, $event)"
                >
                  <option value="">
                    {{
                      slot.autoEffector
                        ? t('director.stage.poseIkUseAuto', { name: slot.autoEffector })
                        : t('director.stage.poseIkPickBone')
                    }}
                  </option>
                  <option v-for="bone in poseBoneNames" :key="bone" :value="bone">{{ bone }}</option>
                </select>
              </div>
            </div>
            <p v-if="!ikTargetSlots.some((s) => s.effector)" class="pose-hint">{{ t('director.stage.poseIkChainsEmpty') }}</p>
          </template>
          <template v-else>
            <p class="pose-hint">{{ t('director.stage.poseViewportHint') }}</p>
            <p v-if="!poseBoneNames.length" class="pose-hint">{{ t('director.stage.poseBonesEmpty') }}</p>
            <div v-else class="pose-bone-list">
              <div
                v-for="bone in poseBoneNames"
                :key="bone"
                class="pose-bone"
                :class="{ active: selectedPoseBone === bone }"
                @click="onPoseBoneSelect(bone)"
              >
                <div class="pose-bone-name" :title="bone">{{ bone }}</div>
                <div class="pose-bone-sliders" @click.stop>
                  <label
                    v-for="axis in poseAxes"
                    :key="axis"
                    class="pose-axis"
                  >
                    {{ axis.toUpperCase() }}
                    <input
                      type="range"
                      min="-180"
                      max="180"
                      step="1"
                      :value="poseDegFor(bone)[axis]"
                      :disabled="obj.locked"
                      @input="onPoseBoneAxis(bone, axis, $event)"
                    />
                    <span>{{ poseDegFor(bone)[axis] }}&deg;</span>
                    <button
                      type="button"
                      class="pose-axis-reset"
                      :title="t('director.stage.poseAxisReset')"
                      :disabled="obj.locked || poseDegFor(bone)[axis] === 0"
                      @click="resetPoseBoneAxis(bone, axis)"
                    >
                      &#8634;
                    </button>
                  </label>
                </div>
              </div>
            </div>
          </template>
        </div>
      </template>

      <template v-else-if="showSceneGlobal">
        <div class="fields">
          <div class="section-label">{{ t('director.stage.panoramaBackground') }}</div>
          <div
            class="panorama-drop"
            :class="{ active: panoramaDragOver, filled: !!linkedPanoramaName }"
            @dragenter.prevent="onPanoramaDragEnter"
            @dragover.prevent="onPanoramaDragOver"
            @dragleave="onPanoramaDragLeave"
            @drop.prevent="onPanoramaDrop"
          >
            <template v-if="linkedPanoramaName">
              <span class="panorama-drop-name" :title="linkedPanoramaName">{{ linkedPanoramaName }}</span>
              <button
                type="button"
                class="panorama-drop-remove"
                :title="t('director.stage.panoramaRemove')"
                @click.stop="clearLinkedPanorama"
              >
                ?
              </button>
            </template>
            <span v-else class="panorama-drop-hint">{{ t('director.stage.panoramaDropHint') }}</span>
          </div>
          <label class="color-row">
            {{ t('director.stage.skyColor') }}
            <span class="color-control">
              <input v-model="skyColor" type="color" @input="persistSkyColor" />
              <input v-model="skyColor" type="text" @input="persistSkyColor" />
            </span>
          </label>

          <div class="section-label">{{ t('director.stage.panoramaSphere') }}</div>
          <label class="uniform-row">
            {{ t('director.stage.panoramaYaw') }}
            <span class="uniform-control">
              <input v-model.number="panoramaYaw" type="range" min="-180" max="180" step="1" @input="persistPanoramaYaw" />
              <input v-model.number="panoramaYaw" v-number-scrub type="number" step="1" @input="persistPanoramaYaw" />
            </span>
          </label>
          <label class="uniform-row">
            {{ t('director.stage.panoramaRadius') }}
            <span class="uniform-control">
              <input v-model.number="panoramaRadius" type="range" min="10" max="1000" step="1" @input="persistPanoramaRadius" />
              <input v-model.number="panoramaRadius" v-number-scrub type="number" step="1" min="10" @input="persistPanoramaRadius" />
            </span>
          </label>

          <div class="section-label">{{ t('director.stage.sceneGlobal') }}</div>
          <label class="uniform-row">
            {{ t('director.stage.sceneScale') }}
            <span class="uniform-control">
              <input
                v-model.number="sceneScalePercent"
                type="range"
                min="1"
                max="500"
                step="1"
                @input="persistSceneWorld"
              />
              <input
                v-model.number="sceneScalePercent"
                v-number-scrub
                type="number"
                step="1"
                min="1"
                @input="persistSceneWorld"
              />
            </span>
          </label>
          <div class="section-label">{{ t('director.stage.sceneTranslation') }}</div>
          <div class="vec-row">
            <label>X <input v-model.number="scenePosX" v-number-scrub type="number" step="0.01" @input="persistSceneWorld" /></label>
            <label>Y <input v-model.number="scenePosY" v-number-scrub type="number" step="0.01" @input="persistSceneWorld" /></label>
            <label>Z <input v-model.number="scenePosZ" v-number-scrub type="number" step="0.01" @input="persistSceneWorld" /></label>
          </div>
          <div class="section-label">{{ t('director.stage.sceneRotation') }}</div>
          <div class="vec-row">
            <label>X <input v-model.number="sceneRotX" v-number-scrub type="number" step="0.1" @input="persistSceneWorld" /></label>
            <label>Y <input v-model.number="sceneRotY" v-number-scrub type="number" step="0.1" @input="persistSceneWorld" /></label>
            <label>Z <input v-model.number="sceneRotZ" v-number-scrub type="number" step="0.1" @input="persistSceneWorld" /></label>
          </div>

          <div class="section-label ground-label">
            <span>{{ t('director.stage.ground') }}</span>
            <button
              type="button"
              class="ground-switch"
              role="switch"
              :aria-checked="gridVisible"
              :title="t('director.stage.ground')"
              @click="toggleGridVisible"
            >
              <span class="ground-switch-thumb" />
            </button>
          </div>
          <label class="uniform-row" :class="{ disabled: !gridVisible }">
            {{ t('director.stage.groundOpacity') }}
            <span class="uniform-control">
              <input
                v-model.number="gridOpacity"
                type="range"
                min="0"
                max="1"
                step="0.01"
                :disabled="!gridVisible"
                @input="persistGround"
              />
              <input
                v-model.number="gridOpacity"
                v-number-scrub
                type="number"
                step="0.01"
                min="0"
                max="1"
                :disabled="!gridVisible"
                @input="persistGround"
              />
            </span>
          </label>
          <label class="uniform-row" :class="{ disabled: !gridVisible }">
            {{ t('director.stage.groundHeight') }}
            <span class="uniform-control">
              <input
                v-model.number="gridOffsetY"
                type="range"
                min="-10"
                max="10"
                step="0.1"
                :disabled="!gridVisible"
                @input="persistGround"
              />
              <input
                v-model.number="gridOffsetY"
                v-number-scrub
                type="number"
                step="0.1"
                :disabled="!gridVisible"
                @input="persistGround"
              />
            </span>
          </label>
        </div>
      </template>

      <template v-else-if="showPanoramaProps">
        <div class="fields">
          <div class="section-label">{{ t('director.stage.panoramaBackground') }}</div>
          <div
            class="panorama-drop"
            :class="{ active: panoramaDragOver, filled: !!linkedPanoramaName }"
            @dragenter.prevent="onPanoramaDragEnter"
            @dragover.prevent="onPanoramaDragOver"
            @dragleave="onPanoramaDragLeave"
            @drop.prevent="onPanoramaDrop"
          >
            <template v-if="linkedPanoramaName">
              <span class="panorama-drop-name" :title="linkedPanoramaName">{{ linkedPanoramaName }}</span>
              <button
                type="button"
                class="panorama-drop-remove"
                :title="t('director.stage.panoramaRemove')"
                @click.stop="clearLinkedPanorama"
              >
                ?
              </button>
            </template>
            <span v-else class="panorama-drop-hint">{{ t('director.stage.panoramaDropHint') }}</span>
          </div>
          <label class="color-row">
            {{ t('director.stage.skyColor') }}
            <span class="color-control">
              <input v-model="skyColor" type="color" @input="persistSkyColor" />
              <input v-model="skyColor" type="text" @input="persistSkyColor" />
            </span>
          </label>
          <div class="section-label">{{ t('director.stage.panoramaSphere') }}</div>
          <label class="uniform-row">
            {{ t('director.stage.panoramaYaw') }}
            <span class="uniform-control">
              <input v-model.number="panoramaYaw" type="range" min="-180" max="180" step="1" @input="persistPanoramaYaw" />
              <input v-model.number="panoramaYaw" v-number-scrub type="number" step="1" @input="persistPanoramaYaw" />
            </span>
          </label>
          <label class="uniform-row">
            {{ t('director.stage.panoramaRadius') }}
            <span class="uniform-control">
              <input v-model.number="panoramaRadius" type="range" min="10" max="1000" step="1" @input="persistPanoramaRadius" />
              <input v-model.number="panoramaRadius" v-number-scrub type="number" step="1" min="10" @input="persistPanoramaRadius" />
            </span>
          </label>
        </div>
      </template>

      <p v-else class="empty">{{ t('director.stage.selectHint') }}</p>
    </div>
  </aside>

  <SaveAssetDialog
    ref="savePoseAssetDialogRef"
    :open="savePoseAssetDialogOpen"
    :default-name="savePoseAssetDefaultName"
    :default-folder-id="savePoseAssetDefaultFolderId"
    @confirm="onSavePoseAssetConfirm"
    @cancel="closeSavePoseAssetDialog"
  />
</template>
<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import {
  createDefaultDirectorViewer,
  DEFAULT_DIRECTOR_CAMERA_FOV,
  DEFAULT_DIRECTOR_PANORAMA_RADIUS,
  DEFAULT_DIRECTOR_SKY_COLOR,
  isDirectorSkyFollowTheme,
  DEFAULT_GRID_OFFSET_Y,
  DEFAULT_GRID_OPACITY,
  DEFAULT_GRID_VISIBLE,
  directorAspectRatioValue,
  directorViewerRotationFromLook,
  MODEL_POSE_ICON,
  normalizeDirectorSkyColor,
  readDirectorSceneWorld,
  readModelAssetColor,
  isPoseModelAsset
} from '@shared/domain'
import { useStudioI18n } from '../composables/useStudioI18n'
import { vNumberScrub } from '../directives/numberScrub'
import { themePreference } from '../editor/preferences'
import { directorStageSceneKey } from '../features/director/stageSceneKey'
import { useProjectStore } from '../stores/project'
import {
  STUDIO_ASSET_DRAG_MIME,
  STUDIO_ASSET_ID_DRAG_MIME,
  STUDIO_ASSET_IDS_DRAG_MIME,
  useWorkspaceStore
} from '../stores/workspace'
import SaveAssetDialog from './SaveAssetDialog.vue'

withDefaults(
  defineProps<{
    /** ????????????????*/
    embedded?: boolean
  }>(),
  { embedded: false }
)

const { t } = useStudioI18n()
const scene = inject(directorStageSceneKey)!
const workspace = useWorkspaceStore()
const project = useProjectStore()
const previewCanvas = ref<HTMLCanvasElement | null>(null)
const panoramaDragOver = ref(false)

const posX = ref(0)
const posY = ref(0)
const posZ = ref(0)
const rotX = ref(0)
const rotY = ref(0)
const rotZ = ref(0)
const scaleX = ref(1)
const scaleY = ref(1)
const scaleZ = ref(1)
const fov = ref(DEFAULT_DIRECTOR_CAMERA_FOV)
const cameraName = ref('')
const isEditingViewer = ref(false)

const objPosX = ref(0)
const objPosY = ref(0)
const objPosZ = ref(0)
const objRotX = ref(0)
const objRotY = ref(0)
const objRotZ = ref(0)
const objScaleX = ref(1)
const objScaleY = ref(1)
const objScaleZ = ref(1)
const objName = ref('')
const objColor = ref('#ffffff')
const objUniformScale = ref(1)
const isEditingObject = ref(false)
const objectInspectorTab = ref<'props' | 'pose'>('props')

function defaultObjectColor(o: { kind: string; color?: string; modelAssetId?: string }): string {
  if (o.color) return o.color
  if (o.kind === 'model' && o.modelAssetId) {
    const asset = project.assets.find((a) => a.id === o.modelAssetId)
    const fromAsset = readModelAssetColor(asset?.genParams)
    if (fromAsset) return fromAsset
    return '#ffffff'
  }
  return '#4f8ef7'
}
const sceneScalePercent = ref(100)
const scenePosX = ref(0)
const scenePosY = ref(0)
const scenePosZ = ref(0)
const sceneRotX = ref(0)
const sceneRotY = ref(0)
const sceneRotZ = ref(0)
const skyColor = ref(DEFAULT_DIRECTOR_SKY_COLOR)
const panoramaYaw = ref(0)
const panoramaRadius = ref(DEFAULT_DIRECTOR_PANORAMA_RADIUS)
const gridVisible = ref(DEFAULT_GRID_VISIBLE)
const gridOpacity = ref(DEFAULT_GRID_OPACITY)
const gridOffsetY = ref(DEFAULT_GRID_OFFSET_Y)
const isEditingScene = ref(false)

const obj = computed(() => scene.selectedObject.value)
const showPoseTab = computed(() => {
  void scene.previewRevision.value
  return scene.objectSupportsPose(obj.value?.id ?? null)
})
const poseBoneNames = computed(() => {
  void scene.previewRevision.value
  const id = obj.value?.id
  if (!id || !showPoseTab.value) return [] as string[]
  return scene.listObjectBones(id)
})
const selectedPoseBone = computed(() => scene.selectedPoseBone.value)
const poseEditMode = computed(() => scene.poseEditMode.value)
const selectedIkChainId = computed(() => scene.selectedIkChainId.value)
const ikTargetSlots = computed(() => {
  void scene.previewRevision.value
  const id = obj.value?.id
  if (!id || !showPoseTab.value) return [] as ReturnType<typeof scene.listObjectIkTargetSlots>
  return scene.listObjectIkTargetSlots(id)
})
const poseDegCache = ref<Record<string, { x: number; y: number; z: number }>>({})
const activePoseAssetId = ref<string | null>(null)
const poseAssetApplyHint = ref('')
const poseAssetDragOver = ref(false)
const savingPoseAsset = ref(false)
const savePoseAssetDialogOpen = ref(false)
const savePoseAssetDefaultName = ref('')
const savePoseAssetDefaultFolderId = ref<string | null>(null)
const savePoseAssetDialogRef = ref<{
  setSaving: (value: boolean) => void
  setError: (message: string) => void
} | null>(null)
const poseAssetIcon = MODEL_POSE_ICON

const poseAssets = computed(() => {
  // ??????????????????
  void project.assets.length
  return scene.listPoseAssets()
})
const hasBonePose = computed(() => {
  const pose = obj.value?.bonePose
  return !!pose && Object.keys(pose).length > 0
})
const canSavePosePreset = computed(() => hasBonePose.value)

function poseDegFor(bone: string): { x: number; y: number; z: number } {
  return poseDegCache.value[bone] ?? { x: 0, y: 0, z: 0 }
}

function syncPoseDegCache(): void {
  const id = obj.value?.id
  if (!id || objectInspectorTab.value !== 'pose') {
    poseDegCache.value = {}
    return
  }
  const next: Record<string, { x: number; y: number; z: number }> = {}
  for (const bone of poseBoneNames.value) {
    next[bone] = scene.getObjectBonePoseDeg(id, bone)
  }
  poseDegCache.value = next
}

function setObjectInspectorTab(tab: 'props' | 'pose'): void {
  objectInspectorTab.value = tab
}

function onPoseBoneSelect(bone: string): void {
  scene.setSelectedPoseBone(scene.selectedPoseBone.value === bone ? null : bone)
}

function setPoseEditMode(mode: 'fk' | 'ik'): void {
  scene.setPoseEditMode(mode)
}

function onSelectIkChain(id: (typeof ikTargetSlots.value)[number]['id']): void {
  scene.setSelectedIkChain(scene.selectedIkChainId.value === id ? null : id)
}

function onIkEffectorChange(id: (typeof ikTargetSlots.value)[number]['id'], event: Event): void {
  const value = (event.target as HTMLSelectElement).value
  const ok = scene.setObjectIkChainEffector(obj.value?.id ?? '', id, value || null)
  if (!ok && value) {
    // ??????????????????????
    poseAssetApplyHint.value = t('director.stage.poseIkAssignFailed')
  } else {
    poseAssetApplyHint.value = ''
  }
}

function ikSlotLabel(id: (typeof ikTargetSlots.value)[number]['id']): string {
  const map: Record<(typeof ikTargetSlots.value)[number]['id'], string> = {
    slot1: t('director.stage.poseIkSlot1'),
    slot2: t('director.stage.poseIkSlot2'),
    slot3: t('director.stage.poseIkSlot3'),
    slot4: t('director.stage.poseIkSlot4')
  }
  return map[id]
}

const poseAxes = ['x', 'y', 'z'] as const

function onPoseBoneAxis(bone: string, axis: 'x' | 'y' | 'z', event: Event): void {
  const id = obj.value?.id
  if (!id) return
  const value = Number((event.target as HTMLInputElement).value)
  poseDegCache.value = {
    ...poseDegCache.value,
    [bone]: {
      ...poseDegFor(bone),
      [axis]: value
    }
  }
  activePoseAssetId.value = null
  scene.setObjectBonePoseDeg(id, bone, axis, value)
}

function resetPoseBoneAxis(bone: string, axis: 'x' | 'y' | 'z'): void {
  const id = obj.value?.id
  if (!id) return
  poseDegCache.value = {
    ...poseDegCache.value,
    [bone]: {
      ...poseDegFor(bone),
      [axis]: 0
    }
  }
  activePoseAssetId.value = null
  scene.setObjectBonePoseDeg(id, bone, axis, 0)
}

function onResetBonePose(): void {
  const id = obj.value?.id
  if (!id) return
  scene.resetObjectBonePose(id)
  activePoseAssetId.value = null
  poseAssetApplyHint.value = ''
  syncPoseDegCache()
}

function onApplyPoseAsset(assetId: string): void {
  const id = obj.value?.id
  if (!id) return
  const result = scene.applyPoseAssetToObject(id, assetId)
  if (!result) return
  activePoseAssetId.value = assetId
  poseAssetApplyHint.value = t('director.stage.poseAssetApplyHint', {
    matched: result.matched,
    total: result.total
  })
  syncPoseDegCache()
}

function openSavePoseAssetDialog(): void {
  if (!obj.value?.id || !canSavePosePreset.value || savingPoseAsset.value) return
  savePoseAssetDefaultName.value = `${t('director.stage.poseAssetDefault')} ${scene.listPoseAssets().length + 1}`
  const sourceId = obj.value.modelAssetId
  const source = sourceId ? project.assets.find((item) => item.id === sourceId) : null
  savePoseAssetDefaultFolderId.value = source?.folderId ?? null
  savePoseAssetDialogOpen.value = true
}

function closeSavePoseAssetDialog(): void {
  if (savingPoseAsset.value) return
  savePoseAssetDialogOpen.value = false
}

async function onSavePoseAssetConfirm(payload: {
  name: string
  folderId: string | null
}): Promise<void> {
  const id = obj.value?.id
  if (!id || !canSavePosePreset.value || savingPoseAsset.value) return
  savingPoseAsset.value = true
  savePoseAssetDialogRef.value?.setSaving(true)
  try {
    const asset = await scene.saveObjectPoseAsAsset(id, payload.name, payload.folderId)
    if (!asset) {
      savePoseAssetDialogRef.value?.setError(t('director.stage.poseAssetSaveFailed'))
      return
    }
    activePoseAssetId.value = asset.id
    poseAssetApplyHint.value = t('director.stage.poseAssetSaved', { name: asset.name })
    savePoseAssetDialogOpen.value = false
  } catch (e) {
    savePoseAssetDialogRef.value?.setError(
      e instanceof Error ? e.message : t('director.stage.poseAssetSaveFailed')
    )
  } finally {
    savingPoseAsset.value = false
  }
}

function onPoseAssetDragEnter(event: DragEvent): void {
  if (!isStudioAssetDrag(event)) return
  poseAssetDragOver.value = true
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
}

function onPoseAssetDragOver(event: DragEvent): void {
  if (!isStudioAssetDrag(event)) return
  poseAssetDragOver.value = true
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
}

function onPoseAssetDragLeave(event: DragEvent): void {
  const next = event.relatedTarget as Node | null
  const zone = event.currentTarget as HTMLElement | null
  if (next && zone?.contains(next)) return
  poseAssetDragOver.value = false
}

function onPoseAssetDrop(event: DragEvent): void {
  poseAssetDragOver.value = false
  const asset = workspace.resolveDraggedAsset(event)
  if (!asset || !isPoseModelAsset(asset)) return
  onApplyPoseAsset(asset.id)
}

function syncPoseSkeletonOverlay(): void {
  if (
    objectInspectorTab.value === 'pose' &&
    showPoseTab.value &&
    scene.selectionKind.value === 'object' &&
    obj.value?.id
  ) {
    scene.setPoseSkeletonVisible(obj.value.id)
  } else {
    scene.setPoseSkeletonVisible(null)
  }
}
const showSceneGlobal = computed(() => scene.selectionKind.value === 'scene')
const showPanoramaProps = computed(() => scene.selectionKind.value === 'panorama')
const selectionTypeLabel = computed(() => {
  switch (scene.selectionKind.value) {
    case 'camera':
      return t('director.stage.selectionType.camera')
    case 'object':
      return t('director.stage.selectionType.object')
    case 'panorama':
      return t('director.stage.selectionType.panorama')
    case 'scene':
      return t('director.stage.selectionType.scene')
    default:
      return t('director.stage.selectionType.none')
  }
})
const selectionIcon = computed(() => {
  switch (scene.selectionKind.value) {
    case 'camera':
      return 'CAM'
    case 'object':
      return 'OBJ'
    case 'panorama':
      return 'PAN'
    case 'scene':
      return 'SCN'
    default:
      return '--'
  }
})
const linkedPanoramaName = computed(() => {
  const id = scene.linkedPanoramaId.value
  if (!id) return ''
  return (
    project.assets.find((item) => item.id === id)?.name ??
    scene.inputPanoramaAssets.value.find((item) => item.id === id)?.name ??
    id
  )
})

function isPanoramaBackgroundAsset(type: string): boolean {
  return type === 'image'
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

function onPanoramaDragEnter(event: DragEvent): void {
  if (!isStudioAssetDrag(event)) return
  panoramaDragOver.value = true
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
}

function onPanoramaDragOver(event: DragEvent): void {
  if (!isStudioAssetDrag(event)) return
  panoramaDragOver.value = true
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
}

function onPanoramaDragLeave(event: DragEvent): void {
  const next = event.relatedTarget as Node | null
  const zone = event.currentTarget as HTMLElement | null
  if (next && zone?.contains(next)) return
  panoramaDragOver.value = false
}

function onPanoramaDrop(event: DragEvent): void {
  panoramaDragOver.value = false
  const asset = workspace.resolveDraggedAsset(event)
  if (!asset || !isPanoramaBackgroundAsset(asset.type)) return
  // ?????????????????relativePath
  const latest = project.assets.find((item) => item.id === asset.id) ?? asset
  scene.linkedPanoramaId.value = latest.id
  scene.onScenePick()
}

function clearLinkedPanorama(): void {
  scene.linkedPanoramaId.value = null
  scene.onScenePick()
}

const selectedCamera = computed(() =>
  scene.selectionKind.value === 'camera' && scene.selectedCameraId.value
    ? scene.stage.value.cameras?.find((camera) => camera.id === scene.selectedCameraId.value) ??
      null
    : null
)
const cameraLocked = computed(() => selectedCamera.value?.locked === true)
const cameraTitle = computed(
  () => selectedCamera.value?.name ?? t('director.stage.cameraItem')
)
const editingKeyframeHint = computed(() => {
  if (scene.stageEditMode.value !== 'animation') return ''
  const selected = scene.getSelectedAnimKeyframe()
  if (!selected) return ''
  const matchesCamera =
    scene.selectionKind.value === 'camera' &&
    selected.track.targetKind === 'camera' &&
    selected.track.targetId === scene.selectedCameraId.value
  const matchesObject =
    scene.selectionKind.value === 'object' &&
    selected.track.targetKind === 'object' &&
    selected.track.targetId === scene.selectedObjectId.value
  if (!matchesCamera && !matchesObject) return ''
  const time = Number(selected.keyframe.time.toFixed(2))
  return t('director.stage.anim.editingKeyframe', { time })
})
const viewer = computed(
  () => selectedCamera.value?.viewer ?? scene.getViewer() ?? createDefaultDirectorViewer()
)
const showCameraPreview = computed(
  () => scene.selectionKind.value === 'camera' || scene.viewMode.value === 'camera'
)

/** ?????????????Auto ?? 16:9??*/
const previewAspectCss = computed(() => {
  const ratio = scene.aspectRatio.value
  if (ratio === 'auto') return '16 / 9'
  const [w, h] = ratio.split(':')
  return `${w} / ${h}`
})

const previewAspectValue = computed(() => {
  const ratio = scene.aspectRatio.value
  if (ratio === 'auto') return 16 / 9
  return directorAspectRatioValue(ratio, 16, 9)
})

function radToDeg(n: number): number {
  return Number(((n * 180) / Math.PI).toFixed(2))
}
function degToRad(n: number): number {
  return (n * Math.PI) / 180
}

function finiteInput(value: unknown, fallback: number): number {
  if (typeof value === 'string' && value.trim() === '') return fallback
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function fillViewerLocals(): void {
  if (isEditingViewer.value) return
  const kfSel = scene.getSelectedAnimKeyframe()
  if (
    kfSel &&
    kfSel.track.targetKind === 'camera' &&
    selectedCamera.value?.id === kfSel.track.targetId
  ) {
    const kf = kfSel.keyframe
    const v = viewer.value
    const rotation =
      kf.rotation ?? directorViewerRotationFromLook(kf.position, v.target)
    posX.value = kf.position.x
    posY.value = kf.position.y
    posZ.value = kf.position.z
    rotX.value = radToDeg(rotation.x)
    rotY.value = radToDeg(rotation.y)
    rotZ.value = radToDeg(rotation.z)
    scaleX.value = kf.scale?.x ?? v.scale?.x ?? 1
    scaleY.value = kf.scale?.y ?? v.scale?.y ?? 1
    scaleZ.value = kf.scale?.z ?? v.scale?.z ?? 1
    fov.value = v.fov ?? DEFAULT_DIRECTOR_CAMERA_FOV
    cameraName.value = cameraTitle.value
    return
  }
  const v = viewer.value
  const rotation = v.rotation ?? directorViewerRotationFromLook(v.position, v.target)
  posX.value = v.position.x
  posY.value = v.position.y
  posZ.value = v.position.z
  rotX.value = radToDeg(rotation.x)
  rotY.value = radToDeg(rotation.y)
  rotZ.value = radToDeg(rotation.z)
  scaleX.value = v.scale?.x ?? 1
  scaleY.value = v.scale?.y ?? 1
  scaleZ.value = v.scale?.z ?? 1
  fov.value = v.fov ?? DEFAULT_DIRECTOR_CAMERA_FOV
  cameraName.value = cameraTitle.value
}

function persistCameraName(): void {
  const next = cameraName.value.trim() || t('director.stage.cameraItem')
  cameraName.value = next
  if (selectedCamera.value) scene.updateObjectTransform(selectedCamera.value.id, { name: next })
}

function fillObjectLocals(): void {
  if (isEditingObject.value) return
  const o = obj.value
  if (!o) return
  const kfSel = scene.getSelectedAnimKeyframe()
  if (
    kfSel &&
    kfSel.track.targetKind === 'object' &&
    o.id === kfSel.track.targetId
  ) {
    const kf = kfSel.keyframe
    objPosX.value = kf.position.x
    objPosY.value = kf.position.y
    objPosZ.value = kf.position.z
    objRotX.value = radToDeg((kf.rotation ?? o.rotation).x)
    objRotY.value = radToDeg((kf.rotation ?? o.rotation).y)
    objRotZ.value = radToDeg((kf.rotation ?? o.rotation).z)
    objScaleX.value = kf.scale?.x ?? o.scale.x
    objScaleY.value = kf.scale?.y ?? o.scale.y
    objScaleZ.value = kf.scale?.z ?? o.scale.z
    objName.value = o.name
    objColor.value = defaultObjectColor(o)
    objUniformScale.value = Number(
      (
        ((kf.scale?.x ?? o.scale.x) +
          (kf.scale?.y ?? o.scale.y) +
          (kf.scale?.z ?? o.scale.z)) /
        3
      ).toFixed(3)
    )
    return
  }
  objPosX.value = o.position.x
  objPosY.value = o.position.y
  objPosZ.value = o.position.z
  objRotX.value = radToDeg(o.rotation.x)
  objRotY.value = radToDeg(o.rotation.y)
  objRotZ.value = radToDeg(o.rotation.z)
  objScaleX.value = o.scale.x
  objScaleY.value = o.scale.y
  objScaleZ.value = o.scale.z
  objName.value = o.name
  objColor.value = defaultObjectColor(o)
  objUniformScale.value = Number(((o.scale.x + o.scale.y + o.scale.z) / 3).toFixed(3))
}

function persistViewer(): void {
  if (cameraLocked.value) return
  const current = viewer.value
  const currentRotation =
    current.rotation ?? directorViewerRotationFromLook(current.position, current.target)
  const next = {
    position: {
      x: finiteInput(posX.value, current.position.x),
      y: finiteInput(posY.value, current.position.y),
      z: finiteInput(posZ.value, current.position.z)
    },
    rotation: {
      x: degToRad(finiteInput(rotX.value, radToDeg(currentRotation.x))),
      y: degToRad(finiteInput(rotY.value, radToDeg(currentRotation.y))),
      z: degToRad(finiteInput(rotZ.value, radToDeg(currentRotation.z)))
    },
    scale: {
      x: Math.max(0.001, finiteInput(scaleX.value, current.scale?.x ?? 1)),
      y: Math.max(0.001, finiteInput(scaleY.value, current.scale?.y ?? 1)),
      z: Math.max(0.001, finiteInput(scaleZ.value, current.scale?.z ?? 1))
    },
    target: current.target,
    fov: Math.min(
      100,
      Math.max(20, finiteInput(fov.value, current.fov ?? DEFAULT_DIRECTOR_CAMERA_FOV))
    )
  }
  scene.setViewer(next)
}

function onViewerFocusOut(event: FocusEvent): void {
  const container = event.currentTarget as HTMLElement | null
  if (container?.contains(event.relatedTarget as Node | null)) return
  isEditingViewer.value = false
  fillViewerLocals()
}

function onObjectFocusOut(event: FocusEvent): void {
  const container = event.currentTarget as HTMLElement | null
  if (container?.contains(event.relatedTarget as Node | null)) return
  isEditingObject.value = false
  fillObjectLocals()
}

function persistObject(): void {
  const o = obj.value
  if (!o) return
  const name = objName.value.trim() || o.name
  const color = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(objColor.value)
    ? objColor.value
    : defaultObjectColor(o)
  scene.updateObjectTransform(o.id, {
    name,
    color,
    position: {
      x: finiteInput(objPosX.value, o.position.x),
      y: finiteInput(objPosY.value, o.position.y),
      z: finiteInput(objPosZ.value, o.position.z)
    },
    rotation: {
      x: degToRad(finiteInput(objRotX.value, radToDeg(o.rotation.x))),
      y: degToRad(finiteInput(objRotY.value, radToDeg(o.rotation.y))),
      z: degToRad(finiteInput(objRotZ.value, radToDeg(o.rotation.z)))
    },
    scale: {
      x: Math.max(0.001, finiteInput(objScaleX.value, o.scale.x)),
      y: Math.max(0.001, finiteInput(objScaleY.value, o.scale.y)),
      z: Math.max(0.001, finiteInput(objScaleZ.value, o.scale.z))
    }
  })
}

function applyUniformScale(): void {
  const o = obj.value
  if (!o) return
  const value = Math.max(0.01, finiteInput(objUniformScale.value, 1))
  objScaleX.value = value
  objScaleY.value = value
  objScaleZ.value = value
  persistObject()
}

function fillSceneLocals(): void {
  if (isEditingScene.value) return
  const world = readDirectorSceneWorld(scene.stage.value.world)
  sceneScalePercent.value = world.scalePercent
  scenePosX.value = world.position.x
  scenePosY.value = world.position.y
  scenePosZ.value = world.position.z
  sceneRotX.value = radToDeg(world.rotation.x)
  sceneRotY.value = radToDeg(world.rotation.y)
  sceneRotZ.value = radToDeg(world.rotation.z)
  skyColor.value = resolveSkyColorForUi(scene.stage.value.skyColor)
  panoramaYaw.value =
    typeof scene.stage.value.panoramaYaw === 'number' ? scene.stage.value.panoramaYaw : 0
  panoramaRadius.value =
    typeof scene.stage.value.panoramaRadius === 'number'
      ? scene.stage.value.panoramaRadius
      : DEFAULT_DIRECTOR_PANORAMA_RADIUS
  gridVisible.value = scene.stage.value.gridVisible !== false
  gridOpacity.value =
    typeof scene.stage.value.gridOpacity === 'number'
      ? scene.stage.value.gridOpacity
      : DEFAULT_GRID_OPACITY
  gridOffsetY.value =
    typeof scene.stage.value.gridOffsetY === 'number'
      ? scene.stage.value.gridOffsetY
      : DEFAULT_GRID_OFFSET_Y
}

function persistSceneWorld(): void {
  const world = readDirectorSceneWorld(scene.stage.value.world)
  scene.updateSceneWorld({
    scalePercent: finiteInput(sceneScalePercent.value, world.scalePercent),
    position: {
      x: finiteInput(scenePosX.value, world.position.x),
      y: finiteInput(scenePosY.value, world.position.y),
      z: finiteInput(scenePosZ.value, world.position.z)
    },
    rotation: {
      x: degToRad(finiteInput(sceneRotX.value, radToDeg(world.rotation.x))),
      y: degToRad(finiteInput(sceneRotY.value, radToDeg(world.rotation.y))),
      z: degToRad(finiteInput(sceneRotZ.value, radToDeg(world.rotation.z)))
    }
  })
}

function persistGround(): void {
  scene.updateGround({
    visible: gridVisible.value,
    opacity: finiteInput(gridOpacity.value, DEFAULT_GRID_OPACITY),
    offsetY: finiteInput(gridOffsetY.value, DEFAULT_GRID_OFFSET_Y)
  })
}

function toggleGridVisible(): void {
  gridVisible.value = !gridVisible.value
  persistGround()
}

function resolveSkyColorForUi(raw: unknown): string {
  if (!isDirectorSkyFollowTheme(raw)) return normalizeDirectorSkyColor(raw)
  if (typeof document === 'undefined') return DEFAULT_DIRECTOR_SKY_COLOR
  const themeSky = getComputedStyle(document.documentElement)
    .getPropertyValue('--director-sky')
    .trim()
  if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(themeSky)) return themeSky
  return DEFAULT_DIRECTOR_SKY_COLOR
}

function persistSkyColor(): void {
  scene.updateSkyColor(skyColor.value)
}

function persistPanoramaYaw(): void {
  scene.updatePanoramaYaw(finiteInput(panoramaYaw.value, 0))
}

function persistPanoramaRadius(): void {
  scene.updatePanoramaRadius(
    finiteInput(panoramaRadius.value, DEFAULT_DIRECTOR_PANORAMA_RADIUS)
  )
}

watch(viewer, fillViewerLocals, { immediate: true, deep: true })
watch(cameraTitle, (name) => {
  if (isEditingViewer.value) return
  cameraName.value = name
})
watch(obj, fillObjectLocals, { deep: true, immediate: true })
watch(
  () => obj.value?.id,
  () => {
    objectInspectorTab.value = 'props'
    activePoseAssetId.value = null
    poseAssetApplyHint.value = ''
    savePoseAssetDialogOpen.value = false
  }
)
watch(
  [objectInspectorTab, showPoseTab, () => obj.value?.id, () => scene.selectionKind.value, () => scene.previewRevision.value],
  () => {
    if (!showPoseTab.value && objectInspectorTab.value === 'pose') {
      objectInspectorTab.value = 'props'
    }
    syncPoseSkeletonOverlay()
    syncPoseDegCache()
  },
  { immediate: true }
)
watch(
  () => obj.value?.bonePose,
  () => syncPoseDegCache(),
  { deep: true }
)
watch(selectedPoseBone, async (name) => {
  if (!name || objectInspectorTab.value !== 'pose') return
  await nextTick()
  const el = document.querySelector('.pose-bone.active') as HTMLElement | null
  el?.scrollIntoView({ block: 'nearest' })
})
watch(
  () => [
    scene.stage.value.world,
    scene.stage.value.skyColor,
    scene.stage.value.panoramaYaw,
    scene.stage.value.panoramaRadius,
    scene.stage.value.gridVisible,
    scene.stage.value.gridOpacity,
    scene.stage.value.gridOffsetY
  ],
  () => fillSceneLocals(),
  { deep: true, immediate: true }
)
watch(themePreference, () => {
  fillSceneLocals()
  schedulePreviewRender()
})
watch(
  () => [
    scene.selectionKind.value,
    scene.selectedObjectId.value,
    scene.selectedCameraId.value,
    scene.animSelectedKeyframeId.value,
    scene.animSelectedTrackId.value,
    scene.previewRevision.value
  ],
  () => {
    isEditingObject.value = false
    isEditingViewer.value = false
    isEditingScene.value = false
    fillObjectLocals()
    fillViewerLocals()
    fillSceneLocals()
    schedulePreviewRender()
  }
)

let previewRaf = 0
let previewResizeObserver: ResizeObserver | null = null

function disposePreview(): void {
  cancelAnimationFrame(previewRaf)
  previewRaf = 0
  previewResizeObserver?.disconnect()
  previewResizeObserver = null
}

function renderPreview(): void {
  const canvas = previewCanvas.value
  if (!canvas || !showCameraPreview.value) return
  scene.renderCameraPreviewToCanvas(canvas, viewer.value, previewAspectValue.value)
}

function schedulePreviewRender(): void {
  cancelAnimationFrame(previewRaf)
  previewRaf = requestAnimationFrame(() => {
    previewRaf = 0
    renderPreview()
  })
}

function ensurePreview(): void {
  const canvas = previewCanvas.value
  if (!canvas) return
  if (!previewResizeObserver) {
    previewResizeObserver = new ResizeObserver(schedulePreviewRender)
    previewResizeObserver.observe(canvas)
  }
  schedulePreviewRender()
}

watch(
  () => [
    showCameraPreview.value,
    previewCanvas.value,
    scene.previewRevision.value,
    scene.selectedCameraId.value,
    scene.aspectRatio.value,
    viewer.value?.position.x,
    viewer.value?.position.y,
    viewer.value?.position.z,
    viewer.value?.rotation?.x,
    viewer.value?.rotation?.y,
    viewer.value?.rotation?.z,
    viewer.value?.fov
  ],
  async (values) => {
    const show = values[0]
    if (!show) {
      disposePreview()
      return
    }
    await Promise.resolve()
    ensurePreview()
    schedulePreviewRender()
  },
  { flush: 'post' }
)

onBeforeUnmount(() => {
  scene.setPoseSkeletonVisible(null)
  disposePreview()
})
</script>

<style scoped>
.inspector {
  display: flex;
  flex-direction: column;
  width: 280px;
  min-width: 240px;
  height: 100%;
  min-height: 0;
  border-left: 1px solid var(--border);
  background: var(--bg-panel);
  flex-shrink: 0;
  overflow: hidden;
}

.inspector.embedded {
  width: 100%;
  min-width: 0;
  border-left: none;
  background: transparent;
  flex-shrink: 1;
}

.body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  flex-shrink: 0;
}

.head h2 {
  margin: 2px 0 0;
  font-size: 14px;
  color: var(--text);
}

.type {
  font-size: 11px;
  color: var(--text-muted);
  letter-spacing: 0.04em;
}

.icon {
  font-size: 20px;
  line-height: 1;
}

.section-label {
  font-size: 11px;
  color: var(--text-muted);
  letter-spacing: 0.04em;
  margin-top: 2px;
}

.object-tabs {
  display: flex;
  gap: 4px;
  padding: 2px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--border) 35%, transparent);
  flex-shrink: 0;
}

.object-tab {
  flex: 1;
  height: 28px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  font-size: 12px;
  cursor: pointer;
}

.object-tab.active {
  background: color-mix(in srgb, var(--bg-elevated) 92%, white 8%);
  color: var(--text);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--border) 70%, transparent);
}

.pose-hint {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-muted);
}

.pose-mode-tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 8px;
}

.pose-mode-tab {
  flex: 1;
  padding: 5px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  font-size: 12px;
  cursor: pointer;
}

.pose-mode-tab.active {
  color: var(--text);
  border-color: var(--accent, #3b82f6);
  background: color-mix(in srgb, var(--accent, #3b82f6) 16%, transparent);
}

.pose-mode-tab:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.pose-ik-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 8px;
}

.pose-ik-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.pose-ik-chip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 7px 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: transparent;
  color: var(--text);
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}

.pose-ik-chip.active {
  border-color: #ff6b4a;
  background: color-mix(in srgb, #ff6b4a 14%, transparent);
}

.pose-ik-chip:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.pose-ik-badge {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 999px;
  color: #ff6b4a;
  border: 1px solid color-mix(in srgb, #ff6b4a 50%, transparent);
}

.pose-ik-select {
  width: 100%;
  padding: 5px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-panel, transparent);
  color: var(--text);
  font-size: 12px;
}

.pose-ik-meta {
  color: var(--text-muted);
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 55%;
}

.pose-panel {
  min-height: 0;
}

.pose-asset-bar {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px;
  border-radius: 8px;
  border: 1px dashed color-mix(in srgb, var(--border) 80%, transparent);
}

.pose-asset-bar.asset-drag-over {
  border-color: color-mix(in srgb, #2ee6ff 55%, var(--border));
  background: color-mix(in srgb, #2ee6ff 8%, transparent);
}

.pose-asset-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border-radius: 6px;
  border: 1px solid color-mix(in srgb, var(--border) 80%, transparent);
  background: color-mix(in srgb, var(--bg-elevated) 55%, transparent);
  color: var(--text);
  font-size: 12px;
  padding: 5px 8px;
  cursor: pointer;
  max-width: 100%;
}

.pose-asset-chip.active {
  border-color: color-mix(in srgb, #2ee6ff 55%, var(--border));
  box-shadow: 0 0 0 1px color-mix(in srgb, #2ee6ff 35%, transparent);
}

.pose-asset-chip:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.pose-asset-icon {
  flex-shrink: 0;
}

.pose-asset-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pose-preset-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.pose-preset-save-btn:disabled,
.pose-preset-reset-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.pose-preset-save-btn,
.pose-preset-reset-btn {
  height: 28px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: color-mix(in srgb, var(--bg-elevated) 80%, transparent);
  color: var(--text);
  font-size: 12px;
  padding: 0 10px;
  cursor: pointer;
}

.pose-preset-save-btn:hover:not(:disabled),
.pose-preset-reset-btn:hover:not(:disabled) {
  background: color-mix(in srgb, var(--bg-elevated) 92%, white 8%);
}

.pose-asset-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}

.pose-bone-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.pose-bone {
  padding: 8px;
  border-radius: 8px;
  border: 1px solid color-mix(in srgb, var(--border) 80%, transparent);
  background: color-mix(in srgb, var(--bg-elevated) 55%, transparent);
  cursor: pointer;
}

.pose-bone.active {
  border-color: color-mix(in srgb, #2ee6ff 55%, var(--border));
  box-shadow: 0 0 0 1px color-mix(in srgb, #2ee6ff 35%, transparent);
}

.pose-bone-name {
  font-size: 11px;
  color: var(--text);
  margin-bottom: 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pose-bone-sliders {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.pose-axis {
  display: grid;
  grid-template-columns: 12px 1fr 42px 18px;
  gap: 6px;
  align-items: center;
  font-size: 11px;
  color: var(--text-muted);
}

.pose-axis input[type='range'] {
  width: 100%;
  min-width: 0;
}

.pose-axis span {
  text-align: right;
  font-variant-numeric: tabular-nums;
  color: var(--text);
}

.pose-axis-reset {
  width: 18px;
  height: 18px;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: transparent;
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.pose-axis-reset:hover:not(:disabled) {
  color: var(--text);
  border-color: color-mix(in srgb, var(--border) 50%, var(--text-muted));
  background: color-mix(in srgb, var(--bg-panel) 80%, #fff 6%);
}

.pose-axis-reset:disabled {
  opacity: 0.35;
  cursor: default;
}

.fields {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.camera-preview {
  position: relative;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid var(--border);
  background: var(--graph-preview-bg);
  width: 100%;
  flex-shrink: 0;
}

.camera-preview canvas {
  display: block;
  width: 100%;
  height: 100%;
}

.locked-hint,
.keyframe-hint {
  margin: 0;
  padding: 6px 8px;
  border-radius: 4px;
  font-size: 11px;
}

.locked-hint {
  background: rgba(240, 198, 116, 0.12);
  color: #f0c674;
}

.keyframe-hint {
  background: rgba(79, 142, 247, 0.14);
  color: #8bb6ff;
}

.fov {
  position: absolute;
  left: 8px;
  bottom: 6px;
  font-size: 11px;
  color: #fff;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
}

.vec-row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
}

.vec-row.disabled {
  opacity: 0.55;
}

.vec-row label {
  gap: 2px;
}

label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 11px;
  color: var(--text-muted);
}

input[type='number'],
input[type='text'],
input:not([type]) {
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  height: 28px;
  padding: 0 8px;
  border-radius: 4px;
  border: 1px solid var(--border);
  background: var(--bg-input);
  color: var(--text);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  line-height: 28px;
  outline: none;
}

input[type='number'] {
  padding-right: 0;
}

input[type='number']::-webkit-inner-spin-button,
input[type='number']::-webkit-outer-spin-button {
  -webkit-appearance: none;
  appearance: none;
  width: 16px;
  height: 24px;
  margin: 2px 2px 2px 0;
  border-radius: 3px;
  border: 1px solid var(--border);
  background-color: var(--number-spin-bg);
  background-image: var(--number-spin-icon);
  background-repeat: no-repeat;
  background-position: center;
  background-size: 10px 16px;
  opacity: 0.95;
  cursor: pointer;
}

input[type='number']::-webkit-inner-spin-button:hover,
input[type='number']::-webkit-outer-spin-button:hover {
  background-color: var(--number-spin-bg-hover);
  background-image: var(--number-spin-icon-hover);
}

input[type='number']:hover,
input[type='text']:hover,
input:not([type]):hover {
  border-color: color-mix(in srgb, var(--border) 60%, var(--text-muted));
}

input[type='number']:focus,
input[type='text']:focus,
input:not([type]):focus {
  border-color: var(--accent, #5b8def);
}

.fov-row {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 8px;
}

.uniform-row {
  display: grid;
  grid-template-columns: auto 1fr;
  align-items: center;
  gap: 8px;
}

.uniform-row.disabled {
  opacity: 0.45;
  pointer-events: none;
}

.ground-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.ground-switch {
  position: relative;
  width: 34px;
  height: 18px;
  padding: 0;
  border: none;
  border-radius: 999px;
  background: color-mix(in srgb, var(--text-muted) 35%, #2a2e34);
  cursor: pointer;
  flex-shrink: 0;
  transition: background 0.15s ease;
}

.ground-switch[aria-checked='true'] {
  background: var(--accent, #5b8def);
}

.ground-switch-thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.35);
  transition: transform 0.15s ease;
}

.ground-switch[aria-checked='true'] .ground-switch-thumb {
  transform: translateX(16px);
}

.uniform-control {
  display: grid;
  grid-template-columns: 1fr 64px;
  align-items: center;
  gap: 8px;
}

.uniform-control input[type='range'],
.fov-row input[type='range'] {
  width: 100%;
  min-width: 0;
  height: 28px;
  margin: 0;
  padding: 0;
  border: none;
  background: transparent;
  accent-color: var(--accent, #5b8def);
  cursor: pointer;
}

.color-row {
  display: grid;
  grid-template-columns: auto 1fr;
  align-items: center;
  gap: 8px;
}

.color-control {
  display: grid;
  grid-template-columns: 32px 1fr;
  align-items: center;
  gap: 8px;
}

.color-control input[type='color'] {
  width: 32px;
  height: 28px;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: transparent;
  cursor: pointer;
}

.panorama-drop {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 36px;
  padding: 8px 10px;
  border: 1px dashed var(--border);
  border-radius: 6px;
  background: var(--bg-input);
  box-sizing: border-box;
}

.panorama-drop.active {
  border-color: var(--accent, #5b8def);
  background: color-mix(in srgb, var(--accent, #5b8def) 12%, transparent);
}

.panorama-drop.filled {
  border-style: solid;
}

.panorama-drop-hint {
  color: var(--text-muted);
  font-size: 11px;
  line-height: 1.4;
}

.panorama-drop-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: var(--text);
}

.panorama-drop-remove {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: transparent;
  color: var(--text-muted);
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
}

.panorama-drop-remove:hover {
  color: var(--text);
  border-color: color-mix(in srgb, var(--border) 60%, var(--text-muted));
}

.empty {
  color: var(--text-muted);
  font-size: 12px;
  text-align: center;
  margin: 24px 0;
}
</style>
