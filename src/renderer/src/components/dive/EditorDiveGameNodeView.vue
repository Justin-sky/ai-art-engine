<template>
  <div v-if="node" class="dive-view game-workbench-dive">
    <MachinationsStudio
      v-if="node.typeId === 'game.economy'"
      :node="node"
      :host-id="hostId"
      @close="onClose"
    />
    <template v-else>
      <div class="workbench-body">
        <!-- Left Parameter Sidebar -->
        <aside class="workbench-sidebar">
          <div class="sidebar-section-title">{{ t('gameNodes.workbench.paramsSidebar') }}</div>
          <p class="hint">{{ nodeHint }}</p>

          <!-- 1. game.pbrTile / game.spriteProp / game.vfxAlpha -->
          <div
            v-if="
              node.typeId === 'game.pbrTile' ||
              node.typeId === 'game.spriteProp' ||
              node.typeId === 'game.vfxAlpha'
            "
            class="param-card"
          >
            <div class="section-title">
              {{
                node.typeId === 'game.spriteProp'
                  ? t('gameNodes.spriteProp.sectionTitle')
                  : node.typeId === 'game.vfxAlpha'
                    ? t('gameNodes.vfxAlpha.sectionTitle')
                    : t('gameNodes.pbrTile.sectionTitle')
              }}
            </div>

            <label v-if="node.typeId !== 'game.vfxAlpha'" class="field">
              <span>{{ t('gameNodes.pbrTile.assetModeLabel') }}</span>
              <select
                :value="effectiveImageAssetMode"
                @change="onStringParam('gamePbrAssetMode', $event)"
              >
                <template v-if="node.typeId === 'game.spriteProp'">
                  <option value="sprite_stroke_mip">
                    {{ t('gameNodes.pbrTile.modeSpriteStrokeMip') }}
                  </option>
                  <option value="scene_prop">{{ t('gameNodes.pbrTile.modeSceneProp') }}</option>
                </template>
                <template v-else>
                  <option value="pbr_tile">{{ t('gameNodes.pbrTile.modePbrTile') }}</option>
                  <option value="autotile_wang16">
                    {{ t('gameNodes.pbrTile.modeAutotileWang16') }}
                  </option>
                </template>
              </select>
            </label>

            <label v-if="node.typeId === 'game.pbrTile'" class="field">
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

            <template v-if="effectiveImageAssetMode === 'scene_prop'">
              <label class="slider-field">
                <div class="slider-head">
                  <span>{{ t('gameNodes.pbrTile.propShadowOpacity') }}</span>
                  <b>{{ Math.round(Number(node.params.gamePropShadowOpacity ?? 0.42) * 100) }}%</b>
                </div>
                <input
                  type="range"
                  min="0"
                  max="0.9"
                  step="0.02"
                  :value="node.params.gamePropShadowOpacity ?? 0.42"
                  @change="onNumberParam('gamePropShadowOpacity', $event)"
                />
              </label>
              <label class="slider-field">
                <div class="slider-head">
                  <span>{{ t('gameNodes.pbrTile.propFootprintRatio') }}</span>
                  <b>{{ Math.round(Number(node.params.gamePropFootprintRatio ?? 0.25) * 100) }}%</b>
                </div>
                <input
                  type="range"
                  min="0.1"
                  max="0.55"
                  step="0.02"
                  :value="node.params.gamePropFootprintRatio ?? 0.25"
                  @change="onNumberParam('gamePropFootprintRatio', $event)"
                />
              </label>
            </template>

            <template v-else-if="effectiveImageAssetMode === 'sprite_stroke_mip'">
              <label class="slider-field">
                <div class="slider-head">
                  <span>{{ t('gameNodes.pbrTile.strokeWidthLabel') }}</span>
                  <b>{{ Number(node.params.gameStrokeWidthPx ?? 3) }} px</b>
                </div>
                <input
                  type="range"
                  min="1"
                  max="8"
                  step="1"
                  :value="node.params.gameStrokeWidthPx ?? 3"
                  @change="onNumberParam('gameStrokeWidthPx', $event)"
                />
              </label>
              <label class="field">
                <span>{{ t('gameNodes.pbrTile.strokeColorLabel') }}</span>
                <select
                  :value="node.params.gameStrokeColorPreset ?? 'gold'"
                  @change="onStringParam('gameStrokeColorPreset', $event)"
                >
                  <option value="gold">{{ t('gameNodes.pbrTile.strokeColorGold') }}</option>
                  <option value="white">{{ t('gameNodes.pbrTile.strokeColorWhite') }}</option>
                  <option value="black">{{ t('gameNodes.pbrTile.strokeColorBlack') }}</option>
                  <option value="cyan">{{ t('gameNodes.pbrTile.strokeColorCyan') }}</option>
                  <option value="crimson">{{ t('gameNodes.pbrTile.strokeColorCrimson') }}</option>
                </select>
              </label>
            </template>

            <template v-else-if="effectiveImageAssetMode === 'vfx_demult'">
              <label class="field">
                <span>{{ t('gameNodes.vfxAlpha.modeLabel') }}</span>
                <select
                  :value="node.params.gameVfxMode ?? 'vfx_flipbook'"
                  @change="onStringParam('gameVfxMode', $event)"
                >
                  <option value="vfx_flipbook">{{ t('gameNodes.vfxAlpha.modeFlipbook') }}</option>
                  <option value="vfx_demult">{{ t('gameNodes.vfxAlpha.modeDemult') }}</option>
                  <option value="vfx_trail_ribbon">{{ t('gameNodes.vfxAlpha.modeRibbon') }}</option>
                  <option value="vfx_channel_pack">
                    {{ t('gameNodes.vfxAlpha.modeChannelPack') }}
                  </option>
                </select>
              </label>

              <label class="field">
                <span>{{ t('gameNodes.vfxAlpha.archetypeLabel') }}</span>
                <select
                  :value="node.params.gameVfxArchetype ?? 'slash_arc'"
                  @change="onStringParam('gameVfxArchetype', $event)"
                >
                  <option value="slash_arc">{{ t('gameNodes.vfxAlpha.archSlash') }}</option>
                  <option value="fire_explosion">
                    {{ t('gameNodes.vfxAlpha.archExplosion') }}
                  </option>
                  <option value="arcane_vortex">{{ t('gameNodes.vfxAlpha.archVortex') }}</option>
                  <option value="lightning_burst">
                    {{ t('gameNodes.vfxAlpha.archLightning') }}
                  </option>
                  <option value="heal_aura">{{ t('gameNodes.vfxAlpha.archHeal') }}</option>
                  <option value="poison_nova">{{ t('gameNodes.vfxAlpha.archPoison') }}</option>
                </select>
              </label>

              <label class="field">
                <span>{{ t('gameNodes.vfxAlpha.paletteLabel') }}</span>
                <select
                  :value="node.params.gameVfxPalette ?? 'original'"
                  @change="onStringParam('gameVfxPalette', $event)"
                >
                  <option value="original">{{ t('gameNodes.vfxAlpha.palOriginal') }}</option>
                  <option value="solar_fire">{{ t('gameNodes.vfxAlpha.palSolarFire') }}</option>
                  <option value="arcane_cyan">{{ t('gameNodes.vfxAlpha.palArcaneCyan') }}</option>
                  <option value="void_purple">{{ t('gameNodes.vfxAlpha.palVoidPurple') }}</option>
                  <option value="fel_emerald">{{ t('gameNodes.vfxAlpha.palFelEmerald') }}</option>
                  <option value="holy_gold">{{ t('gameNodes.vfxAlpha.palHolyGold') }}</option>
                  <option value="blood_crimson">
                    {{ t('gameNodes.vfxAlpha.palBloodCrimson') }}
                  </option>
                </select>
              </label>

              <div class="grid2">
                <label class="field">
                  <span>{{ t('gameNodes.vfxAlpha.frameCountLabel') }}</span>
                  <select
                    :value="node.params.gameVfxFrameCount ?? 8"
                    @change="onNumberParam('gameVfxFrameCount', $event)"
                  >
                    <option :value="4">{{ t('gameNodes.vfxAlpha.frames4') }}</option>
                    <option :value="8">{{ t('gameNodes.vfxAlpha.frames8') }}</option>
                    <option :value="16">{{ t('gameNodes.vfxAlpha.frames16') }}</option>
                  </select>
                </label>
                <label class="field">
                  <span>{{ t('gameNodes.vfxAlpha.fpsLabel') }}</span>
                  <input
                    type="number"
                    min="4"
                    max="60"
                    :value="node.params.gameVfxFps ?? 14"
                    @change="onNumberParam('gameVfxFps', $event)"
                  />
                </label>
              </div>

              <label class="slider-field">
                <div class="slider-head">
                  <span>{{ t('gameNodes.vfxAlpha.bloomStrengthLabel') }}</span>
                  <b>{{ Math.round(Number(node.params.gameVfxBloomStrength ?? 0.45) * 100) }}%</b>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1.5"
                  step="0.05"
                  :value="node.params.gameVfxBloomStrength ?? 0.45"
                  @change="onNumberParam('gameVfxBloomStrength', $event)"
                />
              </label>

              <label class="slider-field">
                <div class="slider-head">
                  <span>{{ t('gameNodes.vfxAlpha.dissolveErosionLabel') }}</span>
                  <b>{{ Math.round(Number(node.params.gameVfxDissolveErosion ?? 0.35) * 100) }}%</b>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1.0"
                  step="0.05"
                  :value="node.params.gameVfxDissolveErosion ?? 0.35"
                  @change="onNumberParam('gameVfxDissolveErosion', $event)"
                />
              </label>

              <label class="slider-field">
                <div class="slider-head">
                  <span>{{ t('gameNodes.vfxAlpha.turbulenceLabel') }}</span>
                  <b>{{ Math.round(Number(node.params.gameVfxTurbulence ?? 0.45) * 100) }}%</b>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1.2"
                  step="0.05"
                  :value="node.params.gameVfxTurbulence ?? 0.45"
                  @change="onNumberParam('gameVfxTurbulence', $event)"
                />
              </label>

              <label class="slider-field">
                <div class="slider-head">
                  <span>{{ t('gameNodes.vfxAlpha.sparkCountLabel') }}</span>
                  <b>{{ Number(node.params.gameVfxSparkCount ?? 36) }}</b>
                </div>
                <input
                  type="range"
                  min="0"
                  max="96"
                  step="4"
                  :value="node.params.gameVfxSparkCount ?? 36"
                  @change="onNumberParam('gameVfxSparkCount', $event)"
                />
              </label>

              <label class="slider-field">
                <div class="slider-head">
                  <span>{{ t('gameNodes.vfxAlpha.distortionStrengthLabel') }}</span>
                  <b>{{ Number(node.params.gameVfxDistortionStrength ?? 0.035).toFixed(3) }}</b>
                </div>
                <input
                  type="range"
                  min="0"
                  max="0.12"
                  step="0.005"
                  :value="node.params.gameVfxDistortionStrength ?? 0.035"
                  @change="onNumberParam('gameVfxDistortionStrength', $event)"
                />
              </label>

              <label class="slider-field">
                <div class="slider-head">
                  <span>{{ t('gameNodes.vfxAlpha.edgeFeatherLabel') }}</span>
                  <b>{{ Math.round(Number(node.params.gameVfxEdgeFeather ?? 0.12) * 100) }}%</b>
                </div>
                <input
                  type="range"
                  min="0"
                  max="0.35"
                  step="0.02"
                  :value="node.params.gameVfxEdgeFeather ?? 0.12"
                  @change="onNumberParam('gameVfxEdgeFeather', $event)"
                />
              </label>

              <label class="slider-field">
                <div class="slider-head">
                  <span>{{ t('gameNodes.pbrTile.vfxBlackClip') }}</span>
                  <b>{{ Number(node.params.gameVfxBlackClip ?? 0.04).toFixed(2) }}</b>
                </div>
                <input
                  type="range"
                  min="0"
                  max="0.35"
                  step="0.01"
                  :value="node.params.gameVfxBlackClip ?? 0.04"
                  @change="onNumberParam('gameVfxBlackClip', $event)"
                />
              </label>
              <label class="slider-field">
                <div class="slider-head">
                  <span>{{ t('gameNodes.pbrTile.vfxWhitePoint') }}</span>
                  <b>{{ Number(node.params.gameVfxWhitePoint ?? 0.88).toFixed(2) }}</b>
                </div>
                <input
                  type="range"
                  min="0.4"
                  max="1.0"
                  step="0.02"
                  :value="node.params.gameVfxWhitePoint ?? 0.88"
                  @change="onNumberParam('gameVfxWhitePoint', $event)"
                />
              </label>
              <label class="slider-field">
                <div class="slider-head">
                  <span>{{ t('gameNodes.pbrTile.vfxGamma') }}</span>
                  <b>{{ Number(node.params.gameVfxGamma ?? 0.85).toFixed(2) }}</b>
                </div>
                <input
                  type="range"
                  min="0.35"
                  max="2.2"
                  step="0.05"
                  :value="node.params.gameVfxGamma ?? 0.85"
                  @change="onNumberParam('gameVfxGamma', $event)"
                />
              </label>
              <label class="slider-field">
                <div class="slider-head">
                  <span>{{ t('gameNodes.pbrTile.vfxColorBoost') }}</span>
                  <b>{{ Number(node.params.gameVfxColorBoost ?? 1.15).toFixed(2) }}×</b>
                </div>
                <input
                  type="range"
                  min="1.0"
                  max="2.0"
                  step="0.05"
                  :value="node.params.gameVfxColorBoost ?? 1.15"
                  @change="onNumberParam('gameVfxColorBoost', $event)"
                />
              </label>
            </template>

            <template v-if="node.typeId === 'game.pbrTile'">
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
            </template>

            <template v-if="node.typeId === 'game.spriteProp' || node.typeId === 'game.pbrTile'">
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
                  <option value="bottom_center">
                    {{ t('gameNodes.pbrTile.pivotBottomCenter') }}
                  </option>
                  <option value="center">{{ t('gameNodes.pbrTile.pivotCenter') }}</option>
                  <option value="top_left">{{ t('gameNodes.pbrTile.pivotTopLeft') }}</option>
                </select>
              </label>
            </template>

            <template v-if="node.typeId === 'game.pbrTile'">
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
            </template>

            <template v-if="node.typeId === 'game.pbrTile'">
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
            </template>

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
                <option value="bgm_intro_loop">
                  {{ t('gameNodes.audioDsp.modeBgmIntroLoop') }}
                </option>
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

            <template
              v-if="
                (node.params.gameAudioDspMode ?? 'loop_bgm') === 'loop_bgm' ||
                node.params.gameAudioDspMode === 'bgm_intro_loop'
              "
            >
              <label v-if="node.params.gameAudioDspMode === 'bgm_intro_loop'" class="slider-field">
                <div class="slider-head">
                  <span>{{ t('gameNodes.audioDsp.introSec') }}</span>
                  <b>{{ Number(node.params.gameAudioIntroSec ?? 2.0).toFixed(1) }}s</b>
                </div>
                <input
                  type="range"
                  min="0.4"
                  max="12"
                  step="0.2"
                  :value="node.params.gameAudioIntroSec ?? 2.0"
                  @change="onNumberParam('gameAudioIntroSec', $event)"
                />
              </label>

              <label class="slider-field">
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
            </template>

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
                <option value="platformer_course">
                  {{ t('gameNodes.levelMap.algPlatformer') }}
                </option>
                <option value="tower_defense">{{ t('gameNodes.levelMap.algTowerDefense') }}</option>
                <option value="labyrinth_maze">{{ t('gameNodes.levelMap.algLabyrinth') }}</option>
                <option value="node_graph_map">{{ t('gameNodes.levelMap.algNodeGraph') }}</option>
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

          <!-- 4. game.economy: Machinations 游戏经济与数值平衡系统 -->
          <div v-else-if="node.typeId === 'game.economy'" class="param-card">
            <div class="section-title">{{ t('gameNodes.economy.sectionTitle') }}</div>

            <label class="field">
              <span>{{ t('gameNodes.economy.presetLabel') }}</span>
              <select
                :value="node.params.gameEconomyPreset ?? 'arpg_equipment_economy'"
                @change="onEconomyPresetSelectChange($event)"
              >
                <option value="arpg_equipment_economy">
                  {{ t('gameNodes.economy.presetArpg') }}
                </option>
                <option value="gacha_pity_banner">{{ t('gameNodes.economy.presetGacha') }}</option>
                <option value="idle_exponential_tycoon">
                  {{ t('gameNodes.economy.presetIdle') }}
                </option>
                <option value="roguelike_mana_deck">{{ t('gameNodes.economy.presetDeck') }}</option>
                <option value="survivor_xp_loop">
                  {{ t('gameNodes.economy.presetSurvivor') }}
                </option>
              </select>
            </label>

            <div class="grid2">
              <label class="field">
                <span>{{ t('gameNodes.economy.stepsLabel') }}</span>
                <input
                  type="number"
                  min="10"
                  max="200"
                  step="5"
                  :value="node.params.gameEconomySteps ?? 50"
                  @change="onNumberParam('gameEconomySteps', $event)"
                />
              </label>
              <label class="field">
                <span>{{ t('gameNodes.economy.runsLabel') }}</span>
                <input
                  type="number"
                  min="5"
                  max="200"
                  step="5"
                  :value="node.params.gameEconomyMonteCarloRuns ?? 40"
                  @change="onNumberParam('gameEconomyMonteCarloRuns', $event)"
                />
              </label>
            </div>

            <div class="seed-row">
              <label class="field grow">
                <span>{{ t('gameNodes.economy.seedLabel') }}</span>
                <input
                  type="number"
                  step="1"
                  :value="node.params.gameEconomySeed ?? 2026"
                  @change="onNumberParam('gameEconomySeed', $event)"
                />
              </label>
              <button type="button" class="dice-btn" @click="randomizeEconomySeed">
                🎲 {{ t('gameNodes.levelMap.randomSeed') }}
              </button>
            </div>

            <!-- Selected Machinations Node Inspector -->
            <div v-if="selectedMachNode" class="mach-inspector-box">
              <div class="section-title">
                {{ t('gameNodes.economy.selectedNodeTitle') }} ({{
                  selectedMachNode.kind.toUpperCase()
                }})
              </div>
              <label class="field">
                <span>{{ t('gameNodes.economy.nodeLabelField') }}</span>
                <input
                  type="text"
                  :value="selectedMachNode.label"
                  @input="onEditMachNodeField('label', ($event.target as HTMLInputElement).value)"
                />
              </label>
              <div class="grid2">
                <label class="field">
                  <span>{{ t('gameNodes.economy.nodeKindField') }}</span>
                  <select
                    :value="selectedMachNode.kind"
                    @change="
                      onEditMachNodeField('kind', ($event.target as HTMLSelectElement).value)
                    "
                  >
                    <option value="source">{{ t('gameNodes.economy.kindSource') }}</option>
                    <option value="pool">{{ t('gameNodes.economy.kindPool') }}</option>
                    <option value="converter">{{ t('gameNodes.economy.kindConverter') }}</option>
                    <option value="drain">{{ t('gameNodes.economy.kindDrain') }}</option>
                    <option value="gate">{{ t('gameNodes.economy.kindGate') }}</option>
                    <option value="register">{{ t('gameNodes.economy.kindRegister') }}</option>
                    <option value="end_condition">
                      {{ t('gameNodes.economy.kindEndCondition') }}
                    </option>
                  </select>
                </label>
                <label class="field">
                  <span>{{ t('gameNodes.economy.activationField') }}</span>
                  <select
                    :value="selectedMachNode.activation"
                    @change="
                      onEditMachNodeField('activation', ($event.target as HTMLSelectElement).value)
                    "
                  >
                    <option value="automatic">{{ t('gameNodes.economy.actAutomatic') }}</option>
                    <option value="interactive">{{ t('gameNodes.economy.actInteractive') }}</option>
                    <option value="passive">{{ t('gameNodes.economy.actPassive') }}</option>
                    <option value="on_start">{{ t('gameNodes.economy.actOnStart') }}</option>
                  </select>
                </label>
              </div>

              <div v-if="selectedMachNode.kind === 'pool'" class="grid2">
                <label class="field">
                  <span>{{ t('gameNodes.economy.initialValueField') }}</span>
                  <input
                    type="number"
                    step="5"
                    :value="selectedMachNode.initialValue ?? 0"
                    @change="onEditMachNodeNumber('initialValue', $event)"
                  />
                </label>
                <label class="field">
                  <span>{{ t('gameNodes.economy.maxCapField') }}</span>
                  <input
                    type="number"
                    step="10"
                    :value="selectedMachNode.maxCapacity ?? 99999"
                    @change="onEditMachNodeNumber('maxCapacity', $event)"
                  />
                </label>
              </div>

              <label
                v-if="
                  selectedMachNode.kind === 'register' || selectedMachNode.kind === 'end_condition'
                "
                class="field"
              >
                <span>{{ t('gameNodes.economy.formulaField') }}</span>
                <input
                  type="text"
                  :value="selectedMachNode.formula ?? ''"
                  placeholder="75 * Math.pow(1.20, a)"
                  @change="
                    onEditMachNodeField('formula', ($event.target as HTMLInputElement).value)
                  "
                />
              </label>

              <!-- Outgoing edges rate quick editor -->
              <div v-if="selectedMachNodeEdges.length > 0" class="mach-edge-list">
                <div class="section-title">{{ t('gameNodes.economy.edgeRatesTitle') }}</div>
                <div v-for="edge in selectedMachNodeEdges" :key="edge.id" class="mach-edge-row">
                  <span class="mach-edge-tag" :class="{ state: edge.kind === 'state_modifier' }">
                    {{ edge.kind === 'state_modifier' ? '╌►' : '──►' }}
                    {{ getMachNodeLabel(edge.targetId) }}
                  </span>
                  <input
                    type="number"
                    step="1"
                    class="mach-edge-rate-input"
                    :value="edge.rate"
                    @change="onEditMachEdgeRate(edge.id, $event)"
                  />
                  <button
                    type="button"
                    class="secondary-btn"
                    title="Delete Connection"
                    @click="deleteMachEdge(edge.id)"
                  >
                    ✕
                  </button>
                </div>
              </div>
            </div>

            <div v-if="node.params.gameEconomyReport" class="report-chip">
              {{ node.params.gameEconomyReport }}
            </div>
          </div>
        </aside>

        <!-- Main Interactive Stage -->
        <main class="workbench-stage">
          <!-- Stage 1: game.pbrTile / game.spriteProp / game.vfxAlpha -->
          <template
            v-if="
              node.typeId === 'game.pbrTile' ||
              node.typeId === 'game.spriteProp' ||
              node.typeId === 'game.vfxAlpha'
            "
          >
            <div class="stage-toolbar">
              <span class="stage-title">
                {{
                  node.typeId === 'game.spriteProp'
                    ? t('gameNodes.spriteProp.sectionTitle')
                    : node.typeId === 'game.vfxAlpha'
                      ? t('gameNodes.vfxAlpha.sectionTitle')
                      : t('gameNodes.workbench.pbrPreviewTitle')
                }}
              </span>
              <div class="tab-pills">
                <template v-if="node.typeId === 'game.pbrTile'">
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
                </template>
                <template v-else-if="node.typeId === 'game.spriteProp'">
                  <button
                    type="button"
                    class="tab-pill"
                    :class="{ active: pbrTab === 'channels' }"
                    @click="pbrTab = 'channels'"
                  >
                    {{ t('gameNodes.spriteProp.tabMipChain') }}
                  </button>
                  <button
                    type="button"
                    class="tab-pill"
                    :class="{ active: pbrTab === 'physics' }"
                    @click="pbrTab = 'physics'"
                  >
                    {{ t('gameNodes.spriteProp.tabYSortHull') }}
                  </button>
                </template>
                <template v-else>
                  <button
                    type="button"
                    class="tab-pill"
                    :class="{ active: pbrTab === 'vfx_player' }"
                    @click="pbrTab = 'vfx_player'"
                  >
                    {{ t('gameNodes.vfxAlpha.tabPlayer') }}
                  </button>
                  <button
                    type="button"
                    class="tab-pill"
                    :class="{ active: pbrTab === 'channels' }"
                    @click="pbrTab = 'channels'"
                  >
                    {{ t('gameNodes.vfxAlpha.tabAlphaCompare') }}
                  </button>
                  <button
                    type="button"
                    class="tab-pill"
                    :class="{ active: pbrTab === 'vfx_engine' }"
                    @click="pbrTab = 'vfx_engine'"
                  >
                    {{ t('gameNodes.vfxAlpha.tabEngineShader') }}
                  </button>
                </template>
              </div>
            </div>

            <div class="stage-content">
              <!-- VFX Tab 1: Live 60fps Flipbook Lifecycle & Blend Mode Sandbox -->
              <div
                v-if="pbrTab === 'vfx_player' && node.typeId === 'game.vfxAlpha'"
                class="pbr-lighting-stage"
              >
                <div class="pbr-light-controls">
                  <div class="tab-pills">
                    <button
                      type="button"
                      class="tab-pill"
                      :class="{ active: vfxIsPlaying }"
                      @click="toggleVfxPlayback"
                    >
                      {{ vfxIsPlaying ? '⏸ Pause' : '▶ Play' }}
                    </button>
                    <button type="button" class="secondary-btn" @click="stepVfxFrame(-1)">◀</button>
                    <span class="spec-badge">
                      Frame {{ vfxCurrentFrame + 1 }} / {{ vfxLivePipeline.frameCount }} ({{
                        vfxLivePipeline.fps
                      }}
                      FPS)
                    </span>
                    <button type="button" class="secondary-btn" @click="stepVfxFrame(1)">▶</button>
                    <label class="inline-slider">
                      <span>{{ t('gameNodes.vfxAlpha.bulletTimeSpeedLabel') }}</span>
                      <input
                        v-model.number="vfxBulletTimeSpeed"
                        type="range"
                        min="0.1"
                        max="2.0"
                        step="0.05"
                      />
                      <b>{{ vfxBulletTimeSpeed.toFixed(2) }}×</b>
                    </label>
                  </div>

                  <div class="tab-pills">
                    <button
                      type="button"
                      class="tab-pill"
                      :class="{ active: vfxPlayerBg === 'checker' }"
                      @click="
                        vfxPlayerBg = 'checker'
                        renderVfxPlayerCanvas()
                      "
                    >
                      {{ t('gameNodes.vfxAlpha.playerBgChecker') }}
                    </button>
                    <button
                      type="button"
                      class="tab-pill"
                      :class="{ active: vfxPlayerBg === 'dark' }"
                      @click="
                        vfxPlayerBg = 'dark'
                        renderVfxPlayerCanvas()
                      "
                    >
                      {{ t('gameNodes.vfxAlpha.playerBgDark') }}
                    </button>
                    <button
                      type="button"
                      class="tab-pill"
                      :class="{ active: vfxPlayerBg === 'light' }"
                      @click="
                        vfxPlayerBg = 'light'
                        renderVfxPlayerCanvas()
                      "
                    >
                      {{ t('gameNodes.vfxAlpha.playerBgLight') }}
                    </button>
                    <button
                      type="button"
                      class="tab-pill"
                      :class="{ active: vfxBlendMode === 'source-over' }"
                      @click="
                        vfxBlendMode = 'source-over'
                        renderVfxPlayerCanvas()
                      "
                    >
                      {{ t('gameNodes.vfxAlpha.blendAlpha') }}
                    </button>
                    <button
                      type="button"
                      class="tab-pill"
                      :class="{ active: vfxBlendMode === 'lighter' }"
                      @click="
                        vfxBlendMode = 'lighter'
                        renderVfxPlayerCanvas()
                      "
                    >
                      {{ t('gameNodes.vfxAlpha.blendAdditive') }}
                    </button>
                    <button
                      type="button"
                      class="tab-pill"
                      :class="{ active: vfxEnableOpticalFlow }"
                      @click="
                        vfxEnableOpticalFlow = !vfxEnableOpticalFlow
                        renderVfxPlayerCanvas()
                      "
                    >
                      {{ t('gameNodes.vfxAlpha.layerOpticalFlowToggle') }}
                    </button>
                    <button
                      type="button"
                      class="tab-pill"
                      :class="{ active: vfxEnableDecalLayer }"
                      @click="
                        vfxEnableDecalLayer = !vfxEnableDecalLayer
                        renderVfxPlayerCanvas()
                      "
                    >
                      {{ t('gameNodes.vfxAlpha.layerDecalToggle') }}
                    </button>
                    <button
                      type="button"
                      class="tab-pill"
                      :class="{ active: vfxEnableSparksLayer }"
                      @click="
                        vfxEnableSparksLayer = !vfxEnableSparksLayer
                        renderVfxPlayerCanvas()
                      "
                    >
                      {{ t('gameNodes.vfxAlpha.layerSparksToggle') }}
                    </button>
                    <button
                      type="button"
                      class="tab-pill"
                      :class="{ active: vfxEnableDistortionLayer }"
                      @click="
                        vfxEnableDistortionLayer = !vfxEnableDistortionLayer
                        renderVfxPlayerCanvas()
                      "
                    >
                      {{ t('gameNodes.vfxAlpha.layerDistortionToggle') }}
                    </button>
                    <button
                      type="button"
                      class="tab-pill"
                      :class="{ active: vfxEnableAudioSync }"
                      @click="vfxEnableAudioSync = !vfxEnableAudioSync"
                    >
                      {{ t('gameNodes.vfxAlpha.layerAudioSyncToggle') }}
                    </button>
                    <button type="button" class="action-btn" @click="triggerVfxHitTest">
                      {{ t('gameNodes.vfxAlpha.triggerHitTestBtn') }}
                    </button>
                  </div>
                </div>

                <span class="hint">{{ t('gameNodes.vfxAlpha.slashDragHint') }}</span>

                <canvas
                  ref="vfxPlayerCanvasRef"
                  width="320"
                  height="320"
                  class="pbr-light-canvas"
                  @pointerdown="onVfxCanvasPointerDown"
                  @pointermove="onVfxCanvasPointerMove"
                  @pointerup="onVfxCanvasPointerUp"
                  @pointerleave="onVfxCanvasPointerUp"
                />

                <div class="level-stats-bar">
                  <span>
                    Grid: {{ vfxLivePipeline.cols }}×{{ vfxLivePipeline.rows }} ({{
                      vfxLivePipeline.sheetWidth
                    }}×{{ vfxLivePipeline.sheetHeight }}px)
                  </span>
                  <span>
                    Clear Background: {{ (vfxLivePipeline.transparentRatio * 100).toFixed(1) }}%
                  </span>
                  <span>Peak Alpha: {{ vfxLivePipeline.peakAlpha }} / 255</span>
                  <span>Palette: {{ node.params.gameVfxPalette ?? 'original' }}</span>
                </div>
              </div>

              <!-- VFX Tab 3: Godot 4 4-Layer Composite VFX (.tscn) + SpriteFrames (.tres) + Uber VFX (.gdshader) + Unity (.json) -->
              <div
                v-else-if="pbrTab === 'vfx_engine' && node.typeId === 'game.vfxAlpha'"
                class="audio-stage-body"
              >
                <div class="engine-export-panel">
                  <div class="engine-export-head">
                    <span class="section-title">
                      Godot 4 4-Layer Composite VFX Prefab (.tscn)
                    </span>
                    <div class="tab-pills">
                      <button type="button" class="action-btn" @click="downloadVfxGodotTscn">
                        {{ t('gameNodes.vfxAlpha.downloadGodotTscnBtn') }}
                      </button>
                      <button type="button" class="secondary-btn" @click="downloadVfxUnityJson">
                        {{ t('gameNodes.vfxAlpha.downloadUnityJsonBtn') }}
                      </button>
                    </div>
                  </div>
                  <pre class="code-viewer compact">{{ vfxLivePipeline.godotVfxPrefabTscn }}</pre>
                </div>

                <div class="engine-export-panel">
                  <div class="engine-export-head">
                    <span class="section-title">Godot 4 SpriteFrames (.tres)</span>
                    <div class="tab-pills">
                      <button type="button" class="action-btn" @click="downloadVfxSpriteFramesTres">
                        {{ t('gameNodes.vfxAlpha.downloadSpriteFramesBtn') }}
                      </button>
                    </div>
                  </div>
                  <pre class="code-viewer compact">{{ vfxLivePipeline.godotSpriteFramesTres }}</pre>
                </div>

                <div class="engine-export-panel">
                  <div class="engine-export-head">
                    <span class="section-title">
                      Godot 4 CanvasItem Uber VFX Shader (.gdshader)
                    </span>
                    <div class="tab-pills">
                      <button type="button" class="action-btn" @click="downloadVfxGdShader">
                        {{ t('gameNodes.vfxAlpha.downloadGdShaderBtn') }}
                      </button>
                    </div>
                  </div>
                  <pre class="code-viewer compact">{{ vfxLivePipeline.godotVfxShader }}</pre>
                </div>
              </div>

              <!-- UI Container Tab 1: Interactive UI Sandbox (3D Foil Card / 5-State Button Deck / Combat HUD Bar) -->
              <div v-else-if="pbrTab === 'ui_sandbox'" class="pbr-lighting-stage">
                <!-- Mode A: Composite Frame — 3D Tilt SSR Foil Card & Live Data-Bound Text -->
                <template v-if="effectiveImageAssetMode === 'composite_frame' && uiLiveFrameBundle">
                  <div class="pbr-light-controls">
                    <span class="hint">{{ t('gameNodes.uiContainer.sandboxTiltHint') }}</span>
                    <div class="tab-pills">
                      <button type="button" class="action-btn" @click="downloadPbrGodotTres">
                        {{ t('gameNodes.pbrTile.downloadGodotTresBtn') }}
                      </button>
                      <button type="button" class="secondary-btn" @click="downloadUiFoilShader">
                        {{ t('gameNodes.uiContainer.downloadGodotFoilBtn') }}
                      </button>
                    </div>
                  </div>

                  <div
                    class="ui-foil-stage"
                    @pointermove="onUiFoilPointerMove"
                    @pointerleave="resetUiFoilTilt"
                  >
                    <div class="ui-foil-card-3d" :style="uiFoilTiltStyle">
                      <img
                        :src="uiLiveFrameBundle.compositeUrl"
                        alt=""
                        class="ui-foil-base-img"
                        draggable="false"
                      />
                      <div
                        v-if="Number(node.params.gameUiFoilStrength ?? 0.65) > 0"
                        class="ui-foil-shimmer-layer"
                        :style="uiFoilShimmerOverlayStyle"
                      />
                    </div>
                  </div>

                  <div class="level-stats-bar">
                    <span>Shape: {{ node.params.gameFrameShape ?? 'rect_card' }}</span>
                    <span>Style: {{ node.params.gameUiStylePreset ?? 'dark_iron_parchment' }}</span>
                    <span
                      >Rarity: {{ (node.params.gameIconRarityTier ?? 'rare').toUpperCase() }}</span
                    >
                    <span>
                      Foil Shimmer:
                      {{ Math.round(Number(node.params.gameUiFoilStrength ?? 0.65) * 100) }}%
                    </span>
                  </div>
                </template>

                <!-- Mode B: UI Kit — Interactive 5-State Button Deck & Focus Ring Tester -->
                <template v-else-if="effectiveImageAssetMode === 'ui_kit' && uiLiveButtonKit">
                  <div class="pbr-light-controls">
                    <span class="hint">{{ t('gameNodes.uiContainer.sandboxBtnHint') }}</span>
                    <div class="tab-pills">
                      <button
                        type="button"
                        class="tab-pill"
                        :class="{ active: uiButtonSimState === 'normal' }"
                        @click="uiButtonSimState = 'normal'"
                      >
                        Normal
                      </button>
                      <button
                        type="button"
                        class="tab-pill"
                        :class="{ active: uiButtonSimState === 'hover' }"
                        @click="uiButtonSimState = 'hover'"
                      >
                        Hover
                      </button>
                      <button
                        type="button"
                        class="tab-pill"
                        :class="{ active: uiButtonSimState === 'pressed' }"
                        @click="uiButtonSimState = 'pressed'"
                      >
                        Pressed (+2px)
                      </button>
                      <button
                        type="button"
                        class="tab-pill"
                        :class="{ active: uiButtonSimState === 'focused' }"
                        @click="uiButtonSimState = 'focused'"
                      >
                        🎮 Focused Ring
                      </button>
                      <button
                        type="button"
                        class="tab-pill"
                        :class="{ active: uiButtonSimState === 'disabled' }"
                        @click="uiButtonSimState = 'disabled'"
                      >
                        Disabled
                      </button>
                      <button type="button" class="action-btn" @click="downloadPbrGodotTres">
                        {{ t('gameNodes.pbrTile.downloadGodotTresBtn') }}
                      </button>
                    </div>
                  </div>

                  <div class="ui-button-deck-stage">
                    <div
                      class="ui-interactive-btn-preview alpha-checkerboard-bg"
                      :class="{ 'is-pressed': uiButtonSimState === 'pressed' }"
                      @pointerenter="uiButtonSimState = 'hover'"
                      @pointerdown="uiButtonSimState = 'pressed'"
                      @pointerup="uiButtonSimState = 'focused'"
                      @pointerleave="
                        uiButtonSimState = uiButtonSimState === 'disabled' ? 'disabled' : 'normal'
                      "
                    >
                      <img
                        :src="uiLiveButtonKit.stateUrls[uiButtonSimState]"
                        alt=""
                        class="ui-btn-state-img"
                        draggable="false"
                      />
                      <span class="ui-btn-caption">START QUEST</span>
                    </div>

                    <div class="ui-rarity-preview-card alpha-checkerboard-bg">
                      <img
                        :src="uiLiveButtonKit.rarityUrl"
                        alt=""
                        class="ui-btn-state-img"
                        draggable="false"
                      />
                      <span class="spec-badge">
                        Rarity: {{ (node.params.gameIconRarityTier ?? 'legendary').toUpperCase() }}
                      </span>
                    </div>
                  </div>

                  <div class="level-stats-bar">
                    <span>State: {{ uiButtonSimState.toUpperCase() }}</span>
                    <span>
                      9-Slice Mode:
                      {{ (node.params.gameNineSliceStretchMode ?? 'stretch').toUpperCase() }}
                    </span>
                    <span>
                      Symmetry Lock: {{ node.params.gameUiSymmetricLock !== false ? 'ON' : 'OFF' }}
                    </span>
                  </div>
                </template>

                <!-- Mode B0: Raw 9-Slice Direct Slicer & Multi-Engine Exporter -->
                <template
                  v-else-if="effectiveImageAssetMode === 'raw_nine_slice' && uiLiveRawNineSlice"
                >
                  <div class="pbr-light-controls">
                    <div class="tab-pills">
                      <button type="button" class="action-btn" @click="downloadNineSliceGodotTscn">
                        {{ t('gameNodes.uiContainer.downloadNineSliceTscnBtn') }}
                      </button>
                      <button
                        type="button"
                        class="secondary-btn"
                        @click="downloadNineSliceUnityUss"
                      >
                        {{ t('gameNodes.uiContainer.downloadNineSliceUssBtn') }}
                      </button>
                      <button type="button" class="secondary-btn" @click="downloadNineSliceWebCss">
                        {{ t('gameNodes.uiContainer.downloadNineSliceCssBtn') }}
                      </button>
                      <button
                        type="button"
                        class="secondary-btn"
                        @click="downloadNineSliceExplodedPng"
                      >
                        {{ t('gameNodes.uiContainer.downloadExplodedAtlasBtn') }}
                      </button>
                    </div>
                  </div>

                  <div class="ui-button-deck-stage">
                    <div class="ui-rarity-preview-card alpha-checkerboard-bg">
                      <img
                        :src="uiLiveRawNineSlice.explodedUrl"
                        alt=""
                        class="ui-btn-state-img"
                        draggable="false"
                      />
                      <span class="spec-badge">
                        {{ t('gameNodes.uiContainer.explodedNinePatchesBadge') }}
                      </span>
                    </div>
                    <div class="ui-rarity-preview-card alpha-checkerboard-bg">
                      <img
                        :src="uiLiveRawNineSlice.hollowUrl"
                        alt=""
                        class="ui-btn-state-img"
                        draggable="false"
                      />
                      <span class="spec-badge">
                        {{ t('gameNodes.uiContainer.hollowFrameBadge') }}
                      </span>
                    </div>
                    <div class="ui-rarity-preview-card alpha-checkerboard-bg">
                      <img
                        :src="uiNineSliceResizedDataUrl"
                        alt=""
                        class="ui-btn-state-img"
                        draggable="false"
                      />
                      <span class="spec-badge">
                        {{ t('gameNodes.uiContainer.stretchedPreviewBadge') }}
                      </span>
                    </div>
                  </div>

                  <div class="level-stats-bar">
                    <span>
                      9-Slice (L/R/T/B): {{ pbrLiveNineSlice.borders.left }}/{{
                        pbrLiveNineSlice.borders.right
                      }}/{{ pbrLiveNineSlice.borders.top }}/{{ pbrLiveNineSlice.borders.bottom }}px
                    </span>
                    <span>
                      Center: {{ pbrLiveNineSlice.stretchCenterWidth }}×{{
                        pbrLiveNineSlice.stretchCenterHeight
                      }}px
                    </span>
                    <span>
                      Mode: {{ (node.params.gameNineSliceStretchMode ?? 'stretch').toUpperCase() }}
                    </span>
                    <span> Symmetry: {{ node.params.gameUiSymmetricLock ? 'ON' : 'OFF' }} </span>
                  </div>
                </template>

                <!-- Mode C: HUD Bar Kit — Combat HUD HP / Shield / Delayed White Damage Trail Simulator -->
                <template v-else-if="effectiveImageAssetMode === 'hud_bar_kit' && uiLiveHudBarKit">
                  <div class="pbr-light-controls">
                    <div class="tab-pills">
                      <button type="button" class="action-btn" @click="triggerHudDamage(25)">
                        {{ t('gameNodes.uiContainer.sandboxHudHitBtn') }}
                      </button>
                      <button type="button" class="secondary-btn" @click="triggerHudHeal(30)">
                        {{ t('gameNodes.uiContainer.sandboxHudHealBtn') }}
                      </button>
                      <button type="button" class="secondary-btn" @click="resetHudHp">
                        {{ t('gameNodes.uiContainer.sandboxHudResetBtn') }}
                      </button>
                      <button type="button" class="secondary-btn" @click="downloadHudGodotTscn">
                        {{ t('gameNodes.uiContainer.downloadGodotHudBtn') }}
                      </button>
                    </div>
                  </div>

                  <div
                    class="ui-hud-simulator-stage"
                    :class="{ 'low-hp-warning': uiHudCurrentHp <= 30 }"
                  >
                    <div class="ui-hud-readout">
                      <span class="spec-badge">
                        {{ (node.params.gameHudBarPreset ?? 'hp_crimson').toUpperCase() }}
                      </span>
                      <b>{{ Math.round(uiHudCurrentHp * 10) }} / 1000</b>
                    </div>
                    <div class="ui-hud-bar-stack">
                      <img
                        :src="uiLiveHudBarKit.backplateUrl"
                        alt=""
                        class="ui-hud-layer"
                        draggable="false"
                      />
                      <!-- White Delayed Damage Trail (masked strictly inside chamfered bar fill) -->
                      <img
                        :src="uiLiveHudBarKit.fillStripUrl"
                        alt=""
                        class="ui-hud-layer ui-hud-trail-layer"
                        :style="computeHudBarClipStyle(Math.max(uiHudCurrentHp, uiHudTrailHp))"
                        draggable="false"
                      />
                      <!-- Active Fill Strip clipped by current HP % without squishing texture -->
                      <img
                        :src="uiLiveHudBarKit.fillStripUrl"
                        alt=""
                        class="ui-hud-layer ui-hud-fill-layer"
                        :style="computeHudBarClipStyle(uiHudCurrentHp)"
                        draggable="false"
                      />
                      <img
                        :src="uiLiveHudBarKit.frameOverlayUrl"
                        alt=""
                        class="ui-hud-layer"
                        draggable="false"
                      />
                    </div>
                  </div>

                  <div class="level-stats-bar">
                    <span>Preset: {{ node.params.gameHudBarPreset ?? 'hp_crimson' }}</span>
                    <span>Style: {{ node.params.gameUiStylePreset ?? 'dark_iron_parchment' }}</span>
                    <span>Current Value: {{ Math.round(uiHudCurrentHp) }}%</span>
                    <span>Delayed Trail: {{ Math.round(uiHudTrailHp) }}%</span>
                  </div>
                </template>

                <!-- Mode D: Radial Polar HUD Kit — 360° Cooldown Wipe + Minimap Compass + 8-Way Wheel -->
                <template
                  v-else-if="effectiveImageAssetMode === 'radial_hud_kit' && uiLiveRadialHudKit"
                >
                  <div class="pbr-light-controls">
                    <div class="tab-pills">
                      <button type="button" class="action-btn" @click="triggerSkillCooldown(0)">
                        ⚡ Cast Skill [Q] (360° CD)
                      </button>
                      <button type="button" class="secondary-btn" @click="downloadPbrGodotTres">
                        {{ t('gameNodes.pbrTile.downloadGodotTresBtn') }}
                      </button>
                    </div>
                  </div>

                  <div class="ui-button-deck-stage">
                    <div
                      class="ui-interactive-btn-preview alpha-checkerboard-bg"
                      @click="triggerSkillCooldown(0)"
                    >
                      <img
                        :src="uiLiveRadialHudKit.skillSlotUrl"
                        alt=""
                        class="ui-btn-state-img"
                        draggable="false"
                      />
                      <div
                        v-if="uiSkillCooldowns[0] > 0"
                        class="ui-radial-cd-sweep"
                        :style="{
                          background: `conic-gradient(rgba(9, 10, 18, 0.78) ${Math.round(uiSkillCooldowns[0] * 3.6)}deg, transparent 0deg)`
                        }"
                      >
                        <b>{{ (uiSkillCooldowns[0] * 0.05).toFixed(1) }}s</b>
                      </div>
                    </div>
                    <div class="ui-rarity-preview-card alpha-checkerboard-bg">
                      <img
                        :src="uiLiveRadialHudKit.minimapUrl"
                        alt=""
                        class="ui-btn-state-img"
                        draggable="false"
                      />
                      <span class="spec-badge">360° Minimap & Compass</span>
                    </div>
                    <div class="ui-rarity-preview-card alpha-checkerboard-bg">
                      <img
                        :src="uiLiveRadialHudKit.actionWheelUrl"
                        alt=""
                        class="ui-btn-state-img"
                        draggable="false"
                      />
                      <span class="spec-badge">8-Way Action Wheel</span>
                    </div>
                  </div>
                </template>

                <!-- Mode E: Dialogue Kit — RPG / Visual Novel Dialogue Box + Nameplate + Branching Choices -->
                <template
                  v-else-if="effectiveImageAssetMode === 'dialogue_kit' && uiLiveDialogueKit"
                >
                  <div class="pbr-light-controls">
                    <div class="tab-pills">
                      <button type="button" class="action-btn" @click="advanceDialogueLine">
                        💬 Next Dialogue Line
                      </button>
                      <button type="button" class="secondary-btn" @click="downloadPbrGodotTres">
                        {{ t('gameNodes.pbrTile.downloadGodotTresBtn') }}
                      </button>
                    </div>
                  </div>

                  <div class="ui-dialogue-sandbox-card alpha-checkerboard-bg">
                    <img
                      :src="uiLiveDialogueKit.compositeUrl"
                      alt=""
                      class="ui-btn-state-img"
                      draggable="false"
                    />
                    <div class="ui-dialogue-text-preview">
                      <div class="spec-badge">{{ currentDialogueSample.speaker }}</div>
                      <p>{{ currentDialogueSample.line }}</p>
                    </div>
                  </div>
                </template>

                <!-- Mode F: UI Form Controls Kit — Tabs, Slider, Checkbox & Toggle Switch -->
                <template
                  v-else-if="effectiveImageAssetMode === 'ui_controls_kit' && uiLiveControlsKit"
                >
                  <div class="pbr-light-controls">
                    <div class="tab-pills">
                      <button type="button" class="action-btn" @click="downloadPbrGodotTres">
                        {{ t('gameNodes.pbrTile.downloadGodotTresBtn') }}
                      </button>
                    </div>
                  </div>

                  <div class="ui-button-deck-stage">
                    <div class="ui-rarity-preview-card alpha-checkerboard-bg">
                      <img
                        :src="uiLiveControlsKit.atlasUrl"
                        alt=""
                        class="ui-btn-state-img"
                        draggable="false"
                      />
                      <span class="spec-badge">Master Controls Atlas</span>
                    </div>
                    <div class="ui-rarity-preview-card alpha-checkerboard-bg">
                      <img
                        :src="uiLiveControlsKit.sliderUrl"
                        alt=""
                        class="ui-btn-state-img"
                        draggable="false"
                      />
                      <span class="spec-badge">Slider + Grabber + Scroll</span>
                    </div>
                    <div class="ui-rarity-preview-card alpha-checkerboard-bg">
                      <img
                        :src="uiLiveControlsKit.checkboxUrl"
                        alt=""
                        class="ui-btn-state-img"
                        draggable="false"
                      />
                      <span class="spec-badge">Checkbox + Pill Toggle</span>
                    </div>
                  </div>
                </template>
              </div>

              <!-- UI Container Tab 1: Photoshop Artboard UI Studio (Design Resolution · Layers Stack · Icon Widget Library) -->
              <div
                v-else-if="pbrTab === 'ui_screen'"
                class="ps-artboard-studio"
                @pointermove="onPsArtboardPointerMove"
                @pointerup="onPsArtboardPointerUp"
                @pointerleave="onPsArtboardPointerUp"
              >
                <!-- PS Top Document Options Bar -->
                <div class="ps-top-options-bar">
                  <!-- Blank Canvas + 8-Screen Blueprint Switcher (Multi-Page Project) -->
                  <div class="ps-option-group">
                    <button
                      type="button"
                      class="ps-top-pill blank-pill"
                      :class="{ active: activeScreenBlueprint === 'blank_canvas' }"
                      :title="t('gameNodes.uiContainer.bpBlankCanvas')"
                      @click="setScreenBlueprint('blank_canvas')"
                    >
                      <span>➕ NEW</span>
                    </button>
                    <button
                      type="button"
                      class="ps-top-pill"
                      :class="{ active: activeScreenBlueprint === 'combat_hud' }"
                      :title="t('gameNodes.uiContainer.bpCombatHud')"
                      @click="setScreenBlueprint('combat_hud')"
                    >
                      <span>⚔️ HUD</span>
                    </button>
                    <button
                      type="button"
                      class="ps-top-pill"
                      :class="{ active: activeScreenBlueprint === 'title_menu' }"
                      :title="t('gameNodes.uiContainer.bpTitleMenu')"
                      @click="setScreenBlueprint('title_menu')"
                    >
                      <span>🏠 MENU</span>
                    </button>
                    <button
                      type="button"
                      class="ps-top-pill"
                      :class="{ active: activeScreenBlueprint === 'inventory_paperdoll' }"
                      :title="t('gameNodes.uiContainer.bpInventory')"
                      @click="setScreenBlueprint('inventory_paperdoll')"
                    >
                      <span>🎒 BAG</span>
                    </button>
                    <button
                      type="button"
                      class="ps-top-pill"
                      :class="{ active: activeScreenBlueprint === 'skill_tree' }"
                      :title="t('gameNodes.uiContainer.bpSkillTree')"
                      @click="setScreenBlueprint('skill_tree')"
                    >
                      <span>🌟 TREE</span>
                    </button>
                    <button
                      type="button"
                      class="ps-top-pill"
                      :class="{ active: activeScreenBlueprint === 'shop_gacha' }"
                      :title="t('gameNodes.uiContainer.bpShopGacha')"
                      @click="setScreenBlueprint('shop_gacha')"
                    >
                      <span>🪙 SHOP</span>
                    </button>
                    <button
                      type="button"
                      class="ps-top-pill"
                      :class="{ active: activeScreenBlueprint === 'dialogue_vn' }"
                      :title="t('gameNodes.uiContainer.bpDialogueVn')"
                      @click="setScreenBlueprint('dialogue_vn')"
                    >
                      <span>💬 AVG</span>
                    </button>
                    <button
                      type="button"
                      class="ps-top-pill"
                      :class="{ active: activeScreenBlueprint === 'quest_victory' }"
                      :title="t('gameNodes.uiContainer.bpQuestVictory')"
                      @click="setScreenBlueprint('quest_victory')"
                    >
                      <span>🏆 WIN</span>
                    </button>
                    <button
                      type="button"
                      class="ps-top-pill"
                      :class="{ active: activeScreenBlueprint === 'settings_form' }"
                      :title="t('gameNodes.uiContainer.bpSettingsForm')"
                      @click="setScreenBlueprint('settings_form')"
                    >
                      <span>⚙️ CFG</span>
                    </button>
                  </div>

                  <span class="ps-bar-sep" />

                  <!-- Undo / Redo History Buttons -->
                  <div class="ps-option-group">
                    <button
                      type="button"
                      class="ps-icon-btn"
                      :disabled="!canPsUndo"
                      :title="t('gameNodes.uiContainer.psUndo')"
                      @click="undoPsArtboard"
                    >
                      <svg viewBox="0 0 16 16" class="ps-svg-icon">
                        <path
                          d="M5.5 3L1.5 7l4 4V8h5a2.5 2.5 0 010 5H8v1.5h2.5a4 4 0 000-8h-5V3z"
                          fill="currentColor"
                        />
                      </svg>
                    </button>
                    <button
                      type="button"
                      class="ps-icon-btn"
                      :disabled="!canPsRedo"
                      :title="t('gameNodes.uiContainer.psRedo')"
                      @click="redoPsArtboard"
                    >
                      <svg viewBox="0 0 16 16" class="ps-svg-icon">
                        <path
                          d="M10.5 3l4 4-4 4V8h-5a2.5 2.5 0 000 5H8v1.5H5.5a4 4 0 010-8h5V3z"
                          fill="currentColor"
                        />
                      </svg>
                    </button>
                  </div>

                  <span class="ps-bar-sep" />

                  <!-- Zoom Scale Selector -->
                  <div class="ps-option-group">
                    <button
                      type="button"
                      class="ps-icon-btn"
                      title="Zoom Out (-)"
                      @click="psArtboardZoom = Math.max(50, psArtboardZoom - 15)"
                    >
                      <svg viewBox="0 0 16 16" class="ps-svg-icon">
                        <path d="M3 7.25h10v1.5H3z" fill="currentColor" />
                      </svg>
                    </button>
                    <span class="ps-zoom-readout" @click="psArtboardZoom = 100">
                      {{ psArtboardZoom }}%
                    </span>
                    <button
                      type="button"
                      class="ps-icon-btn"
                      title="Zoom In (+)"
                      @click="psArtboardZoom = Math.min(130, psArtboardZoom + 15)"
                    >
                      <svg viewBox="0 0 16 16" class="ps-svg-icon">
                        <path
                          d="M7.25 3h1.5v4.25H13v1.5H8.75V13h-1.5V8.75H3v-1.5h4.25V3z"
                          fill="currentColor"
                        />
                      </svg>
                    </button>
                  </div>

                  <span class="ps-bar-sep" />

                  <!-- View Guides, Rulers, Snap & Backdrop Icon Toggles -->
                  <div class="ps-option-group">
                    <button
                      type="button"
                      class="ps-icon-btn"
                      :class="{ active: psShowRulers }"
                      :title="t('gameNodes.uiContainer.psToolRuler')"
                      @click="psShowRulers = !psShowRulers"
                    >
                      <svg viewBox="0 0 16 16" class="ps-svg-icon">
                        <path
                          d="M1 2h14v4H1V2zm2 1v2h1V3H3zm3 0v1.5h1V3H6zm3 0v2h1V3H9zm3 0v1.5h1V3h-1zM1 8h4v6H1V8z"
                          fill="currentColor"
                        />
                      </svg>
                    </button>
                    <button
                      type="button"
                      class="ps-icon-btn"
                      :class="{ active: psShowSliceGuides }"
                      :title="t('gameNodes.uiContainer.psToolSlice')"
                      @click="psShowSliceGuides = !psShowSliceGuides"
                    >
                      <svg viewBox="0 0 16 16" class="ps-svg-icon">
                        <path
                          d="M5 1v14h1.2V1H5zm4.8 0v14H11V1H9.8zM1 5h14v1.2H1V5zm0 4.8h14V11H1V9.8z"
                          fill="currentColor"
                        />
                      </svg>
                    </button>
                    <button
                      type="button"
                      class="ps-icon-btn"
                      :class="{ active: psSnapGrid }"
                      :title="t('gameNodes.uiContainer.psToolSnap')"
                      @click="psSnapGrid = !psSnapGrid"
                    >
                      <svg viewBox="0 0 16 16" class="ps-svg-icon">
                        <path
                          d="M4 2h2.5v4.5a1.5 1.5 0 003 0V2H12v4.5a4 4 0 01-8 0V2zm0 9.5h8V13H4v-1.5z"
                          fill="currentColor"
                        />
                      </svg>
                    </button>
                    <button
                      type="button"
                      class="ps-icon-btn"
                      title="Cycle Artboard Backdrop (Dark / Checker / Grid)"
                      @click="cyclePsBackdrop"
                    >
                      <svg viewBox="0 0 16 16" class="ps-svg-icon">
                        <path
                          d="M2 2h4v4H2V2zm4 4h4v4H6V6zm4-4h4v4h-4V2zM2 10h4v4H2v-4zm8 0h4v4h-4v-4z"
                          fill="currentColor"
                        />
                      </svg>
                    </button>
                  </div>

                  <span class="ps-bar-sep" />

                  <!-- 6-Way Layer Alignment Toolbar -->
                  <div class="ps-option-group">
                    <button
                      type="button"
                      class="ps-icon-btn"
                      :disabled="!psSelectedLayer || psSelectedLayer.locked"
                      :title="t('gameNodes.uiContainer.psAlignLeft')"
                      @click="alignSelectedPsLayer('left')"
                    >
                      <svg viewBox="0 0 16 16" class="ps-svg-icon">
                        <path
                          d="M2 2h1.5v12H2V2zm3 2.5h8v3H5v-3zm0 5h5.5v3H5v-3z"
                          fill="currentColor"
                        />
                      </svg>
                    </button>
                    <button
                      type="button"
                      class="ps-icon-btn"
                      :disabled="!psSelectedLayer || psSelectedLayer.locked"
                      :title="t('gameNodes.uiContainer.psAlignCenterH')"
                      @click="alignSelectedPsLayer('center-h')"
                    >
                      <svg viewBox="0 0 16 16" class="ps-svg-icon">
                        <path
                          d="M7.25 1.5h1.5v13h-1.5v-13zM3 4.5h10v2.5H3V4.5zm2 4.5h6v2.5H5V9z"
                          fill="currentColor"
                        />
                      </svg>
                    </button>
                    <button
                      type="button"
                      class="ps-icon-btn"
                      :disabled="!psSelectedLayer || psSelectedLayer.locked"
                      :title="t('gameNodes.uiContainer.psAlignRight')"
                      @click="alignSelectedPsLayer('right')"
                    >
                      <svg viewBox="0 0 16 16" class="ps-svg-icon">
                        <path
                          d="M12.5 2H14v12h-1.5V2zM3 4.5h8v3H3v-3zm2.5 5H11v3H5.5v-3z"
                          fill="currentColor"
                        />
                      </svg>
                    </button>
                    <button
                      type="button"
                      class="ps-icon-btn"
                      :disabled="!psSelectedLayer || psSelectedLayer.locked"
                      :title="t('gameNodes.uiContainer.psAlignTop')"
                      @click="alignSelectedPsLayer('top')"
                    >
                      <svg viewBox="0 0 16 16" class="ps-svg-icon">
                        <path
                          d="M2 2h12v1.5H2V2zm2.5 3h3v8h-3V5zm5 0h3v5.5h-3V5z"
                          fill="currentColor"
                        />
                      </svg>
                    </button>
                    <button
                      type="button"
                      class="ps-icon-btn"
                      :disabled="!psSelectedLayer || psSelectedLayer.locked"
                      :title="t('gameNodes.uiContainer.psAlignCenterV')"
                      @click="alignSelectedPsLayer('center-v')"
                    >
                      <svg viewBox="0 0 16 16" class="ps-svg-icon">
                        <path
                          d="M1.5 7.25h13v1.5h-13v-1.5zM4.5 3h2.5v10H4.5V3zm4.5 2h2.5v6H9V5z"
                          fill="currentColor"
                        />
                      </svg>
                    </button>
                    <button
                      type="button"
                      class="ps-icon-btn"
                      :disabled="!psSelectedLayer || psSelectedLayer.locked"
                      :title="t('gameNodes.uiContainer.psAlignBottom')"
                      @click="alignSelectedPsLayer('bottom')"
                    >
                      <svg viewBox="0 0 16 16" class="ps-svg-icon">
                        <path
                          d="M2 12.5h12V14H2v-1.5zM4.5 3h3v8h-3V3zm5 2.5h3V11h-3V5.5z"
                          fill="currentColor"
                        />
                      </svg>
                    </button>
                  </div>

                  <span class="ps-cursor-xy-badge">
                    {{ activeArtboardResolution.width }}×{{ activeArtboardResolution.height }} ·
                    X:{{ psCursorArtboardPx.x }} Y:{{ psCursorArtboardPx.y }}
                  </span>
                </div>

                <!-- 3-Column Photoshop Workspace: Left Icon Tool Dock · Center Rulers & Artboard · Right Layers Stack -->
                <div class="ps-workspace-body">
                  <!-- 1. Left PS Widget & Tool Icon Dock ("控件用图标" — 20 Specialized Game UI Primitives & Widgets) -->
                  <aside class="ps-left-tool-dock">
                    <button
                      type="button"
                      class="ps-dock-icon-btn"
                      :class="{ active: psActiveTool === 'move' }"
                      :title="t('gameNodes.uiContainer.psToolMove')"
                      @click="psActiveTool = 'move'"
                    >
                      <svg viewBox="0 0 16 16" class="ps-svg-icon">
                        <path
                          d="M3 1.5l9.5 6.2-4.1.9 1.9 4.2-1.6.7-1.9-4.2L4 12V1.5z"
                          fill="currentColor"
                        />
                      </svg>
                    </button>
                    <button
                      type="button"
                      class="ps-dock-icon-btn"
                      :class="{ active: psShowSliceGuides }"
                      :title="t('gameNodes.uiContainer.psToolSlice')"
                      @click="psShowSliceGuides = !psShowSliceGuides"
                    >
                      <svg viewBox="0 0 16 16" class="ps-svg-icon">
                        <path
                          d="M5 1v14h1.3V1H5zm4.7 0v14H11V1H9.7zM1 5h14v1.3H1V5zm0 4.7h14V11H1V9.7z"
                          fill="currentColor"
                        />
                      </svg>
                    </button>

                    <span class="ps-dock-divider" />

                    <!-- 20 UI Control & Primitive Spawn Icon Buttons -->
                    <button
                      v-for="wItem in psWidgetCatalog"
                      :key="wItem.kind"
                      type="button"
                      class="ps-dock-icon-btn widget-spawn"
                      :title="t(wItem.titleKey)"
                      @click="spawnPsArtboardWidget(wItem.kind)"
                    >
                      <!-- Vector SVG icon per UI widget / primitive category -->
                      <svg
                        v-if="wItem.kind === 'text_label'"
                        viewBox="0 0 16 16"
                        class="ps-svg-icon"
                      >
                        <path
                          d="M2.5 2.5h11v2.8h-1.6V4.1H8.8v8.3h1.8V14H5.4v-1.6h1.8V4.1H4.1v1.2H2.5V2.5z"
                          fill="#fde047"
                        />
                      </svg>
                      <svg
                        v-else-if="wItem.kind === 'panel_box'"
                        viewBox="0 0 16 16"
                        class="ps-svg-icon"
                      >
                        <path
                          d="M2 3a1 1 0 011-1h10a1 1 0 011 1v10a1 1 0 01-1 1H3a1 1 0 01-1-1V3zm1.5.5v9h9v-9h-9zm1.2 1.2h6.6v1.5H4.7V4.7z"
                          fill="#38bdf8"
                        />
                      </svg>
                      <svg
                        v-else-if="wItem.kind === 'custom_image'"
                        viewBox="0 0 16 16"
                        class="ps-svg-icon"
                      >
                        <path
                          d="M2 2.5A1.5 1.5 0 013.5 1h9A1.5 1.5 0 0114 2.5v11a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 012 13.5v-11zm1.5.5v6.8l2.4-2.4 2.2 2.2 2.6-2.6 1.8 1.8V3h-9zm2.2 1.5a1.2 1.2 0 110 2.4 1.2 1.2 0 010-2.4z"
                          fill="#4ade80"
                        />
                      </svg>
                      <svg
                        v-else-if="wItem.kind === 'currency_bar'"
                        viewBox="0 0 16 16"
                        class="ps-svg-icon"
                      >
                        <path
                          d="M8 1.5a6.5 6.5 0 100 13 6.5 6.5 0 000-13zm.75 3v1.1c1.1.2 1.8.8 1.9 1.7h-1.4c-.1-.4-.5-.7-1.2-.7-.7 0-1.1.3-1.1.7 0 .4.4.6 1.4.8 1.5.3 2.4.8 2.4 2 0 1-.7 1.7-1.9 1.9v1.1h-1.5V12c-1.2-.2-2-.9-2.1-1.9h1.4c.1.5.6.8 1.4.8.8 0 1.2-.3 1.2-.8 0-.4-.4-.7-1.5-.9-1.4-.3-2.3-.8-2.3-1.9 0-1 .7-1.6 1.9-1.8V4.5h1.5z"
                          fill="#facc15"
                        />
                      </svg>
                      <svg
                        v-else-if="wItem.kind === 'buff_icons'"
                        viewBox="0 0 16 16"
                        class="ps-svg-icon"
                      >
                        <path d="M9.5 1.5L3 9h4.5l-1 5.5L13 7H8.5l1-5.5z" fill="#38bdf8" />
                      </svg>
                      <svg
                        v-else-if="wItem.kind === 'key_prompt'"
                        viewBox="0 0 16 16"
                        class="ps-svg-icon"
                      >
                        <path
                          d="M3 2.5h10A1.5 1.5 0 0114.5 4v8a1.5 1.5 0 01-1.5 1.5H3A1.5 1.5 0 011.5 12V4A1.5 1.5 0 013 2.5zm3 2.5v6h1.5V8.8h2.5V7.4H7.5V6.4h3V5H6z"
                          fill="#f8fafc"
                        />
                      </svg>
                      <svg
                        v-else-if="wItem.kind === 'radial_wheel'"
                        viewBox="0 0 16 16"
                        class="ps-svg-icon"
                      >
                        <path
                          d="M8 1a7 7 0 100 14A7 7 0 008 1zm0 2.2a4.8 4.8 0 014.4 2.9L9.8 7.2a2 2 0 00-3.6 0L3.6 6.1A4.8 4.8 0 018 3.2zm0 9.6a4.8 4.8 0 01-4.4-2.9l2.6-1.1a2 2 0 003.6 0l2.6 1.1a4.8 4.8 0 01-4.4 2.9z"
                          fill="#fb7185"
                        />
                      </svg>
                      <svg
                        v-else-if="wItem.kind === 'item_slot'"
                        viewBox="0 0 16 16"
                        class="ps-svg-icon"
                      >
                        <path
                          d="M3 2h10a1 1 0 011 1v10a1 1 0 01-1 1H3a1 1 0 01-1-1V3a1 1 0 011-1zm5 2.2L4.8 8 8 11.8 11.2 8 8 4.2z"
                          fill="#c084fc"
                        />
                      </svg>
                      <svg
                        v-else-if="wItem.kind === 'tab_bar'"
                        viewBox="0 0 16 16"
                        class="ps-svg-icon"
                      >
                        <path
                          d="M1.5 4.5A1.5 1.5 0 013 3h3a1.5 1.5 0 011.5 1.5V6h7v6.5a1 1 0 01-1 1h-11a1 1 0 01-1-1v-8zm7-.5h4.5a1 1 0 011 1v.5h-5.5V4z"
                          fill="#2dd4bf"
                        />
                      </svg>
                      <svg
                        v-else-if="wItem.kind === 'avatar_medallion'"
                        viewBox="0 0 16 16"
                        class="ps-svg-icon"
                      >
                        <path
                          d="M8 1.5l4.6 1.9 1.9 4.6-1.9 4.6L8 14.5l-4.6-1.9L1.5 8l1.9-4.6L8 1.5zm0 3a2.2 2.2 0 100 4.4 2.2 2.2 0 000-4.4zm0 5.4c-1.8 0-3.3.9-3.6 2.1h7.2c-.3-1.2-1.8-2.1-3.6-2.1z"
                          fill="currentColor"
                        />
                      </svg>
                      <svg
                        v-else-if="wItem.kind === 'hp_bar'"
                        viewBox="0 0 16 16"
                        class="ps-svg-icon"
                      >
                        <path
                          d="M1 5a2 2 0 012-2h10a2 2 0 012 2v6a2 2 0 01-2 2H3a2 2 0 01-2-2V5zm2 .5v5h7.5v-5H3z"
                          fill="#f43f5e"
                        />
                      </svg>
                      <svg
                        v-else-if="wItem.kind === 'shield_bar'"
                        viewBox="0 0 16 16"
                        class="ps-svg-icon"
                      >
                        <path
                          d="M8 1.5l5.5 2v4.2c0 3.4-2.3 5.9-5.5 6.8-3.2-.9-5.5-3.4-5.5-6.8V3.5l5.5-2z"
                          fill="#38bdf8"
                        />
                      </svg>
                      <svg
                        v-else-if="wItem.kind === 'boss_bar'"
                        viewBox="0 0 16 16"
                        class="ps-svg-icon"
                      >
                        <path
                          d="M2 3l3 2.5L8 2l3 3.5L14 3l-1 6H3L2 3zm-1 8h14v2.5H1V11z"
                          fill="#fb923c"
                        />
                      </svg>
                      <svg
                        v-else-if="wItem.kind === 'minimap_compass'"
                        viewBox="0 0 16 16"
                        class="ps-svg-icon"
                      >
                        <path
                          d="M8 1.5a6.5 6.5 0 100 13 6.5 6.5 0 000-13zm2.8 3.7l-1.6 4-4 1.6 1.6-4 4-1.6z"
                          fill="#facc15"
                        />
                      </svg>
                      <svg
                        v-else-if="wItem.kind === 'skill_bar'"
                        viewBox="0 0 16 16"
                        class="ps-svg-icon"
                      >
                        <path
                          d="M1.5 4.5h3v3h-3v-3zm4.3 0h3v3h-3v-3zm4.4 0h3v3h-3v-3zM1.5 9h3v3h-3V9zm4.3 0h3v3h-3V9zm4.4 0h3v3h-3V9z"
                          fill="#a78bfa"
                        />
                      </svg>
                      <svg
                        v-else-if="wItem.kind === 'foil_card'"
                        viewBox="0 0 16 16"
                        class="ps-svg-icon"
                      >
                        <path
                          d="M3.5 1.5h9a1.5 1.5 0 011.5 1.5v10a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 012 13V3a1.5 1.5 0 011.5-1.5zm1.5 2v5h6v-5H5zm0 6.5v2h6v-2H5z"
                          fill="#e879f9"
                        />
                      </svg>
                      <svg
                        v-else-if="wItem.kind === 'inventory_grid'"
                        viewBox="0 0 16 16"
                        class="ps-svg-icon"
                      >
                        <path
                          d="M2 2h3.5v3.5H2V2zm4.25 0h3.5v3.5h-3.5V2zM10.5 2H14v3.5h-3.5V2zM2 6.25h3.5v3.5H2v-3.5zm4.25 0h3.5v3.5h-3.5v-3.5zm4.25 0H14v3.5h-3.5v-3.5zM2 10.5h3.5V14H2v-3.5zm4.25 0h3.5V14h-3.5v-3.5zm4.25 0H14V14h-3.5v-3.5z"
                          fill="#34d399"
                        />
                      </svg>
                      <svg
                        v-else-if="wItem.kind === 'dialogue_box'"
                        viewBox="0 0 16 16"
                        class="ps-svg-icon"
                      >
                        <path
                          d="M2 3a1.5 1.5 0 011.5-1.5h9A1.5 1.5 0 0114 3v6.5a1.5 1.5 0 01-1.5 1.5H6.2l-2.7 2.5V11H3.5A1.5 1.5 0 012 9.5V3z"
                          fill="#60a5fa"
                        />
                      </svg>
                      <svg
                        v-else-if="wItem.kind === 'settings_panel'"
                        viewBox="0 0 16 16"
                        class="ps-svg-icon"
                      >
                        <path
                          d="M2 3.5h8v1.5H2V3.5zm9-.75h2v3h-2v-3zM2 7.25h4v1.5H2v-1.5zm5-.75h2v3H7v-3zm3 .75h4v1.5h-4v-1.5zM2 11h7v1.5H2V11zm8-.75h2v3h-2v-3z"
                          fill="#94a3b8"
                        />
                      </svg>
                      <svg v-else viewBox="0 0 16 16" class="ps-svg-icon">
                        <path
                          d="M2 4.5A2.5 2.5 0 014.5 2h7A2.5 2.5 0 0114 4.5v7a2.5 2.5 0 01-2.5 2.5h-7A2.5 2.5 0 012 11.5v-7zm3 2.5v2h6V7H5z"
                          fill="#fcd34d"
                        />
                      </svg>
                    </button>
                  </aside>

                  <!-- 2. Center PS Artboard Stage with Pixel Rulers & 8-Handle Layer Transform -->
                  <div class="ps-center-viewport">
                    <!-- Top Horizontal Pixel Ruler -->
                    <div v-if="psShowRulers" class="ps-ruler-horizontal">
                      <div class="ps-ruler-corner">px</div>
                      <div class="ps-ruler-track-h">
                        <span
                          v-for="tick in psHorizontalRulerTicks"
                          :key="tick.px"
                          class="ps-ruler-tick-h"
                          :style="{ left: `${tick.pct}%` }"
                        >
                          {{ tick.px }}
                        </span>
                        <div
                          class="ps-ruler-cursor-h"
                          :style="{
                            left: `${(psCursorArtboardPx.x / activeArtboardResolution.width) * 100}%`
                          }"
                        />
                      </div>
                    </div>

                    <div class="ps-ruler-and-canvas-row">
                      <!-- Left Vertical Pixel Ruler -->
                      <div v-if="psShowRulers" class="ps-ruler-vertical">
                        <span
                          v-for="tick in psVerticalRulerTicks"
                          :key="tick.px"
                          class="ps-ruler-tick-v"
                          :style="{ top: `${tick.pct}%` }"
                        >
                          {{ tick.px }}
                        </span>
                        <div
                          class="ps-ruler-cursor-v"
                          :style="{
                            top: `${(psCursorArtboardPx.y / activeArtboardResolution.height) * 100}%`
                          }"
                        />
                      </div>

                      <!-- Scrollable / Zoomable Artboard Desk -->
                      <div class="ps-artboard-desk" @pointerdown.self="psSelectedLayerId = ''">
                        <!-- The Photoshop Artboard Paper -->
                        <div
                          ref="psArtboardCanvasRef"
                          class="ps-artboard-paper"
                          :class="[`backdrop-${psCanvasBackdrop}`]"
                          :style="psArtboardPaperStyle"
                          @pointerdown.self="psSelectedLayerId = ''"
                        >
                          <!-- 5% Title-Safe Cyan Guide Frame -->
                          <div v-if="psShowRulers" class="ps-safe-zone-guide">
                            <div class="ps-center-crosshair-h" />
                            <div class="ps-center-crosshair-v" />
                          </div>

                          <!-- Dynamic Smart Alignment Guides (Magenta Snap Lines) -->
                          <template v-for="(sg, sgIdx) in psActiveSmartGuides" :key="`sg-${sgIdx}`">
                            <div
                              v-if="sg.axis === 'x'"
                              class="ps-smart-guide-v"
                              :style="{
                                left: `${(sg.px / activeArtboardResolution.width) * 100}%`
                              }"
                            />
                            <div
                              v-else
                              class="ps-smart-guide-h"
                              :style="{
                                top: `${(sg.px / activeArtboardResolution.height) * 100}%`
                              }"
                            />
                          </template>

                          <!-- Render Artboard Layers (bottom to top) -->
                          <template v-for="layer in psRenderOrderedLayers" :key="layer.id">
                            <div
                              v-if="layer.visible"
                              class="ps-artboard-layer"
                              :class="{
                                selected: psSelectedLayerId === layer.id,
                                locked: layer.locked
                              }"
                              :style="computePsLayerBoxStyle(layer)"
                              @pointerdown.stop="onPsLayerPointerDown($event, layer)"
                            >
                              <!-- Primitive A: Freeform Text / Title / Counter Layer -->
                              <div
                                v-if="layer.kind === 'text_label'"
                                class="ps-widget-fill ps-freeform-text-widget"
                                :style="{
                                  color: layer.textColor || '#fef08a',
                                  fontSize: `${Math.max(10, Math.round((layer.fontSize ?? 36) * 0.42))}px`
                                }"
                              >
                                <span class="ps-freeform-main-text">
                                  {{ layer.customText || layer.name }}
                                </span>
                                <small v-if="layer.subText" class="ps-freeform-sub-text">
                                  {{ layer.subText }}
                                </small>
                              </div>

                              <!-- Primitive B: Freeform 9-Slice Window / Container Panel Box -->
                              <div
                                v-else-if="layer.kind === 'panel_box'"
                                class="ps-widget-fill ps-freeform-panel-widget"
                                :style="{
                                  backgroundColor: layer.bgColor || 'rgba(12, 16, 28, 0.86)',
                                  borderColor: layer.accentColor || '#eab308',
                                  borderRadius: `${layer.borderRadius ?? 10}px`
                                }"
                              >
                                <div
                                  v-if="layer.customText"
                                  class="ps-panel-box-header"
                                  :style="{
                                    color: layer.textColor || '#fef08a',
                                    borderBottomColor: layer.accentColor || 'rgba(234, 179, 8, 0.4)'
                                  }"
                                >
                                  {{ layer.customText }}
                                </div>
                                <div v-if="layer.subText" class="ps-panel-box-body">
                                  {{ layer.subText }}
                                </div>
                              </div>

                              <!-- Primitive C: Custom Image / Icon Layer -->
                              <div
                                v-else-if="layer.kind === 'custom_image'"
                                class="ps-widget-fill ps-custom-image-widget"
                                :style="{
                                  borderRadius: `${layer.borderRadius ?? 8}px`,
                                  border: layer.accentColor
                                    ? `2px solid ${layer.accentColor}`
                                    : 'none'
                                }"
                              >
                                <img
                                  :src="
                                    layer.customImageUrl ||
                                    pbrPrimaryImageUrl ||
                                    uiFullScreenAssets.raritySlotUrl
                                  "
                                  alt=""
                                  class="ps-widget-img contain"
                                  draggable="false"
                                />
                                <span
                                  v-if="layer.customText"
                                  class="ps-custom-image-caption"
                                  :style="{ color: layer.textColor || '#f8fafc' }"
                                >
                                  {{ layer.customText }}
                                </span>
                              </div>

                              <!-- Widget D: Top Currency / Stamina Resource Pill Bar -->
                              <div
                                v-else-if="layer.kind === 'currency_bar'"
                                class="ps-widget-fill ps-currency-bar-widget"
                              >
                                <div
                                  v-for="(cItem, cIdx) in layer.customText
                                    ? layer.customText.split(',')
                                    : ['🪙 12,480', '💎 360', '⚡ 120/120']"
                                  :key="cIdx"
                                  class="ps-currency-pill"
                                  :style="{
                                    borderColor: layer.accentColor || 'rgba(250, 204, 21, 0.45)',
                                    color: layer.textColor || '#fef08a'
                                  }"
                                >
                                  <span>{{ cItem.trim() }}</span>
                                  <b class="ps-currency-plus">+</b>
                                </div>
                              </div>

                              <!-- Widget E: Status Buff / Debuff Icon Row -->
                              <div
                                v-else-if="layer.kind === 'buff_icons'"
                                class="ps-widget-fill ps-buff-row-widget"
                              >
                                <div
                                  v-for="(bLabel, bIdx) in layer.customText
                                    ? layer.customText.split(',')
                                    : ['🔥+25%', '🛡️×3', '⚡12s', '☠️4s']"
                                  :key="bIdx"
                                  class="ps-buff-cell"
                                  :style="{ borderColor: layer.accentColor || '#38bdf8' }"
                                >
                                  <img
                                    :src="layer.customImageUrl || uiFullScreenAssets.raritySlotUrl"
                                    alt=""
                                  />
                                  <small :style="{ color: layer.textColor || '#fef08a' }">
                                    {{ bLabel.trim() }}
                                  </small>
                                </div>
                              </div>

                              <!-- Widget F: Keycap / Gamepad Interaction Prompt -->
                              <div
                                v-else-if="layer.kind === 'key_prompt'"
                                class="ps-widget-fill ps-key-prompt-widget"
                              >
                                <span
                                  class="ps-keycap-box"
                                  :style="{
                                    borderColor: layer.accentColor || '#facc15',
                                    color: layer.textColor || '#fef08a'
                                  }"
                                >
                                  {{ layer.subText || 'F' }}
                                </span>
                                <span
                                  class="ps-keyprompt-label"
                                  :style="{ color: layer.textColor || '#f8fafc' }"
                                >
                                  {{ layer.customText || 'INTERACT / PICK UP' }}
                                </span>
                              </div>

                              <!-- Widget G: 8-Sector Radial Action Wheel -->
                              <div v-else-if="layer.kind === 'radial_wheel'" class="ps-widget-fill">
                                <img
                                  :src="layer.customImageUrl || uiFullScreenAssets.actionWheelUrl"
                                  alt=""
                                  class="ps-widget-img contain"
                                  draggable="false"
                                />
                                <span
                                  class="ps-wheel-center-pill"
                                  :style="{ color: layer.textColor || '#fef08a' }"
                                >
                                  {{ layer.customText || '⚔️ WHEEL' }}
                                </span>
                              </div>

                              <!-- Widget H: Standalone Equipment / Skill Tree Node Slot -->
                              <div
                                v-else-if="layer.kind === 'item_slot'"
                                class="ps-widget-fill ps-item-slot-widget"
                                :style="{
                                  backgroundColor: layer.bgColor || undefined,
                                  borderRadius:
                                    layer.borderRadius !== undefined
                                      ? `${layer.borderRadius}px`
                                      : undefined,
                                  border: layer.accentColor
                                    ? `2px solid ${layer.accentColor}`
                                    : undefined
                                }"
                              >
                                <img
                                  v-if="!layer.bgColor || layer.customImageUrl"
                                  :src="layer.customImageUrl || uiFullScreenAssets.raritySlotUrl"
                                  alt=""
                                  class="ps-widget-img contain"
                                  draggable="false"
                                />
                                <span
                                  v-if="layer.subText"
                                  class="ps-slot-top-badge"
                                  :style="{ color: layer.accentColor || '#38bdf8' }"
                                >
                                  {{ layer.subText }}
                                </span>
                                <span
                                  v-if="layer.customText"
                                  class="ps-avatar-lv-pill"
                                  :style="{ color: layer.textColor || '#fef08a' }"
                                >
                                  {{ layer.customText }}
                                </span>
                              </div>

                              <!-- Widget I: Multi-Tab Navigation Bar -->
                              <div
                                v-else-if="layer.kind === 'tab_bar'"
                                class="ps-widget-fill ps-tab-bar-widget"
                                :style="{
                                  backgroundColor: layer.bgColor || undefined,
                                  borderRadius:
                                    layer.borderRadius !== undefined
                                      ? `${layer.borderRadius}px`
                                      : undefined
                                }"
                              >
                                <button
                                  v-for="(tabStr, tIdx) in layer.customText
                                    ? layer.customText.split(',')
                                    : ['HERO', 'BAG', 'SKILLS', 'QUESTS', 'MAP']"
                                  :key="tIdx"
                                  type="button"
                                  class="ps-nav-tab-item"
                                  :class="{ active: tIdx === 0 }"
                                  :style="
                                    tIdx === 0
                                      ? {
                                          borderColor: layer.accentColor || '#facc15',
                                          color: layer.textColor || '#fef08a'
                                        }
                                      : undefined
                                  "
                                >
                                  {{ tabStr.trim() }}
                                </button>
                              </div>

                              <!-- Widget 1: Avatar Medallion -->
                              <div
                                v-else-if="layer.kind === 'avatar_medallion'"
                                class="ps-widget-fill"
                                :style="{
                                  backgroundColor: layer.bgColor || undefined,
                                  borderRadius:
                                    layer.borderRadius !== undefined
                                      ? `${layer.borderRadius}px`
                                      : undefined,
                                  border: layer.accentColor
                                    ? `2.5px solid ${layer.accentColor}`
                                    : undefined
                                }"
                              >
                                <img
                                  v-if="!layer.bgColor || layer.customImageUrl"
                                  :src="
                                    layer.customImageUrl || uiFullScreenAssets.portraitMedallionUrl
                                  "
                                  alt=""
                                  class="ps-widget-img contain"
                                  draggable="false"
                                />
                                <span
                                  class="ps-avatar-lv-pill"
                                  :style="{
                                    color: layer.textColor || '#facc15',
                                    borderColor: layer.accentColor || '#facc15'
                                  }"
                                >
                                  {{ layer.customText || 'LV.60' }}
                                </span>
                              </div>

                              <!-- Widget 2: HP Bar (Supports both Procedural Texture & Parametric Vector Skin) -->
                              <div
                                v-else-if="layer.kind === 'hp_bar'"
                                class="ps-widget-fill"
                                @click.stop="triggerHudDamage(20)"
                              >
                                <div
                                  v-if="
                                    layer.bgColor ||
                                    layer.accentColor ||
                                    layer.borderRadius !== undefined
                                  "
                                  class="ps-parametric-bar-track"
                                  :style="{
                                    backgroundColor: layer.bgColor || 'rgba(9, 10, 18, 0.88)',
                                    borderColor: layer.accentColor || '#f43f5e',
                                    borderRadius: `${layer.borderRadius ?? 8}px`
                                  }"
                                >
                                  <div
                                    class="ps-parametric-bar-fill"
                                    :style="{
                                      width: `${Math.max(0, Math.min(100, layer.valuePct ?? uiHudCurrentHp))}%`,
                                      background:
                                        layer.accentColor ||
                                        'linear-gradient(90deg, #be123c, #fb7185)'
                                    }"
                                  />
                                </div>
                                <template v-else>
                                  <img
                                    :src="uiFullScreenAssets.hpBackplateUrl"
                                    alt=""
                                    class="ui-hud-layer"
                                  />
                                  <img
                                    :src="uiFullScreenAssets.hpFillUrl"
                                    alt=""
                                    class="ui-hud-layer ui-hud-trail-layer"
                                    :style="
                                      computeHudBarClipStyle(
                                        Math.max(layer.valuePct ?? uiHudCurrentHp, uiHudTrailHp)
                                      )
                                    "
                                  />
                                  <img
                                    :src="uiFullScreenAssets.hpFillUrl"
                                    alt=""
                                    class="ui-hud-layer ui-hud-fill-layer"
                                    :style="
                                      computeHudBarClipStyle(layer.valuePct ?? uiHudCurrentHp)
                                    "
                                  />
                                  <img
                                    :src="uiFullScreenAssets.hpFrameUrl"
                                    alt=""
                                    class="ui-hud-layer"
                                  />
                                </template>
                                <span
                                  class="hud-bar-text"
                                  :style="{ color: layer.textColor || '#ffffff' }"
                                >
                                  {{
                                    layer.customText ||
                                    `HP ${Math.round((layer.valuePct ?? uiHudCurrentHp) * 10)} / 1000`
                                  }}
                                </span>
                              </div>

                              <!-- Widget 3: Shield / Mana Bar (Supports both Procedural Texture & Parametric Vector Skin) -->
                              <div
                                v-else-if="layer.kind === 'shield_bar'"
                                class="ps-widget-fill"
                                @click.stop="triggerHudHeal(25)"
                              >
                                <div
                                  v-if="
                                    layer.bgColor ||
                                    layer.accentColor ||
                                    layer.borderRadius !== undefined
                                  "
                                  class="ps-parametric-bar-track"
                                  :style="{
                                    backgroundColor: layer.bgColor || 'rgba(9, 10, 18, 0.88)',
                                    borderColor: layer.accentColor || '#38bdf8',
                                    borderRadius: `${layer.borderRadius ?? 8}px`
                                  }"
                                >
                                  <div
                                    class="ps-parametric-bar-fill"
                                    :style="{
                                      width: `${Math.max(0, Math.min(100, layer.valuePct ?? 84))}%`,
                                      background:
                                        layer.accentColor ||
                                        'linear-gradient(90deg, #0284c7, #38bdf8)'
                                    }"
                                  />
                                </div>
                                <template v-else>
                                  <img
                                    :src="uiFullScreenAssets.hpBackplateUrl"
                                    alt=""
                                    class="ui-hud-layer"
                                  />
                                  <img
                                    :src="uiFullScreenAssets.shieldFillUrl"
                                    alt=""
                                    class="ui-hud-layer ui-hud-fill-layer"
                                    :style="computeHudBarClipStyle(layer.valuePct ?? 84)"
                                  />
                                  <img
                                    :src="uiFullScreenAssets.hpFrameUrl"
                                    alt=""
                                    class="ui-hud-layer"
                                  />
                                </template>
                                <span
                                  class="hud-bar-text"
                                  :style="{ color: layer.textColor || '#ffffff' }"
                                >
                                  {{
                                    layer.customText ||
                                    `SHIELD ${Math.round((layer.valuePct ?? 84) * 10)} / 1000`
                                  }}
                                </span>
                              </div>

                              <!-- Widget 4: Boss Health Bar -->
                              <div
                                v-else-if="layer.kind === 'boss_bar'"
                                class="ps-widget-fill ps-boss-widget"
                                @click.stop="triggerHudDamage(15)"
                              >
                                <span
                                  class="boss-title-label"
                                  :style="{ color: layer.textColor || '#fda4af' }"
                                >
                                  {{ layer.customText || '🔥 MALAKOR, ASHEN SOVEREIGN' }}
                                </span>
                                <div class="ps-boss-bar-inner">
                                  <div
                                    v-if="
                                      layer.bgColor ||
                                      layer.accentColor ||
                                      layer.borderRadius !== undefined
                                    "
                                    class="ps-parametric-bar-track"
                                    :style="{
                                      backgroundColor: layer.bgColor || 'rgba(9, 10, 18, 0.88)',
                                      borderColor: layer.accentColor || '#eab308',
                                      borderRadius: `${layer.borderRadius ?? 8}px`
                                    }"
                                  >
                                    <div
                                      class="ps-parametric-bar-fill"
                                      :style="{
                                        width: `${Math.max(0, Math.min(100, layer.valuePct ?? uiHudCurrentHp))}%`,
                                        background:
                                          layer.accentColor ||
                                          'linear-gradient(90deg, #b91c1c, #f97316)'
                                      }"
                                    />
                                  </div>
                                  <template v-else>
                                    <img
                                      :src="uiFullScreenAssets.hpBackplateUrl"
                                      alt=""
                                      class="ui-hud-layer"
                                    />
                                    <img
                                      :src="uiFullScreenAssets.hpFillUrl"
                                      alt=""
                                      class="ui-hud-layer ui-hud-trail-layer"
                                      :style="
                                        computeHudBarClipStyle(
                                          Math.max(layer.valuePct ?? uiHudCurrentHp, uiHudTrailHp)
                                        )
                                      "
                                    />
                                    <img
                                      :src="uiFullScreenAssets.hpFillUrl"
                                      alt=""
                                      class="ui-hud-layer ui-hud-fill-layer"
                                      :style="
                                        computeHudBarClipStyle(layer.valuePct ?? uiHudCurrentHp)
                                      "
                                    />
                                    <img
                                      :src="uiFullScreenAssets.hpFrameUrl"
                                      alt=""
                                      class="ui-hud-layer"
                                    />
                                  </template>
                                </div>
                              </div>

                              <!-- Widget 5: 360° Minimap & Compass -->
                              <div
                                v-else-if="layer.kind === 'minimap_compass'"
                                class="ps-widget-fill"
                              >
                                <img
                                  :src="layer.customImageUrl || uiFullScreenAssets.minimapUrl"
                                  alt=""
                                  class="ps-widget-img contain"
                                  draggable="false"
                                />
                                <span
                                  class="ps-compass-badge"
                                  :style="{
                                    color: layer.textColor || '#facc15',
                                    borderColor: layer.accentColor || 'rgba(250, 204, 21, 0.55)'
                                  }"
                                >
                                  {{ layer.customText || 'N 024°' }}
                                </span>
                              </div>

                              <!-- Widget 6: 4-Slot Radial Cooldown Skill Bar -->
                              <div
                                v-else-if="layer.kind === 'skill_bar'"
                                class="ps-skill-bar-widget"
                              >
                                <div
                                  v-for="(hk, sIdx) in (layer.customText
                                    ? layer.customText.split(',')
                                    : ['Q', 'E', 'R', 'SPACE']
                                  ).slice(0, 4)"
                                  :key="sIdx"
                                  class="ps-skill-slot-item"
                                  @click.stop="triggerSkillCooldown(sIdx)"
                                >
                                  <img
                                    :src="layer.customImageUrl || uiFullScreenAssets.skillSlotUrl"
                                    alt=""
                                    class="ps-widget-img contain"
                                    draggable="false"
                                  />
                                  <div
                                    v-if="uiSkillCooldowns[sIdx] > 0"
                                    class="ui-radial-cd-sweep"
                                    :style="{
                                      background: `conic-gradient(rgba(9, 10, 18, 0.82) ${Math.round(uiSkillCooldowns[sIdx] * 3.6)}deg, transparent 0deg)`
                                    }"
                                  >
                                    <b>{{ (uiSkillCooldowns[sIdx] * 0.05).toFixed(1) }}s</b>
                                  </div>
                                  <span
                                    class="hud-hotkey-pill"
                                    :style="{ color: layer.textColor || '#facc15' }"
                                  >
                                    {{ hk.trim() }}
                                  </span>
                                </div>
                              </div>

                              <!-- Widget 7: 3D Foil Card Frame -->
                              <div
                                v-else-if="layer.kind === 'foil_card'"
                                class="ps-widget-fill"
                                :style="{
                                  backgroundColor: layer.bgColor || undefined,
                                  borderRadius:
                                    layer.borderRadius !== undefined
                                      ? `${layer.borderRadius}px`
                                      : undefined,
                                  border: layer.accentColor
                                    ? `2px solid ${layer.accentColor}`
                                    : undefined
                                }"
                              >
                                <img
                                  v-if="!layer.bgColor || layer.customImageUrl"
                                  :src="layer.customImageUrl || uiFullScreenAssets.cardCompositeUrl"
                                  alt=""
                                  class="ps-widget-img fill"
                                  draggable="false"
                                />
                                <div
                                  class="ui-foil-shimmer-layer"
                                  :style="uiFoilShimmerOverlayStyle"
                                />
                                <span
                                  v-if="layer.customText"
                                  class="ps-card-overlay-title"
                                  :style="{ color: layer.textColor || '#fef08a' }"
                                >
                                  {{ layer.customText }}
                                </span>
                              </div>

                              <!-- Widget 8: RPG Inventory Grid & Tooltip -->
                              <div
                                v-else-if="layer.kind === 'inventory_grid'"
                                class="ps-inv-widget"
                                :style="{
                                  backgroundColor: layer.bgColor || 'rgba(12, 14, 24, 0.9)',
                                  borderColor: layer.accentColor || 'rgba(250, 204, 21, 0.35)',
                                  borderRadius: `${layer.borderRadius ?? 8}px`
                                }"
                              >
                                <div class="inv-tabs-row">
                                  <button
                                    v-for="(tabIcon, tIdx) in ['⚔️', '🛡️', '💍', '🧪']"
                                    :key="tIdx"
                                    type="button"
                                    class="inv-tab-btn"
                                    :class="{ active: uiSelectedBagTab === tIdx }"
                                    @click.stop="uiSelectedBagTab = tIdx"
                                  >
                                    {{ tabIcon }}
                                  </button>
                                </div>
                                <div class="ps-inv-slots-grid">
                                  <div
                                    v-for="(bagItem, bIdx) in bagMockItems"
                                    :key="bagItem.name"
                                    class="inv-grid-cell"
                                    :class="{ selected: uiSelectedBagItemIdx === bIdx }"
                                    @click.stop="uiSelectedBagItemIdx = bIdx"
                                  >
                                    <img
                                      :src="
                                        layer.customImageUrl || uiFullScreenAssets.raritySlotUrl
                                      "
                                      alt=""
                                    />
                                    <small>{{ bagItem.tag }}</small>
                                  </div>
                                </div>
                                <div class="inv-tooltip-box">
                                  <b>{{
                                    layer.customText || bagMockItems[uiSelectedBagItemIdx]?.name
                                  }}</b>
                                  <p>
                                    {{ layer.subText || bagMockItems[uiSelectedBagItemIdx]?.desc }}
                                  </p>
                                </div>
                              </div>

                              <!-- Widget 9: AVG / RPG Dialogue Box & Choices -->
                              <div
                                v-else-if="layer.kind === 'dialogue_box'"
                                class="ps-dialogue-widget"
                                :style="{
                                  backgroundColor: layer.bgColor || 'rgba(10, 12, 22, 0.92)',
                                  borderColor: layer.accentColor || 'rgba(250, 204, 21, 0.55)',
                                  borderRadius: `${layer.borderRadius ?? 8}px`
                                }"
                                @click.stop="advanceDialogueLine"
                              >
                                <div
                                  class="vn-nameplate-tab"
                                  :style="{
                                    color: layer.textColor || '#facc15',
                                    borderColor: layer.accentColor || '#facc15'
                                  }"
                                >
                                  {{ layer.subText || currentDialogueSample.speaker }}
                                </div>
                                <div class="vn-dialogue-body">
                                  <img
                                    :src="
                                      layer.customImageUrl ||
                                      uiFullScreenAssets.portraitMedallionUrl
                                    "
                                    alt=""
                                    class="vn-portrait-img"
                                    draggable="false"
                                  />
                                  <div class="vn-text-area">
                                    <p :style="{ color: layer.textColor || '#f1f5f9' }">
                                      {{ layer.customText || currentDialogueSample.line }}
                                    </p>
                                  </div>
                                  <span class="vn-bounce-cursor">▼</span>
                                </div>
                              </div>

                              <!-- Widget 10: Form Sliders & Toggle Switches -->
                              <div
                                v-else-if="layer.kind === 'settings_panel'"
                                class="ps-settings-widget"
                                :style="{
                                  backgroundColor: layer.bgColor || 'rgba(12, 14, 24, 0.92)',
                                  borderColor: layer.accentColor || 'rgba(56, 189, 248, 0.45)',
                                  borderRadius: `${layer.borderRadius ?? 10}px`
                                }"
                                @pointerdown.stop
                              >
                                <label class="settings-row">
                                  <span>{{ layer.customText || '🔊 Master' }}</span>
                                  <input
                                    v-model.number="uiFormMasterVol"
                                    type="range"
                                    min="0"
                                    max="100"
                                  />
                                  <b>{{ uiFormMasterVol }}%</b>
                                </label>
                                <label class="settings-row">
                                  <span>{{ layer.subText || '🎵 BGM' }}</span>
                                  <input
                                    v-model.number="uiFormBgmVol"
                                    type="range"
                                    min="0"
                                    max="100"
                                  />
                                  <b>{{ uiFormBgmVol }}%</b>
                                </label>
                                <div class="settings-toggles-row">
                                  <button
                                    type="button"
                                    class="settings-check-pill"
                                    :class="{ active: uiFormFullscreen }"
                                    @click.stop="uiFormFullscreen = !uiFormFullscreen"
                                  >
                                    {{ uiFormFullscreen ? '☑' : '☐' }} 16:9
                                  </button>
                                  <button
                                    type="button"
                                    class="settings-check-pill"
                                    :class="{ active: uiFormScreenShake }"
                                    @click.stop="uiFormScreenShake = !uiFormScreenShake"
                                  >
                                    {{ uiFormScreenShake ? '🟢' : '⚫' }} Shake
                                  </button>
                                </div>
                              </div>

                              <!-- Widget 11: 5-State Gamepad UI Button (Supports both Procedural Texture & Parametric Vector Skin) -->
                              <div
                                v-else
                                class="ps-widget-fill ps-ui-btn-widget"
                                :class="{
                                  'parametric-btn': Boolean(
                                    layer.bgColor ||
                                    layer.accentColor ||
                                    layer.borderRadius !== undefined
                                  )
                                }"
                                :style="
                                  layer.bgColor ||
                                  layer.accentColor ||
                                  layer.borderRadius !== undefined
                                    ? {
                                        background:
                                          layer.bgColor ||
                                          'linear-gradient(180deg, rgba(30, 41, 59, 0.95), rgba(15, 23, 42, 0.98))',
                                        border: `2px solid ${layer.accentColor || '#eab308'}`,
                                        borderRadius: `${layer.borderRadius ?? 8}px`,
                                        boxShadow:
                                          'inset 0 1px 0 rgba(255,255,255,0.22), 0 6px 16px rgba(0,0,0,0.45)'
                                      }
                                    : undefined
                                "
                                @click.stop="advanceDialogueLine"
                              >
                                <img
                                  v-if="
                                    layer.customImageUrl ||
                                    (!layer.bgColor &&
                                      !layer.accentColor &&
                                      layer.borderRadius === undefined)
                                  "
                                  :src="layer.customImageUrl || uiFullScreenAssets.squareSlotUrl"
                                  alt=""
                                  class="ps-widget-img fill"
                                  draggable="false"
                                />
                                <span
                                  class="ps-btn-label"
                                  :style="{
                                    color: layer.textColor || '#fef08a',
                                    fontSize: layer.fontSize
                                      ? `${Math.max(9, Math.round(layer.fontSize * 0.4))}px`
                                      : undefined
                                  }"
                                >
                                  {{ layer.customText || layer.name }}
                                </span>
                              </div>

                              <!-- 9-Slice Cyan Overlay Guides on Selected Layer -->
                              <div
                                v-if="psShowSliceGuides && psSelectedLayerId === layer.id"
                                class="ps-layer-slice-guides"
                              >
                                <span class="slice-v left" />
                                <span class="slice-v right" />
                                <span class="slice-h top" />
                                <span class="slice-h bottom" />
                              </div>

                              <!-- PS 8-Point Transform Bounding Box Handles & Coordinate Pill -->
                              <template v-if="psSelectedLayerId === layer.id && !layer.locked">
                                <span class="ps-transform-coord-pill">
                                  {{ Math.round(layer.x) }}, {{ Math.round(layer.y) }} ·
                                  {{ Math.round(layer.w) }}×{{ Math.round(layer.h) }}
                                </span>
                                <span
                                  v-for="dir in ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']"
                                  :key="dir"
                                  class="ps-transform-handle"
                                  :class="`handle-${dir}`"
                                  @pointerdown.stop="onPsResizeHandleDown($event, layer, dir)"
                                />
                              </template>
                            </div>
                          </template>
                        </div>
                      </div>
                    </div>
                  </div>

                  <!-- 3. Right Photoshop Layers & Transform Panel ("图层") -->
                  <aside class="ps-right-layers-dock">
                    <div class="ps-dock-section-header">
                      <svg viewBox="0 0 16 16" class="ps-svg-icon">
                        <path
                          d="M8 1.5L14.5 5 8 8.5 1.5 5 8 1.5zm0 8.8l5.3-2.8 1.2.65L8 11.6 1.5 8.15l1.2-.65L8 10.3zm0 2.7l5.3-2.8 1.2.65L8 14.3 1.5 10.85l1.2-.65L8 13z"
                          fill="currentColor"
                        />
                      </svg>
                      <span>{{ t('gameNodes.uiContainer.psLayersTitle') }}</span>
                      <small>{{ psArtboardLayers.length }}</small>
                    </div>

                    <!-- Selected Layer Blend Mode, Opacity, X/Y/W/H, Anchor Pin, Rotation & Custom Content/Style Properties -->
                    <div v-if="psSelectedLayer" class="ps-selected-layer-inspector">
                      <div class="ps-blend-opacity-row">
                        <select
                          v-model="psSelectedLayer.blendMode"
                          class="ps-blend-select"
                          @change="recordAndPersistPsArtboard"
                        >
                          <option value="normal">
                            {{ t('gameNodes.uiContainer.psBlendNormal') }}
                          </option>
                          <option value="screen">
                            {{ t('gameNodes.uiContainer.psBlendScreen') }}
                          </option>
                          <option value="multiply">
                            {{ t('gameNodes.uiContainer.psBlendMultiply') }}
                          </option>
                          <option value="overlay">
                            {{ t('gameNodes.uiContainer.psBlendOverlay') }}
                          </option>
                        </select>
                        <div
                          class="ps-opacity-box"
                          :title="t('gameNodes.uiContainer.psOpacityLabel')"
                        >
                          <input
                            v-model.number="psSelectedLayer.opacity"
                            type="number"
                            min="0"
                            max="100"
                            @change="recordAndPersistPsArtboard"
                          />
                          <span>%</span>
                        </div>
                      </div>

                      <div class="ps-xywh-grid">
                        <label>
                          <span>X</span>
                          <input
                            v-model.number="psSelectedLayer.x"
                            type="number"
                            step="4"
                            @change="recordAndPersistPsArtboard"
                          />
                        </label>
                        <label>
                          <span>Y</span>
                          <input
                            v-model.number="psSelectedLayer.y"
                            type="number"
                            step="4"
                            @change="recordAndPersistPsArtboard"
                          />
                        </label>
                        <label>
                          <span>W</span>
                          <input
                            v-model.number="psSelectedLayer.w"
                            type="number"
                            min="32"
                            step="4"
                            @change="recordAndPersistPsArtboard"
                          />
                        </label>
                        <label>
                          <span>H</span>
                          <input
                            v-model.number="psSelectedLayer.h"
                            type="number"
                            min="24"
                            step="4"
                            @change="recordAndPersistPsArtboard"
                          />
                        </label>
                      </div>

                      <!-- Custom Text, Subtext, Value%, Anchor Pin, Rotation, Colors & Image Upload -->
                      <div class="ps-custom-props-block">
                        <div class="ps-prop-line">
                          <span>{{ t('gameNodes.uiContainer.psPropText') }}</span>
                          <input
                            v-model="psSelectedLayer.customText"
                            type="text"
                            :placeholder="psSelectedLayer.name"
                            @change="recordAndPersistPsArtboard"
                          />
                        </div>
                        <div class="ps-prop-line">
                          <span>{{ t('gameNodes.uiContainer.psPropSubText') }}</span>
                          <input
                            v-model="psSelectedLayer.subText"
                            type="text"
                            placeholder="..."
                            @change="recordAndPersistPsArtboard"
                          />
                        </div>
                        <div class="ps-xywh-grid ps-prop-num-grid">
                          <label>
                            <span>{{ t('gameNodes.uiContainer.psPropValue') }}%</span>
                            <input
                              v-model.number="psSelectedLayer.valuePct"
                              type="number"
                              min="0"
                              max="100"
                              placeholder="78"
                              @change="recordAndPersistPsArtboard"
                            />
                          </label>
                          <label>
                            <span>{{ t('gameNodes.uiContainer.psPropFontSize') }}</span>
                            <input
                              v-model.number="psSelectedLayer.fontSize"
                              type="number"
                              min="10"
                              max="120"
                              placeholder="28"
                              @change="recordAndPersistPsArtboard"
                            />
                          </label>
                          <label>
                            <span>{{ t('gameNodes.uiContainer.psPropAnchor') }}</span>
                            <select
                              v-model="psSelectedLayer.anchorPreset"
                              class="ps-inline-anchor-select"
                              @change="recordAndPersistPsArtboard"
                            >
                              <option value="tl">↖ TL</option>
                              <option value="tc">↑ TC</option>
                              <option value="tr">↗ TR</option>
                              <option value="cl">← CL</option>
                              <option value="cc">✚ CC</option>
                              <option value="cr">→ CR</option>
                              <option value="bl">↙ BL</option>
                              <option value="bc">↓ BC</option>
                              <option value="br">↘ BR</option>
                            </select>
                          </label>
                          <label>
                            <span>{{ t('gameNodes.uiContainer.psPropRotate') }}</span>
                            <input
                              v-model.number="psSelectedLayer.rotationDeg"
                              type="number"
                              min="-180"
                              max="180"
                              step="5"
                              placeholder="0"
                              @change="recordAndPersistPsArtboard"
                            />
                          </label>
                          <label>
                            <span>{{ t('gameNodes.uiContainer.psPropRadius') }}</span>
                            <input
                              v-model.number="psSelectedLayer.borderRadius"
                              type="number"
                              min="0"
                              max="99"
                              step="2"
                              placeholder="8"
                              @change="recordAndPersistPsArtboard"
                            />
                          </label>
                        </div>
                        <div class="ps-color-upload-row">
                          <label
                            class="ps-mini-color"
                            :title="t('gameNodes.uiContainer.psPropTextColor')"
                          >
                            <span>{{ t('gameNodes.uiContainer.psPropTextColor') }}</span>
                            <input
                              type="color"
                              :value="psSelectedLayer.textColor || '#fef08a'"
                              @input="
                                psSelectedLayer.textColor = (
                                  $event.target as HTMLInputElement
                                ).value
                                recordAndPersistPsArtboard()
                              "
                            />
                          </label>
                          <label
                            class="ps-mini-color"
                            :title="t('gameNodes.uiContainer.psPropAccentColor')"
                          >
                            <span>{{ t('gameNodes.uiContainer.psPropAccentColor') }}</span>
                            <input
                              type="color"
                              :value="psSelectedLayer.accentColor || '#eab308'"
                              @input="
                                psSelectedLayer.accentColor = (
                                  $event.target as HTMLInputElement
                                ).value
                                recordAndPersistPsArtboard()
                              "
                            />
                          </label>
                          <label
                            class="ps-mini-color"
                            :title="t('gameNodes.uiContainer.psPropBgColor')"
                          >
                            <span>{{ t('gameNodes.uiContainer.psPropBgColor') }}</span>
                            <input
                              type="color"
                              :value="psSelectedLayer.bgColor || '#0c101c'"
                              @input="
                                psSelectedLayer.bgColor = ($event.target as HTMLInputElement).value
                                recordAndPersistPsArtboard()
                              "
                            />
                          </label>
                          <button
                            type="button"
                            class="ps-upload-mini-btn"
                            @click="triggerPsLayerImageUpload"
                          >
                            {{ t('gameNodes.uiContainer.psPropUploadImg') }}
                          </button>
                          <button
                            v-if="
                              psSelectedLayer.customImageUrl ||
                              psSelectedLayer.bgColor ||
                              psSelectedLayer.accentColor ||
                              psSelectedLayer.borderRadius !== undefined
                            "
                            type="button"
                            class="ps-upload-mini-btn clear"
                            @click="resetSelectedPsLayerSkin"
                          >
                            {{ t('gameNodes.uiContainer.psPropClearImg') }}
                          </button>
                          <input
                            ref="psLayerImageInputRef"
                            type="file"
                            accept="image/*"
                            style="display: none"
                            @change="onPsLayerImageSelected"
                          />
                        </div>
                      </div>
                    </div>

                    <!-- Upstream In-Port Connected Image Assets Strip -->
                    <div v-if="upstreamInputImages.length > 0" class="ps-upstream-assets-strip">
                      <div class="ps-upstream-strip-head">
                        <span
                          >{{ t('gameNodes.uiContainer.psUpstreamPoolTitle') }} ({{
                            upstreamInputImages.length
                          }})</span
                        >
                        <button
                          type="button"
                          class="ps-upstream-autofill-btn"
                          @click="autoFillArtboardFromUpstreamImages"
                        >
                          {{ t('gameNodes.uiContainer.psUpstreamAutoFillBtn') }}
                        </button>
                      </div>
                      <div class="ps-upstream-thumbs-row">
                        <div
                          v-for="upImg in upstreamInputImages"
                          :key="upImg.id"
                          class="ps-upstream-thumb-card alpha-checkerboard-bg"
                          :title="`${upImg.title} — ${t('gameNodes.uiContainer.psUpstreamApplyHint')}`"
                          @click="applyUpstreamImageToSelectedOrSpawn(upImg)"
                        >
                          <img :src="upImg.url" :alt="upImg.title" draggable="false" />
                          <button
                            type="button"
                            class="ps-upstream-spawn-badge"
                            :title="t('gameNodes.uiContainer.psUpstreamSpawnHint')"
                            @click.stop="spawnUpstreamImageLayer(upImg)"
                          >
                            +
                          </button>
                        </div>
                      </div>
                    </div>

                    <!-- Photoshop Layers Stack (Top-most layer first) -->
                    <div class="ps-layers-scroll-list">
                      <div
                        v-for="layer in psArtboardLayers"
                        :key="layer.id"
                        class="ps-layer-item-row"
                        :class="{
                          active: psSelectedLayerId === layer.id,
                          hidden: !layer.visible
                        }"
                        @click="psSelectedLayerId = layer.id"
                      >
                        <!-- Visibility Eye Icon Button -->
                        <button
                          type="button"
                          class="ps-layer-mini-icon"
                          :class="{ off: !layer.visible }"
                          title="Toggle Visibility"
                          @click.stop="layer.visible = !layer.visible"
                        >
                          <svg v-if="layer.visible" viewBox="0 0 16 16" class="ps-svg-icon">
                            <path
                              d="M8 3.5c3.8 0 6.7 2.8 7.5 4.5-.8 1.7-3.7 4.5-7.5 4.5S1.3 9.7.5 8C1.3 6.3 4.2 3.5 8 3.5zm0 2a2.5 2.5 0 100 5 2.5 2.5 0 000-5z"
                              fill="currentColor"
                            />
                          </svg>
                          <svg v-else viewBox="0 0 16 16" class="ps-svg-icon">
                            <path
                              d="M2.2 1.2l12.6 12.6-1 1L11.2 12c-1 .4-2.1.6-3.2.6-3.8 0-6.7-2.8-7.5-4.5.5-1.1 1.7-2.6 3.4-3.5L1.2 2.2l1-1z"
                              fill="currentColor"
                            />
                          </svg>
                        </button>

                        <!-- Lock Padlock Icon Button -->
                        <button
                          type="button"
                          class="ps-layer-mini-icon"
                          :class="{ locked: layer.locked }"
                          title="Toggle Lock"
                          @click.stop="layer.locked = !layer.locked"
                        >
                          <svg v-if="layer.locked" viewBox="0 0 16 16" class="ps-svg-icon">
                            <path
                              d="M5 5V3.8a3 3 0 016 0V5h1.2a1 1 0 011 1v6.5a1 1 0 01-1 1H3.8a1 1 0 01-1-1V6a1 1 0 011-1H5zm1.5 0h3V3.8a1.5 1.5 0 00-3 0V5z"
                              fill="currentColor"
                            />
                          </svg>
                          <svg v-else viewBox="0 0 16 16" class="ps-svg-icon muted">
                            <path
                              d="M10.5 3.8a1.5 1.5 0 00-3 0V6h4.7a1 1 0 011 1v5.5a1 1 0 01-1 1H3.8a1 1 0 01-1-1V7a1 1 0 011-1H6V3.8a3 3 0 016 0h-1.5z"
                              fill="currentColor"
                            />
                          </svg>
                        </button>

                        <!-- Live Layer Texture Thumbnail -->
                        <div class="ps-layer-thumb alpha-checkerboard-bg">
                          <img
                            :src="layer.customImageUrl || getPsLayerThumbUrl(layer.kind)"
                            alt=""
                            draggable="false"
                          />
                        </div>

                        <!-- Layer Name & Dimensions -->
                        <div class="ps-layer-meta">
                          <input
                            v-model="layer.name"
                            type="text"
                            class="ps-layer-name-input"
                            @click.stop="psSelectedLayerId = layer.id"
                          />
                          <small
                            >{{ Math.round(layer.w) }}×{{ Math.round(layer.h) }} px ·
                            {{ layer.opacity }}%</small
                          >
                        </div>
                      </div>
                    </div>

                    <!-- PS Layers Bottom Action Bar (All Icon Buttons) -->
                    <div class="ps-layers-footer-bar">
                      <button
                        type="button"
                        class="ps-icon-btn"
                        :title="t('gameNodes.uiContainer.psLayerDup')"
                        @click="duplicateSelectedPsLayer"
                      >
                        <svg viewBox="0 0 16 16" class="ps-svg-icon">
                          <path
                            d="M4 2h9a1 1 0 011 1v9h-1.5V3.5H4V2zm-2 3h9a1 1 0 011 1v8a1 1 0 01-1 1H2a1 1 0 01-1-1V6a1 1 0 011-1zm.5 1.5v7h8v-7h-8z"
                            fill="currentColor"
                          />
                        </svg>
                      </button>
                      <button
                        type="button"
                        class="ps-icon-btn"
                        :title="t('gameNodes.uiContainer.psLayerUp')"
                        @click="moveSelectedPsLayer(-1)"
                      >
                        <svg viewBox="0 0 16 16" class="ps-svg-icon">
                          <path
                            d="M8 3.5l5 5-1.1 1.1L8.75 6.4V13h-1.5V6.4L4.1 9.6 3 8.5l5-5z"
                            fill="currentColor"
                          />
                        </svg>
                      </button>
                      <button
                        type="button"
                        class="ps-icon-btn"
                        :title="t('gameNodes.uiContainer.psLayerDown')"
                        @click="moveSelectedPsLayer(1)"
                      >
                        <svg viewBox="0 0 16 16" class="ps-svg-icon">
                          <path
                            d="M8 12.5l-5-5 1.1-1.1 3.15 3.2V3h1.5v6.6l3.15-3.2 1.1 1.1-5 5z"
                            fill="currentColor"
                          />
                        </svg>
                      </button>
                      <button
                        type="button"
                        class="ps-icon-btn"
                        :title="t('gameNodes.uiContainer.psClearCanvas')"
                        @click="clearCurrentPsArtboard"
                      >
                        <svg viewBox="0 0 16 16" class="ps-svg-icon">
                          <path
                            d="M2.5 3h11v1.5h-11V3zm2 3h7l-.8 7.5H5.3L4.5 6z"
                            fill="currentColor"
                          />
                        </svg>
                      </button>
                      <button
                        type="button"
                        class="ps-icon-btn"
                        :title="t('gameNodes.uiContainer.psLayerReset')"
                        @click="resetPsArtboardLayers(activeScreenBlueprint)"
                      >
                        <svg viewBox="0 0 16 16" class="ps-svg-icon">
                          <path
                            d="M8 2.5A5.5 5.5 0 1013.5 8H15a7 7 0 11-2.05-4.95L14.5 1.5v4h-4l1.4-1.4A5.48 5.48 0 008 2.5z"
                            fill="currentColor"
                          />
                        </svg>
                      </button>
                      <button
                        type="button"
                        class="ps-icon-btn danger"
                        :title="t('gameNodes.uiContainer.psLayerDel')"
                        @click="deleteSelectedPsLayer"
                      >
                        <svg viewBox="0 0 16 16" class="ps-svg-icon">
                          <path
                            d="M6 2h4v1h3.5v1.5h-1v9a1 1 0 01-1 1h-7a1 1 0 01-1-1v-9h-1V3H6V2zm-1 2.5v8.5h6V4.5H5zm1.5 1.5h1v5.5h-1V6zm2 0h1v5.5h-1V6z"
                            fill="currentColor"
                          />
                        </svg>
                      </button>
                    </div>
                  </aside>
                </div>
              </div>

              <div
                v-else-if="pbrTab === 'lighting' && node.typeId === 'game.pbrTile'"
                class="pbr-lighting-stage"
              >
                <div class="pbr-light-controls">
                  <span class="hint">{{ t('gameNodes.workbench.pbrMoveMouseHint') }}</span>
                  <div class="light-sliders">
                    <label class="inline-slider">
                      <span>{{ t('gameNodes.workbench.pbrLightEnv') }}</span>
                      <select v-model="pbrLightEnv" @change="renderPbrLightingCanvas">
                        <option value="torch_warm">
                          {{ t('gameNodes.workbench.pbrEnvTorch') }}
                        </option>
                        <option value="studio_neutral">
                          {{ t('gameNodes.workbench.pbrEnvStudio') }}
                        </option>
                        <option value="moon_cold">{{ t('gameNodes.workbench.pbrEnvMoon') }}</option>
                        <option value="cyber_neon">
                          {{ t('gameNodes.workbench.pbrEnvCyber') }}
                        </option>
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
                    <button
                      v-if="node.typeId === 'game.pbrTile'"
                      type="button"
                      class="secondary-btn"
                      @click="downloadAutoTileManifest"
                    >
                      {{ t('gameNodes.pbrTile.downloadAutoTileBtn') }}
                    </button>
                    <button type="button" class="secondary-btn" @click="downloadPbrGodotTres">
                      {{ t('gameNodes.pbrTile.downloadGodotTresBtn') }}
                    </button>
                    <button
                      v-if="node.typeId === 'game.pbrTile'"
                      type="button"
                      class="secondary-btn"
                      @click="downloadBmFontFnt"
                    >
                      {{ t('gameNodes.pbrTile.downloadBmFontBtn') }}
                    </button>
                  </div>
                </div>

                <div class="nine-slice-dual-row">
                  <div
                    class="physics-hull-stage alpha-checkerboard-bg"
                    @pointermove="onNineSliceGuidePointerMove"
                    @pointerup="stopNineSliceGuideDrag"
                    @pointerleave="stopNineSliceGuideDrag"
                  >
                    <img
                      :src="displayPbrChannelCards[0]?.url || pbrLiveAlbedoDataUrl"
                      alt=""
                      class="physics-base-img"
                      draggable="false"
                    />
                    <svg
                      class="physics-overlay-svg"
                      :viewBox="`0 0 ${PBR_TILE_DIM} ${PBR_TILE_DIM}`"
                      preserveAspectRatio="none"
                    >
                      <!-- 9-Slice Guides (for Tile nodes, directly pointer-draggable) -->
                      <template v-if="node.typeId === 'game.pbrTile'">
                        <line
                          :x1="pbrLiveNineSlice.borders.left"
                          y1="0"
                          :x2="pbrLiveNineSlice.borders.left"
                          :y2="PBR_TILE_DIM"
                          class="slice-guide-line"
                          :class="{ active: activeNineSliceDragSide === 'left' }"
                        />
                        <line
                          :x1="pbrLiveNineSlice.borders.left"
                          y1="0"
                          :x2="pbrLiveNineSlice.borders.left"
                          :y2="PBR_TILE_DIM"
                          class="slice-guide-hit ew"
                          @pointerdown.stop="startNineSliceGuideDrag('left', $event)"
                        />

                        <line
                          :x1="PBR_TILE_DIM - pbrLiveNineSlice.borders.right"
                          y1="0"
                          :x2="PBR_TILE_DIM - pbrLiveNineSlice.borders.right"
                          :y2="PBR_TILE_DIM"
                          class="slice-guide-line"
                          :class="{ active: activeNineSliceDragSide === 'right' }"
                        />
                        <line
                          :x1="PBR_TILE_DIM - pbrLiveNineSlice.borders.right"
                          y1="0"
                          :x2="PBR_TILE_DIM - pbrLiveNineSlice.borders.right"
                          :y2="PBR_TILE_DIM"
                          class="slice-guide-hit ew"
                          @pointerdown.stop="startNineSliceGuideDrag('right', $event)"
                        />

                        <line
                          x1="0"
                          :y1="pbrLiveNineSlice.borders.top"
                          :x2="PBR_TILE_DIM"
                          :y2="pbrLiveNineSlice.borders.top"
                          class="slice-guide-line"
                          :class="{ active: activeNineSliceDragSide === 'top' }"
                        />
                        <line
                          x1="0"
                          :y1="pbrLiveNineSlice.borders.top"
                          :x2="PBR_TILE_DIM"
                          :y2="pbrLiveNineSlice.borders.top"
                          class="slice-guide-hit ns"
                          @pointerdown.stop="startNineSliceGuideDrag('top', $event)"
                        />

                        <line
                          x1="0"
                          :y1="PBR_TILE_DIM - pbrLiveNineSlice.borders.bottom"
                          :x2="PBR_TILE_DIM"
                          :y2="PBR_TILE_DIM - pbrLiveNineSlice.borders.bottom"
                          class="slice-guide-line"
                          :class="{ active: activeNineSliceDragSide === 'bottom' }"
                        />
                        <line
                          x1="0"
                          :y1="PBR_TILE_DIM - pbrLiveNineSlice.borders.bottom"
                          :x2="PBR_TILE_DIM"
                          :y2="PBR_TILE_DIM - pbrLiveNineSlice.borders.bottom"
                          class="slice-guide-hit ns"
                          @pointerdown.stop="startNineSliceGuideDrag('bottom', $event)"
                        />
                      </template>

                      <!-- Hurtbox, Hitbox & Convex Collision Hull (for Sprite & Tile nodes) -->
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
                      <polygon :points="pbrHullPolygonPoints" class="hull-polygon" />
                      <circle
                        v-for="(pt, idx) in pbrLivePhysics.hull.verticesPx"
                        :key="`hull-pt-${idx}`"
                        :cx="pt.x"
                        :cy="pt.y"
                        r="1.8"
                        class="hull-vertex"
                      />
                      <circle
                        :cx="pbrLivePhysics.hull.pivot.x"
                        :cy="pbrLivePhysics.hull.pivot.y"
                        r="2.6"
                        class="pivot-dot"
                      />
                    </svg>
                  </div>
                </div>
                <div class="level-stats-bar">
                  <span> Hull Vertices: {{ pbrLivePhysics.hull.verticesPx.length }} </span>
                  <span v-if="node.typeId === 'game.pbrTile'">
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
                v-else-if="pbrTab === 'grid' && node.typeId === 'game.pbrTile'"
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
                  <div class="channel-img-wrap alpha-checkerboard-bg">
                    <img :src="item.url" alt="" class="channel-img" draggable="false" />
                  </div>
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
                  <button
                    v-if="node.params.gameAudioDspMode === 'bgm_intro_loop'"
                    type="button"
                    class="action-btn"
                    @click="auditionIntroToLoop"
                  >
                    {{ t('gameNodes.audioDsp.playIntroLoopBtn') }}
                  </button>
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
                    <template
                      v-if="(node.params.gameAudioDspMode ?? 'loop_bgm') === 'sfx_variants'"
                    >
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

          <!-- Stage 4: game.economy (Machinations Visual System Dynamics & Monte Carlo Simulator) -->
          <template v-else-if="node.typeId === 'game.economy'">
            <div class="stage-toolbar">
              <div class="header-left">
                <span class="stage-title">{{ liveEconomyDiagram.title }}</span>
                <span class="spec-badge">
                  Tick: {{ economyLiveState.tick }} / {{ liveEconomyMcResult.steps }}
                </span>
                <span
                  class="spec-badge"
                  :class="{
                    'badge-danger':
                      liveEconomyMcResult.sourceSinkRatio > 1.55 ||
                      liveEconomyMcResult.sourceSinkRatio < 0.65
                  }"
                >
                  Source/Sink: {{ liveEconomyMcResult.sourceSinkRatio }}x
                </span>
                <span v-if="liveEconomyMcResult.medianTicksToGoal !== null" class="spec-badge">
                  Goal P50: {{ liveEconomyMcResult.medianTicksToGoal }} Ticks ({{
                    Math.round(liveEconomyMcResult.endConditionHitRate * 100)
                  }}%)
                </span>
              </div>
              <div class="tab-pills">
                <button type="button" class="action-btn" @click="toggleEconomyLivePlay">
                  {{
                    economyIsPlaying
                      ? t('gameNodes.economy.pauseBtn')
                      : t('gameNodes.economy.playBtn')
                  }}
                </button>
                <button type="button" class="secondary-btn" @click="stepEconomyOnce()">
                  {{ t('gameNodes.economy.stepBtn') }}
                </button>
                <button type="button" class="secondary-btn" @click="resetEconomyLiveSim">
                  {{ t('gameNodes.economy.resetBtn') }}
                </button>
                <button
                  type="button"
                  class="tab-pill"
                  :class="{ active: economyTab === 'diagram' }"
                  @click="economyTab = 'diagram'"
                >
                  🕸️ Machinations Diagram &amp; Curves
                </button>
                <button
                  type="button"
                  class="tab-pill"
                  :class="{ active: economyTab === 'export' }"
                  @click="economyTab = 'export'"
                >
                  📦 Godot / Unity / CSV
                </button>
              </div>
            </div>

            <div class="stage-content">
              <div v-if="economyTab === 'diagram'" class="mach-workbench-layout">
                <!-- Node & Edge Creation Palette -->
                <div class="brush-toolbar">
                  <span class="section-title">{{ t('gameNodes.economy.paletteTitle') }}</span>
                  <div class="brush-pills">
                    <button type="button" class="tab-pill" @click="addMachNode('source')">
                      {{ t('gameNodes.economy.addNodeSource') }}
                    </button>
                    <button type="button" class="tab-pill" @click="addMachNode('pool')">
                      {{ t('gameNodes.economy.addNodePool') }}
                    </button>
                    <button type="button" class="tab-pill" @click="addMachNode('converter')">
                      {{ t('gameNodes.economy.addNodeConverter') }}
                    </button>
                    <button type="button" class="tab-pill" @click="addMachNode('drain')">
                      {{ t('gameNodes.economy.addNodeDrain') }}
                    </button>
                    <button type="button" class="tab-pill" @click="addMachNode('gate')">
                      {{ t('gameNodes.economy.addNodeGate') }}
                    </button>
                    <button type="button" class="tab-pill" @click="addMachNode('register')">
                      {{ t('gameNodes.economy.addNodeRegister') }}
                    </button>
                    <button
                      type="button"
                      class="tab-pill"
                      :class="{ active: machConnectMode === 'resource_flow' }"
                      @click="toggleMachConnectMode('resource_flow')"
                    >
                      {{ t('gameNodes.economy.addEdgeResource') }}
                    </button>
                    <button
                      type="button"
                      class="tab-pill"
                      :class="{ active: machConnectMode === 'state_modifier' }"
                      @click="toggleMachConnectMode('state_modifier')"
                    >
                      {{ t('gameNodes.economy.addEdgeState') }}
                    </button>
                    <button
                      type="button"
                      class="secondary-btn"
                      :disabled="!selectedMachNodeId"
                      @click="deleteSelectedMachNode"
                    >
                      {{ t('gameNodes.economy.deleteSelectedBtn') }}
                    </button>
                  </div>
                </div>

                <!-- Interactive SVG Machinations Diagram Canvas -->
                <div class="mach-canvas-wrap">
                  <svg
                    ref="machSvgRef"
                    class="mach-svg-canvas"
                    viewBox="0 0 740 275"
                    @pointermove="onMachCanvasPointerMove"
                    @pointerup="onMachCanvasPointerUp"
                    @pointerleave="onMachCanvasPointerUp"
                  >
                    <defs>
                      <marker
                        id="mach-arrow-res"
                        viewBox="0 0 10 10"
                        refX="9"
                        refY="5"
                        markerWidth="6"
                        markerHeight="6"
                        orient="auto-start-reverse"
                      >
                        <path d="M 0 1 L 10 5 L 0 9 z" fill="#94a3b8" />
                      </marker>
                      <marker
                        id="mach-arrow-state"
                        viewBox="0 0 10 10"
                        refX="9"
                        refY="5"
                        markerWidth="6"
                        markerHeight="6"
                        orient="auto-start-reverse"
                      >
                        <path d="M 0 1 L 10 5 L 0 9 z" fill="#c084fc" />
                      </marker>
                    </defs>

                    <!-- Edges -->
                    <g v-for="edge in liveEconomyDiagram.edges" :key="edge.id">
                      <line
                        :x1="getMachEdgeCoords(edge).x1"
                        :y1="getMachEdgeCoords(edge).y1"
                        :x2="getMachEdgeCoords(edge).x2"
                        :y2="getMachEdgeCoords(edge).y2"
                        :stroke="
                          (economyLiveState.edgeFlowsLastTick[edge.id] ?? 0) > 0
                            ? '#38bdf8'
                            : edge.kind === 'state_modifier'
                              ? '#c084fc'
                              : '#94a3b8'
                        "
                        :stroke-width="
                          (economyLiveState.edgeFlowsLastTick[edge.id] ?? 0) > 0 ? 3.2 : 2
                        "
                        :stroke-dasharray="edge.kind === 'state_modifier' ? '6,4' : undefined"
                        :marker-end="
                          edge.kind === 'state_modifier'
                            ? 'url(#mach-arrow-state)'
                            : 'url(#mach-arrow-res)'
                        "
                      />
                      <!-- Animated Token Pulse when flow > 0 -->
                      <circle
                        v-if="(economyLiveState.edgeFlowsLastTick[edge.id] ?? 0) > 0"
                        :cx="(getMachEdgeCoords(edge).x1 + getMachEdgeCoords(edge).x2) * 0.5"
                        :cy="(getMachEdgeCoords(edge).y1 + getMachEdgeCoords(edge).y2) * 0.5"
                        r="5.5"
                        fill="#38bdf8"
                        stroke="#ffffff"
                        stroke-width="1.5"
                      />
                      <!-- Edge Label Pill -->
                      <rect
                        :x="(getMachEdgeCoords(edge).x1 + getMachEdgeCoords(edge).x2) * 0.5 - 32"
                        :y="(getMachEdgeCoords(edge).y1 + getMachEdgeCoords(edge).y2) * 0.5 - 10"
                        width="64"
                        height="16"
                        rx="4"
                        fill="rgba(15, 23, 42, 0.88)"
                        :stroke="edge.kind === 'state_modifier' ? '#a855f7' : '#475569'"
                        stroke-width="1"
                      />
                      <text
                        :x="(getMachEdgeCoords(edge).x1 + getMachEdgeCoords(edge).x2) * 0.5"
                        :y="(getMachEdgeCoords(edge).y1 + getMachEdgeCoords(edge).y2) * 0.5 + 1.5"
                        text-anchor="middle"
                        class="mach-edge-svg-text"
                      >
                        {{
                          (economyLiveState.edgeFlowsLastTick[edge.id] ?? 0) > 0
                            ? `+${Math.round((economyLiveState.edgeFlowsLastTick[edge.id] ?? 0) * 10) / 10}`
                            : edge.label
                        }}
                      </text>
                    </g>

                    <!-- Nodes -->
                    <g
                      v-for="mNode in liveEconomyDiagram.nodes"
                      :key="mNode.id"
                      :transform="`translate(${mNode.x}, ${mNode.y})`"
                      class="mach-svg-node"
                      @pointerdown.stop="onMachNodePointerDown(mNode.id, $event)"
                    >
                      <!-- Selection Halo -->
                      <circle
                        v-if="selectedMachNodeId === mNode.id"
                        r="27"
                        fill="none"
                        stroke="#38bdf8"
                        stroke-width="2"
                        stroke-dasharray="4,3"
                      />

                      <!-- Pool: Circle -->
                      <circle
                        v-if="mNode.kind === 'pool'"
                        r="21"
                        fill="#0f172a"
                        :stroke="mNode.color || '#38bdf8'"
                        stroke-width="3"
                      />
                      <!-- Source: Upward Triangle -->
                      <polygon
                        v-else-if="mNode.kind === 'source'"
                        points="0,-22 22,18 -22,18"
                        fill="#0f172a"
                        :stroke="mNode.color || '#10b981'"
                        stroke-width="3"
                      />
                      <!-- Drain: Downward Inverted Triangle -->
                      <polygon
                        v-else-if="mNode.kind === 'drain'"
                        points="-22,-18 22,-18 0,22"
                        fill="#0f172a"
                        :stroke="mNode.color || '#f43f5e'"
                        stroke-width="3"
                      />
                      <!-- Converter: Rightward Triangle -->
                      <polygon
                        v-else-if="mNode.kind === 'converter'"
                        points="-19,-21 22,0 -19,21"
                        fill="#0f172a"
                        :stroke="mNode.color || '#f97316'"
                        stroke-width="3"
                      />
                      <!-- Gate: Diamond -->
                      <polygon
                        v-else-if="mNode.kind === 'gate'"
                        points="0,-23 23,0 0,23 -23,0"
                        fill="#0f172a"
                        :stroke="mNode.color || '#ec4899'"
                        stroke-width="3"
                      />
                      <!-- Register / End Condition: Box -->
                      <rect
                        v-else
                        x="-24"
                        y="-16"
                        width="48"
                        height="32"
                        rx="5"
                        fill="#0f172a"
                        :stroke="mNode.color || '#a855f7'"
                        stroke-width="3"
                      />

                      <!-- Activation Badge (* for automatic) -->
                      <text
                        v-if="mNode.activation === 'automatic'"
                        x="18"
                        y="-16"
                        class="mach-node-star"
                      >
                        *
                      </text>

                      <!-- Center Value / Symbol -->
                      <text text-anchor="middle" y="4" class="mach-node-val-text">
                        {{ formatMachNodeCenterText(mNode) }}
                      </text>

                      <!-- Node Title Below -->
                      <text text-anchor="middle" y="35" class="mach-node-label-text">
                        {{ mNode.label }}
                      </text>
                    </g>
                  </svg>
                </div>

                <!-- Bottom Split: Monte Carlo P10/P50/P90 Chart + Health Diagnostics -->
                <div class="mach-bottom-grid">
                  <div class="mach-chart-card">
                    <div class="mach-chart-head">
                      <span class="section-title">{{ t('gameNodes.economy.chartTitle') }}</span>
                      <div class="mach-legend-row">
                        <span
                          v-for="s in liveEconomyMcResult.poolSeries"
                          :key="s.nodeId"
                          class="mach-legend-pill"
                        >
                          <i class="mach-dot" :style="{ background: s.color }" />
                          {{ s.label }}:
                          <b>{{
                            Math.round((economyLiveState.poolValues[s.nodeId] ?? 0) * 10) / 10
                          }}</b>
                          <small>(P50: {{ s.p50[s.p50.length - 1] ?? 0 }})</small>
                        </span>
                      </div>
                    </div>
                    <svg class="mach-timeseries-svg" viewBox="0 0 540 165">
                      <!-- Horizontal Grid Lines -->
                      <line
                        v-for="gy in [25, 65, 105, 145]"
                        :key="`grid-${gy}`"
                        x1="36"
                        :y1="gy"
                        x2="525"
                        :y2="gy"
                        stroke="rgba(148, 163, 184, 0.16)"
                        stroke-width="1"
                      />
                      <!-- Y-axis max & 0 labels -->
                      <text x="30" y="28" text-anchor="end" class="mach-axis-text">
                        {{ machChartMaxY }}
                      </text>
                      <text x="30" y="148" text-anchor="end" class="mach-axis-text">0</text>

                      <!-- P10..P90 Shaded Confidence Ribbons & P50 Median Lines -->
                      <g v-for="series in machChartPolygons" :key="series.nodeId">
                        <polygon
                          :points="series.bandPoints"
                          :fill="series.color"
                          fill-opacity="0.18"
                        />
                        <polyline
                          :points="series.p50Points"
                          fill="none"
                          :stroke="series.color"
                          stroke-width="2.4"
                        />
                      </g>

                      <!-- Live Tick Playhead Vertical Line -->
                      <line
                        :x1="
                          36 +
                          (Math.min(economyLiveState.tick, liveEconomyMcResult.steps) /
                            Math.max(1, liveEconomyMcResult.steps)) *
                            489
                        "
                        y1="16"
                        :x2="
                          36 +
                          (Math.min(economyLiveState.tick, liveEconomyMcResult.steps) /
                            Math.max(1, liveEconomyMcResult.steps)) *
                            489
                        "
                        y2="148"
                        stroke="#38bdf8"
                        stroke-width="1.5"
                        stroke-dasharray="4,3"
                      />
                    </svg>
                  </div>

                  <!-- Automated Economy Health Diagnostics -->
                  <div class="mach-diag-card">
                    <div class="section-title">{{ t('gameNodes.economy.diagnosticsTitle') }}</div>
                    <div class="mach-diag-list">
                      <div
                        v-for="diag in liveEconomyMcResult.diagnostics"
                        :key="diag.code"
                        class="mach-diag-item"
                        :class="`sev-${diag.severity}`"
                      >
                        <div class="mach-diag-head">
                          <b>
                            {{
                              diag.severity === 'healthy'
                                ? '✅'
                                : diag.severity === 'warning'
                                  ? '⚠️'
                                  : '🚨'
                            }}
                            {{ diag.title }}
                          </b>
                          <span class="spec-badge">{{ diag.metricValue }}</span>
                        </div>
                        <p class="mach-diag-detail">{{ diag.detail }}</p>
                        <p class="mach-diag-rec">💡 {{ diag.recommendation }}</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Export Tab: Godot 4 GDScript / Unity C# / Mermaid / CSV -->
              <div v-else class="audio-stage-body">
                <div class="engine-export-panel">
                  <div class="engine-export-head">
                    <span class="section-title">{{ t('gameNodes.economy.exportTitle') }}</span>
                    <div class="tab-pills">
                      <button
                        type="button"
                        class="tab-pill"
                        :class="{ active: economyExportLang === 'godot' }"
                        @click="economyExportLang = 'godot'"
                      >
                        Godot 4 (EconomySimulator.gd)
                      </button>
                      <button
                        type="button"
                        class="tab-pill"
                        :class="{ active: economyExportLang === 'unity' }"
                        @click="economyExportLang = 'unity'"
                      >
                        Unity (EconomyManager.cs)
                      </button>
                      <button
                        type="button"
                        class="tab-pill"
                        :class="{ active: economyExportLang === 'mermaid' }"
                        @click="economyExportLang = 'mermaid'"
                      >
                        Mermaid Flowchart (.mmd)
                      </button>
                      <button
                        type="button"
                        class="tab-pill"
                        :class="{ active: economyExportLang === 'csv' }"
                        @click="economyExportLang = 'csv'"
                      >
                        Monte Carlo Telemetry (.csv)
                      </button>
                      <button
                        type="button"
                        class="secondary-btn"
                        @click="downloadEconomyTelemetryCsv"
                      >
                        {{ t('gameNodes.economy.downloadCsvBtn') }}
                      </button>
                      <button
                        type="button"
                        class="secondary-btn"
                        @click="downloadEconomyDiagramJson"
                      >
                        {{ t('gameNodes.economy.downloadJsonBtn') }}
                      </button>
                    </div>
                  </div>
                  <pre class="code-viewer">{{ activeEconomyExportCode }}</pre>
                </div>
              </div>
            </div>
          </template>
        </main>
      </div>

      <footer class="workbench-header">
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
            @toggle="onWorkbenchRunToggle"
          />
          <button type="button" class="done-btn" @click="onClose">
            {{ t('gameNodes.workbench.doneBtn') }}
          </button>
        </div>
      </footer>
    </template>
  </div>
  <div v-else class="dive-view empty-stage">
    {{ t('graph.inspector.node.empty') }}
  </div>
</template>

<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import MachinationsStudio from './machinations/MachinationsStudio.vue'
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
  blendVfxFramesOpticalFlow,
  buildAutoTileAtlasManifest,
  buildBitmapFontManifest,
  buildNineSliceManifest,
  buildSpritePhysicsManifest,
  buildThemedArtboardSuitePayload,
  composeLayeredFrameTemplate,
  compositeIconWithRarityFrame,
  createProceduralMaterialTileRgba,
  createProceduralSpriteSampleRgba,
  createProceduralUiSampleRgba,
  createProceduralVfxSampleRgba,
  decodeWavBytesToPcm,
  derivePbrMapsFromRgba,
  detectNineSliceBorders,
  encodePcmToWavDataUrl,
  encodeRgbaToPngDataUrl,
  exportGodotAudioStreamRandomizerTres,
  exportGodotFullScreenUiTscn,
  exportGodotNinePatchTscn,
  exportGodotTileSetTres,
  exportGodotUiButtonThemeTres,
  exportUnityAudioRandomContainerJson,
  exportUnityNineSliceSnippet,
  exportWebCssNineSliceSnippet,
  generateProceduralLevelMap,
  generateUiButtonFourStates,
  normalizePeakPcm,
  planSfxVariantMatrix,
  processScenePropWithYSortAndShadow,
  processSpriteStrokeAndMipChain,
  renderNineSliceResizedRgba,
  renderProceduralLevelToPng,
  resamplePitchShiftPcm,
  sliceNinePatchRegionsRgba,
  splitBgmIntroAndSeamlessLoop,
  type SpriteStrokeColorPreset,
  synthesizeDialogueBoxKit,
  synthesizeGameSeedPcm,
  synthesizeHudProgressBarKit,
  synthesizeRadialHudKit,
  synthesizeUiFormControlsKit,
  synthesizeVfxFlipbookPipeline,
  synthesizeWang16AutoTileAtlas,
  trimSilencePcm,
  type HudBarColorPreset,
  type NineSliceStretchMode,
  type UiScreenBlueprintPreset,
  type UiStylePreset,
  type UniversalFrameShape,
  type VfxArchetypePreset,
  type VfxElementalPalette,
  type VfxProductionMode,
  type GameAudioEnvironmentFx,
  type GameAudioSynthPreset,
  type IconRarityTier,
  type LevelCellType,
  type LevelEntitySpawn,
  type LevelGeneratorAlgorithm,
  type LevelMapCustomEditsPayload,
  type MachinationsDiagram,
  type MachinationsEdge,
  type MachinationsEdgeKind,
  type MachinationsNode,
  type MachinationsNodeKind,
  type MachinationsPresetId,
  type MachinationsSimulationState,
  createInitialMachinationsState,
  createMachinationsPresetDiagram,
  exportGodotEconomySimulatorGd,
  exportMachinationsTelemetryCsv,
  exportMachinationsToMermaid,
  exportUnityEconomyManagerCs,
  parseMachinationsDiagramJson,
  runMachinationsMonteCarlo,
  stepMachinationsSimulation,
  type PbrMaterialPreset,
  type PhysicsPivotMode,
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

const effectiveImageAssetMode = computed(() => {
  const explicit = node.value?.params.gamePbrAssetMode
  if (explicit) return explicit
  if (node.value?.typeId === 'game.spriteProp') return 'sprite_stroke_mip'
  if (node.value?.typeId === 'game.vfxAlpha') return 'vfx_demult'
  return 'pbr_tile'
})

const nodeBadge = computed(() => {
  switch (node.value?.typeId) {
    case 'game.pbrTile':
      return 'PBR + AutoTile'
    case 'game.spriteProp':
      return 'Stroke + Mips + Y-Sort'
    case 'game.vfxAlpha':
      return 'Flipbook + Alpha + LUT'
    case 'game.audioDsp':
      return (node.value.params.gameAudioDspMode ?? 'loop_bgm') === 'loop_bgm'
        ? 'Loop BGM'
        : `${node.value.params.gameAudioVariantCount ?? 4}× SFX`
    case 'game.levelMap':
      return `${node.value.params.gameLevelWidth ?? 32}×${node.value.params.gameLevelHeight ?? 20}`
    case 'game.economy':
      return `MC ${node.value.params.gameEconomyMonteCarloRuns ?? 40}×${node.value.params.gameEconomySteps ?? 50}t`
    default:
      return ''
  }
})

const nodeHint = computed(() => {
  switch (node.value?.typeId) {
    case 'game.pbrTile':
      return t('gameNodes.pbrTile.hint')
    case 'game.spriteProp':
      return t('gameNodes.spriteProp.hint')
    case 'game.vfxAlpha':
      return t('gameNodes.vfxAlpha.hint')
    case 'game.audioDsp':
      return t('gameNodes.audioDsp.hint')
    case 'game.levelMap':
      return t('gameNodes.levelMap.hint')
    case 'game.economy':
      return t('gameNodes.economy.hint')
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
const pbrTab = ref<
  | 'lighting'
  | 'physics'
  | 'grid'
  | 'channels'
  | 'ui_sandbox'
  | 'ui_screen'
  | 'vfx_player'
  | 'vfx_engine'
>('lighting')
const vfxPlayerCanvasRef = ref<HTMLCanvasElement | null>(null)
const vfxIsPlaying = ref(true)
const vfxCurrentFrame = ref(0)
const vfxPlayerBg = ref<'checker' | 'dark' | 'light'>('dark')
const vfxBlendMode = ref<'source-over' | 'lighter'>('source-over')
const vfxHitFlashTimer = ref(0)
let vfxPlaybackRafId = 0
const showSeamGrid = ref(true)
const pbrLightZ = ref(0.85)
const pbrLightIntensity = ref(1.45)
const pbrLightEnv = ref<'torch_warm' | 'studio_neutral' | 'moon_cold' | 'cyber_neon'>('torch_warm')
const pbrAutoOrbit = ref(false)
const pbrLightPos = ref({ x: 144, y: 144 })
const pbrLightCanvasRef = ref<HTMLCanvasElement | null>(null)
const pbrChannelCards = ref<Array<{ key: string; title: string; url: string }>>([])
const pbrSourceTileRgba = ref<Uint8ClampedArray | null>(null)
const upstreamInputImages = ref<Array<{ id: string; title: string; url: string }>>([])
const pbrManifestCopied = ref(false)
let pbrOrbitRafId = 0

const PBR_TILE_DIM = 160
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
      node.value?.typeId,
      node.value?.params.generatedImages,
      node.value?.params.previewDataUrl,
      hostId.value,
      graphEditorHosts.revision.value
    ] as const,
  async ([nextId, nextType], prev) => {
    const current = node.value
    const isImgAssetNode =
      current?.typeId === 'game.pbrTile' ||
      current?.typeId === 'game.spriteProp' ||
      current?.typeId === 'game.vfxAlpha'
    if (!current || !isImgAssetNode) {
      pbrChannelCards.value = []
      pbrSourceTileRgba.value = null
      return
    }
    const prevId = prev?.[0]
    const prevType = prev?.[1]
    if (nextId !== prevId || nextType !== prevType) {
      pbrTab.value =
        current.typeId === 'game.pbrTile'
          ? 'lighting'
          : current.typeId === 'game.vfxAlpha'
            ? 'vfx_player'
            : 'channels'
    } else if (
      current.typeId !== 'game.pbrTile' &&
      (pbrTab.value === 'lighting' || pbrTab.value === 'grid')
    ) {
      pbrTab.value = current.typeId === 'game.vfxAlpha' ? 'vfx_player' : 'channels'
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

    // Resolve all upstream connected image nodes for In-port asset pool + primary albedo texture
    let upstreamImageUrl = ''
    const collectedUpstream: Array<{ id: string; title: string; url: string }> = []
    if (hostId.value) {
      const edges = graphEditorHosts.listIncomingEdges(hostId.value, current.id)
      for (const edge of edges) {
        const srcNode = graphEditorHosts.getNode(hostId.value, edge.sourceNodeId)
        if (!srcNode) continue
        const srcImages = srcNode.params.generatedImages ?? []
        let addedFromNode = false
        for (let idx = 0; idx < srcImages.length; idx++) {
          const rawImg = srcImages[idx]
          const imgItem = rawImg as {
            id?: string
            title?: string
            dataUrl?: string
            relativePath?: string
          }
          let url = imgItem.dataUrl?.trim() || ''
          if (!url && imgItem.relativePath?.trim()) {
            try {
              url = (await resolveAssetPreviewUrl(imgItem.relativePath.trim())) || ''
            } catch {
              url = ''
            }
          }
          if (url) {
            if (!upstreamImageUrl) upstreamImageUrl = url
            collectedUpstream.push({
              id: imgItem.id || `${srcNode.id}-${idx}`,
              title:
                imgItem.title?.trim() ||
                srcNode.title?.trim() ||
                `In_${collectedUpstream.length + 1}`,
              url
            })
            addedFromNode = true
          }
        }
        if (!addedFromNode && srcNode.params.previewDataUrl?.trim()) {
          const previewUrl = srcNode.params.previewDataUrl.trim()
          if (!upstreamImageUrl) upstreamImageUrl = previewUrl
          collectedUpstream.push({
            id: `${srcNode.id}-preview`,
            title: srcNode.title?.trim() || `In_${collectedUpstream.length + 1}`,
            url: previewUrl
          })
        }
      }
    }
    upstreamInputImages.value = collectedUpstream

    const fallbackNodeUrl =
      current.typeId === 'game.pbrTile' ||
      current.params.gamePbrAssetMode === 'raw_nine_slice' ||
      (current.params.generatedImages ?? []).length === 0
        ? resolved[0]?.url || ''
        : ''
    const sourceUrlToDecode = upstreamImageUrl || fallbackNodeUrl
    await loadPbrSourceTileRgba(sourceUrlToDecode)
    if (current.typeId === 'game.pbrTile') {
      renderPbrLightingCanvas()
    } else if (current.typeId === 'game.vfxAlpha') {
      startVfxPlaybackLoop()
      void nextTick(() => renderVfxPlayerCanvas())
    }
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

let lastPbrTileKey = ''
let lastPbrSourceRef: Uint8ClampedArray | null = null
let lastPbrTileResult: {
  albedo: Uint8ClampedArray
  maps: ReturnType<typeof derivePbrMapsFromRgba>
} | null = null

const pbrLiveTileData = computed(() => {
  const current = node.value
  const assetMode = effectiveImageAssetMode.value
  const isTileMode = assetMode === 'pbr_tile' || assetMode === 'autotile_wang16'
  const preset = (current?.params.gamePbrMaterialPreset ?? 'stone_dungeon') as PbrMaterialPreset
  const seamlessEnabled = isTileMode && current?.params.gameTileSeamless !== false
  const blendRatio = Math.max(
    0.05,
    Math.min(0.45, Number(current?.params.gameTileBlendRatio ?? 0.22))
  )
  const normalStrength = Math.max(
    0.2,
    Math.min(12, Number(current?.params.gamePbrNormalStrength ?? 2.8))
  )
  const normalFormat = current?.params.gamePbrNormalFormat === 'directx' ? 'directx' : 'opengl'
  const roughnessContrast = Math.max(
    0.2,
    Math.min(3, Number(current?.params.gamePbrRoughnessContrast ?? 1.2))
  )
  const aoStrength = Math.max(0, Math.min(2, Number(current?.params.gamePbrAoStrength ?? 0.85)))
  const metallicScale = Math.max(
    0,
    Math.min(2, Number(current?.params.gamePbrMetallicScale ?? 0.25))
  )
  const invertRoughness = Boolean(current?.params.gamePbrInvertRoughness)
  const vfxArchetype = (current?.params.gameVfxArchetype ?? 'slash_arc') as VfxArchetypePreset
  const key = `${assetMode}|${preset}|${vfxArchetype}|${seamlessEnabled}|${blendRatio}|${normalStrength}|${normalFormat}|${roughnessContrast}|${aoStrength}|${metallicScale}|${invertRoughness}`
  if (lastPbrTileResult && key === lastPbrTileKey && pbrSourceTileRgba.value === lastPbrSourceRef) {
    return lastPbrTileResult
  }
  const createFallbackSample = (): Uint8ClampedArray => {
    if (
      assetMode === 'composite_frame' ||
      assetMode === 'raw_nine_slice' ||
      assetMode === 'ui_kit' ||
      assetMode === 'hud_bar_kit' ||
      assetMode === 'radial_hud_kit' ||
      assetMode === 'dialogue_kit' ||
      assetMode === 'ui_controls_kit'
    ) {
      return createProceduralUiSampleRgba(
        PBR_TILE_DIM,
        PBR_TILE_DIM,
        assetMode === 'ui_kit' ? 'ui_kit' : 'composite_frame'
      ).data
    }
    if (assetMode === 'sprite_stroke_mip' || assetMode === 'scene_prop') {
      return createProceduralSpriteSampleRgba(PBR_TILE_DIM, PBR_TILE_DIM, assetMode).data
    }
    if (assetMode === 'vfx_demult') {
      return createProceduralVfxSampleRgba(PBR_TILE_DIM, PBR_TILE_DIM, vfxArchetype).data
    }
    return createProceduralMaterialTileRgba(preset, PBR_TILE_DIM, PBR_TILE_DIM).data
  }
  const base =
    pbrSourceTileRgba.value && pbrSourceTileRgba.value.length === PBR_TILE_DIM * PBR_TILE_DIM * 4
      ? pbrSourceTileRgba.value
      : createFallbackSample()
  const albedo = seamlessEnabled
    ? applySeamlessTileBlend(base, PBR_TILE_DIM, PBR_TILE_DIM, { blendRatio })
    : base
  const maps = derivePbrMapsFromRgba(albedo, PBR_TILE_DIM, PBR_TILE_DIM, {
    normalStrength,
    normalFormat,
    wrapTiling: seamlessEnabled,
    roughnessContrast,
    aoStrength,
    metallicScale,
    invertRoughness
  })
  lastPbrTileKey = key
  lastPbrSourceRef = pbrSourceTileRgba.value
  lastPbrTileResult = { albedo, maps }
  return lastPbrTileResult
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

function applyUniformNineSliceInWorkbench(): void {
  const b = pbrLiveNineSlice.value.borders
  const base = Math.max(1, Math.min(Math.floor(PBR_TILE_DIM * 0.45), Math.round(b.left)))
  patchParams({
    gameNineSliceLeft: base,
    gameNineSliceRight: base,
    gameNineSliceTop: base,
    gameNineSliceBottom: base
  })
}

const activeNineSliceDragSide = ref<'left' | 'right' | 'top' | 'bottom' | null>(null)

function startNineSliceGuideDrag(
  side: 'left' | 'right' | 'top' | 'bottom',
  event: PointerEvent
): void {
  event.preventDefault()
  activeNineSliceDragSide.value = side
  try {
    ;(event.target as Element | null)?.setPointerCapture?.(event.pointerId)
  } catch {
    /* ignore */
  }
}

function onNineSliceGuidePointerMove(event: PointerEvent): void {
  const side = activeNineSliceDragSide.value
  if (!side) return
  const stageEl = event.currentTarget as HTMLElement | null
  if (!stageEl) return
  const rect = stageEl.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return
  const maxMargin = Math.floor(PBR_TILE_DIM * 0.45)
  const symmetric = Boolean(node.value?.params.gameUiSymmetricLock)

  if (side === 'left' || side === 'right') {
    const pxX = Math.round(((event.clientX - rect.left) / rect.width) * PBR_TILE_DIM)
    if (side === 'left') {
      const val = Math.max(1, Math.min(maxMargin, pxX))
      patchParams(
        symmetric ? { gameNineSliceLeft: val, gameNineSliceRight: val } : { gameNineSliceLeft: val }
      )
    } else {
      const val = Math.max(1, Math.min(maxMargin, PBR_TILE_DIM - pxX))
      patchParams(
        symmetric
          ? { gameNineSliceLeft: val, gameNineSliceRight: val }
          : { gameNineSliceRight: val }
      )
    }
  } else {
    const pxY = Math.round(((event.clientY - rect.top) / rect.height) * PBR_TILE_DIM)
    if (side === 'top') {
      const val = Math.max(1, Math.min(maxMargin, pxY))
      patchParams({ gameNineSliceTop: val })
    } else {
      const val = Math.max(1, Math.min(maxMargin, PBR_TILE_DIM - pxY))
      patchParams({ gameNineSliceBottom: val })
    }
  }
}

function stopNineSliceGuideDrag(): void {
  activeNineSliceDragSide.value = null
}

const uiLiveRawNineSlice = computed(() => {
  if (node.value?.typeId !== 'game.pbrTile') {
    return null
  }
  const stretchMode = (node.value?.params.gameNineSliceStretchMode ??
    'stretch') as NineSliceStretchMode
  const symmetricLock = Boolean(node.value?.params.gameUiSymmetricLock)
  const sliced = sliceNinePatchRegionsRgba(
    pbrLiveTileData.value.albedo,
    PBR_TILE_DIM,
    PBR_TILE_DIM,
    pbrLiveNineSlice.value.borders,
    {
      autoKeyBackground: true,
      symmetricLock,
      stretchMode
    }
  )
  return {
    ...sliced,
    cleanedUrl: encodeRgbaToPngDataUrl(sliced.cleanedRgba, sliced.width, sliced.height),
    explodedUrl: encodeRgbaToPngDataUrl(
      sliced.explodedSheetRgba,
      sliced.explodedWidth,
      sliced.explodedHeight
    ),
    hollowUrl: encodeRgbaToPngDataUrl(sliced.hollowFrameRgba, sliced.width, sliced.height),
    stretchedUrl: encodeRgbaToPngDataUrl(
      sliced.stretchedPreviewRgba,
      sliced.previewWidth,
      sliced.previewHeight
    )
  }
})

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

const uiLiveFrameBundle = computed(() => {
  if (effectiveImageAssetMode.value !== 'composite_frame') {
    return null
  }
  const frameShape = (node.value?.params.gameFrameShape ?? 'rect_card') as UniversalFrameShape
  const rarity = (node.value?.params.gameIconRarityTier ?? 'rare') as IconRarityTier
  const stylePreset = (node.value?.params.gameUiStylePreset ??
    'dark_iron_parchment') as UiStylePreset
  const foilStrength = Math.max(
    0,
    Math.min(1, Number(node.value?.params.gameUiFoilStrength ?? 0.65))
  )
  const layered = composeLayeredFrameTemplate(
    pbrLiveTileData.value.albedo,
    PBR_TILE_DIM,
    PBR_TILE_DIM,
    {
      frameShape,
      rarity,
      stylePreset,
      foilStrength,
      resourceName: (node.value?.title || 'layered_frame').replace(/[^a-zA-Z0-9_-]/g, '_')
    }
  )
  return {
    ...layered,
    compositeUrl: encodeRgbaToPngDataUrl(layered.compositeRgba, PBR_TILE_DIM, PBR_TILE_DIM),
    foilMaskUrl: encodeRgbaToPngDataUrl(layered.foilShimmerMaskRgba, PBR_TILE_DIM, PBR_TILE_DIM)
  }
})

const uiLiveAnchors = computed(() => uiLiveFrameBundle.value?.layoutRects ?? null)

const uiLiveButtonKit = computed(() => {
  if (effectiveImageAssetMode.value !== 'ui_kit') {
    return null
  }
  const rarity = (node.value?.params.gameIconRarityTier ?? 'legendary') as IconRarityTier
  const stretchMode = (node.value?.params.gameNineSliceStretchMode ??
    'stretch') as NineSliceStretchMode
  const uiStates = generateUiButtonFourStates(
    pbrLiveTileData.value.albedo,
    PBR_TILE_DIM,
    PBR_TILE_DIM,
    {
      symmetricNineSlice: node.value?.params.gameUiSymmetricLock !== false,
      stretchMode,
      customBorders: pbrLiveNineSlice.value.borders
    }
  )
  const rarityFrame = compositeIconWithRarityFrame(
    pbrLiveTileData.value.albedo,
    PBR_TILE_DIM,
    PBR_TILE_DIM,
    rarity
  )
  return {
    stateUrls: {
      normal: encodeRgbaToPngDataUrl(uiStates.states.normal, PBR_TILE_DIM, PBR_TILE_DIM),
      hover: encodeRgbaToPngDataUrl(uiStates.states.hover, PBR_TILE_DIM, PBR_TILE_DIM),
      pressed: encodeRgbaToPngDataUrl(uiStates.states.pressed, PBR_TILE_DIM, PBR_TILE_DIM),
      disabled: encodeRgbaToPngDataUrl(uiStates.states.disabled, PBR_TILE_DIM, PBR_TILE_DIM),
      focused: encodeRgbaToPngDataUrl(uiStates.states.focused, PBR_TILE_DIM, PBR_TILE_DIM)
    },
    rarityUrl: encodeRgbaToPngDataUrl(rarityFrame.data, rarityFrame.width, rarityFrame.height)
  }
})

const HUD_BAR_W = 480
const HUD_BAR_H = 96

const uiLiveHudBarKit = computed(() => {
  if (effectiveImageAssetMode.value !== 'hud_bar_kit') {
    return null
  }
  const preset = (node.value?.params.gameHudBarPreset ?? 'hp_crimson') as HudBarColorPreset
  const stylePreset = (node.value?.params.gameUiStylePreset ??
    'dark_iron_parchment') as UiStylePreset
  const kit = synthesizeHudProgressBarKit(pbrLiveTileData.value.albedo, HUD_BAR_W, HUD_BAR_H, {
    preset,
    stylePreset,
    resourceName: (node.value?.title || 'hud_progress_bar').replace(/[^a-zA-Z0-9_-]/g, '_')
  })
  return {
    ...kit,
    compositeUrl: encodeRgbaToPngDataUrl(kit.compositePreviewRgba, kit.width, kit.height),
    backplateUrl: encodeRgbaToPngDataUrl(kit.backplateRgba, kit.width, kit.height),
    fillStripUrl: encodeRgbaToPngDataUrl(kit.fillStripRgba, kit.width, kit.height),
    frameOverlayUrl: encodeRgbaToPngDataUrl(kit.frameOverlayRgba, kit.width, kit.height)
  }
})

/**
 * Maps 0..100% HP/Shield value onto the inner fill span (5.5% .. 94.5%) of the HUD bar texture
 * and clips from the right using `clip-path: inset(0 X% 0 0)` so the fill texture never squishes!
 */
function computeHudBarClipStyle(pct: number): { clipPath: string } {
  const clamped = Math.max(0, Math.min(100, Number(pct) || 0))
  const visibleRightPct = clamped <= 0 ? 0 : 5.5 + (clamped / 100) * 89.0
  const rightInset = Math.max(0, Math.min(100, 100 - visibleRightPct))
  return {
    clipPath: `inset(0 ${rightInset.toFixed(2)}% 0 0)`
  }
}

// --- UI Container Sandbox State: 3D Foil Tilt, 5-State Button Simulator, HUD Damage Trail & Live 9-Slice Resizer ---
const uiFoilTiltX = ref(0)
const uiFoilTiltY = ref(0)
const uiFoilSweepPos = ref(45)
const uiButtonSimState = ref<'normal' | 'hover' | 'pressed' | 'disabled' | 'focused'>('normal')
const uiHudCurrentHp = ref(78)
const uiHudTrailHp = ref(92)
let uiHudTrailTimer: ReturnType<typeof setTimeout> | null = null
const uiNineSliceTargetW = ref(240)
const uiNineSliceTargetH = ref(112)

function onUiFoilPointerMove(event: PointerEvent): void {
  const el = event.currentTarget as HTMLElement | null
  if (!el) return
  const rect = el.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return
  const nx = ((event.clientX - rect.left) / rect.width) * 2 - 1
  const ny = ((event.clientY - rect.top) / rect.height) * 2 - 1
  uiFoilTiltY.value = nx * 16
  uiFoilTiltX.value = -ny * 16
  uiFoilSweepPos.value = Math.round((nx + 1) * 0.5 * 100)
}

function resetUiFoilTilt(): void {
  uiFoilTiltX.value = 0
  uiFoilTiltY.value = 0
  uiFoilSweepPos.value = 45
}

const uiFoilTiltStyle = computed(() => ({
  transform: `perspective(680px) rotateX(${uiFoilTiltX.value.toFixed(1)}deg) rotateY(${uiFoilTiltY.value.toFixed(1)}deg)`
}))

const uiFoilShimmerOverlayStyle = computed(() => {
  const foilStrength = Math.max(
    0,
    Math.min(1, Number(node.value?.params.gameUiFoilStrength ?? 0.65))
  )
  const pos = uiFoilSweepPos.value
  return {
    opacity: (foilStrength * 0.72).toFixed(2),
    background: `linear-gradient(125deg, transparent ${Math.max(0, pos - 28)}%, rgba(56, 189, 248, 0.55) ${Math.max(0, pos - 10)}%, rgba(250, 204, 21, 0.75) ${pos}%, rgba(232, 121, 249, 0.55) ${Math.min(100, pos + 12)}%, transparent ${Math.min(100, pos + 30)}%)`
  }
})

function triggerHudDamage(amount: number): void {
  const prev = uiHudCurrentHp.value
  const next = Math.max(5, prev - amount)
  uiHudTrailHp.value = Math.max(uiHudTrailHp.value, prev)
  uiHudCurrentHp.value = next
  if (uiHudTrailTimer) clearTimeout(uiHudTrailTimer)
  uiHudTrailTimer = setTimeout(() => {
    uiHudTrailHp.value = uiHudCurrentHp.value
  }, 420)
}

function triggerHudHeal(amount: number): void {
  const next = Math.min(100, uiHudCurrentHp.value + amount)
  uiHudCurrentHp.value = next
  uiHudTrailHp.value = next
}

function resetHudHp(): void {
  uiHudCurrentHp.value = 100
  uiHudTrailHp.value = 100
}

function applyNineSlicePreset(w: number, h: number): void {
  uiNineSliceTargetW.value = w
  uiNineSliceTargetH.value = h
}

const uiNineSliceResizedDataUrl = computed(() => {
  if (node.value?.typeId !== 'game.pbrTile') return ''
  const stretchMode = (node.value?.params.gameNineSliceStretchMode ??
    'stretch') as NineSliceStretchMode
  const mode = effectiveImageAssetMode.value
  if (mode === 'hud_bar_kit' && uiLiveHudBarKit.value) {
    const kit = uiLiveHudBarKit.value
    const resized = renderNineSliceResizedRgba(
      kit.compositePreviewRgba,
      kit.width,
      kit.height,
      uiNineSliceTargetW.value,
      uiNineSliceTargetH.value,
      kit.nineSliceBorders,
      stretchMode
    )
    return encodeRgbaToPngDataUrl(resized, uiNineSliceTargetW.value, uiNineSliceTargetH.value)
  }
  if (mode === 'dialogue_kit' && uiLiveDialogueKit.value) {
    const kit = uiLiveDialogueKit.value
    const resized = renderNineSliceResizedRgba(
      kit.compositePreviewRgba,
      kit.width,
      kit.height,
      uiNineSliceTargetW.value,
      uiNineSliceTargetH.value,
      kit.nineSliceBorders,
      stretchMode
    )
    return encodeRgbaToPngDataUrl(resized, uiNineSliceTargetW.value, uiNineSliceTargetH.value)
  }
  const srcRgba =
    mode === 'composite_frame' && uiLiveFrameBundle.value
      ? uiLiveFrameBundle.value.compositeRgba
      : pbrLiveTileData.value.albedo
  const resized = renderNineSliceResizedRgba(
    srcRgba,
    PBR_TILE_DIM,
    PBR_TILE_DIM,
    uiNineSliceTargetW.value,
    uiNineSliceTargetH.value,
    pbrLiveNineSlice.value.borders,
    stretchMode
  )
  return encodeRgbaToPngDataUrl(resized, uiNineSliceTargetW.value, uiNineSliceTargetH.value)
})

function downloadUiFoilShader(): void {
  if (!uiLiveFrameBundle.value) return
  const stem = (node.value?.title?.trim() || 'layered_frame').replace(/\s+/g, '_')
  downloadTextFile(
    uiLiveFrameBundle.value.godotFoilShader,
    `${stem}_foil.gdshader`,
    'text/plain;charset=utf-8'
  )
}

function downloadHudGodotTscn(): void {
  if (!uiLiveHudBarKit.value) return
  const stem = (node.value?.title?.trim() || 'hud_progress_bar').replace(/\s+/g, '_')
  downloadTextFile(
    uiLiveHudBarKit.value.godotProgressBarTscn,
    `${stem}_hud_bar.tscn`,
    'text/plain;charset=utf-8'
  )
}

// --- Full-Game UI Suite: Polar/Radial HUD, RPG Dialogue Kit, Form Controls Atlas & 16:9 Screen Blueprint Composer ---
const uiLiveRadialHudKit = computed(() => {
  if (effectiveImageAssetMode.value !== 'radial_hud_kit') {
    return null
  }
  const stylePreset = (node.value?.params.gameUiStylePreset ??
    'dark_iron_parchment') as UiStylePreset
  const kit = synthesizeRadialHudKit(pbrLiveTileData.value.albedo, PBR_TILE_DIM, PBR_TILE_DIM, {
    stylePreset,
    resourceName: (node.value?.title || 'radial_hud').replace(/[^a-zA-Z0-9_-]/g, '_')
  })
  return {
    ...kit,
    cooldownMaskUrl: encodeRgbaToPngDataUrl(kit.cooldownWipeMaskRgba, kit.width, kit.height),
    skillSlotUrl: encodeRgbaToPngDataUrl(kit.skillSlotFrameRgba, kit.width, kit.height),
    minimapUrl: encodeRgbaToPngDataUrl(kit.minimapCompassRgba, kit.width, kit.height),
    actionWheelUrl: encodeRgbaToPngDataUrl(kit.actionWheelRgba, kit.width, kit.height)
  }
})

const uiLiveDialogueKit = computed(() => {
  if (effectiveImageAssetMode.value !== 'dialogue_kit') {
    return null
  }
  const stylePreset = (node.value?.params.gameUiStylePreset ??
    'dark_iron_parchment') as UiStylePreset
  const kit = synthesizeDialogueBoxKit(pbrLiveTileData.value.albedo, PBR_TILE_DIM, PBR_TILE_DIM, {
    stylePreset,
    resourceName: (node.value?.title || 'dialogue_box').replace(/[^a-zA-Z0-9_-]/g, '_')
  })
  return {
    ...kit,
    compositeUrl: encodeRgbaToPngDataUrl(kit.compositePreviewRgba, kit.width, kit.height),
    mainBoxUrl: encodeRgbaToPngDataUrl(kit.mainBoxRgba, kit.width, kit.height),
    nameplateUrl: encodeRgbaToPngDataUrl(kit.nameplateAndChoiceRgba, kit.width, kit.height),
    portraitCursorUrl: encodeRgbaToPngDataUrl(kit.portraitAndCursorRgba, kit.width, kit.height)
  }
})

const uiLiveControlsKit = computed(() => {
  if (effectiveImageAssetMode.value !== 'ui_controls_kit') {
    return null
  }
  const stylePreset = (node.value?.params.gameUiStylePreset ??
    'dark_iron_parchment') as UiStylePreset
  const kit = synthesizeUiFormControlsKit(
    pbrLiveTileData.value.albedo,
    PBR_TILE_DIM,
    PBR_TILE_DIM,
    {
      stylePreset,
      resourceName: (node.value?.title || 'ui_controls').replace(/[^a-zA-Z0-9_-]/g, '_')
    }
  )
  return {
    ...kit,
    atlasUrl: encodeRgbaToPngDataUrl(kit.atlasSheetRgba, kit.width, kit.height),
    tabsUrl: encodeRgbaToPngDataUrl(kit.tabsPairRgba, kit.width, kit.height),
    sliderUrl: encodeRgbaToPngDataUrl(kit.sliderAndScrollRgba, kit.width, kit.height),
    checkboxUrl: encodeRgbaToPngDataUrl(kit.checkboxAndToggleRgba, kit.width, kit.height)
  }
})

const uiSkillCooldowns = ref<number[]>([0, 0, 0, 0])
let uiCooldownTimers: Array<ReturnType<typeof setInterval> | null> = [null, null, null, null]

function triggerSkillCooldown(slotIndex = 0): void {
  const idx = Math.max(0, Math.min(3, slotIndex))
  if (uiCooldownTimers[idx]) {
    clearInterval(uiCooldownTimers[idx]!)
    uiCooldownTimers[idx] = null
  }
  uiSkillCooldowns.value[idx] = 100
  uiCooldownTimers[idx] = setInterval(() => {
    const next = Math.max(0, (uiSkillCooldowns.value[idx] ?? 0) - 4)
    uiSkillCooldowns.value[idx] = next
    if (next <= 0 && uiCooldownTimers[idx]) {
      clearInterval(uiCooldownTimers[idx]!)
      uiCooldownTimers[idx] = null
    }
  }, 80)
}

const dialogueSamples = [
  {
    speaker: 'ASTRAEA · VALKYRIE ENVOY',
    line: 'The Astral Gate is fracturing. Choose which relic we bind to the Sanctum core before the Void tide arrives!',
    choices: [
      'Bind the Solar Phoenix Core (+35% Burn Crit)',
      'Unseal the Abyssal Chrono Hourglass (Time Slow)',
      'Refuse the ritual and defend the bastion'
    ]
  },
  {
    speaker: 'MALAKOR · ASHEN SOVEREIGN',
    line: 'Mortal steel cannot sever a covenant forged in starfire. Step forward and witness the Eclipse!',
    choices: [
      'Draw the Runeblade and counter-strike',
      'Invoke the Royal Gold Aegis barrier',
      'Retreat to the high tower'
    ]
  },
  {
    speaker: 'LYRA · ARCHIVIST OF ECHOES',
    line: 'Every 9-slice border and shader mask has been calibrated. Your UI layout is ready for 1920×1080 deployment.',
    choices: [
      'Export Godot 4 Full-Screen .tscn Scene',
      'Switch UI Material Style Preset',
      'Inspect Inventory Paperdoll'
    ]
  }
]
const uiDialogueSampleIdx = ref(0)
const currentDialogueSample = computed(
  () => dialogueSamples[uiDialogueSampleIdx.value % dialogueSamples.length]!
)

function advanceDialogueLine(): void {
  uiDialogueSampleIdx.value = (uiDialogueSampleIdx.value + 1) % dialogueSamples.length
}

const activeScreenBlueprint = ref<UiScreenBlueprintPreset>('combat_hud')

function setScreenBlueprint(preset: UiScreenBlueprintPreset): void {
  const prevPreset = activeScreenBlueprint.value
  psScreenPages[prevPreset] = JSON.parse(JSON.stringify(psArtboardLayers.value))
  activeScreenBlueprint.value = preset
  const res = activeArtboardResolution.value
  if (psScreenPages[preset] !== undefined) {
    psArtboardLayers.value = JSON.parse(JSON.stringify(psScreenPages[preset]!))
  } else {
    psArtboardLayers.value = buildDefaultBlueprintLayers(preset, res.width, res.height)
    psScreenPages[preset] = JSON.parse(JSON.stringify(psArtboardLayers.value))
  }
  psSelectedLayerId.value = psArtboardLayers.value[0]?.id ?? ''
  recordAndPersistPsArtboard()
}

// ============================================================================
// Photoshop Artboard UI Studio State (Design Resolution · Layers · Icon Widgets)
// ============================================================================
type PsArtboardWidgetKind =
  | 'text_label'
  | 'panel_box'
  | 'custom_image'
  | 'avatar_medallion'
  | 'hp_bar'
  | 'shield_bar'
  | 'boss_bar'
  | 'minimap_compass'
  | 'skill_bar'
  | 'foil_card'
  | 'inventory_grid'
  | 'dialogue_box'
  | 'settings_panel'
  | 'ui_button'
  | 'currency_bar'
  | 'buff_icons'
  | 'key_prompt'
  | 'radial_wheel'
  | 'item_slot'
  | 'tab_bar'

type PsArtboardAnchorPreset = 'tl' | 'tc' | 'tr' | 'cl' | 'cc' | 'cr' | 'bl' | 'bc' | 'br'

interface PsArtboardLayerItem {
  id: string
  name: string
  kind: PsArtboardWidgetKind
  x: number
  y: number
  w: number
  h: number
  visible: boolean
  locked: boolean
  opacity: number
  blendMode: 'normal' | 'screen' | 'multiply' | 'overlay'
  anchorPreset?: PsArtboardAnchorPreset
  rotationDeg?: number
  customText?: string
  subText?: string
  valuePct?: number
  fontSize?: number
  textColor?: string
  accentColor?: string
  bgColor?: string
  borderRadius?: number
  customImageUrl?: string
}

const psResolutionPresets = [
  { id: '1920x1080', width: 1920, height: 1080, aspect: '16:9', label: '1920×1080 (16:9 FHD)' },
  { id: '2560x1440', width: 2560, height: 1440, aspect: '16:9', label: '2560×1440 (16:9 2K)' },
  { id: '1280x720', width: 1280, height: 720, aspect: '16:9', label: '1280×720 (16:9 Deck)' },
  {
    id: '2340x1080',
    width: 2340,
    height: 1080,
    aspect: '19.5:9',
    label: '2340×1080 (19.5:9 Mobile)'
  },
  { id: '1080x1920', width: 1080, height: 1920, aspect: '9:16', label: '1080×1920 (9:16 Portrait)' }
] as const

const psDesignResolutionId = ref<string>('1920x1080')
const activeArtboardResolution = computed(
  () =>
    psResolutionPresets.find((r) => r.id === psDesignResolutionId.value) ?? psResolutionPresets[0]
)
let lastArtboardRes = { width: 1920, height: 1080 }

const psArtboardZoom = ref(100)
const psShowRulers = ref(true)
const psShowSliceGuides = ref(false)
const psSnapGrid = ref(true)
const psCanvasBackdrop = ref<'dark' | 'checker' | 'blueprint'>('dark')
const psActiveTool = ref<'move' | 'slice'>('move')
const psArtboardCanvasRef = ref<HTMLElement | null>(null)
const psLayerImageInputRef = ref<HTMLInputElement | null>(null)
const psCursorArtboardPx = ref({ x: 960, y: 540 })
const psActiveSmartGuides = ref<Array<{ axis: 'x' | 'y'; px: number }>>([])

const psWidgetCatalog: Array<{ kind: PsArtboardWidgetKind; titleKey: string }> = [
  { kind: 'text_label', titleKey: 'gameNodes.uiContainer.psAddText' },
  { kind: 'panel_box', titleKey: 'gameNodes.uiContainer.psAddPanel' },
  { kind: 'custom_image', titleKey: 'gameNodes.uiContainer.psAddImage' },
  { kind: 'avatar_medallion', titleKey: 'gameNodes.uiContainer.psAddAvatar' },
  { kind: 'hp_bar', titleKey: 'gameNodes.uiContainer.psAddHpBar' },
  { kind: 'shield_bar', titleKey: 'gameNodes.uiContainer.psAddShieldBar' },
  { kind: 'boss_bar', titleKey: 'gameNodes.uiContainer.psAddBossBar' },
  { kind: 'minimap_compass', titleKey: 'gameNodes.uiContainer.psAddMinimap' },
  { kind: 'skill_bar', titleKey: 'gameNodes.uiContainer.psAddSkillBar' },
  { kind: 'foil_card', titleKey: 'gameNodes.uiContainer.psAddFoilCard' },
  { kind: 'inventory_grid', titleKey: 'gameNodes.uiContainer.psAddInventory' },
  { kind: 'dialogue_box', titleKey: 'gameNodes.uiContainer.psAddDialogue' },
  { kind: 'settings_panel', titleKey: 'gameNodes.uiContainer.psAddSettings' },
  { kind: 'ui_button', titleKey: 'gameNodes.uiContainer.psAddButton' },
  { kind: 'currency_bar', titleKey: 'gameNodes.uiContainer.psAddCurrency' },
  { kind: 'buff_icons', titleKey: 'gameNodes.uiContainer.psAddBuffRow' },
  { kind: 'key_prompt', titleKey: 'gameNodes.uiContainer.psAddKeyPrompt' },
  { kind: 'radial_wheel', titleKey: 'gameNodes.uiContainer.psAddRadialWheel' },
  { kind: 'item_slot', titleKey: 'gameNodes.uiContainer.psAddItemSlot' },
  { kind: 'tab_bar', titleKey: 'gameNodes.uiContainer.psAddTabBar' }
]

function buildDefaultBlueprintLayers(
  preset: UiScreenBlueprintPreset,
  resW = 1920,
  resH = 1080
): PsArtboardLayerItem[] {
  const sx = resW / 1920
  const sy = resH / 1080
  const scaleLayer = (
    id: string,
    name: string,
    kind: PsArtboardWidgetKind,
    x: number,
    y: number,
    w: number,
    h: number,
    extra?: Partial<PsArtboardLayerItem>
  ): PsArtboardLayerItem => ({
    id,
    name,
    kind,
    x: Math.round(x * sx),
    y: Math.round(y * sy),
    w: Math.round(w * sx),
    h: Math.round(h * sy),
    visible: true,
    locked: false,
    opacity: 100,
    blendMode: 'normal',
    anchorPreset: 'cc',
    rotationDeg: 0,
    ...extra
  })

  if (preset === 'blank_canvas') {
    return []
  }
  if (preset === 'title_menu') {
    return [
      scaleLayer('lyr_title_ver', 'Version_Copyright_Label', 'text_label', 1540, 1000, 340, 48, {
        customText: 'v1.4.2 · EARLY ACCESS BUILD',
        fontSize: 16,
        textColor: '#94a3b8',
        anchorPreset: 'br'
      }),
      scaleLayer('lyr_btn_quit', 'Btn_Exit_Desktop', 'ui_button', 760, 810, 400, 76, {
        customText: '✕ EXIT TO DESKTOP',
        anchorPreset: 'bc'
      }),
      scaleLayer('lyr_btn_cfg', 'Btn_Options_Settings', 'ui_button', 760, 714, 400, 76, {
        customText: '⚙️ SYSTEM OPTIONS',
        anchorPreset: 'bc'
      }),
      scaleLayer('lyr_btn_load', 'Btn_Continue_Save', 'ui_button', 760, 618, 400, 76, {
        customText: '📜 CONTINUE CHRONICLE',
        anchorPreset: 'bc'
      }),
      scaleLayer('lyr_btn_start', 'Btn_Start_New_Game', 'ui_button', 730, 510, 460, 88, {
        customText: '▶ START NEW CAMPAIGN',
        anchorPreset: 'cc'
      }),
      scaleLayer('lyr_title_logo', 'Game_Main_Logo_Banner', 'text_label', 460, 160, 1000, 220, {
        customText: 'CHRONICLES OF SOLARIS',
        subText: 'ASHEN SOVEREIGN EDITION',
        fontSize: 56,
        textColor: '#fef08a',
        anchorPreset: 'tc'
      })
    ]
  }
  if (preset === 'inventory_paperdoll') {
    return [
      scaleLayer('lyr_inv_curr', 'TopRight_Currency_Bar', 'currency_bar', 1320, 32, 480, 58, {
        customText: '🪙 12,450,💎 380,⚡ 120/120',
        anchorPreset: 'tr'
      }),
      scaleLayer('lyr_inv_grid', 'Bag_Inventory_Grid', 'inventory_grid', 820, 110, 980, 860, {
        anchorPreset: 'cr'
      }),
      scaleLayer('lyr_hero_card', 'Character_Paperdoll_Card', 'foil_card', 140, 120, 620, 740, {
        anchorPreset: 'cl'
      }),
      scaleLayer('lyr_equip_btn', 'Btn_Auto_Equip', 'ui_button', 260, 880, 380, 88, {
        customText: '⚔️ AUTO EQUIP',
        anchorPreset: 'bl'
      })
    ]
  }
  if (preset === 'skill_tree') {
    return [
      scaleLayer('lyr_tree_tabs', 'Talent_Branch_Tabs', 'tab_bar', 460, 36, 1000, 64, {
        customText: '🔥 SOLAR,❄️ FROST,⚡ ARCANE,🛡️ GUARDIAN',
        anchorPreset: 'tc'
      }),
      scaleLayer('lyr_tree_unlock', 'Btn_Unlock_Talent', 'ui_button', 1390, 880, 380, 84, {
        customText: '✨ UNLOCK NODE (2 SP)',
        anchorPreset: 'br'
      }),
      scaleLayer(
        'lyr_tree_inspector',
        'Talent_Detail_Inspector',
        'panel_box',
        1320,
        140,
        520,
        710,
        {
          customText: '🔥 SOLARIS NOVA (RANK 3/5)',
          subText:
            'Unleashes a ring of solar flame dealing 480% AoE Fire DMG and igniting enemies for 6s.\n\n• Cooldown: 12.0s\n• Mana Cost: 45 MP',
          anchorPreset: 'cr'
        }
      ),
      scaleLayer('lyr_node_ult', 'Node_Ultimate_Talent', 'avatar_medallion', 580, 160, 180, 180, {
        customText: 'ULT · MAX',
        anchorPreset: 'cc'
      }),
      scaleLayer('lyr_node_mid1', 'Node_Core_Passive_L', 'item_slot', 360, 440, 150, 150, {
        customText: '3/5',
        subText: 'IGNITE+',
        anchorPreset: 'cc'
      }),
      scaleLayer('lyr_node_mid2', 'Node_Core_Passive_R', 'item_slot', 820, 440, 150, 150, {
        customText: '5/5',
        subText: 'CRIT DMG',
        anchorPreset: 'cc'
      }),
      scaleLayer('lyr_node_root', 'Node_Starter_Mastery', 'item_slot', 595, 720, 150, 150, {
        customText: '1/1',
        subText: 'SOLAR CORE',
        anchorPreset: 'bc'
      })
    ]
  }
  if (preset === 'shop_gacha') {
    return [
      scaleLayer('lyr_shop_curr', 'TopRight_Currency_Bar', 'currency_bar', 1280, 36, 540, 62, {
        customText: '🪙 84,200,💎 6,400,🎟️ 12',
        anchorPreset: 'tr'
      }),
      scaleLayer('lyr_shop_tabs', 'Shop_Category_Tabs', 'tab_bar', 100, 36, 860, 62, {
        customText: '✨ LIMITED BANNER,⚔️ ARMORY,🧪 CONSUMABLES,💎 VIP PACKS',
        anchorPreset: 'tl'
      }),
      scaleLayer('lyr_gacha_10x', 'Btn_Summon_10X', 'ui_button', 1120, 890, 440, 92, {
        customText: '🌟 SUMMON ×10 (💎 1,600)',
        anchorPreset: 'br'
      }),
      scaleLayer('lyr_gacha_1x', 'Btn_Summon_1X', 'ui_button', 640, 890, 420, 92, {
        customText: '✨ SINGLE WISH (💎 160)',
        anchorPreset: 'bc'
      }),
      scaleLayer('lyr_card_3', 'Featured_Card_Right', 'foil_card', 1320, 150, 460, 680, {
        customText: 'SR · VOID ARCHON',
        anchorPreset: 'cr'
      }),
      scaleLayer('lyr_card_2', 'Featured_Card_Center_SSR', 'foil_card', 730, 130, 500, 710, {
        customText: 'SSR · SOLARIS DRAGONBLADE',
        anchorPreset: 'cc'
      }),
      scaleLayer('lyr_card_1', 'Featured_Card_Left', 'foil_card', 180, 150, 460, 680, {
        customText: 'SR · AEGIS OF DAWN',
        anchorPreset: 'cl'
      })
    ]
  }
  if (preset === 'dialogue_vn') {
    return [
      scaleLayer('lyr_dlg_box', 'Dialogue_Main_Box', 'dialogue_box', 140, 690, 1640, 320, {
        anchorPreset: 'bc'
      }),
      scaleLayer('lyr_choice_1', 'Choice_1_Solar_Core', 'ui_button', 520, 220, 880, 88, {
        customText: '✨ Shatter the Solar Core',
        anchorPreset: 'cc'
      }),
      scaleLayer('lyr_choice_2', 'Choice_2_Chrono_Seal', 'ui_button', 520, 340, 880, 88, {
        customText: '⏳ Invoke the Chrono Seal',
        anchorPreset: 'cc'
      }),
      scaleLayer('lyr_choice_3', 'Choice_3_Defend_Gate', 'ui_button', 520, 460, 880, 88, {
        customText: '🛡️ Hold the Citadel Gate',
        anchorPreset: 'cc'
      }),
      scaleLayer(
        'lyr_speaker_bust',
        'Speaker_Avatar_Frame',
        'avatar_medallion',
        140,
        450,
        210,
        210,
        {
          anchorPreset: 'bl'
        }
      )
    ]
  }
  if (preset === 'quest_victory') {
    return [
      scaleLayer('lyr_win_next', 'Btn_Next_Stage', 'ui_button', 980, 860, 420, 88, {
        customText: '▶ CONTINUE EXPEDITION',
        anchorPreset: 'bc'
      }),
      scaleLayer('lyr_win_retry', 'Btn_Replay_Stage', 'ui_button', 520, 860, 400, 88, {
        customText: '↻ REPLAY STAGE',
        anchorPreset: 'bc'
      }),
      scaleLayer('lyr_loot_4', 'Reward_Slot_4', 'item_slot', 1200, 560, 170, 170, {
        customText: '×2,500',
        subText: 'SOLAR COIN',
        anchorPreset: 'cc'
      }),
      scaleLayer('lyr_loot_3', 'Reward_Slot_3', 'item_slot', 990, 560, 170, 170, {
        customText: '×12',
        subText: 'STAR ORE',
        anchorPreset: 'cc'
      }),
      scaleLayer('lyr_loot_2', 'Reward_Slot_2', 'item_slot', 780, 560, 170, 170, {
        customText: '×3',
        subText: 'CHRONO KEY',
        anchorPreset: 'cc'
      }),
      scaleLayer('lyr_loot_1', 'Reward_Slot_1_SSR', 'item_slot', 570, 560, 170, 170, {
        customText: 'SSR',
        subText: 'DRAGON CORE',
        anchorPreset: 'cc'
      }),
      scaleLayer('lyr_win_panel', 'Victory_Summary_Panel', 'panel_box', 420, 240, 1080, 560, {
        customText: '🏆 STAGE 4-12 CLEAR · RANK S+',
        subText:
          '• Clear Time: 02:14 (Record!)\n• No Deaths Bonus: +50% EXP\n• Boss Break Achieved',
        anchorPreset: 'cc'
      }),
      scaleLayer('lyr_win_banner', 'Victory_Header_Title', 'text_label', 510, 90, 900, 130, {
        customText: '✨ VICTORY ACHIEVED ✨',
        subText: 'THE ASHEN CITADEL HAS FALLEN',
        fontSize: 52,
        textColor: '#fef08a',
        anchorPreset: 'tc'
      })
    ]
  }
  if (preset === 'settings_form') {
    return [
      scaleLayer('lyr_cfg_tabs', 'Settings_Category_Tabs', 'tab_bar', 360, 96, 1200, 64, {
        customText: '🔊 AUDIO,🖥️ GRAPHICS,🎮 CONTROLS,🌐 LANGUAGE',
        anchorPreset: 'tc'
      }),
      scaleLayer(
        'lyr_cfg_modal',
        'Settings_Controls_Panel',
        'settings_panel',
        360,
        180,
        1200,
        620,
        {
          anchorPreset: 'cc'
        }
      ),
      scaleLayer('lyr_cfg_apply', 'Btn_Apply_Settings', 'ui_button', 740, 840, 440, 92, {
        customText: '✓ APPLY SETTINGS',
        anchorPreset: 'bc'
      })
    ]
  }
  // Default: 'combat_hud' (Top-to-bottom PS Layer order: top-most first)
  return [
    scaleLayer('lyr_key_prompt', 'Interact_Key_Prompt', 'key_prompt', 830, 790, 260, 56, {
      customText: 'F',
      subText: 'INTERACT SHRINE',
      anchorPreset: 'bc'
    }),
    scaleLayer('lyr_skill_bar', 'Bottom_4Slot_Skill_Bar', 'skill_bar', 640, 896, 640, 148, {
      anchorPreset: 'bc'
    }),
    scaleLayer('lyr_minimap', 'TopRight_Minimap_Compass', 'minimap_compass', 1640, 36, 236, 236, {
      anchorPreset: 'tr'
    }),
    scaleLayer('lyr_boss_bar', 'TopCenter_Boss_HP_Bar', 'boss_bar', 580, 28, 760, 96, {
      valuePct: 78,
      anchorPreset: 'tc'
    }),
    scaleLayer('lyr_buff_row', 'Player_Buff_Debuff_Row', 'buff_icons', 228, 188, 320, 54, {
      customText: '⚔️+25%,🛡️12s,⚡HASTE,🔥BURN',
      anchorPreset: 'tl'
    }),
    scaleLayer('lyr_shield_bar', 'Player_Shield_Cyan_Bar', 'shield_bar', 228, 118, 440, 62, {
      valuePct: 84,
      anchorPreset: 'tl'
    }),
    scaleLayer('lyr_hp_bar', 'Player_HP_Crimson_Bar', 'hp_bar', 228, 44, 440, 66, {
      valuePct: 78,
      anchorPreset: 'tl'
    }),
    scaleLayer('lyr_avatar', 'Player_Avatar_Medallion', 'avatar_medallion', 42, 36, 168, 168, {
      customText: 'LV.60',
      anchorPreset: 'tl'
    })
  ]
}

const psScreenPages: Partial<Record<UiScreenBlueprintPreset, PsArtboardLayerItem[]>> = {}

const psArtboardLayers = ref<PsArtboardLayerItem[]>(
  buildDefaultBlueprintLayers('combat_hud', 1920, 1080)
)
const psSelectedLayerId = ref<string>(psArtboardLayers.value[0]?.id ?? '')

// 50-Step Undo / Redo History Stack + Clipboard
const psHistoryStack = ref<string[]>([JSON.stringify(psArtboardLayers.value)])
const psHistoryIndex = ref<number>(0)
let psClipboardLayer: PsArtboardLayerItem | null = null

const canPsUndo = computed(() => psHistoryIndex.value > 0)
const canPsRedo = computed(
  () => psHistoryIndex.value >= 0 && psHistoryIndex.value < psHistoryStack.value.length - 1
)

function pushPsHistorySnapshot(): void {
  const snap = JSON.stringify(psArtboardLayers.value)
  if (psHistoryStack.value[psHistoryIndex.value] === snap) return
  const nextStack = psHistoryStack.value.slice(0, psHistoryIndex.value + 1)
  nextStack.push(snap)
  if (nextStack.length > 50) {
    nextStack.shift()
  }
  psHistoryStack.value = nextStack
  psHistoryIndex.value = nextStack.length - 1
}

function undoPsArtboard(): void {
  if (!canPsUndo.value) return
  psHistoryIndex.value -= 1
  const snap = psHistoryStack.value[psHistoryIndex.value]
  if (snap) {
    psArtboardLayers.value = JSON.parse(snap)
    if (!psArtboardLayers.value.some((l) => l.id === psSelectedLayerId.value)) {
      psSelectedLayerId.value = psArtboardLayers.value[0]?.id ?? ''
    }
    persistPsArtboardToNode()
  }
}

function redoPsArtboard(): void {
  if (!canPsRedo.value) return
  psHistoryIndex.value += 1
  const snap = psHistoryStack.value[psHistoryIndex.value]
  if (snap) {
    psArtboardLayers.value = JSON.parse(snap)
    if (!psArtboardLayers.value.some((l) => l.id === psSelectedLayerId.value)) {
      psSelectedLayerId.value = psArtboardLayers.value[0]?.id ?? ''
    }
    persistPsArtboardToNode()
  }
}

let lastHydratedArtboardNodeId = ''

function persistPsArtboardToNode(): void {
  // No-op: legacy game.uiContainer artboard removed
}

function recordAndPersistPsArtboard(): void {
  pushPsHistorySnapshot()
  persistPsArtboardToNode()
}

// Render from bottom of layer list to top of layer list (Photoshop convention: index 0 is on top)
const psRenderOrderedLayers = computed(() => [...psArtboardLayers.value].reverse())

const psSelectedLayer = computed(
  () => psArtboardLayers.value.find((l) => l.id === psSelectedLayerId.value) ?? null
)

function resetPsArtboardLayers(preset: UiScreenBlueprintPreset): void {
  const res = activeArtboardResolution.value
  psArtboardLayers.value = buildDefaultBlueprintLayers(preset, res.width, res.height)
  psScreenPages[preset] = JSON.parse(JSON.stringify(psArtboardLayers.value))
  psSelectedLayerId.value = psArtboardLayers.value[0]?.id ?? ''
  recordAndPersistPsArtboard()
}

function clearCurrentPsArtboard(): void {
  psArtboardLayers.value = []
  psScreenPages[activeScreenBlueprint.value] = []
  psSelectedLayerId.value = ''
  recordAndPersistPsArtboard()
}

function applyThemeSuiteForStyle(stylePreset: UiStylePreset): void {
  const titleStr = (localTitle.value || node.value?.title || 'CELESTIAL CHRONICLES').trim()
  const suite = buildThemedArtboardSuitePayload(stylePreset, titleStr)
  for (const [k, v] of Object.entries(suite.pages)) {
    psScreenPages[k as UiScreenBlueprintPreset] = v as unknown as PsArtboardLayerItem[]
  }
  const activeKey = activeScreenBlueprint.value
  if (activeKey !== 'blank_canvas' && suite.pages[activeKey]) {
    psArtboardLayers.value = JSON.parse(
      JSON.stringify(suite.pages[activeKey])
    ) as PsArtboardLayerItem[]
    psSelectedLayerId.value = psArtboardLayers.value[0]?.id ?? ''
  }
  recordAndPersistPsArtboard()
}

function onPsStylePresetSelectChange(event: Event): void {
  const val = (event.target as HTMLSelectElement).value as UiStylePreset
  patchParams({
    gameUiStylePreset: val
  })
  applyThemeSuiteForStyle(val)
}

function applyActiveThemeToAllArtboards(): void {
  const stylePreset = (node.value?.params.gameUiStylePreset ??
    'celestial_star_gold') as UiStylePreset
  applyThemeSuiteForStyle(stylePreset)
}

function resetSelectedPsLayerSkin(): void {
  const cur = psSelectedLayer.value
  if (!cur) return
  cur.customImageUrl = undefined
  cur.bgColor = undefined
  cur.accentColor = undefined
  cur.borderRadius = undefined
  recordAndPersistPsArtboard()
}

function applyUpstreamImageToSelectedOrSpawn(upImg: {
  id: string
  title: string
  url: string
}): void {
  const cur = psSelectedLayer.value
  if (cur && !cur.locked) {
    cur.customImageUrl = upImg.url
    recordAndPersistPsArtboard()
  } else {
    spawnUpstreamImageLayer(upImg)
  }
}

function spawnUpstreamImageLayer(upImg: { id: string; title: string; url: string }): void {
  const res = activeArtboardResolution.value
  const w = Math.round(res.width * 0.16)
  const h = w
  const jitter = (psArtboardLayers.value.length % 6) * 28
  const newLayer: PsArtboardLayerItem = {
    id: `lyr_in_${Date.now()}_${Math.floor(Math.random() * 999)}`,
    name: upImg.title.replace(/\s+/g, '_') || 'In_Sprite',
    kind: 'custom_image',
    x: Math.round((res.width - w) * 0.5 + jitter),
    y: Math.round((res.height - h) * 0.5 + jitter),
    w,
    h,
    visible: true,
    locked: false,
    opacity: 100,
    blendMode: 'normal',
    anchorPreset: 'cc',
    customImageUrl: upImg.url
  }
  psArtboardLayers.value.unshift(newLayer)
  psSelectedLayerId.value = newLayer.id
  recordAndPersistPsArtboard()
}

function autoFillArtboardFromUpstreamImages(): void {
  const pool = upstreamInputImages.value
  if (pool.length === 0) return
  const visualSlots = psArtboardLayers.value.filter(
    (l) =>
      !l.locked &&
      (l.kind === 'avatar_medallion' ||
        l.kind === 'foil_card' ||
        l.kind === 'item_slot' ||
        l.kind === 'custom_image' ||
        l.kind === 'minimap_compass')
  )
  if (visualSlots.length > 0) {
    visualSlots.forEach((slot, idx) => {
      const chosen = pool[idx % pool.length]
      if (chosen) {
        slot.customImageUrl = chosen.url
      }
    })
    recordAndPersistPsArtboard()
  } else {
    pool.forEach((upImg) => spawnUpstreamImageLayer(upImg))
  }
}

function onPsResolutionChange(): void {
  const nextRes = activeArtboardResolution.value
  const oldW = Math.max(1, lastArtboardRes.width)
  const oldH = Math.max(1, lastArtboardRes.height)
  const sx = nextRes.width / oldW
  const sy = nextRes.height / oldH
  const uniformScale = Math.min(sx, sy)

  for (const lyr of psArtboardLayers.value) {
    const anchor = lyr.anchorPreset ?? 'cc'
    const rightMargin = oldW - (lyr.x + lyr.w)
    const bottomMargin = oldH - (lyr.y + lyr.h)
    const centerRatioX = (lyr.x + lyr.w * 0.5) / oldW
    const centerRatioY = (lyr.y + lyr.h * 0.5) / oldH

    const newW = Math.max(32, Math.round(lyr.w * uniformScale))
    const newH = Math.max(24, Math.round(lyr.h * uniformScale))

    let newX = Math.round(centerRatioX * nextRes.width - newW * 0.5)
    if (anchor.endsWith('l')) {
      newX = Math.round(lyr.x * uniformScale)
    } else if (anchor.endsWith('r')) {
      newX = Math.round(nextRes.width - rightMargin * uniformScale - newW)
    }

    let newY = Math.round(centerRatioY * nextRes.height - newH * 0.5)
    if (anchor.startsWith('t')) {
      newY = Math.round(lyr.y * uniformScale)
    } else if (anchor.startsWith('b')) {
      newY = Math.round(nextRes.height - bottomMargin * uniformScale - newH)
    }

    lyr.x = newX
    lyr.y = newY
    lyr.w = newW
    lyr.h = newH
  }
  lastArtboardRes = { width: nextRes.width, height: nextRes.height }
  recordAndPersistPsArtboard()
}

function alignSelectedPsLayer(
  mode: 'left' | 'center-h' | 'right' | 'top' | 'center-v' | 'bottom'
): void {
  const cur = psSelectedLayer.value
  if (!cur || cur.locked) return
  const res = activeArtboardResolution.value
  const margin = Math.round(res.width * 0.03)
  const marginY = Math.round(res.height * 0.04)
  if (mode === 'left') cur.x = margin
  else if (mode === 'center-h') cur.x = Math.round((res.width - cur.w) * 0.5)
  else if (mode === 'right') cur.x = Math.round(res.width - cur.w - margin)
  else if (mode === 'top') cur.y = marginY
  else if (mode === 'center-v') cur.y = Math.round((res.height - cur.h) * 0.5)
  else if (mode === 'bottom') cur.y = Math.round(res.height - cur.h - marginY)
  recordAndPersistPsArtboard()
}

function triggerPsLayerImageUpload(): void {
  psLayerImageInputRef.value?.click()
}

function onPsLayerImageSelected(event: Event): void {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file || !psSelectedLayer.value) return
  const reader = new FileReader()
  reader.onload = () => {
    if (typeof reader.result === 'string' && psSelectedLayer.value) {
      psSelectedLayer.value.customImageUrl = reader.result
      recordAndPersistPsArtboard()
    }
  }
  reader.readAsDataURL(file)
  input.value = ''
}

function cyclePsBackdrop(): void {
  const order: Array<'dark' | 'checker' | 'blueprint'> = ['dark', 'checker', 'blueprint']
  const idx = order.indexOf(psCanvasBackdrop.value)
  psCanvasBackdrop.value = order[(idx + 1) % order.length]!
}

const psHorizontalRulerTicks = computed(() => {
  const w = activeArtboardResolution.value.width
  const step = w >= 2000 ? 400 : 240
  const ticks: Array<{ px: number; pct: number }> = []
  for (let px = 0; px <= w; px += step) {
    ticks.push({ px, pct: (px / w) * 100 })
  }
  return ticks
})

const psVerticalRulerTicks = computed(() => {
  const h = activeArtboardResolution.value.height
  const step = h >= 1400 ? 300 : 180
  const ticks: Array<{ px: number; pct: number }> = []
  for (let px = 0; px <= h; px += step) {
    ticks.push({ px, pct: (px / h) * 100 })
  }
  return ticks
})

const psArtboardPaperStyle = computed(() => {
  const res = activeArtboardResolution.value
  const ratio = (res.width / res.height).toFixed(4)
  const zoomScale = (psArtboardZoom.value / 100).toFixed(2)
  return {
    aspectRatio: `${res.width} / ${res.height}`,
    width: `calc(min(100cqw - 16px, (100cqh - 26px) * ${ratio}) * ${zoomScale})`,
    maxWidth: 'none'
  }
})

function computePsLayerBoxStyle(layer: PsArtboardLayerItem): Record<string, string> {
  const res = activeArtboardResolution.value
  return {
    left: `${((layer.x / res.width) * 100).toFixed(3)}%`,
    top: `${((layer.y / res.height) * 100).toFixed(3)}%`,
    width: `${((layer.w / res.width) * 100).toFixed(3)}%`,
    height: `${((layer.h / res.height) * 100).toFixed(3)}%`,
    opacity: (Math.max(0, Math.min(100, layer.opacity)) / 100).toFixed(2),
    mixBlendMode: layer.blendMode,
    transform: layer.rotationDeg ? `rotate(${layer.rotationDeg}deg)` : 'none'
  }
}

function getPsLayerThumbUrl(kind: PsArtboardWidgetKind): string {
  const assets = uiFullScreenAssets.value
  switch (kind) {
    case 'avatar_medallion':
      return assets.portraitMedallionUrl
    case 'hp_bar':
    case 'boss_bar':
      return assets.hpFillUrl
    case 'shield_bar':
      return assets.shieldFillUrl
    case 'minimap_compass':
      return assets.minimapUrl
    case 'radial_wheel':
      return assets.actionWheelUrl
    case 'skill_bar':
    case 'buff_icons':
      return assets.skillSlotUrl
    case 'foil_card':
    case 'panel_box':
      return assets.cardCompositeUrl
    case 'inventory_grid':
    case 'custom_image':
    case 'item_slot':
      return assets.raritySlotUrl
    default:
      return assets.squareSlotUrl
  }
}

function spawnPsArtboardWidget(kind: PsArtboardWidgetKind): void {
  const res = activeArtboardResolution.value
  const defaults: Record<
    PsArtboardWidgetKind,
    { name: string; w: number; h: number; extra?: Partial<PsArtboardLayerItem> }
  > = {
    text_label: {
      name: 'Title_Text',
      w: 520,
      h: 96,
      extra: {
        customText: '⚔️ STAGE CLEAR · +2,500 GOLD',
        subText: 'VICTORY REWARD',
        fontSize: 42,
        textColor: '#fef08a',
        anchorPreset: 'tc'
      }
    },
    panel_box: {
      name: 'Window_Panel_9Slice',
      w: 680,
      h: 440,
      extra: {
        customText: '📜 QUEST OBJECTIVES',
        subText: '• Defeat the Ashen Sovereign (1/1)\n• Collect 3 Solar Relics (3/3)',
        bgColor: '#0c101c',
        accentColor: '#eab308',
        textColor: '#fef08a',
        borderRadius: 12,
        anchorPreset: 'cc'
      }
    },
    custom_image: {
      name: 'Custom_Icon_Sprite',
      w: 220,
      h: 220,
      extra: {
        customText: 'SSR RELIC',
        textColor: '#fef08a',
        accentColor: '#38bdf8',
        borderRadius: 10,
        anchorPreset: 'cc'
      }
    },
    avatar_medallion: {
      name: 'Avatar_Medallion',
      w: 180,
      h: 180,
      extra: { customText: 'LV.60', anchorPreset: 'tl' }
    },
    hp_bar: {
      name: 'HP_Crimson_Bar',
      w: 460,
      h: 68,
      extra: { valuePct: 78, anchorPreset: 'tl' }
    },
    shield_bar: {
      name: 'Shield_Cyan_Bar',
      w: 460,
      h: 64,
      extra: { valuePct: 84, anchorPreset: 'tl' }
    },
    boss_bar: {
      name: 'Boss_Inferno_Bar',
      w: 720,
      h: 96,
      extra: { valuePct: 78, anchorPreset: 'tc' }
    },
    minimap_compass: {
      name: 'Minimap_Compass_360',
      w: 240,
      h: 240,
      extra: { customText: 'N 024°', anchorPreset: 'tr' }
    },
    skill_bar: {
      name: 'Action_Skill_Bar_4Slot',
      w: 620,
      h: 144,
      extra: { customText: 'Q,E,R,SPACE', anchorPreset: 'bc' }
    },
    foil_card: { name: 'Foil_Card_Container', w: 360, h: 480, extra: { anchorPreset: 'cc' } },
    inventory_grid: { name: 'Inventory_Bag_Panel', w: 760, h: 560, extra: { anchorPreset: 'cc' } },
    dialogue_box: { name: 'Dialogue_Box_9Slice', w: 1320, h: 280, extra: { anchorPreset: 'bc' } },
    settings_panel: {
      name: 'Settings_Controls_Form',
      w: 840,
      h: 460,
      extra: { anchorPreset: 'cc' }
    },
    ui_button: {
      name: 'UI_Button_5State',
      w: 320,
      h: 88,
      extra: { customText: '▶ START GAME', anchorPreset: 'cc' }
    },
    currency_bar: {
      name: 'Top_Resource_Currency_Bar',
      w: 500,
      h: 60,
      extra: { customText: '🪙 12,450,💎 380,⚡ 120/120', anchorPreset: 'tr' }
    },
    buff_icons: {
      name: 'Status_Buff_Debuff_Row',
      w: 340,
      h: 58,
      extra: { customText: '⚔️+25%,🛡️12s,⚡HASTE,🔥BURN', anchorPreset: 'tl' }
    },
    key_prompt: {
      name: 'Key_Interaction_Prompt',
      w: 280,
      h: 58,
      extra: { customText: 'F', subText: 'OPEN CHEST', anchorPreset: 'bc' }
    },
    radial_wheel: {
      name: 'Radial_Weapon_Wheel_8',
      w: 360,
      h: 360,
      extra: { customText: 'SOLARGREATSWORD', anchorPreset: 'cc' }
    },
    item_slot: {
      name: 'Loot_Item_Slot_Card',
      w: 168,
      h: 168,
      extra: { customText: '×5', subText: 'SSR RELIC', anchorPreset: 'cc' }
    },
    tab_bar: {
      name: 'Top_Navigation_Tab_Bar',
      w: 840,
      h: 64,
      extra: { customText: '⚔️ WEAPONS,🛡️ ARMOR,🧪 ITEMS,✨ RELICS', anchorPreset: 'tc' }
    }
  }
  const spec = defaults[kind]
  const offset = (psArtboardLayers.value.length % 5) * 24
  const newLayer: PsArtboardLayerItem = {
    id: `lyr_${kind}_${Date.now().toString(36)}`,
    name: `${spec.name}_${psArtboardLayers.value.length + 1}`,
    kind,
    x: Math.round((res.width - spec.w) * 0.5 + offset),
    y: Math.round((res.height - spec.h) * 0.5 + offset),
    w: spec.w,
    h: spec.h,
    visible: true,
    locked: false,
    opacity: 100,
    blendMode: 'normal',
    anchorPreset: 'cc',
    rotationDeg: 0,
    ...spec.extra
  }
  psArtboardLayers.value.unshift(newLayer)
  psSelectedLayerId.value = newLayer.id
  recordAndPersistPsArtboard()
}

function duplicateSelectedPsLayer(): void {
  const cur = psSelectedLayer.value
  if (!cur) return
  const copy: PsArtboardLayerItem = {
    ...cur,
    id: `${cur.id}_dup_${Date.now().toString(36)}`,
    name: `${cur.name}_Copy`,
    x: cur.x + 32,
    y: cur.y + 32
  }
  psArtboardLayers.value.unshift(copy)
  psSelectedLayerId.value = copy.id
  recordAndPersistPsArtboard()
}

function moveSelectedPsLayer(deltaIdx: number): void {
  const idx = psArtboardLayers.value.findIndex((l) => l.id === psSelectedLayerId.value)
  if (idx < 0) return
  const targetIdx = idx + deltaIdx
  if (targetIdx < 0 || targetIdx >= psArtboardLayers.value.length) return
  const list = [...psArtboardLayers.value]
  const [item] = list.splice(idx, 1)
  if (!item) return
  list.splice(targetIdx, 0, item)
  psArtboardLayers.value = list
  recordAndPersistPsArtboard()
}

function deleteSelectedPsLayer(): void {
  if (!psSelectedLayerId.value) return
  psArtboardLayers.value = psArtboardLayers.value.filter((l) => l.id !== psSelectedLayerId.value)
  psSelectedLayerId.value = psArtboardLayers.value[0]?.id ?? ''
  recordAndPersistPsArtboard()
}

// Keyboard Shortcuts for Freeform PS Artboard (Undo/Redo, Copy/Paste, Delete, Arrow Nudge, Ctrl+D)
function onPsKeyDown(event: KeyboardEvent): void {
  if (pbrTab.value !== 'ui_screen') return
  const target = event.target as HTMLElement | null
  if (
    target &&
    (target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.tagName === 'SELECT' ||
      target.isContentEditable)
  ) {
    return
  }

  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
    event.preventDefault()
    if (event.shiftKey) {
      redoPsArtboard()
    } else {
      undoPsArtboard()
    }
    return
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
    event.preventDefault()
    redoPsArtboard()
    return
  }

  const cur = psSelectedLayer.value
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c' && cur) {
    event.preventDefault()
    psClipboardLayer = JSON.parse(JSON.stringify(cur))
    return
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v' && psClipboardLayer) {
    event.preventDefault()
    const pasted: PsArtboardLayerItem = {
      ...JSON.parse(JSON.stringify(psClipboardLayer)),
      id: `${psClipboardLayer.id}_paste_${Date.now().toString(36)}`,
      name: `${psClipboardLayer.name}_Paste`,
      x: psClipboardLayer.x + 28,
      y: psClipboardLayer.y + 28
    }
    psArtboardLayers.value.unshift(pasted)
    psSelectedLayerId.value = pasted.id
    recordAndPersistPsArtboard()
    return
  }

  if (!cur) return

  if (event.key === 'Delete' || event.key === 'Backspace') {
    if (!cur.locked) {
      event.preventDefault()
      deleteSelectedPsLayer()
    }
    return
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd') {
    event.preventDefault()
    duplicateSelectedPsLayer()
    return
  }
  if (cur.locked) return
  const step = event.shiftKey ? 8 : 1
  if (event.key === 'ArrowLeft') {
    event.preventDefault()
    cur.x -= step
    recordAndPersistPsArtboard()
  } else if (event.key === 'ArrowRight') {
    event.preventDefault()
    cur.x += step
    recordAndPersistPsArtboard()
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    cur.y -= step
    recordAndPersistPsArtboard()
  } else if (event.key === 'ArrowDown') {
    event.preventDefault()
    cur.y += step
    recordAndPersistPsArtboard()
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('keydown', onPsKeyDown)
}
onBeforeUnmount(() => {
  if (typeof window !== 'undefined') {
    window.removeEventListener('keydown', onPsKeyDown)
  }
})

// Interactive Drag & 8-Handle Resize State on the PS Artboard
let psDragState: {
  mode: 'move' | 'resize'
  layerId: string
  dir: string
  startClientX: number
  startClientY: number
  origX: number
  origY: number
  origW: number
  origH: number
} | null = null

function snapArtboardVal(val: number): number {
  return psSnapGrid.value ? Math.round(val / 8) * 8 : Math.round(val)
}

function onPsLayerPointerDown(event: PointerEvent, layer: PsArtboardLayerItem): void {
  psSelectedLayerId.value = layer.id
  if (layer.locked) return
  psDragState = {
    mode: 'move',
    layerId: layer.id,
    dir: '',
    startClientX: event.clientX,
    startClientY: event.clientY,
    origX: layer.x,
    origY: layer.y,
    origW: layer.w,
    origH: layer.h
  }
}

function onPsResizeHandleDown(event: PointerEvent, layer: PsArtboardLayerItem, dir: string): void {
  psSelectedLayerId.value = layer.id
  if (layer.locked) return
  psDragState = {
    mode: 'resize',
    layerId: layer.id,
    dir,
    startClientX: event.clientX,
    startClientY: event.clientY,
    origX: layer.x,
    origY: layer.y,
    origW: layer.w,
    origH: layer.h
  }
}

function onPsArtboardPointerMove(event: PointerEvent): void {
  const canvasEl = psArtboardCanvasRef.value
  if (!canvasEl) return
  const rect = canvasEl.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return
  const res = activeArtboardResolution.value

  // Update ruler cursor coordinates in Design Resolution pixels
  const curX = Math.max(
    0,
    Math.min(res.width, Math.round(((event.clientX - rect.left) / rect.width) * res.width))
  )
  const curY = Math.max(
    0,
    Math.min(res.height, Math.round(((event.clientY - rect.top) / rect.height) * res.height))
  )
  psCursorArtboardPx.value = { x: curX, y: curY }

  if (!psDragState) return
  const layer = psArtboardLayers.value.find((l) => l.id === psDragState?.layerId)
  if (!layer || layer.locked) return

  const dxPx = ((event.clientX - psDragState.startClientX) / rect.width) * res.width
  const dyPx = ((event.clientY - psDragState.startClientY) / rect.height) * res.height

  if (psDragState.mode === 'move') {
    let candX = Math.max(
      -layer.w * 0.5,
      Math.min(res.width - layer.w * 0.5, snapArtboardVal(psDragState.origX + dxPx))
    )
    let candY = Math.max(
      -layer.h * 0.5,
      Math.min(res.height - layer.h * 0.5, snapArtboardVal(psDragState.origY + dyPx))
    )

    // Smart Alignment Guides (Snap to Artboard Center & Other Visible Layers)
    const nextGuides: Array<{ axis: 'x' | 'y'; px: number }> = []
    const snapTol = 7

    const xTargets: number[] = [res.width * 0.5]
    const yTargets: number[] = [res.height * 0.5]
    for (const other of psArtboardLayers.value) {
      if (other.id === layer.id || !other.visible) continue
      xTargets.push(other.x, other.x + other.w * 0.5, other.x + other.w)
      yTargets.push(other.y, other.y + other.h * 0.5, other.y + other.h)
    }

    const myXPoints = [
      { offset: 0, val: candX },
      { offset: layer.w * 0.5, val: candX + layer.w * 0.5 },
      { offset: layer.w, val: candX + layer.w }
    ]
    for (const pt of myXPoints) {
      const hit = xTargets.find((t) => Math.abs(t - pt.val) <= snapTol)
      if (hit !== undefined) {
        candX = Math.round(hit - pt.offset)
        nextGuides.push({ axis: 'x', px: hit })
        break
      }
    }

    const myYPoints = [
      { offset: 0, val: candY },
      { offset: layer.h * 0.5, val: candY + layer.h * 0.5 },
      { offset: layer.h, val: candY + layer.h }
    ]
    for (const pt of myYPoints) {
      const hit = yTargets.find((t) => Math.abs(t - pt.val) <= snapTol)
      if (hit !== undefined) {
        candY = Math.round(hit - pt.offset)
        nextGuides.push({ axis: 'y', px: hit })
        break
      }
    }

    psActiveSmartGuides.value = nextGuides
    layer.x = candX
    layer.y = candY
    return
  }

  // 8-direction PS Transform Handle Resize
  const dir = psDragState.dir
  let nx = psDragState.origX
  let ny = psDragState.origY
  let nw = psDragState.origW
  let nh = psDragState.origH

  if (dir.includes('e')) {
    nw = Math.max(48, snapArtboardVal(psDragState.origW + dxPx))
  }
  if (dir.includes('s')) {
    nh = Math.max(32, snapArtboardVal(psDragState.origH + dyPx))
  }
  if (dir.includes('w')) {
    const nextW = Math.max(48, snapArtboardVal(psDragState.origW - dxPx))
    nx = psDragState.origX + (psDragState.origW - nextW)
    nw = nextW
  }
  if (dir.includes('n')) {
    const nextH = Math.max(32, snapArtboardVal(psDragState.origH - dyPx))
    ny = psDragState.origY + (psDragState.origH - nextH)
    nh = nextH
  }
  layer.x = nx
  layer.y = ny
  layer.w = nw
  layer.h = nh
}

function onPsArtboardPointerUp(): void {
  psActiveSmartGuides.value = []
  if (psDragState) {
    psDragState = null
    recordAndPersistPsArtboard()
  }
}

const uiSelectedBagTab = ref(0)
const uiSelectedBagItemIdx = ref(0)
const bagMockItems = [
  {
    name: 'Solaris Dragonblade +9',
    tag: 'SSR',
    rarity: 'LEGENDARY WEAPON',
    desc: 'Deals +420 Solar Fire DMG and triggers a 360° crimson slash arc on critical hit.'
  },
  {
    name: 'Aegis of the Crown',
    tag: 'SR',
    rarity: 'EPIC SHIELD',
    desc: 'Absorbs 850 damage and reflects 25% of incoming projectiles as golden bolts.'
  },
  {
    name: 'Chrono Starlight Flask',
    tag: 'SSR',
    rarity: 'MYTHIC RELIC',
    desc: 'Restores 60% HP instantly and resets all active radial skill cooldowns.'
  },
  {
    name: 'Voidwalker Boots',
    tag: 'R',
    rarity: 'RARE BOOTS',
    desc: '+18% movement speed and leaves an arcane distortion trail when dashing.'
  },
  {
    name: 'Runic Oath Ring',
    tag: 'SR',
    rarity: 'EPIC RING',
    desc: 'Reduces mana cost of all elemental skills by 22%.'
  },
  {
    name: 'Celestial Grimoire',
    tag: 'SSR',
    rarity: 'LEGENDARY TOME',
    desc: 'Grants +35% spell crit damage and summons 2 orbiting arcane crystals.'
  },
  {
    name: 'Ironclad Vanguard Helm',
    tag: 'R',
    rarity: 'RARE HELM',
    desc: '+260 Armor and immunity to stun during heavy attacks.'
  },
  {
    name: 'Emerald Alchemist Vial',
    tag: 'N',
    rarity: 'CONSUMABLE',
    desc: 'Applies Poison Nova to weapon strikes for 12 seconds.'
  }
]

const uiFormMasterVol = ref(86)
const uiFormBgmVol = ref(72)
const uiFormFullscreen = ref(true)
const uiFormScreenShake = ref(true)

const uiFullScreenAssets = computed(() => {
  const albedo = pbrLiveTileData.value.albedo
  const stylePreset = (node.value?.params.gameUiStylePreset ??
    'dark_iron_parchment') as UiStylePreset
  const rarity = (node.value?.params.gameIconRarityTier ?? 'legendary') as IconRarityTier
  const portraitMedallion = composeLayeredFrameTemplate(albedo, PBR_TILE_DIM, PBR_TILE_DIM, {
    frameShape: 'octagonal_medallion',
    rarity,
    stylePreset
  })
  const squareSlot = composeLayeredFrameTemplate(albedo, PBR_TILE_DIM, PBR_TILE_DIM, {
    frameShape: 'square_slot',
    rarity,
    stylePreset
  })
  const cardComposite = composeLayeredFrameTemplate(albedo, PBR_TILE_DIM, PBR_TILE_DIM, {
    frameShape: 'rect_card',
    rarity,
    stylePreset
  })
  const hpBar = synthesizeHudProgressBarKit(albedo, HUD_BAR_W, HUD_BAR_H, {
    preset: 'hp_crimson',
    stylePreset
  })
  const shieldBar = synthesizeHudProgressBarKit(albedo, HUD_BAR_W, HUD_BAR_H, {
    preset: 'shield_cyan',
    stylePreset
  })
  const radialKit = synthesizeRadialHudKit(albedo, PBR_TILE_DIM, PBR_TILE_DIM, {
    stylePreset
  })
  const raritySlot = compositeIconWithRarityFrame(albedo, PBR_TILE_DIM, PBR_TILE_DIM, rarity)
  return {
    portraitMedallionUrl: encodeRgbaToPngDataUrl(
      portraitMedallion.compositeRgba,
      PBR_TILE_DIM,
      PBR_TILE_DIM
    ),
    squareSlotUrl: encodeRgbaToPngDataUrl(squareSlot.compositeRgba, PBR_TILE_DIM, PBR_TILE_DIM),
    cardCompositeUrl: encodeRgbaToPngDataUrl(
      cardComposite.compositeRgba,
      PBR_TILE_DIM,
      PBR_TILE_DIM
    ),
    hpBackplateUrl: encodeRgbaToPngDataUrl(hpBar.backplateRgba, HUD_BAR_W, HUD_BAR_H),
    hpFillUrl: encodeRgbaToPngDataUrl(hpBar.fillStripRgba, HUD_BAR_W, HUD_BAR_H),
    hpFrameUrl: encodeRgbaToPngDataUrl(hpBar.frameOverlayRgba, HUD_BAR_W, HUD_BAR_H),
    shieldFillUrl: encodeRgbaToPngDataUrl(shieldBar.fillStripRgba, HUD_BAR_W, HUD_BAR_H),
    minimapUrl: encodeRgbaToPngDataUrl(radialKit.minimapCompassRgba, PBR_TILE_DIM, PBR_TILE_DIM),
    skillSlotUrl: encodeRgbaToPngDataUrl(radialKit.skillSlotFrameRgba, PBR_TILE_DIM, PBR_TILE_DIM),
    actionWheelUrl: encodeRgbaToPngDataUrl(radialKit.actionWheelRgba, PBR_TILE_DIM, PBR_TILE_DIM),
    raritySlotUrl: encodeRgbaToPngDataUrl(raritySlot.data, raritySlot.width, raritySlot.height)
  }
})

function downloadFullScreenUiTscn(): void {
  const stem = (node.value?.title?.trim() || 'game_ui_screen').replace(/\s+/g, '_')
  const stylePreset = (node.value?.params.gameUiStylePreset ??
    'dark_iron_parchment') as UiStylePreset
  const res = activeArtboardResolution.value
  const baseTscn = exportGodotFullScreenUiTscn(activeScreenBlueprint.value, stylePreset, stem)
  const customLayersNodes = psRenderOrderedLayers.value
    .filter((l) => l.visible)
    .map((l) =>
      [
        `[node name="${l.name.replace(/[^a-zA-Z0-9_-]/g, '_')}" type="Control" parent="."]`,
        `offset_left = ${Math.round(l.x)}.0`,
        `offset_top = ${Math.round(l.y)}.0`,
        `offset_right = ${Math.round(l.x + l.w)}.0`,
        `offset_bottom = ${Math.round(l.y + l.h)}.0`,
        l.rotationDeg ? `rotation = ${((l.rotationDeg * Math.PI) / 180).toFixed(4)}` : '',
        `modulate = Color(1, 1, 1, ${(l.opacity / 100).toFixed(2)})`,
        `metadata/widget_kind = "${l.kind}"`,
        `metadata/anchor_preset = "${l.anchorPreset ?? 'cc'}"`,
        `metadata/blend_mode = "${l.blendMode}"`,
        l.customText ? `metadata/custom_text = ${JSON.stringify(l.customText)}` : '',
        l.valuePct !== undefined ? `metadata/value_pct = ${Number(l.valuePct)}` : '',
        ''
      ]
        .filter(Boolean)
        .join('\n')
    )
    .join('\n\n')
  const fullTscn = `${baseTscn}\n# --- PS Artboard Custom Layers (${res.width}x${res.height}) ---\n${customLayersNodes}\n`
  downloadTextFile(
    fullTscn,
    `${stem}_${activeScreenBlueprint.value}_${res.width}x${res.height}.tscn`,
    'text/plain;charset=utf-8'
  )
}

function exportArtboardAsUniversalJson(): void {
  const stem = (node.value?.title?.trim() || 'game_ui_layout').replace(/\s+/g, '_')
  const res = activeArtboardResolution.value
  const stylePreset = (node.value?.params.gameUiStylePreset ??
    'dark_iron_parchment') as UiStylePreset
  const anchorMap: Record<PsArtboardAnchorPreset, [number, number]> = {
    tl: [0, 0],
    tc: [0.5, 0],
    tr: [1, 0],
    cl: [0, 0.5],
    cc: [0.5, 0.5],
    cr: [1, 0.5],
    bl: [0, 1],
    bc: [0.5, 1],
    br: [1, 1]
  }
  const spec = {
    schemaVersion: '2.0.0',
    generator: 'AI-Art-Engine PS UI Studio',
    designResolution: {
      id: res.id,
      width: res.width,
      height: res.height,
      aspect: res.aspect
    },
    stylePreset,
    activeBlueprint: activeScreenBlueprint.value,
    nineSlicePatchMargins: { left: 24, top: 24, right: 24, bottom: 24 },
    layersBottomToTop: psRenderOrderedLayers.value.map((l, idx) => {
      const anchorKey = l.anchorPreset ?? 'cc'
      const [ax, ay] = anchorMap[anchorKey] ?? [0.5, 0.5]
      return {
        zIndex: idx,
        id: l.id,
        name: l.name,
        kind: l.kind,
        visible: l.visible,
        locked: l.locked,
        rectPx: { x: Math.round(l.x), y: Math.round(l.y), w: Math.round(l.w), h: Math.round(l.h) },
        normalizedRect: {
          x: Number((l.x / res.width).toFixed(4)),
          y: Number((l.y / res.height).toFixed(4)),
          w: Number((l.w / res.width).toFixed(4)),
          h: Number((l.h / res.height).toFixed(4))
        },
        anchorPreset: anchorKey,
        anchorPivot: { x: ax, y: ay },
        rotationDeg: l.rotationDeg ?? 0,
        opacity: l.opacity,
        blendMode: l.blendMode,
        props: {
          customText: l.customText,
          subText: l.subText,
          valuePct: l.valuePct,
          fontSize: l.fontSize,
          textColor: l.textColor,
          accentColor: l.accentColor,
          bgColor: l.bgColor,
          borderRadius: l.borderRadius
        }
      }
    }),
    allScreenBlueprints: psScreenPages
  }
  downloadTextFile(
    JSON.stringify(spec, null, 2),
    `${stem}_${activeScreenBlueprint.value}_${res.width}x${res.height}.ui.json`,
    'application/json;charset=utf-8'
  )
}

async function loadCanvasImage(src: string): Promise<HTMLImageElement | null> {
  if (!src || typeof Image === 'undefined') return null
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = src
  })
}

async function renderArtboardToCanvas(): Promise<{
  fullCanvas: HTMLCanvasElement
  thumbDataUrl: string
} | null> {
  if (typeof document === 'undefined') return null
  const res = activeArtboardResolution.value
  const canvas = document.createElement('canvas')
  canvas.width = res.width
  canvas.height = res.height
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  // 1. Render Artboard Backdrop
  const bgGrad = ctx.createRadialGradient(
    res.width * 0.5,
    res.height * 0.35,
    40,
    res.width * 0.5,
    res.height * 0.5,
    Math.max(res.width, res.height) * 0.75
  )
  bgGrad.addColorStop(0, '#1e293b')
  bgGrad.addColorStop(1, '#090a12')
  ctx.fillStyle = bgGrad
  ctx.fillRect(0, 0, res.width, res.height)

  const assets = uiFullScreenAssets.value
  const [
    avatarImg,
    hpBackImg,
    hpFillImg,
    hpFrameImg,
    shieldFillImg,
    minimapImg,
    skillSlotImg,
    actionWheelImg,
    cardImg,
    squareSlotImg,
    raritySlotImg
  ] = await Promise.all([
    loadCanvasImage(assets.portraitMedallionUrl),
    loadCanvasImage(assets.hpBackplateUrl),
    loadCanvasImage(assets.hpFillUrl),
    loadCanvasImage(assets.hpFrameUrl),
    loadCanvasImage(assets.shieldFillUrl),
    loadCanvasImage(assets.minimapUrl),
    loadCanvasImage(assets.skillSlotUrl),
    loadCanvasImage(assets.actionWheelUrl),
    loadCanvasImage(assets.cardCompositeUrl),
    loadCanvasImage(assets.squareSlotUrl),
    loadCanvasImage(assets.raritySlotUrl)
  ])

  // 2. Render Visible Layers in Bottom-to-Top Order
  for (const lyr of psRenderOrderedLayers.value) {
    if (!lyr.visible) continue
    ctx.save()
    ctx.globalAlpha = Math.max(0, Math.min(1, lyr.opacity / 100))
    ctx.globalCompositeOperation = lyr.blendMode === 'normal' ? 'source-over' : lyr.blendMode

    if (lyr.rotationDeg) {
      const cx = lyr.x + lyr.w * 0.5
      const cy = lyr.y + lyr.h * 0.5
      ctx.translate(cx, cy)
      ctx.rotate((lyr.rotationDeg * Math.PI) / 180)
      ctx.translate(-cx, -cy)
    }

    const customImg = lyr.customImageUrl ? await loadCanvasImage(lyr.customImageUrl) : null

    if (lyr.kind === 'text_label') {
      const fSize = Math.max(14, lyr.fontSize ?? 36)
      ctx.font = `900 ${fSize}px sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.lineWidth = Math.max(3, Math.round(fSize * 0.14))
      ctx.strokeStyle = '#090a12'
      ctx.fillStyle = lyr.textColor || '#fef08a'
      const textStr = lyr.customText || lyr.name
      ctx.strokeText(textStr, lyr.x + lyr.w * 0.5, lyr.y + lyr.h * 0.45)
      ctx.fillText(textStr, lyr.x + lyr.w * 0.5, lyr.y + lyr.h * 0.45)
      if (lyr.subText) {
        const subSize = Math.max(11, Math.round(fSize * 0.55))
        ctx.font = `700 ${subSize}px sans-serif`
        ctx.fillStyle = '#cbd5e1'
        ctx.fillText(lyr.subText, lyr.x + lyr.w * 0.5, lyr.y + lyr.h * 0.8)
      }
    } else if (
      lyr.kind === 'panel_box' ||
      lyr.kind === 'dialogue_box' ||
      lyr.kind === 'settings_panel' ||
      lyr.kind === 'inventory_grid'
    ) {
      ctx.fillStyle = lyr.bgColor || 'rgba(12, 16, 28, 0.9)'
      ctx.strokeStyle = lyr.accentColor || '#eab308'
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.roundRect(lyr.x, lyr.y, lyr.w, lyr.h, lyr.borderRadius ?? 12)
      ctx.fill()
      ctx.stroke()

      const headerTitle =
        lyr.customText ||
        (lyr.kind === 'dialogue_box'
          ? currentDialogueSample.value.line
          : lyr.kind === 'inventory_grid'
            ? '🎒 INVENTORY & EQUIPMENT'
            : lyr.kind === 'settings_panel'
              ? '⚙️ SYSTEM SETTINGS'
              : lyr.name)
      ctx.fillStyle = lyr.textColor || '#fef08a'
      ctx.font = '800 24px sans-serif'
      ctx.textAlign = 'left'
      ctx.textBaseline = 'top'
      ctx.fillText(headerTitle, lyr.x + 28, lyr.y + 24, lyr.w - 56)

      if (lyr.subText) {
        ctx.fillStyle = '#e2e8f0'
        ctx.font = '600 18px sans-serif'
        ctx.fillText(lyr.subText, lyr.x + 28, lyr.y + 66, lyr.w - 56)
      }
    } else if (lyr.kind === 'hp_bar' || lyr.kind === 'shield_bar' || lyr.kind === 'boss_bar') {
      const pct = Math.max(
        0,
        Math.min(100, lyr.valuePct ?? (lyr.kind === 'shield_bar' ? 84 : uiHudCurrentHp.value))
      )
      const fillImg = lyr.kind === 'shield_bar' ? shieldFillImg : hpFillImg
      if (hpBackImg) ctx.drawImage(hpBackImg, lyr.x, lyr.y, lyr.w, lyr.h)
      if (fillImg && pct > 0) {
        const visRatio = 0.055 + (pct / 100) * 0.89
        ctx.save()
        ctx.beginPath()
        ctx.rect(lyr.x, lyr.y, lyr.w * visRatio, lyr.h)
        ctx.clip()
        ctx.drawImage(fillImg, lyr.x, lyr.y, lyr.w, lyr.h)
        ctx.restore()
      }
      if (hpFrameImg) ctx.drawImage(hpFrameImg, lyr.x, lyr.y, lyr.w, lyr.h)
      const barLabel =
        lyr.customText ||
        (lyr.kind === 'boss_bar'
          ? '🔥 MALAKOR, ASHEN SOVEREIGN'
          : `${lyr.kind === 'shield_bar' ? 'SHIELD' : 'HP'} ${Math.round(pct * 10)} / 1000`)
      ctx.font = '800 20px sans-serif'
      ctx.fillStyle = lyr.textColor || '#ffffff'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(barLabel, lyr.x + lyr.w * 0.5, lyr.y + lyr.h * 0.5)
    } else if (lyr.kind === 'skill_bar' || lyr.kind === 'buff_icons') {
      const keys = (
        lyr.customText
          ? lyr.customText.split(',')
          : lyr.kind === 'buff_icons'
            ? ['⚔️+25%', '🛡️12s', '⚡HASTE', '🔥BURN']
            : ['Q', 'E', 'R', 'SPACE']
      ).slice(0, 4)
      const slotW = (lyr.w - 36) / 4
      for (let i = 0; i < 4; i++) {
        const sx = lyr.x + 6 + i * (slotW + 8)
        if (skillSlotImg) ctx.drawImage(skillSlotImg, sx, lyr.y + 4, slotW, lyr.h - 8)
        ctx.font = '800 15px sans-serif'
        ctx.fillStyle = lyr.textColor || '#facc15'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'bottom'
        ctx.fillText((keys[i] || '').trim(), sx + slotW * 0.5, lyr.y + lyr.h - 8)
      }
    } else if (lyr.kind === 'currency_bar' || lyr.kind === 'tab_bar') {
      const items = (
        lyr.customText
          ? lyr.customText.split(',')
          : lyr.kind === 'currency_bar'
            ? ['🪙 12,450', '💎 380', '⚡ 120/120']
            : ['⚔️ WEAPONS', '🛡️ ARMOR', '🧪 ITEMS', '✨ RELICS']
      ).slice(0, 4)
      const cellW = (lyr.w - (items.length - 1) * 10) / Math.max(1, items.length)
      for (let i = 0; i < items.length; i++) {
        const cx = lyr.x + i * (cellW + 10)
        ctx.fillStyle =
          i === 0 && lyr.kind === 'tab_bar' ? 'rgba(234, 179, 8, 0.28)' : 'rgba(12, 16, 28, 0.88)'
        ctx.strokeStyle = i === 0 && lyr.kind === 'tab_bar' ? '#facc15' : 'rgba(250, 204, 21, 0.45)'
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.roundRect(cx, lyr.y, cellW, lyr.h, 8)
        ctx.fill()
        ctx.stroke()
        ctx.font = '800 18px sans-serif'
        ctx.fillStyle = lyr.textColor || '#fef08a'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText((items[i] || '').trim(), cx + cellW * 0.5, lyr.y + lyr.h * 0.5)
      }
    } else if (lyr.kind === 'key_prompt') {
      ctx.fillStyle = 'rgba(12, 16, 28, 0.92)'
      ctx.strokeStyle = lyr.accentColor || '#38bdf8'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.roundRect(lyr.x, lyr.y, lyr.w, lyr.h, 99)
      ctx.fill()
      ctx.stroke()
      ctx.font = '900 18px sans-serif'
      ctx.fillStyle = lyr.textColor || '#fef08a'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(
        `[${lyr.customText || 'F'}] ${lyr.subText || 'INTERACT'}`,
        lyr.x + lyr.w * 0.5,
        lyr.y + lyr.h * 0.5
      )
    } else {
      const targetImg =
        customImg ||
        (lyr.kind === 'avatar_medallion'
          ? avatarImg
          : lyr.kind === 'minimap_compass'
            ? minimapImg
            : lyr.kind === 'radial_wheel'
              ? actionWheelImg
              : lyr.kind === 'foil_card'
                ? cardImg
                : lyr.kind === 'custom_image' || lyr.kind === 'item_slot'
                  ? raritySlotImg
                  : squareSlotImg)
      if (targetImg) {
        ctx.drawImage(targetImg, lyr.x, lyr.y, lyr.w, lyr.h)
      }
      const badgeStr =
        lyr.customText ||
        (lyr.kind === 'avatar_medallion'
          ? 'LV.60'
          : lyr.kind === 'minimap_compass'
            ? 'N 024°'
            : lyr.kind === 'ui_button'
              ? lyr.name
              : '')
      if (badgeStr) {
        ctx.font = '800 20px sans-serif'
        ctx.fillStyle = lyr.textColor || '#fef08a'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        const by =
          lyr.kind === 'minimap_compass' || lyr.kind === 'item_slot'
            ? lyr.y + 22
            : lyr.kind === 'avatar_medallion'
              ? lyr.y + lyr.h - 18
              : lyr.y + lyr.h * 0.5
        ctx.fillText(badgeStr, lyr.x + lyr.w * 0.5, by)
      }
    }
    ctx.restore()
  }

  // Generate a 640px preview for the graph node card & Cook execution
  const thumbCanvas = document.createElement('canvas')
  const thumbW = 640
  const thumbH = Math.max(360, Math.round((res.height / res.width) * thumbW))
  thumbCanvas.width = thumbW
  thumbCanvas.height = thumbH
  const tCtx = thumbCanvas.getContext('2d')
  let thumbDataUrl = ''
  if (tCtx) {
    tCtx.drawImage(canvas, 0, 0, thumbW, thumbH)
    thumbDataUrl = thumbCanvas.toDataURL('image/png')
    patchParams({
      previewDataUrl: thumbDataUrl
    })
    persistPsArtboardToNode()
  }
  return { fullCanvas: canvas, thumbDataUrl }
}

async function exportArtboardAsPng(): Promise<void> {
  const rendered = await renderArtboardToCanvas()
  if (!rendered) return
  const res = activeArtboardResolution.value
  const fullDataUrl = rendered.fullCanvas.toDataURL('image/png')
  const stem = (node.value?.title?.trim() || 'game_ui_artboard').replace(/\s+/g, '_')
  downloadDataUrlFile(fullDataUrl, `${stem}_${res.width}x${res.height}.png`)
}

async function onWorkbenchRunToggle(): Promise<void> {
  toggleRun()
}

const vfxLivePipeline = computed(() => {
  const current = node.value
  const frameCountRaw = Number(current?.params.gameVfxFrameCount ?? 8)
  const frameCount = frameCountRaw <= 4 ? 4 : frameCountRaw >= 16 ? 16 : 8
  const fps = Math.max(4, Math.min(60, Math.round(Number(current?.params.gameVfxFps ?? 14))))
  const palette = (current?.params.gameVfxPalette ?? 'original') as VfxElementalPalette
  const bloomStrength = Math.max(
    0,
    Math.min(1.5, Number(current?.params.gameVfxBloomStrength ?? 0.45))
  )
  const dissolveErosion = Math.max(
    0,
    Math.min(1.0, Number(current?.params.gameVfxDissolveErosion ?? 0.35))
  )
  const edgeFeather = Math.max(
    0,
    Math.min(0.35, Number(current?.params.gameVfxEdgeFeather ?? 0.12))
  )
  const turbulence = Math.max(0, Math.min(1.2, Number(current?.params.gameVfxTurbulence ?? 0.45)))
  const sparkCount = Math.max(
    0,
    Math.min(96, Math.round(Number(current?.params.gameVfxSparkCount ?? 36)))
  )
  const distortionStrength = Math.max(
    0,
    Math.min(0.12, Number(current?.params.gameVfxDistortionStrength ?? 0.035))
  )
  const blackClip = Math.max(0, Math.min(0.45, Number(current?.params.gameVfxBlackClip ?? 0.04)))
  const whitePoint = Math.max(
    blackClip + 0.1,
    Math.min(1.0, Number(current?.params.gameVfxWhitePoint ?? 0.88))
  )
  const gamma = Math.max(0.25, Math.min(2.5, Number(current?.params.gameVfxGamma ?? 0.85)))
  const colorBoost = Math.max(1.0, Math.min(2.2, Number(current?.params.gameVfxColorBoost ?? 1.15)))
  return synthesizeVfxFlipbookPipeline(pbrLiveTileData.value.albedo, PBR_TILE_DIM, PBR_TILE_DIM, {
    frameCount,
    fps,
    palette,
    bloomStrength,
    dissolveErosion,
    edgeFeather,
    turbulence,
    sparkCount,
    distortionStrength,
    blackClip,
    whitePoint,
    gamma,
    colorBoost,
    resourceName: (current?.title || 'vfx_effect').replace(/[^a-zA-Z0-9_-]/g, '_')
  })
})

const vfxEnableSparksLayer = ref(true)
const vfxEnableDistortionLayer = ref(true)
const vfxEnableOpticalFlow = ref(true)
const vfxEnableDecalLayer = ref(true)
const vfxEnableAudioSync = ref(true)
const vfxBulletTimeSpeed = ref(1.0)

interface VfxSparkParticle {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  maxLife: number
  size: number
}

interface VfxSlashTrailPoint {
  x: number
  y: number
  life: number
  maxLife: number
}

let vfxSparksPool: VfxSparkParticle[] = []
let vfxSlashTrailPoints: VfxSlashTrailPoint[] = []
let vfxIsSlashing = false
let vfxLastSparkUpdateTime = 0
let vfxContinuousFramePos = 0
let vfxHitStopRemainingMs = 0

function playVfxElementalImpactSfx(): void {
  if (!vfxEnableAudioSync.value || typeof window === 'undefined') return
  const Ctx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctx) return
  try {
    const arch = String(node.value?.params.gameVfxArchetype ?? 'slash_arc')
    const pal = String(node.value?.params.gameVfxPalette ?? 'original')
    const presetMap: Record<string, GameAudioSynthPreset> = {
      slash_arc: 'sword_slash',
      fire_explosion: 'explosion',
      arcane_vortex: 'powerup_chord',
      lightning_burst: 'laser_shoot',
      heal_aura: 'coin_pickup',
      poison_nova: 'hit_hurt'
    }
    const pitchMap: Record<string, number> = {
      original: 0,
      solar_fire: -1.5,
      arcane_cyan: 2.5,
      void_purple: -3.0,
      fel_emerald: -1.0,
      holy_gold: 3.5,
      blood_crimson: -2.0
    }
    const synthPreset = presetMap[arch] ?? 'sword_slash'
    const basePitchSemitones = pitchMap[pal] ?? 0
    const synth = synthesizeGameSeedPcm(synthPreset, 22050, {
      durationScale: 0.65,
      basePitchSemitones
    })
    const ch0 = synth.channels[0]
    if (!ch0 || !ch0.length) return
    const actx = new Ctx()
    const buf = actx.createBuffer(1, ch0.length, synth.sampleRate)
    buf.getChannelData(0).set(ch0)
    const src = actx.createBufferSource()
    src.buffer = buf
    const gain = actx.createGain()
    gain.gain.value = 0.42
    src.connect(gain)
    gain.connect(actx.destination)
    src.onended = () => {
      void actx.close().catch(() => {})
    }
    src.start(0)
  } catch {
    // ignore WebAudio restriction in headless/background mode
  }
}

function spawnVfxSparksBurst(cw = 320, ch = 320, originX?: number, originY?: number): void {
  const count = Math.max(
    0,
    Math.min(96, Math.round(Number(node.value?.params.gameVfxSparkCount ?? 36)))
  )
  if (!vfxEnableSparksLayer.value || count <= 0) return
  const cx = originX ?? cw * 0.5
  const cy = originY ?? ch * 0.5
  if (originX === undefined) {
    vfxSparksPool = []
  }
  const burstNum = originX !== undefined ? Math.max(6, Math.round(count * 0.35)) : count
  for (let i = 0; i < burstNum; i++) {
    const angle = (i / burstNum) * Math.PI * 2 + Math.sin(i * 19.37) * 0.42
    const speed = 95 + ((i * 53) % 190)
    const maxLife = 0.35 + ((i * 29) % 45) * 0.01
    vfxSparksPool.push({
      x: cx + Math.cos(angle) * 8,
      y: cy + Math.sin(angle) * 8,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 38,
      life: maxLife,
      maxLife,
      size: 1.5 + (i % 3) * 0.65
    })
  }
}

function stepVfxSparksPhysics(dtSec: number, ch = 320): void {
  const gravity = 280
  const drag = Math.pow(0.18, dtSec)
  const floorY = ch - 26
  for (let i = vfxSparksPool.length - 1; i >= 0; i--) {
    const p = vfxSparksPool[i]
    p.life -= dtSec
    if (p.life <= 0) {
      vfxSparksPool.splice(i, 1)
      continue
    }
    p.vx *= drag
    p.vy = p.vy * drag + gravity * dtSec
    p.x += p.vx * dtSec
    p.y += p.vy * dtSec
    if (p.y > floorY && p.vy > 0) {
      p.y = floorY
      p.vy = -p.vy * 0.46
      p.vx *= 0.78
    }
  }
  for (let i = vfxSlashTrailPoints.length - 1; i >= 0; i--) {
    const pt = vfxSlashTrailPoints[i]
    pt.life -= dtSec
    if (pt.life <= 0) {
      vfxSlashTrailPoints.splice(i, 1)
    }
  }
}

function onVfxCanvasPointerDown(event: PointerEvent): void {
  const canvas = vfxPlayerCanvasRef.value
  if (!canvas) return
  const rect = canvas.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return
  vfxIsSlashing = true
  const x = ((event.clientX - rect.left) / rect.width) * canvas.width
  const y = ((event.clientY - rect.top) / rect.height) * canvas.height
  vfxSlashTrailPoints.push({ x, y, life: 0.36, maxLife: 0.36 })
  spawnVfxSparksBurst(canvas.width, canvas.height, x, y)
  if (!vfxPlaybackRafId) startVfxPlaybackLoop()
  renderVfxPlayerCanvas()
}

function onVfxCanvasPointerMove(event: PointerEvent): void {
  if (!vfxIsSlashing) return
  const canvas = vfxPlayerCanvasRef.value
  if (!canvas) return
  const rect = canvas.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return
  const x = ((event.clientX - rect.left) / rect.width) * canvas.width
  const y = ((event.clientY - rect.top) / rect.height) * canvas.height
  const prev = vfxSlashTrailPoints[vfxSlashTrailPoints.length - 1]
  if (!prev || Math.hypot(x - prev.x, y - prev.y) >= 4) {
    vfxSlashTrailPoints.push({ x, y, life: 0.36, maxLife: 0.36 })
    if (vfxEnableSparksLayer.value && vfxSparksPool.length < 140) {
      const vx = prev ? (x - prev.x) * 8 : 0
      const vy = prev ? (y - prev.y) * 8 : -40
      vfxSparksPool.push({
        x,
        y,
        vx: vx + (Math.random() - 0.5) * 90,
        vy: vy + (Math.random() - 0.5) * 90,
        life: 0.32,
        maxLife: 0.32,
        size: 1.8
      })
    }
    // If the slash slices through the center target dummy zone, trigger full Hit-Stop + Impact Explosion!
    if (
      Math.hypot(x - canvas.width * 0.5, y - canvas.height * 0.5) < 34 &&
      vfxHitFlashTimer.value < 0.4
    ) {
      triggerVfxHitTest()
    } else {
      renderVfxPlayerCanvas()
    }
  }
}

function onVfxCanvasPointerUp(): void {
  vfxIsSlashing = false
}

function getPaletteSparkColors(palette: string): { core: string; tail: string } {
  switch (palette) {
    case 'arcane_cyan':
      return { core: '#ecfeff', tail: '#22d3ee' }
    case 'void_purple':
      return { core: '#f5d0fe', tail: '#a855f7' }
    case 'fel_emerald':
      return { core: '#dcfce7', tail: '#22c55e' }
    case 'holy_gold':
      return { core: '#fefce8', tail: '#facc15' }
    case 'blood_crimson':
      return { core: '#ffe4e6', tail: '#f43f5e' }
    default:
      return { core: '#fef9c3', tail: '#f97316' }
  }
}

function renderVfxPlayerCanvas(): void {
  const canvas = vfxPlayerCanvasRef.value
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const cw = canvas.width
  const ch = canvas.height
  ctx.clearRect(0, 0, cw, ch)

  const pipe = vfxLivePipeline.value
  const fIdx = ((vfxCurrentFrame.value % pipe.frameCount) + pipe.frameCount) % pipe.frameCount
  const nextIdx = (fIdx + 1) % pipe.frameCount
  const subPhase = Math.max(
    0,
    Math.min(1, vfxContinuousFramePos - Math.floor(vfxContinuousFramePos))
  )
  const effectiveFramePos = vfxEnableOpticalFlow.value ? fIdx + subPhase : fIdx
  const phase = pipe.frameCount > 1 ? effectiveFramePos / (pipe.frameCount - 1) : 0.25
  const distStrength = Math.max(
    0,
    Math.min(0.12, Number(node.value?.params.gameVfxDistortionStrength ?? 0.035))
  )
  const waveRadius = (0.12 + phase * 0.78) * (cw * 0.46)
  const waveAmp =
    vfxEnableDistortionLayer.value && distStrength > 0
      ? Math.max(0, 1 - phase * 0.85) * distStrength * 360
      : 0

  // Helper to displace grid points with the live shockwave normal ring (Layer 3 Screen-Space Refraction)
  const warpPt = (px: number, py: number): { x: number; y: number } => {
    if (waveAmp <= 0.05) return { x: px, y: py }
    const dx = px - cw * 0.5
    const dy = py - ch * 0.5
    const r = Math.hypot(dx, dy) || 1
    const band = Math.abs(r - waveRadius)
    if (band > 28) return { x: px, y: py }
    const push = Math.cos((band / 28) * Math.PI * 0.5) * waveAmp * (r >= waveRadius ? 1 : -0.65)
    return { x: px + (dx / r) * push, y: py + (dy / r) * push }
  }

  // 1. Render selected test scene backdrop (with real-time shockwave UV refraction on grid lines)
  if (vfxPlayerBg.value === 'checker') {
    const cell = 16
    for (let y = 0; y < ch; y += cell) {
      for (let x = 0; x < cw; x += cell) {
        const isEven = (x / cell + y / cell) % 2 === 0
        ctx.fillStyle = isEven ? '#181b26' : '#252a3a'
        ctx.fillRect(x, y, cell, cell)
      }
    }
  } else if (vfxPlayerBg.value === 'light') {
    const grad = ctx.createLinearGradient(0, 0, 0, ch)
    grad.addColorStop(0, '#dbeafe')
    grad.addColorStop(0.65, '#f1f5f9')
    grad.addColorStop(1, '#cbd5e1')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, cw, ch)
    ctx.strokeStyle = 'rgba(100, 116, 139, 0.25)'
    ctx.lineWidth = 1
    for (let i = 32; i < cw; i += 32) {
      ctx.beginPath()
      for (let s = 0; s <= ch; s += 8) {
        const pt = warpPt(i, s)
        if (s === 0) ctx.moveTo(pt.x, pt.y)
        else ctx.lineTo(pt.x, pt.y)
      }
      ctx.stroke()
      ctx.beginPath()
      for (let s = 0; s <= cw; s += 8) {
        const pt = warpPt(s, i)
        if (s === 0) ctx.moveTo(pt.x, pt.y)
        else ctx.lineTo(pt.x, pt.y)
      }
      ctx.stroke()
    }
  } else {
    const grad = ctx.createRadialGradient(cw * 0.5, ch * 0.55, 16, cw * 0.5, ch * 0.5, cw * 0.65)
    grad.addColorStop(0, '#1e1b38')
    grad.addColorStop(1, '#090a12')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, cw, ch)
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.14)'
    ctx.lineWidth = 1
    for (let i = 32; i < cw; i += 32) {
      ctx.beginPath()
      for (let s = 0; s <= ch; s += 8) {
        const pt = warpPt(i, s)
        if (s === 0) ctx.moveTo(pt.x, pt.y)
        else ctx.lineTo(pt.x, pt.y)
      }
      ctx.stroke()
      ctx.beginPath()
      for (let s = 0; s <= cw; s += 8) {
        const pt = warpPt(s, i)
        if (s === 0) ctx.moveTo(pt.x, pt.y)
        else ctx.lineTo(pt.x, pt.y)
      }
      ctx.stroke()
    }
  }

  // Camera shake offset when Hit-Test is active
  const hitProgress = vfxHitFlashTimer.value
  const shakeX = hitProgress > 0 ? Math.sin(hitProgress * 45) * 6 * hitProgress : 0
  const shakeY = hitProgress > 0 ? Math.cos(hitProgress * 38) * 5 * hitProgress : 0

  ctx.save()
  ctx.translate(shakeX, shakeY)

  // Layer 0: Ground Scorch & Glowing Elemental Fissure Decal (rendered onto the floor beneath the explosion)
  if (vfxEnableDecalLayer.value && typeof document !== 'undefined') {
    const decalOff = document.createElement('canvas')
    decalOff.width = pipe.frameWidth
    decalOff.height = pipe.frameHeight
    const dctx = decalOff.getContext('2d')
    if (dctx) {
      const decalImg = dctx.createImageData(pipe.frameWidth, pipe.frameHeight)
      decalImg.data.set(pipe.scorchDecalRgba)
      dctx.putImageData(decalImg, 0, 0)
      ctx.save()
      //Scorch decal appears at impact (phase >= 0.12) and slowly cools/fades at tail end
      const decalAlpha = phase < 0.12 ? phase / 0.12 : Math.max(0.28, 1 - (phase - 0.12) * 0.55)
      ctx.globalAlpha = decalAlpha
      ctx.drawImage(decalOff, 36, ch * 0.36, cw - 72, ch * 0.54)
      ctx.restore()
    }
  }

  // Draw target dummy silhouette when Hit-Test is active
  if (hitProgress > 0) {
    ctx.save()
    ctx.fillStyle = hitProgress > 0.65 ? '#ffffff' : 'rgba(148, 163, 184, 0.35)'
    ctx.beginPath()
    ctx.arc(cw * 0.5, ch * 0.42, 24, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillRect(cw * 0.5 - 22, ch * 0.42 + 26, 44, 58)
    ctx.restore()
  }

  // Layer 3 visual cue: Screen-Space Shockwave Refraction lens ring
  if (vfxEnableDistortionLayer.value && waveAmp > 0.1 && phase < 0.85) {
    ctx.save()
    ctx.beginPath()
    ctx.arc(cw * 0.5, ch * 0.5, waveRadius, 0, Math.PI * 2)
    ctx.strokeStyle = `rgba(186, 230, 253, ${Math.max(0, (1 - phase * 1.15) * 0.32).toFixed(3)})`
    ctx.lineWidth = 2.5
    ctx.stroke()
    ctx.restore()
  }

  // Layer 1 & 2: Render Curl-Noise Advected Main Flipbook + Bidirectional Optical-Flow Sub-Frame Interpolation
  const vfxMode = (node.value?.params.gameVfxMode ?? 'vfx_flipbook') as VfxProductionMode
  const baseFrameA = pipe.framesRgba[fIdx] ?? pipe.peakFrameRgba
  const baseFrameB = pipe.framesRgba[nextIdx] ?? baseFrameA
  const interpolatedFlipbookFrame =
    vfxEnableOpticalFlow.value && subPhase > 0.01 && fIdx < pipe.frameCount - 1
      ? blendVfxFramesOpticalFlow(
          baseFrameA,
          baseFrameB,
          pipe.framesFlowVectors[fIdx],
          pipe.frameWidth,
          pipe.frameHeight,
          subPhase
        )
      : baseFrameA

  const frameRgba =
    vfxMode === 'vfx_trail_ribbon'
      ? pipe.ribbonTrailRgba
      : vfxMode === 'vfx_channel_pack'
        ? pipe.channelPackedRgba
        : interpolatedFlipbookFrame

  if (typeof document !== 'undefined') {
    const off = document.createElement('canvas')
    off.width = pipe.frameWidth
    off.height = pipe.frameHeight
    const octx = off.getContext('2d')
    if (octx) {
      const imgData = octx.createImageData(pipe.frameWidth, pipe.frameHeight)
      imgData.data.set(frameRgba)
      octx.putImageData(imgData, 0, 0)

      ctx.save()
      ctx.globalCompositeOperation = vfxBlendMode.value
      const pad = 28
      // Transient Radial Chromatic Aberration during Hit-Stop / Impact Flash!
      if (hitProgress > 0.45) {
        const caShift = (hitProgress - 0.45) * 9.5
        ctx.save()
        ctx.globalAlpha = 0.42
        ctx.globalCompositeOperation = 'lighter'
        ctx.drawImage(off, pad - caShift, pad, cw - pad * 2, ch - pad * 2)
        ctx.drawImage(off, pad + caShift, pad, cw - pad * 2, ch - pad * 2)
        ctx.restore()
      }
      ctx.drawImage(off, pad, pad, cw - pad * 2, ch - pad * 2)
      ctx.restore()
    }
  }

  // Interactive Mouse Slash & Projectile Ribbon Trail Layer
  if (vfxSlashTrailPoints.length >= 2) {
    const pal = String(node.value?.params.gameVfxPalette ?? 'original')
    const colors = getPaletteSparkColors(pal)
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    for (let i = 1; i < vfxSlashTrailPoints.length; i++) {
      const p0 = vfxSlashTrailPoints[i - 1]
      const p1 = vfxSlashTrailPoints[i]
      const ratio = Math.max(0, Math.min(1, p1.life / p1.maxLife))
      const taper = (i / vfxSlashTrailPoints.length) * ratio
      ctx.globalAlpha = Math.min(1, taper * 1.15)
      ctx.strokeStyle = colors.tail
      ctx.lineWidth = Math.max(2, taper * 18)
      ctx.beginPath()
      ctx.moveTo(p0.x, p0.y)
      ctx.lineTo(p1.x, p1.y)
      ctx.stroke()

      ctx.strokeStyle = colors.core
      ctx.lineWidth = Math.max(1, taper * 7)
      ctx.beginPath()
      ctx.moveTo(p0.x, p0.y)
      ctx.lineTo(p1.x, p1.y)
      ctx.stroke()
    }
    ctx.restore()
  }

  // Layer 4: Render Secondary Physics Sparks Sub-Emitter (velocity-stretched glowing embers with gravity & bounce)
  if (vfxEnableSparksLayer.value && vfxSparksPool.length > 0) {
    const pal = String(node.value?.params.gameVfxPalette ?? 'original')
    const colors = getPaletteSparkColors(pal)
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.lineCap = 'round'
    for (const sp of vfxSparksPool) {
      const lifeRatio = Math.max(0, Math.min(1, sp.life / sp.maxLife))
      const tailX = sp.x - sp.vx * 0.038
      const tailY = sp.y - sp.vy * 0.038
      ctx.globalAlpha = Math.pow(lifeRatio, 0.7)
      ctx.strokeStyle = colors.tail
      ctx.lineWidth = sp.size * 1.85
      ctx.beginPath()
      ctx.moveTo(tailX, tailY)
      ctx.lineTo(sp.x, sp.y)
      ctx.stroke()

      ctx.strokeStyle = colors.core
      ctx.lineWidth = sp.size * 0.85
      ctx.beginPath()
      ctx.moveTo(sp.x - sp.vx * 0.015, sp.y - sp.vy * 0.015)
      ctx.lineTo(sp.x, sp.y)
      ctx.stroke()
    }
    ctx.restore()
  }

  // 5. Floating critical damage number when Hit-Test is active
  if (hitProgress > 0) {
    const floatY = ch * 0.32 - (1 - hitProgress) * 38
    ctx.save()
    ctx.font = 'bold 26px system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.lineWidth = 4
    ctx.strokeStyle = '#090a12'
    ctx.fillStyle = '#fde047'
    ctx.strokeText('CRIT -999!', cw * 0.5, floatY)
    ctx.fillText('CRIT -999!', cw * 0.5, floatY)
    ctx.restore()
  }

  ctx.restore()
}

function stopVfxPlaybackLoop(): void {
  if (vfxPlaybackRafId && typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(vfxPlaybackRafId)
    vfxPlaybackRafId = 0
  }
}

function startVfxPlaybackLoop(): void {
  stopVfxPlaybackLoop()
  if (typeof requestAnimationFrame !== 'function') return
  vfxLastSparkUpdateTime = typeof performance !== 'undefined' ? performance.now() : 0
  if (vfxSparksPool.length === 0 && vfxEnableSparksLayer.value) {
    spawnVfxSparksBurst()
  }
  const tick = (now: number): void => {
    if (node.value?.typeId !== 'game.vfxAlpha') {
      vfxPlaybackRafId = 0
      return
    }
    const rawDtSec = Math.max(0.004, Math.min(0.05, (now - (vfxLastSparkUpdateTime || now)) / 1000))
    vfxLastSparkUpdateTime = now

    // 45ms Hit-Stop Freeze Frame: freeze flipbook & particle physics briefly at impact peak for tactile combat weight
    if (vfxHitStopRemainingMs > 0) {
      vfxHitStopRemainingMs = Math.max(0, vfxHitStopRemainingMs - rawDtSec * 1000)
      renderVfxPlayerCanvas()
      vfxPlaybackRafId = requestAnimationFrame(tick)
      return
    }

    const speedMul = Math.max(0.1, Math.min(2.0, vfxBulletTimeSpeed.value))
    const dtSec = rawDtSec * speedMul
    const fps = vfxLivePipeline.value.fps || 14
    const frameCount = vfxLivePipeline.value.frameCount || 8
    let needsRender = false

    if (vfxIsPlaying.value) {
      const prevIntFrame = Math.floor(vfxContinuousFramePos) % frameCount
      vfxContinuousFramePos = (vfxContinuousFramePos + dtSec * fps) % frameCount
      const nextIntFrame = Math.floor(vfxContinuousFramePos) % frameCount
      vfxCurrentFrame.value = nextIntFrame
      if (nextIntFrame !== prevIntFrame && nextIntFrame === 1 && vfxEnableSparksLayer.value) {
        spawnVfxSparksBurst()
      }
      needsRender = true
    }
    if ((vfxIsPlaying.value && vfxSparksPool.length > 0) || vfxSlashTrailPoints.length > 0) {
      stepVfxSparksPhysics(dtSec)
      needsRender = true
    }
    if (vfxHitFlashTimer.value > 0) {
      vfxHitFlashTimer.value = Math.max(0, vfxHitFlashTimer.value - rawDtSec * 1.8)
      needsRender = true
    }
    if (needsRender) {
      renderVfxPlayerCanvas()
    }
    vfxPlaybackRafId = requestAnimationFrame(tick)
  }
  vfxPlaybackRafId = requestAnimationFrame(tick)
}

function toggleVfxPlayback(): void {
  vfxIsPlaying.value = !vfxIsPlaying.value
  if (vfxIsPlaying.value) {
    startVfxPlaybackLoop()
  } else {
    renderVfxPlayerCanvas()
  }
}

function stepVfxFrame(delta: number): void {
  vfxIsPlaying.value = false
  const count = vfxLivePipeline.value.frameCount || 8
  vfxCurrentFrame.value = (((vfxCurrentFrame.value + delta) % count) + count) % count
  vfxContinuousFramePos = vfxCurrentFrame.value
  if (vfxCurrentFrame.value === 1 && vfxEnableSparksLayer.value) {
    spawnVfxSparksBurst()
  }
  renderVfxPlayerCanvas()
}

function triggerVfxHitTest(): void {
  vfxCurrentFrame.value = Math.min(1, vfxLivePipeline.value.frameCount - 1)
  vfxContinuousFramePos = vfxCurrentFrame.value
  vfxHitFlashTimer.value = 1.0
  vfxHitStopRemainingMs = 45
  spawnVfxSparksBurst()
  playVfxElementalImpactSfx()
  vfxIsPlaying.value = true
  startVfxPlaybackLoop()
  renderVfxPlayerCanvas()
}

function downloadVfxSpriteFramesTres(): void {
  const stem = (node.value?.title?.trim() || 'vfx_effect').replace(/\s+/g, '_')
  downloadTextFile(
    vfxLivePipeline.value.godotSpriteFramesTres,
    `${stem}_spriteframes.tres`,
    'text/plain;charset=utf-8'
  )
}

function downloadVfxGdShader(): void {
  const stem = (node.value?.title?.trim() || 'vfx_effect').replace(/\s+/g, '_')
  downloadTextFile(
    vfxLivePipeline.value.godotVfxShader,
    `${stem}_uber_vfx.gdshader`,
    'text/plain;charset=utf-8'
  )
}

function downloadVfxGodotTscn(): void {
  const stem = (node.value?.title?.trim() || 'vfx_effect').replace(/\s+/g, '_')
  downloadTextFile(
    vfxLivePipeline.value.godotVfxPrefabTscn,
    `${stem}_vfx_prefab.tscn`,
    'text/plain;charset=utf-8'
  )
}

function downloadVfxUnityJson(): void {
  const stem = (node.value?.title?.trim() || 'vfx_effect').replace(/\s+/g, '_')
  downloadTextFile(
    JSON.stringify(vfxLivePipeline.value.unityParticleJson, null, 2),
    `${stem}_unity_particles.json`,
    'application/json;charset=utf-8'
  )
}

watch(
  () => [vfxLivePipeline.value, pbrTab.value, node.value?.params.gameVfxMode],
  () => {
    if (node.value?.typeId === 'game.vfxAlpha' && pbrTab.value === 'vfx_player') {
      void nextTick(() => renderVfxPlayerCanvas())
    }
  }
)

onBeforeUnmount(() => {
  stopVfxPlaybackLoop()
})

const displayPbrChannelCards = computed(() => {
  const assetMode = effectiveImageAssetMode.value
  // Only return cached pbrChannelCards directly for pbr_tile mode; for specialized modes, compute live so parameter sliders update immediately!
  if (assetMode === 'pbr_tile' && pbrChannelCards.value.length >= 2) {
    return pbrChannelCards.value
  }
  const { albedo, maps } = pbrLiveTileData.value

  if (assetMode === 'autotile_wang16') {
    const wang16 = synthesizeWang16AutoTileAtlas(albedo, 48, 48, {
      terrainName: node.value?.title || 'terrain'
    })
    return [
      {
        key: 'live-wang16',
        title: 'Wang16_AutoTile_Atlas',
        url: encodeRgbaToPngDataUrl(wang16.data, wang16.atlasWidth, wang16.atlasHeight)
      },
      {
        key: 'live-primary',
        title: 'Primary_Seamless_Tile',
        url: encodeRgbaToPngDataUrl(albedo, PBR_TILE_DIM, PBR_TILE_DIM)
      }
    ]
  }

  if (assetMode === 'scene_prop') {
    const propRes = processScenePropWithYSortAndShadow(albedo, PBR_TILE_DIM, PBR_TILE_DIM, {
      shadowOpacity: Number(node.value?.params.gamePropShadowOpacity ?? 0.42),
      footprintHeightRatio: Number(node.value?.params.gamePropFootprintRatio ?? 0.25)
    })
    return [
      {
        key: 'live-prop-shadow',
        title: 'Prop_YSort_Shadow',
        url: encodeRgbaToPngDataUrl(propRes.data, PBR_TILE_DIM, PBR_TILE_DIM)
      },
      {
        key: 'live-prop-base',
        title: 'Prop_Base',
        url: encodeRgbaToPngDataUrl(albedo, PBR_TILE_DIM, PBR_TILE_DIM)
      }
    ]
  }

  if (assetMode === 'raw_nine_slice' && uiLiveRawNineSlice.value) {
    const rawSlice = uiLiveRawNineSlice.value
    return [
      {
        key: 'live-nine-cleaned',
        title: 'NineSlice_Cleaned_Source',
        url: rawSlice.cleanedUrl
      },
      {
        key: 'live-nine-exploded',
        title: 'NineSlice_Exploded_9Patches_Atlas',
        url: rawSlice.explodedUrl
      },
      {
        key: 'live-nine-stretched',
        title: `NineSlice_Stretched_Dialog_${rawSlice.previewWidth}x${rawSlice.previewHeight}`,
        url: rawSlice.stretchedUrl
      },
      {
        key: 'live-nine-hollow',
        title: 'NineSlice_Hollow_Border_Frame',
        url: rawSlice.hollowUrl
      }
    ]
  }

  if (assetMode === 'ui_kit') {
    const rarity = (node.value?.params.gameIconRarityTier ?? 'legendary') as IconRarityTier
    const stretchMode = (node.value?.params.gameNineSliceStretchMode ??
      'stretch') as NineSliceStretchMode
    const uiStates = generateUiButtonFourStates(albedo, PBR_TILE_DIM, PBR_TILE_DIM, {
      symmetricNineSlice: node.value?.params.gameUiSymmetricLock !== false,
      stretchMode,
      customBorders: pbrLiveNineSlice.value.borders
    })
    const rarityFrame = compositeIconWithRarityFrame(albedo, PBR_TILE_DIM, PBR_TILE_DIM, rarity)
    return [
      {
        key: 'live-ui-sheet',
        title: 'UI_Button_4States_Sheet',
        url: encodeRgbaToPngDataUrl(uiStates.sheetData, uiStates.sheetWidth, uiStates.sheetHeight)
      },
      {
        key: 'live-icon-rarity',
        title: `Icon_Rarity_${rarity}`,
        url: encodeRgbaToPngDataUrl(rarityFrame.data, rarityFrame.width, rarityFrame.height)
      },
      {
        key: 'live-ui-hover',
        title: 'UI_Button_Hover',
        url: encodeRgbaToPngDataUrl(uiStates.states.hover, PBR_TILE_DIM, PBR_TILE_DIM)
      },
      {
        key: 'live-ui-pressed',
        title: 'UI_Button_Pressed',
        url: encodeRgbaToPngDataUrl(uiStates.states.pressed, PBR_TILE_DIM, PBR_TILE_DIM)
      },
      {
        key: 'live-ui-focused',
        title: 'UI_Button_Focused',
        url: encodeRgbaToPngDataUrl(uiStates.states.focused, PBR_TILE_DIM, PBR_TILE_DIM)
      }
    ]
  }

  if (assetMode === 'hud_bar_kit') {
    const kit = uiLiveHudBarKit.value
    if (kit) {
      return [
        {
          key: 'live-hud-composite',
          title: `HUD_Bar_Composite_${node.value?.params.gameHudBarPreset ?? 'hp_crimson'}`,
          url: kit.compositeUrl
        },
        {
          key: 'live-hud-backplate',
          title: 'HUD_Bar_Backplate',
          url: kit.backplateUrl
        },
        {
          key: 'live-hud-fill',
          title: 'HUD_Bar_Fill_Strip',
          url: kit.fillStripUrl
        },
        {
          key: 'live-hud-frame',
          title: 'HUD_Bar_Frame_Overlay',
          url: kit.frameOverlayUrl
        }
      ]
    }
  }

  if (assetMode === 'radial_hud_kit') {
    const kit = uiLiveRadialHudKit.value
    if (kit) {
      return [
        {
          key: 'live-radial-slot',
          title: 'Radial_Skill_Slot_Frame',
          url: kit.skillSlotUrl
        },
        {
          key: 'live-radial-cd',
          title: 'Radial_Cooldown_Wipe_Mask',
          url: kit.cooldownMaskUrl
        },
        {
          key: 'live-radial-minimap',
          title: 'Radial_Minimap_Compass_Ring',
          url: kit.minimapUrl
        },
        {
          key: 'live-radial-wheel',
          title: 'Radial_Action_Wheel_8Sector',
          url: kit.actionWheelUrl
        }
      ]
    }
  }

  if (assetMode === 'dialogue_kit') {
    const kit = uiLiveDialogueKit.value
    if (kit) {
      return [
        {
          key: 'live-dlg-composite',
          title: 'Dialogue_Composite_Preview',
          url: kit.compositeUrl
        },
        {
          key: 'live-dlg-box',
          title: 'Dialogue_Main_Box_9Slice',
          url: kit.mainBoxUrl
        },
        {
          key: 'live-dlg-nameplate',
          title: 'Dialogue_Nameplate_And_Choice',
          url: kit.nameplateUrl
        },
        {
          key: 'live-dlg-portrait',
          title: 'Dialogue_Portrait_And_Cursor',
          url: kit.portraitCursorUrl
        }
      ]
    }
  }

  if (assetMode === 'ui_controls_kit') {
    const kit = uiLiveControlsKit.value
    if (kit) {
      return [
        {
          key: 'live-ctrl-atlas',
          title: 'UI_Controls_Atlas_Sheet',
          url: kit.atlasUrl
        },
        {
          key: 'live-ctrl-tabs',
          title: 'UI_Tab_Active_Inactive',
          url: kit.tabsUrl
        },
        {
          key: 'live-ctrl-slider',
          title: 'UI_Slider_And_Scrollbar',
          url: kit.sliderUrl
        },
        {
          key: 'live-ctrl-checkbox',
          title: 'UI_Checkbox_And_Toggle',
          url: kit.checkboxUrl
        }
      ]
    }
  }

  if (assetMode === 'composite_frame') {
    const frameShape = (node.value?.params.gameFrameShape ?? 'rect_card') as UniversalFrameShape
    const rarity = (node.value?.params.gameIconRarityTier ?? 'rare') as IconRarityTier
    const stylePreset = (node.value?.params.gameUiStylePreset ??
      'dark_iron_parchment') as UiStylePreset
    const foilStrength = Math.max(
      0,
      Math.min(1, Number(node.value?.params.gameUiFoilStrength ?? 0.65))
    )
    const layered = composeLayeredFrameTemplate(albedo, PBR_TILE_DIM, PBR_TILE_DIM, {
      frameShape,
      rarity,
      stylePreset,
      foilStrength
    })
    return [
      {
        key: 'live-frame-composite',
        title: `Composite_${frameShape}`,
        url: encodeRgbaToPngDataUrl(layered.compositeRgba, PBR_TILE_DIM, PBR_TILE_DIM)
      },
      {
        key: 'live-frame-art',
        title: 'Layer_1_Masked_Art',
        url: encodeRgbaToPngDataUrl(layered.maskedArtRgba, PBR_TILE_DIM, PBR_TILE_DIM)
      },
      {
        key: 'live-frame-border',
        title: 'Layer_2_Frame_Border',
        url: encodeRgbaToPngDataUrl(layered.frameBorderRgba, PBR_TILE_DIM, PBR_TILE_DIM)
      },
      {
        key: 'live-frame-overlay',
        title: 'Layer_3_Socket_And_Header',
        url: encodeRgbaToPngDataUrl(layered.socketHeaderRgba, PBR_TILE_DIM, PBR_TILE_DIM)
      },
      {
        key: 'live-frame-foil',
        title: 'Layer_4_Foil_Shimmer_Mask',
        url: encodeRgbaToPngDataUrl(layered.foilShimmerMaskRgba, PBR_TILE_DIM, PBR_TILE_DIM)
      }
    ]
  }

  if (assetMode === 'sprite_stroke_mip') {
    const strokeWidthPx = Number(node.value?.params.gameStrokeWidthPx ?? 3)
    const strokeColorPreset = (node.value?.params.gameStrokeColorPreset ??
      'gold') as SpriteStrokeColorPreset
    const mipChain = processSpriteStrokeAndMipChain(albedo, PBR_TILE_DIM, PBR_TILE_DIM, {
      strokeWidthPx,
      strokeColorPreset,
      shadowOpacity: Number(node.value?.params.gamePropShadowOpacity ?? 0.35),
      autoKey: true
    })
    return [
      {
        key: 'live-stroke-full',
        title: `Stroked_${PBR_TILE_DIM}x${PBR_TILE_DIM}`,
        url: encodeRgbaToPngDataUrl(mipChain.strokedRgba, PBR_TILE_DIM, PBR_TILE_DIM)
      },
      {
        key: 'live-mip-64',
        title: 'Mip_64x64_Sharpened',
        url: encodeRgbaToPngDataUrl(
          mipChain.mip64.rgba,
          mipChain.mip64.width,
          mipChain.mip64.height
        )
      },
      {
        key: 'live-mip-32',
        title: 'Mip_32x32_Sharpened',
        url: encodeRgbaToPngDataUrl(
          mipChain.mip32.rgba,
          mipChain.mip32.width,
          mipChain.mip32.height
        )
      }
    ]
  }

  if (assetMode === 'vfx_demult') {
    const pipe = vfxLivePipeline.value
    return [
      {
        key: 'live-vfx-flipbook',
        title: `VFX_Flipbook_${pipe.cols}x${pipe.rows}`,
        url: encodeRgbaToPngDataUrl(pipe.sheetRgba, pipe.sheetWidth, pipe.sheetHeight)
      },
      {
        key: 'live-vfx-alpha',
        title: 'VFX_Unpremultiplied_Alpha',
        url: encodeRgbaToPngDataUrl(pipe.peakFrameRgba, PBR_TILE_DIM, PBR_TILE_DIM)
      },
      {
        key: 'live-vfx-mask',
        title: 'VFX_Channel_Packed_Mask',
        url: encodeRgbaToPngDataUrl(pipe.channelPackedRgba, PBR_TILE_DIM, PBR_TILE_DIM)
      },
      {
        key: 'live-vfx-ribbon',
        title: 'VFX_Ribbon_Trail_Strip',
        url: encodeRgbaToPngDataUrl(pipe.ribbonTrailRgba, PBR_TILE_DIM, PBR_TILE_DIM)
      },
      {
        key: 'live-vfx-distortion',
        title: 'VFX_Distortion_Normal',
        url: encodeRgbaToPngDataUrl(pipe.distortionNormalRgba, PBR_TILE_DIM, PBR_TILE_DIM)
      },
      {
        key: 'live-vfx-flow',
        title: 'VFX_Flow_Motion_Vectors',
        url: encodeRgbaToPngDataUrl(pipe.flowMotionVectorsRgba, PBR_TILE_DIM, PBR_TILE_DIM)
      },
      {
        key: 'live-vfx-decal',
        title: 'VFX_Scorch_Decal',
        url: encodeRgbaToPngDataUrl(pipe.scorchDecalRgba, PBR_TILE_DIM, PBR_TILE_DIM)
      },
      {
        key: 'live-vfx-raw',
        title: 'VFX_Raw_Source',
        url: encodeRgbaToPngDataUrl(albedo, PBR_TILE_DIM, PBR_TILE_DIM)
      }
    ]
  }

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

function downloadNineSliceGodotTscn(): void {
  const stem = (node.value?.title?.trim() || 'ui_nine_slice').replace(/\s+/g, '_')
  const stretchMode = (node.value?.params.gameNineSliceStretchMode ??
    'stretch') as NineSliceStretchMode
  const manifest = buildNineSliceManifest(stem, pbrLiveNineSlice.value)
  const tscn = exportGodotNinePatchTscn(manifest, {
    stretchMode,
    targetWidth: uiNineSliceTargetW.value,
    targetHeight: uiNineSliceTargetH.value
  })
  downloadTextFile(tscn, `${stem}_nine_patch.tscn`, 'text/plain;charset=utf-8')
}

function downloadNineSliceUnityUss(): void {
  const stem = (node.value?.title?.trim() || 'ui_nine_slice').replace(/\s+/g, '_')
  const stretchMode = (node.value?.params.gameNineSliceStretchMode ??
    'stretch') as NineSliceStretchMode
  const manifest = buildNineSliceManifest(stem, pbrLiveNineSlice.value)
  const uss = exportUnityNineSliceSnippet(manifest, { stretchMode })
  downloadTextFile(uss, `${stem}_nine_slice.uss`, 'text/plain;charset=utf-8')
}

function downloadNineSliceWebCss(): void {
  const stem = (node.value?.title?.trim() || 'ui_nine_slice').replace(/\s+/g, '_')
  const stretchMode = (node.value?.params.gameNineSliceStretchMode ??
    'stretch') as NineSliceStretchMode
  const manifest = buildNineSliceManifest(stem, pbrLiveNineSlice.value)
  const css = exportWebCssNineSliceSnippet(manifest, { stretchMode })
  downloadTextFile(css, `${stem}_nine_slice.css`, 'text/css;charset=utf-8')
}

function downloadNineSliceExplodedPng(): void {
  if (!uiLiveRawNineSlice.value) return
  const stem = (node.value?.title?.trim() || 'ui_nine_slice').replace(/\s+/g, '_')
  downloadDataUrlFile(uiLiveRawNineSlice.value.explodedUrl, `${stem}_9patches_exploded.png`)
}

function downloadPbrGodotTres(): void {
  const stem = (node.value?.title?.trim() || 'game_asset').replace(/\s+/g, '_')
  const assetMode = effectiveImageAssetMode.value
  if (assetMode === 'raw_nine_slice') {
    downloadNineSliceGodotTscn()
    return
  }

  if (assetMode === 'ui_kit') {
    const stem = (node.value?.title?.trim() || 'ui_button').replace(/\s+/g, '_')
    const stretchMode = (node.value?.params.gameNineSliceStretchMode ??
      'stretch') as NineSliceStretchMode
    const tres = exportGodotUiButtonThemeTres(
      pbrLiveNineSlice.value.borders,
      stem,
      PBR_TILE_DIM,
      PBR_TILE_DIM,
      stretchMode
    )
    downloadTextFile(tres, `${stem}_theme.tres`, 'text/plain;charset=utf-8')
    return
  }
  if (assetMode === 'hud_bar_kit') {
    downloadHudGodotTscn()
    return
  }
  if (assetMode === 'radial_hud_kit' && uiLiveRadialHudKit.value) {
    downloadTextFile(
      uiLiveRadialHudKit.value.godotRadialHudTscn,
      `${stem}_radial_hud.tscn`,
      'text/plain;charset=utf-8'
    )
    return
  }
  if (assetMode === 'dialogue_kit' && uiLiveDialogueKit.value) {
    downloadTextFile(
      uiLiveDialogueKit.value.godotDialogueSceneTscn,
      `${stem}_dialogue.tscn`,
      'text/plain;charset=utf-8'
    )
    return
  }
  if (assetMode === 'ui_controls_kit' && uiLiveControlsKit.value) {
    downloadTextFile(
      uiLiveControlsKit.value.godotFullControlsThemeTres,
      `${stem}_controls_theme.tres`,
      'text/plain;charset=utf-8'
    )
    return
  }
  if (assetMode === 'composite_frame') {
    const stem = (node.value?.title?.trim() || 'layered_frame').replace(/\s+/g, '_')
    const frameShape = (node.value?.params.gameFrameShape ?? 'rect_card') as UniversalFrameShape
    const rarity = (node.value?.params.gameIconRarityTier ?? 'legendary') as IconRarityTier
    const stylePreset = (node.value?.params.gameUiStylePreset ??
      'dark_iron_parchment') as UiStylePreset
    const layered = composeLayeredFrameTemplate(
      pbrLiveTileData.value.albedo,
      PBR_TILE_DIM,
      PBR_TILE_DIM,
      { frameShape, rarity, stylePreset, resourceName: stem }
    )
    downloadTextFile(layered.godotControlTres, `${stem}_control.tscn`, 'text/plain;charset=utf-8')
    return
  }
  const manifest = buildAutoTileAtlasManifest({
    terrainName: stem,
    layout: 'wang16',
    tileWidth: PBR_TILE_DIM,
    tileHeight: PBR_TILE_DIM
  })
  const tres = exportGodotTileSetTres(manifest, `res://assets/tilesets/${stem}_wang16.png`)
  downloadTextFile(tres, `${stem}_tileset.tres`, 'text/plain;charset=utf-8')
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
  () =>
    node.value?.typeId === 'game.pbrTile'
      ? [
          node.value.typeId,
          pbrTab.value,
          pbrLiveTileData.value,
          showSeamGrid.value,
          pbrLightZ.value,
          pbrLightIntensity.value,
          pbrLightEnv.value
        ]
      : null,
  async (deps) => {
    if (deps && pbrTab.value === 'lighting') {
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

let lastSynthAudioKey = ''
let lastSynthAudioResult: ReturnType<typeof synthesizeGameSeedPcm> | null = null

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
  const key = `${preset}|${durationScale}|${basePitchSemitones}`
  if (lastSynthAudioResult && key === lastSynthAudioKey) {
    return lastSynthAudioResult
  }
  lastSynthAudioKey = key
  lastSynthAudioResult = synthesizeGameSeedPcm(preset, 22050, {
    durationScale,
    basePitchSemitones
  })
  return lastSynthAudioResult
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

function auditionIntroToLoop(): void {
  const ctx = ensureAudioContext()
  if (!ctx) return
  const raw = liveProcessedPrimaryChannel.value
  const sr = liveRawAudioBuffer.value.sampleRate
  const introSec = Math.max(0.4, Math.min(12, Number(node.value?.params.gameAudioIntroSec ?? 2.0)))
  const split = splitBgmIntroAndSeamlessLoop(raw, sr, {
    introSec,
    crossfadeSec: audioCrossfadeSec.value
  })
  playPcmSamples(ctx, split.introSamples, sr, { loop: false })
  const timer = setTimeout(
    () => {
      if (!activeAudioCtx || activeAudioCtx !== ctx) return
      playPcmSamples(ctx, split.loopSamples, sr, { loop: true })
    },
    Math.max(100, Math.round(split.introDurationSec * 1000))
  )
  rapidFireTimers.push(timer)
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

let lastLevelDataKey = ''
let lastLevelDataResult: ProceduralLevelMapResult | null = null

const liveLevelData = computed(() => {
  const alg = (node.value?.params.gameLevelAlgorithm ?? 'bsp_dungeon') as LevelGeneratorAlgorithm
  const width = Math.max(12, Math.min(64, Number(node.value?.params.gameLevelWidth ?? 32)))
  const height = Math.max(10, Math.min(48, Number(node.value?.params.gameLevelHeight ?? 20)))
  const seed = Number(node.value?.params.gameLevelSeed ?? 1337)
  const edits = node.value?.params.gameLevelCustomEdits ?? ''
  const key = `${alg}|${width}|${height}|${seed}|${edits}`
  if (lastLevelDataResult && key === lastLevelDataKey) {
    return lastLevelDataResult
  }
  const base = generateProceduralLevelMap({
    algorithm: alg,
    width,
    height,
    seed
  })
  lastLevelDataKey = key
  lastLevelDataResult = applyCustomEditsToLevelMap(base, edits || undefined)
  return lastLevelDataResult
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

// --- 4. game.economy: Machinations Visual System Dynamics & Monte Carlo Simulator ---
const economyTab = ref<'diagram' | 'export'>('diagram')
const economyExportLang = ref<'godot' | 'unity' | 'mermaid' | 'csv'>('godot')
const machSvgRef = ref<SVGSVGElement | null>(null)
const selectedMachNodeId = ref<string>('')
const machConnectMode = ref<MachinationsEdgeKind | null>(null)
const machDraggingNodeId = ref<string | null>(null)
const economyIsPlaying = ref(false)
let economyPlayTimer: ReturnType<typeof setInterval> | null = null

const liveEconomyDiagram = computed<MachinationsDiagram>(() => {
  const preset = (node.value?.params.gameEconomyPreset ??
    'arpg_equipment_economy') as MachinationsPresetId
  return parseMachinationsDiagramJson(
    node.value?.params.gameEconomyDiagramJson,
    preset,
    node.value?.title
  )
})

const liveEconomyMcResult = computed(() => {
  const steps = Math.max(10, Math.min(200, Number(node.value?.params.gameEconomySteps ?? 50)))
  const runs = Math.max(
    5,
    Math.min(200, Number(node.value?.params.gameEconomyMonteCarloRuns ?? 40))
  )
  const seed = Number(node.value?.params.gameEconomySeed ?? 2026)
  return runMachinationsMonteCarlo(liveEconomyDiagram.value, { runs, steps, seed })
})

const economyLiveState = ref<MachinationsSimulationState>(
  createInitialMachinationsState(createMachinationsPresetDiagram('arpg_equipment_economy'))
)

watch(
  () =>
    [
      node.value?.id,
      node.value?.params.gameEconomyPreset,
      node.value?.params.gameEconomyDiagramJson
    ] as const,
  () => {
    economyLiveState.value = createInitialMachinationsState(liveEconomyDiagram.value)
    if (
      !selectedMachNodeId.value ||
      !liveEconomyDiagram.value.nodes.some((n) => n.id === selectedMachNodeId.value)
    ) {
      selectedMachNodeId.value = liveEconomyDiagram.value.nodes[0]?.id ?? ''
    }
  },
  { immediate: true }
)

const selectedMachNode = computed<MachinationsNode | null>(
  () => liveEconomyDiagram.value.nodes.find((n) => n.id === selectedMachNodeId.value) ?? null
)

const selectedMachNodeEdges = computed<MachinationsEdge[]>(() =>
  liveEconomyDiagram.value.edges.filter((e) => e.sourceId === selectedMachNodeId.value)
)

function getMachNodeLabel(nodeId: string): string {
  return liveEconomyDiagram.value.nodes.find((n) => n.id === nodeId)?.label ?? nodeId
}

function persistMachinationsDiagram(nextDiagram: MachinationsDiagram): void {
  patchParams({
    gameEconomyDiagramJson: JSON.stringify(nextDiagram),
    previewDataUrl: undefined
  })
}

function onEconomyPresetSelectChange(event: Event): void {
  const val = (event.target as HTMLSelectElement).value as MachinationsPresetId
  const freshDiagram = createMachinationsPresetDiagram(val)
  selectedMachNodeId.value = freshDiagram.nodes[0]?.id ?? ''
  patchParams({
    gameEconomyPreset: val,
    gameEconomyDiagramJson: JSON.stringify(freshDiagram),
    previewDataUrl: undefined
  })
}

function randomizeEconomySeed(): void {
  patchParams({
    gameEconomySeed: Math.floor(100 + Math.random() * 99000),
    previewDataUrl: undefined
  })
}

function stepEconomyOnce(triggerNodeIds?: string[]): void {
  const seed = Number(node.value?.params.gameEconomySeed ?? 2026)
  economyLiveState.value = stepMachinationsSimulation(
    liveEconomyDiagram.value,
    economyLiveState.value,
    { seed, triggerNodeIds }
  )
}

function stopEconomyLivePlay(): void {
  economyIsPlaying.value = false
  if (economyPlayTimer) {
    clearInterval(economyPlayTimer)
    economyPlayTimer = null
  }
}

function toggleEconomyLivePlay(): void {
  if (economyIsPlaying.value) {
    stopEconomyLivePlay()
    return
  }
  economyIsPlaying.value = true
  economyPlayTimer = setInterval(() => {
    if (economyLiveState.value.tick >= liveEconomyMcResult.value.steps) {
      economyLiveState.value = createInitialMachinationsState(liveEconomyDiagram.value)
    } else {
      stepEconomyOnce()
    }
  }, 260)
}

function resetEconomyLiveSim(): void {
  stopEconomyLivePlay()
  economyLiveState.value = createInitialMachinationsState(liveEconomyDiagram.value)
}

onBeforeUnmount(() => {
  stopEconomyLivePlay()
})

function formatMachNodeCenterText(mNode: MachinationsNode): string {
  if (mNode.kind === 'pool') {
    const val = economyLiveState.value.poolValues[mNode.id] ?? mNode.initialValue ?? 0
    return String(Math.round(val))
  }
  if (mNode.kind === 'register') {
    const val = economyLiveState.value.registerValues[mNode.id] ?? mNode.initialValue ?? 0
    return String(Math.round(val))
  }
  if (mNode.kind === 'gate') return '%'
  if (mNode.kind === 'source') return '△'
  if (mNode.kind === 'drain') return '▽'
  if (mNode.kind === 'converter') return '▷'
  return '▣'
}

function getMachEdgeCoords(edge: MachinationsEdge): {
  x1: number
  y1: number
  x2: number
  y2: number
} {
  const src = liveEconomyDiagram.value.nodes.find((n) => n.id === edge.sourceId)
  const dst = liveEconomyDiagram.value.nodes.find((n) => n.id === edge.targetId)
  if (!src || !dst) return { x1: 0, y1: 0, x2: 0, y2: 0 }
  const angle = Math.atan2(dst.y - src.y, dst.x - src.x)
  const pad = 24
  return {
    x1: src.x + Math.cos(angle) * pad,
    y1: src.y + Math.sin(angle) * pad,
    x2: dst.x - Math.cos(angle) * pad,
    y2: dst.y - Math.sin(angle) * pad
  }
}

function toggleMachConnectMode(kind: MachinationsEdgeKind): void {
  machConnectMode.value = machConnectMode.value === kind ? null : kind
}

function onMachNodePointerDown(nodeId: string, event: PointerEvent): void {
  if (machConnectMode.value && selectedMachNodeId.value && selectedMachNodeId.value !== nodeId) {
    const copy: MachinationsDiagram = JSON.parse(JSON.stringify(liveEconomyDiagram.value))
    const edgeKind = machConnectMode.value
    copy.edges.push({
      id: `edge_${Date.now()}`,
      sourceId: selectedMachNodeId.value,
      targetId: nodeId,
      kind: edgeKind,
      label: edgeKind === 'state_modifier' ? '+5/unit' : '10/tick',
      rate: edgeKind === 'state_modifier' ? 5 : 10
    })
    machConnectMode.value = null
    persistMachinationsDiagram(copy)
    return
  }

  selectedMachNodeId.value = nodeId
  const clicked = liveEconomyDiagram.value.nodes.find((n) => n.id === nodeId)
  if (
    clicked &&
    (clicked.activation === 'interactive' ||
      clicked.kind === 'converter' ||
      clicked.kind === 'source')
  ) {
    stepEconomyOnce([nodeId])
  }
  machDraggingNodeId.value = nodeId
  try {
    ;(event.currentTarget as Element | null)?.setPointerCapture?.(event.pointerId)
  } catch {
    /* ignore */
  }
}

function onMachCanvasPointerMove(event: PointerEvent): void {
  if (!machDraggingNodeId.value || !machSvgRef.value) return
  const rect = machSvgRef.value.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return
  const nx = Math.max(
    32,
    Math.min(708, Math.round(((event.clientX - rect.left) / rect.width) * 740))
  )
  const ny = Math.max(
    28,
    Math.min(242, Math.round(((event.clientY - rect.top) / rect.height) * 275))
  )
  const copy: MachinationsDiagram = JSON.parse(JSON.stringify(liveEconomyDiagram.value))
  const target = copy.nodes.find((n) => n.id === machDraggingNodeId.value)
  if (target) {
    target.x = nx
    target.y = ny
    persistMachinationsDiagram(copy)
  }
}

function onMachCanvasPointerUp(): void {
  machDraggingNodeId.value = null
}

function addMachNode(kind: MachinationsNodeKind): void {
  const copy: MachinationsDiagram = JSON.parse(JSON.stringify(liveEconomyDiagram.value))
  const id = `${kind}_${copy.nodes.length + 1}`
  const defaultColor =
    kind === 'source'
      ? '#10b981'
      : kind === 'pool'
        ? '#fbbf24'
        : kind === 'converter'
          ? '#f97316'
          : kind === 'drain'
            ? '#f43f5e'
            : kind === 'gate'
              ? '#ec4899'
              : '#a855f7'
  copy.nodes.push({
    id,
    kind,
    label: `${kind.toUpperCase()} ${copy.nodes.length + 1}`,
    x: 140 + ((copy.nodes.length * 95) % 480),
    y: 70 + ((copy.nodes.length * 55) % 150),
    activation: kind === 'source' || kind === 'converter' ? 'automatic' : 'passive',
    ...(kind === 'pool' ? { initialValue: 50, maxCapacity: 9999 } : {}),
    ...(kind === 'register' ? { formula: '50 * Math.pow(1.18, a)' } : {}),
    color: defaultColor
  })
  selectedMachNodeId.value = id
  persistMachinationsDiagram(copy)
}

function deleteSelectedMachNode(): void {
  if (!selectedMachNodeId.value) return
  const copy: MachinationsDiagram = JSON.parse(JSON.stringify(liveEconomyDiagram.value))
  copy.nodes = copy.nodes.filter((n) => n.id !== selectedMachNodeId.value)
  copy.edges = copy.edges.filter(
    (e) => e.sourceId !== selectedMachNodeId.value && e.targetId !== selectedMachNodeId.value
  )
  selectedMachNodeId.value = copy.nodes[0]?.id ?? ''
  persistMachinationsDiagram(copy)
}

function onEditMachNodeField(field: keyof MachinationsNode, val: string): void {
  if (!selectedMachNodeId.value) return
  const copy: MachinationsDiagram = JSON.parse(JSON.stringify(liveEconomyDiagram.value))
  const target = copy.nodes.find((n) => n.id === selectedMachNodeId.value)
  if (!target) return
  ;(target as unknown as Record<string, unknown>)[field] = val
  persistMachinationsDiagram(copy)
}

function onEditMachNodeNumber(field: 'initialValue' | 'maxCapacity', event: Event): void {
  const num = Number((event.target as HTMLInputElement).value)
  if (!Number.isFinite(num) || !selectedMachNodeId.value) return
  const copy: MachinationsDiagram = JSON.parse(JSON.stringify(liveEconomyDiagram.value))
  const target = copy.nodes.find((n) => n.id === selectedMachNodeId.value)
  if (!target) return
  target[field] = num
  persistMachinationsDiagram(copy)
}

function onEditMachEdgeRate(edgeId: string, event: Event): void {
  const num = Number((event.target as HTMLInputElement).value)
  if (!Number.isFinite(num)) return
  const copy: MachinationsDiagram = JSON.parse(JSON.stringify(liveEconomyDiagram.value))
  const edge = copy.edges.find((e) => e.id === edgeId)
  if (!edge) return
  edge.rate = num
  edge.label = edge.kind === 'state_modifier' ? `+${num}/unit` : `${num}/tick`
  persistMachinationsDiagram(copy)
}

function deleteMachEdge(edgeId: string): void {
  const copy: MachinationsDiagram = JSON.parse(JSON.stringify(liveEconomyDiagram.value))
  copy.edges = copy.edges.filter((e) => e.id !== edgeId)
  persistMachinationsDiagram(copy)
}

const machChartMaxY = computed(() => {
  let maxV = 10
  for (const s of liveEconomyMcResult.value.poolSeries) {
    for (const v of s.p90) {
      if (v > maxV) maxV = v
    }
  }
  return Math.ceil(maxV)
})

const machChartPolygons = computed(() => {
  const steps = Math.max(1, liveEconomyMcResult.value.steps)
  const maxY = Math.max(1, machChartMaxY.value)
  const left = 36
  const width = 489
  const top = 22
  const bottom = 145
  const height = bottom - top

  return liveEconomyMcResult.value.poolSeries.map((series) => {
    const p50Pts: string[] = []
    const upperPts: string[] = []
    const lowerPts: string[] = []

    for (let t = 0; t <= steps; t++) {
      const x = Math.round((left + (t / steps) * width) * 10) / 10
      const y50 = Math.round((bottom - Math.min(1, (series.p50[t] ?? 0) / maxY) * height) * 10) / 10
      const y90 = Math.round((bottom - Math.min(1, (series.p90[t] ?? 0) / maxY) * height) * 10) / 10
      const y10 = Math.round((bottom - Math.min(1, (series.p10[t] ?? 0) / maxY) * height) * 10) / 10
      p50Pts.push(`${x},${y50}`)
      upperPts.push(`${x},${y90}`)
      lowerPts.unshift(`${x},${y10}`)
    }

    return {
      nodeId: series.nodeId,
      color: series.color,
      p50Points: p50Pts.join(' '),
      bandPoints: [...upperPts, ...lowerPts].join(' ')
    }
  })
})

const activeEconomyExportCode = computed(() => {
  if (economyExportLang.value === 'godot') {
    return exportGodotEconomySimulatorGd(liveEconomyDiagram.value)
  }
  if (economyExportLang.value === 'unity') {
    return exportUnityEconomyManagerCs(liveEconomyDiagram.value)
  }
  if (economyExportLang.value === 'mermaid') {
    return exportMachinationsToMermaid(liveEconomyDiagram.value)
  }
  return exportMachinationsTelemetryCsv(liveEconomyMcResult.value)
})

function downloadEconomyTelemetryCsv(): void {
  const stem = (node.value?.title?.trim() || 'game_economy').replace(/\s+/g, '_')
  downloadTextFile(
    exportMachinationsTelemetryCsv(liveEconomyMcResult.value),
    `${stem}_telemetry.csv`,
    'text/csv;charset=utf-8'
  )
}

function downloadEconomyDiagramJson(): void {
  const stem = (node.value?.title?.trim() || 'game_economy').replace(/\s+/g, '_')
  downloadTextFile(
    JSON.stringify(liveEconomyDiagram.value, null, 2),
    `${stem}_machinations.json`,
    'application/json;charset=utf-8'
  )
}

void [
  applyUniformNineSliceInWorkbench,
  uiLiveAnchors,
  applyNineSlicePreset,
  lastHydratedArtboardNodeId,
  onPsStylePresetSelectChange,
  applyActiveThemeToAllArtboards,
  onPsResolutionChange,
  downloadFullScreenUiTscn,
  exportArtboardAsUniversalJson,
  exportArtboardAsPng
]
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
  gap: 10px;
  height: 36px;
  min-height: 36px;
  max-height: 36px;
  padding: 0 12px;
  background: color-mix(in srgb, var(--panel) 94%, transparent);
  border-top: 1px solid color-mix(in srgb, var(--border) 82%, transparent);
  flex-shrink: 0;
  overflow: hidden;
}

.header-left,
.header-right {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex-shrink: 0;
}

.workbench-header .spec-badge {
  white-space: nowrap;
  flex-shrink: 0;
}

.header-right :deep(.node-run-btn) {
  width: auto;
  height: 26px;
  padding: 0 10px;
  border-radius: 6px;
  font-size: 11px;
  white-space: nowrap;
}

.title-input {
  height: 26px;
  padding: 0 8px;
  border-radius: 5px;
  border: 1px solid color-mix(in srgb, var(--border) 80%, transparent);
  background: color-mix(in srgb, var(--panel) 88%, transparent);
  color: var(--text);
  font-size: 11px;
  font-weight: 600;
  min-width: 150px;
}

.type-pill {
  font-size: 11px;
  font-weight: 600;
  height: 24px;
  padding: 0 8px;
  display: inline-flex;
  align-items: center;
  border-radius: 5px;
  background: color-mix(in srgb, var(--panel) 84%, transparent);
  border: 1px solid color-mix(in srgb, var(--border) 82%, transparent);
  color: var(--text);
  white-space: nowrap;
  flex-shrink: 0;
}

.tab-pill {
  padding: 4px 10px;
  border-radius: 6px;
  border: 1px solid color-mix(in srgb, var(--border) 80%, transparent);
  background: color-mix(in srgb, var(--panel) 86%, transparent);
  color: var(--text-muted);
  font-size: 12px;
  white-space: nowrap;
  cursor: pointer;
}

.tab-pill.active {
  background: color-mix(in srgb, var(--accent) 18%, var(--panel));
  border-color: color-mix(in srgb, var(--accent) 45%, transparent);
  color: var(--text);
  font-weight: 600;
}

.done-btn {
  height: 26px;
  padding: 0 12px;
  display: inline-flex;
  align-items: center;
  border-radius: 6px;
  border: 1px solid color-mix(in srgb, var(--accent) 45%, transparent);
  background: color-mix(in srgb, var(--accent) 18%, var(--panel));
  color: var(--text);
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
  flex-shrink: 0;
  cursor: pointer;
}

.workbench-body {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 320px 1fr;
  grid-template-rows: minmax(0, 1fr);
  overflow: hidden;
}

.workbench-body.artboard-full-mode {
  grid-template-columns: 1fr;
}

.workbench-body.artboard-full-mode .workbench-stage {
  height: 100%;
  overflow: hidden;
  padding: 4px 8px 6px;
  gap: 4px;
  box-sizing: border-box;
}

.workbench-sidebar {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px 10px;
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
  white-space: nowrap;
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
  padding: 6px 10px;
  gap: 6px;
}

.stage-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  padding-bottom: 5px;
  border-bottom: 1px solid color-mix(in srgb, var(--border) 72%, transparent);
  flex-shrink: 0;
}

.stage-title {
  font-size: 13px;
  font-weight: 600;
  line-height: 1.25;
}

.tab-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.stage-content {
  flex: 1;
  min-height: 0;
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  padding: 0;
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
  min-height: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  border-radius: 10px;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--border) 82%, transparent);
}

.playable-sandbox-iframe {
  width: 100%;
  flex: 1;
  min-height: 0;
  height: 100%;
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
  image-rendering: auto;
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

.slice-guide-line.active {
  stroke: var(--accent);
  stroke-width: 1.4;
  stroke-dasharray: none;
}

.slice-guide-hit {
  stroke: transparent;
  stroke-width: 5.5;
  pointer-events: stroke;
}

.slice-guide-hit.ew {
  cursor: ew-resize;
}

.slice-guide-hit.ns {
  cursor: ns-resize;
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

.data-grid-wrap {
  overflow-x: auto;
  max-height: 220px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-subtle);
  margin-bottom: 8px;
}

.data-edit-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.data-edit-table th,
.data-edit-table td {
  padding: 4px 6px;
  border-bottom: 1px solid var(--border);
  text-align: left;
  white-space: nowrap;
}

.data-edit-table th {
  background: var(--panel);
  color: var(--text-muted);
  font-weight: 600;
}

.data-cell-input {
  width: 100%;
  min-width: 72px;
  padding: 3px 6px;
  font-size: 12px;
  color: var(--text);
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 4px;
}

.data-cell-input:focus {
  outline: none;
  border-color: var(--accent);
}

.channel-img-wrap {
  width: 100%;
  border-radius: 6px;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}

.alpha-checkerboard-bg {
  background-color: #161822;
  background-image:
    linear-gradient(45deg, #232736 25%, transparent 25%),
    linear-gradient(-45deg, #232736 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #232736 75%),
    linear-gradient(-45deg, transparent 75%, #232736 75%);
  background-size: 16px 16px;
  background-position:
    0 0,
    0 8px,
    8px -8px,
    -8px 0;
}

.ui-foil-stage {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  min-height: 290px;
}

.ui-foil-card-3d {
  position: relative;
  width: 248px;
  height: 248px;
  border-radius: 12px;
  overflow: hidden;
  transition: transform 0.08s ease-out;
  box-shadow: 0 18px 38px rgba(0, 0, 0, 0.55);
}

.ui-foil-base-img {
  width: 100%;
  height: 100%;
  display: block;
  image-rendering: auto;
}

.ui-foil-shimmer-layer {
  position: absolute;
  inset: 0;
  mix-blend-mode: color-dodge;
  pointer-events: none;
}

.ui-foil-text-svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.ui-svg-cost-text {
  font-size: 8.5px;
  font-weight: 900;
  fill: #fef08a;
  stroke: #090a12;
  stroke-width: 0.9px;
  paint-order: stroke fill;
}

.ui-svg-title-text {
  font-size: 5.8px;
  font-weight: 800;
  fill: #f8fafc;
  stroke: #090a12;
  stroke-width: 0.75px;
  paint-order: stroke fill;
}

.ui-svg-body-text {
  font-size: 4.5px;
  font-weight: 700;
  fill: #fef3c7;
  stroke: #090a12;
  stroke-width: 0.65px;
  paint-order: stroke fill;
}

.ui-button-deck-stage {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 24px;
  padding: 20px;
}

.ui-interactive-btn-preview,
.ui-rarity-preview-card {
  position: relative;
  width: 200px;
  height: 200px;
  border-radius: 12px;
  border: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  user-select: none;
  transition: transform 0.08s ease;
}

.ui-interactive-btn-preview.is-pressed {
  transform: translateY(3px) scale(0.98);
}

.ui-btn-state-img {
  width: 156px;
  height: 156px;
  image-rendering: auto;
}

.ui-btn-caption {
  position: absolute;
  font-size: 13px;
  font-weight: 800;
  letter-spacing: 0.06em;
  color: #fffbeb;
  text-shadow: 0 2px 4px rgba(0, 0, 0, 0.85);
  pointer-events: none;
}

.ui-hud-simulator-stage {
  width: 100%;
  max-width: 460px;
  margin: 18px auto;
  padding: 20px;
  border-radius: 12px;
  border: 1px solid var(--border);
  background: rgba(9, 10, 18, 0.75);
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.ui-hud-simulator-stage.low-hp-warning {
  border-color: #f43f5e;
  box-shadow: 0 0 20px rgba(244, 63, 94, 0.32);
}

.ui-hud-readout {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 13px;
}

.ui-hud-bar-stack {
  position: relative;
  width: 100%;
  aspect-ratio: 256 / 56;
  max-height: 92px;
  border-radius: 8px;
  overflow: hidden;
}

.ui-hud-layer {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: fill;
  image-rendering: auto;
  pointer-events: none;
}

.ui-hud-trail-layer {
  filter: brightness(2.45) saturate(0.18) contrast(1.15);
  transition: clip-path 0.42s cubic-bezier(0.22, 1, 0.36, 1);
}

.ui-hud-fill-layer {
  transition: clip-path 0.12s ease-out;
}

.nine-slice-resizer-bar {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--bg-subtle);
}

.nine-slice-dual-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 18px;
  width: 100%;
}

.nine-slice-live-preview {
  min-width: 220px;
  min-height: 220px;
  padding: 12px;
  border-radius: 10px;
  border: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: center;
}

.nine-slice-resized-img {
  image-rendering: auto;
  display: block;
}

.ui-radial-cd-sweep {
  position: absolute;
  inset: 10px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #facc15;
  font-size: 16px;
  text-shadow: 0 2px 6px rgba(0, 0, 0, 0.9);
  pointer-events: none;
}

.ui-dialogue-sandbox-card {
  width: 100%;
  max-width: 520px;
  margin: 14px auto;
  padding: 16px;
  border-radius: 12px;
  border: 1px solid var(--border);
  display: flex;
  align-items: center;
  gap: 16px;
}

.ui-dialogue-text-preview {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
  color: var(--text);
}

.ui-dialogue-text-preview p {
  margin: 0;
  line-height: 1.45;
  color: var(--text-muted);
}

/* 16:9 Full-Screen Game UI Blueprint Composer */
.ui-fullscreen-16x9 {
  position: relative;
  width: 100%;
  max-width: 780px;
  aspect-ratio: 16 / 9;
  margin: 10px auto;
  border-radius: 12px;
  border: 2px solid rgba(250, 204, 21, 0.35);
  background:
    radial-gradient(circle at 50% 35%, rgba(30, 41, 59, 0.72), rgba(9, 10, 18, 0.95)),
    repeating-linear-gradient(
      45deg,
      rgba(148, 163, 184, 0.025) 0px,
      rgba(148, 163, 184, 0.025) 12px,
      transparent 12px,
      transparent 24px
    );
  overflow: hidden;
  box-shadow: 0 14px 36px rgba(0, 0, 0, 0.45);
  user-select: none;
}

.hud-top-left {
  position: absolute;
  top: 14px;
  left: 14px;
  display: flex;
  align-items: center;
  gap: 10px;
}

.hud-avatar-frame {
  width: 68px;
  height: 68px;
  image-rendering: auto;
  filter: drop-shadow(0 4px 10px rgba(0, 0, 0, 0.6));
}

.hud-bars-col {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 190px;
}

.hud-mini-bar {
  position: relative;
  width: 100%;
  height: 26px;
  border-radius: 6px;
  overflow: hidden;
  cursor: pointer;
}

.hud-bar-text {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: 700;
  color: #fff;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.95);
  pointer-events: none;
}

.hud-top-center {
  position: absolute;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  width: 280px;
}

.boss-title-label {
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.06em;
  color: #fda4af;
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.9);
}

.hud-boss-bar {
  position: relative;
  width: 100%;
  height: 24px;
}

.hud-top-right {
  position: absolute;
  top: 12px;
  right: 14px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}

.hud-minimap-ring {
  width: 84px;
  height: 84px;
  image-rendering: auto;
}

.compass-n-badge {
  font-size: 10px;
  font-weight: 700;
  color: #facc15;
}

.hud-bottom-skills {
  position: absolute;
  bottom: 14px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 12px;
  border-radius: 10px;
  background: rgba(9, 10, 18, 0.65);
  border: 1px solid rgba(148, 163, 184, 0.18);
}

.hud-skill-slot {
  position: relative;
  width: 54px;
  height: 54px;
  cursor: pointer;
  transition: transform 0.12s ease;
}

.hud-skill-slot:hover {
  transform: translateY(-2px) scale(1.04);
}

.hud-skill-img {
  width: 100%;
  height: 100%;
  image-rendering: auto;
}

.hud-hotkey-pill {
  position: absolute;
  bottom: 2px;
  right: 4px;
  padding: 1px 4px;
  border-radius: 4px;
  background: rgba(9, 10, 18, 0.9);
  color: #facc15;
  font-size: 9px;
  font-weight: 800;
}

/* Blueprint 2: RPG Inventory & Character Paperdoll */
.inv-screen-grid {
  display: grid;
  grid-template-columns: 1fr 1.25fr;
  gap: 12px;
  width: 100%;
  height: 100%;
  padding: 14px;
  box-sizing: border-box;
}

.inv-paperdoll-panel,
.inv-bag-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  border-radius: 10px;
  background: rgba(12, 14, 24, 0.86);
  border: 1px solid rgba(250, 204, 21, 0.25);
}

.inv-panel-header {
  font-size: 11px;
  font-weight: 800;
  color: #facc15;
  letter-spacing: 0.05em;
}

.inv-paperdoll-body {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex: 1;
}

.inv-equip-col {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.inv-slot-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  font-size: 9px;
  color: var(--text-muted);
}

.inv-slot-box img {
  width: 46px;
  height: 46px;
  image-rendering: auto;
}

.inv-hero-card img {
  width: 116px;
  height: 142px;
  object-fit: contain;
  image-rendering: auto;
}

.inv-tabs-row {
  display: flex;
  gap: 4px;
}

.inv-tab-btn {
  flex: 1;
  padding: 5px 6px;
  font-size: 10px;
  font-weight: 700;
  border-radius: 6px 6px 0 0;
  border: 1px solid rgba(148, 163, 184, 0.2);
  background: rgba(24, 26, 40, 0.75);
  color: var(--text-muted);
  cursor: pointer;
}

.inv-tab-btn.active {
  background: rgba(250, 204, 21, 0.2);
  border-color: #facc15;
  color: #facc15;
}

.inv-bag-content {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 8px;
  flex: 1;
}

.inv-items-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
}

.inv-grid-cell {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4px;
  border-radius: 6px;
  border: 1px solid rgba(148, 163, 184, 0.18);
  background: rgba(9, 10, 18, 0.65);
  cursor: pointer;
}

.inv-grid-cell.selected {
  border-color: #38bdf8;
  box-shadow: 0 0 10px rgba(56, 189, 248, 0.45);
}

.inv-grid-cell img {
  width: 44px;
  height: 44px;
  image-rendering: auto;
}

.inv-grid-cell small {
  position: absolute;
  bottom: 2px;
  right: 4px;
  font-size: 8px;
  font-weight: 800;
  color: #facc15;
}

.inv-tooltip-box {
  padding: 8px 10px;
  border-radius: 8px;
  background: rgba(9, 10, 18, 0.92);
  border: 1px solid rgba(250, 204, 21, 0.4);
  display: flex;
  flex-direction: column;
  gap: 3px;
  font-size: 11px;
}

.inv-tooltip-box p {
  margin: 0;
  font-size: 10px;
  color: var(--text-muted);
}

/* Blueprint 3: AVG / RPG Dialogue & Branching Choice */
.vn-screen-stage {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  padding: 16px;
  box-sizing: border-box;
  gap: 12px;
}

.vn-choices-stack {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  margin-bottom: auto;
  margin-top: 28px;
}

.vn-choice-pill {
  width: 78%;
  padding: 8px 14px;
  border-radius: 999px;
  border: 1px solid rgba(250, 204, 21, 0.55);
  background: rgba(15, 18, 32, 0.88);
  color: #f8fafc;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition:
    transform 0.12s ease,
    background 0.12s ease;
}

.vn-choice-pill:hover {
  transform: scale(1.02);
  background: rgba(250, 204, 21, 0.22);
}

.vn-dialogue-dock {
  position: relative;
  padding: 14px 16px;
  border-radius: 10px;
  background: rgba(10, 12, 22, 0.92);
  border: 2px solid rgba(250, 204, 21, 0.55);
  cursor: pointer;
}

.vn-nameplate-tab {
  position: absolute;
  top: -13px;
  left: 18px;
  padding: 3px 12px;
  border-radius: 6px;
  background: #1e293b;
  border: 1px solid #facc15;
  color: #facc15;
  font-size: 10px;
  font-weight: 800;
}

.vn-dialogue-body {
  display: flex;
  align-items: center;
  gap: 12px;
}

.vn-portrait-img {
  width: 64px;
  height: 64px;
  image-rendering: auto;
  flex-shrink: 0;
}

.vn-text-area p {
  margin: 0;
  font-size: 12px;
  line-height: 1.45;
  color: #f1f5f9;
}

.vn-bounce-cursor {
  margin-left: auto;
  color: #facc15;
  font-size: 12px;
  animation: vnCursorBounce 0.8s infinite alternate;
}

@keyframes vnCursorBounce {
  from {
    transform: translateY(-2px);
  }
  to {
    transform: translateY(4px);
  }
}

/* Blueprint 4: Settings & Form Controls Modal */
.settings-modal-window {
  width: 78%;
  margin: 22px auto;
  padding: 16px;
  border-radius: 12px;
  background: rgba(12, 14, 24, 0.92);
  border: 2px solid rgba(250, 204, 21, 0.45);
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.settings-form-rows {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.settings-row {
  display: grid;
  grid-template-columns: 130px 1fr 48px;
  align-items: center;
  gap: 10px;
  font-size: 12px;
}

.settings-toggles-row {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.settings-check-pill {
  flex: 1;
  padding: 8px 12px;
  border-radius: 8px;
  border: 1px solid rgba(148, 163, 184, 0.22);
  background: rgba(20, 24, 38, 0.85);
  color: var(--text);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
}

.settings-check-pill.active {
  border-color: #38bdf8;
  background: rgba(56, 189, 248, 0.16);
  color: #e0f2fe;
}

.settings-footer-btns {
  display: flex;
  justify-content: flex-end;
}

/* ============================================================================
   Photoshop Artboard UI Studio (Top Options · Left Icon Dock · Rulers · Layers)
   ============================================================================ */
.ps-artboard-studio {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  width: 100%;
  height: 100%;
  border-radius: 10px;
  border: 1px solid rgba(148, 163, 184, 0.18);
  background: #18191c;
  overflow: hidden;
  user-select: none;
}

.ps-top-options-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  background: #25262b;
  border-bottom: 1px solid #111215;
  flex-wrap: wrap;
}

.ps-option-group {
  display: flex;
  align-items: center;
  gap: 4px;
}

.ps-bar-sep {
  width: 1px;
  height: 18px;
  background: rgba(148, 163, 184, 0.18);
  margin: 0 2px;
}

.ps-svg-icon {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}

.ps-svg-icon.muted {
  opacity: 0.6;
}

.ps-top-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 8px;
  border-radius: 5px;
  border: 1px solid rgba(148, 163, 184, 0.16);
  background: #1e1f24;
  color: #cbd5e1;
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.12s ease;
}

.ps-top-pill:hover {
  border-color: rgba(56, 189, 248, 0.5);
  color: #fff;
}

.ps-top-pill.active {
  background: rgba(56, 189, 248, 0.2);
  border-color: #38bdf8;
  color: #38bdf8;
}

.ps-res-select {
  padding: 3px 6px;
  border-radius: 4px;
  border: 1px solid rgba(148, 163, 184, 0.24);
  background: #18191c;
  color: #f1f5f9;
  font-size: 11px;
  font-weight: 600;
}

.ps-zoom-readout {
  min-width: 38px;
  text-align: center;
  font-size: 11px;
  font-weight: 700;
  color: #e2e8f0;
  cursor: pointer;
}

.ps-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 5px;
  border: 1px solid transparent;
  background: rgba(148, 163, 184, 0.08);
  color: #cbd5e1;
  cursor: pointer;
  transition: all 0.12s ease;
}

.ps-icon-btn:hover {
  background: rgba(148, 163, 184, 0.18);
  color: #fff;
}

.ps-icon-btn.active {
  background: rgba(56, 189, 248, 0.22);
  border-color: #38bdf8;
  color: #38bdf8;
}

.ps-icon-btn.danger:hover {
  background: rgba(244, 63, 94, 0.22);
  border-color: #f43f5e;
  color: #fda4af;
}

.ps-export-group {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 6px;
}

.ps-export-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 9px;
  border-radius: 5px;
  border: 1px solid rgba(250, 204, 21, 0.5);
  background: rgba(250, 204, 21, 0.16);
  color: #facc15;
  font-size: 11px;
  font-weight: 800;
  cursor: pointer;
}

.ps-export-btn:hover {
  background: rgba(250, 204, 21, 0.28);
}

.ps-export-btn.png-btn {
  border-color: rgba(56, 189, 248, 0.55);
  background: rgba(56, 189, 248, 0.16);
  color: #38bdf8;
}

.ps-export-btn.png-btn:hover {
  background: rgba(56, 189, 248, 0.28);
}

.ps-export-btn.json-btn {
  border-color: rgba(168, 85, 247, 0.55);
  background: rgba(168, 85, 247, 0.16);
  color: #d8b4fe;
}

.ps-export-btn.json-btn:hover {
  background: rgba(168, 85, 247, 0.28);
}

.ps-workspace-body {
  flex: 1;
  min-height: 0;
  height: 100%;
  display: grid;
  grid-template-columns: 64px 1fr 242px;
  grid-template-rows: minmax(0, 1fr);
  align-items: stretch;
  overflow: hidden;
}

/* 1. Left PS 2-Column Widget & Tool Icon Dock */
.ps-left-tool-dock {
  display: grid;
  grid-template-columns: repeat(2, 26px);
  align-content: start;
  justify-content: center;
  gap: 3px;
  padding: 6px 3px;
  min-height: 0;
  height: 100%;
  overflow-y: auto;
  box-sizing: border-box;
  background: #212226;
  border-right: 1px solid #111215;
}

.ps-dock-divider {
  grid-column: 1 / -1;
  width: 100%;
  height: 1px;
  background: rgba(148, 163, 184, 0.18);
  margin: 2px 0;
}

.ps-dock-icon-btn {
  width: 26px;
  height: 26px;
  border-radius: 6px;
  border: 1px solid transparent;
  background: transparent;
  color: #cbd5e1;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.12s ease;
}

.ps-dock-icon-btn:hover {
  background: rgba(148, 163, 184, 0.16);
  border-color: rgba(148, 163, 184, 0.26);
  transform: scale(1.06);
}

.ps-dock-icon-btn.active {
  background: rgba(56, 189, 248, 0.22);
  border-color: #38bdf8;
  color: #38bdf8;
}

/* 2. Center Rulers & Artboard Viewport */
.ps-center-viewport {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
  background: #141518;
  overflow: hidden;
}

.ps-ruler-horizontal {
  display: flex;
  height: 18px;
  background: #232429;
  border-bottom: 1px solid #111215;
  font-size: 9px;
  color: #94a3b8;
}

.ps-ruler-corner {
  width: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-right: 1px solid #111215;
  font-size: 8px;
  color: #64748b;
}

.ps-ruler-track-h {
  position: relative;
  flex: 1;
  overflow: hidden;
}

.ps-ruler-tick-h {
  position: absolute;
  top: 2px;
  padding-left: 3px;
  border-left: 1px solid rgba(148, 163, 184, 0.32);
  line-height: 1;
}

.ps-ruler-cursor-h {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background: #38bdf8;
  pointer-events: none;
}

.ps-ruler-and-canvas-row {
  display: flex;
  flex: 1;
  min-height: 0;
}

.ps-ruler-vertical {
  position: relative;
  width: 20px;
  background: #232429;
  border-right: 1px solid #111215;
  font-size: 8px;
  color: #94a3b8;
  overflow: hidden;
}

.ps-ruler-tick-v {
  position: absolute;
  left: 1px;
  padding-top: 2px;
  border-top: 1px solid rgba(148, 163, 184, 0.32);
  writing-mode: vertical-rl;
  line-height: 1;
}

.ps-ruler-cursor-v {
  position: absolute;
  left: 0;
  right: 0;
  height: 1px;
  background: #38bdf8;
  pointer-events: none;
}

.ps-artboard-desk {
  container-type: size;
  flex: 1;
  min-height: 0;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 4px 6px;
  box-sizing: border-box;
  overflow: auto;
}

.ps-artboard-header-caption {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  max-width: 96%;
  margin-bottom: 4px;
  flex-shrink: 0;
  font-size: 10px;
  color: #94a3b8;
}

.ps-artboard-name {
  font-weight: 800;
  color: #e2e8f0;
}

.ps-artboard-res-badge {
  padding: 1px 6px;
  border-radius: 4px;
  background: rgba(56, 189, 248, 0.14);
  color: #38bdf8;
  font-weight: 700;
}

.ps-cursor-xy-badge {
  margin-left: auto;
  font-family: monospace;
  color: #cbd5e1;
}

.ps-artboard-paper {
  position: relative;
  width: 100%;
  border-radius: 4px;
  border: 1px solid rgba(148, 163, 184, 0.34);
  box-shadow: 0 16px 42px rgba(0, 0, 0, 0.65);
  overflow: hidden;
}

.ps-artboard-paper.backdrop-dark {
  background:
    radial-gradient(circle at 50% 35%, rgba(30, 41, 59, 0.85), rgba(9, 10, 18, 0.98)),
    repeating-linear-gradient(
      0deg,
      rgba(148, 163, 184, 0.03) 0px,
      rgba(148, 163, 184, 0.03) 1px,
      transparent 1px,
      transparent 24px
    ),
    repeating-linear-gradient(
      90deg,
      rgba(148, 163, 184, 0.03) 0px,
      rgba(148, 163, 184, 0.03) 1px,
      transparent 1px,
      transparent 24px
    );
}

.ps-artboard-paper.backdrop-checker {
  background-color: #1e2028;
  background-image:
    linear-gradient(45deg, #2a2d37 25%, transparent 25%),
    linear-gradient(-45deg, #2a2d37 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #2a2d37 75%),
    linear-gradient(-45deg, transparent 75%, #2a2d37 75%);
  background-size: 20px 20px;
  background-position:
    0 0,
    0 10px,
    10px -10px,
    -10px 0;
}

.ps-artboard-paper.backdrop-blueprint {
  background-color: #0b192c;
  background-image:
    linear-gradient(rgba(56, 189, 248, 0.14) 1px, transparent 1px),
    linear-gradient(90deg, rgba(56, 189, 248, 0.14) 1px, transparent 1px);
  background-size: 24px 24px;
}

.ps-safe-zone-guide {
  position: absolute;
  inset: 5%;
  border: 1px dashed rgba(56, 189, 248, 0.35);
  pointer-events: none;
  z-index: 20;
}

.ps-center-crosshair-h {
  position: absolute;
  top: 50%;
  left: 0;
  right: 0;
  height: 1px;
  background: rgba(56, 189, 248, 0.16);
}

.ps-center-crosshair-v {
  position: absolute;
  left: 50%;
  top: 0;
  bottom: 0;
  width: 1px;
  background: rgba(56, 189, 248, 0.16);
}

.ps-smart-guide-v {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background: #f43f5e;
  box-shadow: 0 0 6px rgba(244, 63, 94, 0.85);
  pointer-events: none;
  z-index: 35;
}

.ps-smart-guide-h {
  position: absolute;
  left: 0;
  right: 0;
  height: 1px;
  background: #f43f5e;
  box-shadow: 0 0 6px rgba(244, 63, 94, 0.85);
  pointer-events: none;
  z-index: 35;
}

.ps-artboard-layer {
  position: absolute;
  box-sizing: border-box;
  cursor: move;
}

.ps-artboard-layer.locked {
  cursor: default;
}

.ps-artboard-layer.selected {
  outline: 1.5px solid #38bdf8;
  box-shadow: 0 0 0 1px rgba(9, 10, 18, 0.65);
  z-index: 15;
}

.ps-transform-coord-pill {
  position: absolute;
  top: -19px;
  left: 0;
  padding: 1px 5px;
  border-radius: 3px;
  background: #38bdf8;
  color: #090a12;
  font-size: 9px;
  font-weight: 800;
  white-space: nowrap;
  pointer-events: none;
  z-index: 30;
}

.ps-transform-handle {
  position: absolute;
  width: 7px;
  height: 7px;
  background: #fff;
  border: 1.5px solid #0284c7;
  box-sizing: border-box;
  z-index: 25;
}

.ps-transform-handle.handle-nw {
  top: -4px;
  left: -4px;
  cursor: nwse-resize;
}
.ps-transform-handle.handle-n {
  top: -4px;
  left: calc(50% - 3.5px);
  cursor: ns-resize;
}
.ps-transform-handle.handle-ne {
  top: -4px;
  right: -4px;
  cursor: nesw-resize;
}
.ps-transform-handle.handle-e {
  top: calc(50% - 3.5px);
  right: -4px;
  cursor: ew-resize;
}
.ps-transform-handle.handle-se {
  bottom: -4px;
  right: -4px;
  cursor: nwse-resize;
}
.ps-transform-handle.handle-s {
  bottom: -4px;
  left: calc(50% - 3.5px);
  cursor: ns-resize;
}
.ps-transform-handle.handle-sw {
  bottom: -4px;
  left: -4px;
  cursor: nesw-resize;
}
.ps-transform-handle.handle-w {
  top: calc(50% - 3.5px);
  left: -4px;
  cursor: ew-resize;
}

.ps-layer-slice-guides {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 22;
}

.ps-layer-slice-guides .slice-v {
  position: absolute;
  top: 0;
  bottom: 0;
  border-left: 1px dashed #facc15;
}
.ps-layer-slice-guides .slice-v.left {
  left: 22%;
}
.ps-layer-slice-guides .slice-v.right {
  right: 22%;
}
.ps-layer-slice-guides .slice-h {
  position: absolute;
  left: 0;
  right: 0;
  border-top: 1px dashed #facc15;
}
.ps-layer-slice-guides .slice-h.top {
  top: 22%;
}
.ps-layer-slice-guides .slice-h.bottom {
  bottom: 22%;
}

/* Widget Renderers inside Artboard Layers */
.ps-widget-fill {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.ps-widget-img {
  width: 100%;
  height: 100%;
  image-rendering: auto;
  pointer-events: none;
}
.ps-widget-img.contain {
  object-fit: contain;
}
.ps-widget-img.fill {
  object-fit: fill;
}

.ps-avatar-lv-pill {
  position: absolute;
  bottom: 4px;
  left: 50%;
  transform: translateX(-50%);
  padding: 1px 6px;
  border-radius: 99px;
  background: rgba(9, 10, 18, 0.9);
  border: 1px solid #facc15;
  color: #facc15;
  font-size: 9px;
  font-weight: 800;
  white-space: nowrap;
  pointer-events: none;
}

.ps-compass-badge {
  position: absolute;
  top: 4px;
  left: 50%;
  transform: translateX(-50%);
  padding: 1px 6px;
  border-radius: 99px;
  background: rgba(9, 10, 18, 0.88);
  border: 1px solid rgba(250, 204, 21, 0.55);
  color: #facc15;
  font-size: 9px;
  font-weight: 800;
  white-space: nowrap;
  pointer-events: none;
}

.ps-boss-widget {
  flex-direction: column;
  gap: 2px;
}

.ps-boss-bar-inner {
  position: relative;
  width: 100%;
  flex: 1;
}

.ps-skill-bar-widget {
  width: 100%;
  height: 100%;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
  padding: 4px 8px;
  box-sizing: border-box;
  border-radius: 8px;
  background: rgba(9, 10, 18, 0.65);
  border: 1px solid rgba(148, 163, 184, 0.22);
}

.ps-skill-slot-item {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
}

.ps-inv-widget {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 6px;
  padding: 8px;
  box-sizing: border-box;
  border-radius: 8px;
  background: rgba(12, 14, 24, 0.9);
  border: 1px solid rgba(250, 204, 21, 0.35);
  overflow: hidden;
}

.ps-inv-slots-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 5px;
  flex: 1;
  min-height: 0;
}

.ps-dialogue-widget {
  position: relative;
  width: 100%;
  height: 100%;
  padding: 12px 14px;
  box-sizing: border-box;
  border-radius: 8px;
  background: rgba(10, 12, 22, 0.92);
  border: 2px solid rgba(250, 204, 21, 0.55);
  display: flex;
  align-items: center;
}

.ps-settings-widget {
  width: 100%;
  height: 100%;
  padding: 12px;
  box-sizing: border-box;
  border-radius: 10px;
  background: rgba(12, 14, 24, 0.92);
  border: 2px solid rgba(56, 189, 248, 0.45);
  display: flex;
  flex-direction: column;
  justify-content: space-around;
  gap: 6px;
  cursor: default;
}

.ps-ui-btn-widget {
  border-radius: 6px;
}

.ps-btn-label {
  position: absolute;
  font-size: 11px;
  font-weight: 800;
  color: #fef08a;
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.95);
  pointer-events: none;
}

.ps-freeform-text-widget {
  flex-direction: column;
  gap: 2px;
  text-align: center;
  padding: 4px 8px;
  box-sizing: border-box;
  font-weight: 900;
  text-shadow:
    0 2px 6px rgba(0, 0, 0, 0.92),
    0 0 2px #090a12;
  line-height: 1.15;
}

.ps-freeform-main-text {
  white-space: pre-wrap;
  word-break: break-word;
}

.ps-freeform-sub-text {
  font-size: 0.62em;
  font-weight: 700;
  color: #cbd5e1;
  letter-spacing: 0.08em;
}

.ps-freeform-panel-widget {
  flex-direction: column;
  align-items: stretch;
  justify-content: flex-start;
  border: 2px solid #eab308;
  box-shadow:
    inset 0 1px 0 rgba(226, 232, 240, 0.25),
    0 10px 26px rgba(0, 0, 0, 0.55);
  box-sizing: border-box;
  padding: 10px 12px;
  gap: 6px;
}

.ps-panel-box-header {
  font-size: 12px;
  font-weight: 800;
  padding-bottom: 5px;
  border-bottom: 1px solid rgba(234, 179, 8, 0.35);
  letter-spacing: 0.05em;
}

.ps-panel-box-body {
  font-size: 10px;
  color: #e2e8f0;
  line-height: 1.45;
  white-space: pre-wrap;
}

.ps-custom-image-widget {
  box-sizing: border-box;
  background: rgba(9, 10, 18, 0.35);
}

.ps-custom-image-caption,
.ps-card-overlay-title {
  position: absolute;
  bottom: 6px;
  left: 50%;
  transform: translateX(-50%);
  padding: 2px 8px;
  border-radius: 99px;
  background: rgba(9, 10, 18, 0.88);
  border: 1px solid rgba(250, 204, 21, 0.45);
  font-size: 9px;
  font-weight: 800;
  white-space: nowrap;
  pointer-events: none;
}

/* 6 Specialized Game UI Widgets (Currency, Buffs, Key Prompt, Radial Wheel, Item Slot, Tab Bar) */
.ps-currency-bar-widget {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 3px 6px;
  box-sizing: border-box;
}

.ps-currency-pill {
  flex: 1;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 8px;
  border-radius: 99px;
  background: rgba(9, 10, 18, 0.88);
  border: 1px solid rgba(250, 204, 21, 0.45);
  font-size: 10px;
  font-weight: 800;
  box-shadow: inset 0 1px 0 rgba(226, 232, 240, 0.16);
}

.ps-currency-plus {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: rgba(250, 204, 21, 0.25);
  color: #fde047;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: 900;
}

.ps-buff-row-widget {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 5px;
  padding: 2px;
  box-sizing: border-box;
}

.ps-buff-cell {
  position: relative;
  width: 100%;
  height: 100%;
  border-radius: 5px;
  overflow: hidden;
}

.ps-buff-cell small {
  position: absolute;
  bottom: 2px;
  left: 50%;
  transform: translateX(-50%);
  padding: 0 3px;
  border-radius: 3px;
  background: rgba(9, 10, 18, 0.9);
  color: #fde047;
  font-size: 8px;
  font-weight: 800;
  white-space: nowrap;
}

.ps-key-prompt-widget {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  padding: 4px 12px;
  box-sizing: border-box;
  border-radius: 99px;
  background: rgba(9, 10, 18, 0.88);
  border: 1.5px solid rgba(56, 189, 248, 0.6);
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.55);
}

.ps-keycap-box {
  min-width: 20px;
  height: 20px;
  padding: 0 5px;
  border-radius: 4px;
  background: linear-gradient(180deg, #f8fafc, #cbd5e1);
  border: 1px solid #fff;
  box-shadow: 0 2px 0 #475569;
  color: #090a12;
  font-size: 10px;
  font-weight: 900;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.ps-keyprompt-label {
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.05em;
  white-space: nowrap;
}

.ps-wheel-center-pill {
  position: absolute;
  padding: 2px 8px;
  border-radius: 99px;
  background: rgba(9, 10, 18, 0.92);
  border: 1px solid rgba(250, 204, 21, 0.6);
  color: #fef08a;
  font-size: 9px;
  font-weight: 800;
  pointer-events: none;
}

.ps-item-slot-widget {
  border-radius: 8px;
}

.ps-slot-top-badge {
  position: absolute;
  top: 4px;
  right: 5px;
  padding: 1px 5px;
  border-radius: 4px;
  background: rgba(9, 10, 18, 0.9);
  border: 1px solid rgba(250, 204, 21, 0.5);
  color: #fde047;
  font-size: 8px;
  font-weight: 900;
  pointer-events: none;
}

.ps-tab-bar-widget {
  display: flex;
  align-items: stretch;
  gap: 5px;
  padding: 3px;
  box-sizing: border-box;
  border-radius: 7px;
  background: rgba(9, 10, 18, 0.78);
  border: 1px solid rgba(148, 163, 184, 0.22);
}

.ps-nav-tab-item {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 5px;
  background: rgba(148, 163, 184, 0.08);
  border: 1px solid rgba(148, 163, 184, 0.16);
  color: #cbd5e1;
  font-size: 9px;
  font-weight: 800;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ps-nav-tab-item.active {
  background: linear-gradient(180deg, rgba(234, 179, 8, 0.32), rgba(161, 98, 7, 0.28));
  border-color: #facc15;
  color: #fef08a;
}

.ps-inline-anchor-select {
  width: 100%;
  border: none;
  background: transparent;
  color: #38bdf8;
  font-size: 10px;
  font-weight: 700;
  text-align: right;
}

.ps-top-pill.blank-pill {
  border-color: rgba(52, 211, 153, 0.45);
  color: #6ee7b7;
}

.ps-top-pill.blank-pill.active {
  background: rgba(16, 185, 129, 0.25);
  border-color: #10b981;
  color: #a7f3d0;
}

.ps-parametric-bar-track {
  position: relative;
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  border: 2px solid #f43f5e;
  overflow: hidden;
  box-shadow: inset 0 2px 6px rgba(0, 0, 0, 0.65);
}

.ps-parametric-bar-fill {
  height: 100%;
  transition: width 0.2s ease;
  box-shadow: inset 0 1px 0 rgba(226, 232, 240, 0.4);
}

/* 3. Right Photoshop Layers & Properties Dock */
.ps-right-layers-dock {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
  overflow: hidden;
  background: #212226;
  border-left: 1px solid #111215;
}

.ps-dock-section-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 10px;
  background: #28292e;
  border-bottom: 1px solid #111215;
  font-size: 11px;
  font-weight: 800;
  color: #e2e8f0;
}

.ps-dock-section-header small {
  margin-left: auto;
  padding: 1px 6px;
  border-radius: 99px;
  background: rgba(148, 163, 184, 0.16);
  font-size: 10px;
}

.ps-selected-layer-inspector {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  max-height: 48%;
  overflow-y: auto;
  gap: 6px;
  padding: 8px;
  border-bottom: 1px solid #111215;
  background: #1c1d21;
}

.ps-blend-opacity-row {
  display: flex;
  gap: 6px;
}

.ps-blend-select {
  flex: 1;
  padding: 3px 6px;
  border-radius: 4px;
  border: 1px solid rgba(148, 163, 184, 0.22);
  background: #141518;
  color: #e2e8f0;
  font-size: 11px;
}

.ps-opacity-box {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 0 5px;
  border-radius: 4px;
  border: 1px solid rgba(148, 163, 184, 0.22);
  background: #141518;
  font-size: 10px;
  color: #94a3b8;
}

.ps-opacity-box input {
  width: 36px;
  border: none;
  background: transparent;
  color: #f8fafc;
  font-size: 11px;
  font-weight: 700;
  text-align: right;
}

.ps-xywh-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 4px;
}

.ps-xywh-grid label {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 6px;
  border-radius: 4px;
  background: #141518;
  border: 1px solid rgba(148, 163, 184, 0.16);
  font-size: 10px;
  color: #64748b;
}

.ps-xywh-grid input {
  width: 100%;
  border: none;
  background: transparent;
  color: #e2e8f0;
  font-size: 11px;
  font-family: monospace;
  text-align: right;
}

.ps-custom-props-block {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-top: 4px;
  border-top: 1px solid rgba(148, 163, 184, 0.14);
}

.ps-prop-line {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 2px 6px;
  border-radius: 4px;
  background: #141518;
  border: 1px solid rgba(148, 163, 184, 0.16);
  font-size: 10px;
  color: #94a3b8;
}

.ps-prop-line span {
  flex-shrink: 0;
}

.ps-prop-line input {
  width: 100%;
  border: none;
  background: transparent;
  color: #f8fafc;
  font-size: 11px;
}

.ps-color-upload-row {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
}

.ps-mini-color {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px 5px;
  border-radius: 4px;
  background: #141518;
  border: 1px solid rgba(148, 163, 184, 0.16);
  font-size: 10px;
  color: #94a3b8;
  cursor: pointer;
}

.ps-mini-color input[type='color'] {
  width: 16px;
  height: 16px;
  padding: 0;
  border: none;
  background: transparent;
  cursor: pointer;
}

.ps-upload-mini-btn {
  flex: 1;
  padding: 3px 6px;
  border-radius: 4px;
  border: 1px solid rgba(56, 189, 248, 0.4);
  background: rgba(56, 189, 248, 0.14);
  color: #bae6fd;
  font-size: 10px;
  font-weight: 700;
  cursor: pointer;
  white-space: nowrap;
}

.ps-upload-mini-btn:hover {
  background: rgba(56, 189, 248, 0.25);
}

.ps-upload-mini-btn.clear {
  flex: 0 0 auto;
  border-color: rgba(244, 63, 94, 0.45);
  background: rgba(244, 63, 94, 0.14);
  color: #fecdd3;
}

.ps-layers-scroll-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 1px;
  background: #141518;
}

.ps-upstream-assets-strip {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 6px 8px;
  background: #191b20;
  border-bottom: 1px solid #111215;
  flex-shrink: 0;
}

.ps-upstream-strip-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 10px;
  font-weight: 700;
  color: #93c5fd;
}

.ps-upstream-autofill-btn {
  padding: 2px 6px;
  border-radius: 4px;
  border: 1px solid rgba(56, 189, 248, 0.45);
  background: rgba(56, 189, 248, 0.16);
  color: #e0f2fe;
  font-size: 9px;
  font-weight: 800;
  cursor: pointer;
}

.ps-upstream-autofill-btn:hover {
  background: rgba(56, 189, 248, 0.3);
}

.ps-upstream-thumbs-row {
  display: flex;
  align-items: center;
  gap: 5px;
  overflow-x: auto;
  padding-bottom: 2px;
}

.ps-upstream-thumb-card {
  position: relative;
  width: 36px;
  height: 36px;
  border-radius: 5px;
  border: 1px solid rgba(56, 189, 248, 0.4);
  overflow: hidden;
  flex-shrink: 0;
  cursor: pointer;
}

.ps-upstream-thumb-card:hover {
  border-color: #38bdf8;
  transform: translateY(-1px);
}

.ps-upstream-thumb-card img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.ps-upstream-spawn-badge {
  position: absolute;
  right: 1px;
  bottom: 1px;
  width: 14px;
  height: 14px;
  padding: 0;
  border-radius: 3px;
  border: 1px solid rgba(226, 232, 240, 0.4);
  background: rgba(15, 23, 42, 0.88);
  color: #38bdf8;
  font-size: 11px;
  font-weight: 900;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.ps-upstream-spawn-badge:hover {
  background: #38bdf8;
  color: #090a12;
}

.ps-layer-item-row {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 5px 6px;
  background: #212226;
  border-left: 3px solid transparent;
  cursor: pointer;
  transition: background 0.1s ease;
}

.ps-layer-item-row:hover {
  background: #282a30;
}

.ps-layer-item-row.active {
  background: #2d3748;
  border-left-color: #38bdf8;
}

.ps-layer-item-row.hidden {
  opacity: 0.48;
}

.ps-layer-mini-icon {
  width: 20px;
  height: 20px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: #cbd5e1;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  padding: 0;
}

.ps-layer-mini-icon:hover {
  background: rgba(148, 163, 184, 0.16);
}

.ps-layer-mini-icon.locked {
  color: #facc15;
}

.ps-layer-thumb {
  width: 28px;
  height: 24px;
  border-radius: 3px;
  border: 1px solid rgba(148, 163, 184, 0.28);
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.ps-layer-thumb img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  image-rendering: auto;
}

.ps-layer-meta {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}

.ps-layer-name-input {
  width: 100%;
  border: none;
  background: transparent;
  color: #f1f5f9;
  font-size: 11px;
  font-weight: 600;
  padding: 0;
  text-overflow: ellipsis;
}

.ps-layer-meta small {
  font-size: 9px;
  color: #94a3b8;
  font-family: monospace;
}

.ps-layers-footer-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 8px;
  background: #25262b;
  border-top: 1px solid #111215;
}

/* Machinations Economy Workbench Styles */
.mach-workbench-layout {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
}

.mach-canvas-wrap {
  background:
    radial-gradient(circle at 20% 20%, rgba(56, 189, 248, 0.06), transparent 60%),
    linear-gradient(rgba(148, 163, 184, 0.07) 1px, transparent 1px),
    linear-gradient(90deg, rgba(148, 163, 184, 0.07) 1px, transparent 1px), #0b1120;
  background-size:
    100% 100%,
    24px 24px,
    24px 24px;
  border: 1px solid rgba(56, 189, 248, 0.28);
  border-radius: 10px;
  overflow: hidden;
}

.mach-svg-canvas {
  width: 100%;
  height: auto;
  max-height: 310px;
  display: block;
  user-select: none;
}

.mach-svg-node {
  cursor: grab;
}

.mach-svg-node:active {
  cursor: grabbing;
}

.mach-node-val-text {
  fill: #f8fafc;
  font-size: 11px;
  font-weight: 700;
  font-family: monospace;
  pointer-events: none;
}

.mach-node-label-text {
  fill: #cbd5e1;
  font-size: 10.5px;
  font-weight: 600;
  pointer-events: none;
}

.mach-node-star {
  fill: #fbbf24;
  font-size: 15px;
  font-weight: 800;
  pointer-events: none;
}

.mach-edge-svg-text {
  fill: #e2e8f0;
  font-size: 9px;
  font-family: monospace;
  pointer-events: none;
}

.mach-bottom-grid {
  display: grid;
  grid-template-columns: 1.35fr 1fr;
  gap: 12px;
}

.mach-chart-card,
.mach-diag-card {
  background: rgba(15, 23, 42, 0.72);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.mach-chart-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}

.mach-legend-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.mach-legend-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  color: #cbd5e1;
  background: rgba(30, 41, 59, 0.8);
  padding: 2px 8px;
  border-radius: 999px;
}

.mach-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: inline-block;
}

.mach-timeseries-svg {
  width: 100%;
  height: 165px;
  background: rgba(9, 14, 26, 0.75);
  border-radius: 8px;
  border: 1px solid rgba(148, 163, 184, 0.16);
}

.mach-axis-text {
  fill: #94a3b8;
  font-size: 9.5px;
  font-family: monospace;
}

.mach-diag-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.mach-diag-item {
  border-radius: 8px;
  padding: 8px 10px;
  border: 1px solid rgba(148, 163, 184, 0.25);
  background: rgba(30, 41, 59, 0.45);
}

.mach-diag-item.sev-healthy {
  border-color: rgba(16, 185, 129, 0.45);
}

.mach-diag-item.sev-warning {
  border-color: rgba(245, 158, 11, 0.55);
}

.mach-diag-item.sev-critical {
  border-color: rgba(244, 63, 94, 0.65);
}

.mach-diag-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  margin-bottom: 4px;
}

.mach-diag-detail,
.mach-diag-rec {
  margin: 2px 0;
  font-size: 11px;
  color: var(--muted);
  line-height: 1.4;
}

.mach-inspector-box {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.mach-edge-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.mach-edge-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
}

.mach-edge-tag {
  flex: 1;
  color: #cbd5e1;
  font-family: monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mach-edge-tag.state {
  color: #c084fc;
}

.mach-edge-rate-input {
  width: 64px;
  padding: 3px 6px;
  font-size: 11px;
}
</style>
