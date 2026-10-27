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

          <label class="field">
            <span>{{ t('gameNodes.pbrTile.materialPreset') }}</span>
            <select
              :value="node.params.gamePbrMaterialPreset ?? 'stone_dungeon'"
              @change="onPbrMaterialPresetChange($event)"
            >
              <option value="stone_dungeon">{{ t('gameNodes.pbrTile.matStone') }}</option>
              <option value="brushed_metal">{{ t('gameNodes.pbrTile.matMetal') }}</option>
              <option value="wet_mud">{{ t('gameNodes.pbrTile.matMud') }}</option>
              <option value="stylized_wood">{{ t('gameNodes.pbrTile.matWood') }}</option>
              <option value="gold_ornament">{{ t('gameNodes.pbrTile.matGold') }}</option>
            </select>
          </label>

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

          <label class="field">
            <span>{{ t('gameNodes.pbrTile.normalFormat') }}</span>
            <select
              :value="node.params.gamePbrNormalFormat ?? 'opengl'"
              @change="onStringParam('gamePbrNormalFormat', $event)"
            >
              <option value="opengl">{{ t('gameNodes.pbrTile.normalOpenGL') }}</option>
              <option value="directx">{{ t('gameNodes.pbrTile.normalDirectX') }}</option>
            </select>
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

          <label class="slider-field">
            <div class="slider-head">
              <span>{{ t('gameNodes.pbrTile.roughnessContrast') }}</span>
              <b>{{ Number(node.params.gamePbrRoughnessContrast ?? 1.2).toFixed(2) }}</b>
            </div>
            <input
              type="range"
              min="0.2"
              max="3.0"
              step="0.05"
              :value="node.params.gamePbrRoughnessContrast ?? 1.2"
              @change="onNumberParam('gamePbrRoughnessContrast', $event)"
            />
          </label>

          <label class="slider-field">
            <div class="slider-head">
              <span>{{ t('gameNodes.pbrTile.aoStrength') }}</span>
              <b>{{ Number(node.params.gamePbrAoStrength ?? 0.85).toFixed(2) }}</b>
            </div>
            <input
              type="range"
              min="0"
              max="2.0"
              step="0.05"
              :value="node.params.gamePbrAoStrength ?? 0.85"
              @change="onNumberParam('gamePbrAoStrength', $event)"
            />
          </label>

          <label class="slider-field">
            <div class="slider-head">
              <span>{{ t('gameNodes.pbrTile.metallicScale') }}</span>
              <b>{{ Number(node.params.gamePbrMetallicScale ?? 0.25).toFixed(2) }}</b>
            </div>
            <input
              type="range"
              min="0"
              max="2.0"
              step="0.05"
              :value="node.params.gamePbrMetallicScale ?? 0.25"
              @change="onNumberParam('gamePbrMetallicScale', $event)"
            />
          </label>

          <label class="slider-field">
            <div class="slider-head">
              <span>{{ t('gameNodes.pbrTile.maxHullVertices') }}</span>
              <b>{{ Number(node.params.gamePbrMaxHullVertices ?? 8) }}</b>
            </div>
            <input
              type="range"
              min="4"
              max="16"
              step="1"
              :value="node.params.gamePbrMaxHullVertices ?? 8"
              @change="onNumberParam('gamePbrMaxHullVertices', $event)"
            />
          </label>

          <label class="field">
            <span>{{ t('gameNodes.pbrTile.pivotMode') }}</span>
            <select
              :value="node.params.gamePbrPivotMode ?? 'bottom_center'"
              @change="onStringParam('gamePbrPivotMode', $event)"
            >
              <option value="bottom_center">{{ t('gameNodes.pbrTile.pivotBottomCenter') }}</option>
              <option value="center">{{ t('gameNodes.pbrTile.pivotCenter') }}</option>
              <option value="top_left">{{ t('gameNodes.pbrTile.pivotTopLeft') }}</option>
            </select>
          </label>

          <div class="section-title">{{ t('gameNodes.pbrTile.nineSliceTitle') }}</div>
          <div class="grid2">
            <label class="field">
              <span>{{ t('gameNodes.pbrTile.sliceLeft') }}</span>
              <input
                type="number"
                min="0"
                max="44"
                :value="node.params.gameNineSliceLeft ?? pbrAutoNineSlice.borders.left"
                @change="onNumberParam('gameNineSliceLeft', $event)"
              />
            </label>
            <label class="field">
              <span>{{ t('gameNodes.pbrTile.sliceRight') }}</span>
              <input
                type="number"
                min="0"
                max="44"
                :value="node.params.gameNineSliceRight ?? pbrAutoNineSlice.borders.right"
                @change="onNumberParam('gameNineSliceRight', $event)"
              />
            </label>
            <label class="field">
              <span>{{ t('gameNodes.pbrTile.sliceTop') }}</span>
              <input
                type="number"
                min="0"
                max="44"
                :value="node.params.gameNineSliceTop ?? pbrAutoNineSlice.borders.top"
                @change="onNumberParam('gameNineSliceTop', $event)"
              />
            </label>
            <label class="field">
              <span>{{ t('gameNodes.pbrTile.sliceBottom') }}</span>
              <input
                type="number"
                min="0"
                max="44"
                :value="node.params.gameNineSliceBottom ?? pbrAutoNineSlice.borders.bottom"
                @change="onNumberParam('gameNineSliceBottom', $event)"
              />
            </label>
          </div>
          <button type="button" class="secondary-btn" @click="resetNineSliceBorders">
            {{ t('gameNodes.pbrTile.resetNineSlice') }}
          </button>

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

          <label class="slider-field">
            <div class="slider-head">
              <span>{{ t('gameNodes.audioDsp.synthDuration') }}</span>
              <b>{{ Number(node.params.gameAudioSynthDuration ?? 1.0).toFixed(2) }}×</b>
            </div>
            <input
              type="range"
              min="0.3"
              max="2.5"
              step="0.1"
              :value="node.params.gameAudioSynthDuration ?? 1.0"
              @change="onNumberParam('gameAudioSynthDuration', $event)"
            />
          </label>

          <label class="slider-field">
            <div class="slider-head">
              <span>{{ t('gameNodes.audioDsp.basePitchSt') }}</span>
              <b>
                {{
                  Number(node.params.gameAudioBasePitch ?? 0) >= 0
                    ? `+${Number(node.params.gameAudioBasePitch ?? 0)}`
                    : Number(node.params.gameAudioBasePitch ?? 0)
                }}
                st
              </b>
            </div>
            <input
              type="range"
              min="-12"
              max="12"
              step="1"
              :value="node.params.gameAudioBasePitch ?? 0"
              @change="onNumberParam('gameAudioBasePitch', $event)"
            />
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
              <option value="tower_defense">{{ t('gameNodes.levelMap.algTowerDefense') }}</option>
              <option value="labyrinth_maze">{{ t('gameNodes.levelMap.algLabyrinth') }}</option>
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

          <label class="check-row">
            <input v-model="showCriticalPath" type="checkbox" />
            <span>{{ t('gameNodes.levelMap.showCriticalPath') }}</span>
          </label>

          <label class="check-row">
            <input v-model="showWangBitmask" type="checkbox" />
            <span>{{ t('gameNodes.levelMap.showWangBitmask') }}</span>
          </label>

          <div v-if="node.params.gameLevelReport" class="report-chip">
            {{ node.params.gameLevelReport }}
          </div>
        </div>

        <!-- 4. game.playable -->
        <div v-else-if="node.typeId === 'game.playable'" class="param-card">
          <div class="section-title">{{ t('gameNodes.playable.sectionTitle') }}</div>

          <button type="button" class="action-btn" @click="autoWireFourNodePipeline">
            {{ t('gameNodes.playable.autoWireBtn') }}
          </button>
          <div v-if="autoWireDone" class="report-chip">
            {{ t('gameNodes.playable.autoWireDoneHint') }}
          </div>

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
              <option value="tower_defense">{{ t('gameNodes.playable.genreTowerDefense') }}</option>
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

          <div class="section-title">{{ t('gameNodes.playable.tuningTitle') }}</div>

          <label class="slider-field">
            <div class="slider-head">
              <span>{{ t('gameNodes.playable.moveSpeedScale') }}</span>
              <b>{{ Number(node.params.gamePlayableMoveSpeed ?? 1.0).toFixed(2) }}×</b>
            </div>
            <input
              type="range"
              min="0.4"
              max="2.5"
              step="0.1"
              :value="node.params.gamePlayableMoveSpeed ?? 1.0"
              @input="onPlayableTuneNumber('gamePlayableMoveSpeed', $event)"
            />
          </label>

          <label class="slider-field">
            <div class="slider-head">
              <span>{{ t('gameNodes.playable.jumpDashScale') }}</span>
              <b>{{ Number(node.params.gamePlayableJumpDash ?? 1.0).toFixed(2) }}×</b>
            </div>
            <input
              type="range"
              min="0.4"
              max="2.5"
              step="0.1"
              :value="node.params.gamePlayableJumpDash ?? 1.0"
              @input="onPlayableTuneNumber('gamePlayableJumpDash', $event)"
            />
          </label>

          <label class="slider-field">
            <div class="slider-head">
              <span>{{ t('gameNodes.playable.enemyAggroScale') }}</span>
              <b>{{ Number(node.params.gamePlayableEnemyAggro ?? 1.0).toFixed(2) }}×</b>
            </div>
            <input
              type="range"
              min="0.4"
              max="2.5"
              step="0.1"
              :value="node.params.gamePlayableEnemyAggro ?? 1.0"
              @input="onPlayableTuneNumber('gamePlayableEnemyAggro', $event)"
            />
          </label>

          <label class="slider-field">
            <div class="slider-head">
              <span>{{ t('gameNodes.playable.screenShakeScale') }}</span>
              <b>{{ Math.round(Number(node.params.gamePlayableScreenShake ?? 1.0) * 100) }}%</b>
            </div>
            <input
              type="range"
              min="0"
              max="2.0"
              step="0.1"
              :value="node.params.gamePlayableScreenShake ?? 1.0"
              @input="onPlayableTuneNumber('gamePlayableScreenShake', $event)"
            />
          </label>

          <label class="slider-field">
            <div class="slider-head">
              <span>{{ t('gameNodes.playable.timeScale') }}</span>
              <b>{{ Number(node.params.gamePlayableTimeScale ?? 1.0).toFixed(2) }}×</b>
            </div>
            <input
              type="range"
              min="0.25"
              max="1.5"
              step="0.05"
              :value="node.params.gamePlayableTimeScale ?? 1.0"
              @input="onPlayableTuneNumber('gamePlayableTimeScale', $event)"
            />
          </label>

          <label class="check-row">
            <input
              type="checkbox"
              :checked="Boolean(node.params.gamePlayableShowHitboxes)"
              @change="onPlayableTuneBool('gamePlayableShowHitboxes', $event)"
            />
            <span>{{ t('gameNodes.playable.showDebugHitboxes') }}</span>
          </label>

          <button type="button" class="action-btn" @click="recompilePlayableNow">
            {{ t('gameNodes.workbench.recompileBtn') }}
          </button>

          <button type="button" class="secondary-btn" @click="downloadPlayableHtml">
            {{ t('gameNodes.playable.downloadHtmlBtn') }}
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
                :class="{ active: pbrTab === 'physics' }"
                @click="pbrTab = 'physics'"
              >
                {{ t('gameNodes.workbench.pbrPhysicsTab') }}
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
                    <span>{{ t('gameNodes.workbench.pbrLightEnv') }}</span>
                    <select v-model="pbrLightEnv" @change="renderPbrLightingCanvas">
                      <option value="torch_warm">{{ t('gameNodes.workbench.pbrEnvTorch') }}</option>
                      <option value="studio_neutral">
                        {{ t('gameNodes.workbench.pbrEnvStudio') }}
                      </option>
                      <option value="moon_cold">{{ t('gameNodes.workbench.pbrEnvMoon') }}</option>
                      <option value="cyber_neon">{{ t('gameNodes.workbench.pbrEnvCyber') }}</option>
                    </select>
                  </label>
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
                  <button
                    type="button"
                    class="tab-pill"
                    :class="{ active: pbrAutoOrbit }"
                    @click="togglePbrAutoOrbit"
                  >
                    {{ t('gameNodes.workbench.pbrAutoOrbit') }}
                  </button>
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

            <div v-else-if="pbrTab === 'physics'" class="pbr-lighting-stage">
              <div class="pbr-light-controls">
                <span class="hint">{{ t('gameNodes.workbench.pbrPhysicsHullLegend') }}</span>
                <div class="tab-pills">
                  <button type="button" class="secondary-btn" @click="copyPbrPhysicsManifest">
                    {{
                      pbrManifestCopied
                        ? t('gameNodes.audioDsp.copiedHint')
                        : t('gameNodes.workbench.copyManifestBtn')
                    }}
                  </button>
                  <button type="button" class="secondary-btn" @click="downloadAutoTileManifest">
                    {{ t('gameNodes.pbrTile.downloadAutoTileBtn') }}
                  </button>
                  <button type="button" class="secondary-btn" @click="downloadBmFontFnt">
                    {{ t('gameNodes.pbrTile.downloadBmFontBtn') }}
                  </button>
                </div>
              </div>
              <div class="physics-hull-stage">
                <img
                  :src="pbrLiveAlbedoDataUrl"
                  alt=""
                  class="physics-base-img"
                  draggable="false"
                />
                <svg
                  class="physics-overlay-svg"
                  :viewBox="`0 0 ${PBR_TILE_DIM} ${PBR_TILE_DIM}`"
                  preserveAspectRatio="none"
                >
                  <!-- 9-Slice Guides -->
                  <line
                    :x1="pbrLiveNineSlice.borders.left"
                    y1="0"
                    :x2="pbrLiveNineSlice.borders.left"
                    :y2="PBR_TILE_DIM"
                    class="slice-guide-line"
                  />
                  <line
                    :x1="PBR_TILE_DIM - pbrLiveNineSlice.borders.right"
                    y1="0"
                    :x2="PBR_TILE_DIM - pbrLiveNineSlice.borders.right"
                    :y2="PBR_TILE_DIM"
                    class="slice-guide-line"
                  />
                  <line
                    x1="0"
                    :y1="pbrLiveNineSlice.borders.top"
                    :x2="PBR_TILE_DIM"
                    :y2="pbrLiveNineSlice.borders.top"
                    class="slice-guide-line"
                  />
                  <line
                    x1="0"
                    :y1="PBR_TILE_DIM - pbrLiveNineSlice.borders.bottom"
                    :x2="PBR_TILE_DIM"
                    :y2="PBR_TILE_DIM - pbrLiveNineSlice.borders.bottom"
                    class="slice-guide-line"
                  />

                  <!-- Hurtbox & Hitbox -->
                  <rect
                    :x="pbrLivePhysics.combatBoxes.hurtbox.x"
                    :y="pbrLivePhysics.combatBoxes.hurtbox.y"
                    :width="pbrLivePhysics.combatBoxes.hurtbox.width"
                    :height="pbrLivePhysics.combatBoxes.hurtbox.height"
                    class="box-hurtbox"
                  />
                  <rect
                    :x="pbrLivePhysics.combatBoxes.hitbox.x"
                    :y="pbrLivePhysics.combatBoxes.hitbox.y"
                    :width="pbrLivePhysics.combatBoxes.hitbox.width"
                    :height="pbrLivePhysics.combatBoxes.hitbox.height"
                    class="box-hitbox"
                  />

                  <!-- Convex Collision Hull Polygon -->
                  <polygon :points="pbrHullPolygonPoints" class="hull-polygon" />
                  <circle
                    v-for="(pt, idx) in pbrLivePhysics.hull.verticesPx"
                    :key="`hull-pt-${idx}`"
                    :cx="pt.x"
                    :cy="pt.y"
                    r="1.8"
                    class="hull-vertex"
                  />

                  <!-- Pivot Crosshair -->
                  <circle
                    :cx="pbrLivePhysics.hull.pivot.x"
                    :cy="pbrLivePhysics.hull.pivot.y"
                    r="2.6"
                    class="pivot-dot"
                  />
                </svg>
              </div>
              <div class="level-stats-bar">
                <span>Hull Vertices: {{ pbrLivePhysics.hull.verticesPx.length }}</span>
                <span>
                  9-Slice (L/R/T/B): {{ pbrLiveNineSlice.borders.left }}/{{
                    pbrLiveNineSlice.borders.right
                  }}/{{ pbrLiveNineSlice.borders.top }}/{{ pbrLiveNineSlice.borders.bottom }}px
                </span>
                <span>
                  Pivot: ({{ pbrLivePhysics.hull.pivot.x }}, {{ pbrLivePhysics.hull.pivot.y }})
                </span>
              </div>
            </div>

            <div
              v-else-if="pbrTab === 'grid'"
              class="tile-grid-3x3"
              :class="{ 'show-seams': showSeamGrid }"
            >
              <img
                v-for="idx in 9"
                :key="idx"
                :src="pbrPrimaryImageUrl || pbrLiveAlbedoDataUrl"
                alt=""
                class="tile-cell"
                draggable="false"
              />
            </div>

            <div
              v-else-if="pbrTab === 'channels' && displayPbrChannelCards.length"
              class="pbr-channels-grid"
            >
              <div
                v-for="(item, index) in displayPbrChannelCards"
                :key="item.key"
                class="channel-card"
              >
                <div class="channel-card-head">
                  <span>#{{ index + 1 }}</span>
                  <b>{{ item.title }}</b>
                  <button
                    type="button"
                    class="mini-play-btn"
                    @click="downloadDataUrlFile(item.url, `${item.title}.png`)"
                  >
                    {{ t('gameNodes.pbrTile.downloadPngBtn') }}
                  </button>
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
              <button type="button" class="secondary-btn" @click="downloadMasterWav">
                {{ t('gameNodes.audioDsp.downloadWavBtn') }}
              </button>
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

            <!-- 8-Band Octave Spectrum Analyzer & LUFS Loudness Meter + 3D Spatial Audition Deck -->
            <div class="audio-pro-grid">
              <div class="waveform-compare-card">
                <div class="waveform-lane-head">
                  <span class="section-title">{{ t('gameNodes.audioDsp.spectrumTitle') }}</span>
                  <div class="waveform-metrics">
                    <span
                      >LUFS: <b>{{ processedSpectrumAnalysis.lufsIntegrated }}</b></span
                    >
                    <span>
                      {{ t('gameNodes.audioDsp.crestFactorLabel') }}:
                      <b>{{ processedSpectrumAnalysis.crestFactorDb }} dB</b>
                    </span>
                  </div>
                </div>
                <div class="spectrum-bars-row">
                  <div
                    v-for="(band, idx) in processedSpectrumAnalysis.bands"
                    :key="band.label"
                    class="spectrum-col"
                  >
                    <div class="spectrum-bar-pair">
                      <div
                        class="spec-bar raw"
                        :style="{
                          height: `${Math.round((rawSpectrumAnalysis.bands[idx]?.level ?? 0.05) * 100)}%`
                        }"
                        :title="`Raw ${band.label}Hz: ${rawSpectrumAnalysis.bands[idx]?.db ?? -72} dB`"
                      />
                      <div
                        class="spec-bar processed"
                        :style="{ height: `${Math.round(band.level * 100)}%` }"
                        :title="`Processed ${band.label}Hz: ${band.db} dB`"
                      />
                    </div>
                    <span class="spec-freq-label">{{ band.label }}</span>
                  </div>
                </div>
              </div>

              <div class="waveform-compare-card">
                <div class="waveform-lane-head">
                  <span class="section-title">{{ t('gameNodes.audioDsp.spatialTitle') }}</span>
                  <span class="spec-badge">
                    {{ audioSpatialDistance }}m · Pan
                    {{ audioSpatialPan >= 0 ? `+${audioSpatialPan}` : audioSpatialPan }} · Occ
                    {{ Math.round(audioSpatialOcclusion * 100) }}%
                  </span>
                </div>
                <div class="spatial-sliders">
                  <label class="inline-slider">
                    <span>{{ t('gameNodes.audioDsp.spatialDistance') }}</span>
                    <input
                      v-model.number="audioSpatialDistance"
                      type="range"
                      min="1"
                      max="50"
                      step="1"
                    />
                    <b>{{ audioSpatialDistance }}m</b>
                  </label>
                  <label class="inline-slider">
                    <span>{{ t('gameNodes.audioDsp.spatialPan') }}</span>
                    <input
                      v-model.number="audioSpatialPan"
                      type="range"
                      min="-1"
                      max="1"
                      step="0.1"
                    />
                    <b>{{ audioSpatialPan.toFixed(1) }}</b>
                  </label>
                  <label class="inline-slider">
                    <span>{{ t('gameNodes.audioDsp.spatialOcclusion') }}</span>
                    <input
                      v-model.number="audioSpatialOcclusion"
                      type="range"
                      min="0"
                      max="0.95"
                      step="0.05"
                    />
                    <b>{{ Math.round(audioSpatialOcclusion * 100) }}%</b>
                  </label>
                </div>
              </div>
            </div>

            <!-- SFX Variant Matrix Cards with Live Single-Variant Audition & Download -->
            <div class="sfx-matrix-panel">
              <div class="section-title">{{ t('gameNodes.workbench.sfxMatrixTitle') }}</div>
              <div class="sfx-variant-cards">
                <div v-for="v in sfxVariantsPlan" :key="v.variantId" class="sfx-card">
                  <div class="sfx-card-head">
                    <b>Variant #{{ v.index + 1 }} ({{ v.variantId }})</b>
                    <div class="tab-pills">
                      <button
                        type="button"
                        class="mini-play-btn"
                        @click="playSingleVariant(v.index)"
                      >
                        {{ t('gameNodes.audioDsp.playVariantBtn') }}
                      </button>
                      <button
                        type="button"
                        class="mini-play-btn"
                        @click="downloadVariantWav(v.index, v.variantId)"
                      >
                        {{ t('gameNodes.audioDsp.downloadWavBtn') }}
                      </button>
                    </div>
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
              <span
                class="spec-badge"
                :class="{ 'badge-danger': !liveLevelConnectivity.reachable }"
              >
                {{
                  liveLevelConnectivity.reachable
                    ? t('gameNodes.levelMap.pathReachableBadge', {
                        steps: liveLevelConnectivity.pathLength
                      })
                    : t('gameNodes.levelMap.pathBlockedBadge')
                }}
              </span>
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
              <button type="button" class="secondary-btn" @click="downloadLevelTmj">
                {{ t('gameNodes.levelMap.downloadTmjBtn') }}
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
                  <button
                    type="button"
                    class="secondary-btn"
                    :disabled="levelUndoStack.length === 0"
                    @click="undoLevelBrush"
                  >
                    {{ t('gameNodes.levelMap.undoBtn') }}
                  </button>
                  <button
                    type="button"
                    class="secondary-btn"
                    :disabled="levelRedoStack.length === 0"
                    @click="redoLevelBrush"
                  >
                    {{ t('gameNodes.levelMap.redoBtn') }}
                  </button>
                  <button type="button" class="secondary-btn" @click="clearLevelCustomEdits">
                    {{ t('gameNodes.levelMap.clearBrushEdits') }}
                  </button>
                </div>
              </div>
              <div class="level-canvas-container">
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
                <svg
                  v-if="showCriticalPath || showWangBitmask"
                  class="level-overlay-svg"
                  :viewBox="`0 0 ${liveLevelData.width} ${liveLevelData.height}`"
                  preserveAspectRatio="none"
                >
                  <polyline
                    v-if="showCriticalPath && liveLevelConnectivity.criticalPath.length > 1"
                    :points="levelCriticalPathPoints"
                    class="astar-path-line"
                  />
                  <template v-if="showWangBitmask">
                    <template
                      v-for="(row, ry) in liveLevelData.wang16BitmaskGrid"
                      :key="`wrow-${ry}`"
                    >
                      <text
                        v-for="(mask, rx) in row"
                        :key="`wcell-${rx}-${ry}`"
                        :x="rx + 0.5"
                        :y="ry + 0.68"
                        class="wang-mask-text"
                      >
                        {{ mask > 0 ? mask : '' }}
                      </text>
                    </template>
                  </template>
                </svg>
              </div>
              <div class="level-stats-bar">
                <span>{{ liveLevelData.width }} × {{ liveLevelData.height }}</span>
                <span>Rooms: {{ liveLevelData.rooms.length }}</span>
                <span>Entities: {{ liveLevelData.entities.length }}</span>
                <span>
                  {{
                    t('gameNodes.levelMap.walkableStat', {
                      pct: Math.round(liveLevelConnectivity.walkableRatio * 100)
                    })
                  }}
                </span>
                <span>
                  {{
                    t('gameNodes.levelMap.deadEndsStat', {
                      count: liveLevelConnectivity.deadEndCount
                    })
                  }}
                </span>
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
            <div class="tab-pills">
              <span class="spec-badge">
                {{ t('gameNodes.playable.upstreamStatus') }}{{ playableUpstreamSummary }}
              </span>
              <button
                type="button"
                class="tab-pill"
                :class="{ active: playableTab === 'play' }"
                @click="playableTab = 'play'"
              >
                🎮 60fps Sandbox
              </button>
              <button
                type="button"
                class="tab-pill"
                :class="{ active: playableTab === 'engine' }"
                @click="playableTab = 'engine'"
              >
                {{ t('gameNodes.playable.engineShadersTab') }}
              </button>
              <button
                type="button"
                class="tab-pill"
                :class="{ active: playableTab === 'data' }"
                @click="playableTab = 'data'"
              >
                {{ t('gameNodes.playable.dataTablesTab') }}
              </button>
              <button
                type="button"
                class="tab-pill"
                :class="{ active: playableTab === 'html' }"
                @click="playableTab = 'html'"
              >
                {{ t('gameNodes.workbench.toggleHtmlSource') }}
              </button>
            </div>
          </div>

          <div class="playable-stage-body">
            <iframe
              v-show="playableTab === 'play'"
              ref="playableIframeRef"
              :key="playableReloadSeq"
              class="playable-sandbox-iframe"
              :srcdoc="livePlayableHtml"
              sandbox="allow-scripts"
              title="game-playable-workbench"
            />
            <div v-if="playableTab === 'engine'" class="audio-stage-body">
              <div class="engine-export-panel">
                <div class="engine-export-head">
                  <span class="section-title">{{ t('gameNodes.playable.shaderPresetLabel') }}</span>
                  <div class="tab-pills">
                    <select v-model="selectedShaderId" class="title-input">
                      <option
                        v-for="sh in playableShaderBundle.shaders"
                        :key="sh.id"
                        :value="sh.id"
                      >
                        {{ sh.name }} ({{ sh.id }})
                      </option>
                    </select>
                    <button
                      type="button"
                      class="tab-pill"
                      :class="{ active: playableShaderLang === 'godot' }"
                      @click="playableShaderLang = 'godot'"
                    >
                      Godot 4 (.gdshader)
                    </button>
                    <button
                      type="button"
                      class="tab-pill"
                      :class="{ active: playableShaderLang === 'unity' }"
                      @click="playableShaderLang = 'unity'"
                    >
                      Unity (.shader)
                    </button>
                    <button
                      type="button"
                      class="tab-pill"
                      :class="{ active: playableShaderLang === 'webgl' }"
                      @click="playableShaderLang = 'webgl'"
                    >
                      WebGL (GLSL)
                    </button>
                  </div>
                </div>
                <pre class="code-viewer compact">{{ activePlayableShaderCode }}</pre>
              </div>

              <div class="engine-export-panel">
                <div class="engine-export-head">
                  <span class="section-title">{{
                    t('gameNodes.playable.importerScriptTitle')
                  }}</span>
                  <div class="tab-pills">
                    <button
                      type="button"
                      class="tab-pill"
                      :class="{ active: playableImporterTarget === 'godot' }"
                      @click="playableImporterTarget = 'godot'"
                    >
                      Godot 4 (.gd)
                    </button>
                    <button
                      type="button"
                      class="tab-pill"
                      :class="{ active: playableImporterTarget === 'unity' }"
                      @click="playableImporterTarget = 'unity'"
                    >
                      Unity (C#)
                    </button>
                  </div>
                </div>
                <pre class="code-viewer compact">{{ activePlayableImporterCode }}</pre>
              </div>
            </div>
            <div v-else-if="playableTab === 'data'" class="audio-stage-body">
              <div class="engine-export-panel">
                <div class="engine-export-head">
                  <span class="section-title">{{ t('gameNodes.playable.dataTablesTitle') }}</span>
                  <div class="tab-pills">
                    <select v-model="selectedDataTableKey" class="title-input">
                      <option value="characters.csv">RPG Characters (characters.csv)</option>
                      <option value="skills.csv">Action Skills (skills.csv)</option>
                      <option value="cards.csv">Deckbuilder Cards (cards.csv)</option>
                      <option value="items.csv">Loot &amp; Items (items.csv)</option>
                      <option value="waves.csv">Survivor / TD Waves (waves.csv)</option>
                      <option value="localization.csv">
                        RFC-4180 L10n zh/en/ja (localization.csv)
                      </option>
                      <option value="dialogues.json">AVG Branching Dialogue Tree (.json)</option>
                    </select>
                    <button type="button" class="secondary-btn" @click="downloadActiveDataTableCsv">
                      {{ t('gameNodes.playable.downloadCsvBtn') }}
                    </button>
                    <button type="button" class="secondary-btn" @click="downloadLocalizationCsv">
                      {{ t('gameNodes.playable.downloadL10nBtn') }}
                    </button>
                  </div>
                </div>
                <pre class="code-viewer compact">{{ activeDataTableContent }}</pre>
              </div>

              <div class="engine-export-panel">
                <div class="engine-export-head">
                  <span class="section-title">{{ t('gameNodes.playable.systemsGraphTitle') }}</span>
                  <div class="tab-pills">
                    <button
                      type="button"
                      class="tab-pill"
                      :class="{ active: selectedSystemsSubTab === 'json' }"
                      @click="selectedSystemsSubTab = 'json'"
                    >
                      DAG Skill Tree &amp; AI FSM (.json)
                    </button>
                    <button
                      type="button"
                      class="tab-pill"
                      :class="{ active: selectedSystemsSubTab === 'mermaid' }"
                      @click="selectedSystemsSubTab = 'mermaid'"
                    >
                      Mermaid Flowchart (.mmd)
                    </button>
                    <button
                      type="button"
                      class="tab-pill"
                      :class="{ active: selectedSystemsSubTab === 'unity_meta' }"
                      @click="selectedSystemsSubTab = 'unity_meta'"
                    >
                      Unity GUID Lock (.meta)
                    </button>
                    <button
                      type="button"
                      class="secondary-btn"
                      @click="downloadFullDataAndSystemsJson"
                    >
                      {{ t('gameNodes.playable.downloadBundleJsonBtn') }}
                    </button>
                  </div>
                </div>
                <pre class="code-viewer compact">{{ activeSystemsContent }}</pre>
              </div>
            </div>
            <pre v-show="playableTab === 'html'" class="code-viewer">{{ livePlayableHtml }}</pre>
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
  analyzeLevelConnectivityAndPacing,
  analyzeOctaveSpectrumPcm,
  applyAudioShaperPcm,
  applyCustomEditsToLevelMap,
  applyEqualPowerLoopCrossfadePcm,
  applyGameAudioEnvironmentFxPcm,
  applySeamlessTileBlend,
  applySpatialAuditionPcm,
  buildAutoTileAtlasManifest,
  buildBitmapFontManifest,
  buildGameBundleManifest,
  buildGameDataTableBundle,
  buildGameShaderParticleBundle,
  buildGameplaySystemsBundle,
  buildNineSliceManifest,
  buildSpritePhysicsManifest,
  compilePlayableGameSandboxHtml,
  createProceduralMaterialTileRgba,
  decodeWavBytesToPcm,
  derivePbrMapsFromRgba,
  detectNineSliceBorders,
  encodePcmToWavDataUrl,
  encodeRgbaToPngDataUrl,
  exportGodotAudioStreamRandomizerTres,
  exportUnityAudioRandomContainerJson,
  generateEngineImporterScript,
  generateProceduralLevelMap,
  generateUnityMetaFile,
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
  type PbrMaterialPreset,
  type PhysicsPivotMode,
  type ProceduralLevelMapResult
} from '@shared/gameAssets'
import {
  createNodeFromType,
  isGameProductionNode,
  type GraphNode,
  type GraphNodeParams
} from '@shared/graph'
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

// --- 1. game.pbrTile stage state, 2.5D Point-Light PBR Shader & Physics/9-Slice Inspector ---
const pbrTab = ref<'lighting' | 'physics' | 'grid' | 'channels'>('lighting')
const showSeamGrid = ref(true)
const pbrLightZ = ref(0.85)
const pbrLightIntensity = ref(1.45)
const pbrLightEnv = ref<'torch_warm' | 'studio_neutral' | 'moon_cold' | 'cyber_neon'>('torch_warm')
const pbrAutoOrbit = ref(false)
const pbrLightPos = ref({ x: 144, y: 144 })
const pbrLightCanvasRef = ref<HTMLCanvasElement | null>(null)
const pbrChannelCards = ref<Array<{ key: string; title: string; url: string }>>([])
const pbrSourceTileRgba = ref<Uint8ClampedArray | null>(null)
const pbrManifestCopied = ref(false)
let pbrOrbitRafId = 0

const PBR_TILE_DIM = 96
const PBR_CANVAS_DIM = PBR_TILE_DIM * 3

function onPbrMaterialPresetChange(event: Event): void {
  const preset = (event.target as HTMLSelectElement).value as PbrMaterialPreset
  const defaults: Record<PbrMaterialPreset, Partial<GraphNodeParams>> = {
    stone_dungeon: {
      gamePbrMaterialPreset: 'stone_dungeon',
      gameTileSeamless: true,
      gamePbrNormalStrength: 3.0,
      gamePbrRoughnessContrast: 1.25,
      gamePbrAoStrength: 0.9,
      gamePbrMetallicScale: 0.15,
      gamePbrInvertRoughness: false
    },
    brushed_metal: {
      gamePbrMaterialPreset: 'brushed_metal',
      gameTileSeamless: true,
      gamePbrNormalStrength: 2.2,
      gamePbrRoughnessContrast: 1.65,
      gamePbrAoStrength: 0.7,
      gamePbrMetallicScale: 1.15,
      gamePbrInvertRoughness: true
    },
    wet_mud: {
      gamePbrMaterialPreset: 'wet_mud',
      gameTileSeamless: true,
      gamePbrNormalStrength: 3.6,
      gamePbrRoughnessContrast: 1.8,
      gamePbrAoStrength: 1.1,
      gamePbrMetallicScale: 0.35,
      gamePbrInvertRoughness: true
    },
    stylized_wood: {
      gamePbrMaterialPreset: 'stylized_wood',
      gameTileSeamless: true,
      gamePbrNormalStrength: 2.5,
      gamePbrRoughnessContrast: 1.15,
      gamePbrAoStrength: 0.8,
      gamePbrMetallicScale: 0.1,
      gamePbrInvertRoughness: false
    },
    gold_ornament: {
      gamePbrMaterialPreset: 'gold_ornament',
      gameTileSeamless: false,
      gamePbrNormalStrength: 3.4,
      gamePbrRoughnessContrast: 1.5,
      gamePbrAoStrength: 0.95,
      gamePbrMetallicScale: 1.35,
      gamePbrInvertRoughness: true
    }
  }
  patchParams(defaults[preset] ?? { gamePbrMaterialPreset: preset })
}

function stopPbrOrbit(): void {
  pbrAutoOrbit.value = false
  if (pbrOrbitRafId && typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(pbrOrbitRafId)
    pbrOrbitRafId = 0
  }
}

function togglePbrAutoOrbit(): void {
  if (pbrAutoOrbit.value) {
    stopPbrOrbit()
    return
  }
  pbrAutoOrbit.value = true
  const stepOrbit = (now: number): void => {
    if (!pbrAutoOrbit.value) return
    const angle = (now * 0.0018) % (Math.PI * 2)
    const radius = PBR_CANVAS_DIM * 0.32
    pbrLightPos.value = {
      x: PBR_CANVAS_DIM * 0.5 + Math.cos(angle) * radius,
      y: PBR_CANVAS_DIM * 0.5 + Math.sin(angle) * radius
    }
    renderPbrLightingCanvas()
    pbrOrbitRafId = requestAnimationFrame(stepOrbit)
  }
  if (typeof requestAnimationFrame === 'function') {
    pbrOrbitRafId = requestAnimationFrame(stepOrbit)
  }
}

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
  const preset = (node.value?.params.gamePbrMaterialPreset ?? 'stone_dungeon') as PbrMaterialPreset
  const base =
    pbrSourceTileRgba.value && pbrSourceTileRgba.value.length === PBR_TILE_DIM * PBR_TILE_DIM * 4
      ? pbrSourceTileRgba.value
      : createProceduralMaterialTileRgba(preset, PBR_TILE_DIM, PBR_TILE_DIM).data
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
  const normalFormat = node.value?.params.gamePbrNormalFormat === 'directx' ? 'directx' : 'opengl'
  const roughnessContrast = Math.max(
    0.2,
    Math.min(3, Number(node.value?.params.gamePbrRoughnessContrast ?? 1.2))
  )
  const aoStrength = Math.max(0, Math.min(2, Number(node.value?.params.gamePbrAoStrength ?? 0.85)))
  const metallicScale = Math.max(
    0,
    Math.min(2, Number(node.value?.params.gamePbrMetallicScale ?? 0.25))
  )
  const invertRoughness = Boolean(node.value?.params.gamePbrInvertRoughness)
  const maps = derivePbrMapsFromRgba(albedo, PBR_TILE_DIM, PBR_TILE_DIM, {
    normalStrength,
    normalFormat,
    wrapTiling: seamlessEnabled,
    roughnessContrast,
    aoStrength,
    metallicScale,
    invertRoughness
  })
  return { albedo, maps }
})

function downloadDataUrlFile(dataUrl: string, filename: string): void {
  if (!dataUrl || typeof document === 'undefined') return
  const link = document.createElement('a')
  link.href = dataUrl
  link.download = filename.replace(/[^\w.-]+/g, '_')
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}

function downloadTextFile(
  content: string,
  filename: string,
  mimeType = 'text/plain;charset=utf-8'
): void {
  if (typeof document === 'undefined' || typeof Blob === 'undefined') return
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  try {
    downloadDataUrlFile(url, filename)
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 500)
  }
}

const pbrLiveAlbedoDataUrl = computed(() =>
  encodeRgbaToPngDataUrl(pbrLiveTileData.value.albedo, PBR_TILE_DIM, PBR_TILE_DIM)
)

const pbrAutoNineSlice = computed(() =>
  detectNineSliceBorders(pbrLiveTileData.value.albedo, PBR_TILE_DIM, PBR_TILE_DIM)
)

const pbrLiveNineSlice = computed(() => {
  const auto = pbrAutoNineSlice.value
  const clampBorder = (val: unknown, fallback: number): number => {
    const num = Number(val)
    if (!Number.isFinite(num)) return fallback
    return Math.max(0, Math.min(Math.floor(PBR_TILE_DIM * 0.46), Math.round(num)))
  }
  const left =
    node.value?.params.gameNineSliceLeft !== undefined
      ? clampBorder(node.value.params.gameNineSliceLeft, auto.borders.left)
      : auto.borders.left
  const right =
    node.value?.params.gameNineSliceRight !== undefined
      ? clampBorder(node.value.params.gameNineSliceRight, auto.borders.right)
      : auto.borders.right
  const top =
    node.value?.params.gameNineSliceTop !== undefined
      ? clampBorder(node.value.params.gameNineSliceTop, auto.borders.top)
      : auto.borders.top
  const bottom =
    node.value?.params.gameNineSliceBottom !== undefined
      ? clampBorder(node.value.params.gameNineSliceBottom, auto.borders.bottom)
      : auto.borders.bottom
  return {
    ...auto,
    borders: { left, right, top, bottom },
    stretchCenterWidth: Math.max(1, PBR_TILE_DIM - left - right),
    stretchCenterHeight: Math.max(1, PBR_TILE_DIM - top - bottom)
  }
})

function resetNineSliceBorders(): void {
  patchParams({
    gameNineSliceLeft: undefined,
    gameNineSliceRight: undefined,
    gameNineSliceTop: undefined,
    gameNineSliceBottom: undefined
  })
}

const pbrLivePhysics = computed(() => {
  const maxVertices = Math.max(
    4,
    Math.min(16, Math.round(Number(node.value?.params.gamePbrMaxHullVertices ?? 8)))
  )
  const pivotMode = (node.value?.params.gamePbrPivotMode ?? 'bottom_center') as PhysicsPivotMode
  return buildSpritePhysicsManifest(
    node.value?.title || 'sprite',
    pbrLiveTileData.value.albedo,
    PBR_TILE_DIM,
    PBR_TILE_DIM,
    { maxVertices, pivotMode }
  )
})

const displayPbrChannelCards = computed(() => {
  if (pbrChannelCards.value.length >= 2) return pbrChannelCards.value
  const { albedo, maps } = pbrLiveTileData.value
  return [
    {
      key: 'live-albedo',
      title: 'Seamless_Albedo',
      url: encodeRgbaToPngDataUrl(albedo, PBR_TILE_DIM, PBR_TILE_DIM)
    },
    {
      key: 'live-normal',
      title: 'PBR_Normal',
      url: encodeRgbaToPngDataUrl(maps.normal, PBR_TILE_DIM, PBR_TILE_DIM)
    },
    {
      key: 'live-roughness',
      title: 'PBR_Roughness',
      url: encodeRgbaToPngDataUrl(maps.roughness, PBR_TILE_DIM, PBR_TILE_DIM)
    },
    {
      key: 'live-orm',
      title: 'PBR_ORM_Packed',
      url: encodeRgbaToPngDataUrl(maps.orm, PBR_TILE_DIM, PBR_TILE_DIM)
    },
    {
      key: 'live-height',
      title: 'PBR_Height',
      url: encodeRgbaToPngDataUrl(maps.heightMap, PBR_TILE_DIM, PBR_TILE_DIM)
    }
  ]
})

const pbrHullPolygonPoints = computed(() =>
  pbrLivePhysics.value.hull.verticesPx.map((pt) => `${pt.x},${pt.y}`).join(' ')
)

function copyPbrPhysicsManifest(): void {
  if (typeof navigator !== 'undefined' && navigator.clipboard) {
    const nineManifest = buildNineSliceManifest(
      node.value?.title || 'sprite',
      pbrLiveNineSlice.value
    )
    const combined = JSON.stringify(
      {
        nineSlice: nineManifest,
        physics: pbrLivePhysics.value
      },
      null,
      2
    )
    void navigator.clipboard.writeText(combined)
    pbrManifestCopied.value = true
    setTimeout(() => {
      pbrManifestCopied.value = false
    }, 1800)
  }
}

function downloadAutoTileManifest(): void {
  const stem = (node.value?.title?.trim() || 'terrain').replace(/\s+/g, '_')
  const manifest = buildAutoTileAtlasManifest({
    terrainName: stem,
    layout: 'wang16',
    tileWidth: PBR_TILE_DIM,
    tileHeight: PBR_TILE_DIM
  })
  downloadTextFile(
    JSON.stringify(manifest, null, 2),
    `${stem}_autotile.json`,
    'application/json;charset=utf-8'
  )
}

function downloadBmFontFnt(): void {
  const stem = (node.value?.title?.trim() || 'DamageFont').replace(/\s+/g, '_')
  const bm = buildBitmapFontManifest({
    fontName: stem,
    textureFileName: `${stem}.png`,
    atlasWidth: PBR_TILE_DIM * 4,
    atlasHeight: PBR_TILE_DIM * 4
  })
  downloadTextFile(bm.fntText, `${stem}.fnt`, 'text/plain;charset=utf-8')
}

function onPbrLightPointerMove(event: PointerEvent): void {
  if (pbrAutoOrbit.value) stopPbrOrbit()
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
  const { normal, roughness, ao, metallic } = maps
  const imgData = ctx.createImageData(PBR_CANVAS_DIM, PBR_CANVAS_DIM)
  const out = imgData.data
  const lx = pbrLightPos.value.x
  const ly = pbrLightPos.value.y
  const lz = pbrLightZ.value * 160
  const intensity = pbrLightIntensity.value

  const envColors: Record<
    typeof pbrLightEnv.value,
    { r: number; g: number; b: number; ambR: number; ambG: number; ambB: number }
  > = {
    torch_warm: { r: 1.08, g: 0.92, b: 0.76, ambR: 0.22, ambG: 0.19, ambB: 0.24 },
    studio_neutral: { r: 1.0, g: 1.0, b: 1.0, ambR: 0.24, ambG: 0.24, ambB: 0.25 },
    moon_cold: { r: 0.78, g: 0.92, b: 1.15, ambR: 0.16, ambG: 0.22, ambB: 0.32 },
    cyber_neon: { r: 1.15, g: 0.72, b: 1.18, ambR: 0.18, ambG: 0.28, ambB: 0.34 }
  }
  const env = envColors[pbrLightEnv.value]

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
      const metal = (metallic[tIdx] ?? 32) / 255
      const shininess = Math.max(4, (1 - rough) * 68)
      const spec = Math.pow(ndoth, shininess) * (1 - rough * 0.6) * (0.52 + metal * 0.65)
      const aoVal = 0.35 + 0.65 * ((ao[tIdx] ?? 220) / 255)

      const diffR = (env.ambR + ndotl * atten * env.r) * aoVal
      const diffG = (env.ambG + ndotl * atten * env.g) * aoVal
      const diffB = (env.ambB + ndotl * atten * env.b) * aoVal

      out[cIdx] = Math.min(255, Math.max(0, Math.round(ar * diffR + 255 * spec * atten * env.r)))
      out[cIdx + 1] = Math.min(
        255,
        Math.max(0, Math.round(ag * diffG + 245 * spec * atten * env.g))
      )
      out[cIdx + 2] = Math.min(
        255,
        Math.max(0, Math.round(ab * diffB + 235 * spec * atten * env.b))
      )
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
    pbrLightIntensity.value,
    pbrLightEnv.value
  ],
  async () => {
    if (node.value?.typeId === 'game.pbrTile' && pbrTab.value === 'lighting') {
      await nextTick()
      renderPbrLightingCanvas()
    }
  },
  { immediate: true }
)

// --- 2. game.audioDsp stage state, Spectrum/LUFS Analyzer & 3D Spatial Audition ---
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

const audioSpatialDistance = ref(1)
const audioSpatialPan = ref(0)
const audioSpatialOcclusion = ref(0)

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
  const durationScale = Math.max(
    0.3,
    Math.min(2.5, Number(node.value?.params.gameAudioSynthDuration ?? 1.0))
  )
  const basePitchSemitones = Math.max(
    -12,
    Math.min(12, Number(node.value?.params.gameAudioBasePitch ?? 0))
  )
  return synthesizeGameSeedPcm(preset, 22050, {
    durationScale,
    basePitchSemitones
  })
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

const rawSpectrumAnalysis = computed(() =>
  analyzeOctaveSpectrumPcm(
    liveRawAudioBuffer.value.channels[0] ?? new Float32Array(0),
    liveRawAudioBuffer.value.sampleRate
  )
)

const processedSpectrumAnalysis = computed(() =>
  analyzeOctaveSpectrumPcm(liveProcessedPrimaryChannel.value, liveRawAudioBuffer.value.sampleRate)
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
  stopPbrOrbit()
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
  const spatialized = applySpatialAuditionPcm(samples, sampleRate, {
    distanceMeters: audioSpatialDistance.value,
    occlusion: audioSpatialOcclusion.value
  })
  const buf = ctx.createBuffer(1, spatialized.length, sampleRate)
  buf.copyToChannel(new Float32Array(spatialized), 0)
  const src = ctx.createBufferSource()
  src.buffer = buf
  src.loop = Boolean(options?.loop)
  if (typeof ctx.createStereoPanner === 'function' && Math.abs(audioSpatialPan.value) > 0.01) {
    const panner = ctx.createStereoPanner()
    panner.pan.value = Math.max(-1, Math.min(1, audioSpatialPan.value))
    src.connect(panner)
    panner.connect(ctx.destination)
  } else {
    src.connect(ctx.destination)
  }
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

function downloadMasterWav(): void {
  const samples = liveProcessedPrimaryChannel.value
  const sr = liveRawAudioBuffer.value.sampleRate
  if (!samples.length) return
  const dataUrl = encodePcmToWavDataUrl([samples], sr)
  const stem = (node.value?.title?.trim() || 'game_audio_master').replace(/\s+/g, '_')
  downloadDataUrlFile(dataUrl, `${stem}.wav`)
}

function downloadVariantWav(variantIndex: number, variantId: string): void {
  const { samples, sampleRate } = buildVariantSamples(variantIndex)
  if (!samples.length) return
  const dataUrl = encodePcmToWavDataUrl([samples], sampleRate)
  const stem = (node.value?.title?.trim() || 'sfx').replace(/\s+/g, '_')
  downloadDataUrlFile(dataUrl, `${stem}_${variantId}.wav`)
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

// --- 3. game.levelMap stage state, Interactive Paint Brush & A* Pathfinding Verifier ---
const levelTab = ref<'map' | 'tmj'>('map')
type LevelBrushToolId = LevelCellType | LevelEntitySpawn['type']
const activeLevelBrush = ref<LevelBrushToolId>('floor')
const levelPainting = ref(false)
const showCriticalPath = ref(true)
const showWangBitmask = ref(false)
const levelUndoStack = ref<string[]>([])
const levelRedoStack = ref<string[]>([])

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

const liveLevelConnectivity = computed(() => analyzeLevelConnectivityAndPacing(liveLevelData.value))

const levelCriticalPathPoints = computed(() =>
  liveLevelConnectivity.value.criticalPath.map((pt) => `${pt.x + 0.5},${pt.y + 0.5}`).join(' ')
)

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
  const prevState = node.value?.params.gameLevelCustomEdits ?? ''
  levelUndoStack.value.push(prevState)
  if (levelUndoStack.value.length > 32) levelUndoStack.value.shift()
  levelRedoStack.value = []
  levelPainting.value = true
  paintLevelAtPointer(event, true)
}

function onLevelMapPointerMove(event: PointerEvent): void {
  if (!levelPainting.value) return
  paintLevelAtPointer(event, false)
}

function undoLevelBrush(): void {
  if (levelUndoStack.value.length === 0) return
  const current = node.value?.params.gameLevelCustomEdits ?? ''
  levelRedoStack.value.push(current)
  const prev = levelUndoStack.value.pop() ?? ''
  patchParams({
    gameLevelCustomEdits: prev || undefined,
    previewDataUrl: undefined,
    text: undefined
  })
}

function redoLevelBrush(): void {
  if (levelRedoStack.value.length === 0) return
  const current = node.value?.params.gameLevelCustomEdits ?? ''
  levelUndoStack.value.push(current)
  const next = levelRedoStack.value.pop() ?? ''
  patchParams({
    gameLevelCustomEdits: next || undefined,
    previewDataUrl: undefined,
    text: undefined
  })
}

function clearLevelCustomEdits(): void {
  const prevState = node.value?.params.gameLevelCustomEdits ?? ''
  if (prevState) {
    levelUndoStack.value.push(prevState)
    levelRedoStack.value = []
  }
  patchParams({
    gameLevelCustomEdits: undefined,
    previewDataUrl: undefined,
    text: undefined
  })
}

function downloadLevelTmj(): void {
  const stem = (node.value?.title?.trim() || 'dungeon_level').replace(/\s+/g, '_')
  downloadTextFile(liveLevelTmjJson.value, `${stem}.tmj`, 'application/json;charset=utf-8')
}

// --- 4. game.playable stage state, Upstream Asset Hot-Binding & Zero-Reload Live Tuning ---
const playableTab = ref<'play' | 'engine' | 'data' | 'html'>('play')
const playableReloadSeq = ref(0)
const playableIframeRef = ref<HTMLIFrameElement | null>(null)
const autoWireDone = ref(false)

const playableDataTableBundle = computed(() =>
  buildGameDataTableBundle({
    tableName: node.value?.params.gamePlayableTitle || 'IndieGameDatabase',
    genre: node.value?.params.gamePlayableGenre || 'roguelike_action',
    characters: [
      {
        id: 'hero_knight',
        name: 'Vanguard Knight',
        nameEn: 'Vanguard Knight',
        nameJa: 'Vanguard Knight',
        role: 'Tank / Melee',
        hp: 150,
        mp: 60,
        atk: 24,
        def: 16,
        spd: 110,
        critRate: 0.2,
        spriteAsset: 'assets/sprites/hero_knight.png',
        voiceAsset: 'assets/audio/sfx/attack_v1.wav',
        description: 'Frontline cyber paladin with shield bash and blade wave.'
      },
      {
        id: 'boss_lich',
        name: 'Abyssal Archlich',
        nameEn: 'Abyssal Archlich',
        nameJa: 'Abyssal Archlich',
        role: 'Dungeon Boss',
        hp: 850,
        mp: 300,
        atk: 42,
        def: 22,
        spd: 90,
        critRate: 0.25,
        spriteAsset: 'assets/sprites/boss_lich.png',
        description: 'Summons bone pillars and fires homing necrotic volleys.'
      }
    ],
    skills: [
      {
        id: 'sk_plasma_slash',
        name: 'Plasma Crescent',
        element: 'lightning',
        manaCost: 15,
        cooldownSec: 2.4,
        damageMultiplier: 1.85,
        vfxAsset: 'assets/vfx/plasma_slash.png',
        sfxAsset: 'assets/audio/sfx/sword_slash.wav',
        description: 'Unleashes a piercing arc dealing 185% lightning damage.'
      },
      {
        id: 'sk_frost_turret',
        name: 'Cryo Sentry Tower',
        element: 'ice',
        manaCost: 40,
        cooldownSec: 8.0,
        damageMultiplier: 1.25,
        vfxAsset: 'assets/vfx/frost_nova.png',
        sfxAsset: 'assets/audio/sfx/laser_shoot.wav',
        description: 'Deploys an automated turret that slows marching enemies.'
      }
    ],
    cards: [
      {
        id: 'card_overcharge',
        name: 'Overcharge Strike',
        cost: 1,
        cardType: 'attack',
        rarity: 'rare',
        damage: 14,
        block: 0,
        illustAsset: 'assets/ui/card_overcharge.png',
        frameAsset: 'assets/ui/frame_rare_9slice.png',
        description: 'Deal 14 damage. Draw 1 card if this triggers a Critical Hit.'
      },
      {
        id: 'card_aegis_wall',
        name: 'Aegis Bulwark',
        cost: 2,
        cardType: 'skill',
        rarity: 'legendary',
        damage: 0,
        block: 18,
        illustAsset: 'assets/ui/card_aegis.png',
        frameAsset: 'assets/ui/frame_legendary_9slice.png',
        description: 'Gain 18 Block and reflect 30% melee damage for 1 turn.'
      }
    ],
    items: [
      {
        id: 'item_vampiric_core',
        name: 'Vampiric Relic',
        category: 'relic',
        rarity: 'legendary',
        price: 240,
        stackLimit: 1,
        iconAsset: 'assets/ui/icon_vampiric.png',
        effect: 'Restore +3 HP whenever an enemy is defeated.'
      }
    ],
    waves: [
      { waveIndex: 1, durationSec: 30, spawnIntervalSec: 1.8, enemyId: 'slime_scout', count: 16 },
      {
        waveIndex: 2,
        durationSec: 45,
        spawnIntervalSec: 1.2,
        enemyId: 'skeleton_raider',
        count: 28,
        eliteOrBossId: 'boss_lich'
      }
    ],
    dialogues: [
      {
        id: 'dlg_intro_01',
        speaker: 'Commander Aria',
        portraitAsset: 'assets/sprites/aria_portrait.png',
        expression: 'determined',
        text: 'The dungeon portal is unstable. Reinforce the turret line or charge straight in!',
        choices: [
          {
            label: 'Charge into the Abyss (Survivor)',
            targetId: 'dlg_route_assault',
            setFlag: 'route_survivor'
          },
          {
            label: 'Fortify the Choke Point (Tower Defense)',
            targetId: 'dlg_route_td',
            setFlag: 'route_td'
          }
        ]
      }
    ]
  })
)

const playableSystemsBundle = computed(() =>
  buildGameplaySystemsBundle({
    systemName: node.value?.params.gamePlayableTitle || 'CoreGameplaySystems',
    skillTree: [
      {
        id: 'node_core_slash',
        name: 'Blade Mastery I',
        tier: 1,
        costPoints: 1,
        prerequisiteIds: [],
        statModifiers: { atk_pct: 0.12 },
        description: 'Base attack damage +12%'
      },
      {
        id: 'node_multishot',
        name: 'Split Barrage II',
        tier: 2,
        costPoints: 2,
        prerequisiteIds: ['node_core_slash'],
        statModifiers: { multishot: 1, crit_rate: 0.08 },
        description: 'Fires +1 extra projectile and increases Crit Rate by 8%'
      },
      {
        id: 'node_vampiric_ult',
        name: 'Crimson Overdrive III',
        tier: 3,
        costPoints: 3,
        prerequisiteIds: ['node_multishot'],
        statModifiers: { lifesteal_hp: 3, move_spd_pct: 0.18 },
        description: 'Restores 3 HP on kill and grants +18% movement speed'
      }
    ],
    aiBehaviors: [
      {
        id: 'ai_boss_lich',
        enemyName: 'Abyssal Archlich',
        initialState: 'idle',
        states: [],
        transitions: []
      }
    ]
  })
)

const selectedDataTableKey = ref<
  | 'characters.csv'
  | 'skills.csv'
  | 'cards.csv'
  | 'items.csv'
  | 'waves.csv'
  | 'localization.csv'
  | 'dialogues.json'
>('characters.csv')

const activeDataTableContent = computed(() => {
  const b = playableDataTableBundle.value
  if (selectedDataTableKey.value === 'localization.csv') return b.localizationCsv
  if (selectedDataTableKey.value === 'dialogues.json') {
    return JSON.stringify(b.dialogues, null, 2)
  }
  return b.tableCsvs[selectedDataTableKey.value] || ''
})

const selectedSystemsSubTab = ref<'json' | 'mermaid' | 'unity_meta'>('json')
const activeSystemsContent = computed(() => {
  if (selectedSystemsSubTab.value === 'mermaid') {
    return playableSystemsBundle.value.mermaidDiagram
  }
  if (selectedSystemsSubTab.value === 'unity_meta') {
    const manifest = buildGameBundleManifest({
      bundleName: node.value?.params.gamePlayableTitle || 'IndieGameBundle',
      targetEngine: 'unity',
      items: [{ id: 'hero', name: 'hero_knight', sourcePath: 'hero_knight.png', type: 'sprite' }]
    })
    return generateUnityMetaFile(manifest.assets[0]!, {
      spriteBorders: { left: 12, bottom: 12, right: 12, top: 12 }
    }).metaText
  }
  return playableSystemsBundle.value.jsonText
})

function downloadActiveDataTableCsv(): void {
  const key = selectedDataTableKey.value
  const mime = key.endsWith('.json') ? 'application/json;charset=utf-8' : 'text/csv;charset=utf-8'
  downloadTextFile(activeDataTableContent.value, key, mime)
}

function downloadLocalizationCsv(): void {
  downloadTextFile(
    playableDataTableBundle.value.localizationCsv,
    'localization.csv',
    'text/csv;charset=utf-8'
  )
}

function downloadFullDataAndSystemsJson(): void {
  const combined = JSON.stringify(
    {
      dataTables: JSON.parse(playableDataTableBundle.value.jsonText),
      gameplaySystems: JSON.parse(playableSystemsBundle.value.jsonText)
    },
    null,
    2
  )
  const stem = (node.value?.params.gamePlayableTitle || 'game_bundle_data').replace(/\s+/g, '_')
  downloadTextFile(combined, `${stem}_data_and_systems.json`, 'application/json;charset=utf-8')
}

const playableShaderBundle = computed(() => {
  const bundle = buildGameShaderParticleBundle()
  return {
    ...bundle,
    shaders: bundle.shaders.map((sh) => ({
      ...sh,
      id: sh.presetId,
      name: sh.title
    }))
  }
})
const selectedShaderId = ref('hit_flash')
const playableShaderLang = ref<'godot' | 'unity' | 'webgl'>('godot')

const activePlayableShaderCode = computed(() => {
  const list = playableShaderBundle.value.shaders
  const found = list.find((s) => s.id === selectedShaderId.value) ?? list[0]
  if (!found) return ''
  if (playableShaderLang.value === 'unity') return found.unityShaderLab
  if (playableShaderLang.value === 'webgl') return found.webglGlslFrag
  return found.godotGdShader
})

const playableImporterTarget = ref<'godot' | 'unity'>('godot')
const activePlayableImporterCode = computed(() => {
  const manifest = buildGameBundleManifest({
    bundleName: node.value?.params.gamePlayableTitle || 'IndieGameBundle',
    targetEngine: playableImporterTarget.value,
    items: [
      { id: 'tile', name: 'seamless_albedo', sourcePath: 'seamless_albedo.png', type: 'tileset' },
      { id: 'norm', name: 'seamless_normal', sourcePath: 'seamless_normal.png', type: 'pbr' },
      { id: 'ui', name: 'panel_9slice', sourcePath: 'panel_9slice.json', type: 'data' },
      { id: 'sfx1', name: 'attack_v1', sourcePath: 'attack_v1.wav', type: 'sfx' },
      { id: 'sfx2', name: 'attack_v2', sourcePath: 'attack_v2.wav', type: 'sfx' }
    ]
  })
  return generateEngineImporterScript(manifest).content
})

function autoWireFourNodePipeline(): void {
  const current = node.value
  const hId = hostId.value
  if (!current || !hId) return
  const doc = graphEditorHosts.getDocument(hId)
  if (!doc) return

  const nextNodes = [...doc.nodes]
  const nextEdges = [...doc.edges]
  const incoming = nextEdges.filter((e) => e.target === current.id)

  const ensureUpstreamNode = (
    typeId: 'game.pbrTile' | 'game.audioDsp' | 'game.levelMap',
    sourcePortId: string,
    targetPortId: string,
    offsetY: number
  ): void => {
    const alreadyConnected = incoming.some((e) => {
      const src = nextNodes.find((n) => n.id === e.source)
      return src?.typeId === typeId
    })
    if (alreadyConnected) return

    let srcNode = nextNodes.find((n) => n.typeId === typeId && n.id !== current.id)
    if (!srcNode) {
      const id = `${typeId.replace('.', '_')}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
      srcNode = createNodeFromType(
        typeId,
        {
          x: Math.round(current.position.x - 360),
          y: Math.round(current.position.y + offsetY)
        },
        { id }
      )
      nextNodes.push(srcNode)
    }

    const edgeExists = nextEdges.some(
      (e) => e.source === srcNode!.id && e.target === current.id && e.targetPort === targetPortId
    )
    if (!edgeExists) {
      nextEdges.push({
        id: `e_${srcNode.id}_${current.id}_${Date.now().toString(36)}`,
        source: srcNode.id,
        sourcePort: sourcePortId,
        target: current.id,
        targetPort: targetPortId
      })
    }
  }

  ensureUpstreamNode('game.pbrTile', 'out', 'in-image', -220)
  ensureUpstreamNode('game.levelMap', 'out-text', 'in-text', 0)
  ensureUpstreamNode('game.audioDsp', 'out', 'in-voice', 220)

  graphEditorHosts.applyExternalGraph(
    hId,
    {
      ...doc,
      nodes: nextNodes,
      edges: nextEdges
    },
    { fitView: false }
  )
  graphEditorHosts.bumpRevision()
  autoWireDone.value = true
  setTimeout(() => {
    autoWireDone.value = false
  }, 2600)
}

function downloadPlayableHtml(): void {
  const title = (node.value?.params.gamePlayableTitle || 'Indie_Game_Prototype').replace(
    /\s+/g,
    '_'
  )
  downloadTextFile(livePlayableHtml.value, `${title}.html`, 'text/html;charset=utf-8')
}

function broadcastPlayableTuning(overrides?: Record<string, unknown>): void {
  const current = node.value
  const win = playableIframeRef.value?.contentWindow
  if (!current || !win) return
  win.postMessage(
    {
      type: 'aiart:playable-tune',
      payload: {
        moveSpeedScale: Number(current.params.gamePlayableMoveSpeed ?? 1.0),
        jumpDashScale: Number(current.params.gamePlayableJumpDash ?? 1.0),
        enemyAggroScale: Number(current.params.gamePlayableEnemyAggro ?? 1.0),
        screenShakeScale: Number(current.params.gamePlayableScreenShake ?? 1.0),
        timeScale: Number(current.params.gamePlayableTimeScale ?? 1.0),
        showDebugHitboxes: Boolean(current.params.gamePlayableShowHitboxes),
        ...(overrides ?? {})
      }
    },
    '*'
  )
}

function onPlayableTuneNumber(key: keyof GraphNodeParams, event: Event): void {
  const raw = Number((event.target as HTMLInputElement).value)
  if (!Number.isFinite(raw)) return
  patchParams({ [key]: raw } as Partial<GraphNodeParams>)
  const propMap: Partial<Record<keyof GraphNodeParams, string>> = {
    gamePlayableMoveSpeed: 'moveSpeedScale',
    gamePlayableJumpDash: 'jumpDashScale',
    gamePlayableEnemyAggro: 'enemyAggroScale',
    gamePlayableScreenShake: 'screenShakeScale',
    gamePlayableTimeScale: 'timeScale'
  }
  const mappedKey = propMap[key]
  broadcastPlayableTuning(mappedKey ? { [mappedKey]: raw } : undefined)
}

function onPlayableTuneBool(key: keyof GraphNodeParams, event: Event): void {
  const checked = (event.target as HTMLInputElement).checked
  patchParams({ [key]: checked } as Partial<GraphNodeParams>)
  broadcastPlayableTuning({ showDebugHitboxes: checked })
}

const playableUpstreamAssets = ref<{
  playerSpriteDataUrl?: string
  enemySpriteDataUrl?: string
  tileSpriteDataUrl?: string
  sfxDataUrl?: string
  bgmDataUrl?: string
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
    let tileUrl: string | undefined
    let sfxUrl: string | undefined
    let bgmUrl: string | undefined
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

      if (srcNode.typeId === 'game.audioDsp' || (srcNode.params.generatedVoices?.length ?? 0) > 0) {
        const voices = srcNode.params.generatedVoices ?? []
        audioCount += voices.length > 0 ? voices.length : 1
        for (const rawVoice of voices) {
          const voice = rawVoice as { dataUrl?: string; relativePath?: string }
          let url = voice.dataUrl?.trim() || ''
          if (!url && voice.relativePath?.trim()) {
            try {
              url = (await resolveAssetPreviewUrl(voice.relativePath.trim())) || ''
            } catch {
              url = ''
            }
          }
          if (url) {
            if ((srcNode.params.gameAudioDspMode ?? 'loop_bgm') === 'loop_bgm' && !bgmUrl) {
              bgmUrl = url
            } else if (!sfxUrl) {
              sfxUrl = url
            }
            break
          }
        }
      }

      if (srcNode.typeId === 'game.pbrTile') {
        const preset = (srcNode.params.gamePbrMaterialPreset ??
          'stone_dungeon') as PbrMaterialPreset
        const procTile = createProceduralMaterialTileRgba(preset, 64, 64)
        tileUrl =
          srcNode.params.previewDataUrl?.trim() ||
          encodeRgbaToPngDataUrl(procTile.data, procTile.width, procTile.height)
      } else if (srcNode.typeId !== 'game.levelMap') {
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
      tileSpriteDataUrl: tileUrl ?? spriteUrls[2],
      sfxDataUrl: sfxUrl,
      bgmDataUrl: bgmUrl,
      levelMap: upstreamLevel,
      audioCount,
      spriteCount: spriteUrls.length + (tileUrl ? 1 : 0),
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
  const hasUpstream = info.spriteCount > 0 || info.hasUpstreamLevel || info.audioCount > 0
  const stored = current.params.gamePlayableHtml?.trim()
  if (!ignoreStored && !hasUpstream && stored && stored.includes('<html')) return stored
  const alg = (current.params.gameLevelAlgorithm ?? 'bsp_dungeon') as LevelGeneratorAlgorithm
  const seed = Number(current.params.gameLevelSeed ?? 42)
  const genreRaw = current.params.gamePlayableGenre ?? 'roguelike_action'
  const cameraRaw = current.params.gamePlayableCameraMode ?? 'topdown_34'
  const mode =
    genreRaw === 'tower_defense'
      ? 'tower_defense'
      : genreRaw === 'platformer' || cameraRaw === 'side_view'
        ? 'platformer'
        : 'survivor'
  const levelMap =
    info.levelMap ??
    generateProceduralLevelMap({
      algorithm:
        mode === 'platformer'
          ? 'platformer_course'
          : mode === 'tower_defense'
            ? 'tower_defense'
            : alg,
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
    tileSpriteDataUrl: info.tileSpriteDataUrl,
    sfxDataUrl: info.sfxDataUrl,
    bgmDataUrl: info.bgmDataUrl,
    moveSpeedScale: Number(current.params.gamePlayableMoveSpeed ?? 1.0),
    jumpDashScale: Number(current.params.gamePlayableJumpDash ?? 1.0),
    enemyAggroScale: Number(current.params.gamePlayableEnemyAggro ?? 1.0),
    screenShakeScale: Number(current.params.gamePlayableScreenShake ?? 1.0),
    timeScale: Number(current.params.gamePlayableTimeScale ?? 1.0),
    showDebugHitboxes: Boolean(current.params.gamePlayableShowHitboxes)
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

.physics-hull-stage {
  position: relative;
  width: 440px;
  height: 440px;
  max-width: 100%;
  border-radius: 10px;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--border) 84%, transparent);
  background: color-mix(in srgb, var(--bg) 92%, transparent);
}

.physics-base-img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
  image-rendering: pixelated;
}

.physics-overlay-svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.slice-guide-line {
  stroke: color-mix(in srgb, var(--text) 72%, transparent);
  stroke-width: 0.7;
  stroke-dasharray: 2.2 2.2;
}

.box-hurtbox {
  fill: color-mix(in srgb, var(--accent) 16%, transparent);
  stroke: var(--accent);
  stroke-width: 0.9;
}

.box-hitbox {
  fill: color-mix(in srgb, var(--danger, var(--accent)) 18%, transparent);
  stroke: var(--danger, var(--accent));
  stroke-width: 0.9;
  stroke-dasharray: 2 1.5;
}

.hull-polygon {
  fill: color-mix(in srgb, var(--accent) 22%, transparent);
  stroke: var(--accent);
  stroke-width: 1.2;
}

.hull-vertex {
  fill: var(--bg);
  stroke: var(--accent);
  stroke-width: 0.9;
}

.pivot-dot {
  fill: var(--danger, var(--accent));
  stroke: var(--bg);
  stroke-width: 0.8;
}

.physics-meta-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 8px 14px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--panel) 90%, transparent);
  border: 1px solid color-mix(in srgb, var(--border) 80%, transparent);
  font-size: 12px;
}

.audio-pro-grid {
  display: grid;
  grid-template-columns: 1.25fr 1fr;
  gap: 12px;
}

.spectrum-bars-row {
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  gap: 8px;
  height: 112px;
  align-items: flex-end;
  padding: 10px 8px 4px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--bg) 88%, transparent);
  border: 1px solid color-mix(in srgb, var(--border) 75%, transparent);
}

.spectrum-col {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-end;
  height: 100%;
  gap: 5px;
}

.spectrum-bar-pair {
  display: flex;
  align-items: flex-end;
  justify-content: center;
  gap: 3px;
  width: 100%;
  flex: 1;
}

.spec-bar {
  width: 9px;
  border-radius: 3px 3px 0 0;
  transition: height 0.16s ease;
}

.spec-bar.raw {
  background: color-mix(in srgb, var(--text-muted) 65%, transparent);
}

.spec-bar.processed {
  background: var(--accent);
}

.spec-freq-label {
  font-size: 10px;
  color: var(--text-muted);
}

.spatial-sliders {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.level-canvas-container {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.level-overlay-svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.astar-path-line {
  stroke: var(--accent);
  stroke-width: 0.32;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-dasharray: 0.55 0.35;
}

.wang-mask-text {
  font-size: 0.34px;
  font-weight: 700;
  fill: var(--text);
}

.badge-danger {
  background: color-mix(in srgb, var(--danger, var(--accent)) 18%, transparent);
  color: var(--danger, var(--accent));
  border-color: color-mix(in srgb, var(--danger, var(--accent)) 42%, transparent);
}

.brush-toolbar,
.brush-pills,
.light-sliders {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
</style>
