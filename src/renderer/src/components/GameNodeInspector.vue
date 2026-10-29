<template>
  <div v-if="node" class="node-inspector">
    <div class="head">
      <h2>{{ displayTitle }}</h2>
      <div class="head-actions">
        <span class="spec-badge">{{ nodeBadge }}</span>
        <button type="button" class="workbench-btn" @click="openWorkbench">
          {{ t('gameNodes.workbench.openBtn') }}
        </button>
      </div>
    </div>
    <p class="hint">
      {{ nodeHint }}
    </p>

    <GraphNodeRunControl
      :status="runStatus"
      :is-running="isGraphRunning"
      :blocked="blocked"
      @toggle="toggleRun"
    />

    <!-- 1A. game.pbrTile: 四方连续无缝瓦片 & Wang-16 自动地形 -->
    <section v-if="node.typeId === 'game.pbrTile'" class="panel-card">
      <div class="section-title">{{ t('gameNodes.pbrTile.sectionTitle') }}</div>

      <label class="field">
        <span>{{ t('gameNodes.pbrTile.assetModeLabel') }}</span>
        <select
          :value="node.params.gamePbrAssetMode ?? 'pbr_tile'"
          @change="onStringParam('gamePbrAssetMode', $event)"
        >
          <option value="pbr_tile">{{ t('gameNodes.pbrTile.modePbrTile') }}</option>
          <option value="autotile_wang16">{{ t('gameNodes.pbrTile.modeAutotileWang16') }}</option>
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

      <template v-if="(node.params.gamePbrAssetMode ?? 'pbr_tile') === 'pbr_tile'">
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
      </template>

      <div v-if="node.params.gamePbrReport" class="report-chip">
        {{ node.params.gamePbrReport }}
      </div>
    </section>

    <!-- 1C. game.spriteProp: 通用精灵外描边+MIP链 & 模块化场景物件 Y-Sort -->
    <section v-else-if="node.typeId === 'game.spriteProp'" class="panel-card">
      <div class="section-title">{{ t('gameNodes.spriteProp.sectionTitle') }}</div>

      <label class="field">
        <span>{{ t('gameNodes.spriteProp.modeLabel') }}</span>
        <select
          :value="node.params.gamePbrAssetMode ?? 'sprite_stroke_mip'"
          @change="onStringParam('gamePbrAssetMode', $event)"
        >
          <option value="sprite_stroke_mip">
            {{ t('gameNodes.pbrTile.modeSpriteStrokeMip') }}
          </option>
          <option value="scene_prop">{{ t('gameNodes.pbrTile.modeSceneProp') }}</option>
        </select>
      </label>

      <template
        v-if="(node.params.gamePbrAssetMode ?? 'sprite_stroke_mip') === 'sprite_stroke_mip'"
      >
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

      <template v-else>
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

      <div v-if="node.params.gamePbrReport" class="report-chip">
        {{ node.params.gamePbrReport }}
      </div>
    </section>

    <!-- 1D. game.vfxAlpha: 专业 2D 特效工坊 (Flipbook / 去黑底 / 元素换色 / 通道打包) -->
    <section v-else-if="node.typeId === 'game.vfxAlpha'" class="panel-card">
      <div class="section-title">{{ t('gameNodes.vfxAlpha.sectionTitle') }}</div>

      <label class="field">
        <span>{{ t('gameNodes.vfxAlpha.modeLabel') }}</span>
        <select
          :value="node.params.gameVfxMode ?? 'vfx_flipbook'"
          @change="onStringParam('gameVfxMode', $event)"
        >
          <option value="vfx_flipbook">{{ t('gameNodes.vfxAlpha.modeFlipbook') }}</option>
          <option value="vfx_demult">{{ t('gameNodes.vfxAlpha.modeDemult') }}</option>
          <option value="vfx_trail_ribbon">{{ t('gameNodes.vfxAlpha.modeRibbon') }}</option>
          <option value="vfx_channel_pack">{{ t('gameNodes.vfxAlpha.modeChannelPack') }}</option>
        </select>
      </label>

      <label class="field">
        <span>{{ t('gameNodes.vfxAlpha.archetypeLabel') }}</span>
        <select
          :value="node.params.gameVfxArchetype ?? 'slash_arc'"
          @change="onStringParam('gameVfxArchetype', $event)"
        >
          <option value="slash_arc">{{ t('gameNodes.vfxAlpha.archSlash') }}</option>
          <option value="fire_explosion">{{ t('gameNodes.vfxAlpha.archExplosion') }}</option>
          <option value="arcane_vortex">{{ t('gameNodes.vfxAlpha.archVortex') }}</option>
          <option value="lightning_burst">{{ t('gameNodes.vfxAlpha.archLightning') }}</option>
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
          <option value="blood_crimson">{{ t('gameNodes.vfxAlpha.palBloodCrimson') }}</option>
        </select>
      </label>

      <label v-if="(node.params.gameVfxMode ?? 'vfx_flipbook') === 'vfx_flipbook'" class="field">
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

      <div v-if="node.params.gamePbrReport" class="report-chip">
        {{ node.params.gamePbrReport }}
      </div>
    </section>

    <!-- 2. game.audioDsp: 游戏音频工坊 -->
    <section v-else-if="node.typeId === 'game.audioDsp'" class="panel-card">
      <div class="section-title">{{ t('gameNodes.audioDsp.sectionTitle') }}</div>

      <label class="field">
        <span>{{ t('gameNodes.audioDsp.mode') }}</span>
        <select
          :value="node.params.gameAudioDspMode ?? 'loop_bgm'"
          @change="onStringParam('gameAudioDspMode', $event)"
        >
          <option value="loop_bgm">{{ t('gameNodes.audioDsp.modeLoopBgm') }}</option>
          <option value="bgm_intro_loop">{{ t('gameNodes.audioDsp.modeBgmIntroLoop') }}</option>
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
    </section>

    <!-- 3. game.levelMap: 程序化 2D 关卡地图生成 -->
    <section v-else-if="node.typeId === 'game.levelMap'" class="panel-card">
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

      <div v-if="node.params.gameLevelReport" class="report-chip">
        {{ node.params.gameLevelReport }}
      </div>
    </section>

    <!-- 4. game.economy: Machinations 游戏经济与数值平衡模拟 -->
    <section v-else-if="node.typeId === 'game.economy'" class="panel-card">
      <div class="section-title">{{ t('gameNodes.economy.sectionTitle') }}</div>

      <label class="field">
        <span>{{ t('gameNodes.economy.presetLabel') }}</span>
        <select
          :value="node.params.gameEconomyPreset ?? 'roguelike_run'"
          @change="onStringParam('gameEconomyPreset', $event)"
        >
          <option v-for="tpl in MX_TEMPLATES" :key="tpl.id" :value="tpl.id">
            {{ tpl.nameEn }}
          </option>
        </select>
      </label>

      <div class="grid-2">
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

      <div v-if="node.params.gameEconomyReport" class="report-chip">
        {{ node.params.gameEconomyReport }}
      </div>
    </section>

    <GraphNodeOutputPreview v-if="node && hostId" :node="node" :host-id="hostId" />
  </div>
  <div v-else class="node-inspector empty">
    {{ t('graph.inspector.node.empty') }}
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import {
  buildThemedArtboardSuitePayload,
  createMxFromTemplate,
  MX_TEMPLATES,
  type MxTemplateId,
  type UiStylePreset
} from '@shared/gameAssets'
import type { GraphNodeParams } from '@shared/graph'
import GraphNodeRunControl from './GraphNodeRunControl.vue'
import GraphNodeOutputPreview from './GraphNodeOutputPreview.vue'
import { useStudioI18n } from '../composables/useStudioI18n'
import { useNodeDisplayTitle } from '../composables/useNodeDisplayTitle'
import { useGraphNodeRun } from '../composables/useGraphNodeRun'
import { useEditorKernel } from '../editor/kernel'
import { useWorkspaceStore } from '../stores/workspace'
import { graphEditorHosts } from '../features/graph/model/graphEditorHosts'

const GAME_NODE_TYPES = new Set([
  'game.pbrTile',
  'game.spriteProp',
  'game.vfxAlpha',
  'game.audioDsp',
  'game.levelMap',
  'game.economy'
])

const { t, graphTypeLabel } = useStudioI18n()
const editor = useEditorKernel()
const workspace = useWorkspaceStore()

const node = computed(() => {
  void graphEditorHosts.revision.value
  const selection = editor.selection.current.value
  const id = selection.kind === 'graph.node' ? selection.id : null
  if (!id) return null
  const current = graphEditorHosts.getNode(selection.hostId, id)
  return current?.typeId && GAME_NODE_TYPES.has(current.typeId) ? current : null
})

const hostId = computed(() => {
  const selection = editor.selection.current.value
  return selection.kind === 'graph.node' ? (selection.hostId ?? '') : ''
})

const { runStatus, isGraphRunning, blocked, toggleRun } = useGraphNodeRun(node)

const typeLabel = computed(() => (node.value?.typeId ? graphTypeLabel(node.value.typeId) : ''))
const displayTitle = useNodeDisplayTitle(node, typeLabel)

const nodeBadge = computed(() => {
  switch (node.value?.typeId) {
    case 'game.pbrTile':
      return 'PBR + AutoTile'
    case 'game.spriteProp':
      return 'Stroke + Mips + Y-Sort'
    case 'game.vfxAlpha':
      return 'Linear Alpha Demult'
    case 'game.audioDsp':
      return (node.value.params.gameAudioDspMode ?? 'loop_bgm') === 'loop_bgm'
        ? 'Loop BGM'
        : '4× SFX'
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
  if (key === 'gameUiStylePreset') {
    const suiteTitle = (node.value?.title || 'CELESTIAL CHRONICLES').trim()
    const themed = buildThemedArtboardSuitePayload(val as UiStylePreset, suiteTitle)
    patchParams({
      gameUiStylePreset: val as UiStylePreset,
      gameUiArtboardJson: themed.jsonString,
      gameUiArtboardPreviewDataUrl: undefined
    })
    return
  }
  if (key === 'gamePbrAssetMode') {
    patchParams({
      [key]: val,
      gameUiArtboardPreviewDataUrl: undefined
    } as Partial<GraphNodeParams>)
    return
  }
  if (key === 'gameEconomyPreset') {
    const presetDiagram = createMxFromTemplate(val as MxTemplateId)
    patchParams({
      gameEconomyPreset: val as MxTemplateId,
      gameEconomyDiagramJson: JSON.stringify(presetDiagram),
      gameEconomySteps: presetDiagram.settings.steps,
      gameEconomySeed: presetDiagram.settings.seed
    })
    return
  }
  patchParams({ [key]: val } as Partial<GraphNodeParams>)
}

function randomizeLevelSeed(): void {
  patchParams({ gameLevelSeed: Math.floor(100 + Math.random() * 99000) })
}

function randomizeEconomySeed(): void {
  patchParams({ gameEconomySeed: Math.floor(100 + Math.random() * 99000) })
}

function openWorkbench(): void {
  const current = node.value
  const rootKey = workspace.activeDiveRootKey?.trim()
  if (!rootKey || !hostId.value || !current) return
  workspace.diveIntoView(
    rootKey,
    {
      viewId: 'game.workbench',
      hostId: hostId.value,
      nodeId: current.id
    },
    displayTitle.value
  )
}
</script>

<style scoped>
.node-inspector {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
  height: 100%;
  overflow: auto;
}

.node-inspector.empty {
  color: var(--text-muted);
  align-items: center;
  justify-content: center;
}

.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.head-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.workbench-btn {
  padding: 4px 9px;
  border-radius: 6px;
  border: 1px solid color-mix(in srgb, var(--accent) 42%, transparent);
  background: color-mix(in srgb, var(--accent) 16%, var(--panel));
  color: var(--text);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
}

.head h2 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}

.spec-badge {
  font-size: 11px;
  padding: 2px 7px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent) 14%, transparent);
  color: var(--accent);
  border: 1px solid color-mix(in srgb, var(--accent) 32%, transparent);
}

.hint {
  margin: 0;
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.45;
}

.panel-card {
  display: flex;
  flex-direction: column;
  gap: 9px;
  padding: 10px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--panel) 88%, transparent);
  border: 1px solid color-mix(in srgb, var(--border) 80%, transparent);
}

.section-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
}

.field input,
.field select {
  padding: 5px 8px;
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

.nine-slice-box {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 8px;
  border-radius: 7px;
  background: color-mix(in srgb, var(--bg) 45%, var(--panel));
  border: 1px dashed color-mix(in srgb, var(--accent) 34%, var(--border));
}

.nine-slice-box-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  font-size: 11px;
  font-weight: 600;
  color: var(--text);
}

.nine-slice-box-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.mini-btn {
  padding: 2px 6px;
  border-radius: 4px;
  border: 1px solid color-mix(in srgb, var(--accent) 35%, transparent);
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  color: var(--text);
  font-size: 10px;
  cursor: pointer;
}

.mini-btn:hover {
  background: color-mix(in srgb, var(--accent) 24%, transparent);
}

.seed-row {
  display: flex;
  align-items: flex-end;
  gap: 6px;
}

.seed-row .grow {
  flex: 1;
}

.dice-btn {
  padding: 5px 9px;
  border-radius: 6px;
  border: 1px solid color-mix(in srgb, var(--accent) 32%, transparent);
  background: color-mix(in srgb, var(--accent) 14%, transparent);
  color: var(--text);
  font-size: 12px;
  cursor: pointer;
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

.report-chip {
  font-size: 11px;
  padding: 6px 8px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--accent) 28%, transparent);
  color: var(--accent);
  word-break: break-all;
}

.play-btn {
  padding: 8px 12px;
  border-radius: 7px;
  border: 1px solid color-mix(in srgb, var(--accent) 45%, transparent);
  background: color-mix(in srgb, var(--accent) 18%, var(--panel));
  color: var(--text);
  font-weight: 600;
  font-size: 12px;
  cursor: pointer;
}

.play-btn:hover {
  background: color-mix(in srgb, var(--accent) 28%, var(--panel));
}

.playable-modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: color-mix(in srgb, var(--bg) 82%, transparent);
  backdrop-filter: blur(6px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.playable-modal-window {
  width: min(1080px, 94vw);
  height: min(740px, 88vh);
  background: var(--panel);
  border: 1px solid color-mix(in srgb, var(--border) 85%, transparent);
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.playable-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  background: color-mix(in srgb, var(--panel) 94%, transparent);
  border-bottom: 1px solid color-mix(in srgb, var(--border) 80%, transparent);
}

.playable-modal-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
}

.playable-close-btn {
  padding: 4px 10px;
  border-radius: 6px;
  border: 1px solid color-mix(in srgb, var(--border) 85%, transparent);
  background: color-mix(in srgb, var(--panel) 88%, transparent);
  color: var(--text);
  font-size: 12px;
  cursor: pointer;
}

.playable-iframe {
  flex: 1;
  width: 100%;
  border: 0;
  background: var(--bg);
}
</style>
