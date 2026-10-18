<template>
  <aside class="inspector" :class="{ embedded }">
    <div class="body">
      <div class="head">
        <div>
          <div class="type">
            {{ selectionTypeLabel }}
          </div>
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
        <span class="fov"
          >{{ t('director.stage.fovShort') }}
          {{ Math.round(viewer.fov ?? DEFAULT_DIRECTOR_CAMERA_FOV) }}&deg;</span
        >
      </div>

      <template v-if="scene.selectionKind.value === 'camera'">
        <p v-if="editingKeyframeHint" class="keyframe-hint">
          {{ editingKeyframeHint }}
        </p>
        <p v-if="cameraLocked" class="locked-hint">
          {{ t('director.stage.lockedHint') }}
        </p>
        <div class="fields" @focusin="isEditingViewer = true" @focusout="onViewerFocusOut">
          <label>
            {{ t('asset.field.name') }}
            <input v-model="cameraName" type="text" @change="persistCameraName" />
          </label>
          <div class="section-label">
            {{ t('director.stage.position') }}
          </div>
          <div class="vec-row" :class="{ disabled: cameraLocked }">
            <label
              >X
              <input
                v-model.number="posX"
                v-number-scrub
                type="number"
                step="0.01"
                :disabled="cameraLocked"
                @input="persistViewer"
            /></label>
            <label
              >Y
              <input
                v-model.number="posY"
                v-number-scrub
                type="number"
                step="0.01"
                :disabled="cameraLocked"
                @input="persistViewer"
            /></label>
            <label
              >Z
              <input
                v-model.number="posZ"
                v-number-scrub
                type="number"
                step="0.01"
                :disabled="cameraLocked"
                @input="persistViewer"
            /></label>
          </div>
          <div class="section-label">
            {{ t('director.stage.rotationDeg') }}
          </div>
          <div class="vec-row" :class="{ disabled: cameraLocked }">
            <label
              >X
              <input
                v-model.number="rotX"
                v-number-scrub
                type="number"
                step="0.1"
                :disabled="cameraLocked"
                @input="persistViewer"
            /></label>
            <label
              >Y
              <input
                v-model.number="rotY"
                v-number-scrub
                type="number"
                step="0.1"
                :disabled="cameraLocked"
                @input="persistViewer"
            /></label>
            <label
              >Z
              <input
                v-model.number="rotZ"
                v-number-scrub
                type="number"
                step="0.1"
                :disabled="cameraLocked"
                @input="persistViewer"
            /></label>
          </div>
          <div class="section-label">
            {{ t('director.stage.scale') }}
          </div>
          <div class="vec-row" :class="{ disabled: cameraLocked }">
            <label
              >X
              <input
                v-model.number="scaleX"
                v-number-scrub
                type="number"
                step="0.01"
                min="0.001"
                :disabled="cameraLocked"
                @input="persistViewer"
            /></label>
            <label
              >Y
              <input
                v-model.number="scaleY"
                v-number-scrub
                type="number"
                step="0.01"
                min="0.001"
                :disabled="cameraLocked"
                @input="persistViewer"
            /></label>
            <label
              >Z
              <input
                v-model.number="scaleZ"
                v-number-scrub
                type="number"
                step="0.01"
                min="0.001"
                :disabled="cameraLocked"
                @input="persistViewer"
            /></label>
          </div>
          <label class="fov-row">
            {{ t('graph.inspector.camera.fov') }}
            <input
              v-model.number="fov"
              type="range"
              min="20"
              max="100"
              step="1"
              :disabled="cameraLocked"
              @input="onFovSliderInput"
            />
            <span>{{ fov }}&deg;</span>
          </label>
          <div class="section-label">
            {{ t('director.stage.focalLengthMm') }}
          </div>
          <div class="lens-preset-row">
            <button
              v-for="mm in focalPresetsMm"
              :key="mm"
              type="button"
              class="lens-pill"
              :class="{ active: Math.round(focalLengthMm) === mm }"
              :disabled="cameraLocked"
              @click="onPickFocalPreset(mm)"
            >
              {{ mm }}mm
            </button>
            <input
              v-model.number="focalLengthMm"
              v-number-scrub
              type="number"
              class="lens-mm-input"
              min="12"
              max="200"
              step="1"
              :disabled="cameraLocked"
              @input="onFocalLengthInput"
            />
          </div>
          <div class="section-label ground-label">
            <span>{{ t('director.stage.dollyZoomLock') }}</span>
            <button
              type="button"
              class="ground-switch"
              role="switch"
              :aria-checked="dollyZoomLock"
              :disabled="cameraLocked"
              :title="t('director.stage.dollyZoomLockHint')"
              @click="toggleDollyZoomLock"
            >
              <span class="ground-switch-thumb" />
            </button>
          </div>
          <p v-if="dollyZoomLock" class="locked-hint">
            {{ t('director.stage.dollyZoomLockHint') }}
          </p>
          <label class="uniform-row">
            {{ t('director.stage.focusDistance') }}
            <span class="uniform-control">
              <input
                v-model.number="focusDistance"
                type="range"
                min="0.5"
                max="50"
                step="0.1"
                :disabled="cameraLocked"
                @input="persistViewer"
              />
              <input
                v-model.number="focusDistance"
                v-number-scrub
                type="number"
                step="0.1"
                min="0.5"
                max="50"
                :disabled="cameraLocked"
                @input="persistViewer"
              />
            </span>
          </label>
          <label class="uniform-row">
            {{ t('director.stage.aperture') }}
            <span class="uniform-control">
              <input
                v-model.number="aperture"
                type="range"
                min="0"
                max="16"
                step="0.1"
                :disabled="cameraLocked"
                @input="persistViewer"
              />
              <input
                v-model.number="aperture"
                v-number-scrub
                type="number"
                step="0.1"
                min="0"
                max="16"
                :disabled="cameraLocked"
                @input="persistViewer"
              />
            </span>
          </label>
          <div class="section-label ground-label">
            <span>{{ t('director.stage.handheldShake') }}</span>
            <button
              type="button"
              class="ground-switch"
              role="switch"
              :aria-checked="shakeEnabled"
              :disabled="cameraLocked"
              @click="toggleShakeEnabled"
            >
              <span class="ground-switch-thumb" />
            </button>
          </div>
          <template v-if="shakeEnabled">
            <label class="uniform-row">
              {{ t('director.stage.handheldShakeIntensity') }}
              <span class="uniform-control">
                <input
                  v-model.number="shakeIntensity"
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  :disabled="cameraLocked"
                  @input="persistViewer"
                />
                <input
                  v-model.number="shakeIntensity"
                  v-number-scrub
                  type="number"
                  step="0.05"
                  min="0"
                  max="1"
                  :disabled="cameraLocked"
                  @input="persistViewer"
                />
              </span>
            </label>
            <label class="uniform-row">
              {{ t('director.stage.handheldShakeFrequency') }}
              <span class="uniform-control">
                <input
                  v-model.number="shakeFrequency"
                  type="range"
                  min="0.1"
                  max="5"
                  step="0.1"
                  :disabled="cameraLocked"
                  @input="persistViewer"
                />
                <input
                  v-model.number="shakeFrequency"
                  v-number-scrub
                  type="number"
                  step="0.1"
                  min="0.1"
                  max="5"
                  :disabled="cameraLocked"
                  @input="persistViewer"
                />
              </span>
            </label>
          </template>

          <div class="section-label ground-label">
            <span>{{ t('director.stage.cinemachine.sectionTitle') }}</span>
            <button
              v-if="hasActiveCinemachine"
              type="button"
              class="lens-pill"
              :disabled="cameraLocked"
              @click="resetCinemachineConfig"
            >
              {{ t('director.stage.cinemachine.reset') }}
            </button>
          </div>
          <label>
            {{ t('director.stage.cinemachine.bodyMode') }}
            <select
              v-model="cmBodyMode"
              :disabled="cameraLocked"
              @change="onCinemachineBodyModeChange"
            >
              <option value="none">{{ t('director.stage.cinemachine.bodyNone') }}</option>
              <option value="transposer">
                {{ t('director.stage.cinemachine.bodyTransposer') }}
              </option>
              <option value="orbital">{{ t('director.stage.cinemachine.bodyOrbital') }}</option>
              <option value="groupFraming">
                {{ t('director.stage.cinemachine.bodyGroupFraming') }}
              </option>
            </select>
          </label>
          <template v-if="cmBodyMode === 'transposer' || cmBodyMode === 'orbital'">
            <label>
              {{ t('director.stage.cinemachine.followTarget') }}
              <select v-model="cmFollowTargetId" :disabled="cameraLocked" @change="persistViewer">
                <option value="">{{ t('director.stage.cinemachine.noTarget') }}</option>
                <option v-for="sub in stageSubjectObjects" :key="sub.id" :value="sub.id">
                  {{ sub.name }}
                </option>
              </select>
            </label>
          </template>
          <template v-if="cmBodyMode === 'transposer'">
            <div class="section-label ground-label">
              <span>{{ t('director.stage.cinemachine.followOffset') }}</span>
              <button
                v-if="cmFollowTargetId"
                type="button"
                class="lens-pill"
                :disabled="cameraLocked"
                @click="captureCurrentFollowOffset"
              >
                {{ t('director.stage.cinemachine.captureOffset') }}
              </button>
            </div>
            <label>
              {{ t('director.stage.cinemachine.followSpace') }}
              <select v-model="cmFollowSpace" :disabled="cameraLocked" @change="persistViewer">
                <option value="targetLocal">
                  {{ t('director.stage.cinemachine.spaceTargetLocal') }}
                </option>
                <option value="world">{{ t('director.stage.cinemachine.spaceWorld') }}</option>
              </select>
            </label>
            <div class="vec-row" :class="{ disabled: cameraLocked }">
              <label>
                X
                <input
                  v-model.number="cmFollowOffsetX"
                  v-number-scrub
                  type="number"
                  step="0.1"
                  :disabled="cameraLocked"
                  @input="persistViewer"
                />
              </label>
              <label>
                Y
                <input
                  v-model.number="cmFollowOffsetY"
                  v-number-scrub
                  type="number"
                  step="0.1"
                  :disabled="cameraLocked"
                  @input="persistViewer"
                />
              </label>
              <label>
                Z
                <input
                  v-model.number="cmFollowOffsetZ"
                  v-number-scrub
                  type="number"
                  step="0.1"
                  :disabled="cameraLocked"
                  @input="persistViewer"
                />
              </label>
            </div>
          </template>
          <template v-if="cmBodyMode === 'orbital'">
            <label class="uniform-row">
              {{ t('director.stage.cinemachine.orbitRadius') }}
              <span class="uniform-control">
                <input
                  v-model.number="cmOrbitRadius"
                  type="range"
                  min="0.5"
                  max="30"
                  step="0.1"
                  :disabled="cameraLocked"
                  @input="persistViewer"
                />
                <input
                  v-model.number="cmOrbitRadius"
                  v-number-scrub
                  type="number"
                  step="0.1"
                  min="0.5"
                  max="30"
                  :disabled="cameraLocked"
                  @input="persistViewer"
                />
              </span>
            </label>
            <label class="uniform-row">
              {{ t('director.stage.cinemachine.orbitHeight') }}
              <span class="uniform-control">
                <input
                  v-model.number="cmOrbitHeight"
                  type="range"
                  min="-5"
                  max="15"
                  step="0.1"
                  :disabled="cameraLocked"
                  @input="persistViewer"
                />
                <input
                  v-model.number="cmOrbitHeight"
                  v-number-scrub
                  type="number"
                  step="0.1"
                  min="-5"
                  max="15"
                  :disabled="cameraLocked"
                  @input="persistViewer"
                />
              </span>
            </label>
            <label class="uniform-row">
              {{ t('director.stage.cinemachine.orbitSpeed') }}
              <span class="uniform-control">
                <input
                  v-model.number="cmOrbitSpeed"
                  type="range"
                  min="-180"
                  max="180"
                  step="1"
                  :disabled="cameraLocked"
                  @input="persistViewer"
                />
                <input
                  v-model.number="cmOrbitSpeed"
                  v-number-scrub
                  type="number"
                  step="1"
                  min="-180"
                  max="180"
                  :disabled="cameraLocked"
                  @input="persistViewer"
                />
              </span>
            </label>
            <label class="uniform-row">
              {{ t('director.stage.cinemachine.orbitStartAngle') }}
              <span class="uniform-control">
                <input
                  v-model.number="cmOrbitStartAngle"
                  type="range"
                  min="-180"
                  max="180"
                  step="5"
                  :disabled="cameraLocked"
                  @input="persistViewer"
                />
                <input
                  v-model.number="cmOrbitStartAngle"
                  v-number-scrub
                  type="number"
                  step="5"
                  min="-180"
                  max="180"
                  :disabled="cameraLocked"
                  @input="persistViewer"
                />
              </span>
            </label>
          </template>
          <template v-if="cmBodyMode === 'groupFraming'">
            <label class="uniform-row">
              {{ t('director.stage.cinemachine.groupFramingScale') }}
              <span class="uniform-control">
                <input
                  v-model.number="cmGroupFramingScale"
                  type="range"
                  min="0.6"
                  max="3"
                  step="0.05"
                  :disabled="cameraLocked"
                  @input="persistViewer"
                />
                <input
                  v-model.number="cmGroupFramingScale"
                  v-number-scrub
                  type="number"
                  step="0.05"
                  min="0.6"
                  max="3"
                  :disabled="cameraLocked"
                  @input="persistViewer"
                />
              </span>
            </label>
          </template>
          <label v-if="cmBodyMode !== 'none'" class="uniform-row">
            {{ t('director.stage.cinemachine.positionDamping') }}
            <span class="uniform-control">
              <input
                v-model.number="cmPositionDamping"
                type="range"
                min="0"
                max="5"
                step="0.05"
                :disabled="cameraLocked"
                @input="persistViewer"
              />
              <input
                v-model.number="cmPositionDamping"
                v-number-scrub
                type="number"
                step="0.05"
                min="0"
                max="5"
                :disabled="cameraLocked"
                @input="persistViewer"
              />
            </span>
          </label>

          <label>
            {{ t('director.stage.cinemachine.aimMode') }}
            <select
              v-model="cmAimMode"
              :disabled="cameraLocked"
              @change="onCinemachineAimModeChange"
            >
              <option value="none">{{ t('director.stage.cinemachine.aimNone') }}</option>
              <option value="composer">{{ t('director.stage.cinemachine.aimComposer') }}</option>
              <option value="groupComposer">
                {{ t('director.stage.cinemachine.aimGroupComposer') }}
              </option>
            </select>
          </label>
          <template v-if="cmAimMode === 'composer'">
            <label>
              {{ t('director.stage.cinemachine.lookAtTarget') }}
              <select v-model="cmLookAtTargetId" :disabled="cameraLocked" @change="persistViewer">
                <option value="">{{ t('director.stage.cinemachine.noTarget') }}</option>
                <option v-for="sub in stageSubjectObjects" :key="sub.id" :value="sub.id">
                  {{ sub.name }}
                </option>
              </select>
            </label>
            <label>
              {{ t('director.stage.cinemachine.aimTargetPart') }}
              <select v-model="cmAimTargetPart" :disabled="cameraLocked" @change="persistViewer">
                <option value="head">{{ t('director.stage.cinemachine.partHead') }}</option>
                <option value="chest">{{ t('director.stage.cinemachine.partChest') }}</option>
                <option value="root">{{ t('director.stage.cinemachine.partRoot') }}</option>
              </select>
            </label>
          </template>
          <template v-if="cmAimMode === 'composer' || cmAimMode === 'groupComposer'">
            <div class="section-label">
              {{ t('director.stage.cinemachine.screenComposition') }}
            </div>
            <div class="lens-preset-row">
              <button
                type="button"
                class="lens-pill"
                :class="{
                  active: Math.abs(cmScreenOffsetX) < 0.05 && Math.abs(cmScreenOffsetY) < 0.05
                }"
                :disabled="cameraLocked"
                @click="applyScreenCompositionPreset(0, 0)"
              >
                {{ t('director.stage.cinemachine.presetCenter') }}
              </button>
              <button
                type="button"
                class="lens-pill"
                :class="{
                  active:
                    Math.abs(cmScreenOffsetX + 0.33) < 0.06 &&
                    Math.abs(cmScreenOffsetY - 0.12) < 0.08
                }"
                :disabled="cameraLocked"
                @click="applyScreenCompositionPreset(-0.33, 0.12)"
              >
                {{ t('director.stage.cinemachine.presetLeftThird') }}
              </button>
              <button
                type="button"
                class="lens-pill"
                :class="{
                  active:
                    Math.abs(cmScreenOffsetX - 0.33) < 0.06 &&
                    Math.abs(cmScreenOffsetY - 0.12) < 0.08
                }"
                :disabled="cameraLocked"
                @click="applyScreenCompositionPreset(0.33, 0.12)"
              >
                {{ t('director.stage.cinemachine.presetRightThird') }}
              </button>
              <button
                type="button"
                class="lens-pill"
                :class="{
                  active:
                    Math.abs(cmScreenOffsetX) < 0.06 && Math.abs(cmScreenOffsetY + 0.22) < 0.08
                }"
                :disabled="cameraLocked"
                @click="applyScreenCompositionPreset(0, -0.22)"
              >
                {{ t('director.stage.cinemachine.presetHeroLow') }}
              </button>
            </div>
            <label class="uniform-row">
              {{ t('director.stage.cinemachine.screenOffsetX') }}
              <span class="uniform-control">
                <input
                  v-model.number="cmScreenOffsetX"
                  type="range"
                  min="-0.8"
                  max="0.8"
                  step="0.02"
                  :disabled="cameraLocked"
                  @input="persistViewer"
                />
                <input
                  v-model.number="cmScreenOffsetX"
                  v-number-scrub
                  type="number"
                  step="0.02"
                  min="-0.8"
                  max="0.8"
                  :disabled="cameraLocked"
                  @input="persistViewer"
                />
              </span>
            </label>
            <label class="uniform-row">
              {{ t('director.stage.cinemachine.screenOffsetY') }}
              <span class="uniform-control">
                <input
                  v-model.number="cmScreenOffsetY"
                  type="range"
                  min="-0.8"
                  max="0.8"
                  step="0.02"
                  :disabled="cameraLocked"
                  @input="persistViewer"
                />
                <input
                  v-model.number="cmScreenOffsetY"
                  v-number-scrub
                  type="number"
                  step="0.02"
                  min="-0.8"
                  max="0.8"
                  :disabled="cameraLocked"
                  @input="persistViewer"
                />
              </span>
            </label>
            <label class="uniform-row">
              {{ t('director.stage.cinemachine.deadZoneWidth') }}
              <span class="uniform-control">
                <input
                  v-model.number="cmDeadZoneWidth"
                  type="range"
                  min="0"
                  max="0.8"
                  step="0.02"
                  :disabled="cameraLocked"
                  @input="persistViewer"
                />
                <input
                  v-model.number="cmDeadZoneWidth"
                  v-number-scrub
                  type="number"
                  step="0.02"
                  min="0"
                  max="0.8"
                  :disabled="cameraLocked"
                  @input="persistViewer"
                />
              </span>
            </label>
            <label class="uniform-row">
              {{ t('director.stage.cinemachine.deadZoneHeight') }}
              <span class="uniform-control">
                <input
                  v-model.number="cmDeadZoneHeight"
                  type="range"
                  min="0"
                  max="0.8"
                  step="0.02"
                  :disabled="cameraLocked"
                  @input="persistViewer"
                />
                <input
                  v-model.number="cmDeadZoneHeight"
                  v-number-scrub
                  type="number"
                  step="0.02"
                  min="0"
                  max="0.8"
                  :disabled="cameraLocked"
                  @input="persistViewer"
                />
              </span>
            </label>
            <label class="uniform-row">
              {{ t('director.stage.cinemachine.aimDamping') }}
              <span class="uniform-control">
                <input
                  v-model.number="cmAimDamping"
                  type="range"
                  min="0"
                  max="5"
                  step="0.05"
                  :disabled="cameraLocked"
                  @input="persistViewer"
                />
                <input
                  v-model.number="cmAimDamping"
                  v-number-scrub
                  type="number"
                  step="0.05"
                  min="0"
                  max="5"
                  :disabled="cameraLocked"
                  @input="persistViewer"
                />
              </span>
            </label>
            <div class="section-label ground-label">
              <span>{{ t('director.stage.cinemachine.autoFocusPull') }}</span>
              <button
                type="button"
                class="ground-switch"
                role="switch"
                :aria-checked="cmAutoFocusPull"
                :disabled="cameraLocked"
                :title="t('director.stage.cinemachine.autoFocusPullHint')"
                @click="toggleCmAutoFocusPull"
              >
                <span class="ground-switch-thumb" />
              </button>
            </div>
          </template>

          <label>
            {{ t('director.stage.cinemachine.noisePreset') }}
            <select v-model="cmNoisePreset" :disabled="cameraLocked" @change="persistViewer">
              <option value="none">{{ t('director.stage.cinemachine.noiseNone') }}</option>
              <option value="handheld">
                {{ t('director.stage.cinemachine.noiseHandheld') }}
              </option>
              <option value="telephoto">
                {{ t('director.stage.cinemachine.noiseTelephoto') }}
              </option>
              <option value="carMount">
                {{ t('director.stage.cinemachine.noiseCarMount') }}
              </option>
              <option value="droneHover">
                {{ t('director.stage.cinemachine.noiseDroneHover') }}
              </option>
            </select>
          </label>
          <label class="uniform-row">
            {{ t('director.stage.cinemachine.impulseIntensity') }}
            <span class="uniform-control">
              <input
                v-model.number="cmImpulseIntensity"
                type="range"
                min="0"
                max="2"
                step="0.05"
                :disabled="cameraLocked"
                @input="persistViewer"
              />
              <input
                v-model.number="cmImpulseIntensity"
                v-number-scrub
                type="number"
                step="0.05"
                min="0"
                max="2"
                :disabled="cameraLocked"
                @input="persistViewer"
              />
            </span>
          </label>
          <template v-if="cmImpulseIntensity > 0">
            <div class="section-label ground-label">
              <span>{{ t('director.stage.cinemachine.impulseTimeSec') }}</span>
              <button
                type="button"
                class="lens-pill"
                :disabled="cameraLocked"
                @click="triggerImpulseAtPlayhead"
              >
                {{ t('director.stage.cinemachine.impulseAtPlayhead') }}
              </button>
            </div>
            <label class="uniform-row">
              {{ t('director.stage.cinemachine.impulseTimeSec') }}
              <span class="uniform-control">
                <input
                  v-model.number="cmImpulseTimeSec"
                  type="range"
                  min="0"
                  :max="scene.stage.value.animation?.duration ?? 10"
                  step="0.05"
                  :disabled="cameraLocked"
                  @input="persistViewer"
                />
                <input
                  v-model.number="cmImpulseTimeSec"
                  v-number-scrub
                  type="number"
                  step="0.05"
                  min="0"
                  :disabled="cameraLocked"
                  @input="persistViewer"
                />
              </span>
            </label>
          </template>
        </div>
      </template>

      <template v-else-if="obj">
        <p v-if="editingKeyframeHint" class="keyframe-hint">
          {{ editingKeyframeHint }}
        </p>
        <p v-if="obj.locked" class="locked-hint">
          {{ t('director.stage.lockedHint') }}
        </p>
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
          <div class="section-label">
            {{ t('director.stage.position') }}
          </div>
          <div class="vec-row" :class="{ disabled: obj.locked }">
            <label
              >X
              <input
                v-model.number="objPosX"
                v-number-scrub
                type="number"
                step="0.01"
                :disabled="obj.locked"
                @input="persistObject"
            /></label>
            <label
              >Y
              <input
                v-model.number="objPosY"
                v-number-scrub
                type="number"
                step="0.01"
                :disabled="obj.locked"
                @input="persistObject"
            /></label>
            <label
              >Z
              <input
                v-model.number="objPosZ"
                v-number-scrub
                type="number"
                step="0.01"
                :disabled="obj.locked"
                @input="persistObject"
            /></label>
          </div>
          <div class="section-label">
            {{ t('director.stage.rotationDeg') }}
          </div>
          <div class="vec-row" :class="{ disabled: obj.locked }">
            <label
              >X
              <input
                v-model.number="objRotX"
                v-number-scrub
                type="number"
                step="0.1"
                :disabled="obj.locked"
                @input="persistObject"
            /></label>
            <label
              >Y
              <input
                v-model.number="objRotY"
                v-number-scrub
                type="number"
                step="0.1"
                :disabled="obj.locked"
                @input="persistObject"
            /></label>
            <label
              >Z
              <input
                v-model.number="objRotZ"
                v-number-scrub
                type="number"
                step="0.1"
                :disabled="obj.locked"
                @input="persistObject"
            /></label>
          </div>
          <div v-if="obj.kind !== 'light'" class="section-label">
            {{ t('director.stage.scale') }}
          </div>
          <div v-if="obj.kind !== 'light'" class="vec-row" :class="{ disabled: obj.locked }">
            <label
              >X
              <input
                v-model.number="objScaleX"
                v-number-scrub
                type="number"
                step="0.01"
                min="0.001"
                :disabled="obj.locked"
                @input="persistObject"
            /></label>
            <label
              >Y
              <input
                v-model.number="objScaleY"
                v-number-scrub
                type="number"
                step="0.01"
                min="0.001"
                :disabled="obj.locked"
                @input="persistObject"
            /></label>
            <label
              >Z
              <input
                v-model.number="objScaleZ"
                v-number-scrub
                type="number"
                step="0.01"
                min="0.001"
                :disabled="obj.locked"
                @input="persistObject"
            /></label>
          </div>
          <label v-if="obj.kind !== 'light'" class="uniform-row">
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
          <template v-if="obj.kind === 'light'">
            <div class="section-label">
              {{ t('director.stage.lightSection') }}
            </div>
            <label>
              {{ t('director.stage.lightType') }}
              <input :value="lightTypeLabel" type="text" disabled />
            </label>
            <label class="uniform-row">
              {{ t('director.stage.lightIntensity') }}
              <span class="uniform-control">
                <input
                  v-model.number="lightIntensity"
                  type="range"
                  min="0"
                  max="8"
                  step="0.05"
                  :disabled="obj.locked"
                  @input="persistLight"
                />
                <input
                  v-model.number="lightIntensity"
                  v-number-scrub
                  type="number"
                  step="0.05"
                  min="0"
                  :disabled="obj.locked"
                  @input="persistLight"
                />
              </span>
            </label>
            <template v-if="isAttenuatedLight">
              <label class="uniform-row">
                {{ t('director.stage.lightDistance') }}
                <span class="uniform-control">
                  <input
                    v-model.number="lightDistance"
                    type="range"
                    min="0"
                    max="50"
                    step="0.5"
                    :disabled="obj.locked"
                    @input="persistLight"
                  />
                  <input
                    v-model.number="lightDistance"
                    v-number-scrub
                    type="number"
                    step="0.5"
                    min="0"
                    :disabled="obj.locked"
                    @input="persistLight"
                  />
                </span>
              </label>
              <label class="uniform-row">
                {{ t('director.stage.lightDecay') }}
                <span class="uniform-control">
                  <input
                    v-model.number="lightDecay"
                    type="range"
                    min="0"
                    max="4"
                    step="0.05"
                    :disabled="obj.locked"
                    @input="persistLight"
                  />
                  <input
                    v-model.number="lightDecay"
                    v-number-scrub
                    type="number"
                    step="0.05"
                    min="0"
                    :disabled="obj.locked"
                    @input="persistLight"
                  />
                </span>
              </label>
            </template>
            <template v-if="obj.light?.type === 'spot'">
              <label class="uniform-row">
                {{ t('director.stage.lightAngleDeg') }}
                <span class="uniform-control">
                  <input
                    v-model.number="lightAngleDeg"
                    type="range"
                    min="1"
                    max="90"
                    step="0.5"
                    :disabled="obj.locked"
                    @input="persistLight"
                  />
                  <input
                    v-model.number="lightAngleDeg"
                    v-number-scrub
                    type="number"
                    step="0.5"
                    min="1"
                    max="90"
                    :disabled="obj.locked"
                    @input="persistLight"
                  />
                </span>
              </label>
              <label class="uniform-row">
                {{ t('director.stage.lightPenumbra') }}
                <span class="uniform-control">
                  <input
                    v-model.number="lightPenumbra"
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    :disabled="obj.locked"
                    @input="persistLight"
                  />
                  <input
                    v-model.number="lightPenumbra"
                    v-number-scrub
                    type="number"
                    step="0.01"
                    min="0"
                    max="1"
                    :disabled="obj.locked"
                    @input="persistLight"
                  />
                </span>
              </label>
            </template>
            <div class="section-label ground-label">
              <span>{{ t('director.stage.lightCastShadow') }}</span>
              <button
                type="button"
                class="ground-switch"
                role="switch"
                :aria-checked="lightCastShadow"
                :disabled="obj.locked"
                @click="toggleLightCastShadow"
              >
                <span class="ground-switch-thumb" />
              </button>
            </div>
            <p class="locked-hint">
              {{ t('director.stage.lightAimHint') }}
            </p>
          </template>
          <template v-if="objectMaterialRows.length">
            <div class="section-label">
              {{ t('director.stage.textures') }}
            </div>
            <div v-for="row in objectMaterialRows" :key="row.key" class="material-textures">
              <div class="material-name">
                {{ formatMaterialSlotLabel(row.label) }}
              </div>
              <div v-for="slotRow in row.slots" :key="slotRow.slot" class="texture-slot-row">
                <span class="texture-slot-name">
                  {{ t(slotRow.labelKey) }}
                </span>
                <span
                  class="texture-slot-body"
                  :class="{ filled: slotRow.path }"
                  :title="t('director.stage.textureHint')"
                  @dragover.prevent
                  @drop.prevent="onTextureSlotDrop(row.key, slotRow.slot, $event)"
                >
                  <img
                    v-if="slotRow.thumb"
                    class="texture-thumb"
                    :src="slotRow.thumb"
                    :alt="row.label"
                  />
                  <span v-else-if="slotRow.path" class="texture-thumb texture-thumb-loading"
                    >…</span
                  >
                  <span v-else-if="slotRow.hidden" class="texture-thumb texture-thumb-empty">{{
                    t('director.stage.textureSlotHidden')
                  }}</span>
                  <span v-else class="texture-thumb texture-thumb-empty">{{
                    t('director.stage.textureSlotEmpty')
                  }}</span>
                </span>
                <button
                  type="button"
                  class="texture-clear"
                  :class="{ active: slotRow.hidden }"
                  :title="
                    slotRow.hidden
                      ? t('director.stage.textureShow')
                      : t('director.stage.textureHide')
                  "
                  @click="toggleObjectTextureHidden(row.key, slotRow.slot, slotRow.hidden)"
                >
                  ⊘
                </button>
                <button
                  v-if="slotRow.path || slotRow.hidden"
                  type="button"
                  class="texture-clear"
                  :title="t('director.stage.textureReset')"
                  @click="resetObjectTexture(row.key, slotRow.slot)"
                >
                  ✕
                </button>
              </div>
            </div>
            <p class="texture-hint">
              {{ t('director.stage.textureHint') }}
            </p>
          </template>
        </div>
        <div v-else class="fields pose-panel">
          <div class="pose-media-open-row">
            <button
              type="button"
              class="pose-media-open-btn"
              :disabled="obj.locked || !poseBoneNames.length"
              :title="t('director.stage.poseFromMediaHint')"
              @click="openPoseFromMediaDialog"
            >
              <span class="pose-media-open-icon">+</span>
              {{ t('director.stage.poseFromMediaOpen') }}
            </button>
          </div>
          <div class="section-label">
            {{ t('director.stage.poseAssets') }}
          </div>
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
            <p v-else class="pose-hint">
              {{ t('director.stage.poseAssetsEmpty') }}
            </p>
            <p v-if="poseAssetApplyHint" class="pose-hint">
              {{ poseAssetApplyHint }}
            </p>
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
            {{ t('director.stage.expressivePoseTitle') }}
          </div>
          <div class="pose-preset-list">
            <button
              v-for="preset in expressivePosePresets"
              :key="preset.id"
              type="button"
              class="pose-asset-chip"
              :disabled="obj.locked || !poseBoneNames.length"
              @click="onApplyExpressivePose(preset.id)"
            >
              <span class="pose-asset-name">{{ t(preset.labelKey) }}</span>
            </button>
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
            <p class="pose-hint">
              {{ t('director.stage.poseIkHint') }}
            </p>
            <p class="pose-hint">
              {{ t('director.stage.poseIkManualHint') }}
            </p>
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
                  <span v-if="slot.manual" class="pose-ik-badge">{{
                    t('director.stage.poseIkManual')
                  }}</span>
                </button>
                <select
                  class="pose-ik-select"
                  :disabled="obj.locked"
                  :value="slot.manual ? (slot.effector ?? '') : ''"
                  @change="onIkEffectorChange(slot.id, $event)"
                >
                  <option value="">
                    {{
                      slot.autoEffector
                        ? t('director.stage.poseIkUseAuto', {
                            name: formatBoneLabel(slot.autoEffector)
                          })
                        : t('director.stage.poseIkPickBone')
                    }}
                  </option>
                  <option v-for="bone in poseBoneNames" :key="bone" :value="bone">
                    {{ formatBoneLabel(bone) }}
                  </option>
                </select>
              </div>
            </div>
            <p v-if="!ikTargetSlots.some((s) => s.effector)" class="pose-hint">
              {{ t('director.stage.poseIkChainsEmpty') }}
            </p>
          </template>
          <template v-else>
            <p class="pose-hint">
              {{ t('director.stage.poseViewportHint') }}
            </p>
            <p v-if="!poseBoneNames.length" class="pose-hint">
              {{ t('director.stage.poseBonesEmpty') }}
            </p>
            <div v-else class="pose-bone-list">
              <div
                v-for="bone in poseBoneNames"
                :key="bone"
                class="pose-bone"
                :class="{ active: selectedPoseBone === bone }"
                @click="onPoseBoneSelect(bone)"
              >
                <div class="pose-bone-name" :title="bone">
                  {{ formatBoneLabel(bone) }}
                </div>
                <div class="pose-bone-sliders" @click.stop>
                  <label v-for="axis in poseAxes" :key="axis" class="pose-axis">
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
          <div class="section-label ground-label">
            <span>{{ t('director.stage.panoramaBackground') }}</span>
            <button
              type="button"
              class="ground-switch"
              role="switch"
              :aria-checked="panoramaVisible"
              :title="
                panoramaVisible
                  ? t('director.stage.hidePanorama')
                  : t('director.stage.showPanorama')
              "
              @click.stop="togglePanoramaVisible"
            >
              <span class="ground-switch-thumb" />
            </button>
          </div>
          <div
            class="panorama-drop"
            :class="{ active: panoramaDragOver, filled: !!linkedPanoramaName }"
            @dragenter.prevent="onPanoramaDragEnter"
            @dragover.prevent="onPanoramaDragOver"
            @dragleave="onPanoramaDragLeave"
            @drop.prevent="onPanoramaDrop"
          >
            <template v-if="linkedPanoramaName">
              <span class="panorama-drop-name" :title="linkedPanoramaName">{{
                linkedPanoramaName
              }}</span>
              <button
                type="button"
                class="panorama-drop-remove"
                :title="t('director.stage.panoramaRemove')"
                @click.stop="clearLinkedPanorama"
              >
                ×
              </button>
            </template>
            <span v-else class="panorama-drop-hint">{{
              t('director.stage.panoramaDropHint')
            }}</span>
          </div>
          <label class="color-row">
            {{ t('director.stage.skyColor') }}
            <span class="color-control">
              <input v-model="skyColor" type="color" @input="persistSkyColor" />
              <input v-model="skyColor" type="text" @input="persistSkyColor" />
            </span>
          </label>

          <div class="section-label">
            {{ t('director.stage.panoramaSphere') }}
          </div>
          <label class="uniform-row">
            {{ t('director.stage.panoramaYaw') }}
            <span class="uniform-control">
              <input
                v-model.number="panoramaYaw"
                type="range"
                min="-180"
                max="180"
                step="1"
                @input="persistPanoramaYaw"
              />
              <input
                v-model.number="panoramaYaw"
                v-number-scrub
                type="number"
                step="1"
                @input="persistPanoramaYaw"
              />
            </span>
          </label>
          <label class="uniform-row">
            {{ t('director.stage.panoramaRadius') }}
            <span class="uniform-control">
              <input
                v-model.number="panoramaRadius"
                type="range"
                min="10"
                max="1000"
                step="1"
                @input="persistPanoramaRadius"
              />
              <input
                v-model.number="panoramaRadius"
                v-number-scrub
                type="number"
                step="1"
                min="10"
                @input="persistPanoramaRadius"
              />
            </span>
          </label>

          <div class="section-label">
            {{ t('director.stage.sceneGlobal') }}
          </div>
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
          <div class="section-label">
            {{ t('director.stage.sceneTranslation') }}
          </div>
          <div class="vec-row">
            <label
              >X
              <input
                v-model.number="scenePosX"
                v-number-scrub
                type="number"
                step="0.01"
                @input="persistSceneWorld"
            /></label>
            <label
              >Y
              <input
                v-model.number="scenePosY"
                v-number-scrub
                type="number"
                step="0.01"
                @input="persistSceneWorld"
            /></label>
            <label
              >Z
              <input
                v-model.number="scenePosZ"
                v-number-scrub
                type="number"
                step="0.01"
                @input="persistSceneWorld"
            /></label>
          </div>
          <div class="section-label">
            {{ t('director.stage.sceneRotation') }}
          </div>
          <div class="vec-row">
            <label
              >X
              <input
                v-model.number="sceneRotX"
                v-number-scrub
                type="number"
                step="0.1"
                @input="persistSceneWorld"
            /></label>
            <label
              >Y
              <input
                v-model.number="sceneRotY"
                v-number-scrub
                type="number"
                step="0.1"
                @input="persistSceneWorld"
            /></label>
            <label
              >Z
              <input
                v-model.number="sceneRotZ"
                v-number-scrub
                type="number"
                step="0.1"
                @input="persistSceneWorld"
            /></label>
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

          <div class="section-label ground-label">
            <span>{{ t('director.stage.shadowCatcher') }}</span>
            <button
              type="button"
              class="ground-switch"
              role="switch"
              :aria-checked="shadowCatcherEnabled"
              @click="toggleShadowCatcherEnabled"
            >
              <span class="ground-switch-thumb" />
            </button>
          </div>
          <label class="uniform-row" :class="{ disabled: !shadowCatcherEnabled }">
            {{ t('director.stage.shadowCatcherOpacity') }}
            <span class="uniform-control">
              <input
                v-model.number="shadowCatcherOpacity"
                type="range"
                min="0"
                max="1"
                step="0.02"
                :disabled="!shadowCatcherEnabled"
                @input="persistStageEnv"
              />
              <input
                v-model.number="shadowCatcherOpacity"
                v-number-scrub
                type="number"
                step="0.02"
                min="0"
                max="1"
                :disabled="!shadowCatcherEnabled"
                @input="persistStageEnv"
              />
            </span>
          </label>

          <div class="section-label ground-label">
            <span>{{ t('director.stage.fog') }}</span>
            <button
              type="button"
              class="ground-switch"
              role="switch"
              :aria-checked="fogEnabled"
              @click="toggleFogEnabled"
            >
              <span class="ground-switch-thumb" />
            </button>
          </div>
          <template v-if="fogEnabled">
            <label class="uniform-row">
              {{ t('director.stage.fogDensity') }}
              <span class="uniform-control">
                <input
                  v-model.number="fogDensity"
                  type="range"
                  min="0"
                  max="0.15"
                  step="0.002"
                  @input="persistStageEnv"
                />
                <input
                  v-model.number="fogDensity"
                  v-number-scrub
                  type="number"
                  step="0.002"
                  min="0"
                  max="0.15"
                  @input="persistStageEnv"
                />
              </span>
            </label>
            <label class="color-row">
              {{ t('director.stage.fogColor') }}
              <span class="color-control">
                <input v-model="fogColor" type="color" @input="persistStageEnv" />
                <input v-model="fogColor" type="text" @input="persistStageEnv" />
              </span>
            </label>
          </template>

          <div class="section-label">
            {{ t('director.stage.lightingPresetTitle') }}
          </div>
          <div class="pose-preset-list">
            <button
              v-for="preset in lightingPresets"
              :key="preset.id"
              type="button"
              class="pose-asset-chip"
              @click="onApplyLightingPreset(preset.id)"
            >
              <span class="pose-asset-name">{{ t(preset.labelKey) }}</span>
            </button>
          </div>

          <div class="section-label ground-label">
            <span>{{ t('director.stage.cinematographyPromptTitle') }}</span>
            <button type="button" class="prompt-copy-btn" @click="onCopyCinematographyPrompt">
              {{
                promptCopied
                  ? t('director.stage.cinematographyPromptCopied')
                  : t('director.stage.cinematographyPromptCopy')
              }}
            </button>
          </div>
          <div class="prompt-preview-box">
            {{ scene.cinematographyPrompt.value }}
          </div>
        </div>
      </template>

      <template v-else-if="showPanoramaProps">
        <div class="fields">
          <div class="section-label ground-label">
            <span>{{ t('director.stage.panoramaBackground') }}</span>
            <button
              type="button"
              class="ground-switch"
              role="switch"
              :aria-checked="panoramaVisible"
              :title="
                panoramaVisible
                  ? t('director.stage.hidePanorama')
                  : t('director.stage.showPanorama')
              "
              @click.stop="togglePanoramaVisible"
            >
              <span class="ground-switch-thumb" />
            </button>
          </div>
          <div
            class="panorama-drop"
            :class="{ active: panoramaDragOver, filled: !!linkedPanoramaName }"
            @dragenter.prevent="onPanoramaDragEnter"
            @dragover.prevent="onPanoramaDragOver"
            @dragleave="onPanoramaDragLeave"
            @drop.prevent="onPanoramaDrop"
          >
            <template v-if="linkedPanoramaName">
              <span class="panorama-drop-name" :title="linkedPanoramaName">{{
                linkedPanoramaName
              }}</span>
              <button
                type="button"
                class="panorama-drop-remove"
                :title="t('director.stage.panoramaRemove')"
                @click.stop="clearLinkedPanorama"
              >
                ×
              </button>
            </template>
            <span v-else class="panorama-drop-hint">{{
              t('director.stage.panoramaDropHint')
            }}</span>
          </div>
          <label class="color-row">
            {{ t('director.stage.skyColor') }}
            <span class="color-control">
              <input v-model="skyColor" type="color" @input="persistSkyColor" />
              <input v-model="skyColor" type="text" @input="persistSkyColor" />
            </span>
          </label>
          <div class="section-label">
            {{ t('director.stage.panoramaSphere') }}
          </div>
          <label class="uniform-row">
            {{ t('director.stage.panoramaYaw') }}
            <span class="uniform-control">
              <input
                v-model.number="panoramaYaw"
                type="range"
                min="-180"
                max="180"
                step="1"
                @input="persistPanoramaYaw"
              />
              <input
                v-model.number="panoramaYaw"
                v-number-scrub
                type="number"
                step="1"
                @input="persistPanoramaYaw"
              />
            </span>
          </label>
          <label class="uniform-row">
            {{ t('director.stage.panoramaRadius') }}
            <span class="uniform-control">
              <input
                v-model.number="panoramaRadius"
                type="range"
                min="10"
                max="1000"
                step="1"
                @input="persistPanoramaRadius"
              />
              <input
                v-model.number="panoramaRadius"
                v-number-scrub
                type="number"
                step="1"
                min="10"
                @input="persistPanoramaRadius"
              />
            </span>
          </label>
        </div>
      </template>

      <p v-else class="empty">
        {{ t('director.stage.selectHint') }}
      </p>
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

  <DirectorPoseFromMediaDialog
    :open="poseFromMediaOpen"
    :scene="scene"
    :object-id="obj?.id ?? ''"
    :object-name="obj?.name ?? ''"
    :object-locked="obj?.locked ?? false"
    @close="closePoseFromMediaDialog"
  />
</template>
<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import {
  createDefaultDirectorViewer,
  DEFAULT_DIRECTOR_CAMERA_FOV,
  DEFAULT_DIRECTOR_PANORAMA_RADIUS,
  DEFAULT_DIRECTOR_SKY_COLOR,
  DIRECTOR_EXPRESSIVE_POSE_PRESETS,
  DIRECTOR_FOCAL_LENGTH_PRESETS_MM,
  DIRECTOR_LIGHTING_PRESETS,
  focalLengthMmToFov,
  fovToFocalLengthMm,
  isDirectorSkyFollowTheme,
  DEFAULT_GRID_OFFSET_Y,
  DEFAULT_GRID_OPACITY,
  DEFAULT_GRID_VISIBLE,
  directorAspectRatioValue,
  directorViewerHasActiveCinemachine,
  directorViewerRotationFromLook,
  MODEL_POSE_ICON,
  normalizeDirectorSkyColor,
  readDirectorSceneWorld,
  readModelAssetColor,
  isPoseModelAsset,
  type DirectorCinemachineAimMode,
  type DirectorCinemachineAimPart,
  type DirectorCinemachineBodyMode,
  type DirectorCinemachineFollowSpace,
  type DirectorCinemachineNoisePreset,
  type DirectorLightingPresetId,
  type StageTextureSlot,
  createDefaultStageLightParams,
  normalizeStageLightParams
} from '@shared/domain'
import { resolveAssetPreviewUrl } from '../features/media/assetUrlCache'
import { useStudioI18n } from '../composables/useStudioI18n'
import { vNumberScrub } from '../directives/numberScrub'
import { themePreference } from '../editor/preferences'
import {
  bindLiveDirectorStageScene,
  resolveDirectorStageScene
} from '../features/director/activeDirectorStageScene'
import { directorStageSceneKey } from '../features/director/stageSceneKey'
import { useProjectStore } from '../stores/project'
import {
  STUDIO_ASSET_DRAG_MIME,
  STUDIO_ASSET_ID_DRAG_MIME,
  STUDIO_ASSET_IDS_DRAG_MIME,
  useWorkspaceStore
} from '../stores/workspace'
import SaveAssetDialog from './SaveAssetDialog.vue'
import DirectorPoseFromMediaDialog from './DirectorPoseFromMediaDialog.vue'

withDefaults(
  defineProps<{
    /** Dock 外层 Inspector 时为 true（压缩边距） */
    embedded?: boolean
  }>(),
  { embedded: false }
)

const { t, te } = useStudioI18n()
const injectedScene = inject(directorStageSceneKey, null)
if (!resolveDirectorStageScene(injectedScene)) {
  throw new Error('DirectorStageInspector requires an active director stage scene')
}
const scene = bindLiveDirectorStageScene(injectedScene)
const workspace = useWorkspaceStore()
const project = useProjectStore()

const previewCanvas = ref<HTMLCanvasElement | null>(null)
const panoramaDragOver = ref(false)

const poseFromMediaOpen = ref(false)

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
const focalLengthMm = ref(fovToFocalLengthMm(DEFAULT_DIRECTOR_CAMERA_FOV))
const dollyZoomLock = ref(false)
const focusDistance = ref(3.5)
const aperture = ref(0)
const shakeEnabled = ref(false)
const shakeIntensity = ref(0.25)
const shakeFrequency = ref(1.2)
const cmBodyMode = ref<DirectorCinemachineBodyMode>('none')
const cmFollowTargetId = ref('')
const cmFollowSpace = ref<DirectorCinemachineFollowSpace>('targetLocal')
const cmFollowOffsetX = ref(0)
const cmFollowOffsetY = ref(1.6)
const cmFollowOffsetZ = ref(3.2)
const cmPositionDamping = ref(0.35)
const cmOrbitRadius = ref(3.2)
const cmOrbitHeight = ref(1.5)
const cmOrbitSpeed = ref(36)
const cmOrbitStartAngle = ref(0)
const cmGroupFramingScale = ref(1.35)
const cmAimMode = ref<DirectorCinemachineAimMode>('none')
const cmLookAtTargetId = ref('')
const cmAimTargetPart = ref<DirectorCinemachineAimPart>('head')
const cmScreenOffsetX = ref(0)
const cmScreenOffsetY = ref(0)
const cmDeadZoneWidth = ref(0)
const cmDeadZoneHeight = ref(0)
const cmAimDamping = ref(0.25)
const cmAutoFocusPull = ref(false)
const cmNoisePreset = ref<DirectorCinemachineNoisePreset>('none')
const cmImpulseIntensity = ref(0)
const cmImpulseTimeSec = ref(0)
const focalPresetsMm = DIRECTOR_FOCAL_LENGTH_PRESETS_MM
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
const lightIntensity = ref(1)
const lightDistance = ref(0)
const lightDecay = ref(2)
const lightAngleDeg = ref(30)
const lightPenumbra = ref(0.25)
const lightCastShadow = ref(true)
const objUniformScale = ref(1)
const isEditingObject = ref(false)
const objectInspectorTab = ref<'props' | 'pose'>('props')
const expressivePosePresets = DIRECTOR_EXPRESSIVE_POSE_PRESETS

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
const panoramaVisible = ref(true)
const panoramaRadius = ref(DEFAULT_DIRECTOR_PANORAMA_RADIUS)
const gridVisible = ref(DEFAULT_GRID_VISIBLE)
const gridOpacity = ref(DEFAULT_GRID_OPACITY)
const gridOffsetY = ref(DEFAULT_GRID_OFFSET_Y)
const shadowCatcherEnabled = ref(true)
const shadowCatcherOpacity = ref(0.35)
const fogEnabled = ref(false)
const fogDensity = ref(0.025)
const fogColor = ref('#0f141c')
const promptCopied = ref(false)
const lightingPresets: Array<{ id: DirectorLightingPresetId; labelKey: string }> =
  DIRECTOR_LIGHTING_PRESETS.map((p) => ({
    id: p.id,
    labelKey: p.labelKey
  }))
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

// ---- 材质贴图（Unity 式贴图槽：从资产库拖入图片设置，⊘ 隐藏自带贴图，✕ 还原） ----
interface MaterialTextureSlotRow {
  slot: StageTextureSlot
  labelKey: string
  path: string
  hidden: boolean
  thumb: string
}
interface MaterialTextureRow {
  key: string
  label: string
  slots: MaterialTextureSlotRow[]
}
const textureThumbUrls = ref<Record<string, string>>({})
const objectMaterialRows = computed<MaterialTextureRow[]>(() => {
  void scene.previewRevision.value
  const o = obj.value
  if (!o) return []
  return scene.listObjectMaterialSlots(o.id).map((row) => ({
    key: row.key,
    label: row.label,
    slots: (
      [
        { slot: 'map', labelKey: 'director.stage.textureSlotMap', value: row.map },
        {
          slot: 'normalMap',
          labelKey: 'director.stage.textureSlotNormal',
          value: row.normalMap
        }
      ] as const
    ).map((item) => {
      const path = typeof item.value === 'string' ? item.value : ''
      return {
        slot: item.slot,
        labelKey: item.labelKey,
        path,
        hidden: item.value === null,
        thumb: path ? (textureThumbUrls.value[path] ?? '') : ''
      }
    })
  }))
})
watch(
  () => objectMaterialRows.value.flatMap((row) => row.slots.map((item) => item.path)),
  async (paths) => {
    for (const rel of paths) {
      if (!rel || textureThumbUrls.value[rel]) continue
      const url = await resolveAssetPreviewUrl(rel)
      if (url) textureThumbUrls.value[rel] = url
    }
  },
  { immediate: true }
)
function onTextureSlotDrop(materialKey: string, slot: StageTextureSlot, event: DragEvent): void {
  const o = obj.value
  if (!o) return
  const asset = workspace.resolveDraggedAsset(event)
  if (!asset || asset.type !== 'image' || !asset.relativePath) return
  scene.setObjectMaterialTexture(o.id, materialKey, slot, asset.relativePath)
}
/** 还原模型自带贴图（撤销替换或隐藏） */
function resetObjectTexture(materialKey: string, slot: StageTextureSlot): void {
  const o = obj.value
  if (!o) return
  scene.setObjectMaterialTexture(o.id, materialKey, slot, undefined)
}
function toggleObjectTextureHidden(
  materialKey: string,
  slot: StageTextureSlot,
  hidden: boolean
): void {
  const o = obj.value
  if (!o) return
  scene.setObjectMaterialTexture(o.id, materialKey, slot, hidden ? undefined : null)
}
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

function openPoseFromMediaDialog(): void {
  const o = obj.value
  if (!o || o.locked) return
  poseFromMediaOpen.value = true
}

function closePoseFromMediaDialog(): void {
  poseFromMediaOpen.value = false
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

function formatBoneLabel(bone: string): string {
  const key = `director.stage.bones.${bone}`
  return te(key) ? t(key) : bone
}

function formatMaterialSlotLabel(label: string): string {
  if (label === 'MannequinBody') return t('director.stage.materialSlot.mannequinBody')
  if (label === 'MannequinJoints') return t('director.stage.materialSlot.mannequinJoints')
  if (label === 'MannequinVisor') return t('director.stage.materialSlot.mannequinVisor')
  const m = label.match(/^material-(\d+)$/i)
  if (m) return t('director.stage.materialSlot.defaultIndexed', { n: m[1] })
  return label
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
const isAttenuatedLight = computed(
  () =>
    obj.value?.kind === 'light' &&
    (obj.value.light?.type === 'point' || obj.value.light?.type === 'spot')
)
const lightTypeLabel = computed(() => {
  const type = obj.value?.light?.type
  if (type === 'point') return t('director.stage.light.point')
  if (type === 'spot') return t('director.stage.light.spot')
  if (type === 'directional') return t('director.stage.light.directional')
  return t('director.stage.light.directional')
})

const selectionTypeLabel = computed(() => {
  switch (scene.selectionKind.value) {
    case 'camera':
      return t('director.stage.selectionType.camera')
    case 'object':
      return obj.value?.kind === 'light'
        ? t('director.stage.selectionType.light')
        : t('director.stage.selectionType.object')
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
      return t('director.stage.selectionBadge.camera')
    case 'object':
      return obj.value?.kind === 'light'
        ? t('director.stage.selectionBadge.light')
        : t('director.stage.selectionBadge.object')
    case 'panorama':
      return t('director.stage.selectionBadge.panorama')
    case 'scene':
      return t('director.stage.selectionBadge.scene')
    default:
      return t('director.stage.selectionBadge.none')
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
    ? (scene.stage.value.cameras?.find((camera) => camera.id === scene.selectedCameraId.value) ??
      null)
    : null
)
const cameraLocked = computed(() => selectedCamera.value?.locked === true)
const cameraTitle = computed(() => selectedCamera.value?.name ?? t('director.stage.cameraItem'))
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

const stageSubjectObjects = computed(() =>
  scene.stage.value.objects.filter((o) => o.kind !== 'light' && o.visible !== false)
)

const hasActiveCinemachine = computed(() => directorViewerHasActiveCinemachine(viewer.value))

function fillCinemachineLocals(v: typeof viewer.value): void {
  const cm = v.cinemachine
  cmBodyMode.value = cm?.bodyMode ?? 'none'
  cmFollowTargetId.value = cm?.followTargetId ?? ''
  cmFollowSpace.value = cm?.followSpace ?? 'targetLocal'
  cmFollowOffsetX.value = cm?.followOffset?.x ?? 0
  cmFollowOffsetY.value = cm?.followOffset?.y ?? 1.6
  cmFollowOffsetZ.value = cm?.followOffset?.z ?? 3.2
  cmPositionDamping.value = cm?.positionDamping ?? 0.35
  cmOrbitRadius.value = cm?.orbitRadius ?? 3.2
  cmOrbitHeight.value = cm?.orbitHeight ?? 1.5
  cmOrbitSpeed.value = cm?.orbitSpeedDegPerSec ?? 36
  cmOrbitStartAngle.value = cm?.orbitStartAngleDeg ?? 0
  cmGroupFramingScale.value = cm?.groupFramingScale ?? 1.35
  cmAimMode.value = cm?.aimMode ?? 'none'
  cmLookAtTargetId.value = cm?.lookAtTargetId ?? ''
  cmAimTargetPart.value = cm?.aimTargetPart ?? 'head'
  cmScreenOffsetX.value = cm?.screenOffset?.x ?? 0
  cmScreenOffsetY.value = cm?.screenOffset?.y ?? 0
  cmDeadZoneWidth.value = cm?.deadZoneWidth ?? 0
  cmDeadZoneHeight.value = cm?.deadZoneHeight ?? 0
  cmAimDamping.value = cm?.aimDamping ?? 0.25
  cmAutoFocusPull.value = cm?.autoFocusPull === true
  cmNoisePreset.value = cm?.noisePreset ?? 'none'
  cmImpulseIntensity.value = cm?.impulseIntensity ?? 0
  cmImpulseTimeSec.value = cm?.impulseTimeSec ?? 0
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
    const rotation = kf.rotation ?? directorViewerRotationFromLook(kf.position, v.target)
    posX.value = kf.position.x
    posY.value = kf.position.y
    posZ.value = kf.position.z
    rotX.value = radToDeg(rotation.x)
    rotY.value = radToDeg(rotation.y)
    rotZ.value = radToDeg(rotation.z)
    scaleX.value = kf.scale?.x ?? v.scale?.x ?? 1
    scaleY.value = kf.scale?.y ?? v.scale?.y ?? 1
    scaleZ.value = kf.scale?.z ?? v.scale?.z ?? 1
    fov.value = kf.fov ?? v.fov ?? DEFAULT_DIRECTOR_CAMERA_FOV
    focalLengthMm.value = fovToFocalLengthMm(fov.value)
    dollyZoomLock.value = v.dollyZoomLock === true
    focusDistance.value = v.focusDistance ?? 3.5
    aperture.value = v.aperture ?? 0
    shakeEnabled.value = v.handheldShake?.enabled === true
    shakeIntensity.value = v.handheldShake?.intensity ?? 0.25
    shakeFrequency.value = v.handheldShake?.frequency ?? 1.2
    fillCinemachineLocals(v)
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
  focalLengthMm.value = v.focalLengthMm ?? fovToFocalLengthMm(fov.value)
  dollyZoomLock.value = v.dollyZoomLock === true
  focusDistance.value = v.focusDistance ?? 3.5
  aperture.value = v.aperture ?? 0
  shakeEnabled.value = v.handheldShake?.enabled === true
  shakeIntensity.value = v.handheldShake?.intensity ?? 0.25
  shakeFrequency.value = v.handheldShake?.frequency ?? 1.2
  fillCinemachineLocals(v)
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
  if (kfSel && kfSel.track.targetKind === 'object' && o.id === kfSel.track.targetId) {
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
        ((kf.scale?.x ?? o.scale.x) + (kf.scale?.y ?? o.scale.y) + (kf.scale?.z ?? o.scale.z)) /
        3
      ).toFixed(3)
    )
    fillLightLocals(o)
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
  fillLightLocals(o)
}

function fillLightLocals(o: NonNullable<typeof obj.value>): void {
  if (o.kind !== 'light') return
  const light = normalizeStageLightParams(o.light, o.light?.type)
  lightIntensity.value = light.intensity
  lightDistance.value = light.distance ?? 0
  lightDecay.value = light.decay ?? 2
  lightAngleDeg.value = radToDeg(light.angle ?? Math.PI / 6)
  lightPenumbra.value = light.penumbra ?? 0.25
  lightCastShadow.value = light.castShadow !== false
}

function persistLight(): void {
  const o = obj.value
  if (!o || o.kind !== 'light' || o.locked) return
  const base = createDefaultStageLightParams(o.light?.type ?? 'directional')
  const next = normalizeStageLightParams(
    {
      ...base,
      ...o.light,
      intensity: Math.max(0, finiteInput(lightIntensity.value, base.intensity)),
      distance: Math.max(0, finiteInput(lightDistance.value, base.distance ?? 0)),
      decay: Math.max(0, finiteInput(lightDecay.value, base.decay ?? 2)),
      angle: degToRad(Math.min(90, Math.max(1, finiteInput(lightAngleDeg.value, 30)))),
      penumbra: Math.min(1, Math.max(0, finiteInput(lightPenumbra.value, base.penumbra ?? 0.25))),
      castShadow: lightCastShadow.value
    },
    base.type
  )
  scene.updateObjectTransform(o.id, { light: next })
}

function toggleLightCastShadow(): void {
  lightCastShadow.value = !lightCastShadow.value
  persistLight()
}

function onApplyExpressivePose(presetId: string): void {
  const id = obj.value?.id
  if (!id || obj.value?.locked) return
  const res = scene.applyExpressivePosePreset(id, presetId)
  if (!res) return
  poseAssetApplyHint.value = t('director.stage.poseAssetApplyHint', {
    matched: res.matched,
    total: res.total
  })
  syncPoseDegCache()
}

function onFovSliderInput(): void {
  focalLengthMm.value = fovToFocalLengthMm(fov.value)
  persistViewer()
}

function onPickFocalPreset(mm: number): void {
  if (cameraLocked.value) return
  focalLengthMm.value = mm
  fov.value = Math.round(focalLengthMmToFov(mm))
  persistViewer()
}

function onFocalLengthInput(): void {
  if (cameraLocked.value) return
  const mm = Math.min(200, Math.max(12, finiteInput(focalLengthMm.value, 35)))
  focalLengthMm.value = mm
  fov.value = Math.round(focalLengthMmToFov(mm))
  persistViewer()
}

function toggleDollyZoomLock(): void {
  if (cameraLocked.value) return
  dollyZoomLock.value = !dollyZoomLock.value
  persistViewer()
}

function toggleShakeEnabled(): void {
  if (cameraLocked.value) return
  shakeEnabled.value = !shakeEnabled.value
  persistViewer()
}

function onCinemachineBodyModeChange(): void {
  if (cameraLocked.value) return
  if (
    (cmBodyMode.value === 'transposer' || cmBodyMode.value === 'orbital') &&
    !cmFollowTargetId.value
  ) {
    const preferred =
      stageSubjectObjects.value.find((o) => o.kind === 'character' || o.kind === 'model') ??
      stageSubjectObjects.value[0]
    if (preferred) cmFollowTargetId.value = preferred.id
  }
  persistViewer()
}

function onCinemachineAimModeChange(): void {
  if (cameraLocked.value) return
  if (cmAimMode.value === 'composer' && !cmLookAtTargetId.value) {
    const preferred =
      (cmFollowTargetId.value &&
        stageSubjectObjects.value.find((o) => o.id === cmFollowTargetId.value)) ||
      stageSubjectObjects.value.find((o) => o.kind === 'character' || o.kind === 'model') ||
      stageSubjectObjects.value[0]
    if (preferred) cmLookAtTargetId.value = preferred.id
  }
  persistViewer()
}

function captureCurrentFollowOffset(): void {
  if (cameraLocked.value || !cmFollowTargetId.value) return
  const target = scene.stage.value.objects.find((o) => o.id === cmFollowTargetId.value)
  if (!target) return
  const v = viewer.value
  const dx = v.position.x - target.position.x
  const dy = v.position.y - target.position.y
  const dz = v.position.z - target.position.z
  if (cmFollowSpace.value === 'targetLocal') {
    const yaw = target.rotation.y || 0
    const cosY = Math.cos(-yaw)
    const sinY = Math.sin(-yaw)
    cmFollowOffsetX.value = Number((dx * cosY + dz * sinY).toFixed(2))
    cmFollowOffsetY.value = Number(dy.toFixed(2))
    cmFollowOffsetZ.value = Number((-dx * sinY + dz * cosY).toFixed(2))
  } else {
    cmFollowOffsetX.value = Number(dx.toFixed(2))
    cmFollowOffsetY.value = Number(dy.toFixed(2))
    cmFollowOffsetZ.value = Number(dz.toFixed(2))
  }
  persistViewer()
}

function applyScreenCompositionPreset(x: number, y: number): void {
  if (cameraLocked.value) return
  cmScreenOffsetX.value = x
  cmScreenOffsetY.value = y
  persistViewer()
}

function toggleCmAutoFocusPull(): void {
  if (cameraLocked.value) return
  cmAutoFocusPull.value = !cmAutoFocusPull.value
  persistViewer()
}

function triggerImpulseAtPlayhead(): void {
  if (cameraLocked.value) return
  cmImpulseTimeSec.value = Number(scene.animTime.value.toFixed(2))
  if (cmImpulseIntensity.value <= 0) cmImpulseIntensity.value = 0.5
  persistViewer()
}

function resetCinemachineConfig(): void {
  if (cameraLocked.value) return
  cmBodyMode.value = 'none'
  cmAimMode.value = 'none'
  cmNoisePreset.value = 'none'
  cmImpulseIntensity.value = 0
  cmImpulseTimeSec.value = 0
  cmAutoFocusPull.value = false
  persistViewer()
}

function persistViewer(): void {
  if (cameraLocked.value) return
  const current = viewer.value
  const currentRotation =
    current.rotation ?? directorViewerRotationFromLook(current.position, current.target)
  const nextFov = Math.min(
    100,
    Math.max(20, finiteInput(fov.value, current.fov ?? DEFAULT_DIRECTOR_CAMERA_FOV))
  )
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
    fov: nextFov,
    focalLengthMm: fovToFocalLengthMm(nextFov),
    dollyZoomLock: dollyZoomLock.value,
    focusDistance: Math.min(50, Math.max(0.5, finiteInput(focusDistance.value, 3.5))),
    aperture: Math.min(16, Math.max(0, finiteInput(aperture.value, 0))),
    handheldShake: {
      enabled: shakeEnabled.value,
      intensity: Math.min(1, Math.max(0, finiteInput(shakeIntensity.value, 0.25))),
      frequency: Math.min(5, Math.max(0.1, finiteInput(shakeFrequency.value, 1.2)))
    },
    cinemachine: {
      bodyMode: cmBodyMode.value,
      followTargetId: cmFollowTargetId.value || null,
      followOffset: {
        x: finiteInput(cmFollowOffsetX.value, 0),
        y: finiteInput(cmFollowOffsetY.value, 1.6),
        z: finiteInput(cmFollowOffsetZ.value, 3.2)
      },
      followSpace: cmFollowSpace.value,
      positionDamping: Math.min(5, Math.max(0, finiteInput(cmPositionDamping.value, 0.35))),
      orbitRadius: Math.min(30, Math.max(0.5, finiteInput(cmOrbitRadius.value, 3.2))),
      orbitHeight: Math.min(15, Math.max(-5, finiteInput(cmOrbitHeight.value, 1.5))),
      orbitSpeedDegPerSec: Math.min(180, Math.max(-180, finiteInput(cmOrbitSpeed.value, 36))),
      orbitStartAngleDeg: Math.min(180, Math.max(-180, finiteInput(cmOrbitStartAngle.value, 0))),
      groupFramingScale: Math.min(3, Math.max(0.6, finiteInput(cmGroupFramingScale.value, 1.35))),
      aimMode: cmAimMode.value,
      lookAtTargetId: cmLookAtTargetId.value || null,
      aimTargetPart: cmAimTargetPart.value,
      screenOffset: {
        x: Math.min(0.8, Math.max(-0.8, finiteInput(cmScreenOffsetX.value, 0))),
        y: Math.min(0.8, Math.max(-0.8, finiteInput(cmScreenOffsetY.value, 0)))
      },
      deadZoneWidth: Math.min(0.8, Math.max(0, finiteInput(cmDeadZoneWidth.value, 0))),
      deadZoneHeight: Math.min(0.8, Math.max(0, finiteInput(cmDeadZoneHeight.value, 0))),
      aimDamping: Math.min(5, Math.max(0, finiteInput(cmAimDamping.value, 0.25))),
      autoFocusPull: cmAutoFocusPull.value,
      noisePreset: cmNoisePreset.value,
      impulseTimeSec: Math.max(0, finiteInput(cmImpulseTimeSec.value, 0)),
      impulseIntensity: Math.min(2, Math.max(0, finiteInput(cmImpulseIntensity.value, 0)))
    }
  }
  scene.setViewer(next)
  const updated = scene.getViewer()
  if (dollyZoomLock.value && updated) {
    posX.value = updated.position.x
    posY.value = updated.position.y
    posZ.value = updated.position.z
  }
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
  panoramaVisible.value = scene.stage.value.panoramaVisible !== false
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
  shadowCatcherEnabled.value = scene.stage.value.shadowCatcherEnabled !== false
  shadowCatcherOpacity.value =
    typeof scene.stage.value.shadowCatcherOpacity === 'number'
      ? scene.stage.value.shadowCatcherOpacity
      : 0.35
  fogEnabled.value = scene.stage.value.fogEnabled === true
  fogDensity.value =
    typeof scene.stage.value.fogDensity === 'number' ? scene.stage.value.fogDensity : 0.025
  fogColor.value = scene.stage.value.fogColor ?? resolveSkyColorForUi(scene.stage.value.skyColor)
}

function persistStageEnv(): void {
  scene.updateStageEnvironment({
    shadowCatcherEnabled: shadowCatcherEnabled.value,
    shadowCatcherOpacity: Math.min(1, Math.max(0, finiteInput(shadowCatcherOpacity.value, 0.35))),
    fogEnabled: fogEnabled.value,
    fogDensity: Math.min(0.15, Math.max(0, finiteInput(fogDensity.value, 0.025))),
    fogColor: fogColor.value
  })
}

function toggleShadowCatcherEnabled(): void {
  shadowCatcherEnabled.value = !shadowCatcherEnabled.value
  persistStageEnv()
}

function toggleFogEnabled(): void {
  fogEnabled.value = !fogEnabled.value
  persistStageEnv()
}

function onApplyLightingPreset(presetId: DirectorLightingPresetId): void {
  scene.applyLightingPreset(presetId)
}

async function onCopyCinematographyPrompt(): Promise<void> {
  const text = scene.cinematographyPrompt.value
  if (!text) return
  try {
    await navigator.clipboard.writeText(text)
    promptCopied.value = true
    setTimeout(() => {
      promptCopied.value = false
    }, 1800)
  } catch {
    // ignore clipboard errors
  }
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

function togglePanoramaVisible(): void {
  const next = !panoramaVisible.value
  panoramaVisible.value = next
  scene.updatePanoramaVisible(next)
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
  scene.updatePanoramaRadius(finiteInput(panoramaRadius.value, DEFAULT_DIRECTOR_PANORAMA_RADIUS))
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
  [
    objectInspectorTab,
    showPoseTab,
    () => obj.value?.id,
    () => scene.selectionKind.value,
    () => scene.previewRevision.value
  ],
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
    scene.stage.value.panoramaVisible,
    scene.stage.value.gridVisible,
    scene.stage.value.gridOpacity,
    scene.stage.value.gridOffsetY,
    scene.stage.value.shadowCatcherEnabled,
    scene.stage.value.shadowCatcherOpacity,
    scene.stage.value.fogEnabled,
    scene.stage.value.fogDensity,
    scene.stage.value.fogColor
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
  const effectiveViewer = scene.resolveEffectiveCameraViewer(
    selectedCamera.value?.id,
    selectedCamera.value ? undefined : viewer.value
  )
  scene.renderCameraPreviewToCanvas(canvas, effectiveViewer, previewAspectValue.value)
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

.pose-media-open-row {
  display: flex;
  margin-bottom: 4px;
}

.pose-media-open-btn {
  flex: 1;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border-radius: 8px;
  border: 1px dashed color-mix(in srgb, var(--accent) 55%, var(--border));
  background: color-mix(in srgb, var(--accent) 8%, transparent);
  color: var(--accent);
  font-size: 12px;
  cursor: pointer;
}

.pose-media-open-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.pose-media-open-icon {
  font-weight: 600;
  font-size: 13px;
  line-height: 1;
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
  background: color-mix(in srgb, var(--warning) 12%, transparent);
  color: var(--warning);
}

.keyframe-hint {
  background: var(--accent-12);
  color: var(--accent-fg);
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

.ground-switch:disabled {
  opacity: 0.45;
  cursor: default;
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

.material-textures {
  display: grid;
  gap: 4px;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 8px;
}

.material-name {
  font-size: 11px;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.texture-slot-row {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 6px;
}

.texture-slot-name {
  font-size: 11px;
  color: var(--text-muted);
}

.texture-slot-body {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 36px;
  border: 1px dashed var(--border);
  border-radius: 6px;
  overflow: hidden;
  cursor: default;
}

.texture-slot-body:hover {
  border-color: var(--accent-fg);
}

.texture-thumb {
  width: 100%;
  height: 36px;
  object-fit: cover;
  display: block;
}

.texture-thumb-empty,
.texture-thumb-loading {
  width: 100%;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  color: var(--text-muted);
}

.texture-clear {
  width: 20px;
  height: 20px;
  padding: 0;
  font-size: 11px;
  line-height: 1;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
}

.texture-clear:hover {
  color: var(--warning);
  border-color: var(--warning);
}

.texture-clear.active {
  color: var(--accent-fg);
  border-color: var(--accent-fg);
}

.texture-hint {
  font-size: 11px;
  color: var(--text-muted);
  margin: 0;
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

.lens-preset-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 5px;
}

.lens-pill {
  padding: 4px 7px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-input);
  color: var(--text-muted);
  font-size: 11px;
  cursor: pointer;
}

.lens-pill:hover:not(:disabled) {
  color: var(--text);
  border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
}

.lens-pill.active {
  background: color-mix(in srgb, var(--accent) 18%, var(--bg-input));
  border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
  color: var(--text);
}

.lens-mm-input {
  width: 58px !important;
  height: 26px;
  padding: 0 6px !important;
  font-size: 11px;
  text-align: center;
}

.prompt-copy-btn {
  padding: 2px 8px;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: var(--bg-input);
  color: var(--text-muted);
  font-size: 10px;
  cursor: pointer;
}

.prompt-copy-btn:hover {
  color: var(--text);
  border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
}

.prompt-preview-box {
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-input);
  color: var(--text-muted);
  font-size: 11px;
  line-height: 1.45;
  word-break: break-word;
  user-select: text;
}
</style>
