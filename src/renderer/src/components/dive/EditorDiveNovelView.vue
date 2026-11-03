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
        <span class="cursor-pill">
          {{
            isOutlineModeNode
              ? ui.outlineHeaderPill
              : `Ch.${currentChapterCursor} / ${totalChapters}`
          }}
        </span>
      </div>

      <span class="header-divider" aria-hidden="true" />

      <!-- Role-separated Header Telemetry -->
      <div v-if="isOutlineModeNode" class="header-telemetry">
        <span class="stat-pill stat-realm">
          {{ activeGenreProfile.icon }}
          {{ isEn ? activeGenreProfile.labelEn : activeGenreProfile.labelZh.split(' / ')[0] }}
        </span>
        <span class="stat-pill stat-chap">
          {{ isEn ? `Planned ${totalChapters} Chaps` : `规划总规模 ${totalChapters} 章` }}
        </span>
        <span class="stat-pill">
          {{
            isEn
              ? `Outline ${currentChapterStats.wordCount} chars`
              : `大纲 ${currentChapterStats.wordCount} 字`
          }}
        </span>
      </div>
      <div v-else class="header-telemetry">
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
          class="stat-pill stat-clickable"
          :class="{
            'stat-ok': chapterAudit.overallScore >= 85 && !chapterAudit.leakedLockedTrumps.length,
            'stat-warn':
              chapterAudit.overallScore > 0 &&
              (chapterAudit.overallScore < 85 || chapterAudit.leakedLockedTrumps.length > 0)
          }"
          @click="rightTab = 'pacing'"
        >
          🩺 {{ ui.telemetryQaScore(chapterAudit.overallScore) }}
        </span>
      </div>

      <div class="header-right">
        <div class="header-btn-group">
          <button
            v-if="!isOutlineModeNode"
            type="button"
            class="head-gen-btn"
            @click="exportFullBookAnthology"
          >
            📦 <span>{{ exportBookFlash ? ui.exportBookDoneBtn : ui.exportBookBtn }}</span>
          </button>
          <button
            type="button"
            class="head-gen-btn head-gen-accent"
            :disabled="isGraphRunning || runStatus === 'running'"
            @click="triggerGenerateCurrentChapter"
          >
            ⚡ <span>{{ ui.generateCurrentBtn }}</span>
          </button>
          <GraphNodeRunControl
            v-if="hasInPort"
            :status="runStatus"
            :is-running="isGraphRunning"
            :blocked="blocked"
            @toggle="toggleRun"
          />
        </div>
      </div>
    </header>

    <div class="workbench-body">
      <!-- Left Sidebar: Cleanly separated between Novel Outline Node vs Single-Chapter Node -->
      <aside class="chapter-sidebar">
        <template v-if="isOutlineModeNode">
          <!-- Outline Mode Left 1: Global Genre & Serialization Scale -->
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
          </section>

          <!-- Outline Mode Left 2: AI Model & Outline Generation Prompt -->
          <section class="sidebar-group ai-assistant-group">
            <div class="group-head">
              <h3>🤖 {{ ui.chapterOutlineTitle(currentChapterCursor) }}</h3>
            </div>
            <InstructionModelSelect
              v-if="modelOptions.length > 0"
              v-model="selectedModelKey"
              :options="modelOptions"
              :title="t('graph.inspector.generate.model')"
              :empty-label="t('graph.inspector.generate.noModels')"
              @change="persistGenerateConfig"
            />
            <ExpandableTextarea
              :key="`${node.id}-dive-novel-inst`"
              v-model="instruction"
              :title="ui.chapterOutlineTitle(currentChapterCursor)"
              :rows="5"
              :placeholder="ui.instructionPlaceholder"
              @change="persistGenerateConfig"
            />
            <details class="sys-prompt-details">
              <summary>{{ ui.systemPromptToggle }}</summary>
              <div class="sys-prompt-body">
                <ExpandableTextarea
                  :key="`${node.id}-dive-novel-sys`"
                  v-model="systemPrompt"
                  :title="t('graph.inspector.generate.systemPrompt')"
                  :rows="4"
                  :placeholder="t('graph.inspector.generate.systemPromptPlaceholder')"
                  @change="persistGenerateConfig"
                />
              </div>
            </details>
          </section>
        </template>

        <template v-else>
          <!-- Chapter Mode Left 1: Upstream 3-Port Connected Context Snapshot (in-outline / in-economy / in) -->
          <section class="sidebar-group markov-ports-group">
            <div class="group-head">
              <h3>
                📥
                {{
                  isEn
                    ? `Ch.${currentChapterCursor} Upstream Edge Context`
                    : `第 ${currentChapterCursor} 章 · 上游三路连线快照`
                }}
              </h3>
              <span class="group-badge">{{
                `${activeGenreProfile.icon} ${isEn ? activeGenreProfile.labelEn : activeGenreProfile.labelZh.split(' / ')[0]}`
              }}</span>
            </div>

            <!-- Port 1: in-outline (Chapter t Specific Outline Slice) -->
            <div class="upstream-slice-card">
              <div class="port-item-left">
                <span class="port-tag port-outline">🗺️ {{ ui.portOutlineLabel }}</span>
                <span class="port-target-name" :class="{ muted: !upstreamOutlineNode }">
                  {{
                    upstreamOutlineNode
                      ? upstreamOutlineNode.title || ui.portOutlineLabel
                      : ui.portUnconnected
                  }}
                </span>
                <button
                  v-if="currentChapterOutlineSlice"
                  type="button"
                  class="mini-link-btn"
                  @click="injectUpstreamOutlineSliceIntoInstruction"
                >
                  ✍️ {{ ui.useOutlineBtn }}
                </button>
              </div>
              <pre v-if="currentChapterOutlineSlice" class="tail-anchor-preview">{{
                currentChapterOutlineSlice
              }}</pre>
            </div>

            <!-- Port 2: in-economy & in-numerical (Chapter t Economy & Numerical Lock) -->
            <div class="upstream-slice-card">
              <div class="port-item-left">
                <span class="port-tag port-econ">⚖️ {{ ui.portEconomyLabel }}</span>
                <span class="port-target-name" :class="{ muted: !upstreamEconomyNode }">
                  {{
                    upstreamEconomyNode
                      ? upstreamEconomyNode.title || ui.portEconomyLabel
                      : ui.portUnconnected
                  }}
                </span>
              </div>
              <div class="port-item-left" style="margin-top: 4px">
                <span class="port-tag port-econ">⚔️ {{ isEn ? 'Numerical' : '数值系统' }}</span>
                <span class="port-target-name" :class="{ muted: !upstreamNumericalNode }">
                  {{
                    upstreamNumericalNode
                      ? upstreamNumericalNode.title || (isEn ? 'Numerical' : '数值系统')
                      : ui.portUnconnected
                  }}
                </span>
                <button
                  type="button"
                  class="mini-link-btn"
                  @click="injectNumericalSliceIntoInstruction"
                >
                  📋 {{ isEn ? 'Inject Quota' : '写入配额' }}
                </button>
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
              </div>
            </div>

            <!-- Port 3: in (Prev Chapter Tail Anchor) -->
            <div class="upstream-slice-card">
              <div class="port-item-left">
                <span class="port-tag port-in">🔗 {{ ui.portPrevChapLabel }}</span>
                <span class="port-target-name" :class="{ muted: !upstreamPrevChapterNode }">
                  {{
                    upstreamPrevChapterNode
                      ? upstreamPrevChapterNode.title ||
                        `Ch.${Math.max(1, currentChapterCursor - 1)}`
                      : ui.portPrevChapEmpty
                  }}
                </span>
              </div>
              <pre v-if="activePrevTailAnchor" class="tail-anchor-preview">{{
                activePrevTailAnchor
              }}</pre>
            </div>
          </section>

          <!-- Chapter Mode Left 2: Chapter Plot Prompt, 4-Beat Presets & Model -->
          <section class="sidebar-group ai-assistant-group">
            <div class="group-head">
              <h3>✍️ {{ ui.chapterOutlineTitle(currentChapterCursor) }}</h3>
            </div>
            <InstructionModelSelect
              v-if="modelOptions.length > 0"
              v-model="selectedModelKey"
              :options="modelOptions"
              :title="t('graph.inspector.generate.model')"
              :empty-label="t('graph.inspector.generate.noModels')"
              @change="persistGenerateConfig"
            />
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
            <details class="sys-prompt-details">
              <summary>{{ ui.systemPromptToggle }}</summary>
              <div class="sys-prompt-body">
                <ExpandableTextarea
                  :key="`${node.id}-dive-novel-sys`"
                  v-model="systemPrompt"
                  :title="t('graph.inspector.generate.systemPrompt')"
                  :rows="4"
                  :placeholder="t('graph.inspector.generate.systemPromptPlaceholder')"
                  @change="persistGenerateConfig"
                />
              </div>
            </details>
          </section>

          <!-- Chapter Mode Left 3: Compact Collapsible Chapter Index & Scale Override -->
          <section class="sidebar-group config-group">
            <details class="sys-prompt-details">
              <summary>
                ⚙️
                {{
                  isEn
                    ? `Chapter Index & Scale Override (Ch.${currentChapterCursor}/${totalChapters})`
                    : `章节号与规格微调（第 ${currentChapterCursor}/${totalChapters} 章 · ${targetWords}字）`
                }}
              </summary>
              <div class="sys-prompt-body">
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
              </div>
            </details>
          </section>
        </template>
      </aside>

      <!-- Center Column: Clean Role-Separated Editor (Outline Document vs Single-Chapter 4-Beat Manuscript) -->
      <main class="editor-main">
        <div class="studio-toolbar">
          <input
            v-model="currentChapterTitle"
            type="text"
            class="chapter-title-input"
            :placeholder="
              isOutlineModeNode
                ? isEn
                  ? 'Novel World Bible & Master Outline Title…'
                  : '输入全书总纲与分章企划标题…'
                : ui.chapterTitlePlaceholder(currentChapterCursor)
            "
            @change="persistChapterTitle"
          />

          <div class="doc-view-mode-group" role="tablist">
            <button
              type="button"
              class="view-mode-btn"
              :class="{ active: docViewMode === 'preview' }"
              @click="docViewMode = 'preview'"
            >
              📖 {{ ui.viewModePreview }}
            </button>
            <button
              type="button"
              class="view-mode-btn"
              :class="{ active: docViewMode === 'split' }"
              @click="docViewMode = 'split'"
            >
              ◫ {{ ui.viewModeSplit }}
            </button>
            <button
              type="button"
              class="view-mode-btn"
              :class="{ active: docViewMode === 'edit' }"
              @click="docViewMode = 'edit'"
            >
              ✏️ {{ ui.viewModeEdit }}
            </button>
          </div>

          <div class="tool-btns">
            <template v-if="isOutlineModeNode">
              <button
                type="button"
                class="tool-chip tool-chip-readme"
                @click="synthesizeOutlineReadmeDoc"
              >
                📐
                {{
                  synthesizeOutlineFlash
                    ? ui.btnSynthesizedReadmeOutline
                    : ui.btnSynthesizeReadmeOutline
                }}
              </button>
              <button type="button" class="tool-chip" @click="insertCharacterProfileBlock">
                {{ insertBiosFlash ? ui.btnInsertedBios : ui.btnInsertBios }}
              </button>
              <button type="button" class="tool-chip" @click="insertVolumeTableBlock">
                {{ insertVolumeFlash ? ui.btnInsertedVolumeTable : ui.btnInsertVolumeTable }}
              </button>
              <button
                type="button"
                class="tool-chip tool-chip-accent"
                @click="formatNovelManuscript"
              >
                {{ formatFlash ? ui.btnFormatDone : ui.btnFormatReadme }}
              </button>
              <button type="button" class="tool-chip" @click="copyOutlineMarkdown">
                {{ copyMdFlash ? ui.btnCopiedMd : ui.btnCopyMd }}
              </button>
              <button type="button" class="tool-chip" @click="exportOutlineReadmeMd">
                {{ exportMdFlash ? ui.btnExportedMd : ui.btnExportMd }}
              </button>
            </template>
            <template v-else>
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
              <button
                type="button"
                class="tool-chip tool-chip-accent"
                @click="formatNovelManuscript"
              >
                {{ formatFlash ? ui.btnFormatDone : ui.btnFormat }}
              </button>
            </template>
          </div>
        </div>

        <!-- README TOC Navigation Strip (Outline Mode or Preview/Split Mode) -->
        <div
          v-if="(isOutlineModeNode || docViewMode !== 'edit') && outlineTocItems.length > 0"
          class="readme-toc-strip"
        >
          <span class="toc-strip-label">📑 {{ ui.readmeTocLabel }}</span>
          <div class="toc-pills-wrap">
            <button
              v-for="toc in outlineTocItems"
              :key="toc.id"
              type="button"
              class="toc-pill"
              :class="[`toc-lv-${toc.level}`, { 'is-chap': toc.isChapter }]"
              @click="scrollToOutlineHeading(toc)"
            >
              {{ toc.shortLabel }}
            </button>
          </div>
        </div>

        <!-- Chapter Word Quota & 4-Beat Pacing Progress Bar (Chapter Mode Only) -->
        <div v-if="!isOutlineModeNode" class="chapter-progress-strip">
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

        <!-- Inline Text Selection AI Polish & Beat Booster Bar (Chapter Mode Only) -->
        <div v-if="!isOutlineModeNode && selectedPassageLength > 0" class="selection-polish-bar">
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

        <div class="novel-editor-workspace" :class="`mode-${docViewMode}`">
          <div
            v-show="docViewMode === 'edit' || docViewMode === 'split'"
            class="novel-textarea-wrap"
          >
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
          </div>

          <div
            v-show="docViewMode === 'preview' || docViewMode === 'split'"
            ref="readmePaneRef"
            class="outline-readme-pane"
          >
            <article
              v-if="
                (docViewMode === 'preview' || docViewMode === 'split') &&
                parsedReadmeBlocks.length > 0
              "
              class="outline-readme-article"
            >
              <div class="readme-repo-header">
                <span class="repo-badge">📘 README.md</span>
                <span class="repo-meta">
                  {{ activeGenreProfile.icon }}
                  {{ isEn ? activeGenreProfile.labelEn : activeGenreProfile.labelZh }} ·
                  {{ ui.readmeRepoMeta(totalChapters, currentChapterStats.wordCount) }}
                </span>
              </div>

              <template v-for="block in parsedReadmeBlocks" :key="block.id">
                <component
                  :is="'h' + block.level"
                  v-if="block.kind === 'heading'"
                  :id="block.anchorId"
                  class="readme-heading"
                  :class="[
                    `readme-h${block.level}`,
                    { 'readme-chapter-heading': Boolean(block.chapterBadge) }
                  ]"
                >
                  <span v-if="block.chapterBadge" class="readme-chap-badge">{{
                    block.chapterBadge
                  }}</span>
                  <span
                    class="readme-heading-text"
                    v-html="formatInlineMarkdown(block.text || '')"
                  />
                  <span v-if="block.stageBadge" class="readme-stage-badge">{{
                    block.stageBadge
                  }}</span>
                  <button
                    type="button"
                    class="readme-heading-edit-btn"
                    :title="ui.jumpToSourceHint"
                    @click="focusHeadingInSource(block.rawHeading || block.text || '')"
                  >
                    ✏️
                  </button>
                </component>

                <hr v-else-if="block.kind === 'hr'" class="readme-hr" />

                <blockquote
                  v-else-if="block.kind === 'blockquote'"
                  class="readme-blockquote"
                  :class="block.alertType ? `alert-${block.alertType}` : ''"
                >
                  <p
                    v-for="(bLine, bIdx) in block.lines"
                    :key="bIdx"
                    v-html="formatInlineMarkdown(bLine)"
                  />
                </blockquote>

                <div v-else-if="block.kind === 'code'" class="readme-code-wrap">
                  <div class="readme-code-bar">
                    <span class="readme-code-lang">{{ block.lang || 'TEXT / BLUEPRINT' }}</span>
                    <button
                      type="button"
                      class="readme-code-copy"
                      @click="copyCodeBlock(block.code || '', block.id)"
                    >
                      {{ copiedCodeBlockId === block.id ? '✓ Copied' : 'Copy' }}
                    </button>
                  </div>
                  <pre class="readme-pre"><code>{{ block.code }}</code></pre>
                </div>

                <div v-else-if="block.kind === 'table'" class="readme-table-scroll">
                  <table class="readme-table">
                    <thead>
                      <tr>
                        <th
                          v-for="(th, thIdx) in block.headers"
                          :key="thIdx"
                          v-html="formatInlineMarkdown(th)"
                        />
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="(row, rIdx) in block.rows" :key="rIdx">
                        <td
                          v-for="(cell, cIdx) in row"
                          :key="cIdx"
                          v-html="formatInlineMarkdown(cell)"
                        />
                      </tr>
                    </tbody>
                  </table>
                </div>

                <ol v-else-if="block.kind === 'list' && block.ordered" class="readme-list ordered">
                  <li
                    v-for="(li, lIdx) in block.items"
                    :key="lIdx"
                    v-html="formatInlineMarkdown(li)"
                  />
                </ol>

                <ul v-else-if="block.kind === 'list'" class="readme-list">
                  <li
                    v-for="(li, lIdx) in block.items"
                    :key="lIdx"
                    v-html="formatInlineMarkdown(li)"
                  />
                </ul>

                <p
                  v-else-if="block.kind === 'paragraph'"
                  class="readme-p"
                  v-html="formatInlineMarkdown(block.text || '')"
                />
              </template>
            </article>

            <div v-else class="readme-empty-state">
              <div class="empty-icon">📘</div>
              <p>{{ ui.emptyOutlineHint }}</p>
              <button
                type="button"
                class="tool-chip tool-chip-readme"
                @click="synthesizeOutlineReadmeDoc"
              >
                📐 {{ ui.btnSynthesizeReadmeOutline }}
              </button>
            </div>
          </div>
        </div>
      </main>

      <!-- Right Sidebar: Clean 2-Tab Role-Separated Assistant -->
      <aside class="ai-sidebar">
        <div class="right-tabs">
          <button
            v-if="!isOutlineModeNode"
            type="button"
            class="right-tab-btn"
            :class="{ active: rightTab === 'pacing' }"
            @click="rightTab = 'pacing'"
          >
            ⚖️ {{ ui.tabPacingAndOutline }}
          </button>
          <button
            v-if="isOutlineModeNode"
            type="button"
            class="right-tab-btn"
            :class="{ active: rightTab === 'arcPlan' }"
            @click="rightTab = 'arcPlan'"
          >
            🗺️ {{ isEn ? 'Arc Power & Chapter Plan' : '战力包络 & 分章排期' }}
          </button>
          <button
            type="button"
            class="right-tab-btn"
            :class="{ active: rightTab === 'memory' }"
            @click="rightTab = 'memory'"
          >
            🧠
            {{
              isOutlineModeNode
                ? isEn
                  ? 'World Bible & Roster'
                  : '世界观与人物伏笔'
                : ui.tabMemoryPyramid
            }}
          </button>
        </div>

        <template v-if="!isOutlineModeNode && rightTab === 'pacing'">
          <!-- Upstream Economy System Chapter Numerical Quota Slice -->
          <section class="sidebar-group slice-group">
            <div class="group-head">
              <h3>{{ ui.sliceCardTitle(currentChapterCursor, totalChapters) }}</h3>
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

          <!-- Chapter Continuity & Power-Creep QA Doctor Card -->
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
        </template>

        <template v-else-if="isOutlineModeNode && rightTab === 'arcPlan'">
          <!-- Visual Arc Power Envelope & Beat ECG SVG Curve -->
          <section class="sidebar-group arc-svg-group">
            <div class="group-head">
              <h3>📈 {{ ui.arcSvgTitle }}</h3>
              <span class="group-count">{{ ui.arcSvgLegend }}</span>
            </div>
            <svg class="arc-ecg-svg" viewBox="0 0 300 112" preserveAspectRatio="none">
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

              <polyline
                :points="arcPacingSvg.villainPolyline"
                fill="none"
                stroke="#f97316"
                stroke-width="1.8"
                stroke-dasharray="3 2"
              />

              <polyline
                :points="arcPacingSvg.powerPolyline"
                fill="none"
                stroke="#38bdf8"
                stroke-width="2.2"
              />

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
                  <button
                    type="button"
                    class="plan-btn"
                    @click="insertArcPlanItemIntoOutline(planItem)"
                  >
                    ✍️ {{ isEn ? 'Insert into Outline' : '插入分章细纲' }}
                  </button>
                </div>
              </div>
            </div>
          </section>
        </template>

        <template v-else>
          <!-- Memory & Roster Tab: Role-separated for Outline vs Chapter -->
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

          <section v-if="!isOutlineModeNode" class="sidebar-group memory-group">
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
              :rows="4"
              :placeholder="ui.l2Placeholder"
              @change="persistMemoryFields"
            />
          </section>

          <section v-if="!isOutlineModeNode" class="sidebar-group memory-group">
            <div class="group-head">
              <h3>📜 {{ ui.l3Title }}</h3>
            </div>
            <p class="mem-hint">{{ ui.l3Hint }}</p>
            <ExpandableTextarea
              :key="`${node.id}-novel-l3`"
              v-model="rollingSummary"
              :title="ui.l3Title"
              :rows="4"
              :placeholder="ui.l3Placeholder"
              @change="persistMemoryFields"
            />
          </section>

          <!-- Character Status & Grudge Roster -->
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

          <!-- Long-Term Foreshadowing Tracker Pool -->
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
                    v-if="fsItem.status === 'planted' && !isOutlineModeNode"
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
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  DEFAULT_NOVEL_SYSTEM_PROMPT_EN,
  DEFAULT_NOVEL_SYSTEM_PROMPT_ZH,
  defaultNovelOutlineSystemPrompt,
  defaultNovelOutlineUserPrompt,
  defaultNovelSystemPrompt,
  inferExplicitNovelChapterNumber,
  narrowOutlineTextForChapter,
  resolveNodeType,
  type GraphNode
} from '@shared/graph'
import {
  NOVEL_GENRE_PROFILES,
  auditNovelChapterContinuityAndPacing,
  createDefaultNovelCharacterRoster,
  createDefaultNovelForeshadowingPool,
  createMxWorkbenchPreset,
  exportMxChapterNumericalSlice,
  fillNovelGenreTemplate,
  generateMxArcChapterOutlinePlan,
  isNovelGenreId,
  normalizeNovelCharacterRoster,
  normalizeNovelForeshadowingPool,
  parseMxDocumentJson,
  resolveNovelGenreProfile,
  type MxChapterNumericalSlice,
  type MxChapterOutlinePlanItem,
  type MxNovelChapterContinuityAudit,
  type MxNovelCharacterStatusEntry,
  type MxNovelForeshadowingEntry,
  type MxNumericalWorkbench,
  type MxTemplateId,
  type MxWorkbenchPresetId,
  type NovelGenreId,
  type NovelGenreProfile
} from '@shared/gameAssets'
import ExpandableTextarea from '../ExpandableTextarea.vue'
import GraphNodeRunControl from '../GraphNodeRunControl.vue'
import InstructionModelSelect from '../InstructionModelSelect.vue'
import SaveAssetDialog from '../SaveAssetDialog.vue'
import WorkspaceItemIcon from '../WorkspaceItemIcon.vue'
import { useStudioI18n } from '../../composables/useStudioI18n'
import { useGraphNodeRun } from '../../composables/useGraphNodeRun'
import { useSaveCacheAsset } from '../../composables/useSaveCacheAsset'
import { useEditorDiveFrameFlush } from '../../composables/useEditorDiveFrameFlush'
import { graphEditorHosts } from '../../features/graph/model/graphEditorHosts'
import { graphRunHosts } from '../../features/graph/model/graphRunHosts'
import { saveGraphRunTextForNode } from '../../features/graph/saveGraphRunTextForNode'
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

const { dialogOpen, defaultName, defaultFolderId, dialogRef, closeDialog, confirmSave } =
  useSaveCacheAsset()

const node = computed((): GraphNode | null => {
  void graphEditorHosts.revision.value
  const current = graphEditorHosts.getNode(props.hostId, props.nodeId)
  return current?.typeId === 'asset.novel' || current?.typeId === 'novel.outline' ? current : null
})

const isOutlineModeNode = computed(
  () => node.value?.typeId === 'novel.outline' || node.value?.params.novelNodeMode === 'outline'
)

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
const docViewMode = ref<'preview' | 'split' | 'edit'>('preview')
const readmePaneRef = ref<HTMLElement | null>(null)
const chapterSearchQuery = ref('')
const formatFlash = ref(false)
const copyMdFlash = ref(false)
const exportMdFlash = ref(false)
const insertBiosFlash = ref(false)
const insertVolumeFlash = ref(false)
const synthesizeOutlineFlash = ref(false)
const copiedCodeBlockId = ref<string | null>(null)

// Batch auto-serialization state
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

async function loadTextByRelativePath(rawRel?: string): Promise<string> {
  const relativePath = rawRel?.trim()
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

async function loadGeneratedTextBody(item: StoredGeneratedText): Promise<string> {
  const inline = item.text?.trim()
  if (inline) return item.text
  return loadTextByRelativePath(item.relativePath)
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

// Inspect upstream game.economy node, novel.outline node, and downstream asset.screenplay node in the same graph
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

const upstreamNumericalNode = computed((): GraphNode | null => {
  void graphEditorHosts.revision.value
  if (!props.hostId || !node.value) return null
  const incoming = graphEditorHosts.listIncomingEdges(props.hostId, node.value.id)
  for (const edge of incoming) {
    const src = graphEditorHosts.getNode(props.hostId, edge.sourceNodeId)
    if (src?.typeId === 'game.numerical') return src
  }
  return graphEditorHosts.findNode(props.hostId, (n) => n.typeId === 'game.numerical')
})

const upstreamOutlineNode = computed((): GraphNode | null => {
  void graphEditorHosts.revision.value
  if (!props.hostId || !node.value) return null
  if (node.value.typeId === 'novel.outline' || node.value.params.novelNodeMode === 'outline') {
    return node.value
  }
  const incoming = graphEditorHosts.listIncomingEdges(props.hostId, node.value.id)
  for (const edge of incoming) {
    const src = graphEditorHosts.getNode(props.hostId, edge.sourceNodeId)
    if (
      src &&
      (src.typeId === 'novel.outline' ||
        (src.typeId === 'asset.novel' && src.params.novelNodeMode === 'outline'))
    ) {
      return src
    }
  }
  return graphEditorHosts.findNode(
    props.hostId,
    (n) =>
      n.typeId === 'novel.outline' ||
      (n.typeId === 'asset.novel' && n.params.novelNodeMode === 'outline')
  )
})

const upstreamPrevChapterNode = computed((): GraphNode | null => {
  void graphEditorHosts.revision.value
  if (!props.hostId || !node.value || isOutlineModeNode.value) return null
  const incoming = graphEditorHosts.listIncomingEdges(props.hostId, node.value.id)
  for (const edge of incoming) {
    const src = graphEditorHosts.getNode(props.hostId, edge.sourceNodeId)
    if (src?.typeId === 'asset.novel' && src.params.novelNodeMode !== 'outline') {
      return src
    }
  }
  return null
})

const canvasChapterChainNodes = computed(() => {
  void graphEditorHosts.revision.value
  const current = node.value
  if (!props.hostId || !current) return []
  const liveNodes = graphEditorHosts.listNodes(props.hostId)
  const allNodes = liveNodes.length > 0 ? liveNodes : [current]
  const chapterNodes = allNodes.filter(
    (n) => n.typeId === 'asset.novel' && n.params.novelNodeMode !== 'outline'
  )
  return chapterNodes
    .map((n, idx) => {
      const chapNum =
        n.id === current.id
          ? currentChapterCursor.value
          : Math.max(
              1,
              Math.floor(
                Number(n.params.novelCurrentChapter) || extractChapterNumFromTitle(n.title, idx)
              )
            )
      const bodyRaw =
        n.id === current.id
          ? localText.value
          : (n.params.text ?? '').trim() === '…'
            ? ''
            : (n.params.text ?? '')
      let stats = analyzeNovelChapter(bodyRaw)
      const trimmed = bodyRaw.trim()
      let snippet = trimmed ? (trimmed.length > 88 ? `${trimmed.slice(0, 88)}…` : trimmed) : ''
      if (!trimmed && n.params.novelChapterHistoryJson) {
        try {
          const hist = JSON.parse(n.params.novelChapterHistoryJson) as Record<
            string,
            NovelChapterHistoryRecord
          >
          const rec = hist?.[String(chapNum)] ?? Object.values(hist ?? {}).pop()
          if (rec) {
            const wc = Number(rec.wordCount) || 0
            stats = {
              wordCount: wc,
              paragraphCount: wc > 0 ? Math.max(1, Math.round(wc / 80)) : 0,
              dialogueCount: 0
            }
            snippet = rec.summary?.trim() || rec.tailAnchor?.trim().slice(0, 88) || ''
          }
        } catch {
          // ignore
        }
      }
      return {
        node: n,
        chapterNumber: chapNum,
        displayTitle: n.title?.trim() || (isEn.value ? `Chapter ${chapNum}` : `第${chapNum}章`), // cjk-ok
        snippet,
        stats
      }
    })
    .sort(
      (a, b) =>
        a.chapterNumber - b.chapterNumber || (a.node.position?.x ?? 0) - (b.node.position?.x ?? 0)
    )
})

const activeWorkbench = computed((): MxNumericalWorkbench => {
  const withSyncedTotal = (wb: MxNumericalWorkbench): MxNumericalWorkbench => {
    const targetMax = Math.max(10, Math.round(totalChapters.value || 200))
    if ((wb.roguelikeEnvelope?.levelMax ?? 80) <= 80 && targetMax > 80) {
      return {
        ...wb,
        roguelikeEnvelope: {
          ...wb.roguelikeEnvelope,
          levelMax: targetMax
        }
      }
    }
    return wb
  }
  const numNode = upstreamNumericalNode.value
  if (numNode) {
    const presetRaw = String(numNode.params.gameNumericalPreset ?? 'short_drama_progression')
    const rawJson = numNode.params.gameNumericalWorkbenchJson
    if (typeof rawJson === 'string' && rawJson.trim()) {
      try {
        const parsed = JSON.parse(rawJson) as MxNumericalWorkbench
        if (parsed && typeof parsed === 'object' && parsed.multiplier && parsed.combatKernel) {
          return withSyncedTotal(parsed)
        }
      } catch {
        // fallback to preset
      }
    }
    return withSyncedTotal(createMxWorkbenchPreset(presetRaw as MxWorkbenchPresetId))
  }
  const econ = upstreamEconomyNode.value
  if (econ) {
    const tplRaw = String(econ.params.gameEconomyPreset ?? 'short_drama_reversal_loop')
    const doc = parseMxDocumentJson(
      econ.params.gameEconomyDiagramJson,
      tplRaw as MxTemplateId,
      econ.title
    )
    if (doc.workbench) return withSyncedTotal(doc.workbench)
  }
  return withSyncedTotal(createMxWorkbenchPreset('short_drama_progression'))
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
  const prevNode = upstreamPrevChapterNode.value
  if (prevNode) {
    const prevRaw = (prevNode.params.text ?? '').trim()
    if (prevRaw && prevRaw !== '…') {
      const lines = prevRaw
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => Boolean(l) && !/^#+\s*第\s*\d+/i.test(l) && !/^#+\s*Chapter\s*\d+/i.test(l)) // cjk-ok
      if (lines.length) {
        return lines.slice(-4).join('\n').slice(-550)
      }
    }
  }
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

const resolvedUpstreamOutlineText = ref('')
watch(
  () =>
    [
      upstreamOutlineNode.value?.id,
      upstreamOutlineNode.value?.params.text,
      upstreamOutlineNode.value?.params.previewRelativePath,
      upstreamOutlineNode.value?.params.selectedTextId
    ] as const,
  async () => {
    const outline = upstreamOutlineNode.value
    if (!outline || outline.id === node.value?.id) {
      resolvedUpstreamOutlineText.value = ''
      return
    }
    const inline = (outline.params.text ?? '').trim()
    if (inline && inline !== '…') {
      resolvedUpstreamOutlineText.value = inline
      return
    }
    const previewRel = outline.params.previewRelativePath?.trim()
    if (previewRel) {
      const loaded = await loadTextByRelativePath(previewRel)
      if (loaded.trim()) {
        resolvedUpstreamOutlineText.value = loaded.trim()
        return
      }
    }
    const list = outline.params.generatedTexts ?? []
    if (list.length > 0) {
      const parts = await Promise.all(list.map((it) => loadGeneratedTextBody(it)))
      const joined = parts
        .map((p) => p.trim())
        .filter(Boolean)
        .join('\n\n')
      if (joined) {
        resolvedUpstreamOutlineText.value = joined
        return
      }
    }
    resolvedUpstreamOutlineText.value = ''
  },
  { immediate: true }
)

const currentChapterOutlineSlice = computed((): string => {
  if (isOutlineModeNode.value) return ''
  const outline = upstreamOutlineNode.value
  if (!outline || outline.id === node.value?.id) return ''
  const rawOutline =
    (outline.params.text ?? '').trim() === '…'
      ? ''
      : (outline.params.text ?? '').trim() ||
        resolvedUpstreamOutlineText.value.trim() ||
        (outline.params.novelWorldBible ?? '').trim()
  if (!rawOutline) return ''
  const sliced = narrowOutlineTextForChapter(
    rawOutline,
    currentChapterCursor.value,
    String(locale.value)
  )
  return sliced.trim()
})

function injectUpstreamOutlineSliceIntoInstruction(): void {
  const slice = currentChapterOutlineSlice.value
  if (!slice) return
  instruction.value = instruction.value.trim() ? `${instruction.value.trim()}\n\n${slice}` : slice
  persistGenerateConfig()
}

function insertArcPlanItemIntoOutline(planItem: MxChapterOutlinePlanItem): void {
  const block = isEn.value
    ? `### Chapter ${planItem.chapter}: ${planItem.titleEn}\n- **Dramatic Beat**: ${planItem.beatBadgeEn} (Power Cap ${planItem.powerCeiling})\n- **Core Conflict**: ${planItem.coreConflictZh}\n- **Cliffhanger Hook**: ${planItem.cliffhangerHookZh}`
    : `### 第${planItem.chapter}章：${planItem.titleZh}\n- **戏剧节拍**：${planItem.beatBadgeZh}（战力上限 ${planItem.powerCeiling}）\n- **核心冲突**：${planItem.coreConflictZh}\n- **章末钩子**：${planItem.cliffhangerHookZh}` // cjk-ok
  insertAtCursorOrAppend(block)
}

const chapterAudit = computed((): MxNovelChapterContinuityAudit => {
  const eliminatedNames = characterRoster.value
    .filter((c) => c.status === 'eliminated' && c.name?.trim())
    .map((c) => c.name.trim())
  const dueTitles = foreshadowingPool.value
    .filter(
      (f) =>
        f.status === 'planted' &&
        f.title?.trim() &&
        Array.isArray(f.targetPayoffChapterRange) &&
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
  const genCount = Math.max(1, canvasChapterChainNodes.value.length)
  const curWords = currentChapterStats.value.wordCount
  const totWords =
    canvasChapterChainNodes.value.reduce((acc, c) => acc + c.stats.wordCount, 0) || curWords
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
      ? `Chain ${genCount} / ${totalChapters.value} Chaps`
      : `章节链 ${genCount} / ${totalChapters.value} 章`, // cjk-ok
    telemetryCurrentWords: en
      ? `Ch.${currentChapterCursor.value}: ${curWords} / ${targetWords.value} chars`
      : `本章 ${curWords} / ${targetWords.value} 字`, // cjk-ok
    telemetryTotalWords: en
      ? `Chain Total: ${totWords.toLocaleString()} chars`
      : `全链累计 ${totWords.toLocaleString()} 字`, // cjk-ok
    telemetryPowerCeiling: en
      ? `${gp.protagonistAxisEn}: ${chapterSlice.value.powerCeiling}`
      : `${gp.protagonistAxisZh} ${chapterSlice.value.powerCeiling}`,
    telemetryQaScore: (score: number) => (en ? `QA ${score}pt` : `合规 ${score}分`), // cjk-ok
    exportBookBtn: en ? 'Export Full Book' : '导出全书合集', // cjk-ok
    exportBookDoneBtn: en ? '✓ Exported & Copied' : '✓ 已导出并复制全书', // cjk-ok
    pushToScreenplayBtn: en ? 'Push to Screenplay' : '推送至剧本工作台', // cjk-ok
    pushToGameSystemBtn: en ? 'Push to Game GDD' : '推送至策划案工作台', // cjk-ok
    outlineHeaderPill: en
      ? `🗺️ Outline · ${totalChapters.value} Chaps`
      : `🗺️ 全书大纲 · ${totalChapters.value}章`, // cjk-ok
    generateCurrentBtn: isOutlineModeNode.value
      ? en
        ? 'Generate Outline'
        : '生成小说大纲' // cjk-ok
      : en
        ? `Generate Ch.${currentChapterCursor.value}`
        : `生成第 ${currentChapterCursor.value} 章`, // cjk-ok
    aiNextChapterBtn: en ? 'AI Next Chapter' : 'AI 续写下一章', // cjk-ok
    spawnNextNodeBtn: isOutlineModeNode.value
      ? en
        ? '+ Ch.1 Node'
        : '新建第1章节点' // cjk-ok
      : en
        ? `+ Ch.${Math.min(totalChapters.value, currentChapterCursor.value + 1)} Node`
        : `串联下一章节点`, // cjk-ok
    spawnNextNodeHint: en
      ? 'Create a chained novel node for the next chapter on the canvas (wired to Prev Chap + Outline + Economy)'
      : '在画布上新建并串联「下一章」独立小说节点（自动连接上一章 out -> in、小说大纲 -> in-outline、经济系统 -> in-economy）', // cjk-ok
    spawnBatchNodesBtn: en ? '+3 Chaps Chain' : '批量+3章链', // cjk-ok
    spawnBatchNodesHint: en
      ? 'Spawn and wire the next 3 Markov-chained chapter nodes on the canvas (each wired to Previous Chapter + Outline + Economy)'
      : '在画布上一键批量生成并串联后续 3 章马尔可夫链节点（每章均自动连接上一章、小说大纲与经济数值节点）', // cjk-ok
    serialConfigTitle: en ? 'Dynamic Serialization & Chapter Clock' : '长篇连载规模与章节时钟', // cjk-ok
    dynamicTotalBadge: en ? 'Dynamic' : '总章数可随时动态调整', // cjk-ok
    totalChaptersLabel: en ? 'Planned Total Chapters' : '规划总章节数 (1~5000)', // cjk-ok
    targetWordsLabel: en ? 'Target Words / Chapter' : '单章目标字数', // cjk-ok
    quickScaleLabel: en ? 'Quick Total Scale:' : '总章数快捷规格：', // cjk-ok
    targetCursorLabel: en ? 'Chapter Node Index (C_t):' : '本节点所属章号 (C_t)：', // cjk-ok
    autoAdvanceLabel: en
      ? 'Auto-advance to next chapter (+1) after generation'
      : '生成本章后自动将游标推进至下一章 (+1)', // cjk-ok
    markovPortsTitle: en ? '3-Way Markov Ports & Chain' : '三路输入与链式输出端口', // cjk-ok
    portPrevChapLabel: en ? 'Prev Chap' : '上一章', // cjk-ok
    portPrevChapEmpty: en ? '(Ch.1 Start Node)' : '（首章起点 · 无前置章节）', // cjk-ok
    portOutlineLabel: en ? 'Novel Outline' : '小说大纲', // cjk-ok
    portEconomyLabel: en ? 'Economy System' : '经济系统', // cjk-ok
    portNextChapLabel: en ? 'Next Chap' : '下一章', // cjk-ok
    portOutlineOutLabel: en ? 'Outline Out' : '大纲输出', // cjk-ok
    portAllChapsLabel: en ? 'All' : '全部', // cjk-ok
    portAllChapsSummary: (cur: number) =>
      en
        ? `Cumulative Ch.1–${cur} (${cur} chaps total)`
        : `汇总第 1~${cur} 章（共 ${cur} 章累计输出）`, // cjk-ok
    portOutlineAllSummary: en
      ? 'Per-Chapter Split Outlines (chap:1…N)'
      : '按章号拆分的全部细纲集合', // cjk-ok
    exportBookShortBtn: en ? 'Export' : '导出汇总', // cjk-ok
    portNextChapEmpty: en ? 'Not chained yet' : '尚未串联下一章节点', // cjk-ok
    portUnconnected: en ? 'Not connected' : '尚未连接', // cjk-ok
    jumpNodeBtn: en ? 'Open' : '跳转', // cjk-ok
    connectPortBtn: en ? '+ Connect' : '+ 连接/创建', // cjk-ok
    spawnNextShortBtn: en ? '+ Chain Next' : '+ 串联下一章', // cjk-ok
    activeNodeBadge: en ? 'Current Node' : '当前节点', // cjk-ok
    emptyOutlineHint: en
      ? 'Click "Generate Outline" to create the World Bible & Per-Chapter Outline…'
      : '点击右上角「⚡ 生成小说大纲」生成世界观与分章细纲…', // cjk-ok
    chapterListTitle: en ? 'Canvas Markov Chapter Chain' : '画布马尔可夫章节链拓扑', // cjk-ok
    chapterCountBadge: (written: number, total: number) =>
      en ? `${written} / ${total} nodes` : `画布 ${written} 章 / 规划 ${total} 章`, // cjk-ok
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
      ? 'Click to switch Dive workbench to this chapter node'
      : '点击切换至该章节节点的工作台', // cjk-ok
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
    btnInsertBios: en ? '+ Character Bios' : '+ 人物档案表', // cjk-ok
    btnInsertedBios: en ? '✓ Bios Inserted' : '✓ 已插入人物表', // cjk-ok
    btnInsertVolumeTable: en ? '+ Volume Table' : '+ 分卷规划表', // cjk-ok
    btnInsertedVolumeTable: en ? '✓ Volume Table Inserted' : '✓ 已插入分卷表', // cjk-ok
    btnSynthesizeReadmeOutline: en ? 'Synthesize README Outline' : '合成 README 标准大纲', // cjk-ok
    btnSynthesizedReadmeOutline: en ? '✓ README Outline Ready' : '✓ 已合成标准大纲', // cjk-ok
    btnFormatReadme: en ? '✨ README Format' : '✨ 转为 README 格式', // cjk-ok
    btnCopyMd: en ? '📋 Copy MD' : '📋 复制 MD', // cjk-ok
    btnCopiedMd: en ? '✓ Copied MD' : '✓ 已复制', // cjk-ok
    btnExportMd: en ? '📥 Export .md' : '📥 导出 .md', // cjk-ok
    btnExportedMd: en ? '✓ Exported' : '✓ 已导出', // cjk-ok
    viewModePreview: en ? 'README Preview' : 'README 预览', // cjk-ok
    viewModeSplit: en ? 'Split View' : '双栏对照', // cjk-ok
    viewModeEdit: en ? 'Source' : '源码编辑', // cjk-ok
    readmeTocLabel: en ? 'README TOC:' : 'README 章节导览：', // cjk-ok
    readmeRepoMeta: (tot: number, words: number) =>
      en ? `${tot} Chaps · ${words} chars` : `${tot} 章规划 · ${words} 字`, // cjk-ok
    jumpToSourceHint: en
      ? 'Jump to this section in Markdown source'
      : '在 Markdown 源码中定位编辑此节', // cjk-ok
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
      isOutlineModeNode.value
        ? en
          ? 'Write or generate the Novel World Bible, Character Roster, Volume Architecture, and Per-Chapter Detailed Outlines (Chapter 1: ..., Chapter 2: ...)…'
          : `在此撰写或 AI 生成【核心世界观宪法 + 主要人物档案 + 分卷总纲 + 第1章/第2章逐章细纲】（流派：${gp.labelZh}，规划 ${totalChapters.value} 章，广播连入下游每一章节点自动按章号切片）…` // cjk-ok
        : en
          ? `Write or generate Chapter ${chap} (${words}+ words, 4-beat structure)…`
          : `在此撰写或 AI 生成【第 ${chap} 章】正文（目标 ${words}+ 字，流派：${gp.labelZh}，四拍结构：${gp.beats.setup_endure.badgeZh} → ${gp.beats.encounter_growth.badgeZh} → ${gp.beats.villain_suppression_cliffhanger.badgeZh} → ${gp.beats.climax_reversal_slap.badgeZh}）…`, // cjk-ok
    tabPacingAndOutline: en ? 'Quota & QA' : '数值围栏 & 审计', // cjk-ok
    tabArcPlan: en ? 'Arc Plan & Chain' : '幕次细纲 & 章节链', // cjk-ok
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
    batchSerialTitle: en ? 'Markov Chapter Chain Spawner' : '画布马尔可夫章节链批量生成器', // cjk-ok
    batchRunningBadge: (rem: number) =>
      en ? `Serializing (${rem} left)…` : `连续连载中（剩余 ${rem} 章）…`, // cjk-ok
    batchReadyBadge: en ? '3-Way Wired' : '自动串联三路输入', // cjk-ok
    batchSerialDesc: en
      ? 'Spawns consecutive chapter nodes on the canvas in a Markov chain (Ch.t -> Ch.t+1) and wires each node to Novel Outline (in-outline) + Economy System (in-economy).'
      : '按下方幕次分章细纲表，在画布上一键批量生成并串联后续章节节点（每章自动连接：上一章 out -> in、小说大纲 -> in-outline、经济系统 -> in-economy）。', // cjk-ok
    batchCountPill: (cnt: number) => (en ? `+${cnt} Nodes` : `+${cnt} 章链`), // cjk-ok
    startBatchBtn: (cnt: number) =>
      en ? `Spawn & Wire ${cnt} Chapter Nodes` : `在画布串联生成 ${cnt} 个章节节点`, // cjk-ok
    stopBatchBtn: en ? 'Stop Batch' : '停止连写', // cjk-ok
    arcPlanTableTitle: en ? 'Current Arc Chapter Outline Plan' : '当前冲突幕 · 分章细纲排期表', // cjk-ok
    arcPlanTableHint: en
      ? 'Derived from upstream Economy System progression curve. Click any chapter to load its outline or generate immediately.'
      : '根据上游经济系统冲突幕次自动排期（起势铺垫 → 奇遇立威 → 绝境卡点 → 亮底牌打脸），点击即可填入细纲或立即生成该章。', // cjk-ok
    useOutlineBtn: en ? 'Load Outline' : '填入本章细纲', // cjk-ok
    runOutlineNowBtn: (ch: number) => (en ? `Gen Ch.${ch}` : `立即生成第${ch}章`), // cjk-ok
    modelSectionTitle: en ? 'Text Generation Model' : '小说创作大模型', // cjk-ok
    chapterOutlineTitle: (chap: number) =>
      isOutlineModeNode.value
        ? en
          ? 'Novel Outline & Per-Chapter Plan Prompt'
          : '全书大纲与分章细纲生成指令' // cjk-ok
        : en
          ? `Chapter ${chap} Plot Outline & Prompt`
          : `第 ${chap} 章剧情细纲与写作指令`, // cjk-ok
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

function extractOutlineMasterTitle(rawText: string): string {
  const lines = (rawText ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  for (const line of lines.slice(0, 12)) {
    const h1 = /^#\s+(.+)$/.exec(line)
    if (h1?.[1]?.trim()) return h1[1].trim()
    const plainTitle = /^(?:小说名|书名|Title)\s*[:：]\s*(.+)$/i.exec(line) // cjk-ok
    if (plainTitle?.[1]?.trim()) {
      return isEn.value
        ? `${plainTitle[1].trim()} · Master Outline (${totalChapters.value} Chaps)`
        : `${plainTitle[1].trim()} · 全书大纲总纲（${totalChapters.value}章）` // cjk-ok
    }
  }
  const baseName = displayName.value.trim() || (isEn.value ? 'Novel Outline' : '小说大纲') // cjk-ok
  return isEn.value
    ? `${baseName} (${totalChapters.value} Chapters)`
    : `${baseName}（${totalChapters.value}章全书总纲）` // cjk-ok
}

function syncCurrentChapterTitleFromNode(): void {
  if (isOutlineModeNode.value) {
    currentChapterTitle.value = extractOutlineMasterTitle(localText.value || worldBible.value || '')
    return
  }
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

const editorDirty = ref(false)

function loadFromNode(): void {
  const current = node.value
  if (!current) return
  editorDirty.value = false
  displayName.value = current.title?.trim() || ''
  const rawText = current.params.text ?? ''
  localText.value = rawText.trim() === '…' ? '' : rawText
  const isOutline = current.typeId === 'novel.outline' || current.params.novelNodeMode === 'outline'
  rightTab.value = isOutline ? 'arcPlan' : 'pacing'
  docViewMode.value = isOutline ? 'preview' : 'edit'

  const upPrev = !isOutline ? upstreamPrevChapterNode.value : null
  const upOutline = !isOutline ? upstreamOutlineNode.value : null

  const storedInst = current.params.generateInstruction?.trim()
  instruction.value =
    storedInst || (isOutline ? defaultNovelOutlineUserPrompt(String(locale.value)) : '')
  const storedSys = current.params.generateSystemPrompt?.trim()
  systemPrompt.value =
    storedSys ||
    (isOutline
      ? defaultNovelOutlineSystemPrompt(String(locale.value))
      : defaultNovelSystemPrompt(String(locale.value)))

  const resolvedGenre =
    current.params.novelGenre || upPrev?.params.novelGenre || upOutline?.params.novelGenre
  novelGenre.value = isNovelGenreId(resolvedGenre) ? resolvedGenre : 'urban_reversal'
  customStagesText.value =
    current.params.novelCustomStagesText ??
    upPrev?.params.novelCustomStagesText ??
    upOutline?.params.novelCustomStagesText ??
    ''
  customAxisProtagonist.value =
    current.params.novelCustomAxisProtagonist ??
    upPrev?.params.novelCustomAxisProtagonist ??
    upOutline?.params.novelCustomAxisProtagonist ??
    ''
  customAxisAntagonist.value =
    current.params.novelCustomAxisAntagonist ??
    upPrev?.params.novelCustomAxisAntagonist ??
    upOutline?.params.novelCustomAxisAntagonist ??
    ''
  customUnlockTerm.value =
    current.params.novelCustomUnlockTerm ??
    upPrev?.params.novelCustomUnlockTerm ??
    upOutline?.params.novelCustomUnlockTerm ??
    ''

  const rawTotal =
    Number(current.params.novelTotalChapters) ||
    Number(upOutline?.params.novelTotalChapters) ||
    Number(upPrev?.params.novelTotalChapters) ||
    800
  totalChapters.value = Math.max(1, Math.min(5000, Math.round(rawTotal)))

  let resolvedChap = Math.round(Number(current.params.novelCurrentChapter) || 1)
  if (!isOutline) {
    const titleChap = inferExplicitNovelChapterNumber(current.title, undefined)
    if (titleChap !== null) {
      resolvedChap = titleChap
    } else if (upPrev && resolvedChap <= 1) {
      const prevChap =
        inferExplicitNovelChapterNumber(upPrev.title, undefined) ??
        Math.max(1, Math.round(Number(upPrev.params.novelCurrentChapter) || 1))
      resolvedChap = prevChap + 1
    }
  }
  currentChapterCursor.value = Math.max(1, Math.min(totalChapters.value, resolvedChap))

  const rawTargetWords =
    Number(current.params.novelTargetWords) ||
    Number(upPrev?.params.novelTargetWords) ||
    Number(upOutline?.params.novelTargetWords) ||
    3200
  targetWords.value = Math.max(1000, Math.min(15000, Math.round(rawTargetWords)))
  autoAdvanceChapter.value = current.params.novelAutoAdvanceChapter !== false

  worldBible.value =
    current.params.novelWorldBible?.trim() ||
    upPrev?.params.novelWorldBible?.trim() ||
    upOutline?.params.novelWorldBible?.trim() ||
    ''
  stateLedger.value =
    current.params.novelStateLedger?.trim() || upPrev?.params.novelStateLedger?.trim() || ''
  rollingSummary.value =
    current.params.novelRollingSummary?.trim() || upPrev?.params.novelRollingSummary?.trim() || ''
  chapterHistoryJson.value =
    current.params.novelChapterHistoryJson?.trim() ||
    upPrev?.params.novelChapterHistoryJson?.trim() ||
    ''

  // Parse or initialize character roster & foreshadowing pool (auto-inheriting from upstream chain)
  const rawRoster =
    current.params.novelCharacterRosterJson?.trim() ||
    upPrev?.params.novelCharacterRosterJson?.trim() ||
    upOutline?.params.novelCharacterRosterJson?.trim()
  characterRoster.value = normalizeNovelCharacterRoster(rawRoster)
  if (!characterRoster.value.length) {
    characterRoster.value = createDefaultNovelCharacterRoster(
      activeWorkbench.value,
      totalChapters.value,
      activeGenreProfile.value
    )
  }

  const rawFs =
    current.params.novelForeshadowingJson?.trim() ||
    upPrev?.params.novelForeshadowingJson?.trim() ||
    upOutline?.params.novelForeshadowingJson?.trim()
  foreshadowingPool.value = normalizeNovelForeshadowingPool(rawFs, totalChapters.value)
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
  const previewRel = current.params.previewRelativePath?.trim()
  if (!localText.value.trim() && isOutline && previewRel) {
    void loadTextByRelativePath(previewRel).then((body) => {
      if (body.trim() && !localText.value.trim()) {
        localText.value = body.trim()
        editorDirty.value = false
        syncCurrentChapterTitleFromNode()
      }
    })
  } else if (!localText.value.trim() && !isOutline && existingGallery.length > 0) {
    const activeIdx = activeChapterIndex()
    const activeItem =
      activeIdx >= 0 ? existingGallery[activeIdx] : existingGallery[existingGallery.length - 1]
    if (activeItem) {
      void loadGeneratedTextBody(activeItem).then((body) => {
        if (body.trim() && !localText.value.trim()) {
          localText.value = body.trim()
          editorDirty.value = false
          syncCurrentChapterTitleFromNode()
        }
      })
    }
  } else if (!localText.value.trim() && previewRel) {
    void loadTextByRelativePath(previewRel).then((body) => {
      if (body.trim() && !localText.value.trim()) {
        localText.value = body.trim()
        editorDirty.value = false
        syncCurrentChapterTitleFromNode()
      }
    })
  } else if (isOutline && !localText.value.trim() && existingGallery.length === 0) {
    localText.value = buildStandardOutlineReadmeDoc()
    persistNovelBody(true)
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
      node.value?.params.previewRelativePath,
      node.value?.params.selectedTextId,
      generatedTexts.value
        .map((item) => `${item.id}:${item.relativePath ?? ''}:${(item.text ?? '').length}`)
        .join('|'),
      node.value?.params.novelCurrentChapter,
      node.value?.params.novelTotalChapters,
      node.value?.params.novelWorldBible,
      node.value?.params.novelStateLedger,
      node.value?.params.novelRollingSummary,
      node.value?.params.novelChapterHistoryJson
    ] as const,
  (
    [
      nextNodeText,
      nextPreviewRel,
      nextSelectedId,
      nextGallerySig,
      nextCursor,
      nextTotal,
      nextBible,
      nextLedger,
      nextSummary,
      nextHistJson
    ],
    prevTuple
  ) => {
    const prevNodeText = prevTuple?.[0]
    const prevPreviewRel = prevTuple?.[1]
    const prevSelectedId = prevTuple?.[2]
    const prevGallerySig = prevTuple?.[3]
    const normalized = (nextNodeText ?? '').trim() === '…' ? '' : (nextNodeText ?? '')
    if (nextNodeText !== prevNodeText && normalized && normalized !== localText.value) {
      localText.value = normalized
      editorDirty.value = false
      syncCurrentChapterTitleFromNode()
    } else if (nextPreviewRel && nextPreviewRel !== prevPreviewRel) {
      void loadTextByRelativePath(nextPreviewRel).then((body) => {
        if (body.trim()) {
          localText.value = body.trim()
          editorDirty.value = false
          syncCurrentChapterTitleFromNode()
        }
      })
    } else if (
      !isOutlineModeNode.value &&
      (nextSelectedId !== prevSelectedId || nextGallerySig !== prevGallerySig)
    ) {
      if (!nextSelectedId && !generatedTexts.value.length) {
        if (!normalized && !nextPreviewRel) {
          localText.value = ''
          editorDirty.value = false
        }
      } else {
        const matched =
          (nextSelectedId
            ? generatedTexts.value.find((item) => item.id === nextSelectedId)
            : undefined) ?? generatedTexts.value[generatedTexts.value.length - 1]
        if (matched) {
          void loadGeneratedTextBody(matched).then((body) => {
            if (body.trim()) {
              localText.value = body.trim()
              editorDirty.value = false
              syncCurrentChapterTitleFromNode()
            }
          })
        }
      }
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

function buildCumulativeGalleryUpToCurrentChapter(currentBodyOverride?: string): {
  items: StoredGeneratedText[]
  currentItemId: string
} {
  const current = node.value
  const curChap = Math.max(1, Math.floor(currentChapterCursor.value || 1))
  const byChap = new Map<number, StoredGeneratedText>()
  const parseItemChap = (title: string | undefined, fallbackChap: number): number => {
    if (!title) return fallbackChap
    const m = /第\s*(\d+)\s*(?:\/\s*\d+\s*)?章/.exec(title) || /Chapter\s*(\d+)/i.exec(title) // cjk-ok
    return m && m[1] ? Number(m[1]) : fallbackChap
  }

  // 1. 收集画布章节链中早于本章（1 ~ curChap-1）的所有章节
  for (const chainEntry of canvasChapterChainNodes.value) {
    if (chainEntry.chapterNumber >= curChap && chainEntry.node.id !== current?.id) continue
    const ancNode = chainEntry.node
    for (const [idx, item] of (ancNode.params.generatedTexts ?? []).entries()) {
      const chapNo = parseItemChap(item.title, idx + 1)
      if (chapNo >= 1 && chapNo <= curChap) {
        byChap.set(chapNo, { ...item })
      }
    }
    if (ancNode.id !== current?.id && chainEntry.chapterNumber < curChap) {
      const ancBody =
        (ancNode.params.text ?? '').trim() === '…' ? '' : (ancNode.params.text ?? '').trim()
      if (ancBody && !byChap.has(chainEntry.chapterNumber)) {
        const rawTitle = ancNode.title?.trim() || `第${chainEntry.chapterNumber}章` // cjk-ok
        const hasChapPrefix =
          /第\s*\d+\s*(?:\/\s*\d+\s*)?章/.test(rawTitle) || /Chapter\s*\d+/i.test(rawTitle) // cjk-ok
        byChap.set(chainEntry.chapterNumber, {
          id: `chap:${chainEntry.chapterNumber}:${ancNode.id}`,
          title: hasChapPrefix ? rawTitle : `第${chainEntry.chapterNumber}章：${rawTitle}`, // cjk-ok
          text: ancBody,
          createdAt: new Date().toISOString()
        })
      }
    }
  }

  // 2. 合并当前节点已有的 generatedTexts（章号 <= curChap）
  for (const [idx, item] of (current?.params.generatedTexts ?? []).entries()) {
    const chapNo = parseItemChap(item.title, idx + 1)
    if (chapNo >= 1 && chapNo <= curChap) {
      byChap.set(chapNo, { ...item })
    }
  }

  // 3. 写入或更新当前第 curChap 章
  const curBody = (currentBodyOverride ?? localText.value).trim()
  const existingCur = byChap.get(curChap)
  const curItemId = existingCur?.id || `chap:${curChap}:${current?.id ?? 'self'}`
  const rawCurTitle =
    currentChapterTitle.value.trim() || existingCur?.title?.trim() || `第${curChap}章` // cjk-ok
  const hasCurChapPrefix =
    /第\s*\d+\s*(?:\/\s*\d+\s*)?章/.test(rawCurTitle) || /Chapter\s*\d+/i.test(rawCurTitle) // cjk-ok
  if (curBody || existingCur) {
    byChap.set(curChap, {
      ...(existingCur ?? {}),
      id: curItemId,
      title: hasCurChapPrefix ? rawCurTitle : `第${curChap}章：${rawCurTitle}`, // cjk-ok
      text: currentBodyOverride ?? localText.value,
      createdAt: existingCur?.createdAt || new Date().toISOString()
    })
  }

  const sortedItems = [...byChap.entries()].sort((a, b) => a[0] - b[0]).map(([, item]) => item)

  return { items: sortedItems, currentItemId: curItemId }
}

let editorDebounceTimer: ReturnType<typeof setTimeout> | null = null

function onEditorInput(): void {
  editorDirty.value = true
  if (editorDebounceTimer) clearTimeout(editorDebounceTimer)
  editorDebounceTimer = setTimeout(() => {
    persistNovelBody()
  }, 280)
}

function persistNovelBody(force?: boolean | Event): void {
  if (editorDebounceTimer) {
    clearTimeout(editorDebounceTimer)
    editorDebounceTimer = null
  }
  if (force !== true && !editorDirty.value) return
  const current = node.value
  if (!current || !props.hostId) return
  editorDirty.value = false
  const nextText = localText.value
  const list = [...(current.params.generatedTexts ?? [])]
  const selectedId = current.params.selectedTextId?.trim() || list[list.length - 1]?.id || ''
  const selectedIdx = selectedId ? list.findIndex((item) => item.id === selectedId) : -1
  const selectedItem = selectedIdx >= 0 ? list[selectedIdx] : undefined

  const nextHist = { ...parsedHistoryMap.value }
  if (nextText.trim()) {
    const cleanedLines = nextText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
    const tailAnchor = cleanedLines.slice(-4).join('\n').slice(-550)
    const chapNum = selectedItem
      ? extractChapterNumFromTitle(selectedItem.title, selectedIdx)
      : currentChapterCursor.value
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

  if (!isOutlineModeNode.value) {
    const { items: cumulativeItems, currentItemId } =
      buildCumulativeGalleryUpToCurrentChapter(nextText)
    if (cumulativeItems.length > 0) {
      resolvedFullChapterText.value = {
        ...resolvedFullChapterText.value,
        [currentItemId]: nextText.trim()
      }
      const hostIdSnapshot = props.hostId
      const nodeIdSnapshot = current.id
      void saveGraphRunTextForNode({
        node: current,
        content: nextText,
        key: currentItemId
      }).then((relPath) => {
        const offloadedItems = cumulativeItems.map((it) =>
          it.id === currentItemId && relPath
            ? { ...it, text: '', relativePath: relPath }
            : it.relativePath
              ? { ...it, text: '' }
              : it
        )
        syncRunOutputsAfterGeneratedTextsChange(
          offloadedItems,
          currentItemId,
          relPath ? '' : nextText
        )
        graphEditorHosts.updateNode(hostIdSnapshot, nodeIdSnapshot, {
          text: relPath ? '' : nextText,
          ...(relPath ? { previewRelativePath: relPath } : {}),
          generatedTexts: offloadedItems,
          selectedTextId: currentItemId,
          novelChapterHistoryJson: chapterHistoryJson.value
        })
        graphEditorHosts.bumpRevision()
      })
      return
    }
  }

  if (
    !isOutlineModeNode.value &&
    list.length > 0 &&
    selectedId &&
    selectedIdx >= 0 &&
    selectedItem
  ) {
    const prevKnownText = (
      resolvedFullChapterText.value[selectedId] ??
      selectedItem.text ??
      ''
    ).trim()
    const trimmedNext = nextText.trim()
    if (!trimmedNext && selectedItem.relativePath?.trim() && !prevKnownText) {
      return
    }
    resolvedFullChapterText.value = {
      ...resolvedFullChapterText.value,
      [selectedId]: trimmedNext
    }
    const hostIdSnapshot = props.hostId
    const nodeIdSnapshot = current.id
    void saveGraphRunTextForNode({
      node: current,
      content: nextText,
      key: selectedId
    }).then((relPath) => {
      list[selectedIdx] = {
        ...selectedItem,
        text: relPath ? '' : nextText,
        ...(relPath ? { relativePath: relPath } : {})
      }
      syncRunOutputsAfterGeneratedTextsChange(list, selectedId, relPath ? '' : undefined)
      graphEditorHosts.updateNode(hostIdSnapshot, nodeIdSnapshot, {
        text: relPath ? '' : nextText,
        ...(relPath ? { previewRelativePath: relPath } : {}),
        generatedTexts: list,
        novelChapterHistoryJson: chapterHistoryJson.value
      })
      graphEditorHosts.bumpRevision()
    })
  } else {
    const hostIdSnapshot = props.hostId
    const nodeIdSnapshot = current.id
    void saveGraphRunTextForNode({
      node: current,
      content: nextText,
      key: isOutlineModeNode.value ? 'outline-full' : `chap-${currentChapterCursor.value}`
    }).then((relPath) => {
      const host = graphRunHosts.get(hostIdSnapshot)
      if (host) {
        const prev = host.runStates[nodeIdSnapshot] ?? { status: 'done' as const }
        host.runStates[nodeIdSnapshot] = {
          ...prev,
          status: prev.status === 'idle' ? 'done' : prev.status,
          outputs: {
            ...(prev.outputs ?? {}),
            out: {
              kind: 'text',
              text: relPath ? '' : nextText,
              ...(relPath ? { relativePath: relPath } : {})
            }
          }
        }
      }
      graphEditorHosts.updateNode(hostIdSnapshot, nodeIdSnapshot, {
        text: relPath ? '' : nextText,
        ...(relPath ? { previewRelativePath: relPath } : {}),
        novelChapterHistoryJson: chapterHistoryJson.value
      })
      graphEditorHosts.bumpRevision()
    })
  }
  graphEditorHosts.bumpRevision()
}

function persistChapterTitle(): void {
  const current = node.value
  if (!current || !props.hostId) return
  const trimmedTitle = currentChapterTitle.value.trim()
  if (isOutlineModeNode.value) {
    if (!trimmedTitle) return
    const lines = localText.value.split(/\r?\n/)
    const firstNonEmptyIdx = lines.findIndex((l) => l.trim().length > 0)
    if (firstNonEmptyIdx >= 0 && /^#\s+/.test(lines[firstNonEmptyIdx]!.trim())) {
      lines[firstNonEmptyIdx] = `# ${trimmedTitle.replace(/^#+\s*/, '')}`
      localText.value = lines.join('\n')
      persistNovelBody(true)
    }
    return
  }
  const list = [...(current.params.generatedTexts ?? [])]
  if (list.length === 0) {
    if (!trimmedTitle && !localText.value.trim()) return
    const id = `chap:${Date.now()}:1`
    const bodyText = localText.value
    const hostIdSnapshot = props.hostId
    const nodeIdSnapshot = current.id
    void saveGraphRunTextForNode({
      node: current,
      content: bodyText,
      key: id
    }).then((relPath) => {
      const firstItem: StoredGeneratedText = {
        id,
        title: trimmedTitle || ui.value.defaultChapterTitle(currentChapterCursor.value),
        text: relPath ? '' : bodyText,
        ...(relPath ? { relativePath: relPath } : {}),
        createdAt: new Date().toISOString()
      }
      syncRunOutputsAfterGeneratedTextsChange([firstItem], id)
      graphEditorHosts.updateNode(hostIdSnapshot, nodeIdSnapshot, {
        generatedTexts: [firstItem],
        selectedTextId: id,
        text: relPath ? '' : bodyText,
        ...(relPath ? { previewRelativePath: relPath } : {})
      })
      graphEditorHosts.bumpRevision()
    })
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
  editorDirty.value = false
  const dispTitle = chapterDisplayTitle(item, idx >= 0 ? idx : (indexFallback ?? 0))
  currentChapterTitle.value = dispTitle
  const chapNum = extractChapterNumFromTitle(dispTitle, idx >= 0 ? idx : 0)
  currentChapterCursor.value = Math.max(1, Math.min(totalChapters.value, chapNum))
  syncRunOutputsAfterGeneratedTextsChange(list, item.id)
  const itemRel = item.relativePath?.trim()
  graphEditorHosts.updateNode(props.hostId, current.id, {
    selectedTextId: item.id,
    text: itemRel ? '' : localText.value,
    ...(itemRel ? { previewRelativePath: itemRel } : {}),
    novelCurrentChapter: currentChapterCursor.value
  })
  graphEditorHosts.bumpRevision()
}

function triggerGenerateCurrentChapter(): void {
  persistNovelBody()
  persistGenerateConfig()
  persistMemoryFields()
  if (hasInPort.value && !blocked.value && runStatus.value !== 'running') {
    toggleRun()
  }
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
  persistNovelBody(true)
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
  persistNovelBody(true)
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

function insertAtCursorOrAppend(snippet: string): void {
  const el = editorTextareaRef.value
  const base = localText.value
  if (!base.trim() || base.trim() === '…') {
    localText.value = snippet.trimStart()
    persistNovelBody(true)
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
    persistNovelBody(true)
    void nextTick(() => {
      el.focus()
      const nextPos = start + inserted.length
      el.setSelectionRange(nextPos, nextPos)
    })
    return
  }
  localText.value = `${base.trimEnd()}\n\n${snippet.trimStart()}`
  persistNovelBody(true)
}

interface ReadmeDocBlock {
  id: string
  kind: 'heading' | 'paragraph' | 'list' | 'table' | 'blockquote' | 'code' | 'hr'
  level?: 1 | 2 | 3 | 4
  anchorId?: string
  rawHeading?: string
  text?: string
  chapterBadge?: string
  stageBadge?: string
  items?: string[]
  ordered?: boolean
  headers?: string[]
  rows?: string[][]
  lines?: string[]
  alertType?: 'note' | 'tip' | 'warning'
  lang?: string
  code?: string
}

interface OutlineTocItem {
  id: string
  anchorId: string
  rawHeading: string
  shortLabel: string
  level: 1 | 2 | 3 | 4
  isChapter: boolean
}

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function formatInlineMarkdown(raw: string): string {
  const escaped = escapeHtml(raw)
  return escaped
    .replace(/^\[x\]\s+/i, '<span class="md-checkbox checked">☑</span> ')
    .replace(/^\[\s\]\s+/, '<span class="md-checkbox">☐</span> ')
    .replace(/`([^`]+)`/g, '<code class="md-inline-code">$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/【([^】]{1,28})】/g, '<span class="md-bracket-pill">【$1】</span>')
}

const OUTLINE_PLAIN_CHAP_HEADING_RE =
  /^(?:第\s*([0-9一二三四五六七八九十百千]+)\s*(?:\/\s*\d+\s*)?章|Chapter\s+(\d+))(?:\s*[:：·—-]\s*(.*))?$/i // cjk-ok

const parsedReadmeBlocks = computed((): ReadmeDocBlock[] => {
  const raw = (localText.value ?? '').replace(/\r\n/g, '\n').trim()
  if (!raw) return []
  const lines = raw.split('\n')
  const blocks: ReadmeDocBlock[] = []
  let i = 0
  let blockSeq = 0

  while (i < lines.length) {
    const rawLine = lines[i] ?? ''
    const trimmed = rawLine.trim()
    if (!trimmed) {
      i++
      continue
    }

    // 1. Fenced code block ```
    if (trimmed.startsWith('```')) {
      const lang = trimmed.slice(3).trim()
      const codeLines: string[] = []
      i++
      while (i < lines.length && !(lines[i] ?? '').trim().startsWith('```')) {
        codeLines.push(lines[i] ?? '')
        i++
      }
      if (i < lines.length) i++
      blocks.push({
        id: `b_${++blockSeq}`,
        kind: 'code',
        lang,
        code: codeLines.join('\n')
      })
      continue
    }

    // 2. Horizontal rule --- / ***
    if (/^(?:---+|\*\*\*+|___+)$/.test(trimmed)) {
      blocks.push({ id: `b_${++blockSeq}`, kind: 'hr' })
      i++
      continue
    }

    // 3. Explicit Markdown Heading (# ~ ####) OR Plain-text Novel Outline Title / Section / Chapter Header
    const mdHeadingMatch = /^(#{1,4})\s+(.+)$/.exec(trimmed)
    const plainTitleMatch = !mdHeadingMatch ? /^小说名\s*[:：]\s*(.+)$/.exec(trimmed) : null // cjk-ok
    const plainSectionMatch =
      !mdHeadingMatch && !plainTitleMatch ? /^【([^】]{2,32})】$/.exec(trimmed) : null
    const plainChapMatch =
      !mdHeadingMatch && !plainTitleMatch && !plainSectionMatch
        ? OUTLINE_PLAIN_CHAP_HEADING_RE.exec(trimmed)
        : null

    if (mdHeadingMatch || plainTitleMatch || plainSectionMatch || plainChapMatch) {
      let level: 1 | 2 | 3 | 4 = 2
      let headingBody = trimmed
      if (mdHeadingMatch) {
        level = Math.min(4, Math.max(1, mdHeadingMatch[1]!.length)) as 1 | 2 | 3 | 4
        headingBody = mdHeadingMatch[2]!.trim()
      } else if (plainTitleMatch) {
        level = 1
        headingBody = trimmed
      } else if (plainSectionMatch) {
        level = 2
        headingBody = trimmed
      } else if (plainChapMatch) {
        level = 3
        headingBody = trimmed
      }

      // Extract optional chapter badge and stage badge for chapter headings
      let chapterBadge: string | undefined
      let stageBadge: string | undefined
      const chapCheckRe =
        /^(?:【\s*)?(?:第\s*([0-9一二三四五六七八九十百千]+)\s*(?:\/\s*\d+\s*)?章|Chapter\s+(\d+))/i // cjk-ok
      const chapCheck = chapCheckRe.exec(headingBody)
      if (chapCheck) {
        const chapToken = chapCheck[1] || chapCheck[2] || ''
        chapterBadge = isEn.value ? `Ch.${chapToken}` : `第${chapToken}章` // cjk-ok
        const parenMatch = /[（(]([^）)\n]{2,36})[）)]\s*$/.exec(headingBody)
        if (parenMatch?.[1]) {
          stageBadge = parenMatch[1].trim()
          headingBody = headingBody.slice(0, parenMatch.index).trim()
        }
      }

      const id = `b_${++blockSeq}`
      blocks.push({
        id,
        kind: 'heading',
        level,
        anchorId: `outline_sec_${blockSeq}`,
        rawHeading: trimmed.replace(/^#+\s*/, ''),
        text: headingBody,
        chapterBadge,
        stageBadge
      })
      i++
      continue
    }

    // 4. Blockquote > ...
    if (trimmed.startsWith('>')) {
      const quoteLines: string[] = []
      let alertType: 'note' | 'tip' | 'warning' | undefined
      while (i < lines.length && (lines[i] ?? '').trim().startsWith('>')) {
        const qContent = (lines[i] ?? '').trim().replace(/^>\s?/, '')
        if (!quoteLines.length && /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i.test(qContent)) {
          const tag = qContent.toUpperCase()
          alertType =
            tag.includes('WARN') || tag.includes('CAUTION')
              ? 'warning'
              : tag.includes('TIP')
                ? 'tip'
                : 'note'
          const rest = qContent.replace(/^\[![A-Z]+\]\s*/i, '').trim()
          if (rest) quoteLines.push(rest)
        } else if (qContent) {
          quoteLines.push(qContent)
        }
        i++
      }
      blocks.push({
        id: `b_${++blockSeq}`,
        kind: 'blockquote',
        lines: quoteLines,
        alertType
      })
      continue
    }

    // 5. GFM Table | ... |
    if (trimmed.startsWith('|') && trimmed.endsWith('|') && trimmed.length > 2) {
      const tableLines: string[] = []
      while (i < lines.length) {
        const tLine = (lines[i] ?? '').trim()
        if (tLine.startsWith('|') && tLine.endsWith('|')) {
          tableLines.push(tLine)
          i++
        } else {
          break
        }
      }
      if (tableLines.length >= 2) {
        const parseRow = (r: string): string[] =>
          r
            .slice(1, -1)
            .split('|')
            .map((c) => c.trim())
        const headers = parseRow(tableLines[0]!)
        const isSep = /^[\s|:-]+$/.test(tableLines[1]!)
        const dataStart = isSep ? 2 : 1
        const rows = tableLines.slice(dataStart).map(parseRow)
        blocks.push({
          id: `b_${++blockSeq}`,
          kind: 'table',
          headers,
          rows
        })
        continue
      }
    }

    // 6. Unordered or Ordered List
    const ulMatch = /^[-*•]\s+(.+)$/.exec(trimmed)
    const olMatch = !ulMatch ? /^\d+\.\s+(.+)$/.exec(trimmed) : null
    if (ulMatch || olMatch) {
      const ordered = Boolean(olMatch)
      const items: string[] = []
      while (i < lines.length) {
        const lTrim = (lines[i] ?? '').trim()
        const m = ordered ? /^\d+\.\s+(.+)$/.exec(lTrim) : /^[-*•]\s+(.+)$/.exec(lTrim)
        if (!m?.[1]) break
        let itemText = m[1].trim()
        // Auto-bold plain "字段名：内容" list items for cleaner README presentation
        if (!itemText.includes('**')) {
          itemText = itemText.replace(
            /^([\u4e00-\u9fa5A-Za-z0-9·/（()）\s]{2,22})\s*([:：])\s*(.+)$/,
            '**$1**$2$3'
          )
        }
        items.push(itemText)
        i++
      }
      blocks.push({
        id: `b_${++blockSeq}`,
        kind: 'list',
        ordered,
        items
      })
      continue
    }

    // 7. Paragraph
    const paraLines: string[] = []
    while (i < lines.length) {
      const pTrim = (lines[i] ?? '').trim()
      if (
        !pTrim ||
        pTrim.startsWith('#') ||
        pTrim.startsWith('>') ||
        pTrim.startsWith('```') ||
        (pTrim.startsWith('|') && pTrim.endsWith('|')) ||
        /^[-*•]\s+/.test(pTrim) ||
        /^\d+\.\s+/.test(pTrim) ||
        /^(?:---+|\*\*\*+|___+)$/.test(pTrim) ||
        /^小说名\s*[:：]/.test(pTrim) || // cjk-ok
        /^【[^】]{2,32}】$/.test(pTrim) ||
        OUTLINE_PLAIN_CHAP_HEADING_RE.test(pTrim)
      ) {
        break
      }
      paraLines.push(pTrim)
      i++
    }
    if (paraLines.length > 0) {
      blocks.push({
        id: `b_${++blockSeq}`,
        kind: 'paragraph',
        text: paraLines.join(' ')
      })
    } else {
      i++
    }
  }

  return blocks
})

const outlineTocItems = computed((): OutlineTocItem[] => {
  return parsedReadmeBlocks.value
    .filter((b) => b.kind === 'heading' && b.anchorId && b.text)
    .map((b) => {
      const rawText = (b.text ?? '').replace(/\*\*/g, '').trim()
      const isChapter = Boolean(b.chapterBadge)
      let shortLabel = rawText
      if (isChapter && b.chapterBadge) {
        const afterColon = rawText.split(/[:：]/)[1]?.trim() || ''
        shortLabel = afterColon ? `${b.chapterBadge}·${afterColon.slice(0, 8)}` : b.chapterBadge
      } else {
        shortLabel = rawText
          .replace(/^小说名\s*[:：]\s*/i, '') // cjk-ok
          .replace(/^[【[]|[】\]]$/g, '')
          .slice(0, 14)
      }
      return {
        id: b.id,
        anchorId: b.anchorId!,
        rawHeading: b.rawHeading || rawText,
        shortLabel,
        level: b.level ?? 2,
        isChapter
      }
    })
})

function focusHeadingInSource(headingText: string): void {
  const cleanTarget = headingText.replace(/^#+\s*/, '').trim()
  if (!cleanTarget) return
  if (docViewMode.value === 'preview') {
    docViewMode.value = 'split'
  }
  void nextTick(() => {
    const el = editorTextareaRef.value
    if (!el) return
    const src = localText.value
    const idx = src.indexOf(cleanTarget)
    el.focus()
    if (idx >= 0) {
      el.setSelectionRange(idx, idx + cleanTarget.length)
      const lineNo = src.slice(0, idx).split('\n').length
      el.scrollTop = Math.max(0, (lineNo - 3) * 26)
    }
  })
}

function scrollToOutlineHeading(toc: OutlineTocItem): void {
  if (docViewMode.value === 'preview' || docViewMode.value === 'split') {
    const container = readmePaneRef.value
    const targetEl = container?.querySelector(`#${toc.anchorId}`) as HTMLElement | null
    if (targetEl && container) {
      targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }
  if (docViewMode.value === 'edit' || docViewMode.value === 'split') {
    const el = editorTextareaRef.value
    if (el) {
      const idx = localText.value.indexOf(toc.rawHeading)
      if (idx >= 0) {
        el.focus()
        el.setSelectionRange(idx, idx + toc.rawHeading.length)
        const lineNo = localText.value.slice(0, idx).split('\n').length
        el.scrollTop = Math.max(0, (lineNo - 3) * 26)
      }
    }
  }
}

async function copyCodeBlock(code: string, id: string): Promise<void> {
  try {
    await navigator.clipboard?.writeText(code)
    copiedCodeBlockId.value = id
    setTimeout(() => {
      if (copiedCodeBlockId.value === id) copiedCodeBlockId.value = null
    }, 1500)
  } catch {
    // ignore clipboard errors in headless environments
  }
}

function buildStandardOutlineReadmeDoc(): string {
  const gp = activeGenreProfile.value
  const tot = totalChapters.value
  const words = targetWords.value
  const rawTitle = displayName.value.trim() || currentChapterTitle.value.trim()
  const cleanBookTitle =
    rawTitle.replace(/^《|》$/g, '').trim() ||
    (isEn.value
      ? `${gp.labelEn.split(' / ')[0]} Master Outline`
      : `${gp.labelZh.split(' / ')[0]}·长篇连载总纲`) // cjk-ok

  const stages = gp.stageNamesZh.length
    ? gp.stageNamesZh
    : ['潜龙蛰伏期', '锋芒初露期', '省域争霸期', '万界巅峰期'] // cjk-ok
  const roster = characterRoster.value.length
    ? characterRoster.value
    : createDefaultNovelCharacterRoster(activeWorkbench.value, tot, gp)
  const hero = roster.find((r) => r.faction === 'protagonist') || roster[0]
  const ally = roster.find((r) => r.faction === 'ally') || roster[1]
  const villain = roster.find((r) => r.faction === 'villain') || roster[2]
  const heroName = hero?.name || gp.roster[0]?.name || '林深' // cjk-ok
  const allyName = ally?.name || '苏凛' // cjk-ok
  const villainName = villain?.name || '赵天铭' // cjk-ok

  const rosterRows = roster.map((c) => {
    const factionZh =
      c.faction === 'protagonist'
        ? '核心主角' // cjk-ok
        : c.faction === 'ally'
          ? '关键盟友' // cjk-ok
          : c.faction === 'villain'
            ? '宿敌反派' // cjk-ok
            : '中立势力' // cjk-ok
    return `| **${c.name}** | ${factionZh} | ${c.realmOrRole || stages[0]} | ${c.relationNote || '核心剧情推动者'} |` // cjk-ok
  })

  const v1End = Math.min(tot, 30)
  const v2Start = Math.min(tot, 31)
  const v2End = Math.min(tot, 120)
  const v3Start = Math.min(tot, 121)
  const v3End = Math.min(tot, 360)

  const planItems = arcOutlinePlan.value.slice(0, 6)
  const chapterOutlineBlocks =
    planItems.length > 0
      ? planItems.flatMap((p) => [
          `### 第${p.chapter}章：${p.titleZh}（第 ${p.chapter}/${tot} 章 · ${stages[0]}）`, // cjk-ok
          `- **章节导读与节拍**：${p.beatBadgeZh}（本章${gp.protagonistAxisZh}上限 ${p.powerCeiling}）。${p.coreConflictZh}`, // cjk-ok
          `- **数值与底牌锚点**：准许动用【${chapterSlice.value.allowedTrumpCards.slice(0, 2).join(' / ') || gp.unlockItemsZh[0] || '初期底牌'}】，严禁提前解封终局底牌。`, // cjk-ok
          `- **章末断章钩子**：${p.cliffhangerHookZh}`, // cjk-ok
          ``
        ])
      : [
          `### 第1章：绝境死局与初次觉醒（第 1/${tot} 章 · ${stages[0]}）`, // cjk-ok
          `- **章节导读与节拍**：起势铺垫期。${heroName}在底层绝境中遭遇${villainName}势力的极限挤压，在生死临界点首次触动初期${gp.unlockTermZh}，并在章末发现更深层的危机线索。`, // cjk-ok
          `- **章末断章钩子**：暗中窥伺的神秘势力浮出水面，危机倒计时正式开启。`, // cjk-ok
          ``,
          `### 第2章：暗流博弈与机缘试锋（第 2/${tot} 章 · ${stages[0]}）`, // cjk-ok
          `- **章节导读与节拍**：机缘成长期。承接第 1 章末尾的突发危机，${heroName}与${allyName}首次交锋试探，利用新掌控的初期${gp.unlockTermZh}化解杀局，反手夺取关键破局筹码。`, // cjk-ok
          `- **章末断章钩子**：${villainName}察觉外围据点失守，调集核心人手布下天罗地网。`, // cjk-ok
          ``,
          `### 第3章：强敌反扑与底牌立威（第 3/${tot} 章 · ${stages[0]}）`, // cjk-ok
          `- **章节导读与节拍**：高潮破局期。${villainName}亲自下场封锁退路，${heroName}引爆本阶段准入${gp.unlockTermZh}完成当众反杀，震动全场并引出幕后更高阶势力。`, // cjk-ok
          `- **章末断章钩子**：战利品中惊现指向更高版图的机密残卷，新风暴酝酿成形。` // cjk-ok
        ]

  return [
    `# 小说名：《${cleanBookTitle}》`, // cjk-ok
    ``,
    `> **题材流派**：${gp.icon} ${gp.labelZh} ｜ **规划总章数**：${tot} 章 ｜ **单章规格**：${words}+ 字 ｜ **数值驱动**：${activeWorkbench.value.multiplier.title} (\`${activeWorkbench.value.multiplier.finalFormula}\`)`, // cjk-ok
    ``,
    `## 【核心设定与人物档案】`, // cjk-ok
    `- **题材流派与总规模**：${gp.labelZh}（规划总章数：${tot} 章 · 单章规格：${words}+ 字）`, // cjk-ok
    `- **${gp.stageTermZh}突破阶梯**：\`${stages.join(' ➔ ')}\``, // cjk-ok
    `- **${heroName}**（核心主角）：身处【${stages[0]}】逆境，凭借初期${gp.unlockTermZh}步步破局。`, // cjk-ok
    `- **${allyName}**（关键盟友）：掌握关键情报与资源渠道，在主角破局后建立深度同盟。`, // cjk-ok
    `- **${villainName}**（首卷宿敌）：掌控前期局部资源垄断，屡次施压设局。`, // cjk-ok
    ``,
    `| 角色姓名 | 阵营定位 | 初始${gp.stageTermZh} | 核心动机与戏剧功能 |`, // cjk-ok
    `| :--- | :--- | :--- | :--- |`,
    ...rosterRows,
    ``,
    `---`,
    ``,
    `## 【全书分卷与长线大纲】`, // cjk-ok
    ``,
    `| 卷序 | 章节区间 | 分卷核心主题 | 对应${gp.stageTermZh}阶段 | 卷末高潮卡点 |`, // cjk-ok
    `| :--- | :--- | :--- | :--- | :--- |`,
    `| **第一卷** | 第 1~${v1End} 章 | ${gp.volumeThemesZh[0] ?? '危机降临与初露锋芒'} | ${stages[0]} | 引爆初期${gp.unlockTermZh}，粉碎首轮围剿 |`, // cjk-ok
    `| **第二卷** | 第 ${v2Start}~${v2End} 章 | ${gp.volumeThemesZh[1] ?? '势力洗牌与破局立威'} | ${stages[1] ?? stages[0]} | 跨入更高版图，正面击溃宿敌主力 |`, // cjk-ok
    `| **第三卷** | 第 ${v3Start}~${v3End} 章 | ${gp.volumeThemesZh[2] ?? '省域争霸与法则重构'} | ${stages[2] ?? stages[0]} | 登顶区域霸主，揭开终局幕后黑手 |`, // cjk-ok
    `| **第四卷** | 第 ${Math.min(tot, v3End + 1)}~${tot} 章 | ${gp.volumeThemesZh[3] ?? '终局决战与万界登顶'} | ${stages[3] ?? stages[stages.length - 1]} | 兑现全部长线伏笔，成就终极巅峰 |`, // cjk-ok
    ``,
    `- 第一卷（第 1~${v1End} 章）：${gp.volumeThemesZh[0] ?? '危机降临与初露锋芒'}（当前阶段：${stages[0]}）`, // cjk-ok
    `- 第二卷（第 ${v2Start}~${v2End} 章）：${gp.volumeThemesZh[1] ?? '势力洗牌与破局立威'}（进阶阶段：${stages[1] ?? stages[0]}）`, // cjk-ok
    `- 第三卷（第 ${v3Start}~${v3End} 章）：${gp.volumeThemesZh[2] ?? '省域争霸与法则重构'}（高阶阶段：${stages[2] ?? stages[0]}）`, // cjk-ok
    ``,
    `---`,
    ``,
    `## 【分章细纲】`, // cjk-ok
    ``,
    ...chapterOutlineBlocks
  ]
    .join('\n')
    .trim()
}

function scrollPreviewAndEditorToHeadingKeyword(keyword: string): void {
  void nextTick(() => {
    if (docViewMode.value === 'preview' || docViewMode.value === 'split') {
      const container = readmePaneRef.value
      if (container) {
        const headings = Array.from(container.querySelectorAll('.readme-heading')) as HTMLElement[]
        const matchEl = headings.find((h) => (h.textContent ?? '').includes(keyword))
        if (matchEl) {
          matchEl.scrollIntoView({ behavior: 'smooth', block: 'start' })
        }
      }
    }
    if (docViewMode.value === 'edit' || docViewMode.value === 'split') {
      const el = editorTextareaRef.value
      if (el) {
        const idx = localText.value.indexOf(keyword)
        if (idx >= 0) {
          el.focus()
          el.setSelectionRange(idx, idx + keyword.length)
          const lineNo = localText.value.slice(0, idx).split('\n').length
          el.scrollTop = Math.max(0, (lineNo - 3) * 26)
        }
      }
    }
  })
}

function synthesizeOutlineReadmeDoc(): void {
  localText.value = buildStandardOutlineReadmeDoc()
  syncCurrentChapterTitleFromNode()
  persistNovelBody(true)
  if (docViewMode.value === 'edit') {
    docViewMode.value = 'preview'
  }
  synthesizeOutlineFlash.value = true
  setTimeout(() => {
    synthesizeOutlineFlash.value = false
  }, 1600)
  void nextTick(() => {
    if (readmePaneRef.value) {
      readmePaneRef.value.scrollTo({ top: 0, behavior: 'smooth' })
    }
  })
}

function insertVolumeTableBlock(): void {
  const gp = activeGenreProfile.value
  const tot = totalChapters.value
  const stages = gp.stageNamesZh.length
    ? gp.stageNamesZh
    : ['潜龙蛰伏期', '锋芒初露期', '省域争霸期', '万界巅峰期'] // cjk-ok
  const v1End = Math.min(tot, 30)
  const v2Start = Math.min(tot, 31)
  const v2End = Math.min(tot, 120)
  const v3Start = Math.min(tot, 121)
  const v3End = Math.min(tot, 360)
  const v4Start = Math.min(tot, v3End + 1)
  const snippet = isEn.value
    ? [
        `## 【Volume Architecture (${gp.labelEn} · ${tot} Chaps)】`,
        ``,
        `| Volume | Chapter Range | Core Theme | Stage Target | Volume Climax |`,
        `| :--- | :--- | :--- | :--- | :--- |`,
        `| **Vol. 1** | Ch. 1~${v1End} | ${gp.volumeThemesZh[0] ?? 'Opening Crisis'} | ${stages[0]} | First major reversal |`,
        `| **Vol. 2** | Ch. ${v2Start}~${v2End} | ${gp.volumeThemesZh[1] ?? 'Faction Showdown'} | ${stages[1] ?? stages[0]} | Regional dominance |`,
        `| **Vol. 3** | Ch. ${v3Start}~${v3End} | ${gp.volumeThemesZh[2] ?? 'Domain Hegemony'} | ${stages[2] ?? stages[0]} | Uncover mastermind |`,
        `| **Vol. 4** | Ch. ${v4Start}~${tot} | ${gp.volumeThemesZh[3] ?? 'Final Ascension'} | ${stages[3] ?? stages[stages.length - 1]} | Ultimate payoff |`,
        ``,
        `- 第一卷（第 1~${v1End} 章）：${gp.volumeThemesZh[0] ?? '危机降临与初露锋芒'}（当前阶段：${stages[0]}）`, // cjk-ok
        `- 第二卷（第 ${v2Start}~${v2End} 章）：${gp.volumeThemesZh[1] ?? '势力洗牌与破局立威'}（进阶阶段：${stages[1] ?? stages[0]}）`, // cjk-ok
        `- 第三卷（第 ${v3Start}~${v3End} 章）：${gp.volumeThemesZh[2] ?? '省域争霸与法则重构'}（高阶阶段：${stages[2] ?? stages[0]}）`, // cjk-ok
        `- 第四卷（第 ${v4Start}~${tot} 章）：${gp.volumeThemesZh[3] ?? '终局决战与万界登顶'}（巅峰阶段：${stages[3] ?? stages[stages.length - 1]}）` // cjk-ok
      ].join('\n')
    : [
        `## 【全书分卷与长线大纲】`, // cjk-ok
        ``,
        `| 卷序 | 章节区间 | 分卷核心主题 | 对应${gp.stageTermZh}阶段 | 卷末高潮卡点 |`, // cjk-ok
        `| :--- | :--- | :--- | :--- | :--- |`,
        `| **第一卷** | 第 1~${v1End} 章 | ${gp.volumeThemesZh[0] ?? '危机降临与初露锋芒'} | ${stages[0]} | 引爆初期${gp.unlockTermZh}，粉碎首轮围剿 |`, // cjk-ok
        `| **第二卷** | 第 ${v2Start}~${v2End} 章 | ${gp.volumeThemesZh[1] ?? '势力洗牌与破局立威'} | ${stages[1] ?? stages[0]} | 跨入更高版图，正面击溃宿敌主力 |`, // cjk-ok
        `| **第三卷** | 第 ${v3Start}~${v3End} 章 | ${gp.volumeThemesZh[2] ?? '省域争霸与法则重构'} | ${stages[2] ?? stages[0]} | 登顶区域霸主，揭开终局幕后黑手 |`, // cjk-ok
        `| **第四卷** | 第 ${v4Start}~${tot} 章 | ${gp.volumeThemesZh[3] ?? '终局决战与万界登顶'} | ${stages[3] ?? stages[stages.length - 1]} | 兑现全部长线伏笔，成就终极巅峰 |`, // cjk-ok
        ``,
        `- 第一卷（第 1~${v1End} 章）：${gp.volumeThemesZh[0] ?? '危机降临与初露锋芒'}（当前阶段：${stages[0]}）`, // cjk-ok
        `- 第二卷（第 ${v2Start}~${v2End} 章）：${gp.volumeThemesZh[1] ?? '势力洗牌与破局立威'}（进阶阶段：${stages[1] ?? stages[0]}）`, // cjk-ok
        `- 第三卷（第 ${v3Start}~${v3End} 章）：${gp.volumeThemesZh[2] ?? '省域争霸与法则重构'}（高阶阶段：${stages[2] ?? stages[0]}）`, // cjk-ok
        `- 第四卷（第 ${v4Start}~${tot} 章）：${gp.volumeThemesZh[3] ?? '终局决战与万界登顶'}（巅峰阶段：${stages[3] ?? stages[stages.length - 1]}）` // cjk-ok
      ].join('\n')

  const base = localText.value.trim()
  if (!base || base === '…') {
    localText.value = snippet
    persistNovelBody(true)
  } else if (docViewMode.value === 'edit' && document.activeElement === editorTextareaRef.value) {
    insertAtCursorOrAppend(snippet)
  } else {
    // 若已存在【全书分卷与长线大纲】章节，原地刷新该分卷表；否则智能插入到【分章细纲】或「第1章」标题之前
    const existingVolSectionRe =
      /##\s*(?:【全书分卷与长线大纲】|【Volume Architecture[^】]*】)[\s\S]*?(?=\n(?:---|##\s+|\n###\s*第\s*1\s*章)|$)/i // cjk-ok
    if (existingVolSectionRe.test(base)) {
      localText.value = base.replace(existingVolSectionRe, snippet)
    } else {
      const chapSectionRe =
        /^(?:#{1,4}\s*)?(?:[一二三四五六1-9][、.．]\s*)?(?:【?分章细纲|第\s*1\s*(?:\/\s*\d+\s*)?章|Chapter\s+1\b)/im // cjk-ok
      const m = chapSectionRe.exec(base)
      if (m && typeof m.index === 'number' && m.index > 0) {
        const before = base.slice(0, m.index).trimEnd()
        const after = base.slice(m.index).trimStart()
        localText.value = `${before}\n\n${snippet}\n\n---\n\n${after}`
      } else {
        localText.value = `${base}\n\n---\n\n${snippet}`
      }
    }
    persistNovelBody(true)
  }

  insertVolumeFlash.value = true
  setTimeout(() => {
    insertVolumeFlash.value = false
  }, 1600)
  scrollPreviewAndEditorToHeadingKeyword(isEn.value ? 'Volume Architecture' : '全书分卷与长线大纲') // cjk-ok
}

function insertCharacterProfileBlock(): void {
  const s = chapterSlice.value
  const gp = activeGenreProfile.value
  const hero = characterRoster.value.find((c) => c.faction === 'protagonist')
  const ally = characterRoster.value.find((c) => c.faction === 'ally')
  const foe = characterRoster.value.find((c) => c.faction === 'villain')
  const heroName = hero?.name || gp.roster[0]?.name || '林玄' // cjk-ok
  const heroNote = hero?.relationNote || gp.roster[0]?.note || '谋定后动，果决坚韧' // cjk-ok
  const allyName = ally?.name || '苏凛' // cjk-ok
  const foeName = foe?.name || '本幕对手' // cjk-ok
  const snippet = isOutlineModeNode.value
    ? [
        `## 【核心设定与人物档案】`, // cjk-ok
        `- **${heroName}**（核心主角）：${heroNote}；初始处于【${s.realmStageLabelZh}】，掌握准入${gp.unlockTermZh}【${s.allowedTrumpCards.slice(0, 2).join(' / ') || '核心筹码'}】。`, // cjk-ok
        `- **${allyName}**（关键盟友）：${ally?.relationNote || '掌握关键情报与高阶渠道，与主角形成战略互补'}。`, // cjk-ok
        `- **${foeName}**（首卷宿敌）：${foe?.relationNote || '掌控前期资源垄断，屡次设局施压'}。`, // cjk-ok
        ``,
        `| 角色姓名 | 阵营定位 | 当前${gp.stageTermZh} | 核心动机与剧情定位 |`, // cjk-ok
        `| :--- | :--- | :--- | :--- |`,
        `| **${heroName}** | 核心主角 | ${s.realmStageLabelZh} | ${heroNote} |`, // cjk-ok
        `| **${allyName}** | 关键盟友 | 情报/资源枢纽 | 协助破局并串联高阶地图版图 |`, // cjk-ok
        `| **${foeName}** | 首卷宿敌 | 威胁值 ${s.villainPressure} | 首卷核心冲突源与立威踏脚石 |` // cjk-ok
      ].join('\n')
    : isEn.value
      ? `## [Core Character Profiles (${gp.labelEn})]\n- **${heroName}** (${s.realmStageLabelZh}, ${gp.protagonistAxisEn} ${s.powerCeiling}): ${heroNote}. Allowed ${gp.unlockTermEn}: [${s.allowedTrumpCards.slice(0, 2).join(', ')}].\n- **${foeName}** (${gp.antagonistAxisEn} ${s.villainPressure}): Primary opposition in this arc.`
      : `## 【核心人物档案 · ${gp.labelZh}】\n- **${heroName}（当前${gp.stageTermZh}：${s.realmStageLabelZh} · ${gp.protagonistAxisZh} ${s.powerCeiling}）**：${heroNote}；本章可用${gp.unlockTermZh}【${s.allowedTrumpCards.slice(0, 2).join(' / ') || '核心筹码'}】。\n- **${foeName}（${gp.antagonistAxisZh}：${s.villainPressure}）**：${foe?.relationNote || '本幕核心对立势力'}。` // cjk-ok
  const base = localText.value.trim()
  if (!base || base === '…') {
    localText.value = snippet
  } else {
    const existingBiosSectionRe =
      /##\s*(?:【核心设定与人物档案】|\[Core Character Profiles[^\]]*\]|【核心人物档案[^】]*】)[\s\S]*?(?=\n(?:---|##\s+|#\s+)|$)/i // cjk-ok
    if (existingBiosSectionRe.test(base)) {
      localText.value = base.replace(existingBiosSectionRe, snippet)
    } else {
      const lines = base.split(/\r?\n/)
      const novelTitleHeaderRe = /^#\s+|^小说名\s*[:：]/ // cjk-ok
      if (novelTitleHeaderRe.test(lines[0]?.trim() ?? '')) {
        let insertAfterLine = 1
        while (
          insertAfterLine < lines.length &&
          (lines[insertAfterLine]!.trim() === '' || lines[insertAfterLine]!.trim().startsWith('>'))
        ) {
          insertAfterLine++
        }
        const headPart = lines.slice(0, insertAfterLine).join('\n').trimEnd()
        const tailPart = lines.slice(insertAfterLine).join('\n').trimStart()
        localText.value = `${headPart}\n\n${snippet}\n\n${tailPart}`
      } else {
        localText.value = `${snippet}\n\n${base}`
      }
    }
  }
  persistNovelBody(true)
  insertBiosFlash.value = true
  setTimeout(() => {
    insertBiosFlash.value = false
  }, 1600)
  const biosScrollTarget = isOutlineModeNode.value
    ? '核心设定与人物档案' // cjk-ok
    : isEn.value
      ? 'Core Character Profiles'
      : '核心人物档案' // cjk-ok
  scrollPreviewAndEditorToHeadingKeyword(biosScrollTarget)
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
    if (isOutlineModeNode.value) {
      // Automatically upgrade plain-text novel outline markers to GitHub README Markdown
      const plainTitlePrefixRe = /^小说名\s*[:：]/ // cjk-ok
      if (plainTitlePrefixRe.test(line)) {
        formatted.push(`# ${line}`)
        continue
      }
      if (/^【[^】]{2,32}】$/.test(line) && !OUTLINE_PLAIN_CHAP_HEADING_RE.test(line)) {
        if (formatted.length > 0 && formatted[formatted.length - 1] !== '') {
          formatted.push('')
        }
        formatted.push(`## ${line}`)
        continue
      }
      if (OUTLINE_PLAIN_CHAP_HEADING_RE.test(line)) {
        if (formatted.length > 0 && formatted[formatted.length - 1] !== '') {
          formatted.push('')
        }
        formatted.push(`### ${line}`)
        continue
      }
      if (/^[-*•]\s+/.test(line) && !line.includes('**')) {
        const upgradedBullet = line.replace(
          /^([-*•]\s+)([\u4e00-\u9fa5A-Za-z0-9·/（()）\s]{2,22})\s*([:：])\s*(.+)$/,
          '$1**$2**$3$4'
        )
        formatted.push(upgradedBullet)
        continue
      }
    }
    formatted.push(line)
  }
  localText.value = formatted.join('\n').trim()
  persistNovelBody(true)
  formatFlash.value = true
  setTimeout(() => {
    formatFlash.value = false
  }, 1400)
}

async function copyOutlineMarkdown(): Promise<void> {
  const md = localText.value.trim() || buildStandardOutlineReadmeDoc()
  try {
    await navigator.clipboard?.writeText(md)
  } catch {
    // ignore clipboard error in restricted environment
  }
  copyMdFlash.value = true
  setTimeout(() => {
    copyMdFlash.value = false
  }, 1500)
}

function exportOutlineReadmeMd(): void {
  const md = localText.value.trim() || buildStandardOutlineReadmeDoc()
  const rawTitle =
    displayName.value.trim() ||
    currentChapterTitle.value.trim() ||
    (isEn.value ? 'Novel_Master_Outline_README' : '小说总纲与分章细纲_README') // cjk-ok
  const safeName = rawTitle.replace(/[\\/:*?"<>|]/g, '_')
  try {
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${safeName}.md`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  } catch {
    // ignore download error in headless test
  }
  exportMdFlash.value = true
  setTimeout(() => {
    exportMdFlash.value = false
  }, 1800)
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
  persistNovelBody(true)
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

async function exportFullBookAnthology(): Promise<void> {
  persistNovelBody()
  persistMemoryFields()
  const bookTitle =
    displayName.value.trim() ||
    (isEn.value ? 'Serialized_Novel_Anthology' : '潜龙出渊_全书连载合集') // cjk-ok

  const chapterBlocks: string[] = []
  if (canvasChapterChainNodes.value.length > 0) {
    for (const chainEntry of canvasChapterChainNodes.value) {
      const n = chainEntry.node
      let body =
        n.id === node.value?.id
          ? localText.value.trim()
          : (n.params.text ?? '').trim() === '…'
            ? ''
            : (n.params.text ?? '').trim()
      if (!body && n.params.generatedTexts?.length) {
        const lastItem = n.params.generatedTexts[n.params.generatedTexts.length - 1]
        if (lastItem) {
          body = (await loadGeneratedTextBody(lastItem)).trim() || lastItem.text?.trim() || ''
        }
      }
      if (body) {
        chapterBlocks.push(`## ${chainEntry.displayTitle}\n\n${body}`)
      }
    }
  }
  if (chapterBlocks.length === 0 && localText.value.trim()) {
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
    `> 动态规划总章数：${totalChapters.value} 章 | 已完成章节：${Math.max(1, chapterBlocks.length)} 章 | 累计总字数：${totalBookWordCount.value} 字`, // cjk-ok
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
  flex-wrap: wrap;
  gap: 10px;
  padding: 8px 14px;
  background: rgba(15, 23, 42, 0.94);
  border-bottom: 1px solid rgba(148, 163, 184, 0.16);
  flex-shrink: 0;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.header-divider {
  width: 1px;
  height: 18px;
  background: rgba(148, 163, 184, 0.22);
  flex-shrink: 0;
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
  flex-shrink: 0;
}

.title-input {
  background: rgba(30, 41, 59, 0.7);
  border: 1px solid rgba(148, 163, 184, 0.22);
  border-radius: 6px;
  color: #f8fafc;
  font-size: 13px;
  font-weight: 600;
  padding: 4px 10px;
  height: 28px;
  width: clamp(120px, 13vw, 176px);
  min-width: 110px;
}

.cursor-pill {
  display: inline-flex;
  align-items: center;
  height: 24px;
  padding: 0 9px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  flex-shrink: 0;
  background: rgba(168, 85, 247, 0.22);
  color: #e9d5ff;
  border: 1px solid rgba(168, 85, 247, 0.45);
}

.header-telemetry {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  flex: 1 1 auto;
  min-width: 0;
}

.stat-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 24px;
  padding: 0 9px;
  border-radius: 999px;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  flex-shrink: 0;
  background: rgba(30, 41, 59, 0.85);
  color: #cbd5e1;
  border: 1px solid rgba(148, 163, 184, 0.18);
}

.stat-clickable {
  cursor: pointer;
  transition: filter 0.15s ease;
}

.stat-clickable:hover {
  filter: brightness(1.12);
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
  flex-wrap: wrap;
  gap: 8px;
  margin-left: auto;
  flex-shrink: 0;
}

.header-btn-group {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.head-gen-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  height: 28px;
  padding: 0 10px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  line-height: 1;
  white-space: nowrap;
  flex-shrink: 0;
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

.head-sp-btn:hover:not(:disabled) {
  background: rgba(16, 185, 129, 0.3);
}

.head-gen-accent {
  background: linear-gradient(135deg, rgba(147, 51, 234, 0.88), rgba(79, 70, 229, 0.88));
  border-color: rgba(192, 132, 252, 0.55);
  color: #ffffff;
}

.head-gen-accent:hover:not(:disabled) {
  background: linear-gradient(135deg, rgba(168, 85, 247, 0.95), rgba(99, 102, 241, 0.95));
}

.head-gen-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.header-right :deep(.node-run-btn) {
  width: auto;
  height: 28px;
  padding: 0 11px;
  border-radius: 6px;
  font-size: 12px;
  white-space: nowrap;
  flex-shrink: 0;
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

.doc-view-mode-group {
  display: inline-flex;
  align-items: center;
  background: rgba(15, 23, 42, 0.85);
  border: 1px solid rgba(148, 163, 184, 0.22);
  border-radius: 7px;
  padding: 2px;
  gap: 2px;
  flex-shrink: 0;
}

.view-mode-btn {
  padding: 4px 9px;
  border-radius: 5px;
  font-size: 11px;
  font-weight: 600;
  color: #94a3b8;
  background: transparent;
  border: none;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.15s ease;
}

.view-mode-btn:hover {
  color: #e2e8f0;
}

.view-mode-btn.active {
  background: rgba(168, 85, 247, 0.28);
  color: #f3e8ff;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.25);
}

.tool-chip-readme {
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.24), rgba(168, 85, 247, 0.26));
  color: #dbeafe;
  border-color: rgba(96, 165, 250, 0.45);
}

.readme-toc-strip {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 14px;
  background: rgba(15, 23, 42, 0.78);
  border-bottom: 1px solid rgba(148, 163, 184, 0.14);
  overflow-x: auto;
  flex-shrink: 0;
}

.toc-strip-label {
  font-size: 11px;
  font-weight: 700;
  color: #94a3b8;
  white-space: nowrap;
  flex-shrink: 0;
}

.toc-pills-wrap {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-wrap: nowrap;
  overflow-x: auto;
}

.toc-pill {
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
  background: rgba(30, 41, 59, 0.85);
  color: #cbd5e1;
  border: 1px solid rgba(148, 163, 184, 0.2);
  transition: all 0.14s ease;
}

.toc-pill:hover {
  border-color: rgba(168, 85, 247, 0.55);
  color: #f3e8ff;
  background: rgba(88, 28, 135, 0.28);
}

.toc-pill.toc-lv-1 {
  background: rgba(168, 85, 247, 0.2);
  color: #e9d5ff;
  border-color: rgba(168, 85, 247, 0.4);
}

.toc-pill.is-chap {
  background: rgba(59, 130, 246, 0.16);
  color: #bfdbfe;
  border-color: rgba(59, 130, 246, 0.35);
}

.novel-editor-workspace {
  flex: 1;
  display: flex;
  min-height: 0;
  overflow: hidden;
}

.novel-editor-workspace.mode-split {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0;
}

.novel-editor-workspace.mode-split .novel-textarea-wrap {
  border-right: 1px solid rgba(148, 163, 184, 0.16);
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

.outline-readme-pane {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 16px 22px 32px;
  background:
    radial-gradient(circle at top right, rgba(88, 28, 135, 0.08), transparent 55%),
    rgba(11, 14, 20, 0.65);
}

.outline-readme-article {
  max-width: 920px;
  margin: 0 auto;
  background: rgba(15, 23, 42, 0.62);
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: 12px;
  padding: 22px 28px 30px;
  box-shadow: 0 10px 30px rgba(2, 6, 23, 0.42);
  color: #e2e8f0;
  font-size: 14px;
  line-height: 1.75;
}

.readme-repo-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding-bottom: 12px;
  margin-bottom: 16px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.16);
  font-size: 12px;
}

.repo-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 9px;
  border-radius: 6px;
  font-weight: 700;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  background: rgba(59, 130, 246, 0.16);
  color: #93c5fd;
  border: 1px solid rgba(59, 130, 246, 0.32);
}

.repo-meta {
  color: #94a3b8;
  font-size: 11px;
}

.readme-heading {
  position: relative;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin: 20px 0 10px;
  font-weight: 700;
  color: #f8fafc;
  scroll-margin-top: 16px;
}

.readme-h1 {
  font-size: 21px;
  padding-bottom: 10px;
  margin-top: 4px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.22);
  color: #f3e8ff;
}

.readme-h2 {
  font-size: 16px;
  padding-bottom: 6px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.14);
  color: #e9d5ff;
}

.readme-h3 {
  font-size: 14px;
  color: #f1f5f9;
}

.readme-chapter-heading {
  padding: 7px 12px;
  border-radius: 8px;
  background: linear-gradient(90deg, rgba(59, 130, 246, 0.14), rgba(168, 85, 247, 0.08));
  border-left: 3px solid #60a5fa;
}

.readme-chap-badge {
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
  background: rgba(59, 130, 246, 0.25);
  color: #bfdbfe;
  border: 1px solid rgba(96, 165, 250, 0.45);
}

.readme-stage-badge {
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  background: rgba(168, 85, 247, 0.2);
  color: #e9d5ff;
  border: 1px solid rgba(168, 85, 247, 0.38);
}

.readme-heading-edit-btn {
  margin-left: auto;
  opacity: 0.4;
  padding: 2px 6px;
  border-radius: 5px;
  font-size: 11px;
  background: rgba(30, 41, 59, 0.8);
  border: 1px solid rgba(148, 163, 184, 0.22);
  color: #cbd5e1;
  cursor: pointer;
  transition: opacity 0.15s ease;
}

.readme-heading:hover .readme-heading-edit-btn {
  opacity: 1;
}

.readme-hr {
  border: none;
  border-top: 1px solid rgba(148, 163, 184, 0.18);
  margin: 18px 0;
}

.readme-blockquote {
  margin: 10px 0 14px;
  padding: 10px 14px;
  border-left: 4px solid #a855f7;
  background: rgba(88, 28, 135, 0.16);
  border-radius: 0 8px 8px 0;
  color: #e2e8f0;
  font-size: 13px;
}

.readme-blockquote p {
  margin: 3px 0;
}

.readme-blockquote.alert-tip {
  border-left-color: #10b981;
  background: rgba(16, 185, 129, 0.12);
}

.readme-blockquote.alert-warning {
  border-left-color: #f59e0b;
  background: rgba(245, 158, 11, 0.12);
}

.readme-table-scroll {
  overflow-x: auto;
  margin: 12px 0 16px;
  border-radius: 8px;
  border: 1px solid rgba(148, 163, 184, 0.2);
}

.readme-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12.5px;
  text-align: left;
}

.readme-table th {
  background: rgba(30, 41, 59, 0.9);
  color: #f3e8ff;
  font-weight: 700;
  padding: 8px 12px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.24);
  white-space: nowrap;
}

.readme-table td {
  padding: 8px 12px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.12);
  color: #cbd5e1;
  vertical-align: top;
}

.readme-table tbody tr:nth-child(even) {
  background: rgba(15, 23, 42, 0.45);
}

.readme-table tbody tr:hover {
  background: rgba(168, 85, 247, 0.1);
}

.readme-list {
  margin: 8px 0 14px;
  padding-left: 20px;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.readme-list li {
  color: #e2e8f0;
  line-height: 1.7;
}

.readme-p {
  margin: 8px 0 12px;
  color: #cbd5e1;
  line-height: 1.8;
}

.readme-code-wrap {
  margin: 12px 0 16px;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid rgba(148, 163, 184, 0.22);
  background: rgba(2, 6, 23, 0.78);
}

.readme-code-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 5px 12px;
  background: rgba(30, 41, 59, 0.85);
  border-bottom: 1px solid rgba(148, 163, 184, 0.16);
  font-size: 11px;
  color: #94a3b8;
}

.readme-code-copy {
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 10px;
  background: rgba(51, 65, 85, 0.9);
  color: #e2e8f0;
  border: 1px solid rgba(148, 163, 184, 0.25);
  cursor: pointer;
}

.readme-pre {
  margin: 0;
  padding: 12px 14px;
  overflow-x: auto;
  font-size: 12px;
  line-height: 1.6;
  color: #bae6fd;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

.readme-empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  min-height: 280px;
  color: #94a3b8;
  text-align: center;
}

.empty-icon {
  font-size: 32px;
}

:deep(.md-inline-code) {
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 12px;
  background: rgba(30, 41, 59, 0.9);
  color: #f9a8d4;
  border: 1px solid rgba(148, 163, 184, 0.22);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

:deep(.md-bracket-pill) {
  display: inline-block;
  padding: 0 4px;
  border-radius: 4px;
  background: rgba(168, 85, 247, 0.16);
  color: #e9d5ff;
  font-weight: 600;
}

:deep(.md-checkbox) {
  font-weight: 700;
  color: #94a3b8;
}

:deep(.md-checkbox.checked) {
  color: #34d399;
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

.markov-ports-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.markov-port-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 7px;
  background: rgba(15, 23, 42, 0.72);
  border: 1px solid rgba(148, 163, 184, 0.16);
}

.port-item-left {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1 1 auto;
}

.port-tag {
  display: inline-flex;
  align-items: center;
  align-self: flex-start;
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.02em;
  background: rgba(56, 189, 248, 0.16);
  color: #7dd3fc;
  border: 1px solid rgba(56, 189, 248, 0.32);
}

.port-tag.port-outline {
  background: rgba(168, 85, 247, 0.18);
  color: #d8b4fe;
  border-color: rgba(168, 85, 247, 0.36);
}

.port-tag.port-econ {
  background: rgba(245, 158, 11, 0.16);
  color: #fcd34d;
  border-color: rgba(245, 158, 11, 0.36);
}

.port-tag.port-out {
  background: rgba(16, 185, 129, 0.16);
  color: #6ee7b7;
  border-color: rgba(16, 185, 129, 0.36);
}

.port-tag.port-out-all {
  background: rgba(56, 189, 248, 0.18);
  color: #38bdf8;
  border-color: rgba(56, 189, 248, 0.42);
}

.port-target-name {
  font-size: 11px;
  font-weight: 600;
  color: #e2e8f0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.port-target-name.muted {
  font-weight: 400;
  color: #64748b;
}

.upstream-slice-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 7px 9px;
  border-radius: 7px;
  background: rgba(15, 23, 42, 0.72);
  border: 1px solid rgba(148, 163, 184, 0.16);
}

.upstream-slice-card .port-item-left {
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}

.upstream-slice-card .port-target-name {
  flex: 1;
}
</style>
