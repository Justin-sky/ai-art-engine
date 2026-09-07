<template>
  <StudioFloatingWindow
    :open="open"
    :title="t('stage2d.title')"
    :z-index="1200"
    :default-width="1180"
    :default-height="760"
    :min-width="880"
    :min-height="560"
    body-class="pad-none stage2d-body"
    @close="emit('close')"
  >
    <div
      v-if="open"
      class="stage2d"
    >
      <section class="pane layers-pane">
        <div class="tabs">
          <button
            type="button"
            class="tab"
            :class="{ on: tab === 'layers' }"
            @click="tab = 'layers'"
          >
            {{ t('stage2d.tabLayers') }}
          </button>
          <button
            type="button"
            class="tab"
            :class="{ on: tab === 'rig' }"
            @click="tab = 'rig'"
          >
            {{ t('stage2d.tabRig') }}
          </button>
        </div>

        <template v-if="tab === 'layers'">
          <ul class="layers">
            <li
              v-for="(layer, index) in layers"
              :key="layer.id"
              class="layer"
              :class="{ active: layer.id === selectedId, hidden: !layer.visible }"
              @click="selectedId = layer.id"
            >
              <img
                v-if="thumbUrls[layer.id]"
                :src="thumbUrls[layer.id]"
                alt=""
              >
              <span
                v-else
                class="thumb-fallback"
              >🖼</span>
              <span
                class="name"
                :title="layer.sourceUrl"
              >{{ layer.name }}</span>
              <button
                type="button"
                class="icon"
                :title="t('stage2d.moveUp')"
                :disabled="index === 0"
                @click.stop="move(layer.id, -1)"
              >
                ↑
              </button>
              <button
                type="button"
                class="icon"
                :title="t('stage2d.moveDown')"
                :disabled="index === layers.length - 1"
                @click.stop="move(layer.id, 1)"
              >
                ↓
              </button>
              <button
                type="button"
                class="icon"
                :title="layer.visible ? t('stage2d.hide') : t('stage2d.show')"
                @click.stop="toggleVisible(layer.id)"
              >
                {{ layer.visible ? '👁' : '⃝' }}
              </button>
              <button
                type="button"
                class="icon danger"
                :title="t('stage2d.remove')"
                @click.stop="remove(layer.id)"
              >
                ✕
              </button>
            </li>
          </ul>
          <p
            v-if="!layers.length"
            class="hint"
          >
            {{ t('stage2d.noLayer') }}
          </p>
          <button
            type="button"
            class="primary"
            @click="pickerOpen = true"
          >
            {{ t('stage2d.addLayer') }}
          </button>
        </template>

        <template v-else>
          <div class="rig-toolbar">
            <button
              type="button"
              class="primary"
              :title="t('stage2d.rigTemplateTip')"
              @click="useHumanoidTemplate"
            >
              {{ t('stage2d.rigTemplate') }}
            </button>
            <button
              type="button"
              class="primary"
              :title="t('stage2d.rigFromImageTip')"
              @click="poseDialogOpen = true"
            >
              {{ t('stage2d.rigFromImage') }}
            </button>
          </div>
          <div class="section-label">
            {{ t('stage2d.joints') }}
          </div>
          <ul class="layers">
            <li
              v-for="joint in rig.joints"
              :key="joint.id"
              class="layer"
              :class="{ active: joint.id === selectedJointId }"
              @click="selectedJointId = joint.id"
            >
              <span class="thumb-fallback">●</span>
              <span
                class="name"
                :title="joint.id"
              >
                {{ joint.name }}
                <small v-if="joint.parentId">→ {{ jointName(joint.parentId) }}</small>
              </span>
              <button
                type="button"
                class="icon danger"
                :title="t('stage2d.removeJoint')"
                @click.stop="removeJoint(joint.id)"
              >
                ✕
              </button>
            </li>
          </ul>
          <p
            v-if="!rig.joints.length"
            class="hint"
          >
            {{ t('stage2d.noJoint') }}
          </p>
          <button
            type="button"
            class="primary"
            @click="addJoint"
          >
            ＋ {{ t('stage2d.addJoint') }}
          </button>

          <div class="section-label">
            {{ t('stage2d.actionTitle') }}
          </div>
          <p
            v-if="!rig.joints.length"
            class="hint"
          >
            {{ t('stage2d.actionNoRig') }}
          </p>
          <div
            v-else
            class="action-player"
          >
            <label class="field">
              <span>{{ t('stage2d.actionPick') }}</span>
              <select
                :value="actionId"
                @change="onActionPick($event)"
              >
                <option value="">
                  {{ t('stage2d.actionNone') }}
                </option>
                <option
                  v-if="customAction"
                  :value="CUSTOM_ACTION_ID"
                >
                  {{ actionLabel(CUSTOM_ACTION_ID) }}
                </option>
                <option
                  v-for="item in actionPresets"
                  :key="item.id"
                  :value="item.id"
                >
                  {{ actionLabel(item.id) }}
                </option>
              </select>
            </label>
            <div class="row action-controls">
              <button
                type="button"
                class="primary"
                :disabled="!actionCurrent"
                @click="toggleActionPlay"
              >
                {{
                  actionMode === 'playing'
                    ? t('stage2d.actionPause')
                    : t('stage2d.actionPlay')
                }}
              </button>
              <button
                type="button"
                class="icon"
                :disabled="actionMode === 'off'"
                :title="t('stage2d.actionStopTip')"
                @click="stopActionPlayback"
              >
                ■
              </button>
              <button
                type="button"
                class="icon"
                :disabled="actionMode === 'off'"
                :title="t('stage2d.actionFreezeTip')"
                @click="freezeActionFrame"
              >
                {{ t('stage2d.actionFreeze') }}
              </button>
            </div>
            <button
              type="button"
              class="action-video-btn"
              @click="openVideoActionDialog"
            >
              🎬 {{ t('stage2dVideo.actionFromVideo') }}
            </button>
            <div class="row asset-action-row">
              <button
                type="button"
                class="icon"
                :disabled="!actionCurrent || assetActionBusy"
                :title="t('stage2d.actionSaveAsset')"
                @click="beginSaveActionAsset"
              >
                💾 {{ t('stage2d.actionSaveAsset') }}
              </button>
              <button
                type="button"
                class="icon"
                :disabled="assetActionBusy"
                :title="t('stage2d.actionLoadAsset')"
                @click="toggleLoadActionAsset"
              >
                📥 {{ t('stage2d.actionLoadAsset') }}
              </button>
            </div>
            <select
              v-if="assetLoadPickerOpen"
              class="asset-pick-select"
              :value="motionLoadSel"
              @change="onMotionLoadChange"
            >
              <option value="">
                {{
                  motionAssets.length
                    ? t('stage2d.actionLoadPickHint')
                    : t('stage2d.actionLoadEmpty')
                }}
              </option>
              <option
                v-for="item in motionAssets"
                :key="item.id"
                :value="item.id"
              >
                {{ item.name }}
              </option>
            </select>
            <div
              v-if="assetActionSavingOpen"
              class="row asset-save-row"
            >
              <label class="field">
                <span>{{ t('stage2d.actionAssetName') }}</span>
                <input
                  v-model="assetActionName"
                  type="text"
                  :disabled="assetActionBusy"
                  @keydown.enter="confirmSaveActionAsset"
                >
              </label>
              <button
                type="button"
                class="primary"
                :disabled="assetActionBusy || !assetActionName.trim()"
                @click="confirmSaveActionAsset"
              >
                {{ t('stage2d.actionAssetConfirm') }}
              </button>
            </div>
            <p
              v-if="assetActionMsg"
              class="asset-action-msg"
              :class="`kind-${assetActionMsgKind}`"
            >
              {{ assetActionMsg }}
            </p>
            <p
              v-if="actionMode !== 'off' && actionCurrent"
              class="action-status"
            >
              {{ actionLabel(actionCurrent.id) }} ·
              {{
                t('stage2d.actionStatus', {
                  now: formatActionTime(actionClock),
                  total: formatActionTime(actionCurrent.duration ?? 0)
                })
              }}
              <span v-if="actionMode === 'paused'">
                · {{ t('stage2d.actionPaused') }}
              </span>
            </p>
          </div>

          <div class="section-label">
            {{ t('stage2d.spineExportTitle') }}
          </div>
          <p
            v-if="!rig.joints.length"
            class="hint"
          >
            {{ t('stage2d.actionNoRig') }}
          </p>
          <p
            v-else-if="!attachLayers.length"
            class="hint"
          >
            {{ t('stage2d.spineNoAttach') }}
          </p>
          <template v-else>
            <div class="row export-controls">
              <label class="field">
                <span>{{ t('stage2d.spineExportName') }}</span>
                <input
                  v-model="spineExportName"
                  type="text"
                  :disabled="spineBusy"
                  @keydown.enter="exportSpineSkeleton"
                >
              </label>
              <button
                type="button"
                class="primary"
                :disabled="spineBusy"
                @click="exportSpineSkeleton"
              >
                ⬇️ {{ t('stage2d.spineExportButton') }}
              </button>
            </div>
            <p class="hint">
              {{ t('stage2d.spineExportNote') }}
            </p>
            <p
              v-if="spineBusy"
              class="export-status"
            >
              {{ t('stage2d.spineExporting') }}
            </p>
            <p
              v-else-if="spineError"
              class="export-status error"
            >
              {{ spineError }}
            </p>
            <p
              v-else-if="spineMsg"
              class="export-status ok"
            >
              {{ spineMsg }}
            </p>
          </template>

          <div class="section-label">
            {{ t('stage2d.exportTitle') }}
          </div>
          <p
            v-if="!rig.joints.length"
            class="hint"
          >
            {{ t('stage2d.actionNoRig') }}
          </p>
          <p
            v-else-if="!actionCurrent"
            class="hint"
          >
            {{ t('stage2d.exportNeedAction') }}
          </p>
          <template v-else>
            <div class="row export-controls">
              <label class="field">
                <span>{{ t('stage2d.exportFps') }}</span>
                <select v-model.number="exportFps">
                  <option
                    v-for="fps in fpsOptions"
                    :key="fps"
                    :value="fps"
                  >
                    {{ fps }}
                  </option>
                </select>
              </label>
              <button
                type="button"
                class="primary"
                :disabled="exportBusy"
                @click="exportActionFrames"
              >
                {{ t('stage2d.exportButton') }}
              </button>
            </div>
            <p class="hint">
              {{
                t('stage2d.exportFramesNote', {
                  count: exportFrameCount,
                  fps: exportFps,
                  seconds: formatActionTime(actionCurrent.duration ?? 0)
                })
              }}
            </p>
            <p
              v-if="exportBusy"
              class="export-status"
            >
              {{ t('stage2d.exporting', { done: exportProgress, total: exportFrameCount }) }}
            </p>
            <p
              v-else-if="exportError"
              class="export-status error"
            >
              {{ exportError }}
            </p>
            <p
              v-else-if="exportDone"
              class="export-status ok"
            >
              {{ t('stage2d.exportDone', { count: exportFrameCount }) }}
            </p>
          </template>

          <template v-if="selectedJoint">
            <div class="section-label">
              {{ t('stage2d.jointParams') }}
            </div>
            <label class="field">
              <span>{{ t('stage2d.jointName') }}</span>
              <input
                type="text"
                :value="selectedJoint.name"
                @change="patchJointName($event)"
              >
            </label>
            <label class="field">
              <span>{{ t('stage2d.parentJoint') }}</span>
              <select
                :value="selectedJoint.parentId ?? ''"
                @change="patchJointParent($event)"
              >
                <option value="">
                  {{ t('stage2d.parentNone') }}
                </option>
                <option
                  v-for="candidate in parentCandidates"
                  :key="candidate.id"
                  :value="candidate.id"
                >
                  {{ candidate.name }}
                </option>
              </select>
            </label>
            <div class="grid2">
              <label class="field">
                <span>X</span>
                <input
                  type="number"
                  step="1"
                  :value="selectedJoint.x"
                  @change="patchJointBind('x', $event)"
                >
              </label>
              <label class="field">
                <span>Y</span>
                <input
                  type="number"
                  step="1"
                  :value="selectedJoint.y"
                  @change="patchJointBind('y', $event)"
                >
              </label>
            </div>
            <label class="slider">
              <span>
                {{ t('stage2d.poseRot') }}<b>{{ Math.round(poseValue) }}°</b>
              </span>
              <input
                type="range"
                min="-180"
                max="180"
                step="1"
                :value="poseValue"
                @input="setJointPose($event)"
              >
            </label>
            <div class="row">
              <button
                type="button"
                class="icon"
                :disabled="!Object.keys(pose).length"
                @click="resetPose"
              >
                {{ t('stage2d.resetPose') }}
              </button>
              <button
                type="button"
                class="icon"
                :disabled="!selected"
                :title="t('stage2d.bindTip')"
                @click="bindSelectedLayer"
              >
                {{ t('stage2d.bindLayer') }}
              </button>
            </div>
          </template>

          <div class="section-label">
            {{ t('stage2d.attachments') }}
          </div>
          <div
            v-if="!rig.attachments.length"
            class="hint"
          >
            {{ t('stage2d.noAttach') }}
          </div>
          <ul class="attach-list">
            <li
              v-for="attach in rig.attachments"
              :key="attach.layerId"
            >
              <select
                :title="t('stage2d.bindLayer')"
                :value="attach.layerId"
                @change="patchAttachLayer(attach.layerId, $event)"
              >
                <option
                  v-for="layer in layers"
                  :key="layer.id"
                  :value="layer.id"
                >
                  {{ layer.name }}
                </option>
              </select>
              <select
                :title="t('stage2d.bindJoint')"
                :value="attach.jointId"
                @change="patchAttachJoint(attach.layerId, $event)"
              >
                <option
                  v-for="joint in rig.joints"
                  :key="joint.id"
                  :value="joint.id"
                >
                  {{ joint.name }}
                </option>
              </select>
              <button
                type="button"
                class="icon danger"
                :title="t('stage2d.unbind')"
                @click="unbindLayer(attach.layerId)"
              >
                ✕
              </button>
              <span class="attach-xy">
                <input
                  type="number"
                  step="1"
                  :value="attach.offsetX"
                  :title="`${t('stage2d.offsetX')}`"
                  @change="patchAttachOffset(attach.layerId, 'offsetX', $event)"
                >
                <input
                  type="number"
                  step="1"
                  :value="attach.offsetY"
                  :title="`${t('stage2d.offsetY')}`"
                  @change="patchAttachOffset(attach.layerId, 'offsetY', $event)"
                >
              </span>
            </li>
          </ul>
        </template>
      </section>

      <section class="pane stage-pane">
        <div class="stage-bar">
          <div class="section-label">
            {{ t('stage2d.result') }}
          </div>
          <div class="modes">
            <button
              type="button"
              class="icon"
              :class="{ on: mode === 'pan' }"
              @click="mode = 'pan'"
            >
              {{ t('stage2d.pan') }}
            </button>
            <button
              type="button"
              class="icon"
              :class="{ on: mode === 'move' }"
              :disabled="!selected"
              @click="mode = 'move'"
            >
              {{ t('stage2d.move') }}
            </button>
            <button
              type="button"
              class="icon"
              :class="{ on: showGuides }"
              @click="showGuides = !showGuides"
            >
              {{ t('stage2d.guides') }}
            </button>
            <button
              type="button"
              class="icon"
              @click="fitView"
            >
              {{ t('stage2d.resetView') }}
            </button>
            <span class="zoom">{{ Math.round(zoom * 100) }}%</span>
          </div>
        </div>
        <div
          ref="viewportEl"
          class="viewport checker"
          @wheel.prevent="onWheel"
          @pointerdown="onPointerDown"
          @pointermove="onPointerMove"
          @pointerup="onPointerUp"
          @pointercancel="onPointerUp"
        >
          <div
            class="canvas-wrap"
            :style="{
              width: `${scene.canvasWidth}px`,
              height: `${scene.canvasHeight}px`,
              transform: `translate(-50%, -50%) translate(${panX}px, ${panY}px) scale(${zoom})`
            }"
          >
            <img
              v-if="previewUrl"
              :src="previewUrl"
              alt=""
              draggable="false"
            >
            <div
              v-if="showGuides"
              class="guides"
            >
              <div
                v-if="scene.anchor === 'ground'"
                class="line ground"
                :style="{ top: `${groundY}px` }"
              />
              <template v-else>
                <div class="line vcenter" />
                <div class="line hcenter" />
              </template>
            </div>
            <svg
              v-if="tab === 'rig' && rig.joints.length"
              class="rig-overlay"
              :viewBox="`0 0 ${scene.canvasWidth} ${scene.canvasHeight}`"
              preserveAspectRatio="none"
            >
              <g class="bones">
                <line
                  v-for="(seg, index) in rigSegments"
                  :key="index"
                  :x1="seg.x1"
                  :y1="seg.y1"
                  :x2="seg.x2"
                  :y2="seg.y2"
                />
              </g>
              <g class="joints">
                <circle
                  v-for="item in rigJoints"
                  :key="item.jointId"
                  class="joint"
                  :class="{ selected: item.jointId === selectedJointId }"
                  :cx="item.x"
                  :cy="item.y"
                  r="7"
                  @pointerdown.prevent.stop="startJointDrag(item.jointId, $event)"
                  @pointermove.prevent.stop="moveJointDrag($event)"
                  @pointerup.prevent.stop="endJointDrag($event)"
                  @pointercancel="endJointDrag($event)"
                />
              </g>
            </svg>
          </div>
          <p
            v-if="!layers.length"
            class="hint empty-hint"
          >
            {{ t('stage2d.resultEmpty') }}
          </p>
        </div>
        <p class="apply-hint">
          {{ scene.canvasWidth }}×{{ scene.canvasHeight }} · {{ t('stage2d.dragHint') }}
        </p>
      </section>

      <section class="pane">
        <div class="section-label">
          {{ t('stage2d.scene') }}
        </div>
        <div class="grid2">
          <label class="field">
            <span>{{ t('graph.align.canvasWidth') }}</span>
            <input
              type="number"
              min="16"
              max="8192"
              step="16"
              :value="scene.canvasWidth"
              @change="patchCanvas('canvasWidth', $event)"
            >
          </label>
          <label class="field">
            <span>{{ t('graph.align.canvasHeight') }}</span>
            <input
              type="number"
              min="16"
              max="8192"
              step="16"
              :value="scene.canvasHeight"
              @change="patchCanvas('canvasHeight', $event)"
            >
          </label>
        </div>

        <label class="field">
          <span>{{ t('stage2d.anchor') }}</span>
          <select
            :value="scene.anchor"
            @change="patchSceneAnchor($event)"
          >
            <option value="ground">
              {{ t('stage2d.anchorGround') }}
            </option>
            <option value="center">
              {{ t('stage2d.anchorCenter') }}
            </option>
          </select>
        </label>

        <label
          v-if="scene.anchor === 'ground'"
          class="slider"
        >
          <span>
            {{ t('stage2d.groundGap') }}<b>{{ Math.round(scene.groundRatio * 100) }}%</b>
          </span>
          <input
            type="range"
            min="0"
            max="0.5"
            step="0.01"
            :value="scene.groundRatio"
            @input="patchSceneGroundRatio($event)"
          >
        </label>

        <template v-if="selected">
          <div class="section-label">
            {{ t('stage2d.layer') }}
          </div>
          <label class="field">
            <span>{{ t('stage2d.layerName') }}</span>
            <input
              type="text"
              :value="selected.name"
              @change="patchLayerName($event)"
            >
          </label>
          <label class="field">
            <span>{{ t('stage2d.anchor') }}</span>
            <select
              :value="selected.align.anchor"
              @change="patchLayerAnchor($event)"
            >
              <option value="ground">
                {{ t('stage2d.anchorGround') }}
              </option>
              <option value="center">
                {{ t('stage2d.anchorCenter') }}
              </option>
            </select>
          </label>
          <label class="slider">
            <span>
              {{ t('stage2d.subjectHeight')
              }}<b>{{ Math.round(selected.align.contentHeightRatio * 100) }}%</b>
            </span>
            <input
              type="range"
              min="0.1"
              max="1"
              step="0.05"
              :value="selected.align.contentHeightRatio"
              @input="patchLayerRatio('contentHeightRatio', $event)"
            >
          </label>
          <label
            v-if="selected.align.anchor === 'ground'"
            class="slider"
          >
            <span>
              {{ t('stage2d.groundGap')
              }}<b>{{ Math.round(selected.align.groundRatio * 100) }}%</b>
            </span>
            <input
              type="range"
              min="0"
              max="0.5"
              step="0.01"
              :value="selected.align.groundRatio"
              @input="patchLayerRatio('groundRatio', $event)"
            >
          </label>
          <label class="check">
            <input
              type="checkbox"
              :checked="selected.align.fitWithinWidth"
              @change="patchLayerFit($event)"
            >
            <span>{{ t('stage2d.fitWidth') }}</span>
          </label>
          <div class="grid2">
            <label class="field">
              <span>{{ t('stage2d.offsetX') }}</span>
              <input
                type="number"
                step="1"
                :value="selected.offset.x"
                @change="patchLayerOffset('x', $event)"
              >
            </label>
            <label class="field">
              <span>{{ t('stage2d.offsetY') }}</span>
              <input
                type="number"
                step="1"
                :value="selected.offset.y"
                @change="patchLayerOffset('y', $event)"
              >
            </label>
          </div>
          <button
            type="button"
            class="icon"
            :disabled="!selected.offset.x && !selected.offset.y"
            @click="resetLayerOffset"
          >
            {{ t('stage2d.resetOffset') }}
          </button>
        </template>

        <div class="row">
          <span class="hint">{{ error }}</span>
          <button
            type="button"
            class="primary"
            @click="save"
          >
            {{ t('stage2d.apply') }}
          </button>
        </div>
        <p class="apply-hint">
          {{ t('stage2d.applyHint') }}
        </p>
      </section>
    </div>
  </StudioFloatingWindow>

  <AssetImagePickDialog
    :open="pickerOpen"
    :selected-asset-ids="[]"
    :remaining="16"
    @confirm="addFromAssets"
    @cancel="pickerOpen = false"
  />

  <Stage2dPoseFromImageDialog
    :open="poseDialogOpen"
    :rig="rig"
    @close="poseDialogOpen = false"
    @applied="applySolvedPose"
  />

  <Stage2dActionFromVideoDialog
    :open="videoActionOpen"
    :rig="rig"
    @close="videoActionOpen = false"
    @applied="applyVideoAction"
  />
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import {
  computeStage2dRigTransforms,
  createHumanoidStage2dRig,
  createStage2dJoint,
  normalizeStage2dAction,
  normalizeStage2dRig,
  sampleStage2dAction,
  packStage2dActionAsset,
  readStage2dActionAssetFromGenParams,
  stage2dActionAssetGenParams,
  stage2dActionPresetById,
  stage2dGroundY,
  STAGE2D_ACTION_PRESETS,
  type Stage2dAction,
  type Stage2dPose,
  type Stage2dRig
} from '@shared/gameAssets'
import {
  normalizeStage2dPose,
  normalizeStage2dScene,
  DEFAULT_STAGE2D_SCENE,
  type Stage2dSceneState
} from '@shared/graph'
import { useStudioI18n } from '../composables/useStudioI18n'
import { composeStage2dCanvas } from '../features/graph/model/composeStage2dCanvas'
import { composeStage2dFrameSheet } from '../features/graph/model/composeStage2dFrameSheet'
import { composeStage2dSpineExport } from '../features/graph/model/composeStage2dSpineExport'
import { resolveAssetPreviewUrl } from '../features/media/assetUrlCache'
import { useProjectStore } from '../stores/project'
import AssetImagePickDialog from './AssetImagePickDialog.vue'
import Stage2dActionFromVideoDialog from './Stage2dActionFromVideoDialog.vue'
import Stage2dPoseFromImageDialog from './Stage2dPoseFromImageDialog.vue'
import StudioFloatingWindow from './StudioFloatingWindow.vue'

type StageLayer = Stage2dSceneState['layers'][number]

const props = defineProps<{
  open: boolean
  setup?: Stage2dSceneState | null
  setupRig?: Stage2dRig | null
  setupPose?: Stage2dPose | null
  setupAction?: Stage2dAction | null
}>()

const emit = defineEmits<{
  close: []
  save: [
    payload: {
      stage2dScene: Stage2dSceneState
      stage2dRig: Stage2dRig
      stage2dPose: Stage2dPose
      stage2dAction?: Stage2dAction | null
      dataUrl?: string
    }
  ]
  'export-frames': [
    payload: {
      actionId: string
      fps: number
      duration: number
      frames: string[]
      sheet: string | null
    }
  ]
}>()

const { t } = useStudioI18n()
const project = useProjectStore()

const scene = ref<Stage2dSceneState>(normalizeStage2dScene(props.setup ?? undefined))
const rig = ref<Stage2dRig>(normalizeStage2dRig(props.setupRig ?? undefined))
const pose = ref<Stage2dPose>(normalizeStage2dPose(rig.value, props.setupPose ?? null))
const selectedId = ref('')
/** 左栏分页：层（叠放与落位）/ 骨骼（装配与摆姿） */
const tab = ref<'layers' | 'rig'>('layers')
const selectedJointId = ref('')
const thumbUrls = ref<Record<string, string>>({})
const previewUrl = ref('')
const error = ref('')
const pickerOpen = ref(false)
/** 从图片反解起始姿势的浮窗 */
const poseDialogOpen = ref(false)
/** 正交视口：缩放 / 平移（屏幕 px）；拖拽模式（平移视口 / 微调选中层） */
const viewportEl = ref<HTMLElement | null>(null)
const zoom = ref(1)
const panX = ref(0)
const panY = ref(0)
const mode = ref<'pan' | 'move'>('pan')
const showGuides = ref(true)
/** 渲染请求递增号：连续调参时丢弃过期结果 */
let renderToken = 0
/** 缩略图请求递增号：与渲染互不干扰，避免互相取消 */
let thumbToken = 0
let renderTimer: ReturnType<typeof setTimeout> | null = null

const layers = computed(() => scene.value.layers)
const selected = computed(
  () => layers.value.find((layer) => layer.id === selectedId.value) ?? null
)
/** 舞台 ground 基线（视口参考线，随画布 / 地面比例变化） */
const groundY = computed(() => {
  const y = stage2dGroundY(scene.value)
  return y < 0 ? Math.round(scene.value.canvasHeight / 2) : y
})

/** 每次会话先把舞台 / 骨骼 / 摆姿对准节点当前参数 */
function applySetup(): void {
  const next = normalizeStage2dScene(props.setup ?? DEFAULT_STAGE2D_SCENE)
  scene.value = next
  selectedId.value = next.layers[0]?.id ?? ''
  rig.value = normalizeStage2dRig(props.setupRig ?? undefined)
  pose.value = normalizeStage2dPose(rig.value, props.setupPose ?? null)
  cancelActionLoop()
  customAction.value = props.setupAction ? normalizeStage2dAction(props.setupAction) : null
  actionId.value = customAction.value ? CUSTOM_ACTION_ID : ''
  selectedJointId.value = rig.value.joints[0]?.id ?? ''
  tab.value = 'layers'
  void nextTick(fitView)
}

/** 视口适配：整幅舞台装进视口并居中 */
function fitView(): void {
  const el = viewportEl.value
  if (!el) return
  const w = el.clientWidth - 32
  const h = el.clientHeight - 32
  if (w <= 0 || h <= 0) return
  const next = Math.min(w / scene.value.canvasWidth, h / scene.value.canvasHeight, 4)
  zoom.value = Math.max(0.05, Math.min(8, next))
  panX.value = 0
  panY.value = 0
}

/** 滚轮缩放：保持光标下的舞台点不动 */
function onWheel(event: WheelEvent): void {
  const el = viewportEl.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  const cx = rect.width / 2
  const cy = rect.height / 2
  const mx = event.clientX - rect.left
  const my = event.clientY - rect.top
  const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12
  const next = Math.max(0.05, Math.min(8, zoom.value * factor))
  const halfW = scene.value.canvasWidth / 2
  const halfH = scene.value.canvasHeight / 2
  // 光标处的舞台坐标（相对画布左上）
  const px = halfW + (mx - cx - panX.value) / zoom.value
  const py = halfH + (my - cy - panY.value) / zoom.value
  panX.value = mx - cx - (px - halfW) * next
  panY.value = my - cy - (py - halfH) * next
  zoom.value = next
}

let dragging = false
let lastX = 0
let lastY = 0

function onPointerDown(event: PointerEvent): void {
  if (event.button !== 0) return
  dragging = true
  lastX = event.clientX
  lastY = event.clientY
  ;(event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId)
}

function onPointerMove(event: PointerEvent): void {
  if (!dragging) return
  const dx = event.clientX - lastX
  const dy = event.clientY - lastY
  lastX = event.clientX
  lastY = event.clientY
  const layer = selected.value
  if (mode.value === 'move' && layer) {
    // 屏幕位移换算回舞台像素（除以缩放）
    patchLayer(layer.id, {
      offset: { x: layer.offset.x + dx / zoom.value, y: layer.offset.y + dy / zoom.value }
    })
    return
  }
  panX.value += dx
  panY.value += dy
}

function onPointerUp(event: PointerEvent): void {
  if (!dragging) return
  dragging = false
  ;(event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId)
}

function commit(next: Stage2dSceneState): void {
  scene.value = normalizeStage2dScene(next)
  scheduleRender()
}

function patchCanvas(key: 'canvasWidth' | 'canvasHeight', event: Event): void {
  const raw = Number((event.target as HTMLInputElement).value)
  const clamped = Math.min(8192, Math.max(16, Math.round(raw)))
  commit({ ...scene.value, [key]: clamped })
}

function patchSceneAnchor(event: Event): void {
  const value = (event.target as HTMLSelectElement).value
  commit({ ...scene.value, anchor: value === 'center' ? 'center' : 'ground' })
}

function patchSceneGroundRatio(event: Event): void {
  commit({ ...scene.value, groundRatio: Number((event.target as HTMLInputElement).value) })
}

function patchLayer(id: string, patch: Partial<StageLayer>): void {
  commit({
    ...scene.value,
    layers: layers.value.map((layer) => (layer.id === id ? { ...layer, ...patch } : layer))
  })
}

function patchLayerName(event: Event): void {
  if (!selected.value) return
  patchLayer(selected.value.id, { name: (event.target as HTMLInputElement).value })
}

function patchLayerAnchor(event: Event): void {
  if (!selected.value) return
  const value = (event.target as HTMLSelectElement).value
  patchLayer(selected.value.id, {
    align: { ...selected.value.align, anchor: value === 'center' ? 'center' : 'ground' }
  })
}

function patchLayerRatio(key: 'contentHeightRatio' | 'groundRatio', event: Event): void {
  if (!selected.value) return
  const value = Number((event.target as HTMLInputElement).value)
  patchLayer(selected.value.id, { align: { ...selected.value.align, [key]: value } })
}

/** 手动微调：数值输入（舞台像素系，右 / 下为正） */
function patchLayerOffset(key: 'x' | 'y', event: Event): void {
  if (!selected.value) return
  const raw = Number((event.target as HTMLInputElement).value)
  const value = Number.isFinite(raw) ? raw : 0
  patchLayer(selected.value.id, {
    offset: { ...selected.value.offset, [key]: value }
  })
}

function resetLayerOffset(): void {
  if (!selected.value) return
  patchLayer(selected.value.id, { offset: { x: 0, y: 0 } })
}

/* ---------------- 骨骼装配与摆姿（2D rig） ---------------- */

const selectedJoint = computed(
  () => rig.value.joints.find((joint) => joint.id === selectedJointId.value) ?? null
)

/** 可作父关节的候选项（排除自身） */
const parentCandidates = computed(() => {
  const id = selectedJoint.value?.id
  return rig.value.joints.filter((joint) => joint.id !== id)
})

/** 关节世界变换（FK 实时结果，随摆姿更新） */
const rigJoints = computed(() => computeStage2dRigTransforms(rig.value, pose.value))

/** 骨骼连线（父→子世界坐标，供视口叠层） */
const rigSegments = computed(() => {
  const jointById = new Map(rig.value.joints.map((joint) => [joint.id, joint]))
  const transformById = new Map(rigJoints.value.map((item) => [item.jointId, item]))
  const segments: Array<{ x1: number; y1: number; x2: number; y2: number }> = []
  for (const item of rigJoints.value) {
    const parentId = jointById.get(item.jointId)?.parentId
    const parent = parentId ? transformById.get(parentId) : undefined
    if (parent) segments.push({ x1: parent.x, y1: parent.y, x2: item.x, y2: item.y })
  }
  return segments
})

function jointName(id: string | null): string {
  if (!id) return ''
  return rig.value.joints.find((joint) => joint.id === id)?.name ?? id
}

/** 关节当前生效旋转：优先摆姿覆盖值，否则用绑定旋转 */
const poseValue = computed(() => {
  const joint = selectedJoint.value
  if (!joint) return 0
  return pose.value[joint.id] ?? joint.rotation
})

function commitRig(next: Stage2dRig): void {
  rig.value = normalizeStage2dRig(next)
  // 关节被删后清理对应摆姿，避免残留引用
  const keep = new Set(rig.value.joints.map((joint) => joint.id))
  const kept = Object.fromEntries(Object.entries(pose.value).filter(([id]) => keep.has(id)))
  pose.value = kept
}

/** 按当前画布建一个标准人形骨骼（命名遵循 pose 反解约定） */
function useHumanoidTemplate(): void {
  stopActionPlayback()
  const s = scene.value
  const rawGround = stage2dGroundY(s)
  const feetY =
    rawGround >= 0
      ? Math.max(8, Math.min(Math.round(rawGround), s.canvasHeight - 8))
      : Math.max(8, s.canvasHeight - 8)
  const height = Math.max(60, Math.min(feetY - 8, s.canvasWidth * 0.7, s.canvasHeight * 0.92))
  const next = createHumanoidStage2dRig({
    x: Math.round(s.canvasWidth / 2),
    groundY: feetY,
    height: Math.round(height)
  })
  rig.value = next
  pose.value = {}
  selectedJointId.value = next.joints.find((joint) => joint.id === 'pelvis')?.id ?? next.joints[0]?.id ?? ''
  tab.value = 'rig'
  render()
}

/** 应用「从图片反解」得到的平面姿势并关掉子浮窗 */
function applySolvedPose(payload: { pose: Stage2dPose }): void {
  stopActionPlayback()
  pose.value = normalizeStage2dPose(rig.value, payload.pose)
  poseDialogOpen.value = false
  render()
}

function addJoint(): void {
  const parentId = selectedJoint.value?.id ?? null
  let index = rig.value.joints.length + 1
  let id = `joint-${index}`
  while (rig.value.joints.some((joint) => joint.id === id)) {
    index += 1
    id = `joint-${index}`
  }
  const joint = createStage2dJoint({
    id,
    name: `Joint ${index}`,
    parentId,
    x: 0,
    y: parentId ? -60 : 0
  })
  commitRig({ ...rig.value, joints: [...rig.value.joints, joint] })
  selectedJointId.value = id
}

function removeJoint(id: string): void {
  commitRig({ ...rig.value, joints: rig.value.joints.filter((joint) => joint.id !== id) })
  if (selectedJointId.value === id) {
    selectedJointId.value = rig.value.joints[0]?.id ?? ''
  }
}

function patchJoint(patch: Partial<Stage2dRig['joints'][number]>): void {
  const joint = selectedJoint.value
  if (!joint) return
  commitRig({
    ...rig.value,
    joints: rig.value.joints.map((item) => (item.id === joint.id ? { ...item, ...patch } : item))
  })
}

function patchJointName(event: Event): void {
  patchJoint({ name: (event.target as HTMLInputElement).value })
}

function patchJointParent(event: Event): void {
  patchJoint({ parentId: (event.target as HTMLSelectElement).value || null })
}

function patchJointBind(key: 'x' | 'y', event: Event): void {
  patchJoint({ [key]: Number((event.target as HTMLInputElement).value) || 0 })
}

function setJointPose(event: Event): void {
  stopActionPlayback()
  const joint = selectedJoint.value
  if (!joint) return
  pose.value = {
    ...pose.value,
    [joint.id]: Number((event.target as HTMLInputElement).value) || 0
  }
}

function resetPose(): void {
  stopActionPlayback()
  pose.value = {}
}

/* 动作试播：内置动作循环播放期间用采样 pose 实时驱动骨骼与挂件（只预览不改数据）。
   自定义动作（参考视频逐帧转骨架关键帧动画等）随节点 params 持久化，
   以「custom」伪预设走同一套下拉 / 试播 / 定格 / 导出链路。 */
const CUSTOM_ACTION_ID = 'custom'
const actionId = ref('')
const actionMode = ref<'off' | 'playing' | 'paused'>('off')
const actionClock = ref(0)
let actionAnchorMs = 0
let actionSavedPose: Stage2dPose | null = null
let actionRaf = 0

const actionPresets = STAGE2D_ACTION_PRESETS
/** 会话中的自定义动作：下拉选中「custom」时被播放 / 定格 / 导出 */
const customAction = ref<Stage2dAction | null>(null)
/** 「从视频生成动作」浮窗 */
const videoActionOpen = ref(false)

type PlayableStage2dAction = Stage2dAction & { id: string }
const actionCurrent = computed<PlayableStage2dAction | null>(() => {
  if (actionId.value === CUSTOM_ACTION_ID) {
    const custom = customAction.value
    return custom ? { ...custom, id: CUSTOM_ACTION_ID } : null
  }
  return stage2dActionPresetById(actionId.value)
})

function actionLabel(id: string): string {
  if (id === CUSTOM_ACTION_ID) {
    const custom = customAction.value
    return custom?.name
      ? `${t('stage2dVideo.actionCustom')} · ${custom.name}`
      : t('stage2dVideo.actionCustom')
  }
  const label = t(`stage2d.actions.${id}`)
  return typeof label === 'string' && label && label !== `stage2d.actions.${id}` ? label : id
}

function formatActionTime(sec: number): string {
  const value = Math.max(0, sec)
  return `${Math.round(value * 10) / 10}`
}

/** 清掉 rAF 循环并复位试播状态（不触碰 pose / 不恢复） */
function cancelActionLoop(): void {
  if (actionRaf) cancelAnimationFrame(actionRaf)
  actionRaf = 0
  actionMode.value = 'off'
  actionClock.value = 0
  actionSavedPose = null
}

function actionTick(now: number): void {
  const action = actionCurrent.value
  if (!action) {
    cancelActionLoop()
    return
  }
  actionClock.value = (now - actionAnchorMs) / 1000
  pose.value = sampleStage2dAction(action, actionClock.value)
  actionRaf = requestAnimationFrame(actionTick)
}

function startActionLoop(): void {
  cancelAnimationFrame(actionRaf)
  actionRaf = 0
  actionAnchorMs = performance.now() - actionClock.value * 1000
  actionRaf = requestAnimationFrame(actionTick)
}

function toggleActionPlay(): void {
  if (!actionCurrent.value || !rig.value.joints.length) return
  if (actionMode.value === 'playing') {
    cancelAnimationFrame(actionRaf)
    actionRaf = 0
    actionMode.value = 'paused'
    return
  }
  if (actionMode.value === 'paused') {
    actionMode.value = 'playing'
    startActionLoop()
    return
  }
  actionSavedPose = { ...pose.value }
  actionClock.value = 0
  actionMode.value = 'playing'
  startActionLoop()
}

/** 停止试播并回到进入播放前的用户摆姿 */
function stopActionPlayback(): void {
  if (actionMode.value === 'off' && !actionRaf) return
  const restore = actionSavedPose
  cancelActionLoop()
  if (restore) pose.value = restore
}

/** 把当前采样帧定格为用户的摆姿并退出试播（暂停态用已停的时钟值） */
function freezeActionFrame(): void {
  const action = actionCurrent.value
  if (actionMode.value === 'off' || !action) return
  pose.value = sampleStage2dAction(action, actionClock.value)
  cancelActionLoop()
}

/** 动作下拉切换：播放中无缝换动作从头循环；清空则停止并恢复试播前摆姿 */
function onActionPick(event: Event): void {
  const id = (event.target as HTMLSelectElement).value
  const wasPlaying = actionMode.value !== 'off'
  if (wasPlaying) {
    // 只停当前循环，保留「进入播放前」的摆姿快照供停止时恢复
    cancelAnimationFrame(actionRaf)
    actionRaf = 0
    actionMode.value = 'off'
    actionClock.value = 0
  } else {
    stopActionPlayback()
  }
  actionId.value = id
  if (id && wasPlaying) {
    actionMode.value = 'playing'
    startActionLoop()
  }
}

function openVideoActionDialog(): void {
  stopActionPlayback()
  videoActionOpen.value = true
}

/** 视频生成的动作：作为「custom」动作直接进入试播（不自动落 params，点保存才随节点持久化） */
function applyVideoAction(action: Stage2dAction): void {
  const normalized = normalizeStage2dAction(action)
  videoActionOpen.value = false
  if (!normalized.keyframes.length) return
  stopActionPlayback()
  customAction.value = normalized
  actionSavedPose = { ...pose.value }
  actionClock.value = 0
  actionId.value = CUSTOM_ACTION_ID
  actionMode.value = 'playing'
  startActionLoop()
}

/* 动作资产容器：动作 + 创作装配可存成素材库 motion2d 资产，跨节点 / rig 载回复用 */
const motionAssets = computed(() =>
  project.assets.filter((asset) => asset.type === 'motion2d' && !asset.relativePath)
)
const assetActionSavingOpen = ref(false)
const assetActionBusy = ref(false)
const assetActionName = ref('')
const assetLoadPickerOpen = ref(false)
const motionLoadSel = ref('')
const assetActionMsg = ref('')
const assetActionMsgKind = ref<'ok' | 'warn' | 'error'>('ok')

function setAssetActionMsg(text: string, kind: 'ok' | 'warn' | 'error' = 'ok'): void {
  assetActionMsg.value = text
  assetActionMsgKind.value = kind
}

function beginSaveActionAsset(): void {
  const action = actionCurrent.value
  if (!action) return
  assetActionName.value = action.name?.trim() || actionLabel(action.id)
  assetActionMsg.value = ''
  assetActionSavingOpen.value = !assetActionSavingOpen.value
}

async function confirmSaveActionAsset(): Promise<void> {
  const action = actionCurrent.value
  if (!action || assetActionBusy.value) return
  const name = assetActionName.value.trim()
  if (!name) {
    setAssetActionMsg(t('validation.nameRequired'), 'error')
    return
  }
  assetActionBusy.value = true
  try {
    const pack = packStage2dActionAsset({
      action: { ...action, name },
      rig: rig.value,
      pose: pose.value
    })
    const created = await window.studio.createAsset({
      type: 'motion2d',
      name,
      genParams: stage2dActionAssetGenParams(pack)
    })
    await project.refreshAssets()
    assetActionSavingOpen.value = false
    setAssetActionMsg(t('stage2d.actionAssetSaved', { name: created.name }), 'ok')
  } catch (err) {
    console.error('[stage2d action asset] save failed:', err)
    setAssetActionMsg(t('stage2d.actionAssetFail', { message: String(err) }), 'error')
  } finally {
    assetActionBusy.value = false
  }
}

function toggleLoadActionAsset(): void {
  assetActionMsg.value = ''
  if (assetLoadPickerOpen.value) {
    assetLoadPickerOpen.value = false
    motionLoadSel.value = ''
    return
  }
  motionLoadSel.value = ''
  assetLoadPickerOpen.value = true
}

function onMotionLoadChange(event: Event): void {
  const id = (event.target as HTMLSelectElement).value
  const picked = id ? motionAssets.value.find((asset) => asset.id === id) : undefined
  assetLoadPickerOpen.value = false
  motionLoadSel.value = ''
  if (!picked) return
  const pack = readStage2dActionAssetFromGenParams(picked.genParams)
  const action = normalizeStage2dAction(pack?.action)
  if (!action.keyframes.length) {
    setAssetActionMsg(t('stage2d.actionAssetLoadEmptyAction', { asset: picked.name }), 'warn')
    return
  }
  const referenced = new Set<string>()
  for (const frame of action.keyframes) {
    for (const jointId of Object.keys(frame.pose)) referenced.add(jointId)
  }
  const rigIds = new Set(rig.value.joints.map((joint) => joint.id))
  const matched = [...referenced].filter((jointId) => rigIds.has(jointId)).length
  if (referenced.size > 0 && matched === 0) {
    setAssetActionMsg(t('stage2d.actionAssetLoadMismatch', { asset: picked.name }), 'warn')
    return
  }
  stopActionPlayback()
  customAction.value = action
  actionSavedPose = { ...pose.value }
  actionClock.value = 0
  actionId.value = CUSTOM_ACTION_ID
  actionMode.value = 'playing'
  startActionLoop()
  setAssetActionMsg(
    t('stage2d.actionAssetLoadDone', {
      asset: picked.name,
      matched: String(matched),
      total: String(referenced.size)
    }),
    'ok'
  )
}

/* 动作帧导出：按帧率把试播动作 cook 成透明 PNG 帧，逐帧资产 + 拼一张水平 sheet */
const fpsOptions = [6, 8, 10, 12, 15, 24]
const exportFps = ref(12)
const exportBusy = ref(false)
const exportProgress = ref(0)
const exportDone = ref(false)
const exportError = ref('')

/** Spine 骨架包导出：把挂到关节的可见部件层导出为 skeleton.json + atlas + 部件 PNG */
const spineExportName = ref('')
const spineBusy = ref(false)
const spineMsg = ref('')
const spineError = ref('')
/** 已挂到关节且可见的层（导出 Spine 包的先决条件） */
const attachLayers = computed(() =>
  rig.value.attachments.filter((attachment) =>
    scene.value.layers.some(
      (layer) => layer.id === attachment.layerId && layer.visible && layer.sourceUrl.trim()
    )
  )
)

async function exportSpineSkeleton(): Promise<void> {
  if (spineBusy.value) return
  if (!rig.value.joints.length || !attachLayers.value.length) return
  stopActionPlayback()
  spineBusy.value = true
  spineMsg.value = ''
  spineError.value = ''
  try {
    const sceneState = normalizeStage2dScene(scene.value)
    const baseName = spineExportName.value.trim() || 'skeleton'
    const result = await composeStage2dSpineExport({
      state: sceneState,
      rig: rig.value,
      pose: pose.value,
      resolveLayerUrl,
      baseName
    })
    if (!result || !result.files.length) {
      throw new Error(t('stage2d.spineNoAttach'))
    }
    // 部件页 PNG 走工程媒体落盘（Assets/ 子目录自动建目录、注册为图片资产并刷新）
    const subDir = `Assets/2D/Spine/${result.skeletonName}`
    for (const file of result.files) {
      await window.studio.saveGraphRunMedia({
        dataUrl: file.dataUrl,
        key: file.fileName.replace(/\.png$/i, ''),
        outputDir: subDir
      })
    }
    // skeleton.json 与 atlas 是同目录工程文件（不进素材库，供引擎/Spine 直接导入）
    await window.studio.writeProjectFile({
      relativePath: `${subDir}/${result.skeletonName}.json`,
      content: result.jsonText
    })
    await window.studio.writeProjectFile({
      relativePath: `${subDir}/${result.skeletonName}.atlas`,
      content: result.atlasText
    })
    await project.scheduleRefreshLibrary()
    spineMsg.value = t('stage2d.spineExportDone', {
      count: result.files.length,
      path: subDir
    })
  } catch (err) {
    spineError.value = err instanceof Error ? err.message : String(err)
  } finally {
    spineBusy.value = false
  }
}

const exportFrameCount = computed(() => {
  const action = actionCurrent.value
  return action ? Math.max(1, Math.round((action.duration ?? 1) * exportFps.value)) : 0
})

async function exportActionFrames(): Promise<void> {
  const action = actionCurrent.value
  if (!action || exportBusy.value) return
  if (!rig.value.joints.length) return
  stopActionPlayback()
  exportBusy.value = true
  exportDone.value = false
  exportError.value = ''
  exportProgress.value = 0
  try {
    // 与编辑器预览同源：先把工程内层源解析成可绘 URL 再交给合成层
    const sceneState = normalizeStage2dScene(scene.value)
    const resolved = await Promise.all(
      sceneState.layers.map((layer) => resolveLayerUrl(layer.sourceUrl))
    )
    const composeScene = normalizeStage2dScene({
      ...sceneState,
      layers: sceneState.layers.map((layer, index) => ({
        ...layer,
        sourceUrl: resolved[index] ?? ''
      }))
    })
    const count = exportFrameCount.value
    const duration = action.duration ?? 0
    const framePoses: Stage2dPose[] = []
    for (let index = 0; index < count; index++) {
      const t = duration > 0 ? (index * duration) / count : 0
      framePoses.push(sampleStage2dAction(action, t))
    }
    const frames: string[] = []
    for (let index = 0; index < framePoses.length; index++) {
      const out = await composeStage2dCanvas({
        state: composeScene,
        rig: rig.value,
        pose: framePoses[index]
      })
      frames.push(out.dataUrl)
      exportProgress.value = index + 1
    }
    const sheet = await composeStage2dFrameSheet({ frameUrls: frames })
    emit('export-frames', {
      actionId: action.id,
      fps: exportFps.value,
      duration,
      frames,
      sheet: sheet?.dataUrl ?? null
    })
    exportDone.value = true
  } catch (err) {
    exportError.value = err instanceof Error ? err.message : String(err)
  } finally {
    exportBusy.value = false
  }
}

/** 把当前选中的层挂到选中关节（同一层只能挂一个关节） */
function bindSelectedLayer(): void {
  const layer = selected.value
  const joint = selectedJoint.value
  if (!layer || !joint) return
  const attachments = rig.value.attachments.filter((item) => item.layerId !== layer.id)
  commitRig({
    ...rig.value,
    attachments: [
      ...attachments,
      { layerId: layer.id, jointId: joint.id, offsetX: 0, offsetY: 0, rotation: 0 }
    ]
  })
}

function unbindLayer(layerId: string): void {
  commitRig({
    ...rig.value,
    attachments: rig.value.attachments.filter((item) => item.layerId !== layerId)
  })
}

function patchAttachLayer(prevLayerId: string, event: Event): void {
  const target = (event.target as HTMLSelectElement).value
  const seen = new Set<string>()
  const attachments = rig.value.attachments
    .map((item) => (item.layerId === prevLayerId ? { ...item, layerId: target } : item))
    .filter((item) => {
      if (seen.has(item.layerId)) return false
      seen.add(item.layerId)
      return true
    })
  commitRig({ ...rig.value, attachments })
}

function patchAttachJoint(layerId: string, event: Event): void {
  const jointId = (event.target as HTMLSelectElement).value
  commitRig({
    ...rig.value,
    attachments: rig.value.attachments.map((item) =>
      item.layerId === layerId ? { ...item, jointId } : item
    )
  })
}

function patchAttachOffset(layerId: string, key: 'offsetX' | 'offsetY', event: Event): void {
  const value = Number((event.target as HTMLInputElement).value) || 0
  commitRig({
    ...rig.value,
    attachments: rig.value.attachments.map((item) =>
      item.layerId === layerId ? { ...item, [key]: value } : item
    )
  })
}

/* 视口拖关节摆姿：以关节为圆心转（FK 驱动子链与挂件） */
let poseDrag: { jointId: string; baseAngle: number; baseRotation: number } | null = null

function screenToScene(clientX: number, clientY: number): { x: number; y: number } {
  const el = viewportEl.value
  if (!el) return { x: 0, y: 0 }
  const rect = el.getBoundingClientRect()
  const mx = clientX - rect.left
  const my = clientY - rect.top
  const cx = rect.width / 2
  const cy = rect.height / 2
  return {
    x: scene.value.canvasWidth / 2 + (mx - cx - panX.value) / zoom.value,
    y: scene.value.canvasHeight / 2 + (my - cy - panY.value) / zoom.value
  }
}

function wrapDeg(deg: number): number {
  return ((((deg + 180) % 360) + 360) % 360) - 180
}

function startJointDrag(jointId: string, event: PointerEvent): void {
  stopActionPlayback()
  const item = rigJoints.value.find((entry) => entry.jointId === jointId)
  if (!item) return
  selectedJointId.value = jointId
  const joint = rig.value.joints.find((entry) => entry.id === jointId)
  const point = screenToScene(event.clientX, event.clientY)
  poseDrag = {
    jointId,
    baseAngle: (Math.atan2(point.y - item.y, point.x - item.x) * 180) / Math.PI,
    baseRotation: pose.value[jointId] ?? joint?.rotation ?? 0
  }
  ;(event.currentTarget as Element).setPointerCapture?.(event.pointerId)
}

function moveJointDrag(event: PointerEvent): void {
  const drag = poseDrag
  if (!drag) return
  const item = rigJoints.value.find((entry) => entry.jointId === drag.jointId)
  if (!item) return
  const point = screenToScene(event.clientX, event.clientY)
  const angle = (Math.atan2(point.y - item.y, point.x - item.x) * 180) / Math.PI
  const delta = angle - drag.baseAngle
  pose.value = {
    ...pose.value,
    [drag.jointId]: wrapDeg(drag.baseRotation + delta)
  }
}

function endJointDrag(event: PointerEvent): void {
  if (!poseDrag) return
  ;(event.currentTarget as Element).releasePointerCapture?.(event.pointerId)
  poseDrag = null
}

function patchLayerFit(event: Event): void {
  if (!selected.value) return
  const checked = (event.target as HTMLInputElement).checked
  patchLayer(selected.value.id, { align: { ...selected.value.align, fitWithinWidth: checked } })
}

/** 层序即 z 序：后层覆盖前层，上移 = 往前挪 */
function move(id: string, delta: number): void {
  const list = [...layers.value]
  const index = list.findIndex((layer) => layer.id === id)
  const target = index + delta
  if (index < 0 || target < 0 || target >= list.length) return
  const [picked] = list.splice(index, 1)
  list.splice(target, 0, picked)
  commit({ ...scene.value, layers: list })
}

function remove(id: string): void {
  commit({ ...scene.value, layers: layers.value.filter((layer) => layer.id !== id) })
  if (selectedId.value === id) selectedId.value = layers.value[0]?.id ?? ''
  // 层被移除时同步解绑（避免挂点指向不存在的层）
  commitRig({
    ...rig.value,
    attachments: rig.value.attachments.filter((item) => item.layerId !== id)
  })
}

function toggleVisible(id: string): void {
  const layer = layers.value.find((item) => item.id === id)
  if (!layer) return
  patchLayer(id, { visible: !layer.visible })
}

/** 资产库选图即按当前锚点入层（拖入/选取都走这里） */
function addFromAssets(assetIds: string[]): void {
  pickerOpen.value = false
  const picked = assetIds
    .map((id) => project.assets.find((asset) => asset.id === id))
    .filter((asset): asset is NonNullable<typeof asset> => !!asset)
    .map((asset) => asset.relativePath?.trim())
    .filter((path): path is string => !!path)
  if (!picked.length) return
  const base = layers.value.length
  const added: StageLayer[] = picked.map((sourceUrl, index) => ({
    id: `layer-${Date.now()}-${base + index}`,
    name: `Layer ${base + index + 1}`,
    sourceUrl,
    align: {
      anchor: scene.value.anchor,
      contentHeightRatio: 0.9,
      groundRatio: scene.value.groundRatio,
      fitWithinWidth: true
    },
    offset: { x: 0, y: 0 },
    visible: true
  }))
  commit({ ...scene.value, layers: [...layers.value, ...added] })
  selectedId.value = added[0]?.id ?? selectedId.value
}

/** 层源多为项目相对路径，先解析成可绘制 URL 再交给合成层 */
async function resolveLayerUrl(sourceUrl: string): Promise<string> {
  const raw = sourceUrl.trim()
  if (!raw) return ''
  if (/^(data:|https?:\/\/|blob:)/i.test(raw)) return raw
  try {
    return await resolveAssetPreviewUrl(raw)
  } catch {
    return ''
  }
}

async function render(): Promise<void> {
  const token = ++renderToken
  const urls = await Promise.all(layers.value.map((layer) => resolveLayerUrl(layer.sourceUrl)))
  const drawable = layers.value.filter((_, index) => !!urls[index])
  if (token !== renderToken) return
  if (!drawable.length) {
    previewUrl.value = ''
    error.value = ''
    return
  }
  const composeScene = normalizeStage2dScene({
    ...scene.value,
    layers: layers.value.map((layer, index) => ({ ...layer, sourceUrl: urls[index] ?? '' }))
  })
  try {
    const out = await composeStage2dCanvas({
      state: composeScene,
      rig: rig.value,
      pose: pose.value
    })
    if (token !== renderToken) return
    previewUrl.value = out.dataUrl
    error.value = ''
  } catch (err) {
    if (token !== renderToken) return
    error.value = err instanceof Error ? err.message : String(err)
  }
}

function scheduleRender(): void {
  if (renderTimer) clearTimeout(renderTimer)
  renderTimer = setTimeout(() => {
    renderTimer = null
    void render()
  }, 120)
}

function save(): void {
  emit('save', {
    stage2dScene: normalizeStage2dScene(scene.value),
    stage2dRig: normalizeStage2dRig(rig.value),
    stage2dPose: normalizeStage2dPose(normalizeStage2dRig(rig.value), pose.value),
    stage2dAction:
      actionId.value === CUSTOM_ACTION_ID
        ? normalizeStage2dAction(customAction.value ?? null)
        : null,
    ...(previewUrl.value ? { dataUrl: previewUrl.value } : {})
  })
}

/** 层缩略图：复用资产预览缓存，仅在源变化时补齐 */
async function resolveThumbs(): Promise<void> {
  const token = ++thumbToken
  const next: Record<string, string> = { ...thumbUrls.value }
  await Promise.all(
    layers.value.map(async (layer) => {
      if (next[layer.id]) return
      const url = await resolveLayerUrl(layer.sourceUrl)
      if (url) next[layer.id] = url
    })
  )
  if (token !== thumbToken) return
  thumbUrls.value = next
}

// 切离「骨骼」页时停掉动作试播（避免后台空转并还原试播前摆姿）
watch(tab, (value) => {
  if (value !== 'rig') stopActionPlayback()
})

watch(
  () => props.open,
  (open) => {
    if (!open) {
      cancelActionLoop()
      previewUrl.value = ''
      error.value = ''
      assetActionSavingOpen.value = false
      assetLoadPickerOpen.value = false
      motionLoadSel.value = ''
      assetActionMsg.value = ''
      return
    }
    applySetup()
    void resolveThumbs()
    void render()
  },
  { immediate: true }
)

watch(scene, () => {
  if (!props.open) return
  void resolveThumbs()
  scheduleRender()
})

watch([rig, pose], () => {
  if (!props.open) return
  scheduleRender()
})

// 画布尺寸变了重新适配视口（舞台画幅切换后无需手动缩放）
watch(
  () => [scene.value.canvasWidth, scene.value.canvasHeight],
  () => {
    if (props.open) fitView()
  }
)

onBeforeUnmount(() => {
  cancelActionLoop()
})
</script>

<style scoped>
.action-controls {
  align-items: center;
}

.action-video-btn {
  width: 100%;
  margin-top: 2px;
}

.asset-action-row {
  margin-top: 4px;
  gap: 6px;
  flex-wrap: wrap;
}

.asset-action-row .icon {
  font-size: 11px;
  padding: 4px 6px;
}

.asset-pick-select {
  width: 100%;
  margin-top: 4px;
}

.asset-save-row {
  margin-top: 4px;
  gap: 6px;
  flex-wrap: wrap;
}

.asset-save-row .field {
  flex: 1;
  min-width: 150px;
}

.asset-save-row .field span {
  font-size: 11px;
}

.asset-save-row input {
  min-width: 0;
}

.asset-save-row .primary {
  font-size: 11px;
}

.asset-action-msg {
  margin: 4px 0 0;
  font-size: 12px;
  line-height: 1.5;
}

.asset-action-msg.kind-ok {
  color: var(--accent);
}

.asset-action-msg.kind-warn {
  color: var(--warning);
}

.asset-action-msg.kind-error {
  color: var(--danger);
}

.action-status {
  margin: 0;
  font-size: 12px;
  line-height: 1.4;
  opacity: 0.75;
}

.export-status {
  margin: 0;
  font-size: 12px;
  line-height: 1.4;
  opacity: 0.85;
}

.export-status.ok {
  color: var(--success);
}

.export-status.error {
  color: var(--danger);
}

.stage2d {
  display: grid;
  grid-template-columns: 280px 1fr 300px;
  gap: 16px;
  height: 100%;
  min-height: 0;
  padding: 16px;
  overflow: auto;
}

.pane {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

.layers-pane {
  min-height: 0;
  overflow-y: auto;
}

.tabs {
  display: flex;
  gap: 6px;
}

.tab {
  padding: 4px 12px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--bg-input);
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
}

.tab.on {
  border-color: var(--accent);
  background: var(--accent);
  color: var(--on-accent);
}

.section-label {
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.layers {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1;
  min-height: 0;
  margin: 0;
  padding: 0;
  overflow: auto;
  list-style: none;
}

.layer {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-input);
  cursor: pointer;
}

.layer.active {
  border-color: var(--accent);
}

.layer.hidden .name {
  opacity: 0.5;
  text-decoration: line-through;
}

.layer img {
  width: 32px;
  height: 32px;
  object-fit: contain;
  border-radius: 4px;
  background: var(--bg-elevated);
}

.thumb-fallback {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: 4px;
  background: var(--bg-elevated);
  font-size: 14px;
}

.name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: var(--text-secondary);
}

.stage-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.modes {
  display: flex;
  align-items: center;
  gap: 6px;
}

.zoom {
  min-width: 44px;
  font-size: 11px;
  color: var(--text-muted);
  text-align: right;
}

.viewport {
  position: relative;
  flex: 1;
  min-height: 280px;
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
  background: var(--bg-input);
  touch-action: none;
  cursor: grab;
}

.viewport:active {
  cursor: grabbing;
}

.canvas-wrap {
  position: absolute;
  left: 50%;
  top: 50%;
  transform-origin: center;
}

.canvas-wrap img {
  width: 100%;
  height: 100%;
  object-fit: fill;
  user-select: none;
}

.guides {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background-image:
    linear-gradient(to right, var(--wash-16) 1px, transparent 1px),
    linear-gradient(to bottom, var(--wash-16) 1px, transparent 1px);
  background-size: 64px 64px;
}

.line {
  position: absolute;
  background: color-mix(in srgb, var(--accent) 55%, transparent);
}

.line.ground {
  left: 0;
  right: 0;
  height: 1px;
}

.line.vcenter {
  top: 0;
  bottom: 0;
  left: 50%;
  width: 1px;
}

.line.hcenter {
  left: 0;
  right: 0;
  top: 50%;
  height: 1px;
}

.rig-toolbar {
  display: flex;
  gap: 6px;
}

.rig-overlay {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.rig-overlay .bones line {
  stroke: var(--accent);
  stroke-width: 2;
  stroke-opacity: 0.55;
}

.rig-overlay .joints circle {
  fill: color-mix(in srgb, var(--accent) 55%, transparent);
  stroke: var(--accent);
  stroke-width: 2;
  pointer-events: all;
  cursor: grab;
}

.rig-overlay .joints circle:hover {
  fill: var(--accent);
}

.rig-overlay .joints circle.selected {
  fill: var(--accent);
  stroke: var(--on-accent);
  stroke-width: 2.5;
}

.attach-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.attach-list li {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
  padding: 6px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-input);
}

.attach-list select {
  width: 92px;
  max-width: 92px;
  font-size: 11px;
}

.attach-xy {
  display: flex;
  gap: 4px;
  margin-left: auto;
}

.attach-xy input {
  width: 46px;
  font-size: 11px;
}

.empty-hint {
  position: absolute;
  left: 0;
  right: 0;
  top: 50%;
  transform: translateY(-50%);
  text-align: center;
}

/* 透明 PNG 棋盘底：wash 叠色跨主题自适应 */
.checker {
  background-color: var(--bg-input);
  background-image:
    linear-gradient(
      45deg,
      var(--wash-16) 25%,
      transparent 25%,
      transparent 75%,
      var(--wash-16) 75%
    ),
    linear-gradient(45deg, var(--wash-16) 25%, transparent 25%, transparent 75%, var(--wash-16) 75%);
  background-size: 16px 16px;
  background-position:
    0 0,
    8px 8px;
}

.grid2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.field {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
  color: var(--text-secondary);
}

.field input[type='number'] {
  width: 84px;
}

.field input[type='text'] {
  width: 140px;
}

.field select {
  min-width: 120px;
  max-width: 160px;
}

.slider {
  display: grid;
  gap: 4px;
  font-size: 12px;
}

.slider span {
  display: flex;
  justify-content: space-between;
}

.slider b {
  font-weight: 600;
}

.check {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
}

.row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: auto;
}

.row .hint {
  margin-right: auto;
  color: var(--danger);
}

.hint {
  margin: 0;
  font-size: 12px;
  color: var(--text-muted);
}

.apply-hint {
  margin: 0;
  font-size: 11px;
  color: var(--text-muted);
}

.icon {
  padding: 2px 6px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-elevated);
  color: var(--text);
  font-size: 12px;
  line-height: 1.4;
  cursor: pointer;
}

.icon:hover:not(:disabled) {
  background: var(--bg-hover);
}

.icon:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.icon.danger:hover {
  border-color: var(--danger);
  color: var(--danger);
}

button.primary {
  padding: 6px 14px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: var(--accent);
  color: var(--on-accent);
  font-size: 13px;
  cursor: pointer;
}

button.primary:hover {
  background: var(--accent-hover);
}
</style>
