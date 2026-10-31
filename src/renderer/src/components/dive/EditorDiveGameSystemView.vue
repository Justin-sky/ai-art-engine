<template>
  <div class="dive-game-system dive-view">
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
        <span class="archetype-pill">
          {{ activeArchetype.icon }} {{ isEn ? activeArchetype.labelEn : activeArchetype.labelZh }}
        </span>
        <span class="aspect-pill">
          {{ targetAspect }}
        </span>
      </div>

      <div class="header-telemetry">
        <span
          class="stat-pill"
          :class="upstreamEconomyNode ? 'stat-ok' : 'stat-muted'"
          style="cursor: pointer"
          @click="leftSection = 'economy'"
        >
          📊 {{ ui.telemetryEconomy(Boolean(upstreamEconomyNode)) }}
        </span>
        <span
          class="stat-pill"
          :class="upstreamNovelNode ? 'stat-ok' : 'stat-muted'"
          style="cursor: pointer"
          @click="leftSection = 'novel'"
        >
          📖 {{ ui.telemetryNovel(Boolean(upstreamNovelNode)) }}
        </span>
        <span class="stat-pill stat-accent" style="cursor: pointer" @click="rightTab = 'uiPreview'">
          🖥️ {{ ui.telemetryScreens(docAudit.uiScreens.length) }}
        </span>
        <span
          class="stat-pill"
          :class="{
            'stat-ok': docAudit.overallScore >= 80,
            'stat-warn': docAudit.overallScore > 0 && docAudit.overallScore < 80
          }"
          style="cursor: pointer"
          @click="rightTab = 'qa'"
        >
          🩺 {{ ui.telemetryQa(docAudit.overallScore) }}
        </span>
      </div>

      <div class="header-right">
        <div class="panel-toggle-group">
          <button
            type="button"
            class="hdr-icon-btn"
            :class="{ active: showLeftCol }"
            :title="ui.toggleLeftPanelHint"
            @click="showLeftCol = !showLeftCol"
          >
            ◧
          </button>
          <button
            type="button"
            class="hdr-icon-btn"
            :class="{ active: showRightCol }"
            :title="ui.toggleRightPanelHint"
            @click="showRightCol = !showRightCol"
          >
            ◨
          </button>
        </div>
        <button
          type="button"
          class="hdr-btn"
          :title="ui.synthesizeOfflineHint"
          @click="synthesizeStandardDocFromContext"
        >
          📐 <span class="hdr-btn-text">{{ ui.synthesizeOfflineBtn }}</span>
        </button>
        <button
          type="button"
          class="hdr-btn hdr-btn-accent"
          :disabled="isRunningNode"
          @click="runGameSystemGeneration"
        >
          ⚡
          <span class="hdr-btn-text">{{ isRunningNode ? ui.generatingBtn : ui.generateBtn }}</span>
        </button>
        <button type="button" class="hdr-btn hdr-btn-ui" @click="pushAndOpenUiSplitNode">
          🖼️ <span class="hdr-btn-text">{{ ui.pushToUiSplitBtn }}</span>
        </button>
        <button type="button" class="hdr-btn" @click="popDive">
          ← <span class="hdr-btn-text">{{ ui.backToCanvas }}</span>
        </button>
      </div>
    </header>

    <div v-if="statusBanner" class="status-banner">
      <span>{{ statusBanner }}</span>
      <button type="button" class="banner-close" @click="statusBanner = ''">×</button>
    </div>

    <div
      class="workbench-body"
      :class="{
        'hide-left': !showLeftCol,
        'hide-right': !showRightCol
      }"
    >
      <!-- Left Column: 8 Archetypes + Upstream Economy & Novel Closed-Loop Bridge -->
      <aside v-show="showLeftCol" class="col-left">
        <div class="left-tabs" role="tablist">
          <button
            type="button"
            class="left-tab"
            :class="{ active: leftSection === 'archetype' }"
            :title="ui.tabArchetypes"
            @click="leftSection = 'archetype'"
          >
            <span class="tab-icon">🎮</span>
            <span class="tab-label">{{ ui.tabArchetypes }}</span>
          </button>
          <button
            type="button"
            class="left-tab"
            :class="{ active: leftSection === 'economy' }"
            :title="ui.tabEconomyBridge"
            @click="leftSection = 'economy'"
          >
            <span class="tab-icon">📊</span>
            <span class="tab-label">{{ ui.tabEconomyBridge }}</span>
            <span class="tab-dot" :class="upstreamEconomyNode ? 'dot-ok' : 'dot-Idle'" />
          </button>
          <button
            type="button"
            class="left-tab"
            :class="{ active: leftSection === 'novel' }"
            :title="ui.tabNovelBridge"
            @click="leftSection = 'novel'"
          >
            <span class="tab-icon">📖</span>
            <span class="tab-label">{{ ui.tabNovelBridge }}</span>
            <span class="tab-dot" :class="upstreamNovelNode ? 'dot-ok' : 'dot-Idle'" />
          </button>
        </div>

        <!-- Tab 1: 8 Game System Archetypes -->
        <div v-if="leftSection === 'archetype'" class="left-panel-scroll">
          <div class="panel-card">
            <div class="card-header-row">
              <span class="card-title">{{ ui.archetypeSectionTitle }}</span>
              <div class="aspect-group">
                <button
                  v-for="asp in ['16:9', '9:16', '1:1'] as const"
                  :key="asp"
                  type="button"
                  class="mini-pill-btn"
                  :class="{ active: targetAspect === asp }"
                  @click="setTargetAspect(asp)"
                >
                  {{ asp }}
                </button>
              </div>
            </div>
            <div class="archetype-grid">
              <button
                v-for="arch in archetypes"
                :key="arch.id"
                type="button"
                class="archetype-card"
                :class="{ active: activeArchetype.id === arch.id }"
                @click="selectArchetype(arch.id)"
              >
                <span class="arch-icon">{{ arch.icon }}</span>
                <div class="arch-meta">
                  <div class="arch-name">{{ isEn ? arch.labelEn : arch.labelZh }}</div>
                  <div class="arch-sub">
                    {{ arch.defaultFeatures.length }} {{ ui.unitFeatures }} ·
                    {{ arch.defaultScreens.length }} {{ ui.unitScreens }}
                  </div>
                </div>
              </button>
            </div>
          </div>

          <div class="panel-card">
            <div class="card-title">{{ ui.coreLoopTitle }}</div>
            <p class="card-desc">
              {{ isEn ? activeArchetype.coreLoopEn : activeArchetype.coreLoopZh }}
            </p>
            <div class="card-title" style="margin-top: 8px">{{ ui.designGoalTitle }}</div>
            <p class="card-desc">{{ activeArchetype.designGoalZh }}</p>
            <div class="btn-row" style="margin-top: 10px">
              <button
                type="button"
                class="action-btn action-btn-primary"
                @click="synthesizeStandardDocFromContext"
              >
                📐 {{ ui.applyArchetypeTemplateBtn }}
              </button>
            </div>
          </div>
        </div>

        <!-- Tab 2: Upstream Economy Bridge -->
        <div v-else-if="leftSection === 'economy'" class="left-panel-scroll">
          <div class="panel-card">
            <div class="card-header-row">
              <span class="card-title">{{ ui.economyBridgeTitle }}</span>
              <span class="badge-dot" :class="upstreamEconomyNode ? 'badge-ok' : 'badge-warn'">
                {{ upstreamEconomyNode ? ui.connectedLabel : ui.unconnectedLabel }}
              </span>
            </div>

            <template v-if="upstreamEconomyNode">
              <div class="bridge-node-box">
                <div class="bridge-node-name">
                  📊 {{ upstreamEconomyNode.title || 'game.economy' }}
                </div>
                <div class="bridge-btn-row">
                  <button type="button" class="mini-action-btn" @click="injectEconomySpecIntoDoc">
                    💉 {{ ui.injectEconomyBtn }}
                  </button>
                  <button
                    type="button"
                    class="mini-action-btn"
                    @click="diveToUpstreamNode(upstreamEconomyNode.id, 'game.workbench')"
                  >
                    🔧 {{ ui.openEconomyWorkbenchBtn }}
                  </button>
                </div>
              </div>
              <pre class="bridge-preview-pre">{{ unwrappedEconomySpecPreview }}</pre>
            </template>

            <template v-else>
              <p class="card-desc">{{ ui.economyEmptyDesc }}</p>
              <div class="btn-col">
                <button
                  v-if="availableCanvasEconomyNode"
                  type="button"
                  class="action-btn action-btn-primary"
                  @click="connectExistingUpstreamNode(availableCanvasEconomyNode.id)"
                >
                  🔗 {{ ui.linkExistingEconomyBtn(availableCanvasEconomyNode.title) }}
                </button>
                <button type="button" class="action-btn" @click="createAndConnectEconomyNode">
                  ➕ {{ ui.createEconomyNodeBtn }}
                </button>
              </div>
            </template>
          </div>
        </div>

        <!-- Tab 3: Upstream Novel IP Bridge -->
        <div v-else class="left-panel-scroll">
          <div class="panel-card">
            <div class="card-header-row">
              <span class="card-title">{{ ui.novelBridgeTitle }}</span>
              <span class="badge-dot" :class="upstreamNovelNode ? 'badge-ok' : 'badge-warn'">
                {{ upstreamNovelNode ? ui.connectedLabel : ui.unconnectedLabel }}
              </span>
            </div>

            <template v-if="upstreamNovelNode">
              <div class="bridge-node-box">
                <div class="bridge-node-name">
                  📖 {{ upstreamNovelNode.title || 'asset.novel' }}
                </div>
                <div class="bridge-btn-row">
                  <button type="button" class="mini-action-btn" @click="injectNovelIpIntoDoc">
                    💉 {{ ui.injectNovelBtn }}
                  </button>
                  <button
                    type="button"
                    class="mini-action-btn"
                    @click="diveToUpstreamNode(upstreamNovelNode.id, 'novel.workbench')"
                  >
                    📖 {{ ui.openNovelWorkbenchBtn }}
                  </button>
                </div>
              </div>
              <pre class="bridge-preview-pre">{{ extractedNovelIpPreview }}</pre>
            </template>

            <template v-else>
              <p class="card-desc">{{ ui.novelEmptyDesc }}</p>
              <div class="btn-col">
                <button
                  v-if="availableCanvasNovelNode"
                  type="button"
                  class="action-btn action-btn-primary"
                  @click="connectExistingUpstreamNode(availableCanvasNovelNode.id)"
                >
                  🔗 {{ ui.linkExistingNovelBtn(availableCanvasNovelNode.title) }}
                </button>
                <button type="button" class="action-btn" @click="createAndConnectNovelNode">
                  ➕ {{ ui.createNovelNodeBtn }}
                </button>
              </div>
            </template>
          </div>
        </div>
      </aside>

      <!-- Center Column: Structured Game System Document Editor & Markdown Viewer -->
      <main class="col-center">
        <div class="center-toolbar">
          <div class="toolbar-top-row">
            <div class="doc-mode-tabs" role="tablist">
              <button
                type="button"
                class="doc-mode-tab"
                :class="{ active: docViewMode === 'preview' }"
                @click="docViewMode = 'preview'"
              >
                📖 {{ ui.modePreview }}
              </button>
              <button
                type="button"
                class="doc-mode-tab"
                :class="{ active: docViewMode === 'split' }"
                @click="docViewMode = 'split'"
              >
                🌗 {{ ui.modeSplit }}
              </button>
              <button
                type="button"
                class="doc-mode-tab"
                :class="{ active: docViewMode === 'edit' }"
                @click="docViewMode = 'edit'"
              >
                ✏️ {{ ui.modeEdit }}
              </button>
            </div>

            <div class="section-pills">
              <button
                v-for="sec in sectionButtons"
                :key="sec.id"
                type="button"
                class="sec-pill"
                :class="{ 'sec-present': sec.present }"
                @click="jumpOrInsertSection(sec)"
              >
                <span class="sec-status-mark">{{ sec.present ? '✓' : '+' }}</span>
                <span class="sec-label-text">{{ sec.label }}</span>
              </button>
            </div>

            <div class="toolbar-right">
              <button
                type="button"
                class="mini-pill-btn"
                :title="ui.copyDocBtn"
                @click="copyFullDocumentMarkdown"
              >
                📋 {{ ui.copyDocBtn }}
              </button>
              <button
                type="button"
                class="mini-pill-btn"
                :class="{ active: showInstructionDrawer }"
                @click="showInstructionDrawer = !showInstructionDrawer"
              >
                🎯 {{ ui.instructionDrawerBtn }}
              </button>
            </div>
          </div>
        </div>

        <!-- Collapsible Instruction & Preset Bar -->
        <div v-if="showInstructionDrawer" class="instruction-drawer">
          <div class="drawer-preset-row">
            <span class="drawer-label">{{ ui.presetLabel }}</span>
            <button
              v-for="preset in gameSystemPresets"
              :key="preset.id"
              type="button"
              class="preset-chip"
              @click="applyPresetInstruction(preset.body)"
            >
              {{ t(preset.titleKey) }}
            </button>
          </div>
          <textarea
            v-model="localInstruction"
            class="instruction-textarea"
            rows="3"
            :placeholder="ui.instructionPlaceholder"
            @change="persistInstruction"
          />
        </div>

        <!-- Version Gallery Bar if multiple versions exist -->
        <div v-if="generatedList.length > 1" class="version-bar">
          <span class="version-label">{{ ui.versionHistoryLabel }}</span>
          <button
            v-for="(item, idx) in generatedList"
            :key="item.id || idx"
            type="button"
            class="version-chip"
            :class="{ active: item.id === selectedVersionId }"
            @click="selectVersion(item.id || '')"
          >
            #{{ idx + 1 }} {{ item.title || `v${idx + 1}` }}
          </button>
        </div>

        <!-- Main GDD Workspace: Supports Markdown Preview, Split View, and Source Edit -->
        <div class="editor-wrap" :class="`mode-${docViewMode}`">
          <div
            v-show="docViewMode === 'edit' || docViewMode === 'split'"
            class="editor-pane-source"
          >
            <textarea
              ref="docTextareaRef"
              v-model="localText"
              class="gdd-textarea"
              :placeholder="ui.editorPlaceholder"
              @input="onDocInput"
              @blur="persistDocText"
            />
          </div>

          <div
            v-show="docViewMode === 'preview' || docViewMode === 'split'"
            ref="mdPreviewScrollRef"
            class="editor-pane-markdown"
          >
            <div v-if="parsedMdBlocks.length === 0" class="md-empty-state">
              <p>{{ ui.editorPlaceholder }}</p>
              <button
                type="button"
                class="action-btn action-btn-primary"
                style="max-width: 280px"
                @click="synthesizeStandardDocFromContext"
              >
                📐 {{ ui.synthesizeOfflineBtn }}
              </button>
            </div>

            <article v-else class="gdd-md-article">
              <template v-for="(block, bIdx) in parsedMdBlocks" :key="bIdx">
                <!-- Heading Block -->
                <component
                  :is="`h${block.level}`"
                  v-if="block.type === 'heading'"
                  :data-sec-id="block.sectionId || undefined"
                  class="gdd-md-heading"
                  :class="`gdd-md-h${block.level}`"
                >
                  <span class="heading-main-text">{{ block.text }}</span>
                  <span v-if="block.badges.length" class="heading-badges">
                    <span
                      v-for="(bdg, bdgIdx) in block.badges"
                      :key="bdgIdx"
                      class="md-inline-badge"
                      :class="`bdg-${bdg.kind}`"
                    >
                      {{ bdg.text }}
                    </span>
                  </span>
                  <button
                    type="button"
                    class="heading-edit-btn"
                    :title="ui.editSectionHint"
                    @click="focusHeadingInSource(block.rawHeading)"
                  >
                    ✏️
                  </button>
                </component>

                <!-- Table Block -->
                <div v-else-if="block.type === 'table'" class="gdd-md-table-wrap">
                  <table class="gdd-md-table">
                    <thead>
                      <tr>
                        <th v-for="(hdr, hIdx) in block.headers" :key="hIdx">
                          <template v-for="(sp, sIdx) in hdr" :key="sIdx">
                            <strong v-if="sp.kind === 'bold'">{{ sp.text }}</strong>
                            <code v-else-if="sp.kind === 'code'" class="md-inline-code">{{
                              sp.text
                            }}</code>
                            <span
                              v-else-if="sp.kind === 'priority'"
                              class="md-priority-pill"
                              :class="`prio-${sp.text.toLowerCase()}`"
                              >{{ sp.text }}</span
                            >
                            <span v-else>{{ sp.text }}</span>
                          </template>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="(row, rIdx) in block.rows" :key="rIdx">
                        <td v-for="(cell, cIdx) in row" :key="cIdx">
                          <template v-for="(sp, sIdx) in cell" :key="sIdx">
                            <strong v-if="sp.kind === 'bold'">{{ sp.text }}</strong>
                            <code v-else-if="sp.kind === 'code'" class="md-inline-code">{{
                              sp.text
                            }}</code>
                            <span
                              v-else-if="sp.kind === 'priority'"
                              class="md-priority-pill"
                              :class="`prio-${sp.text.toLowerCase()}`"
                              >{{ sp.text }}</span
                            >
                            <span v-else>{{ sp.text }}</span>
                          </template>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <!-- Code / ASCII Wireframe Block -->
                <div
                  v-else-if="block.type === 'code'"
                  class="gdd-md-code-card"
                  :class="{ 'is-wireframe': block.isWireframe }"
                >
                  <div class="code-card-bar">
                    <span class="code-lang-tag">
                      {{ block.isWireframe ? '🖥️ ASCII UI Wireframe' : block.lang || 'code' }}
                    </span>
                    <button
                      type="button"
                      class="code-copy-btn"
                      @click="copyCodeSnippet(block.code)"
                    >
                      {{ ui.copyCodeBtn }}
                    </button>
                  </div>
                  <pre class="gdd-md-pre"><code>{{ block.code }}</code></pre>
                </div>

                <!-- Blockquote -->
                <blockquote v-else-if="block.type === 'blockquote'" class="gdd-md-quote">
                  <p v-for="(lineSpans, lIdx) in block.lines" :key="lIdx">
                    <template v-for="(sp, sIdx) in lineSpans" :key="sIdx">
                      <strong v-if="sp.kind === 'bold'">{{ sp.text }}</strong>
                      <code v-else-if="sp.kind === 'code'" class="md-inline-code">{{
                        sp.text
                      }}</code>
                      <span
                        v-else-if="sp.kind === 'priority'"
                        class="md-priority-pill"
                        :class="`prio-${sp.text.toLowerCase()}`"
                        >{{ sp.text }}</span
                      >
                      <span v-else>{{ sp.text }}</span>
                    </template>
                  </p>
                </blockquote>

                <!-- List Block -->
                <component
                  :is="block.ordered ? 'ol' : 'ul'"
                  v-else-if="block.type === 'list'"
                  class="gdd-md-list"
                  :class="{ 'is-ordered': block.ordered }"
                >
                  <li
                    v-for="(item, iIdx) in block.items"
                    :key="iIdx"
                    class="gdd-md-list-item"
                    :style="item.indent > 0 ? { marginLeft: `${item.indent * 16}px` } : undefined"
                  >
                    <template v-for="(sp, sIdx) in item.spans" :key="sIdx">
                      <strong v-if="sp.kind === 'bold'" class="md-strong">{{ sp.text }}</strong>
                      <code v-else-if="sp.kind === 'code'" class="md-inline-code">{{
                        sp.text
                      }}</code>
                      <span
                        v-else-if="sp.kind === 'priority'"
                        class="md-priority-pill"
                        :class="`prio-${sp.text.toLowerCase()}`"
                        >{{ sp.text }}</span
                      >
                      <span v-else>{{ sp.text }}</span>
                    </template>
                  </li>
                </component>

                <!-- Horizontal Rule -->
                <hr v-else-if="block.type === 'hr'" class="gdd-md-hr" />

                <!-- Paragraph -->
                <p v-else-if="block.type === 'paragraph'" class="gdd-md-p">
                  <template v-for="(sp, sIdx) in block.spans" :key="sIdx">
                    <strong v-if="sp.kind === 'bold'" class="md-strong">{{ sp.text }}</strong>
                    <code v-else-if="sp.kind === 'code'" class="md-inline-code">{{ sp.text }}</code>
                    <span
                      v-else-if="sp.kind === 'priority'"
                      class="md-priority-pill"
                      :class="`prio-${sp.text.toLowerCase()}`"
                      >{{ sp.text }}</span
                    >
                    <span v-else>{{ sp.text }}</span>
                  </template>
                </p>
              </template>
            </article>
          </div>
        </div>

        <footer class="editor-footer">
          <span>{{ ui.charCountLabel(localText.length) }}</span>
          <span>{{ ui.uiScreenReadyLabel(docAudit.uiScreens.length) }}</span>
        </footer>
      </main>

      <!-- Right Column: Live ui.split Wireframe Preview, Feature Table & QA Doctor -->
      <aside v-show="showRightCol" class="col-right">
        <div class="right-tabs" role="tablist">
          <button
            type="button"
            class="right-tab"
            :class="{ active: rightTab === 'uiPreview' }"
            :title="`${ui.tabUiPreview} (${docAudit.uiScreens.length})`"
            @click="rightTab = 'uiPreview'"
          >
            <span class="tab-icon">🖥️</span>
            <span class="tab-label">{{ ui.tabUiPreview }}</span>
            <span class="tab-count">{{ docAudit.uiScreens.length }}</span>
          </button>
          <button
            type="button"
            class="right-tab"
            :class="{ active: rightTab === 'features' }"
            :title="ui.tabFeatures"
            @click="rightTab = 'features'"
          >
            <span class="tab-icon">⚙️</span>
            <span class="tab-label">{{ ui.tabFeatures }}</span>
          </button>
          <button
            type="button"
            class="right-tab"
            :class="{ active: rightTab === 'qa' }"
            :title="`${ui.tabQa} (${docAudit.overallScore})`"
            @click="rightTab = 'qa'"
          >
            <span class="tab-icon">🩺</span>
            <span class="tab-label">{{ ui.tabQa }}</span>
            <span class="tab-count">{{ docAudit.overallScore }}</span>
          </button>
        </div>

        <!-- Right Tab 1: Live ui.split Screen Wireframe Preview & Quick Screen Builder -->
        <div v-if="rightTab === 'uiPreview'" class="right-panel-scroll">
          <div class="panel-card">
            <div class="card-header-row">
              <span class="card-title">{{ ui.uiSplitPreFlightTitle }}</span>
              <button type="button" class="mini-action-btn" @click="pushAndOpenUiSplitNode">
                🚀 {{ ui.openUiSplitShortBtn }}
              </button>
            </div>
            <p class="card-desc">{{ ui.uiSplitPreFlightDesc }}</p>

            <div class="quick-screens-box">
              <div class="sub-label">{{ ui.quickInsertScreensLabel }}</div>
              <div class="quick-screen-chips">
                <button
                  v-for="(scr, idx) in activeArchetype.defaultScreens"
                  :key="scr.id"
                  type="button"
                  class="preset-chip"
                  @click="insertStandardScreenBlock(scr, idx + 1)"
                >
                  ➕ {{ isEn ? scr.titleEn : scr.titleZh }} ({{ scr.screenKind }})
                </button>
              </div>
            </div>
          </div>

          <div
            v-for="scr in docAudit.uiScreens"
            :key="scr.id"
            class="panel-card screen-preview-card"
          >
            <div class="card-header-row">
              <span class="screen-title">{{ scr.title }}</span>
              <div class="screen-badges">
                <span class="mini-tag tag-kind">{{ scr.screenKind }}</span>
                <span class="mini-tag tag-aspect">{{ scr.aspectRatio }}</span>
                <span class="mini-tag" :class="scr.hasPsdSpec ? 'tag-ok' : 'tag-warn'">
                  {{ scr.hasPsdSpec ? '9-Slice PSD ✓' : 'PSD ?' }}
                </span>
              </div>
            </div>
            <pre v-if="scr.wireframeSnippet" class="wireframe-box">{{ scr.wireframeSnippet }}</pre>
            <p class="screen-summary">{{ scr.promptSummary }}</p>
          </div>

          <div v-if="docAudit.uiScreens.length === 0" class="panel-card empty-card">
            <p class="card-desc">{{ ui.noScreensDetectedDesc }}</p>
            <button
              type="button"
              class="action-btn action-btn-primary"
              @click="appendAllArchetypeScreens"
            >
              ➕ {{ ui.appendAllArchetypeScreensBtn }}
            </button>
          </div>
        </div>

        <!-- Right Tab 2: Feature Matrix & Bound Economy Metrics -->
        <div v-else-if="rightTab === 'features'" class="right-panel-scroll">
          <div class="panel-card">
            <div class="card-title">{{ ui.archetypeFeaturesTitle }}</div>
            <p class="card-desc">{{ ui.archetypeFeaturesDesc }}</p>
          </div>

          <div
            v-for="feat in activeArchetype.defaultFeatures"
            :key="feat.id"
            class="panel-card feature-card"
          >
            <div class="card-header-row">
              <span class="screen-title"
                >{{ feat.code || feat.id }} · {{ isEn ? feat.nameEn : feat.nameZh }}</span
              >
              <span class="mini-tag tag-priority">{{ feat.priority }}</span>
            </div>
            <p class="card-desc">{{ feat.ruleSummaryZh || feat.rulesZh }}</p>
            <div v-if="feat.economyBoundMetrics?.length" class="metrics-row">
              <span v-for="m in feat.economyBoundMetrics" :key="m" class="metric-chip">
                {{ m }}
              </span>
            </div>
            <p class="edge-case-text">🛡️ {{ feat.edgeCasesZh }}</p>
            <button
              type="button"
              class="mini-action-btn"
              style="margin-top: 6px"
              @click="insertFeatureModuleBlock(feat)"
            >
              ➕ {{ ui.insertFeatureBtn }}
            </button>
          </div>
        </div>

        <!-- Right Tab 3: 6-Dimension GDD QA Doctor -->
        <div v-else class="right-panel-scroll">
          <div class="panel-card">
            <div class="card-header-row">
              <span class="card-title">{{ ui.qaCardTitle }}</span>
              <span
                class="qa-score-badge"
                :class="docAudit.overallScore >= 80 ? 'qa-high' : 'qa-mid'"
              >
                {{ docAudit.overallScore }} / 100
              </span>
            </div>

            <div class="check-grid">
              <div
                v-for="chk in qaCheckItems"
                :key="chk.label"
                class="check-item"
                :class="chk.ok ? 'chk-ok' : 'chk-missing'"
              >
                <span>{{ chk.ok ? '✅' : '⚠️' }}</span>
                <span>{{ chk.label }}</span>
              </div>
            </div>

            <div v-if="docAudit.warningsZh.length" class="warnings-list">
              <div
                v-for="(w, idx) in isEn ? docAudit.warningsEn : docAudit.warningsZh"
                :key="idx"
                class="warning-row"
              >
                • {{ w }}
              </div>
            </div>

            <button
              type="button"
              class="action-btn action-btn-primary"
              style="margin-top: 10px"
              @click="autoFixMissingGddSections"
            >
              🛠️ {{ ui.autoFixQaBtn }}
            </button>
          </div>
        </div>
      </aside>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, nextTick, reactive, ref, watch } from 'vue'
import {
  GAME_SYSTEM_ARCHETYPES,
  auditGameSystemDocument,
  buildStandardUiScreenMarkdownBlock,
  extractNovelIpContextForGameSystem,
  inferGameSystemArchetypeFromContext,
  isGameSystemArchetypeId,
  parseMxDocumentJson,
  resolveGameSystemArchetype,
  serializeMxNumericContextForDownstream,
  synthesizeGameSystemDocOffline,
  unwrapEconomyBundleForGameSystem,
  type GameSystemArchetypeId,
  type GameSystemFeatureModuleSpec,
  type GameSystemUiScreenSpec,
  type MxTemplateId
} from '@shared/gameAssets'
import { listInstructionPresets } from '@shared/graph/instructionPresets'
import { resolveNodeType, type GraphNode } from '@shared/graph'
import WorkspaceItemIcon from '../WorkspaceItemIcon.vue'
import { editorDiveKey, type EditorDiveViewId } from '../../features/graph/model/editorDive'
import { graphEditorHosts } from '../../features/graph/model/graphEditorHosts'
import { useGraphNodeRun } from '../../composables/useGraphNodeRun'
import { useEditorDiveFrameFlush } from '../../composables/useEditorDiveFrameFlush'
import { useStudioI18n } from '../../composables/useStudioI18n'
import { useWorkspaceStore } from '../../stores/workspace'

const props = defineProps<{
  frameKey: string
  hostId: string
  nodeId: string
}>()

const { t, locale, graphTypeLabel } = useStudioI18n()
const isEn = computed(() =>
  String(locale.value || '')
    .toLowerCase()
    .startsWith('en')
)
const editorDive = inject(editorDiveKey, null)
const workspace = useWorkspaceStore()

const archetypes = GAME_SYSTEM_ARCHETYPES
const gameSystemPresets = listInstructionPresets('gameSystem')

const leftSection = ref<'archetype' | 'economy' | 'novel'>('archetype')
const rightTab = ref<'uiPreview' | 'features' | 'qa'>('uiPreview')
const docViewMode = ref<'preview' | 'split' | 'edit'>('preview')
const showLeftCol = ref(true)
const showRightCol = ref(true)
const showInstructionDrawer = ref(false)
const statusBanner = ref('')
const docTextareaRef = ref<HTMLTextAreaElement | null>(null)
const mdPreviewScrollRef = ref<HTMLElement | null>(null)

const displayName = ref('')
const localInstruction = ref('')
const localText = ref('')
const dirtyText = ref(false)

const fallbackNode = reactive<GraphNode>({
  id: props.nodeId || 'game-system-fallback',
  typeId: 'asset.gameSystem',
  category: 'asset',
  assetType: 'gameSystem',
  title: '策划案生成', // cjk-ok
  position: { x: 240, y: 160 },
  params: {}
})

const resolvedLookup = computed<{ hostId: string; node: GraphNode | null }>(() => {
  void graphEditorHosts.revision.value
  const primary = graphEditorHosts.getNode(props.hostId, props.nodeId)
  if (primary) return { hostId: props.hostId, node: primary }

  const byTypeInHost = graphEditorHosts.findNode(
    props.hostId,
    (n) => n.typeId === 'asset.gameSystem' || n.assetType === 'gameSystem'
  )
  if (byTypeInHost) return { hostId: props.hostId, node: byTypeInHost }

  for (const entry of graphEditorHosts.listLiveEntries()) {
    const matchById = entry.document.nodes.find((n) => n.id === props.nodeId)
    if (matchById) return { hostId: entry.hostId, node: matchById }
  }
  for (const entry of graphEditorHosts.listLiveEntries()) {
    const matchByType = entry.document.nodes.find(
      (n) => n.typeId === 'asset.gameSystem' || n.assetType === 'gameSystem'
    )
    if (matchByType) return { hostId: entry.hostId, node: matchByType }
  }
  return { hostId: props.hostId, node: null }
})

const resolvedHostId = computed(() => resolvedLookup.value.hostId || props.hostId)
const realNode = computed(() => resolvedLookup.value.node)
const node = computed<GraphNode>(() => realNode.value ?? fallbackNode)
const activeNodeId = computed(() => realNode.value?.id || props.nodeId || fallbackNode.id)

const graphDoc = computed(() => {
  void graphEditorHosts.revision.value
  return graphEditorHosts.getDocument(resolvedHostId.value)
})
const { runStatus, isGraphRunning, toggleRun } = useGraphNodeRun(
  realNode,
  () => resolvedHostId.value
)
const isRunningNode = computed(() => runStatus.value === 'running' || isGraphRunning.value)

const typeLabel = computed(() =>
  node.value?.typeId ? graphTypeLabel(node.value.typeId) : t('graph.defaultNode')
)

const nodeIcon = computed(() => {
  const cur = node.value
  if (!cur) return '📋'
  return resolveNodeType(cur)?.icon?.trim() || '📋'
})

// Find upstream game.economy and asset.novel nodes
const upstreamNodes = computed<GraphNode[]>(() => {
  void graphEditorHosts.revision.value
  const cur = realNode.value
  const hid = resolvedHostId.value
  if (!hid || !cur) return []
  const incoming = graphEditorHosts.listIncomingEdges(hid, cur.id)
  const list: GraphNode[] = []
  for (const edge of incoming) {
    const src = graphEditorHosts.getNode(hid, edge.sourceNodeId)
    if (src) list.push(src)
  }
  return list
})

const upstreamEconomyNode = computed<GraphNode | null>(() => {
  return upstreamNodes.value.find((n) => n.typeId === 'game.economy') ?? null
})

const upstreamNovelNode = computed<GraphNode | null>(() => {
  return upstreamNodes.value.find((n) => n.typeId === 'asset.novel') ?? null
})

const availableCanvasEconomyNode = computed<GraphNode | null>(() => {
  if (upstreamEconomyNode.value) return null
  return graphEditorHosts.findNode(resolvedHostId.value, (n) => n.typeId === 'game.economy')
})

const availableCanvasNovelNode = computed<GraphNode | null>(() => {
  if (upstreamNovelNode.value) return null
  return graphEditorHosts.findNode(resolvedHostId.value, (n) => n.typeId === 'asset.novel')
})

function extractNodePrimaryText(n: GraphNode | null): string {
  if (!n) return ''
  const genList = n.params?.generatedTexts ?? []
  const selId = n.params?.selectedTextId
  const selItem = genList.find((it) => it.id === selId) ?? genList[genList.length - 1]
  if (selItem?.text?.trim()) return selItem.text.trim()
  if (n.params?.text?.trim()) return n.params.text.trim()
  return ''
}

const upstreamEconomyRawText = computed(() => {
  const n = upstreamEconomyNode.value
  if (!n) return ''
  const tplRaw = String(n.params?.gameEconomyPreset ?? 'short_drama_reversal_loop')
  const mxDoc = parseMxDocumentJson(
    n.params?.gameEconomyDiagramJson,
    tplRaw as MxTemplateId,
    n.title
  )
  return serializeMxNumericContextForDownstream(mxDoc)
})

const unwrappedEconomySpecPreview = computed(() => {
  const raw = upstreamEconomyRawText.value
  if (!raw) return ''
  return unwrapEconomyBundleForGameSystem(raw)
})

const upstreamNovelRawText = computed(() => extractNodePrimaryText(upstreamNovelNode.value))

const extractedNovelIpPreview = computed(() => {
  const n = upstreamNovelNode.value
  if (!n) return ''
  return extractNovelIpContextForGameSystem({
    novelText: upstreamNovelRawText.value,
    novelGenreId: n.params?.novelGenre,
    worldBible: n.params?.novelWorldBible,
    stateLedger: n.params?.novelStateLedger,
    characterRosterJson: n.params?.novelCharacterRosterJson,
    foreshadowingJson: n.params?.novelForeshadowingJson
  })
})

const activeArchetype = computed(() => {
  const explicit = node.value?.params?.gameSystemArchetype
  if (isGameSystemArchetypeId(explicit)) {
    return resolveGameSystemArchetype(explicit)
  }
  const inferred = inferGameSystemArchetypeFromContext({
    prompt: `${localInstruction.value} ${localText.value}`,
    novelGenre: upstreamNovelNode.value?.params?.novelGenre
  })
  return resolveGameSystemArchetype(inferred)
})

const targetAspect = computed<'16:9' | '9:16' | '1:1'>(() => {
  const raw = node.value?.params?.gameSystemTargetAspect
  if (raw === '9:16' || raw === '16:9' || raw === '1:1') return raw
  return activeArchetype.value.defaultScreens[0]?.aspectRatio ?? '16:9'
})

const generatedList = computed(() => node.value?.params?.generatedTexts ?? [])
const selectedVersionId = computed(() => {
  const list = generatedList.value
  const sel = node.value?.params?.selectedTextId
  if (sel && list.some((i) => i.id === sel)) return sel
  return list[list.length - 1]?.id ?? ''
})

const docAudit = computed(() => auditGameSystemDocument(localText.value))

const sectionButtons = computed(() => {
  const c = docAudit.value.sectionChecks
  return [
    {
      id: 'overview',
      label: isEn.value ? '# Overview' : '# 系统概述', // cjk-ok
      heading: '# 系统概述', // cjk-ok
      present: c.overview
    }, // cjk-ok
    {
      id: 'goals',
      label: isEn.value ? '# Goals' : '# 系统目标', // cjk-ok
      heading: '# 系统目标', // cjk-ok
      present: c.goals
    }, // cjk-ok
    {
      id: 'features',
      label: isEn.value ? '# Features' : '# 功能点设计', // cjk-ok
      heading: '# 功能点设计', // cjk-ok
      present: c.features
    }, // cjk-ok
    {
      id: 'uiLayout',
      label: isEn.value ? '# UI Layout' : '# UI 布局设计', // cjk-ok
      heading: '# UI 布局设计', // cjk-ok
      present: c.uiLayout
    }, // cjk-ok
    {
      id: 'uiRequirements',
      label: isEn.value ? '# UI Specs' : '# UI 要求', // cjk-ok
      heading: '# UI 要求', // cjk-ok
      present: c.uiRequirements
    }, // cjk-ok
    {
      id: 'dataConfig',
      label: isEn.value ? '# Data & Formulas' : '# 数据与配置', // cjk-ok
      heading: '# 数据与配置', // cjk-ok
      present: c.dataConfig
    } // cjk-ok
  ]
})

const qaCheckItems = computed(() => {
  const a = docAudit.value
  return [
    {
      label: isEn.value ? '6 Standard Sections' : '6 大标准章节齐备', // cjk-ok
      ok: Object.values(a.sectionChecks).every(Boolean)
    }, // cjk-ok
    { label: isEn.value ? 'P0/P1/P2 Priorities' : '功能点 P0/P1/P2 优先级', ok: a.hasPriorityTags }, // cjk-ok
    {
      label: isEn.value ? 'Edge-Case Rules' : '断线/连点/资源不足异常边界', // cjk-ok
      ok: a.hasEdgeCaseHandling
    }, // cjk-ok
    {
      label: isEn.value ? 'Economy Formula Bound' : '经济系统乘区公式与属性表绑定', // cjk-ok
      ok: a.hasNumericalFormulaBinding
    }, // cjk-ok
    {
      label: isEn.value ? 'Multi-Screen UI Specs' : '多界面 UI 拆分清单 (>=2屏)', // cjk-ok
      ok: a.uiScreens.length >= 2
    }, // cjk-ok
    {
      label: isEn.value ? 'ASCII Wireframe & 9-Slice' : 'ASCII 框线图与 9-Slice PSD 规范', // cjk-ok
      ok: a.uiScreens.length > 0 && a.uiScreens.every((s) => s.hasWireframe && s.hasPsdSpec)
    } // cjk-ok
  ]
})

const ui = computed(() => {
  if (isEn.value) {
    return {
      telemetryEconomy: (ok: boolean) => (ok ? 'Economy Linked' : 'No Economy'),
      telemetryNovel: (ok: boolean) => (ok ? 'Novel IP Linked' : 'No Novel IP'),
      telemetryScreens: (n: number) => `${n} UI Screens`,
      telemetryQa: (s: number) => `QA ${s}/100`,
      synthesizeOfflineBtn: 'Synthesize Standard GDD',
      synthesizeOfflineHint: 'Synthesize full GDD from upstream Economy + Novel IP + Archetype',
      generateBtn: 'AI Generate GDD',
      generatingBtn: 'Generating...',
      pushToUiSplitBtn: 'Push to UI Split',
      backToCanvas: 'Canvas',
      tabArchetypes: 'Archetypes',
      tabEconomyBridge: 'Economy',
      tabNovelBridge: 'Novel IP',
      archetypeSectionTitle: '8 Game System Archetypes',
      unitFeatures: 'Features',
      unitScreens: 'Screens',
      coreLoopTitle: 'Core Gameplay Loop',
      designGoalTitle: 'Deliverable Goal',
      applyArchetypeTemplateBtn: 'Synthesize Full GDD with Archetype & Upstream',
      economyBridgeTitle: 'Upstream Economy System (game.economy)',
      novelBridgeTitle: 'Upstream Novel IP (asset.novel)',
      connectedLabel: 'Connected',
      unconnectedLabel: 'Not Linked',
      injectEconomyBtn: 'Inject Formulas & Tables',
      openEconomyWorkbenchBtn: 'Open Economy Studio',
      economyEmptyDesc:
        'Connect a game.economy node to bind multiplier formulas, entity stat tables, gacha pity, and resource sinks/sources.',
      linkExistingEconomyBtn: (name?: string) => `Link Canvas Economy (${name || 'game.economy'})`,
      createEconomyNodeBtn: 'Create & Link Upstream game.economy',
      injectNovelBtn: 'Inject Novel IP & Roster',
      openNovelWorkbenchBtn: 'Open Novel Workbench',
      novelEmptyDesc:
        'Connect an asset.novel node to convert realm ladders, character rosters, relics, and chapters into game progression & gacha pools.',
      linkExistingNovelBtn: (name?: string) => `Link Canvas Novel (${name || 'asset.novel'})`,
      createNovelNodeBtn: 'Create & Link Upstream asset.novel',
      instructionDrawerBtn: 'Prompt & Presets',
      modePreview: 'MD View',
      modeSplit: 'Split',
      modeEdit: 'Source',
      copyDocBtn: 'Copy MD',
      copyCodeBtn: 'Copy',
      editSectionHint: 'Edit this section in source',
      toggleLeftPanelHint: 'Toggle Left Archetype & Bridge Panel',
      toggleRightPanelHint: 'Toggle Right UI Preview & QA Panel',
      presetLabel: 'Presets:',
      instructionPlaceholder: 'Custom system design instructions (supports @upstream mentions)...',
      versionHistoryLabel: 'Versions:',
      editorPlaceholder:
        'Click "Synthesize Standard GDD" or "AI Generate GDD" to build a complete Game System Design Document...',
      charCountLabel: (n: number) => `${n} chars`,
      uiScreenReadyLabel: (n: number) => `${n} UI screens ready for downstream ui.split`,
      tabUiPreview: 'UI Split Preview',
      tabFeatures: 'Features & Data',
      tabQa: 'QA Doctor',
      uiSplitPreFlightTitle: 'Downstream ui.split Pre-Flight',
      openUiSplitShortBtn: 'Open ui.split',
      uiSplitPreFlightDesc:
        'Each screen under # UI Layout Design with screenKind, aspectRatio, ASCII wireframe, and 9-slice PSD spec will become an independent UI generation card.',
      quickInsertScreensLabel: '1-Click Append Standard UI Screen:',
      noScreensDetectedDesc: 'No parseable UI screens found under # UI Layout Design yet.',
      appendAllArchetypeScreensBtn: 'Append All Standard UI Screens for Archetype',
      archetypeFeaturesTitle: 'Archetype Feature Modules (P0/P1/P2)',
      archetypeFeaturesDesc:
        'Click to insert any standard feature module with economy metric bindings and edge-case rules.',
      insertFeatureBtn: 'Insert Feature into GDD',
      qaCardTitle: '6-Dimension GDD Engineering Audit',
      autoFixQaBtn: '1-Click Auto-Complete Missing Sections & UI Wireframes'
    }
  }
  return {
    telemetryEconomy: (ok: boolean) => (ok ? '已连经济数值' : '未连经济系统'), // cjk-ok
    telemetryNovel: (ok: boolean) => (ok ? '已连小说 IP' : '未连小说节点'), // cjk-ok
    telemetryScreens: (n: number) => `${n} 屏可拆分 UI`, // cjk-ok
    telemetryQa: (s: number) => `完备度 ${s}/100`, // cjk-ok
    synthesizeOfflineBtn: '融合上游合成标准策划案', // cjk-ok
    synthesizeOfflineHint:
      '一键融合上游经济系统数值、小说IP设定与当前系统原型，生成完整可交付策划案', // cjk-ok
    generateBtn: 'AI 生成策划案', // cjk-ok
    generatingBtn: '生成中...', // cjk-ok
    pushToUiSplitBtn: '推送至 UI 拆分 (ui.split)', // cjk-ok
    backToCanvas: '返回画布', // cjk-ok
    tabArchetypes: '系统原型', // cjk-ok
    tabEconomyBridge: '经济桥接', // cjk-ok
    tabNovelBridge: '小说IP桥接', // cjk-ok
    archetypeSectionTitle: '8 大游戏系统策划案原型矩阵', // cjk-ok
    unitFeatures: '项功能', // cjk-ok
    unitScreens: '屏UI', // cjk-ok
    coreLoopTitle: '核心玩法与体验闭环', // cjk-ok
    designGoalTitle: '系统策划案交付目标', // cjk-ok
    applyArchetypeTemplateBtn: '按此原型 + 上游数据生成完整策划案骨架', // cjk-ok
    economyBridgeTitle: '上游经济系统 (game.economy) 数值契约', // cjk-ok
    novelBridgeTitle: '上游小说 IP (asset.novel) 设定转化', // cjk-ok
    connectedLabel: '已连接', // cjk-ok
    unconnectedLabel: '未连接', // cjk-ok
    injectEconomyBtn: '注入乘区公式与配置表', // cjk-ok
    openEconomyWorkbenchBtn: '打开数值工作台', // cjk-ok
    economyEmptyDesc:
      '连接上游「经济系统 (game.economy)」后，可自动提取伤害乘区公式、实体属性预算表、抽卡软硬保底概率与资源产销比写入策划案。', // cjk-ok
    linkExistingEconomyBtn: (name?: string) =>
      `一键连接画布中的经济系统 (${name || 'game.economy'})`, // cjk-ok
    createEconomyNodeBtn: '新建并连接上游经济系统节点', // cjk-ok
    injectNovelBtn: '注入小说境界/角色/法宝设定', // cjk-ok
    openNovelWorkbenchBtn: '打开小说工作台', // cjk-ok
    novelEmptyDesc:
      '连接上游「创建小说 (asset.novel)」后，可自动把小说流派阶梯、人物关系档案、解锁底牌道具与章节转化为游戏养成线、卡池与主线关卡表。', // cjk-ok
    linkExistingNovelBtn: (name?: string) => `一键连接画布中的小说节点 (${name || 'asset.novel'})`, // cjk-ok
    createNovelNodeBtn: '新建并连接上游小说节点', // cjk-ok
    instructionDrawerBtn: '生成指令与模板', // cjk-ok
    modePreview: 'MD 预览', // cjk-ok
    modeSplit: '双栏对照', // cjk-ok
    modeEdit: '源码编辑', // cjk-ok
    copyDocBtn: '复制全文', // cjk-ok
    copyCodeBtn: '复制', // cjk-ok
    editSectionHint: '在源码中定位并编辑此章节', // cjk-ok
    toggleLeftPanelHint: '展开/收起左侧原型与桥接栏', // cjk-ok
    toggleRightPanelHint: '展开/收起右侧 UI 预演与体检栏', // cjk-ok
    presetLabel: '指令预设：', // cjk-ok
    instructionPlaceholder: '输入策划案生成指令（支持 @引用上游经济系统与小说节点）...', // cjk-ok
    versionHistoryLabel: '版本记录：', // cjk-ok
    editorPlaceholder:
      '点击上方「📐 融合上游合成标准策划案」或「⚡ AI 生成策划案」，一键生成含功能点、数值配置表、ASCII 界面框线与 9-slice PSD 规范的完整策划案...', // cjk-ok
    charCountLabel: (n: number) => `正文字数：${n} 字`, // cjk-ok
    uiScreenReadyLabel: (n: number) => `已就绪 ${n} 个标准 UI 界面供下游 ui.split 拆分`, // cjk-ok
    tabUiPreview: 'UI 拆图预演', // cjk-ok
    tabFeatures: '功能与数值表', // cjk-ok
    tabQa: '策划案体检', // cjk-ok
    uiSplitPreFlightTitle: '下游 UI 界面拆分 (ui.split) 预检', // cjk-ok
    openUiSplitShortBtn: '推送拆图', // cjk-ok
    uiSplitPreFlightDesc:
      '「# UI 布局设计」下的每个子界面（含 screenKind、aspectRatio、ASCII 框线图与 9-slice 九宫格图层规范）将被下游 ui.split 精确拆分为独立出图卡片。', // cjk-ok
    quickInsertScreensLabel: '一键向正文追加标准 UI 界面模块：', // cjk-ok
    noScreensDetectedDesc: '当前正文中尚未检测到「# UI 布局设计」下的可拆分界面模块。', // cjk-ok
    appendAllArchetypeScreensBtn: '一键补全当前原型的全部标准 UI 界面', // cjk-ok
    archetypeFeaturesTitle: '当前原型标准功能点矩阵 (P0/P1/P2)', // cjk-ok
    archetypeFeaturesDesc:
      '点击可将任意标准功能点（含数值公式绑定与断线/连点/资源不足异常边界）插入策划案。', // cjk-ok
    insertFeatureBtn: '插入此功能模块到策划案', // cjk-ok
    qaCardTitle: '系统策划案 6 维工程完备度体检', // cjk-ok
    autoFixQaBtn: '一键补全缺失章节、数值表与 UI 框线规范' // cjk-ok
  }
})

function loadFromNode(): void {
  const cur = node.value
  if (!cur) return
  displayName.value = cur.title?.trim() || ''
  localInstruction.value = String(cur.params?.generateInstruction ?? '')
  const list = cur.params?.generatedTexts ?? []
  const selId = cur.params?.selectedTextId
  const selItem = list.find((i) => i.id === selId) ?? list[list.length - 1]
  const rawText = selItem?.text || cur.params?.text || ''
  if (rawText.trim() && rawText.trim() !== '…') {
    localText.value = rawText
  } else {
    // Auto-populate a rich initial GDD skeleton when opening an empty gameSystem node in Dive
    const initialDoc = synthesizeGameSystemDocOffline({
      archetypeId: activeArchetype.value.id,
      customInstruction: localInstruction.value,
      economyText: unwrappedEconomySpecPreview.value,
      novelText: extractedNovelIpPreview.value,
      targetAspect: targetAspect.value
    })
    localText.value = initialDoc
  }
  dirtyText.value = false
}

watch(
  () =>
    [
      resolvedHostId.value,
      activeNodeId.value,
      Boolean(realNode.value),
      graphEditorHosts.revision.value
    ] as const,
  () => {
    if (!dirtyText.value) {
      loadFromNode()
    }
  },
  { immediate: true }
)

function updateTargetNode(paramsPatch: Partial<GraphNode['params']>, nextTitle?: string): void {
  if (realNode.value) {
    graphEditorHosts.updateNode(resolvedHostId.value, realNode.value.id, paramsPatch, nextTitle)
    return
  }
  if (nextTitle !== undefined) fallbackNode.title = nextTitle
  fallbackNode.params = { ...fallbackNode.params, ...paramsPatch }
}

function persistTitle(): void {
  const cur = node.value
  if (!cur) return
  updateTargetNode({}, displayName.value.trim() || typeLabel.value)
}

function persistInstruction(): void {
  updateTargetNode({
    generateInstruction: localInstruction.value
  })
}

function onDocInput(): void {
  dirtyText.value = true
}

function persistDocText(): void {
  const cur = node.value
  if (!cur) return
  const nextText = localText.value
  const list = [...(cur.params?.generatedTexts ?? [])]
  const selId = selectedVersionId.value
  if (list.length > 0 && selId) {
    const idx = list.findIndex((i) => i.id === selId)
    if (idx >= 0) {
      list[idx] = { ...list[idx]!, text: nextText }
    }
  }
  updateTargetNode({
    text: nextText,
    ...(list.length > 0 ? { generatedTexts: list } : {})
  })
  dirtyText.value = false
}

useEditorDiveFrameFlush(
  () => props.frameKey,
  () => {
    if (dirtyText.value) persistDocText()
  }
)

function selectArchetype(id: GameSystemArchetypeId): void {
  updateTargetNode({
    gameSystemArchetype: id
  })
  const arch = resolveGameSystemArchetype(id)
  statusBanner.value = isEn.value
    ? `Switched system archetype to ${arch.labelEn}. Click "Synthesize Standard GDD" to rebuild document.`
    : `已切换系统原型为「${arch.icon} ${arch.labelZh}」，可点击「📐 融合上游合成标准策划案」刷新全文结构。` // cjk-ok
}

function setTargetAspect(asp: '16:9' | '9:16' | '1:1'): void {
  updateTargetNode({
    gameSystemTargetAspect: asp
  })
}

function applyPresetInstruction(body: string): void {
  localInstruction.value = body
  persistInstruction()
}

function selectVersion(id: string): void {
  if (!id) return
  const item = generatedList.value.find((i) => i.id === id)
  if (!item) return
  localText.value = item.text || ''
  dirtyText.value = false
  updateTargetNode({
    selectedTextId: id,
    text: localText.value
  })
}

function synthesizeStandardDocFromContext(): void {
  const doc = synthesizeGameSystemDocOffline({
    archetypeId: activeArchetype.value.id,
    customInstruction: localInstruction.value,
    economyText: unwrappedEconomySpecPreview.value,
    novelText: extractedNovelIpPreview.value,
    targetAspect: targetAspect.value
  })
  localText.value = doc
  persistDocText()
  statusBanner.value = isEn.value
    ? 'Synthesized full GDD combining Archetype + Upstream Economy + Novel IP.'
    : '已融合当前系统原型、上游经济系统数值与小说 IP 设定，合成完整系统策划案！' // cjk-ok
}

async function runGameSystemGeneration(): Promise<void> {
  persistInstruction()
  if (dirtyText.value) persistDocText()
  toggleRun()
}

function injectEconomySpecIntoDoc(): void {
  const spec = unwrappedEconomySpecPreview.value
  if (!spec) return
  if (localText.value.includes(/* cjk-ok */ '# 数据与配置')) {
    localText.value = localText.value.replace(
      /# 数据与配置[^\n]*\n/, // cjk-ok
      `# 数据与配置（核心数值公式与配置表）\n\n${spec}\n\n` // cjk-ok
    )
  } else {
    localText.value = `${localText.value.trim()}\n\n# 数据与配置（核心数值公式与配置表）\n\n${spec}\n` // cjk-ok
  }
  persistDocText()
  statusBanner.value = isEn.value
    ? 'Injected upstream Economy multiplier formulas & entity tables into # Data & Configuration.'
    : '已将上游经济系统的乘区公式、属性预算表与保底参数注入「# 数据与配置」章节！' // cjk-ok
}

function injectNovelIpIntoDoc(): void {
  const ip = extractedNovelIpPreview.value
  if (!ip) return
  if (localText.value.includes(/* cjk-ok */ '# 系统概述')) {
    localText.value = localText.value.replace(
      /# 系统概述[^\n]*\n/, // cjk-ok
      `# 系统概述\n\n${ip}\n\n` // cjk-ok
    )
  } else {
    localText.value = `# 系统概述\n\n${ip}\n\n${localText.value.trim()}` // cjk-ok
  }
  persistDocText()
  statusBanner.value = isEn.value
    ? 'Injected upstream Novel IP stage ladder, roster & chapters into # System Overview.'
    : '已将上游小说 IP 的境界阶梯、人物卡池、底牌道具与章节关卡注入策划案！' // cjk-ok
}

function connectExistingUpstreamNode(sourceNodeId: string): void {
  const hid = resolvedHostId.value
  const cur = realNode.value
  if (!hid || !cur) return
  const srcNode = graphEditorHosts.getNode(hid, sourceNodeId)
  const sourcePort = srcNode?.typeId === 'game.economy' ? 'out-text' : 'out'
  graphEditorHosts.connectNodes(hid, sourceNodeId, cur.id, sourcePort, 'in')
}

function createAndConnectEconomyNode(): void {
  const cur = node.value
  const hid = resolvedHostId.value
  if (!cur || !hid) return
  const newId = graphEditorHosts.addNode(hid, {
    typeId: 'game.economy',
    title: isEn.value ? 'Economy System' : '经济与数值系统', // cjk-ok
    position: {
      x: (cur.position?.x ?? 400) - 380,
      y: (cur.position?.y ?? 200) - 120
    }
  })
  if (newId) {
    connectExistingUpstreamNode(newId)
  }
}

function createAndConnectNovelNode(): void {
  const cur = node.value
  const hid = resolvedHostId.value
  if (!cur || !hid) return
  const newId = graphEditorHosts.addNode(hid, {
    typeId: 'asset.novel',
    title: isEn.value ? 'Novel Generator' : '创建小说', // cjk-ok
    position: {
      x: (cur.position?.x ?? 400) - 380,
      y: (cur.position?.y ?? 200) + 140
    }
  })
  if (newId) {
    connectExistingUpstreamNode(newId)
  }
}

async function switchToPeerNodeDive(
  meta: {
    viewId: 'game.workbench' | 'novel.workbench' | 'ui.split'
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

async function diveToUpstreamNode(targetNodeId: string, viewId: EditorDiveViewId): Promise<void> {
  if (dirtyText.value) persistDocText()
  const hid = resolvedHostId.value
  const targetNode = graphEditorHosts.getNode(hid, targetNodeId)
  await switchToPeerNodeDive(
    {
      viewId: viewId as 'game.workbench' | 'novel.workbench',
      hostId: hid,
      nodeId: targetNodeId
    },
    targetNode?.title || viewId
  )
}

async function pushAndOpenUiSplitNode(): Promise<void> {
  if (!localText.value.trim()) {
    synthesizeStandardDocFromContext()
  } else if (dirtyText.value) {
    persistDocText()
  }
  const hid = resolvedHostId.value
  const g = graphDoc.value
  const cur = realNode.value
  if (!g || !cur || !hid) return

  // Find connected downstream ui.split node or any ui.split node
  const outgoingTargetIds = new Set(
    (g.edges ?? []).filter((e) => e.source === cur.id).map((e) => e.target)
  )
  let uiSplitNode =
    (g.nodes ?? []).find((n) => n.typeId === 'ui.split' && outgoingTargetIds.has(n.id)) ??
    (g.nodes ?? []).find((n) => n.typeId === 'ui.split')

  if (!uiSplitNode) {
    const newId = graphEditorHosts.addNode(hid, {
      typeId: 'ui.split',
      title: isEn.value ? 'UI Screen Split' : 'UI 界面拆分', // cjk-ok
      position: {
        x: (cur.position?.x ?? 400) + 380,
        y: cur.position?.y ?? 200
      },
      linkFrom: [{ nodeId: cur.id, portId: 'out' }]
    })
    if (newId) {
      uiSplitNode = graphEditorHosts.getNode(hid, newId) ?? undefined
    }
  } else {
    graphEditorHosts.connectNodes(hid, cur.id, uiSplitNode.id, 'out', 'in')
  }
  updateTargetNode({ text: localText.value })

  if (uiSplitNode) {
    await switchToPeerNodeDive(
      { viewId: 'ui.split', hostId: hid, nodeId: uiSplitNode.id },
      uiSplitNode.title || 'UI Split'
    )
  }
}

function jumpOrInsertSection(sec: { id: string; heading: string; present: boolean }): void {
  const idx = localText.value.indexOf(sec.heading)
  if (idx < 0) {
    localText.value = `${localText.value.trim()}\n\n${sec.heading}\n- （待补充）\n` // cjk-ok
    persistDocText()
  }
  void nextTick(() => {
    if (docViewMode.value === 'preview' || docViewMode.value === 'split') {
      const container = mdPreviewScrollRef.value
      const targetEl = container?.querySelector<HTMLElement>(`[data-sec-id="${sec.id}"]`)
      if (targetEl) {
        targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
    }
    if (docViewMode.value === 'edit' || docViewMode.value === 'split') {
      const el = docTextareaRef.value
      const targetIdx = localText.value.indexOf(sec.heading)
      if (targetIdx >= 0 && el) {
        el.focus()
        el.setSelectionRange(targetIdx, targetIdx + sec.heading.length)
      }
    }
  })
}

interface GddInlineSpan {
  kind: 'text' | 'bold' | 'code' | 'priority'
  text: string
}

interface GddHeadingBadge {
  kind: 'priority' | 'screen' | 'aspect'
  text: string
}

type GddMdBlock =
  | {
      type: 'heading'
      level: 1 | 2 | 3 | 4
      text: string
      rawHeading: string
      sectionId: string | null
      badges: GddHeadingBadge[]
    }
  | {
      type: 'table'
      headers: GddInlineSpan[][]
      rows: GddInlineSpan[][][]
    }
  | {
      type: 'code'
      lang: string
      code: string
      isWireframe: boolean
    }
  | {
      type: 'blockquote'
      lines: GddInlineSpan[][]
    }
  | {
      type: 'list'
      ordered: boolean
      items: { indent: number; spans: GddInlineSpan[] }[]
    }
  | {
      type: 'hr'
    }
  | {
      type: 'paragraph'
      spans: GddInlineSpan[]
    }

function parseGddInlineSpans(raw: string): GddInlineSpan[] {
  if (!raw) return []
  const spans: GddInlineSpan[] = []
  const tokenRegex = /(\*\*[^*]+\*\*|`[^`]+`|\bP[012]\b)/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = tokenRegex.exec(raw)) !== null) {
    if (match.index > lastIndex) {
      spans.push({ kind: 'text', text: raw.slice(lastIndex, match.index) })
    }
    const token = match[0]
    if (token.startsWith('**') && token.endsWith('**')) {
      spans.push({ kind: 'bold', text: token.slice(2, -2) })
    } else if (token.startsWith('`') && token.endsWith('`')) {
      const inner = token.slice(1, -1)
      if (/^P[012]$/.test(inner)) {
        spans.push({ kind: 'priority', text: inner })
      } else {
        spans.push({ kind: 'code', text: inner })
      }
    } else if (/^P[012]$/.test(token)) {
      spans.push({ kind: 'priority', text: token })
    } else {
      spans.push({ kind: 'text', text: token })
    }
    lastIndex = tokenRegex.lastIndex
  }
  if (lastIndex < raw.length) {
    spans.push({ kind: 'text', text: raw.slice(lastIndex) })
  }
  return spans
}

function resolveHeadingSectionId(headingText: string): string | null {
  if (/系统概述|System\s*Overview/i.test(headingText)) return 'overview' // cjk-ok
  if (/系统目标|System\s*Goals/i.test(headingText)) return 'goals' // cjk-ok
  if (/功能点设计|Feature\s*Design/i.test(headingText)) return 'features' // cjk-ok
  if (/UI\s*布局设计|UI\s*Layout/i.test(headingText)) return 'uiLayout' // cjk-ok
  if (/UI\s*要求|UI\s*Requirements/i.test(headingText)) return 'uiRequirements' // cjk-ok
  if (/数据与配置|Data\s*&\s*Config/i.test(headingText)) return 'dataConfig' // cjk-ok
  return null
}

function extractHeadingBadges(headingText: string): GddHeadingBadge[] {
  const badges: GddHeadingBadge[] = []
  const prioMatch = /\b(P0|P1|P2)\b/.exec(headingText)
  if (prioMatch?.[1]) {
    badges.push({ kind: 'priority', text: prioMatch[1] })
  }
  const kindMatch = /\b(fullscreen|hud|popup|panel|component)\b/i.exec(headingText)
  if (kindMatch?.[1]) {
    badges.push({ kind: 'screen', text: kindMatch[1].toLowerCase() })
  }
  const aspectMatch = /\b(16:9|9:16|1:1)\b/.exec(headingText)
  if (aspectMatch?.[1]) {
    badges.push({ kind: 'aspect', text: aspectMatch[1] })
  }
  return badges
}

function splitTableCells(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  return trimmed.split('|').map((c) => c.trim())
}

function isTableSeparatorLine(line: string): boolean {
  const t = line.trim()
  if (!t.includes('|')) return false
  const cells = splitTableCells(t)
  return cells.length > 0 && cells.every((c) => /^:?-{2,}:?$/.test(c))
}

const parsedMdBlocks = computed<GddMdBlock[]>(() => {
  const src = localText.value
  if (!src || !src.trim()) return []
  const lines = src.replace(/\r\n/g, '\n').split('\n')
  const blocks: GddMdBlock[] = []
  let i = 0

  while (i < lines.length) {
    const rawLine = lines[i] ?? ''
    const trimmed = rawLine.trim()

    if (!trimmed) {
      i++
      continue
    }

    // 1. Fenced code block
    if (trimmed.startsWith('```')) {
      const lang = trimmed.slice(3).trim()
      const codeLines: string[] = []
      i++
      while (i < lines.length && !(lines[i] ?? '').trim().startsWith('```')) {
        codeLines.push(lines[i] ?? '')
        i++
      }
      if (i < lines.length) i++
      const code = codeLines.join('\n')
      const isWireframe =
        /ascii|wireframe/i.test(lang) ||
        /[┌┐└┘─│├┤┬┴┼╔╗╚╝═║]/.test(code) ||
        /\[HUD\]|\[Popup\]|\[Panel\]|9-slice/i.test(code)
      blocks.push({
        type: 'code',
        lang,
        code,
        isWireframe
      })
      continue
    }

    // 2. Heading (# ~ ####)
    const headingMatch = /^(#{1,4})\s+(.+)$/.exec(trimmed)
    if (headingMatch) {
      const level = Math.min(4, headingMatch[1]!.length) as 1 | 2 | 3 | 4
      const text = headingMatch[2]!.trim()
      blocks.push({
        type: 'heading',
        level,
        text,
        rawHeading: trimmed,
        sectionId: level === 1 ? resolveHeadingSectionId(text) : null,
        badges: extractHeadingBadges(text)
      })
      i++
      continue
    }

    // 3. Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      blocks.push({ type: 'hr' })
      i++
      continue
    }

    // 4. Markdown Table
    if (trimmed.includes('|') && i + 1 < lines.length && isTableSeparatorLine(lines[i + 1] ?? '')) {
      const headerStrings = splitTableCells(trimmed)
      const headers = headerStrings.map((h) => parseGddInlineSpans(h))
      i += 2
      const rows: GddInlineSpan[][][] = []
      while (i < lines.length) {
        const rowLine = (lines[i] ?? '').trim()
        if (!rowLine || !rowLine.includes('|')) break
        if (isTableSeparatorLine(rowLine)) {
          i++
          continue
        }
        const cells = splitTableCells(rowLine).map((c) => parseGddInlineSpans(c))
        rows.push(cells)
        i++
      }
      blocks.push({
        type: 'table',
        headers,
        rows
      })
      continue
    }

    // 5. Blockquote
    if (trimmed.startsWith('>')) {
      const quoteLines: GddInlineSpan[][] = []
      while (i < lines.length && (lines[i] ?? '').trim().startsWith('>')) {
        const qText = (lines[i] ?? '').trim().replace(/^>\s?/, '')
        if (qText) {
          quoteLines.push(parseGddInlineSpans(qText))
        }
        i++
      }
      blocks.push({
        type: 'blockquote',
        lines: quoteLines
      })
      continue
    }

    // 6. Unordered or Ordered List
    const listMatch = /^(\s*)([-*+]|\d+\.)\s+(.+)$/.exec(rawLine)
    if (listMatch) {
      const ordered = /^\d+\.$/.test(listMatch[2]!)
      const items: { indent: number; spans: GddInlineSpan[] }[] = []
      while (i < lines.length) {
        const curRaw = lines[i] ?? ''
        const m = /^(\s*)([-*+]|\d+\.)\s+(.+)$/.exec(curRaw)
        if (!m) break
        const indentSpaces = (m[1] ?? '').replace(/\t/g, '  ').length
        const indent = Math.min(3, Math.floor(indentSpaces / 2))
        items.push({
          indent,
          spans: parseGddInlineSpans(m[3]!.trim())
        })
        i++
      }
      blocks.push({
        type: 'list',
        ordered,
        items
      })
      continue
    }

    // 7. Paragraph
    const paraLines: string[] = [trimmed]
    i++
    while (i < lines.length) {
      const nextRaw = lines[i] ?? ''
      const nextTrim = nextRaw.trim()
      if (
        !nextTrim ||
        nextTrim.startsWith('```') ||
        /^(#{1,4})\s+/.test(nextTrim) ||
        /^(-{3,}|\*{3,}|_{3,})$/.test(nextTrim) ||
        nextTrim.startsWith('>') ||
        /^(\s*)([-*+]|\d+\.)\s+/.test(nextRaw) ||
        (nextTrim.includes('|') && i + 1 < lines.length && isTableSeparatorLine(lines[i + 1] ?? ''))
      ) {
        break
      }
      paraLines.push(nextTrim)
      i++
    }
    blocks.push({
      type: 'paragraph',
      spans: parseGddInlineSpans(paraLines.join(' '))
    })
  }

  return blocks
})

function focusHeadingInSource(rawHeading: string): void {
  if (docViewMode.value === 'preview') {
    docViewMode.value = 'split'
  }
  void nextTick(() => {
    const el = docTextareaRef.value
    const idx = localText.value.indexOf(rawHeading)
    if (el && idx >= 0) {
      el.focus()
      el.setSelectionRange(idx, idx + rawHeading.length)
    }
  })
}

async function copyFullDocumentMarkdown(): Promise<void> {
  try {
    await navigator.clipboard.writeText(localText.value)
    statusBanner.value = isEn.value
      ? 'Copied full GDD Markdown to clipboard.'
      : '已将完整策划案 Markdown 复制到剪贴板！' // cjk-ok
  } catch {
    // ignore clipboard error
  }
}

async function copyCodeSnippet(code: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(code)
    statusBanner.value = isEn.value
      ? 'Copied wireframe / code block to clipboard.'
      : '已复制框线图 / 代码块到剪贴板！' // cjk-ok
  } catch {
    // ignore clipboard error
  }
}

function insertStandardScreenBlock(scr: GameSystemUiScreenSpec, index: number): void {
  const block = buildStandardUiScreenMarkdownBlock(
    { ...scr, aspectRatio: targetAspect.value },
    index
  )
  if (localText.value.includes(/* cjk-ok */ '# UI 布局设计')) {
    localText.value = localText.value.replace(
      /(#\s*UI\s*布局设计[^\n]*\n)/, // cjk-ok
      `$1\n${block}\n\n`
    )
  } else {
    localText.value = `${localText.value.trim()}\n\n# UI 布局设计\n\n${block}\n` // cjk-ok
  }
  persistDocText()
  statusBanner.value = isEn.value
    ? `Appended UI screen "${scr.titleEn}" with ASCII wireframe & 9-slice PSD spec.`
    : `已向「# UI 布局设计」追加《${scr.titleZh}》界面框线与 9-slice PSD 图层规范！` // cjk-ok
}

function appendAllArchetypeScreens(): void {
  const blocks = activeArchetype.value.defaultScreens
    .map((scr, idx) =>
      buildStandardUiScreenMarkdownBlock({ ...scr, aspectRatio: targetAspect.value }, idx + 1)
    )
    .join('\n\n')
  if (localText.value.includes(/* cjk-ok */ '# UI 布局设计')) {
    localText.value = localText.value.replace(
      /(#\s*UI\s*布局设计[^\n]*\n)/, // cjk-ok
      `$1\n${blocks}\n\n`
    )
  } else {
    localText.value = `${localText.value.trim()}\n\n# UI 布局设计\n\n${blocks}\n` // cjk-ok
  }
  persistDocText()
}

function insertFeatureModuleBlock(feat: GameSystemFeatureModuleSpec): void {
  const code = feat.code || feat.id
  const rules = feat.ruleSummaryZh || feat.rulesZh
  const block = [
    `## ${code} ${feat.nameZh}`,
    `- **优先级**：\`${feat.priority}\``, // cjk-ok
    `- **触发入口**：${feat.triggerZh}`, // cjk-ok
    `- **规则与交互流程**：${rules}`, // cjk-ok
    `- **边界与异常处理**：${feat.edgeCasesZh}` // cjk-ok
  ].join('\n')
  if (localText.value.includes(/* cjk-ok */ '# 功能点设计')) {
    localText.value = localText.value.replace(
      /(#\s*功能点设计[^\n]*\n)/, // cjk-ok
      `$1\n${block}\n\n`
    )
  } else {
    localText.value = `${localText.value.trim()}\n\n# 功能点设计\n\n${block}\n` // cjk-ok
  }
  persistDocText()
}

function autoFixMissingGddSections(): void {
  if (!localText.value.trim()) {
    synthesizeStandardDocFromContext()
    return
  }
  const fullRef = synthesizeGameSystemDocOffline({
    archetypeId: activeArchetype.value.id,
    customInstruction: localInstruction.value,
    economyText: unwrappedEconomySpecPreview.value,
    novelText: extractedNovelIpPreview.value,
    targetAspect: targetAspect.value
  })
  const audit = docAudit.value
  let next = localText.value.trim()
  if (!audit.sectionChecks.uiLayout || audit.uiScreens.length === 0) {
    const blocks = activeArchetype.value.defaultScreens
      .map((scr, idx) =>
        buildStandardUiScreenMarkdownBlock({ ...scr, aspectRatio: targetAspect.value }, idx + 1)
      )
      .join('\n\n')
    next += `\n\n# UI 布局设计\n\n${blocks}` // cjk-ok
  }
  if (!audit.sectionChecks.dataConfig || !audit.hasNumericalFormulaBinding) {
    const dataSectionMatch = /#\s*数据与配置[\s\S]*?(?=\n#\s+|$)/.exec(fullRef) // cjk-ok
    if (dataSectionMatch) {
      next += `\n\n${dataSectionMatch[0]}`
    }
  }
  if (!audit.sectionChecks.uiRequirements) {
    const reqMatch = /#\s*UI\s*要求[\s\S]*?(?=\n#\s+|$)/.exec(fullRef) // cjk-ok
    if (reqMatch) {
      next += `\n\n${reqMatch[0]}`
    }
  }
  localText.value = next
  persistDocText()
  statusBanner.value = isEn.value
    ? 'Auto-completed missing GDD sections, numerical formulas, and UI wireframes.'
    : '已自动补全缺失的标准章节、数值公式绑定与 UI 界面框线规范！' // cjk-ok
}

function popDive(): void {
  if (dirtyText.value) persistDocText()
  if (editorDive) {
    const idx = editorDive.frames.findIndex((f) => f.key === props.frameKey)
    editorDive.popTo(idx < 0 ? -1 : idx - 1)
    return
  }
  const rootKey = workspace.activeDiveRootKey?.trim()
  if (rootKey) {
    workspace.divePopTo(rootKey, -1)
  }
}
</script>

<style scoped>
.dive-game-system {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-canvas, #0d1017);
  color: var(--text-primary, #e6edf3);
  font-size: 12px;
  container-type: inline-size;
  container-name: gdd-workbench;
}

.workbench-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px 12px;
  padding: 8px 14px;
  background: rgba(18, 23, 34, 0.96);
  border-bottom: 1px solid rgba(148, 163, 184, 0.08);
  flex-shrink: 0;
}

.header-left {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  min-width: 0;
  flex: 0 1 auto;
}

.header-telemetry {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  min-width: 0;
  flex: 1 1 auto;
}

.header-right {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin-left: auto;
  flex: 0 0 auto;
}

.panel-toggle-group {
  display: inline-flex;
  align-items: center;
  background: rgba(148, 163, 184, 0.04);
  border: 1px solid rgba(148, 163, 184, 0.1);
  border-radius: 6px;
  padding: 2px;
  gap: 2px;
}

.hdr-icon-btn {
  padding: 3px 7px;
  border-radius: 4px;
  border: none;
  background: transparent;
  color: #8b949e;
  font-size: 12px;
  cursor: pointer;
  line-height: 1;
}

.hdr-icon-btn.active {
  background: rgba(99, 102, 241, 0.25);
  color: #e0e7ff;
}

.kind-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 6px;
  background: rgba(99, 102, 241, 0.18);
  color: #818cf8;
  flex-shrink: 0;
}

.title-input {
  background: rgba(148, 163, 184, 0.05);
  border: 1px solid rgba(148, 163, 184, 0.1);
  border-radius: 6px;
  color: #f0f6fc;
  padding: 4px 8px;
  font-size: 13px;
  font-weight: 600;
  width: clamp(120px, 14vw, 180px);
  min-width: 110px;
}

.archetype-pill,
.aspect-pill,
.stat-pill {
  padding: 3px 8px;
  border-radius: 999px;
  font-size: 11px;
  background: rgba(148, 163, 184, 0.06);
  border: 1px solid rgba(148, 163, 184, 0.1);
  white-space: nowrap;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.archetype-pill {
  background: rgba(99, 102, 241, 0.16);
  border-color: rgba(99, 102, 241, 0.35);
  color: #c7d2fe;
}

.stat-ok {
  background: rgba(16, 185, 129, 0.14);
  border-color: rgba(16, 185, 129, 0.35);
  color: #6ee7b7;
}

.stat-warn {
  background: rgba(245, 158, 11, 0.15);
  border-color: rgba(245, 158, 11, 0.35);
  color: #fcd34d;
}

.stat-accent {
  background: rgba(56, 189, 248, 0.15);
  border-color: rgba(56, 189, 248, 0.35);
  color: #7dd3fc;
}

.stat-muted {
  color: #8b949e;
}

.hdr-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px 10px;
  border-radius: 6px;
  border: 1px solid rgba(148, 163, 184, 0.12);
  background: rgba(148, 163, 184, 0.06);
  color: #e6edf3;
  font-size: 12px;
  white-space: nowrap;
  cursor: pointer;
}

.hdr-btn:hover {
  background: rgba(148, 163, 184, 0.12);
}

.hdr-btn-accent {
  background: rgba(99, 102, 241, 0.25);
  border-color: rgba(99, 102, 241, 0.5);
  color: #e0e7ff;
  font-weight: 600;
}

.hdr-btn-ui {
  background: rgba(16, 185, 129, 0.22);
  border-color: rgba(16, 185, 129, 0.45);
  color: #a7f3d0;
  font-weight: 600;
}

.status-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 14px;
  background: rgba(56, 189, 248, 0.14);
  border-bottom: 1px solid rgba(56, 189, 248, 0.3);
  color: #bae6fd;
  font-size: 12px;
}

.banner-close {
  background: transparent;
  border: none;
  color: inherit;
  cursor: pointer;
  font-size: 14px;
}

.workbench-body {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: clamp(250px, 21vw, 310px) minmax(0, 1fr) clamp(270px, 24vw, 350px);
}

.workbench-body.hide-left:not(.hide-right) {
  grid-template-columns: minmax(0, 1fr) clamp(270px, 25vw, 360px);
}

.workbench-body.hide-right:not(.hide-left) {
  grid-template-columns: clamp(250px, 21vw, 310px) minmax(0, 1fr);
}

.workbench-body.hide-left.hide-right {
  grid-template-columns: minmax(0, 1fr);
}

.col-left,
.col-right {
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  background: rgba(15, 19, 28, 0.9);
  border-right: 1px solid rgba(148, 163, 184, 0.07);
}

.col-right {
  border-right: none;
  border-left: 1px solid rgba(148, 163, 184, 0.07);
}

/* Adaptive Segmented Top Tabs for Left & Right Columns */
.left-tabs,
.right-tabs {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 4px;
  padding: 6px 8px;
  background: rgba(10, 13, 20, 0.65);
  border-bottom: 1px solid rgba(148, 163, 184, 0.08);
  flex-shrink: 0;
}

.left-tab,
.right-tab {
  min-width: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 6px 6px;
  border-radius: 6px;
  background: rgba(148, 163, 184, 0.02);
  border: 1px solid transparent;
  color: #9ca3af;
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  cursor: pointer;
  transition: all 0.15s ease;
}

.left-tab:hover,
.right-tab:hover {
  background: rgba(148, 163, 184, 0.06);
  color: #e6edf3;
}

.left-tab.active,
.right-tab.active {
  color: #f0f6fc;
  border-color: rgba(99, 102, 241, 0.45);
  background: rgba(99, 102, 241, 0.18);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.25);
}

.tab-icon {
  flex-shrink: 0;
  font-size: 12px;
}

.tab-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tab-dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  flex-shrink: 0;
}

.dot-ok {
  background: #10b981;
  box-shadow: 0 0 6px rgba(16, 185, 129, 0.6);
}

.dot-Idle {
  background: rgba(148, 163, 184, 0.2);
}

.tab-count {
  padding: 0 5px;
  border-radius: 999px;
  background: rgba(148, 163, 184, 0.1);
  color: #c7d2fe;
  font-size: 10px;
  line-height: 1.4;
  flex-shrink: 0;
}

.left-panel-scroll,
.right-panel-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.panel-card {
  background: rgba(148, 163, 184, 0.03);
  border: 1px solid rgba(148, 163, 184, 0.07);
  border-radius: 8px;
  padding: 10px;
}

.card-header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  margin-bottom: 6px;
}

.card-title {
  font-weight: 600;
  color: #e6edf3;
  font-size: 12px;
}

.card-desc {
  color: #9ca3af;
  font-size: 11px;
  line-height: 1.5;
  margin: 4px 0;
}

.archetype-grid {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 6px;
}

.archetype-card {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 9px;
  border-radius: 7px;
  border: 1px solid rgba(148, 163, 184, 0.08);
  background: rgba(148, 163, 184, 0.02);
  color: #e6edf3;
  text-align: left;
  cursor: pointer;
}

.archetype-card.active {
  border-color: rgba(99, 102, 241, 0.65);
  background: rgba(99, 102, 241, 0.16);
}

.arch-icon {
  font-size: 16px;
}

.arch-name {
  font-size: 12px;
  font-weight: 600;
}

.arch-sub {
  font-size: 10px;
  color: #9ca3af;
}

.aspect-group {
  display: flex;
  gap: 4px;
}

.mini-pill-btn {
  padding: 2px 7px;
  border-radius: 4px;
  border: 1px solid rgba(148, 163, 184, 0.12);
  background: rgba(148, 163, 184, 0.04);
  color: #c9d1d9;
  font-size: 11px;
  cursor: pointer;
}

.mini-pill-btn.active {
  background: rgba(99, 102, 241, 0.25);
  border-color: rgba(99, 102, 241, 0.6);
  color: #fff;
}

.action-btn {
  width: 100%;
  padding: 7px 10px;
  border-radius: 6px;
  border: 1px solid rgba(148, 163, 184, 0.14);
  background: rgba(148, 163, 184, 0.06);
  color: #f0f6fc;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
}

.action-btn-primary {
  background: rgba(99, 102, 241, 0.22);
  border-color: rgba(99, 102, 241, 0.5);
  color: #e0e7ff;
}

.btn-col {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 8px;
}

.bridge-node-box {
  background: rgba(148, 163, 184, 0.04);
  border-radius: 6px;
  padding: 8px;
  margin-bottom: 8px;
}

.bridge-node-name {
  font-weight: 600;
  margin-bottom: 6px;
}

.bridge-btn-row {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.mini-action-btn {
  padding: 4px 8px;
  border-radius: 5px;
  border: 1px solid rgba(99, 102, 241, 0.4);
  background: rgba(99, 102, 241, 0.15);
  color: #c7d2fe;
  font-size: 11px;
  cursor: pointer;
}

.bridge-preview-pre {
  max-height: 360px;
  overflow: auto;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 10px;
  line-height: 1.45;
  background: rgba(0, 0, 0, 0.35);
  padding: 8px;
  border-radius: 6px;
  white-space: pre-wrap;
  color: #cbd5e1;
}

.col-center {
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  background: rgba(11, 14, 21, 0.95);
}

.center-toolbar {
  padding: 6px 12px;
  background: rgba(14, 18, 28, 0.92);
  border-bottom: 1px solid rgba(148, 163, 184, 0.08);
  flex-shrink: 0;
}

.toolbar-top-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.doc-mode-tabs {
  display: inline-flex;
  align-items: center;
  background: rgba(148, 163, 184, 0.04);
  border: 1px solid rgba(148, 163, 184, 0.1);
  border-radius: 7px;
  padding: 2px;
  gap: 2px;
  flex-shrink: 0;
}

.doc-mode-tab {
  padding: 4px 10px;
  border-radius: 5px;
  border: none;
  background: transparent;
  color: #9ca3af;
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
  transition: all 0.15s ease;
}

.doc-mode-tab:hover {
  color: #f0f6fc;
}

.doc-mode-tab.active {
  background: rgba(99, 102, 241, 0.26);
  color: #e0e7ff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
}

.section-pills {
  display: flex;
  align-items: center;
  flex-wrap: nowrap;
  overflow-x: auto;
  gap: 5px;
  flex: 1 1 260px;
  min-width: 0;
  padding-bottom: 2px;
  scrollbar-width: thin;
}

.sec-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 9px;
  border-radius: 999px;
  font-size: 11px;
  white-space: nowrap;
  flex-shrink: 0;
  border: 1px solid rgba(148, 163, 184, 0.1);
  background: rgba(148, 163, 184, 0.04);
  color: #9ca3af;
  cursor: pointer;
  transition: all 0.15s ease;
}

.sec-pill:hover {
  background: rgba(148, 163, 184, 0.09);
  color: #f0f6fc;
}

.sec-pill.sec-present {
  border-color: rgba(16, 185, 129, 0.35);
  background: rgba(16, 185, 129, 0.12);
  color: #6ee7b7;
}

.toolbar-right {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
  flex-shrink: 0;
}

.instruction-drawer {
  padding: 8px 12px;
  background: rgba(20, 26, 38, 0.95);
  border-bottom: 1px solid rgba(148, 163, 184, 0.08);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.drawer-preset-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 5px;
}

.drawer-label {
  font-size: 11px;
  color: #9ca3af;
}

.preset-chip {
  padding: 3px 8px;
  border-radius: 5px;
  border: 1px solid rgba(148, 163, 184, 0.12);
  background: rgba(148, 163, 184, 0.05);
  color: #e6edf3;
  font-size: 11px;
  cursor: pointer;
}

.preset-chip:hover {
  background: rgba(99, 102, 241, 0.2);
}

.instruction-textarea {
  width: 100%;
  background: rgba(0, 0, 0, 0.35);
  border: 1px solid rgba(148, 163, 184, 0.12);
  border-radius: 6px;
  color: #f0f6fc;
  padding: 6px 8px;
  font-size: 12px;
  resize: vertical;
}

.version-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.06);
  overflow-x: auto;
}

.version-chip {
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid rgba(148, 163, 184, 0.12);
  background: transparent;
  color: #9ca3af;
  font-size: 11px;
  white-space: nowrap;
  cursor: pointer;
}

.version-chip.active {
  background: rgba(99, 102, 241, 0.22);
  border-color: rgba(99, 102, 241, 0.5);
  color: #fff;
}

.editor-wrap {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  overflow: hidden;
}

.editor-wrap.mode-split {
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
}

.editor-pane-source {
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  height: 100%;
  border-right: 1px solid rgba(148, 163, 184, 0.08);
}

.editor-pane-markdown {
  flex: 1;
  min-height: 0;
  min-width: 0;
  height: 100%;
  overflow-y: auto;
  padding: 18px 24px 36px;
  background:
    radial-gradient(circle at top right, rgba(99, 102, 241, 0.05), transparent 45%),
    rgba(11, 14, 21, 0.96);
}

.gdd-textarea {
  flex: 1;
  width: 100%;
  height: 100%;
  background: transparent;
  border: none;
  outline: none;
  color: #e6edf3;
  padding: 14px 18px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12.5px;
  line-height: 1.65;
  resize: none;
}

/* Rich GDD Markdown Viewer Styles */
.md-empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  height: 100%;
  color: #8b949e;
  text-align: center;
  padding: 24px;
}

.gdd-md-article {
  max-width: 920px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
  color: #d1d5db;
  font-size: 13px;
  line-height: 1.7;
}

.gdd-md-heading {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  color: #f8fafc;
  font-weight: 700;
  margin: 14px 0 4px;
  scroll-margin-top: 14px;
}

.gdd-md-h1 {
  font-size: 17px;
  padding: 8px 12px;
  border-left: 4px solid #6366f1;
  background: linear-gradient(90deg, rgba(99, 102, 241, 0.14), rgba(99, 102, 241, 0.02));
  border-radius: 0 8px 8px 0;
  margin-top: 18px;
}

.gdd-md-h1:first-child {
  margin-top: 0;
}

.gdd-md-h2 {
  font-size: 14.5px;
  padding-bottom: 5px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.09);
  color: #e2e8f0;
  margin-top: 12px;
}

.gdd-md-h3,
.gdd-md-h4 {
  font-size: 13px;
  color: #cbd5e1;
  margin-top: 8px;
}

.heading-main-text {
  flex: 0 1 auto;
}

.heading-badges {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.md-inline-badge {
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 10.5px;
  font-weight: 600;
}

.bdg-priority {
  background: rgba(239, 68, 68, 0.18);
  border: 1px solid rgba(239, 68, 68, 0.4);
  color: #fca5a5;
}

.bdg-screen {
  background: rgba(56, 189, 248, 0.16);
  border: 1px solid rgba(56, 189, 248, 0.35);
  color: #7dd3fc;
}

.bdg-aspect {
  background: rgba(168, 85, 247, 0.16);
  border: 1px solid rgba(168, 85, 247, 0.35);
  color: #d8b4fe;
}

.heading-edit-btn {
  margin-left: auto;
  opacity: 0;
  padding: 2px 6px;
  border-radius: 4px;
  border: 1px solid rgba(148, 163, 184, 0.12);
  background: rgba(148, 163, 184, 0.05);
  color: #9ca3af;
  font-size: 11px;
  cursor: pointer;
  transition: opacity 0.15s ease;
}

.gdd-md-heading:hover .heading-edit-btn {
  opacity: 1;
}

.gdd-md-p {
  margin: 2px 0;
  color: #d1d5db;
}

.md-strong {
  color: #f8fafc;
  font-weight: 600;
}

.md-inline-code {
  padding: 1px 5px;
  border-radius: 4px;
  background: rgba(99, 102, 241, 0.14);
  border: 1px solid rgba(99, 102, 241, 0.28);
  color: #a5b4fc;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 11.5px;
}

.md-priority-pill {
  display: inline-block;
  padding: 0 6px;
  border-radius: 4px;
  font-size: 10.5px;
  font-weight: 700;
  font-family: ui-monospace, SFMono-Regular, monospace;
  margin: 0 2px;
}

.prio-p0 {
  background: rgba(239, 68, 68, 0.2);
  border: 1px solid rgba(239, 68, 68, 0.45);
  color: #fca5a5;
}

.prio-p1 {
  background: rgba(245, 158, 11, 0.2);
  border: 1px solid rgba(245, 158, 11, 0.45);
  color: #fcd34d;
}

.prio-p2 {
  background: rgba(56, 189, 248, 0.18);
  border: 1px solid rgba(56, 189, 248, 0.4);
  color: #7dd3fc;
}

.gdd-md-list {
  margin: 2px 0 4px;
  padding-left: 18px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.gdd-md-list-item {
  color: #d1d5db;
  line-height: 1.65;
}

.gdd-md-quote {
  margin: 4px 0;
  padding: 8px 12px;
  border-left: 3px solid #38bdf8;
  background: rgba(56, 189, 248, 0.08);
  border-radius: 0 6px 6px 0;
  color: #bae6fd;
}

.gdd-md-quote p {
  margin: 2px 0;
}

.gdd-md-table-wrap {
  width: 100%;
  overflow-x: auto;
  margin: 6px 0;
  border-radius: 8px;
  border: 1px solid rgba(148, 163, 184, 0.1);
  background: rgba(15, 20, 30, 0.75);
}

.gdd-md-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
  text-align: left;
}

.gdd-md-table th {
  background: rgba(99, 102, 241, 0.14);
  color: #e0e7ff;
  font-weight: 600;
  padding: 7px 10px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.1);
  white-space: nowrap;
}

.gdd-md-table td {
  padding: 6px 10px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.06);
  color: #cbd5e1;
  vertical-align: top;
}

.gdd-md-table tbody tr:hover {
  background: rgba(148, 163, 184, 0.03);
}

.gdd-md-code-card {
  margin: 6px 0;
  border-radius: 8px;
  border: 1px solid rgba(148, 163, 184, 0.1);
  background: rgba(7, 10, 15, 0.85);
  overflow: hidden;
}

.gdd-md-code-card.is-wireframe {
  border-color: rgba(56, 189, 248, 0.35);
  background: rgba(6, 15, 24, 0.9);
}

.code-card-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 10px;
  background: rgba(148, 163, 184, 0.04);
  border-bottom: 1px solid rgba(148, 163, 184, 0.07);
}

.code-lang-tag {
  font-size: 10.5px;
  font-weight: 600;
  color: #7dd3fc;
}

.code-copy-btn {
  padding: 1px 7px;
  border-radius: 4px;
  border: 1px solid rgba(148, 163, 184, 0.12);
  background: rgba(148, 163, 184, 0.05);
  color: #cbd5e1;
  font-size: 10.5px;
  cursor: pointer;
}

.code-copy-btn:hover {
  background: rgba(99, 102, 241, 0.25);
  color: #fff;
}

.gdd-md-pre {
  margin: 0;
  padding: 10px 12px;
  overflow-x: auto;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 11.5px;
  line-height: 1.4;
  color: #a5f3fc;
}

.gdd-md-hr {
  border: none;
  border-top: 1px solid rgba(148, 163, 184, 0.08);
  margin: 10px 0;
}

/* Container Queries for Adaptive Responsive Layout */
@container gdd-workbench (max-width: 1180px) {
  .workbench-body {
    grid-template-columns: 235px minmax(0, 1fr) 260px;
  }
  .editor-wrap.mode-split {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr) minmax(0, 1fr);
  }
  .editor-pane-source {
    border-right: none;
    border-bottom: 1px solid rgba(148, 163, 184, 0.08);
  }
}

@container gdd-workbench (max-width: 900px) {
  .workbench-body {
    grid-template-columns: minmax(0, 1fr);
    overflow-y: auto;
  }
  .col-left,
  .col-right {
    border-right: none;
    border-left: none;
    border-bottom: 1px solid rgba(148, 163, 184, 0.08);
    max-height: 280px;
  }
  .col-center {
    min-height: 460px;
  }
}

.editor-footer {
  display: flex;
  justify-content: space-between;
  padding: 5px 14px;
  border-top: 1px solid rgba(148, 163, 184, 0.06);
  color: #8b949e;
  font-size: 11px;
}

.quick-screens-box {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid rgba(148, 163, 184, 0.07);
}

.sub-label {
  font-size: 11px;
  color: #9ca3af;
  margin-bottom: 6px;
}

.quick-screen-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.screen-preview-card {
  border-color: rgba(56, 189, 248, 0.25);
}

.screen-title {
  font-weight: 600;
  color: #f0f6fc;
  font-size: 12px;
}

.screen-badges {
  display: flex;
  gap: 4px;
}

.mini-tag {
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 10px;
  background: rgba(148, 163, 184, 0.08);
}

.tag-kind {
  color: #7dd3fc;
}

.tag-aspect {
  color: #c4b5fd;
}

.tag-ok {
  color: #6ee7b7;
  background: rgba(16, 185, 129, 0.15);
}

.tag-warn {
  color: #fcd34d;
  background: rgba(245, 158, 11, 0.15);
}

.tag-priority {
  color: #fca5a5;
  background: rgba(239, 68, 68, 0.16);
  font-weight: 600;
}

.wireframe-box {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 10px;
  line-height: 1.3;
  background: rgba(0, 0, 0, 0.45);
  border: 1px solid rgba(148, 163, 184, 0.08);
  border-radius: 5px;
  padding: 7px;
  overflow-x: auto;
  color: #a5f3fc;
  margin: 6px 0;
}

.screen-summary {
  font-size: 11px;
  color: #9ca3af;
  line-height: 1.4;
  margin: 0;
}

.metrics-row {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin: 6px 0;
}

.metric-chip {
  padding: 1px 6px;
  border-radius: 4px;
  background: rgba(16, 185, 129, 0.12);
  color: #6ee7b7;
  font-size: 10px;
  font-family: ui-monospace, SFMono-Regular, monospace;
}

.edge-case-text {
  font-size: 10.5px;
  color: #fcd34d;
  margin: 4px 0;
  line-height: 1.4;
}

.qa-score-badge {
  padding: 2px 8px;
  border-radius: 999px;
  font-weight: 700;
  font-size: 12px;
}

.qa-high {
  background: rgba(16, 185, 129, 0.2);
  color: #6ee7b7;
}

.qa-mid {
  background: rgba(245, 158, 11, 0.2);
  color: #fcd34d;
}

.check-grid {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 8px 0;
}

.check-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 8px;
  border-radius: 5px;
  background: rgba(148, 163, 184, 0.03);
  font-size: 11px;
}

.chk-ok {
  color: #a7f3d0;
}

.chk-missing {
  color: #fde68a;
}

.warnings-list {
  margin-top: 8px;
  padding: 8px;
  border-radius: 6px;
  background: rgba(245, 158, 11, 0.1);
  border: 1px solid rgba(245, 158, 11, 0.25);
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.warning-row {
  font-size: 11px;
  color: #fde68a;
  line-height: 1.4;
}

.badge-dot {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 999px;
}

.badge-ok {
  background: rgba(16, 185, 129, 0.15);
  color: #6ee7b7;
}

.badge-warn {
  background: rgba(148, 163, 184, 0.08);
  color: #9ca3af;
}
</style>
