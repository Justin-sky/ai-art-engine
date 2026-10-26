<template>
  <div class="dive-view anim2d-dive">
    <!-- 顶部全屏工作台工具栏 -->
    <header class="toolbar">
      <div class="toolbar-group">
        <span class="tb-title">🎞️ {{ displayTitle }}</span>
        <div class="preset-pills">
          <button
            v-for="p in GRID_PRESETS"
            :key="`${p.rows}x${p.cols}`"
            type="button"
            class="tb-pill"
            :class="{ active: state.rows === p.rows && state.cols === p.cols }"
            @click="applyGridPreset(p.rows, p.cols)"
          >
            {{ p.rows }}×{{ p.cols }}
          </button>
        </div>
        <div class="dim-inline">
          <label>
            <span>{{ t('graph.anim2d.rows') }}</span>
            <input
              v-model="rowsDraft"
              type="number"
              min="1"
              step="1"
              @focus="rowsFocused = true"
              @input="onRowsInput"
              @change="commitRows"
              @blur="onRowsBlur"
              @keydown.enter.prevent="($event.target as HTMLInputElement).blur()"
            />
          </label>
          <span class="mul">×</span>
          <label>
            <span>{{ t('graph.anim2d.cols') }}</span>
            <input
              v-model="colsDraft"
              type="number"
              min="1"
              step="1"
              @focus="colsFocused = true"
              @input="onColsInput"
              @change="commitCols"
              @blur="onColsBlur"
              @keydown.enter.prevent="($event.target as HTMLInputElement).blur()"
            />
          </label>
        </div>
      </div>

      <span class="tb-divider" />

      <div class="toolbar-group">
        <button
          v-if="upstreamVideoUrl"
          type="button"
          class="tb-btn tb-btn--accent"
          :disabled="videoExtractBusy"
          @click="extractVideoToAnim2dNow"
        >
          {{
            videoExtractBusy
              ? t('graph.anim2d.videoExtractBusy')
              : t('graph.anim2d.videoExtractNow')
          }}
        </button>
        <button
          type="button"
          class="tb-btn"
          :class="{ 'tb-btn--active': onionSkin }"
          @click="onionSkin = !onionSkin"
        >
          🧅 {{ t('graph.anim2d.onionSkin') }}
        </button>
        <button
          type="button"
          class="tb-btn"
          :class="{ 'tb-btn--active': showGuide }"
          @click="showGuide = !showGuide"
        >
          🎯 {{ pickBi('基准线', 'Guides') }}
        </button>
        <button
          type="button"
          class="tb-btn"
          :class="{ 'tb-btn--active': pixelated }"
          @click="pixelated = !pixelated"
        >
          👾 {{ pickBi('像素锐利', 'Pixelated') }}
        </button>
        <button
          type="button"
          class="tb-btn"
          :class="{ 'tb-btn--active': normalViewMode !== 'off' }"
          :title="pickBi('切换 2D 法线贴图与动态点光源测试', 'Cycle 2D Normal Map & Dynamic Light')"
          @click="cycleNormalViewMode"
        >
          💡
          {{
            normalViewMode === 'light'
              ? pickBi('动态受光', '2D Light')
              : normalViewMode === 'normal'
                ? pickBi('法线贴图', 'Normal Map')
                : pickBi('法线光影', '2D Normal')
          }}
        </button>
        <div class="zoom-pills">
          <button
            v-for="z in [1, 2, 3] as const"
            :key="z"
            type="button"
            class="tb-pill"
            :class="{ active: stageZoom === z }"
            @click="stageZoom = z"
          >
            {{ z }}x
          </button>
        </div>
        <div class="backdrop-pills">
          <button
            type="button"
            class="tb-pill"
            :class="{ active: backdrop === 'checker' }"
            @click="backdrop = 'checker'"
          >
            🏁
          </button>
          <button
            type="button"
            class="tb-pill"
            :class="{ active: backdrop === 'dark' }"
            @click="backdrop = 'dark'"
          >
            🌑
          </button>
          <button
            type="button"
            class="tb-pill"
            :class="{ active: backdrop === 'light' }"
            @click="backdrop = 'light'"
          >
            🌕
          </button>
        </div>
      </div>

      <span class="spacer" />

      <div class="toolbar-group">
        <button
          type="button"
          class="tb-btn"
          :disabled="gifBusy || activeCells.length < 2"
          @click="exportGif"
        >
          📤 {{ gifBusy ? t('graph.anim2d.exportGifBusy') : t('graph.anim2d.exportGif') }}
        </button>
        <button
          type="button"
          class="tb-btn"
          :disabled="sheetBusy || activeCells.length < 1"
          @click="exportSheet"
        >
          🖼️ {{ sheetBusy ? t('graph.anim2d.exportSheetBusy') : t('graph.anim2d.exportSheet') }}
        </button>
        <button type="button" class="tb-btn done" @click="onClose">
          ✓ {{ pickBi('完成', 'Done') }}
        </button>
      </div>
    </header>

    <div class="body">
      <!-- 左侧：源序列图交互切格 + 上游视频抽帧 + 抠图/防抖参数 -->
      <aside class="left-sidebar">
        <!-- 源序列图交互式网格叠层 -->
        <section class="panel-card">
          <div class="panel-head">
            <span class="panel-title">{{
              pickBi('源序列图切格预览', 'Source Sprite Sheet Grid')
            }}</span>
            <span class="panel-badge"
              >{{ state.rows }}×{{ state.cols }} ({{ state.rows * state.cols }}
              {{ pickBi('格', 'cells') }})</span
            >
          </div>
          <div v-if="sourceSheetUrl" class="sheet-overlay-wrap" :class="`bg-${backdrop}`">
            <div class="sheet-stage">
              <img :src="sourceSheetUrl" alt="" class="sheet-img" draggable="false" />
              <div
                class="sheet-grid-overlay"
                :style="{
                  gridTemplateRows: `repeat(${state.rows}, 1fr)`,
                  gridTemplateColumns: `repeat(${state.cols}, 1fr)`
                }"
              >
                <div
                  v-for="(cellKey, idx) in allCellKeys"
                  :key="cellKey"
                  class="sheet-grid-cell"
                  :class="{
                    active: currentActiveCell?.key === cellKey && !isCellDisabled(cellKey),
                    disabled: isCellDisabled(cellKey)
                  }"
                  @click="seekToCellKey(cellKey)"
                >
                  <span class="cell-num">#{{ idx + 1 }}</span>
                  <button
                    type="button"
                    class="cell-mute-btn"
                    :title="t('graph.anim2d.toggleFrameHint')"
                    @click.stop="toggleCellDisabled(cellKey)"
                  >
                    {{ isCellDisabled(cellKey) ? '🚫' : '✓' }}
                  </button>
                </div>
              </div>
            </div>
          </div>
          <div v-else class="empty-box">
            {{ t('graph.anim2d.emptyPreview') }}
          </div>
        </section>

        <!-- 上游视频区间截取与直抽面板 -->
        <section v-if="upstreamVideoUrl" class="panel-card">
          <div class="panel-head">
            <span class="panel-title">🎬 {{ t('graph.anim2d.genModeVideoSheet') }}</span>
            <span class="panel-badge">
              {{ Math.round(videoRange.startRatio * 100) }}% –
              {{ Math.round(videoRange.endRatio * 100) }}%
            </span>
          </div>
          <video :src="upstreamVideoUrl" class="video-preview" controls muted loop playsinline />
          <div class="range-row">
            <span>{{ t('graph.anim2d.videoStartRatio') }}</span>
            <input
              type="range"
              min="0"
              max="0.95"
              step="0.01"
              :value="videoRange.startRatio"
              @input="onVideoRangeChange('start', $event)"
            />
          </div>
          <div class="range-row">
            <span>{{ t('graph.anim2d.videoEndRatio') }}</span>
            <input
              type="range"
              min="0.05"
              max="1"
              step="0.01"
              :value="videoRange.endRatio"
              @input="onVideoRangeChange('end', $event)"
            />
          </div>
          <button
            type="button"
            class="extract-btn"
            :disabled="videoExtractBusy"
            @click="extractVideoToAnim2dNow"
          >
            {{
              videoExtractBusy
                ? t('graph.anim2d.videoExtractBusy')
                : t('graph.anim2d.videoExtractNow')
            }}
          </button>
        </section>

        <!-- 抠图 / 内缩 / 原地防抖对齐 / GIF 输出参数 -->
        <section class="panel-card">
          <div class="panel-head">
            <span class="panel-title">{{
              pickBi('切帧清理与防抖对齐', 'Cleanup & Stabilization')
            }}</span>
          </div>

          <label class="field">
            <span class="field-label">{{ t('graph.anim2d.bgKey') }}</span>
            <select class="select" :value="keyColor" @change="onKeyColorChange">
              <option value="">{{ t('graph.anim2d.bgKeyNone') }}</option>
              <option value="auto">{{ t('graph.anim2d.bgKeyAuto') }}</option>
              <option value="black">{{ t('graph.anim2d.bgKeyBlack') }}</option>
              <option value="white">{{ t('graph.anim2d.bgKeyWhite') }}</option>
            </select>
          </label>

          <label v-if="keyColor" class="field">
            <div class="field-row">
              <span class="field-label">{{ t('graph.anim2d.keyThreshold') }}</span>
              <span class="field-val">{{ keyThreshold }}</span>
            </div>
            <input
              type="range"
              min="10"
              max="150"
              step="2"
              :value="keyThreshold"
              @input="onKeyThresholdChange"
            />
          </label>

          <div class="two-col">
            <label class="field">
              <span class="field-label">{{ t('graph.anim2d.edgeInset') }}</span>
              <select class="select" :value="String(edgeInset)" @change="onEdgeInsetChange">
                <option value="auto">{{ t('graph.anim2d.edgeInsetAuto') }}</option>
                <option value="0">0 px</option>
                <option value="1">1 px</option>
                <option value="2">2 px</option>
                <option value="4">4 px</option>
                <option value="8">8 px</option>
              </select>
            </label>

            <label class="field">
              <span class="field-label">{{ t('graph.anim2d.stabilize') }}</span>
              <select class="select" :value="stabilize" @change="onStabilizeChange">
                <option value="off">{{ t('graph.anim2d.stabilizeOff') }}</option>
                <option value="ground">{{ t('graph.anim2d.stabilizeGround') }}</option>
                <option value="center">{{ t('graph.anim2d.stabilizeCenter') }}</option>
              </select>
            </label>
          </div>

          <div class="two-col">
            <label class="field">
              <span class="field-label">{{ pickBi('精灵外描边', 'Sprite Outline') }}</span>
              <select class="select" :value="outlineColor" @change="onOutlineColorChange">
                <option value="">{{ pickBi('无描边', 'None') }}</option>
                <option value="black">{{ pickBi('⬛ 1px 黑边', '1px Black') }}</option>
                <option value="white">{{ pickBi('⬜ 1px 白边', '1px White') }}</option>
                <option value="gold">{{ pickBi('🟨 1px 金光', '1px Gold') }}</option>
                <option value="cyan">{{ pickBi('🟦 1px 电光蓝', '1px Cyan') }}</option>
              </select>
            </label>

            <label class="field">
              <span class="field-label">{{ pickBi('真像素规整', 'Pixel Snap') }}</span>
              <select class="select" :value="String(pixelSnap)" @change="onPixelSnapChange">
                <option value="0">{{ pickBi('关闭（原画）', 'Off') }}</option>
                <option value="2">2px {{ pickBi('精细像素', 'Fine Pixel') }}</option>
                <option value="3">3px {{ pickBi('16-bit 像素', '16-bit Pixel') }}</option>
                <option value="4">4px {{ pickBi('8-bit 复古', '8-bit Retro') }}</option>
                <option value="6">6px {{ pickBi('粗颗粒像素', 'Chunky Pixel') }}</option>
              </select>
            </label>
          </div>

          <div class="two-col">
            <label class="field">
              <span class="field-label">{{ pickBi('调色板锁死', 'Palette Lock') }}</span>
              <select class="select" :value="String(paletteLock)" @change="onPaletteLockChange">
                <option value="0">{{ pickBi('关闭（自由色彩）', 'Off') }}</option>
                <option value="128">{{ pickBi('🔒 跨帧防闪 (128色)', 'Cross-Frame Lock') }}</option>
                <option value="64">{{ pickBi('🎨 64色 精良像素', '64-Color Pixel') }}</option>
                <option value="32">{{ pickBi('🕹️ 32色 16-bit', '32-Color 16-bit') }}</option>
                <option value="16">{{ pickBi('👾 16色 8-bit复古', '16-Color Retro') }}</option>
              </select>
            </label>

            <label class="field">
              <span class="field-label">{{ pickBi('动作残影拖尾', 'Motion Trail') }}</span>
              <select class="select" :value="motionTrail" @change="onMotionTrailChange">
                <option value="">{{ pickBi('无残影', 'None') }}</option>
                <option value="cyan">{{ pickBi('🟦 霓虹青 (恶魔城)', 'Cyan Phantom') }}</option>
                <option value="gold">{{ pickBi('🟨 疾风金闪', 'Gold Afterimage') }}</option>
                <option value="purple">{{ pickBi('🟪 暗影紫魅', 'Purple Shadow') }}</option>
                <option value="crimson">{{ pickBi('🟥 狂暴绯红', 'Crimson Slash') }}</option>
                <option value="echo">{{ pickBi('👻 原色残像', 'Original Echo') }}</option>
              </select>
            </label>
          </div>

          <label class="inline-ctrl">
            <input type="checkbox" :checked="groundShadow" @change="onGroundShadowChange" />
            <span>{{ pickBi('绘制脚底接触椭圆阴影', 'Draw Ground Contact Shadow') }}</span>
          </label>

          <label class="inline-ctrl">
            <input type="checkbox" :checked="loopBlend" @change="onLoopBlendChange" />
            <span>{{
              pickBi('首尾循环无缝平滑闭合（消除尾帧跳变）', 'Seamless Loop Closure Blend')
            }}</span>
          </label>

          <label class="field">
            <span class="field-label">{{ t('graph.anim2d.runGifFps') }}</span>
            <select class="select" :value="gifFps" @change="onGifFpsChange">
              <option :value="0">{{ t('graph.anim2d.runGifOff') }}</option>
              <option v-for="option in FPS_OPTIONS" :key="option" :value="option">
                {{ option }} fps
              </option>
            </select>
          </label>

          <p v-if="gifStatus" class="status-ok">{{ gifStatus }}</p>
          <p v-if="gifError" class="status-err">{{ gifError }}</p>
        </section>

        <!-- 单帧像素微调、打击感律动预设与坏帧插值修复 -->
        <section v-if="currentActiveCell" class="panel-card">
          <div class="panel-head">
            <span class="panel-title">{{
              pickBi('单帧微调 · 打击感顿帧与修复', 'Frame Nudge, Hit-Stop & Repair')
            }}</span>
            <span class="panel-badge">
              #{{ activeIndex + 1 }} ({{ currentActiveCell.key }}) ·
              {{ getCellHold(currentActiveCell.key) }}x
            </span>
          </div>

          <div class="field">
            <span class="field-label">{{
              pickBi('动作打击感节奏预设（逐帧停留倍率）', 'Action Rhythm & Hit-Stop Presets')
            }}</span>
            <div class="rhythm-pills">
              <button type="button" class="tb-pill" @click="applyRhythmPreset('uniform')">
                {{ pickBi('1x 均匀', '1x Uniform') }}
              </button>
              <button type="button" class="tb-pill" @click="applyRhythmPreset('attack-hitstop')">
                ⚔️ {{ pickBi('挥砍顿帧', 'Attack Hit-Stop') }}
              </button>
              <button type="button" class="tb-pill" @click="applyRhythmPreset('jump-arc')">
                🦘 {{ pickBi('跳跃滞空', 'Jump Apex') }}
              </button>
              <button type="button" class="tb-pill" @click="applyRhythmPreset('charge-burst')">
                💥 {{ pickBi('蓄力爆发', 'Charge Burst') }}
              </button>
            </div>
          </div>

          <div class="field">
            <div class="field-row">
              <span class="field-label">{{
                pickBi('当前帧像素微调 (Shift 步进 4px)', 'Current Frame Pixel Nudge')
              }}</span>
              <span class="field-val">
                dx={{ currentCellOffset.dx }}, dy={{ currentCellOffset.dy
                }}{{ currentCellOffset.flipX ? ' · ⇄' : '' }}
              </span>
            </div>
            <div class="nudge-row">
              <button type="button" class="ctrl-btn" @click="nudgeCurrentCell(-1, 0, $event)">
                ←
              </button>
              <button type="button" class="ctrl-btn" @click="nudgeCurrentCell(0, -1, $event)">
                ↑
              </button>
              <button type="button" class="ctrl-btn" @click="nudgeCurrentCell(0, 1, $event)">
                ↓
              </button>
              <button type="button" class="ctrl-btn" @click="nudgeCurrentCell(1, 0, $event)">
                →
              </button>
              <button
                type="button"
                class="ctrl-btn"
                :class="{ primary: currentCellOffset.flipX }"
                @click="toggleCurrentCellFlipX"
              >
                ⇄ {{ pickBi('翻转', 'Flip') }}
              </button>
              <button type="button" class="ctrl-btn" @click="resetCurrentCellOffset">↺</button>
            </div>
          </div>

          <button
            v-if="activeCells.length >= 3"
            type="button"
            class="extract-btn"
            :disabled="cellRepairBusy"
            @click="repairCurrentCellWithNeighbors"
          >
            {{
              cellRepairBusy
                ? pickBi('插值修补中…', 'Repairing cell…')
                : pickBi('✨ 用前后帧插值修补此坏帧', '✨ Repair Bad Frame from Prev/Next')
            }}
          </button>
        </section>
      </aside>

      <!-- 右侧主工作区：大画布动画舞台 + 底部时间轴胶片条 -->
      <main class="stage-main">
        <div
          class="stage-viewport"
          :class="`bg-${backdrop}`"
          @mousemove="onStageMouseMove"
          @click="togglePlay"
        >
          <div v-if="gridLoading" class="stage-empty">
            {{ t('graph.anim2d.loading') }}
          </div>
          <div v-else-if="activeCells.length === 0" class="stage-empty">
            {{ t('graph.anim2d.emptyPreview') }}
          </div>
          <div v-else class="stage-canvas-box" :style="{ transform: `scale(${stageZoom})` }">
            <!-- Aseprite 双色洋葱皮：上一帧（红影）与下一帧（青绿影） -->
            <img
              v-if="onionSkin && prevActiveCell && prevActiveCell.key !== currentActiveCell?.key"
              :src="prevActiveCell.dataUrl"
              alt=""
              class="stage-frame onion-prev"
              :class="{ pixelated }"
              draggable="false"
            />
            <img
              v-if="
                onionSkin &&
                nextActiveCell &&
                nextActiveCell.key !== currentActiveCell?.key &&
                nextActiveCell.key !== prevActiveCell?.key
              "
              :src="nextActiveCell.dataUrl"
              alt=""
              class="stage-frame onion-next"
              :class="{ pixelated }"
              draggable="false"
            />
            <!-- 当前帧（或 2D 法线贴图 / 动态点光源受光渲染图） -->
            <img
              v-if="currentActiveCell"
              :src="
                normalViewMode !== 'off' && normalPreviewDataUrl
                  ? normalPreviewDataUrl
                  : currentActiveCell.dataUrl
              "
              alt=""
              class="stage-frame"
              :class="{ pixelated }"
              draggable="false"
            />
            <!-- 十字基准线、脚底接地线与 Hurtbox(受击绿框)/Hitbox(攻击红框) -->
            <template v-if="showGuide">
              <div class="guide-v" />
              <div class="guide-h-center" />
              <div class="guide-h-ground" />
              <div
                v-if="currentCombatBoxes"
                class="combat-box hurtbox-overlay"
                :style="{
                  left: `${currentCombatBoxes.hurtboxPct.left}%`,
                  top: `${currentCombatBoxes.hurtboxPct.top}%`,
                  width: `${currentCombatBoxes.hurtboxPct.width}%`,
                  height: `${currentCombatBoxes.hurtboxPct.height}%`
                }"
              >
                <span class="combat-tag">HURTBOX</span>
              </div>
              <div
                v-if="currentCombatBoxes?.hitboxPct"
                class="combat-box hitbox-overlay"
                :style="{
                  left: `${currentCombatBoxes.hitboxPct.left}%`,
                  top: `${currentCombatBoxes.hitboxPct.top}%`,
                  width: `${currentCombatBoxes.hitboxPct.width}%`,
                  height: `${currentCombatBoxes.hitboxPct.height}%`
                }"
              >
                <span class="combat-tag">HITBOX</span>
              </div>
            </template>
          </div>

          <!-- 左上角帧信息 HUD -->
          <div v-if="activeCells.length > 0" class="stage-hud">
            <span class="hud-pill"> #{{ activeIndex + 1 }} / {{ activeCells.length }} </span>
            <span v-if="currentActiveCell" class="hud-pill subtle">
              Cell {{ currentActiveCell.key }}
            </span>
            <span v-if="stabilize !== 'off'" class="hud-pill accent">
              {{
                stabilize === 'ground'
                  ? t('graph.anim2d.stabilizeGround')
                  : t('graph.anim2d.stabilizeCenter')
              }}
            </span>
          </div>
        </div>

        <!-- 播放传输控制栏 -->
        <div class="transport-bar">
          <div class="transport-left">
            <button
              type="button"
              class="ctrl-btn"
              :disabled="activeCells.length <= 1"
              @click="stepFrame(-1)"
            >
              ⏮
            </button>
            <button
              type="button"
              class="ctrl-btn primary"
              :disabled="activeCells.length <= 1"
              @click="togglePlay"
            >
              {{ playing ? `⏸ ${t('graph.anim2d.pause')}` : `▶ ${t('graph.anim2d.play')}` }}
            </button>
            <button
              type="button"
              class="ctrl-btn"
              :disabled="activeCells.length <= 1"
              @click="stepFrame(1)"
            >
              ⏭
            </button>
          </div>

          <div class="transport-center">
            <label class="inline-ctrl">
              <span>{{ t('graph.anim2d.playMode') }}</span>
              <select class="select compact" :value="playMode" @change="onPlayModeChange">
                <option value="loop">{{ t('graph.anim2d.playModeLoop') }}</option>
                <option value="pingpong">{{ t('graph.anim2d.playModePingpong') }}</option>
              </select>
            </label>
            <label class="inline-ctrl">
              <span>{{ t('graph.anim2d.fps') }}</span>
              <select class="select compact" :value="fps" @change="onFpsChange">
                <option v-for="option in FPS_OPTIONS" :key="option" :value="option">
                  {{ option }} fps
                </option>
              </select>
            </label>
            <label class="inline-ctrl">
              <input type="checkbox" :checked="loop" @change="onLoopChange" />
              <span>{{ t('graph.anim2d.loop') }}</span>
            </label>
          </div>

          <div class="transport-right">
            <span class="muted-count">
              {{ pickBi('有效帧', 'Active') }} {{ activeCells.length }} / {{ cells.length }}
            </span>
          </div>
        </div>

        <!-- 底部逐帧胶片时间轴 -->
        <div class="filmstrip">
          <div
            v-for="(cell, idx) in cells"
            :key="cell.key"
            class="film-cell"
            :class="{
              active: currentActiveCell?.key === cell.key && !isCellDisabled(cell.key),
              disabled: isCellDisabled(cell.key)
            }"
            @click="seekToCellKey(cell.key)"
          >
            <div class="film-thumb" :class="`bg-${backdrop}`">
              <img :src="cell.dataUrl" alt="" :class="{ pixelated }" draggable="false" />
            </div>
            <div class="film-foot">
              <span class="film-idx">#{{ idx + 1 }}</span>
              <button
                type="button"
                class="film-hold-pill"
                :class="{ custom: Math.abs(getCellHold(cell.key) - 1) >= 0.01 }"
                :title="pickBi('点击切换顿帧倍率', 'Cycle frame hold')"
                @click.stop="cycleCellHold(cell.key)"
              >
                {{ getCellHold(cell.key) }}x
              </button>
              <button
                type="button"
                class="film-toggle"
                :title="t('graph.anim2d.toggleFrameHint')"
                @click.stop="toggleCellDisabled(cell.key)"
              >
                {{ isCellDisabled(cell.key) ? '🚫' : '✓' }}
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>

    <SaveAssetDialog
      ref="gifSaveRef"
      :open="gifSaveOpen"
      :default-name="gifSaveDefaultName"
      :title="
        saveMode === 'sheet' ? t('graph.anim2d.exportSheetTitle') : t('graph.anim2d.exportGifTitle')
      "
      :subtitle="
        saveMode === 'sheet'
          ? t('graph.anim2d.exportSheetSubtitle')
          : t('graph.anim2d.exportGifSubtitle')
      "
      :z-index="2600"
      @confirm="onSaveConfirm"
      @cancel="closeGifSave"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, inject, onBeforeUnmount, ref, watch } from 'vue'
import {
  anim2dCellKeys,
  animGifFpsToNodePatch,
  buildAnimRhythmPresetHolds,
  gridCellPixelRect,
  normalizeAnimOutlineColor,
  normalizeAnimPaletteLock,
  normalizeAnimMotionTrail,
  normalizeAnimPixelSnap,
  normalizeAnimVideoRange,
  parseCellKey,
  readAnim2dFromNode,
  readAnimCellHoldsFromNode,
  readAnimCellOffsetsFromNode,
  readAnimDisabledCellsFromNode,
  readAnimEdgeInsetFromNode,
  readAnimGifFpsFromNode,
  readAnimGroundShadowFromNode,
  readAnimKeyColorFromNode,
  readAnimKeyThresholdFromNode,
  readAnimLoopBlendFromNode,
  readAnimMotionTrailFromNode,
  readAnimOutlineFromNode,
  readAnimPaletteLockFromNode,
  readAnimPixelSnapFromNode,
  readAnimPlayModeFromNode,
  readAnimStabilizeFromNode,
  readAnimVideoRangeFromNode,
  type AnimCellOffset,
  type AnimKeyColor,
  type AnimMotionTrail,
  type AnimOutlineColor,
  type AnimPaletteLock,
  type AnimPlayMode,
  type AnimRhythmPresetId,
  type AnimStabilizeMode
} from '@shared/graph'
import {
  buildEngineSpriteSheetJson,
  buildSpriteManifest,
  detectSpriteCombatBoxes,
  generateSpriteNormalMap,
  type SpriteCombatBoxes
} from '@shared/gameAssets'
import { resolveCacheOutputRoot } from '@shared/domain'
import SaveAssetDialog from '../SaveAssetDialog.vue'
import { useStudioI18n } from '../../composables/useStudioI18n'
import { useNodeDisplayTitle } from '../../composables/useNodeDisplayTitle'
import { useProjectStore } from '../../stores/project'
import { editorDiveKey } from '../../features/graph/model/editorDive'
import { graphEditorHosts } from '../../features/graph/model/graphEditorHosts'
import { graphRunHosts } from '../../features/graph/model/graphRunHosts'
import { resolveNodeUpstreamImageUrl } from '../../features/graph/model/resolveNodeUpstreamImageUrl'
import { resolveNodeUpstreamVideoUrl } from '../../features/graph/model/resolveNodeUpstreamVideoUrl'
import { composeVideoFrameSheet } from '../../features/graph/model/composeVideoFrameSheet'
import { composeImageGridCell } from '../../features/graph/model/composeImageGridCell'
import { composeAnim2dGif, type Anim2dGifResult } from '../../features/graph/model/composeAnim2dGif'
import {
  composeStage2dFrameSheet,
  type Stage2dFrameSheet
} from '../../features/graph/model/composeStage2dFrameSheet'

const props = defineProps<{
  frameKey?: string
  hostId: string
  nodeId: string
}>()

const GRID_PRESETS = [
  { rows: 1, cols: 4 },
  { rows: 1, cols: 6 },
  { rows: 1, cols: 8 },
  { rows: 2, cols: 2 },
  { rows: 2, cols: 3 },
  { rows: 2, cols: 4 },
  { rows: 3, cols: 3 },
  { rows: 4, cols: 4 }
] as const

const FPS_OPTIONS = [2, 4, 6, 8, 12, 16, 24]
const FPS_STORAGE_KEY = 'ai-art-engine.anim2d.fps'
const FPS_DEFAULT = 8

const { t, locale, graphTypeLabel } = useStudioI18n()
const project = useProjectStore()
const diveCtx = inject(editorDiveKey, null)

function pickBi(zh: string, en: string): string {
  return locale.value === 'en-US' ? en : zh
}

const node = computed(() => {
  void graphEditorHosts.revision.value
  if (!props.hostId || !props.nodeId) return null
  const current = graphEditorHosts.getNode(props.hostId, props.nodeId)
  return current?.typeId === 'anim.2d' ? current : null
})

const typeLabel = computed(() => graphTypeLabel('anim.2d'))
const displayTitle = useNodeDisplayTitle(node, typeLabel)

const state = computed(() =>
  node.value ? readAnim2dFromNode(node.value.params) : { rows: 1, cols: 4 }
)
const allCellKeys = computed(() => anim2dCellKeys(state.value.rows, state.value.cols))
const videoRange = computed(() =>
  node.value ? readAnimVideoRangeFromNode(node.value.params) : { startRatio: 0, endRatio: 1 }
)
const keyColor = computed(() => (node.value ? readAnimKeyColorFromNode(node.value.params) : ''))
const keyThreshold = computed(() =>
  node.value ? readAnimKeyThresholdFromNode(node.value.params) : 60
)
const edgeInset = computed(() =>
  node.value ? readAnimEdgeInsetFromNode(node.value.params) : 'auto'
)
const stabilize = computed(() =>
  node.value ? readAnimStabilizeFromNode(node.value.params) : 'off'
)
const playMode = computed(() => (node.value ? readAnimPlayModeFromNode(node.value.params) : 'loop'))
const disabledCells = computed(() =>
  node.value ? readAnimDisabledCellsFromNode(node.value.params) : []
)
const cellHolds = computed(() => (node.value ? readAnimCellHoldsFromNode(node.value.params) : {}))
const cellOffsets = computed(() =>
  node.value ? readAnimCellOffsetsFromNode(node.value.params) : {}
)
const outlineColor = computed<AnimOutlineColor>(() =>
  node.value ? readAnimOutlineFromNode(node.value.params) : ''
)
const pixelSnap = computed(() => (node.value ? readAnimPixelSnapFromNode(node.value.params) : 0))
const groundShadow = computed(() =>
  node.value ? readAnimGroundShadowFromNode(node.value.params) : false
)
const paletteLock = computed<AnimPaletteLock>(() =>
  node.value ? readAnimPaletteLockFromNode(node.value.params) : 0
)
const motionTrail = computed<AnimMotionTrail>(() =>
  node.value ? readAnimMotionTrailFromNode(node.value.params) : ''
)
const loopBlend = computed(() =>
  node.value ? readAnimLoopBlendFromNode(node.value.params) : false
)
const gifFps = computed(() => (node.value ? readAnimGifFpsFromNode(node.value.params) : 0))

const backdrop = ref<'checker' | 'dark' | 'light'>('checker')
const onionSkin = ref(false)
const showGuide = ref(true)
const pixelated = ref(false)
const stageZoom = ref<1 | 2 | 3>(1)
const normalViewMode = ref<'off' | 'light' | 'normal'>('off')
const lightNormPos = ref({ x: 0.72, y: 0.25 })
const normalPreviewDataUrl = ref('')

function cycleNormalViewMode(): void {
  if (normalViewMode.value === 'off') normalViewMode.value = 'light'
  else if (normalViewMode.value === 'light') normalViewMode.value = 'normal'
  else normalViewMode.value = 'off'
}

function onStageMouseMove(e: MouseEvent): void {
  if (normalViewMode.value !== 'light') return
  const el = e.currentTarget as HTMLElement | null
  if (!el) return
  const rect = el.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return
  lightNormPos.value = {
    x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
    y: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height))
  }
}

const sourceSheetUrl = ref('')
const upstreamVideoUrl = ref('')
const upstreamVideoRel = ref('')
const videoExtractBusy = ref(false)

watch(
  () => [props.hostId, props.nodeId, graphEditorHosts.revision.value] as const,
  async ([hId, nId]) => {
    if (!hId || !nId) {
      upstreamVideoUrl.value = ''
      upstreamVideoRel.value = ''
      return
    }
    const document = graphEditorHosts.getDocument(hId)
    const runStates = graphRunHosts.get(hId)?.runStates
    const { url, relativePath } = await resolveNodeUpstreamVideoUrl({
      document,
      nodeId: nId,
      runStates,
      assets: project.assets
    })
    upstreamVideoUrl.value = url
    upstreamVideoRel.value = relativePath
  },
  { immediate: true }
)

function clampDim(n: number): number {
  return Math.max(1, Math.floor(n) || 1)
}

function patchParams(patch: Record<string, unknown>): void {
  if (!node.value || !props.hostId) return
  graphEditorHosts.updateNode(props.hostId, node.value.id, patch)
}

const rowsDraft = ref(String(state.value.rows))
const colsDraft = ref(String(state.value.cols))
const rowsFocused = ref(false)
const colsFocused = ref(false)

watch(
  () => state.value.rows,
  (r) => {
    if (!rowsFocused.value) {
      rowsDraft.value = String(r)
    }
  },
  { immediate: true }
)

watch(
  () => state.value.cols,
  (c) => {
    if (!colsFocused.value) {
      colsDraft.value = String(c)
    }
  },
  { immediate: true }
)

function applyGridPreset(rows: number, cols: number): void {
  const nextRows = clampDim(rows)
  const nextCols = clampDim(cols)
  rowsDraft.value = String(nextRows)
  colsDraft.value = String(nextCols)
  patchParams({ animRows: nextRows, animCols: nextCols, animDisabledCells: [] })
}

function onRowsInput(e: Event): void {
  const raw = (e.target as HTMLInputElement).value
  rowsDraft.value = raw
  const trimmed = raw.trim()
  if (!trimmed) return
  const n = Number(trimmed)
  if (!Number.isFinite(n) || n < 1) return
  patchParams({ animRows: clampDim(n) })
}

function commitRows(): void {
  const n = Number(rowsDraft.value.trim())
  const next = Number.isFinite(n) && n >= 1 ? clampDim(n) : state.value.rows
  patchParams({ animRows: next })
  rowsDraft.value = String(next)
}

function onRowsBlur(): void {
  rowsFocused.value = false
  commitRows()
}

function onColsInput(e: Event): void {
  const raw = (e.target as HTMLInputElement).value
  colsDraft.value = raw
  const trimmed = raw.trim()
  if (!trimmed) return
  const n = Number(trimmed)
  if (!Number.isFinite(n) || n < 1) return
  patchParams({ animCols: clampDim(n) })
}

function commitCols(): void {
  const n = Number(colsDraft.value.trim())
  const next = Number.isFinite(n) && n >= 1 ? clampDim(n) : state.value.cols
  patchParams({ animCols: next })
  colsDraft.value = String(next)
}

function onColsBlur(): void {
  colsFocused.value = false
  commitCols()
}

function onVideoRangeChange(which: 'start' | 'end', e: Event): void {
  const v = Number((e.target as HTMLInputElement).value)
  if (!Number.isFinite(v)) return
  const next = normalizeAnimVideoRange(
    which === 'start' ? v : videoRange.value.startRatio,
    which === 'end' ? v : videoRange.value.endRatio
  )
  patchParams({
    animVideoStartRatio: next.startRatio,
    animVideoEndRatio: next.endRatio
  })
}

async function extractVideoToAnim2dNow(): Promise<void> {
  if (videoExtractBusy.value || !node.value || !props.hostId || !upstreamVideoUrl.value) return
  videoExtractBusy.value = true
  try {
    const sheet = await composeVideoFrameSheet({
      videoUrl: upstreamVideoUrl.value,
      videoRelativePath: upstreamVideoRel.value,
      rows: state.value.rows,
      cols: state.value.cols,
      startRatio: videoRange.value.startRatio,
      endRatio: videoRange.value.endRatio,
      keyColor: keyColor.value,
      keyThreshold: keyThreshold.value,
      stabilize: stabilize.value
    })
    patchParams({
      animGridImage: { dataUrl: sheet.dataUrl }
    })
  } catch (err) {
    gifError.value = err instanceof Error ? err.message : String(err)
  } finally {
    videoExtractBusy.value = false
  }
}

function onKeyColorChange(e: Event): void {
  const value = (e.target as HTMLSelectElement).value as AnimKeyColor
  patchParams({
    animKeyColor: value === 'black' || value === 'white' || value === 'auto' ? value : ''
  })
}

function onKeyThresholdChange(e: Event): void {
  const n = Number((e.target as HTMLInputElement).value)
  if (!Number.isFinite(n)) return
  patchParams({ animKeyThreshold: Math.max(5, Math.min(180, Math.round(n))) })
}

function onEdgeInsetChange(e: Event): void {
  const raw = (e.target as HTMLSelectElement).value
  patchParams({ animEdgeInset: raw === 'auto' ? 'auto' : Math.max(0, Number(raw) || 0) })
}

function onStabilizeChange(e: Event): void {
  const value = (e.target as HTMLSelectElement).value as AnimStabilizeMode
  patchParams({ animStabilize: value })
}

function onOutlineColorChange(e: Event): void {
  const value = normalizeAnimOutlineColor((e.target as HTMLSelectElement).value)
  patchParams({ animOutline: value })
}

function onPixelSnapChange(e: Event): void {
  const value = normalizeAnimPixelSnap((e.target as HTMLSelectElement).value)
  patchParams({ animPixelSnap: value })
}

function onGroundShadowChange(e: Event): void {
  patchParams({ animGroundShadow: (e.target as HTMLInputElement).checked })
}

function onPaletteLockChange(e: Event): void {
  const value = normalizeAnimPaletteLock((e.target as HTMLSelectElement).value)
  patchParams({ animPaletteLock: value })
}

function onMotionTrailChange(e: Event): void {
  const value = normalizeAnimMotionTrail((e.target as HTMLSelectElement).value)
  patchParams({ animMotionTrail: value })
}

function onLoopBlendChange(e: Event): void {
  patchParams({ animLoopBlend: (e.target as HTMLInputElement).checked })
}

const HOLD_CYCLE_STEPS = [1, 1.5, 2, 3, 0.5] as const

function getCellHold(key: string | undefined): number {
  if (!key) return 1
  return cellHolds.value[key] ?? 1
}

function cycleCellHold(key: string): void {
  const cur = getCellHold(key)
  const curIdx = HOLD_CYCLE_STEPS.findIndex((v) => Math.abs(v - cur) < 0.05)
  const nextVal = HOLD_CYCLE_STEPS[(curIdx + 1) % HOLD_CYCLE_STEPS.length] ?? 1
  const nextMap = { ...cellHolds.value }
  if (Math.abs(nextVal - 1) < 0.01) {
    delete nextMap[key]
  } else {
    nextMap[key] = nextVal
  }
  patchParams({ animCellHolds: nextMap })
}

const cellRepairBusy = ref(false)

function loadImgElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('IMAGE_LOAD_FAILED'))
    img.src = src
  })
}

/**
 * 用当前选中坏帧的前一帧 (t-1) 与后一帧 (t+1) 合成运动过渡帧，并原位回写到源序列图对应格子。
 */
async function repairCurrentCellWithNeighbors(): Promise<void> {
  if (cellRepairBusy.value || !node.value) return
  const curCell = currentActiveCell.value
  const prevCell = prevActiveCell.value
  const nextCell = nextActiveCell.value
  const sheetUrl = sourceSheetUrl.value
  if (!curCell || !prevCell || !nextCell || !sheetUrl) return
  const parsed = parseCellKey(curCell.key)
  if (!parsed) return

  cellRepairBusy.value = true
  try {
    const [sheetImg, prevImg, nextImg] = await Promise.all([
      loadImgElement(sheetUrl),
      loadImgElement(prevCell.dataUrl),
      loadImgElement(nextCell.dataUrl)
    ])
    const sw = sheetImg.naturalWidth || 512
    const sh = sheetImg.naturalHeight || 512
    const rect = gridCellPixelRect(
      sw,
      sh,
      state.value.rows,
      state.value.cols,
      parsed.row,
      parsed.col
    )

    const sheetCanvas = document.createElement('canvas')
    sheetCanvas.width = sw
    sheetCanvas.height = sh
    const sctx = sheetCanvas.getContext('2d')
    if (!sctx) return
    sctx.drawImage(sheetImg, 0, 0)

    // 采样该格四角背景色填充底座，再将前后两帧以光学权重叠加合成过渡姿态
    const cellData = sctx.getImageData(rect.sx, rect.sy, rect.width, rect.height)
    const p0 = 0
    const bgR = cellData.data[p0] ?? 255
    const bgG = cellData.data[p0 + 1] ?? 255
    const bgB = cellData.data[p0 + 2] ?? 255
    const bgA = cellData.data[p0 + 3] ?? 255

    sctx.clearRect(rect.sx, rect.sy, rect.width, rect.height)
    if (bgA > 16 && !keyColor.value) {
      sctx.fillStyle = `rgb(${bgR}, ${bgG}, ${bgB})`
      sctx.fillRect(rect.sx, rect.sy, rect.width, rect.height)
    }

    sctx.save()
    sctx.globalAlpha = 0.55
    sctx.drawImage(prevImg, rect.sx, rect.sy, rect.width, rect.height)
    sctx.globalAlpha = 0.72
    sctx.drawImage(nextImg, rect.sx, rect.sy, rect.width, rect.height)
    sctx.restore()

    patchParams({
      animGridImage: { dataUrl: sheetCanvas.toDataURL('image/png') }
    })
  } catch (err) {
    gifError.value = err instanceof Error ? err.message : String(err)
  } finally {
    cellRepairBusy.value = false
  }
}

function onPlayModeChange(e: Event): void {
  const value = (e.target as HTMLSelectElement).value as AnimPlayMode
  patchParams({ animPlayMode: value })
}

function onGifFpsChange(e: Event): void {
  patchParams(animGifFpsToNodePatch(Number((e.target as HTMLSelectElement).value)))
}

function isCellDisabled(key: string): boolean {
  return disabledCells.value.includes(key)
}

function toggleCellDisabled(key: string): void {
  const current = [...disabledCells.value]
  const idx = current.indexOf(key)
  if (idx >= 0) {
    current.splice(idx, 1)
  } else {
    if (cells.value.length - current.length <= 1) return
    current.push(key)
  }
  patchParams({ animDisabledCells: current })
}

type AnimCell = { key: string; dataUrl: string }
const cells = ref<AnimCell[]>([])
const gridLoading = ref(false)
let cellToken = 0

const playing = ref(true)
const loop = ref(true)
const activeIndex = ref(0)
const playDirection = ref<1 | -1>(1)
const fps = ref(FPS_DEFAULT)

function readStoredFps(): number {
  try {
    const n = Number(localStorage.getItem(FPS_STORAGE_KEY))
    if (Number.isFinite(n) && FPS_OPTIONS.includes(n)) return n
  } catch {
    /* ignore */
  }
  return FPS_DEFAULT
}
fps.value = readStoredFps()

const activeCells = computed(() => {
  const set = new Set(disabledCells.value)
  const filtered = cells.value.filter((c) => !set.has(c.key))
  return filtered.length > 0 ? filtered : cells.value
})

const currentActiveCell = computed(
  () => activeCells.value[activeIndex.value] ?? activeCells.value[0] ?? null
)
const prevActiveCell = computed(() => {
  if (activeCells.value.length < 2) return null
  const prevIdx = (activeIndex.value - 1 + activeCells.value.length) % activeCells.value.length
  return activeCells.value[prevIdx] ?? null
})
const nextActiveCell = computed(() => {
  if (activeCells.value.length < 2) return null
  const nextIdx = (activeIndex.value + 1) % activeCells.value.length
  return activeCells.value[nextIdx] ?? null
})

function applyRhythmPreset(presetId: AnimRhythmPresetId): void {
  const keys = activeCells.value.map((c) => c.key)
  const nextMap = buildAnimRhythmPresetHolds(presetId, keys)
  patchParams({ animCellHolds: nextMap })
}

const currentCellOffset = computed<AnimCellOffset>(() => {
  const key = currentActiveCell.value?.key
  if (!key) return { dx: 0, dy: 0 }
  return cellOffsets.value[key] ?? { dx: 0, dy: 0 }
})

function nudgeCurrentCell(stepX: number, stepY: number, ev?: MouseEvent): void {
  const key = currentActiveCell.value?.key
  if (!key) return
  const mult = ev?.shiftKey ? 4 : 1
  const cur = currentCellOffset.value
  const nextDx = Math.max(-256, Math.min(256, cur.dx + stepX * mult))
  const nextDy = Math.max(-256, Math.min(256, cur.dy + stepY * mult))
  const nextMap = { ...cellOffsets.value }
  if (nextDx === 0 && nextDy === 0 && !cur.flipX) {
    delete nextMap[key]
  } else {
    nextMap[key] = { dx: nextDx, dy: nextDy, ...(cur.flipX ? { flipX: true } : {}) }
  }
  patchParams({ animCellOffsets: nextMap })
}

function toggleCurrentCellFlipX(): void {
  const key = currentActiveCell.value?.key
  if (!key) return
  const cur = currentCellOffset.value
  const nextFlip = !cur.flipX
  const nextMap = { ...cellOffsets.value }
  if (cur.dx === 0 && cur.dy === 0 && !nextFlip) {
    delete nextMap[key]
  } else {
    nextMap[key] = { dx: cur.dx, dy: cur.dy, ...(nextFlip ? { flipX: true } : {}) }
  }
  patchParams({ animCellOffsets: nextMap })
}

function resetCurrentCellOffset(): void {
  const key = currentActiveCell.value?.key
  if (!key) return
  const nextMap = { ...cellOffsets.value }
  delete nextMap[key]
  patchParams({ animCellOffsets: nextMap })
}

interface NormalizedCombatBoxes {
  raw: SpriteCombatBoxes
  hurtboxPct: { left: number; top: number; width: number; height: number }
  hitboxPct: { left: number; top: number; width: number; height: number } | null
}
const cellCombatBoxMap = ref<Record<string, NormalizedCombatBoxes>>({})
const currentCombatBoxes = computed<NormalizedCombatBoxes | null>(() => {
  const key = currentActiveCell.value?.key
  if (!key) return null
  return cellCombatBoxMap.value[key] ?? null
})

let normalRenderToken = 0
watch(
  () =>
    [
      normalViewMode.value,
      currentActiveCell.value?.dataUrl ?? '',
      lightNormPos.value.x,
      lightNormPos.value.y
    ] as const,
  async ([mode, dataUrl, lx, ly]) => {
    if (mode === 'off' || !dataUrl) {
      normalPreviewDataUrl.value = ''
      return
    }
    const token = ++normalRenderToken
    try {
      const img = await loadImgElement(dataUrl)
      if (token !== normalRenderToken) return
      const w = img.naturalWidth || 128
      const h = img.naturalHeight || 128
      const c = document.createElement('canvas')
      c.width = w
      c.height = h
      const ctx = c.getContext('2d')
      if (!ctx) return
      ctx.drawImage(img, 0, 0)
      const srcData = ctx.getImageData(0, 0, w, h)
      const normalRgba = generateSpriteNormalMap(srcData.data, w, h)
      if (mode === 'normal') {
        ctx.putImageData(new ImageData(new Uint8ClampedArray(normalRgba), w, h), 0, 0)
        normalPreviewDataUrl.value = c.toDataURL('image/png')
        return
      }
      // 实时 2D 点光源受光渲染（Lambertian 漫反射 + Blinn-Phong 高光）
      const outData = ctx.createImageData(w, h)
      const out = outData.data
      const lightPxX = lx * w
      const lightPxY = ly * h
      const lightPxZ = Math.max(48, Math.min(w, h) * 0.45)
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const p = (y * w + x) * 4
          const a = srcData.data[p + 3]!
          if (a < 16) continue
          const nx = (normalRgba[p]! / 255) * 2 - 1
          const ny = (normalRgba[p + 1]! / 255) * 2 - 1
          const nz = (normalRgba[p + 2]! / 255) * 2 - 1
          const dx = lightPxX - x
          const dy = -(lightPxY - y)
          const dz = lightPxZ
          const invL = 1 / Math.hypot(dx, dy, dz)
          const ldx = dx * invL
          const ldy = dy * invL
          const ldz = dz * invL
          const ndotl = Math.max(0, nx * ldx + ny * ldy + nz * ldz)
          // 半程向量 H = normalize(L + V)，V=(0,0,1)
          const hx = ldx
          const hy = ldy
          const hz = ldz + 1
          const invH = 1 / Math.hypot(hx, hy, hz)
          const ndoth = Math.max(0, (nx * hx + ny * hy + nz * hz) * invH)
          const spec = Math.pow(ndoth, 18) * 95
          const ambient = 0.32
          const diffuse = ndotl * 1.05
          const lightFactor = ambient + diffuse
          out[p] = Math.min(255, Math.round(srcData.data[p]! * lightFactor * 1.05 + spec))
          out[p + 1] = Math.min(
            255,
            Math.round(srcData.data[p + 1]! * lightFactor * 0.98 + spec * 0.92)
          )
          out[p + 2] = Math.min(
            255,
            Math.round(srcData.data[p + 2]! * lightFactor * 0.88 + spec * 0.75)
          )
          out[p + 3] = a
        }
      }
      ctx.putImageData(outData, 0, 0)
      normalPreviewDataUrl.value = c.toDataURL('image/png')
    } catch {
      /* ignore */
    }
  }
)

let frameTimer: ReturnType<typeof setTimeout> | null = null

function clearFrameTimer(): void {
  if (frameTimer) {
    clearTimeout(frameTimer)
    frameTimer = null
  }
}

function stopPlayback(): void {
  clearFrameTimer()
  playing.value = false
}

function scheduleNextFrameTick(): void {
  clearFrameTimer()
  if (!playing.value || !activeCells.value.length) return
  const curKey = currentActiveCell.value?.key
  const hold = getCellHold(curKey)
  const delayMs = Math.max(16, Math.round((1000 / fps.value) * hold))
  frameTimer = setTimeout(() => {
    const count = activeCells.value.length
    if (count <= 1) return
    if (playMode.value === 'pingpong') {
      const next = activeIndex.value + playDirection.value
      if (next >= count) {
        playDirection.value = -1
        activeIndex.value = Math.max(0, count - 2)
      } else if (next < 0) {
        if (loop.value) {
          playDirection.value = 1
          activeIndex.value = Math.min(count - 1, 1)
        } else {
          stopPlayback()
          return
        }
      } else {
        activeIndex.value = next
      }
      scheduleNextFrameTick()
      return
    }
    if (activeIndex.value + 1 >= count) {
      if (loop.value) activeIndex.value = 0
      else {
        stopPlayback()
        return
      }
    } else {
      activeIndex.value += 1
    }
    scheduleNextFrameTick()
  }, delayMs)
}

function startPlayback(): void {
  if (!activeCells.value.length) return
  playing.value = true
  scheduleNextFrameTick()
}

function togglePlay(): void {
  if (playing.value) {
    stopPlayback()
    return
  }
  playDirection.value = 1
  startPlayback()
}

function stepFrame(delta: -1 | 1): void {
  stopPlayback()
  const count = activeCells.value.length
  if (!count) return
  activeIndex.value = (activeIndex.value + delta + count) % count
}

function seekToCellKey(key: string): void {
  const idx = activeCells.value.findIndex((c) => c.key === key)
  if (idx >= 0) {
    activeIndex.value = idx
    if (playing.value) {
      clearFrameTimer()
      startPlayback()
    }
  }
}

function onFpsChange(e: Event): void {
  const n = Number((e.target as HTMLSelectElement).value)
  if (!Number.isFinite(n) || n <= 0) return
  fps.value = n
  try {
    localStorage.setItem(FPS_STORAGE_KEY, String(n))
  } catch {
    /* ignore */
  }
  if (playing.value) {
    clearFrameTimer()
    startPlayback()
  }
}

function onLoopChange(e: Event): void {
  loop.value = (e.target as HTMLInputElement).checked
}

const gifBusy = ref(false)
const sheetBusy = ref(false)
const gifStatus = ref('')
const gifError = ref('')
const gifSaveOpen = ref(false)
const saveMode = ref<'gif' | 'sheet'>('gif')
const gifSaveDefaultName = ref('')
const gifSaveRef = ref<InstanceType<typeof SaveAssetDialog> | null>(null)
const gifSaving = ref(false)

async function composeGifFromCells(): Promise<Anim2dGifResult> {
  const seqCells =
    playMode.value === 'pingpong' && activeCells.value.length > 2
      ? [...activeCells.value, ...activeCells.value.slice(1, -1).reverse()]
      : activeCells.value
  const frameUrls = seqCells.map((cell) => cell.dataUrl)
  const frameHolds = seqCells.map((cell) => getCellHold(cell.key))
  const gif = await composeAnim2dGif({
    frameUrls,
    fps: fps.value,
    loop: loop.value,
    frameHolds
  })
  if (!gif) throw new Error('ANIM2D_GIF_NO_FRAMES')
  return gif
}

function exportGif(): void {
  if (!node.value || gifBusy.value || activeCells.value.length < 2) return
  gifError.value = ''
  saveMode.value = 'gif'
  gifSaveDefaultName.value = `anim2d-gif-${state.value.rows}x${state.value.cols}`
  gifSaveOpen.value = true
}

function exportSheet(): void {
  if (!node.value || sheetBusy.value || activeCells.value.length < 1) return
  gifError.value = ''
  saveMode.value = 'sheet'
  gifSaveDefaultName.value = `anim2d-sheet-${activeCells.value.length}f`
  gifSaveOpen.value = true
}

function closeGifSave(): void {
  if (gifSaving.value) return
  gifSaveOpen.value = false
}

async function onSaveConfirm(payload: { name: string; folderId: string | null }): Promise<void> {
  if (!node.value || gifSaving.value) return
  gifSaving.value = true
  if (saveMode.value === 'sheet') sheetBusy.value = true
  else gifBusy.value = true
  gifStatus.value = ''
  gifError.value = ''
  gifSaveRef.value?.setSaving(true)
  try {
    let mediaDataUrl = ''
    let keyPrefix = 'anim2d-gif'
    let subFolder = 'Gifs'
    let sheetInfo: Stage2dFrameSheet | null = null
    if (saveMode.value === 'sheet') {
      const sheet = await composeStage2dFrameSheet({
        frameUrls: activeCells.value.map((c) => c.dataUrl)
      })
      if (!sheet?.dataUrl) throw new Error('ANIM2D_SHEET_EMPTY')
      sheetInfo = sheet
      mediaDataUrl = sheet.dataUrl
      keyPrefix = 'anim2d-sheet'
      subFolder = 'Sheets'
    } else {
      const gif = await composeGifFromCells()
      mediaDataUrl = gif.dataUrl
    }

    const cacheRoot = resolveCacheOutputRoot(project.config?.cacheOutputDir)
    const stagedPath = await window.studio.saveGraphRunMedia({
      dataUrl: mediaDataUrl,
      key: `${keyPrefix}-${Date.now()}`,
      outputDir: `${cacheRoot}/${subFolder}`
    })
    if (!(await window.studio.projectFileExists(stagedPath))) {
      const name = stagedPath.split('/').pop() || stagedPath
      gifSaveRef.value?.setSourceMissing(stagedPath)
      gifSaveRef.value?.setError(t('dialog.saveAsset.sourceMissing', { name }))
      return
    }
    const asset = await window.studio.saveProjectAsset({
      relativePath: stagedPath,
      name: payload.name,
      folderId: payload.folderId
    })
    if (saveMode.value === 'sheet' && sheetInfo && asset.relativePath) {
      const anchorMode = stabilize.value === 'center' ? 'center' : 'ground'
      const imageFileName = asset.relativePath.split('/').pop() || `${payload.name}.png`
      const normalMapFileName = imageFileName.replace(/\.png$/i, '.normal.png')
      const frameNames = activeCells.value.map((cell, idx) => `${payload.name}-${cell.key || idx}`)
      const manifest = buildSpriteManifest({
        canvasWidth: sheetInfo.frameWidth,
        canvasHeight: sheetInfo.frameHeight,
        anchor: anchorMode,
        sprites: frameNames.map((name) => ({
          name,
          fileName: imageFileName,
          width: sheetInfo.frameWidth,
          height: sheetInfo.frameHeight
        }))
      })
      const combatList = activeCells.value
        .map((cell) => cellCombatBoxMap.value[cell.key]?.raw)
        .filter((cb): cb is SpriteCombatBoxes => Boolean(cb))
      const engineAtlas = buildEngineSpriteSheetJson({
        imageFileName,
        normalMapFileName,
        frameWidth: sheetInfo.frameWidth,
        frameHeight: sheetInfo.frameHeight,
        frameNames,
        columns: sheetInfo.columns,
        fps: fps.value,
        anchor: anchorMode,
        playMode: playMode.value,
        tagName: payload.name,
        frameHolds: activeCells.value.map((cell) => getCellHold(cell.key)),
        ...(combatList.length === activeCells.value.length ? { frameCombatBoxes: combatList } : {})
      })
      const manifestPath = asset.relativePath.replace(/\.png$/i, '.manifest.json')
      const atlasPath = asset.relativePath.replace(/\.png$/i, '.atlas.json')
      try {
        await window.studio.writeProjectFile({
          relativePath: manifestPath,
          content: JSON.stringify(manifest, null, 2)
        })
        await window.studio.writeProjectFile({
          relativePath: atlasPath,
          content: JSON.stringify(engineAtlas, null, 2)
        })
        // 同步生成并保存配套 2D 切线空间法线贴图（.normal.png）到同一资产目录
        const sheetImg = await loadImgElement(sheetInfo.dataUrl)
        const nw = sheetImg.naturalWidth || 1
        const nh = sheetImg.naturalHeight || 1
        const nCanvas = document.createElement('canvas')
        nCanvas.width = nw
        nCanvas.height = nh
        const nCtx = nCanvas.getContext('2d')
        if (nCtx) {
          nCtx.drawImage(sheetImg, 0, 0)
          const sData = nCtx.getImageData(0, 0, nw, nh)
          const nRgba = generateSpriteNormalMap(sData.data, nw, nh)
          nCtx.putImageData(new ImageData(new Uint8ClampedArray(nRgba), nw, nh), 0, 0)
          const nStagedPath = await window.studio.saveGraphRunMedia({
            dataUrl: nCanvas.toDataURL('image/png'),
            key: `anim2d-normal-${Date.now()}`,
            outputDir: `${cacheRoot}/Sheets`
          })
          if (await window.studio.projectFileExists(nStagedPath)) {
            await window.studio.saveProjectAsset({
              relativePath: nStagedPath,
              name: `${payload.name}-normal`,
              folderId: payload.folderId
            })
          }
        }
      } catch {
        /* ignore */
      }
    }
    await project.scheduleRefreshLibrary()
    gifSaveOpen.value = false
    gifStatus.value =
      saveMode.value === 'sheet'
        ? t('graph.anim2d.exportSheetDone', { path: asset.relativePath || asset.name })
        : t('graph.anim2d.exportGifDone', { path: asset.relativePath || asset.name })
  } catch (err) {
    gifSaveRef.value?.setError(err instanceof Error ? err.message : String(err))
  } finally {
    gifSaving.value = false
    gifBusy.value = false
    sheetBusy.value = false
    gifSaveRef.value?.setSaving(false)
  }
}

async function resolveGridImageUrl(): Promise<string> {
  const grid = node.value?.params?.animGridImage as
    { dataUrl?: string; relativePath?: string } | undefined
  if (grid?.dataUrl?.trim()) return grid.dataUrl.trim()
  if (grid?.relativePath?.trim()) {
    try {
      const url = await window.studio.getAssetMediaDataUrl(grid.relativePath.trim())
      if (url?.trim()) return url.trim()
    } catch {
      /* fallback to upstream */
    }
  }
  if (props.hostId && node.value?.id) {
    const document = graphEditorHosts.getDocument(props.hostId)
    const runStates = graphRunHosts.get(props.hostId)?.runStates
    const upstream = await resolveNodeUpstreamImageUrl({
      document,
      nodeId: node.value.id,
      runStates,
      assets: project.assets
    })
    if (upstream?.trim()) return upstream.trim()
  }
  return ''
}

async function refreshCells(): Promise<void> {
  const current = node.value
  const s = state.value
  if (!current) {
    cells.value = []
    sourceSheetUrl.value = ''
    gridLoading.value = false
    return
  }
  const token = ++cellToken
  gridLoading.value = true
  try {
    const sourceUrl = await resolveGridImageUrl()
    if (token !== cellToken) return
    sourceSheetUrl.value = sourceUrl
    if (!sourceUrl) {
      cells.value = []
      return
    }
    const next: AnimCell[] = []
    const nextCombatBoxes: Record<string, NormalizedCombatBoxes> = {}
    const keyColorValue = readAnimKeyColorFromNode(current.params)
    const thresholdValue = readAnimKeyThresholdFromNode(current.params)
    const insetValue = readAnimEdgeInsetFromNode(current.params)
    const stabilizeValue = readAnimStabilizeFromNode(current.params)
    const offsetsMap = readAnimCellOffsetsFromNode(current.params)
    const outlineVal = readAnimOutlineFromNode(current.params)
    const pixelSnapVal = readAnimPixelSnapFromNode(current.params)
    const groundShadowVal = readAnimGroundShadowFromNode(current.params)
    const paletteLockVal = readAnimPaletteLockFromNode(current.params)
    const motionTrailVal = readAnimMotionTrailFromNode(current.params)
    const loopBlendVal = readAnimLoopBlendFromNode(current.params)
    const playModeVal = readAnimPlayModeFromNode(current.params)
    const disabledSet = new Set(readAnimDisabledCellsFromNode(current.params))
    const allKeys = anim2dCellKeys(s.rows, s.cols)
    const enabledKeys = allKeys.filter((k) => !disabledSet.has(k))
    const lastEnabledKey = enabledKeys.length >= 3 ? enabledKeys[enabledKeys.length - 1] : ''
    for (let i = 0; i < allKeys.length; i++) {
      const cell = allKeys[i]!
      if (token !== cellToken) return
      try {
        const offset = offsetsMap[cell]
        const enabledIdx = enabledKeys.indexOf(cell)
        const prevCellKey = enabledIdx > 0 ? enabledKeys[enabledIdx - 1] : undefined
        const isLastLoopCell = playModeVal === 'loop' && cell === lastEnabledKey
        const composed = await composeImageGridCell({
          sourceDataUrl: sourceUrl,
          state: { rows: s.rows, cols: s.cols, selected: [] },
          cellKey: cell,
          edgeInset: insetValue,
          ...(keyColorValue
            ? { chromaKey: { color: keyColorValue, threshold: thresholdValue } }
            : {}),
          ...(stabilizeValue !== 'off' ? { stabilize: stabilizeValue } : {}),
          ...(offset ? { cellOffset: offset } : {}),
          ...(paletteLockVal > 0 ? { paletteLock: paletteLockVal } : {}),
          ...(loopBlendVal && isLastLoopCell ? { loopBlend: true, isLastLoopCell: true } : {}),
          ...(pixelSnapVal > 1 ? { pixelSnap: pixelSnapVal } : {}),
          ...(outlineVal ? { outlineColor: outlineVal } : {}),
          ...(motionTrailVal && prevCellKey ? { motionTrail: motionTrailVal, prevCellKey } : {}),
          ...(groundShadowVal ? { groundShadow: true } : {})
        })
        if (composed.dataUrl) {
          next.push({ key: cell, dataUrl: composed.dataUrl })
          try {
            const cImg = await loadImgElement(composed.dataUrl)
            const cw = Math.max(1, cImg.naturalWidth || composed.width || 1)
            const ch = Math.max(1, cImg.naturalHeight || composed.height || 1)
            const cCan = document.createElement('canvas')
            cCan.width = cw
            cCan.height = ch
            const cCtx = cCan.getContext('2d')
            if (cCtx) {
              cCtx.drawImage(cImg, 0, 0)
              const rgba = cCtx.getImageData(0, 0, cw, ch).data
              const cb = detectSpriteCombatBoxes(rgba, cw, ch)
              if (cb) {
                nextCombatBoxes[cell] = {
                  raw: cb,
                  hurtboxPct: {
                    left: (cb.hurtbox.x / cw) * 100,
                    top: (cb.hurtbox.y / ch) * 100,
                    width: (cb.hurtbox.width / cw) * 100,
                    height: (cb.hurtbox.height / ch) * 100
                  },
                  hitboxPct: cb.hitbox
                    ? {
                        left: (cb.hitbox.x / cw) * 100,
                        top: (cb.hitbox.y / ch) * 100,
                        width: (cb.hitbox.width / cw) * 100,
                        height: (cb.hitbox.height / ch) * 100
                      }
                    : null
                }
              }
            }
          } catch {
            /* ignore combat box detection error */
          }
        }
      } catch {
        /* skip */
      }
    }
    if (token !== cellToken) return
    cellCombatBoxMap.value = nextCombatBoxes
    cells.value = next
    if (next.length > 1) {
      startPlayback()
    }
  } catch {
    if (token === cellToken) cells.value = []
  } finally {
    if (token === cellToken) gridLoading.value = false
  }
}

watch(
  [
    () => node.value?.id ?? '',
    () => props.hostId,
    () => graphEditorHosts.revision.value,
    () => `${state.value.rows}x${state.value.cols}`,
    () => readAnimKeyColorFromNode(node.value?.params),
    () => readAnimKeyThresholdFromNode(node.value?.params),
    () => readAnimEdgeInsetFromNode(node.value?.params),
    () => readAnimStabilizeFromNode(node.value?.params),
    () => readAnimOutlineFromNode(node.value?.params),
    () => readAnimPixelSnapFromNode(node.value?.params),
    () => readAnimGroundShadowFromNode(node.value?.params),
    () => readAnimPaletteLockFromNode(node.value?.params),
    () => readAnimMotionTrailFromNode(node.value?.params),
    () => readAnimLoopBlendFromNode(node.value?.params),
    () => JSON.stringify(readAnimCellOffsetsFromNode(node.value?.params)),
    () => {
      const grid = node.value?.params?.animGridImage as
        { dataUrl?: string; relativePath?: string } | undefined
      return grid?.dataUrl?.slice(0, 64) ?? grid?.relativePath ?? ''
    }
  ],
  () => {
    void refreshCells()
  },
  { immediate: true }
)

watch(activeCells, (next) => {
  if (activeIndex.value >= next.length) activeIndex.value = 0
})

function onClose(): void {
  if (!diveCtx) return
  const idx = diveCtx.frames.findIndex((f) => f.key === props.frameKey)
  diveCtx.popTo(idx > 0 ? idx - 1 : -1)
}

onBeforeUnmount(stopPlayback)
</script>

<style scoped>
.anim2d-dive {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  background: var(--bg);
  color: var(--text);
  overflow: hidden;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 14px;
  background: var(--bg-panel);
  border-bottom: 1px solid var(--border);
  flex-wrap: wrap;
}

.toolbar-group {
  display: flex;
  align-items: center;
  gap: 6px;
}

.tb-title {
  font-size: 13px;
  font-weight: 600;
  margin-right: 4px;
}

.tb-divider {
  width: 1px;
  height: 20px;
  background: var(--border);
}

.spacer {
  flex: 1;
}

.preset-pills,
.zoom-pills,
.backdrop-pills {
  display: flex;
  gap: 3px;
  background: var(--bg-input);
  padding: 2px;
  border-radius: 6px;
}

.tb-pill {
  padding: 3px 7px;
  font-size: 11px;
  border-radius: 4px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
}

.tb-pill.active {
  background: rgba(99, 102, 241, 0.25);
  color: #a5b4fc;
  font-weight: 600;
}

.dim-inline {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
}

.dim-inline label {
  display: flex;
  align-items: center;
  gap: 4px;
}

.dim-inline input {
  width: 56px;
  padding: 2px 4px;
  border-radius: 4px;
  border: 1px solid var(--border);
  background: var(--bg-input);
  color: inherit;
  font-size: 12px;
  text-align: center;
}

.tb-btn {
  padding: 5px 10px;
  font-size: 12px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--bg-input);
  color: var(--text);
  cursor: pointer;
}

.tb-btn--active {
  border-color: rgba(99, 102, 241, 0.65);
  background: rgba(99, 102, 241, 0.2);
  color: #c7d2fe;
}

.tb-btn--accent {
  border-color: rgba(56, 189, 248, 0.55);
  background: rgba(56, 189, 248, 0.16);
  color: #bae6fd;
}

.tb-btn.done {
  border-color: rgba(34, 197, 94, 0.5);
  background: rgba(34, 197, 94, 0.18);
  color: #bbf7d0;
  font-weight: 600;
}

.body {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 340px 1fr;
}

.left-sidebar {
  border-right: 1px solid var(--border);
  background: var(--bg-panel);
  padding: 12px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.panel-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--bg-elevated) 60%, transparent);
  border: 1px solid var(--border);
}

.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.panel-title {
  font-size: 12px;
  font-weight: 600;
}

.panel-badge {
  font-size: 11px;
  color: var(--text-muted);
}

.sheet-overlay-wrap {
  border-radius: 6px;
  overflow: hidden;
  border: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 6px;
}

.sheet-stage {
  position: relative;
  display: inline-block;
  max-width: 100%;
}

.sheet-img {
  display: block;
  max-width: 100%;
  max-height: 240px;
  object-fit: contain;
}

.sheet-grid-overlay {
  position: absolute;
  inset: 0;
  display: grid;
}

.sheet-grid-cell {
  position: relative;
  border: 1px dashed rgba(99, 102, 241, 0.55);
  cursor: pointer;
  transition: background 0.12s;
}

.sheet-grid-cell:hover {
  background: rgba(99, 102, 241, 0.16);
}

.sheet-grid-cell.active {
  border: 2px solid #fbbf24;
  background: rgba(251, 191, 36, 0.14);
}

.sheet-grid-cell.disabled {
  background: rgba(0, 0, 0, 0.65);
}

.cell-num {
  position: absolute;
  top: 2px;
  left: 3px;
  font-size: 10px;
  padding: 0 4px;
  border-radius: 3px;
  background: rgba(0, 0, 0, 0.65);
  color: #f9fafb;
}

.cell-mute-btn {
  position: absolute;
  top: 2px;
  right: 2px;
  font-size: 10px;
  padding: 0 3px;
  border: none;
  border-radius: 3px;
  background: rgba(0, 0, 0, 0.65);
  color: #fff;
  cursor: pointer;
}

.video-preview {
  width: 100%;
  max-height: 150px;
  border-radius: 6px;
  background: #000;
}

.range-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
}

.range-row input[type='range'] {
  flex: 1;
}

.extract-btn {
  padding: 6px 10px;
  border-radius: 6px;
  border: 1px solid rgba(56, 189, 248, 0.45);
  background: rgba(56, 189, 248, 0.15);
  color: #e0f2fe;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.field-row {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
}

.field-label {
  font-size: 11px;
  color: var(--text-muted);
}

.two-col {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.select {
  padding: 5px 8px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--bg-input);
  color: inherit;
  font-size: 12px;
}

.select.compact {
  padding: 3px 6px;
}

.stage-main {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

.stage-viewport {
  flex: 1;
  min-height: 0;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  cursor: pointer;
}

.bg-checker {
  background: var(--image-checker-bg);
}

.bg-dark {
  background: #0d0f13;
}

.bg-light {
  background: #e5e7eb;
}

.stage-canvas-box {
  position: relative;
  width: 320px;
  height: 320px;
  display: flex;
  align-items: center;
  justify-content: center;
  transform-origin: center center;
}

.stage-frame {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}

.stage-frame.onion-prev {
  position: absolute;
  opacity: 0.36;
  filter: sepia(1) saturate(5) hue-rotate(-35deg);
  pointer-events: none;
}

.stage-frame.onion-next {
  position: absolute;
  opacity: 0.3;
  filter: sepia(1) saturate(5) hue-rotate(95deg);
  pointer-events: none;
}

.rhythm-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.nudge-row {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
}

.film-hold-pill {
  padding: 0 5px;
  font-size: 10px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--bg-input);
  color: var(--text-muted);
  cursor: pointer;
}

.film-hold-pill.custom {
  border-color: rgba(251, 191, 36, 0.65);
  background: rgba(251, 191, 36, 0.22);
  color: #fde68a;
  font-weight: 600;
}

.pixelated {
  image-rendering: pixelated;
}

.guide-v {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 50%;
  width: 1px;
  background: rgba(56, 189, 248, 0.45);
  pointer-events: none;
}

.guide-h-center {
  position: absolute;
  left: 0;
  right: 0;
  top: 50%;
  height: 1px;
  background: rgba(56, 189, 248, 0.35);
  pointer-events: none;
}

.guide-h-ground {
  position: absolute;
  left: 8%;
  right: 8%;
  bottom: 6%;
  height: 2px;
  background: rgba(251, 191, 36, 0.65);
  pointer-events: none;
}

.combat-box {
  position: absolute;
  pointer-events: none;
  box-sizing: border-box;
  border-radius: 3px;
}

.hurtbox-overlay {
  border: 1.5px dashed rgba(34, 197, 94, 0.85);
  background: rgba(34, 197, 94, 0.08);
}

.hitbox-overlay {
  border: 1.5px solid rgba(244, 63, 94, 0.92);
  background: rgba(244, 63, 94, 0.16);
  box-shadow: 0 0 8px rgba(244, 63, 94, 0.35);
}

.combat-tag {
  position: absolute;
  top: -14px;
  left: 0;
  font-size: 9px;
  font-weight: 700;
  padding: 0 4px;
  border-radius: 2px;
  line-height: 12px;
  letter-spacing: 0.4px;
}

.hurtbox-overlay .combat-tag {
  background: rgba(22, 163, 74, 0.85);
  color: #dcfce7;
}

.hitbox-overlay .combat-tag {
  background: rgba(225, 29, 72, 0.9);
  color: #ffe4e6;
}

.stage-hud {
  position: absolute;
  top: 12px;
  left: 12px;
  display: flex;
  gap: 6px;
  pointer-events: none;
}

.hud-pill {
  padding: 3px 8px;
  border-radius: 999px;
  font-size: 11px;
  background: rgba(0, 0, 0, 0.65);
  color: #f9fafb;
}

.hud-pill.subtle {
  color: #9ca3af;
}

.hud-pill.accent {
  background: rgba(99, 102, 241, 0.35);
  color: #e0e7ff;
}

.transport-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 14px;
  background: var(--bg-panel);
  border-top: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
}

.transport-left,
.transport-center,
.transport-right {
  display: flex;
  align-items: center;
  gap: 10px;
}

.ctrl-btn {
  padding: 4px 10px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--bg-input);
  color: inherit;
  cursor: pointer;
  font-size: 12px;
}

.ctrl-btn.primary {
  background: rgba(99, 102, 241, 0.25);
  border-color: rgba(99, 102, 241, 0.55);
  font-weight: 600;
}

.inline-ctrl {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
}

.filmstrip {
  display: flex;
  gap: 8px;
  padding: 10px 14px;
  overflow-x: auto;
  background: rgba(0, 0, 0, 0.25);
  min-height: 116px;
}

.film-cell {
  flex: 0 0 88px;
  display: flex;
  flex-direction: column;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--bg-input);
  overflow: hidden;
  cursor: pointer;
}

.film-cell.active {
  border-color: #fbbf24;
  box-shadow: 0 0 0 1px #fbbf24;
}

.film-cell.disabled {
  opacity: 0.4;
}

.film-thumb {
  height: 70px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4px;
}

.film-thumb img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}

.film-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 2px 5px;
  font-size: 10px;
  background: rgba(0, 0, 0, 0.4);
}

.film-toggle {
  border: none;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font-size: 10px;
  padding: 0 2px;
}

.empty-box,
.stage-empty {
  padding: 20px;
  text-align: center;
  font-size: 12px;
  color: var(--text-secondary, #9ca3af);
}

.status-ok {
  font-size: 11px;
  color: #4ade80;
  margin: 0;
}

.status-err {
  font-size: 11px;
  color: #f87171;
  margin: 0;
}
</style>
