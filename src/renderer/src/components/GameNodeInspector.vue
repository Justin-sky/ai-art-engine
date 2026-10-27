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

    <!-- 1. game.pbrTile: 无缝瓦片与 PBR 四通道派生 -->
    <section v-if="node.typeId === 'game.pbrTile'" class="panel-card">
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

    <!-- 4. game.playable: 可玩游戏沙盒编译 -->
    <section v-else-if="node.typeId === 'game.playable'" class="panel-card">
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
          <option value="tower_defense">{{ t('gameNodes.playable.genreTowerDefense') }}</option>
          <option value="card_dbg">{{ t('gameNodes.playable.genreCardDbg') }}</option>
          <option value="avg_dialogue">{{ t('gameNodes.playable.genreAvgDialogue') }}</option>
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

      <button type="button" class="play-btn" @click="openPlayableSandbox">
        ▶ {{ t('gameNodes.playable.playNow') }}
      </button>

      <div v-if="node.params.gamePlayableReport" class="report-chip">
        {{ node.params.gamePlayableReport }}
      </div>
    </section>

    <GraphNodeOutputPreview v-if="node && hostId" :node="node" :host-id="hostId" />

    <!-- Fullscreen Playable Sandbox Modal -->
    <Teleport to="body">
      <div
        v-if="playableModalOpen"
        class="playable-modal-backdrop"
        @click.self="closePlayableModal"
      >
        <div class="playable-modal-window">
          <div class="playable-modal-header">
            <div class="playable-modal-title">
              🎮 {{ node?.params.gamePlayableTitle || 'Indie Game Prototype' }}
            </div>
            <button type="button" class="playable-close-btn" @click="closePlayableModal">
              ✕ {{ t('gameNodes.playable.closeModal') }}
            </button>
          </div>
          <iframe
            v-if="playableModalFrameSrc"
            class="playable-iframe"
            :src="playableModalFrameSrc"
            sandbox="allow-scripts"
          />
        </div>
      </div>
    </Teleport>
  </div>
  <div v-else class="node-inspector empty">
    {{ t('graph.inspector.node.empty') }}
  </div>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue'
import {
  compilePlayableGameSandboxHtml,
  generateProceduralLevelMap,
  type LevelGeneratorAlgorithm
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

const GAME_NODE_TYPES = new Set(['game.pbrTile', 'game.audioDsp', 'game.levelMap', 'game.playable'])

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
      return 'PBR + 9-Slice + Hull'
    case 'game.audioDsp':
      return (node.value.params.gameAudioDspMode ?? 'loop_bgm') === 'loop_bgm'
        ? 'Loop BGM'
        : '4× SFX'
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

const playableModalOpen = ref(false)
const playableModalFrameSrc = ref('')

function releaseModalFrameUrl(): void {
  const prev = playableModalFrameSrc.value
  playableModalFrameSrc.value = ''
  if (prev.startsWith('studio-gameplay://') && window.studio?.releaseGameplayDocument) {
    void window.studio.releaseGameplayDocument(prev)
  }
}

async function mountModalPlayableHtml(htmlBody: string): Promise<void> {
  releaseModalFrameUrl()
  if (window.studio?.openGameplayDocument) {
    try {
      const url = await window.studio.openGameplayDocument(htmlBody)
      if (url) {
        playableModalFrameSrc.value = url
        return
      }
    } catch {
      /* fallback */
    }
  }
  playableModalFrameSrc.value = `data:text/html;charset=utf-8,${encodeURIComponent(htmlBody)}`
}

async function openPlayableSandbox(): Promise<void> {
  if (!node.value) return
  const stored = node.value.params.gamePlayableHtml?.trim()
  if (stored && stored.includes('<html')) {
    await mountModalPlayableHtml(stored)
    playableModalOpen.value = true
    return
  }
  const alg = (node.value.params.gameLevelAlgorithm ?? 'bsp_dungeon') as LevelGeneratorAlgorithm
  const seed = Number(node.value.params.gameLevelSeed ?? 42)
  const genreRaw = node.value.params.gamePlayableGenre ?? 'roguelike_action'
  const cameraRaw = node.value.params.gamePlayableCameraMode ?? 'topdown_34'
  const mode =
    genreRaw === 'platformer' || cameraRaw === 'side_view'
      ? 'platformer'
      : genreRaw === 'tower_defense'
        ? 'tower_defense'
        : genreRaw === 'card_dbg'
          ? 'card_dbg'
          : genreRaw === 'avg_dialogue'
            ? 'avg_dialogue'
            : 'survivor'
  const levelMap = generateProceduralLevelMap({
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
  const compiled = compilePlayableGameSandboxHtml({
    title: node.value.params.gamePlayableTitle || 'Indie Game Prototype',
    mode,
    levelSeed: seed,
    levelMap
  })
  patchParams({ gamePlayableHtml: compiled.html })
  await mountModalPlayableHtml(compiled.html)
  playableModalOpen.value = true
}

function closePlayableModal(): void {
  playableModalOpen.value = false
  releaseModalFrameUrl()
}

onUnmounted(() => {
  releaseModalFrameUrl()
})
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
