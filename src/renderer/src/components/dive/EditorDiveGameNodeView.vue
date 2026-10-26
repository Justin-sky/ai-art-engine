<template>
  <div v-if="node" class="dive-view game-workbench-dive">
    <header class="workbench-header">
      <div class="header-left">
        <span class="type-pill">{{ typeLabel }}</span>
        <span class="spec-badge">{{ nodeBadge }}</span>
        <input
          v-model="localTitle"
          type="text"
          class="title-input"
          :placeholder="typeLabel"
          @change="persistTitle"
        />
      </div>

      <div class="header-right">
        <GraphNodeRunControl
          :status="runStatus"
          :is-running="isGraphRunning"
          :blocked="blocked"
          @toggle="toggleRun"
        />
        <button type="button" class="done-btn" @click="onClose">
          {{ t('gameNodes.workbench.doneBtn') }}
        </button>
      </div>
    </header>

    <div class="workbench-body">
      <!-- Left Parameter Sidebar -->
      <aside class="workbench-sidebar">
        <div class="sidebar-section-title">{{ t('gameNodes.workbench.paramsSidebar') }}</div>
        <p class="hint">{{ nodeHint }}</p>

        <!-- 1. game.pbrTile -->
        <div v-if="node.typeId === 'game.pbrTile'" class="param-card">
          <div class="section-title">{{ t('gameNodes.pbrTile.sectionTitle') }}</div>

          <label class="check-row">
            <input
              type="checkbox"
              :checked="node.params.gameTileSeamless !== false"
              @change="onBoolParam('gameTileSeamless', $event)"
            />
            <span>{{ t('gameNodes.pbrTile.seamlessToggle') }}</span>
          </label>

          <label v-if="node.params.gameTileSeamless !== false" class="slider-field">
            <div class="slider-head">
              <span>{{ t('gameNodes.pbrTile.blendRatio') }}</span>
              <b>{{ Math.round(Number(node.params.gameTileBlendRatio ?? 0.22) * 100) }}%</b>
            </div>
            <input
              type="range"
              min="0.05"
              max="0.45"
              step="0.01"
              :value="node.params.gameTileBlendRatio ?? 0.22"
              @change="onNumberParam('gameTileBlendRatio', $event)"
            />
          </label>

          <label class="slider-field">
            <div class="slider-head">
              <span>{{ t('gameNodes.pbrTile.normalStrength') }}</span>
              <b>{{ Number(node.params.gamePbrNormalStrength ?? 2.8).toFixed(1) }}</b>
            </div>
            <input
              type="range"
              min="0.5"
              max="8"
              step="0.1"
              :value="node.params.gamePbrNormalStrength ?? 2.8"
              @change="onNumberParam('gamePbrNormalStrength', $event)"
            />
          </label>

          <label class="check-row">
            <input
              type="checkbox"
              :checked="Boolean(node.params.gamePbrInvertRoughness)"
              @change="onBoolParam('gamePbrInvertRoughness', $event)"
            />
            <span>{{ t('gameNodes.pbrTile.invertRoughness') }}</span>
          </label>

          <label class="check-row">
            <input v-model="showSeamGrid" type="checkbox" />
            <span>{{ t('gameNodes.workbench.showSeamGrid') }}</span>
          </label>

          <div v-if="node.params.gamePbrReport" class="report-chip">
            {{ node.params.gamePbrReport }}
          </div>
        </div>

        <!-- 2. game.audioDsp -->
        <div v-else-if="node.typeId === 'game.audioDsp'" class="param-card">
          <div class="section-title">{{ t('gameNodes.audioDsp.sectionTitle') }}</div>

          <label class="field">
            <span>{{ t('gameNodes.audioDsp.mode') }}</span>
            <select
              :value="node.params.gameAudioDspMode ?? 'loop_bgm'"
              @change="onStringParam('gameAudioDspMode', $event)"
            >
              <option value="loop_bgm">{{ t('gameNodes.audioDsp.modeLoopBgm') }}</option>
              <option value="sfx_variants">{{ t('gameNodes.audioDsp.modeSfxVariants') }}</option>
            </select>
          </label>

          <label class="field">
            <span>{{ t('gameNodes.audioDsp.synthPreset') }}</span>
            <select
              :value="node.params.gameAudioSynthPreset ?? 'sword_slash'"
              @change="onStringParam('gameAudioSynthPreset', $event)"
            >
              <option value="sword_slash">{{ t('gameNodes.audioDsp.synthSword') }}</option>
              <option value="explosion">{{ t('gameNodes.audioDsp.synthExplosion') }}</option>
              <option value="laser_shoot">{{ t('gameNodes.audioDsp.synthLaser') }}</option>
              <option value="coin_pickup">{{ t('gameNodes.audioDsp.synthCoin') }}</option>
              <option value="jump_boost">{{ t('gameNodes.audioDsp.synthJump') }}</option>
              <option value="hit_hurt">{{ t('gameNodes.audioDsp.synthHit') }}</option>
              <option value="powerup_chord">{{ t('gameNodes.audioDsp.synthPowerup') }}</option>
              <option value="chiptune_bgm">{{ t('gameNodes.audioDsp.synthChiptune') }}</option>
            </select>
          </label>

          <label class="field">
            <span>{{ t('gameNodes.audioDsp.envFx') }}</span>
            <select
              :value="node.params.gameAudioEnvFx ?? 'none'"
              @change="onStringParam('gameAudioEnvFx', $event)"
            >
              <option value="none">{{ t('gameNodes.audioDsp.fxNone') }}</option>
              <option value="underwater">{{ t('gameNodes.audioDsp.fxUnderwater') }}</option>
              <option value="radio_comms">{{ t('gameNodes.audioDsp.fxRadio') }}</option>
              <option value="cave_reverb">{{ t('gameNodes.audioDsp.fxCave') }}</option>
              <option value="retro_8bit">{{ t('gameNodes.audioDsp.fxRetro8bit') }}</option>
              <option value="heavy_impact">{{ t('gameNodes.audioDsp.fxHeavyImpact') }}</option>
            </select>
          </label>

          <label
            v-if="(node.params.gameAudioDspMode ?? 'loop_bgm') === 'loop_bgm'"
            class="slider-field"
          >
            <div class="slider-head">
              <span>{{ t('gameNodes.audioDsp.crossfadeSec') }}</span>
              <b>{{ Number(node.params.gameAudioCrossfadeSec ?? 1.5).toFixed(1) }}s</b>
            </div>
            <input
              type="range"
              min="0.2"
              max="5"
              step="0.1"
              :value="node.params.gameAudioCrossfadeSec ?? 1.5"
              @change="onNumberParam('gameAudioCrossfadeSec', $event)"
            />
          </label>

          <template v-else>
            <label class="slider-field">
              <div class="slider-head">
                <span>{{ t('gameNodes.audioDsp.trimThresholdDb') }}</span>
                <b>{{ Number(node.params.gameAudioTrimThresholdDb ?? -42) }} dB</b>
              </div>
              <input
                type="range"
                min="-65"
                max="-20"
                step="1"
                :value="node.params.gameAudioTrimThresholdDb ?? -42"
                @change="onNumberParam('gameAudioTrimThresholdDb', $event)"
              />
            </label>

            <label class="slider-field">
              <div class="slider-head">
                <span>{{ t('gameNodes.audioDsp.variantCount') }}</span>
                <b>{{ Number(node.params.gameAudioVariantCount ?? 4) }}×</b>
              </div>
              <input
                type="range"
                min="2"
                max="8"
                step="1"
                :value="node.params.gameAudioVariantCount ?? 4"
                @change="onNumberParam('gameAudioVariantCount', $event)"
              />
            </label>

            <label class="slider-field">
              <div class="slider-head">
                <span>{{ t('gameNodes.audioDsp.pitchSpreadSt') }}</span>
                <b>±{{ Number(node.params.gameAudioPitchSpread ?? 2.0).toFixed(1) }} st</b>
              </div>
              <input
                type="range"
                min="0.4"
                max="5.0"
                step="0.2"
                :value="node.params.gameAudioPitchSpread ?? 2.0"
                @change="onNumberParam('gameAudioPitchSpread', $event)"
              />
            </label>
          </template>

          <label class="check-row">
            <input
              type="checkbox"
              :checked="node.params.gameAudioNormalize !== false"
              @change="onBoolParam('gameAudioNormalize', $event)"
            />
            <span>{{ t('gameNodes.audioDsp.normalizeToggle') }}</span>
          </label>

          <div v-if="node.params.gameAudioReport" class="report-chip">
            {{ node.params.gameAudioReport }}
          </div>
        </div>

        <!-- 3. game.levelMap -->
        <div v-else-if="node.typeId === 'game.levelMap'" class="param-card">
          <div class="section-title">{{ t('gameNodes.levelMap.sectionTitle') }}</div>

          <label class="field">
            <span>{{ t('gameNodes.levelMap.algorithm') }}</span>
            <select
              :value="node.params.gameLevelAlgorithm ?? 'bsp_dungeon'"
              @change="onStringParam('gameLevelAlgorithm', $event)"
            >
              <option value="bsp_dungeon">{{ t('gameNodes.levelMap.algBsp') }}</option>
              <option value="cellular_cave">{{ t('gameNodes.levelMap.algCave') }}</option>
              <option value="arena_waves">{{ t('gameNodes.levelMap.algArena') }}</option>
              <option value="platformer_course">{{ t('gameNodes.levelMap.algPlatformer') }}</option>
            </select>
          </label>

          <div class="grid2">
            <label class="field">
              <span>{{ t('gameNodes.levelMap.width') }}</span>
              <input
                type="number"
                min="12"
                max="64"
                step="2"
                :value="node.params.gameLevelWidth ?? 32"
                @change="onNumberParam('gameLevelWidth', $event)"
              />
            </label>
            <label class="field">
              <span>{{ t('gameNodes.levelMap.height') }}</span>
              <input
                type="number"
                min="10"
                max="48"
                step="2"
                :value="node.params.gameLevelHeight ?? 20"
                @change="onNumberParam('gameLevelHeight', $event)"
              />
            </label>
          </div>

          <div class="seed-row">
            <label class="field grow">
              <span>{{ t('gameNodes.levelMap.seed') }}</span>
              <input
                type="number"
                step="1"
                :value="node.params.gameLevelSeed ?? 1337"
                @change="onNumberParam('gameLevelSeed', $event)"
              />
            </label>
            <button type="button" class="dice-btn" @click="randomizeLevelSeed">
              🎲 {{ t('gameNodes.levelMap.randomSeed') }}
            </button>
          </div>

          <div v-if="node.params.gameLevelReport" class="report-chip">
            {{ node.params.gameLevelReport }}
          </div>
        </div>

        <!-- 4. game.playable -->
        <div v-else-if="node.typeId === 'game.playable'" class="param-card">
          <div class="section-title">{{ t('gameNodes.playable.sectionTitle') }}</div>

          <label class="field">
            <span>{{ t('gameNodes.playable.title') }}</span>
            <input
              type="text"
              :value="node.params.gamePlayableTitle ?? 'Indie Game Prototype'"
              @change="onStringParam('gamePlayableTitle', $event)"
            />
          </label>

          <label class="field">
            <span>{{ t('gameNodes.playable.genre') }}</span>
            <select
              :value="node.params.gamePlayableGenre ?? 'roguelike_action'"
              @change="onStringParam('gamePlayableGenre', $event)"
            >
              <option value="roguelike_action">{{ t('gameNodes.playable.genreRogue') }}</option>
              <option value="platformer">{{ t('gameNodes.playable.genrePlatformer') }}</option>
              <option value="dungeon_crawler">{{ t('gameNodes.playable.genreDungeon') }}</option>
            </select>
          </label>

          <label class="field">
            <span>{{ t('gameNodes.playable.cameraMode') }}</span>
            <select
              :value="node.params.gamePlayableCameraMode ?? 'topdown_34'"
              @change="onStringParam('gamePlayableCameraMode', $event)"
            >
              <option value="topdown_34">{{ t('gameNodes.playable.camTopdown34') }}</option>
              <option value="topdown_90">{{ t('gameNodes.playable.camTopdown90') }}</option>
              <option value="isometric_45">{{ t('gameNodes.playable.camIso45') }}</option>
              <option value="side_view">{{ t('gameNodes.playable.camSide') }}</option>
            </select>
          </label>

          <button type="button" class="action-btn" @click="recompilePlayableNow">
            {{ t('gameNodes.workbench.recompileBtn') }}
          </button>

          <button type="button" class="secondary-btn" @click="showHtmlSource = !showHtmlSource">
            {{ t('gameNodes.workbench.toggleHtmlSource') }}
          </button>

          <div v-if="node.params.gamePlayableReport" class="report-chip">
            {{ node.params.gamePlayableReport }}
          </div>
        </div>
      </aside>

      <!-- Main Interactive Stage -->
      <main class="workbench-stage">
        <!-- Stage 1: game.pbrTile -->
        <template v-if="node.typeId === 'game.pbrTile'">
          <div class="stage-toolbar">
            <span class="stage-title">{{ t('gameNodes.workbench.pbrPreviewTitle') }}</span>
            <div class="tab-pills">
              <button
                type="button"
                class="tab-pill"
                :class="{ active: pbrTab === 'grid' }"
                @click="pbrTab = 'grid'"
              >
                {{ t('gameNodes.workbench.seamlessGridTab') }}
              </button>
              <button
                type="button"
                class="tab-pill"
                :class="{ active: pbrTab === 'channels' }"
                @click="pbrTab = 'channels'"
              >
                {{ t('gameNodes.workbench.pbrChannelsTab') }}
              </button>
            </div>
          </div>

          <div v-if="pbrPrimaryImageUrl" class="stage-content">
            <div
              v-if="pbrTab === 'grid'"
              class="tile-grid-3x3"
              :class="{ 'show-seams': showSeamGrid }"
            >
              <img
                v-for="idx in 9"
                :key="idx"
                :src="pbrPrimaryImageUrl"
                alt=""
                class="tile-cell"
                draggable="false"
              />
            </div>

            <div v-else class="pbr-channels-grid">
              <div v-for="(item, index) in pbrChannelCards" :key="item.key" class="channel-card">
                <div class="channel-card-head">
                  <span>#{{ index + 1 }}</span>
                  <b>{{ item.title }}</b>
                </div>
                <img :src="item.url" alt="" class="channel-img" draggable="false" />
              </div>
            </div>
          </div>
          <div v-else class="empty-stage">
            <p>{{ t('gameNodes.workbench.pbrEmptyHint') }}</p>
          </div>

          <div v-if="hostId" class="output-preview-wrap">
            <GraphNodeOutputPreview :node="node" :host-id="hostId" />
          </div>
        </template>

        <!-- Stage 2: game.audioDsp -->
        <template v-else-if="node.typeId === 'game.audioDsp'">
          <div class="stage-toolbar">
            <span class="stage-title">{{ t('gameNodes.workbench.audioPreviewTitle') }}</span>
            <div class="audition-controls">
              <template v-if="(node.params.gameAudioDspMode ?? 'loop_bgm') === 'sfx_variants'">
                <button type="button" class="secondary-btn" @click="triggerRapidFire('raw')">
                  {{ t('gameNodes.audioDsp.rapidFireRawBtn') }}
                </button>
                <button type="button" class="action-btn" @click="triggerRapidFire('pool')">
                  {{ t('gameNodes.audioDsp.rapidFirePoolBtn') }}
                </button>
              </template>
              <template v-else>
                <button type="button" class="action-btn" @click="auditionLoopSeam">
                  {{ t('gameNodes.audioDsp.loopSeamBtn') }}
                </button>
              </template>
              <button type="button" class="secondary-btn" @click="stopWebAudioPlayback">
                {{ t('gameNodes.audioDsp.stopAudioBtn') }}
              </button>
            </div>
          </div>

          <div class="audio-stage-body">
            <!-- Dual Waveform & Silence Trim / Loop Crossfade Visualizer -->
            <div class="waveform-compare-card">
              <div class="section-title">{{ t('gameNodes.audioDsp.waveformTitle') }}</div>

              <div class="waveform-lane">
                <div class="waveform-lane-head">
                  <span>{{ t('gameNodes.audioDsp.sourceWaveformLabel') }}</span>
                  <div class="waveform-metrics">
                    <span>{{ rawWaveformAnalysis.durationSec }}s</span>
                    <span>Peak: {{ rawWaveformAnalysis.peakDb }} dB</span>
                    <span v-if="(node.params.gameAudioDspMode ?? 'loop_bgm') === 'sfx_variants'">
                      Trim: -{{ rawWaveformAnalysis.trimmedLeadMs }}ms / -{{ rawWaveformAnalysis.trimmedTailMs }}ms
                    </span>
                  </div>
                </div>
                <svg class="waveform-svg" viewBox="0 0 600 84" preserveAspectRatio="none">
                  <line x1="0" y1="42" x2="600" y2="42" class="wf-center-line" />
                  <template v-if="(node.params.gameAudioDspMode ?? 'loop_bgm') === 'sfx_variants'">
                    <rect
                      x="0"
                      y="0"
                      :width="Math.max(0, rawWaveformAnalysis.trimStartRatio * 600)"
                      height="84"
                      class="wf-trim-zone"
                    />
                    <rect
                      :x="Math.min(600, rawWaveformAnalysis.trimEndRatio * 600)"
                      y="0"
                      :width="Math.max(0, (1 - rawWaveformAnalysis.trimEndRatio) * 600)"
                      height="84"
                      class="wf-trim-zone"
                    />
                    <line
                      :x1="rawWaveformAnalysis.trimStartRatio * 600"
                      y1="0"
                      :x2="rawWaveformAnalysis.trimStartRatio * 600"
                      y2="84"
                      class="wf-cut-line"
                    />
                    <line
                      :x1="rawWaveformAnalysis.trimEndRatio * 600"
                      y1="0"
                      :x2="rawWaveformAnalysis.trimEndRatio * 600"
                      y2="84"
                      class="wf-cut-line"
                    />
                  </template>
                  <rect
                    v-for="(b, idx) in rawWaveformAnalysis.buckets"
                    :key="`raw-${idx}`"
                    :x="idx * 5 + 1"
                    :y="42 - Math.max(1, Math.abs(b.max) * 38)"
                    width="3"
                    :height="Math.max(2, (Math.abs(b.max) + Math.abs(b.min)) * 38)"
                    rx="1"
                    class="wf-bar raw"
                  />
                </svg>
              </div>

              <div class="waveform-lane">
                <div class="waveform-lane-head">
                  <span>{{ t('gameNodes.audioDsp.processedWaveformLabel') }}</span>
                  <div class="waveform-metrics">
                    <span>{{ processedWaveformAnalysis.durationSec }}s</span>
                    <span>Peak: {{ processedWaveformAnalysis.peakDb }} dB</span>
                    <span>RMS: {{ processedWaveformAnalysis.rmsDb }} dB</span>
                    <span>FX: {{ node.params.gameAudioEnvFx ?? 'none' }}</span>
                  </div>
                </div>
                <svg class="waveform-svg" viewBox="0 0 600 84" preserveAspectRatio="none">
                  <line x1="0" y1="42" x2="600" y2="42" class="wf-center-line" />
                  <rect
                    v-if="(node.params.gameAudioDspMode ?? 'loop_bgm') === 'loop_bgm'"
                    :x="Math.max(0, 600 - loopCrossfadeWidthPx)"
                    y="0"
                    :width="loopCrossfadeWidthPx"
                    height="84"
                    class="wf-loop-zone"
                  />
                  <rect
                    v-for="(b, idx) in processedWaveformAnalysis.buckets"
                    :key="`proc-${idx}`"
                    :x="idx * 5 + 1"
                    :y="42 - Math.max(1, Math.abs(b.max) * 38)"
                    width="3"
                    :height="Math.max(2, (Math.abs(b.max) + Math.abs(b.min)) * 38)"
                    rx="1"
                    class="wf-bar processed"
                  />
                </svg>
              </div>
            </div>

            <!-- SFX Variant Matrix Cards with Live Single-Variant Audition -->
            <div class="sfx-matrix-panel">
              <div class="section-title">{{ t('gameNodes.workbench.sfxMatrixTitle') }}</div>
              <div class="sfx-variant-cards">
                <div v-for="v in sfxVariantsPlan" :key="v.variantId" class="sfx-card">
                  <div class="sfx-card-head">
                    <b>Variant #{{ v.index + 1 }} ({{ v.variantId }})</b>
                    <button
                      type="button"
                      class="mini-play-btn"
                      @click="playSingleVariant(v.index)"
                    >
                      {{ t('gameNodes.audioDsp.playVariantBtn') }}
                    </button>
                  </div>
                  <div class="sfx-metrics">
                    <span>
                      Pitch:
                      {{ v.semitoneOffset >= 0 ? `+${v.semitoneOffset}` : v.semitoneOffset }} st
                    </span>
                    <span>Speed: {{ v.tempoRatio }}x</span>
                    <span>
                      Gain: {{ v.volumeGainDb >= 0 ? `+${v.volumeGainDb}` : v.volumeGainDb }} dB
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <!-- Engine Audio Randomizer Container Exporter -->
            <div class="engine-export-panel">
              <div class="engine-export-head">
                <span class="section-title">{{ t('gameNodes.audioDsp.engineExportTitle') }}</span>
                <div class="tab-pills">
                  <button
                    type="button"
                    class="tab-pill"
                    :class="{ active: audioEngineTab === 'godot' }"
                    @click="audioEngineTab = 'godot'"
                  >
                    Godot 4 (.tres)
                  </button>
                  <button
                    type="button"
                    class="tab-pill"
                    :class="{ active: audioEngineTab === 'unity' }"
                    @click="audioEngineTab = 'unity'"
                  >
                    Unity (.json)
                  </button>
                  <button type="button" class="secondary-btn" @click="copyAudioEngineConfig">
                    {{ audioConfigCopied ? t('gameNodes.audioDsp.copiedHint') : t('gameNodes.audioDsp.copyConfigBtn') }}
                  </button>
                </div>
              </div>
              <pre class="code-viewer compact">{{ activeAudioEngineExportCode }}</pre>
            </div>

            <div v-if="hostId" class="output-preview-wrap">
              <GraphNodeOutputPreview :node="node" :host-id="hostId" />
            </div>
          </div>
        </template>

        <!-- Stage 3: game.levelMap -->
        <template v-else-if="node.typeId === 'game.levelMap'">
          <div class="stage-toolbar">
            <span class="stage-title">{{ t('gameNodes.workbench.levelPreviewTitle') }}</span>
            <div class="tab-pills">
              <button
                type="button"
                class="tab-pill"
                :class="{ active: levelTab === 'map' }"
                @click="levelTab = 'map'"
              >
                {{ t('gameNodes.workbench.levelMapTab') }}
              </button>
              <button
                type="button"
                class="tab-pill"
                :class="{ active: levelTab === 'tmj' }"
                @click="levelTab = 'tmj'"
              >
                {{ t('gameNodes.workbench.levelTmjTab') }}
              </button>
            </div>
          </div>

          <div class="stage-content">
            <div v-if="levelTab === 'map'" class="level-map-stage">
              <img
                :src="liveLevelPreviewDataUrl"
                alt="Level Map Preview"
                class="level-preview-img"
                draggable="false"
              />
              <div class="level-stats-bar">
                <span>{{ liveLevelData.width }} × {{ liveLevelData.height }}</span>
                <span>Rooms: {{ liveLevelData.rooms.length }}</span>
                <span>Entities: {{ liveLevelData.entities.length }}</span>
                <span>Seed: {{ liveLevelData.seed }}</span>
              </div>
            </div>
            <pre v-else class="code-viewer">{{ liveLevelTmjJson }}</pre>
          </div>
        </template>

        <!-- Stage 4: game.playable -->
        <template v-else-if="node.typeId === 'game.playable'">
          <div class="stage-toolbar">
            <span class="stage-title">{{ t('gameNodes.workbench.playablePreviewTitle') }}</span>
            <span class="hint">{{ t('gameNodes.playable.modalHint') }}</span>
          </div>

          <div class="playable-stage-body">
            <iframe
              v-show="!showHtmlSource"
              :key="playableReloadSeq"
              class="playable-sandbox-iframe"
              :srcdoc="livePlayableHtml"
              sandbox="allow-scripts"
              title="game-playable-workbench"
            />
            <pre v-show="showHtmlSource" class="code-viewer">{{ livePlayableHtml }}</pre>
          </div>
        </template>
      </main>
    </div>
  </div>
  <div v-else class="dive-view empty-stage">
    {{ t('graph.inspector.node.empty') }}
  </div>
</template>

<script setup lang="ts">
import { computed, inject, onBeforeUnmount, ref, watch } from 'vue'
import {
  analyzeAudioWaveformAndTrim,
  applyEqualPowerLoopCrossfadePcm,
  applyGameAudioEnvironmentFxPcm,
  compilePlayableGameSandboxHtml,
  exportGodotAudioStreamRandomizerTres,
  exportUnityAudioRandomContainerJson,
  generateProceduralLevelMap,
  normalizePeakPcm,
  planSfxVariantMatrix,
  renderProceduralLevelToPng,
  resamplePitchShiftPcm,
  synthesizeGameSeedPcm,
  trimSilencePcm,
  type GameAudioEnvironmentFx,
  type GameAudioSynthPreset,
  type LevelGeneratorAlgorithm
} from '@shared/gameAssets'
import { isGameProductionNode, type GraphNode, type GraphNodeParams } from '@shared/graph'
import GraphNodeRunControl from '../GraphNodeRunControl.vue'
import GraphNodeOutputPreview from '../GraphNodeOutputPreview.vue'
import { useStudioI18n } from '../../composables/useStudioI18n'
import { useGraphNodeRun } from '../../composables/useGraphNodeRun'
import { editorDiveKey } from '../../features/graph/model/editorDive'
import { graphEditorHosts } from '../../features/graph/model/graphEditorHosts'
import { resolveAssetPreviewUrl } from '../../features/media/assetUrlCache'

const props = defineProps<{
  frameKey?: string
  hostId?: string
  nodeId?: string
}>()

const { t, graphTypeLabel } = useStudioI18n()
const editorDive = inject(editorDiveKey, null)

const activeNodeId = ref(props.nodeId?.trim() || '')
watch(
  () => props.nodeId,
  (next) => {
    if (next?.trim()) activeNodeId.value = next.trim()
  },
  { immediate: true }
)

const hostId = computed(() => props.hostId?.trim() || '')

const node = computed((): GraphNode | null => {
  void graphEditorHosts.revision.value
  if (!hostId.value || !activeNodeId.value) return null
  const current = graphEditorHosts.getNode(hostId.value, activeNodeId.value)
  return current && isGameProductionNode(current) ? current : null
})

const { runStatus, isGraphRunning, blocked, toggleRun } = useGraphNodeRun(node, hostId)

const typeLabel = computed(() => (node.value?.typeId ? graphTypeLabel(node.value.typeId) : ''))

const localTitle = ref('')
watch(
  node,
  (current) => {
    localTitle.value = current?.title?.trim() || ''
  },
  { immediate: true }
)

function persistTitle(): void {
  if (!node.value || !hostId.value) return
  graphEditorHosts.updateNode(hostId.value, node.value.id, {}, localTitle.value.trim())
  graphEditorHosts.bumpRevision()
}

const nodeBadge = computed(() => {
  switch (node.value?.typeId) {
    case 'game.pbrTile':
      return 'PBR + 9-Slice + Hull'
    case 'game.audioDsp':
      return (node.value.params.gameAudioDspMode ?? 'loop_bgm') === 'loop_bgm'
        ? 'Loop BGM'
        : `${node.value.params.gameAudioVariantCount ?? 4}× SFX`
    case 'game.levelMap':
      return `${node.value.params.gameLevelWidth ?? 32}×${node.value.params.gameLevelHeight ?? 20}`
    case 'game.playable':
      return '60fps HTML5'
    default:
      return ''
  }
})

const nodeHint = computed(() => {
  switch (node.value?.typeId) {
    case 'game.pbrTile':
      return t('gameNodes.pbrTile.hint')
    case 'game.audioDsp':
      return t('gameNodes.audioDsp.hint')
    case 'game.levelMap':
      return t('gameNodes.levelMap.hint')
    case 'game.playable':
      return t('gameNodes.playable.hint')
    default:
      return ''
  }
})

function patchParams(patch: Partial<GraphNodeParams>): void {
  if (!node.value || !hostId.value) return
  graphEditorHosts.updateNode(hostId.value, node.value.id, patch)
  graphEditorHosts.bumpRevision()
}

function onBoolParam(key: keyof GraphNodeParams, event: Event): void {
  const checked = (event.target as HTMLInputElement).checked
  patchParams({ [key]: checked } as Partial<GraphNodeParams>)
}

function onNumberParam(key: keyof GraphNodeParams, event: Event): void {
  const raw = Number((event.target as HTMLInputElement).value)
  if (!Number.isFinite(raw)) return
  patchParams({ [key]: raw } as Partial<GraphNodeParams>)
}

function onStringParam(key: keyof GraphNodeParams, event: Event): void {
  const val = (event.target as HTMLInputElement | HTMLSelectElement).value
  patchParams({ [key]: val } as Partial<GraphNodeParams>)
}

function randomizeLevelSeed(): void {
  patchParams({ gameLevelSeed: Math.floor(100 + Math.random() * 99000) })
}

function onClose(): void {
  editorDive?.popTo(-1)
}

// --- 1. game.pbrTile stage state ---
const pbrTab = ref<'grid' | 'channels'>('grid')
const showSeamGrid = ref(true)
const pbrChannelCards = ref<Array<{ key: string; title: string; url: string }>>([])

watch(
  () =>
    [
      node.value?.id,
      node.value?.params.generatedImages,
      node.value?.params.previewDataUrl
    ] as const,
  async () => {
    const current = node.value
    if (!current || current.typeId !== 'game.pbrTile') {
      pbrChannelCards.value = []
      return
    }
    const items = current.params.generatedImages ?? []
    const resolved: Array<{ key: string; title: string; url: string }> = []
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      let url = item.dataUrl?.trim() || ''
      if (!url && item.relativePath?.trim()) {
        try {
          url = (await resolveAssetPreviewUrl(item.relativePath.trim())) || ''
        } catch {
          url = ''
        }
      }
      if (!url) continue
      resolved.push({
        key: item.id || `pbr-${i}`,
        title: item.title?.trim() || item.layerPrompt?.trim() || `Channel ${i + 1}`,
        url
      })
    }
    if (resolved.length === 0 && current.params.previewDataUrl?.trim()) {
      resolved.push({
        key: 'preview-primary',
        title: 'Seamless Albedo',
        url: current.params.previewDataUrl.trim()
      })
    }
    pbrChannelCards.value = resolved
  },
  { immediate: true }
)

const pbrPrimaryImageUrl = computed(() => pbrChannelCards.value[0]?.url || '')

// --- 2. game.audioDsp stage state ---
const audioVariantCount = computed(() =>
  Math.max(2, Math.min(8, Math.round(Number(node.value?.params.gameAudioVariantCount ?? 4))))
)
const audioPitchSpread = computed(() =>
  Math.max(0.4, Math.min(5.0, Number(node.value?.params.gameAudioPitchSpread ?? 2.0)))
)
const audioTrimThresholdDb = computed(() =>
  Math.max(-65, Math.min(-20, Number(node.value?.params.gameAudioTrimThresholdDb ?? -42)))
)
const audioCrossfadeSec = computed(() =>
  Math.max(0.2, Math.min(5.0, Number(node.value?.params.gameAudioCrossfadeSec ?? 1.5)))
)
const audioEnvFx = computed<GameAudioEnvironmentFx>(
  () => (node.value?.params.gameAudioEnvFx ?? 'none') as GameAudioEnvironmentFx
)
const audioNormalize = computed(() => node.value?.params.gameAudioNormalize !== false)

const sfxVariantsPlan = computed(() =>
  planSfxVariantMatrix({
    count: audioVariantCount.value,
    pitchSpreadSemitones: audioPitchSpread.value,
    tempoSpread: 0.08
  })
)

const liveRawAudioBuffer = computed(() => {
  const mode = node.value?.params.gameAudioDspMode ?? 'loop_bgm'
  const preset = (node.value?.params.gameAudioSynthPreset ??
    (mode === 'loop_bgm' ? 'chiptune_bgm' : 'sword_slash')) as GameAudioSynthPreset
  return synthesizeGameSeedPcm(preset, 22050)
})

const liveProcessedPrimaryChannel = computed(() => {
  const raw = liveRawAudioBuffer.value.channels[0] ?? new Float32Array(0)
  const sr = liveRawAudioBuffer.value.sampleRate
  const mode = node.value?.params.gameAudioDspMode ?? 'loop_bgm'
  let stage: Float32Array
  if (mode === 'loop_bgm') {
    stage = applyEqualPowerLoopCrossfadePcm(raw, sr, audioCrossfadeSec.value)
  } else {
    stage = trimSilencePcm(raw, sr, { thresholdDb: audioTrimThresholdDb.value })
  }
  const withFx =
    audioEnvFx.value !== 'none'
      ? applyGameAudioEnvironmentFxPcm(stage, sr, audioEnvFx.value)
      : stage
  return audioNormalize.value ? normalizePeakPcm(withFx, -1.0) : withFx
})

const rawWaveformAnalysis = computed(() =>
  analyzeAudioWaveformAndTrim(
    liveRawAudioBuffer.value.channels[0] ?? new Float32Array(0),
    liveRawAudioBuffer.value.sampleRate,
    120,
    audioTrimThresholdDb.value
  )
)

const processedWaveformAnalysis = computed(() =>
  analyzeAudioWaveformAndTrim(
    liveProcessedPrimaryChannel.value,
    liveRawAudioBuffer.value.sampleRate,
    120,
    audioTrimThresholdDb.value
  )
)

const loopCrossfadeWidthPx = computed(() => {
  const dur = Math.max(0.2, processedWaveformAnalysis.value.durationSec)
  const ratio = Math.min(0.45, audioCrossfadeSec.value / dur)
  return Math.round(ratio * 600)
})

let activeAudioCtx: AudioContext | null = null
let rapidFireTimers: Array<ReturnType<typeof setTimeout>> = []

function stopWebAudioPlayback(): void {
  for (const tId of rapidFireTimers) clearTimeout(tId)
  rapidFireTimers = []
  if (activeAudioCtx) {
    void activeAudioCtx.close().catch(() => {})
    activeAudioCtx = null
  }
}

onBeforeUnmount(() => {
  stopWebAudioPlayback()
})

function ensureAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  const Ctx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctx) return null
  stopWebAudioPlayback()
  activeAudioCtx = new Ctx()
  return activeAudioCtx
}

function playPcmSamples(
  ctx: AudioContext,
  samples: Float32Array,
  sampleRate: number,
  options?: { loop?: boolean; offsetSec?: number }
): void {
  if (samples.length === 0) return
  const buf = ctx.createBuffer(1, samples.length, sampleRate)
  buf.copyToChannel(new Float32Array(samples), 0)
  const src = ctx.createBufferSource()
  src.buffer = buf
  src.loop = Boolean(options?.loop)
  src.connect(ctx.destination)
  src.start(0, Math.max(0, options?.offsetSec ?? 0))
}

function buildVariantSamples(variantIndex: number): { samples: Float32Array; sampleRate: number } {
  const raw = liveRawAudioBuffer.value.channels[0] ?? new Float32Array(0)
  const sr = liveRawAudioBuffer.value.sampleRate
  const trimmed = trimSilencePcm(raw, sr, { thresholdDb: audioTrimThresholdDb.value })
  const spec = sfxVariantsPlan.value[variantIndex] ?? sfxVariantsPlan.value[0]
  const shifted = spec
    ? resamplePitchShiftPcm(trimmed, spec.semitoneOffset, spec.trebleGainDb)
    : trimmed
  const withFx =
    audioEnvFx.value !== 'none'
      ? applyGameAudioEnvironmentFxPcm(shifted, sr, audioEnvFx.value)
      : shifted
  const finalSamples = audioNormalize.value ? normalizePeakPcm(withFx, -1.0) : withFx
  return { samples: finalSamples, sampleRate: sr }
}

function playSingleVariant(variantIndex: number): void {
  const ctx = ensureAudioContext()
  if (!ctx) return
  const { samples, sampleRate } = buildVariantSamples(variantIndex)
  playPcmSamples(ctx, samples, sampleRate)
}

function triggerRapidFire(kind: 'raw' | 'pool'): void {
  const ctx = ensureAudioContext()
  if (!ctx) return
  const raw = liveRawAudioBuffer.value.channels[0] ?? new Float32Array(0)
  const sr = liveRawAudioBuffer.value.sampleRate
  const trimmedRaw = trimSilencePcm(raw, sr, { thresholdDb: audioTrimThresholdDb.value })
  const count = sfxVariantsPlan.value.length
  let lastIdx = -1
  for (let burst = 0; burst < 6; burst++) {
    const timer = setTimeout(() => {
      if (!activeAudioCtx || activeAudioCtx !== ctx) return
      if (kind === 'raw') {
        playPcmSamples(ctx, trimmedRaw, sr)
      } else {
        let pick = Math.floor(Math.random() * count)
        if (count > 1 && pick === lastIdx) pick = (pick + 1) % count
        lastIdx = pick
        const { samples, sampleRate } = buildVariantSamples(pick)
        playPcmSamples(ctx, samples, sampleRate)
      }
    }, burst * 135)
    rapidFireTimers.push(timer)
  }
}

function auditionLoopSeam(): void {
  const ctx = ensureAudioContext()
  if (!ctx) return
  const samples = liveProcessedPrimaryChannel.value
  const sr = liveRawAudioBuffer.value.sampleRate
  const dur = samples.length / sr
  const offsetSec = Math.max(0, dur - 2.0)
  playPcmSamples(ctx, samples, sr, { loop: true, offsetSec })
}

const audioEngineTab = ref<'godot' | 'unity'>('godot')
const audioConfigCopied = ref(false)

const activeAudioEngineExportCode = computed(() => {
  const voices = node.value?.params.generatedVoices ?? []
  const paths =
    voices.length > 0
      ? voices.map((v) => v.relativePath || 'Assets/GameAudio/sfx.wav')
      : sfxVariantsPlan.value.map((v) => `Assets/GameAudio/sfx_${v.variantId}.wav`)
  const name = (node.value?.title?.trim() || 'SFX_RandomPool').replace(/\s+/g, '_')
  if (audioEngineTab.value === 'godot') {
    return exportGodotAudioStreamRandomizerTres({
      resourceName: name,
      variantPaths: paths,
      pitchSpreadSemitones: audioPitchSpread.value
    })
  }
  return exportUnityAudioRandomContainerJson({
    containerName: name,
    variantPaths: paths,
    pitchSpreadSemitones: audioPitchSpread.value
  })
})

function copyAudioEngineConfig(): void {
  if (typeof navigator !== 'undefined' && navigator.clipboard) {
    void navigator.clipboard.writeText(activeAudioEngineExportCode.value)
    audioConfigCopied.value = true
    setTimeout(() => {
      audioConfigCopied.value = false
    }, 1800)
  }
}

// --- 3. game.levelMap stage state ---
const levelTab = ref<'map' | 'tmj'>('map')

const liveLevelData = computed(() => {
  const alg = (node.value?.params.gameLevelAlgorithm ?? 'bsp_dungeon') as LevelGeneratorAlgorithm
  const width = Math.max(12, Math.min(64, Number(node.value?.params.gameLevelWidth ?? 32)))
  const height = Math.max(10, Math.min(48, Number(node.value?.params.gameLevelHeight ?? 20)))
  const seed = Number(node.value?.params.gameLevelSeed ?? 1337)
  return generateProceduralLevelMap({
    algorithm: alg,
    width,
    height,
    seed
  })
})

const liveLevelPreviewDataUrl = computed(() => {
  if (node.value?.params.previewDataUrl?.trim()) {
    return node.value.params.previewDataUrl.trim()
  }
  return renderProceduralLevelToPng(liveLevelData.value, 14).dataUrl
})

const liveLevelTmjJson = computed(() => {
  const stored = node.value?.params.text?.trim()
  if (stored && stored.startsWith('{')) return stored
  return JSON.stringify(liveLevelData.value.tiledMap, null, 2)
})

// --- 4. game.playable stage state ---
const showHtmlSource = ref(false)
const playableReloadSeq = ref(0)

function buildPlayableHtmlFromNode(current: GraphNode | null): string {
  if (!current) return ''
  const stored = current.params.gamePlayableHtml?.trim()
  if (stored && stored.includes('<html')) return stored
  const alg = (current.params.gameLevelAlgorithm ?? 'bsp_dungeon') as LevelGeneratorAlgorithm
  const seed = Number(current.params.gameLevelSeed ?? 42)
  const genreRaw = current.params.gamePlayableGenre ?? 'roguelike_action'
  const cameraRaw = current.params.gamePlayableCameraMode ?? 'topdown_34'
  const mode = genreRaw === 'platformer' || cameraRaw === 'side_view' ? 'platformer' : 'survivor'
  const levelMap = generateProceduralLevelMap({
    algorithm: mode === 'platformer' ? 'platformer_course' : alg,
    width: 28,
    height: 18,
    seed
  })
  return compilePlayableGameSandboxHtml({
    title: current.params.gamePlayableTitle || 'Indie Game Prototype',
    mode,
    levelSeed: seed,
    levelMap
  }).html
}

const livePlayableHtml = computed(() => buildPlayableHtmlFromNode(node.value))

function recompilePlayableNow(): void {
  const current = node.value
  if (!current) return
  const alg = (current.params.gameLevelAlgorithm ?? 'bsp_dungeon') as LevelGeneratorAlgorithm
  const seed = Number(current.params.gameLevelSeed ?? 42)
  const genreRaw = current.params.gamePlayableGenre ?? 'roguelike_action'
  const cameraRaw = current.params.gamePlayableCameraMode ?? 'topdown_34'
  const mode = genreRaw === 'platformer' || cameraRaw === 'side_view' ? 'platformer' : 'survivor'
  const levelMap = generateProceduralLevelMap({
    algorithm: mode === 'platformer' ? 'platformer_course' : alg,
    width: 28,
    height: 18,
    seed
  })
  const compiled = compilePlayableGameSandboxHtml({
    title: current.params.gamePlayableTitle || 'Indie Game Prototype',
    mode,
    levelSeed: seed,
    levelMap
  })
  patchParams({ gamePlayableHtml: compiled.html })
  playableReloadSeq.value += 1
}
</script>

<style scoped>
.game-workbench-dive {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--bg);
  color: var(--text);
}

.workbench-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 16px;
  background: color-mix(in srgb, var(--panel) 94%, transparent);
  border-bottom: 1px solid color-mix(in srgb, var(--border) 82%, transparent);
  flex-shrink: 0;
}

.header-left,
.header-right {
  display: flex;
  align-items: center;
  gap: 10px;
}

.title-input {
  padding: 5px 10px;
  border-radius: 6px;
  border: 1px solid color-mix(in srgb, var(--border) 80%, transparent);
  background: color-mix(in srgb, var(--panel) 88%, transparent);
  color: var(--text);
  font-size: 13px;
  font-weight: 600;
  min-width: 200px;
}

.type-pill {
  font-size: 12px;
  font-weight: 600;
  padding: 3px 9px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--panel) 84%, transparent);
  border: 1px solid color-mix(in srgb, var(--border) 82%, transparent);
  color: var(--text);
}

.tab-pill {
  padding: 5px 11px;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--border) 80%, transparent);
  background: color-mix(in srgb, var(--panel) 86%, transparent);
  color: var(--text-muted);
  font-size: 12px;
  cursor: pointer;
}

.tab-pill.active {
  background: color-mix(in srgb, var(--accent) 18%, var(--panel));
  border-color: color-mix(in srgb, var(--accent) 45%, transparent);
  color: var(--text);
  font-weight: 600;
}

.done-btn {
  padding: 6px 14px;
  border-radius: 7px;
  border: 1px solid color-mix(in srgb, var(--accent) 45%, transparent);
  background: color-mix(in srgb, var(--accent) 18%, var(--panel));
  color: var(--text);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.workbench-body {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 320px 1fr;
  overflow: hidden;
}

.workbench-sidebar {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px;
  border-right: 1px solid color-mix(in srgb, var(--border) 80%, transparent);
  background: color-mix(in srgb, var(--panel) 92%, transparent);
  overflow-y: auto;
}

.sidebar-section-title,
.section-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.hint {
  margin: 0;
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.45;
}

.param-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--panel) 84%, transparent);
  border: 1px solid color-mix(in srgb, var(--border) 80%, transparent);
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
}

.field input,
.field select {
  padding: 6px 8px;
  border-radius: 6px;
  border: 1px solid color-mix(in srgb, var(--border) 80%, transparent);
  background: color-mix(in srgb, var(--panel) 92%, transparent);
  color: var(--text);
  font-size: 12px;
}

.grid2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.seed-row {
  display: flex;
  align-items: flex-end;
  gap: 6px;
}

.seed-row .grow {
  flex: 1;
}

.dice-btn,
.action-btn,
.secondary-btn {
  padding: 6px 10px;
  border-radius: 6px;
  border: 1px solid color-mix(in srgb, var(--accent) 36%, transparent);
  background: color-mix(in srgb, var(--accent) 16%, var(--panel));
  color: var(--text);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.secondary-btn {
  border-color: color-mix(in srgb, var(--border) 82%, transparent);
  background: color-mix(in srgb, var(--panel) 88%, transparent);
}

.slider-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
}

.slider-head {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
}

.check-row {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
  cursor: pointer;
}

.spec-badge {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent) 14%, transparent);
  color: var(--accent);
  border: 1px solid color-mix(in srgb, var(--accent) 32%, transparent);
}

.report-chip {
  font-size: 11px;
  padding: 6px 8px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--accent) 28%, transparent);
  color: var(--accent);
  word-break: break-all;
}

.workbench-stage {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 16px 20px;
  gap: 16px;
}

.stage-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
  padding-bottom: 10px;
  border-bottom: 1px solid color-mix(in srgb, var(--border) 72%, transparent);
  flex-shrink: 0;
}

.stage-title {
  font-size: 14px;
  font-weight: 600;
  line-height: 1.4;
}

.tab-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.stage-content {
  flex: 0 0 auto;
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  padding: 4px 0;
}

.tile-grid-3x3 {
  display: grid;
  grid-template-columns: repeat(3, 160px);
  grid-template-rows: repeat(3, 160px);
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--border) 82%, transparent);
}

.tile-grid-3x3.show-seams .tile-cell {
  outline: 1px dashed color-mix(in srgb, var(--accent) 45%, transparent);
}

.tile-cell {
  width: 160px;
  height: 160px;
  object-fit: cover;
  display: block;
}

.pbr-channels-grid {
  width: 100%;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 12px;
}

.channel-card,
.sfx-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--panel) 90%, transparent);
  border: 1px solid color-mix(in srgb, var(--border) 80%, transparent);
}

.channel-card-head,
.sfx-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
  min-width: 0;
}

.channel-card-head b,
.sfx-card-head b {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.channel-img {
  width: 100%;
  aspect-ratio: 1;
  object-fit: contain;
  border-radius: 6px;
  background: color-mix(in srgb, var(--bg) 80%, transparent);
}

.audio-stage-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  flex-shrink: 0;
}

.audition-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.waveform-compare-card,
.engine-export-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px 14px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--panel) 90%, transparent);
  border: 1px solid color-mix(in srgb, var(--border) 80%, transparent);
}

.waveform-lane {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.waveform-lane-head,
.engine-export-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  font-size: 12px;
}

.waveform-metrics {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  font-size: 11px;
  color: var(--text-muted);
}

.waveform-svg {
  width: 100%;
  height: 84px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--bg) 88%, transparent);
  border: 1px solid color-mix(in srgb, var(--border) 75%, transparent);
}

.wf-center-line {
  stroke: color-mix(in srgb, var(--border) 80%, transparent);
  stroke-width: 1;
}

.wf-trim-zone {
  fill: color-mix(in srgb, var(--danger, var(--accent)) 18%, transparent);
}

.wf-loop-zone {
  fill: color-mix(in srgb, var(--accent) 18%, transparent);
}

.wf-cut-line {
  stroke: var(--accent);
  stroke-width: 1.5;
  stroke-dasharray: 3 3;
}

.wf-bar.raw {
  fill: color-mix(in srgb, var(--text-muted) 75%, transparent);
}

.wf-bar.processed {
  fill: var(--accent);
}

.mini-play-btn {
  padding: 3px 8px;
  border-radius: 5px;
  border: 1px solid color-mix(in srgb, var(--accent) 42%, transparent);
  background: color-mix(in srgb, var(--accent) 16%, var(--panel));
  color: var(--text);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
}

.code-viewer.compact {
  min-height: 160px;
  max-height: 220px;
}

.sfx-matrix-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.sfx-variant-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
  gap: 10px;
}

.sfx-metrics {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  font-size: 11px;
  color: var(--text-muted);
}

.level-map-stage {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  width: 100%;
}

.level-preview-img {
  max-width: min(820px, 100%);
  max-height: 62vh;
  image-rendering: pixelated;
  border-radius: 8px;
  border: 1px solid color-mix(in srgb, var(--border) 82%, transparent);
}

.level-stats-bar {
  display: flex;
  gap: 14px;
  font-size: 12px;
  color: var(--text-muted);
}

.playable-stage-body {
  flex: 1;
  min-height: 480px;
  display: flex;
  flex-direction: column;
  border-radius: 10px;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--border) 82%, transparent);
}

.playable-sandbox-iframe {
  width: 100%;
  flex: 1;
  min-height: 480px;
  border: 0;
  background: var(--bg);
}

.code-viewer {
  width: 100%;
  flex: 1;
  min-height: 360px;
  margin: 0;
  padding: 12px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--panel) 92%, transparent);
  border: 1px solid color-mix(in srgb, var(--border) 80%, transparent);
  color: var(--text);
  font-size: 12px;
  line-height: 1.45;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
}

.empty-stage {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  font-size: 13px;
  text-align: center;
  padding: 24px;
}

.output-preview-wrap {
  width: 100%;
  flex-shrink: 0;
}
</style>
