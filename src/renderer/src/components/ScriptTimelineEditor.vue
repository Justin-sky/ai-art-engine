<template>
  <div ref="rootEl" class="script-timeline">
    <div
      class="workspace"
      :style="{
        gridTemplateColumns: `${leftPaneWidth}px 5px minmax(280px, 1fr) 5px ${rightPaneWidth}px`
      }"
    >
      <aside class="panel sources-panel">
        <nav class="capcut-browser-nav" role="tablist">
          <button
            v-for="tab in TIMELINE_BROWSER_TABS"
            :key="tab.id"
            type="button"
            role="tab"
            class="capcut-browser-tab"
            :class="{ active: leftBrowserTab === tab.id }"
            :aria-selected="leftBrowserTab === tab.id"
            @click="selectLeftBrowserTab(tab.id)"
          >
            <svg class="capcut-tab-icon" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path
                :d="tab.iconPath"
                stroke="currentColor"
                stroke-width="1.45"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
            <span class="capcut-tab-label">{{ isZhLocale ? tab.labelZh : tab.labelEn }}</span>
          </button>
        </nav>

        <template v-if="leftBrowserTab === 'sources'">
          <div class="panel-head">
            <span class="panel-title">{{ t('script.timeline.sources') }}</span>
            <div class="panel-actions">
              <button
                type="button"
                class="ghost-btn"
                :disabled="sourcesBusy"
                @click="reloadSources"
              >
                {{ sourcesBusy ? '…' : t('script.timeline.refreshSources') }}
              </button>
              <button
                type="button"
                class="ghost-btn"
                :disabled="!sources.length"
                @click="autoPlaceAll"
              >
                {{ t('script.timeline.autoPlace') }}
              </button>
              <button type="button" class="ghost-btn" :disabled="bgmBusy" @click="onGenerateBgm">
                {{ bgmBusy ? '…' : t('script.timeline.generateBgm') }}
              </button>
              <button type="button" class="ghost-btn" :disabled="sfxBusy" @click="onGenerateSfx">
                {{ sfxBusy ? '…' : t('script.timeline.generateSfx') }}
              </button>
              <button type="button" class="ghost-btn" @click="openSfxLibrary">
                {{ t('script.timeline.sfxLibrary') }}
              </button>
              <button type="button" class="ghost-btn" :disabled="smartCutBusy" @click="onSmartCut">
                {{ smartCutBusy ? '…' : t('script.timeline.smartCut') }}
              </button>
            </div>
          </div>
          <div
            class="source-list"
            :style="{ '--source-card-size': `${sourceGridSize}px` }"
            @contextmenu.prevent="onImportedPanelContextMenu"
          >
            <section v-if="inputSources.length" class="source-group">
              <div class="source-group-head">
                <span>{{ t('script.timeline.sourceGroup.input') }}</span>
                <span class="source-group-count">{{ inputSources.length }}</span>
              </div>
              <div
                v-for="src in inputSources"
                :key="`in-${src.id}`"
                class="source-card origin-input"
                draggable="true"
                @dragstart="onSourceDragStart($event, src)"
                @dblclick="onSourceActivate(src)"
              >
                <span class="source-thumb" :class="sourceThumbClass(src)" aria-hidden="true">
                  <img v-if="sourceThumbUrls[src.id]" :src="sourceThumbUrls[src.id]" alt="" />
                  <span v-else-if="sourceMediaKind(src) === 'voice'" class="source-thumb-glyph">{{
                    voiceSourceIcon
                  }}</span>
                </span>
                <span class="source-meta">
                  <span class="source-name" :title="src.title">{{ src.title }}</span>
                  <span class="source-tags">
                    <span class="source-tag">{{ sourceMediaLabel(src) }}</span>
                    <span v-if="src.durationSec" class="source-dur">{{
                      formatTime(src.durationSec)
                    }}</span>
                  </span>
                </span>
              </div>
            </section>

            <section
              class="source-group imported-panel"
              @contextmenu.prevent="onImportedPanelContextMenu"
              @dragover.prevent="onImportedRootDragOver"
              @drop.prevent="onImportedRootDrop"
            >
              <div class="source-group-head">
                <span>{{ t('script.timeline.sourceGroup.imported') }}</span>
                <span class="source-group-count">{{ importedSources.length }}</span>
              </div>

              <div
                v-for="group in sourceGroups"
                :key="group.id"
                class="source-folder"
                :class="{
                  collapsed: collapsedGroupIds.has(group.id),
                  'drag-over': dropGroupId === group.id
                }"
                @contextmenu.prevent.stop="onGroupContextMenu($event, group.id)"
                @dragover.prevent.stop="onGroupDragOver($event, group.id)"
                @dragleave="onGroupDragLeave($event, group.id)"
                @drop.prevent.stop="onGroupDrop($event, group.id)"
              >
                <button type="button" class="folder-head" @click="toggleGroupCollapsed(group.id)">
                  <span class="folder-chevron" aria-hidden="true">{{
                    collapsedGroupIds.has(group.id) ? '▸' : '▾'
                  }}</span>
                  <span class="folder-title">{{ group.title }}</span>
                  <span class="source-group-count">{{ sourcesInGroup(group.id).length }}</span>
                </button>
                <div v-show="!collapsedGroupIds.has(group.id)" class="folder-body">
                  <div
                    v-for="src in sourcesInGroup(group.id)"
                    :key="`im-${src.id}`"
                    class="source-card origin-imported"
                    draggable="true"
                    @dragstart="onSourceDragStart($event, src)"
                    @dblclick="onSourceActivate(src)"
                  >
                    <span class="source-thumb" :class="sourceThumbClass(src)" aria-hidden="true">
                      <img v-if="sourceThumbUrls[src.id]" :src="sourceThumbUrls[src.id]" alt="" />
                      <span
                        v-else-if="sourceMediaKind(src) === 'voice'"
                        class="source-thumb-glyph"
                        >{{ voiceSourceIcon }}</span
                      >
                    </span>
                    <span class="source-meta">
                      <span class="source-name" :title="src.title">{{ src.title }}</span>
                      <span class="source-tags">
                        <span class="source-tag">{{ sourceMediaLabel(src) }}</span>
                        <span v-if="src.durationSec" class="source-dur">{{
                          formatTime(src.durationSec)
                        }}</span>
                      </span>
                    </span>
                    <button
                      type="button"
                      class="source-remove"
                      :title="t('script.timeline.removeSource')"
                      @pointerdown.stop
                      @click.stop="removeSource(src.id)"
                    >
                      ×
                    </button>
                  </div>
                  <div v-if="!sourcesInGroup(group.id).length" class="folder-empty">
                    {{ t('script.timeline.groupEmpty') }}
                  </div>
                </div>
              </div>

              <div
                class="ungrouped-zone"
                :class="{ 'drag-over': dropGroupId === '' }"
                @contextmenu.prevent="onImportedPanelContextMenu"
                @dragover.prevent.stop="onGroupDragOver($event, '')"
                @dragleave="onGroupDragLeave($event, '')"
                @drop.prevent.stop="onGroupDrop($event, '')"
              >
                <div
                  v-if="sourceGroups.length && ungroupedImportedSources.length"
                  class="ungrouped-label"
                >
                  {{ t('script.timeline.ungrouped') }}
                </div>
                <div
                  v-for="src in ungroupedImportedSources"
                  :key="`im-${src.id}`"
                  class="source-card origin-imported"
                  draggable="true"
                  @dragstart="onSourceDragStart($event, src)"
                  @dblclick="onSourceActivate(src)"
                >
                  <span class="source-thumb" :class="sourceThumbClass(src)" aria-hidden="true">
                    <img v-if="sourceThumbUrls[src.id]" :src="sourceThumbUrls[src.id]" alt="" />
                    <span v-else-if="sourceMediaKind(src) === 'voice'" class="source-thumb-glyph">{{
                      voiceSourceIcon
                    }}</span>
                  </span>
                  <span class="source-meta">
                    <span class="source-name" :title="src.title">{{ src.title }}</span>
                    <span class="source-tags">
                      <span class="source-tag imported">{{
                        t('script.timeline.sourceGroup.importedTag')
                      }}</span>
                      <span class="source-tag">{{ sourceMediaLabel(src) }}</span>
                      <span v-if="src.durationSec" class="source-dur">{{
                        formatTime(src.durationSec)
                      }}</span>
                    </span>
                  </span>
                  <button
                    type="button"
                    class="source-remove"
                    :title="t('script.timeline.removeSource')"
                    @pointerdown.stop
                    @click.stop="removeSource(src.id)"
                  >
                    ×
                  </button>
                </div>
                <div
                  v-if="!importedSources.length && !sourceGroups.length"
                  class="panel-empty subtle"
                >
                  {{
                    inputSources.length
                      ? t('script.timeline.importedEmpty')
                      : t('script.timeline.sourcesEmpty')
                  }}
                </div>
              </div>
            </section>

            <section class="source-group sticker-library-section">
              <div class="source-group-head">
                <span>{{ t('script.timeline.stickerSection') }}</span>
                <span class="source-group-count">{{ builtinStickers.length }}</span>
              </div>
              <div
                v-for="preset in builtinStickers"
                :key="preset.id"
                class="source-card sticker-preset-card"
                draggable="true"
                :title="t('script.timeline.stickerAddHint')"
                @dragstart="onBuiltinStickerDragStart($event, preset)"
                @click="addBuiltinStickerToOverlay(preset)"
              >
                <span class="source-thumb sticker-thumb" aria-hidden="true">
                  <img :src="builtinStickerPreviewUrl(preset)" alt="" draggable="false" />
                </span>
                <span class="source-meta">
                  <span
                    class="source-name"
                    :title="t(`script.timeline.stickerPreset.${preset.id}`)"
                  >
                    {{ t(`script.timeline.stickerPreset.${preset.id}`) }}
                  </span>
                </span>
              </div>
            </section>
          </div>

          <div class="source-size-footer">
            <span class="source-size-label">{{ t('script.timeline.sourceGridSize') }}</span>
            <input
              v-model.number="sourceGridSize"
              class="source-size-range"
              type="range"
              min="48"
              max="120"
              step="4"
            />
          </div>
        </template>

        <!-- 特效 (Effects) -->
        <div v-else-if="leftBrowserTab === 'effects'" class="creative-tab-pane">
          <div class="creative-target-bar" :title="creativeUiText('scopePerClipHint')">
            <span class="creative-target-label">{{ creativeUiText('targetCurrentClip') }}</span>
            <span class="creative-target-name" :title="targetCreativeClip?.title || ''">
              {{ targetCreativeClip ? targetCreativeClip.title : '—' }}
            </span>
            <button
              type="button"
              class="ghost-btn xs-btn"
              :disabled="!hasVideoOrOverlayClips"
              @click="applyCurrentEffectToAllVideoClips"
            >
              {{ creativeUiText('applyToAllClips') }}
            </button>
            <button
              type="button"
              class="ghost-btn xs-btn"
              :disabled="!hasVideoOrOverlayClips"
              @click="clearAllVideoEffects"
            >
              {{ creativeUiText('clearAllEffects') }}
            </button>
          </div>
          <div class="creative-cat-pills">
            <button
              v-for="cat in TIMELINE_VISUAL_EFFECT_CATEGORIES"
              :key="cat.id"
              type="button"
              class="creative-cat-pill"
              :class="{ active: activeVisualEffectCategory === cat.id }"
              @click="activeVisualEffectCategory = cat.id"
            >
              <svg class="creative-pill-icon" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path
                  :d="cat.iconPath"
                  stroke="currentColor"
                  stroke-width="1.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
              <span>{{ isZhLocale ? cat.labelZh : cat.labelEn }}</span>
            </button>
          </div>
          <div class="creative-intensity-row">
            <span>{{ creativeUiText('effectIntensityLabel') }}</span>
            <input
              type="range"
              min="0"
              max="100"
              step="1"
              :value="targetCreativeClip?.effectIntensity ?? 75"
              @input="
                onCreativeEffectIntensityInput(Number(($event.target as HTMLInputElement).value))
              "
            />
            <span class="creative-intensity-val"
              >{{ Math.round(targetCreativeClip?.effectIntensity ?? 75) }}%</span
            >
          </div>
          <div class="creative-card-grid">
            <button
              v-for="fx in filteredVisualEffects"
              :key="fx.id"
              type="button"
              class="creative-card"
              :class="{
                active: (targetCreativeClip?.visualEffect ?? 'none') === fx.id
              }"
              :title="isZhLocale ? fx.descZh : fx.descEn"
              @click="onSelectVisualEffect(fx.id)"
            >
              <span
                class="creative-card-swatch"
                :class="`fx-swatch-${fx.id}`"
                :style="{ background: fx.previewGradient }"
              >
                <svg
                  class="creative-swatch-icon"
                  viewBox="0 0 20 20"
                  fill="none"
                  aria-hidden="true"
                  :style="{ color: fx.accent }"
                >
                  <path
                    :d="fx.iconPath"
                    stroke="currentColor"
                    stroke-width="1.55"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                </svg>
                <span class="creative-card-badge" :style="{ borderColor: fx.accent }">{{
                  fx.badge
                }}</span>
              </span>
              <span class="creative-card-title">{{ isZhLocale ? fx.labelZh : fx.labelEn }}</span>
            </button>
          </div>
        </div>

        <!-- 转场 (Transitions) -->
        <div v-else-if="leftBrowserTab === 'transitions'" class="creative-tab-pane">
          <div class="creative-target-bar">
            <span class="creative-target-label">{{ creativeUiText('targetCutPairLabel') }}</span>
            <span
              class="creative-target-name"
              :title="
                activeBrowserTransitionPair
                  ? `${activeBrowserTransitionPair.left.title} → ${activeBrowserTransitionPair.right.title}`
                  : creativeUiText('needTwoClipsForTransition')
              "
            >
              {{
                activeBrowserTransitionPair
                  ? `${activeBrowserTransitionPair.left.title} → ${activeBrowserTransitionPair.right.title}`
                  : creativeUiText('needTwoClipsForTransition')
              }}
            </span>
            <button
              v-if="activeBrowserTransitionPair"
              type="button"
              class="ghost-btn xs-btn"
              @click="previewActiveBrowserTransition"
            >
              {{ creativeUiText('previewTransitionBtn') }}
            </button>
          </div>
          <div class="creative-target-bar">
            <span class="creative-target-label">{{
              creativeUiText('transitionDurationLabel')
            }}</span>
            <div class="creative-duration-pills">
              <button
                v-for="sec in TRANSITION_DURATION_PRESETS"
                :key="sec"
                type="button"
                class="ghost-btn xs-btn"
                :class="{ active: Math.abs(browserTransitionDurationSec - sec) < 0.04 }"
                @click="onChangeBrowserTransitionDuration(sec)"
              >
                {{ sec.toFixed(1) }}s
              </button>
            </div>
          </div>
          <div class="creative-intensity-row">
            <span>{{ creativeUiText('transitionDurationLabel') }}</span>
            <input
              type="range"
              min="0.1"
              :max="activeBrowserTransitionPair?.maxDurationSec ?? 2.5"
              step="0.05"
              :value="browserTransitionDurationSec"
              @input="
                onInputBrowserTransitionDuration(Number(($event.target as HTMLInputElement).value))
              "
              @change="
                onChangeBrowserTransitionDuration(Number(($event.target as HTMLInputElement).value))
              "
            />
            <span class="creative-intensity-val"
              >{{ browserTransitionDurationSec.toFixed(2) }}s</span
            >
          </div>
          <div class="creative-action-bar">
            <button
              type="button"
              class="ghost-btn xs-btn"
              :disabled="clipsOn('video').length < 2"
              @click="applyBrowserTransitionToAllCuts"
            >
              {{ creativeUiText('applyTransitionAll') }}
            </button>
            <button
              type="button"
              class="ghost-btn xs-btn"
              :disabled="clipsOn('video').length < 2"
              @click="clearAllVideoTransitions"
            >
              {{ creativeUiText('clearAllTransitions') }}
            </button>
          </div>
          <div class="creative-cat-pills">
            <button
              v-for="cat in TIMELINE_TRANSITION_CATEGORIES"
              :key="cat.id"
              type="button"
              class="creative-cat-pill"
              :class="{ active: browserTransitionCategory === cat.id }"
              @click="browserTransitionCategory = cat.id"
            >
              <svg class="creative-pill-icon" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path
                  :d="cat.iconPath"
                  stroke="currentColor"
                  stroke-width="1.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
              <span>{{ isZhLocale ? cat.labelZh : cat.labelEn }}</span>
            </button>
          </div>
          <div class="creative-card-grid">
            <button
              v-for="tr in filteredBrowserTransitions"
              :key="tr.id"
              type="button"
              class="creative-card transition-browser-card"
              :class="{ active: activeBrowserTransitionType === tr.id }"
              :title="isZhLocale ? tr.descZh : tr.descEn"
              @click="onSelectBrowserTransition(tr.id, tr.defaultDurationSec)"
            >
              <span :class="['trans-preview-box', `effect-${tr.id}`]" :data-effect="tr.id">
                <span class="trans-preview-a">A</span>
                <span class="trans-preview-b">B</span>
                <svg class="trans-card-icon" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <path
                    :d="tr.iconPath"
                    stroke="currentColor"
                    stroke-width="1.5"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                </svg>
              </span>
              <span class="creative-card-title">{{ isZhLocale ? tr.labelZh : tr.labelEn }}</span>
            </button>
          </div>
        </div>

        <!-- 滤镜 (Filters) -->
        <div v-else-if="leftBrowserTab === 'filters'" class="creative-tab-pane">
          <div class="creative-target-bar" :title="creativeUiText('scopePerClipHint')">
            <span class="creative-target-label">{{ creativeUiText('targetCurrentClip') }}</span>
            <span class="creative-target-name" :title="targetCreativeClip?.title || ''">
              {{ targetCreativeClip ? targetCreativeClip.title : '—' }}
            </span>
            <button
              type="button"
              class="ghost-btn xs-btn"
              :disabled="!hasVideoOrOverlayClips"
              @click="applyCurrentFilterToAllVideoClips"
            >
              {{ creativeUiText('applyToAllClips') }}
            </button>
            <button
              type="button"
              class="ghost-btn xs-btn"
              :disabled="!hasVideoOrOverlayClips"
              @click="clearAllVideoFilters"
            >
              {{ creativeUiText('clearAllFilters') }}
            </button>
          </div>
          <div class="creative-cat-pills">
            <button
              v-for="cat in TIMELINE_FILTER_CATEGORIES"
              :key="cat.id"
              type="button"
              class="creative-cat-pill"
              :class="{ active: activeFilterCategory === cat.id }"
              @click="activeFilterCategory = cat.id"
            >
              <svg class="creative-pill-icon" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path
                  :d="cat.iconPath"
                  stroke="currentColor"
                  stroke-width="1.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
              <span>{{ isZhLocale ? cat.labelZh : cat.labelEn }}</span>
            </button>
          </div>
          <div class="creative-intensity-row">
            <span>{{ creativeUiText('filterIntensityLabel') }}</span>
            <input
              type="range"
              min="0"
              max="100"
              step="1"
              :value="targetCreativeClip?.filterIntensity ?? 100"
              @input="
                onCreativeFilterIntensityInput(Number(($event.target as HTMLInputElement).value))
              "
            />
            <span class="creative-intensity-val"
              >{{ Math.round(targetCreativeClip?.filterIntensity ?? 100) }}%</span
            >
          </div>
          <div class="creative-card-grid">
            <button
              v-for="lut in filteredFilterPresets"
              :key="lut.id"
              type="button"
              class="creative-card"
              :class="{
                active: (targetCreativeClip?.filterPreset ?? 'none') === lut.id
              }"
              :title="isZhLocale ? lut.descZh : lut.descEn"
              @click="onSelectFilterPreset(lut.id)"
            >
              <span class="creative-card-swatch" :style="{ background: lut.previewGradient }">
                <svg
                  class="creative-swatch-icon"
                  viewBox="0 0 20 20"
                  fill="none"
                  aria-hidden="true"
                  :style="{ color: lut.accent }"
                >
                  <path
                    :d="lut.iconPath"
                    stroke="currentColor"
                    stroke-width="1.55"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                </svg>
                <span class="creative-card-badge" :style="{ borderColor: lut.accent }">{{
                  lut.badge
                }}</span>
              </span>
              <span class="creative-card-title">{{ isZhLocale ? lut.labelZh : lut.labelEn }}</span>
            </button>
          </div>
        </div>

        <!-- 调节 (Adjustments) -->
        <div v-else-if="leftBrowserTab === 'adjustments'" class="creative-tab-pane">
          <div class="creative-target-bar">
            <span class="creative-target-label">{{ creativeUiText('targetCurrentClip') }}</span>
            <span class="creative-target-name" :title="targetCreativeClip?.title || ''">
              {{ targetCreativeClip ? targetCreativeClip.title : '—' }}
            </span>
          </div>
          <div class="creative-action-bar">
            <button
              type="button"
              class="ghost-btn xs-btn"
              :disabled="!targetCreativeClip"
              @click="resetClipColorGrade"
            >
              {{ creativeUiText('resetCurrentClip') }}
            </button>
            <button
              type="button"
              class="ghost-btn xs-btn"
              :disabled="!hasVideoOrOverlayClips"
              @click="applyAdjustmentsToAllVideoClips"
            >
              {{ creativeUiText('applyToAllClips') }}
            </button>
          </div>
          <div class="creative-adjustment-list">
            <div
              v-for="ctrl in TIMELINE_ADJUSTMENT_CONTROLS"
              :key="ctrl.key"
              class="creative-adjustment-item"
            >
              <div class="creative-adjustment-head">
                <span class="creative-adjustment-label">
                  <svg class="creative-adj-icon" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                    <path
                      :d="ctrl.iconPath"
                      stroke="currentColor"
                      stroke-width="1.5"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    />
                  </svg>
                  <span>{{ isZhLocale ? ctrl.labelZh : ctrl.labelEn }}</span>
                </span>
                <span class="creative-adjustment-val">{{
                  ctrl.formatDisplay(getClipAdjustmentValue(targetCreativeClip, ctrl.key))
                }}</span>
              </div>
              <input
                type="range"
                class="creative-adjustment-slider"
                :min="ctrl.min"
                :max="ctrl.max"
                :step="ctrl.step"
                :value="getClipAdjustmentValue(targetCreativeClip, ctrl.key)"
                @input="
                  onCreativeAdjustmentInput(
                    ctrl.key,
                    Number(($event.target as HTMLInputElement).value)
                  )
                "
                @dblclick="onCreativeAdjustmentInput(ctrl.key, ctrl.defaultValue)"
              />
            </div>
          </div>
        </div>

        <!-- 模板 (Templates) -->
        <div v-else-if="leftBrowserTab === 'templates'" class="creative-tab-pane">
          <div class="creative-template-hint">
            {{ creativeUiText('templateEmptyAutoFillHint') }}
          </div>
          <div class="creative-template-list">
            <div
              v-for="tpl in TIMELINE_CREATIVE_TEMPLATES"
              :key="tpl.id"
              class="creative-template-card"
            >
              <div class="creative-template-banner" :style="{ background: tpl.previewGradient }">
                <span
                  class="creative-template-icon-wrap"
                  :style="{ borderColor: tpl.accent, color: tpl.accent }"
                >
                  <svg
                    class="creative-template-icon"
                    viewBox="0 0 20 20"
                    fill="none"
                    aria-hidden="true"
                  >
                    <path
                      :d="tpl.iconPath"
                      stroke="currentColor"
                      stroke-width="1.55"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    />
                  </svg>
                </span>
                <span class="creative-card-badge" :style="{ borderColor: tpl.accent }">{{
                  tpl.badge
                }}</span>
                <span class="creative-template-title">{{
                  isZhLocale ? tpl.labelZh : tpl.labelEn
                }}</span>
              </div>
              <div class="creative-template-body">
                <p class="creative-template-desc">
                  {{ isZhLocale ? tpl.descZh : tpl.descEn }}
                </p>
                <div class="creative-template-tags">
                  <span
                    v-for="tag in isZhLocale ? tpl.tagsZh : tpl.tagsEn"
                    :key="tag"
                    class="creative-template-tag"
                  >
                    {{ tag }}
                  </span>
                </div>
                <button
                  type="button"
                  class="export-btn creative-template-apply-btn"
                  @click="onApplyCreativeTemplate(tpl.id)"
                >
                  {{ creativeUiText('applyTemplateBtn') }}
                </button>
              </div>
            </div>
          </div>
        </div>

        <div
          v-if="sourceCtx"
          class="source-ctx-menu"
          :style="{ left: `${sourceCtx.x}px`, top: `${sourceCtx.y}px` }"
          @pointerdown.stop
        >
          <button type="button" @click="createImportedGroup">
            {{ t('script.timeline.createGroup') }}
          </button>
          <button v-if="sourceCtx.groupId" type="button" @click="renameImportedGroup">
            {{ t('script.timeline.renameGroup') }}
          </button>
          <button
            v-if="sourceCtx.groupId"
            type="button"
            class="danger"
            @click="deleteImportedGroup"
          >
            {{ t('script.timeline.deleteGroup') }}
          </button>
        </div>
      </aside>

      <div
        class="horizontal-splitter"
        :title="t('script.timeline.resizeSourcesWidth')"
        @pointerdown="onPanelSplitterDown($event, 'left')"
      />

      <section class="panel preview-panel">
        <div ref="previewStageEl" class="preview-stage">
          <svg class="stage-fx-svg-defs" width="0" height="0" aria-hidden="true">
            <defs>
              <filter
                id="timeline-stage-fx-filter"
                x="-10%"
                y="-10%"
                width="120%"
                height="120%"
                color-interpolation-filters="sRGB"
              >
                <feColorMatrix
                  in="SourceGraphic"
                  type="matrix"
                  :values="activeSvgFilterMeta.colorMatrixValues"
                  result="stepColor"
                />
                <feComponentTransfer
                  v-if="activeSvgFilterMeta.posterizeTable"
                  in="stepColor"
                  result="stepPoster"
                >
                  <feFuncR type="discrete" :tableValues="activeSvgFilterMeta.posterizeTable" />
                  <feFuncG type="discrete" :tableValues="activeSvgFilterMeta.posterizeTable" />
                  <feFuncB type="discrete" :tableValues="activeSvgFilterMeta.posterizeTable" />
                </feComponentTransfer>
                <feMorphology
                  v-if="activeSvgFilterMeta.mosaicRadius > 0"
                  :in="svgFilterPreMosaicInput"
                  operator="dilate"
                  :radius="activeSvgFilterMeta.mosaicRadius"
                  result="stepMosaic"
                />
                <feConvolveMatrix
                  v-if="activeSvgFilterMeta.sharpenAmount > 0.02"
                  :in="svgFilterPreSharpenInput"
                  order="3 3"
                  :kernelMatrix="activeSvgFilterMeta.sharpenKernel"
                  preserveAlpha="true"
                  result="stepSharpen"
                />
                <template v-if="activeSvgFilterMeta.rgbShiftPx > 0.2">
                  <feColorMatrix
                    :in="svgFilterPreRgbInput"
                    type="matrix"
                    values="1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0"
                    result="rChan"
                  />
                  <feOffset
                    in="rChan"
                    :dx="activeSvgFilterMeta.rgbShiftPx"
                    :dy="activeSvgFilterMeta.rgbShiftVerticalPx"
                    result="rShift"
                  />
                  <feColorMatrix
                    :in="svgFilterPreRgbInput"
                    type="matrix"
                    values="0 0 0 0 0 0 1 0 0 0 0 0 0 0 0 0 0 0 1 0"
                    result="gChan"
                  />
                  <feColorMatrix
                    :in="svgFilterPreRgbInput"
                    type="matrix"
                    values="0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0 0 1 0"
                    result="bChan"
                  />
                  <feOffset
                    in="bChan"
                    :dx="-activeSvgFilterMeta.rgbShiftPx"
                    :dy="-activeSvgFilterMeta.rgbShiftVerticalPx"
                    result="bShift"
                  />
                  <feBlend in="rShift" in2="gChan" mode="screen" result="rgBlend" />
                  <feBlend in="rgBlend" in2="bShift" mode="screen" result="finalRgb" />
                </template>
              </filter>
            </defs>
          </svg>
          <img
            v-if="previewSrc && isImageOrGifUrl(previewSrc)"
            class="preview-video"
            :src="previewSrc"
            :style="previewVideoTransitionStyle ?? undefined"
            alt=""
            @load="onPreviewImageLoaded"
          />
          <video
            v-else-if="previewSrc"
            ref="previewEl"
            class="preview-video"
            :src="previewSrc"
            :style="previewVideoTransitionStyle ?? undefined"
            playsinline
            preload="metadata"
            @ended="onPreviewEnded"
            @timeupdate="onPreviewTimeUpdate"
            @loadedmetadata="onPreviewLoaded"
          />
          <div v-else class="preview-empty">
            <span class="play-glyph" aria-hidden="true" />
            <p>{{ t('script.timeline.emptyPreview') }}</p>
          </div>
          <div ref="previewCanvasEl" class="export-frame-overlay" :style="previewFrameStyle">
            <span class="export-frame-label">{{ previewFrameRatioLabel }}</span>
            <div
              v-if="exportPlatform.id !== 'custom' && previewFrameRatioKey === 'export'"
              class="export-safe-area"
              :title="t('script.timeline.safeAreaHint')"
              :style="exportSafeAreaStyle"
            />
            <div class="overlay-layer">
              <img
                v-if="
                  activeMainTransitionClip &&
                  (isImageOrGifClip(activeMainTransitionClip) ||
                    isImageOrGifUrl(transitionOverlayMediaUrl))
                "
                v-show="Boolean(transitionOverlayMediaUrl)"
                class="transition-overlay-video"
                :src="transitionOverlayMediaUrl"
                :style="mainTransitionVideoStyle"
                alt=""
                draggable="false"
              />
              <video
                v-else-if="activeMainTransitionClip"
                :ref="
                  (el) =>
                    bindTransitionVideo(el as HTMLVideoElement | null, activeMainTransitionClipId)
                "
                class="transition-overlay-video"
                :src="transitionOverlayMediaUrl || undefined"
                :style="mainTransitionVideoStyle"
                playsinline
                muted
                preload="auto"
              />
              <template v-for="clip in previewOverlayClips" :key="clip.id">
                <img
                  v-if="isImageOrGifClip(clip)"
                  v-show="isOverlayClipActive(clip)"
                  class="overlay-video overlay-sticker-img"
                  :src="overlayImageSrc(clip)"
                  :style="overlayVideoStyle(clip)"
                  alt=""
                  draggable="false"
                  @pointerdown.stop="onOverlayPointerDown($event, clip)"
                />
                <video
                  v-else
                  v-show="isOverlayClipActive(clip)"
                  :ref="(el) => bindOverlayVideo(el as HTMLVideoElement | null, clip.id)"
                  class="overlay-video"
                  :style="overlayVideoStyle(clip)"
                  playsinline
                  preload="metadata"
                  @pointerdown.stop="onOverlayPointerDown($event, clip)"
                />
              </template>
              <div
                v-if="selectedOverlayClip"
                class="overlay-selection"
                :style="overlaySelectionStyle(selectedOverlayClip)"
              >
                <span
                  class="overlay-handle rotate-top"
                  data-corner="rotate"
                  :title="t('script.timeline.overlayRotate')"
                  @pointerdown.stop="onOverlayPointerDown($event, selectedOverlayClip)"
                />
                <span
                  class="overlay-handle corner-tl"
                  data-corner="tl"
                  @pointerdown.stop="onOverlayPointerDown($event, selectedOverlayClip)"
                />
                <span
                  class="overlay-handle corner-tr"
                  data-corner="tr"
                  @pointerdown.stop="onOverlayPointerDown($event, selectedOverlayClip)"
                />
                <span
                  class="overlay-handle corner-bl"
                  data-corner="bl"
                  @pointerdown.stop="onOverlayPointerDown($event, selectedOverlayClip)"
                />
                <span
                  class="overlay-handle corner-br"
                  data-corner="br"
                  @pointerdown.stop="onOverlayPointerDown($event, selectedOverlayClip)"
                />
              </div>
              <div
                v-if="cropMode && selectedCroppableClip"
                class="crop-box-overlay"
                :style="cropBoxOverlayStyle"
                @pointerdown.stop="onCropPointerDown($event, selectedCroppableClip)"
              >
                <span class="crop-grid-line h1" />
                <span class="crop-grid-line h2" />
                <span class="crop-grid-line v1" />
                <span class="crop-grid-line v2" />
                <span class="crop-size-badge">
                  {{ Math.round(activeCropRect.width * 100) }}% ×
                  {{ Math.round(activeCropRect.height * 100) }}%
                </span>
                <span
                  class="crop-handle corner-tl"
                  data-corner="tl"
                  @pointerdown.stop="onCropPointerDown($event, selectedCroppableClip)"
                />
                <span
                  class="crop-handle corner-tr"
                  data-corner="tr"
                  @pointerdown.stop="onCropPointerDown($event, selectedCroppableClip)"
                />
                <span
                  class="crop-handle corner-bl"
                  data-corner="bl"
                  @pointerdown.stop="onCropPointerDown($event, selectedCroppableClip)"
                />
                <span
                  class="crop-handle corner-br"
                  data-corner="br"
                  @pointerdown.stop="onCropPointerDown($event, selectedCroppableClip)"
                />
                <span
                  class="crop-handle n"
                  data-corner="t"
                  @pointerdown.stop="onCropPointerDown($event, selectedCroppableClip)"
                />
                <span
                  class="crop-handle s"
                  data-corner="b"
                  @pointerdown.stop="onCropPointerDown($event, selectedCroppableClip)"
                />
                <span
                  class="crop-handle w"
                  data-corner="l"
                  @pointerdown.stop="onCropPointerDown($event, selectedCroppableClip)"
                />
                <span
                  class="crop-handle e"
                  data-corner="r"
                  @pointerdown.stop="onCropPointerDown($event, selectedCroppableClip)"
                />
              </div>
              <div v-if="activeVisualOverlayMeta.hasOverlay" class="stage-visual-overlay-stack">
                <div
                  v-if="
                    activeVisualOverlayMeta.splitMode !== 'none' &&
                    previewSrc &&
                    isImageOrGifUrl(previewSrc)
                  "
                  class="stage-visual-split-clones"
                  :class="activeVisualOverlayMeta.splitMode"
                  :style="{ filter: activeSplitCloneFilter }"
                >
                  <img
                    v-for="tileIdx in activeVisualOverlayMeta.splitMode === 'split-4grid'
                      ? 4
                      : activeVisualOverlayMeta.splitMode === 'split-3v'
                        ? 3
                        : 2"
                    :key="`split-tile-${tileIdx}`"
                    :src="previewSrc"
                    class="stage-split-tile-img"
                    alt=""
                    draggable="false"
                  />
                </div>
                <img
                  v-if="
                    activeVisualOverlayMeta.soulOutOpacity > 0.02 &&
                    previewSrc &&
                    isImageOrGifUrl(previewSrc)
                  "
                  :src="previewSrc"
                  class="stage-visual-soul-ghost"
                  :style="{
                    opacity: `${activeVisualOverlayMeta.soulOutOpacity}`,
                    transform: `scale(${activeVisualOverlayMeta.soulOutScale})`,
                    filter: activeSplitCloneFilter
                  }"
                  alt=""
                  draggable="false"
                />
                <div
                  v-if="activeVisualOverlayMeta.bloomOpacity > 0.02"
                  class="stage-visual-bloom"
                  :style="{ opacity: `${activeVisualOverlayMeta.bloomOpacity}` }"
                />
                <div
                  v-if="activeVisualOverlayMeta.lightLeakOpacity > 0.02"
                  class="stage-visual-lightleak"
                  :style="{ opacity: `${activeVisualOverlayMeta.lightLeakOpacity}` }"
                />
                <div
                  v-if="activeVisualOverlayMeta.neonHaloOpacity > 0.02"
                  class="stage-visual-neonhalo"
                  :style="{ opacity: `${activeVisualOverlayMeta.neonHaloOpacity}` }"
                />
                <div
                  v-if="activeVisualOverlayMeta.strobeFlashOpacity > 0.02"
                  class="stage-visual-strobe"
                  :style="{ opacity: `${activeVisualOverlayMeta.strobeFlashOpacity}` }"
                />
                <div
                  v-if="activeVisualOverlayMeta.tiltShiftBlurPx > 0.2"
                  class="stage-visual-tiltshift"
                  :style="{ '--tilt-blur': `${activeVisualOverlayMeta.tiltShiftBlurPx}px` }"
                />
                <div
                  v-if="activeVisualOverlayMeta.sparkleOpacity > 0.02"
                  class="stage-visual-sparkle"
                  :style="{ opacity: `${activeVisualOverlayMeta.sparkleOpacity}` }"
                />
                <div
                  v-if="activeVisualOverlayMeta.glitchSliceOpacity > 0.02"
                  class="stage-visual-glitch-slices"
                  :style="{ opacity: `${activeVisualOverlayMeta.glitchSliceOpacity}` }"
                />
                <div
                  v-if="activeVisualOverlayMeta.scanlinesOpacity > 0.02"
                  class="stage-visual-scanlines"
                  :style="{ opacity: `${activeVisualOverlayMeta.scanlinesOpacity}` }"
                />
                <div
                  v-if="activeVisualOverlayMeta.grainOpacity > 0.02"
                  class="stage-visual-grain"
                  :style="{ opacity: `${activeVisualOverlayMeta.grainOpacity}` }"
                />
                <div
                  v-if="activeVisualOverlayMeta.vignetteOpacity > 0.02"
                  class="stage-visual-vignette"
                  :style="{ opacity: `${activeVisualOverlayMeta.vignetteOpacity}` }"
                />
                <div v-if="activeVisualOverlayMeta.dvCamOverlay" class="stage-visual-dvcam">
                  <span class="dv-corner tl" />
                  <span class="dv-corner tr" />
                  <span class="dv-corner bl" />
                  <span class="dv-corner br" />
                  <span class="dv-rec-badge">● REC</span>
                </div>
                <div
                  v-if="activeVisualOverlayMeta.splitMode !== 'none'"
                  class="stage-visual-split-frame"
                  :class="activeVisualOverlayMeta.splitMode"
                />
                <template v-if="activeVisualOverlayMeta.letterboxRatio > 0.01">
                  <div
                    class="stage-visual-letterbox top"
                    :style="{
                      height: `${(activeVisualOverlayMeta.letterboxRatio * 100).toFixed(2)}%`
                    }"
                  />
                  <div
                    class="stage-visual-letterbox bottom"
                    :style="{
                      height: `${(activeVisualOverlayMeta.letterboxRatio * 100).toFixed(2)}%`
                    }"
                  />
                </template>
              </div>
              <div
                v-if="activeSubtitleText"
                class="subtitle-overlay"
                :class="{ 'is-selected': isActiveSubtitleSelected }"
                :title="t('script.timeline.subtitleResizeHint')"
                :style="activeSubtitleOverlayStyle"
                @pointerdown.stop="onSubtitleMoveDown"
                @wheel.prevent="onSubtitleWheel"
              >
                {{ activeSubtitleText }}
                <span
                  class="subtitle-handle corner-tl"
                  :title="t('script.timeline.subtitleScaleHint')"
                  @pointerdown.stop="onSubtitleScaleDown"
                />
                <span
                  class="subtitle-handle corner-tr"
                  :title="t('script.timeline.subtitleScaleHint')"
                  @pointerdown.stop="onSubtitleScaleDown"
                />
                <span
                  class="subtitle-handle corner-bl"
                  :title="t('script.timeline.subtitleScaleHint')"
                  @pointerdown.stop="onSubtitleScaleDown"
                />
                <span
                  class="subtitle-handle corner-br"
                  :title="t('script.timeline.subtitleScaleHint')"
                  @pointerdown.stop="onSubtitleScaleDown"
                />
              </div>
            </div>
          </div>
          <select
            v-model="previewFrameRatioKey"
            class="preview-frame-ratio-select"
            :title="t('script.timeline.previewFrameRatio')"
            @change="scheduleSave"
          >
            <option
              v-for="option in previewFrameRatioOptions"
              :key="option.key"
              :value="option.key"
            >
              {{ option.label }}
            </option>
          </select>
          <div class="preview-transport">
            <button
              type="button"
              class="preview-play-btn"
              :title="
                playing && playMode === 'solo'
                  ? t('script.timeline.pause')
                  : t('script.timeline.playSelected')
              "
              :disabled="!selectedPlayableClip"
              @click="togglePreviewPlay"
            >
              <span :class="playing && playMode === 'solo' ? 'pause' : 'triangle'" />
            </button>
            <span class="time"
              >{{ formatTime(playheadSec) }} / {{ formatTime(totalDuration) }}</span
            >
          </div>
        </div>
      </section>
      <div
        class="horizontal-splitter"
        :title="t('script.timeline.resizeInspectorWidth')"
        @pointerdown="onPanelSplitterDown($event, 'right')"
      />
      <aside class="panel inspector-panel">
        <div class="panel-head">
          <span class="panel-title">{{ t('script.timeline.inspector') }}</span>
        </div>
        <div v-if="selectedClip" class="inspector-body">
          <div class="inspector-track">
            {{ trackLabel(selectedClip.track) }}
          </div>
          <label class="inspector-field">
            <span>{{ t('script.timeline.startSec') }}</span>
            <input
              type="number"
              min="0"
              step="0.1"
              :value="selectedClip.startSec"
              @change="onClipStartChange(Number(($event.target as HTMLInputElement).value))"
            />
          </label>
          <label class="inspector-field">
            <span>{{ t('script.timeline.durationSec') }}</span>
            <input
              type="number"
              min="0.1"
              step="0.1"
              :value="selectedClip.durationSec"
              @change="onClipDurationChange(Number(($event.target as HTMLInputElement).value))"
            />
          </label>
          <label
            v-if="selectedClip.track !== 'subtitle'"
            class="inspector-field"
            :title="t('script.timeline.sourceOffsetSecTip')"
          >
            <span>{{ t('script.timeline.sourceOffsetSec') }}</span>
            <input
              type="number"
              min="0"
              step="0.1"
              :value="selectedClip.sourceOffsetSec ?? 0"
              @change="onClipSourceOffsetChange(Number(($event.target as HTMLInputElement).value))"
            />
          </label>
          <label
            v-if="selectedClip.track !== 'subtitle'"
            class="inspector-field"
            :title="t('script.timeline.clipSpeedHint')"
          >
            <span>{{ t('script.timeline.clipSpeed') }}</span>
            <input
              type="number"
              min="0.25"
              max="4"
              step="0.05"
              :value="selectedClip.speed ?? 1"
              @change="onClipSpeedChange(Number(($event.target as HTMLInputElement).value))"
            />
          </label>
          <label
            v-if="selectedClip.track === 'video' || selectedClip.track === 'overlay'"
            class="inspector-field"
            :title="t('script.timeline.clipFreezeTailHint')"
          >
            <span>{{ t('script.timeline.clipFreezeTail') }}</span>
            <input
              type="number"
              min="0"
              max="30"
              step="0.1"
              :value="selectedClip.freezeTailSec ?? 0"
              @change="onClipFreezeTailChange(Number(($event.target as HTMLInputElement).value))"
            />
          </label>
          <template v-if="selectedClip.track === 'video'">
            <template v-if="selectedClip.nodeId">
              <div class="inspector-section-title">
                {{ t('script.timeline.sourceNode') }}
              </div>
              <div class="inspector-source-node">
                <span
                  class="source-node-title"
                  :title="selectedClip.nodeTitle || selectedClip.nodeId"
                  >{{ selectedClip.nodeTitle || selectedClip.nodeId }}</span
                >
                <button
                  type="button"
                  class="ghost-btn inspector-locate-btn"
                  @click="locateClipSourceNode(selectedClip)"
                >
                  {{ t('script.timeline.locateNode') }}
                </button>
              </div>
            </template>
            <div class="inspector-section-title">
              {{ t('script.timeline.reshoot') }}
            </div>
            <div v-if="selectedClipNode" class="inspector-hint">
              {{
                t('script.timeline.reshootSource', {
                  node: selectedClipNode.title?.trim() || selectedClipNode.id
                })
              }}
            </div>
            <button
              v-if="canReshootClip"
              type="button"
              class="ghost-btn clip-reshoot-btn"
              :title="t('script.timeline.reshootHint')"
              @click="reshootSelectedClip"
            >
              {{ t('script.timeline.reshootClip') }}
            </button>
            <div v-else class="inspector-hint">
              {{ t('script.timeline.reshootUnavailable') }}
            </div>
            <template v-if="selectedTransitionPair">
              <div class="inspector-section-title">
                {{ t('script.timeline.transition') }}
              </div>
              <div class="transition-pair-banner">
                {{
                  t('script.timeline.transitionPairLabel', {
                    left: selectedTransitionPair.left.title,
                    right: selectedTransitionPair.right.title
                  })
                }}
              </div>
              <div class="transition-cat-tabs">
                <button
                  v-for="cat in TRANSITION_CATEGORIES"
                  :key="cat.id"
                  type="button"
                  class="transition-cat-tab"
                  :class="{ active: activeTransitionCategory === cat.id }"
                  @click="activeTransitionCategory = cat.id"
                >
                  {{ t(cat.labelKey) }}
                </button>
              </div>
              <div class="transition-card-grid">
                <button
                  v-for="item in filteredTransitionCatalog"
                  :key="item.type"
                  type="button"
                  class="transition-effect-card"
                  :class="{
                    active: selectedTransitionPair.transitionType === item.type
                  }"
                  @click="onSelectPairTransitionType(selectedTransitionPair, item.type)"
                >
                  <span
                    :class="['trans-preview-box', `effect-${item.type}`]"
                    :data-effect="item.type"
                  >
                    <span class="trans-preview-a">A</span>
                    <span class="trans-preview-b">B</span>
                    <svg class="trans-card-icon" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                      <path
                        :d="getTransitionIconPath(item.type)"
                        stroke="currentColor"
                        stroke-width="1.5"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      />
                    </svg>
                  </span>
                  <span class="trans-card-label">{{ transitionItemDisplayLabel(item) }}</span>
                </button>
              </div>
              <template v-if="selectedTransitionPair.transitionType !== 'none'">
                <label class="inspector-field">
                  <span>
                    {{ t('script.timeline.transitionDuration') }}
                    ({{ selectedTransitionPair.durationSec.toFixed(2) }}s)
                  </span>
                  <input
                    type="range"
                    min="0.1"
                    :max="selectedTransitionPair.maxDurationSec"
                    step="0.05"
                    :value="selectedTransitionPair.durationSec"
                    @input="
                      onInputPairTransitionDuration(
                        selectedTransitionPair,
                        Number(($event.target as HTMLInputElement).value)
                      )
                    "
                    @change="
                      onSelectPairTransitionDuration(
                        selectedTransitionPair,
                        Number(($event.target as HTMLInputElement).value)
                      )
                    "
                  />
                </label>
                <div class="transition-preset-pills">
                  <button
                    v-for="presetSec in TRANSITION_DURATION_PRESETS"
                    :key="presetSec"
                    type="button"
                    class="transition-preset-pill"
                    :class="{
                      active: Math.abs(selectedTransitionPair.durationSec - presetSec) < 0.04
                    }"
                    :disabled="presetSec > selectedTransitionPair.maxDurationSec + 0.01"
                    @click="onSelectPairTransitionDuration(selectedTransitionPair, presetSec)"
                  >
                    {{ presetSec.toFixed(1) }}s
                  </button>
                </div>
              </template>
              <div class="transition-inspector-actions">
                <button
                  type="button"
                  class="ghost-btn"
                  :disabled="selectedTransitionPair.transitionType === 'none'"
                  @click="applyCurrentTransitionToAllCuts(selectedTransitionPair)"
                >
                  {{ t('script.timeline.transitionApplyAll') }}
                </button>
                <button
                  v-if="selectedTransitionPair.transitionType !== 'none'"
                  type="button"
                  class="ghost-btn"
                  @click="onSelectPairTransitionType(selectedTransitionPair, 'none')"
                >
                  {{ t('script.timeline.transitionRemove') }}
                </button>
              </div>
            </template>
            <div class="inspector-section-title">
              {{ t('script.timeline.cameraMotionSection') }}
            </div>
            <label class="inspector-field">
              <select
                :value="selectedClip.cameraMotion ?? 'none'"
                @change="
                  onClipCameraMotionChange(
                    ($event.target as HTMLSelectElement).value as TimelineCameraMotionPreset
                  )
                "
              >
                <option v-for="cam in TIMELINE_CAMERA_MOTION_PRESETS" :key="cam" :value="cam">
                  {{ t(`script.timeline.cameraMotion.${cam}`) }}
                </option>
              </select>
            </label>
          </template>
          <template v-if="selectedClip.track === 'video' || selectedClip.track === 'overlay'">
            <div class="inspector-section-title inspector-section-row">
              <span>{{ t('script.timeline.cropSection') }}</span>
              <button
                type="button"
                class="ghost-btn crop-toggle-inline"
                :class="{ active: cropMode }"
                @click="toggleCropMode"
              >
                ⬒ {{ t('script.timeline.cropTool') }}
              </button>
            </div>
            <div class="crop-preset-pills">
              <button
                v-for="preset in CROP_ASPECT_PRESETS"
                :key="preset.key"
                type="button"
                class="transition-preset-pill"
                @click="applyClipCropPreset(preset.key)"
              >
                {{ preset.key === 'free' ? t('script.timeline.cropPresetFree') : preset.label }}
              </button>
            </div>
            <div class="inspector-grid">
              <label class="inspector-field">
                <span>{{ t('script.timeline.cropX') }}</span>
                <input
                  type="number"
                  min="0"
                  max="95"
                  step="1"
                  :value="Math.round(activeCropRect.x * 100)"
                  @change="
                    onClipCropFieldChange(
                      'cropX',
                      Number(($event.target as HTMLInputElement).value) / 100
                    )
                  "
                />
              </label>
              <label class="inspector-field">
                <span>{{ t('script.timeline.cropY') }}</span>
                <input
                  type="number"
                  min="0"
                  max="95"
                  step="1"
                  :value="Math.round(activeCropRect.y * 100)"
                  @change="
                    onClipCropFieldChange(
                      'cropY',
                      Number(($event.target as HTMLInputElement).value) / 100
                    )
                  "
                />
              </label>
            </div>
            <div class="inspector-grid">
              <label class="inspector-field">
                <span>{{ t('script.timeline.cropWidth') }}</span>
                <input
                  type="number"
                  min="5"
                  max="100"
                  step="1"
                  :value="Math.round(activeCropRect.width * 100)"
                  @change="
                    onClipCropFieldChange(
                      'cropWidth',
                      Number(($event.target as HTMLInputElement).value) / 100
                    )
                  "
                />
              </label>
              <label class="inspector-field">
                <span>{{ t('script.timeline.cropHeight') }}</span>
                <input
                  type="number"
                  min="5"
                  max="100"
                  step="1"
                  :value="Math.round(activeCropRect.height * 100)"
                  @change="
                    onClipCropFieldChange(
                      'cropHeight',
                      Number(($event.target as HTMLInputElement).value) / 100
                    )
                  "
                />
              </label>
            </div>
            <button
              type="button"
              class="ghost-btn inspector-reset"
              :disabled="!activeCropRect.isCropped"
              @click="resetClipCrop"
            >
              {{ t('script.timeline.cropReset') }}
            </button>
            <div class="inspector-section-title">
              {{ t('script.timeline.colorGradeTitle') }}
            </div>
            <label class="inspector-field">
              <span>{{ t('script.timeline.colorBrightness') }}</span>
              <input
                type="range"
                min="-0.5"
                max="0.5"
                step="0.02"
                :value="selectedClip.brightness ?? 0"
                @input="
                  onClipColorChange('brightness', Number(($event.target as HTMLInputElement).value))
                "
              />
            </label>
            <label class="inspector-field">
              <span>{{ t('script.timeline.colorContrast') }}</span>
              <input
                type="range"
                min="0.5"
                max="2"
                step="0.05"
                :value="selectedClip.contrast ?? 1"
                @input="
                  onClipColorChange('contrast', Number(($event.target as HTMLInputElement).value))
                "
              />
            </label>
            <label class="inspector-field">
              <span>{{ t('script.timeline.colorSaturation') }}</span>
              <input
                type="range"
                min="0"
                max="2.5"
                step="0.05"
                :value="selectedClip.saturation ?? 1"
                @input="
                  onClipColorChange('saturation', Number(($event.target as HTMLInputElement).value))
                "
              />
            </label>
            <button type="button" class="ghost-btn inspector-reset" @click="resetClipColorGrade">
              {{ t('script.timeline.colorReset') }}
            </button>
          </template>
          <template v-if="selectedClip.track === 'subtitle'">
            <label class="inspector-field">
              <span>{{ t('script.timeline.subtitlePlaceholder') }}</span>
              <textarea
                rows="2"
                :value="selectedClip.text || selectedClip.title"
                @change="onSubtitleTextChange(($event.target as HTMLTextAreaElement).value)"
              />
            </label>
            <label class="inspector-field">
              <span>{{ t('script.timeline.clipSubtitleFontSize') }}</span>
              <input
                type="number"
                min="12"
                max="200"
                step="1"
                :value="selectedClip.fontSize ?? subtitleFontSize"
                @change="
                  onClipSubtitleStyleChange({
                    fontSize: Number(($event.target as HTMLInputElement).value)
                  })
                "
              />
            </label>
            <label class="inspector-field">
              <span>{{ t('script.timeline.clipSubtitleColor') }}</span>
              <input
                type="color"
                class="color-input"
                :value="selectedClip.textColor || subtitleColor"
                @change="
                  onClipSubtitleStyleChange({
                    textColor: ($event.target as HTMLInputElement).value
                  })
                "
              />
            </label>
            <div class="inspector-section-title">
              {{ t('script.timeline.subtitleStyle') }}
            </div>
            <label class="inspector-field">
              <span>{{ t('script.timeline.subtitleFontSize') }}</span>
              <input
                v-model.number="subtitleFontSize"
                type="number"
                min="12"
                max="200"
                step="1"
                @change="scheduleSave"
              />
            </label>
            <label class="inspector-field">
              <span>{{ t('script.timeline.subtitleYOffset') }}</span>
              <input
                v-model.number="subtitleYOffset"
                type="number"
                min="0"
                max="1000"
                step="1"
                @change="scheduleSave"
              />
            </label>
            <label class="inspector-field">
              <span>{{ t('script.timeline.subtitleColor') }}</span>
              <input
                v-model="subtitleColor"
                type="color"
                class="color-input"
                @change="scheduleSave"
              />
            </label>
            <label class="inspector-field">
              <span>{{ t('script.timeline.subtitleBorderColor') }}</span>
              <input
                v-model="subtitleBorderColor"
                type="color"
                class="color-input"
                @change="scheduleSave"
              />
            </label>
            <label class="inspector-field">
              <span>{{ t('script.timeline.subtitleBorderWidth') }}</span>
              <input
                v-model.number="subtitleBorderWidth"
                type="number"
                min="0"
                max="16"
                step="1"
                @change="scheduleSave"
              />
            </label>
            <label class="inspector-field">
              <span>{{ t('script.timeline.subtitleBoxEnabled') }}</span>
              <input v-model="subtitleBoxEnabled" type="checkbox" @change="scheduleSave" />
            </label>
            <template v-if="subtitleBoxEnabled">
              <label class="inspector-field">
                <span>{{ t('script.timeline.subtitleBoxColor') }}</span>
                <input
                  v-model="subtitleBoxColor"
                  type="color"
                  class="color-input"
                  @change="scheduleSave"
                />
              </label>
              <label class="inspector-field">
                <span>{{ t('script.timeline.subtitleBoxOpacity') }}</span>
                <input
                  v-model.number="subtitleBoxOpacity"
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  @change="scheduleSave"
                />
              </label>
            </template>
            <label class="inspector-field">
              <span>{{ t('script.timeline.subtitleMotion') }}</span>
              <select v-model="subtitleMotion" @change="scheduleSave">
                <option value="none">{{ t('script.timeline.subtitleMotionNone') }}</option>
                <option value="fade">{{ t('script.timeline.subtitleMotionFade') }}</option>
              </select>
            </label>
          </template>
          <template v-if="selectedClip.track === 'overlay'">
            <div class="inspector-section-title">
              {{ t('script.timeline.overlayTransform') }}
            </div>
            <div class="inspector-grid">
              <label class="inspector-field">
                <span>{{ t('script.timeline.overlayX') }}</span>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="1"
                  :value="Math.round((selectedClip.overlayX ?? 0.15) * 100)"
                  @change="
                    onOverlayFieldChange(
                      'overlayX',
                      Number(($event.target as HTMLInputElement).value) / 100
                    )
                  "
                />
              </label>
              <label class="inspector-field">
                <span>{{ t('script.timeline.overlayY') }}</span>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="1"
                  :value="Math.round((selectedClip.overlayY ?? 0.15) * 100)"
                  @change="
                    onOverlayFieldChange(
                      'overlayY',
                      Number(($event.target as HTMLInputElement).value) / 100
                    )
                  "
                />
              </label>
            </div>
            <div class="inspector-grid">
              <label class="inspector-field">
                <span>{{ t('script.timeline.overlayWidth') }}</span>
                <input
                  type="number"
                  min="8"
                  max="100"
                  step="1"
                  :value="Math.round((selectedClip.overlayWidth ?? 0.36) * 100)"
                  @change="
                    onOverlayFieldChange(
                      'overlayWidth',
                      Number(($event.target as HTMLInputElement).value) / 100
                    )
                  "
                />
              </label>
              <label class="inspector-field">
                <span>{{ t('script.timeline.overlayHeight') }}</span>
                <input
                  type="number"
                  min="8"
                  max="100"
                  step="1"
                  :value="Math.round((selectedClip.overlayHeight ?? 0.36) * 100)"
                  @change="
                    onOverlayFieldChange(
                      'overlayHeight',
                      Number(($event.target as HTMLInputElement).value) / 100
                    )
                  "
                />
              </label>
            </div>
            <label class="inspector-field">
              <span>{{ t('script.timeline.overlayRotate') }}</span>
              <div class="mixer-slider-row">
                <input
                  type="range"
                  min="-180"
                  max="180"
                  step="1"
                  :value="selectedClip.overlayRotation ?? 0"
                  @input="
                    onOverlayRotationChange(Number(($event.target as HTMLInputElement).value))
                  "
                />
                <input
                  type="number"
                  class="compact-num"
                  min="-360"
                  max="360"
                  step="1"
                  :value="Math.round(selectedClip.overlayRotation ?? 0)"
                  @change="
                    onOverlayRotationChange(Number(($event.target as HTMLInputElement).value))
                  "
                />
              </div>
            </label>
            <label class="inspector-field">
              <span>{{ t('script.timeline.overlayOpacity') }}</span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                :value="selectedClip.opacity ?? 1"
                @input="
                  onOverlayFieldChange('opacity', Number(($event.target as HTMLInputElement).value))
                "
              />
            </label>
            <label v-if="!isImageOrGifClip(selectedClip)" class="inspector-field">
              <span>{{ t('script.timeline.overlayVolume') }}</span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                :value="selectedClip.volume ?? 1"
                @input="
                  onOverlayFieldChange('volume', Number(($event.target as HTMLInputElement).value))
                "
              />
            </label>
            <button type="button" class="ghost-btn inspector-reset" @click="resetOverlayTransform">
              {{ t('script.timeline.overlayReset') }}
            </button>

            <template v-if="selectedClip.stickerId">
              <div class="inspector-section-title">
                {{ t('script.timeline.stickerStyleSection') }}
              </div>
              <label class="inspector-field">
                <span>{{ t('script.timeline.stickerPresetField') }}</span>
                <select
                  :value="selectedClip.stickerId"
                  @change="onOverlayStickerPresetChange(($event.target as HTMLSelectElement).value)"
                >
                  <option v-for="preset in builtinStickers" :key="preset.id" :value="preset.id">
                    {{ t(`script.timeline.stickerPreset.${preset.id}`) }}
                  </option>
                </select>
              </label>
              <div class="inspector-grid">
                <label class="inspector-field">
                  <span>{{ t('script.timeline.stickerTextField') }}</span>
                  <input
                    type="text"
                    maxlength="32"
                    :value="selectedClip.text || selectedClip.title"
                    @change="onOverlayStickerTextChange(($event.target as HTMLInputElement).value)"
                  />
                </label>
                <label class="inspector-field">
                  <span>{{ t('script.timeline.stickerColorField') }}</span>
                  <input
                    type="color"
                    class="color-input"
                    :value="selectedClip.stickerColor || '#ff3b5c'"
                    @input="onOverlayStickerColorChange(($event.target as HTMLInputElement).value)"
                  />
                </label>
              </div>
            </template>

            <div class="inspector-section-title inspector-section-row">
              <span>{{ t('script.timeline.tweenSection') }}</span>
              <button
                v-if="hasOverlayClipTween(selectedClip)"
                type="button"
                class="ghost-btn crop-toggle-inline"
                @click="resetOverlayTweens"
              >
                {{ t('script.timeline.tweenReset') }}
              </button>
            </div>
            <label class="inspector-field">
              <span>{{ t('script.timeline.tweenInLabel') }}</span>
              <select
                :value="selectedClip.tweenIn ?? 'none'"
                @change="
                  onOverlayTweenPatch({
                    tweenIn: ($event.target as HTMLSelectElement).value as TimelineTweenInPreset
                  })
                "
              >
                <option v-for="preset in TIMELINE_TWEEN_IN_PRESETS" :key="preset" :value="preset">
                  {{ t(`script.timeline.tweenIn.${preset}`) }}
                </option>
              </select>
            </label>
            <div
              v-if="selectedClip.tweenIn && selectedClip.tweenIn !== 'none'"
              class="inspector-grid"
            >
              <label class="inspector-field">
                <span>{{ t('script.timeline.tweenInDuration') }}</span>
                <input
                  type="number"
                  min="0.05"
                  max="5"
                  step="0.05"
                  :value="selectedClip.tweenInDurationSec ?? 0.45"
                  @change="
                    onOverlayTweenPatch({
                      tweenInDurationSec: Number(($event.target as HTMLInputElement).value)
                    })
                  "
                />
              </label>
              <label class="inspector-field">
                <span>{{ t('script.timeline.tweenInEase') }}</span>
                <select
                  :value="selectedClip.tweenInEase ?? 'outBack'"
                  @change="
                    onOverlayTweenPatch({
                      tweenInEase: ($event.target as HTMLSelectElement).value as TimelineEaseType
                    })
                  "
                >
                  <option v-for="ease in TIMELINE_EASE_TYPES" :key="ease" :value="ease">
                    {{ t(`script.timeline.ease.${ease}`) }}
                  </option>
                </select>
              </label>
            </div>

            <label class="inspector-field">
              <span>{{ t('script.timeline.tweenLoopLabel') }}</span>
              <select
                :value="selectedClip.tweenLoop ?? 'none'"
                @change="
                  onOverlayTweenPatch({
                    tweenLoop: ($event.target as HTMLSelectElement).value as TimelineTweenLoopPreset
                  })
                "
              >
                <option v-for="preset in TIMELINE_TWEEN_LOOP_PRESETS" :key="preset" :value="preset">
                  {{ t(`script.timeline.tweenLoop.${preset}`) }}
                </option>
              </select>
            </label>
            <div
              v-if="selectedClip.tweenLoop && selectedClip.tweenLoop !== 'none'"
              class="inspector-grid"
            >
              <label class="inspector-field">
                <span>{{ t('script.timeline.tweenLoopSpeed') }}</span>
                <input
                  type="number"
                  min="0.2"
                  max="8"
                  step="0.1"
                  :value="selectedClip.tweenLoopSpeedHz ?? 1.2"
                  @change="
                    onOverlayTweenPatch({
                      tweenLoopSpeedHz: Number(($event.target as HTMLInputElement).value)
                    })
                  "
                />
              </label>
              <label class="inspector-field">
                <span>{{ t('script.timeline.tweenLoopIntensity') }}</span>
                <input
                  type="number"
                  min="0.1"
                  max="3"
                  step="0.1"
                  :value="selectedClip.tweenLoopIntensity ?? 1"
                  @change="
                    onOverlayTweenPatch({
                      tweenLoopIntensity: Number(($event.target as HTMLInputElement).value)
                    })
                  "
                />
              </label>
            </div>

            <label class="inspector-field">
              <span>{{ t('script.timeline.tweenOutLabel') }}</span>
              <select
                :value="selectedClip.tweenOut ?? 'none'"
                @change="
                  onOverlayTweenPatch({
                    tweenOut: ($event.target as HTMLSelectElement).value as TimelineTweenOutPreset
                  })
                "
              >
                <option v-for="preset in TIMELINE_TWEEN_OUT_PRESETS" :key="preset" :value="preset">
                  {{ t(`script.timeline.tweenOut.${preset}`) }}
                </option>
              </select>
            </label>
            <div
              v-if="selectedClip.tweenOut && selectedClip.tweenOut !== 'none'"
              class="inspector-grid"
            >
              <label class="inspector-field">
                <span>{{ t('script.timeline.tweenOutDuration') }}</span>
                <input
                  type="number"
                  min="0.05"
                  max="5"
                  step="0.05"
                  :value="selectedClip.tweenOutDurationSec ?? 0.35"
                  @change="
                    onOverlayTweenPatch({
                      tweenOutDurationSec: Number(($event.target as HTMLInputElement).value)
                    })
                  "
                />
              </label>
              <label class="inspector-field">
                <span>{{ t('script.timeline.tweenOutEase') }}</span>
                <select
                  :value="selectedClip.tweenOutEase ?? 'inBack'"
                  @change="
                    onOverlayTweenPatch({
                      tweenOutEase: ($event.target as HTMLSelectElement).value as TimelineEaseType
                    })
                  "
                >
                  <option v-for="ease in TIMELINE_EASE_TYPES" :key="ease" :value="ease">
                    {{ t(`script.timeline.ease.${ease}`) }}
                  </option>
                </select>
              </label>
            </div>

            <div class="inspector-section-title inspector-section-row">
              <span>
                {{ t('script.timeline.keyframeSection') }}
                <span v-if="selectedClip.keyframes?.length" class="inspector-badge">
                  {{ selectedClip.keyframes.length }}
                </span>
              </span>
              <button
                v-if="selectedClip.keyframes?.length"
                type="button"
                class="ghost-btn crop-toggle-inline"
                @click="clearOverlayKeyframes"
              >
                {{ t('script.timeline.keyframeClearAll') }}
              </button>
            </div>
            <button
              type="button"
              class="ghost-btn keyframe-add-btn"
              @click="addOrUpdateOverlayKeyframeAtPlayhead"
            >
              {{
                hasKeyframeNearPlayhead(selectedClip)
                  ? t('script.timeline.keyframeUpdateAtPlayhead')
                  : t('script.timeline.keyframeAddAtPlayhead')
              }}
            </button>
            <div v-if="selectedClip.keyframes?.length" class="keyframe-list">
              <div
                v-for="(kf, kfIndex) in selectedClip.keyframes"
                :key="`kf-row-${kfIndex}-${kf.offsetSec}`"
                class="keyframe-row"
                :class="{ active: isKeyframeAtPlayhead(selectedClip, kf.offsetSec) }"
              >
                <button
                  type="button"
                  class="keyframe-time-pill"
                  :title="t('script.timeline.keyframeJumpHint')"
                  @click="seekToClipKeyframe(selectedClip, kf)"
                >
                  ◆ {{ kf.offsetSec.toFixed(2) }}s
                </button>
                <select
                  class="keyframe-ease-select"
                  :value="kf.ease ?? 'outCubic'"
                  @change="
                    onOverlayKeyframeEaseChange(
                      kf.offsetSec,
                      ($event.target as HTMLSelectElement).value as TimelineEaseType
                    )
                  "
                >
                  <option v-for="ease in TIMELINE_EASE_TYPES" :key="ease" :value="ease">
                    {{ t(`script.timeline.ease.${ease}`) }}
                  </option>
                </select>
                <button
                  type="button"
                  class="keyframe-del-btn"
                  :title="t('script.timeline.keyframeRemoveHint')"
                  @click="removeOverlayKeyframe(kf.offsetSec)"
                >
                  ×
                </button>
              </div>
              <div class="inspector-hint">
                {{ t('script.timeline.keyframeAutoHint') }}
              </div>
            </div>
            <div v-else class="inspector-hint">
              {{ t('script.timeline.keyframeEmptyHint') }}
            </div>
          </template>
          <template
            v-if="
              selectedClip.track === 'video' ||
              selectedClip.track === 'voice' ||
              selectedClip.track === 'music' ||
              selectedClip.track === 'sfx'
            "
          >
            <label class="inspector-field">
              <span>{{ t('script.timeline.volume') }}</span>
              <input
                type="range"
                min="0"
                max="2"
                step="0.05"
                :value="selectedClip.volume ?? 1"
                @input="onAudioVolumeChange(Number(($event.target as HTMLInputElement).value))"
              />
            </label>
            <label class="inspector-field">
              <span>{{ t('script.timeline.fadeIn') }}</span>
              <input
                type="number"
                min="0"
                :max="selectedClip.durationSec"
                step="0.1"
                :value="selectedClip.fadeInSec ?? 0"
                @change="
                  onAudioFadeChange('fadeInSec', Number(($event.target as HTMLInputElement).value))
                "
              />
            </label>
            <label class="inspector-field">
              <span>{{ t('script.timeline.fadeOut') }}</span>
              <input
                type="number"
                min="0"
                :max="selectedClip.durationSec"
                step="0.1"
                :value="selectedClip.fadeOutSec ?? 0"
                @change="
                  onAudioFadeChange('fadeOutSec', Number(($event.target as HTMLInputElement).value))
                "
              />
            </label>
          </template>
        </div>
        <div v-else class="inspector-body">
          <div class="inspector-section-title">
            {{ t('script.timeline.exportSettings') }}
          </div>
          <label class="inspector-field">
            <span>{{ t('script.timeline.exportResolution') }}</span>
            <select
              :value="exportResolutionKey"
              :disabled="exportPlatformId !== 'custom'"
              @change="onExportResolutionChange(($event.target as HTMLSelectElement).value)"
            >
              <option
                v-for="res in EXPORT_RESOLUTIONS"
                :key="res.label"
                :value="`${res.w}x${res.h}`"
              >
                {{ res.label }}
              </option>
              <option value="custom">{{ t('script.timeline.customResolution') }}</option>
            </select>
          </label>
          <div class="export-custom-grid">
            <label class="inspector-field">
              <span>{{ t('script.timeline.exportWidthField') }}</span>
              <input
                v-model.number="exportWidth"
                type="number"
                min="320"
                max="7680"
                step="2"
                :disabled="!isCustomResolution"
              />
            </label>
            <label class="inspector-field">
              <span>{{ t('script.timeline.exportHeightField') }}</span>
              <input
                v-model.number="exportHeight"
                type="number"
                min="180"
                max="4320"
                step="2"
                :disabled="!isCustomResolution"
              />
            </label>
          </div>
          <label class="inspector-field">
            <span>{{ t('script.timeline.exportFps') }}</span>
            <select v-model.number="exportFps" @change="scheduleSave">
              <option v-for="fps in EXPORT_FPS_OPTIONS" :key="fps" :value="fps">
                {{ fps }}
              </option>
            </select>
          </label>
          <label class="inspector-field">
            <span>{{ t('script.timeline.exportBitrate') }}</span>
            <input
              v-model.number="exportVideoBitrateKbps"
              type="number"
              min="500"
              max="200000"
              step="500"
              @change="scheduleSave"
            />
          </label>
          <label class="inspector-field">
            <span>{{ t('script.timeline.scaleMode') }}</span>
            <select v-model="scaleMode" @change="scheduleSave">
              <option value="contain">{{ t('script.timeline.scaleModeContain') }}</option>
              <option value="cover">{{ t('script.timeline.scaleModeCover') }}</option>
              <option value="blur">{{ t('script.timeline.scaleModeBlur') }}</option>
            </select>
          </label>
        </div>
      </aside>
    </div>

    <div
      class="vertical-splitter"
      :title="t('script.pane.resizeSplit')"
      @pointerdown="onVerticalSplitterDown"
    />

    <section
      class="timeline-dock"
      :class="{ collapsed: timelineCollapsed }"
      :style="timelineCollapsed ? undefined : { height: `${timelineHeight}px` }"
    >
      <header ref="timelineBarEl" class="timeline-bar">
        <div class="timeline-controls" @pointerdown.stop>
          <label class="ctrl-field" :title="t('script.timeline.durationHint')">
            <span>{{ t('script.timeline.duration') }}</span>
            <input
              v-model.number="durationInputSec"
              class="ctrl-input"
              type="number"
              min="1"
              max="3600"
              step="1"
              @change="commitDuration"
            />
            <span class="ctrl-unit">s</span>
          </label>
          <label class="ctrl-field">
            <span>{{ t('script.timeline.rate') }}</span>
            <select v-model.number="playbackRate" class="ctrl-select" @change="onRateChange">
              <option v-for="rate in PLAYBACK_RATE_OPTIONS" :key="rate" :value="rate">
                {{ rate }}x
              </option>
            </select>
          </label>
          <label
            class="ctrl-field track-height-control"
            :title="t('script.timeline.trackHeightHint')"
          >
            <span>{{ t('script.timeline.trackHeight') }}</span>
            <input
              v-model.number="trackHeight"
              type="range"
              min="36"
              max="96"
              step="2"
              @change="scheduleSave"
            />
            <span class="ctrl-unit">{{ trackHeight }}px</span>
          </label>
          <label class="ctrl-check">
            <input v-model="loopPlayback" type="checkbox" @change="scheduleSave" />
            <span>{{ t('script.timeline.loop') }}</span>
          </label>
          <button
            type="button"
            class="ghost-btn"
            :title="t('script.timeline.toStart')"
            @click="seekToStart"
          >
            ⏮
          </button>
          <button
            type="button"
            class="ghost-btn"
            :title="t('script.timeline.prevCut')"
            @click="seekPrevCut"
          >
            |[
          </button>
          <button
            type="button"
            class="ghost-btn"
            :title="t('script.timeline.stepFrameBack')"
            @click="stepFrame(-1)"
          >
            ‹
          </button>
          <button
            type="button"
            class="ghost-btn"
            :title="
              playing && playMode === 'timeline'
                ? t('script.timeline.pause')
                : t('script.timeline.playTimeline')
            "
            @click="toggleTimelinePlay"
          >
            {{ playing && playMode === 'timeline' ? '⏸' : '▶' }}
          </button>
          <button
            type="button"
            class="ghost-btn"
            :title="t('script.timeline.stepFrameForward')"
            @click="stepFrame(1)"
          >
            ›
          </button>
          <button
            type="button"
            class="ghost-btn"
            :title="t('script.timeline.nextCut')"
            @click="seekNextCut"
          >
            ]|
          </button>
          <button
            type="button"
            class="ghost-btn"
            :title="t('script.timeline.zoomFit')"
            @click="zoomFit"
          >
            {{ t('script.timeline.zoomFit') }}
          </button>
          <button
            type="button"
            class="ghost-btn"
            :class="{ active: razorMode }"
            :title="t('script.timeline.razorToolHint')"
            @click="toggleRazorMode"
          >
            🗡 {{ t('script.timeline.razorTool') }}
          </button>
          <button
            type="button"
            class="ghost-btn"
            :disabled="!canSplitActiveClip"
            :title="t('script.timeline.splitClip')"
            @click="splitSelectedClipAtPlayhead"
          >
            ✂
          </button>
          <button
            type="button"
            class="ghost-btn"
            :disabled="!canTrimInAtPlayhead"
            :title="t('script.timeline.trimInToPlayheadHint')"
            @click="trimActiveClipAtPlayhead('in')"
          >
            {{ t('script.timeline.trimInToPlayhead') }}
          </button>
          <button
            type="button"
            class="ghost-btn"
            :disabled="!canTrimOutAtPlayhead"
            :title="t('script.timeline.trimOutToPlayheadHint')"
            @click="trimActiveClipAtPlayhead('out')"
          >
            {{ t('script.timeline.trimOutToPlayhead') }}
          </button>
          <button
            type="button"
            class="ghost-btn"
            :class="{ active: cropMode }"
            :disabled="!canCropSelectedClip"
            :title="t('script.timeline.cropToolHint')"
            @click="toggleCropMode"
          >
            ⬒ {{ t('script.timeline.cropTool') }}
          </button>
          <button
            type="button"
            class="ghost-btn"
            :disabled="!selectedClips.length"
            :title="t('script.timeline.rippleDeleteHint')"
            @click="rippleDeleteSelectedClips"
          >
            ⌫ {{ t('script.timeline.rippleDelete') }}
          </button>
          <button
            type="button"
            class="ghost-btn"
            :disabled="!clips.length"
            :title="t('script.timeline.closeGapsHint')"
            @click="closeTrackGaps"
          >
            ⇄ {{ t('script.timeline.closeGaps') }}
          </button>
          <button
            type="button"
            class="ghost-btn"
            :disabled="!canCopyClips"
            :title="t('script.timeline.copyClip')"
            @click="copySelectedClips"
          >
            ⧉
          </button>
          <button
            type="button"
            class="ghost-btn"
            :disabled="!canPasteClips"
            :title="t('script.timeline.pasteClip')"
            @click="pasteClips"
          >
            ▣
          </button>
          <span class="zoom-readout">{{ Math.round(zoomFactor * 100) }}%</span>
          <button
            type="button"
            class="ghost-btn"
            :title="t('script.timeline.mixerHint')"
            @click="openMixer"
          >
            🎚 {{ t('script.timeline.mixer') }}
          </button>
          <button
            type="button"
            class="export-btn"
            :disabled="exporting || !clips.length"
            :title="t('script.timeline.exportHint')"
            @click="openExportDialog"
          >
            {{
              exporting
                ? t('script.timeline.exporting', {
                    progress: Math.round(exportProgress * 100)
                  })
                : t('script.timeline.export')
            }}
          </button>
          <button
            type="button"
            class="ghost-btn"
            :disabled="subtitling || !canTranscribeVoice"
            :title="t('script.timeline.subtitleFromVoiceHint')"
            @click="transcribeVoiceToSubtitles"
          >
            {{
              subtitling
                ? t('script.timeline.subtitleFromVoiceWorking')
                : t('script.timeline.subtitleFromVoice')
            }}
          </button>
          <button
            type="button"
            class="ghost-btn"
            :disabled="separatingAudio || !canSeparateAudio"
            :title="t('script.timeline.separateAudioHint')"
            @click="separateClipAudio"
          >
            {{
              separatingAudio
                ? t('script.timeline.separateAudioWorking')
                : t('script.timeline.separateAudio')
            }}
          </button>
          <button
            type="button"
            class="ghost-btn"
            :disabled="!canExportSrt"
            :title="t('script.timeline.exportSrt')"
            @click="exportSubtitles"
          >
            SRT
          </button>
          <button
            type="button"
            class="ghost-btn"
            :disabled="!clips.length"
            :title="t('script.timeline.exportFcpxmlHint')"
            @click="exportFcpxml"
          >
            {{ t('script.timeline.exportFcpxml') }}
          </button>
          <button
            type="button"
            class="ghost-btn"
            :disabled="!clips.length"
            :title="t('script.timeline.exportCapCutHint')"
            @click="exportCapCutDraft"
          >
            {{ t('script.timeline.exportCapCut') }}
          </button>
        </div>
        <GraphToolbarCollapseBtn v-model="timelineCollapsed" />
      </header>

      <div
        v-show="!timelineCollapsed"
        ref="timelineBoardEl"
        class="timeline-board"
        :class="{ scrollable: needsHScroll, 'razor-mode': razorMode }"
        @wheel.prevent="onTimelineWheel"
        @pointerdown="onTimelineBlankPointerDown"
      >
        <div
          class="timeline-inner"
          :style="{
            width: `${TRACK_LABEL_W + laneWidth}px`,
            height: `${timelineInnerHeight}px`,
            '--track-height': `${trackHeight}px`,
            '--bottom-pad': `${TIMELINE_BOTTOM_PAD}px`
          }"
        >
          <div class="ruler-row">
            <div class="track-label gutter" />
            <div class="ruler" @pointerdown="onRulerPointerDown">
              <span
                v-for="mark in rulerMarks"
                :key="mark.t"
                class="ruler-tick"
                :style="{ left: `${mark.x}px` }"
              />
              <span
                v-for="mark in rulerMarks"
                :key="`lbl-${mark.t}`"
                class="ruler-mark"
                :class="{ start: mark.t === 0, end: mark.isEnd }"
                :style="{ left: `${mark.x}px` }"
              >
                {{ mark.label }}
              </span>
            </div>
          </div>

          <div
            v-for="track in tracks"
            :key="track.kind"
            class="track-row droppable"
            :data-track-kind="track.kind"
            :style="{
              height: collapsedTracks.has(track.kind) ? '24px' : `${trackHeight}px`
            }"
            :class="{
              'drag-over': dragOverTrack === track.kind,
              'hidden-track': hiddenTracks.has(track.kind),
              'muted-track': mutedTracks.has(track.kind),
              'locked-track': lockedTracks.has(track.kind),
              'collapsed-track': collapsedTracks.has(track.kind)
            }"
            @dragenter.prevent="onTrackDragOver($event, track.kind)"
            @dragover.prevent="onTrackDragOver($event, track.kind)"
            @dragleave="onTrackDragLeave($event, track.kind)"
            @drop.prevent="onTrackDrop($event, track.kind)"
          >
            <div class="track-label">
              <span>{{ track.label }}</span>
              <button
                v-if="trackHasAudio(track.kind)"
                type="button"
                class="track-state-btn track-mute-btn"
                :class="{ 'muted-on': isTrackMuted(track.kind) }"
                :title="
                  isTrackMuted(track.kind)
                    ? t('script.timeline.unmuteTrack')
                    : t('script.timeline.muteTrack')
                "
                @click.stop="toggleTrackMuted(track.kind)"
              >
                {{ isTrackMuted(track.kind) ? '🔇' : '🔊' }}
              </button>
              <button
                type="button"
                class="track-state-btn track-collapse-btn"
                :title="
                  hiddenTracks.has(track.kind)
                    ? t('script.timeline.showTrack')
                    : t('script.timeline.hideTrack')
                "
                @click.stop="toggleTrackHidden(track.kind)"
              >
                <span class="eye-icon" :class="{ off: hiddenTracks.has(track.kind) }">👁</span>
              </button>
              <button
                type="button"
                class="track-state-btn"
                :title="
                  lockedTracks.has(track.kind)
                    ? t('script.timeline.unlockTrack')
                    : t('script.timeline.lockTrack')
                "
                @click.stop="toggleTrackLocked(track.kind)"
              >
                {{ lockedTracks.has(track.kind) ? '🔒' : '🔓' }}
              </button>
              <button
                type="button"
                class="track-state-btn"
                :title="
                  collapsedTracks.has(track.kind)
                    ? t('script.timeline.expandTrack')
                    : t('script.timeline.collapseTrack')
                "
                @click.stop="toggleTrackCollapsed(track.kind)"
              >
                <span
                  class="track-collapse-glyph"
                  :class="{ collapsed: collapsedTracks.has(track.kind) }"
                />
              </button>
            </div>
            <div v-show="!collapsedTracks.has(track.kind)" class="track-lane">
              <template v-if="track.kind === 'video' && !clipsOn(track.kind).length">
                <div class="lane-empty">
                  <span class="play-glyph sm" aria-hidden="true" />
                  <span>{{ t('script.timeline.videoEmpty') }}</span>
                </div>
              </template>
              <template v-else-if="track.kind === 'overlay' && !clipsOn(track.kind).length">
                <div class="lane-muted">
                  <span>{{ t('script.timeline.overlayEmpty') }}</span>
                </div>
              </template>
              <template v-else-if="track.kind === 'voice' && !clipsOn(track.kind).length">
                <div class="lane-muted">
                  <span class="speaker" aria-hidden="true" />
                  <span>{{ t('script.timeline.voiceEmpty') }}</span>
                </div>
              </template>
              <template v-else-if="track.kind === 'subtitle' && !clipsOn(track.kind).length">
                <div class="lane-muted">
                  <span>{{ t('script.timeline.subtitleEmpty') }}</span>
                </div>
                <button type="button" class="create-hint" @click="addBlankSubtitle">
                  {{ t('script.timeline.addSubtitle') }}
                </button>
              </template>
              <template v-else-if="track.kind === 'music' && !clipsOn(track.kind).length">
                <div class="lane-muted">
                  <span>{{ t('script.timeline.musicEmpty') }}</span>
                </div>
              </template>
              <template v-else-if="track.kind === 'sfx' && !clipsOn(track.kind).length">
                <div class="lane-muted">
                  <span>{{ t('script.timeline.sfxEmpty') }}</span>
                </div>
              </template>
              <button
                v-for="clip in visibleClipsOn(track.kind)"
                :key="clip.id"
                type="button"
                class="clip"
                :class="{
                  active: clip.id === activeClipId,
                  selected: selectedClipIds.has(clip.id),
                  subtitle: clip.track === 'subtitle',
                  overlay: clip.track === 'overlay',
                  dragging: clipDrag?.clipId === clip.id
                }"
                :style="clipVisualStyle(clip)"
                @pointerdown.stop="onClipPointerDown($event, clip)"
                @pointermove="onClipPointerHover($event, clip)"
                @pointerleave="onClipPointerLeave(clip)"
                @dblclick.stop="onClipDblClick(clip)"
              >
                <span v-if="isAudioClip(clip)" class="clip-wave" :style="clipWaveStyle(clip)" />
                <span
                  v-if="razorMode && razorHover?.clipId === clip.id"
                  class="razor-cut-line"
                  :style="{ left: `${razorHover.localX}px` }"
                >
                  <span class="razor-cut-time">{{ formatSubsecond(razorHover.timeSec) }}</span>
                </span>
                <span
                  class="clip-handle left"
                  @pointerdown.stop="onClipResizeStart($event, clip, 'left')"
                />
                <span class="clip-title" :class="{ 'on-media': clipHasVisual(clip) }">{{
                  clipDisplayTitle(clip)
                }}</span>
                <span
                  v-if="isClipCropped(clip)"
                  class="clip-cropped-badge"
                  :title="t('script.timeline.cropActiveBadge')"
                >
                  ⬒
                </span>
                <span
                  v-if="clipHasTweenBadge(clip)"
                  class="clip-tween-badge"
                  :title="t('script.timeline.tweenBadgeHint')"
                >
                  ✦
                </span>
                <span
                  v-if="clipCreativeBadgeText(clip)"
                  class="clip-creative-badge"
                  :title="clipCreativeBadgeText(clip)"
                >
                  {{ clipCreativeBadgeText(clip) }}
                </span>
                <span
                  v-for="(kf, kfIdx) in clip.keyframes ?? []"
                  :key="`kf-mark-${kfIdx}-${kf.offsetSec}`"
                  class="clip-keyframe-diamond"
                  :class="{ active: isKeyframeAtPlayhead(clip, kf.offsetSec) }"
                  :style="{
                    left: `${Math.min(98, Math.max(2, (kf.offsetSec / Math.max(0.1, clip.durationSec)) * 100)).toFixed(2)}%`
                  }"
                  :title="`◆ ${kf.offsetSec.toFixed(2)}s (${kf.ease ?? 'outCubic'})`"
                  @pointerdown.stop="seekToClipKeyframe(clip, kf)"
                >
                  ◆
                </span>
                <button
                  v-if="clip.nodeId"
                  type="button"
                  class="clip-source-locate"
                  :title="t('script.timeline.locateNodeHint')"
                  @pointerdown.stop
                  @click.stop="locateClipSourceNode(clip)"
                >
                  ⧉
                </button>
                <span
                  class="clip-handle right"
                  @pointerdown.stop="onClipResizeStart($event, clip, 'right')"
                />
                <span
                  v-if="clip.track === 'video' && clip.nodeId"
                  class="clip-reshoot"
                  :title="t('script.timeline.reshootClip')"
                  @pointerdown.stop
                  @click.stop="reshootClipFromCard(clip)"
                >
                  ⟲
                </span>
                <span
                  class="clip-remove"
                  :title="t('script.timeline.removeClip')"
                  @pointerdown.stop
                  @click.stop="removeClip(clip.id)"
                >
                  ×
                </span>
              </button>
              <template v-if="track.kind === 'video' && !hiddenTracks.has('video')">
                <button
                  v-for="handle in videoTransitionHandles"
                  :key="`transition:${handle.left.id}:${handle.right.id}`"
                  type="button"
                  class="transition-handle"
                  :class="{
                    active: handle.durationSec > 0,
                    selected:
                      transitionPopover?.leftId === handle.left.id &&
                      transitionPopover?.rightId === handle.right.id
                  }"
                  :title="
                    handle.durationSec > 0
                      ? t('script.timeline.transitionJunctionHint')
                      : t('script.timeline.transitionCutAddHint')
                  "
                  :style="transitionHandleStyle(handle)"
                  @pointerdown.stop="onTransitionHandlePointerDown($event, handle)"
                >
                  <span v-if="handle.durationSec > 0" class="transition-overlap-pattern" />
                  <span v-if="handle.durationSec > 0" class="transition-zone-edge left" />
                  <span class="transition-junction-pill">
                    <span class="transition-bowtie">⋈</span>
                    <span v-if="handle.durationSec > 0" class="transition-junction-label">
                      {{ transitionShortLabel(handle.transitionType) }}
                      {{ handle.durationSec.toFixed(1) }}s
                    </span>
                  </span>
                  <span v-if="handle.durationSec > 0" class="transition-zone-edge right" />
                </button>
              </template>
            </div>
          </div>

          <div class="timeline-bottom-pad" aria-hidden="true" />

          <div
            v-if="clipDragPreview && clipDragPreviewClip"
            class="clip-drag-ghost"
            :style="clipDragPreviewStyle"
          >
            <span class="clip-title">{{ clipDisplayTitle(clipDragPreviewClip) }}</span>
          </div>
          <div
            v-if="clipDragPreview"
            class="clip-insert-line"
            :style="{ left: `${TRACK_LABEL_W + timeToX(clipDragPreview.startSec)}px` }"
          />
          <div
            class="playhead"
            :style="{ left: `${TRACK_LABEL_W + timeToX(playheadSec)}px` }"
            aria-hidden="true"
            @pointerdown.stop="onPlayheadPointerDown"
          >
            <span class="playhead-cap" />
          </div>
        </div>
      </div>
    </section>

    <div v-if="exportDialogOpen" class="export-settings-mask" @click.self="closeExportDialog">
      <div class="export-settings-panel" role="dialog" aria-modal="true">
        <div class="export-settings-title">
          {{ t('script.timeline.exportSettings') }}
        </div>
        <label class="inspector-field">
          <span>{{ t('script.timeline.exportPlatform') }}</span>
          <select
            :value="exportPlatformId"
            @change="onExportPlatformChange(($event.target as HTMLSelectElement).value)"
          >
            <option v-for="platform in EXPORT_PLATFORMS" :key="platform.id" :value="platform.id">
              {{ t(`script.timeline.platform.${platform.nameKey}`) }}
              <template v-if="platform.id !== 'custom'">
                — {{ t(`script.timeline.platform.${platform.frame}`) }} {{ platform.width }} ×
                {{ platform.height }}
              </template>
            </option>
          </select>
        </label>
        <div v-if="exportPlatform.id !== 'custom'" class="export-platform-info">
          <span>
            {{
              t('script.timeline.platformSpec', {
                width: exportPlatform.width,
                height: exportPlatform.height,
                fps: exportPlatform.fps,
                bitrate: Math.round(exportPlatform.videoBitrateKbps / 1000)
              })
            }}
          </span>
          <span v-if="Number.isFinite(exportPlatform.maxDurationSec)">
            {{
              t('script.timeline.platformMaxDuration', {
                maxSec: Math.round(exportPlatform.maxDurationSec / 60)
              })
            }}
          </span>
          <span v-if="exportDurationOverLimit" class="export-platform-warning">
            {{
              t('script.timeline.platformTooLong', {
                maxSec: Math.round(exportPlatform.maxDurationSec / 60),
                curSec: Math.round(totalDuration)
              })
            }}
          </span>
        </div>
        <div v-if="exportCompliance.warnings.length" class="export-compliance">
          <span
            v-for="warning in exportCompliance.warnings"
            :key="warning"
            class="export-compliance-item"
          >
            ⚠ {{ warning }}
          </span>
        </div>
        <div v-else-if="exportPlatform.id !== 'custom'" class="export-compliance ok">
          <span>{{ t('script.timeline.exportCheckPass') }}</span>
        </div>
        <label class="inspector-field">
          <span>{{ t('script.timeline.exportResolution') }}</span>
          <select
            :value="exportResolutionKey"
            :disabled="exportPlatformId !== 'custom'"
            @change="onExportResolutionChange(($event.target as HTMLSelectElement).value)"
          >
            <option v-for="res in EXPORT_RESOLUTIONS" :key="res.label" :value="`${res.w}x${res.h}`">
              {{ res.label }}
            </option>
            <option value="custom">{{ t('script.timeline.customResolution') }}</option>
          </select>
        </label>
        <div class="export-custom-grid">
          <label class="inspector-field">
            <span>{{ t('script.timeline.exportWidthField') }}</span>
            <input
              v-model.number="exportWidth"
              type="number"
              min="320"
              max="7680"
              step="2"
              :disabled="!isCustomResolution"
            />
          </label>
          <label class="inspector-field">
            <span>{{ t('script.timeline.exportHeightField') }}</span>
            <input
              v-model.number="exportHeight"
              type="number"
              min="180"
              max="4320"
              step="2"
              :disabled="!isCustomResolution"
            />
          </label>
        </div>
        <label class="inspector-field">
          <span>{{ t('script.timeline.exportFps') }}</span>
          <select v-model.number="exportFps">
            <option v-for="fps in EXPORT_FPS_OPTIONS" :key="fps" :value="fps">
              {{ fps }}
            </option>
          </select>
        </label>
        <label class="inspector-field">
          <span>{{ t('script.timeline.exportBitrate') }}</span>
          <input
            v-model.number="exportVideoBitrateKbps"
            type="number"
            min="500"
            max="200000"
            step="500"
          />
        </label>
        <label class="inspector-field">
          <span>{{ t('script.timeline.scaleMode') }}</span>
          <select v-model="scaleMode" @change="scheduleSave">
            <option value="contain">{{ t('script.timeline.scaleModeContain') }}</option>
            <option value="cover">{{ t('script.timeline.scaleModeCover') }}</option>
            <option value="blur">{{ t('script.timeline.scaleModeBlur') }}</option>
          </select>
        </label>
        <div class="mixer-section-title">
          {{ t('script.timeline.watermark') }}
        </div>
        <label class="inspector-field">
          <span>{{ t('script.timeline.watermarkEnable') }}</span>
          <input
            type="checkbox"
            :checked="watermarkEnabled"
            @change="onWatermarkEnabledChange(($event.target as HTMLInputElement).checked)"
          />
        </label>
        <template v-if="watermarkEnabled">
          <label class="inspector-field">
            <span>{{ t('script.timeline.watermarkImage') }}</span>
            <span class="watermark-pick-row">
              <button type="button" class="ghost-btn" @click="pickWatermarkImage">
                {{ watermarkFileName || t('script.timeline.watermarkPick') }}
              </button>
              <button
                v-if="watermarkSrc"
                type="button"
                class="ghost-btn"
                :title="t('common.remove')"
                @click="clearWatermark"
              >
                ×
              </button>
            </span>
          </label>
          <label class="inspector-field">
            <span>{{ t('script.timeline.watermarkOpacity') }}</span>
            <span class="mixer-slider-row">
              <input
                v-model.number="watermarkOpacity"
                type="range"
                min="0.05"
                max="1"
                step="0.05"
                @change="scheduleSave"
              />
              <span class="mixer-value">{{ Math.round(watermarkOpacity * 100) }}%</span>
            </span>
          </label>
          <label class="inspector-field">
            <span>{{ t('script.timeline.watermarkScale') }}</span>
            <span class="mixer-slider-row">
              <input
                v-model.number="watermarkScale"
                type="range"
                min="0.05"
                max="0.5"
                step="0.01"
                @change="scheduleSave"
              />
              <span class="mixer-value">{{ Math.round(watermarkScale * 100) }}%</span>
            </span>
          </label>
          <label class="inspector-field">
            <span>{{ t('script.timeline.watermarkPosition') }}</span>
            <select
              :value="watermarkPosition"
              @change="onWatermarkPositionChange(($event.target as HTMLSelectElement).value)"
            >
              <option value="br">{{ t('script.timeline.watermarkBr') }}</option>
              <option value="bl">{{ t('script.timeline.watermarkBl') }}</option>
              <option value="tr">{{ t('script.timeline.watermarkTr') }}</option>
              <option value="tl">{{ t('script.timeline.watermarkTl') }}</option>
            </select>
          </label>
        </template>
        <div v-if="lastExportError" class="export-error-box">
          <span class="export-error-title">
            {{ t('script.timeline.exportRetryHint') }}
          </span>
          <code>{{ lastExportError }}</code>
        </div>
        <div class="export-settings-actions">
          <button type="button" class="ghost-btn" @click="closeExportDialog">
            {{ t('common.cancel') }}
          </button>
          <button type="button" class="export-btn" @click="confirmExportDialog">
            {{ t('script.timeline.export') }}
          </button>
        </div>
        <input
          ref="watermarkInputEl"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          hidden
          @change="onWatermarkImagePicked"
        />
      </div>
    </div>

    <div v-if="mixerOpen" class="export-settings-mask" @click.self="closeMixer">
      <div class="export-settings-panel mixer-panel" role="dialog" aria-modal="true">
        <div class="export-settings-title">
          {{ t('script.timeline.mixer') }}
        </div>
        <div class="mixer-section-title">
          {{ t('script.timeline.mixerTrackGains') }}
        </div>
        <label v-for="track in audioMixerTracks" :key="track.kind" class="inspector-field">
          <span>{{ track.label }}</span>
          <span class="mixer-slider-row">
            <input
              type="range"
              min="0"
              max="2"
              step="0.05"
              :value="mixGains[track.kind] ?? 1"
              @input="
                onMixGainChange(track.kind, Number(($event.target as HTMLInputElement).value))
              "
            />
            <span class="mixer-value">
              {{ mixGainPercent(track.kind) }}% ({{ mixGainDbLabel(track.kind) }})
            </span>
          </span>
        </label>
        <div class="mixer-section-title">
          {{ t('script.timeline.mixerMaster') }}
        </div>
        <label class="inspector-field">
          <span>{{ t('script.timeline.mixerMasterGain') }}</span>
          <span class="mixer-slider-row">
            <input
              v-model.number="mixMasterGain"
              type="range"
              min="0"
              max="2"
              step="0.05"
              @change="onMasterGainChange(mixMasterGain)"
            />
            <span class="mixer-value">
              {{ Math.round(clampTrackGain(mixMasterGain) * 100) }}% ({{ mixMasterGainDbLabel() }})
            </span>
          </span>
        </label>
        <label class="inspector-field">
          <span>{{ t('script.timeline.mixerBass') }}</span>
          <span class="mixer-slider-row">
            <input
              v-model.number="mixBassGainDb"
              type="range"
              min="-12"
              max="12"
              step="0.5"
              @change="onMixEqChange"
            />
            <span class="mixer-value">{{ Math.round(mixBassGainDb) }} dB</span>
          </span>
        </label>
        <label class="inspector-field">
          <span>{{ t('script.timeline.mixerTreble') }}</span>
          <span class="mixer-slider-row">
            <input
              v-model.number="mixTrebleGainDb"
              type="range"
              min="-12"
              max="12"
              step="0.5"
              @change="onMixEqChange"
            />
            <span class="mixer-value">{{ Math.round(mixTrebleGainDb) }} dB</span>
          </span>
        </label>
        <label class="inspector-field">
          <span>{{ t('script.timeline.mixerCompression') }}</span>
          <input
            type="checkbox"
            :checked="mixCompression"
            @change="onMixCompressionChange(($event.target as HTMLInputElement).checked)"
          />
        </label>
        <label class="inspector-field" :title="t('script.timeline.mixerAutoDuckingHint')">
          <span>{{ t('script.timeline.mixerAutoDucking') }}</span>
          <input v-model="mixAutoDucking" type="checkbox" @change="scheduleSave" />
        </label>
        <label v-if="mixAutoDucking" class="inspector-field">
          <span>{{ t('script.timeline.mixerDuckingRatio') }}</span>
          <span class="mixer-slider-row">
            <input
              v-model.number="mixDuckingRatio"
              type="range"
              min="0.05"
              max="1"
              step="0.05"
              @change="scheduleSave"
            />
            <span class="mixer-value">{{ Math.round(mixDuckingRatio * 100) }}%</span>
          </span>
        </label>
        <label class="inspector-field" :title="t('script.timeline.mixerLoudnormHint')">
          <span>{{ t('script.timeline.mixerLoudnorm') }}</span>
          <input v-model="mixLoudnorm" type="checkbox" @change="scheduleSave" />
        </label>
        <div class="export-settings-actions">
          <button type="button" class="ghost-btn" @click="closeMixer">
            {{ t('common.done') }}
          </button>
        </div>
      </div>
    </div>

    <div v-if="sfxLibraryOpen" class="export-settings-mask" @click.self="closeSfxLibrary">
      <div class="export-settings-panel sfx-library-panel" role="dialog" aria-modal="true">
        <div class="export-settings-title">
          {{ t('script.timeline.sfxLibrary') }}
        </div>
        <div class="sfx-library-tabs">
          <button
            v-for="cat in ['all', ...SFX_PRESET_CATEGORIES.map((c) => c.id)]"
            :key="cat"
            type="button"
            class="ghost-btn sfx-library-tab"
            :class="{ active: sfxLibraryCategory === cat }"
            @click="setSfxLibraryCategory(cat as 'all' | SfxPresetCategory)"
          >
            <span class="sfx-library-tab-icon" aria-hidden="true">
              {{ sfxLibraryCategoryIcons[cat as 'all' | SfxPresetCategory] }}
            </span>
            <span>{{ sfxLibraryCategoryLabels[cat as 'all' | SfxPresetCategory] }}</span>
          </button>
        </div>
        <div class="sfx-preset-grid">
          <div
            v-for="preset in filteredSfxPresets"
            :key="preset.id"
            class="sfx-preset-card"
            :class="`cat-${preset.category}`"
          >
            <div class="sfx-preset-head">
              <span class="sfx-preset-icon" :class="preset.category" aria-hidden="true">
                {{ preset.icon }}
              </span>
              <div class="sfx-preset-title-wrap">
                <div class="sfx-preset-name">
                  {{ localizedText(locale, preset.name) }}
                </div>
                <span class="sfx-preset-cat-badge" :class="preset.category">
                  {{ sfxLibraryCategoryLabels[preset.category] }}
                </span>
              </div>
            </div>
            <div class="sfx-preset-prompt">
              {{ localizedText(locale, preset.prompt) }}
            </div>
            <div class="sfx-preset-foot">
              <span v-if="preset.durationSec" class="sfx-preset-duration">
                ⏱ ~{{ preset.durationSec }}s
              </span>
              <button
                type="button"
                class="ghost-btn"
                :disabled="sfxBusy"
                @click="onLibraryGenerateSfx(preset)"
              >
                {{ sfxBusy ? '…' : t('script.timeline.sfxLibraryGenerate') }}
              </button>
            </div>
          </div>
        </div>
        <div class="mixer-section-title">
          {{ t('script.timeline.sfxLibraryImport') }}
        </div>
        <div v-if="projectAudioAssets.length" class="sfx-library-assets">
          <div v-for="asset in projectAudioAssets" :key="asset.id" class="sfx-library-asset-row">
            <span class="sfx-library-asset-name" :title="asset.relativePath">
              <span class="sfx-library-asset-icon" aria-hidden="true">🎧</span>
              <span>{{ asset.name }}</span>
            </span>
            <button
              type="button"
              class="ghost-btn"
              :disabled="sfxBusy"
              @click="onImportSfxAsset(asset)"
            >
              {{ t('script.timeline.sfxLibraryImportBtn') }}
            </button>
          </div>
        </div>
        <p v-else class="sfx-library-empty">
          {{ t('script.timeline.sfxLibraryNoAssets') }}
        </p>
        <div class="export-settings-actions">
          <button type="button" class="ghost-btn" @click="closeSfxLibrary">
            {{ t('common.done') }}
          </button>
        </div>
      </div>
    </div>

    <div v-if="subtitleEditor" class="subtitle-edit-mask" @click.self="cancelSubtitleEdit">
      <div class="subtitle-edit-panel" role="dialog" aria-modal="true">
        <div class="subtitle-edit-title">
          {{ t('script.timeline.editSubtitle') }}
        </div>
        <input
          ref="subtitleInputEl"
          v-model="subtitleEditor.draft"
          class="subtitle-edit-input"
          type="text"
          maxlength="200"
          @keydown.enter.prevent="commitSubtitleEdit"
          @keydown.escape.prevent="cancelSubtitleEdit"
        />
        <div class="subtitle-edit-actions">
          <button type="button" class="ghost-btn" @click="cancelSubtitleEdit">
            {{ t('common.cancel') }}
          </button>
          <button type="button" class="export-btn" @click="commitSubtitleEdit">
            {{ t('common.confirm') }}
          </button>
        </div>
      </div>
    </div>

    <div v-if="smartCutDialogOpen" class="smart-cut-mask" @click.self="smartCutDialogOpen = false">
      <div class="smart-cut-panel" role="dialog" aria-modal="true">
        <div class="smart-cut-title">
          {{ t('script.timeline.smartCutTitle') }}
        </div>
        <p class="smart-cut-subtitle">
          {{ t('script.timeline.smartCutHint') }}
        </p>
        <div class="smart-cut-model-row">
          <label class="smart-cut-field">
            <span>{{ t('common.model') }}</span>
            <select v-model="smartCutModelKey" :disabled="smartCutBusy">
              <option v-for="opt in smartCutModelOptions" :key="opt.key" :value="opt.key">
                {{ opt.label }}
              </option>
            </select>
          </label>
          <button
            type="button"
            class="ghost-btn"
            :disabled="smartCutBusy || !smartCutModelKey"
            @click="regenerateSmartCut"
          >
            {{
              smartCutBusy
                ? t('script.timeline.smartCutRegenerating')
                : smartCutEdits.length
                  ? t('script.timeline.smartCutRegenerate')
                  : t('script.timeline.smartCutStart')
            }}
          </button>
        </div>
        <div class="smart-cut-list">
          <p v-if="smartCutBusy && !smartCutEdits.length" class="smart-cut-empty">
            {{ t('script.timeline.smartCutGenerating') }}
          </p>
          <p v-else-if="!smartCutEdits.length" class="smart-cut-empty">
            {{ t('script.timeline.smartCutNotStarted') }}
          </p>
          <div v-for="(edit, i) in smartCutEdits" :key="edit.sourceId" class="smart-cut-item">
            <span class="smart-cut-index">{{ i + 1 }}</span>
            <div class="smart-cut-item-main">
              <span class="smart-cut-item-title" :title="edit.title">{{ edit.title }}</span>
              <span v-if="edit.nodeTitle" class="smart-cut-item-shot">{{ edit.nodeTitle }}</span>
              <span v-if="smartCutBeatNote(edit)" class="smart-cut-beat-note">{{
                smartCutBeatNote(edit)
              }}</span>
            </div>
            <label class="smart-cut-field">
              <span>{{ t('script.timeline.smartCutDuration') }}</span>
              <input
                v-model.number="edit.durationSec"
                type="number"
                min="0.5"
                max="60"
                step="0.5"
              />
            </label>
            <label class="smart-cut-field">
              <span>{{ t('script.timeline.transitionEffect') }}</span>
              <select v-model="edit.transitionType">
                <option v-for="tr in smartCutTransitions" :key="tr" :value="tr">
                  {{ t(smartCutTransitionLabelKey(tr)) }}
                </option>
              </select>
            </label>
          </div>
        </div>
        <div class="smart-cut-actions">
          <button type="button" class="ghost-btn" @click="smartCutDialogOpen = false">
            {{ t('common.cancel') }}
          </button>
          <button
            type="button"
            class="export-btn"
            :disabled="!smartCutEdits.length"
            @click="applySmartCut"
          >
            {{ t('script.timeline.smartCutApply') }}
          </button>
        </div>
      </div>
    </div>

    <div
      v-if="transitionPopover && activePopoverTransitionPair"
      class="transition-popover"
      :style="transitionPopoverStyle"
      @pointerdown.stop
    >
      <div class="transition-popover-head">
        <div class="transition-popover-title">
          <span class="transition-bowtie">⋈</span>
          <span>{{ t('script.timeline.transitionPopoverTitle') }}</span>
        </div>
        <span class="transition-popover-pair">
          {{ activePopoverTransitionPair.left.title }} →
          {{ activePopoverTransitionPair.right.title }}
        </span>
        <button
          type="button"
          class="ghost-btn transition-popover-close"
          @click="transitionPopover = null"
        >
          ×
        </button>
      </div>
      <div class="transition-cat-tabs">
        <button
          v-for="cat in TRANSITION_CATEGORIES"
          :key="cat.id"
          type="button"
          class="transition-cat-tab"
          :class="{ active: activeTransitionCategory === cat.id }"
          @click="activeTransitionCategory = cat.id"
        >
          {{ t(cat.labelKey) }}
        </button>
      </div>
      <div class="transition-card-grid popover-grid">
        <button
          v-for="effect in filteredTransitionCatalog"
          :key="effect.type"
          type="button"
          class="transition-effect-card"
          :class="{
            active: (activePopoverTransitionPair.right.transitionType ?? 'none') === effect.type
          }"
          @click="onSelectPairTransitionType(activePopoverTransitionPair, effect.type)"
        >
          <span :class="['trans-preview-box', `effect-${effect.type}`]" :data-effect="effect.type">
            <span class="trans-preview-a">A</span>
            <span class="trans-preview-b">B</span>
            <svg class="trans-card-icon" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path
                :d="getTransitionIconPath(effect.type)"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </span>
          <span class="trans-card-label">{{ transitionItemDisplayLabel(effect) }}</span>
        </button>
      </div>
      <div
        v-if="
          activePopoverTransitionPair.right.transitionType &&
          activePopoverTransitionPair.right.transitionType !== 'none'
        "
        class="transition-popover-footer"
      >
        <div class="transition-duration-row">
          <span class="transition-duration-label">{{
            t('script.timeline.transitionDuration')
          }}</span>
          <div class="transition-preset-pills">
            <button
              v-for="sec in TRANSITION_DURATION_PRESETS"
              :key="sec"
              type="button"
              class="ghost-btn preset-pill"
              :class="{
                active:
                  Math.abs((activePopoverTransitionPair.right.transitionInSec ?? 0.5) - sec) < 0.04
              }"
              @click="onSelectPairTransitionDuration(activePopoverTransitionPair, sec)"
            >
              {{ sec.toFixed(1) }}s
            </button>
          </div>
          <input
            class="inspector-input compact-num"
            type="number"
            min="0.1"
            :max="activePopoverTransitionPair.maxSec"
            step="0.1"
            :value="Number((activePopoverTransitionPair.right.transitionInSec ?? 0.5).toFixed(2))"
            @change="
              onSelectPairTransitionDuration(
                activePopoverTransitionPair,
                Number(($event.target as HTMLInputElement).value)
              )
            "
          />
        </div>
        <button
          type="button"
          class="ghost-btn transition-apply-all-btn"
          @click="applyCurrentTransitionToAllCuts(activePopoverTransitionPair)"
        >
          {{ t('script.timeline.transitionApplyAll') }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, toRaw, watch } from 'vue'
import { ASSET_TYPE_ICONS, isDraftAssetId, type AssetInfo } from '@shared/domain'
import type { VideoBeatTags } from '@shared/videoBeats'
import {
  applySmartCutPlan,
  applyTimelineCreativeTemplateToClips,
  applyVideoTransitionBetweenClips,
  applyVideoTransitionToAllCuts,
  beatCutWindowForDuration,
  buildCapCutDraftContent,
  buildCapCutDraftMetaInfo,
  buildClipVisualCssFilter,
  buildClipVisualCssTransform,
  buildClipVisualFfmpegFilter,
  buildClipVisualOverlayMeta,
  buildClipVisualSvgFilterMeta,
  buildFcpxmlDocument,
  buildSmartCutPrompt,
  clampClipFreezeTailSec,
  clampClipSpeed,
  clampMixDuckingRatio,
  clampMixEqGainDb,
  clampTrackGain,
  closeTimelineTrackGaps,
  evaluateMainClipCameraTransform,
  evaluateOverlayClipTransform,
  EXPORT_PLATFORMS,
  exportPlatformById,
  exportPlatformSafeRect,
  exportPlatformSubtitleOffset,
  getTimelineFilterPresetMeta,
  getTimelineVisualEffectMeta,
  hasOverlayClipTween,
  isDynamicVisualEffect,
  isExportDurationOverLimit,
  isSubtitleWithinSafeArea,
  normalizeClipCropRect,
  normalizePlaybackRate,
  normalizeScriptTimelineSource,
  normalizeScriptTimelineSourceGroup,
  normalizeTimelineKeyframes,
  parseSmartCutPlan,
  readScriptTimelineFromGenParams,
  removeTimelineClipKeyframeAt,
  renderTimelineBuiltinStickerDataUrl,
  SMART_CUT_DEFAULT_TRANSITION_SEC,
  SMART_CUT_TRANSITIONS,
  splitTimelineClipAtTime,
  TIMELINE_ADJUSTMENT_CONTROLS,
  TIMELINE_BROWSER_TABS,
  TIMELINE_BUILTIN_STICKERS,
  TIMELINE_CAMERA_MOTION_PRESETS,
  TIMELINE_CREATIVE_TEMPLATES,
  TIMELINE_CREATIVE_UI_TEXT,
  TIMELINE_EASE_TYPES,
  TIMELINE_FILTER_CATEGORIES,
  TIMELINE_FILTER_PRESETS,
  TIMELINE_TRANSITION_CATALOG,
  TIMELINE_TRANSITION_CATEGORIES,
  TIMELINE_TWEEN_IN_PRESETS,
  TIMELINE_TWEEN_LOOP_PRESETS,
  TIMELINE_TWEEN_OUT_PRESETS,
  TIMELINE_VISUAL_EFFECT_CATEGORIES,
  TIMELINE_VISUAL_EFFECTS,
  trimTimelineClipToTime,
  upsertTimelineClipKeyframe,
  withScriptTimeline,
  type ScriptTimelineClip,
  type ScriptTimelineDocument,
  type ScriptTimelineScaleMode,
  type ScriptTimelineSource,
  type ScriptTimelineSourceGroup,
  type ScriptTimelineSourceMediaKind,
  type ScriptTimelineTrackKind,
  type ScriptTimelineTransitionType,
  type SmartCutEdit,
  type TimelineAdjustmentKey,
  type TimelineBrowserTabId,
  type TimelineBuiltinStickerPreset,
  type TimelineCameraMotionPreset,
  type TimelineClipKeyframe,
  type TimelineCreativeTemplateId,
  type TimelineEaseType,
  type TimelineExportClip,
  type TimelineFilterCategory,
  type TimelineFilterPresetId,
  type TimelineMixGains,
  type TimelineTransitionCategory,
  type TimelineTweenInPreset,
  type TimelineTweenLoopPreset,
  type TimelineTweenOutPreset,
  type TimelineVisualEffectCategory,
  type TimelineVisualEffectId
} from '@shared/graph'
import { planRippleCut } from '@shared/graph/timelineCut'
import { buildSubtitleClipsFromTranscription } from '@shared/graph/timelineSubtitle'
import { detectImportAssetType, isImportablePath } from '@shared/import'
import { useStudioI18n } from '../composables/useStudioI18n'
import { persistAssetRecord } from '../composables/useAssetRecord'
import {
  localizedText,
  SFX_PRESETS,
  SFX_PRESET_CATEGORIES,
  type SfxPreset,
  type SfxPresetCategory
} from '../features/timeline/sfxPresets'
import {
  promptAlert,
  promptConfirm,
  promptText,
  promptTextWithModel
} from '../composables/useStudioPrompt'
import {
  buildSoundEffectOptions,
  loadAllProviders,
  loadGenerateModelOptions,
  parseModelKey,
  preferredModelKey,
  type GenerateModelOption
} from '../features/graph/model/generateModelOptions'
import { editorDiveKey } from '../features/graph/model/editorDive'
import { graphEditorHosts } from '../features/graph/model/graphEditorHosts'
import { diveEditorHistory } from '../features/graph/ui/diveEditorHistory'
import { graphEditorNodeTools } from '../features/graph/ui/graphEditorNodeTools'
import { resolveAssetPreviewUrl } from '../features/media/assetUrlCache'
import { useDraftStore } from '../stores/drafts'
import { useProjectStore } from '../stores/project'
import {
  STUDIO_ASSET_DRAG_MIME,
  STUDIO_ASSET_ID_DRAG_MIME,
  STUDIO_ASSET_IDS_DRAG_MIME,
  useWorkspaceStore
} from '../stores/workspace'
import { collectScriptTimelineSources } from '../features/script/collectScriptTimelineSources'
import { exportTimelineViaRecorder } from '../features/script/exportTimelineFallback'
import { useSettingsPanelNavigator } from '../composables/useSettingsPanelNavigator'
import {
  registerOpenTimelineEditor,
  unregisterOpenTimelineEditor
} from '../features/mcp/openTimelineEditors'
import { toPlain } from '../utils/toPlain'
import GraphToolbarCollapseBtn from './GraphToolbarCollapseBtn.vue'

const props = defineProps<{
  scriptAssetId: string
  timelineNodeId?: string
}>()

const { t, locale } = useStudioI18n()
const project = useProjectStore()
const drafts = useDraftStore()
const workspace = useWorkspaceStore()
const { openSettingsPanel } = useSettingsPanelNavigator()
/** dive 上下文；时间线作为 dive 视图打开时可用来退回节点图分支 */
const diveContext = inject(editorDiveKey, null)
const rootEl = ref<HTMLElement | null>(null)

const DRAFT_MIME = 'application/x-aiart-timeline-source'
/** 导入列表内整理分组用（与上轨 MIME 并存） */
const SOURCE_MOVE_MIME = 'application/x-aiart-timeline-source-id'
const TRACK_LABEL_W = 150
/** 时间线轨道下方保留的空白区间高度（px），需与 .timeline-bottom-pad 高度保持一致 */
const TIMELINE_BOTTOM_PAD = 32
const PX_PER_SEC_MAX = 160
const PX_PER_SEC_MIN = 4
const ZOOM_MIN = 0.25
const ZOOM_MAX = 8
const minLaneSec = 12
const SNAP_PX = 12
const MIN_CLIP_SEC = 0.1
const PLAYBACK_RATE_OPTIONS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2]
const EXPORT_RESOLUTIONS = [
  { w: 1280, h: 720, label: '1280 × 720' },
  { w: 1024, h: 576, label: '1024 × 576' },
  { w: 1920, h: 1080, label: '1920 × 1080' },
  { w: 2560, h: 1440, label: '2560 × 1440' },
  { w: 3840, h: 2160, label: '3840 × 2160' },
  { w: 1080, h: 1920, label: '1080 × 1920' },
  { w: 720, h: 1280, label: '720 × 1280' },
  { w: 1080, h: 1080, label: '1080 × 1080' }
]
const EXPORT_FPS_OPTIONS = [24, 25, 30, 60]

const sources = ref<ScriptTimelineSource[]>([])
const sourceGroups = ref<ScriptTimelineSourceGroup[]>([])
const clips = ref<ScriptTimelineClip[]>([])
const undoStack = ref<ScriptTimelineClip[][]>([])
const redoStack = ref<ScriptTimelineClip[][]>([])
const selectedClipIds = ref<Set<string>>(new Set())
const timelineClipboard = ref<ScriptTimelineClip[]>([])
const hiddenTracks = ref<Set<ScriptTimelineTrackKind>>(new Set())
/** 静音轨道：预览与导出都不出声 */
const mutedTracks = ref<Set<ScriptTimelineTrackKind>>(new Set())
const lockedTracks = ref<Set<ScriptTimelineTrackKind>>(new Set())
const collapsedTracks = ref<Set<ScriptTimelineTrackKind>>(new Set())
let historyReady = false
const HISTORY_LIMIT = 100
const sourcesBusy = ref(false)
const bgmBusy = ref(false)
const sfxBusy = ref(false)
const smartCutBusy = ref(false)
const smartCutDialogOpen = ref(false)
const smartCutTransitions = SMART_CUT_TRANSITIONS
type SmartCutEditDraft = {
  sourceId: string
  title: string
  nodeTitle?: string
  durationSec: number
  transitionType: string
  transitionSec: number
}
const smartCutEdits = ref<SmartCutEditDraft[]>([])
/** 智能粗剪可选文本模型（方案窗口内可切换后重新生成） */
const smartCutModelOptions = ref<GenerateModelOption[]>([])
const smartCutModelKey = ref('')
/** 视频素材首帧预览 URL（与资产库列表同源） */
const sourceThumbUrls = ref<Record<string, string>>({})
const sourceGridSize = ref(72)
const sourceThumbPathById = new Map<string, string>()
const voiceSourceIcon = ASSET_TYPE_ICONS.voice
const clipVideoStripUrls = ref<Record<string, string>>({})
const clipWaveformUrls = ref<Record<string, string>>({})
const clipVisualBusy = new Set<string>()
const collapsedGroupIds = ref<Set<string>>(new Set())
const dropGroupId = ref<string | null>(null)
const sourceCtx = ref<{ x: number; y: number; groupId: string | null } | null>(null)
const playheadSec = ref(0)
const playing = ref(false)
/** timeline=整轨联播；solo=仅预览区播选中片段 */
const playMode = ref<'timeline' | 'solo' | null>(null)
const activeClipId = ref<string | null>(null)
const previewSrc = ref('')
const previewEl = ref<HTMLVideoElement | null>(null)
const previewStageEl = ref<HTMLElement | null>(null)
const previewCanvasEl = ref<HTMLElement | null>(null)
const previewFrameRect = ref({ left: 0, top: 0, width: 0, height: 0 })
const previewVideoMeta = ref({ width: 0, height: 0 })
const timelineBoardEl = ref<HTMLElement | null>(null)
const timelineBarEl = ref<HTMLElement | null>(null)
const timelineCollapsed = ref(false)
const timelineHeight = ref(384)
const trackHeight = ref(52)
const splitterDrag = ref<{
  pointerId: number
  startY: number
  startHeight: number
} | null>(null)
const leftPaneWidth = ref(284)
const rightPaneWidth = ref(220)
const panelSplitter = ref<{
  side: 'left' | 'right'
  pointerId: number
  startX: number
  startWidth: number
} | null>(null)
const playheadDrag = ref<{ pointerId: number } | null>(null)
const subtitleDrag = ref<{
  type: 'move' | 'scale'
  pointerId: number
  startY: number
  startFont: number
  startOffset: number
} | null>(null)
const viewportLanePx = ref(0)
/** 相对「铺满可视宽度」的缩放倍率 */
const zoomFactor = ref(1)
const durationSec = ref(minLaneSec)
const durationInputSec = ref(minLaneSec)
const playbackRate = ref(1)
const loopPlayback = ref(false)
const exportWidth = ref(1280)
const exportHeight = ref(720)
const isCustomResolution = ref(false)
const exportPlatformId = ref('custom')
const watermarkEnabled = ref(false)
const watermarkSrc = ref('')
const watermarkOpacity = ref(0.8)
const watermarkScale = ref(0.1)
const watermarkPosition = ref<'br' | 'bl' | 'tr' | 'tl'>('br')
/** 最近一次导出错误（供弹窗内展示与重试） */
const lastExportError = ref('')
const watermarkInputEl = ref<HTMLInputElement | null>(null)
const exportResolutionKey = computed(() =>
  isCustomResolution.value
    ? 'custom'
    : EXPORT_RESOLUTIONS.some((res) => res.w === exportWidth.value && res.h === exportHeight.value)
      ? `${exportWidth.value}x${exportHeight.value}`
      : 'custom'
)
const exportPlatform = computed(
  () => exportPlatformById(exportPlatformId.value) ?? EXPORT_PLATFORMS[0]
)
/** 平台时长上限是否被当前工程时长超出 */
const exportDurationOverLimit = computed(() =>
  isExportDurationOverLimit(totalDuration.value, exportPlatform.value)
)
/** 平台安全区（按导出画幅换算为百分比定位，叠加在预览画框上） */
/** 导出规格符合性检查：分辨率 / 时长 / 字幕安全区（仅平台预设生效） */
const exportCompliance = computed(() => {
  const spec = exportPlatform.value
  if (spec.id === 'custom') return { warnings: [] as string[] }
  const warnings: string[] = []
  if (exportWidth.value !== spec.width || exportHeight.value !== spec.height) {
    warnings.push(
      t('script.timeline.exportCheckResolution', {
        width: spec.width,
        height: spec.height
      })
    )
  }
  if (exportFps.value !== spec.fps) {
    warnings.push(t('script.timeline.exportCheckFps', { fps: spec.fps }))
  }
  if (exportDurationOverLimit.value) {
    warnings.push(
      t('script.timeline.exportCheckDuration', {
        maxSec: Math.round(spec.maxDurationSec / 60)
      })
    )
  }
  if (
    !isSubtitleWithinSafeArea(
      exportHeight.value,
      subtitleFontSize.value,
      subtitleYOffset.value,
      spec
    )
  ) {
    warnings.push(t('script.timeline.exportCheckSubtitleSafe'))
  }
  return { warnings }
})

const exportSafeAreaStyle = computed(() => {
  const spec = exportPlatform.value
  if (spec.id === 'custom') return {}
  const rect = exportPlatformSafeRect(exportWidth.value, exportHeight.value, spec)
  return {
    left: `${((rect.left / exportWidth.value) * 100).toFixed(2)}%`,
    top: `${((rect.top / exportHeight.value) * 100).toFixed(2)}%`,
    right: `${((1 - rect.right / exportWidth.value) * 100).toFixed(2)}%`,
    bottom: `${((1 - rect.bottom / exportHeight.value) * 100).toFixed(2)}%`
  }
})
const exportFps = ref(30)
const exportVideoBitrateKbps = ref(5000)
const scaleMode = ref<ScriptTimelineScaleMode>('contain')
const subtitleFontSize = ref(36)
const subtitleYOffset = ref(80)
const subtitleColor = ref('#ffffff')
const subtitleBorderColor = ref('#000000')
const subtitleBorderWidth = ref(2)
const subtitleBoxEnabled = ref(false)
const subtitleBoxColor = ref('#000000')
const subtitleBoxOpacity = ref(0.55)
const subtitleMotion = ref<'none' | 'fade'>('none')
const previewFrameRatioKey = ref('export')
const exporting = ref(false)
const exportDialogOpen = ref(false)
const exportProgress = ref(0)
/** 混音器：轨道级增益（0~2） */
const mixGains = ref<TimelineMixGains>({})
const mixMasterGain = ref(1)
const mixBassGainDb = ref(0)
const mixTrebleGainDb = ref(0)
const mixCompression = ref(false)
const mixAutoDucking = ref(false)
const mixDuckingRatio = ref(0.25)
const mixLoudnorm = ref(false)
const mixerOpen = ref(false)
const subtitleEditor = ref<{ clipId: string | null; draft: string } | null>(null)
const subtitleInputEl = ref<HTMLInputElement | null>(null)
/** 当前可放置高亮的轨道 */
const dragOverTrack = ref<ScriptTimelineTrackKind | null>(null)
/** 轨道片段指针拖拽（自由挪动时间 / 换轨 / 同轨多选联动） */
const clipDrag = ref<{
  clipId: string
  pointerId: number
  startClientX: number
  startClientY: number
  grabOffsetSec: number
  lastStartSec: number
  moved: boolean
  beforeClips: ScriptTimelineClip[]
  groupInitialStarts?: Map<string, number>
} | null>(null)

const clipDragPreview = ref<{
  clipId: string
  track: ScriptTimelineTrackKind
  startSec: number
  pointerX: number
  pointerY: number
} | null>(null)

const clipResize = ref<{
  clipId: string
  pointerId: number
  edge: 'left' | 'right'
  moved: boolean
  beforeClips: ScriptTimelineClip[]
} | null>(null)

const transitionDrag = ref<{
  leftId: string
  rightId: string
  pointerId: number
  startClientX: number
  startTransitionSec: number
  startRightStart: number
  moved: boolean
  beforeClips: ScriptTimelineClip[]
} | null>(null)

const overlayDrag = ref<{
  clipId: string
  pointerId: number
  mode: 'move' | 'scale' | 'rotate'
  corner: 'tl' | 'tr' | 'bl' | 'br' | 'rotate'
  startX: number
  startY: number
  startLeft: number
  startTop: number
  startWidth: number
  startHeight: number
  startRotation: number
  centerX: number
  centerY: number
  startAngleDeg: number
  moved: boolean
  beforeClips: ScriptTimelineClip[]
} | null>(null)

/** ── 剃刀分割工具 & 画面裁剪工具 & 专业转场状态 ── */
const razorMode = ref(false)
const razorHover = ref<{ clipId: string; localX: number; timeSec: number } | null>(null)
const cropMode = ref(false)
type CropHandleKind = 'move' | 'tl' | 'tr' | 'bl' | 'br' | 't' | 'b' | 'l' | 'r'
const cropDrag = ref<{
  clipId: string
  pointerId: number
  handle: CropHandleKind
  startX: number
  startY: number
  startCropX: number
  startCropY: number
  startCropW: number
  startCropH: number
  moved: boolean
  beforeClips: ScriptTimelineClip[]
} | null>(null)

type TransitionCategoryId = 'all' | 'basic' | 'slide' | 'wipe' | 'cinematic'
interface TransitionCatalogItem {
  type: ScriptTimelineTransitionType
  category: Exclude<TransitionCategoryId, 'all'>
  labelKey: string
  shortKey: string
}

const TRANSITION_CATEGORIES: ReadonlyArray<{ id: TransitionCategoryId; labelKey: string }> = [
  { id: 'all', labelKey: 'script.timeline.transitionCatAll' },
  { id: 'basic', labelKey: 'script.timeline.transitionCatBasic' },
  { id: 'slide', labelKey: 'script.timeline.transitionCatSlide' },
  { id: 'wipe', labelKey: 'script.timeline.transitionCatWipe' },
  { id: 'cinematic', labelKey: 'script.timeline.transitionCatCinematic' }
]

const BASE_TRANSITION_CATALOG: ReadonlyArray<TransitionCatalogItem> = [
  {
    type: 'none',
    category: 'basic',
    labelKey: 'script.timeline.transitionNone',
    shortKey: 'script.timeline.transitionNone'
  },
  {
    type: 'dissolve',
    category: 'basic',
    labelKey: 'script.timeline.transitionDissolve',
    shortKey: 'script.timeline.transitionDissolve'
  },
  {
    type: 'fade',
    category: 'basic',
    labelKey: 'script.timeline.transitionFade',
    shortKey: 'script.timeline.transitionFade'
  },
  {
    type: 'flash',
    category: 'basic',
    labelKey: 'script.timeline.transitionFlash',
    shortKey: 'script.timeline.transitionFlash'
  },
  {
    type: 'smoothleft',
    category: 'basic',
    labelKey: 'script.timeline.transitionSmoothLeft',
    shortKey: 'script.timeline.transitionSmoothLeft'
  },
  {
    type: 'smoothright',
    category: 'basic',
    labelKey: 'script.timeline.transitionSmoothRight',
    shortKey: 'script.timeline.transitionSmoothRight'
  },
  {
    type: 'slideleft',
    category: 'slide',
    labelKey: 'script.timeline.transitionSlideLeft',
    shortKey: 'script.timeline.transitionSlideLeft'
  },
  {
    type: 'slideright',
    category: 'slide',
    labelKey: 'script.timeline.transitionSlideRight',
    shortKey: 'script.timeline.transitionSlideRight'
  },
  {
    type: 'slideup',
    category: 'slide',
    labelKey: 'script.timeline.transitionSlideUp',
    shortKey: 'script.timeline.transitionSlideUp'
  },
  {
    type: 'slidedown',
    category: 'slide',
    labelKey: 'script.timeline.transitionSlideDown',
    shortKey: 'script.timeline.transitionSlideDown'
  },
  {
    type: 'wipeleft',
    category: 'wipe',
    labelKey: 'script.timeline.transitionWipeLeft',
    shortKey: 'script.timeline.transitionWipeLeft'
  },
  {
    type: 'wiperight',
    category: 'wipe',
    labelKey: 'script.timeline.transitionWipeRight',
    shortKey: 'script.timeline.transitionWipeRight'
  },
  {
    type: 'wipeup',
    category: 'wipe',
    labelKey: 'script.timeline.transitionWipeUp',
    shortKey: 'script.timeline.transitionWipeUp'
  },
  {
    type: 'wipedown',
    category: 'wipe',
    labelKey: 'script.timeline.transitionWipeDown',
    shortKey: 'script.timeline.transitionWipeDown'
  },
  {
    type: 'circleopen',
    category: 'wipe',
    labelKey: 'script.timeline.transitionCircleOpen',
    shortKey: 'script.timeline.transitionCircleOpen'
  },
  {
    type: 'circleclose',
    category: 'wipe',
    labelKey: 'script.timeline.transitionCircleClose',
    shortKey: 'script.timeline.transitionCircleClose'
  },
  {
    type: 'radial',
    category: 'wipe',
    labelKey: 'script.timeline.transitionRadial',
    shortKey: 'script.timeline.transitionRadial'
  },
  {
    type: 'zoomin',
    category: 'cinematic',
    labelKey: 'script.timeline.transitionZoomIn',
    shortKey: 'script.timeline.transitionZoomIn'
  },
  {
    type: 'pixelize',
    category: 'cinematic',
    labelKey: 'script.timeline.transitionPixelize',
    shortKey: 'script.timeline.transitionPixelize'
  },
  {
    type: 'horzopen',
    category: 'cinematic',
    labelKey: 'script.timeline.transitionHorzOpen',
    shortKey: 'script.timeline.transitionHorzOpen'
  },
  {
    type: 'vertopen',
    category: 'cinematic',
    labelKey: 'script.timeline.transitionVertOpen',
    shortKey: 'script.timeline.transitionVertOpen'
  }
]

const TRANSITION_CATALOG: ReadonlyArray<TransitionCatalogItem> = [
  ...BASE_TRANSITION_CATALOG,
  ...TIMELINE_TRANSITION_CATALOG.filter(
    (entry) => !BASE_TRANSITION_CATALOG.some((base) => base.type === entry.id)
  ).map((entry) => ({
    type: entry.id,
    category: (entry.category === 'basic'
      ? 'basic'
      : entry.category === 'slide'
        ? 'slide'
        : entry.category === 'wipe'
          ? 'wipe'
          : 'cinematic') as Exclude<TransitionCategoryId, 'all'>,
    labelKey: '',
    shortKey: ''
  }))
]

function getTransitionIconPath(type: string | undefined): string {
  if (!type || type === 'none') {
    return 'M10 3a7 7 0 1 0 0 14a7 7 0 0 0 0-14ZM5.2 5.2l9.6 9.6'
  }
  const found = TIMELINE_TRANSITION_CATALOG.find((item) => item.id === type)
  return found?.iconPath ?? 'M3.5 4.5L9.5 10L3.5 15.5V4.5ZM16.5 4.5L10.5 10L16.5 15.5V4.5Z'
}

function transitionItemDisplayLabel(item: TransitionCatalogItem): string {
  if (item.labelKey) return t(item.labelKey)
  const creativeTr = TIMELINE_TRANSITION_CATALOG.find((entry) => entry.id === item.type)
  if (creativeTr) return isZhLocale.value ? creativeTr.labelZh : creativeTr.labelEn
  return item.type
}

const TRANSITION_DURATION_PRESETS = [0.3, 0.5, 0.8, 1.0, 1.5]
const CROP_ASPECT_PRESETS: ReadonlyArray<{
  key: 'free' | '16:9' | '9:16' | '1:1' | '4:3'
  label: string
  ratio: number | null
}> = [
  { key: 'free', label: '', ratio: null },
  { key: '16:9', label: '16:9', ratio: 16 / 9 },
  { key: '9:16', label: '9:16', ratio: 9 / 16 },
  { key: '1:1', label: '1:1', ratio: 1 },
  { key: '4:3', label: '4:3', ratio: 4 / 3 }
]

const activeTransitionCategory = ref<TransitionCategoryId>('all')
const transitionPopover = ref<{
  leftId: string
  rightId: string
  anchorX: number
  anchorY: number
} | null>(null)

let saveTimer: ReturnType<typeof setTimeout> | null = null
let clipVisualTimer: ReturnType<typeof setTimeout> | null = null
let playSeq = 0
/** 序列播放中正在为下一段切换 src（旧元素仍在播放）时置真，
 * 期间禁止 timeupdate 用「旧元素时间 × 新片段时间轴」错误推进播放头，
 * 否则会导致转场 overlay 提前摘除、闪回上一片段的一帧 */
let clipSwitchPending = false
const audioEls = new Map<string, HTMLAudioElement>()
/** 因匿名跨源加载失败而降级为普通加载的音频元素（放弃 Web Audio 混音，改用元素音量） */
const audioCorsFallback = new WeakSet<HTMLAudioElement>()
const overlayEls = new Map<string, HTMLVideoElement>()
const transitionVideoEls = new Map<string, HTMLVideoElement>()

/** ffmpeg 微渲染完成的转场窗口（key = 可复现签名；参数一变自动换 key 重渲染） */
interface TransitionPreviewEntry {
  key: string
  url: string
  durationSec: number
}
const transitionPreviewCache = new Map<string, TransitionPreviewEntry>()
const transitionPreviewInflight = new Map<string, Promise<boolean>>()
const transitionPreviewFailed = new Set<string>()
/** 渲染就绪/失败后自增，驱动样式 computed 与暂停态重同步 */
const transitionPreviewTick = ref(0)

const hostId = computed(() => `asset:${props.scriptAssetId}`)

const tracks = computed(() => [
  { kind: 'video' as const, label: t('script.timeline.track.video') },
  { kind: 'overlay' as const, label: t('script.timeline.track.overlay') },
  { kind: 'voice' as const, label: t('script.timeline.track.voice') },
  { kind: 'subtitle' as const, label: t('script.timeline.track.subtitle') },
  { kind: 'music' as const, label: t('script.timeline.track.music') },
  { kind: 'sfx' as const, label: t('script.timeline.track.sfx') }
])

/** 混音器里可调增益的轨道（subtitle 无音频） */
const audioMixerTracks = computed(() => tracks.value.filter((track) => track.kind !== 'subtitle'))

const timelineInnerHeight = computed(
  () =>
    28 +
    tracks.value.reduce(
      (sum, track) => sum + (collapsedTracks.value.has(track.kind) ? 24 : trackHeight.value),
      0
    ) +
    TIMELINE_BOTTOM_PAD
)

/** 时间线面板最小展开高度（允许向下拖拽收窄，轨道区内部自动出现纵向滚动条可下拉到底） */
const timelineMinHeight = computed(() => 116)

function trackTopOffset(kind: ScriptTimelineTrackKind): number {
  let top = 28
  for (const track of tracks.value) {
    if (track.kind === kind) return top
    top += collapsedTracks.value.has(track.kind) ? 24 : trackHeight.value
  }
  return top
}

const inputSources = computed(() => sources.value.filter((s) => (s.origin ?? 'input') === 'input'))
const importedSources = computed(() => sources.value.filter((s) => s.origin === 'imported'))
const ungroupedImportedSources = computed(() =>
  importedSources.value.filter(
    (s) => !s.groupId || !sourceGroups.value.some((g) => g.id === s.groupId)
  )
)
const videoSources = computed(() =>
  sources.value.filter((s) => (s.mediaKind ?? 'video') === 'video')
)

const selectedPlayableClip = computed(() => {
  const clip = clips.value.find((c) => c.id === activeClipId.value)
  if (!clip) return null
  if (
    clip.track === 'video' ||
    clip.track === 'overlay' ||
    clip.track === 'voice' ||
    clip.track === 'music' ||
    clip.track === 'sfx'
  ) {
    return clip
  }
  return null
})

const selectedClip = computed(
  () => clips.value.find((clip) => clip.id === activeClipId.value) ?? null
)

const selectedAudioClip = computed(() => {
  const clip = selectedPlayableClip.value
  return clip &&
    (clip.track === 'video' ||
      clip.track === 'voice' ||
      clip.track === 'music' ||
      clip.track === 'sfx')
    ? clip
    : null
})

/** 人声伴奏分离可用性：选中片段带可访问音源（视频/配音/音乐/音效轨均可） */
const canSeparateAudio = computed(() => {
  const clip = selectedPlayableClip.value
  return !!clip && !!sourceRelativePath(clip)
})

const selectedOverlayClip = computed(() => {
  const clip = selectedClip.value
  return clip?.track === 'overlay' ? clip : null
})

const previewOverlayClips = computed(() => visibleClipsOn('overlay'))

const activeMainTransition = computed(() => {
  const list = visibleClipsOn('video')
  // 从后往前找：如果两个转场窗口重叠（如 A-B 与 B-C），优先取最近开始的。
  for (let i = list.length - 2; i >= 0; i--) {
    const from = list[i]!
    const to = list[i + 1]!
    if (!(to.transitionInSec && to.transitionInSec > 0)) continue
    const fromEnd = from.startSec + from.durationSec
    if (to.startSec >= fromEnd) continue
    // 转场窗口在 A 实际结束后保留一小段余量：主 <video> 换源期间播放头被
    // 冻结在 fromEnd 上、B 就位前不会前进，overlay 自然会一直盖住；
    // 这里只需留出 1~2 帧余量，避免 B 已开播后 overlay 还长时间静止造成跳变。
    if (playheadSec.value >= to.startSec && playheadSec.value <= fromEnd + 0.12) {
      return { from, to }
    }
  }
  return null
})

const activeMainTransitionClip = computed(() => activeMainTransition.value?.to ?? null)

const activeMainTransitionClipId = computed(() => activeMainTransition.value?.to.id ?? '')

/** 当前预览画布主画面实际已加载的片段 ID（确保单击不同片段时特效/滤镜严格与所显画面一一对应） */
const previewLoadedClipId = ref<string | null>(null)

/** 预解析并缓存各素材/片段的媒体 URL，保证转场叠加层与片段切换零帧延迟 */
const clipResolvedUrls = ref<Record<string, string>>({})

/** 转场进入片段为静态图/GIF 时的预览地址（同步优先读缓存，异步兜底） */
const transitionOverlayImageUrl = ref('')

const transitionOverlayMediaUrl = computed(() => {
  const clip = activeMainTransitionClip.value
  if (!clip) return ''
  const cachedByClip = clipResolvedUrls.value[clip.id]
  if (cachedByClip) return cachedByClip
  const rel = sourceRelativePath(clip)
  if (rel && clipResolvedUrls.value[`rel:${rel}`]) {
    return clipResolvedUrls.value[`rel:${rel}`]!
  }
  return transitionOverlayImageUrl.value
})

watch(
  activeMainTransitionClip,
  async (clip) => {
    if (!clip) {
      transitionOverlayImageUrl.value = ''
      return
    }
    const url = await resolveSrc(clip)
    if (url && !clipResolvedUrls.value[clip.id]) {
      clipResolvedUrls.value = { ...clipResolvedUrls.value, [clip.id]: url }
    }
    if (activeMainTransitionClip.value?.id === clip.id) {
      transitionOverlayImageUrl.value = url
    }
  },
  { immediate: true }
)

watch(
  clips,
  (list) => {
    for (const clip of list) {
      if (clip.track !== 'video' && clip.track !== 'overlay') continue
      if (clipResolvedUrls.value[clip.id]) continue
      void resolveSrc(clip).then((url) => {
        if (url && !clipResolvedUrls.value[clip.id]) {
          clipResolvedUrls.value = { ...clipResolvedUrls.value, [clip.id]: url }
        }
      })
    }
  },
  { immediate: true }
)

/**
 * 计算某个视频片段用于“单片段预览/调特效”的安全时间点：
 * 若该片段有入场转场（与前一片段尾部重叠），避开转场重叠区，定位于转场结束后的纯净片段区内，
 * 避免单击片段 2 调特效时播放头落入 [A→B] 转场窗口而把底层画面误判为片段 1。
 */
function clipSafePreviewTimeSec(clip: ScriptTimelineClip): number {
  if (clip.track !== 'video') return clip.startSec
  const transIn =
    clip.transitionType && clip.transitionType !== 'none' && (clip.transitionInSec ?? 0) > 0
      ? Math.min(clip.durationSec * 0.6, clip.transitionInSec ?? 0)
      : 0
  if (transIn <= 0.01) return clip.startSec
  return Math.min(
    clip.startSec + Math.max(0.05, clip.durationSec - 0.05),
    Number((clip.startSec + transIn + 0.02).toFixed(3))
  )
}

/**
 * 当前预览舞台底层（主画面）实际展示的主视频轨片段：
 * - 转场窗口内固定为转场前片（transition.from），保证底层是 A、叠加层是 B；
 * - 暂停且非转场态下，若用户刚显式加载了某个视频片段（previewLoadedClipId），严格使用该片段的特效/滤镜；
 * - 播放或拖动播放头时，严格取播放头所在视频片段（每段特效仅在该片段时间区间内生效，绝不污染整条轨道）。
 */
const previewDisplayedVideoClip = computed<ScriptTimelineClip | null>(() => {
  if (activeMainTransition.value) return activeMainTransition.value.from
  if (!playing.value && !playheadDrag.value && previewLoadedClipId.value) {
    const loaded = clips.value.find(
      (c) => c.id === previewLoadedClipId.value && c.track === 'video'
    )
    if (loaded) return loaded
  }
  const sel = clips.value.find((c) => c.id === activeClipId.value)
  if (
    sel &&
    sel.track === 'video' &&
    playheadSec.value >= sel.startSec &&
    playheadSec.value < sel.startSec + sel.durationSec
  ) {
    return sel
  }
  const atHead = clipAtPlayhead()
  if (atHead && atHead.track === 'video') return atHead
  if (sel && sel.track === 'video') return sel
  return visibleClipsOn('video')[0] ?? null
})

/** 动态特效 60fps 实时预览时钟（当播放器处于暂停态但当前片段挂载了动态特效或运镜时自动驱动） */
const effectPreviewClockSec = ref(0)
let effectPreviewRafId = 0
let effectPreviewStartMs = 0

const needsLiveEffectClock = computed(() => {
  if (playing.value) return false
  const vClip = previewDisplayedVideoClip.value
  const oClip = selectedOverlayClip.value
  if (vClip && isDynamicVisualEffect(vClip.visualEffect)) return true
  if (vClip && vClip.cameraMotion && vClip.cameraMotion !== 'none') return true
  if (oClip && isDynamicVisualEffect(oClip.visualEffect)) return true
  if (oClip && hasOverlayClipTween(oClip)) return true
  return false
})

function stopEffectPreviewClock(): void {
  if (effectPreviewRafId) {
    cancelAnimationFrame(effectPreviewRafId)
    effectPreviewRafId = 0
  }
}

function startEffectPreviewClock(): void {
  if (effectPreviewRafId) return
  effectPreviewStartMs = performance.now()
  const tick = (now: number) => {
    if (!needsLiveEffectClock.value) {
      effectPreviewRafId = 0
      return
    }
    effectPreviewClockSec.value = (now - effectPreviewStartMs) / 1000
    effectPreviewRafId = requestAnimationFrame(tick)
  }
  effectPreviewRafId = requestAnimationFrame(tick)
}

watch(
  needsLiveEffectClock,
  (needed) => {
    if (needed) startEffectPreviewClock()
    else stopEffectPreviewClock()
  },
  { immediate: true }
)

function effectiveClipLocalTimeSec(clip: ScriptTimelineClip | null | undefined): number {
  if (!clip) return 0
  const baseLocal = Math.max(0, playheadSec.value - clip.startSec)
  if (playing.value || playheadDrag.value) return baseLocal
  if (
    isDynamicVisualEffect(clip.visualEffect) ||
    (clip.track === 'video' && clip.cameraMotion && clip.cameraMotion !== 'none') ||
    (clip.track === 'overlay' && hasOverlayClipTween(clip))
  ) {
    const dur = Math.max(0.6, clip.durationSec || 3)
    return (baseLocal + effectPreviewClockSec.value) % dur
  }
  return baseLocal
}

function smoothstep01(tVal: number): number {
  const x = clamp01(tVal)
  return x * x * (3 - 2 * x)
}

function isClipCropped(clip: ScriptTimelineClip | null | undefined): boolean {
  if (!clip) return false
  const rect = normalizeClipCropRect(clip)
  return (
    rect.cropX > 0.001 || rect.cropY > 0.001 || rect.cropWidth < 0.999 || rect.cropHeight < 0.999
  )
}

function buildCssCropClipPath(clip: ScriptTimelineClip | null | undefined): string {
  if (!isClipCropped(clip)) return ''
  const rect = normalizeClipCropRect(clip)
  const top = (rect.cropY * 100).toFixed(2)
  const right = ((1 - rect.cropX - rect.cropWidth) * 100).toFixed(2)
  const bottom = ((1 - rect.cropY - rect.cropHeight) * 100).toFixed(2)
  const left = (rect.cropX * 100).toFixed(2)
  return `inset(${top}% ${right}% ${bottom}% ${left}%)`
}

const mainTransitionVideoStyle = computed(() => {
  const transition = activeMainTransition.value
  if (!transition) return { display: 'none' }
  const duration = Math.max(0.05, transition.to.transitionInSec ?? 0.5)
  const rawProgress = clamp01((playheadSec.value - transition.to.startSec) / duration)
  const progress = smoothstep01(rawProgress)
  const type = transition.to.transitionType ?? 'dissolve'
  const style: Record<string, string> = {
    display: 'block',
    opacity: '1'
  }
  const colorFilter = buildCssColorFilter(transition.to)
  if (colorFilter) style.filter = colorFilter
  if (type === 'dissolve') {
    style.opacity = `${progress}`
  } else if (type === 'fade' || type === 'fadeout' || type === 'fadein') {
    // Dip to black: 前半程旧画面暗入黑，后半程新画面从黑亮出
    const phaseIn = rawProgress < 0.5 ? 0 : smoothstep01((rawProgress - 0.5) * 2)
    style.opacity = `${phaseIn}`
    const br = (0.25 + 0.75 * phaseIn).toFixed(3)
    style.filter = colorFilter ? `${colorFilter} brightness(${br})` : `brightness(${br})`
  } else if (type === 'fadegrays') {
    style.opacity = `${progress}`
    const sat = Math.abs(rawProgress - 0.5) * 2
    style.filter = colorFilter
      ? `${colorFilter} saturate(${sat.toFixed(3)})`
      : `saturate(${sat.toFixed(3)})`
  } else if (type === 'flash') {
    // Dip to white: 中点白闪爆光过场
    const phaseIn = rawProgress < 0.45 ? 0 : smoothstep01((rawProgress - 0.45) / 0.55)
    const flashBoost = 1 + Math.max(0, 1 - Math.abs(rawProgress - 0.5) * 3.2) * 2.2
    style.opacity = `${phaseIn}`
    style.filter = colorFilter
      ? `${colorFilter} brightness(${flashBoost.toFixed(3)})`
      : `brightness(${flashBoost.toFixed(3)})`
  } else if (type === 'hblur' || type === 'distance') {
    style.opacity = `${progress}`
    const blurPx = ((1 - Math.abs(rawProgress - 0.5) * 2) * 8).toFixed(2)
    style.filter = colorFilter ? `${colorFilter} blur(${blurPx}px)` : `blur(${blurPx}px)`
  } else if (type === 'smoothleft') {
    style.opacity = `${clamp01(rawProgress * 1.25)}`
    style.transform = `translateX(${(1 - progress) * 42}%) scale(${(1.04 - 0.04 * progress).toFixed(3)})`
  } else if (type === 'smoothright') {
    style.opacity = `${clamp01(rawProgress * 1.25)}`
    style.transform = `translateX(${-(1 - progress) * 42}%) scale(${(1.04 - 0.04 * progress).toFixed(3)})`
  } else if (type === 'smoothup') {
    style.opacity = `${clamp01(rawProgress * 1.25)}`
    style.transform = `translateY(${(1 - progress) * 42}%) scale(${(1.04 - 0.04 * progress).toFixed(3)})`
  } else if (type === 'smoothdown') {
    style.opacity = `${clamp01(rawProgress * 1.25)}`
    style.transform = `translateY(${-(1 - progress) * 42}%) scale(${(1.04 - 0.04 * progress).toFixed(3)})`
  } else if (type === 'slideleft') {
    style.transform = `translateX(${(1 - progress) * 100}%)`
  } else if (type === 'slideright') {
    style.transform = `translateX(${-(1 - progress) * 100}%)`
  } else if (type === 'slideup') {
    style.transform = `translateY(${(1 - progress) * 100}%)`
  } else if (type === 'slidedown') {
    style.transform = `translateY(${-(1 - progress) * 100}%)`
  } else if (type === 'hrslice') {
    style.opacity = `${clamp01(rawProgress * 1.35)}`
    style.clipPath = `inset(0 ${(1 - progress) * 100}% 0 0)`
    style.transform = `translateX(${(1 - progress) * 18}%) scaleX(${(1.08 - 0.08 * progress).toFixed(3)})`
  } else if (type === 'hlslice') {
    style.opacity = `${clamp01(rawProgress * 1.35)}`
    style.clipPath = `inset(0 0 0 ${(1 - progress) * 100}%)`
    style.transform = `translateX(${-(1 - progress) * 18}%) scaleX(${(1.08 - 0.08 * progress).toFixed(3)})`
  } else if (type === 'vdslice') {
    style.opacity = `${clamp01(rawProgress * 1.35)}`
    style.clipPath = `inset(${(1 - progress) * 100}% 0 0 0)`
    style.transform = `translateY(${(1 - progress) * 18}%) scaleY(${(1.08 - 0.08 * progress).toFixed(3)})`
  } else if (type === 'vuslice') {
    style.opacity = `${clamp01(rawProgress * 1.35)}`
    style.clipPath = `inset(0 0 ${(1 - progress) * 100}% 0)`
    style.transform = `translateY(${-(1 - progress) * 18}%) scaleY(${(1.08 - 0.08 * progress).toFixed(3)})`
  } else if (type === 'wipeleft') {
    style.clipPath = `inset(0 ${(1 - progress) * 100}% 0 0)`
  } else if (type === 'wiperight') {
    style.clipPath = `inset(0 0 0 ${(1 - progress) * 100}%)`
  } else if (type === 'wipeup') {
    style.clipPath = `inset(${(1 - progress) * 100}% 0 0 0)`
  } else if (type === 'wipedown') {
    style.clipPath = `inset(0 0 ${(1 - progress) * 100}% 0)`
  } else if (type === 'wipetl') {
    style.clipPath = `inset(0 ${(1 - progress) * 100}% ${(1 - progress) * 100}% 0)`
  } else if (type === 'wipetr') {
    style.clipPath = `inset(0 0 ${(1 - progress) * 100}% ${(1 - progress) * 100}%)`
  } else if (type === 'wipebl') {
    style.clipPath = `inset(${(1 - progress) * 100}% ${(1 - progress) * 100}% 0 0)`
  } else if (type === 'wipebr') {
    style.clipPath = `inset(${(1 - progress) * 100}% 0 0 ${(1 - progress) * 100}%)`
  } else if (type === 'diagtl') {
    const p = (progress * 200).toFixed(2)
    style.clipPath = `polygon(0 0, ${p}% 0, 0 ${p}%)`
  } else if (type === 'diagbr') {
    const p = ((1 - progress) * 200).toFixed(2)
    style.clipPath = `polygon(100% 100%, ${100 - progress * 200}% 100%, 100% ${p}%)`
  } else if (type === 'circleopen' || type === 'radial') {
    style.clipPath = `circle(${progress * 75}% at 50% 50%)`
  } else if (type === 'circleclose') {
    style.clipPath = `circle(${(1 - progress) * 75}% at 50% 50%)`
  } else if (type === 'horzopen') {
    const side = ((1 - progress) * 50).toFixed(2)
    style.clipPath = `inset(0 ${side}% 0 ${side}%)`
  } else if (type === 'horzclose') {
    const side = (progress * 50).toFixed(2)
    style.clipPath = `inset(0 ${50 - Number(side)}% 0 ${50 - Number(side)}%)`
  } else if (type === 'vertopen') {
    const side = ((1 - progress) * 50).toFixed(2)
    style.clipPath = `inset(${side}% 0 ${side}% 0)`
  } else if (type === 'vertclose') {
    const side = (progress * 50).toFixed(2)
    style.clipPath = `inset(${50 - Number(side)}% 0 ${50 - Number(side)}% 0)`
  } else if (type === 'rectcrop') {
    const side = ((1 - progress) * 48).toFixed(2)
    style.clipPath = `inset(${side}% ${side}% ${side}% ${side}%)`
  } else if (type === 'squeezeh') {
    style.opacity = `${progress}`
    style.transform = `scaleX(${Math.max(0.05, progress).toFixed(3)})`
  } else if (type === 'squeezev') {
    style.opacity = `${progress}`
    style.transform = `scaleY(${Math.max(0.05, progress).toFixed(3)})`
  } else if (type === 'zoomin') {
    style.opacity = `${progress}`
    style.transform = `scale(${(0.72 + 0.28 * progress).toFixed(3)})`
  } else if (type === 'pixelize') {
    style.opacity = `${progress}`
    const blurPx = ((1 - Math.abs(rawProgress - 0.5) * 2) * 6).toFixed(2)
    style.filter = colorFilter ? `${colorFilter} blur(${blurPx}px)` : `blur(${blurPx}px)`
  }
  if (!style.clipPath) {
    const cropClip = buildCssCropClipPath(transition.to)
    if (cropClip) style.clipPath = cropClip
  }
  return style
})

function buildCssColorFilter(
  clip: ScriptTimelineClip | null | undefined,
  includeSvgFilter = false
): string {
  if (!clip) return ''
  const localSec = effectiveClipLocalTimeSec(clip)
  const cssFilter = buildClipVisualCssFilter(clip, localSec) ?? ''
  if (!includeSvgFilter) return cssFilter
  const svgMeta = buildClipVisualSvgFilterMeta(clip, localSec)
  if (!svgMeta.enabled) return cssFilter
  return cssFilter
    ? `${cssFilter} url(#timeline-stage-fx-filter)`
    : 'url(#timeline-stage-fx-filter)'
}

const activeSvgFilterMeta = computed(() => {
  const activeClip = previewDisplayedVideoClip.value
  return buildClipVisualSvgFilterMeta(activeClip, effectiveClipLocalTimeSec(activeClip))
})

const svgFilterPreMosaicInput = computed(() =>
  activeSvgFilterMeta.value.posterizeTable ? 'stepPoster' : 'stepColor'
)

const svgFilterPreSharpenInput = computed(() => {
  if (activeSvgFilterMeta.value.mosaicRadius > 0) return 'stepMosaic'
  if (activeSvgFilterMeta.value.posterizeTable) return 'stepPoster'
  return 'stepColor'
})

const svgFilterPreRgbInput = computed(() => {
  if (activeSvgFilterMeta.value.sharpenAmount > 0.02) return 'stepSharpen'
  if (activeSvgFilterMeta.value.mosaicRadius > 0) return 'stepMosaic'
  if (activeSvgFilterMeta.value.posterizeTable) return 'stepPoster'
  return 'stepColor'
})

const activeSplitCloneFilter = computed(() =>
  buildCssColorFilter(previewDisplayedVideoClip.value, false)
)

const activeVisualOverlayMeta = computed(() => {
  const activeClip = previewDisplayedVideoClip.value ?? selectedOverlayClip.value
  return buildClipVisualOverlayMeta(activeClip, effectiveClipLocalTimeSec(activeClip))
})

/**
 * 转场期间把主视频（A）钳制到导出框画布内，与转场叠加层（B）共享同一几何，
 * 否则 A 铺满舞台而 B 只在导出框内，会出现“B 被缩放叠在小窗里”的假象。
 * A 在框内同样 object-fit: contain（等价导出端 scale+pad 黑边语义）。
 * 当预览以导出画幅为基准（previewFrameRatioKey === 'export'，默认）时全程保持钳制，
 * 保证转场进/出点画布一致不跳变。
 */
const previewVideoTransitionStyle = computed<Record<string, string> | null>(() => {
  const rect = previewFrameRect.value
  const activeClip = previewDisplayedVideoClip.value
  let filter = buildCssColorFilter(activeClip, true)
  const cropClip =
    !cropMode.value && activeClip?.track === 'video' ? buildCssCropClipPath(activeClip) : ''
  let outgoingTransform = ''

  const transition = activeMainTransition.value
  if (transition) {
    const duration = Math.max(0.05, transition.to.transitionInSec ?? 0.5)
    const rawProgress = clamp01((playheadSec.value - transition.to.startSec) / duration)
    const progress = smoothstep01(rawProgress)
    const type = transition.to.transitionType ?? 'dissolve'
    if (type === 'fade' || type === 'fadeout' || type === 'fadein') {
      const fadeOutBr = Math.max(0, 1 - smoothstep01(rawProgress * 1.85)).toFixed(3)
      filter = filter ? `${filter} brightness(${fadeOutBr})` : `brightness(${fadeOutBr})`
    } else if (type === 'flash') {
      const flashBoost = (1 + Math.max(0, 1 - Math.abs(rawProgress - 0.45) * 3) * 2.2).toFixed(3)
      filter = filter ? `${filter} brightness(${flashBoost})` : `brightness(${flashBoost})`
    } else if (type === 'slideleft') {
      outgoingTransform = `translateX(${-progress * 100}%)`
    } else if (type === 'slideright') {
      outgoingTransform = `translateX(${progress * 100}%)`
    } else if (type === 'slideup') {
      outgoingTransform = `translateY(${-progress * 100}%)`
    } else if (type === 'slidedown') {
      outgoingTransform = `translateY(${progress * 100}%)`
    } else if (type === 'smoothleft') {
      outgoingTransform = `translateX(${-progress * 36}%) scale(${(1 - 0.04 * progress).toFixed(3)})`
    } else if (type === 'smoothright') {
      outgoingTransform = `translateX(${progress * 36}%) scale(${(1 - 0.04 * progress).toFixed(3)})`
    } else if (type === 'smoothup') {
      outgoingTransform = `translateY(${-progress * 36}%) scale(${(1 - 0.04 * progress).toFixed(3)})`
    } else if (type === 'smoothdown') {
      outgoingTransform = `translateY(${progress * 36}%) scale(${(1 - 0.04 * progress).toFixed(3)})`
    } else if (type === 'zoomin') {
      outgoingTransform = `scale(${(1 + 0.24 * progress).toFixed(3)})`
    } else if (type === 'squeezeh') {
      outgoingTransform = `scaleX(${Math.max(0.05, 1 - progress).toFixed(3)})`
    } else if (type === 'squeezev') {
      outgoingTransform = `scaleY(${Math.max(0.05, 1 - progress).toFixed(3)})`
    }
  }

  const clipLocalSec = effectiveClipLocalTimeSec(activeClip)
  if (
    !outgoingTransform &&
    activeClip?.track === 'video' &&
    activeClip.cameraMotion &&
    activeClip.cameraMotion !== 'none'
  ) {
    const cam = evaluateMainClipCameraTransform(activeClip, clipLocalSec)
    outgoingTransform = `translate(${cam.translateXPercent.toFixed(2)}%, ${cam.translateYPercent.toFixed(2)}%) scale(${cam.scale.toFixed(3)})`
  }

  if (activeClip) {
    const fxTransform = buildClipVisualCssTransform(activeClip, clipLocalSec)
    if (fxTransform) {
      outgoingTransform = outgoingTransform ? `${outgoingTransform} ${fxTransform}` : fxTransform
    }
  }

  const extras: Record<string, string> = {
    ...(filter ? { filter } : {}),
    ...(cropClip ? { clipPath: cropClip } : {}),
    ...(outgoingTransform ? { transform: outgoingTransform } : {}),
    ...(activeClip?.visualEffect === 'pixel-mosaic' ? { imageRendering: 'pixelated' } : {})
  }

  if (!(rect.width > 1) || !(rect.height > 1)) {
    return Object.keys(extras).length ? extras : null
  }
  if (previewFrameRatioKey.value !== 'export' && !activeMainTransition.value) {
    return Object.keys(extras).length ? extras : null
  }
  return {
    position: 'absolute',
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    objectFit: scaleMode.value === 'cover' ? 'cover' : 'contain',
    ...extras
  }
})

interface VideoTransitionHandle {
  left: ScriptTimelineClip
  right: ScriptTimelineClip
  startSec: number
  durationSec: number
  maxSec: number
  maxDurationSec: number
  transitionType: ScriptTimelineTransitionType
}

const videoTransitionHandles = computed<VideoTransitionHandle[]>(() => {
  const list = clipsOn('video')
  const handles: VideoTransitionHandle[] = []
  for (let i = 0; i < list.length - 1; i++) {
    const left = list[i]!
    const right = list[i + 1]!
    const rightStart = right.startSec
    const leftEnd = left.startSec + left.durationSec
    const maxSec = Math.max(
      0.1,
      Math.floor((Math.min(left.durationSec, right.durationSec) - 0.1) * 10) / 10
    )
    const durationSec = rightStart >= leftEnd ? 0 : Math.max(0, leftEnd - rightStart)
    const transitionType: ScriptTimelineTransitionType =
      durationSec > 0
        ? right.transitionType && right.transitionType !== 'none'
          ? right.transitionType
          : 'dissolve'
        : 'none'
    handles.push({
      left,
      right,
      startSec: rightStart >= leftEnd ? leftEnd : rightStart,
      durationSec,
      maxSec,
      maxDurationSec: maxSec,
      transitionType
    })
  }
  return handles
})

const previewFrameRatioOptions = computed(() => [
  {
    key: 'video',
    label: t('script.timeline.previewFrameRatioVideo'),
    ratio: null as number | null
  },
  {
    key: 'export',
    label: t('script.timeline.previewFrameRatioExport'),
    ratio: null as number | null
  },
  { key: '16:9', label: '16:9', ratio: 16 / 9 },
  { key: '9:16', label: '9:16', ratio: 9 / 16 },
  { key: '1:1', label: '1:1', ratio: 1 },
  { key: '4:3', label: '4:3', ratio: 4 / 3 },
  { key: '3:4', label: '3:4', ratio: 3 / 4 }
])

const previewFrameRatioLabel = computed(() => {
  if (previewFrameRatioKey.value === 'export') {
    return `${exportWidth.value} × ${exportHeight.value}`
  }
  if (previewFrameRatioKey.value === 'video') {
    return previewVideoMeta.value.width && previewVideoMeta.value.height
      ? `${previewVideoMeta.value.width} × ${previewVideoMeta.value.height}`
      : t('script.timeline.previewFrameRatioVideo')
  }
  return (
    previewFrameRatioOptions.value.find((item) => item.key === previewFrameRatioKey.value)?.label ??
    previewFrameRatioKey.value
  )
})

const previewFrameStyle = computed(() => ({
  left: `${previewFrameRect.value.left}px`,
  top: `${previewFrameRect.value.top}px`,
  width: `${previewFrameRect.value.width}px`,
  height: `${previewFrameRect.value.height}px`
}))

const clipDragPreviewClip = computed(
  () => clips.value.find((clip) => clip.id === clipDragPreview.value?.clipId) ?? null
)

const clipDragPreviewStyle = computed(() => {
  const preview = clipDragPreview.value
  const clip = clipDragPreviewClip.value
  if (!preview || !clip) return { display: 'none' }
  return {
    display: 'flex',
    left: `${TRACK_LABEL_W + timeToX(preview.startSec)}px`,
    top: `${trackTopOffset(preview.track) + 8}px`,
    width: `${Math.max(36, timeToX(clip.durationSec))}px`,
    height: `${Math.max(20, trackHeight.value - 16)}px`
  }
})

const canSplitActiveClip = computed(() => {
  const clip = clips.value.find((c) => c.id === activeClipId.value)
  if (!clip || lockedTracks.value.has(clip.track)) return false
  const tSec = playheadSec.value
  return (
    tSec > clip.startSec + MIN_CLIP_SEC && tSec < clip.startSec + clip.durationSec - MIN_CLIP_SEC
  )
})

const canTrimInAtPlayhead = computed(() => {
  const clip = selectedClip.value ?? clipAtPlayhead()
  if (!clip || lockedTracks.value.has(clip.track)) return false
  return !!trimTimelineClipToTime(clip, playheadSec.value, 'in', MIN_CLIP_SEC)
})

const canTrimOutAtPlayhead = computed(() => {
  const clip = selectedClip.value ?? clipAtPlayhead()
  if (!clip || lockedTracks.value.has(clip.track)) return false
  return !!trimTimelineClipToTime(clip, playheadSec.value, 'out', MIN_CLIP_SEC)
})

function trimActiveClipAtPlayhead(edge: 'in' | 'out'): void {
  const clip = selectedClip.value ?? clipAtPlayhead()
  if (!clip || lockedTracks.value.has(clip.track)) return
  const trimmed = trimTimelineClipToTime(clip, playheadSec.value, edge, MIN_CLIP_SEC)
  if (!trimmed) return
  commitClips(clips.value.map((c) => (c.id === clip.id ? trimmed : c)))
  activeClipId.value = trimmed.id
  selectedClipIds.value = new Set([trimmed.id])
  void syncPreviewToPlayhead()
  scheduleSave()
}

function toggleRazorMode(): void {
  razorMode.value = !razorMode.value
  if (!razorMode.value) razorHover.value = null
}

function formatSubsecond(sec: number): string {
  const s = Math.max(0, sec)
  const m = Math.floor(s / 60)
  const r = (s - m * 60).toFixed(1).padStart(4, '0')
  return `${m}:${r}`
}

function onClipPointerHover(e: PointerEvent, clip: ScriptTimelineClip): void {
  if (!razorMode.value || lockedTracks.value.has(clip.track)) {
    if (razorHover.value) razorHover.value = null
    return
  }
  const lane = laneRectForTrack(clip.track)
  if (!lane) return
  const rawSec = xToTime(e.clientX - lane.left)
  if (
    rawSec <= clip.startSec + MIN_CLIP_SEC ||
    rawSec >= clip.startSec + clip.durationSec - MIN_CLIP_SEC
  ) {
    razorHover.value = null
    return
  }
  razorHover.value = {
    clipId: clip.id,
    localX: Math.max(2, timeToX(rawSec - clip.startSec)),
    timeSec: Math.round(rawSec * 100) / 100
  }
}

function onClipPointerLeave(clip: ScriptTimelineClip): void {
  if (razorHover.value?.clipId === clip.id) {
    razorHover.value = null
  }
}

function splitClipAtTime(clip: ScriptTimelineClip, cutSec: number): boolean {
  if (lockedTracks.value.has(clip.track)) return false
  const split = splitTimelineClipAtTime(clip, cutSec, newClipId(), MIN_CLIP_SEC)
  if (!split) return false
  const [first, second] = split
  commitClips(
    clips.value.flatMap((c) => {
      if (c.id !== clip.id) return [c]
      return [first, second]
    })
  )
  activeClipId.value = second.id
  selectedClipIds.value = new Set([second.id])
  playheadSec.value = second.startSec
  razorHover.value = null
  scheduleSave()
  return true
}

/** ── 画面裁剪（Frame Crop）状态与交互 ── */
const selectedCroppableClip = computed(() => {
  const clip = selectedClip.value ?? clipAtPlayhead()
  if (!clip) return null
  return clip.track === 'video' || clip.track === 'overlay' ? clip : null
})

const canCropSelectedClip = computed(() => {
  const clip = selectedCroppableClip.value
  return !!clip && !lockedTracks.value.has(clip.track)
})

const activeCropRect = computed(() => normalizeClipCropRect(selectedCroppableClip.value))

const cropBoxOverlayStyle = computed<Record<string, string>>(() => {
  const rect = activeCropRect.value
  return {
    left: `${(rect.cropX * 100).toFixed(2)}%`,
    top: `${(rect.cropY * 100).toFixed(2)}%`,
    width: `${(rect.cropWidth * 100).toFixed(2)}%`,
    height: `${(rect.cropHeight * 100).toFixed(2)}%`
  }
})

function toggleCropMode(): void {
  if (!cropMode.value && !selectedCroppableClip.value) {
    const first = clipAtPlayhead() ?? visibleClipsOn('video')[0]
    if (first) selectClip(first)
  }
  cropMode.value = !cropMode.value
}

function applyClipCropPreset(presetKey: 'free' | '16:9' | '9:16' | '1:1' | '4:3'): void {
  const clip = selectedCroppableClip.value
  if (!clip || lockedTracks.value.has(clip.track)) return
  cropMode.value = true
  if (presetKey === 'free') return
  const preset = CROP_ASPECT_PRESETS.find((item) => item.key === presetKey)
  if (!preset?.ratio) return
  const sourceW = previewVideoMeta.value.width || exportWidth.value || 1280
  const sourceH = previewVideoMeta.value.height || exportHeight.value || 720
  const sourceAspect = sourceW / Math.max(1, sourceH)
  const targetRatio = preset.ratio
  let cropWidth = 1
  let cropHeight = 1
  if (targetRatio > sourceAspect) {
    cropWidth = 1
    cropHeight = Math.min(1, Math.max(0.05, sourceAspect / targetRatio))
  } else {
    cropHeight = 1
    cropWidth = Math.min(1, Math.max(0.05, targetRatio / sourceAspect))
  }
  const normalized = normalizeClipCropRect({
    cropX: (1 - cropWidth) / 2,
    cropY: (1 - cropHeight) / 2,
    cropWidth,
    cropHeight
  })
  commitClips(
    clips.value.map((c) =>
      c.id === clip.id
        ? {
            ...c,
            cropX: normalized.cropX,
            cropY: normalized.cropY,
            cropWidth: normalized.cropWidth,
            cropHeight: normalized.cropHeight
          }
        : c
    )
  )
  scheduleSave()
}

function onClipCropFieldChange(
  field: 'cropX' | 'cropY' | 'cropWidth' | 'cropHeight',
  value: number
): void {
  const clip = selectedCroppableClip.value
  if (!clip || lockedTracks.value.has(clip.track)) return
  const current = normalizeClipCropRect(clip)
  const next = normalizeClipCropRect({
    ...current,
    [field]: Number.isFinite(value) ? value : current[field]
  })
  commitClips(
    clips.value.map((c) =>
      c.id === clip.id
        ? {
            ...c,
            cropX: next.cropX,
            cropY: next.cropY,
            cropWidth: next.cropWidth,
            cropHeight: next.cropHeight
          }
        : c
    )
  )
  scheduleSave()
}

function resetClipCrop(): void {
  const clip = selectedCroppableClip.value
  if (!clip || lockedTracks.value.has(clip.track)) return
  commitClips(
    clips.value.map((c) =>
      c.id === clip.id
        ? {
            ...c,
            cropX: undefined,
            cropY: undefined,
            cropWidth: undefined,
            cropHeight: undefined
          }
        : c
    )
  )
  scheduleSave()
}

function bindCropDragListeners(): void {
  window.addEventListener('pointermove', onCropPointerMove)
  window.addEventListener('pointerup', onCropPointerUp)
  window.addEventListener('pointercancel', onCropPointerUp)
}

function unbindCropDragListeners(): void {
  window.removeEventListener('pointermove', onCropPointerMove)
  window.removeEventListener('pointerup', onCropPointerUp)
  window.removeEventListener('pointercancel', onCropPointerUp)
}

function onCropPointerDown(e: PointerEvent, _clip?: ScriptTimelineClip | null): void {
  if (e.button !== 0) return
  const clip = _clip ?? selectedCroppableClip.value
  if (!clip || lockedTracks.value.has(clip.track)) return
  const target = e.target as HTMLElement | null
  const handleEl = target?.closest('.crop-handle') as HTMLElement | null
  const rawHandle = handleEl?.dataset.handle ?? handleEl?.dataset.corner
  const handle = (rawHandle as CropHandleKind | undefined) ?? 'move'
  const rect = normalizeClipCropRect(clip)
  unbindCropDragListeners()
  cropDrag.value = {
    clipId: clip.id,
    pointerId: e.pointerId,
    handle,
    startX: e.clientX,
    startY: e.clientY,
    startCropX: rect.cropX,
    startCropY: rect.cropY,
    startCropW: rect.cropWidth,
    startCropH: rect.cropHeight,
    moved: false,
    beforeClips: snapshotClips()
  }
  bindCropDragListeners()
  e.preventDefault()
}

function onCropPointerMove(e: PointerEvent): void {
  const session = cropDrag.value
  if (!session || e.pointerId !== session.pointerId) return
  const canvas = previewCanvasEl.value
  if (!canvas) return
  const rect = canvas.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return
  const dx = (e.clientX - session.startX) / rect.width
  const dy = (e.clientY - session.startY) / rect.height
  const minSize = 0.05

  let cropX = session.startCropX
  let cropY = session.startCropY
  let cropWidth = session.startCropW
  let cropHeight = session.startCropH

  if (session.handle === 'move') {
    cropX = Math.min(Math.max(0, session.startCropX + dx), 1 - cropWidth)
    cropY = Math.min(Math.max(0, session.startCropY + dy), 1 - cropHeight)
  } else {
    const right = session.startCropX + session.startCropW
    const bottom = session.startCropY + session.startCropH
    if (session.handle.includes('l')) {
      cropX = Math.min(Math.max(0, session.startCropX + dx), right - minSize)
      cropWidth = right - cropX
    } else if (session.handle.includes('r')) {
      const nextRight = Math.max(session.startCropX + minSize, Math.min(1, right + dx))
      cropWidth = nextRight - session.startCropX
    }
    if (session.handle.includes('t')) {
      cropY = Math.min(Math.max(0, session.startCropY + dy), bottom - minSize)
      cropHeight = bottom - cropY
    } else if (session.handle.includes('b')) {
      const nextBottom = Math.max(session.startCropY + minSize, Math.min(1, bottom + dy))
      cropHeight = nextBottom - session.startCropY
    }
  }

  const normalized = normalizeClipCropRect({ cropX, cropY, cropWidth, cropHeight })
  session.moved = true
  clips.value = clips.value.map((c) =>
    c.id === session.clipId
      ? {
          ...c,
          cropX: normalized.cropX,
          cropY: normalized.cropY,
          cropWidth: normalized.cropWidth,
          cropHeight: normalized.cropHeight
        }
      : c
  )
}

function onCropPointerUp(e: PointerEvent): void {
  const session = cropDrag.value
  if (!session || e.pointerId !== session.pointerId) return
  cropDrag.value = null
  unbindCropDragListeners()
  if (session.moved) {
    pushHistorySnapshot(session.beforeClips)
    scheduleSave()
  }
}

/** ── 专业视频转场选择器与状态 ── */
function transitionShortLabel(type: string | undefined): string {
  const item = TRANSITION_CATALOG.find((entry) => entry.type === (type || 'none'))
  if (item && item.shortKey) return t(item.shortKey)
  const creativeTr = TIMELINE_TRANSITION_CATALOG.find((entry) => entry.id === type)
  if (creativeTr) return isZhLocale.value ? creativeTr.labelZh : creativeTr.labelEn
  return t('script.timeline.transitionDissolve')
}

const filteredTransitionCatalog = computed(() =>
  activeTransitionCategory.value === 'all'
    ? TRANSITION_CATALOG
    : TRANSITION_CATALOG.filter((item) => item.category === activeTransitionCategory.value)
)

const selectedTransitionPair = computed<VideoTransitionHandle | null>(() => {
  const clip = selectedClip.value
  if (!clip || clip.track !== 'video') return null
  const handles = videoTransitionHandles.value
  const asRight = handles.find((h) => h.right.id === clip.id)
  if (asRight) return asRight
  return handles.find((h) => h.left.id === clip.id) ?? null
})

const activePopoverTransitionPair = computed<VideoTransitionHandle | null>(() => {
  const pop = transitionPopover.value
  if (!pop) return null
  return (
    videoTransitionHandles.value.find(
      (h) => h.left.id === pop.leftId && h.right.id === pop.rightId
    ) ?? null
  )
})

const transitionPopoverStyle = computed<Record<string, string>>(() => {
  const pop = transitionPopover.value
  const emptyStyle: Record<string, string> = { display: 'none' }
  if (!pop) return emptyStyle
  const rootRect = rootEl.value?.getBoundingClientRect()
  const relX = rootRect ? pop.anchorX - rootRect.left : pop.anchorX
  const relY = rootRect ? pop.anchorY - rootRect.top : pop.anchorY
  const maxLeft = Math.max(16, (rootRect?.width ?? 900) - 356)
  const left = Math.min(maxLeft, Math.max(12, relX - 168))
  const bottom = Math.max(48, (rootRect?.height ?? 640) - relY + 14)
  const style: Record<string, string> = {
    left: `${Math.round(left)}px`,
    bottom: `${Math.round(bottom)}px`
  }
  return style
})

let transitionSweepRafId = 0
let transitionDurationDebounceTimer: ReturnType<typeof setTimeout> | null = null

function cancelTransitionSweep(): void {
  if (transitionSweepRafId) {
    cancelAnimationFrame(transitionSweepRafId)
    transitionSweepRafId = 0
  }
  if (transitionDurationDebounceTimer) {
    clearTimeout(transitionDurationDebounceTimer)
    transitionDurationDebounceTimer = null
  }
}

/**
 * 选中或调整转场后，自动将底层画面切到左片段（A）、叠加层切到右片段（B），
 * 并按真实转场时长（dur 秒）以 60fps 扫掠播放头完整演示一次转场过程，
 * 演示期间主视频与转场叠加视频同步解码推进，所见即所得。
 */
async function previewTransitionBetweenClips(leftId: string, rightId: string): Promise<void> {
  cancelTransitionSweep()
  if (playing.value) stopPlayback()
  const left = clips.value.find((c) => c.id === leftId)
  const right = clips.value.find((c) => c.id === rightId)
  if (!left || !right) return

  const dur = Math.max(0, right.transitionInSec ?? 0)
  if (!right.transitionType || right.transitionType === 'none' || dur <= 0.02) {
    playheadSec.value = clipSafePreviewTimeSec(right)
    void showClipPreview(right)
    return
  }

  void ensureTransitionPreview({ from: left, to: right })
  const [leftUrl, rightUrl] = await Promise.all([resolveSrc(left), resolveSrc(right)])
  if (leftUrl) {
    previewLoadedClipId.value = left.id
    if (previewSrc.value !== leftUrl) {
      previewSrc.value = leftUrl
    }
  }
  if (rightUrl) {
    transitionOverlayImageUrl.value = rightUrl
    if (!clipResolvedUrls.value[right.id]) {
      clipResolvedUrls.value = { ...clipResolvedUrls.value, [right.id]: rightUrl }
    }
  }

  const startSec = right.startSec
  const endSec = Math.max(
    startSec + 0.05,
    Math.min(left.startSec + left.durationSec, right.startSec + dur)
  )
  // 严格按真实转场时长（毫秒）扫掠，让用户直观感受 0.3s / 0.8s / 1.5s 的真实快慢差异
  const sweepDurationMs = Math.max(120, Math.round((endSec - startSec) * 1000))
  playheadSec.value = startSec
  await nextTick()

  const mainEl = previewEl.value
  if (mainEl && !isImageOrGifClip(left) && !isImageOrGifUrl(leftUrl)) {
    try {
      applyPlaybackRate()
      const leftLocal = Math.max(0, startSec - left.startSec)
      mainEl.currentTime = mediaTimeForClip(left, leftLocal)
      void mainEl.play().catch(() => undefined)
    } catch {
      /* ignore */
    }
  }
  await syncOverlayVideosToPlayhead(true)
  const startedAt = performance.now()

  const tick = (now: number) => {
    const tNorm = Math.min(1, (now - startedAt) / sweepDurationMs)
    if (tNorm < 1) {
      playheadSec.value = Number((startSec + (endSec - startSec) * tNorm).toFixed(3))
      transitionSweepRafId = requestAnimationFrame(tick)
    } else {
      // 扫掠演示完毕：停在转场窗口内偏后位置（75%），保持转场手柄与切点检查器上下文不丢失，同时定格展示合成效果
      const settleSec = Number((startSec + (endSec - startSec) * 0.75).toFixed(3))
      playheadSec.value = settleSec
      transitionSweepRafId = 0
      if (mainEl && !mainEl.paused) {
        try {
          mainEl.pause()
        } catch {
          /* ignore */
        }
      }
      void syncOverlayVideosToPlayhead(false)
    }
  }
  transitionSweepRafId = requestAnimationFrame(tick)
}

function onSelectPairTransitionType(
  pair: VideoTransitionHandle,
  type: ScriptTimelineTransitionType
): void {
  if (lockedTracks.value.has('video')) return
  const currentSec =
    pair.right.transitionInSec && pair.right.transitionInSec > 0
      ? pair.right.transitionInSec
      : browserTransitionDurationSec.value || 0.6
  const updated = applyVideoTransitionBetweenClips(clips.value, pair.left.id, pair.right.id, {
    transitionType: type,
    durationSec: type === 'none' ? 0 : currentSec
  })
  commitClips(updated)
  activeClipId.value = pair.right.id
  selectedClipIds.value = new Set([pair.right.id])
  void previewTransitionBetweenClips(pair.left.id, pair.right.id)
  scheduleSave()
}

function onInputPairTransitionDuration(pair: VideoTransitionHandle, durationSec: number): void {
  if (lockedTracks.value.has('video')) return
  cancelTransitionSweep()
  browserTransitionDurationSec.value = durationSec
  const type =
    pair.right.transitionType && pair.right.transitionType !== 'none'
      ? pair.right.transitionType
      : 'dissolve'
  clips.value = applyVideoTransitionBetweenClips(clips.value, pair.left.id, pair.right.id, {
    transitionType: type,
    durationSec
  })
  const updatedRight = clips.value.find((c) => c.id === pair.right.id)
  if (updatedRight) {
    const dur = Math.max(0.05, updatedRight.transitionInSec ?? durationSec)
    playheadSec.value = Number((updatedRight.startSec + dur * 0.5).toFixed(3))
    void syncOverlayVideosToPlayhead(false)
  }
  transitionDurationDebounceTimer = setTimeout(() => {
    transitionDurationDebounceTimer = null
    void previewTransitionBetweenClips(pair.left.id, pair.right.id)
  }, 180)
  scheduleSave()
}

function onSelectPairTransitionDuration(pair: VideoTransitionHandle, durationSec: number): void {
  if (lockedTracks.value.has('video')) return
  browserTransitionDurationSec.value = durationSec
  const type =
    pair.right.transitionType && pair.right.transitionType !== 'none'
      ? pair.right.transitionType
      : 'dissolve'
  const updated = applyVideoTransitionBetweenClips(clips.value, pair.left.id, pair.right.id, {
    transitionType: type,
    durationSec
  })
  commitClips(updated)
  void previewTransitionBetweenClips(pair.left.id, pair.right.id)
  scheduleSave()
}

function applyCurrentTransitionToAllCuts(pair: VideoTransitionHandle): void {
  if (lockedTracks.value.has('video')) return
  const type = pair.right.transitionType ?? 'none'
  const durationSec = pair.right.transitionInSec ?? 0.6
  const updated = applyVideoTransitionToAllCuts(clips.value, type, durationSec)
  commitClips(updated)
  void previewTransitionBetweenClips(pair.left.id, pair.right.id)
  scheduleSave()
}

function sourcesInGroup(groupId: string): ScriptTimelineSource[] {
  return importedSources.value.filter((s) => s.groupId === groupId)
}

function toggleGroupCollapsed(groupId: string): void {
  const next = new Set(collapsedGroupIds.value)
  if (next.has(groupId)) next.delete(groupId)
  else next.add(groupId)
  collapsedGroupIds.value = next
}

function closeSourceCtx(): void {
  sourceCtx.value = null
}

function onImportedPanelContextMenu(e: MouseEvent): void {
  sourceCtx.value = { x: e.clientX, y: e.clientY, groupId: null }
}

function onGroupContextMenu(e: MouseEvent, groupId: string): void {
  sourceCtx.value = { x: e.clientX, y: e.clientY, groupId }
}

function isImportedSourceDrag(e: DragEvent): boolean {
  const types = e.dataTransfer ? Array.from(e.dataTransfer.types) : []
  // 仅导入项带 SOURCE_MOVE_MIME；节点输入只有 DRAFT_MIME，不应高亮分组
  return types.includes(SOURCE_MOVE_MIME)
}

function onImportedRootDragOver(e: DragEvent): void {
  if (!isImportedSourceDrag(e)) return
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
}

function onImportedRootDrop(e: DragEvent): void {
  // 落到面板空白处：移出分组
  void moveImportedSourceToGroup(e, null)
}

function onGroupDragOver(e: DragEvent, groupId: string): void {
  if (!isImportedSourceDrag(e)) return
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
  dropGroupId.value = groupId
}

function onGroupDragLeave(e: DragEvent, groupId: string): void {
  const related = e.relatedTarget as Node | null
  const el = e.currentTarget as HTMLElement | null
  if (related && el?.contains(related)) return
  if (dropGroupId.value === groupId) dropGroupId.value = null
}

function onGroupDrop(e: DragEvent, groupId: string): void {
  dropGroupId.value = null
  void moveImportedSourceToGroup(e, groupId || null)
}

async function moveImportedSourceToGroup(e: DragEvent, groupId: string | null): Promise<void> {
  const id =
    e.dataTransfer?.getData(SOURCE_MOVE_MIME) ||
    (() => {
      const raw = e.dataTransfer?.getData(DRAFT_MIME)
      if (!raw) return ''
      try {
        const parsed = JSON.parse(raw) as { id?: string }
        return typeof parsed.id === 'string' ? parsed.id : ''
      } catch {
        return ''
      }
    })()
  if (!id) return
  const src = sources.value.find((s) => s.id === id)
  if (!src || src.origin !== 'imported') return
  const nextGroupId = groupId && sourceGroups.value.some((g) => g.id === groupId) ? groupId : null
  if ((src.groupId ?? null) === nextGroupId) return
  sources.value = sources.value.map((s) => (s.id === id ? { ...s, groupId: nextGroupId } : s))
  scheduleSave()
}

async function createImportedGroup(): Promise<void> {
  closeSourceCtx()
  const name = await promptText({
    title: t('script.timeline.createGroup'),
    message: t('script.timeline.groupNamePrompt'),
    defaultValue: t('script.timeline.groupNameDefault', {
      n: sourceGroups.value.length + 1
    }),
    placeholder: t('script.timeline.groupNamePlaceholder')
  })
  if (name == null) return
  const title =
    name.trim() ||
    t('script.timeline.groupNameDefault', {
      n: sourceGroups.value.length + 1
    })
  const group: ScriptTimelineSourceGroup = {
    id: `sg:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 6)}`,
    title
  }
  sourceGroups.value = [...sourceGroups.value, group]
  scheduleSave()
}

async function renameImportedGroup(): Promise<void> {
  const groupId = sourceCtx.value?.groupId
  closeSourceCtx()
  const group = sourceGroups.value.find((g) => g.id === groupId)
  if (!group) return
  const name = await promptText({
    title: t('script.timeline.renameGroup'),
    message: t('script.timeline.groupNamePrompt'),
    defaultValue: group.title,
    placeholder: t('script.timeline.groupNamePlaceholder')
  })
  if (name == null) return
  const title = name.trim()
  if (!title) return
  sourceGroups.value = sourceGroups.value.map((g) => (g.id === group.id ? { ...g, title } : g))
  scheduleSave()
}

async function deleteImportedGroup(): Promise<void> {
  const groupId = sourceCtx.value?.groupId
  closeSourceCtx()
  if (!groupId) return
  const group = sourceGroups.value.find((g) => g.id === groupId)
  if (!group) return
  const ok = await promptConfirm({
    title: t('script.timeline.deleteGroup'),
    message: t('script.timeline.deleteGroupConfirm', { name: group.title })
  })
  if (!ok) return
  sourceGroups.value = sourceGroups.value.filter((g) => g.id !== groupId)
  sources.value = sources.value.map((s) =>
    s.origin === 'imported' && s.groupId === groupId ? { ...s, groupId: null } : s
  )
  const collapsed = new Set(collapsedGroupIds.value)
  collapsed.delete(groupId)
  collapsedGroupIds.value = collapsed
  scheduleSave()
}

function sourceMediaKind(src: ScriptTimelineSource): ScriptTimelineSourceMediaKind {
  return src.mediaKind === 'voice' ? 'voice' : 'video'
}

function sourceMediaLabel(src: ScriptTimelineSource): string {
  return sourceMediaKind(src) === 'voice'
    ? t('script.timeline.track.voice')
    : t('script.timeline.track.video')
}

function sourceThumbClass(src: ScriptTimelineSource): string {
  return sourceMediaKind(src) === 'voice' ? 'voice' : 'video'
}

function sourceRelativePath(source: { relativePath?: string; assetId?: string }): string {
  return (
    source.relativePath?.trim() ||
    (source.assetId
      ? project.assets.find((a) => a.id === source.assetId)?.relativePath?.trim()
      : '') ||
    ''
  )
}

async function loadSourceThumb(src: ScriptTimelineSource): Promise<void> {
  if (sourceMediaKind(src) === 'voice') return
  const rel = sourceRelativePath(src)
  if (!rel) return
  if (sourceThumbPathById.get(src.id) === rel && sourceThumbUrls.value[src.id]) return
  try {
    const url = await resolveAssetPreviewUrl(rel)
    if (!url) return
    sourceThumbPathById.set(src.id, rel)
    sourceThumbUrls.value = { ...sourceThumbUrls.value, [src.id]: url }
  } catch {
    /* 首帧提取失败时保留类型占位色 */
  }
}

async function refreshSourceThumbs(): Promise<void> {
  const alive = new Set(sources.value.map((s) => s.id))
  for (const id of [...sourceThumbPathById.keys()]) {
    if (alive.has(id)) continue
    sourceThumbPathById.delete(id)
    if (sourceThumbUrls.value[id]) {
      const next = { ...sourceThumbUrls.value }
      delete next[id]
      sourceThumbUrls.value = next
    }
  }
  for (const src of sources.value) {
    const rel = sourceRelativePath(src)
    if (sourceThumbPathById.get(src.id) && sourceThumbPathById.get(src.id) !== rel) {
      sourceThumbPathById.delete(src.id)
      if (sourceThumbUrls.value[src.id]) {
        const next = { ...sourceThumbUrls.value }
        delete next[src.id]
        sourceThumbUrls.value = next
      }
    }
    await loadSourceThumb(src)
  }
}

function defaultTrackForSource(src: ScriptTimelineSource): ScriptTimelineTrackKind {
  return sourceMediaKind(src) === 'voice' ? 'voice' : 'video'
}

function onSourceActivate(src: ScriptTimelineSource): void {
  void addSourceToTrack(src, defaultTrackForSource(src))
}

function sourceIdentityKey(
  src: Pick<ScriptTimelineSource, 'id' | 'assetId' | 'relativePath'>
): string {
  const rel = src.relativePath?.trim().replace(/\\/g, '/')
  if (rel) return `path:${rel}`
  const assetId = src.assetId?.trim()
  if (assetId) return `asset:${assetId}`
  return `id:${src.id}`
}

function upsertImportedSource(
  source: ScriptTimelineSource,
  mediaKind: ScriptTimelineSourceMediaKind,
  durationSec?: number
): void {
  const normalized = normalizeScriptTimelineSource({
    ...source,
    origin: 'imported',
    mediaKind,
    ...(durationSec && durationSec > 0 ? { durationSec } : {})
  })
  if (!normalized) return
  const key = sourceIdentityKey(normalized)
  const idx = sources.value.findIndex((s) => sourceIdentityKey(s) === key)
  if (idx >= 0) {
    const prev = sources.value[idx]!
    sources.value = sources.value.map((s, i) =>
      i === idx
        ? {
            ...prev,
            ...normalized,
            // 刷新节点输入时不应把已有导入项盖成 input；这里强制 imported
            origin: 'imported',
            groupId: prev.groupId ?? null,
            durationSec: normalized.durationSec ?? prev.durationSec
          }
        : s
    )
  } else {
    sources.value = [...sources.value, { ...normalized, groupId: null }]
  }
}

function removeSource(id: string): void {
  const src = sources.value.find((s) => s.id === id)
  // 节点输入不可删；仅「导入素材」可从列表移除并同步清轨道
  if (!src || src.origin !== 'imported') return
  sources.value = sources.value.filter((s) => s.id !== id)
  const key = sourceIdentityKey(src)
  const removedClipIds = new Set<string>()
  commitClips(
    clips.value.filter((clip) => {
      const sameSource =
        clip.sourceId === src.id ||
        sourceIdentityKey({
          id: clip.sourceId,
          assetId: clip.assetId,
          relativePath: clip.relativePath
        }) === key
      if (sameSource) removedClipIds.add(clip.id)
      return !sameSource
    })
  )
  selectedClipIds.value = new Set(
    [...selectedClipIds.value].filter((id) => clips.value.some((clip) => clip.id === id))
  )
  if (activeClipId.value && removedClipIds.has(activeClipId.value)) {
    activeClipId.value = null
    previewSrc.value = ''
  }
  scheduleSave()
}

function patchSourceDuration(sourceId: string, durationSec: number): void {
  if (!(durationSec > 0)) return
  sources.value = sources.value.map((s) =>
    s.id === sourceId && !(s.durationSec && s.durationSec > 0) ? { ...s, durationSec } : s
  )
}

const contentEndSec = computed(() => {
  let max = 0
  for (const clip of clips.value) {
    max = Math.max(max, clip.startSec + clip.durationSec)
  }
  return max
})

/** 时间线总时长：用户设置与内容末端取较大 */
const totalDuration = computed(() =>
  Math.max(minLaneSec, durationSec.value, contentEndSec.value + (contentEndSec.value > 0 ? 0.5 : 0))
)

const fitPxPerSec = computed(() => {
  if (viewportLanePx.value <= 0) return 48
  return viewportLanePx.value / totalDuration.value
})

const pxPerSec = computed(() => {
  const raw = fitPxPerSec.value * zoomFactor.value
  return Math.min(PX_PER_SEC_MAX, Math.max(PX_PER_SEC_MIN, raw))
})

const laneWidth = computed(() =>
  Math.max(Math.ceil(totalDuration.value * pxPerSec.value), viewportLanePx.value || 0)
)

const needsHScroll = computed(() => laneWidth.value > viewportLanePx.value + 1)

const activeSubtitleClip = computed(() => {
  for (const clip of visibleClipsOn('subtitle')) {
    if (
      playheadSec.value >= clip.startSec &&
      playheadSec.value < clip.startSec + clip.durationSec
    ) {
      return clip
    }
  }
  return null
})

const activeSubtitleText = computed(() => {
  const clip = activeSubtitleClip.value
  return clip ? (clip.text || clip.title).trim() : ''
})

function hexToRgba(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return `rgba(0, 0, 0, ${clamp01(alpha)})`
  const raw = m[1]!
  const full = raw.length === 3 ? `${raw[0]}${raw[0]}${raw[1]}${raw[1]}${raw[2]}${raw[2]}` : raw
  const r = parseInt(full.slice(0, 2), 16)
  const g = parseInt(full.slice(2, 4), 16)
  const b = parseInt(full.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${clamp01(alpha).toFixed(2)})`
}

const subtitlePreviewScale = computed(() => {
  const frameH = previewFrameRect.value.height
  const expH = Math.max(180, exportHeight.value || 720)
  if (frameH > 20) return Math.min(2, Math.max(0.18, frameH / expH))
  return 0.5
})

const isActiveSubtitleSelected = computed(() => {
  const clip = activeSubtitleClip.value
  if (!clip || playing.value) return false
  return activeClipId.value === clip.id || selectedClipIds.value.has(clip.id)
})

const activeSubtitleOverlayStyle = computed<Record<string, string>>(() => {
  const clip = activeSubtitleClip.value
  const scale = subtitlePreviewScale.value
  const size = clip?.fontSize ?? subtitleFontSize.value
  const scaledFontPx = Math.max(11, Math.round(size * scale * 10) / 10)
  const scaledBottomPx = Math.max(
    4,
    Math.round(Math.max(0, subtitleYOffset.value) * scale * 10) / 10
  )
  const color = clip?.textColor || subtitleColor.value
  const style: Record<string, string> = {
    fontSize: `${scaledFontPx}px`,
    bottom: `${scaledBottomPx}px`,
    color,
    paintOrder: 'stroke fill'
  }
  const bw = Math.max(0, subtitleBorderWidth.value)
  if (bw > 0) {
    const bc = subtitleBorderColor.value || '#000000'
    // paint-order: stroke fill 下，描边内侧被填充覆盖，外侧可见宽度为 stroke 的一半
    const scaledStrokePx = Math.max(1, Math.round(bw * scale * 2 * 10) / 10)
    style.webkitTextStroke = `${scaledStrokePx}px ${bc}`
    style.textShadow = `0 1px ${Math.max(2, Math.round(bw * scale * 2))}px ${bc}`
  } else {
    style.webkitTextStroke = '0px transparent'
    style.textShadow = 'none'
  }
  if (subtitleBoxEnabled.value) {
    style.backgroundColor = hexToRgba(subtitleBoxColor.value || '#000000', subtitleBoxOpacity.value)
    const padV = Math.max(2, Math.round(6 * scale))
    const padH = Math.max(6, Math.round(14 * scale))
    style.padding = `${padV}px ${padH}px`
    style.borderRadius = `${Math.max(3, Math.round(6 * scale))}px`
  } else {
    style.backgroundColor = 'transparent'
    style.padding = '2px 6px'
  }
  if (subtitleMotion.value === 'fade' && clip) {
    const local = Math.max(0, playheadSec.value - clip.startSec)
    const fadeSec = Math.min(0.18, clip.durationSec / 2)
    let alpha = 1
    if (fadeSec > 0.01) {
      if (local < fadeSec) alpha = local / fadeSec
      else if (local > clip.durationSec - fadeSec) alpha = (clip.durationSec - local) / fadeSec
    }
    style.opacity = `${clamp01(alpha).toFixed(2)}`
  }
  return style
})

const rulerMarks = computed(() => {
  const marks: Array<{ t: number; x: number; label: string; isEnd?: boolean }> = []
  const duration = totalDuration.value
  const pps = pxPerSec.value
  const step = pps >= 48 ? 1 : pps >= 24 ? 2 : pps >= 12 ? 5 : pps >= 6 ? 10 : 30
  for (let t = 0; t <= duration + 0.001; t += step) {
    const sec = Math.min(duration, t)
    marks.push({
      t: sec,
      x: timeToX(sec),
      label: formatTime(sec),
      isEnd: Math.abs(sec - duration) < 0.001
    })
    if (sec >= duration) break
  }
  const last = marks[marks.length - 1]
  if (!last || Math.abs(last.t - duration) > 0.05) {
    marks.push({
      t: duration,
      x: timeToX(duration),
      label: formatTime(duration),
      isEnd: true
    })
  } else {
    last.isEnd = true
  }
  return marks
})

function timeToX(sec: number): number {
  return Math.max(0, sec) * pxPerSec.value
}

function xToTime(x: number): number {
  return Math.max(0, x / pxPerSec.value)
}

function formatTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}:${String(r).padStart(2, '0')}`
}

function clipsOn(kind: ScriptTimelineTrackKind): ScriptTimelineClip[] {
  return clips.value
    .filter((c) => c.track === kind)
    .slice()
    .sort((a, b) => a.startSec - b.startSec)
}

function trackLabel(kind: ScriptTimelineTrackKind): string {
  return t(`script.timeline.track.${kind}`)
}

function visibleClipsOn(kind: ScriptTimelineTrackKind): ScriptTimelineClip[] {
  return hiddenTracks.value.has(kind) ? [] : clipsOn(kind)
}

function toggleTrackHidden(kind: ScriptTimelineTrackKind): void {
  const next = new Set(hiddenTracks.value)
  if (next.has(kind)) next.delete(kind)
  else next.add(kind)
  hiddenTracks.value = next
  scheduleSave()
}

/** 哪些轨道带声音：字幕轨没有音频，不给静音按钮 */
function trackHasAudio(kind: ScriptTimelineTrackKind): boolean {
  return kind !== 'subtitle'
}

function isTrackMuted(kind: ScriptTimelineTrackKind): boolean {
  return mutedTracks.value.has(kind)
}

function toggleTrackMuted(kind: ScriptTimelineTrackKind): void {
  const next = new Set(mutedTracks.value)
  if (next.has(kind)) next.delete(kind)
  else next.add(kind)
  mutedTracks.value = next
  scheduleSave()
}

function toggleTrackLocked(kind: ScriptTimelineTrackKind): void {
  const next = new Set(lockedTracks.value)
  if (next.has(kind)) next.delete(kind)
  else next.add(kind)
  lockedTracks.value = next
  scheduleSave()
}

function toggleTrackCollapsed(kind: ScriptTimelineTrackKind): void {
  const next = new Set(collapsedTracks.value)
  if (next.has(kind)) next.delete(kind)
  else next.add(kind)
  collapsedTracks.value = next
  scheduleSave()
}

function snapshotClips(): ScriptTimelineClip[] {
  return clips.value.map((clip) => ({ ...clip }))
}

function pushHistorySnapshot(prevSnapshot: ScriptTimelineClip[]): void {
  if (!historyReady) return
  undoStack.value.push(prevSnapshot.map((clip) => ({ ...clip })))
  if (undoStack.value.length > HISTORY_LIMIT) undoStack.value.shift()
  redoStack.value = []
}

function commitClips(next: ScriptTimelineClip[]): void {
  if (!historyReady) {
    clips.value = next
    return
  }
  pushHistorySnapshot(snapshotClips())
  clips.value = next
}

const canUndo = computed(() => undoStack.value.length > 0)
const canRedo = computed(() => redoStack.value.length > 0)
const selectedClips = computed(() =>
  clips.value.filter((clip) => selectedClipIds.value.has(clip.id))
)
const canCopyClips = computed(() => selectedClips.value.length > 0)
const canPasteClips = computed(() => timelineClipboard.value.length > 0)
const canExportSrt = computed(() =>
  visibleClipsOn('subtitle').some((clip) => (clip.text || clip.title).trim())
)

/** 配音转字幕：是否有带媒体文件的配音片段 */
const subtitling = ref(false)
const canTranscribeVoice = computed(() =>
  visibleClipsOn('voice').some((clip) => sourceRelativePath(clip))
)

function undo(): void {
  if (!canUndo.value) return
  redoStack.value.push(snapshotClips())
  const prev = undoStack.value.pop()
  clips.value = prev ?? []
  if (activeClipId.value && !clips.value.some((c) => c.id === activeClipId.value)) {
    activeClipId.value = null
    previewSrc.value = ''
  }
  selectedClipIds.value = activeClipId.value ? new Set([activeClipId.value]) : new Set()
  scheduleSave()
}

function redo(): void {
  if (!canRedo.value) return
  undoStack.value.push(snapshotClips())
  const next = redoStack.value.pop()
  clips.value = next ?? []
  if (activeClipId.value && !clips.value.some((c) => c.id === activeClipId.value)) {
    activeClipId.value = null
    previewSrc.value = ''
  }
  selectedClipIds.value = activeClipId.value ? new Set([activeClipId.value]) : new Set()
  scheduleSave()
}

function setSingleClipSelection(clipId: string): void {
  selectedClipIds.value = new Set([clipId])
}

function toggleClipSelection(clipId: string): void {
  const next = new Set(selectedClipIds.value)
  if (next.has(clipId)) next.delete(clipId)
  else next.add(clipId)
  selectedClipIds.value = next
}

function copySelectedClips(): void {
  const selected = selectedClips.value.length
    ? selectedClips.value
    : clips.value.filter((clip) => clip.id === activeClipId.value)
  timelineClipboard.value = selected.map((clip) => ({ ...clip }))
}

function findOverlapInArray(
  list: ScriptTimelineClip[],
  kind: ScriptTimelineTrackKind,
  startSec: number,
  durationSec: number,
  excludeClipId?: string
): ScriptTimelineClip | null {
  const endSec = startSec + durationSec
  return (
    list.find(
      (clip) =>
        clip.id !== excludeClipId &&
        clip.track === kind &&
        startSec < clip.startSec + clip.durationSec - 0.001 &&
        endSec > clip.startSec + 0.001
    ) ?? null
  )
}

function fitStartInArray(
  list: ScriptTimelineClip[],
  kind: ScriptTimelineTrackKind,
  desiredStart: number,
  durationSec: number,
  excludeClipId?: string
): number {
  const maxStart = Math.max(0, totalDuration.value - Math.max(MIN_CLIP_SEC, durationSec))
  let resolved = Math.min(maxStart, Math.max(0, desiredStart))
  for (let guard = 0; guard <= list.length; guard++) {
    const overlap = findOverlapInArray(list, kind, resolved, durationSec, excludeClipId)
    if (!overlap) return resolved
    resolved = Math.min(maxStart, overlap.startSec + overlap.durationSec)
  }
  return resolved
}

function pasteClips(): void {
  if (!timelineClipboard.value.length) return
  const baseStart = playheadSec.value
  const sorted = [...timelineClipboard.value].sort((a, b) => a.startSec - b.startSec)
  const minStart = sorted[0]?.startSec ?? 0
  const working = clips.value.map((clip) => ({ ...clip }))
  const pasted: ScriptTimelineClip[] = []
  for (const clip of sorted) {
    const desiredStart = baseStart + Math.max(0, clip.startSec - minStart)
    const startSec = fitStartInArray(working, clip.track, desiredStart, clip.durationSec)
    const next: ScriptTimelineClip = {
      ...clip,
      id: newClipId(),
      startSec
    }
    working.push(next)
    pasted.push(next)
  }
  if (!pasted.length) return
  commitClips(working)
  selectedClipIds.value = new Set(pasted.map((clip) => clip.id))
  activeClipId.value = pasted[0]?.id ?? activeClipId.value
  scheduleSave()
}

function selectAllClips(): void {
  selectedClipIds.value = new Set(clips.value.map((clip) => clip.id))
}

function deleteSelectedClips(): void {
  const ids = new Set(selectedClipIds.value)
  if (!ids.size) return
  const removable = clips.value.filter(
    (clip) => ids.has(clip.id) && !lockedTracks.value.has(clip.track)
  )
  if (!removable.length) return
  commitClips(clips.value.filter((clip) => !ids.has(clip.id)))
  if (activeClipId.value && ids.has(activeClipId.value)) {
    activeClipId.value = null
    previewSrc.value = ''
  }
  selectedClipIds.value = new Set()
  scheduleSave()
}

/**
 * 波纹删除：主视频轨走 planRippleCut（自动前移后续视频及关联配音/字幕/覆层）；
 * 非视频轨移除后自动收紧该轨道在被删片段之后的间隙。
 */
function rippleDeleteSelectedClips(): void {
  const ids = new Set(selectedClipIds.value)
  if (!ids.size && activeClipId.value) ids.add(activeClipId.value)
  if (!ids.size) return
  const removable = clips.value
    .filter((clip) => ids.has(clip.id) && !lockedTracks.value.has(clip.track))
    .sort((a, b) => b.startSec - a.startSec)
  if (!removable.length) return

  let working = clips.value.map((c) => ({ ...c }))
  for (const target of removable) {
    if (target.track === 'video') {
      const plan = planRippleCut(working, [
        { startSec: target.startSec, endSec: target.startSec + target.durationSec }
      ])
      if (plan) {
        working = plan.clips
        continue
      }
    }
    const delta = Math.max(0, target.durationSec)
    const cutEnd = target.startSec + delta
    working = working
      .filter((c) => c.id !== target.id)
      .map((c) =>
        c.track === target.track && c.startSec >= cutEnd - 0.001
          ? { ...c, startSec: Math.max(0, Math.round((c.startSec - delta) * 100) / 100) }
          : c
      )
  }

  commitClips(working)
  if (activeClipId.value && !working.some((c) => c.id === activeClipId.value)) {
    activeClipId.value = null
    previewSrc.value = ''
  }
  selectedClipIds.value = new Set()
  scheduleSave()
}

/** 一键磁吸闭合轨道空隙：若当前选中了某片段则只收紧其所在轨，否则收紧主视频轨 */
function closeTrackGaps(): void {
  const active = selectedClip.value
  const targetTrack = active ? active.track : 'video'
  if (lockedTracks.value.has(targetTrack)) return
  const next = closeTimelineTrackGaps(clips.value, targetTrack)
  commitClips(next.clips)
  scheduleSave()
}

function snapCandidates(excludeClipId?: string): number[] {
  const points = [0, totalDuration.value, playheadSec.value]
  for (const clip of clips.value) {
    if (clip.id === excludeClipId) continue
    points.push(clip.startSec, clip.startSec + clip.durationSec)
  }
  return points
}

function snapTime(sec: number, excludeClipId?: string): number {
  const threshold = SNAP_PX / Math.max(1, pxPerSec.value)
  let best = sec
  let bestDist = threshold
  for (const point of snapCandidates(excludeClipId)) {
    const dist = Math.abs(point - sec)
    if (dist < bestDist) {
      best = point
      bestDist = dist
    }
  }
  return best
}

function findOverlap(
  kind: ScriptTimelineTrackKind,
  startSec: number,
  durationSec: number,
  excludeClipId?: string
): ScriptTimelineClip | null {
  const endSec = startSec + durationSec
  return (
    clips.value.find(
      (clip) =>
        clip.id !== excludeClipId &&
        clip.track === kind &&
        startSec < clip.startSec + clip.durationSec - 0.001 &&
        endSec > clip.startSec + 0.001
    ) ?? null
  )
}

function fitClipStart(
  kind: ScriptTimelineTrackKind,
  desiredStart: number,
  durationSec: number,
  excludeClipId?: string,
  moveDir = 1
): number {
  const snapped = snapTime(Math.max(0, desiredStart), excludeClipId)
  const maxStart = Math.max(0, totalDuration.value - Math.max(MIN_CLIP_SEC, durationSec))
  let resolved = Math.min(maxStart, snapped)
  for (let guard = 0; guard <= clips.value.length; guard++) {
    const overlap = findOverlap(kind, resolved, durationSec, excludeClipId)
    if (!overlap) return resolved
    resolved =
      moveDir >= 0
        ? Math.min(maxStart, overlap.startSec + overlap.durationSec)
        : Math.max(0, overlap.startSec - durationSec)
  }
  return resolved
}

function reorderClipsOnTrack(
  kind: ScriptTimelineTrackKind,
  draggedId: string,
  desiredStart: number,
  durationSec: number
): ScriptTimelineClip[] {
  const dragged = clips.value.find((clip) => clip.id === draggedId)
  if (!dragged) return clips.value

  const others = clips.value
    .filter((clip) => clip.track === kind && clip.id !== draggedId)
    .slice()
    .sort((a, b) => a.startSec - b.startSec)

  const clampedStart = Math.max(0, desiredStart)
  let insertIndex = others.findIndex(
    (clip) => clampedStart < clip.startSec + Math.max(MIN_CLIP_SEC, clip.durationSec) / 2 - 0.001
  )
  if (insertIndex < 0) insertIndex = others.length

  const prefix = others.slice(0, insertIndex)
  const suffix = others.slice(insertIndex)
  const updatedTrack: ScriptTimelineClip[] = prefix.map((clip) => ({ ...clip }))

  let cursor = prefix.length
    ? prefix[prefix.length - 1]!.startSec + prefix[prefix.length - 1]!.durationSec
    : 0
  const draggedOverlap =
    kind === 'video' &&
    prefix.length > 0 &&
    dragged.transitionType &&
    dragged.transitionType !== 'none' &&
    (dragged.transitionInSec ?? 0) > 0
      ? Math.min(
          Math.max(0, Math.min(prefix[prefix.length - 1]!.durationSec, durationSec) - 0.1),
          dragged.transitionInSec ?? 0
        )
      : 0
  const minDraggedStart = Math.max(0, cursor - draggedOverlap)
  const nextStart = Math.max(clampedStart, minDraggedStart)
  updatedTrack.push({ ...dragged, startSec: Math.round(nextStart * 100) / 100 })
  cursor = nextStart + Math.max(MIN_CLIP_SEC, durationSec)

  for (const other of suffix) {
    const prevClip = updatedTrack[updatedTrack.length - 1]
    const otherOverlap =
      kind === 'video' &&
      prevClip &&
      other.transitionType &&
      other.transitionType !== 'none' &&
      (other.transitionInSec ?? 0) > 0
        ? Math.min(
            Math.max(0, Math.min(prevClip.durationSec, other.durationSec) - 0.1),
            other.transitionInSec ?? 0
          )
        : 0
    const start = Math.max(0, Math.round((cursor - otherOverlap) * 100) / 100)
    updatedTrack.push({ ...other, startSec: start })
    cursor = start + Math.max(MIN_CLIP_SEC, other.durationSec)
  }

  const byId = new Map(updatedTrack.map((clip) => [clip.id, clip]))
  return clips.value.map((clip) => (clip.track === kind ? (byId.get(clip.id) ?? clip) : clip))
}

function clipStyle(clip: ScriptTimelineClip): Record<string, string> {
  return {
    left: `${timeToX(clip.startSec)}px`,
    width: `${Math.max(36, timeToX(clip.durationSec))}px`
  }
}

function transitionHandleStyle(handle: {
  startSec: number
  durationSec: number
}): Record<string, string> {
  const x = timeToX(handle.startSec)
  if (handle.durationSec > 0) {
    const width = Math.max(24, timeToX(handle.durationSec))
    return {
      left: `${x}px`,
      width: `${width}px`
    }
  }
  return {
    left: `${x - 12}px`,
    width: '24px'
  }
}

/** 媒体身份：同一份文件（相对路径）复用解码结果，与片段长度/宽度无关 */
function clipMediaIdentity(clip: ScriptTimelineClip): string {
  const rel =
    clip.relativePath?.trim().replace(/\\/g, '/') ||
    (clip.assetId
      ? project.assets
          .find((asset) => asset.id === clip.assetId)
          ?.relativePath?.trim()
          .replace(/\\/g, '/')
      : '') ||
    ''
  return rel ? `path:${rel}` : `asset:${clip.assetId || clip.id}`
}

function clipVisualKey(clip: ScriptTimelineClip): string {
  return `${clipMediaIdentity(clip)}:${Math.round(clip.durationSec * 10)}`
}

function isAudioClip(clip: ScriptTimelineClip): boolean {
  return clip.track === 'voice' || clip.track === 'music' || clip.track === 'sfx'
}

/** 波形缓存 key：矢量波形与片段宽度 / 轨道高度无关，只跟音频文件和轨道配色有关 */
function waveformDrawKey(clip: ScriptTimelineClip): string {
  return `${clipMediaIdentity(clip)}:${clip.track}`
}

function clipHasVisual(clip: ScriptTimelineClip): boolean {
  if (clip.track === 'subtitle') return false
  const key = isAudioClip(clip) ? waveformDrawKey(clip) : clipVisualKey(clip)
  return Boolean(clipVideoStripUrls.value[key] || clipWaveformUrls.value[key])
}

function clipVisualStyle(clip: ScriptTimelineClip): Record<string, string> {
  const style = clipStyle(clip)
  if (clip.track === 'subtitle') return style
  if (isAudioClip(clip)) {
    // 声音片段按轨道类型着色（人声绿 / 音乐青 / 音效橙），波形由 clipWaveStyle 单独叠加一层
    const accent = AUDIO_TRACK_COLORS[clip.track]
    if (accent) style['--clip-accent'] = accent
    return style
  }
  const key = clipVisualKey(clip)
  const strip = clipVideoStripUrls.value[key]
  if (clip.track === 'video' || clip.track === 'overlay') {
    if (strip) {
      style.backgroundImage = `url("${strip}")`
      style.backgroundSize = 'auto 100%'
      style.backgroundRepeat = 'repeat-x'
      style.backgroundPosition = 'left center'
    }
  }
  return style
}

/**
 * 声音片段的波形层样式。
 * 波形只铺在音频真实覆盖的时长区间上：音频比片段短时右侧留空，
 * 避免波形被拉满整条片段而与播放内容错位。
 */
function clipWaveStyle(clip: ScriptTimelineClip): Record<string, string> {
  const style: Record<string, string> = {}
  const url = clipWaveformUrls.value[waveformDrawKey(clip)]
  if (!url) return style
  const peaks = audioPeaksCache.get(clipMediaIdentity(clip))
  const audioDuration = peaks?.duration ?? clip.durationSec
  // 矢量图代表整段音频，按「音频时长 / 片段时长」横向铺开：
  // 片段比音频短时只露出前一段（>100%），音频比片段短时右侧留空（<100%）
  const ratio = audioDuration > 0 ? audioDuration / Math.max(0.001, clip.durationSec) : 1
  style.backgroundImage = `url("${url}")`
  style.backgroundSize = `${(ratio * 100).toFixed(2)}% 100%`
  style.backgroundRepeat = 'no-repeat'
  style.backgroundPosition = 'left center'
  return style
}

/** 片段在源文件内的取段起点（秒）；打点选段片段 > 0，其余为 0（从源头部播放） */
function sourceOffsetOf(clip?: { sourceOffsetSec?: number } | null): number {
  const n = Number(clip?.sourceOffsetSec)
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.round(n * 10) / 10
}

/** 片段本地时间（相对轨上片段起点，0 = 取段窗口起点）→ 源文件 media currentTime */
function mediaTimeForClip(
  clip:
    | {
        sourceOffsetSec?: number
        speed?: number
        freezeTailSec?: number
        durationSec?: number
      }
    | null
    | undefined,
  localSec: number
): number {
  const speed = clampClipSpeed(clip?.speed)
  const freezeTail = clampClipFreezeTailSec(clip?.freezeTailSec)
  const maxMovingLocal =
    clip?.durationSec && clip.durationSec > 0
      ? Math.max(0.05, clip.durationSec - freezeTail)
      : Number.POSITIVE_INFINITY
  const effectiveLocal = Math.min(Math.max(0, Number(localSec) || 0), maxMovingLocal)
  return Math.max(0, sourceOffsetOf(clip) + effectiveLocal * speed)
}

/** 源文件 media currentTime → 片段本地时间（用于反推播放头 / 判定片段结束） */
function localTimeForClip(
  clip: { sourceOffsetSec?: number; speed?: number } | null | undefined,
  mediaSec: number
): number {
  const speed = clampClipSpeed(clip?.speed)
  return Math.max(0, ((Number(mediaSec) || 0) - sourceOffsetOf(clip)) / speed)
}

function seekVideoTo(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      video.removeEventListener('seeked', done)
      video.removeEventListener('error', done)
      resolve()
    }
    video.addEventListener('seeked', done)
    video.addEventListener('error', done)
    try {
      video.currentTime = time
    } catch {
      done()
    }
    window.setTimeout(done, 1200)
  })
}

/** 等待 <video> 换源后进入可用状态：metadata / error / 超时，先到先回 */
function waitForVideoLoad(el: HTMLVideoElement, timeoutMs = 2000): Promise<void> {
  return new Promise((resolve) => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      el.removeEventListener('loadedmetadata', finish)
      el.removeEventListener('error', finish)
      resolve()
    }
    el.addEventListener('loadedmetadata', finish)
    el.addEventListener('error', finish)
    window.setTimeout(finish, timeoutMs)
    // 源可能已在缓存中就绪（不会再触发事件）：同步判定后直接放行
    if (el.readyState >= 1) finish()
  })
}

function isImageOrGifUrl(url?: string | null): boolean {
  const s = (url ?? '').trim()
  if (!s) return false
  if (s.startsWith('data:image/')) return true
  if (s.includes('?')) {
    try {
      const u = new URL(s)
      const pathParam = u.searchParams.get('path')?.trim() ?? ''
      if (pathParam && /\.(png|jpe?g|webp|bmp|gif|svg)$/i.test(pathParam)) {
        return true
      }
    } catch {
      /* ignore invalid URL */
    }
  }
  const clean = s.split(/[?#]/)[0] ?? ''
  return /\.(png|jpe?g|webp|bmp|gif|svg)$/i.test(clean)
}

const overlayImageUrls = ref<Record<string, string>>({})

function isImageOrGifClip(
  clip?: { relativePath?: string; assetId?: string; stickerId?: string } | null
): boolean {
  if (!clip) return false
  if (typeof clip.stickerId === 'string' && clip.stickerId.trim()) return true
  const rel = sourceRelativePath(clip)
  if (isImageOrGifUrl(rel)) return true
  const aid = clip.assetId?.trim()
  if (aid) {
    const asset = project.assets.find((a) => a.id === aid)
    if (asset?.type === 'image') return true
  }
  return false
}

function overlayImageSrc(clip: ScriptTimelineClip): string {
  if (clip.stickerId?.trim()) {
    return renderTimelineBuiltinStickerDataUrl(clip.stickerId, {
      text: clip.text,
      color: clip.stickerColor
    })
  }
  return overlayImageUrls.value[clip.id] ?? ''
}

async function generateVideoStrip(clip: ScriptTimelineClip): Promise<string | null> {
  const url = await resolveSrc(clip)
  if (!url) return null

  if (isImageOrGifClip(clip) || isImageOrGifUrl(url)) {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(() => {
          img.onload = null
          img.onerror = null
          reject(new Error('image load timeout'))
        }, 6000)
        img.onload = () => {
          window.clearTimeout(timer)
          resolve()
        }
        img.onerror = () => {
          window.clearTimeout(timer)
          reject(new Error('image load failed'))
        }
        img.src = url
      })
      const w = img.naturalWidth || img.width || 112
      const h = img.naturalHeight || img.height || 62
      const frameWidth = 112
      const frameHeight = 62
      const canvas = document.createElement('canvas')
      canvas.width = frameWidth
      canvas.height = frameHeight
      const ctx = canvas.getContext('2d')
      if (!ctx) return null
      const scale = Math.max(frameWidth / w, frameHeight / h)
      const dw = w * scale
      const dh = h * scale
      ctx.drawImage(img, (frameWidth - dw) / 2, (frameHeight - dh) / 2, dw, dh)
      return canvas.toDataURL('image/jpeg', 0.78)
    } catch {
      return null
    } finally {
      img.removeAttribute('src')
    }
  }

  const video = document.createElement('video')
  video.preload = 'auto'
  video.muted = true
  video.playsInline = true
  // studio-media 协议已放行 CORS：匿名跨源加载，否则抽帧后 canvas 被污染、toDataURL 抛 SecurityError
  video.crossOrigin = 'anonymous'
  try {
    await new Promise<void>((resolve, reject) => {
      // 加超时兜底：损坏/缺失视频可能既不触发 loadedmetadata 也不触发 error，
      // 若无超时会永久阻塞整个 refreshClipVisuals
      const timer = window.setTimeout(() => {
        video.onloadedmetadata = null
        video.onerror = null
        reject(new Error('video load timeout'))
      }, 8000)
      video.onloadedmetadata = () => {
        window.clearTimeout(timer)
        resolve()
      }
      video.onerror = () => {
        window.clearTimeout(timer)
        reject(new Error('video load failed'))
      }
      video.src = url
    })
    const duration =
      Number.isFinite(video.duration) && video.duration > 0 ? video.duration : clip.durationSec || 1
    const frameCount = Math.max(1, Math.min(10, Math.ceil(clip.durationSec / 1.5)))
    const frameWidth = 112
    const frameHeight = 62
    const canvas = document.createElement('canvas')
    canvas.width = frameWidth * frameCount
    canvas.height = frameHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    for (let i = 0; i < frameCount; i++) {
      const target = Math.min(
        duration - 0.05,
        (i + 0.5) * (clip.durationSec / frameCount) + sourceOffsetOf(clip)
      )
      await seekVideoTo(video, target)
      if (video.videoWidth > 0) {
        const scale = Math.max(frameWidth / video.videoWidth, frameHeight / video.videoHeight)
        const dw = video.videoWidth * scale
        const dh = video.videoHeight * scale
        ctx.drawImage(video, i * frameWidth + (frameWidth - dw) / 2, (frameHeight - dh) / 2, dw, dh)
      }
    }
    return canvas.toDataURL('image/jpeg', 0.72)
  } catch {
    // 单片段抽帧失败（文件缺失 / 编码不支持 / canvas 污染）时放弃该片段，不影响其余片段
    return null
  } finally {
    video.removeAttribute('src')
    video.load()
  }
}

/** 声音轨配色：人声绿 / 音乐青 / 音效橙（与 CSS 的 --clip-accent 同源） */
const AUDIO_TRACK_COLORS: Partial<Record<ScriptTimelineTrackKind, string>> = {
  voice: '#3ecf8e',
  music: '#4cc9f0',
  sfx: '#f9a03f'
}

/** 解码后缓存的音频包络：峰值 + RMS 各 AUDIO_PEAK_BUCKETS 个桶 */
type AudioPeaks = {
  /** 音频真实时长（秒） */
  duration: number
  peaks: Float32Array
  rms: Float32Array
}

/**
 * 包络桶数。波形以 SVG 矢量输出，1024 桶已足够平滑：
 * 放大时是矢量的清晰折线，而不是位图被拉伸后的糊图。
 */
const AUDIO_PEAK_BUCKETS = 1024
/** 每个桶最多扫描这么多采样点，把长音频的计算量压到常量级 */
const AUDIO_PEAK_SCAN_LIMIT = 512
/** 媒体身份 → 包络（同一份文件只解码一次） */
const audioPeaksCache = new Map<string, AudioPeaks>()
/** 仅用于 decodeAudioData 的 AudioContext */
let decodeAudioCtx: AudioContext | null = null

function getDecodeAudioCtx(): AudioContext | null {
  if (decodeAudioCtx) return decodeAudioCtx
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return null
    decodeAudioCtx = new Ctor()
  } catch {
    decodeAudioCtx = null
  }
  return decodeAudioCtx
}

function closeDecodeAudioCtx(): void {
  try {
    void decodeAudioCtx?.close().catch(() => undefined)
  } catch {
    /* ignore */
  }
  decodeAudioCtx = null
}

/** 解码音频并算出峰值 / RMS 包络（按文件维度缓存，与片段宽度无关） */
async function generateAudioPeaks(clip: ScriptTimelineClip): Promise<AudioPeaks | null> {
  const url = await resolveSrc(clip)
  if (!url) return null
  const audioContext = getDecodeAudioCtx()
  if (!audioContext) {
    console.warn('[timeline] AudioContext unavailable, skip waveform')
    return null
  }
  try {
    const response = await fetch(url)
    if (!response.ok) {
      console.warn(`[timeline] waveform fetch failed: ${response.status}`)
      return null
    }
    const arrayBuffer = await response.arrayBuffer()
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer)
    const channels: Float32Array[] = []
    for (let c = 0; c < audioBuffer.numberOfChannels; c += 1) {
      channels.push(audioBuffer.getChannelData(c))
    }
    const length = audioBuffer.length
    const peaks = new Float32Array(AUDIO_PEAK_BUCKETS)
    const rms = new Float32Array(AUDIO_PEAK_BUCKETS)
    if (length > 0 && channels.length > 0) {
      const bucketSize = length / AUDIO_PEAK_BUCKETS
      // 长音频按步长抽样：每桶扫描量封顶，避免几分钟的素材卡住主线程
      const step = Math.max(1, Math.floor(bucketSize / AUDIO_PEAK_SCAN_LIMIT))
      for (let i = 0; i < AUDIO_PEAK_BUCKETS; i += 1) {
        const start = Math.floor(i * bucketSize)
        const end = Math.min(length, Math.floor((i + 1) * bucketSize))
        let peak = 0
        let sumSq = 0
        let count = 0
        for (let j = start; j < end; j += step) {
          for (let c = 0; c < channels.length; c += 1) {
            const value = channels[c][j] ?? 0
            const abs = value < 0 ? -value : value
            if (abs > peak) peak = abs
            sumSq += value * value
            count += 1
          }
        }
        peaks[i] = peak
        rms[i] = count > 0 ? Math.sqrt(sumSq / count) : 0
      }
    }
    return {
      duration: audioBuffer.duration || clip.durationSec || 1,
      peaks,
      rms
    }
  } catch (err) {
    console.warn('[timeline] audio peaks generation failed', err)
    return null
  }
}

/**
 * 由每桶高度构造上下对称的闭合包络路径。
 * 坐标取整 + 逗号分隔压缩体积；高度不变时只做水平延伸，静音段可省掉一半以上的点。
 */
function buildSvgEnvelopePath(heights: Float32Array, width: number, midY: number): string {
  const base = Math.round(midY)
  const n = heights.length
  const parts: string[] = [`M0,${base}`]
  // 上沿：只有高度变化时才需要竖直落点
  let prev = Number.NaN
  for (let i = 0; i < n; i += 1) {
    const y = Math.round(midY - heights[i])
    if (y !== prev) parts.push(`L${i},${y}`)
    parts.push(`L${i + 1},${y}`)
    prev = y
  }
  parts.push(`L${width},${base}`)
  // 下沿：镜像回到起点
  prev = Number.NaN
  for (let i = n - 1; i >= 0; i -= 1) {
    const y = Math.round(midY + heights[i])
    if (y !== prev) parts.push(`L${i + 1},${y}`)
    parts.push(`L${i},${y}`)
    prev = y
  }
  parts.push('Z')
  return parts.join('')
}

/** 只转义 data URI 必需字符，避免 encodeURIComponent 让体积膨胀数倍 */
function encodeSvgDataUri(svg: string): string {
  return svg
    .replace(/%/g, '%25')
    .replace(/#/g, '%23')
    .replace(/</g, '%3C')
    .replace(/>/g, '%3E')
    .replace(/\s{2,}/g, ' ')
}

/**
 * 从包络重采样出「当前片段宽度」的波形图：
 * - 只取 [fromSec, toSec] 区间，音频比片段短时右侧留空，波形不再铺满错位
 * - 峰值归一化到轨道高度，小声素材也看得清
 * - 外层峰值浅、内层 RMS 深，形成层次
 */
/**
 * 把包络转成「整段音频」的 SVG 矢量波形。
 * 矢量是关键：时间线放大时由浏览器按目标像素重新栅格化，
 * 不会像预渲染位图那样被拉伸变糊；同一份 SVG 适配任意片段宽度与轨道高度。
 */
function renderWaveformSvg(data: AudioPeaks, color: string): string | null {
  const buckets = AUDIO_PEAK_BUCKETS
  const viewW = buckets
  const viewH = 100
  const midY = viewH / 2
  const maxBarHeight = midY - 3

  let maxPeak = 0
  let maxRms = 0
  for (let i = 0; i < buckets; i += 1) {
    const p = data.peaks[i] ?? 0
    if (p > maxPeak) maxPeak = p
    const r = data.rms[i] ?? 0
    if (r > maxRms) maxRms = r
  }
  // 峰值 / RMS 各自归一化：两层都饱满又保持层次（外层峰值 94%、内层 RMS 75%）
  const peakScale = (maxBarHeight * 0.94) / Math.max(maxPeak, 0.05)
  const rmsScale = (maxBarHeight * 0.75) / Math.max(maxRms, 0.02)
  const peakHeights = new Float32Array(buckets)
  const rmsHeights = new Float32Array(buckets)
  for (let i = 0; i < buckets; i += 1) {
    const ph = Math.min(maxBarHeight, (data.peaks[i] ?? 0) * peakScale)
    peakHeights[i] = ph
    rmsHeights[i] = Math.min(ph, (data.rms[i] ?? 0) * rmsScale)
  }

  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${viewW} ${viewH}' preserveAspectRatio='none'>` +
    `<path d='${buildSvgEnvelopePath(peakHeights, viewW, midY)}' fill='${color}' fill-opacity='0.4'/>` +
    `<path d='${buildSvgEnvelopePath(rmsHeights, viewW, midY)}' fill='${color}' fill-opacity='0.92'/>` +
    `</svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeSvgDataUri(svg)}`
}

/** 以受限并发执行一批异步任务，互不阻塞；单个失败不影响其余 */
async function runConcurrent<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  let index = 0
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (index < items.length) {
      const item = items[index]
      index += 1
      if (item === undefined) continue
      try {
        await worker(item)
      } catch {
        // 单个任务失败不影响并发池
      }
    }
  })
  await Promise.allSettled(runners)
}

async function refreshClipVisuals(): Promise<void> {
  const audioClips = clips.value.filter(isAudioClip)
  const videoClips = clips.value.filter(
    (clip) => clip.track === 'video' || clip.track === 'overlay'
  )
  // 音频波形与视频帧条并行生成，互不阻塞：音频不受视频抽帧拖累，反之亦然
  await Promise.all([
    runConcurrent(audioClips, 3, async (clip) => {
      await ensureClipWaveform(clip)
    }),
    runConcurrent(videoClips, 2, async (clip) => {
      const key = clipVisualKey(clip)
      const busyKey = `video:${key}`
      if (clipVisualBusy.has(busyKey) || clipVideoStripUrls.value[key]) return
      clipVisualBusy.add(busyKey)
      try {
        const strip = await generateVideoStrip(clip)
        if (strip) {
          clipVideoStripUrls.value = {
            ...clipVideoStripUrls.value,
            [key]: strip
          }
        }
      } finally {
        clipVisualBusy.delete(busyKey)
      }
    })
  ])
  gcWaveformUrls()
}

/**
 * 两段式波形：先确保峰值包络（异步，按文件只解码一次），
 * 再按当前片段宽度同步重绘——缩放时间线时不会重复 fetch + 解码。
 */
async function ensureClipWaveform(clip: ScriptTimelineClip): Promise<void> {
  const identity = clipMediaIdentity(clip)
  if (clipWaveformUrls.value[waveformDrawKey(clip)]) return
  if (!audioPeaksCache.has(identity)) {
    const busyKey = `audio:${identity}`
    if (clipVisualBusy.has(busyKey)) return
    clipVisualBusy.add(busyKey)
    try {
      const peaks = await generateAudioPeaks(clip)
      if (peaks) audioPeaksCache.set(identity, peaks)
    } finally {
      clipVisualBusy.delete(busyKey)
    }
  }
  paintClipWaveform(clip)
}

/** 由包络生成矢量波形：一次生成即可适配任意缩放，无需随宽度重绘 */
function paintClipWaveform(clip: ScriptTimelineClip): void {
  const drawKey = waveformDrawKey(clip)
  if (clipWaveformUrls.value[drawKey]) return
  const peaks = audioPeaksCache.get(clipMediaIdentity(clip))
  if (!peaks) return
  const svg = renderWaveformSvg(peaks, AUDIO_TRACK_COLORS[clip.track] ?? '#7dd3fc')
  if (svg) {
    clipWaveformUrls.value = { ...clipWaveformUrls.value, [drawKey]: svg }
  }
}

/** 回收不再需要的波形绘制缓存（缩放 / 裁剪会不断产生新的宽度档位） */
function gcWaveformUrls(): void {
  const alive = new Set<string>()
  for (const clip of clips.value) {
    if (isAudioClip(clip)) alive.add(waveformDrawKey(clip))
  }
  let dirty = false
  const next: Record<string, string> = {}
  for (const [key, url] of Object.entries(clipWaveformUrls.value)) {
    if (alive.has(key)) {
      next[key] = url
    } else {
      dirty = true
    }
  }
  if (dirty) clipWaveformUrls.value = next
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function overlayRect(clip: ScriptTimelineClip): {
  left: number
  top: number
  width: number
  height: number
} {
  const width = clamp01(clip.overlayWidth ?? 0.36)
  const height = clamp01(clip.overlayHeight ?? 0.36)
  return {
    left: clamp01(clip.overlayX ?? 0.15),
    top: clamp01(clip.overlayY ?? 0.15),
    width,
    height
  }
}

function overlayVideoStyle(clip: ScriptTimelineClip): Record<string, string> {
  const localSec = effectiveClipLocalTimeSec(clip)
  const tf = evaluateOverlayClipTransform(clip, localSec)
  const filter = buildCssColorFilter(clip, false)
  const fxTransform = buildClipVisualCssTransform(clip, localSec)
  const rotTransform = Math.abs(tf.rotation) > 0.01 ? `rotate(${tf.rotation.toFixed(2)}deg)` : ''
  const combinedTransform = [rotTransform, fxTransform].filter(Boolean).join(' ')
  const cropClip = !(cropMode.value && selectedCroppableClip.value?.id === clip.id)
    ? buildCssCropClipPath(clip)
    : ''
  return {
    left: `${(tf.left * 100).toFixed(3)}%`,
    top: `${(tf.top * 100).toFixed(3)}%`,
    width: `${(tf.width * 100).toFixed(3)}%`,
    height: `${(tf.height * 100).toFixed(3)}%`,
    opacity: `${clamp01(tf.opacity).toFixed(3)}`,
    ...(combinedTransform
      ? { transform: combinedTransform, transformOrigin: 'center center' }
      : {}),
    ...(filter ? { filter } : {}),
    ...(cropClip ? { clipPath: cropClip } : {})
  }
}

function overlaySelectionStyle(clip: ScriptTimelineClip): Record<string, string> {
  const localSec = effectiveClipLocalTimeSec(clip)
  const tf = evaluateOverlayClipTransform(clip, localSec)
  return {
    left: `${(tf.left * 100).toFixed(3)}%`,
    top: `${(tf.top * 100).toFixed(3)}%`,
    width: `${(tf.width * 100).toFixed(3)}%`,
    height: `${(tf.height * 100).toFixed(3)}%`,
    ...(Math.abs(tf.rotation) > 0.01
      ? { transform: `rotate(${tf.rotation.toFixed(2)}deg)`, transformOrigin: 'center center' }
      : {})
  }
}

function isOverlayClipActive(clip: ScriptTimelineClip): boolean {
  return playheadSec.value >= clip.startSec && playheadSec.value < clip.startSec + clip.durationSec
}

function bindOverlayVideo(el: HTMLVideoElement | null, clipId: string): void {
  if (el) {
    el.muted = true
    overlayEls.set(clipId, el)
  } else {
    overlayEls.delete(clipId)
  }
}

function bindTransitionVideo(el: HTMLVideoElement | null, clipId: string): void {
  if (el) {
    el.muted = true
    transitionVideoEls.set(clipId, el)
  } else {
    transitionVideoEls.delete(clipId)
  }
}

function readGenParams(): Record<string, unknown> {
  if (isDraftAssetId(props.scriptAssetId)) {
    return { ...(drafts.getDraft(props.scriptAssetId)?.genParams ?? {}) }
  }
  const asset = project.assets.find((a) => a.id === props.scriptAssetId)
  return { ...((asset?.genParams as Record<string, unknown> | undefined) ?? {}) }
}

function loadPersisted(): void {
  const doc = readScriptTimelineFromGenParams(readGenParams(), props.timelineNodeId)
  clips.value = doc.clips.map((c) => ({ ...c }))
  if (doc.sources?.length) {
    sources.value = doc.sources
      .map((s) => normalizeScriptTimelineSource(s))
      .filter((s): s is ScriptTimelineSource => !!s)
  } else {
    sources.value = []
  }
  sourceGroups.value = (doc.sourceGroups ?? [])
    .map((g) => normalizeScriptTimelineSourceGroup(g))
    .filter((g): g is ScriptTimelineSourceGroup => !!g)
  hiddenTracks.value = new Set(doc.hiddenTracks ?? [])
  mutedTracks.value = new Set(doc.mutedTracks ?? [])
  lockedTracks.value = new Set(doc.lockedTracks ?? [])
  collapsedTracks.value = new Set(doc.collapsedTracks ?? [])
  // 清理指向已删分组的引用
  const groupIds = new Set(sourceGroups.value.map((g) => g.id))
  sources.value = sources.value.map((s) =>
    s.origin === 'imported' && s.groupId && !groupIds.has(s.groupId) ? { ...s, groupId: null } : s
  )
  const settings = doc.settings
  const content = contentEndSec.value
  const nextDuration = Math.max(
    minLaneSec,
    settings?.durationSec ?? Math.max(minLaneSec, content > 0 ? content + 2 : minLaneSec)
  )
  durationSec.value = nextDuration
  durationInputSec.value = Math.round(nextDuration)
  playbackRate.value = normalizePlaybackRate(settings?.playbackRate ?? 1)
  loopPlayback.value = settings?.loop === true
  exportWidth.value = settings?.exportWidth ?? 1280
  exportHeight.value = settings?.exportHeight ?? 720
  isCustomResolution.value = !EXPORT_RESOLUTIONS.some(
    (res) => res.w === exportWidth.value && res.h === exportHeight.value
  )
  exportFps.value = settings?.exportFps ?? 30
  exportVideoBitrateKbps.value = settings?.exportVideoBitrateKbps ?? 5000
  scaleMode.value = settings?.scaleMode ?? 'contain'
  subtitleFontSize.value = settings?.subtitleFontSize ?? 36
  subtitleYOffset.value = settings?.subtitleYOffset ?? 80
  subtitleColor.value = settings?.subtitleColor ?? '#ffffff'
  subtitleBorderColor.value = settings?.subtitleBorderColor ?? '#000000'
  subtitleBorderWidth.value = settings?.subtitleBorderWidth ?? 2
  subtitleBoxEnabled.value = settings?.subtitleBoxEnabled === true
  subtitleBoxColor.value = settings?.subtitleBoxColor ?? '#000000'
  subtitleBoxOpacity.value = settings?.subtitleBoxOpacity ?? 0.55
  subtitleMotion.value =
    settings?.subtitleMotion === 'fade' || settings?.subtitleMotion === true ? 'fade' : 'none'
  previewFrameRatioKey.value = settings?.previewFrameRatio ?? 'export'
  exportPlatformId.value = settings?.exportPlatformId ?? 'custom'
  watermarkEnabled.value = settings?.watermarkEnabled === true
  watermarkSrc.value = settings?.watermarkSrc ?? ''
  watermarkOpacity.value = settings?.watermarkOpacity ?? 0.8
  watermarkScale.value = settings?.watermarkScale ?? 0.1
  watermarkPosition.value =
    settings?.watermarkPosition === 'bl' ||
    settings?.watermarkPosition === 'tr' ||
    settings?.watermarkPosition === 'tl'
      ? settings.watermarkPosition
      : 'br'
  trackHeight.value = settings?.trackHeight ?? 52
  mixGains.value = settings?.mixGains ?? {}
  mixMasterGain.value = clampTrackGain(settings?.mixMasterGain ?? 1)
  mixBassGainDb.value = clampMixEqGainDb(settings?.mixBassGainDb ?? 0)
  mixTrebleGainDb.value = clampMixEqGainDb(settings?.mixTrebleGainDb ?? 0)
  mixCompression.value = settings?.mixCompression === true
  mixAutoDucking.value = settings?.mixAutoDucking === true
  mixDuckingRatio.value = clampMixDuckingRatio(settings?.mixDuckingRatio ?? 0.25)
  mixLoudnorm.value = settings?.mixLoudnorm === true
  undoStack.value = []
  redoStack.value = []
  selectedClipIds.value = new Set()
  timelineClipboard.value = []
  historyReady = true
  applyPlaybackRate()
}

function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    void persist()
  }, 280)
}

async function persist(): Promise<void> {
  const doc: ScriptTimelineDocument = {
    clips: toPlain(clips.value) as ScriptTimelineClip[],
    sources: toPlain(sources.value) as ScriptTimelineSource[],
    sourceGroups: toPlain(sourceGroups.value) as ScriptTimelineSourceGroup[],
    hiddenTracks: [...hiddenTracks.value],
    mutedTracks: [...mutedTracks.value],
    lockedTracks: [...lockedTracks.value],
    collapsedTracks: [...collapsedTracks.value],
    settings: {
      durationSec: durationSec.value,
      playbackRate: playbackRate.value,
      loop: loopPlayback.value,
      exportWidth: exportWidth.value,
      exportHeight: exportHeight.value,
      exportFps: exportFps.value,
      exportVideoBitrateKbps: exportVideoBitrateKbps.value,
      scaleMode: scaleMode.value,
      subtitleFontSize: subtitleFontSize.value,
      subtitleYOffset: subtitleYOffset.value,
      subtitleColor: subtitleColor.value,
      subtitleBorderColor: subtitleBorderColor.value,
      subtitleBorderWidth: subtitleBorderWidth.value,
      subtitleBoxEnabled: subtitleBoxEnabled.value,
      subtitleBoxColor: subtitleBoxColor.value,
      subtitleBoxOpacity: subtitleBoxOpacity.value,
      subtitleMotion: subtitleMotion.value,
      previewFrameRatio: previewFrameRatioKey.value,
      exportPlatformId: exportPlatformId.value,
      watermarkEnabled: watermarkEnabled.value,
      watermarkSrc: watermarkSrc.value,
      watermarkOpacity: watermarkOpacity.value,
      watermarkScale: watermarkScale.value,
      watermarkPosition: watermarkPosition.value,
      trackHeight: trackHeight.value,
      mixGains: mixGains.value,
      mixMasterGain: mixMasterGain.value,
      mixBassGainDb: mixBassGainDb.value,
      mixTrebleGainDb: mixTrebleGainDb.value,
      mixCompression: mixCompression.value,
      mixAutoDucking: mixAutoDucking.value,
      mixDuckingRatio: clampMixDuckingRatio(mixDuckingRatio.value),
      mixLoudnorm: mixLoudnorm.value
    }
  }
  const next = withScriptTimeline(readGenParams(), doc, props.timelineNodeId)
  if (isDraftAssetId(props.scriptAssetId)) {
    drafts.updateDraft(props.scriptAssetId, { genParams: next })
    return
  }
  await persistAssetRecord(props.scriptAssetId, { genParams: next })
}

function commitDuration(): void {
  const n = Number(durationInputSec.value)
  if (!Number.isFinite(n)) {
    durationInputSec.value = Math.round(durationSec.value)
    return
  }
  durationSec.value = Math.min(3600, Math.max(minLaneSec, Math.max(n, contentEndSec.value)))
  durationInputSec.value = Math.round(durationSec.value)
  scheduleSave()
}

function onRateChange(): void {
  playbackRate.value = normalizePlaybackRate(playbackRate.value)
  applyPlaybackRate()
  scheduleSave()
}

function onExportResolutionChange(value: string): void {
  if (value === 'custom') {
    isCustomResolution.value = true
    scheduleSave()
    return
  }
  const match = /^(\d+)x(\d+)$/i.exec(value.trim())
  if (!match) return
  exportWidth.value = Math.min(7680, Math.max(320, Number(match[1])))
  exportHeight.value = Math.min(4320, Math.max(180, Number(match[2])))
  isCustomResolution.value = false
  scheduleSave()
}

const watermarkFileName = computed(() => watermarkSrc.value.split(/[\\/]/).pop()?.trim() || '')

/** 选择目标平台 → 自动套用分辨率 / 帧率 / 码率建议，并按安全区适配竖屏字幕偏移 */
function onExportPlatformChange(id: string): void {
  exportPlatformId.value = id
  const spec = exportPlatformById(id)
  if (spec && id !== 'custom') {
    exportWidth.value = spec.width
    exportHeight.value = spec.height
    exportFps.value = spec.fps
    exportVideoBitrateKbps.value = spec.videoBitrateKbps
    isCustomResolution.value = false
    previewFrameRatioKey.value = 'export'
    if (spec.frame === 'portrait') {
      subtitleYOffset.value = exportPlatformSubtitleOffset(spec.height, spec)
    }
  }
  scheduleSave()
}

function onWatermarkEnabledChange(checked: boolean): void {
  watermarkEnabled.value = checked
  scheduleSave()
}

function pickWatermarkImage(): void {
  watermarkInputEl.value?.click()
}

function onWatermarkImagePicked(event: Event): void {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  const path = window.studio.getPathForFile(file)
  if (!path) return
  watermarkSrc.value = path
  watermarkEnabled.value = true
  scheduleSave()
}

function clearWatermark(): void {
  watermarkSrc.value = ''
  watermarkEnabled.value = false
  scheduleSave()
}

function onWatermarkPositionChange(value: string): void {
  if (value === 'bl' || value === 'tr' || value === 'tl' || value === 'br') {
    watermarkPosition.value = value
  }
  scheduleSave()
}

function applyPlaybackRate(): void {
  const el = previewEl.value
  const active = clips.value.find((c) => c.id === activeClipId.value)
  const activeSpeed = clampClipSpeed(active?.speed)
  if (el) el.playbackRate = Math.min(16, Math.max(0.1, playbackRate.value * activeSpeed))
  for (const [id, audio] of audioEls.entries()) {
    const clip = clips.value.find((c) => c.id === id)
    audio.playbackRate = Math.min(
      16,
      Math.max(0.1, playbackRate.value * clampClipSpeed(clip?.speed))
    )
  }
  for (const [id, overlay] of overlayEls.entries()) {
    const clip = clips.value.find((c) => c.id === id)
    overlay.playbackRate = Math.min(
      16,
      Math.max(0.1, playbackRate.value * clampClipSpeed(clip?.speed))
    )
  }
}

/** 预览区 video 元素的原声（video / overlay 轨），同步静音、音量、淡入淡出与轨道增益 */
function syncMainVideoAudioGain(clip: ScriptTimelineClip | null | undefined, local: number): void {
  const el = previewEl.value
  if (!el) return
  const track = clip?.track ?? 'video'
  if (mutedTracks.value.has(track)) {
    el.muted = true
    return
  }
  el.muted = false
  if (!clip) {
    el.volume = 1
    return
  }
  const vol = Number.isFinite(clip.volume) ? Math.min(2, Math.max(0, clip.volume!)) : 1
  const trackGain = clampTrackGain(mixGains.value[track])
  const fade = fadeFactorAt(clip, local)
  el.volume = clamp01(vol * trackGain * fade * clampTrackGain(mixMasterGain.value))
}

function applyPreviewMuted(track: ScriptTimelineTrackKind = 'video'): void {
  const active = clips.value.find((c) => c.id === activeClipId.value)
  const local = active ? Math.max(0, playheadSec.value - active.startSec) : 0
  syncMainVideoAudioGain(active ?? ({ track } as ScriptTimelineClip), local)
}

function seekToStart(): void {
  playheadSec.value = 0
  void syncPreviewToPlayhead()
  void syncAudioToPlayhead(playing.value)
}

/** 单帧步进（按导出帧率步进，默认 1/30s） */
function stepFrame(deltaFrames: number): void {
  stopPlayback()
  const fps = Math.max(1, exportFps.value || 30)
  const next = Math.min(totalDuration.value, Math.max(0, playheadSec.value + deltaFrames / fps))
  playheadSec.value = Math.round(next * 1000) / 1000
  void syncPreviewToPlayhead()
  void syncAudioToPlayhead(false)
}

function collectCutPoints(): number[] {
  const pts = new Set<number>([0, totalDuration.value])
  for (const clip of clips.value) {
    if (hiddenTracks.value.has(clip.track)) continue
    pts.add(Math.round(clip.startSec * 1000) / 1000)
    pts.add(Math.round((clip.startSec + clip.durationSec) * 1000) / 1000)
  }
  return [...pts].sort((a, b) => a - b)
}

function seekPrevCut(): void {
  stopPlayback()
  const pts = collectCutPoints()
  const cur = playheadSec.value
  let target = 0
  for (const pt of pts) {
    if (pt < cur - 0.02) target = pt
    else break
  }
  playheadSec.value = target
  void syncPreviewToPlayhead()
  void syncAudioToPlayhead(false)
}

function seekNextCut(): void {
  stopPlayback()
  const pts = collectCutPoints()
  const cur = playheadSec.value
  const target = pts.find((pt) => pt > cur + 0.02) ?? totalDuration.value
  playheadSec.value = target
  void syncPreviewToPlayhead()
  void syncAudioToPlayhead(false)
}

function zoomFit(): void {
  zoomFactor.value = 1
  const board = timelineBoardEl.value
  if (board) board.scrollLeft = 0
}

function onTimelineWheel(e: WheelEvent): void {
  const board = timelineBoardEl.value
  if (!board) return
  const target = e.target as HTMLElement | null
  const onRuler = Boolean(target?.closest('.ruler-row'))
  const hasVScroll = board.scrollHeight > board.clientHeight + 2
  const zoomModifier = e.ctrlKey || e.metaKey || e.altKey

  // 当轨道窗口存在纵向溢出且未按 Ctrl/Alt/Meta、也未悬停在时间标尺上时，滚轮优先用于上下滚动轨道到底部
  if (hasVScroll && !zoomModifier && !onRuler && Math.abs(e.deltaY) >= Math.abs(e.deltaX)) {
    board.scrollTop = Math.max(
      0,
      Math.min(board.scrollHeight - board.clientHeight, board.scrollTop + e.deltaY)
    )
    if (e.deltaX !== 0) {
      board.scrollLeft = Math.max(
        0,
        Math.min(board.scrollWidth - board.clientWidth, board.scrollLeft + e.deltaX)
      )
    }
    return
  }

  const rect = board.getBoundingClientRect()
  const cursorLaneX = e.clientX - rect.left + board.scrollLeft - TRACK_LABEL_W
  const timeAtCursor = Math.max(0, cursorLaneX / pxPerSec.value)
  const direction = e.deltaY < 0 ? 1 : -1
  const next = Math.min(
    ZOOM_MAX,
    Math.max(ZOOM_MIN, zoomFactor.value * (direction > 0 ? 1.12 : 1 / 1.12))
  )
  if (Math.abs(next - zoomFactor.value) < 0.001) return
  zoomFactor.value = next
  void nextTick(() => {
    const newX = timeAtCursor * pxPerSec.value
    const viewX = e.clientX - rect.left - TRACK_LABEL_W
    board.scrollLeft = Math.max(0, newX - viewX)
  })
}

async function resolveSrc(source: {
  id?: string
  relativePath?: string
  assetId?: string
  stickerId?: string
  text?: string
  stickerColor?: string
}): Promise<string> {
  if (typeof source.stickerId === 'string' && source.stickerId.trim()) {
    const dataUrl = renderTimelineBuiltinStickerDataUrl(source.stickerId, {
      text: source.text,
      color: source.stickerColor
    })
    if (source.id && dataUrl && clipResolvedUrls.value[source.id] !== dataUrl) {
      clipResolvedUrls.value = { ...clipResolvedUrls.value, [source.id]: dataUrl }
    }
    return dataUrl
  }
  const rel = sourceRelativePath(source)
  if (!rel) return ''
  const cachedRel = clipResolvedUrls.value[`rel:${rel}`]
  if (cachedRel) {
    if (source.id && !clipResolvedUrls.value[source.id]) {
      clipResolvedUrls.value = { ...clipResolvedUrls.value, [source.id]: cachedRel }
    }
    return cachedRel
  }
  try {
    const url = (await window.studio.getAssetFileUrl(rel)) || ''
    if (url) {
      clipResolvedUrls.value = {
        ...clipResolvedUrls.value,
        [`rel:${rel}`]: url,
        ...(source.id ? { [source.id]: url } : {})
      }
    }
    return url
  } catch {
    return ''
  }
}

async function probeDuration(src: string, media: 'video' | 'audio' = 'video'): Promise<number> {
  if (!src) return 3
  if (media === 'video' && isImageOrGifUrl(src) && !/\.gif($|\?)/i.test(src)) {
    return 3
  }
  return new Promise((resolve) => {
    const el = media === 'audio' ? document.createElement('audio') : document.createElement('video')
    el.preload = 'metadata'
    el.src = src
    const done = (sec: number) => {
      el.removeAttribute('src')
      el.load()
      resolve(sec > 0 && Number.isFinite(sec) ? sec : 3)
    }
    el.onloadedmetadata = () => done(el.duration)
    el.onerror = () => done(3)
    window.setTimeout(() => done(3), 4000)
  })
}

/**
 * 一键生成 BGM：描述音乐 → MiniMax 音乐模型产出 → 落盘 Cache/Music → 铺到音乐轨。
 * 复用 generateMusic 的同步管线（与图片/语音一致），失败给出引导文案。
 */
/**
 * 一键生成音效：描述 → **专用音效端点**（`/v1/sound-generation`）产出 →
 * 落盘 Cache/Sfx → 铺到音效轨。
 *
 * 早先这里借用音乐端点（`generateMusic` + instrumental），
 * 描述会被当成编曲需求，出来的是配乐而不是音效。
 */
async function onGenerateSfx(): Promise<void> {
  // 音效端点目前只有 ElevenLabs 实现，所以下拉实际在选「用哪个提供商实例」，
  // 模型固定为 eleven_text_to_sound_v2（buildSoundEffectOptions 负责这一点）
  const options = buildSoundEffectOptions(await loadAllProviders())
  if (!options.length) {
    await promptAlert({
      title: t('script.timeline.generateSfx'),
      message: t('script.timeline.generateSfxNoProvider')
    })
    return
  }
  const result = await promptTextWithModel({
    title: t('script.timeline.generateSfx'),
    message: t('script.timeline.generateSfxPrompt'),
    placeholder: t('script.timeline.generateSfxPlaceholder'),
    modelOptions: options,
    initialModelKey: options[0]!.key
  })
  if (!result || !result.text.trim()) return
  await generateSfxCore(result.text.trim(), result.text.trim().slice(0, 24), result.modelKey)
}

/** 音效生成核心：生成 → 上素材列表 → 铺音效轨；成功返回落盘 source，失败弹错返回 null */
async function generateSfxCore(
  prompt: string,
  name?: string,
  modelKey?: string
): Promise<ScriptTimelineSource | null> {
  sfxBusy.value = true
  try {
    const parsed = modelKey ? parseModelKey(modelKey) : undefined
    // 专用音效端点：上游按「声音本身」生成，不是编曲。
    // 落盘目录由主进程按 kind='sfx' 解析（Cache/Sfx），这里只给模型覆盖
    const result = await window.studio.generateSoundEffect({
      prompt,
      ...(parsed ? { providerInstanceId: parsed.providerInstanceId, model: parsed.model } : {})
    })
    // 音效端点不返回 durationMs（音乐才返回），时长交给播放器 / 波形自己算
    const durationSec =
      result.durationMs && result.durationMs > 0 ? Math.round(result.durationMs / 1000) : undefined
    const source: ScriptTimelineSource = {
      id: `sfx:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 7)}`,
      title:
        name?.trim() || (result.relativePath?.split('/').pop() || 'SFX').replace(/\.[^.]+$/, ''),
      relativePath: result.relativePath,
      assetId: result.assetId,
      origin: 'imported'
    }
    upsertImportedSource(source, 'voice', durationSec)
    await addSourceToTrack(source, 'sfx', 0)
    return source
  } catch (err) {
    await promptAlert({
      title: t('script.timeline.generateSfx'),
      message: t('script.timeline.generateSfxFailed', {
        error: err instanceof Error ? err.message : String(err)
      })
    })
    return null
  } finally {
    sfxBusy.value = false
  }
}

/** ── 音效库：内置预设（转场 / UI / 环境）+ 资产库导入 ── */
const sfxLibraryOpen = ref(false)
const sfxLibraryCategory = ref<'all' | SfxPresetCategory>('all')

const sfxLibraryCategoryLabels = computed<Record<'all' | SfxPresetCategory, string>>(() => {
  const labels: Record<'all' | SfxPresetCategory, string> = {
    all: t('script.timeline.sfxLibraryAll'),
    ui: '',
    transition: '',
    ambient: ''
  }
  for (const meta of SFX_PRESET_CATEGORIES)
    labels[meta.id] = localizedText(locale.value, meta.label)
  return labels
})

const sfxLibraryCategoryIcons = computed<Record<'all' | SfxPresetCategory, string>>(() => {
  const icons: Record<'all' | SfxPresetCategory, string> = {
    all: '🎵',
    ui: '🔔',
    transition: '⚡',
    ambient: '🌿'
  }
  for (const meta of SFX_PRESET_CATEGORIES) icons[meta.id] = meta.icon
  return icons
})

const filteredSfxPresets = computed(() =>
  sfxLibraryCategory.value === 'all'
    ? SFX_PRESETS
    : SFX_PRESETS.filter((p) => p.category === sfxLibraryCategory.value)
)

/** 项目声音资产（voice 类型或音频扩展名），供「从资产库导入」 */
const projectAudioAssets = computed(() => {
  const audioExtRe = /\.(mp3|wav|m4a|aac|ogg|flac|webm|aiff|wma|opus)$/i
  return project.assets.filter((a) => a.type === 'voice' || audioExtRe.test(a.relativePath))
})

function openSfxLibrary(): void {
  sfxLibraryOpen.value = true
}

function closeSfxLibrary(): void {
  sfxLibraryOpen.value = false
}

function setSfxLibraryCategory(category: 'all' | SfxPresetCategory): void {
  sfxLibraryCategory.value = category
}

async function onLibraryGenerateSfx(preset: SfxPreset): Promise<void> {
  if (sfxBusy.value) return
  const name = localizedText(locale.value, preset.name)
  const source = await generateSfxCore(localizedText(locale.value, preset.prompt), name)
  if (!source) return
  await promptAlert({
    title: t('script.timeline.sfxLibrary'),
    message: t('script.timeline.sfxLibraryGenerated', { name })
  })
}

async function onImportSfxAsset(asset: AssetInfo): Promise<void> {
  const source = assetToSource(asset)
  if (!source) return
  upsertImportedSource(source, 'voice')
  await addSourceToTrack(source, 'sfx', 0)
  await promptAlert({
    title: t('script.timeline.sfxLibrary'),
    message: t('script.timeline.sfxLibraryImported', { name: asset.name })
  })
}

function openMixer(): void {
  mixerOpen.value = true
}

function closeMixer(): void {
  mixerOpen.value = false
}

/** 轨道增益（0~2）落库并调度保存 */
function onMixGainChange(kind: ScriptTimelineTrackKind, value: number): void {
  const clamped = clampTrackGain(value)
  mixGains.value = { ...mixGains.value, [kind]: clamped }
  scheduleSave()
}

function onMasterGainChange(value: number): void {
  mixMasterGain.value = clampTrackGain(value)
  scheduleSave()
}

function onMixEqChange(): void {
  mixBassGainDb.value = clampMixEqGainDb(mixBassGainDb.value)
  mixTrebleGainDb.value = clampMixEqGainDb(mixTrebleGainDb.value)
  scheduleSave()
}

function onMixCompressionChange(value: boolean): void {
  mixCompression.value = value
  scheduleSave()
}

/** 轨道增益的百分比展示（0~200%） */
function mixGainPercent(kind: ScriptTimelineTrackKind): number {
  return Math.round(clampTrackGain(mixGains.value[kind] ?? 1) * 100)
}

function mixGainDbLabel(kind: ScriptTimelineTrackKind): string {
  const g = clampTrackGain(mixGains.value[kind] ?? 1)
  if (g <= 0.001) return '-∞'
  return `${Math.round(20 * Math.log10(g))} dB`
}

function mixMasterGainDbLabel(): string {
  const g = clampTrackGain(mixMasterGain.value)
  if (g <= 0.001) return '-∞'
  return `${Math.round(20 * Math.log10(g))} dB`
}

async function onGenerateBgm(): Promise<void> {
  // 读 music 模态：三家的音乐模型（MiniMax music-3.0 / 百炼 fun-music-* / ElevenLabs music_*）
  // 都在这个模态下，不再需要按模型类别过滤
  const { options, selectedKey } = await loadGenerateModelOptions('music')
  const result = await promptTextWithModel({
    title: t('script.timeline.generateBgm'),
    message: t('script.timeline.generateBgmPrompt'),
    placeholder: t('script.timeline.generateBgmPlaceholder'),
    modelOptions: options,
    initialModelKey: selectedKey
  })
  if (!result || !result.text.trim()) return
  bgmBusy.value = true
  try {
    const parsed = result.modelKey ? parseModelKey(result.modelKey) : undefined
    const generated = await window.studio.generateMusic({
      prompt: result.text.trim(),
      instrumental: true,
      ...(parsed ? { providerInstanceId: parsed.providerInstanceId, model: parsed.model } : {})
    })
    const durationSec =
      generated.durationMs && generated.durationMs > 0
        ? Math.round(generated.durationMs / 1000)
        : undefined
    const source: ScriptTimelineSource = {
      id: `bgm:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 7)}`,
      title: (generated.relativePath?.split('/').pop() || 'BGM').replace(/\.[^.]+$/, ''),
      relativePath: generated.relativePath,
      assetId: generated.assetId,
      origin: 'imported'
    }
    upsertImportedSource(source, 'voice', durationSec)
    await addSourceToTrack(source, 'music', 0)
    await promptAlert({
      title: t('script.timeline.generateBgmDoneTitle'),
      message: t('script.timeline.generateBgmDone', { name: source.title })
    })
  } catch (err) {
    await promptAlert({
      title: t('script.timeline.generateBgm'),
      message: t('script.timeline.generateBgmFailed', {
        error: err instanceof Error ? err.message : String(err)
      })
    })
  } finally {
    bgmBusy.value = false
  }
}

async function autoPlaceSourcesOnTracks(toPlace: ScriptTimelineSource[]): Promise<void> {
  if (!toPlace.length) return
  const nextClips = clips.value.map((c) => ({ ...c }))
  let videoCursor = nextStartOnTrack('video')
  let voiceCursor = nextStartOnTrack('voice')
  let addedAny = false
  for (const src of toPlace) {
    const isVoice = sourceMediaKind(src) === 'voice'
    const track: ScriptTimelineTrackKind = isVoice ? 'voice' : 'video'
    if (lockedTracks.value.has(track)) continue
    const url = await resolveSrc(src)
    const durationSec =
      src.durationSec && src.durationSec > 0
        ? src.durationSec
        : await probeDuration(url, isVoice ? 'audio' : 'video')
    const startSec = isVoice ? voiceCursor : videoCursor
    nextClips.push({
      id: `clip:auto:${isVoice ? 'a' : 'v'}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 7)}`,
      track,
      sourceId: src.id,
      title: src.title,
      relativePath: src.relativePath,
      assetId: src.assetId,
      ...(src.nodeId?.trim() ? { nodeId: src.nodeId.trim() } : {}),
      ...(src.nodeTitle?.trim() ? { nodeTitle: src.nodeTitle.trim() } : {}),
      startSec,
      durationSec
    })
    patchSourceDuration(src.id, durationSec)
    if (isVoice) voiceCursor = startSec + durationSec
    else videoCursor = startSec + durationSec
    addedAny = true
  }
  if (!addedAny) return
  commitClips(nextClips)
  const firstVideo = visibleClipsOn('video')[0]
  if (firstVideo && !activeClipId.value) {
    activeClipId.value = firstVideo.id
    void showClipPreview(firstVideo)
  }
}

async function reloadSources(): Promise<void> {
  sourcesBusy.value = true
  try {
    const prevKnownInputKeys = new Set(
      sources.value
        .filter((s) => (s.origin ?? 'input') === 'input')
        .map((s) => sourceIdentityKey(s))
    )
    const collected = await collectScriptTimelineSources({
      scriptAssetId: props.scriptAssetId,
      hostId: hostId.value,
      timelineNodeId: props.timelineNodeId
    })
    const inputNext = collected
      .map((s) =>
        normalizeScriptTimelineSource({
          ...s,
          origin: 'input',
          mediaKind: s.mediaKind === 'voice' ? 'voice' : 'video'
        })
      )
      .filter((s): s is ScriptTimelineSource => !!s)
    const inputKeys = new Set(inputNext.map((s) => sourceIdentityKey(s)))
    // 刷新只更新「节点输入」；拖入的导入素材保留，且不被同路径输入覆盖
    const preservedImported = sources.value
      .filter((s) => {
        if (s.origin === 'imported') return !inputKeys.has(sourceIdentityKey(s))
        // 旧数据无 origin：不在本次输入集合里的视为导入项保留
        if (s.origin == null) return !inputKeys.has(sourceIdentityKey(s))
        return false
      })
      .map((s) =>
        normalizeScriptTimelineSource({
          ...s,
          origin: 'imported',
          mediaKind: s.mediaKind === 'voice' ? 'voice' : 'video'
        })!
      )
      .filter(Boolean)
    sources.value = [...inputNext, ...preservedImported]

    const existingClipKeys = new Set(
      clips.value.map((c) =>
        sourceIdentityKey({
          id: c.sourceId,
          assetId: c.assetId,
          relativePath: c.relativePath
        })
      )
    )
    const hasVideoClips = clips.value.some((c) => c.track === 'video')
    const hasVoiceClips = clips.value.some((c) => c.track === 'voice')
    const toAutoPlace = inputNext.filter((src) => {
      const key = sourceIdentityKey(src)
      if (existingClipKeys.has(key)) return false
      const isVoice = sourceMediaKind(src) === 'voice'
      if (isVoice && !hasVoiceClips) return true
      if (!isVoice && !hasVideoClips) return true
      return !prevKnownInputKeys.has(key)
    })
    if (toAutoPlace.length) {
      await autoPlaceSourcesOnTracks(toAutoPlace)
    }

    scheduleSave()
  } finally {
    sourcesBusy.value = false
  }
}

function newClipId(): string {
  return `clip:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 7)}`
}

function nextStartOnTrack(kind: ScriptTimelineTrackKind): number {
  const list = clipsOn(kind)
  if (!list.length) return 0
  const last = list[list.length - 1]!
  return last.startSec + last.durationSec
}

async function addSourceToTrack(
  source: ScriptTimelineSource,
  track: ScriptTimelineTrackKind,
  startSec?: number
): Promise<void> {
  const url = track === 'subtitle' ? '' : await resolveSrc(source)
  let durationSec = source.durationSec && source.durationSec > 0 ? source.durationSec : 0
  if (track === 'subtitle') {
    durationSec = durationSec > 0 ? Math.min(durationSec, 4) : 3
  } else if (!(durationSec > 0)) {
    const media = track === 'voice' || track === 'music' || track === 'sfx' ? 'audio' : 'video'
    durationSec = await probeDuration(url, media)
  }
  const clip: ScriptTimelineClip = {
    id: newClipId(),
    track,
    sourceId: source.id,
    title: source.title,
    relativePath: source.relativePath,
    assetId: source.assetId,
    ...(source.nodeId?.trim() ? { nodeId: source.nodeId.trim() } : {}),
    ...(source.nodeTitle?.trim() ? { nodeTitle: source.nodeTitle.trim() } : {}),
    startSec:
      startSec == null ? nextStartOnTrack(track) : fitClipStart(track, startSec, durationSec),
    durationSec,
    ...(track === 'subtitle' ? { text: source.title } : {}),
    ...(track === 'overlay'
      ? {
          overlayX: 0.12,
          overlayY: 0.12,
          overlayWidth: 0.36,
          overlayHeight: 0.36,
          opacity: 1,
          volume: 1
        }
      : {})
  }
  commitClips([...clips.value, clip])
  activeClipId.value = clip.id
  patchSourceDuration(source.id, durationSec)
  scheduleSave()
  if (track === 'video') void showClipPreview(clip)
  if (track === 'overlay') {
    playheadSec.value = clip.startSec
    void syncPreviewToPlayhead()
  }
}

/** 定位到片段的来源图节点（回到对应节点图分支，可继续重拍/改参数） */
function locateClipSourceNode(clip: ScriptTimelineClip | null | undefined): void {
  const nodeId = clip?.nodeId?.trim()
  if (!nodeId) return
  workspace.selectGraphNode(nodeId, `asset:${props.scriptAssetId}`)
}

function addBlankSubtitle(): void {
  const placeholder = t('script.timeline.subtitlePlaceholder')
  const clip: ScriptTimelineClip = {
    id: newClipId(),
    track: 'subtitle',
    sourceId: `subtitle:${Date.now()}`,
    title: placeholder,
    text: placeholder,
    startSec: Math.max(0, playheadSec.value),
    durationSec: 3
  }
  commitClips([...clips.value, clip])
  activeClipId.value = clip.id
  scheduleSave()
  openSubtitleEditor(clip)
}

function clipDisplayTitle(clip: ScriptTimelineClip): string {
  if (clip.track === 'subtitle') return (clip.text || clip.title).trim() || clip.title
  return clip.title
}

function onClipDblClick(clip: ScriptTimelineClip): void {
  if (clip.track === 'subtitle') {
    openSubtitleEditor(clip)
    return
  }
  seekToClip(clip)
}

function openSubtitleEditor(clip: ScriptTimelineClip): void {
  subtitleEditor.value = {
    clipId: clip.id,
    draft: clip.text || clip.title || ''
  }
  void nextTick(() => {
    const el = subtitleInputEl.value
    if (!el) return
    el.focus()
    el.select()
  })
}

function cancelSubtitleEdit(): void {
  subtitleEditor.value = null
}

function commitSubtitleEdit(): void {
  const editor = subtitleEditor.value
  if (!editor) return
  const text = editor.draft.trim() || t('script.timeline.subtitlePlaceholder')
  if (editor.clipId) {
    commitClips(clips.value.map((c) => (c.id === editor.clipId ? { ...c, text, title: text } : c)))
  }
  subtitleEditor.value = null
  scheduleSave()
}

function selectSubtitleAtPlayhead(): void {
  const clip = clipsOn('subtitle').find(
    (item) =>
      playheadSec.value >= item.startSec && playheadSec.value < item.startSec + item.durationSec
  )
  if (!clip) return
  activeClipId.value = clip.id
  setSingleClipSelection(clip.id)
}

function onSubtitleWheel(e: WheelEvent): void {
  const delta = e.deltaY < 0 ? 1 : -1
  subtitleFontSize.value = Math.min(200, Math.max(12, subtitleFontSize.value + delta))
  scheduleSave()
}

function bindSubtitleDragListeners(): void {
  window.addEventListener('pointermove', onSubtitleDragMove)
  window.addEventListener('pointerup', onSubtitleDragUp)
  window.addEventListener('pointercancel', onSubtitleDragUp)
}

function unbindSubtitleDragListeners(): void {
  window.removeEventListener('pointermove', onSubtitleDragMove)
  window.removeEventListener('pointerup', onSubtitleDragUp)
  window.removeEventListener('pointercancel', onSubtitleDragUp)
}

function onSubtitleMoveDown(e: PointerEvent): void {
  if (e.button !== 0) return
  selectSubtitleAtPlayhead()
  unbindSubtitleDragListeners()
  subtitleDrag.value = {
    type: 'move',
    pointerId: e.pointerId,
    startY: e.clientY,
    startFont: subtitleFontSize.value,
    startOffset: subtitleYOffset.value
  }
  bindSubtitleDragListeners()
}

function onSubtitleScaleDown(e: PointerEvent): void {
  if (e.button !== 0) return
  selectSubtitleAtPlayhead()
  unbindSubtitleDragListeners()
  subtitleDrag.value = {
    type: 'scale',
    pointerId: e.pointerId,
    startY: e.clientY,
    startFont: subtitleFontSize.value,
    startOffset: subtitleYOffset.value
  }
  bindSubtitleDragListeners()
}

function onSubtitleDragMove(e: PointerEvent): void {
  const session = subtitleDrag.value
  if (!session || e.pointerId !== session.pointerId) return
  const scale = Math.max(0.2, subtitlePreviewScale.value)
  const delta = (session.startY - e.clientY) / scale
  if (session.type === 'scale') {
    subtitleFontSize.value = Math.min(200, Math.max(12, Math.round(session.startFont + delta / 2)))
  } else {
    subtitleYOffset.value = Math.min(1000, Math.max(0, Math.round(session.startOffset + delta)))
  }
  scheduleSave()
}

function onSubtitleDragUp(e: PointerEvent): void {
  const session = subtitleDrag.value
  if (!session || e.pointerId !== session.pointerId) return
  subtitleDrag.value = null
  unbindSubtitleDragListeners()
}

function onAudioVolumeChange(value: number): void {
  const clip = selectedAudioClip.value
  if (!clip) return
  const volume = Number.isFinite(value) ? Math.min(2, Math.max(0, value)) : 1
  clips.value = clips.value.map((c) => (c.id === clip.id ? { ...c, volume } : c))
  applyPreviewMuted(clip.track)
  scheduleSave()
}

function onAudioFadeChange(field: 'fadeInSec' | 'fadeOutSec', value: number): void {
  const clip = selectedAudioClip.value
  if (!clip) return
  const sec = Number.isFinite(value) ? Math.min(clip.durationSec, Math.max(0, value)) : 0
  commitClips(clips.value.map((c) => (c.id === clip.id ? { ...c, [field]: sec } : c)))
  scheduleSave()
}

function onOverlayFieldChange(
  field: 'overlayX' | 'overlayY' | 'overlayWidth' | 'overlayHeight' | 'opacity' | 'volume',
  value: number
): void {
  const clip = selectedOverlayClip.value
  if (!clip || lockedTracks.value.has(clip.track)) return
  const rect = overlayRect(clip)
  const next = { ...clip }
  if (field === 'overlayWidth' || field === 'overlayHeight') {
    const n = clamp01(value)
    const min = 0.08
    next[field] = Math.min(1, Math.max(min, n))
    if (field === 'overlayWidth') {
      next.overlayX = Math.min(rect.left, Math.max(0, 1 - next.overlayWidth!))
    } else {
      next.overlayY = Math.min(rect.top, Math.max(0, 1 - next.overlayHeight!))
    }
  } else if (field === 'overlayX') {
    next.overlayX = Math.min(Math.max(0, value), Math.max(0, 1 - rect.width))
  } else if (field === 'overlayY') {
    next.overlayY = Math.min(Math.max(0, value), Math.max(0, 1 - rect.height))
  } else {
    next[field] = clamp01(value)
  }
  if (next.keyframes?.length && field !== 'volume') {
    const localSec = Math.max(0, Math.min(next.durationSec, playheadSec.value - next.startSec))
    next.keyframes = upsertTimelineClipKeyframe(next, localSec, {
      x: next.overlayX,
      y: next.overlayY,
      width: next.overlayWidth,
      height: next.overlayHeight,
      rotation: next.overlayRotation ?? 0,
      opacity: next.opacity ?? 1
    })
  }
  clips.value = clips.value.map((c) => (c.id === clip.id ? next : c))
  scheduleSave()
}

function onOverlayRotationChange(value: number): void {
  const clip = selectedOverlayClip.value
  if (!clip || lockedTracks.value.has(clip.track)) return
  const rot = Number.isFinite(value)
    ? Math.max(-360, Math.min(360, Math.round(value * 10) / 10))
    : 0
  const next: ScriptTimelineClip = { ...clip, overlayRotation: rot }
  if (next.keyframes?.length) {
    const localSec = Math.max(0, Math.min(next.durationSec, playheadSec.value - next.startSec))
    next.keyframes = upsertTimelineClipKeyframe(next, localSec, { rotation: rot })
  }
  clips.value = clips.value.map((c) => (c.id === clip.id ? next : c))
  scheduleSave()
}

function resetOverlayTransform(): void {
  const clip = selectedOverlayClip.value
  if (!clip) return
  commitClips(
    clips.value.map((c) =>
      c.id === clip.id
        ? {
            ...c,
            overlayX: 0.12,
            overlayY: 0.12,
            overlayWidth: 0.36,
            overlayHeight: 0.36,
            overlayRotation: 0,
            opacity: 1,
            volume: 1
          }
        : c
    )
  )
  scheduleSave()
}

function onOverlayTweenPatch(patch: Partial<ScriptTimelineClip>): void {
  const clip = selectedOverlayClip.value
  if (!clip || lockedTracks.value.has(clip.track)) return
  commitClips(clips.value.map((c) => (c.id === clip.id ? { ...c, ...patch } : c)))
  scheduleSave()
}

function resetOverlayTweens(): void {
  const clip = selectedOverlayClip.value
  if (!clip || lockedTracks.value.has(clip.track)) return
  commitClips(
    clips.value.map((c) =>
      c.id === clip.id
        ? {
            ...c,
            tweenIn: undefined,
            tweenInDurationSec: undefined,
            tweenInEase: undefined,
            tweenOut: undefined,
            tweenOutDurationSec: undefined,
            tweenOutEase: undefined,
            tweenLoop: undefined,
            tweenLoopSpeedHz: undefined,
            tweenLoopIntensity: undefined
          }
        : c
    )
  )
  scheduleSave()
}

function onClipCameraMotionChange(motion: TimelineCameraMotionPreset): void {
  const clip = selectedClip.value
  if (!clip || clip.track !== 'video' || lockedTracks.value.has(clip.track)) return
  commitClips(
    clips.value.map((c) =>
      c.id === clip.id ? { ...c, cameraMotion: motion === 'none' ? undefined : motion } : c
    )
  )
  scheduleSave()
}

function isKeyframeAtPlayhead(
  clip: ScriptTimelineClip,
  kfOrOffset: TimelineClipKeyframe | number
): boolean {
  const offsetSec = typeof kfOrOffset === 'number' ? kfOrOffset : kfOrOffset.offsetSec
  const localSec = playheadSec.value - clip.startSec
  return Math.abs(offsetSec - localSec) <= 0.04
}

function hasKeyframeNearPlayhead(clip: ScriptTimelineClip): boolean {
  if (!clip.keyframes?.length) return false
  return clip.keyframes.some((kf) => isKeyframeAtPlayhead(clip, kf))
}

function addOrUpdateOverlayKeyframeAtPlayhead(): void {
  const clip = selectedOverlayClip.value
  if (!clip || lockedTracks.value.has(clip.track)) return
  const localSec = Math.max(0, Math.min(clip.durationSec, playheadSec.value - clip.startSec))
  const tf = evaluateOverlayClipTransform(clip, localSec)
  const keyframes = upsertTimelineClipKeyframe(clip, localSec, {
    x: tf.left,
    y: tf.top,
    width: tf.width,
    height: tf.height,
    rotation: tf.rotation,
    opacity: tf.opacity
  })
  commitClips(clips.value.map((c) => (c.id === clip.id ? { ...c, keyframes } : c)))
  scheduleSave()
}

function removeOverlayKeyframe(offsetSec: number): void {
  const clip = selectedOverlayClip.value
  if (!clip || lockedTracks.value.has(clip.track)) return
  const keyframes = removeTimelineClipKeyframeAt(clip.keyframes, offsetSec)
  commitClips(
    clips.value.map((c) =>
      c.id === clip.id ? { ...c, keyframes: keyframes.length ? keyframes : undefined } : c
    )
  )
  scheduleSave()
}

function clearOverlayKeyframes(): void {
  const clip = selectedOverlayClip.value
  if (!clip || lockedTracks.value.has(clip.track)) return
  commitClips(clips.value.map((c) => (c.id === clip.id ? { ...c, keyframes: undefined } : c)))
  scheduleSave()
}

function onOverlayKeyframeEaseChange(offsetSec: number, easeRaw: string): void {
  const clip = selectedOverlayClip.value
  if (!clip || !clip.keyframes?.length || lockedTracks.value.has(clip.track)) return
  const ease = (TIMELINE_EASE_TYPES as readonly string[]).includes(easeRaw)
    ? (easeRaw as TimelineEaseType)
    : ('outCubic' as TimelineEaseType)
  const keyframes = normalizeTimelineKeyframes(
    clip.keyframes.map((kf) => (Math.abs(kf.offsetSec - offsetSec) <= 0.04 ? { ...kf, ease } : kf)),
    clip.durationSec
  )
  commitClips(clips.value.map((c) => (c.id === clip.id ? { ...c, keyframes } : c)))
  scheduleSave()
}

function seekToClipKeyframe(
  clip: ScriptTimelineClip,
  kfOrOffset: TimelineClipKeyframe | number
): void {
  const offsetSec = typeof kfOrOffset === 'number' ? kfOrOffset : kfOrOffset.offsetSec
  playheadSec.value = Math.min(totalDuration.value, Math.max(0, clip.startSec + offsetSec))
  void syncPreviewToPlayhead()
}

function clipHasTweenBadge(clip: ScriptTimelineClip): boolean {
  if (clip.track === 'overlay') return hasOverlayClipTween(clip)
  if (clip.track === 'video') return Boolean(clip.cameraMotion && clip.cameraMotion !== 'none')
  return false
}

const builtinStickers = TIMELINE_BUILTIN_STICKERS

function builtinStickerPreviewUrl(sticker: TimelineBuiltinStickerPreset): string {
  return renderTimelineBuiltinStickerDataUrl(sticker.id, {
    text: sticker.defaultText,
    color: sticker.defaultColor
  })
}

async function addBuiltinStickerToOverlay(
  sticker: TimelineBuiltinStickerPreset,
  startSec?: number
): Promise<void> {
  if (lockedTracks.value.has('overlay')) return
  const durationSec = 3
  const targetStart =
    startSec != null
      ? fitClipStart('overlay', startSec, durationSec)
      : fitClipStart('overlay', Math.max(0, playheadSec.value), durationSec)
  const clip: ScriptTimelineClip = {
    id: newClipId(),
    track: 'overlay',
    sourceId: `sticker:${sticker.id}:${Date.now().toString(36)}`,
    title: t(sticker.labelKey),
    stickerId: sticker.id,
    stickerColor: sticker.defaultColor,
    ...(sticker.defaultText ? { text: sticker.defaultText } : {}),
    startSec: targetStart,
    durationSec,
    overlayX: Math.max(0, Math.min(1 - sticker.defaultWidth, (1 - sticker.defaultWidth) / 2)),
    overlayY: Math.max(0, Math.min(1 - sticker.defaultHeight, 0.18)),
    overlayWidth: sticker.defaultWidth,
    overlayHeight: sticker.defaultHeight,
    overlayRotation: 0,
    opacity: 1,
    volume: 0,
    tweenIn: sticker.defaultTweenIn,
    tweenInDurationSec: 0.45,
    tweenInEase: sticker.defaultTweenIn === 'elasticIn' ? 'outElastic' : 'outBack',
    tweenLoop: sticker.defaultTweenLoop,
    tweenLoopSpeedHz: 1.4,
    tweenLoopIntensity: 1,
    tweenOut: 'popOut',
    tweenOutDurationSec: 0.35,
    tweenOutEase: 'inBack'
  }
  commitClips([...clips.value, clip])
  activeClipId.value = clip.id
  setSingleClipSelection(clip.id)
  playheadSec.value = clip.startSec
  scheduleSave()
  void syncPreviewToPlayhead()
}

function onBuiltinStickerDragStart(e: DragEvent, sticker: TimelineBuiltinStickerPreset): void {
  if (!e.dataTransfer) return
  e.dataTransfer.setData(
    DRAFT_MIME,
    JSON.stringify({
      id: `sticker:${sticker.id}`,
      title: t(sticker.labelKey),
      stickerId: sticker.id,
      stickerColor: sticker.defaultColor,
      text: sticker.defaultText,
      mediaKind: 'video'
    })
  )
  e.dataTransfer.effectAllowed = 'copy'
}

function onOverlayStickerPresetChange(stickerId: string): void {
  const clip = selectedOverlayClip.value
  if (!clip || lockedTracks.value.has(clip.track)) return
  const preset = TIMELINE_BUILTIN_STICKERS.find((s) => s.id === stickerId)
  if (!preset) return
  commitClips(
    clips.value.map((c) =>
      c.id === clip.id
        ? {
            ...c,
            stickerId: preset.id,
            title: t(preset.labelKey),
            stickerColor: c.stickerColor || preset.defaultColor,
            text: c.text || preset.defaultText
          }
        : c
    )
  )
  scheduleSave()
}

function onOverlayStickerTextChange(value: string): void {
  const clip = selectedOverlayClip.value
  if (!clip || lockedTracks.value.has(clip.track)) return
  const text = value.trim()
  commitClips(clips.value.map((c) => (c.id === clip.id ? { ...c, text } : c)))
  scheduleSave()
}

function onOverlayStickerColorChange(value: string): void {
  const clip = selectedOverlayClip.value
  if (!clip || lockedTracks.value.has(clip.track)) return
  const color = value.trim()
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) return
  commitClips(clips.value.map((c) => (c.id === clip.id ? { ...c, stickerColor: color } : c)))
  scheduleSave()
}

function bindOverlayDragListeners(): void {
  window.addEventListener('pointermove', onOverlayPointerMove)
  window.addEventListener('pointerup', onOverlayPointerUp)
  window.addEventListener('pointercancel', onOverlayPointerUp)
}

function unbindOverlayDragListeners(): void {
  window.addEventListener('pointermove', onOverlayPointerMove)
  window.removeEventListener('pointerup', onOverlayPointerUp)
  window.removeEventListener('pointercancel', onOverlayPointerUp)
}

function onOverlayPointerDown(e: PointerEvent, clip: ScriptTimelineClip): void {
  if (e.button !== 0 || lockedTracks.value.has(clip.track)) return
  selectClip(clip)
  const target = e.target as HTMLElement | null
  const handle = target?.closest('.overlay-handle') as HTMLElement | null
  const corner =
    (handle?.dataset.corner as 'tl' | 'tr' | 'bl' | 'br' | 'rotate' | undefined) ?? 'br'
  const tf = evaluateOverlayClipTransform(clip, playheadSec.value - clip.startSec)
  const canvas = previewCanvasEl.value
  const canvasRect = canvas?.getBoundingClientRect()
  const centerX = canvasRect
    ? canvasRect.left + (tf.left + tf.width / 2) * canvasRect.width
    : e.clientX
  const centerY = canvasRect
    ? canvasRect.top + (tf.top + tf.height / 2) * canvasRect.height
    : e.clientY
  const startAngleDeg = (Math.atan2(e.clientY - centerY, e.clientX - centerX) * 180) / Math.PI
  unbindOverlayDragListeners()
  overlayDrag.value = {
    clipId: clip.id,
    pointerId: e.pointerId,
    mode: corner === 'rotate' ? 'rotate' : handle ? 'scale' : 'move',
    corner,
    startX: e.clientX,
    startY: e.clientY,
    startLeft: tf.left,
    startTop: tf.top,
    startWidth: tf.width,
    startHeight: tf.height,
    startRotation: tf.rotation,
    centerX,
    centerY,
    startAngleDeg,
    moved: false,
    beforeClips: snapshotClips()
  }
  bindOverlayDragListeners()
  e.preventDefault()
}

function onOverlayPointerMove(e: PointerEvent): void {
  const session = overlayDrag.value
  if (!session || e.pointerId !== session.pointerId) return
  const canvas = previewCanvasEl.value
  if (!canvas) return
  const rect = canvas.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return
  const dx = (e.clientX - session.startX) / rect.width
  const dy = (e.clientY - session.startY) / rect.height
  const minSize = 0.08

  if (session.mode === 'rotate') {
    const angleDeg =
      (Math.atan2(e.clientY - session.centerY, e.clientX - session.centerX) * 180) / Math.PI
    let deltaDeg = angleDeg - session.startAngleDeg
    if (deltaDeg > 180) deltaDeg -= 360
    if (deltaDeg < -180) deltaDeg += 360
    let nextRot = Math.round((session.startRotation + deltaDeg) * 10) / 10
    if (e.shiftKey) {
      nextRot = Math.round(nextRot / 15) * 15
    }
    nextRot = Math.max(-360, Math.min(360, nextRot))
    session.moved = true
    clips.value = clips.value.map((c) => {
      if (c.id !== session.clipId) return c
      const localSec = Math.max(0, Math.min(c.durationSec, playheadSec.value - c.startSec))
      const keyframes = c.keyframes?.length
        ? upsertTimelineClipKeyframe(c, localSec, { rotation: nextRot })
        : c.keyframes
      return { ...c, overlayRotation: nextRot, keyframes }
    })
    return
  }

  if (session.mode === 'move') {
    const left = clamp01(session.startLeft + dx)
    const top = clamp01(session.startTop + dy)
    const x = Math.min(left, Math.max(0, 1 - session.startWidth))
    const y = Math.min(top, Math.max(0, 1 - session.startHeight))
    session.moved = true
    clips.value = clips.value.map((c) => {
      if (c.id !== session.clipId) return c
      const localSec = Math.max(0, Math.min(c.durationSec, playheadSec.value - c.startSec))
      const keyframes = c.keyframes?.length
        ? upsertTimelineClipKeyframe(c, localSec, { x, y })
        : c.keyframes
      return { ...c, overlayX: x, overlayY: y, keyframes }
    })
    return
  }

  let left = session.startLeft
  let top = session.startTop
  let width = session.startWidth
  let height = session.startHeight
  const right = left + width
  const bottom = top + height

  if (session.corner.includes('l')) {
    left = Math.min(Math.max(0, session.startLeft + dx), right - minSize)
    width = right - left
  } else {
    const nextRight = Math.max(left + minSize, Math.min(1, right + dx))
    width = nextRight - left
  }

  if (session.corner.includes('t')) {
    top = Math.min(Math.max(0, session.startTop + dy), bottom - minSize)
    height = bottom - top
  } else {
    const nextBottom = Math.max(top + minSize, Math.min(1, bottom + dy))
    height = nextBottom - top
  }

  left = clamp01(left)
  top = clamp01(top)
  width = clamp01(width)
  height = clamp01(height)
  session.moved = true
  clips.value = clips.value.map((c) => {
    if (c.id !== session.clipId) return c
    const localSec = Math.max(0, Math.min(c.durationSec, playheadSec.value - c.startSec))
    const keyframes = c.keyframes?.length
      ? upsertTimelineClipKeyframe(c, localSec, {
          x: left,
          y: top,
          width,
          height
        })
      : c.keyframes
    return {
      ...c,
      overlayX: left,
      overlayY: top,
      overlayWidth: width,
      overlayHeight: height,
      keyframes
    }
  })
}

function onOverlayPointerUp(e: PointerEvent): void {
  const session = overlayDrag.value
  if (!session || e.pointerId !== session.pointerId) return
  overlayDrag.value = null
  unbindOverlayDragListeners()
  if (session.moved) {
    pushHistorySnapshot(session.beforeClips)
    scheduleSave()
  }
}

function onClipStartChange(value: number): void {
  const clip = selectedClip.value
  if (!clip || lockedTracks.value.has(clip.track)) return
  const startSec = Number.isFinite(value)
    ? Math.min(Math.max(0, totalDuration.value - MIN_CLIP_SEC), Math.max(0, value))
    : clip.startSec
  if (Math.abs(startSec - clip.startSec) < 0.001) return
  commitClips(clips.value.map((c) => (c.id === clip.id ? { ...c, startSec } : c)))
  scheduleSave()
}

function onClipDurationChange(value: number): void {
  const clip = selectedClip.value
  if (!clip || lockedTracks.value.has(clip.track)) return
  const durationSec = Number.isFinite(value)
    ? Math.max(MIN_CLIP_SEC, Math.min(totalDuration.value - clip.startSec, value))
    : clip.durationSec
  if (Math.abs(durationSec - clip.durationSec) < 0.001) return
  commitClips(clips.value.map((c) => (c.id === clip.id ? { ...c, durationSec } : c)))
  scheduleSave()
}

function onClipSourceOffsetChange(value: number): void {
  const clip = selectedClip.value
  if (!clip || clip.track === 'subtitle' || lockedTracks.value.has(clip.track)) return
  const nextOffset = Number.isFinite(value) ? Math.max(0, Math.round(value * 100) / 100) : 0
  if (Math.abs(nextOffset - (clip.sourceOffsetSec ?? 0)) < 0.001) return
  commitClips(
    clips.value.map((c) =>
      c.id === clip.id ? { ...c, sourceOffsetSec: nextOffset > 0 ? nextOffset : undefined } : c
    )
  )
  void syncPreviewToPlayhead()
  scheduleSave()
}

function onClipSpeedChange(value: number): void {
  const clip = selectedClip.value
  if (!clip || clip.track === 'subtitle' || lockedTracks.value.has(clip.track)) return
  const prevSpeed = clampClipSpeed(clip.speed)
  const nextSpeed = clampClipSpeed(value)
  if (Math.abs(nextSpeed - prevSpeed) < 0.001) return
  const freezeTail = clampClipFreezeTailSec(clip.freezeTailSec)
  const movingDur = Math.max(MIN_CLIP_SEC, clip.durationSec - freezeTail)
  const nextMovingDur = Math.max(
    MIN_CLIP_SEC,
    Math.round(movingDur * (prevSpeed / nextSpeed) * 100) / 100
  )
  const nextDuration = Math.round((nextMovingDur + freezeTail) * 100) / 100
  commitClips(
    clips.value.map((c) =>
      c.id === clip.id
        ? {
            ...c,
            speed: Math.abs(nextSpeed - 1) > 0.001 ? nextSpeed : undefined,
            durationSec: nextDuration
          }
        : c
    )
  )
  applyPlaybackRate()
  scheduleSave()
}

function onClipFreezeTailChange(value: number): void {
  const clip = selectedClip.value
  if (
    !clip ||
    (clip.track !== 'video' && clip.track !== 'overlay') ||
    lockedTracks.value.has(clip.track)
  ) {
    return
  }
  const prevFreeze = clampClipFreezeTailSec(clip.freezeTailSec)
  const nextFreeze = clampClipFreezeTailSec(value)
  if (Math.abs(nextFreeze - prevFreeze) < 0.001) return
  const movingDur = Math.max(MIN_CLIP_SEC, clip.durationSec - prevFreeze)
  const nextDuration = Math.round((movingDur + nextFreeze) * 100) / 100
  commitClips(
    clips.value.map((c) =>
      c.id === clip.id
        ? {
            ...c,
            freezeTailSec: nextFreeze > 0 ? nextFreeze : undefined,
            durationSec: nextDuration
          }
        : c
    )
  )
  scheduleSave()
}

function onClipColorChange(field: 'brightness' | 'contrast' | 'saturation', value: number): void {
  const clip = selectedClip.value
  if (
    !clip ||
    (clip.track !== 'video' && clip.track !== 'overlay') ||
    lockedTracks.value.has(clip.track)
  ) {
    return
  }
  const nextVal =
    field === 'brightness'
      ? Math.min(1, Math.max(-1, Number(value) || 0))
      : Math.min(3, Math.max(0, Number.isFinite(value) ? value : 1))
  clips.value = clips.value.map((c) => (c.id === clip.id ? { ...c, [field]: nextVal } : c))
  scheduleSave()
}

function resetClipColorGrade(): void {
  const clip = targetCreativeClip.value ?? selectedClip.value
  if (!clip) return
  commitClips(
    clips.value.map((c) =>
      c.id === clip.id
        ? {
            ...c,
            brightness: undefined,
            contrast: undefined,
            saturation: undefined,
            vibrance: undefined,
            temperature: undefined,
            tint: undefined,
            highlights: undefined,
            shadows: undefined,
            sharpen: undefined,
            vignette: undefined,
            fade: undefined,
            grain: undefined,
            filterPreset: undefined,
            filterIntensity: undefined
          }
        : c
    )
  )
  scheduleSave()
}

/** ── 剪映式左上角六合一面板（素材 / 特效 / 转场 / 滤镜 / 调节 / 模板） ── */
const leftBrowserTab = ref<TimelineBrowserTabId>('sources')
const activeVisualEffectCategory = ref<TimelineVisualEffectCategory>('all')
const activeFilterCategory = ref<TimelineFilterCategory>('all')
const browserTransitionCategory = ref<TimelineTransitionCategory>('all')
const browserTransitionDurationSec = ref(0.5)

function selectLeftBrowserTab(tabId: TimelineBrowserTabId): void {
  leftBrowserTab.value = tabId
  transitionPopover.value = null
}

const isZhLocale = computed(() =>
  String(locale.value || '')
    .toLowerCase()
    .startsWith('zh')
)

function creativeUiText(key: keyof typeof TIMELINE_CREATIVE_UI_TEXT): string {
  const entry = TIMELINE_CREATIVE_UI_TEXT[key]
  return isZhLocale.value ? entry.zh : entry.en
}

const hasVideoOrOverlayClips = computed(() =>
  clips.value.some((c) => c.track === 'video' || c.track === 'overlay')
)

const targetCreativeClip = computed<ScriptTimelineClip | null>(() => {
  const sel = selectedCroppableClip.value
  if (sel) return sel
  const atHead = clipAtPlayhead()
  if (atHead && (atHead.track === 'video' || atHead.track === 'overlay')) return atHead
  return visibleClipsOn('video')[0] ?? visibleClipsOn('overlay')[0] ?? null
})

function ensureTargetCreativeClipSelected(): ScriptTimelineClip | null {
  const clip = targetCreativeClip.value
  if (!clip) return null
  cancelTransitionSweep()
  if (!selectedClipIds.value.has(clip.id) || activeClipId.value !== clip.id) {
    activeClipId.value = clip.id
    selectedClipIds.value = new Set([clip.id])
  }
  if (clip.track === 'video') {
    const safeStart = clipSafePreviewTimeSec(clip)
    const outOfClipRange =
      playheadSec.value < safeStart || playheadSec.value >= clip.startSec + clip.durationSec
    if (outOfClipRange || activeMainTransition.value) {
      playheadSec.value = safeStart
    }
    void showClipPreview(clip)
  } else if (clip.track === 'overlay') {
    if (
      playheadSec.value < clip.startSec ||
      playheadSec.value >= clip.startSec + clip.durationSec
    ) {
      playheadSec.value = clip.startSec
      void syncPreviewToPlayhead()
    }
  }
  return clip
}

const filteredVisualEffects = computed(() => {
  if (activeVisualEffectCategory.value === 'all') return TIMELINE_VISUAL_EFFECTS
  return TIMELINE_VISUAL_EFFECTS.filter(
    (fx) => fx.id === 'none' || fx.category === activeVisualEffectCategory.value
  )
})

const filteredFilterPresets = computed(() => {
  if (activeFilterCategory.value === 'all') return TIMELINE_FILTER_PRESETS
  return TIMELINE_FILTER_PRESETS.filter(
    (lut) => lut.id === 'none' || lut.category === activeFilterCategory.value
  )
})

const filteredBrowserTransitions = computed(() => {
  if (browserTransitionCategory.value === 'all') return TIMELINE_TRANSITION_CATALOG
  return TIMELINE_TRANSITION_CATALOG.filter((tr) => tr.category === browserTransitionCategory.value)
})

const activeBrowserTransitionPair = computed<VideoTransitionHandle | null>(() => {
  if (selectedTransitionPair.value) return selectedTransitionPair.value
  return videoTransitionHandles.value[0] ?? null
})

const activeBrowserTransitionType = computed<ScriptTimelineTransitionType>(() => {
  return activeBrowserTransitionPair.value?.transitionType ?? 'none'
})

watch(
  activeBrowserTransitionPair,
  (pair) => {
    if (pair && pair.durationSec > 0.04) {
      browserTransitionDurationSec.value = Number(pair.durationSec.toFixed(2))
    }
  },
  { immediate: true }
)

function previewActiveBrowserTransition(): void {
  const pair = activeBrowserTransitionPair.value
  if (!pair) return
  if (pair.transitionType === 'none' || pair.durationSec <= 0.02) {
    onSelectBrowserTransition('dissolve', browserTransitionDurationSec.value || 0.6)
    return
  }
  void previewTransitionBetweenClips(pair.left.id, pair.right.id)
}

function clearAllVideoEffects(): void {
  if (lockedTracks.value.has('video')) return
  commitClips(
    clips.value.map((c) =>
      c.track === 'video' || c.track === 'overlay'
        ? {
            ...c,
            visualEffect: undefined,
            effectIntensity: undefined
          }
        : c
    )
  )
  scheduleSave()
}

function clearAllVideoFilters(): void {
  if (lockedTracks.value.has('video')) return
  commitClips(
    clips.value.map((c) =>
      c.track === 'video' || c.track === 'overlay'
        ? {
            ...c,
            filterPreset: undefined,
            filterIntensity: undefined
          }
        : c
    )
  )
  scheduleSave()
}

function onSelectVisualEffect(effectId: TimelineVisualEffectId): void {
  const clip = ensureTargetCreativeClipSelected()
  if (!clip || lockedTracks.value.has(clip.track)) return
  commitClips(
    clips.value.map((c) =>
      c.id === clip.id
        ? {
            ...c,
            visualEffect: effectId === 'none' ? undefined : effectId,
            effectIntensity: c.effectIntensity ?? 75
          }
        : c
    )
  )
  scheduleSave()
}

function onCreativeEffectIntensityInput(intensity: number): void {
  const clip = ensureTargetCreativeClipSelected()
  if (!clip || lockedTracks.value.has(clip.track)) return
  const clamped = Math.min(100, Math.max(0, Math.round(intensity)))
  clips.value = clips.value.map((c) => (c.id === clip.id ? { ...c, effectIntensity: clamped } : c))
  scheduleSave()
}

function applyCurrentEffectToAllVideoClips(): void {
  const clip = targetCreativeClip.value
  if (!clip || lockedTracks.value.has('video')) return
  const effectId = clip.visualEffect
  const intensity = clip.effectIntensity ?? 75
  commitClips(
    clips.value.map((c) =>
      c.track === 'video'
        ? {
            ...c,
            visualEffect: effectId && effectId !== 'none' ? effectId : undefined,
            effectIntensity: effectId && effectId !== 'none' ? intensity : undefined
          }
        : c
    )
  )
  scheduleSave()
}

function onSelectFilterPreset(filterId: TimelineFilterPresetId): void {
  const clip = ensureTargetCreativeClipSelected()
  if (!clip || lockedTracks.value.has(clip.track)) return
  commitClips(
    clips.value.map((c) =>
      c.id === clip.id
        ? {
            ...c,
            filterPreset: filterId === 'none' ? undefined : filterId,
            filterIntensity: c.filterIntensity ?? 100
          }
        : c
    )
  )
  scheduleSave()
}

function onCreativeFilterIntensityInput(intensity: number): void {
  const clip = ensureTargetCreativeClipSelected()
  if (!clip || lockedTracks.value.has(clip.track)) return
  const clamped = Math.min(100, Math.max(0, Math.round(intensity)))
  clips.value = clips.value.map((c) => (c.id === clip.id ? { ...c, filterIntensity: clamped } : c))
  scheduleSave()
}

function applyCurrentFilterToAllVideoClips(): void {
  const clip = targetCreativeClip.value
  if (!clip || lockedTracks.value.has('video')) return
  const filterId = clip.filterPreset
  const intensity = clip.filterIntensity ?? 100
  commitClips(
    clips.value.map((c) =>
      c.track === 'video'
        ? {
            ...c,
            filterPreset: filterId && filterId !== 'none' ? filterId : undefined,
            filterIntensity: filterId && filterId !== 'none' ? intensity : undefined
          }
        : c
    )
  )
  scheduleSave()
}

function getClipAdjustmentValue(
  clip: ScriptTimelineClip | null | undefined,
  key: TimelineAdjustmentKey
): number {
  const ctrl = TIMELINE_ADJUSTMENT_CONTROLS.find((item) => item.key === key)
  const fallback = ctrl?.defaultValue ?? 0
  if (!clip) return fallback
  const val = clip[key]
  return typeof val === 'number' && Number.isFinite(val) ? val : fallback
}

function onCreativeAdjustmentInput(key: TimelineAdjustmentKey, rawValue: number): void {
  const clip = ensureTargetCreativeClipSelected()
  if (!clip || lockedTracks.value.has(clip.track)) return
  const ctrl = TIMELINE_ADJUSTMENT_CONTROLS.find((item) => item.key === key)
  if (!ctrl) return
  const clamped = Math.min(ctrl.max, Math.max(ctrl.min, Number(rawValue)))
  const isDefault = Math.abs(clamped - ctrl.defaultValue) < 0.002
  clips.value = clips.value.map((c) =>
    c.id === clip.id ? { ...c, [key]: isDefault ? undefined : clamped } : c
  )
  scheduleSave()
}

function applyAdjustmentsToAllVideoClips(): void {
  const clip = targetCreativeClip.value
  if (!clip || lockedTracks.value.has('video')) return
  commitClips(
    clips.value.map((c) =>
      c.track === 'video'
        ? {
            ...c,
            brightness: clip.brightness,
            contrast: clip.contrast,
            saturation: clip.saturation,
            vibrance: clip.vibrance,
            temperature: clip.temperature,
            tint: clip.tint,
            highlights: clip.highlights,
            shadows: clip.shadows,
            sharpen: clip.sharpen,
            vignette: clip.vignette,
            fade: clip.fade,
            grain: clip.grain,
            filterPreset: clip.filterPreset,
            filterIntensity: clip.filterIntensity
          }
        : c
    )
  )
  scheduleSave()
}

function onSelectBrowserTransition(
  transitionType: Exclude<ScriptTimelineTransitionType, 'none'>,
  defaultDurationSec: number
): void {
  if (lockedTracks.value.has('video')) return
  const pair = activeBrowserTransitionPair.value
  if (!pair) return
  const dur =
    browserTransitionDurationSec.value > 0.04
      ? browserTransitionDurationSec.value
      : pair.durationSec > 0.04
        ? pair.durationSec
        : defaultDurationSec || 0.6
  browserTransitionDurationSec.value = dur
  const updated = applyVideoTransitionBetweenClips(clips.value, pair.left.id, pair.right.id, {
    transitionType,
    durationSec: dur
  })
  commitClips(updated)
  activeClipId.value = pair.right.id
  selectedClipIds.value = new Set([pair.right.id])
  void previewTransitionBetweenClips(pair.left.id, pair.right.id)
  scheduleSave()
}

function onInputBrowserTransitionDuration(sec: number): void {
  browserTransitionDurationSec.value = sec
  const pair = activeBrowserTransitionPair.value
  if (!pair) return
  onInputPairTransitionDuration(pair, sec)
}

function onChangeBrowserTransitionDuration(sec: number): void {
  browserTransitionDurationSec.value = sec
  const pair = activeBrowserTransitionPair.value
  if (!pair) return
  const curType =
    activeBrowserTransitionType.value !== 'none' ? activeBrowserTransitionType.value : 'dissolve'
  onSelectBrowserTransition(curType, sec)
}

function applyBrowserTransitionToAllCuts(): void {
  if (lockedTracks.value.has('video')) return
  const curType =
    activeBrowserTransitionType.value !== 'none' ? activeBrowserTransitionType.value : 'dissolve'
  const dur = browserTransitionDurationSec.value > 0.04 ? browserTransitionDurationSec.value : 0.6
  const updated = applyVideoTransitionToAllCuts(clips.value, curType, dur)
  commitClips(updated)
  const pair = activeBrowserTransitionPair.value
  const vClips = clipsOn('video')
  const leftId = pair?.left.id ?? vClips[0]?.id
  const rightId = pair?.right.id ?? vClips[1]?.id
  if (leftId && rightId) {
    activeClipId.value = rightId
    selectedClipIds.value = new Set([rightId])
    void previewTransitionBetweenClips(leftId, rightId)
  }
  scheduleSave()
}

function clearAllVideoTransitions(): void {
  if (lockedTracks.value.has('video')) return
  const updated = applyVideoTransitionToAllCuts(clips.value, 'none', 0)
  commitClips(updated)
  scheduleSave()
}

function onApplyCreativeTemplate(templateId: TimelineCreativeTemplateId): void {
  if (lockedTracks.value.has('video')) return
  const result = applyTimelineCreativeTemplateToClips(
    clips.value,
    sources.value,
    {
      subtitleColor: subtitleColor.value,
      subtitleBorderColor: subtitleBorderColor.value,
      subtitleBorderWidth: subtitleBorderWidth.value,
      subtitleBoxEnabled: subtitleBoxEnabled.value,
      subtitleBoxColor: subtitleBoxColor.value,
      subtitleBoxOpacity: subtitleBoxOpacity.value,
      subtitleMotion: subtitleMotion.value
    },
    templateId,
    (list, leftId, rightId, opts) => applyVideoTransitionBetweenClips(list, leftId, rightId, opts)
  )
  if (result.appliedVideoClipCount === 0) {
    void promptAlert({
      title: t('script.dialog.timeline'),
      message: creativeUiText('noVideoClipsWarning')
    })
    return
  }
  commitClips(result.clips)
  if (result.settings.subtitleColor) subtitleColor.value = result.settings.subtitleColor
  if (result.settings.subtitleBorderColor) {
    subtitleBorderColor.value = result.settings.subtitleBorderColor
  }
  if (typeof result.settings.subtitleBorderWidth === 'number') {
    subtitleBorderWidth.value = result.settings.subtitleBorderWidth
  }
  if (typeof result.settings.subtitleBoxEnabled === 'boolean') {
    subtitleBoxEnabled.value = result.settings.subtitleBoxEnabled
  }
  if (result.settings.subtitleBoxColor) {
    subtitleBoxColor.value = result.settings.subtitleBoxColor
  }
  if (typeof result.settings.subtitleBoxOpacity === 'number') {
    subtitleBoxOpacity.value = result.settings.subtitleBoxOpacity
  }
  if (result.settings.subtitleMotion === 'fade' || result.settings.subtitleMotion === 'none') {
    subtitleMotion.value = result.settings.subtitleMotion
  }
  const firstVideo = result.clips.find((c) => c.track === 'video')
  if (firstVideo) {
    activeClipId.value = firstVideo.id
    selectedClipIds.value = new Set([firstVideo.id])
    void showClipPreview(firstVideo)
  }
  scheduleSave()
}

function clipCreativeBadgeText(clip: ScriptTimelineClip): string {
  if (clip.track !== 'video' && clip.track !== 'overlay') return ''
  const badges: string[] = []
  if (clip.visualEffect && clip.visualEffect !== 'none') {
    badges.push(getTimelineVisualEffectMeta(clip.visualEffect).badge)
  }
  if (clip.filterPreset && clip.filterPreset !== 'none') {
    badges.push(getTimelineFilterPresetMeta(clip.filterPreset).badge)
  }
  return badges.join('·')
}

function onClipSubtitleStyleChange(patch: { fontSize?: number; textColor?: string }): void {
  const clip = selectedClip.value
  if (!clip || clip.track !== 'subtitle' || lockedTracks.value.has(clip.track)) return
  commitClips(
    clips.value.map((c) => {
      if (c.id !== clip.id) return c
      return {
        ...c,
        ...(patch.fontSize !== undefined
          ? { fontSize: Math.min(200, Math.max(12, Math.round(patch.fontSize))) }
          : {}),
        ...(patch.textColor !== undefined ? { textColor: patch.textColor } : {})
      }
    })
  )
  scheduleSave()
}

/** 选中片段的来源节点（宿主图内）；导入素材或来源节点已删除时为空 */
const selectedClipNode = computed(() => {
  const nodeId = selectedClip.value?.nodeId
  if (!nodeId) return null
  void graphEditorHosts.revision.value
  return graphEditorHosts.getNode(hostId.value, nodeId)
})

const canReshootClip = computed(() => !!selectedClip.value?.nodeId)

/** dive 内退回最近的资产帧（节点图）；栈内没有资产帧则回根图 */
function popBackToGraph(): void {
  const frames = diveContext?.frames ?? []
  let index = -1
  for (let i = frames.length - 2; i >= 0; i--) {
    if (frames[i]?.type === 'asset') {
      index = i
      break
    }
  }
  diveContext?.popTo(index)
}

/** 回到节点图并选中片段来源节点，让用户在该分支上重拍 / 重跑 */
function revealClipNodeInGraph(nodeId: string): void {
  popBackToGraph()
  workspace.selectGraphNode(nodeId, hostId.value)
}

/**
 * 重拍编辑器：新节点统一走 `video.framePull`（逐帧拉片与重拍台，支持胶片条框选 + 首尾帧双锚定 + FFmpeg 无缝替换）；
 * 老工程已有的 `video.reshoot` 节点仍兼容打开 `node.reshoot`。
 */
async function openFramePullEditor(nodeId: string): Promise<boolean> {
  if (!diveContext) return false
  const opened = await graphEditorNodeTools.open(hostId.value, 'node.framePull', nodeId)
  if (!opened) return false
  await diveContext.diveView({ viewId: 'node.framePull', hostId: hostId.value, nodeId })
  return true
}

async function openReshootEditor(nodeId: string): Promise<boolean> {
  if (!diveContext) return false
  const opened = await graphEditorNodeTools.open(hostId.value, 'node.reshoot', nodeId)
  if (!opened) return false
  await diveContext.diveView({ viewId: 'node.reshoot', hostId: hostId.value, nodeId })
  return true
}

/** 找到来源节点下游已有的拉片重拍节点（复用，避免每次重拍都新建一个） */
function findDownstreamReshootNode(nodeId: string): { id: string; typeId: string } | null {
  const doc = graphEditorHosts.getDocument(hostId.value)
  if (!doc) return null
  const typeById = new Map(doc.nodes.map((node) => [node.id, node.typeId]))
  const hit = doc.edges.find((edge) => {
    if (edge.source !== nodeId) return false
    const t = typeById.get(edge.target)
    return t === 'video.framePull' || t === 'video.reshoot'
  })
  if (!hit) return null
  return { id: hit.target, typeId: typeById.get(hit.target) ?? 'video.framePull' }
}

/**
 * 时间线「重拍此镜头」：
 * - 来源节点本身是拉片重拍节点 → 直接打开拉片与重拍台
 * - 其它来源 → 复用下游已有的 `video.framePull`（或旧 `video.reshoot`），没有则一键新建 `video.framePull` 并接好上游
 * - 宿主不支持建节点时退回节点图并选中来源节点
 */
async function reshootSelectedClip(): Promise<void> {
  const nodeId = selectedClip.value?.nodeId
  if (!nodeId) return
  if (selectedClipNode.value?.typeId === 'video.framePull') {
    await openFramePullEditor(nodeId)
    return
  }
  if (selectedClipNode.value?.typeId === 'video.reshoot') {
    await openReshootEditor(nodeId)
    return
  }
  if (diveContext) {
    const existing = findDownstreamReshootNode(nodeId)
    if (existing) {
      if (existing.typeId === 'video.reshoot') {
        await openReshootEditor(existing.id)
      } else {
        await openFramePullEditor(existing.id)
      }
      return
    }
    const framePullNodeId = graphEditorHosts.addNode(hostId.value, {
      typeId: 'video.framePull',
      title: t('script.timeline.reshootNodeTitle', { shot: selectedClip.value?.title ?? '' }),
      linkFrom: [{ nodeId }]
    })
    if (framePullNodeId) {
      await openFramePullEditor(framePullNodeId)
      return
    }
  }
  revealClipNodeInGraph(nodeId)
}

/** 片段卡片上的重拍按钮：先选中该片段再跳转，不依赖播放头选中态 */
async function reshootClipFromCard(clip: ScriptTimelineClip): Promise<void> {
  activeClipId.value = clip.id
  selectedClipIds.value = new Set([clip.id])
  await reshootSelectedClip()
}

function onSubtitleTextChange(value: string): void {
  const clip = selectedClip.value
  if (!clip || clip.track !== 'subtitle') return
  const text = value.trim()
  commitClips(
    clips.value.map((c) => (c.id === clip.id ? { ...c, text, title: text || c.title } : c))
  )
  scheduleSave()
}

async function autoPlaceAll(): Promise<void> {
  if (!sources.value.length) await reloadSources()
  const videos = videoSources.value
  const voices = sources.value.filter((s) => sourceMediaKind(s) === 'voice')
  if (!videos.length && !voices.length) return
  const placeVoice =
    voices.length > 0 && (!videos.length || !clips.value.some((c) => c.track === 'voice'))
  const nextClips = clips.value.filter(
    (c) => (videos.length ? c.track !== 'video' : true) && (placeVoice ? c.track !== 'voice' : true)
  )
  let videoCursor = 0
  for (const src of videos) {
    const url = await resolveSrc(src)
    const durationSec =
      src.durationSec && src.durationSec > 0 ? src.durationSec : await probeDuration(url, 'video')
    nextClips.push({
      id: newClipId(),
      track: 'video',
      sourceId: src.id,
      title: src.title,
      relativePath: src.relativePath,
      assetId: src.assetId,
      ...(src.nodeId ? { nodeId: src.nodeId } : {}),
      ...(src.nodeTitle ? { nodeTitle: src.nodeTitle } : {}),
      startSec: videoCursor,
      durationSec
    })
    patchSourceDuration(src.id, durationSec)
    videoCursor += durationSec
  }
  if (placeVoice) {
    let voiceCursor = 0
    for (const src of voices) {
      const url = await resolveSrc(src)
      const durationSec =
        src.durationSec && src.durationSec > 0 ? src.durationSec : await probeDuration(url, 'audio')
      nextClips.push({
        id: newClipId(),
        track: 'voice',
        sourceId: src.id,
        title: src.title,
        relativePath: src.relativePath,
        assetId: src.assetId,
        ...(src.nodeId ? { nodeId: src.nodeId } : {}),
        ...(src.nodeTitle ? { nodeTitle: src.nodeTitle } : {}),
        startSec: voiceCursor,
        durationSec
      })
      patchSourceDuration(src.id, durationSec)
      voiceCursor += durationSec
    }
  }
  commitClips(nextClips)
  scheduleSave()
  const first = visibleClipsOn('video')[0]
  if (first) {
    activeClipId.value = first.id
    void showClipPreview(first)
  }
}

function smartCutTransitionLabelKey(tr: string): string {
  const item = TRANSITION_CATALOG.find((entry) => entry.type === tr)
  return item ? item.labelKey : 'script.timeline.transitionNone'
}

async function onSmartCut(): Promise<void> {
  if (!videoSources.value.length) await reloadSources()
  const videos = videoSources.value
  if (!videos.length) {
    await promptAlert({
      title: t('script.timeline.smartCut'),
      message: t('script.timeline.smartCutNoVideo')
    })
    return
  }
  const gen = readGenParams()
  const model =
    typeof gen.generateModel === 'string' && gen.generateModel.trim()
      ? gen.generateModel.trim()
      : ''
  const providerInstanceId =
    typeof gen.generateProviderInstanceId === 'string' && gen.generateProviderInstanceId.trim()
      ? gen.generateProviderInstanceId.trim()
      : ''
  const { options, selectedKey } = await loadGenerateModelOptions(
    'text',
    preferredModelKey(providerInstanceId, model)
  )
  smartCutModelOptions.value = options
  smartCutModelKey.value = selectedKey || ''
  if (!options.length) {
    await promptAlert({
      title: t('script.timeline.smartCut'),
      message: t('script.timeline.smartCutNoModel')
    })
    return
  }
  smartCutEdits.value = []
  smartCutDialogOpen.value = true
}

/** 用当前选中的模型执行智能粗剪生成，失败返回 false（保留方案窗口便于换模型重试） */
async function runSmartCut(): Promise<boolean> {
  const parsed = smartCutModelKey.value ? parseModelKey(smartCutModelKey.value) : undefined
  if (!parsed) {
    await promptAlert({
      title: t('script.timeline.smartCut'),
      message: t('script.timeline.smartCutNoModel')
    })
    return false
  }
  const videos = videoSources.value
  if (!videos.length) return false
  smartCutBusy.value = true
  try {
    const sources = videos.map((s) => ({
      id: s.id,
      title: s.title,
      durationSec: s.durationSec,
      nodeTitle: s.nodeTitle
    }))
    const current = visibleClipsOn('video').map((c) => ({
      title: c.title,
      sourceId: c.sourceId,
      startSec: c.startSec,
      durationSec: c.durationSec
    }))
    const prompt = buildSmartCutPrompt({ sources, currentClips: current, locale: locale.value })
    const result = await window.studio.generateText({
      prompt,
      providerInstanceId: parsed.providerInstanceId,
      model: parsed.model
    })
    const plan = parseSmartCutPlan(result?.text ?? '')
    if (!plan || !plan.edits.length) {
      await promptAlert({
        title: t('script.timeline.smartCut'),
        message: t('script.timeline.smartCutParseFailed')
      })
      return false
    }
    smartCutEdits.value = plan.edits.map((e) => {
      const src = videos.find((v) => v.id === e.sourceId)
      return {
        sourceId: e.sourceId,
        title: src?.title ?? e.sourceId,
        nodeTitle: src?.nodeTitle,
        durationSec: e.durationSec ?? src?.durationSec ?? 3,
        transitionType: e.transitionType ?? 'none',
        transitionSec: e.transitionSec ?? SMART_CUT_DEFAULT_TRANSITION_SEC
      }
    })
    return true
  } catch (err) {
    await promptAlert({
      title: t('script.timeline.smartCut'),
      message: t('script.timeline.smartCutFailed', {
        error: err instanceof Error ? err.message : String(err)
      })
    })
    return false
  } finally {
    smartCutBusy.value = false
  }
}

/** 方案窗口内切换模型后重新生成 */
async function regenerateSmartCut(): Promise<void> {
  await runSmartCut()
}

/** 取某时间线素材关联的视频打点数据（无打点 / 未入库素材返回 null） */
function beatsForSourceId(sourceId: string): VideoBeatTags | null {
  const source = sources.value.find((s) => s.id === sourceId)
  const assetId = source?.assetId?.trim()
  if (!assetId) return null
  return project.assets.find((a) => a.id === assetId)?.videoBeats ?? null
}

/** 方案行提示：该素材按打点自动取段（跳过空镜头 / 收敛到可用画面） */
function smartCutBeatNote(edit: SmartCutEditDraft): string {
  const win = beatCutWindowForDuration(beatsForSourceId(edit.sourceId), edit.durationSec)
  if (!win) return ''
  const one = (n: number): string => (Math.round(n * 10) / 10).toFixed(1)
  if (win.trimmedToAvailable) {
    return t('script.timeline.smartCutBeatShorter', { dur: one(win.durationSec) })
  }
  if (win.offsetSec <= 0.05) return ''
  return t('script.timeline.smartCutBeatPick', {
    from: one(win.offsetSec),
    dur: one(win.durationSec)
  })
}

function applySmartCut(): void {
  const edits: SmartCutEdit[] = smartCutEdits.value.map((e) => {
    const edit: SmartCutEdit = {
      sourceId: e.sourceId,
      durationSec: e.durationSec,
      transitionType: (SMART_CUT_TRANSITIONS as readonly string[]).includes(e.transitionType)
        ? (e.transitionType as SmartCutEdit['transitionType'])
        : undefined,
      transitionSec: e.transitionSec
    }
    // 打点消费：若该素材已打点，把取段起点 / 实际时长收敛到人物等有效画面窗口
    const win = beatCutWindowForDuration(beatsForSourceId(e.sourceId), e.durationSec)
    if (win) {
      edit.sourceOffsetSec = win.offsetSec
      edit.durationSec = win.durationSec
    }
    return edit
  })
  const applied = applySmartCutPlan({ clips: clips.value, sources: sources.value, plan: { edits } })
  commitClips(applied.clips)
  scheduleSave()
  smartCutDialogOpen.value = false
  const first = visibleClipsOn('video')[0]
  if (first) {
    activeClipId.value = first.id
    void showClipPreview(first)
  }
}

function removeClip(id: string): void {
  const clip = clips.value.find((c) => c.id === id)
  if (clip && lockedTracks.value.has(clip.track)) return
  commitClips(clips.value.filter((c) => c.id !== id))
  const selection = new Set(selectedClipIds.value)
  selection.delete(id)
  selectedClipIds.value = selection
  if (activeClipId.value === id) activeClipId.value = null
  scheduleSave()
}

function splitSelectedClipAtPlayhead(): void {
  const clip = clips.value.find((c) => c.id === activeClipId.value)
  if (!clip) return
  if (lockedTracks.value.has(clip.track)) return
  const split = splitTimelineClipAtTime(clip, playheadSec.value, newClipId(), MIN_CLIP_SEC)
  if (!split) return
  const [first, second] = split
  commitClips(
    clips.value.flatMap((c) => {
      if (c.id !== clip.id) return [c]
      return [first, second]
    })
  )
  activeClipId.value = second.id
  selectedClipIds.value = new Set([second.id])
  scheduleSave()
}

function selectClip(clip: ScriptTimelineClip): void {
  cancelTransitionSweep()
  activeClipId.value = clip.id
  setSingleClipSelection(clip.id)
  if (clip.track === 'video') {
    const safeStart = clipSafePreviewTimeSec(clip)
    const clipEnd = clip.startSec + clip.durationSec
    if (
      playheadSec.value < safeStart ||
      playheadSec.value >= clipEnd ||
      activeMainTransition.value
    ) {
      playheadSec.value = safeStart
    }
    void showClipPreview(clip)
  } else if (clip.track === 'overlay') {
    const clipEnd = clip.startSec + clip.durationSec
    if (playheadSec.value < clip.startSec || playheadSec.value >= clipEnd) {
      playheadSec.value = clip.startSec
      void syncPreviewToPlayhead()
    }
  }
}

function seekToClip(clip: ScriptTimelineClip): void {
  cancelTransitionSweep()
  playheadSec.value = clipSafePreviewTimeSec(clip)
  if (clip.track === 'video') void showClipPreview(clip)
}

async function showClipPreview(clip: ScriptTimelineClip): Promise<void> {
  previewLoadedClipId.value = clip.id
  previewSrc.value = await resolveSrc(clip)
  await Promise.resolve()
  const el = previewEl.value
  if (!el) return
  applyPlaybackRate()
  const localSec = Math.max(0, Math.min(clip.durationSec - 0.02, playheadSec.value - clip.startSec))
  try {
    el.currentTime = mediaTimeForClip(clip, localSec)
  } catch {
    /* ignore */
  }
}

function onSourceDragStart(e: DragEvent, source: ScriptTimelineSource): void {
  e.dataTransfer?.setData(DRAFT_MIME, JSON.stringify(source))
  if (source.origin === 'imported') {
    e.dataTransfer?.setData(SOURCE_MOVE_MIME, source.id)
    e.dataTransfer!.effectAllowed = 'copyMove'
  } else {
    e.dataTransfer!.effectAllowed = 'copy'
  }
}

function trackKindAtClientY(clientY: number): ScriptTimelineTrackKind | null {
  const board = timelineBoardEl.value
  if (!board) return null
  const rows = board.querySelectorAll<HTMLElement>('.track-row[data-track-kind]')
  for (const row of rows) {
    const rect = row.getBoundingClientRect()
    if (clientY < rect.top || clientY > rect.bottom) continue
    const kind = row.dataset.trackKind
    if (kind && collapsedTracks.value.has(kind as ScriptTimelineTrackKind)) continue
    if (
      kind === 'video' ||
      kind === 'overlay' ||
      kind === 'voice' ||
      kind === 'subtitle' ||
      kind === 'music' ||
      kind === 'sfx'
    ) {
      return kind
    }
  }
  return null
}

function laneRectForTrack(kind: ScriptTimelineTrackKind): DOMRect | null {
  const lane = timelineBoardEl.value?.querySelector(
    `.track-row[data-track-kind="${kind}"] .track-lane`
  ) as HTMLElement | null
  return lane?.getBoundingClientRect() ?? null
}

function bindClipDragListeners(): void {
  window.addEventListener('pointermove', onClipPointerMove)
  window.addEventListener('pointerup', onClipPointerUp)
  window.addEventListener('pointercancel', onClipPointerUp)
}

function unbindClipDragListeners(): void {
  window.removeEventListener('pointermove', onClipPointerMove)
  window.removeEventListener('pointerup', onClipPointerUp)
  window.removeEventListener('pointercancel', onClipPointerUp)
}

function onClipPointerDown(e: PointerEvent, clip: ScriptTimelineClip): void {
  if (e.button !== 0) return
  const target = e.target as HTMLElement | null
  if (target?.closest('.clip-remove')) return
  if (lockedTracks.value.has(clip.track)) return
  transitionPopover.value = null
  const rect = laneRectForTrack(clip.track)
  const timeAtPointer = rect ? xToTime(e.clientX - rect.left) : clip.startSec
  if (razorMode.value) {
    if (splitClipAtTime(clip, timeAtPointer)) {
      e.preventDefault()
      return
    }
  }
  if (e.shiftKey || e.ctrlKey || e.metaKey) {
    toggleClipSelection(clip.id)
    activeClipId.value = clip.id
  } else if (!selectedClipIds.value.has(clip.id) || selectedClipIds.value.size <= 1) {
    selectClip(clip)
  } else {
    activeClipId.value = clip.id
  }
  const groupInitialStarts = new Map<string, number>()
  if (selectedClipIds.value.has(clip.id) && selectedClipIds.value.size > 1) {
    for (const c of clips.value) {
      if (selectedClipIds.value.has(c.id) && !lockedTracks.value.has(c.track)) {
        groupInitialStarts.set(c.id, c.startSec)
      }
    }
  }
  // 换轨会重挂载 DOM，监听挂在 window 上以免丢掉拖拽
  unbindClipDragListeners()
  clipDrag.value = {
    clipId: clip.id,
    pointerId: e.pointerId,
    startClientX: e.clientX,
    startClientY: e.clientY,
    grabOffsetSec: timeAtPointer - clip.startSec,
    lastStartSec: clip.startSec,
    moved: false,
    beforeClips: snapshotClips(),
    ...(groupInitialStarts.size > 1 ? { groupInitialStarts } : {})
  }
  clipDragPreview.value = {
    clipId: clip.id,
    track: clip.track,
    startSec: clip.startSec,
    pointerX: e.clientX,
    pointerY: e.clientY
  }
  bindClipDragListeners()
  e.preventDefault()
}

function onClipPointerMove(e: PointerEvent): void {
  const session = clipDrag.value
  if (!session || e.pointerId !== session.pointerId) return
  // 5px 防抖死区：纯单击片段绝不触发重排（避免误抹除转场负重叠）
  if (
    !session.moved &&
    Math.hypot(e.clientX - session.startClientX, e.clientY - session.startClientY) < 5
  ) {
    return
  }
  const clip = clips.value.find((c) => c.id === session.clipId)
  if (!clip) return
  const hoverKind = trackKindAtClientY(e.clientY) ?? clip.track
  if (hoverKind === 'overlay' && clip.track !== 'video' && clip.track !== 'overlay') return
  if (clip.track === 'overlay' && hoverKind !== 'overlay' && hoverKind !== 'video') return
  const kind = hoverKind
  const rect = laneRectForTrack(kind)
  if (!rect) return
  const desiredStart = Math.max(0, xToTime(e.clientX - rect.left) - session.grabOffsetSec)
  clipDragPreview.value = {
    clipId: clip.id,
    track: kind,
    startSec: desiredStart,
    pointerX: e.clientX,
    pointerY: e.clientY
  }

  // 多选编组同轨平移：保持各选中片段相对时间间隔整体平移
  if (session.groupInitialStarts && session.groupInitialStarts.size > 1 && kind === clip.track) {
    const anchorInitial = session.groupInitialStarts.get(clip.id) ?? clip.startSec
    let minInitial = anchorInitial
    for (const s of session.groupInitialStarts.values()) {
      if (s < minInitial) minInitial = s
    }
    const snapped = snapTime(desiredStart, clip.id)
    const delta = Math.max(-minInitial, snapped - anchorInitial)
    const nextAnchorStart = anchorInitial + delta
    if (Math.abs(nextAnchorStart - clip.startSec) < 0.001) return
    session.moved = true
    session.lastStartSec = nextAnchorStart
    clips.value = clips.value.map((c) => {
      const init = session.groupInitialStarts?.get(c.id)
      if (init === undefined) return c
      return { ...c, startSec: Math.max(0, Math.round((init + delta) * 100) / 100) }
    })
    return
  }

  const moveDir = desiredStart >= session.lastStartSec ? 1 : -1
  if (kind === clip.track) {
    const next = reorderClipsOnTrack(kind, clip.id, desiredStart, clip.durationSec)
    const moved = next.find((c) => c.id === clip.id)
    if (!moved || Math.abs(moved.startSec - clip.startSec) < 0.001) return
    session.moved = true
    session.lastStartSec = moved.startSec
    clips.value = next
    return
  }

  const startSec = fitClipStart(kind, desiredStart, clip.durationSec, clip.id, moveDir)
  if (Math.abs(startSec - clip.startSec) < 0.001) return
  session.moved = true
  session.lastStartSec = startSec
  clips.value = clips.value.map((c) =>
    c.id === session.clipId
      ? {
          ...c,
          track: kind,
          startSec,
          ...(kind === 'subtitle' && !c.text ? { text: c.text || c.title } : {}),
          ...(kind === 'overlay' && c.track !== 'overlay'
            ? {
                overlayX: 0.12,
                overlayY: 0.12,
                overlayWidth: 0.36,
                overlayHeight: 0.36,
                opacity: 1,
                volume: 1
              }
            : {})
        }
      : c
  )
}

function onClipPointerUp(e: PointerEvent): void {
  const session = clipDrag.value
  if (!session || e.pointerId !== session.pointerId) return
  clipDrag.value = null
  clipDragPreview.value = null
  unbindClipDragListeners()
  if (session.moved) {
    pushHistorySnapshot(session.beforeClips)
    scheduleSave()
  }
}

function bindTransitionDragListeners(): void {
  window.addEventListener('pointermove', onTransitionPointerMove)
  window.addEventListener('pointerup', onTransitionPointerUp)
  window.addEventListener('pointercancel', onTransitionPointerUp)
}

function unbindTransitionDragListeners(): void {
  window.removeEventListener('pointermove', onTransitionPointerMove)
  window.removeEventListener('pointerup', onTransitionPointerUp)
  window.removeEventListener('pointercancel', onTransitionPointerUp)
}

function onTransitionHandlePointerDown(
  e: PointerEvent,
  handle: { left: ScriptTimelineClip; right: ScriptTimelineClip }
): void {
  if (e.button !== 0 || lockedTracks.value.has('video')) return
  activeClipId.value = handle.right.id
  setSingleClipSelection(handle.right.id)
  const current = handle.right.transitionInSec ?? 0
  if (current > 0.02) {
    void previewTransitionBetweenClips(handle.left.id, handle.right.id)
  } else {
    playheadSec.value = handle.right.startSec
    void showClipPreview(handle.left)
  }
  unbindTransitionDragListeners()
  transitionDrag.value = {
    leftId: handle.left.id,
    rightId: handle.right.id,
    pointerId: e.pointerId,
    startClientX: e.clientX,
    startTransitionSec: current,
    startRightStart: handle.right.startSec,
    moved: false,
    beforeClips: snapshotClips()
  }
  bindTransitionDragListeners()
  e.preventDefault()
}

function onTransitionPointerMove(e: PointerEvent): void {
  const session = transitionDrag.value
  if (!session || e.pointerId !== session.pointerId) return
  if (!session.moved && Math.abs(e.clientX - session.startClientX) < 4) return
  const left = session.beforeClips.find((c) => c.id === session.leftId)
  const right = session.beforeClips.find((c) => c.id === session.rightId)
  if (!left || !right) return
  const deltaSec = (e.clientX - session.startClientX) / Math.max(1, pxPerSec.value)
  const maxTransition = Math.max(0, Math.min(left.durationSec, right.durationSec) - 0.1)
  const duration =
    Math.round(Math.min(maxTransition, Math.max(0, session.startTransitionSec - deltaSec)) * 100) /
    100
  const transitionType: ScriptTimelineTransitionType =
    duration > 0.04
      ? right.transitionType && right.transitionType !== 'none'
        ? right.transitionType
        : 'dissolve'
      : 'none'
  session.moved = true
  transitionPopover.value = null
  clips.value = applyVideoTransitionBetweenClips(session.beforeClips, left.id, right.id, {
    transitionType,
    durationSec: duration
  })
  const updatedRight = clips.value.find((c) => c.id === right.id)
  if (updatedRight && duration > 0.04) {
    browserTransitionDurationSec.value = duration
    playheadSec.value = Number((updatedRight.startSec + duration * 0.5).toFixed(3))
    void syncOverlayVideosToPlayhead(false)
  }
}

function onTransitionPointerUp(e: PointerEvent): void {
  const session = transitionDrag.value
  if (!session || e.pointerId !== session.pointerId) return
  transitionDrag.value = null
  unbindTransitionDragListeners()
  if (session.moved) {
    pushHistorySnapshot(session.beforeClips)
    void previewTransitionBetweenClips(session.leftId, session.rightId)
    scheduleSave()
    return
  }
  // 单击转场胶囊（未拖拽）：弹出可视化转场效果浮层
  if (
    transitionPopover.value &&
    transitionPopover.value.leftId === session.leftId &&
    transitionPopover.value.rightId === session.rightId
  ) {
    transitionPopover.value = null
  } else {
    transitionPopover.value = {
      leftId: session.leftId,
      rightId: session.rightId,
      anchorX: e.clientX,
      anchorY: e.clientY
    }
  }
}

function bindClipResizeListeners(): void {
  window.addEventListener('pointermove', onClipResizeMove)
  window.addEventListener('pointerup', onClipResizeUp)
  window.addEventListener('pointercancel', onClipResizeUp)
}

function unbindClipResizeListeners(): void {
  window.removeEventListener('pointermove', onClipResizeMove)
  window.removeEventListener('pointerup', onClipResizeUp)
  window.removeEventListener('pointercancel', onClipResizeUp)
}

function onClipResizeStart(
  e: PointerEvent,
  clip: ScriptTimelineClip,
  edge: 'left' | 'right'
): void {
  if (e.button !== 0) return
  if (lockedTracks.value.has(clip.track)) return
  selectClip(clip)
  unbindClipResizeListeners()
  clipResize.value = {
    clipId: clip.id,
    pointerId: e.pointerId,
    edge,
    moved: false,
    beforeClips: snapshotClips()
  }
  bindClipResizeListeners()
  e.preventDefault()
}

function onClipResizeMove(e: PointerEvent): void {
  const session = clipResize.value
  if (!session || e.pointerId !== session.pointerId) return
  const clip = clips.value.find((c) => c.id === session.clipId)
  if (!clip) return
  const rect = laneRectForTrack(clip.track)
  if (!rect) return
  const time = snapTime(xToTime(e.clientX - rect.left), clip.id)

  if (session.edge === 'right') {
    const minEnd = clip.startSec + MIN_CLIP_SEC
    let nextEnd = Math.max(minEnd, time)
    const blocker = clips.value.find(
      (c) =>
        c.id !== clip.id &&
        c.track === clip.track &&
        c.startSec > clip.startSec + 0.001 &&
        nextEnd > c.startSec + 0.001
    )
    if (blocker) nextEnd = Math.max(minEnd, blocker.startSec)
    nextEnd = Math.min(totalDuration.value, nextEnd)
    const durationSec = Math.max(MIN_CLIP_SEC, nextEnd - clip.startSec)
    if (Math.abs(durationSec - clip.durationSec) < 0.001) return
    session.moved = true
    clips.value = clips.value.map((c) => (c.id === clip.id ? { ...c, durationSec } : c))
    return
  }

  const endSec = clip.startSec + clip.durationSec
  let startSec = Math.max(0, Math.min(time, endSec - MIN_CLIP_SEC))
  const durationSec = endSec - startSec
  startSec = fitClipStart(clip.track, startSec, durationSec, clip.id, -1)
  const nextDuration = endSec - startSec
  if (
    Math.abs(startSec - clip.startSec) < 0.001 &&
    Math.abs(nextDuration - clip.durationSec) < 0.001
  ) {
    return
  }
  const deltaStart = startSec - clip.startSec
  const prevOffset = clip.sourceOffsetSec ?? 0
  const speed = clampClipSpeed(clip.speed)
  const nextOffset =
    clip.track !== 'subtitle'
      ? Math.max(0, Math.round((prevOffset + deltaStart * speed) * 100) / 100)
      : 0
  session.moved = true
  clips.value = clips.value.map((c) =>
    c.id === clip.id
      ? {
          ...c,
          startSec,
          durationSec: nextDuration,
          ...(c.track !== 'subtitle'
            ? { sourceOffsetSec: nextOffset > 0 ? nextOffset : undefined }
            : {})
        }
      : c
  )
}

function onClipResizeUp(e: PointerEvent): void {
  const session = clipResize.value
  if (!session || e.pointerId !== session.pointerId) return
  clipResize.value = null
  unbindClipResizeListeners()
  if (session.moved) {
    pushHistorySnapshot(session.beforeClips)
    scheduleSave()
  }
}

function isStudioAssetDrag(e: DragEvent): boolean {
  if (workspace.draggingAsset) return true
  const types = e.dataTransfer ? Array.from(e.dataTransfer.types) : []
  return (
    types.includes(STUDIO_ASSET_DRAG_MIME) ||
    types.includes(STUDIO_ASSET_ID_DRAG_MIME) ||
    types.includes(STUDIO_ASSET_IDS_DRAG_MIME)
  )
}

function hasExternalFiles(e: DragEvent): boolean {
  if (isStudioAssetDrag(e)) return false
  const types = e.dataTransfer ? Array.from(e.dataTransfer.types) : []
  return types.includes('Files')
}

function canDropAssetOnTrack(asset: AssetInfo, kind: ScriptTimelineTrackKind): boolean {
  if (kind === 'video') return asset.type === 'video' || asset.type === 'image'
  if (kind === 'overlay') return asset.type === 'video' || asset.type === 'image'
  if (kind === 'voice' || kind === 'music' || kind === 'sfx') return asset.type === 'voice'
  if (kind === 'subtitle') return asset.type === 'video' || asset.type === 'voice'
  return false
}

/** 拖到不匹配轨道时自动改送到合适轨道（如声音拖到视频轨 → 配音轨） */
function resolveTargetTrack(
  asset: AssetInfo,
  requested: ScriptTimelineTrackKind
): ScriptTimelineTrackKind | null {
  if (canDropAssetOnTrack(asset, requested)) return requested
  if (asset.type === 'voice') {
    if (requested === 'music') return 'music'
    if (requested === 'sfx') return 'sfx'
    return 'voice'
  }
  if (asset.type === 'video') {
    if (requested === 'overlay') return 'overlay'
    return requested === 'subtitle' ? 'subtitle' : 'video'
  }
  if (asset.type === 'image') {
    return requested === 'video' ? 'video' : 'overlay'
  }
  return null
}

function canAcceptExternalFilesOnTrack(kind: ScriptTimelineTrackKind): boolean {
  return (
    kind === 'video' ||
    kind === 'overlay' ||
    kind === 'voice' ||
    kind === 'music' ||
    kind === 'sfx' ||
    kind === 'subtitle'
  )
}

function onTrackDragOver(e: DragEvent, kind: ScriptTimelineTrackKind): void {
  if (!e.dataTransfer) return
  if (collapsedTracks.value.has(kind)) {
    e.dataTransfer.dropEffect = 'none'
    dragOverTrack.value = null
    return
  }

  if (e.dataTransfer.types.includes(DRAFT_MIME)) {
    if (kind === 'overlay') {
      const raw = e.dataTransfer.getData(DRAFT_MIME)
      try {
        const payload = JSON.parse(raw) as { mediaKind?: string }
        if (payload.mediaKind === 'voice') {
          e.dataTransfer.dropEffect = 'none'
          dragOverTrack.value = null
          return
        }
      } catch {
        /* ignore */
      }
    }
    // 素材上轨为 copy；若仍有 move 会话则配合 effectAllowed，避免 copy/move 不匹配导致无法放下
    const allowed = e.dataTransfer.effectAllowed
    e.dataTransfer.dropEffect = allowed === 'move' || allowed === 'linkMove' ? 'move' : 'copy'
    dragOverTrack.value = kind
    return
  }

  if (isStudioAssetDrag(e)) {
    const asset = workspace.resolveDraggedAsset(e)
    if (asset && !resolveTargetTrack(asset, kind)) {
      e.dataTransfer.dropEffect = 'none'
      dragOverTrack.value = null
      return
    }
    // dragover 阶段 Chromium 常读不到自定义 MIME；未解析到资产时仍放行，drop 时再校验
    e.dataTransfer.dropEffect = 'copy'
    dragOverTrack.value = kind
    return
  }

  if (hasExternalFiles(e) && canAcceptExternalFilesOnTrack(kind)) {
    e.dataTransfer.dropEffect = 'copy'
    dragOverTrack.value = kind
    return
  }

  e.dataTransfer.dropEffect = 'none'
  dragOverTrack.value = null
}

function onTrackDragLeave(e: DragEvent, kind: ScriptTimelineTrackKind): void {
  const related = e.relatedTarget as Node | null
  const row = e.currentTarget as HTMLElement | null
  if (related && row?.contains(related)) return
  if (dragOverTrack.value === kind) dragOverTrack.value = null
}

function assetToSource(asset: AssetInfo): ScriptTimelineSource | null {
  if (asset.type !== 'video' && asset.type !== 'voice' && asset.type !== 'image') return null
  const relativePath = asset.relativePath?.trim()
  if (!relativePath && !asset.id) return null
  return {
    id: asset.id,
    title: asset.name?.trim() || asset.id,
    relativePath: relativePath || undefined,
    assetId: asset.id
  }
}

function dropStartFromEvent(e: DragEvent, kind: ScriptTimelineTrackKind): number {
  const lane = (e.currentTarget as HTMLElement).querySelector('.track-lane') as HTMLElement | null
  const rect = lane?.getBoundingClientRect()
  return rect ? Math.max(0, xToTime(e.clientX - rect.left)) : nextStartOnTrack(kind)
}

function resolveDroppedAssets(e: DragEvent): AssetInfo[] {
  const idsRaw = e.dataTransfer?.getData(STUDIO_ASSET_IDS_DRAG_MIME)
  if (idsRaw) {
    try {
      const parsed = JSON.parse(idsRaw) as unknown
      if (Array.isArray(parsed)) {
        const list = parsed
          .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
          .map((id) => project.assets.find((a) => a.id === id) ?? null)
          .filter((a): a is AssetInfo => !!a)
        if (list.length) return list
      }
    } catch {
      /* fall through */
    }
  }
  const one = workspace.resolveDraggedAsset(e)
  return one ? [one] : []
}

function getDroppedFilePaths(e: DragEvent): string[] {
  const list = e.dataTransfer?.files
  if (!list?.length) return []
  const paths: string[] = []
  for (let i = 0; i < list.length; i++) {
    const path = window.studio.getPathForFile(list[i]!)
    if (path) paths.push(path)
  }
  return paths
}

function filterImportableMediaPaths(paths: string[]): string[] {
  return paths.filter((path) => {
    if (!isImportablePath(path)) return false
    try {
      const type = detectImportAssetType(path)
      return type === 'video' || type === 'voice' || type === 'image'
    } catch {
      return false
    }
  })
}

async function appendAssetsToTrack(
  assets: AssetInfo[],
  requestedKind: ScriptTimelineTrackKind,
  dropStart: number
): Promise<number> {
  const cursors = new Map<ScriptTimelineTrackKind, number>()
  let placed = 0
  for (const asset of assets) {
    const track = resolveTargetTrack(asset, requestedKind)
    if (!track) continue
    const source = assetToSource(asset)
    if (!source) continue
    const mediaKind: ScriptTimelineSourceMediaKind = asset.type === 'voice' ? 'voice' : 'video'
    // 先写入左侧「导入」列表；从轨道删除片段不会移除列表项
    upsertImportedSource(source, mediaKind)
    const listed = sources.value.find(
      (s) => sourceIdentityKey(s) === sourceIdentityKey(source)
    ) ?? {
      ...source,
      origin: 'imported' as const,
      mediaKind
    }
    const start = cursors.has(track)
      ? cursors.get(track)!
      : track === requestedKind
        ? dropStart
        : nextStartOnTrack(track)
    await addSourceToTrack(listed, track, start)
    placed += 1
    const last = clips.value[clips.value.length - 1]
    if (last) {
      cursors.set(track, last.startSec + last.durationSec)
      upsertImportedSource(listed, mediaKind, last.durationSec)
    }
  }
  return placed
}

async function importDroppedFilesOntoTrack(
  paths: string[],
  kind: ScriptTimelineTrackKind,
  dropStart: number
): Promise<void> {
  const accepted = filterImportableMediaPaths(paths)
  if (!accepted.length) {
    await promptAlert({
      title: t('script.dialog.timeline'),
      message: t('script.timeline.dropUnsupported')
    })
    return
  }
  try {
    const result = await window.studio.importAssets({ filePaths: accepted })
    project.patchAssets(result.imported)
    if (!result.imported.length) {
      const detail =
        result.skipped.map((s) => s.reason).join('; ') || t('script.timeline.dropUnsupported')
      await promptAlert({
        title: t('script.dialog.timeline'),
        message: t('script.timeline.importFailed', { error: detail })
      })
      return
    }
    const placed = await appendAssetsToTrack(result.imported, kind, dropStart)
    if (!placed) {
      await promptAlert({
        title: t('script.dialog.timeline'),
        message: t('script.timeline.dropUnsupported')
      })
    }
  } catch (err) {
    await promptAlert({
      title: t('script.dialog.timeline'),
      message: t('script.timeline.importFailed', {
        error: err instanceof Error ? err.message : String(err)
      })
    })
  }
}

async function onTrackDrop(e: DragEvent, kind: ScriptTimelineTrackKind): Promise<void> {
  dragOverTrack.value = null
  const dropStart = dropStartFromEvent(e, kind)

  const raw = e.dataTransfer?.getData(DRAFT_MIME)
  if (raw) {
    let payload: ScriptTimelineSource & {
      _moveClipId?: string
      durationSec?: number
      text?: string
      stickerId?: string
      stickerColor?: string
    }
    try {
      payload = JSON.parse(raw)
    } catch {
      return
    }
    if (payload.stickerId) {
      const preset = TIMELINE_BUILTIN_STICKERS.find((s) => s.id === payload.stickerId)
      if (preset) {
        await addBuiltinStickerToOverlay(preset, dropStart)
      }
      return
    }
    if (kind === 'overlay' && payload.mediaKind === 'voice') return
    if (payload._moveClipId) {
      const idx = clips.value.findIndex((c) => c.id === payload._moveClipId)
      if (idx >= 0) {
        const prev = clips.value[idx]!
        if (lockedTracks.value.has(prev.track)) return
        const next: ScriptTimelineClip = {
          ...prev,
          track: kind,
          startSec: dropStart,
          ...(kind === 'subtitle' && !prev.text ? { text: prev.text || prev.title } : {})
        }
        commitClips(clips.value.map((c, i) => (i === idx ? next : c)))
        scheduleSave()
        return
      }
    }
    await addSourceToTrack(
      {
        id: payload.id,
        title: payload.title,
        relativePath: payload.relativePath,
        assetId: payload.assetId,
        nodeId: payload.nodeId,
        durationSec: payload.durationSec
      },
      kind,
      dropStart
    )
    return
  }

  const assets = resolveDroppedAssets(e)
  if (assets.length) {
    const placed = await appendAssetsToTrack(assets, kind, dropStart)
    workspace.setDraggingAsset(null)
    if (!placed) {
      await promptAlert({
        title: t('script.dialog.timeline'),
        message: t('script.timeline.dropUnsupported')
      })
    }
    return
  }

  // 资产库拖放但未能解析：静默忽略，避免误报系统文件错误
  if (isStudioAssetDrag(e)) {
    workspace.setDraggingAsset(null)
    return
  }

  const paths = getDroppedFilePaths(e)
  if (paths.length) {
    await importDroppedFilesOntoTrack(paths, kind, dropStart)
  }
}

function onPlayheadPointerDown(e: PointerEvent): void {
  if (e.button !== 0) return
  cancelTransitionSweep()
  playheadDrag.value = { pointerId: e.pointerId }
  window.addEventListener('pointermove', onPlayheadPointerMove)
  window.addEventListener('pointerup', onPlayheadPointerUp)
  window.addEventListener('pointercancel', onPlayheadPointerUp)
  e.preventDefault()
}

function onPlayheadPointerMove(e: PointerEvent): void {
  const session = playheadDrag.value
  if (!session || e.pointerId !== session.pointerId) return
  const lane = timelineBoardEl.value?.querySelector('.track-lane') as HTMLElement | null
  const rect = lane?.getBoundingClientRect()
  if (!rect) return
  playheadSec.value = Math.min(totalDuration.value, Math.max(0, xToTime(e.clientX - rect.left)))
  if (!playing.value) {
    void syncPreviewToPlayhead()
  } else {
    void syncOverlayVideosToPlayhead(playing.value)
  }
}

function onPlayheadPointerUp(e: PointerEvent): void {
  const session = playheadDrag.value
  if (!session || e.pointerId !== session.pointerId) return
  playheadDrag.value = null
  window.removeEventListener('pointermove', onPlayheadPointerMove)
  window.removeEventListener('pointerup', onPlayheadPointerUp)
  window.removeEventListener('pointercancel', onPlayheadPointerUp)
  if (playing.value) {
    stopPlayback()
    void toggleTimelinePlay()
  } else {
    void syncPreviewToPlayhead()
    void syncAudioToPlayhead(playing.value)
  }
}

function onTimelineBlankPointerDown(e: PointerEvent): void {
  const target = e.target as HTMLElement | null
  if (
    target?.closest('.clip, .track-label, .ruler, .playhead, .track-state-btn, .transition-handle')
  ) {
    return
  }
  transitionPopover.value = null
  activeClipId.value = null
  selectedClipIds.value = new Set()
}

function onRulerPointerDown(e: PointerEvent): void {
  if (e.button !== 0) return
  cancelTransitionSweep()
  const el = e.currentTarget as HTMLElement
  const rect = el.getBoundingClientRect()
  playheadSec.value = xToTime(e.clientX - rect.left)
  if (!playing.value) {
    void syncPreviewToPlayhead()
    void syncAudioToPlayhead(false)
  }
  playheadDrag.value = { pointerId: e.pointerId }
  window.addEventListener('pointermove', onPlayheadPointerMove)
  window.addEventListener('pointerup', onPlayheadPointerUp)
  window.addEventListener('pointercancel', onPlayheadPointerUp)
  e.preventDefault()
}

function clipAtPlayhead(): ScriptTimelineClip | null {
  const list = visibleClipsOn('video')
  for (const clip of list) {
    if (
      playheadSec.value >= clip.startSec &&
      playheadSec.value < clip.startSec + clip.durationSec
    ) {
      return clip
    }
  }
  return list.find((c) => c.startSec >= playheadSec.value) ?? null
}

function stopAllAudio(): void {
  for (const el of audioEls.values()) {
    try {
      el.pause()
    } catch {
      /* ignore */
    }
  }
}

function disposeAudioPool(): void {
  for (const el of audioEls.values()) {
    try {
      el.pause()
      el.removeAttribute('src')
      el.load()
    } catch {
      /* ignore */
    }
  }
  audioEls.clear()
  disposePreviewAudioGraph()
}

function pauseOverlayVideos(): void {
  for (const el of overlayEls.values()) {
    try {
      el.pause()
    } catch {
      /* ignore */
    }
  }
  for (const el of transitionVideoEls.values()) {
    try {
      el.pause()
    } catch {
      /* ignore */
    }
  }
}

function disposeOverlayVideos(): void {
  pauseOverlayVideos()
  overlayEls.clear()
  transitionVideoEls.clear()
}

/** 片段淡入淡出系数（0~1），与导出 ffmpeg afade 对齐 */
function fadeFactorAt(clip: ScriptTimelineClip, local: number): number {
  const fadeIn = Number.isFinite(clip.fadeInSec)
    ? Math.min(clip.durationSec, Math.max(0, clip.fadeInSec!))
    : 0
  const fadeOut = Number.isFinite(clip.fadeOutSec)
    ? Math.min(clip.durationSec, Math.max(0, clip.fadeOutSec!))
    : 0
  let f = 1
  if (fadeIn > 0 && local < fadeIn) f *= local / fadeIn
  const fadeStart = clip.durationSec - fadeOut
  if (fadeOut > 0 && local > fadeStart) {
    f *= Math.max(0, (clip.durationSec - local) / fadeOut)
  }
  return Math.max(0, Math.min(1, f))
}

/** ── 声音预览混音链路（与导出 ffmpeg 混音器一致：片段音量×轨道增益 → 主增益 → EQ → 可选压缩） ── */
let previewAudioCtx: AudioContext | null = null
let previewMasterBus: GainNode | null = null
let previewBassFilter: BiquadFilterNode | null = null
let previewTrebleFilter: BiquadFilterNode | null = null
let previewCompressor: DynamicsCompressorNode | null = null
/** audio 元素 → media source 节点（每个元素仅能创建一次） */
const previewMediaSources = new Map<HTMLAudioElement, MediaElementAudioSourceNode>()
/** 片段 id → 轨道增益节点 */
const previewClipGains = new Map<string, GainNode>()

function getPreviewAudioCtx(): AudioContext | null {
  if (previewAudioCtx) return previewAudioCtx
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return null
    const ctx = new Ctor()
    const master = ctx.createGain()
    master.gain.value = clampTrackGain(mixMasterGain.value)
    const bass = ctx.createBiquadFilter()
    bass.type = 'peaking'
    bass.frequency.value = 120
    bass.Q.value = 1
    bass.gain.value = clampMixEqGainDb(mixBassGainDb.value)
    const treble = ctx.createBiquadFilter()
    treble.type = 'peaking'
    treble.frequency.value = 8000
    treble.Q.value = 1
    treble.gain.value = clampMixEqGainDb(mixTrebleGainDb.value)
    const comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -14 // 0.2 线性 ≈ -14 dB
    comp.knee.value = 0
    comp.ratio.value = 2
    comp.attack.value = 0.02
    comp.release.value = 0.25
    previewAudioCtx = ctx
    previewMasterBus = master
    previewBassFilter = bass
    previewTrebleFilter = treble
    previewCompressor = comp
    master.connect(bass)
    bass.connect(treble)
    treble.connect(ctx.destination)
    updatePreviewCompressorRouting()
    return ctx
  } catch {
    return null
  }
}

/**
 * 创建并解锁 AudioContext。必须在用户手势的同步上下文中调用：
 * 一旦 await（例如解析素材 URL 的 IPC）就会丢失手势，此时新建的 AudioContext 会停在
 * suspended，而被它接管的音频（MediaElementSource）会完全无声。
 */
function unlockPreviewAudio(): void {
  const ctx = getPreviewAudioCtx()
  if (ctx && ctx.state === 'suspended') {
    void ctx.resume().catch(() => undefined)
  }
}

function updatePreviewCompressorRouting(): void {
  const ctx = previewAudioCtx
  if (!ctx || !previewTrebleFilter || !previewCompressor) return
  try {
    previewTrebleFilter.disconnect()
    previewCompressor.disconnect()
    if (mixCompression.value) {
      previewTrebleFilter.connect(previewCompressor)
      previewCompressor.connect(ctx.destination)
    } else {
      previewTrebleFilter.connect(ctx.destination)
    }
  } catch {
    /* ignore */
  }
}

/**
 * 创建音频元素：默认匿名跨源加载。
 * 不设 crossOrigin 的话素材会被判定为跨域污染，MediaElementSource 接管后会强制静音；
 * 万一 CORS 加载失败，则自动降级为普通加载并放弃接管，保证至少还有声音。
 */
function createPreviewAudioEl(): HTMLAudioElement {
  const el = new Audio()
  el.preload = 'auto'
  el.addEventListener(
    'error',
    () => {
      if (audioCorsFallback.has(el) || !el.crossOrigin) return
      audioCorsFallback.add(el)
      const src = el.src
      el.removeAttribute('crossorigin')
      el.src = src
      el.load()
    },
    { once: true }
  )
  el.crossOrigin = 'anonymous'
  return el
}

/** 将片段 audio 元素接入共享预览混音链路，返回其增益节点（失败回退 null） */
function ensurePreviewClipGain(clip: ScriptTimelineClip, el: HTMLAudioElement): GainNode | null {
  const ctx = getPreviewAudioCtx()
  if (!ctx || !previewMasterBus) return null
  let node = previewClipGains.get(clip.id)
  if (node) return node
  // 上下文还没跑起来时不要接管元素音频：MediaElementSource 一旦创建就不可撤销，
  // 而 suspended 的上下文会让元素彻底静音。此时回退到元素自身音量，保证有声。
  if (ctx.state !== 'running') return null
  // CORS 加载失败降级过的元素不再接管，保持元素音量回退
  if (audioCorsFallback.has(el)) return null
  let source = previewMediaSources.get(el)
  if (!source) {
    try {
      source = ctx.createMediaElementSource(el)
    } catch {
      return null
    }
    previewMediaSources.set(el, source)
  }
  node = ctx.createGain()
  node.gain.value = 1
  source.connect(node)
  node.connect(previewMasterBus)
  previewClipGains.set(clip.id, node)
  return node
}

function isVoiceTrackActiveAt(timeSec: number): boolean {
  if (mutedTracks.value.has('voice')) return false
  return visibleClipsOn('voice').some(
    (c) => timeSec >= c.startSec && timeSec < c.startSec + c.durationSec
  )
}

/** 同步片段音量：clip.volume × 轨道增益 × 淡入淡出 × 自动闪避（与导出对齐；走 Web Audio 时元素自身音量恒 1） */
function syncClipPreviewGain(clip: ScriptTimelineClip, el: HTMLAudioElement, local: number): void {
  const duckFactor =
    clip.track === 'music' && mixAutoDucking.value && isVoiceTrackActiveAt(playheadSec.value)
      ? clampMixDuckingRatio(mixDuckingRatio.value)
      : 1
  // 轨道静音优先级最高：直接压到 0，忽略片段音量与混音器增益
  const target = mutedTracks.value.has(clip.track)
    ? 0
    : Math.min(
        2,
        (Number.isFinite(clip.volume) ? Math.min(2, Math.max(0, clip.volume!)) : 1) *
          clampTrackGain(mixGains.value[clip.track]) *
          fadeFactorAt(clip, local) *
          duckFactor
      )
  const node = ensurePreviewClipGain(clip, el)
  if (node && previewAudioCtx) {
    node.gain.setTargetAtTime(target, previewAudioCtx.currentTime, 0.02)
    el.volume = 1
  } else {
    // Web Audio 不可用时退化为元素音量（仅 0~1）
    el.volume = clamp01(target)
  }
}

/** 同步主增益 / EQ / 压缩到当前混音器设置（播放 tick 中调用，开销极小） */
function syncPreviewMixerSettings(): void {
  const ctx = previewAudioCtx
  if (!ctx) return
  // 兜底：上下文若仍处于 suspended（被自动播放策略拦截），持续尝试恢复
  if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined)
  const t = ctx.currentTime
  if (previewMasterBus) {
    previewMasterBus.gain.setTargetAtTime(clampTrackGain(mixMasterGain.value), t, 0.02)
  }
  if (previewBassFilter) {
    previewBassFilter.gain.setTargetAtTime(clampMixEqGainDb(mixBassGainDb.value), t, 0.02)
  }
  if (previewTrebleFilter) {
    previewTrebleFilter.gain.setTargetAtTime(clampMixEqGainDb(mixTrebleGainDb.value), t, 0.02)
  }
  updatePreviewCompressorRouting()
}

function disposePreviewAudioGraph(): void {
  for (const node of previewClipGains.values()) {
    try {
      node.disconnect()
    } catch {
      /* ignore */
    }
  }
  previewClipGains.clear()
  previewMediaSources.clear()
  try {
    previewMasterBus?.disconnect()
    previewBassFilter?.disconnect()
    previewTrebleFilter?.disconnect()
    previewCompressor?.disconnect()
    void previewAudioCtx?.close().catch(() => undefined)
  } catch {
    /* ignore */
  }
  previewAudioCtx = null
  previewMasterBus = null
  previewBassFilter = null
  previewTrebleFilter = null
  previewCompressor = null
}

async function syncAudioToPlayhead(playingNow: boolean): Promise<void> {
  syncPreviewMixerSettings()
  const audioClips = clips.value.filter(
    (c) =>
      c.track === 'voice' ||
      c.track === 'music' ||
      c.track === 'sfx' ||
      (c.track === 'overlay' && !isImageOrGifClip(c))
  )
  const alive = new Set(audioClips.map((c) => c.id))
  for (const id of [...audioEls.keys()]) {
    if (alive.has(id)) continue
    const dead = audioEls.get(id)
    if (dead) {
      try {
        dead.pause()
        dead.removeAttribute('src')
        dead.load()
      } catch {
        /* ignore */
      }
    }
    audioEls.delete(id)
    const deadGain = previewClipGains.get(id)
    if (deadGain) {
      try {
        deadGain.disconnect()
      } catch {
        /* ignore */
      }
      previewClipGains.delete(id)
    }
    if (dead) previewMediaSources.delete(dead)
  }

  for (const clip of audioClips) {
    let el = audioEls.get(clip.id)
    if (!el) {
      el = createPreviewAudioEl()
      audioEls.set(clip.id, el)
      el.src = await resolveSrc(clip)
    }
    const local = playheadSec.value - clip.startSec
    const inRange = local >= -0.05 && local < clip.durationSec
    const clipSpeed = clampClipSpeed(clip.speed)
    el.playbackRate = Math.min(16, Math.max(0.1, playbackRate.value * clipSpeed))
    syncClipPreviewGain(clip, el, Math.max(0, local))
    if (!inRange) {
      if (!el.paused) el.pause()
      continue
    }
    const targetMedia = mediaTimeForClip(clip, Math.max(0, local))
    try {
      if (Math.abs(el.currentTime - targetMedia) > 0.35) {
        el.currentTime = targetMedia
      }
    } catch {
      /* ignore */
    }
    if (playingNow) {
      if (el.paused) void el.play().catch(() => undefined)
    } else if (!el.paused) {
      el.pause()
    }
  }
}

async function syncPreviewToPlayhead(): Promise<void> {
  const transition = activeMainTransition.value
  const clip = transition ? transition.from : clipAtPlayhead()
  if (!clip) {
    previewLoadedClipId.value = null
    previewSrc.value = ''
    await syncOverlayVideosToPlayhead(playing.value)
    return
  }
  previewLoadedClipId.value = clip.id
  if (!transition) {
    activeClipId.value = clip.id
  }
  const url = await resolveSrc(clip)
  if (previewSrc.value !== url) previewSrc.value = url
  await Promise.resolve()
  const el = previewEl.value
  if (el) {
    applyPlaybackRate()
    const local = Math.max(0, playheadSec.value - clip.startSec)
    const media = mediaTimeForClip(clip, local)
    try {
      if (Math.abs(el.currentTime - media) > 0.2) el.currentTime = media
    } catch {
      /* ignore */
    }
  }
  await syncOverlayVideosToPlayhead(false)
}

async function syncOverlayVideosToPlayhead(playingNow: boolean): Promise<void> {
  await nextTick()
  for (const clip of visibleClipsOn('overlay')) {
    if (isImageOrGifClip(clip)) {
      if (!clip.stickerId?.trim() && !overlayImageUrls.value[clip.id]) {
        const url = await resolveSrc(clip)
        if (url) {
          overlayImageUrls.value = { ...overlayImageUrls.value, [clip.id]: url }
        }
      }
      continue
    }
    const el = overlayEls.get(clip.id)
    if (!el) continue
    const local = playheadSec.value - clip.startSec
    const inRange = local >= -0.05 && local < clip.durationSec
    el.playbackRate = Math.min(16, Math.max(0.1, playbackRate.value * clampClipSpeed(clip.speed)))
    if (!inRange) {
      if (!el.paused) el.pause()
      continue
    }
    if (!el.getAttribute('src')) {
      el.src = await resolveSrc(clip)
    }
    const media = mediaTimeForClip(clip, Math.max(0, local))
    try {
      if (Math.abs(el.currentTime - media) > 0.25) {
        el.currentTime = media
      }
    } catch {
      /* ignore */
    }
    if (playingNow) {
      if (el.paused) void el.play().catch(() => undefined)
    } else if (!el.paused) {
      el.pause()
    }
  }

  const transition = activeMainTransition.value
  if (transition) {
    const el = transitionVideoEls.get(transition.to.id)
    if (el) {
      const local = playheadSec.value - transition.to.startSec
      const prevUrl = el.dataset.transitionSrc
      const targetUrl =
        clipResolvedUrls.value[transition.to.id] ||
        prevUrl ||
        (await resolveSrc(transition.to)) ||
        ''
      const media = mediaTimeForClip(transition.to, Math.max(0, local))
      const inRange = local >= -0.05 && local < transition.to.durationSec
      el.playbackRate = Math.min(
        16,
        Math.max(0.1, playbackRate.value * clampClipSpeed(transition.to.speed))
      )
      if (!inRange) {
        if (!el.paused) el.pause()
      } else {
        const changedSrc = el.dataset.transitionSrc !== targetUrl
        if (changedSrc && targetUrl) {
          el.dataset.transitionSrc = targetUrl
          el.src = targetUrl
          // 新源首次加载后把帧校准到当前窗口位置（暂停在窗口中间时不能只显示首帧）
          el.dataset.pendingSeek = String(media)
          el.addEventListener(
            'loadedmetadata',
            () => {
              const pending = Number(el.dataset.pendingSeek)
              el.dataset.pendingSeek = ''
              if (!Number.isFinite(pending)) return
              try {
                if (Math.abs(el.currentTime - pending) > 0.15) {
                  el.currentTime = Math.max(0, Math.min(pending, Math.max(0, el.duration - 0.001)))
                }
              } catch {
                /* ignore */
              }
            },
            { once: true }
          )
        }
        try {
          if (Math.abs(el.currentTime - media) > 0.2) {
            el.currentTime = media
          }
        } catch {
          /* ignore */
        }
        if (playingNow) {
          if (el.paused) void el.play().catch(() => undefined)
        } else if (!el.paused) {
          el.pause()
        }
      }
    }
  } else {
    for (const el of transitionVideoEls.values()) {
      if (!el.paused) el.pause()
    }
  }
}

// ── ffmpeg 转场微渲染：预览 = 导出（主进程复用与 timelineExportService 同源 xfade 几何） ──
function transitionPreviewKeyFor(transition: {
  from: ScriptTimelineClip
  to: ScriptTimelineClip
}): string {
  const { from, to } = transition
  return [
    from.id,
    resolveClipRelativePath(from) ?? '',
    from.sourceOffsetSec ?? 0,
    from.startSec,
    from.durationSec,
    from.cropX ?? 0,
    from.cropY ?? 0,
    from.cropWidth ?? 1,
    from.cropHeight ?? 1,
    buildClipVisualFfmpegFilter(from) ?? '',
    to.id,
    resolveClipRelativePath(to) ?? '',
    to.sourceOffsetSec ?? 0,
    to.startSec,
    to.durationSec,
    to.cropX ?? 0,
    to.cropY ?? 0,
    to.cropWidth ?? 1,
    to.cropHeight ?? 1,
    buildClipVisualFfmpegFilter(to) ?? '',
    to.transitionType ?? 'none',
    to.transitionInSec ?? 0,
    exportWidth.value,
    exportHeight.value,
    exportFps.value
  ].join('|')
}

/** 输出分辨率：保持导出画幅，单边封顶 1280，节省预览渲染/解码开销 */
function transitionPreviewDims(): { width: number; height: number } {
  const w = Math.max(2, Math.round(exportWidth.value || 1280))
  const h = Math.max(2, Math.round(exportHeight.value || 720))
  const s = Math.min(1, 1280 / Math.max(w, h))
  return {
    width: Math.max(2, Math.round((w * s) / 2) * 2),
    height: Math.max(2, Math.round((h * s) / 2) * 2)
  }
}

function toTransitionPreviewClip(clip: ScriptTimelineClip): TimelineExportClip {
  const offset = sourceOffsetOf(clip)
  return {
    track: clip.track,
    relativePath: resolveClipRelativePath(clip),
    title: clip.title,
    text: clip.text,
    startSec: clip.startSec,
    durationSec: clip.durationSec,
    ...(offset > 0 ? { sourceOffsetSec: offset } : {}),
    brightness: clip.brightness,
    contrast: clip.contrast,
    saturation: clip.saturation,
    vibrance: clip.vibrance,
    temperature: clip.temperature,
    tint: clip.tint,
    highlights: clip.highlights,
    shadows: clip.shadows,
    sharpen: clip.sharpen,
    vignette: clip.vignette,
    fade: clip.fade,
    grain: clip.grain,
    filterPreset: clip.filterPreset,
    filterIntensity: clip.filterIntensity,
    visualEffect: clip.visualEffect,
    effectIntensity: clip.effectIntensity,
    cropX: clip.cropX,
    cropY: clip.cropY,
    cropWidth: clip.cropWidth,
    cropHeight: clip.cropHeight,
    transitionInSec: clip.transitionInSec,
    transitionOutSec: clip.transitionOutSec,
    transitionType: clip.transitionType
  }
}

/** 请求微渲染；幂等（已就绪直接返回、in-flight 复用、失败不再重试同一签名） */
async function ensureTransitionPreview(transition: {
  from: ScriptTimelineClip
  to: ScriptTimelineClip
}): Promise<TransitionPreviewEntry | null> {
  const key = transitionPreviewKeyFor(transition)
  const cached = transitionPreviewCache.get(key)
  if (cached) return cached
  if (transitionPreviewFailed.has(key)) return null
  let promise = transitionPreviewInflight.get(key)
  if (!promise) {
    promise = (async (): Promise<boolean> => {
      try {
        const dims = transitionPreviewDims()
        const result = await window.studio.renderTimelineTransitionPreview({
          left: toTransitionPreviewClip(transition.from),
          right: toTransitionPreviewClip(transition.to),
          width: dims.width,
          height: dims.height,
          fps: exportFps.value
        })
        if (result.ok) {
          transitionPreviewCache.set(key, {
            key,
            url: result.url,
            durationSec: result.durationSec
          })
          // 防止缓存无限增长：淘汰最旧签名
          while (transitionPreviewCache.size > 40) {
            const firstKey = transitionPreviewCache.keys().next().value
            if (firstKey === undefined) break
            transitionPreviewCache.delete(firstKey)
          }
        } else {
          transitionPreviewFailed.add(key)
        }
      } catch {
        transitionPreviewFailed.add(key)
      } finally {
        transitionPreviewTick.value += 1
      }
      return transitionPreviewCache.has(key)
    })()
    transitionPreviewInflight.set(key, promise)
    void promise.finally(() => transitionPreviewInflight.delete(key))
  }
  await promise
  return transitionPreviewCache.get(key) ?? null
}

/** 预取：当前窗口 + playhead 前方 1s 内即将进入的转场窗口 */
function scheduleTransitionPreview(): void {
  const current = activeMainTransition.value
  if (current) void ensureTransitionPreview(current)
  const p = playheadSec.value
  const list = visibleClipsOn('video')
  for (let i = 0; i < list.length - 1; i++) {
    const from = list[i]!
    const to = list[i + 1]!
    if (!(to.transitionInSec && to.transitionInSec > 0)) continue
    const fromEnd = from.startSec + from.durationSec
    if (to.startSec >= fromEnd) continue
    if (current && current.from.id === from.id) break
    if (to.startSec >= p - 0.02 && to.startSec <= p + 1) {
      void ensureTransitionPreview({ from, to })
    }
  }
}

// playhead 变化（播放/拖动）时顺带预取即将到来的转场微渲染
watch(
  playheadSec,
  () => {
    scheduleTransitionPreview()
  },
  { flush: 'post' }
)

// 渲染就绪/失败：暂停态下重同步一次，把 overlay 换成 ffmpeg 渲染片段
watch(transitionPreviewTick, () => {
  if (!playing.value) void syncOverlayVideosToPlayhead(false)
})

function stopPlayback(): void {
  playing.value = false
  playMode.value = null
  playSeq += 1
  clipSwitchPending = false
  previewEl.value?.pause()
  stopAllAudio()
  pauseOverlayVideos()
}

/** 时间线工具栏：整轨联播（视频序列 + 声音轨） */
async function toggleTimelinePlay(): Promise<void> {
  cancelTransitionSweep()
  if (playing.value && playMode.value === 'timeline') {
    stopPlayback()
    return
  }
  stopPlayback()
  // 若当前播放头正停在某个转场窗口内部（如刚预览完转场定格在 75% 处），
  // 点击“播放”时自动回退到转场前 0.6s 助跑，让用户能完整看到 A → 转场 → B 的连贯播放效果
  const activeTr = activeMainTransition.value
  if (activeTr) {
    playheadSec.value = Math.max(activeTr.from.startSec, activeTr.to.startSec - 0.6)
  } else if (playheadSec.value >= totalDuration.value - 0.08) {
    playheadSec.value = 0
  }
  // 在手势同步上下文中解锁音频上下文，之后的 await 会丢失手势
  unlockPreviewAudio()
  playMode.value = 'timeline'
  playing.value = true
  const seq = ++playSeq
  await syncAudioToPlayhead(true)
  await runSequence(seq)
}

/** 预览区：只播放当前选中的视频/声音片段 */
async function togglePreviewPlay(): Promise<void> {
  if (playing.value && playMode.value === 'solo') {
    stopPlayback()
    return
  }
  const clip = selectedPlayableClip.value
  if (!clip) return
  stopPlayback()
  // 在手势同步上下文中解锁音频上下文，之后的 await 会丢失手势
  unlockPreviewAudio()
  playMode.value = 'solo'
  playing.value = true
  const seq = ++playSeq
  await runSoloClip(clip, seq)
}

async function runSoloClip(clip: ScriptTimelineClip, seq: number): Promise<void> {
  do {
    if (seq !== playSeq || !playing.value || playMode.value !== 'solo') return
    activeClipId.value = clip.id
    playheadSec.value = clip.startSec
    stopAllAudio()

    if (clip.track === 'video' || clip.track === 'overlay') {
      const nextUrl = await resolveSrc(clip)
      previewSrc.value = nextUrl
      await Promise.resolve()
      if (isImageOrGifClip(clip) || isImageOrGifUrl(nextUrl)) {
        await waitUntilStillClipEnd(clip, 0, seq, { syncAudio: false })
      } else {
        const el = previewEl.value
        if (!el) break
        try {
          applyPlaybackRate()
          applyPreviewMuted(clip.track)
          el.currentTime = mediaTimeForClip(clip, 0)
          await el.play()
        } catch {
          break
        }
        await waitUntilClipEnd(el, clip, seq, { syncAudio: false })
      }
    } else {
      // 声音：用独立 audio，不带动其他轨
      previewSrc.value = ''
      syncPreviewMixerSettings()
      let el = audioEls.get(clip.id)
      if (!el) {
        el = createPreviewAudioEl()
        audioEls.set(clip.id, el)
      }
      el.src = await resolveSrc(clip)
      const clipSpeed = clampClipSpeed(clip.speed)
      el.playbackRate = Math.min(16, Math.max(0.1, playbackRate.value * clipSpeed))
      syncClipPreviewGain(clip, el, 0)
      try {
        el.currentTime = mediaTimeForClip(clip, 0)
        await el.play()
      } catch {
        break
      }
      await waitUntilAudioClipEnd(el, clip, seq)
    }

    if (!loopPlayback.value || seq !== playSeq || !playing.value || playMode.value !== 'solo') break
  } while (loopPlayback.value)

  if (seq === playSeq) {
    playing.value = false
    playMode.value = null
    stopAllAudio()
    previewEl.value?.pause()
    pauseOverlayVideos()
  }
}

function waitUntilAudioClipEnd(
  el: HTMLAudioElement,
  clip: ScriptTimelineClip,
  seq: number
): Promise<void> {
  return new Promise((resolve) => {
    const tick = () => {
      if (seq !== playSeq || !playing.value || playMode.value !== 'solo') {
        cleanup()
        resolve()
        return
      }
      const local = localTimeForClip(clip, el.currentTime || 0)
      if (!playheadDrag.value) {
        playheadSec.value = clip.startSec + local
      }
      syncClipPreviewGain(clip, el, local)
      if (el.ended || local >= clip.durationSec - 0.05) {
        cleanup()
        resolve()
      }
    }
    const cleanup = () => {
      el.removeEventListener('timeupdate', tick)
      el.removeEventListener('ended', tick)
    }
    el.addEventListener('timeupdate', tick)
    el.addEventListener('ended', tick)
  })
}

async function runSequence(seq: number): Promise<void> {
  const list = visibleClipsOn('video')
  if (!list.length) {
    // 仅音频/字幕时按时间轴空播
    const end = totalDuration.value
    const started = performance.now()
    const origin = playheadSec.value
    while (seq === playSeq && playing.value) {
      const elapsed = ((performance.now() - started) / 1000) * playbackRate.value
      playheadSec.value = origin + elapsed
      await syncAudioToPlayhead(true)
      await syncOverlayVideosToPlayhead(true)
      if (playheadSec.value >= end) {
        if (loopPlayback.value) {
          playheadSec.value = 0
          return runSequence(seq)
        }
        break
      }
      await new Promise((r) => window.setTimeout(r, 40))
    }
    playing.value = false
    playMode.value = null
    stopAllAudio()
    pauseOverlayVideos()
    return
  }

  const playFrom = async (startIndex: number, localOffset: number): Promise<void> => {
    for (let i = startIndex; i < list.length; i++) {
      if (seq !== playSeq || !playing.value) return
      // 进入切换窗口：旧元素仍在播放、随后要经历 resolveSrc/预加载等 await，
      // 期间屏蔽 timeupdate（旧元素时间不能用新片段时间轴推进），并立刻停住旧元素
      clipSwitchPending = true
      if (i > startIndex) {
        const oldEl = previewEl.value
        if (oldEl && !oldEl.paused) oldEl.pause()
      }
      const clip = list[i]!
      activeClipId.value = clip.id
      let startLocal = localOffset
      if (i > startIndex) {
        const previous = list[i - 1]!
        const previousEnd = previous.startSec + previous.durationSec
        startLocal = Math.min(clip.durationSec, Math.max(0, previousEnd - clip.startSec))
      }
      const startAt =
        i > startIndex
          ? Math.max(clip.startSec, list[i - 1]!.startSec + list[i - 1]!.durationSec)
          : clip.startSec + startLocal
      playheadSec.value = startAt
      if (i > startIndex) {
        // 切换一旦开始，播放头已定位于旧片段末尾：把转场 overlay 立即校准到
        // 窗口末帧（100% 新片段），避免换源期间它停在“快结束但没结束”的中间帧，
        // 残留旧片段画面形成闪帧。
        void syncOverlayVideosToPlayhead(true)
      }
      const nextUrl = await resolveSrc(clip)
      if (!nextUrl) {
        clipSwitchPending = false
        continue
      }
      if (isImageOrGifClip(clip) || isImageOrGifUrl(nextUrl)) {
        previewSrc.value = nextUrl
        await nextTick()
        clipSwitchPending = false
        await waitUntilStillClipEnd(clip, startLocal, seq, { syncAudio: true })
        continue
      }
      if (i > startIndex) {
        const preloader = document.createElement('video')
        preloader.preload = 'auto'
        preloader.muted = true
        preloader.src = nextUrl
        await new Promise<void>((resolve) => {
          let done = false
          const finish = () => {
            if (done) return
            done = true
            preloader.removeEventListener('loadedmetadata', finish)
            preloader.removeEventListener('error', finish)
            resolve()
          }
          preloader.addEventListener('loadedmetadata', finish)
          preloader.addEventListener('error', finish)
          window.setTimeout(finish, 800)
        })
        try {
          preloader.currentTime = mediaTimeForClip(clip, startLocal)
        } catch {
          /* ignore */
        }
      }
      const switchedSource = nextUrl !== previewSrc.value
      previewSrc.value = nextUrl
      await nextTick()
      const el = previewEl.value
      if (!el) continue
      // 换源瞬间旧帧已被释放；若新源在解码完成前就 play()，会先呈现 B 首帧再跳
      // 到入点，表现成“切第二个片段闪一下”。改为：暂停住 → 等元数据 → 精确
      // seek 到入点 → 再播放。解码间隙由仍在显示的 overlay 转场画面遮挡，
      // overlay 撤掉时主画面已就位在正确帧上，切换不闪。
      const media = mediaTimeForClip(clip, startLocal)
      try {
        el.pause()
        applyPlaybackRate()
        if (switchedSource) {
          // 真实换源时显式重启加载：确保 loadedmetadata 一定来自新源，
          // 避免误读旧源残留的 readyState（否则可能在 B 尚未就绪时就继续）
          el.load()
        }
        await waitForVideoLoad(el)
        if (el.readyState >= 1 && Math.abs(el.currentTime - media) > 0.1) {
          await seekVideoTo(el, media)
        }
        await el.play()
      } catch {
        clipSwitchPending = false
        continue
      }
      // 新片段已开始播放（元素时间轴已属于该片段），恢复 timeupdate 驱动
      clipSwitchPending = false
      await waitUntilClipEnd(el, clip, seq)
    }
  }

  let index = list.findIndex(
    (c) => playheadSec.value >= c.startSec && playheadSec.value < c.startSec + c.durationSec
  )
  let localOffset = 0
  if (index >= 0) {
    localOffset = Math.max(0, playheadSec.value - list[index]!.startSec)
  } else {
    index = list.findIndex((c) => c.startSec >= playheadSec.value)
    if (index < 0) index = 0
  }

  do {
    if (seq !== playSeq || !playing.value) return
    await playFrom(index, localOffset)
    if (!loopPlayback.value || seq !== playSeq || !playing.value) break
    index = 0
    localOffset = 0
    playheadSec.value = 0
  } while (loopPlayback.value)

  if (seq === playSeq) {
    playing.value = false
    playMode.value = null
    stopAllAudio()
    pauseOverlayVideos()
  }
}

function waitUntilStillClipEnd(
  clip: ScriptTimelineClip,
  startLocal: number,
  seq: number,
  options?: { syncAudio?: boolean }
): Promise<void> {
  const syncAudio = options?.syncAudio !== false
  const startedAt = performance.now()
  return new Promise((resolve) => {
    let raf = 0
    const tick = () => {
      if (seq !== playSeq || !playing.value) {
        cleanup()
        resolve()
        return
      }
      const elapsed = ((performance.now() - startedAt) / 1000) * playbackRate.value
      const local = Math.min(clip.durationSec, startLocal + elapsed)
      if (!playheadDrag.value) {
        playheadSec.value = clip.startSec + local
      }
      if (syncAudio) void syncAudioToPlayhead(true)
      if (syncAudio) void syncOverlayVideosToPlayhead(true)
      if (local >= clip.durationSec - 0.02) {
        playheadSec.value = clip.startSec + clip.durationSec
        cleanup()
        resolve()
        return
      }
      raf = requestAnimationFrame(tick)
    }
    const cleanup = () => {
      if (raf) cancelAnimationFrame(raf)
      raf = 0
    }
    raf = requestAnimationFrame(tick)
  })
}

function waitUntilClipEnd(
  el: HTMLVideoElement,
  clip: ScriptTimelineClip,
  seq: number,
  options?: { syncAudio?: boolean }
): Promise<void> {
  const syncAudio = options?.syncAudio !== false
  const freezeTail = clampClipFreezeTailSec(clip.freezeTailSec)
  const activePlayDur = Math.max(0.05, clip.durationSec - freezeTail)
  let freezeStartedAt = 0
  let freezeBaseLocal = activePlayDur
  return new Promise((resolve) => {
    let raf = 0
    const tick = () => {
      if (seq !== playSeq || !playing.value) {
        cleanup()
        resolve()
        return
      }
      let local = localTimeForClip(clip, el.currentTime || 0)
      if (freezeStartedAt > 0) {
        const freezeElapsed = ((performance.now() - freezeStartedAt) / 1000) * playbackRate.value
        local = Math.min(clip.durationSec, freezeBaseLocal + freezeElapsed)
      } else if (el.ended || local >= activePlayDur - 0.05) {
        if (freezeTail > 0) {
          freezeStartedAt = performance.now()
          freezeBaseLocal = Math.min(clip.durationSec, Math.max(activePlayDur, local))
          if (!el.paused) el.pause()
          local = freezeBaseLocal
        } else {
          playheadSec.value = clip.startSec + clip.durationSec
          cleanup()
          resolve()
          return
        }
      }
      playheadSec.value = clip.startSec + local
      syncMainVideoAudioGain(clip, local)
      if (syncAudio) void syncAudioToPlayhead(true)
      if (syncAudio) void syncOverlayVideosToPlayhead(true)
      if (local >= clip.durationSec - 0.02) {
        cleanup()
        resolve()
        return
      }
      raf = requestAnimationFrame(tick)
    }
    const cleanup = () => {
      if (raf) cancelAnimationFrame(raf)
      raf = 0
    }
    raf = requestAnimationFrame(tick)
  })
}

function onPreviewEnded(): void {
  /* sequence loop handles advance */
}

function onPreviewTimeUpdate(): void {
  if (!playing.value) return
  if (playheadDrag.value) return
  // 片段切换中：元素仍是旧片段源，此刻的 currentTime 属于旧片段，不能推进新片段播放头
  if (clipSwitchPending) return
  // solo 声音由 audio 回调推进
  if (
    playMode.value === 'solo' &&
    selectedPlayableClip.value?.track !== 'video' &&
    selectedPlayableClip.value?.track !== 'overlay'
  ) {
    return
  }
  const clip = clips.value.find((c) => c.id === activeClipId.value)
  const el = previewEl.value
  if (!clip || !el) return
  const local = localTimeForClip(clip, el.currentTime || 0)
  const ph = clip.startSec + local
  playheadSec.value = ph
  syncMainVideoAudioGain(clip, local)
  void syncOverlayVideosToPlayhead(true)
}

function updatePreviewFrameRect(): void {
  const stage = previewStageEl.value
  if (!stage) return
  const stageWidth = stage.clientWidth
  const stageHeight = stage.clientHeight
  const option = previewFrameRatioOptions.value.find(
    (item) => item.key === previewFrameRatioKey.value
  )
  const targetAspect =
    previewFrameRatioKey.value === 'video' &&
    previewVideoMeta.value.width &&
    previewVideoMeta.value.height
      ? previewVideoMeta.value.width / previewVideoMeta.value.height
      : previewFrameRatioKey.value === 'export'
        ? exportWidth.value / exportHeight.value
        : (option?.ratio ?? exportWidth.value / exportHeight.value)

  const videoAspect =
    previewVideoMeta.value.width && previewVideoMeta.value.height
      ? previewVideoMeta.value.width / previewVideoMeta.value.height
      : 0
  const matchesVideo = videoAspect > 0 && Math.abs(targetAspect - videoAspect) < 0.001

  if (
    (previewFrameRatioKey.value === 'video' || matchesVideo) &&
    previewVideoMeta.value.width &&
    previewVideoMeta.value.height
  ) {
    const scale = Math.min(
      stageWidth / previewVideoMeta.value.width,
      stageHeight / previewVideoMeta.value.height
    )
    const width = previewVideoMeta.value.width * scale
    const height = previewVideoMeta.value.height * scale
    previewFrameRect.value = {
      left: (stageWidth - width) / 2,
      top: (stageHeight - height) / 2,
      width,
      height
    }
    return
  }

  const maxWidth = Math.max(80, stageWidth)
  const maxHeight = Math.max(60, stageHeight)
  let width = maxWidth
  let height = width / targetAspect
  if (height > maxHeight) {
    height = maxHeight
    width = height * targetAspect
  }
  previewFrameRect.value = {
    left: (stageWidth - width) / 2,
    top: (stageHeight - height) / 2,
    width,
    height
  }
}

function onPreviewLoaded(): void {
  applyPlaybackRate()
  applyPreviewMuted()
  const video = previewEl.value
  previewVideoMeta.value = {
    width: video?.videoWidth ?? 0,
    height: video?.videoHeight ?? 0
  }
  updatePreviewFrameRect()
}

function onPreviewImageLoaded(e: Event): void {
  const img = e.target as HTMLImageElement | null
  previewVideoMeta.value = {
    width: img?.naturalWidth || img?.width || 0,
    height: img?.naturalHeight || img?.height || 0
  }
  updatePreviewFrameRect()
}

function resolveClipRelativePath(clip: ScriptTimelineClip): string | undefined {
  const rel = clip.relativePath?.trim()
  if (rel) return rel
  if (!clip.assetId) return undefined
  return project.assets.find((a) => a.id === clip.assetId)?.relativePath?.trim() || undefined
}

function openExportDialog(): void {
  if (exporting.value || !clips.value.length) return
  exportDialogOpen.value = true
}

function closeExportDialog(): void {
  exportDialogOpen.value = false
}

function confirmExportDialog(): void {
  closeExportDialog()
  lastExportError.value = ''
  scheduleSave()
  void exportTimeline()
}

async function exportTimeline(): Promise<void> {
  if (exporting.value || !clips.value.length) return
  stopPlayback()
  await persist()

  exporting.value = true
  exportProgress.value = 0
  const unsub = window.studio.onTimelineExportProgress(({ progress }) => {
    exportProgress.value = progress
  })
  try {
    const exportClips: TimelineExportClip[] = clips.value
      .filter((c) => !hiddenTracks.value.has(c.track))
      .map((c) => ({
        track: c.track,
        relativePath: resolveClipRelativePath(c),
        text: c.text,
        title: c.title,
        startSec: c.startSec,
        durationSec: c.durationSec,
        ...(sourceOffsetOf(c) > 0 ? { sourceOffsetSec: sourceOffsetOf(c) } : {}),
        speed: c.speed,
        freezeTailSec: c.freezeTailSec,
        brightness: c.brightness,
        contrast: c.contrast,
        saturation: c.saturation,
        vibrance: c.vibrance,
        temperature: c.temperature,
        tint: c.tint,
        highlights: c.highlights,
        shadows: c.shadows,
        sharpen: c.sharpen,
        vignette: c.vignette,
        fade: c.fade,
        grain: c.grain,
        filterPreset: c.filterPreset,
        filterIntensity: c.filterIntensity,
        visualEffect: c.visualEffect,
        effectIntensity: c.effectIntensity,
        textColor: c.textColor,
        fontSize: c.fontSize,
        volume: c.volume,
        fadeInSec: c.fadeInSec,
        fadeOutSec: c.fadeOutSec,
        overlayX: c.overlayX,
        overlayY: c.overlayY,
        overlayWidth: c.overlayWidth,
        overlayHeight: c.overlayHeight,
        overlayRotation: c.overlayRotation,
        cropX: c.cropX,
        cropY: c.cropY,
        cropWidth: c.cropWidth,
        cropHeight: c.cropHeight,
        opacity: c.opacity,
        tweenIn: c.tweenIn,
        tweenInDurationSec: c.tweenInDurationSec,
        tweenInEase: c.tweenInEase,
        tweenOut: c.tweenOut,
        tweenOutDurationSec: c.tweenOutDurationSec,
        tweenOutEase: c.tweenOutEase,
        tweenLoop: c.tweenLoop,
        tweenLoopSpeedHz: c.tweenLoopSpeedHz,
        tweenLoopIntensity: c.tweenLoopIntensity,
        keyframes: c.keyframes,
        cameraMotion: c.cameraMotion,
        stickerId: c.stickerId,
        stickerColor: c.stickerColor,
        transitionInSec: c.transitionInSec,
        transitionOutSec: c.transitionOutSec,
        transitionType: c.transitionType
      }))
    const defaultFileName = `cut-${Date.now()}.mp4`
    let result = await window.studio.exportScriptTimeline({
      clips: exportClips,
      durationSec: totalDuration.value,
      playbackRate: playbackRate.value,
      width: exportWidth.value,
      height: exportHeight.value,
      fps: exportFps.value,
      videoBitrateKbps: exportVideoBitrateKbps.value,
      scaleMode: scaleMode.value,
      subtitleFontSize: subtitleFontSize.value,
      subtitleYOffset: subtitleYOffset.value,
      subtitleColor: subtitleColor.value,
      subtitleBorderColor: subtitleBorderColor.value,
      subtitleBorderWidth: subtitleBorderWidth.value,
      subtitleBoxEnabled: subtitleBoxEnabled.value,
      subtitleBoxColor: subtitleBoxColor.value,
      subtitleBoxOpacity: subtitleBoxOpacity.value,
      subtitleMotion: subtitleMotion.value,
      mixGains: toRaw(mixGains.value),
      mixMasterGain: mixMasterGain.value,
      mixBassGainDb: mixBassGainDb.value,
      mixTrebleGainDb: mixTrebleGainDb.value,
      mixCompression: mixCompression.value,
      mixAutoDucking: mixAutoDucking.value,
      mixDuckingRatio: mixDuckingRatio.value,
      mixLoudnorm: mixLoudnorm.value,
      mutedTracks: [...mutedTracks.value],
      watermarkSrc: watermarkEnabled.value && watermarkSrc.value ? watermarkSrc.value : undefined,
      watermarkOpacity: watermarkOpacity.value,
      watermarkScale: watermarkScale.value,
      watermarkPosition: watermarkPosition.value,
      defaultFileName
    })

    const needFallback =
      !result.ok && !result.canceled && /ffmpeg|ENOENT|not found|无法启动/i.test(result.error) // cjk-ok 跨语言错误兜底匹配（须含中英特征词）

    if (needFallback) {
      exportProgress.value = 0.05
      const fb = await exportTimelineViaRecorder({
        clips: clips.value,
        durationSec: totalDuration.value,
        playbackRate: playbackRate.value,
        resolveSrc,
        defaultFileName: defaultFileName.replace(/\.mp4$/i, '.webm'),
        subtitleFontSize: subtitleFontSize.value,
        subtitleYOffset: subtitleYOffset.value,
        subtitleColor: subtitleColor.value,
        onProgress: (ratio) => {
          exportProgress.value = ratio
        }
      })
      if (fb.ok) {
        lastExportError.value = ''
        // 回退已成功但受限于缺 ffmpeg：给出前往「设置 → ffmpeg 工具」下载的引导
        const goSettings = await promptConfirm({
          title: t('script.timeline.export'),
          message: t('script.timeline.exportDoneFallback', { path: fb.filePath }),
          confirmLabel: t('settings.ffmpeg.goSettings'),
          cancelLabel: t('common.gotIt')
        })
        if (goSettings) await openSettingsPanel('ffmpeg')
        return
      }
      const prevError = result.ok ? 'export failed' : result.error
      const fbError = fb.ok ? 'fallback failed' : fb.error
      result = {
        ok: false,
        error: `${prevError}\n\n${t('script.timeline.recordFallbackFailed', { error: fbError })}`
      }
    }

    if (result.ok) {
      lastExportError.value = ''
      if (result.assetId) await project.refreshAssets()
      await promptAlert({
        title: t('script.timeline.export'),
        message: t('script.timeline.exportDone', { path: result.filePath })
      })
    } else if (!result.canceled) {
      lastExportError.value = result.error
      await promptAlert({
        title: t('script.timeline.export'),
        message: t('script.timeline.exportFailed', { error: result.error })
      })
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    lastExportError.value = message
    await promptAlert({
      title: t('script.timeline.export'),
      message: t('script.timeline.exportFailed', { error: message })
    })
  } finally {
    unsub()
    exporting.value = false
    exportProgress.value = 0
  }
}

function formatSrtTimestamp(sec: number): string {
  const total = Math.max(0, Math.round(sec * 1000))
  const ms = total % 1000
  const s = Math.floor(total / 1000) % 60
  const m = Math.floor(total / 60000) % 60
  const h = Math.floor(total / 3600000)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`
}

/**
 * 人声 / 伴奏分离：把选中片段（视频 / 配音 / 音乐 / 音效）的音源拆为对白与伴奏，
 * 产物落 `Cache/Separated/<stem>/`，对齐原位置分别上配音轨（voice）与音乐轨（music），
 * 之后可在混音器独立调节两轨比例后再混音导出。内置 ffmpeg 中置声道提取；
 * 配置 `AUDIO_SEPARATION_API_URL` 后走第三方 AI 分离。
 */
const separatingAudio = ref(false)
async function separateClipAudio(): Promise<void> {
  const clip = selectedPlayableClip.value
  const rel = clip ? sourceRelativePath(clip) : ''
  if (!clip || !rel) {
    await promptAlert({
      title: t('script.dialog.timeline'),
      message: t('script.timeline.separateAudioNoSource')
    })
    return
  }
  separatingAudio.value = true
  try {
    const result = await window.studio.separateAudio(rel)
    const base =
      clip.title?.trim() ||
      rel
        .split('/')
        .pop()
        ?.replace(/\.[^.]+$/, '') ||
      t('script.timeline.audio')
    const durationSec = clip.durationSec > 0 ? clip.durationSec : undefined
    const vocal: ScriptTimelineSource = {
      id: `vocal:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 7)}`,
      title: `${base} · ${t('script.timeline.separateVocal')}`,
      relativePath: result.vocalRelativePath,
      origin: 'imported'
    }
    const instrumental: ScriptTimelineSource = {
      id: `instrumental:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 7)}`,
      title: `${base} · ${t('script.timeline.separateInstrumental')}`,
      relativePath: result.instrumentalRelativePath,
      origin: 'imported'
    }
    upsertImportedSource(vocal, 'voice', durationSec)
    upsertImportedSource(instrumental, 'voice', durationSec)
    await addSourceToTrack(vocal, 'voice', clip.startSec)
    await addSourceToTrack(instrumental, 'music', clip.startSec)
    await promptAlert({
      title: t('script.timeline.separateAudioDoneTitle'),
      message:
        result.provider === 'third-party'
          ? t('script.timeline.separateAudioDone')
          : `${t('script.timeline.separateAudioDone')}\n${t('script.timeline.separateAudioCenterNote')}`
    })
  } catch (err) {
    await promptAlert({
      title: t('script.timeline.separateAudioFailTitle'),
      message: t('script.timeline.separateAudioFailed', {
        error: err instanceof Error ? err.message : String(err)
      })
    })
  } finally {
    separatingAudio.value = false
  }
}

/**
 * 配音转字幕：对配音轨每个带媒体的片段调用语音识别，把带时间戳的
 * 转写结果对齐生成字幕轨片段。重复执行时，与配音片段时间重叠的旧字幕会被替换。
 */
async function transcribeVoiceToSubtitles(): Promise<void> {
  const targets = visibleClipsOn('voice').filter((clip) => sourceRelativePath(clip))
  if (!targets.length) {
    await promptAlert({
      title: t('script.dialog.timeline'),
      message: t('script.timeline.subtitleFromVoiceNoVoice')
    })
    return
  }
  subtitling.value = true
  try {
    const added: ScriptTimelineClip[] = []
    const replacedIds = new Set<string>()
    const errors: string[] = []
    for (const voice of targets) {
      const rel = sourceRelativePath(voice)
      let result: import('@shared/modelProvider').TranscribeAudioResult
      try {
        result = await window.studio.transcribeAudio({ relativePath: rel })
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err))
        continue
      }
      const segments = result.segments?.length
        ? result.segments
        : result.text?.trim()
          ? [{ startSec: 0, endSec: voice.durationSec, text: result.text.trim() }]
          : []
      const subs = buildSubtitleClipsFromTranscription(voice, segments, () => newClipId())
      added.push(...subs)
      // 与本次配音区间重叠的旧字幕视为待替换（避免重复点按钮字幕堆积）
      const voiceStart = voice.startSec
      const voiceEnd = voiceStart + voice.durationSec
      for (const old of visibleClipsOn('subtitle')) {
        const oldStart = old.startSec
        const oldEnd = oldStart + old.durationSec
        if (oldStart < voiceEnd && oldEnd > voiceStart) replacedIds.add(old.id)
      }
    }

    if (added.length) {
      commitClips([...clips.value.filter((c) => !replacedIds.has(c.id)), ...added])
      activeClipId.value = added[0]!.id
      scheduleSave()
      await promptAlert({
        title: t('script.dialog.timeline'),
        message: errors.length
          ? t('script.timeline.subtitleFromVoicePartial', { count: added.length, error: errors[0] })
          : t('script.timeline.subtitleFromVoiceDone', { count: added.length })
      })
      return
    }

    await promptAlert({
      title: t('script.dialog.timeline'),
      message: errors.length
        ? t('script.timeline.subtitleFromVoiceFailed', { error: errors[0] })
        : t('script.timeline.subtitleFromVoiceEmpty')
    })
  } finally {
    subtitling.value = false
  }
}

async function exportSubtitles(): Promise<void> {
  const subs = visibleClipsOn('subtitle')
    .map((clip) => ({
      text: (clip.text || clip.title).trim(),
      startSec: clip.startSec,
      endSec: clip.startSec + clip.durationSec
    }))
    .filter((clip) => clip.text)
    .sort((a, b) => a.startSec - b.startSec)
  if (!subs.length) return
  const content = subs
    .map(
      (clip, index) =>
        `${index + 1}\n${formatSrtTimestamp(clip.startSec)} --> ${formatSrtTimestamp(clip.endSec)}\n${clip.text}`
    )
    .join('\n\n')
  try {
    const path = await window.studio.saveTextFile({
      content,
      defaultPath: `subtitles-${Date.now()}.srt`,
      filters: [{ name: 'SRT', extensions: ['srt'] }]
    })
    if (!path) return
    await promptAlert({
      title: t('script.dialog.timeline'),
      message: t('script.timeline.exportSrtDone', { path })
    })
  } catch (err) {
    await promptAlert({
      title: t('script.dialog.timeline'),
      message: t('script.timeline.exportSrtFailed', {
        error: err instanceof Error ? err.message : String(err)
      })
    })
  }
}

async function exportFcpxml(): Promise<void> {
  if (!clips.value.length) return
  try {
    const doc: ScriptTimelineDocument = {
      clips: clips.value
        .filter((c) => !hiddenTracks.value.has(c.track))
        .map((c) => ({ ...c, relativePath: resolveClipRelativePath(c) ?? c.relativePath })),
      hiddenTracks: [...hiddenTracks.value],
      mutedTracks: [...mutedTracks.value],
      settings: {
        durationSec: totalDuration.value,
        exportWidth: exportWidth.value,
        exportHeight: exportHeight.value,
        exportFps: exportFps.value,
        subtitleFontSize: subtitleFontSize.value,
        subtitleColor: subtitleColor.value
      }
    }
    const xml = buildFcpxmlDocument(doc, {
      projectName: `Timeline-${Date.now()}`,
      width: exportWidth.value,
      height: exportHeight.value,
      fps: exportFps.value
    })
    const path = await window.studio.saveTextFile({
      content: xml,
      defaultPath: `timeline-${Date.now()}.fcpxml`,
      filters: [{ name: 'FCPXML 1.9', extensions: ['fcpxml', 'xml'] }]
    })
    if (!path) return
    await promptAlert({
      title: t('script.timeline.exportFcpxml'),
      message: t('script.timeline.exportNleDone', { path })
    })
  } catch (err) {
    await promptAlert({
      title: t('script.timeline.exportFcpxml'),
      message: t('script.timeline.exportNleFailed', {
        error: err instanceof Error ? err.message : String(err)
      })
    })
  }
}

async function exportCapCutDraft(): Promise<void> {
  if (!clips.value.length) return
  try {
    const doc: ScriptTimelineDocument = {
      clips: clips.value
        .filter((c) => !hiddenTracks.value.has(c.track))
        .map((c) => ({ ...c, relativePath: resolveClipRelativePath(c) ?? c.relativePath })),
      hiddenTracks: [...hiddenTracks.value],
      mutedTracks: [...mutedTracks.value],
      settings: {
        durationSec: totalDuration.value,
        exportWidth: exportWidth.value,
        exportHeight: exportHeight.value,
        exportFps: exportFps.value,
        subtitleFontSize: subtitleFontSize.value,
        subtitleColor: subtitleColor.value
      }
    }
    const projectName = `Timeline-${Date.now()}`
    const nleOpts = {
      projectName,
      width: exportWidth.value,
      height: exportHeight.value,
      fps: exportFps.value
    }
    const json = buildCapCutDraftContent(doc, nleOpts)
    const metaJson = buildCapCutDraftMetaInfo(doc, nleOpts)
    if (typeof window.studio.saveBinaryFilesToDirectory === 'function') {
      const encoder = new TextEncoder()
      const savedDir = await window.studio.saveBinaryFilesToDirectory({
        files: [
          { fileName: 'draft_content.json', data: encoder.encode(json) },
          { fileName: 'draft_meta_info.json', data: encoder.encode(metaJson) }
        ]
      })
      if (!savedDir?.directory) return
      await promptAlert({
        title: t('script.timeline.exportCapCut'),
        message: t('script.timeline.exportNleDone', { path: savedDir.directory })
      })
      return
    }
    const path = await window.studio.saveTextFile({
      content: json,
      defaultPath: 'draft_content.json',
      filters: [{ name: 'CapCut / JianyingPro Draft', extensions: ['json'] }]
    })
    if (!path) return
    await promptAlert({
      title: t('script.timeline.exportCapCut'),
      message: t('script.timeline.exportNleDone', { path })
    })
  } catch (err) {
    await promptAlert({
      title: t('script.timeline.exportCapCut'),
      message: t('script.timeline.exportNleFailed', {
        error: err instanceof Error ? err.message : String(err)
      })
    })
  }
}

function onVerticalSplitterDown(e: PointerEvent): void {
  if (e.button !== 0) return
  const barH = timelineBarEl.value?.offsetHeight ?? 36
  splitterDrag.value = {
    pointerId: e.pointerId,
    startY: e.clientY,
    startHeight: timelineCollapsed.value ? barH : timelineHeight.value
  }
  window.addEventListener('pointermove', onVerticalSplitterMove)
  window.addEventListener('pointerup', onVerticalSplitterUp)
  window.addEventListener('pointercancel', onVerticalSplitterUp)
  e.preventDefault()
}

function onVerticalSplitterMove(e: PointerEvent): void {
  const session = splitterDrag.value
  if (!session || e.pointerId !== session.pointerId) return
  const root = rootEl.value
  const max = Math.max(140, (root?.clientHeight ?? 480) - 100)
  const raw = session.startHeight + (session.startY - e.clientY)
  if (raw < 68) {
    timelineCollapsed.value = true
    return
  }
  if (timelineCollapsed.value) {
    timelineCollapsed.value = false
  }
  timelineHeight.value = Math.min(max, Math.max(timelineMinHeight.value, raw))
}

function onVerticalSplitterUp(e: PointerEvent): void {
  const session = splitterDrag.value
  if (!session || e.pointerId !== session.pointerId) return
  splitterDrag.value = null
  window.removeEventListener('pointermove', onVerticalSplitterMove)
  window.removeEventListener('pointerup', onVerticalSplitterUp)
  window.removeEventListener('pointercancel', onVerticalSplitterUp)
  window.removeEventListener('pointermove', onPanelSplitterMove)
  window.removeEventListener('pointerup', onPanelSplitterUp)
  window.removeEventListener('pointercancel', onPanelSplitterUp)
  window.removeEventListener('pointermove', onPlayheadPointerMove)
  window.removeEventListener('pointerup', onPlayheadPointerUp)
  window.removeEventListener('pointercancel', onPlayheadPointerUp)
}

function onPanelSplitterDown(e: PointerEvent, side: 'left' | 'right'): void {
  if (e.button !== 0) return
  panelSplitter.value = {
    side,
    pointerId: e.pointerId,
    startX: e.clientX,
    startWidth: side === 'left' ? leftPaneWidth.value : rightPaneWidth.value
  }
  window.addEventListener('pointermove', onPanelSplitterMove)
  window.addEventListener('pointerup', onPanelSplitterUp)
  window.addEventListener('pointercancel', onPanelSplitterUp)
  e.preventDefault()
}

function onPanelSplitterMove(e: PointerEvent): void {
  const session = panelSplitter.value
  if (!session || e.pointerId !== session.pointerId) return
  const root = rootEl.value
  const max = Math.max(160, (root?.clientWidth ?? 960) - 320)
  const delta = e.clientX - session.startX
  const next = Math.min(
    max,
    Math.max(160, session.startWidth + (session.side === 'left' ? delta : -delta))
  )
  if (session.side === 'left') leftPaneWidth.value = next
  else rightPaneWidth.value = next
}

function onPanelSplitterUp(e: PointerEvent): void {
  const session = panelSplitter.value
  if (!session || e.pointerId !== session.pointerId) return
  panelSplitter.value = null
  window.removeEventListener('pointermove', onPanelSplitterMove)
  window.removeEventListener('pointerup', onPanelSplitterUp)
  window.removeEventListener('pointercancel', onPanelSplitterUp)
}

function onDocPointerDownForSourceCtx(e: PointerEvent): void {
  const target = e.target as HTMLElement | null
  if (!target?.closest('.source-ctx-menu')) {
    closeSourceCtx()
  }
  if (
    transitionPopover.value &&
    !target?.closest('.transition-popover') &&
    !target?.closest('.transition-handle')
  ) {
    transitionPopover.value = null
  }
}

function onTimelineKeydown(e: KeyboardEvent): void {
  if (e.defaultPrevented) return
  const target = e.target as HTMLElement | null
  if (target?.closest('input, textarea, select, [contenteditable="true"]')) return
  if (e.key === 'Escape') {
    if (transitionPopover.value) {
      e.preventDefault()
      transitionPopover.value = null
      return
    }
    if (razorMode.value) {
      e.preventDefault()
      razorMode.value = false
      razorHover.value = null
      return
    }
    if (cropMode.value) {
      e.preventDefault()
      cropMode.value = false
      return
    }
  }
  if (e.key === ' ') {
    e.preventDefault()
    void toggleTimelinePlay()
    return
  }
  if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault()
    if (e.shiftKey) {
      rippleDeleteSelectedClips()
    } else {
      deleteSelectedClips()
    }
    return
  }
  if (!e.ctrlKey && !e.metaKey && !e.altKey) {
    if (e.key === 'b' || e.key === 'B') {
      if (canSplitActiveClip.value) {
        e.preventDefault()
        splitSelectedClipAtPlayhead()
      }
      return
    }
    if (e.key === 'c' || e.key === 'C') {
      e.preventDefault()
      toggleRazorMode()
      return
    }
    if (e.key === '[') {
      if (canTrimInAtPlayhead.value) {
        e.preventDefault()
        trimActiveClipAtPlayhead('in')
      }
      return
    }
    if (e.key === ']') {
      if (canTrimOutAtPlayhead.value) {
        e.preventDefault()
        trimActiveClipAtPlayhead('out')
      }
      return
    }
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      stepFrame(-1)
      return
    }
    if (e.key === 'ArrowRight') {
      e.preventDefault()
      stepFrame(1)
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      seekPrevCut()
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      seekNextCut()
      return
    }
  }
  if (!(e.ctrlKey || e.metaKey)) return
  const key = e.key.toLowerCase()
  if (key === 'k') {
    if (canSplitActiveClip.value) {
      e.preventDefault()
      splitSelectedClipAtPlayhead()
    }
  } else if (key === 'a') {
    e.preventDefault()
    selectAllClips()
  } else if (key === 'z' && !e.shiftKey) {
    e.preventDefault()
    undo()
  } else if ((key === 'z' && e.shiftKey) || key === 'y') {
    e.preventDefault()
    redo()
  } else if (key === 'c') {
    e.preventDefault()
    copySelectedClips()
  } else if (key === 'v') {
    e.preventDefault()
    pasteClips()
  }
}

let unregisterDiveHistory: (() => void) | null = null

function applyExternalTimelineUpdate(): void {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  loadPersisted()
  void reloadSources().then(() => {
    const first = clipAtPlayhead() ?? visibleClipsOn('video')[0]
    if (first && !playing.value) void showClipPreview(first)
  })
  void refreshClipVisuals()
}

onMounted(async () => {
  if (!isDraftAssetId(props.scriptAssetId)) {
    registerOpenTimelineEditor(props.scriptAssetId, applyExternalTimelineUpdate)
  }
  unregisterDiveHistory = diveEditorHistory.register({
    canUndo: () => canUndo.value,
    canRedo: () => canRedo.value,
    undo,
    redo
  })
  loadPersisted()
  await reloadSources()
  const first = visibleClipsOn('video')[0]
  if (first) void showClipPreview(first)
  bindTimelineViewport()
  bindPreviewStage()
  void refreshClipVisuals()
  window.addEventListener('pointerdown', onDocPointerDownForSourceCtx, true)
  window.addEventListener('keydown', onTimelineKeydown)
})

watch([() => props.scriptAssetId, () => props.timelineNodeId], async ([next], [prev]) => {
  // 换剧本资产：占用登记要跟着搬，否则旧资产会一直被判定为「编辑器打开」
  if (prev !== next) {
    if (prev && !isDraftAssetId(prev)) unregisterOpenTimelineEditor(prev)
    if (next && !isDraftAssetId(next)) {
      registerOpenTimelineEditor(next, applyExternalTimelineUpdate)
    }
  }
  stopPlayback()
  disposeAudioPool()
  disposeOverlayVideos()
  sourceThumbUrls.value = {}
  sourceThumbPathById.clear()
  // 换工程：波形绘制图与解码包络都作废，避免跨工程串用
  clipWaveformUrls.value = {}
  audioPeaksCache.clear()
  loadPersisted()
  await reloadSources()
  const first = clipAtPlayhead() ?? visibleClipsOn('video')[0]
  if (first) void showClipPreview(first)
  void refreshClipVisuals()
})

// 视频轨原声走预览区 video 元素，静音切换后立即生效（声音轨由 syncClipPreviewGain 实时读取）
watch(mutedTracks, () => {
  applyPreviewMuted()
})

watch(
  clips,
  () => {
    if (clipVisualTimer) clearTimeout(clipVisualTimer)
    clipVisualTimer = setTimeout(() => {
      void refreshClipVisuals()
    }, 320)
  },
  { deep: false }
)

watch(
  () =>
    sources.value
      .map((s) => `${s.id}:${s.relativePath ?? ''}:${s.assetId ?? ''}:${s.mediaKind ?? ''}`)
      .join('|'),
  () => {
    void refreshSourceThumbs()
  },
  { immediate: true }
)

watch(timelineCollapsed, async (collapsed) => {
  if (collapsed) return
  await Promise.resolve()
  bindTimelineViewport()
})

watch(previewFrameRatioKey, () => {
  updatePreviewFrameRect()
})

watch(contentEndSec, (end) => {
  if (end <= durationSec.value) return
  durationSec.value = Math.max(durationSec.value, end)
  durationInputSec.value = Math.round(durationSec.value)
})

let timelineViewportRo: ResizeObserver | null = null
let previewStageRo: ResizeObserver | null = null

function bindTimelineViewport(): void {
  timelineViewportRo?.disconnect()
  const el = timelineBoardEl.value
  if (!el || typeof ResizeObserver === 'undefined') return
  const update = () => {
    viewportLanePx.value = Math.max(0, el.clientWidth - TRACK_LABEL_W)
  }
  update()
  timelineViewportRo = new ResizeObserver(update)
  timelineViewportRo.observe(el)
}

function bindPreviewStage(): void {
  previewStageRo?.disconnect()
  const el = previewStageEl.value
  if (!el || typeof ResizeObserver === 'undefined') return
  const update = () => updatePreviewFrameRect()
  update()
  previewStageRo = new ResizeObserver(update)
  previewStageRo.observe(el)
}

onBeforeUnmount(() => {
  unregisterDiveHistory?.()
  unregisterDiveHistory = null
  unregisterOpenTimelineEditor(props.scriptAssetId)
  stopEffectPreviewClock()
  cancelTransitionSweep()
  stopPlayback()
  disposeAudioPool()
  disposeOverlayVideos()
  timelineViewportRo?.disconnect()
  timelineViewportRo = null
  previewStageRo?.disconnect()
  previewStageRo = null
  unbindClipDragListeners()
  unbindClipResizeListeners()
  unbindSubtitleDragListeners()
  unbindOverlayDragListeners()
  unbindCropDragListeners()
  unbindTransitionDragListeners()
  window.removeEventListener('pointermove', onVerticalSplitterMove)
  window.removeEventListener('pointerup', onVerticalSplitterUp)
  window.removeEventListener('pointercancel', onVerticalSplitterUp)
  clipDrag.value = null
  clipDragPreview.value = null
  clipResize.value = null
  cropDrag.value = null
  transitionDrag.value = null
  window.removeEventListener('pointerdown', onDocPointerDownForSourceCtx, true)
  window.removeEventListener('keydown', onTimelineKeydown)
  closeSourceCtx()
  if (saveTimer) clearTimeout(saveTimer)
  if (clipVisualTimer) clearTimeout(clipVisualTimer)
  audioPeaksCache.clear()
  closeDecodeAudioCtx()
  void persist()
})

defineExpose({ flushSave: persist, reloadSources })
</script>

<style scoped>
.script-timeline {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--bg-panel);
}

.workspace {
  flex: 1;
  min-height: 120px;
  display: grid;
  grid-template-columns: minmax(180px, 240px) minmax(280px, 1fr) minmax(180px, 220px);
}

.vertical-splitter {
  flex: none;
  height: 5px;
  cursor: ns-resize;
  background: transparent;
  border-top: 1px solid var(--border);
  transition: background-color 0.12s ease;
}

.vertical-splitter:hover {
  background: color-mix(in srgb, var(--accent) 18%, transparent);
}

.horizontal-splitter {
  width: 5px;
  cursor: ew-resize;
  background: transparent;
  transition: background-color 0.12s ease;
}

.horizontal-splitter:hover {
  background: color-mix(in srgb, var(--accent) 18%, transparent);
}

.panel {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.sources-panel {
  background: var(--bg-elevated);
  border-right: 1px solid var(--border);
}

.inspector-panel {
  background: var(--bg-elevated);
  border-left: 1px solid var(--border);
}

.inspector-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  overflow: auto;
}

.inspector-track {
  font-size: 11px;
  color: var(--accent);
  font-weight: 600;
}

.inspector-section-title {
  font-size: 10px;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.inspector-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 11px;
  color: var(--text-muted);
}

.inspector-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.inspector-reset {
  margin-top: 2px;
  align-self: flex-start;
}

.inspector-hint {
  font-size: 10px;
  color: var(--text-muted);
  line-height: 1.45;
}

.inspector-source-node {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 4px 0 6px;
}
.source-node-title {
  font-size: 11px;
  color: var(--text-primary, #e6e6e6);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.inspector-locate-btn {
  align-self: flex-start;
}

.inspector-field input[type='number'],
.inspector-field input[type='range'],
.inspector-field textarea {
  width: 100%;
  box-sizing: border-box;
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text);
  font: inherit;
  padding: 4px 6px;
}

.inspector-field input[readonly] {
  background: var(--bg-hover);
  color: var(--text-muted);
  opacity: 0.62;
}

.inspector-field input:disabled {
  background: var(--bg-hover);
  color: var(--text-muted);
  opacity: 0.62;
  cursor: not-allowed;
}

.inspector-field select:disabled {
  opacity: 0.62;
  cursor: not-allowed;
}

.inspector-empty {
  padding: 14px 10px;
  color: var(--text-muted);
  font-size: 11px;
}

.panel-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.panel-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
}

.panel-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  min-width: 0;
}

.source-size-range {
  width: 72px;
}

.source-size-footer {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-top: 1px solid var(--border);
  background: var(--bg-elevated);
}

.source-size-label {
  flex: 1;
  min-width: 0;
  font-size: 11px;
  color: var(--text-muted);
  white-space: nowrap;
}

.panel-empty {
  padding: 16px 12px;
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.45;
}

.source-list {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 8px;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(var(--source-card-size, 72px), 1fr));
  gap: 8px;
  align-content: start;
}

.source-group {
  display: contents;
}

.imported-panel {
  flex: 1;
  min-height: 120px;
  padding-bottom: 4px;
}

.source-group-head {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 2px;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: none;
}

.source-folder {
  display: contents;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: color-mix(in srgb, var(--bg-panel) 88%, var(--bg-elevated));
  overflow: hidden;
}

.source-folder.drag-over,
.ungrouped-zone.drag-over {
  border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 35%, transparent);
}

.folder-head {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 6px 8px;
  border: none;
  background: transparent;
  color: var(--text);
  font-size: 12px;
  cursor: pointer;
  text-align: left;
}

.folder-head:hover {
  background: color-mix(in srgb, var(--accent) 8%, transparent);
}

.folder-chevron {
  width: 12px;
  color: var(--text-muted);
  flex-shrink: 0;
}

.folder-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
}

.folder-body {
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(var(--source-card-size, 72px), 1fr));
  gap: 6px;
  padding: 0 6px 8px;
}

.folder-empty {
  grid-column: 1 / -1;
  padding: 6px 4px;
  font-size: 11px;
  color: var(--text-muted);
}

.ungrouped-zone {
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(var(--source-card-size, 72px), 1fr));
  gap: 6px;
  align-content: start;
  min-height: 44px;
  border-radius: 8px;
  border: 1px solid transparent;
  padding: 2px;
}

.ungrouped-label {
  grid-column: 1 / -1;
  padding: 2px 2px 0;
  font-size: 10px;
  color: var(--text-muted);
}

.panel-empty.subtle {
  grid-column: 1 / -1;
  padding: 8px 4px;
  font-size: 11px;
}

.sticker-library-section .source-group-head {
  margin-top: 6px;
  padding-top: 8px;
  border-top: 1px solid var(--border);
}

.source-thumb.sticker-thumb {
  padding: 6px;
  background: radial-gradient(
    circle,
    color-mix(in srgb, var(--accent) 16%, var(--bg-elevated)),
    var(--bg-input)
  );
}

.source-thumb.sticker-thumb img {
  object-fit: contain;
}

.source-ctx-menu {
  position: fixed;
  z-index: 4000;
  min-width: 148px;
  padding: 4px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-elevated);
  box-shadow: 0 8px 24px var(--shadow);
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.source-ctx-menu button {
  border: none;
  background: transparent;
  color: var(--text);
  text-align: left;
  padding: 6px 10px;
  border-radius: 6px;
  font-size: 12px;
  cursor: pointer;
}

.source-ctx-menu button:hover {
  background: var(--bg-hover);
}

.source-ctx-menu button.danger {
  color: var(--danger);
}

.source-group-count {
  min-width: 18px;
  padding: 0 5px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--text-muted) 16%, transparent);
  font-size: 10px;
  font-weight: 600;
  text-align: center;
  color: var(--text-muted);
}

.source-card {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  width: 100%;
  max-width: 100%;
  min-width: 0;
  height: auto;
  min-height: calc(var(--source-card-size, 72px) + 46px);
  padding: 6px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-panel);
  color: var(--text);
  cursor: grab;
  text-align: left;
  box-sizing: border-box;
}

.source-card.origin-imported {
  border-color: color-mix(in srgb, var(--success) 35%, var(--border));
  background: color-mix(in srgb, var(--success) 6%, var(--bg-panel));
}

.source-card:active {
  cursor: grabbing;
}

.source-card:hover {
  border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
}

.source-remove {
  position: absolute;
  top: 4px;
  right: 4px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
}

.source-remove:hover {
  background: color-mix(in srgb, var(--danger) 16%, transparent);
  color: var(--danger);
}

.source-thumb {
  width: var(--source-card-size, 72px);
  height: var(--source-card-size, 72px);
  box-sizing: border-box;
  border-radius: 6px;
  flex-shrink: 0;
  overflow: hidden;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(
    135deg,
    color-mix(in srgb, var(--accent) 28%, var(--bg-elevated)),
    var(--bg-input)
  );
}

.source-thumb img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.source-thumb.voice {
  width: var(--source-card-size, 72px);
  height: var(--source-card-size, 72px);
  background: linear-gradient(
    135deg,
    color-mix(in srgb, var(--warning) 32%, var(--bg-elevated)),
    var(--bg-input)
  );
}

.source-thumb-glyph {
  font-size: calc(var(--source-card-size, 72px) * 0.22);
  line-height: 1;
  user-select: none;
}

.source-meta {
  flex: 1;
  min-width: 0;
  width: 100%;
  max-width: 100%;
  display: flex;
  flex-direction: column;
  gap: 2px;
  align-items: center;
  text-align: center;
}

.source-tags {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
}

.source-tag {
  font-size: 10px;
  color: var(--text-muted);
  padding: 0 5px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--text-muted) 12%, transparent);
}

.source-tag.imported {
  color: var(--success);
  background: color-mix(in srgb, var(--success) 16%, transparent);
}

.source-name {
  width: 100%;
  max-width: 100%;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.source-tags {
  display: none;
}

.source-dur {
  font-size: 10px;
  color: var(--text-muted);
}

.preview-panel {
  background: var(--media-letterbox);
}

.preview-stage {
  position: relative;
  flex: 1;
  min-height: 0;
  min-height: 120px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.preview-video {
  width: 100%;
  height: 100%;
  object-fit: contain;
  background: #000;
}

.preview-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  color: var(--text-muted);
  font-size: 13px;
  padding: 16px;
  text-align: center;
}

.preview-frame-ratio-select {
  position: absolute;
  top: 10px;
  right: 10px;
  z-index: 5;
  width: 60px;
  max-width: 60px;
  height: 26px;
  padding: 0 6px;
  border: 1px solid color-mix(in srgb, var(--on-media-line) 24%, transparent);
  border-radius: 6px;
  background: rgba(8, 16, 28, 0.72);
  color: #fff;
  font-size: 11px;
  outline: none;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.export-frame-overlay {
  position: absolute;
  z-index: 1;
  pointer-events: none;
  border: 1px solid rgba(120, 190, 255, 0.95);
  border-radius: 2px;
  box-sizing: border-box;
  box-shadow:
    0 0 0 9999px rgba(0, 0, 0, 0.38),
    inset 0 0 0 1px color-mix(in srgb, var(--on-media-line) 12%, transparent);
}

.export-frame-label {
  position: absolute;
  top: 0;
  left: 0;
  padding: 3px 8px;
  border-radius: 0 0 6px 0;
  background: rgba(8, 16, 28, 0.78);
  border-right: 1px solid color-mix(in srgb, var(--on-media-line) 14%, transparent);
  border-bottom: 1px solid color-mix(in srgb, var(--on-media-line) 14%, transparent);
  color: #fff;
  font-size: 10px;
  line-height: 1.4;
  white-space: nowrap;
  letter-spacing: 0.02em;
}

.overlay-layer {
  position: absolute;
  inset: 0;
  z-index: 2;
  pointer-events: none;
}

.overlay-video {
  position: absolute;
  pointer-events: auto;
  cursor: move;
  background: rgba(0, 0, 0, 0.35);
  object-fit: cover;
  touch-action: none;
}

.transition-overlay-video {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  /* CSS 模拟转场时，B 片段需以黑色填充未覆盖区域（与导出端 pad 黑边对齐），
     否则 A 画面会从 B 的 letterbox 黑边处透出来，变成“缩放叠加”假象 */
  background: #000;
  pointer-events: none;
  z-index: 1;
}

.overlay-selection {
  position: absolute;
  pointer-events: none;
  border: 1.5px solid #4c9aff;
  box-shadow:
    0 0 0 1px rgba(255, 255, 255, 0.7),
    0 0 12px rgba(76, 154, 255, 0.38);
}

.overlay-handle {
  position: absolute;
  width: 14px;
  height: 14px;
  border: 2px solid #fff;
  border-radius: 50%;
  background: #4c9aff;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.45);
  pointer-events: auto;
  cursor: nwse-resize;
}

.overlay-handle.corner-tl {
  left: -7px;
  top: -7px;
  cursor: nwse-resize;
}

.overlay-handle.corner-tr {
  right: -7px;
  top: -7px;
  cursor: nesw-resize;
}

.overlay-handle.corner-bl {
  left: -7px;
  bottom: -7px;
  cursor: nesw-resize;
}

.overlay-handle.corner-br {
  right: -7px;
  bottom: -7px;
  cursor: nwse-resize;
}

.subtitle-overlay {
  position: absolute;
  left: 50%;
  bottom: 24px;
  transform: translateX(-50%);
  width: max-content;
  max-width: 88%;
  padding: 4px 10px;
  border-radius: 6px;
  background: transparent;
  color: #fff;
  font-size: 16px;
  font-weight: 600;
  line-height: 1.4;
  letter-spacing: 0.02em;
  text-align: center;
  word-break: break-word;
  paint-order: stroke fill;
  pointer-events: auto;
  cursor: pointer;
  z-index: 4;
  border: 1px dashed transparent;
  transition: border-color 0.14s ease;
}

.subtitle-overlay:hover,
.subtitle-overlay.is-selected {
  border-color: rgba(255, 255, 255, 0.72);
}

.subtitle-handle {
  position: absolute;
  width: 10px;
  height: 10px;
  border: 1.5px solid #fff;
  border-radius: 50%;
  background: var(--accent);
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.45);
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.14s ease;
}

.subtitle-overlay:hover .subtitle-handle,
.subtitle-overlay.is-selected .subtitle-handle {
  opacity: 1;
  pointer-events: auto;
}

.subtitle-handle.corner-tl {
  left: -5px;
  top: -5px;
  cursor: nwse-resize;
}

.subtitle-handle.corner-tr {
  right: -5px;
  top: -5px;
  cursor: nesw-resize;
}

.subtitle-handle.corner-bl {
  left: -5px;
  bottom: -5px;
  cursor: nesw-resize;
}

.subtitle-handle.corner-br {
  right: -5px;
  bottom: -5px;
  cursor: nwse-resize;
}

.preview-transport {
  display: none;
}

.audio-mix-controls {
  position: absolute;
  right: 10px;
  bottom: 8px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  font-size: 11px;
}

.mix-field {
  display: flex;
  align-items: center;
  gap: 4px;
}

.mix-field input[type='number'] {
  width: 48px;
  color: #fff;
  background: color-mix(in srgb, var(--on-media-line) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--on-media-line) 22%, transparent);
  border-radius: 4px;
  padding: 2px 4px;
}

.mix-field input[type='range'] {
  width: 72px;
}

.preview-play-btn {
  width: 28px;
  height: 28px;
  flex-shrink: 0;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: var(--accent);
  color: #fff;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.preview-play-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.preview-play-btn .triangle {
  width: 0;
  height: 0;
  margin-left: 2px;
  border-style: solid;
  border-width: 5px 0 5px 8px;
  border-color: transparent transparent transparent currentColor;
}

.preview-play-btn .pause {
  width: 8px;
  height: 10px;
  box-sizing: border-box;
  border-left: 2.5px solid currentColor;
  border-right: 2.5px solid currentColor;
}

.play-glyph {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  border: 2px solid color-mix(in srgb, var(--text-muted) 55%, transparent);
  position: relative;
}

.play-glyph::before {
  content: '';
  position: absolute;
  left: 17px;
  top: 13px;
  border-style: solid;
  border-width: 8px 0 8px 12px;
  border-color: transparent transparent transparent
    color-mix(in srgb, var(--text-muted) 70%, transparent);
}

.play-glyph.sm {
  width: 22px;
  height: 22px;
  flex-shrink: 0;
}

.play-glyph.sm::before {
  left: 8px;
  top: 5px;
  border-width: 5px 0 5px 8px;
}

.ghost-btn {
  font-size: 11px;
  padding: 2px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-panel);
  color: var(--text-muted);
  cursor: pointer;
}

.ghost-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.timeline-dock {
  flex: none;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border-top: 1px solid var(--border);
  background: var(--bg-panel);
  overflow: hidden;
}

.timeline-dock.collapsed {
  height: auto !important;
}

.timeline-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  padding: 4px 10px;
  min-height: 36px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-elevated);
  flex-shrink: 0;
}

.timeline-dock.collapsed .timeline-bar {
  border-bottom: none;
}

.timeline-controls {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.ctrl-field,
.ctrl-check {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--text-muted);
  white-space: nowrap;
}

.ctrl-input,
.ctrl-select {
  width: 64px;
  height: 24px;
  padding: 0 6px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-panel);
  color: var(--text);
  font-size: 11px;
}

.ctrl-select {
  width: auto;
  min-width: 64px;
}

.track-height-control input[type='range'] {
  width: 88px;
}

.ctrl-input.color-input {
  width: 40px;
  padding: 2px;
}

.ctrl-unit {
  font-size: 10px;
}

.ctrl-check input {
  margin: 0;
}

.zoom-readout {
  font-size: 11px;
  color: var(--text-muted);
  min-width: 36px;
}

.export-btn {
  margin-left: 4px;
  height: 26px;
  padding: 0 10px;
  border: none;
  border-radius: 6px;
  background: var(--accent);
  color: var(--on-accent);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}

.export-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.export-settings-mask {
  position: absolute;
  inset: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.42);
}

.export-settings-panel {
  width: min(360px, calc(100% - 32px));
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 16px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg-elevated);
  box-shadow: 0 12px 32px var(--shadow);
}

.export-settings-title {
  font-size: 13px;
  font-weight: 600;
}

.export-custom-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.export-settings-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 4px;
}

.export-platform-info {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  font-size: 12px;
  opacity: 0.8;
  padding: 2px 0 4px;
}

.export-platform-warning {
  color: #e6a23c;
  font-weight: 600;
}

.export-compliance {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 12px;
  padding: 2px 0 4px;
}

.export-compliance.ok {
  color: #67c23a;
}

.export-compliance-item {
  color: #e6a23c;
}

.watermark-pick-row {
  display: flex;
  gap: 6px;
  align-items: center;
}

.watermark-pick-row .ghost-btn {
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.export-error-box {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 4px;
  padding: 8px;
  border: 1px solid rgba(230, 162, 60, 0.4);
  border-radius: 6px;
  background: rgba(230, 162, 60, 0.08);
  font-size: 12px;
}

.export-error-title {
  color: #e6a23c;
  font-weight: 600;
}

.export-error-box code {
  white-space: pre-wrap;
  word-break: break-all;
  opacity: 0.85;
}

.export-safe-area {
  position: absolute;
  border: 1px dashed rgba(255, 206, 84, 0.75);
  box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.12);
  pointer-events: none;
  z-index: 1;
}

.mixer-panel {
  width: min(420px, calc(100% - 32px));
  max-height: calc(100% - 48px);
  overflow-y: auto;
}

.sfx-library-panel {
  width: min(680px, calc(100% - 32px));
  max-height: calc(100% - 48px);
  overflow-y: auto;
}

.sfx-library-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 8px;
}

.sfx-library-tab {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.sfx-library-tab-icon {
  font-size: 13px;
  line-height: 1;
}

.sfx-library-tabs .ghost-btn.active {
  border-color: #4a90d9;
  color: #4a90d9;
  font-weight: 600;
}

.sfx-preset-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
  gap: 10px;
  margin-bottom: 10px;
}

.sfx-preset-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px;
  border: 1px solid rgba(127, 127, 127, 0.25);
  border-radius: 10px;
  background: rgba(127, 127, 127, 0.06);
  transition:
    border-color 0.16s ease,
    background-color 0.16s ease,
    transform 0.16s ease;
}

.sfx-preset-card:hover {
  border-color: rgba(100, 175, 255, 0.45);
  background: rgba(127, 127, 127, 0.11);
  transform: translateY(-1px);
}

.sfx-preset-head {
  display: flex;
  align-items: center;
  gap: 9px;
}

.sfx-preset-icon {
  width: 34px;
  height: 34px;
  border-radius: 9px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  line-height: 1;
  flex-shrink: 0;
  border: 1px solid rgba(127, 127, 127, 0.25);
  background: rgba(127, 127, 127, 0.14);
}

.sfx-preset-icon.transition {
  background: linear-gradient(135deg, rgba(56, 189, 248, 0.2), rgba(59, 130, 246, 0.12));
  border-color: rgba(56, 189, 248, 0.35);
}

.sfx-preset-icon.ui {
  background: linear-gradient(135deg, rgba(168, 85, 247, 0.2), rgba(236, 72, 153, 0.12));
  border-color: rgba(168, 85, 247, 0.35);
}

.sfx-preset-icon.ambient {
  background: linear-gradient(135deg, rgba(16, 185, 129, 0.2), rgba(20, 184, 166, 0.12));
  border-color: rgba(16, 185, 129, 0.35);
}

.sfx-preset-title-wrap {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}

.sfx-preset-name {
  font-weight: 600;
  font-size: 13px;
  line-height: 1.25;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sfx-preset-cat-badge {
  align-self: flex-start;
  font-size: 10px;
  line-height: 1.3;
  padding: 1px 6px;
  border-radius: 999px;
  opacity: 0.85;
  background: rgba(127, 127, 127, 0.16);
}

.sfx-preset-cat-badge.transition {
  color: #7dd3fc;
  background: rgba(56, 189, 248, 0.14);
}

.sfx-preset-cat-badge.ui {
  color: #d8b4fe;
  background: rgba(168, 85, 247, 0.14);
}

.sfx-preset-cat-badge.ambient {
  color: #6ee7b7;
  background: rgba(16, 185, 129, 0.14);
}

.sfx-preset-prompt {
  font-size: 12px;
  opacity: 0.72;
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.sfx-preset-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: auto;
  padding-top: 2px;
}

.sfx-preset-duration {
  font-size: 11px;
  opacity: 0.6;
}

.sfx-library-assets {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.sfx-library-asset-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 4px 6px;
  border-radius: 6px;
}

.sfx-library-asset-row:hover {
  background: rgba(127, 127, 127, 0.08);
}

.sfx-library-asset-name {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sfx-library-asset-icon {
  font-size: 13px;
  line-height: 1;
  flex-shrink: 0;
}

.sfx-library-empty {
  font-size: 12px;
  opacity: 0.6;
}

.mixer-section-title {
  font-size: 12px;
  font-weight: 600;
  opacity: 0.75;
  margin-top: 2px;
}

.mixer-slider-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.mixer-slider-row input[type='range'] {
  flex: 1;
  min-width: 0;
}

.mixer-value {
  flex: none;
  width: 88px;
  font-size: 11px;
  text-align: right;
  opacity: 0.8;
  font-variant-numeric: tabular-nums;
}

.subtitle-edit-mask {
  position: absolute;
  inset: 0;
  z-index: 40;
  display: grid;
  place-items: center;
  background: var(--overlay);
}

.subtitle-edit-panel {
  width: min(420px, calc(100% - 32px));
  padding: 14px 16px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  box-shadow: 0 12px 32px var(--shadow);
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.subtitle-edit-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
}

.subtitle-edit-input {
  width: 100%;
  height: 34px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-panel);
  color: var(--text);
  font-size: 13px;
}

.subtitle-edit-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.smart-cut-mask {
  position: absolute;
  inset: 0;
  z-index: 45;
  display: grid;
  place-items: center;
  background: var(--overlay);
}

.smart-cut-panel {
  width: min(640px, calc(100% - 32px));
  max-height: calc(100% - 48px);
  padding: 14px 16px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  box-shadow: 0 12px 32px var(--shadow);
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.smart-cut-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
}

.smart-cut-subtitle {
  margin: 0;
  font-size: 12px;
  opacity: 0.75;
}

.smart-cut-model-row {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-panel);
}

.smart-cut-model-row .smart-cut-field {
  flex: 1;
  min-width: 0;
}

.smart-cut-model-row select {
  width: 100%;
}

.smart-cut-model-row .ghost-btn {
  flex: none;
  height: 28px;
}

.smart-cut-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  overflow-y: auto;
}

.smart-cut-empty {
  margin: 0;
  padding: 18px 0;
  text-align: center;
  font-size: 12px;
  opacity: 0.6;
}

.smart-cut-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-panel);
}

.smart-cut-index {
  flex: none;
  width: 22px;
  height: 22px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: var(--accent);
  color: var(--bg-panel);
  font-size: 12px;
  font-weight: 600;
}

.smart-cut-item-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.smart-cut-item-title {
  font-size: 13px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.smart-cut-item-shot {
  font-size: 11px;
  opacity: 0.6;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.smart-cut-beat-note {
  font-size: 11px;
  color: var(--accent);
  opacity: 0.9;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.smart-cut-field {
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 3px;
  font-size: 11px;
  opacity: 0.85;
}

.smart-cut-field input,
.smart-cut-field select {
  height: 28px;
  padding: 0 6px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-elevated);
  color: var(--text);
  font-size: 12px;
  width: 110px;
}

.smart-cut-field input {
  width: 84px;
}

.smart-cut-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.timeline-board {
  flex: 1 1 auto;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  background: var(--bg-panel);
}

.timeline-board.scrollable {
  overflow-x: auto;
  overflow-y: auto;
}

.timeline-inner {
  position: relative;
  overflow: hidden;
}

.timeline-bottom-pad {
  display: grid;
  grid-template-columns: 150px minmax(0, 1fr);
  height: var(--bottom-pad, 32px);
  border-top: 1px solid color-mix(in srgb, var(--border) 55%, transparent);
  pointer-events: none;
}

.timeline-bottom-pad::before {
  content: '';
  background: var(--bg-panel);
  border-right: 1px solid var(--border);
}

.ruler-row,
.track-row {
  display: grid;
  grid-template-columns: 150px minmax(0, 1fr);
  align-items: stretch;
}

.ruler-row {
  position: sticky;
  top: 0;
  z-index: 4;
  height: 28px;
  background: var(--bg-elevated);
}

.track-row {
  height: var(--track-height, 52px);
}

.track-label {
  display: flex;
  align-items: center;
  padding: 0 10px;
  font-size: 12px;
  color: var(--text-muted);
  border-right: 1px solid var(--border);
  background: var(--bg-elevated);
  z-index: 3;
}

.track-label > span {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.track-state-btn {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--text-muted);
  font-size: 11px;
  line-height: 1;
  cursor: pointer;
}

.track-state-btn:hover {
  background: var(--bg-hover);
  color: var(--text);
}

.track-collapse-btn {
  width: 22px;
  height: 22px;
  font-size: 0;
  line-height: 1;
}

/* 静音按钮：开启时用主色底提示当前轨道已静音 */
.track-mute-btn.muted-on {
  background: color-mix(in srgb, var(--accent) 26%, transparent);
  color: var(--text);
}

/* 静音轨道：波形淡化，一眼看出这段不出声 */
.muted-track .clip-wave {
  opacity: 0.4;
}

.track-collapse-glyph {
  position: relative;
  top: 2px;
  display: block;
  width: 0;
  height: 0;
  border-left: 5px solid transparent;
  border-right: 5px solid transparent;
  border-top: 8px solid currentColor;
}

.track-collapse-glyph.collapsed {
  border-top: 5px solid transparent;
  border-bottom: 5px solid transparent;
  border-left: 8px solid currentColor;
  border-right: 0;
}

.eye-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  line-height: 1;
}

.eye-icon.off {
  opacity: 0.35;
  filter: grayscale(1);
}

.track-row.hidden-track {
  opacity: 0.45;
}

.track-row.locked-track .track-lane {
  background: color-mix(in srgb, var(--warning, #c9842a) 10%, var(--bg-panel));
}

.track-row.collapsed-track {
  height: 24px;
}

.track-row.collapsed-track .track-label {
  height: 24px;
}

.track-row.collapsed-track .track-lane {
  display: none;
}

.track-label.gutter {
  min-height: 0;
}

.ruler {
  position: relative;
  height: 28px;
  border-bottom: 1px solid var(--border);
  background: color-mix(in srgb, var(--bg-elevated) 80%, var(--bg));
  cursor: ew-resize;
  overflow: hidden;
}

.ruler-tick {
  position: absolute;
  top: 16px;
  bottom: 0;
  width: 0;
  border-left: 1px solid color-mix(in srgb, var(--text-muted) 45%, transparent);
  pointer-events: none;
}

.ruler-mark {
  position: absolute;
  top: 3px;
  font-size: 10px;
  line-height: 1;
  color: var(--text-muted);
  pointer-events: none;
  white-space: nowrap;
  transform: translateX(-50%);
}

.ruler-mark.start {
  transform: translateX(0);
  padding-left: 2px;
}

.ruler-mark.end:not(.start) {
  transform: translateX(-100%);
  padding-right: 2px;
}

.track-lane {
  position: relative;
  height: var(--track-height, 52px);
  border-bottom: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
  background: color-mix(in srgb, var(--bg-panel) 92%, var(--bg));
  overflow: hidden;
}

.track-row.droppable .track-lane {
  background: color-mix(in srgb, var(--accent) 8%, var(--bg-panel));
}

.track-row.drag-over .track-lane {
  background: color-mix(in srgb, var(--accent) 22%, var(--bg-panel));
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 55%, transparent);
}

.lane-empty,
.lane-muted {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--text-muted);
  font-size: 12px;
  pointer-events: none;
}

.create-hint {
  position: absolute;
  left: 50%;
  top: 4px;
  transform: translateX(-50%);
  z-index: 1;
  font-size: 11px;
  padding: 2px 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-elevated);
  color: var(--text);
  cursor: pointer;
}

.speaker {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 1.5px solid currentColor;
  opacity: 0.7;
}

.clip {
  position: absolute;
  top: 8px;
  height: calc(var(--track-height, 52px) - 16px);
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 8px;
  border: 1px solid color-mix(in srgb, var(--accent) 40%, var(--border));
  border-radius: 6px;
  background: color-mix(in srgb, var(--accent) 22%, var(--bg-elevated));
  color: var(--text);
  font-size: 11px;
  cursor: grab;
  overflow: hidden;
  z-index: 1;
  touch-action: none;
  user-select: none;
}

.clip.dragging {
  cursor: grabbing;
  z-index: 4;
  opacity: 0.55;
  outline: 2px dashed color-mix(in srgb, var(--accent) 78%, transparent);
  outline-offset: -1px;
}

.clip-drag-ghost {
  position: absolute;
  z-index: 5;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 8px;
  border: 1px dashed color-mix(in srgb, var(--accent) 90%, #fff);
  border-radius: 6px;
  background: color-mix(in srgb, var(--accent) 24%, var(--bg-elevated));
  color: var(--text);
  font-size: 11px;
  pointer-events: none;
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.28);
  user-select: none;
}

.clip-insert-line {
  position: absolute;
  top: 0;
  bottom: 0;
  z-index: 6;
  width: 0;
  border-left: 2px solid var(--accent);
  pointer-events: none;
  box-shadow: 0 0 8px color-mix(in srgb, var(--accent) 60%, transparent);
}

.clip.active {
  outline: 1px solid var(--accent);
}

.clip.selected {
  outline: 2px solid var(--success);
  border-color: var(--success);
}

.clip.subtitle {
  background: color-mix(in srgb, var(--accent) 35%, var(--bg-elevated));
}

.clip.overlay {
  border-color: color-mix(in srgb, #4c9aff 68%, var(--border));
  background: color-mix(in srgb, #4c9aff 20%, var(--bg-elevated));
}

/* 声音三轨按类型着色：人声绿 / 音乐青 / 音效橙（--clip-accent 由 clipVisualStyle 注入） */
.clip.voice,
.clip.music,
.clip.sfx {
  border-color: color-mix(in srgb, var(--clip-accent, var(--accent)) 55%, var(--border));
  background: color-mix(in srgb, var(--clip-accent, var(--accent)) 20%, var(--bg-elevated));
}

/* 波形层独立铺在片段底部，不受片段 padding 影响；z-index 低于标题与裁剪手柄 */
.clip-wave {
  position: absolute;
  inset: 0;
  z-index: 0;
  border-radius: inherit;
  background-repeat: no-repeat;
  background-position: left center;
  pointer-events: none;
}

.clip-title {
  position: relative;
  z-index: 2;
  flex: 1;
  min-width: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  pointer-events: none;
}

.clip-title.on-media {
  color: #fff;
  text-shadow:
    0 1px 2px rgba(0, 0, 0, 0.9),
    0 0 5px rgba(0, 0, 0, 0.55);
}

.clip-remove {
  position: absolute;
  top: 2px;
  right: 2px;
  opacity: 0.7;
  font-size: 14px;
  line-height: 1;
  z-index: 3;
}

.clip-reshoot {
  position: absolute;
  top: 3px;
  right: 18px;
  opacity: 0.75;
  font-size: 12px;
  line-height: 1;
  z-index: 3;
}

.clip-reshoot:hover {
  opacity: 1;
}

.clip-reshoot-btn {
  width: 100%;
  margin-bottom: 2px;
}

.clip-source-locate {
  position: absolute;
  top: 2px;
  right: 20px;
  opacity: 0.75;
  font-size: 11px;
  line-height: 1;
  z-index: 3;
  cursor: pointer;
  padding: 2px 4px;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.35);
  color: #fff;
}
.clip-source-locate:hover {
  opacity: 1;
  background: rgba(64, 128, 255, 0.45);
}

.clip-handle {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 10px;
  cursor: ew-resize;
  z-index: 2;
  opacity: 0;
  transition:
    opacity 0.12s ease,
    background-color 0.12s ease;
}

.clip-handle.left {
  left: 0;
}

.clip-handle.right {
  right: 0;
}

.clip:hover .clip-handle,
.clip.active .clip-handle {
  opacity: 1;
}

.clip-handle:hover {
  background: color-mix(in srgb, var(--accent) 28%, transparent);
}

.ghost-btn.active {
  background: color-mix(in srgb, var(--accent) 22%, var(--bg-card));
  border-color: var(--accent);
  color: var(--accent);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 35%, transparent);
}

.timeline-board.razor-mode,
.timeline-board.razor-mode .clip,
.timeline-board.razor-mode .track-lane {
  cursor: crosshair !important;
}

.razor-cut-line {
  position: absolute;
  top: -2px;
  bottom: -2px;
  width: 2px;
  background: #ff4d4f;
  box-shadow: 0 0 6px rgba(255, 77, 79, 0.85);
  pointer-events: none;
  z-index: 6;
}

.razor-cut-time {
  position: absolute;
  top: 2px;
  left: 4px;
  padding: 1px 4px;
  border-radius: 3px;
  background: #ff4d4f;
  color: #fff;
  font-size: 9px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  white-space: nowrap;
  line-height: 1.2;
}

.clip-cropped-badge {
  display: inline-flex;
  align-items: center;
  margin-left: 3px;
  padding: 0 3px;
  border-radius: 3px;
  background: rgba(76, 154, 255, 0.28);
  color: #bde0ff;
  font-size: 9px;
  line-height: 1.2;
}

/* ── Video Frame Crop Overlay ── */
.crop-box-overlay {
  position: absolute;
  z-index: 5;
  border: 1.5px solid #4c9aff;
  box-shadow:
    0 0 0 9999px rgba(0, 0, 0, 0.56),
    inset 0 0 0 1px rgba(76, 154, 255, 0.45);
  cursor: move;
  user-select: none;
  touch-action: none;
}

.crop-grid-line {
  position: absolute;
  pointer-events: none;
  background: rgba(76, 154, 255, 0.42);
}

.crop-grid-line.v1 {
  top: 0;
  bottom: 0;
  left: 33.3333%;
  width: 1px;
}

.crop-grid-line.v2 {
  top: 0;
  bottom: 0;
  left: 66.6667%;
  width: 1px;
}

.crop-grid-line.h1 {
  left: 0;
  right: 0;
  top: 33.3333%;
  height: 1px;
}

.crop-grid-line.h2 {
  left: 0;
  right: 0;
  top: 66.6667%;
  height: 1px;
}

.crop-handle {
  position: absolute;
  width: 10px;
  height: 10px;
  background: #fff;
  border: 1.5px solid #4c9aff;
  border-radius: 2px;
  z-index: 2;
}

.crop-handle.nw,
.crop-handle.corner-tl {
  top: -5px;
  left: -5px;
  cursor: nwse-resize;
}

.crop-handle.ne,
.crop-handle.corner-tr {
  top: -5px;
  right: -5px;
  cursor: nesw-resize;
}

.crop-handle.sw,
.crop-handle.corner-bl {
  bottom: -5px;
  left: -5px;
  cursor: nesw-resize;
}

.crop-handle.se,
.crop-handle.corner-br {
  bottom: -5px;
  right: -5px;
  cursor: nwse-resize;
}

.crop-handle.n {
  top: -5px;
  left: calc(50% - 5px);
  cursor: ns-resize;
}

.crop-handle.s {
  bottom: -5px;
  left: calc(50% - 5px);
  cursor: ns-resize;
}

.crop-handle.w {
  left: -5px;
  top: calc(50% - 5px);
  cursor: ew-resize;
}

.crop-handle.e {
  right: -5px;
  top: calc(50% - 5px);
  cursor: ew-resize;
}

.crop-size-badge {
  position: absolute;
  left: 6px;
  bottom: 6px;
  padding: 2px 6px;
  border-radius: 4px;
  background: rgba(12, 16, 24, 0.82);
  color: #e6f0ff;
  font-size: 10px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  pointer-events: none;
  white-space: nowrap;
}

/* ── Inspector Crop & Transition Sections ── */
.inspector-crop-section,
.inspector-transition-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--bg-card) 65%, transparent);
  border: 1px solid var(--border);
}

.inspector-section-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}

.crop-toggle-inline {
  padding: 2px 6px;
  font-size: 10px;
}

.transition-pair-banner {
  padding: 4px 6px;
  border-radius: 5px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  font-size: 11px;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.transition-inspector-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.crop-preset-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.inspector-section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}

.inspector-section-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.inspector-badge {
  padding: 1px 6px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent) 20%, transparent);
  color: var(--accent);
  font-size: 10px;
  font-weight: 600;
}

.crop-preset-row {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.crop-preset-btn {
  flex: 1 1 auto;
  min-width: 40px;
  padding: 3px 6px;
  border-radius: 5px;
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  color: var(--text);
  font-size: 11px;
  cursor: pointer;
  transition: all 0.12s ease;
}

.crop-preset-btn:hover {
  border-color: var(--accent);
}

.crop-preset-btn.active {
  background: color-mix(in srgb, var(--accent) 22%, var(--bg-elevated));
  border-color: var(--accent);
  color: var(--accent);
  font-weight: 600;
}

.crop-num-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
}

.crop-num-field {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 6px;
  border-radius: 5px;
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  font-size: 11px;
  color: var(--text-muted);
}

.crop-num-input {
  width: 100%;
  min-width: 0;
  border: none;
  background: transparent;
  color: var(--text);
  font-size: 11px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  text-align: right;
  outline: none;
}

.crop-num-unit {
  font-size: 10px;
  color: var(--text-muted);
}

/* ── Redesigned NLE Transition Junction Pill & Overlap Zone ── */
.transition-handle {
  position: absolute;
  top: 2px;
  bottom: 2px;
  z-index: 5;
  min-width: 24px;
  padding: 0;
  border: 1px solid rgba(115, 179, 255, 0.55);
  border-radius: 6px;
  background: rgba(24, 42, 68, 0.42);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  overflow: visible;
  transition:
    background-color 0.14s ease,
    border-color 0.14s ease,
    box-shadow 0.14s ease;
}

.transition-handle:hover {
  background: rgba(52, 118, 210, 0.48);
  border-color: #8cc4ff;
  box-shadow: 0 0 10px rgba(76, 154, 255, 0.45);
}

.transition-handle.has-effect,
.transition-handle.active {
  background: linear-gradient(135deg, rgba(64, 140, 255, 0.36) 0%, rgba(138, 92, 246, 0.38) 100%);
  border-color: rgba(154, 196, 255, 0.85);
}

.transition-handle.selected {
  background: linear-gradient(135deg, rgba(76, 154, 255, 0.62) 0%, rgba(148, 102, 255, 0.62) 100%);
  border-color: #fff;
  box-shadow: 0 0 12px rgba(76, 154, 255, 0.78);
}

.transition-overlap-pattern {
  position: absolute;
  inset: 0;
  border-radius: 5px;
  pointer-events: none;
  background-image:
    linear-gradient(
      to top right,
      transparent calc(50% - 1px),
      rgba(115, 179, 255, 0.42) 50%,
      transparent calc(50% + 1px)
    ),
    linear-gradient(
      to bottom right,
      transparent calc(50% - 1px),
      rgba(115, 179, 255, 0.3) 50%,
      transparent calc(50% + 1px)
    );
  opacity: 0.75;
}

.transition-junction-pill {
  position: relative;
  z-index: 2;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  max-width: calc(100% - 4px);
  padding: 2px 5px;
  border-radius: 999px;
  background: rgba(12, 18, 28, 0.88);
  border: 1px solid rgba(150, 198, 255, 0.65);
  color: #eef5ff;
  font-size: 10px;
  line-height: 1;
  white-space: nowrap;
  pointer-events: none;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.35);
}

.transition-bowtie {
  font-size: 11px;
  color: #7cc0ff;
}

.transition-pill-label,
.transition-junction-label {
  font-weight: 600;
  max-width: 72px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.transition-pill-dur {
  color: #a8d1ff;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 9px;
}

.transition-edge-grip,
.transition-zone-edge {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 6px;
  z-index: 3;
  cursor: ew-resize;
}

.transition-edge-grip.left,
.transition-zone-edge.left {
  left: -2px;
}

.transition-edge-grip.right,
.transition-zone-edge.right {
  right: -2px;
}

.transition-edge-grip:hover,
.transition-zone-edge:hover {
  background: rgba(115, 179, 255, 0.55);
}

/* ── Floating Transition Picker Popover & Shared Card Grid ── */
.transition-popover {
  position: absolute;
  z-index: 60;
  width: 332px;
  padding: 10px;
  border-radius: 10px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.65);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.transition-popover-header,
.transition-popover-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  min-width: 0;
}

.transition-popover-title {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
}

.transition-popover-pair {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 11px;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.transition-popover-close {
  border: none;
  background: transparent;
  color: var(--text-muted);
  font-size: 14px;
  cursor: pointer;
  padding: 0 4px;
  flex-shrink: 0;
}

.transition-popover-close:hover {
  color: var(--text);
}

.transition-popover-footer {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-top: 4px;
  border-top: 1px solid var(--border);
}

.transition-duration-row {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.transition-duration-label {
  font-size: 11px;
  color: var(--text-muted);
}

.preset-pill {
  padding: 2px 5px;
  font-size: 10px;
}

.compact-num {
  width: 52px;
  padding: 2px 4px;
  font-size: 11px;
}

.transition-cat-tabs {
  display: flex;
  gap: 4px;
  overflow-x: auto;
  padding-bottom: 2px;
}

.transition-cat-tab {
  flex: 1 0 auto;
  padding: 3px 7px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--bg-card);
  color: var(--text-muted);
  font-size: 10px;
  cursor: pointer;
  transition: all 0.12s ease;
}

.transition-cat-tab:hover {
  color: var(--text);
  border-color: var(--accent);
}

.transition-cat-tab.active {
  background: color-mix(in srgb, var(--accent) 22%, var(--bg-card));
  border-color: var(--accent);
  color: var(--accent);
  font-weight: 600;
}

.transition-card-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
  max-height: 204px;
  overflow-y: auto;
  padding-right: 2px;
}

.transition-card-grid.compact {
  max-height: 168px;
}

.transition-effect-card {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 4px;
  padding: 5px 4px;
  border-radius: 7px;
  border: 1px solid var(--border);
  background: var(--bg-card);
  color: var(--text);
  cursor: pointer;
  transition: all 0.12s ease;
}

.transition-effect-card:hover {
  border-color: var(--accent);
  transform: translateY(-1px);
}

.transition-effect-card.active {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 20%, var(--bg-card));
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 35%, transparent);
}

.trans-card-label {
  font-size: 10px;
  line-height: 1.15;
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}

/* Animated mini preview inside each transition card */
.trans-preview-box {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 32px;
  box-sizing: border-box;
  border-radius: 4px;
  overflow: hidden;
  background: #141923;
  border: 1px solid var(--border);
}

.trans-preview-a,
.trans-preview-b {
  position: absolute;
  inset: 0;
  display: flex;
  padding: 2px 4px;
  font-size: 8px;
  line-height: 1;
  font-weight: 700;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  pointer-events: none;
}

.trans-preview-a {
  align-items: flex-start;
  justify-content: flex-start;
  background: linear-gradient(135deg, #2b4c7e 0%, #1d3557 100%);
  color: #cbd5e1;
}

.trans-preview-b {
  align-items: flex-end;
  justify-content: flex-end;
  background: linear-gradient(135deg, #6b4c9a 0%, #3b82f6 100%);
  color: #f8fafc;
  opacity: 0;
  transition: all 0.45s cubic-bezier(0.22, 1, 0.36, 1);
}

.transition-effect-card .trans-preview-box.effect-none .trans-preview-a {
  clip-path: inset(0 50% 0 0);
}

.transition-effect-card .trans-preview-box.effect-none .trans-preview-b {
  clip-path: inset(0 0 0 50%);
  opacity: 1;
}

:is(.transition-effect-card, .transition-browser-card):hover .trans-preview-b,
:is(.transition-effect-card, .transition-browser-card).active .trans-preview-b {
  opacity: 1;
}

.trans-preview-box.effect-slideleft .trans-preview-b,
.trans-preview-box.effect-smoothleft .trans-preview-b,
.trans-preview-box.effect-hrslice .trans-preview-b {
  transform: translateX(100%);
  opacity: 1;
}
:is(.transition-effect-card, .transition-browser-card):hover
  .trans-preview-box:is(.effect-slideleft, .effect-smoothleft, .effect-hrslice)
  .trans-preview-b,
:is(.transition-effect-card, .transition-browser-card).active
  .trans-preview-box:is(.effect-slideleft, .effect-smoothleft, .effect-hrslice)
  .trans-preview-b {
  transform: translateX(0);
}

.trans-preview-box.effect-slideright .trans-preview-b,
.trans-preview-box.effect-smoothright .trans-preview-b,
.trans-preview-box.effect-hlslice .trans-preview-b {
  transform: translateX(-100%);
  opacity: 1;
}
:is(.transition-effect-card, .transition-browser-card):hover
  .trans-preview-box:is(.effect-slideright, .effect-smoothright, .effect-hlslice)
  .trans-preview-b,
:is(.transition-effect-card, .transition-browser-card).active
  .trans-preview-box:is(.effect-slideright, .effect-smoothright, .effect-hlslice)
  .trans-preview-b {
  transform: translateX(0);
}

.trans-preview-box.effect-slideup .trans-preview-b,
.trans-preview-box.effect-smoothup .trans-preview-b,
.trans-preview-box.effect-vdslice .trans-preview-b {
  transform: translateY(100%);
  opacity: 1;
}
:is(.transition-effect-card, .transition-browser-card):hover
  .trans-preview-box:is(.effect-slideup, .effect-smoothup, .effect-vdslice)
  .trans-preview-b,
:is(.transition-effect-card, .transition-browser-card).active
  .trans-preview-box:is(.effect-slideup, .effect-smoothup, .effect-vdslice)
  .trans-preview-b {
  transform: translateY(0);
}

.trans-preview-box.effect-slidedown .trans-preview-b,
.trans-preview-box.effect-smoothdown .trans-preview-b,
.trans-preview-box.effect-vuslice .trans-preview-b {
  transform: translateY(-100%);
  opacity: 1;
}
:is(.transition-effect-card, .transition-browser-card):hover
  .trans-preview-box:is(.effect-slidedown, .effect-smoothdown, .effect-vuslice)
  .trans-preview-b,
:is(.transition-effect-card, .transition-browser-card).active
  .trans-preview-box:is(.effect-slidedown, .effect-smoothdown, .effect-vuslice)
  .trans-preview-b {
  transform: translateY(0);
}

.trans-preview-box.effect-wipeleft .trans-preview-b,
.trans-preview-box.effect-wipetl .trans-preview-b,
.trans-preview-box.effect-wipebl .trans-preview-b,
.trans-preview-box.effect-diagtl .trans-preview-b {
  clip-path: inset(0 0 0 100%);
  opacity: 1;
}
:is(.transition-effect-card, .transition-browser-card):hover
  .trans-preview-box:is(.effect-wipeleft, .effect-wipetl, .effect-wipebl, .effect-diagtl)
  .trans-preview-b,
:is(.transition-effect-card, .transition-browser-card).active
  .trans-preview-box:is(.effect-wipeleft, .effect-wipetl, .effect-wipebl, .effect-diagtl)
  .trans-preview-b {
  clip-path: inset(0 0 0 0);
}

.trans-preview-box.effect-wiperight .trans-preview-b,
.trans-preview-box.effect-wipetr .trans-preview-b,
.trans-preview-box.effect-wipebr .trans-preview-b,
.trans-preview-box.effect-diagbr .trans-preview-b {
  clip-path: inset(0 100% 0 0);
  opacity: 1;
}
:is(.transition-effect-card, .transition-browser-card):hover
  .trans-preview-box:is(.effect-wiperight, .effect-wipetr, .effect-wipebr, .effect-diagbr)
  .trans-preview-b,
:is(.transition-effect-card, .transition-browser-card).active
  .trans-preview-box:is(.effect-wiperight, .effect-wipetr, .effect-wipebr, .effect-diagbr)
  .trans-preview-b {
  clip-path: inset(0 0 0 0);
}

.trans-preview-box.effect-wipeup .trans-preview-b {
  clip-path: inset(100% 0 0 0);
  opacity: 1;
}
:is(.transition-effect-card, .transition-browser-card):hover
  .trans-preview-box.effect-wipeup
  .trans-preview-b,
:is(.transition-effect-card, .transition-browser-card).active
  .trans-preview-box.effect-wipeup
  .trans-preview-b {
  clip-path: inset(0 0 0 0);
}

.trans-preview-box.effect-wipedown .trans-preview-b {
  clip-path: inset(0 0 100% 0);
  opacity: 1;
}
:is(.transition-effect-card, .transition-browser-card):hover
  .trans-preview-box.effect-wipedown
  .trans-preview-b,
:is(.transition-effect-card, .transition-browser-card).active
  .trans-preview-box.effect-wipedown
  .trans-preview-b {
  clip-path: inset(0 0 0 0);
}

.trans-preview-box.effect-circleopen .trans-preview-b,
.trans-preview-box.effect-radial .trans-preview-b,
.trans-preview-box.effect-rectcrop .trans-preview-b,
.trans-preview-box.effect-horzopen .trans-preview-b,
.trans-preview-box.effect-vertopen .trans-preview-b {
  clip-path: circle(0% at 50% 50%);
  opacity: 1;
}
:is(.transition-effect-card, .transition-browser-card):hover
  .trans-preview-box:is(
    .effect-circleopen,
    .effect-radial,
    .effect-rectcrop,
    .effect-horzopen,
    .effect-vertopen
  )
  .trans-preview-b,
:is(.transition-effect-card, .transition-browser-card).active
  .trans-preview-box:is(
    .effect-circleopen,
    .effect-radial,
    .effect-rectcrop,
    .effect-horzopen,
    .effect-vertopen
  )
  .trans-preview-b {
  clip-path: circle(75% at 50% 50%);
}

.trans-preview-box.effect-zoomin .trans-preview-b,
.trans-preview-box.effect-squeezeh .trans-preview-b,
.trans-preview-box.effect-squeezev .trans-preview-b {
  transform: scale(1.35);
}
:is(.transition-effect-card, .transition-browser-card):hover
  .trans-preview-box:is(.effect-zoomin, .effect-squeezeh, .effect-squeezev)
  .trans-preview-b,
:is(.transition-effect-card, .transition-browser-card).active
  .trans-preview-box:is(.effect-zoomin, .effect-squeezeh, .effect-squeezev)
  .trans-preview-b {
  transform: scale(1);
}

.transition-dur-row {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.transition-dur-slider-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
}

.transition-dur-readout {
  min-width: 40px;
  text-align: right;
  font-size: 11px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  color: var(--accent);
}

.transition-preset-pills {
  display: flex;
  gap: 4px;
}

.transition-preset-pill {
  flex: 1 1 0;
  padding: 3px 4px;
  border-radius: 5px;
  border: 1px solid var(--border);
  background: var(--bg-card);
  color: var(--text-muted);
  font-size: 10px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  cursor: pointer;
}

.transition-preset-pill:hover {
  border-color: var(--accent);
  color: var(--text);
}

.transition-preset-pill.active {
  background: color-mix(in srgb, var(--accent) 22%, var(--bg-card));
  border-color: var(--accent);
  color: var(--accent);
  font-weight: 600;
}

.transition-apply-all-btn {
  width: 100%;
  justify-content: center;
  margin-top: 2px;
}

.playhead {
  position: absolute;
  top: 0;
  bottom: var(--bottom-pad, 32px);
  width: 12px;
  border-left: 2px solid var(--success);
  pointer-events: auto;
  cursor: ew-resize;
  z-index: 12;
  touch-action: none;
}

.playhead-cap {
  position: absolute;
  top: 0;
  left: -7px;
  width: 0;
  height: 0;
  border-style: solid;
  border-width: 8px 6px 0 6px;
  border-color: var(--success) transparent transparent transparent;
}

/* ── 内置矢量贴纸库 & DOTween 动画面板 & 关键帧菱形标记 ── */
.builtin-stickers-details {
  margin-top: 6px;
  border-top: 1px solid var(--border);
  padding-top: 6px;
}

.builtin-stickers-summary {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  font-size: 11px;
  font-weight: 600;
  color: var(--text);
  user-select: none;
  padding: 2px 4px;
}

.builtin-stickers-icon {
  color: var(--accent);
}

.builtin-stickers-hint {
  margin: 4px 4px 6px;
  font-size: 10px;
  color: var(--text-muted);
}

.builtin-stickers-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
  padding: 2px 2px 6px;
}

.builtin-sticker-card {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 6px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--bg-card);
  color: var(--text);
  cursor: grab;
  text-align: left;
  transition:
    border-color 0.15s ease,
    background 0.15s ease;
}

.builtin-sticker-card:hover {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 12%, var(--bg-card));
}

.builtin-sticker-thumb {
  width: 26px;
  height: 26px;
  object-fit: contain;
  flex-shrink: 0;
}

.builtin-sticker-label {
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.overlay-image,
.overlay-video.overlay-sticker-img {
  position: absolute;
  background: transparent;
  object-fit: contain;
  pointer-events: auto;
  cursor: move;
  user-select: none;
}

.overlay-handle-rotate,
.overlay-handle.rotate-top {
  top: -20px;
  left: calc(50% - 7px);
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #ffd43b;
  border: 2px solid #fff;
  cursor: grab;
}

.tween-sub-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px 8px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--bg-card) 75%, transparent);
  border: 1px solid var(--border);
}

.tween-sub-title {
  font-size: 10px;
  font-weight: 600;
  color: var(--accent);
  letter-spacing: 0.02em;
}

.inspector-text-input {
  flex: 1 1 0;
  min-width: 0;
  padding: 3px 6px;
  border-radius: 5px;
  border: 1px solid var(--border);
  background: var(--bg-card);
  color: var(--text);
  font-size: 11px;
}

.inspector-color-input {
  width: 32px;
  height: 22px;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: transparent;
  cursor: pointer;
}

.keyframe-empty-hint {
  margin: 2px 0 0;
  font-size: 10px;
  color: var(--text-muted);
  line-height: 1.4;
}

.keyframe-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 4px;
}

.keyframe-row {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 5px;
  border-radius: 5px;
  border: 1px solid var(--border);
  background: var(--bg-card);
  font-size: 10px;
}

.keyframe-row.active {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 15%, var(--bg-card));
}

.keyframe-jump-btn,
.keyframe-time-pill {
  border: none;
  background: transparent;
  color: var(--accent);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10px;
  font-weight: 600;
  cursor: pointer;
  padding: 0 2px;
}

.keyframe-summary {
  flex: 1 1 auto;
  color: var(--text-muted);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.keyframe-ease-select {
  flex: 1 1 auto;
  min-width: 0;
  padding: 2px 4px;
  font-size: 10px;
  background: var(--bg-input);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 4px;
}

.keyframe-del-btn {
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 12px;
  line-height: 1;
  padding: 0 3px;
}

.keyframe-del-btn:hover {
  color: var(--danger, #ff4757);
}

.clip-tween-badge {
  position: relative;
  z-index: 2;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin-left: 3px;
  padding: 0 4px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--accent) 28%, transparent);
  color: var(--accent);
  font-size: 10px;
  font-weight: 700;
  flex-shrink: 0;
}

.clip-keyframes-bar {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 2px;
  height: 10px;
  pointer-events: none;
  z-index: 3;
}

.clip-keyframe-diamond {
  position: absolute;
  bottom: 1px;
  transform: translateX(-50%);
  border: none;
  background: transparent;
  color: #ffd43b;
  font-size: 9px;
  line-height: 1;
  padding: 0;
  cursor: pointer;
  pointer-events: auto;
  z-index: 3;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.85);
}

.clip-keyframe-diamond.active,
.clip-keyframe-diamond:hover {
  color: #fff;
  transform: translateX(-50%) scale(1.25);
}

/* ── 剪映式左上角六合一导航与创意面板（素材 / 特效 / 转场 / 滤镜 / 调节 / 模板） ── */
.capcut-browser-nav {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 2px;
  padding: 6px 6px 4px;
  background: var(--bg-panel);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.capcut-browser-tab {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  padding: 6px 2px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition:
    color 0.14s ease,
    background-color 0.14s ease,
    border-color 0.14s ease;
}

.capcut-browser-tab:hover {
  color: var(--text);
  background: color-mix(in srgb, var(--text) 6%, transparent);
}

.capcut-browser-tab.active {
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 14%, transparent);
  border-color: color-mix(in srgb, var(--accent) 32%, transparent);
}

.capcut-tab-icon {
  width: 17px;
  height: 17px;
  flex-shrink: 0;
}

.capcut-tab-label {
  font-size: 10px;
  font-weight: 600;
  line-height: 1.1;
  white-space: nowrap;
}

.creative-tab-pane {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px;
  overflow-y: auto;
}

.creative-target-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-radius: 6px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  flex-shrink: 0;
}

.creative-target-label {
  font-size: 10px;
  color: var(--text-muted);
  white-space: nowrap;
}

.creative-target-name {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 11px;
  font-weight: 600;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.creative-action-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  flex-shrink: 0;
}

.xs-btn {
  padding: 3px 7px;
  font-size: 10px;
  border-radius: 5px;
}

.xs-btn.active {
  color: var(--accent);
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 15%, transparent);
}

.creative-duration-pills {
  display: flex;
  gap: 4px;
  margin-left: auto;
}

.creative-cat-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  flex-shrink: 0;
}

.creative-cat-pill {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 3px 8px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--bg-card);
  color: var(--text-muted);
  font-size: 10px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.12s ease;
}

.creative-pill-icon {
  width: 11px;
  height: 11px;
  flex-shrink: 0;
}

.creative-cat-pill:hover {
  color: var(--text);
  border-color: color-mix(in srgb, var(--text) 24%, var(--border));
}

.creative-cat-pill.active {
  color: var(--accent);
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 14%, var(--bg-card));
}

.creative-intensity-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 6px;
  font-size: 10px;
  color: var(--text-muted);
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 6px;
  flex-shrink: 0;
}

.creative-intensity-row input[type='range'] {
  flex: 1 1 auto;
  min-width: 0;
  accent-color: var(--accent);
}

.creative-intensity-val {
  min-width: 32px;
  text-align: right;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  color: var(--text);
}

.creative-card-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 7px;
}

.creative-card {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 5px;
  padding: 5px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--bg-card);
  color: var(--text);
  cursor: pointer;
  text-align: center;
  transition:
    border-color 0.14s ease,
    transform 0.12s ease,
    background-color 0.14s ease;
}

.creative-card:hover {
  border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
  transform: translateY(-1px);
}

.creative-card.active {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 14%, var(--bg-card));
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 45%, transparent);
}

.creative-card-swatch {
  position: relative;
  height: 46px;
  border-radius: 5px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  overflow: hidden;
}

.creative-swatch-icon {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  filter: drop-shadow(0 1px 3px rgba(0, 0, 0, 0.72));
}

.creative-card-badge {
  padding: 2px 5px;
  border-radius: 4px;
  border: 1px solid var(--border);
  background: rgba(9, 13, 22, 0.76);
  color: #f8fafc;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.04em;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

.trans-card-icon {
  position: relative;
  z-index: 2;
  width: 16px;
  height: 16px;
  color: #f8fafc;
  filter: drop-shadow(0 1px 3px rgba(0, 0, 0, 0.85));
  pointer-events: none;
}

.creative-card-title {
  font-size: 11px;
  font-weight: 500;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.transition-browser-card .trans-preview-box {
  width: 100%;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.transition-browser-card .trans-preview-a {
  justify-content: flex-start;
  align-items: flex-start;
  padding: 3px 5px;
  font-size: 8px;
}

.transition-browser-card .trans-preview-b {
  justify-content: flex-end;
  align-items: flex-end;
  padding: 3px 5px;
  font-size: 8px;
}

.transition-browser-card:hover .trans-preview-b,
.transition-browser-card.active .trans-preview-b {
  opacity: 1;
}

/* 调节 (Adjustments) 滑块列表 */
.creative-adjustment-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-bottom: 8px;
}

.creative-adjustment-item {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 6px 8px;
  border-radius: 6px;
  background: var(--bg-card);
  border: 1px solid var(--border);
}

.creative-adjustment-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11px;
}

.creative-adjustment-label {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--text);
  font-weight: 500;
}

.creative-adj-icon {
  width: 13px;
  height: 13px;
  color: var(--accent);
  flex-shrink: 0;
}

.creative-adjustment-val {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10px;
  color: var(--accent);
}

.creative-adjustment-slider {
  width: 100%;
  accent-color: var(--accent);
  cursor: pointer;
}

/* 模板 (Templates) 列表 */
.creative-template-hint {
  font-size: 10px;
  line-height: 1.45;
  color: var(--text-muted);
  padding: 6px 8px;
  border-radius: 6px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  flex-shrink: 0;
}

.creative-template-list {
  display: flex;
  flex-direction: column;
  gap: 9px;
  padding-bottom: 10px;
}

.creative-template-card {
  display: flex;
  flex-direction: column;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--bg-card);
  overflow: hidden;
  transition: border-color 0.14s ease;
}

.creative-template-card:hover {
  border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
}

.creative-template-banner {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 10px 10px;
}

.creative-template-icon-wrap {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 5px;
  border: 1px solid var(--border);
  background: rgba(9, 13, 22, 0.78);
  flex-shrink: 0;
}

.creative-template-icon {
  width: 14px;
  height: 14px;
}

.creative-template-title {
  font-size: 12px;
  font-weight: 700;
  color: #f8fafc;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.65);
}

.creative-template-body {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 8px 10px 10px;
}

.creative-template-desc {
  margin: 0;
  font-size: 10px;
  line-height: 1.45;
  color: var(--text-muted);
}

.creative-template-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.creative-template-tag {
  padding: 2px 6px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--accent) 12%, var(--bg-panel));
  color: var(--text);
  font-size: 9px;
  font-weight: 600;
}

.creative-template-apply-btn {
  width: 100%;
  justify-content: center;
  padding: 5px 10px;
  font-size: 11px;
}

/* 预览舞台实时视觉特效叠加层 */
.stage-visual-overlay-stack {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 4;
  overflow: hidden;
}

.stage-visual-vignette {
  position: absolute;
  inset: 0;
  background: radial-gradient(
    ellipse at center,
    transparent 42%,
    rgba(0, 0, 0, 0.55) 78%,
    rgba(0, 0, 0, 0.92) 100%
  );
}

.stage-visual-bloom {
  position: absolute;
  inset: 0;
  background: radial-gradient(
    circle at 50% 42%,
    rgba(253, 224, 247, 0.45) 0%,
    rgba(251, 113, 133, 0.16) 52%,
    transparent 85%
  );
  mix-blend-mode: screen;
}

.stage-visual-lightleak {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(circle at 86% 18%, rgba(251, 146, 60, 0.62) 0%, transparent 48%),
    radial-gradient(circle at 14% 84%, rgba(244, 63, 94, 0.45) 0%, transparent 46%);
  mix-blend-mode: screen;
}

.stage-visual-neonhalo {
  position: absolute;
  inset: 0;
  box-shadow:
    inset 0 0 28px rgba(34, 211, 238, 0.55),
    inset 0 0 56px rgba(217, 70, 239, 0.38);
}

.stage-visual-dvcam {
  position: absolute;
  inset: 10px;
  pointer-events: none;
}

.stage-visual-dvcam .dv-corner {
  position: absolute;
  width: 16px;
  height: 16px;
  border-color: #f8fafc;
  border-style: solid;
  opacity: 0.78;
}

.stage-visual-dvcam .dv-corner.tl {
  top: 0;
  left: 0;
  border-width: 2px 0 0 2px;
}

.stage-visual-dvcam .dv-corner.tr {
  top: 0;
  right: 0;
  border-width: 2px 2px 0 0;
}

.stage-visual-dvcam .dv-corner.bl {
  bottom: 0;
  left: 0;
  border-width: 0 0 2px 2px;
}

.stage-visual-dvcam .dv-corner.br {
  bottom: 0;
  right: 0;
  border-width: 0 2px 2px 0;
}

.stage-visual-dvcam .dv-rec-badge {
  position: absolute;
  top: 5px;
  left: 8px;
  font-size: 9px;
  font-weight: 700;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  color: #ef4444;
  letter-spacing: 0.06em;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.85);
}

.stage-visual-split-frame {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.stage-visual-split-frame.split-2h {
  background: linear-gradient(
    to bottom,
    transparent calc(50% - 1px),
    rgba(15, 23, 42, 0.92) calc(50% - 1px),
    #38bdf8 50%,
    rgba(15, 23, 42, 0.92) calc(50% + 1px),
    transparent calc(50% + 1px)
  );
}

.stage-visual-split-frame.split-3v {
  background: linear-gradient(
    to right,
    transparent calc(33.33% - 1px),
    #a855f7 33.33%,
    transparent calc(33.33% + 1px),
    transparent calc(66.66% - 1px),
    #a855f7 66.66%,
    transparent calc(66.66% + 1px)
  );
}

.stage-visual-split-frame.split-4grid {
  background:
    linear-gradient(
      to bottom,
      transparent calc(50% - 1px),
      #f472b6 50%,
      transparent calc(50% + 1px)
    ),
    linear-gradient(to right, transparent calc(50% - 1px), #f472b6 50%, transparent calc(50% + 1px));
}

.stage-visual-scanlines {
  position: absolute;
  inset: 0;
  background: repeating-linear-gradient(
    to bottom,
    transparent 0px,
    transparent 2px,
    rgba(0, 0, 0, 0.36) 3px,
    rgba(0, 0, 0, 0.36) 4px
  );
}

.stage-visual-grain {
  position: absolute;
  inset: 0;
  background-image: radial-gradient(rgba(0, 0, 0, 0.35) 1px, transparent 0);
  background-size: 3px 3px;
  mix-blend-mode: overlay;
}

.stage-visual-letterbox {
  position: absolute;
  left: 0;
  right: 0;
  background: #000000;
}

.stage-visual-letterbox.top {
  top: 0;
}

.stage-visual-letterbox.bottom {
  bottom: 0;
}

.stage-fx-svg-defs {
  position: absolute;
  width: 0;
  height: 0;
  pointer-events: none;
  overflow: hidden;
}

.stage-visual-split-clones {
  position: absolute;
  inset: 0;
  display: grid;
  pointer-events: none;
  overflow: hidden;
}

.stage-visual-split-clones.split-2h {
  grid-template-rows: 1fr 1fr;
  grid-template-columns: 1fr;
}

.stage-visual-split-clones.split-3v {
  grid-template-rows: 1fr;
  grid-template-columns: 1fr 1fr 1fr;
}

.stage-visual-split-clones.split-4grid {
  grid-template-rows: 1fr 1fr;
  grid-template-columns: 1fr 1fr;
}

.stage-split-tile-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.stage-visual-soul-ghost {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  mix-blend-mode: screen;
  pointer-events: none;
  will-change: transform, opacity;
}

.stage-visual-strobe {
  position: absolute;
  inset: 0;
  background: radial-gradient(
    circle at 50% 50%,
    #f8fafc 0%,
    color-mix(in srgb, #e0f2fe 85%, transparent) 60%,
    color-mix(in srgb, #38bdf8 45%, transparent) 100%
  );
  mix-blend-mode: screen;
  pointer-events: none;
}

.stage-visual-tiltshift {
  position: absolute;
  inset: 0;
  pointer-events: none;
  mask-image: linear-gradient(
    to bottom,
    #000 0%,
    #000 22%,
    transparent 38%,
    transparent 62%,
    #000 78%,
    #000 100%
  );
  -webkit-mask-image: linear-gradient(
    to bottom,
    #000 0%,
    #000 22%,
    transparent 38%,
    transparent 62%,
    #000 78%,
    #000 100%
  );
  background: color-mix(in srgb, #0f172a 18%, transparent);
}

.stage-visual-sparkle {
  position: absolute;
  inset: 0;
  pointer-events: none;
  mix-blend-mode: screen;
  background-image:
    radial-gradient(circle at 18% 24%, #fef08a 0px, #f59e0b 2px, transparent 9px),
    radial-gradient(circle at 76% 19%, #fef9c3 0px, #fbbf24 2.5px, transparent 11px),
    radial-gradient(circle at 42% 68%, #fef08a 0px, #f59e0b 2px, transparent 10px),
    radial-gradient(circle at 84% 72%, #fef9c3 0px, #fbbf24 3px, transparent 12px),
    radial-gradient(circle at 28% 82%, #fef08a 0px, #f59e0b 1.8px, transparent 8px),
    radial-gradient(circle at 63% 38%, #fef9c3 0px, #fde047 2.2px, transparent 10px);
}

.stage-visual-glitch-slices {
  position: absolute;
  inset: 0;
  pointer-events: none;
  mix-blend-mode: screen;
  background: linear-gradient(
    to bottom,
    transparent 0%,
    transparent 18%,
    color-mix(in srgb, #22d3ee 42%, transparent) 18.5%,
    color-mix(in srgb, #f43f5e 38%, transparent) 21%,
    transparent 21.5%,
    transparent 56%,
    color-mix(in srgb, #f43f5e 45%, transparent) 56.5%,
    color-mix(in srgb, #22d3ee 40%, transparent) 58.5%,
    transparent 59%,
    transparent 81%,
    color-mix(in srgb, #a855f7 36%, transparent) 81.5%,
    transparent 83.5%
  );
}

.clip-creative-badge {
  position: relative;
  z-index: 2;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin-left: 3px;
  padding: 0 4px;
  border-radius: 4px;
  background: color-mix(in srgb, #ec4899 26%, transparent);
  color: #f472b6;
  font-size: 9px;
  font-weight: 700;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  flex-shrink: 0;
}
</style>
