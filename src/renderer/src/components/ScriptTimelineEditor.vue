<template>
  <div
    ref="rootEl"
    class="script-timeline"
  >
    <div
      class="workspace"
      :style="{
        gridTemplateColumns: `${leftPaneWidth}px 5px minmax(280px, 1fr) 5px ${rightPaneWidth}px`
      }"
    >
      <aside class="panel sources-panel">
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
              :disabled="!videoSources.length"
              @click="autoPlaceAll"
            >
              {{ t('script.timeline.autoPlace') }}
            </button>
            <button
              type="button"
              class="ghost-btn"
              :disabled="bgmBusy"
              @click="onGenerateBgm"
            >
              {{ bgmBusy ? '…' : t('script.timeline.generateBgm') }}
            </button>
            <button
              type="button"
              class="ghost-btn"
              :disabled="sfxBusy"
              @click="onGenerateSfx"
            >
              {{ sfxBusy ? '…' : t('script.timeline.generateSfx') }}
            </button>
            <button
              type="button"
              class="ghost-btn"
              @click="openSfxLibrary"
            >
              {{ t('script.timeline.sfxLibrary') }}
            </button>
            <button
              type="button"
              class="ghost-btn"
              :disabled="smartCutBusy"
              @click="onSmartCut"
            >
              {{ smartCutBusy ? '…' : t('script.timeline.smartCut') }}
            </button>
          </div>
        </div>
        <div
          class="source-list"
          :style="{ '--source-card-size': `${sourceGridSize}px` }"
          @contextmenu.prevent="onImportedPanelContextMenu"
        >
          <section
            v-if="inputSources.length"
            class="source-group"
          >
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
              <span
                class="source-thumb"
                :class="sourceThumbClass(src)"
                aria-hidden="true"
              >
                <img
                  v-if="sourceThumbUrls[src.id]"
                  :src="sourceThumbUrls[src.id]"
                  alt=""
                >
                <span
                  v-else-if="sourceMediaKind(src) === 'voice'"
                  class="source-thumb-glyph"
                >{{
                  voiceSourceIcon
                }}</span>
              </span>
              <span class="source-meta">
                <span
                  class="source-name"
                  :title="src.title"
                >{{ src.title }}</span>
                <span class="source-tags">
                  <span class="source-tag">{{ sourceMediaLabel(src) }}</span>
                  <span
                    v-if="src.durationSec"
                    class="source-dur"
                  >{{ formatTime(src.durationSec) }}</span>
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
              <button
                type="button"
                class="folder-head"
                @click="toggleGroupCollapsed(group.id)"
              >
                <span
                  class="folder-chevron"
                  aria-hidden="true"
                >{{
                  collapsedGroupIds.has(group.id) ? '▸' : '▾'
                }}</span>
                <span class="folder-title">{{ group.title }}</span>
                <span class="source-group-count">{{ sourcesInGroup(group.id).length }}</span>
              </button>
              <div
                v-show="!collapsedGroupIds.has(group.id)"
                class="folder-body"
              >
                <div
                  v-for="src in sourcesInGroup(group.id)"
                  :key="`im-${src.id}`"
                  class="source-card origin-imported"
                  draggable="true"
                  @dragstart="onSourceDragStart($event, src)"
                  @dblclick="onSourceActivate(src)"
                >
                  <span
                    class="source-thumb"
                    :class="sourceThumbClass(src)"
                    aria-hidden="true"
                  >
                    <img
                      v-if="sourceThumbUrls[src.id]"
                      :src="sourceThumbUrls[src.id]"
                      alt=""
                    >
                    <span
                      v-else-if="sourceMediaKind(src) === 'voice'"
                      class="source-thumb-glyph"
                    >{{
                      voiceSourceIcon
                    }}</span>
                  </span>
                  <span class="source-meta">
                    <span
                      class="source-name"
                      :title="src.title"
                    >{{ src.title }}</span>
                    <span class="source-tags">
                      <span class="source-tag">{{ sourceMediaLabel(src) }}</span>
                      <span
                        v-if="src.durationSec"
                        class="source-dur"
                      >{{
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
                  v-if="!sourcesInGroup(group.id).length"
                  class="folder-empty"
                >
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
                <span
                  class="source-thumb"
                  :class="sourceThumbClass(src)"
                  aria-hidden="true"
                >
                  <img
                    v-if="sourceThumbUrls[src.id]"
                    :src="sourceThumbUrls[src.id]"
                    alt=""
                  >
                  <span
                    v-else-if="sourceMediaKind(src) === 'voice'"
                    class="source-thumb-glyph"
                  >{{
                    voiceSourceIcon
                  }}</span>
                </span>
                <span class="source-meta">
                  <span
                    class="source-name"
                    :title="src.title"
                  >{{ src.title }}</span>
                  <span class="source-tags">
                    <span class="source-tag imported">{{
                      t('script.timeline.sourceGroup.importedTag')
                    }}</span>
                    <span class="source-tag">{{ sourceMediaLabel(src) }}</span>
                    <span
                      v-if="src.durationSec"
                      class="source-dur"
                    >{{
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
          >
        </div>

        <div
          v-if="sourceCtx"
          class="source-ctx-menu"
          :style="{ left: `${sourceCtx.x}px`, top: `${sourceCtx.y}px` }"
          @pointerdown.stop
        >
          <button
            type="button"
            @click="createImportedGroup"
          >
            {{ t('script.timeline.createGroup') }}
          </button>
          <button
            v-if="sourceCtx.groupId"
            type="button"
            @click="renameImportedGroup"
          >
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
        <div
          ref="previewStageEl"
          class="preview-stage"
        >
          <video
            v-if="previewSrc"
            ref="previewEl"
            class="preview-video"
            :src="previewSrc"
            playsinline
            preload="metadata"
            @ended="onPreviewEnded"
            @timeupdate="onPreviewTimeUpdate"
            @loadedmetadata="onPreviewLoaded"
          />
          <div
            v-else
            class="preview-empty"
          >
            <span
              class="play-glyph"
              aria-hidden="true"
            />
            <p>{{ t('script.timeline.emptyPreview') }}</p>
          </div>
          <div
            ref="previewCanvasEl"
            class="export-frame-overlay"
            :style="previewFrameStyle"
          >
            <span class="export-frame-label">{{ previewFrameRatioLabel }}</span>
            <div
              v-if="exportPlatform.id !== 'custom' && previewFrameRatioKey === 'export'"
              class="export-safe-area"
              :title="t('script.timeline.safeAreaHint')"
              :style="exportSafeAreaStyle"
            />
            <div class="overlay-layer">
              <video
                v-if="activeMainTransitionClip"
                :ref="
                  (el) =>
                    bindTransitionVideo(
                      el as HTMLVideoElement | null,
                      activeMainTransitionClipId
                    )
                "
                class="transition-overlay-video"
                :style="mainTransitionVideoStyle"
                playsinline
                preload="metadata"
              />
              <video
                v-for="clip in previewOverlayClips"
                v-show="isOverlayClipActive(clip)"
                :key="clip.id"
                :ref="(el) => bindOverlayVideo(el as HTMLVideoElement | null, clip.id)"
                class="overlay-video"
                :style="overlayVideoStyle(clip)"
                playsinline
                preload="metadata"
                @pointerdown.stop="onOverlayPointerDown($event, clip)"
              />
              <div
                v-if="selectedOverlayClip"
                class="overlay-selection"
                :style="overlaySelectionStyle(selectedOverlayClip)"
              >
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
          <div
            v-if="activeSubtitleText"
            class="subtitle-overlay"
            :title="t('script.timeline.subtitleResizeHint')"
            :style="{
              fontSize: `${subtitleFontSize}px`,
              bottom: `${Math.max(0, subtitleYOffset)}px`,
              color: subtitleColor
            }"
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
            <span class="time">{{ formatTime(playheadSec) }} / {{ formatTime(totalDuration) }}</span>
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
        <div
          v-if="selectedClip"
          class="inspector-body"
        >
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
              @change="
                onClipStartChange(
                  Number(($event.target as HTMLInputElement).value)
                )
              "
            >
          </label>
          <label class="inspector-field">
            <span>{{ t('script.timeline.durationSec') }}</span>
            <input
              type="number"
              min="0.1"
              step="0.1"
              :value="selectedClip.durationSec"
              @change="
                onClipDurationChange(
                  Number(($event.target as HTMLInputElement).value)
                )
              "
            >
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
                >{{
                  selectedClip.nodeTitle || selectedClip.nodeId
                }}</span>
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
            <div
              v-if="selectedClipNode"
              class="inspector-hint"
            >
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
            <div
              v-else
              class="inspector-hint"
            >
              {{ t('script.timeline.reshootUnavailable') }}
            </div>
            <div class="inspector-section-title">
              {{ t('script.timeline.transition') }}
            </div>
            <label class="inspector-field">
              <span>{{ t('script.timeline.transitionEffect') }}</span>
              <select
                :value="selectedClip.transitionType ?? 'none'"
                @change="
                  onVideoTransitionTypeChange(
                    ($event.target as HTMLSelectElement).value
                  )
                "
              >
                <option value="none">{{ t('script.timeline.transitionNone') }}</option>
                <option value="dissolve">{{ t('script.timeline.transitionDissolve') }}</option>
                <option value="fadeout">{{ t('script.timeline.transitionFadeOut') }}</option>
                <option value="fadein">{{ t('script.timeline.transitionFadeIn') }}</option>
                <option value="flash">{{ t('script.timeline.transitionFlash') }}</option>
                <option value="slideleft">{{ t('script.timeline.transitionSlideLeft') }}</option>
                <option value="slideright">{{ t('script.timeline.transitionSlideRight') }}</option>
                <option value="slideup">{{ t('script.timeline.transitionSlideUp') }}</option>
                <option value="slidedown">{{ t('script.timeline.transitionSlideDown') }}</option>
                <option value="wipeleft">{{ t('script.timeline.transitionWipeLeft') }}</option>
                <option value="wiperight">{{ t('script.timeline.transitionWipeRight') }}</option>
                <option value="wipeup">{{ t('script.timeline.transitionWipeUp') }}</option>
                <option value="wipedown">{{ t('script.timeline.transitionWipeDown') }}</option>
                <option value="circleopen">{{ t('script.timeline.transitionCircleOpen') }}</option>
                <option value="circleclose">{{ t('script.timeline.transitionCircleClose') }}</option>
              </select>
            </label>
            <div class="inspector-hint">
              {{ t('script.timeline.transitionDragHint') }}
            </div>
          </template>
          <template v-if="selectedClip.track === 'subtitle'">
            <label class="inspector-field">
              <span>{{ t('script.timeline.subtitlePlaceholder') }}</span>
              <textarea
                rows="2"
                :value="selectedClip.text || selectedClip.title"
                @change="
                  onSubtitleTextChange(
                    ($event.target as HTMLTextAreaElement).value
                  )
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
              >
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
              >
            </label>
            <label class="inspector-field">
              <span>{{ t('script.timeline.subtitleColor') }}</span>
              <input
                v-model="subtitleColor"
                type="color"
                class="color-input"
                @change="scheduleSave"
              >
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
                >
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
                >
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
                >
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
                >
              </label>
            </div>
            <label class="inspector-field">
              <span>{{ t('script.timeline.overlayOpacity') }}</span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                :value="selectedClip.opacity ?? 1"
                @input="
                  onOverlayFieldChange(
                    'opacity',
                    Number(($event.target as HTMLInputElement).value)
                  )
                "
              >
            </label>
            <label class="inspector-field">
              <span>{{ t('script.timeline.overlayVolume') }}</span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                :value="selectedClip.volume ?? 1"
                @input="
                  onOverlayFieldChange(
                    'volume',
                    Number(($event.target as HTMLInputElement).value)
                  )
                "
              >
            </label>
            <button
              type="button"
              class="ghost-btn inspector-reset"
              @click="resetOverlayTransform"
            >
              {{ t('script.timeline.overlayReset') }}
            </button>
          </template>
          <template v-if="selectedClip.track === 'voice' || selectedClip.track === 'music' || selectedClip.track === 'sfx'">
            <label class="inspector-field">
              <span>{{ t('script.timeline.volume') }}</span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                :value="selectedClip.volume ?? 1"
                @input="
                  onAudioVolumeChange(
                    Number(($event.target as HTMLInputElement).value)
                  )
                "
              >
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
                  onAudioFadeChange(
                    'fadeInSec',
                    Number(($event.target as HTMLInputElement).value)
                  )
                "
              >
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
                  onAudioFadeChange(
                    'fadeOutSec',
                    Number(($event.target as HTMLInputElement).value)
                  )
                "
              >
            </label>
          </template>
        </div>
        <div
          v-else
          class="inspector-body"
        >
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
              >
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
              >
            </label>
          </div>
          <label class="inspector-field">
            <span>{{ t('script.timeline.exportFps') }}</span>
            <select
              v-model.number="exportFps"
              @change="scheduleSave"
            >
              <option
                v-for="fps in EXPORT_FPS_OPTIONS"
                :key="fps"
                :value="fps"
              >
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
            >
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
      :style="{ height: `${timelineHeight}px` }"
    >
      <header ref="timelineBarEl" class="timeline-bar">
        <div
          class="timeline-controls"
          @pointerdown.stop
        >
          <label
            class="ctrl-field"
            :title="t('script.timeline.durationHint')"
          >
            <span>{{ t('script.timeline.duration') }}</span>
            <input
              v-model.number="durationInputSec"
              class="ctrl-input"
              type="number"
              min="1"
              max="3600"
              step="1"
              @change="commitDuration"
            >
            <span class="ctrl-unit">s</span>
          </label>
          <label class="ctrl-field">
            <span>{{ t('script.timeline.rate') }}</span>
            <select
              v-model.number="playbackRate"
              class="ctrl-select"
              @change="onRateChange"
            >
              <option
                v-for="rate in PLAYBACK_RATE_OPTIONS"
                :key="rate"
                :value="rate"
              >
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
            >
            <span class="ctrl-unit">{{ trackHeight }}px</span>
          </label>
          <label class="ctrl-check">
            <input
              v-model="loopPlayback"
              type="checkbox"
              @change="scheduleSave"
            >
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
            :title="t('script.timeline.zoomFit')"
            @click="zoomFit"
          >
            {{ t('script.timeline.zoomFit') }}
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
          <button
            type="button"
            class="ghost-btn"
            :disabled="!canUndo"
            :title="t('script.timeline.undo')"
            @click="undo"
          >
            ↶
          </button>
          <button
            type="button"
            class="ghost-btn"
            :disabled="!canRedo"
            :title="t('script.timeline.redo')"
            @click="redo"
          >
            ↷
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
        </div>
        <GraphToolbarCollapseBtn v-model="timelineCollapsed" />
      </header>

      <div
        v-show="!timelineCollapsed"
        ref="timelineBoardEl"
        class="timeline-board"
        :class="{ scrollable: needsHScroll }"
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
            <div
              class="ruler"
              @pointerdown="onRulerPointerDown"
            >
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
                <span
                  class="eye-icon"
                  :class="{ off: hiddenTracks.has(track.kind) }"
                >👁</span>
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
            <div
              v-show="!collapsedTracks.has(track.kind)"
              class="track-lane"
            >
              <template v-if="track.kind === 'video' && !clipsOn(track.kind).length">
                <div class="lane-empty">
                  <span
                    class="play-glyph sm"
                    aria-hidden="true"
                  />
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
                  <span
                    class="speaker"
                    aria-hidden="true"
                  />
                  <span>{{ t('script.timeline.voiceEmpty') }}</span>
                </div>
              </template>
              <template v-else-if="track.kind === 'subtitle' && !clipsOn(track.kind).length">
                <div class="lane-muted">
                  <span>{{ t('script.timeline.subtitleEmpty') }}</span>
                </div>
                <button
                  type="button"
                  class="create-hint"
                  @click="addBlankSubtitle"
                >
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
                @dblclick.stop="onClipDblClick(clip)"
              >
                <span
                  v-if="isAudioClip(clip)"
                  class="clip-wave"
                  :style="clipWaveStyle(clip)"
                />
                <span
                  class="clip-handle left"
                  @pointerdown.stop="onClipResizeStart($event, clip, 'left')"
                />
                <span
                  v-if="clip.track !== 'video' && clip.track !== 'overlay'"
                  class="clip-title"
                  :class="{ 'on-media': clipHasVisual(clip) }"
                >{{ clipDisplayTitle(clip) }}</span>
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
                  :class="{ active: handle.durationSec > 0 }"
                  :style="transitionHandleStyle(handle)"
                  @pointerdown.stop="onTransitionHandlePointerDown($event, handle)"
                />
              </template>
            </div>
          </div>

          <div
            class="timeline-bottom-pad"
            aria-hidden="true"
          />

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

    <div
      v-if="exportDialogOpen"
      class="export-settings-mask"
      @click.self="closeExportDialog"
    >
      <div
        class="export-settings-panel"
        role="dialog"
        aria-modal="true"
      >
        <div class="export-settings-title">
          {{ t('script.timeline.exportSettings') }}
        </div>
        <label class="inspector-field">
          <span>{{ t('script.timeline.exportPlatform') }}</span>
          <select
            :value="exportPlatformId"
            @change="onExportPlatformChange(($event.target as HTMLSelectElement).value)"
          >
            <option
              v-for="platform in EXPORT_PLATFORMS"
              :key="platform.id"
              :value="platform.id"
            >
              {{ t(`script.timeline.platform.${platform.nameKey}`) }}
              <template v-if="platform.id !== 'custom'">
                — {{ t(`script.timeline.platform.${platform.frame}`) }} {{ platform.width }} × {{ platform.height }}
              </template>
            </option>
          </select>
        </label>
        <div
          v-if="exportPlatform.id !== 'custom'"
          class="export-platform-info"
        >
          <span>
            {{ t('script.timeline.platformSpec', {
              width: exportPlatform.width,
              height: exportPlatform.height,
              fps: exportPlatform.fps,
              bitrate: Math.round(exportPlatform.videoBitrateKbps / 1000)
            }) }}
          </span>
          <span v-if="Number.isFinite(exportPlatform.maxDurationSec)">
            {{ t('script.timeline.platformMaxDuration', { maxSec: Math.round(exportPlatform.maxDurationSec / 60) }) }}
          </span>
          <span
            v-if="exportDurationOverLimit"
            class="export-platform-warning"
          >
            {{ t('script.timeline.platformTooLong', {
              maxSec: Math.round(exportPlatform.maxDurationSec / 60),
              curSec: Math.round(totalDuration)
            }) }}
          </span>
        </div>
        <div
          v-if="exportCompliance.warnings.length"
          class="export-compliance"
        >
          <span
            v-for="warning in exportCompliance.warnings"
            :key="warning"
            class="export-compliance-item"
          >
            ⚠ {{ warning }}
          </span>
        </div>
        <div
          v-else-if="exportPlatform.id !== 'custom'"
          class="export-compliance ok"
        >
          <span>{{ t('script.timeline.exportCheckPass') }}</span>
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
            >
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
            >
          </label>
        </div>
        <label class="inspector-field">
          <span>{{ t('script.timeline.exportFps') }}</span>
          <select v-model.number="exportFps">
            <option
              v-for="fps in EXPORT_FPS_OPTIONS"
              :key="fps"
              :value="fps"
            >
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
          >
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
          >
        </label>
        <template v-if="watermarkEnabled">
          <label class="inspector-field">
            <span>{{ t('script.timeline.watermarkImage') }}</span>
            <span class="watermark-pick-row">
              <button
                type="button"
                class="ghost-btn"
                @click="pickWatermarkImage"
              >
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
              >
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
              >
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
        <div
          v-if="lastExportError"
          class="export-error-box"
        >
          <span class="export-error-title">
            {{ t('script.timeline.exportRetryHint') }}
          </span>
          <code>{{ lastExportError }}</code>
        </div>
        <div class="export-settings-actions">
          <button
            type="button"
            class="ghost-btn"
            @click="closeExportDialog"
          >
            {{ t('common.cancel') }}
          </button>
          <button
            type="button"
            class="export-btn"
            @click="confirmExportDialog"
          >
            {{ t('script.timeline.export') }}
          </button>
        </div>
        <input
          ref="watermarkInputEl"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          hidden
          @change="onWatermarkImagePicked"
        >
      </div>
    </div>

    <div
      v-if="mixerOpen"
      class="export-settings-mask"
      @click.self="closeMixer"
    >
      <div
        class="export-settings-panel mixer-panel"
        role="dialog"
        aria-modal="true"
      >
        <div class="export-settings-title">
          {{ t('script.timeline.mixer') }}
        </div>
        <div class="mixer-section-title">
          {{ t('script.timeline.mixerTrackGains') }}
        </div>
        <label
          v-for="track in audioMixerTracks"
          :key="track.kind"
          class="inspector-field"
        >
          <span>{{ track.label }}</span>
          <span class="mixer-slider-row">
            <input
              type="range"
              min="0"
              max="2"
              step="0.05"
              :value="mixGains[track.kind] ?? 1"
              @input="onMixGainChange(track.kind, Number(($event.target as HTMLInputElement).value))"
            >
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
            >
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
            >
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
            >
            <span class="mixer-value">{{ Math.round(mixTrebleGainDb) }} dB</span>
          </span>
        </label>
        <label class="inspector-field">
          <span>{{ t('script.timeline.mixerCompression') }}</span>
          <input
            type="checkbox"
            :checked="mixCompression"
            @change="onMixCompressionChange(($event.target as HTMLInputElement).checked)"
          >
        </label>
        <div class="export-settings-actions">
          <button
            type="button"
            class="ghost-btn"
            @click="closeMixer"
          >
            {{ t('common.done') }}
          </button>
        </div>
      </div>
    </div>

    <div
      v-if="sfxLibraryOpen"
      class="export-settings-mask"
      @click.self="closeSfxLibrary"
    >
      <div
        class="export-settings-panel sfx-library-panel"
        role="dialog"
        aria-modal="true"
      >
        <div class="export-settings-title">
          {{ t('script.timeline.sfxLibrary') }}
        </div>
        <div class="sfx-library-tabs">
          <button
            v-for="cat in ['all', ...SFX_PRESET_CATEGORIES.map((c) => c.id)]"
            :key="cat"
            type="button"
            class="ghost-btn"
            :class="{ active: sfxLibraryCategory === cat }"
            @click="setSfxLibraryCategory(cat as 'all' | SfxPresetCategory)"
          >
            {{ sfxLibraryCategoryLabels[cat as 'all' | SfxPresetCategory] }}
          </button>
        </div>
        <div class="sfx-preset-grid">
          <div
            v-for="preset in filteredSfxPresets"
            :key="preset.id"
            class="sfx-preset-card"
          >
            <div class="sfx-preset-name">
              {{ localizedText(locale, preset.name) }}
            </div>
            <div class="sfx-preset-prompt">
              {{ localizedText(locale, preset.prompt) }}
            </div>
            <div class="sfx-preset-foot">
              <span
                v-if="preset.durationSec"
                class="sfx-preset-duration"
              >
                ~{{ preset.durationSec }}s
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
        <div
          v-if="projectAudioAssets.length"
          class="sfx-library-assets"
        >
          <div
            v-for="asset in projectAudioAssets"
            :key="asset.id"
            class="sfx-library-asset-row"
          >
            <span
              class="sfx-library-asset-name"
              :title="asset.relativePath"
            >
              {{ asset.name }}
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
        <p
          v-else
          class="sfx-library-empty"
        >
          {{ t('script.timeline.sfxLibraryNoAssets') }}
        </p>
        <div class="export-settings-actions">
          <button
            type="button"
            class="ghost-btn"
            @click="closeSfxLibrary"
          >
            {{ t('common.done') }}
          </button>
        </div>
      </div>
    </div>

    <div
      v-if="subtitleEditor"
      class="subtitle-edit-mask"
      @click.self="cancelSubtitleEdit"
    >
      <div
        class="subtitle-edit-panel"
        role="dialog"
        aria-modal="true"
      >
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
        >
        <div class="subtitle-edit-actions">
          <button
            type="button"
            class="ghost-btn"
            @click="cancelSubtitleEdit"
          >
            {{ t('common.cancel') }}
          </button>
          <button
            type="button"
            class="export-btn"
            @click="commitSubtitleEdit"
          >
            {{ t('common.confirm') }}
          </button>
        </div>
      </div>
    </div>

    <div
      v-if="smartCutDialogOpen"
      class="smart-cut-mask"
      @click.self="smartCutDialogOpen = false"
    >
      <div
        class="smart-cut-panel"
        role="dialog"
        aria-modal="true"
      >
        <div class="smart-cut-title">
          {{ t('script.timeline.smartCutTitle') }}
        </div>
        <p class="smart-cut-subtitle">
          {{ t('script.timeline.smartCutHint') }}
        </p>
        <div class="smart-cut-list">
          <div
            v-for="(edit, i) in smartCutEdits"
            :key="edit.sourceId"
            class="smart-cut-item"
          >
            <span class="smart-cut-index">{{ i + 1 }}</span>
            <div class="smart-cut-item-main">
              <span
                class="smart-cut-item-title"
                :title="edit.title"
              >{{ edit.title }}</span>
              <span
                v-if="edit.nodeTitle"
                class="smart-cut-item-shot"
              >{{ edit.nodeTitle }}</span>
            </div>
            <label class="smart-cut-field">
              <span>{{ t('script.timeline.smartCutDuration') }}</span>
              <input
                v-model.number="edit.durationSec"
                type="number"
                min="0.5"
                max="60"
                step="0.5"
              >
            </label>
            <label class="smart-cut-field">
              <span>{{ t('script.timeline.transitionEffect') }}</span>
              <select v-model="edit.transitionType">
                <option
                  v-for="tr in smartCutTransitions"
                  :key="tr"
                  :value="tr"
                >
                  {{ t(smartCutTransitionLabelKey(tr)) }}
                </option>
              </select>
            </label>
          </div>
        </div>
        <div class="smart-cut-actions">
          <button
            type="button"
            class="ghost-btn"
            @click="smartCutDialogOpen = false"
          >
            {{ t('common.cancel') }}
          </button>
          <button
            type="button"
            class="export-btn"
            @click="applySmartCut"
          >
            {{ t('script.timeline.smartCutApply') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ASSET_TYPE_ICONS, isDraftAssetId, type AssetInfo } from '@shared/domain'
import {
  clampMixEqGainDb,
  clampTrackGain,
  EXPORT_PLATFORMS,
  exportPlatformById,
  exportPlatformSafeRect,
  exportPlatformSubtitleOffset,
  isExportDurationOverLimit,
  isSubtitleWithinSafeArea,
  normalizePlaybackRate,
  normalizeScriptTimelineSource,
  normalizeScriptTimelineSourceGroup,
  readScriptTimelineFromGenParams,
  withScriptTimeline,
  type ScriptTimelineClip,
  type ScriptTimelineDocument,
  type ScriptTimelineSource,
  type ScriptTimelineSourceGroup,
  type ScriptTimelineSourceMediaKind,
  type ScriptTimelineTrackKind,
  type TimelineExportClip,
  type TimelineMixGains,
  applySmartCutPlan,
  buildSmartCutPrompt,
  parseSmartCutPlan,
  SMART_CUT_DEFAULT_TRANSITION_SEC,
  SMART_CUT_TRANSITIONS,
  type SmartCutEdit
} from '@shared/graph'
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
import { promptAlert, promptConfirm, promptText } from '../composables/useStudioPrompt'
import { editorDiveKey } from '../features/graph/model/editorDive'
import { graphEditorHosts } from '../features/graph/model/graphEditorHosts'
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
import { buildSubtitleClipsFromTranscription } from '../features/script/timelineSubtitleFromTranscription'
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
const timelineHeight = ref(336)
const trackHeight = ref(52)
const splitterDrag = ref<{
  pointerId: number
  startY: number
  startHeight: number
} | null>(null)
const leftPaneWidth = ref(220)
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
const subtitleFontSize = ref(36)
const subtitleYOffset = ref(80)
const subtitleColor = ref('#ffffff')
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
const mixerOpen = ref(false)
const subtitleEditor = ref<{ clipId: string | null; draft: string } | null>(null)
const subtitleInputEl = ref<HTMLInputElement | null>(null)
/** 当前可放置高亮的轨道 */
const dragOverTrack = ref<ScriptTimelineTrackKind | null>(null)
/** 轨道片段指针拖拽（自由挪动时间 / 换轨） */
const clipDrag = ref<{
  clipId: string
  pointerId: number
  grabOffsetSec: number
  lastStartSec: number
  moved: boolean
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
} | null>(null)

const transitionDrag = ref<{
  leftId: string
  rightId: string
  pointerId: number
  startClientX: number
  startTransitionSec: number
  startRightStart: number
  moved: boolean
} | null>(null)

const overlayDrag = ref<{
  clipId: string
  pointerId: number
  mode: 'move' | 'scale'
  corner: 'tl' | 'tr' | 'bl' | 'br'
  startX: number
  startY: number
  startLeft: number
  startTop: number
  startWidth: number
  startHeight: number
} | null>(null)

let saveTimer: ReturnType<typeof setTimeout> | null = null
let clipVisualTimer: ReturnType<typeof setTimeout> | null = null
let playSeq = 0
const audioEls = new Map<string, HTMLAudioElement>()
/** 因匿名跨源加载失败而降级为普通加载的音频元素（放弃 Web Audio 混音，改用元素音量） */
const audioCorsFallback = new WeakSet<HTMLAudioElement>()
const overlayEls = new Map<string, HTMLVideoElement>()
const transitionVideoEls = new Map<string, HTMLVideoElement>()

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
const audioMixerTracks = computed(() =>
  tracks.value.filter((track) => track.kind !== 'subtitle')
)

const timelineInnerHeight = computed(
  () =>
    28 +
    tracks.value.reduce(
      (sum, track) =>
        sum + (collapsedTracks.value.has(track.kind) ? 24 : trackHeight.value),
      0
    ) +
    TIMELINE_BOTTOM_PAD
)

/** 时间线面板最小高度：恰好显示到最末一条轨道下方（含头部栏），拖拽缩小到此为止 */
const timelineMinHeight = computed(
  () => (timelineBarEl.value?.offsetHeight ?? 36) + timelineInnerHeight.value
)

watch(timelineMinHeight, (min) => {
  if (timelineHeight.value < min) timelineHeight.value = min
})

function trackTopOffset(kind: ScriptTimelineTrackKind): number {
  let top = 28
  for (const track of tracks.value) {
    if (track.kind === kind) return top
    top += collapsedTracks.value.has(track.kind) ? 24 : trackHeight.value
  }
  return top
}

const inputSources = computed(() =>
  sources.value.filter((s) => (s.origin ?? 'input') === 'input')
)
const importedSources = computed(() =>
  sources.value.filter((s) => s.origin === 'imported')
)
const ungroupedImportedSources = computed(() =>
  importedSources.value.filter((s) => !s.groupId || !sourceGroups.value.some((g) => g.id === s.groupId))
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
  return clip && (clip.track === 'voice' || clip.track === 'music' || clip.track === 'sfx')
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
  const index = list.findIndex(
    (clip) =>
      playheadSec.value >= clip.startSec &&
      playheadSec.value < clip.startSec + clip.durationSec
  )
  const from = index >= 0 ? list[index] : null
  const to = index >= 0 && index + 1 < list.length ? list[index + 1] : null
  if (!from || !to) return null
  if (!(to.transitionInSec && to.transitionInSec > 0)) return null
  const fromEnd = from.startSec + from.durationSec
  if (to.startSec >= fromEnd) return null
  if (
    playheadSec.value < to.startSec ||
    playheadSec.value > fromEnd + 0.12
  ) {
    return null
  }
  return { from, to }
})

const activeMainTransitionClip = computed(
  () => activeMainTransition.value?.to ?? null
)

const activeMainTransitionClipId = computed(
  () => activeMainTransition.value?.to.id ?? ''
)

const mainTransitionVideoStyle = computed(() => {
  const transition = activeMainTransition.value
  if (!transition) return { display: 'none' }
  const duration = Math.max(
    0.05,
    transition.to.transitionInSec ?? 0.5
  )
  const progress = clamp01(
    (playheadSec.value - transition.to.startSec) / duration
  )
  const type = transition.to.transitionType ?? 'dissolve'
  const style: Record<string, string> = {
    display: 'block',
    opacity: '1'
  }
  if (
    type === 'dissolve' ||
    type === 'fade' ||
    type === 'fadeout' ||
    type === 'fadein' ||
    type === 'flash'
  ) {
    style.opacity = `${progress}`
  } else if (type === 'slideleft') {
    style.transform = `translateX(${(1 - progress) * 100}%)`
  } else if (type === 'slideright') {
    style.transform = `translateX(${-(1 - progress) * 100}%)`
  } else if (type === 'slideup') {
    style.transform = `translateY(${(1 - progress) * 100}%)`
  } else if (type === 'slidedown') {
    style.transform = `translateY(${-(1 - progress) * 100}%)`
  } else if (type === 'wipeleft') {
    style.clipPath = `inset(0 ${(1 - progress) * 100}% 0 0)`
  } else if (type === 'wiperight') {
    style.clipPath = `inset(0 0 0 ${(1 - progress) * 100}%)`
  } else if (type === 'wipeup') {
    style.clipPath = `inset(${(1 - progress) * 100}% 0 0 0)`
  } else if (type === 'wipedown') {
    style.clipPath = `inset(0 0 ${(1 - progress) * 100}% 0)`
  } else if (type === 'circleopen') {
    style.clipPath = `circle(${progress * 75}% at 50% 50%)`
  } else if (type === 'circleclose') {
    style.clipPath = `circle(${(1 - progress) * 75}% at 50% 50%)`
  }
  return style
})

const videoTransitionHandles = computed(() => {
  const list = clipsOn('video')
  const handles: Array<{
    left: ScriptTimelineClip
    right: ScriptTimelineClip
    startSec: number
    durationSec: number
  }> = []
  for (let i = 0; i < list.length - 1; i++) {
    const left = list[i]!
    const right = list[i + 1]!
    const rightStart = right.startSec
    const leftEnd = left.startSec + left.durationSec
    if (rightStart >= leftEnd) {
      handles.push({ left, right, startSec: leftEnd, durationSec: 0 })
    } else {
      handles.push({
        left,
        right,
        startSec: rightStart,
        durationSec: Math.max(0, leftEnd - rightStart)
      })
    }
  }
  return handles
})

const previewFrameRatioOptions = computed(() => [
  { key: 'video', label: t('script.timeline.previewFrameRatioVideo'), ratio: null as number | null },
  { key: 'export', label: t('script.timeline.previewFrameRatioExport'), ratio: null as number | null },
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
  if (!clip) return false
  const t = playheadSec.value
  return t > clip.startSec + MIN_CLIP_SEC && t < clip.startSec + clip.durationSec - MIN_CLIP_SEC
})

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

async function moveImportedSourceToGroup(
  e: DragEvent,
  groupId: string | null
): Promise<void> {
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
  const nextGroupId =
    groupId && sourceGroups.value.some((g) => g.id === groupId) ? groupId : null
  if ((src.groupId ?? null) === nextGroupId) return
  sources.value = sources.value.map((s) =>
    s.id === id ? { ...s, groupId: nextGroupId } : s
  )
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
  const title = name.trim() || t('script.timeline.groupNameDefault', {
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
  sourceGroups.value = sourceGroups.value.map((g) =>
    g.id === group.id ? { ...g, title } : g
  )
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

function sourceRelativePath(source: {
  relativePath?: string
  assetId?: string
}): string {
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

function sourceIdentityKey(src: Pick<ScriptTimelineSource, 'id' | 'assetId' | 'relativePath'>): string {
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
  commitClips(clips.value.filter((clip) => {
    const sameSource =
      clip.sourceId === src.id ||
      sourceIdentityKey({
        id: clip.sourceId,
        assetId: clip.assetId,
        relativePath: clip.relativePath
      }) === key
    if (sameSource) removedClipIds.add(clip.id)
    return !sameSource
  }))
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

const activeSubtitleText = computed(() => {
  for (const clip of clipsOn('subtitle')) {
    if (
      playheadSec.value >= clip.startSec &&
      playheadSec.value < clip.startSec + clip.durationSec
    ) {
      return (clip.text || clip.title).trim()
    }
  }
  return ''
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

function commitClips(next: ScriptTimelineClip[]): void {
  if (!historyReady) {
    clips.value = next
    return
  }
  undoStack.value.push(snapshotClips())
  if (undoStack.value.length > HISTORY_LIMIT) undoStack.value.shift()
  redoStack.value = []
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
  selectedClipIds.value = activeClipId.value
    ? new Set([activeClipId.value])
    : new Set()
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
  selectedClipIds.value = activeClipId.value
    ? new Set([activeClipId.value])
    : new Set()
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
    (clip) =>
      clampedStart <
      clip.startSec + Math.max(MIN_CLIP_SEC, clip.durationSec) / 2 - 0.001
  )
  if (insertIndex < 0) insertIndex = others.length

  const prefix = others.slice(0, insertIndex)
  const suffix = others.slice(insertIndex)
  const updatedTrack: ScriptTimelineClip[] = prefix.map((clip) => ({ ...clip }))

  let cursor = prefix.length
    ? prefix[prefix.length - 1]!.startSec + prefix[prefix.length - 1]!.durationSec
    : 0
  const nextStart = Math.max(clampedStart, cursor)
  updatedTrack.push({ ...dragged, startSec: nextStart })
  cursor = nextStart + Math.max(MIN_CLIP_SEC, durationSec)

  for (const other of suffix) {
    const start = cursor
    updatedTrack.push({ ...other, startSec: start })
    cursor = start + Math.max(MIN_CLIP_SEC, other.durationSec)
  }

  const byId = new Map(updatedTrack.map((clip) => [clip.id, clip]))
  return clips.value.map((clip) =>
    clip.track === kind ? byId.get(clip.id) ?? clip : clip
  )
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
  const width = handle.durationSec > 0
    ? Math.max(12, timeToX(handle.durationSec))
    : 12
  return {
    left: `${x - width / 2}px`,
    width: `${width}px`
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

async function generateVideoStrip(clip: ScriptTimelineClip): Promise<string | null> {
  const url = await resolveSrc(clip)
  if (!url) return null
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
    const duration = Number.isFinite(video.duration) && video.duration > 0
      ? video.duration
      : clip.durationSec || 1
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
        (i + 0.5) * (clip.durationSec / frameCount)
      )
      await seekVideoTo(video, target)
      if (video.videoWidth > 0) {
        const scale = Math.max(
          frameWidth / video.videoWidth,
          frameHeight / video.videoHeight
        )
        const dw = video.videoWidth * scale
        const dh = video.videoHeight * scale
        ctx.drawImage(
          video,
          i * frameWidth + (frameWidth - dw) / 2,
          (frameHeight - dh) / 2,
          dw,
          dh
        )
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
  const rect = overlayRect(clip)
  return {
    left: `${rect.left * 100}%`,
    top: `${rect.top * 100}%`,
    width: `${rect.width * 100}%`,
    height: `${rect.height * 100}%`,
    opacity: `${clamp01(clip.opacity ?? 1)}`
  }
}

function overlaySelectionStyle(clip: ScriptTimelineClip): Record<string, string> {
  return overlayVideoStyle(clip)
}

function isOverlayClipActive(clip: ScriptTimelineClip): boolean {
  return (
    playheadSec.value >= clip.startSec &&
    playheadSec.value < clip.startSec + clip.durationSec
  )
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
    s.origin === 'imported' && s.groupId && !groupIds.has(s.groupId)
      ? { ...s, groupId: null }
      : s
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
  subtitleFontSize.value = settings?.subtitleFontSize ?? 36
  subtitleYOffset.value = settings?.subtitleYOffset ?? 80
  subtitleColor.value = settings?.subtitleColor ?? '#ffffff'
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
      subtitleFontSize: subtitleFontSize.value,
      subtitleYOffset: subtitleYOffset.value,
      subtitleColor: subtitleColor.value,
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
      mixCompression: mixCompression.value
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

const watermarkFileName = computed(() =>
  watermarkSrc.value.split(/[\\/]/).pop()?.trim() || ''
)

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
  if (el) el.playbackRate = playbackRate.value
  for (const audio of audioEls.values()) {
    audio.playbackRate = playbackRate.value
  }
  for (const overlay of overlayEls.values()) {
    overlay.playbackRate = playbackRate.value
  }
}

/** 预览区 video 元素的原声（video / overlay 轨），轨道静音用 muted 控制 */
function applyPreviewMuted(track: ScriptTimelineTrackKind = 'video'): void {
  const el = previewEl.value
  if (el) el.muted = mutedTracks.value.has(track)
}

function seekToStart(): void {
  playheadSec.value = 0
  void syncPreviewToPlayhead()
  void syncAudioToPlayhead(playing.value)
}

function zoomFit(): void {
  zoomFactor.value = 1
  const board = timelineBoardEl.value
  if (board) board.scrollLeft = 0
}

function onTimelineWheel(e: WheelEvent): void {
  const board = timelineBoardEl.value
  if (!board) return
  const rect = board.getBoundingClientRect()
  const cursorLaneX = e.clientX - rect.left + board.scrollLeft - TRACK_LABEL_W
  const timeAtCursor = Math.max(0, cursorLaneX / pxPerSec.value)
  const direction = e.deltaY < 0 ? 1 : -1
  const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoomFactor.value * (direction > 0 ? 1.12 : 1 / 1.12)))
  if (Math.abs(next - zoomFactor.value) < 0.001) return
  zoomFactor.value = next
  void nextTick(() => {
    const newX = timeAtCursor * pxPerSec.value
    const viewX = e.clientX - rect.left - TRACK_LABEL_W
    board.scrollLeft = Math.max(0, newX - viewX)
  })
}

async function resolveSrc(source: {
  relativePath?: string
  assetId?: string
}): Promise<string> {
  const rel = sourceRelativePath(source)
  if (!rel) return ''
  try {
    return (await window.studio.getAssetFileUrl(rel)) || ''
  } catch {
    return ''
  }
}

async function probeDuration(src: string, media: 'video' | 'audio' = 'video'): Promise<number> {
  if (!src) return 3
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
/** 一键生成音效：描述 → MiniMax 音乐模型 instrumental 产出 → 落盘 Cache/Sfx → 铺到音效轨。 */
async function onGenerateSfx(): Promise<void> {
  const prompt = await promptText({
    title: t('script.timeline.generateSfx'),
    message: t('script.timeline.generateSfxPrompt'),
    placeholder: t('script.timeline.generateSfxPlaceholder')
  })
  if (!prompt || !prompt.trim()) return
  await generateSfxCore(prompt.trim(), prompt.trim().slice(0, 24))
}

/** 音效生成核心：生成 → 上素材列表 → 铺音效轨；成功返回落盘 source，失败弹错返回 null */
async function generateSfxCore(prompt: string, name?: string): Promise<ScriptTimelineSource | null> {
  sfxBusy.value = true
  try {
    const result = await window.studio.generateMusic({
      prompt,
      instrumental: true,
      outputDir: 'Cache/Sfx'
    })
    const durationSec =
      result.durationMs && result.durationMs > 0
        ? Math.round(result.durationMs / 1000)
        : undefined
    const source: ScriptTimelineSource = {
      id: `sfx:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 7)}`,
      title: name?.trim() || (result.relativePath?.split('/').pop() || 'SFX').replace(/\.[^.]+$/, ''),
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
  for (const meta of SFX_PRESET_CATEGORIES) labels[meta.id] = localizedText(locale.value, meta.label)
  return labels
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
  const prompt = await promptText({
    title: t('script.timeline.generateBgm'),
    message: t('script.timeline.generateBgmPrompt'),
    placeholder: t('script.timeline.generateBgmPlaceholder')
  })
  if (!prompt || !prompt.trim()) return
  bgmBusy.value = true
  try {
    const result = await window.studio.generateMusic({
      prompt: prompt.trim(),
      instrumental: true
    })
    const durationSec =
      result.durationMs && result.durationMs > 0
        ? Math.round(result.durationMs / 1000)
        : undefined
    const source: ScriptTimelineSource = {
      id: `bgm:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 7)}`,
      title: (result.relativePath?.split('/').pop() || 'BGM').replace(/\.[^.]+$/, ''),
      relativePath: result.relativePath,
      assetId: result.assetId,
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

async function reloadSources(): Promise<void> {
  sourcesBusy.value = true
  try {
    const collected = await collectScriptTimelineSources({
      scriptAssetId: props.scriptAssetId,
      hostId: hostId.value
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
      .map(
        (s) =>
          normalizeScriptTimelineSource({
            ...s,
            origin: 'imported',
            mediaKind: s.mediaKind === 'voice' ? 'voice' : 'video'
          })!
      )
      .filter(Boolean)
    sources.value = [...inputNext, ...preservedImported]
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
      startSec == null
        ? nextStartOnTrack(track)
        : fitClipStart(track, startSec, durationSec),
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
    commitClips(clips.value.map((c) =>
      c.id === editor.clipId ? { ...c, text, title: text } : c
    ))
  }
  subtitleEditor.value = null
  scheduleSave()
}

function selectSubtitleAtPlayhead(): void {
  const clip = clipsOn('subtitle').find(
    (item) =>
      playheadSec.value >= item.startSec &&
      playheadSec.value < item.startSec + item.durationSec
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
  const delta = session.startY - e.clientY
  if (session.type === 'scale') {
    subtitleFontSize.value = Math.min(
      200,
      Math.max(12, Math.round(session.startFont + delta / 2))
    )
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
  const volume = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 1
  clips.value = clips.value.map((c) =>
    c.id === clip.id ? { ...c, volume } : c
  )
  scheduleSave()
}

function onAudioFadeChange(field: 'fadeInSec' | 'fadeOutSec', value: number): void {
  const clip = selectedAudioClip.value
  if (!clip) return
  const sec = Number.isFinite(value) ? Math.min(clip.durationSec, Math.max(0, value)) : 0
  commitClips(
    clips.value.map((c) =>
      c.id === clip.id ? { ...c, [field]: sec } : c
    )
  )
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
            opacity: 1,
            volume: 1
          }
        : c
    )
  )
  scheduleSave()
}

function bindOverlayDragListeners(): void {
  window.addEventListener('pointermove', onOverlayPointerMove)
  window.addEventListener('pointerup', onOverlayPointerUp)
  window.addEventListener('pointercancel', onOverlayPointerUp)
}

function unbindOverlayDragListeners(): void {
  window.removeEventListener('pointermove', onOverlayPointerMove)
  window.removeEventListener('pointerup', onOverlayPointerUp)
  window.removeEventListener('pointercancel', onOverlayPointerUp)
}

function onOverlayPointerDown(e: PointerEvent, clip: ScriptTimelineClip): void {
  if (e.button !== 0 || lockedTracks.value.has(clip.track)) return
  selectClip(clip)
  const target = e.target as HTMLElement | null
  const handle = target?.closest('.overlay-handle') as HTMLElement | null
  const corner = (handle?.dataset.corner as 'tl' | 'tr' | 'bl' | 'br' | undefined) ?? 'br'
  const rect = overlayRect(clip)
  unbindOverlayDragListeners()
  overlayDrag.value = {
    clipId: clip.id,
    pointerId: e.pointerId,
    mode: handle ? 'scale' : 'move',
    corner,
    startX: e.clientX,
    startY: e.clientY,
    startLeft: rect.left,
    startTop: rect.top,
    startWidth: rect.width,
    startHeight: rect.height
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

  if (session.mode === 'move') {
    const left = clamp01(session.startLeft + dx)
    const top = clamp01(session.startTop + dy)
    const x = Math.min(left, Math.max(0, 1 - session.startWidth))
    const y = Math.min(top, Math.max(0, 1 - session.startHeight))
    clips.value = clips.value.map((c) =>
      c.id === session.clipId ? { ...c, overlayX: x, overlayY: y } : c
    )
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
  clips.value = clips.value.map((c) =>
    c.id === session.clipId
      ? {
          ...c,
          overlayX: left,
          overlayY: top,
          overlayWidth: width,
          overlayHeight: height
        }
      : c
  )
}

function onOverlayPointerUp(e: PointerEvent): void {
  const session = overlayDrag.value
  if (!session || e.pointerId !== session.pointerId) return
  overlayDrag.value = null
  unbindOverlayDragListeners()
  scheduleSave()
}

function onClipStartChange(value: number): void {
  const clip = selectedClip.value
  if (!clip || lockedTracks.value.has(clip.track)) return
  const startSec = Number.isFinite(value)
    ? Math.min(Math.max(0, totalDuration.value - MIN_CLIP_SEC), Math.max(0, value))
    : clip.startSec
  if (Math.abs(startSec - clip.startSec) < 0.001) return
  commitClips(
    clips.value.map((c) => (c.id === clip.id ? { ...c, startSec } : c))
  )
  scheduleSave()
}

function onClipDurationChange(value: number): void {
  const clip = selectedClip.value
  if (!clip || lockedTracks.value.has(clip.track)) return
  const durationSec = Number.isFinite(value)
    ? Math.max(MIN_CLIP_SEC, Math.min(totalDuration.value - clip.startSec, value))
    : clip.durationSec
  if (Math.abs(durationSec - clip.durationSec) < 0.001) return
  commitClips(
    clips.value.map((c) => (c.id === clip.id ? { ...c, durationSec } : c))
  )
  scheduleSave()
}

function onVideoTransitionTypeChange(value: string): void {
  const clip = selectedClip.value
  if (!clip || clip.track !== 'video' || lockedTracks.value.has(clip.track)) return
  const type = [
    'none',
    'dissolve',
    'fade',
    'fadeout',
    'fadein',
    'flash',
    'slideleft',
    'slideright',
    'slideup',
    'slidedown',
    'wipeleft',
    'wiperight',
    'wipeup',
    'wipedown',
    'circleopen',
    'circleclose'
  ].includes(value)
    ? (value as ScriptTimelineClip['transitionType'])
    : 'none'
  const list = clipsOn('video')
  const index = list.findIndex((item) => item.id === clip.id)
  const previous = index > 0 ? list[index - 1] : null
  const next = index >= 0 && index < list.length - 1 ? list[index + 1] : null
  const ids = new Set([clip.id])
  if (clip.transitionInSec && previous) ids.add(previous.id)
  if (clip.transitionOutSec && next) ids.add(next.id)
  commitClips(
    clips.value.map((c) =>
      ids.has(c.id) ? { ...c, transitionType: type } : c
    )
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
 * 重拍编辑器只在 dive 的 node.reshoot 视图里渲染：
 * 先让宿主节点图进入打开态，再切到该视图。
 */
async function openReshootEditor(nodeId: string): Promise<boolean> {
  if (!diveContext) return false
  const opened = await graphEditorNodeTools.open(hostId.value, 'node.reshoot', nodeId)
  if (!opened) return false
  await diveContext.diveView({ viewId: 'node.reshoot', hostId: hostId.value, nodeId })
  return true
}

/** 找到来源节点下游已有的重拍节点（复用，避免每次重拍都新建一个） */
function findDownstreamReshootNode(nodeId: string): string | null {
  const doc = graphEditorHosts.getDocument(hostId.value)
  if (!doc) return null
  const typeById = new Map(doc.nodes.map((node) => [node.id, node.typeId]))
  const hit = doc.edges.find(
    (edge) => edge.source === nodeId && typeById.get(edge.target) === 'video.reshoot'
  )
  return hit?.target ?? null
}

/**
 * 时间线「重拍此镜头」：
 * - 来源节点本身是重拍节点 → 直接打开重拍编辑器
 * - 其它来源 → 复用下游已有的重拍节点，没有则一键新建并接好上游，再打开重拍编辑器
 * - 宿主不支持建节点时退回节点图并选中来源节点
 */
async function reshootSelectedClip(): Promise<void> {
  const nodeId = selectedClip.value?.nodeId
  if (!nodeId) return
  if (selectedClipNode.value?.typeId === 'video.reshoot') {
    await openReshootEditor(nodeId)
    return
  }
  if (diveContext) {
    const reshootNodeId =
      findDownstreamReshootNode(nodeId) ??
      graphEditorHosts.addNode(hostId.value, {
        typeId: 'video.reshoot',
        title: t('script.timeline.reshootNodeTitle', { shot: selectedClip.value?.title ?? '' }),
        linkFrom: [{ nodeId }]
      })
    if (reshootNodeId) {
      await openReshootEditor(reshootNodeId)
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
    clips.value.map((c) =>
      c.id === clip.id ? { ...c, text, title: text || c.title } : c
    )
  )
  scheduleSave()
}

async function autoPlaceAll(): Promise<void> {
  if (!videoSources.value.length) await reloadSources()
  const videos = videoSources.value
  if (!videos.length) return
  const nextClips = clips.value.filter((c) => c.track !== 'video')
  let cursor = 0
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
      startSec: cursor,
      durationSec
    })
    patchSourceDuration(src.id, durationSec)
    cursor += durationSec
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
  const map: Record<string, string> = {
    none: 'None',
    dissolve: 'Dissolve',
    fade: 'Fade',
    flash: 'Flash',
    slideleft: 'SlideLeft',
    slideright: 'SlideRight',
    wipeleft: 'WipeLeft',
    wiperight: 'WipeRight',
    circleopen: 'CircleOpen'
  }
  return `script.timeline.transition${map[tr] ?? 'None'}`
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
  if (!model) {
    await promptAlert({
      title: t('script.timeline.smartCut'),
      message: t('script.timeline.smartCutNoModel')
    })
    return
  }
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
    const result = await window.studio.generateText({ prompt, providerInstanceId, model })
    const plan = parseSmartCutPlan(result?.text ?? '')
    if (!plan || !plan.edits.length) {
      await promptAlert({
        title: t('script.timeline.smartCut'),
        message: t('script.timeline.smartCutParseFailed')
      })
      return
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
    smartCutDialogOpen.value = true
  } catch (err) {
    await promptAlert({
      title: t('script.timeline.smartCut'),
      message: t('script.timeline.smartCutFailed', {
        error: err instanceof Error ? err.message : String(err)
      })
    })
  } finally {
    smartCutBusy.value = false
  }
}

function applySmartCut(): void {
  const edits: SmartCutEdit[] = smartCutEdits.value.map((e) => ({
    sourceId: e.sourceId,
    durationSec: e.durationSec,
    transitionType: (SMART_CUT_TRANSITIONS as readonly string[]).includes(e.transitionType)
      ? (e.transitionType as SmartCutEdit['transitionType'])
      : undefined,
    transitionSec: e.transitionSec
  }))
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
  const t = playheadSec.value
  if (t <= clip.startSec + MIN_CLIP_SEC || t >= clip.startSec + clip.durationSec - MIN_CLIP_SEC) {
    return
  }
  const first: ScriptTimelineClip = {
    ...clip,
    durationSec: t - clip.startSec
  }
  const second: ScriptTimelineClip = {
    ...clip,
    id: newClipId(),
    startSec: t,
    durationSec: clip.startSec + clip.durationSec - t
  }
  commitClips(clips.value.flatMap((c) => {
    if (c.id !== clip.id) return [c]
    return [first, second]
  }))
  activeClipId.value = second.id
  scheduleSave()
}

function selectClip(clip: ScriptTimelineClip): void {
  activeClipId.value = clip.id
  setSingleClipSelection(clip.id)
  if (clip.track === 'video') void showClipPreview(clip)
}

function seekToClip(clip: ScriptTimelineClip): void {
  playheadSec.value = clip.startSec
  if (clip.track === 'video') void showClipPreview(clip)
}

async function showClipPreview(clip: ScriptTimelineClip): Promise<void> {
  previewSrc.value = await resolveSrc(clip)
  await Promise.resolve()
  const el = previewEl.value
  if (!el) return
  applyPlaybackRate()
  try {
    el.currentTime = 0
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
  if (e.shiftKey || e.ctrlKey || e.metaKey) {
    toggleClipSelection(clip.id)
    activeClipId.value = clip.id
  } else {
    selectClip(clip)
  }
  const rect = laneRectForTrack(clip.track)
  const timeAtPointer = rect ? xToTime(e.clientX - rect.left) : clip.startSec
  // 换轨会重挂载 DOM，监听挂在 window 上以免丢掉拖拽
  unbindClipDragListeners()
  clipDrag.value = {
    clipId: clip.id,
    pointerId: e.pointerId,
    grabOffsetSec: timeAtPointer - clip.startSec,
    lastStartSec: clip.startSec,
    moved: false
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
  if (session.moved) scheduleSave()
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
  selectClip(handle.right)
  const current = handle.right.transitionInSec ?? 0
  unbindTransitionDragListeners()
  transitionDrag.value = {
    leftId: handle.left.id,
    rightId: handle.right.id,
    pointerId: e.pointerId,
    startClientX: e.clientX,
    startTransitionSec: current,
    startRightStart: handle.right.startSec,
    moved: false
  }
  bindTransitionDragListeners()
  e.preventDefault()
}

function onTransitionPointerMove(e: PointerEvent): void {
  const session = transitionDrag.value
  if (!session || e.pointerId !== session.pointerId) return
  const left = clips.value.find((c) => c.id === session.leftId)
  const right = clips.value.find((c) => c.id === session.rightId)
  if (!left || !right) return
  const deltaSec = (e.clientX - session.startClientX) / Math.max(1, pxPerSec.value)
  const maxTransition = Math.min(left.durationSec, right.durationSec)
  const duration = Math.min(
    maxTransition,
    Math.max(0, session.startTransitionSec - deltaSec)
  )
  const transitionType = duration > 0
    ? (right.transitionType ?? 'dissolve')
    : 'none'
  const originalRightStart =
    left.startSec + left.durationSec
  const nextStart = originalRightStart - duration
  session.moved = true
  clips.value = clips.value.map((c) => {
    if (c.id === right.id) {
      return {
        ...c,
        startSec: nextStart,
        transitionInSec: duration,
        transitionType
      }
    }
    if (c.id === left.id) {
      return {
        ...c,
        transitionOutSec: duration,
        transitionType
      }
    }
    return c
  })
}

function onTransitionPointerUp(e: PointerEvent): void {
  const session = transitionDrag.value
  if (!session || e.pointerId !== session.pointerId) return
  transitionDrag.value = null
  unbindTransitionDragListeners()
  if (session.moved) scheduleSave()
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
  clipResize.value = { clipId: clip.id, pointerId: e.pointerId, edge, moved: false }
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
    clips.value = clips.value.map((c) =>
      c.id === clip.id ? { ...c, durationSec } : c
    )
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
  session.moved = true
  clips.value = clips.value.map((c) =>
    c.id === clip.id ? { ...c, startSec, durationSec: nextDuration } : c
  )
}

function onClipResizeUp(e: PointerEvent): void {
  const session = clipResize.value
  if (!session || e.pointerId !== session.pointerId) return
  clipResize.value = null
  unbindClipResizeListeners()
  if (session.moved) scheduleSave()
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
  if (kind === 'video') return asset.type === 'video'
  if (kind === 'overlay') return asset.type === 'video'
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
    e.dataTransfer.dropEffect =
      allowed === 'move' || allowed === 'linkMove' ? 'move' : 'copy'
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
  if (asset.type !== 'video' && asset.type !== 'voice') return null
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
      return type === 'video' || type === 'voice'
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
    const mediaKind: ScriptTimelineSourceMediaKind =
      asset.type === 'voice' ? 'voice' : 'video'
    // 先写入左侧「导入」列表；从轨道删除片段不会移除列表项
    upsertImportedSource(source, mediaKind)
    const listed = sources.value.find((s) => sourceIdentityKey(s) === sourceIdentityKey(source)) ?? {
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
    }
    try {
      payload = JSON.parse(raw)
    } catch {
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
          ...(kind === 'subtitle' && !prev.text
            ? { text: prev.text || prev.title }
            : {})
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
  void syncOverlayVideosToPlayhead(playing.value)
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
  if (target?.closest('.clip, .track-label, .ruler, .playhead, .track-state-btn')) return
  activeClipId.value = null
  selectedClipIds.value = new Set()
}

function onRulerPointerDown(e: PointerEvent): void {
  if (e.button !== 0) return
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
    if (playheadSec.value >= clip.startSec && playheadSec.value < clip.startSec + clip.durationSec) {
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

/** 同步片段音量：clip.volume × 轨道增益 × 淡入淡出（与导出对齐；走 Web Audio 时元素自身音量恒 1） */
function syncClipPreviewGain(clip: ScriptTimelineClip, el: HTMLAudioElement, local: number): void {
  // 轨道静音优先级最高：直接压到 0，忽略片段音量与混音器增益
  const target = mutedTracks.value.has(clip.track)
    ? 0
    : Math.min(
        2,
        (Number.isFinite(clip.volume) ? Math.min(2, Math.max(0, clip.volume!)) : 1) *
          clampTrackGain(mixGains.value[clip.track]) *
          fadeFactorAt(clip, local)
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
    (c) => c.track === 'voice' || c.track === 'music' || c.track === 'overlay' || c.track === 'sfx'
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
    el.playbackRate = playbackRate.value
    syncClipPreviewGain(clip, el, Math.max(0, local))
    if (!inRange) {
      if (!el.paused) el.pause()
      continue
    }
    try {
      if (Math.abs(el.currentTime - Math.max(0, local)) > 0.35) {
        el.currentTime = Math.max(0, local)
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
  const clip = clipAtPlayhead()
  if (!clip) {
    previewSrc.value = ''
    await syncOverlayVideosToPlayhead(playing.value)
    return
  }
  activeClipId.value = clip.id
  const url = await resolveSrc(clip)
  if (previewSrc.value !== url) previewSrc.value = url
  await Promise.resolve()
  const el = previewEl.value
  if (!el) return
  applyPlaybackRate()
  const local = Math.max(0, playheadSec.value - clip.startSec)
  try {
    if (Math.abs(el.currentTime - local) > 0.2) el.currentTime = local
  } catch {
    /* ignore */
  }
  await syncOverlayVideosToPlayhead(false)
}

async function syncOverlayVideosToPlayhead(playingNow: boolean): Promise<void> {
  await nextTick()
  for (const clip of visibleClipsOn('overlay')) {
    const el = overlayEls.get(clip.id)
    if (!el) continue
    const local = playheadSec.value - clip.startSec
    const inRange = local >= -0.05 && local < clip.durationSec
    el.playbackRate = playbackRate.value
    if (!inRange) {
      if (!el.paused) el.pause()
      continue
    }
    if (!el.getAttribute('src')) {
      el.src = await resolveSrc(clip)
    }
    try {
      if (Math.abs(el.currentTime - Math.max(0, local)) > 0.25) {
        el.currentTime = Math.max(0, local)
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
      const inRange = local >= -0.05 && local < transition.to.durationSec
      el.playbackRate = playbackRate.value
      if (!inRange) {
        if (!el.paused) el.pause()
      } else {
        if (!el.getAttribute('src')) {
          el.src = await resolveSrc(transition.to)
        }
        try {
          if (Math.abs(el.currentTime - Math.max(0, local)) > 0.25) {
            el.currentTime = Math.max(0, local)
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

function stopPlayback(): void {
  playing.value = false
  playMode.value = null
  playSeq += 1
  previewEl.value?.pause()
  stopAllAudio()
  pauseOverlayVideos()
}

/** 时间线工具栏：整轨联播（视频序列 + 声音轨） */
async function toggleTimelinePlay(): Promise<void> {
  if (playing.value && playMode.value === 'timeline') {
    stopPlayback()
    return
  }
  stopPlayback()
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
      previewSrc.value = await resolveSrc(clip)
      await Promise.resolve()
      const el = previewEl.value
      if (!el) break
      try {
        applyPlaybackRate()
        applyPreviewMuted(clip.track)
        el.currentTime = 0
        await el.play()
      } catch {
        break
      }
      await waitUntilClipEnd(el, clip, seq, { syncAudio: false })
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
      el.playbackRate = playbackRate.value
      syncClipPreviewGain(clip, el, 0)
      try {
        el.currentTime = 0
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
      if (!playheadDrag.value) {
        playheadSec.value = clip.startSec + (el.currentTime || 0)
      }
      syncClipPreviewGain(clip, el, el.currentTime || 0)
      if (el.ended || el.currentTime >= clip.durationSec - 0.05) {
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
      const clip = list[i]!
      activeClipId.value = clip.id
      let startLocal = localOffset
      if (i > startIndex) {
        const previous = list[i - 1]!
        const previousEnd = previous.startSec + previous.durationSec
        startLocal = Math.min(
          clip.durationSec,
          Math.max(0, previousEnd - clip.startSec)
        )
      }
      const startAt =
        i > startIndex
          ? Math.max(clip.startSec, list[i - 1]!.startSec + list[i - 1]!.durationSec)
          : clip.startSec + startLocal
      playheadSec.value = startAt
      const nextUrl = await resolveSrc(clip)
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
          preloader.currentTime = startLocal
        } catch {
          /* ignore */
        }
      }
      previewSrc.value = nextUrl
      await nextTick()
      const el = previewEl.value
      if (!el) continue
      try {
        applyPlaybackRate()
        el.currentTime = startLocal
        await el.play()
      } catch {
        continue
      }
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

function waitUntilClipEnd(
  el: HTMLVideoElement,
  clip: ScriptTimelineClip,
  seq: number,
  options?: { syncAudio?: boolean }
): Promise<void> {
  const syncAudio = options?.syncAudio !== false
  return new Promise((resolve) => {
    let raf = 0
    const tick = () => {
      if (seq !== playSeq || !playing.value) {
        cleanup()
        resolve()
        return
      }
      playheadSec.value = clip.startSec + (el.currentTime || 0)
      if (syncAudio) void syncAudioToPlayhead(true)
      if (syncAudio) void syncOverlayVideosToPlayhead(true)
      if (el.ended || el.currentTime >= clip.durationSec - 0.05) {
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
  playheadSec.value = clip.startSec + (el.currentTime || 0)
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
        : option?.ratio ?? exportWidth.value / exportHeight.value

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
        volume: c.volume,
        fadeInSec: c.fadeInSec,
        fadeOutSec: c.fadeOutSec,
        overlayX: c.overlayX,
        overlayY: c.overlayY,
        overlayWidth: c.overlayWidth,
        overlayHeight: c.overlayHeight,
        opacity: c.opacity,
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
      subtitleFontSize: subtitleFontSize.value,
      subtitleYOffset: subtitleYOffset.value,
      subtitleColor: subtitleColor.value,
      mixGains: mixGains.value,
      mixMasterGain: mixMasterGain.value,
      mixBassGainDb: mixBassGainDb.value,
      mixTrebleGainDb: mixTrebleGainDb.value,
      mixCompression: mixCompression.value,
      mutedTracks: [...mutedTracks.value],
      watermarkSrc: watermarkEnabled.value && watermarkSrc.value ? watermarkSrc.value : undefined,
      watermarkOpacity: watermarkOpacity.value,
      watermarkScale: watermarkScale.value,
      watermarkPosition: watermarkPosition.value,
      defaultFileName
    })

    const needFallback =
      !result.ok &&
      !result.canceled &&
      /ffmpeg|ENOENT|not found|无法启动/i.test(result.error) // cjk-ok 跨语言错误兜底匹配（须含中英特征词）

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
        await promptAlert({
          title: t('script.timeline.export'),
          message: t('script.timeline.exportDoneFallback', { path: fb.filePath })
        })
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
      rel.split('/').pop()?.replace(/\.[^.]+$/, '') ||
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

function onVerticalSplitterDown(e: PointerEvent): void {
  if (e.button !== 0) return
  splitterDrag.value = {
    pointerId: e.pointerId,
    startY: e.clientY,
    startHeight: timelineHeight.value
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
  const max = Math.max(140, (root?.clientHeight ?? 480) - 120)
  const next = Math.min(
    Math.max(max, timelineMinHeight.value),
    Math.max(timelineMinHeight.value, session.startHeight + (session.startY - e.clientY))
  )
  timelineHeight.value = next
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
  const next = Math.min(max, Math.max(160, session.startWidth + (session.side === 'left' ? delta : -delta)))
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
  if (target?.closest('.source-ctx-menu')) return
  closeSourceCtx()
}

function onTimelineKeydown(e: KeyboardEvent): void {
  if (e.defaultPrevented) return
  const target = e.target as HTMLElement | null
  if (target?.closest('input, textarea, select, [contenteditable="true"]')) return
  if (e.key === ' ') {
    e.preventDefault()
    void toggleTimelinePlay()
    return
  }
  if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault()
    deleteSelectedClips()
    return
  }
  if (!(e.ctrlKey || e.metaKey)) return
  const key = e.key.toLowerCase()
  if (key === 'a') {
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

onMounted(async () => {
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

watch(
  () => props.scriptAssetId,
  async () => {
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
    void refreshClipVisuals()
  }
)

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
      .map(
        (s) =>
          `${s.id}:${s.relativePath ?? ''}:${s.assetId ?? ''}:${s.mediaKind ?? ''}`
      )
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
  unbindTransitionDragListeners()
  window.removeEventListener('pointermove', onVerticalSplitterMove)
  window.removeEventListener('pointerup', onVerticalSplitterUp)
  window.removeEventListener('pointercancel', onVerticalSplitterUp)
  clipDrag.value = null
  clipDragPreview.value = null
  clipResize.value = null
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
  gap: 6px;
  flex-shrink: 0;
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
  padding: 6px 4px;
  font-size: 11px;
  color: var(--text-muted);
}

.ungrouped-zone {
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(var(--source-card-size, 72px), 1fr));
  gap: 6px;
  flex: 1;
  min-height: 64px;
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
  padding: 10px 4px;
  font-size: 11px;
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
  bottom: 52px;
  transform: translateX(-50%);
  max-width: min(90%, 640px);
  padding: 6px 12px;
  border-radius: 6px;
  /* 叠在预览画面上：固定暗底白字，不受亮色主题影响 */
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  font-size: 18px;
  line-height: 1.35;
  text-align: center;
  text-shadow: 0 1px 2px var(--on-media-line-shadow);
  pointer-events: auto;
  cursor: pointer;
  z-index: 2;
  border: 1px dashed rgba(255, 255, 255, 0.75);
}

.subtitle-handle {
  position: absolute;
  width: 14px;
  height: 14px;
  border: 2px solid #fff;
  border-radius: 50%;
  background: var(--accent);
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.45);
}

.subtitle-handle.corner-tl {
  left: -7px;
  top: -7px;
  cursor: nwse-resize;
}

.subtitle-handle.corner-tr {
  right: -7px;
  top: -7px;
  cursor: nesw-resize;
}

.subtitle-handle.corner-bl {
  left: -7px;
  bottom: -7px;
  cursor: nesw-resize;
}

.subtitle-handle.corner-br {
  right: -7px;
  bottom: -7px;
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
  border-color: transparent transparent transparent color-mix(in srgb, var(--text-muted) 70%, transparent);
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
  display: flex;
  flex-direction: column;
  border-top: 1px solid var(--border);
  background: var(--bg-panel);
}

.timeline-bar {
  display: flex;
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

.sfx-library-tabs .ghost-btn.active {
  border-color: #4a90d9;
  color: #4a90d9;
  font-weight: 600;
}

.sfx-preset-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 8px;
  margin-bottom: 10px;
}

.sfx-preset-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px;
  border: 1px solid rgba(127, 127, 127, 0.25);
  border-radius: 8px;
  background: rgba(127, 127, 127, 0.06);
}

.sfx-preset-name {
  font-weight: 600;
  font-size: 13px;
}

.sfx-preset-prompt {
  font-size: 12px;
  opacity: 0.7;
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
  margin-top: 2px;
}

.sfx-preset-duration {
  font-size: 11px;
  opacity: 0.55;
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
  font-size: 12px;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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

.smart-cut-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  overflow-y: auto;
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
  flex: none;
  overflow: hidden;
  background: var(--bg-panel);
}

.timeline-board.scrollable {
  overflow-x: auto;
  overflow-y: hidden;
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
  height: 28px;
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
  transition: opacity 0.12s ease, background-color 0.12s ease;
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

.transition-handle {
  position: absolute;
  top: 0;
  bottom: 0;
  z-index: 4;
  min-width: 8px;
  padding: 0;
  border: none;
  border-left: 1px solid rgba(255, 255, 255, 0.7);
  border-right: 1px solid rgba(255, 255, 255, 0.7);
  border-radius: 4px;
  background: rgba(76, 154, 255, 0.28);
  cursor: ew-resize;
}

.transition-handle.active {
  background: rgba(76, 154, 255, 0.58);
  border-color: #fff;
  box-shadow: 0 0 8px rgba(76, 154, 255, 0.6);
}

.playhead {
  position: absolute;
  top: 0;
  bottom: var(--bottom-pad, 32px);
  width: 12px;
  border-left: 2px solid var(--success);
  pointer-events: auto;
  cursor: ew-resize;
  z-index: 2;
  touch-action: none;
}

.playhead-cap {
  position: absolute;
  top: 0;
  left: -6px;
  width: 0;
  height: 0;
  border-style: solid;
  border-width: 8px 6px 0 6px;
  border-color: var(--success) transparent transparent transparent;
}
</style>
