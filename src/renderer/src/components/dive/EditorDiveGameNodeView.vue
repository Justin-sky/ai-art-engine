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

          <label class="slider-field">
            <div class="slider-head">
              <span>{{ t('gameNodes.audioDsp.highPassHz') }}</span>
              <b>{{ Number(node.params.gameAudioHighPassHz ?? 20) }} Hz</b>
            </div>
            <input
              type="range"
              min="20"
              max="1000"
              step="10"
              :value="node.params.gameAudioHighPassHz ?? 20"
              @change="onNumberParam('gameAudioHighPassHz', $event)"
            />
          </label>

          <label class="slider-field">
            <div class="slider-head">
              <span>{{ t('gameNodes.audioDsp.lowPassHz') }}</span>
              <b>{{ Number(node.params.gameAudioLowPassHz ?? 20000) }} Hz</b>
            </div>
            <input
              type="range"
              min="1200"
              max="20000"
              step="200"
              :value="node.params.gameAudioLowPassHz ?? 20000"
              @change="onNumberParam('gameAudioLowPassHz', $event)"
            />
          </label>

          <label class="slider-field">
            <div class="slider-head">
              <span>{{ t('gameNodes.audioDsp.releaseTighten') }}</span>
              <b>{{ Math.round(Number(node.params.gameAudioReleaseTighten ?? 0) * 100) }}%</b>
            </div>
            <input
              type="range"
              min="0"
              max="0.85"
              step="0.05"
              :value="node.params.gameAudioReleaseTighten ?? 0"
              @change="onNumberParam('gameAudioReleaseTighten', $event)"
            />
          </label>

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
                :class="{ active: pbrTab === 'lighting' }"
                @click="pbrTab = 'lighting'"
              >
                {{ t('gameNodes.workbench.pbrLightingTab') }}
              </button>
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

          <div class="stage-content">
            <div v-if="pbrTab === 'lighting'" class="pbr-lighting-stage">
              <div class="pbr-light-controls">
                <span class="hint">{{ t('gameNodes.workbench.pbrMoveMouseHint') }}</span>
                <div class="light-sliders">
                  <label class="inline-slider">
                    <span>{{ t('gameNodes.workbench.pbrLightHeight') }}</span>
                    <input
                      v-model.number="pbrLightZ"
                      type="range"
                      min="0.2"
                      max="2.0"
                      step="0.05"
                      @input="renderPbrLightingCanvas"
                    />
                  </label>
                  <label class="inline-slider">
                    <span>{{ t('gameNodes.workbench.pbrLightIntensity') }}</span>
                    <input
                      v-model.number="pbrLightIntensity"
                      type="range"
                      min="0.6"
                      max="2.8"
                      step="0.1"
                      @input="renderPbrLightingCanvas"
                    />
                  </label>
                </div>
              </div>
              <canvas
                ref="pbrLightCanvasRef"
                width="288"
                height="288"
                class="pbr-light-canvas"
                @pointermove="onPbrLightPointerMove"
              />
            </div>

            <div
              v-else-if="pbrTab === 'grid' && pbrPrimaryImageUrl"
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

            <div
              v-else-if="pbrTab === 'channels' && pbrChannelCards.length"
              class="pbr-channels-grid"
            >
              <div v-for="(item, index) in pbrChannelCards" :key="item.key" class="channel-card">
                <div class="channel-card-head">
                  <span>#{{ index + 1 }}</span>
                  <b>{{ item.title }}</b>
                </div>
                <img :src="item.url" alt="" class="channel-img" draggable="false" />
              </div>
            </div>

            <div v-else class="empty-stage">
              <p>{{ t('gameNodes.workbench.pbrEmptyHint') }}</p>
            </div>
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
              <div class="waveform-lane-head">
                <span class="section-title">{{ t('gameNodes.audioDsp.waveformTitle') }}</span>
                <span class="spec-badge">
                  {{
                    upstreamDecodedAudio
                      ? `${t('gameNodes.audioDsp.sourceUpstreamBadge')}${upstreamDecodedAudio.sourceLabel}`
                      : `${t('gameNodes.audioDsp.sourceSynthBadge')}${node.params.gameAudioSynthPreset ?? 'sword_slash'}`
                  }}
                </span>
              </div>

              <div class="waveform-lane">
                <div class="waveform-lane-head">
                  <span>{{ t('gameNodes.audioDsp.sourceWaveformLabel') }}</span>
                  <div class="waveform-metrics">
                    <span>{{ rawWaveformAnalysis.durationSec }}s</span>
                    <span>Peak: {{ rawWaveformAnalysis.peakDb }} dB</span>
                    <span v-if="(node.params.gameAudioDspMode ?? 'loop_bgm') === 'sfx_variants'">
                      Trim: -{{ rawWaveformAnalysis.trimmedLeadMs }}ms / -{{
                        rawWaveformAnalysis.trimmedTailMs
                      }}ms
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
                    <button type="button" class="mini-play-btn" @click="playSingleVariant(v.index)">
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
                    {{
                      audioConfigCopied
                        ? t('gameNodes.audioDsp.copiedHint')
                        : t('gameNodes.audioDsp.copyConfigBtn')
                    }}
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
              <div class="brush-toolbar">
                <span class="section-title">{{ t('gameNodes.levelMap.brushTitle') }}</span>
                <div class="brush-pills">
                  <button
                    v-for="b in levelBrushOptions"
                    :key="b.id"
                    type="button"
                    class="tab-pill"
                    :class="{ active: activeLevelBrush === b.id }"
                    @click="activeLevelBrush = b.id"
                  >
                    {{ b.label }}
                  </button>
                  <button type="button" class="secondary-btn" @click="clearLevelCustomEdits">
                    {{ t('gameNodes.levelMap.clearBrushEdits') }}
                  </button>
                </div>
              </div>
              <img
                :src="liveLevelPreviewDataUrl"
                alt="Level Map Preview"
                class="level-preview-img interactive-map"
                draggable="false"
                @pointerdown="onLevelMapPointerDown"
                @pointermove="onLevelMapPointerMove"
                @pointerup="levelPainting = false"
                @pointerleave="levelPainting = false"
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
            <span class="spec-badge">
              {{ t('gameNodes.playable.upstreamStatus') }}{{ playableUpstreamSummary }}
            </span>
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
import { computed, inject, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import {
  analyzeAudioWaveformAndTrim,
  applyAudioShaperPcm,
  applyCustomEditsToLevelMap,
  applyEqualPowerLoopCrossfadePcm,
  applyGameAudioEnvironmentFxPcm,
  applySeamlessTileBlend,
  compilePlayableGameSandboxHtml,
  createProceduralStoneTileRgba,
  decodeWavBytesToPcm,
  derivePbrMapsFromRgba,
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
  type LevelCellType,
  type LevelEntitySpawn,
  type LevelGeneratorAlgorithm,
  type LevelMapCustomEditsPayload,
  type ProceduralLevelMapResult
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
  patchParams({
    gameLevelSeed: Math.floor(100 + Math.random() * 99000),
    previewDataUrl: undefined,
    text: undefined
  })
}

function onClose(): void {
  editorDive?.popTo(-1)
}

// --- 1. game.pbrTile stage state & 2.5D Point-Light PBR Shader ---
const pbrTab = ref<'lighting' | 'grid' | 'channels'>('lighting')
const showSeamGrid = ref(true)
const pbrLightZ = ref(0.85)
const pbrLightIntensity = ref(1.45)
const pbrLightPos = ref({ x: 144, y: 144 })
const pbrLightCanvasRef = ref<HTMLCanvasElement | null>(null)
const pbrChannelCards = ref<Array<{ key: string; title: string; url: string }>>([])
const pbrSourceTileRgba = ref<Uint8ClampedArray | null>(null)

const PBR_TILE_DIM = 96
const PBR_CANVAS_DIM = PBR_TILE_DIM * 3

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
      pbrSourceTileRgba.value = null
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
    await loadPbrSourceTileRgba(resolved[0]?.url || '')
    renderPbrLightingCanvas()
  },
  { immediate: true }
)

async function loadPbrSourceTileRgba(url: string): Promise<void> {
  if (!url || typeof document === 'undefined' || typeof Image === 'undefined') {
    pbrSourceTileRgba.value = null
    return
  }
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.crossOrigin = 'anonymous'
      el.onload = () => resolve(el)
      el.onerror = (err) => reject(err)
      el.src = url
    })
    const offscreen = document.createElement('canvas')
    offscreen.width = PBR_TILE_DIM
    offscreen.height = PBR_TILE_DIM
    const ctx = offscreen.getContext('2d')
    if (!ctx) {
      pbrSourceTileRgba.value = null
      return
    }
    ctx.drawImage(img, 0, 0, PBR_TILE_DIM, PBR_TILE_DIM)
    pbrSourceTileRgba.value = ctx.getImageData(0, 0, PBR_TILE_DIM, PBR_TILE_DIM).data
  } catch {
    pbrSourceTileRgba.value = null
  }
}

const pbrPrimaryImageUrl = computed(() => pbrChannelCards.value[0]?.url || '')

const pbrLiveTileData = computed(() => {
  const base =
    pbrSourceTileRgba.value && pbrSourceTileRgba.value.length === PBR_TILE_DIM * PBR_TILE_DIM * 4
      ? pbrSourceTileRgba.value
      : createProceduralStoneTileRgba(PBR_TILE_DIM, PBR_TILE_DIM).data
  const seamlessEnabled = node.value?.params.gameTileSeamless !== false
  const blendRatio = Math.max(
    0.05,
    Math.min(0.45, Number(node.value?.params.gameTileBlendRatio ?? 0.22))
  )
  const albedo = seamlessEnabled
    ? applySeamlessTileBlend(base, PBR_TILE_DIM, PBR_TILE_DIM, { blendRatio })
    : base
  const normalStrength = Math.max(
    0.2,
    Math.min(12, Number(node.value?.params.gamePbrNormalStrength ?? 2.8))
  )
  const invertRoughness = Boolean(node.value?.params.gamePbrInvertRoughness)
  const maps = derivePbrMapsFromRgba(albedo, PBR_TILE_DIM, PBR_TILE_DIM, {
    normalStrength,
    normalFormat: 'opengl',
    wrapTiling: seamlessEnabled,
    invertRoughness,
    aoStrength: 0.85
  })
  return { albedo, maps }
})

function onPbrLightPointerMove(event: PointerEvent): void {
  const canvas = pbrLightCanvasRef.value
  if (!canvas) return
  const rect = canvas.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return
  const x = Math.max(
    0,
    Math.min(PBR_CANVAS_DIM - 1, ((event.clientX - rect.left) / rect.width) * PBR_CANVAS_DIM)
  )
  const y = Math.max(
    0,
    Math.min(PBR_CANVAS_DIM - 1, ((event.clientY - rect.top) / rect.height) * PBR_CANVAS_DIM)
  )
  pbrLightPos.value = { x, y }
  renderPbrLightingCanvas()
}

function renderPbrLightingCanvas(): void {
  const canvas = pbrLightCanvasRef.value
  if (!canvas || typeof canvas.getContext !== 'function') return
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const { albedo, maps } = pbrLiveTileData.value
  const { normal, roughness, ao } = maps
  const imgData = ctx.createImageData(PBR_CANVAS_DIM, PBR_CANVAS_DIM)
  const out = imgData.data
  const lx = pbrLightPos.value.x
  const ly = pbrLightPos.value.y
  const lz = pbrLightZ.value * 160
  const intensity = pbrLightIntensity.value

  for (let py = 0; py < PBR_CANVAS_DIM; py++) {
    const ty = py % PBR_TILE_DIM
    for (let px = 0; px < PBR_CANVAS_DIM; px++) {
      const tx = px % PBR_TILE_DIM
      const tIdx = (ty * PBR_TILE_DIM + tx) * 4
      const cIdx = (py * PBR_CANVAS_DIM + px) * 4

      const ar = albedo[tIdx] ?? 128
      const ag = albedo[tIdx + 1] ?? 128
      const ab = albedo[tIdx + 2] ?? 128

      const nx = ((normal[tIdx] ?? 128) / 255) * 2 - 1
      const ny = ((normal[tIdx + 1] ?? 128) / 255) * 2 - 1
      const nz = Math.max(0.05, ((normal[tIdx + 2] ?? 255) / 255) * 2 - 1)

      const dx = lx - px
      const dy = -(ly - py)
      const dz = lz
      const dist = Math.hypot(dx, dy, dz) || 1
      const lxN = dx / dist
      const lyN = dy / dist
      const lzN = dz / dist

      const atten = intensity / (1 + (dist / 210) * (dist / 210) * 0.78)
      const ndotl = Math.max(0, nx * lxN + ny * lyN + nz * lzN)

      const hLen = Math.hypot(lxN, lyN, lzN + 1) || 1
      const hx = lxN / hLen
      const hy = lyN / hLen
      const hz = (lzN + 1) / hLen
      const ndoth = Math.max(0, nx * hx + ny * hy + nz * hz)

      const rough = (roughness[tIdx] ?? 140) / 255
      const shininess = Math.max(4, (1 - rough) * 64)
      const spec = Math.pow(ndoth, shininess) * (1 - rough * 0.65) * 0.58
      const aoVal = 0.35 + 0.65 * ((ao[tIdx] ?? 220) / 255)
      const lit = 0.2 * aoVal + ndotl * atten * aoVal

      out[cIdx] = Math.min(255, Math.max(0, Math.round(ar * lit + 255 * spec * atten)))
      out[cIdx + 1] = Math.min(255, Math.max(0, Math.round(ag * lit + 245 * spec * atten)))
      out[cIdx + 2] = Math.min(255, Math.max(0, Math.round(ab * lit + 225 * spec * atten)))
      out[cIdx + 3] = 255
    }
  }
  ctx.putImageData(imgData, 0, 0)

  if (showSeamGrid.value) {
    ctx.save()
    ctx.strokeStyle = 'rgba(130, 180, 255, 0.38)'
    ctx.setLineDash([4, 4])
    ctx.lineWidth = 1
    for (const step of [PBR_TILE_DIM, PBR_TILE_DIM * 2]) {
      ctx.beginPath()
      ctx.moveTo(step, 0)
      ctx.lineTo(step, PBR_CANVAS_DIM)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(0, step)
      ctx.lineTo(PBR_CANVAS_DIM, step)
      ctx.stroke()
    }
    ctx.restore()
  }

  ctx.save()
  ctx.beginPath()
  ctx.arc(lx, ly, 7, 0, Math.PI * 2)
  ctx.strokeStyle = 'rgba(255, 240, 180, 0.92)'
  ctx.lineWidth = 2
  ctx.stroke()
  ctx.restore()
}

watch(
  () => [
    node.value?.typeId,
    pbrTab.value,
    pbrLiveTileData.value,
    showSeamGrid.value,
    pbrLightZ.value,
    pbrLightIntensity.value
  ],
  async () => {
    if (node.value?.typeId === 'game.pbrTile' && pbrTab.value === 'lighting') {
      await nextTick()
      renderPbrLightingCanvas()
    }
  },
  { immediate: true }
)

// --- 2. game.audioDsp stage state, Upstream Audio Decoding & Audio Shaper ---
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
const audioHighPassHz = computed(() =>
  Math.max(0, Math.min(1200, Number(node.value?.params.gameAudioHighPassHz ?? 0)))
)
const audioLowPassHz = computed(() =>
  Math.max(800, Math.min(20000, Number(node.value?.params.gameAudioLowPassHz ?? 20000)))
)
const audioReleaseTighten = computed(() =>
  Math.max(0, Math.min(0.95, Number(node.value?.params.gameAudioReleaseTighten ?? 0)))
)

const upstreamDecodedAudio = ref<{
  channels: Float32Array[]
  sampleRate: number
  sourceLabel: string
} | null>(null)

function decodeBase64DataUrlToBytes(dataUrl: string): Uint8Array | null {
  const commaIdx = dataUrl.indexOf(',')
  if (commaIdx < 0) return null
  const b64 = dataUrl.slice(commaIdx + 1).trim()
  if (!b64) return null
  try {
    if (typeof atob === 'function') {
      const bin = atob(b64)
      const out = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
      return out
    }
  } catch {
    return null
  }
  return null
}

watch(
  () =>
    [node.value?.id, node.value?.typeId, hostId.value, graphEditorHosts.revision.value] as const,
  async () => {
    const current = node.value
    if (!current || current.typeId !== 'game.audioDsp' || !hostId.value) {
      upstreamDecodedAudio.value = null
      return
    }
    const edges = graphEditorHosts.listIncomingEdges(hostId.value, current.id)
    for (const edge of edges) {
      const srcNode = graphEditorHosts.getNode(hostId.value, edge.sourceNodeId)
      if (!srcNode) continue
      const voices = srcNode.params.generatedVoices ?? []
      for (const rawVoice of voices) {
        const voice = rawVoice as { dataUrl?: string; relativePath?: string; title?: string }
        let url = voice.dataUrl?.trim() || ''
        if (!url && voice.relativePath?.trim()) {
          try {
            url = (await resolveAssetPreviewUrl(voice.relativePath.trim())) || ''
          } catch {
            url = ''
          }
        }
        if (!url) continue
        if (url.startsWith('data:audio/')) {
          const bytes = decodeBase64DataUrlToBytes(url)
          if (bytes) {
            const decoded = decodeWavBytesToPcm(bytes)
            if (decoded && decoded.channels[0]?.length) {
              upstreamDecodedAudio.value = {
                channels: decoded.channels,
                sampleRate: decoded.sampleRate,
                sourceLabel: srcNode.title || voice.title || 'Upstream WAV'
              }
              return
            }
          }
        }
        try {
          const resp = await fetch(url)
          const buf = await resp.arrayBuffer()
          const wav = decodeWavBytesToPcm(new Uint8Array(buf))
          if (wav && wav.channels[0]?.length) {
            upstreamDecodedAudio.value = {
              channels: wav.channels,
              sampleRate: wav.sampleRate,
              sourceLabel: srcNode.title || voice.title || 'Upstream WAV'
            }
            return
          }
          const Ctx =
            window.AudioContext ||
            (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
          if (Ctx) {
            const tmpCtx = new Ctx()
            try {
              const audioBuf = await tmpCtx.decodeAudioData(buf.slice(0))
              upstreamDecodedAudio.value = {
                channels: [new Float32Array(audioBuf.getChannelData(0))],
                sampleRate: audioBuf.sampleRate,
                sourceLabel: srcNode.title || voice.title || 'Upstream Audio'
              }
              return
            } finally {
              void tmpCtx.close().catch(() => {})
            }
          }
        } catch {
          // ignore and try next
        }
      }
    }
    upstreamDecodedAudio.value = null
  },
  { immediate: true }
)

const sfxVariantsPlan = computed(() =>
  planSfxVariantMatrix({
    count: audioVariantCount.value,
    pitchSpreadSemitones: audioPitchSpread.value,
    tempoSpread: 0.08
  })
)

const liveRawAudioBuffer = computed(() => {
  if (upstreamDecodedAudio.value && upstreamDecodedAudio.value.channels[0]?.length) {
    return upstreamDecodedAudio.value
  }
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
  const shaped = applyAudioShaperPcm(stage, sr, {
    highPassHz: audioHighPassHz.value,
    lowPassHz: audioLowPassHz.value,
    releaseTighten: mode === 'sfx_variants' ? audioReleaseTighten.value : 0
  })
  const withFx =
    audioEnvFx.value !== 'none'
      ? applyGameAudioEnvironmentFxPcm(shaped, sr, audioEnvFx.value)
      : shaped
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
  const shaped = applyAudioShaperPcm(trimmed, sr, {
    highPassHz: audioHighPassHz.value,
    lowPassHz: audioLowPassHz.value,
    releaseTighten: audioReleaseTighten.value
  })
  const spec = sfxVariantsPlan.value[variantIndex] ?? sfxVariantsPlan.value[0]
  const shifted = spec
    ? resamplePitchShiftPcm(shaped, spec.semitoneOffset, spec.trebleGainDb)
    : shaped
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

// --- 3. game.levelMap stage state & Interactive Paint Brush ---
const levelTab = ref<'map' | 'tmj'>('map')
type LevelBrushToolId = LevelCellType | LevelEntitySpawn['type']
const activeLevelBrush = ref<LevelBrushToolId>('floor')
const levelPainting = ref(false)

const levelBrushOptions = computed<Array<{ id: LevelBrushToolId; icon: string; label: string }>>(
  () => [
    { id: 'floor', icon: '⬜', label: t('gameNodes.levelMap.brushFloor') },
    { id: 'wall', icon: '🧱', label: t('gameNodes.levelMap.brushWall') },
    { id: 'hazard', icon: '🔥', label: t('gameNodes.levelMap.brushHazard') },
    { id: 'platform', icon: '🪜', label: t('gameNodes.levelMap.brushPlatform') },
    { id: 'player_spawn', icon: '🟢', label: t('gameNodes.levelMap.brushSpawn') },
    { id: 'boss_spawn', icon: '💀', label: t('gameNodes.levelMap.brushBoss') },
    { id: 'enemy_spawn', icon: '👾', label: t('gameNodes.levelMap.brushEnemy') },
    { id: 'treasure_chest', icon: '💎', label: t('gameNodes.levelMap.brushChest') },
    { id: 'exit_portal', icon: '🚪', label: t('gameNodes.levelMap.brushExit') }
  ]
)

const liveLevelData = computed(() => {
  const alg = (node.value?.params.gameLevelAlgorithm ?? 'bsp_dungeon') as LevelGeneratorAlgorithm
  const width = Math.max(12, Math.min(64, Number(node.value?.params.gameLevelWidth ?? 32)))
  const height = Math.max(10, Math.min(48, Number(node.value?.params.gameLevelHeight ?? 20)))
  const seed = Number(node.value?.params.gameLevelSeed ?? 1337)
  const base = generateProceduralLevelMap({
    algorithm: alg,
    width,
    height,
    seed
  })
  return applyCustomEditsToLevelMap(base, node.value?.params.gameLevelCustomEdits)
})

const liveLevelPreviewDataUrl = computed(() => {
  if (!node.value?.params.gameLevelCustomEdits && node.value?.params.previewDataUrl?.trim()) {
    return node.value.params.previewDataUrl.trim()
  }
  return renderProceduralLevelToPng(liveLevelData.value, 14).dataUrl
})

const liveLevelTmjJson = computed(() => {
  if (!node.value?.params.gameLevelCustomEdits) {
    const stored = node.value?.params.text?.trim()
    if (stored && stored.startsWith('{')) return stored
  }
  return JSON.stringify(liveLevelData.value.tiledMap, null, 2)
})

function paintLevelAtPointer(event: PointerEvent, allowEntityPlacement: boolean): void {
  const target = event.currentTarget as HTMLElement | null
  if (!target || !node.value) return
  const rect = target.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return
  const width = liveLevelData.value.width
  const height = liveLevelData.value.height
  const gx = Math.max(
    0,
    Math.min(width - 1, Math.floor(((event.clientX - rect.left) / rect.width) * width))
  )
  const gy = Math.max(
    0,
    Math.min(height - 1, Math.floor(((event.clientY - rect.top) / rect.height) * height))
  )

  let payload: LevelMapCustomEditsPayload = { cells: {}, entities: [] }
  const raw = node.value.params.gameLevelCustomEdits?.trim()
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as LevelMapCustomEditsPayload
      payload = {
        cells: parsed.cells ? { ...parsed.cells } : {},
        entities: Array.isArray(parsed.entities) ? [...parsed.entities] : []
      }
    } catch {
      payload = { cells: {}, entities: [] }
    }
  }

  const tool = activeLevelBrush.value
  if (
    tool === 'floor' ||
    tool === 'wall' ||
    tool === 'hazard' ||
    tool === 'platform' ||
    tool === 'void'
  ) {
    if (!payload.cells) payload.cells = {}
    payload.cells[`${gx},${gy}`] = tool
  } else if (allowEntityPlacement) {
    if (!payload.cells) payload.cells = {}
    payload.cells[`${gx},${gy}`] = 'floor'
    const existingEntities = payload.entities ?? []
    const filtered = existingEntities.filter(
      (ent) =>
        !(ent.x === gx && ent.y === gy) &&
        !(
          (tool === 'player_spawn' || tool === 'boss_spawn' || tool === 'exit_portal') &&
          ent.type === tool
        )
    )
    filtered.push({
      type: tool,
      x: gx,
      y: gy
    })
    payload.entities = filtered
  } else {
    return
  }

  patchParams({
    gameLevelCustomEdits: JSON.stringify(payload),
    previewDataUrl: undefined,
    text: undefined
  })
}

function onLevelMapPointerDown(event: PointerEvent): void {
  levelPainting.value = true
  paintLevelAtPointer(event, true)
}

function onLevelMapPointerMove(event: PointerEvent): void {
  if (!levelPainting.value) return
  paintLevelAtPointer(event, false)
}

function clearLevelCustomEdits(): void {
  patchParams({
    gameLevelCustomEdits: undefined,
    previewDataUrl: undefined,
    text: undefined
  })
}

// --- 4. game.playable stage state & Upstream Asset Hot-Binding ---
const showHtmlSource = ref(false)
const playableReloadSeq = ref(0)

const playableUpstreamAssets = ref<{
  playerSpriteDataUrl?: string
  enemySpriteDataUrl?: string
  tileSpriteDataUrl?: string
  levelMap?: ProceduralLevelMapResult
  audioCount: number
  spriteCount: number
  hasUpstreamLevel: boolean
}>({
  audioCount: 0,
  spriteCount: 0,
  hasUpstreamLevel: false
})

watch(
  () =>
    [node.value?.id, node.value?.typeId, hostId.value, graphEditorHosts.revision.value] as const,
  async () => {
    const current = node.value
    if (!current || current.typeId !== 'game.playable' || !hostId.value) {
      playableUpstreamAssets.value = { audioCount: 0, spriteCount: 0, hasUpstreamLevel: false }
      return
    }
    const edges = graphEditorHosts.listIncomingEdges(hostId.value, current.id)
    const spriteUrls: string[] = []
    let upstreamLevel: ProceduralLevelMapResult | undefined
    let audioCount = 0

    for (const edge of edges) {
      const srcNode = graphEditorHosts.getNode(hostId.value, edge.sourceNodeId)
      if (!srcNode) continue

      if (srcNode.typeId === 'game.levelMap') {
        const alg = (srcNode.params.gameLevelAlgorithm ?? 'bsp_dungeon') as LevelGeneratorAlgorithm
        const w = Math.max(12, Math.min(64, Number(srcNode.params.gameLevelWidth ?? 32)))
        const h = Math.max(10, Math.min(48, Number(srcNode.params.gameLevelHeight ?? 20)))
        const s = Number(srcNode.params.gameLevelSeed ?? 1337)
        const base = generateProceduralLevelMap({ algorithm: alg, width: w, height: h, seed: s })
        upstreamLevel = applyCustomEditsToLevelMap(base, srcNode.params.gameLevelCustomEdits)
      }

      if ((srcNode.params.generatedVoices?.length ?? 0) > 0) {
        audioCount += srcNode.params.generatedVoices?.length ?? 0
      }

      if (srcNode.typeId !== 'game.levelMap') {
        const imgs = srcNode.params.generatedImages ?? []
        for (const item of imgs) {
          let url = item.dataUrl?.trim() || ''
          if (!url && item.relativePath?.trim()) {
            try {
              url = (await resolveAssetPreviewUrl(item.relativePath.trim())) || ''
            } catch {
              url = ''
            }
          }
          if (url) {
            spriteUrls.push(url)
            break
          }
        }
        if (spriteUrls.length === 0 && srcNode.params.previewDataUrl?.trim()) {
          spriteUrls.push(srcNode.params.previewDataUrl.trim())
        }
      }
    }

    playableUpstreamAssets.value = {
      playerSpriteDataUrl: spriteUrls[0],
      enemySpriteDataUrl: spriteUrls[1],
      tileSpriteDataUrl: spriteUrls[2],
      levelMap: upstreamLevel,
      audioCount,
      spriteCount: spriteUrls.length,
      hasUpstreamLevel: Boolean(upstreamLevel)
    }
  },
  { immediate: true }
)

const playableUpstreamSummary = computed(() => {
  const info = playableUpstreamAssets.value
  return `Sprites: ${info.spriteCount} · Level: ${info.hasUpstreamLevel ? 'Connected' : 'PCG'} · Audio: ${info.audioCount}`
})

function buildPlayableHtmlFromNode(current: GraphNode | null, ignoreStored = false): string {
  if (!current) return ''
  const info = playableUpstreamAssets.value
  const hasUpstream = info.spriteCount > 0 || info.hasUpstreamLevel
  const stored = current.params.gamePlayableHtml?.trim()
  if (!ignoreStored && !hasUpstream && stored && stored.includes('<html')) return stored
  const alg = (current.params.gameLevelAlgorithm ?? 'bsp_dungeon') as LevelGeneratorAlgorithm
  const seed = Number(current.params.gameLevelSeed ?? 42)
  const genreRaw = current.params.gamePlayableGenre ?? 'roguelike_action'
  const cameraRaw = current.params.gamePlayableCameraMode ?? 'topdown_34'
  const mode = genreRaw === 'platformer' || cameraRaw === 'side_view' ? 'platformer' : 'survivor'
  const levelMap =
    info.levelMap ??
    generateProceduralLevelMap({
      algorithm: mode === 'platformer' ? 'platformer_course' : alg,
      width: 28,
      height: 18,
      seed
    })
  return compilePlayableGameSandboxHtml({
    title: current.params.gamePlayableTitle || 'Indie Game Prototype',
    mode,
    levelSeed: seed,
    levelMap,
    playerSpriteDataUrl: info.playerSpriteDataUrl,
    enemySpriteDataUrl: info.enemySpriteDataUrl,
    tileSpriteDataUrl: info.tileSpriteDataUrl
  }).html
}

const livePlayableHtml = computed(() => buildPlayableHtmlFromNode(node.value))

function recompilePlayableNow(): void {
  const current = node.value
  if (!current) return
  const html = buildPlayableHtmlFromNode(current, true)
  patchParams({ gamePlayableHtml: html })
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

.pbr-lighting-stage {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  width: 100%;
}

.pbr-light-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 16px;
  padding: 8px 14px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--panel) 90%, transparent);
  border: 1px solid color-mix(in srgb, var(--border) 80%, transparent);
}

.inline-slider {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}

.pbr-light-canvas {
  width: 480px;
  height: 480px;
  max-width: 100%;
  border-radius: 10px;
  border: 1px solid color-mix(in srgb, var(--border) 82%, transparent);
  cursor: crosshair;
  image-rendering: pixelated;
}

.pbr-light-hint {
  margin: 0;
  font-size: 12px;
  color: var(--text-muted);
}

.source-pill {
  font-size: 11px;
  padding: 4px 8px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--panel) 92%, transparent);
  border: 1px solid color-mix(in srgb, var(--border) 80%, transparent);
  color: var(--text-muted);
}

.source-pill.upstream {
  background: color-mix(in srgb, var(--accent) 16%, var(--panel));
  border-color: color-mix(in srgb, var(--accent) 42%, transparent);
  color: var(--text);
}

.brush-palette {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
}

.brush-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 5px 7px;
  border-radius: 6px;
  border: 1px solid color-mix(in srgb, var(--border) 80%, transparent);
  background: color-mix(in srgb, var(--panel) 90%, transparent);
  color: var(--text);
  font-size: 11px;
  cursor: pointer;
}

.brush-btn.active {
  background: color-mix(in srgb, var(--accent) 20%, var(--panel));
  border-color: color-mix(in srgb, var(--accent) 48%, transparent);
  font-weight: 600;
}

.level-paint-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  user-select: none;
}

.level-preview-img.paintable {
  cursor: crosshair;
  user-select: none;
  -webkit-user-drag: none;
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
