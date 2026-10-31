<template>
  <div v-if="node" class="dive-novel dive-view">
    <header class="workbench-header">
      <div class="header-left">
        <span class="kind-badge" :title="typeLabel" :aria-label="typeLabel">
          <WorkspaceItemIcon :icon="nodeIcon" :size="15" />
        </span>
        <input
          v-model="displayName"
          type="text"
          class="title-input"
          :placeholder="typeLabel"
          @change="persistTitle"
        />
        <span class="cursor-pill"> Ch.{{ currentChapterCursor }} / {{ totalChapters }} </span>
      </div>

      <div class="header-telemetry">
        <span class="stat-pill stat-chap">
          {{ ui.telemetryChapters }}
        </span>
        <span
          class="stat-pill"
          :class="{
            'stat-ok': currentChapterStats.wordCount >= targetWords,
            'stat-warn':
              currentChapterStats.wordCount > 0 && currentChapterStats.wordCount < targetWords
          }"
        >
          {{ ui.telemetryCurrentWords }}
        </span>
        <span class="stat-pill">
          {{ ui.telemetryTotalWords }}
        </span>
        <span class="stat-pill stat-realm">
          {{ chapterSlice.realmStageLabelZh }}
        </span>
        <span class="stat-pill stat-accent">
          {{ ui.telemetryPowerCeiling }}
        </span>
        <span
          class="stat-pill"
          :class="{
            'stat-ok': chapterAudit.overallScore >= 85 && !chapterAudit.leakedLockedTrumps.length,
            'stat-warn':
              chapterAudit.overallScore > 0 &&
              (chapterAudit.overallScore < 85 || chapterAudit.leakedLockedTrumps.length > 0)
          }"
          style="cursor: pointer"
          @click="rightTab = 'pacing'"
        >
          🩺 {{ ui.telemetryQaScore(chapterAudit.overallScore) }}
        </span>
      </div>

      <div class="header-right">
        <button type="button" class="head-gen-btn" @click="exportFullBookAnthology">
          📦 {{ exportBookFlash ? ui.exportBookDoneBtn : ui.exportBookBtn }}
        </button>
        <button
          v-if="downstreamScreenplayNode"
          type="button"
          class="head-gen-btn head-sp-btn"
          @click="pushAndOpenDownstreamScreenplay"
        >
          🎬 {{ ui.pushToScreenplayBtn }}
        </button>
        <button
          type="button"
          class="head-gen-btn head-sp-btn"
          @click="pushAndOpenDownstreamGameSystem"
        >
          🎮 {{ ui.pushToGameSystemBtn }}
        </button>
        <button
          type="button"
          class="head-gen-btn"
          :disabled="isGraphRunning || runStatus === 'running'"
          @click="triggerGenerateCurrentChapter"
        >
          ⚡ {{ ui.generateCurrentBtn }}
        </button>
        <button
          type="button"
          class="head-gen-btn head-gen-accent"
          :disabled="isGraphRunning || runStatus === 'running'"
          @click="triggerAiNextChapter"
        >
          ✨ {{ ui.aiNextChapterBtn }}
        </button>
        <GraphNodeRunControl
          v-if="hasInPort"
          :status="runStatus"
          :is-running="isGraphRunning"
          :blocked="blocked"
          @toggle="toggleRun"
        />
      </div>
    </header>

    <div class="workbench-body">
      <!-- Left Sidebar: Dynamic Serialization Config + Multi-Chapter Directory + Multi-Chapter Range Merge + Smart Splitter -->
      <aside class="chapter-sidebar">
        <!-- 1. Dynamic Total Chapters & Cursor Controls -->
        <section class="sidebar-group config-group">
          <div class="group-head">
            <h3>{{ ui.serialConfigTitle }}</h3>
            <span class="group-badge">{{ ui.dynamicTotalBadge }}</span>
          </div>

          <div class="genre-selector-block">
            <div class="genre-row-head">
              <span class="field-label">{{ ui.genreSelectorLabel }}</span>
              <button
                type="button"
                class="genre-custom-toggle"
                :class="{ active: customGenreOpen || novelGenre === 'custom_literary' }"
                @click="customGenreOpen = !customGenreOpen"
              >
                ⚙️ {{ ui.genreCustomToggleBtn }}
              </button>
            </div>
            <div class="genre-pills-grid">
              <button
                v-for="g in genreOptions"
                :key="g.id"
                type="button"
                class="genre-pill"
                :class="{ active: novelGenre === g.id }"
                @click="onSelectGenre(g.id)"
              >
                <span>{{ g.icon }}</span>
                <span>{{ g.label }}</span>
              </button>
            </div>
            <div
              v-if="customGenreOpen || novelGenre === 'custom_literary'"
              class="genre-custom-panel"
            >
              <label class="config-field">
                <span class="field-label">{{ ui.customStagesLabel }}</span>
                <input
                  v-model="customStagesText"
                  type="text"
                  class="num-input"
                  :placeholder="ui.customStagesPlaceholder"
                  @change="onCustomGenreOverridesChange"
                />
              </label>
              <div class="config-grid">
                <label class="config-field">
                  <span class="field-label">{{ ui.customAxisProtagonistLabel }}</span>
                  <input
                    v-model="customAxisProtagonist"
                    type="text"
                    class="num-input"
                    :placeholder="activeGenreProfile.protagonistAxisZh"
                    @change="onCustomGenreOverridesChange"
                  />
                </label>
                <label class="config-field">
                  <span class="field-label">{{ ui.customAxisAntagonistLabel }}</span>
                  <input
                    v-model="customAxisAntagonist"
                    type="text"
                    class="num-input"
                    :placeholder="activeGenreProfile.antagonistAxisZh"
                    @change="onCustomGenreOverridesChange"
                  />
                </label>
              </div>
              <div class="genre-custom-foot">
                <input
                  v-model="customUnlockTerm"
                  type="text"
                  class="num-input"
                  :placeholder="ui.customUnlockTermPlaceholder"
                  @change="onCustomGenreOverridesChange"
                />
                <button type="button" class="chap-action-btn" @click="applyGenreTemplateToMemory">
                  {{ ui.seedGenreMemoryBtn }}
                </button>
              </div>
            </div>
          </div>

          <div class="config-grid">
            <label class="config-field">
              <span class="field-label">{{ ui.totalChaptersLabel }}</span>
              <input
                type="number"
                min="1"
                max="5000"
                step="10"
                class="num-input"
                :value="totalChapters"
                @change="onTotalChaptersInput(($event.target as HTMLInputElement).value)"
              />
            </label>
            <label class="config-field">
              <span class="field-label">{{ ui.targetWordsLabel }}</span>
              <input
                type="number"
                min="1000"
                max="15000"
                step="200"
                class="num-input"
                :value="targetWords"
                @change="onTargetWordsInput(($event.target as HTMLInputElement).value)"
              />
            </label>
          </div>

          <div class="quick-scale-row">
            <span class="scale-label">{{ ui.quickScaleLabel }}</span>
            <div class="scale-pills">
              <button
                v-for="presetTotal in [80, 200, 500, 800, 1200]"
                :key="presetTotal"
                type="button"
                class="scale-pill"
                :class="{ active: totalChapters === presetTotal }"
                @click="setTotalChaptersPreset(presetTotal)"
              >
                {{ presetTotal }}
              </button>
            </div>
          </div>

          <div class="cursor-stepper-row">
            <span class="scale-label">{{ ui.targetCursorLabel }}</span>
            <div class="stepper-controls">
              <button
                type="button"
                class="step-btn"
                :disabled="currentChapterCursor <= 1"
                @click="stepChapterCursor(-1)"
              >
                ◀
              </button>
              <input
                type="number"
                min="1"
                :max="totalChapters"
                class="cursor-input"
                :value="currentChapterCursor"
                @change="onCursorInput(($event.target as HTMLInputElement).value)"
              />
              <span class="cursor-sep">/ {{ totalChapters }}</span>
              <button
                type="button"
                class="step-btn"
                :disabled="currentChapterCursor >= totalChapters"
                @click="stepChapterCursor(1)"
              >
                ▶
              </button>
            </div>
          </div>

          <label class="auto-advance-row">
            <input
              type="checkbox"
              :checked="autoAdvanceChapter"
              @change="onAutoAdvanceToggle(($event.target as HTMLInputElement).checked)"
            />
            <span>{{ ui.autoAdvanceLabel }}</span>
          </label>
        </section>

        <!-- 2. Multi-Chapter Directory List + Multi-Chapter Merge Output -->
        <section class="sidebar-group chapters-group">
          <div class="group-head">
            <h3>{{ ui.chapterListTitle }}</h3>
            <span class="group-count">{{
              ui.chapterCountBadge(Math.max(1, generatedTexts.length), totalChapters)
            }}</span>
          </div>

          <div class="chapter-actions-bar">
            <button type="button" class="chap-action-btn" @click="addNewChapter">
              + {{ ui.addChapterBtn }}
            </button>
            <button
              type="button"
              class="chap-action-btn chap-action-accent"
              :disabled="isGraphRunning || runStatus === 'running'"
              @click="triggerAiNextChapter"
            >
              ✨ {{ ui.aiNextChapterBtn }}
            </button>
          </div>

          <div v-if="checkedChapterKeys.length >= 2" class="merge-output-bar">
            <button type="button" class="merge-output-btn" @click="mergeCheckedChaptersToOutput">
              🔗 {{ ui.mergeCheckedBtn(checkedChapterKeys.length) }}
            </button>
            <button type="button" class="merge-clear-btn" @click="checkedChapterKeys = []">
              ×
            </button>
          </div>
          <div v-if="mergedOutputToast" class="merge-toast">
            {{ mergedOutputToast }}
          </div>

          <div v-if="generatedTexts.length > 3" class="chapter-search-wrap">
            <input
              v-model="chapterSearchQuery"
              type="text"
              class="chapter-search-input"
              :placeholder="ui.searchChaptersPlaceholder"
            />
          </div>

          <div v-if="!generatedTexts.length" class="chapter-list">
            <div class="chapter-card active">
              <div class="chap-card-main">
                <div class="chap-card-top">
                  <span class="chap-index">#{{ currentChapterCursor }}</span>
                  <span class="chap-title">{{
                    currentChapterTitle.trim() || ui.defaultChapterTitle(currentChapterCursor)
                  }}</span>
                  <span class="chap-output-badge">{{ ui.activeOutputBadge }}</span>
                </div>
                <p class="chap-snippet">{{ localText.trim() || ui.emptyChapterHint }}</p>
                <div class="chap-meta">
                  <span>{{ ui.wordsCountLabel(currentChapterStats.wordCount) }}</span>
                  <span>·</span>
                  <span>{{ ui.paragraphsCountLabel(currentChapterStats.paragraphCount) }}</span>
                </div>
              </div>
            </div>
          </div>

          <div v-else class="chapter-list">
            <div
              v-for="entry in filteredChapterEntries"
              :key="entry.key"
              class="chapter-card"
              :class="{ active: isSelectedText(entry.key) }"
              :title="ui.setAsOutputHint"
              @click="selectChapter(entry.key, entry.index)"
            >
              <label class="chap-check-wrap" @click.stop>
                <input
                  type="checkbox"
                  :checked="checkedChapterKeys.includes(entry.key)"
                  @change="toggleChapterCheck(entry.key)"
                />
              </label>

              <div class="chap-card-main">
                <div class="chap-card-top">
                  <span class="chap-index">#{{ entry.chapterNumber }}</span>
                  <span class="chap-title">{{ entry.displayTitle }}</span>
                  <span v-if="isSelectedText(entry.key)" class="chap-output-badge">
                    {{ ui.activeOutputBadge }}
                  </span>
                </div>
                <p class="chap-snippet">
                  {{ resolvedGeneratedSnippet[entry.key] || '…' }}
                </p>
                <div class="chap-meta">
                  <span
                    :class="{
                      'meta-ok': entry.stats.wordCount >= targetWords,
                      'meta-warn': entry.stats.wordCount > 0 && entry.stats.wordCount < targetWords
                    }"
                  >
                    {{ ui.wordsCountLabel(entry.stats.wordCount) }}
                  </span>
                  <span>·</span>
                  <span>{{ ui.paragraphsCountLabel(entry.stats.paragraphCount) }}</span>
                  <span>·</span>
                  <span>{{ ui.dialoguesCountLabel(entry.stats.dialogueCount) }}</span>
                </div>
              </div>

              <div class="chap-card-tools" @click.stop>
                <button
                  type="button"
                  class="chap-icon-btn"
                  :disabled="entry.index === 0"
                  :title="ui.moveUpHint"
                  @click="moveChapter(entry.index, -1)"
                >
                  ↑
                </button>
                <button
                  type="button"
                  class="chap-icon-btn"
                  :disabled="entry.index === generatedTexts.length - 1"
                  :title="ui.moveDownHint"
                  @click="moveChapter(entry.index, 1)"
                >
                  ↓
                </button>
                <button
                  type="button"
                  class="chap-icon-btn"
                  :title="ui.duplicateHint"
                  @click="duplicateChapter(entry.index)"
                >
                  ⧉
                </button>
                <PreviewSaveToLibraryButton
                  v-if="canSave(entry.item.relativePath)"
                  compact
                  class="chap-save-btn"
                  :can-save="true"
                  :saved="isSaved(entry.item.relativePath)"
                  :saving="isSaving(entry.item.relativePath)"
                  @save="openSave(entry.item.relativePath!)"
                />
                <button
                  type="button"
                  class="chap-icon-btn chap-delete-btn"
                  :title="ui.deleteHint"
                  @click="removeGeneratedText(entry.item.id)"
                >
                  ×
                </button>
              </div>
            </div>
          </div>
        </section>

        <!-- 3. Smart Multi-Chapter Splitter -->
        <section class="sidebar-group split-group">
          <div class="group-head">
            <h3>{{ ui.splitBoxTitle }}</h3>
          </div>
          <p class="split-desc">{{ ui.splitBoxDesc }}</p>
          <button
            type="button"
            class="split-submit-btn"
            :disabled="!localText.trim()"
            @click="handleSplitChapters"
          >
            {{ splitDoneCount > 0 ? ui.splitDoneToast(splitDoneCount) : ui.splitNowBtn }}
          </button>
        </section>
      </aside>

      <!-- Center Column: Immersive 3000+ Word Chapter Manuscript Editor + Inline Selection Polish Bar -->
      <main class="editor-main">
        <div class="studio-toolbar">
          <input
            v-model="currentChapterTitle"
            type="text"
            class="chapter-title-input"
            :placeholder="ui.chapterTitlePlaceholder(currentChapterCursor)"
            @change="persistChapterTitle"
          />

          <div class="tool-btns">
            <button type="button" class="tool-chip" @click="insertCharacterProfileBlock">
              {{ ui.btnInsertBios }}
            </button>
            <button type="button" class="tool-chip" @click="insertBeatMarker(1)">
              {{ ui.btnBeat1 }}
            </button>
            <button type="button" class="tool-chip" @click="insertBeatMarker(2)">
              {{ ui.btnBeat2 }}
            </button>
            <button type="button" class="tool-chip" @click="insertBeatMarker(3)">
              {{ ui.btnBeat3 }}
            </button>
            <button type="button" class="tool-chip" @click="insertBeatMarker(4)">
              {{ ui.btnBeat4 }}
            </button>
            <button type="button" class="tool-chip tool-chip-accent" @click="formatNovelManuscript">
              {{ formatFlash ? ui.btnFormatDone : ui.btnFormat }}
            </button>
            <button
              type="button"
              class="tool-chip tool-chip-sp"
              :class="{ active: dualScreenplayPreviewOpen }"
              @click="toggleDualScreenplayPreview"
            >
              🎬 {{ ui.btnDualScreenplay }}
            </button>
          </div>
        </div>

        <!-- Chapter Word Quota & 4-Beat Pacing Progress Bar -->
        <div class="chapter-progress-strip">
          <div class="progress-left">
            <span class="progress-title">{{
              ui.progressLabel(currentChapterStats.wordCount, targetWords, wordProgressPct)
            }}</span>
            <div class="progress-bar-track">
              <div
                class="progress-bar-fill"
                :class="{
                  'fill-done': wordProgressPct >= 100,
                  'fill-mid': wordProgressPct >= 50 && wordProgressPct < 100
                }"
                :style="{ width: `${Math.min(100, wordProgressPct)}%` }"
              />
            </div>
          </div>

          <div class="beat-checklist">
            <span
              v-for="beat in beatCheckItems"
              :key="beat.index"
              class="beat-badge"
              :class="{ reached: beat.reached }"
              @click="insertBeatMarker(beat.index)"
            >
              {{ beat.reached ? '✓' : '○' }} {{ beat.label }}
            </span>
          </div>
        </div>

        <!-- Enhancement 5: Inline Text Selection AI Polish & Beat Booster Bar -->
        <div v-if="selectedPassageLength > 0" class="selection-polish-bar">
          <span class="sel-badge"> ✍️ {{ ui.selectionActiveBadge(selectedPassageLength) }} </span>
          <div class="sel-actions">
            <button
              type="button"
              class="sel-btn sel-btn-slap"
              @click="boostSelectedPassage('slap_reaction')"
            >
              🔥 {{ ui.selBoostSlapBtn }}
            </button>
            <button type="button" class="sel-btn" @click="boostSelectedPassage('sensory_expand')">
              🔍 {{ ui.selExpandSensoryBtn }}
            </button>
            <button type="button" class="sel-btn" @click="boostSelectedPassage('fix_power_trumps')">
              🛡️ {{ ui.selFixTrumpsBtn }}
            </button>
            <button
              type="button"
              class="sel-btn sel-btn-hook"
              @click="boostSelectedPassage('cliffhanger_hook')"
            >
              🪝 {{ ui.selRewriteHookBtn }}
            </button>
          </div>
        </div>

        <div class="novel-textarea-wrap" :class="{ 'dual-split': dualScreenplayPreviewOpen }">
          <textarea
            ref="editorTextareaRef"
            v-model="localText"
            class="novel-textarea"
            :placeholder="ui.editorPlaceholder(currentChapterCursor, targetWords)"
            @input="onEditorInput"
            @change="persistNovelBody"
            @select="updateSelectionRange"
            @mouseup="updateSelectionRange"
            @keyup="updateSelectionRange"
          />

          <div v-if="dualScreenplayPreviewOpen" class="screenplay-preview-pane">
            <div class="sp-pane-header">
              <span class="sp-pane-title">🎬 {{ ui.dualSpTitle(currentChapterCursor) }}</span>
              <div class="sp-pane-actions">
                <button
                  type="button"
                  class="sp-mini-btn"
                  @click="refreshScreenplayPreviewFromNovel"
                >
                  🔄 {{ ui.dualSpRefreshBtn }}
                </button>
                <button
                  v-if="downstreamScreenplayNode"
                  type="button"
                  class="sp-mini-btn sp-mini-accent"
                  @click="syncDualPreviewToDownstreamScreenplay"
                >
                  📤 {{ dualSpSyncedFlash ? ui.dualSpSyncedToast : ui.dualSpSyncDownstreamBtn }}
                </button>
              </div>
            </div>
            <textarea
              v-model="screenplayPreviewDraft"
              class="sp-preview-textarea"
              :placeholder="ui.dualSpPlaceholder"
            />
          </div>
        </div>
      </main>

      <!-- Right Sidebar: 3 Tabs (1. Numerical Quota & QA / 2. Arc Outline Plan & Batch Serialize / 3. 4-Tier Memory Pyramid) -->
      <aside class="ai-sidebar">
        <div class="right-tabs">
          <button
            type="button"
            class="right-tab-btn"
            :class="{ active: rightTab === 'pacing' }"
            @click="rightTab = 'pacing'"
          >
            ⚖️ {{ ui.tabPacingAndOutline }}
          </button>
          <button
            type="button"
            class="right-tab-btn"
            :class="{ active: rightTab === 'arcPlan' }"
            @click="rightTab = 'arcPlan'"
          >
            🗺️ {{ ui.tabArcPlan }}
          </button>
          <button
            type="button"
            class="right-tab-btn"
            :class="{ active: rightTab === 'memory' }"
            @click="rightTab = 'memory'"
          >
            🧠 {{ ui.tabMemoryPyramid }}
          </button>
        </div>

        <template v-if="rightTab === 'pacing'">
          <!-- Upstream Economy System Chapter Numerical Quota Slice -->
          <section class="sidebar-group slice-group">
            <div class="group-head">
              <h3>{{ ui.sliceCardTitle(currentChapterCursor, totalChapters) }}</h3>
              <button
                v-if="upstreamEconomyNode"
                type="button"
                class="mini-link-btn"
                @click="openUpstreamEconomyWorkbench"
              >
                ⚖️ {{ ui.openEconomyBtn }}
              </button>
            </div>

            <div class="slice-volume-banner">
              <div class="vol-title">{{ chapterSlice.volumeTitleZh }}</div>
              <div class="arc-sub">
                {{
                  ui.arcRangeLabel(
                    chapterSlice.arcIndex,
                    chapterSlice.totalArcs,
                    chapterSlice.arcChapterRange[0],
                    chapterSlice.arcChapterRange[1]
                  )
                }}
              </div>
            </div>

            <div class="slice-beat-box" :class="`beat-${chapterSlice.chapterBeatType}`">
              <span class="beat-tag">{{ ui.beatTagLabel }}</span>
              <p class="beat-desc">{{ chapterSlice.chapterBeatLabelZh }}</p>
            </div>

            <div class="slice-kpi-grid">
              <div class="slice-kpi">
                <span class="kpi-label">{{ ui.kpiRealmLabel }}</span>
                <span class="kpi-val">{{ chapterSlice.realmStageLabelZh }}</span>
              </div>
              <div class="slice-kpi">
                <span class="kpi-label">{{ ui.kpiPowerLabel }}</span>
                <span class="kpi-val kpi-accent">
                  {{ chapterSlice.powerCeiling }} vs {{ chapterSlice.villainPressure }}
                </span>
              </div>
              <div class="slice-kpi">
                <span class="kpi-label">{{ ui.kpiStatsLabel }}</span>
                <span class="kpi-val">
                  ATK {{ chapterSlice.protagonistAtk }} / HP {{ chapterSlice.protagonistHp }}
                </span>
              </div>
              <div class="slice-kpi">
                <span class="kpi-label">{{ ui.kpiWallLabel }}</span>
                <span
                  class="kpi-val"
                  :class="{
                    'kpi-danger': chapterSlice.isBossArc || chapterSlice.isDifficultyWallArc
                  }"
                >
                  {{
                    chapterSlice.isBossArc
                      ? ui.wallBossLabel
                      : chapterSlice.isDifficultyWallArc
                        ? ui.wallDifficultyLabel
                        : ui.wallNormalLabel
                  }}
                </span>
              </div>
            </div>

            <div class="trump-quota-box">
              <div class="quota-row">
                <span class="quota-badge allowed">✅ {{ ui.allowedTrumpsLabel }}</span>
                <span class="quota-items">{{
                  chapterSlice.allowedTrumpCards.join(' · ') || '—'
                }}</span>
              </div>
              <div v-if="chapterSlice.lockedEndgameTrumps.length" class="quota-row">
                <span class="quota-badge locked">🔒 {{ ui.lockedTrumpsLabel }}</span>
                <span class="quota-items locked-text">{{
                  chapterSlice.lockedEndgameTrumps.join(' · ')
                }}</span>
              </div>
              <div class="quota-row">
                <span class="quota-badge encounter">🎁 {{ ui.recommendedItemLabel }}</span>
                <span class="quota-items">{{ chapterSlice.recommendedEncounterItem }}</span>
              </div>
            </div>

            <button
              type="button"
              class="inject-slice-btn"
              @click="injectNumericalSliceIntoInstruction"
            >
              📋 {{ ui.injectSliceBtn }}
            </button>
          </section>

          <!-- Enhancement 3: Chapter Continuity & Power-Creep QA Doctor Card -->
          <section class="sidebar-group qa-group">
            <div class="group-head">
              <h3>🩺 {{ ui.qaCardTitle }}</h3>
              <span
                class="group-badge"
                :class="{
                  'qa-badge-ok':
                    chapterAudit.overallScore >= 85 && !chapterAudit.leakedLockedTrumps.length,
                  'qa-badge-warn':
                    chapterAudit.overallScore > 0 &&
                    (chapterAudit.overallScore < 85 || chapterAudit.leakedLockedTrumps.length > 0)
                }"
              >
                {{ ui.qaScoreBadge(chapterAudit.overallScore) }}
              </span>
            </div>

            <ul class="qa-list">
              <li
                v-for="(issue, idx) in chapterAudit.issuesZh"
                :key="`issue-${idx}`"
                class="qa-item qa-issue"
              >
                {{ issue }}
              </li>
              <li
                v-for="(sug, idx) in chapterAudit.suggestionsZh"
                :key="`sug-${idx}`"
                class="qa-item qa-sug"
              >
                {{ sug }}
              </li>
            </ul>

            <button
              v-if="chapterAudit.leakedLockedTrumps.length > 0"
              type="button"
              class="fix-leaked-btn"
              @click="fixLeakedLockedTrumpsInPlace"
            >
              🔧 {{ ui.fixLeakedTrumpsBtn(chapterAudit.leakedLockedTrumps.length) }}
            </button>

            <button
              v-if="chapterAudit.revivedEliminatedCharacters?.length"
              type="button"
              class="fix-leaked-btn"
              @click="fixRevivedCharactersInPlace"
            >
              💀 {{ ui.fixRevivedCharsBtn(chapterAudit.revivedEliminatedCharacters.length) }}
            </button>
          </section>

          <!-- AI Model Selection -->
          <section class="sidebar-group">
            <div class="group-head">
              <h3>{{ ui.modelSectionTitle }}</h3>
            </div>
            <InstructionModelSelect
              v-if="modelOptions.length > 0"
              v-model="selectedModelKey"
              :options="modelOptions"
              :title="t('graph.inspector.generate.model')"
              :empty-label="t('graph.inspector.generate.noModels')"
              @change="persistGenerateConfig"
            />
            <p v-else class="hint">{{ t('graph.inspector.generate.noModels') }}</p>
          </section>

          <!-- Chapter Plot Instruction & Quick Presets -->
          <section class="sidebar-group ai-assistant-group">
            <div class="group-head">
              <h3>{{ ui.chapterOutlineTitle(currentChapterCursor) }}</h3>
            </div>
            <div class="ai-presets">
              <button
                v-for="preset in novelAiPresets"
                :key="preset.key"
                type="button"
                class="preset-chip"
                @click="applyNovelAiPreset(preset.prompt)"
              >
                {{ preset.label }}
              </button>
            </div>
            <ExpandableTextarea
              :key="`${node.id}-dive-novel-inst`"
              v-model="instruction"
              :title="ui.chapterOutlineTitle(currentChapterCursor)"
              :rows="5"
              :placeholder="ui.instructionPlaceholder"
              @change="persistGenerateConfig"
            />
          </section>

          <section class="sidebar-group">
            <details class="sys-prompt-details">
              <summary>{{ ui.systemPromptToggle }}</summary>
              <div class="sys-prompt-body">
                <ExpandableTextarea
                  :key="`${node.id}-dive-novel-sys`"
                  v-model="systemPrompt"
                  :title="t('graph.inspector.generate.systemPrompt')"
                  :rows="5"
                  :placeholder="t('graph.inspector.generate.systemPromptPlaceholder')"
                  @change="persistGenerateConfig"
                />
              </div>
            </details>
          </section>
        </template>

        <!-- Enhancement 2: Arc Multi-Chapter Outline Planner & Batch Auto-Serializer -->
        <template v-else-if="rightTab === 'arcPlan'">
          <section class="sidebar-group batch-serial-group">
            <div class="group-head">
              <h3>🚀 {{ ui.batchSerialTitle }}</h3>
              <span class="group-badge">{{
                batchRunning ? ui.batchRunningBadge(batchRemainingCount) : ui.batchReadyBadge
              }}</span>
            </div>
            <p class="mem-hint">{{ ui.batchSerialDesc }}</p>

            <div class="batch-controls-row">
              <div class="scale-pills">
                <button
                  v-for="cnt in [2, 3, 5]"
                  :key="cnt"
                  type="button"
                  class="scale-pill"
                  :class="{ active: batchChapterCount === cnt }"
                  @click="batchChapterCount = cnt"
                >
                  {{ ui.batchCountPill(cnt) }}
                </button>
              </div>
              <button
                v-if="!batchRunning"
                type="button"
                class="batch-start-btn"
                :disabled="isGraphRunning || runStatus === 'running'"
                @click="startBatchAutoSerialize"
              >
                🚀 {{ ui.startBatchBtn(batchChapterCount) }}
              </button>
              <button v-else type="button" class="batch-stop-btn" @click="stopBatchAutoSerialize">
                ⏹ {{ ui.stopBatchBtn }}
              </button>
            </div>
          </section>

          <!-- Visual Arc Power Envelope & Beat ECG SVG Curve -->
          <section class="sidebar-group arc-svg-group">
            <div class="group-head">
              <h3>📈 {{ ui.arcSvgTitle }}</h3>
              <span class="group-count">{{ ui.arcSvgLegend }}</span>
            </div>
            <svg class="arc-ecg-svg" viewBox="0 0 300 112" preserveAspectRatio="none">
              <!-- Grid baselines -->
              <line
                x1="16"
                y1="22"
                x2="284"
                y2="22"
                stroke="rgba(148,163,184,0.14)"
                stroke-dasharray="3 3"
              />
              <line
                x1="16"
                y1="54"
                x2="284"
                y2="54"
                stroke="rgba(148,163,184,0.14)"
                stroke-dasharray="3 3"
              />
              <line x1="16" y1="86" x2="284" y2="86" stroke="rgba(148,163,184,0.2)" />

              <!-- Beat intensity vertical bars -->
              <rect
                v-for="pt in arcPacingSvg.points"
                :key="`bar-${pt.chapter}`"
                :x="pt.x - 7"
                :y="86 - pt.beatBarH"
                width="14"
                :height="pt.beatBarH"
                rx="3"
                :fill="pt.beatColor"
                opacity="0.28"
              />

              <!-- Villain Pressure Polyline -->
              <polyline
                :points="arcPacingSvg.villainPolyline"
                fill="none"
                stroke="#f97316"
                stroke-width="1.8"
                stroke-dasharray="3 2"
              />

              <!-- Protagonist Power Ceiling Polyline -->
              <polyline
                :points="arcPacingSvg.powerPolyline"
                fill="none"
                stroke="#38bdf8"
                stroke-width="2.2"
              />

              <!-- Interactive Chapter Nodes -->
              <g
                v-for="pt in arcPacingSvg.points"
                :key="`node-${pt.chapter}`"
                class="svg-chap-node"
                @click="jumpToArcPlanChapter(pt.chapter)"
              >
                <circle
                  :cx="pt.x"
                  :cy="pt.powerY"
                  :r="pt.chapter === currentChapterCursor ? 5.2 : 3.4"
                  :fill="pt.chapter === currentChapterCursor ? '#f43f5e' : '#38bdf8'"
                  stroke="#0f172a"
                  stroke-width="1.4"
                />
                <text
                  :x="pt.x"
                  y="102"
                  text-anchor="middle"
                  font-size="8.5"
                  :fill="pt.chapter === currentChapterCursor ? '#f8fafc' : '#94a3b8'"
                  :font-weight="pt.chapter === currentChapterCursor ? '700' : '500'"
                >
                  C{{ pt.chapter }}
                </text>
              </g>
            </svg>
          </section>

          <section class="sidebar-group arc-plan-group">
            <div class="group-head">
              <h3>🗺️ {{ ui.arcPlanTableTitle }}</h3>
              <span class="group-count">{{ arcOutlinePlan.length }} Chaps</span>
            </div>
            <p class="mem-hint">{{ ui.arcPlanTableHint }}</p>

            <div class="arc-plan-list">
              <div
                v-for="planItem in arcOutlinePlan"
                :key="planItem.chapter"
                class="arc-plan-card"
                :class="{ active: planItem.chapter === currentChapterCursor }"
              >
                <div class="plan-card-head">
                  <span class="plan-chap-no">Ch.{{ planItem.chapter }}</span>
                  <span class="plan-beat-badge" :class="`beat-${planItem.beatType}`">
                    {{ isEn ? planItem.beatBadgeEn : planItem.beatBadgeZh }}
                  </span>
                  <span class="plan-power"> Cap {{ planItem.powerCeiling }} </span>
                </div>
                <div class="plan-title">
                  {{ isEn ? planItem.titleEn : planItem.titleZh }}
                </div>
                <p class="plan-conflict">{{ planItem.coreConflictZh }}</p>
                <p class="plan-hook">🪝 {{ planItem.cliffhangerHookZh }}</p>
                <div class="plan-actions">
                  <button type="button" class="plan-btn" @click="applyArcPlanItem(planItem, false)">
                    ✍️ {{ ui.useOutlineBtn }}
                  </button>
                  <button
                    type="button"
                    class="plan-btn plan-btn-run"
                    :disabled="isGraphRunning || runStatus === 'running'"
                    @click="applyArcPlanItem(planItem, true)"
                  >
                    ⚡ {{ ui.runOutlineNowBtn(planItem.chapter) }}
                  </button>
                </div>
              </div>
            </div>
          </section>
        </template>

        <template v-else>
          <!-- 4-Tier Memory Pyramid (L1 World Bible / L2 State Ledger / L3 Rolling Summary / L4 Prev Tail Anchor) -->
          <section class="sidebar-group memory-group">
            <div class="group-head">
              <h3>🏛️ {{ ui.l1Title }}</h3>
              <button type="button" class="mini-link-btn" @click="seedWorldBibleFromSlice">
                ⚡ {{ ui.seedFromSliceBtn }}
              </button>
            </div>
            <p class="mem-hint">{{ ui.l1Hint }}</p>
            <ExpandableTextarea
              :key="`${node.id}-novel-l1`"
              v-model="worldBible"
              :title="ui.l1Title"
              :rows="4"
              :placeholder="ui.l1Placeholder"
              @change="persistMemoryFields"
            />
          </section>

          <section class="sidebar-group memory-group">
            <div class="group-head">
              <h3>📊 {{ ui.l2Title }}</h3>
              <button type="button" class="mini-link-btn" @click="refreshStateLedgerFromCurrent">
                🔄 {{ ui.refreshLedgerBtn }}
              </button>
            </div>
            <p class="mem-hint">{{ ui.l2Hint }}</p>
            <ExpandableTextarea
              :key="`${node.id}-novel-l2`"
              v-model="stateLedger"
              :title="ui.l2Title"
              :rows="5"
              :placeholder="ui.l2Placeholder"
              @change="persistMemoryFields"
            />
          </section>

          <section class="sidebar-group memory-group">
            <div class="group-head">
              <h3>📜 {{ ui.l3Title }}</h3>
            </div>
            <p class="mem-hint">{{ ui.l3Hint }}</p>
            <ExpandableTextarea
              :key="`${node.id}-novel-l3`"
              v-model="rollingSummary"
              :title="ui.l3Title"
              :rows="5"
              :placeholder="ui.l3Placeholder"
              @change="persistMemoryFields"
            />
          </section>

          <section class="sidebar-group memory-group">
            <div class="group-head">
              <h3>🔗 {{ ui.l4Title(Math.max(1, currentChapterCursor - 1)) }}</h3>
              <button
                type="button"
                class="mini-link-btn"
                @click="syncPrevTailAnchorFromPreviousChapter"
              >
                🔄 {{ ui.extractTailBtn }}
              </button>
            </div>
            <p class="mem-hint">{{ ui.l4Hint }}</p>
            <pre class="tail-anchor-preview">{{ activePrevTailAnchor || ui.l4EmptyHint }}</pre>
          </section>

          <!-- Enhancement: Character Status & Grudge Roster -->
          <section class="sidebar-group memory-group">
            <div class="group-head">
              <h3>👥 {{ ui.rosterSectionTitle }}</h3>
              <div class="mini-btn-row">
                <button type="button" class="mini-link-btn" @click="seedRosterAndForeshadowing">
                  ⚡ {{ ui.seedFromSliceBtn }}
                </button>
                <button type="button" class="mini-link-btn" @click="addRosterCharacter">
                  + {{ ui.addCharacterBtn }}
                </button>
              </div>
            </div>
            <p class="mem-hint">{{ ui.rosterSectionHint }}</p>

            <div class="roster-list">
              <div
                v-for="(chItem, cIdx) in characterRoster"
                :key="chItem.id"
                class="roster-card"
                :class="{ 'is-eliminated': chItem.status === 'eliminated' }"
              >
                <div class="roster-row-top">
                  <input
                    v-model="chItem.name"
                    type="text"
                    class="roster-name-input"
                    @change="persistRosterAndForeshadowing"
                  />
                  <select
                    v-model="chItem.status"
                    class="roster-status-select"
                    @change="onCharacterStatusChange(chItem)"
                  >
                    <option value="active">{{ ui.charStatusActive }}</option>
                    <option value="subdued">{{ ui.charStatusSubdued }}</option>
                    <option value="injured">{{ ui.charStatusInjured }}</option>
                    <option value="eliminated">{{ ui.charStatusEliminated }}</option>
                  </select>
                  <button type="button" class="roster-del-btn" @click="removeRosterCharacter(cIdx)">
                    ×
                  </button>
                </div>
                <div class="roster-row-sub">
                  <input
                    v-model="chItem.realmOrRole"
                    type="text"
                    class="roster-sub-input"
                    :placeholder="ui.charRolePlaceholder"
                    @change="persistRosterAndForeshadowing"
                  />
                  <input
                    v-model="chItem.relationNote"
                    type="text"
                    class="roster-sub-input"
                    :placeholder="ui.charNotePlaceholder"
                    @change="persistRosterAndForeshadowing"
                  />
                </div>
              </div>
            </div>
          </section>

          <!-- Enhancement: Long-Term Foreshadowing Tracker Pool -->
          <section class="sidebar-group memory-group">
            <div class="group-head">
              <h3>🕸️ {{ ui.foreshadowSectionTitle }}</h3>
              <button type="button" class="mini-link-btn" @click="addForeshadowingItem">
                + {{ ui.addForeshadowBtn }}
              </button>
            </div>
            <p class="mem-hint">{{ ui.foreshadowSectionHint }}</p>

            <div class="foreshadow-list">
              <div
                v-for="(fsItem, fIdx) in foreshadowingPool"
                :key="fsItem.id"
                class="foreshadow-card"
                :class="{
                  'is-due':
                    fsItem.status === 'planted' &&
                    currentChapterCursor >= fsItem.targetPayoffChapterRange[0] &&
                    currentChapterCursor <= fsItem.targetPayoffChapterRange[1],
                  'is-paid': fsItem.status === 'paid_off'
                }"
              >
                <div class="fs-row-top">
                  <button
                    type="button"
                    class="fs-status-pill"
                    :class="fsItem.status"
                    @click="toggleForeshadowStatus(fsItem)"
                  >
                    {{ fsItem.status === 'paid_off' ? ui.fsStatusPaid : ui.fsStatusPlanted }}
                  </button>
                  <input
                    v-model="fsItem.title"
                    type="text"
                    class="roster-name-input"
                    @change="persistRosterAndForeshadowing"
                  />
                  <span
                    v-if="
                      fsItem.status === 'planted' &&
                      currentChapterCursor >= fsItem.targetPayoffChapterRange[0] &&
                      currentChapterCursor <= fsItem.targetPayoffChapterRange[1]
                    "
                    class="fs-due-badge"
                  >
                    🔥 {{ ui.fsDueNowBadge }}
                  </span>
                  <button
                    type="button"
                    class="roster-del-btn"
                    @click="removeForeshadowingItem(fIdx)"
                  >
                    ×
                  </button>
                </div>

                <div class="fs-range-row">
                  <span>{{
                    ui.fsRangeLabel(
                      fsItem.plantedChapter,
                      fsItem.targetPayoffChapterRange[0],
                      fsItem.targetPayoffChapterRange[1]
                    )
                  }}</span>
                  <button
                    v-if="fsItem.status === 'planted'"
                    type="button"
                    class="mini-link-btn"
                    @click="injectForeshadowingPayoffIntoInstruction(fsItem)"
                  >
                    ✍️ {{ ui.injectPayoffBtn }}
                  </button>
                </div>

                <input
                  v-model="fsItem.payoffHint"
                  type="text"
                  class="roster-sub-input"
                  @change="persistRosterAndForeshadowing"
                />
              </div>
            </div>
          </section>
        </template>
      </aside>
    </div>

    <SaveAssetDialog
      ref="dialogRef"
      :open="dialogOpen"
      :default-name="defaultName"
      :default-folder-id="defaultFolderId"
      :title="t('studio.chat.saveToLibraryTitle')"
      :subtitle="t('studio.chat.saveToLibrarySubtitle')"
      @confirm="confirmSave"
      @cancel="closeDialog"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  DEFAULT_NOVEL_SYSTEM_PROMPT_EN,
  DEFAULT_NOVEL_SYSTEM_PROMPT_ZH,
  defaultNovelSystemPrompt,
  resolveNodeType,
  type GraphNode
} from '@shared/graph'
import {
  NOVEL_GENRE_PROFILES,
  auditNovelChapterContinuityAndPacing,
  convertNovelChapterToScreenplayPreview,
  createDefaultNovelCharacterRoster,
  createDefaultNovelForeshadowingPool,
  createMxWorkbenchPreset,
  exportMxChapterNumericalSlice,
  fillNovelGenreTemplate,
  generateMxArcChapterOutlinePlan,
  isNovelGenreId,
  parseMxDocumentJson,
  resolveNovelGenreProfile,
  type MxChapterNumericalSlice,
  type MxChapterOutlinePlanItem,
  type MxNovelChapterContinuityAudit,
  type MxNovelCharacterStatusEntry,
  type MxNovelForeshadowingEntry,
  type MxNumericalWorkbench,
  type MxTemplateId,
  type NovelGenreId,
  type NovelGenreProfile
} from '@shared/gameAssets'
import ExpandableTextarea from '../ExpandableTextarea.vue'
import GraphNodeRunControl from '../GraphNodeRunControl.vue'
import InstructionModelSelect from '../InstructionModelSelect.vue'
import PreviewSaveToLibraryButton from '../PreviewSaveToLibraryButton.vue'
import SaveAssetDialog from '../SaveAssetDialog.vue'
import WorkspaceItemIcon from '../WorkspaceItemIcon.vue'
import { useStudioI18n } from '../../composables/useStudioI18n'
import { useGraphNodeRun } from '../../composables/useGraphNodeRun'
import { useSaveCacheAsset } from '../../composables/useSaveCacheAsset'
import { useEditorDiveFrameFlush } from '../../composables/useEditorDiveFrameFlush'
import { editorDiveKey } from '../../features/graph/model/editorDive'
import { graphEditorHosts } from '../../features/graph/model/graphEditorHosts'
import { graphRunHosts } from '../../features/graph/model/graphRunHosts'
import { invalidateAssetUrlCache } from '../../features/media/assetUrlCache'
import { useWorkspaceStore } from '../../stores/workspace'
import {
  invalidateGenerateModelSettingsCache,
  loadGenerateModelOptions,
  parseModelKey,
  preferredModelKey,
  type GenerateModelOption
} from '../../features/graph/model/generateModelOptions'

type StoredGeneratedText = {
  id?: string
  title?: string
  text: string
  createdAt?: string
  relativePath?: string
}

interface NovelChapterStats {
  wordCount: number
  paragraphCount: number
  dialogueCount: number
}

interface NovelChapterHistoryRecord {
  chapter: number
  title: string
  wordCount: number
  summary: string
  tailAnchor: string
  updatedAt: string
}

const props = defineProps<{
  frameKey: string
  hostId: string
  nodeId: string
}>()

const { t, locale, graphTypeLabel } = useStudioI18n()
const workspace = useWorkspaceStore()
const editorDive = inject(editorDiveKey, null)

const {
  dialogOpen,
  defaultName,
  defaultFolderId,
  dialogRef,
  canSave,
  isSaved,
  isSaving,
  openSave,
  closeDialog,
  confirmSave
} = useSaveCacheAsset()

const node = computed((): GraphNode | null => {
  void graphEditorHosts.revision.value
  const current = graphEditorHosts.getNode(props.hostId, props.nodeId)
  return current?.typeId === 'asset.novel' ? current : null
})

const typeLabel = computed(() =>
  node.value?.typeId ? graphTypeLabel(node.value.typeId) : t('graph.defaultNode')
)
const nodeIcon = computed(() => {
  const current = node.value
  if (!current) return '📚'
  return resolveNodeType(current)?.icon?.trim() || '📚'
})

const { hasInPort, runStatus, isGraphRunning, blocked, toggleRun } = useGraphNodeRun(
  node,
  () => props.hostId
)

const displayName = ref('')
const localText = ref('')
const currentChapterTitle = ref('')
const instruction = ref('')
const systemPrompt = ref('')
const modelOptions = ref<GenerateModelOption[]>([])
const selectedModelKey = ref('')
const editorTextareaRef = ref<HTMLTextAreaElement | null>(null)

const totalChapters = ref(800)
const currentChapterCursor = ref(1)
const targetWords = ref(3200)
const autoAdvanceChapter = ref(true)
const worldBible = ref('')
const stateLedger = ref('')
const rollingSummary = ref('')
const chapterHistoryJson = ref('')

const rightTab = ref<'pacing' | 'arcPlan' | 'memory'>('pacing')
const chapterSearchQuery = ref('')
const splitDoneCount = ref(0)
const formatFlash = ref(false)

// Multi-chapter range merge state
const checkedChapterKeys = ref<string[]>([])
const mergedOutputToast = ref('')

// Batch auto-serialization state
const batchChapterCount = ref(3)
const batchRunning = ref(false)
const batchRemainingCount = ref(0)

// Inline selection polish state
const selectionStartIdx = ref(0)
const selectionEndIdx = ref(0)
const selectedPassageLength = computed(() =>
  Math.max(0, selectionEndIdx.value - selectionStartIdx.value)
)

// Character roster & long-term foreshadowing state
const characterRoster = ref<MxNovelCharacterStatusEntry[]>([])
const foreshadowingPool = ref<MxNovelForeshadowingEntry[]>([])

// Dual-column screenplay live preview & full-book export state
const dualScreenplayPreviewOpen = ref(false)
const screenplayPreviewDraft = ref('')
const dualSpSyncedFlash = ref(false)
const exportBookFlash = ref(false)

const isEn = computed(() => String(locale.value).toLowerCase().startsWith('en'))

function analyzeNovelChapter(text: string): NovelChapterStats {
  const trimmed = (text ?? '').trim()
  if (!trimmed || trimmed === '…') {
    return { wordCount: 0, paragraphCount: 0, dialogueCount: 0 }
  }
  const wordCount = trimmed.replace(/\s+/g, '').length
  const lines = trimmed
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  const paragraphCount = lines.length
  const dialogueCount = lines.filter(
    (l) => /[“"「『]/.test(l) || /^[^:：]{1,12}[:：]/.test(l)
  ).length
  return { wordCount, paragraphCount, dialogueCount }
}

function extractChapterNumFromTitle(title: string | undefined, fallbackIndex: number): number {
  if (!title) return fallbackIndex + 1
  const m =
    /第\s*(\d+)\s*(?:\/\s*\d+\s*)?章/.exec(title) || // cjk-ok
    /Chapter\s*(\d+)/i.exec(title)
  if (m && m[1]) {
    const parsed = Number(m[1])
    if (Number.isFinite(parsed) && parsed >= 1) return parsed
  }
  return fallbackIndex + 1
}

const generatedTexts = computed((): StoredGeneratedText[] => {
  void graphEditorHosts.revision.value
  const current = node.value
  if (!current) return []
  return (current.params.generatedTexts ?? []).filter(
    (item) => item.id && (item.text?.trim() || item.relativePath?.trim())
  )
})

const resolvedGeneratedSnippet = ref<Record<string, string>>({})
const resolvedFullChapterText = ref<Record<string, string>>({})
let resolveTextToken = 0

async function loadGeneratedTextBody(item: StoredGeneratedText): Promise<string> {
  const inline = item.text?.trim()
  if (inline) return item.text
  const relativePath = item.relativePath?.trim()
  if (!relativePath) return ''
  try {
    const url = await window.studio.getAssetFileUrl(relativePath)
    if (!url) return ''
    const res = await fetch(url)
    if (!res.ok) return ''
    return await res.text()
  } catch {
    return ''
  }
}

async function resolveGeneratedTextPreviews(): Promise<void> {
  const token = ++resolveTextToken
  const nextSnippet: Record<string, string> = {}
  const nextFull: Record<string, string> = {}
  await Promise.all(
    generatedTexts.value.map(async (item, index) => {
      const key = item.id || `index:${index}`
      const body = await loadGeneratedTextBody(item)
      const trimmed = body.trim()
      nextFull[key] = trimmed
      nextSnippet[key] = trimmed
        ? trimmed.length > 96
          ? `${trimmed.slice(0, 96)}…`
          : trimmed
        : item.relativePath?.trim() || '…'
    })
  )
  if (token !== resolveTextToken) return
  resolvedGeneratedSnippet.value = nextSnippet
  resolvedFullChapterText.value = nextFull
}

watch(generatedTexts, () => void resolveGeneratedTextPreviews(), { immediate: true, deep: true })

onBeforeUnmount(() => {
  resolveTextToken += 1
})

const currentChapterStats = computed(() => analyzeNovelChapter(localText.value))

const totalBookWordCount = computed(() => {
  if (!generatedTexts.value.length) return currentChapterStats.value.wordCount
  let sum = 0
  generatedTexts.value.forEach((item, index) => {
    const key = item.id || `index:${index}`
    if (isSelectedText(key)) {
      sum += currentChapterStats.value.wordCount
    } else {
      const full = resolvedFullChapterText.value[key] ?? item.text ?? ''
      sum += analyzeNovelChapter(full).wordCount
    }
  })
  return sum
})

const wordProgressPct = computed(() => {
  const tgt = Math.max(500, targetWords.value || 3200)
  return Math.round((currentChapterStats.value.wordCount / tgt) * 100)
})

function isSelectedText(key: string): boolean {
  const current = node.value
  if (!current) return false
  const selected = current.params.selectedTextId?.trim()
  if (selected) return selected === key
  const list = generatedTexts.value
  const last = list[list.length - 1]
  return Boolean(last && (last.id || '') === key)
}

function activeChapterIndex(): number {
  const list = generatedTexts.value
  if (!list.length) return -1
  const idx = list.findIndex((item, i) => isSelectedText(item.id || `index:${i}`))
  return idx >= 0 ? idx : list.length - 1
}

function chapterDisplayTitle(item: StoredGeneratedText, index: number): string {
  const custom = item.title?.trim()
  if (custom) return custom
  return isEn.value ? `Chapter ${index + 1}` : `第${index + 1}章` // cjk-ok
}

function chapterStatsForItem(item: StoredGeneratedText, index: number): NovelChapterStats {
  const key = item.id || `index:${index}`
  if (isSelectedText(key)) {
    return currentChapterStats.value
  }
  const full = resolvedFullChapterText.value[key] ?? item.text ?? ''
  return analyzeNovelChapter(full)
}

const filteredChapterEntries = computed(() => {
  const q = chapterSearchQuery.value.trim().toLowerCase()
  return generatedTexts.value
    .map((item, index) => {
      const key = item.id || `index:${index}`
      const displayTitle = chapterDisplayTitle(item, index)
      const chapterNumber = extractChapterNumFromTitle(displayTitle, index)
      const stats = chapterStatsForItem(item, index)
      return {
        item,
        index,
        key,
        displayTitle,
        chapterNumber,
        stats
      }
    })
    .filter((entry) => {
      if (!q) return true
      const snippet = (resolvedGeneratedSnippet.value[entry.key] || '').toLowerCase()
      return (
        entry.displayTitle.toLowerCase().includes(q) ||
        String(entry.chapterNumber).includes(q) ||
        snippet.includes(q)
      )
    })
})

// Inspect upstream game.economy node and downstream asset.screenplay node in the same graph
const upstreamEconomyNode = computed((): GraphNode | null => {
  void graphEditorHosts.revision.value
  if (!props.hostId || !node.value) return null
  const incoming = graphEditorHosts.listIncomingEdges(props.hostId, node.value.id)
  for (const edge of incoming) {
    const src = graphEditorHosts.getNode(props.hostId, edge.sourceNodeId)
    if (src?.typeId === 'game.economy') return src
  }
  return graphEditorHosts.findNode(props.hostId, (n) => n.typeId === 'game.economy')
})

const downstreamScreenplayNode = computed((): GraphNode | null => {
  void graphEditorHosts.revision.value
  if (!props.hostId || !node.value) return null
  const doc = graphEditorHosts.getDocument(props.hostId)
  if (doc?.edges) {
    for (const edge of doc.edges) {
      if (edge.source === node.value.id) {
        const tgt = graphEditorHosts.getNode(props.hostId, edge.target)
        if (tgt?.typeId === 'asset.screenplay') return tgt
      }
    }
  }
  return graphEditorHosts.findNode(props.hostId, (n) => n.typeId === 'asset.screenplay')
})

const activeWorkbench = computed((): MxNumericalWorkbench => {
  const econ = upstreamEconomyNode.value
  if (econ) {
    const tplRaw = String(econ.params.gameEconomyPreset ?? 'short_drama_reversal_loop')
    const doc = parseMxDocumentJson(
      econ.params.gameEconomyDiagramJson,
      tplRaw as MxTemplateId,
      econ.title
    )
    if (doc.workbench) return doc.workbench
  }
  return createMxWorkbenchPreset('short_drama_progression')
})

const novelGenre = ref<NovelGenreId>('urban_reversal')
const customStagesText = ref('')
const customAxisProtagonist = ref('')
const customAxisAntagonist = ref('')
const customUnlockTerm = ref('')
const customGenreOpen = ref(false)

const activeGenreProfile = computed((): NovelGenreProfile => {
  return (
    resolveNovelGenreProfile(novelGenre.value, {
      stagesText: customStagesText.value,
      axisProtagonist: customAxisProtagonist.value,
      axisAntagonist: customAxisAntagonist.value,
      unlockTerm: customUnlockTerm.value
    }) ?? NOVEL_GENRE_PROFILES[0]!
  )
})

const genreOptions = computed(() =>
  NOVEL_GENRE_PROFILES.map((p) => ({
    id: p.id,
    icon: p.icon,
    label: isEn.value ? p.labelEn : p.labelZh.split(' / ')[0] || p.labelZh
  }))
)

const chapterSlice = computed((): MxChapterNumericalSlice => {
  return exportMxChapterNumericalSlice(
    activeWorkbench.value,
    currentChapterCursor.value,
    totalChapters.value,
    activeGenreProfile.value
  )
})

const arcOutlinePlan = computed((): MxChapterOutlinePlanItem[] => {
  return generateMxArcChapterOutlinePlan(
    activeWorkbench.value,
    currentChapterCursor.value,
    totalChapters.value,
    targetWords.value,
    activeGenreProfile.value
  )
})

const arcPacingSvg = computed(() => {
  const list = arcOutlinePlan.value
  if (!list.length) {
    return { points: [], powerPolyline: '', villainPolyline: '' }
  }
  const maxVal = Math.max(10, ...list.map((p) => Math.max(p.powerCeiling, p.villainPressure)))
  const minVal = Math.max(
    0,
    Math.min(...list.map((p) => Math.min(p.powerCeiling, p.villainPressure))) * 0.8
  )
  const span = Math.max(1, maxVal - minVal)
  const leftX = 24
  const rightX = 276
  const topY = 18
  const botY = 82
  const count = list.length

  const points = list.map((item, idx) => {
    const x = count === 1 ? (leftX + rightX) / 2 : leftX + ((rightX - leftX) * idx) / (count - 1)
    const powerY = botY - ((item.powerCeiling - minVal) / span) * (botY - topY)
    const villainY = botY - ((item.villainPressure - minVal) / span) * (botY - topY)
    const beatBarH =
      item.beatType === 'climax_reversal_slap'
        ? 58
        : item.beatType === 'villain_suppression_cliffhanger'
          ? 44
          : item.beatType === 'encounter_growth'
            ? 32
            : 20
    const beatColor =
      item.beatType === 'climax_reversal_slap'
        ? '#f43f5e'
        : item.beatType === 'villain_suppression_cliffhanger'
          ? '#f59e0b'
          : item.beatType === 'encounter_growth'
            ? '#38bdf8'
            : '#94a3b8'
    return {
      chapter: item.chapter,
      x: Math.round(x * 10) / 10,
      powerY: Math.round(powerY * 10) / 10,
      villainY: Math.round(villainY * 10) / 10,
      beatBarH,
      beatColor
    }
  })

  return {
    points,
    powerPolyline: points.map((p) => `${p.x},${p.powerY}`).join(' '),
    villainPolyline: points.map((p) => `${p.x},${p.villainY}`).join(' ')
  }
})

const parsedHistoryMap = computed((): Record<string, NovelChapterHistoryRecord> => {
  const raw = chapterHistoryJson.value.trim()
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, NovelChapterHistoryRecord>
    }
  } catch {
    // ignore invalid json
  }
  return {}
})

const activePrevTailAnchor = computed((): string => {
  const prevChap = currentChapterCursor.value - 1
  if (prevChap < 1) return ''
  const fromHistory = parsedHistoryMap.value[String(prevChap)]?.tailAnchor?.trim()
  if (fromHistory) return fromHistory
  const matchEntry = filteredChapterEntries.value.find((e) => e.chapterNumber === prevChap)
  if (matchEntry) {
    const full = resolvedFullChapterText.value[matchEntry.key] ?? matchEntry.item.text ?? ''
    const lines = full
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
    return lines.slice(-4).join('\n').slice(-550)
  }
  return ''
})

const chapterAudit = computed((): MxNovelChapterContinuityAudit => {
  const eliminatedNames = characterRoster.value
    .filter((c) => c.status === 'eliminated' && c.name.trim())
    .map((c) => c.name.trim())
  const dueTitles = foreshadowingPool.value
    .filter(
      (f) =>
        f.status === 'planted' &&
        f.title.trim() &&
        currentChapterCursor.value >= f.targetPayoffChapterRange[0] &&
        currentChapterCursor.value <= f.targetPayoffChapterRange[1]
    )
    .map((f) => f.title.trim())
  return auditNovelChapterContinuityAndPacing(localText.value, chapterSlice.value, {
    targetWords: targetWords.value,
    prevTailAnchor: activePrevTailAnchor.value,
    eliminatedCharacterNames: eliminatedNames,
    dueForeshadowingTitles: dueTitles,
    genre: activeGenreProfile.value
  })
})

const beatCheckItems = computed(() => {
  const txt = localText.value
  const b = activeGenreProfile.value.beats
  return [
    {
      index: 1 as const,
      label: isEn.value ? `Beat 1: ${b.setup_endure.badgeEn}` : `第一拍·${b.setup_endure.badgeZh}`, // cjk-ok
      reached: /第一拍|Beat\s*1/i.test(txt) || txt.length >= 400 // cjk-ok
    },
    {
      index: 2 as const,
      label: isEn.value
        ? `Beat 2: ${b.encounter_growth.badgeEn}`
        : `第二拍·${b.encounter_growth.badgeZh}`, // cjk-ok
      reached: /第二拍|Beat\s*2/i.test(txt) || txt.length >= 1200 // cjk-ok
    },
    {
      index: 3 as const,
      label: isEn.value
        ? `Beat 3: ${b.villain_suppression_cliffhanger.badgeEn}`
        : `第三拍·${b.villain_suppression_cliffhanger.badgeZh}`, // cjk-ok
      reached: /第三拍|Beat\s*3/i.test(txt) || txt.length >= 2200 // cjk-ok
    },
    {
      index: 4 as const,
      label: isEn.value
        ? `Beat 4: ${b.climax_reversal_slap.badgeEn}`
        : `第四拍·${b.climax_reversal_slap.badgeZh}`, // cjk-ok
      reached: /第四拍|Beat\s*4/i.test(txt) || txt.length >= targetWords.value // cjk-ok
    }
  ]
})

const ui = computed(() => {
  const en = isEn.value
  const genCount = generatedTexts.value.length
  const curWords = currentChapterStats.value.wordCount
  const totWords = totalBookWordCount.value
  const gp = activeGenreProfile.value
  return {
    genreSelectorLabel: en ? 'Novel Genre & Narrative Engine' : '小说题材流派与叙事引擎', // cjk-ok
    genreCustomToggleBtn: en ? 'Custom Stages / Axes' : '自定义阶段/轴', // cjk-ok
    customStagesLabel: en
      ? 'Custom Stage Ladder (comma-separated)'
      : '自定义阶段阶梯（逗号分隔，自动映射全书章数）', // cjk-ok
    customStagesPlaceholder: gp.stageNamesZh.join('，'), // cjk-ok
    customAxisProtagonistLabel: en ? 'Protagonist Axis' : '主角成长轴名称', // cjk-ok
    customAxisAntagonistLabel: en ? 'Antagonist Axis' : '反派/阻力轴名称', // cjk-ok
    customUnlockTermPlaceholder: en
      ? 'Unlock item term (e.g. Clues, Relics)'
      : `解锁物名称（当前：${gp.unlockTermZh}）`, // cjk-ok
    seedGenreMemoryBtn: en ? 'Apply Genre Roster & Bible' : '按当前流派重置人物与世界观', // cjk-ok
    telemetryChapters: en
      ? `Written ${genCount} / ${totalChapters.value} Chaps`
      : `已写 ${genCount} / ${totalChapters.value} 章`, // cjk-ok
    telemetryCurrentWords: en
      ? `Ch.${currentChapterCursor.value}: ${curWords} / ${targetWords.value} chars`
      : `本章 ${curWords} / ${targetWords.value} 字`, // cjk-ok
    telemetryTotalWords: en
      ? `Total: ${totWords.toLocaleString()} chars`
      : `累计 ${totWords.toLocaleString()} 字`, // cjk-ok
    telemetryPowerCeiling: en
      ? `${gp.protagonistAxisEn}: ${chapterSlice.value.powerCeiling}`
      : `${gp.protagonistAxisZh} ${chapterSlice.value.powerCeiling}`,
    telemetryQaScore: (score: number) => (en ? `QA ${score}pt` : `合规 ${score}分`), // cjk-ok
    exportBookBtn: en ? 'Export Full Book' : '导出全书合集', // cjk-ok
    exportBookDoneBtn: en ? '✓ Exported & Copied' : '✓ 已导出并复制全书', // cjk-ok
    pushToScreenplayBtn: en ? 'Push to Screenplay' : '推送至剧本工作台', // cjk-ok
    pushToGameSystemBtn: en ? 'Push to Game GDD' : '推送至策划案工作台', // cjk-ok
    generateCurrentBtn: en
      ? `Generate Ch.${currentChapterCursor.value}`
      : `生成第 ${currentChapterCursor.value} 章`, // cjk-ok
    aiNextChapterBtn: en ? 'AI Next Chapter' : 'AI 续写下一章', // cjk-ok
    serialConfigTitle: en ? 'Dynamic Serialization & Chapter Clock' : '长篇连载规模与章节时钟', // cjk-ok
    dynamicTotalBadge: en ? 'Dynamic' : '总章数可随时动态调整', // cjk-ok
    totalChaptersLabel: en ? 'Planned Total Chapters' : '规划总章节数 (1~5000)', // cjk-ok
    targetWordsLabel: en ? 'Target Words / Chapter' : '单章目标字数', // cjk-ok
    quickScaleLabel: en ? 'Quick Total Scale:' : '总章数快捷规格：', // cjk-ok
    targetCursorLabel: en ? 'Current Target Chapter:' : '当前生成章号游标：', // cjk-ok
    autoAdvanceLabel: en
      ? 'Auto-advance to next chapter (+1) after generation'
      : '生成本章后自动将游标推进至下一章 (+1)', // cjk-ok
    chapterListTitle: en ? 'Multi-Chapter Manuscript Tree' : '多章节连载目录树', // cjk-ok
    chapterCountBadge: (written: number, total: number) =>
      en ? `${written} / ${total} chaps` : `已存 ${written} 章 / 规划 ${total} 章`, // cjk-ok
    addChapterBtn: en ? 'New Chapter' : '新建章节', // cjk-ok
    mergeCheckedBtn: (n: number) =>
      en ? `Merge ${n} Checked Chaps to Output` : `合并已勾选的 ${n} 章作为节点输出`, // cjk-ok
    searchChaptersPlaceholder: en ? 'Filter by chapter # or keyword…' : '搜索章号或章节标题关键词…', // cjk-ok
    defaultChapterTitle: (n: number) => (en ? `Chapter ${n}` : `第${n}章`), // cjk-ok
    activeOutputBadge: en ? 'Active Output (out)' : '当前输出', // cjk-ok
    emptyChapterHint: en
      ? 'Click "Generate Ch.X" or write directly in the center editor…'
      : '点击右上角「⚡ 生成第 X 章」或直接在中间正文区撰写…', // cjk-ok
    wordsCountLabel: (n: number) => (en ? `${n} chars` : `${n} 字`), // cjk-ok
    paragraphsCountLabel: (n: number) => (en ? `${n} paras` : `${n} 段`), // cjk-ok
    dialoguesCountLabel: (n: number) => (en ? `${n} lines` : `${n} 句对话`), // cjk-ok
    setAsOutputHint: en
      ? 'Click to edit this chapter and set it as the active node output (out)'
      : '点击切换编辑该章节，并将其设为节点当前输出（供下游创建剧本节点改编）', // cjk-ok
    moveUpHint: en ? 'Move chapter up' : '上移章节', // cjk-ok
    moveDownHint: en ? 'Move chapter down' : '下移章节', // cjk-ok
    duplicateHint: en ? 'Duplicate chapter' : '复制章节副本', // cjk-ok
    deleteHint: en ? 'Delete chapter' : '删除该章', // cjk-ok
    splitBoxTitle: en ? 'Smart Multi-Chapter Splitter' : '一键按章号拆分多章长文', // cjk-ok
    splitBoxDesc: en
      ? 'If the current editor contains multiple "Chapter X" headers, split them into standalone chapters in one click.'
      : '若当前正文中包含多个「第1章 / 第2章」标题，可一键拆分为独立章节条目并保留顶部共享人物档案。', // cjk-ok
    splitNowBtn: en ? '✂️ Split into Chapters by Header' : '✂️ 按「第X章」拆分为独立章节', // cjk-ok
    splitDoneToast: (n: number) =>
      en ? `✓ Split into ${n} chapters` : `✓ 已拆分为 ${n} 个独立章节`, // cjk-ok
    chapterTitlePlaceholder: (n: number) =>
      en ? `Chapter ${n}: Enter chapter title…` : `第${n}章：输入本章标题…`, // cjk-ok
    btnInsertBios: en ? '+ Character Bios' : '+ 人物档案头', // cjk-ok
    btnBeat1: en
      ? `+ Beat 1: ${gp.beats.setup_endure.badgeEn}`
      : `+ 第一拍·${gp.beats.setup_endure.badgeZh}`, // cjk-ok
    btnBeat2: en
      ? `+ Beat 2: ${gp.beats.encounter_growth.badgeEn}`
      : `+ 第二拍·${gp.beats.encounter_growth.badgeZh}`, // cjk-ok
    btnBeat3: en
      ? `+ Beat 3: ${gp.beats.villain_suppression_cliffhanger.badgeEn}`
      : `+ 第三拍·${gp.beats.villain_suppression_cliffhanger.badgeZh}`, // cjk-ok
    btnBeat4: en
      ? `+ Beat 4: ${gp.beats.climax_reversal_slap.badgeEn}`
      : `+ 第四拍·${gp.beats.climax_reversal_slap.badgeZh}`, // cjk-ok
    btnFormat: en ? '✨ Format Manuscript' : '✨ 净稿排版', // cjk-ok
    btnFormatDone: en ? '✓ Formatted' : '✓ 已排版', // cjk-ok
    btnDualScreenplay: en ? 'Novel ↔ Screenplay' : '小说 ↔ 剧本双栏对照', // cjk-ok
    dualSpTitle: (chap: number) =>
      en
        ? `Ch.${chap} Live Short-Drama Screenplay Preview`
        : `第 ${chap} 章 · 短剧分场剧本实时对照预览`, // cjk-ok
    dualSpRefreshBtn: en ? 'Re-Adapt' : '重新转译', // cjk-ok
    dualSpSyncDownstreamBtn: en ? 'Sync to Screenplay Node' : '同步写回下游剧本节点', // cjk-ok
    dualSpSyncedToast: en ? '✓ Synced to Screenplay' : '✓ 已写回下游剧本节点', // cjk-ok
    dualSpPlaceholder: en
      ? 'Adapted short-drama screenplay preview will appear here…'
      : '此处实时将左侧小说章节转译为包含【内/外景、△动作镜头、人物高能台词、集末卡点】的短剧剧本底稿…', // cjk-ok
    progressLabel: (cur: number, tgt: number, pct: number) =>
      en
        ? `Chapter Length: ${cur} / ${tgt} chars (${pct}%)`
        : `本章字数进度：${cur} / ${tgt} 字 (${pct}%)`, // cjk-ok
    selectionActiveBadge: (len: number) =>
      en ? `Selected ${len} chars:` : `已选中 ${len} 字局部精修：`, // cjk-ok
    selBoostSlapBtn: en ? gp.polish.slapEn : gp.polish.slapZh,
    selExpandSensoryBtn: en ? gp.polish.expandEn : gp.polish.expandZh,
    selFixTrumpsBtn: en ? gp.polish.fixEn : gp.polish.fixZh,
    selRewriteHookBtn: en ? gp.polish.hookEn : gp.polish.hookZh,
    editorPlaceholder: (chap: number, words: number) =>
      en
        ? `Write or generate Chapter ${chap} (${words}+ words, 4-beat structure)…`
        : `在此撰写或 AI 生成【第 ${chap} 章】正文（目标 ${words}+ 字，流派：${gp.labelZh}，四拍结构：${gp.beats.setup_endure.badgeZh} → ${gp.beats.encounter_growth.badgeZh} → ${gp.beats.villain_suppression_cliffhanger.badgeZh} → ${gp.beats.climax_reversal_slap.badgeZh}）…`, // cjk-ok
    tabPacingAndOutline: en ? 'Quota & QA' : '数值围栏 & 审计', // cjk-ok
    tabArcPlan: en ? 'Arc Plan & Batch' : '幕次细纲 & 连写', // cjk-ok
    tabMemoryPyramid: en ? '4-Tier Memory' : '四层记忆 (L1~L4)', // cjk-ok
    sliceCardTitle: (cur: number, tot: number) =>
      en
        ? `Ch.${cur}/${tot} Numerical Quota Lock`
        : `第 ${cur}/${tot} 章 · 数值围栏与${gp.unlockTermZh}锁`, // cjk-ok
    openEconomyBtn: en ? 'Open Economy System' : '打开经济系统', // cjk-ok
    arcRangeLabel: (arc: number, totArcs: number, start: number, end: number) =>
      en
        ? `Conflict Arc ${arc}/${totArcs} (Ch.${start}~${end})`
        : `所属冲突幕次：第 ${arc}/${totArcs} 幕（第 ${start}~${end} 章）`, // cjk-ok
    beatTagLabel: en ? 'Chapter Pacing Role:' : '本章戏剧节拍定位：', // cjk-ok
    kpiRealmLabel: en ? gp.stageTermEn : `主角当前${gp.stageTermZh}`, // cjk-ok
    kpiPowerLabel: en
      ? `${gp.protagonistAxisEn} vs ${gp.antagonistAxisEn}`
      : `${gp.protagonistAxisZh} vs ${gp.antagonistAxisZh}`,
    kpiStatsLabel: en ? 'Base Attributes' : '本章面板属性', // cjk-ok
    kpiWallLabel: en ? 'Pacing Alert' : '冲突卡点预警', // cjk-ok
    wallBossLabel: en ? '🔥 BOSS SHOWDOWN' : '🔥 本幕终局高潮期', // cjk-ok
    wallDifficultyLabel: en ? '⚠️ DIFFICULTY WALL' : '⚠️ 阻力飙升绝境卡点', // cjk-ok
    wallNormalLabel: en ? '✓ Smooth Progression' : '✓ 稳步推进展开期', // cjk-ok
    allowedTrumpsLabel: en ? `Allowed ${gp.unlockTermEn}:` : `本章准入可用${gp.unlockTermZh}：`, // cjk-ok
    lockedTrumpsLabel: en
      ? `Locked Endgame ${gp.unlockTermEn}:`
      : `封存禁用后期${gp.unlockTermZh}：`, // cjk-ok
    recommendedItemLabel: en ? 'Recommended Encounter / Item:' : `本章推荐${gp.encounterTermZh}：`, // cjk-ok
    injectSliceBtn: en
      ? 'Inject Chapter Numerical Quota into Outline Prompt'
      : '将本章数值配额与节拍要求写入下方细纲指令', // cjk-ok
    qaCardTitle: en ? 'Chapter Continuity & Power-Creep QA' : '本章数值合规与连贯性审计', // cjk-ok
    qaScoreBadge: (score: number) =>
      en ? `Score: ${score}/100` : `爽点与合规评分：${score} / 100`, // cjk-ok
    fixLeakedTrumpsBtn: (cnt: number) =>
      en
        ? `Replace ${cnt} Leaked Locked Trump(s) with Allowed Trump`
        : `一键将正文中 ${cnt} 处抢跑禁用${gp.unlockTermZh}替换为本章准入项`, // cjk-ok
    fixRevivedCharsBtn: (cnt: number) =>
      en
        ? `Replace ${cnt} Revived Eliminated Character(s)`
        : `一键修正 ${cnt} 名已退场却异常复活的角色`, // cjk-ok
    arcSvgTitle: en ? 'Arc Power Envelope & Beat ECG Curve' : '本幕战力包络与爽点心电图 (点击跳章)', // cjk-ok
    arcSvgLegend: en ? 'Blue: Power / Orange: Villain' : '蓝:主角上限 / 橙:反派威胁', // cjk-ok
    batchSerialTitle: en ? 'Batch Auto-Serializer (Multi-Chapter)' : '多章连续自动连载生成器', // cjk-ok
    batchRunningBadge: (rem: number) =>
      en ? `Serializing (${rem} left)…` : `连续连载中（剩余 ${rem} 章）…`, // cjk-ok
    batchReadyBadge: en ? 'Stateful Loop' : '按幕次细纲自动接力', // cjk-ok
    batchSerialDesc: en
      ? 'Automatically steps through consecutive chapters using the Arc Outline Plan, updating L2/L3/L4 memory after each chapter.'
      : '按下方幕次分章细纲表，从当前章开始自动逐章生成正文，每写完一章自动结算更新 L2 状态账本与 L4 章末锚点并接力下一章。', // cjk-ok
    batchCountPill: (cnt: number) => (en ? `${cnt} Chaps` : `连写 ${cnt} 章`), // cjk-ok
    startBatchBtn: (cnt: number) =>
      en ? `Auto-Serialize ${cnt} Chapters` : `连续自动连载 ${cnt} 章`, // cjk-ok
    stopBatchBtn: en ? 'Stop Batch' : '停止连写', // cjk-ok
    arcPlanTableTitle: en ? 'Current Arc Chapter Outline Plan' : '当前冲突幕 · 分章细纲排期表', // cjk-ok
    arcPlanTableHint: en
      ? 'Derived from upstream Economy System progression curve. Click any chapter to load its outline or generate immediately.'
      : '根据上游经济系统冲突幕次自动排期（起势铺垫 → 奇遇立威 → 绝境卡点 → 亮底牌打脸），点击即可填入细纲或立即生成该章。', // cjk-ok
    useOutlineBtn: en ? 'Load Outline' : '填入本章细纲', // cjk-ok
    runOutlineNowBtn: (ch: number) => (en ? `Gen Ch.${ch}` : `立即生成第${ch}章`), // cjk-ok
    modelSectionTitle: en ? 'Text Generation Model' : '小说创作大模型', // cjk-ok
    chapterOutlineTitle: (chap: number) =>
      en ? `Chapter ${chap} Plot Outline & Prompt` : `第 ${chap} 章剧情细纲与写作指令`, // cjk-ok
    instructionPlaceholder: en
      ? 'Enter specific plot beats, characters, or conflict requirements for this chapter…'
      : '输入本章专属剧情细纲（如出场反派、冲突地点、本章亮出的底牌与章末悬念钩子）…', // cjk-ok
    systemPromptToggle: en ? 'Advanced: System Prompt' : '高级：系统提示词 (System Prompt)', // cjk-ok
    l1Title: en ? 'L1 · World Bible (Permanent)' : 'L1 · 恒定世界观与力量体系宪法', // cjk-ok
    seedFromSliceBtn: en ? 'Seed from Economy' : '从数值体系提取', // cjk-ok
    l1Hint: en
      ? 'Pinned across all 800+ chapters so power scaling and protagonist persona never drift.'
      : '全书 800+ 章常驻置顶，锁定主角人设、境界铁律与核心爽点闭环不漂移。', // cjk-ok
    l1Placeholder: en
      ? 'Core world rules, power tiers, protagonist vows…'
      : '核心世界观设定、境界划分铁律、主角性格底色与禁止事项…', // cjk-ok
    l2Title: en ? 'L2 · Live State & Inventory Ledger' : 'L2 · 主角当前动态状态与底牌账本', // cjk-ok
    refreshLedgerBtn: en ? 'Sync from Current Chap' : '按本章同步结算', // cjk-ok
    l2Hint: en
      ? 'Automatically updated after each chapter generation; tracks current realm, unlocked trumps, and active hooks.'
      : '每章生成后自动结算更新（亦可手动微调），记录主角最新境界、已暴露底牌与待解仇恨。', // cjk-ok
    l2Placeholder: en
      ? 'Current realm, unlocked trump cards, injuries/wealth, unresolved grudges…'
      : '当前境界、已亮出底牌、最新资产/人脉、待下一章承接的仇恨与伏笔…', // cjk-ok
    l3Title: en ? 'L3 · Rolling Summary (Recent 20 Chaps)' : 'L3 · 前情滚动提要与防重黑名单', // cjk-ok
    l3Hint: en
      ? 'Rolling 1-line summary of the most recent 20 chapters to prevent repetitive tropes.'
      : '自动滚动保留最近 20 章一句话剧情提要，防止长篇连载出现重复打脸套路。', // cjk-ok
    l3Placeholder: en ? '- Ch.1: ...\n- Ch.2: ...' : '- 第1章《…》：…\n- 第2章《…》：…', // cjk-ok
    l4Title: (prev: number) =>
      en
        ? `L4 · Prev Chapter (Ch.${prev}) Tail Anchor`
        : `L4 · 上一章（第 ${prev} 章）末尾原文无缝锚点`, // cjk-ok
    extractTailBtn: en ? 'Re-extract from Prev Chap' : '从上一章末尾提取', // cjk-ok
    l4Hint: en
      ? 'Injected verbatim into the prompt so the opening paragraph of the new chapter continues seamlessly.'
      : '生成新章节时自动将上一章最后 500 字原文喂给大模型，确保新章第一段时空与动作无缝咬合。', // cjk-ok
    l4EmptyHint: en
      ? '(No previous chapter tail anchor yet — Chapter 1 starts from the opening hook)'
      : '（当前为第 1 章或上一章尚未生成，生成完上一章后此处会自动捕获章末最后 4 段原文锚点）', // cjk-ok
    rosterSectionTitle: en
      ? 'Character Status & Grudge Roster'
      : '人物生死与仇恨状态名录 (防OOC复活)', // cjk-ok
    rosterSectionHint: en
      ? 'Track character status across 800+ chapters. Characters marked "Eliminated" are forbidden from re-appearing.'
      : '跨百章追踪关键人物状态；标为「💀已伏诛退场」的反派将被自动注入防复活指令并纳入合规审计。', // cjk-ok
    addCharacterBtn: en ? 'Add Character' : '新增角色', // cjk-ok
    charStatusActive: en ? 'Active' : '🔥 活跃在场', // cjk-ok
    charStatusSubdued: en ? 'Subdued / Ally' : '🙇 已臣服归顺', // cjk-ok
    charStatusInjured: en ? 'Injured / Hiding' : '🩸 重伤蛰伏', // cjk-ok
    charStatusEliminated: en ? '💀 Eliminated' : '💀 已伏诛退场', // cjk-ok
    charRolePlaceholder: en ? 'Realm / Title…' : '境界/头衔…', // cjk-ok
    charNotePlaceholder: en ? 'Grudge / Relation note…' : '恩怨状态与退场说明…', // cjk-ok
    foreshadowSectionTitle: en ? 'Long-Term Foreshadowing Pool' : '长线伏笔埋设与到期回收追踪池', // cjk-ok
    foreshadowSectionHint: en
      ? 'Track planted hooks and their target payoff chapter range so no plot thread is forgotten.'
      : '记录埋设章号与计划填坑区间；当连载游标进入回收窗口时自动高亮提醒并注入填坑指令。', // cjk-ok
    addForeshadowBtn: en ? 'Plant Hook' : '埋设新伏笔', // cjk-ok
    fsStatusPlanted: en ? '⏳ Planted' : '⏳ 待回收', // cjk-ok
    fsStatusPaid: en ? '✅ Paid Off' : '✅ 已填坑', // cjk-ok
    fsDueNowBadge: en ? 'Due Now' : '本章到期填坑', // cjk-ok
    fsRangeLabel: (planted: number, r0: number, r1: number) =>
      en
        ? `Planted Ch.${planted} → Payoff Ch.${r0}~${r1}`
        : `第 ${planted} 章埋设 ➔ 规划第 ${r0}~${r1} 章填坑回收`, // cjk-ok
    injectPayoffBtn: en ? 'Inject Payoff Prompt' : '写入本章填坑指令' // cjk-ok
  }
})

async function loadModels(preferredKey: string): Promise<void> {
  const { options, selectedKey: resolved } = await loadGenerateModelOptions('text', preferredKey)
  modelOptions.value = options
  if (selectedModelKey.value !== resolved) {
    selectedModelKey.value = resolved
  }
}

function syncCurrentChapterTitleFromNode(): void {
  const list = generatedTexts.value
  const idx = activeChapterIndex()
  if (idx >= 0 && list[idx]) {
    currentChapterTitle.value = chapterDisplayTitle(list[idx]!, idx)
  } else {
    currentChapterTitle.value = isEn.value
      ? `Chapter ${currentChapterCursor.value}`
      : `第${currentChapterCursor.value}章` // cjk-ok
  }
}

function loadFromNode(): void {
  const current = node.value
  if (!current) return
  displayName.value = current.title?.trim() || ''
  const rawText = current.params.text ?? ''
  localText.value = rawText.trim() === '…' ? '' : rawText
  instruction.value = current.params.generateInstruction ?? ''
  const storedSys = current.params.generateSystemPrompt?.trim()
  systemPrompt.value = storedSys || defaultNovelSystemPrompt(String(locale.value))

  novelGenre.value = isNovelGenreId(current.params.novelGenre)
    ? current.params.novelGenre
    : 'urban_reversal'
  customStagesText.value = current.params.novelCustomStagesText ?? ''
  customAxisProtagonist.value = current.params.novelCustomAxisProtagonist ?? ''
  customAxisAntagonist.value = current.params.novelCustomAxisAntagonist ?? ''
  customUnlockTerm.value = current.params.novelCustomUnlockTerm ?? ''

  totalChapters.value = Math.max(
    1,
    Math.min(5000, Math.round(Number(current.params.novelTotalChapters) || 800))
  )
  currentChapterCursor.value = Math.max(
    1,
    Math.min(totalChapters.value, Math.round(Number(current.params.novelCurrentChapter) || 1))
  )
  targetWords.value = Math.max(
    1000,
    Math.min(15000, Math.round(Number(current.params.novelTargetWords) || 3200))
  )
  autoAdvanceChapter.value = current.params.novelAutoAdvanceChapter !== false
  worldBible.value = current.params.novelWorldBible ?? ''
  stateLedger.value = current.params.novelStateLedger ?? ''
  rollingSummary.value = current.params.novelRollingSummary ?? ''
  chapterHistoryJson.value = current.params.novelChapterHistoryJson ?? ''

  // Parse or initialize character roster & foreshadowing pool
  const rawRoster = current.params.novelCharacterRosterJson?.trim()
  if (rawRoster) {
    try {
      const parsed = JSON.parse(rawRoster) as MxNovelCharacterStatusEntry[]
      characterRoster.value = Array.isArray(parsed) ? parsed : []
    } catch {
      characterRoster.value = []
    }
  }
  if (!characterRoster.value.length) {
    characterRoster.value = createDefaultNovelCharacterRoster(
      activeWorkbench.value,
      totalChapters.value,
      activeGenreProfile.value
    )
  }

  const rawFs = current.params.novelForeshadowingJson?.trim()
  if (rawFs) {
    try {
      const parsed = JSON.parse(rawFs) as MxNovelForeshadowingEntry[]
      foreshadowingPool.value = Array.isArray(parsed) ? parsed : []
    } catch {
      foreshadowingPool.value = []
    }
  }
  if (!foreshadowingPool.value.length) {
    foreshadowingPool.value = createDefaultNovelForeshadowingPool(
      activeWorkbench.value,
      totalChapters.value,
      activeGenreProfile.value
    )
  }

  const preferred = preferredModelKey(
    current.params.generateProviderInstanceId,
    current.params.generateModel
  )
  selectedModelKey.value = preferred

  const existingGallery = current.params.generatedTexts ?? []
  if (!localText.value.trim() && existingGallery.length > 0) {
    const activeIdx = activeChapterIndex()
    const activeItem = activeIdx >= 0 ? existingGallery[activeIdx] : existingGallery[0]
    if (activeItem) {
      void loadGeneratedTextBody(activeItem).then((body) => {
        if (body.trim() && !localText.value.trim()) {
          localText.value = body.trim()
        }
      })
    }
  }

  syncCurrentChapterTitleFromNode()
  void loadModels(preferred)
}

watch(
  () => [props.hostId, props.nodeId] as const,
  () => loadFromNode(),
  { immediate: true }
)

watch(
  () =>
    [
      node.value?.params.text,
      node.value?.params.selectedTextId,
      generatedTexts.value.length,
      node.value?.params.novelCurrentChapter,
      node.value?.params.novelTotalChapters,
      node.value?.params.novelWorldBible,
      node.value?.params.novelStateLedger,
      node.value?.params.novelRollingSummary,
      node.value?.params.novelChapterHistoryJson
    ] as const,
  ([nextNodeText, , , nextCursor, nextTotal, nextBible, nextLedger, nextSummary, nextHistJson]) => {
    const normalized = (nextNodeText ?? '').trim() === '…' ? '' : (nextNodeText ?? '')
    if (normalized && normalized !== localText.value) {
      localText.value = normalized
    }
    if (typeof nextTotal === 'number' && nextTotal >= 1) {
      totalChapters.value = nextTotal
    }
    if (typeof nextCursor === 'number' && nextCursor >= 1) {
      currentChapterCursor.value = nextCursor
    }
    if (typeof nextBible === 'string' && nextBible !== worldBible.value) {
      worldBible.value = nextBible
    }
    if (typeof nextLedger === 'string' && nextLedger !== stateLedger.value) {
      stateLedger.value = nextLedger
    }
    if (typeof nextSummary === 'string' && nextSummary !== rollingSummary.value) {
      rollingSummary.value = nextSummary
    }
    if (typeof nextHistJson === 'string' && nextHistJson !== chapterHistoryJson.value) {
      chapterHistoryJson.value = nextHistJson
    }
    syncCurrentChapterTitleFromNode()
  }
)

// Watch runStatus to drive Batch Auto-Serialization loop
watch(
  () => runStatus.value,
  (nextStatus, prevStatus) => {
    if (!batchRunning.value) return
    if (prevStatus === 'running' && (nextStatus === 'done' || nextStatus === 'degraded')) {
      batchRemainingCount.value = Math.max(0, batchRemainingCount.value - 1)
      if (batchRemainingCount.value <= 0) {
        batchRunning.value = false
        return
      }
      // Schedule next chapter in the batch
      setTimeout(() => {
        if (!batchRunning.value) return
        const nextChap = currentChapterCursor.value
        const planMatch = arcOutlinePlan.value.find((p) => p.chapter === nextChap)
        if (planMatch) {
          instruction.value = isEn.value ? planMatch.outlinePromptEn : planMatch.outlinePromptZh
          persistGenerateConfig()
        }
        if (hasInPort.value && !blocked.value && runStatus.value !== 'running') {
          toggleRun()
        } else {
          batchRunning.value = false
        }
      }, 360)
    } else if (nextStatus === 'error') {
      batchRunning.value = false
      batchRemainingCount.value = 0
    }
  }
)

watch(locale, (next) => {
  const cur = systemPrompt.value.trim()
  if (!cur || cur === DEFAULT_NOVEL_SYSTEM_PROMPT_EN || cur === DEFAULT_NOVEL_SYSTEM_PROMPT_ZH) {
    systemPrompt.value = defaultNovelSystemPrompt(String(next))
  }
})

function onSettingsChanged(): void {
  invalidateGenerateModelSettingsCache()
  if (node.value) void loadModels(selectedModelKey.value)
}

onMounted(() => {
  window.addEventListener('studio:settings-changed', onSettingsChanged)
})

onBeforeUnmount(() => {
  window.removeEventListener('studio:settings-changed', onSettingsChanged)
})

function persistTitle(): void {
  const current = node.value
  if (!current || !props.hostId) return
  graphEditorHosts.updateNode(props.hostId, current.id, {}, displayName.value.trim())
  graphEditorHosts.bumpRevision()
}

function persistGenerateConfig(): void {
  const current = node.value
  if (!current || !props.hostId) return
  const parsed = parseModelKey(selectedModelKey.value)
  graphEditorHosts.updateNode(props.hostId, current.id, {
    generateInstruction: instruction.value,
    generateSystemPrompt: systemPrompt.value,
    generateModel: parsed?.model ?? '',
    generateProviderInstanceId: parsed?.providerInstanceId ?? '',
    novelGenre: novelGenre.value,
    novelCustomStagesText: customStagesText.value,
    novelCustomAxisProtagonist: customAxisProtagonist.value,
    novelCustomAxisAntagonist: customAxisAntagonist.value,
    novelCustomUnlockTerm: customUnlockTerm.value,
    novelTotalChapters: totalChapters.value,
    novelCurrentChapter: currentChapterCursor.value,
    novelTargetWords: targetWords.value,
    novelAutoAdvanceChapter: autoAdvanceChapter.value
  })
}

function onSelectGenre(id: NovelGenreId): void {
  novelGenre.value = id
  if (id === 'custom_literary') {
    customGenreOpen.value = true
  }
  const builtInProtagonistNames = new Set(
    NOVEL_GENRE_PROFILES.map((p) => p.roster[0]?.name).filter(Boolean)
  )
  const firstRosterName = characterRoster.value[0]?.name ?? ''
  if (!characterRoster.value.length || builtInProtagonistNames.has(firstRosterName)) {
    characterRoster.value = createDefaultNovelCharacterRoster(
      activeWorkbench.value,
      totalChapters.value,
      activeGenreProfile.value
    )
    foreshadowingPool.value = createDefaultNovelForeshadowingPool(
      activeWorkbench.value,
      totalChapters.value,
      activeGenreProfile.value
    )
  }
  if (!worldBible.value.trim()) {
    seedWorldBibleFromSlice()
  } else {
    persistMemoryFields()
  }
  persistGenerateConfig()
  graphEditorHosts.bumpRevision()
}

function onCustomGenreOverridesChange(): void {
  persistGenerateConfig()
  graphEditorHosts.bumpRevision()
}

function applyGenreTemplateToMemory(): void {
  characterRoster.value = createDefaultNovelCharacterRoster(
    activeWorkbench.value,
    totalChapters.value,
    activeGenreProfile.value
  )
  foreshadowingPool.value = createDefaultNovelForeshadowingPool(
    activeWorkbench.value,
    totalChapters.value,
    activeGenreProfile.value
  )
  seedWorldBibleFromSlice()
  persistGenerateConfig()
  graphEditorHosts.bumpRevision()
}

function persistMemoryFields(): void {
  const current = node.value
  if (!current || !props.hostId) return
  graphEditorHosts.updateNode(props.hostId, current.id, {
    novelWorldBible: worldBible.value,
    novelStateLedger: stateLedger.value,
    novelRollingSummary: rollingSummary.value,
    novelChapterHistoryJson: chapterHistoryJson.value,
    novelCharacterRosterJson: JSON.stringify(characterRoster.value),
    novelForeshadowingJson: JSON.stringify(foreshadowingPool.value)
  })
  graphEditorHosts.bumpRevision()
}

function persistRosterAndForeshadowing(): void {
  persistMemoryFields()
}

function onTotalChaptersInput(raw: string): void {
  const val = Math.max(1, Math.min(5000, Math.round(Number(raw) || 800)))
  totalChapters.value = val
  if (currentChapterCursor.value > val) {
    currentChapterCursor.value = val
  }
  persistGenerateConfig()
  graphEditorHosts.bumpRevision()
}

function setTotalChaptersPreset(val: number): void {
  totalChapters.value = val
  if (currentChapterCursor.value > val) {
    currentChapterCursor.value = val
  }
  persistGenerateConfig()
  graphEditorHosts.bumpRevision()
}

function onTargetWordsInput(raw: string): void {
  targetWords.value = Math.max(1000, Math.min(15000, Math.round(Number(raw) || 3200)))
  persistGenerateConfig()
}

function onCursorInput(raw: string): void {
  currentChapterCursor.value = Math.max(
    1,
    Math.min(totalChapters.value, Math.round(Number(raw) || 1))
  )
  persistGenerateConfig()
  graphEditorHosts.bumpRevision()
}

function stepChapterCursor(delta: -1 | 1): void {
  const next = Math.max(1, Math.min(totalChapters.value, currentChapterCursor.value + delta))
  currentChapterCursor.value = next
  persistGenerateConfig()
  const matching = filteredChapterEntries.value.find((e) => e.chapterNumber === next)
  if (matching) {
    void selectChapter(matching.key, matching.index)
  } else {
    graphEditorHosts.bumpRevision()
  }
}

function onAutoAdvanceToggle(checked: boolean): void {
  autoAdvanceChapter.value = checked
  persistGenerateConfig()
}

function syncRunOutputsAfterGeneratedTextsChange(
  items: StoredGeneratedText[],
  selectedTextId?: string,
  overrideOutText?: string
): void {
  const current = node.value
  if (!current || !props.hostId) return
  const host = graphRunHosts.get(props.hostId)
  if (!host) return
  const prev = host.runStates[current.id] ?? { status: 'done' as const }
  const selectedId =
    selectedTextId?.trim() ||
    current.params.selectedTextId?.trim() ||
    items[items.length - 1]?.id ||
    ''
  const picked = items.find((item) => item.id === selectedId) || items[items.length - 1]
  const outTextVal = overrideOutText !== undefined ? overrideOutText : (picked?.text ?? '')
  host.runStates[current.id] = {
    ...prev,
    status: prev.status === 'idle' ? 'done' : prev.status,
    outputs: {
      ...(prev.outputs ?? {}),
      out: {
        kind: 'text',
        text: outTextVal,
        id: picked?.id,
        ...(picked?.title ? { title: picked.title } : {}),
        ...(overrideOutText === undefined && picked?.relativePath
          ? { relativePath: picked.relativePath }
          : {})
      },
      'out-all': {
        kind: 'texts',
        items: items.map((item) => ({
          id: item.id,
          ...(item.title ? { title: item.title } : {}),
          text: item.text,
          createdAt: item.createdAt,
          ...(item.relativePath ? { relativePath: item.relativePath } : {})
        }))
      }
    }
  }
}

let editorDebounceTimer: ReturnType<typeof setTimeout> | null = null

function onEditorInput(): void {
  if (editorDebounceTimer) clearTimeout(editorDebounceTimer)
  editorDebounceTimer = setTimeout(() => {
    persistNovelBody()
  }, 280)
}

function persistNovelBody(): void {
  if (editorDebounceTimer) {
    clearTimeout(editorDebounceTimer)
    editorDebounceTimer = null
  }
  const current = node.value
  if (!current || !props.hostId) return
  const nextText = localText.value
  const list = [...(current.params.generatedTexts ?? [])]
  const selectedId = current.params.selectedTextId?.trim() || list[list.length - 1]?.id || ''

  const nextHist = { ...parsedHistoryMap.value }
  if (nextText.trim()) {
    const cleanedLines = nextText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
    const tailAnchor = cleanedLines.slice(-4).join('\n').slice(-550)
    const chapNum = currentChapterCursor.value
    nextHist[String(chapNum)] = {
      chapter: chapNum,
      title: currentChapterTitle.value.trim() || `第${chapNum}章`, // cjk-ok
      wordCount: nextText.replace(/\s+/g, '').length,
      summary: cleanedLines[cleanedLines.length - 1]?.slice(-100) || '',
      tailAnchor,
      updatedAt: new Date().toISOString()
    }
    chapterHistoryJson.value = JSON.stringify(nextHist)
  }

  if (list.length > 0 && selectedId) {
    const idx = list.findIndex((item) => item.id === selectedId)
    if (idx >= 0) {
      const prevItem = list[idx]!
      const prevKnownText = (
        resolvedFullChapterText.value[selectedId] ??
        prevItem.text ??
        ''
      ).trim()
      const trimmedNext = nextText.trim()
      if (!trimmedNext && prevItem.relativePath?.trim() && !prevKnownText) {
        return
      }
      const textChanged = prevKnownText !== trimmedNext
      list[idx] = {
        ...prevItem,
        text: nextText,
        ...(textChanged ? { relativePath: undefined } : {})
      }
      resolvedFullChapterText.value = {
        ...resolvedFullChapterText.value,
        [selectedId]: trimmedNext
      }
    }
    syncRunOutputsAfterGeneratedTextsChange(list, selectedId)
    graphEditorHosts.updateNode(props.hostId, current.id, {
      text: nextText,
      generatedTexts: list,
      novelChapterHistoryJson: chapterHistoryJson.value
    })
  } else {
    const host = graphRunHosts.get(props.hostId)
    if (host) {
      const prev = host.runStates[current.id] ?? { status: 'done' as const }
      host.runStates[current.id] = {
        ...prev,
        status: prev.status === 'idle' ? 'done' : prev.status,
        outputs: {
          ...(prev.outputs ?? {}),
          out: { kind: 'text', text: nextText }
        }
      }
    }
    graphEditorHosts.updateNode(props.hostId, current.id, {
      text: nextText,
      novelChapterHistoryJson: chapterHistoryJson.value
    })
  }
  graphEditorHosts.bumpRevision()
}

function persistChapterTitle(): void {
  const current = node.value
  if (!current || !props.hostId) return
  const trimmedTitle = currentChapterTitle.value.trim()
  const list = [...(current.params.generatedTexts ?? [])]
  if (list.length === 0) {
    if (!trimmedTitle && !localText.value.trim()) return
    const id = `chap:${Date.now()}:1`
    const firstItem: StoredGeneratedText = {
      id,
      title: trimmedTitle || ui.value.defaultChapterTitle(currentChapterCursor.value),
      text: localText.value,
      createdAt: new Date().toISOString()
    }
    syncRunOutputsAfterGeneratedTextsChange([firstItem], id)
    graphEditorHosts.updateNode(props.hostId, current.id, {
      generatedTexts: [firstItem],
      selectedTextId: id,
      text: localText.value
    })
    graphEditorHosts.bumpRevision()
    return
  }
  const idx = activeChapterIndex()
  if (idx < 0 || !list[idx]) return
  list[idx] = {
    ...list[idx]!,
    title: trimmedTitle || ui.value.defaultChapterTitle(idx + 1)
  }
  const selectedId = list[idx]!.id || ''
  syncRunOutputsAfterGeneratedTextsChange(list, selectedId)
  graphEditorHosts.updateNode(props.hostId, current.id, {
    generatedTexts: list
  })
  graphEditorHosts.bumpRevision()
}

async function selectChapter(key: string, indexFallback?: number): Promise<void> {
  persistNovelBody()
  const current = node.value
  if (!current || !props.hostId) return
  const list = generatedTexts.value
  const idx = list.findIndex((entry, i) => (entry.id || `index:${i}`) === key)
  const item = idx >= 0 ? list[idx] : undefined
  if (!item?.id) return
  const body = (await loadGeneratedTextBody(item)).trim()
  const nextText = body || item.text?.trim() || ''
  localText.value = nextText === '…' ? '' : nextText
  const dispTitle = chapterDisplayTitle(item, idx >= 0 ? idx : (indexFallback ?? 0))
  currentChapterTitle.value = dispTitle
  const chapNum = extractChapterNumFromTitle(dispTitle, idx >= 0 ? idx : 0)
  currentChapterCursor.value = Math.max(1, Math.min(totalChapters.value, chapNum))
  syncRunOutputsAfterGeneratedTextsChange(list, item.id)
  graphEditorHosts.updateNode(props.hostId, current.id, {
    selectedTextId: item.id,
    text: localText.value,
    novelCurrentChapter: currentChapterCursor.value
  })
  graphEditorHosts.bumpRevision()
}

function toggleChapterCheck(key: string): void {
  if (checkedChapterKeys.value.includes(key)) {
    checkedChapterKeys.value = checkedChapterKeys.value.filter((k) => k !== key)
  } else {
    checkedChapterKeys.value = [...checkedChapterKeys.value, key]
  }
}

async function mergeCheckedChaptersToOutput(): Promise<void> {
  persistNovelBody()
  const current = node.value
  if (!current || !props.hostId || checkedChapterKeys.value.length < 2) return
  const pickedEntries = filteredChapterEntries.value
    .filter((e) => checkedChapterKeys.value.includes(e.key))
    .sort((a, b) => a.chapterNumber - b.chapterNumber)
  if (pickedEntries.length < 2) return

  const parts: string[] = []
  for (const entry of pickedEntries) {
    const body =
      (await loadGeneratedTextBody(entry.item)).trim() ||
      resolvedFullChapterText.value[entry.key] ||
      entry.item.text ||
      ''
    if (body) {
      parts.push(body)
    }
  }
  const mergedText = parts.join('\n\n---\n\n')
  if (!mergedText.trim()) return

  const list = [...generatedTexts.value]
  syncRunOutputsAfterGeneratedTextsChange(list, current.params.selectedTextId, mergedText)
  const chapNums = pickedEntries.map((e) => `第${e.chapterNumber}章`).join(' + ') // cjk-ok
  mergedOutputToast.value = isEn.value
    ? `✓ Merged ${pickedEntries.length} chapters into node output (out)`
    : `✓ 已将【${chapNums}】合并写入节点 out 输出端口，可直接推送给下游剧本节点！` // cjk-ok
  setTimeout(() => {
    mergedOutputToast.value = ''
  }, 3200)
}

function pushAndOpenDownstreamScreenplay(): void {
  persistNovelBody()
  const spNode = downstreamScreenplayNode.value
  if (!spNode || !props.hostId) return

  // Ensure current novel node output is fresh in graphRunHosts
  const list = [...generatedTexts.value]
  if (list.length > 0) {
    syncRunOutputsAfterGeneratedTextsChange(list, node.value?.params.selectedTextId)
  } else if (localText.value.trim() && node.value) {
    const host = graphRunHosts.get(props.hostId)
    if (host) {
      host.runStates[node.value.id] = {
        status: 'done',
        outputs: {
          out: { kind: 'text', text: localText.value }
        }
      }
    }
  }

  const meta = {
    viewId: 'screenplay.workbench' as const,
    hostId: props.hostId,
    nodeId: spNode.id
  }
  const spTitle = spNode.title?.trim() || '创建剧本' // cjk-ok
  if (editorDive) {
    void editorDive.diveView(meta, spTitle)
    return
  }
  const rootKey = workspace.activeDiveRootKey?.trim()
  if (rootKey) {
    workspace.diveIntoView(rootKey, meta, spTitle)
  }
}

function addNewChapter(): void {
  persistNovelBody()
  const current = node.value
  if (!current || !props.hostId) return
  const now = new Date().toISOString()
  const baseStamp = Date.now()
  const list = [...generatedTexts.value]

  if (list.length === 0 && localText.value.trim()) {
    const ch1Title = currentChapterTitle.value.trim() || ui.value.defaultChapterTitle(1)
    list.push({
      id: `chap:${baseStamp}:1`,
      title: ch1Title,
      text: localText.value.trim(),
      createdAt: now
    })
  }

  const nextIndex = list.length + 1
  const newId = `chap:${baseStamp}:${nextIndex}`
  const newTitle = isEn.value ? `Chapter ${nextIndex}: New Chapter` : `第${nextIndex}章：新章节` // cjk-ok
  const newBody = `# ${newTitle}\n\n`

  list.push({
    id: newId,
    title: newTitle,
    text: newBody,
    createdAt: now
  })

  localText.value = newBody
  currentChapterTitle.value = newTitle
  currentChapterCursor.value = Math.min(totalChapters.value, nextIndex)
  syncRunOutputsAfterGeneratedTextsChange(list, newId)
  graphEditorHosts.updateNode(props.hostId, current.id, {
    generatedTexts: list,
    selectedTextId: newId,
    text: newBody,
    novelCurrentChapter: currentChapterCursor.value
  })
  graphEditorHosts.bumpRevision()
}

function duplicateChapter(index: number): void {
  persistNovelBody()
  const current = node.value
  if (!current || !props.hostId) return
  const list = [...generatedTexts.value]
  const source = list[index]
  if (!source) return
  const key = source.id || `index:${index}`
  const sourceBody = resolvedFullChapterText.value[key] || source.text || localText.value
  const newId = `chap:${Date.now()}:copy`
  const copyTitle = `${chapterDisplayTitle(source, index)} (Copy)`
  const copyItem: StoredGeneratedText = {
    id: newId,
    title: copyTitle,
    text: sourceBody,
    createdAt: new Date().toISOString()
  }
  list.splice(index + 1, 0, copyItem)
  localText.value = sourceBody
  currentChapterTitle.value = copyTitle
  syncRunOutputsAfterGeneratedTextsChange(list, newId)
  graphEditorHosts.updateNode(props.hostId, current.id, {
    generatedTexts: list,
    selectedTextId: newId,
    text: sourceBody
  })
  graphEditorHosts.bumpRevision()
}

function moveChapter(index: number, delta: -1 | 1): void {
  const current = node.value
  if (!current || !props.hostId) return
  const list = [...generatedTexts.value]
  const targetIndex = index + delta
  if (targetIndex < 0 || targetIndex >= list.length) return
  const [moved] = list.splice(index, 1)
  if (!moved) return
  list.splice(targetIndex, 0, moved)
  const selectedId = current.params.selectedTextId || moved.id || ''
  syncRunOutputsAfterGeneratedTextsChange(list, selectedId)
  graphEditorHosts.updateNode(props.hostId, current.id, {
    generatedTexts: list
  })
  graphEditorHosts.bumpRevision()
}

function removeGeneratedText(textId: string | undefined): void {
  const current = node.value
  if (!current || !props.hostId || !textId) return
  const removed = (current.params.generatedTexts ?? []).find((item) => item.id === textId)
  const next = (current.params.generatedTexts ?? []).filter((item) => item.id !== textId)
  const nextSelected =
    current.params.selectedTextId === textId
      ? next[next.length - 1]?.id || ''
      : current.params.selectedTextId || next[next.length - 1]?.id || ''
  const latest = next.find((item) => item.id === nextSelected) || next[next.length - 1]
  const nextBody = latest?.text?.trim()
    ? latest.text
    : latest?.id
      ? resolvedFullChapterText.value[latest.id] || ''
      : ''
  localText.value = nextBody
  syncRunOutputsAfterGeneratedTextsChange(next, nextSelected)
  graphEditorHosts.updateNode(props.hostId, current.id, {
    generatedTexts: next,
    selectedTextId: nextSelected,
    text: nextBody
  })
  graphEditorHosts.bumpRevision()

  const relativePath = removed?.relativePath?.trim()
  if (relativePath) {
    invalidateAssetUrlCache(relativePath)
    void window.studio.deleteGraphRunMedia(relativePath).catch((err) => {
      console.warn('[EditorDiveNovelView] delete graph text failed', relativePath, err)
    })
  }
}

function handleSplitChapters(): void {
  const current = node.value
  if (!current || !props.hostId || !localText.value.trim()) return
  const raw = localText.value.replace(/\r\n/g, '\n')
  const lines = raw.split('\n')

  const headerIndices: Array<{ lineIdx: number; title: string }> = []
  const chapHeaderRe = /^(?:#+\s*)?(第\s*\d+\s*(?:\/\s*\d+\s*)?章[^\n]*|Chapter\s+\d+[^\n]*)$/i // cjk-ok
  lines.forEach((line, idx) => {
    const trimmed = line.trim()
    const m = chapHeaderRe.exec(trimmed)
    if (m) {
      headerIndices.push({ lineIdx: idx, title: m[1]!.trim() })
    }
  })

  if (headerIndices.length < 2) return

  const sharedPreamble = lines.slice(0, headerIndices[0]!.lineIdx).join('\n').trim()
  const now = new Date().toISOString()
  const stamp = Date.now()

  const nextList: StoredGeneratedText[] = headerIndices.map((hdr, idx) => {
    const endLine = idx + 1 < headerIndices.length ? headerIndices[idx + 1]!.lineIdx : lines.length
    const chapBody = lines.slice(hdr.lineIdx, endLine).join('\n').trim()
    const fullText = sharedPreamble ? `${sharedPreamble}\n\n${chapBody}` : chapBody
    return {
      id: `chap:${stamp}:${idx + 1}`,
      title: hdr.title,
      text: fullText,
      createdAt: now
    }
  })

  const first = nextList[0]!
  localText.value = first.text
  currentChapterTitle.value = first.title || ''
  currentChapterCursor.value = 1
  syncRunOutputsAfterGeneratedTextsChange(nextList, first.id)
  graphEditorHosts.updateNode(props.hostId, current.id, {
    generatedTexts: nextList,
    selectedTextId: first.id,
    text: first.text,
    novelCurrentChapter: 1
  })
  graphEditorHosts.bumpRevision()

  splitDoneCount.value = nextList.length
  setTimeout(() => {
    splitDoneCount.value = 0
  }, 2200)
}

function triggerGenerateCurrentChapter(): void {
  persistNovelBody()
  persistGenerateConfig()
  persistMemoryFields()
  if (hasInPort.value && !blocked.value && runStatus.value !== 'running') {
    toggleRun()
  }
}

function triggerAiNextChapter(): void {
  persistNovelBody()
  const current = node.value
  if (!current || !props.hostId) return

  const list = [...generatedTexts.value]
  if (list.length === 0 && localText.value.trim()) {
    const firstId = `chap:${Date.now()}:1`
    const firstItem: StoredGeneratedText = {
      id: firstId,
      title: currentChapterTitle.value.trim() || ui.value.defaultChapterTitle(1),
      text: localText.value,
      createdAt: new Date().toISOString()
    }
    graphEditorHosts.updateNode(props.hostId, current.id, {
      generatedTexts: [firstItem],
      selectedTextId: firstId
    })
  }

  const maxExistingChap = filteredChapterEntries.value.reduce(
    (acc, e) => Math.max(acc, e.chapterNumber),
    0
  )
  const nextChap = Math.min(
    totalChapters.value,
    Math.max(currentChapterCursor.value, maxExistingChap + 1)
  )
  currentChapterCursor.value = nextChap
  const slice = exportMxChapterNumericalSlice(
    activeWorkbench.value,
    nextChap,
    totalChapters.value,
    activeGenreProfile.value
  )
  const gp = activeGenreProfile.value
  const allowedStr = slice.allowedTrumpCards.slice(0, 3).join('、') || `当前准入${gp.unlockTermZh}` // cjk-ok
  instruction.value = isEn.value
    ? `Write Chapter ${nextChap} / ${totalChapters.value} (${targetWords.value}+ words, Genre: ${gp.labelEn}): seamlessly continue from Chapter ${Math.max(1, nextChap - 1)}'s ending hook. Pacing role: ${slice.chapterBeatType}. Keep ${gp.stageTermEn} within ${slice.realmStageLabelZh} (${gp.protagonistAxisEn} ${slice.powerCeiling}), use allowed ${gp.unlockTermEn} (${allowedStr}), and end with a strong cliffhanger.`
    : `创作第 ${nextChap} / ${totalChapters.value} 章（流派：${gp.labelZh}，单章满 ${targetWords.value}+ 字）：第一段无缝咬合第 ${Math.max(1, nextChap - 1)} 章末尾悬念钩子。本章所属【${slice.volumeTitleZh}】，戏剧节拍定位为「${slice.chapterBeatLabelZh}」；主角当前${gp.stageTermZh}锁死在【${slice.realmStageLabelZh}】（${gp.protagonistAxisZh} ${slice.powerCeiling} vs ${gp.antagonistAxisZh} ${slice.villainPressure}），仅准许动用${gp.unlockTermZh}【${allowedStr}】，章末留高能断章悬念钩子。` // cjk-ok
  persistGenerateConfig()
  persistMemoryFields()
  if (hasInPort.value && !blocked.value && runStatus.value !== 'running') {
    toggleRun()
  }
}

function applyArcPlanItem(item: MxChapterOutlinePlanItem, runImmediately: boolean): void {
  persistNovelBody()
  currentChapterCursor.value = item.chapter
  instruction.value = isEn.value ? item.outlinePromptEn : item.outlinePromptZh
  persistGenerateConfig()
  persistMemoryFields()
  if (runImmediately) {
    if (hasInPort.value && !blocked.value && runStatus.value !== 'running') {
      toggleRun()
    }
  } else {
    rightTab.value = 'pacing'
  }
}

function startBatchAutoSerialize(): void {
  if (isGraphRunning.value || runStatus.value === 'running') return
  persistNovelBody()
  autoAdvanceChapter.value = true
  batchRemainingCount.value = Math.max(1, Math.min(10, batchChapterCount.value))
  batchRunning.value = true

  const curChap = currentChapterCursor.value
  const planMatch = arcOutlinePlan.value.find((p) => p.chapter === curChap)
  if (planMatch) {
    instruction.value = isEn.value ? planMatch.outlinePromptEn : planMatch.outlinePromptZh
  }
  persistGenerateConfig()
  persistMemoryFields()
  if (hasInPort.value && !blocked.value) {
    toggleRun()
  } else {
    batchRunning.value = false
  }
}

function stopBatchAutoSerialize(): void {
  batchRunning.value = false
  batchRemainingCount.value = 0
}

function fixLeakedLockedTrumpsInPlace(): void {
  const leaked = chapterAudit.value.leakedLockedTrumps
  if (!leaked.length || !localText.value.trim()) return
  const replacement = chapterSlice.value.allowedTrumpCards[0] || '本阶段准入信物' // cjk-ok
  let updated = localText.value
  for (const badCard of leaked) {
    if (badCard && badCard.trim()) {
      updated = updated.split(badCard.trim()).join(replacement)
    }
  }
  localText.value = updated
  persistNovelBody()
}

function updateSelectionRange(): void {
  const el = editorTextareaRef.value
  if (!el) {
    selectionStartIdx.value = 0
    selectionEndIdx.value = 0
    return
  }
  selectionStartIdx.value = el.selectionStart ?? 0
  selectionEndIdx.value = el.selectionEnd ?? 0
}

function boostSelectedPassage(
  mode: 'slap_reaction' | 'sensory_expand' | 'fix_power_trumps' | 'cliffhanger_hook'
): void {
  const el = editorTextareaRef.value
  const start = selectionStartIdx.value
  const end = selectionEndIdx.value
  if (!el || end <= start) return

  const before = localText.value.slice(0, start)
  const selected = localText.value.slice(start, end)
  const after = localText.value.slice(end)
  const s = chapterSlice.value
  const gp = activeGenreProfile.value
  const topTrump = s.allowedTrumpCards[0] || gp.unlockItemsZh[0] || '核心筹码' // cjk-ok
  const vars = {
    stage: s.realmStageLabelZh,
    unlock: topTrump,
    unlockTop: topTrump,
    pressure: s.villainPressure,
    ceiling: s.powerCeiling,
    item: s.recommendedEncounterItem
  }

  let replaced = selected
  if (mode === 'fix_power_trumps') {
    for (const lockedCard of s.lockedEndgameTrumps) {
      if (lockedCard.trim()) {
        replaced = replaced.split(lockedCard.trim()).join(topTrump)
      }
    }
    replaced = `${replaced.trim()}（当前【${s.realmStageLabelZh}】${gp.protagonistAxisZh}运转至本章上限 ${s.powerCeiling}，动用准入${gp.unlockTermZh}【${topTrump}】）` // cjk-ok
  } else if (mode === 'slap_reaction') {
    const addon = isEn.value
      ? `\n\nThe moment [${topTrump}] was revealed, the entire scene shifted in an instant!`
      : `\n\n${fillNovelGenreTemplate(gp.polish.slapAddonZh, vars)}`
    replaced = `${selected.trimEnd()}${addon}`
  } else if (mode === 'sensory_expand') {
    const addon = isEn.value
      ? `\n\nTension thickened the air as ${s.realmStageLabelZh} confronted threat (${s.villainPressure}).`
      : `\n\n${fillNovelGenreTemplate(gp.polish.expandAddonZh, vars)}`
    replaced = `${selected.trimEnd()}${addon}`
  } else if (mode === 'cliffhanger_hook') {
    const addon = isEn.value
      ? `\n\nSuddenly, a new clue connected to [${s.recommendedEncounterItem}] surfaced!`
      : `\n\n${fillNovelGenreTemplate(gp.polish.hookAddonZh, vars)}`
    replaced = `${selected.trimEnd()}${addon}`
  }

  localText.value = `${before}${replaced}${after}`
  persistNovelBody()
  void nextTick(() => {
    el.focus()
    el.setSelectionRange(start, start + replaced.length)
    updateSelectionRange()
  })
}

const novelAiPresets = computed(() => {
  const chap = currentChapterCursor.value
  const tot = totalChapters.value
  const words = targetWords.value
  const slice = chapterSlice.value
  const gp = activeGenreProfile.value
  const b = gp.beats
  const allowed = slice.allowedTrumpCards.slice(0, 3).join('、') || `本阶段准入${gp.unlockTermZh}` // cjk-ok
  const vars = {
    stage: slice.realmStageLabelZh,
    item: slice.recommendedEncounterItem,
    unlock: slice.allowedTrumpCards[0] || allowed,
    unlockTop: allowed,
    pressure: slice.villainPressure,
    ceiling: slice.powerCeiling
  }
  if (isEn.value) {
    return [
      {
        key: 'setup',
        label: `Ch.${chap} · ${b.setup_endure.badgeEn}`,
        prompt: `Write Chapter ${chap}/${tot} (${words}+ words, ${gp.labelEn}): ${b.setup_endure.titleEn}. ${fillNovelGenreTemplate(b.setup_endure.coreConflictZh, vars)}`
      },
      {
        key: 'encounter',
        label: `Ch.${chap} · ${b.encounter_growth.badgeEn}`,
        prompt: `Write Chapter ${chap}/${tot} (${words}+ words, ${gp.labelEn}): ${b.encounter_growth.titleEn}. ${fillNovelGenreTemplate(b.encounter_growth.coreConflictZh, vars)}`
      },
      {
        key: 'cliffhanger',
        label: `Ch.${chap} · ${b.villain_suppression_cliffhanger.badgeEn}`,
        prompt: `Write Chapter ${chap}/${tot} (${words}+ words, ${gp.labelEn}): ${b.villain_suppression_cliffhanger.titleEn}. ${fillNovelGenreTemplate(b.villain_suppression_cliffhanger.coreConflictZh, vars)}`
      },
      {
        key: 'climax',
        label: `Ch.${chap} · ${b.climax_reversal_slap.badgeEn}`,
        prompt: `Write Chapter ${chap}/${tot} (${words}+ words, ${gp.labelEn}): ${b.climax_reversal_slap.titleEn}. ${fillNovelGenreTemplate(b.climax_reversal_slap.coreConflictZh, vars)}`
      }
    ]
  }
  return [
    {
      key: 'setup',
      label: `第${chap}章 · ${b.setup_endure.badgeZh}`, // cjk-ok
      prompt: `精写第 ${chap}/${tot} 章（${words}+ 字 · ${gp.labelZh}）：【${b.setup_endure.labelZh}】。${fillNovelGenreTemplate(b.setup_endure.coreConflictZh, vars)} 章末钩子：${fillNovelGenreTemplate(b.setup_endure.cliffhangerZh, vars)}` // cjk-ok
    },
    {
      key: 'encounter',
      label: `第${chap}章 · ${b.encounter_growth.badgeZh}`, // cjk-ok
      prompt: `精写第 ${chap}/${tot} 章（${words}+ 字 · ${gp.labelZh}）：【${b.encounter_growth.labelZh}】。${fillNovelGenreTemplate(b.encounter_growth.coreConflictZh, vars)} 章末钩子：${fillNovelGenreTemplate(b.encounter_growth.cliffhangerZh, vars)}` // cjk-ok
    },
    {
      key: 'cliffhanger',
      label: `第${chap}章 · ${b.villain_suppression_cliffhanger.badgeZh}`, // cjk-ok
      prompt: `精写第 ${chap}/${tot} 章（${words}+ 字 · ${gp.labelZh}）：【${b.villain_suppression_cliffhanger.labelZh}】。${fillNovelGenreTemplate(b.villain_suppression_cliffhanger.coreConflictZh, vars)} 章末钩子：${fillNovelGenreTemplate(b.villain_suppression_cliffhanger.cliffhangerZh, vars)}` // cjk-ok
    },
    {
      key: 'climax',
      label: `第${chap}章 · ${b.climax_reversal_slap.badgeZh}`, // cjk-ok
      prompt: `精写第 ${chap}/${tot} 章（${words}+ 字 · ${gp.labelZh}）：【${b.climax_reversal_slap.labelZh}】。${fillNovelGenreTemplate(b.climax_reversal_slap.coreConflictZh, vars)} 章末钩子：${fillNovelGenreTemplate(b.climax_reversal_slap.cliffhangerZh, vars)}` // cjk-ok
    }
  ]
})

function applyNovelAiPreset(promptText: string): void {
  instruction.value = promptText
  persistGenerateConfig()
}

function injectNumericalSliceIntoInstruction(): void {
  const s = chapterSlice.value
  const gp = activeGenreProfile.value
  const allowed = s.allowedTrumpCards.join('、') || '—'
  const locked = s.lockedEndgameTrumps.join('、') || '—'
  const snippet = isEn.value
    ? `[Chapter ${s.chapterIndex}/${s.totalChapters} Numerical Quota Lock (${gp.labelEn})]\n- Volume: ${s.volumeTitleZh}\n- Pacing Beat: ${s.chapterBeatType}\n- ${gp.stageTermEn}: ${s.realmStageLabelZh} (${gp.protagonistAxisEn} ${s.powerCeiling} vs ${gp.antagonistAxisEn} ${s.villainPressure})\n- Allowed ${gp.unlockTermEn}: ${allowed}\n- Locked Endgame ${gp.unlockTermEn}: ${locked}`
    : `【第 ${s.chapterIndex}/${s.totalChapters} 章数值配额与节拍指令（${gp.labelZh}）】\n- 所属篇章：${s.volumeTitleZh}\n- 本章戏剧定位：${s.chapterBeatLabelZh}\n- ${gp.stageTermZh}与上限：${s.realmStageLabelZh}（本章${gp.protagonistAxisZh} ${s.powerCeiling} vs ${gp.antagonistAxisZh} ${s.villainPressure}）\n- ✅ 本章准许动用${gp.unlockTermZh}：${allowed}\n- 🔒 严禁提前动用的封存${gp.unlockTermZh}：${locked}\n- 🎁 本章推荐${gp.encounterTermZh}：${s.recommendedEncounterItem}` // cjk-ok
  instruction.value = instruction.value.trim()
    ? `${instruction.value.trim()}\n\n${snippet}`
    : snippet
  persistGenerateConfig()
}

function seedWorldBibleFromSlice(): void {
  const wb = activeWorkbench.value
  const s = chapterSlice.value
  const gp = activeGenreProfile.value
  worldBible.value = [
    `- 小说题材与流派：${gp.icon} ${gp.labelZh}（全书动态总章数规划：${totalChapters.value} 章，单章目标 ${targetWords.value}+ 字）`, // cjk-ok
    `- 核心数值驱动体系：${wb.multiplier.title} · 乘区公式 ${wb.multiplier.finalFormula}`, // cjk-ok
    `- 当前所属篇章：${s.volumeTitleZh}（${gp.stageTermZh}阶梯：${gp.stageNamesZh.join(' → ')}）`, // cjk-ok
    ...gp.worldBibleSeedZh
  ].join('\n')
  persistMemoryFields()
}

function refreshStateLedgerFromCurrent(): void {
  const s = chapterSlice.value
  const gp = activeGenreProfile.value
  const cleanedLines = localText.value
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  const lastHook = cleanedLines[cleanedLines.length - 1]?.slice(-100) || '章末悬念待解' // cjk-ok
  stateLedger.value = [
    `- 最新结算章节：第 ${currentChapterCursor.value} / ${totalChapters.value} 章《${currentChapterTitle.value.trim() || `第${currentChapterCursor.value}章`}》（正文字数：${currentChapterStats.value.wordCount} 字）`, // cjk-ok
    `- 主角当前${gp.stageTermZh}：${s.realmStageLabelZh}（${gp.protagonistAxisZh}：${s.powerCeiling} vs ${gp.antagonistAxisZh}：${s.villainPressure}）`, // cjk-ok
    `- 当前已解锁准入${gp.unlockTermZh}：${s.allowedTrumpCards.join('、') || '基础筹码'}`, // cjk-ok
    `- 仍处于封存禁用的后期${gp.unlockTermZh}：${s.lockedEndgameTrumps.join('、') || '无'}`, // cjk-ok
    `- 待下一章承接的章末悬念钩子：${lastHook}` // cjk-ok
  ].join('\n')
  persistMemoryFields()
}

function syncPrevTailAnchorFromPreviousChapter(): void {
  const prevChap = currentChapterCursor.value - 1
  if (prevChap < 1) return
  const matchEntry = filteredChapterEntries.value.find((e) => e.chapterNumber === prevChap)
  if (!matchEntry) return
  const full = resolvedFullChapterText.value[matchEntry.key] ?? matchEntry.item.text ?? ''
  if (!full.trim()) return
  const cleanedLines = full
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  const tailAnchor = cleanedLines.slice(-4).join('\n').slice(-550)
  const nextHist = { ...parsedHistoryMap.value }
  nextHist[String(prevChap)] = {
    chapter: prevChap,
    title: matchEntry.displayTitle,
    wordCount: full.replace(/\s+/g, '').length,
    summary: cleanedLines[cleanedLines.length - 1]?.slice(-100) || '',
    tailAnchor,
    updatedAt: new Date().toISOString()
  }
  chapterHistoryJson.value = JSON.stringify(nextHist)
  persistMemoryFields()
}

async function switchToPeerNodeDive(
  meta: {
    viewId: 'game.workbench' | 'gameSystem.workbench' | 'screenplay.workbench'
    hostId: string
    nodeId: string
  },
  title: string
): Promise<void> {
  workspace.selectGraphNode(meta.nodeId, meta.hostId)
  if (editorDive) {
    const idx = editorDive.frames.findIndex((f) => f.key === props.frameKey)
    await editorDive.popTo(idx <= 0 ? -1 : idx - 1)
    await editorDive.diveView(meta, title)
    return
  }
  const rootKey = workspace.activeDiveRootKey?.trim()
  if (rootKey) {
    workspace.divePopTo(rootKey, -1)
    workspace.diveIntoView(rootKey, meta, title)
  }
}

function openUpstreamEconomyWorkbench(): void {
  const cur = node.value
  if (!cur || !props.hostId) return
  let econ = upstreamEconomyNode.value
  if (!econ) {
    const newId = graphEditorHosts.addNode(props.hostId, {
      typeId: 'game.economy',
      title: isEn.value ? 'Economy & Numerical System' : '经济系统', // cjk-ok
      position: {
        x: Math.max(40, (cur.position?.x ?? 400) - 380),
        y: cur.position?.y ?? 200
      }
    })
    if (newId) {
      econ = graphEditorHosts.getNode(props.hostId, newId)
    }
  }
  if (!econ) return
  const hasEdge = (graphEditorHosts.getDocument(props.hostId)?.edges ?? []).some(
    (e) => e.source === econ!.id && e.target === cur.id
  )
  if (!hasEdge) {
    graphEditorHosts.connectNodes(props.hostId, econ.id, cur.id, 'out-text', 'in')
  }
  const meta = {
    viewId: 'game.workbench' as const,
    hostId: props.hostId,
    nodeId: econ.id
  }
  const econTitle = econ.title?.trim() || '经济系统' // cjk-ok
  switchToPeerNodeDive(meta, econTitle)
}

function pushAndOpenDownstreamGameSystem(): void {
  flushAll()
  const cur = node.value
  if (!cur || !props.hostId) return
  const doc = graphEditorHosts.getDocument(props.hostId)
  let gsNode: GraphNode | null = null
  if (doc?.edges) {
    for (const edge of doc.edges) {
      if (edge.source === cur.id) {
        const tgt = graphEditorHosts.getNode(props.hostId, edge.target)
        if (tgt?.typeId === 'asset.gameSystem') {
          gsNode = tgt
          break
        }
      }
    }
  }
  if (!gsNode) {
    gsNode = graphEditorHosts.findNode(props.hostId, (n) => n.typeId === 'asset.gameSystem')
  }
  if (!gsNode) {
    const linkSources: { nodeId: string; portId?: string }[] = [{ nodeId: cur.id, portId: 'out' }]
    if (upstreamEconomyNode.value) {
      linkSources.unshift({ nodeId: upstreamEconomyNode.value.id, portId: 'out-text' })
    }
    const newId = graphEditorHosts.addNode(props.hostId, {
      typeId: 'asset.gameSystem',
      title: isEn.value ? 'Game System Plan' : '策划案生成', // cjk-ok
      position: {
        x: (cur.position?.x ?? 400) + 380,
        y: (cur.position?.y ?? 200) + 120
      },
      linkFrom: linkSources
    })
    if (newId) {
      gsNode = graphEditorHosts.getNode(props.hostId, newId)
    }
  } else {
    const edges = graphEditorHosts.getDocument(props.hostId)?.edges ?? []
    if (!edges.some((e) => e.source === cur.id && e.target === gsNode!.id)) {
      graphEditorHosts.connectNodes(props.hostId, cur.id, gsNode.id, 'out', 'in')
    }
    if (
      upstreamEconomyNode.value &&
      !edges.some((e) => e.source === upstreamEconomyNode.value!.id && e.target === gsNode!.id)
    ) {
      graphEditorHosts.connectNodes(
        props.hostId,
        upstreamEconomyNode.value.id,
        gsNode.id,
        'out-text',
        'in'
      )
    }
  }
  if (!gsNode) return
  const meta = {
    viewId: 'gameSystem.workbench' as const,
    hostId: props.hostId,
    nodeId: gsNode.id
  }
  const gsTitle = gsNode.title?.trim() || (isEn.value ? 'Game System Plan' : '策划案生成') // cjk-ok
  switchToPeerNodeDive(meta, gsTitle)
}

function insertAtCursorOrAppend(snippet: string): void {
  const el = editorTextareaRef.value
  const base = localText.value
  if (!base.trim() || base.trim() === '…') {
    localText.value = snippet.trimStart()
    persistNovelBody()
    return
  }
  if (el && typeof el.selectionStart === 'number') {
    const start = el.selectionStart
    const end = el.selectionEnd ?? start
    const before = base.slice(0, start)
    const after = base.slice(end)
    const cleanSnippet = snippet.trim()
    const prefix = before.length > 0 && !before.endsWith('\n') ? '\n\n' : ''
    const suffix = after.length > 0 && !after.startsWith('\n') ? '\n\n' : ''
    const inserted = `${prefix}${cleanSnippet}${suffix}`
    localText.value = `${before}${inserted}${after}`
    persistNovelBody()
    void nextTick(() => {
      el.focus()
      const nextPos = start + inserted.length
      el.setSelectionRange(nextPos, nextPos)
    })
    return
  }
  localText.value = `${base.trimEnd()}\n\n${snippet.trimStart()}`
  persistNovelBody()
}

function insertCharacterProfileBlock(): void {
  const s = chapterSlice.value
  const gp = activeGenreProfile.value
  const hero = characterRoster.value.find((c) => c.faction === 'protagonist')
  const foe = characterRoster.value.find((c) => c.faction === 'villain')
  const heroName = hero?.name || gp.roster[0]?.name || '林玄' // cjk-ok
  const heroNote = hero?.relationNote || gp.roster[0]?.note || '谋定后动，果决坚韧' // cjk-ok
  const foeName = foe?.name || '本幕对手' // cjk-ok
  const snippet = isEn.value
    ? `## [Core Character Profiles (${gp.labelEn})]\n- **${heroName}** (${s.realmStageLabelZh}, ${gp.protagonistAxisEn} ${s.powerCeiling}): ${heroNote}. Allowed ${gp.unlockTermEn}: [${s.allowedTrumpCards.slice(0, 2).join(', ')}].\n- **${foeName}** (${gp.antagonistAxisEn} ${s.villainPressure}): Primary opposition in this arc.`
    : `## 【核心人物档案 · ${gp.labelZh}】\n- **${heroName}（当前${gp.stageTermZh}：${s.realmStageLabelZh} · ${gp.protagonistAxisZh} ${s.powerCeiling}）**：${heroNote}；本章可用${gp.unlockTermZh}【${s.allowedTrumpCards.slice(0, 2).join(' / ') || '核心筹码'}】。\n- **${foeName}（${gp.antagonistAxisZh}：${s.villainPressure}）**：${foe?.relationNote || '本幕核心对立势力'}。` // cjk-ok
  if (!localText.value.trim()) {
    localText.value = snippet
  } else {
    localText.value = `${snippet}\n\n${localText.value.trimStart()}`
  }
  persistNovelBody()
}

function insertBeatMarker(beatIndex: 1 | 2 | 3 | 4): void {
  const s = chapterSlice.value
  const gp = activeGenreProfile.value
  const b = gp.beats
  const mapZh: Record<1 | 2 | 3 | 4, string> = {
    1: `### 【第一拍 · ${b.setup_endure.badgeZh}：${b.setup_endure.labelZh}】\n`, // cjk-ok
    2: `### 【第二拍 · ${b.encounter_growth.badgeZh}：${b.encounter_growth.labelZh}】\n`, // cjk-ok
    3: `### 【第三拍 · ${b.villain_suppression_cliffhanger.badgeZh}（${gp.antagonistAxisZh} ${s.villainPressure}）】\n`, // cjk-ok
    4: `### 【第四拍 · ${b.climax_reversal_slap.badgeZh}（动用${gp.unlockTermZh}：${s.allowedTrumpCards.slice(0, 2).join(' / ') || '核心筹码'}）】\n` // cjk-ok
  }
  const mapEn: Record<1 | 2 | 3 | 4, string> = {
    1: `### [Beat 1 · ${b.setup_endure.badgeEn}]\n`,
    2: `### [Beat 2 · ${b.encounter_growth.badgeEn}]\n`,
    3: `### [Beat 3 · ${b.villain_suppression_cliffhanger.badgeEn} (${s.villainPressure})]\n`,
    4: `### [Beat 4 · ${b.climax_reversal_slap.badgeEn}]\n`
  }
  insertAtCursorOrAppend(isEn.value ? mapEn[beatIndex] : mapZh[beatIndex])
}

function formatNovelManuscript(): void {
  if (!localText.value.trim()) return
  const lines = localText.value
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.trim())
  const formatted: string[] = []
  for (const line of lines) {
    if (!line) {
      if (formatted.length > 0 && formatted[formatted.length - 1] !== '') {
        formatted.push('')
      }
      continue
    }
    formatted.push(line)
  }
  localText.value = formatted.join('\n').trim()
  persistNovelBody()
  formatFlash.value = true
  setTimeout(() => {
    formatFlash.value = false
  }, 1400)
}

function jumpToArcPlanChapter(chapNo: number): void {
  const planItem = arcOutlinePlan.value.find((p) => p.chapter === chapNo)
  if (!planItem) return
  currentChapterCursor.value = chapNo
  instruction.value = isEn.value ? planItem.outlinePromptEn : planItem.outlinePromptZh
  persistGenerateConfig()
  const matching = filteredChapterEntries.value.find((e) => e.chapterNumber === chapNo)
  if (matching) {
    void selectChapter(matching.key, matching.index)
  } else {
    graphEditorHosts.bumpRevision()
  }
}

function fixRevivedCharactersInPlace(): void {
  const revived = chapterAudit.value.revivedEliminatedCharacters ?? []
  if (!revived.length || !localText.value.trim()) return
  const activeVillain =
    characterRoster.value.find((c) => c.faction === 'villain' && c.status === 'active')?.name ||
    '幕后主使' // cjk-ok
  let updated = localText.value
  for (const deadName of revived) {
    if (deadName && deadName.trim()) {
      updated = updated.split(deadName.trim()).join(activeVillain)
    }
  }
  localText.value = updated
  persistNovelBody()
}

function seedRosterAndForeshadowing(): void {
  characterRoster.value = createDefaultNovelCharacterRoster(
    activeWorkbench.value,
    totalChapters.value,
    activeGenreProfile.value
  )
  foreshadowingPool.value = createDefaultNovelForeshadowingPool(
    activeWorkbench.value,
    totalChapters.value,
    activeGenreProfile.value
  )
  persistMemoryFields()
}

function addRosterCharacter(): void {
  const s = chapterSlice.value
  characterRoster.value = [
    ...characterRoster.value,
    {
      id: `char_${Date.now()}`,
      name: isEn.value
        ? `New Villain (Ch.${currentChapterCursor.value})`
        : `第${currentChapterCursor.value}章新反派`, // cjk-ok
      faction: 'villain',
      realmOrRole: s.realmStageLabelZh,
      status: 'active',
      relationNote: isEn.value
        ? `Appears in Ch.${currentChapterCursor.value}, threat ${s.villainPressure}`
        : `第 ${currentChapterCursor.value} 章登场施压（威胁值 ${s.villainPressure}）`, // cjk-ok
      updatedAtChapter: currentChapterCursor.value
    }
  ]
  persistMemoryFields()
}

function removeRosterCharacter(idx: number): void {
  characterRoster.value = characterRoster.value.filter((_, i) => i !== idx)
  persistMemoryFields()
}

function onCharacterStatusChange(item: MxNovelCharacterStatusEntry): void {
  item.updatedAtChapter = currentChapterCursor.value
  if (item.status === 'eliminated' && !item.relationNote.includes(/* cjk-ok */ '退场')) {
    item.relationNote = `${item.relationNote}（第${currentChapterCursor.value}章已清算退场）` // cjk-ok
  }
  persistMemoryFields()
}

function addForeshadowingItem(): void {
  const cur = currentChapterCursor.value
  const payStart = Math.min(totalChapters.value, cur + 3)
  const payEnd = Math.min(totalChapters.value, cur + 10)
  foreshadowingPool.value = [
    ...foreshadowingPool.value,
    {
      id: `fs_${Date.now()}`,
      title: isEn.value
        ? `Mystery Clue (${chapterSlice.value.recommendedEncounterItem})`
        : `【${chapterSlice.value.recommendedEncounterItem}】背后的身世暗线`, // cjk-ok
      plantedChapter: cur,
      targetPayoffChapterRange: [payStart, payEnd],
      status: 'planted',
      payoffHint: isEn.value
        ? `Planted in Ch.${cur}; reveal mastermind identity in Ch.${payStart}~${payEnd}.`
        : `第 ${cur} 章埋设线索，规划在第 ${payStart}~${payEnd} 章高潮揭晓反转并填坑。` // cjk-ok
    }
  ]
  persistMemoryFields()
}

function removeForeshadowingItem(idx: number): void {
  foreshadowingPool.value = foreshadowingPool.value.filter((_, i) => i !== idx)
  persistMemoryFields()
}

function toggleForeshadowStatus(item: MxNovelForeshadowingEntry): void {
  if (item.status === 'planted') {
    item.status = 'paid_off'
    item.paidOffAtChapter = currentChapterCursor.value
  } else {
    item.status = 'planted'
    item.paidOffAtChapter = undefined
  }
  persistMemoryFields()
}

function injectForeshadowingPayoffIntoInstruction(item: MxNovelForeshadowingEntry): void {
  const snippet = isEn.value
    ? `[Foreshadowing Payoff Directive]: In Chapter ${currentChapterCursor.value}, resolve the hook "${item.title}" planted in Ch.${item.plantedChapter} (${item.payoffHint}).`
    : `【本章伏笔回收指令】：请在本章（第 ${currentChapterCursor.value} 章）正式揭晓并回收第 ${item.plantedChapter} 章埋设的伏笔《${item.title}》——${item.payoffHint}` // cjk-ok
  instruction.value = instruction.value.trim()
    ? `${instruction.value.trim()}\n\n${snippet}`
    : snippet
  persistGenerateConfig()
  rightTab.value = 'pacing'
}

function refreshScreenplayPreviewFromNovel(): void {
  const hero = characterRoster.value.find((c) => c.faction === 'protagonist')?.name
  const foe = characterRoster.value.find((c) => c.faction === 'villain')?.name
  screenplayPreviewDraft.value = convertNovelChapterToScreenplayPreview(localText.value, {
    chapterIndex: currentChapterCursor.value,
    chapterTitle: currentChapterTitle.value,
    slice: chapterSlice.value,
    protagonistName: hero || activeGenreProfile.value.roster[0]?.name,
    antagonistName: foe
  })
}

function toggleDualScreenplayPreview(): void {
  dualScreenplayPreviewOpen.value = !dualScreenplayPreviewOpen.value
  if (dualScreenplayPreviewOpen.value) {
    refreshScreenplayPreviewFromNovel()
  }
}

watch(
  () => [localText.value, currentChapterCursor.value] as const,
  () => {
    if (dualScreenplayPreviewOpen.value) {
      refreshScreenplayPreviewFromNovel()
    }
  }
)

function syncDualPreviewToDownstreamScreenplay(): void {
  const spNode = downstreamScreenplayNode.value
  if (!spNode || !props.hostId) return
  if (!screenplayPreviewDraft.value.trim()) {
    refreshScreenplayPreviewFromNovel()
  }
  const adapted = screenplayPreviewDraft.value.trim()
  if (!adapted) return

  const epTitle = `第${currentChapterCursor.value}集：${currentChapterTitle.value.replace(/^第\s*\d+\s*章[:：]?\s*/, '').trim() || '短剧分场剧本'}` // cjk-ok
  const existing = [...(spNode.params.generatedTexts ?? [])]
  const newId = `sp:${Date.now()}:${currentChapterCursor.value}`
  existing.push({
    id: newId,
    title: epTitle,
    text: adapted,
    createdAt: new Date().toISOString()
  })

  graphEditorHosts.updateNode(props.hostId, spNode.id, {
    text: adapted,
    generatedTexts: existing,
    selectedTextId: newId
  })
  const host = graphRunHosts.get(props.hostId)
  if (host) {
    const prev = host.runStates[spNode.id] ?? { status: 'done' as const }
    host.runStates[spNode.id] = {
      ...prev,
      status: 'done',
      outputs: {
        ...(prev.outputs ?? {}),
        out: { kind: 'text', text: adapted, id: newId }
      }
    }
  }
  graphEditorHosts.bumpRevision()
  dualSpSyncedFlash.value = true
  setTimeout(() => {
    dualSpSyncedFlash.value = false
  }, 2200)
}

async function exportFullBookAnthology(): Promise<void> {
  persistNovelBody()
  persistMemoryFields()
  const bookTitle =
    displayName.value.trim() ||
    (isEn.value ? 'Serialized_Novel_Anthology' : '潜龙出渊_全书连载合集') // cjk-ok

  const sortedEntries = [...filteredChapterEntries.value].sort(
    (a, b) => a.chapterNumber - b.chapterNumber
  )
  const chapterBlocks: string[] = []
  if (sortedEntries.length > 0) {
    for (const entry of sortedEntries) {
      const body =
        (await loadGeneratedTextBody(entry.item)).trim() ||
        resolvedFullChapterText.value[entry.key] ||
        entry.item.text ||
        ''
      if (body) {
        chapterBlocks.push(`## ${entry.displayTitle}\n\n${body}`)
      }
    }
  } else if (localText.value.trim()) {
    chapterBlocks.push(
      `## ${currentChapterTitle.value.trim() || `第${currentChapterCursor.value}章`}\n\n${localText.value.trim()}` // cjk-ok
    )
  }

  const rosterLines = characterRoster.value.map(
    (c) => `- **${c.name}**（${c.realmOrRole} · 状态：${c.status}）：${c.relationNote}` // cjk-ok
  )
  const fsLines = foreshadowingPool.value.map(
    (f) =>
      `- **《${f.title}》**（第 ${f.plantedChapter} 章埋设 ➔ 目标第 ${f.targetPayoffChapterRange[0]}~${f.targetPayoffChapterRange[1]} 章回收 · 状态：${f.status}）：${f.payoffHint}` // cjk-ok
  )

  const fullMarkdown = [
    `# 《${bookTitle}》全书设定与连载合集`, // cjk-ok
    `> 动态规划总章数：${totalChapters.value} 章 | 已完成章节：${Math.max(1, sortedEntries.length)} 章 | 累计总字数：${totalBookWordCount.value} 字`, // cjk-ok
    ``,
    `## 一、L1 恒定世界观与力量体系宪法`, // cjk-ok
    worldBible.value.trim() || '（默认绑定经济系统数值工作台）', // cjk-ok
    ``,
    `## 二、人物生死与仇恨状态名录`, // cjk-ok
    ...(rosterLines.length ? rosterLines : ['- 暂无记录']), // cjk-ok
    ``,
    `## 三、长线伏笔埋设与回收追踪表`, // cjk-ok
    ...(fsLines.length ? fsLines : ['- 暂无记录']), // cjk-ok
    ``,
    `---`,
    ``,
    ...chapterBlocks
  ].join('\n\n')

  try {
    await navigator.clipboard?.writeText(fullMarkdown)
  } catch {
    // ignore clipboard error in restricted context
  }

  try {
    const blob = new Blob([fullMarkdown], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${bookTitle}.md`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  } catch {
    // ignore download error in headless test
  }

  exportBookFlash.value = true
  setTimeout(() => {
    exportBookFlash.value = false
  }, 2400)
}

function flushAll(): void {
  persistNovelBody()
  persistGenerateConfig()
  persistMemoryFields()
}

useEditorDiveFrameFlush(() => props.frameKey, flushAll)
</script>

<style scoped>
.dive-novel {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  background: #0b0e14;
  color: #e2e8f0;
  overflow: hidden;
}

.workbench-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 16px;
  background: rgba(15, 23, 42, 0.92);
  border-bottom: 1px solid rgba(148, 163, 184, 0.16);
  flex-shrink: 0;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 200px;
}

.kind-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 7px;
  background: rgba(168, 85, 247, 0.18);
  border: 1px solid rgba(168, 85, 247, 0.38);
}

.title-input {
  background: rgba(30, 41, 59, 0.7);
  border: 1px solid rgba(148, 163, 184, 0.22);
  border-radius: 6px;
  color: #f8fafc;
  font-size: 13px;
  font-weight: 600;
  padding: 5px 10px;
  min-width: 150px;
}

.cursor-pill {
  padding: 3px 9px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
  background: rgba(168, 85, 247, 0.22);
  color: #e9d5ff;
  border: 1px solid rgba(168, 85, 247, 0.45);
}

.header-telemetry {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}

.stat-pill {
  padding: 3px 9px;
  border-radius: 999px;
  font-size: 11px;
  background: rgba(30, 41, 59, 0.85);
  color: #cbd5e1;
  border: 1px solid rgba(148, 163, 184, 0.18);
}

.stat-chap {
  background: rgba(59, 130, 246, 0.18);
  color: #93c5fd;
  border-color: rgba(59, 130, 246, 0.36);
}

.stat-ok {
  background: rgba(16, 185, 129, 0.18);
  color: #6ee7b7;
  border-color: rgba(16, 185, 129, 0.4);
}

.stat-warn {
  background: rgba(245, 158, 11, 0.16);
  color: #fcd34d;
  border-color: rgba(245, 158, 11, 0.36);
}

.stat-realm {
  background: rgba(139, 92, 246, 0.18);
  color: #ddd6fe;
  border-color: rgba(139, 92, 246, 0.36);
}

.stat-accent {
  background: rgba(236, 72, 153, 0.16);
  color: #f9a8d4;
  border-color: rgba(236, 72, 153, 0.35);
}

.header-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.head-gen-btn {
  padding: 5px 11px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  background: rgba(51, 65, 85, 0.85);
  color: #f1f5f9;
  border: 1px solid rgba(148, 163, 184, 0.3);
  transition: all 0.15s ease;
}

.head-gen-btn:hover:not(:disabled) {
  background: rgba(71, 85, 105, 0.95);
}

.head-sp-btn {
  background: rgba(16, 185, 129, 0.2);
  color: #6ee7b7;
  border-color: rgba(16, 185, 129, 0.45);
}

.head-gen-accent {
  background: linear-gradient(135deg, rgba(147, 51, 234, 0.85), rgba(79, 70, 229, 0.85));
  border-color: rgba(192, 132, 252, 0.5);
  color: #ffffff;
}

.head-gen-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.workbench-body {
  flex: 1;
  display: grid;
  grid-template-columns: 315px minmax(0, 1fr) 375px;
  min-height: 0;
  overflow: hidden;
}

.chapter-sidebar,
.ai-sidebar {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  background: rgba(15, 23, 42, 0.65);
  overflow-y: auto;
}

.chapter-sidebar {
  border-right: 1px solid rgba(148, 163, 184, 0.14);
}

.ai-sidebar {
  border-left: 1px solid rgba(148, 163, 184, 0.14);
}

.sidebar-group {
  background: rgba(30, 41, 59, 0.52);
  border: 1px solid rgba(148, 163, 184, 0.15);
  border-radius: 10px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.group-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}

.group-head h3 {
  margin: 0;
  font-size: 12px;
  font-weight: 700;
  color: #f1f5f9;
}

.group-badge,
.group-count {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 999px;
  background: rgba(168, 85, 247, 0.16);
  color: #d8b4fe;
}

.qa-badge-ok {
  background: rgba(16, 185, 129, 0.2);
  color: #6ee7b7;
}

.qa-badge-warn {
  background: rgba(245, 158, 11, 0.2);
  color: #fcd34d;
}

.config-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.config-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.field-label,
.scale-label {
  font-size: 11px;
  color: #94a3b8;
}

.num-input,
.cursor-input {
  background: rgba(15, 23, 42, 0.85);
  border: 1px solid rgba(148, 163, 184, 0.25);
  border-radius: 6px;
  color: #f8fafc;
  font-size: 12px;
  font-weight: 600;
  padding: 4px 8px;
  width: 100%;
}

.quick-scale-row,
.cursor-stepper-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  flex-wrap: wrap;
}

.scale-pills {
  display: flex;
  gap: 4px;
}

.scale-pill {
  padding: 2px 7px;
  border-radius: 5px;
  font-size: 11px;
  background: rgba(15, 23, 42, 0.75);
  color: #cbd5e1;
  border: 1px solid rgba(148, 163, 184, 0.2);
  cursor: pointer;
}

.scale-pill.active {
  background: rgba(168, 85, 247, 0.28);
  color: #f3e8ff;
  border-color: rgba(168, 85, 247, 0.55);
  font-weight: 700;
}

.stepper-controls {
  display: flex;
  align-items: center;
  gap: 4px;
}

.step-btn {
  padding: 3px 8px;
  border-radius: 5px;
  background: rgba(51, 65, 85, 0.8);
  color: #e2e8f0;
  border: 1px solid rgba(148, 163, 184, 0.25);
  cursor: pointer;
  font-size: 11px;
}

.cursor-input {
  width: 58px;
  text-align: center;
}

.cursor-sep {
  font-size: 11px;
  color: #94a3b8;
}

.auto-advance-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: #cbd5e1;
  cursor: pointer;
}

.chapter-actions-bar {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}

.chap-action-btn {
  padding: 6px 8px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 600;
  background: rgba(51, 65, 85, 0.75);
  color: #f1f5f9;
  border: 1px solid rgba(148, 163, 184, 0.24);
  cursor: pointer;
}

.chap-action-accent {
  background: rgba(147, 51, 234, 0.32);
  border-color: rgba(168, 85, 247, 0.5);
  color: #f3e8ff;
}

.merge-output-bar {
  display: flex;
  align-items: center;
  gap: 4px;
}

.merge-output-btn {
  flex: 1;
  padding: 5px 8px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 600;
  background: rgba(16, 185, 129, 0.2);
  color: #6ee7b7;
  border: 1px solid rgba(16, 185, 129, 0.45);
  cursor: pointer;
}

.merge-clear-btn {
  padding: 4px 7px;
  border-radius: 6px;
  font-size: 11px;
  background: rgba(51, 65, 85, 0.7);
  color: #cbd5e1;
  border: 1px solid rgba(148, 163, 184, 0.25);
  cursor: pointer;
}

.merge-toast {
  font-size: 10px;
  color: #6ee7b7;
  background: rgba(16, 185, 129, 0.14);
  border: 1px solid rgba(16, 185, 129, 0.3);
  border-radius: 6px;
  padding: 4px 7px;
}

.chapter-search-input {
  width: 100%;
  padding: 5px 8px;
  border-radius: 6px;
  background: rgba(15, 23, 42, 0.8);
  border: 1px solid rgba(148, 163, 184, 0.22);
  color: #e2e8f0;
  font-size: 11px;
}

.chapter-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 360px;
  overflow-y: auto;
}

.chapter-card {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 6px;
  padding: 8px 10px;
  border-radius: 8px;
  background: rgba(15, 23, 42, 0.68);
  border: 1px solid rgba(148, 163, 184, 0.15);
  cursor: pointer;
  transition: all 0.14s ease;
}

.chapter-card:hover {
  border-color: rgba(168, 85, 247, 0.4);
}

.chapter-card.active {
  background: rgba(88, 28, 135, 0.28);
  border-color: rgba(168, 85, 247, 0.65);
}

.chap-check-wrap {
  display: flex;
  align-items: center;
  padding-top: 2px;
  cursor: pointer;
}

.chap-card-main {
  flex: 1;
  min-width: 0;
}

.chap-card-top {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
}

.chap-index {
  font-size: 11px;
  font-weight: 700;
  color: #c084fc;
}

.chap-title {
  font-size: 12px;
  font-weight: 600;
  color: #f8fafc;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
}

.chap-output-badge {
  font-size: 9px;
  padding: 1px 5px;
  border-radius: 4px;
  background: rgba(16, 185, 129, 0.2);
  color: #6ee7b7;
  border: 1px solid rgba(16, 185, 129, 0.4);
}

.chap-snippet {
  margin: 0 0 4px;
  font-size: 11px;
  color: #94a3b8;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.chap-meta {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 10px;
  color: #64748b;
}

.meta-ok {
  color: #34d399;
  font-weight: 600;
}

.meta-warn {
  color: #fbbf24;
}

.chap-card-tools {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.chap-icon-btn {
  width: 20px;
  height: 20px;
  border-radius: 4px;
  background: rgba(30, 41, 59, 0.8);
  color: #cbd5e1;
  border: 1px solid rgba(148, 163, 184, 0.2);
  font-size: 11px;
  cursor: pointer;
  padding: 0;
}

.chap-delete-btn:hover {
  background: rgba(239, 68, 68, 0.25);
  color: #fca5a5;
}

.split-desc {
  margin: 0;
  font-size: 11px;
  color: #94a3b8;
  line-height: 1.45;
}

.split-submit-btn,
.inject-slice-btn {
  padding: 6px 10px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 600;
  background: rgba(59, 130, 246, 0.22);
  color: #93c5fd;
  border: 1px solid rgba(59, 130, 246, 0.4);
  cursor: pointer;
}

.editor-main {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  background: #0d1117;
}

.studio-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 14px;
  background: rgba(15, 23, 42, 0.78);
  border-bottom: 1px solid rgba(148, 163, 184, 0.14);
  flex-wrap: wrap;
}

.chapter-title-input {
  flex: 1;
  min-width: 200px;
  background: rgba(30, 41, 59, 0.75);
  border: 1px solid rgba(148, 163, 184, 0.25);
  border-radius: 6px;
  color: #f8fafc;
  font-size: 13px;
  font-weight: 600;
  padding: 6px 10px;
}

.tool-btns {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 5px;
}

.tool-chip {
  padding: 4px 8px;
  border-radius: 5px;
  font-size: 11px;
  background: rgba(30, 41, 59, 0.85);
  color: #cbd5e1;
  border: 1px solid rgba(148, 163, 184, 0.22);
  cursor: pointer;
}

.tool-chip:hover {
  background: rgba(51, 65, 85, 0.9);
  color: #ffffff;
}

.tool-chip-accent {
  background: rgba(168, 85, 247, 0.2);
  color: #e9d5ff;
  border-color: rgba(168, 85, 247, 0.42);
}

.chapter-progress-strip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 7px 14px;
  background: rgba(15, 23, 42, 0.55);
  border-bottom: 1px solid rgba(148, 163, 184, 0.12);
  flex-wrap: wrap;
}

.progress-left {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
  min-width: 220px;
}

.progress-title {
  font-size: 11px;
  font-weight: 600;
  color: #cbd5e1;
  white-space: nowrap;
}

.progress-bar-track {
  flex: 1;
  height: 6px;
  border-radius: 999px;
  background: rgba(51, 65, 85, 0.7);
  overflow: hidden;
}

.progress-bar-fill {
  height: 100%;
  background: #f59e0b;
  transition: width 0.2s ease;
}

.progress-bar-fill.fill-mid {
  background: #3b82f6;
}

.progress-bar-fill.fill-done {
  background: #10b981;
}

.beat-checklist {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.beat-badge {
  font-size: 10px;
  padding: 2px 7px;
  border-radius: 999px;
  background: rgba(30, 41, 59, 0.8);
  color: #94a3b8;
  border: 1px solid rgba(148, 163, 184, 0.18);
  cursor: pointer;
}

.beat-badge.reached {
  background: rgba(16, 185, 129, 0.16);
  color: #6ee7b7;
  border-color: rgba(16, 185, 129, 0.38);
}

.selection-polish-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 14px;
  background: rgba(88, 28, 135, 0.28);
  border-bottom: 1px solid rgba(168, 85, 247, 0.4);
  flex-wrap: wrap;
}

.sel-badge {
  font-size: 11px;
  font-weight: 700;
  color: #e9d5ff;
}

.sel-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.sel-btn {
  padding: 3px 9px;
  border-radius: 5px;
  font-size: 11px;
  font-weight: 600;
  background: rgba(30, 41, 59, 0.9);
  color: #e2e8f0;
  border: 1px solid rgba(168, 85, 247, 0.4);
  cursor: pointer;
}

.sel-btn-slap {
  background: rgba(236, 72, 153, 0.22);
  color: #fbcfe8;
  border-color: rgba(236, 72, 153, 0.5);
}

.sel-btn-hook {
  background: rgba(245, 158, 11, 0.22);
  color: #fde68a;
  border-color: rgba(245, 158, 11, 0.5);
}

.novel-textarea-wrap {
  flex: 1;
  display: flex;
  min-height: 0;
  padding: 14px 18px;
}

.novel-textarea {
  width: 100%;
  height: 100%;
  resize: none;
  background: rgba(15, 23, 42, 0.45);
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 10px;
  color: #f1f5f9;
  font-size: 15px;
  line-height: 1.85;
  padding: 18px 22px;
  font-family: 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif;
}

.novel-textarea:focus {
  outline: none;
  border-color: rgba(168, 85, 247, 0.5);
}

.right-tabs {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 4px;
  background: rgba(15, 23, 42, 0.8);
  padding: 4px;
  border-radius: 8px;
  border: 1px solid rgba(148, 163, 184, 0.16);
}

.right-tab-btn {
  padding: 6px 4px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 600;
  background: transparent;
  color: #94a3b8;
  border: none;
  cursor: pointer;
}

.right-tab-btn.active {
  background: rgba(168, 85, 247, 0.25);
  color: #f3e8ff;
}

.mini-link-btn {
  padding: 2px 7px;
  border-radius: 5px;
  font-size: 10px;
  font-weight: 600;
  background: rgba(168, 85, 247, 0.18);
  color: #d8b4fe;
  border: 1px solid rgba(168, 85, 247, 0.35);
  cursor: pointer;
}

.slice-volume-banner {
  padding: 7px 9px;
  border-radius: 7px;
  background: rgba(15, 23, 42, 0.75);
  border: 1px solid rgba(168, 85, 247, 0.25);
}

.vol-title {
  font-size: 11px;
  font-weight: 700;
  color: #e9d5ff;
}

.arc-sub {
  font-size: 10px;
  color: #94a3b8;
  margin-top: 2px;
}

.slice-beat-box {
  padding: 7px 9px;
  border-radius: 7px;
  background: rgba(30, 41, 59, 0.75);
  border-left: 3px solid #a855f7;
}

.slice-beat-box.beat-climax_reversal_slap {
  border-left-color: #ec4899;
  background: rgba(236, 72, 153, 0.1);
}

.slice-beat-box.beat-villain_suppression_cliffhanger {
  border-left-color: #f59e0b;
  background: rgba(245, 158, 11, 0.1);
}

.beat-tag {
  font-size: 10px;
  font-weight: 700;
  color: #cbd5e1;
}

.beat-desc {
  margin: 3px 0 0;
  font-size: 11px;
  color: #f1f5f9;
  line-height: 1.4;
}

.slice-kpi-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}

.slice-kpi {
  padding: 6px 8px;
  border-radius: 6px;
  background: rgba(15, 23, 42, 0.7);
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.kpi-label {
  font-size: 10px;
  color: #94a3b8;
}

.kpi-val {
  font-size: 11px;
  font-weight: 700;
  color: #e2e8f0;
}

.kpi-accent {
  color: #c084fc;
}

.kpi-danger {
  color: #fb7185;
}

.trump-quota-box {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 7px 8px;
  border-radius: 7px;
  background: rgba(15, 23, 42, 0.75);
  font-size: 11px;
}

.quota-row {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.quota-badge {
  font-size: 10px;
  font-weight: 700;
}

.quota-badge.allowed {
  color: #34d399;
}

.quota-badge.locked {
  color: #f87171;
}

.quota-badge.encounter {
  color: #60a5fa;
}

.quota-items {
  color: #e2e8f0;
  line-height: 1.35;
}

.locked-text {
  color: #94a3b8;
  text-decoration: line-through;
}

.qa-list {
  margin: 0;
  padding-left: 16px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 11px;
  line-height: 1.4;
}

.qa-issue {
  color: #fcd34d;
}

.qa-sug {
  color: #94a3b8;
}

.fix-leaked-btn {
  padding: 6px 10px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 700;
  background: rgba(239, 68, 68, 0.22);
  color: #fca5a5;
  border: 1px solid rgba(239, 68, 68, 0.45);
  cursor: pointer;
}

.batch-controls-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}

.batch-start-btn {
  padding: 5px 10px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 700;
  background: linear-gradient(135deg, rgba(16, 185, 129, 0.8), rgba(59, 130, 246, 0.8));
  color: #ffffff;
  border: 1px solid rgba(110, 231, 183, 0.5);
  cursor: pointer;
}

.batch-stop-btn {
  padding: 5px 10px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 700;
  background: rgba(239, 68, 68, 0.25);
  color: #fca5a5;
  border: 1px solid rgba(239, 68, 68, 0.45);
  cursor: pointer;
}

.arc-plan-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 460px;
  overflow-y: auto;
}

.arc-plan-card {
  padding: 8px 10px;
  border-radius: 8px;
  background: rgba(15, 23, 42, 0.72);
  border: 1px solid rgba(148, 163, 184, 0.16);
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.arc-plan-card.active {
  border-color: rgba(168, 85, 247, 0.65);
  background: rgba(88, 28, 135, 0.22);
}

.plan-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}

.plan-chap-no {
  font-size: 11px;
  font-weight: 700;
  color: #c084fc;
}

.plan-beat-badge {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 999px;
  background: rgba(168, 85, 247, 0.2);
  color: #e9d5ff;
}

.plan-beat-badge.beat-climax_reversal_slap {
  background: rgba(236, 72, 153, 0.22);
  color: #fbcfe8;
}

.plan-beat-badge.beat-villain_suppression_cliffhanger {
  background: rgba(245, 158, 11, 0.22);
  color: #fde68a;
}

.plan-power {
  font-size: 10px;
  color: #94a3b8;
}

.plan-title {
  font-size: 12px;
  font-weight: 700;
  color: #f8fafc;
}

.plan-conflict,
.plan-hook {
  margin: 0;
  font-size: 11px;
  color: #cbd5e1;
  line-height: 1.4;
}

.plan-hook {
  color: #93c5fd;
}

.plan-actions {
  display: flex;
  gap: 6px;
  margin-top: 3px;
}

.plan-btn {
  flex: 1;
  padding: 4px 7px;
  border-radius: 5px;
  font-size: 10px;
  font-weight: 600;
  background: rgba(30, 41, 59, 0.85);
  color: #cbd5e1;
  border: 1px solid rgba(148, 163, 184, 0.24);
  cursor: pointer;
}

.plan-btn-run {
  background: rgba(168, 85, 247, 0.25);
  color: #f3e8ff;
  border-color: rgba(168, 85, 247, 0.45);
}

.ai-presets {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.preset-chip {
  padding: 4px 8px;
  border-radius: 5px;
  font-size: 11px;
  background: rgba(15, 23, 42, 0.78);
  color: #d8b4fe;
  border: 1px solid rgba(168, 85, 247, 0.3);
  cursor: pointer;
}

.preset-chip:hover {
  background: rgba(168, 85, 247, 0.22);
}

.mem-hint {
  margin: 0;
  font-size: 10px;
  color: #94a3b8;
  line-height: 1.4;
}

.tail-anchor-preview {
  margin: 0;
  padding: 8px;
  border-radius: 6px;
  background: rgba(15, 23, 42, 0.85);
  border: 1px solid rgba(148, 163, 184, 0.18);
  color: #cbd5e1;
  font-size: 11px;
  line-height: 1.5;
  white-space: pre-wrap;
  max-height: 150px;
  overflow-y: auto;
}

.tool-chip-sp {
  background: rgba(236, 72, 153, 0.16);
  color: #f9a8d4;
  border-color: rgba(236, 72, 153, 0.36);
}

.tool-chip-sp.active {
  background: linear-gradient(135deg, #db2777, #9333ea);
  color: #ffffff;
  border-color: transparent;
}

.novel-textarea-wrap.dual-split {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0;
}

.novel-textarea-wrap.dual-split .novel-textarea {
  border-right: 1px solid rgba(148, 163, 184, 0.18);
}

.screenplay-preview-pane {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: rgba(15, 23, 42, 0.65);
  overflow: hidden;
}

.sp-pane-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 7px 12px;
  background: rgba(30, 41, 59, 0.85);
  border-bottom: 1px solid rgba(148, 163, 184, 0.16);
}

.sp-pane-title {
  font-size: 11px;
  font-weight: 700;
  color: #f472b6;
}

.sp-pane-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.sp-mini-btn {
  padding: 3px 8px;
  border-radius: 5px;
  font-size: 10px;
  font-weight: 600;
  background: rgba(15, 23, 42, 0.8);
  color: #cbd5e1;
  border: 1px solid rgba(148, 163, 184, 0.28);
  cursor: pointer;
}

.sp-mini-accent {
  background: rgba(236, 72, 153, 0.24);
  color: #fbcfe8;
  border-color: rgba(236, 72, 153, 0.45);
}

.sp-preview-textarea {
  flex: 1;
  width: 100%;
  padding: 16px 18px;
  border: none;
  outline: none;
  resize: none;
  background: transparent;
  color: #e2e8f0;
  font-size: 13.5px;
  line-height: 1.75;
  font-family: inherit;
  overflow-y: auto;
}

.arc-svg-group {
  background: rgba(15, 23, 42, 0.65);
}

.arc-ecg-svg {
  width: 100%;
  height: 112px;
  border-radius: 7px;
  background: rgba(2, 6, 23, 0.68);
  border: 1px solid rgba(148, 163, 184, 0.16);
}

.svg-chap-node {
  cursor: pointer;
}

.svg-chap-node:hover circle {
  r: 5.5;
  fill: #f43f5e;
}

.mini-btn-row {
  display: flex;
  align-items: center;
  gap: 4px;
}

.roster-list,
.foreshadow-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 220px;
  overflow-y: auto;
}

.roster-card,
.foreshadow-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 7px 8px;
  border-radius: 7px;
  background: rgba(15, 23, 42, 0.82);
  border: 1px solid rgba(148, 163, 184, 0.18);
}

.roster-card.is-eliminated {
  opacity: 0.72;
  border-color: rgba(239, 68, 68, 0.35);
  background: rgba(69, 10, 10, 0.22);
}

.foreshadow-card.is-due {
  border-color: rgba(245, 158, 11, 0.55);
  background: rgba(120, 53, 15, 0.22);
}

.foreshadow-card.is-paid {
  opacity: 0.68;
  border-color: rgba(34, 197, 94, 0.32);
}

.roster-row-top,
.fs-row-top {
  display: flex;
  align-items: center;
  gap: 5px;
}

.roster-name-input {
  flex: 1;
  min-width: 0;
  padding: 3px 6px;
  border-radius: 4px;
  background: rgba(2, 6, 23, 0.65);
  border: 1px solid rgba(148, 163, 184, 0.22);
  color: #f8fafc;
  font-size: 11px;
  font-weight: 700;
}

.roster-status-select {
  padding: 2px 5px;
  border-radius: 4px;
  background: rgba(30, 41, 59, 0.9);
  border: 1px solid rgba(148, 163, 184, 0.28);
  color: #e2e8f0;
  font-size: 10px;
}

.roster-del-btn {
  padding: 1px 6px;
  border-radius: 4px;
  background: transparent;
  color: #94a3b8;
  border: 1px solid rgba(148, 163, 184, 0.2);
  cursor: pointer;
}

.roster-del-btn:hover {
  color: #fca5a5;
  border-color: rgba(239, 68, 68, 0.4);
}

.roster-row-sub {
  display: grid;
  grid-template-columns: 1fr 1.3fr;
  gap: 5px;
}

.roster-sub-input {
  width: 100%;
  padding: 3px 6px;
  border-radius: 4px;
  background: rgba(2, 6, 23, 0.48);
  border: 1px solid rgba(148, 163, 184, 0.15);
  color: #cbd5e1;
  font-size: 10px;
}

.fs-status-pill {
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 700;
  background: rgba(245, 158, 11, 0.2);
  color: #fde68a;
  border: 1px solid rgba(245, 158, 11, 0.38);
  cursor: pointer;
}

.fs-status-pill.paid_off {
  background: rgba(34, 197, 94, 0.2);
  color: #86efac;
  border-color: rgba(34, 197, 94, 0.38);
}

.fs-due-badge {
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 9px;
  font-weight: 700;
  background: rgba(239, 68, 68, 0.25);
  color: #fecaca;
}

.fs-range-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 10px;
  color: #94a3b8;
}

.genre-selector-block {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 10px;
  padding: 8px;
  border-radius: 7px;
  background: rgba(15, 23, 42, 0.55);
  border: 1px solid rgba(56, 189, 248, 0.18);
}

.genre-row-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}

.genre-custom-toggle {
  padding: 2px 7px;
  border-radius: 5px;
  border: 1px solid rgba(148, 163, 184, 0.25);
  background: rgba(30, 41, 59, 0.5);
  color: #cbd5e1;
  font-size: 10px;
  cursor: pointer;
}

.genre-custom-toggle.active,
.genre-custom-toggle:hover {
  border-color: rgba(56, 189, 248, 0.5);
  color: #38bdf8;
}

.genre-pills-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 4px;
}

.genre-pill {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 6px;
  border-radius: 5px;
  border: 1px solid rgba(148, 163, 184, 0.18);
  background: rgba(15, 23, 42, 0.65);
  color: #cbd5e1;
  font-size: 10.5px;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.genre-pill:hover {
  border-color: rgba(56, 189, 248, 0.45);
  color: #f8fafc;
}

.genre-pill.active {
  background: linear-gradient(135deg, rgba(14, 165, 233, 0.26), rgba(99, 102, 241, 0.26));
  border-color: rgba(56, 189, 248, 0.65);
  color: #e0f2fe;
  font-weight: 600;
}

.genre-custom-panel {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-top: 6px;
  border-top: 1px dashed rgba(148, 163, 184, 0.2);
}

.genre-custom-foot {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 6px;
  align-items: center;
}
</style>
